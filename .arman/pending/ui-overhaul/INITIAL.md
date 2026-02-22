## 📄 Engineering Design Doc: Matrx Local UI Overhaul

---

### 1. Overview

| Field             | Value                                                                                |
| ----------------- | ------------------------------------------------------------------------------------ |
| **Document Type** | Engineering Design Document                                                          |
| **Project**       | Matrx Local — Full UI Overhaul                                                       |
| **Status**        | Draft v1                                                                             |
| **Author**        | [PM Name]                                                                            |
| **Tech Stack**    | React 19 · TypeScript 5.7 · Vite 6 · Tailwind CSS 3.4 · shadcn/ui (Radix) · Tauri v2 |
| **Target**        | Desktop application (macOS, Windows, Linux)                                          |

#### 1.1 Problem Statement

The current Matrx Local UI suffers from three critical issues:

1. **Visual inconsistency** — Each sidebar page (Dashboard, Tools, Scraping, Documents, Settings) has a different layout structure, varying widths, and no uniform content organization pattern.
2. **Tools page is developer-only** — The tools UI only supports raw JSON input/output. This renders 73 powerful tools inaccessible to non-technical users and tedious even for technical ones.
3. **Sub-par polish** — Light/dark modes are functional but lack the refinement, spacing consistency, and visual hierarchy expected of a professional desktop application.

#### 1.2 Goals

| #   | Goal                                       | Success Criteria                                                                                                                     |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| G1  | Consistent layout across all primary pages | Every sidebar page uses the same shell: fixed-width sidebar, uniform page header, standardized content area with horizontal sub-tabs |
| G2  | Purpose-built UI for every tool            | Each of the 73 tools has a dedicated form-based interface with typed inputs, validation, and formatted output                        |
| G3  | Modern, professional look & feel           | Passes visual review for spacing, typography, color usage, and interaction patterns in both light and dark modes                     |
| G4  | Improved usability                         | Non-technical users can discover and invoke any tool without writing JSON                                                            |

#### 1.3 Non-Goals

- Backend/engine API changes (the REST/WebSocket APIs remain unchanged)
- New tool development (this is UI-only; the 73 existing tools are the scope)
- Mobile/responsive design (this is a desktop-only Tauri app)
- Authentication flow redesign

---

### 2. Architecture Overview

#### 2.1 Layout System

All pages will share a **unified application shell**:

```
┌─────────────────────────────────────────────────────┐
│ AppShell                                            │
├──────────┬──────────────────────────────────────────┤
│          │  PageHeader (title, breadcrumb, actions) │
│          ├──────────────────────────────────────────┤
│ Sidebar  │  SubTabBar (horizontal tabs, when needed)│
│ (fixed)  ├──────────────────────────────────────────┤
│          │                                          │
│          │  ContentArea (scrollable)                │
│          │                                          │
│          │                                          │
├──────────┴──────────────────────────────────────────┤
│ StatusBar (engine status, connection indicator)      │
└─────────────────────────────────────────────────────┘
```

**Key constraints:**

- Sidebar width: fixed at `var(--sidebar-width)` (e.g., `16rem` expanded, `3rem` collapsed icon-only mode)
- Content area: fills remaining viewport width; internally scrollable, never causes full-page scroll
- Page header height: fixed at `3.5rem` (`h-14`)
- Sub-tab bar height: fixed at `2.5rem` (`h-10`) when present
- All pages render within `<SidebarInset>` from shadcn/ui's `SidebarProvider`

#### 2.2 Component Hierarchy

```
<SidebarProvider>
  <AppSidebar />                    // Primary navigation
  <SidebarInset>
    <PageHeader />                  // Consistent across all pages
    <SubTabBar tabs={[...]} />      // Optional; per-page config
    <ContentArea>
      {/* Page-specific content */}
    </ContentArea>
    <StatusBar />                   // Global engine/connection status
  </SidebarInset>
</SidebarProvider>
```

#### 2.3 New Shared Components

| Component     | Purpose                                             | Location                            |
| ------------- | --------------------------------------------------- | ----------------------------------- |
| `AppShell`    | Wraps entire app in `SidebarProvider` + layout grid | `components/layout/AppShell.tsx`    |
| `AppSidebar`  | Unified sidebar with grouped nav items, collapsible | `components/layout/AppSidebar.tsx`  |
| `PageHeader`  | Title, optional breadcrumb, optional action buttons | `components/layout/PageHeader.tsx`  |
| `SubTabBar`   | Horizontal tab strip for intra-page navigation      | `components/layout/SubTabBar.tsx`   |
| `ContentArea` | Scrollable container with consistent padding        | `components/layout/ContentArea.tsx` |
| `StatusBar`   | Engine status, WebSocket indicator, version         | `components/layout/StatusBar.tsx`   |
| `ToolForm`    | Dynamic form renderer for tool inputs               | `components/tools/ToolForm.tsx`     |
| `ToolOutput`  | Typed output renderer (table, text, tree, etc.)     | `components/tools/ToolOutput.tsx`   |
| `ToolCard`    | Tool listing card with icon, name, description      | `components/tools/ToolCard.tsx`     |

---

### 3. Design System Refinements

#### 3.1 Theme Tokens

Leverage CSS custom properties in `index.css` for both light and dark modes. All color usage must go through semantic tokens — never raw Tailwind palette colors.

```css
:root {
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 240 10% 3.9%;
  --primary: 240 5.9% 10%;
  --primary-foreground: 0 0% 98%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --accent: 240 4.8% 95.9%;
  --accent-foreground: 240 5.9% 10%;
  --border: 240 5.9% 90%;
  --ring: 240 5.9% 10%;
  /* ... additional tokens */
}

.dark {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  /* ... inverted tokens */
}
```

#### 3.2 Typography Scale

| Usage              | Class                                   | Size |
| ------------------ | --------------------------------------- | ---- |
| Page title         | `text-2xl font-semibold tracking-tight` | 24px |
| Section heading    | `text-lg font-medium`                   | 18px |
| Sub-tab label      | `text-sm font-medium`                   | 14px |
| Body text          | `text-sm`                               | 14px |
| Caption / helper   | `text-xs text-muted-foreground`         | 12px |
| Monospace (output) | `font-mono text-sm`                     | 14px |

#### 3.3 Spacing & Density

- Content area padding: `p-6` (24px)
- Card internal padding: `p-4` (16px)
- Gap between cards/sections: `gap-4` (16px)
- Form field spacing: `space-y-4` (16px)
- Desktop-density inputs (shadcn default sizing, no mobile-large touch targets)

#### 3.4 Light & Dark Mode Standards

- All backgrounds, borders, and text must use semantic token classes (`bg-background`, `text-foreground`, `border-border`, etc.)
- No `bg-white`, `bg-gray-*`, `text-black` — these break in dark mode
- Card surfaces use `bg-card` with `border border-border rounded-lg`
- Active/selected states use `bg-accent text-accent-foreground`
- Focus rings use `ring-ring` token
- Shadows: `shadow-sm` for cards (light mode), no visible shadow in dark mode (use border emphasis instead)

---

### 4. Page-by-Page Layout Specifications

#### 4.1 Dashboard

| Property     | Value                                                                     |
| ------------ | ------------------------------------------------------------------------- |
| Sub-tabs     | `Overview` · `Activity Log`                                               |
| Overview     | System info cards (grid), engine status, browser detection, quick actions |
| Activity Log | Real-time WebSocket event stream (existing, moved to sub-tab)             |

#### 4.2 Tools (Major Overhaul — see Section 5)

| Property    | Value                                  |
| ----------- | -------------------------------------- |
| Sub-tabs    | One tab per tool category (see §5.2)   |
| Left panel  | Tool list/grid for the active category |
| Right panel | Selected tool's form + output          |

#### 4.3 Scraping

| Property | Value                                                                     |
| -------- | ------------------------------------------------------------------------- |
| Sub-tabs | `Quick Scrape` · `Batch Jobs` · `Results`                                 |
| Existing | Engine/Browser/Remote toggle, SSE streaming, progress bar — all preserved |

#### 4.4 Documents

| Property | Value                                                                       |
| -------- | --------------------------------------------------------------------------- |
| Sub-tabs | `Notes` · `Folders` · `Sync` · `Sharing`                                    |
| Existing | Markdown editor, folder tree, version history — redistributed into sub-tabs |

#### 4.5 Settings

| Property | Value                                                      |
| -------- | ---------------------------------------------------------- |
| Sub-tabs | `General` · `Engine` · `Proxy` · `Cloud Sync` · `Updates`  |
| Existing | All settings controls preserved, reorganized into sub-tabs |

---

### 5. Tools UI Overhaul — Detailed Design

This is the largest body of work in this project.

#### 5.1 Current State

The existing Tools page:

- Shows a flat list of all 73 tools
- Each tool accepts input as a **raw JSON textarea**
- Output is displayed as raw JSON
- No input validation, no field descriptions, no type-specific controls

#### 5.2 Tool Categories & Sub-Tabs

Tools will be organized into category sub-tabs:

| Sub-Tab             | Tools Count | Examples                                                             |
| ------------------- | ----------- | -------------------------------------------------------------------- |
| **Filesystem**      | ~8          | ReadFile, WriteFile, ListDirectory, WatchDirectory, etc.             |
| **Shell & Process** | ~8          | RunCommand, ListProcesses, LaunchApp, KillProcess, etc.              |
| **Window & Input**  | ~7          | ListWindows, FocusWindow, TypeText, Hotkey, MouseClick, etc.         |
| **Browser**         | ~8          | BrowserNavigate, Click, Type, Extract, Screenshot, Tabs, etc.        |
| **Network**         | ~6          | NetworkInfo, NetworkScan, PortScan, MDNSDiscover, etc.               |
| **System**          | ~6          | SystemResources, BatteryStatus, DiskUsage, TopProcesses, etc.        |
| **Audio & Media**   | ~8          | RecordAudio, PlayAudio, TranscribeAudio, ImageOCR, ImageResize, etc. |
| **Documents**       | ~5          | ListDocuments, ReadDocument, WriteDocument, SearchDocuments, etc.    |
| **Scraping**        | ~6          | ScrapeUrl, ExtractContent, BatchScrape, etc.                         |
| **OS Integration**  | ~5          | AppleScript, PowerShellScript, GetInstalledApps, etc.                |
| **Scheduler**       | ~4          | ScheduleTask, ListScheduled, CancelScheduled, HeartbeatStatus, etc.  |
| **Connectivity**    | ~4          | WifiNetworks, BluetoothDevices, ConnectedDevices, etc.               |

#### 5.3 Tool Page Layout (Split-Panel)

```
┌─────────────────────────────────────────────────────┐
│ PageHeader: "Tools"                                 │
├─────────────────────────────────────────────────────┤
│ SubTabBar: [Filesystem] [Shell] [Browser] [...]     │
├───────────────┬─────────────────────────────────────┤
│               │                                     │
│  Tool List    │   Tool Detail Panel                 │
│  (scrollable) │                                     │
│               │   ┌─ Tool Name & Description ─────┐ │
│  ┌──────────┐ │   │                               │ │
│  │ToolCard  │ │   │  Input Form                   │ │
│  │(selected)│ │   │  ┌─ field 1 ───────────────┐  │ │
│  ├──────────┤ │   │  ├─ field 2 ───────────────┤  │ │
│  │ToolCard  │ │   │  ├─ field 3 (optional) ────┤  │ │
│  ├──────────┤ │   │  └─────────────────────────┘  │ │
│  │ToolCard  │ │   │                               │ │
│  │  ...     │ │   │  [▶ Run Tool]  [↺ Reset]      │ │
│  └──────────┘ │   ├───────────────────────────────┤ │
│               │   │  Output Panel                 │ │
│               │   │  (formatted result / error)   │ │
│               │   └───────────────────────────────┘ │
├───────────────┴─────────────────────────────────────┤
```

- **Tool List**: Left panel, ~250px fixed width, scrollable list of `ToolCard` components for the active category
- **Tool Detail**: Remaining width, split vertically — input form (top) and output (bottom, collapsible/resizable)

#### 5.4 Dynamic Form Generation System

Rather than building 73 individual form components, implement a **schema-driven form renderer**.

##### 5.4.1 Tool Schema Definition

Each tool already has a defined input schema from the API (`/tools/list` endpoint returns tool metadata). We will create a **UI schema layer** that maps tool parameters to form components:

```typescript
// types/tool-schema.ts

type FieldType =
  | "text" // Single-line text input
  | "textarea" // Multi-line text
  | "number" // Numeric input with optional min/max
  | "boolean" // Toggle/checkbox
  | "select" // Dropdown with predefined options
  | "file-path" // Text input + file/folder picker button (Tauri dialog)
  | "file-upload" // File drag-and-drop zone
  | "json" // Monaco/CodeMirror JSON editor (advanced fallback)
  | "key-value" // Dynamic key-value pair list
  | "tags" // Tag/chip input for arrays of strings
  | "date" // Date picker
  | "duration" // Duration input (seconds/minutes/hours)
  | "password" // Masked text input
  | "code" // Code editor with syntax highlighting
  | "url" // URL input with validation
  | "ip-address" // IP address input
  | "port" // Port number (0-65535)
  | "regex" // Regex input with live test
  | "enum-multi"; // Multi-select checkbox group

interface ToolFieldSchema {
  name: string;
  label: string;
  type: FieldType;
  description?: string;
  placeholder?: string;
  required: boolean;
  default?: unknown;
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    options?: { label: string; value: string }[];
  };
  dependsOn?: {
    // Show this field only when another field has a specific value
    field: string;
    value: unknown;
  };
}

interface ToolUISchema {
  toolName: string;
  category: string;
  icon: string; // Lucide icon name
  description: string;
  fields: ToolFieldSchema[];
  outputType:
    | "json"
    | "table"
    | "text"
    | "file-tree"
    | "image"
    | "audio"
    | "log-stream";
}
```

##### 5.4.2 Form Renderer Component

```typescript
// components/tools/ToolForm.tsx

interface ToolFormProps {
  schema: ToolUISchema;
  onSubmit: (params: Record<string, unknown>) => void;
  isLoading: boolean;
}
```

The `ToolForm` component:

1. Reads the `fields` array from the schema
2. Renders the appropriate shadcn/ui input component for each field type
3. Applies Zod validation generated from the schema constraints
4. Manages form state via `react-hook-form`
5. Submits the result as the JSON payload the tool API expects

**Field type → Component mapping:**

| FieldType     | shadcn/ui Component                          | Notes                               |
| ------------- | -------------------------------------------- | ----------------------------------- |
| `text`        | `<Input />`                                  | Standard text input                 |
| `textarea`    | `<Textarea />`                               | Auto-resizing multi-line            |
| `number`      | `<Input type="number" />`                    | With min/max enforcement            |
| `boolean`     | `<Switch />`                                 | With label to the right             |
| `select`      | `<Select />`                                 | Dropdown with options from schema   |
| `file-path`   | `<Input />` + `<Button>Browse</Button>`      | Uses Tauri `dialog.open()`          |
| `file-upload` | `<DropZone />` (custom)                      | Drag-and-drop with file type filter |
| `json`        | Embedded code editor                         | Fallback for truly complex inputs   |
| `key-value`   | Dynamic row list with key/value `<Input />`s | Add/remove rows                     |
| `tags`        | Tag input (custom)                           | Comma-separated → chip display      |
| `code`        | Code editor (lightweight)                    | With language selector              |
| `url`         | `<Input type="url" />`                       | With URL format validation          |
| `port`        | `<Input type="number" />`                    | Range: 0–65535                      |
| `enum-multi`  | `<Checkbox />` group                         | Grid layout                         |

##### 5.4.3 Output Renderer Component

```typescript
// components/tools/ToolOutput.tsx

interface ToolOutputProps {
  outputType: ToolUISchema["outputType"];
  data: unknown;
  isLoading: boolean;
  error?: string;
}
```

**Output type → Renderer mapping:**

| OutputType   | Renderer                                   | Use Case                          |
| ------------ | ------------------------------------------ | --------------------------------- |
| `json`       | Collapsible JSON tree viewer               | Generic structured data           |
| `table`      | shadcn `<DataTable />` with TanStack Table | Lists (processes, files, devices) |
| `text`       | `<pre>` with monospace styling             | Command output, logs              |
| `file-tree`  | Tree view component                        | Directory listings                |
| `image`      | `<img>` with zoom/download                 | Screenshots, OCR results          |
| `audio`      | Audio player with waveform                 | Audio recording/playback results  |
| `log-stream` | Auto-scrolling log view                    | Real-time streaming output        |

##### 5.4.4 UI Schema Registry

All 73 tool schemas will be defined in a central registry:

```
src/
  tool-schemas/
    index.ts              // Registry: toolName → ToolUISchema
    filesystem.ts         // Schemas for filesystem tools
    shell-process.ts      // Schemas for shell & process tools
    browser.ts            // Schemas for browser automation tools
    network.ts            // etc.
    system.ts
    audio-media.ts
    documents.ts
    scraping.ts
    os-integration.ts
    scheduler.ts
    connectivity.ts
```

Each file exports an array of `ToolUISchema` objects. The registry assembles them into a `Map<string, ToolUISchema>`.

##### 5.4.5 Example: Tool Schema for `ReadFile`

```typescript
// tool-schemas/filesystem.ts

export const readFileSchema: ToolUISchema = {
  toolName: "ReadFile",
  category: "Filesystem",
  icon: "FileText",
  description: "Read the contents of a file from the local filesystem.",
  fields: [
    {
      name: "path",
      label: "File Path",
      type: "file-path",
      description: "Absolute or relative path to the file.",
      placeholder: "/path/to/file.txt",
      required: true,
    },
    {
      name: "encoding",
      label: "Encoding",
      type: "select",
      description: "Character encoding to use when reading.",
      required: false,
      default: "utf-8",
      validation: {
        options: [
          { label: "UTF-8", value: "utf-8" },
          { label: "ASCII", value: "ascii" },
          { label: "Latin-1", value: "latin-1" },
          { label: "UTF-16", value: "utf-16" },
        ],
      },
    },
    {
      name: "maxLines",
      label: "Max Lines",
      type: "number",
      description: "Limit the number of lines to read (0 = all).",
      required: false,
      default: 0,
      validation: { min: 0 },
    },
  ],
  outputType: "text",
};
```

##### 5.4.6 Example: Tool Schema for `NetworkScan`

```typescript
export const networkScanSchema: ToolUISchema = {
  toolName: "NetworkScan",
  category: "Network",
  icon: "Wifi",
  description: "Scan the local network for active devices.",
  fields: [
    {
      name: "subnet",
      label: "Subnet",
      type: "text",
      description:
        "CIDR notation (e.g., 192.168.1.0/24). Leave empty for auto-detect.",
      placeholder: "192.168.1.0/24",
      required: false,
    },
    {
      name: "timeout",
      label: "Timeout (seconds)",
      type: "number",
      description: "Maximum time to wait for responses.",
      required: false,
      default: 5,
      validation: { min: 1, max: 60 },
    },
  ],
  outputType: "table",
};
```

#### 5.5 JSON Fallback Mode

For power users, every tool detail panel includes a toggle:

```
[🎨 Form View]  [{ } JSON View]
```

- **Form View** (default): The schema-driven form UI
- **JSON View**: Raw JSON textarea (current behavior), preserved for advanced use cases
- Toggle state is persisted per-user in localStorage

---

### 6. Implementation Plan

#### 6.1 Phase Breakdown

| Phase                                 | Scope                                                                                                                                                            | Est. Effort |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **Phase 1: Layout Shell**             | `AppShell`, `AppSidebar`, `PageHeader`, `SubTabBar`, `ContentArea`, `StatusBar`. Refactor all pages to render inside the shell.                                  | Medium      |
| **Phase 2: Design System Polish**     | Audit and fix all CSS token usage. Ensure every component uses semantic tokens. Fix light/dark mode inconsistencies. Establish typography and spacing standards. | Medium      |
| **Phase 3: Tool Form Infrastructure** | `ToolForm`, `ToolOutput`, `ToolCard`, field type components, schema types, Zod generation from schema, form/JSON toggle.                                         | Large       |
| **Phase 4: Tool Schema Definitions**  | Define `ToolUISchema` for all 73 tools across 12 category files.                                                                                                 | Large       |
| **Phase 5: Page Reorganization**      | Redistribute Dashboard, Scraping, Documents, Settings content into sub-tab layouts.                                                                              | Medium      |
| **Phase 6: QA & Polish**              | Cross-mode testing (light/dark), interaction states (hover, focus, disabled, loading, error), edge cases, keyboard navigation.                                   | Medium      |

#### 6.2 Phase Dependencies

```
Phase 1 (Shell) ──→ Phase 5 (Pages)
     │
     └──→ Phase 2 (Design Polish)
     │
     └──→ Phase 3 (Tool Infra) ──→ Phase 4 (Schemas)
                                         │
                                         └──→ Phase 6 (QA)
```

Phase 1 must complete first. Phases 2, 3, and 5 can run in parallel after Phase 1.

#### 6.3 File Structure (New & Modified)

```
desktop/src/
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx          ← NEW
│   │   ├── AppSidebar.tsx        ← NEW (replaces current sidebar)
│   │   ├── PageHeader.tsx        ← NEW
│   │   ├── SubTabBar.tsx         ← NEW
│   │   ├── ContentArea.tsx       ← NEW
│   │   └── StatusBar.tsx         ← NEW
│   ├── tools/
│   │   ├── ToolForm.tsx          ← NEW (dynamic form renderer)
│   │   ├── ToolOutput.tsx        ← NEW (typed output renderer)
│   │   ├── ToolCard.tsx          ← NEW
│   │   ├── ToolDetailPanel.tsx   ← NEW
│   │   ├── JsonFallbackEditor.tsx ← NEW
│   │   └── fields/              ← NEW (one component per FieldType)
│   │       ├── TextField.tsx
│   │       ├── NumberField.tsx
│   │       ├── BooleanField.tsx
│   │       ├── SelectField.tsx
│   │       ├── FilePathField.tsx
│   │       ├── TagsField.tsx
│   │       ├── KeyValueField.tsx
│   │       ├── CodeField.tsx
│   │       └── ...
│   ├── documents/               (existing, reorganized)
│   └── ui/                      (existing shadcn primitives)
├── tool-schemas/
│   ├── index.ts                  ← NEW (registry)
│   ├── filesystem.ts             ← NEW
│   ├── shell-process.ts          ← NEW
│   ├── browser.ts                ← NEW
│   ├── network.ts                ← NEW
│   ├── system.ts                 ← NEW
│   ├── audio-media.ts            ← NEW
│   ├── documents.ts              ← NEW
│   ├── scraping.ts               ← NEW
│   ├── os-integration.ts         ← NEW
│   ├── scheduler.ts              ← NEW
│   └── connectivity.ts           ← NEW
├── pages/
│   ├── Dashboard.tsx             ← MODIFIED (sub-tabs: Overview, Activity)
│   ├── Tools.tsx                 ← MAJOR REWRITE
│   ├── Scraping.tsx              ← MODIFIED (sub-tabs)
│   ├── Documents.tsx             ← MODIFIED (sub-tabs)
│   └── Settings.tsx              ← MODIFIED (sub-tabs)
├── hooks/
│   ├── use-tool-execution.ts     ← NEW (tool run + loading state)
│   └── ...
├── lib/
│   ├── schema-to-zod.ts          ← NEW (ToolFieldSchema → Zod schema)
│   └── ...
└── index.css                     ← MODIFIED (token audit)
```

---

### 7. Technical Considerations

#### 7.1 Performance

- **Lazy loading**: Tool schema files should be code-split per category. Only load the active category's schemas.
- **Form mount/unmount**: When switching tools, unmount the previous form to avoid stale state. Use `key={toolName}` on the form component.
- **Output rendering**: Large table outputs (e.g., `ListProcesses` returning 200+ rows) should use virtualized rendering via TanStack Table's virtual scrolling.
- **WebSocket streams**: `log-stream` output type should use a ring buffer (capped at ~1000 lines) to prevent memory growth.

#### 7.2 Tauri Integration Points

- **File path fields**: Use `@tauri-apps/plugin-dialog` for native open/save dialogs
- **Sidebar state**: Persist collapsed/expanded state in localStorage (synced with settings)
- **Window chrome**: Respect Tauri's custom titlebar area; ensure the sidebar and header don't overlap the drag region

#### 7.3 Accessibility

- All form fields must have associated labels (via shadcn `<FormLabel>`)
- Keyboard navigation: Tab through fields, Enter to submit, Escape to reset
- Sub-tabs: Arrow key navigation (handled by Radix `<Tabs>`)
- Focus management: When selecting a tool from the list, auto-focus the first form field
- Color contrast: All text/background combinations must meet WCAG AA (4.5:1 ratio) in both themes

#### 7.4 Error Handling

- **Form validation errors**: Inline, below the field, using `text-destructive` token
- **API errors**: Displayed in the output panel with a red error card and the error message
- **Connection lost**: StatusBar turns red/amber; tools show a disabled state with "Engine disconnected" overlay

---

### 8. Risks & Mitigations

| Risk                                                                                      | Impact | Mitigation                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Schema definitions for 73 tools is labor-intensive                                        | High   | Build 3-5 schemas first to validate the system, then batch the rest. Use the `/tools/list` API response as a starting template. |
| Some tools have deeply nested or polymorphic inputs that don't map cleanly to form fields | Medium | JSON fallback toggle ensures every tool remains functional. Flag complex tools during Phase 4 for custom handling.              |
| Light/dark mode regressions                                                               | Medium | Add a visual regression test or screenshot diff step. Audit every component against both modes during Phase 6.                  |
| Tauri file dialogs may behave differently across OS                                       | Low    | Test on macOS, Windows, Linux during Phase 6. Use `@tauri-apps/plugin-dialog` which abstracts OS differences.                   |

---

### 9. Open Questions

_See Clarifying Questions section below._

---

## 🔍 Assumptions

1. **The existing `/tools/list` API response includes parameter metadata** (names, types, required/optional, descriptions) that can serve as a starting point for generating `ToolUISchema` objects. If not, schemas will need to be defined entirely manually.
2. **The sidebar navigation items are**: Dashboard, Tools, Scraping, Documents, Settings. No new primary pages are being added.
3. **shadcn/ui's `Sidebar` component** (the newer composable one) will replace whatever sidebar implementation currently exists, rather than patching the current one.
4. **No new npm dependencies** beyond what shadcn/ui already provides (Radix primitives, react-hook-form, zod), except potentially a lightweight code editor (e.g., `@uiw/react-codemirror`) for
