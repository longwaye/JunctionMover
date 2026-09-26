// 回滚：把数据复制回 C 盘暂存目录并校验 -> 删 Junction -> 同卷 rename 还原 -> 清理目标盘。
// 每一步失败都不动 Junction，保证可重试、不丢数据。
// 注意不能直接 robocopy 到 Junction 路径：那是指向 target 的自拷贝，robocopy 会空操作。

use crate::model::OpResult;
use crate::ps::{emit_copy_progress, ps_q, run_ps_stream};
use std::path::Path;

#[tauri::command]
pub(crate) async fn rollback_dir(
    app: tauri::AppHandle,
    link_path: String,
    target: String,
) -> Result<OpResult, String> {
    if !Path::new(&link_path).is_absolute() || !Path::new(&target).is_absolute() {
        return Err("Path must be absolute".to_string());
    }

    let script = r#"
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# 任何未预期的终止错误都必须落成 JSON 结论，绝不能让前端拿到空输出
trap {
    $em = 'Rollback script error: ' + $_.Exception.Message + ' (line ' + $_.InvocationInfo.ScriptLineNumber + ')'
    try { [Console]::Out.WriteLine((@{ success = $false; message = $em } | ConvertTo-Json -Compress)) } catch {}
    exit 0
}
# 统一结果输出：消息与 JSON 构造分离，禁止把 JSON 花括号直接放进 -f 格式串
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
$link = __LINK__
$target = __TARGET__

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

# 在目标目录树中按原绝对目标重建内部联接（mklink /J 建 Junction 无需管理员权限），返回失败数
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
        # /XJ：跳过目录联接，不跟随复制其目标内容；联接由 Restore-InnerLinks 单独重建
        $argLine = '"{0}" "{1}" /E /XJ /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /LOG:"{2}"' -f $from, $to, $logFile
        $proc = Start-Process -FilePath 'robocopy.exe' -ArgumentList $argLine -NoNewWindow -PassThru `
            -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
        while (-not $proc.WaitForExit(700)) {
            $cur = Get-DirSize $to
            $pct = 99
            if ([int64]$totalStat.Bytes -gt 0) {
                $pct = [int][math]::Min(99, [math]::Round([int64]$cur.Bytes * 100 / [int64]$totalStat.Bytes))
            }
            # 必须走 Console.Out：本函数输出会被调用方 $rc = 赋值捕获
            [Console]::Out.WriteLine(('PROGRESS|COPY|{0}|{1}|{2}|{3}|{4}' -f $pct, [long]$cur.Count, [long]$totalStat.Count, [int64]$cur.Bytes, [int64]$totalStat.Bytes))
        }
        return [int]$proc.ExitCode
    } finally {
        Remove-Item -LiteralPath $logFile,$stdoutFile,$stderrFile -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path -LiteralPath $link)) { Send-Result $false 'Junction path does not exist'; exit }
$item = Get-Item -LiteralPath $link -Force
# LinkType 在个别 PS 5.1 环境可能为空，ReparsePoint 属性兜底（排除符号链接）
$isLink = ($item.LinkType -eq 'Junction') -or ($item.LinkType -ne 'SymbolicLink' -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0))
if (-not $isLink) { Send-Result $false 'Not a junction, cannot rollback'; exit }
# 只允许回滚跨盘 Junction；同盘联接是 Windows 兼容联接（如 Application Data），回滚会破坏系统目录
# 注意：PS 5.1 的 Split-Path 不支持 -LiteralPath（PS 6+ 才有）
$linkDrive = (Split-Path -Path $link -Qualifier)
$tgtDrive  = $null
try { $tgtDrive = Split-Path -Path $target -Qualifier } catch {}
if ($null -ne $tgtDrive -and $linkDrive -ieq $tgtDrive) {
    Send-Result $false ('Junction target is on the same drive ({0}), this is a system compatibility junction, rollback blocked' -f $linkDrive)
    exit
}
if (-not (Test-Path -LiteralPath $target)) { Send-Result $false 'Target data directory does not exist'; exit }

$parent = Split-Path $link -Parent
$leaf = Split-Path $link -Leaf
$stage = Join-Path $parent ($leaf + '.junctionmover_rb_tmp')

Write-Output 'PROGRESS|check_space'
$tStat = Get-DirSize $target
$cLetter = (Split-Path $link -Qualifier).TrimEnd(':')
$cFree = [long]((Get-PSDrive -Name $cLetter).Free)
$need = [int64]$tStat.Bytes + 64MB
if ($cFree -lt $need) {
    Send-Result $false ('Insufficient C: space for rollback: need ~{0}MB, free {1}MB' -f [math]::Round($need/1MB,1), [math]::Round($cFree/1MB,1))
    exit
}

# 上次失败遗留暂存目录的保护
if (Test-Path -LiteralPath $stage) {
    $old = Get-DirSize $stage
    if ($old.Count -gt 0) {
        Send-Result $false ('Found leftover staging directory from previous failure, please verify and delete manually: {0}' -f $stage)
        exit
    }
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}

# 1) 复制数据回 C 盘暂存目录（此时 Junction 仍在，服务不中断）
# 先用 Restart Manager 关闭占用进程
$rmResult = Invoke-RestartManager $link
if ($null -ne $rmResult -and $rmResult.Count -gt 0) {
    Send-Result $false ('Cannot auto-close these processes, please close manually and retry: ' + ($rmResult -join ', '))
    exit
}
# 复制前记录目标盘数据内的内部联接，回拷后在暂存目录原样重建
$innerLinks = Get-InnerDirLinks $target

Write-Output 'PROGRESS|copying_back'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$rc = Invoke-RobocopyProgress $target $stage $tStat
if ($rc -ge 8) {
    Send-Result $false ('Copy back to C: failed (robocopy exit code {0}), junction unchanged' -f [int]$rc)
    exit
}

# 2) 校验暂存数据
Write-Output 'PROGRESS|verifying_staging'
$stStat = Get-DirSize $stage
if ($stStat.Count -ne $tStat.Count -or $stStat.Bytes -ne $tStat.Bytes) {
    Send-Result $false ('Rollback verification mismatch: target {0} files/{1}MB, staging {2} files/{3}MB. Junction unchanged (staging: {4})' -f $tStat.Count, [math]::Round($tStat.Bytes/1MB,1), $stStat.Count, [math]::Round($stStat.Bytes/1MB,1), $stage)
    exit
}

# 在暂存目录重建内部联接；失败则中止（Junction 未动，可排查后重试）
$linkFail = Restore-InnerLinks $stage $innerLinks
if ($linkFail -gt 0) {
    Send-Result $false ('Data copied back and verified, but {0} internal junction(s) could not be recreated. Junction unchanged (staging: {1})' -f [int]$linkFail, $stage)
    exit
}

# 3) 删除联接（cmd rmdir 只删 reparse point，不碰目标数据；前提：暂存副本已校验通过）
Write-Output 'PROGRESS|removing_junction'
cmd /c rmdir "$link" | Out-Null
if (Test-Path -LiteralPath $link) {
    Send-Result $false 'Junction deletion failed (may be in use), data unaffected'
    exit
}

# 4) 暂存目录重命名为原路径（同卷 rename）
Write-Output 'PROGRESS|restoring_dir'
Move-Item -LiteralPath $stage -Destination $link
if (-not (Test-Path -LiteralPath $link)) {
    Send-Result $false ('Junction removed but rename failed, C: data preserved in staging: {0}. Target old data not yet deleted, do not clean staging directory' -f $stage)
    exit
}
$restored = Get-Item -LiteralPath $link -Force
# 还原后必须是普通实体目录：带任何重解析点都说明联接未被正确替换
if (($restored.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    Send-Result $false ('Path is still a junction after restore, please check manually. Staging state unknown: {0}' -f $stage)
    exit
}

# 5) 最终校验
$fStat = Get-DirSize $link
if ($fStat.Count -ne $tStat.Count) {
    Send-Result $false ('Post-restore verification mismatch: expected {0} files, got {1}. Data is on C:, please verify manually' -f $tStat.Count, $fStat.Count)
    exit
}

# 清理目标盘旧数据目录（失败不影响回滚结论，仅提示手动清理）
# 先摘除内部联接，防止 Remove-Item -Recurse 穿透联接删掉链接目标的真实数据
Detach-InnerLinks $target $innerLinks
$leftover = $false
Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $target) { $leftover = $true }

Write-Output 'PROGRESS|done'
if ($leftover) {
    Send-Result $true ('Rollback successful: {0} files restored to C:, junction removed. Target old data not fully deleted (may be in use), please clean manually: {1}' -f $fStat.Count, $target)
} else {
    Send-Result $true ('Rollback successful: {0} files restored to C:, junction removed, target old data deleted: {1}' -f $fStat.Count, $target)
}
"#
    .replace("__LINK__", &ps_q(&link_path))
    .replace("__TARGET__", &ps_q(&target));

    let handle = std::thread::spawn(move || {
        run_ps_stream(&script, move |line| {
            emit_copy_progress(&app, "rollback-progress", &link_path, line);
        })
    });
    let out = handle
        .join()
        .map_err(|_| "Rollback thread terminated unexpectedly".to_string())??;
    serde_json::from_str(&out).map_err(|e| format!("Failed to parse rollback result: {} raw output: {}", e, out))
}
