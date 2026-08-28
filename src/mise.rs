use std::{collections::BTreeMap, path::PathBuf, process::Command};

use anyhow::{Context, Result, bail};
use serde::Deserialize;
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tool {
    pub name: String,
    pub version: String,
    pub requested: String,
    pub source: Option<PathBuf>,
    pub installed: bool,
    pub active: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Update {
    pub name: String,
    pub current: String,
    pub latest: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Task {
    pub name: String,
    pub description: String,
    pub command: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    pub path: PathBuf,
    pub tools: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct RegistryTool {
    #[serde(rename = "short")]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub backends: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct RemoteVersion {
    pub version: String,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandOutput {
    pub command: String,
    pub output: String,
    pub success: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandSpec {
    pub name: String,
    pub description: String,
}

#[derive(Clone, Debug)]
pub struct Snapshot {
    pub mise_version: String,
    pub tools: Vec<Tool>,
    pub updates: Vec<Update>,
    pub tasks: Vec<Task>,
    pub configs: Vec<Config>,
}

impl Default for Snapshot {
    fn default() -> Self {
        Self {
            mise_version: "loading…".into(),
            tools: Vec::new(),
            updates: Vec::new(),
            tasks: Vec::new(),
            configs: Vec::new(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct ToolRecord {
    version: String,
    #[serde(default)]
    requested_version: String,
    source: Option<ToolSource>,
    #[serde(default)]
    installed: bool,
    #[serde(default)]
    active: bool,
}

#[derive(Debug, Deserialize)]
struct ToolSource {
    path: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
struct ConfigRecord {
    path: PathBuf,
    #[serde(default)]
    tools: Vec<String>,
}

pub fn load_snapshot() -> Result<Snapshot> {
    Ok(Snapshot {
        mise_version: run_text(&["--version"])?.trim().to_owned(),
        tools: parse_tools(&run_json(&["ls", "--json"])?)?,
        updates: parse_updates(&run_json(&["outdated", "--json"])?)?,
        tasks: parse_tasks(&run_json(&["tasks", "--json"])?)?,
        configs: parse_configs(&run_json(&["config", "ls", "--json"])?)?,
    })
}

pub fn registry() -> Result<Vec<RegistryTool>> {
    let mut tools: Vec<RegistryTool> = serde_json::from_str(&run_json(&["registry", "--json"])?)
        .context("invalid JSON from mise registry --json")?;
    tools.sort_by(|a, b| a.name.cmp(&b.name));
    tools.dedup_by(|a, b| a.name == b.name);
    Ok(tools)
}

pub fn remote_versions(tool: &str) -> Result<Vec<RemoteVersion>> {
    let mut versions: Vec<RemoteVersion> =
        serde_json::from_str(&run_json(&["ls-remote", tool, "--json"])?)
            .with_context(|| format!("invalid JSON from mise ls-remote {tool} --json"))?;
    versions.reverse();
    Ok(versions)
}

pub fn execute(args: &[String]) -> Result<CommandOutput> {
    let output = Command::new("mise")
        .args(args)
        .output()
        .with_context(|| "failed to start mise; install mise and ensure it is on PATH")?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = match (stdout.trim().is_empty(), stderr.trim().is_empty()) {
        (false, false) => format!("{}\n{}", stdout.trim_end(), stderr.trim_end()),

        (false, true) => stdout.into_owned(),
        (true, false) => stderr.into_owned(),
        (true, true) => "(no output)".into(),
    };
    Ok(CommandOutput {
        command: format!("mise {}", args.join(" ")),
        output: combined,
        success: output.status.success(),
    })
}
pub fn command_catalog() -> Result<Vec<CommandSpec>> {
    parse_command_catalog(&run_text(&["-h"])?)
}

pub fn command_help(command: &str) -> Result<String> {
    run_text(&[command, "-h"])
}

fn parse_command_catalog(input: &str) -> Result<Vec<CommandSpec>> {
    let mut commands = Vec::new();
    let mut in_commands = false;

    for line in input.lines() {
        if line == "Commands:" {
            in_commands = true;
            continue;
        }
        if !in_commands {
            continue;
        }
        if matches!(line, "Arguments:" | "Flags:" | "Options:") {
            break;
        }

        let trimmed = line.trim_start();
        let indent = line.len() - trimmed.len();
        if indent == 2 && !trimmed.is_empty() {
            let mut parts = trimmed.splitn(2, char::is_whitespace);
            let name = parts.next().unwrap_or_default();
            let description = parts.next().unwrap_or_default().trim();
            if !name.is_empty() {
                commands.push(CommandSpec {
                    name: name.into(),
                    description: description.into(),
                });
            }
        } else if indent > 2
            && let Some(command) = commands.last_mut()
        {
            if !command.description.is_empty() {
                command.description.push(' ');
            }
            command.description.push_str(trimmed);
        }
    }

    if commands.is_empty() {
        bail!("mise -h returned no commands");
    }
    Ok(commands)
}

fn run_json(args: &[&str]) -> Result<String> {
    run_text(args)
}

fn run_text(args: &[&str]) -> Result<String> {
    let output = Command::new("mise")
        .args(args)
        .output()
        .with_context(|| "failed to start mise; install mise and ensure it is on PATH")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("mise {} failed: {}", args.join(" "), stderr.trim());
    }

    String::from_utf8(output.stdout).context("mise returned non-UTF-8 output")
}

fn parse_tools(input: &str) -> Result<Vec<Tool>> {
    let records: BTreeMap<String, Vec<ToolRecord>> =
        serde_json::from_str(input).context("invalid JSON from mise ls --json")?;
    let mut tools = Vec::new();

    for (name, versions) in records {
        for record in versions {
            tools.push(Tool {
                name: name.clone(),
                requested: if record.requested_version.is_empty() {
                    record.version.clone()
                } else {
                    record.requested_version
                },
                version: record.version,
                source: record.source.and_then(|source| source.path),
                installed: record.installed,
                active: record.active,
            });
        }
    }

    tools.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| b.active.cmp(&a.active)));
    Ok(tools)
}

fn parse_updates(input: &str) -> Result<Vec<Update>> {
    let value: Value =
        serde_json::from_str(input).context("invalid JSON from mise outdated --json")?;
    let Some(entries) = value.as_object() else {
        bail!("mise outdated --json returned an unexpected shape");
    };
    let mut updates = Vec::new();

    for (name, entry) in entries {
        let Some(entry) = entry.as_object() else {
            continue;
        };
        let current = string_field(entry, &["current", "version"]);
        let latest = string_field(entry, &["latest", "new_version"]);
        if let (Some(current), Some(latest)) = (current, latest)
            && current != latest
        {
            updates.push(Update {
                name: name.clone(),
                current,
                latest,
            });
        }
    }

    updates.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(updates)
}

fn parse_tasks(input: &str) -> Result<Vec<Task>> {
    let value: Value =
        serde_json::from_str(input).context("invalid JSON from mise tasks --json")?;
    let Some(entries) = value.as_array() else {
        bail!("mise tasks --json returned an unexpected shape");
    };
    let mut tasks = Vec::new();

    for entry in entries {
        let Some(entry) = entry.as_object() else {
            continue;
        };
        let Some(name) = string_field(entry, &["name"]) else {
            continue;
        };
        let description = string_field(entry, &["description"]).unwrap_or_default();
        let command = entry.get("run").map(display_command).unwrap_or_default();
        tasks.push(Task {
            name,
            description,
            command,
        });
    }

    tasks.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(tasks)
}

fn parse_configs(input: &str) -> Result<Vec<Config>> {
    let records: Vec<ConfigRecord> =
        serde_json::from_str(input).context("invalid JSON from mise config ls --json")?;
    Ok(records
        .into_iter()
        .map(|record| Config {
            path: record.path,
            tools: record.tools,
        })
        .collect())
}

fn string_field(object: &serde_json::Map<String, Value>, names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| {
        object.get(*name).and_then(|value| match value {
            Value::String(value) => Some(value.clone()),
            Value::Number(value) => Some(value.to_string()),
            _ => None,
        })
    })
}

fn display_command(value: &Value) -> String {
    match value {
        Value::String(command) => command.clone(),
        Value::Array(commands) => commands
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" && "),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tool_versions_and_sources() {
        let tools = parse_tools(
            r#"{"node":[{"version":"22.1.0","requested_version":"22","source":{"path":"/tmp/mise.toml"},"installed":true,"active":true}]}"#,
        )
        .unwrap();

        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "node");
        assert_eq!(tools[0].requested, "22");
        assert_eq!(tools[0].source, Some(PathBuf::from("/tmp/mise.toml")));
        assert!(tools[0].active);
    }

    #[test]
    fn parses_updates_and_ignores_current_versions() {
        let updates = parse_updates(
            r#"{"node":{"current":"22.1.0","latest":"22.2.0"},"python":{"current":"3.14","latest":"3.14"}}"#,
        )
        .unwrap();

        assert_eq!(
            updates,
            vec![Update {
                name: "node".into(),
                current: "22.1.0".into(),
                latest: "22.2.0".into(),
            }]
        );
    }

    #[test]
    fn parses_string_and_array_task_commands() {
        let tasks = parse_tasks(
            r#"[{"name":"build","description":"Build app","run":["cargo fmt","cargo build"]},{"name":"dev","run":"cargo run"}]"#,
        )
        .unwrap();

        assert_eq!(tasks[0].command, "cargo fmt && cargo build");
        assert_eq!(tasks[1].command, "cargo run");
    }

    #[test]
    fn parses_every_top_level_help_command_and_wrapped_description() {
        let commands = parse_command_catalog(
            "mise help\nCommands:\n  activate      Initialize the shell\n  deps          Manage project dependencies\n                across roots\n  use           Install and configure a tool\nArguments:\n  [TASK]\n",
        )
        .unwrap();

        assert_eq!(
            commands,
            vec![
                CommandSpec {
                    name: "activate".into(),
                    description: "Initialize the shell".into(),
                },
                CommandSpec {
                    name: "deps".into(),
                    description: "Manage project dependencies across roots".into(),
                },
                CommandSpec {
                    name: "use".into(),
                    description: "Install and configure a tool".into(),
                },
            ]
        );
    }
}
