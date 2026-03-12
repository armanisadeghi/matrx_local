use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Clone, Serialize)]
pub struct LlmServerStatus {
    pub running: bool,
    pub port: u16,
    pub model_path: String,
    pub model_name: String,
    pub gpu_layers: i32,
    pub context_length: u32,
    /// Last captured stderr output from llama-server (for error diagnosis).
    #[serde(skip_serializing_if = "String::is_empty")]
    pub last_error_output: String,
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
                last_error_output: String::new(),
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

        // The llama-server binary has @executable_path and
        // @executable_path/../Resources/binaries baked into its rpath (set by
        // download-llama-server.sh via install_name_tool). No DYLD_LIBRARY_PATH
        // override needed — the OS resolves dylibs from those rpath entries.
        let (rx, child) = app
            .shell()
            .sidecar("llama-server")
            .map_err(|e| format!("llama-server sidecar not found: {e}"))?
            .args(&args)
            .spawn()
            .map_err(|e| format!("Failed to spawn llama-server: {e}"))?;

        // Collect stderr output while waiting for health — this captures crash messages
        // and model loading errors without blocking the health poll.
        let stderr_log = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let stderr_log_clone = stderr_log.clone();
        tauri::async_runtime::spawn(async move {
            use tauri_plugin_shell::process::CommandEvent;
            let mut rx = rx;
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stderr(bytes) | CommandEvent::Stdout(bytes) => {
                        if let Ok(line) = String::from_utf8(bytes) {
                            let mut log = stderr_log_clone.lock().unwrap();
                            // Keep last 8KB of output
                            if log.len() > 8192 {
                                let trim_point = log.len() - 6144;
                                *log = log[trim_point..].to_string();
                            }
                            log.push_str(&line);
                        }
                    }
                    CommandEvent::Error(e) => {
                        let mut log = stderr_log_clone.lock().unwrap();
                        log.push_str(&format!("[spawn error] {}\n", e));
                    }
                    _ => {}
                }
            }
        });

        // Wait for server to become healthy before returning
        match wait_for_health(port).await {
            Ok(()) => {}
            Err(timeout_msg) => {
                // Attach any captured output to the error for diagnosis
                let captured = stderr_log.lock().unwrap().clone();
                // Extract the most relevant error lines (lines with "error" or "fail")
                let relevant: String = captured
                    .lines()
                    .filter(|l| {
                        let ll = l.to_lowercase();
                        ll.contains("error") || ll.contains("fail") || ll.contains("fatal")
                    })
                    .take(5)
                    .collect::<Vec<_>>()
                    .join("\n");

                if relevant.is_empty() {
                    return Err(timeout_msg);
                }
                return Err(format!("{}\n\nServer output:\n{}", timeout_msg, relevant));
            }
        }

        let captured = stderr_log.lock().unwrap().clone();
        self.process = Some(child);
        self.status = LlmServerStatus {
            running: true,
            port,
            model_path: model_path.to_string(),
            model_name: extract_model_name(model_path),
            gpu_layers,
            context_length,
            last_error_output: captured,
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
        self.status.last_error_output = String::new();
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
        // Do NOT add --log-disable: we capture output for error diagnosis
    ]
}

/// Wait up to 120 seconds for llama-server to pass its health check.
/// Large models (14B+) can take 60-90 seconds to map into memory on first load.
async fn wait_for_health(port: u16) -> Result<(), String> {
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/health");

    // Poll every second for up to 120 seconds
    for attempt in 0..120 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => return Ok(()),
            Ok(resp) if resp.status() == 503 => {
                // 503 = server started but model still loading — keep waiting
            }
            _ => {
                // Connection refused or other error — process may have crashed
                // Keep polling; the stderr collector will capture the crash output
            }
        }

        if attempt == 119 {
            return Err(
                "llama-server did not become healthy within 120 seconds. \
                 The model may be too large for available RAM, or the binary \
                 may not be compatible with this system."
                    .to_string(),
            );
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
