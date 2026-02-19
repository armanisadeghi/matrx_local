import { useState, useCallback } from "react";
import { engine, type ToolResult } from "@/lib/api";

interface UseToolState {
  loading: boolean;
  result: ToolResult | null;
  error: string | null;
}

export function useTool() {
  const [state, setState] = useState<UseToolState>({
    loading: false,
    result: null,
    error: null,
  });

  const invoke = useCallback(
    async (tool: string, input: Record<string, unknown> = {}) => {
      setState({ loading: true, result: null, error: null });
      try {
        const result = await engine.invokeTool(tool, input);
        setState({ loading: false, result, error: null });
        return result;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        setState({ loading: false, result: null, error });
        throw err;
      }
    },
    []
  );

  const reset = useCallback(() => {
    setState({ loading: false, result: null, error: null });
  }, []);

  return { ...state, invoke, reset };
}
