/**
 * WakeWordContext
 *
 * Shares wake word state from Voice.tsx with the QuickActionBar without
 * duplicating the useWakeWord hook. Voice.tsx calls useWakeWord (which
 * manages the full lifecycle including session-aware wake/sleep callbacks)
 * and publishes state + actions via this context. The QuickActionBar
 * reads it for toggle/status display.
 *
 * When Voice.tsx has not mounted yet (user hasn't visited the Voice page),
 * the context falls back to a no-op default that the toolbar renders as
 * "idle" state.
 */

import { createContext, useContext, useState, useCallback } from "react";
import type { WakeWordHookState, WakeWordHookActions } from "@/hooks/use-wake-word";

interface WakeWordContextValue {
  state: WakeWordHookState;
  actions: WakeWordHookActions;
}

const noopAsync = async () => {};
const noop = () => {};

const defaultState: WakeWordHookState = {
  uiMode: "idle",
  engine: "whisper",
  listenRms: 0,
  activeTranscript: "",
  kmsModelReady: false,
  downloadProgress: null,
  error: null,
};

const defaultActions: WakeWordHookActions = {
  setup: noopAsync,
  startListening: noopAsync,
  stopListening: noopAsync,
  mute: noopAsync,
  unmute: noopAsync,
  dismiss: noopAsync,
  manualTrigger: noopAsync,
  setEngine: noopAsync,
  clearError: noop,
};

const WakeWordCtx = createContext<WakeWordContextValue>({
  state: defaultState,
  actions: defaultActions,
});

export function WakeWordProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState<WakeWordContextValue>({
    state: defaultState,
    actions: defaultActions,
  });

  return (
    <WakeWordCtx.Provider value={value}>
      <WakeWordSetterContext.Provider value={setValue}>
        {children}
      </WakeWordSetterContext.Provider>
    </WakeWordCtx.Provider>
  );
}

const WakeWordSetterContext = createContext<
  React.Dispatch<React.SetStateAction<WakeWordContextValue>>
>(() => {});

/**
 * Called by Voice.tsx to publish its wake word state into the context.
 * Returns a stable `publish` callback.
 */
export function usePublishWakeWord() {
  const setter = useContext(WakeWordSetterContext);
  const publish = useCallback(
    (state: WakeWordHookState, actions: WakeWordHookActions) => {
      setter({ state, actions });
    },
    [setter]
  );
  return publish;
}

/** Read wake word state from context (for QuickActionBar). */
export function useWakeWordContext(): WakeWordContextValue {
  return useContext(WakeWordCtx);
}
