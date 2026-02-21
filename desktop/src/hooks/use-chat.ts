/**
 * Chat state management hook.
 *
 * Manages conversations, messages, and tool call state.
 * Stores conversations in localStorage for persistence.
 * Designed for future API integration (streaming, tool execution).
 */

import { useState, useCallback, useEffect, useRef } from "react";

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

// ---- Constants ----

const STORAGE_KEY = "matrx-chat-conversations";
const MAX_CONVERSATIONS = 100;

const AVAILABLE_MODELS = [
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", default: true },
  { id: "claude-opus-4-20250514", label: "Claude Opus 4" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
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
    // Keep only the most recent conversations
    const trimmed = conversations.slice(0, MAX_CONVERSATIONS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage full — silently degrade
  }
}

function generateTitle(content: string): string {
  // Use the first message content, trimmed to 50 chars
  const cleaned = content.replace(/\n/g, " ").trim();
  if (cleaned.length <= 50) return cleaned;
  return cleaned.slice(0, 47) + "...";
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

// ---- Hook ----

export function useChat() {
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    loadConversations().sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )
  );
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [mode, setMode] = useState<ChatMode>("chat");
  const [model, setModel] = useState(AVAILABLE_MODELS[0].id);
  const [toolSchemas, setToolSchemas] = useState<ToolSchema[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Persist conversations on change
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
    // If selecting an existing conversation, restore its mode and model
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
      if (activeConversationId === id) {
        setActiveConversationId(null);
      }
    },
    [activeConversationId]
  );

  const renameConversation = useCallback((id: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, title, updated_at: new Date().toISOString() } : c
      )
    );
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      let convId = activeConversationId;

      // Auto-create conversation on first message
      if (!convId) {
        const conv = createConversation();
        convId = conv.id;
      }

      const userMessage: ChatMessage = {
        id: generateId(),
        role: "user",
        content: content.trim(),
        timestamp: new Date().toISOString(),
      };

      // Add user message and update title if first message
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c;
          const isFirst = c.messages.length === 0;
          return {
            ...c,
            title: isFirst ? generateTitle(content) : c.title,
            messages: [...c.messages, userMessage],
            updated_at: new Date().toISOString(),
          };
        })
      );

      // Simulate assistant response (placeholder for API integration)
      setIsStreaming(true);

      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        model,
        isStreaming: true,
      };

      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? { ...c, messages: [...c.messages, assistantMessage], updated_at: new Date().toISOString() }
            : c
        )
      );

      // Simulate streaming with a placeholder response
      const placeholderResponse =
        "I'm the AI Matrx assistant. The chat API is not yet connected, but the UI is fully functional. " +
        "Once connected, I'll be able to use all 73 tools available on your local system — " +
        "file operations, shell execution, browser automation, network discovery, and more.";

      let accumulated = "";
      for (let i = 0; i < placeholderResponse.length; i += 3) {
        await new Promise((r) => setTimeout(r, 15));
        accumulated = placeholderResponse.slice(0, i + 3);

        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c;
            const msgs = [...c.messages];
            const lastIdx = msgs.length - 1;
            if (msgs[lastIdx]?.id === assistantMessage.id) {
              msgs[lastIdx] = { ...msgs[lastIdx], content: accumulated, isStreaming: true };
            }
            return { ...c, messages: msgs };
          })
        );
      }

      // Finalize
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c;
          const msgs = [...c.messages];
          const lastIdx = msgs.length - 1;
          if (msgs[lastIdx]?.id === assistantMessage.id) {
            msgs[lastIdx] = {
              ...msgs[lastIdx],
              content: placeholderResponse,
              isStreaming: false,
            };
          }
          return { ...c, messages: msgs, updated_at: new Date().toISOString() };
        })
      );

      setIsStreaming(false);
    },
    [activeConversationId, createConversation, model]
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    // Mark any streaming messages as complete
    setConversations((prev) =>
      prev.map((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.isStreaming ? { ...m, isStreaming: false } : m
        ),
      }))
    );
  }, []);

  const clearConversations = useCallback(() => {
    setConversations([]);
    setActiveConversationId(null);
  }, []);

  const groupedConversations = groupByDate(conversations);

  return {
    // State
    conversations,
    activeConversation,
    activeConversationId,
    isStreaming,
    mode,
    model,
    toolSchemas,
    groupedConversations,
    availableModels: AVAILABLE_MODELS,

    // Actions
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
