// 迁移：robocopy 复制到目标盘 -> 校验 -> 删源 -> 建 Junction，联接失败自动回拷兜底

use crate::model::OpResult;
use crate::pathutil::{drive_prefix, path_equals_or_inside};
use crate::ps::{emit_copy_progress, ps_q, run_ps_stream};
use std::path::Path;

#[tauri::command]
pub(crate) async fn migrate_dir(
    app: tauri::AppHandle,
    src: String,
    target_dir: String,
) -> Result<OpResult, String> {
    // 落地路径 = 用户所选文件夹\源目录名
    if !Path::new(&src).is_absolute() {
        return Err("Source path must be absolute".to_string());
    }
    let basename = Path::new(&src)
        .file_name()
        .map(|v| v.to_string_lossy().to_string())
        .unwrap_or_default();
    if basename.is_empty() {
        return Err("Invalid source path".to_string());
    }
    let target_path = Path::new(&target_dir);
    if !target_path.is_absolute() {
        return Err("Target folder must be absolute (select via dialog)".to_string());
    }
    if !target_path.is_dir() {
        return Err(format!("Target folder does not exist: {}", target_dir));
    }
    // 必须跨盘，否则达不到释放 C 盘空间的目的
    if let (Some(s), Some(t)) = (drive_prefix(Path::new(&src)), drive_prefix(target_path)) {
        if s == t {
            return Err("Target folder is on the same drive as source, cannot free C: space".to_string());
        }
    }
    // 防自拷贝/递归
    if path_equals_or_inside(target_path, Path::new(&src)) {
        return Err("Target folder cannot be the source or its subdirectory".to_string());
    }
    // 若用户所选文件夹的最后一段与源目录名相同（如选中 ...\\BraveSoftware 作为 BraveSoftware 的目标），
    // 直接以其作为落地路径，避免出现 ...\\BraveSoftware\\BraveSoftware 的重复层级
    let target_base = Path::new(&target_dir)
        .file_name()
        .map(|v| v.to_string_lossy().to_string())
        .unwrap_or_default();
    let dst = if target_base.eq_ignore_ascii_case(&basename) {
        target_dir.trim_end_matches('\\').to_string()
    } else {
        format!("{}\\{}", target_dir.trim_end_matches('\\'), basename)
    };

    let script = build_migrate_script(&src, &dst);

    let handle = std::thread::spawn(move || {
        run_ps_stream(&script, move |line| {
            emit_copy_progress(&app, "migrate-progress", &src, line);
        })
    });
    let out = handle
        .join()
        .map_err(|_| "Migration thread terminated unexpectedly".to_string())??;
    serde_json::from_str(&out).map_err(|e| format!("Failed to parse migration result: {} raw output: {}", e, out))
}

/// 构建迁移脚本。路径只能经 ps_q 单引号字面量替换 __SRC__/__DST__，
/// 绝不用 Rust format! 注入（会与 PowerShell 的 -f 占位符冲突）。
pub(crate) fn build_migrate_script(src: &str, dst: &str) -> String {
    r#"
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# 任何未预期的终止错误都必须落成 JSON 结论，绝不能让前端拿到空输出
trap {
    $em = 'Migration script error: ' + $_.Exception.Message + ' (line ' + $_.InvocationInfo.ScriptLineNumber + ')'
    try { [Console]::Out.WriteLine((@{ success = $false; message = $em } | ConvertTo-Json -Compress)) } catch {}
    exit 0
}
# 统一结果输出：消息与 JSON 构造分离，禁止把 JSON 花括号直接放进 -f 格式串
# （-f 会把 {"success"} 解析成占位符导致 FormatError，最终 JSON 发不出来）
function Send-Result($ok, $msg) {
    [Console]::Out.WriteLine((@{ success = [bool]$ok; message = [string]$msg } | ConvertTo-Json -Compress))
}

# Restart Manager：检测并关闭占用源目录的进程（rstrtmgr.dll，Vista+ 标配）
$rmCode = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class RmHelper {
    [StructLayout(LayoutKind.Sequential)]
    public struct RM_UNIQUE_PROCESS { public int dwProcessId; public long ProcessStartTime; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct RM_PROCESS_INFO {
        public RM_UNIQUE_PROCESS Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strAppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string strServiceName;
        public uint ApplicationType; public uint AppStatus; public uint TSSessionId;
        [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
    }
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    private static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    private static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames, uint nApplications, [In] RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    private static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, out uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwReason);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    private static extern int RmShutdown(uint pSessionHandle, uint lActionFlags, IntPtr dwStatusProc);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    private static extern int RmEndSession(uint pSessionHandle);
    private static string[] GetProcs(uint session) {
        uint needed = 0, count = 0, reason = 0;
        RmGetList(session, out needed, out count, null, ref reason);
        if (needed == 0) return new string[0];
        var infos = new RM_PROCESS_INFO[needed];
        RmGetList(session, out needed, out count, infos, ref reason);
        var names = new List<string>();
        for (int i = 0; i < count; i++) names.Add(infos[i].strAppName);
        return names.ToArray();
    }
    public static string[] Detect(string path) {
        uint session; string key = Guid.NewGuid().ToString("N");
        if (RmStartSession(out session, 0, key) != 0) return new string[0];
        try { RmRegisterResources(session, 1, new string[] { path }, 0, null, 0, null); return GetProcs(session); }
        finally { RmEndSession(session); }
    }
    public static string[] Shutdown(string path) {
        uint session; string key = Guid.NewGuid().ToString("N");
        if (RmStartSession(out session, 0, key) != 0) return new string[0];
        try { RmRegisterResources(session, 1, new string[] { path }, 0, null, 0, null); RmShutdown(session, 0, IntPtr.Zero); return GetProcs(session); }
        finally { RmEndSession(session); }
    }
}
'@
function Invoke-RestartManager {
    param([string]$Path)
    try {
        if (-not ('RmHelper' -as [type])) {
            Add-Type -TypeDefinition $rmCode -Language CSharp -ErrorAction Stop
        }
    } catch { return $null }
    $procs = [RmHelper]::Detect($Path)
    if (-not $procs -or $procs.Count -eq 0) {
        [Console]::Out.WriteLine('PROGRESS|no_procs')
        return @()
    }
    [Console]::Out.WriteLine('PROGRESS|procs_found|' + ($procs -join ', '))
    $remaining = [RmHelper]::Shutdown($Path)
    if ($remaining -and $remaining.Count -gt 0) { return $remaining }
    [Console]::Out.WriteLine('PROGRESS|procs_closed')
    return @()
}
$src = __SRC__
$dst = __DST__

function Get-DirSize($path) {
    $files = Get-ChildItem -LiteralPath $path -Recurse -Force -File -ErrorAction SilentlyContinue
    $count = [long]($files | Measure-Object).Count
    $size = [long]($files | Measure-Object Length -Sum).Sum
    return [PSCustomObject]@{ Count = $count; Bytes = $size }
}

# 枚举目录内部的所有目录联接/符号链接（Get-ChildItem 会列出 reparse point 但不递归进入）。
# 典型场景：npm/pnpm 在 node_modules 下建的目录联接。
# 复制引擎用 robocopy /XJ 跳过这些联接（只复制实体文件），随后在目标侧原样重建。
function Get-InnerDirLinks($base) {
    $list = New-Object System.Collections.ArrayList
    Get-ChildItem -LiteralPath $base -Recurse -Force -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        if (($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            [void]$list.Add([PSCustomObject]@{
                Rel    = $_.FullName.Substring($base.Length)
                Target = ($_.Target -join '')
            })
        }
    }
    return ,$list
}

# 在目标目录树中按原绝对目标重建内部联接（mklink /J 建 Junction 无需管理员权限）。
# 返回重建失败数，调用方据此中止（此时源数据尚未删除）。
function Restore-InnerLinks($dstBase, $links) {
    $failed = 0
    foreach ($l in $links) {
        if (-not $l.Target) { $failed++; continue }
        $newLink = $dstBase.TrimEnd('\') + $l.Rel
        cmd /c mklink /J "$newLink" "$($l.Target)" | Out-Null
        if (-not (Test-Path -LiteralPath $newLink)) { $failed++ }
    }
    return [int]$failed
}

# 删除含内部联接的目录前，必须先用 cmd rmdir 逐个摘除联接（只删 reparse point）。
# PS 5.1 的 Remove-Item -Recurse 会穿透联接、删掉链接目标里的真实文件（如 C 盘 npm 全局包）。
function Detach-InnerLinks($base, $links) {
    foreach ($l in $links) {
        $p = $base.TrimEnd('\') + $l.Rel
        if (Test-Path -LiteralPath $p) { cmd /c rmdir "$p" | Out-Null }
    }
}

# robocopy 后台运行，每 700ms 统计目标目录增量输出 COPY 进度行（心跳）
function Invoke-RobocopyProgress($from, $to, $totalStat) {
    $logFile = [System.IO.Path]::GetTempFileName()
    # robocopy 即使指定 /LOG 仍会向控制台打印 "Log File : ..." 头行，
    # 必须把子进程 stdout/stderr 全部重定向，否则该行会污染最终 JSON 输出
    $stdoutFile = [System.IO.Path]::GetTempFileName()
    $stderrFile = [System.IO.Path]::GetTempFileName()
    try {
        # /XJ：跳过目录联接，不跟随复制其目标内容（与 Get-DirSize 的统计口径一致，
        # 也防止把树外联接指向的数据重复复制）；联接由 Restore-InnerLinks 单独重建
        $argLine = '"{0}" "{1}" /E /XJ /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /LOG:"{2}"' -f $from, $to, $logFile
        $proc = Start-Process -FilePath 'robocopy.exe' -ArgumentList $argLine -NoNewWindow -PassThru `
            -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
        while (-not $proc.WaitForExit(700)) {
            $cur = Get-DirSize $to
            $pct = 99
            if ([int64]$totalStat.Bytes -gt 0) {
                $pct = [int][math]::Min(99, [math]::Round([int64]$cur.Bytes * 100 / [int64]$totalStat.Bytes))
            }
            # 必须走 Console.Out：本函数输出会被调用方 $rc = 赋值捕获，
            # Write-Output 的进度行会被吞进变量，既到不了前端又污染 $rc
            [Console]::Out.WriteLine(('PROGRESS|COPY|{0}|{1}|{2}|{3}|{4}' -f $pct, [long]$cur.Count, [long]$totalStat.Count, [int64]$cur.Bytes, [int64]$totalStat.Bytes))
        }
        return [int]$proc.ExitCode
    } finally {
        Remove-Item -LiteralPath $logFile,$stdoutFile,$stderrFile -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path -LiteralPath $src)) { Send-Result $false 'Source directory does not exist'; exit }
$item = Get-Item -LiteralPath $src -Force
# LinkType 在个别 PS 5.1 环境可能为空，ReparsePoint 属性兜底（排除符号链接）
$alreadyLink = ($item.LinkType -eq 'Junction') -or ($item.LinkType -ne 'SymbolicLink' -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0))
if ($alreadyLink) { Send-Result $false 'Already a junction, no migration needed'; exit }
if ($dst -eq $src -or $dst -like ($src + '\*')) { Send-Result $false 'Target cannot be the source or its subdirectory'; exit }

Write-Output 'PROGRESS|check_space'
$s1 = Get-DirSize $src
$dstLetter = (Split-Path $dst -Qualifier).TrimEnd(':')
$dstFree = [long]((Get-PSDrive -Name $dstLetter).Free)
$need = [int64]$s1.Bytes + 64MB
if ($dstFree -lt $need) {
    Send-Result $false ('Insufficient disk space: need ~{0}MB, free {1}MB' -f [math]::Round($need/1MB,1), [math]::Round($dstFree/1MB,1))
    exit
}

# 目标非空保护
if (Test-Path -LiteralPath $dst) {
    $dstStat = Get-DirSize $dst
    if ($dstStat.Count -gt 0) { Send-Result $false 'Target directory is not empty, aborted (prevent overwrite)'; exit }
    Remove-Item -LiteralPath $dst -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $dst -Force | Out-Null

# Restart Manager：检测并关闭占用源目录的进程，避免删除时文件被占用
$rmResult = Invoke-RestartManager $src
if ($null -ne $rmResult -and $rmResult.Count -gt 0) {
    Send-Result $false ('Cannot auto-close these processes, please close manually and retry: ' + ($rmResult -join ', '))
    exit
}

# 复制前记录内部目录联接（如 node_modules 下的 npm 联接），复制后在目标侧原样重建
$innerLinks = Get-InnerDirLinks $src

Write-Output 'PROGRESS|copying'
$rc = Invoke-RobocopyProgress $src $dst $s1
if ($rc -ge 8) {
    Send-Result $false ('Copy failed (robocopy exit code {0}). Source not deleted, junction not created, can retry' -f [int]$rc)
    exit
}

Write-Output 'PROGRESS|verifying'
$d1 = Get-DirSize $dst
if ($s1.Count -ne $d1.Count -or $s1.Bytes -ne $d1.Bytes) {
    Send-Result $false ('Copy verification mismatch (source {0} files/{1}MB, target {2} files/{3}MB). Source not deleted, junction not created; incomplete copy at: {4}' -f $s1.Count, [math]::Round($s1.Bytes/1MB,1), $d1.Count, [math]::Round($d1.Bytes/1MB,1), $dst)
    exit
}

# 在目标侧重建内部联接；失败则中止（源目录未动，可排查后重试）
$linkFail = Restore-InnerLinks $dst $innerLinks
if ($linkFail -gt 0) {
    Send-Result $false ('Data copied and verified, but {0} internal junction(s) could not be recreated at the target. Source not deleted, junction not created; copy at: {1}' -f [int]$linkFail, $dst)
    exit
}

Write-Output 'PROGRESS|deleting_src'
# 先摘除源目录内的联接（只删链接），再删实体文件，防止 Remove-Item 穿透联接误删链接目标数据
Detach-InnerLinks $src $innerLinks
Remove-Item -LiteralPath $src -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $src) {
    Send-Result $false 'Source directory deletion incomplete (may be in use). Junction not created. Data fully copied to target, please close the program using this directory and retry (do not manually delete C: remnants before retrying)'
    exit
}

Write-Output 'PROGRESS|creating_junction'
# 删除原目录后立即建联接可能撞上杀软/索引器的瞬时句柄，重试 3 次；
# 同时保留每次的系统错误输出，失败时写入结论消息便于定位
$mkErr = ''
$link = $null
for ($try = 1; $try -le 3 -and $null -eq $link; $try++) {
    $mkErr = (cmd /c mklink /J "$src" "$dst" 2>&1 | Out-String)
    $link = Get-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue
    if ($null -eq $link -and $try -lt 3) { Start-Sleep -Milliseconds 700 }
}
if ($null -eq $link -or ($link.LinkType -ne 'Junction' -and (($link.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0))) {
    $mkErr = ($mkErr -replace '\s+', ' ').Trim()
    # 原目录已删而联接创建失败：立即把数据回拷到原路径兜底，避免两边落空
    New-Item -ItemType Directory -Path $src -Force | Out-Null
    robocopy $dst $src /E /XJ /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    $rc2 = $LASTEXITCODE
    $rStat = Get-DirSize $src
    if ($rc2 -ge 8 -or $rStat.Count -ne $d1.Count -or $rStat.Bytes -ne $d1.Bytes) {
        Send-Result $false ('Junction creation failed, fallback copy also incomplete (target {0} files/{1}MB, C: {2} files/{3}MB). Target still has complete copy: {4}' -f $d1.Count, [math]::Round($d1.Bytes/1MB,1), $rStat.Count, [math]::Round($rStat.Bytes/1MB,1), $dst)
        exit
    }
    # 回拷后把内部联接也恢复到 C 盘原树（目标路径为原绝对路径，仍然有效）
    [void](Restore-InnerLinks $src $innerLinks)
    Send-Result $false ('Junction creation failed after 3 attempts, data restored to C: (file/size verified). System message: {0}' -f $mkErr)
    exit
}

$verify = [long]((Get-ChildItem -LiteralPath $src -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object).Count)
if ($verify -ne $d1.Count) {
    Send-Result $false ('Junction verification mismatch: expected {0} files, got {1}' -f $d1.Count, $verify)
    exit
}
Write-Output 'PROGRESS|done'
Send-Result $true ('Migration successful: source deleted, junction created. {0} files/{1}MB stored at {2}' -f $verify, [math]::Round($d1.Bytes/1MB,1), $dst)
"#
    .replace("__SRC__", &ps_q(src))
    .replace("__DST__", &ps_q(dst))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ps::run_ps_stream;
    use std::fs;
    use std::path::PathBuf;

    fn run_case(name: &str, files: u32) -> (String, Vec<String>) {
        let base_src = PathBuf::from(std::env::temp_dir()).join("dm_e2e_src");
        let base_dst = PathBuf::from("E:\\dm_prog_verify\\dm_e2e_target");
        let src = base_src.join(name);
        let dst_dir = base_dst.join(name);
        let dst = dst_dir.join(name);
        let ext = base_src.join(format!("{}_external", name));
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dst_dir);
        let _ = fs::remove_dir_all(&ext);
        fs::create_dir_all(src.join("sub")).unwrap();
        for i in 0..files {
            fs::write(src.join(format!("f{}.dat", i)), format!("payload-{:08}", i)).unwrap();
        }
        fs::write(src.join("sub\\inner.txt"), "ok").unwrap();
        // 外部真实目录 + 源内目录联接（npm node_modules 场景）：
        // robocopy 不得跟随复制，删除源不得误删外部文件
        fs::create_dir_all(&ext).unwrap();
        for i in 0..3u32 {
            fs::write(ext.join(format!("ext{}.txt", i)), "x").unwrap();
        }
        let _ = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &src.join("linked").to_string_lossy(), &ext.to_string_lossy()])
            .status();
        // 深层联接也要能重建
        let _ = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &src.join("sub\\nested").to_string_lossy(), &ext.to_string_lossy()])
            .status();

        let script = build_migrate_script(
            &src.to_string_lossy(),
            &dst.to_string_lossy(),
        );
        let mut prog = Vec::new();
        let out = run_ps_stream(&script, |l| {
            if l.starts_with("PROGRESS|") {
                prog.push(l.to_string());
            }
        })
        .unwrap_or_else(|e| {
            let dump = std::env::temp_dir().join(format!("dm_e2e_err_{}.txt", name));
            let _ = fs::write(&dump, &e);
            format!("__ERR__{} (dump: {})", e, dump.display())
        });

        // 成功时额外验证内部联接语义
        if out.contains("\"success\":true") {
            // 外部真实文件必须仍在（Delete 步骤不得穿透联接误删）
            assert!(
                ext.join("ext0.txt").exists(),
                "case {name}: external link target files were deleted during source removal"
            );
            // 目标侧重建的联接必须可解析（顶层和深层）
            assert!(
                dst.join("linked\\ext0.txt").exists(),
                "case {name}: recreated top inner link not resolvable at target"
            );
            assert!(
                dst.join("sub\\nested\\ext2.txt").exists(),
                "case {name}: recreated nested inner link not resolvable at target"
            );
        }

        // 清理：删 junction（rmdir 不触数据）再删目标盘数据
        let _ = std::process::Command::new("cmd")
            .args(["/C", "rmdir", &src.to_string_lossy()])
            .status();
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dst_dir);
        let _ = fs::remove_dir_all(&ext);
        (out, prog)
    }

    #[test]
    #[ignore = "真实跨盘迁移端到端，需 E: 盘且会建/删 Junction，手工执行"]
    fn e2e_migrate_scenarios() {
        for (name, files) in [
            ("TinyAscii", 2u32),
            ("BigHeartbeat", 4000),
            ("Ren'Py", 3000),
            ("Bracket[1]", 3000),
        ] {
            let (out, prog) = run_case(name, files);
            let copy_beats = prog
                .iter()
                .filter(|l| l.starts_with("PROGRESS|COPY|"))
                .count();
            println!(
                "CASE {name}: out={} copy_heartbeats={}",
                out.chars().take(200).collect::<String>(),
                copy_beats
            );
            assert!(out.contains("\"success\":true"), "case {name} failed: {out}");
            if files >= 3000 {
                assert!(copy_beats > 0, "case {name}: 进度心跳被变量捕获吞掉");
            }
        }
    }
}
