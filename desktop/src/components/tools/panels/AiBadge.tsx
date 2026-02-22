import { Bot } from "lucide-react";

interface AiBadgeProps {
  text?: string;
}

export function AiBadge({ text = "Your AI has access to these tools" }: AiBadgeProps) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2">
      <Bot className="h-4 w-4 text-primary shrink-0" />
      <p className="text-xs text-primary/80 font-medium">{text}</p>
    </div>
  );
}
