/**
 * polish-presets.ts
 *
 * Storage layer for AI Polish presets.
 * Stored in localStorage under "matrx-polish-presets" so they survive app restarts
 * without touching the main settings blob.
 *
 * Each preset overrides only the system prompt — the user prompt template and
 * output schema are inherited from the built-in polish_transcript pipeline template.
 * Custom output fields (title, description, tags) are always requested so the
 * session metadata is always populated regardless of the chosen preset style.
 */

export interface PolishPreset {
  id: string;
  /** Display name shown in the dropdown. */
  name: string;
  /**
   * The system prompt sent to the model.
   * Must end with the JSON-output instruction so parsePolishOutput stays valid.
   */
  systemPrompt: string;
  /**
   * True for shipped presets that cannot be deleted (only the name and prompt
   * can't be edited either, but they serve as reference).
   */
  isBuiltIn: boolean;
  /** ISO timestamp of last save — used for ordering custom presets. */
  updatedAt: string;
}

// ── Storage key ───────────────────────────────────────────────────────────

const STORAGE_KEY = "matrx-polish-presets";
const DEFAULT_PRESET_KEY = "matrx-polish-default-preset";

// ── JSON output instruction appended to every system prompt ───────────────

export const POLISH_JSON_INSTRUCTION =
  'Return ONLY a JSON object with exactly four fields: "title" (string, 5–8 words), ' +
  '"description" (string, one sentence), "tags" (array of 2–5 lowercase strings), ' +
  'and "cleaned" (string, the processed text). No markdown, no extra text.';

// ── Built-in presets ──────────────────────────────────────────────────────

export const BUILT_IN_PRESETS: PolishPreset[] = [
  {
    id: "builtin-standard",
    name: "Standard Clean-up",
    systemPrompt:
      "You are an expert editor specializing in spoken-word transcripts. " +
      "Your job is to produce clean, well-punctuated prose from raw speech. " +
      "Rules: fix punctuation and capitalization; remove filler words (um, uh, like, you know, sort of); " +
      "merge run-on sentences into clear, complete sentences; preserve the speaker's exact meaning and vocabulary; " +
      "do not add any content that was not spoken. " +
      "Also generate a short title, a one-sentence description, and 2–5 topic tags. " +
      POLISH_JSON_INSTRUCTION,
    isBuiltIn: true,
    updatedAt: "2025-01-01T00:00:00.000Z",
  },
  {
    id: "builtin-formal",
    name: "Formal / Professional",
    systemPrompt:
      "You are a professional transcription editor. " +
      "Rewrite the transcript in formal, professional English suitable for business communication. " +
      "Eliminate all informal language, filler words, and conversational phrases. " +
      "Use complete sentences, proper grammar, and business-appropriate vocabulary. " +
      "Preserve all factual content and meaning exactly. Do not invent or embellish. " +
      "Also generate a short title, a one-sentence description, and 2–5 topic tags. " +
      POLISH_JSON_INSTRUCTION,
    isBuiltIn: true,
    updatedAt: "2025-01-01T00:00:00.000Z",
  },
  {
    id: "builtin-bullets",
    name: "Bullet Points",
    systemPrompt:
      "You are a note-taking assistant. Convert the spoken transcript into a clean, structured " +
      "bullet-point list. Group related points together under short bold headings where appropriate. " +
      "Each bullet should be a complete, concise thought. Remove all filler words and repetition. " +
      "Preserve every distinct point made — do not omit any ideas. " +
      "For the 'cleaned' field, format the output as markdown bullet points (- item). " +
      "Also generate a short title, a one-sentence description, and 2–5 topic tags. " +
      POLISH_JSON_INSTRUCTION,
    isBuiltIn: true,
    updatedAt: "2025-01-01T00:00:00.000Z",
  },
  {
    id: "builtin-action-items",
    name: "Action Items",
    systemPrompt:
      "You are a meeting assistant. Extract all action items, commitments, tasks, and next steps " +
      "from the transcript. Format the 'cleaned' field as a numbered list of actionable items. " +
      "Each item should be specific and start with a verb. Include who is responsible if mentioned. " +
      "If no action items are present, write 'No action items identified.' " +
      "Also generate a short title, a one-sentence description, and 2–5 topic tags. " +
      POLISH_JSON_INSTRUCTION,
    isBuiltIn: true,
    updatedAt: "2025-01-01T00:00:00.000Z",
  },
  {
    id: "builtin-meeting",
    name: "Meeting Notes",
    systemPrompt:
      "You are a meeting transcription specialist. Convert the spoken transcript into structured " +
      "meeting notes with the following sections (use only sections that have content): " +
      "**Summary** (2–3 sentences), **Key Points** (bullet list), **Decisions Made** (bullet list), " +
      "**Action Items** (numbered list with owners if mentioned), **Follow-ups** (if any). " +
      "Format the 'cleaned' field as markdown. Remove all filler words and repetition. " +
      "Also generate a short title, a one-sentence description, and 2–5 topic tags. " +
      POLISH_JSON_INSTRUCTION,
    isBuiltIn: true,
    updatedAt: "2025-01-01T00:00:00.000Z",
  },
  {
    id: "builtin-verbatim",
    name: "Light Cleanup Only",
    systemPrompt:
      "You are a careful transcription editor. Make only the minimum necessary corrections: " +
      "fix obvious punctuation and capitalization errors, and remove the most egregious filler " +
      "words (um, uh) — but otherwise preserve the speaker's exact words, phrasing, and style. " +
      "Do NOT restructure sentences, paraphrase, or alter the speaker's voice in any way. " +
      "Also generate a short title, a one-sentence description, and 2–5 topic tags. " +
      POLISH_JSON_INSTRUCTION,
    isBuiltIn: true,
    updatedAt: "2025-01-01T00:00:00.000Z",
  },
];

// ── Storage helpers ───────────────────────────────────────────────────────

function readCustomPresets(): PolishPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PolishPreset[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCustomPresets(presets: PolishPreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

// ── Public API ────────────────────────────────────────────────────────────

/** Returns built-ins first, then custom presets sorted by updatedAt desc. */
export function getAllPresets(): PolishPreset[] {
  const custom = readCustomPresets().sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  return [...BUILT_IN_PRESETS, ...custom];
}

export function getPresetById(id: string): PolishPreset | undefined {
  return getAllPresets().find((p) => p.id === id);
}

export function saveCustomPreset(preset: {
  id?: string;
  name: string;
  systemPrompt: string;
}): PolishPreset {
  const custom = readCustomPresets();
  const now = new Date().toISOString();

  if (preset.id) {
    // Update existing
    const idx = custom.findIndex((p) => p.id === preset.id);
    const updated: PolishPreset = {
      id: preset.id,
      name: preset.name,
      systemPrompt: preset.systemPrompt,
      isBuiltIn: false,
      updatedAt: now,
    };
    if (idx >= 0) {
      custom[idx] = updated;
    } else {
      custom.push(updated);
    }
    writeCustomPresets(custom);
    return updated;
  } else {
    // Create new
    const newPreset: PolishPreset = {
      id: `custom-${Date.now()}`,
      name: preset.name,
      systemPrompt: preset.systemPrompt,
      isBuiltIn: false,
      updatedAt: now,
    };
    custom.push(newPreset);
    writeCustomPresets(custom);
    return newPreset;
  }
}

export function deleteCustomPreset(id: string): void {
  const custom = readCustomPresets().filter((p) => p.id !== id);
  writeCustomPresets(custom);
  // If it was the default, clear default so it falls back to built-in
  if (getDefaultPresetId() === id) {
    localStorage.removeItem(DEFAULT_PRESET_KEY);
  }
}

export function getDefaultPresetId(): string {
  return localStorage.getItem(DEFAULT_PRESET_KEY) ?? "builtin-standard";
}

export function setDefaultPresetId(id: string): void {
  localStorage.setItem(DEFAULT_PRESET_KEY, id);
}
