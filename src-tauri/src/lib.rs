use std::collections::BTreeSet;
use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};

static SYSTEM_FONT_DB: OnceLock<Mutex<fontdb::Database>> = OnceLock::new();

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[tauri::command]
    fn get_system_username() -> Option<String> {
        whoami::username().map(|name| name.trim().to_string()).ok()
    }

    #[tauri::command]
    fn get_system_font_bytes(
        families: Vec<String>,
        generic: Option<String>,
    ) -> Option<Vec<u8>> {
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
        let data = db_guard.with_face_data(id, |font_data, _face_index| {
            font_data.to_vec()
        })?;

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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    // Desktop-only: CLI plugin is not available on mobile targets.
    let builder = builder.plugin(tauri_plugin_cli::init());

    builder
        .invoke_handler(tauri::generate_handler![
            get_system_username,
            get_system_font_bytes,
            list_system_font_families
            ,
            list_system_font_aliases_compact
        ])
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
