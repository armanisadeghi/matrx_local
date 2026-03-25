# Matrx Local — Comprehensive Configuration Audit

> Generated 2026-03-24. This document catalogs every user-facing setting, its
> current storage location, default value, and cloud sync status.

---

## 1. Application Settings (currently in `AppSettings` / localStorage)

These are the "official" settings defined in `desktop/src/lib/settings.ts` and
synced to Supabase via `app_settings.settings_json`.

| # | Setting | Key (local) | Key (cloud) | Type | Default | Storage | Cloud Sync |
|---|---------|-------------|-------------|------|---------|---------|------------|
| 1 | Launch on startup | `launchOnStartup` | `launch_on_startup` | boolean | `false` | localStorage | Yes |
| 2 | Minimize to tray | `minimizeToTray` | `minimize_to_tray` | boolean | `true` | localStorage | Yes |
| 3 | Theme | `theme` | `theme` | enum: dark/light/system | `"dark"` | localStorage + `matrx-theme` | Yes |
| 4 | Auto-check updates | `autoCheckUpdates` | `auto_check_updates` | boolean | `true` | localStorage | Yes |
| 5 | Update check interval (min) | `updateCheckInterval` | `update_check_interval` | number | `240` | localStorage | Yes |
| 6 | Headless scraping | `headlessScraping` | `headless_scraping` | boolean | `true` | localStorage | Yes |
| 7 | Scrape delay (seconds) | `scrapeDelay` | `scrape_delay` | string/number | `"1.0"` | localStorage | Yes |
| 8 | Proxy enabled | `proxyEnabled` | `proxy_enabled` | boolean | `true` | localStorage | Yes |
| 9 | Proxy port | `proxyPort` | `proxy_port` | number | `22180` | localStorage | Yes |
| 10 | Tunnel enabled | `tunnelEnabled` | `tunnel_enabled` | boolean | `false` | localStorage | Yes |
| 11 | Instance name | `instanceName` | `instance_name` | string | `"My Computer"` | localStorage | Yes |
| 12 | Notification sound | `notificationSound` | `notification_sound` | boolean | `true` | localStorage | Yes |
| 13 | Notification sound style | `notificationSoundStyle` | `notification_sound_style` | enum: chime/alert/success/error | `"chime"` | localStorage | Yes |
| 14 | Wake word enabled | `wakeWordEnabled` | — | boolean | `true` | localStorage | **NO** |
| 15 | Wake word listen on startup | `wakeWordListenOnStartup` | — | boolean | `true` | localStorage | **NO** |

---

## 2. LLM / Local Model Settings (currently hardcoded or ephemeral)

Found in `desktop/src/lib/llm/api.ts`, `desktop/src/hooks/use-llm.ts`,
`desktop/src/hooks/use-chat.ts`, and Rust `desktop/src-tauri/src/llm/`.

| # | Setting | Current Location | Type | Default | Storage | Cloud Sync |
|---|---------|-----------------|------|---------|---------|------------|
| 16 | Default LLM model (local) | hardcoded in quickSetup | string | hardware-recommended | None (ephemeral) | **NO** |
| 17 | Default GPU layers | hardcoded in quickSetup | number | hardware-recommended | None | **NO** |
| 18 | Default context length | hardcoded `8192` in quickSetup | number | `8192` | None | **NO** |
| 19 | Chat temperature | `CHAT_PARAMS.temperature` | number | `0.7` | Hardcoded | **NO** |
| 20 | Chat top_p | `CHAT_PARAMS.top_p` | number | `0.8` | Hardcoded | **NO** |
| 21 | Chat top_k | `CHAT_PARAMS.top_k` | number | `20` | Hardcoded | **NO** |
| 22 | Chat max_tokens | hardcoded in chatCompletion | number | `1024` | Hardcoded | **NO** |
| 23 | Reasoning temperature | `REASONING_PARAMS.temperature` | number | `0.6` | Hardcoded | **NO** |
| 24 | Reasoning top_p | `REASONING_PARAMS.top_p` | number | `0.95` | Hardcoded | **NO** |
| 25 | Enable thinking mode | `chat_template_kwargs.enable_thinking` | boolean | `false` (chat) / `true` (reasoning) | Hardcoded | **NO** |
| 26 | Tool call temperature | `TOOL_CALL_PARAMS.temperature` | number | `0.7` | Hardcoded | **NO** |
| 27 | Tool call top_p | `TOOL_CALL_PARAMS.top_p` | number | `0.8` | Hardcoded | **NO** |
| 28 | Tool call top_k | `TOOL_CALL_PARAMS.top_k` | number | `20` | Hardcoded | **NO** |
| 29 | Structured output temperature | hardcoded | number | `0.1` | Hardcoded | **NO** |
| 30 | Stream max_tokens | hardcoded | number | `1024` | Hardcoded | **NO** |
| 31 | HuggingFace token (GGUF downloads) | `ApiKeysRepo` key `huggingface` + `GET /settings/api-keys/huggingface/value` for Tauri | string | unset | Engine SQLite (`~/.matrx/matrx.db` via settings blob); legacy `llm.json` fallback | **NO** (same as other API keys) |
| 32 | Auto-start LLM server on app launch | not implemented | boolean | `false` | None | **NO** |

---

## 3. Chat Settings (currently hardcoded or localStorage)

Found in `desktop/src/hooks/use-chat.ts` and `desktop/src/pages/Chat.tsx`.

| # | Setting | Current Location | Type | Default | Storage | Cloud Sync |
|---|---------|-----------------|------|---------|---------|------------|
| 33 | Default AI model (cloud) | `FALLBACK_MODELS[0].id` | string | `"claude-sonnet-4-6"` | Ephemeral | **NO** |
| 34 | Default chat mode | useState initial | enum: chat/co-work/code | `"chat"` | Ephemeral per conversation | **NO** |
| 35 | Chat history max conversations | `MAX_CONVERSATIONS` | number | `100` | Hardcoded | **NO** |
| 36 | Default system prompt for chat | user selection | string | "Assistant" builtin | localStorage `matrx-system-prompts` | **NO** |

---

## 4. Transcription / Voice Settings (currently in Rust config or ephemeral)

Found in `desktop/src/hooks/use-transcription.ts`, `desktop/src/lib/transcription/types.ts`,
Rust `desktop/src-tauri/src/transcription/`.

| # | Setting | Current Location | Type | Default | Storage | Cloud Sync |
|---|---------|-----------------|------|---------|---------|------------|
| 37 | Default Whisper model | Rust `transcription.json` | string | hardware-recommended | Tauri app data | **NO** |
| 38 | Audio input device | `AudioDevicesContext` | string | system default (null) | Context only (ephemeral) | **NO** |
| 39 | Auto-init transcription on startup | Rust auto-init logic | boolean | `true` (if setup_complete) | Tauri config | **NO** |
| 40 | Processing tail timeout (ms) | hardcoded `15_000` | number | `15000` | Hardcoded | **NO** |

---

## 5. Wake Word Settings (currently in Rust SQLite + localStorage)

Found in `desktop/src/pages/WakeWord.tsx`, `desktop/src/lib/transcription/types.ts`.

| # | Setting | Current Location | Type | Default | Storage | Cloud Sync |
|---|---------|-----------------|------|---------|---------|------------|
| 41 | Wake word engine | Rust SQLite | enum: whisper/oww | `"whisper"` | SQLite (Rust) | **NO** |
| 42 | OWW model name | Rust SQLite | string | `"hey_jarvis"` | SQLite (Rust) | **NO** |
| 43 | OWW threshold | Rust SQLite | number (0-1) | `0.5` | SQLite (Rust) | **NO** |
| 44 | Custom keyword (whisper) | Rust SQLite | string | `"hey matrix"` | SQLite (Rust) | **NO** |

---

## 6. UI / Layout Settings (currently localStorage)

Found scattered across components.

| # | Setting | Current Location | Type | Default | Storage | Cloud Sync |
|---|---------|-----------------|------|---------|---------|------------|
| 45 | Sidebar collapsed | `AppSidebar.tsx` | boolean | `false` | localStorage `sidebar-collapsed` | **NO** |
| 46 | Chat sidebar collapsed | `Chat.tsx` | boolean | `false` | Component state | **NO** |
| 47 | First-run dismissed | `App.tsx` | boolean | `false` | localStorage `matrx-setup-dismissed` | **NO** |

---

## 7. Engine / Backend Settings (Python `settings_sync.py` + env vars)

Found in `app/services/cloud_sync/settings_sync.py`, `app/config.py`, `.env`.

| # | Setting | Current Location | Type | Default | Storage | Cloud Sync |
|---|---------|-----------------|------|---------|---------|------------|
| 48 | Engine port | `run.py` / config | number | `22140` | `~/.matrx/local.json` | **NO** |
| 49 | API key (engine auth) | `.env` `API_KEY` | string | — | `.env` file | **NO** |
| 50 | Scraper API key | `.env` `SCRAPER_API_KEY` | string | — | `.env` file | **NO** |
| 51 | Scraper server URL | `.env` `SCRAPER_SERVER_URL` | string | — | `.env` file | **NO** |
| 52 | Database URL (local PG) | `.env` `DATABASE_URL` | string | — | `.env` file | **NO** |

---

## 8. Storage Paths (engine API /settings/paths)

Found in `app/api/settings_routes.py`.

| # | Setting | Current Location | Type | Default | Storage | Cloud Sync |
|---|---------|-----------------|------|---------|---------|------------|
| 53 | Documents directory | Engine settings | path | OS-specific | `~/.matrx/settings.json` | **NO** |
| 54 | Downloads directory | Engine settings | path | OS-specific | `~/.matrx/settings.json` | **NO** |
| 55 | Scrape output directory | Engine settings | path | OS-specific | `~/.matrx/settings.json` | **NO** |

---

## 9. API Keys (engine-managed, /settings/api-keys)

These are managed by the engine's API key system, stored in `.env` or engine config.

| # | Setting | Current Location | Type | Default | Storage | Cloud Sync |
|---|---------|-----------------|------|---------|---------|------------|
| 56 | Anthropic API key | Engine `.env` | string | — | `.env` | **NO** |
| 57 | OpenAI API key | Engine `.env` | string | — | `.env` | **NO** |
| 58 | Google/Gemini API key | Engine `.env` | string | — | `.env` | **NO** |
| 59 | Groq API key | Engine `.env` | string | — | `.env` | **NO** |
| 60 | Together API key | Engine `.env` | string | — | `.env` | **NO** |
| 61 | xAI API key | Engine `.env` | string | — | `.env` | **NO** |
| 62 | Cerebras API key | Engine `.env` | string | — | `.env` | **NO** |
| 63 | Brave Search API key | Engine `.env` | string | — | `.env` | **NO** |

---

## 10. Forbidden URLs (engine-managed)

| # | Setting | Current Location | Type | Default | Storage | Cloud Sync |
|---|---------|-----------------|------|---------|---------|------------|
| 64 | Forbidden URL list | Engine API | string[] | `[]` | `~/.matrx/settings.json` | **NO** |

---

## Summary: Gaps Identified

### Settings NOT in the centralized AppSettings / not synced to cloud:

1. **Wake word settings** (#14, 15, 41-44) — partially in localStorage, partially in Rust SQLite
2. **ALL LLM inference parameters** (#16-32) — entirely hardcoded, no persistence
3. **ALL chat defaults** (#33-36) — hardcoded or ephemeral
4. **ALL transcription settings** (#37-40) — only in Rust config, not synced
5. **UI layout preferences** (#45-47) — scattered localStorage keys
6. **Storage paths** (#53-55) — engine-only, not synced
7. **Forbidden URLs** (#64) — engine-only, not synced

### Settings already in cloud sync (via `app_settings.settings_json`):
- #1-13 (Application, Proxy, Scraping, Updates, Instance, Notifications)

### Database structure:
- `app_settings` table with `settings_json` JSONB column — **perfect for storing all settings**
- No schema changes needed — we just expand the JSON blob with new keys
- Cloud sync already works via `SettingsSync.sync()` — bidirectional with timestamp comparison

---

## Implementation Status (COMPLETED)

### What Was Done

#### Phase 1: Expanded AppSettings type and defaults
- **`desktop/src/lib/settings.ts`** — `AppSettings` interface expanded from 15 to 48+ fields
- **`desktop/src/lib/settings.ts`** — `DEFAULTS` object expanded with all new defaults
- **`desktop/src/lib/settings.ts`** — `mergeCloudSettings()` handles all new cloud→local mappings
- **`desktop/src/lib/settings.ts`** — `settingsToCloud()` handles all new local→cloud mappings
- **`app/services/cloud_sync/settings_sync.py`** — `DEFAULT_SETTINGS` expanded to match TypeScript

#### Phase 2: Created Configurations page
- **`desktop/src/pages/Configurations.tsx`** — New centralized page with:
  - 10 sections: Application, Appearance, Chat & AI, Local LLM, Voice, Wake Word, Scraping, Proxy, Notifications, UI
  - Responsive 3-column grid layout (1 col mobile, 2 col large, 3 col xl)
  - Per-section save/cancel buttons (only appear when section has dirty state)
  - Global floating save bar at bottom (appears when any section is dirty)
  - Uses Switch, Select, Slider, Input, NumberInput controls
- **`desktop/src/hooks/use-configurations.ts`** — New hook with:
  - Draft/saved state comparison
  - Per-section dirty tracking via `SECTION_KEYS` mapping
  - `saveSection()` and `cancelSection()` for fine-grained control
  - `saveAll()` and `cancelAll()` for global control
  - Automatic sync to engine/Tauri on save

#### Phase 3: Wired to actual behavior
- **`desktop/src/lib/llm/api.ts`** — All 4 LLM API functions now read sampling parameters
  from `AppSettings` instead of hardcoded constants (temperature, top_p, top_k, max_tokens)
- **`desktop/src/hooks/use-chat.ts`** — Default model and chat mode loaded from settings on mount
- **`desktop/src/components/layout/AppSidebar.tsx`** — Sidebar collapsed state reads/writes to unified settings

#### Phase 4: Navigation integrated
- **`desktop/src/App.tsx`** — Configurations page added to route list
- **`desktop/src/components/layout/AppSidebar.tsx`** — "Configurations" nav item with SlidersHorizontal icon

### Data Flow (End-to-End)

```
User edits in Configurations page
  → useConfigurations hook updates draft state
  → User clicks Save (section or global)
  → saveSettings() writes to localStorage (key: "matrx-settings")
  → syncAllSettings() pushes to Tauri/engine side effects
  → settingsToCloud() converts to snake_case
  → SettingsSync.sync() upserts to Supabase app_settings.settings_json
  → On next app launch: loadSettings() reads from localStorage
  → mergeCloudSettings() merges any newer cloud values
```

### Database Storage

- **Table:** `app_settings` (migration 002)
- **Column:** `settings_json` (JSONB)
- **Scope:** Per user + per instance
- **No schema changes needed** — the JSONB blob naturally accommodates new keys
- All 48+ settings are stored in a single JSON object, keyed by snake_case names

### Cloud Sync Behavior

- Bidirectional sync via timestamp comparison (`updated_at`)
- Local-first: app always works offline, syncs when connection available
- On startup: `SettingsSync.sync()` compares timestamps, pulls newer or pushes
- Manual: user can force push/pull from Settings > Cloud tab
- New settings automatically included since they're part of the `settings_json` blob
