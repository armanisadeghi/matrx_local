import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mic, Square } from "lucide-react";
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
  const { isRecording, isProcessingTail, fullTranscript, activeModel } =
    transcriptionState;

  const canRecord = !!activeModel && !isProcessingTail;

  const handleToggleRecording = useCallback(async () => {
    if (isRecording) {
      await transcriptionActions.stopRecording();
    } else {
      await transcriptionActions.startRecording();
    }
  }, [isRecording, transcriptionActions]);

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
    [isRecording, transcriptionActions, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Quick Transcript</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          <button
            onClick={handleToggleRecording}
            disabled={!canRecord}
            className={`flex h-16 w-16 items-center justify-center rounded-full transition-all ${
              isRecording
                ? "bg-destructive text-destructive-foreground animate-pulse"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            } disabled:opacity-50`}
          >
            {isRecording ? (
              <Square className="h-6 w-6" />
            ) : (
              <Mic className="h-6 w-6" />
            )}
          </button>
          <p className="text-xs text-muted-foreground">
            {!activeModel
              ? "No transcription model loaded. Set up in Voice tab first."
              : isRecording
                ? "Recording... click to stop"
                : isProcessingTail
                  ? "Processing remaining audio..."
                  : "Click to start recording"}
          </p>
        </div>
        <div className="max-h-48 min-h-[6rem] overflow-auto rounded-lg border bg-muted/30 p-3">
          {fullTranscript ? (
            <p className="text-sm">{fullTranscript}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              {savedText ? "Transcript copied to clipboard." : "Transcript will appear here..."}
            </p>
          )}
        </div>
        <DialogFooter>
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
