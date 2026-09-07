//! Immutable per-event files, independent of the workspace and monster dictionary.
use serde::Serialize;
use std::{fs, fs::OpenOptions, io::Write, path::Path};

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}
fn validate(run_id: &str, event_id: &str, raw: &str) -> Result<(), String> {
    if !valid_id(run_id) || !valid_id(event_id) || raw.len() > 1024 * 1024 { return Err("Invalid recording ID or event exceeds 1 MB".into()); }
    let v: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    if v["schemaVersion"] != 1 || v["runId"] != run_id || v["id"] != event_id
        || !v["sequence"].as_u64().is_some_and(|n| n > 0)
        || !v["type"].as_str().is_some_and(|t| ["start", "capture", "choice", "gap", "end"].contains(&t)) {
        return Err("Invalid recording event; original files preserved".into());
    }
    Ok(())
}
fn save_at(root: &Path, run_id: &str, event_id: &str, raw: &str) -> Result<(), String> {
    validate(run_id, event_id, raw)?;
    let dir = root.join(run_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(windows)] {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0);
    }
    let _lock = options.open(dir.join("save.lock")).map_err(|e| format!("Recording busy: {e}"))?;
    let target = dir.join(format!("{event_id}.json"));
    match fs::read_to_string(&target) {
        Ok(previous) if previous == raw => return Ok(()),
        Ok(_) => return Err("Recording event conflict; no overwrite".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(e) => return Err(e.to_string()),
    }
    let token = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let temp = dir.join(format!("{event_id}-{token}.tmp"));
    let mut f = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|e| e.to_string())?;
    f.write_all(raw.as_bytes()).and_then(|_| f.sync_all()).map_err(|e| e.to_string())?;
    drop(f);
    crate::user_data::replace_file(&temp, &target)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunListing { run_id: String, event_count: usize, modified_ms: u128 }
#[tauri::command]
pub fn save_recording_event(run_id: String, event_id: String, raw: String) -> Result<(), String> {
    save_at(&crate::user_data::root()?.join("recorded-runs"), &run_id, &event_id, &raw)
}
#[tauri::command]
pub fn list_recorded_runs() -> Result<Vec<RunListing>, String> {
    let root = crate::user_data::root()?.join("recorded-runs");
    if !root.exists() { return Ok(vec![]); }
    let mut list = vec![];
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let run_id = entry.file_name().to_string_lossy().into_owned();
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() || !valid_id(&run_id) { continue; }
        let mut event_count = 0;
        let mut modified_ms = 0;
        for file in fs::read_dir(entry.path()).map_err(|e| e.to_string())? {
            let file = file.map_err(|e| e.to_string())?;
            if file.path().extension().is_some_and(|s| s == "json") {
                event_count += 1;
                modified_ms = modified_ms.max(file.metadata().and_then(|m| m.modified()).map_err(|e| e.to_string())?.duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis());
            }
        }
        list.push(RunListing { run_id, event_count, modified_ms });
    }
    list.sort_by(|a,b| b.modified_ms.cmp(&a.modified_ms));
    Ok(list)
}
#[tauri::command]
pub fn read_recorded_run(run_id: String) -> Result<Vec<String>, String> {
    if !valid_id(&run_id) { return Err("Invalid recording ID".into()); }
    let dir = crate::user_data::root()?.join("recorded-runs").join(&run_id);
    let mut result = vec![];
    let mut size = 0;
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().is_none_or(|s| s != "json") { continue; }
        size += fs::metadata(&path).map_err(|e| e.to_string())?.len();
        if size > 32 * 1024 * 1024 { return Err("Run exceeds 32 MB preview limit. Original event files remain in recorded-runs; export them from disk.".into()); }
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let id = path.file_stem().and_then(|s| s.to_str()).ok_or("Invalid event filename")?;
        validate(&run_id, id, &raw)?;
        result.push(raw);
    }
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn immutable_retry_and_invalid_targets() {
        let dir = std::env::temp_dir().join(format!("vorax-journal-test-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let raw = r#"{"schemaVersion":1,"runId":"run-1","id":"event-1","sequence":1,"type":"start"}"#;
        assert!(save_at(&dir, "../outside", "event-1", raw).is_err());
        assert!(!dir.exists());
        save_at(&dir, "run-1", "event-1", raw).unwrap();
        save_at(&dir, "run-1", "event-1", raw).unwrap();
        assert!(save_at(&dir, "run-1", "event-1", &raw.replace("start", "gap")).is_err());
        assert_eq!(fs::read_to_string(dir.join("run-1/event-1.json")).unwrap(), raw);
        assert!(!dir.join("monster-dictionary.json").exists());
    }
}
