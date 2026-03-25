import type { BackgroundTask } from "../orchestrator";
import { engine } from "@/lib/api";
import supabase from "@/lib/supabase";

export const cloudSettingsSync: BackgroundTask = {
  id: "cloud-settings-sync",
  label: "Configure cloud sync",
  priority: 10,
  async fn() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token || !session?.user?.id) return;
    await engine.configureCloudSync(session.access_token, session.user.id);
  },
};

export const cloudHeartbeat: BackgroundTask = {
  id: "cloud-heartbeat",
  label: "Send cloud heartbeat",
  priority: 20,
  async fn() {
    await engine.cloudHeartbeat();
  },
};
