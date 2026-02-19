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

  /** Discover the engine port by scanning the known range. */
  async discover(): Promise<string | null> {
    // Try reading the discovery file first (written by run.py)
    try {
      const resp = await fetch(`http://127.0.0.1:${DEFAULT_PORT}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (resp.ok) {
        this.baseUrl = `http://127.0.0.1:${DEFAULT_PORT}`;
        this.wsUrl = `ws://127.0.0.1:${DEFAULT_PORT}/ws`;
        return this.baseUrl;
      }
    } catch {
      // Default port not available, scan the range
    }

    for (const port of DISCOVERY_PORTS) {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/health`, {
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
      const resp = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /** Get the list of available tools from the engine. */
  async listTools(): Promise<string[]> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const resp = await fetch(`${this.baseUrl}/tools/list`);
    if (!resp.ok) throw new Error(`Failed to list tools: ${resp.status}`);
    const data = await resp.json();
    return data.tools ?? data;
  }

  /** Invoke a tool via REST (stateless, one-shot). */
  async invokeTool(tool: string, input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const resp = await fetch(`${this.baseUrl}/tools/invoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    return JSON.parse(result.output);
  }

  /** Get browser status for local scraping. */
  async getBrowserStatus(): Promise<BrowserStatus> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    try {
      const resp = await fetch(`${this.baseUrl}/local-scrape/status`, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) return resp.json();
    } catch {
      // Local scrape endpoints may not be available yet
    }
    return {
      chrome_found: false,
      chrome_path: null,
      chrome_version: null,
      profile_found: false,
      browser_running: false,
    };
  }

  /** Scrape URLs using the local browser. */
  async scrapeLocally(urls: string[]): Promise<ScrapeResultData[]> {
    if (!this.baseUrl) throw new Error("Engine not discovered");
    const resp = await fetch(`${this.baseUrl}/local-scrape/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    if (!resp.ok) throw new Error(`Scrape failed: ${resp.status}`);
    return resp.json();
  }

  /** Scrape URLs using the engine's multi-strategy scraper. */
  async scrape(
    urls: string[],
    useCache = true
  ): Promise<ToolResult> {
    return this.invokeTool("Scrape", { urls, use_cache: useCache });
  }

  /** Search the web via the engine. */
  async search(query: string, count = 10): Promise<ToolResult> {
    return this.invokeTool("Search", { query, count });
  }

  /** Deep research via the engine. */
  async research(query: string, effort = "medium"): Promise<ToolResult> {
    return this.invokeTool("Research", { query, effort });
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
}

// Singleton instance
export const engine = new EngineAPI();
