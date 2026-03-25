/**
 * Image generation API client.
 * Calls the local Python FastAPI engine at the discovered engine port.
 */

import type {
  ImageGenModelInfo,
  WorkflowPreset,
  ImageGenStatus,
  LoadModelResult,
  GenerateRequest,
  WorkflowGenerateRequest,
  GenerateResult,
} from "./types";

function engineUrl(port: number, path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    let detail = body;
    try {
      const parsed = JSON.parse(body) as { detail?: string };
      if (parsed.detail) detail = parsed.detail;
    } catch {
      // use raw body
    }
    throw new Error(detail || `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

export async function getImageGenStatus(port: number): Promise<ImageGenStatus> {
  return fetchJson<ImageGenStatus>(engineUrl(port, "/image-gen/status"));
}

export async function listImageGenModels(port: number): Promise<ImageGenModelInfo[]> {
  return fetchJson<ImageGenModelInfo[]>(engineUrl(port, "/image-gen/models"));
}

export async function listWorkflowPresets(port: number): Promise<WorkflowPreset[]> {
  return fetchJson<WorkflowPreset[]>(engineUrl(port, "/image-gen/presets"));
}

export async function loadImageGenModel(
  port: number,
  model_id: string
): Promise<LoadModelResult> {
  return fetchJson<LoadModelResult>(engineUrl(port, "/image-gen/load"), {
    method: "POST",
    body: JSON.stringify({ model_id }),
  });
}

export async function unloadImageGenModel(port: number): Promise<void> {
  await fetchJson(engineUrl(port, "/image-gen/unload"), { method: "POST" });
}

export async function generateImage(
  port: number,
  req: GenerateRequest
): Promise<GenerateResult> {
  return fetchJson<GenerateResult>(engineUrl(port, "/image-gen/generate"), {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function generateFromWorkflow(
  port: number,
  req: WorkflowGenerateRequest
): Promise<GenerateResult> {
  return fetchJson<GenerateResult>(engineUrl(port, "/image-gen/generate-workflow"), {
    method: "POST",
    body: JSON.stringify(req),
  });
}
