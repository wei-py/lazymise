use std::{collections::HashSet, path::PathBuf};

use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

use crate::{
    mise::{self, CommandOutput, CommandSpec, RegistryTool, RemoteVersion, Snapshot},
    settings::{Locale, Settings},
};

const TOOL_COMMANDS: &[&str] = &[
    "backends",
    "install",
    "install-into",
    "latest",
    "link",
    "ls",
    "ls-remote",
    "plugins",
    "prune",
    "registry",
    "reshim",
    "search",
    "sync",
    "test-tool",
    "tool",
    "tool-alias",
    "tool-stub",
    "uninstall",
    "unuse",
    "use",
    "where",
];
const UPDATE_COMMANDS: &[&str] = &["outdated", "prune", "upgrade"];
const TASK_COMMANDS: &[&str] = &["deps", "run", "tasks", "watch"];
const ENVIRONMENT_COMMANDS: &[&str] = &[
    "activate",
    "bin-paths",
    "deactivate",
    "en",
    "env",
    "exec",
    "shell",
    "shell-alias",
    "which",
];
const CONFIG_COMMANDS: &[&str] = &[
    "config", "edit", "fmt", "lock", "set", "settings", "trust", "unset", "untrust",
];
const SYSTEM_COMMANDS: &[&str] = &[
    "bootstrap",
    "cache",
    "completion",
    "doctor",
    "generate",
    "help",
    "implode",
    "mcp",
    "oci",
    "patrons",
    "self-update",
    "sponsors",
    "token",
    "version",
];
const DASHBOARD_COMMANDS: &[&str] = &["bootstrap", "doctor", "help", "self-update", "version"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Page {
    Dashboard,
    Tools,
    Updates,
    Tasks,
    Environment,
    Config,
    System,
    Preferences,
    Logs,
}

impl Page {
    pub const ALL: [Page; 9] = [
        Page::Dashboard,
        Page::Tools,
        Page::Updates,
        Page::Tasks,
        Page::Environment,
        Page::Config,
        Page::System,
        Page::Preferences,
        Page::Logs,
    ];

    pub const fn localized_title(self, locale: Locale) -> &'static str {
        match self {
            Page::Dashboard => locale.text("Dashboard", "概览"),
            Page::Tools => locale.text("Tools", "工具"),
            Page::Updates => locale.text("Updates", "更新"),
            Page::Tasks => locale.text("Tasks", "任务"),
            Page::Environment => locale.text("Environment", "环境"),
            Page::Config => locale.text("Config", "配置"),
            Page::System => locale.text("System", "系统"),
            Page::Preferences => locale.text("Preferences", "设置"),
            Page::Logs => locale.text("Command Log", "命令日志"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Focus {
    Navigation,
    List,
    Details,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    Project,
    Global,
}

impl Scope {
    pub const fn title(self) -> &'static str {
        match self {
            Scope::Project => "PROJECT",
            Scope::Global => "GLOBAL",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VersionIntent {
    Add,
    Use,
    Install,
}

#[derive(Clone, Debug)]
pub enum Picker {
    Registry {
        items: Vec<RegistryTool>,
        selected: usize,
        query: String,
        searching: bool,
    },
    Versions {
        tool: String,
        items: Vec<RemoteVersion>,
        selected: usize,
        query: String,
        searching: bool,
        intent: VersionIntent,
    },
}

impl Picker {
    pub fn query(&self) -> &str {
        match self {
            Picker::Registry { query, .. } | Picker::Versions { query, .. } => query,
        }
    }

    pub fn selected(&self) -> usize {
        match self {
            Picker::Registry { selected, .. } | Picker::Versions { selected, .. } => *selected,
        }
    }

    pub fn searching(&self) -> bool {
        match self {
            Picker::Registry { searching, .. } | Picker::Versions { searching, .. } => *searching,
        }
    }

    pub fn title(&self, locale: Locale) -> String {
        match self {
            Picker::Registry { .. } => locale.text("Add tool", "添加工具").into(),
            Picker::Versions { tool, intent, .. } => {
                let action = match intent {
                    VersionIntent::Add => locale.text("Add", "添加"),
                    VersionIntent::Use => locale.text("Use", "启用"),
                    VersionIntent::Install => locale.text("Install", "安装"),
                };
                if locale == Locale::Chinese {
                    format!("{action} {tool} 版本")
                } else {
                    format!("{action} {tool} version")
                }
            }
        }
    }

    pub fn visible_len(&self) -> usize {
        match self {
            Picker::Registry { items, query, .. } => items
                .iter()
                .filter(|item| registry_matches(item, query))
                .count(),
            Picker::Versions { items, query, .. } => items
                .iter()
                .filter(|item| version_matches(item, query))
                .count(),
        }
    }
}

#[derive(Clone, Debug)]
pub enum Overlay {
    None,
    Help,
    Search,
    Picker(Picker),
    CommandPalette {
        title: String,
        items: Vec<CommandSpec>,
        selected: usize,
        query: String,
        searching: bool,
    },
    CommandBuilder {
        spec: CommandSpec,
        arguments: String,
        help: String,
    },
    CustomTool {
        input: String,
    },
    ConfirmDelete {
        tool: String,
        version: String,
    },
    ConfirmCommand {
        args: Vec<String>,
    },
}

#[derive(Debug, PartialEq, Eq)]
pub enum Action {
    None,
    Quit,
    RunTask(String),
    EditConfig(PathBuf),
    Upgrade(Vec<String>),
    UseVersion {
        tool: String,
        version: String,
        scope: Scope,
    },
    InstallVersion {
        tool: String,
        version: String,
    },
    DeleteVersion {
        tool: String,
        version: String,
    },
    RunMise(Vec<String>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandLog {
    pub command: String,
    pub output: String,
    pub success: bool,
}

pub struct App {
    pub page: Page,
    pub focus: Focus,
    pub scope: Scope,
    pub locale: Locale,
    pub snapshot: Snapshot,
    pub selected: usize,
    pub detail_scroll: u16,
    pub selected_updates: HashSet<String>,
    pub search: String,
    pub status: String,
    pub overlay: Overlay,
    pub logs: Vec<CommandLog>,
    pub commands: Vec<CommandSpec>,
    pub loading: bool,
}

impl App {
    pub fn loading() -> Self {
        let settings = Settings::load().unwrap_or_default();
        Self {
            page: Page::Dashboard,
            focus: Focus::Navigation,
            scope: Scope::Project,
            locale: settings.language,
            snapshot: Snapshot::default(),
            selected: 0,
            detail_scroll: 0,
            selected_updates: HashSet::new(),
            search: String::new(),
            status: settings.language.text("Ready", "就绪").into(),
            overlay: Overlay::None,
            logs: Vec::new(),
            commands: Vec::new(),
            loading: true,
        }
    }

    pub fn finish_loading(&mut self, result: Result<Snapshot>) {
        self.loading = false;
        match result {
            Ok(snapshot) => {
                self.apply_snapshot(snapshot);
                match mise::command_catalog() {
                    Ok(commands) => self.commands = commands,
                    Err(error) => {
                        self.logs.push(CommandLog {
                            command: "mise -h".into(),
                            output: format!("{error:#}"),
                            success: false,
                        });
                    }
                }
                self.status = self.locale.text("Ready", "就绪").into();
            }
            Err(error) => {
                self.status = format!(
                    "{}: {error:#}",
                    self.locale.text("Unable to load mise", "无法加载 mise")
                );
                self.logs.push(CommandLog {
                    command: "initial mise environment load".into(),
                    output: format!("{error:#}"),
                    success: false,
                });
            }
        }
    }

    pub fn refresh(&mut self) {
        match mise::load_snapshot() {
            Ok(snapshot) => {
                self.apply_snapshot(snapshot);
                self.status = self
                    .locale
                    .text("Refreshed mise state", "已刷新 mise 状态")
                    .into();
            }
            Err(error) => {
                self.status = format!(
                    "{}: {error:#}",
                    self.locale.text("Refresh failed", "刷新失败")
                )
            }
        }
    }

    fn apply_snapshot(&mut self, snapshot: Snapshot) {
        self.snapshot = snapshot;
        self.selected_updates.retain(|name| {
            self.snapshot
                .updates
                .iter()
                .any(|update| &update.name == name)
        });
        self.clamp_selection();
    }

    pub fn handle_key(&mut self, key: KeyEvent) -> Action {
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            return Action::Quit;
        }
        if !matches!(self.overlay, Overlay::None) {
            return self.handle_overlay_key(key);
        }

        match key.code {
            KeyCode::Char(':') => self.open_command_catalog(),
            KeyCode::Char('m') => self.open_context_commands(),
            KeyCode::Char('q') => return Action::Quit,
            KeyCode::Char('?') => self.overlay = Overlay::Help,
            KeyCode::Char('/') => self.overlay = Overlay::Search,
            KeyCode::Char('r') => self.refresh(),
            KeyCode::Char('p') => self.set_scope(Scope::Project),
            KeyCode::Char('G') => self.set_scope(Scope::Global),
            KeyCode::Char('a') => self.open_registry(),
            KeyCode::Char('A') => self.open_custom_tool(),
            KeyCode::Char('v') if self.page == Page::Tools && self.focus == Focus::List => {
                self.open_versions_for_selected(VersionIntent::Use);
            }
            KeyCode::Char('i') if self.page == Page::Tools && self.focus == Focus::List => {
                self.open_versions_for_selected(VersionIntent::Install);
            }
            KeyCode::Char('d')
                if self.page == Page::Tools
                    && self.focus == Focus::List
                    && !key.modifiers.contains(KeyModifiers::CONTROL) =>
            {
                self.confirm_delete_selected();
            }
            KeyCode::Char(' ') if self.page == Page::Updates && self.focus == Focus::List => {
                self.toggle_selected_update();
            }
            KeyCode::Char('U') if self.page == Page::Updates => {
                let tools: Vec<String> = if self.selected_updates.is_empty() {
                    self.snapshot
                        .updates
                        .iter()
                        .map(|update| update.name.clone())
                        .collect()
                } else {
                    self.selected_updates.iter().cloned().collect()
                };
                if !tools.is_empty() {
                    return Action::Upgrade(tools);
                }
            }
            KeyCode::Tab => self.cycle_focus(1),
            KeyCode::BackTab => self.cycle_focus(-1),
            KeyCode::Char('g') => self.jump_to_page(Page::Dashboard),
            KeyCode::Char('u') if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.jump_to_page(Page::Updates);
            }
            KeyCode::Char('t') => self.jump_to_page(Page::Tasks),
            KeyCode::Char('E') => self.jump_to_page(Page::Environment),
            KeyCode::Char('c') => self.jump_to_page(Page::Config),
            KeyCode::Char('s') => self.jump_to_page(Page::System),
            KeyCode::Char('o') => self.jump_to_page(Page::Preferences),
            KeyCode::Char('x') => self.jump_to_page(Page::Logs),
            KeyCode::Char('[') => self.change_page(-1),
            KeyCode::Char(']') => self.change_page(1),
            KeyCode::Char('d') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.move_vertical(5);
            }
            KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.move_vertical(-5);
            }
            KeyCode::Home if self.focus == Focus::List => self.selected = 0,
            KeyCode::End if self.focus == Focus::List => {
                self.selected = self.current_list_len().saturating_sub(1);
            }
            KeyCode::Char('1') => self.jump_to_page(Page::Dashboard),
            KeyCode::Char('2') => self.jump_to_page(Page::Tools),
            KeyCode::Char('3') => self.jump_to_page(Page::Updates),
            KeyCode::Char('4') => self.jump_to_page(Page::Tasks),
            KeyCode::Char('5') => self.jump_to_page(Page::Environment),
            KeyCode::Char('6') => self.jump_to_page(Page::Config),
            KeyCode::Char('7') => self.jump_to_page(Page::System),
            KeyCode::Char('8') => self.jump_to_page(Page::Preferences),
            KeyCode::Esc => self.focus = Focus::Navigation,
            KeyCode::Left | KeyCode::Char('h') => self.move_focus(-1),
            KeyCode::Right | KeyCode::Char('l') => self.move_focus(1),
            KeyCode::Down | KeyCode::Char('j') => self.move_vertical(1),
            KeyCode::Up | KeyCode::Char('k') => self.move_vertical(-1),
            KeyCode::Enter if self.focus == Focus::Navigation => self.focus = Focus::List,
            KeyCode::Enter if self.page == Page::Preferences => self.toggle_language(),
            KeyCode::Enter if self.page == Page::Tasks => {
                if let Some(task) = self.selected_task() {
                    return Action::RunTask(task.name.clone());
                }
            }
            KeyCode::Enter
                if self.focus == Focus::List
                    && matches!(self.page, Page::Environment | Page::System) =>
            {
                self.open_selected_page_command();
            }
            KeyCode::Char('e') if self.focus == Focus::List && self.page == Page::Config => {
                if let Some(config) = self.selected_config() {
                    return Action::EditConfig(config.path.clone());
                }
            }
            _ => {}
        }
        Action::None
    }

    pub fn finish_command(&mut self, result: Result<CommandOutput>) {
        match result {
            Ok(result) => {
                let success = result.success;
                self.status = if success {
                    format!(
                        "{} {}",
                        result.command,
                        self.locale.text("completed", "已完成")
                    )
                } else {
                    format!(
                        "{} {}",
                        result.command,
                        self.locale
                            .text("failed; press x for output", "失败；按 x 查看输出")
                    )
                };
                self.logs.push(CommandLog {
                    command: result.command,
                    output: result.output,
                    success,
                });
                if self.logs.len() > 100 {
                    self.logs.remove(0);
                }
                if success {
                    self.selected_updates.clear();
                    self.refresh();
                }
            }
            Err(error) => {
                self.status = format!(
                    "{}: {error:#}",
                    self.locale.text("Command failed", "命令失败")
                );
                self.logs.push(CommandLog {
                    command: "mise".into(),
                    output: format!("{error:#}"),
                    success: false,
                });
            }
        }
    }

    pub fn record_external(&mut self, command: String, result: &Result<()>) {
        let (success, output) = match result {
            Ok(()) => (true, "Interactive command completed".into()),
            Err(error) => (false, format!("{error:#}")),
        };
        self.logs.push(CommandLog {
            command,
            output,
            success,
        });
        if success {
            self.refresh();
        } else {
            self.status = self
                .locale
                .text(
                    "Command failed; press x for output",
                    "命令失败；按 x 查看输出",
                )
                .into();
        }
    }

    pub fn selected_tool(&self) -> Option<&crate::mise::Tool> {
        self.snapshot
            .tools
            .iter()
            .filter(|tool| self.matches(&tool.name, &tool.version))
            .nth(self.selected)
    }

    pub fn command_visible_on_page(&self, command: &CommandSpec) -> bool {
        command_belongs_to_page(self.page, &command.name)
            && self.matches(&command.name, &command.description)
    }

    pub fn selected_page_command(&self) -> Option<&CommandSpec> {
        self.commands
            .iter()
            .filter(|command| command_belongs_to_page(self.page, &command.name))
            .filter(|command| self.matches(&command.name, &command.description))
            .nth(self.selected)
    }

    pub fn selected_update(&self) -> Option<&crate::mise::Update> {
        self.snapshot
            .updates
            .iter()
            .filter(|update| self.matches(&update.name, &update.current))
            .nth(self.selected)
    }

    pub fn selected_task(&self) -> Option<&crate::mise::Task> {
        self.snapshot
            .tasks
            .iter()
            .filter(|task| self.matches(&task.name, &task.description))
            .nth(self.selected)
    }

    pub fn selected_config(&self) -> Option<&crate::mise::Config> {
        self.snapshot
            .configs
            .iter()
            .filter(|config| {
                self.matches(&config.path.display().to_string(), &config.tools.join(" "))
            })
            .nth(self.selected)
    }

    pub fn selected_log(&self) -> Option<&CommandLog> {
        self.logs
            .iter()
            .rev()
            .filter(|log| self.matches(&log.command, &log.output))
            .nth(self.selected)
    }

    pub fn matches(&self, primary: &str, secondary: &str) -> bool {
        self.search.is_empty()
            || contains_case_insensitive(primary, &self.search)
            || contains_case_insensitive(secondary, &self.search)
    }

    fn handle_overlay_key(&mut self, key: KeyEvent) -> Action {
        let overlay = std::mem::replace(&mut self.overlay, Overlay::None);
        match overlay {
            Overlay::None => Action::None,
            Overlay::Help => {
                if !matches!(
                    key.code,
                    KeyCode::Esc | KeyCode::Char('?') | KeyCode::Char('q')
                ) {
                    self.overlay = Overlay::Help;
                }
                Action::None
            }
            Overlay::Search => {
                match key.code {
                    KeyCode::Enter => self.clamp_selection(),
                    KeyCode::Esc => {
                        self.search.clear();
                        self.selected = 0;
                    }
                    KeyCode::Backspace => {
                        self.search.pop();
                        self.selected = 0;
                        self.overlay = Overlay::Search;
                    }
                    KeyCode::Char(character)
                        if !key
                            .modifiers
                            .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
                    {
                        self.search.push(character);
                        self.selected = 0;
                        self.overlay = Overlay::Search;
                    }
                    _ => self.overlay = Overlay::Search,
                }
                Action::None
            }
            Overlay::Picker(mut picker) => self.handle_picker_key(key, &mut picker),
            Overlay::CommandPalette {
                title,
                items,
                selected,
                query,
                searching,
            } => self.handle_command_palette_key(key, title, items, selected, query, searching),
            Overlay::CommandBuilder {
                spec,
                arguments,
                help,
            } => self.handle_command_builder_key(key, spec, arguments, help),
            Overlay::CustomTool { input } => self.handle_custom_tool_key(key, input),
            Overlay::ConfirmDelete { tool, version } => match key.code {
                KeyCode::Enter | KeyCode::Char('y') => Action::DeleteVersion { tool, version },
                KeyCode::Esc | KeyCode::Char('n') | KeyCode::Char('q') => Action::None,
                _ => {
                    self.overlay = Overlay::ConfirmDelete { tool, version };
                    Action::None
                }
            },
            Overlay::ConfirmCommand { args } => match key.code {
                KeyCode::Enter | KeyCode::Char('y') => Action::RunMise(args),
                KeyCode::Esc | KeyCode::Char('n') | KeyCode::Char('q') => Action::None,
                _ => {
                    self.overlay = Overlay::ConfirmCommand { args };
                    Action::None
                }
            },
        }
    }

    fn handle_command_palette_key(
        &mut self,
        key: KeyEvent,
        title: String,
        items: Vec<CommandSpec>,
        mut selected: usize,
        mut query: String,
        mut searching: bool,
    ) -> Action {
        let visible_len = items
            .iter()
            .filter(|item| command_matches(item, &query))
            .count();
        if searching {
            match key.code {
                KeyCode::Enter => searching = false,
                KeyCode::Esc => {
                    query.clear();
                    selected = 0;
                    searching = false;
                }
                KeyCode::Backspace => {
                    query.pop();
                    selected = 0;
                }
                KeyCode::Char(character)
                    if !key
                        .modifiers
                        .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
                {
                    query.push(character);
                    selected = 0;
                }
                _ => {}
            }
            self.overlay = Overlay::CommandPalette {
                title,
                items,
                selected,
                query,
                searching,
            };
            return Action::None;
        }

        match key.code {
            KeyCode::Esc | KeyCode::Char('q') => Action::None,
            KeyCode::Char('/') => {
                self.overlay = Overlay::CommandPalette {
                    title,
                    items,
                    selected,
                    query,
                    searching: true,
                };
                Action::None
            }
            KeyCode::Down | KeyCode::Char('j') => {
                selected = move_index(selected, 1, visible_len);
                self.overlay = Overlay::CommandPalette {
                    title,
                    items,
                    selected,
                    query,
                    searching,
                };
                Action::None
            }
            KeyCode::Up | KeyCode::Char('k') => {
                selected = move_index(selected, -1, visible_len);
                self.overlay = Overlay::CommandPalette {
                    title,
                    items,
                    selected,
                    query,
                    searching,
                };
                Action::None
            }
            KeyCode::Enter => {
                let spec = items
                    .iter()
                    .filter(|item| command_matches(item, &query))
                    .nth(selected)
                    .cloned();
                if let Some(spec) = spec {
                    match mise::command_help(&spec.name) {
                        Ok(help) => {
                            self.overlay = Overlay::CommandBuilder {
                                spec,
                                arguments: String::new(),
                                help,
                            };
                        }
                        Err(error) => {
                            self.status = format!(
                                "{}: {error:#}",
                                self.locale.text("Command help failed", "命令帮助加载失败")
                            );
                        }
                    }
                }
                Action::None
            }
            _ => {
                self.overlay = Overlay::CommandPalette {
                    title,
                    items,
                    selected,
                    query,
                    searching,
                };
                Action::None
            }
        }
    }

    fn handle_command_builder_key(
        &mut self,
        key: KeyEvent,
        spec: CommandSpec,
        mut arguments: String,
        help: String,
    ) -> Action {
        match key.code {
            KeyCode::Esc => Action::None,
            KeyCode::Backspace => {
                arguments.pop();
                self.overlay = Overlay::CommandBuilder {
                    spec,
                    arguments,
                    help,
                };
                Action::None
            }
            KeyCode::Enter => match shell_words::split(&arguments) {
                Ok(arguments) => {
                    let mut args = Vec::with_capacity(arguments.len() + 1);
                    args.push(spec.name);
                    args.extend(arguments);
                    if command_requires_confirmation(&args[0]) {
                        self.overlay = Overlay::ConfirmCommand { args };
                        Action::None
                    } else {
                        Action::RunMise(args)
                    }
                }
                Err(error) => {
                    self.status = format!(
                        "{}: {error}",
                        self.locale.text("Invalid arguments", "参数无效")
                    );
                    self.overlay = Overlay::CommandBuilder {
                        spec,
                        arguments,
                        help,
                    };
                    Action::None
                }
            },
            KeyCode::Char(character)
                if !key
                    .modifiers
                    .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
            {
                arguments.push(character);
                self.overlay = Overlay::CommandBuilder {
                    spec,
                    arguments,
                    help,
                };
                Action::None
            }
            _ => {
                self.overlay = Overlay::CommandBuilder {
                    spec,
                    arguments,
                    help,
                };
                Action::None
            }
        }
    }

    fn handle_picker_key(&mut self, key: KeyEvent, picker: &mut Picker) -> Action {
        if picker.searching() {
            match key.code {
                KeyCode::Enter => {
                    let direct_tool = match picker {
                        Picker::Registry { items, query, .. }
                            if !items.iter().any(|item| registry_matches(item, query)) =>
                        {
                            custom_backend_query(query)
                        }
                        _ => None,
                    };
                    if let Some(tool) = direct_tool {
                        self.open_versions(&tool, VersionIntent::Add);
                        return Action::None;
                    }
                    set_picker_searching(picker, false);
                }
                KeyCode::Esc => {
                    picker_query_mut(picker).clear();
                    set_picker_searching(picker, false);
                    set_picker_selected(picker, 0);
                }
                KeyCode::Backspace => {
                    picker_query_mut(picker).pop();
                    set_picker_selected(picker, 0);
                }
                KeyCode::Char(character)
                    if !key
                        .modifiers
                        .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
                {
                    picker_query_mut(picker).push(character);
                    set_picker_selected(picker, 0);
                }
                _ => {}
            }
            self.overlay = Overlay::Picker(picker.clone());
            return Action::None;
        }

        if matches!(picker, Picker::Registry { .. }) && key.code == KeyCode::Char('c') {
            self.open_custom_tool();
            return Action::None;
        }

        match key.code {
            KeyCode::Esc | KeyCode::Char('q') => Action::None,
            KeyCode::Char('/') => {
                set_picker_searching(picker, true);
                self.overlay = Overlay::Picker(picker.clone());
                Action::None
            }
            KeyCode::Down | KeyCode::Char('j') => {
                move_picker(picker, 1);
                self.overlay = Overlay::Picker(picker.clone());
                Action::None
            }
            KeyCode::Up | KeyCode::Char('k') => {
                move_picker(picker, -1);
                self.overlay = Overlay::Picker(picker.clone());
                Action::None
            }
            KeyCode::Enter => self.choose_picker_item(picker),
            _ => {
                self.overlay = Overlay::Picker(picker.clone());
                Action::None
            }
        }
    }
    fn handle_custom_tool_key(&mut self, key: KeyEvent, mut input: String) -> Action {
        match key.code {
            KeyCode::Esc => Action::None,
            KeyCode::Backspace => {
                input.pop();
                self.overlay = Overlay::CustomTool { input };
                Action::None
            }
            KeyCode::Enter => {
                let Some(tool) = normalize_custom_tool(&input) else {
                    self.status = self
                        .locale
                        .text("Enter a mise tool spec", "请输入 mise 工具标识")
                        .into();
                    self.overlay = Overlay::CustomTool { input };
                    return Action::None;
                };
                self.open_versions(&tool, VersionIntent::Add);
                Action::None
            }
            KeyCode::Char(character)
                if !key
                    .modifiers
                    .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
            {
                input.push(character);
                self.overlay = Overlay::CustomTool { input };
                Action::None
            }
            _ => {
                self.overlay = Overlay::CustomTool { input };
                Action::None
            }
        }
    }

    fn choose_picker_item(&mut self, picker: &Picker) -> Action {
        match picker {
            Picker::Registry {
                items,
                selected,
                query,
                ..
            } => {
                let tool = items
                    .iter()
                    .filter(|item| registry_matches(item, query))
                    .nth(*selected)
                    .map(|item| item.name.clone())
                    .or_else(|| custom_backend_query(query));
                if let Some(tool) = tool {
                    self.open_versions(&tool, VersionIntent::Add);
                }
                Action::None
            }
            Picker::Versions {
                tool,
                items,
                selected,
                query,
                intent,
                ..
            } => {
                let version = items
                    .iter()
                    .filter(|item| version_matches(item, query))
                    .nth(*selected)
                    .map(|item| item.version.clone());
                let Some(version) = version else {
                    return Action::None;
                };
                match intent {
                    VersionIntent::Add | VersionIntent::Use => Action::UseVersion {
                        tool: tool.clone(),
                        version,
                        scope: self.scope,
                    },
                    VersionIntent::Install => Action::InstallVersion {
                        tool: tool.clone(),
                        version,
                    },
                }
            }
        }
    }

    fn open_command_catalog(&mut self) {
        self.overlay = Overlay::CommandPalette {
            title: self
                .locale
                .text("All mise commands", "全部 mise 命令")
                .into(),
            items: self.commands.clone(),
            selected: 0,
            query: String::new(),
            searching: false,
        };
        self.status = self
            .locale
            .text("Expert command palette", "专家命令面板")
            .into();
    }

    fn open_context_commands(&mut self) {
        let items = self
            .commands
            .iter()
            .filter(|command| command_belongs_to_page(self.page, &command.name))
            .cloned()
            .collect::<Vec<_>>();
        self.overlay = Overlay::CommandPalette {
            title: format!(
                "{} {}",
                self.page.localized_title(self.locale),
                self.locale.text("actions", "操作")
            ),
            items,
            selected: 0,
            query: String::new(),
            searching: false,
        };
        self.status = format!(
            "{} {}",
            self.page.localized_title(self.locale),
            self.locale.text("actions", "操作")
        );
    }

    fn open_selected_page_command(&mut self) {
        let spec = self.selected_page_command().cloned();
        if let Some(spec) = spec {
            match mise::command_help(&spec.name) {
                Ok(help) => {
                    self.overlay = Overlay::CommandBuilder {
                        spec,
                        arguments: String::new(),
                        help,
                    };
                }
                Err(error) => {
                    self.status = format!(
                        "{}: {error:#}",
                        self.locale.text("Command help failed", "命令帮助加载失败")
                    )
                }
            }
        }
    }

    fn open_registry(&mut self) {
        self.status = self
            .locale
            .text("Loading mise registry…", "正在加载 mise 注册表…")
            .into();
        match mise::registry() {
            Ok(items) => {
                self.overlay = Overlay::Picker(Picker::Registry {
                    items,
                    selected: 0,
                    query: String::new(),
                    searching: false,
                });
                self.status = self.locale.text("Ready", "就绪").into();
            }
            Err(error) => {
                self.status = format!(
                    "{}: {error:#}",
                    self.locale.text("Registry failed", "注册表加载失败")
                )
            }
        }
    }
    fn open_custom_tool(&mut self) {
        self.overlay = Overlay::CustomTool {
            input: String::new(),
        };
    }

    fn open_versions_for_selected(&mut self, intent: VersionIntent) {
        if let Some(tool) = self.selected_tool().map(|tool| tool.name.clone()) {
            self.open_versions(&tool, intent);
        }
    }

    fn open_versions(&mut self, tool: &str, intent: VersionIntent) {
        self.status = if self.locale == Locale::Chinese {
            format!("正在加载 {tool} 的版本…")
        } else {
            format!("Loading versions for {tool}…")
        };
        match mise::remote_versions(tool) {
            Ok(items) => {
                self.overlay = Overlay::Picker(Picker::Versions {
                    tool: tool.into(),
                    items,
                    selected: 0,
                    query: String::new(),
                    searching: false,
                    intent,
                });
                self.status = self.locale.text("Ready", "就绪").into();
            }
            Err(error) => {
                self.status = format!(
                    "{}: {error:#}",
                    self.locale.text("Version lookup failed", "版本查询失败")
                )
            }
        }
    }

    fn confirm_delete_selected(&mut self) {
        if let Some(tool) = self.selected_tool().filter(|tool| tool.installed) {
            self.overlay = Overlay::ConfirmDelete {
                tool: tool.name.clone(),
                version: tool.version.clone(),
            };
        }
    }

    fn toggle_selected_update(&mut self) {
        if let Some(name) = self.selected_update().map(|update| update.name.clone())
            && !self.selected_updates.remove(&name)
        {
            self.selected_updates.insert(name);
        }
    }

    fn set_scope(&mut self, scope: Scope) {
        self.scope = scope;
        self.status = format!(
            "{}: {}",
            self.locale.text("Write scope", "写入作用域"),
            scope.title()
        );
    }

    fn toggle_language(&mut self) {
        let previous = self.locale;
        self.locale = self.locale.toggle();
        if let Err(error) = (Settings {
            language: self.locale,
        })
        .save()
        {
            self.locale = previous;
            self.status = format!(
                "{}: {error:#}",
                self.locale
                    .text("Unable to save language", "无法保存语言设置")
            );
            return;
        }
        self.status = self
            .locale
            .text("Language changed to English", "语言已切换为中文")
            .into();
    }

    fn set_page(&mut self, page: Page) {
        self.page = page;
        self.selected = 0;
        self.detail_scroll = 0;
        self.search.clear();
    }

    fn jump_to_page(&mut self, page: Page) {
        self.set_page(page);
        self.focus = Focus::List;
    }

    fn change_page(&mut self, delta: isize) {
        let current = Page::ALL
            .iter()
            .position(|page| *page == self.page)
            .unwrap_or_default();
        let next = (current as isize + delta).rem_euclid(Page::ALL.len() as isize) as usize;
        self.set_page(Page::ALL[next]);
    }

    fn cycle_focus(&mut self, delta: isize) {
        const FOCUS_ORDER: [Focus; 3] = [Focus::Navigation, Focus::List, Focus::Details];
        let current = FOCUS_ORDER
            .iter()
            .position(|focus| *focus == self.focus)
            .unwrap_or_default();
        let next = (current as isize + delta).rem_euclid(FOCUS_ORDER.len() as isize) as usize;
        self.focus = FOCUS_ORDER[next];
    }

    fn move_focus(&mut self, delta: isize) {
        let current = match self.focus {
            Focus::Navigation => 0_isize,
            Focus::List => 1,
            Focus::Details => 2,
        };
        self.focus = match (current + delta).clamp(0, 2) {
            0 => Focus::Navigation,
            1 => Focus::List,
            _ => Focus::Details,
        };
    }

    fn move_vertical(&mut self, delta: isize) {
        match self.focus {
            Focus::Navigation => self.change_page(delta),
            Focus::List => self.move_selection(delta),
            Focus::Details => {
                self.detail_scroll = if delta.is_negative() {
                    self.detail_scroll
                        .saturating_sub(delta.unsigned_abs() as u16)
                } else {
                    self.detail_scroll.saturating_add(delta as u16)
                };
            }
        }
    }

    fn move_selection(&mut self, delta: isize) {
        let len = self.current_list_len();
        if len == 0 {
            self.selected = 0;
        } else {
            self.selected = (self.selected as isize + delta).rem_euclid(len as isize) as usize;
        }
        self.detail_scroll = 0;
    }

    fn clamp_selection(&mut self) {
        self.selected = self.selected.min(self.current_list_len().saturating_sub(1));
    }

    fn current_list_len(&self) -> usize {
        match self.page {
            Page::Dashboard => 0,
            Page::Tools => self
                .snapshot
                .tools
                .iter()
                .filter(|tool| self.matches(&tool.name, &tool.version))
                .count(),
            Page::Updates => self
                .snapshot
                .updates
                .iter()
                .filter(|update| self.matches(&update.name, &update.current))
                .count(),
            Page::Tasks => self
                .snapshot
                .tasks
                .iter()
                .filter(|task| self.matches(&task.name, &task.description))
                .count(),
            Page::Environment | Page::System => self
                .commands
                .iter()
                .filter(|command| command_belongs_to_page(self.page, &command.name))
                .filter(|command| self.matches(&command.name, &command.description))
                .count(),
            Page::Preferences => 1,
            Page::Config => self
                .snapshot
                .configs
                .iter()
                .filter(|config| {
                    self.matches(&config.path.display().to_string(), &config.tools.join(" "))
                })
                .count(),
            Page::Logs => self
                .logs
                .iter()
                .filter(|log| self.matches(&log.command, &log.output))
                .count(),
        }
    }
}
fn commands_for_page(page: Page) -> &'static [&'static str] {
    match page {
        Page::Dashboard => DASHBOARD_COMMANDS,
        Page::Tools => TOOL_COMMANDS,
        Page::Updates => UPDATE_COMMANDS,
        Page::Tasks => TASK_COMMANDS,
        Page::Environment => ENVIRONMENT_COMMANDS,
        Page::Config => CONFIG_COMMANDS,
        Page::System => SYSTEM_COMMANDS,
        Page::Preferences => &[],
        Page::Logs => &["help"],
    }
}

fn command_belongs_to_page(page: Page, command: &str) -> bool {
    commands_for_page(page).contains(&command)
}

fn contains_case_insensitive(value: &str, query: &str) -> bool {
    value.to_lowercase().contains(&query.to_lowercase())
}
pub(crate) fn registry_matches(item: &RegistryTool, query: &str) -> bool {
    query.split_whitespace().all(|term| {
        contains_case_insensitive(&item.name, term)
            || contains_case_insensitive(&item.description, term)
            || item
                .backends
                .iter()
                .any(|backend| contains_case_insensitive(backend, term))
    })
}

fn version_matches(item: &RemoteVersion, query: &str) -> bool {
    query.is_empty() || contains_case_insensitive(&item.version, query)
}
fn normalize_custom_tool(input: &str) -> Option<String> {
    let input = input.trim().trim_end_matches('/');
    if input.is_empty() {
        return None;
    }
    if let Some(repository) = input.strip_prefix("https://github.com/") {
        let repository = repository.strip_suffix(".git").unwrap_or(repository);
        return (!repository.is_empty()).then(|| format!("github:{repository}"));
    }
    if !input.contains(':')
        && !input.starts_with('@')
        && let Some((owner, repository)) = input.split_once('/')
        && !owner.is_empty()
        && !repository.is_empty()
        && !repository.contains('/')
    {
        let repository = repository.strip_suffix(".git").unwrap_or(repository);
        return Some(format!("github:{owner}/{repository}"));
    }
    Some(input.to_owned())
}
pub(crate) fn custom_backend_query(query: &str) -> Option<String> {
    let tool = normalize_custom_tool(query)?;
    (tool.contains(':') && !tool.chars().any(char::is_whitespace)).then_some(tool)
}

fn picker_query_mut(picker: &mut Picker) -> &mut String {
    match picker {
        Picker::Registry { query, .. } | Picker::Versions { query, .. } => query,
    }
}

fn set_picker_searching(picker: &mut Picker, value: bool) {
    match picker {
        Picker::Registry { searching, .. } | Picker::Versions { searching, .. } => {
            *searching = value;
        }
    }
}

fn set_picker_selected(picker: &mut Picker, value: usize) {
    match picker {
        Picker::Registry { selected, .. } | Picker::Versions { selected, .. } => {
            *selected = value;
        }
    }
}

fn move_picker(picker: &mut Picker, delta: isize) {
    let len = picker.visible_len();
    if len == 0 {
        set_picker_selected(picker, 0);
    } else {
        let selected = (picker.selected() as isize + delta).rem_euclid(len as isize) as usize;
        set_picker_selected(picker, selected);
    }
}

fn move_index(current: usize, delta: isize, len: usize) -> usize {
    if len == 0 {
        0
    } else {
        (current as isize + delta).rem_euclid(len as isize) as usize
    }
}

fn command_matches(command: &CommandSpec, query: &str) -> bool {
    query.is_empty()
        || contains_case_insensitive(&command.name, query)
        || contains_case_insensitive(&command.description, query)
}

fn command_requires_confirmation(command: &str) -> bool {
    matches!(
        command,
        "cache"
            | "config"
            | "implode"
            | "prune"
            | "self-update"
            | "sync"
            | "uninstall"
            | "unset"
            | "untrust"
            | "unuse"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mise::{Config, Task, Tool, Update};

    fn app() -> App {
        App {
            page: Page::Dashboard,
            focus: Focus::Navigation,
            scope: Scope::Project,
            snapshot: Snapshot {
                mise_version: "test".into(),
                tools: vec![
                    Tool {
                        name: "node".into(),
                        version: "24".into(),
                        requested: "24".into(),
                        source: None,
                        installed: true,
                        active: true,
                    },
                    Tool {
                        name: "python".into(),
                        version: "3.14".into(),
                        requested: "3.14".into(),
                        source: None,
                        installed: true,
                        active: true,
                    },
                ],
                updates: vec![Update {
                    name: "node".into(),
                    current: "24".into(),
                    latest: "25".into(),
                }],
                tasks: vec![
                    Task {
                        name: "build".into(),
                        description: String::new(),
                        command: "cargo build".into(),
                    },
                    Task {
                        name: "test".into(),
                        description: String::new(),
                        command: "cargo test".into(),
                    },
                ],
                configs: vec![Config {
                    path: "mise.toml".into(),
                    tools: vec![],
                }],
            },
            locale: Locale::English,
            selected: 0,
            selected_updates: HashSet::new(),
            search: String::new(),
            detail_scroll: 0,
            status: String::new(),
            overlay: Overlay::None,
            logs: vec![],
            commands: vec![
                CommandSpec {
                    name: "doctor".into(),
                    description: "Check installation".into(),
                },
                CommandSpec {
                    name: "env".into(),
                    description: "Export environment".into(),
                },
                CommandSpec {
                    name: "install".into(),
                    description: "Install a tool".into(),
                },
            ],
            loading: false,
        }
    }

    fn key(character: char) -> KeyEvent {
        KeyEvent::new(KeyCode::Char(character), KeyModifiers::NONE)
    }

    #[test]
    fn hjkl_moves_across_all_three_panels() {
        let mut app = app();
        app.handle_key(key('j'));
        assert_eq!(app.page, Page::Tools);
        app.handle_key(key('l'));
        assert_eq!(app.focus, Focus::List);
        app.handle_key(key('l'));
        assert_eq!(app.focus, Focus::Details);
        app.handle_key(key('j'));
        assert_eq!(app.detail_scroll, 1);
        app.handle_key(key('h'));
        assert_eq!(app.focus, Focus::List);
        app.handle_key(key('h'));
        assert_eq!(app.focus, Focus::Navigation);
    }

    #[test]
    fn tab_cycles_panels_and_backtab_reverses() {
        let mut app = app();

        app.handle_key(KeyEvent::new(KeyCode::Tab, KeyModifiers::NONE));
        assert_eq!(app.focus, Focus::List);
        app.handle_key(KeyEvent::new(KeyCode::Tab, KeyModifiers::NONE));
        assert_eq!(app.focus, Focus::Details);
        app.handle_key(KeyEvent::new(KeyCode::BackTab, KeyModifiers::SHIFT));
        assert_eq!(app.focus, Focus::List);
    }

    #[test]
    fn search_filters_the_current_list() {
        let mut app = app();
        app.jump_to_page(Page::Tools);
        app.handle_key(key('/'));
        for character in "py".chars() {
            app.handle_key(key(character));
        }
        app.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(app.current_list_len(), 1);
        assert_eq!(app.selected_tool().unwrap().name, "python");
    }

    #[test]
    fn space_toggles_update_selection() {
        let mut app = app();
        app.jump_to_page(Page::Updates);
        app.handle_key(key(' '));
        assert!(app.selected_updates.contains("node"));
        app.handle_key(key(' '));
        assert!(app.selected_updates.is_empty());
    }

    #[test]
    fn scope_keys_change_write_target() {
        let mut app = app();
        app.handle_key(key('G'));
        assert_eq!(app.scope, Scope::Global);
        app.handle_key(key('p'));
        assert_eq!(app.scope, Scope::Project);
    }

    #[test]
    fn version_picker_returns_install_action() {
        let mut app = app();
        let picker = Picker::Versions {
            tool: "node".into(),
            items: vec![RemoteVersion {
                version: "25.0.0".into(),
                created_at: String::new(),
            }],
            selected: 0,
            query: String::new(),
            searching: false,
            intent: VersionIntent::Install,
        };
        assert_eq!(
            app.choose_picker_item(&picker),
            Action::InstallVersion {
                tool: "node".into(),
                version: "25.0.0".into(),
            }
        );
    }

    #[test]
    fn startup_is_interactive_while_mise_loads_silently() {
        let mut app = App::loading();
        assert!(!app.status.to_lowercase().contains("load"));
        assert!(!app.status.contains("加载"));
        assert_eq!(app.handle_key(key('j')), Action::None);
        assert_eq!(app.page, Page::Tools);
        assert_eq!(app.handle_key(key('q')), Action::Quit);
    }

    #[test]
    fn custom_backend_shortcut_opens_tool_input() {
        let mut app = app();

        assert_eq!(app.handle_key(key('A')), Action::None);
        assert!(matches!(
            app.overlay,
            Overlay::CustomTool { ref input } if input.is_empty()
        ));
    }

    #[test]
    fn custom_tool_normalizes_github_shorthand_and_urls() {
        assert_eq!(
            normalize_custom_tool("jorgerojas26/lazysql"),
            Some("github:jorgerojas26/lazysql".into())
        );
        assert_eq!(
            normalize_custom_tool("https://github.com/jorgerojas26/lazysql.git/"),
            Some("github:jorgerojas26/lazysql".into())
        );
        assert_eq!(
            normalize_custom_tool("npm:@scope/tool"),
            Some("npm:@scope/tool".into())
        );
        assert_eq!(normalize_custom_tool("  "), None);
    }
    #[test]
    fn registry_search_matches_backends_and_multiple_terms() {
        let tool = RegistryTool {
            name: "example".into(),
            description: "Fast code formatter".into(),
            backends: vec!["github:owner/example".into(), "cargo:example".into()],
        };

        assert!(registry_matches(&tool, "github:owner"));
        assert!(registry_matches(&tool, "formatter github"));
        assert!(!registry_matches(&tool, "formatter npm"));
        assert_eq!(
            custom_backend_query("github:jorgerojas26/lazysql"),
            Some("github:jorgerojas26/lazysql".into())
        );
        assert_eq!(custom_backend_query("lazysql"), None);
    }

    #[test]
    fn startup_failure_becomes_visible_command_log() {
        let mut app = App::loading();

        app.finish_loading(Err(anyhow::anyhow!("mise unavailable")));

        assert!(!app.loading);
        assert!(app.status.contains("mise unavailable"));
        assert_eq!(app.logs.len(), 1);
        assert!(!app.logs[0].success);
    }

    #[test]
    fn command_builder_preserves_shell_quoted_arguments() {
        let mut app = app();
        let action = app.handle_command_builder_key(
            KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE),
            CommandSpec {
                name: "exec".into(),
                description: String::new(),
            },
            "-- node -e 'console.log(1)'".into(),
            String::new(),
        );

        assert_eq!(
            action,
            Action::RunMise(vec![
                "exec".into(),
                "--".into(),
                "node".into(),
                "-e".into(),
                "console.log(1)".into(),
            ])
        );
    }

    #[test]
    fn destructive_palette_commands_require_confirmation() {
        let mut app = app();
        let action = app.handle_command_builder_key(
            KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE),
            CommandSpec {
                name: "implode".into(),
                description: String::new(),
            },
            String::new(),
            String::new(),
        );

        assert_eq!(action, Action::None);
        assert!(matches!(
            app.overlay,
            Overlay::ConfirmCommand { ref args } if args == &["implode"]
        ));
    }

    #[test]
    fn contextual_menu_contains_only_current_page_actions() {
        let mut app = app();
        app.page = Page::Tools;

        app.handle_key(key('m'));

        assert!(matches!(
            app.overlay,
            Overlay::CommandPalette { ref title, ref items, .. }
                if title == "Tools actions"
                    && items.iter().map(|item| item.name.as_str()).eq(["install"])
        ));
    }

    #[test]
    fn every_current_mise_help_command_has_a_workflow_group() {
        let commands = [
            "activate",
            "backends",
            "bin-paths",
            "bootstrap",
            "cache",
            "completion",
            "config",
            "deactivate",
            "deps",
            "doctor",
            "edit",
            "en",
            "env",
            "exec",
            "fmt",
            "generate",
            "implode",
            "install",
            "install-into",
            "latest",
            "link",
            "lock",
            "ls",
            "ls-remote",
            "mcp",
            "oci",
            "outdated",
            "patrons",
            "plugins",
            "prune",
            "registry",
            "reshim",
            "run",
            "search",
            "self-update",
            "set",
            "settings",
            "shell",
            "shell-alias",
            "sponsors",
            "sync",
            "tasks",
            "test-tool",
            "token",
            "tool",
            "tool-alias",
            "tool-stub",
            "trust",
            "uninstall",
            "unset",
            "untrust",
            "unuse",
            "upgrade",
            "use",
            "version",
            "watch",
            "where",
            "which",
            "help",
        ];

        for command in commands {
            assert!(
                Page::ALL
                    .iter()
                    .any(|page| command_belongs_to_page(*page, command)),
                "{command} is not assigned to a workflow"
            );
        }
    }
}
