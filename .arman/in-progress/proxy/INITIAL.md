
This research report details the technical architecture and implementation strategies for configuring desktop applications as proxy servers, implementing offline-first cloud synchronization for settings, and utilizing Supabase for real-time data management.

---

### 1. Desktop Applications as Proxy Servers (Electron & Local)
Local desktop applications can be configured to act as proxy servers or to route traffic through external proxies. In an Electron context, this involves both the application's internal network requests and its ability to expose a proxy interface to other processes.

#### A. Configuring Electron to Use Proxies
Electron provides multiple ways to route its own traffic through SOCKS5 or HTTP proxies:
*   **Command Line Switches:** You can append switches during app initialization.
    *   `app.commandLine.appendSwitch('proxy-server', 'socks5://ip:port')` [Source](https://stackoverflow.com/questions/66867529/how-to-set-the-socks5-proxy-in-electron).
    *   *Note:* The `--proxy-server` switch traditionally does not support inline authentication (username/password) [Source](https://stackoverflow.com/questions/66867529/how-to-set-the-socks5-proxy-in-electron).
*   **Session-Based Proxying:** More granular control is available via the `session` API:
    *   `win.webContents.session.setProxy({ proxyRules: 'socks5://host:port' })` [Source](https://www.electronjs.org/docs/latest/api/structures/proxy-config).
    *   **Rules Syntax:** You can failover between proxy types using syntax like `http=foopy,socks5://bar.com` (use HTTP proxy `foopy`, fail over to SOCKS5 `bar.com`) [Source](https://www.electronjs.org/docs/latest/api/structures/proxy-config).
*   **Proxy Authentication:** Since inline credentials often fail in rules, developers use the `app.on('login')` event to provide credentials when the proxy server challenges the client [Source](https://github.com/electron/electron/issues/22885).

#### B. Architecture for "Residential Proxy" Functionality
To make a desktop application act as a **residential proxy server** (where the machine itself becomes the exit node for other remote clients):
*   **Back-Connect Tunneling:** A common pattern involves the local app establishing an SSH or WebSocket tunnel to a remote "control server." The control server then forwards incoming proxy requests down the tunnel to the local desktop app [Source](https://app.belodetek.io/).
*   **Local Proxy Software Integration:** Applications often bundle lightweight proxy cores like **3proxy** or **Xray**. These cores are configured to listen on a local port and route traffic through the residential ISP connection [Source](https://proxidize.com/blog/how-to-make-residential-proxies/).
*   **SOCKS5 Implementation:** The `proxy-socks` Electron project demonstrates forwarding local ports to remote IPs over SSH to build a "residential back-connect proxy network" [Source](https://app.belodetek.io/).

---

### 2. Offline-First Cloud Sync Best Practices
Offline-first architecture prioritizes the local experience as the default, treating the cloud as an opportunistic synchronization mechanism.

#### A. Core Architectural Patterns
*   **Single Source of Truth (Local):** The application should read from and write to a local database (e.g., SQLite/Room, IndexedDB/PouchDB) first. The UI observes this local store for changes, ensuring zero-latency feedback [Source](https://medium.com/@jusuftopic/offline-first-architecture-designing-for-reality-not-just-the-cloud-e5fd18e50a79).
*   **Local-First, Sync-Later:** 
    1.  User interaction updates local storage immediately.
    2.  The change is tagged with a `isSynced = false` or `pending` flag.
    3.  A background worker (like Android's `WorkManager` or a persistent Node.js loop in Electron) detects connectivity and batches the changes for transmission to the server [Source](https://think-it.io/insights/offline-apps).
*   **Optimistic Updates:** The UI assumes success and reflects changes instantly. If the background sync fails eventually, the app handles the rollback or notifies the user [Source](https://medium.com/@jusuftopic/offline-first-architecture-designing-for-reality-not-just-the-cloud-e5fd18e50a79).

#### B. Conflict Resolution Strategies
*   **Last Write Wins (LWW):** Uses timestamps to keep the most recent update. Simple but can lead to data loss if multiple users edit simultaneously [Source](https://think-it.io/insights/offline-apps).
*   **Conflict-free Replicated Data Types (CRDTs):** Complex algorithms (e.g., Automerge, Yjs) that allow multiple devices to merge data automatically without a central authority [Source](https://techbuzzonline.com/local-first-software-architecture-guide/).
*   **Deterministic Delta Sync:** Instead of syncing the entire settings object, only sync the "diff" (delta). This reduces bandwidth and minimizes the chance of overwriting unrelated settings [Source](https://developersvoice.com/blog/mobile/offline-first-sync-patterns/).

---

### 3. Using Supabase for Real-Time Settings Sync
Supabase provides the "Realtime" engine, built on Elixir and WebSockets, which can be leveraged for instant setting propagation.

#### A. Implementation Mechanisms
*   **Postgres Changes:** The desktop app subscribes to specific table changes. When settings are updated in the database (via another instance), Supabase broadcasts the change to all authorized clients [Source](https://supabase.com/docs/guides/realtime).
*   **Presence:** This feature can track which app instances are currently online. This is useful for seeing if a user has multiple active sessions (e.g., "Settings being edited on Desktop A") [Source](https://supabase.com/realtime).
*   **Broadcast:** Allows sending ephemeral messages between clients (e.g., "Settings updated, please refresh cache") without necessarily persisting them to the database first [Source](https://supabase.com/docs/guides/realtime).

#### B. Offline Integration with RxDB or PowerSync
Since Supabase Realtime requires an active connection, "local-first" functionality often requires a middle layer:
*   **RxDB + Supabase:** The `Supabase Replication Plugin` for RxDB handles two-way sync. It uses `PostgREST` for pulls/pushes and `Supabase Realtime` for live updates, managing the local-to-cloud bridge automatically [Source](https://rxdb.info/replication-supabase.html).
*   **PowerSync:** A drop-in sync layer that keeps a local SQLite database in sync with Supabase Postgres. It utilizes "Sync Rules" (SQL-like YAML) to define which data (e.g., user settings) should be synced to specific devices [Source](https://docs.powersync.com/integration-guides/supabase-+-powersync).

---

### 4. Architecture for Multiple App Instances per User
Managing multiple instances (e.g., a user logged in on two different desktops) requires a robust state management pattern.

#### A. "One Database Per User" vs. "Shared Database"
*   **One Database Per User Pattern:** Historically used by PouchDB/CouchDB. Each user has a unique database, simplifying security but complicating cross-user sharing. `Cloudant Envoy` can provide an "illusion" of one-db-per-user while storing data in a single massive database [Source](https://www.techaheadcorp.com/blog/offline-app-architecture/).
*   **Row-Level Security (RLS):** In Supabase, you use RLS to ensure that each instance only receives settings belonging to the `auth.uid()` of the logged-in user. This allows a shared settings table to securely serve millions of users [Source](https://rxdb.info/replication-supabase.html).

#### B. Sync and Concurrency Control
*   **Sequence/Version Tracking:** Every setting change should have a version ID or high-resolution timestamp. Instances use these to ensure they aren't overwriting newer data with a stale local cache (Eventual Consistency) [Source](https://medium.com/@jusuftopic/offline-first-architecture-designing-for-reality-not-just-the-cloud-e5fd18e50a79).
*   **Soft Deletes:** Do not use `DELETE` statements. Instead, use a `deleted: boolean` flag. This allows offline instances to "see" that a setting was removed during their absence and update their local store accordingly [Source](https://rxdb.info/replication-supabase.html).
*   **Instance Heartbeats:** Use Supabase `Presence` to detect active instances. If Instance A changes a setting, it can trigger a "Silent Push" or Broadcast message to Instance B, prompting it to re-sync immediately rather than waiting for its next poll [Source](https://supabase.com/docs/guides/realtime/getting_started).

---

## 📄 Draft Documentation

---

# PRD: Local Application Proxy & Cloud-Synced Settings Management

**Document Version:** 0.1 (Draft)
**Author:** [PM Name]
**Date:** [Current Date]
**Status:** Draft
**Stakeholders:** Product, Engineering (Python Backend, React Frontend, Desktop App Team), DevOps

---

## 1. Overview

### 1.1 Purpose
This PRD defines the requirements for two interconnected capabilities that represent the final milestone before system launch:

1. **Residential Proxy Feature** — Enabling the local desktop application to function as a proxy server, allowing the Python backend to route requests through users' machines (with their consent).
2. **Cloud-Synced Settings Management** — A comprehensive Supabase-backed system for managing all local application settings, instances, and configurations with offline-first bidirectional cloud sync and an intuitive user dashboard.

### 1.2 Problem Statement
Currently, the platform lacks the ability to leverage users' residential IP addresses as proxy endpoints — a capability that would significantly enhance the system's value. Additionally, local application settings are not centrally managed or synchronized, meaning users cannot seamlessly move between machines or recover settings if a device is lost. There is no mechanism for supporting multiple application instances per user, and no cloud-based source of truth for application state.

### 1.3 Goals
| # | Goal | Success Metric |
|---|------|----------------|
| G1 | Users can opt-in to share their machine as a residential proxy | ≥ 80% of users remain opted-in (default: enabled) |
| G2 | Python backend can successfully route requests through opted-in user proxies | Proxy connection success rate ≥ 95% |
| G3 | React frontend can validate a user's proxy is functioning | Validation check completes in < 5 seconds |
| G4 | All settings are stored in Supabase and synced with local app | Settings sync latency < 3 seconds when online |
| G5 | Users can run multiple app instances, each independently managed | Each instance has a unique identity and independent settings |
| G6 | Offline-first: app works without internet, syncs when reconnected | Zero data loss during offline periods |
| G7 | Intuitive settings dashboard with push/pull cloud sync controls | User can manage all settings from a single screen |

### 1.4 Out of Scope
- Proxy load balancing / routing intelligence across multiple users (backend orchestration layer)
- Billing or usage metering for proxy bandwidth
- Mobile application support (desktop only for this release)
- Third-party proxy provider integrations

---

## 2. User Personas

| Persona | Description | Needs |
|---------|-------------|-------|
| **End User (Proxy Contributor)** | A user who has installed the local desktop application and has opted to share their connection as a proxy | Simple on/off toggle, visibility into proxy status, confidence that their system isn't being misused |
| **End User (Multi-Instance)** | A power user running the application on multiple machines (e.g., home desktop, work laptop) | Seamless settings sync across instances, ability to identify and manage each instance |
| **Python Backend Developer** | Internal developer integrating proxy routing into backend services | Clear API/SDK for discovering available proxies and routing requests through them |
| **React Frontend Developer** | Internal developer building the proxy validation and settings UI | API endpoints for proxy health checks, settings CRUD, and sync status |

---

## 3. Feature Requirements

### 3.1 Residential Proxy Capability

#### 3.1.1 Local Proxy Server
| ID | Requirement | Priority |
|----|-------------|----------|
| PRX-001 | The local application SHALL start an HTTP/SOCKS5 proxy server on the user's machine when proxy sharing is enabled | P0 |
| PRX-002 | The proxy server SHALL listen on a configurable local port (default: auto-assigned) | P1 |
| PRX-003 | The proxy server SHALL establish a secure tunnel (WebSocket or SSH) back to the platform's relay/control server, making the user's IP available as an exit node | P0 |
| PRX-004 | The proxy server SHALL support both HTTP and SOCKS5 protocols | P0 |
| PRX-005 | The proxy server SHALL enforce bandwidth and connection limits configurable via settings | P1 |
| PRX-006 | The local application SHALL register the proxy's availability (IP, port, protocol, status) with the cloud database upon startup and upon any status change | P0 |

#### 3.1.2 Proxy Settings & Permissions
| ID | Requirement | Priority |
|----|-------------|----------|
| PRX-010 | The proxy sharing option SHALL appear in the application Settings panel | P0 |
| PRX-011 | The proxy sharing setting SHALL default to `true` (enabled) on fresh installations | P0 |
| PRX-012 | If the operating system requires firewall or network permissions (e.g., Windows Firewall, macOS network access), the application SHALL detect this and prompt the user with clear instructions or auto-request permission | P0 |
| PRX-013 | The application SHALL display the current proxy status (Active / Inactive / Error) in the settings panel and system tray | P0 |
| PRX-014 | The user SHALL be able to disable proxy sharing at any time; disabling SHALL immediately tear down the proxy server and notify the backend | P0 |

#### 3.1.3 Python Backend Proxy Consumption
| ID | Requirement | Priority |
|----|-------------|----------|
| PRX-020 | The system SHALL provide a Python SDK/module that allows the backend to query available user proxies from Supabase | P0 |
| PRX-021 | The Python SDK SHALL support routing HTTP requests through a selected user proxy (via the relay tunnel) | P0 |
| PRX-022 | The SDK SHALL include a health-check function that verifies a specific proxy is reachable and returning the expected residential IP | P0 |
| PRX-023 | The SDK SHALL handle proxy failover — if a selected proxy is unavailable, it retries with the next available proxy | P1 |
| PRX-024 | A developer guide SHALL be created documenting: SDK installation, configuration, proxy selection, request routing, error handling, and example code | P0 |

#### 3.1.4 React Frontend Proxy Validation
| ID | Requirement | Priority |
|----|-------------|----------|
| PRX-030 | The React frontend SHALL include a "Test Proxy" button/page accessible to the user | P0 |
| PRX-031 | The validation test SHALL verify: (a) proxy server is running locally, (b) tunnel to relay server is established, (c) an external IP check confirms the residential IP | P0 |
| PRX-032 | Test results SHALL be displayed with clear pass/fail indicators for each check | P0 |
| PRX-033 | If validation fails, the UI SHALL display contextual troubleshooting guidance (see §3.1.5) | P0 |
| PRX-034 | A developer guide SHALL be created for the React team documenting: API endpoints to call, expected responses, how to render results, and how to trigger re-tests | P0 |

#### 3.1.5 Troubleshooting & User Support
| ID | Requirement | Priority |
|----|-------------|----------|
| PRX-040 | The application SHALL include a "Proxy Diagnostics" panel accessible from Settings | P0 |
| PRX-041 | The diagnostics panel SHALL display: current proxy settings, port in use, tunnel status, last successful connection time, firewall status (if detectable), and recent error logs | P0 |
| PRX-042 | The user SHALL be able to view their full proxy settings from a browser-accessible URL (e.g., `localhost:<port>/status`) served by the local proxy, providing a web-based diagnostic page | P1 |
| PRX-043 | The diagnostics panel SHALL include a "Push Settings Update" capability — allowing the user to modify settings from the browser-based diagnostic page and have them sync to the local app and cloud | P1 |
| PRX-044 | Troubleshooting guidance SHALL cover: firewall blocking, port conflicts, VPN interference, antivirus interference, ISP restrictions, and network configuration issues | P0 |
| PRX-045 | The local application SHALL expose a REST API on localhost for the browser-based troubleshooting page to query and push settings | P1 |

---

### 3.2 Cloud-Synced Settings Management

#### 3.2.1 Supabase Database Schema

The following tables SHALL be created to manage application instances, settings, and sync state:

**Table: `app_instances`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Unique instance identifier |
| `user_id` | UUID (FK → auth.users) | Owner of this instance |
| `instance_name` | TEXT | User-friendly name (e.g., "Home Desktop", "Work Laptop") |
| `machine_hostname` | TEXT | OS-reported hostname |
| `machine_os` | TEXT | Operating system (e.g., "Windows 11", "macOS 14.2") |
| `machine_os_version` | TEXT | Detailed OS version string |
| `machine_arch` | TEXT | CPU architecture (e.g., "x64", "arm64") |
| `machine_cpu` | TEXT | CPU model string |
| `machine_ram_gb` | NUMERIC | Total RAM in GB |
| `machine_mac_address` | TEXT | Primary MAC address (for identification) |
| `machine_unique_id` | TEXT | Machine-specific fingerprint (composite hardware ID) |
| `app_version` | TEXT | Installed application version |
| `last_seen_at` | TIMESTAMPTZ | Last heartbeat / sync timestamp |
| `last_ip_address` | INET | Last known public IP |
| `is_online` | BOOLEAN | Whether instance is currently connected |
| `created_at` | TIMESTAMPTZ | Instance registration date |
| `updated_at` | TIMESTAMPTZ | Last modification date |

**Table: `app_settings`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Setting record ID |
| `instance_id` | UUID (FK → app_instances) | Which instance this setting belongs to |
| `user_id` | UUID (FK → auth.users) | Owner (denormalized for RLS) |
| `setting_key` | TEXT | Setting identifier (e.g., `proxy.enabled`, `ui.theme`) |
| `setting_value` | JSONB | Setting value (supports any data type) |
| `setting_category` | TEXT | Grouping category (e.g., "proxy", "ui", "network", "general") |
| `is_global` | BOOLEAN | If true, applies to all instances for this user |
| `version` | INTEGER | Incrementing version number for conflict resolution |
| `updated_at` | TIMESTAMPTZ | Last modification timestamp (used for LWW conflict resolution) |
| `synced_at` | TIMESTAMPTZ | Last successful cloud sync timestamp |
| `created_at` | TIMESTAMPTZ | Record creation date |

**Table: `app_proxy_status`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Record ID |
| `instance_id` | UUID (FK → app_instances) | Which instance this proxy belongs to |
| `user_id` | UUID (FK → auth.users) | Owner |
| `proxy_enabled` | BOOLEAN | Whether proxy sharing is active |
| `proxy_protocol` | TEXT | "HTTP", "SOCKS5", or "BOTH" |
| `proxy_port` | INTEGER | Port the proxy is listening on |
| `tunnel_status` | TEXT | "connected", "disconnected", "error" |
| `public_ip` | INET | User's current residential IP |
| `last_health_check` | TIMESTAMPTZ | Last successful health check |
| `health_check_result` | JSONB | Detailed health check results |
| `error_log` | JSONB | Recent errors (last 50) |
| `bandwidth_used_mb` | NUMERIC | Bandwidth consumed this session |
| `uptime_seconds` | INTEGER | Current session uptime |
| `updated_at` | TIMESTAMPTZ | Last update |
| `created_at` | TIMESTAMPTZ | Record creation |

**Table: `app_sync_log`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Log entry ID |
| `instance_id` | UUID (FK → app_instances) | Source instance |
| `user_id` | UUID (FK → auth.users) | Owner |
| `sync_direction` | TEXT | "push" (local → cloud) or "pull" (cloud → local) |
| `sync_status` | TEXT | "success", "partial", "failed" |
| `settings_synced` | INTEGER | Number of settings synced |
| `conflicts_detected` | INTEGER | Number of conflicts found |
| `conflicts_resolved` | JSONB | Details of conflict resolution |
| `error_details` | JSONB | Error information if failed |
| `started_at` | TIMESTAMPTZ | Sync start time |
| `completed_at` | TIMESTAMPTZ | Sync completion time |

**Table: `app_user_preferences`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Record ID |
| `user_id` | UUID (FK → auth.users) | Owner |
| `preference_key` | TEXT | Preference identifier (e.g., `theme`, `language`, `notifications`) |
| `preference_value` | JSONB | Preference value |
| `is_per_instance` | BOOLEAN | If true, overridable per instance; if false, global only |
| `updated_at` | TIMESTAMPTZ | Last modification |
| `created_at` | TIMESTAMPTZ | Record creation |

> **Note:** `app_settings` stores per-instance technical settings (proxy config, network, etc.) while `app_user_preferences` stores user-level preferences (theme, language, etc.) that typically apply globally but can be overridden per instance.

#### 3.2.2 Multi-Instance Support
| ID | Requirement | Priority |
|----|-------------|----------|
| SET-001 | Each installation of the local app SHALL generate a unique `instance_id` (UUID) on first launch and persist it locally | P0 |
| SET-002 | On first launch, the app SHALL collect system identifying information (hostname, OS, architecture, CPU, RAM, MAC address) and register the instance in `app_instances` | P0 |
| SET-003 | Users SHALL be able to name their instances (e.g., "Home Desktop") from the dashboard | P1 |
| SET-004 | The dashboard SHALL display all registered instances for the user with their online/offline status | P0 |
| SET-005 | Users SHALL be able to deregister/remove instances from the dashboard | P1 |

#### 3.2.3 Settings Storage & Sync
| ID | Requirement | Priority |
|----|-------------|----------|
| SET-010 | ALL application settings SHALL be stored both locally (SQLite or equivalent) and in the Supabase cloud database | P0 |
| SET-011 | The local database SHALL be the primary source of truth for the running application (offline-first pattern) | P0 |
| SET-012 | On application startup, the system SHALL attempt a sync with the cloud | P0 |
| SET-013 | On any setting change (local or cloud), the system SHALL attempt a sync | P0 |
| SET-014 | If no internet connection is available, the application SHALL continue to function normally using local settings | P0 |
| SET-015 | When connectivity is restored, the system SHALL automatically detect and begin syncing | P0 |
| SET-016 | Conflict resolution SHALL use "Last Write Wins" (LWW) based on `updated_at` timestamps, with the more recent change taking precedence | P0 |
| SET-017 | The sync log SHALL record all sync operations, including conflicts detected and how they were resolved | P1 |
| SET-018 | Settings SHALL support both instance-specific and global (all-instances) scopes | P0 |
| SET-019 | The system SHALL use Supabase Realtime (Postgres Changes) to push setting changes to other connected instances in real-time | P1 |

#### 3.2.4 Settings Categories
The following settings SHALL be stored and managed:

| Category | Example Settings |
|----------|-----------------|
| **Proxy** | `proxy.enabled`, `proxy.port`, `proxy.protocol`, `proxy.bandwidth_limit`, `proxy.auto_start` |
| **UI / Theme** | `ui.theme` (light/dark/system), `ui.language`, `ui.sidebar_collapsed`, `ui.font_size`, `ui.compact_mode` |
| **Network** | `network.auto_connect`, `network.relay_server_url`, `network.timeout_ms`, `network.retry_attempts` |
| **Notifications** | `notifications.enabled`, `notifications.sync_alerts`, `notifications.proxy_alerts`, `notifications.sound` |
| **General** | `general.startup_with_os`, `general.minimize_to_tray`, `general.auto_update`, `general.telemetry_opt_in` |
| **Sync** | `sync.auto_sync`, `sync.sync_interval_seconds`, `sync.wifi_only` |

#### 3.2.5 Settings Dashboard
| ID | Requirement | Priority |
|----|-------------|----------|
| DASH-001 | The local application SHALL include a full-featured Settings Dashboard | P0 |
| DASH-002 | The dashboard SHALL display ALL settings organized by category with clear section headers | P0 |
| DASH-003 | The dashboard SHALL include a prominent **"Save to Cloud" (↑)** button that pushes current local settings to Supabase | P0 |
| DASH-004 | The dashboard SHALL include a prominent **"Pull from Cloud" (↓)** button that overwrites local settings with the cloud version | P0 |
| DASH-005 | Before overwriting (in either direction), the system SHALL show a confirmation dialog with a diff/summary of what will change | P0 |
| DASH-006 | The dashboard SHALL display sync status: last sync time, sync health indicator (green/yellow/red), and pending changes count | P0 |
| DASH-007 | The dashboard SHALL show a "Connected Instances" panel listing all user instances with real-time online/offline indicators | P1 |
| DASH-008 | The dashboard SHALL support light/dark mode that respects the user's `ui.theme` setting | P0 |
| DASH-009 | Each setting SHALL have an inline description/tooltip explaining its purpose | P1 |
| DASH-010 | The dashboard SHALL include a search/filter capability for quickly finding settings | P2 |
| DASH-011 | The dashboard SHALL include a "Reset to Defaults" option per category and globally | P1 |

---

## 4. Technical Architecture

### 4.1 System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     USER'S MACHINE                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              LOCAL DESKTOP APPLICATION                    │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐   │   │
│  │  │  Settings    │  │  Proxy       │  │  Sync Engine  │   │   │
│  │  │  Dashboard   │  │  Server      │  │  (Offline-    │   │   │
│  │  │  (UI)        │  │  (HTTP/      │  │   First)      │   │   │
│  │  │              │  │   SOCKS5)    │  │               │   │   │
│  │  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘   │   │
│  │         │                 │                   │           │   │
│  │  ┌──────▼─────────────────▼───────────────────▼───────┐   │   │
│  │  │              LOCAL SQLite DATABASE                  │   │   │
│  │  │    (Settings, Proxy State, Sync Queue)             │   │   │
│  │  └────────────────────────┬───────────────────────────┘   │   │
│  └───────────────────────────┼───────────────────────────────┘   │
│                              │                                   │
│  ┌───────────────────────────▼───────────────────────────────┐   │
│  │  Local REST API (localhost:<port>)                         │   │
│  │  → Browser-based diagnostics page                         │   │
│  │  → Settings view & push from browser                      │   │
│  └───────────────────────────┬───────────────────────────────┘   │
└──────────────────────────────┼───────────────────────────────────┘
                               │ (Internet)
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                        CLOUD LAYER                               │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────────┐   │
│  │   Supabase     │  │   Supabase     │  │  Relay / Control  │   │
│  │   Database     │  │   Realtime     │  │  Server           │   │
│  │   (Postgres)   │  │   (WebSocket)  │  │  (Proxy Tunnel)   │   │
│  └────────┬───────┘  └────────┬───────┘  └─────────┬─────────┘   │
│           │                   │                     │             │
│  ┌────────▼───────────────────▼─────────────────────▼─────────┐   │
│  │                  Python Backend                             │   │
│  │  → Queries available proxies from Supabase                 │   │
│  │  → Routes requests through relay → user tunnel             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                  React Frontend                             │   │
│  │  → Proxy validation UI                                     │   │
│  │  → Settings management (web companion)                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
```

### 4.2 Sync Engine Flow

```
APP STARTUP
    │
    ├─→ Load settings from local SQLite
    ├─→ Render UI immediately (offline-first)
    ├─→ Check internet connectivity
    │       │
    │       ├─ ONLINE ──→ Fetch cloud settings (Supabase)
    │       │               │
    │       │               ├─→ Compare `updated_at` timestamps
    │       │               ├─→ For each setting:
    │       │               │     Cloud newer? → Update local
    │       │               │     Local newer? → Push to cloud
    │       │               │     Same? → Skip
    │       │               ├─→ Log sync result to `app_sync_log`
    │       │               └─→ Subscribe to Supabase Realtime
    │       │
    │       └─ OFFLINE ──→ Queue changes locally
    │                       └─→ Monitor connectivity
    │                           └─→ On reconnect → Trigger sync
    │
SETTING CHANGE (User or System)
    │
    ├─→ Update local SQLite immediately
    ├─→ Increment `version`, set `updated_at`
    ├─→ Mark `synced_at = null` (pending)
    └─→ Attempt cloud push
            │
            ├─ SUCCESS → Update `synced_at`
            └─ FAILURE → Retry with exponential backoff
```

### 4.3 Proxy Architecture Flow

```
1. User enables proxy → local app starts HTTP/SOCKS5 server
2. Local app opens secure WebSocket tunnel to Relay Server
3. Local app registers proxy in `app_proxy_status` (Supabase)
4. Python backend queries `app_proxy_status` for available proxies
5. Backend sends request → Relay Server → WebSocket tunnel → User's machine → Internet
6. Response travels back: Internet → User's machine → Tunnel → Relay → Backend
```

---

## 5. Developer Guides (Requirements)

### 5.1 Python Backend Proxy Integration Guide
The following guide documentation SHALL be delivered:

1. **Installation** — How to install and configure the proxy SDK/module
2. **Proxy Discovery** — Code examples for querying available proxies from Supabase (filtered by status, geography, uptime)
3. **Request Routing** — Code examples using `requests` or `httpx` with proxy configuration pointing to the relay server
4. **Health Checks** — How to programmatically verify a proxy before using it
5. **Error Handling** — Handling timeouts, proxy disconnections, failover to alternate proxies
6. **Example: Full Workflow** — End-to-end code sample

### 5.2 React Frontend Proxy Validation Guide
The following guide documentation SHALL be delivered:

1. **API Endpoints** — REST endpoints the frontend calls to test proxy status
2. **Validation Flow** — Step-by-step: (a) Check local proxy server, (b) Check tunnel, (c) External IP verification
3. **UI Components** — Component specifications for the test results display
4. **Troubleshooting Tree** — Decision tree for when validation fails:
   - **Proxy server not running?** → Check if proxy is enabled in settings; restart app
   - **Firewall blocking?** → Guide user to OS firewall settings with screenshots
   - **Port conflict?** → Auto-detect and suggest alternate port
   - **VPN interfering?** → Detect active VPN and warn user
   - **Tunnel not connecting?** → Check internet connectivity; check relay server status
5. **Browser-Based Diagnostics** — How users can navigate to `localhost:<port>/status` to see full settings and proxy state from their browser
6. **Push Updates from Browser** — How settings can be modified from the browser diagnostic page and synced

---

## 6. Security Considerations

| Concern | Mitigation |
|---------|------------|
| User proxy misuse (illegal traffic routed through user) | Rate limiting, content filtering at relay, audit logging, clear ToS |
| Settings data in transit | All Supabase connections over TLS; local REST API on localhost only |
| Unauthorized proxy access | Proxy tunnel requires authenticated WebSocket; no open ports exposed to internet |
| Local REST API abuse | Bind to `127.0.0.1` only; optional API key for browser access |
| Row-Level Security | All Supabase tables SHALL use RLS policies ensuring users can only access their own data |
| MAC address / hardware ID storage | Clearly disclosed in privacy policy; used only for instance identification |

---

## 7. Success Criteria & Launch Readiness

| Criteria | Requirement |
|----------|-------------|
| Proxy server starts and accepts connections | Verified on Windows, macOS, Linux |
| Proxy tunnel establishes to relay server | < 2 second connection time |
| Python backend successfully routes through user proxy | End-to-end test passes |
| React validation test completes | All 3 checks pass/fail correctly |
| Settings sync works online | Changes propagate in < 3 seconds |
| Settings persist offline | App functions fully with no connection |
| Settings sync on reconnect | All pending changes sync within 10 seconds of reconnect |
| Multi-instance support | 2+ instances for same user sync independently |
| Dashboard renders all settings | All categories visible and editable |
| Cloud push/pull works | Manual sync in both directions with confirmation |

---

## 8. Rollout Plan

| Phase | Scope | Duration |
|-------|-------|----------|
| Phase 1 | Database schema creation, RLS policies, Supabase Realtime setup | Week 1 |
| Phase 2 | Local app: SQLite schema, sync engine, settings dashboard | Week 1–2 |
| Phase 3 | Local app: proxy server implementation, tunnel to relay | Week 2–3 |
| Phase 4 | Python SDK: proxy discovery & routing module + guide | Week 3 |
| Phase 5 | React: proxy validation UI + troubleshooting flow + guide | Week 3–4 |
| Phase 6 | Integration testing, multi-instance testing, offline testing | Week 4 |
| Phase 7 | Launch | Week 5 |

---

## 📄 Assumptions

1. **The local application is an Electron-based desktop app** (or similar framework like Tauri). This assumption drives the proxy server implementation approach (Node.js-based HTTP/SOCKS5 server) and local SQLite storage. If it's a different framework, the approach will change.

2. **A relay/control server exists or will be built** to broker proxy connections between the Python backend and user machines. Users' proxies are not directly exposed to the internet — traffic flows through a central relay via authenticated tunnels.

3. **Users are authenticated** via Supabase Auth (or a compatible auth system), providing a `user_id` for RLS and data ownership.

4. **The Supabase project is already set up** with auth enabled, and the team has access to create tables, set up RLS policies, and enable Realtime.

5. **"Last Write Wins" (LWW) conflict resolution** is acceptable for settings sync. This is the simplest approach and works well for settings data where concurrent edits to the same key are rare.

6. **The local application does not currently have a local database** — this will need to be added as part of this work.

7. **The proxy feature operates as a "back-connect" residential proxy** — meaning the user's machine tunnels outbound to a relay server, rather than opening inbound ports (which would require complex NAT/firewall configuration).

---

## ❓ Questions for Refinement

1. **What is the local application built with?** Is it Electron, Tauri, a native app (C#/.NET, Swift, etc.), or something else? This significantly impacts the proxy server implementation, local storage approach, and the settings dashboard UI framework.

2. **Does a relay/control server already exist, or does it need to be built?** The proxy architecture requires an intermediary server that the Python backend sends requests to and that tunnels them to user machines. Is this infrastructure already in place, or is it part of this scope?

3. **What specific data should the Python backend route through user proxies?** Understanding the use case (web scraping, geo-testing, API requests, etc.) will help define proxy protocol requirements, bandwidth expectations, and the content filtering/security policies we need.

4. **Are there any existing Supabase tables or schemas we should integrate with?** You mentioned I have access to your Supabase MCP tools — should I inspect the current database schema to ensure the new tables align with existing naming conventions, relationships, and R