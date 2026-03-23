import { useState, useEffect, useCallback, useRef } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { SubTabBar } from "@/components/layout/SubTabBar";
import { useTranscription } from "@/hooks/use-transcription";
import { useTranscriptionSessions } from "@/hooks/use-transcription-sessions";
import { useWakeWord } from "@/hooks/use-wake-word";
import { WakeWordOverlay } from "@/components/WakeWordOverlay";
import { WakeWordControls } from "@/components/WakeWordControls";
import { WakeWordPage } from "@/pages/WakeWord";
import { usePermissionsContext } from "@/contexts/PermissionsContext";
import { loadSettings } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { DownloadProgress } from "@/components/DownloadProgress";
import { TranscriptionMiniMode } from "@/components/TranscriptionMiniMode";
import { engine } from "@/lib/api";
import { useLlmApp } from "@/contexts/LlmContext";
import { useLlmPipeline } from "@/hooks/use-llm-pipeline";
import type { TranscriptPolishOutput } from "@/hooks/use-llm-pipeline";
import {
  Mic,
  MicOff,
  Download,
  CheckCircle2,
  AlertCircle,
  Cpu,
  HardDrive,
  Monitor,
  Trash2,
  RefreshCw,
  Zap,
  Volume2,
  ChevronRight,
  Loader2,
  Info,
  Clock,
  Copy,
  Check,
  Plus,
  Pencil,
  FileText,
  Minimize2,
  ChevronLeft,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { emitClientLog } from "@/hooks/use-client-log";
import type {
  WhisperModelTier,
  HardwareDetectionResult,
  ModelInfo,
  TranscriptionSession,
} from "@/lib/transcription/types";

const TABS = [
  { value: "setup", label: "Setup" },
  { value: "transcribe", label: "Transcribe" },
  { value: "models", label: "Models" },
  { value: "devices", label: "Audio Devices" },
  { value: "wakeword", label: "Wake Word" },
];

const LOG = (level: Parameters<typeof emitClientLog>[0], msg: string) =>
  emitClientLog(level, msg, "voice");

export function Voice() {
  const [tab, setTab] = useState("setup");
  const [state, actions] = useTranscription();
  const [llmState] = useLlmApp();
  const llmPort = llmState.serverStatus?.port ?? null;
  const [sessionsState, sessionsActions] = useTranscriptionSessions();
  const [isMiniMode, setIsMiniMode] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const recordingStartRef = useRef<number>(0);

  // ── Wake word integration ────────────────────────────────────────────────
  // onWake: called when wake word fires — starts a new transcription session
  const handleWake = useCallback(async () => {
    const session = sessionsActions.startNew(state.activeModel, state.selectedDevice);
    setActiveSessionId(session.id);
    recordingStartRef.current = Date.now();
    await actions.startRecording();
  }, [sessionsActions, state.activeModel, state.selectedDevice, actions]);

  // onSleep: called when active session should close
  const handleSleep = useCallback(async () => {
    await actions.stopRecording();
    if (activeSessionId) {
      const elapsed = Math.round((Date.now() - recordingStartRef.current) / 1000);
      sessionsActions.finalize(activeSessionId, elapsed);
    }
  }, [actions, activeSessionId, sessionsActions]);

  const [wwState, wwActions] = useWakeWord(
    handleWake,
    handleSleep,
    state.fullTranscript,
  );

  // ── Auto-start listen mode on mount if setting is enabled ────────────────
  const didAutoStartRef = useRef(false);
  useEffect(() => {
    if (didAutoStartRef.current) return;
    didAutoStartRef.current = true;
    loadSettings().then((s) => {
      if (s.wakeWordEnabled && s.wakeWordListenOnStartup) {
        // Defer slightly so transcription init can settle first
        setTimeout(() => void wwActions.setup(), 800);
      }
    }).catch(() => {});
  // Intentionally empty deps — run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Publish transcript from the overlay directly to a note ───────────────
  const handleOverlayPublishToNote = useCallback(async (text: string) => {
    if (!engine.engineUrl) return;
    const date = new Date();
    await engine.createNote("local", {
      label: `Voice Note — ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`,
      content: text,
      folder_name: "Voice Notes",
    });
  }, []);

  // Wire state changes to the unified log bus
  useEffect(() => {
    if (state.downloadProgress) {
      try {
        LOG("data", `[whisper] download-progress: ${JSON.stringify(state.downloadProgress)}`);
      } catch {
        LOG("data", "[whisper] download-progress: [unserializable]");
      }
    }
  }, [state.downloadProgress]);

  useEffect(() => {
    if (state.error) {
      LOG("error", `[whisper] ERROR: ${state.error}`);
    }
  }, [state.error]);

  // Wrapped actions that also log to the unified bus
  const wrappedDetectHardware = useCallback(async () => {
    LOG("cmd", "invoke detect_hardware");
    try {
      const result = await actions.detectHardware();
      try {
        LOG("data", `[whisper] hardware-result: ${JSON.stringify(result)}`);
      } catch {
        LOG("data", "[whisper] hardware-result: [unserializable]");
      }
      return result;
    } catch (e) {
      LOG("error", `detect_hardware failed: ${e}`);
      throw e;
    }
  }, [actions]);

  const wrappedDownloadModel = useCallback(async (filename: string) => {
    LOG("cmd", `invoke download_whisper_model: ${filename}`);
    LOG("info", `Starting download from HuggingFace: ggml/${filename}`);
    try {
      await actions.downloadModel(filename);
      LOG("success", `Model downloaded: ${filename}`);
    } catch (e) {
      LOG("error", `download_whisper_model failed: ${e}`);
      throw e;
    }
  }, [actions]);

  const wrappedInitTranscription = useCallback(async (filename: string) => {
    LOG("cmd", `invoke init_transcription: ${filename}`);
    try {
      await actions.initTranscription(filename);
      LOG("success", `Transcription engine initialized with: ${filename}`);
    } catch (e) {
      LOG("error", `init_transcription failed: ${e}`);
      throw e;
    }
  }, [actions]);

  const wrappedQuickSetup = useCallback(async () => {
    LOG("info", "=== Starting Voice Quick Setup ===");
    LOG("cmd", "quickSetup (detect + download + VAD + init)");
    try {
      await actions.quickSetup();
      LOG("success", "=== Voice Quick Setup complete ===");
    } catch (e) {
      LOG("error", `Quick setup failed: ${e}`);
    }
  }, [actions]);

  const wrappedDeleteModel = useCallback(async (filename: string) => {
    LOG("cmd", `invoke delete_model: ${filename}`);
    try {
      await actions.deleteModel(filename);
      LOG("success", `Model deleted: ${filename}`);
    } catch (e) {
      LOG("error", `delete_model failed: ${e}`);
    }
  }, [actions]);

  const wrappedActions = {
    ...actions,
    detectHardware: wrappedDetectHardware,
    downloadModel: wrappedDownloadModel,
    initTranscription: wrappedInitTranscription,
    quickSetup: wrappedQuickSetup,
    deleteModel: wrappedDeleteModel,
  };

  // Session-aware recording start: always create a new session
  const handleStartNewRecording = useCallback(async () => {
    const session = sessionsActions.startNew(
      state.activeModel,
      state.selectedDevice
    );
    setActiveSessionId(session.id);
    recordingStartRef.current = Date.now();
    await actions.startRecording();
  }, [sessionsActions, state.activeModel, state.selectedDevice, actions]);

  // Session-aware continue recording (append to existing session)
  const handleContinueRecording = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    recordingStartRef.current = Date.now();
    await actions.startRecording();
  }, [actions]);

  // When stopping, finalize the session
  const handleStopRecording = useCallback(async () => {
    await actions.stopRecording();
    if (activeSessionId) {
      const elapsed = Math.round((Date.now() - recordingStartRef.current) / 1000);
      sessionsActions.finalize(activeSessionId, elapsed);
    }
  }, [actions, activeSessionId, sessionsActions]);

  // When new segments arrive, persist them immediately
  const prevSegmentCountRef = useRef(0);
  useEffect(() => {
    if (!activeSessionId) return;
    if (state.segments.length > prevSegmentCountRef.current) {
      const newSegs = state.segments.slice(prevSegmentCountRef.current);
      prevSegmentCountRef.current = state.segments.length;
      sessionsActions.append(activeSessionId, newSegs);
    }
  }, [state.segments, activeSessionId, sessionsActions]);

  // Reset segment tracking when recording starts fresh
  useEffect(() => {
    if (state.isRecording) {
      prevSegmentCountRef.current = 0;
    }
  }, [state.isRecording]);

  // Note: we intentionally do NOT auto-switch viewingSessionId here.
  // The session is opened by sessionsActions.startNew() directly inside
  // the hook, and the user's sidebar selection must never be overridden
  // by the recording state.

  if (isMiniMode) {
    return (
      <TranscriptionMiniMode
        isRecording={state.isRecording}
        isProcessingTail={state.isProcessingTail}
        isCalibrating={state.isCalibrating}
        liveRms={state.liveRms}
        recentText={state.fullTranscript}
        onStartRecording={handleStartNewRecording}
        onStopRecording={handleStopRecording}
        onExpand={() => setIsMiniMode(false)}
        onClose={() => setIsMiniMode(false)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Wake-word overlay — renders over the entire app window */}
      <WakeWordOverlay
        uiMode={wwState.uiMode}
        rms={state.liveRms || wwState.listenRms}
        transcript={state.fullTranscript}
        onDismiss={wwActions.dismiss}
        onPublishToNote={engine.engineUrl ? handleOverlayPublishToNote : undefined}
      />

      <PageHeader
        title="Voice"
        description="Local speech-to-text transcription powered by Whisper"
      >
        {/* Wake word controls strip — lives in the header action area */}
        <div className="flex items-center gap-2">
          <WakeWordControls
            uiMode={wwState.uiMode}
            listenRms={wwState.listenRms}
            kmsModelReady={wwState.kmsModelReady}
            downloadProgress={wwState.downloadProgress}
            onSetup={wwActions.setup}
            onMute={wwActions.mute}
            onUnmute={wwActions.unmute}
            onManualTrigger={wwActions.manualTrigger}
            onDismiss={wwActions.dismiss}
            disabled={state.isInitializing}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsMiniMode(true)}
            className="gap-1.5 text-muted-foreground"
            title="Switch to compact floating mode"
          >
            <Minimize2 className="h-4 w-4" />
            Mini Mode
          </Button>
        </div>
      </PageHeader>
      <SubTabBar tabs={TABS} value={tab} onValueChange={setTab} />
      <div className="flex-1 overflow-hidden">
        {tab === "setup" && (
          <div className="h-full overflow-y-auto p-6">
            <SetupTab state={state} actions={wrappedActions} />
          </div>
        )}
        {tab === "transcribe" && (
          <TranscribeTab
            state={state}
            actions={{
              ...actions,
              startRecording: handleStartNewRecording,
              stopRecording: handleStopRecording,
            }}
            sessionsState={sessionsState}
            sessionsActions={sessionsActions}
            activeSessionId={activeSessionId}
            onContinueSession={handleContinueRecording}
            llmPort={llmPort}
          />
        )}
        {tab === "models" && (
          <div className="h-full overflow-y-auto p-6">
            <ModelsTab state={state} actions={wrappedActions} />
          </div>
        )}
        {tab === "devices" && (
          <div className="h-full overflow-y-auto p-6">
            <DevicesTab state={state} actions={actions} />
          </div>
        )}
        {tab === "wakeword" && (
          <WakeWordPage wwState={wwState} wwActions={wwActions} />
        )}
      </div>
    </div>
  );
}

// ── Setup Tab ──────────────────────────────────────────────────────────────

function SetupTab({
  state,
  actions,
}: {
  state: ReturnType<typeof useTranscription>[0];
  actions: ReturnType<typeof useTranscription>[1];
}) {
  const isSetupDone = state.setupStatus?.setup_complete ?? false;
  const isActive = state.isDetecting || state.isDownloading || state.isInitializing;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Quick Setup Card */}
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-xl",
              isSetupDone
                ? "bg-emerald-500/10 text-emerald-500"
                : "bg-primary/10 text-primary"
            )}
          >
            {isSetupDone ? (
              <CheckCircle2 className="h-6 w-6" />
            ) : (
              <Zap className="h-6 w-6" />
            )}
          </div>
          <div className="flex-1 space-y-2">
            <h2 className="text-lg font-semibold">
              {isSetupDone
                ? "Voice Features Ready"
                : "Set Up Voice Transcription"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isSetupDone
                ? `Using ${state.activeModel ?? state.setupStatus?.selected_model ?? "unknown model"}. You can change models in the Models tab.`
                : "One-click setup detects your hardware, downloads the best model for your system, and gets everything ready."}
            </p>
            {!isSetupDone && (
              <Button
                onClick={actions.quickSetup}
                disabled={isActive}
                className="mt-2"
                size="lg"
              >
                {state.isDetecting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Detecting hardware...</>
                ) : state.isDownloading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Downloading model...</>
                ) : state.isInitializing ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading model...</>
                ) : (
                  <><Zap className="mr-2 h-4 w-4" />One-Click Setup</>
                )}
              </Button>
            )}
            {isSetupDone && (
              <Button
                variant="outline"
                size="sm"
                onClick={actions.refreshSetupStatus}
              >
                <RefreshCw className="mr-1 h-3 w-3" />
                Refresh Status
              </Button>
            )}
          </div>
        </div>

        <DownloadProgress
          progress={state.downloadProgress}
          isDownloading={state.isDownloading}
          error={state.error}
          className="mt-4"
        />
      </div>

      {state.error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 text-red-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-500">Error</p>
            <p className="text-sm text-red-400 whitespace-pre-wrap">{state.error}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={actions.clearError}
            className="text-red-400 hover:text-red-300"
          >
            Dismiss
          </Button>
        </div>
      )}

      <HardwareInfoCard state={state} actions={actions} />

      <div className="rounded-xl border bg-card p-6 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Info className="h-4 w-4 text-muted-foreground" />
          How it works
        </h3>
        <div className="space-y-3 text-sm text-muted-foreground">
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold flex-shrink-0">1</div>
            <p><strong className="text-foreground">Local processing</strong> — All transcription runs on your machine using Whisper. No audio leaves your device.</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold flex-shrink-0">2</div>
            <p><strong className="text-foreground">Adaptive models</strong> — The system picks the best model for your hardware. Faster machines get more accurate models.</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold flex-shrink-0">3</div>
            <p><strong className="text-foreground">Every recording saved</strong> — All sessions are persisted locally. Browse your history in the Transcribe tab.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Hardware Info Card ─────────────────────────────────────────────────────

function HardwareInfoCard({
  state,
  actions,
}: {
  state: ReturnType<typeof useTranscription>[0];
  actions: ReturnType<typeof useTranscription>[1];
}) {
  const hw = state.hardwareResult;
  const didAutoDetect = useRef(false);

  useEffect(() => {
    if (!hw && !state.isDetecting && !didAutoDetect.current) {
      didAutoDetect.current = true;
      actions.detectHardware();
    }
  }, [hw, state.isDetecting, actions]);

  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">System Hardware</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={actions.detectHardware}
          disabled={state.isDetecting}
        >
          {state.isDetecting ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-3 w-3" />
          )}
          Rescan
        </Button>
      </div>

      {!hw ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
          Scanning system hardware…
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <HardwareStat
              icon={<HardDrive className="h-4 w-4" />}
              label="System RAM"
              value={formatRam(hw.hardware.total_ram_mb)}
            />
            <HardwareStat
              icon={<Cpu className="h-4 w-4" />}
              label="CPU Threads"
              value={String(hw.hardware.cpu_threads)}
            />
            <HardwareStat
              icon={<Monitor className="h-4 w-4" />}
              label="GPU"
              value={getGpuLabel(hw)}
            />
            <HardwareStat
              icon={<Zap className="h-4 w-4" />}
              label="Acceleration"
              value={getAccelLabel(hw)}
            />
          </div>

          <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-sm font-medium">Recommendation</span>
            </div>
            <p className="text-sm text-muted-foreground">{hw.reason}</p>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                {hw.recommended_filename}
              </span>
              <span className="text-muted-foreground">
                ({hw.recommended_size_mb} MB download)
              </span>
            </div>
            {hw.can_upgrade && (
              <p className="text-xs text-amber-500 mt-1">
                Your system can handle a higher-quality model. Check the Models tab for options.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HardwareStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="text-muted-foreground">{icon}</div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

// ── Transcribe Tab ─────────────────────────────────────────────────────────

function TranscribeTab({
  state,
  actions,
  sessionsState,
  sessionsActions,
  activeSessionId,
  onContinueSession,
  llmPort,
}: {
  state: ReturnType<typeof useTranscription>[0];
  actions: ReturnType<typeof useTranscription>[1] & {
    startRecording: () => Promise<void>;
    stopRecording: () => Promise<void>;
  };
  sessionsState: ReturnType<typeof useTranscriptionSessions>[0];
  sessionsActions: ReturnType<typeof useTranscriptionSessions>[1];
  activeSessionId: string | null;
  onContinueSession: (sessionId: string) => Promise<void>;
  llmPort: number | null;
}) {
  const { permissions, check, request, openSettings } = usePermissionsContext();
  const [permError, setPermError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [pushingToNote, setPushingToNote] = useState<string | null>(null);
  const [pushSuccess, setPushSuccess] = useState<string | null>(null);
  // Local editable draft for the transcript text — synced from viewing session
  const [textDraft, setTextDraft] = useState<string>("");
  const textDraftSessionRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // LLM pipeline for AI-powered transcript polish
  const getPort = useCallback(() => llmPort, [llmPort]);
  const { run: runPipeline } = useLlmPipeline(getPort);
  const [polishingSessionId, setPolishingSessionId] = useState<string | null>(null);
  const [polishSuccessId, setPolishSuccessId] = useState<string | null>(null);
  const [polishErrorMsg, setPolishErrorMsg] = useState<string | null>(null);

  // Sync textDraft when the viewed session changes or gets new segments
  const viewingSession = sessionsState.viewingSession;
  const isViewingActive = viewingSession?.id === activeSessionId && state.isRecording;

  useEffect(() => {
    if (!viewingSession) return;
    // If switching to a different session, load its saved text.
    if (textDraftSessionRef.current !== viewingSession.id) {
      textDraftSessionRef.current = viewingSession.id;
      setTextDraft(viewingSession.fullText);
      return;
    }
    // Same session — only update the draft while actively recording (new segments arriving).
    // Do NOT overwrite user edits once recording stops.
    if (isViewingActive) {
      const liveText = state.fullTranscript;
      setTextDraft(liveText);
    }
  }, [viewingSession, viewingSession?.fullText, isViewingActive, state.fullTranscript]);

  // Debounced save: persist user edits 600ms after they stop typing
  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setTextDraft(newText);
    if (!textDraftSessionRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const sid = textDraftSessionRef.current;
    saveTimerRef.current = setTimeout(() => {
      sessionsActions.updateText(sid, newText);
    }, 600);
  }, [sessionsActions]);

  // Load device list if not yet populated
  useEffect(() => {
    if (state.audioDevices.length === 0) {
      actions.listAudioDevices();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartRecording = useCallback(async () => {
    setPermError(null);
    const status = await check("microphone");
    if (status === "granted") {
      await actions.startRecording();
      return;
    }
    if (status === "not_determined") {
      await request("microphone");
      const recheck = await check("microphone");
      if (recheck === "granted") {
        await actions.startRecording();
      } else {
        setPermError("Microphone access is required for transcription. Please allow access when prompted.");
      }
      return;
    }
    if (status === "denied" || status === "restricted") {
      setPermError(
        status === "restricted"
          ? "Microphone access is restricted on this device (parental controls or MDM policy)."
          : "Microphone access was denied. Open System Settings → Privacy & Security → Microphone and enable access for Matrx Local."
      );
      await openSettings("microphone");
      return;
    }
    await actions.startRecording();
  }, [check, request, openSettings, actions]);

  const handleContinueRecording = useCallback(async (sessionId: string) => {
    setPermError(null);
    const status = await check("microphone");
    if (status === "granted") {
      sessionsActions.open(sessionId);
      await onContinueSession(sessionId);
      return;
    }
    if (status === "not_determined") {
      await request("microphone");
      const recheck = await check("microphone");
      if (recheck === "granted") {
        sessionsActions.open(sessionId);
        await onContinueSession(sessionId);
      } else {
        setPermError("Microphone access is required for transcription.");
      }
      return;
    }
    setPermError("Microphone access denied. Check System Settings → Privacy & Security.");
  }, [check, request, onContinueSession, sessionsActions]);

  const handleCopy = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handlePushToNote = useCallback(async (session: TranscriptionSession, currentText: string) => {
    if (!engine.engineUrl) {
      console.warn("[voice] push to note skipped — engine not discovered yet");
      return;
    }
    if (!currentText.trim()) {
      console.warn("[voice] push to note skipped — empty transcript");
      return;
    }
    setPushingToNote(session.id);
    try {
      const date = new Date(session.createdAt);
      const label = session.title
        ? session.title
        : `Voice Note — ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
      await engine.createNote("local", {
        label,
        content: currentText,
        folder_name: "Voice Notes",
      });
      setPushSuccess(session.id);
      setTimeout(() => setPushSuccess(null), 3000);
    } catch (err) {
      console.error("[voice] push to note failed:", err);
    } finally {
      setPushingToNote(null);
    }
  }, []);

  /**
   * Polish transcript with local LLM:
   * 1. Runs polish_transcript pipeline → returns { title, cleaned }
   * 2. Formats the note with structured content + original transcript section
   * 3. Saves the note via engine.createNote
   * 4. Updates the session title and text draft to the cleaned version
   */
  const handlePolishWithAI = useCallback(async (session: TranscriptionSession, rawText: string) => {
    if (!llmPort) return;
    if (!rawText.trim()) return;
    setPolishingSessionId(session.id);
    setPolishErrorMsg(null);

    try {
      const result = await runPipeline<TranscriptPolishOutput>(
        "polish_transcript",
        { transcript: rawText }
      );

      const { title, cleaned } = result;

      // Build the structured note content
      const noteContent = `${cleaned}

---
# Original Transcript:
${rawText}`;

      // Update the session in state (title + cleaned text)
      sessionsActions.rename(session.id, title);
      sessionsActions.updateText(session.id, cleaned);
      setTextDraft(cleaned);

      // Push to notes if engine is available
      if (engine.engineUrl) {
        await engine.createNote("local", {
          label: title,
          content: noteContent,
          folder_name: "Voice Notes",
        });
      }

      setPolishSuccessId(session.id);
      setTimeout(() => setPolishSuccessId(null), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPolishErrorMsg(msg);
      setTimeout(() => setPolishErrorMsg(null), 5000);
    } finally {
      setPolishingSessionId(null);
    }
  }, [llmPort, runPipeline, sessionsActions]);

  const handleStartTitleEdit = useCallback((session: TranscriptionSession) => {
    setEditingTitleId(session.id);
    setTitleDraft(session.title ?? "");
  }, []);

  const handleSaveTitle = useCallback(() => {
    if (!editingTitleId) return;
    sessionsActions.rename(editingTitleId, titleDraft.trim() || null);
    setEditingTitleId(null);
  }, [editingTitleId, titleDraft, sessionsActions]);

  const setupDoneInConfig = state.setupStatus?.setup_complete ?? false;
  const modelLoadedInMemory = state.activeModel !== null;

  const defaultDevice = state.audioDevices.find((d) => d.is_default);
  const activeDeviceName = state.selectedDevice ?? defaultDevice?.name ?? "System default";

  if (setupDoneInConfig && !modelLoadedInMemory) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card p-12 text-center space-y-4 max-w-md w-full">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
          <h3 className="text-lg font-semibold">Loading model…</h3>
          <p className="text-sm text-muted-foreground">
            {state.setupStatus?.selected_model
              ? `Loading ${state.setupStatus.selected_model} into memory. This takes a few seconds.`
              : "Initializing transcription engine…"}
          </p>
          <button
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={async () => {
              const model = state.setupStatus?.selected_model;
              if (model) await actions.initTranscription(model);
            }}
          >
            Taking too long? Click to retry
          </button>
        </div>
      </div>
    );
  }

  if (!setupDoneInConfig) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card p-12 text-center space-y-4 max-w-md w-full">
          <Mic className="h-12 w-12 text-muted-foreground/30" />
          <h3 className="text-lg font-semibold">Setup Required</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Complete the voice setup first to enable transcription. Go to the Setup tab and click "One-Click Setup".
          </p>
        </div>
      </div>
    );
  }

  // viewingSession and isViewingActive are now declared at the top of TranscribeTab
  // so the text-sync effect can reference them.

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Sidebar: Session History ── */}
      {showHistory && (
        <div className="w-64 shrink-0 border-r flex flex-col h-full">
          <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Recordings
            </span>
            <button
              onClick={() => setShowHistory(false)}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Hide sidebar"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* New Recording button */}
          <div className="px-2 py-2 shrink-0">
            <button
              onClick={handleStartRecording}
              disabled={state.isRecording || state.isProcessingTail}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                state.isRecording || state.isProcessingTail
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              <Plus className="h-4 w-4 shrink-0" />
              New Recording
            </button>
          </div>

          {/* Session list */}
          <div className="flex-1 overflow-y-auto">
            {sessionsState.sessions.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Mic className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No recordings yet</p>
              </div>
            ) : (
              <div className="p-2 space-y-0.5">
                {sessionsState.sessions.map((session) => {
                  const isActive = session.id === activeSessionId && state.isRecording;
                  const isViewing = session.id === sessionsState.viewingSessionId;
                  const date = new Date(session.createdAt);

                  return (
                    <button
                      key={session.id}
                      onClick={() => sessionsActions.open(session.id)}
                      className={cn(
                        "w-full text-left rounded-lg px-3 py-2.5 transition-colors group relative",
                        isViewing
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-muted text-foreground"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {isActive ? (
                          <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse mt-1 shrink-0" />
                        ) : (
                          <Mic className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate leading-tight">
                            {session.title ?? formatSessionTitle(date)}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Clock className="h-2.5 w-2.5 text-muted-foreground/60 shrink-0" />
                            <span className="text-[10px] text-muted-foreground/60">
                              {formatRelativeTime(date)}
                            </span>
                            {session.charCount > 0 && (
                              <span className="text-[10px] text-muted-foreground/60">
                                · {session.charCount}c
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Main panel ── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Show history toggle when sidebar is hidden */}
        {!showHistory && (
          <div className="shrink-0 px-4 pt-3">
            <button
              onClick={() => setShowHistory(true)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5" />
              Show history
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Active config bar */}
          <div className="rounded-xl border bg-card px-4 py-3">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <Cpu className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Model</p>
                  <p className="text-sm font-medium truncate">
                    {state.activeModel ?? (
                      <span className="text-amber-500 italic">No model loaded</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="w-px h-8 bg-border shrink-0 hidden sm:block" />
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Mic className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    Microphone{state.selectedDevice ? "" : " (system default)"}
                  </p>
                  <p className="text-sm font-medium truncate">{activeDeviceName}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Permission error */}
          {permError && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 text-amber-500 shrink-0" />
              <p className="text-sm text-amber-400">{permError}</p>
            </div>
          )}

          {/* Engine error */}
          {state.error && (
            <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 text-red-500 shrink-0" />
              <p className="text-sm text-red-400">{state.error}</p>
            </div>
          )}

          {/* Recording controls */}
          <div className="rounded-xl border bg-card p-5">
            <div className="mb-3">
              <h3 className="font-semibold">
                {state.isRecording
                  ? "Recording…"
                  : state.isProcessingTail
                  ? "Processing…"
                  : "Ready to Record"}
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                {state.isRecording
                  ? "Listening… speak into your microphone"
                  : state.isProcessingTail
                  ? "Processing remaining audio…"
                  : "Each recording is automatically saved to history"}
              </p>
            </div>

            {/* Device quick-select */}
            {state.audioDevices.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                <button
                  onClick={() => actions.setSelectedDevice(null)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                    !state.selectedDevice
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  )}
                >
                  <Volume2 className="h-3 w-3" />
                  Default
                </button>
                {state.audioDevices.map((dev, i) => (
                  <button
                    key={i}
                    onClick={() => actions.setSelectedDevice(dev.name)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors max-w-[200px]",
                      state.selectedDevice === dev.name
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    )}
                  >
                    <Mic className="h-3 w-3 shrink-0" />
                    <span className="truncate">{dev.name}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col items-center gap-3 py-4">
              {/* Mic permission denied banner */}
              {permissions.get("microphone")?.status === "denied" && !state.isRecording && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-500">
                  <MicOff className="h-4 w-4 shrink-0" />
                  <span>Microphone access denied.</span>
                  <button
                    className="underline underline-offset-2 hover:text-amber-400"
                    onClick={() => openSettings("microphone")}
                  >
                    Open Settings
                  </button>
                </div>
              )}

              {/* Main mic button */}
              <button
                onClick={
                  state.isRecording
                    ? actions.stopRecording
                    : state.isProcessingTail
                    ? undefined
                    : handleStartRecording
                }
                disabled={state.isProcessingTail}
                className={cn(
                  "flex h-20 w-20 items-center justify-center rounded-full transition-all duration-300",
                  state.isRecording
                    ? "bg-red-500 text-white shadow-lg shadow-red-500/25 hover:bg-red-600"
                    : state.isProcessingTail
                    ? "bg-amber-500 text-white shadow-lg shadow-amber-500/25 cursor-wait"
                    : "bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90"
                )}
                style={
                  state.isRecording && state.liveRms > 0.00005
                    ? { boxShadow: `0 0 ${8 + Math.min(state.liveRms * 8000, 40)}px ${4 + Math.min(state.liveRms * 4000, 20)}px rgba(239,68,68,${Math.min(0.2 + state.liveRms * 200, 0.6)})` }
                    : undefined
                }
              >
                {state.isProcessingTail ? (
                  <Loader2 className="h-8 w-8 animate-spin" />
                ) : state.isRecording ? (
                  <MicOff className="h-8 w-8" />
                ) : (
                  <Mic className="h-8 w-8" />
                )}
              </button>

              {state.isProcessingTail && (
                <p className="text-xs text-amber-500 text-center">
                  Finishing transcription of last audio chunk…
                </p>
              )}

              {/* Live audio level meter */}
              {state.isRecording && (
                <div className="w-full max-w-xs space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <div className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                      {state.isCalibrating ? "Calibrating mic level…" : "Recording"}
                      {state.selectedDevice && (
                        <span className="text-muted-foreground/60">· {state.selectedDevice}</span>
                      )}
                    </span>
                    <span className="font-mono tabular-nums">
                      {state.liveRms > 0 ? (state.liveRms * 1000).toFixed(2) : "—"}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-75",
                        state.liveRms > 0.001 ? "bg-green-500" : state.liveRms > 0.0001 ? "bg-yellow-500" : "bg-red-400"
                      )}
                      style={{ width: `${Math.min(state.liveRms * 10000, 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Viewing session / live transcript */}
          {(viewingSession || state.isRecording) && (
            <div className="rounded-xl border bg-card">
              {/* Session header */}
              {viewingSession && (
                <div className="flex items-center gap-3 px-5 py-3 border-b">
                  {editingTitleId === viewingSession.id ? (
                    <div className="flex-1 flex items-center gap-2">
                      <input
                        type="text"
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveTitle();
                          if (e.key === "Escape") setEditingTitleId(null);
                        }}
                        placeholder="Add a title…"
                        autoFocus
                        className="flex-1 bg-transparent text-sm font-medium outline-none border-b border-primary/50 pb-0.5"
                      />
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleSaveTitle}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setEditingTitleId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <h3 className="font-semibold truncate text-sm">
                        {viewingSession.title ?? formatSessionTitle(new Date(viewingSession.createdAt))}
                      </h3>
                      {isViewingActive && (
                        <span className="flex items-center gap-1 text-xs text-red-500">
                          <div className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                          Live
                        </span>
                      )}
                      <button
                        onClick={() => handleStartTitleEdit(viewingSession)}
                        className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="Edit title"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Continue recording */}
                    {!state.isRecording && !state.isProcessingTail && viewingSession.segments.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => handleContinueRecording(viewingSession.id)}
                        title="Continue recording into this session"
                      >
                        <Mic className="h-3 w-3" />
                        Continue
                      </Button>
                    )}

                    {/* Polish with AI — only visible when LLM server is running */}
                    {textDraft.length > 0 && llmPort && !isViewingActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-7 px-2 text-xs gap-1",
                          polishSuccessId === viewingSession.id && "text-emerald-500",
                          polishErrorMsg && polishingSessionId === viewingSession.id && "text-red-500"
                        )}
                        onClick={() => handlePolishWithAI(viewingSession, textDraft)}
                        disabled={polishingSessionId === viewingSession.id}
                        title="Clean up transcript with AI, generate a title, and save as a structured note"
                      >
                        {polishingSessionId === viewingSession.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : polishSuccessId === viewingSession.id ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Sparkles className="h-3 w-3" />
                        )}
                        {polishingSessionId === viewingSession.id
                          ? "Polishing…"
                          : polishSuccessId === viewingSession.id
                          ? "Polished!"
                          : "Polish with AI"}
                      </Button>
                    )}

                    {/* Push to note */}
                    {textDraft.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-7 px-2 text-xs gap-1",
                          pushSuccess === viewingSession.id && "text-emerald-500"
                        )}
                        onClick={() => handlePushToNote(viewingSession, textDraft)}
                        disabled={pushingToNote === viewingSession.id}
                        title="Save transcript as a note"
                      >
                        {pushingToNote === viewingSession.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : pushSuccess === viewingSession.id ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <FileText className="h-3 w-3" />
                        )}
                        {pushSuccess === viewingSession.id ? "Saved!" : "Push to Note"}
                      </Button>
                    )}

                    {/* Copy */}
                    {textDraft.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-7 px-2 text-xs gap-1",
                          copiedId === viewingSession.id && "text-emerald-500"
                        )}
                        onClick={() => handleCopy(textDraft, viewingSession.id)}
                        title="Copy transcript"
                      >
                        {copiedId === viewingSession.id ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        {copiedId === viewingSession.id ? "Copied!" : "Copy"}
                      </Button>
                    )}

                    {/* Delete */}
                    {!isViewingActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 px-0 text-muted-foreground hover:text-red-500"
                        onClick={() => sessionsActions.remove(viewingSession.id)}
                        title="Delete recording"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Transcript content — editable textarea */}
              <div className="flex flex-col">
                {viewingSession && (
                  <div className="flex items-center gap-3 px-5 py-2 border-b border-border/40 text-xs text-muted-foreground">
                    <span>{new Date(viewingSession.createdAt).toLocaleString()}</span>
                    {viewingSession.durationSecs > 0 && (
                      <span>· {formatDuration(viewingSession.durationSecs)}</span>
                    )}
                    {viewingSession.modelUsed && (
                      <span>· {viewingSession.modelUsed}</span>
                    )}
                    {viewingSession.charCount > 0 && (
                      <span className="ml-auto">{viewingSession.charCount} chars</span>
                    )}
                  </div>
                )}

                {/* Live pulsing indicator between segments while recording */}
                {isViewingActive && (
                  <div className="flex items-center gap-2 px-5 py-2 border-b border-border/40 bg-red-500/5">
                    <div className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                    <span className="text-xs text-red-500 font-medium">
                      {state.isCalibrating ? "Calibrating microphone…" : "Listening — transcript updates as each chunk is processed"}
                    </span>
                  </div>
                )}
                {state.isProcessingTail && viewingSession?.id === activeSessionId && (
                  <div className="flex items-center gap-2 px-5 py-2 border-b border-border/40 bg-amber-500/5">
                    <Loader2 className="h-3.5 w-3.5 text-amber-500 animate-spin shrink-0" />
                    <span className="text-xs text-amber-500 font-medium">Finishing final audio chunk…</span>
                  </div>
                )}
                {polishingSessionId === viewingSession?.id && (
                  <div className="flex items-center gap-2 px-5 py-2 border-b border-border/40 bg-violet-500/5">
                    <Sparkles className="h-3.5 w-3.5 text-violet-400 animate-pulse shrink-0" />
                    <span className="text-xs text-violet-400 font-medium">Polishing transcript with AI…</span>
                  </div>
                )}
                {polishErrorMsg && polishingSessionId === null && (
                  <div className="flex items-center gap-2 px-5 py-2 border-b border-border/40 bg-red-500/5">
                    <span className="text-xs text-red-500">AI polish failed: {polishErrorMsg}</span>
                  </div>
                )}

                <textarea
                  className={cn(
                    "w-full resize-none bg-transparent px-5 py-4 text-sm leading-relaxed",
                    "focus:outline-none placeholder:text-muted-foreground/50",
                    "min-h-[200px]",
                    isViewingActive && "cursor-default select-text"
                  )}
                  value={textDraft}
                  onChange={handleTextChange}
                  readOnly={isViewingActive}
                  placeholder={
                    state.isRecording
                      ? "Listening… transcript will appear here as you speak"
                      : state.isProcessingTail
                      ? "Processing last audio chunk…"
                      : "No transcript yet. Start recording to begin.\n\nYou can also type or paste text here directly."
                  }
                  spellCheck
                />

                {!isViewingActive && textDraft.length > 0 && (
                  <p className="px-5 pb-2 text-[10px] text-muted-foreground/50 text-right">
                    Click to edit · auto-saved
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Empty state when no session selected and not recording */}
          {!viewingSession && !state.isRecording && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Mic className="h-12 w-12 text-muted-foreground/20 mb-4" />
              <h3 className="text-sm font-medium text-muted-foreground">No recording selected</h3>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Click "New Recording" or select one from the sidebar
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Models Tab ─────────────────────────────────────────────────────────────

function ModelsTab({
  state,
  actions,
}: {
  state: ReturnType<typeof useTranscription>[0];
  actions: ReturnType<typeof useTranscription>[1];
}) {
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const hw = state.hardwareResult;
  const downloaded = state.setupStatus?.downloaded_models ?? [];

  useEffect(() => {
    if (!hw) {
      actions.detectHardware();
    }
  }, [hw, actions]);

  const handleDownloadAndActivate = async (model: ModelInfo) => {
    setDownloadingFile(model.filename);
    try {
      const exists = await actions.checkModelExists(model.filename);
      if (!exists) {
        await actions.downloadModel(model.filename);
      }
      await actions.initTranscription(model.filename);
    } catch {
      // Error displayed in terminal + state.error
    }
    setDownloadingFile(null);
  };

  const allModels = hw?.all_models ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <h3 className="font-semibold">Available Models</h3>
        <p className="text-sm text-muted-foreground">
          All models use the same API — switching models only changes accuracy and speed.
        </p>

        <div className="space-y-3">
          {allModels.map((model) => {
            const isDownloaded = downloaded.includes(model.filename);
            const isActive = state.activeModel === model.filename;
            const isDownloading = downloadingFile === model.filename;
            const isRecommended = hw?.recommended_filename === model.filename;

            return (
              <div
                key={model.filename}
                className={cn(
                  "rounded-lg border p-4 space-y-3 transition-colors",
                  isActive && "border-primary/50 bg-primary/5"
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{tierLabel(model.tier)}</span>
                      {isRecommended && (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                          Recommended
                        </span>
                      )}
                      {isActive && (
                        <span className="text-xs bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded-full">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{model.description}</p>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 text-xs">
                  <Stat label="Download" value={`${model.download_size_mb} MB`} />
                  <Stat label="RAM Usage" value={`${model.ram_required_mb} MB`} />
                  <Stat label="Speed" value={model.relative_speed} />
                  <Stat label="Accuracy" value={model.accuracy} />
                </div>

                <div className="flex items-center gap-2">
                  {isActive ? (
                    <span className="text-xs text-emerald-500 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Currently active
                    </span>
                  ) : isDownloading ? (
                    <Button size="sm" disabled>
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      {state.downloadProgress
                        ? `${Math.round(state.downloadProgress.percent)}%`
                        : "Downloading..."}
                    </Button>
                  ) : isDownloaded ? (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownloadAndActivate(model)}
                      >
                        <ChevronRight className="mr-1 h-3 w-3" />
                        Activate
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => actions.deleteModel(model.filename)}
                        className="text-muted-foreground hover:text-red-500"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" onClick={() => handleDownloadAndActivate(model)}>
                      <Download className="mr-1 h-3 w-3" />
                      Download & Activate
                    </Button>
                  )}
                </div>

                {isDownloading && (
                  <DownloadProgress
                    progress={state.downloadProgress}
                    isDownloading={state.isDownloading}
                  />
                )}
              </div>
            );
          })}
        </div>

        {allModels.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <Button onClick={actions.detectHardware} disabled={state.isDetecting}>
              {state.isDetecting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Detect Hardware to See Models
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-card p-6 space-y-3">
        <h3 className="font-semibold text-sm">Technical Details</h3>
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            Models are GGML format files from the whisper.cpp project. Downloaded from Hugging Face and stored locally.
          </p>
          <p>
            <code className="bg-muted px-1 py-0.5 rounded">.en</code> suffix means English-only (optimized).
          </p>
          <p>
            Switching models reinitializes the transcription context. The API is identical across all models.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Devices Tab ────────────────────────────────────────────────────────────

function DevicesTab({
  state,
  actions,
}: {
  state: ReturnType<typeof useTranscription>[0];
  actions: ReturnType<typeof useTranscription>[1];
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await actions.listAudioDevices();
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    handleRefresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Audio Input Devices</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Select which microphone to use for transcription
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" />
            )}
            Refresh
          </Button>
        </div>

        {state.selectedDevice && (
          <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
            <Mic className="h-4 w-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-primary">Selected for transcription</p>
              <p className="text-sm font-semibold truncate">{state.selectedDevice}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => actions.setSelectedDevice(null)}
              className="text-xs text-muted-foreground hover:text-foreground shrink-0"
            >
              Use Default
            </Button>
          </div>
        )}

        {!state.selectedDevice && (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
            <Volume2 className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">
              Using system default microphone. Select a device below to override.
            </p>
          </div>
        )}

        {state.audioDevices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
            {isRefreshing ? (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/30" />
            ) : (
              <Volume2 className="h-8 w-8 text-muted-foreground/30" />
            )}
            <p className="text-sm text-muted-foreground">
              {isRefreshing
                ? "Scanning for audio devices…"
                : "No audio input devices detected."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {state.audioDevices.map((device, i) => {
              const isSelected = state.selectedDevice === device.name;
              const isActiveDefault = !state.selectedDevice && device.is_default;

              return (
                <div
                  key={i}
                  className={cn(
                    "rounded-lg border p-4 transition-colors",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : isActiveDefault
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "hover:border-primary/30"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Mic
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isSelected ? "text-primary" : "text-muted-foreground"
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{device.name}</span>
                        {device.is_default && (
                          <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                            System default
                          </span>
                        )}
                        {isSelected && (
                          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                            Selected
                          </span>
                        )}
                        {isActiveDefault && !isSelected && (
                          <span className="text-xs bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded-full">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                        {device.sample_rates.length > 0 && (
                          <span>{device.sample_rates.map((r) => `${r / 1000}kHz`).join(", ")}</span>
                        )}
                        {device.channels.length > 0 && (
                          <span>{device.channels.join("/")}ch</span>
                        )}
                      </div>
                    </div>
                    {!isSelected ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => actions.setSelectedDevice(device.name)}
                        className="shrink-0 text-xs"
                      >
                        Select
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => actions.setSelectedDevice(null)}
                        className="shrink-0 text-xs text-muted-foreground"
                      >
                        Deselect
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-card p-6 space-y-3">
        <h3 className="font-semibold text-sm">Requirements</h3>
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            Whisper requires <strong>16kHz mono</strong> audio input. Most modern microphones support this natively.
          </p>
          <p>
            For best results, use a dedicated microphone. External USB microphones typically have better noise cancellation.
          </p>
          <p>
            Your device selection is remembered across sessions.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}

function tierLabel(tier: WhisperModelTier): string {
  switch (tier) {
    case "Low":
      return "Tiny (Fast)";
    case "Default":
      return "Base (Balanced)";
    case "High":
      return "Small (Accurate)";
  }
}

function formatRam(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatSessionTitle(date: Date): string {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const isThisYear = date.getFullYear() === now.getFullYear();

  if (isToday) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (isThisYear) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = Math.floor((now - date.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getGpuLabel(hw: HardwareDetectionResult): string {
  if (hw.hardware.is_apple_silicon) return "Apple Silicon (Metal)";
  if (hw.hardware.supports_cuda && hw.hardware.gpu_vram_mb) {
    return `NVIDIA (${formatRam(hw.hardware.gpu_vram_mb)} VRAM)`;
  }
  if (hw.hardware.supports_metal) return "Metal (macOS)";
  return "CPU only";
}

function getAccelLabel(hw: HardwareDetectionResult): string {
  if (hw.hardware.is_apple_silicon) return "Metal (GPU)";
  if (hw.hardware.supports_cuda) return "CUDA (GPU)";
  if (hw.hardware.supports_metal) return "Metal (GPU)";
  return "SIMD (CPU)";
}
