mod app;
mod mise;
mod settings;
mod ui;

use std::{
    env,
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
    let mut app = App::loading();
    let _guard = TerminalGuard;
    let mut terminal = setup_terminal()?;
    let loader = Some(start_snapshot_load());
    run(&mut terminal, &mut app, loader)
}

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
                Err(TryRecvError::Empty) => app.tick(),
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
