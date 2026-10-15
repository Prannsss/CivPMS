//! Running ffmpeg/ffprobe safely: absolute executable paths, an empty environment (no secrets
//! inherited by the child), no stdin, a hard timeout, and the child killed when the timeout
//! fires or the request is cancelled.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

/// Captured output of a finished tool run.
#[derive(Debug)]
pub struct ToolOutput {
    pub success: bool,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

/// Why a tool run did not produce output.
#[derive(Debug, thiserror::Error)]
pub enum ToolError {
    #[error("could not start {0}: {1}")]
    Spawn(String, std::io::Error),
    #[error("{0} timed out after {1:?} and was killed")]
    Timeout(String, Duration),
    #[error("{0} failed while running: {1}")]
    Io(String, std::io::Error),
}

/// Resolves a program name through `PATH` once, at startup, so children can run with an
/// empty environment.
pub fn resolve_executable(program: &Path) -> Option<PathBuf> {
    if program.components().count() > 1 {
        return program.is_file().then(|| program.to_path_buf());
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|dir| dir.join(program)).find(|candidate| candidate.is_file())
}

/// Runs `program args…` and waits at most `timeout`.
pub async fn run(program: &Path, args: &[OsString], timeout: Duration) -> Result<ToolOutput, ToolError> {
    let name = program.file_name().map_or_else(|| "tool".to_owned(), |n| n.to_string_lossy().into_owned());
    let child = Command::new(program)
        .args(args)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| ToolError::Spawn(name.clone(), e))?;
    // Dropping the future on timeout drops the child, which kills it (`kill_on_drop`).
    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(output)) => Ok(ToolOutput {
            success: output.status.success(),
            stdout: output.stdout,
            stderr: truncate(&String::from_utf8_lossy(&output.stderr), 2_000),
        }),
        Ok(Err(e)) => Err(ToolError::Io(name, e)),
        Err(_) => Err(ToolError::Timeout(name, timeout)),
    }
}

fn truncate(text: &str, max: usize) -> String {
    let trimmed = text.trim();
    if trimmed.len() <= max {
        return trimmed.to_owned();
    }
    let mut end = max;
    while !trimmed.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &trimmed[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_programs_on_path() {
        assert!(resolve_executable(Path::new("sh")).is_some());
        assert!(resolve_executable(Path::new("definitely-not-a-real-program-xyz")).is_none());
        assert!(resolve_executable(Path::new("/nonexistent/ffmpeg")).is_none());
    }

    #[tokio::test]
    async fn kills_on_timeout() {
        let sh = resolve_executable(Path::new("sh")).unwrap();
        let started = std::time::Instant::now();
        let result = run(&sh, &["-c".into(), "sleep 5".into()], Duration::from_millis(200)).await;
        assert!(matches!(result, Err(ToolError::Timeout(..))));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    async fn children_get_an_empty_environment() {
        let sh = resolve_executable(Path::new("sh")).unwrap();
        let out = run(&sh, &["-c".into(), "env".into()], Duration::from_secs(5)).await.unwrap();
        let env = String::from_utf8_lossy(&out.stdout);
        assert!(!env.contains("PATH=/"), "PATH leaked into the child: {env}");
    }

    #[test]
    fn truncates_on_char_boundaries() {
        assert_eq!(truncate("ééé", 3), "é…");
        assert_eq!(truncate(" short ", 10), "short");
    }
}
