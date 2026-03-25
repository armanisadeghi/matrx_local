"""Image generation model catalog.

Curated list of the best open-source image generation models that can run
locally. All models use the diffusers library with a Hugging Face repo ID.

Each entry is self-describing — the router and UI derive all necessary
information from this catalog without hardcoded magic strings.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


PipelineType = Literal["flux", "hunyuan", "stable-diffusion-xl", "stable-diffusion"]


@dataclass(frozen=True)
class ImageGenModel:
    """A single image generation model entry."""

    model_id: str
    """Hugging Face repo ID (e.g. 'black-forest-labs/FLUX.1-schnell')."""

    name: str
    """Human-readable display name."""

    provider: str
    """Organization / company name."""

    pipeline_type: PipelineType
    """The diffusers pipeline class family to use."""

    vram_gb: float
    """Minimum VRAM needed in GB (FP16). Used for compatibility checks."""

    ram_gb: float
    """Minimum system RAM needed in GB."""

    description: str
    """One-sentence description shown in the UI."""

    quality_rating: int
    """0–5 quality rating (same scale as LLM ratings)."""

    speed_rating: int
    """0–5 speed rating. 5 = fastest."""

    recommended_steps: int
    """Default inference steps for this model."""

    recommended_guidance: float
    """Default CFG guidance scale. 0.0 = not applicable (flow models)."""

    supports_negative_prompt: bool
    """Whether the model meaningfully uses negative prompts."""

    model_card_url: str
    """Link to the HuggingFace model card."""

    default_width: int = 1024
    default_height: int = 1024

    # Optional: variant/quantized version
    variant: str | None = None
    """Torch dtype variant string passed to from_pretrained (e.g. 'fp16')."""

    requires_hf_token: bool = False
    """Whether a HF token is needed to download this model."""

    tags: list[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# Catalog
# ─────────────────────────────────────────────────────────────────────────────

IMAGE_GEN_MODELS: list[ImageGenModel] = [
    # ── FLUX.1-schnell — fast, permissive license, excellent quality ──────────
    ImageGenModel(
        model_id="black-forest-labs/FLUX.1-schnell",
        name="FLUX.1 Schnell",
        provider="Black Forest Labs",
        pipeline_type="flux",
        vram_gb=8.0,
        ram_gb=16.0,
        description="The fastest high-quality open-source image model. 4-step generation. Apache 2.0.",
        quality_rating=4,
        speed_rating=5,
        recommended_steps=4,
        recommended_guidance=0.0,
        supports_negative_prompt=False,
        model_card_url="https://huggingface.co/black-forest-labs/FLUX.1-schnell",
        default_width=1024,
        default_height=1024,
        variant="bf16",
        tags=["fast", "high-quality", "apache-2.0"],
    ),
    # ── FLUX.1-dev — best quality FLUX, non-commercial OK ─────────────────────
    ImageGenModel(
        model_id="black-forest-labs/FLUX.1-dev",
        name="FLUX.1 Dev",
        provider="Black Forest Labs",
        pipeline_type="flux",
        vram_gb=16.0,
        ram_gb=24.0,
        description="Highest quality FLUX model. 20-step generation. Non-commercial license.",
        quality_rating=5,
        speed_rating=3,
        recommended_steps=20,
        recommended_guidance=3.5,
        supports_negative_prompt=False,
        model_card_url="https://huggingface.co/black-forest-labs/FLUX.1-dev",
        default_width=1024,
        default_height=1024,
        variant="bf16",
        requires_hf_token=True,
        tags=["high-quality", "non-commercial"],
    ),
    # ── HunyuanDiT (English) — lightweight Chinese architecture ───────────────
    ImageGenModel(
        model_id="Tencent-Hunyuan/HunyuanDiT-v1.2-Diffusers",
        name="HunyuanDiT v1.2",
        provider="Tencent",
        pipeline_type="stable-diffusion-xl",
        vram_gb=8.0,
        ram_gb=12.0,
        description="Tencent's high-quality bilingual (Chinese + English) image model. Strong at detailed scenes.",
        quality_rating=3,
        speed_rating=3,
        recommended_steps=25,
        recommended_guidance=6.0,
        supports_negative_prompt=True,
        model_card_url="https://huggingface.co/Tencent-Hunyuan/HunyuanDiT-v1.2-Diffusers",
        default_width=1024,
        default_height=1024,
        tags=["bilingual", "detailed"],
    ),
    # ── SDXL-Turbo — fastest consumer model, good for previews ───────────────
    ImageGenModel(
        model_id="stabilityai/sdxl-turbo",
        name="SDXL Turbo",
        provider="Stability AI",
        pipeline_type="stable-diffusion-xl",
        vram_gb=6.0,
        ram_gb=10.0,
        description="1-step generation for instant image previews. Excellent for fast iteration.",
        quality_rating=2,
        speed_rating=5,
        recommended_steps=1,
        recommended_guidance=0.0,
        supports_negative_prompt=False,
        model_card_url="https://huggingface.co/stabilityai/sdxl-turbo",
        default_width=512,
        default_height=512,
        tags=["fast", "preview", "1-step"],
    ),
]

# ── Workflow presets ──────────────────────────────────────────────────────────

@dataclass(frozen=True)
class WorkflowPreset:
    """A preconfigured generation workflow with a fixed prompt template."""

    preset_id: str
    name: str
    description: str
    prompt_template: str
    negative_prompt: str
    suggested_model_id: str
    steps: int
    guidance: float
    width: int
    height: int
    tags: list[str] = field(default_factory=list)


WORKFLOW_PRESETS: list[WorkflowPreset] = [
    WorkflowPreset(
        preset_id="photorealistic-portrait",
        name="Photorealistic Portrait",
        description="Professional headshot or portrait photo quality",
        prompt_template=(
            "professional portrait photo of {subject}, sharp focus, studio lighting, "
            "8k uhd, high detail, bokeh background"
        ),
        negative_prompt="cartoon, illustration, painting, blurry, low quality, deformed",
        suggested_model_id="black-forest-labs/FLUX.1-schnell",
        steps=4,
        guidance=0.0,
        width=1024,
        height=1024,
        tags=["portrait", "photo"],
    ),
    WorkflowPreset(
        preset_id="product-shot",
        name="Product Photography",
        description="Clean product shot on white or studio background",
        prompt_template=(
            "product photography of {subject}, clean white background, "
            "professional lighting, sharp details, commercial photo"
        ),
        negative_prompt="cluttered, dark, blurry, low quality",
        suggested_model_id="black-forest-labs/FLUX.1-schnell",
        steps=4,
        guidance=0.0,
        width=1024,
        height=1024,
        tags=["product", "commercial"],
    ),
    WorkflowPreset(
        preset_id="concept-art",
        name="Concept Art / Illustration",
        description="Digital art and concept illustration style",
        prompt_template=(
            "concept art of {subject}, digital painting, detailed, vibrant colors, "
            "trending on artstation, professional illustration"
        ),
        negative_prompt="photo, realistic, blurry, low quality",
        suggested_model_id="black-forest-labs/FLUX.1-dev",
        steps=20,
        guidance=3.5,
        width=1024,
        height=1024,
        tags=["art", "illustration"],
    ),
    WorkflowPreset(
        preset_id="ui-mockup",
        name="UI / App Mockup",
        description="Clean app interface or website mockup screenshot",
        prompt_template=(
            "clean modern {subject} UI design, flat design, minimal, "
            "professional app interface, light theme, high resolution screenshot"
        ),
        negative_prompt="cluttered, low quality, dark, outdated",
        suggested_model_id="black-forest-labs/FLUX.1-schnell",
        steps=4,
        guidance=0.0,
        width=1280,
        height=960,
        tags=["ui", "design"],
    ),
    WorkflowPreset(
        preset_id="logo-icon",
        name="Logo / Icon",
        description="Simple icon or logo on transparent-style background",
        prompt_template=(
            "minimalist logo for {subject}, vector style, clean lines, "
            "simple icon, white background, professional brand identity"
        ),
        negative_prompt="complex, cluttered, photo, realistic, dark background",
        suggested_model_id="black-forest-labs/FLUX.1-schnell",
        steps=4,
        guidance=0.0,
        width=1024,
        height=1024,
        tags=["logo", "icon", "branding"],
    ),
    WorkflowPreset(
        preset_id="landscape",
        name="Landscape / Scene",
        description="Wide-format scenic or environmental image",
        prompt_template=(
            "{subject}, wide angle landscape photography, golden hour lighting, "
            "high dynamic range, ultra detailed, 8k"
        ),
        negative_prompt="people, text, watermark, low quality",
        suggested_model_id="black-forest-labs/FLUX.1-dev",
        steps=20,
        guidance=3.5,
        width=1344,
        height=768,
        tags=["landscape", "scenic"],
    ),
]
