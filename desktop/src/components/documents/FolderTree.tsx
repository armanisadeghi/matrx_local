import { useState } from "react";
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocFolder } from "@/lib/api";

interface FolderTreeProps {
  folders: DocFolder[];
  activeFolderId: string | null;
  unfiledCount: number;
  onSelect: (folderId: string | null) => void;
  onCreate: (name: string, parentId?: string) => void;
  onDelete: (folderId: string) => void;
}

export function FolderTree({
  folders,
  activeFolderId,
  unfiledCount,
  onSelect,
  onCreate,
  onDelete,
}: FolderTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewInput, setShowNewInput] = useState(false);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    if (newFolderName.trim()) {
      onCreate(newFolderName.trim());
      setNewFolderName("");
      setShowNewInput(false);
    }
  };

  const renderFolder = (folder: DocFolder, depth = 0) => {
    const hasChildren = folder.children && folder.children.length > 0;
    const isExpanded = expanded.has(folder.id);
    const isActive = activeFolderId === folder.id;

    return (
      <div key={folder.id}>
        <button
          onClick={() => onSelect(folder.id)}
          className={cn(
            "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors",
            "hover:bg-accent",
            isActive && "bg-primary/10 text-primary font-medium",
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggle(folder.id);
              }}
              className="shrink-0"
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <span className="w-3.5" />
          )}
          {isExpanded ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-amber-500" />
          )}
          <span className="truncate flex-1 text-left">{folder.name}</span>
          {folder.note_count !== undefined && folder.note_count > 0 && (
            <span className="text-xs text-muted-foreground">
              {folder.note_count}
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete folder "${folder.name}"?`)) {
                onDelete(folder.id);
              }
            }}
            className="opacity-0 group-hover:opacity-100 hover:text-destructive"
            title="Delete folder"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </button>
        {isExpanded &&
          hasChildren &&
          folder.children!.map((child) => renderFolder(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-1">
      {/* All Notes */}
      <button
        onClick={() => onSelect(null)}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
          "hover:bg-accent",
          activeFolderId === null && "bg-primary/10 text-primary font-medium",
        )}
      >
        <FileText className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">All Notes</span>
        {unfiledCount > 0 && (
          <span className="text-xs text-muted-foreground">{unfiledCount}</span>
        )}
      </button>

      {/* Folder list */}
      {folders.map((f) => renderFolder(f))}

      {/* New folder input */}
      {showNewInput ? (
        <div className="flex items-center gap-1 px-2 py-1">
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setShowNewInput(false);
            }}
            onBlur={() => {
              if (!newFolderName.trim()) setShowNewInput(false);
            }}
            placeholder="Folder name..."
            className="flex-1 bg-transparent text-sm outline-none border-b border-border"
          />
        </div>
      ) : (
        <button
          onClick={() => setShowNewInput(true)}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span>New Folder</span>
        </button>
      )}
    </div>
  );
}
