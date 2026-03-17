/**
 * AudioDevicesContext — singleton store for audio input device enumeration.
 *
 * Problem this solves:
 *   - Voice.tsx (DevicesTab + TranscribeTab) calls Tauri IPC list_audio_input_devices
 *   - Devices.tsx (MicrophoneCard) called engine.getAudioDevices() — a Python REST endpoint
 *   - These are TWO different backends returning DIFFERENT data in different formats
 *   - Result: Devices page shows "No microphones detected" while Voice page shows all devices
 *
 * Solution:
 *   - Single source of truth: Tauri IPC list_audio_input_devices (goes to Rust CPAL, always works)
 *   - All consumers get device list from this context
 *   - selectedDevice is persisted to localStorage so it survives page navigation
 *   - Devices are loaded once on first use, refresh is manual or triggered by consumers
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { isTauri } from "@/lib/sidecar";
import type { AudioDeviceInfo } from "@/lib/transcription/types";

const SELECTED_DEVICE_KEY = "matrx-selected-audio-device";

async function tauriListAudioDevices(): Promise<AudioDeviceInfo[]> {
  if (!isTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AudioDeviceInfo[]>("list_audio_input_devices");
}

interface AudioDevicesState {
  audioDevices: AudioDeviceInfo[];
  selectedDevice: string | null;
  isLoading: boolean;
  error: string | null;
}

interface AudioDevicesActions {
  listAudioDevices: () => Promise<AudioDeviceInfo[]>;
  setSelectedDevice: (deviceName: string | null) => void;
  clearError: () => void;
}

type AudioDevicesContextValue = AudioDevicesState & AudioDevicesActions;

export const AudioDevicesContext = createContext<AudioDevicesContextValue | null>(null);

export function AudioDevicesProvider({ children }: { children: ReactNode }) {
  const [audioDevices, setAudioDevices] = useState<AudioDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDeviceState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SELECTED_DEVICE_KEY) ?? null;
    } catch {
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listAudioDevices = useCallback(async (): Promise<AudioDeviceInfo[]> => {
    setIsLoading(true);
    setError(null);
    try {
      const devices = await tauriListAudioDevices();
      setAudioDevices(devices);
      return devices;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const setSelectedDevice = useCallback((deviceName: string | null) => {
    setSelectedDeviceState(deviceName);
    try {
      if (deviceName === null) {
        localStorage.removeItem(SELECTED_DEVICE_KEY);
      } else {
        localStorage.setItem(SELECTED_DEVICE_KEY, deviceName);
      }
    } catch {
      // localStorage not available (e.g. private mode)
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // Eagerly load devices once on mount so all pages have them immediately
  useEffect(() => {
    listAudioDevices();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AudioDevicesContext.Provider
      value={{
        audioDevices,
        selectedDevice,
        isLoading,
        error,
        listAudioDevices,
        setSelectedDevice,
        clearError,
      }}
    >
      {children}
    </AudioDevicesContext.Provider>
  );
}

export function useAudioDevices(): AudioDevicesContextValue {
  const ctx = useContext(AudioDevicesContext);
  if (!ctx) {
    throw new Error("useAudioDevices must be used inside <AudioDevicesProvider>");
  }
  return ctx;
}
