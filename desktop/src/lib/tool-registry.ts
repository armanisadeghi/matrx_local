import type { ToolCategory, ToolFieldSchema, ToolUISchema } from "@/types/tool-schema";

interface EngineToolSchema {
  name: string;
  description: string;
  category?: string;
  input_schema?: {
    properties?: Record<string, { type?: string; description?: string; default?: unknown }>;
    required?: string[];
  };
}

export interface CategoryMeta {
  id: string;
  label: string;
  description: string;
  icon: string;
  color: string; // tailwind color token e.g. "violet", "emerald"
  panelType: "monitoring" | "clipboard" | "audio" | "network" | "process" | "apps" | "scheduler" | "notify" | "browser" | "file" | "generic";
}

export const toolCategories: CategoryMeta[] = [
  { id: "System Monitoring",   label: "Monitoring",        description: "CPU, memory, disk & battery",      icon: "activity",      color: "violet",  panelType: "monitoring" },
  { id: "Process Management",  label: "Processes",         description: "Manage running processes",         icon: "cpu",           color: "blue",    panelType: "process" },
  { id: "Network Discovery",   label: "Network",           description: "Interfaces, ports & discovery",    icon: "wifi",          color: "sky",     panelType: "network" },
  { id: "Network",             label: "Web & Scraping",    description: "Fetch, scrape and search web",     icon: "globe",         color: "indigo",  panelType: "generic" },
  { id: "Clipboard",           label: "Clipboard",         description: "Read and write clipboard",         icon: "clipboard",     color: "amber",   panelType: "clipboard" },
  { id: "Audio",               label: "Audio",             description: "Record, play back & transcribe",   icon: "mic",           color: "rose",    panelType: "audio" },
  { id: "Scheduler",           label: "Scheduler",         description: "Schedule tasks & heartbeat",       icon: "clock",         color: "orange",  panelType: "scheduler" },
  { id: "Notifications",       label: "Notifications",     description: "Native desktop notifications",     icon: "bell",          color: "yellow",  panelType: "notify" },
  { id: "Browser Automation",  label: "Browser",           description: "Automate & control browser",       icon: "monitor",       color: "cyan",    panelType: "browser" },
  { id: "OS Integration",      label: "OS Scripting",      description: "AppleScript & PowerShell",         icon: "terminal",      color: "slate",   panelType: "generic" },
  { id: "Execution",           label: "Terminal",          description: "Shell command execution",          icon: "code-2",        color: "zinc",    panelType: "generic" },
  { id: "File Operations",     label: "Files",             description: "Read, write & search files",       icon: "folder-open",   color: "teal",    panelType: "file" },
  { id: "File Watching",       label: "File Watcher",      description: "Watch filesystem for changes",     icon: "eye",           color: "teal",    panelType: "generic" },
  { id: "File Transfer",       label: "Transfer",          description: "Upload and download files",        icon: "arrow-up-down", color: "teal",    panelType: "generic" },
  { id: "Documents",           label: "Documents",         description: "Document workspace tools",         icon: "file-text",     color: "purple",  panelType: "generic" },
  { id: "Media Processing",    label: "Media",             description: "OCR, PDF, images & archives",      icon: "image",         color: "pink",    panelType: "generic" },
  { id: "Window Management",   label: "Windows",           description: "Move and manage app windows",      icon: "layout",        color: "blue",    panelType: "generic" },
  { id: "Input Automation",    label: "Input",             description: "Keyboard & mouse automation",      icon: "mouse-pointer", color: "indigo",  panelType: "generic" },
  { id: "WiFi & Bluetooth",    label: "Connectivity",      description: "Wireless & connected devices",     icon: "bluetooth",     color: "sky",     panelType: "generic" },
  { id: "System",              label: "System Utilities",  description: "OS-level utilities & info",        icon: "settings-2",    color: "slate",   panelType: "generic" },
];

// Solid tailwind bg/text pairs for category color dots — light & dark safe
export const categoryColorMap: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  violet:  { bg: "bg-violet-500/15",  text: "text-violet-400",  border: "border-violet-500/30",  glow: "shadow-violet-500/20" },
  blue:    { bg: "bg-blue-500/15",    text: "text-blue-400",    border: "border-blue-500/30",    glow: "shadow-blue-500/20" },
  sky:     { bg: "bg-sky-500/15",     text: "text-sky-400",     border: "border-sky-500/30",     glow: "shadow-sky-500/20" },
  indigo:  { bg: "bg-indigo-500/15",  text: "text-indigo-400",  border: "border-indigo-500/30",  glow: "shadow-indigo-500/20" },
  amber:   { bg: "bg-amber-500/15",   text: "text-amber-400",   border: "border-amber-500/30",   glow: "shadow-amber-500/20" },
  rose:    { bg: "bg-rose-500/15",    text: "text-rose-400",    border: "border-rose-500/30",    glow: "shadow-rose-500/20" },
  orange:  { bg: "bg-orange-500/15",  text: "text-orange-400",  border: "border-orange-500/30",  glow: "shadow-orange-500/20" },
  yellow:  { bg: "bg-yellow-500/15",  text: "text-yellow-400",  border: "border-yellow-500/30",  glow: "shadow-yellow-500/20" },
  cyan:    { bg: "bg-cyan-500/15",    text: "text-cyan-400",    border: "border-cyan-500/30",    glow: "shadow-cyan-500/20" },
  teal:    { bg: "bg-teal-500/15",    text: "text-teal-400",    border: "border-teal-500/30",    glow: "shadow-teal-500/20" },
  purple:  { bg: "bg-purple-500/15",  text: "text-purple-400",  border: "border-purple-500/30",  glow: "shadow-purple-500/20" },
  pink:    { bg: "bg-pink-500/15",    text: "text-pink-400",    border: "border-pink-500/30",    glow: "shadow-pink-500/20" },
  slate:   { bg: "bg-slate-500/15",   text: "text-slate-400",   border: "border-slate-500/30",   glow: "shadow-slate-500/20" },
  zinc:    { bg: "bg-zinc-500/15",    text: "text-zinc-400",    border: "border-zinc-500/30",    glow: "shadow-zinc-500/20" },
};

const toFieldType = (type?: string): ToolFieldSchema["type"] => {
  switch (type) {
    case "integer":
    case "number":  return "number";
    case "boolean": return "boolean";
    case "array":   return "tags";
    case "object":  return "json";
    default:        return "text";
  }
};

const toTitleCase = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function fromEngineSchema(schema: EngineToolSchema): ToolUISchema {
  const properties = schema.input_schema?.properties ?? {};
  const required   = new Set(schema.input_schema?.required ?? []);
  const meta       = toolCategories.find((c) => c.id === (schema.category ?? ""));

  const fields = Object.entries(properties).map(([name, def]): ToolFieldSchema => ({
    name,
    label:        toTitleCase(name),
    type:         name.toLowerCase().includes("path") ? "file-path" : toFieldType(def.type),
    description:  def.description,
    defaultValue: def.default,
    required:     required.has(name),
    placeholder:  name.includes("path") ? "/path/to/file" : undefined,
  }));

  return {
    toolName:    schema.name,
    displayName: schema.name.replace(/([A-Z])/g, " $1").trim(),
    description: schema.description,
    category:    schema.category ?? "System",
    icon:        meta?.icon ?? "wrench",
    fields,
    outputType:  "json",
  };
}

export const toolSchemas: ToolUISchema[] = [];

export function getToolSchema(toolName: string): ToolUISchema | null {
  return toolSchemas.find((s) => s.toolName === toolName) ?? null;
}

export function getCategoryMeta(categoryId: string): CategoryMeta {
  return toolCategories.find((c) => c.id === categoryId) ?? {
    id: categoryId, label: categoryId, description: "", icon: "wrench",
    color: "slate", panelType: "generic",
  };
}

// Legacy shim so existing imports still work
export type { ToolCategory };
