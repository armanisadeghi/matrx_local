/**
 * Agents hook — reads all agent/prompt data from the local Python engine.
 *
 * Data flow:
 *   React → GET /chat/agents → Python engine → SQLite
 *
 * The engine's SyncEngine populates SQLite from the AIDream server API in the
 * background.  This hook never touches Supabase directly for data — only the
 * engine API is used.
 *
 * If the engine returns syncing=true (SQLite never synced), the hook exposes
 * isLoading=true so the UI can show a spinner.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { AgentInfo, AgentsResponse } from "@/types/agents";

interface UseAgentsOptions {
  engineUrl: string | null;
}

interface UseAgentsState {
  builtins: AgentInfo[];
  userAgents: AgentInfo[];
  sharedAgents: AgentInfo[];
  all: AgentInfo[];
  isLoading: boolean;
  error: string | null;
  syncing: boolean;
  source: AgentsResponse["source"] | null;
  refresh: () => void;
}

/** In-memory cache keyed by engineUrl to avoid re-fetching on every mount. */
const cache = new Map<string, { data: AgentsResponse; ts: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

export function useAgents({ engineUrl }: UseAgentsOptions): UseAgentsState {
  const [builtins, setBuiltins] = useState<AgentInfo[]>([]);
  const [userAgents, setUserAgents] = useState<AgentInfo[]>([]);
  const [sharedAgents] = useState<AgentInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<AgentsResponse["source"] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Re-poll after a short delay when the engine reports it's still syncing.
  const syncRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyResponse = useCallback((data: AgentsResponse) => {
    setBuiltins(data.builtins);
    setUserAgents(data.user);
    setSource(data.source);
    setSyncing((data as unknown as Record<string, unknown>).syncing === true);
    setError(null);
  }, []);

  const load = useCallback(
    async (force = false) => {
      if (!engineUrl) return;

      const cached = cache.get(engineUrl);
      if (!force && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        applyResponse(cached.data);
        return;
      }

      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setIsLoading(true);
      setError(null);

      try {
        const resp = await fetch(`${engineUrl}/chat/agents`, {
          signal: abort.signal,
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const data = (await resp.json()) as AgentsResponse & { syncing?: boolean };
        cache.set(engineUrl, { data, ts: Date.now() });
        applyResponse(data);

        // If the engine is still syncing (SQLite empty, first run), retry in 3s
        if (data.syncing) {
          syncRetryRef.current = setTimeout(() => load(true), 3_000);
        }
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message || "Failed to load agents");
      } finally {
        setIsLoading(false);
      }
    },
    [engineUrl, applyResponse],
  );

  useEffect(() => {
    load();
    return () => {
      abortRef.current?.abort();
      if (syncRetryRef.current) clearTimeout(syncRetryRef.current);
    };
  }, [load]);

  const all = useMemo(
    () => [...builtins, ...userAgents, ...sharedAgents],
    [builtins, userAgents, sharedAgents],
  );

  const refresh = useCallback(() => load(true), [load]);

  return useMemo(
    () => ({
      builtins,
      userAgents,
      sharedAgents,
      all,
      isLoading,
      error,
      syncing,
      source,
      refresh,
    }),
    [builtins, userAgents, sharedAgents, all, isLoading, error, syncing, source, refresh],
  );
}
