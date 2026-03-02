/**
 * Chat state management hook.
 *
 * Manages conversations, messages, and streaming AI responses via the
 * matrx-ai engine (NDJSON streaming over /chat/ai/api/ai/chat).
 * Conversations are persisted to localStorage.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import supabase from "@/lib/supabase";

// ---- Types ----

export type ChatMode = "chat" | "co-work" | "code";

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolCallResult {
  tool_call_id: string;
  type: "success" | "error";
  output: string;
  metadata?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  tool_calls?: ToolCall[];
  tool_results?: ToolCallResult[];
  model?: string;
  isStreaming?: boolean;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  mode: ChatMode;
  model: string;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  category: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface ModelOption {
  id: string;           // API model name — sent as ai_model_id in requests
  label: string;        // Display name
  provider: string;     // anthropic | openai | google | groq | together | xai | cerebras
  default?: boolean;
  is_primary?: boolean;
  is_premium?: boolean;
  capabilities?: string[];
  context_window?: number;
}

// ---- Constants ----

const STORAGE_KEY = "matrx-chat-conversations";
const MAX_CONVERSATIONS = 100;

// Fallback models used before/if the engine responds with live DB models.
// These match real names in the DB so they work immediately.
export const FALLBACK_MODELS: ModelOption[] = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic", default: true },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic" },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", provider: "openai" },
  { id: "gemini-2.5-pro-preview-06-05", label: "Gemini 2.5 Pro", provider: "google" },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", provider: "groq" },
];

// ---- Helpers ----

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveConversations(conversations: Conversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS)));
  } catch {
    // Storage full — silently degrade
  }
}

function generateTitle(content: string): string {
  const cleaned = content.replace(/\n/g, " ").trim();
  return cleaned.length <= 50 ? cleaned : cleaned.slice(0, 47) + "...";
}

function groupByDate(conversations: Conversation[]): Record<string, Conversation[]> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const monthAgo = new Date(today.getTime() - 30 * 86400000);
  const groups: Record<string, Conversation[]> = {};

  for (const conv of conversations) {
    const d = new Date(conv.updated_at);
    let group: string;
    if (d >= today) group = "Today";
    else if (d >= yesterday) group = "Yesterday";
    else if (d >= weekAgo) group = "Previous 7 days";
    else if (d >= monthAgo) group = "Previous 30 days";
    else group = "Older";

    if (!groups[group]) groups[group] = [];
    groups[group].push(conv);
  }

  return groups;
}

/** Convert our ChatMessage history to the wire format matrx-ai expects. */
function toApiMessages(messages: ChatMessage[]): Array<{role: string; content: Array<{type: string; text: string}>}> {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role,
      content: [{ type: "text", text: m.content }],
    }));
}

// ---- Hook ----

export interface UseChatOptions {
  engineUrl: string | null;
}

export function useChat({ engineUrl }: UseChatOptions) {
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    loadConversations().sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )
  );
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [mode, setMode] = useState<ChatMode>("chat");
  const [model, setModel] = useState(FALLBACK_MODELS[0].id);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const [toolSchemas, setToolSchemas] = useState<ToolSchema[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Load live models from DB via engine
  useEffect(() => {
    if (!engineUrl) return;

    const load = async () => {
      try {
        const resp = await fetch(`${engineUrl}/chat/models`);
        if (!resp.ok) return;
        const data = await resp.json() as { models: Array<{
          name: string; common_name: string; provider: string;
          is_primary: boolean; is_premium: boolean;
          capabilities: string[]; context_window: number;
        }>; source: string };
        if (!data.models?.length) return;

        const mapped: ModelOption[] = data.models.map((m, i) => ({
          id: m.name,
          label: m.common_name,
          provider: m.provider,
          is_primary: m.is_primary,
          is_premium: m.is_premium,
          capabilities: m.capabilities,
          context_window: m.context_window,
          default: i === 0,
        }));

        setAvailableModels(mapped);
        // If current model isn't in the new list, switch to first
        setModel((prev) => mapped.find((m) => m.id === prev) ? prev : mapped[0].id);
      } catch {
        // Keep fallback models if engine unreachable
      }
    };

    load();
  }, [engineUrl]);

  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  const activeConversation = conversations.find((c) => c.id === activeConversationId) ?? null;

  const createConversation = useCallback(
    (initialMode?: ChatMode): Conversation => {
      const conv: Conversation = {
        id: generateId(),
        title: "New conversation",
        mode: initialMode ?? mode,
        model,
        messages: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setConversations((prev) => [conv, ...prev]);
      setActiveConversationId(conv.id);
      return conv;
    },
    [mode, model]
  );

  const selectConversation = useCallback((id: string | null) => {
    setActiveConversationId(id);
    if (id) {
      const conv = loadConversations().find((c) => c.id === id);
      if (conv) {
        setMode(conv.mode);
        setModel(conv.model);
      }
    }
  }, []);

  const deleteConversation = useCallback(
    (id: string) => {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) setActiveConversationId(null);
    },
    [activeConversationId]
  );

  const renameConversation = useCallback((id: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title, updated_at: new Date().toISOString() } : c))
    );
  }, []);

  const sendMessage = useCallback(
    async (
      content: string,
      options?: {
        agentId?: string;
        variables?: Record<string, string>;
      }
    ) => {
      if (!content.trim() || isStreaming) return;
      if (!engineUrl) return;

      // Abort any previous stream
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      // Ensure we have a conversation
      let convId = activeConversationId;
      let existingMessages: ChatMessage[] = [];

      setConversations((prev) => {
        if (!convId) return prev;
        const c = prev.find((x) => x.id === convId);
        if (c) existingMessages = c.messages;
        return prev;
      });

      if (!convId) {
        const conv = createConversation();
        convId = conv.id;
        existingMessages = [];
      } else {
        const conv = loadConversations().find((c) => c.id === convId);
        existingMessages = conv?.messages ?? [];
      }

      const userMsg: ChatMessage = {
        id: generateId(),
        role: "user",
        content: content.trim(),
        timestamp: new Date().toISOString(),
      };

      // Add user message; set conversation title on first message
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c;
          const isFirst = c.messages.length === 0;
          return {
            ...c,
            title: isFirst ? generateTitle(content) : c.title,
            messages: [...c.messages, userMsg],
            updated_at: new Date().toISOString(),
          };
        })
      );

      // Add placeholder assistant message
      const assistantMsgId = generateId();
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        model,
        isStreaming: true,
      };

      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? { ...c, messages: [...c.messages, assistantMsg], updated_at: new Date().toISOString() }
            : c
        )
      );

      setIsStreaming(true);

      const updateAssistant = (patch: Partial<ChatMessage>) => {
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c;
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantMsgId ? { ...m, ...patch } : m
              ),
              updated_at: new Date().toISOString(),
            };
          })
        );
      };

      let accumulated = "";

      try {
        // Get current Supabase JWT; fall back to local API key for pre-login use
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? import.meta.env.VITE_ENGINE_API_KEY ?? "";

        // Build message history including the new user message
        const apiMessages = toApiMessages([...existingMessages, userMsg]);

        // Build request body — use agent endpoint when an agent is selected
        const hasAgent = !!options?.agentId;
        const requestBody: Record<string, unknown> = {
          ai_model_id: model,
          messages: apiMessages,
          stream: true,
          max_iterations: 20,
        };
        if (hasAgent) {
          requestBody.prompt_id = options!.agentId;
        }
        if (options?.variables && Object.keys(options.variables).length > 0) {
          requestBody.variables = options.variables;
        }

        const resp = await fetch(`${engineUrl}/chat/ai/api/ai/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(requestBody),
          signal: abort.signal,
        });

        if (!resp.ok || !resp.body) {
          const errText = await resp.text().catch(() => `HTTP ${resp.status}`);
          updateAssistant({ content: `Error: ${errText}`, isStreaming: false, error: errText });
          setIsStreaming(false);
          return;
        }

        // Read NDJSON stream
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
              const event = JSON.parse(trimmed) as {
                event: string;
                data?: Record<string, unknown>;
              };

              switch (event.event) {
                case "chunk": {
                  const text = (event.data as { text?: string })?.text ?? "";
                  accumulated += text;
                  updateAssistant({ content: accumulated, isStreaming: true });
                  break;
                }
                case "completion": {
                  // Final output from completion payload
                  const output = (event.data as { output?: string })?.output;
                  if (output && !accumulated) accumulated = output;
                  break;
                }
                case "error": {
                  const msg = (event.data as { message?: string })?.message ?? "Unknown error";
                  updateAssistant({ content: accumulated || msg, isStreaming: false, error: msg });
                  break;
                }
                case "end":
                  break;
              }
            } catch {
              // Malformed line — skip
            }
          }
        }

        updateAssistant({ content: accumulated, isStreaming: false });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          updateAssistant({ isStreaming: false });
        } else {
          const msg = err instanceof Error ? err.message : "Connection error";
          updateAssistant({
            content: accumulated || `Failed to reach engine: ${msg}`,
            isStreaming: false,
            error: msg,
          });
        }
      } finally {
        setIsStreaming(false);
      }
    },
    [activeConversationId, createConversation, engineUrl, isStreaming, model] // options excluded — stable ref via useCallback
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setConversations((prev) =>
      prev.map((c) => ({
        ...c,
        messages: c.messages.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
      }))
    );
  }, []);

  const clearConversations = useCallback(() => {
    setConversations([]);
    setActiveConversationId(null);
  }, []);

  return {
    conversations,
    activeConversation,
    activeConversationId,
    isStreaming,
    mode,
    model,
    toolSchemas,
    availableModels,
    groupedConversations: groupByDate(conversations),

    createConversation,
    selectConversation,
    deleteConversation,
    renameConversation,
    sendMessage,
    stopStreaming,
    clearConversations,
    setMode,
    setModel,
    setToolSchemas,
  };
}
