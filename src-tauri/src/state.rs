// 跨命令共享的运行时状态（当前用于扫描任务的取消）

use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

#[derive(Default)]
pub(crate) struct AppState {
    /// 用户点击"停止扫描"后置位
    pub(crate) scan_cancel: AtomicBool,
    /// 当前扫描 PowerShell 进程 PID，供 taskkill /T 结束进程树
    pub(crate) scan_pid: Mutex<Option<u32>>,
}
