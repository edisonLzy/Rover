use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct RuntimeConnectionInfo {
    pub port: u16,
    pub host: String,
    pub token: String,
    pub http_url: String,
    pub ws_url: String,
}

/// Dynamically binds to 127.0.0.1:0 to obtain an available port from the OS, then drops the listener.
pub fn allocate_available_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind to 127.0.0.1:0 to probe port: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to retrieve local address: {}", e))?
        .port();
    drop(listener);
    Ok(port)
}

/// Generates a high-entropy random authentication token.
pub fn generate_auth_token() -> String {
    format!("rover_{}", uuid::Uuid::new_v4().simple())
}

/// Searches upwards from current directory to locate the Rover workspace root.
pub fn find_workspace_root() -> Option<PathBuf> {
    let mut current = std::env::current_dir().ok()?;
    for _ in 0..8 {
        if current.join("pnpm-workspace.yaml").exists() {
            return Some(current);
        }
        if !current.pop() {
            break;
        }
    }
    None
}

/// Resolves the Node.js executable path across development and packaged environments.
pub fn resolve_node_binary() -> Result<PathBuf, String> {
    // 0. Explicit override via environment variable
    if let Ok(path) = std::env::var("NODE_PATH") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    // 1. Direct "node" / "node.exe" command check in PATH
    let node_cmd = if cfg!(windows) { "node.exe" } else { "node" };
    if let Ok(output) = Command::new(node_cmd).arg("--version").output() {
        if output.status.success() {
            return Ok(PathBuf::from(node_cmd));
        }
    }
    if cfg!(windows) {
        if let Ok(output) = Command::new("node").arg("--version").output() {
            if output.status.success() {
                return Ok(PathBuf::from("node"));
            }
        }
    }

    // 2. Common platform-specific paths
    let mut candidates = Vec::new();

    #[cfg(windows)]
    {
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            candidates.push(format!("{}\\nodejs\\node.exe", program_files));
        }
        if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
            candidates.push(format!("{}\\nodejs\\node.exe", program_files_x86));
        }
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            candidates.push(format!("{}\\Programs\\node\\node.exe", local_app_data));
        }
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            candidates.push(format!("{}\\.fnm\\current\\node.exe", user_profile));
            candidates.push(format!("{}\\.proto\\bin\\node.exe", user_profile));
        }
    }

    #[cfg(not(windows))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        candidates.push(format!("{}/.n/bin/node", home));
        candidates.push(format!("{}/.proto/bin/node", home));
        candidates.push("/opt/homebrew/bin/node".to_string());
        candidates.push("/usr/local/bin/node".to_string());
        candidates.push("/usr/bin/node".to_string());
    }

    for candidate in candidates {
        let path = PathBuf::from(&candidate);
        if path.exists() {
            return Ok(path);
        }
    }

    Err("Node.js binary not found. Please ensure Node 22+ is installed and accessible in PATH.".into())
}

/// Locates the entrypoint of packages/runtime.
pub fn resolve_runtime_entry(workspace_root: &Path) -> Result<PathBuf, String> {
    // 1. Prefer compiled dist/index.js
    let dist_entry = workspace_root
        .join("packages")
        .join("runtime")
        .join("dist")
        .join("index.js");
    if dist_entry.exists() {
        return Ok(dist_entry);
    }

    // 2. Check if source index.ts exists
    let src_entry = workspace_root
        .join("packages")
        .join("runtime")
        .join("src")
        .join("index.ts");
    if src_entry.exists() {
        return Ok(src_entry);
    }

    Err(format!(
        "Runtime entrypoint not found in workspace at {}",
        workspace_root.display()
    ))
}

pub struct NodeSidecarManager {
    child: Option<Child>,
    connection_info: Option<RuntimeConnectionInfo>,
}

impl NodeSidecarManager {
    /// Launches the Node.js runtime sidecar, passes allocated port & token,
    /// and waits for the [READY] signal from stdout.
    pub fn start(
        preferred_port: Option<u16>,
        preferred_token: Option<String>,
    ) -> Result<Self, String> {
        let port = match preferred_port {
            Some(p) => p,
            None => allocate_available_port()?,
        };
        let token = preferred_token.unwrap_or_else(generate_auth_token);

        let workspace_root = find_workspace_root()
            .ok_or_else(|| "Failed to locate Rover workspace root".to_string())?;

        let node_bin = resolve_node_binary()?;
        let runtime_entry = resolve_runtime_entry(&workspace_root)?;

        println!(
            "[Rover Rust] Spawning Node runtime sidecar via {:?} with entry {:?} on port {}",
            node_bin, runtime_entry, port
        );

        let mut command = Command::new(&node_bin);
        command
            .arg(&runtime_entry)
            .arg(format!("--port={}", port))
            .arg(format!("--token={}", token))
            .arg("--host=127.0.0.1")
            .current_dir(&workspace_root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to spawn Node sidecar: {}", e))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture sidecar stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture sidecar stderr".to_string())?;

        let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<RuntimeConnectionInfo, String>>(1);

        // Background thread to monitor stdout for [READY] signal
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            let mut ready_sent = false;

            for line_res in reader.lines() {
                match line_res {
                    Ok(line) => {
                        let trimmed = line.trim();
                        println!("[Node Runtime stdout] {}", trimmed);

                        if trimmed.starts_with("[READY]") && !ready_sent {
                            // Format: [READY] port=1234 host=127.0.0.1 token=xyz
                            let mut actual_port = port;
                            let mut actual_host = "127.0.0.1".to_string();
                            let mut actual_token = token.clone();

                            for part in trimmed.split_whitespace() {
                                if let Some(p) = part.strip_prefix("port=") {
                                    if let Ok(num) = p.parse::<u16>() {
                                        actual_port = num;
                                    }
                                } else if let Some(h) = part.strip_prefix("host=") {
                                    actual_host = h.to_string();
                                } else if let Some(t) = part.strip_prefix("token=") {
                                    actual_token = t.to_string();
                                }
                            }

                            let info = RuntimeConnectionInfo {
                                port: actual_port,
                                host: actual_host.clone(),
                                token: actual_token,
                                http_url: format!("http://{}:{}", actual_host, actual_port),
                                ws_url: format!("ws://{}:{}/v1/events", actual_host, actual_port),
                            };

                            let _ = ready_tx.send(Ok(info));
                            ready_sent = true;
                        }
                    }
                    Err(_) => break,
                }
            }

            if !ready_sent {
                let _ = ready_tx.send(Err("Node process closed stdout without [READY] signal".into()));
            }
        });

        // Background thread to capture stderr logs
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line_res in reader.lines().flatten() {
                eprintln!("[Node Runtime stderr] {}", line_res);
            }
        });

        // Wait for [READY] signal with a 10s timeout
        let connection_info = match ready_rx.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(info)) => info,
            Ok(Err(err)) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Node runtime failed during startup: {}", err));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Timed out waiting for [READY] signal from Node runtime (10s)".into());
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Ready channel disconnected prematurely".into());
            }
        };

        println!(
            "[Rover Rust] Node runtime sidecar is READY at {}",
            connection_info.http_url
        );

        Ok(Self {
            child: Some(child),
            connection_info: Some(connection_info),
        })
    }

    pub fn connection_info(&self) -> Option<&RuntimeConnectionInfo> {
        self.connection_info.as_ref()
    }

    pub fn is_alive(&mut self) -> bool {
        if let Some(ref mut child) = self.child {
            match child.try_wait() {
                Ok(None) => true,
                _ => false,
            }
        } else {
            false
        }
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            println!(
                "[Rover Rust] Terminating Node sidecar process (PID: {})...",
                child.id()
            );
            let _ = child.kill();
            let _ = child.wait();
            println!("[Rover Rust] Node sidecar process terminated.");
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
    fn test_allocate_available_port() {
        let port1 = allocate_available_port().expect("should allocate port 1");
        let port2 = allocate_available_port().expect("should allocate port 2");
        assert!(port1 > 0);
        assert!(port2 > 0);
    }

    #[test]
    fn test_generate_auth_token() {
        let token1 = generate_auth_token();
        let token2 = generate_auth_token();
        assert!(token1.starts_with("rover_"));
        assert!(token2.starts_with("rover_"));
        assert_ne!(token1, token2);
        assert!(token1.len() > 20);
    }

    #[test]
    fn test_find_workspace_root() {
        let root = find_workspace_root().expect("workspace root must be found");
        assert!(root.join("pnpm-workspace.yaml").exists());
        assert!(root.join("packages/runtime").exists());
    }

    #[test]
    fn test_resolve_node_binary() {
        let node = resolve_node_binary().expect("node binary must be resolved");
        println!("Resolved node: {:?}", node);
    }

    #[test]
    fn test_sidecar_lifecycle_and_handshake() {
        let mut supervisor = NodeSidecarManager::start(None, None)
            .expect("NodeSidecarManager should start and report ready");

        let info = supervisor
            .connection_info()
            .cloned()
            .expect("should have connection info");

        assert!(info.port > 0);
        assert_eq!(info.host, "127.0.0.1");
        assert!(info.token.starts_with("rover_"));
        assert!(supervisor.is_alive());

        supervisor.stop();
        assert!(!supervisor.is_alive());
    }
}
