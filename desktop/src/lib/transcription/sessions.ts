/**
 * Transcription session persistence — localStorage-backed CRUD.
 *
 * Sessions are stored as a JSON array under STORAGE_KEY, sorted newest-first.
 * Audio files are currently kept in-memory only; future work can write them to
 * the filesystem via Tauri fs plugin.
 */

import type { TranscriptionSession, WhisperSegment } from "./types";

const STORAGE_KEY = "matrx-transcription-sessions";
const MAX_SESSIONS = 500;

function generateId(): string {
  return `ts_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function loadSessions(): TranscriptionSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TranscriptionSession[];
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    // Corrupted storage
  }
  return [];
}

function saveSessions(sessions: TranscriptionSession[]): void {
  // Keep only the most recent MAX_SESSIONS to bound storage size
  const trimmed = sessions.slice(0, MAX_SESSIONS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

/** Create a new empty session and persist it. Returns the new session. */
export function createSession(opts: {
  modelUsed: string | null;
  deviceUsed: string | null;
}): TranscriptionSession {
  const now = new Date().toISOString();
  const session: TranscriptionSession = {
    id: generateId(),
    title: null,
    createdAt: now,
    updatedAt: now,
    durationSecs: 0,
    charCount: 0,
    modelUsed: opts.modelUsed,
    deviceUsed: opts.deviceUsed,
    segments: [],
    fullText: "",
  };
  const sessions = loadSessions();
  sessions.unshift(session);
  saveSessions(sessions);
  return session;
}

/** Append new segments to an existing session. */
export function appendSegments(
  sessionId: string,
  newSegments: WhisperSegment[],
): TranscriptionSession | null {
  const sessions = loadSessions();
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return null;

  const session = sessions[idx];
  session.segments = [...session.segments, ...newSegments];
  session.fullText = session.segments
    .map((s) => s.text)
    .filter((t) => t.length > 0)
    .join(" ");
  session.charCount = session.fullText.length;
  session.updatedAt = new Date().toISOString();

  sessions[idx] = session;
  saveSessions(sessions);
  return session;
}

/** Mark a session as finished with its final duration. */
export function finalizeSession(
  sessionId: string,
  durationSecs: number,
): TranscriptionSession | null {
  const sessions = loadSessions();
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return null;

  sessions[idx].durationSecs = durationSecs;
  sessions[idx].updatedAt = new Date().toISOString();
  saveSessions(sessions);
  return sessions[idx];
}

/** Update just the title of a session. */
export function renameSession(
  sessionId: string,
  title: string | null,
): TranscriptionSession | null {
  const sessions = loadSessions();
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return null;

  sessions[idx].title = title;
  sessions[idx].updatedAt = new Date().toISOString();
  saveSessions(sessions);
  return sessions[idx];
}

/** Overwrite the fullText of a session (user-edited content) and recount chars. */
export function updateSessionText(
  sessionId: string,
  newText: string,
): TranscriptionSession | null {
  const sessions = loadSessions();
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return null;

  sessions[idx].fullText = newText;
  sessions[idx].charCount = newText.length;
  sessions[idx].updatedAt = new Date().toISOString();
  saveSessions(sessions);
  return sessions[idx];
}

/** Delete a session by ID. */
export function deleteSession(sessionId: string): void {
  const sessions = loadSessions();
  saveSessions(sessions.filter((s) => s.id !== sessionId));
}

/** Load a single session by ID. */
export function getSession(sessionId: string): TranscriptionSession | null {
  const sessions = loadSessions();
  return sessions.find((s) => s.id === sessionId) ?? null;
}
