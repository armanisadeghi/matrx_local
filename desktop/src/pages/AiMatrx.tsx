import { ExternalLink, RefreshCw } from "lucide-react";
import { useState, useRef } from "react";

const TARGET_URL = "https://www.aimatrx.com/demos/local-tools";

export function AiMatrx() {
    const [key, setKey] = useState(0);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    const reload = () => setKey((k) => k + 1);

    return (
        <div className="flex h-full flex-col">
            {/* Thin toolbar */}
            <div className="flex items-center gap-2 border-b bg-background/80 backdrop-blur px-4 py-2 shrink-0">
                <span className="text-xs font-medium text-muted-foreground truncate flex-1 select-text">
                    {TARGET_URL}
                </span>
                <button
                    onClick={reload}
                    title="Reload"
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                    <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <a
                    href={TARGET_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in browser"
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                    <ExternalLink className="h-3.5 w-3.5" />
                </a>
            </div>

            {/* iframe fills remaining space */}
            <iframe
                key={key}
                ref={iframeRef}
                src={TARGET_URL}
                title="AiMatrx Local Tools"
                className="flex-1 w-full border-0"
                allow="camera; microphone; clipboard-read; clipboard-write"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
            />
        </div>
    );
}
