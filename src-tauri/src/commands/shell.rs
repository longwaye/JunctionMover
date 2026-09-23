// 在系统资源管理器中打开指定文件夹

use std::path::Path;
use std::process::Command;

#[tauri::command]
pub(crate) fn open_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.is_absolute() {
        return Err("路径必须是绝对路径".to_string());
    }
    Command::new("explorer.exe")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("无法打开资源管理器: {}", e))?;
    Ok(())
}
