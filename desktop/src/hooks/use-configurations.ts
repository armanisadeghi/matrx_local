/**
 * useConfigurations — centralized configuration state management hook.
 *
 * Loads all settings from localStorage, provides per-section dirty tracking,
 * and exposes save/cancel at both section and global levels.
 *
 * Settings are persisted to localStorage on save and synced to the engine
 * and cloud as needed via the existing saveSetting/syncAllSettings pipeline.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  loadSettings,
  saveSettings,
  syncAllSettings,
  type AppSettings,
} from "@/lib/settings";

/** Section names — each gets its own dirty tracking and save/cancel. */
export type ConfigSection =
  | "application"
  | "appearance"
  | "chatAi"
  | "localLlm"
  | "localLlmSampling"
  | "voice"
  | "wakeWord"
  | "scraping"
  | "proxy"
  | "notifications";

/**
 * Maps each section to the settings keys it owns.
 * Used for dirty-checking and partial saves.
 */
const SECTION_KEYS: Record<ConfigSection, (keyof AppSettings)[]> = {
  application: [
    "instanceName",
    "launchOnStartup",
    "minimizeToTray",
    "autoCheckUpdates",
    "updateCheckInterval",
  ],
  appearance: ["theme", "sidebarCollapsed"],
  chatAi: [
    "chatDefaultModel",
    "chatDefaultMode",
    "chatMaxConversations",
    "chatDefaultSystemPromptId",
  ],
  localLlm: [
    "llmDefaultModel",
    "llmDefaultGpuLayers",
    "llmDefaultContextLength",
    "llmAutoStartServer",
  ],
  localLlmSampling: [
    "llmChatTemperature",
    "llmChatTopP",
    "llmChatTopK",
    "llmChatMaxTokens",
    "llmReasoningTemperature",
    "llmReasoningTopP",
    "llmEnableThinking",
    "llmToolCallTemperature",
    "llmToolCallTopP",
    "llmToolCallTopK",
    "llmStructuredOutputTemperature",
    "llmStreamMaxTokens",
  ],
  voice: [
    "transcriptionDefaultModel",
    "transcriptionAutoInit",
    "transcriptionAudioDevice",
    "transcriptionProcessingTimeout",
  ],
  wakeWord: [
    "wakeWordEnabled",
    "wakeWordListenOnStartup",
    "wakeWordEngine",
    "wakeWordOwwModel",
    "wakeWordOwwThreshold",
    "wakeWordCustomKeyword",
  ],
  scraping: ["headlessScraping", "scrapeDelay"],
  proxy: ["proxyEnabled", "proxyPort", "tunnelEnabled"],
  notifications: ["notificationSound", "notificationSoundStyle"],
};

export interface ConfigurationsState {
  /** The working copy — reflects user's in-progress edits. */
  draft: AppSettings | null;
  /** The last-saved version — used for dirty comparison. */
  saved: AppSettings | null;
  /** Whether any section has unsaved changes. */
  isGlobalDirty: boolean;
  /** Per-section dirty flags. */
  sectionDirty: Record<ConfigSection, boolean>;
  /** True while settings are being saved. */
  isSaving: boolean;
  /** Error from last save attempt, if any. */
  saveError: string | null;
}

export interface ConfigurationsActions {
  /** Update a single setting in the draft. */
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  /** Update multiple settings at once. */
  setMany: (updates: Partial<AppSettings>) => void;
  /** Save only the settings belonging to a specific section. */
  saveSection: (section: ConfigSection) => Promise<void>;
  /** Cancel changes for a specific section (revert to saved). */
  cancelSection: (section: ConfigSection) => void;
  /** Save all changes globally. */
  saveAll: () => Promise<void>;
  /** Cancel all changes globally. */
  cancelAll: () => void;
  /** Reload settings from storage. */
  reload: () => Promise<void>;
}

export function useConfigurations(): [ConfigurationsState, ConfigurationsActions] {
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState<AppSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const initialLoadDone = useRef(false);

  // Load on mount
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;
    loadSettings().then((s) => {
      setSaved(s);
      setDraft({ ...s });
    });
  }, []);

  // Compute per-section dirty flags
  const sectionDirty = useMemo(() => {
    const result = {} as Record<ConfigSection, boolean>;
    const sections = Object.keys(SECTION_KEYS) as ConfigSection[];
    for (const section of sections) {
      if (!draft || !saved) {
        result[section] = false;
        continue;
      }
      result[section] = SECTION_KEYS[section].some(
        (key) => JSON.stringify(draft[key]) !== JSON.stringify(saved[key])
      );
    }
    return result;
  }, [draft, saved]);

  const isGlobalDirty = useMemo(
    () => Object.values(sectionDirty).some(Boolean),
    [sectionDirty]
  );

  const set = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    []
  );

  const setMany = useCallback((updates: Partial<AppSettings>) => {
    setDraft((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  const saveSection = useCallback(
    async (section: ConfigSection) => {
      if (!draft || !saved) return;
      setIsSaving(true);
      setSaveError(null);
      try {
        // Merge section keys from draft into saved
        const updated = { ...saved };
        for (const key of SECTION_KEYS[section]) {
          (updated as Record<string, unknown>)[key] = draft[key];
        }
        await saveSettings(updated);
        setSaved(updated);
        // Sync side effects to engine/Tauri
        await syncAllSettings();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsSaving(false);
      }
    },
    [draft, saved]
  );

  const cancelSection = useCallback(
    (section: ConfigSection) => {
      if (!saved) return;
      setDraft((prev) => {
        if (!prev) return prev;
        const restored = { ...prev };
        for (const key of SECTION_KEYS[section]) {
          (restored as Record<string, unknown>)[key] = saved[key];
        }
        return restored;
      });
    },
    [saved]
  );

  const saveAll = useCallback(async () => {
    if (!draft) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await saveSettings(draft);
      setSaved({ ...draft });
      await syncAllSettings();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }, [draft]);

  const cancelAll = useCallback(() => {
    if (saved) {
      setDraft({ ...saved });
    }
  }, [saved]);

  const reload = useCallback(async () => {
    const s = await loadSettings();
    setSaved(s);
    setDraft({ ...s });
  }, []);

  const state: ConfigurationsState = {
    draft,
    saved,
    isGlobalDirty,
    sectionDirty,
    isSaving,
    saveError,
  };

  const actions: ConfigurationsActions = {
    set,
    setMany,
    saveSection,
    cancelSection,
    saveAll,
    cancelAll,
    reload,
  };

  return [state, actions];
}
