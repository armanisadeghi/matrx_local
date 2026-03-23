/**
 * System Prompts Library
 *
 * Persists user-defined system prompts to localStorage.
 * Import { systemPrompts } anywhere to read/write prompts.
 * The PromptPicker component (components/PromptPicker.tsx) provides the UI.
 */

export interface SystemPrompt {
  id: string;
  name: string;
  content: string;
  category: string;
  createdAt: number;
  updatedAt: number;
  isPinned: boolean;
}

export interface CreateSystemPromptInput {
  name: string;
  content: string;
  category?: string;
}

const STORAGE_KEY = "matrx-system-prompts";

// Built-in prompts that ship with the app — always available, not editable.
// Users can "fork" them into their own library.
export const BUILTIN_PROMPTS: Omit<SystemPrompt, "createdAt" | "updatedAt" | "isPinned">[] = [
  {
    id: "builtin-assistant",
    name: "Helpful Assistant",
    content: "You are a helpful, accurate, and concise assistant. Answer questions directly without unnecessary preamble.",
    category: "General",
  },
  {
    id: "builtin-transcript-polish",
    name: "Transcript Polish",
    content:
      "You are an expert editor. Your task is to clean up spoken transcripts: fix punctuation, capitalization, and run-on sentences. Remove filler words (um, uh, like, you know). Preserve the speaker's meaning and voice exactly. Do not add content that was not spoken. Return only the cleaned text with no explanation.",
    category: "Voice",
  },
  {
    id: "builtin-summarize",
    name: "Summarize",
    content:
      "Summarize the provided text concisely. Capture all key points in clear, structured prose. Use bullet points only if the source is a list. Do not include an introduction or conclusion — just the summary.",
    category: "Writing",
  },
  {
    id: "builtin-explain",
    name: "Explain Simply",
    content:
      "Explain the following as if the reader has no background in the topic. Use plain language, short sentences, and concrete examples. Avoid jargon.",
    category: "Writing",
  },
  {
    id: "builtin-code-review",
    name: "Code Review",
    content:
      "Review the provided code for correctness, readability, and potential bugs. List issues as bullet points, each with a brief explanation. Suggest fixes where appropriate. Focus on substance, not style.",
    category: "Development",
  },
  {
    id: "builtin-brainstorm",
    name: "Brainstorm",
    content:
      "Generate a diverse set of creative ideas for the given topic. Aim for breadth over depth — include both conventional and unconventional approaches. Present each idea as a brief bullet.",
    category: "Creative",
  },
];

// ── Storage helpers ──────────────────────────────────────────────────────────

function loadAll(): SystemPrompt[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SystemPrompt[]) : [];
  } catch {
    return [];
  }
}

function saveAll(prompts: SystemPrompt[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
  } catch {
    // storage full — ignore
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export const systemPrompts = {
  /** All user-created prompts from localStorage. */
  list(): SystemPrompt[] {
    return loadAll();
  },

  /** All built-ins + user prompts, built-ins first. */
  listAll(): Array<SystemPrompt | Omit<SystemPrompt, "createdAt" | "updatedAt" | "isPinned">> {
    return [...BUILTIN_PROMPTS, ...loadAll()];
  },

  get(id: string): SystemPrompt | undefined {
    return loadAll().find((p) => p.id === id);
  },

  getBuiltin(id: string) {
    return BUILTIN_PROMPTS.find((p) => p.id === id);
  },

  /** Get a prompt by id from either user or builtin list. */
  resolve(id: string): string | undefined {
    const builtin = BUILTIN_PROMPTS.find((p) => p.id === id);
    if (builtin) return builtin.content;
    return loadAll().find((p) => p.id === id)?.content;
  },

  create(input: CreateSystemPromptInput): SystemPrompt {
    const now = Date.now();
    const prompt: SystemPrompt = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      content: input.content.trim(),
      category: (input.category ?? "General").trim(),
      createdAt: now,
      updatedAt: now,
      isPinned: false,
    };
    const all = loadAll();
    saveAll([...all, prompt]);
    return prompt;
  },

  update(id: string, changes: Partial<Pick<SystemPrompt, "name" | "content" | "category" | "isPinned">>): boolean {
    const all = loadAll();
    const idx = all.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    all[idx] = { ...all[idx], ...changes, updatedAt: Date.now() };
    saveAll(all);
    return true;
  },

  delete(id: string): boolean {
    const all = loadAll();
    const next = all.filter((p) => p.id !== id);
    if (next.length === all.length) return false;
    saveAll(next);
    return true;
  },

  /** Fork a builtin into user's own list. */
  forkBuiltin(builtinId: string): SystemPrompt | null {
    const builtin = BUILTIN_PROMPTS.find((p) => p.id === builtinId);
    if (!builtin) return null;
    return systemPrompts.create({
      name: `${builtin.name} (copy)`,
      content: builtin.content,
      category: builtin.category,
    });
  },

  categories(): string[] {
    const cats = new Set<string>();
    BUILTIN_PROMPTS.forEach((p) => cats.add(p.category));
    loadAll().forEach((p) => cats.add(p.category));
    return Array.from(cats).sort();
  },
};
