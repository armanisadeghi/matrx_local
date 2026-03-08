use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct TranscriptionConfig {
    pub selected_model: Option<String>,
    pub setup_complete: bool,
}

impl TranscriptionConfig {
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join("transcription.json");
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, config_dir: &Path) -> Result<(), String> {
        std::fs::create_dir_all(config_dir)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;
        let path = config_dir.join("transcription.json");
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(path, json).map_err(|e| e.to_string())
    }
}
