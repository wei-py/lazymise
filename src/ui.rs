use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{
        Block, Borders, Clear, List, ListItem, ListState, Paragraph, Row, Table, TableState, Wrap,
    },
};

use crate::app::{App, Focus, Overlay, Page, Picker};

const ACCENT: Color = Color::Cyan;
const MUTED: Color = Color::DarkGray;
const SELECTED: Color = Color::Rgb(38, 50, 56);

pub fn render(frame: &mut Frame<'_>, app: &App) {
    let sections = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(10),
            Constraint::Length(2),
        ])
        .split(frame.area());
    render_header(frame, sections[0], app);

    let body = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(26), Constraint::Min(45)])
        .split(sections[1]);
    render_sidebar(frame, body[0], app);
    render_page(frame, body[1], app);
    render_footer(frame, sections[2], app);
    render_overlay(frame, app);
}

fn render_header(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let version = app
        .snapshot
        .mise_version
        .split_whitespace()
        .next()
        .unwrap_or("unknown");
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                " LAZYMISE ",
                Style::default()
                    .fg(Color::Black)
                    .bg(ACCENT)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(app.locale.text(
                "  LazyGit for your development environment  ",
                "  面向开发环境的 LazyGit  ",
            )),
            Span::styled(format!("[{}]", app.scope.title()), accent()),
        ]))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(format!(" mise {version} ")),
        ),
        area,
    );
}

fn render_sidebar(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let panels = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(13), Constraint::Min(5)])
        .split(area);
    let items = Page::ALL.iter().enumerate().map(|(index, page)| {
        let key = if index < 8 {
            (index + 1).to_string()
        } else {
            "x".into()
        };
        ListItem::new(format!("  {key}  {}", page.localized_title(app.locale)))
    });
    let mut state = ListState::default();
    state.select(Page::ALL.iter().position(|page| *page == app.page));
    frame.render_stateful_widget(
        List::new(items)
            .highlight_symbol("▸ ")
            .highlight_style(selected_style(app.focus == Focus::Navigation))
            .block(panel(
                app.locale.text(" Sections ", " 导航 "),
                app.focus == Focus::Navigation,
            )),
        panels[0],
        &mut state,
    );

    let active = app.snapshot.tools.iter().filter(|tool| tool.active).count();
    let directory = std::env::current_dir()
        .ok()
        .and_then(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "unknown".into());
    frame.render_widget(
        Paragraph::new(vec![
            field(app.locale.text("project", "项目"), directory),
            field(app.locale.text("scope", "作用域"), app.scope.title()),
            field(app.locale.text("tools", "工具"), active.to_string()),
            field(
                app.locale.text("updates", "可更新"),
                app.snapshot.updates.len().to_string(),
            ),
            field(
                app.locale.text("selected", "已选择"),
                app.selected_updates.len().to_string(),
            ),
        ])
        .block(panel(app.locale.text(" Environment ", " 环境 "), false)),
        panels[1],
    );
}

fn render_page(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let panes = content_panes(area);
    match app.page {
        Page::Dashboard => render_dashboard(frame, panes[0], panes[1], app),
        Page::Tools => render_tools(frame, panes[0], panes[1], app),
        Page::Updates => render_updates(frame, panes[0], panes[1], app),
        Page::Tasks => render_tasks(frame, panes[0], panes[1], app),
        Page::Environment | Page::System => render_command_section(frame, panes[0], panes[1], app),
        Page::Config => render_configs(frame, panes[0], panes[1], app),
        Page::Preferences => render_preferences(frame, panes[0], panes[1], app),
        Page::Logs => render_logs(frame, panes[0], panes[1], app),
    }
}

fn content_panes(area: Rect) -> std::rc::Rc<[Rect]> {
    let (direction, constraints) = if area.width >= 85 {
        (
            Direction::Horizontal,
            [Constraint::Percentage(48), Constraint::Percentage(52)],
        )
    } else {
        (
            Direction::Vertical,
            [Constraint::Percentage(50), Constraint::Percentage(50)],
        )
    };
    Layout::default()
        .direction(direction)
        .constraints(constraints)
        .split(area)
}

fn render_dashboard(frame: &mut Frame<'_>, left: Rect, right: Rect, app: &App) {
    let installed = app
        .snapshot
        .tools
        .iter()
        .filter(|tool| tool.installed)
        .count();
    frame.render_widget(
        Paragraph::new(vec![
            metric(app.locale.text("Installed tools", "已安装工具"), installed),
            metric(
                app.locale.text("Active tools", "已启用工具"),
                app.snapshot.tools.iter().filter(|tool| tool.active).count(),
            ),
            metric(
                app.locale.text("Available updates", "可用更新"),
                app.snapshot.updates.len(),
            ),
            metric(
                app.locale.text("Project tasks", "项目任务"),
                app.snapshot.tasks.len(),
            ),
            metric(app.locale.text("Command logs", "命令日志"), app.logs.len()),
            Line::from(""),
            Line::from(Span::styled(
                app.locale.text(
                    "a adds a tool; v discovers and activates a version",
                    "a 添加工具；v 查找并启用版本",
                ),
                muted(),
            )),
        ])
        .block(panel(
            app.locale.text(" Overview ", " 概览 "),
            app.focus == Focus::List,
        )),
        left,
    );
    frame.render_widget(
        Paragraph::new(vec![
            field("OS", std::env::consts::OS),
            field(
                app.locale.text("Architecture", "架构"),
                std::env::consts::ARCH,
            ),
            field("mise", app.snapshot.mise_version.as_str()),
            field(
                app.locale.text("Write scope", "写入作用域"),
                app.scope.title(),
            ),
            Line::from(""),
            Line::from(Span::styled(
                app.locale
                    .text("Scope controls `mise use`:", "作用域控制 `mise use`："),
                accent(),
            )),
            Line::from(
                app.locale
                    .text("  p  project mise.toml", "  p  项目 mise.toml"),
            ),
            Line::from(
                app.locale
                    .text("  G  global config.toml", "  G  全局 config.toml"),
            ),
        ])
        .scroll((app.detail_scroll, 0))
        .block(panel(
            app.locale.text(" Environment ", " 环境 "),
            app.focus == Focus::Details,
        )),
        right,
    );
}

fn render_tools(frame: &mut Frame<'_>, list_area: Rect, detail_area: Rect, app: &App) {
    let rows = app
        .snapshot
        .tools
        .iter()
        .filter(|tool| app.matches(&tool.name, &tool.version))
        .map(|tool| {
            let state = if tool.active {
                "●"
            } else if tool.installed {
                "○"
            } else {
                "×"
            };
            Row::new([tool.name.as_str(), tool.version.as_str(), state])
        });
    let table = Table::new(
        rows,
        [
            Constraint::Percentage(38),
            Constraint::Percentage(48),
            Constraint::Percentage(14),
        ],
    )
    .header(
        Row::new([
            app.locale.text("Tool", "工具"),
            app.locale.text("Version", "版本"),
            "",
        ])
        .style(accent()),
    )
    .row_highlight_style(selected_style(app.focus == Focus::List))
    .highlight_symbol("▸ ")
    .block(panel(
        app.locale.text(" Tools ", " 工具 "),
        app.focus == Focus::List,
    ));
    let mut state = TableState::default().with_offset(centered_offset(
        app.selected,
        list_area.height.saturating_sub(3),
    ));
    state.select(app.selected_tool().map(|_| app.selected));
    frame.render_stateful_widget(table, list_area, &mut state);

    let lines = app.selected_tool().map_or_else(
        || {
            vec![Line::from(Span::styled(
                app.locale.text("No matching tools", "没有匹配的工具"),
                muted(),
            ))]
        },
        |tool| {
            vec![
                heading(&tool.name),
                Line::from(""),
                field(app.locale.text("Version", "版本"), &tool.version),
                field(app.locale.text("Requested", "请求版本"), &tool.requested),
                field(
                    app.locale.text("Installed", "已安装"),
                    yes_no(app, tool.installed),
                ),
                field(
                    app.locale.text("Active", "已启用"),
                    yes_no(app, tool.active),
                ),
                field(
                    app.locale.text("Source", "来源"),
                    tool.source
                        .as_ref()
                        .map(|path| path.display().to_string())
                        .unwrap_or_else(|| "—".into()),
                ),
                Line::from(""),
                Line::from(
                    app.locale
                        .text("v  browse versions and use", "v  浏览版本并启用"),
                ),
                Line::from(
                    app.locale
                        .text("i  browse versions and install", "i  浏览版本并安装"),
                ),
                Line::from(
                    app.locale
                        .text("d  uninstall this version", "d  卸载此版本"),
                ),
                Line::from(app.locale.text("a  add another tool", "a  添加其他工具")),
            ]
        },
    );
    frame.render_widget(
        Paragraph::new(lines)
            .scroll((app.detail_scroll, 0))
            .block(panel(
                app.locale.text(" Details ", " 详情 "),
                app.focus == Focus::Details,
            )),
        detail_area,
    );
}

fn render_updates(frame: &mut Frame<'_>, list_area: Rect, detail_area: Rect, app: &App) {
    let rows = app
        .snapshot
        .updates
        .iter()
        .filter(|update| app.matches(&update.name, &update.current))
        .map(|update| {
            let checked = if app.selected_updates.contains(&update.name) {
                "[x]"
            } else {
                "[ ]"
            };
            Row::new([
                checked,
                update.name.as_str(),
                update.current.as_str(),
                update.latest.as_str(),
            ])
        });
    let table = Table::new(
        rows,
        [
            Constraint::Length(4),
            Constraint::Percentage(30),
            Constraint::Percentage(33),
            Constraint::Percentage(37),
        ],
    )
    .header(
        Row::new([
            "",
            app.locale.text("Tool", "工具"),
            app.locale.text("Current", "当前"),
            app.locale.text("Latest", "最新"),
        ])
        .style(accent()),
    )
    .row_highlight_style(selected_style(app.focus == Focus::List))
    .highlight_symbol("▸ ")
    .block(panel(
        app.locale.text(" Updates ", " 更新 "),
        app.focus == Focus::List,
    ));
    let mut state = TableState::default().with_offset(centered_offset(
        app.selected,
        list_area.height.saturating_sub(3),
    ));
    state.select(app.selected_update().map(|_| app.selected));
    frame.render_stateful_widget(table, list_area, &mut state);

    let lines = app.selected_update().map_or_else(
        || {
            vec![Line::from(Span::styled(
                app.locale
                    .text("Everything is up to date", "所有工具均为最新版本"),
                muted(),
            ))]
        },
        |update| {
            vec![
                heading(&update.name),
                Line::from(""),
                field(app.locale.text("Current", "当前"), &update.current),
                field(app.locale.text("Latest", "最新"), &update.latest),
                field(
                    app.locale.text("Selected", "已选择"),
                    yes_no(app, app.selected_updates.contains(&update.name)),
                ),
                Line::from(""),
                Line::from(
                    app.locale
                        .text("Space  toggle selection", "Space  切换选择"),
                ),
                Line::from(app.locale.text(
                    "U      upgrade selected (or all if none)",
                    "U      更新所选工具（未选择时更新全部）",
                )),
            ]
        },
    );
    frame.render_widget(
        Paragraph::new(lines)
            .scroll((app.detail_scroll, 0))
            .block(panel(
                app.locale.text(" Upgrade ", " 升级 "),
                app.focus == Focus::Details,
            )),
        detail_area,
    );
}

fn render_tasks(frame: &mut Frame<'_>, list_area: Rect, detail_area: Rect, app: &App) {
    let items = app
        .snapshot
        .tasks
        .iter()
        .filter(|task| app.matches(&task.name, &task.description))
        .map(|task| ListItem::new(task.name.as_str()));
    render_list(
        frame,
        list_area,
        items,
        app.locale.text(" Tasks ", " 任务 "),
        app,
    );
    let lines = app.selected_task().map_or_else(
        || {
            vec![Line::from(Span::styled(
                app.locale.text("No matching tasks", "没有匹配的任务"),
                muted(),
            ))]
        },
        |task| {
            vec![
                heading(&task.name),
                Line::from(""),
                field(
                    app.locale.text("Description", "描述"),
                    if task.description.is_empty() {
                        "—"
                    } else {
                        &task.description
                    },
                ),
                Line::from(""),
                Line::from(Span::styled(app.locale.text("Command", "命令"), muted())),
                Line::from(task.command.as_str()),
                Line::from(""),
                Line::from(Span::styled(
                    app.locale
                        .text("Enter runs this task", "按 Enter 运行此任务"),
                    accent(),
                )),
            ]
        },
    );
    frame.render_widget(
        Paragraph::new(lines)
            .scroll((app.detail_scroll, 0))
            .block(panel(
                app.locale.text(" Task ", " 任务 "),
                app.focus == Focus::Details,
            )),
        detail_area,
    );
}
fn render_command_section(frame: &mut Frame<'_>, list_area: Rect, detail_area: Rect, app: &App) {
    let items = app
        .commands
        .iter()
        .filter(|command| app.command_visible_on_page(command))
        .map(|command| ListItem::new(command.name.as_str()));
    render_list(
        frame,
        list_area,
        items,
        &format!(
            " {} {} ",
            app.page.localized_title(app.locale),
            app.locale.text("actions", "操作")
        ),
        app,
    );

    let lines = app.selected_page_command().map_or_else(
        || {
            vec![Line::from(Span::styled(
                app.locale.text("No matching actions", "没有匹配的操作"),
                muted(),
            ))]
        },
        |command| {
            vec![
                heading(&command.name),
                Line::from(""),
                Line::from(command.description.as_str()),
                Line::from(""),
                Line::from(Span::styled(
                    app.locale.text(
                        "Enter opens arguments and live command help",
                        "按 Enter 打开参数和实时命令帮助",
                    ),
                    accent(),
                )),
                Line::from(Span::styled(
                    app.locale.text(
                        "m opens related actions from any page",
                        "在任意页面按 m 打开相关操作",
                    ),
                    muted(),
                )),
            ]
        },
    );
    frame.render_widget(
        Paragraph::new(lines)
            .scroll((app.detail_scroll, 0))
            .block(panel(
                app.locale.text(" Action ", " 操作 "),
                app.focus == Focus::Details,
            )),
        detail_area,
    );
}

fn render_configs(frame: &mut Frame<'_>, list_area: Rect, detail_area: Rect, app: &App) {
    let items = app
        .snapshot
        .configs
        .iter()
        .filter(|config| app.matches(&config.path.display().to_string(), &config.tools.join(" ")))
        .map(|config| ListItem::new(config.path.display().to_string()));
    render_list(
        frame,
        list_area,
        items,
        app.locale.text(" Config files ", " 配置文件 "),
        app,
    );
    let lines = app.selected_config().map_or_else(
        || {
            vec![Line::from(Span::styled(
                app.locale
                    .text("No matching configuration", "没有匹配的配置"),
                muted(),
            ))]
        },
        |config| {
            vec![
                heading(app.locale.text("Configuration", "配置")),
                Line::from(""),
                field(
                    app.locale.text("Path", "路径"),
                    config.path.display().to_string(),
                ),
                Line::from(""),
                Line::from(Span::styled(app.locale.text("Tools", "工具"), muted())),
                Line::from(if config.tools.is_empty() {
                    "—".into()
                } else {
                    config.tools.join(", ")
                }),
                Line::from(""),
                Line::from(Span::styled(
                    app.locale.text("e opens this file", "按 e 打开此文件"),
                    accent(),
                )),
            ]
        },
    );
    frame.render_widget(
        Paragraph::new(lines)
            .scroll((app.detail_scroll, 0))
            .block(panel(
                app.locale.text(" Details ", " 详情 "),
                app.focus == Focus::Details,
            )),
        detail_area,
    );
}
fn render_preferences(frame: &mut Frame<'_>, list_area: Rect, detail_area: Rect, app: &App) {
    render_list(
        frame,
        list_area,
        [ListItem::new(app.locale.text("Language", "语言"))],
        app.locale.text(" Preferences ", " 设置 "),
        app,
    );
    frame.render_widget(
        Paragraph::new(vec![
            heading(app.locale.text("Interface language", "界面语言")),
            Line::from(""),
            field(
                app.locale.text("Current", "当前"),
                app.locale.display_name(),
            ),
            field(app.locale.text("Code", "代码"), app.locale.code()),
            Line::from(""),
            Line::from(Span::styled(
                app.locale
                    .text("Press Enter to switch to 中文", "按 Enter 切换为 English"),
                accent(),
            )),
            Line::from(""),
            Line::from(Span::styled(
                app.locale.text(
                    "The preference is saved automatically.",
                    "语言设置会自动保存。",
                ),
                muted(),
            )),
        ])
        .block(panel(
            app.locale.text(" Language ", " 语言 "),
            app.focus == Focus::Details,
        )),
        detail_area,
    );
}

fn render_logs(frame: &mut Frame<'_>, list_area: Rect, detail_area: Rect, app: &App) {
    let items = app
        .logs
        .iter()
        .rev()
        .filter(|log| app.matches(&log.command, &log.output))
        .map(|log| {
            let marker = if log.success { "✓" } else { "×" };
            ListItem::new(format!("{marker} {}", log.command))
        });
    render_list(
        frame,
        list_area,
        items,
        app.locale.text(" Command log ", " 命令日志 "),
        app,
    );
    let lines = app.selected_log().map_or_else(
        || {
            vec![Line::from(Span::styled(
                app.locale.text("No commands recorded yet", "尚未记录命令"),
                muted(),
            ))]
        },
        |log| {
            vec![
                heading(&log.command),
                Line::from(if log.success {
                    app.locale.text("SUCCESS", "成功")
                } else {
                    app.locale.text("FAILED", "失败")
                }),
                Line::from(""),
                Line::from(log.output.as_str()),
            ]
        },
    );
    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .scroll((app.detail_scroll, 0))
            .block(panel(
                app.locale.text(" Output ", " 输出 "),
                app.focus == Focus::Details,
            )),
        detail_area,
    );
}

fn render_list<'a, I>(frame: &mut Frame<'_>, area: Rect, items: I, title: &str, app: &App)
where
    I: IntoIterator<Item = ListItem<'a>>,
{
    let list = List::new(items)
        .highlight_style(selected_style(app.focus == Focus::List))
        .highlight_symbol("▸ ")
        .block(panel(title, app.focus == Focus::List));
    let mut state = ListState::default()
        .with_offset(centered_offset(app.selected, area.height.saturating_sub(2)));
    state.select(Some(app.selected));
    frame.render_stateful_widget(list, area, &mut state);
}

fn render_footer(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let filter = if app.search.is_empty() {
        String::new()
    } else {
        format!("  /{}", app.search)
    };
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                format!(" {} ", app.status),
                Style::default().fg(Color::Black).bg(ACCENT),
            ),
            Span::raw(format!(
                "{}{filter}",
                app.locale.text(
                    "  Tab panels  h/j/k/l move  m actions  / search  a add  o settings  ? help",
                    "  Tab 切换面板  h/j/k/l 移动  m 操作  / 搜索  a 添加  o 设置  ? 帮助",
                )
            )),
        ])),
        area,
    );
}

fn render_overlay(frame: &mut Frame<'_>, app: &App) {
    if app.loading {
        render_loading(frame, app);
        return;
    }
    match &app.overlay {
        Overlay::None => {}
        Overlay::Help => render_help(frame, app),
        Overlay::Search => render_search(frame, app, &app.search),
        Overlay::Picker(picker) => render_picker(frame, app, picker),
        Overlay::CommandPalette {
            title,
            items,
            selected,
            query,
            searching,
        } => render_command_palette(frame, app, title, items, *selected, query, *searching),
        Overlay::CommandBuilder {
            spec,
            arguments,
            help,
        } => render_command_builder(frame, app, spec, arguments, help),
        Overlay::ConfirmDelete { tool, version } => {
            let area = centered_rect(55, 7, frame.area());
            frame.render_widget(Clear, area);
            frame.render_widget(
                Paragraph::new(vec![
                    Line::from(app.locale.text(
                        &format!("Uninstall {tool}@{version}?"),
                        &format!("卸载 {tool}@{version}？"),
                    )),
                    Line::from(""),
                    Line::from(app.locale.text(
                        "Enter/y confirms · n/Esc cancels",
                        "Enter/y 确认 · n/Esc 取消",
                    )),
                ])
                .block(modal_block(
                    app.locale.text(" Confirm uninstall ", " 确认卸载 "),
                )),
                area,
            );
        }
        Overlay::ConfirmCommand { args } => {
            let area = centered_rect(65, 8, frame.area());
            frame.render_widget(Clear, area);
            frame.render_widget(
                Paragraph::new(vec![
                    Line::from(app.locale.text(
                        "This command may modify or delete mise state:",
                        "此命令可能修改或删除 mise 状态：",
                    )),
                    Line::from(""),
                    Line::from(Span::styled(
                        format!("mise {}", args.join(" ")),
                        Style::default().add_modifier(Modifier::BOLD),
                    )),
                    Line::from(""),
                    Line::from(app.locale.text(
                        "Enter/y confirms · n/Esc cancels",
                        "Enter/y 确认 · n/Esc 取消",
                    )),
                ])
                .block(modal_block(
                    app.locale
                        .text(" Confirm mise command ", " 确认 mise 命令 "),
                )),
                area,
            );
        }
    }
}

fn render_command_palette(
    frame: &mut Frame<'_>,
    app: &App,
    title: &str,
    items: &[crate::mise::CommandSpec],
    selected: usize,
    query: &str,
    searching: bool,
) {
    let area = centered_rect(80, frame.area().height.saturating_sub(6), frame.area());
    let sections = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(5),
            Constraint::Length(2),
        ])
        .split(area);
    frame.render_widget(Clear, area);
    frame.render_widget(
        modal_block(&format!(
            " {title} · {} ",
            app.locale
                .text("from current `mise -h`", "来自当前 `mise -h`")
        )),
        area,
    );
    frame.render_widget(
        Paragraph::new(format!(" /{}{}", query, if searching { "█" } else { "" }))
            .block(Block::default().borders(Borders::BOTTOM)),
        sections[0],
    );
    let rows = items
        .iter()
        .filter(|item| command_ui_matches(item, query))
        .map(|item| Row::new([item.name.as_str(), item.description.as_str()]));
    let table = Table::new(
        rows,
        [Constraint::Percentage(25), Constraint::Percentage(75)],
    )
    .header(
        Row::new([
            app.locale.text("Command", "命令"),
            app.locale.text("Description", "描述"),
        ])
        .style(accent()),
    )
    .row_highlight_style(selected_style(true))
    .highlight_symbol("▸ ");
    let mut state = TableState::default().with_offset(centered_offset(
        selected,
        sections[1].height.saturating_sub(1),
    ));
    let visible = items
        .iter()
        .filter(|item| command_ui_matches(item, query))
        .count();
    state.select((visible > 0).then_some(selected));
    frame.render_stateful_widget(table, sections[1], &mut state);
    frame.render_widget(
        Paragraph::new(app.locale.text(
            " j/k navigate · / filter · Enter arguments/help · Esc cancel ",
            " j/k 导航 · / 筛选 · Enter 参数/帮助 · Esc 取消 ",
        )),
        sections[2],
    );
}

fn render_command_builder(
    frame: &mut Frame<'_>,
    app: &App,
    spec: &crate::mise::CommandSpec,
    arguments: &str,
    help: &str,
) {
    let area = centered_rect(88, frame.area().height.saturating_sub(4), frame.area());
    let sections = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Length(3),
            Constraint::Min(5),
            Constraint::Length(2),
        ])
        .split(area);
    frame.render_widget(Clear, area);
    frame.render_widget(modal_block(&format!(" mise {} ", spec.name)), area);
    frame.render_widget(
        Paragraph::new(spec.description.as_str())
            .style(muted())
            .block(Block::default().borders(Borders::BOTTOM)),
        sections[0],
    );
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(format!("mise {} ", spec.name), accent()),
            Span::raw(arguments),
            Span::styled("█", accent()),
        ]))
        .block(Block::default().title(app.locale.text(" Arguments ", " 参数 "))),
        sections[1],
    );
    frame.render_widget(
        Paragraph::new(help)
            .wrap(Wrap { trim: false })
            .block(Block::default().title(app.locale.text(" Command help ", " 命令帮助 "))),
        sections[2],
    );
    let shell_warning = if matches!(
        spec.name.as_str(),
        "activate" | "deactivate" | "env" | "shell"
    ) {
        app.locale.text(
            " Enter run · Esc cancel · note: child commands cannot mutate the parent shell ",
            " Enter 运行 · Esc 取消 · 注意：子进程无法修改父级 shell ",
        )
    } else {
        app.locale.text(
            " Enter run · Esc cancel · arguments use shell quoting ",
            " Enter 运行 · Esc 取消 · 参数使用 shell 引号规则 ",
        )
    };
    frame.render_widget(Paragraph::new(shell_warning), sections[3]);
}

fn command_ui_matches(command: &crate::mise::CommandSpec, query: &str) -> bool {
    picker_match(&command.name, &command.description, query)
}

fn render_loading(frame: &mut Frame<'_>, app: &App) {
    const SPINNER: [&str; 8] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];
    let area = centered_rect(62, 8, frame.area());
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(vec![
            Line::from(vec![
                Span::styled(
                    format!("{} ", SPINNER[app.loading_tick % SPINNER.len()]),
                    accent().add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    app.locale
                        .text("Loading mise environment", "正在加载 mise 环境"),
                    Style::default().add_modifier(Modifier::BOLD),
                ),
            ]),
            Line::from(""),
            Line::from(app.locale.text(
                "Reading tools, remote status, tasks, and active configs.",
                "正在读取工具、远程状态、任务和活动配置。",
            )),
            Line::from(Span::styled(
                app.locale.text(
                    "`mise outdated` may contact remote registries.",
                    "`mise outdated` 可能会连接远程注册表。",
                ),
                muted(),
            )),
            Line::from(""),
            Line::from(Span::styled(
                app.locale.text("Press q to cancel", "按 q 取消"),
                muted(),
            )),
        ])
        .block(modal_block(
            app.locale
                .text(" Starting lazymise ", " 正在启动 lazymise "),
        )),
        area,
    );
}

fn render_search(frame: &mut Frame<'_>, app: &App, query: &str) {
    let area = centered_rect(60, 5, frame.area());
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled("/", accent()),
            Span::raw(query),
            Span::styled("█", accent()),
        ]))
        .block(modal_block(app.locale.text(
            " Filter current view · Enter apply · Esc clear ",
            " 筛选当前视图 · Enter 应用 · Esc 清除 ",
        ))),
        area,
    );
}

fn render_picker(frame: &mut Frame<'_>, app: &App, picker: &Picker) {
    let area = centered_rect(82, frame.area().height.saturating_sub(6), frame.area());
    let sections = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(5),
            Constraint::Length(2),
        ])
        .split(area);
    frame.render_widget(Clear, area);
    frame.render_widget(
        modal_block(&format!(" {} ", picker.title(app.locale))),
        area,
    );

    let search = if picker.searching() { "█" } else { "" };
    frame.render_widget(
        Paragraph::new(format!(" /{}{}", picker.query(), search))
            .block(Block::default().borders(Borders::BOTTOM)),
        sections[0],
    );

    match picker {
        Picker::Registry {
            items,
            selected,
            query,
            ..
        } => {
            let rows = items
                .iter()
                .filter(|item| picker_match(&item.name, &item.description, query))
                .map(|item| {
                    Row::new([
                        item.name.as_str(),
                        item.description.as_str(),
                        item.backends.first().map(String::as_str).unwrap_or(""),
                    ])
                });
            let table = Table::new(
                rows,
                [
                    Constraint::Percentage(24),
                    Constraint::Percentage(52),
                    Constraint::Percentage(24),
                ],
            )
            .header(
                Row::new([
                    app.locale.text("Tool", "工具"),
                    app.locale.text("Description", "描述"),
                    app.locale.text("Backend", "后端"),
                ])
                .style(accent()),
            )
            .row_highlight_style(selected_style(true))
            .highlight_symbol("▸ ");
            let mut state = TableState::default().with_offset(centered_offset(
                *selected,
                sections[1].height.saturating_sub(1),
            ));
            state.select((picker.visible_len() > 0).then_some(*selected));
            frame.render_stateful_widget(table, sections[1], &mut state);
        }
        Picker::Versions {
            tool,
            items,
            selected,
            query,
            ..
        } => {
            let rows = items
                .iter()
                .filter(|item| picker_match(&item.version, "", query))
                .map(|item| {
                    let installed = app.snapshot.tools.iter().any(|installed| {
                        installed.name == *tool && installed.version == item.version
                    });
                    let active = app.snapshot.tools.iter().any(|installed| {
                        installed.name == *tool
                            && installed.version == item.version
                            && installed.active
                    });
                    let state = if active {
                        app.locale.text("active", "已启用")
                    } else if installed {
                        app.locale.text("installed", "已安装")
                    } else {
                        ""
                    };
                    Row::new([item.version.as_str(), item.created_at.as_str(), state])
                });
            let table = Table::new(
                rows,
                [
                    Constraint::Percentage(40),
                    Constraint::Percentage(40),
                    Constraint::Percentage(20),
                ],
            )
            .header(
                Row::new([
                    app.locale
                        .text("Version (newest first)", "版本（最新优先）"),
                    app.locale.text("Released", "发布日期"),
                    app.locale.text("State", "状态"),
                ])
                .style(accent()),
            )
            .row_highlight_style(selected_style(true))
            .highlight_symbol("▸ ");
            let mut state = TableState::default().with_offset(centered_offset(
                *selected,
                sections[1].height.saturating_sub(1),
            ));
            state.select((picker.visible_len() > 0).then_some(*selected));
            frame.render_stateful_widget(table, sections[1], &mut state);
        }
    }
    frame.render_widget(
        Paragraph::new(app.locale.text(
            " j/k navigate · / filter · Enter choose · Esc cancel ",
            " j/k 导航 · / 筛选 · Enter 选择 · Esc 取消 ",
        )),
        sections[2],
    );
}

fn render_help(frame: &mut Frame<'_>, app: &App) {
    let area = centered_rect(72, 30, frame.area());
    let lines = if app.locale == crate::settings::Locale::Chinese {
        vec![
            heading("导航"),
            Line::from("  Tab            下一个面板（循环）"),
            Line::from("  Shift-Tab      上一个面板（循环）"),
            Line::from("  h/l            上一个 / 下一个面板"),
            Line::from("  j/k            移动导航、列表或详情"),
            Line::from("  1…8            跳转到主要页面"),
            Line::from("  o              打开 lazymise 设置"),
            Line::from("  x              打开命令输出日志"),
            Line::from("  m              打开当前页面相关操作"),
            Line::from("  :              打开全部 mise 命令"),
            Line::from("  /              筛选当前列表或操作菜单"),
            Line::from("  Ctrl-u/Ctrl-d  移动或滚动五行"),
            Line::from(""),
            heading("工具管理"),
            Line::from("  a              注册表 → 版本 → 添加到作用域"),
            Line::from("  v              远程版本 → 在作用域中启用"),
            Line::from("  i              远程版本 → 仅安装"),
            Line::from("  d              确认并卸载所选版本"),
            Line::from("  p / G          项目 / 全局写入作用域"),
            Line::from(""),
            heading("更新和操作"),
            Line::from("  Space          切换更新选择"),
            Line::from("  U              更新所选工具，未选择时更新全部"),
            Line::from("  Enter          运行任务、操作或切换语言"),
            Line::from("  e              编辑所选配置"),
            Line::from("  r              刷新 mise 状态"),
            Line::from("  ?              切换帮助"),
            Line::from("  q / Ctrl-c     退出"),
            Line::from(Span::styled("按 ?、Esc 或 q 关闭", muted())),
        ]
    } else {
        vec![
            heading("Navigation"),
            Line::from("  Tab            next panel (wraps)"),
            Line::from("  Shift-Tab      previous panel (wraps)"),
            Line::from("  h/l            previous / next panel"),
            Line::from("  j/k            section, row, or detail scroll"),
            Line::from("  1…8            jump to primary section"),
            Line::from("  o              open lazymise preferences"),
            Line::from("  x              command output log"),
            Line::from("  m              actions related to the current page"),
            Line::from("  :              every command from `mise -h`"),
            Line::from("  /              filter current list or action menu"),
            Line::from("  Ctrl-u/Ctrl-d  move or scroll five rows"),
            Line::from(""),
            heading("Tool management"),
            Line::from("  a              registry → version → add to scope"),
            Line::from("  v              remote versions → activate in scope"),
            Line::from("  i              remote versions → install only"),
            Line::from("  d              confirm and uninstall selected version"),
            Line::from("  p / G          project / global write scope"),
            Line::from(""),
            heading("Updates and actions"),
            Line::from("  Space          toggle update selection"),
            Line::from("  U              upgrade selected, or all if none"),
            Line::from("  Enter          run task, action, or switch language"),
            Line::from("  e              edit selected config"),
            Line::from("  r              refresh mise state"),
            Line::from("  ?              toggle this help"),
            Line::from("  q / Ctrl-c     quit"),
            Line::from(Span::styled("Press ?, Esc, or q to close", muted())),
        ]
    };
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(lines).block(modal_block(app.locale.text(" Keybindings ", " 快捷键 "))),
        area,
    );
}
fn centered_offset(selected: usize, viewport_height: u16) -> usize {
    selected.saturating_sub(usize::from(viewport_height.max(1)) / 2)
}

fn picker_match(primary: &str, secondary: &str, query: &str) -> bool {
    query.is_empty()
        || primary.to_lowercase().contains(&query.to_lowercase())
        || secondary.to_lowercase().contains(&query.to_lowercase())
}

fn centered_rect(percent_x: u16, height: u16, area: Rect) -> Rect {
    let height = height.min(area.height);
    let top = area.height.saturating_sub(height) / 2;
    let vertical = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(top),
            Constraint::Length(height),
            Constraint::Min(0),
        ])
        .split(area);
    let horizontal = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(vertical[1]);
    horizontal[1]
}

fn panel(title: &str, focused: bool) -> Block<'_> {
    Block::default()
        .borders(Borders::ALL)
        .border_style(if focused { accent() } else { Style::default() })
        .title(Span::styled(
            title,
            if focused {
                accent().add_modifier(Modifier::BOLD)
            } else {
                Style::default()
            },
        ))
}

fn modal_block(title: &str) -> Block<'_> {
    panel(title, true).style(Style::default().bg(Color::Black))
}

fn selected_style(focused: bool) -> Style {
    if focused {
        Style::default()
            .fg(Color::White)
            .bg(SELECTED)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(MUTED)
    }
}

fn accent() -> Style {
    Style::default().fg(ACCENT)
}

fn muted() -> Style {
    Style::default().fg(MUTED)
}

fn heading(value: &str) -> Line<'_> {
    Line::from(Span::styled(value, accent().add_modifier(Modifier::BOLD)))
}

fn field(label: &str, value: impl Into<String>) -> Line<'static> {
    Line::from(vec![
        Span::styled(format!("{label:<14}"), muted()),
        Span::raw(value.into()),
    ])
}

fn metric(label: &str, value: usize) -> Line<'_> {
    Line::from(vec![
        Span::styled(format!("{label:<22}"), muted()),
        Span::styled(
            value.to_string(),
            Style::default().add_modifier(Modifier::BOLD),
        ),
    ])
}

fn yes_no(app: &App, value: bool) -> &'static str {
    if value {
        app.locale.text("yes", "是")
    } else {
        app.locale.text("no", "否")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selected_row_stays_in_viewport_center_after_scrolling() {
        let viewport_height = 10;
        let selected = 18;
        let offset = centered_offset(selected, viewport_height);

        assert_eq!(offset, 13);
        assert_eq!(selected - offset, 5);
    }

    #[test]
    fn initial_rows_do_not_scroll_above_zero() {
        assert_eq!(centered_offset(3, 10), 0);
    }
}
