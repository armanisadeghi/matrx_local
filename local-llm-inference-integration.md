# Local LLM Inference Integration — AI Matrx Desktop (Tauri)

**Purpose:** Agent implementation guide for embedding local text model inference into the AI Matrx Tauri app.
**Scope:** Inference engine selection, model catalog, sidecar architecture, tool calling, structured output, Tauri commands, and frontend integration.
**Prerequisites:** Whisper transcription integration guide completed. Shared infrastructure (hardware detection, downloader, storage layer) is assumed to exist.

---

## 1. Inference Architecture Decision

### Why a Sidecar (Not an Embedded Rust Crate)

For Whisper, we embedded `whisper-cpp-plus` directly in the Tauri binary — audio clips are short, the operation is fire-and-forget, and the process lifecycle is simple.

For LLMs, a **sidecar process** running `llama-server` is the correct architecture for the following reasons:

| Concern | Embedded Crate | llama-server Sidecar |
|---------|----------------|----------------------|
| Memory management | Tied to Tauri process lifetime | Independent; can unload/swap models without restarting app |
| Tool calling support | Must be hand-implemented at low level | Built-in via `--jinja` flag |
| Structured output | Requires grammar string construction in Rust | `json_schema` param in POST body |
| OpenAI-compatible API | No; custom Rust API | Full `/v1/chat/completions` |
| Streaming | Requires channel wiring | SSE out of the box |
| Frontend access | Tauri commands only | HTTP → any JS code can call it |
| Stability on model swap | Complex teardown | Kill → restart process |
| Qwen3 thinking mode toggle | Not exposed | `chat_template_kwargs` flag |

`llama-server` is part of the same ggml/llama.cpp ecosystem — 100% open-source (MIT), no SaaS, no subscriptions, no API keys. It is the official inference server shipped with llama.cpp.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Tauri App Process                                       │
│                                                          │
│  ┌────────────────────┐    Tauri IPC     ┌────────────┐ │
│  │  Frontend (Next.js)│ ◄──────────────► │  Commands  │ │
│  └────────────────────┘                  └─────┬──────┘ │
│            │                                   │        │
│            │ HTTP fetch to                     │ spawn/ │
│            │ localhost:PORT                    │ manage │
│            ▼                                   ▼        │
│  ┌─────────────────────────────────────────────────┐   │
│  │         llama-server (sidecar)                  │   │
│  │  OpenAI-compatible /v1/chat/completions          │   │
│  │  Tool calling: --jinja                           │   │
│  │  Structured output: json_schema param            │   │
│  │  GPU: Metal (macOS) / CUDA / Vulkan              │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

The frontend can call the sidecar directly (HTTP fetch to `localhost:{PORT}`) OR via Tauri commands. Both patterns are valid. Direct HTTP is simpler for streaming; Tauri commands are better for orchestration (start/stop model, detect hardware, trigger downloads).

---

## 2. Shared Infrastructure (Reuse from Whisper Guide)

The following modules from `src-tauri/src/transcription/` are **unchanged** — import or reference them:

| Module | Reuse Status | Notes |
|--------|-------------|-------|
| `hardware.rs` — `HardwareProfile` | ✅ Full reuse | Same RAM/GPU detection |
| `downloader.rs` — CDN→HF downloader with progress events | ✅ Full reuse | Same S3 + HF fallback |
| `config.rs` — persist selected model across launches | ✅ Full reuse | Different config key |
| `model_selector.rs` — tier selection algorithm | ⚠️ Adapt | RAM thresholds shift; same logic |
| `commands.rs` — download/hardware Tauri commands | ✅ Partial reuse | Add new LLM commands alongside |

New modules to create under `src-tauri/src/llm/`:

```
src-tauri/src/llm/
  mod.rs
  model_selector.rs   ← adapted tier logic for LLM RAM requirements
  server.rs           ← spawn/kill llama-server process, health check
  commands.rs         ← Tauri #[command] functions for LLM lifecycle
  config.rs           ← persist llm_model, llm_port across launches
```

---

## 3. Build Prerequisites

### What Is Already Installed (from Whisper setup)

- Rust 1.75+
- CMake 3.21+
- C++17 compiler (MSVC on Windows, Clang on macOS, GCC on Linux)
- GPU toolchain (CUDA Toolkit or Vulkan SDK if applicable)

### What Is New for llama.cpp

Nothing additional is required at compile time. The `llama-server` binary is **pre-built** — you bundle it as a Tauri sidecar binary rather than compiling it from source in your Rust build.

This is a critical difference from the Whisper approach:
- Whisper: `whisper-cpp-plus` crate compiles whisper.cpp via cmake at `cargo build` time
- LLM: `llama-server` is downloaded as a pre-built binary and bundled via Tauri's sidecar mechanism

### Obtaining the llama-server Binary

Download the correct pre-built binary for each target platform from the official llama.cpp GitHub releases:

```
https://github.com/ggml-org/llama.cpp/releases/latest
```

Download these artifacts:

| Platform | Artifact Name | Extract |
|----------|--------------|---------|
| macOS ARM (Apple Silicon) | `llama-{version}-bin-macos-arm64.zip` | `llama-server` |
| macOS x86 (Intel) | `llama-{version}-bin-macos-x64.zip` | `llama-server` |
| Windows CUDA | `llama-{version}-bin-win-cuda-cu12.2.0-x64.zip` | `llama-server.exe` |
| Windows CPU | `llama-{version}-bin-win-noavx-x64.zip` | `llama-server.exe` |
| Linux CUDA | `llama-{version}-bin-ubuntu-x64-cuda-cu12.2.0.tar.gz` | `llama-server` |
| Linux CPU | `llama-{version}-bin-ubuntu-x64.tar.gz` | `llama-server` |

Mirror these binaries to your S3/CloudFront CDN alongside the model files:

```
https://assets.aimatrx.com/llama-server/v{VERSION}/macos-arm64/llama-server
https://assets.aimatrx.com/llama-server/v{VERSION}/macos-x64/llama-server
https://assets.aimatrx.com/llama-server/v{VERSION}/windows-cuda/llama-server.exe
https://assets.aimatrx.com/llama-server/v{VERSION}/windows-cpu/llama-server.exe
https://assets.aimatrx.com/llama-server/v{VERSION}/linux-cuda/llama-server
https://assets.aimatrx.com/llama-server/v{VERSION}/linux-cpu/llama-server
```

**Version pinning:** Pin a specific llama.cpp release (e.g., `b5000`) and test before bumping. Do not auto-update llama-server without testing Qwen3 tool calling, as chat template changes break between versions.

---

## 4. Tauri Sidecar Configuration

### tauri.conf.json

```json
{
  "bundle": {
    "externalBin": [
      "binaries/llama-server"
    ]
  }
}
```

### Platform Binary Naming Convention

Tauri's sidecar system requires platform-specific suffixes. Place binaries in `src-tauri/binaries/`:

```
src-tauri/binaries/
  llama-server-aarch64-apple-darwin        ← macOS ARM
  llama-server-x86_64-apple-darwin         ← macOS Intel
  llama-server-x86_64-pc-windows-msvc.exe  ← Windows
  llama-server-x86_64-unknown-linux-gnu    ← Linux
```

These suffixes must match Rust target triples exactly. Tauri selects the correct binary at runtime based on the compilation target.

During CI/CD, download the correct artifact per platform and rename accordingly.

### Capabilities (tauri.conf.json)

```json
{
  "app": {
    "security": {
      "capabilities": ["llm-server-capability"]
    }
  }
}
```

Create `src-tauri/capabilities/llm-server-capability.json`:

```json
{
  "identifier": "llm-server-capability",
  "description": "Allow spawning and managing the llama-server sidecar",
  "windows": ["main"],
  "permissions": [
    "shell:allow-execute",
    "shell:allow-kill"
  ]
}
```

### Cargo.toml Additions

Add to `src-tauri/Cargo.toml` — these are all in addition to existing Whisper dependencies:

```toml
[dependencies]
tauri-plugin-shell = "2"   # for sidecar process management
port_check = "0.1"         # find a free port for llama-server
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", features = ["json", "stream"] }
tokio = { version = "1", features = ["full"] }
```

---

## 5. Model Catalog

All models are in GGUF format. Download on first run (same CDN-first/HF-fallback pattern as Whisper). Do NOT bundle in installer.

### Recommended Models

| Tier | Model | Quant | Disk | RAM | Tool Calling | Speed |
|------|-------|-------|------|-----|--------------|-------|
| LOW | Qwen3-4B-Instruct | Q4_K_M | ~2.7 GB | ~4 GB | ⭐⭐⭐⭐ | Fast |
| LOW-ALT | Phi-4-mini-Instruct | Q4_K_M | ~2.3 GB | ~3.5 GB | ⭐⭐⭐⭐ | Very fast |
| **DEFAULT** | **Qwen3-8B-Instruct** | **Q4_K_M** | **~5.2 GB** | **~6.5 GB** | **⭐⭐⭐⭐⭐** | **Medium** |
| HIGH | Qwen2.5-14B-Instruct | Q4_K_M | ~9 GB | ~10 GB | ⭐⭐⭐⭐⭐ | Slow (GPU recommended) |
| HIGH-ALT | Mistral-Small-3-24B | Q4_K_M | ~14 GB | ~16 GB | ⭐⭐⭐⭐⭐ | GPU required |

### Download URLs

#### Primary (CDN — mirror to S3 before shipping)

```
https://assets.aimatrx.com/llm-models/Qwen3-4B-Instruct-Q4_K_M.gguf
https://assets.aimatrx.com/llm-models/Phi-4-mini-Instruct-Q4_K_M.gguf
https://assets.aimatrx.com/llm-models/Qwen3-8B-Instruct-Q4_K_M.gguf
https://assets.aimatrx.com/llm-models/Qwen2.5-14B-Instruct-Q4_K_M.gguf
https://assets.aimatrx.com/llm-models/Mistral-Small-3-24B-Instruct-Q4_K_M.gguf
```

#### HuggingFace Fallback (with 3-attempt exponential backoff)

```
# Qwen3-8B (DEFAULT)
https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf

# Qwen3-4B
https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf

# Phi-4-mini
https://huggingface.co/microsoft/Phi-4-mini-instruct-gguf/resolve/main/Phi-4-mini-instruct-Q4_K_M.gguf

# Qwen2.5-14B
https://huggingface.co/Qwen/Qwen2.5-14B-Instruct-GGUF/resolve/main/Qwen2.5-14B-Instruct-Q4_K_M.gguf

# Mistral Small 3
https://huggingface.co/bartowski/Mistral-Small-3.1-24B-Instruct-2503-GGUF/resolve/main/Mistral-Small-3.1-24B-Instruct-2503-Q4_K_M.gguf
```

**SHA256:** Always retrieve from the HuggingFace model card before mirroring to S3. Validate after download by checking the first 4 bytes equal the GGUF magic: `0x47475546` (`GGUF` in ASCII). This is different from Whisper's GGML magic.

### Model Selection Logic (Adapt from Whisper hardware.rs)

```rust
pub fn select_llm_tier(profile: &HardwareProfile) -> LlmTier {
    // Apple Silicon — Metal offloads all layers, very efficient
    if profile.is_apple_silicon && profile.total_ram_gb >= 8 {
        return LlmTier::Default; // Qwen3-8B runs well
    }
    if profile.is_apple_silicon && profile.total_ram_gb >= 16 {
        return LlmTier::High; // Qwen2.5-14B
    }

    // CUDA GPU with dedicated VRAM
    if profile.gpu_vram_gb >= 8 {
        return LlmTier::High;
    }
    if profile.gpu_vram_gb >= 4 {
        return LlmTier::Default;
    }

    // CPU-only path — be conservative
    if profile.total_ram_gb < 6 {
        return LlmTier::Low; // Phi-4-mini
    }
    if profile.total_ram_gb < 10 {
        return LlmTier::Default; // Qwen3-8B, but warn it will be slow
    }

    LlmTier::Default // Never auto-select High on CPU — surface upgrade prompt
}

pub fn gpu_layer_count(profile: &HardwareProfile, tier: &LlmTier) -> i32 {
    if profile.is_apple_silicon {
        return 99; // Metal — offload all layers
    }
    if profile.gpu_vram_gb >= 8 {
        return 99; // Full GPU offload
    }
    if profile.gpu_vram_gb >= 4 {
        return 20; // Partial offload — reduces RAM pressure
    }
    0 // CPU only
}
```

---

## 6. Server Module (server.rs)

This is the core of the LLM integration. It manages the llama-server process lifecycle.

```rust
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Clone, serde::Serialize)]
pub struct LlmServerStatus {
    pub running: bool,
    pub port: u16,
    pub model_path: String,
    pub model_name: String,
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

        let (mut rx, child) = app
            .shell()
            .sidecar("llama-server")
            .map_err(|e| format!("Sidecar not found: {e}"))?
            .args(args)
            .spawn()
            .map_err(|e| format!("Failed to spawn llama-server: {e}"))?;

        // Wait for server to become healthy before returning
        wait_for_health(port).await
            .map_err(|e| format!("llama-server failed to start: {e}"))?;

        self.process = Some(child);
        self.status = LlmServerStatus {
            running: true,
            port,
            model_path: model_path.to_string(),
            model_name: extract_model_name(model_path),
        };

        Ok(())
    }

    pub async fn stop(&mut self) {
        if let Some(child) = self.process.take() {
            let _ = child.kill();
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
        self.status.running = false;
    }
}

fn build_server_args(
    model_path: &str,
    gpu_layers: i32,
    context_length: u32,
    port: u16,
) -> Vec<String> {
    vec![
        // Model
        "-m".to_string(), model_path.to_string(),

        // GPU offload (-1 = all layers if GPU available, 0 = CPU only)
        "-ngl".to_string(), gpu_layers.to_string(),

        // Context window — 8192 is a good default for tool calling workloads
        "-c".to_string(), context_length.to_string(),

        // Thread count — physical cores / 2, max 8
        "-t".to_string(), optimal_thread_count().to_string(),

        // Network
        "--host".to_string(), "127.0.0.1".to_string(),
        "--port".to_string(), port.to_string(),

        // CRITICAL: enables the Jinja chat template embedded in the GGUF.
        // Without this flag, tool calling will NOT work for Qwen3.
        "--jinja".to_string(),

        // Flash attention — faster inference when supported by model + backend
        "-fa".to_string(),

        // Disable logging noise to stderr (optional, helps in production)
        "--log-disable".to_string(),
    ]
}

async fn wait_for_health(port: u16) -> Result<(), String> {
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/health");

    for attempt in 0..30 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => return Ok(()),
            _ => {
                if attempt == 29 {
                    return Err("Server did not become healthy within 15 seconds".to_string());
                }
            }
        }
    }
    Err("Timeout".to_string())
}

fn optimal_thread_count() -> usize {
    let cpus = num_cpus::get_physical();
    (cpus / 2).max(1).min(8)
}

fn extract_model_name(path: &str) -> String {
    std::path::Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string()
}
```

---

## 7. Tauri Commands (commands.rs)

Register all 6 of these commands in `main.rs` via `.invoke_handler(tauri::generate_handler![...])`.

```rust
use tauri::State;
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::llm::server::LlmServer;

pub type LlmServerState = Arc<Mutex<LlmServer>>;

/// Start or restart llama-server with the selected model.
/// Call this after download completes or on app launch if model cached.
#[tauri::command]
pub async fn start_llm_server(
    app: tauri::AppHandle,
    state: State<'_, LlmServerState>,
    model_filename: String,  // e.g. "Qwen3-8B-Instruct-Q4_K_M.gguf"
    gpu_layers: i32,
    context_length: Option<u32>,
) -> Result<LlmServerStatus, String> {
    let model_path = resolve_model_path(&app, &model_filename)?;
    let port = find_free_port(11434)?; // Start from ollama-compatible default
    let ctx = context_length.unwrap_or(8192);

    let mut server = state.lock().await;
    server.start(&app, &model_path, gpu_layers, ctx, port).await?;

    Ok(server.status.clone())
}

/// Stop the running llama-server.
#[tauri::command]
pub async fn stop_llm_server(
    state: State<'_, LlmServerState>,
) -> Result<(), String> {
    let mut server = state.lock().await;
    server.stop().await;
    Ok(())
}

/// Get the current server status (running, port, model name).
/// Frontend polls this on startup to know whether to show setup wizard.
#[tauri::command]
pub async fn get_llm_server_status(
    state: State<'_, LlmServerState>,
) -> Result<LlmServerStatus, String> {
    let server = state.lock().await;
    Ok(server.status.clone())
}

/// Check if a model file exists in local storage (skip download if true).
/// Identical pattern to Whisper's check_model_exists command.
#[tauri::command]
pub async fn check_llm_model_exists(
    app: tauri::AppHandle,
    filename: String,
) -> Result<bool, String> {
    let path = resolve_model_path(&app, &filename)?;
    Ok(std::path::Path::new(&path).exists())
}

/// Download a model — emits "llm-download-progress" events with { percent, bytes_downloaded, total_bytes }.
/// Identical to Whisper downloader; just different URL and destination filename.
#[tauri::command]
pub async fn download_llm_model(
    app: tauri::AppHandle,
    filename: String,
    cdn_url: String,
    hf_fallback_url: String,
) -> Result<String, String> {
    // Reuse the existing downloader from transcription::downloader
    // Emit "llm-download-progress" events (different event name from whisper's)
    crate::transcription::downloader::download_with_fallback(
        &app,
        &cdn_url,
        &hf_fallback_url,
        &resolve_model_path(&app, &filename)?,
        "llm-download-progress",
    ).await
}

/// Detect hardware and return the recommended model tier.
/// Reuses HardwareProfile from transcription::hardware — no duplication needed.
#[tauri::command]
pub async fn detect_llm_hardware() -> Result<LlmHardwareRecommendation, String> {
    use crate::transcription::hardware::detect_hardware;
    use crate::llm::model_selector::{select_llm_tier, gpu_layer_count};

    let profile = detect_hardware().await?;
    let tier = select_llm_tier(&profile);
    let gpu_layers = gpu_layer_count(&profile, &tier);

    Ok(LlmHardwareRecommendation {
        tier,
        gpu_layers,
        recommended_model: tier.default_model_filename(),
        recommended_model_size_gb: tier.disk_size_gb(),
        reason: tier.selection_reason(&profile),
        can_upgrade: tier.can_upgrade(&profile),
    })
}

fn resolve_model_path(app: &tauri::AppHandle, filename: &str) -> Result<String, String> {
    let base = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models")
        .join(filename);
    Ok(base.to_string_lossy().to_string())
}

fn find_free_port(start: u16) -> Result<u16, String> {
    for port in start..start + 100 {
        if port_check::is_port_free(port) {
            return Ok(port);
        }
    }
    Err("No free port found in range".to_string())
}
```

---

## 8. Inference API — Making Requests

Once llama-server is running, the frontend (or Rust code) talks to it via standard HTTP. The API is a strict subset of OpenAI's chat completions API — no SDK required, just `fetch`.

### Basic Chat Completion (TypeScript)

```typescript
// lib/llm.ts

const getLlmPort = async (): Promise<number> => {
  const status = await invoke<LlmServerStatus>('get_llm_server_status');
  if (!status.running) throw new Error('LLM server not running');
  return status.port;
};

export async function chatCompletion(
  messages: Array<{ role: string; content: string }>,
  options?: {
    temperature?: number;
    maxTokens?: number;
    thinking?: boolean; // Qwen3-specific: enable/disable chain-of-thought
  }
): Promise<string> {
  const port = await getLlmPort();

  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'local',               // llama-server ignores this field
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 1024,
      stream: false,

      // Qwen3: disable thinking for tool calling / structured output workloads
      // This disables <think>...</think> reasoning blocks for speed and determinism
      chat_template_kwargs: {
        enable_thinking: options?.thinking ?? false,
      },
    }),
  });

  const data = await response.json();
  return data.choices[0].message.content;
}
```

### Streaming (SSE)

```typescript
export async function* streamCompletion(
  messages: Array<{ role: string; content: string }>
): AsyncGenerator<string> {
  const port = await getLlmPort();

  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'local',
      messages,
      temperature: 0.7,
      stream: true,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

    for (const line of lines) {
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore malformed chunks
      }
    }
  }
}
```

---

## 9. Tool Calling

Tool calling is the primary use case for this integration. llama-server handles the full tool call lifecycle when launched with `--jinja`.

### How It Works (Qwen3-Instruct)

When `--jinja` is enabled, llama-server reads the chat template embedded in the GGUF file. Qwen3-Instruct uses this format for tool call outputs:

```
<tool_call>
{"name": "get_weather", "arguments": {"city": "London", "unit": "celsius"}}
</tool_call>
```

llama-server automatically parses this into the standard OpenAI tool call response format before returning, so your client code sees:

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "tool_calls": [{
        "id": "call_abc123",
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\"city\": \"London\", \"unit\": \"celsius\"}"
        }
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```

### Tool Calling Request (TypeScript)

```typescript
interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

interface ToolCallResult {
  toolName: string;
  toolCallId: string;
  arguments: Record<string, unknown>;
}

export async function callWithTools(
  messages: Array<{ role: string; content: string }>,
  tools: ToolDefinition[]
): Promise<{ content: string | null; toolCalls: ToolCallResult[] }> {
  const port = await getLlmPort();

  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'local',
      messages,
      tools,
      tool_choice: 'auto',          // or 'required' to force a tool call
      temperature: 0.7,
      max_tokens: 1024,

      // CRITICAL: disable thinking for tool calling
      // Reasoning tokens before the tool call add latency with no benefit
      chat_template_kwargs: { enable_thinking: false },
    }),
  });

  const data = await response.json();
  const message = data.choices[0].message;

  const toolCalls: ToolCallResult[] = (message.tool_calls ?? []).map((tc: any) => ({
    toolName: tc.function.name,
    toolCallId: tc.id,
    arguments: JSON.parse(tc.function.arguments),
  }));

  return {
    content: message.content ?? null,
    toolCalls,
  };
}
```

### Multi-Turn Tool Call Loop (Agent Pattern)

```typescript
export async function runAgentLoop(
  systemPrompt: string,
  userMessage: string,
  tools: ToolDefinition[],
  toolExecutor: (name: string, args: Record<string, unknown>) => Promise<string>
): Promise<string> {
  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  // Max iterations guard
  for (let i = 0; i < 10; i++) {
    const { content, toolCalls } = await callWithTools(messages, tools);

    if (toolCalls.length === 0) {
      // Model responded with text — we're done
      return content ?? '';
    }

    // Add assistant's tool call message
    messages.push({
      role: 'assistant',
      tool_calls: toolCalls.map(tc => ({
        id: tc.toolCallId,
        type: 'function',
        function: { name: tc.toolName, arguments: JSON.stringify(tc.arguments) },
      })),
    });

    // Execute each tool and add results
    for (const tc of toolCalls) {
      const result = await toolExecutor(tc.toolName, tc.arguments);
      messages.push({
        role: 'tool',
        tool_call_id: tc.toolCallId,
        content: result,
      });
    }
  }

  throw new Error('Agent loop exceeded maximum iterations');
}
```

---

## 10. Structured Output (Grammar-Constrained Decoding)

This is the other core capability. For structured output, you pass a JSON schema in the request body. llama-server converts it to a GBNF grammar internally and forces the model to emit only tokens that conform to the schema — at the sampler level, not the prompt level. This means even a model that might otherwise hallucinate field names cannot produce invalid JSON for the given schema.

```typescript
export async function structuredOutput<T>(
  messages: Array<{ role: string; content: string }>,
  schema: object  // Standard JSON Schema
): Promise<T> {
  const port = await getLlmPort();

  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'local',
      messages,
      temperature: 0.1,   // Low temperature for structured output — more deterministic
      max_tokens: 2048,
      stream: false,

      // Pass the schema — llama-server auto-converts to GBNF grammar
      response_format: {
        type: 'json_schema',
        json_schema: { schema },
      },

      chat_template_kwargs: { enable_thinking: false },
    }),
  });

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content) as T;
}

// Example usage — extract structured data from free text
interface ContactInfo {
  name: string;
  email: string;
  phone?: string;
  company?: string;
}

const contact = await structuredOutput<ContactInfo>(
  [{ role: 'user', content: 'Extract contact info: John Smith, john@acme.com, CEO at Acme Corp, (555) 123-4567' }],
  {
    type: 'object',
    properties: {
      name:    { type: 'string' },
      email:   { type: 'string' },
      phone:   { type: 'string' },
      company: { type: 'string' },
    },
    required: ['name', 'email'],
  }
);
```

**JSON Schema limitations in llama.cpp grammar engine:**
- `anyOf` / `oneOf` cannot be mixed with `properties` in the same object
- Nested `$ref` is not supported — inline all schemas
- `minimum` / `maximum` only work for `integer`, not `number`
- `additionalProperties` defaults to `false` (which is what you want)

---

## 11. First-Run Setup Flow (LLM)

```
App launch
  → get_llm_server_status
  → if running: skip setup, server already live (persisted from last session)
  → if not running:
      → check_llm_model_exists (saved model from config)
      → if exists:
          → detect_llm_hardware → get gpu_layers
          → start_llm_server → emit "llm-server-ready" event
      → if not exists:
          → detect_llm_hardware → show recommendation (tier, size, reason)
          → [optional] show upgrade offer if can_upgrade == true
          → user confirms model choice
          → download_llm_model → progress bar ("llm-download-progress")
          → start_llm_server
          → save selected model to config
          → emit "llm-server-ready"
```

**Important:** llama-server startup takes 2–30 seconds depending on model size and GPU offload. Show a loading state. Do not allow inference requests before "llm-server-ready" is emitted.

---

## 12. Zustand Store Integration

```typescript
// store/llmStore.ts

interface LlmStore {
  serverRunning: boolean;
  serverPort: number | null;
  modelName: string;
  serverStarting: boolean;
  downloadProgress: number | null;
  error: string | null;

  startServer: (modelFilename: string) => Promise<void>;
  stopServer: () => Promise<void>;
}

export const useLlmStore = create<LlmStore>((set, get) => ({
  serverRunning: false,
  serverPort: null,
  modelName: '',
  serverStarting: false,
  downloadProgress: null,
  error: null,

  startServer: async (modelFilename) => {
    set({ serverStarting: true, error: null });
    try {
      const hardware = await invoke<LlmHardwareRecommendation>('detect_llm_hardware');
      const status = await invoke<LlmServerStatus>('start_llm_server', {
        modelFilename,
        gpuLayers: hardware.gpuLayers,
        contextLength: 8192,
      });
      set({
        serverRunning: true,
        serverPort: status.port,
        modelName: status.modelName,
        serverStarting: false,
      });
    } catch (err) {
      set({ error: String(err), serverStarting: false });
    }
  },

  stopServer: async () => {
    await invoke('stop_llm_server');
    set({ serverRunning: false, serverPort: null, modelName: '' });
  },
}));

// Listen for download progress
listen<{ percent: number }>('llm-download-progress', (event) => {
  useLlmStore.setState({ downloadProgress: event.payload.percent });
});
```

---

## 13. Qwen3-Specific Configuration

These parameters are critical for correct behavior with Qwen3 models:

### Sampling Parameters

```typescript
// Tool calling workloads — deterministic, fast
const TOOL_CALL_PARAMS = {
  temperature: 0.7,
  top_p: 0.8,
  top_k: 20,
  min_p: 0,
  chat_template_kwargs: { enable_thinking: false },
};

// Chat / general text — more creative
const CHAT_PARAMS = {
  temperature: 0.7,
  top_p: 0.8,
  top_k: 20,
  min_p: 0,
  chat_template_kwargs: { enable_thinking: false },
};

// Complex reasoning — thinking mode enabled (slower but smarter)
const REASONING_PARAMS = {
  temperature: 0.6,
  top_p: 0.95,
  top_k: 20,
  min_p: 0,
  chat_template_kwargs: { enable_thinking: true },
};
```

**Never use greedy decoding (temperature=0) with Qwen3.** It causes endless repetition. Minimum recommended: `temperature=0.1` with `top_k=1` if you need near-determinism.

### Thinking Mode Behavior

When `enable_thinking: true`, the model produces a `<think>...</think>` block before the actual response. This content appears in `message.content` — you must strip it if showing to users:

```typescript
function stripThinking(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
```

Multi-turn conversations: do NOT include `<think>` blocks in the `messages` history you send back to the model. The chat template handles this automatically when using llama-server with `--jinja`, but if you're building message history manually, strip thinking content first.

---

## 14. Critical Gotchas

1. **`--jinja` is not optional.** Without it, tool calling silently fails on Qwen3 — the model outputs `<tool_call>` XML but llama-server does not parse it. The flag is already included in `build_server_args()` above; do not remove it.

2. **GGUF magic bytes differ from Whisper's GGML.** When validating a downloaded model file, check for `GGUF` (`0x47475546`) not `GGML` (`0x67676d6c`). Both are valid model formats but for different tools.

3. **Port conflicts.** `find_free_port(11434)` starts at the default Ollama port. If Ollama is running, this will skip it automatically — but still log a warning so the developer knows. Never hardcode the port.

4. **Startup time is longer than Whisper.** A 5GB model takes 3–15 seconds to load even on Apple Silicon. Show a persistent loading indicator. For macOS, the first Metal compilation may add another 10–30 seconds (same as Whisper — warn user once, cache the compiled model).

5. **Context window memory.** Each context slot uses RAM proportional to `n_ctx × model_layers × head_size`. 8192 context is safe for the recommended models. Do not expose `context_length` as a user-adjustable setting in the UI — it causes OOM crashes. Use the values in the table below:

   | Model | Recommended ctx | Max safe ctx (no GPU) |
   |-------|----------------|----------------------|
   | Qwen3-4B | 8192 | 16384 |
   | Qwen3-8B | 8192 | 16384 |
   | Qwen2.5-14B | 8192 | 8192 |
   | Mistral Small 3 | 4096 | 8192 |

6. **Process orphaning on Tauri crash.** If the app crashes without calling `stop_llm_server`, `llama-server` continues running and holds the port. On next launch, `find_free_port` handles this by trying the next available port, but the orphan process lingers. Add a startup scan: `pkill -f llama-server` before spawning, or check if the previously saved port responds to `/health` and reuse that instance.

7. **Windows: no console window.** On Windows, `llama-server.exe` spawned as a sidecar creates a visible terminal window by default. Suppress it by adding `"windowsHideConsole": true` to the sidecar config in `tauri.conf.json` (Tauri v2 option).

8. **Phi-4-mini chat template.** Phi-4-mini uses a different chat template format from Qwen3. The `--jinja` flag still works (it reads from GGUF metadata), but ensure you're using the official Phi-4-mini GGUF from Microsoft, not a community conversion that may have the wrong template embedded.

9. **No streaming tool calls.** llama-server does not support streaming when `tools` is provided. Always set `stream: false` for tool-calling requests. Streaming works fine for plain text chat completions.

10. **Qwen3-Instruct vs Qwen3-Coder.** These are different models with different chat templates. Qwen3-Coder uses a custom XML tool format that requires the `qwen3_coder` parser in vLLM — it does NOT work with llama-server's standard `--jinja` parsing. For our use case (reliable tool calling in a Tauri sidecar), **always use Qwen3-Instruct**, not Qwen3-Coder.

---

## 15. Status

**[COMPLETED]** Architecture decision and documentation
**[PENDING — Developer Agents]:**
- Download llama-server pre-built binaries for each target platform and rename to Tauri triple convention
- Mirror binaries to `https://assets.aimatrx.com/llama-server/v{VERSION}/`
- Mirror GGUF model files to `https://assets.aimatrx.com/llm-models/`
- Verify SHA256 of all GGUF files from HuggingFace before mirroring
- Implement `src-tauri/src/llm/` module structure
- Wire `LlmServerState` into Tauri app state in `main.rs`
- Register all 6 LLM commands in `generate_handler![]`
- Add `tauri-plugin-shell` and `port_check` to Cargo.toml
- Implement `find_free_port` startup scan / orphan detection
- Add `windowsHideConsole` option for Windows sidecar
- Wire `useLlmStore` into setup wizard UI component
- Test Qwen3-8B tool calling end-to-end on macOS ARM and Windows CUDA before shipping
