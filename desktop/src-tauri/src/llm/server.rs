use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Clone, Serialize)]
pub struct LlmServerStatus {
    pub running: bool,
    pub port: u16,
    pub model_path: String,
    pub model_name: String,
    pub gpu_layers: i32,
    pub context_length: u32,
}

pub struct LlmServer {
    process: Option<tauri_plugin_shell::process::CommandChild>,
    pub status: LlmServerStatus,
}

impl LlmServer {
    pub fn new() -> Self {
        Self {
            process: None,
            status: LlmServerStatus {
                running: false,
                port: 0,
                model_path: String::new(),
                model_name: String::new(),
                gpu_layers: 0,
                context_length: 0,
            },
        }
    }

    pub async fn start(
        &mut self,
        app: &AppHandle,
        model_path: &str,
        gpu_layers: i32,
        context_length: u32,
        port: u16,
    ) -> Result<(), String> {
        // Kill any running instance first
        self.stop().await;

        let args = build_server_args(model_path, gpu_layers, context_length, port);

        // Resolve the binaries directory so the dylibs (libggml-*, libllama-*,
        // libmtmd-*) that ship alongside llama-server can be found at runtime.
        let binaries_dir = app
            .path()
            .resource_dir()
            .ok()
            .map(|p| p.join("binaries"))
            .unwrap_or_default();
        let dyld_path = binaries_dir.to_string_lossy().to_string();

        let (_rx, child) = app
            .shell()
            .sidecar("llama-server")
            .map_err(|e| format!("llama-server sidecar not found: {e}"))?
            .args(&args)
            .env("DYLD_LIBRARY_PATH", &dyld_path)
            .env("DYLD_FALLBACK_LIBRARY_PATH", &dyld_path)
            .spawn()
            .map_err(|e| format!("Failed to spawn llama-server: {e}"))?;

        // Wait for server to become healthy before returning
        wait_for_health(port).await?;

        self.process = Some(child);
        self.status = LlmServerStatus {
            running: true,
            port,
            model_path: model_path.to_string(),
            model_name: extract_model_name(model_path),
            gpu_layers,
            context_length,
        };

        Ok(())
    }

    pub async fn stop(&mut self) {
        if let Some(child) = self.process.take() {
            let _ = child.kill();
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
        self.status.running = false;
        self.status.port = 0;
    }

    /// Take ownership of the process handle (for synchronous cleanup on app quit).
    pub fn take_process(&mut self) -> Option<tauri_plugin_shell::process::CommandChild> {
        self.status.running = false;
        self.process.take()
    }

    /// Check if the server is still responding to health checks.
    pub async fn health_check(&self) -> bool {
        if !self.status.running || self.status.port == 0 {
            return false;
        }
        let client = reqwest::Client::new();
        let url = format!("http://127.0.0.1:{}/health", self.status.port);
        matches!(client.get(&url).send().await, Ok(resp) if resp.status().is_success())
    }
}

fn build_server_args(
    model_path: &str,
    gpu_layers: i32,
    context_length: u32,
    port: u16,
) -> Vec<String> {
    let thread_count = optimal_thread_count();

    vec![
        "-m".to_string(),
        model_path.to_string(),
        "-ngl".to_string(),
        gpu_layers.to_string(),
        "-c".to_string(),
        context_length.to_string(),
        "-t".to_string(),
        thread_count.to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port.to_string(),
        // CRITICAL: enables Jinja chat template for tool calling
        "--jinja".to_string(),
        // Flash attention for faster inference
        "-fa".to_string(),
        // Suppress noisy logs in production
        "--log-disable".to_string(),
    ]
}

async fn wait_for_health(port: u16) -> Result<(), String> {
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/health");

    for attempt in 0..60 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => return Ok(()),
            _ => {
                if attempt == 59 {
                    return Err("llama-server did not become healthy within 30 seconds. \
                         The model may be too large for available RAM, or the binary \
                         may not be compatible with this system."
                        .to_string());
                }
            }
        }
    }
    Err("Timeout waiting for llama-server".to_string())
}

fn optimal_thread_count() -> usize {
    let cpus = std::thread::available_parallelism()
        .map(|p| p.get())
        .unwrap_or(4);
    // Use half of available threads, clamped to 1..8
    (cpus / 2).max(1).min(8)
}

fn extract_model_name(path: &str) -> String {
    std::path::Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string()
}

/// Find an available port starting from `start`.
pub fn find_free_port(start: u16) -> Result<u16, String> {
    for port in start..start + 100 {
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    Err(format!(
        "No free port found in range {}–{}",
        start,
        start + 99
    ))
}
