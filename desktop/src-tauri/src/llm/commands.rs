use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

use super::config::LlmConfig;
use super::model_selector;
use super::server::{find_free_port, LlmServer, LlmServerStatus};
use crate::transcription::hardware::HardwareProfile;

/// Tauri-managed state for the LLM server process.
pub type LlmServerState = Arc<Mutex<LlmServer>>;

/// Shared atomic flag used to request cancellation of an in-flight download.
/// Set to true by `cancel_llm_download`; reset to false at the start of each
/// new `download_llm_model` invocation.
pub type LlmDownloadCancelState = Arc<AtomicBool>;

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
    server
        .start(&app, &model_path, gpu_layers, ctx, port)
        .await?;

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
pub async fn check_llm_server_health(state: State<'_, LlmServerState>) -> Result<bool, String> {
    let server = state.lock().await;
    Ok(server.health_check().await)
}

// ── Model Management ──────────────────────────────────────────────────────

/// Check if a model file exists in local storage AND passes size validation.
#[tauri::command]
pub fn check_llm_model_exists(app: AppHandle, filename: String) -> bool {
    let path = match resolve_model_path(&app, &filename) {
        Ok(p) => std::path::PathBuf::from(p),
        Err(_) => return false,
    };
    // Look up expected size from catalog for strict validation
    let expected = model_selector::LLM_MODELS
        .iter()
        .find(|m| m.filename == filename)
        .map(|m| m.expected_size_bytes);
    is_valid_gguf(&path, expected)
}

/// Cancel an in-flight download. Safe to call at any time; no-op if nothing is downloading.
#[tauri::command]
pub fn cancel_llm_download(
    app: AppHandle,
    cancel: State<'_, LlmDownloadCancelState>,
) -> Result<(), String> {
    cancel.store(true, Ordering::SeqCst);
    let _ = app.emit("llm-download-cancelled", serde_json::json!({ "reason": "user_cancelled" }));
    Ok(())
}

/// Download an LLM model from HuggingFace with progress events.
///
/// For single-file models, pass `urls` with a single entry.
/// For split models (e.g. Qwen2.5-14B), pass all part URLs in order — they will be
/// downloaded sequentially and concatenated into a single `filename` file.
///
/// Features:
///   - Per-chunk 60-second idle timeout to detect stalled connections
///   - Cancellation via the `LlmDownloadCancelState` atomic flag
///   - Expected-size validation to reject partial/corrupted files
///   - 3-attempt retry with exponential backoff per part
///
/// Emits "llm-download-progress" events:
///   { filename, part, total_parts, bytes_downloaded, total_bytes, percent }
/// Emits "llm-download-cancelled" on cancellation.
#[tauri::command]
pub async fn download_llm_model(
    app: AppHandle,
    filename: String,
    urls: Vec<String>,
    cancel: State<'_, LlmDownloadCancelState>,
) -> Result<String, String> {
    if urls.is_empty() {
        return Err("No download URLs provided".to_string());
    }

    // Reset cancel flag at the start of every new download
    cancel.store(false, Ordering::SeqCst);

    let dest_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");

    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create models dir: {}", e))?;

    let dest_path = dest_dir.join(&filename);

    // Look up expected size from catalog for validation
    let expected_size = model_selector::LLM_MODELS
        .iter()
        .find(|m| m.filename == filename)
        .map(|m| m.expected_size_bytes);

    // Skip if already downloaded and fully valid (size-checked)
    if is_valid_gguf(&dest_path, expected_size) {
        let _ = app.emit(
            "llm-download-progress",
            serde_json::json!({
                "filename": filename,
                "part": 1,
                "total_parts": 1,
                "part_bytes_downloaded": expected_size.unwrap_or(0),
                "part_total_bytes": expected_size.unwrap_or(0),
                "bytes_downloaded": expected_size.unwrap_or(0),
                "total_bytes": expected_size.unwrap_or(0),
                "percent": 100.0,
                "status": "already_complete",
            }),
        );
        return Ok(dest_path.to_string_lossy().to_string());
    }

    // If there's a partial file that failed magic/size check, remove it before starting
    if dest_path.exists() {
        let _ = tokio::fs::remove_file(&dest_path).await;
    }

    let cancel_ref = cancel.inner().clone();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(7200))
        .build()
        .map_err(|e| e.to_string())?;

    let total_parts = urls.len();

    if total_parts == 1 {
        let url = &urls[0];
        let mut last_error = String::new();
        for attempt in 0..3u32 {
            if cancel_ref.load(Ordering::SeqCst) {
                return Err("Download cancelled by user".to_string());
            }
            if attempt > 0 {
                tokio::time::sleep(std::time::Duration::from_secs(2u64.pow(attempt))).await;
            }
            match try_download_part(
                &client,
                url,
                &dest_path,
                &filename,
                1,
                1,
                0,
                0,
                &app,
                &cancel_ref,
            )
            .await
            {
                Ok(_) => {
                    if is_valid_gguf(&dest_path, expected_size) {
                        return Ok(dest_path.to_string_lossy().to_string());
                    }
                    last_error = format!(
                        "Downloaded file failed validation (size mismatch or bad magic bytes)"
                    );
                    let _ = tokio::fs::remove_file(&dest_path).await;
                }
                Err(e) if e.contains("cancelled") => {
                    let _ = tokio::fs::remove_file(&dest_path).await;
                    return Err("Download cancelled by user".to_string());
                }
                Err(e) => {
                    last_error = format!("Attempt {}: {}", attempt + 1, e);
                    let _ = tokio::fs::remove_file(&dest_path).await;
                }
            }
        }
        return Err(format!(
            "Download failed after 3 attempts. Last error: {}",
            last_error
        ));
    }

    // Multi-part: probe total sizes first for accurate overall progress
    let mut part_sizes: Vec<u64> = Vec::with_capacity(total_parts);
    for url in &urls {
        if cancel_ref.load(Ordering::SeqCst) {
            return Err("Download cancelled by user".to_string());
        }
        let size = probe_content_length(&client, url).await.unwrap_or(0);
        part_sizes.push(size);
    }
    let grand_total: u64 = part_sizes.iter().sum();

    // Clean up any previous partial assembly
    let _ = tokio::fs::remove_file(&dest_path).await;

    let mut bytes_before_this_part: u64 = 0;
    for (i, url) in urls.iter().enumerate() {
        if cancel_ref.load(Ordering::SeqCst) {
            let _ = tokio::fs::remove_file(&dest_path).await;
            return Err("Download cancelled by user".to_string());
        }

        let part_num = i + 1;
        let part_filename = format!("{}.part{}", filename, part_num);
        let part_path = dest_dir.join(&part_filename);

        let mut last_error = String::new();
        let mut success = false;

        for attempt in 0..3u32 {
            if cancel_ref.load(Ordering::SeqCst) {
                let _ = tokio::fs::remove_file(&part_path).await;
                let _ = tokio::fs::remove_file(&dest_path).await;
                return Err("Download cancelled by user".to_string());
            }
            if attempt > 0 {
                tokio::time::sleep(std::time::Duration::from_secs(2u64.pow(attempt))).await;
            }
            let _ = tokio::fs::remove_file(&part_path).await;

            match try_download_part(
                &client,
                url,
                &part_path,
                &filename,
                part_num,
                total_parts,
                bytes_before_this_part,
                grand_total,
                &app,
                &cancel_ref,
            )
            .await
            {
                Ok(_) => {
                    success = true;
                    break;
                }
                Err(e) if e.contains("cancelled") => {
                    let _ = tokio::fs::remove_file(&part_path).await;
                    let _ = tokio::fs::remove_file(&dest_path).await;
                    return Err("Download cancelled by user".to_string());
                }
                Err(e) => {
                    last_error = format!("Part {} attempt {}: {}", part_num, attempt + 1, e);
                    let _ = tokio::fs::remove_file(&part_path).await;
                }
            }
        }

        if !success {
            let _ = tokio::fs::remove_file(&dest_path).await;
            return Err(format!(
                "Failed to download part {}/{}: {}",
                part_num, total_parts, last_error
            ));
        }

        // Append this part to the final destination file
        append_file(&part_path, &dest_path)
            .await
            .map_err(|e| format!("Failed to append part {} to output file: {}", part_num, e))?;

        // Remove the temp part file immediately to free disk space
        let _ = tokio::fs::remove_file(&part_path).await;

        bytes_before_this_part += part_sizes[i];
    }

    if is_valid_gguf(&dest_path, expected_size) {
        Ok(dest_path.to_string_lossy().to_string())
    } else {
        let actual_size = std::fs::metadata(&dest_path).map(|m| m.len()).unwrap_or(0);
        let _ = tokio::fs::remove_file(&dest_path).await;
        Err(format!(
            "Assembly complete but file failed validation. Got {} bytes, expected ~{} bytes.",
            actual_size,
            expected_size.unwrap_or(0)
        ))
    }
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
                .filter_map(|e| {
                    let path = e.path();
                    let fname = e.file_name().into_string().ok()?;
                    let size_bytes = e.metadata().ok()?.len();

                    // Look up catalog info and expected size
                    let catalog_info = model_selector::LLM_MODELS
                        .iter()
                        .find(|m| m.filename == fname);
                    let expected = catalog_info.map(|m| m.expected_size_bytes);

                    // Only list files that pass full GGUF + size validation
                    if !is_valid_gguf(&path, expected) {
                        return None;
                    }

                    let size_gb = size_bytes as f64 / (1024.0 * 1024.0 * 1024.0);
                    Some(serde_json::json!({
                        "filename": fname,
                        "size_bytes": size_bytes,
                        "size_gb": format!("{:.1}", size_gb),
                        "name": catalog_info.map(|m| m.name).unwrap_or("Custom Model"),
                        "tier": catalog_info.map(|m| &m.tier),
                        "is_custom": catalog_info.is_none(),
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

    // Also clean up any leftover .partN temp files for this model
    let models_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    for i in 1..=10 {
        let part = models_dir.join(format!("{}.part{}", filename, i));
        let _ = std::fs::remove_file(&part);
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
                "hf_parts": m.hf_parts,
                "is_split": m.is_split(),
                "all_part_urls": m.all_part_urls(),
                "context_length": m.context_length,
                "expected_size_bytes": m.expected_size_bytes,
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

/// Validate that a file is a fully-downloaded, valid GGUF model.
///
/// Checks:
///   1. File exists and is at least 10 MB
///   2. Magic bytes match "GGUF" (0x47 0x47 0x55 0x46)
///   3. If `expected_bytes` is provided, actual size must be ≥ 95% of expected
///      (5% tolerance for metadata differences between catalog measurements and reality)
fn is_valid_gguf(path: &std::path::Path, expected_bytes: Option<u64>) -> bool {
    if !path.exists() {
        return false;
    }
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    let actual_size = meta.len();

    // Minimum sanity check — all real models are much larger than this
    if actual_size < 10_000_000 {
        return false;
    }

    // Size validation against expected — catches partial assemblies
    if let Some(expected) = expected_bytes {
        if expected > 0 {
            let min_acceptable = (expected as f64 * 0.95) as u64;
            if actual_size < min_acceptable {
                return false;
            }
        }
    }

    // Magic bytes check
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut magic = [0u8; 4];
    use std::io::Read;
    if file.read_exact(&mut magic).is_err() {
        return false;
    }
    magic == [0x47, 0x47, 0x55, 0x46]
}

fn extract_stem(filename: &str) -> String {
    std::path::Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string()
}

/// Probe the content-length of a URL without downloading it.
async fn probe_content_length(client: &reqwest::Client, url: &str) -> Option<u64> {
    let resp = client
        .head(url)
        .header("User-Agent", "matrx-local/1.0")
        .send()
        .await
        .ok()?;
    if let Some(len) = resp.content_length() {
        if len > 0 {
            return Some(len);
        }
    }
    // HuggingFace puts the real LFS size in x-linked-size
    resp.headers()
        .get("x-linked-size")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
}

/// Download a single URL into `dest` with:
///   - A 60-second per-chunk idle timeout (stall detection)
///   - Cancellation checks on every progress event
///   - Accurate overall-progress reporting for multi-part downloads
#[allow(clippy::too_many_arguments)]
async fn try_download_part(
    client: &reqwest::Client,
    url: &str,
    dest: &std::path::Path,
    filename: &str,
    part: usize,
    total_parts: usize,
    bytes_before: u64,
    grand_total: u64,
    app: &AppHandle,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let response = client
        .get(url)
        .header("User-Agent", "matrx-local/1.0")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {} for {}", response.status(), url));
    }

    let part_total = response.content_length().unwrap_or(0);
    let mut part_downloaded: u64 = 0;

    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();

    // 60-second idle timeout: if no chunk arrives in this window, treat as stall
    let idle_timeout = std::time::Duration::from_secs(60);

    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = file.flush().await;
            return Err("cancelled: user requested cancellation".to_string());
        }

        let chunk_result = tokio::time::timeout(idle_timeout, stream.next()).await;

        match chunk_result {
            Err(_) => {
                // Timed out — no data received in 60s, treat as stall
                return Err(format!(
                    "Stalled: no data received for {}s on part {}/{}",
                    idle_timeout.as_secs(),
                    part,
                    total_parts
                ));
            }
            Ok(None) => {
                // Stream ended cleanly
                break;
            }
            Ok(Some(Err(e))) => {
                return Err(format!("Stream error: {}", e));
            }
            Ok(Some(Ok(chunk))) => {
                file.write_all(&chunk).await.map_err(|e| e.to_string())?;
                part_downloaded += chunk.len() as u64;

                let overall_downloaded = bytes_before + part_downloaded;
                let overall_percent = if grand_total > 0 {
                    (overall_downloaded as f64 / grand_total as f64) * 100.0
                } else if part_total > 0 {
                    (part_downloaded as f64 / part_total as f64) * 100.0
                } else {
                    0.0
                };

                let _ = app.emit(
                    "llm-download-progress",
                    serde_json::json!({
                        "filename": filename,
                        "part": part,
                        "total_parts": total_parts,
                        "part_bytes_downloaded": part_downloaded,
                        "part_total_bytes": part_total,
                        "bytes_downloaded": overall_downloaded,
                        "total_bytes": grand_total,
                        "percent": overall_percent,
                        "status": "downloading",
                    }),
                );
            }
        }
    }

    file.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Append the contents of `src` to `dest` (creating `dest` if it doesn't exist).
async fn append_file(src: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;

    let mut src_file = tokio::fs::File::open(src)
        .await
        .map_err(|e| format!("open src: {}", e))?;

    let mut dest_file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dest)
        .await
        .map_err(|e| format!("open dest: {}", e))?;

    tokio::io::copy(&mut src_file, &mut dest_file)
        .await
        .map_err(|e| format!("copy: {}", e))?;

    dest_file
        .flush()
        .await
        .map_err(|e| format!("flush: {}", e))?;
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
                .filter_map(|e| {
                    let path = e.path();
                    let fname = e.file_name().into_string().ok()?;
                    let expected = model_selector::LLM_MODELS
                        .iter()
                        .find(|m| m.filename == fname)
                        .map(|m| m.expected_size_bytes);
                    if is_valid_gguf(&path, expected) {
                        Some(fname)
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}
