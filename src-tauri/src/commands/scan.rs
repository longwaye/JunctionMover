// 磁盘与 AppData 目录扫描（扫描结果逐条推送，支持中途停止）

use crate::model::{DirInfo, DriveInfo};
use crate::ps::{run_ps, run_ps_stream_cancellable, PS_CANCELLED};
use crate::state::AppState;
use std::process::Command;
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};

#[tauri::command]
pub(crate) fn scan_drives() -> Result<Vec<DriveInfo>, String> {
    // Get-PSDrive 的 Name 只有盘符字母（不带冒号）；
    // @(...) + -InputObject 保证单盘时也输出 JSON 数组而非对象。
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$result = @(Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Name -match '^[A-Za-z]$' -and $null -ne $_.Free } | ForEach-Object {
    [PSCustomObject]@{
        name  = $_.Name + ':'
        total = [long]($_.Used + $_.Free)
        free  = [long]$_.Free
    }
})
ConvertTo-Json -InputObject $result -Compress
"#;
    let out = run_ps(script)?;
    if out.is_empty() {
        return Ok(vec![]);
    }
    serde_json::from_str(&out).map_err(|e| format!("解析磁盘数据失败: {}", e))
}

#[tauri::command]
pub(crate) async fn scan_dirs(app: tauri::AppHandle) -> Result<Vec<DirInfo>, String> {
    // 每个目录产出两行：
    //   PROGRESS|<root>|<name>      扫描位置文本
    //   PROGRESS|DIR|<单行 JSON>    该目录的完整数据（前端即时上屏）
    // 脚本结尾仍输出完整 JSON 数组作为最终权威结果。
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$exclude = @(
  'Microsoft','Packages','Programs','360Safe','360huabao','360browser',
  'Windows','NVIDIA','NVIDIA Corporation','secoresdk','WMPF',
  'MicrosoftEdge','EdgeUpdate','GoogleUpdate','SquirrelTemp','Temp','CrashDumps'
)

function Get-DirType($name) {
    $n = $name.ToLower()
    if ($n -match 'cache|d3dscache|dxcache|glcache|thumb|temp|log$|logs') { return 'cache' }
    if ($n -match '^(360|microsoft|windows|nvidia|secoresdk)') { return 'system' }
    if ($n -match 'config|settings|preference|cli$') { return 'config' }
    return 'data'
}

# dir /aL 由内核一次性枚举父目录下全部 Junction，行形如:
#   2026/09/22  22:07    <JUNCTION>     BraveSoftware [E:\C_AppData\Local\BraveSoftware]
# 比 Get-Item.LinkType 更可靠（个别 PS 5.1 环境 LinkType 返回空）
function Get-JunctionMap($base) {
    $map = @{}
    try {
        foreach ($line in (cmd.exe /c dir /aL "$base" 2>$null)) {
            if ($line -match '(?i)<JUNCTION>\s+(.+)\s+\[([^\]]+)\]\s*$') {
                $map[$matches[1].Trim()] = $matches[2].Trim()
            }
        }
    } catch {}
    return $map
}

function Test-Link($item) {
    if ($item.LinkType -eq 'Junction') { return $true }
    # 兜底：带重解析点且不是符号链接的目录即视为 Junction
    if ($item.LinkType -ne 'SymbolicLink' -and
        (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { return $true }
    return $false
}

function Get-FolderSize($p) {
    $files = Get-ChildItem -LiteralPath $p -Recurse -Force -File -ErrorAction SilentlyContinue
    return [PSCustomObject]@{
        size  = [long]($files | Measure-Object Length -Sum).Sum
        count = [long]($files | Measure-Object).Count
    }
}

# 向下遍历时额外剪枝的重目录/开发目录（不含迁移联接，仅为提速）
$prune = $exclude + @('node_modules','.git','Application Data','Local Settings',
                      'Temporary Internet Files','History','System Volume Information','$Recycle.Bin')

# 统一构造并上送一条目录结果
function Add-Result($name, $path, $root, $isLink, $target, $size, $files) {
    $type = Get-DirType $name
    $movable = -not $isLink -and -not ($name -match '^(360|Microsoft|Windows|NVIDIA|secoresdk)')
    $obj = [PSCustomObject]@{
        name       = $name
        path       = $path
        root       = $root
        basename   = $name
        size       = [long]$size
        files      = [long]$files
        dir_type   = $type
        movable    = $movable
        is_junction= [bool]$isLink
        target     = [string]$target
    }
    $script:result += $obj
    Write-Output ("PROGRESS|DIR|" + ($obj | ConvertTo-Json -Compress -Depth 3))
}

# 深层跨盘 Junction 发现（如 ...\Google\Chrome\User Data\Profile 17 这类迁移到其他盘的目录）。
# 只沿普通实体目录下行，绝不进入任何 Junction（防循环、防把目标盘数据重复统计），深度受限。
function Find-DeepJunctions($base, $root, $maxDepth) {
    $stack = New-Object System.Collections.Stack
    Get-ChildItem $base -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
        $topLink = (Test-Link $_)
        if (-not $topLink -and ($exclude -notcontains $_.Name)) {
            $stack.Push(@{ Path = $_.FullName; Depth = 1 })
        }
    }
    while ($stack.Count -gt 0) {
        $cur = $stack.Pop()
        Get-ChildItem $cur.Path -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
            $isLink = Test-Link $_
            if ($isLink) {
                $tgt = ($_.Target -join '')
                $same = $false
                try { $same = ((Split-Path -Path $_.FullName -Qualifier) -ieq (Split-Path -Path $tgt -Qualifier)) } catch {}
                if ($tgt -and -not $same) {
                    Write-Output ("PROGRESS|" + $root + "|" + $_.Name)
                    $s = Get-FolderSize $tgt
                    Add-Result $_.Name $_.FullName $root $true $tgt $s.size $s.count
                }
                # 同盘/跨盘联接都不进入
                return
            }
            if ($cur.Depth -lt $maxDepth -and ($prune -notcontains $_.Name)) {
                $stack.Push(@{ Path = $_.FullName; Depth = ($cur.Depth + 1) })
            }
        }
    }
}

function Get-DirStat($path, $name, $juncMap) {
    # Junction 本身不占 C 盘空间，大小取其目标路径（其他盘上的真实数据）
    if ($juncMap.ContainsKey($name)) {
        $tgt = $juncMap[$name]
        $s = Get-FolderSize $tgt
        return [PSCustomObject]@{ isJunction=$true; target=$tgt; size=$s.size; files=$s.count }
    }
    $item = Get-Item $path -Force
    if (Test-Link $item) {
        $tgt = ($item.Target -join '')
        $s = Get-FolderSize $tgt
        return [PSCustomObject]@{ isJunction=$true; target=$tgt; size=$s.size; files=$s.count }
    }
    $s = Get-FolderSize $path
    return [PSCustomObject]@{ isJunction=$false; target=''; size=$s.size; files=$s.count }
}

$result = @()
# Home 根只收录点开头目录（.dsh/.gradle/.npm 等工具缓存与配置），
# 主目录下的 Desktop/Documents 等个人目录一律不枚举
$roots = @(
    @{ Root='Local';    Base=$env:LOCALAPPDATA; DotOnly=$false; MaxDepth=8 },
    @{ Root='Roaming';  Base=$env:APPDATA;      DotOnly=$false; MaxDepth=8 },
    @{ Root='Home';     Base=$env:USERPROFILE;  DotOnly=$true;  MaxDepth=6 }
)
foreach ($r in $roots) {
    $root = $r.Root; $base = $r.Base
    $juncMap = Get-JunctionMap $base
    Get-ChildItem $base -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
        $name = $_.Name
        if ($r.DotOnly -and -not $name.StartsWith('.')) { return }
        # Junction（已迁移目录）无论名字是否在排除名单中都必须可见，否则无法回滚
        $isLink = $juncMap.ContainsKey($name) -or (Test-Link (Get-Item $_.FullName -Force))
        if ($isLink) {
            # 只认跨盘 Junction：Windows 自带兼容联接（如 Application Data -> 父目录、
            # History 等）目标仍在 C 盘，并非迁移产物，统计它们会得到整个父目录的
            # 虚高大小，回滚更会破坏系统目录，必须排除
            $linkTgt = if ($juncMap.ContainsKey($name)) { $juncMap[$name] } else { ((Get-Item $_.FullName -Force).Target -join '') }
            $sameDrive = $false
            try { $sameDrive = ((Split-Path -Path $_.FullName -Qualifier) -ieq (Split-Path -Path $linkTgt -Qualifier)) } catch {}
            if ($sameDrive) { return }
        }
        if (-not $isLink -and $exclude -contains $name) { return }
        Write-Output ("PROGRESS|" + $root + "|" + $name)
        $stat = Get-DirStat $_.FullName $name $juncMap
        Add-Result $name $_.FullName $root $stat.isJunction $stat.target $stat.size $stat.files
    }
    # 第二趟：深层跨盘 Junction（如 Google\Chrome\User Data\Profile 17）。
    # Home 根不能直接遍历整个主目录（会扫进 Desktop/Documents），只在各点目录内部找
    if ($r.DotOnly) {
        Get-ChildItem $base -Directory -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name.StartsWith('.') -and -not (Test-Link $_) } |
            ForEach-Object { Find-DeepJunctions $_.FullName $root $r.MaxDepth }
    } else {
        Find-DeepJunctions $base $root $r.MaxDepth
    }
}
Write-Output 'PROGRESS|done|'
ConvertTo-Json -InputObject $result -Compress -Depth 3
"#;

    let handle = std::thread::spawn(move || {
        let st = app.state::<AppState>();
        st.scan_cancel.store(false, Ordering::SeqCst);
        run_ps_stream_cancellable(
            &script,
            |line| {
                if let Some(json) = line.strip_prefix("PROGRESS|DIR|") {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(json) {
                        let _ = app.emit("scan-dir-item", v);
                    }
                } else if let Some(rest) = line.strip_prefix("PROGRESS|") {
                    let parts: Vec<&str> = rest.splitn(2, '|').collect();
                    if parts.len() == 2 {
                        let payload = serde_json::json!({ "root": parts[0], "name": parts[1] });
                        let _ = app.emit("scan-progress", payload);
                    }
                }
            },
            Some(&st.scan_cancel),
            Some(&st.scan_pid),
        )
    });
    let out = match handle.join().map_err(|_| "扫描线程异常终止".to_string())? {
        Ok(v) => v,
        Err(e) if e == PS_CANCELLED => return Err(PS_CANCELLED.to_string()),
        Err(e) => return Err(e),
    };
    if out.is_empty() {
        return Ok(vec![]);
    }
    serde_json::from_str(&out).map_err(|e| format!("解析目录数据失败: {}", e))
}

/// 停止正在进行的扫描：置取消标志并 taskkill 结束 PowerShell 进程树
#[tauri::command]
pub(crate) fn cancel_scan(state: tauri::State<AppState>) -> Result<(), String> {
    state.scan_cancel.store(true, Ordering::SeqCst);
    if let Some(pid) = state.scan_pid.lock().unwrap().take() {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let _ = cmd.status();
    }
    Ok(())
}
