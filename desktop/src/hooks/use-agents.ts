import { useState, useEffect, useCallback, useRef } from "react";
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
  source: AgentsResponse["source"] | null;
  refresh: () => void;
}

/** Cache keyed by engineUrl so we don't re-fetch on every component mount. */
const cache = new Map<string, { data: AgentsResponse; ts: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

export function useAgents({ engineUrl }: UseAgentsOptions): UseAgentsState {
  const [builtins, setBuiltins] = useState<AgentInfo[]>([]);
  const [userAgents, setUserAgents] = useState<AgentInfo[]>([]);
  const [sharedAgents, setSharedAgents] = useState<AgentInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<AgentsResponse["source"] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const applyResponse = (data: AgentsResponse) => {
    setBuiltins(data.builtins);
    setUserAgents(data.user);
    setSharedAgents(data.shared);
    setSource(data.source);
    setError(null);
  };

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
        const data: AgentsResponse = await resp.json();
        cache.set(engineUrl, { data, ts: Date.now() });
        applyResponse(data);
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message || "Failed to load agents");
      } finally {
        setIsLoading(false);
      }
    },
    [engineUrl]
  );

  useEffect(() => {
    load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  const all = [...builtins, ...userAgents, ...sharedAgents];

  return {
    builtins,
    userAgents,
    sharedAgents,
    all,
    isLoading,
    error,
    source,
    refresh: () => load(true),
  };
}
