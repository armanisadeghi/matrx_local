import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Square, Play, Volume2, RefreshCw, Image, FileText, Archive, Camera, Type, Upload, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToolSection } from "@/components/tools/shared/ToolSection";
import { OutputCard } from "@/components/tools/shared/OutputCard";
import type { ToolUISchema } from "@/types/tool-schema";
import { cn } from "@/lib/utils";

interface AudioMediaPanelProps {
  onInvoke: (toolName: string, params: Record<string, unknown>) => Promise<void>;
  loading: boolean;
  result: unknown;
  tools?: ToolUISchema[];
}

function parseOutput(result: unknown): { text?: string; image?: string; file_path?: string; type?: string } | null {
  try {
    const d = result as { output?: string; type?: string; metadata?: Record<string, unknown> };
    if (!d) return null;
    if (d.type === "error") return { text: d.output, type: "error" };
    if (d.output) {
      try {
        const j = JSON.parse(d.output);
        if (typeof j === "object" && j !== null) return j;
        return { text: d.output };
      } catch {
        return { text: d.output };
      }
    }
    return null;
  } catch { return null; }
}

export function AudioMediaPanel({ onInvoke, loading, result }: AudioMediaPanelProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [duration, setDuration]       = useState(0);
  const [recordDuration, setRecordDuration] = useState(30);
  const [filePath, setFilePath]       = useState("");
  const [audioMode, setAudioMode]     = useState<"live" | "file">("live");
  const [transcribeFilePath, setTranscribeFilePath] = useState("");
  const [whisperModel, setWhisperModel] = useState<"tiny" | "base" | "small">("base");
  const [view, setView]               = useState<"audio" | "images" | "documents" | "archives">("audio");
  const [mediaPath, setMediaPath]     = useState("");
  const [transcription, setTranscription] = useState<string | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [imagePreview, setImagePreview]   = useState<string | null>(null);
  const [deviceOutput, setDeviceOutput]   = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastToolRef = useRef<string>("");

  const output = parseOutput(result);

  // Route results to the right state based on which tool was last invoked
  useEffect(() => {
    if (!output) return;
    const tool = lastToolRef.current;
    if (tool === "TranscribeAudio") {
      if (output.type === "error") {
        setTranscriptionError(output.text ?? "Transcription failed");
        setTranscription(null);
      } else if (output.text) {
        setTranscription(output.text);
        setTranscriptionError(null);
      }
      setIsTranscribing(false);
    } else if (tool === "ListAudioDevices") {
      setDeviceOutput(output.text ?? null);
    } else if (output?.image) {
      setImagePreview(output.image);
    }
  }, [output]); // eslint-disable-line react-hooks/exhaustive-deps

  const startRecording = useCallback(async () => {
    setIsRecording(true);
    setDuration(0);
    setTranscription(null);
    setTranscriptionError(null);
    timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    const path = `/tmp/matrx-recording-${Date.now()}.wav`;
    setFilePath(path);
    lastToolRef.current = "RecordAudio";
    await onInvoke("RecordAudio", { duration_seconds: recordDuration, file_path: path });
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }, [onInvoke, recordDuration]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const playback = useCallback(() => {
    if (!filePath) return;
    lastToolRef.current = "PlayAudio";
    onInvoke("PlayAudio", { file_path: filePath });
  }, [onInvoke, filePath]);

  const transcribeRecorded = useCallback(async () => {
    if (!filePath) return;
    setIsTranscribing(true);
    setTranscription(null);
    setTranscriptionError(null);
    lastToolRef.current = "TranscribeAudio";
    await onInvoke("TranscribeAudio", { file_path: filePath, model: whisperModel });
  }, [onInvoke, filePath, whisperModel]);

  const transcribeFile = useCallback(async () => {
    if (!transcribeFilePath) return;
    setIsTranscribing(true);
    setTranscription(null);
    setTranscriptionError(null);
    lastToolRef.current = "TranscribeAudio";
    await onInvoke("TranscribeAudio", { file_path: transcribeFilePath, model: whisperModel });
  }, [onInvoke, transcribeFilePath, whisperModel]);

  const recordAndTranscribe = useCallback(async () => {
    setIsRecording(true);
    setDuration(0);
    setTranscription(null);
    setTranscriptionError(null);
    timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    const path = `/tmp/matrx-recording-${Date.now()}.wav`;
    setFilePath(path);
    lastToolRef.current = "RecordAudio";
    await onInvoke("RecordAudio", { duration_seconds: recordDuration, file_path: path });
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    // Auto-transcribe after recording
    setIsTranscribing(true);
    lastToolRef.current = "TranscribeAudio";
    await onInvoke("TranscribeAudio", { file_path: path, model: whisperModel });
  }, [onInvoke, recordDuration, whisperModel]);

  const listDevices = useCallback(() => {
    lastToolRef.current = "ListAudioDevices";
    onInvoke("ListAudioDevices", {});
  }, [onInvoke]);

  const formatDuration = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const bars = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="flex h-full flex-col gap-4 p-5 overflow-auto">
      {/* View switcher */}
      <div className="flex gap-1 rounded-xl border bg-muted/20 p-1">
        {([
          { key: "audio", label: "Audio", icon: Mic },
          { key: "images", label: "Images", icon: Image },
          { key: "documents", label: "PDF & OCR", icon: FileText },
          { key: "archives", label: "Archives", icon: Archive },
        ] as const).map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all",
              view === v.key ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            )}>
            <v.icon className="h-3.5 w-3.5" />
            {v.label}
          </button>
        ))}
      </div>

      {/* ── AUDIO ── */}
      {view === "audio" && (
        <>
          {/* Audio mode tabs */}
          <div className="flex gap-1 rounded-lg border bg-muted/10 p-0.5 self-start">
            {([
              { key: "live", label: "Live Mic", icon: Mic },
              { key: "file", label: "From File", icon: Upload },
            ] as const).map((m) => (
              <button key={m.key} onClick={() => setAudioMode(m.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all",
                  audioMode === m.key ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                )}>
                <m.icon className="h-3 w-3" />
                {m.label}
              </button>
            ))}
          </div>

          {/* ── LIVE MIC ── */}
          {audioMode === "live" && (
            <ToolSection title="Live Microphone" icon={Mic} iconColor="text-rose-400">
              {/* Waveform */}
              <div className="flex items-center justify-center gap-[2px] h-14 rounded-xl bg-muted/30 mb-3">
                {bars.map((b) => (
                  <div
                    key={b}
                    className={cn(
                      "w-1 rounded-full bg-rose-400 transition-all",
                      isRecording ? "animate-waveform" : "h-1.5 opacity-20"
                    )}
                    style={isRecording ? {
                      animationDelay: `${b * 50}ms`,
                      animationDuration: `${500 + (b % 5) * 100}ms`,
                    } : {}}
                  />
                ))}
              </div>

              {/* Timer */}
              <div className="text-center mb-3">
                <span className={cn(
                  "text-3xl font-mono font-bold tabular-nums",
                  isRecording ? "text-rose-400" : isTranscribing ? "text-amber-400" : "text-muted-foreground/30"
                )}>
                  {formatDuration(duration)}
                </span>
                {isTranscribing && (
                  <p className="text-xs text-amber-400 animate-pulse mt-1">Transcribing...</p>
                )}
              </div>

              {/* Duration + model settings */}
              {!isRecording && !isTranscribing && (
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex items-center gap-1.5 flex-1">
                    <span className="text-xs text-muted-foreground shrink-0">Duration:</span>
                    <div className="flex gap-1">
                      {[15, 30, 60, 120].map((d) => (
                        <button key={d} onClick={() => setRecordDuration(d)}
                          className={cn(
                            "rounded-md px-2 py-0.5 text-[11px] font-medium border transition-colors",
                            recordDuration === d
                              ? "border-rose-500/60 bg-rose-500/10 text-rose-400"
                              : "border-border text-muted-foreground hover:text-foreground"
                          )}>
                          {d < 60 ? `${d}s` : `${d / 60}m`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground shrink-0">Model:</span>
                    <select
                      value={whisperModel}
                      onChange={(e) => setWhisperModel(e.target.value as typeof whisperModel)}
                      className="rounded-md border bg-background px-2 py-0.5 text-xs text-foreground"
                    >
                      <option value="tiny">Tiny (fast)</option>
                      <option value="base">Base</option>
                      <option value="small">Small (accurate)</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Transport controls */}
              <div className="flex gap-2 justify-center mb-1 flex-wrap">
                {!isRecording && !isTranscribing ? (
                  <>
                    <Button onClick={startRecording} disabled={loading} size="sm"
                      className="gap-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded-full px-5">
                      <Mic className="h-4 w-4" /> Record Only
                    </Button>
                    <Button onClick={recordAndTranscribe} disabled={loading} size="sm"
                      className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-full px-5">
                      <Wand2 className="h-4 w-4" /> Record & Transcribe
                    </Button>
                  </>
                ) : isRecording ? (
                  <Button onClick={stopRecording} size="sm" variant="destructive" className="gap-1.5 rounded-full px-5">
                    <Square className="h-4 w-4" /> Stop
                  </Button>
                ) : null}
                {filePath && !isRecording && !isTranscribing && (
                  <>
                    <Button onClick={playback} disabled={loading} size="sm" variant="outline" className="gap-1.5 rounded-full">
                      <Play className="h-4 w-4" /> Play
                    </Button>
                    <Button onClick={transcribeRecorded} disabled={loading} size="sm" variant="outline" className="gap-1.5 rounded-full">
                      <Type className="h-4 w-4" /> Transcribe
                    </Button>
                  </>
                )}
              </div>

              {isRecording && (
                <p className="text-center text-xs text-rose-400 animate-pulse mt-1">Recording... {formatDuration(recordDuration - duration)} remaining</p>
              )}
            </ToolSection>
          )}

          {/* ── FROM FILE ── */}
          {audioMode === "file" && (
            <ToolSection title="Transcribe Audio File" icon={Upload} iconColor="text-violet-400">
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Transcribe any audio file (WAV, MP3, M4A, FLAC) using Whisper.
                </p>
                <Input
                  value={transcribeFilePath}
                  onChange={(e) => setTranscribeFilePath(e.target.value)}
                  placeholder="/path/to/audio.wav"
                  className="text-xs font-mono"
                />
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground shrink-0">Model:</span>
                    <select
                      value={whisperModel}
                      onChange={(e) => setWhisperModel(e.target.value as typeof whisperModel)}
                      className="rounded-md border bg-background px-2 py-0.5 text-xs text-foreground"
                    >
                      <option value="tiny">Tiny (fast)</option>
                      <option value="base">Base</option>
                      <option value="small">Small (accurate)</option>
                    </select>
                  </div>
                  <Button onClick={transcribeFile} disabled={loading || !transcribeFilePath || isTranscribing}
                    size="sm" className="gap-1.5">
                    {isTranscribing ? (
                      <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Transcribing...</>
                    ) : (
                      <><Type className="h-3.5 w-3.5" /> Transcribe</>
                    )}
                  </Button>
                </div>
              </div>
            </ToolSection>
          )}

          {/* Transcription output */}
          {transcriptionError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3">
              <p className="text-xs text-red-400 font-medium mb-1">Transcription failed</p>
              <p className="text-xs text-muted-foreground font-mono">{transcriptionError}</p>
            </div>
          )}
          {transcription && (
            <OutputCard title="Transcription" content={transcription} status="success" />
          )}

          {/* Audio devices */}
          <ToolSection title="Audio Devices" icon={Volume2} iconColor="text-muted-foreground"
            actions={
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={listDevices} disabled={loading}>
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </Button>
            }>
            {deviceOutput ? (
              <pre className="text-xs font-mono text-foreground whitespace-pre-wrap max-h-40 overflow-auto">{deviceOutput}</pre>
            ) : (
              <p className="text-xs text-muted-foreground">Click refresh to list audio devices</p>
            )}
          </ToolSection>
        </>
      )}

      {/* ── IMAGES ── */}
      {view === "images" && (
        <>
          <ToolSection title="Image Operations" icon={Image} iconColor="text-rose-400">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={mediaPath}
                  onChange={(e) => setMediaPath(e.target.value)}
                  placeholder="/path/to/image.png"
                  className="text-xs font-mono flex-1"
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1.5 flex-1"
                  onClick={() => onInvoke("ImageOCR", { file_path: mediaPath })} disabled={loading || !mediaPath}>
                  <Type className="h-3.5 w-3.5" /> OCR
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 flex-1"
                  onClick={() => onInvoke("ImageResize", { file_path: mediaPath, scale: 0.5 })} disabled={loading || !mediaPath}>
                  <Image className="h-3.5 w-3.5" /> Resize 50%
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 flex-1"
                  onClick={() => onInvoke("Screenshot", {})} disabled={loading}>
                  <Camera className="h-3.5 w-3.5" /> Screenshot
                </Button>
              </div>
            </div>
          </ToolSection>

          {/* Image preview */}
          {imagePreview && (
            <OutputCard title="Image Preview" content="" format="image" imageData={imagePreview} status="success" />
          )}

          {/* OCR / text result */}
          {output?.text && !imagePreview && (
            <OutputCard title="Result" content={output.text} status="success" />
          )}
        </>
      )}

      {/* ── PDF & OCR ── */}
      {view === "documents" && (
        <ToolSection title="PDF & Document Processing" icon={FileText} iconColor="text-rose-400">
          <div className="space-y-3">
            <Input
              value={mediaPath}
              onChange={(e) => setMediaPath(e.target.value)}
              placeholder="/path/to/document.pdf"
              className="text-xs font-mono"
            />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1.5 flex-1"
                onClick={() => onInvoke("PdfExtract", { file_path: mediaPath })} disabled={loading || !mediaPath}>
                <FileText className="h-3.5 w-3.5" /> Extract Text
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 flex-1"
                onClick={() => onInvoke("PdfExtract", { file_path: mediaPath, extract_images: true })} disabled={loading || !mediaPath}>
                <Image className="h-3.5 w-3.5" /> Extract Images
              </Button>
            </div>
            {output?.text && (
              <OutputCard title="Extracted Content" content={output.text} maxHeight={400} />
            )}
          </div>
        </ToolSection>
      )}

      {/* ── ARCHIVES ── */}
      {view === "archives" && (
        <ToolSection title="Archive Operations" icon={Archive} iconColor="text-rose-400">
          <div className="space-y-3">
            <Input
              value={mediaPath}
              onChange={(e) => setMediaPath(e.target.value)}
              placeholder="/path/to/archive.zip"
              className="text-xs font-mono"
            />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1.5 flex-1"
                onClick={() => onInvoke("ArchiveExtract", { file_path: mediaPath })} disabled={loading || !mediaPath}>
                <Archive className="h-3.5 w-3.5" /> Extract
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 flex-1"
                onClick={() => onInvoke("ArchiveCreate", { source_paths: [mediaPath] })} disabled={loading || !mediaPath}>
                <Archive className="h-3.5 w-3.5" /> Compress
              </Button>
            </div>
            {output?.text && (
              <OutputCard title="Result" content={output.text} />
            )}
          </div>
        </ToolSection>
      )}
    </div>
  );
}
