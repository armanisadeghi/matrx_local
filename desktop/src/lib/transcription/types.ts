export type WhisperModelTier = "Low" | "Default" | "High";

export interface HardwareInfo {
  total_ram_mb: number;
  cpu_threads: number;
  gpu_vram_mb: number | null;
  supports_cuda: boolean;
  supports_metal: boolean;
  is_apple_silicon: boolean;
}

export interface ModelInfo {
  tier: WhisperModelTier;
  filename: string;
  download_size_mb: number;
  ram_required_mb: number;
  relative_speed: string;
  accuracy: string;
  description: string;
}

export interface HardwareDetectionResult {
  hardware: HardwareInfo;
  recommended_tier: WhisperModelTier;
  recommended_filename: string;
  recommended_size_mb: number;
  reason: string;
  can_upgrade: boolean;
  all_models: ModelInfo[];
}

export interface WhisperSegment {
  text: string;
  start_sec: number;
  end_sec: number;
}

export interface DownloadProgress {
  filename: string;
  bytes_downloaded: number;
  total_bytes: number;
  percent: number;
}

export interface VoiceSetupStatus {
  setup_complete: boolean;
  selected_model: string | null;
  downloaded_models: string[];
}

export interface AudioDeviceInfo {
  name: string;
  is_default: boolean;
  sample_rates: number[];
  channels: number[];
}

/** A persisted transcription recording session. */
export interface TranscriptionSession {
  id: string;
  /** User-supplied title, or null if untitled */
  title: string | null;
  /** ISO timestamp of when recording started */
  createdAt: string;
  /** ISO timestamp of last update (segments appended, title changed, etc.) */
  updatedAt: string;
  /** Duration in seconds (populated when recording stops) */
  durationSecs: number;
  /** Total characters in the full transcript */
  charCount: number;
  /** The whisper model used */
  modelUsed: string | null;
  /** Audio device used (null = system default) */
  deviceUsed: string | null;
  /** All transcribed segments */
  segments: WhisperSegment[];
  /** Concatenated full transcript text */
  fullText: string;
}
