/**
 * Supabase Realtime subscription for document sync.
 *
 * Subscribes to changes on the `notes` and `note_folders` tables,
 * then notifies the engine to pull updates and refresh the UI.
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

export function useRealtimeSync({
  userId,
  enabled,
  onNoteChange,
  onFolderChange,
}: UseRealtimeSyncOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const callbacksRef = useRef({ onNoteChange, onFolderChange });
  callbacksRef.current = { onNoteChange, onFolderChange };

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
      .channel("documents-sync")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notes",
          filter: `user_id=eq.${userId}`,
        },
        async (payload) => {
          const noteId = (payload.new as Record<string, unknown>)?.id as string
            || (payload.old as Record<string, unknown>)?.id as string;

          if (!noteId) return;

          // Pull the update through the engine (writes to local file)
          try {
            if (payload.eventType !== "DELETE") {
              await engine.pullNote(noteId, userId);
            }
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
          const folderId = (payload.new as Record<string, unknown>)?.id as string
            || (payload.old as Record<string, unknown>)?.id as string;

          if (folderId) {
            callbacksRef.current.onFolderChange?.(folderId, payload.eventType);
          }
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("[realtime] Subscribed to document changes");
        } else if (status === "CHANNEL_ERROR") {
          console.warn("[realtime] Channel error — will retry");
        }
      });

    channelRef.current = channel;

    return cleanup;
  }, [enabled, userId, cleanup]);

  return { cleanup };
}
