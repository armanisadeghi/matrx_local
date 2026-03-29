import { engine } from "@/lib/api";
import supabase from "@/lib/supabase";
import type {
  TtsStatus,
  TtsVoice,
  SynthesizeRequest,
  DownloadResponse,
} from "./types";

function ttsUrl(base: string, path: string): string {
  return `${base}/tts${path}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      return { Authorization: `Bearer ${session.access_token}` };
    }
  } catch {
    // auth not available
  }
  return {};
}

async function ttsJson<T>(url: string, init?: RequestInit): Promise<T> {
  const auth = await authHeaders();
  const resp = await fetch(url, {
    ...init,
    headers: {
      ...auth,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => resp.statusText);
    throw new Error(`TTS request failed (${resp.status}): ${detail}`);
  }
  return resp.json();
}

export async function getTtsStatus(): Promise<TtsStatus> {
  const base = engine.engineUrl;
  if (!base) throw new Error("Engine not discovered");
  return ttsJson<TtsStatus>(ttsUrl(base, "/status"));
}

export async function getTtsVoices(): Promise<TtsVoice[]> {
  const base = engine.engineUrl;
  if (!base) throw new Error("Engine not discovered");
  return ttsJson<TtsVoice[]>(ttsUrl(base, "/voices"));
}

export async function downloadTtsModel(): Promise<DownloadResponse> {
  const base = engine.engineUrl;
  if (!base) throw new Error("Engine not discovered");
  return ttsJson<DownloadResponse>(ttsUrl(base, "/download-model"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

/**
 * Synthesize speech and return the audio as a Blob.
 * The response is raw audio/wav bytes, not JSON.
 */
export async function synthesize(
  req: SynthesizeRequest,
): Promise<{ blob: Blob; duration: number; elapsed: number; voiceId: string }> {
  const base = engine.engineUrl;
  if (!base) throw new Error("Engine not discovered");

  const auth = await authHeaders();
  const resp = await fetch(ttsUrl(base, "/synthesize"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify(req),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => resp.statusText);
    throw new Error(`TTS synthesis failed (${resp.status}): ${detail}`);
  }

  const blob = await resp.blob();
  const duration = parseFloat(resp.headers.get("X-TTS-Duration") ?? "0");
  const elapsed = parseFloat(resp.headers.get("X-TTS-Elapsed") ?? "0");
  const voiceId = resp.headers.get("X-TTS-Voice") ?? "";

  return { blob, duration, elapsed, voiceId };
}

/**
 * Preview a voice — returns a short audio clip as a Blob.
 */
export async function previewVoice(
  voiceId: string,
): Promise<{ blob: Blob; duration: number }> {
  const base = engine.engineUrl;
  if (!base) throw new Error("Engine not discovered");

  const auth = await authHeaders();
  const resp = await fetch(ttsUrl(base, "/preview-voice"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ voice_id: voiceId }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => resp.statusText);
    throw new Error(`TTS preview failed (${resp.status}): ${detail}`);
  }

  const blob = await resp.blob();
  const duration = parseFloat(resp.headers.get("X-TTS-Duration") ?? "0");
  return { blob, duration };
}

/**
 * Stream synthesis — returns an async iterator of WAV Blobs, one per sentence.
 * The server sends length-prefixed WAV chunks so playback can start after the
 * first sentence is ready instead of waiting for the entire text.
 */
export async function* synthesizeStream(
  req: SynthesizeRequest,
  signal?: AbortSignal,
): AsyncGenerator<Blob> {
  const base = engine.engineUrl;
  if (!base) throw new Error("Engine not discovered");

  const auth = await authHeaders();
  const resp = await fetch(ttsUrl(base, "/synthesize-stream"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify(req),
    signal,
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => resp.statusText);
    throw new Error(`TTS stream failed (${resp.status}): ${detail}`);
  }

  if (!resp.body) throw new Error("No response body for TTS stream");

  const reader = resp.body.getReader();
  let buf = new ArrayBuffer(0);
  let bufLen = 0;

  function append(chunk: Uint8Array<ArrayBuffer>) {
    const next = new ArrayBuffer(bufLen + chunk.byteLength);
    const dst = new Uint8Array(next);
    dst.set(new Uint8Array(buf, 0, bufLen), 0);
    dst.set(chunk, bufLen);
    buf = next;
    bufLen += chunk.byteLength;
  }

  function consume(n: number): ArrayBuffer {
    const slice = buf.slice(0, n);
    const remaining = bufLen - n;
    if (remaining > 0) {
      const rest = new ArrayBuffer(remaining);
      new Uint8Array(rest).set(new Uint8Array(buf, n, remaining));
      buf = rest;
    } else {
      buf = new ArrayBuffer(0);
    }
    bufLen = remaining;
    return slice;
  }

  try {
    while (true) {
      if (signal?.aborted) break;

      while (bufLen < 4) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value) append(value);
      }

      const hdr = new Uint8Array(consume(4));
      const wavLen = (hdr[0] << 24) | (hdr[1] << 16) | (hdr[2] << 8) | hdr[3];

      while (bufLen < wavLen) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value) append(value);
      }

      yield new Blob([consume(wavLen)], { type: "audio/wav" });
    }
  } finally {
    reader.releaseLock();
  }
}

export async function unloadTts(): Promise<{ success: boolean }> {
  const base = engine.engineUrl;
  if (!base) throw new Error("Engine not discovered");
  return ttsJson<{ success: boolean }>(ttsUrl(base, "/unload"), {
    method: "DELETE",
  });
}
