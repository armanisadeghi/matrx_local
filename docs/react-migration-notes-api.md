# React Team — Notes API Migration Guide

> Share this with any React / Next.js team working against the Matrx Local engine.

---

## What changed and why

The local engine's document/notes API has been renamed and redesigned.
The old `/documents/*` prefix no longer exists. Use `/notes/*` for everything.
The route was removed (not just deprecated) to prevent any accidental reliance on the old path.

Additionally, storage locations are now **user-configurable** — never assume a specific
absolute path on the user's machine.

---

## Route rename: `/documents/*` → `/notes/*`

Every endpoint that was under `/documents` is now under `/notes`.

| Old | New |
|-----|-----|
| `GET /documents/tree` | `GET /notes/tree` |
| `GET /documents/notes` | `GET /notes/notes` |
| `GET /documents/notes/{id}` | `GET /notes/notes/{id}` |
| `POST /documents/notes` | `POST /notes/notes` |
| `PUT /documents/notes/{id}` | `PUT /notes/notes/{id}` |
| `DELETE /documents/notes/{id}` | `DELETE /notes/notes/{id}` |
| `GET /documents/notes/{id}/versions` | `GET /notes/notes/{id}/versions` |
| `POST /documents/notes/{id}/revert` | `POST /notes/notes/{id}/revert` |
| `POST /documents/folders` | `POST /notes/folders` |
| `PUT /documents/folders/{id}` | `PUT /notes/folders/{id}` |
| `DELETE /documents/folders/{id}` | `DELETE /notes/folders/{id}` |
| `GET /documents/sync/status` | `GET /notes/sync/status` |
| `POST /documents/sync/trigger` | `POST /notes/sync/trigger` |
| `POST /documents/sync/pull` | `POST /notes/sync/pull` |
| `POST /documents/sync/pull-note` | `POST /notes/sync/pull-note` |
| `GET /documents/conflicts` | `GET /notes/conflicts` |
| `POST /documents/conflicts/{id}/resolve` | `POST /notes/conflicts/{id}/resolve` |
| `GET /documents/shares` | `GET /notes/shares` |
| `POST /documents/shares` | `POST /notes/shares` |
| `GET /documents/mappings` | `GET /notes/mappings` |
| `POST /documents/mappings` | `POST /notes/mappings` |
| `GET /documents/local/folders` | `GET /notes/local/folders` |
| `GET /documents/local/files` | `GET /notes/local/files` |

---

## Architecture: local-first

Every notes CRUD operation now reads/writes the **local filesystem first** and returns
immediately. Supabase sync happens in the background after the response is sent.

This means:

- **Creates/updates succeed even with no internet.** The response will include `"_synced_to_cloud": false` if Supabase was unreachable. That's fine — the file is safe locally.
- **Reads come from local files.** `GET /notes/tree` builds the folder tree by scanning the local filesystem — it does not query Supabase.
- **Note IDs are deterministic.** When the engine generates a note from a local file it didn't create, the ID is derived from the file path (UUID v5). Don't assume all notes have random UUIDs.

---

## Storage paths: never hardcode them

Paths like `~/Documents/Matrx/Notes/` are **defaults**, not guarantees.
Users can change any storage location through the Settings → Storage tab, and those
changes take effect immediately without a restart.

### How to get the current resolved paths

```typescript
// In your engine API client
const paths = await engine.getPaths(); // GET /system/paths

// paths.resolved.notes  → absolute path to notes folder
// paths.resolved.files  → absolute path to files folder
// paths.resolved.code   → absolute path to code folder
// paths.aliases["@notes"] → same thing, usable in tool calls
```

Fetch this once on startup and cache it. Refetch when the user changes a path setting.

### In tool calls, use aliases instead of absolute paths

```jsonc
// ✅ Correct — engine resolves the alias dynamically
{ "tool": "Read", "input": { "file_path": "@notes/Work/project-plan.md" } }
{ "tool": "Read", "input": { "file_path": "@files/reports/q1.pdf" } }

// ❌ Wrong — hardcoded paths that will break on other machines
{ "tool": "Read", "input": { "file_path": "C:/Users/arman/Documents/Matrx/Notes/..." } }
{ "tool": "Read", "input": { "file_path": "/Users/arman/Documents/Matrx/Notes/..." } }
```

### Available aliases

| Alias | Default | Description |
|-------|---------|-------------|
| `@notes` | `~/Documents/Matrx/Notes/` | User's notes (.md/.txt) |
| `@files` | `~/Documents/Matrx/Files/` | Binary files (PDF, images, etc.) |
| `@code` | `~/Documents/Matrx/Code/` | User's code/project directories |
| `@workspaces` | `~/.matrx/workspaces/` | Agent working copies of repos |
| `@agentdata` | `~/.matrx/data/` | Agent internal data |
| `@matrx` | `~/.matrx/` | Engine internals |
| `@home` | User's home dir | Cross-platform `~` |
| `@temp` | OS temp/cache dir | Temporary files, screenshots |
| `@docs` | Same as `@notes` | **Deprecated — use `@notes`** |

---

## Path safety guarantee

The engine **never throws an error because a directory is missing**.
If a configured path is gone (deleted, drive unmounted), `safe_dir()` automatically:
1. Tries to recreate it.
2. Falls back to the compiled default if recreation fails.
3. Logs a warning — the caller's operation always proceeds.

This means your frontend never needs to handle "directory not found" errors from storage operations.

---

## New endpoints: storage path management

Users can change storage paths. You can read and update them:

```http
GET  /settings/paths              → list all paths with current values
PUT  /settings/paths/{name}       → set a custom path (body: { "path": "/new/path" })
DELETE /settings/paths/{name}     → reset to compiled default
```

Response shape for each path:
```jsonc
{
  "name": "notes",
  "label": "Notes folder",
  "current": "/home/arman/Documents/Matrx/Notes",
  "default": "/home/arman/Documents/Matrx/Notes",
  "is_custom": false,
  "user_visible": true
}
```

---

## Summary checklist for your codebase

- [ ] Replace all `/documents/` URLs with `/notes/`
- [ ] If hardcoding notes path like `~/.matrx/documents/` → fetch from `GET /system/paths` instead
- [ ] In tool calls, use `@notes/...` not absolute paths
- [ ] Don't assume note IDs are random UUIDs — use them as opaque strings
- [ ] `_synced_to_cloud: false` in a notes response is normal when offline — not an error
