/**
 * Browser Lab — compare all iframe / browser approaches side by side.
 *
 * Four tabs, one for each implementation strategy:
 *   1. Basic iframe     — raw src, X-Frame-Options will block many sites
 *   2. FastAPI proxy    — Python httpx strips headers, rewrites links
 *   3. Tauri fetch      — Rust reqwest → base64 → blob URL in iframe
 *   4. (Future)         — Tauri WebviewWindow (separate OS window, true browser)
 *
 * Each tab shows a consistent browser chrome + results panel.
 */
import { useState } from "react";
import { BrowserPage } from "./BrowserPage";
import { FetchProxyBrowser } from "./FetchProxyBrowser";
import { TauriFetchBrowser } from "./TauriFetchBrowser";
import {
    Globe,
    Cpu,
    Zap,
    Info,
    ChevronRight,
} from "lucide-react";

interface Tab {
    id: string;
    label: string;
    icon: typeof Globe;
    badge: string;
    badgeClass: string;
    description: string;
    pros: string[];
    cons: string[];
    component: React.FC;
}

const TABS: Tab[] = [
    {
        id: "basic",
        label: "Basic iframe",
        icon: Globe,
        badge: "Baseline",
        badgeClass: "bg-zinc-500/15 text-zinc-500 border-zinc-500/20",
        description: "Raw HTML iframe — the browser enforces X-Frame-Options and CSP frame-ancestors headers from the target site.",
        pros: ["Zero latency (direct load)", "Native JS execution", "Cookies / session maintained"],
        cons: ["Blocked by X-Frame-Options: DENY/SAMEORIGIN", "Blocked by CSP frame-ancestors 'none'", "Most major sites will show a blank frame"],
        component: BrowserPage,
    },
    {
        id: "fastapi",
        label: "FastAPI Proxy",
        icon: Cpu,
        badge: "Python",
        badgeClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
        description: "Your local FastAPI engine fetches the page with httpx (server-side), strips blocking headers, rewrites links, and serves clean HTML to the iframe.",
        pros: ["Works for most sites that set X-Frame-Options", "Strips CSP meta tags", "Integrated with your scraping pipeline", "Easy to add cookie injection"],
        cons: ["Doesn't execute JS (static HTML only)", "Relative links may not all rewrite correctly", "SPA sites (React/Next.js) won't hydrate properly"],
        component: FetchProxyBrowser,
    },
    {
        id: "tauri",
        label: "Tauri Fetch",
        icon: Zap,
        badge: "Rust",
        badgeClass: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/20",
        description: "Rust's reqwest fetches the page (completely outside the browser security model). Response is decoded and displayed as a blob URL.",
        pros: ["Absolute zero browser security restrictions", "Fastest possible fetch (native Rust)", "Cleanest for binary content / PDFs", "Can add cookie jar, proxy chaining, custom TLS"],
        cons: ["Blob iframe has limited same-origin access", "JS-heavy SPAs still won't hydrate", "blob: URLs don't persist across refreshes"],
        component: TauriFetchBrowser,
    },
];

export function BrowserLab() {
    const [activeTab, setActiveTab] = useState("basic");
    const [showInfo, setShowInfo] = useState(false);

    const active = TABS.find((t) => t.id === activeTab)!;
    const ActiveComponent = active.component;

    return (
        <div className="flex h-full flex-col">
            {/* Tab bar */}
            <div className="flex items-center gap-0 border-b bg-background/80 backdrop-blur px-3 shrink-0">
                {TABS.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = tab.id === activeTab;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${isActive
                                    ? "border-primary text-foreground"
                                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                                }`}
                        >
                            <Icon className="h-3.5 w-3.5" />
                            {tab.label}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tab.badgeClass}`}>
                                {tab.badge}
                            </span>
                        </button>
                    );
                })}

                <div className="ml-auto flex items-center gap-2 pb-0.5">
                    <button
                        onClick={() => setShowInfo(!showInfo)}
                        className={`flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors ${showInfo ? "text-foreground bg-accent" : ""}`}
                        title="Toggle approach info"
                    >
                        <Info className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>

            {/* Info banner */}
            {showInfo && (
                <div className="border-b bg-muted/40 px-4 py-3 shrink-0">
                    <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground mb-1">{active.description}</p>
                            <div className="flex gap-6 mt-2">
                                <div>
                                    <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mb-1.5">Advantages</p>
                                    <ul className="space-y-0.5">
                                        {active.pros.map((p) => (
                                            <li key={p} className="flex items-start gap-1.5 text-[11px] text-foreground/75">
                                                <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-emerald-500" />
                                                {p}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                                <div>
                                    <p className="text-[10px] font-semibold text-destructive uppercase tracking-wide mb-1.5">Limitations</p>
                                    <ul className="space-y-0.5">
                                        {active.cons.map((c) => (
                                            <li key={c} className="flex items-start gap-1.5 text-[11px] text-foreground/75">
                                                <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-destructive/70" />
                                                {c}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Active browser */}
            <div className="flex-1 overflow-hidden">
                <ActiveComponent />
            </div>
        </div>
    );
}
