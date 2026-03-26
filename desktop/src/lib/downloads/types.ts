/**
 * Shared types for the universal download manager.
 * Used by DownloadManagerContext, DownloadManagerModal, and DownloadBadge.
 */

export type DownloadStatus = "queued" | "active" | "completed" | "failed" | "cancelled";

export type DownloadCategory = "llm" | "whisper" | "image_gen" | "tts" | "file_sync";

export interface DownloadEntry {
  id: string;
  category: string;
  filename: string;
  display_name: string;
  urls: string[];
  total_bytes: number;
  bytes_done: number;
  percent: number;
  status: DownloadStatus;
  error_msg: string | null;
  priority: number;
  part_current: number;
  part_total: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  /** Computed client-side from recent events; not persisted */
  speed_bps?: number;
  eta_seconds?: number | null;
}

export interface EnqueueOptions {
  id?: string;
  category: string;
  filename: string;
  display_name: string;
  urls: string[];
  priority?: number;
  metadata?: Record<string, unknown> | null;
}
