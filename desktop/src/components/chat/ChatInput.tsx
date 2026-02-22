import { useState, useRef, useCallback, useEffect } from "react";
import {
  Send,
  Square,
  Paperclip,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ChatMode } from "@/hooks/use-chat";

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  mode: ChatMode;
  model: string;
  availableModels: { id: string; label: string; default?: boolean }[];
  onModelChange: (model: string) => void;
  onModeChange: (mode: ChatMode) => void;
  disabled?: boolean;
}

const modeLabels: Record<ChatMode, string> = {
  chat: "Chat",
  "co-work": "Co-Work",
  code: "Code",
};


export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  mode,
  model,
  availableModels,
  onModelChange,
  onModeChange,
  disabled,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSend = useCallback(() => {
    if (!value.trim() || isStreaming || disabled) return;
    onSend(value);
    setValue("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, isStreaming, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const selectedModel = availableModels.find((m) => m.id === model);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4 md:px-8">
      {/* Mode Tabs */}
      <div className="mb-2 flex items-center gap-1">
        {(Object.keys(modeLabels) as ChatMode[]).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            className={cn(
              "rounded-full px-3.5 py-1 text-xs font-medium transition-colors",
              mode === m
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {modeLabels[m]}
          </button>
        ))}
      </div>

      {/* Input Container */}
      <div className="relative rounded-2xl border border-border/60 bg-muted/30 shadow-sm transition-colors focus-within:border-primary/30 focus-within:shadow-md">
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            mode === "code"
              ? "Write or ask about code..."
              : mode === "co-work"
              ? "What would you like to work on together?"
              : "Message AI Matrx..."
          }
          rows={1}
          disabled={disabled}
          className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-50"
        />

        {/* Bottom bar */}
        <div className="flex items-center justify-between px-3 pb-2">
          {/* Left: Model selector + attachments */}
          <div className="flex items-center gap-1.5">
            {/* Model selector */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowModelDropdown(!showModelDropdown)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <span className="max-w-[120px] truncate">
                  {selectedModel?.label ?? "Select model"}
                </span>
                <ChevronDown className="h-3 w-3" />
              </button>

              {showModelDropdown && (
                <div className="absolute bottom-full left-0 mb-1 min-w-[200px] rounded-lg border bg-popover p-1 shadow-lg">
                  {availableModels.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        onModelChange(m.id);
                        setShowModelDropdown(false);
                      }}
                      className={cn(
                        "flex w-full items-center rounded-md px-3 py-2 text-left text-xs transition-colors",
                        model === m.id
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground hover:bg-accent/50"
                      )}
                    >
                      <span className="font-medium">{m.label}</span>
                      {m.default && (
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          default
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Attach button */}
            <button className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <Paperclip className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Right: Send / Stop button */}
          <div>
            {isStreaming ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20"
                onClick={onStop}
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="icon"
                variant="ghost"
                className={cn(
                  "h-8 w-8 rounded-full transition-colors",
                  value.trim()
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "text-muted-foreground"
                )}
                onClick={handleSend}
                disabled={!value.trim() || disabled}
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <p className="mt-1.5 text-center text-[10px] text-muted-foreground/50">
        AI Matrx can make mistakes. Verify important information.
      </p>
    </div>
  );
}
