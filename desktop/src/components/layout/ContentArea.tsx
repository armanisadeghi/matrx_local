import { cn } from "@/lib/utils";

interface ContentAreaProps {
  children: React.ReactNode;
  className?: string;
  /** Set to true to disable default padding (for pages that need full-bleed layouts like split panels) */
  noPadding?: boolean;
}

export function ContentArea({ children, className, noPadding }: ContentAreaProps) {
  return (
    <div
      className={cn(
        "flex-1 overflow-y-auto",
        !noPadding && "p-6",
        className
      )}
    >
      {children}
    </div>
  );
}
