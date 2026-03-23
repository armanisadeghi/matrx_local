import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
import { useChat } from "@/hooks/use-chat";
import { useAgents } from "@/hooks/use-agents";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatWelcome } from "@/components/chat/ChatWelcome";
import { GuidedVariableInputs } from "@/components/chat/GuidedVariableInputs";
import { cn } from "@/lib/utils";
import { engine as engineAPI } from "@/lib/api";
import type { EngineStatus } from "@/hooks/use-engine";
import type { ActiveAgent, AgentInfo, PromptVariable } from "@/types/agents";

interface ChatPageProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
  tools: string[];
}

interface AiStatusWarning {
  message: string;
  detail: string;
}

export function Chat({ engineStatus, engineUrl, tools }: ChatPageProps) {
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [aiWarning, setAiWarning] = useState<AiStatusWarning | null>(null);
  const [aiWarningDismissed, setAiWarningDismissed] = useState(false);

  // Check AI provider status once the engine is connected
  useEffect(() => {
    if (engineStatus !== "connected" || !engineUrl) return;
    engineAPI.getAiStatus()
      .then((status) => {
        const warnings: string[] = [];
        if (!status.providers.any_available) {
          warnings.push("No AI provider API keys are configured on the engine.");
        }
        if (!status.jwt_validation.configured) {
          warnings.push("SUPABASE_JWT_SECRET is not set — user tokens cannot be validated.");
        }
        if (warnings.length > 0) {
          const missing = status.providers.missing;
          setAiWarning({
            message: warnings[0],
            detail: !status.providers.any_available
              ? `Add at least one key (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, etc.) to the engine .env file and restart. Missing: ${missing.join(", ")}.`
              : warnings[1] ?? "",
          });
        }
      })
      .catch(() => {
        // Non-critical — engine might not support this endpoint yet
      });
  }, [engineStatus, engineUrl]);

  // ---- Agent state ----
  const { builtins, userAgents, sharedAgents, isLoading: agentsLoading } = useAgents({ engineUrl });
  const [activeAgent, setActiveAgent] = useState<ActiveAgent | null>(null);

  // ---- Variable state ----
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [activeVariables, setActiveVariables] = useState<PromptVariable[]>([]);

  const {
    conversations,
    activeConversation,
    activeConversationId,
    isStreaming,
    mode,
    model,
    groupedConversations,
    availableModels,
    createConversation,
    selectConversation,
    deleteConversation,
    renameConversation,
    sendMessage,
    stopStreaming,
    setMode,
    setModel,
    setToolSchemas,
  } = useChat({ engineUrl });

  // Load tool schemas from engine on mount
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
        // Tool schemas are optional
      }
    };
    loadSchemas();
  }, [engineStatus, engineUrl, setToolSchemas]);

  // When agent changes, populate variables from its defaults. Clear vars on new conversation start.
  const messages = activeConversation?.messages ?? [];
  const hasMessages = messages.length > 0;

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

  const handleNewChat = useCallback(() => {
    createConversation();
  }, [createConversation]);

  const handleSuggestionClick = useCallback(
    (prompt: string) => {
      sendMessage(prompt);
    },
    [sendMessage]
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
    [sendMessage, activeAgent, variableValues]
  );

  const handleVariableChange = (name: string, value: string) => {
    setVariableValues((prev) => ({ ...prev, [name]: value }));
  };

  const showWelcome = !activeConversation || messages.length === 0;
  const hasVariables = activeVariables.length > 0;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Chat Sidebar */}
      <ChatSidebar
        conversations={conversations}
        groupedConversations={groupedConversations}
        activeConversationId={activeConversationId}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((p) => !p)}
        onSelect={selectConversation}
        onNew={handleNewChat}
        onDelete={deleteConversation}
        onRename={renameConversation}
      />

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col overflow-hidden bg-background">
        {/* Chat Header */}
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
                    : engineStatus === "discovering" || engineStatus === "starting"
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

        {/* AI provider warning banner */}
        {aiWarning && !aiWarningDismissed && (
          <div className="flex items-start gap-3 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-amber-500">{aiWarning.message}</p>
              {aiWarning.detail && (
                <p className="mt-0.5 text-xs text-muted-foreground">{aiWarning.detail}</p>
              )}
            </div>
            <button
              onClick={() => navigate("/settings?tab=api-keys")}
              className="shrink-0 whitespace-nowrap text-xs text-amber-500 hover:text-amber-400 underline transition-colors"
            >
              Configure API keys →
            </button>
            <button
              onClick={() => setAiWarningDismissed(true)}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Messages or Welcome */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {showWelcome ? (
            <ChatWelcome
              onSuggestionClick={handleSuggestionClick}
              toolCount={tools.length}
            />
          ) : (
            <ChatMessages messages={messages} isStreaming={isStreaming} />
          )}
        </div>

        {/* Variable inputs — shown above chat input when agent has vars */}
        {hasVariables && (
          <div className="px-4 pt-2">
            <GuidedVariableInputs
              variableDefaults={activeVariables}
              values={variableValues}
              onChange={handleVariableChange}
              disabled={isStreaming}
              seamless
            />
          </div>
        )}

        {/* Input Area — shrink-0 so it never gets squeezed */}
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
            agents={[...builtins, ...userAgents, ...sharedAgents]}
            selectedAgentId={activeAgent?.id ?? null}
            onAgentChange={(agentId) => {
              if (!agentId) {
                setActiveAgent(null);
                return;
              }
              const all: AgentInfo[] = [...builtins, ...userAgents, ...sharedAgents];
              const found = all.find((a) => a.id === agentId);
              setActiveAgent(found ?? null);
            }}
            agentsLoading={agentsLoading}
          />
        </div>
      </div>
    </div>
  );
}
