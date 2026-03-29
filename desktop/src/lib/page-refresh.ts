/**
 * Page refresh event system.
 *
 * Pages/components call `usePageRefreshHandler` to register a refresh callback
 * for a given route. The QuickActionBar and sidebar can then call
 * `triggerPageRefresh(route)` to ask that page to reload its data.
 *
 * This is intentionally simple — no React context overhead, just a CustomEvent
 * dispatched on `window` so any component tree can listen.
 */

export const PAGE_REFRESH_EVENT = "matrx-page-refresh";

export interface PageRefreshEvent extends CustomEvent {
  detail: { route: string };
}

/** Dispatch a refresh event for a specific route (or all routes if route is "*"). */
export function triggerPageRefresh(route: string = "*"): void {
  window.dispatchEvent(
    new CustomEvent(PAGE_REFRESH_EVENT, { detail: { route } }),
  );
}
