/**
 * LlmContext
 *
 * Provides a single shared useLlm() instance to the entire app.
 * Both Confidential Chat (LocalModels page) and Voice (and any other page) read from the same state,
 * so the LLM server port is visible everywhere once the server is started.
 */

import { createContext, useContext } from "react";
import { useLlm } from "@/hooks/use-llm";
import type { LlmState, LlmActions } from "@/hooks/use-llm";

const LlmAppContext = createContext<[LlmState, LlmActions] | null>(null);

export function LlmProvider({ children }: { children: React.ReactNode }) {
  const llm = useLlm();
  return (
    <LlmAppContext.Provider value={llm}>{children}</LlmAppContext.Provider>
  );
}

/** Use the shared app-level LLM state. Throws if used outside LlmProvider. */
export function useLlmApp(): [LlmState, LlmActions] {
  const ctx = useContext(LlmAppContext);
  if (!ctx) throw new Error("useLlmApp must be used within LlmProvider");
  return ctx;
}
