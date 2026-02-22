import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Square, Play, Volume2, RefreshCw, Image, FileText, Archive, Camera, Type } from "lucide-react";
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

function parseOutput(result: unknown): { text?: string; image?: string; file_path?: string } | null {
  try {
    const d = result as { output?: string; type?: string; metadata?: Record<string, unknown> };
    if (!d || d.type === "error") return null;
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
  const [duration, setDuration]       = useState(0);
  const [filePath, setFilePath]       = useState("");
  const [view, setView]               = useState<"audio" | "images" | "documents" | "archives">("audio");
  const [mediaPath, setMediaPath]     = useState("");
  const [transcription, setTranscription] = useState<string | null>(null);
  const [imagePreview, setImagePreview]   = useState<string | null>(null);
  const [ocrText]                     = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const output = parseOutput(result);

  // Check for image data in results
  useEffect(() => {
    if (output?.image) setImagePreview(output.image);
    if (output?.text && view === "images" && ocrText === null) {
      // might be OCR result
    }
  }, [output, view, ocrText]);

  const startRecording = useCallback(async () => {
    setIsRecording(true);
    setDuration(0);
    setTranscription(null);
    timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    const path = `/tmp/matrx-recording-${Date.now()}.wav`;
    setFilePath(path);
    await onInvoke("RecordAudio", { duration_seconds: 60, file_path: path });
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }, [onInvoke]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const playback = useCallback(() => {
    if (!filePath) return;
    onInvoke("PlayAudio", { file_path: filePath });
  }, [onInvoke, filePath]);

  const transcribe = useCallback(() => {
    if (!filePath) return;
    onInvoke("TranscribeAudio", { file_path: filePath }).then(() => {
      // Result will come via output
      if (output?.text) setTranscription(output.text);
    });
  }, [onInvoke, filePath, output]);

  const listDevices = useCallback(() => {
    onInvoke("ListAudioDevices", {});
  }, [onInvoke]);

  // Update transcription from result
  useEffect(() => {
    if (output?.text && filePath && !isRecording) {
      setTranscription(output.text);
    }
  }, [output, filePath, isRecording]);

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
          <ToolSection title="Audio Recorder" icon={Mic} iconColor="text-rose-400">
            {/* Waveform */}
            <div className="flex items-center justify-center gap-[2px] h-16 rounded-xl bg-muted/30 mb-4">
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
            <div className="text-center mb-4">
              <span className={cn(
                "text-4xl font-mono font-bold tabular-nums",
                isRecording ? "text-rose-400" : "text-muted-foreground/30"
              )}>
                {formatDuration(duration)}
              </span>
            </div>

            {/* Transport controls */}
            <div className="flex gap-3 justify-center mb-2">
              {!isRecording ? (
                <Button onClick={startRecording} disabled={loading} size="lg"
                  className="gap-2 bg-rose-500 hover:bg-rose-600 text-white rounded-full px-8">
                  <Mic className="h-5 w-5" /> Record
                </Button>
              ) : (
                <Button onClick={stopRecording} size="lg" variant="destructive" className="gap-2 rounded-full px-8">
                  <Square className="h-5 w-5" /> Stop
                </Button>
              )}
              {filePath && !isRecording && (
                <>
                  <Button onClick={playback} disabled={loading} size="lg" variant="outline" className="gap-2 rounded-full">
                    <Play className="h-5 w-5" /> Play
                  </Button>
                  <Button onClick={transcribe} disabled={loading} size="lg" variant="outline" className="gap-2 rounded-full">
                    <Type className="h-5 w-5" /> Transcribe
                  </Button>
                </>
              )}
            </div>

            {isRecording && (
              <p className="text-center text-xs text-rose-400 animate-pulse mt-1">Recording in progress...</p>
            )}
          </ToolSection>

          {/* Transcription output */}
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
            {output?.text && !isRecording && !transcription ? (
              <pre className="text-xs font-mono text-foreground whitespace-pre-wrap max-h-40 overflow-auto">{output.text}</pre>
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
