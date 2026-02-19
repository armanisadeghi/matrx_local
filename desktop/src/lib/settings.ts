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
}
