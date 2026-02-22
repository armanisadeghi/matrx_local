# Frontend Team — Remaining Work for Local Tools

> Review of `ai-matrx-admin/app/(public)/demos/local-tools/` vs the Matrx Local backend API.
> Updated: 2026-02-21

---

## ✅ Done — No Changes Needed

- **Connection infra**: `useMatrxLocal` hook (port discovery, REST, WebSocket)
- **Connection UI**: `ConnectionBar` (status, port, latency)
- **Result display**: `ResultPanel` (JSON, images, metadata)
- **Landing page**: Quick presets, tool explorer, sub-page navigation
- **Scraper page**: All 4 tabs (Scrape, Search, Research, Comparison)
- **Shell page**: Foreground + background commands, BashOutput, TaskStop
- **System page**: SystemInfo, Screenshot, Clipboard, Notifications, OpenUrl/OpenPath
- **Files page**: Read, Write, Edit, Glob, Grep, ListDirectory, Download, Upload
- **Terminal page**: Full WebSocket REPL with cd, ls, cat, help

---

## 🔲 Remaining Work

### 1. Documents / Notes UI (Highest Priority — NOT STARTED)

The backend has a full document management system at `/documents/*` that has zero frontend coverage.

**Required headers:** All document endpoints need `X-User-Id` header (from Supabase `user.id`).

| Feature                             | Endpoint(s)                                                          | Priority |
| ----------------------------------- | -------------------------------------------------------------------- | -------- |
| Folder tree view                    | `GET /documents/tree`                                                | High     |
| Create/rename/delete folders        | `POST/PUT/DELETE /documents/folders/{id}`                            | High     |
| List notes (folder filter + search) | `GET /documents/notes?folder_id=&search=`                            | High     |
| Create/edit/delete notes            | `POST/PUT/DELETE /documents/notes/{id}`                              | High     |
| Sync status display                 | `GET /documents/sync/status`                                         | High     |
| Trigger full sync                   | `POST /documents/sync/trigger`                                       | High     |
| Note version history                | `GET /documents/notes/{id}/versions`                                 | Medium   |
| Revert to version                   | `POST /documents/notes/{id}/revert`                                  | Medium   |
| Pull changes                        | `POST /documents/sync/pull`                                          | Medium   |
| Conflict list + resolution          | `GET /documents/conflicts`, `POST /documents/conflicts/{id}/resolve` | Medium   |
| Local file browser                  | `GET /documents/local/folders`, `GET /documents/local/files`         | Medium   |
| Share note/folder                   | `POST/GET/PUT/DELETE /documents/shares`                              | Low      |
| Directory mapping management        | `POST/GET/DELETE /documents/mappings`                                | Low      |

### 2. Cloud Sync Configuration (High Priority)

After user authenticates, the frontend must call:

```
POST /cloud/configure
Body: { "jwt": "<supabase_access_token>", "user_id": "<supabase_user_id>" }
```

This enables settings persistence across devices. Without this call, all sync operations return `not_configured`.

| Feature                            | Endpoint                                         | Priority |
| ---------------------------------- | ------------------------------------------------ | -------- |
| Configure cloud sync (after login) | `POST /cloud/configure`                          | High     |
| View synced settings               | `GET /cloud/settings`                            | Medium   |
| Update settings                    | `PUT /cloud/settings`                            | Medium   |
| Push/pull settings                 | `POST /cloud/sync/push`, `POST /cloud/sync/pull` | Medium   |
| Instance management                | `GET /cloud/instance`, `GET /cloud/instances`    | Low      |

### 3. Engine Health & Status (Partial)

| Feature              | Status     | Notes                                           |
| -------------------- | ---------- | ----------------------------------------------- |
| Connection detection | ✅ Done    | `useMatrxLocal`                                 |
| Health polling       | ❌ Missing | Poll `GET /health` every 10-30s                 |
| Version display      | ❌ Missing | `GET /version`                                  |
| Engine settings UI   | ❌ Missing | `GET/PUT /settings` (proxy port, headless mode) |
| Port allocations     | ❌ Missing | `GET /ports`                                    |

### 4. WebSocket Enhancements (Partial)

| Feature                   | Status                                        |
| ------------------------- | --------------------------------------------- |
| Basic WS in terminal      | ✅ Done                                       |
| Cancel individual request | ❌ Send `{"id": "req-1", "action": "cancel"}` |
| Cancel all requests       | ❌ Send `{"action": "cancel_all"}`            |
| Active request tracking   | ❌ Show in-flight tool calls                  |

---

## 📋 Suggested Build Order

1. **Health polling + version** — Quick win, better UX
2. **Cloud sync config** — Call `/cloud/configure` after auth
3. **Documents page** — Folder tree → note list → create/edit
4. **Sync status + trigger** — Last sync time, manual sync button
5. **WS cancel** — Important for long scrapes/research
6. **Conflict resolution** — Multi-device scenarios
7. **Engine settings** — Proxy config, scraping options
8. **Sharing** — Lower priority, defer if needed

# RESPONSES AND NOTES:

**Updated: 2026-02-21 by ai-matrx-admin frontend**

---

## ✅ All Items Addressed

### 1. Documents / Notes UI — DONE

- **New page**: `/demos/local-tools/documents`
- 7 tabs covering every `/documents/*` endpoint:
  - **Notes tab**: Folder tree sidebar (collapsible, with create/rename/delete), note list with search & folder filter, inline note editor with save
  - **Sync tab**: Sync status display (`GET /documents/sync/status`), full sync trigger, pull changes
  - **Versions tab**: Load version history by note ID, preview content, revert button
  - **Conflicts tab**: Side-by-side local vs remote content, resolve with "Keep Local" / "Keep Remote"
  - **Local Files tab**: Browse local folders/files via path input
  - **Shares tab**: List, create (JSON form), delete shares
  - **Mappings tab**: List, create, delete directory mappings
- **Auth note**: Since demo pages are under `(public)` with no auth, a **mock `X-User-Id` input** is provided at the top of the page for testing. The value is sent as the `X-User-Id` header on all document requests.

### 2. Cloud Sync Configuration — DONE

- **New page**: `/demos/local-tools/cloud-sync`
- Configure form with JWT + User ID fields → `POST /cloud/configure`
- Cloud settings viewer/editor with reload/save → `GET/PUT /cloud/settings`
- Push/Pull sync buttons → `POST /cloud/sync/push`, `POST /cloud/sync/pull`
- Instance management display → `GET /cloud/instance`, `GET /cloud/instances`

### 3. Engine Health & Status — DONE

- `useMatrxLocal` hook now polls `GET /health`, `GET /version`, `GET /ports` every 15s
- **ConnectionBar** shows health badge (green "Healthy"), version badge, alongside existing connection status
- **New page**: `/demos/local-tools/engine` with:
  - Health/Version/Port info cards
  - Settings JSON editor → `GET/PUT /settings`

### 4. WebSocket Enhancements — DONE

- `cancelRequest(id)` method sends `{"id":"…","action":"cancel"}` to cancel individual requests
- `cancelAll()` sends `{"action":"cancel_all"}` (was already partly done, now fully wired)
- **Active request tracking**: Hook tracks all in-flight WS calls with tool name + timestamp
- **ConnectionBar** shows orange "N in-flight" dropdown badge → click to see each active request with its duration and individual ✕ cancel button

---

## New Pages Summary

| Page              | URL                             | Endpoints Covered                            |
| ----------------- | ------------------------------- | -------------------------------------------- |
| Documents & Notes | `/demos/local-tools/documents`  | All `/documents/*` endpoints                 |
| Cloud Sync        | `/demos/local-tools/cloud-sync` | All `/cloud/*` endpoints                     |
| Engine Settings   | `/demos/local-tools/engine`     | `/health`, `/version`, `/ports`, `/settings` |

All 3 new pages are linked from the landing page (`/demos/local-tools`) as nav cards with "New" badges.
