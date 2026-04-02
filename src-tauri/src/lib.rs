use std::collections::BTreeMap;
use std::collections::BTreeSet;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::Emitter;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::Manager;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_cli::CliExt;

static SYSTEM_FONT_DB: OnceLock<Mutex<fontdb::Database>> = OnceLock::new();
#[cfg(not(any(target_os = "android", target_os = "ios")))]
static SECONDARY_WINDOW_COUNTER: AtomicU64 = AtomicU64::new(1);
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const FOCUS_DOCUMENT_REQUEST_EVENT: &str = "ff://platform-focus-document-request";

#[derive(Default)]
struct WindowDocumentRegistry {
    source_key_to_window: BTreeMap<String, String>,
    window_to_source_keys: BTreeMap<String, BTreeSet<String>>,
}

impl WindowDocumentRegistry {
    fn replace_window_documents(&mut self, window_label: &str, source_keys: Vec<String>) {
        self.remove_window(window_label);

        let normalized_source_keys: BTreeSet<String> = source_keys
            .into_iter()
            .map(|source_key| source_key.trim().to_string())
            .filter(|source_key| !source_key.is_empty())
            .collect();

        if normalized_source_keys.is_empty() {
            return;
        }

        for source_key in normalized_source_keys.iter() {
            self.source_key_to_window
                .insert(source_key.clone(), window_label.to_string());
        }

        self.window_to_source_keys
            .insert(window_label.to_string(), normalized_source_keys);
    }

    fn remove_window(&mut self, window_label: &str) {
        let Some(previous_source_keys) = self.window_to_source_keys.remove(window_label) else {
            return;
        };

        for source_key in previous_source_keys {
            let should_remove = self
                .source_key_to_window
                .get(&source_key)
                .map(|owner| owner == window_label)
                .unwrap_or(false);

            if should_remove {
                self.source_key_to_window.remove(&source_key);
            }
        }
    }

    fn find_window_for_source_key(&self, source_key: &str) -> Option<String> {
        self.source_key_to_window.get(source_key).cloned()
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FocusDocumentRequestPayload {
    source_key: String,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn normalize_cli_source_value(source: &Value) -> Option<String> {
    match source {
        Value::String(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Array(values) => values
            .iter()
            .find_map(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        _ => None,
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn get_startup_open_document_path<R: tauri::Runtime>(app: &tauri::App<R>) -> Option<String> {
    let matches = app.cli().matches().ok()?;
    let source = matches.args.get("source")?;

    normalize_cli_source_value(&source.value)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn get_startup_open_document_path<R: tauri::Runtime>(_app: &tauri::App<R>) -> Option<String> {
    None
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn get_secondary_instance_open_document_path<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    args: Vec<String>,
) -> Option<String> {
    let matches = app.cli().matches_from(args).ok()?;
    let source = matches.args.get("source")?;
    normalize_cli_source_value(&source.value)
}

fn build_startup_init_script(startup_open_document_path: Option<String>) -> String {
    let payload = startup_open_document_path.map(|file_path| {
        json!({
            "kind": "startup-open",
            "filePath": file_path,
        })
    });

    let serialized_payload =
        serde_json::to_string(&payload).expect("failed to serialize startup payload");

    format!(
        r#"
const __FORMFORGE_WINDOW_BOOTSTRAP__ = {serialized_payload};
Object.defineProperty(window, "__FORMFORGE_WINDOW_BOOTSTRAP__", {{
  configurable: false,
  enumerable: false,
  writable: false,
  value: __FORMFORGE_WINDOW_BOOTSTRAP__ && typeof __FORMFORGE_WINDOW_BOOTSTRAP__ === "object"
    ? Object.freeze(__FORMFORGE_WINDOW_BOOTSTRAP__)
    : __FORMFORGE_WINDOW_BOOTSTRAP__
}});
"#
    )
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn create_secondary_window_label() -> String {
    let counter = SECONDARY_WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    format!("editor_{timestamp}_{counter:x}")
}

fn create_configured_window<R: tauri::Runtime, M: Manager<R>>(
    manager: &M,
    label: &str,
    startup_open_document_path: Option<String>,
) -> tauri::Result<()> {
    let Some(mut window_config) = manager.config().app.windows.first().cloned() else {
        return Ok(());
    };

    window_config.label = label.to_string();
    window_config.create = false;
    let startup_init_script = build_startup_init_script(startup_open_document_path);

    let builder = tauri::WebviewWindowBuilder::from_config(manager, &window_config)?
        .initialization_script(startup_init_script);

    #[cfg(target_os = "windows")]
    let builder = builder.disable_drag_drop_handler();

    builder.build()?;

    Ok(())
}

fn create_main_window<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    create_configured_window(app, "main", get_startup_open_document_path(app))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn create_secondary_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    startup_open_document_path: Option<String>,
) -> tauri::Result<()> {
    let label = create_secondary_window_label();
    create_configured_window(app, &label, startup_open_document_path)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn focus_existing_document_by_source_key<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    registry: &Mutex<WindowDocumentRegistry>,
    source_key: &str,
) -> Result<bool, String> {
    let target_window_label = {
        let registry = registry
            .lock()
            .map_err(|_| "window document registry lock poisoned".to_string())?;
        registry.find_window_for_source_key(source_key)
    };

    let Some(target_window_label) = target_window_label else {
        return Ok(false);
    };

    let Some(target_window) = app.get_webview_window(&target_window_label) else {
        let mut registry = registry
            .lock()
            .map_err(|_| "window document registry lock poisoned".to_string())?;
        registry.remove_window(&target_window_label);
        return Ok(false);
    };

    target_window.set_focus().map_err(|error| error.to_string())?;
    target_window.emit(
        FOCUS_DOCUMENT_REQUEST_EVENT,
        FocusDocumentRequestPayload {
            source_key: source_key.to_string(),
        },
    ).map_err(|error| error.to_string())?;

    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[tauri::command]
    fn report_platform_window_documents<R: tauri::Runtime>(
        window: tauri::Window<R>,
        registry: tauri::State<'_, Mutex<WindowDocumentRegistry>>,
        source_keys: Vec<String>,
    ) -> Result<(), String> {
        let mut registry = registry
            .lock()
            .map_err(|_| "window document registry lock poisoned".to_string())?;
        registry.replace_window_documents(window.label(), source_keys);
        Ok(())
    }

    #[tauri::command]
    fn focus_existing_platform_document<R: tauri::Runtime>(
        window: tauri::Window<R>,
        app: tauri::AppHandle<R>,
        registry: tauri::State<'_, Mutex<WindowDocumentRegistry>>,
        source_key: String,
    ) -> Result<bool, String> {
        let normalized_source_key = source_key.trim().to_string();
        if normalized_source_key.is_empty() {
            return Ok(false);
        }

        {
            let registry = registry
                .lock()
                .map_err(|_| "window document registry lock poisoned".to_string())?;
            if registry
                .find_window_for_source_key(&normalized_source_key)
                .as_deref()
                == Some(window.label())
            {
                return Ok(false);
            }
        }

        focus_existing_document_by_source_key(&app, registry.inner(), &normalized_source_key)
            .map_err(|error| error.to_string())
    }

    #[tauri::command]
    fn get_system_username() -> Option<String> {
        whoami::username().map(|name| name.trim().to_string()).ok()
    }

    #[tauri::command]
    fn get_system_font_bytes(families: Vec<String>, generic: Option<String>) -> Option<Vec<u8>> {
        let db_lock = SYSTEM_FONT_DB.get_or_init(|| {
            let mut db = fontdb::Database::new();
            db.load_system_fonts();
            Mutex::new(db)
        });

        let db_result = db_lock.lock();
        let db_guard = match db_result {
            Ok(g) => g,
            Err(_) => return None,
        };

        let mut family_query: Vec<fontdb::Family<'_>> = Vec::new();
        for f in families.iter() {
            let name = f.trim();
            if name.is_empty() {
                continue;
            }
            family_query.push(fontdb::Family::Name(name));
        }

        let generic_value = generic.as_deref().unwrap_or("");
        if generic_value.eq_ignore_ascii_case("serif") {
            family_query.push(fontdb::Family::Serif);
        } else if generic_value.eq_ignore_ascii_case("sans-serif") {
            family_query.push(fontdb::Family::SansSerif);
        }

        if family_query.is_empty() {
            return None;
        }

        let q = fontdb::Query {
            families: &family_query,
            ..Default::default()
        };

        let id = db_guard.query(&q)?;
        let data = db_guard.with_face_data(id, |font_data, _face_index| font_data.to_vec())?;

        Some(data)
    }

    #[tauri::command]
    fn list_system_font_families() -> Vec<String> {
        let db_lock = SYSTEM_FONT_DB.get_or_init(|| {
            let mut db = fontdb::Database::new();
            db.load_system_fonts();
            Mutex::new(db)
        });

        let db_result = db_lock.lock();
        let db_guard = match db_result {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };

        let mut set: BTreeSet<String> = BTreeSet::new();
        for face in db_guard.faces() {
            for (family, _lang) in face.families.iter() {
                let name = family.trim();
                if name.is_empty() {
                    continue;
                }
                set.insert(name.to_string());
            }
        }

        set.into_iter().collect()
    }

    fn compact_ascii_alnum_upper(s: &str) -> String {
        s.chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .map(|c| c.to_ascii_uppercase())
            .collect()
    }

    #[tauri::command]
    fn list_system_font_aliases_compact() -> BTreeMap<String, String> {
        let db_lock = SYSTEM_FONT_DB.get_or_init(|| {
            let mut db = fontdb::Database::new();
            db.load_system_fonts();
            Mutex::new(db)
        });

        let db_result = db_lock.lock();
        let db_guard = match db_result {
            Ok(g) => g,
            Err(_) => return BTreeMap::new(),
        };

        let mut map: BTreeMap<String, String> = BTreeMap::new();

        for face in db_guard.faces() {
            let family = match face.families.first() {
                Some((f, _lang)) => f.trim(),
                None => "",
            };
            if family.is_empty() {
                continue;
            }

            // Map PostScript aliases back to the family name.
            let ps = face.post_script_name.trim();
            if !ps.is_empty() {
                let k = compact_ascii_alnum_upper(ps);
                if !k.is_empty() {
                    map.entry(k).or_insert_with(|| family.to_string());
                }
            }

            // Also index family names themselves as aliases.
            for (fam, _lang) in face.families.iter() {
                let fam_trimmed = fam.trim();
                if fam_trimmed.is_empty() {
                    continue;
                }
                let k = compact_ascii_alnum_upper(fam_trimmed);
                if !k.is_empty() {
                    map.entry(k).or_insert_with(|| family.to_string());
                }
            }
        }

        map
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
        .manage(Mutex::new(WindowDocumentRegistry::default()))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    // Desktop-only: CLI plugin is not available on mobile targets.
    let builder = builder.plugin(tauri_plugin_cli::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let single_instance_builder =
        tauri_plugin_single_instance::Builder::new().callback(|app, argv, _cwd| {
            let startup_open_document_path = get_secondary_instance_open_document_path(app, argv);

            let result: Result<(), String> = if let Some(file_path) = startup_open_document_path {
                let source_key = format!("tauri:{file_path}");
                match focus_existing_document_by_source_key(
                    app,
                    app.state::<Mutex<WindowDocumentRegistry>>().inner(),
                    &source_key,
                ) {
                    Ok(true) => Ok(()),
                    Ok(false) => {
                        create_secondary_window(app, Some(file_path)).map_err(|error| error.to_string())
                    }
                    Err(error) => Err(error),
                }
            } else {
                create_secondary_window(app, None).map_err(|error| error.to_string())
            };

            if let Err(error) = result {
                log::error!("failed to create window for secondary launch: {error}");
            }
        });

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(single_instance_builder.build());

    builder
        .invoke_handler(tauri::generate_handler![
            report_platform_window_documents,
            focus_existing_platform_document,
            get_system_username,
            get_system_font_bytes,
            list_system_font_families,
            list_system_font_aliases_compact
        ])
        .on_window_event(|window, event| {
            if !matches!(event, tauri::WindowEvent::Destroyed) {
                return;
            }

            if let Ok(mut registry) = window.state::<Mutex<WindowDocumentRegistry>>().lock() {
                registry.remove_window(window.label());
            }
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                // Dev-only: enable Tauri log plugin for easier debugging.
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            create_main_window(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
