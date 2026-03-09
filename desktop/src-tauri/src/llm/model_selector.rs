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

#[derive(Debug, Clone, Serialize)]
pub struct LlmModelInfo {
    pub tier: LlmTier,
    pub name: &'static str,
    pub filename: &'static str,
    pub disk_size_gb: f32,
    pub ram_required_gb: f32,
    pub tool_calling_rating: u8,
    pub speed: &'static str,
    pub description: &'static str,
    pub hf_url: &'static str,
    pub context_length: u32,
}

pub const LLM_MODELS: &[LlmModelInfo] = &[
    LlmModelInfo {
        tier: LlmTier::Low,
        name: "Qwen3-4B-Instruct",
        filename: "Qwen3-4B-Q4_K_M.gguf",
        disk_size_gb: 2.7,
        ram_required_gb: 4.0,
        tool_calling_rating: 4,
        speed: "Fast",
        description: "Compact model with strong tool calling. Best for low-RAM machines.",
        hf_url: "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf",
        context_length: 8192,
    },
    LlmModelInfo {
        tier: LlmTier::LowAlt,
        name: "Phi-4-mini-Instruct",
        filename: "Phi-4-mini-instruct-Q4_K_M.gguf",
        disk_size_gb: 2.3,
        ram_required_gb: 3.5,
        tool_calling_rating: 4,
        speed: "Very fast",
        description: "Microsoft's compact model. Fastest option for low-resource systems.",
        hf_url: "https://huggingface.co/microsoft/Phi-4-mini-instruct-gguf/resolve/main/Phi-4-mini-instruct-Q4_K_M.gguf",
        context_length: 8192,
    },
    LlmModelInfo {
        tier: LlmTier::Default,
        name: "Qwen3-8B-Instruct",
        filename: "Qwen3-8B-Q4_K_M.gguf",
        disk_size_gb: 5.2,
        ram_required_gb: 6.5,
        tool_calling_rating: 5,
        speed: "Medium",
        description: "Recommended default. Best balance of quality and speed for tool calling.",
        hf_url: "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf",
        context_length: 8192,
    },
    LlmModelInfo {
        tier: LlmTier::High,
        name: "Qwen2.5-14B-Instruct",
        filename: "Qwen2.5-14B-Instruct-Q4_K_M.gguf",
        disk_size_gb: 9.0,
        ram_required_gb: 10.0,
        tool_calling_rating: 5,
        speed: "Slow (GPU recommended)",
        description: "High-quality reasoning. Requires 10GB+ RAM or dedicated GPU.",
        hf_url: "https://huggingface.co/Qwen/Qwen2.5-14B-Instruct-GGUF/resolve/main/Qwen2.5-14B-Instruct-Q4_K_M.gguf",
        context_length: 8192,
    },
    LlmModelInfo {
        tier: LlmTier::HighAlt,
        name: "Mistral-Small-3.1-24B",
        filename: "Mistral-Small-3.1-24B-Instruct-2503-Q4_K_M.gguf",
        disk_size_gb: 14.0,
        ram_required_gb: 16.0,
        tool_calling_rating: 5,
        speed: "GPU required",
        description: "Largest supported model. Requires 16GB+ RAM and GPU acceleration.",
        hf_url: "https://huggingface.co/bartowski/Mistral-Small-3.1-24B-Instruct-2503-GGUF/resolve/main/Mistral-Small-3.1-24B-Instruct-2503-Q4_K_M.gguf",
        context_length: 4096,
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
    // Apple Silicon — Metal offloads all layers efficiently
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
    }

    // CUDA GPU with dedicated VRAM
    if hw.supports_cuda {
        if gpu_vram_gb >= 8.0 {
            return (
                LlmTier::High,
                format!(
                    "NVIDIA GPU with {:.0}GB VRAM — can run larger models with full GPU offload",
                    gpu_vram_gb
                ),
            );
        }
        if gpu_vram_gb >= 4.0 {
            return (
                LlmTier::Default,
                format!(
                    "NVIDIA GPU with {:.0}GB VRAM — Qwen3-8B with partial GPU offload",
                    gpu_vram_gb
                ),
            );
        }
    }

    // CPU-only path — be conservative
    if total_ram_gb < 6.0 {
        return (
            LlmTier::Low,
            format!(
                "Limited RAM ({:.0}GB) — using compact Qwen3-4B model",
                total_ram_gb
            ),
        );
    }
    if total_ram_gb < 10.0 {
        return (
            LlmTier::Default,
            format!(
                "{:.0}GB RAM detected — Qwen3-8B recommended (CPU inference will be slower)",
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
    if hw.is_apple_silicon {
        return 99; // Metal — offload all layers
    }
    if gpu_vram_gb >= 8.0 {
        return 99; // Full GPU offload
    }
    if gpu_vram_gb >= 4.0 {
        return 20; // Partial offload
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
        LlmTier::Low | LlmTier::LowAlt => total_ram_gb >= 6.5,
        LlmTier::Default => {
            total_ram_gb >= 16.0 || gpu_vram_gb >= 8.0 || (is_apple_silicon && total_ram_gb >= 16.0)
        }
        LlmTier::High | LlmTier::HighAlt => false,
    }
}

pub fn get_model_info(tier: &LlmTier) -> &'static LlmModelInfo {
    LLM_MODELS
        .iter()
        .find(|m| m.tier == *tier)
        .expect("all tiers have model info")
}
