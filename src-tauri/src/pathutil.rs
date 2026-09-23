// Windows 路径校验工具（盘符前缀、大小写不敏感的包含关系判断）

use std::path::Path;

/// 校验盘符参数，形如 "E:"
#[allow(dead_code)]
pub(crate) fn validate_drive(d: &str) -> Result<(), String> {
    let b = d.as_bytes();
    if b.len() == 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        Ok(())
    } else {
        Err(format!("无效的盘符: {}", d))
    }
}

/// Windows 路径小写规范化，用于不区分大小写的前缀比较
fn norm_win(p: &Path) -> String {
    p.to_string_lossy().trim_end_matches('\\').to_lowercase()
}

/// 判断 child 是否等于 parent 或位于其内部（Windows 路径不区分大小写）
pub(crate) fn path_equals_or_inside(child: &Path, parent: &Path) -> bool {
    let c = norm_win(child);
    let p = norm_win(parent);
    c == p || c.starts_with(&format!("{}\\", p))
}

/// 取路径盘符前缀（小写，如 "c:"），非盘符路径返回 None
pub(crate) fn drive_prefix(p: &Path) -> Option<String> {
    let s = p.to_string_lossy();
    let b = s.as_bytes();
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        Some(s[..2].to_lowercase())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drive_validation_accepts_letter_colon_only() {
        assert!(validate_drive("E:").is_ok());
        assert!(validate_drive("e:").is_ok());
        assert!(validate_drive("E").is_err());
        assert!(validate_drive("EE:").is_err());
        assert!(validate_drive("1:").is_err());
    }

    #[test]
    fn drive_prefix_is_case_insensitive() {
        assert_eq!(
            drive_prefix(Path::new("C:\\Users\\Long")),
            Some("c:".to_string())
        );
        assert_eq!(
            drive_prefix(Path::new("e:\\data")),
            Some("e:".to_string())
        );
        assert_eq!(drive_prefix(Path::new("\\\\server\\share")), None);
    }

    #[test]
    fn nesting_detection_is_case_insensitive_and_boundary_safe() {
        let src = Path::new("C:\\Users\\Long\\AppData\\Local\\MyApp");
        // 目标位于源内部 -> 命中
        assert!(path_equals_or_inside(
            Path::new("c:\\users\\long\\appdata\\local\\myapp\\sub"),
            src
        ));
        // 目标等于源 -> 命中
        assert!(path_equals_or_inside(
            Path::new("C:\\Users\\Long\\AppData\\Local\\MyApp"),
            src
        ));
        // 仅前缀相似（MyApp2）不能误判
        assert!(!path_equals_or_inside(
            Path::new("C:\\Users\\Long\\AppData\\Local\\MyApp2"),
            src
        ));
        // 其他盘的平级目录 -> 不命中
        assert!(!path_equals_or_inside(
            Path::new("E:\\Migrated\\MyApp"),
            src
        ));
    }
}
