// JunctionMover：扫描 C 盘 AppData 大目录，经 robocopy 迁移到其他盘并用 Windows Junction
// 保持原路径透明；支持安全回滚。系统操作通过独立的隐藏 PowerShell 进程执行。

mod commands;
mod model;
mod pathutil;
mod ps;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::scan::scan_drives,
            commands::scan::scan_dirs,
            commands::scan::cancel_scan,
            commands::dialog::pick_target_folder,
            commands::shell::open_folder,
            commands::migrate::migrate_dir,
            commands::rollback::rollback_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
