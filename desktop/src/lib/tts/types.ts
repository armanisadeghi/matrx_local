export interface TtsVoice {
  voice_id: string;
  name: string;
  gender: "female" | "male";
  language: string;
  lang_code: string;
  quality_grade: string;
  traits: string[];
  is_custom: boolean;
  is_default: boolean;
}

export interface TtsStatus {
  available: boolean;
  unavailable_reason: string | null;
  model_downloaded: boolean;
  model_loaded: boolean;
  is_downloading: boolean;
  download_progress: number;
  model_dir: string;
  voice_count: number;
}

export interface SynthesizeRequest {
  text: string;
  voice_id?: string;
  speed?: number;
  lang?: string;
}

export interface SynthesizeResponse {
  success: boolean;
  duration_seconds: number;
  voice_id: string;
  elapsed_seconds: number;
  sample_rate: number;
  error: string | null;
}

export interface DownloadResponse {
  success: boolean;
  already_downloaded?: boolean;
  error?: string;
}

export type TtsLanguageGroup = {
  language: string;
  lang_code: string;
  voices: TtsVoice[];
};
