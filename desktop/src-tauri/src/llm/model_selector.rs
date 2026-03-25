use crate::transcription::hardware::HardwareProfile;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LlmTier {
    // ── Tiny / Edge ──────────────────────────────────────────────────────
    LowAlt,            // Phi-4-mini 2.5 GB
    Low,               // Qwen3-4B 2.5 GB
    UltraLow,          // Gemma-3n-E4B 4.5 GB
    Low2,              // DeepSeek-R1-Distill-Llama-8B 4.9 GB
    Low3,              // Llama-3.1-8B 4.9 GB
    // ── Mid-range ─────────────────────────────────────────────────────────
    Default,           // Qwen3-8B 5.1 GB (auto-selection anchor)
    Mid,               // Gemma-3-12B QAT 7.3 GB
    Mid2,              // Phi-4-Reasoning 9 GB
    High,              // GPT-OSS-20B 12.1 GB
    HighAlt,           // Mistral-Small-3.1-24B 14.4 GB (existing)
    High2,             // Qwen3.5-27B (multi-variant: IQ3_XXS / Q4_K_M)
    High3,             // DeepSeek-R1-Distill-32B 19.85 GB
    High4,             // Gemma-3-27B 16.55 GB
    VHigh,             // Qwen3.5-35B-A3B (multi-variant: IQ2_M / IQ4_XS / Q4_K_M)
    // ── Uncensored ────────────────────────────────────────────────────────
    UncensoredCompact,   // Qwen3.5-35B-A3B-Uncensored IQ2_M ~11 GB
    UncensoredBalanced,  // Qwen3.5-35B-A3B-Uncensored IQ4_XS ~18 GB
    // ── Server-grade ──────────────────────────────────────────────────────
    Server,            // Llama-3.3-70B 42.5 GB
    Server2,           // Qwen3.5-122B-A10B 39.1 GB
    Server3,           // Mistral-Small-4-119B 72.6 GB
    Server4,           // Llama-4-Scout-17B-16E 67.5 GB (split)
    Server5,           // GPT-OSS-120B 88 GB
    Server6,           // Qwen3.5-397B-A17B 115 GB
}

/// A single quantization variant for a model that ships in multiple sizes.
/// Variants share all metadata (ratings, description, cutoff) with their parent
/// `LlmModelInfo`; only size, filename, and URL differ.
#[derive(Debug, Clone, Serialize)]
pub struct LlmModelVariant {
    /// Human-readable label shown in the UI: "Compact", "Balanced", "Quality".
    pub label: &'static str,
    /// Technical quant name for tooltip: "IQ3_XXS", "Q4_K_M", etc.
    pub quant: &'static str,
    pub filename: &'static str,
    pub disk_size_gb: f32,
    pub ram_required_gb: f32,
    pub hf_url: &'static str,
    /// Additional part URLs for split variants (empty = single file).
    pub hf_parts: &'static [&'static str],
    pub expected_size_bytes: u64,
    pub hf_part_sizes: &'static [u64],
}

impl LlmModelVariant {
    pub fn is_split(&self) -> bool {
        !self.hf_parts.is_empty()
    }

    pub fn all_part_urls(&self) -> Vec<&'static str> {
        let mut urls = vec![self.hf_url];
        urls.extend_from_slice(self.hf_parts);
        urls
    }

    pub fn all_part_filenames(&self) -> Vec<String> {
        if !self.is_split() {
            return vec![self.filename.to_string()];
        }
        self.all_part_urls()
            .iter()
            .map(|url| url.rsplit('/').next().unwrap_or("unknown.gguf").to_string())
            .collect()
    }
}

/// Describes how a model is hosted on HuggingFace.
///
/// Single-file models: `filename` is the single file; `hf_parts` is empty.
///
/// Split models: llama.cpp can load multi-part GGUF natively by passing the first
/// part filename. We download each part with its original HuggingFace name.
/// `filename` is the first part filename — that is what we pass to llama-server.
///
/// Multi-variant models: `variants` is non-empty. `filename` / `hf_url` /
/// `disk_size_gb` / `ram_required_gb` / `expected_size_bytes` refer to the
/// **recommended default variant** (the one selected for the user's hardware).
#[derive(Debug, Clone, Serialize)]
pub struct LlmModelInfo {
    pub tier: LlmTier,
    pub name: &'static str,
    /// Provider / organization name (e.g. "Alibaba", "OpenAI", "Meta").
    pub provider: &'static str,
    /// For single-file / default-variant models: the .gguf filename.
    /// For split models: the first part filename.
    pub filename: &'static str,
    pub disk_size_gb: f32,
    pub ram_required_gb: f32,
    // ── Ratings (0–5 scale) ───────────────────────────────────────────────
    /// General text / chat quality.
    pub text_rating: u8,
    /// Code generation and understanding.
    pub code_rating: u8,
    /// Vision / image understanding (0 = not supported by this build).
    pub vision_rating: u8,
    /// Tool / function calling reliability.
    pub tool_calling_rating: u8,
    // ── Metadata ─────────────────────────────────────────────────────────
    pub speed: &'static str,
    pub description: &'static str,
    /// Training data knowledge cutoff, e.g. "Feb 2026".
    pub knowledge_cutoff: &'static str,
    /// Link to the HuggingFace model card (hub page, not file URL).
    pub hf_model_card_url: &'static str,
    /// True for abliterated / uncensored variants.
    pub is_uncensored: bool,
    /// True for server-grade models (excluded from auto-recommendation).
    pub is_server_grade: bool,
    // ── Download URLs ─────────────────────────────────────────────────────
    /// URL for the first (or only) file / default variant.
    pub hf_url: &'static str,
    /// Additional part URLs for split models, in order. Empty = single-file.
    pub hf_parts: &'static [&'static str],
    pub context_length: u32,
    pub expected_size_bytes: u64,
    pub hf_part_sizes: &'static [u64],
    // ── Quant variants ────────────────────────────────────────────────────
    /// Non-empty for models offered in multiple quantization sizes.
    /// The first variant is the recommended default for most users.
    pub variants: &'static [LlmModelVariant],
}

impl LlmModelInfo {
    pub fn is_split(&self) -> bool {
        !self.hf_parts.is_empty()
    }

    pub fn all_part_urls(&self) -> Vec<&'static str> {
        let mut urls = vec![self.hf_url];
        urls.extend_from_slice(self.hf_parts);
        urls
    }

    pub fn all_part_filenames(&self) -> Vec<String> {
        if !self.is_split() {
            return vec![self.filename.to_string()];
        }
        self.all_part_urls()
            .iter()
            .map(|url| url.rsplit('/').next().unwrap_or("unknown.gguf").to_string())
            .collect()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Variant slices (shared across parent LlmModelInfo entries)
// ─────────────────────────────────────────────────────────────────────────────

static QWEN35_27B_VARIANTS: &[LlmModelVariant] = &[
    LlmModelVariant {
        label: "Compact",
        quant: "IQ3_XXS",
        filename: "Qwen3.5-27B-UD-IQ3_XXS.gguf",
        disk_size_gb: 11.5,
        ram_required_gb: 14.0,
        hf_url: "https://huggingface.co/unsloth/Qwen3.5-27B-GGUF/resolve/main/Qwen3.5-27B-UD-IQ3_XXS.gguf",
        hf_parts: &[],
        expected_size_bytes: 12_344_000_000,
        hf_part_sizes: &[],
    },
    LlmModelVariant {
        label: "Balanced",
        quant: "Q4_K_M",
        filename: "Qwen3.5-27B-Q4_K_M.gguf",
        disk_size_gb: 16.7,
        ram_required_gb: 20.0,
        hf_url: "https://huggingface.co/unsloth/Qwen3.5-27B-GGUF/resolve/main/Qwen3.5-27B-Q4_K_M.gguf",
        hf_parts: &[],
        expected_size_bytes: 17_933_000_000,
        hf_part_sizes: &[],
    },
];

static QWEN35_35B_A3B_VARIANTS: &[LlmModelVariant] = &[
    LlmModelVariant {
        label: "Compact",
        quant: "UD-IQ2_M",
        filename: "Qwen3.5-35B-A3B-UD-IQ2_M.gguf",
        disk_size_gb: 11.4,
        ram_required_gb: 14.0,
        hf_url: "https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-UD-IQ2_M.gguf",
        hf_parts: &[],
        expected_size_bytes: 12_238_000_000,
        hf_part_sizes: &[],
    },
    LlmModelVariant {
        label: "Balanced",
        quant: "UD-IQ4_XS",
        filename: "Qwen3.5-35B-A3B-UD-IQ4_XS.gguf",
        disk_size_gb: 17.5,
        ram_required_gb: 22.0,
        hf_url: "https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-UD-IQ4_XS.gguf",
        hf_parts: &[],
        expected_size_bytes: 18_790_000_000,
        hf_part_sizes: &[],
    },
    LlmModelVariant {
        label: "Quality",
        quant: "Q4_K_M",
        filename: "Qwen3.5-35B-A3B-Q4_K_M.gguf",
        disk_size_gb: 22.0,
        ram_required_gb: 26.0,
        hf_url: "https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-Q4_K_M.gguf",
        hf_parts: &[],
        expected_size_bytes: 23_622_000_000,
        hf_part_sizes: &[],
    },
];

static UNCENSORED_35B_VARIANTS: &[LlmModelVariant] = &[
    LlmModelVariant {
        label: "Compact",
        quant: "IQ2_M",
        filename: "Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ2_M.gguf",
        disk_size_gb: 11.0,
        ram_required_gb: 14.0,
        hf_url: "https://huggingface.co/HauhauCS/Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive/resolve/main/Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ2_M.gguf",
        hf_parts: &[],
        expected_size_bytes: 11_811_000_000,
        hf_part_sizes: &[],
    },
    LlmModelVariant {
        label: "Balanced",
        quant: "IQ4_XS",
        filename: "Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ4_XS.gguf",
        disk_size_gb: 18.0,
        ram_required_gb: 22.0,
        hf_url: "https://huggingface.co/HauhauCS/Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive/resolve/main/Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ4_XS.gguf",
        hf_parts: &[],
        expected_size_bytes: 19_327_000_000,
        hf_part_sizes: &[],
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// Model catalog
// Verified against HuggingFace API + HEAD requests where noted.
// ─────────────────────────────────────────────────────────────────────────────
pub const LLM_MODELS: &[LlmModelInfo] = &[
    // ── Tiny / Edge ──────────────────────────────────────────────────────────

    LlmModelInfo {
        tier: LlmTier::LowAlt,
        name: "Phi-4-mini-Instruct",
        provider: "Microsoft",
        filename: "microsoft_Phi-4-mini-instruct-Q4_K_M.gguf",
        disk_size_gb: 2.5,
        ram_required_gb: 3.5,
        text_rating: 2,
        code_rating: 2,
        vision_rating: 0,
        tool_calling_rating: 3,
        speed: "Very fast",
        description: "Microsoft's smallest model. Fastest option for very low-RAM machines.",
        knowledge_cutoff: "Mar 2025",
        hf_model_card_url: "https://huggingface.co/microsoft/Phi-4-mini-instruct",
        is_uncensored: false,
        is_server_grade: false,
        hf_url: "https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF/resolve/main/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf",
        hf_parts: &[],
        context_length: 8192,
        expected_size_bytes: 2_491_874_688,
        hf_part_sizes: &[],
        variants: &[],
    },

    LlmModelInfo {
        tier: LlmTier::Low,
        name: "Qwen3-4B-Instruct",
        provider: "Alibaba",
        filename: "Qwen3-4B-Q4_K_M.gguf",
        disk_size_gb: 2.5,
        ram_required_gb: 4.0,
        text_rating: 2,
        code_rating: 2,
        vision_rating: 0,
        tool_calling_rating: 3,
        speed: "Fast",
        description: "Compact model with strong tool calling. Best for low-RAM machines.",
        knowledge_cutoff: "Sep 2024",
        hf_model_card_url: "https://huggingface.co/Qwen/Qwen3-4B",
        is_uncensored: false,
        is_server_grade: false,
        hf_url: "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf",
        hf_parts: &[],
        context_length: 8192,
        expected_size_bytes: 2_497_280_256,
        hf_part_sizes: &[],
        variants: &[],
    },

    LlmModelInfo {
        tier: LlmTier::UltraLow,
        name: "Gemma-3n-E4B",
        provider: "Google",
        filename: "gemma-3n-E4B-it-Q4_K_M.gguf",
        disk_size_gb: 4.54,
        ram_required_gb: 6.0,
        text_rating: 2,
        code_rating: 1,
        vision_rating: 0,
        tool_calling_rating: 2,
        speed: "Fast",
        description: "Google's ultra-efficient on-device model. Designed for phones and edge devices. Text-only via llama.cpp currently.",
        knowledge_cutoff: "Mar 2025",
        hf_model_card_url: "https://huggingface.co/google/gemma-3n-E4B-it",
        is_uncensored: false,
        is_server_grade: false,
        hf_url: "https://huggingface.co/unsloth/gemma-3n-E4B-it-GGUF/resolve/main/gemma-3n-E4B-it-Q4_K_M.gguf",
        hf_parts: &[],
        context_length: 32768,
        expected_size_bytes: 4_876_000_000,
        hf_part_sizes: &[],
        variants: &[],
    },

    LlmModelInfo {
        tier: LlmTier::Low2,
        name: "DeepSeek-R1-Distill-Llama-8B",
        provider: "DeepSeek",
        filename: "DeepSeek-R1-Distill-Llama-8B-Q4_K_M.gguf",
        disk_size_gb: 4.92,
        ram_required_gb: 6.0,
        text_rating: 2,
        code_rating: 3,
        vision_rating: 0,
        tool_calling_rating: 2,
        speed: "Fast",
        description: "DeepSeek's reasoning model distilled into Llama-8B. Best reasoning under 5 GB. Chain-of-thought capable.",
        knowledge_cutoff: "Jul 2024",
        hf_model_card_url: "https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Llama-8B",
        is_uncensored: false,
        is_server_grade: false,
        hf_url: "https://huggingface.co/bartowski/DeepSeek-R1-Distill-Llama-8B-GGUF/resolve/main/DeepSeek-R1-Distill-Llama-8B-Q4_K_M.gguf",
        hf_parts: &[],
        context_length: 131072,
        expected_size_bytes: 5_284_000_000,
        hf_part_sizes: &[],
        variants: &[],
    },

    LlmModelInfo {
        tier: LlmTier::Low3,
        name: "Llama-3.1-8B-Instruct",
        provider: "Meta",
        filename: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        disk_size_gb: 4.92,
        ram_required_gb: 6.0,
        text_rating: 2,
        code_rating: 2,
        vision_rating: 0,
        tool_calling_rating: 3,
        speed: "Fast",
        description: "Meta's reliable 8B workhorse with 128k context. Wide ecosystem support, excellent tool calling.",
        knowledge_cutoff: "Mar 2023",
        hf_model_card_url: "https://huggingface.co/meta-llama/Meta-Llama-3.1-8B-Instruct",
        is_uncensored: false,
        is_server_grade: false,
        hf_url: "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        hf_parts: &[],
        context_length: 131072,
        expected_size_bytes: 5_284_000_000,
        hf_part_sizes: &[],
        variants: &[],
    },

    // ── Mid-range ─────────────────────────────────────────────────────────────

    LlmModelInfo {
        tier: LlmTier::Default,
        name: "Qwen3-8B-Instruct",
        provider: "Alibaba",
        filename: "Qwen3-8B-Q4_K_M.gguf",
        disk_size_gb: 5.1,
        ram_required_gb: 6.5,
        text_rating: 3,
        code_rating: 3,
        vision_rating: 0,
        tool_calling_rating: 4,
        speed: "Medium",
        description: "Recommended default. Best balance of quality and speed for tool calling and general use.",
        knowledge_cutoff: "Sep 2024",
        hf_model_card_url: "https://huggingface.co/Qwen/Qwen3-8B",
        is_uncensored: false,
        is_server_grade: false,
        hf_url: "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf",
        hf_parts: &[],
        context_length: 8192,
        expected_size_bytes: 5_027_783_488,
        hf_part_sizes: &[],
        variants: &[],
    },

    LlmModelInfo {
        tier: LlmTier::Mid,
        name: "Gemma-3-12B",
        provider: "Google",
        filename: "google_gemma-3-12b-it-qat-Q4_K_M.gguf",
        disk_size_gb: 7.3,
        ram_required_gb: 10.0,
        text_rating: 3,
        code_rating: 3,
        vision_rating: 3,
        tool_calling_rating: 3,
        speed: "Medium",
        description: "Google's mid-size multimodal model with QAT quantization for better quality. Strong vision and text.",
        knowledge_cutoff: "Mar 2025",
        hf_model_card_url: "https://huggingface.co/google/gemma-3-12b-it",
        is_uncensored: false,
        is_server_grade: false,
        hf_url: "https://huggingface.co/bartowski/google_gemma-3-12b-it-qat-GGUF/resolve/main/google_gemma-3-12b-it-qat-Q4_K_M.gguf",
        hf_parts: &[],
        context_length: 131072,
        expected_size_bytes: 7_840_000_000,
        hf_part_sizes: &[],
        variants: &[],
    },

    LlmModelInfo {
        tier: LlmTier::Mid2,
        name: "Phi-4-Reasoning",
        provider: "Microsoft",
        filename: "microsoft_Phi-4-reasoning-Q4_K_M.gguf",
        disk_size_gb: 9.0,
        ram_required_gb: 12.0,
        text_rating: 3,
        code_rating: 4,
        vision_rating: 0,
        tool_calling_rating: 3,
        speed: "Medium",
        description: "Microsoft's reasoning-optimized 14B model. Exceptional at STEM and code for its size.",
        knowledge_cutoff: "Apr 2025",
        hf_model_card_url: "https://huggingface.co/microsoft/Phi-4-reasoning",
        is_uncensored: false,
        is_server_grade: false,
        hf_url: "https://huggingface.co/bartowski/microsoft_Phi-4-reasoning-GGUF/resolve/main/microsoft_Phi-4-reasoning-Q4_K_M.gguf",
        hf_parts: &[],
        context_length: 32768,
        expected_size_bytes: 9_664_000_000,
        hf_part_sizes: &[],
        variants: &[],
    },

    LlmModelInfo {
        tier: LlmTier::High,
        name: "GPT-OSS-20B",
        provider: "OpenAI",
        filename: "openai_gpt-oss-20b-MXFP4.gguf",
        disk_size_gb: 12.1,
        ram_required_gb: 16.0,
        text_rating: 4,
        code_rating: 4,
        vision_rating: 0,
        tool_calling_rating: 4,
        speed: "Medium",
        description: "OpenAI's open-source reasoning model — equivalent to o3-mini. Only 3.6B active params (MoE). Apache 2.0.",
        knowledge_cutoff: "Mid 2025",
        hf_model_card_url: "https://huggingface.co/openai/gpt-oss-20b",
        is_uncensored: false,
        is_server_grade: false,
        hf_url: "https://huggingface.co/bartowski/openai_gpt-oss-20b-GGUF/resolve/main/openai_gpt-oss-20b-MXFP4.gguf",
        hf_parts: &[],
        context_length: 131072,
        expected_size_bytes: 12_991_000_000,
        hf_part_sizes: &[],
        variants: &[],
    },

    LlmModelInfo {
        tier: LlmTier::HighAlt,
        name: "Mistral-Small-3.1-24B",
        provider: "Mistral",
        filename: "Mistral-Small-3.1-24B-Instruct-2503-Q4_K_M.gguf",
        disk_size_gb: 14.4,
        ram_required_gb: 16.0,
        text_rating: 3,
        code_rating: 3,
        vision_rating: 2,
        tool_calling_rating: 4,
        speed: "GPU recommended",
        description: "Mistral's dense 24B with strong tool calling and 128k context. Excellent for agents.",
        knowledge_cutoff: "Mar 2025",
        hf_model_card_url: "https://huggingface.co/mistralai/Mistral-Small-3.1-24B-Instruct-2503",
        is_uncensored: false,
        is_server_grade: false,
        hf_url: "https://huggingface.co/lmstudio-community/Mistral-Small-3.1-24B-Instruct-2503-GGUF/resolve/main/Mistral-Small-3.1-24B-Instruct-2503-Q4_K_M.gguf",
        hf_parts: &[],
        context_length: 4096,
        expected_size_bytes: 14_333_910_176,
        hf_part_sizes: &[],
        variants: &[],
    },

    LlmModelInfo {
        tier: LlmTier::High2,
        name: "Qwen3.5-27B",
        provider: "Alibaba",
        // Default variant: Compact (IQ3_XXS) — fits more hardware
        filename: "Qwen3.5-27B-UD-IQ3_XXS.gguf",
        disk_size_gb: 11.5,
        ram_required_gb: 14.0,
        text_rating: 4,
        code_rating: 4,
        vision_rating: 3,
        tool_calling_rating: 4,
        speed: "GPU recommended",
        description: "Dense 27B with native vision. Arena rank #24 among all open-source models. Choose your size below.",
        knowledge_cutoff: "Feb 2026",
        hf_model_card_url: "https://huggingface.co/Qwen/Qwen3.5-27B",
        is_uncensored: false,
        is_server_grade: false,
        hf_url: "https://huggingface.co/unsloth/Qwen3.5-27B-GGUF/resolve/main/Qwen3.5-27B-UD-IQ3_XXS.gguf",
        hf_parts: &[],
        context_length: 262144,
        expected_size_bytes: 12_344_000_000,
        hf_part_sizes: &[],
        variants: QWEN35_27B_VARIANTS,
    },

    LlmModelInfo {
        tier: LlmTier::High3,
        name: "DeepSeek-R1-Distill-32B",
        provider: "DeepSeek",
        filename: "DeepSeek-R1-Distill-Qwen-32B-Q4_K_M.gguf",
        disk_size_gb: 19.85,
        ram_required_gb: 24.0,
        text_rating: 4,
        code_rating: 4,
        vision_rating: 0,
        tool_calling_rating: 3,
        speed: "GPU recommended",
        description: "DeepSeek's 32B reasoning distill. Exceptional chain-of-thought for its size. Fits in 24 GB VRAM.",
        knowledge_cutoff: "Jul 2024",
        hf_model_card_url: "https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
        is_uncensored: false,
        is_server_grade: false,
        hf_url: "https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-32B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-32B-Q4_K_M.gguf",
        hf_parts: &[],
        context_length: 131072,
        expected_size_bytes: 21_313_000_000,
        hf_part_sizes: &[],
        variants: &[],
    },

    LlmModelInfo {
        tier: LlmTier::High4,
        name: "Gemma-3-27B",
        provider: "Google",
        filename: "google_gemma-3-27b-it-Q4_K_M.gguf",
        disk_size_gb: 16.55,
        ram_required_gb: 20.0,
        text_rating: 4,
        code_rating: 3,
        vision_rating: 4,
        tool_calling_rating: 3,
        speed: "GPU recommended",
        description: "Google's best open multimodal model. Top-tier vision + text. 128k context.",
        knowledge_cutoff: "Mar 2025",
        hf_model_card_url: "https://huggingface.co/google/gemma-3-27b-it",
        is_uncensored: false,
        is_server_grade: false,
        hf_url: "https://huggingface.co/unsloth/gemma-3-27b-it-GGUF/resolve/main/gemma-3-27b-it-Q4_K_M.gguf",
        hf_parts: &[],
        context_length: 131072,
        expected_size_bytes: 17_773_000_000,
        hf_part_sizes: &[],
        variants: &[],
    },

    LlmModelInfo {
        tier: LlmTier::VHigh,
        name: "Qwen3.5-35B-A3B",
        provider: "Alibaba",
        // Default variant: Balanced (IQ4_XS)
        filename: "Qwen3.5-35B-A3B-UD-IQ4_XS.gguf",
        disk_size_gb: 17.5,
        ram_required_gb: 22.0,
        text_rating: 4,
        code_rating: 4,
        vision_rating: 4,
        tool_calling_rating: 4,
        speed: "GPU recommended",
        description: "Top open-source MoE model. Only 3B active params — inference speed of a 3B with quality far above. Arena rank #28. Choose your size below.",
        knowledge_cutoff: "Feb 2026",
        hf_model_card_url: "https://huggingface.co/Qwen/Qwen3.5-35B-A3B",
        is_uncensored: false,
        is_server_grade: false,
        hf_url: "https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-UD-IQ4_XS.gguf",
        hf_parts: &[],
        context_length: 262144,
        expected_size_bytes: 18_790_000_000,
        hf_part_sizes: &[],
        variants: QWEN35_35B_A3B_VARIANTS,
    },

    // ── Uncensored ────────────────────────────────────────────────────────────

    LlmModelInfo {
        tier: LlmTier::UncensoredCompact,
        name: "Qwen3.5-35B-A3B-Uncensored (Compact)",
        provider: "HauhauCS",
        filename: "Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ2_M.gguf",
        disk_size_gb: 11.0,
        ram_required_gb: 14.0,
        text_rating: 4,
        code_rating: 3,
        vision_rating: 3,
        tool_calling_rating: 3,
        speed: "Medium",
        description: "Uncensored Qwen3.5-35B MoE (abliterated). No refusals. Essential for sensitive monitoring, analysis, and tasks standard models decline.",
        knowledge_cutoff: "Feb 2026",
        hf_model_card_url: "https://huggingface.co/HauhauCS/Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive",
        is_uncensored: true,
        is_server_grade: false,
        hf_url: "https://huggingface.co/HauhauCS/Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive/resolve/main/Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ2_M.gguf",
        hf_parts: &[],
        context_length: 262144,
        expected_size_bytes: 11_811_000_000,
        hf_part_sizes: &[],
        variants: UNCENSORED_35B_VARIANTS,
    },

    LlmModelInfo {
        tier: LlmTier::UncensoredBalanced,
        name: "Qwen3.5-35B-A3B-Uncensored (Balanced)",
        provider: "HauhauCS",
        filename: "Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ4_XS.gguf",
        disk_size_gb: 18.0,
        ram_required_gb: 22.0,
        text_rating: 4,
        code_rating: 3,
        vision_rating: 3,
        tool_calling_rating: 3,
        speed: "GPU recommended",
        description: "Higher quality uncensored Qwen3.5-35B MoE (abliterated). Better outputs for sensitive analysis tasks.",
        knowledge_cutoff: "Feb 2026",
        hf_model_card_url: "https://huggingface.co/HauhauCS/Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive",
        is_uncensored: true,
        is_server_grade: false,
        hf_url: "https://huggingface.co/HauhauCS/Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive/resolve/main/Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ4_XS.gguf",
        hf_parts: &[],
        context_length: 262144,
        expected_size_bytes: 19_327_000_000,
        hf_part_sizes: &[],
        variants: UNCENSORED_35B_VARIANTS,
    },

    // ── Server-grade ──────────────────────────────────────────────────────────

    LlmModelInfo {
        tier: LlmTier::Server,
        name: "Llama-3.3-70B-Instruct",
        provider: "Meta",
        filename: "Llama-3.3-70B-Instruct-Q4_K_M.gguf",
        disk_size_gb: 42.5,
        ram_required_gb: 48.0,
        text_rating: 4,
        code_rating: 4,
        vision_rating: 0,
        tool_calling_rating: 4,
        speed: "Server GPU",
        description: "Meta's best dense 70B. Rivals much larger models on benchmarks. Requires 48 GB+ VRAM.",
        knowledge_cutoff: "Dec 2023",
        hf_model_card_url: "https://huggingface.co/meta-llama/Llama-3.3-70B-Instruct",
        is_uncensored: false,
        is_server_grade: true,
        hf_url: "https://huggingface.co/unsloth/Llama-3.3-70B-Instruct-GGUF/resolve/main/Llama-3.3-70B-Instruct-Q4_K_M.gguf",
        hf_parts: &[],
        context_length: 131072,
        expected_size_bytes: 45_618_000_000,
        hf_part_sizes: &[],
        variants: &[],
    },

    LlmModelInfo {
        tier: LlmTier::Server2,
        name: "Qwen3.5-122B-A10B",
        provider: "Alibaba",
        filename: "Qwen3.5-122B-A10B-UD-IQ2_M.gguf",
        disk_size_gb: 39.1,
        ram_required_gb: 48.0,
        text_rating: 5,
        code_rating: 5,
        vision_rating: 4,
        tool_calling_rating: 5,
        speed: "Server GPU",
        description: "122B MoE, only 10B active. Near-frontier quality accessible on 48 GB+ servers. Arena rank #16 globally.",
        knowledge_cutoff: "Feb 2026",
        hf_model_card_url: "https://huggingface.co/Qwen/Qwen3.5-122B-A10B",
        is_uncensored: false,
        is_server_grade: true,
        hf_url: "https://huggingface.co/unsloth/Qwen3.5-122B-A10B-GGUF/resolve/main/Qwen3.5-122B-A10B-UD-IQ2_M.gguf",
        hf_parts: &[],
        context_length: 262144,
        expected_size_bytes: 41_980_000_000,
        hf_part_sizes: &[],
        variants: &[],
    },

    LlmModelInfo {
        tier: LlmTier::Server3,
        name: "Mistral-Small-4-119B",
        provider: "Mistral",
        filename: "Mistral-Small-4-119B-2603-Q4_K_M.gguf",
        disk_size_gb: 72.6,
        ram_required_gb: 80.0,
        text_rating: 4,
        code_rating: 4,
        vision_rating: 3,
        tool_calling_rating: 4,
        speed: "Server GPU",
        description: "Mistral's latest unified MoE — reasoning + multimodal + coding in one 256k-context model. Released March 2026.",
        knowledge_cutoff: "Mar 2026",
        hf_model_card_url: "https://huggingface.co/mistralai/Mistral-Small-4-119B-2603",
        is_uncensored: false,
        is_server_grade: true,
        hf_url: "https://huggingface.co/unsloth/Mistral-Small-4-119B-2603-GGUF/resolve/main/Mistral-Small-4-119B-2603-Q4_K_M.gguf",
        hf_parts: &[],
        context_length: 262144,
        expected_size_bytes: 77_952_000_000,
        hf_part_sizes: &[],
        variants: &[],
    },

    LlmModelInfo {
        tier: LlmTier::Server4,
        name: "Llama-4-Scout-17B-16E",
        provider: "Meta",
        // Split: 2 parts
        filename: "Llama-4-Scout-17B-16E-Instruct-Q4_K_M-00001-of-00002.gguf",
        disk_size_gb: 67.5,
        ram_required_gb: 80.0,
        text_rating: 4,
        code_rating: 4,
        vision_rating: 4,
        tool_calling_rating: 4,
        speed: "Server GPU",
        description: "Meta's Llama 4 MoE with unprecedented 10M token context. Multimodal (text + image). 109B total / 17B active.",
        knowledge_cutoff: "Mar 2025",
        hf_model_card_url: "https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E-Instruct",
        is_uncensored: false,
        is_server_grade: true,
        hf_url: "https://huggingface.co/unsloth/Llama-4-Scout-17B-16E-Instruct-GGUF/resolve/main/Llama-4-Scout-17B-16E-Instruct-Q4_K_M-00001-of-00002.gguf",
        hf_parts: &[
            "https://huggingface.co/unsloth/Llama-4-Scout-17B-16E-Instruct-GGUF/resolve/main/Llama-4-Scout-17B-16E-Instruct-Q4_K_M-00002-of-00002.gguf",
        ],
        context_length: 131072,
        expected_size_bytes: 36_283_000_000,
        hf_part_sizes: &[31_217_000_000],
        variants: &[],
    },

    LlmModelInfo {
        tier: LlmTier::Server5,
        name: "GPT-OSS-120B",
        provider: "OpenAI",
        filename: "openai_gpt-oss-120b-Q4_K_M.gguf",
        disk_size_gb: 88.0,
        ram_required_gb: 96.0,
        text_rating: 5,
        code_rating: 5,
        vision_rating: 0,
        tool_calling_rating: 5,
        speed: "Server GPU",
        description: "OpenAI's largest open-source model. Near o4-mini parity. Best open-weight reasoning model available. 128k context.",
        knowledge_cutoff: "Mid 2025",
        hf_model_card_url: "https://huggingface.co/openai/gpt-oss-120b",
        is_uncensored: false,
        is_server_grade: true,
        hf_url: "https://huggingface.co/bartowski/openai_gpt-oss-120b-GGUF/resolve/main/openai_gpt-oss-120b-Q4_K_M.gguf",
        hf_parts: &[],
        context_length: 131072,
        expected_size_bytes: 94_489_000_000,
        hf_part_sizes: &[],
        variants: &[],
    },

    LlmModelInfo {
        tier: LlmTier::Server6,
        name: "Qwen3.5-397B-A17B",
        provider: "Alibaba",
        filename: "Qwen3.5-397B-A17B-UD-IQ2_XXS.gguf",
        disk_size_gb: 115.0,
        ram_required_gb: 128.0,
        text_rating: 5,
        code_rating: 5,
        vision_rating: 5,
        tool_calling_rating: 5,
        speed: "Server GPU",
        description: "The best open-source model in the world. Arena rank #3 globally. 397B total / 17B active MoE. Near-frontier on every task.",
        knowledge_cutoff: "Feb 2026",
        hf_model_card_url: "https://huggingface.co/Qwen/Qwen3.5-397B-A17B",
        is_uncensored: false,
        is_server_grade: true,
        hf_url: "https://huggingface.co/unsloth/Qwen3.5-397B-A17B-GGUF/resolve/main/Qwen3.5-397B-A17B-UD-IQ2_XXS.gguf",
        hf_parts: &[],
        context_length: 262144,
        expected_size_bytes: 123_476_000_000,
        hf_part_sizes: &[],
        variants: &[],
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// Hardware selection — auto-recommendation only
// Server-grade and uncensored tiers are never auto-recommended.
// ─────────────────────────────────────────────────────────────────────────────

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
        if total_ram_gb >= 36.0 {
            return (
                LlmTier::VHigh,
                format!(
                    "Apple Silicon with {:.0}GB RAM — Qwen3.5-35B-A3B (MoE) runs excellently with Metal",
                    total_ram_gb
                ),
            );
        }
        if total_ram_gb >= 24.0 {
            return (
                LlmTier::High2,
                format!(
                    "Apple Silicon with {:.0}GB RAM — Qwen3.5-27B recommended with Metal acceleration",
                    total_ram_gb
                ),
            );
        }
        if total_ram_gb >= 16.0 {
            return (
                LlmTier::High,
                "Apple Silicon with 16GB RAM — GPT-OSS-20B recommended (12 GB, Metal accelerated)".to_string(),
            );
        }
        if total_ram_gb >= 10.0 {
            return (
                LlmTier::Mid,
                "Apple Silicon with 10GB+ RAM — Gemma-3-12B recommended with Metal".to_string(),
            );
        }
        if total_ram_gb >= 8.0 {
            return (
                LlmTier::Default,
                "Apple Silicon with 8GB RAM — Qwen3-8B recommended with Metal acceleration".to_string(),
            );
        }
        if total_ram_gb >= 6.0 {
            return (
                LlmTier::Low,
                format!(
                    "Apple Silicon with {:.0}GB RAM — Qwen3-4B recommended",
                    total_ram_gb
                ),
            );
        }
        return (
            LlmTier::LowAlt,
            format!(
                "Apple Silicon with {:.0}GB RAM — Phi-4-mini is the smallest supported model",
                total_ram_gb
            ),
        );
    }

    // ── Dedicated GPU (CUDA or Vulkan) ────────────────────────────────────────
    if hw.supports_cuda || hw.supports_vulkan {
        let backend = if hw.supports_cuda { "CUDA" } else { "Vulkan" };

        if gpu_vram_gb >= 36.0 {
            return (
                LlmTier::VHigh,
                format!(
                    "{} GPU with {:.0}GB VRAM — Qwen3.5-35B-A3B MoE fits with full GPU offload",
                    backend, gpu_vram_gb
                ),
            );
        }
        if gpu_vram_gb >= 16.0 {
            return (
                LlmTier::High2,
                format!(
                    "{} GPU with {:.0}GB VRAM — Qwen3.5-27B recommended with full GPU offload",
                    backend, gpu_vram_gb
                ),
            );
        }
        if gpu_vram_gb >= 12.0 {
            return (
                LlmTier::High,
                format!(
                    "{} GPU with {:.0}GB VRAM — GPT-OSS-20B fits with full GPU offload",
                    backend, gpu_vram_gb
                ),
            );
        }
        if gpu_vram_gb >= 8.0 {
            return (
                LlmTier::Mid,
                format!(
                    "{} GPU with {:.0}GB VRAM — Gemma-3-12B recommended with full GPU offload",
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
            return (
                LlmTier::Default,
                format!(
                    "{} GPU with {:.0}GB VRAM — Qwen3-8B with partial GPU offload (faster than pure CPU)",
                    backend, gpu_vram_gb
                ),
            );
        }
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
            LlmTier::UltraLow,
            format!(
                "{:.0}GB RAM — Gemma-3n-E4B recommended for CPU inference",
                total_ram_gb
            ),
        );
    }
    if total_ram_gb < 8.0 {
        return (
            LlmTier::Low,
            format!(
                "{:.0}GB RAM — Qwen3-4B recommended; CPU inference is slower but functional",
                total_ram_gb
            ),
        );
    }
    if total_ram_gb < 12.0 {
        return (
            LlmTier::Default,
            format!(
                "{:.0}GB RAM — Qwen3-8B recommended (CPU inference; expect ~3–8 tokens/sec)",
                total_ram_gb
            ),
        );
    }

    (
        LlmTier::Mid,
        format!(
            "{:.0}GB RAM — Gemma-3-12B recommended for balanced CPU performance",
            total_ram_gb
        ),
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
        LlmTier::UltraLow => total_ram_gb >= 6.0 || gpu_vram_gb >= 4.0,
        LlmTier::Low | LlmTier::Low2 | LlmTier::Low3 => {
            total_ram_gb >= 6.5 || gpu_vram_gb >= 4.0
        }
        LlmTier::Default => total_ram_gb >= 10.0 || gpu_vram_gb >= 8.0,
        LlmTier::Mid | LlmTier::Mid2 => {
            total_ram_gb >= 16.0 || gpu_vram_gb >= 12.0 || (is_apple_silicon && total_ram_gb >= 16.0)
        }
        LlmTier::High | LlmTier::HighAlt => {
            total_ram_gb >= 24.0 || gpu_vram_gb >= 16.0 || (is_apple_silicon && total_ram_gb >= 24.0)
        }
        LlmTier::High2 | LlmTier::High3 | LlmTier::High4 => {
            total_ram_gb >= 36.0 || gpu_vram_gb >= 36.0 || (is_apple_silicon && total_ram_gb >= 36.0)
        }
        LlmTier::VHigh => false, // top consumer tier
        // Uncensored and server-grade don't participate in auto-upgrade
        _ => false,
    }
}

pub fn get_model_info(tier: &LlmTier) -> &'static LlmModelInfo {
    LLM_MODELS
        .iter()
        .find(|m| m.tier == *tier)
        .expect("all auto-selectable tiers have model info")
}
