import { useState, useRef, useCallback } from "react";
import { Mic, Play, Square, Volume2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiBadge } from "@/components/tools/panels/AiBadge";

interface AudioPanelProps {
  onInvoke: (toolName: string, params: Record<string, unknown>) => Promise<void>;
  loading: boolean;
  result: unknown;
}

function parseOutput(result: unknown): string | null {
  try {
    const d = result as { output?: string; type?: string };
    if (!d || d.type === "error") return null;
    return d.output ?? null;
  } catch { return null; }
}

export function AudioPanel({ onInvoke, loading, result }: AudioPanelProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration]       = useState(0);
  const [filePath, setFilePath]       = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const output = parseOutput(result);

  const startRecording = useCallback(async () => {
    setIsRecording(true);
    setDuration(0);
    timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    // Will record for 10s by default; user stops manually
    const path = `/tmp/matrx-recording-${Date.now()}.wav`;
    setFilePath(path);
    await onInvoke("RecordAudio", { duration: 60, output_path: path });
  }, [onInvoke]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const playback = useCallback(() => {
    if (!filePath) return;
    onInvoke("PlayAudio", { file_path: filePath });
  }, [onInvoke, filePath]);

  const listDevices = useCallback(() => {
    onInvoke("ListAudioDevices", {});
  }, [onInvoke]);

  const formatDuration = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  // A simple waveform visualiser (CSS bars)
  const bars = Array.from({ length: 20 }, (_, i) => i);

  return (
    <div className="flex h-full flex-col gap-4 p-5 overflow-auto">
      <AiBadge text="Your AI can record audio, transcribe speech, and control playback" />

      {/* Recorder */}
      <div className="rounded-2xl border bg-card/50 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Mic className="h-4 w-4 text-rose-400" />
          <h3 className="text-sm font-semibold">Audio Recorder</h3>
        </div>

        {/* Waveform */}
        <div className="flex items-center justify-center gap-[3px] h-16 rounded-xl bg-muted/30">
          {bars.map((b) => (
            <div
              key={b}
              className={`w-1.5 rounded-full bg-rose-400 transition-all ${
                isRecording ? "animate-waveform" : "h-2 opacity-20"
              }`}
              style={isRecording ? {
                animationDelay: `${b * 60}ms`,
                animationDuration: `${600 + (b % 4) * 120}ms`,
              } : {}}
            />
          ))}
        </div>

        {/* Timer */}
        <div className="text-center">
          <span className={`text-4xl font-mono font-bold tabular-nums ${isRecording ? "text-rose-400" : "text-muted-foreground/30"}`}>
            {formatDuration(duration)}
          </span>
        </div>

        {/* Controls */}
        <div className="flex gap-3 justify-center">
          {!isRecording ? (
            <Button onClick={startRecording} disabled={loading} size="lg"
              className="gap-2 bg-rose-500 hover:bg-rose-600 text-white">
              <Mic className="h-5 w-5" /> Record
            </Button>
          ) : (
            <Button onClick={stopRecording} size="lg" variant="destructive" className="gap-2">
              <Square className="h-5 w-5" /> Stop
            </Button>
          )}
          {filePath && !isRecording && (
            <Button onClick={playback} disabled={loading} size="lg" variant="outline" className="gap-2">
              <Play className="h-5 w-5" /> Play
            </Button>
          )}
        </div>

        {isRecording && (
          <p className="text-center text-xs text-rose-400 animate-pulse">
            ● Recording in progress…
          </p>
        )}
      </div>

      {/* Audio devices */}
      <div className="rounded-2xl border bg-card/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold">Audio Devices</h4>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={listDevices} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {output ? (
          <div className="rounded-xl bg-muted/30 p-3 text-xs font-mono text-foreground whitespace-pre-wrap max-h-40 overflow-auto">
            {output}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Click refresh to list audio devices</p>
        )}
      </div>

      {/* Transcription note */}
      <div className="rounded-xl border border-dashed border-primary/20 p-3 text-center">
        <p className="text-xs text-muted-foreground">
          💡 Use <span className="font-mono text-primary">TranscribeAudio</span> in Advanced mode to get text from audio files
        </p>
      </div>
    </div>
  );
}
