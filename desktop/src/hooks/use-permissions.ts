/**
 * usePermissions — Unified macOS permissions hook for AI Matrx Desktop.
 *
 * Two sources of truth are combined:
 *
 * 1. tauri-plugin-macos-permissions (Tauri app TCC identity):
 *    accessibility, full_disk_access, screen_recording,
 *    microphone, camera, input_monitoring
 *
 * 2. Python engine REST (sidecar-checked, read-only status):
 *    contacts, calendar, photos, bluetooth, location,
 *    local_network, automation, network
 *
 * Usage:
 *   const { permissions, check, request, openSettings, isLoading } = usePermissions();
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkAccessibilityPermission,
  checkCameraPermission,
  checkFullDiskAccessPermission,
  checkInputMonitoringPermission,
  checkMicrophonePermission,
  checkScreenRecordingPermission,
  requestAccessibilityPermission,
  requestCameraPermission,
  requestFullDiskAccessPermission,
  requestInputMonitoringPermission,
  requestMicrophonePermission,
  requestScreenRecordingPermission,
} from "tauri-plugin-macos-permissions-api";
import { open } from "@tauri-apps/plugin-shell";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { engine } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionKey =
  // Plugin-native (Tauri .app TCC identity)
  | "microphone"
  | "camera"
  | "screen_recording"
  | "accessibility"
  | "full_disk_access"
  | "input_monitoring"
  // Engine-checked (sidecar TCC identity — read-only status from Python)
  | "contacts"
  | "calendar"
  | "photos"
  | "bluetooth"
  | "location"
  | "local_network"
  | "automation"
  | "network";

export type PermissionStatus =
  | "granted"
  | "denied"
  | "not_determined"
  | "restricted"
  | "unavailable"
  | "unknown"
  | "loading";

export interface PermissionState {
  key: PermissionKey;
  status: PermissionStatus;
  /** Human-readable label shown in UI */
  label: string;
  /** Short description of what features depend on this permission */
  description: string;
  /** Which tools require this permission */
  tools: string[];
  /** Whether the Tauri plugin can prompt the OS dialog (vs open System Settings) */
  canPrompt: boolean;
  /** Deep link to the exact System Settings pane */
  settingsUrl: string;
  /** Additional detail from the engine checker */
  detail?: string;
}

// ---------------------------------------------------------------------------
// Static metadata for each permission
// ---------------------------------------------------------------------------

const PERMISSION_META: Record<
  PermissionKey,
  Pick<PermissionState, "label" | "description" | "tools" | "canPrompt" | "settingsUrl">
> = {
  microphone: {
    label: "Microphone",
    description: "Audio recording, live transcription, voice tools",
    tools: ["RecordAudio", "TranscribeAudio", "ListAudioDevices", "PlayAudio"],
    canPrompt: true,
    settingsUrl:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  },
  camera: {
    label: "Camera",
    description: "Camera capture for vision and document tools",
    tools: ["CaptureCamera"],
    canPrompt: true,
    settingsUrl:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
  },
  screen_recording: {
    label: "Screen Recording",
    description: "Screenshot tool and screen-based automation",
    tools: ["Screenshot", "BrowserScreenshot"],
    canPrompt: false,
    settingsUrl:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  },
  accessibility: {
    label: "Accessibility",
    description: "Keyboard simulation, mouse control, window management",
    tools: [
      "TypeText",
      "Hotkey",
      "MouseClick",
      "MouseMove",
      "ListWindows",
      "FocusWindow",
      "MoveWindow",
      "MinimizeWindow",
      "FocusApp",
    ],
    canPrompt: false,
    settingsUrl:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  },
  full_disk_access: {
    label: "Full Disk Access",
    description: "Read and write files outside standard app folders",
    tools: ["ReadFile", "WriteFile", "ListDirectory", "SearchFiles", "DeleteFile"],
    canPrompt: false,
    settingsUrl:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
  },
  input_monitoring: {
    label: "Input Monitoring",
    description: "Global keyboard and mouse event monitoring",
    tools: ["MonitorInput"],
    canPrompt: false,
    settingsUrl:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
  },
  contacts: {
    label: "Contacts",
    description: "Read and search your address book",
    tools: ["SearchContacts", "GetContact"],
    canPrompt: false,
    settingsUrl:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts",
  },
  calendar: {
    label: "Calendar",
    description: "Read and create calendar events",
    tools: ["ListEvents", "CreateEvent"],
    canPrompt: false,
    settingsUrl:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars",
  },
  photos: {
    label: "Photos Library",
    description: "Read images from your photo library",
    tools: ["SearchPhotos", "GetPhoto"],
    canPrompt: false,
    settingsUrl:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Photos",
  },
  bluetooth: {
    label: "Bluetooth",
    description: "Discover and list nearby Bluetooth devices",
    tools: ["BluetoothDevices", "ConnectedDevices"],
    canPrompt: false,
    settingsUrl:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Bluetooth",
  },
  location: {
    label: "Location Services",
    description: "Access current GPS/network location",
    tools: ["GetLocation"],
    canPrompt: false,
    settingsUrl:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices",
  },
  local_network: {
    label: "Local Network",
    description: "Discover devices and services on your local network",
    tools: ["NetworkScan", "MDNSDiscover", "WifiNetworks"],
    canPrompt: false,
    settingsUrl:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork",
  },
  automation: {
    label: "Automation (Apple Events)",
    description: "Send commands to other apps via AppleScript",
    tools: ["AppleScript", "LaunchApp", "FocusApp"],
    canPrompt: false,
    settingsUrl:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
  },
  network: {
    label: "Network Access",
    description: "Connect to internet and local network services",
    tools: ["NetworkInfo", "PortScan"],
    canPrompt: false,
    settingsUrl: "x-apple.systempreferences:com.apple.preference.network",
  },
};

// Permissions that use the Tauri plugin's native check/request APIs.
// All others fall back to the engine REST endpoint.
const PLUGIN_KEYS = new Set<PermissionKey>([
  "microphone",
  "camera",
  "screen_recording",
  "accessibility",
  "full_disk_access",
  "input_monitoring",
]);

// Permissions where requestXxx() shows an in-app system dialog (can prompt).
// For the rest, requestXxx() opens System Settings directly.
const CAN_PROMPT_KEYS = new Set<PermissionKey>(["microphone", "camera"]);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UsePermissionsReturn {
  /** Current state for every permission key */
  permissions: Map<PermissionKey, PermissionState>;
  /** True while the initial check is running */
  isLoading: boolean;
  /** Re-check a single permission and update state */
  check: (key: PermissionKey) => Promise<PermissionStatus>;
  /** Re-check all permissions */
  checkAll: () => Promise<void>;
  /**
   * Request a permission.
   * - canPrompt keys: triggers the macOS system dialog
   * - non-promptable keys: opens System Settings then polls on window focus
   */
  request: (key: PermissionKey) => Promise<void>;
  /** Open the specific System Settings pane for this permission */
  openSettings: (key: PermissionKey) => Promise<void>;
}

function buildInitialState(): Map<PermissionKey, PermissionState> {
  const map = new Map<PermissionKey, PermissionState>();
  for (const [key, meta] of Object.entries(PERMISSION_META) as [PermissionKey, typeof PERMISSION_META[PermissionKey]][]) {
    map.set(key, { key, status: "loading", ...meta });
  }
  return map;
}

export function usePermissions(): UsePermissionsReturn {
  const [permissions, setPermissions] = useState<Map<PermissionKey, PermissionState>>(
    buildInitialState,
  );
  const [isLoading, setIsLoading] = useState(true);

  // Ref so focus listener always has the latest checkAll without stale closure
  const checkAllRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const updatePermission = useCallback(
    (key: PermissionKey, status: PermissionStatus, detail?: string) => {
      setPermissions((prev) => {
        const next = new Map(prev);
        const current = next.get(key)!;
        next.set(key, { ...current, status, detail });
        return next;
      });
    },
    [],
  );

  /** Check one plugin-native permission via the Tauri plugin. */
  const checkPluginPermission = useCallback(
    async (key: PermissionKey): Promise<PermissionStatus> => {
      try {
        let granted: boolean;
        switch (key) {
          case "microphone":
            granted = await checkMicrophonePermission();
            break;
          case "camera":
            granted = await checkCameraPermission();
            break;
          case "screen_recording":
            granted = await checkScreenRecordingPermission();
            break;
          case "accessibility":
            granted = await checkAccessibilityPermission();
            break;
          case "full_disk_access":
            granted = await checkFullDiskAccessPermission();
            break;
          case "input_monitoring":
            granted = await checkInputMonitoringPermission();
            break;
          default:
            return "unknown";
        }
        return granted ? "granted" : "not_determined";
      } catch {
        return "unknown";
      }
    },
    [],
  );

  /** Check a single permission key, update state, return new status. */
  const check = useCallback(
    async (key: PermissionKey): Promise<PermissionStatus> => {
      if (PLUGIN_KEYS.has(key)) {
        const status = await checkPluginPermission(key);
        updatePermission(key, status);
        return status;
      }
      // For engine-checked permissions, fetch just that one
      try {
        const result = await engine.getDevicePermission(key);
        const status = result.status as PermissionStatus;
        updatePermission(key, status, result.details);
        return status;
      } catch {
        updatePermission(key, "unknown");
        return "unknown";
      }
    },
    [checkPluginPermission, updatePermission],
  );

  /** Check all permissions from both sources simultaneously. */
  const checkAll = useCallback(async () => {
    setIsLoading(true);

    // Fire all plugin checks in parallel
    const pluginChecks = Array.from(PLUGIN_KEYS).map(async (key) => {
      const status = await checkPluginPermission(key);
      updatePermission(key, status);
    });

    // Fetch engine status for all non-plugin keys in one call
    const engineCheck = (async () => {
      try {
        const result = await engine.getDevicePermissions();
        for (const p of result.permissions) {
          const key = p.permission as PermissionKey;
          if (!PLUGIN_KEYS.has(key)) {
            updatePermission(key, p.status as PermissionStatus, p.details);
          }
        }
      } catch {
        // Engine not connected — mark engine-checked ones as unknown
        const engineKeys = Object.keys(PERMISSION_META).filter(
          (k) => !PLUGIN_KEYS.has(k as PermissionKey),
        ) as PermissionKey[];
        for (const key of engineKeys) {
          updatePermission(key, "unknown");
        }
      }
    })();

    await Promise.all([...pluginChecks, engineCheck]);
    setIsLoading(false);
  }, [checkPluginPermission, updatePermission]);

  checkAllRef.current = checkAll;

  // ── Request ────────────────────────────────────────────────────────────────

  const openSettings = useCallback(async (key: PermissionKey) => {
    const meta = PERMISSION_META[key];
    if (meta.settingsUrl) {
      await open(meta.settingsUrl);
    }
  }, []);

  const request = useCallback(
    async (key: PermissionKey) => {
      if (!PLUGIN_KEYS.has(key)) {
        // Engine-only permissions — just open Settings, user must grant manually
        await openSettings(key);
        return;
      }

      if (CAN_PROMPT_KEYS.has(key)) {
        // These show an in-app OS dialog; call the request function then re-check
        try {
          switch (key) {
            case "microphone":
              await requestMicrophonePermission();
              break;
            case "camera":
              await requestCameraPermission();
              break;
          }
        } catch {
          // OS denied or already handled; fall through to re-check
        }
        await check(key);
      } else {
        // Non-promptable (accessibility, full_disk, screen_recording, input_monitoring):
        // The request functions open System Settings directly.
        try {
          switch (key) {
            case "accessibility":
              await requestAccessibilityPermission();
              break;
            case "full_disk_access":
              await requestFullDiskAccessPermission();
              break;
            case "screen_recording":
              await requestScreenRecordingPermission();
              break;
            case "input_monitoring":
              await requestInputMonitoringPermission();
              break;
            default:
              await openSettings(key);
          }
        } catch {
          await openSettings(key);
        }
        // Status will be re-checked via the window focus listener below
      }
    },
    [check, openSettings],
  );

  // ── Initial check ──────────────────────────────────────────────────────────

  useEffect(() => {
    checkAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-check on window focus (user may have toggled in System Settings) ────

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused && checkAllRef.current) {
          // Small delay so TCC DB has time to flush the new grant
          setTimeout(() => {
            checkAllRef.current?.();
          }, 400);
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        // Not running in Tauri context (e.g. browser dev mode) — skip
      });

    return () => {
      unlisten?.();
    };
  }, []);

  return { permissions, isLoading, check, checkAll, request, openSettings };
}

// ---------------------------------------------------------------------------
// Utility exports
// ---------------------------------------------------------------------------

/** Returns true if this permission is considered granted */
export function isGranted(status: PermissionStatus): boolean {
  return status === "granted";
}

/** Returns true if a tool's required permissions are all granted */
export function hasRequiredPermissions(
  permissions: Map<PermissionKey, PermissionState>,
  requiredKeys: PermissionKey[],
): boolean {
  return requiredKeys.every((key) => {
    const state = permissions.get(key);
    return state?.status === "granted";
  });
}

/** Get the first missing permission for a tool */
export function getFirstMissingPermission(
  permissions: Map<PermissionKey, PermissionState>,
  requiredKeys: PermissionKey[],
): PermissionState | null {
  for (const key of requiredKeys) {
    const state = permissions.get(key);
    if (state && state.status !== "granted") return state;
  }
  return null;
}

export { PLUGIN_KEYS, PERMISSION_META };
