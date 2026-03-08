# Whisper Transcription Integration — AI Matrx Desktop (Tauri)

**Target:** `whisper-cpp-plus` + adaptive ggml model selection  
**Platforms:** macOS (Intel + Apple Silicon), Windows, Linux  
**Approach:** On-demand download at first-run setup, not bundled in installer

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Model Catalog & Tier System](#2-model-catalog--tier-system)
3. [Download Strategy & Sources](#3-download-strategy--sources)
4. [Hardware Detection](#4-hardware-detection)
5. [Model Selection Algorithm](#5-model-selection-algorithm)
6. [Cargo.toml Setup](#6-cargotoml-setup)
7. [Platform Build Requirements](#7-platform-build-requirements)
8. [Core Rust Integration](#8-core-rust-integration)
9. [Tauri Commands](#9-tauri-commands)
10. [Frontend Integration](#10-frontend-integration)
11. [First-Run Setup Flow](#11-first-run-setup-flow)
12. [Storage Paths](#12-storage-paths)
13. [API Stability & Cross-Model Compatibility](#13-api-stability--cross-model-compatibility)
14. [Known Gotchas & Edge Cases](#14-known-gotchas--edge-cases)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────┐
│  Tauri Frontend (React/TS)              │
│  - Setup wizard (first run)             │
│  - Transcription UI / live results      │
│  - invoke("start_transcription")        │
└──────────────┬──────────────────────────┘
               │ Tauri IPC
┌──────────────▼──────────────────────────┐
│  Tauri Backend (Rust)                   │
│                                         │
│  ┌──────────────────────────────────┐   │
│  │  TranscriptionManager (Arc<Mutex>│   │
│  │  - Holds WhisperContext          │   │
│  │  - Manages WhisperStream         │   │
│  │  - Emits events to frontend      │   │
│  └──────────────┬───────────────────┘   │
│                 │                       │
│  ┌──────────────▼───────────────────┐   │
│  │  whisper-cpp-plus                │   │
│  │  (compiles whisper.cpp via cmake │   │
│  │   at cargo build time)           │   │
│  └──────────────────────────────────┘   │
│                                         │
│  ┌──────────────────────────────────┐   │
│  │  sysinfo + tauri-plugin-hwinfo   │   │
│  │  (RAM, CPU threads, GPU/VRAM)    │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
               │
        Model files (.bin)
        stored in app_data_dir/models/
        downloaded at first run
```

The whisper.cpp C++ library is compiled from source at `cargo build` time — there is no separate native binary to ship. The model `.bin` files are the only runtime artifacts that need to be downloaded.

---

## 2. Model Catalog & Tier System

All models use the identical `WhisperContext` API. Switching models is a drop-in replacement — no other code changes required.

### Model Specs (ggml format, CPU inference RAM is what matters for desktop)

| Tier | Model File | Disk Size | RAM (runtime) | Relative Speed | WER (EN) | Use Case |
|------|-----------|-----------|---------------|----------------|----------|----------|
| **LOW** | `ggml-tiny.en.bin` | 75 MB | ~390 MB | ~32× realtime | ~5.7% | Low-end machines, fallback |
| **LOW-Q** | `ggml-tiny.en-q5_1.bin` | 32 MB | ~200 MB | ~32× realtime | ~6.2% | Very constrained, RPi-class |
| **DEFAULT** | `ggml-base.en.bin` | 142 MB | ~506 MB | ~16× realtime | ~4.2% | Standard laptops, most users |
| **DEFAULT-Q** | `ggml-base-q5_1.bin` | 60 MB | ~300 MB | ~16× realtime | ~4.5% | Space-saving default variant |
| **HIGH** | `ggml-small.en.bin` | 466 MB | ~1.0 GB | ~6× realtime | ~2.9% | Modern machines with 8GB+ RAM |
| **HIGH-Q** | `ggml-small-q5_1.bin` | 190 MB | ~600 MB | ~6× realtime | ~3.2% | Good machines with modest RAM |

> **Notes:**
> - `.en` suffix = English-only. Do NOT use these if multilingual transcription is needed — use `ggml-base.bin`, `ggml-small.bin` etc. (without `.en`).
> - `q5_1` = quantized at 5-bit precision. About 40–55% smaller disk/RAM, ~5% accuracy loss vs full precision. Recommended when disk space is constrained.
> - Speed multipliers assume CPU-only. Metal (macOS) or CUDA/Vulkan (Win/Linux) can 3–10× these numbers.
> - RAM figures are from `whisper_model_load: mem_required` output from whisper.cpp itself.

### Tier Decision Matrix (English-only deployment)

```
System RAM    → Recommended Tier
< 4 GB        → LOW      (tiny.en)
4–8 GB        → DEFAULT  (base.en)      ← Our shipped default
8–16 GB       → DEFAULT  (base.en) or HIGH (small.en) based on GPU
> 16 GB       → HIGH     (small.en)
```

---

## 3. Download Strategy & Sources

### Primary Source: Hugging Face (ggerganov/whisper.cpp)

The canonical, official GGML model files are hosted by Georgi Gerganov (whisper.cpp author) on Hugging Face. This is the same source used by the official `download-ggml-model.sh` script.

**Base URL pattern:**
```
https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{filename}
```

| Model File | Primary URL | SHA256 |
|-----------|-------------|--------|
| `ggml-tiny.en.bin` | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin` | `c78c86eb1a8faa21b369bcd33207cc90d64ae9df` (verify at HF) |
| `ggml-tiny.en-q5_1.bin` | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin` | `c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b` |
| `ggml-base.en.bin` | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin` | Verify on HF page before mirroring |
| `ggml-base-q5_1.bin` | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin` | Verify on HF page |
| `ggml-small.en.bin` | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin` | Verify on HF page |
| `ggml-small-q5_1.bin` | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin` | Verify on HF page |

> **SHA256 verification:** Always retrieve current SHA256 from the Hugging Face file page (click the file → "Copy download link / Raw pointer file → SHA256"). These values can change when the repo is updated. **Do not hardcode SHA256 from third-party sources.**

### Secondary Source: AWS S3 Mirror (Recommended)

Hugging Face can be rate-limited, geo-blocked, or slow. For production, copy the models to your own S3 bucket for reliability.

**Recommended approach:**
1. Download each model once from HF
2. Verify SHA256 locally
3. Upload to: `s3://ai-matrx-assets/whisper-models/{filename}`
4. Serve via CloudFront: `https://assets.aimatrx.com/whisper-models/{filename}`

In your download logic, implement a fallback chain:
```
Primary: CloudFront/S3 (your CDN)
Fallback: HuggingFace direct
```

### VAD Model (Required for streaming)

The Silero VAD model used by `whisper-cpp-plus` is separate from the Whisper model:

```
https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin
```
- Size: ~864 KB — small enough to bundle in the installer or download silently
- Required for `WhisperStreamPcm` with `use_vad: true`
- Mirror this to your S3 as well

---

## 4. Hardware Detection

Use `sysinfo` (battle-tested, widely used) for RAM and CPU, combined with `tauri-plugin-hwinfo` for GPU/VRAM info (Tauri-native, exposes both CUDA and Vulkan flags).

> **Note:** `tauri-plugin-hwinfo` is confirmed working on Windows; macOS/Linux support is functional but less battle-tested. Fall back to `sysinfo`-only detection if GPU info fails to parse.

### Cargo dependencies

```toml
[dependencies]
sysinfo = "0.32"
tauri-plugin-hwinfo = "0.1"   # provides GPU VRAM + CUDA/Vulkan flags
```

### Hardware snapshot struct

```rust
// src-tauri/src/transcription/hardware.rs

use sysinfo::System;

#[derive(Debug, Clone, serde::Serialize)]
pub struct HardwareProfile {
    pub total_ram_mb: u64,
    pub cpu_threads: usize,
    pub gpu_vram_mb: Option<u64>,
    pub supports_cuda: bool,
    pub supports_vulkan: bool,
    pub is_apple_silicon: bool,
}

impl HardwareProfile {
    pub fn detect() -> Self {
        let mut sys = System::new();
        sys.refresh_memory();
        sys.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());

        let total_ram_mb = sys.total_memory() / 1024 / 1024;
        let cpu_threads = sys.cpus().len();

        // Apple Silicon detection
        let is_apple_silicon = {
            #[cfg(target_os = "macos")]
            {
                std::process::Command::new("uname")
                    .arg("-m")
                    .output()
                    .map(|o| String::from_utf8_lossy(&o.stdout).contains("arm64"))
                    .unwrap_or(false)
            }
            #[cfg(not(target_os = "macos"))]
            { false }
        };

        // GPU info — best-effort, graceful failure
        let (gpu_vram_mb, supports_cuda, supports_vulkan) =
            detect_gpu().unwrap_or((None, false, false));

        HardwareProfile {
            total_ram_mb,
            cpu_threads,
            gpu_vram_mb,
            supports_cuda,
            supports_vulkan,
            is_apple_silicon,
        }
    }
}

fn detect_gpu() -> Option<(Option<u64>, bool, bool)> {
    // tauri-plugin-hwinfo exposes this via its JS/Rust API.
    // Call it from a Tauri command context; here we parse sysinfo as fallback.
    // GPU detection must happen in a Tauri command — see Section 9 for full impl.
    None
}
```

---

## 5. Model Selection Algorithm

The API is **100% identical** across all model tiers. The only thing that changes is the path string passed to `WhisperContext::new()`. This means:
- No conditional code paths in your transcription logic
- Model can be swapped at runtime by reinitializing the context
- Downstream consumers of transcription results are completely unaffected

```rust
// src-tauri/src/transcription/model_selector.rs

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub enum WhisperModelTier {
    Low,       // tiny.en — < 4GB RAM
    Default,   // base.en — 4–8GB RAM (SHIPPED DEFAULT)
    High,      // small.en — 8GB+ RAM with GPU or 16GB+ RAM
}

#[derive(Debug, Clone)]
pub struct ModelSelection {
    pub tier: WhisperModelTier,
    pub filename: &'static str,
    pub download_size_mb: u32,
    pub reason: &'static str,
}

pub fn select_model(hw: &HardwareProfile, user_override: Option<WhisperModelTier>) -> ModelSelection {
    // User can always override the auto-detected tier
    let tier = user_override.unwrap_or_else(|| auto_select_tier(hw));

    match tier {
        WhisperModelTier::Low => ModelSelection {
            tier: WhisperModelTier::Low,
            filename: "ggml-tiny.en.bin",
            download_size_mb: 75,
            reason: "Low RAM detected (< 4GB)",
        },
        WhisperModelTier::Default => ModelSelection {
            tier: WhisperModelTier::Default,
            filename: "ggml-base.en.bin",
            download_size_mb: 142,
            reason: "Recommended default (best accuracy/speed balance)",
        },
        WhisperModelTier::High => ModelSelection {
            tier: WhisperModelTier::High,
            filename: "ggml-small.en.bin",
            download_size_mb: 466,
            reason: "High-performance hardware detected",
        },
    }
}

fn auto_select_tier(hw: &HardwareProfile) -> WhisperModelTier {
    // Apple Silicon: Metal acceleration makes small.en very viable
    if hw.is_apple_silicon && hw.total_ram_mb >= 8192 {
        return WhisperModelTier::High;
    }

    // NVIDIA GPU with CUDA: small.en runs well with GPU offload
    if hw.supports_cuda && hw.gpu_vram_mb.unwrap_or(0) >= 2048 {
        return WhisperModelTier::High;
    }

    // CPU-only path based on RAM
    match hw.total_ram_mb {
        0..=3999 => WhisperModelTier::Low,
        4000..=7999 => WhisperModelTier::Default,
        _ => {
            // 8GB+: use small.en only if there's enough headroom
            // base.en is still safe here; agents can bump to High if desired
            WhisperModelTier::Default
        }
    }
}

/// Returns true if the system has significantly more capability than base.en needs.
/// Used to offer the user an upgrade prompt, not to auto-upgrade silently.
pub fn should_offer_upgrade(hw: &HardwareProfile, current_tier: &WhisperModelTier) -> bool {
    *current_tier == WhisperModelTier::Default
        && (hw.total_ram_mb >= 16384 || hw.is_apple_silicon || hw.supports_cuda)
}
```

---

## 6. Cargo.toml Setup

```toml
# src-tauri/Cargo.toml

[dependencies]
# Transcription
whisper-cpp-plus = { version = "0.1", features = ["async"] }

# Hardware detection
sysinfo = { version = "0.32", default-features = false, features = ["system"] }
tauri-plugin-hwinfo = "0.1"

# Async runtime (already in Tauri but explicit)
tokio = { version = "1", features = ["full"] }

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# HTTP for model download
reqwest = { version = "0.12", features = ["stream", "json"] }

# Progress tracking during download
futures-util = "0.3"

[build-dependencies]
# whisper-cpp-plus-sys handles whisper.cpp compilation via cmake automatically
# cmake must be installed on the developer's machine — see Section 7

[features]
# Enable CUDA on Windows/Linux builds where CUDA toolkit is present
cuda = ["whisper-cpp-plus/cuda"]
# Enable Vulkan (cross-vendor GPU) — good fallback on Linux/Windows
vulkan = ["whisper-cpp-plus/vulkan"]
# Metal is auto-enabled on macOS — no feature flag needed
```

> **Feature flag behavior:**
> - Metal (macOS): Enabled automatically by whisper-cpp-plus on macOS builds. No flag needed.
> - CUDA: Must be opt-in because it requires the CUDA toolkit at build time. Enable with `cargo build --features cuda`.
> - Vulkan: Enabled via `--features vulkan`. Requires Vulkan drivers but no special toolkit.
> - CPU-only (default): Works everywhere with zero extra dependencies. SIMD (AVX, NEON) is auto-detected at runtime.

---

## 7. Platform Build Requirements

### All Platforms
- **Rust** 1.75+
- **CMake** 3.21+ (required by `whisper-cpp-plus-sys` to compile whisper.cpp)
- **C++17 compiler** (clang on macOS, MSVC on Windows, gcc on Linux)

### macOS
```bash
# Install cmake if not present
brew install cmake

# Metal is automatically enabled — no extra setup
# whisper-cpp-plus-sys detects macOS and enables Metal backend via cmake

# For Apple Silicon: Core ML acceleration (optional, 3× faster than Metal alone)
# Only needed if you want ANE (Neural Engine) support — overkill for most use cases
# pip install ane_transformers openai-whisper coremltools
# (generates ggml-base.en-encoder.mlmodelc alongside the .bin file)
```

### Windows
```powershell
# Required: Visual Studio 2019+ with C++ workload, or Build Tools equivalent
# Required: cmake (winget install cmake or choco install cmake)
winget install cmake

# For CPU-only builds (default, works everywhere):
# No additional dependencies

# For CUDA builds:
# Install CUDA Toolkit 12.x from https://developer.nvidia.com/cuda-downloads
# Then build with: cargo build --features cuda
# CUDA_PATH environment variable must be set

# For Vulkan builds (NVIDIA, AMD, Intel iGPU):
# Install Vulkan SDK from https://vulkan.lunarg.com/
# Then build with: cargo build --features vulkan
```

### Linux
```bash
# Ubuntu/Debian
sudo apt install cmake build-essential

# For CUDA (NVIDIA):
# Install CUDA Toolkit per NVIDIA instructions
# cargo build --features cuda

# For Vulkan:
sudo apt install libvulkan-dev vulkan-tools
# cargo build --features vulkan

# For OpenBLAS (CPU acceleration):
sudo apt install libopenblas-dev
# whisper-cpp-plus will auto-detect and link it if present
```

### CI/CD Notes
- Use `cargo build` without feature flags for universal CPU-only builds — ships to all users
- CUDA/Vulkan builds are optional per-platform distribution variants
- Do not require GPU presence at runtime; gracefully fall back to CPU

---

## 8. Core Rust Integration

### Module structure
```
src-tauri/src/
  transcription/
    mod.rs
    hardware.rs        ← HardwareProfile (Section 4)
    model_selector.rs  ← Tier selection (Section 5)
    downloader.rs      ← Model download with progress
    manager.rs         ← TranscriptionManager (context + streaming)
    commands.rs        ← Tauri #[command] functions (Section 9)
```

### `downloader.rs` — Model download with progress events

```rust
// src-tauri/src/transcription/downloader.rs

use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;
use futures_util::StreamExt;

const CDN_BASE: &str = "https://assets.aimatrx.com/whisper-models";
const HF_BASE: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

pub struct DownloadProgress {
    pub filename: String,
    pub bytes_downloaded: u64,
    pub total_bytes: u64,
    pub percent: f32,
}

/// Downloads a model file, emitting progress via a callback.
/// Tries CDN first, falls back to HuggingFace.
pub async fn download_model(
    filename: &str,
    dest_dir: &Path,
    on_progress: impl Fn(DownloadProgress),
) -> Result<PathBuf, String> {
    let dest_path = dest_dir.join(filename);

    // Skip if already present and non-empty
    if dest_path.exists() {
        let size = std::fs::metadata(&dest_path)
            .map(|m| m.len())
            .unwrap_or(0);
        if size > 1_000_000 {
            return Ok(dest_path);
        }
    }

    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;

    // Try CDN first, then HuggingFace
    let urls = [
        format!("{}/{}", CDN_BASE, filename),
        format!("{}/{}", HF_BASE, filename),
    ];

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let mut last_error = String::new();
    for url in &urls {
        match try_download(&client, url, &dest_path, &on_progress).await {
            Ok(_) => return Ok(dest_path),
            Err(e) => {
                last_error = format!("Failed {}: {}", url, e);
                // Clean up partial file before trying next source
                let _ = tokio::fs::remove_file(&dest_path).await;
            }
        }
    }

    Err(format!("All download sources failed. Last error: {}", last_error))
}

async fn try_download(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
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

        let filename = dest.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        on_progress(DownloadProgress {
            filename,
            bytes_downloaded: downloaded,
            total_bytes: total,
            percent: if total > 0 { (downloaded as f32 / total as f32) * 100.0 } else { 0.0 },
        });
    }

    file.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}
```

### `manager.rs` — Transcription context + streaming

```rust
// src-tauri/src/transcription/manager.rs

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use whisper_cpp_plus::{
    WhisperContext, WhisperStream, WhisperStreamConfig, FullParams, SamplingStrategy,
};

pub struct TranscriptionManager {
    ctx: Arc<WhisperContext>,
    model_path: PathBuf,
}

impl TranscriptionManager {
    /// Load a model from disk. This blocks briefly (~100–500ms depending on model size).
    /// Call from a spawn_blocking context, not on the async executor.
    pub fn load(model_path: PathBuf) -> Result<Self, String> {
        let ctx = WhisperContext::new(
            model_path.to_str().ok_or("Invalid model path")?
        ).map_err(|e| format!("Failed to load whisper model: {}", e))?;

        Ok(TranscriptionManager {
            ctx: Arc::new(ctx),
            model_path,
        })
    }

    /// Reload with a different model (e.g., user upgrades tier).
    /// Returns a new manager — the old one can be dropped.
    pub fn reload(self, new_model_path: PathBuf) -> Result<Self, String> {
        drop(self); // Explicitly free previous model memory
        Self::load(new_model_path)
    }

    /// Start a real-time streaming transcription session.
    /// Audio chunks must be 16kHz mono f32 PCM.
    /// Calls `on_segment` for each completed transcription segment.
    pub fn start_stream(
        &self,
        n_threads: usize,
        on_segment: impl Fn(String, f32, f32) + Send + 'static,
    ) -> Result<WhisperStream, String> {
        let params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 })
            .language("en")
            .no_context(false)      // Keep context between chunks for coherence
            .single_segment(false)  // Allow multiple segments per chunk
            .n_threads(n_threads as i32);

        let config = WhisperStreamConfig {
            step_ms: 3000,          // Process every 3 seconds of audio
            length_ms: 10000,       // Keep 10 seconds of sliding window
            keep_ms: 200,           // Overlap to avoid word boundary cuts
            ..Default::default()
        };

        let mut stream = WhisperStream::with_config(&self.ctx, params, config)
            .map_err(|e| format!("Failed to create stream: {}", e))?;

        // This is the callback called per transcribed segment
        // Note: WhisperStream::process_step() must be called in a loop by caller
        Ok(stream)
    }

    /// Transcribe a complete audio buffer (non-streaming, for file input).
    /// Audio must be 16kHz mono f32 PCM.
    pub fn transcribe_buffer(&self, audio: &[f32]) -> Result<String, String> {
        self.ctx.transcribe(audio)
            .map_err(|e| format!("Transcription error: {}", e))
    }

    pub fn model_path(&self) -> &PathBuf {
        &self.model_path
    }
}

// Safe to share across threads
unsafe impl Send for TranscriptionManager {}
unsafe impl Sync for TranscriptionManager {}
```

### Audio capture (16kHz PCM from microphone)

whisper.cpp requires **16kHz mono f32 PCM**. Use `cpal` for cross-platform audio capture:

```toml
# Add to Cargo.toml
cpal = "0.15"
```

```rust
// src-tauri/src/transcription/audio_capture.rs

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};

pub struct AudioCapture {
    stream: cpal::Stream,
    buffer: Arc<Mutex<Vec<f32>>>,
}

impl AudioCapture {
    /// Starts capturing microphone input, resampled to 16kHz mono f32.
    /// Captured audio is pushed to an internal ring buffer.
    pub fn start() -> Result<Self, String> {
        let host = cpal::default_host();
        let device = host.default_input_device()
            .ok_or("No input device found")?;

        // Request 16kHz mono — whisper's required format
        let config = cpal::StreamConfig {
            channels: 1,
            sample_rate: cpal::SampleRate(16000),
            buffer_size: cpal::BufferSize::Default,
        };

        let buffer = Arc::new(Mutex::new(Vec::<f32>::new()));
        let buffer_clone = Arc::clone(&buffer);

        let stream = device.build_input_stream(
            &config,
            move |data: &[f32], _| {
                let mut buf = buffer_clone.lock().unwrap();
                buf.extend_from_slice(data);
                // Keep buffer bounded to ~30s to avoid unbounded growth
                const MAX_SAMPLES: usize = 16000 * 30;
                if buf.len() > MAX_SAMPLES {
                    let drain_count = buf.len() - MAX_SAMPLES;
                    buf.drain(0..drain_count);
                }
            },
            |err| eprintln!("Audio capture error: {}", err),
            None,
        ).map_err(|e| format!("Failed to build audio stream: {}", e))?;

        stream.play().map_err(|e| format!("Failed to start audio: {}", e))?;

        Ok(AudioCapture { stream, buffer })
    }

    /// Drains accumulated audio samples for processing.
    pub fn drain(&self) -> Vec<f32> {
        let mut buf = self.buffer.lock().unwrap();
        let samples = buf.clone();
        buf.clear();
        samples
    }

    /// Returns a snapshot without clearing.
    pub fn peek(&self) -> Vec<f32> {
        self.buffer.lock().unwrap().clone()
    }
}
```

> **Note on sample rates:** If the user's microphone doesn't support 16kHz, `cpal` will error. For production robustness, capture at the native rate and resample to 16kHz using the `rubato` crate (`cargo add rubato`).

---

## 9. Tauri Commands

```rust
// src-tauri/src/transcription/commands.rs

use tauri::{AppHandle, Manager, State, Emitter};
use std::sync::Mutex;
use super::{
    hardware::HardwareProfile,
    model_selector::{select_model, WhisperModelTier},
    downloader::download_model,
    manager::TranscriptionManager,
};

// Global state
pub struct TranscriptionState(pub Mutex<Option<TranscriptionManager>>);

/// Called during setup wizard — detect hardware and return recommendation.
#[tauri::command]
pub async fn detect_hardware(app: AppHandle) -> Result<serde_json::Value, String> {
    let hw = HardwareProfile::detect();

    // Try to get GPU info via tauri-plugin-hwinfo
    // (this runs in command context where the plugin is available)
    let gpu_info = app.invoke_plugin::<tauri_plugin_hwinfo::HwinfoPlugin>("get_gpu_info")
        .ok();

    let selection = select_model(&hw, None);

    Ok(serde_json::json!({
        "hardware": hw,
        "recommended_tier": selection.tier,
        "recommended_filename": selection.filename,
        "recommended_size_mb": selection.download_size_mb,
        "reason": selection.reason,
        "can_upgrade": super::model_selector::should_offer_upgrade(&hw, &selection.tier),
    }))
}

/// Download the selected model with live progress events.
#[tauri::command]
pub async fn download_whisper_model(
    app: AppHandle,
    filename: String,
) -> Result<String, String> {
    let models_dir = app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");

    let app_clone = app.clone();
    let dest = download_model(
        &filename,
        &models_dir,
        move |progress| {
            let _ = app_clone.emit("whisper-download-progress", serde_json::json!({
                "filename": progress.filename,
                "bytes_downloaded": progress.bytes_downloaded,
                "total_bytes": progress.total_bytes,
                "percent": progress.percent,
            }));
        },
    ).await?;

    Ok(dest.to_string_lossy().to_string())
}

/// Initialize (or re-initialize) the transcription context with a model.
/// This is called after download completes, or when user switches models.
#[tauri::command]
pub async fn init_transcription(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    filename: String,
) -> Result<(), String> {
    let model_path = app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models")
        .join(&filename);

    if !model_path.exists() {
        return Err(format!("Model not found at {:?}", model_path));
    }

    let manager = tokio::task::spawn_blocking(move || {
        TranscriptionManager::load(model_path)
    }).await
        .map_err(|e| e.to_string())??;

    *state.0.lock().unwrap() = Some(manager);
    Ok(())
}

/// Start real-time transcription from microphone.
/// Emits "whisper-segment" events with transcription results.
#[tauri::command]
pub async fn start_transcription(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
) -> Result<(), String> {
    use super::audio_capture::AudioCapture;

    let manager_guard = state.0.lock().unwrap();
    let manager = manager_guard.as_ref()
        .ok_or("Transcription not initialized — call init_transcription first")?;

    let hw = HardwareProfile::detect();
    let n_threads = (hw.cpu_threads / 2).max(1).min(8);

    let app_clone = app.clone();
    let mut stream = manager.start_stream(n_threads, move |text, t0, t1| {
        let _ = app_clone.emit("whisper-segment", serde_json::json!({
            "text": text,
            "start_sec": t0,
            "end_sec": t1,
        }));
    })?;

    // Spawn audio capture + inference loop
    let app_events = app.clone();
    tokio::spawn(async move {
        let capture = match AudioCapture::start() {
            Ok(c) => c,
            Err(e) => {
                let _ = app_events.emit("whisper-error", e);
                return;
            }
        };

        loop {
            // Feed audio to stream
            let samples = capture.drain();
            if !samples.is_empty() {
                stream.feed_audio(&samples);
            }

            // Process any pending inference
            match stream.process_step() {
                Ok(Some(segments)) => {
                    for seg in segments {
                        let _ = app_events.emit("whisper-segment", serde_json::json!({
                            "text": seg.text,
                            "start_sec": seg.start_seconds(),
                            "end_sec": seg.end_seconds(),
                        }));
                    }
                }
                Ok(None) => {} // No segments ready yet
                Err(e) => {
                    let _ = app_events.emit("whisper-error", e.to_string());
                    break;
                }
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
    });

    Ok(())
}

/// Check if a model file exists and is valid (non-empty).
#[tauri::command]
pub fn check_model_exists(app: AppHandle, filename: String) -> bool {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("models").join(&filename))
        .and_then(|p| std::fs::metadata(p).ok())
        .map(|m| m.len() > 1_000_000)
        .unwrap_or(false)
}

/// Get the currently active model filename.
#[tauri::command]
pub fn get_active_model(state: State<'_, TranscriptionState>) -> Option<String> {
    state.0.lock().unwrap()
        .as_ref()
        .map(|m| m.model_path().file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string())
}
```

### Register in `main.rs`

```rust
// src-tauri/src/main.rs

mod transcription;
use transcription::commands::*;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_hwinfo::init())
        .manage(TranscriptionState(std::sync::Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            detect_hardware,
            download_whisper_model,
            init_transcription,
            start_transcription,
            check_model_exists,
            get_active_model,
        ])
        .run(tauri::generate_context!())
        .expect("error running app");
}
```

---

## 10. Frontend Integration

### TypeScript types

```typescript
// src/lib/transcription/types.ts

export type WhisperModelTier = 'Low' | 'Default' | 'High';

export interface HardwareDetectionResult {
  hardware: {
    total_ram_mb: number;
    cpu_threads: number;
    gpu_vram_mb: number | null;
    supports_cuda: boolean;
    supports_vulkan: boolean;
    is_apple_silicon: boolean;
  };
  recommended_tier: WhisperModelTier;
  recommended_filename: string;
  recommended_size_mb: number;
  reason: string;
  can_upgrade: boolean;
}

export interface WhisperSegment {
  text: string;
  start_sec: number;
  end_sec: number;
}

export interface DownloadProgress {
  filename: string;
  bytes_downloaded: number;
  total_bytes: number;
  percent: number;
}
```

### Transcription store (Zustand)

```typescript
// src/lib/transcription/store.ts

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import type { HardwareDetectionResult, WhisperSegment, DownloadProgress } from './types';

interface TranscriptionStore {
  isInitialized: boolean;
  isRecording: boolean;
  segments: WhisperSegment[];
  downloadProgress: DownloadProgress | null;
  activeModel: string | null;
  error: string | null;

  detectHardware: () => Promise<HardwareDetectionResult>;
  downloadModel: (filename: string) => Promise<void>;
  initTranscription: (filename: string) => Promise<void>;
  startTranscription: () => Promise<void>;
  checkModelExists: (filename: string) => Promise<boolean>;
}

export const useTranscriptionStore = create<TranscriptionStore>((set, get) => ({
  isInitialized: false,
  isRecording: false,
  segments: [],
  downloadProgress: null,
  activeModel: null,
  error: null,

  detectHardware: async () => {
    return await invoke<HardwareDetectionResult>('detect_hardware');
  },

  downloadModel: async (filename: string) => {
    // Listen for progress events
    const unlisten = await listen<DownloadProgress>('whisper-download-progress', (event) => {
      set({ downloadProgress: event.payload });
    });

    try {
      await invoke('download_whisper_model', { filename });
      set({ downloadProgress: null });
    } finally {
      unlisten();
    }
  },

  initTranscription: async (filename: string) => {
    await invoke('init_transcription', { filename });
    set({ isInitialized: true, activeModel: filename });
  },

  startTranscription: async () => {
    if (!get().isInitialized) throw new Error('Transcription not initialized');

    // Listen for transcription segments
    await listen<WhisperSegment>('whisper-segment', (event) => {
      set((state) => ({
        segments: [...state.segments, event.payload],
      }));
    });

    // Listen for errors
    await listen<string>('whisper-error', (event) => {
      set({ error: event.payload, isRecording: false });
    });

    await invoke('start_transcription');
    set({ isRecording: true, segments: [] });
  },

  checkModelExists: async (filename: string) => {
    return await invoke<boolean>('check_model_exists', { filename });
  },
}));
```

### Setup wizard component (skeleton)

```typescript
// src/components/setup/WhisperSetupStep.tsx

import { useEffect, useState } from 'react';
import { useTranscriptionStore } from '@/lib/transcription/store';
import type { HardwareDetectionResult } from '@/lib/transcription/types';

export function WhisperSetupStep({ onComplete }: { onComplete: () => void }) {
  const { detectHardware, downloadModel, initTranscription, checkModelExists } =
    useTranscriptionStore();
  const [hwResult, setHwResult] = useState<HardwareDetectionResult | null>(null);
  const [selectedFilename, setSelectedFilename] = useState<string>('ggml-base.en.bin');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [status, setStatus] = useState<'detecting' | 'ready' | 'downloading' | 'done'>('detecting');

  useEffect(() => {
    detectHardware().then((result) => {
      setHwResult(result);
      setSelectedFilename(result.recommended_filename);
      setStatus('ready');
    });
  }, []);

  const handleInstall = async () => {
    if (!hwResult) return;
    setStatus('downloading');

    // Check if already downloaded
    const exists = await checkModelExists(selectedFilename);
    if (!exists) {
      await downloadModel(selectedFilename);
    }

    await initTranscription(selectedFilename);
    setStatus('done');
    onComplete();
  };

  // Render setup UI using hwResult.reason, hwResult.can_upgrade,
  // downloadProgress from store subscription, etc.
  // ...
}
```

---

## 11. First-Run Setup Flow

```
App first launch
      │
      ▼
Check app_data_dir/models/*.bin exists?
      │
  No  │  Yes
      │   └──► Load cached model → skip to main app
      ▼
Show "Setting up voice features" screen
      │
      ▼
invoke("detect_hardware")
      │
      ▼
Display: "We recommend [model] for your system ([reason])"
         "Download size: [X] MB"
         [Optional: "Upgrade to [Higher] for better accuracy (Y MB)"]
      │
User confirms
      ▼
invoke("download_whisper_model", { filename })
← listen("whisper-download-progress") → update progress bar
      │
      ▼
Download complete + file integrity check (size > 1MB)
      │
      ▼
invoke("init_transcription", { filename })
[Model loads into memory ~100–500ms]
      │
      ▼
Save selected_model to app config (persist across launches)
      │
      ▼
Transcription ready → continue setup
```

### Persisting model choice

```rust
// On app startup, read saved model from config
// src-tauri/src/transcription/config.rs

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Default)]
pub struct TranscriptionConfig {
    pub selected_model: Option<String>,
}

impl TranscriptionConfig {
    pub fn load(config_dir: &PathBuf) -> Self {
        let path = config_dir.join("transcription.json");
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, config_dir: &PathBuf) -> Result<(), String> {
        let path = config_dir.join("transcription.json");
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(path, json).map_err(|e| e.to_string())
    }
}
```

---

## 12. Storage Paths

Models live in Tauri's app data directory, which is platform-appropriate:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/ai.matrx.desktop/models/` |
| Windows | `C:\Users\{user}\AppData\Roaming\ai.matrx.desktop\models\` |
| Linux | `~/.local/share/ai.matrx.desktop/models/` |

In Rust:
```rust
let models_dir = app.path().app_data_dir()?.join("models");
```

In TypeScript:
```typescript
import { appDataDir } from '@tauri-apps/api/path';
const modelsDir = `${await appDataDir()}/models`;
```

---

## 13. API Stability & Cross-Model Compatibility

**The `WhisperContext` API is identical for all model tiers.** Confirmed:

```rust
// Works with ggml-tiny.en.bin, ggml-base.en.bin, ggml-small.en.bin — identical call
let ctx = WhisperContext::new("path/to/any-model.bin")?;
let text = ctx.transcribe(&audio)?;

// WhisperStream is also identical across models
let stream = WhisperStream::with_config(&ctx, params, config)?;
stream.feed_audio(&chunk);
let segments = stream.process_step()?;
```

**Output format is identical.** Each `Segment` has:
- `.text: String` — transcribed text
- `.start_seconds() -> f32` — start timestamp
- `.end_seconds() -> f32` — end timestamp

**What changes between models:**
- Accuracy (WER)
- Inference latency per chunk
- RAM footprint at runtime
- Disk space required

**What does NOT change:**
- Function signatures
- Output struct fields
- Streaming behavior
- VAD behavior
- Event emission to frontend

This means your model selection logic is entirely in the initialization path. Everything downstream — the Tauri event system, the frontend store, the UI — has zero awareness of which model tier is active.

---

## 14. Known Gotchas & Edge Cases

### Build time
- `whisper-cpp-plus` compiles whisper.cpp C++ from source via cmake on first `cargo build`. This takes **2–5 minutes** on first build. Subsequent builds are cached. Make sure your CI allocates enough time.

### Windows MSVC vs GNU
- Windows builds must use MSVC toolchain (`x86_64-pc-windows-msvc`). The GNU target does not link correctly with cmake-compiled C++ code. Confirm with: `rustup default stable-x86_64-pc-windows-msvc`.

### First inference latency
- The very first inference call after loading a model is slow (~500ms–2s) due to SIMD warmup and memory layout optimization. This is normal. Subsequent calls are fast. Do a silent warmup call on init with a short empty buffer if perceived latency matters.
- On macOS with Core ML: the first run compiles a device-specific `.mlmodelc` — can take 10–30 seconds on first launch ever. Cached afterward.

### Audio sample rate
- **Hard requirement:** Input must be **16kHz mono f32 PCM**. If the microphone doesn't support 16kHz natively, use `rubato` for resampling:
  ```toml
  rubato = "0.15"
  ```

### Model file validation
- After downloading, verify the file is non-empty and non-corrupt. A partial download that passes size check can crash the app on load. Consider validating by checking the first 4 bytes match the GGML magic bytes `0x67676d6c` (`ggml` in ASCII).

### Memory pressure on < 4GB RAM
- Even `tiny.en` needs ~390MB RAM. On machines with 4GB total, OS overhead leaves ~2.5GB free. Monitor for OOM errors and surface a clear message if the model fails to load.

### Thread count tuning
- Default: `cpu_threads / 2`, capped at 8. More threads isn't always faster due to cache thrashing. Do not go above physical core count. For M1/M2 Macs, 4 threads is often optimal since Metal handles the heavy lifting.

### Multilingual users
- The `.en` models (`ggml-base.en.bin`) **only work for English**. If AI Matrx needs multilingual transcription in the future, switch to `ggml-base.bin` (148 MB vs 142 MB, negligible difference). The API call is identical — just swap the filename.

### HuggingFace download reliability
- HF occasionally rate-limits or has CDN issues. This is why the AWS S3 fallback is important. Implement retry logic (3 attempts with exponential backoff) in `try_download()`.

### Tauri v2 path API
- Use `app.path().app_data_dir()` not the deprecated `tauri::api::path::app_data_dir()`. The former is Tauri v2 style.

---

## Quick Reference

### Minimum viable integration checklist

- [ ] `cmake` installed on all developer machines and CI
- [ ] `whisper-cpp-plus` added to `Cargo.toml`
- [ ] `sysinfo` + `tauri-plugin-hwinfo` added to `Cargo.toml`
- [ ] `cpal` added for audio capture
- [ ] `reqwest` + `futures-util` added for model download
- [ ] `TranscriptionState` managed in Tauri builder
- [ ] `tauri-plugin-hwinfo` initialized in Tauri builder
- [ ] All 6 Tauri commands registered in `generate_handler!`
- [ ] VAD model (`ggml-silero-v6.2.0.bin`) downloaded alongside Whisper model
- [ ] Models mirrored to your AWS S3 bucket
- [ ] First-run setup wizard calls `detect_hardware` → `download_whisper_model` → `init_transcription`
- [ ] App config persists `selected_model` so re-init on next launch is instant

### Model download URLs at a glance

```
# CDN (preferred)
https://assets.aimatrx.com/whisper-models/ggml-tiny.en.bin       (75 MB)
https://assets.aimatrx.com/whisper-models/ggml-base.en.bin       (142 MB) ← DEFAULT
https://assets.aimatrx.com/whisper-models/ggml-small.en.bin      (466 MB)
https://assets.aimatrx.com/whisper-models/ggml-silero-v6.2.0.bin (0.8 MB) ← VAD

# HuggingFace fallback
https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin
```
