import { useState, useRef, useCallback, useEffect } from "react";
import {
  ArrowUp,
  Square,
  Plus,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMode } from "@/hooks/use-chat";
import type { AgentInfo } from "@/types/agents";

interface ChatInputProps {
  onSend: (message: string) => void | Promise<void>;
  onStop: () => void;
  isStreaming: boolean;
  mode: ChatMode;
  model: string;
  availableModels: { id: string; label: string; provider?: string; default?: boolean }[];
  onModelChange: (model: string) => void;
  onModeChange: (mode: ChatMode) => void;
  /** When true, the send button is disabled but the textarea remains typeable. */
  engineReady?: boolean;
  // Agent props
  agents?: AgentInfo[];
  selectedAgentId?: string | null;
  onAgentChange?: (agentId: string | null) => void;
  agentsLoading?: boolean;
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
  engineReady = true,
  agents = [],
  selectedAgentId = null,
  onAgentChange,
  agentsLoading = false,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const agentDropdownRef = useRef<HTMLDivElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
      if (agentDropdownRef.current && !agentDropdownRef.current.contains(e.target as Node)) {
        setShowAgentDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const canSend = value.trim().length > 0 && !isStreaming && engineReady;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    onSend(value);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [canSend, value, onSend]);

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
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            {modeLabels[m]}
          </button>
        ))}
      </div>

      {/* Composer Container */}
      <div className="glass relative rounded-2xl transition-shadow focus-within:shadow-md">
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            !engineReady
              ? "Waiting for engine..."
              : mode === "code"
              ? "Write or ask about code..."
              : mode === "co-work"
              ? "What would you like to work on together?"
              : "Message AI Matrx..."
          }
          rows={1}
          className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[0.9375rem] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
        />

        {/* Bottom bar */}
        <div className="flex items-center justify-between px-3 pb-2.5">
          {/* Left: Attach + Agent + Model */}
          <div className="flex items-center gap-1">
            {/* Attach / plus button */}
            <button
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
              title="Attach files"
            >
              <Plus className="h-4 w-4" />
            </button>

            {/* Agent selector */}
            {onAgentChange && (
              <div className="relative" ref={agentDropdownRef}>
                <button
                  onClick={() => setShowAgentDropdown(!showAgentDropdown)}
                  className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span className="max-w-[120px] truncate">
                    {selectedAgentId
                      ? (agents.find((a) => a.id === selectedAgentId)?.name ?? "Agent")
                      : "No Agent"}
                  </span>
                  <ChevronDown className="h-3 w-3" />
                </button>

                {showAgentDropdown && (
                  <div className="glass absolute bottom-full left-0 mb-1.5 min-w-[220px] max-h-72 overflow-y-auto rounded-lg p-1.5">
                    {agentsLoading ? (
                      <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                        Loading…
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => { onAgentChange(null); setShowAgentDropdown(false); }}
                          className={cn(
                            "flex w-full items-center rounded-md px-3 py-2 text-left text-xs transition-colors",
                            !selectedAgentId
                              ? "bg-accent text-accent-foreground"
                              : "text-foreground hover:bg-accent/50"
                          )}
                        >
                          <span className="font-medium">No Agent</span>
                          <span className="ml-1.5 text-muted-foreground">— plain chat</span>
                        </button>
                        {agents.length > 0 && (
                          <div className="my-1 border-t border-border/50" />
                        )}
                        {agents.map((agent) => (
                          <button
                            key={agent.id}
                            onClick={() => { onAgentChange(agent.id); setShowAgentDropdown(false); }}
                            className={cn(
                              "flex w-full items-center rounded-md px-3 py-2 text-left text-xs transition-colors",
                              selectedAgentId === agent.id
                                ? "bg-accent text-accent-foreground"
                                : "text-foreground hover:bg-accent/50"
                            )}
                          >
                            <div className="flex-1 min-w-0">
                              <span className="font-medium block truncate">{agent.name}</span>
                              {agent.description && (
                                <span className="text-muted-foreground truncate block mt-0.5">
                                  {agent.description}
                                </span>
                              )}
                            </div>
                            {agent.source === "user" && (
                              <span className="ml-auto text-[10px] text-muted-foreground shrink-0">mine</span>
                            )}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Model selector */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowModelDropdown(!showModelDropdown)}
                className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <span className="max-w-[140px] truncate">
                  {selectedModel?.label ?? "Select model"}
                </span>
                <ChevronDown className="h-3 w-3" />
              </button>

              {showModelDropdown && (
                <div className="glass absolute bottom-full left-0 mb-1.5 min-w-[240px] max-h-80 overflow-y-auto rounded-lg p-1.5">
                  {Object.entries(
                    availableModels.reduce<Record<string, typeof availableModels>>((acc, m) => {
                      const p = m.provider ?? "other";
                      if (!acc[p]) acc[p] = [];
                      acc[p].push(m);
                      return acc;
                    }, {})
                  ).map(([provider, models]) => (
                    <div key={provider}>
                      <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                        {provider}
                      </div>
                      {models.map((m) => (
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
                            <span className="ml-auto text-[10px] text-muted-foreground">default</span>
                          )}
                        </button>
                      ))}
                    </div>
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
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend}
                title={!engineReady ? "Engine not connected" : undefined}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200",
                  !canSend
                    ? "bg-muted-foreground/30 text-primary-foreground opacity-30 cursor-not-allowed"
                    : "bg-primary text-primary-foreground active:scale-[0.96]"
                )}
              >
                <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <p className="mt-2 text-center text-[10px] text-muted-foreground">
        AI Matrx can make mistakes. Verify important information.
      </p>
    </div>
  );
}
