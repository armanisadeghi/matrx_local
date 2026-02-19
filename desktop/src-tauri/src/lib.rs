use serde::Serialize;
use std::sync::Mutex;
use tauri::Manager;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_shell::ShellExt;

/// Holds the sidecar child process handle for lifecycle management.
struct SidecarState {
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
}

#[derive(Serialize)]
struct SidecarStatus {
    running: bool,
    port: u16,
}

/// Start the Python/FastAPI engine sidecar.
///
/// In production, this spawns the bundled PyInstaller binary.
/// The sidecar listens on the configured port (default 22140).
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
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?;

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

/// Set up the system tray icon and menu.
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

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("AI Matrx Desktop")
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
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
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(SidecarState {
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            start_sidecar,
            stop_sidecar,
            sidecar_status,
        ])
        .setup(|app| {
            // Set up system tray
            if let Err(e) = setup_tray(app) {
                eprintln!("Failed to setup tray: {}", e);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Hide instead of close — keep running in system tray
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
