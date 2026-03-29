import { useEffect, useCallback } from "react";
import { PAGE_REFRESH_EVENT } from "@/lib/page-refresh";
import type { PageRefreshEvent } from "@/lib/page-refresh";

/**
 * Register a refresh handler for a given route.
 *
 * When `triggerPageRefresh(route)` or `triggerPageRefresh("*")` is called,
 * the provided `onRefresh` callback will be invoked.
 *
 * @param route   The route this handler belongs to, e.g. "/local-models"
 * @param onRefresh  Stable callback (wrap in useCallback in the caller)
 */
export function usePageRefreshHandler(
  route: string,
  onRefresh: () => void,
): void {
  const handler = useCallback(
    (e: Event) => {
      const detail = (e as PageRefreshEvent).detail;
      if (detail.route === "*" || detail.route === route) {
        onRefresh();
      }
    },
    [route, onRefresh],
  );

  useEffect(() => {
    window.addEventListener(PAGE_REFRESH_EVENT, handler);
    return () => window.removeEventListener(PAGE_REFRESH_EVENT, handler);
  }, [handler]);
}
