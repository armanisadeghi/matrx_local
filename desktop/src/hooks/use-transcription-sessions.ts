/**
 * Hook for managing transcription session history.
 * Wraps the sessions persistence layer and exposes reactive state.
 */

import { useState, useCallback } from "react";
import type { TranscriptionSession, WhisperSegment } from "@/lib/transcription/types";
import {
  loadSessions,
  createSession,
  appendSegments,
  finalizeSession,
  renameSession,
  updateSessionText,
  deleteSession,
  getSession,
} from "@/lib/transcription/sessions";

export interface SessionsState {
  sessions: TranscriptionSession[];
  /** The session currently open in the editor (may differ from active recording) */
  viewingSessionId: string | null;
  viewingSession: TranscriptionSession | null;
}

export interface SessionsActions {
  /** Reload sessions from storage */
  refresh: () => void;
  /** Start a new session and return it */
  startNew: (modelUsed: string | null, deviceUsed: string | null) => TranscriptionSession;
  /** Append segments to an in-progress session */
  append: (sessionId: string, segments: WhisperSegment[]) => void;
  /** Mark a session done with its total duration */
  finalize: (sessionId: string, durationSecs: number) => void;
  /** Rename a session */
  rename: (sessionId: string, title: string | null) => void;
  /** Overwrite the full text of a session (user edits) */
  updateText: (sessionId: string, text: string) => void;
  /** Delete a session */
  remove: (sessionId: string) => void;
  /** Open a session for viewing in the main panel */
  open: (sessionId: string | null) => void;
}

export function useTranscriptionSessions(): [SessionsState, SessionsActions] {
  const [sessions, setSessions] = useState<TranscriptionSession[]>(() =>
    loadSessions()
  );
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setSessions(loadSessions());
  }, []);

  const startNew = useCallback(
    (modelUsed: string | null, deviceUsed: string | null): TranscriptionSession => {
      const session = createSession({ modelUsed, deviceUsed });
      setSessions(loadSessions());
      setViewingSessionId(session.id);
      return session;
    },
    []
  );

  const append = useCallback((sessionId: string, segments: WhisperSegment[]) => {
    appendSegments(sessionId, segments);
    setSessions(loadSessions());
  }, []);

  const finalize = useCallback((sessionId: string, durationSecs: number) => {
    finalizeSession(sessionId, durationSecs);
    setSessions(loadSessions());
  }, []);

  const rename = useCallback((sessionId: string, title: string | null) => {
    renameSession(sessionId, title);
    setSessions(loadSessions());
  }, []);

  const updateText = useCallback((sessionId: string, text: string) => {
    updateSessionText(sessionId, text);
    setSessions(loadSessions());
  }, []);

  const remove = useCallback(
    (sessionId: string) => {
      deleteSession(sessionId);
      const updated = loadSessions();
      setSessions(updated);
      if (viewingSessionId === sessionId) {
        setViewingSessionId(updated[0]?.id ?? null);
      }
    },
    [viewingSessionId]
  );

  const open = useCallback((sessionId: string | null) => {
    setViewingSessionId(sessionId);
  }, []);

  const viewingSession: TranscriptionSession | null =
    viewingSessionId ? (getSession(viewingSessionId) ?? null) : null;

  const state: SessionsState = {
    sessions,
    viewingSessionId,
    viewingSession,
  };

  const actions: SessionsActions = {
    refresh,
    startNew,
    append,
    finalize,
    rename,
    updateText,
    remove,
    open,
  };

  return [state, actions];
}
