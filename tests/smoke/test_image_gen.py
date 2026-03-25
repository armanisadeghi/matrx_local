"""
Image generation endpoint smoke tests.

The image generation service depends on optional heavy packages (torch,
diffusers, transformers, accelerate) that are NOT installed by default.
All endpoints should return well-formed responses even when the packages
are absent — they return HTTP 503 with a clear message rather than 500.

Covers:
  GET  /image-gen/status   — always 200 (reports available=false when deps missing)
  GET  /image-gen/models   — always 200, list of model definitions
  GET  /image-gen/presets  — always 200, list of workflow presets
  POST /image-gen/load     — 503 when deps missing, 200 when available
  POST /image-gen/generate — 503 when deps missing
"""

from __future__ import annotations

import httpx


def test_image_gen_status_always_responds(http: httpx.Client) -> None:
    """GET /image-gen/status returns 200 with a structured status object."""
    r = http.get("/image-gen/status")
    assert r.status_code == 200, (
        f"GET /image-gen/status returned {r.status_code}: {r.text}"
    )
    data = r.json()
    required = {"available", "loaded_model_id", "is_loading", "load_progress"}
    missing = required - set(data.keys())
    assert not missing, (
        f"/image-gen/status response missing fields: {missing}. Got: {list(data.keys())}"
    )
    assert isinstance(data["available"], bool), (
        f"'available' should be bool, got {type(data['available'])}"
    )
    assert isinstance(data["is_loading"], bool), (
        f"'is_loading' should be bool, got {type(data['is_loading'])}"
    )


def test_image_gen_models_list(http: httpx.Client) -> None:
    """GET /image-gen/models returns a non-empty list with correct schema."""
    r = http.get("/image-gen/models")
    assert r.status_code == 200, (
        f"GET /image-gen/models returned {r.status_code}: {r.text}"
    )
    models = r.json()
    assert isinstance(models, list), f"Expected list, got {type(models)}"
    assert len(models) >= 3, (
        f"Expected at least 3 image gen models defined, got {len(models)}"
    )

    required_fields = {
        "model_id", "name", "provider", "pipeline_type",
        "vram_gb", "ram_gb", "requires_hf_token",
    }
    for model in models:
        missing = required_fields - set(model.keys())
        assert not missing, (
            f"Model entry missing fields {missing}: {model.get('model_id', '?')}"
        )
        assert isinstance(model["requires_hf_token"], bool), (
            f"'requires_hf_token' should be bool: {model}"
        )


def test_image_gen_presets_list(http: httpx.Client) -> None:
    """GET /image-gen/presets returns a non-empty list with correct schema."""
    r = http.get("/image-gen/presets")
    assert r.status_code == 200, (
        f"GET /image-gen/presets returned {r.status_code}: {r.text}"
    )
    presets = r.json()
    assert isinstance(presets, list), f"Expected list, got {type(presets)}"
    assert len(presets) >= 3, (
        f"Expected at least 3 workflow presets defined, got {len(presets)}"
    )

    required_fields = {
        "preset_id", "name", "description", "prompt_template",
        "suggested_model_id", "steps", "guidance",
    }
    for preset in presets:
        missing = required_fields - set(preset.keys())
        assert not missing, (
            f"Preset entry missing fields {missing}: {preset.get('preset_id', '?')}"
        )
        assert "{subject}" in preset["prompt_template"], (
            f"Preset '{preset['preset_id']}' prompt_template should contain "
            f"{{subject}} placeholder: {preset['prompt_template']}"
        )


def test_image_gen_load_graceful_without_deps(http: httpx.Client) -> None:
    """POST /image-gen/load returns 503 (not 500) when deps are missing."""
    r = http.post("/image-gen/load", json={"model_id": "flux-schnell"})
    # 503 = expected when torch/diffusers not installed
    # 200 = would happen on a GPU machine with full deps
    assert r.status_code in (200, 503), (
        f"POST /image-gen/load should return 200 or 503, got {r.status_code}: {r.text}"
    )
    if r.status_code == 503:
        data = r.json()
        assert "detail" in data, (
            f"503 response should have 'detail' field: {data}"
        )


def test_image_gen_generate_graceful_without_deps(http: httpx.Client) -> None:
    """POST /image-gen/generate returns 503 (not 500) when deps are missing."""
    r = http.post("/image-gen/generate", json={
        "prompt": "a test prompt",
        "model_id": "flux-schnell",
    })
    assert r.status_code in (200, 503), (
        f"POST /image-gen/generate should return 200 or 503, got {r.status_code}: {r.text}"
    )
    if r.status_code == 503:
        data = r.json()
        assert "detail" in data, f"503 response should have 'detail': {data}"


def test_image_gen_workflow_graceful_without_deps(http: httpx.Client) -> None:
    """POST /image-gen/generate-workflow returns 503 (not 500) when deps missing."""
    r = http.post("/image-gen/generate-workflow", json={
        "preset_id": "portrait",
        "subject": "a cat",
    })
    assert r.status_code in (200, 404, 503), (
        f"POST /image-gen/generate-workflow unexpected status {r.status_code}: {r.text}"
    )
