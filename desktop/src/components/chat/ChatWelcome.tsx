import {
  FileText,
  Terminal,
  Globe,
  Monitor,
  Cpu,
  HardDrive,
  Wifi,
  Wrench,
  Zap,
} from "lucide-react";

const suggestions = [
  {
    icon: Terminal,
    label: "Run a command",
    prompt: "Run 'ls -la' in my home directory and show the results",
  },
  {
    icon: FileText,
    label: "Read a file",
    prompt: "Read the contents of my .bashrc file",
  },
  {
    icon: Globe,
    label: "Search the web",
    prompt: "Search for the latest news about AI developments",
  },
  {
    icon: Monitor,
    label: "System info",
    prompt: "Show me my system information and resource usage",
  },
  {
    icon: Cpu,
    label: "Process manager",
    prompt: "List all running processes and their memory usage",
  },
  {
    icon: HardDrive,
    label: "Disk usage",
    prompt: "Show my disk usage and available space",
  },
  {
    icon: Wifi,
    label: "Network scan",
    prompt: "Scan my local network and show connected devices",
  },
  {
    icon: Wrench,
    label: "Browser automation",
    prompt: "Navigate to example.com and take a screenshot",
  },
];

interface ChatWelcomeProps {
  onSuggestionClick: (prompt: string) => void;
  toolCount: number;
}

export function ChatWelcome({ onSuggestionClick, toolCount }: ChatWelcomeProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="mb-8 flex flex-col items-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <Zap className="h-7 w-7 text-primary" />
        </div>
        <h2 className="mb-1 text-xl font-semibold">AI Matrx</h2>
        <p className="text-sm text-muted-foreground">
          {toolCount > 0
            ? `${toolCount} tools available on your local system`
            : "Your AI-powered local assistant"}
        </p>
      </div>

      <div className="grid w-full max-w-xl grid-cols-2 gap-2">
        {suggestions.map(({ icon: Icon, label, prompt }) => (
          <button
            key={label}
            onClick={() => onSuggestionClick(prompt)}
            className="group flex items-center gap-3 rounded-xl border border-border/40 bg-muted/20 px-4 py-3 text-left transition-colors hover:border-primary/20 hover:bg-muted/40"
          >
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
            <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
