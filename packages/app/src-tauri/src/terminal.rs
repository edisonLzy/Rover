//! Terminal.app Automation & Takeover/Resume Handler for macOS.
//!
//! Implements TRD Section 5:
//! Automates Terminal.app using AppleScript (osascript) to attach to GNU Screen sessions
//! or execute native CLI resume commands.
//! Detects Apple Events authorization errors (-1743) and returns actionable repair instructions.

use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Deserialize, Serialize)]
pub struct TerminalLaunchPayload {
    pub command: String,
    pub cwd: Option<String>,
}

#[tauri::command]
pub fn open_terminal(payload: TerminalLaunchPayload) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let mut shell_cmd = String::new();
        if let Some(ref cwd) = payload.cwd {
            if !cwd.trim().is_empty() {
                let escaped_cwd = cwd.replace('\'', "'\\''");
                shell_cmd.push_str(&format!("cd '{}' && ", escaped_cwd));
            }
        }
        shell_cmd.push_str(&payload.command);

        // Escape for AppleScript string literal
        let escaped_for_applescript = shell_cmd.replace('\\', "\\\\").replace('"', "\\\"");

        let script = format!(
            "tell application \"Terminal\"\n    activate\n    do script \"{}\"\nend tell",
            escaped_for_applescript
        );

        let output = Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .map_err(|e| format!("Failed to spawn osascript: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("-1743") || stderr.to_lowercase().contains("not authorized") {
                return Err("Terminal.app automation permission denied (Apple Events error -1743). Please grant Automation permission to Rover under macOS System Settings > Privacy & Security > Automation.".to_string());
            }
            return Err(format!("Terminal.app automation failed: {}", stderr.trim()));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(stdout)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = payload;
        Err("Terminal.app automation is only supported on macOS".to_string())
    }
}
