import { useState, useRef, useCallback, useEffect } from "react";
import {
  ArrowUp,
  Square,
  Plus,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
    <div className="mx-auto w-full max-w-3xl px-4 pb-4 pt-2 md:px-8">
      {/* Mode Tabs — centered above composer */}
      <div className="mb-3 flex items-center justify-center gap-1">
        {(Object.keys(modeLabels) as ChatMode[]).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            className={cn(
              "rounded-full px-4 py-1.5 text-xs font-medium transition-all duration-200",
              mode === m
                ? "text-white shadow-sm"
                : "hover:opacity-80"
            )}
            style={{
              background: mode === m ? "var(--chat-accent)" : "transparent",
              color: mode === m ? "#fff" : "var(--chat-text-muted)",
            }}
          >
            {modeLabels[m]}
          </button>
        ))}
      </div>

      {/* Composer Container */}
      <div
        className="relative rounded-2xl transition-shadow focus-within:shadow-md"
        style={{
          background: "var(--chat-composer-bg)",
          border: "1px solid var(--chat-composer-border)",
          boxShadow: "var(--chat-composer-shadow)",
        }}
      >
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
          className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[0.9375rem] leading-relaxed focus:outline-none disabled:opacity-50"
          style={{
            color: "var(--chat-text)",
          }}
        />

        {/* Bottom bar */}
        <div className="flex items-center justify-between px-3 pb-2.5">
          {/* Left: Attach + Model */}
          <div className="flex items-center gap-1">
            {/* Attach / plus button */}
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
              style={{ color: "var(--chat-text-muted)" }}
              title="Attach files"
            >
              <Plus className="h-4 w-4" />
            </button>

            {/* Model selector */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowModelDropdown(!showModelDropdown)}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition-colors"
                style={{ color: "var(--chat-text-muted)" }}
              >
                <span className="max-w-[140px] truncate">
                  {selectedModel?.label ?? "Select model"}
                </span>
                <ChevronDown className="h-3 w-3" />
              </button>

              {showModelDropdown && (
                <div
                  className="absolute bottom-full left-0 mb-1.5 min-w-[220px] rounded-xl p-1.5 shadow-lg"
                  style={{
                    background: "var(--chat-composer-bg)",
                    border: "1px solid var(--chat-composer-border)",
                  }}
                >
                  {availableModels.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        onModelChange(m.id);
                        setShowModelDropdown(false);
                      }}
                      className={cn(
                        "flex w-full items-center rounded-lg px-3 py-2.5 text-left text-xs transition-colors",
                      )}
                      style={{
                        background:
                          model === m.id
                            ? "var(--chat-sidebar-hover)"
                            : "transparent",
                        color: "var(--chat-text)",
                      }}
                    >
                      <span className="font-medium">{m.label}</span>
                      {m.default && (
                        <span
                          className="ml-auto text-[10px]"
                          style={{ color: "var(--chat-text-faint)" }}
                        >
                          default
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Send / Stop */}
          <div>
            {isStreaming ? (
              <button
                onClick={onStop}
                className="flex h-8 w-8 items-center justify-center rounded-full transition-colors"
                style={{
                  background: "var(--chat-accent)",
                  color: "#fff",
                }}
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!value.trim() || disabled}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200",
                  !value.trim() || disabled
                    ? "opacity-30 cursor-not-allowed"
                    : "active:scale-[0.96]"
                )}
                style={{
                  background:
                    value.trim() && !disabled
                      ? "var(--chat-accent)"
                      : "var(--chat-text-faint)",
                  color: "#fff",
                }}
              >
                <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <p
        className="mt-2 text-center text-[10px]"
        style={{ color: "var(--chat-text-faint)" }}
      >
        AI Matrx can make mistakes. Verify important information.
      </p>
    </div>
  );
}
