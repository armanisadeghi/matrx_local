//! floating_overlay — always-on-top transcript window commands.
//!
//! Provides two Tauri commands:
//!   `show_transcript_overlay` — creates (or shows) a small always-on-top,
//!                               decoration-free transparent window that sits
//!                               above all other apps and displays live
//!                               transcription text while the wake word is active.
//!
//!   `hide_transcript_overlay` — hides the overlay window.
//!
//! The overlay window renders the `overlay.html` page which is served from
//! Vite's SPA at the `/#/overlay` hash route.  Text is streamed into it via
//! Tauri's `emit_to("transcript-overlay", ...)` from Voice.tsx.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const OVERLAY_LABEL: &str = "transcript-overlay";
const OVERLAY_WIDTH: f64 = 480.0;
const OVERLAY_HEIGHT: f64 = 220.0;

/// Show (or create) the always-on-top transcript overlay window.
/// Positioned in the top-right corner of the primary monitor.
#[tauri::command]
pub async fn show_transcript_overlay(app: AppHandle) -> Result<(), String> {
    // If the window already exists, just show and focus it
    if let Some(win) = app.get_webview_window(OVERLAY_LABEL) {
        win.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Position in the top-right area.  We try to read the main window's current
    // monitor so the overlay appears on the same screen the user is working on.
    let (pos_x, pos_y) = if let Some(main_win) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = main_win.current_monitor() {
            let size = monitor.size();
            let pos = monitor.position();
            let scale = monitor.scale_factor();
            let x = pos.x as f64 + (size.width as f64 / scale) - OVERLAY_WIDTH - 20.0;
            let y = pos.y as f64 + 40.0;
            (x, y)
        } else {
            (100.0, 40.0)
        }
    } else {
        (100.0, 40.0)
    };

    // Build the overlay window — transparent, no decorations, always on top.
    // Uses the same Vite SPA, navigating to the /#/overlay hash route which
    // renders only the TranscriptOverlay component (no app chrome, no auth).
    WebviewWindowBuilder::new(
        &app,
        OVERLAY_LABEL,
        WebviewUrl::App("index.html#/overlay".into()),
    )
    .title("")
    .inner_size(OVERLAY_WIDTH, OVERLAY_HEIGHT)
    .position(pos_x, pos_y)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Hide (but keep alive) the transcript overlay window.
#[tauri::command]
pub async fn hide_transcript_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(OVERLAY_LABEL) {
        win.hide().map_err(|e| e.to_string())?;
    }
    // No error if window doesn't exist — it may not have been created yet
    Ok(())
}
