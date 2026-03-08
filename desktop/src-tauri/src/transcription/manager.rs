use std::path::PathBuf;
use std::sync::Arc;
use whisper_cpp_plus::{TranscriptionParams, TranscriptionResult, WhisperContext};

/// Manages the Whisper transcription context.
///
/// The WhisperContext API is identical across all model tiers — the only thing
/// that changes is the path string passed to `WhisperContext::new()`.
pub struct TranscriptionManager {
    ctx: Arc<WhisperContext>,
    model_path: PathBuf,
}

impl TranscriptionManager {
    /// Load a model from disk. This blocks briefly (~100–500ms depending on model size).
    /// Call from a spawn_blocking context, not on the async executor.
    pub fn load(model_path: PathBuf) -> Result<Self, String> {
        let ctx = WhisperContext::new(&model_path)
            .map_err(|e| format!("Failed to load whisper model: {}", e))?;

        Ok(TranscriptionManager {
            ctx: Arc::new(ctx),
            model_path,
        })
    }

    /// Get the underlying WhisperContext for streaming operations.
    pub fn context(&self) -> &Arc<WhisperContext> {
        &self.ctx
    }

    /// Transcribe a complete audio buffer (non-streaming, for file input).
    /// Audio must be 16kHz mono f32 PCM.
    pub fn transcribe_buffer(
        &self,
        audio: &[f32],
        n_threads: i32,
    ) -> Result<TranscriptionResult, String> {
        let params = TranscriptionParams::builder()
            .language("en")
            .n_threads(n_threads)
            .build();

        self.ctx
            .transcribe_with_params(audio, params)
            .map_err(|e| format!("Transcription failed: {}", e))
    }

    /// Simple transcription returning just text.
    pub fn transcribe_text(&self, audio: &[f32]) -> Result<String, String> {
        self.ctx
            .transcribe(audio)
            .map_err(|e| format!("Transcription failed: {}", e))
    }

    pub fn model_path(&self) -> &PathBuf {
        &self.model_path
    }
}

// Safe to share across threads — WhisperContext is thread-safe internally
unsafe impl Send for TranscriptionManager {}
unsafe impl Sync for TranscriptionManager {}
