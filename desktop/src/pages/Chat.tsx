import { useState, useEffect, useCallback } from "react";
import { useChat } from "@/hooks/use-chat";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatWelcome } from "@/components/chat/ChatWelcome";
import type { EngineStatus } from "@/hooks/use-engine";

interface ChatPageProps {
  engineStatus: EngineStatus;
  engineUrl: string | null;
  tools: string[];
}

export function Chat({ engineStatus, engineUrl, tools }: ChatPageProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
  } = useChat();

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
        // Tool schemas are optional — chat works without them
      }
    };

    loadSchemas();
  }, [engineStatus, engineUrl, setToolSchemas]);

  const handleNewChat = useCallback(() => {
    createConversation();
  }, [createConversation]);

  const handleSuggestionClick = useCallback(
    (prompt: string) => {
      sendMessage(prompt);
    },
    [sendMessage]
  );

  const messages = activeConversation?.messages ?? [];
  const showWelcome = !activeConversation || messages.length === 0;

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

        {/* Messages or Welcome */}
        {showWelcome ? (
          <ChatWelcome
            onSuggestionClick={handleSuggestionClick}
            toolCount={tools.length}
          />
        ) : (
          <ChatMessages messages={messages} isStreaming={isStreaming} />
        )}

        {/* Input Area */}
        <ChatInput
          onSend={sendMessage}
          onStop={stopStreaming}
          isStreaming={isStreaming}
          mode={mode}
          model={model}
          availableModels={availableModels}
          onModelChange={setModel}
          onModeChange={setMode}
          disabled={engineStatus !== "connected"}
        />
      </div>
    </div>
  );
}
