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
  const chatState = useChat({ engineUrl });

  const handleNewChat = useCallback(() => {
    chatState.createConversation();
  }, [chatState]);

  return (
    <div className="flex h-full overflow-hidden">
      <ChatSidebar
        conversations={chatState.conversations}
        groupedConversations={chatState.groupedConversations}
        activeConversationId={chatState.activeConversationId}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((p) => !p)}
        onSelect={chatState.selectConversation}
        onNew={handleNewChat}
        onDelete={chatState.deleteConversation}
        onRename={chatState.renameConversation}
      />
      <ChatPanel
        engineStatus={engineStatus}
        engineUrl={engineUrl}
        tools={tools}
        chatState={chatState}
      />
    </div>
  );
}
