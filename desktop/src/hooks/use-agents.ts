import { useState, useEffect, useCallback, useRef } from "react";
import supabase from "@/lib/supabase";
import type { AgentInfo, AgentsResponse, PromptVariable } from "@/types/agents";

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

// ---------------------------------------------------------------------------
// Supabase direct fetch — fills in user prompts + shared prompts using the
// session JWT so the engine doesn't need to be authenticated per-user.
// ---------------------------------------------------------------------------

interface RawPromptRow {
  id: string;
  name: string;
  description: string | null;
  variable_defaults: PromptVariable[] | null;
  model_id?: string | null;
  temperature?: number | null;
  max_tokens?: number | null;
  is_active?: boolean;
}

function shapeFromRow(row: RawPromptRow, source: AgentInfo["source"]): AgentInfo {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    source,
    variable_defaults: row.variable_defaults ?? [],
    settings: {
      model_id: row.model_id ?? null,
      temperature: row.temperature ?? null,
      max_tokens: row.max_tokens ?? null,
      stream: true,
      tools: [],
    },
  };
}

async function fetchUserPromptsFromSupabase(): Promise<{
  user: AgentInfo[];
  shared: AgentInfo[];
}> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return { user: [], shared: [] };

  const userId = session.user.id;

  const [ownResult, sharedResult] = await Promise.allSettled([
    supabase
      .from("prompts")
      .select("id, name, description, variable_defaults, model_id, temperature, max_tokens")
      .eq("user_id", userId)
      .order("name", { ascending: true }),

    supabase
      .from("prompt_permissions")
      .select("prompt_id, prompts(id, name, description, variable_defaults, model_id, temperature, max_tokens)")
      .eq("user_id", userId)
      .in("permission", ["read", "comment", "edit", "admin"]),
  ]);

  const user: AgentInfo[] = [];
  const shared: AgentInfo[] = [];

  if (ownResult.status === "fulfilled" && !ownResult.value.error && ownResult.value.data) {
    for (const row of ownResult.value.data as RawPromptRow[]) {
      user.push(shapeFromRow(row, "user"));
    }
  }

  if (sharedResult.status === "fulfilled" && !sharedResult.value.error && sharedResult.value.data) {
    for (const row of (sharedResult.value.data as unknown as { prompt_id: string; prompts: RawPromptRow | null }[])) {
      if (row.prompts) {
        shared.push(shapeFromRow(row.prompts, "shared"));
      }
    }
  }

  return { user, shared };
}

// ---------------------------------------------------------------------------

export function useAgents({ engineUrl }: UseAgentsOptions): UseAgentsState {
  const [builtins, setBuiltins] = useState<AgentInfo[]>([]);
  const [userAgents, setUserAgents] = useState<AgentInfo[]>([]);
  const [sharedAgents, setSharedAgents] = useState<AgentInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<AgentsResponse["source"] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const applyResponse = useCallback((data: AgentsResponse, directUser?: AgentInfo[], directShared?: AgentInfo[]) => {
    setBuiltins(data.builtins);

    // Merge engine user agents with direct Supabase user agents (dedupe by id)
    const mergedUser = directUser
      ? mergeById(data.user, directUser)
      : data.user;
    setUserAgents(mergedUser);

    const mergedShared = directShared
      ? mergeById(data.shared, directShared)
      : data.shared;
    setSharedAgents(mergedShared);

    setSource(data.source);
    setError(null);
  }, []);

  const load = useCallback(
    async (force = false) => {
      if (!engineUrl) return;

      const cached = cache.get(engineUrl);
      if (!force && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        // Still fetch Supabase user prompts in the background so shared agents
        // are populated even from cache.
        const { user, shared } = await fetchUserPromptsFromSupabase().catch(() => ({ user: [], shared: [] }));
        applyResponse(cached.data, user, shared);
        return;
      }

      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setIsLoading(true);
      setError(null);

      try {
        // Fetch session token to authenticate engine requests.
        // Fall back to the local API key so agents load even before login.
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? import.meta.env.VITE_ENGINE_API_KEY ?? "";
        const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

        const [engineResult, supabaseResult] = await Promise.allSettled([
          fetch(`${engineUrl}/chat/agents`, {
            signal: abort.signal,
            headers: authHeader,
          }).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json() as Promise<AgentsResponse>;
          }),
          fetchUserPromptsFromSupabase(),
        ]);

        if (engineResult.status === "rejected") {
          if ((engineResult.reason as Error).name === "AbortError") return;
          throw engineResult.reason;
        }

        const data = engineResult.value;
        cache.set(engineUrl, { data, ts: Date.now() });

        const { user: directUser, shared: directShared } =
          supabaseResult.status === "fulfilled" ? supabaseResult.value : { user: [], shared: [] };

        applyResponse(data, directUser, directShared);
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message || "Failed to load agents");
      } finally {
        setIsLoading(false);
      }
    },
    [engineUrl, applyResponse]
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeById(primary: AgentInfo[], secondary: AgentInfo[]): AgentInfo[] {
  const seen = new Set(primary.map((a) => a.id));
  const extras = secondary.filter((a) => !seen.has(a.id));
  return [...primary, ...extras];
}
