import type {
  ChatMessage,
  ChatCompletionResponse,
  ToolDefinition,
  ToolCall,
} from "./types";
import { loadSettings, type AppSettings } from "@/lib/settings";

// ── Typed Errors ──────────────────────────────────────────────────────────

export class ContextSizeError extends Error {
  readonly promptTokens: number;
  readonly contextSize: number;

  constructor(promptTokens: number, contextSize: number) {
    super(
      `Request requires ${promptTokens.toLocaleString()} tokens but the model's context window is only ${contextSize.toLocaleString()} tokens.`
    );
    this.name = "ContextSizeError";
    this.promptTokens = promptTokens;
    this.contextSize = contextSize;
  }
}

function throwIfContextError(status: number, body: string): void {
  if (status !== 400) return;
  try {
    const json = JSON.parse(body) as {
      error?: { type?: string; n_prompt_tokens?: number; n_ctx?: number };
    };
    if (json.error?.type === "exceed_context_size_error") {
      throw new ContextSizeError(
        json.error.n_prompt_tokens ?? 0,
        json.error.n_ctx ?? 0
      );
    }
  } catch (e) {
    if (e instanceof ContextSizeError) throw e;
  }
}

// ── Sampling Presets (read from user config) ──────────────────────────────

/** Cached settings — refreshed on each top-level API call. */
let _cached: AppSettings | null = null;

async function cfg(): Promise<AppSettings> {
  // Load once per call tree — subsequent calls within the same tick reuse cache.
  if (!_cached) _cached = await loadSettings();
  return _cached;
}

/** Invalidate cache so next API call picks up fresh settings. */
export function invalidateLlmSettingsCache(): void {
  _cached = null;
}

function chatParams(s: AppSettings) {
  return {
    temperature: s.llmChatTemperature,
    top_p: s.llmChatTopP,
    top_k: s.llmChatTopK,
    chat_template_kwargs: { enable_thinking: false },
  };
}

function reasoningParams(s: AppSettings) {
  return {
    temperature: s.llmReasoningTemperature,
    top_p: s.llmReasoningTopP,
    top_k: s.llmChatTopK,
    chat_template_kwargs: { enable_thinking: s.llmEnableThinking },
  };
}

function toolCallParams(s: AppSettings) {
  return {
    temperature: s.llmToolCallTemperature,
    top_p: s.llmToolCallTopP,
    top_k: s.llmToolCallTopK,
    chat_template_kwargs: { enable_thinking: false },
  };
}

// ── Core API Functions ────────────────────────────────────────────────────

/** Simple chat completion (non-streaming). */
export async function chatCompletion(
  port: number,
  messages: ChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    thinking?: boolean;
  }
): Promise<string> {
  const s = await cfg();
  const params = options?.thinking ? reasoningParams(s) : chatParams(s);

  const response = await fetch(
    `http://127.0.0.1:${port}/v1/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local",
        messages,
        temperature: options?.temperature ?? params.temperature,
        max_tokens: options?.maxTokens ?? s.llmChatMaxTokens,
        stream: false,
        top_p: params.top_p,
        top_k: params.top_k,
        chat_template_kwargs: params.chat_template_kwargs,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throwIfContextError(response.status, text);
    throw new Error(`LLM request failed (${response.status}): ${text}`);
  }

  const data: ChatCompletionResponse = await response.json();
  const content = data.choices[0]?.message?.content ?? "";

  return stripThinking(content);
}

/** Streaming chat completion. Yields content tokens as they arrive. */
export async function* streamCompletion(
  port: number,
  messages: ChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
  }
): AsyncGenerator<string> {
  const s = await cfg();
  const params = chatParams(s);

  const response = await fetch(
    `http://127.0.0.1:${port}/v1/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local",
        messages,
        temperature: options?.temperature ?? params.temperature,
        max_tokens: options?.maxTokens ?? s.llmStreamMaxTokens,
        stream: true,
        top_p: params.top_p,
        top_k: params.top_k,
        chat_template_kwargs: params.chat_template_kwargs,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throwIfContextError(response.status, text);
    throw new Error(`LLM stream failed (${response.status}): ${text}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n").filter((line) => line.startsWith("data: "));

    for (const line of lines) {
      const data = line.slice(6).trim();
      if (data === "[DONE]") return;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // Ignore malformed SSE chunks
      }
    }
  }
}

/** Chat completion with tool calling support. */
export async function callWithTools(
  port: number,
  messages: ChatMessage[],
  tools: ToolDefinition[]
): Promise<{
  content: string | null;
  toolCalls: Array<{
    toolName: string;
    toolCallId: string;
    arguments: Record<string, unknown>;
  }>;
}> {
  const s = await cfg();
  const params = toolCallParams(s);

  const response = await fetch(
    `http://127.0.0.1:${port}/v1/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local",
        messages,
        tools,
        tool_choice: "auto",
        temperature: params.temperature,
        max_tokens: s.llmChatMaxTokens,
        stream: false,
        top_p: params.top_p,
        top_k: params.top_k,
        chat_template_kwargs: params.chat_template_kwargs,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throwIfContextError(response.status, text);
    throw new Error(`Tool call failed (${response.status}): ${text}`);
  }

  const data: ChatCompletionResponse = await response.json();
  const message = data.choices[0]?.message;

  const toolCalls = (message?.tool_calls ?? []).map((tc: ToolCall) => ({
    toolName: tc.function.name,
    toolCallId: tc.id,
    arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
  }));

  return {
    content: message?.content ? stripThinking(message.content) : null,
    toolCalls,
  };
}

/** Structured output with JSON schema constraint. */
export async function structuredOutput<T>(
  port: number,
  messages: ChatMessage[],
  schema: object
): Promise<T> {
  const s = await cfg();

  const response = await fetch(
    `http://127.0.0.1:${port}/v1/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local",
        messages,
        temperature: s.llmStructuredOutputTemperature,
        max_tokens: 2048,
        stream: false,
        response_format: {
          type: "json_schema",
          json_schema: { schema },
        },
        chat_template_kwargs: { enable_thinking: false },
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throwIfContextError(response.status, text);
    throw new Error(`Structured output failed (${response.status}): ${text}`);
  }

  const data: ChatCompletionResponse = await response.json();
  return JSON.parse(data.choices[0].message.content!) as T;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function stripThinking(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
