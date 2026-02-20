import { useState, useCallback, useRef, useEffect } from "react";
import {
  Eye,
  Pencil,
  Bold,
  Italic,
  List,
  ListOrdered,
  Link,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Minus,
  ImageIcon,
  Save,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocNote } from "@/lib/api";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface NoteEditorProps {
  note: DocNote;
  saving: boolean;
  onChange: (content: string) => void;
  onLabelChange: (label: string) => void;
}

type ViewMode = "edit" | "preview" | "split";

export function NoteEditor({
  note,
  saving,
  onChange,
  onLabelChange,
}: NoteEditorProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [content, setContent] = useState(note.content ?? "");
  const [label, setLabel] = useState(note.label);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevNoteIdRef = useRef(note.id);

  // Sync state when note changes
  useEffect(() => {
    if (note.id !== prevNoteIdRef.current) {
      setContent(note.content ?? "");
      setLabel(note.label);
      prevNoteIdRef.current = note.id;
    }
  }, [note.id, note.content, note.label]);

  const handleContentChange = useCallback(
    (value: string) => {
      setContent(value);
      onChange(value);
    },
    [onChange],
  );

  const handleLabelChange = useCallback(
    (value: string) => {
      setLabel(value);
      onLabelChange(value);
    },
    [onLabelChange],
  );

  // Toolbar insert helpers
  const insertMarkdown = useCallback(
    (before: string, after = "", placeholder = "") => {
      const ta = textareaRef.current;
      if (!ta) return;

      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const selected = content.substring(start, end) || placeholder;
      const newContent =
        content.substring(0, start) +
        before +
        selected +
        after +
        content.substring(end);

      setContent(newContent);
      onChange(newContent);

      // Restore cursor
      requestAnimationFrame(() => {
        ta.focus();
        const cursorPos = start + before.length + selected.length;
        ta.setSelectionRange(cursorPos, cursorPos);
      });
    },
    [content, onChange],
  );

  const toolbarButtons = [
    { icon: Bold, action: () => insertMarkdown("**", "**", "bold"), title: "Bold" },
    { icon: Italic, action: () => insertMarkdown("*", "*", "italic"), title: "Italic" },
    { icon: Code, action: () => insertMarkdown("`", "`", "code"), title: "Inline Code" },
    { type: "separator" as const },
    { icon: Heading1, action: () => insertMarkdown("# ", "", "Heading"), title: "H1" },
    { icon: Heading2, action: () => insertMarkdown("## ", "", "Heading"), title: "H2" },
    { icon: Heading3, action: () => insertMarkdown("### ", "", "Heading"), title: "H3" },
    { type: "separator" as const },
    { icon: List, action: () => insertMarkdown("- ", "", "item"), title: "Bullet List" },
    { icon: ListOrdered, action: () => insertMarkdown("1. ", "", "item"), title: "Numbered List" },
    { icon: Quote, action: () => insertMarkdown("> ", "", "quote"), title: "Quote" },
    { icon: Minus, action: () => insertMarkdown("\n---\n"), title: "Divider" },
    { type: "separator" as const },
    { icon: Link, action: () => insertMarkdown("[", "](url)", "text"), title: "Link" },
    { icon: ImageIcon, action: () => insertMarkdown("![", "](url)", "alt"), title: "Image" },
    {
      icon: Code,
      action: () => insertMarkdown("\n```\n", "\n```\n", "code"),
      title: "Code Block",
    },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header: title + view mode toggle */}
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <input
          value={label}
          onChange={(e) => handleLabelChange(e.target.value)}
          className="flex-1 bg-transparent text-lg font-semibold outline-none"
          placeholder="Note title..."
        />
        <div className="flex items-center gap-1">
          {saving && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground mr-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving...
            </span>
          )}
          {!saving && (
            <span className="flex items-center gap-1 text-xs text-emerald-500 mr-2">
              <Save className="h-3 w-3" />
              Saved
            </span>
          )}
          <button
            onClick={() => setViewMode("edit")}
            className={cn(
              "rounded-md px-2 py-1 text-xs transition-colors",
              viewMode === "edit"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setViewMode("split")}
            className={cn(
              "rounded-md px-2 py-1 text-xs transition-colors",
              viewMode === "split"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Split
          </button>
          <button
            onClick={() => setViewMode("preview")}
            className={cn(
              "rounded-md px-2 py-1 text-xs transition-colors",
              viewMode === "preview"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Toolbar */}
      {viewMode !== "preview" && (
        <div className="flex items-center gap-0.5 border-b px-3 py-1.5 overflow-x-auto">
          {toolbarButtons.map((btn, i) =>
            "type" in btn && btn.type === "separator" ? (
              <div key={i} className="w-px h-4 bg-border mx-1" />
            ) : (
              <button
                key={i}
                onClick={"action" in btn ? btn.action : undefined}
                title={"title" in btn ? btn.title : ""}
                className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                {"icon" in btn && <btn.icon className="h-3.5 w-3.5" />}
              </button>
            ),
          )}
        </div>
      )}

      {/* Editor / Preview */}
      <div className="flex-1 flex overflow-hidden">
        {(viewMode === "edit" || viewMode === "split") && (
          <div
            className={cn(
              "flex-1 overflow-hidden",
              viewMode === "split" && "border-r",
            )}
          >
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              className="h-full w-full resize-none bg-transparent p-4 font-mono text-sm outline-none"
              placeholder="Start writing..."
              spellCheck={false}
            />
          </div>
        )}

        {(viewMode === "preview" || viewMode === "split") && (
          <div className="flex-1 overflow-auto p-4">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
