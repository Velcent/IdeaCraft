mod commands;
mod db;
mod markdown;

use db::Db;
use serde_json::json;
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("IdeaCraft data directory");
            std::fs::create_dir_all(&data_dir).ok();
            let mut conn = db::open(&data_dir.join("ideacraft.db"))?;
            db::seed_if_empty(&mut conn)?;

            if let Some(window) = app.get_webview_window("main") {
                use rusqlite::OptionalExtension;
                let saved: Option<String> = conn
                    .query_row(
                        "SELECT value FROM settings WHERE key='windowState'",
                        [],
                        |r| r.get::<_, String>(0),
                    )
                    .optional()
                    .unwrap_or(None);
                if let Some(state) = saved {
                    if !state.is_empty() {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&state) {
                            if let (Some(w), Some(h)) = (
                                v.get("width").and_then(|x| x.as_u64()),
                                v.get("height").and_then(|x| x.as_u64()),
                            ) {
                                if w >= 760 && h >= 520 {
                                    let _ = window.set_size(tauri::PhysicalSize::new(w as u32, h as u32));
                                }
                            }
                            if let (Some(x), Some(y)) = (
                                v.get("x").and_then(|x| x.as_i64()),
                                v.get("y").and_then(|x| x.as_i64()),
                            ) {
                                if x > -10000 && y > -10000 {
                                    let _ = window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                                }
                            }
                            if v.get("maximized").and_then(|x| x.as_bool()).unwrap_or(false) {
                                let _ = window.maximize();
                            }
                        }
                    }
                }
                let _ = window.show();
                let _ = window.set_focus();
            }

            app.manage(Db(Mutex::new(conn)));

            let open = MenuItemBuilder::with_id("open", "Open IdeaCraft").build(app)?;
            let new_page = MenuItemBuilder::with_id("new_page", "New Page").build(app)?;
            let settings = MenuItemBuilder::with_id("settings", "Settings…").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit IdeaCraft").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&open)
                .item(&new_page)
                .separator()
                .item(&settings)
                .separator()
                .item(&quit)
                .build()?;

            let mut tray = TrayIconBuilder::with_id("ideacraft-tray")
                .tooltip("IdeaCraft")
                .menu(&menu)
                .show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, event| match event.id().as_ref() {
                "open" => show_main(app),
                "new_page" => {
                    show_main(app);
                    let _ = app.emit("tray-new-page", ());
                }
                "settings" => {
                    show_main(app);
                    let _ = app.emit("open-settings", ());
                }
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    show_main(tray.app_handle());
                }
            })
            .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let keep = window
                    .app_handle()
                    .state::<Db>()
                    .0
                    .lock()
                    .ok()
                    .and_then(|conn| {
                        db::get_setting(&conn, "keepInBackground")
                            .and_then(|v| v.as_bool())
                    })
                    .unwrap_or(false);
                if keep {
                    api.prevent_close();
                    let _ = window.hide();
                } else if let Some(state) = window.app_handle().try_state::<Db>() {
                    if let Ok(conn) = state.0.lock() {
                        let size = window.inner_size().ok();
                        let pos = window.outer_position().ok();
                        if let Some(s) = size {
                            let _ = db::set_setting(
                                &conn,
                                "windowState",
                                &json!({
                                    "width": s.width,
                                    "height": s.height,
                                    "x": pos.map(|p| p.x),
                                    "y": pos.map(|p| p.y),
                                    "maximized": window.is_maximized().unwrap_or(false)
                                }),
                            );
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::get_sidebar,
            commands::get_page_detail,
            commands::get_home,
            commands::visit_page,
            commands::create_page,
            commands::update_page,
            commands::save_blocks,
            commands::move_page,
            commands::trash_page,
            commands::restore_page,
            commands::delete_page_forever,
            commands::get_trash,
            commands::search,
            commands::get_templates,
            commands::create_from_template,
            commands::duplicate_page,
            commands::get_versions_cmd,
            commands::restore_version,
            commands::save_workspace,
            commands::get_settings,
            commands::set_setting_cmd,
            commands::set_settings,
            commands::create_comment,
            commands::resolve_comment,
            commands::delete_comment,
            commands::get_database,
            commands::update_database,
            commands::create_row,
            commands::update_row,
            commands::delete_row,
            commands::restore_row,
            commands::export_markdown,
            commands::export_html,
            commands::export_backup,
            commands::import_markdown,
            commands::import_backup,
            commands::pick_image,
            commands::copy_text,
            commands::open_url,
            commands::open_data_folder,
            commands::app_info,
            commands::window_action,
            commands::window_state,
            commands::save_window_state,
            commands::pick_sync_folder,
            commands::sync_now,
            commands::ai_status,
            commands::ai_complete,
            commands::check_updates,
            commands::install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running IdeaCraft");
}
