# Adding Background Tasks

Background tasks run after the engine connects. They are idle-scheduled, non-blocking, and fire-and-forget. Use them for prefetching data, syncing state, and warming caches so tabs feel instant when the user navigates to them.

## Interface

```typescript
interface BackgroundTask {
  id: string;        // unique key, e.g. "prefetch-remote-access"
  label: string;     // human-readable, appears in logs
  priority: number;  // lower runs first (0-99)
  runOnce?: boolean; // default true — skip if already completed this session
  fn: () => Promise<void>;
}
```

## Steps

1. Create a file in `tasks/`, e.g. `tasks/my-feature.ts`.
2. Export one or more `BackgroundTask` objects.
3. Import and register them in `index.ts` via `orchestrator.register(myTask)`.

That's it. The orchestrator handles scheduling, error catching, and logging.

## Priority Ranges

| Range | Category |
|-------|----------|
| 0-9   | Critical sync (auth token push) |
| 10-29 | Cloud sync and settings |
| 30-49 | Prefetch (tab data warmup) |
| 50-69 | Warmup (caches, schemas) |
| 70-99 | Housekeeping (cleanup, analytics) |

## Logging

All task logs are emitted automatically by the orchestrator with `source: "bg-tasks"`. They appear in the Activity tab under "Background Tasks" and in the Client tab of DevTerminalPanel.

You do not need to add logging inside your task function unless you want extra detail. If you do, import `emitClientLog` from `@/hooks/use-unified-log` and use `"bg-tasks"` as the source.

## Rules

- Tasks must not mutate React state directly. They can call engine API methods and write to localStorage.
- Tasks must not run indefinitely. For periodic loops, use Python-side `asyncio.create_task` in `app/main.py`.
- Errors are caught by the orchestrator — a failed task never blocks the queue.
- Tasks with `runOnce: true` (default) run once per session. Set `runOnce: false` for tasks that should re-run on every `start()` call (e.g. after engine restart).

## Example

```typescript
// tasks/warm-tool-schemas.ts
import type { BackgroundTask } from "../orchestrator";
import { engine } from "@/lib/api";

export const warmToolSchemas: BackgroundTask = {
  id: "warm-tool-schemas",
  label: "Warm tool schema cache",
  priority: 55,
  async fn() {
    const tools = await engine.listTools();
    for (const name of tools.slice(0, 20)) {
      await engine.get(`/tools/schema/${name}`);
    }
  },
};
```

Then in `index.ts`:
```typescript
import { warmToolSchemas } from "./tasks/warm-tool-schemas";
orchestrator.register(warmToolSchemas);
```
