use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;

// ── proxy_fetch types ────────────────────────────────────────────────────────
#[derive(Serialize)]
struct FetchResponse {
    status: u16,
    content_type: String,
    body_b64: String,  // base64-encoded body
    final_url: String,
}

/// Holds the sidecar child process handle for lifecycle management.
struct SidecarState {
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
}

/// Controls whether window close hides to tray or quits the app.
struct CloseToTray(AtomicBool);

/// Holds a pending OAuth deep-link URL that arrived before the frontend
/// mounted its listener. The frontend polls this via get_pending_oauth_url
/// and clears it after consuming.
struct PendingOAuthUrl(Mutex<Option<String>>);

#[derive(Serialize)]
struct SidecarStatus {
    running: bool,
    port: u16,
}

/// Start the Python/FastAPI engine sidecar.
///
/// In production, this spawns the bundled PyInstaller binary.
/// The sidecar listens on the configured port (default 22140).
/// We set TAURI_SIDECAR=1 so that run.py skips the pystray tray icon —
/// Tauri already owns the single system-tray icon for the whole app.
#[tauri::command]
async fn start_sidecar(
    app: tauri::AppHandle,
    state: tauri::State<'_, SidecarState>,
) -> Result<(), String> {
    // Check if already running
    if state.child.lock().unwrap().is_some() {
        return Ok(());
    }

    let sidecar = app
        .shell()
        .sidecar("aimatrx-engine")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        // Signal to run.py that it is running inside Tauri — suppress pystray tray icon.
        .env("TAURI_SIDECAR", "1");

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    *state.child.lock().unwrap() = Some(child);

    // Forward sidecar output to Tauri logs
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    println!("[engine] {}", text);
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    eprintln!("[engine] {}", text);
                }
                CommandEvent::Terminated(status) => {
                    eprintln!("[engine] Process terminated: {:?}", status);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Stop the Python/FastAPI engine sidecar.
#[tauri::command]
async fn stop_sidecar(state: tauri::State<'_, SidecarState>) -> Result<(), String> {
    if let Some(child) = state.child.lock().unwrap().take() {
        child
            .kill()
            .map_err(|e| format!("Failed to kill sidecar: {}", e))?;
    }
    Ok(())
}

/// Get sidecar status.
#[tauri::command]
async fn sidecar_status(state: tauri::State<'_, SidecarState>) -> Result<SidecarStatus, String> {
    let running = state.child.lock().unwrap().is_some();
    Ok(SidecarStatus {
        running,
        port: 22140,
    })
}

/// Set whether closing the window hides to tray or quits the app.
#[tauri::command]
async fn set_close_to_tray(
    enabled: bool,
    state: tauri::State<'_, CloseToTray>,
) -> Result<(), String> {
    state.0.store(enabled, Ordering::Relaxed);
    Ok(())
}

/// Get current close-to-tray setting.
#[tauri::command]
async fn get_close_to_tray(state: tauri::State<'_, CloseToTray>) -> Result<bool, String> {
    Ok(state.0.load(Ordering::Relaxed))
}

/// Fetch a URL from Rust (bypasses all browser security restrictions).
/// Returns base64-encoded body + headers so the frontend can display it.
#[tauri::command]
async fn proxy_fetch(url: String) -> Result<FetchResponse, String> {
    use base64::Engine;

    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        )
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let final_url = resp.url().to_string();
    let status = resp.status().as_u16();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("text/html")
        .to_string();

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let body_b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    Ok(FetchResponse {
        status,
        content_type,
        body_b64,
        final_url,
    })
}

#[derive(Clone, Serialize)]
struct UpdateProgress {
    status: String,
    version: Option<String>,
    body: Option<String>,
    content_length: Option<u64>,
    downloaded: u64,
}

/// Check for app updates and optionally install them.
#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle, install: bool) -> Result<UpdateProgress, String> {
    let updater = app.updater().map_err(|e| format!("Updater not available: {}", e))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("Update check failed: {}", e))?;

    match update {
        Some(update) => {
            let version = update.version.clone();
            let body = update.body.clone();

            if install {
                let app_handle = app.clone();
                let ver = version.clone();

                // Download and install
                update
                    .download_and_install(
                        |chunk_length, content_length| {
                            let _ = app_handle.emit(
                                "update-progress",
                                UpdateProgress {
                                    status: "downloading".to_string(),
                                    version: Some(ver.clone()),
                                    body: None,
                                    content_length,
                                    downloaded: chunk_length as u64,
                                },
                            );
                        },
                        || {
                            let _ = app_handle.emit(
                                "update-progress",
                                UpdateProgress {
                                    status: "installed".to_string(),
                                    version: Some(ver.clone()),
                                    body: None,
                                    content_length: None,
                                    downloaded: 0,
                                },
                            );
                        },
                    )
                    .await
                    .map_err(|e| format!("Update install failed: {}", e))?;

                Ok(UpdateProgress {
                    status: "installed".to_string(),
                    version: Some(version),
                    body,
                    content_length: None,
                    downloaded: 0,
                })
            } else {
                Ok(UpdateProgress {
                    status: "available".to_string(),
                    version: Some(version),
                    body,
                    content_length: None,
                    downloaded: 0,
                })
            }
        }
        None => Ok(UpdateProgress {
            status: "up_to_date".to_string(),
            version: None,
            body: None,
            content_length: None,
            downloaded: 0,
        }),
    }
}

/// Return the pending OAuth deep-link URL (if one arrived before the frontend
/// listener was ready) and clear it from state. Returns null if none pending.
#[tauri::command]
fn get_pending_oauth_url(state: tauri::State<'_, PendingOAuthUrl>) -> Option<String> {
    state.0.lock().unwrap().take()
}

/// Bring the main window to front.
///
/// On macOS, `window.show()` alone is not enough when the app has been hidden
/// via `window.hide()` — the app process may not be the frontmost application,
/// so the window appears but receives no focus. We must call both `show()` and
/// `set_focus()`, and additionally `unminimize()` in case the window was
/// minimized into the Dock rather than hidden.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Set up the system tray icon and menu.
///
/// Only ONE tray icon is created here — the auto-trayIcon in tauri.conf.json
/// has been removed to prevent a second blank icon from appearing.
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::with_id("show", "Show AI Matrx").build(app)?;
    let status =
        MenuItemBuilder::with_id("status", "Status: Starting...").enabled(false).build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit AI Matrx").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show)
        .separator()
        .item(&status)
        .separator()
        .item(&quit)
        .build()?;

    // Use the application's default window icon for the tray.
    // `app.default_window_icon()` returns the icon configured by the Tauri build system
    // (from the icon list in tauri.conf.json), so the tray icon always matches the
    // dock / taskbar icon without any runtime file path resolution.
    let tray_builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("AI Matrx")
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => {
                show_main_window(app);
            }
            "quit" => {
                // Kill the sidecar before quitting
                let state = app.state::<SidecarState>();
                if let Some(child) = state.child.lock().unwrap().take() {
                    let _ = child.kill();
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    let _tray = if let Some(icon) = app.default_window_icon() {
        tray_builder.icon(icon.clone()).build(app)?
    } else {
        tray_builder.build(app)?
    };

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(SidecarState {
            child: Mutex::new(None),
        })
        .manage(CloseToTray(AtomicBool::new(true)))
        .manage(PendingOAuthUrl(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            start_sidecar,
            stop_sidecar,
            sidecar_status,
            set_close_to_tray,
            get_close_to_tray,
            check_for_updates,
            proxy_fetch,
            get_pending_oauth_url,
        ])
        .setup(|app| {
            // Register the deep-link listener for OAuth callbacks.
            // When Supabase redirects to aimatrx://auth/callback?..., the OS fires this handler.
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls = event.urls();
                if let Some(url) = urls.first() {
                    let url_str = url.to_string();
                    println!("[deep-link] Received URL: {}", url_str);

                    // Bring the window to front
                    show_main_window(&handle);

                    // Store in app state — OAuthPending.tsx will poll this via
                    // get_pending_oauth_url() in case it wasn't mounted yet when
                    // the event fired (race condition on app activation).
                    if let Some(state) = handle.try_state::<PendingOAuthUrl>() {
                        *state.0.lock().unwrap() = Some(url_str.clone());
                    }

                    // Also emit the event for the case where OAuthPending IS
                    // already mounted and listening — whichever wins, the other
                    // is ignored via the handled.current guard.
                    let _ = handle.emit("oauth-callback", url_str);
                }
            });

            // Set up ONE system tray icon for the whole application.
            // The trayIcon declaration in tauri.conf.json has been removed to prevent
            // a second blank icon from appearing alongside this one.
            if let Err(e) = setup_tray(app) {
                eprintln!("Failed to setup tray: {}", e);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let close_to_tray = window
                    .app_handle()
                    .try_state::<CloseToTray>()
                    .map(|s| s.0.load(Ordering::Relaxed))
                    .unwrap_or(true);

                if close_to_tray {
                    // Hide the window instead of closing — the Python sidecar keeps running
                    // in the background (accessible via the system tray icon).
                    // We do NOT kill the sidecar — it serves as the "server" half and must
                    // stay alive for background jobs and cloud connectivity.
                    // The Webview/frontend (npm-side) is effectively paused by the OS when
                    // the window is hidden; no explicit kill is needed for the UI half.
                    let _ = window.hide();
                    api.prevent_close();
                } else {
                    // User explicitly chose "Quit" — kill sidecar before exit.
                    if let Some(state) = window.app_handle().try_state::<SidecarState>() {
                        if let Some(child) = state.child.lock().unwrap().take() {
                            let _ = child.kill();
                        }
                    }
                    // Fall through: window closes normally, app exits when last window closes.
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // On macOS, clicking the Dock icon when all windows are hidden fires
            // RunEvent::Reopen. Without this handler the click does nothing — the
            // app stays invisible. We re-show the main window here so the standard
            // Mac UX (click Dock icon → app comes back) works as expected.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    show_main_window(app);
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
