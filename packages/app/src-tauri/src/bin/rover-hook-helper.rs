//! Rover Hook Helper - Ultra-lightweight native CLI hook ingestion and reporting binary.
//!
//! Architecture Invariants (TRD Section 5 & M1-3):
//! 1. Millisecond cold-start performance (<5ms).
//! 2. Zero-pollution isolation: If ROVER_DISPATCH_ATTEMPT_ID is absent, silently exit with 0 immediately.
//! 3. Atomic Spool persistence: Atomically write envelopes into ~/Library/Application Support/Rover/spool.
//! 4. Capability-secured report command for Code Agent DoD/progress submission.

use serde::Serialize;
use std::env;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Serialize)]
struct SpoolEnvelope {
    #[serde(rename = "attemptId")]
    attempt_id: String,
    event: String,
    timestamp: u128,
    payload: serde_json::Value,
    #[serde(rename = "agentType", skip_serializing_if = "Option::is_none")]
    agent_type: Option<String>,
    #[serde(rename = "reservedTaskUuid", skip_serializing_if = "Option::is_none")]
    reserved_task_uuid: Option<String>,
}

#[derive(Serialize)]
struct ReportEnvelope {
    #[serde(rename = "attemptId")]
    attempt_id: String,
    token: String,
    event: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<String>,
    timestamp: u128,
}

fn get_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn resolve_spool_dir() -> PathBuf {
    if let Ok(custom) = env::var("ROVER_SPOOL_DIR") {
        if !custom.trim().is_empty() {
            return PathBuf::from(custom.trim());
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = env::var("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("Rover")
                .join("spool");
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(app_data) = env::var("APPDATA") {
            return PathBuf::from(app_data).join("Rover").join("spool");
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if let Ok(home) = env::var("HOME") {
            return PathBuf::from(home).join(".local").join("share").join("rover").join("spool");
        }
    }

    env::temp_dir().join("rover").join("spool")
}

fn atomic_write_spool(spool_dir: &Path, content: &[u8]) -> io::Result<PathBuf> {
    fs::create_dir_all(spool_dir)?;

    let unique_id = Uuid::new_v4().to_string();
    let timestamp = get_timestamp_ms();

    let temp_filename = format!("tmp_{}.tmp", unique_id);
    let target_filename = format!("{}_{}.json", timestamp, unique_id);

    let temp_path = spool_dir.join(&temp_filename);
    let target_path = spool_dir.join(&target_filename);

    {
        let mut file = File::create(&temp_path)?;
        file.write_all(content)?;
        file.sync_all()?;
    }

    fs::rename(&temp_path, &target_path)?;
    Ok(target_path)
}

fn handle_report(args: &[String]) -> io::Result<()> {
    let mut attempt_id = env::var("ROVER_DISPATCH_ATTEMPT_ID").ok();
    let mut token = env::var("ROVER_REPORT_TOKEN").ok();
    let mut status = String::from("in_progress");
    let mut result = None;
    let mut summary = None;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--attempt-id" if i + 1 < args.len() => {
                attempt_id = Some(args[i + 1].clone());
                i += 2;
            }
            "--token" if i + 1 < args.len() => {
                token = Some(args[i + 1].clone());
                i += 2;
            }
            "--status" if i + 1 < args.len() => {
                status = args[i + 1].clone();
                i += 2;
            }
            "--result" if i + 1 < args.len() => {
                result = Some(args[i + 1].clone());
                i += 2;
            }
            "--summary" if i + 1 < args.len() => {
                summary = Some(args[i + 1].clone());
                i += 2;
            }
            _ => {
                i += 1;
            }
        }
    }

    let final_attempt_id = match attempt_id {
        Some(id) if !id.trim().is_empty() => id.trim().to_string(),
        _ => {
            eprintln!("Error: Missing required --attempt-id or ROVER_DISPATCH_ATTEMPT_ID");
            std::process::exit(1);
        }
    };

    let final_token = match token {
        Some(tok) if !tok.trim().is_empty() => tok.trim().to_string(),
        _ => {
            eprintln!("Error: Missing required --token or ROVER_REPORT_TOKEN");
            std::process::exit(1);
        }
    };

    let envelope = ReportEnvelope {
        attempt_id: final_attempt_id,
        token: final_token,
        event: "Report".to_string(),
        status,
        result,
        summary,
        timestamp: get_timestamp_ms(),
    };

    let json_bytes = serde_json::to_vec_pretty(&envelope)?;
    let spool_dir = resolve_spool_dir();
    atomic_write_spool(&spool_dir, &json_bytes)?;

    println!(r#"{{"ok":true,"message":"Report recorded"}}"#);
    Ok(())
}

fn handle_ingest(event_name: &str) -> io::Result<()> {
    // Defense Line 1: Zero pollution on external manual terminal sessions
    let attempt_id = match env::var("ROVER_DISPATCH_ATTEMPT_ID") {
        Ok(id) if !id.trim().is_empty() => id.trim().to_string(),
        _ => {
            // Unconditionally exit 0 without any stderr or disk writes
            std::process::exit(0);
        }
    };

    // Read payload from stdin with a 2MB cap
    let mut stdin_buf = Vec::new();
    io::stdin().take(2 * 1024 * 1024).read_to_end(&mut stdin_buf)?;

    let payload: serde_json::Value = if stdin_buf.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_slice(&stdin_buf)
            .unwrap_or_else(|_| serde_json::Value::String(String::from_utf8_lossy(&stdin_buf).into_owned()))
    };

    let agent_type = env::var("ROVER_AGENT_TYPE").ok();
    let reserved_task_uuid = env::var("ROVER_RESERVED_TASK_UUID").ok();

    let envelope = SpoolEnvelope {
        attempt_id,
        event: event_name.to_string(),
        timestamp: get_timestamp_ms(),
        payload,
        agent_type,
        reserved_task_uuid,
    };

    let json_bytes = serde_json::to_vec(&envelope)?;
    let spool_dir = resolve_spool_dir();
    atomic_write_spool(&spool_dir, &json_bytes)?;

    Ok(())
}

fn main() {
    let raw_args: Vec<String> = env::args().skip(1).collect();

    if raw_args.is_empty() {
        // Default to ingest "HookEvent"
        if let Err(e) = handle_ingest("HookEvent") {
            eprintln!("rover-hook-helper error: {}", e);
            std::process::exit(1);
        }
        return;
    }

    match raw_args[0].as_str() {
        "-V" | "--version" => {
            println!("rover-hook-helper 0.1.0");
        }
        "report" => {
            if let Err(e) = handle_report(&raw_args[1..]) {
                eprintln!("rover-hook-helper report error: {}", e);
                std::process::exit(1);
            }
        }
        "ingest" => {
            let event = if raw_args.len() > 1 {
                raw_args[1].as_str()
            } else {
                "HookEvent"
            };
            if let Err(e) = handle_ingest(event) {
                eprintln!("rover-hook-helper ingest error: {}", e);
                std::process::exit(1);
            }
        }
        custom_event => {
            // Any positional argument treated as the hook event name
            if let Err(e) = handle_ingest(custom_event) {
                eprintln!("rover-hook-helper error: {}", e);
                std::process::exit(1);
            }
        }
    }
}
