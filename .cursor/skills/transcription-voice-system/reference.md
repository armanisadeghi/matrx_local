# Transcription System — Detailed Reference

Read this file when you need specifics beyond what SKILL.md covers.

## Rust Tauri Commands (26+)

### Transcription Lifecycle
| Command | Signature | Notes |
|---------|-----------|-------|
| `detect_hardware` | `async fn() → json` | RAM, CPU, GPU, Metal/CUDA, model recommendation |
| `download_whisper_model` | `async fn(app, filename, cancel) → String` | HF download, retries, cancel support |
| `download_vad_model` | `async fn(app, cancel) → String` | Silero VAD for streaming |
| `cancel_whisper_download` | `fn(app, cancel) → ()` | Sets AtomicBool, emits `whisper-download-cancelled` |
| `init_transcription` | `async fn(app, state, filename) → ()` | Loads model into WhisperContext |
| `start_transcription` | `async fn(app, state, recording, device_name?) → ()` | Opens mic, starts whisper loop on OS thread |
| `stop_transcription` | `async fn(recording) → ()` | Sets stop flag, thread flushes remaining audio |
| `check_model_exists` | `fn(app, filename) → bool` | File + magic byte validation |
| `get_active_model` | `fn(state) → Option<String>` | Currently loaded model filename |
| `list_downloaded_models` | `fn(app) → Vec<String>` | Valid `.bin` files in models dir |
| `delete_model` | `async fn(app, filename) → ()` | Removes model file |
| `get_voice_setup_status` | `fn(app) → json` | `{ setup_complete, selected_model, downloaded_models }` |
| `list_audio_input_devices` | `fn() → Vec<AudioDeviceInfo>` | CPAL enumeration, marks default |

### Wake Word
| Command | Signature | Notes |
|---------|-----------|-------|
| `check_kws_model_exists` | `fn(app) → bool` | Whether tiny.en model present |
| `start_wake_word` | `async fn(app, ww_state, device_name?) → ()` | Spawns detection thread |
| `stop_wake_word` | `fn(app, ww_state) → ()` | Sets running=false |
| `mute_wake_word` | `fn(app, ww_state) → ()` | Thread runs, audio ignored |
| `unmute_wake_word` | `fn(app, ww_state) → ()` | Resumes listening |
| `dismiss_wake_word` | `fn(app, ww_state) → ()` | 10s cooldown |
| `trigger_wake_word` | `fn(app) → ()` | Manual trigger, no audio |
| `configure_wake_word` | `fn(app, ww_state, keyword?, model_filename?) → ()` | Persists keyword to config |
| `get_wake_word_mode` | `fn(ww_state) → WakeWordMode` | listening/muted/dismissed |
| `is_wake_word_running` | `fn(ww_state) → bool` | Thread status |

### Tauri Events (Rust → Frontend)
| Event | Payload | Source |
|-------|---------|--------|
| `whisper-segment` | `{ text, start_sec, end_sec }` | Transcription loop |
| `whisper-error` | `string` | Transcription failures |
| `whisper-rms` | `f32 (0-1)` | Live mic level ~5Hz |
| `whisper-calibrated` | `{ floor_rms, threshold }` | After 2s silence calibration |
| `whisper-stopped` | `null` | Thread finished flushing |
| `whisper-download-progress` | `DownloadProgress` | Model download |
| `whisper-download-cancelled` | `{ reason }` | Cancel acknowledged |
| `wake-word-detected` | `{ keyword }` | Wake phrase heard |
| `wake-word-rms` | `f32 (0-1)` | Wake word mic level |
| `wake-word-mode` | `WakeWordMode` | State transition |
| `wake-word-error` | `string` | Non-fatal wake word errors |

## Python Wake Word Routes

All under `/wake-word/` prefix:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/wake-word/status` | GET | `{ running, mode, model, threshold }` |
| `/wake-word/start` | POST | Accepts `{ model_name?, threshold?, device_name? }` |
| `/wake-word/stop` | POST | Stop detection loop |
| `/wake-word/mute` | POST | Mute (loop alive) |
| `/wake-word/unmute` | POST | Resume |
| `/wake-word/dismiss` | POST | 10s cooldown |
| `/wake-word/trigger` | POST | Manual trigger |
| `/wake-word/configure` | POST | `{ model_name?, threshold? }` |
| `/wake-word/stream` | GET | SSE stream (keepalive 15s) |
| `/wake-word/models` | GET | `{ pretrained[], downloaded[], custom[] }` |
| `/wake-word/models/download` | POST | Download pre-trained model |
| `/wake-word/models/download-stream` | POST | Download with SSE progress |

Settings routes:
- `GET /settings/wake-word` → `WakeWordSettings`
- `PUT /settings/wake-word` → persists to SQLite `app_settings`

## Python AI Audio Tools

Registered in `dispatcher.py` + `tool_schemas.py` (category "Audio"):

| Tool | Function | Notes |
|------|----------|-------|
| `ListAudioDevices` | `tool_list_audio_devices` | macOS: system_profiler + sounddevice overlay |
| `RecordAudio` | `tool_record_audio` | 1-300s WAV recording, configurable device |
| `PlayAudio` | `tool_play_audio` | Plays WAV through speakers |
| `TranscribeAudio` | `tool_transcribe_audio` | OpenAI Whisper (optional `[transcription]` extra) |

## Session Persistence Schema

localStorage key: `matrx-transcription-sessions` (max 500)

```typescript
interface TranscriptionSession {
  id: string;                    // "ts_{timestamp}_{random7}"
  title: string | null;
  createdAt: string;             // ISO
  updatedAt: string;             // ISO
  durationSecs: number;
  charCount: number;
  modelUsed: string | null;
  deviceUsed: string | null;
  segments: WhisperSegment[];    // [{ text, start_sec, end_sec }]
  fullText: string;
  rawText?: string;              // Original pre-polish (set on first AI polish)
  aiTitle?: string | null;
  aiDescription?: string | null;
  aiTags?: string[];
  aiProcessedAt?: string | null;
}
```

Write batching: `appendSegments()` buffers in a module-level `Map<string, WhisperSegment[]>`, flushed every 1000ms by `setTimeout`. `flushNow()` for immediate persist. `setFlushCallback()` registers the React state sync callback (called by `useTranscriptionSessions` on mount).

## Rust Config Persistence

File: `~/{app_data}/transcription.json`

```json
{
  "selected_model": "ggml-base.en.bin",
  "setup_complete": true,
  "wake_keyword": "hey matrix"
}
```

`wake_keyword` has a serde default of `"hey matrix"` for backward compatibility with existing config files that lack the field.

## Managed Rust State Types

```rust
TranscriptionState(Mutex<Option<TranscriptionManager>>)  // Active whisper context
RecordingState { flag: Arc<Mutex<bool>>, thread_handle }  // Recording stop flag + join handle
WakeWordAppState(Arc<WakeWordState>)                      // Wake word thread state
WhisperDownloadCancelState = Arc<AtomicBool>              // Download cancel flag
```

## Audio Capture Details

- CPAL (Cross-Platform Audio Library) for mic access
- rubato async polynomial resampler (Septic degree) for non-16kHz devices
- 10ms chunk size, max 30s buffer (ring behavior)
- Device selection: named or system default fallback
- `drain()` returns all accumulated samples and clears buffer

## Model Validation

`is_valid_model()` checks:
- Whisper models: >1MB + valid magic bytes (GGML `0x67676D6C`, GGUF `0x47475546`, LE-ggml, or `gg` prefix)
- VAD models: >50KB (ONNX format, no magic check)
- Logs actual bytes on failure for diagnosis

## Hallucination Filter

`commands.rs` lines ~571-585: deny-list of common whisper hallucinations (English only). Filtered before emitting `whisper-segment`. Includes phrases like "Thank you for watching", "Subscribe", "Please like and subscribe", etc.

## Cloud Sync for Voice Settings

Settings that sync via `AppSettings` → Supabase `app_instance_settings`:
- `wakeWordEnabled`, `wakeWordListenOnStartup`, `wakeWordEngine`
- `wakeWordOwwModel`, `wakeWordOwwThreshold`, `wakeWordCustomKeyword`
- `transcriptionDefaultModel`, `transcriptionAutoInit`
- `transcriptionAudioDevice`, `transcriptionProcessingTimeout`

Low-level engine preference (`PUT /settings/wake-word`) is SQLite-only, does NOT sync to Supabase.
