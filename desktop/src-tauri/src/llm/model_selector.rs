use crate::transcription::hardware::HardwareProfile;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LlmTier {
    Low,
    LowAlt,
    Default,
    High,
    HighAlt,
}

/// Describes how a model is hosted on HuggingFace.
///
/// Single-file models: `filename` is the single file; `hf_parts` is empty.
///
/// Split models: llama.cpp can load multi-part GGUF natively by passing the first
/// part filename (e.g. `...-00001-of-00003.gguf`). We download each part with its
/// original HuggingFace name (preserving the `-00001-of-N` suffix) and store them
/// all in the models directory. `filename` is the first part filename — that is
/// what we pass to llama-server. Parts MUST keep their original split filenames so
/// that llama.cpp's split-file validation passes.
#[derive(Debug, Clone, Serialize)]
pub struct LlmModelInfo {
    pub tier: LlmTier,
    pub name: &'static str,
    /// For single-file models: the .gguf filename.
    /// For split models: the **first part** filename (e.g. `...-00001-of-00003.gguf`).
    /// This is the value passed to llama-server -m.
    pub filename: &'static str,
    pub disk_size_gb: f32,
    pub ram_required_gb: f32,
    pub tool_calling_rating: u8,
    pub speed: &'static str,
    pub description: &'static str,
    /// URL for the first (or only) file.
    pub hf_url: &'static str,
    /// Additional part URLs for split models, in order. Empty = single-file model.
    /// Each URL's filename is preserved on disk exactly as the HuggingFace name.
    pub hf_parts: &'static [&'static str],
    pub context_length: u32,
    /// Expected size of the first part (single file) or first part for split models,
    /// in bytes. Used to validate the download. For split models, validate each part
    /// separately using `hf_part_sizes`.
    pub expected_size_bytes: u64,
    /// Expected sizes for additional parts (index 0 = second part, etc.).
    /// Empty for single-file models or if unknown.
    pub hf_part_sizes: &'static [u64],
}

impl LlmModelInfo {
    /// Returns true if this model is distributed as multiple split files.
    pub fn is_split(&self) -> bool {
        !self.hf_parts.is_empty()
    }

    /// Returns all download URLs in order (part 1 first).
    pub fn all_part_urls(&self) -> Vec<&'static str> {
        let mut urls = vec![self.hf_url];
        urls.extend_from_slice(self.hf_parts);
        urls
    }

    /// For split models, return the filenames for each part in order.
    /// The filenames are extracted from the URLs (last path segment).
    /// For single-file models, returns `[self.filename]`.
    pub fn all_part_filenames(&self) -> Vec<String> {
        if !self.is_split() {
            return vec![self.filename.to_string()];
        }
        let all_urls = self.all_part_urls();
        all_urls
            .iter()
            .map(|url| url.rsplit('/').next().unwrap_or("unknown.gguf").to_string())
            .collect()
    }
}

// Verified 2026-03-11 against HuggingFace API + HEAD requests.
// Single-file status confirmed by checking x-linked-size response headers.
// Split-file part names confirmed against repository siblings list.
// expected_size_bytes values from verified x-linked-size headers.
//
// IMPORTANT for split models: `filename` is the FIRST PART filename (preserving
// the `-00001-of-N` suffix). llama-server receives this path and loads all parts
// automatically. We do NOT concatenate parts.
pub const LLM_MODELS: &[LlmModelInfo] = &[
    LlmModelInfo {
        tier: LlmTier::Low,
        name: "Qwen3-4B-Instruct",
        // Single file — 2,497,280,256 bytes (2.49 GB). Verified via x-linked-size.
        filename: "Qwen3-4B-Q4_K_M.gguf",
        disk_size_gb: 2.5,
        ram_required_gb: 4.0,
        tool_calling_rating: 4,
        speed: "Fast",
        description: "Compact model with strong tool calling. Best for low-RAM machines.",
        hf_url: "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf",
        hf_parts: &[],
        context_length: 8192,
        expected_size_bytes: 2_497_280_256,
        hf_part_sizes: &[],
    },
    LlmModelInfo {
        tier: LlmTier::LowAlt,
        name: "Phi-4-mini-Instruct",
        // Single file — 2,491,874,688 bytes (2.49 GB). Hosted by bartowski.
        filename: "microsoft_Phi-4-mini-instruct-Q4_K_M.gguf",
        disk_size_gb: 2.5,
        ram_required_gb: 3.5,
        tool_calling_rating: 4,
        speed: "Very fast",
        description: "Microsoft's compact model. Fastest option for low-resource systems.",
        hf_url: "https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF/resolve/main/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf",
        hf_parts: &[],
        context_length: 8192,
        expected_size_bytes: 2_491_874_688,
        hf_part_sizes: &[],
    },
    LlmModelInfo {
        tier: LlmTier::Default,
        name: "Qwen3-8B-Instruct",
        // Single file — 5,027,783,488 bytes (5.03 GB). Verified via x-linked-size.
        filename: "Qwen3-8B-Q4_K_M.gguf",
        disk_size_gb: 5.1,
        ram_required_gb: 6.5,
        tool_calling_rating: 5,
        speed: "Medium",
        description: "Recommended default. Best balance of quality and speed for tool calling.",
        hf_url: "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf",
        hf_parts: &[],
        context_length: 8192,
        expected_size_bytes: 5_027_783_488,
        hf_part_sizes: &[],
    },
    LlmModelInfo {
        tier: LlmTier::High,
        name: "Qwen2.5-14B-Instruct",
        // SPLIT: 3 native parts. `filename` = first part; llama-server loads all
        // parts automatically when given the first-part path.
        // Part sizes: 3,991,999,872 + 3,989,373,504 + 1,006,737,120 bytes.
        filename: "qwen2.5-14b-instruct-q4_k_m-00001-of-00003.gguf",
        disk_size_gb: 9.0,
        ram_required_gb: 10.0,
        tool_calling_rating: 5,
        speed: "Slow (GPU recommended)",
        description: "High-quality reasoning. Requires 10GB+ RAM or dedicated GPU.",
        hf_url: "https://huggingface.co/Qwen/Qwen2.5-14B-Instruct-GGUF/resolve/main/qwen2.5-14b-instruct-q4_k_m-00001-of-00003.gguf",
        hf_parts: &[
            "https://huggingface.co/Qwen/Qwen2.5-14B-Instruct-GGUF/resolve/main/qwen2.5-14b-instruct-q4_k_m-00002-of-00003.gguf",
            "https://huggingface.co/Qwen/Qwen2.5-14B-Instruct-GGUF/resolve/main/qwen2.5-14b-instruct-q4_k_m-00003-of-00003.gguf",
        ],
        context_length: 8192,
        expected_size_bytes: 3_991_999_872,
        hf_part_sizes: &[3_989_373_504, 1_006_737_120],
    },
    LlmModelInfo {
        tier: LlmTier::HighAlt,
        name: "Mistral-Small-3.1-24B",
        // Single file — 14,333,910,176 bytes (14.33 GB). lmstudio-community public repo.
        filename: "Mistral-Small-3.1-24B-Instruct-2503-Q4_K_M.gguf",
        disk_size_gb: 14.4,
        ram_required_gb: 16.0,
        tool_calling_rating: 5,
        speed: "GPU required",
        description: "Largest supported model. Requires 16GB+ RAM and GPU acceleration.",
        hf_url: "https://huggingface.co/lmstudio-community/Mistral-Small-3.1-24B-Instruct-2503-GGUF/resolve/main/Mistral-Small-3.1-24B-Instruct-2503-Q4_K_M.gguf",
        hf_parts: &[],
        context_length: 4096,
        expected_size_bytes: 14_333_910_176,
        hf_part_sizes: &[],
    },
];

#[derive(Debug, Clone, Serialize)]
pub struct LlmModelSelection {
    pub tier: LlmTier,
    pub filename: &'static str,
    pub name: &'static str,
    pub disk_size_gb: f32,
    pub reason: String,
    pub can_upgrade: bool,
    pub gpu_layers: i32,
}

pub fn select_llm_model(hw: &HardwareProfile) -> LlmModelSelection {
    let total_ram_gb = hw.total_ram_mb as f32 / 1024.0;
    let gpu_vram_gb = hw.gpu_vram_mb.map(|v| v as f32 / 1024.0).unwrap_or(0.0);

    let (tier, reason) = select_tier(hw, total_ram_gb, gpu_vram_gb);
    let gpu_layers = compute_gpu_layers(hw, gpu_vram_gb);
    let can_upgrade = can_upgrade_tier(&tier, total_ram_gb, gpu_vram_gb, hw.is_apple_silicon);

    let model = get_model_info(&tier);

    LlmModelSelection {
        tier,
        filename: model.filename,
        name: model.name,
        disk_size_gb: model.disk_size_gb,
        reason,
        can_upgrade,
        gpu_layers,
    }
}

fn select_tier(hw: &HardwareProfile, total_ram_gb: f32, gpu_vram_gb: f32) -> (LlmTier, String) {
    // ── Apple Silicon (Metal, unified memory) ────────────────────────────────
    if hw.is_apple_silicon {
        if total_ram_gb >= 16.0 {
            return (
                LlmTier::High,
                "Apple Silicon with 16GB+ RAM — Qwen2.5-14B runs well with Metal".to_string(),
            );
        }
        if total_ram_gb >= 8.0 {
            return (
                LlmTier::Default,
                "Apple Silicon with 8GB+ RAM — Qwen3-8B recommended with Metal acceleration"
                    .to_string(),
            );
        }
        // <8GB Apple Silicon — use compact model
        return (
            LlmTier::Low,
            format!(
                "Apple Silicon with {:.0}GB RAM — using compact Qwen3-4B model",
                total_ram_gb
            ),
        );
    }

    // ── Dedicated GPU (CUDA or Vulkan) ────────────────────────────────────────
    // Both CUDA and Vulkan backends can use the gpu_vram_gb value for decisions.
    // The Vulkan llama-server binary handles both NVIDIA (via Vulkan) and AMD/Intel.
    if hw.supports_cuda || hw.supports_vulkan {
        let backend = if hw.supports_cuda { "CUDA" } else { "Vulkan" };

        if gpu_vram_gb >= 16.0 {
            return (
                LlmTier::HighAlt,
                format!(
                    "{} GPU with {:.0}GB VRAM — Mistral-24B fits with full GPU offload",
                    backend, gpu_vram_gb
                ),
            );
        }
        if gpu_vram_gb >= 8.0 {
            return (
                LlmTier::High,
                format!(
                    "{} GPU with {:.0}GB VRAM — Qwen2.5-14B recommended with full GPU offload",
                    backend, gpu_vram_gb
                ),
            );
        }
        if gpu_vram_gb >= 5.0 {
            return (
                LlmTier::Default,
                format!(
                    "{} GPU with {:.0}GB VRAM — Qwen3-8B fits with full GPU offload",
                    backend, gpu_vram_gb
                ),
            );
        }
        if gpu_vram_gb >= 2.0 {
            // Partial GPU offload — model runs mostly on CPU, some layers on GPU
            return (
                LlmTier::Default,
                format!(
                    "{} GPU with {:.0}GB VRAM — Qwen3-8B with partial GPU offload (faster than pure CPU)",
                    backend, gpu_vram_gb
                ),
            );
        }
        // GPU detected but VRAM unknown or <2GB — still use Vulkan with 0 layers
        // (the GPU may handle compute graph ops even without layer offloading)
        return (
            LlmTier::Low,
            format!(
                "{} GPU detected — using compact Qwen3-4B model; GPU acceleration active",
                backend
            ),
        );
    }

    // ── CPU-only path ─────────────────────────────────────────────────────────
    if total_ram_gb < 4.0 {
        return (
            LlmTier::LowAlt,
            format!(
                "Limited RAM ({:.0}GB) — Phi-4-mini is the smallest supported model",
                total_ram_gb
            ),
        );
    }
    if total_ram_gb < 6.0 {
        return (
            LlmTier::Low,
            format!(
                "{:.0}GB RAM — Qwen3-4B recommended; CPU inference is slower but functional",
                total_ram_gb
            ),
        );
    }
    if total_ram_gb < 10.0 {
        return (
            LlmTier::Default,
            format!(
                "{:.0}GB RAM — Qwen3-8B recommended (CPU inference; expect ~3–8 tokens/sec)",
                total_ram_gb
            ),
        );
    }

    (
        LlmTier::Default,
        "Qwen3-8B is the recommended default for balanced performance".to_string(),
    )
}

fn compute_gpu_layers(hw: &HardwareProfile, gpu_vram_gb: f32) -> i32 {
    compute_gpu_layers_for_hw(hw, gpu_vram_gb)
}

/// Public wrapper so `lib.rs` auto-start can call it without going through
/// the full `select_llm_model` flow.
pub fn compute_gpu_layers_for_hw(hw: &HardwareProfile, gpu_vram_gb: f32) -> i32 {
    if hw.is_apple_silicon {
        return 99; // Metal — unified memory, offload all layers
    }
    if hw.supports_cuda || hw.supports_vulkan {
        if gpu_vram_gb >= 5.0 {
            return 99; // Full GPU offload
        }
        if gpu_vram_gb >= 2.0 {
            // Partial offload — heuristic: ~1 layer per 300MB VRAM, capped at 33
            let layers = ((gpu_vram_gb * 1024.0 - 512.0) / 300.0) as i32;
            return layers.max(1).min(33);
        }
        // <2GB or unknown VRAM — let the server decide; pass a small value
        // so at least the embedding layer goes on GPU
        return 1;
    }
    0 // CPU only
}

fn can_upgrade_tier(
    tier: &LlmTier,
    total_ram_gb: f32,
    gpu_vram_gb: f32,
    is_apple_silicon: bool,
) -> bool {
    match tier {
        LlmTier::LowAlt => total_ram_gb >= 4.0,
        LlmTier::Low => total_ram_gb >= 6.5 || gpu_vram_gb >= 4.0,
        LlmTier::Default => {
            total_ram_gb >= 16.0 || gpu_vram_gb >= 8.0 || (is_apple_silicon && total_ram_gb >= 16.0)
        }
        LlmTier::High => gpu_vram_gb >= 16.0,
        LlmTier::HighAlt => false,
    }
}

pub fn get_model_info(tier: &LlmTier) -> &'static LlmModelInfo {
    LLM_MODELS
        .iter()
        .find(|m| m.tier == *tier)
        .expect("all tiers have model info")
}
