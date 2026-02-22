import {
  FileText,
  Terminal,
  Globe,
  Monitor,
  Cpu,
  HardDrive,
  Wifi,
  Wrench,
} from "lucide-react";

const suggestions = [
  {
    icon: Terminal,
    label: "Run a command",
    description: "Execute shell commands on your system",
    prompt: "Run 'ls -la' in my home directory and show the results",
  },
  {
    icon: FileText,
    label: "Read a file",
    description: "Read and analyze local files",
    prompt: "Read the contents of my .bashrc file",
  },
  {
    icon: Globe,
    label: "Search the web",
    description: "Find information online",
    prompt: "Search for the latest news about AI developments",
  },
  {
    icon: Monitor,
    label: "System info",
    description: "Check your system status",
    prompt: "Show me my system information and resource usage",
  },
  {
    icon: Cpu,
    label: "Process manager",
    description: "Monitor running processes",
    prompt: "List all running processes and their memory usage",
  },
  {
    icon: HardDrive,
    label: "Disk usage",
    description: "Analyze storage space",
    prompt: "Show my disk usage and available space",
  },
  {
    icon: Wifi,
    label: "Network scan",
    description: "Discover local network devices",
    prompt: "Scan my local network and show connected devices",
  },
  {
    icon: Wrench,
    label: "Browser automation",
    description: "Control a browser programmatically",
    prompt: "Navigate to example.com and take a screenshot",
  },
];

interface ChatWelcomeProps {
  onSuggestionClick: (prompt: string) => void;
  toolCount: number;
}

export function ChatWelcome({
  onSuggestionClick,
  toolCount,
}: ChatWelcomeProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="mb-10 flex flex-col items-center">
        {/* Logo mark */}
        <div
          className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl"
          style={{ background: "var(--chat-accent)", opacity: 0.9 }}
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </div>
        <h2
          className="mb-1.5 text-2xl font-semibold"
          style={{ color: "var(--chat-text)" }}
        >
          AI Matrx
        </h2>
        <p
          className="text-sm"
          style={{ color: "var(--chat-text-muted)" }}
        >
          {toolCount > 0
            ? `${toolCount} tools available on your local system`
            : "Your AI-powered local assistant"}
        </p>
      </div>

      <div className="grid w-full max-w-xl grid-cols-2 gap-2.5">
        {suggestions.map(({ icon: Icon, label, description, prompt }) => (
          <button
            key={label}
            onClick={() => onSuggestionClick(prompt)}
            className="group flex items-start gap-3 rounded-xl px-4 py-3.5 text-left transition-all duration-200 active:scale-[0.98]"
            style={{
              background: "var(--chat-composer-bg)",
              border: "1px solid var(--chat-border)",
            }}
          >
            <Icon
              className="mt-0.5 h-4 w-4 shrink-0 transition-colors duration-200"
              style={{ color: "var(--chat-text-faint)" }}
            />
            <div>
              <span
                className="block text-sm font-medium transition-colors duration-200"
                style={{ color: "var(--chat-text)" }}
              >
                {label}
              </span>
              <span
                className="block text-xs"
                style={{ color: "var(--chat-text-faint)" }}
              >
                {description}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
