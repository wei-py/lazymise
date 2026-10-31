# lazymise

A fast terminal interface for [mise](https://mise.jdx.dev/) tools, versions, updates, tasks, environments, and configuration.

`lazymise` organizes mise around daily workflows instead of exposing one long command list. It uses the installed `mise` CLI for discovery and execution, so existing mise configuration remains the source of truth.

[中文说明](#中文说明)

## Features

- Browse installed and active tool versions.
- Use one unified registry picker with dynamically discovered backend filters, then explicitly choose a source when a tool has multiple backends. Registry search accepts full backend specs (e.g. `npm:uapp`), so packages outside the mise registry open the version list; pinned specs (`npm:uapp@3.2.1`) submit directly like Custom Tool.
- Add, activate, install, and uninstall versions with confirmation.
- Review and upgrade outdated tools.
- Run project tasks from `mise.toml`.
- Access environment, configuration, and system workflows.
- Search lists and inspect command output without leaving the TUI.
- Switch the interface between English and Chinese.
- Discover all commands dynamically from the installed `mise -h` output.

## Requirements

- [mise](https://mise.jdx.dev/getting-started.html)
- A UTF-8 terminal

Standalone releases bundle Bun and OpenTUI, including the native renderer; they do not require a separately installed JavaScript runtime. Source development and release builds use **Bun 1.4.2**, pinned in `mise.toml`, `package.json`, and CI. No Node.js or Rust toolchain is required.

## Installation

### Standalone release

Download the matching archive and `SHA256SUMS` from [GitHub Releases](https://github.com/wei-py/lazymise/releases). Verify its SHA-256 before extracting. Archives retain the versioned directory `lazymise-v<VERSION>-<TARGET>/` with `lazymise` (or `lazymise.exe`), README, LICENSE, and dependency notices inside.

The release workflow targets Linux glibc x86_64/aarch64, macOS x86_64/aarch64, and Windows x86_64, with native builds for each target. CI/CD runs no smoke tests; source and extracted-release TUI smoke checks are local-only. Check the release's actual assets for availability; workflow configuration is not evidence of local verification. musl and Windows arm64 are not configured release targets.

For example, after downloading the macOS arm64 archive:

```bash
tar -xzf lazymise-v1.1.1-macos-aarch64.tar.gz
mkdir -p ~/.local/bin
install -m 755 lazymise-v1.1.1-macos-aarch64/lazymise ~/.local/bin/lazymise
```

Ensure the destination is on `PATH`; on Windows place `lazymise.exe` in a directory on `PATH`.

### From source

```bash
git clone https://github.com/wei-py/lazymise.git
cd lazymise
bun install --frozen-lockfile
bun run dev
# Optional: expose the source CLI on PATH (still requires Bun and this checkout).
bun link
```

OpenTUI uses Bun's native FFI directly. `--help`, `--version`, and CLI passthrough work without a TTY or native renderer. Starting the TUI requires interactive stdin and stdout. Direct source invocation is also supported:

```bash
bun /path/to/lazymise/src/main.js /path/to/project
```

Then run `lazymise` from the project whose mise environment you want to manage:

```bash
cd your-project
lazymise
```

### Updating

`lazymise update` updates a standalone release from **wei-py/lazymise**. It downloads the matching archive and checksum, validates SHA-256 and the candidate executable's version, then stages replacement beside the executable. Failed or interrupted replacement restores the previous executable. The install directory must be writable; the command never installs a Cargo package or changes mise configuration. If Windows retains the running previous executable, the updater reports its unique `.lazymise-rollback-*/previous-executable` path; remove it after that process exits.

Source checkouts refuse self-replacement (they must never overwrite the Bun executable): use `git pull` followed by `bun install --frozen-lockfile`. If installed through a package manager such as Homebrew, prefer that manager's upgrade command.

## Command-line options

```text
lazymise [OPTIONS]
lazymise [project-directory]
lazymise <command> [args...]

Options:
  -h, --help       Print help
  -v, --version    Print version
```

## Terminal workspace

Four modules live in the top navigation. Only the active module's selected page list is shown, with a shared detail area:

| Module key | Page tabs |
| --------- | --------- |
| `1` | Tools / Updates |
| `2` | Tasks / Console |
| `3` | Environment / Config |
| `4` | Dashboard / System / Logs |
| `0` | Shared detail |

Switching modules activates that module's saved page and list immediately. Each page remembers its selection, filter, list position, and detail scroll when you return. Tools also remembers Project and Global scope positions separately. The list and details always belong to the same active page.

Startup and refresh load local tools, tasks, and configuration without waiting for the background update check. These lists remain usable while Updates and Dashboard show “Checking for updates…”. A failed check shows its original error rather than “0 updates” or “All tools up to date”; press `r` to retry. During a new check or after a failure, previously loaded update rows remain visible, with the pending/error status.

At **80 columns or more and at least 10 rows**, the active list uses roughly 70% of the width and details use roughly 30%. At **40–79 columns and at least 10 rows**, the list fills the workspace; focusing details replaces the list until you return. Smaller terminals show a resize hint but still allow quitting and opening help/settings; existing overlays remain operable. The module bar stays above the workspace and the compact footer below it. Resizing does not reset page context. This is a terminal interface, with no Web sidecar.

The top module navigation and bottom shortcut bar have complete borders. Module labels retain the `[1]`–`[4]` badges and `▸` active marker. At 10–11 rows, the header and status line are hidden to preserve workspace rows.

Selected rows and confirmation choices use the slim `›` marker while retaining the theme's selection background. The `▶` shown for a running job is a status symbol, not a navigation marker.

## Essential keys

These are main-workspace keys; overlays and text inputs take precedence. Item actions require the active list to be focused, not navigation or details.

| Key | Action |
| --- | ------ |
| `1`–`4` / `0` | Switch module, activate its saved page and focus its list / focus details |
| `Tab` / `Shift-Tab` | Cycle top navigation, the current list and details; overlays follow their local hints |
| `h/←` / `l/→` | In navigation: previous / next module; in the list: `l` opens details; in details: `h` returns to the list |
| `[` / `]` | Previous / next page tab in the active module, including from navigation or details |
| `j/k` or up/down | Select a list row or scroll details; `k` at the first row enters navigation, where `j` returns to the saved list row |
| `Home/End`, `g/G` | First / last row or detail line |
| `PgUp/PgDn`, `Ctrl+d/u` | Move or scroll by half a page |
| `Enter` / `Esc` | Navigation: return to the saved list row; list: open details; Esc returns to the list; Enter in details stays there |
| `s` in Tools | Switch Project / Global tool scope and its default write target |
| `v` in Tools | Toggle all installed versions, including inactive versions; keep scope and write target |
| `L` | Switch 中文 / English |
| `r` / `x` | Refresh / abort the newest queued or running background job |
| `F2` | Select the exact configuration file for subsequent guided Use operations |
| `a` / `A` | Open the registry / enter a complete custom spec such as `cargo:example@1.2.3`, selecting a target first if needed |
| `I` / `i` in Tools | Browse versions to use in the selected configuration / install only |
| `D` in Tools | Confirm uninstalling the selected exact `tool@version` |
| `Space`, `u`, `U` in Updates | Mark updates; confirm marked/current tools; confirm all filtered tools |
| `R` in Tasks / Environment / System | Run the selected task / open the selected command's help and arguments |
| `n/s/e/y` in Config | Create local `mise.toml` / select target / edit / copy the complete file |
| `D` in Console | Dismiss finished jobs, retaining queued and running jobs |
| `m` / `M` | Open focused-page actions / the complete mise command catalog |
| `:` | Open settings (language / theme) |
| `/` | Filter the focused page list, registry, command palette, or configuration selector |
| `Ctrl+u` in text | Clear the input; Backspace deletes one complete grapheme |
| `?` | Open categorized built-in help |
| `q` / `Ctrl+c` | Quit immediately when idle; running or queued tasks prompt Keep running / Stop and quit (default: Keep running) |

See [USAGE.md](USAGE.md) for the complete workflow and key reference.

## Language, theme, and help

Press `:` to open the two-row settings popup. `j/k` selects the language or theme row, `Enter`/`l` moves to the next value and `h` to the previous one; changes apply and save instantly, `Esc` closes. `L` toggles 中文/English directly. The choice persists in:

```text
~/.config/lazymise/settings.json
```

`LAZYMISE_CONFIG_DIR` and `XDG_CONFIG_HOME` are supported.

If saving fails, the previous setting remains active and the status shows the original error.

The default is **Gruvbox Light** (`gruvbox-light`), fixed regardless of the terminal's light/dark appearance. A missing theme or the legacy generic `default` preference falls back to Gruvbox Light without rewriting the settings file on load. Existing explicit named palettes remain selected; choose another palette in settings if desired.

Available dark/light pairs: **Gruvbox**, **Catppuccin Mocha / Latte**, **Tokyo Night / Tokyo Night Day**, and **Solarized**. To switch: `:` → `j` to Theme → `Enter`/`l` for next or `h` for previous. Built-in help (`?`) includes the steps under Actions and the palette list/default under Notes.

**Auto (terminal)** (`auto`, 中文「自动（终端）」) is an explicit additional choice. It detects the terminal's light/dark mode and redraws immediately when the terminal reports a change; if detection is unavailable, it uses the dark palette. Named palettes never follow terminal changes, and the default remains Gruvbox Light. Every theme fills the whole canvas, including trailing header/status/key-hint whitespace and uncovered cells after resize; modal surfaces and selected rows retain their intentional distinct backgrounds.

Built-in help (`?`) is available in English and Chinese, with **Navigation / Actions / Notes** (**导航 / 操作 / 说明**) categories. Left/right or `[`/`]` changes category; `j/k`, up/down, `PageUp/PageDown`, and `Home/End` scroll. Each category remembers its scroll position, and the footer shows category/scroll/close hints and position. `Esc`, `Enter`, or `q` closes help and restores the underlying focus.

Help keeps its controls inside the dialog; the background navigation footer is hidden while help is open.

Nested dialogs retain parent input and selection. While editing, letters, `?`, digits, and punctuation are text, not workspace shortcuts. Long output, paths, and errors have scrollable viewports with local hints.

## Configuration target

With the Config list focused, press `n` to create `mise.toml` in the current working directory. Confirmations start on **Cancel**: press `y` explicitly, or choose Confirm with right/`l` (or Tab) and then Enter; Enter on Cancel, `Esc`, `n`, or `q` cancels. Confirmation immediately creates an empty `[tools]` table, selects the file in the list, and makes it the write target. Existing files, directories, and symlinks are never overwritten. Global configuration is unchanged; subsequent guided Use operations write to this local file.

Tools defaults to the **Project** scope: effective configured project tools, including inherited global declarations (marked `↑`; legend: `↑ global`). **Global** shows actual global configuration declarations, even when a project overrides them. Neither configured scope includes installed tools that no configuration references. Press `v` in Tools to see **all installed versions**, including inactive/source-less versions, but not uninstalled declarations. Press `v` again to restore the configured scope's selection and search; installed-view selection and search are also remembered separately. `v` never changes the write target. `s` switches Project / Global scope and exits installed view; selecting a configuration write target also exits installed view. `[`/`]` switches Tools / Updates page tabs. Switching scope does not activate or change the terminal environment.

In the Tools UI, confirmed uninstall removes the selected installed version, then removes its exact requested-version declaration from the source configuration shown in the confirmation. Already-uninstalled declarations are removed directly. Cleanup runs only after a successful uninstall, uses `mise unuse --no-prune --path <source>`, and preserves other installed versions and configuration files; it does not use the selected write target. Source-less installed versions are only uninstalled. Command-line passthrough retains mise's native behavior. Missing configured tools display `○ … (not installed)`; `(inactive)` means installed but not active.

The default write target follows the tool scope: Project uses the project configuration, Global uses the global configuration. Global paths follow `MISE_GLOBAL_CONFIG_FILE`, then `MISE_CONFIG_DIR`, then `XDG_CONFIG_HOME/mise`, otherwise `~/.config/mise/config.toml`. Startup never creates a file. Press `F2` with the active list focused, or `s` on a file in Config, to select an exact target; a manual selection also synchronizes Tools to its scope. Refresh preserves a manual choice. Selecting or cancelling never writes a file, and the target is not persisted.

- Discovered project and global files are listed together; the first file is never implicitly selected.
- Enter an absolute or project-relative `.toml` path, or choose the new project `mise.toml` action. Explicit `~/` expands to your home; `$VAR` is literal.
- Missing files require creation confirmation. Confirmation only authorizes creation; a later Use invokes mise to create the file. Parent directories must already exist.
- Directories, dangling links, special files, and `rust-toolchain.toml` are rejected as write targets. Other discovered formats remain available for editing/copying.
- Use and Custom Tool execute `mise use --yes --path <absolute-file> <exact-spec>`. Every submission revalidates the target; a removed existing file requires explicit creation approval again.
- `F2` inside a loaded write picker or Custom Tool changes the target without losing input. Loading pickers ask you to wait. Install-only pickers and expert commands do not intercept it.

Tool scope controls which configured declarations are shown and the default guided write target. It does not redirect Install, Uninstall, Upgrade, tasks, or expert-command arguments, nor a command already submitted. The former `p/G` shortcuts and Custom Tool's hidden Tab target switch are removed.

Truncated text in the focused selected list row scrolls automatically after a short dwell, exposing long names and versions without widening the terminal. It pauses while an overlay or Details has focus and resets when selection, search, page, or terminal size changes. The compact `↑` marker means the project row inherits global configuration; full origin remains in Details. In installed view, select an inactive version and press `D` to confirm uninstalling that exact `tool@version` in the background. Direct Enter on the default Cancel button, or `Esc/n/q`, does not start an uninstall.

Long configuration paths initially retain the filename at the right end; automatic scrolling then reveals the rest of the path.

Search starts explicitly with `/`. While editing, letters including `p/G/j/k/q`, `?`, and digits are text. In local page search, Enter accepts the query without selecting a result; Tab switches between local filtering and registry-add search, where Enter selects a tool. Registry pickers have their own Tab/Shift-Tab backend filters and explicit `/` editing. Esc restores the previous query and cursor, and Ctrl+u clears input. In overlays, Esc/q returns one level outside text input, and Ctrl+c cancels the flow. Long modal paths/errors show a `PgUp/PgDn` position hint.

Item actions operate on the active page's list only while that list is focused. Tools `I` uses a version, `i` installs only, and `D` confirms the exact `tool@version`. Config `s` chooses the target, `e` edits, and `y` copies the complete file. Enter focuses shared detail, including Console/Logs output; detail supports Home/End and Ctrl+d/u scrolling. Navigation and detail focus do not dispatch list actions.

Updates `u` confirms marked tools, or only the current row when nothing is marked. `U` confirms all **currently filtered** tools. Confirmation captures and lists the exact names; cancellation runs nothing. Expert `upgrade` also requires confirmation and never gains an implicit `--path`.

Destructive confirmations start on Cancel. Use explicit `y`, or select Confirm before pressing Enter; an unqualified Enter cancels. Commands such as `activate` cannot mutate the parent shell because the TUI runs as a child process; use mise's normal shell activation setup for persistent parent-shell changes.

## Development

```bash
bun install --frozen-lockfile
bun run test
bun run lint
bun run dev
bun run build
bun run smoke:release
```

`mise install` can provision the pinned Bun toolchain; `mise run check` runs lint and tests. Tests use Bun's test runner, isolated fixture processes and settings rather than installing real mise tools. The release builder uses `Bun.build({ compile: ... })` to embed the application and OpenTUI native assets directly. Linux builds select glibc explicitly, and x86_64 builds use Bun's baseline CPU target. Archives retain their historical names, directory layout, dependency notices, and SHA-256 checksums. No Web sidecar is shipped.

Runtime tests require a missing job executable to settle as `failed`; the native spawn diagnostic is preserved, but its platform-specific wording is not part of the contract.

CI/CD runs lint, tests, and standalone archive builds, with no smoke commands. Run `bun run smoke:release` manually after a local build: it verifies the extracted archive with repository reads denied on macOS, checks CLI forwarding, and starts/quits both source and extracted-release TUIs in real PTYs. The smoke fixture is itself a Bun-compiled executable, so Windows needs no shell shim.

Release tags must be exactly `v` followed by the `package.json` version: version `1.2.3` requires `v1.2.3`, not `v.1.2.3`. The workflow validates this before starting any platform builds, and `bun run build` enforces the same rule locally. Manual runs require an explicit existing tag; they check out that tag, not the branch selected in the Actions UI. If a tag is mistyped, create and push the correctly named tag on the intended release commit. Re-running the incorrect tag cannot fix the mismatch; do not bypass the check or rename archives, because archive names and the executable's version must agree.

## 中文说明

`lazymise` 是一个使用 JavaScript ESM 与 OpenTUI 0.5.11 的 mise 终端界面，用工作流组织工具版本、更新、项目任务、环境和配置操作。

### 安装

```bash
git clone https://github.com/wei-py/lazymise.git
cd lazymise
bun install --frozen-lockfile
bun link
```

进入使用 mise 的项目目录后运行：

```bash
lazymise
```

### 常用功能

- 在一个统一 registry 选择器中查看工具；来源筛选由 `mise registry --json` 动态生成，npm、GitHub、Go、Cargo 等常见来源优先显示，同时保留 Aqua、asdf、vfox、pipx 和其他来源。
- 按 `a` 打开 registry，按 `Tab` / `Shift-Tab` 循环来源筛选，按 `/` 组合文字筛选。工具只有一个来源时直接进入版本列表；有多个来源时必须明确选择完整来源标识。搜索接受完整后端标识（如 `npm:uapp`），未收录进 mise 注册表的工具会以“完整标识”行进入版本选择，带 `@版本` 的标识直接提交 Use。
- 查看、添加、启用、安装和卸载 registry 工具及自定义后端工具。
- 多选并升级过期工具。
- 运行 `mise.toml` 中定义的项目任务。
- 使用 Environment 页面执行 `env`、`exec`、`which` 等命令。
- 当前列表聚焦时，按 `m` 打开本页相关操作，按 `M` 打开全部 mise 命令；`:` 是设置，不是命令目录。
- 按 `A` 输入 `github:owner/repository`、`npm:package` 等完整自定义后端标识；此类标识已明确来源，不会再次要求选择来源。
- 按 `F2` 选择具体配置文件；Tools 的 `I` 与 `A` 通过 `--path` 写入该文件，`Enter` 只聚焦共享详情。工具列表由项目／全局范围决定，不随手动目标过滤。
- 按 `:` 打开设置弹层（语言 / 主题两行），`j/k` 选行、`Enter`/`l` 下一值、`h` 上一值，即时生效并保存；`L` 直接切换语言。

### 模块、焦点与帮助

顶部导航包含四个模块：`1` Tools / Updates，`2` Tasks / Console，`3` Environment / Config，`4` Dashboard / System / Logs。数字键立即激活该模块记忆的页面并聚焦列表；`0` 聚焦详情。`[`/`]` 切换当前模块的页面标签；Tools 中 `s` 单独切换项目／全局范围。

只显示当前页面的一个列表。`Tab/Shift-Tab` 在顶部导航、当前列表、详情之间循环。列表首项按 `k/↑` 进入导航；导航中 `h/l` 或左右键切换模块并恢复其记忆页面，`j/↓` 或 Enter 返回记忆列表行。列表中 `l/→` 或 Enter 进入详情，详情中 `h/←` 或 Esc 返回列表，详情中 Enter 保持焦点。列表与详情始终属于同一页面；导航和详情不响应列表动作键。

每页保留选中行、过滤、列表位置和详情滚动；Tools 的项目／全局范围分别保留位置。列表向下移动到末尾时停止，不循环；详情上下滚动。输入与弹层优先处理按键。

启动与刷新先加载本地工具、任务和配置，不等待后台更新检查。这些列表始终可用；Updates 和 Dashboard 明确显示“正在检查更新…”。检查失败显示原始原因，不会误报“0 个更新”或“所有工具已是最新”；按 `r` 重试。再次检查或失败时保留上次成功取得的更新行，并显示加载／错误状态。

宽至少 **80** 且高至少 **10** 时，列表／详情约按 **70%／30%** 左右布局；**40–79** 列且高至少 **10** 时仅显示列表，聚焦详情后替换为详情，返回后恢复列表。更小时显示尺寸提示，仍可退出、打开帮助和设置，并操作已打开的弹层。顶部模块栏与底部紧凑提示栏始终独立，缩放不重置页面上下文。

顶部模块导航与底部快捷键栏均有完整边框；模块保留 `[1]`–`[4]` 编号及 `▸` 当前项标记。终端仅有 10–11 行时隐藏页头和状态行，优先保留主区内容。

默认主题固定为 **Gruvbox Light**（`gruvbox-light`），不随终端深浅色变化。缺少主题或旧通用值 `default` 会回退到该主题，加载时不改写设置；已有明确命名的主题继续保留。语言与主题均可在设置中选择并持久化。

可选深色／浅色配对：**Gruvbox**、**Catppuccin Mocha／Latte**、**Tokyo Night／Tokyo Night Day**、**Solarized**。切换步骤：按 `:` → `j` 选中主题 → `Enter`/`l` 下一主题、`h` 上一主题。`?` 帮助的「操作」列出步骤，「说明」列出可选主题及默认值。

另可显式选择 **自动（终端）**（`auto`）：检测终端深浅色，收到运行中的模式变化后即时重绘；无法检测时保守使用深色。命名主题不会跟随终端，默认仍是 Gruvbox Light。所有主题都完整填充画布，包括页头、状态栏、快捷键栏的尾部空白及缩放后的未覆盖区域；弹层表面与选中行保留有意不同的背景。

`?` 帮助按 **导航 / 操作 / 说明**（Navigation / Actions / Notes）分类；左右键或 `[`/`]` 换类，`j/k`、上下键、`PgUp/PgDn`、`Home/End` 滚动，分类各自记忆位置。`Esc/Enter/q` 关闭并恢复原焦点。输入时 `jq?123` 等内容都是文字，不触发全局键。

帮助的操作提示只放在弹窗内，不再与底部全局导航提示重复。

确认框默认选中取消；明确按 `y`，或右键／`l`／Tab 选择确认后按 Enter 才执行。直接 Enter、`Esc/n/q` 取消，不运行命令。运行中的任务保留在 Console，`x` 中止最近排队或运行的任务。

完整操作说明见 [USAGE.md](USAGE.md)。

### 开发

预编译发行版内置 Bun、OpenTUI 与原生渲染库，无需 Rust、Node.js 或额外安装 JavaScript 运行时。源码开发及发行构建使用 Bun 1.4.2，版本由 `mise.toml`、`package.json` 和 CI 固定。OpenTUI 直接使用 Bun FFI；发行构建通过 `Bun.build` 独立编译嵌入应用及原生资源，保留压缩包命名、目录布局、依赖许可和校验和。CI/CD 仅运行 lint、测试和构建，绝不运行冒烟；本机 `bun run smoke:release` 检查解压发行包及源码的真实 PTY 启动、退出和终端恢复。可先安装工具链，再安装依赖并运行检查：

```bash
mise install
bun install --frozen-lockfile
mise run check
mise run dev
```

运行时测试要求可执行文件缺失的后台任务以 `failed` 状态结束；原生进程启动诊断会保留，但其平台相关措辞不属于契约。

发布 tag 必须是 `v` 加上 `package.json` 的版本号：例如版本 `1.2.3` 对应 `v1.2.3`，不是 `v.1.2.3`。工作流会在启动各平台构建前统一检查，本地 `bun run build` 也保留同样的检查。手动运行必须明确填写已有 tag，检出的是该 tag，而不是 Actions 页面选择的分支。tag 拼错时，应在预期的发布提交上创建并推送正确 tag；重跑错误 tag 无法解决。不要跳过检查或仅修改压缩包名称，否则归档名称与程序版本会不一致。

## License

[MIT](LICENSE)
