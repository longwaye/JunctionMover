use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct DriveInfo {
    pub(crate) name: String,
    pub(crate) total: u64,
    pub(crate) free: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct DirInfo {
    pub(crate) name: String,
    pub(crate) path: String,
    /// "Local" 或 "Roaming"
    pub(crate) root: String,
    pub(crate) basename: String,
    pub(crate) size: u64,
    pub(crate) files: u64,
    /// cache / data / config / system
    #[serde(rename = "dir_type")]
    pub(crate) dir_type: String,
    pub(crate) movable: bool,
    #[serde(rename = "is_junction")]
    pub(crate) is_junction: bool,
    /// Junction 目标（若有）
    pub(crate) target: String,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct OpResult {
    pub(crate) success: bool,
    pub(crate) message: String,
}
