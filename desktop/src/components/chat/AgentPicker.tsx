import { useState, useRef, useEffect } from "react";
import { Search, Bot, User, Share2, X, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentInfo, AgentSource } from "@/types/agents";

// ============================================================================
// TYPES
// ============================================================================

interface AgentPickerProps {
  builtins: AgentInfo[];
  userAgents: AgentInfo[];
  sharedAgents: AgentInfo[];
  isLoading: boolean;
  selectedAgentId: string | null;
  onSelect: (agent: AgentInfo) => void;
  onClose: () => void;
  isOpen: boolean;
}

// ============================================================================
// SECTION HEADER
// ============================================================================

function SectionHeader({
  icon: Icon,
  label,
  count,
  isOpen,
  onToggle,
}: {
  icon: React.ElementType;
  label: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wide"
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
      <span className="ml-auto text-[10px] bg-muted rounded-full px-1.5 py-0.5 font-normal normal-case tracking-normal">
        {count}
      </span>
      {isOpen ? (
        <ChevronDown className="w-3 h-3" />
      ) : (
        <ChevronRight className="w-3 h-3" />
      )}
    </button>
  );
}

// ============================================================================
// AGENT ROW
// ============================================================================

function AgentRow({
  agent,
  isSelected,
  onSelect,
}: {
  agent: AgentInfo;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const hasVars = agent.variable_defaults.length > 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left px-3 py-2.5 rounded-lg transition-all",
        "flex items-start gap-3",
        isSelected
          ? "bg-primary/10 text-foreground"
          : "hover:bg-accent text-foreground"
      )}
    >
      <Bot className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-medium truncate">{agent.name}</span>
          {hasVars && (
            <span className="shrink-0 text-[10px] bg-primary/10 text-primary rounded px-1 py-0.5 font-medium">
              {agent.variable_defaults.length} var{agent.variable_defaults.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {agent.description && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {agent.description}
          </p>
        )}
      </div>
      {isSelected && (
        <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
      )}
    </button>
  );
}

// ============================================================================
// AGENT SECTION
// ============================================================================

function AgentSection({
  icon,
  label,
  agents,
  selectedId,
  onSelect,
  defaultOpen = true,
}: {
  icon: React.ElementType;
  label: string;
  agents: AgentInfo[];
  selectedId: string | null;
  onSelect: (agent: AgentInfo) => void;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (agents.length === 0) return null;

  return (
    <div>
      <SectionHeader
        icon={icon}
        label={label}
        count={agents.length}
        isOpen={isOpen}
        onToggle={() => setIsOpen((o) => !o)}
      />
      {isOpen && (
        <div className="px-1.5 pb-1 space-y-0.5">
          {agents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              isSelected={selectedId === agent.id}
              onSelect={() => onSelect(agent)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function AgentPicker({
  builtins,
  userAgents,
  sharedAgents,
  isLoading,
  selectedAgentId,
  onSelect,
  onClose,
  isOpen,
}: AgentPickerProps) {
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filterAgents = (agents: AgentInfo[]) => {
    if (!search.trim()) return agents;
    const q = search.toLowerCase();
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q)
    );
  };

  const filteredBuiltins = filterAgents(builtins);
  const filteredUser = filterAgents(userAgents);
  const filteredShared = filterAgents(sharedAgents);
  const totalVisible = filteredBuiltins.length + filteredUser.length + filteredShared.length;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="absolute bottom-full mb-2 left-0 right-0 z-50 bg-popover border border-border rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[60vh]">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents…"
            className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* "No agent" option */}
        <div className="px-1.5 pt-1.5">
          <button
            type="button"
            onClick={() => onSelect({ id: "", name: "No Agent", description: "Direct chat with the selected model", source: "builtin" as AgentSource, variable_defaults: [], settings: { stream: true, tools: [] } })}
            className={cn(
              "w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2",
              !selectedAgentId
                ? "bg-primary/10 text-foreground"
                : "hover:bg-accent text-muted-foreground hover:text-foreground"
            )}
          >
            <span className="w-4 h-4 flex items-center justify-center text-lg">✦</span>
            <span className="font-medium">No Agent</span>
            <span className="text-xs text-muted-foreground ml-1">— plain chat</span>
          </button>
        </div>

        {/* Scrollable list */}
        <div className="overflow-y-auto flex-1 py-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading agents…
            </div>
          ) : totalVisible === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No agents match "{search}"
            </p>
          ) : (
            <>
              <AgentSection
                icon={Bot}
                label="System Agents"
                agents={filteredBuiltins}
                selectedId={selectedAgentId}
                onSelect={onSelect}
                defaultOpen={true}
              />
              <AgentSection
                icon={User}
                label="My Agents"
                agents={filteredUser}
                selectedId={selectedAgentId}
                onSelect={onSelect}
                defaultOpen={filteredBuiltins.length === 0}
              />
              <AgentSection
                icon={Share2}
                label="Shared With Me"
                agents={filteredShared}
                selectedId={selectedAgentId}
                onSelect={onSelect}
                defaultOpen={false}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default AgentPicker;
