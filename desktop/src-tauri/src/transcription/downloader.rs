use futures_util::StreamExt;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;

const HF_WHISPER_BASE: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const HF_VAD_BASE: &str = "https://huggingface.co/ggml-org/whisper-vad/resolve/main";

/// GGML magic bytes — first 4 bytes of a valid model file.
const GGML_MAGIC: &[u8; 4] = b"ggml";

/// VAD model required for streaming transcription.
pub const VAD_MODEL_FILENAME: &str = "ggml-silero-v6.2.0.bin";

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub filename: String,
    pub bytes_downloaded: u64,
    pub total_bytes: u64,
    pub percent: f32,
}

/// Downloads a Whisper model file with progress reporting.
/// Tries HuggingFace (canonical source).
pub async fn download_model(
    filename: &str,
    dest_dir: &Path,
    on_progress: impl Fn(DownloadProgress),
) -> Result<PathBuf, String> {
    let dest_path = dest_dir.join(filename);

    // Skip if already present and valid
    if is_valid_model(&dest_path) {
        return Ok(dest_path);
    }

    std::fs::create_dir_all(dest_dir).map_err(|e| format!("Failed to create models dir: {}", e))?;

    // Determine the correct base URL
    let base_url = if filename.contains("silero") {
        HF_VAD_BASE
    } else {
        HF_WHISPER_BASE
    };

    let url = format!("{}/{}", base_url, filename);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    // Retry up to 3 times with exponential backoff
    let mut last_error = String::new();
    for attempt in 0..3 {
        if attempt > 0 {
            let delay = std::time::Duration::from_secs(2u64.pow(attempt));
            tokio::time::sleep(delay).await;
        }

        match try_download(&client, &url, &dest_path, filename, &on_progress).await {
            Ok(_) => {
                // Validate the downloaded file
                if is_valid_model(&dest_path) {
                    return Ok(dest_path);
                } else {
                    last_error = "Downloaded file failed validation".to_string();
                    let _ = tokio::fs::remove_file(&dest_path).await;
                }
            }
            Err(e) => {
                last_error = format!("Attempt {}: {}", attempt + 1, e);
                let _ = tokio::fs::remove_file(&dest_path).await;
            }
        }
    }

    Err(format!("Download failed after 3 attempts. Last error: {}", last_error))
}

async fn try_download(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    filename: &str,
    on_progress: &impl Fn(DownloadProgress),
) -> Result<(), String> {
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

        on_progress(DownloadProgress {
            filename: filename.to_string(),
            bytes_downloaded: downloaded,
            total_bytes: total,
            percent: if total > 0 {
                (downloaded as f32 / total as f32) * 100.0
            } else {
                0.0
            },
        });
    }

    file.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Check if a model file exists and appears valid.
/// Validates file size > 1MB and checks for GGML magic bytes.
pub fn is_valid_model(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    if meta.len() < 1_000_000 {
        return false;
    }

    // Check GGML magic bytes
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut magic = [0u8; 4];
    use std::io::Read;
    if file.read_exact(&mut magic).is_err() {
        return false;
    }
    // GGML files can start with "ggml" or other valid signatures
    // For silero VAD, the format is different — just check size
    if path.to_string_lossy().contains("silero") {
        return meta.len() > 100_000;
    }
    &magic == GGML_MAGIC || magic[0..2] == [0x67, 0x67] // "gg" prefix covers ggml variants
}

/// List all downloaded model files in the models directory.
pub fn list_downloaded_models(models_dir: &Path) -> Vec<String> {
    if !models_dir.exists() {
        return Vec::new();
    }
    std::fs::read_dir(models_dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.path()
                        .extension()
                        .map(|ext| ext == "bin")
                        .unwrap_or(false)
                })
                .filter(|e| is_valid_model(&e.path()))
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default()
}
