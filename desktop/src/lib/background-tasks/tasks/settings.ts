import type { BackgroundTask } from "../orchestrator";
import { hydrateFromEngine, syncAllSettings } from "@/lib/settings";

export const hydrateSettings: BackgroundTask = {
  id: "hydrate-settings",
  label: "Hydrate settings from engine",
  priority: 12,
  async fn() {
    await hydrateFromEngine();
  },
};

export const syncSettings: BackgroundTask = {
  id: "sync-all-settings",
  label: "Sync all settings to engine + Tauri",
  priority: 15,
  async fn() {
    await syncAllSettings();
  },
};
