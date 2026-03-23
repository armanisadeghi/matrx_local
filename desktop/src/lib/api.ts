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

/** A configurable storage path entry from GET /settings/paths */
export interface StoragePath {
  name: string;       // e.g. "notes"
  label: string;      // e.g. "Notes folder"
  current: string;    // resolved absolute path
  default: string;    // compiled default path
  is_custom: boolean; // true if user has set a custom path
  user_visible: boolean; // whether to show in Settings UI
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

/**
 * Thrown by invokeToolGuarded() when a required macOS permission is not granted.
 * The UI layer catches this and shows the PermissionsModal or PermissionDeniedBanner.
 */
export class PermissionRequiredError extends Error {
  constructor(
    public readonly permissionKey: string,
    public readonly permissionLabel: string,
    public readonly permissionDescription: string,
    public readonly tool: string,
  ) {
    super(
      `"${tool}" requires ${permissionLabel} access. ` +
        `Go to System Settings → Privacy & Security to grant it.`,
    );
    this.name = "PermissionRequiredError";
  }
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

  /**
   * Discover the engine port by scanning the known range.
   *
   * Accepts an optional `knownUrl` that bypasses the port scan — used when
   * the Rust layer has already identified the port (e.g. via `discover_engine_port`
   * which bypasses Windows WebView2 loopback network isolation).
   */
  async discover(knownUrl?: string): Promise<string | null> {
    if (knownUrl) {
      this.baseUrl = knownUrl;
      this.wsUrl = knownUrl.replace("http://", "ws://") + "/ws";
      return knownUrl;
    }

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

  // ── Storage path management ────────────────────────────────────────────

  /** List all configurable storage paths with their current resolved values. */
  async getStoragePaths(): Promise<StoragePath[]> {
    return this.request<StoragePath[]>("/settings/paths");
  }

  /** Set a custom path for a named storage location. */
  async setStoragePath(name: string, path: string): Promise<StoragePath> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    const resp = await fetch(`${this.baseUrl}/settings/paths/${name}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ path }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Failed to set path: ${text}`);
    }
    return resp.json();
  }

  /** Reset a storage path to its compiled default. */
  async resetStoragePath(name: string): Promise<StoragePath> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/settings/paths/${name}`, {
      method: "DELETE",
      headers,
    });
    if (!resp.ok) throw new Error(`Failed to reset path: ${resp.status}`);
    return resp.json();
  }

  // ── AI provider status ─────────────────────────────────────────────────

  /** Check which AI providers are configured (have API keys) on the engine. */
  async getAiStatus(): Promise<{
    providers: { available: string[]; missing: string[]; any_available: boolean };
    jwt_validation: { configured: boolean; warning: string | null };
    engine: { initialized: boolean; client_mode: boolean };
  }> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const resp = await fetch(`${this.baseUrl}/chat/ai-status`);
    if (!resp.ok) throw new Error(`Failed to get AI status: ${resp.status}`);
    return resp.json();
  }

  // ── Wake word settings (SQLite-persisted) ──────────────────────────────

  /** Fetch the user's wake word engine preference from the sidecar SQLite store. */
  async getWakeWordSettings(): Promise<import("./transcription/types").WakeWordSettings> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/settings/wake-word`, { headers });
    if (!resp.ok) throw new Error(`Failed to get wake word settings: ${resp.status}`);
    const raw = await resp.json();
    // Convert snake_case → camelCase
    return {
      engine: raw.engine,
      owwModel: raw.oww_model,
      owwThreshold: raw.oww_threshold,
      customKeyword: raw.custom_keyword,
    };
  }

  /** Persist the user's wake word engine preference to the sidecar SQLite store. */
  async saveWakeWordSettings(
    settings: import("./transcription/types").WakeWordSettings,
  ): Promise<void> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    // Convert camelCase → snake_case for the Python API
    const body = {
      engine: settings.engine,
      oww_model: settings.owwModel,
      oww_threshold: settings.owwThreshold,
      custom_keyword: settings.customKeyword,
    };
    const resp = await fetch(`${this.baseUrl}/settings/wake-word`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Failed to save wake word settings: ${resp.status}`);
  }

  // ── openWakeWord engine control ──────────────────────────────────────────

  /** Get OWW engine runtime status. */
  async owwStatus(): Promise<import("./transcription/types").OwwStatus> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/wake-word/status`, { headers });
    if (!resp.ok) throw new Error(`OWW status failed: ${resp.status}`);
    return resp.json();
  }

  /** Start the OWW detection loop. */
  async owwStart(opts?: {
    modelName?: string;
    threshold?: number;
    deviceName?: string;
  }): Promise<void> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    const resp = await fetch(`${this.baseUrl}/wake-word/start`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model_name: opts?.modelName ?? null,
        threshold: opts?.threshold ?? null,
        device_name: opts?.deviceName ?? null,
      }),
    });
    if (!resp.ok) throw new Error(`OWW start failed: ${resp.status} ${await resp.text()}`);
  }

  /** Stop the OWW detection loop entirely. */
  async owwStop(): Promise<void> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const resp = await fetch(`${this.baseUrl}/wake-word/stop`, {
      method: "POST",
      headers: await this.authHeaders(),
    });
    if (!resp.ok) throw new Error(`OWW stop failed: ${resp.status}`);
  }

  /** Mute OWW (keeps thread alive). */
  async owwMute(): Promise<void> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const resp = await fetch(`${this.baseUrl}/wake-word/mute`, {
      method: "POST",
      headers: await this.authHeaders(),
    });
    if (!resp.ok) throw new Error(`OWW mute failed: ${resp.status}`);
  }

  /** Unmute OWW. */
  async owwUnmute(): Promise<void> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const resp = await fetch(`${this.baseUrl}/wake-word/unmute`, {
      method: "POST",
      headers: await this.authHeaders(),
    });
    if (!resp.ok) throw new Error(`OWW unmute failed: ${resp.status}`);
  }

  /** Dismiss OWW (10-second false-trigger cooldown). */
  async owwDismiss(): Promise<void> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const resp = await fetch(`${this.baseUrl}/wake-word/dismiss`, {
      method: "POST",
      headers: await this.authHeaders(),
    });
    if (!resp.ok) throw new Error(`OWW dismiss failed: ${resp.status}`);
  }

  /** Manually fire a wake-word-detected event (for testing). */
  async owwTrigger(): Promise<void> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const resp = await fetch(`${this.baseUrl}/wake-word/trigger`, {
      method: "POST",
      headers: await this.authHeaders(),
    });
    if (!resp.ok) throw new Error(`OWW trigger failed: ${resp.status}`);
  }

  /** Configure OWW model / threshold at runtime. */
  async owwConfigure(opts: {
    modelName?: string;
    threshold?: number;
  }): Promise<void> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    const resp = await fetch(`${this.baseUrl}/wake-word/configure`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model_name: opts.modelName ?? null,
        threshold: opts.threshold ?? null,
      }),
    });
    if (!resp.ok) throw new Error(`OWW configure failed: ${resp.status}`);
  }

  /** List all available OWW models (pre-trained + custom). */
  async owwListModels(): Promise<import("./transcription/types").OwwModelsResponse> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/wake-word/models`, { headers });
    if (!resp.ok) throw new Error(`OWW list models failed: ${resp.status}`);
    return resp.json();
  }

  /** Download a pre-trained OWW model (returns when download completes). */
  async owwDownloadModel(
    name: string,
  ): Promise<import("./transcription/types").OwwModelInfo> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    const resp = await fetch(`${this.baseUrl}/wake-word/models/download`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model_name: name }),
    });
    if (!resp.ok) throw new Error(`OWW download failed: ${resp.status} ${await resp.text()}`);
    return resp.json();
  }

  /**
   * Open an EventSource SSE stream to the OWW detection service.
   * The caller is responsible for closing it (eventSource.close()).
   * The base URL must be discovered before calling this.
   */
  owwStream(): EventSource {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    return new EventSource(`${this.baseUrl}/wake-word/stream`);
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

  /**
   * Maps tool names to the macOS permission keys they require.
   * Used by invokeToolGuarded() to perform pre-flight checks.
   */
  static readonly TOOL_PERMISSION_REQUIREMENTS: Readonly<Record<string, ReadonlyArray<string>>> = {
    // Audio
    RecordAudio: ["microphone"],
    TranscribeAudio: ["microphone"],
    ListAudioDevices: ["microphone"],
    PlayAudio: ["microphone"],
    // Screen
    Screenshot: ["screen_recording"],
    BrowserScreenshot: ["screen_recording"],
    // Keyboard / mouse automation
    TypeText: ["accessibility"],
    Hotkey: ["accessibility"],
    MouseClick: ["accessibility"],
    MouseMove: ["accessibility"],
    // Window management
    ListWindows: ["accessibility"],
    FocusWindow: ["accessibility"],
    MoveWindow: ["accessibility"],
    MinimizeWindow: ["accessibility"],
    // App automation
    LaunchApp: ["accessibility"],
    FocusApp: ["accessibility"],
    KillProcess: ["accessibility"],
    // AppleScript — requires both accessibility and Apple Events
    AppleScript: ["accessibility", "automation"],
    PowerShellScript: ["automation"],
    // File system (Full Disk Access for paths outside app sandbox)
    ReadFile: ["full_disk_access"],
    WriteFile: ["full_disk_access"],
    DeleteFile: ["full_disk_access"],
    ListDirectory: ["full_disk_access"],
    SearchFiles: ["full_disk_access"],
    WatchDirectory: ["full_disk_access"],
    // Personal data
    SearchContacts: ["contacts"],
    GetContact: ["contacts"],
    ListEvents: ["calendar"],
    CreateEvent: ["calendar"],
    SearchPhotos: ["photos"],
    GetPhoto: ["photos"],
    // Bluetooth / local network
    BluetoothDevices: ["bluetooth"],
    ConnectedDevices: ["bluetooth", "local_network"],
    WifiNetworks: ["local_network"],
    NetworkScan: ["local_network"],
    MDNSDiscover: ["local_network"],
    // Location
    GetLocation: ["location"],
    // Input monitoring
    MonitorInput: ["input_monitoring"],
    // Reminders
    ListReminders: ["reminders"],
    CreateReminder: ["reminders"],
    // Messages (iMessage/SMS)
    ListMessages: ["messages", "full_disk_access"],
    ListConversations: ["messages", "full_disk_access"],
    SendMessage: ["messages", "automation"],
    // Mail
    ListEmails: ["mail", "automation"],
    SendEmail: ["mail", "automation"],
    GetEmailAccounts: ["mail", "automation"],
    // Speech Recognition
    TranscribeWithAppleSpeech: ["speech_recognition", "microphone"],
    ListSpeechLocales: ["speech_recognition"],
  } as const;

  /**
   * Invoke a tool with pre-flight permission checking.
   *
   * If the required permission is already granted (or unknown), proceeds normally.
   * If a required permission is denied or not_determined, throws a
   * PermissionRequiredError instead of calling the engine.
   *
   * The caller (UI layer) should catch PermissionRequiredError and display the
   * PermissionsModal or PermissionDeniedBanner.
   *
   * @param tool - Tool name matching TOOL_PERMISSION_REQUIREMENTS keys
   * @param input - Tool parameters
   * @param permissionSnapshot - Current permission states from usePermissions hook
   */
  async invokeToolGuarded(
    tool: string,
    input: Record<string, unknown>,
    permissionSnapshot: Map<string, { status: string; label: string; description: string }>,
  ): Promise<ToolResult> {
    const required = EngineAPI.TOOL_PERMISSION_REQUIREMENTS[tool];
    if (required) {
      for (const key of required) {
        const state = permissionSnapshot.get(key);
        if (state && state.status !== "granted" && state.status !== "unknown") {
          throw new PermissionRequiredError(key, state.label, state.description, tool);
        }
      }
    }
    return this.invokeTool(tool, input);
  }

  /** Connect via WebSocket for persistent, stateful sessions. */
  async connectWebSocket(): Promise<void> {
    if (!this.wsUrl) throw new Error("Engine not discovered");

    // WebSocket does not support arbitrary headers in the browser.
    // The server validates auth via a `?token=` query parameter instead.
    const token = this._getAccessToken ? await this._getAccessToken() : null;
    const url = token ? `${this.wsUrl}?token=${encodeURIComponent(token)}` : this.wsUrl;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

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
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/remote-scraper/status`, {
      headers,
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

  // ---- Remote search & research ----

  /** Search via Brave Search API on the remote server. */
  async remoteSearch(
    keywords: string[],
    count = 20,
    country = "US",
  ): Promise<Record<string, unknown>> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    const resp = await fetch(`${this.baseUrl}/remote-scraper/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ keywords, count, country }),
    });
    if (!resp.ok) throw new Error(`Remote search failed: ${resp.status}`);
    return resp.json();
  }

  /** Search then scrape top results. Results are stored server-side immediately. */
  async remoteSearchAndScrape(
    keywords: string[],
    totalResultsPerKeyword = 10,
    options?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    const resp = await fetch(`${this.baseUrl}/remote-scraper/search-and-scrape`, {
      method: "POST",
      headers,
      body: JSON.stringify({ keywords, total_results_per_keyword: totalResultsPerKeyword, options: options ?? {} }),
    });
    if (!resp.ok) throw new Error(`Remote search-and-scrape failed: ${resp.status}`);
    return resp.json();
  }

  /** Stream search + scrape results via SSE. */
  remoteSearchAndScrapeStream(
    keywords: string[],
    totalResultsPerKeyword = 10,
    options: Record<string, unknown> | undefined,
    onEvent: (event: string, data: unknown) => void,
    onDone?: () => void,
    onError?: (err: Error) => void,
  ): Promise<AbortController> {
    return this.streamSSE(
      "/remote-scraper/search-and-scrape/stream",
      { keywords, total_results_per_keyword: totalResultsPerKeyword, options: options ?? {} },
      onEvent, onDone, onError,
    );
  }

  /** Deep research — iterative search + scrape + compile. */
  async remoteResearch(
    query: string,
    effort = "extreme",
    country = "US",
  ): Promise<Record<string, unknown>> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    const resp = await fetch(`${this.baseUrl}/remote-scraper/research`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, effort, country }),
    });
    if (!resp.ok) throw new Error(`Remote research failed: ${resp.status}`);
    return resp.json();
  }

  /** Stream deep research results via SSE. */
  remoteResearchStream(
    query: string,
    effort = "extreme",
    country = "US",
    onEvent: (event: string, data: unknown) => void,
    onDone?: () => void,
    onError?: (err: Error) => void,
  ): Promise<AbortController> {
    return this.streamSSE(
      "/remote-scraper/research/stream",
      { query, effort, country },
      onEvent, onDone, onError,
    );
  }

  // ---- Content save-back ----

  /**
   * Save locally-scraped content to the server database immediately.
   * Call this after every successful local scrape so the web app and
   * all other devices see the result instantly.
   */
  async saveContent(
    url: string,
    content: Record<string, unknown>,
    contentType = "html",
    charCount?: number,
    ttlDays = 30,
  ): Promise<{ status: string; page_name: string; url: string; domain: string; char_count: number }> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    const resp = await fetch(`${this.baseUrl}/remote-scraper/content/save`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url, content, content_type: contentType, char_count: charCount, ttl_days: ttlDays }),
    });
    if (!resp.ok) throw new Error(`Content save failed: ${resp.status}`);
    return resp.json();
  }

  // ---- Retry queue ----

  /** Get URLs that failed on the server and need local retry. */
  async queuePending(
    tier: "desktop" | "extension" = "desktop",
    limit = 10,
  ): Promise<{ items: Array<{ id: string; target_url: string; domain_name: string; failure_reason: string; attempt_count: number }> }> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(
      `${this.baseUrl}/remote-scraper/queue/pending?tier=${tier}&limit=${limit}`,
      { headers },
    );
    if (!resp.ok) throw new Error(`Queue pending failed: ${resp.status}`);
    return resp.json();
  }

  /** Retry queue statistics from the remote server. */
  async queueStats(): Promise<Record<string, unknown>> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/remote-scraper/queue/stats`, { headers });
    if (!resp.ok) throw new Error(`Queue stats failed: ${resp.status}`);
    return resp.json();
  }

  /** Local retry queue poller statistics (this engine's activity). */
  async queuePollerStats(): Promise<{ polled: number; claimed: number; submitted: number; failed: number; running: boolean; client_id: string }> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/remote-scraper/queue/poller-stats`, { headers });
    if (!resp.ok) throw new Error(`Queue poller stats failed: ${resp.status}`);
    return resp.json();
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

  private reconnectDelay = 3000;
  private readonly MAX_RECONNECT_DELAY = 60000;

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      // Don't attempt reconnect if there's no token — the server will
      // reject with 403 and we'd loop forever. Wait for auth state changes
      // to trigger a reconnect via connectWebSocket() instead.
      const token = this._getAccessToken ? await this._getAccessToken() : null;
      if (!token) {
        this.reconnectDelay = 3000; // reset backoff
        return;
      }
      try {
        await this.connectWebSocket();
        this.reconnectDelay = 3000; // reset on success
      } catch {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.MAX_RECONNECT_DELAY);
        this.scheduleReconnect();
      }
    }, this.reconnectDelay);
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

  // ---- Proxy API ----

  /** Get proxy server status. */
  async proxyStatus(): Promise<ProxyStatus> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/proxy/status`, { headers });
    if (!resp.ok) throw new Error(`Proxy status failed: ${resp.status}`);
    return resp.json();
  }

  /** Start the proxy server. */
  async proxyStart(port = 0): Promise<ProxyStatus> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    const resp = await fetch(`${this.baseUrl}/proxy/start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ port }),
    });
    if (!resp.ok) throw new Error(`Proxy start failed: ${resp.status}`);
    return resp.json();
  }

  /** Stop the proxy server. */
  async proxyStop(): Promise<void> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    await fetch(`${this.baseUrl}/proxy/stop`, { method: "POST", headers });
  }

  /** Test proxy connectivity. */
  async proxyTest(): Promise<ProxyTestResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    const resp = await fetch(`${this.baseUrl}/proxy/test`, { method: "POST", headers });
    if (!resp.ok) throw new Error(`Proxy test failed: ${resp.status}`);
    return resp.json();
  }

  // ---- Cloud Sync API ----

  /** Configure cloud sync with user credentials. */
  async configureCloudSync(jwt: string, userId: string): Promise<CloudConfigResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    const resp = await fetch(`${this.baseUrl}/cloud/configure`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jwt, user_id: userId }),
    });
    if (!resp.ok) throw new Error(`Cloud configure failed: ${resp.status}`);
    return resp.json();
  }

  /** Reconfigure cloud sync with fresh JWT. */
  async reconfigureCloudSync(jwt: string, userId: string): Promise<void> {
    if (!this.baseUrl) return;
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    await fetch(`${this.baseUrl}/cloud/reconfigure`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jwt, user_id: userId }),
    }).catch(() => { });
  }

  /** Get cloud-synced settings. */
  async getCloudSettings(): Promise<CloudSettingsResponse> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/cloud/settings`, { headers });
    if (!resp.ok) throw new Error(`Cloud settings failed: ${resp.status}`);
    return resp.json();
  }

  /** Update cloud-synced settings. */
  async updateCloudSettings(settings: Record<string, unknown>): Promise<CloudSettingsResponse> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    const resp = await fetch(`${this.baseUrl}/cloud/settings`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ settings }),
    });
    if (!resp.ok) throw new Error(`Cloud settings update failed: ${resp.status}`);
    return resp.json();
  }

  /** Trigger a bidirectional sync. */
  async triggerCloudSync(): Promise<CloudSyncResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    const resp = await fetch(`${this.baseUrl}/cloud/sync`, { method: "POST", headers });
    if (!resp.ok) throw new Error(`Cloud sync failed: ${resp.status}`);
    return resp.json();
  }

  /** Force push local settings to cloud. */
  async pushCloudSettings(): Promise<CloudSyncResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    const resp = await fetch(`${this.baseUrl}/cloud/sync/push`, { method: "POST", headers });
    if (!resp.ok) throw new Error(`Cloud push failed: ${resp.status}`);
    return resp.json();
  }

  /** Force pull cloud settings to local. */
  async pullCloudSettings(): Promise<CloudSyncResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    const resp = await fetch(`${this.baseUrl}/cloud/sync/pull`, { method: "POST", headers });
    if (!resp.ok) throw new Error(`Cloud pull failed: ${resp.status}`);
    return resp.json();
  }

  /** Get this instance's info. */
  async getInstanceInfo(): Promise<InstanceInfo> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/cloud/instance`, { headers });
    if (!resp.ok) throw new Error(`Instance info failed: ${resp.status}`);
    return resp.json();
  }

  /** List all registered instances for the current user. */
  async listInstances(): Promise<{ instances: InstanceInfo[] }> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/cloud/instances`, { headers });
    if (!resp.ok) throw new Error(`List instances failed: ${resp.status}`);
    return resp.json();
  }

  // ---- Generic HTTP helpers ----

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const authHdrs = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...authHdrs, ...(init?.headers as Record<string, string> | undefined) },
    });
    if (!resp.ok) throw new Error(`${init?.method ?? "GET"} ${path} failed: ${resp.status}`);
    return resp.json();
  }

  async get(path: string): Promise<unknown> {
    return this.request(path);
  }

  async post(path: string, body: unknown): Promise<unknown> {
    return this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async put(path: string, body: unknown): Promise<unknown> {
    return this.request(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async delete(path: string): Promise<unknown> {
    return this.request(path, { method: "DELETE" });
  }

  /** Update instance display name. */
  async updateInstanceName(name: string): Promise<void> {
    if (!this.baseUrl) return;
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    await fetch(`${this.baseUrl}/cloud/instance/name`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ name }),
    });
  }

  /** Send heartbeat for this instance. */
  async cloudHeartbeat(): Promise<void> {
    if (!this.baseUrl) return;
    const headers = { "Content-Type": "application/json", ...(await this.authHeaders()) };
    await fetch(`${this.baseUrl}/cloud/heartbeat`, { method: "POST", headers }).catch(() => { });
  }

  /**
   * Push the current Supabase JWT to Python so it persists in SQLite across restarts.
   * Called automatically on every auth state change (login, token refresh).
   * Python reads this on startup so it can make authenticated API calls without
   * waiting for React to boot.
   */
  async syncTokenToPython(
    accessToken: string,
    userId: string,
    refreshToken?: string,
    expiresIn?: number,
  ): Promise<void> {
    if (!this.baseUrl) return;
    await fetch(`${this.baseUrl}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken ?? null,
        user_id: userId,
        expires_in: expiresIn ?? null,
      }),
    }).catch(() => {
      // Non-critical — Python will work without the persisted token,
      // it just won't survive a restart until React pushes again.
    });
  }

  /** Clear the stored JWT on logout. */
  async clearPythonToken(): Promise<void> {
    if (!this.baseUrl) return;
    await fetch(`${this.baseUrl}/auth/token`, { method: "DELETE" }).catch(() => { });
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

    const resp = await fetch(`${this.baseUrl}/notes${path}`, {
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

  /** Trigger a sync. Mode: "push" | "pull" | "bidirectional" */
  async triggerSync(userId: string, mode: "push" | "pull" | "bidirectional" = "bidirectional"): Promise<SyncResult> {
    return this.docRequest("POST", "/sync/trigger", { mode }, userId);
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
    resolution: "keep_local" | "keep_remote" | "merge" | "split" | "exclude",
    mergedContent?: string,
  ): Promise<void> {
    await this.docRequest(
      "POST",
      `/conflicts/${noteId}/resolve`,
      { resolution, merged_content: mergedContent },
      userId,
    );
  }

  /** Get conflict details with both versions' content. */
  async getConflicts(userId: string): Promise<ConflictList> {
    return this.docRequest("GET", "/conflicts", undefined, userId);
  }

  /** Exclude a note from sync. */
  async setNoteExcluded(noteId: string, userId: string, excluded: boolean): Promise<void> {
    await this.docRequest("POST", `/notes/${noteId}/exclude`, { excluded }, userId);
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

  // ---- Device & Permission API ----

  /** Get all device/OS permission statuses. */
  async getDevicePermissions(): Promise<DevicePermissionsResponse> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/devices/permissions`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`Permissions check failed: ${resp.status}`);
    return resp.json();
  }

  /** Get a single permission status. */
  async getDevicePermission(name: string): Promise<PermissionInfo> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/devices/permissions/${name}`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Permission check failed: ${resp.status}`);
    return resp.json();
  }

  /** List audio input/output devices. */
  async getAudioDevices(): Promise<DeviceProbeResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/devices/audio`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Audio device check failed: ${resp.status}`);
    return resp.json();
  }

  /** List Bluetooth devices. */
  async getBluetoothDevices(): Promise<DeviceProbeResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/devices/bluetooth`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`Bluetooth check failed: ${resp.status}`);
    return resp.json();
  }

  /** List WiFi networks. */
  async getWifiNetworks(): Promise<DeviceProbeResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/devices/wifi`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`WiFi scan failed: ${resp.status}`);
    return resp.json();
  }

  /** Get network interface info. */
  async getNetworkInfo(): Promise<DeviceProbeResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/devices/network`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Network info failed: ${resp.status}`);
    return resp.json();
  }

  /** List connected peripherals (USB, Bluetooth, etc.). */
  async getConnectedDevices(): Promise<DeviceProbeResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/devices/connected`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Connected devices check failed: ${resp.status}`);
    return resp.json();
  }

  /**
   * Fetch all named path aliases as resolved absolute paths from the engine.
   *
   * Use this instead of ever constructing paths in React or any remote caller.
   * The engine knows the user's OS, drive letter, and configuration — React does not.
   *
   * Example usage:
   *   const paths = await engine.getPaths();
   *   engine.invokeTool("Read", { file_path: paths.resolved.settings });
   *
   * Or use the alias directly in tool calls (engine resolves it):
   *   engine.invokeTool("Read", { file_path: "@matrx/local.json" });
   */
  async getPaths(): Promise<EnginePaths> {
    return this.request<EnginePaths>("/system/paths");
  }

  /** Open a system folder (logs or data) in the file manager. */
  async openSystemFolder(folder: "logs" | "data"): Promise<{ opened: string }> {
    return this.request<{ opened: string }>("/system/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder }),
    });
  }

  async getCapabilities(): Promise<CapabilitiesResponse> {
    return this.request<CapabilitiesResponse>("/capabilities");
  }

  async installCapability(capabilityId: string): Promise<InstallCapabilityResult> {
    return this.request<InstallCapabilityResult>("/capabilities/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability_id: capabilityId }),
    });
  }

  async getSystemResources(): Promise<DeviceProbeResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/devices/system`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`System resources check failed: ${resp.status}`);
    return resp.json();
  }

  /** List cameras. */
  async getCameraDevices(): Promise<DeviceProbeResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/devices/camera`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`Camera probe failed: ${resp.status}`);
    return resp.json();
  }

  /** List all connected screens/monitors. */
  async getScreens(): Promise<DeviceProbeResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/devices/screens`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Screens probe failed: ${resp.status}`);
    return resp.json();
  }

  /** Take a screenshot (optionally for a specific monitor index or "all"/"primary"). */
  async takeScreenshot(monitor: string | number = "all"): Promise<DeviceProbeResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/devices/screenshot?monitor=${encodeURIComponent(String(monitor))}`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`Screenshot failed: ${resp.status}`);
    return resp.json();
  }

  /** Get device location (lat/lon if permission granted). */
  async getLocation(): Promise<DeviceProbeResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/devices/location`, {
      headers,
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) throw new Error(`Location probe failed: ${resp.status}`);
    return resp.json();
  }

  /** Record audio from microphone and return base64 WAV. */
  async recordAudio(opts: { device_index?: number; duration_seconds?: number }): Promise<DeviceProbeResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/devices/record-audio`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(opts),
      signal: AbortSignal.timeout((opts.duration_seconds ?? 5) * 1000 + 10000),
    });
    if (!resp.ok) throw new Error(`Audio recording failed: ${resp.status}`);
    return resp.json();
  }

  /** Capture a photo from webcam and return base64 JPEG. */
  async capturePhoto(opts: { device_index?: number }): Promise<DeviceProbeResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/devices/capture-photo`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(opts),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`Photo capture failed: ${resp.status}`);
    return resp.json();
  }

  /** Record a short video from webcam and return base64 MP4. */
  async recordVideo(opts: { device_index?: number; duration_seconds?: number }): Promise<DeviceProbeResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/devices/record-video`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(opts),
      signal: AbortSignal.timeout((opts.duration_seconds ?? 5) * 1000 + 10000),
    });
    if (!resp.ok) throw new Error(`Video recording failed: ${resp.status}`);
    return resp.json();
  }

  /** Record screen video and return base64 MP4. */
  async recordScreen(opts: { screen_index?: number; duration_seconds?: number }): Promise<DeviceProbeResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/devices/record-screen`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(opts),
      signal: AbortSignal.timeout((opts.duration_seconds ?? 5) * 1000 + 30000),
    });
    if (!resp.ok) throw new Error(`Screen recording failed: ${resp.status}`);
    return resp.json();
  }

  // ── Platform context ───────────────────────────────────────────────────

  async getPlatformContext(): Promise<import("./platformCtx").PlatformContext> {
    return this.request<import("./platformCtx").PlatformContext>("/platform/context");
  }

  async refreshPlatformContext(): Promise<import("./platformCtx").PlatformContext> {
    return this.request<import("./platformCtx").PlatformContext>("/platform/context/refresh", {
      method: "POST",
    });
  }

  // ── Setup / First-run ──────────────────────────────────────────────────

  async getSetupStatus(): Promise<SetupStatus> {
    return this.request<SetupStatus>("/setup/status");
  }

  /**
   * Run the setup install and stream progress via SSE.
   * Calls onProgress for each event, onComplete when done.
   */
  async runSetupInstall(callbacks: {
    onProgress: (data: SetupProgressEvent) => void;
    onComplete: (data: SetupCompleteEvent) => void;
    onError: (error: string) => void;
    /** Raw SSE line callback for full transparency logging */
    onRawLine?: (line: string) => void;
    signal?: AbortSignal;
  }): Promise<void> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    const resp = await fetch(`${this.baseUrl}/setup/install`, {
      method: "POST",
      headers,
      signal: callbacks.signal,
    });
    if (!resp.ok) {
      callbacks.onError(`Setup install failed: ${resp.status}`);
      return;
    }
    const reader = resp.body?.getReader();
    if (!reader) { callbacks.onError("No response body"); return; }
    const decoder = new TextDecoder();
    let buffer = "";
    let receivedComplete = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      let eventType = "";
      for (const line of lines) {
        callbacks.onRawLine?.(line);
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (eventType === "progress") callbacks.onProgress(data);
            else if (eventType === "complete") {
              receivedComplete = true;
              callbacks.onComplete(data as SetupCompleteEvent);
            }
            else if (eventType === "cancelled") { receivedComplete = true; callbacks.onError("Setup cancelled"); }
            else if (eventType === "started") callbacks.onProgress({ component: "_system", status: "installing", message: data.message, percent: 0 });
          } catch { /* skip malformed */ }
          eventType = "";
        }
      }
    }
    if (!receivedComplete) {
      callbacks.onError("Setup stream ended without a completion event — check the debug terminal for details");
    }
  }

  /**
   * Install the transcription model via SSE stream.
   */
  async runTranscriptionInstall(
    model: string,
    callbacks: {
      onProgress: (data: SetupProgressEvent) => void;
      onComplete: (data: { message: string; had_errors?: boolean; errors?: string[] }) => void;
      onError: (error: string) => void;
      onRawLine?: (line: string) => void;
      signal?: AbortSignal;
    },
  ): Promise<void> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const headers = await this.authHeaders();
    (headers as Record<string, string>)["Content-Type"] = "application/json";
    const resp = await fetch(`${this.baseUrl}/setup/install-transcription`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model }),
      signal: callbacks.signal,
    });
    if (!resp.ok) { callbacks.onError(`Transcription install failed: ${resp.status}`); return; }
    const reader = resp.body?.getReader();
    if (!reader) { callbacks.onError("No response body"); return; }
    const decoder = new TextDecoder();
    let buffer = "";
    let receivedComplete = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      let eventType = "";
      for (const line of lines) {
        callbacks.onRawLine?.(line);
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (eventType === "progress") callbacks.onProgress(data);
            else if (eventType === "complete") { receivedComplete = true; callbacks.onComplete(data); }
            else if (eventType === "cancelled") { receivedComplete = true; callbacks.onError("Install cancelled"); }
          } catch { /* skip malformed */ }
          eventType = "";
        }
      }
    }
    if (!receivedComplete) {
      callbacks.onError("Transcription install stream ended without completion event");
    }
  }

  /**
   * Stream live log lines from the engine's system.log via SSE.
   *
   * First delivers the last `lines` lines of history, then follows the file
   * in real-time until `signal` is aborted or the stream ends.
   *
   * Each SSE "log" event carries: { line: string; level: string; timestamp: number }
   */
  streamLogs(callbacks: {
    onLine: (data: { line: string; level: string; timestamp: number }) => void;
    onHistoryEnd?: (linesSent: number) => void;
    onConnected?: (logPath: string) => void;
    onError?: (error: string) => void;
    signal?: AbortSignal;
    lines?: number;
  }): () => void {
    if (!this.baseUrl) {
      callbacks.onError?.("Engine not discovered");
      return () => {};
    }
    const url = `${this.baseUrl}/setup/logs?lines=${callbacks.lines ?? 200}`;
    let active = true;

    const run = async () => {
      try {
        const resp = await fetch(url, { signal: callbacks.signal });
        if (!resp.ok) {
          callbacks.onError?.(`Log stream failed: ${resp.status}`);
          return;
        }
        const reader = resp.body?.getReader();
        if (!reader) { callbacks.onError?.("No response body"); return; }
        const decoder = new TextDecoder();
        let buffer = "";
        let eventType = "";

        while (active) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (eventType === "log") {
                  callbacks.onLine(data as { line: string; level: string; timestamp: number });
                } else if (eventType === "history_end") {
                  callbacks.onHistoryEnd?.(data.lines_sent ?? 0);
                } else if (eventType === "connected") {
                  callbacks.onConnected?.(data.log_path ?? "");
                }
              } catch { /* skip malformed */ }
              eventType = "";
            }
          }
        }
      } catch (err) {
        if (active) {
          callbacks.onError?.(err instanceof Error ? err.message : String(err));
        }
      }
    };

    run();
    return () => { active = false; };
  }

  /** Fetch the full diagnostic snapshot from /setup/debug (no auth required). */
  async getDebugState(): Promise<Record<string, unknown>> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const resp = await fetch(`${this.baseUrl}/setup/debug`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`Debug state failed: ${resp.status}`);
    return resp.json();
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
  sync_status?: "never_synced" | "synced" | "pending_push" | "excluded";
  sync_enabled?: boolean;
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
  pending_push_count?: number;
  excluded_count?: number;
}

export interface SyncResult {
  pushed?: number;
  pulled?: number;
  conflicts?: number;
  unchanged?: number;
  skipped?: number;
  failed?: number;
  error?: string;
}

export interface ConflictDetail {
  note_id: string;
  local_content?: string;
  remote_content?: string;
  label?: string;
  folder_name?: string;
}

export interface ConflictList {
  conflicts: ConflictDetail[];
  count: number;
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

// ---- Proxy types ----

export interface ProxyStatus {
  running: boolean;
  port: number;
  proxy_url: string;
  request_count: number;
  bytes_forwarded: number;
  active_connections: number;
  uptime_seconds: number;
}

export interface ProxyTestResult {
  success: boolean;
  status_code?: number;
  body?: string;
  error?: string;
  proxy_url: string;
}

// ---- Cloud Sync types ----

export interface CloudConfigResult {
  configured: boolean;
  instance_id: string;
  sync_result: { status: string; reason?: string };
}

export interface CloudSettingsResponse {
  settings: Record<string, unknown>;
  configured: boolean;
  push_result?: { status: string; reason?: string };
}

export interface CloudSyncResult {
  status: string;
  reason?: string;
  settings?: Record<string, unknown>;
}

export interface InstanceInfo {
  instance_id: string;
  instance_name: string;
  platform?: string;
  os_version?: string;
  architecture?: string;
  hostname?: string;
  username?: string;
  python_version?: string;
  home_dir?: string;
  cpu_model?: string;
  cpu_cores?: number;
  ram_total_gb?: number;
  last_seen?: string;
  is_active?: boolean;
  id?: string;
}

// ---- Device & Permission types ----

export type PermissionStatusValue =
  | "granted"
  | "denied"
  | "not_determined"
  | "restricted"
  | "unavailable"
  | "unknown";

export interface PermissionInfo {
  permission: string;
  status: PermissionStatusValue;
  details: string;
  grant_instructions: string;
  user_details?: string;
  user_instructions?: string;
  fixable?: boolean;
  fix_capability_id?: string | null;
  devices?: Array<Record<string, unknown>>;
  deep_link?: string | null;
}

export interface DevicePermissionsResponse {
  permissions: PermissionInfo[];
  platform: string;
}

export interface DeviceProbeResult {
  output: string;
  metadata: Record<string, unknown> | null;
  type: string;
}

// ---- Capabilities types ----

export type CapabilityStatus = "installed" | "not_installed" | "checking";

export interface Capability {
  id: string;
  name: string;
  description: string;
  status: CapabilityStatus;
  packages: string[];
  install_extra: string | null;
  size_warning: string | null;
  docs_url: string | null;
}

export interface CapabilitiesResponse {
  capabilities: Capability[];
}

export interface InstallCapabilityResult {
  success: boolean;
  message: string;
}

// ---- Path types ----

/**
 * Named path aliases and resolved absolute paths on the user's machine.
 * Returned by GET /system/paths.  React and microservices should fetch this
 * once on startup and never construct OS paths themselves.
 *
 * All aliases can be used in tool calls:
 *   @notes  → ~/Documents/Matrx/Notes/
 *   @files  → ~/Documents/Matrx/Files/
 *   @code   → ~/Documents/Matrx/Code/
 *   @matrx  → ~/.matrx/   (engine internals)
 *   @home   → user home directory
 *   @temp   → OS temp/cache dir
 */
export interface EnginePaths {
  /** Logical alias → absolute directory path */
  aliases: {
    "@matrx": string;       // ~/.matrx/ — engine internals
    "@notes": string;       // ~/Documents/Matrx/Notes/
    "@files": string;       // ~/Documents/Matrx/Files/
    "@code": string;        // ~/Documents/Matrx/Code/
    "@workspaces": string;  // ~/.matrx/workspaces/
    "@agentdata": string;   // ~/.matrx/data/
    "@user": string;        // ~/Documents/Matrx/
    "@temp": string;
    "@data": string;
    "@logs": string;
    "@home": string;
    "@docs": string;        // deprecated alias for @notes
    [key: string]: string;  // allow future aliases without TS errors
  };
  /** Named locations with their full absolute paths. */
  resolved: {
    // Engine internals
    discovery: string;      // local.json — engine discovery
    settings: string;       // settings.json
    instance: string;       // instance.json
    agent_data: string;     // ~/.matrx/data/
    workspaces: string;     // ~/.matrx/workspaces/
    // User-visible
    user_root: string;      // ~/Documents/Matrx/
    notes: string;          // ~/Documents/Matrx/Notes/
    files: string;          // ~/Documents/Matrx/Files/
    code: string;           // ~/Documents/Matrx/Code/
    // Platform cache
    temp: string;
    screenshots: string;
    data: string;
    logs: string;
    config: string;
  };
}

// ---- Setup types ----

export interface SetupComponentStatus {
  id: string;
  label: string;
  description: string;
  /** "warning" = advisory only (cannot be auto-fixed, e.g. macOS TCC permissions) */
  status: "ready" | "not_ready" | "installing" | "error" | "skipped" | "warning";
  detail: string | null;
  optional: boolean;
  size_hint: string | null;
  /** macOS x-apple.systempreferences deep link or other OS settings URL */
  deep_link: string | null;
}

export interface SetupStatus {
  setup_complete: boolean;
  components: SetupComponentStatus[];
  platform: string;
  architecture: string;
  gpu_available: boolean;
  gpu_name: string | null;
}

export interface SetupProgressEvent {
  component: string;
  status: string;
  message: string;
  percent: number;
  /** Optional deep link forwarded from Python backend */
  deep_link?: string | null;
  /** Raw byte counts for download progress */
  bytes_downloaded?: number;
  total_bytes?: number;
}

export interface SetupCompleteEvent {
  message: string;
  had_errors: boolean;
  errors: string[];
  timestamp: number;
}

// Singleton instance
export const engine = new EngineAPI();
