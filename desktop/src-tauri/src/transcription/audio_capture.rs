use audioadapter_buffers::direct::InterleavedSlice;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rubato::{Async, FixedAsync, Indexing, PolynomialDegree, Resampler};
use serde::Serialize;
use std::sync::{Arc, Mutex};

/// Whisper requires exactly 16 kHz mono f32 PCM.
const TARGET_SAMPLE_RATE: u32 = 16_000;

/// Maximum buffered samples after resampling (~30 seconds at 16kHz).
const MAX_SAMPLES: usize = TARGET_SAMPLE_RATE as usize * 30;

/// Information about an audio input device.
#[derive(Debug, Clone, Serialize)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
    pub sample_rates: Vec<u32>,
    pub channels: Vec<u16>,
}

/// Captures audio from the microphone and resamples to 16kHz mono f32 PCM.
///
/// All Whisper inference expects exactly 16,000 Hz mono. macOS devices typically
/// deliver 44,100 Hz or 48,000 Hz stereo. This struct handles the conversion
/// transparently so the caller always receives 16kHz mono samples.
pub struct AudioCapture {
    _stream: cpal::Stream,
    /// Resampled 16kHz mono output buffer, drained by the transcription loop.
    buffer: Arc<Mutex<Vec<f32>>>,
    /// The actual native capture rate (informational).
    native_sample_rate: u32,
}

impl AudioCapture {
    /// Start capturing audio from the default input device.
    ///
    /// Prefers 16kHz mono directly. If the device does not support that configuration,
    /// falls back to the device's native format and resamples to 16kHz in real time.
    pub fn start() -> Result<Self, String> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or("No audio input device found")?;

        let device_name = device.name().unwrap_or_else(|_| "unknown".into());

        // Query the device's native config to know what it can deliver.
        let supported_config = device
            .default_input_config()
            .map_err(|e| format!("Cannot query device '{}': {}", device_name, e))?;

        let native_rate = supported_config.sample_rate().0;
        let native_channels = supported_config.channels();

        let buffer = Arc::new(Mutex::new(Vec::<f32>::with_capacity(
            TARGET_SAMPLE_RATE as usize * 5,
        )));

        let (stream, actual_rate) = if native_rate == TARGET_SAMPLE_RATE && native_channels == 1 {
            // Perfect match — no conversion needed.
            let cfg = cpal::StreamConfig {
                channels: 1,
                sample_rate: cpal::SampleRate(TARGET_SAMPLE_RATE),
                buffer_size: cpal::BufferSize::Default,
            };
            let buf = Arc::clone(&buffer);
            let stream = build_passthrough_stream(&device, &cfg, buf)
                .map_err(|e| format!("Failed to open stream: {}", e))?;
            (stream, TARGET_SAMPLE_RATE)
        } else {
            // Native rate/channels differ from 16kHz mono — resample in real time.
            eprintln!(
                "[audio_capture] Device '{}' native: {}Hz {}ch → resampling to {}Hz mono",
                device_name, native_rate, native_channels, TARGET_SAMPLE_RATE
            );
            let cfg: cpal::StreamConfig = supported_config.into();
            let buf = Arc::clone(&buffer);
            let stream = build_resampling_stream(&device, &cfg, native_channels, native_rate, buf)
                .map_err(|e| format!("Failed to open resampling stream: {}", e))?;
            (stream, native_rate)
        };

        stream
            .play()
            .map_err(|e| format!("Failed to start audio capture: {}", e))?;

        Ok(AudioCapture {
            _stream: stream,
            buffer,
            native_sample_rate: actual_rate,
        })
    }

    /// Drain all accumulated 16kHz mono samples from the buffer.
    pub fn drain(&self) -> Vec<f32> {
        let mut buf = self.buffer.lock().unwrap();
        let samples = buf.clone();
        buf.clear();
        samples
    }

    /// Always returns TARGET_SAMPLE_RATE (16000) — the resampled output rate.
    pub fn sample_rate(&self) -> u32 {
        TARGET_SAMPLE_RATE
    }

    /// The rate at which the hardware is actually capturing (before resampling).
    pub fn native_sample_rate(&self) -> u32 {
        self.native_sample_rate
    }
}

// ── Stream builders ────────────────────────────────────────────────────────

/// Build a 16kHz mono passthrough stream (no resampling required).
fn build_passthrough_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    buffer: Arc<Mutex<Vec<f32>>>,
) -> Result<cpal::Stream, cpal::BuildStreamError> {
    device.build_input_stream(
        config,
        move |data: &[f32], _: &cpal::InputCallbackInfo| {
            let mut buf = buffer.lock().unwrap();
            buf.extend_from_slice(data);
            if buf.len() > MAX_SAMPLES {
                let drain_count = buf.len() - MAX_SAMPLES;
                buf.drain(0..drain_count);
            }
        },
        |err| eprintln!("[audio_capture] Stream error: {}", err),
        None,
    )
}

/// Build a stream that captures at the device's native rate/channels and
/// resamples to 16kHz mono in real time using the rubato 1.x resampler.
///
/// Strategy:
///  1. Audio callback downmixes interleaved multi-channel frames to mono.
///  2. Raw mono samples are pushed into a thread-safe staging ring buffer.
///  3. A dedicated resampling function is called in the callback to drain the
///     staging buffer in fixed-size chunks and write 16kHz output.
fn build_resampling_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    native_channels: u16,
    native_rate: u32,
    output_buffer: Arc<Mutex<Vec<f32>>>,
) -> Result<cpal::Stream, String> {
    // Staging buffer: raw mono samples at native rate, accumulated between callback calls.
    let staging: Arc<Mutex<Vec<f32>>> =
        Arc::new(Mutex::new(Vec::with_capacity(native_rate as usize)));

    // Rubato 1.x: Async<f32> with polynomial interpolation, fixed input size.
    // chunk_size = ~10ms of native-rate audio (one resampling block per callback).
    let chunk_size = (native_rate as usize) / 100; // ~10ms
    let ratio = TARGET_SAMPLE_RATE as f64 / native_rate as f64;

    // new_poly(ratio, max_relative_ratio, degree, chunk_size, channels, fixed_end)
    let resampler = Async::<f32>::new_poly(
        ratio,
        1.0, // fixed ratio — no dynamic adjustment
        PolynomialDegree::Septic,
        chunk_size,
        1, // 1 channel (mono input and output)
        FixedAsync::Input,
    )
    .map_err(|e| format!("Failed to create resampler: {}", e))?;

    let resampler = Arc::new(Mutex::new(resampler));
    let channels = native_channels as usize;

    let stream = device
        .build_input_stream(
            config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                // Step 1: downmix interleaved frames to mono.
                let mono: Vec<f32> = data
                    .chunks_exact(channels)
                    .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                    .collect();

                let mut stage = staging.lock().unwrap();
                stage.extend_from_slice(&mono);

                // Step 2: resample all complete chunks from the staging buffer.
                let mut rs = resampler.lock().unwrap();
                while stage.len() >= chunk_size {
                    // Drain exactly chunk_size mono frames from the staging buffer.
                    let input_chunk: Vec<f32> = stage.drain(0..chunk_size).collect();

                    // Allocate output scratch buffer sized for this chunk's output.
                    let out_frames = rs.output_frames_next();
                    let mut output_scratch = vec![0.0f32; out_frames]; // 1 channel × out_frames

                    // rubato 1.x uses audioadapter buffer types.
                    // InterleavedSlice wraps a flat slice as (channels, frames) interleaved.
                    let input_adapter =
                        InterleavedSlice::new(&input_chunk, 1, chunk_size).unwrap();
                    let mut output_adapter =
                        InterleavedSlice::new_mut(&mut output_scratch, 1, out_frames).unwrap();

                    let indexing = Indexing {
                        input_offset: 0,
                        output_offset: 0,
                        active_channels_mask: None,
                        partial_len: None,
                    };

                    match rs.process_into_buffer(
                        &input_adapter,
                        &mut output_adapter,
                        Some(&indexing),
                    ) {
                        Ok((_in_used, out_written)) => {
                            let mut out = output_buffer.lock().unwrap();
                            out.extend_from_slice(&output_scratch[..out_written]);
                            if out.len() > MAX_SAMPLES {
                                let drain_count = out.len() - MAX_SAMPLES;
                                out.drain(0..drain_count);
                            }
                        }
                        Err(e) => eprintln!("[audio_capture] Resample error: {}", e),
                    }
                }
            },
            |err| eprintln!("[audio_capture] Stream error: {}", err),
            None,
        )
        .map_err(|e| format!("Failed to build resampling stream: {}", e))?;

    Ok(stream)
}

// ── Device listing ─────────────────────────────────────────────────────────

/// List available audio input devices with their supported configurations.
pub fn list_input_devices() -> Vec<AudioDeviceInfo> {
    let host = cpal::default_host();
    let default_name = host
        .default_input_device()
        .and_then(|d| d.name().ok())
        .unwrap_or_default();

    host.input_devices()
        .map(|devices| {
            devices
                .filter_map(|device| {
                    let name = device.name().ok()?;
                    let supported = device.supported_input_configs().ok()?;
                    let mut sample_rates = Vec::new();
                    let mut channels = Vec::new();

                    for config in supported {
                        let min = config.min_sample_rate().0;
                        let max = config.max_sample_rate().0;
                        if !sample_rates.contains(&min) {
                            sample_rates.push(min);
                        }
                        if min != max && !sample_rates.contains(&max) {
                            sample_rates.push(max);
                        }
                        let ch = config.channels();
                        if !channels.contains(&ch) {
                            channels.push(ch);
                        }
                    }

                    sample_rates.sort();
                    channels.sort();

                    Some(AudioDeviceInfo {
                        is_default: name == default_name,
                        name,
                        sample_rates,
                        channels,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}
