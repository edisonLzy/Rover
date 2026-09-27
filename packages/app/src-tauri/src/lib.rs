pub mod sidecar;

use std::sync::{Arc, Mutex};
use sidecar::{NodeSidecarManager, RuntimeConnectionInfo};
use tauri::State;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sidecar_state = Arc::new(Mutex::new(None));
    let sidecar_for_setup = sidecar_state.clone();
    let sidecar_for_exit = sidecar_state.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            sidecar: sidecar_state,
        })
        .invoke_handler(tauri::generate_handler![get_runtime_connection])
        .setup(move |_app| {
            println!("[Rover] Starting Node runtime sidecar during app setup...");
            match NodeSidecarManager::start(None, None) {
                Ok(manager) => {
                    if let Ok(mut guard) = sidecar_for_setup.lock() {
                        *guard = Some(manager);
                    }
                }
                Err(err) => {
                    eprintln!("[Rover] Failed to launch Node runtime sidecar: {}", err);
                }
            }
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
