use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rubato::{FastFixedIn, PolynomialDegree, Resampler};
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

        // Decide whether to request 16kHz directly or use native rate + resample.
        let (stream, actual_rate) = if native_rate == TARGET_SAMPLE_RATE && native_channels == 1 {
            // Perfect match — no conversion needed.
            let cfg = cpal::StreamConfig {
                channels: 1,
                sample_rate: cpal::SampleRate(TARGET_SAMPLE_RATE),
                buffer_size: cpal::BufferSize::Default,
            };
            let buf = Arc::clone(&buffer);
            let stream = build_mono_passthrough_stream(&device, &cfg, buf)
                .map_err(|e| format!("Failed to open stream: {}", e))?;
            (stream, TARGET_SAMPLE_RATE)
        } else {
            // Native rate/channels differ from 16kHz mono — use resampling pipeline.
            eprintln!(
                "[audio_capture] Device '{}' native: {}Hz {}ch → resampling to {}Hz mono",
                device_name, native_rate, native_channels, TARGET_SAMPLE_RATE
            );

            let cfg: cpal::StreamConfig = supported_config.into();
            let buf = Arc::clone(&buffer);
            let stream = build_resampling_stream(&device, &cfg, native_channels, native_rate, buf)
                .map_err(|e| format!("Failed to open stream with resampling: {}", e))?;
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
fn build_mono_passthrough_stream(
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
/// resamples to 16kHz mono in real time using the rubato resampler.
fn build_resampling_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    native_channels: u16,
    native_rate: u32,
    output_buffer: Arc<Mutex<Vec<f32>>>,
) -> Result<cpal::Stream, String> {
    // Ring buffer for raw samples before resampling (held across callbacks).
    let raw: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::with_capacity(native_rate as usize)));

    // Rubato resampler: FastFixedIn processes fixed-size input chunks.
    // chunk_size = ~10ms at native rate, giving low latency.
    let chunk_size = (native_rate as usize) / 100; // ~10ms
    let ratio = TARGET_SAMPLE_RATE as f64 / native_rate as f64;

    let resampler = FastFixedIn::<f32>::new(
        ratio,
        1.0, // max_resample_ratio_relative (no dynamic rate changes)
        PolynomialDegree::Septic,
        chunk_size,
        1, // mono output
    )
    .map_err(|e| format!("Failed to create resampler: {}", e))?;

    let resampler = Arc::new(Mutex::new(resampler));
    let channels = native_channels as usize;

    let stream = device
        .build_input_stream(
            config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                // Step 1: Downmix to mono by averaging all channels.
                let mono: Vec<f32> = data
                    .chunks_exact(channels)
                    .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                    .collect();

                let mut raw_buf = raw.lock().unwrap();
                raw_buf.extend_from_slice(&mono);

                // Step 2: Resample in chunk_size blocks.
                let mut rs = resampler.lock().unwrap();
                while raw_buf.len() >= chunk_size {
                    let input_chunk: Vec<f32> = raw_buf.drain(0..chunk_size).collect();
                    match rs.process(&[input_chunk], None) {
                        Ok(resampled_channels) => {
                            let resampled = &resampled_channels[0];
                            let mut out = output_buffer.lock().unwrap();
                            out.extend_from_slice(resampled);
                            // Keep output buffer bounded.
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
