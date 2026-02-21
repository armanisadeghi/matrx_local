import { isTauri, setCloseToTray } from "@/lib/sidecar";
import { engine } from "@/lib/api";

const STORAGE_KEY = "matrx-settings";

export interface AppSettings {
  // Application
  launchOnStartup: boolean;
  minimizeToTray: boolean;
  theme: "dark" | "light" | "system";
  // Scraping
  headlessScraping: boolean;
  scrapeDelay: string;
  // Proxy
  proxyEnabled: boolean;
  proxyPort: number;
  // Instance
  instanceName: string;
}

const DEFAULTS: AppSettings = {
  launchOnStartup: false,
  minimizeToTray: true,
  theme: "dark",
  headlessScraping: true,
  scrapeDelay: "1.0",
  proxyEnabled: true,
  proxyPort: 22180,
  instanceName: "My Computer",
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

export async function saveSettings(settings: AppSettings): Promise<void> {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
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

      case "proxyEnabled":
        if (engine.engineUrl) {
          if (all.proxyEnabled) {
            await engine.proxyStart(all.proxyPort);
          } else {
            await engine.proxyStop();
          }
        }
        break;

      case "proxyPort":
        // Port changes require restart of proxy
        if (engine.engineUrl && all.proxyEnabled) {
          await engine.proxyStop();
          await engine.proxyStart(all.proxyPort);
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

/**
 * Merge cloud settings into local settings.
 * Cloud settings use snake_case keys; local uses camelCase.
 */
export function mergeCloudSettings(
  local: AppSettings,
  cloud: Record<string, unknown>,
): AppSettings {
  return {
    ...local,
    proxyEnabled: cloud.proxy_enabled !== undefined ? Boolean(cloud.proxy_enabled) : local.proxyEnabled,
    proxyPort: cloud.proxy_port !== undefined ? Number(cloud.proxy_port) : local.proxyPort,
    headlessScraping: cloud.headless_scraping !== undefined ? Boolean(cloud.headless_scraping) : local.headlessScraping,
    scrapeDelay: cloud.scrape_delay !== undefined ? String(cloud.scrape_delay) : local.scrapeDelay,
    theme: (cloud.theme as AppSettings["theme"]) || local.theme,
    launchOnStartup: cloud.launch_on_startup !== undefined ? Boolean(cloud.launch_on_startup) : local.launchOnStartup,
    minimizeToTray: cloud.minimize_to_tray !== undefined ? Boolean(cloud.minimize_to_tray) : local.minimizeToTray,
    instanceName: (cloud.instance_name as string) || local.instanceName,
  };
}

/**
 * Convert local camelCase settings to cloud snake_case format.
 */
export function settingsToCloud(settings: AppSettings): Record<string, unknown> {
  return {
    proxy_enabled: settings.proxyEnabled,
    proxy_port: settings.proxyPort,
    headless_scraping: settings.headlessScraping,
    scrape_delay: parseFloat(settings.scrapeDelay) || 1.0,
    theme: settings.theme,
    launch_on_startup: settings.launchOnStartup,
    minimize_to_tray: settings.minimizeToTray,
    instance_name: settings.instanceName,
  };
}
