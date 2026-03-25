import { useState, useCallback, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Square } from "lucide-react";
import type { TranscriptionState, TranscriptionActions } from "@/hooks/use-transcription";

interface QuickTranscriptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transcriptionState: TranscriptionState;
  transcriptionActions: TranscriptionActions;
}

export function QuickTranscriptModal({
  open,
  onOpenChange,
  transcriptionState,
  transcriptionActions,
}: QuickTranscriptModalProps) {
  const [savedText, setSavedText] = useState("");
  const autoStartedRef = useRef(false);
  const { isRecording, isProcessingTail, fullTranscript, activeModel } =
    transcriptionState;

  const canRecord = !!activeModel && !isProcessingTail;

  useEffect(() => {
    if (open && canRecord && !isRecording && !autoStartedRef.current) {
      autoStartedRef.current = true;
      transcriptionActions.startRecording().catch(() => {});
    }
    if (!open) {
      autoStartedRef.current = false;
    }
  }, [open, canRecord, isRecording, transcriptionActions]);

  const handleStop = useCallback(async () => {
    await transcriptionActions.stopRecording();
  }, [transcriptionActions]);

  const handleSave = useCallback(() => {
    if (fullTranscript.trim()) {
      navigator.clipboard.writeText(fullTranscript.trim()).catch(() => {});
      setSavedText(fullTranscript.trim());
    }
  }, [fullTranscript]);

  useEffect(() => {
    if (!open) {
      setSavedText("");
    }
  }, [open]);

  const handleClose = useCallback(
    async (v: boolean) => {
      if (!v && isRecording) {
        await transcriptionActions.stopRecording();
      }
      onOpenChange(v);
    },
    [isRecording, transcriptionActions, onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
          <DialogTitle>Quick Transcription</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2">
          <div className="flex flex-col items-center gap-3">
            {isRecording ? (
              <button
                onClick={handleStop}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive text-destructive-foreground animate-pulse transition-all"
              >
                <Square className="h-5 w-5" />
              </button>
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <span className="text-xs text-muted-foreground">
                  {isProcessingTail ? "..." : "Done"}
                </span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {!activeModel
                ? "No transcription model loaded. Set up in the Voice tab first."
                : isRecording
                  ? "Listening... click the button to stop"
                  : isProcessingTail
                    ? "Processing remaining audio..."
                    : fullTranscript
                      ? "Recording complete"
                      : "Starting microphone..."}
            </p>
          </div>
          <div className="mt-3 max-h-48 min-h-[6rem] overflow-auto rounded-lg border bg-muted/30 p-3">
            {fullTranscript ? (
              <p className="text-sm">{fullTranscript}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                {savedText
                  ? "Transcript copied to clipboard."
                  : "Your words will appear here as you speak..."}
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="shrink-0 px-6 py-4 border-t">
          <Button
            onClick={handleSave}
            disabled={!fullTranscript.trim()}
            size="sm"
            variant="outline"
          >
            Copy to Clipboard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
