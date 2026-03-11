// ── LLM Model Types ───────────────────────────────────────────────────────

export type LlmTier = "Low" | "LowAlt" | "Default" | "High" | "HighAlt";

export interface LlmModelInfo {
  tier: LlmTier;
  name: string;
  filename: string;
  disk_size_gb: number;
  ram_required_gb: number;
  tool_calling_rating: number;
  speed: string;
  description: string;
  hf_url: string;
  /** Additional part URLs for split models (empty for single-file models). */
  hf_parts: string[];
  /** True when the model is distributed as multiple split files. */
  is_split: boolean;
  /** All part URLs in download order (hf_url + hf_parts). */
  all_part_urls: string[];
  context_length: number;
  /** Expected assembled file size in bytes. Used to detect partial downloads. */
  expected_size_bytes: number;
}

export interface LlmHardwareResult {
  hardware: {
    total_ram_mb: number;
    cpu_threads: number;
    gpu_vram_mb: number | null;
    supports_cuda: boolean;
    supports_metal: boolean;
    is_apple_silicon: boolean;
  };
  recommended_tier: LlmTier;
  recommended_filename: string;
  recommended_name: string;
  recommended_size_gb: number;
  recommended_gpu_layers: number;
  reason: string;
  can_upgrade: boolean;
  all_models: LlmModelInfo[];
}

// ── Server Status ─────────────────────────────────────────────────────────

export interface LlmServerStatus {
  running: boolean;
  port: number;
  model_path: string;
  model_name: string;
  gpu_layers: number;
  context_length: number;
}

// ── Setup Status ──────────────────────────────────────────────────────────

export interface LlmSetupStatus {
  setup_complete: boolean;
  selected_model: string | null;
  server_running: boolean;
  server_port: number;
  server_model: string;
  downloaded_models: string[];
}

// ── Download Progress ─────────────────────────────────────────────────────

export interface LlmDownloadProgress {
  filename: string;
  /** Current part index (1-based). */
  part: number;
  /** Total number of parts. */
  total_parts: number;
  /** Bytes downloaded for the current part. */
  part_bytes_downloaded: number;
  /** Total bytes for the current part (0 if unknown). */
  part_total_bytes: number;
  /** Total bytes downloaded across all parts. */
  bytes_downloaded: number;
  /** Grand total bytes across all parts (0 if unknown). */
  total_bytes: number;
  /** Overall download percentage (0–100). */
  percent: number;
  /** Lifecycle status hint from the backend. */
  status?: "downloading" | "already_complete";
}

export interface LlmDownloadCancelledEvent {
  reason: "user_cancelled" | "stalled" | string;
}

// ── Downloaded Model Info ─────────────────────────────────────────────────

export interface DownloadedLlmModel {
  filename: string;
  size_bytes: number;
  size_gb: string;
  name: string;
  tier: LlmTier | null;
}

// ── Chat / Inference Types ────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
}
