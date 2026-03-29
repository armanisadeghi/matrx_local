//! Universal download manager (Rust/Tauri side).
//!
//! Provides a sequential download queue that:
//! - Survives app restarts via SQLite persistence at ~/.matrx/downloads.db
//! - Continues running when the UI window is hidden/closed (tokio task, not window-bound)
//! - Emits fine-grained progress via Tauri events: dm-progress, dm-queued, dm-completed,
//!   dm-failed, dm-cancelled
//! - Supports per-download cancellation tokens (one AtomicBool per download ID)
//! - Also emits legacy aliases: llm-download-progress, llm-download-cancelled so existing
//!   hook code keeps working during the transition

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use futures_util::StreamExt;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, Mutex};
use tokio::time::{timeout, Duration};

// ── Types ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DownloadStatus {
    Queued,
    Active,
    Completed,
    Failed,
    Cancelled,
}

impl DownloadStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            DownloadStatus::Queued => "queued",
            DownloadStatus::Active => "active",
            DownloadStatus::Completed => "completed",
            DownloadStatus::Failed => "failed",
            DownloadStatus::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadEntry {
    pub id: String,
    pub category: String,
    pub filename: String,
    pub display_name: String,
    pub urls: Vec<String>,
    pub total_bytes: u64,
    pub bytes_done: u64,
    pub status: DownloadStatus,
    pub error_msg: Option<String>,
    pub priority: i32,
    pub part_current: usize,
    pub part_total: usize,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

impl DownloadEntry {
    pub fn percent(&self) -> f64 {
        if self.total_bytes == 0 {
            return 0.0;
        }
        (self.bytes_done as f64 / self.total_bytes as f64 * 100.0).min(100.0)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgressEvent {
    pub id: String,
    pub category: String,
    pub filename: String,
    pub display_name: String,
    pub status: String,
    pub bytes_done: u64,
    pub total_bytes: u64,
    pub percent: f64,
    pub part_current: usize,
    pub part_total: usize,
    pub speed_bps: f64,
    pub eta_seconds: Option<f64>,
    pub error_msg: Option<String>,
}

// ── Worker message ────────────────────────────────────────────────────────

enum WorkerMsg {
    Enqueue(String), // download ID
}

// ── DownloadManager ────────────────────────────────────────────────────────

pub struct DownloadManager {
    db_path: PathBuf,
    entries: Arc<Mutex<HashMap<String, DownloadEntry>>>,
    cancel_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    tx: mpsc::UnboundedSender<WorkerMsg>,
}

impl DownloadManager {
    /// Create and start the manager. Call once from lib.rs setup.
    pub fn new(app: AppHandle, db_path: PathBuf) -> Arc<Self> {
        let (tx, rx) = mpsc::unbounded_channel::<WorkerMsg>();

        let entries = Arc::new(Mutex::new(HashMap::new()));
        let cancel_flags = Arc::new(Mutex::new(HashMap::new()));

        let mgr = Arc::new(DownloadManager {
            db_path: db_path.clone(),
            entries: entries.clone(),
            cancel_flags: cancel_flags.clone(),
            tx,
        });

        // Initialize DB schema
        if let Err(e) = init_db(&db_path) {
            eprintln!("[downloads] DB init error: {}", e);
        }

        // Start worker
        let mgr_clone = Arc::clone(&mgr);
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            mgr_clone.worker(app_clone, rx).await;
        });

        // Re-queue incomplete downloads from previous session
        let mgr_clone2 = Arc::clone(&mgr);
        let app_clone2 = app.clone();
        tauri::async_runtime::spawn(async move {
            mgr_clone2.resume_incomplete(app_clone2).await;
        });

        mgr
    }

    /// Register an externally-managed download (already being downloaded by other code).
    ///
    /// Creates an `active` entry that the worker will NOT process.  The caller is
    /// responsible for emitting `dm-progress` / `dm-completed` / `dm-failed` events.
    /// Use this for LLM / Whisper commands that handle their own HTTP + file writing.
    pub async fn register_external(
        &self,
        app: &AppHandle,
        id: String,
        category: String,
        filename: String,
        display_name: String,
        urls: Vec<String>,
    ) -> DownloadEntry {
        // Idempotency
        {
            let entries = self.entries.lock().await;
            if let Some(existing) = entries.get(&id) {
                if matches!(
                    existing.status,
                    DownloadStatus::Active | DownloadStatus::Queued | DownloadStatus::Completed
                ) {
                    return existing.clone();
                }
            }
        }

        let now = now_str();
        let part_total = urls.len().max(1);
        let entry = DownloadEntry {
            id: id.clone(),
            category,
            filename,
            display_name,
            urls,
            total_bytes: 0,
            bytes_done: 0,
            status: DownloadStatus::Active, // Skip the worker queue
            error_msg: None,
            priority: 0,
            part_current: 1,
            part_total,
            created_at: now.clone(),
            updated_at: now,
            completed_at: None,
        };

        if let Err(e) = db_upsert(&self.db_path, &entry, None) {
            eprintln!("[downloads] DB upsert (external) failed: {}", e);
        }
        {
            let mut flags = self.cancel_flags.lock().await;
            flags.insert(id.clone(), Arc::new(AtomicBool::new(false)));
        }
        {
            let mut entries = self.entries.lock().await;
            entries.insert(id.clone(), entry.clone());
        }

        emit_progress(app, &entry, 0.0, None);
        entry
    }

    /// Mark an externally-managed download as completed.
    pub async fn mark_external_completed(&self, app: &AppHandle, id: &str, total_bytes: u64) {
        let entry_clone = {
            let mut entries = self.entries.lock().await;
            let Some(e) = entries.get_mut(id) else { return };
            e.status = DownloadStatus::Completed;
            e.bytes_done = total_bytes;
            if total_bytes > 0 { e.total_bytes = total_bytes; }
            e.completed_at = Some(now_str());
            e.updated_at = now_str();
            e.clone()
        };
        let _ = db_update_status(&self.db_path, id, "completed", None);
        let ev = build_event(&entry_clone, 100.0, None);
        let _ = app.emit("dm-completed", &ev);
        let _ = app.emit("dm-progress", &ev);
    }

    /// Mark an externally-managed download as failed.
    pub async fn mark_external_failed(&self, app: &AppHandle, id: &str, error: &str) {
        let entry_clone = {
            let mut entries = self.entries.lock().await;
            let Some(e) = entries.get_mut(id) else { return };
            e.status = DownloadStatus::Failed;
            e.error_msg = Some(error.to_string());
            e.updated_at = now_str();
            e.clone()
        };
        let _ = db_update_status(&self.db_path, id, "failed", Some(error));
        let ev = build_event(&entry_clone, entry_clone.percent(), None);
        let _ = app.emit("dm-failed", &ev);
        let _ = app.emit("dm-progress", &ev);
    }

    /// Enqueue a new download. Returns the entry (or existing if already queued/active).
    pub async fn enqueue(
        &self,
        app: &AppHandle,
        id: String,
        category: String,
        filename: String,
        display_name: String,
        urls: Vec<String>,
        priority: i32,
        metadata: Option<String>,
    ) -> Result<DownloadEntry, String> {
        // Idempotency check
        {
            let entries = self.entries.lock().await;
            if let Some(existing) = entries.get(&id) {
                if matches!(existing.status, DownloadStatus::Queued | DownloadStatus::Active | DownloadStatus::Completed) {
                    return Ok(existing.clone());
                }
            }
            // Also check by filename+category
            for entry in entries.values() {
                if entry.filename == filename && entry.category == category {
                    if matches!(entry.status, DownloadStatus::Queued | DownloadStatus::Active) {
                        return Ok(entry.clone());
                    }
                    if entry.status == DownloadStatus::Completed {
                        return Ok(entry.clone());
                    }
                }
            }
        }

        let now = now_str();
        let part_total = urls.len().max(1);
        let entry = DownloadEntry {
            id: id.clone(),
            category: category.clone(),
            filename: filename.clone(),
            display_name: display_name.clone(),
            urls: urls.clone(),
            total_bytes: 0,
            bytes_done: 0,
            status: DownloadStatus::Queued,
            error_msg: None,
            priority,
            part_current: 1,
            part_total,
            created_at: now.clone(),
            updated_at: now,
            completed_at: None,
        };

        // Persist to DB
        if let Err(e) = db_upsert(&self.db_path, &entry, metadata) {
            eprintln!("[downloads] DB upsert failed: {}", e);
        }

        // Register cancel flag
        {
            let mut flags = self.cancel_flags.lock().await;
            flags.insert(id.clone(), Arc::new(AtomicBool::new(false)));
        }

        // Store in memory
        {
            let mut entries = self.entries.lock().await;
            entries.insert(id.clone(), entry.clone());
        }

        // Emit queued event
        emit_progress(app, &entry, 0.0, None);

        // Send to worker
        let _ = self.tx.send(WorkerMsg::Enqueue(id));

        Ok(entry)
    }

    /// Cancel a download by ID.
    pub async fn cancel(&self, app: &AppHandle, id: &str) -> bool {
        let entry = {
            let mut entries = self.entries.lock().await;
            let Some(entry) = entries.get_mut(id) else {
                return false;
            };
            if !matches!(entry.status, DownloadStatus::Queued | DownloadStatus::Active) {
                return false;
            }
            entry.status = DownloadStatus::Cancelled;
            entry.updated_at = now_str();
            entry.clone()
        };

        // Set cancel flag
        {
            let flags = self.cancel_flags.lock().await;
            if let Some(flag) = flags.get(id) {
                flag.store(true, Ordering::SeqCst);
            }
        }

        if let Err(e) = db_update_status(&self.db_path, id, "cancelled", None) {
            eprintln!("[downloads] DB cancel update failed: {}", e);
        }

        emit_progress(app, &entry, entry.percent(), None);

        // Also emit legacy alias for LLM downloads
        if entry.category == "llm" {
            let _ = app.emit("llm-download-cancelled", serde_json::json!({"reason": "user_cancelled"}));
        }

        true
    }

    /// Get all entries sorted by status priority then creation time.
    pub async fn list(&self) -> Vec<DownloadEntry> {
        let entries = self.entries.lock().await;
        let mut list: Vec<DownloadEntry> = entries.values().cloned().collect();
        list.sort_by(|a, b| {
            let rank = |s: &DownloadStatus| match s {
                DownloadStatus::Active => 0,
                DownloadStatus::Queued => 1,
                DownloadStatus::Failed => 2,
                DownloadStatus::Cancelled => 3,
                DownloadStatus::Completed => 4,
            };
            rank(&a.status)
                .cmp(&rank(&b.status))
                .then(a.created_at.cmp(&b.created_at))
        });
        list
    }

    // ── Internal: worker loop ──────────────────────────────────────────────

    async fn worker(&self, app: AppHandle, mut rx: mpsc::UnboundedReceiver<WorkerMsg>) {
        while let Some(msg) = rx.recv().await {
            match msg {
                WorkerMsg::Enqueue(id) => {
                    // Check not cancelled before starting
                    let cancelled = {
                        let flags = self.cancel_flags.lock().await;
                        flags.get(&id).map(|f| f.load(Ordering::SeqCst)).unwrap_or(false)
                    };
                    if cancelled {
                        continue;
                    }

                    let entry = {
                        let mut entries = self.entries.lock().await;
                        let Some(e) = entries.get_mut(&id) else { continue };
                        if !matches!(e.status, DownloadStatus::Queued) {
                            continue;
                        }
                        e.status = DownloadStatus::Active;
                        e.updated_at = now_str();
                        e.clone()
                    };

                    let _ = db_update_status(&self.db_path, &id, "active", None);
                    emit_progress(&app, &entry, entry.percent(), None);

                    let cancel_flag = {
                        let flags = self.cancel_flags.lock().await;
                        flags.get(&id).cloned().unwrap_or_else(|| Arc::new(AtomicBool::new(false)))
                    };

                    match self.run_download(&app, &id, cancel_flag).await {
                        Ok(()) => {
                            // Status already updated inside run_download
                        }
                        Err(e) => {
                            let mut entries = self.entries.lock().await;
                            if let Some(entry) = entries.get_mut(&id) {
                                if matches!(entry.status, DownloadStatus::Active) {
                                    entry.status = DownloadStatus::Failed;
                                    entry.error_msg = Some(e.clone());
                                    entry.updated_at = now_str();
                                    let _ = db_update_status(&self.db_path, &id, "failed", Some(&e));
                                    let ev = build_event(entry, 0.0, None);
                                    let _ = app.emit("dm-failed", &ev);
                                    let _ = app.emit("dm-progress", &ev);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    async fn run_download(&self, app: &AppHandle, id: &str, cancel_flag: Arc<AtomicBool>) -> Result<(), String> {
        let (urls, filename, display_name, category) = {
            let entries = self.entries.lock().await;
            let e = entries.get(id).ok_or("Entry not found")?;
            (e.urls.clone(), e.filename.clone(), e.display_name.clone(), e.category.clone())
        };

        if urls.is_empty() {
            return Err("No URLs provided".to_string());
        }

        // Get HF token from app state if available
        let hf_token = get_hf_token_from_app(app);

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(7200))
            .build()
            .map_err(|e| e.to_string())?;

        // Probe total bytes
        let total_bytes = probe_total_bytes(&client, &urls, hf_token.as_deref()).await;
        {
            let mut entries = self.entries.lock().await;
            if let Some(e) = entries.get_mut(id) {
                e.total_bytes = total_bytes;
            }
        }

        let part_total = urls.len();
        let mut bytes_before: u64 = 0;

        for (part_idx, url) in urls.iter().enumerate() {
            if cancel_flag.load(Ordering::SeqCst) {
                self.mark_cancelled(app, id).await;
                return Ok(());
            }

            let part_num = part_idx + 1;
            {
                let mut entries = self.entries.lock().await;
                if let Some(e) = entries.get_mut(id) {
                    e.part_current = part_num;
                }
            }

            let mut last_error = String::new();
            let mut success = false;

            for attempt in 0..3u32 {
                if cancel_flag.load(Ordering::SeqCst) {
                    self.mark_cancelled(app, id).await;
                    return Ok(());
                }
                if attempt > 0 {
                    tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;
                }

                match self.download_part(
                    app,
                    id,
                    &client,
                    url,
                    part_num,
                    part_total,
                    bytes_before,
                    total_bytes,
                    &filename,
                    &display_name,
                    &category,
                    hf_token.as_deref(),
                    &cancel_flag,
                )
                .await
                {
                    Ok(part_bytes) => {
                        bytes_before += part_bytes;
                        success = true;
                        break;
                    }
                    Err(e) if e.contains("cancelled") => {
                        self.mark_cancelled(app, id).await;
                        return Ok(());
                    }
                    Err(e) => {
                        last_error = format!("Part {}/{} attempt {}: {}", part_num, part_total, attempt + 1, e);
                        eprintln!("[downloads] {}", last_error);
                    }
                }
            }

            if !success {
                return Err(format!("Download failed after 3 attempts. Last error: {}", last_error));
            }
        }

        // Mark completed
        {
            let mut entries = self.entries.lock().await;
            if let Some(e) = entries.get_mut(id) {
                e.status = DownloadStatus::Completed;
                e.bytes_done = if e.total_bytes > 0 { e.total_bytes } else { bytes_before };
                e.completed_at = Some(now_str());
                e.updated_at = now_str();
                let _ = db_update_status(&self.db_path, id, "completed", None);
                let ev = build_event(e, 100.0, None);
                let _ = app.emit("dm-completed", &ev);
                let _ = app.emit("dm-progress", &ev);
                // Legacy alias
                if e.category == "llm" {
                    emit_legacy_llm_progress(app, &e.filename, part_total, bytes_before, total_bytes, 100.0);
                }
            }
        }

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn download_part(
        &self,
        app: &AppHandle,
        id: &str,
        client: &reqwest::Client,
        url: &str,
        part_num: usize,
        part_total: usize,
        bytes_before: u64,
        grand_total: u64,
        filename: &str,
        display_name: &str,
        category: &str,
        hf_token: Option<&str>,
        cancel_flag: &Arc<AtomicBool>,
    ) -> Result<u64, String> {
        let mut req = client.get(url);
        if let Some(tok) = hf_token {
            req = req.header("Authorization", format!("Bearer {}", tok));
        }

        let response = req.send().await.map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status()));
        }

        let part_total_bytes = response
            .content_length()
            .unwrap_or(0);

        let mut stream = response.bytes_stream();
        let mut part_bytes_done: u64 = 0;
        let start = std::time::Instant::now();
        let mut last_db_update = std::time::Instant::now();

        loop {
            if cancel_flag.load(Ordering::SeqCst) {
                return Err("cancelled".to_string());
            }

            let chunk_result = timeout(Duration::from_secs(60), stream.next()).await;
            match chunk_result {
                Err(_) => return Err("Download stalled (60s idle timeout)".to_string()),
                Ok(None) => break, // Stream complete
                Ok(Some(Err(e))) => return Err(e.to_string()),
                Ok(Some(Ok(chunk))) => {
                    part_bytes_done += chunk.len() as u64;
                    let overall_bytes = bytes_before + part_bytes_done;

                    // Update in-memory state
                    {
                        let mut entries = self.entries.lock().await;
                        if let Some(e) = entries.get_mut(id) {
                            e.bytes_done = overall_bytes;
                            e.updated_at = now_str();
                        }
                    }

                    let percent = if grand_total > 0 {
                        (overall_bytes as f64 / grand_total as f64 * 100.0).min(100.0)
                    } else if part_total_bytes > 0 {
                        (part_bytes_done as f64 / part_total_bytes as f64 * 100.0).min(100.0)
                    } else {
                        0.0
                    };

                    let elapsed = start.elapsed().as_secs_f64();
                    let speed_bps = if elapsed > 0.0 { overall_bytes as f64 / elapsed } else { 0.0 };
                    let remaining = if grand_total > overall_bytes { grand_total - overall_bytes } else { 0 };
                    let eta = if speed_bps > 0.0 && remaining > 0 {
                        Some(remaining as f64 / speed_bps)
                    } else {
                        None
                    };

                    // Emit Tauri event on every ~512 KB
                    let ev = DownloadProgressEvent {
                        id: id.to_string(),
                        category: category.to_string(),
                        filename: filename.to_string(),
                        display_name: display_name.to_string(),
                        status: "active".to_string(),
                        bytes_done: overall_bytes,
                        total_bytes: grand_total,
                        percent,
                        part_current: part_num,
                        part_total,
                        speed_bps,
                        eta_seconds: eta,
                        error_msg: None,
                    };
                    let _ = app.emit("dm-progress", &ev);

                    // Legacy alias for LLM downloads (existing use-llm.ts listener)
                    if category == "llm" {
                        let _ = app.emit("llm-download-progress", serde_json::json!({
                            "filename": filename,
                            "part": part_num,
                            "total_parts": part_total,
                            "part_bytes_downloaded": part_bytes_done,
                            "part_total_bytes": part_total_bytes,
                            "bytes_downloaded": overall_bytes,
                            "total_bytes": grand_total,
                            "percent": percent,
                            "status": "downloading",
                        }));
                    }
                    // Legacy alias for Whisper downloads
                    if category == "whisper" {
                        let _ = app.emit("whisper-download-progress", serde_json::json!({
                            "filename": filename,
                            "bytes_downloaded": overall_bytes,
                            "total_bytes": grand_total,
                            "percent": percent as f32,
                        }));
                    }

                    // Persist progress to DB every ~5s (not every chunk to avoid thrashing)
                    if last_db_update.elapsed() > Duration::from_secs(5) {
                        let _ = db_update_progress(&self.db_path, id, overall_bytes, grand_total, part_num);
                        last_db_update = std::time::Instant::now();
                    }
                }
            }
        }

        // Final DB progress write
        let overall = bytes_before + part_bytes_done;
        let _ = db_update_progress(&self.db_path, id, overall, grand_total, part_num);

        Ok(part_bytes_done)
    }

    async fn mark_cancelled(&self, app: &AppHandle, id: &str) {
        let entry_clone = {
            let mut entries = self.entries.lock().await;
            let Some(e) = entries.get_mut(id) else { return };
            if matches!(e.status, DownloadStatus::Active | DownloadStatus::Queued) {
                e.status = DownloadStatus::Cancelled;
                e.updated_at = now_str();
            }
            e.clone()
        };
        let _ = db_update_status(&self.db_path, id, "cancelled", None);
        let ev = build_event(&entry_clone, entry_clone.percent(), None);
        let _ = app.emit("dm-cancelled", &ev);
        let _ = app.emit("dm-progress", &ev);
        if entry_clone.category == "llm" {
            let _ = app.emit("llm-download-cancelled", serde_json::json!({"reason": "user_cancelled"}));
        }
    }

    async fn resume_incomplete(&self, app: AppHandle) {
        let rows = match db_load_incomplete(&self.db_path) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[downloads] resume_incomplete DB error: {}", e);
                return;
            }
        };

        for row in rows {
            let id = row.id.clone();

            // LLM and Whisper downloads use `register_external` — their actual
            // HTTP + file-writing logic lives in the Tauri commands
            // (`download_llm_model`, `download_whisper_model`), not in this
            // generic worker. The worker's `run_download` has no file output path
            // and would silently fail to write anything to disk.
            // Mark them as failed so the UI re-offers the download on next launch
            // instead of spinning forever in a "queued" state.
            if row.category == "llm" || row.category == "whisper" {
                eprintln!(
                    "[downloads] resume_incomplete: skipping '{}' (category='{}') — handled by dedicated command, not the generic worker. Marking as failed so UI re-offers the download.",
                    row.filename, row.category
                );
                let _ = db_update_status(&self.db_path, &id, "failed", Some("Interrupted: app was closed mid-download. Please re-download."));
                continue;
            }

            // Reset to queued for generic (Python-side) downloads
            let mut entry = row;
            entry.status = DownloadStatus::Queued;
            entry.bytes_done = 0;
            entry.part_current = 1;
            entry.updated_at = now_str();

            let _ = db_update_status(&self.db_path, &id, "queued", None);

            {
                let mut flags = self.cancel_flags.lock().await;
                flags.insert(id.clone(), Arc::new(AtomicBool::new(false)));
            }
            {
                let mut entries = self.entries.lock().await;
                entries.insert(id.clone(), entry.clone());
            }

            emit_progress(&app, &entry, 0.0, None);
            let _ = self.tx.send(WorkerMsg::Enqueue(id));
            eprintln!("[downloads] Resuming: {}", entry.filename);
        }
    }
}

// ── SQLite helpers ────────────────────────────────────────────────────────

fn db_path_default(app: &AppHandle) -> PathBuf {
    app.path()
        .home_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".matrx")
        .join("downloads.db")
}

fn init_db(path: &Path) -> rusqlite::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         PRAGMA synchronous=NORMAL;
         CREATE TABLE IF NOT EXISTS downloads (
             id           TEXT PRIMARY KEY,
             category     TEXT NOT NULL,
             filename     TEXT NOT NULL,
             display_name TEXT NOT NULL,
             urls         TEXT NOT NULL DEFAULT '[]',
             total_bytes  INTEGER NOT NULL DEFAULT 0,
             bytes_done   INTEGER NOT NULL DEFAULT 0,
             status       TEXT NOT NULL DEFAULT 'queued',
             error_msg    TEXT,
             priority     INTEGER NOT NULL DEFAULT 0,
             part_current INTEGER NOT NULL DEFAULT 1,
             part_total   INTEGER NOT NULL DEFAULT 1,
             created_at   TEXT NOT NULL,
             updated_at   TEXT NOT NULL,
             completed_at TEXT,
             metadata     TEXT
         );
         CREATE INDEX IF NOT EXISTS idx_dl_status ON downloads(status);
         CREATE INDEX IF NOT EXISTS idx_dl_category ON downloads(category);",
    )?;
    Ok(())
}

fn db_upsert(path: &Path, entry: &DownloadEntry, metadata: Option<String>) -> rusqlite::Result<()> {
    let conn = Connection::open(path)?;
    let urls_json = serde_json::to_string(&entry.urls).unwrap_or_default();
    conn.execute(
        "INSERT INTO downloads
             (id, category, filename, display_name, urls, total_bytes, bytes_done,
              status, error_msg, priority, part_current, part_total,
              created_at, updated_at, completed_at, metadata)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
         ON CONFLICT(id) DO UPDATE SET
             status=excluded.status, bytes_done=excluded.bytes_done,
             total_bytes=excluded.total_bytes, error_msg=excluded.error_msg,
             part_current=excluded.part_current, updated_at=excluded.updated_at,
             completed_at=excluded.completed_at, metadata=excluded.metadata",
        params![
            entry.id, entry.category, entry.filename, entry.display_name,
            urls_json, entry.total_bytes, entry.bytes_done,
            entry.status.as_str(), entry.error_msg, entry.priority,
            entry.part_current as i64, entry.part_total as i64,
            entry.created_at, entry.updated_at, entry.completed_at,
            metadata,
        ],
    )?;
    Ok(())
}

fn db_update_status(path: &Path, id: &str, status: &str, error_msg: Option<&str>) -> rusqlite::Result<()> {
    let conn = Connection::open(path)?;
    let now = now_str();
    let completed_at: Option<&str> = if status == "completed" { Some(&now) } else { None };
    conn.execute(
        "UPDATE downloads SET status=?1, error_msg=?2, updated_at=?3, completed_at=COALESCE(?4, completed_at) WHERE id=?5",
        params![status, error_msg, now, completed_at, id],
    )?;
    Ok(())
}

fn db_update_progress(path: &Path, id: &str, bytes_done: u64, total_bytes: u64, part_current: usize) -> rusqlite::Result<()> {
    let conn = Connection::open(path)?;
    conn.execute(
        "UPDATE downloads SET bytes_done=?1, total_bytes=?2, part_current=?3, updated_at=?4 WHERE id=?5",
        params![bytes_done as i64, total_bytes as i64, part_current as i64, now_str(), id],
    )?;
    Ok(())
}

fn db_load_incomplete(path: &Path) -> rusqlite::Result<Vec<DownloadEntry>> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let conn = Connection::open(path)?;
    let mut stmt = conn.prepare(
        "SELECT id, category, filename, display_name, urls, total_bytes, bytes_done,
                status, error_msg, priority, part_current, part_total,
                created_at, updated_at, completed_at
         FROM downloads
         WHERE status IN ('queued','active')
         ORDER BY priority DESC, created_at ASC",
    )?;

    let rows = stmt.query_map([], |row| {
        let urls_json: String = row.get(4)?;
        let urls: Vec<String> = serde_json::from_str(&urls_json).unwrap_or_default();
        Ok(DownloadEntry {
            id: row.get(0)?,
            category: row.get(1)?,
            filename: row.get(2)?,
            display_name: row.get(3)?,
            urls,
            total_bytes: row.get::<_, i64>(5)? as u64,
            bytes_done: row.get::<_, i64>(6)? as u64,
            status: DownloadStatus::Queued,
            error_msg: row.get(8)?,
            priority: row.get(9)?,
            part_current: row.get::<_, i64>(10)? as usize,
            part_total: row.get::<_, i64>(11)? as usize,
            created_at: row.get(12)?,
            updated_at: row.get(13)?,
            completed_at: row.get(14)?,
        })
    })?;

    let mut result = Vec::new();
    for row in rows {
        if let Ok(entry) = row {
            result.push(entry);
        }
    }
    Ok(result)
}

// ── Utility helpers ───────────────────────────────────────────────────────

fn now_str() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Format as ISO 8601 (simplified — seconds precision is fine for DB)
    let dt = chrono_from_epoch(secs);
    dt
}

fn chrono_from_epoch(secs: u64) -> String {
    // Minimal ISO 8601 without chrono dependency
    let s = secs;
    let minutes = s / 60;
    let hours = minutes / 60;
    let days = hours / 24;

    let sec = s % 60;
    let min = (minutes) % 60;
    let hr = hours % 24;

    // Days since 1970-01-01 to calendar date (Gregorian, simplified)
    let (y, mo, d) = days_to_ymd(days);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, d, hr, min, sec)
}

fn days_to_ymd(mut days: u64) -> (u64, u64, u64) {
    let mut year = 1970u64;
    loop {
        let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
        let days_in_year = if leap { 366 } else { 365 };
        if days < days_in_year {
            break;
        }
        days -= days_in_year;
        year += 1;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let months = [31u64, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month = 1u64;
    for &days_in_month in &months {
        if days < days_in_month {
            break;
        }
        days -= days_in_month;
        month += 1;
    }
    (year, month, days + 1)
}

fn emit_progress(app: &AppHandle, entry: &DownloadEntry, percent: f64, eta: Option<f64>) {
    let ev = build_event(entry, percent, eta);
    let _ = app.emit("dm-progress", &ev);
    if entry.status == DownloadStatus::Queued {
        let _ = app.emit("dm-queued", &ev);
    }
}

fn build_event(entry: &DownloadEntry, percent: f64, eta: Option<f64>) -> DownloadProgressEvent {
    DownloadProgressEvent {
        id: entry.id.clone(),
        category: entry.category.clone(),
        filename: entry.filename.clone(),
        display_name: entry.display_name.clone(),
        status: entry.status.as_str().to_string(),
        bytes_done: entry.bytes_done,
        total_bytes: entry.total_bytes,
        percent,
        part_current: entry.part_current,
        part_total: entry.part_total,
        speed_bps: 0.0,
        eta_seconds: eta,
        error_msg: entry.error_msg.clone(),
    }
}

fn emit_legacy_llm_progress(app: &AppHandle, filename: &str, total_parts: usize, bytes: u64, total: u64, pct: f64) {
    let _ = app.emit("llm-download-progress", serde_json::json!({
        "filename": filename,
        "part": total_parts,
        "total_parts": total_parts,
        "part_bytes_downloaded": bytes,
        "part_total_bytes": total,
        "bytes_downloaded": bytes,
        "total_bytes": total,
        "percent": pct,
        "status": "already_complete",
    }));
}

async fn probe_total_bytes(client: &reqwest::Client, urls: &[String], hf_token: Option<&str>) -> u64 {
    let mut total = 0u64;
    for url in urls {
        let mut req = client.head(url);
        if let Some(tok) = hf_token {
            req = req.header("Authorization", format!("Bearer {}", tok));
        }
        if let Ok(resp) = req.send().await {
            if let Some(cl) = resp.content_length() {
                total += cl;
            }
        }
    }
    total
}

fn get_hf_token_from_app(app: &AppHandle) -> Option<String> {
    // Try to read from app data dir llm.json (legacy) as fallback
    // The canonical token comes from the Python engine, but for Rust-side
    // downloads we use the llm.json token if available.
    let config_dir = app.path().app_data_dir().ok()?;
    let config_path = config_dir.join("llm.json");
    let content = std::fs::read_to_string(config_path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    json.get("hf_token")?.as_str().map(String::from)
}

/// Public accessor so lib.rs can get the db path for the manager constructor
pub fn default_db_path(app: &AppHandle) -> PathBuf {
    db_path_default(app)
}
