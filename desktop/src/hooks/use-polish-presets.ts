/**
 * usePolishPresets
 *
 * React hook for managing AI Polish presets.
 * Wraps the polish-presets storage layer with local state so components
 * re-render when presets change.
 */

import { useState, useCallback } from "react";
import {
  getAllPresets,
  getDefaultPresetId,
  setDefaultPresetId,
  saveCustomPreset,
  deleteCustomPreset,
  getPresetById,
  type PolishPreset,
} from "@/lib/polish-presets";

export type { PolishPreset };

export interface UsePolishPresetsReturn {
  presets: PolishPreset[];
  defaultPresetId: string;
  defaultPreset: PolishPreset;
  setDefault: (id: string) => void;
  save: (preset: {
    id?: string;
    name: string;
    systemPrompt: string;
  }) => PolishPreset;
  remove: (id: string) => void;
  refresh: () => void;
}

export function usePolishPresets(): UsePolishPresetsReturn {
  const [presets, setPresets] = useState<PolishPreset[]>(() => getAllPresets());
  const [defaultPresetId, setDefaultPresetIdState] = useState<string>(() =>
    getDefaultPresetId(),
  );

  const refresh = useCallback(() => {
    setPresets(getAllPresets());
    setDefaultPresetIdState(getDefaultPresetId());
  }, []);

  const setDefault = useCallback((id: string) => {
    setDefaultPresetId(id);
    setDefaultPresetIdState(id);
  }, []);

  const save = useCallback(
    (preset: { id?: string; name: string; systemPrompt: string }) => {
      const saved = saveCustomPreset(preset);
      setPresets(getAllPresets());
      return saved;
    },
    [],
  );

  const remove = useCallback((id: string) => {
    deleteCustomPreset(id);
    setPresets(getAllPresets());
    setDefaultPresetIdState(getDefaultPresetId());
  }, []);

  const defaultPreset =
    getPresetById(defaultPresetId) ?? getPresetById("builtin-standard")!;

  return {
    presets,
    defaultPresetId,
    defaultPreset,
    setDefault,
    save,
    remove,
    refresh,
  };
}
