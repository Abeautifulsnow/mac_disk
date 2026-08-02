mod commands;
mod index;
mod scanner;

use commands::ScanManager;
use index::ScanIndexManager;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ScanManager::new())
        .manage(ScanIndexManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::scan_directory_with_progress,
            commands::cancel_scan,
            commands::delete_path,
            commands::delete_paths,
            commands::show_in_finder,
            commands::query_flat_files,
            commands::query_subtree,
            commands::query_dir_size,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
