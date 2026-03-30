# Path Resolution — How to Reference Files from React

> **Note:** The `@docs/` alias referenced below is deprecated. Use `@notes/` instead.
> See `react-migration-notes-api.md` for the current alias mappings (`@notes/`, `@files/`, `@code/`, etc.).

When invoking tools on the local engine, **never construct OS paths in React**.
The engine runs on the user's machine — it could be Windows (any drive), macOS, or Linux, with user-configurable storage locations. React has no way to know any of this.

Instead, use one of the two patterns below.

---

## Pattern 1 — Named Aliases in Tool Calls (preferred)

Use a `@name/` prefix in any `file_path` argument. The engine resolves it to the correct absolute path automatically, regardless of OS or configuration.

```json
{ "tool": "Read", "input": { "file_path": "@matrx/local.json" } }
{ "tool": "Read", "input": { "file_path": "@matrx/settings.json" } }
{ "tool": "Write", "input": { "file_path": "@docs/my-note.md", "content": "..." } }
{ "tool": "Read", "input": { "file_path": "@temp/screenshots/latest.png" } }
```

### Available aliases

| Alias | What it points to |
|-------|-------------------|
| `@matrx/` | `~/.matrx/` — engine discovery, settings, instance ID |
| `@docs/` | `~/.matrx/documents/` — user notes (user-configurable) |
| `@temp/` | Temp / cache directory — screenshots, audio, extracted files |
| `@data/` | Persistent app data directory |
| `@logs/` | Application log directory |
| `@home/` | User home directory (explicit form of `~`) |

`~/` also works as a classic Unix shorthand and is always expanded correctly, including on Windows.

---

## Pattern 2 — Fetch Resolved Paths Once on Startup

Call `GET /system/paths` (or use `engine.getPaths()`) once after the engine is discovered. Cache the result and use the absolute paths directly when you need to display them or pass them somewhere that does not go through the tool dispatcher.

```typescript
import { engine } from "@/lib/api";

const paths = await engine.getPaths();

// Use an alias in a tool call (engine resolves it):
engine.invokeTool("Read", { file_path: "@matrx/local.json" });

// Use the resolved absolute path when you need to display it to the user:
console.log(paths.resolved.screenshots);
// → "C:\Users\arman\AppData\Local\MatrxLocal\cache\screenshots"  (Windows)
// → "/home/arman/.local/share/matrx-local/temp/screenshots"      (Linux)
// → "/Users/arman/Library/Caches/MatrxLocal/screenshots"         (macOS)
```

### Response shape

```typescript
interface EnginePaths {
  aliases: {
    "@matrx": string;   // e.g. "C:\Users\arman\.matrx"
    "@docs":  string;
    "@temp":  string;
    "@data":  string;
    "@logs":  string;
    "@home":  string;   // user home directory
  };
  resolved: {
    discovery:   string;  // local.json — engine port discovery
    settings:    string;  // settings.json
    instance:    string;  // instance.json
    documents:   string;  // user documents root
    temp:        string;  // temp / cache root
    screenshots: string;  // screenshot output directory
    data:        string;  // persistent app data root
    logs:        string;  // log file directory
    config:      string;  // app config directory
  };
}
```

---

## What NOT to do

```typescript
// BAD — hardcoded home path assumption
const path = `C:/Users/${username}/.matrx/local.json`;

// BAD — ~ is a shell concept; React cannot expand it
const path = "~/.matrx/local.json";

// BAD — assumes the user is on their C drive
const path = `C:/Users/${username}/AppData/Roaming/MatrxLocal/settings.json`;
```

```typescript
// GOOD — let the engine resolve it
engine.invokeTool("Read", { file_path: "@matrx/local.json" });

// GOOD — fetch once, use everywhere
const { resolved } = await engine.getPaths();
showInUI(resolved.screenshots);
```

---

## Summary

| Question | Answer |
|----------|--------|
| Where is `~/.matrx`? | Always at the user's home directory on all platforms |
| Where are screenshots? | `@temp/screenshots/` — OS-dependent when installed |
| Where are documents? | `@docs/` — defaults to `~/.matrx/documents/`, user-configurable |
| Can React know the actual path? | Yes — call `engine.getPaths()` once and cache it |
| Can React construct a path itself? | No — always use an alias or fetch from the engine |
