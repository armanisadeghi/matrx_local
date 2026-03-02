import * as React from "react";
import { cn } from "@/lib/utils";

interface PopoverProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: React.ReactNode;
}

interface PopoverTriggerProps {
    children: React.ReactNode;
    asChild?: boolean;
    onClick?: () => void;
}

interface PopoverContentProps extends React.HTMLAttributes<HTMLDivElement> {
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";
}

const PopoverContext = React.createContext<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    triggerRef: React.RefObject<HTMLDivElement | null>;
}>({ open: false, onOpenChange: () => { }, triggerRef: { current: null } });

export function Popover({ open, onOpenChange, children }: PopoverProps) {
    const triggerRef = React.useRef<HTMLDivElement | null>(null);
    return (
        <PopoverContext.Provider value={{ open, onOpenChange, triggerRef }}>
            <div className="relative">{children}</div>
        </PopoverContext.Provider>
    );
}

export function PopoverTrigger({ children, onClick }: PopoverTriggerProps) {
    const { onOpenChange, open, triggerRef } = React.useContext(PopoverContext);
    return (
        <div
            ref={triggerRef}
            onClick={() => {
                onOpenChange(!open);
                onClick?.();
            }}
            className="cursor-pointer"
        >
            {children}
        </div>
    );
}

export function PopoverContent({
    children,
    className,
    side = "top",
    align = "start",
    ...props
}: PopoverContentProps) {
    const { open, onOpenChange } = React.useContext(PopoverContext);
    const ref = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onOpenChange(false);
            }
        };
        // Delay listener to avoid immediately closing from the trigger click
        const id = setTimeout(() => document.addEventListener("mousedown", handler), 0);
        return () => {
            clearTimeout(id);
            document.removeEventListener("mousedown", handler);
        };
    }, [open, onOpenChange]);

    if (!open) return null;

    const positionClasses = {
        top: "bottom-full mb-2",
        bottom: "top-full mt-2",
        left: "right-full mr-2",
        right: "left-full ml-2",
    };

    const alignClasses = {
        start: side === "top" || side === "bottom" ? "left-0" : "top-0",
        center: side === "top" || side === "bottom" ? "left-1/2 -translate-x-1/2" : "top-1/2 -translate-y-1/2",
        end: side === "top" || side === "bottom" ? "right-0" : "bottom-0",
    };

    return (
        <div
            ref={ref}
            className={cn(
                "absolute z-50 min-w-[12rem] rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg animate-fade-in",
                positionClasses[side],
                alignClasses[align],
                className,
            )}
            {...props}
        >
            {children}
        </div>
    );
}
