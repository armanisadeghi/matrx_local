import type { BackgroundTask } from "../orchestrator";
import { engine } from "@/lib/api";
import supabase from "@/lib/supabase";

export const pushTokenToPython: BackgroundTask = {
  id: "push-token-to-python",
  label: "Push auth token to Python engine",
  priority: 5,
  async fn() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token || !session?.user?.id) return;
    await engine.syncTokenToPython(
      session.access_token,
      session.user.id,
      session.refresh_token ?? undefined,
      session.expires_in ?? undefined,
    );
  },
};
