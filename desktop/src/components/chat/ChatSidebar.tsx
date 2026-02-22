import { useState } from "react";
import {
  Plus,
  Search,
  MessageSquare,
  Trash2,
  PanelLeftClose,
  PanelLeft,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Conversation } from "@/hooks/use-chat";

interface ChatSidebarProps {
  conversations: Conversation[];
  groupedConversations: Record<string, Conversation[]>;
  activeConversationId: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

export function ChatSidebar({
  groupedConversations,
  activeConversationId,
  collapsed,
  onToggle,
  onSelect,
  onNew,
  onDelete,
  onRename,
}: ChatSidebarProps) {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const dateGroups = [
    "Today",
    "Yesterday",
    "Previous 7 days",
    "Previous 30 days",
    "Older",
  ];

  const filteredGroups = Object.fromEntries(
    Object.entries(groupedConversations).map(([group, convs]) => [
      group,
      convs.filter((c) =>
        c.title.toLowerCase().includes(search.toLowerCase())
      ),
    ])
  );

  const startRename = (id: string, currentTitle: string) => {
    setEditingId(id);
    setEditTitle(currentTitle);
  };

  const commitRename = () => {
    if (editingId && editTitle.trim()) {
      onRename(editingId, editTitle.trim());
    }
    setEditingId(null);
  };

  if (collapsed) {
    return (
      <div
        className="flex h-full w-12 flex-col items-center py-3"
        style={{
          background: "var(--chat-sidebar-bg)",
          borderRight: "1px solid var(--chat-border)",
        }}
      >
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
              style={{ color: "var(--chat-sidebar-text)" }}
              onClick={onToggle}
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Open sidebar</TooltipContent>
        </Tooltip>

        <div className="mt-3">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
                style={{ color: "var(--chat-sidebar-text)" }}
                onClick={onNew}
              >
                <Plus className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">New chat</TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full w-64 flex-col"
      style={{
        background: "var(--chat-sidebar-bg)",
        borderRight: "1px solid var(--chat-border)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3">
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
          style={{ color: "var(--chat-sidebar-text)" }}
          onClick={onToggle}
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
              style={{ color: "var(--chat-sidebar-text)" }}
              onClick={onNew}
            >
              <Plus className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New chat</TooltipContent>
        </Tooltip>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            style={{ color: "var(--chat-text-faint)" }}
          />
          <input
            placeholder="Search chats..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-lg border-0 pl-8 text-xs focus:outline-none focus:ring-1"
            style={{
              background: "var(--chat-sidebar-hover)",
              color: "var(--chat-text)",
              // ring color on focus
            }}
          />
        </div>
      </div>

      {/* Conversation List */}
      <ScrollArea className="flex-1 px-1.5">
        {dateGroups.map((group) => {
          const convs = filteredGroups[group];
          if (!convs?.length) return null;

          return (
            <div key={group} className="mb-1">
              <div className="px-2 py-1.5">
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--chat-text-faint)" }}
                >
                  {group}
                </span>
              </div>
              {convs.map((conv) => {
                const isActive = activeConversationId === conv.id;
                const isHovered = hoveredId === conv.id;
                return (
                  <div
                    key={conv.id}
                    className={cn(
                      "group relative mx-1 mb-0.5 flex items-center rounded-lg px-2.5 py-2 cursor-pointer transition-colors"
                    )}
                    style={{
                      background: isActive
                        ? "var(--chat-sidebar-active)"
                        : isHovered
                        ? "var(--chat-sidebar-hover)"
                        : "transparent",
                      color: isActive
                        ? "var(--chat-sidebar-text-active)"
                        : "var(--chat-sidebar-text)",
                    }}
                    onClick={() => onSelect(conv.id)}
                    onMouseEnter={() => setHoveredId(conv.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <MessageSquare
                      className="mr-2 h-3.5 w-3.5 shrink-0"
                      style={{ opacity: 0.4 }}
                    />
                    {editingId === conv.id ? (
                      <input
                        className="flex-1 bg-transparent text-xs outline-none"
                        style={{ color: "var(--chat-text)" }}
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="flex-1 truncate text-xs">
                        {conv.title}
                      </span>
                    )}

                    {/* Action buttons on hover */}
                    {isHovered && editingId !== conv.id && (
                      <div className="absolute right-1 flex items-center gap-0.5">
                        <button
                          className="rounded p-1 transition-colors"
                          style={{ color: "var(--chat-sidebar-text)" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            startRename(conv.id, conv.title);
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          className="rounded p-1 transition-colors hover:text-red-500"
                          style={{ color: "var(--chat-sidebar-text)" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(conv.id);
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {Object.values(filteredGroups).every((g) => !g?.length) && (
          <div className="flex flex-col items-center justify-center py-8">
            <MessageSquare
              className="mb-2 h-8 w-8"
              style={{ color: "var(--chat-text-faint)", opacity: 0.3 }}
            />
            <p
              className="text-xs"
              style={{ color: "var(--chat-text-faint)" }}
            >
              {search ? "No matching chats" : "No conversations yet"}
            </p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
