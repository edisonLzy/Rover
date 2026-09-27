pub mod sidecar;

use sidecar::{NodeSidecarManager, RuntimeConnectionInfo};
use std::sync::{Arc, Mutex};
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, State};

pub struct AppState {
    pub sidecar: Arc<Mutex<Option<NodeSidecarManager>>>,
}

#[tauri::command]
fn get_runtime_connection(state: State<'_, AppState>) -> Result<RuntimeConnectionInfo, String> {
    let sidecar_guard = state.sidecar.lock().map_err(|e| e.to_string())?;
    match &*sidecar_guard {
        Some(manager) => manager
            .connection_info()
            .cloned()
            .ok_or_else(|| "Sidecar is running but connection info is missing".to_string()),
        None => Err("Node runtime sidecar has not been started".to_string()),
    }
}

#[tauri::command]
fn restart_runtime(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<RuntimeConnectionInfo, String> {
    println!("[Rover] Restarting Node runtime sidecar...");
    let mut guard = state.sidecar.lock().map_err(|e| e.to_string())?;
    if let Some(mut old_manager) = guard.take() {
        old_manager.stop();
    }
    let new_manager = NodeSidecarManager::start(&app_handle, None, None)?;
    let conn = new_manager
        .connection_info()
        .cloned()
        .ok_or_else(|| "Missing connection info after restart".to_string())?;
    *guard = Some(new_manager);
    let _ = app_handle.emit("runtime_restarted", ());
    Ok(conn)
}

#[tauri::command]
fn show_window(app_handle: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window(&label) {
        window.show().map_err(|e| e.to_string())?;
        let _ = window.unminimize();
        window.set_focus().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err(format!("Window '{}' not found", label))
    }
}

#[tauri::command]
fn hide_window(app_handle: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window(&label) {
        window.hide().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err(format!("Window '{}' not found", label))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sidecar_state = Arc::new(Mutex::new(None));
    let sidecar_for_setup = sidecar_state.clone();
    let sidecar_for_tray = sidecar_state.clone();
    let sidecar_for_exit = sidecar_state.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            sidecar: sidecar_state,
        })
        .invoke_handler(tauri::generate_handler![
            get_runtime_connection,
            restart_runtime,
            show_window,
            hide_window
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Prevent window from closing/destroying; hide it instead
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(move |app| {
            println!("[Rover] Starting Node runtime sidecar during app setup...");
            match NodeSidecarManager::start(app.handle(), None, None) {
                Ok(manager) => {
                    if let Ok(mut guard) = sidecar_for_setup.lock() {
                        *guard = Some(manager);
                    }
                }
                Err(err) => {
                    eprintln!("[Rover] Failed to launch Node runtime sidecar: {}", err);
                }
            }

            // Configure System Tray
            let dashboard_item =
                MenuItemBuilder::with_id("open_dashboard", "打开 Dashboard").build(app)?;
            let restore_pet_item =
                MenuItemBuilder::with_id("restore_pet", "恢复宠物窗口").build(app)?;
            let restart_runtime_item =
                MenuItemBuilder::with_id("restart_runtime", "重启 Runtime").build(app)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出 Rover").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&dashboard_item)
                .item(&restore_pet_item)
                .item(&restart_runtime_item)
                .item(&separator)
                .item(&quit_item)
                .build()?;

            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray/icon.png"))?;

            let tray_builder = TrayIconBuilder::with_id("rover-tray")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .tooltip("Rover")
                .icon(tray_icon);

            let sidecar_tray_ref = sidecar_for_tray.clone();
            tray_builder
                .on_menu_event(move |app_handle, event| match event.id().as_ref() {
                    "open_dashboard" => {
                        if let Some(window) = app_handle.get_webview_window("dashboard") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "restore_pet" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "restart_runtime" => {
                        println!("[Rover] Restarting Node runtime sidecar from tray action...");
                        if let Ok(mut guard) = sidecar_tray_ref.lock() {
                            if let Some(mut old_manager) = guard.take() {
                                old_manager.stop();
                            }
                            match NodeSidecarManager::start(app_handle, None, None) {
                                Ok(new_manager) => {
                                    println!(
                                        "[Rover] Node runtime sidecar restarted successfully."
                                    );
                                    *guard = Some(new_manager);
                                    let _ = app_handle.emit("runtime_restarted", ());
                                }
                                Err(e) => {
                                    eprintln!(
                                        "[Rover] Failed to restart Node runtime sidecar: {}",
                                        e
                                    );
                                }
                            }
                        }
                    }
                    "quit" => {
                        println!("[Rover] Quit requested from tray menu.");
                        app_handle.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
            println!("[Rover] Tauri application exiting, terminating Node sidecar...");
            if let Ok(mut guard) = sidecar_for_exit.lock() {
                if let Some(mut manager) = guard.take() {
                    manager.stop();
                }
            }
        }
    });
}
