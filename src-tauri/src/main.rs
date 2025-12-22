// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Tauri desktop entrypoint.
//
// Keep this file minimal:
// - It exists mainly to set Windows subsystem flags (release builds) and forward to the real app builder.
// - All plugin wiring and app setup lives in `src-tauri/src/lib.rs`.

fn main() {
    app_lib::run();
}
