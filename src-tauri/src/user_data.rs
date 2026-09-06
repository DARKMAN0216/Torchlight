use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const DICTIONARY: &str = "vorax-monster-dictionary-v1";
const WORKSPACE: &str = "vorax-decision-assistant-state-v4";

fn filename(key: &str) -> Result<&'static str, String> {
    match key {
        DICTIONARY => Ok("monster-dictionary.json"),
        WORKSPACE => Ok("workspace.json"),
        _ => Err("Unsupported storage key".into()),
    }
}
fn root() -> Result<PathBuf, String> {
    // Independent of install path, application version and WebView origin.
    std::env::var_os("LOCALAPPDATA")
        .map(|p| {
            PathBuf::from(p)
                .join("VoraxDecisionAssistant")
                .join("user-data")
        })
        .ok_or_else(|| "LOCALAPPDATA is unavailable; refusing to use a temporary directory".into())
}
fn validate(key: &str, raw: &str) -> Result<(), String> {
    if raw.len() > 1024 * 1024 {
        return Err("User data exceeds 1 MB".into());
    }
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("Invalid saved JSON: {e}"))?;
    let valid = if key == DICTIONARY {
        value["version"] == 1
            && value["entries"].as_array().is_some_and(|rows| {
                rows.len() <= 2000
                    && rows.iter().all(|row| {
                        row["name"]
                            .as_str()
                            .is_some_and(|name| (2..=24).contains(&name.chars().count()))
                            && row["race"].as_str().is_some_and(|race| {
                                ["swarm", "construct", "awakened", "aberrant"].contains(&race)
                            })
                            && row["rarity"].as_str().is_some_and(|rarity| {
                                ["common", "magic", "rare", "boss"].contains(&rarity)
                            })
                    })
            })
    } else {
        value["state"]["monsters"]
            .as_array()
            .is_some_and(|m| m.len() == 6)
            && value["persistentIds"].is_array()
            && value["candidateIds"].is_array()
    };
    if valid {
        Ok(())
    } else {
        Err("Saved data schema is invalid; original file preserved".into())
    }
}
fn read_at(dir: &Path, key: &str) -> Result<Option<String>, String> {
    let path = dir.join(filename(key)?);
    match fs::read_to_string(path) {
        Ok(raw) => {
            validate(key, &raw)?;
            Ok(Some(raw))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Cannot read saved data: {e}")),
    }
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
    }
    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 1 | 8) } == 0 {
        return Err(format!(
            "Atomic save failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}
#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> Result<(), String> {
    fs::rename(from, to).map_err(|e| e.to_string())
}

fn save_at(dir: &Path, key: &str, raw: &str, expected: Option<&str>) -> Result<(), String> {
    let name = filename(key)?;
    validate(key, raw)?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0);
    }
    // Cross-process lock on Windows: stale secondary clients cannot overwrite a
    // newer dictionary/workspace. A lock error fails closed, never kills a process.
    let _lock = options
        .open(dir.join("save.lock"))
        .map_err(|e| format!("Saved data is busy: {e}"))?;
    let current = read_at(dir, key)?;
    if current.as_deref() == Some(raw) {
        return Ok(());
    }
    if current.as_deref() != expected {
        return Err("Saved data changed in another client. Restart this client before saving; no data was overwritten.".into());
    }
    let token = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    if let Some(previous) = current {
        let backups = dir.join("backups");
        fs::create_dir_all(&backups).map_err(|e| e.to_string())?;
        let mut backup = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(backups.join(format!("{token}-{}-{name}", std::process::id())))
            .map_err(|e| e.to_string())?;
        backup
            .write_all(previous.as_bytes())
            .and_then(|_| backup.sync_all())
            .map_err(|e| e.to_string())?;
    }
    let temp = dir.join(format!("{name}.{token}.tmp"));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| e.to_string())?;
    file.write_all(raw.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    drop(file);
    replace_file(&temp, &dir.join(name))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserData {
    directory: String,
    dictionary: Option<String>,
    workspace: Option<String>,
}
#[tauri::command]
pub fn load_user_data() -> Result<UserData, String> {
    let dir = root()?;
    Ok(UserData {
        directory: dir.to_string_lossy().into(),
        dictionary: read_at(&dir, DICTIONARY)?,
        workspace: read_at(&dir, WORKSPACE)?,
    })
}
#[tauri::command]
pub fn save_user_data(key: String, raw: String, expected: Option<String>) -> Result<(), String> {
    save_at(&root()?, &key, &raw, expected.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn directory() -> PathBuf {
        std::env::temp_dir().join(format!(
            "vorax-data-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    const FIRST: &str =
        r#"{"version":1,"entries":[{"name":"红瘟三头犬","race":"aberrant","rarity":"boss"}]}"#;
    const SECOND: &str = r#"{"version":1,"entries":[]}"#;
    #[test]
    fn preserves_backup_and_rejects_stale_client() {
        let dir = directory();
        save_at(&dir, DICTIONARY, FIRST, None).unwrap();
        save_at(&dir, DICTIONARY, SECOND, Some(FIRST)).unwrap();
        assert_eq!(read_at(&dir, DICTIONARY).unwrap().as_deref(), Some(SECOND));
        assert!(save_at(&dir, DICTIONARY, FIRST, Some(FIRST)).is_err());
        let backups: Vec<_> = fs::read_dir(dir.join("backups")).unwrap().collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(
            fs::read_to_string(backups[0].as_ref().unwrap().path()).unwrap(),
            FIRST
        );
    }
    #[test]
    fn corrupt_primary_is_not_overwritten_by_defaults() {
        let dir = directory();
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("monster-dictionary.json"), "broken").unwrap();
        assert!(read_at(&dir, DICTIONARY).is_err());
        assert!(save_at(&dir, DICTIONARY, SECOND, None).is_err());
        assert_eq!(
            fs::read_to_string(dir.join("monster-dictionary.json")).unwrap(),
            "broken"
        );
    }
    #[test]
    fn disallows_paths_and_invalid_payloads() {
        let dir = directory();
        assert!(save_at(&dir, "../other", FIRST, None).is_err());
        assert!(save_at(&dir, DICTIONARY, "{}", None).is_err());
        assert!(!dir.exists());
    }
}
