import { isTauri, setCloseToTray } from "@/lib/sidecar";
import { engine } from "@/lib/api";

const STORAGE_KEY = "matrx-settings";

export interface AppSettings {
  launchOnStartup: boolean;
  minimizeToTray: boolean;
  headlessScraping: boolean;
  scrapeDelay: string;
}

const DEFAULTS: AppSettings = {
  launchOnStartup: false,
  minimizeToTray: true,
  headlessScraping: true,
  scrapeDelay: "1.0",
};

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULTS, ...JSON.parse(raw) };
    }
  } catch {
    // Corrupted storage, reset
  }
  return { ...DEFAULTS };
}

export async function saveSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
  const current = await loadSettings();
  current[key] = value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));

  // Sync to native/engine side effects.
  await syncSetting(key, current);
}

/** Push a setting change to Tauri or the engine. */
async function syncSetting<K extends keyof AppSettings>(
  key: K,
  all: AppSettings,
): Promise<void> {
  try {
    switch (key) {
      case "launchOnStartup":
        if (isTauri()) {
          const { enable, disable } = await import(
            "@tauri-apps/plugin-autostart"
          );
          if (all.launchOnStartup) {
            await enable();
          } else {
            await disable();
          }
        }
        break;

      case "minimizeToTray":
        await setCloseToTray(all.minimizeToTray);
        break;

      case "headlessScraping":
      case "scrapeDelay":
        if (engine.engineUrl) {
          await engine.updateSettings({
            headless_scraping: all.headlessScraping,
            scrape_delay: parseFloat(all.scrapeDelay) || 1.0,
          });
        }
        break;
    }
  } catch (err) {
    console.warn(`[settings] Failed to sync ${key}:`, err);
  }
}

/** Sync all settings to their native/engine counterparts on startup. */
export async function syncAllSettings(): Promise<void> {
  const settings = await loadSettings();

  // Sync minimize-to-tray to Rust.
  await setCloseToTray(settings.minimizeToTray);

  // Sync autostart.
  if (isTauri()) {
    try {
      const { enable, disable, isEnabled } = await import(
        "@tauri-apps/plugin-autostart"
      );
      const current = await isEnabled();
      if (settings.launchOnStartup && !current) await enable();
      if (!settings.launchOnStartup && current) await disable();
    } catch (err) {
      console.warn("[settings] Failed to sync autostart:", err);
    }
  }

  // Sync engine settings.
  if (engine.engineUrl) {
    try {
      await engine.updateSettings({
        headless_scraping: settings.headlessScraping,
        scrape_delay: parseFloat(settings.scrapeDelay) || 1.0,
      });
    } catch (err) {
      console.warn("[settings] Failed to sync engine settings:", err);
    }
  }
}
