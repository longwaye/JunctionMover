// 选择迁移目标文件夹（系统原生对话框）

use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub(crate) async fn pick_target_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    // blocking_pick_folder 会阻塞线程，必须放到阻塞线程池，不能在 async 运行时线程上直接调
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("选择迁移目标文件夹（建议选择非 C 盘）")
            .blocking_pick_folder()
    })
    .await
    .map_err(|e| format!("选择对话框任务失败: {}", e))?;

    match picked {
        Some(file_path) => {
            let p = file_path
                .into_path()
                .map_err(|_| "无法解析所选文件夹路径".to_string())?;
            Ok(Some(p.to_string_lossy().to_string()))
        }
        None => Ok(None), // 用户取消
    }
}
