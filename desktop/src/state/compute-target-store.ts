/**
 * Per-user selection of "the compute target this desktop's chats bind to".
 *
 * Plain React + localStorage. Cross-tab + cross-component updates propagate
 * via a custom event so any component reading the value re-renders without
 * pulling in zustand.
 */

import { useEffect, useState } from "react";

import type { ComputeTargetKind } from "@/lib/aidream-client";

export interface ComputeTargetRef {
  rowId: string;
  kind: ComputeTargetKind;
  /** Display label latched at selection. */
  name: string;
}

const STORAGE_KEY = "matrx-local.compute-target.v1";
const CHANGE_EVENT = "matrx-local.compute-target.change";

function readStored(): ComputeTargetRef | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ComputeTargetRef;
    if (!parsed.rowId || !parsed.kind) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(value: ComputeTargetRef | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    }
  } catch {
    // localStorage unavailable / quota — selection lives in memory only.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export const useComputeTargetStore = {
  getState(): { bound: ComputeTargetRef | null; setBound: (v: ComputeTargetRef | null) => void } {
    return {
      bound: readStored(),
      setBound: writeStored,
    };
  },
};

/**
 * Hook variant — re-renders the consumer when the bound target changes
 * (same tab or another tab via `storage` event).
 */
export function useBoundComputeTarget(): [
  ComputeTargetRef | null,
  (next: ComputeTargetRef | null) => void,
] {
  const [bound, setBoundState] = useState<ComputeTargetRef | null>(() =>
    readStored(),
  );

  useEffect(() => {
    const update = () => setBoundState(readStored());
    window.addEventListener(CHANGE_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(CHANGE_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);

  return [bound, writeStored];
}
