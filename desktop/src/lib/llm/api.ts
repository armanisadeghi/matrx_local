import type {
  ChatMessage,
  ChatCompletionResponse,
  ToolDefinition,
  ToolCall,
} from "./types";

// ── Qwen3 Sampling Presets ────────────────────────────────────────────────

const TOOL_CALL_PARAMS = {
  temperature: 0.7,
  top_p: 0.8,
  top_k: 20,
  chat_template_kwargs: { enable_thinking: false },
};

const CHAT_PARAMS = {
  temperature: 0.7,
  top_p: 0.8,
  top_k: 20,
  chat_template_kwargs: { enable_thinking: false },
};

const REASONING_PARAMS = {
  temperature: 0.6,
  top_p: 0.95,
  top_k: 20,
  chat_template_kwargs: { enable_thinking: true },
};

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
  const params = options?.thinking ? REASONING_PARAMS : CHAT_PARAMS;

  const response = await fetch(
    `http://127.0.0.1:${port}/v1/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local",
        messages,
        temperature: options?.temperature ?? params.temperature,
        max_tokens: options?.maxTokens ?? 1024,
        stream: false,
        top_p: params.top_p,
        top_k: params.top_k,
        chat_template_kwargs: params.chat_template_kwargs,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${text}`);
  }

  const data: ChatCompletionResponse = await response.json();
  const content = data.choices[0]?.message?.content ?? "";

  // Strip thinking blocks if present
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
  const response = await fetch(
    `http://127.0.0.1:${port}/v1/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local",
        messages,
        temperature: options?.temperature ?? CHAT_PARAMS.temperature,
        max_tokens: options?.maxTokens ?? 1024,
        stream: true,
        top_p: CHAT_PARAMS.top_p,
        top_k: CHAT_PARAMS.top_k,
        chat_template_kwargs: CHAT_PARAMS.chat_template_kwargs,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
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
  // No streaming when tools are provided (llama-server limitation)
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
        temperature: TOOL_CALL_PARAMS.temperature,
        max_tokens: 1024,
        stream: false,
        top_p: TOOL_CALL_PARAMS.top_p,
        top_k: TOOL_CALL_PARAMS.top_k,
        chat_template_kwargs: TOOL_CALL_PARAMS.chat_template_kwargs,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
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
  const response = await fetch(
    `http://127.0.0.1:${port}/v1/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local",
        messages,
        temperature: 0.1,
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
    throw new Error(`Structured output failed (${response.status}): ${text}`);
  }

  const data: ChatCompletionResponse = await response.json();
  return JSON.parse(data.choices[0].message.content!) as T;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function stripThinking(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
