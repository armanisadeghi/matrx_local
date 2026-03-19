import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  Search,
  X,
  Check,
  ChevronDown,
  Star,
  User,
  Cpu,
  Users,
  SlidersHorizontal,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentInfo, AgentSource } from "@/types/agents";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Matches admin prompts filter: include rows with no category / no tags. */
const NONE_SENTINEL = "__none__";

type SortOption = "name-asc" | "name-desc" | "source" | "category-asc";
type SourceFilter = "all" | AgentSource;
type FavFilter = "all" | "yes" | "no";

interface AgentPickerProps {
  agents: AgentInfo[];
  selectedAgentId: string | null;
  onSelect: (agentId: string | null) => void;
  isLoading?: boolean;
  /** Controlled open state */
  open: boolean;
  onClose: () => void;
  /** Anchor element reference — picker appears above it */
  anchorRef: React.RefObject<HTMLElement | null>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<AgentSource, string> = {
  /** Public catalog from `prompt_builtins` (synced from AIDream). */
  builtin: "Catalog",
  user: "Mine",
  shared: "Shared",
};

const SOURCE_ICONS: Record<AgentSource, React.ReactNode> = {
  builtin: <Cpu className="h-3 w-3" />,
  user: <User className="h-3 w-3" />,
  shared: <Users className="h-3 w-3" />,
};

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "name-asc", label: "Name (A–Z)" },
  { value: "name-desc", label: "Name (Z–A)" },
  { value: "category-asc", label: "Category (A–Z)" },
  { value: "source", label: "By source" },
];

const FAV_OPTIONS: { value: FavFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "yes", label: "Favorites only" },
  { value: "no", label: "Not favorites" },
];

// ─── Search scoring (aligned with matrx-admin PromptsGrid weights, agent fields) ─

function computeAgentSearchScore(agent: AgentInfo, token: string): number {
  const q = token.toLowerCase();
  if (!q) return 0;
  let score = 0;
  const name = (agent.name ?? "").toLowerCase();
  const desc = (agent.description ?? "").toLowerCase();

  if (name === q) score += 10000;
  else if (name.startsWith(q)) score += 5000;
  else if (name.includes(q)) score += 2000;

  if (desc === q) score += 1000;
  else if (desc.includes(q)) score += 500;

  if (agent.category?.toLowerCase().includes(q)) score += 300;
  if (agent.tags?.some((t) => t.toLowerCase().includes(q))) score += 300;
  if (agent.source.toLowerCase().includes(q)) score += 150;
  if (agent.id?.toLowerCase().includes(q)) score += 50;

  if (
    agent.variable_defaults?.some(
      (v) =>
        v.name?.toLowerCase().includes(q) ||
        v.defaultValue?.toLowerCase().includes(q) ||
        v.helpText?.toLowerCase().includes(q),
    )
  )
    score += 10;

  return score;
}

function agentMatchesSearch(agent: AgentInfo, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  return tokens.every((t) => computeAgentSearchScore(agent, t) > 0);
}

function totalSearchScore(agent: AgentInfo, query: string): number {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return 0;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  return tokens.reduce((sum, t) => sum + computeAgentSearchScore(agent, t), 0);
}

// ─── Highlight helper ────────────────────────────────────────────────────────

function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-primary/20 text-primary rounded-[2px] font-medium not-italic">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ─── AgentRow ────────────────────────────────────────────────────────────────

function AgentRow({
  agent,
  isSelected,
  searchQuery,
  onClick,
}: {
  agent: AgentInfo;
  isSelected: boolean;
  searchQuery: string;
  onClick: () => void;
}) {
  const tags = agent.tags?.filter(Boolean) ?? [];

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors",
        isSelected
          ? "bg-primary/10 text-foreground"
          : "text-foreground hover:bg-accent/50",
      )}
    >
      {/* Source icon */}
      <span
        className={cn(
          "mt-0.5 shrink-0 opacity-50",
          agent.source === "builtin" && "text-blue-500 opacity-80",
          agent.source === "user" && "text-emerald-500 opacity-80",
          agent.source === "shared" && "text-violet-500 opacity-80",
        )}
      >
        {SOURCE_ICONS[agent.source]}
      </span>

      {/* Name + description + tags */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium">
            {highlight(agent.name, searchQuery)}
          </span>
          {agent.is_favorite && (
            <Star className="h-2.5 w-2.5 shrink-0 fill-amber-400 text-amber-400" />
          )}
        </div>
        {agent.description && (
          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
            {highlight(agent.description, searchQuery)}
          </p>
        )}
        {tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-[3px] bg-muted px-1 py-0.5 text-[9px] text-muted-foreground"
              >
                {highlight(tag, searchQuery)}
              </span>
            ))}
            {tags.length > 4 && (
              <span className="text-[9px] text-muted-foreground">
                +{tags.length - 4}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Selected check */}
      {isSelected && (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      )}
    </button>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function AgentPicker({
  agents,
  selectedAgentId,
  onSelect,
  isLoading = false,
  open,
  onClose,
  anchorRef,
}: AgentPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("name-asc");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [favoritesFirst, setFavoritesFirst] = useState(true);
  const [favFilter, setFavFilter] = useState<FavFilter>("all");
  /** Inclusion model (empty = no filter), with NONE_SENTINEL for uncategorized / untagged. */
  const [includedCategories, setIncludedCategories] = useState<string[]>([]);
  const [includedTags, setIncludedTags] = useState<string[]>([]);

  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus search on open
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 50);
    } else {
      setSearchQuery("");
      setShowSortMenu(false);
      setShowFilters(false);
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Derived: available source options from actual data
  const availableSources = useMemo(() => {
    const sources = new Set(agents.map((a) => a.source));
    return (["builtin", "user", "shared"] as AgentSource[]).filter((s) =>
      sources.has(s),
    );
  }, [agents]);

  // All unique categories
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    agents.forEach((a) => {
      if (a.category) cats.add(a.category);
    });
    return Array.from(cats).sort();
  }, [agents]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    agents.forEach((a) => {
      a.tags?.forEach((t) => {
        if (t) tags.add(t);
      });
    });
    return Array.from(tags).sort();
  }, [agents]);

  const hasActiveFilters =
    sourceFilter !== "all" ||
    sortBy !== "name-asc" ||
    includedCategories.length > 0 ||
    includedTags.length > 0 ||
    favFilter !== "all" ||
    !favoritesFirst;

  const resetFilters = useCallback(() => {
    setSourceFilter("all");
    setSortBy("name-asc");
    setIncludedCategories([]);
    setIncludedTags([]);
    setFavFilter("all");
    setFavoritesFirst(true);
  }, []);

  const compareAgents = useCallback(
    (a: AgentInfo, b: AgentInfo): number => {
      switch (sortBy) {
        case "name-desc":
          return b.name.localeCompare(a.name);
        case "category-asc": {
          const ca = (a.category ?? "\uffff").toLowerCase();
          const cb = (b.category ?? "\uffff").toLowerCase();
          const c = ca.localeCompare(cb);
          return c !== 0 ? c : a.name.localeCompare(b.name);
        }
        case "source": {
          const order: Record<AgentSource, number> = {
            builtin: 0,
            user: 1,
            shared: 2,
          };
          const diff = order[a.source] - order[b.source];
          return diff !== 0 ? diff : a.name.localeCompare(b.name);
        }
        case "name-asc":
        default:
          return a.name.localeCompare(b.name);
      }
    },
    [sortBy],
  );

  // Filtered + sorted agents
  const filtered = useMemo(() => {
    const q = searchQuery.trim();

    let result = agents.filter((a) => {
      if (sourceFilter !== "all" && a.source !== sourceFilter) return false;

      if (favFilter === "yes" && !a.is_favorite) return false;
      if (favFilter === "no" && a.is_favorite) return false;

      if (includedCategories.length > 0) {
        const cat = a.category ?? null;
        const isUncategorized = !cat;
        if (isUncategorized) {
          if (!includedCategories.includes(NONE_SENTINEL)) return false;
        } else if (!includedCategories.includes(cat)) {
          return false;
        }
      }

      if (includedTags.length > 0) {
        const isUntagged = !a.tags?.length;
        if (isUntagged) {
          if (!includedTags.includes(NONE_SENTINEL)) return false;
        } else if (!a.tags?.some((t) => includedTags.includes(t))) {
          return false;
        }
      }

      if (q && !agentMatchesSearch(a, q)) return false;
      return true;
    });

    result = [...result];
    if (q) {
      result.sort((a, b) => {
        const sa = totalSearchScore(a, q);
        const sb = totalSearchScore(b, q);
        if (sb !== sa) return sb - sa;
        return compareAgents(a, b);
      });
    } else {
      result.sort((a, b) => {
        if (favoritesFirst && favFilter === "all") {
          const aFav = a.is_favorite ? 1 : 0;
          const bFav = b.is_favorite ? 1 : 0;
          if (bFav !== aFav) return bFav - aFav;
        }
        return compareAgents(a, b);
      });
    }

    return result;
  }, [
    agents,
    searchQuery,
    sourceFilter,
    compareAgents,
    includedCategories,
    includedTags,
    favFilter,
    favoritesFirst,
  ]);

  // Group by source when sort === "source" or by category otherwise
  const grouped = useMemo(() => {
    if (sortBy === "source") {
      const groups: { label: string; icon: React.ReactNode; items: AgentInfo[] }[] =
        [];
      const bySource = new Map<AgentSource, AgentInfo[]>();
      filtered.forEach((a) => {
        const arr = bySource.get(a.source) ?? [];
        arr.push(a);
        bySource.set(a.source, arr);
      });
      (["builtin", "user", "shared"] as AgentSource[]).forEach((src) => {
        const items = bySource.get(src);
        if (items?.length) {
          groups.push({
            label: SOURCE_LABELS[src],
            icon: SOURCE_ICONS[src],
            items,
          });
        }
      });
      return groups;
    }

    // Flat list when not grouping by source
    return null;
  }, [filtered, sortBy]);

  const hasUncategorized = useMemo(
    () => agents.some((a) => !a.category),
    [agents],
  );
  const hasUntagged = useMemo(
    () => agents.some((a) => !a.tags?.length),
    [agents],
  );

  const toggleIncluded = useCallback(
    (list: string[], setList: (v: string[]) => void, val: string) => {
      if (list.includes(val)) setList(list.filter((x) => x !== val));
      else setList([...list, val]);
    },
    [],
  );

  if (!open) return null;

  const activeFilterCount =
    (sourceFilter !== "all" ? 1 : 0) +
    (sortBy !== "name-asc" ? 1 : 0) +
    includedCategories.length +
    includedTags.length +
    (favFilter !== "all" ? 1 : 0) +
    (!favoritesFirst ? 1 : 0);

  return (
    <div
      ref={panelRef}
      className="glass absolute bottom-full left-0 z-50 mb-2 flex w-[min(440px,calc(100vw-2rem))] flex-col rounded-xl shadow-xl"
      style={{ maxHeight: "min(520px, calc(100vh - 200px))" }}
    >
      {/* Header: search + filter toggle */}
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={searchRef}
          type="text"
          placeholder="Search agents by name, tags, variables…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 outline-none"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={cn(
            "flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors",
            showFilters || activeFilterCount > 0
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
          title="Filters & sort"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-primary px-1 py-0.5 text-[9px] text-primary-foreground leading-none">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Mine / Catalog / Shared pills — mirrors matrx-admin PromptsGrid tabs + public catalog */}
      {availableSources.length >= 1 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border/40 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mr-1">
            Show
          </span>
          <SourceChip
            label="All"
            active={sourceFilter === "all"}
            onClick={() => setSourceFilter("all")}
          />
          {availableSources.map((src) => (
            <SourceChip
              key={src}
              label={SOURCE_LABELS[src]}
              icon={SOURCE_ICONS[src]}
              active={sourceFilter === src}
              onClick={() =>
                setSourceFilter(sourceFilter === src ? "all" : src)
              }
            />
          ))}
        </div>
      )}

      {/* Filter panel */}
      {showFilters && (
        <div className="border-b border-border/50 px-3 py-2.5 space-y-2.5 max-h-[240px] overflow-y-auto">
          {/* Category — inclusion chips (admin DesktopFilterPanel semantics) */}
          {(allCategories.length > 0 || hasUncategorized) && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Category
              </p>
              <div className="flex flex-wrap gap-1.5">
                {hasUncategorized && (
                  <button
                    type="button"
                    onClick={() =>
                      toggleIncluded(
                        includedCategories,
                        setIncludedCategories,
                        NONE_SENTINEL,
                      )
                    }
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-[11px] transition-colors italic",
                      includedCategories.includes(NONE_SENTINEL)
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    No category
                  </button>
                )}
                {allCategories.map((cat) => {
                  const on = includedCategories.includes(cat);
                  return (
                    <button
                      type="button"
                      key={cat}
                      onClick={() =>
                        toggleIncluded(
                          includedCategories,
                          setIncludedCategories,
                          cat,
                        )
                      }
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                        on
                          ? "border-primary/50 bg-primary/10 text-primary font-medium"
                          : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60",
                      )}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
              {includedCategories.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIncludedCategories([])}
                  className="mt-1 text-[10px] text-primary hover:underline"
                >
                  Clear categories
                </button>
              )}
            </div>
          )}

          {/* Tags — inclusion */}
          {(allTags.length > 0 || hasUntagged) && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Tags
              </p>
              <div className="flex flex-wrap gap-1.5">
                {hasUntagged && (
                  <button
                    type="button"
                    onClick={() =>
                      toggleIncluded(includedTags, setIncludedTags, NONE_SENTINEL)
                    }
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-[11px] transition-colors italic",
                      includedTags.includes(NONE_SENTINEL)
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    No tags
                  </button>
                )}
                {allTags.map((tag) => {
                  const on = includedTags.includes(tag);
                  return (
                    <button
                      type="button"
                      key={tag}
                      onClick={() =>
                        toggleIncluded(includedTags, setIncludedTags, tag)
                      }
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                        on
                          ? "border-primary/50 bg-primary/10 text-primary font-medium"
                          : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60",
                      )}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
              {includedTags.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIncludedTags([])}
                  className="mt-1 text-[10px] text-primary hover:underline"
                >
                  Clear tags
                </button>
              )}
            </div>
          )}

          {/* Favorites filter — admin-style */}
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Favorites
            </p>
            <div className="flex flex-wrap gap-1">
              {FAV_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => setFavFilter(opt.value)}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                    favFilter === opt.value
                      ? "border-primary/50 bg-primary/10 text-primary font-medium"
                      : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  {opt.value === "yes" && (
                    <Star className="inline h-2.5 w-2.5 mr-0.5 align-middle fill-amber-400 text-amber-400" />
                  )}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Pin favorites + sort + reset */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFavoritesFirst((v) => !v)}
              disabled={favFilter !== "all"}
              className={cn(
                "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
                favFilter !== "all" && "opacity-40 cursor-not-allowed",
                favoritesFirst && favFilter === "all"
                  ? "border-amber-400/50 bg-amber-400/10 text-amber-600 dark:text-amber-400"
                  : "border-border text-muted-foreground hover:bg-muted/50",
              )}
              title={
                favFilter !== "all"
                  ? "Only applies when showing all favorites"
                  : "Pin starred agents to the top"
              }
            >
              <Star
                className={cn(
                  "h-3 w-3",
                  favoritesFirst && favFilter === "all"
                    ? "fill-amber-400 text-amber-400"
                    : "",
                )}
              />
              Favorites first
            </button>

            <div className="relative flex-1 min-w-[140px]">
              <button
                type="button"
                onClick={() => setShowSortMenu((v) => !v)}
                className="flex w-full items-center justify-between rounded-md border border-border bg-muted/30 px-2 py-1 text-[11px] text-foreground hover:bg-muted/60 transition-colors"
              >
                <span className="text-muted-foreground mr-1">Sort:</span>
                <span className="flex-1 truncate text-left">
                  {SORT_OPTIONS.find((o) => o.value === sortBy)?.label}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              </button>
              {showSortMenu && (
                <div className="glass absolute bottom-full left-0 right-0 mb-1 z-20 max-h-48 overflow-y-auto rounded-lg p-1 shadow-lg">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      type="button"
                      key={opt.value}
                      onClick={() => {
                        setSortBy(opt.value);
                        setShowSortMenu(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[11px] transition-colors",
                        sortBy === opt.value
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-foreground hover:bg-accent/50",
                      )}
                    >
                      {opt.label}
                      {sortBy === opt.value && (
                        <Check className="ml-auto h-3 w-3 text-primary" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
                title="Reset filters"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Agent list */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {/* No Agent option */}
        <button
          onClick={() => {
            onSelect(null);
            onClose();
          }}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors",
            selectedAgentId === null
              ? "bg-primary/10 text-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          <span className="font-medium">No Agent</span>
          <span className="text-muted-foreground">— plain chat</span>
          {selectedAgentId === null && (
            <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />
          )}
        </button>

        {agents.length > 0 && (
          <div className="my-1 border-t border-border/40" />
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="py-6 text-center text-xs text-muted-foreground">
            Loading agents…
          </div>
        )}

        {/* Empty states */}
        {!isLoading && agents.length === 0 && (
          <div className="py-6 text-center text-xs text-muted-foreground">
            No agents available
          </div>
        )}

        {!isLoading && agents.length > 0 && filtered.length === 0 && (
          <div className="py-6 text-center text-xs text-muted-foreground">
            No agents match your search
            {hasActiveFilters && (
              <>
                {" "}—{" "}
                <button
                  className="text-primary hover:underline"
                  onClick={resetFilters}
                >
                  clear filters
                </button>
              </>
            )}
          </div>
        )}

        {/* Result count when searching/filtering */}
        {!isLoading &&
          filtered.length > 0 &&
          (searchQuery || hasActiveFilters) && (
            <p className="px-3 pb-1 text-[10px] text-muted-foreground">
              {filtered.length} of {agents.length} agents
            </p>
          )}

        {/* Grouped by source */}
        {!isLoading &&
          grouped &&
          grouped.map((group) => (
            <div key={group.label}>
              <div className="flex items-center gap-1.5 px-3 pb-1 pt-2">
                <span className="text-muted-foreground opacity-70">
                  {group.icon}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {group.label}
                </span>
                <span className="text-[10px] text-muted-foreground/50">
                  {group.items.length}
                </span>
              </div>
              {group.items.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  isSelected={selectedAgentId === agent.id}
                  searchQuery={searchQuery}
                  onClick={() => {
                    onSelect(agent.id);
                    onClose();
                  }}
                />
              ))}
            </div>
          ))}

        {/* Flat list */}
        {!isLoading &&
          !grouped &&
          filtered.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              isSelected={selectedAgentId === agent.id}
              searchQuery={searchQuery}
              onClick={() => {
                onSelect(agent.id);
                onClose();
              }}
            />
          ))}
      </div>

      {/* Footer stats */}
      {!isLoading && agents.length > 0 && (
        <div className="border-t border-border/40 px-3 py-1.5">
          <p className="text-[10px] text-muted-foreground">
            {agents.length} agent{agents.length !== 1 ? "s" : ""} total
            {availableSources.map((src) => {
              const count = agents.filter((a) => a.source === src).length;
              return count > 0 ? (
                <span key={src} className="ml-2">
                  · {count} {SOURCE_LABELS[src].toLowerCase()}
                </span>
              ) : null;
            })}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── SourceChip ──────────────────────────────────────────────────────────────

function SourceChip({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] transition-colors",
        active
          ? "border-primary/50 bg-primary/10 text-primary font-medium"
          : "border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/60",
      )}
    >
      {icon && <span className="opacity-70">{icon}</span>}
      {label}
    </button>
  );
}
