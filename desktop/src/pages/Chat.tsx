import { useState, useEffect, useCallback } from "react";
import { useChat } from "@/hooks/use-chat";
import { useAgents } from "@/hooks/use-agents";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatWelcome } from "@/components/chat/ChatWelcome";
import { GuidedVariableInputs } from "@/components/chat/GuidedVariableInputs";
import { cn } from "@/lib/utils";
import type { EngineStatus } from "@/hooks/use-engine";
import type { ActiveAgent, AgentInfo, PromptVariable } from "@/types/agents";

interface ChatPageProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
  tools: string[];
}

export function Chat({ engineStatus, engineUrl, tools }: ChatPageProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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

        {/* Input Area */}
        <div className={cn("px-4 pb-4", hasVariables ? "pt-0" : "pt-2")}>
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
