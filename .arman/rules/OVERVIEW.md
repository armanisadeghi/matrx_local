# Matrx Local — Stable Architecture Invariants

This document extracts the parts of the codebase that are architectural invariants or long-lived design decisions rather than implementation details that are likely to change as the system grows. It is intentionally written as a durable reference: a concise statement of what the system fundamentally **is**, how its major layers relate to each other, and which patterns appear to be core to the product’s design.

---

## 1. System Identity

Matrx Local is a **desktop-first local companion runtime** for the broader AI Matrx ecosystem.

At a durable architectural level, the system is defined by these core realities:

* It is a **hybrid desktop application** composed of three major layers:

  * a **Python backend engine** for local services, AI orchestration, tool execution, scraping, sync, and device/system access
  * a **React/TypeScript frontend** for the user interface and application workflow
  * a **Rust/Tauri desktop shell** that manages native process lifecycle, OS integration, sidecars, permissions, and desktop-specific capabilities
* The backend is primarily a **localhost service** rather than a traditional remote server.
* The desktop app is designed to bridge **web-style UI** with **native/local capabilities** that a browser alone cannot reliably provide.
* The product assumes that important work should continue locally even when the user navigates between screens, which is reflected in its persistence, process, and page-lifecycle design.

These characteristics are not incidental implementation choices; they define the product category and are likely to remain stable.

---

## 2. Core Architectural Shape

The most stable system-level shape is:

```text
Tauri/Rust shell
  -> owns native desktop lifecycle, sidecars, permissions, deep links, tray, updates

React/TypeScript frontend
  -> owns UI state, navigation, startup gating, user interaction, engine orchestration

Python FastAPI engine
  -> owns local APIs, tool execution, local persistence, sync, scraper runtime, proxy/tunnel, AI integration
```

A more durable way to describe the platform is:

* **Rust/Tauri is the host**
* **React is the experience layer**
* **Python is the local service plane**

That division of responsibility is one of the clearest long-term invariants in the codebase.

---

## 3. Local-First Execution Model

A major invariant is that the system is built around a **local-first execution model**.

That means:

* The Python engine runs on the user’s machine.
* The frontend talks to the engine over **localhost HTTP/WebSocket**.
* Local persistence exists even when cloud services are involved.
* Native features are surfaced through Tauri commands rather than assumed browser APIs.
* The system is designed so the app remains useful even if some non-critical cloud enrichment fails.

This local-first model appears in several recurring ways:

* local SQLite storage
* local JSON settings/configuration
* local tool execution
* local sidecar process management
* local model/runtime support
* local device and hardware probing
* local transcription / wake word / LLM support

Cloud capabilities exist, but they are layered on top of a local core rather than replacing it.

---

## 4. Separation of Concerns by Runtime

## 4.1 Rust/Tauri Responsibilities

The Rust layer is the **native runtime authority**. Its stable responsibilities are:

* starting and stopping native sidecars
* managing desktop lifecycle and graceful shutdown
* handling OS-specific integration points such as:

  * tray behavior
  * deep links
  * updater/restart flows
  * autostart
  * permissions
  * floating utility windows / overlays
* hosting local inference- or media-related native processes where appropriate
* acting as the secure bridge between the frontend and native capabilities

This suggests a durable rule:

> If something is fundamentally about desktop process control, OS integration, privileged local access, or bundled binaries, Rust/Tauri owns it.

## 4.2 React/TypeScript Responsibilities

The frontend is the **experience orchestration layer**. Its stable responsibilities are:

* deciding what the user should see at each stage of startup
* coordinating auth state with engine state
* driving discovery and connection to the local engine
* presenting tools, pages, settings, and workflows
* preserving in-progress work across navigation
* synchronizing user actions to both the engine and native layer

This suggests the durable rule:

> React owns user flow and interaction orchestration, not native process control and not backend service logic.

## 4.3 Python Backend Responsibilities

The Python engine is the **local services and orchestration backend**. Its stable responsibilities are:

* exposing the local HTTP and WebSocket API surface
* managing local persistence and cached state
* hosting tool invocation and execution logic
* initializing and integrating the AI/tool system
* syncing with remote/cloud sources
* running scraper, proxy, tunnel, and scheduler-like services
* exposing system/device/platform capabilities to the frontend

This suggests the durable rule:

> Python owns local application services and orchestration, especially where the problem is best solved as a service runtime rather than a UI concern or a native shell concern.

---

## 5. Startup Philosophy

The exact startup phases may evolve, but the **startup philosophy** appears stable.

### 5.1 Ordered, Dependency-Aware Boot

Startup is not arbitrary. It follows a dependency chain where foundational services come first and higher-level systems build on them.

The invariant is:

* persistence and configuration must be available first
* auth/token context must be available before cloud- or AI-dependent systems initialize
* registries and integrations come after their foundational runtime is ready
* optional/non-critical enrichments should not block the app from becoming usable

### 5.2 Gated User Experience

The frontend does not simply render and hope everything is ready. It explicitly gates the user through startup states such as:

* auth recovery / OAuth completion
* engine discovery and startup
* first-run setup
* compact-mode branching

The stable pattern is:

> The app treats startup as an explicit workflow, not a hidden implementation detail.

### 5.3 Graceful Degradation

Non-critical enrichments are treated as best-effort. Tool lists, browser status, system info, cloud sync, and similar data may fail without collapsing the entire app.

That indicates a durable product assumption:

> A minimal functional local app is more important than a perfectly enriched startup.

---

## 6. Persistent Local State Is Foundational

A strong invariant is that the system depends on **durable local state**.

This includes:

* a local SQLite database for structured application data and cached synced data
* local JSON settings/config files for app and subsystem behavior
* local discovery/state files to help frontend/native components find the engine and its status
* local model/config metadata for transcription and LLM subsystems

The exact schema will change. The invariant will not:

> Matrx Local persists critical operational state locally and treats local persistence as a first-class part of the architecture.

This is important because it influences boot order, offline tolerance, auth continuity, and cross-restart recovery.

---

## 7. The Engine Is a Service Hub, Not Just an API Server

The Python backend is not merely a set of route handlers. Architecturally, it behaves as a **service hub**.

That means it centralizes:

* tool execution
* cloud synchronization
* scraper lifecycle
* settings-dependent background services
* scheduling/retry/heartbeat behavior
* AI tool registration and sub-app composition
* local capability and hardware discovery

This is a durable characteristic of the backend: it is a **runtime host** with multiple cooperating subsystems, not a thin CRUD API.

---

## 8. Tooling Is a First-Class Primitive

One of the clearest long-term invariants is that **tools are a first-class system primitive**.

This shows up in several stable ways:

* there is a dedicated tool invocation pathway
* there is explicit schema/manifest metadata for tools
* tools are exposed both to local dispatch and to AI-facing registries
* tool invocation is available over both REST and WebSocket paths
* tool definitions include structured validation and machine-readable schema

Even if naming, counts, or specific handlers change, the stable architecture is:

> The product is built around a structured tool ecosystem, not ad hoc command execution.

### 8.1 Dual Tool Representation

The two-registry pattern points to a durable architectural distinction:

* one representation exists for **runtime dispatch/execution**
* another exists for **AI/discovery/registration/metadata**

That separation is likely to remain because execution and metadata/discovery solve different problems.

### 8.2 Schema-Driven Contracts

Both handler signatures and Pydantic models are used to generate schemas and validate arguments.

That reflects a long-lived design choice:

> Tool interfaces should be machine-readable, validated, and portable across local execution and AI integration contexts.

---

## 9. Auth Is Federated Through Supabase but Consumed Locally

The exact auth flow may change, but the stable pattern is already clear:

* user identity and session authority come from Supabase auth
* the frontend is responsible for acquiring/restoring the session
* the Python engine consumes the JWT so it can operate on behalf of the user
* token state is synchronized across restarts and refreshes

This means the enduring architectural truth is:

> Authentication originates in the frontend/cloud auth layer but is propagated into local services so the local engine can act as an authenticated participant in the larger AI Matrx system.

This is more than a login detail. It is how local and cloud trust are joined together.

---

## 10. Cloud Sync Is an Extension of Local State, Not a Replacement

Another stable design principle is that cloud sync appears to be **bidirectional and state-aware**, not a naive overwrite model.

The durable pattern is:

* local settings and cached data exist independently
* cloud state can enrich or reconcile with local state
* timestamps and merge logic determine which side wins
* heartbeat and instance registration keep the local runtime visible to the cloud system

This indicates a long-term product assumption:

> The local app is a peer in a distributed system, not just a dumb client of the cloud.

---

## 11. WebSocket and Streaming Are Core, Not Peripheral

The system does not rely solely on request/response APIs. Real-time channels are a structural part of the design.

Stable examples include:

* backend WebSocket support for persistent tool sessions
* frontend persistent WS connection to the engine
* server-sent events for logs and streaming workflows
* Rust event emission for native-side progress and device/runtime events

This shows a durable invariant:

> The platform assumes long-lived, stateful, streaming interactions are normal.

That matters because it affects how features should be designed going forward: background work, progress reporting, logs, and tool execution are expected to surface incrementally rather than only through final responses.

---

## 12. Session Continuity and In-Progress Work Preservation

A particularly durable frontend design choice is that pages remain mounted and are shown/hidden rather than unmounted during navigation.

Whether the exact implementation stays the same or not, the underlying invariant is strong:

> The application prioritizes continuity of in-progress work over route purity.

That principle aligns with the overall product behavior:

* downloads should continue
* streams should continue
* tools should continue
* background work should survive tab/page switches
* UI navigation should not implicitly reset local workflows

This is likely to remain a core UX expectation even if implementation details evolve.

---

## 13. Native Process Orchestration Is Central to the Desktop App

The Rust layer’s consistent role in starting, stopping, monitoring, and cleaning up sidecars points to another stable invariant:

> The desktop product is fundamentally a multi-process application.

Those processes may change over time, but the architectural reality likely will not. The app already assumes:

* a Python engine sidecar
* additional native/bundled processes for specialized capabilities
* lifecycle coordination across shutdown, restart, update, and crash scenarios
* cleanup of orphans and defensive shutdown sequencing

This is a core desktop architectural characteristic, not a temporary implementation quirk.

---

## 14. Shutdown Safety Is a First-Class Concern

The system places unusual emphasis on controlled shutdown, watchdogs, idempotent cleanup, timeout escalation, and forced termination if needed.

That indicates a durable invariant:

> Reliable teardown is considered part of correctness.

This matters because the system owns:

* child processes
* file/state persistence
* audio and microphone resources
* browser/scraper sessions
* native model runtimes
* network services

In such a system, shutdown is not an afterthought. It is part of the architecture.

---

## 15. Capability Detection and Adaptive Behavior Are Built In

Across Python and Rust subsystems, the app probes and adapts to the environment:

* platform capabilities
* hardware profile
* browser/Playwright availability
* microphone / audio devices
* GPU / local inference suitability
* free ports and process availability

This suggests a stable product principle:

> The application is designed to adapt itself to the user’s machine rather than assuming a uniform environment.

That is likely to remain true as the system grows, especially for local AI, media, scraping, and desktop integrations.

---

## 16. Settings Are Operational, Not Merely Cosmetic

The settings system does more than store UI preferences. It actively controls runtime behavior.

Stable categories of settings influence:

* startup/autostart behavior
* tray/window behavior
* proxy/tunnel enablement
* scraping behavior
* wake word / transcription behavior
* AI/chat defaults
* local model/runtime configuration

That yields a durable architectural statement:

> Settings are part of runtime orchestration and infrastructure control, not just presentation preferences.

Because of that, settings need continued treatment as typed, syncable, operational configuration.

---

## 17. AI Integration Is Embedded Into the Architecture

The AI layer is not bolted on as a separate feature. It is integrated into the startup sequence, tool registration model, local service design, and data synchronization model.

The enduring architectural truths are:

* AI capability depends on authenticated cloud and local context
* tools are registered in a way that supports model invocation
* the local runtime can act as an execution substrate for AI-driven actions
* the app is designed to combine cloud-managed AI entities with local execution capabilities

That implies a stable framing:

> Matrx Local is an AI-capable operating layer for the AI Matrx ecosystem, not just a desktop wrapper around a web UI.

---

## 18. Scraping, Proxying, and Remote Reachability Are Platform Capabilities

Even if their exact implementation changes, these capabilities appear conceptual rather than incidental:

* scraping/browser automation
* local proxying / fetch mediation
* optional remote reachability via tunnel

These features all point to a durable product role:

> The local engine serves as a network-capable bridge between cloud workflows, browser/runtime automation, and the user’s machine.

That bridge role is likely to remain important even as individual services are refactored.

---

## 19. Strong Boundary Between Critical Path and Best-Effort Features

A recurring architectural pattern is the distinction between:

* **critical path** systems that must initialize correctly for the app to function
* **best-effort** enrichments that improve capability but should not block usability

Examples of critical-path concerns include:

* auth/session recovery
* local engine discovery/startup
* local persistence availability
* core API communication

Examples of best-effort concerns include:

* extra system info
* tool list enrichment
* browser capability details
* some cloud sync behaviors

This distinction is important enough to treat as a design invariant:

> The platform should remain usable with degraded enrichment, as long as its local operational core is intact.

---

## 20. Long-Lived Architectural Invariants by Layer

## 20.1 Backend Invariants

The following backend truths are likely to remain stable:

* the backend is a local FastAPI service
* it uses a lifespan/startup orchestration model with ordered dependencies
* it maintains local persistent state
* it exposes both HTTP and WebSocket interfaces
* it acts as the hub for tools, sync, scheduling, and background services
* it integrates cloud-managed AI/tool metadata with local runtime capabilities

## 20.2 Frontend Invariants

The following frontend truths are likely to remain stable:

* the frontend owns startup gating and user-visible state transitions
* auth and engine readiness are separate but coordinated concerns
* the engine client is effectively centralized behind a singleton-style API layer
* the app prioritizes continuity of work across navigation
* the UI can function with partial enrichment failures

## 20.3 Rust/Tauri Invariants

The following Rust/Tauri truths are likely to remain stable:

* it is the native process and lifecycle authority
* it owns bundled sidecars and native integrations
* it bridges frontend intent into OS-level capabilities
* it is responsible for safe shutdown, restart, update, and cleanup
* it surfaces native event streams to the frontend

---

## 21. What Is Likely to Change vs. What Is Not

To keep this document durable, it helps to explicitly separate unstable details from stable patterns.

### Likely to change

* exact port numbers
* exact route lists and router counts
* exact tool counts and tool names
* exact startup phase numbering
* specific plugin lists
* exact file paths and filenames
* exact config field names
* exact commands and event channel names
* specific third-party libraries or wrappers

### Unlikely to change

* the three-layer split: Rust host, React UI, Python engine
* the local-first runtime model
* the existence of persistent local state
* the role of the backend as a local service hub
* the role of tools as a first-class abstraction
* the use of structured startup gating
* the use of real-time channels for ongoing work
* the need for native process orchestration
* the importance of safe shutdown and cleanup
* the blending of local runtime capabilities with authenticated cloud context

---

## 22. Recommended Canonical Summary

If the architecture needs to be described briefly but accurately, the most durable summary is:

> Matrx Local is a local-first desktop runtime composed of a Rust/Tauri native host, a React/TypeScript experience layer, and a Python FastAPI service engine. The Rust layer owns native lifecycle and OS integration, the React layer owns startup flow and user interaction, and the Python layer owns local services, tool execution, persistence, sync, and AI/runtime orchestration. The system is designed around persistent local state, structured tool contracts, real-time communication, graceful degradation, and safe multi-process lifecycle management, while integrating authenticated cloud context into a fundamentally local execution environment.

---

## 23. Final Architectural Thesis

The clearest cohesive interpretation of the codebase is this:

Matrx Local is not merely a desktop app, not merely a localhost API, and not merely a web UI in a native shell. It is a **local operating layer** for AI Matrx: a multi-runtime desktop platform that combines cloud identity, local persistence, tool execution, native process control, and real-time interaction into a single user-facing system.

That thesis is the part most likely to remain true even as the codebase changes substantially over time.
