#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[tauri::command]
    fn get_system_username() -> Option<String> {
        whoami::username().map(|name| name.trim().to_string()).ok()
    }

    // Tauri app builder (desktop entry).
    //
    // Responsibilities:
    // - Register Tauri plugins used by the frontend (dialog/fs/cli/log)
    // - Provide a single place to evolve desktop-only capabilities
    //
    // Notes:
    // - The frontend uses `@tauri-apps/plugin-dialog` and `@tauri-apps/plugin-fs` via `src/services/fileOps.ts`.
    // - CLI arg parsing is enabled via `tauri-plugin-cli` and configured in `src-tauri/tauri.conf.json`.
    // - Permissions are controlled via `src-tauri/capabilities/*.json` (prefer tightening there, not in ad-hoc JS checks).
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    // Desktop-only: CLI plugin is not available on mobile targets.
    let builder = builder.plugin(tauri_plugin_cli::init());

    builder
        .invoke_handler(tauri::generate_handler![get_system_username])
        .setup(|app| {
            if cfg!(debug_assertions) {
                // Dev-only: enable Tauri log plugin for easier debugging.
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
