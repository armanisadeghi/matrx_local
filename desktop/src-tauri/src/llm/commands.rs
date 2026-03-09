use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

use super::config::LlmConfig;
use super::model_selector;
use super::server::{find_free_port, LlmServer, LlmServerStatus};
use crate::transcription::hardware::HardwareProfile;

/// Tauri-managed state for the LLM server process.
pub type LlmServerState = Arc<Mutex<LlmServer>>;

// ── Server Lifecycle ──────────────────────────────────────────────────────

/// Start or restart llama-server with the selected model.
#[tauri::command]
pub async fn start_llm_server(
    app: AppHandle,
    state: State<'_, LlmServerState>,
    model_filename: String,
    gpu_layers: i32,
    context_length: Option<u32>,
) -> Result<LlmServerStatus, String> {
    let model_path = resolve_model_path(&app, &model_filename)?;

    if !std::path::Path::new(&model_path).exists() {
        return Err(format!(
            "Model file not found: {}. Download it first.",
            model_filename
        ));
    }

    let port = find_free_port(11434)?;
    let ctx = context_length.unwrap_or(8192);

    let mut server = state.lock().await;
    server.start(&app, &model_path, gpu_layers, ctx, port).await?;

    // Persist config
    if let Ok(config_dir) = app.path().app_data_dir() {
        let config = LlmConfig {
            selected_model: Some(model_filename),
            setup_complete: true,
            last_port: Some(port),
        };
        let _ = config.save(&config_dir);
    }

    let _ = app.emit("llm-server-ready", &server.status);
    Ok(server.status.clone())
}

/// Stop the running llama-server.
#[tauri::command]
pub async fn stop_llm_server(
    app: AppHandle,
    state: State<'_, LlmServerState>,
) -> Result<(), String> {
    let mut server = state.lock().await;
    server.stop().await;
    let _ = app.emit("llm-server-stopped", ());
    Ok(())
}

/// Get the current server status (running, port, model name).
#[tauri::command]
pub async fn get_llm_server_status(
    state: State<'_, LlmServerState>,
) -> Result<LlmServerStatus, String> {
    let server = state.lock().await;
    Ok(server.status.clone())
}

/// Run a health check against the running server.
#[tauri::command]
pub async fn check_llm_server_health(
    state: State<'_, LlmServerState>,
) -> Result<bool, String> {
    let server = state.lock().await;
    Ok(server.health_check().await)
}

// ── Model Management ──────────────────────────────────────────────────────

/// Check if a model file exists in local storage.
#[tauri::command]
pub fn check_llm_model_exists(app: AppHandle, filename: String) -> bool {
    resolve_model_path(&app, &filename)
        .ok()
        .map(|p| std::path::Path::new(&p).exists())
        .unwrap_or(false)
}

/// Download an LLM model from HuggingFace with progress events.
/// Emits "llm-download-progress" events with { filename, bytes_downloaded, total_bytes, percent }.
#[tauri::command]
pub async fn download_llm_model(
    app: AppHandle,
    filename: String,
    url: String,
) -> Result<String, String> {
    let dest_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");

    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create models dir: {}", e))?;

    let dest_path = dest_dir.join(&filename);

    // Skip if already downloaded and valid
    if is_valid_gguf(&dest_path) {
        return Ok(dest_path.to_string_lossy().to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| e.to_string())?;

    // Retry up to 3 times with exponential backoff
    let mut last_error = String::new();
    for attempt in 0..3u32 {
        if attempt > 0 {
            let delay = std::time::Duration::from_secs(2u64.pow(attempt));
            tokio::time::sleep(delay).await;
        }

        match try_download_llm(&client, &url, &dest_path, &filename, &app).await {
            Ok(_) => {
                if is_valid_gguf(&dest_path) {
                    return Ok(dest_path.to_string_lossy().to_string());
                }
                last_error = "Downloaded file failed GGUF validation".to_string();
                let _ = tokio::fs::remove_file(&dest_path).await;
            }
            Err(e) => {
                last_error = format!("Attempt {}: {}", attempt + 1, e);
                let _ = tokio::fs::remove_file(&dest_path).await;
            }
        }
    }

    Err(format!(
        "Download failed after 3 attempts. Last error: {}",
        last_error
    ))
}

/// List all downloaded LLM models (GGUF files) in the models directory.
#[tauri::command]
pub fn list_llm_models(app: AppHandle) -> Vec<serde_json::Value> {
    let models_dir = match app.path().app_data_dir() {
        Ok(d) => d.join("models"),
        Err(_) => return Vec::new(),
    };

    if !models_dir.exists() {
        return Vec::new();
    }

    std::fs::read_dir(&models_dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.path()
                        .extension()
                        .map(|ext| ext == "gguf")
                        .unwrap_or(false)
                })
                .filter(|e| is_valid_gguf(&e.path()))
                .filter_map(|e| {
                    let fname = e.file_name().into_string().ok()?;
                    let size_bytes = e.metadata().ok()?.len();
                    let size_gb = size_bytes as f64 / (1024.0 * 1024.0 * 1024.0);

                    // Try to match to a known model from the catalog
                    let catalog_info = model_selector::LLM_MODELS
                        .iter()
                        .find(|m| m.filename == fname);

                    Some(serde_json::json!({
                        "filename": fname,
                        "size_bytes": size_bytes,
                        "size_gb": format!("{:.1}", size_gb),
                        "name": catalog_info.map(|m| m.name).unwrap_or("Unknown"),
                        "tier": catalog_info.map(|m| &m.tier),
                    }))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Delete a downloaded LLM model file.
#[tauri::command]
pub async fn delete_llm_model(
    app: AppHandle,
    state: State<'_, LlmServerState>,
    filename: String,
) -> Result<(), String> {
    // If this model is currently loaded, stop the server first
    {
        let mut server = state.lock().await;
        if server.status.running && server.status.model_name == extract_stem(&filename) {
            server.stop().await;
        }
    }

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

// ── Hardware & Recommendations ────────────────────────────────────────────

/// Detect hardware and return LLM model recommendation.
/// Reuses HardwareProfile from the transcription module.
#[tauri::command]
pub async fn detect_llm_hardware() -> Result<serde_json::Value, String> {
    let hw = HardwareProfile::detect();
    let selection = model_selector::select_llm_model(&hw);

    let all_models: Vec<serde_json::Value> = model_selector::LLM_MODELS
        .iter()
        .map(|m| {
            serde_json::json!({
                "tier": m.tier,
                "name": m.name,
                "filename": m.filename,
                "disk_size_gb": m.disk_size_gb,
                "ram_required_gb": m.ram_required_gb,
                "tool_calling_rating": m.tool_calling_rating,
                "speed": m.speed,
                "description": m.description,
                "hf_url": m.hf_url,
                "context_length": m.context_length,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "hardware": hw,
        "recommended_tier": selection.tier,
        "recommended_filename": selection.filename,
        "recommended_name": selection.name,
        "recommended_size_gb": selection.disk_size_gb,
        "recommended_gpu_layers": selection.gpu_layers,
        "reason": selection.reason,
        "can_upgrade": selection.can_upgrade,
        "all_models": all_models,
    }))
}

/// Get the LLM setup status (config + what's downloaded).
#[tauri::command]
pub async fn get_llm_setup_status(
    app: AppHandle,
    state: State<'_, LlmServerState>,
) -> Result<serde_json::Value, String> {
    let config_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let config = LlmConfig::load(&config_dir);

    let server = state.lock().await;
    let server_status = server.status.clone();
    drop(server);

    let downloaded = list_llm_models_internal(&app);

    Ok(serde_json::json!({
        "setup_complete": config.setup_complete,
        "selected_model": config.selected_model,
        "server_running": server_status.running,
        "server_port": server_status.port,
        "server_model": server_status.model_name,
        "downloaded_models": downloaded,
    }))
}

// ── Internal Helpers ──────────────────────────────────────────────────────

fn resolve_model_path(app: &AppHandle, filename: &str) -> Result<String, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models")
        .join(filename);
    Ok(path.to_string_lossy().to_string())
}

/// Validate that a file is a valid GGUF model (magic bytes: GGUF = 0x47475546).
fn is_valid_gguf(path: &std::path::Path) -> bool {
    if !path.exists() {
        return false;
    }
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    // GGUF models should be at least 10MB
    if meta.len() < 10_000_000 {
        return false;
    }
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut magic = [0u8; 4];
    use std::io::Read;
    if file.read_exact(&mut magic).is_err() {
        return false;
    }
    // GGUF magic: "GGUF" in ASCII = 0x47 0x47 0x55 0x46
    magic == [0x47, 0x47, 0x55, 0x46]
}

fn extract_stem(filename: &str) -> String {
    std::path::Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string()
}

async fn try_download_llm(
    client: &reqwest::Client,
    url: &str,
    dest: &std::path::Path,
    filename: &str,
    app: &AppHandle,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let response = client.get(url).send().await.map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        let _ = app.emit(
            "llm-download-progress",
            serde_json::json!({
                "filename": filename,
                "bytes_downloaded": downloaded,
                "total_bytes": total,
                "percent": if total > 0 {
                    (downloaded as f32 / total as f32) * 100.0
                } else {
                    0.0
                },
            }),
        );
    }

    file.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

fn list_llm_models_internal(app: &AppHandle) -> Vec<String> {
    let models_dir = match app.path().app_data_dir() {
        Ok(d) => d.join("models"),
        Err(_) => return Vec::new(),
    };
    if !models_dir.exists() {
        return Vec::new();
    }
    std::fs::read_dir(&models_dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.path()
                        .extension()
                        .map(|ext| ext == "gguf")
                        .unwrap_or(false)
                })
                .filter(|e| is_valid_gguf(&e.path()))
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default()
}
