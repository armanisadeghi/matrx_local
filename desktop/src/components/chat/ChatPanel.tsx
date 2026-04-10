import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
import { useChat } from "@/hooks/use-chat";
import { useAgents } from "@/hooks/use-agents";
import { useChatTts } from "@/hooks/use-chat-tts";
import { useTtsApp } from "@/contexts/TtsContext";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatWelcome } from "@/components/chat/ChatWelcome";
import { GuidedVariableInputs } from "@/components/chat/GuidedVariableInputs";
import { cn } from "@/lib/utils";
import { engine as engineAPI } from "@/lib/api";
import { loadSettings } from "@/lib/settings";
import type { EngineStatus } from "@/hooks/use-engine";
import type { ActiveAgent, AgentInfo, PromptVariable } from "@/types/agents";

type UseChatReturn = ReturnType<typeof useChat>;

interface AiStatusWarning {
  message: string;
  detail: string;
}

export interface ChatPanelProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
  tools: string[];
  compact?: boolean;
  forceLocalModel?: boolean;
  /** Pass an external useChat instance to share state with the sidebar. */
  chatState?: UseChatReturn;
}

export function ChatPanel({
  engineStatus,
  engineUrl,
  tools,
  compact = false,
  forceLocalModel = false,
  chatState: externalChat,
}: ChatPanelProps) {
  const navigate = useNavigate();
  const [aiWarning, setAiWarning] = useState<AiStatusWarning | null>(null);
  const [aiWarningDismissed, setAiWarningDismissed] = useState(false);

  useEffect(() => {
    if (compact || forceLocalModel) return;
    if (engineStatus !== "connected" || !engineUrl) return;
    engineAPI
      .getAiStatus()
      .then((status) => {
        if (!status.providers.any_available) {
          const missing = status.providers.missing;
          setAiWarning({
            message: "No AI provider API keys are configured.",
            detail: `Add at least one key (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, etc.) to the engine .env file and restart. Missing: ${missing.join(", ")}.`,
          });
        }
      })
      .catch((e) => console.warn("[chat] getAiStatus failed:", e));
  }, [engineStatus, engineUrl, compact, forceLocalModel]);

  const {
    builtins,
    userAgents,
    sharedAgents,
    isLoading: agentsLoading,
  } = useAgents({ engineUrl });
  const [activeAgent, setActiveAgent] = useState<ActiveAgent | null>(null);

  const [variableValues, setVariableValues] = useState<Record<string, string>>(
    {},
  );
  const [activeVariables, setActiveVariables] = useState<PromptVariable[]>([]);

  const internalChat = useChat({ engineUrl: externalChat ? null : engineUrl });
  const chat = externalChat ?? internalChat;

  const {
    activeConversation,
    isStreaming,
    mode,
    model,
    availableModels,
    createConversation,
    sendMessage,
    stopStreaming,
    setMode,
    setModel,
    setToolSchemas,
  } = chat;

  useEffect(() => {
    if (engineStatus !== "connected" || !engineUrl) return;
    const loadSchemas = async () => {
      try {
        const resp = await fetch(`${engineUrl}/chat/tools`);
        if (resp.ok) {
          const data = await resp.json();
          setToolSchemas(data.tools ?? []);
        }
      } catch {
        /* optional */
      }
    };
    loadSchemas();
  }, [engineStatus, engineUrl, setToolSchemas]);

  const messages = activeConversation?.messages ?? [];
  const hasMessages = messages.length > 0;

  // ── TTS read-aloud integration ──────────────────────────────────────
  const [ttsReadAloudEnabled, setTtsReadAloudEnabled] = useState(true);
  const [readingMessageId, setReadingMessageId] = useState<string | null>(null);

  useEffect(() => {
    loadSettings().then((s) => {
      setTtsReadAloudEnabled(s.ttsReadAloudEnabled);
    });
  }, []);

  let ttsActions = null;
  try {
    const [, actions] = useTtsApp();
    ttsActions = actions;
  } catch {
    // TtsProvider not mounted — read-aloud unavailable
  }

  const assistantMsgs = messages.filter((m) => m.role === "assistant");
  const lastAssistantMsg = assistantMsgs[assistantMsgs.length - 1] ?? null;
  const chatTts = useChatTts(ttsActions, lastAssistantMsg, isStreaming);

  const handleReadAloud = useCallback(
    (messageId: string, content: string) => {
      setReadingMessageId(messageId);
      chatTts.readCompleteMessage(content);
    },
    [chatTts],
  );

  const handleStopReadAloud = useCallback(() => {
    setReadingMessageId(null);
    chatTts.stopReadAloud();
  }, [chatTts]);

  useEffect(() => {
    if (!chatTts.isReadingAloud && readingMessageId) {
      setReadingMessageId(null);
    }
  }, [chatTts.isReadingAloud, readingMessageId]);

  useEffect(() => {
    if (hasMessages) {
      setActiveVariables([]);
      setVariableValues({});
      return;
    }
    if (!activeAgent || activeAgent.id === "") {
      setActiveVariables([]);
      setVariableValues({});
      return;
    }
    const vars = activeAgent.variable_defaults ?? [];
    setActiveVariables(vars);
    const defaults: Record<string, string> = {};
    vars.forEach((v) => {
      if (v.defaultValue) defaults[v.name] = v.defaultValue;
    });
    setVariableValues(defaults);
  }, [activeAgent?.id, hasMessages]);

  useEffect(() => {
    if (compact && !activeConversation) {
      createConversation();
    }
  }, []);

  const handleSuggestionClick = useCallback(
    (prompt: string) => {
      sendMessage(prompt);
    },
    [sendMessage],
  );

  const handleSend = useCallback(
    async (content: string) => {
      const submittedVars = { ...variableValues };
      setActiveVariables([]);
      setVariableValues({});
      await sendMessage(content, {
        agentId: activeAgent?.id || undefined,
        variables: submittedVars,
      });
    },
    [sendMessage, activeAgent, variableValues],
  );

  const handleVariableChange = (name: string, value: string) => {
    setVariableValues((prev) => ({ ...prev, [name]: value }));
  };

  const showWelcome = !activeConversation || messages.length === 0;
  const hasVariables = activeVariables.length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {!compact && (
        <header className="no-select flex h-12 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-medium">
              {activeConversation?.title ?? "New chat"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div
                className={`h-2 w-2 rounded-full ${
                  engineStatus === "connected"
                    ? "bg-emerald-500"
                    : engineStatus === "discovering" ||
                        engineStatus === "starting"
                      ? "bg-amber-500 animate-pulse"
                      : "bg-zinc-500"
                }`}
              />
              <span className="text-[11px] text-muted-foreground">
                {tools.length} tools
              </span>
            </div>
          </div>
        </header>
      )}

      {!compact && aiWarning && !aiWarningDismissed && (
        <div className="flex items-start gap-3 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-amber-500">
              {aiWarning.message}
            </p>
            {aiWarning.detail && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {aiWarning.detail}
              </p>
            )}
          </div>
          <button
            onClick={() => navigate("/settings?tab=api-keys")}
            className="shrink-0 whitespace-nowrap text-xs text-amber-500 underline transition-colors hover:text-amber-400"
          >
            Configure API keys →
          </button>
          <button
            onClick={() => setAiWarningDismissed(true)}
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {showWelcome ? (
          <ChatWelcome
            onSuggestionClick={handleSuggestionClick}
            toolCount={tools.length}
          />
        ) : (
          <ChatMessages
            messages={messages}
            isStreaming={isStreaming}
            ttsReadAloudEnabled={ttsReadAloudEnabled}
            readingMessageId={readingMessageId}
            onReadAloud={handleReadAloud}
            onStopReadAloud={handleStopReadAloud}
          />
        )}
      </div>

      {hasVariables && (
        <div className="max-h-[40%] overflow-y-auto px-4 pt-2">
          <GuidedVariableInputs
            variableDefaults={activeVariables}
            values={variableValues}
            onChange={handleVariableChange}
            disabled={isStreaming}
            seamless
          />
        </div>
      )}

      <div className={cn("shrink-0 px-4 pb-3", hasVariables ? "pt-0" : "pt-1")}>
        <ChatInput
          onSend={handleSend}
          onStop={stopStreaming}
          isStreaming={isStreaming}
          mode={mode}
          model={model}
          availableModels={availableModels}
          onModelChange={setModel}
          onModeChange={setMode}
          engineReady={engineStatus === "connected"}
          autoFocus={compact}
          agents={[...builtins, ...userAgents, ...sharedAgents]}
          selectedAgentId={activeAgent?.id ?? null}
          onAgentChange={(agentId) => {
            if (!agentId) {
              setActiveAgent(null);
              return;
            }
            const all: AgentInfo[] = [
              ...builtins,
              ...userAgents,
              ...sharedAgents,
            ];
            const found = all.find((a) => a.id === agentId);
            setActiveAgent(found ?? null);
          }}
          agentsLoading={agentsLoading}
        />
      </div>
    </div>
  );
}
