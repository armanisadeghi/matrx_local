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
      <DialogContent className="max-w-lg" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>Quick Note</DialogTitle>
        </DialogHeader>
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
        <DialogFooter>
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
