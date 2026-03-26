import { useState, useEffect, useRef, useCallback } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { SubTabBar } from "@/components/layout/SubTabBar";
import { useTts } from "@/hooks/use-tts";
import type { TtsVoice } from "@/lib/tts/types";
import type { TtsHistoryEntry } from "@/hooks/use-tts";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  AudioLines,
  Play,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Clock,
  Zap,
  Star,
  StarOff,
  Search,
  X,
  ChevronDown,
  HardDrive,
  RefreshCw,
} from "lucide-react";
import { loadSettings, saveSetting } from "@/lib/settings";

const TABS = [
  { value: "speak", label: "Speak" },
  { value: "voices", label: "Voices" },
  { value: "settings", label: "Settings" },
];

export function TextToSpeech() {
  const [tab, setTab] = useState("speak");
  const [state, actions] = useTts();

  useEffect(() => {
    actions.refreshStatus();
    actions.refreshVoices();
  }, [actions]);

  useEffect(() => {
    if (!state.status) return;
    if (state.status.is_downloading) {
      const id = setInterval(() => actions.refreshStatus(), 2000);
      return () => clearInterval(id);
    }
  }, [state.status?.is_downloading, actions]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Text to Speech" description="Kokoro TTS — local AI voice synthesis">
        <StatusBadge status={state.status} />
      </PageHeader>
      <SubTabBar tabs={TABS} value={tab} onValueChange={setTab} />
      <div className="flex-1 overflow-y-auto">
        {tab === "speak" && <SpeakTab state={state} actions={actions} />}
        {tab === "voices" && <VoicesTab state={state} actions={actions} />}
        {tab === "settings" && <SettingsTab state={state} actions={actions} />}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ReturnType<typeof useTts>[0]["status"] }) {
  if (!status) return null;
  if (!status.available) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-500">
        <AlertCircle className="h-3 w-3" />
        Not Installed
      </span>
    );
  }
  if (!status.model_downloaded) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-zinc-500/10 px-3 py-1 text-xs font-medium text-zinc-400">
        <Download className="h-3 w-3" />
        Model Required
      </span>
    );
  }
  if (status.model_loaded) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-500">
        <CheckCircle2 className="h-3 w-3" />
        Ready
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-400">
      <HardDrive className="h-3 w-3" />
      Downloaded
    </span>
  );
}

// ── Speak Tab ────────────────────────────────────────────────────────────────

function SpeakTab({
  state,
  actions,
}: {
  state: ReturnType<typeof useTts>[0];
  actions: ReturnType<typeof useTts>[1];
}) {
  const [text, setText] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);

  const needsDownload = state.status?.available && !state.status.model_downloaded;
  const isReady = state.status?.available && state.status.model_downloaded;
  const canSpeak = isReady && text.trim().length > 0 && !state.isSynthesizing;

  const handleSpeak = useCallback(() => {
    if (canSpeak) actions.speak(text);
  }, [canSpeak, text, actions]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSpeak();
      }
    },
    [handleSpeak],
  );

  if (!state.status?.available) {
    return <NotInstalledBanner reason={state.status?.unavailable_reason} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      {needsDownload && (
        <DownloadBanner
          status={state.status!}
          isDownloading={state.isDownloading}
          onDownload={actions.downloadModel}
        />
      )}

      {state.error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <div className="flex-1">
            <p className="text-sm text-red-400">{state.error}</p>
          </div>
          <button onClick={actions.clearError} className="text-red-400 hover:text-red-300">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Text input */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground">Text</label>
          <span className="text-xs text-muted-foreground">
            {text.length.toLocaleString()} characters
          </span>
        </div>
        <textarea
          ref={textRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter text to speak..."
          className="min-h-[160px] w-full resize-y rounded-lg border bg-background p-4 text-sm leading-relaxed focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          disabled={!isReady}
        />
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap items-end gap-4">
        {/* Voice selector */}
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Voice</label>
          <VoiceSelector
            voices={state.voices}
            selected={state.selectedVoice}
            onChange={actions.setSelectedVoice}
            disabled={!isReady}
          />
        </div>

        {/* Speed slider */}
        <div className="w-48 space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Speed</label>
            <span className="text-xs tabular-nums text-muted-foreground">
              {state.speed.toFixed(1)}x
            </span>
          </div>
          <Slider
            min={0.25}
            max={2}
            step={0.05}
            value={[state.speed]}
            onValueChange={([v]) => actions.setSpeed(v)}
            disabled={!isReady}
          />
        </div>

        {/* Speak button */}
        <Button
          onClick={handleSpeak}
          disabled={!canSpeak}
          size="lg"
          className="gap-2"
        >
          {state.isSynthesizing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <AudioLines className="h-4 w-4" />
              Speak
            </>
          )}
        </Button>
      </div>

      {/* Audio player */}
      {state.currentAudioUrl && (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-4">
            <audio
              src={state.currentAudioUrl}
              controls
              autoPlay
              className="h-10 flex-1"
            />
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {state.currentDuration.toFixed(1)}s
              </span>
              <span className="flex items-center gap-1">
                <Zap className="h-3 w-3" />
                {state.currentElapsed.toFixed(2)}s
              </span>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      {state.history.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">Recent</h3>
            <Button variant="ghost" size="sm" onClick={actions.clearHistory} className="h-7 text-xs">
              <Trash2 className="mr-1 h-3 w-3" />
              Clear
            </Button>
          </div>
          <div className="space-y-2">
            {state.history.slice(0, 10).map((entry) => (
              <HistoryItem key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}

      {/* Keyboard shortcut hint */}
      {isReady && (
        <p className="text-center text-xs text-muted-foreground/60">
          Press <kbd className="rounded border px-1.5 py-0.5 text-[10px] font-mono">Cmd+Enter</kbd> to speak
        </p>
      )}
    </div>
  );
}

function HistoryItem({ entry }: { entry: TtsHistoryEntry }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card/50 px-4 py-2.5">
      <audio src={entry.audioUrl} className="hidden" />
      <button
        onClick={() => {
          const a = new Audio(entry.audioUrl);
          a.play();
        }}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20"
      >
        <Play className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{entry.text}</p>
        <p className="text-xs text-muted-foreground">
          {entry.voiceName} &middot; {entry.duration.toFixed(1)}s &middot;{" "}
          {new Date(entry.createdAt).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}

// ── Voice Selector ───────────────────────────────────────────────────────────

function VoiceSelector({
  voices,
  selected,
  onChange,
  disabled,
}: {
  voices: TtsVoice[];
  selected: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectedVoice = voices.find((v) => v.voice_id === selected);

  const grouped = new Map<string, TtsVoice[]>();
  for (const v of voices) {
    if (!grouped.has(v.language)) grouped.set(v.language, []);
    grouped.get(v.language)!.push(v);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border bg-background px-3 text-sm",
          "hover:bg-accent/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span className="truncate">
          {selectedVoice
            ? `${selectedVoice.name} (${selectedVoice.language})`
            : "Select a voice..."}
        </span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border bg-popover shadow-lg">
          {Array.from(grouped).map(([lang, langVoices]) => (
            <div key={lang}>
              <div className="sticky top-0 bg-popover px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                {lang}
              </div>
              {langVoices.map((v) => (
                <button
                  key={v.voice_id}
                  onClick={() => {
                    onChange(v.voice_id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent",
                    v.voice_id === selected && "bg-accent",
                  )}
                >
                  <span className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    v.gender === "female" ? "bg-pink-400" : "bg-blue-400",
                  )} />
                  <span className="flex-1 text-left">{v.name}</span>
                  <span className="text-xs text-muted-foreground">{v.quality_grade}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Voices Tab ───────────────────────────────────────────────────────────────

function VoicesTab({
  state,
  actions,
}: {
  state: ReturnType<typeof useTts>[0];
  actions: ReturnType<typeof useTts>[1];
}) {
  const [search, setSearch] = useState("");
  const [filterLang, setFilterLang] = useState<string | null>(null);
  const [filterGender, setFilterGender] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    loadSettings().then((s) => setFavorites(s.ttsFavoriteVoices ?? []));
  }, []);

  const toggleFavorite = useCallback(
    (voiceId: string) => {
      setFavorites((prev) => {
        const next = prev.includes(voiceId)
          ? prev.filter((id) => id !== voiceId)
          : [...prev, voiceId];
        saveSetting("ttsFavoriteVoices", next);
        return next;
      });
    },
    [],
  );

  const filtered = state.voices.filter((v) => {
    if (search && !v.name.toLowerCase().includes(search.toLowerCase()) && !v.voice_id.includes(search.toLowerCase())) {
      return false;
    }
    if (filterLang && v.language !== filterLang) return false;
    if (filterGender && v.gender !== filterGender) return false;
    return true;
  });

  const favVoices = filtered.filter((v) => favorites.includes(v.voice_id));
  const otherVoices = filtered.filter((v) => !favorites.includes(v.voice_id));

  const languages = [...new Set(state.voices.map((v) => v.language))];

  if (!state.status?.available) {
    return <NotInstalledBanner reason={state.status?.unavailable_reason} />;
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search voices..."
            className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <select
          value={filterLang ?? ""}
          onChange={(e) => setFilterLang(e.target.value || null)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">All Languages</option>
          {languages.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <select
          value={filterGender ?? ""}
          onChange={(e) => setFilterGender(e.target.value || null)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">All Genders</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
        </select>
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {state.voices.length} voices
        </span>
      </div>

      {/* Favorites */}
      {favVoices.length > 0 && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-medium text-amber-400">
            <Star className="h-4 w-4 fill-amber-400" />
            Favorites
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {favVoices.map((v) => (
              <VoiceCard
                key={v.voice_id}
                voice={v}
                isFavorite
                isSelected={v.voice_id === state.selectedVoice}
                isPlaying={state.isPreviewPlaying === v.voice_id}
                onSelect={() => actions.setSelectedVoice(v.voice_id)}
                onPreview={() => actions.preview(v.voice_id)}
                onToggleFavorite={() => toggleFavorite(v.voice_id)}
                modelReady={state.status?.model_downloaded ?? false}
              />
            ))}
          </div>
        </div>
      )}

      {/* All voices by language */}
      {state.languageGroups.map((group) => {
        const groupVoices = otherVoices.filter((v) => v.language === group.language);
        if (groupVoices.length === 0) return null;
        return (
          <div key={group.language} className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              {group.language}
              <span className="ml-2 text-xs font-normal">({groupVoices.length})</span>
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {groupVoices.map((v) => (
                <VoiceCard
                  key={v.voice_id}
                  voice={v}
                  isFavorite={false}
                  isSelected={v.voice_id === state.selectedVoice}
                  isPlaying={state.isPreviewPlaying === v.voice_id}
                  onSelect={() => actions.setSelectedVoice(v.voice_id)}
                  onPreview={() => actions.preview(v.voice_id)}
                  onToggleFavorite={() => toggleFavorite(v.voice_id)}
                  modelReady={state.status?.model_downloaded ?? false}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function VoiceCard({
  voice,
  isFavorite,
  isSelected,
  isPlaying,
  onSelect,
  onPreview,
  onToggleFavorite,
  modelReady,
}: {
  voice: TtsVoice;
  isFavorite: boolean;
  isSelected: boolean;
  isPlaying: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onToggleFavorite: () => void;
  modelReady: boolean;
}) {
  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 rounded-lg border p-3 transition-colors",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/30 hover:bg-accent/50",
      )}
    >
      {/* Preview button */}
      <button
        onClick={onPreview}
        disabled={!modelReady}
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
          isPlaying
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-primary/20 hover:text-primary",
          !modelReady && "cursor-not-allowed opacity-40",
        )}
      >
        {isPlaying ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </button>

      {/* Info */}
      <div className="min-w-0 flex-1 cursor-pointer" onClick={onSelect}>
        <div className="flex items-center gap-2">
          <span className={cn(
            "h-2 w-2 rounded-full shrink-0",
            voice.gender === "female" ? "bg-pink-400" : "bg-blue-400",
          )} />
          <span className="truncate text-sm font-medium">{voice.name}</span>
          {voice.is_default && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              Default
            </span>
          )}
          {voice.is_custom && (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
              Custom
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <span className="capitalize">{voice.gender}</span> &middot; Grade {voice.quality_grade}
          {voice.voice_id !== voice.name && (
            <span className="ml-1 font-mono opacity-60">{voice.voice_id}</span>
          )}
        </p>
      </div>

      {/* Favorite toggle */}
      <button
        onClick={onToggleFavorite}
        className="shrink-0 text-muted-foreground hover:text-amber-400"
      >
        {isFavorite ? (
          <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
        ) : (
          <StarOff className="h-4 w-4 opacity-0 group-hover:opacity-100" />
        )}
      </button>
    </div>
  );
}

// ── Settings Tab ─────────────────────────────────────────────────────────────

function SettingsTab({
  state,
  actions,
}: {
  state: ReturnType<typeof useTts>[0];
  actions: ReturnType<typeof useTts>[1];
}) {
  if (!state.status?.available) {
    return <NotInstalledBanner reason={state.status?.unavailable_reason} />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      {/* Model Status */}
      <section className="space-y-4 rounded-lg border p-5">
        <h3 className="text-sm font-semibold">Model</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <InfoRow label="Status">
            {state.status!.model_downloaded ? (
              <span className="flex items-center gap-1.5 text-emerald-500">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Downloaded
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-amber-500">
                <AlertCircle className="h-3.5 w-3.5" />
                Not downloaded
              </span>
            )}
          </InfoRow>
          <InfoRow label="Loaded">
            {state.status!.model_loaded ? "Yes" : "No"}
          </InfoRow>
          <InfoRow label="Model Directory">
            <span className="break-all font-mono text-xs opacity-70">
              {state.status!.model_dir}
            </span>
          </InfoRow>
          <InfoRow label="Voices Available">
            {state.status!.voice_count}
          </InfoRow>
        </div>
        <div className="flex gap-3 pt-2">
          {!state.status!.model_downloaded && (
            <Button
              onClick={actions.downloadModel}
              disabled={state.isDownloading}
              size="sm"
              className="gap-2"
            >
              {state.isDownloading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Downloading... {state.status!.download_progress.toFixed(0)}%
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" />
                  Download Model (~300 MB)
                </>
              )}
            </Button>
          )}
          {state.status!.model_loaded && (
            <Button onClick={actions.unload} variant="outline" size="sm" className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" />
              Unload from Memory
            </Button>
          )}
        </div>
      </section>

      {/* Defaults */}
      <section className="space-y-4 rounded-lg border p-5">
        <h3 className="text-sm font-semibold">Defaults</h3>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Default Voice</label>
            <VoiceSelector
              voices={state.voices}
              selected={state.selectedVoice}
              onChange={actions.setSelectedVoice}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Default Speed</label>
              <span className="text-xs tabular-nums text-muted-foreground">{state.speed.toFixed(1)}x</span>
            </div>
            <Slider
              min={0.25}
              max={2}
              step={0.05}
              value={[state.speed]}
              onValueChange={([v]) => actions.setSpeed(v)}
            />
          </div>
        </div>
      </section>

      {/* About */}
      <section className="space-y-2 rounded-lg border p-5">
        <h3 className="text-sm font-semibold">About</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Kokoro is an open-weight TTS model with 82 million parameters. Despite its lightweight
          architecture, it delivers quality comparable to larger models while running 3-5x faster
          than real-time on CPU. Apache 2.0 licensed.
        </p>
        <div className="flex gap-3 pt-1">
          <a
            href="https://huggingface.co/hexgrad/Kokoro-82M"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary hover:underline"
          >
            HuggingFace Model Card
          </a>
          <a
            href="https://github.com/thewh1teagle/kokoro-onnx"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary hover:underline"
          >
            kokoro-onnx GitHub
          </a>
        </div>
      </section>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

// ── Shared Banners ───────────────────────────────────────────────────────────

function NotInstalledBanner({ reason }: { reason?: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
        <AlertCircle className="h-8 w-8 text-amber-500" />
      </div>
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">TTS Dependencies Not Installed</h3>
        <p className="max-w-md text-sm text-muted-foreground">
          {reason || "Install the optional TTS packages to enable text-to-speech."}
        </p>
      </div>
      <code className="rounded-lg bg-muted px-4 py-2 text-sm font-mono">
        uv sync --extra tts
      </code>
    </div>
  );
}

function DownloadBanner({
  status,
  isDownloading,
  onDownload,
}: {
  status: { download_progress: number; is_downloading: boolean };
  isDownloading: boolean;
  onDownload: () => void;
}) {
  return (
    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500/10">
          <Download className="h-5 w-5 text-blue-500" />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-medium">Model Download Required</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The Kokoro TTS model (~300 MB) needs to be downloaded before you can generate speech.
          </p>
          {status.is_downloading && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${status.download_progress}%` }}
              />
            </div>
          )}
        </div>
        <Button
          onClick={onDownload}
          disabled={isDownloading}
          size="sm"
          variant="outline"
          className="shrink-0 gap-2"
        >
          {isDownloading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {status.download_progress.toFixed(0)}%
            </>
          ) : (
            <>
              <Download className="h-3.5 w-3.5" />
              Download
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
