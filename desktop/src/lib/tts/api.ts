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
export async function synthesizeStream(
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

  return _readChunkedWav(resp.body, signal);
}

async function* _readChunkedWav(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<Blob> {
  const reader = body.getReader();
  let buffer = new Uint8Array(0);

  const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
    const result = new Uint8Array(a.length + b.length);
    result.set(a, 0);
    result.set(b, a.length);
    return result;
  };

  try {
    while (true) {
      if (signal?.aborted) break;

      while (buffer.length < 4) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer = concat(buffer, value);
      }

      const view = new DataView(buffer.buffer, buffer.byteOffset, 4);
      const wavLen = view.getUint32(0, false); // big-endian
      buffer = buffer.slice(4);

      while (buffer.length < wavLen) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer = concat(buffer, value);
      }

      const wavData = buffer.slice(0, wavLen);
      buffer = buffer.slice(wavLen);

      yield new Blob([wavData], { type: "audio/wav" });
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
