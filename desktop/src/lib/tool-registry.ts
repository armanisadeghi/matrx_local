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

export const toolCategories: ToolCategory[] = [
  { id: "System Monitoring", label: "System", description: "CPU, memory, disk, battery", icon: "activity" },
  { id: "Network Discovery", label: "Network", description: "Network scans and discovery", icon: "wifi" },
  { id: "Network", label: "Web & Scraping", description: "Fetch, scrape, and search", icon: "globe" },
  { id: "Process Management", label: "Processes", description: "Manage running processes", icon: "app-window" },
  { id: "File Operations", label: "Files", description: "Read, write, search, edit files", icon: "folder" },
  { id: "Documents", label: "Documents", description: "Document workspace operations", icon: "file-text" },
  { id: "Browser Automation", label: "Browser Automation", description: "Navigate and automate browser", icon: "monitor" },
  { id: "Audio", label: "Audio", description: "Audio devices, recording, playback", icon: "volume-2" },
  { id: "WiFi & Bluetooth", label: "Connectivity", description: "Wireless and connected devices", icon: "bluetooth" },
  { id: "System", label: "System", description: "OS-level utilities", icon: "settings" },
  { id: "Execution", label: "Terminal", description: "Shell execution tools", icon: "terminal" },
  { id: "Window Management", label: "Windows", description: "Manage desktop windows", icon: "panel-top" },
  { id: "Input Automation", label: "Input", description: "Keyboard and mouse automation", icon: "mouse-pointer" },
  { id: "Clipboard", label: "Clipboard", description: "Read and write clipboard", icon: "clipboard" },
  { id: "File Transfer", label: "Transfer", description: "Upload and download files", icon: "arrow-up-down" },
  { id: "File Watching", label: "Watchers", description: "Watch filesystem changes", icon: "eye" },
  { id: "Scheduler", label: "Scheduler", description: "Schedule and heartbeat controls", icon: "clock-3" },
  { id: "Media Processing", label: "Media", description: "OCR, PDF, archive, and images", icon: "image" },
  { id: "OS Integration", label: "OS Integration", description: "Platform app scripting", icon: "wrench" },
  { id: "Notifications", label: "Notifications", description: "Desktop notifications", icon: "bell" },
];

const toFieldType = (type?: string): ToolFieldSchema["type"] => {
  switch (type) {
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "tags";
    case "object":
      return "json";
    default:
      return "text";
  }
};

const toTitleCase = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function fromEngineSchema(schema: EngineToolSchema): ToolUISchema {
  const properties = schema.input_schema?.properties ?? {};
  const required = new Set(schema.input_schema?.required ?? []);

  const fields = Object.entries(properties).map(([name, def]): ToolFieldSchema => ({
    name,
    label: toTitleCase(name),
    type: toFieldType(def.type),
    description: def.description,
    defaultValue: def.default,
    required: required.has(name),
    placeholder: name.includes("path") ? "/path/to/file" : undefined,
  }));

  return {
    toolName: schema.name,
    displayName: schema.name.replace(/([A-Z])/g, " $1").trim(),
    description: schema.description,
    category: schema.category ?? "Other",
    icon: "wrench",
    fields,
    outputType: "json",
  };
}

export const toolSchemas: ToolUISchema[] = [];

export function getToolSchema(toolName: string): ToolUISchema | null {
  return toolSchemas.find((schema) => schema.toolName === toolName) ?? null;
}
