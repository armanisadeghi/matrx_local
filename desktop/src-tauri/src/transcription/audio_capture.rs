use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::sync::{Arc, Mutex};

/// Maximum buffer size: ~30 seconds of 16kHz audio.
const MAX_SAMPLES: usize = 16000 * 30;

/// Information about an audio input device.
#[derive(Debug, Clone, Serialize)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
    pub sample_rates: Vec<u32>,
    pub channels: Vec<u16>,
}

/// Captures audio from the microphone in 16kHz mono f32 PCM format.
pub struct AudioCapture {
    _stream: cpal::Stream,
    buffer: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
}

impl AudioCapture {
    /// Start capturing audio from the default input device at 16kHz mono.
    pub fn start() -> Result<Self, String> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or("No audio input device found")?;

        // Try to get 16kHz mono directly
        let config = cpal::StreamConfig {
            channels: 1,
            sample_rate: cpal::SampleRate(16000),
            buffer_size: cpal::BufferSize::Default,
        };

        let sample_rate = config.sample_rate.0;
        let buffer = Arc::new(Mutex::new(Vec::<f32>::with_capacity(16000 * 5)));
        let buffer_clone = Arc::clone(&buffer);

        let stream = device
            .build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let mut buf = buffer_clone.lock().unwrap();
                    buf.extend_from_slice(data);
                    // Keep bounded to avoid unbounded growth
                    if buf.len() > MAX_SAMPLES {
                        let drain_count = buf.len() - MAX_SAMPLES;
                        buf.drain(0..drain_count);
                    }
                },
                |err| eprintln!("Audio capture error: {}", err),
                None,
            )
            .or_else(|_| {
                // Fallback: try the device's default config
                let supported = device
                    .default_input_config()
                    .map_err(|e| format!("No supported input config: {}", e))?;

                let native_config: cpal::StreamConfig = supported.into();
                let buf_clone = Arc::clone(&buffer);

                device
                    .build_input_stream(
                        &native_config,
                        move |data: &[f32], _: &cpal::InputCallbackInfo| {
                            // Note: if native rate != 16kHz, we'll need resampling.
                            // For now, store raw samples — resampling can be added later.
                            let mut buf = buf_clone.lock().unwrap();
                            buf.extend_from_slice(data);
                            if buf.len() > MAX_SAMPLES {
                                let drain_count = buf.len() - MAX_SAMPLES;
                                buf.drain(0..drain_count);
                            }
                        },
                        |err| eprintln!("Audio capture error: {}", err),
                        None,
                    )
                    .map_err(|e| format!("Failed to build audio stream: {}", e))
            })
            .map_err(|e| format!("Failed to build audio stream: {}", e))?;

        stream
            .play()
            .map_err(|e| format!("Failed to start audio capture: {}", e))?;

        Ok(AudioCapture {
            _stream: stream,
            buffer,
            sample_rate,
        })
    }

    /// Drain accumulated audio samples for processing.
    pub fn drain(&self) -> Vec<f32> {
        let mut buf = self.buffer.lock().unwrap();
        let samples = buf.clone();
        buf.clear();
        samples
    }

    /// Get the capture sample rate.
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }
}

/// List available audio input devices.
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
                        if !sample_rates.contains(&max) {
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
