/**
 * Universal Download Manager Context.
 *
 * Single source of truth for all downloads across the app.
 * Listens to:
 *  1. Tauri events: dm-progress, dm-queued, dm-completed, dm-failed, dm-cancelled
 *     (for Rust-side downloads: LLM models, Whisper models)
 *  2. SSE stream: GET /downloads/stream
 *     (for Python-side downloads: image-gen, TTS, file-sync)
 *
 * Exposes:
 *  - downloads: DownloadEntry[]  sorted active→queued→completed/failed
 *  - activeCount: number
 *  - enqueue(opts): trigger a download via Tauri (Rust) or Python (POST /downloads)
 *  - cancel(id): cancel by ID
 *  - openModal() / closeModal() / isModalOpen
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { isTauri } from "@/lib/sidecar";
import { engine } from "@/lib/api";
import type { DownloadEntry, EnqueueOptions } from "@/lib/downloads/types";

// Re-export for convenience
export type { DownloadEntry, EnqueueOptions };

interface DownloadManagerContextValue {
  downloads: DownloadEntry[];
  activeCount: number;
  isModalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  enqueue: (opts: EnqueueOptions) => Promise<DownloadEntry | null>;
  cancel: (id: string) => Promise<void>;
}

const DownloadManagerContext =
  createContext<DownloadManagerContextValue | null>(null);

// How long to keep completed/failed/cancelled entries in memory before pruning
const HISTORY_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

async function tauriListen(
  event: string,
  handler: (payload: unknown) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen(event, (e) => handler(e.payload));
}

function mergeEntry(
  prev: Map<string, DownloadEntry>,
  incoming: Partial<DownloadEntry> & { id: string },
): Map<string, DownloadEntry> {
  const next = new Map(prev);
  const existing = next.get(incoming.id);
  next.set(incoming.id, {
    ...existing,
    ...incoming,
    // Keep richer speed/eta from the last progress event
    speed_bps: incoming.speed_bps ?? existing?.speed_bps ?? 0,
    eta_seconds:
      incoming.eta_seconds !== undefined
        ? incoming.eta_seconds
        : existing?.eta_seconds,
  } as DownloadEntry);
  return next;
}

function sortedEntries(map: Map<string, DownloadEntry>): DownloadEntry[] {
  const rank = (s: string) => {
    switch (s) {
      case "active":
        return 0;
      case "queued":
        return 1;
      case "failed":
        return 2;
      case "cancelled":
        return 3;
      case "completed":
        return 4;
      default:
        return 5;
    }
  };
  return Array.from(map.values()).sort(
    (a, b) =>
      rank(a.status) - rank(b.status) ||
      a.created_at.localeCompare(b.created_at),
  );
}

// Track last-seen bytes/time per download for speed calculation
const speedTracker = new Map<string, { bytes: number; time: number }>();

export function DownloadManagerProvider({ children }: { children: ReactNode }) {
  const [entriesMap, setEntriesMap] = useState<Map<string, DownloadEntry>>(
    new Map(),
  );
  const [isModalOpen, setIsModalOpen] = useState(false);
  const sseRef = useRef<EventSource | null>(null);
  const unlistenFns = useRef<Array<() => void>>([]);

  // Computed from map
  const downloads = sortedEntries(entriesMap);
  const activeCount = downloads.filter(
    (d) => d.status === "active" || d.status === "queued",
  ).length;

  // Merge a progress event payload into state, computing speed from byte deltas if not provided
  const handleEvent = useCallback((raw: unknown) => {
    if (!raw || typeof raw !== "object") return;
    const payload = raw as Partial<DownloadEntry> & { id?: string };
    if (!payload.id) return;

    // Compute speed from byte delta when the emitter doesn't provide it
    let speed_bps = (payload as { speed_bps?: number }).speed_bps ?? 0;
    const bytes = (payload as { bytes_done?: number }).bytes_done ?? 0;
    if (speed_bps === 0 && bytes > 0) {
      const now = Date.now();
      const prev = speedTracker.get(payload.id);
      if (prev && bytes > prev.bytes) {
        const dt = (now - prev.time) / 1000;
        if (dt > 0.5) {
          speed_bps = (bytes - prev.bytes) / dt;
          speedTracker.set(payload.id, { bytes, time: now });
        }
      } else {
        speedTracker.set(payload.id, { bytes, time: now });
      }
    }

    // Compute ETA from speed + remaining bytes when not provided
    let eta_seconds = (payload as { eta_seconds?: number }).eta_seconds;
    if (eta_seconds === undefined && speed_bps > 0) {
      const total = (payload as { total_bytes?: number }).total_bytes ?? 0;
      const remaining = total > bytes ? total - bytes : 0;
      if (remaining > 0) eta_seconds = remaining / speed_bps;
    }

    setEntriesMap((prev) =>
      mergeEntry(prev, {
        ...(payload as DownloadEntry & { id: string }),
        speed_bps,
        eta_seconds,
      }),
    );
  }, []);

  // ── Tauri event listeners ────────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;

    const cleanup: Array<() => void> = [];

    (async () => {
      // Core DM events
      const coreEvents = [
        "dm-progress",
        "dm-queued",
        "dm-completed",
        "dm-failed",
        "dm-cancelled",
      ];
      for (const evt of coreEvents) {
        const unlisten = await tauriListen(evt, handleEvent);
        cleanup.push(unlisten);
      }

      // Bridge llm-download-progress → dm-progress so that external (register_external)
      // LLM downloads show live progress in the modal.
      const unlistenLlm = await tauriListen("llm-download-progress", (raw) => {
        if (!raw || typeof raw !== "object") return;
        const p = raw as Record<string, unknown>;
        const filename = p["filename"] as string | undefined;
        if (!filename) return;
        const id = `llm-${filename}`;
        const bytesDone = (p["bytes_downloaded"] as number | undefined) ?? 0;
        const totalBytes = (p["total_bytes"] as number | undefined) ?? 0;
        const percent = (p["percent"] as number | undefined) ?? 0;
        const partCurrent = (p["part"] as number | undefined) ?? 1;
        const partTotal = (p["total_parts"] as number | undefined) ?? 1;
        handleEvent({
          id,
          category: "llm",
          filename,
          display_name: filename,
          status: percent >= 100 ? "completed" : "active",
          bytes_done: bytesDone,
          total_bytes: totalBytes,
          percent,
          part_current: partCurrent,
          part_total: partTotal,
          speed_bps: 0,
          eta_seconds: undefined,
        });
      });
      cleanup.push(unlistenLlm);

      // Bridge whisper-download-progress → dm-progress
      const unlistenWhisper = await tauriListen(
        "whisper-download-progress",
        (raw) => {
          if (!raw || typeof raw !== "object") return;
          const p = raw as Record<string, unknown>;
          const filename =
            (p["filename"] as string | undefined) ?? "whisper-model";
          const id = `whisper-${filename}`;
          const bytesDone = (p["bytes_downloaded"] as number | undefined) ?? 0;
          const totalBytes = (p["total_bytes"] as number | undefined) ?? 0;
          const percent = (p["percent"] as number | undefined) ?? 0;
          handleEvent({
            id,
            category: "whisper",
            filename,
            display_name: filename,
            status: percent >= 100 ? "completed" : "active",
            bytes_done: bytesDone,
            total_bytes: totalBytes,
            percent,
            part_current: 1,
            part_total: 1,
            speed_bps: 0,
            eta_seconds: undefined,
          });
        },
      );
      cleanup.push(unlistenWhisper);

      unlistenFns.current = cleanup;
    })();

    return () => {
      cleanup.forEach((fn) => fn());
    };
  }, [handleEvent]);

  // ── SSE stream from Python engine ──────────────────────────────────────
  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 2000;
    let cancelled = false;

    const connect = () => {
      const engineUrl = engine.engineUrl;
      if (!engineUrl) {
        // Engine not discovered yet — retry
        retryTimeout = setTimeout(connect, 3000);
        return;
      }

      es = new EventSource(`${engineUrl}/downloads/stream`);
      sseRef.current = es;

      es.onmessage = (evt) => {
        try {
          const payload = JSON.parse(evt.data);
          handleEvent(payload);
          retryDelay = 2000; // Reset backoff on success
        } catch {
          // Ignore malformed events
        }
      };

      es.onerror = () => {
        es?.close();
        es = null;
        sseRef.current = null;
        if (!cancelled) {
          retryTimeout = setTimeout(connect, Math.min(retryDelay, 30000));
          retryDelay = Math.min(retryDelay * 2, 30000);
        }
      };
    };

    // Delay initial connect slightly to let engine discovery complete
    retryTimeout = setTimeout(connect, 1000);

    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      es?.close();
      sseRef.current = null;
    };
  }, [handleEvent]);

  // ── Prune old history entries ────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(
      () => {
        const cutoff = Date.now() - HISTORY_TTL_MS;
        setEntriesMap((prev) => {
          const next = new Map(prev);
          for (const [id, entry] of next) {
            if (
              (entry.status === "completed" || entry.status === "cancelled") &&
              new Date(entry.updated_at).getTime() < cutoff
            ) {
              next.delete(id);
            }
          }
          return next;
        });
      },
      5 * 60 * 1000,
    ); // check every 5 min
    return () => clearInterval(interval);
  }, []);

  // ── API ──────────────────────────────────────────────────────────────────

  const enqueue = useCallback(
    async (opts: EnqueueOptions): Promise<DownloadEntry | null> => {
      const id = opts.id ?? `${opts.category}-${opts.filename}-${Date.now()}`;
      try {
        if (isTauri()) {
          const entry = await tauriInvoke<DownloadEntry>("dm_enqueue", {
            id,
            category: opts.category,
            filename: opts.filename,
            displayName: opts.display_name,
            urls: opts.urls,
            priority: opts.priority ?? 0,
            metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
          });
          setEntriesMap((prev) => mergeEntry(prev, entry));
          return entry;
        } else {
          // Browser mode — POST to Python engine
          const engineUrl = engine.engineUrl;
          if (!engineUrl) return null;
          const resp = await fetch(`${engineUrl}/downloads`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              download_id: id,
              category: opts.category,
              filename: opts.filename,
              display_name: opts.display_name,
              urls: opts.urls,
              priority: opts.priority ?? 0,
              metadata: opts.metadata,
            }),
          });
          if (!resp.ok) return null;
          const entry: DownloadEntry = await resp.json();
          setEntriesMap((prev) => mergeEntry(prev, entry));
          return entry;
        }
      } catch (e) {
        console.error("[DownloadManager] enqueue failed:", e);
        return null;
      }
    },
    [],
  );

  const cancel = useCallback(async (id: string): Promise<void> => {
    try {
      if (isTauri()) {
        await tauriInvoke("dm_cancel", { id });
      } else {
        const engineUrl = engine.engineUrl;
        if (!engineUrl) return;
        await fetch(`${engineUrl}/downloads/${id}`, { method: "DELETE" });
      }
      // Optimistically update UI
      setEntriesMap((prev) => {
        const next = new Map(prev);
        const entry = next.get(id);
        if (entry && (entry.status === "active" || entry.status === "queued")) {
          next.set(id, {
            ...entry,
            status: "cancelled",
            updated_at: new Date().toISOString(),
          });
        }
        return next;
      });
    } catch (e) {
      console.error("[DownloadManager] cancel failed:", e);
    }
  }, []);

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => setIsModalOpen(false), []);

  return (
    <DownloadManagerContext.Provider
      value={{
        downloads,
        activeCount,
        isModalOpen,
        openModal,
        closeModal,
        enqueue,
        cancel,
      }}
    >
      {children}
    </DownloadManagerContext.Provider>
  );
}

export function useDownloadManager(): DownloadManagerContextValue {
  const ctx = useContext(DownloadManagerContext);
  if (!ctx) {
    throw new Error(
      "useDownloadManager must be used inside <DownloadManagerProvider>",
    );
  }
  return ctx;
}
