// PowerShell 执行层：所有 Windows 原生操作（robocopy / mklink /J / rmdir）都通过
// 临时 .ps1 文件以 powershell -File 跑独立进程完成，窗口隐藏。
// 不用 -EncodedCommand：脚本（含 Restart Manager 的 C# 代码）经 UTF-16LE Base64
// 膨胀后会超过 CreateProcess 约 32K 的命令行上限，-File 方式无此限制。

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::Emitter;

/// 用户主动取消时返回的错误标记，调用方据此与真实失败区分
pub(crate) const PS_CANCELLED: &str = "__ps_cancelled__";

/// 隐藏窗口标志（Windows）
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// 临时脚本文件：写入时带 UTF-8 BOM（PS 5.1 无 BOM 时按 ANSI/CP936 解析会乱码），
/// Drop 时自动删除，避免遗留。
struct TempScript {
    path: PathBuf,
}

impl TempScript {
    fn new(script: &str) -> Result<Self, String> {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
        let mut path = std::env::temp_dir();
        path.push(format!("jm_ps_{}_{}_{}.ps1", std::process::id(), nanos, seq));
        let mut f = std::fs::File::create(&path)
            .map_err(|e| format!("创建临时脚本失败: {}", e))?;
        f.write_all(&[0xEF, 0xBB, 0xBF]).map_err(|e| {
            format!("写入临时脚本失败: {}", e)
        })?;
        // PowerShell 5.1 对 LF-only 脚本的 here-string/块解析不可靠，
        // 统一规范化为 CRLF（脚本源码来自 Rust raw string，本身只有 LF）
        let normalized = script.replace("\r\n", "\n").replace('\n', "\r\n");
        f.write_all(normalized.as_bytes())
            .map_err(|e| format!("写入临时脚本失败: {}", e))?;
        Ok(Self { path })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempScript {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// 将 UTF-8 字符串编码为 PowerShell -EncodedCommand 所需的 UTF-16LE Base64
/// （当前执行走 -File 临时文件，保留供测试与潜在小脚本使用）
#[allow(dead_code)]
pub(crate) fn ps_encode(script: &str) -> String {
    use base64::Engine;
    let mut buf = Vec::new();
    for unit in script.encode_utf16() {
        buf.write_all(&unit.to_le_bytes()).unwrap();
    }
    base64::engine::general_purpose::STANDARD.encode(&buf)
}

/// 把字符串包装为 PowerShell 单引号字面量（单引号双写转义，防注入/防语法破坏）
pub(crate) fn ps_q(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

fn build_command(script_path: &Path) -> Command {
    let mut cmd = Command::new("powershell");
    // -File 必须在最后，其后只跟脚本路径（不传脚本参数）
    cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
    cmd.arg(script_path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// 执行 PowerShell 脚本，返回 stdout
pub(crate) fn run_ps(script: &str) -> Result<String, String> {
    let tmp = TempScript::new(script)?;
    let out = build_command(tmp.path())
        .output()
        .map_err(|e| format!("无法启动 PowerShell: {}", e))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(format!("PowerShell 执行失败: {}", stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// 执行 PowerShell 脚本，逐行读取 stdout：每行先交给 on_line 回调（解析进度），
/// PROGRESS| 行不进返回体，剩余行作为结果（JSON）返回。
pub(crate) fn run_ps_stream<F>(script: &str, on_line: F) -> Result<String, String>
where
    F: FnMut(&str),
{
    run_ps_stream_cancellable(script, on_line, None, None)
}

/// 可取消版本：pid_slot 用于登记子进程 PID 供外部 taskkill；
/// 进程被杀且 cancel 标志为 true 时返回 PS_CANCELLED 而非普通错误。
pub(crate) fn run_ps_stream_cancellable<F>(
    script: &str,
    mut on_line: F,
    cancel: Option<&AtomicBool>,
    pid_slot: Option<&Mutex<Option<u32>>>,
) -> Result<String, String>
where
    F: FnMut(&str),
{
    use std::sync::atomic::Ordering;

    // 临时脚本必须存活到子进程结束（Drop 时删除）
    let tmp = TempScript::new(script)?;
    let mut cmd = build_command(tmp.path());
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("无法启动 PowerShell: {}", e))?;
    if let Some(slot) = pid_slot {
        *slot.lock().unwrap() = Some(child.id());
    }

    // 必须按原始字节读行再 lossy 解码：脚本若漏设 UTF8 输出编码，中文会以 GBK
    // 字节进入管道，严格 UTF-8 的 lines() 会在第一个坏字节处永久终止迭代，
    // 导致后续所有输出（含最终 JSON）被整体丢弃。
    let mut reader = BufReader::new(child.stdout.take().expect("stdout 管道"));
    let mut body = String::new();
    let mut raw: Vec<u8> = Vec::new();
    loop {
        raw.clear();
        let n = reader
            .read_until(b'\n', &mut raw)
            .map_err(|e| format!("读取 PowerShell 输出失败: {}", e))?;
        if n == 0 {
            break;
        }
        let line = String::from_utf8_lossy(&raw);
        let line = line.trim_end_matches(['\r', '\n']);
        on_line(line);
        if !line.starts_with("PROGRESS|") {
            body.push_str(line);
            body.push('\n');
        }
    }

    let mut stderr = String::new();
    if let Some(err) = child.stderr.take() {
        let mut err_bytes = Vec::new();
        let _ = BufReader::new(err).read_to_end(&mut err_bytes);
        stderr = String::from_utf8_lossy(&err_bytes).into_owned();
    }

    let status = child
        .wait()
        .map_err(|e| format!("等待 PowerShell 失败: {}", e))?;
    if let Some(slot) = pid_slot {
        *slot.lock().unwrap() = None;
    }
    if !status.success() {
        if let Some(flag) = cancel {
            if flag.load(Ordering::SeqCst) {
                return Err(PS_CANCELLED.to_string());
            }
        }
        return Err(format!("PowerShell 执行失败: {}", stderr.trim()));
    }
    // 最终结果只认 JSON 行（{ 对象 / [ 数组），取最后一条。
    // 防止 robocopy 等子进程漏出的杂散文本（如 "Log File : ..."）污染解析。
    if let Some(line) = extract_json_line(&body) {
        return Ok(line.to_string());
    }
    let body_trimmed = body.trim();
    if body_trimmed.is_empty() {
        // 空输出视为空结果（如零目录扫描），由调用方解释
        return Ok(String::new());
    }
    let tail = stderr.trim();
    return Err(if !tail.is_empty() {
        format!("PowerShell 未返回有效结果，错误输出: {}", tail)
    } else {
        format!(
            "PowerShell 未返回有效结果，实际输出: {}",
            body_trimmed.chars().take(500).collect::<String>()
        )
    });
}

/// 从混合输出中提取最终 JSON 结果：跳过 PROGRESS 行和任何杂散文本，
/// 只认以 `{`/`[` 开头的行，多条时取最后一条。
pub(crate) fn extract_json_line(body: &str) -> Option<&str> {
    body.lines()
        .map(str::trim)
        .filter(|l| l.starts_with('{') || l.starts_with('['))
        .last()
}

/// 解析迁移/回滚脚本的进度行并推给前端。
/// 阶段行：      PROGRESS|<阶段文本>
/// 复制数值行：  PROGRESS|COPY|<百分比>|<已复制文件>|<总文件>|<已复制字节>|<总字节>
pub(crate) fn emit_copy_progress(app: &tauri::AppHandle, event: &str, path: &str, line: &str) {
    let Some(rest) = line.strip_prefix("PROGRESS|") else {
        return;
    };
    let mut payload =
        serde_json::json!({ "path": path, "stage": rest, "copy": serde_json::Value::Null });
    if let Some(fields) = rest.strip_prefix("COPY|") {
        let f: Vec<&str> = fields.split('|').collect();
        if f.len() == 5 {
            payload["copy"] = serde_json::json!({
                "pct": f[0].parse::<u64>().unwrap_or(0),
                "filesDone": f[1].parse::<u64>().unwrap_or(0),
                "filesTotal": f[2].parse::<u64>().unwrap_or(0),
                "bytesDone": f[3].parse::<u64>().unwrap_or(0),
                "bytesTotal": f[4].parse::<u64>().unwrap_or(0),
            });
        }
    }
    let _ = app.emit(event, payload);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ps_q_wraps_and_doubles_quotes() {
        assert_eq!(ps_q("abc"), "'abc'");
        assert_eq!(ps_q("a'b"), "'a''b'");
        assert_eq!(ps_q("C:\\x'y"), "'C:\\x''y'");
    }

    #[test]
    fn extract_json_line_ignores_stray_robocopy_header() {
        // 复现 RenPy 故障：robocopy 漏出的 "Log File : ..." 不得污染最终 JSON
        let body = "Log File : C:\\Users\\Long\\AppData\\Local\\Temp\\tmp5EF5.tmp\n\
                    {\"success\":true,\"message\":\"done\"}\n";
        assert_eq!(
            extract_json_line(body),
            Some("{\"success\":true,\"message\":\"done\"}")
        );
    }

    #[test]
    fn extract_json_line_handles_array_and_garbage_order() {
        let body = "some noise\n[{\"a\":1}]\n";
        assert_eq!(extract_json_line(body), Some("[{\"a\":1}]"));
        // 最后一条 JSON 胜出
        let body2 = "{\"x\":1}\nPROGRESS|ignored\n{\"x\":2}";
        assert_eq!(extract_json_line(body2), Some("{\"x\":2}"));
        // 没有 JSON 时返回 None
        assert_eq!(extract_json_line("only\nnoise"), None);
        assert_eq!(extract_json_line(""), None);
    }

    #[test]
    fn ps_encode_is_utf16le_base64() {
        use base64::Engine;
        use std::io::Write;
        let raw = base64::engine::general_purpose::STANDARD
            .decode(ps_encode("A中"))
            .unwrap();
        let mut expect = Vec::new();
        for unit in "A中".encode_utf16() {
            expect.write_all(&unit.to_le_bytes()).unwrap();
        }
        assert_eq!(raw, expect);
    }
}
