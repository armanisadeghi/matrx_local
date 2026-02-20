/**
 * Document management hook — state management for the Documents page.
 *
 * Manages folder tree, note list, active note, CRUD operations,
 * sync status, and conflict tracking.
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

  // ── Load folder tree ────────────────────────────────────────────────────

  const loadTree = useCallback(async () => {
    if (!userId || !engine.engineUrl) return;
    try {
      const tree = await engine.getDocTree(userId);
      update({ tree });
    } catch (err) {
      console.warn("[docs] Failed to load tree:", err);
    }
  }, [userId, update]);

  // ── Load notes ──────────────────────────────────────────────────────────

  const loadNotes = useCallback(
    async (folderId?: string | null, search?: string) => {
      if (!userId || !engine.engineUrl) return;
      try {
        update({ loading: true, error: null });
        const notes = await engine.listNotes(userId, {
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
    [userId, update],
  );

  // ── Select folder ───────────────────────────────────────────────────────

  const selectFolder = useCallback(
    (folderId: string | null) => {
      update({ activeFolderId: folderId, activeNote: null, searchQuery: "" });
      loadNotes(folderId);
    },
    [update, loadNotes],
  );

  // ── Search ──────────────────────────────────────────────────────────────

  const search = useCallback(
    (query: string) => {
      update({ searchQuery: query, activeFolderId: null, activeNote: null });
      loadNotes(null, query);
    },
    [update, loadNotes],
  );

  // ── Select note ─────────────────────────────────────────────────────────

  const selectNote = useCallback(
    async (noteId: string) => {
      if (!userId || !engine.engineUrl) return;
      try {
        const note = await engine.getNote(noteId, userId);
        update({ activeNote: note });

        // Load versions in background
        engine.listVersions(noteId, userId).then((versions) => {
          if (mountedRef.current) update({ versions });
        });
      } catch (err) {
        update({
          error: err instanceof Error ? err.message : "Failed to load note",
        });
      }
    },
    [userId, update],
  );

  // ── Create note ─────────────────────────────────────────────────────────

  const createNote = useCallback(
    async (data: CreateNoteData) => {
      if (!userId || !engine.engineUrl) return null;
      try {
        update({ saving: true, error: null });
        const note = await engine.createNote(userId, data);
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
    [userId, state.activeFolderId, update, loadTree, loadNotes],
  );

  // ── Update note (debounced for content, immediate for metadata) ─────────

  const updateNote = useCallback(
    async (noteId: string, data: Partial<CreateNoteData>, immediate = false) => {
      if (!userId || !engine.engineUrl) return;

      // Update local state immediately for responsiveness
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
          await engine.updateNote(noteId, userId, data);
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

      // Debounced save for content changes
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        try {
          update({ saving: true });
          await engine.updateNote(noteId, userId, data);
          update({ saving: false });
        } catch (err) {
          update({
            saving: false,
            error: err instanceof Error ? err.message : "Failed to save",
          });
        }
      }, 1000);
    },
    [userId, state.activeNote, state.activeFolderId, update, loadTree, loadNotes],
  );

  // ── Delete note ─────────────────────────────────────────────────────────

  const deleteNote = useCallback(
    async (noteId: string) => {
      if (!userId || !engine.engineUrl) return;
      try {
        await engine.deleteNote(noteId, userId);
        update({ activeNote: null, versions: [] });
        await loadTree();
        await loadNotes(state.activeFolderId);
      } catch (err) {
        update({
          error: err instanceof Error ? err.message : "Failed to delete",
        });
      }
    },
    [userId, state.activeFolderId, update, loadTree, loadNotes],
  );

  // ── Create folder ───────────────────────────────────────────────────────

  const createFolder = useCallback(
    async (name: string, parentId?: string) => {
      if (!userId || !engine.engineUrl) return null;
      try {
        const folder = await engine.createFolder(userId, {
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
    [userId, update, loadTree],
  );

  // ── Delete folder ───────────────────────────────────────────────────────

  const deleteFolder = useCallback(
    async (folderId: string) => {
      if (!userId || !engine.engineUrl) return;
      try {
        await engine.deleteFolder(folderId, userId);
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
    [userId, state.activeFolderId, update, loadTree, loadNotes],
  );

  // ── Revert note ─────────────────────────────────────────────────────────

  const revertNote = useCallback(
    async (noteId: string, versionNumber: number) => {
      if (!userId || !engine.engineUrl) return;
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
    [userId, update],
  );

  // ── Sync operations ─────────────────────────────────────────────────────

  const triggerSync = useCallback(async () => {
    if (!userId || !engine.engineUrl) return null;
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
  }, [userId, state.activeFolderId, update, loadTree, loadNotes]);

  const loadSyncStatus = useCallback(async () => {
    if (!userId || !engine.engineUrl) return;
    try {
      const syncStatus = await engine.getSyncStatus(userId);
      update({ syncStatus });
    } catch {
      // Non-critical
    }
  }, [userId, update]);

  // ── Shares ──────────────────────────────────────────────────────────────

  const loadShares = useCallback(async () => {
    if (!userId || !engine.engineUrl) return;
    try {
      const shares = await engine.listShares(userId);
      update({ shares });
    } catch {
      // Non-critical
    }
  }, [userId, update]);

  // ── Initial load ────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;

    if (userId && engine.engineUrl) {
      loadTree();
      loadNotes();
      loadSyncStatus();
    }

    return () => {
      mountedRef.current = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [userId, loadTree, loadNotes, loadSyncStatus]);

  return {
    ...state,
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
