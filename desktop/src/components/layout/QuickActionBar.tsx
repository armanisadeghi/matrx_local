import { useState, useCallback, useRef, useEffect } from "react";
import {
  Mic,
  Headphones,
  Cpu,
  Activity,
  Shield,
  Globe,
  Cloud,
  MessageSquare,
  MessageSquareDashed,
  StickyNote,
  Globe2,
  AudioLines,
  ArrowUpCircle,
  User,
  RotateCcw,
  LogOut,
  Loader2,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { QuickChatModal } from "@/components/quick-actions/QuickChatModal";
import { QuickLocalChatModal } from "@/components/quick-actions/QuickLocalChatModal";
import { QuickNoteModal } from "@/components/quick-actions/QuickNoteModal";
import { QuickScrapeModal } from "@/components/quick-actions/QuickScrapeModal";
import { QuickTranscriptModal } from "@/components/quick-actions/QuickTranscriptModal";
import { useLlmApp } from "@/contexts/LlmContext";
import { useWakeWordContext } from "@/contexts/WakeWordContext";
import { useServiceStatus } from "@/hooks/use-service-status";
import { isTauri, restartApp } from "@/lib/sidecar";
import { cn } from "@/lib/utils";
import type { EngineStatus } from "@/hooks/use-engine";
import type { TranscriptionState, TranscriptionActions } from "@/hooks/use-transcription";
import type { AutoUpdateState, AutoUpdateActions } from "@/hooks/use-auto-update";
import type { AppNotification } from "@/hooks/use-notifications";
import type { User as SupabaseUser } from "@supabase/supabase-js";

interface QuickActionBarProps {
  isRecording: boolean;
  onRecord: () => void;
  engineStatus: EngineStatus;
  engineUrl: string | null;
  tools: string[];
  onOpenMonitor: () => void;
  transcriptionState: TranscriptionState;
  transcriptionActions: TranscriptionActions;
  user: SupabaseUser | null;
  userId: string | null;
  onSignOut: () => void;
  updateState: AutoUpdateState;
  updateActions: AutoUpdateActions;
  notifications: AppNotification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismissNotification: (id: string) => void;
  onClearAllNotifications: () => void;
}

function StatusDot({ color }: { color: "green" | "amber" | "red" | "gray" }) {
  const cls = {
    green: "bg-emerald-500",
    amber: "bg-amber-500 animate-pulse",
    red: "bg-red-500",
    gray: "bg-zinc-500",
  }[color];
  return <span className={`absolute -right-0.5 -top-0.5 block h-2 w-2 rounded-full ${cls}`} />;
}

function BarButton({
  tooltip,
  onClick,
  active,
  dotColor,
  disabled,
  children,
}: {
  tooltip: string;
  onClick?: () => void;
  active?: boolean;
  dotColor?: "green" | "amber" | "red" | "gray";
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          className={cn(
            "relative flex h-7 w-7 items-center justify-center rounded-md transition-colors",
            "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            active && "text-emerald-500 hover:text-emerald-400",
            disabled && "opacity-40 pointer-events-none"
          )}
        >
          {children}
          {dotColor && <StatusDot color={dotColor} />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function Separator() {
  return <div className="mx-1.5 h-4 w-px bg-border/50" />;
}

export function QuickActionBar(props: QuickActionBarProps) {
  const {
    isRecording,
    onRecord,
    engineStatus,
    engineUrl,
    tools,
    onOpenMonitor,
    transcriptionState,
    transcriptionActions,
    user,
    userId,
    onSignOut,
    updateState,
    updateActions,
    notifications,
    unreadCount,
    onMarkRead,
    onMarkAllRead,
    onDismissNotification,
    onClearAllNotifications,
  } = props;

  const [llmState, llmActions] = useLlmApp();
  const { state: wwState, actions: wwActions } = useWakeWordContext();
  const [serviceStatus, serviceActions] = useServiceStatus(engineStatus);

  // Modal open state
  const [chatOpen, setChatOpen] = useState(false);
  const [localChatOpen, setLocalChatOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [scrapeOpen, setScrapeOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handle = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [userMenuOpen]);

  const llmRunning = llmState.serverStatus?.running ?? false;
  const llmStarting = llmState.isStarting;

  const wwListening =
    wwState.uiMode === "listening" ||
    wwState.uiMode === "muted" ||
    wwState.uiMode === "active";

  const handleLlmToggle = useCallback(async () => {
    if (llmRunning) {
      await llmActions.stopServer();
    } else if (llmState.downloadedModels.length > 0) {
      const model = llmState.downloadedModels[0];
      await llmActions.startServer(model.filename, 0);
    }
  }, [llmRunning, llmState.downloadedModels, llmActions]);

  const handleWwToggle = useCallback(async () => {
    if (wwListening) {
      await wwActions.stopListening();
    } else {
      await wwActions.setup();
    }
  }, [wwListening, wwActions]);

  const handleRestart = useCallback(async () => {
    if (restarting) return;
    setRestarting(true);
    try {
      await restartApp();
    } catch {
      setRestarting(false);
    }
  }, [restarting]);

  const engineDotColor =
    engineStatus === "connected"
      ? "green"
      : engineStatus === "discovering" || engineStatus === "starting"
        ? "amber"
        : engineStatus === "error"
          ? "red"
          : "gray";

  const proxyRunning = serviceStatus.proxy?.running ?? false;
  const tunnelRunning = serviceStatus.tunnel?.running ?? false;

  const hasUpdate =
    updateState.status?.status === "available" ||
    updateState.status?.status === "installed";

  return (
    <>
      <div className="no-select glass flex h-10 shrink-0 items-center gap-0.5 border-b px-3">
        {/* ── Toggles ── */}
        <BarButton
          tooltip={isRecording ? "Recording..." : "Record (compact mode)"}
          onClick={onRecord}
          active={isRecording}
          dotColor={isRecording ? "green" : undefined}
        >
          <Mic className="h-4 w-4" />
        </BarButton>

        <BarButton
          tooltip={wwListening ? "Listening for wake word" : "Start wake word"}
          onClick={handleWwToggle}
          active={wwListening}
          dotColor={wwListening ? "green" : undefined}
        >
          <Headphones className="h-4 w-4" />
        </BarButton>

        <BarButton
          tooltip={
            llmStarting
              ? "LLM server starting..."
              : llmRunning
                ? `LLM running — ${llmState.serverStatus?.model_name ?? "model"}`
                : "Start LLM server"
          }
          onClick={handleLlmToggle}
          active={llmRunning}
          dotColor={llmStarting ? "amber" : llmRunning ? "green" : undefined}
          disabled={llmStarting}
        >
          {llmStarting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Cpu className="h-4 w-4" />
          )}
        </BarButton>

        <Separator />

        {/* ── Status Indicators ── */}
        <BarButton
          tooltip={`Engine: ${engineStatus}`}
          onClick={onOpenMonitor}
          dotColor={engineDotColor}
        >
          <Activity className="h-4 w-4" />
        </BarButton>

        <BarButton
          tooltip={proxyRunning ? `Proxy running on :${serviceStatus.proxy?.port}` : "Proxy off"}
          dotColor={proxyRunning ? "green" : "gray"}
        >
          <Shield className="h-4 w-4" />
        </BarButton>

        <BarButton
          tooltip={
            tunnelRunning
              ? `Tunnel active: ${serviceStatus.tunnel?.url ?? "..."}`
              : "Remote access off"
          }
          dotColor={tunnelRunning ? "green" : "gray"}
        >
          <Globe className="h-4 w-4" />
        </BarButton>

        <BarButton
          tooltip={serviceStatus.cloudSyncing ? "Syncing..." : "Sync to cloud"}
          onClick={serviceActions.triggerCloudSync}
          dotColor={serviceStatus.cloudSyncing ? "amber" : undefined}
        >
          {serviceStatus.cloudSyncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Cloud className="h-4 w-4" />
          )}
        </BarButton>

        <Separator />

        {/* ── Quick Actions ── */}
        <BarButton tooltip="Quick Chat" onClick={() => setChatOpen(true)}>
          <MessageSquare className="h-4 w-4" />
        </BarButton>

        <BarButton tooltip="Quick Local Chat" onClick={() => setLocalChatOpen(true)}>
          <MessageSquareDashed className="h-4 w-4" />
        </BarButton>

        <BarButton tooltip="Quick Note" onClick={() => setNoteOpen(true)}>
          <StickyNote className="h-4 w-4" />
        </BarButton>

        <BarButton tooltip="Quick Scrape" onClick={() => setScrapeOpen(true)}>
          <Globe2 className="h-4 w-4" />
        </BarButton>

        <BarButton tooltip="Quick Transcript" onClick={() => setTranscriptOpen(true)}>
          <AudioLines className="h-4 w-4" />
        </BarButton>

        {/* ── Spacer ── */}
        <div className="flex-1" />

        {/* ── System ── */}
        {hasUpdate && (
          <BarButton
            tooltip={`Update available: ${updateState.status?.version ?? ""}`}
            onClick={updateActions.openDialog}
          >
            <ArrowUpCircle className="h-4 w-4 text-emerald-500" />
          </BarButton>
        )}

        <div className="relative">
          <BarButton
            tooltip={user?.email ?? "Not signed in"}
            onClick={() => setUserMenuOpen((v) => !v)}
          >
            <User className="h-4 w-4" />
          </BarButton>
          {userMenuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border bg-popover p-1 shadow-lg">
              {user && (
                <p className="truncate px-2 py-1 text-xs text-muted-foreground">
                  {user.email}
                </p>
              )}
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  onSignOut();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            </div>
          )}
        </div>

        <NotificationCenter
          notifications={notifications}
          unreadCount={unreadCount}
          onMarkRead={onMarkRead}
          onMarkAllRead={onMarkAllRead}
          onDismiss={onDismissNotification}
          onClearAll={onClearAllNotifications}
        />

        {isTauri() && (
          <BarButton
            tooltip={restarting ? "Restarting..." : "Restart app"}
            onClick={handleRestart}
            disabled={restarting}
          >
            {restarting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
          </BarButton>
        )}
      </div>

      {/* ── Modals ── */}
      <QuickChatModal
        open={chatOpen}
        onOpenChange={setChatOpen}
        engineStatus={engineStatus}
        engineUrl={engineUrl}
        tools={tools}
      />
      <QuickLocalChatModal
        open={localChatOpen}
        onOpenChange={setLocalChatOpen}
        engineStatus={engineStatus}
        engineUrl={engineUrl}
        tools={tools}
      />
      <QuickNoteModal
        open={noteOpen}
        onOpenChange={setNoteOpen}
        engineStatus={engineStatus}
        userId={userId}
      />
      <QuickScrapeModal open={scrapeOpen} onOpenChange={setScrapeOpen} />
      <QuickTranscriptModal
        open={transcriptOpen}
        onOpenChange={setTranscriptOpen}
        transcriptionState={transcriptionState}
        transcriptionActions={transcriptionActions}
      />
    </>
  );
}
