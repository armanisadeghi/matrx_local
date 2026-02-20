import { FileText, Clock, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocNote } from "@/lib/api";

interface NoteListProps {
  notes: DocNote[];
  activeNoteId: string | null;
  onSelect: (noteId: string) => void;
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function NoteList({ notes, activeNoteId, onSelect }: NoteListProps) {
  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <FileText className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">No notes yet</p>
        <p className="text-xs mt-1">Create one to get started</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {notes.map((note) => (
        <button
          key={note.id}
          onClick={() => onSelect(note.id)}
          className={cn(
            "flex flex-col gap-1 rounded-md px-3 py-2.5 text-left transition-colors",
            "hover:bg-accent",
            activeNoteId === note.id && "bg-primary/10 border-l-2 border-primary",
          )}
        >
          <div className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium truncate flex-1">
              {note.label}
            </span>
          </div>
          <div className="flex items-center gap-3 pl-5.5">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {timeAgo(note.updated_at)}
            </span>
            {note.folder_name && note.folder_name !== "General" && (
              <span className="text-xs text-muted-foreground truncate">
                {note.folder_name}
              </span>
            )}
            {note.tags && note.tags.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Tag className="h-3 w-3" />
                {note.tags.length}
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
