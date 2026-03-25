import type { BackgroundTask } from "../orchestrator";
import { engine } from "@/lib/api";

export const prefetchRemoteAccess: BackgroundTask = {
  id: "prefetch-remote-access",
  label: "Prefetch remote access data",
  priority: 30,
  async fn() {
    await Promise.allSettled([
      engine.get("/tunnel/status"),
      engine.getInstanceInfo(),
      engine.listInstances(),
    ]);
  },
};

export const prefetchDevices: BackgroundTask = {
  id: "prefetch-devices",
  label: "Prefetch device info",
  priority: 40,
  async fn() {
    await Promise.allSettled([
      engine.get("/devices/audio"),
      engine.get("/devices/connected"),
    ]);
  },
};

export const prefetchHardware: BackgroundTask = {
  id: "prefetch-hardware",
  label: "Prefetch hardware profile",
  priority: 50,
  async fn() {
    await engine.getHardware();
  },
};
