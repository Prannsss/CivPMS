//! Running ffmpeg/ffprobe safely: absolute executable paths, an empty environment (no secrets
//! inherited by the child), no stdin, a hard timeout, and the child killed when the timeout
//! fires or the request is cancelled.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};
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
    std::env::split_paths(&path)
        .map(|dir| dir.join(program))
        .find(|candidate| candidate.is_file())
}

/// Runs `program args…` and waits at most `timeout`.
///
/// On timeout the child is killed **and reaped** before returning (no zombies). If the
/// calling future is dropped instead (request cancelled), `kill_on_drop` kills the child and
/// Tokio's orphan reaper collects it.
pub async fn run(
    program: &Path,
    args: &[OsString],
    timeout: Duration,
) -> Result<ToolOutput, ToolError> {
    let name = program
        .file_name()
        .map_or_else(|| "tool".to_owned(), |n| n.to_string_lossy().into_owned());
    let mut child = Command::new(program)
        .args(args)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| ToolError::Spawn(name.clone(), e))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let outcome = tokio::time::timeout(timeout, async {
        tokio::try_join!(read_all(stdout), read_all(stderr), child.wait())
    })
    .await;
    match outcome {
        Ok(Ok((stdout, stderr, status))) => Ok(ToolOutput {
            success: status.success(),
            stdout,
            stderr: truncate(&String::from_utf8_lossy(&stderr), 2_000),
        }),
        Ok(Err(e)) => {
            let _ = child.kill().await;
            Err(ToolError::Io(name, e))
        }
        Err(_) => {
            // `kill` sends SIGKILL and waits for the exit status, so the process is reaped.
            if let Err(e) = child.kill().await {
                tracing::warn!(tool = %name, error = %e, "could not kill timed-out child");
            }
            Err(ToolError::Timeout(name, timeout))
        }
    }
}

async fn read_all<R: AsyncRead + Unpin>(stream: Option<R>) -> std::io::Result<Vec<u8>> {
    let mut buffer = Vec::new();
    if let Some(mut stream) = stream {
        stream.read_to_end(&mut buffer).await?;
    }
    Ok(buffer)
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
        let result = run(
            &sh,
            &["-c".into(), "sleep 5".into()],
            Duration::from_millis(200),
        )
        .await;
        assert!(matches!(result, Err(ToolError::Timeout(..))));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    async fn timed_out_children_are_reaped() {
        let sh = resolve_executable(Path::new("sh")).unwrap();
        // `exec` replaces the shell, so the pid we kill is the sleeping process itself.
        let script = "echo $$ > \"$0\"; exec sleep 30";
        let dir = tempfile::tempdir().unwrap();
        let pid_file = dir.path().join("pid");
        let args = [
            "-c".into(),
            script.into(),
            pid_file.clone().into_os_string(),
        ];
        let result = run(&sh, &args, Duration::from_millis(300)).await;
        assert!(matches!(result, Err(ToolError::Timeout(..))));
        let pid = std::fs::read_to_string(&pid_file)
            .unwrap()
            .trim()
            .to_owned();
        // Reaped: the pid no longer exists at all (a zombie would still have /proc/<pid>).
        assert!(
            !Path::new(&format!("/proc/{pid}")).exists(),
            "child {pid} was not reaped"
        );
    }

    #[tokio::test]
    async fn children_get_an_empty_environment() {
        let sh = resolve_executable(Path::new("sh")).unwrap();
        let out = run(&sh, &["-c".into(), "env".into()], Duration::from_secs(5))
            .await
            .unwrap();
        let env = String::from_utf8_lossy(&out.stdout);
        assert!(!env.contains("PATH=/"), "PATH leaked into the child: {env}");
    }

    #[test]
    fn truncates_on_char_boundaries() {
        assert_eq!(truncate("ééé", 3), "é…");
        assert_eq!(truncate(" short ", 10), "short");
    }
}
