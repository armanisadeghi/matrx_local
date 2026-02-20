/**
 * API client for communication with the Python/FastAPI sidecar engine.
 *
 * In development, the Python server runs standalone on a port (default 22140).
 * In production, Tauri spawns it as a managed sidecar process.
 */

const DEFAULT_PORT = 22140;
const DISCOVERY_PORTS = Array.from({ length: 20 }, (_, i) => DEFAULT_PORT + i);

export interface EngineHealth {
  status: string;
  service: string;
}

export interface ToolInfo {
  name: string;
  description?: string;
  category?: string;
}

export interface ToolResult {
  type: "success" | "error";
  output: string;
  metadata?: Record<string, unknown>;
}

export interface BrowserStatus {
  chrome_found: boolean;
  chrome_path: string | null;
  chrome_version: string | null;
  profile_found: boolean;
  browser_running: boolean;
}

export interface ScrapeResultData {
  url: string;
  success: boolean;
  status_code: number;
  content: string;
  title: string;
  content_type: string;
  response_url: string;
  error: string | null;
  elapsed_ms: number;
}

export interface RemoteScrapeResult {
  status: "success" | "error";
  url: string;
  error: string | null;
  status_code: number | null;
  content_type: string | null;
  text_data: string | null;
  from_cache: boolean;
  overview: Record<string, unknown> | null;
  scraped_at: string | null;
}

export interface RemoteScrapeResponse {
  status: string;
  execution_time_ms: number;
  results: RemoteScrapeResult[];
}

export interface EngineSettings {
  headless_scraping: boolean;
  scrape_delay: number;
}

export interface SystemInfo {
  platform: string;
  architecture: string;
  python_version: string;
  hostname: string;
  username: string;
  cwd: string;
  home_dir: string;
}

class EngineAPI {
  private baseUrl: string | null = null;
  private wsUrl: string | null = null;
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (v: ToolResult) => void; reject: (e: Error) => void }
  >();
  private eventListeners = new Map<string, Set<(data: unknown) => void>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private requestIdCounter = 0;
  private _getAccessToken: (() => Promise<string | null>) | null = null;

  /** Register a function that provides the current Supabase JWT. */
  setTokenProvider(fn: () => Promise<string | null>) {
    this._getAccessToken = fn;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (!this._getAccessToken) return {};
    const token = await this._getAccessToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }

  /** Discover the engine port by scanning the known range. */
  async discover(): Promise<string | null> {
    for (const port of DISCOVERY_PORTS) {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/tools/list`, {
          signal: AbortSignal.timeout(500),
        });
        if (resp.ok) {
          this.baseUrl = `http://127.0.0.1:${port}`;
          this.wsUrl = `ws://127.0.0.1:${port}/ws`;
          return this.baseUrl;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  /** Check if the engine is reachable. */
  async isHealthy(): Promise<boolean> {
    if (!this.baseUrl) return false;
    try {
      const resp = await fetch(`${this.baseUrl}/tools/list`, {
        signal: AbortSignal.timeout(2000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /** Get the engine version string from the root endpoint. */
  async getVersion(): Promise<string> {
    if (!this.baseUrl) return "";
    try {
      const resp = await fetch(`${this.baseUrl}/`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.version ?? "";
      }
    } catch { /* non-critical */ }
    return "";
  }

  /** Get engine runtime settings. */
  async getSettings(): Promise<EngineSettings> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/settings`, { headers });
    if (!resp.ok) throw new Error(`Failed to get settings: ${resp.status}`);
    return resp.json();
  }

  /** Update engine runtime settings. */
  async updateSettings(settings: EngineSettings): Promise<EngineSettings> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    const resp = await fetch(`${this.baseUrl}/settings`, {
      method: "PUT",
      headers,
      body: JSON.stringify(settings),
    });
    if (!resp.ok) throw new Error(`Failed to update settings: ${resp.status}`);
    return resp.json();
  }

  /** Get the list of available tools from the engine. */
  async listTools(): Promise<string[]> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/tools/list`, { headers });
    if (!resp.ok) throw new Error(`Failed to list tools: ${resp.status}`);
    const data = await resp.json();
    return data.tools ?? data;
  }

  /** Invoke a tool via REST (stateless, one-shot). */
  async invokeTool(tool: string, input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    const resp = await fetch(`${this.baseUrl}/tools/invoke`, {
      method: "POST",
      headers,
      body: JSON.stringify({ tool, input }),
    });
    if (!resp.ok) throw new Error(`Tool invocation failed: ${resp.status}`);
    return resp.json();
  }

  /** Connect via WebSocket for persistent, stateful sessions. */
  async connectWebSocket(): Promise<void> {
    if (!this.wsUrl) throw new Error("Engine not discovered");

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl!);

      this.ws.onopen = () => {
        this.emit("connected", null);
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // If this is a response to a pending request
          if (data.id && this.pendingRequests.has(data.id)) {
            const pending = this.pendingRequests.get(data.id)!;
            this.pendingRequests.delete(data.id);
            if (data.type === "error") {
              pending.reject(new Error(data.output || data.error));
            } else {
              pending.resolve(data as ToolResult);
            }
          }
          // Emit as a general event
          this.emit("message", data);
        } catch {
          // Non-JSON message
        }
      };

      this.ws.onclose = () => {
        this.emit("disconnected", null);
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        this.emit("error", err);
        reject(new Error("WebSocket connection failed"));
      };
    });
  }

  /** Invoke a tool via WebSocket (stateful, supports concurrent ops). */
  async invokeToolWs(
    tool: string,
    input: Record<string, unknown>
  ): Promise<ToolResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    const id = `req-${++this.requestIdCounter}`;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ id, tool, input }));

      // Timeout after 2 minutes
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error("Tool invocation timed out"));
        }
      }, 120000);
    });
  }

  /** Get system information from the engine. */
  async getSystemInfo(): Promise<SystemInfo> {
    const result = await this.invokeTool("SystemInfo", {});
    if (result.metadata) {
      return {
        platform: String(result.metadata.platform ?? ""),
        architecture: String(result.metadata.architecture ?? ""),
        python_version: String(result.metadata.python_version ?? ""),
        hostname: String(result.metadata.hostname ?? ""),
        username: String(result.metadata.user ?? ""),
        cwd: String(result.metadata.cwd ?? ""),
        home_dir: String(result.metadata.home ?? ""),
      };
    }
    return {
      platform: "", architecture: "", python_version: "",
      hostname: "", username: "", cwd: "", home_dir: "",
    };
  }

  /** Get browser status — returns defaults until a real endpoint is added. */
  async getBrowserStatus(): Promise<BrowserStatus> {
    if (!this.baseUrl) return {
      chrome_found: false, chrome_path: null, chrome_version: null,
      profile_found: false, browser_running: false,
    };
    try {
      const result = await this.invokeTool("SystemInfo", {});
      const meta = result.metadata ?? {};
      return {
        chrome_found: Boolean(meta.playwright_available),
        chrome_path: meta.chrome_path ? String(meta.chrome_path) : null,
        chrome_version: meta.chrome_version ? String(meta.chrome_version) : null,
        profile_found: false,
        browser_running: false,
      };
    } catch {
      return {
        chrome_found: false, chrome_path: null, chrome_version: null,
        profile_found: false, browser_running: false,
      };
    }
  }

  /** Scrape URLs using the engine's multi-strategy scraper. */
  async scrape(
    urls: string[],
    useCache = true
  ): Promise<ToolResult> {
    return this.invokeTool("Scrape", { urls, use_cache: useCache });
  }

  /** Search the web via the engine. */
  async search(keywords: string[], count = 10, country = "us"): Promise<ToolResult> {
    return this.invokeTool("Search", { keywords, count, country });
  }

  /** Deep research via the engine. */
  async research(query: string, effort = "medium", country = "us"): Promise<ToolResult> {
    return this.invokeTool("Research", { query, effort, country });
  }

  // ---- Remote Scraper Server (via /remote-scraper/* proxy) ----

  /** Check if the remote scraper server is available. */
  async remoteScraperStatus(): Promise<{ available: boolean; reason?: string; status?: string }> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const resp = await fetch(`${this.baseUrl}/remote-scraper/status`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Remote scraper status failed: ${resp.status}`);
    return resp.json();
  }

  /** Scrape URLs via the remote scraper server. */
  async scrapeRemotely(
    urls: string[],
    options?: Record<string, unknown>
  ): Promise<RemoteScrapeResponse> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    const resp = await fetch(`${this.baseUrl}/remote-scraper/scrape`, {
      method: "POST",
      headers,
      body: JSON.stringify({ urls, options: options ?? {} }),
    });
    if (!resp.ok) throw new Error(`Remote scrape failed: ${resp.status}`);
    return resp.json();
  }

  // ---- SSE streaming (remote scraper) ----

  /**
   * Open an SSE stream to a remote-scraper proxy endpoint.
   * Calls `onEvent` for each parsed SSE event, `onDone` when stream ends.
   * Returns an AbortController the caller can use to cancel the stream.
   */
  async streamSSE(
    path: string,
    payload: Record<string, unknown>,
    onEvent: (event: string, data: unknown) => void,
    onDone?: () => void,
    onError?: (err: Error) => void,
  ): Promise<AbortController> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const controller = new AbortController();
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };

    const run = async () => {
      try {
        const resp = await fetch(`${this.baseUrl}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!resp.ok) throw new Error(`SSE stream failed: ${resp.status}`);
        const reader = resp.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = "message";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              currentEvent = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              const raw = line.slice(5).trim();
              try {
                const parsed = JSON.parse(raw);
                onEvent(currentEvent, parsed);
              } catch {
                onEvent(currentEvent, raw);
              }
              currentEvent = "message";
            }
            // Ignore empty lines and comments
          }
        }
        onDone?.();
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    };

    run();
    return controller;
  }

  /** Stream scrape results via SSE. */
  scrapeRemotelyStream(
    urls: string[],
    options: Record<string, unknown> | undefined,
    onEvent: (event: string, data: unknown) => void,
    onDone?: () => void,
    onError?: (err: Error) => void,
  ): Promise<AbortController> {
    return this.streamSSE(
      "/remote-scraper/scrape/stream",
      { urls, options: options ?? {} },
      onEvent, onDone, onError,
    );
  }

  /** Subscribe to engine events. */
  on(event: string, callback: (data: unknown) => void): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
    return () => this.eventListeners.get(event)?.delete(callback);
  }

  private emit(event: string, data: unknown) {
    this.eventListeners.get(event)?.forEach((cb) => cb(data));
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connectWebSocket();
      } catch {
        this.scheduleReconnect();
      }
    }, 3000);
  }

  /** Disconnect and clean up. */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.pendingRequests.clear();
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get engineUrl(): string | null {
    return this.baseUrl;
  }

  // ---- Documents API ----

  private async docRequest<T>(
    method: string,
    path: string,
    body?: unknown,
    userId?: string,
  ): Promise<T> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(await this.authHeaders()),
    };
    if (userId) headers["X-User-Id"] = userId;

    const resp = await fetch(`${this.baseUrl}/documents${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Documents API error (${resp.status}): ${text}`);
    }
    return resp.json();
  }

  /** Get folder tree with note counts. */
  async getDocTree(userId: string): Promise<DocTree> {
    return this.docRequest("GET", "/tree", undefined, userId);
  }

  /** List notes, optionally filtered by folder or search. */
  async listNotes(
    userId: string,
    opts?: { folder_id?: string; search?: string },
  ): Promise<DocNote[]> {
    const params = new URLSearchParams();
    if (opts?.folder_id) params.set("folder_id", opts.folder_id);
    if (opts?.search) params.set("search", opts.search);
    const qs = params.toString();
    return this.docRequest("GET", `/notes${qs ? `?${qs}` : ""}`, undefined, userId);
  }

  /** Get a single note with full content. */
  async getNote(noteId: string, userId: string): Promise<DocNote> {
    return this.docRequest("GET", `/notes/${noteId}`, undefined, userId);
  }

  /** Create a new note. */
  async createNote(userId: string, data: CreateNoteData): Promise<DocNote> {
    return this.docRequest("POST", "/notes", data, userId);
  }

  /** Update a note. */
  async updateNote(
    noteId: string,
    userId: string,
    data: Partial<CreateNoteData>,
  ): Promise<DocNote> {
    return this.docRequest("PUT", `/notes/${noteId}`, data, userId);
  }

  /** Delete a note (soft delete). */
  async deleteNote(noteId: string, userId: string): Promise<void> {
    await this.docRequest("DELETE", `/notes/${noteId}`, undefined, userId);
  }

  /** Create a folder. */
  async createFolder(
    userId: string,
    data: { name: string; parent_id?: string },
  ): Promise<DocFolder> {
    return this.docRequest("POST", "/folders", data, userId);
  }

  /** Update a folder. */
  async updateFolder(
    folderId: string,
    userId: string,
    data: Partial<{ name: string; parent_id: string; path: string; position: number }>,
  ): Promise<DocFolder> {
    return this.docRequest("PUT", `/folders/${folderId}`, data, userId);
  }

  /** Delete a folder (soft delete). */
  async deleteFolder(folderId: string, userId: string): Promise<void> {
    await this.docRequest("DELETE", `/folders/${folderId}`, undefined, userId);
  }

  /** Get version history for a note. */
  async listVersions(noteId: string, userId: string): Promise<DocVersion[]> {
    return this.docRequest("GET", `/notes/${noteId}/versions`, undefined, userId);
  }

  /** Revert a note to a specific version. */
  async revertNote(
    noteId: string,
    userId: string,
    versionNumber: number,
  ): Promise<DocNote> {
    return this.docRequest(
      "POST",
      `/notes/${noteId}/revert`,
      { version_number: versionNumber },
      userId,
    );
  }

  /** Get sync status. */
  async getSyncStatus(userId: string): Promise<SyncStatus> {
    return this.docRequest("GET", "/sync/status", undefined, userId);
  }

  /** Trigger a full sync. */
  async triggerSync(userId: string): Promise<SyncResult> {
    return this.docRequest("POST", "/sync/trigger", undefined, userId);
  }

  /** Pull incremental changes. */
  async pullChanges(userId: string): Promise<SyncResult> {
    return this.docRequest("POST", "/sync/pull", undefined, userId);
  }

  /** Pull a single note (after Realtime notification). */
  async pullNote(noteId: string, userId: string): Promise<DocNote> {
    return this.docRequest("POST", "/sync/pull-note", { note_id: noteId }, userId);
  }

  /** Register this device for sync. */
  async registerDevice(userId: string): Promise<unknown> {
    return this.docRequest("POST", "/sync/register-device", undefined, userId);
  }

  /** Start the file watcher. */
  async startDocWatcher(userId: string): Promise<void> {
    await this.docRequest("POST", "/sync/start-watcher", undefined, userId);
  }

  /** Stop the file watcher. */
  async stopDocWatcher(userId: string): Promise<void> {
    await this.docRequest("POST", "/sync/stop-watcher", undefined, userId);
  }

  /** List conflicts. */
  async listConflicts(userId: string): Promise<{ conflicts: string[]; count: number }> {
    return this.docRequest("GET", "/conflicts", undefined, userId);
  }

  /** Resolve a conflict. */
  async resolveConflict(
    noteId: string,
    userId: string,
    resolution: "keep_local" | "keep_remote" | "keep_both",
  ): Promise<void> {
    await this.docRequest(
      "POST",
      `/conflicts/${noteId}/resolve`,
      { resolution },
      userId,
    );
  }

  /** List shares. */
  async listShares(userId: string): Promise<DocShare[]> {
    return this.docRequest("GET", "/shares", undefined, userId);
  }

  /** Create a share. */
  async createShare(
    userId: string,
    data: CreateShareData,
  ): Promise<DocShare> {
    return this.docRequest("POST", "/shares", data, userId);
  }

  /** Update a share. */
  async updateShare(
    shareId: string,
    userId: string,
    data: { permission?: string; is_public?: boolean },
  ): Promise<DocShare> {
    return this.docRequest("PUT", `/shares/${shareId}`, data, userId);
  }

  /** Delete a share. */
  async deleteShare(shareId: string, userId: string): Promise<void> {
    await this.docRequest("DELETE", `/shares/${shareId}`, undefined, userId);
  }

  /** List directory mappings. */
  async listMappings(userId: string): Promise<DocMappings> {
    return this.docRequest("GET", "/mappings", undefined, userId);
  }

  /** Create a directory mapping. */
  async createMapping(
    userId: string,
    data: { folder_id: string; local_path: string },
  ): Promise<unknown> {
    return this.docRequest("POST", "/mappings", data, userId);
  }

  /** Delete a directory mapping. */
  async deleteMapping(
    mappingId: string,
    userId: string,
    folderId?: string,
    localPath?: string,
  ): Promise<void> {
    const params = new URLSearchParams();
    if (folderId) params.set("folder_id", folderId);
    if (localPath) params.set("local_path", localPath);
    const qs = params.toString();
    await this.docRequest(
      "DELETE",
      `/mappings/${mappingId}${qs ? `?${qs}` : ""}`,
      undefined,
      userId,
    );
  }
}

// ---- Document types ----

export interface DocFolder {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  path: string;
  position: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  note_count?: number;
  children?: DocFolder[];
}

export interface DocTree {
  folders: DocFolder[];
  total_notes: number;
  unfiled_notes: number;
}

export interface DocNote {
  id: string;
  user_id?: string;
  label: string;
  content?: string;
  folder_name: string;
  folder_id: string | null;
  tags: string[];
  file_path: string | null;
  content_hash: string | null;
  sync_version: number;
  position: number;
  is_deleted: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateNoteData {
  label: string;
  content: string;
  folder_name?: string;
  folder_id?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface DocVersion {
  id: string;
  note_id: string;
  user_id: string;
  content: string;
  label: string;
  version_number: number;
  change_source: string;
  change_type: string | null;
  diff_metadata: Record<string, unknown>;
  created_at: string;
}

export interface DocShare {
  id: string;
  note_id: string | null;
  folder_id: string | null;
  owner_id: string;
  shared_with_id: string | null;
  permission: string;
  is_public: boolean;
  public_token: string | null;
  created_at: string;
  updated_at: string;
  _direction?: "owned" | "shared_with_me";
}

export interface CreateShareData {
  note_id?: string;
  folder_id?: string;
  shared_with_id?: string;
  permission?: string;
  is_public?: boolean;
}

export interface SyncStatus {
  configured: boolean;
  device_id: string;
  last_sync_version: number;
  last_full_sync: number | null;
  tracked_files: number;
  conflicts: string[];
  conflict_count: number;
  watcher_active: boolean;
  base_dir: string;
}

export interface SyncResult {
  pushed?: number;
  pulled?: number;
  conflicts?: number;
  unchanged?: number;
  error?: string;
}

export interface DocMappings {
  cloud_mappings: Array<{
    id: string;
    folder_id: string;
    local_path: string;
    device_id: string;
  }>;
  local_mappings: Record<string, string[]>;
  device_id: string;
}

// Singleton instance
export const engine = new EngineAPI();
