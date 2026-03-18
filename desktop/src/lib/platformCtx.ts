/**
 * Single source of truth for OS/arch/capability context in the frontend.
 *
 * The engine populates this via GET /platform/context at startup and calls
 * `initPlatformCtx(data)` with the result. Until that call happens, the
 * module falls back to a best-effort browser-side detection so components
 * can render without waiting for the engine.
 *
 * Rule: any code that branches on OS/arch/capabilities reads from this
 * module — never raw `navigator.userAgent`, `navigator.platform`, or
 * inline `process.platform` checks scattered across files.
 *
 * Usage:
 *   import { PLATFORM, CAPABILITIES, initPlatformCtx } from '@/lib/platformCtx';
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlatformInfo {
  /** sys.platform value: 'darwin' | 'win32' | 'linux' */
  os: string;
  /** platform.system() value: 'Darwin' | 'Windows' | 'Linux' */
  system: string;
  /** platform.machine() value: 'arm64' | 'x86_64' | 'AMD64' */
  machine: string;
  release: string;
  python_version: string;
  hostname: string;
  os_version: string;
  processor: string;
  mac_version: string;
  version: string;
  path_separator: string;
  home_dir: string;
  is_mac: boolean;
  is_mac_silicon: boolean;
  is_mac_intel: boolean;
  is_windows: boolean;
  is_linux: boolean;
  is_wsl: boolean;
  // Aliases matching Python codebase naming
  IS_MACOS: boolean;
  IS_WINDOWS: boolean;
  IS_LINUX: boolean;
}

export interface CapabilityInfo {
  // Package presence
  has_playwright: boolean;
  has_psutil: boolean;
  has_sounddevice: boolean;
  has_cv2: boolean;
  has_numpy: boolean;
  has_pytesseract: boolean;
  has_mss: boolean;
  has_pil: boolean;
  has_fitz: boolean;
  has_zeroconf: boolean;
  has_screeninfo: boolean;
  has_tkinter: boolean;
  has_pyperclip: boolean;
  has_watchfiles: boolean;
  has_quartz: boolean;
  has_speech_framework: boolean;
  has_wmi: boolean;
  has_plistlib: boolean;
  // Binary presence
  has_ffmpeg: boolean;
  has_cloudflared: boolean;
  cloudflared_path: string | null;
  has_powershell: boolean;
  powershell_path: string | null;
  has_fd: boolean;
  has_rg: boolean;
  has_xdg_open: boolean;
  has_nautilus: boolean;
  has_xdotool: boolean;
  has_wmctrl: boolean;
  has_bluetoothctl: boolean;
  has_nmcli: boolean;
  has_xrandr: boolean;
  has_imagesnap: boolean;
  has_whereami: boolean;
  has_geoclue: boolean;
  has_systemd_inhibit: boolean;
  has_chrome: boolean;
  chrome_path: string | null;
  has_zsh: boolean;
  zsh_path: string | null;
  has_bash: boolean;
  bash_path: string | null;
  shell_path: string | null;
  has_dns_sd: boolean;
  has_avahi_browse: boolean;
  has_airport: boolean;
  has_cliclick: boolean;
  has_xclip: boolean;
  has_xsel: boolean;
  has_lsusb: boolean;
  has_tesseract: boolean;
  tesseract_path: string | null;
  has_cmd: boolean;
  // Environment / display
  has_display: boolean;
  is_wsl: boolean;
  // Derived
  has_system_tray: boolean;
  /** 'tcc' | 'uac' | 'polkit' | null */
  permission_model: string | null;
  // Hardware / permission flags (null = not yet probed by engine)
  mic_available: boolean | null;
  speakers_available: boolean | null;
  camera_available: boolean | null;
  screen_capture_available: boolean | null;
  gpu_available: boolean | null;
  gpu_name: string | null;
  /** 'apple_silicon' | 'nvidia' | 'amd' | 'integrated' | null */
  gpu_type: string | null;
}

export interface PlatformContext {
  platform: PlatformInfo;
  capabilities: CapabilityInfo;
}

// ---------------------------------------------------------------------------
// Browser-side fallback detection (used before engine responds)
// ---------------------------------------------------------------------------

function _browserFallbackPlatform(): PlatformInfo {
  const ua = navigator.userAgent;
  const is_mac = ua.includes("Mac OS X") || ua.includes("Macintosh");
  const is_windows = ua.includes("Windows");
  const is_linux = ua.includes("Linux") && !is_mac;
  // Apple Silicon: Safari/WebKit on M-series shows arm64 via some UAs,
  // but there's no reliable way to distinguish M1/M2 in a browser UA.
  // We leave machine as 'unknown' and let the engine correct it.
  const is_mac_silicon = is_mac && (ua.includes("arm") || (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform === "macOS");

  return {
    os: is_windows ? "win32" : is_mac ? "darwin" : "linux",
    system: is_windows ? "Windows" : is_mac ? "Darwin" : "Linux",
    machine: "unknown",
    release: "unknown",
    python_version: "unknown",
    hostname: "unknown",
    os_version: "unknown",
    processor: "unknown",
    mac_version: "",
    version: "unknown",
    path_separator: is_windows ? "\\" : "/",
    home_dir: "unknown",
    is_mac,
    is_mac_silicon: is_mac_silicon ?? false,
    is_mac_intel: is_mac && !is_mac_silicon,
    is_windows,
    is_linux,
    is_wsl: false,
    IS_MACOS: is_mac,
    IS_WINDOWS: is_windows,
    IS_LINUX: is_linux,
  };
}

function _browserFallbackCapabilities(): CapabilityInfo {
  return {
    has_playwright: false,
    has_psutil: false,
    has_sounddevice: false,
    has_cv2: false,
    has_numpy: false,
    has_pytesseract: false,
    has_mss: false,
    has_pil: false,
    has_fitz: false,
    has_zeroconf: false,
    has_screeninfo: false,
    has_tkinter: false,
    has_pyperclip: false,
    has_watchfiles: false,
    has_quartz: false,
    has_speech_framework: false,
    has_wmi: false,
    has_plistlib: false,
    has_ffmpeg: false,
    has_cloudflared: false,
    cloudflared_path: null,
    has_powershell: false,
    powershell_path: null,
    has_fd: false,
    has_rg: false,
    has_xdg_open: false,
    has_nautilus: false,
    has_xdotool: false,
    has_wmctrl: false,
    has_bluetoothctl: false,
    has_nmcli: false,
    has_xrandr: false,
    has_imagesnap: false,
    has_whereami: false,
    has_geoclue: false,
    has_systemd_inhibit: false,
    has_chrome: false,
    chrome_path: null,
    has_zsh: false,
    zsh_path: null,
    has_bash: false,
    bash_path: null,
    shell_path: null,
    has_dns_sd: false,
    has_avahi_browse: false,
    has_airport: false,
    has_cliclick: false,
    has_xclip: false,
    has_xsel: false,
    has_lsusb: false,
    has_tesseract: false,
    tesseract_path: null,
    has_cmd: false,
    has_display: true,
    is_wsl: false,
    has_system_tray: true,
    permission_model: null,
    mic_available: null,
    speakers_available: null,
    camera_available: null,
    screen_capture_available: null,
    gpu_available: null,
    gpu_name: null,
    gpu_type: null,
  };
}

// ---------------------------------------------------------------------------
// Module-level state — mutable until first init, then effectively stable
// ---------------------------------------------------------------------------

let _platform: PlatformInfo = _browserFallbackPlatform();
let _capabilities: CapabilityInfo = _browserFallbackCapabilities();
let _initialised = false;

/** Proxy-like objects so existing code can hold a reference and always see
 *  the current values without re-importing. */
export const PLATFORM: PlatformInfo = new Proxy({} as PlatformInfo, {
  get(_target, prop) {
    return _platform[prop as keyof PlatformInfo];
  },
});

export const CAPABILITIES: CapabilityInfo = new Proxy({} as CapabilityInfo, {
  get(_target, prop) {
    return _capabilities[prop as keyof CapabilityInfo];
  },
});

// ---------------------------------------------------------------------------
// Initialiser — called once at startup after /platform/context responds
// ---------------------------------------------------------------------------

/**
 * Populate the module with authoritative data from the Python engine.
 * Safe to call multiple times (later calls update in-place).
 */
export function initPlatformCtx(data: PlatformContext): void {
  _platform = { ..._platform, ...data.platform };
  _capabilities = { ..._capabilities, ...data.capabilities };
  _initialised = true;
}

/** True once the engine has confirmed platform context. */
export function isPlatformCtxInitialised(): boolean {
  return _initialised;
}

/**
 * Return a plain snapshot (not a Proxy) — useful for JSON serialisation
 * or passing to components that spread the object.
 */
export function getPlatformSnapshot(): PlatformContext {
  return {
    platform: { ..._platform },
    capabilities: { ..._capabilities },
  };
}
