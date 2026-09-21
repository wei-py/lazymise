mod app;
mod mise;
mod settings;
mod ui;

use std::{
    env,
    ffi::OsString,
    fs,
    io::{self, Stdout},
    path::Path,
    process::{Command, Stdio},
    sync::mpsc::{self, Receiver, TryRecvError},
    thread,
    time::Duration,
};

use anyhow::{Context, Result, anyhow, bail};
use app::{Action, App};
use crossterm::{
    event::{self, Event},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{Terminal, backend::CrosstermBackend};

fn main() -> Result<()> {
    match startup_action(env::args_os().skip(1))? {
        StartupAction::Help => {
            print!("{HELP}");
            Ok(())
        }
        StartupAction::Version => {
            println!("lazymise {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        StartupAction::Run => run_tui(),
        StartupAction::Cli(command) => run_cli(command),
    }
}

fn run_cli(command: CliCommand) -> Result<()> {
    match command {
        CliCommand::Ls => run_mise_inherited(&["ls"]),
        CliCommand::Current => run_mise_inherited(&["current"]),
        CliCommand::Outdated => run_mise_inherited(&["outdated"]),
        CliCommand::Registry { query } => {
            let mut args = vec!["registry"];
            if let Some(q) = &query {
                args.push("--json");
                // registry --json outputs JSON; filter with grep-like behavior
                let output = run_mise_text(&args)?;
                let lower = q.to_lowercase();
                for line in output.lines() {
                    if line.to_lowercase().contains(&lower) {
                        println!("{line}");
                    }
                }
                return Ok(());
            }
            run_mise_inherited(&args)
        }
        CliCommand::Install { spec } => run_mise_inherited(&["install", "--yes", &spec]),
        CliCommand::Uninstall { spec } => run_mise_inherited(&["uninstall", "--yes", &spec]),
        CliCommand::Upgrade { tools } => {
            let args: Vec<&str> = if tools.is_empty() {
                vec!["upgrade", "--yes"]
            } else {
                let mut v = vec!["upgrade", "--yes"];
                v.extend(tools.iter().map(|s| s.as_str()));
                v
            };
            run_mise_inherited(&args)
        }
        CliCommand::Run { task } => run_mise_inherited(&["run", &task]),
        CliCommand::Use { spec } => run_mise_inherited(&["use", "--yes", &spec]),
        CliCommand::Tasks => run_mise_inherited(&["tasks"]),
        CliCommand::MiseHelp { command } => {
            let mut args = vec!["help"];
            if let Some(cmd) = &command {
                args.push(cmd);
            }
            run_mise_inherited(&args)
        }
        CliCommand::Update => self_update(),
    }
}

fn run_mise_text(args: &[&str]) -> Result<String> {
    let output = Command::new("mise")
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .with_context(|| format!("failed to run mise {}", args.join(" ")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!(
            "mise {} exited with {}: {}",
            args.join(" "),
            output.status,
            stderr.trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn run_mise_inherited(args: &[&str]) -> Result<()> {
    run_inherited(
        Command::new("mise").args(args),
        &format!("mise {}", args.join(" ")),
    )
}

fn self_update() -> Result<()> {
    let current = env!("CARGO_PKG_VERSION");
    println!("lazymise {current} — checking for updates…");

    // Strategy 1: mise manages lazymise — use mise to upgrade
    if Command::new("mise")
        .args(["ls", "cargo:lazymise", "--json"])
        .output()
        .is_ok_and(|o| o.status.success())
    {
        println!("→ Updating via mise (cargo:lazymise)…");
        let status = Command::new("mise")
            .args(["install", "cargo:lazymise@latest", "--yes"])
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .context("failed to run mise install cargo:lazymise@latest")?;
        if status.success() {
            println!("✓ lazymise updated successfully via mise");
            return Ok(());
        }
        eprintln!("⚠ mise update failed, trying cargo…");
    }

    // Strategy 2: cargo install from git
    let cargo = env::var("CARGO").unwrap_or_else(|_| "cargo".into());
    println!("→ Updating via cargo install…");
    let status = Command::new(&cargo)
        .args([
            "install",
            "--git",
            "https://github.com/wei-py/lazymise",
            "--force",
        ])
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .context("failed to run cargo install")?;
    if status.success() {
        println!("✓ lazymise updated successfully via cargo");
        return Ok(());
    }

    // Strategy 3: download binary from GitHub releases
    eprintln!("⚠ cargo install failed, trying direct download…");
    download_release_binary()
}

fn download_release_binary() -> Result<()> {
    let target = target_triple()?;
    let current_exe = env::current_exe().context("cannot determine current executable path")?;

    // Fetch latest release info
    let release_json = run_curl_text(&[
        "-s",
        "-H",
        "Accept: application/vnd.github+json",
        "https://api.github.com/repos/wei-py/lazymise/releases/latest",
    ])?;

    let release: serde_json::Value =
        serde_json::from_str(&release_json).context("failed to parse GitHub release JSON")?;

    let tag = release["tag_name"]
        .as_str()
        .context("missing tag_name in release")?;

    let current = env!("CARGO_PKG_VERSION");
    let tag_version = tag.strip_prefix('v').unwrap_or(tag);
    if tag_version == current {
        println!("✓ lazymise is already at the latest version ({current})");
        return Ok(());
    }

    println!("→ Downloading lazymise {tag} for {target}…");

    let url =
        format!("https://github.com/wei-py/lazymise/releases/download/{tag}/lazymise-{target}");

    let tmp = current_exe.with_extension("tmp");
    let status = Command::new("curl")
        .args(["-fL", "-o"])
        .arg(&tmp)
        .arg(&url)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .with_context(|| format!("failed to download {url}"))?;

    if !status.success() {
        bail!("download failed for {url}");
    }

    // Make executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))
            .context("failed to set executable permission")?;
    }

    // Replace current binary
    fs::rename(&tmp, &current_exe).context(
        "failed to replace current binary — try running with sudo or from a writable location",
    )?;

    println!("✓ lazymise updated to {tag_version}");
    Ok(())
}

fn run_curl_text(args: &[&str]) -> Result<String> {
    let output = Command::new("curl")
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .context("failed to run curl")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // If stderr is empty, the output might be in stdout
        if !stderr.trim().is_empty() {
            bail!("curl failed: {}", stderr.trim());
        }
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn target_triple() -> Result<&'static str> {
    let os = if cfg!(target_os = "macos") {
        "apple-darwin"
    } else if cfg!(target_os = "linux") {
        "unknown-linux-gnu"
    } else if cfg!(target_os = "windows") {
        "pc-windows-msvc"
    } else {
        bail!("unsupported OS for binary download; use cargo install or mise instead")
    };

    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else {
        bail!("unsupported architecture for binary download; use cargo install or mise instead")
    };

    Ok(match (arch, os) {
        ("aarch64", "apple-darwin") => "aarch64-apple-darwin",
        ("x86_64", "apple-darwin") => "x86_64-apple-darwin",
        ("x86_64", "unknown-linux-gnu") => "x86_64-unknown-linux-gnu",
        ("aarch64", "unknown-linux-gnu") => "aarch64-unknown-linux-gnu",
        ("x86_64", "pc-windows-msvc") => "x86_64-pc-windows-msvc.exe",
        ("aarch64", "pc-windows-msvc") => "aarch64-pc-windows-msvc.exe",
        _ => bail!("unsupported platform combination"),
    })
}

fn run_tui() -> Result<()> {
    let mut app = App::loading();
    let _guard = TerminalGuard;
    let mut terminal = setup_terminal()?;
    let loader = Some(start_snapshot_load());
    run(&mut terminal, &mut app, loader)
}

#[derive(Debug, PartialEq, Eq)]
enum StartupAction {
    Run,
    Help,
    Version,
    Cli(CliCommand),
}

#[derive(Debug, PartialEq, Eq)]
enum CliCommand {
    Ls,
    Current,
    Outdated,
    Registry { query: Option<String> },
    Install { spec: String },
    Uninstall { spec: String },
    Upgrade { tools: Vec<String> },
    Run { task: String },
    Use { spec: String },
    Tasks,
    MiseHelp { command: Option<String> },
    Update,
}

fn startup_action(args: impl IntoIterator<Item = OsString>) -> Result<StartupAction> {
    let args: Vec<String> = args
        .into_iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();

    if args.is_empty() {
        return Ok(StartupAction::Run);
    }

    match args[0].as_str() {
        "-h" | "--help" => {
            if args.len() > 1 {
                bail!("unexpected argument `{}` after --help", args[1]);
            }
            Ok(StartupAction::Help)
        }
        "-V" | "--version" => {
            if args.len() > 1 {
                bail!("unexpected argument `{}` after --version", args[1]);
            }
            Ok(StartupAction::Version)
        }
        "ls" => {
            ensure_no_extra(&args, "ls")?;
            Ok(StartupAction::Cli(CliCommand::Ls))
        }
        "current" => {
            ensure_no_extra(&args, "current")?;
            Ok(StartupAction::Cli(CliCommand::Current))
        }
        "outdated" => {
            ensure_no_extra(&args, "outdated")?;
            Ok(StartupAction::Cli(CliCommand::Outdated))
        }
        "registry" => {
            let query = if args.len() > 1 {
                Some(args[1].clone())
            } else {
                None
            };
            if args.len() > 2 {
                bail!(
                    "unexpected extra argument after registry query: `{}`",
                    args[2]
                );
            }
            Ok(StartupAction::Cli(CliCommand::Registry { query }))
        }
        "install" => {
            let spec = require_arg(&args, "install", "<tool@version>")?;
            Ok(StartupAction::Cli(CliCommand::Install { spec }))
        }
        "uninstall" => {
            let spec = require_arg(&args, "uninstall", "<tool@version>")?;
            Ok(StartupAction::Cli(CliCommand::Uninstall { spec }))
        }
        "upgrade" => {
            let tools: Vec<String> = args.iter().skip(1).cloned().collect();
            Ok(StartupAction::Cli(CliCommand::Upgrade { tools }))
        }
        "run" => {
            let task = require_arg(&args, "run", "<task>")?;
            Ok(StartupAction::Cli(CliCommand::Run { task }))
        }
        "use" => {
            let spec = require_arg(&args, "use", "<tool@version>")?;
            Ok(StartupAction::Cli(CliCommand::Use { spec }))
        }
        "tasks" => {
            ensure_no_extra(&args, "tasks")?;
            Ok(StartupAction::Cli(CliCommand::Tasks))
        }
        "help" => {
            let command = if args.len() > 1 {
                Some(args[1].clone())
            } else {
                None
            };
            if args.len() > 2 {
                bail!("unexpected extra argument after help: `{}`", args[2]);
            }
            Ok(StartupAction::Cli(CliCommand::MiseHelp { command }))
        }
        "update" => {
            ensure_no_extra(&args, "update")?;
            Ok(StartupAction::Cli(CliCommand::Update))
        }
        other => {
            if other.starts_with('-') {
                bail!("unknown option `{other}`; use `lazymise --help`",);
            }
            bail!("unknown command `{other}`; use `lazymise --help`",);
        }
    }
}

fn require_arg(args: &[String], command: &str, spec: &str) -> Result<String> {
    if args.len() < 2 {
        bail!("`lazymise {command}` requires an argument: {spec}");
    }
    if args.len() > 2 {
        bail!(
            "unexpected extra argument after `{command} {}`: `{}`",
            args[1],
            args[2]
        );
    }
    Ok(args[1].clone())
}

fn ensure_no_extra(args: &[String], command: &str) -> Result<()> {
    if args.len() > 1 {
        bail!("unexpected argument `{}` for `lazymise {command}`", args[1]);
    }
    Ok(())
}

const HELP: &str = concat!(
    "lazymise ",
    env!("CARGO_PKG_VERSION"),
    "\n",
    env!("CARGO_PKG_DESCRIPTION"),
    "\n\n",
    "Usage: lazymise [COMMAND] [OPTIONS]\n\n",
    "Commands:\n",
    "  (no command)          Launch the interactive TUI\n",
    "  ls                    List installed tools\n",
    "  current               Show current tool versions\n",
    "  outdated              Check for outdated tools\n",
    "  registry [QUERY]      Search the tool registry\n",
    "  install <TOOL@VER>    Install a tool version\n",
    "  uninstall <TOOL@VER>  Uninstall a tool version\n",
    "  upgrade [TOOLS...]    Upgrade tools (all if none specified)\n",
    "  use <TOOL@VER>        Set tool version in current scope\n",
    "  run <TASK>            Run a mise task\n",
    "  tasks                 List available tasks\n",
    "  help [COMMAND]        Show mise help\n",
    "  update                Update lazymise to the latest version\n",
    "\n",
    "Options:\n",
    "  -h, --help            Print help\n",
    "  -V, --version         Print version\n",
    "\n",
    "Examples:\n",
    "  lazymise                  # Open TUI\n",
    "  lazymise ls               # List tools\n",
    "  lazymise install node@22  # Install node 22\n",
    "  lazymise run dev          # Run \"dev\" task\n",
    "  lazymise update           # Self-update\n",
);

type SnapshotReceiver = Receiver<Result<mise::Snapshot>>;

fn start_snapshot_load() -> SnapshotReceiver {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let _ = sender.send(mise::load_snapshot());
    });
    receiver
}

fn run(
    terminal: &mut AppTerminal,
    app: &mut App,
    mut loader: Option<SnapshotReceiver>,
) -> Result<()> {
    loop {
        if let Some(receiver) = &loader {
            match receiver.try_recv() {
                Ok(result) => {
                    app.finish_loading(result);
                    loader = None;
                }
                Err(TryRecvError::Empty) => {}
                Err(TryRecvError::Disconnected) => {
                    app.finish_loading(Err(anyhow!("mise loader stopped unexpectedly")));
                    loader = None;
                }
            }
        }
        terminal.draw(|frame| ui::render(frame, app))?;

        if !event::poll(Duration::from_millis(250))? {
            continue;
        }
        let Event::Key(key) = event::read()? else {
            continue;
        };
        if !key.is_press() {
            continue;
        }

        match app.handle_key(key) {
            Action::None => {}
            Action::Quit => return Ok(()),
            Action::RunTask(name) => {
                let command = format!("mise run {name}");
                let result = run_outside_tui(terminal, || run_mise_task(&name));
                app.record_external(command, &result);
            }
            Action::EditConfig(path) => {
                let command = format!("edit {}", path.display());
                let result = run_outside_tui(terminal, || open_editor(&path));
                app.record_external(command, &result);
            }
            Action::Upgrade(tools) => {
                let mut args = vec!["upgrade".into(), "--yes".into()];
                args.extend(tools);
                run_managed(terminal, app, args)?;
            }
            Action::UseVersion {
                tool,
                version,
                scope,
            } => {
                let mut args = vec!["use".into(), "--yes".into()];
                if scope == app::Scope::Global {
                    args.push("--global".into());
                }
                args.push(format!("{tool}@{version}"));
                run_managed(terminal, app, args)?;
            }
            Action::InstallVersion { tool, version } => {
                run_managed(
                    terminal,
                    app,
                    vec![
                        "install".into(),
                        "--yes".into(),
                        format!("{tool}@{version}"),
                    ],
                )?;
            }
            Action::DeleteVersion { tool, version } => {
                run_managed(
                    terminal,
                    app,
                    vec![
                        "uninstall".into(),
                        "--yes".into(),
                        format!("{tool}@{version}"),
                    ],
                )?;
            }
            Action::RunMise(args) => {
                if captures_palette_output(&args) {
                    run_managed(terminal, app, args)?;
                } else {
                    let command = format!("mise {}", args.join(" "));
                    let result = run_outside_tui(terminal, || run_mise_args(&args));
                    app.record_external(command, &result);
                }
            }
        }
    }
}

type AppTerminal = Terminal<CrosstermBackend<Stdout>>;

fn setup_terminal() -> Result<AppTerminal> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    Terminal::new(CrosstermBackend::new(stdout)).context("failed to initialize terminal")
}

fn suspend_terminal(terminal: &mut AppTerminal) -> Result<()> {
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    Ok(())
}

fn resume_terminal(terminal: &mut AppTerminal) -> Result<()> {
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;
    enable_raw_mode()?;
    terminal.clear()?;
    Ok(())
}

fn restore_terminal() {
    let _ = disable_raw_mode();
    let _ = execute!(io::stdout(), LeaveAlternateScreen);
}

fn run_outside_tui<F>(terminal: &mut AppTerminal, operation: F) -> Result<()>
where
    F: FnOnce() -> Result<()>,
{
    suspend_terminal(terminal)?;
    let result = operation();
    let resume_result = resume_terminal(terminal);
    match (result, resume_result) {
        (Err(error), _) => Err(error),
        (Ok(()), Err(error)) => Err(error),
        (Ok(()), Ok(())) => Ok(()),
    }
}

fn captures_palette_output(args: &[String]) -> bool {
    args.first().is_some_and(|command| {
        matches!(
            command.as_str(),
            "activate"
                | "backends"
                | "bin-paths"
                | "completion"
                | "deactivate"
                | "doctor"
                | "env"
                | "latest"
                | "ls"
                | "ls-remote"
                | "outdated"
                | "patrons"
                | "registry"
                | "search"
                | "sponsors"
                | "tasks"
                | "token"
                | "tool"
                | "version"
                | "where"
                | "which"
                | "help"
        )
    })
}

fn run_managed(terminal: &mut AppTerminal, app: &mut App, args: Vec<String>) -> Result<()> {
    app.status = format!("Running mise {}…", args.join(" "));
    terminal.draw(|frame| ui::render(frame, app))?;
    app.finish_command(mise::execute(&args));
    Ok(())
}

fn run_mise_args(args: &[String]) -> Result<()> {
    run_inherited(Command::new("mise").args(args), "mise command")
}

fn run_mise_task(name: &str) -> Result<()> {
    run_inherited(Command::new("mise").args(["run", name]), "mise task")
}

fn open_editor(path: &Path) -> Result<()> {
    let editor = env::var("VISUAL")
        .or_else(|_| env::var("EDITOR"))
        .unwrap_or_else(|_| "vi".into());
    let mut parts = shell_words::split(&editor).context("invalid $VISUAL or $EDITOR")?;
    if parts.is_empty() {
        bail!("$VISUAL or $EDITOR is empty");
    }
    let program = parts.remove(0);
    let mut command = Command::new(program);
    command.args(parts).arg(path);
    run_inherited(&mut command, "editor")
}

fn run_inherited(command: &mut Command, description: &str) -> Result<()> {
    let status = command
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .with_context(|| format!("failed to start {description}"))?;
    if !status.success() {
        bail!("{description} exited with {status}");
    }
    Ok(())
}

struct TerminalGuard;

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        restore_terminal();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(|s| OsString::from(*s)).collect()
    }

    // ── legacy flags ──

    #[test]
    fn recognizes_noninteractive_startup_flags() {
        assert_eq!(startup_action(args(&[])).unwrap(), StartupAction::Run);
        assert_eq!(
            startup_action(args(&["--help"])).unwrap(),
            StartupAction::Help
        );
        assert_eq!(
            startup_action(args(&["-V"])).unwrap(),
            StartupAction::Version
        );
    }

    #[test]
    fn rejects_legacy_extra_arguments() {
        assert!(startup_action(args(&["--help", "extra"])).is_err());
        assert!(startup_action(args(&["-V", "extra"])).is_err());
    }

    // ── CLI subcommands ──

    #[test]
    fn cli_ls() {
        assert_eq!(
            startup_action(args(&["ls"])).unwrap(),
            StartupAction::Cli(CliCommand::Ls)
        );
        assert!(startup_action(args(&["ls", "extra"])).is_err());
    }

    #[test]
    fn cli_current() {
        assert_eq!(
            startup_action(args(&["current"])).unwrap(),
            StartupAction::Cli(CliCommand::Current)
        );
    }

    #[test]
    fn cli_outdated() {
        assert_eq!(
            startup_action(args(&["outdated"])).unwrap(),
            StartupAction::Cli(CliCommand::Outdated)
        );
    }

    #[test]
    fn cli_registry() {
        assert_eq!(
            startup_action(args(&["registry"])).unwrap(),
            StartupAction::Cli(CliCommand::Registry { query: None })
        );
        assert_eq!(
            startup_action(args(&["registry", "node"])).unwrap(),
            StartupAction::Cli(CliCommand::Registry {
                query: Some("node".into())
            })
        );
        assert!(startup_action(args(&["registry", "a", "b"])).is_err());
    }

    #[test]
    fn cli_install() {
        assert_eq!(
            startup_action(args(&["install", "node@22"])).unwrap(),
            StartupAction::Cli(CliCommand::Install {
                spec: "node@22".into()
            })
        );
        assert!(startup_action(args(&["install"])).is_err());
        assert!(startup_action(args(&["install", "node@22", "extra"])).is_err());
    }

    #[test]
    fn cli_uninstall() {
        assert_eq!(
            startup_action(args(&["uninstall", "node@22"])).unwrap(),
            StartupAction::Cli(CliCommand::Uninstall {
                spec: "node@22".into()
            })
        );
        assert!(startup_action(args(&["uninstall"])).is_err());
    }

    #[test]
    fn cli_upgrade() {
        assert_eq!(
            startup_action(args(&["upgrade"])).unwrap(),
            StartupAction::Cli(CliCommand::Upgrade { tools: vec![] })
        );
        assert_eq!(
            startup_action(args(&["upgrade", "node", "python"])).unwrap(),
            StartupAction::Cli(CliCommand::Upgrade {
                tools: vec!["node".into(), "python".into()]
            })
        );
    }

    #[test]
    fn cli_run() {
        assert_eq!(
            startup_action(args(&["run", "dev"])).unwrap(),
            StartupAction::Cli(CliCommand::Run { task: "dev".into() })
        );
        assert!(startup_action(args(&["run"])).is_err());
    }

    #[test]
    fn cli_use() {
        assert_eq!(
            startup_action(args(&["use", "node@22"])).unwrap(),
            StartupAction::Cli(CliCommand::Use {
                spec: "node@22".into()
            })
        );
        assert!(startup_action(args(&["use"])).is_err());
    }

    #[test]
    fn cli_tasks() {
        assert_eq!(
            startup_action(args(&["tasks"])).unwrap(),
            StartupAction::Cli(CliCommand::Tasks)
        );
    }

    #[test]
    fn cli_help() {
        assert_eq!(
            startup_action(args(&["help"])).unwrap(),
            StartupAction::Cli(CliCommand::MiseHelp { command: None })
        );
        assert_eq!(
            startup_action(args(&["help", "install"])).unwrap(),
            StartupAction::Cli(CliCommand::MiseHelp {
                command: Some("install".into())
            })
        );
        assert!(startup_action(args(&["help", "a", "b"])).is_err());
    }

    #[test]
    fn cli_update() {
        assert_eq!(
            startup_action(args(&["update"])).unwrap(),
            StartupAction::Cli(CliCommand::Update)
        );
        assert!(startup_action(args(&["update", "extra"])).is_err());
    }

    #[test]
    fn rejects_unknown_command() {
        assert!(startup_action(args(&["unknown"])).is_err());
    }

    #[test]
    fn rejects_unknown_flag() {
        assert!(startup_action(args(&["--unknown"])).is_err());
    }

    #[test]
    fn help_describes_all_commands() {
        assert!(HELP.contains("Usage: lazymise [COMMAND]"));
        assert!(HELP.contains("--help"));
        assert!(HELP.contains("--version"));
        for cmd in &[
            "ls",
            "current",
            "outdated",
            "registry",
            "install",
            "uninstall",
            "upgrade",
            "use",
            "run",
            "tasks",
            "help",
            "update",
        ] {
            assert!(
                HELP.contains(&format!("  {cmd}")),
                "HELP should mention `{cmd}`"
            );
        }
    }
}
