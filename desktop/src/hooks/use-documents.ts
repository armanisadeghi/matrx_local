/**
 * Document management hook — state management for the Documents page.
 *
 * LOCAL FIRST. Always.
 *
 * userId is optional for all read/write operations — the engine serves local
 * files without auth. userId is only used for cloud-sync operations (trigger
 * sync, version history, sharing). If userId is null the page works fully in
 * local-only mode.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { engine } from "@/lib/api";
import type {
  DocTree,
  DocNote,
  DocVersion,
  CreateNoteData,
  SyncStatus,
  DocShare,
} from "@/lib/api";

export interface DocumentsState {
  tree: DocTree | null;
  notes: DocNote[];
  activeNote: DocNote | null;
  versions: DocVersion[];
  shares: DocShare[];
  syncStatus: SyncStatus | null;
  activeFolderId: string | null;
  searchQuery: string;
  loading: boolean;
  saving: boolean;
  syncing: boolean;
  error: string | null;
}

const INITIAL_STATE: DocumentsState = {
  tree: null,
  notes: [],
  activeNote: null,
  versions: [],
  shares: [],
  syncStatus: null,
  activeFolderId: null,
  searchQuery: "",
  loading: true,
  saving: false,
  syncing: false,
  error: null,
};

export function useDocuments(userId: string | null) {
  const [state, setState] = useState<DocumentsState>(INITIAL_STATE);
  const mountedRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback((partial: Partial<DocumentsState>) => {
    if (mountedRef.current) {
      setState((prev) => ({ ...prev, ...partial }));
    }
  }, []);

  // ── Only the engine URL is required — userId is optional for local ops ───

  const engineReady = !!engine.engineUrl;

  // ── Load folder tree — local filesystem, no auth required ───────────────

  const loadTree = useCallback(async () => {
    if (!engineReady) return;
    try {
      // Pass userId only if available (used for sync config on the server, non-critical)
      const tree = await engine.getDocTree(userId ?? "local");
      update({ tree });
    } catch (err) {
      console.warn("[docs] Failed to load tree:", err);
      update({ tree: { folders: [], total_notes: 0, unfiled_notes: 0 } });
    }
  }, [engineReady, userId, update]);

  // ── Load notes — local filesystem, no auth required ─────────────────────

  const loadNotes = useCallback(
    async (folderId?: string | null, search?: string) => {
      if (!engineReady) return;
      try {
        update({ loading: true, error: null });
        const notes = await engine.listNotes(userId ?? "local", {
          folder_id: folderId ?? undefined,
          search: search ?? undefined,
        });
        update({ notes, loading: false });
      } catch (err) {
        update({
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load notes",
        });
      }
    },
    [engineReady, userId, update],
  );

  // ── Select folder ────────────────────────────────────────────────────────

  const selectFolder = useCallback(
    (folderId: string | null) => {
      update({ activeFolderId: folderId, activeNote: null, searchQuery: "" });
      loadNotes(folderId);
    },
    [update, loadNotes],
  );

  // ── Search ───────────────────────────────────────────────────────────────

  const search = useCallback(
    (query: string) => {
      update({ searchQuery: query, activeFolderId: null, activeNote: null });
      loadNotes(null, query);
    },
    [update, loadNotes],
  );

  // ── Select note ──────────────────────────────────────────────────────────

  const selectNote = useCallback(
    async (noteId: string) => {
      if (!engineReady) return;
      try {
        const note = await engine.getNote(noteId, userId ?? "local");
        update({ activeNote: note });

        // Version history only available if signed in
        if (userId) {
          engine.listVersions(noteId, userId).then((versions) => {
            if (mountedRef.current) update({ versions });
          }).catch(() => { /* non-critical */ });
        }
      } catch (err) {
        update({
          error: err instanceof Error ? err.message : "Failed to load note",
        });
      }
    },
    [engineReady, userId, update],
  );

  // ── Create note ──────────────────────────────────────────────────────────

  const createNote = useCallback(
    async (data: CreateNoteData) => {
      if (!engineReady) return null;
      try {
        update({ saving: true, error: null });
        const note = await engine.createNote(userId ?? "local", data);
        await loadTree();
        await loadNotes(state.activeFolderId);
        update({ saving: false, activeNote: note });
        return note;
      } catch (err) {
        update({
          saving: false,
          error: err instanceof Error ? err.message : "Failed to create note",
        });
        return null;
      }
    },
    [engineReady, userId, state.activeFolderId, update, loadTree, loadNotes],
  );

  // ── Update note (debounced for content, immediate for metadata) ──────────

  const updateNote = useCallback(
    async (noteId: string, data: Partial<CreateNoteData>, immediate = false) => {
      if (!engineReady) return;

      if (data.content !== undefined) {
        update({
          activeNote: state.activeNote
            ? { ...state.activeNote, content: data.content }
            : null,
        });
      }

      if (immediate) {
        try {
          update({ saving: true });
          await engine.updateNote(noteId, userId ?? "local", data);
          update({ saving: false });
          if (data.label || data.folder_id || data.folder_name) {
            await loadTree();
            await loadNotes(state.activeFolderId);
          }
        } catch (err) {
          update({
            saving: false,
            error: err instanceof Error ? err.message : "Failed to save",
          });
        }
        return;
      }

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        try {
          update({ saving: true });
          await engine.updateNote(noteId, userId ?? "local", data);
          update({ saving: false });
        } catch (err) {
          update({
            saving: false,
            error: err instanceof Error ? err.message : "Failed to save",
          });
        }
      }, 1000);
    },
    [engineReady, userId, state.activeNote, state.activeFolderId, update, loadTree, loadNotes],
  );

  // ── Delete note ──────────────────────────────────────────────────────────

  const deleteNote = useCallback(
    async (noteId: string) => {
      if (!engineReady) return;
      try {
        await engine.deleteNote(noteId, userId ?? "local");
        update({ activeNote: null, versions: [] });
        await loadTree();
        await loadNotes(state.activeFolderId);
      } catch (err) {
        update({
          error: err instanceof Error ? err.message : "Failed to delete",
        });
      }
    },
    [engineReady, userId, state.activeFolderId, update, loadTree, loadNotes],
  );

  // ── Create folder ────────────────────────────────────────────────────────

  const createFolder = useCallback(
    async (name: string, parentId?: string) => {
      if (!engineReady) return null;
      try {
        const folder = await engine.createFolder(userId ?? "local", {
          name,
          parent_id: parentId,
        });
        await loadTree();
        return folder;
      } catch (err) {
        update({
          error: err instanceof Error ? err.message : "Failed to create folder",
        });
        return null;
      }
    },
    [engineReady, userId, update, loadTree],
  );

  // ── Delete folder ────────────────────────────────────────────────────────

  const deleteFolder = useCallback(
    async (folderId: string) => {
      if (!engineReady) return;
      try {
        await engine.deleteFolder(folderId, userId ?? "local");
        if (state.activeFolderId === folderId) {
          update({ activeFolderId: null, activeNote: null });
        }
        await loadTree();
        await loadNotes(null);
      } catch (err) {
        update({
          error: err instanceof Error ? err.message : "Failed to delete folder",
        });
      }
    },
    [engineReady, userId, state.activeFolderId, update, loadTree, loadNotes],
  );

  // ── Revert note — requires cloud sync (needs userId) ────────────────────

  const revertNote = useCallback(
    async (noteId: string, versionNumber: number) => {
      if (!engineReady || !userId) return;
      try {
        const note = await engine.revertNote(noteId, userId, versionNumber);
        update({ activeNote: note });
        const versions = await engine.listVersions(noteId, userId);
        update({ versions });
      } catch (err) {
        update({
          error: err instanceof Error ? err.message : "Failed to revert",
        });
      }
    },
    [engineReady, userId, update],
  );

  // ── Sync operations — require userId ────────────────────────────────────

  const triggerSync = useCallback(async () => {
    if (!engineReady || !userId) return null;
    try {
      update({ syncing: true, error: null });
      const result = await engine.triggerSync(userId);
      await loadTree();
      await loadNotes(state.activeFolderId);
      const syncStatus = await engine.getSyncStatus(userId);
      update({ syncing: false, syncStatus });
      return result;
    } catch (err) {
      update({
        syncing: false,
        error: err instanceof Error ? err.message : "Sync failed",
      });
      return null;
    }
  }, [engineReady, userId, state.activeFolderId, update, loadTree, loadNotes]);

  const loadSyncStatus = useCallback(async () => {
    if (!engineReady || !userId) return;
    try {
      const syncStatus = await engine.getSyncStatus(userId);
      update({ syncStatus });
    } catch {
      // Non-critical
    }
  }, [engineReady, userId, update]);

  const loadShares = useCallback(async () => {
    if (!engineReady || !userId) return;
    try {
      const shares = await engine.listShares(userId);
      update({ shares });
    } catch {
      // Non-critical
    }
  }, [engineReady, userId, update]);

  // ── Initial load — engine connection is all that's needed ────────────────

  useEffect(() => {
    mountedRef.current = true;

    if (engineReady) {
      loadTree();
      loadNotes();
      if (userId) loadSyncStatus();
    } else {
      // Engine not yet available — clear loading state so we show the right UI
      update({ loading: false });
    }

    return () => {
      mountedRef.current = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [engineReady, userId, loadTree, loadNotes, loadSyncStatus, update]);

  return {
    ...state,
    isLocalOnly: !userId,
    loadTree,
    loadNotes,
    selectFolder,
    search,
    selectNote,
    createNote,
    updateNote,
    deleteNote,
    createFolder,
    deleteFolder,
    revertNote,
    triggerSync,
    loadSyncStatus,
    loadShares,
  };
}
