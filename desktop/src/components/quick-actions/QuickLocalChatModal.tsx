import { useEffect, useRef } from "react";
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
  const [llmState, llmActions] = useLlmApp();
  const serverRunning = llmState.serverStatus?.running ?? false;
  const hasModels = llmState.downloadedModels.length > 0;
  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (open && !serverRunning && !llmState.isStarting && hasModels && !autoStartedRef.current) {
      autoStartedRef.current = true;
      const model = llmState.downloadedModels[0];
      llmActions.startServer(model.filename, 0).catch(() => {});
    }
    if (!open) {
      autoStartedRef.current = false;
    }
  }, [open, serverRunning, llmState.isStarting, hasModels, llmState.downloadedModels, llmActions]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[70vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2">
          <DialogTitle>Quick Local AI Chat</DialogTitle>
          {!serverRunning && !llmState.isStarting && !hasModels && (
            <DialogDescription className="text-amber-500">
              No local AI models downloaded. Visit the Local Models page to get started.
            </DialogDescription>
          )}
          {llmState.isStarting && (
            <DialogDescription className="text-sky-500">
              Starting local AI engine...
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
