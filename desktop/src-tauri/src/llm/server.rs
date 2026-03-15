use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Clone, Serialize)]
pub struct LlmServerStatus {
    pub running: bool,
    pub port: u16,
    pub model_path: String,
    pub model_name: String,
    pub gpu_layers: i32,
    pub context_length: u32,
    /// Last captured output from llama-server (for error diagnosis).
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
        self.stop().await;

        let args = build_server_args(model_path, gpu_layers, context_length, port);

        // Resolve the binaries directory so dylibs can be found regardless of
        // where Tauri places the binary at runtime (dev vs. bundled app).
        // On macOS, DYLD_LIBRARY_PATH must point to the dir containing the
        // libggml*.dylib / libllama.dylib files that ship alongside llama-server.
        let binaries_dir: String = app
            .path()
            .resource_dir()
            .ok()
            .map(|r: std::path::PathBuf| r.join("binaries").to_string_lossy().to_string())
            .unwrap_or_default();

        let mut sidecar_cmd = app
            .shell()
            .sidecar("llama-server")
            .map_err(|e| format!("llama-server sidecar not found: {e}"))?;

        if !binaries_dir.is_empty() {
            sidecar_cmd = sidecar_cmd
                .env("DYLD_LIBRARY_PATH", &binaries_dir)
                .env("LD_LIBRARY_PATH", &binaries_dir);
        }

        let (rx, child) = sidecar_cmd
            .args(&args)
            .spawn()
            .map_err(|e| format!("Failed to spawn llama-server: {e}"))?;

        // Shared log buffer + crash-detection flag
        let log_buf = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let crashed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        let log_buf_clone = log_buf.clone();
        let crashed_clone = crashed.clone();
        let app_clone = app.clone();

        // Background task: drain stdout/stderr and re-emit meaningful lines as
        // `llm-server-log` events so the UI can display live progress.
        tauri::async_runtime::spawn(async move {
            use tauri_plugin_shell::process::CommandEvent;
            let mut rx = rx;
            while let Some(event) = rx.recv().await {
                let line = match event {
                    CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => {
                        String::from_utf8_lossy(&b).to_string()
                    }
                    CommandEvent::Error(e) => format!("[error] {}\n", e),
                    CommandEvent::Terminated(_) => {
                        crashed_clone.store(true, std::sync::atomic::Ordering::SeqCst);
                        break;
                    }
                    _ => continue,
                };

                {
                    let mut buf = log_buf_clone.lock().unwrap();
                    if buf.len() > 16_384 {
                        let trim = buf.len() - 12_288;
                        *buf = buf[trim..].to_string();
                    }
                    buf.push_str(&line);
                }

                // Emit meaningful lines as progress events for the UI.
                // Classify: loading tensors, warming up, ready, error.
                let trimmed = line.trim();
                let kind = classify_log_line(trimmed);
                if kind != LogKind::Noise {
                    let _ = app_clone.emit(
                        "llm-server-log",
                        serde_json::json!({
                            "line": trimmed,
                            "kind": kind.as_str(),
                        }),
                    );
                }
            }
            crashed_clone.store(true, std::sync::atomic::Ordering::SeqCst);
        });

        // Health poll: fast-fails if the process crashes, otherwise waits up to
        // 120 s. Emits `llm-server-progress` every second so the UI can show
        // elapsed time and a real progress bar.
        match wait_for_health(port, &log_buf, &crashed, app).await {
            Ok(()) => {}
            Err(timeout_msg) => {
                let captured = log_buf.lock().unwrap().clone();
                let output = extract_crash_output(&captured);

                let _ = app.emit(
                    "llm-server-log",
                    serde_json::json!({ "line": &timeout_msg, "kind": "error" }),
                );

                // Emit each line of captured output as individual log events
                for line in output.lines() {
                    let _ = app.emit(
                        "llm-server-log",
                        serde_json::json!({ "line": line, "kind": "error" }),
                    );
                }

                return Err(format!("{}\n\nServer output:\n{}", timeout_msg, output));
            }
        }

        let captured = log_buf.lock().unwrap().clone();
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

    pub fn take_process(&mut self) -> Option<tauri_plugin_shell::process::CommandChild> {
        self.status.running = false;
        self.process.take()
    }

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
        // Jinja template is required for tool calling with Qwen/Phi models
        "--jinja".to_string(),
        // Flash attention — requires explicit value in llama.cpp b8281+
        "-fa".to_string(),
        "on".to_string(),
    ]
}

/// Wait up to 120 s for llama-server to report healthy (HTTP 200 on /health).
///
/// While waiting:
/// - Emits `llm-server-progress` every second with elapsed_secs + phase string
/// - Fast-fails if the process crashes (detected via the `crashed` atomic)
/// - Treats HTTP 503 as "still loading" (normal during model mmap + warmup)
async fn wait_for_health(
    port: u16,
    log_buf: &std::sync::Arc<std::sync::Mutex<String>>,
    crashed: &std::sync::Arc<std::sync::atomic::AtomicBool>,
    app: &AppHandle,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .unwrap_or_default();
    let url = format!("http://127.0.0.1:{port}/health");
    const MAX_SECS: u32 = 120;

    for elapsed in 1..=MAX_SECS {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        // Fast-fail: if the process died and we haven't gotten a 200, it crashed
        if crashed.load(std::sync::atomic::Ordering::SeqCst) {
            let captured = log_buf.lock().unwrap().clone();
            let output = extract_crash_output(&captured);

            // Emit each line of the crash output so the UI log panel can show it
            for line in output.lines() {
                let _ = app.emit(
                    "llm-server-log",
                    serde_json::json!({ "line": line, "kind": "error" }),
                );
            }

            return Err(format!("llama-server crashed:\n{}", output));
        }

        // Determine phase label from recent log output for the progress event
        let phase = {
            let buf = log_buf.lock().unwrap();
            infer_phase(&buf)
        };

        // Emit progress so the UI can drive a real counter + phase label
        let _ = app.emit(
            "llm-server-progress",
            serde_json::json!({
                "elapsed_secs": elapsed,
                "max_secs": MAX_SECS,
                "phase": phase,
                "percent": (elapsed as f32 / MAX_SECS as f32 * 100.0).min(99.0),
            }),
        );

        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                // Emit 100% on success
                let _ = app.emit(
                    "llm-server-progress",
                    serde_json::json!({
                        "elapsed_secs": elapsed,
                        "max_secs": MAX_SECS,
                        "phase": "ready",
                        "percent": 100.0,
                    }),
                );
                return Ok(());
            }
            Ok(resp) if resp.status() == 503 => {
                // Still loading — continue
            }
            _ => {
                // Connection refused — process may not have bound port yet
            }
        }
    }

    Err(format!(
        "llama-server did not become healthy within {} seconds.\n\
         The model may be corrupted or incompatible with this binary.",
        MAX_SECS
    ))
}

/// Classify a log line into a category for the UI to display/filter.
#[derive(PartialEq)]
enum LogKind {
    Loading,
    Progress,
    Ready,
    Error,
    Noise,
}

impl LogKind {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Loading => "loading",
            Self::Progress => "progress",
            Self::Ready => "ready",
            Self::Error => "error",
            Self::Noise => "noise",
        }
    }
}

fn classify_log_line(line: &str) -> LogKind {
    let ll = line.to_lowercase();
    if ll.contains("error") || ll.contains("fail") || ll.contains("fatal") || ll.contains("exiting due to") {
        return LogKind::Error;
    }
    if ll.contains("server is listening") || ll.contains("model loaded") || ll.contains("main: model loaded") {
        return LogKind::Ready;
    }
    if ll.contains("load_tensors") || ll.contains("loading model") || ll.contains("warming up") || ll.contains("offload") {
        return LogKind::Loading;
    }
    if line.starts_with("print_info:") || line.starts_with("llama_model_loader:") {
        return LogKind::Progress;
    }
    // GPU/Metal init lines, http/slot lines, etc. — suppress
    LogKind::Noise
}

/// Infer a human-readable phase from recent log output.
fn infer_phase(log: &str) -> &'static str {
    // Scan from the end so we get the most recent phase
    let last_1k: &str = if log.len() > 1024 {
        &log[log.len() - 1024..]
    } else {
        log
    };

    if last_1k.contains("server is listening") || last_1k.contains("model loaded") {
        return "ready";
    }
    if last_1k.contains("warming up") {
        return "warming up";
    }
    if last_1k.contains("load_tensors") || last_1k.contains("offloading") || last_1k.contains("loading model tensors") {
        return "loading tensors";
    }
    if last_1k.contains("loading model") || last_1k.contains("load_model") {
        return "reading model file";
    }
    if last_1k.contains("fitting params") {
        return "sizing to memory";
    }
    "initializing"
}

/// Extract the most useful output from the crash log buffer.
///
/// Prefers lines with error keywords. Falls back to the last 20 lines of raw output
/// so there is always something actionable to show the user, even when the process
/// was killed silently (e.g. macOS dylib resolution failure, Gatekeeper, OOM).
fn extract_crash_output(captured: &str) -> String {
    let error_lines: Vec<&str> = captured
        .lines()
        .filter(|l| {
            let ll = l.to_lowercase();
            ll.contains("error") || ll.contains("fail") || ll.contains("argument")
                || ll.contains("fatal") || ll.contains("exiting") || ll.contains("abort")
                || ll.contains("killed") || ll.contains("signal")
        })
        .take(8)
        .collect();

    if !error_lines.is_empty() {
        return error_lines.join("\n");
    }

    // No error keywords — return the last 20 lines of whatever was captured
    let last_lines: Vec<&str> = captured.lines().collect();
    let start = last_lines.len().saturating_sub(20);
    let tail = last_lines[start..].join("\n");

    if tail.trim().is_empty() {
        "(no output captured — process may have been killed by macOS before writing anything)\n\
         Possible causes: code signature issue, dylib not found, or Gatekeeper block.\n\
         Try: xattr -d com.apple.quarantine <binary path>"
            .to_string()
    } else {
        tail
    }
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
