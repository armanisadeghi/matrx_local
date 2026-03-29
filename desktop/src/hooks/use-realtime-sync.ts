/**
 * Supabase Realtime subscription for notes sync.
 *
 * Subscribes to changes on the `notes` and `note_folders` tables,
 * then notifies the engine to pull updates and refresh the UI.
 *
 * Critical invariant: a Realtime pull must NEVER overwrite a local edit that
 * is currently in-flight (debounce timer pending). Callers signal this by
 * calling `markNoteEditing(noteId)` / `markNoteIdle(noteId)`. While a note
 * is marked as editing, remote pull events for that note are deferred and
 * re-checked after a short backoff instead of being applied immediately.
 */

import { useEffect, useRef, useCallback } from "react";
import supabase from "@/lib/supabase";
import { engine } from "@/lib/api";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface UseRealtimeSyncOptions {
  userId: string | null;
  enabled: boolean;
  onNoteChange?: (noteId: string, eventType: string) => void;
  onFolderChange?: (folderId: string, eventType: string) => void;
}

/** Notes currently being edited locally — Realtime pulls are suppressed for these. */
const _editingNotes = new Set<string>();

/** Mark a note as actively being edited (suppresses Realtime pull for that note). */
export function markNoteEditing(noteId: string): void {
  _editingNotes.add(noteId);
}

/** Mark a note as idle (re-enables Realtime pulls for that note). */
export function markNoteIdle(noteId: string): void {
  _editingNotes.delete(noteId);
}

/** How long to wait before retrying a deferred pull (ms). */
const DEFERRED_PULL_DELAY_MS = 2000;

export function useRealtimeSync({
  userId,
  enabled,
  onNoteChange,
  onFolderChange,
}: UseRealtimeSyncOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const callbacksRef = useRef({ onNoteChange, onFolderChange });
  callbacksRef.current = { onNoteChange, onFolderChange };

  // Track the timestamp of the most recent local push per note so we can
  // suppress the Supabase echo that arrives shortly after our own push.
  const recentPushesRef = useRef<Map<string, number>>(new Map());

  const cleanup = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !userId) {
      cleanup();
      return;
    }

    const channel = supabase
      .channel("notes-sync")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notes",
          filter: `user_id=eq.${userId}`,
        },
        async (payload) => {
          const noteId =
            ((payload.new as Record<string, unknown>)?.id as string) ||
            ((payload.old as Record<string, unknown>)?.id as string);

          if (!noteId) return;

          // Suppress self-echo: if this device pushed this note within the last
          // 10 seconds the Realtime event is almost certainly our own update
          // bouncing back. Skip the pull entirely.
          const lastPush = recentPushesRef.current.get(noteId) ?? 0;
          if (Date.now() - lastPush < 10_000) {
            // Still notify UI (list may need refresh) but don't pull the file.
            callbacksRef.current.onNoteChange?.(noteId, payload.eventType);
            return;
          }

          if (payload.eventType === "DELETE") {
            callbacksRef.current.onNoteChange?.(noteId, payload.eventType);
            return;
          }

          // If the user is actively editing this note, defer the pull so we
          // don't overwrite keystrokes that haven't been flushed yet.
          if (_editingNotes.has(noteId)) {
            setTimeout(async () => {
              // Only pull if the note is still idle after the backoff.
              if (_editingNotes.has(noteId)) return;
              try {
                await engine.pullNote(noteId, userId);
              } catch {
                // Non-critical: will sync on next full sync
              }
              callbacksRef.current.onNoteChange?.(noteId, payload.eventType);
            }, DEFERRED_PULL_DELAY_MS);
            return;
          }

          // Pull the update through the engine (writes to local file).
          try {
            await engine.pullNote(noteId, userId);
          } catch {
            // Non-critical: will sync on next full sync
          }

          callbacksRef.current.onNoteChange?.(noteId, payload.eventType);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "note_folders",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const folderId =
            ((payload.new as Record<string, unknown>)?.id as string) ||
            ((payload.old as Record<string, unknown>)?.id as string);

          if (folderId) {
            callbacksRef.current.onFolderChange?.(folderId, payload.eventType);
          }
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("[realtime] Subscribed to notes changes");
        } else if (status === "CHANNEL_ERROR") {
          console.warn("[realtime] Channel error — will retry");
        }
      });

    channelRef.current = channel;

    return cleanup;
  }, [enabled, userId, cleanup]);

  /**
   * Call this after successfully pushing a note to Supabase so the Realtime
   * echo from that push is suppressed.
   */
  const recordLocalPush = useCallback((noteId: string) => {
    recentPushesRef.current.set(noteId, Date.now());
    // Clean up old entries periodically so the map doesn't grow unbounded.
    if (recentPushesRef.current.size > 200) {
      const cutoff = Date.now() - 60_000;
      for (const [id, ts] of recentPushesRef.current) {
        if (ts < cutoff) recentPushesRef.current.delete(id);
      }
    }
  }, []);

  return { cleanup, recordLocalPush };
}
