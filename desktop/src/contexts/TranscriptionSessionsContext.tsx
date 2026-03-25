/**
 * TranscriptionSessionsContext — shares transcription session persistence
 * across the app so that QuickTranscriptModal, background recording, and
 * Voice.tsx all write to the same session store (localStorage).
 */

import { createContext, useContext } from "react";
import { useTranscriptionSessions, type SessionsState, type SessionsActions } from "@/hooks/use-transcription-sessions";

interface TranscriptionSessionsCtxValue {
  state: SessionsState;
  actions: SessionsActions;
}

const defaultState: SessionsState = {
  sessions: [],
  viewingSessionId: null,
  viewingSession: null,
};

const noopSession = { id: "", title: null, createdAt: "", updatedAt: "", durationSecs: 0, charCount: 0, modelUsed: null, deviceUsed: null, segments: [], fullText: "" } as never;

const defaultActions: SessionsActions = {
  refresh: () => {},
  startNew: () => noopSession,
  append: () => {},
  finalize: () => {},
  rename: () => {},
  updateText: () => {},
  applyPolish: () => {},
  remove: () => {},
  open: () => {},
};

const Ctx = createContext<TranscriptionSessionsCtxValue>({
  state: defaultState,
  actions: defaultActions,
});

export function TranscriptionSessionsProvider({ children }: { children: React.ReactNode }) {
  const [state, actions] = useTranscriptionSessions();
  return (
    <Ctx.Provider value={{ state, actions }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSessionsContext(): TranscriptionSessionsCtxValue {
  return useContext(Ctx);
}
