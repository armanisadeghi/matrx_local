import { useState, useCallback } from "react";
import { useChat } from "@/hooks/use-chat";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { ChatPanel } from "@/components/chat/ChatPanel";
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
    activeConversationId,
    groupedConversations,
    createConversation,
    selectConversation,
    deleteConversation,
    renameConversation,
  } = useChat({ engineUrl });

  const handleNewChat = useCallback(() => {
    createConversation();
  }, [createConversation]);

  return (
    <div className="flex h-full overflow-hidden">
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
      <ChatPanel
        engineStatus={engineStatus}
        engineUrl={engineUrl}
        tools={tools}
      />
    </div>
  );
}
