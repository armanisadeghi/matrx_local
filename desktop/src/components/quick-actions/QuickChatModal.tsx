import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChatPanel } from "@/components/chat/ChatPanel";
import type { EngineStatus } from "@/hooks/use-engine";

interface QuickChatModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engineStatus: EngineStatus;
  engineUrl: string | null;
  tools: string[];
}

export function QuickChatModal({
  open,
  onOpenChange,
  engineStatus,
  engineUrl,
  tools,
}: QuickChatModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-h-[80vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2">
          <DialogTitle>Quick Chat</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatPanel
            engineStatus={engineStatus}
            engineUrl={engineUrl}
            tools={tools}
            compact
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
