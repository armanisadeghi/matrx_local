/**
 * AIDream server API client.
 *
 * All reads of shared data (models, prompts, tools) go through this client.
 * The active server URL is read from VITE_AIDREAM_SERVER_URL_LIVE — never hardcoded.
 *
 * URL selection:
 *   - Active URL: import.meta.env.VITE_AIDREAM_SERVER_URL_LIVE
 *   - All available URLs (for debug picker): getAllAIDreamUrls()
 *
 * Auth:
 *   - Public endpoints (models, builtins, tools): no token needed
 *   - Authenticated endpoints (user prompts): pass Supabase JWT as Bearer token
 */

// ---------------------------------------------------------------------------
// URL configuration — reads all VITE_AIDREAM_SERVER_URL_* env vars dynamically
// ---------------------------------------------------------------------------

/** The active AIDream server base URL. Never fallback to a hardcoded value. */
export const AIDREAM_SERVER_URL: string = import.meta.env.VITE_AIDREAM_SERVER_URL_LIVE ?? "";

/**
 * Returns all configured AIDream server variants as { label, url } pairs.
 * Used for the debug server-picker dropdown.
 * Suffix is derived from the env var name (e.g. LIVE, DEV, LOCAL, PRODUCTION).
 */
export function getAllAIDreamUrls(): Array<{ label: string; url: string }> {
  const prefix = "VITE_AIDREAM_SERVER_URL_";
  return Object.entries(import.meta.env)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, value]) => ({
      label: key.replace(prefix, ""),
      url: String(value),
    }))
    .filter(({ url }) => Boolean(url))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

interface RequestOptions {
  jwt?: string | null;
  signal?: AbortSignal;
}

async function aidreamGet<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  if (!AIDREAM_SERVER_URL) {
    throw new Error(
      "[aidream-client] VITE_AIDREAM_SERVER_URL_LIVE is not set. " +
        "Add it to desktop/.env to enable AIDream server sync.",
    );
  }

  const url = `${AIDREAM_SERVER_URL}/api${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.jwt) {
    headers["Authorization"] = `Bearer ${options.jwt}`;
  }

  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(
      `[aidream-client] ${path} → HTTP ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Typed response shapes
// ---------------------------------------------------------------------------

export interface AIDreamModel {
  id: string;
  name: string;
  common_name?: string;
  provider?: string;
  endpoints?: string[];
  capabilities?: string[];
  context_window?: number | null;
  max_tokens?: number | null;
  is_primary?: boolean;
  is_premium?: boolean;
  is_deprecated?: boolean;
}

export interface AIDreamModelsResponse {
  models: AIDreamModel[];
  count: number;
}

export interface AIDreamPrompt {
  id: string;
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  variable_defaults?: unknown[];
  model_id?: string | null;
  temperature?: number | null;
  max_tokens?: number | null;
  is_favorite?: boolean;
  settings?: Record<string, unknown>;
}

export interface AIDreamPromptsResponse {
  prompts: AIDreamPrompt[];
  count: number;
}

export interface AIDreamBuiltinsResponse {
  builtins: AIDreamPrompt[];
  count: number;
}

export interface AIDreamAllPromptsResponse {
  prompts: AIDreamPrompt[];
  builtins: AIDreamPrompt[];
  total_count: number;
}

export interface AIDreamTool {
  id: string;
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  parameters?: Record<string, unknown>;
  source_app?: string;
}

export interface AIDreamToolsResponse {
  tools: AIDreamTool[];
  count: number;
  source_app?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch all AI models. Public — no auth needed.
 * Corresponds to GET /api/ai-models
 */
export async function fetchAIDreamModels(
  opts: RequestOptions = {},
): Promise<AIDreamModelsResponse> {
  return aidreamGet<AIDreamModelsResponse>("/ai-models", opts);
}

/**
 * Fetch all prompt builtins. Public — no auth needed.
 * Corresponds to GET /api/prompts/builtins
 */
export async function fetchAIDreamBuiltins(
  opts: RequestOptions = {},
): Promise<AIDreamBuiltinsResponse> {
  return aidreamGet<AIDreamBuiltinsResponse>("/prompts/builtins", opts);
}

/**
 * Fetch the authenticated user's prompts. Requires JWT.
 * Corresponds to GET /api/prompts
 */
export async function fetchAIDreamUserPrompts(
  jwt: string,
  opts: RequestOptions = {},
): Promise<AIDreamPromptsResponse> {
  return aidreamGet<AIDreamPromptsResponse>("/prompts", { ...opts, jwt });
}

/**
 * Fetch user prompts AND builtins in one call. Requires JWT.
 * Corresponds to GET /api/prompts/all
 */
export async function fetchAIDreamAllPrompts(
  jwt: string,
  opts: RequestOptions = {},
): Promise<AIDreamAllPromptsResponse> {
  return aidreamGet<AIDreamAllPromptsResponse>("/prompts/all", { ...opts, jwt });
}

/**
 * Fetch all registered tools. Public — no auth needed.
 * Corresponds to GET /api/ai-tools
 */
export async function fetchAIDreamTools(
  opts: RequestOptions = {},
): Promise<AIDreamToolsResponse> {
  return aidreamGet<AIDreamToolsResponse>("/ai-tools", opts);
}

/**
 * Fetch tools for a specific source app. Public — no auth needed.
 * Corresponds to GET /api/ai-tools/app/{source_app}/all
 */
export async function fetchAIDreamToolsForApp(
  sourceApp: string,
  opts: RequestOptions = {},
): Promise<AIDreamToolsResponse> {
  return aidreamGet<AIDreamToolsResponse>(`/ai-tools/app/${sourceApp}/all`, opts);
}
