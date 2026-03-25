import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDocuments } from "@/hooks/use-documents";
import type { EngineStatus } from "@/hooks/use-engine";

interface QuickNoteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engineStatus: EngineStatus;
  userId: string | null;
}

export function QuickNoteModal({
  open,
  onOpenChange,
  engineStatus,
  userId,
}: QuickNoteModalProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const docs = useDocuments(userId, engineStatus);

  const handleSave = useCallback(async () => {
    if (!title.trim() && !content.trim()) return;
    setSaving(true);
    try {
      await docs.createNote({
        label: title.trim() || "Untitled Note",
        content: content.trim(),
      });
      setTitle("");
      setContent("");
      onOpenChange(false);
    } catch {
      /* createNote handles its own error state */
    } finally {
      setSaving(false);
    }
  }, [title, content, docs, onOpenChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave]
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setTitle("");
          setContent("");
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-0 p-0" onKeyDown={handleKeyDown}>
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
          <DialogTitle>Quick Note</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2">
          <div className="flex flex-col gap-3">
            <input
              type="text"
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
            <textarea
              placeholder="Write your note..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              className="w-full resize-none rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
        <DialogFooter className="shrink-0 px-6 py-4 border-t">
          <span className="text-xs text-muted-foreground">
            {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+Enter to save
          </span>
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
