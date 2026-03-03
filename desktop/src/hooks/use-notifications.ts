import { useState, useEffect, useCallback, useRef } from "react";
import { engine } from "@/lib/api";
import { loadSettings } from "@/lib/settings";

export type NotificationLevel = "info" | "success" | "warning" | "error";

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  level: NotificationLevel;
  timestamp: number;
  read: boolean;
}

const SOUND_URLS: Record<string, string> = {
  chime:  "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAA...", // placeholder, replaced below
};

// Programmatically generated tones via Web Audio API — no asset files needed
function playTone(type: "chime" | "alert" | "error" | "success"): void {
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    const configs: Record<string, { freq: number[]; dur: number; type: OscillatorType }> = {
      chime:   { freq: [880, 1100], dur: 0.25, type: "sine" },
      alert:   { freq: [440, 660],  dur: 0.3,  type: "triangle" },
      success: { freq: [523, 659, 784], dur: 0.18, type: "sine" },
      error:   { freq: [220, 180],  dur: 0.4,  type: "sawtooth" },
    };

    const cfg = configs[type] ?? configs.chime;
    let start = ctx.currentTime;

    cfg.freq.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = cfg.type;
      osc.frequency.setValueAtTime(freq, start);
      osc.connect(gain);
      gain.gain.setValueAtTime(0.18, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + cfg.dur);
      osc.start(start);
      osc.stop(start + cfg.dur);
      start += cfg.dur * 0.6;
    });

    // Clean up context after tones finish
    setTimeout(() => ctx.close(), (start + 0.5) * 1000);
  } catch {
    // AudioContext not available (e.g. no user gesture yet) — silent fail
  }
}

function soundForLevel(level: NotificationLevel): "chime" | "alert" | "error" | "success" {
  switch (level) {
    case "success": return "success";
    case "warning": return "alert";
    case "error":   return "error";
    default:        return "chime";
  }
}

let _notificationCounter = 0;

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const soundEnabledRef = useRef(true);

  // Load sound preference from settings on mount
  useEffect(() => {
    loadSettings().then((s) => {
      soundEnabledRef.current = (s as AppSettings & { notificationSound?: boolean }).notificationSound !== false;
    });
  }, []);

  const addNotification = useCallback((
    title: string,
    message: string,
    level: NotificationLevel = "info",
    timestamp?: number,
  ) => {
    const notif: AppNotification = {
      id: `notif-${Date.now()}-${++_notificationCounter}`,
      title,
      message,
      level,
      timestamp: timestamp ?? Date.now(),
      read: false,
    };

    setNotifications((prev) => [notif, ...prev].slice(0, 100));

    if (soundEnabledRef.current) {
      playTone(soundForLevel(level));
    }
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Listen for 'notification' events from the WebSocket
  useEffect(() => {
    const off = engine.on("message", (data: unknown) => {
      const msg = data as { type?: string; title?: string; message?: string; level?: string; timestamp?: number };
      if (msg.type === "notification" && msg.title && msg.message) {
        addNotification(
          msg.title,
          msg.message,
          (msg.level as NotificationLevel) ?? "info",
          msg.timestamp,
        );
      }
    });
    return off;
  }, [addNotification]);

  return {
    notifications,
    unreadCount,
    addNotification,
    markRead,
    markAllRead,
    dismiss,
    clearAll,
    setSoundEnabled: (v: boolean) => { soundEnabledRef.current = v; },
  };
}

// Exported type so settings.ts can reference it without a circular dep
import type { AppSettings } from "@/lib/settings";
