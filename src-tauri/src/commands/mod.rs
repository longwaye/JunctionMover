// Tauri 命令层：前端 invoke 的入口。实际系统操作下沉在 ps 模块执行。

pub(crate) mod dialog;
pub(crate) mod migrate;
pub(crate) mod rollback;
pub(crate) mod scan;
pub(crate) mod shell;
