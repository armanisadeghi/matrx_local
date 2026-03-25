import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useLlmApp } from "@/contexts/LlmContext";
import type { EngineStatus } from "@/hooks/use-engine";

interface QuickLocalChatModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engineStatus: EngineStatus;
  engineUrl: string | null;
  tools: string[];
}

export function QuickLocalChatModal({
  open,
  onOpenChange,
  engineStatus,
  engineUrl,
  tools,
}: QuickLocalChatModalProps) {
  const [llmState] = useLlmApp();
  const serverRunning = llmState.serverStatus?.running ?? false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[70vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2">
          <DialogTitle>Quick Local Chat</DialogTitle>
          {!serverRunning && (
            <DialogDescription className="text-amber-500">
              Local LLM server is not running. Start it from the toolbar or Local
              Models page.
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatPanel
            engineStatus={engineStatus}
            engineUrl={engineUrl}
            tools={tools}
            compact
            forceLocalModel
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
