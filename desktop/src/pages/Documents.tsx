/**
 * Documents page — full document management with folder tree, markdown editor,
 * sync status, version history, sharing, and directory mappings.
 */

import { useState, useCallback } from "react";
import {
  Plus,
  Search,
  Share2,
  FolderSync,
  History,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDocuments } from "@/hooks/use-documents";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import { FolderTree } from "@/components/documents/FolderTree";
import { NoteList } from "@/components/documents/NoteList";
import { NoteEditor } from "@/components/documents/NoteEditor";
import { SyncStatusBar } from "@/components/documents/SyncStatus";
import { VersionHistory } from "@/components/documents/VersionHistory";
import { ShareDialog } from "@/components/documents/ShareDialog";
import { DirectoryMappings } from "@/components/documents/DirectoryMappings";
import type { EngineStatus } from "@/hooks/use-engine";

interface DocumentsProps {
  engineStatus: EngineStatus;
  userId: string | null;
}

export function Documents({ engineStatus, userId }: DocumentsProps) {
  const docs = useDocuments(userId);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<
    "versions" | "tags" | "info"
  >("versions");
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showMappingsDialog, setShowMappingsDialog] = useState(false);
  const [searchInput, setSearchInput] = useState("");

  // Realtime sync
  useRealtimeSync({
    userId,
    enabled: engineStatus === "connected" && !!userId,
    onNoteChange: useCallback(
      (_noteId: string, _eventType: string) => {
        docs.loadTree();
        docs.loadNotes();
        if (docs.activeNote) {
          docs.selectNote(docs.activeNote.id);
        }
      },
      [docs],
    ),
    onFolderChange: useCallback(() => {
      docs.loadTree();
    }, [docs]),
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    docs.search(searchInput);
  };

  const handleCreateNote = async () => {
    const folderName =
      docs.tree?.folders.find((f) => f.id === docs.activeFolderId)?.name ??
      "General";
    await docs.createNote({
      label: "New Note",
      content: "",
      folder_name: folderName,
      folder_id: docs.activeFolderId ?? undefined,
    });
  };

  const handleContentChange = useCallback(
    (content: string) => {
      if (docs.activeNote) {
        docs.updateNote(docs.activeNote.id, { content });
      }
    },
    [docs],
  );

  const handleLabelChange = useCallback(
    (label: string) => {
      if (docs.activeNote) {
        docs.updateNote(docs.activeNote.id, { label }, true);
      }
    },
    [docs],
  );

  if (engineStatus !== "connected") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Waiting for engine connection...</p>
          <p className="text-xs mt-1">
            Documents require the engine to be running
          </p>
        </div>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Sign in to access your documents</p>
        </div>
      </div>
    );
  }

  const allFolders = docs.tree?.folders ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className="rounded-md p-1.5 hover:bg-accent"
            title={showSidebar ? "Hide sidebar" : "Show sidebar"}
          >
            {showSidebar ? (
              <PanelLeftClose className="h-4 w-4" />
            ) : (
              <PanelLeftOpen className="h-4 w-4" />
            )}
          </button>
          <h1 className="text-sm font-semibold">Documents</h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <form onSubmit={handleSearch} className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search notes..."
              className="rounded-md border bg-background pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary w-48"
            />
          </form>

          {/* Action buttons */}
          <button
            onClick={handleCreateNote}
            className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            New Note
          </button>

          <button
            onClick={() => setShowMappingsDialog(true)}
            className="rounded-md p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground"
            title="Directory mappings"
          >
            <FolderSync className="h-4 w-4" />
          </button>

          {docs.activeNote && (
            <>
              <button
                onClick={() => {
                  docs.loadShares();
                  setShowShareDialog(true);
                }}
                className="rounded-md p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground"
                title="Share"
              >
                <Share2 className="h-4 w-4" />
              </button>

              <button
                onClick={() => setShowRightPanel(!showRightPanel)}
                className={cn(
                  "rounded-md p-1.5 hover:bg-accent transition-colors",
                  showRightPanel
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                title="Version history"
              >
                <History className="h-4 w-4" />
              </button>

              <button
                onClick={() => {
                  if (docs.activeNote) {
                    if (
                      confirm(
                        `Delete "${docs.activeNote.label}"? This can be undone from the web.`,
                      )
                    ) {
                      docs.deleteNote(docs.activeNote.id);
                    }
                  }
                }}
                className="rounded-md p-1.5 hover:bg-accent text-muted-foreground hover:text-destructive"
                title="Delete note"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Sync status bar */}
      <div className="border-b px-4 py-1.5">
        <SyncStatusBar
          status={docs.syncStatus}
          syncing={docs.syncing}
          onSync={() => docs.triggerSync()}
        />
      </div>

      {/* Conflict banner */}
      {docs.syncStatus && docs.syncStatus.conflict_count > 0 && (
        <div className="flex items-center gap-2 border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          <span>
            {docs.syncStatus.conflict_count} sync conflict
            {docs.syncStatus.conflict_count > 1 ? "s" : ""} detected.
            Review in the sync status panel.
          </span>
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: folders + note list */}
        {showSidebar && (
          <div className="flex w-72 shrink-0 flex-col border-r overflow-hidden">
            {/* Folder tree */}
            <div className="border-b p-3 overflow-auto max-h-[40%]">
              <FolderTree
                folders={allFolders}
                activeFolderId={docs.activeFolderId}
                unfiledCount={docs.tree?.unfiled_notes ?? 0}
                onSelect={docs.selectFolder}
                onCreate={docs.createFolder}
                onDelete={docs.deleteFolder}
              />
            </div>

            {/* Note list */}
            <div className="flex-1 overflow-auto p-2">
              <NoteList
                notes={docs.notes}
                activeNoteId={docs.activeNote?.id ?? null}
                onSelect={docs.selectNote}
              />
            </div>
          </div>
        )}

        {/* Center: editor */}
        <div className="flex-1 overflow-hidden">
          {docs.activeNote ? (
            <NoteEditor
              note={docs.activeNote}
              saving={docs.saving}
              onChange={handleContentChange}
              onLabelChange={handleLabelChange}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Select a note or create a new one</p>
                <button
                  onClick={handleCreateNote}
                  className="mt-3 flex items-center gap-1 mx-auto rounded-md bg-primary/10 px-3 py-1.5 text-sm text-primary hover:bg-primary/20"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Note
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right panel: versions, tags, info */}
        {showRightPanel && docs.activeNote && (
          <div className="w-60 shrink-0 border-l overflow-auto p-3">
            {/* Tab buttons */}
            <div className="flex items-center gap-1 mb-3">
              <button
                onClick={() => setRightPanelTab("versions")}
                className={cn(
                  "rounded-md px-2 py-1 text-xs transition-colors",
                  rightPanelTab === "versions"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                History
              </button>
              <button
                onClick={() => setRightPanelTab("tags")}
                className={cn(
                  "rounded-md px-2 py-1 text-xs transition-colors",
                  rightPanelTab === "tags"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Tags
              </button>
              <button
                onClick={() => setRightPanelTab("info")}
                className={cn(
                  "rounded-md px-2 py-1 text-xs transition-colors",
                  rightPanelTab === "info"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Info
              </button>
            </div>

            {rightPanelTab === "versions" && (
              <VersionHistory
                versions={docs.versions}
                onRevert={(v) => docs.revertNote(docs.activeNote!.id, v)}
              />
            )}

            {rightPanelTab === "tags" && (
              <div className="text-xs">
                <h4 className="font-medium text-muted-foreground mb-2">Tags</h4>
                <div className="flex flex-wrap gap-1">
                  {docs.activeNote.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                    >
                      {tag}
                    </span>
                  ))}
                  {docs.activeNote.tags.length === 0 && (
                    <span className="text-muted-foreground">No tags</span>
                  )}
                </div>
              </div>
            )}

            {rightPanelTab === "info" && (
              <div className="text-xs space-y-2">
                <h4 className="font-medium text-muted-foreground">Details</h4>
                <div className="space-y-1.5">
                  <div>
                    <span className="text-muted-foreground">Folder: </span>
                    {docs.activeNote.folder_name}
                  </div>
                  <div>
                    <span className="text-muted-foreground">File: </span>
                    <span className="font-mono">
                      {docs.activeNote.file_path ?? "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Sync version: </span>
                    {docs.activeNote.sync_version}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Created: </span>
                    {new Date(docs.activeNote.created_at).toLocaleString()}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Updated: </span>
                    {new Date(docs.activeNote.updated_at).toLocaleString()}
                  </div>
                  {docs.activeNote.content_hash && (
                    <div>
                      <span className="text-muted-foreground">Hash: </span>
                      <span className="font-mono">
                        {docs.activeNote.content_hash.substring(0, 12)}...
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Share dialog */}
      {showShareDialog && docs.activeNote && userId && (
        <ShareDialog
          noteId={docs.activeNote.id}
          folderId={null}
          userId={userId}
          shares={docs.shares}
          onClose={() => setShowShareDialog(false)}
          onUpdate={() => docs.loadShares()}
        />
      )}

      {/* Directory mappings dialog */}
      {showMappingsDialog && userId && (
        <DirectoryMappings
          userId={userId}
          folders={allFolders}
          onClose={() => setShowMappingsDialog(false)}
        />
      )}

      {/* Error toast */}
      {docs.error && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-lg">
          {docs.error}
        </div>
      )}
    </div>
  );
}
