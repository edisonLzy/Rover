use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct RuntimeConnectionInfo {
    pub port: u16,
    pub host: String,
    pub token: String,
    pub http_url: String,
    pub ws_url: String,
}

pub fn generate_auth_token() -> String {
    format!("rover_{}", uuid::Uuid::new_v4().simple())
}

fn parse_ready(line: &str, expected_token: &str) -> Result<RuntimeConnectionInfo, String> {
    if !line.starts_with("[READY]") {
        return Err("Unexpected sidecar output before readiness".into());
    }

    let mut port = None;
    let mut host = None;
    let mut token = None;
    for part in line.split_whitespace().skip(1) {
        if let Some(value) = part.strip_prefix("port=") {
            port = value.parse::<u16>().ok().filter(|value| *value != 0);
        } else if let Some(value) = part.strip_prefix("host=") {
            host = Some(value);
        } else if let Some(value) = part.strip_prefix("token=") {
            token = Some(value);
        }
    }

    let port = port.ok_or_else(|| "Sidecar did not report a valid port".to_string())?;
    if host != Some("127.0.0.1") || token != Some(expected_token) {
        return Err("Sidecar reported unexpected host or token".into());
    }

    Ok(RuntimeConnectionInfo {
        port,
        host: "127.0.0.1".into(),
        token: expected_token.into(),
        http_url: format!("http://127.0.0.1:{port}"),
        ws_url: format!("ws://127.0.0.1:{port}/v1/events"),
    })
}

pub struct NodeSidecarManager {
    child: Option<CommandChild>,
    alive: Arc<AtomicBool>,
    connection_info: RuntimeConnectionInfo,
}

impl NodeSidecarManager {
    pub fn start(
        app: &tauri::AppHandle,
        preferred_port: Option<u16>,
        preferred_token: Option<String>,
    ) -> Result<Self, String> {
        // Port zero lets the runtime bind atomically and report the assigned port.
        let port = preferred_port.unwrap_or(0);
        let token = preferred_token.unwrap_or_else(generate_auth_token);
        #[cfg(debug_assertions)]
        let runtime_command = {
            let runtime_entry = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../runtime/dist/index.js");
            if !runtime_entry.is_file() {
                return Err(format!(
                    "Development runtime is missing at {}. Run `pnpm dev` so Tauri can build it first.",
                    runtime_entry.display()
                ));
            }
            app.shell().command("node").arg(runtime_entry)
        };

        #[cfg(not(debug_assertions))]
        let runtime_command = app
            .shell()
            .sidecar("rover-runtime")
            .map_err(|error| format!("Bundled runtime sidecar is unavailable: {error}"))?;

        let (mut events, child) = runtime_command
            .args([
                format!("--port={port}"),
                format!("--token={token}"),
                "--host=127.0.0.1".into(),
            ])
            .spawn()
            .map_err(|error| format!("Failed to start runtime process: {error}"))?;

        let alive = Arc::new(AtomicBool::new(true));
        let alive_for_events = alive.clone();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        tauri::async_runtime::spawn(async move {
            let mut ready_sent = false;
            while let Some(event) = events.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        let line = String::from_utf8_lossy(&bytes);
                        let line = line.trim();
                        if line.starts_with("[READY]") && !ready_sent {
                            let _ = ready_tx.send(parse_ready(line, &token));
                            ready_sent = true;
                        } else if !line.is_empty() {
                            println!("[Rover Runtime] {line}");
                        }
                    }
                    CommandEvent::Stderr(bytes) => {
                        eprintln!("[Rover Runtime] {}", String::from_utf8_lossy(&bytes).trim());
                    }
                    CommandEvent::Error(error) => {
                        eprintln!("[Rover Runtime] Process error: {error}");
                        if !ready_sent {
                            let _ = ready_tx.send(Err(error));
                            ready_sent = true;
                        }
                    }
                    CommandEvent::Terminated(status) => {
                        eprintln!("[Rover Runtime] Exited with status {:?}", status.code);
                        alive_for_events.store(false, Ordering::SeqCst);
                        if !ready_sent {
                            let _ = ready_tx.send(Err("Runtime exited before readiness".into()));
                            ready_sent = true;
                        }
                    }
                    _ => {}
                }
            }
            alive_for_events.store(false, Ordering::SeqCst);
            if !ready_sent {
                let _ = ready_tx.send(Err("Runtime event stream closed before readiness".into()));
            }
        });

        let connection_info = match ready_rx.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(info)) => info,
            Ok(Err(error)) => {
                let _ = child.kill();
                return Err(error);
            }
            Err(error) => {
                let _ = child.kill();
                return Err(format!("Timed out waiting for runtime readiness: {error}"));
            }
        };

        println!("[Rover] Runtime ready at {}", connection_info.http_url);
        Ok(Self {
            child: Some(child),
            alive,
            connection_info,
        })
    }

    pub fn connection_info(&self) -> Option<&RuntimeConnectionInfo> {
        self.is_alive().then_some(&self.connection_info)
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    pub fn stop(&mut self) {
        if let Some(child) = self.child.take() {
            let _ = child.kill();
            self.alive.store(false, Ordering::SeqCst);
        }
    }
}

impl Drop for NodeSidecarManager {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_signal_uses_runtime_bound_port() {
        let info = parse_ready("[READY] port=58123 host=127.0.0.1 token=secret", "secret").unwrap();
        assert_eq!(info.http_url, "http://127.0.0.1:58123");
        assert!(parse_ready("[READY] port=0 host=127.0.0.1 token=secret", "secret").is_err());
        assert!(parse_ready("[READY] port=58123 host=0.0.0.0 token=secret", "secret").is_err());
    }

    #[test]
    fn auth_token_changes_each_start() {
        assert_ne!(generate_auth_token(), generate_auth_token());
    }
}
