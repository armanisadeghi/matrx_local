"""Image generation API routes.

All imports of the optional diffusers/torch packages are behind the service
boundary — this module is safe to import even when those packages are not
installed. Endpoints return HTTP 503 with a clear installation message when
the optional dependencies are absent.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.image_gen.service import get_image_gen_service
from app.services.image_gen.models import IMAGE_GEN_MODELS, WORKFLOW_PRESETS

router = APIRouter(prefix="/image-gen", tags=["image-gen"])


# ── Response / Request schemas ────────────────────────────────────────────────

class ImageGenModelInfo(BaseModel):
    model_id: str
    name: str
    provider: str
    pipeline_type: str
    vram_gb: float
    ram_gb: float
    description: str
    quality_rating: int
    speed_rating: int
    recommended_steps: int
    recommended_guidance: float
    supports_negative_prompt: bool
    model_card_url: str
    default_width: int
    default_height: int
    requires_hf_token: bool
    tags: list[str]


class WorkflowPresetInfo(BaseModel):
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
    tags: list[str]


class ImageGenStatusResponse(BaseModel):
    available: bool
    unavailable_reason: str | None
    loaded_model_id: str | None
    is_loading: bool
    load_progress: float


class LoadModelRequest(BaseModel):
    model_id: str


class LoadModelResponse(BaseModel):
    success: bool
    model_id: str | None = None
    device: str | None = None
    already_loaded: bool = False
    error: str | None = None


class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=1000)
    model_id: str
    negative_prompt: str = ""
    steps: int | None = Field(None, ge=1, le=150)
    guidance: float | None = Field(None, ge=0.0, le=20.0)
    width: int | None = Field(None, ge=64, le=2048, multiple_of=8)
    height: int | None = Field(None, ge=64, le=2048, multiple_of=8)
    seed: int | None = None


class GenerateResponse(BaseModel):
    success: bool
    image_b64: str | None = None
    """Base64-encoded PNG. Embed as: data:image/png;base64,{image_b64}"""
    width: int = 0
    height: int = 0
    model_id: str = ""
    elapsed_seconds: float = 0.0
    error: str | None = None


class WorkflowGenerateRequest(BaseModel):
    preset_id: str
    subject: str = Field(..., min_length=1, max_length=500, description="Fills the {subject} placeholder in the prompt template.")
    model_id: str | None = None
    """Override model. Defaults to the preset's suggested model."""
    seed: int | None = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/status", response_model=ImageGenStatusResponse)
async def image_gen_status() -> ImageGenStatusResponse:
    """Get the current image generation service status."""
    svc = get_image_gen_service()
    status = svc.get_status()
    return ImageGenStatusResponse(**status)


@router.get("/models", response_model=list[ImageGenModelInfo])
async def list_image_gen_models() -> list[ImageGenModelInfo]:
    """List all available image generation models."""
    return [
        ImageGenModelInfo(
            model_id=m.model_id,
            name=m.name,
            provider=m.provider,
            pipeline_type=m.pipeline_type,
            vram_gb=m.vram_gb,
            ram_gb=m.ram_gb,
            description=m.description,
            quality_rating=m.quality_rating,
            speed_rating=m.speed_rating,
            recommended_steps=m.recommended_steps,
            recommended_guidance=m.recommended_guidance,
            supports_negative_prompt=m.supports_negative_prompt,
            model_card_url=m.model_card_url,
            default_width=m.default_width,
            default_height=m.default_height,
            requires_hf_token=m.requires_hf_token,
            tags=list(m.tags),
        )
        for m in IMAGE_GEN_MODELS
    ]


@router.get("/presets", response_model=list[WorkflowPresetInfo])
async def list_workflow_presets() -> list[WorkflowPresetInfo]:
    """List all workflow presets for one-click generation."""
    return [
        WorkflowPresetInfo(
            preset_id=p.preset_id,
            name=p.name,
            description=p.description,
            prompt_template=p.prompt_template,
            negative_prompt=p.negative_prompt,
            suggested_model_id=p.suggested_model_id,
            steps=p.steps,
            guidance=p.guidance,
            width=p.width,
            height=p.height,
            tags=list(p.tags),
        )
        for p in WORKFLOW_PRESETS
    ]


@router.post("/load", response_model=LoadModelResponse)
async def load_model(req: LoadModelRequest) -> LoadModelResponse:
    """Load a model into memory (downloads from HF if needed)."""
    svc = get_image_gen_service()
    if not svc.available:
        raise HTTPException(
            status_code=503,
            detail=f"Image generation not available: {svc.unavailable_reason}",
        )
    result = await svc.load_model(req.model_id)
    return LoadModelResponse(**result)


@router.post("/unload")
async def unload_model() -> dict:
    """Unload the current model and free VRAM."""
    svc = get_image_gen_service()
    return await svc.unload_model()


@router.post("/generate", response_model=GenerateResponse)
async def generate_image(req: GenerateRequest) -> GenerateResponse:
    """Generate an image from a text prompt.

    The model is loaded automatically if not already in memory.
    Returns a base64-encoded PNG in `image_b64`.
    """
    svc = get_image_gen_service()
    if not svc.available:
        raise HTTPException(
            status_code=503,
            detail=f"Image generation not available: {svc.unavailable_reason}",
        )

    result = await svc.generate(
        prompt=req.prompt,
        model_id=req.model_id,
        negative_prompt=req.negative_prompt,
        steps=req.steps,
        guidance=req.guidance,
        width=req.width,
        height=req.height,
        seed=req.seed,
    )
    return GenerateResponse(
        success=result.success,
        image_b64=result.image_b64,
        width=result.width,
        height=result.height,
        model_id=result.model_id,
        elapsed_seconds=result.elapsed_seconds,
        error=result.error,
    )


@router.post("/generate-workflow", response_model=GenerateResponse)
async def generate_from_workflow(req: WorkflowGenerateRequest) -> GenerateResponse:
    """Generate using a preset workflow. The {subject} placeholder is filled with `subject`."""
    svc = get_image_gen_service()
    if not svc.available:
        raise HTTPException(
            status_code=503,
            detail=f"Image generation not available: {svc.unavailable_reason}",
        )

    preset = next((p for p in WORKFLOW_PRESETS if p.preset_id == req.preset_id), None)
    if preset is None:
        raise HTTPException(status_code=404, detail=f"Workflow preset not found: {req.preset_id}")

    prompt = preset.prompt_template.replace("{subject}", req.subject)
    model_id = req.model_id or preset.suggested_model_id

    result = await svc.generate(
        prompt=prompt,
        model_id=model_id,
        negative_prompt=preset.negative_prompt,
        steps=preset.steps,
        guidance=preset.guidance,
        width=preset.width,
        height=preset.height,
        seed=req.seed,
    )
    return GenerateResponse(
        success=result.success,
        image_b64=result.image_b64,
        width=result.width,
        height=result.height,
        model_id=result.model_id,
        elapsed_seconds=result.elapsed_seconds,
        error=result.error,
    )
