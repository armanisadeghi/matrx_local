/**
 * useServiceStatus — polls proxy and tunnel status from the Python engine.
 *
 * Only polls when the engine is connected. Interval: 15 seconds.
 * Provides cached status for the QuickActionBar indicators and a manual
 * cloud sync trigger.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { engine } from "@/lib/api";
import type { ProxyStatus } from "@/lib/api";
import type { EngineStatus } from "@/hooks/use-engine";

export interface TunnelStatus {
  running: boolean;
  url: string | null;
  ws_url: string | null;
  uptime_seconds: number;
  mode: string;
}

export interface ServiceStatusState {
  proxy: ProxyStatus | null;
  tunnel: TunnelStatus | null;
  cloudConfigured: boolean;
  cloudSyncing: boolean;
}

const POLL_INTERVAL = 15_000;

export function useServiceStatus(engineStatus: EngineStatus): [
  ServiceStatusState,
  { triggerCloudSync: () => Promise<void>; refresh: () => void },
] {
  const [state, setState] = useState<ServiceStatusState>({
    proxy: null,
    tunnel: null,
    cloudConfigured: false,
    cloudSyncing: false,
  });
  const mountedRef = useRef(true);

  const poll = useCallback(async () => {
    if (!engine.engineUrl) return;
    try {
      const [proxyRes, tunnelRes] = await Promise.allSettled([
        engine.proxyStatus(),
        engine.get("/tunnel/status") as Promise<TunnelStatus>,
      ]);
      if (!mountedRef.current) return;
      setState((prev) => ({
        ...prev,
        proxy: proxyRes.status === "fulfilled" ? proxyRes.value : prev.proxy,
        tunnel:
          tunnelRes.status === "fulfilled" ? tunnelRes.value : prev.tunnel,
      }));
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (engineStatus !== "connected") return;
    poll();
    const id = setInterval(poll, POLL_INTERVAL);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [engineStatus, poll]);

  const triggerCloudSync = useCallback(async () => {
    if (!engine.engineUrl) return;
    setState((prev) => ({ ...prev, cloudSyncing: true }));
    try {
      await engine.triggerCloudSync();
      setState((prev) => ({ ...prev, cloudSyncing: false, cloudConfigured: true }));
    } catch {
      setState((prev) => ({ ...prev, cloudSyncing: false }));
    }
  }, []);

  const refresh = useCallback(() => {
    poll();
  }, [poll]);

  return [state, { triggerCloudSync, refresh }];
}
