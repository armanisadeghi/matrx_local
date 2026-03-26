/**
 * TranscriptionContext — singleton for Whisper transcription state.
 *
 * Wraps `useTranscription()` once at the app root so that all consumers
 * (Voice.tsx, NoteEditor dictation, CompactRecorderWindow, background
 * recording) share the **same** Rust audio pipeline and React state.
 *
 * Without this, each `useTranscription()` call creates an independent
 * instance. Since the Rust side only allows one active recording stream,
 * multiple instances cause state divergence: one instance thinks it's
 * recording while Rust has already rejected the duplicate start request.
 */

import { createContext, useContext } from "react";
import {
  useTranscription,
  type TranscriptionState,
  type TranscriptionActions,
} from "@/hooks/use-transcription";

interface TranscriptionContextValue {
  state: TranscriptionState;
  actions: TranscriptionActions;
}

const noopAsync = async () => ({}) as never;
const noop = () => {};

const defaultState: TranscriptionState = {
  setupStatus: null,
  hardwareResult: null,
  downloadProgress: null,
  isDetecting: false,
  isDownloading: false,
  downloadingFilename: null,
  downloadQueue: [],
  isInitializing: false,
  isRecording: false,
  isProcessingTail: false,
  segments: [],
  fullTranscript: "",
  activeModel: null,
  liveRms: 0,
  isCalibrating: false,
  audioDevices: [],
  selectedDevice: null,
  error: null,
};

const defaultActions: TranscriptionActions = {
  detectHardware: noopAsync,
  downloadModel: noopAsync,
  queueDownload: noop,
  downloadAll: noop,
  downloadVadModel: noopAsync,
  initTranscription: noopAsync,
  startRecording: noopAsync,
  stopRecording: noopAsync,
  checkModelExists: noopAsync,
  listDownloadedModels: noopAsync,
  deleteModel: noopAsync,
  refreshSetupStatus: noopAsync,
  listAudioDevices: noopAsync,
  setSelectedDevice: noop,
  clearSegments: noop,
  clearError: noop,
  quickSetup: noopAsync,
  cancelDownload: noopAsync,
  forceReset: noop,
};

const Ctx = createContext<TranscriptionContextValue>({
  state: defaultState,
  actions: defaultActions,
});

export function TranscriptionProvider({ children }: { children: React.ReactNode }) {
  const [state, actions] = useTranscription();
  return (
    <Ctx.Provider value={{ state, actions }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTranscriptionApp(): TranscriptionContextValue {
  return useContext(Ctx);
}
