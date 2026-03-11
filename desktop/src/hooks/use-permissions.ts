/**
 * usePermissions — Unified macOS permissions hook for AI Matrx Desktop.
 *
 * Architecture:
 *
 * All permissions that can be checked/requested from within the Tauri .app
 * process use tauri-plugin-macos-permissions or direct Tauri commands so that
 * macOS TCC associates the grant with the correct principal (the .app bundle,
 * not the Python sidecar).
 *
 * The Python engine REST is only used for status display of things that
 * cannot be checked from the frontend at all (e.g. bluetooth adapter state).
 *
 * Known Apple quirks handled here:
 *
 * - Screen Recording: CGPreflightScreenCaptureAccess() returns false even when
 *   already granted until the app is restarted. We supplement it with a
 *   functional test via the engine to detect this "already granted but preflight
 *   lying" case and mark it as granted.
 *
 * - Camera/Microphone: requestXxxPermission() fires an ObjC async callback and
 *   returns immediately. We wait 800 ms before re-checking so the OS dialog has
 *   time to fire and the user has a moment to respond.
 *
 * - Contacts/Calendar/Photos/Location: These MUST be triggered by the main
 *   .app process. The Python sidecar cannot prompt TCC dialogs on behalf of the
 *   app. We open System Settings directly since we don't have ObjC bindings for
 *   these in the plugin, and rely on the engine for read-only status display.
 *
 * - Input Monitoring / Automation / Local Network: Same — open Settings + rely
 *   on focus-return re-check.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@/lib/sidecar";
import { engine } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionKey =
  | "microphone"
  | "camera"
  | "screen_recording"
  | "accessibility"
  | "full_disk_access"
  | "input_monitoring"
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
  label: string;
  description: string;
  tools: string[];
  /** true = plugin can show an in-app OS dialog; false = must go to Settings */
  canPrompt: boolean;
  settingsUrl: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Static metadata
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
    settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  },
  camera: {
    label: "Camera",
    description: "Camera capture for vision and document tools",
    tools: ["CaptureCamera"],
    canPrompt: true,
    settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
  },
  screen_recording: {
    label: "Screen Recording",
    description: "Screenshot tool and screen-based automation",
    tools: ["Screenshot", "BrowserScreenshot"],
    // CGRequestScreenCaptureAccess() does show a dialog on first-ever request
    canPrompt: true,
    settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  },
  accessibility: {
    label: "Accessibility",
    description: "Keyboard simulation, mouse control, window management",
    tools: ["TypeText", "Hotkey", "MouseClick", "MouseMove", "ListWindows", "FocusWindow", "MoveWindow", "MinimizeWindow", "FocusApp"],
    canPrompt: false,
    settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  },
  full_disk_access: {
    label: "Full Disk Access",
    description: "Read and write files outside standard app folders",
    tools: ["ReadFile", "WriteFile", "ListDirectory", "SearchFiles", "DeleteFile"],
    canPrompt: false,
    settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
  },
  input_monitoring: {
    label: "Input Monitoring",
    description: "Global keyboard and mouse event monitoring",
    tools: ["MonitorInput"],
    canPrompt: false,
    settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
  },
  contacts: {
    label: "Contacts",
    description: "Read and search your address book",
    tools: ["SearchContacts", "GetContact"],
    canPrompt: false,
    settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts",
  },
  calendar: {
    label: "Calendar",
    description: "Read and create calendar events",
    tools: ["ListEvents", "CreateEvent"],
    canPrompt: false,
    settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars",
  },
  photos: {
    label: "Photos Library",
    description: "Read images from your photo library",
    tools: ["SearchPhotos", "GetPhoto"],
    canPrompt: false,
    settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_Photos",
  },
  bluetooth: {
    label: "Bluetooth",
    description: "Discover and list nearby Bluetooth devices",
    tools: ["BluetoothDevices", "ConnectedDevices"],
    canPrompt: false,
    settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_Bluetooth",
  },
  location: {
    label: "Location Services",
    description: "Access current GPS/network location",
    tools: ["GetLocation"],
    canPrompt: false,
    settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices",
  },
  local_network: {
    label: "Local Network",
    description: "Discover devices and services on your local network",
    tools: ["NetworkScan", "MDNSDiscover", "WifiNetworks"],
    canPrompt: false,
    settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork",
  },
  automation: {
    label: "Automation (Apple Events)",
    description: "Send commands to other apps via AppleScript",
    tools: ["AppleScript", "LaunchApp", "FocusApp"],
    canPrompt: false,
    settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
  },
  network: {
    label: "Network Access",
    description: "Connect to internet and local network services",
    tools: ["NetworkInfo", "PortScan"],
    canPrompt: false,
    settingsUrl: "x-apple.systempreferences:com.apple.preference.network",
  },
};

// Keys whose check/request go through tauri-plugin-macos-permissions
const PLUGIN_KEYS = new Set<PermissionKey>([
  "microphone",
  "camera",
  "screen_recording",
  "accessibility",
  "full_disk_access",
  "input_monitoring",
]);

// Permissions where the OS can show an in-app dialog (mic/camera = AVFoundation
// dialog; screen_recording = CGRequestScreenCaptureAccess dialog on first ever
// request, then must go to Settings on subsequent denials)
const CAN_PROMPT_KEYS = new Set<PermissionKey>(["microphone", "camera", "screen_recording"]);

// How long to wait after firing a prompt request before re-checking status.
// AVFoundation completionHandler fires async; we need a small buffer.
const POST_REQUEST_DELAY_MS = 1200;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UsePermissionsReturn {
  permissions: Map<PermissionKey, PermissionState>;
  isLoading: boolean;
  check: (key: PermissionKey) => Promise<PermissionStatus>;
  checkAll: () => Promise<void>;
  request: (key: PermissionKey) => Promise<void>;
  openSettings: (key: PermissionKey) => Promise<void>;
}

function buildInitialState(): Map<PermissionKey, PermissionState> {
  const map = new Map<PermissionKey, PermissionState>();
  for (const [key, meta] of Object.entries(PERMISSION_META) as [
    PermissionKey,
    (typeof PERMISSION_META)[PermissionKey],
  ][]) {
    map.set(key, { key, status: "loading", ...meta });
  }
  return map;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function usePermissions(): UsePermissionsReturn {
  const [permissions, setPermissions] = useState<Map<PermissionKey, PermissionState>>(
    buildInitialState,
  );
  const [isLoading, setIsLoading] = useState(true);
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

  /**
   * Check a plugin-native permission.
   *
   * Screen recording special case: CGPreflightScreenCaptureAccess() is broken
   * and returns false even when the user already granted the permission. Apple
   * explicitly states this is by design — the app must restart for the preflight
   * to reflect reality. We therefore:
   *   1. Call the plugin (CGPreflightScreenCaptureAccess).
   *   2. If it returns true  → definitively granted.
   *   3. If it returns false → check the engine's functional test (which calls
   *      CGWindowListCreateImage). If that says "granted" the permission is
   *      already active and we trust it. If both say false → not_determined.
   */
  const checkPluginPermission = useCallback(
    async (key: PermissionKey): Promise<PermissionStatus> => {
      if (!isTauri()) return "unavailable";
      try {
        const perms = await import("tauri-plugin-macos-permissions-api");
        let granted: boolean;
        switch (key) {
          case "microphone":
            granted = await perms.checkMicrophonePermission();
            return granted ? "granted" : "not_determined";

          case "camera":
            granted = await perms.checkCameraPermission();
            return granted ? "granted" : "not_determined";

          case "screen_recording": {
            granted = await perms.checkScreenRecordingPermission();
            if (granted) return "granted";
            // Preflight lied — do a functional cross-check via the engine
            try {
              const engineResult = await engine.getDevicePermission("screen_recording");
              if (engineResult.status === "granted") return "granted";
            } catch {
              // Engine not connected — trust the preflight result
            }
            return "not_determined";
          }

          case "accessibility":
            granted = await perms.checkAccessibilityPermission();
            return granted ? "granted" : "not_determined";

          case "full_disk_access":
            granted = await perms.checkFullDiskAccessPermission();
            return granted ? "granted" : "not_determined";

          case "input_monitoring":
            granted = await perms.checkInputMonitoringPermission();
            return granted ? "granted" : "not_determined";

          default:
            return "unknown";
        }
      } catch {
        return "unknown";
      }
    },
    [],
  );

  // ── Check ──────────────────────────────────────────────────────────────────

  const check = useCallback(
    async (key: PermissionKey): Promise<PermissionStatus> => {
      if (PLUGIN_KEYS.has(key)) {
        const status = await checkPluginPermission(key);
        updatePermission(key, status);
        return status;
      }
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

  const checkAll = useCallback(async () => {
    setIsLoading(true);

    const pluginChecks = Array.from(PLUGIN_KEYS).map(async (key) => {
      const status = await checkPluginPermission(key);
      updatePermission(key, status);
    });

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
    if (!meta.settingsUrl) return;
    if (isTauri()) {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(meta.settingsUrl);
    } else {
      window.open(meta.settingsUrl, "_blank");
    }
  }, []);

  const request = useCallback(
    async (key: PermissionKey) => {
      if (!PLUGIN_KEYS.has(key)) {
        // Contacts, Calendar, Photos, Location, Local Network, Automation, Network:
        // These require ObjC frameworks (CNContactStore, EKEventStore, etc.) that
        // are not in the plugin. The ONLY way to trigger their OS dialogs is to
        // open System Settings — the user must grant manually.
        await openSettings(key);
        return;
      }

      if (CAN_PROMPT_KEYS.has(key)) {
        // Mic/Camera: AVFoundation request → async OS dialog → completionHandler.
        // Screen Recording (first-ever): CGRequestScreenCaptureAccess → modal dialog.
        // In all cases the plugin call returns before the user responds,
        // so we wait POST_REQUEST_DELAY_MS before re-checking.
        if (isTauri()) {
          try {
            const perms = await import("tauri-plugin-macos-permissions-api");
            switch (key) {
              case "microphone":
                await perms.requestMicrophonePermission();
                break;
              case "camera":
                await perms.requestCameraPermission();
                break;
              case "screen_recording":
                await perms.requestScreenRecordingPermission();
                // CGRequestScreenCaptureAccess shows a one-time dialog; on macOS
                // 12+ if already denied it just opens System Settings instead.
                // Either way, wait then re-check.
                break;
            }
          } catch {
            // Ignore — will re-check below
          }
          // Wait for the OS dialog and AVFoundation callback to settle
          await delay(POST_REQUEST_DELAY_MS);
          await check(key);
        }
      } else {
        // Accessibility, Full Disk Access, Input Monitoring:
        // These CANNOT be prompted programmatically — macOS only allows granting
        // them via the System Settings toggle. The plugin's request functions
        // open System Settings to the correct pane.
        if (isTauri()) {
          try {
            const perms = await import("tauri-plugin-macos-permissions-api");
            switch (key) {
              case "accessibility":
                await perms.requestAccessibilityPermission();
                break;
              case "full_disk_access":
                await perms.requestFullDiskAccessPermission();
                break;
              case "input_monitoring":
                await perms.requestInputMonitoringPermission();
                break;
              default:
                await openSettings(key);
            }
          } catch {
            await openSettings(key);
          }
        } else {
          await openSettings(key);
        }
        // Status re-checked via the window focus listener when user returns
      }
    },
    [check, openSettings],
  );

  // ── Initial check ──────────────────────────────────────────────────────────

  useEffect(() => {
    checkAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-check when app regains focus (user may have changed Settings) ───────

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;

    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (focused && checkAllRef.current) {
            // 600 ms: TCC DB flush + CGPreflightScreenCaptureAccess cache clear
            setTimeout(() => {
              checkAllRef.current?.();
            }, 600);
          }
        })
      )
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        // Not in Tauri context (browser dev mode) — skip
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

export function isGranted(status: PermissionStatus): boolean {
  return status === "granted";
}

export function hasRequiredPermissions(
  permissions: Map<PermissionKey, PermissionState>,
  requiredKeys: PermissionKey[],
): boolean {
  return requiredKeys.every((key) => permissions.get(key)?.status === "granted");
}

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
