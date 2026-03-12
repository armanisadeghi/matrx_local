use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use whisper_cpp_plus::TranscriptionParams;

use super::{
    audio_capture, config::TranscriptionConfig, downloader, hardware::HardwareProfile,
    manager::TranscriptionManager, model_selector,
};

/// Tauri-managed state holding the active transcription context.
pub struct TranscriptionState(pub Mutex<Option<TranscriptionManager>>);

/// Tauri-managed state for active recording session.
pub struct RecordingState(pub std::sync::Arc<Mutex<bool>>);

// ── Hardware Detection ─────────────────────────────────────────────────────

/// Detect hardware capabilities and return a model recommendation.
#[tauri::command]
pub async fn detect_hardware() -> Result<serde_json::Value, String> {
    let hw = HardwareProfile::detect();
    let selection = model_selector::select_model(&hw, None);
    let can_upgrade = model_selector::should_offer_upgrade(&hw, &selection.tier);

    // Get info for all tiers so the frontend can display options
    let all_models: Vec<serde_json::Value> = model_selector::MODELS
        .iter()
        .map(|m| {
            serde_json::json!({
                "tier": m.tier,
                "filename": m.filename,
                "download_size_mb": m.download_size_mb,
                "ram_required_mb": m.ram_required_mb,
                "relative_speed": m.relative_speed,
                "accuracy": m.accuracy,
                "description": m.description,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "hardware": hw,
        "recommended_tier": selection.tier,
        "recommended_filename": selection.filename,
        "recommended_size_mb": selection.download_size_mb,
        "reason": selection.reason,
        "can_upgrade": can_upgrade,
        "all_models": all_models,
    }))
}

// ── Model Download ─────────────────────────────────────────────────────────

/// Download a Whisper model with live progress events.
/// Emits "whisper-download-progress" events to the frontend.
#[tauri::command]
pub async fn download_whisper_model(app: AppHandle, filename: String) -> Result<String, String> {
    let models_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");

    let app_clone = app.clone();
    let fname = filename.clone();
    let dest = downloader::download_model(&fname, &models_dir, move |progress| {
        let _ = app_clone.emit(
            "whisper-download-progress",
            serde_json::json!({
                "filename": progress.filename,
                "bytes_downloaded": progress.bytes_downloaded,
                "total_bytes": progress.total_bytes,
                "percent": progress.percent,
            }),
        );
    })
    .await?;

    Ok(dest.to_string_lossy().to_string())
}

/// Download the VAD model required for streaming transcription.
#[tauri::command]
pub async fn download_vad_model(app: AppHandle) -> Result<String, String> {
    let models_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");

    let app_clone = app.clone();
    let dest = downloader::download_model(
        downloader::VAD_MODEL_FILENAME,
        &models_dir,
        move |progress| {
            let _ = app_clone.emit(
                "whisper-download-progress",
                serde_json::json!({
                    "filename": progress.filename,
                    "bytes_downloaded": progress.bytes_downloaded,
                    "total_bytes": progress.total_bytes,
                    "percent": progress.percent,
                }),
            );
        },
    )
    .await?;

    Ok(dest.to_string_lossy().to_string())
}

// ── Model Management ───────────────────────────────────────────────────────

/// Initialize the transcription context with a specific model.
/// Called after download or on app startup with a cached model.
#[tauri::command]
pub async fn init_transcription(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    filename: String,
) -> Result<(), String> {
    let model_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models")
        .join(&filename);

    if !model_path.exists() {
        return Err(format!("Model not found: {:?}", model_path));
    }

    let manager = tokio::task::spawn_blocking(move || TranscriptionManager::load(model_path))
        .await
        .map_err(|e| e.to_string())??;

    *state.0.lock().unwrap() = Some(manager);

    // Save selection to config
    let config_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let config = TranscriptionConfig {
        selected_model: Some(filename),
        setup_complete: true,
    };
    config.save(&config_dir)?;

    Ok(())
}

/// Check if a model file exists and is valid.
#[tauri::command]
pub fn check_model_exists(app: AppHandle, filename: String) -> bool {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("models").join(&filename))
        .map(|p| downloader::is_valid_model(&p))
        .unwrap_or(false)
}

/// Get the currently active model filename.
#[tauri::command]
pub fn get_active_model(state: State<'_, TranscriptionState>) -> Option<String> {
    state.0.lock().unwrap().as_ref().map(|m| {
        m.model_path()
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string()
    })
}

/// List all downloaded models in the models directory.
#[tauri::command]
pub fn list_downloaded_models(app: AppHandle) -> Vec<String> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| downloader::list_downloaded_models(&d.join("models")))
        .unwrap_or_default()
}

/// Delete a downloaded model file.
#[tauri::command]
pub async fn delete_model(app: AppHandle, filename: String) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models")
        .join(&filename);

    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Failed to delete model: {}", e))?;
    }
    Ok(())
}

// ── Transcription ──────────────────────────────────────────────────────────

/// Start real-time microphone transcription.
/// Emits "whisper-segment" events with transcription results.
/// Emits "whisper-error" on failure.
///
/// `device_name`: optional CoreAudio/CPAL device name to use. When omitted the
/// system default input device is used.
#[tauri::command]
pub async fn start_transcription(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    recording: State<'_, RecordingState>,
    device_name: Option<String>,
) -> Result<(), String> {
    // Check if already recording
    {
        let is_recording = recording.0.lock().unwrap();
        if *is_recording {
            return Err("Already recording".to_string());
        }
    }

    // On macOS, verify microphone TCC permission before opening the audio
    // stream. CPAL silently delivers silence when permission is denied on
    // signed builds, making it impossible to surface the error from the audio
    // callback. Checking here gives us a clear, actionable error up front.
    #[cfg(target_os = "macos")]
    {
        let mic_granted = tauri_plugin_macos_permissions::check_microphone_permission().await;
        if !mic_granted {
            let msg = "Microphone permission not granted. Open System Settings → Privacy & Security → Microphone and enable access for Matrx Local.";
            let _ = app.emit("whisper-error", msg);
            return Err("microphone_permission_denied".to_string());
        }
    }

    // Get thread count from hardware — use up to half the CPUs, capped at 8
    let hw = HardwareProfile::detect();
    let n_threads = (hw.cpu_threads / 2).max(1).min(8) as i32;

    // Clone the context arc before entering the spawned thread
    let manager_guard = state.0.lock().unwrap();
    let manager = manager_guard
        .as_ref()
        .ok_or("Transcription not initialized — call init_transcription first")?;
    let ctx = manager.context().clone();

    // Mark as recording before spawning so the flag is set synchronously
    *recording.0.lock().unwrap() = true;

    let app_events = app.clone();
    let recording_flag = app.state::<RecordingState>().0.clone();

    // AudioCapture holds a cpal::Stream which is !Send, so we run the entire
    // capture + inference loop on a dedicated OS thread.
    std::thread::spawn(move || {
        // Start audio capture — always returns 16kHz mono after internal resampling
        let capture = match audio_capture::AudioCapture::start_with_device(
            device_name.as_deref()
        ) {
            Ok(c) => c,
            Err(e) => {
                let _ = app_events.emit("whisper-error", e);
                *recording_flag.lock().unwrap() = false;
                return;
            }
        };

        // Whisper works best on 5-second chunks — long enough for sentence context,
        // short enough for responsive output.
        let sample_rate = capture.sample_rate(); // always 16000 after resampling
        let target_samples = sample_rate as usize * 5; // 5 seconds

        // Silence gate: skip Whisper on truly silent chunks to avoid hallucinations.
        //
        // The threshold is adaptive: we measure the first 2 seconds of audio (the
        // "floor") and set the gate at 10× that floor.  This handles the wide range
        // of device gain levels — AirPods at 24kHz deliver ~0.0001 floor, while a
        // USB desk mic at 44.1kHz delivers ~0.001 floor.  10× gives headroom without
        // letting clear-silence chunks through.
        //
        // We also keep a hard minimum (0.00001) so the gate fires on dead-silent
        // streams (permission denied / muted) rather than transcribing noise.
        let mut silence_threshold: f32 = 0.00010; // starting value; adapted below
        let mut floor_samples: Vec<f32> = Vec::with_capacity(sample_rate as usize * 2);
        let mut floor_calibrated = false;
        let mut loop_ticks: u32 = 0;

        let mut accumulated = Vec::<f32>::with_capacity(target_samples + 4096);

        loop {
            if !*recording_flag.lock().unwrap() {
                break;
            }

            let samples = capture.drain();
            if !samples.is_empty() {
                accumulated.extend_from_slice(&samples);

                // Calibrate silence threshold from the first 2s of audio.
                // We collect raw samples before speech starts, compute their RMS,
                // and use 10× that as the gate.  This fires once on first startup.
                if !floor_calibrated {
                    floor_samples.extend_from_slice(&samples);
                    if floor_samples.len() >= sample_rate as usize * 2 {
                        let floor_rms = rms_energy(&floor_samples);
                        // 10× floor, clamped to [0.00001, 0.001]
                        silence_threshold = (floor_rms * 10.0).clamp(0.00001, 0.001);
                        floor_calibrated = true;
                        let _ = app_events.emit(
                            "whisper-calibrated",
                            serde_json::json!({
                                "floor_rms": floor_rms,
                                "threshold": silence_threshold,
                            }),
                        );
                    }
                }

                // Emit live RMS every ~250ms for the UI audio meter (every 5 loop ticks at 50ms each).
                let recent = accumulated.len().min(sample_rate as usize / 4);
                if recent > 0 && loop_ticks % 5 == 0 {
                    let rms_live = rms_energy(&accumulated[accumulated.len() - recent..]);
                    let _ = app_events.emit("whisper-rms", rms_live);
                }
            }

            loop_ticks += 1;

            if accumulated.len() >= target_samples {
                let audio_chunk = accumulated.drain(0..target_samples).collect::<Vec<f32>>();

                // Gate on RMS energy — skip Whisper for silent/near-silent chunks to
                // prevent hallucinated output ("Thanks for watching", "you", etc.)
                let rms = rms_energy(&audio_chunk);
                if rms < silence_threshold {
                    continue;
                }

                let params = TranscriptionParams::builder()
                    .language("en")
                    .n_threads(n_threads)
                    .build();

                match ctx.transcribe_with_params(&audio_chunk, params) {
                    Ok(transcription) => {
                        for seg in &transcription.segments {
                            let text = seg.text.trim().to_string();
                            // Skip empty and common hallucination strings
                            if text.is_empty() || is_hallucination(&text) {
                                continue;
                            }
                            let _ = app_events.emit(
                                "whisper-segment",
                                serde_json::json!({
                                    "text": text,
                                    "start_sec": seg.start_seconds(),
                                    "end_sec": seg.end_seconds(),
                                }),
                            );
                        }
                    }
                    Err(e) => {
                        let _ =
                            app_events.emit("whisper-error", format!("Transcription error: {}", e));
                    }
                }
            }

            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        *recording_flag.lock().unwrap() = false;
    });

    Ok(())
}

/// Root-mean-square energy of an audio buffer.
fn rms_energy(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}

/// Common Whisper hallucination strings emitted when fed silence or noise.
fn is_hallucination(text: &str) -> bool {
    const HALLUCINATIONS: &[&str] = &[
        "thanks for watching",
        "thank you for watching",
        "please subscribe",
        "like and subscribe",
        "you",
        ".",
        "...",
        "[music]",
        "[applause]",
        "(music)",
    ];
    let lower = text.to_lowercase();
    HALLUCINATIONS.iter().any(|h| lower == *h)
}

/// Stop the active transcription session.
#[tauri::command]
pub async fn stop_transcription(recording: State<'_, RecordingState>) -> Result<(), String> {
    *recording.0.lock().unwrap() = false;
    Ok(())
}

// ── Audio Devices ──────────────────────────────────────────────────────────

/// List available audio input devices.
#[tauri::command]
pub fn list_audio_input_devices() -> Vec<audio_capture::AudioDeviceInfo> {
    audio_capture::list_input_devices()
}

// ── Setup Status ───────────────────────────────────────────────────────────

/// Check if voice setup has been completed (model downloaded and configured).
#[tauri::command]
pub fn get_voice_setup_status(app: AppHandle) -> serde_json::Value {
    let config_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => {
            return serde_json::json!({
                "setup_complete": false,
                "selected_model": null,
                "downloaded_models": [],
            })
        }
    };

    let config = TranscriptionConfig::load(&config_dir);
    let downloaded = downloader::list_downloaded_models(&config_dir.join("models"));

    serde_json::json!({
        "setup_complete": config.setup_complete,
        "selected_model": config.selected_model,
        "downloaded_models": downloaded,
    })
}
