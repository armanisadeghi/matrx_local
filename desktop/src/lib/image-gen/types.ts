// ── Image Generation Types ────────────────────────────────────────────────

export interface ImageGenModelInfo {
  model_id: string;
  name: string;
  provider: string;
  pipeline_type: string;
  vram_gb: number;
  ram_gb: number;
  description: string;
  quality_rating: number;
  speed_rating: number;
  recommended_steps: number;
  recommended_guidance: number;
  supports_negative_prompt: boolean;
  model_card_url: string;
  default_width: number;
  default_height: number;
  requires_hf_token: boolean;
  tags: string[];
}

export interface WorkflowPreset {
  preset_id: string;
  name: string;
  description: string;
  /** Contains {subject} placeholder. */
  prompt_template: string;
  negative_prompt: string;
  suggested_model_id: string;
  steps: number;
  guidance: number;
  width: number;
  height: number;
  tags: string[];
}

export interface ImageGenStatus {
  available: boolean;
  unavailable_reason: string | null;
  loaded_model_id: string | null;
  is_loading: boolean;
  load_progress: number;
}

export interface LoadModelResult {
  success: boolean;
  model_id?: string;
  device?: string;
  already_loaded?: boolean;
  error?: string;
}

export interface GenerateRequest {
  prompt: string;
  model_id: string;
  negative_prompt?: string;
  steps?: number;
  guidance?: number;
  width?: number;
  height?: number;
  seed?: number;
}

export interface WorkflowGenerateRequest {
  preset_id: string;
  subject: string;
  model_id?: string;
  seed?: number;
}

export interface GenerateResult {
  success: boolean;
  /** Base64-encoded PNG. Use as: `data:image/png;base64,${image_b64}` */
  image_b64?: string;
  width: number;
  height: number;
  model_id: string;
  elapsed_seconds: number;
  error?: string;
}
