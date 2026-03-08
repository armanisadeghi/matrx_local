use super::hardware::HardwareProfile;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum WhisperModelTier {
    Low,     // tiny.en — < 4GB RAM
    Default, // base.en — 4–8GB RAM (SHIPPED DEFAULT)
    High,    // small.en — 8GB+ RAM with GPU or 16GB+ RAM
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelInfo {
    pub tier: WhisperModelTier,
    pub filename: &'static str,
    pub download_size_mb: u32,
    pub ram_required_mb: u32,
    pub relative_speed: &'static str,
    pub accuracy: &'static str,
    pub description: &'static str,
}

pub const MODELS: &[ModelInfo] = &[
    ModelInfo {
        tier: WhisperModelTier::Low,
        filename: "ggml-tiny.en.bin",
        download_size_mb: 75,
        ram_required_mb: 390,
        relative_speed: "~32x realtime",
        accuracy: "Good (~5.7% WER)",
        description: "Fastest, lowest resource usage. Best for older or low-RAM machines.",
    },
    ModelInfo {
        tier: WhisperModelTier::Default,
        filename: "ggml-base.en.bin",
        download_size_mb: 142,
        ram_required_mb: 506,
        relative_speed: "~16x realtime",
        accuracy: "Very good (~4.2% WER)",
        description: "Recommended for most users. Best balance of speed and accuracy.",
    },
    ModelInfo {
        tier: WhisperModelTier::High,
        filename: "ggml-small.en.bin",
        download_size_mb: 466,
        ram_required_mb: 1024,
        relative_speed: "~6x realtime",
        accuracy: "Excellent (~2.9% WER)",
        description: "Highest accuracy. Requires 8GB+ RAM or GPU acceleration.",
    },
];

#[derive(Debug, Clone, Serialize)]
pub struct ModelSelection {
    pub tier: WhisperModelTier,
    pub filename: &'static str,
    pub download_size_mb: u32,
    pub reason: &'static str,
}

pub fn select_model(
    hw: &HardwareProfile,
    user_override: Option<WhisperModelTier>,
) -> ModelSelection {
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
    // Apple Silicon: Metal acceleration makes small.en viable
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
        _ => WhisperModelTier::Default,
    }
}

/// Returns true if the system can handle more than the currently selected tier.
pub fn should_offer_upgrade(hw: &HardwareProfile, current_tier: &WhisperModelTier) -> bool {
    *current_tier == WhisperModelTier::Default
        && (hw.total_ram_mb >= 16384 || hw.is_apple_silicon || hw.supports_cuda)
}

/// Get the ModelInfo for a given tier.
pub fn get_model_info(tier: &WhisperModelTier) -> &'static ModelInfo {
    MODELS
        .iter()
        .find(|m| m.tier == *tier)
        .expect("all tiers have model info")
}
