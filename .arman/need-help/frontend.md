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
