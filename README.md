# lazymise

A fast terminal interface for [mise](https://mise.jdx.dev/) tools, versions, updates, tasks, environments, and configuration.

`lazymise` organizes mise around daily workflows instead of exposing one long command list. It uses the installed `mise` CLI for discovery and execution, so existing mise configuration remains the source of truth.

[中文说明](#中文说明)

## Features

- Browse installed and active tool versions.
- Use one unified registry picker with dynamically discovered backend filters, then explicitly choose a source when a tool has multiple backends.
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

Rust is required only when installing from source.

## Installation

### From source

```bash
git clone https://github.com/wei-py/lazymise.git
cd lazymise
cargo install --path . --locked
```

Then run `lazymise` from the project whose mise environment you want to manage:

```bash
cd your-project
lazymise
```

### Homebrew

```bash
brew install wei-py/tap/lazymise
```

## Command-line options

```text
lazymise [OPTIONS]

Options:
  -h, --help       Print help
  -V, --version    Print version
```

## Essential keys

| Key | Action |
|---|---|
| `Tab` / `Shift-Tab` | Cycle panel focus; in the registry picker, cycle every discovered backend prefix; in command arguments, focus the scrollable help |
| `h` `j` `k` `l` or arrows | Move focus, selection, details, or the focused command help viewport |
| `1`…`8`, `9`, `0` | Open Dashboard–Preferences, Console, or Logs, with list focus |
| `F2` | Select the exact configuration file for subsequent guided Use operations |
| `a` | Select a target if needed, then open the registry and choose a tool, source, and version |
| `A` | Select a target if needed, then enter a complete custom spec such as `cargo:example@1.2.3` |
| `Enter` / `v` in Tools | Browse versions and write the chosen version to the selected file |
| `i` | Browse versions and install one |
| `d` | Uninstall the selected version after confirmation |
| `Space`, `Enter` / `u`, `U` | Mark updates; confirm marked/current tools; confirm all filtered tools |
| `m` | Open actions related to the current page |
| `:` | Open the complete mise command catalog |
| `/` | Filter the page list, registry, command palette, or configuration selector |
| `Esc` | Return one overlay level, or Details → List → Navigation |
| `Ctrl+u` in text | Clear the current input; Backspace deletes one complete grapheme |
| `?` | Open built-in help |
| `q` | Quit |

See [USAGE.md](USAGE.md) for the complete workflow and key reference.

## Language

Press `8` to open Preferences. Use `j/k` or the arrow keys to select **English** or **中文**, then press `Enter` to apply. `●` marks the applied language; the highlighted row is the pending selection. Repeated `Enter` leaves the applied language unchanged. The choice is applied only after saving succeeds:

```text
~/.config/lazymise/settings.json
```

`LAZYMISE_CONFIG_DIR` and `XDG_CONFIG_HOME` are supported.

If saving fails, the current language stays active and the status shows the original error. Fix the settings path and press `Enter` to retry.

Built-in help (`?`) supports `j/k` or arrows, `PageUp`/`PageDown`, and `Home`/`End`. `Esc`, `q`, or `Ctrl-c` closes help.

### TUI fixes

Guided writes now select a concrete configuration file before choosing tools. Navigation uses digits, Enter acts on the visible selected row, and nested dialogs preserve their parent input and selection. Language saving remains explicit. Native dialogs retain centered borders, Unicode-aware clipping, visible focus, and local hints; long output and paths can be scrolled.

## Configuration target

On startup, lazymise selects the discovered global configuration file by default. The path follows `MISE_GLOBAL_CONFIG_FILE`, then `MISE_CONFIG_DIR`, then `XDG_CONFIG_HOME/mise`, otherwise `~/.config/mise/config.toml`. If no valid global file is found, the target remains unselected; startup never creates a file. Press `F2`, or press `Enter` on a file in the Config list, to choose another target. Refresh preserves your manual choice. Selecting or cancelling never writes a file, and the target is not persisted.

- Discovered project and global files are listed together; the first file is never implicitly selected.
- Enter an absolute or project-relative `.toml` path, or choose the new project `mise.toml` action. Explicit `~/` expands to your home; `$VAR` is literal.
- Missing files require creation confirmation. Confirmation only authorizes creation; a later Use invokes mise to create the file. Parent directories must already exist.
- Directories, dangling links, special files, and `rust-toolchain.toml` are rejected as write targets. Other discovered formats remain available for editing/copying.
- Use and Custom Tool execute `mise use --yes --path <absolute-file> <exact-spec>`. Every submission revalidates the target; a removed existing file requires explicit creation approval again.
- `F2` inside a loaded write picker or Custom Tool changes the target without losing input. Loading pickers ask you to wait. Install-only pickers and expert commands do not intercept it.

The target does **not** filter the complete Tools inventory or control Install, Uninstall, Upgrade, tasks, or expert-command arguments. Selecting a different target cannot redirect a command already submitted. The former `p/G` scope shortcuts and Custom Tool's hidden Tab target switch are removed.

Search starts explicitly with `/`. While editing, letters including `p/G/j/k/q` are text; Enter accepts the query without selecting a result, Esc restores the previous query and cursor, and Ctrl+u clears it. Outside text input, Esc/q returns one dialog level and Ctrl+c cancels the entire flow. Long modal paths/errors show a `PgUp/PgDn` position hint.

Item actions require List focus. Tools Enter/v uses a version, `i` installs only, and `d` confirms the exact `tool@version`. Config Enter chooses the target, `e` edits, and `y` copies the complete file. Console/Logs Enter focuses output; Details supports Home/End and Ctrl+d/u scrolling.

Updates Enter/u confirms marked tools, or only the current row when nothing is marked. `U` confirms all **currently filtered** tools. Confirmation captures and lists the exact names; cancellation runs nothing. Expert `upgrade` also requires confirmation and never gains an implicit `--path`.

`lazymise` asks for confirmation before destructive operations. Commands such as `activate` cannot mutate the parent shell because the TUI runs as a child process; use mise's normal shell activation setup for persistent parent-shell changes.

## Development

```bash
mise install
mise run check
mise run dev
```

The project pins Rust 1.94.0 in `mise.toml`; the release workflow uses the same
mise-managed toolchain.

## 中文说明

`lazymise` 是一个基于 Ratatui 的 mise 终端界面，用工作流组织工具版本、更新、项目任务、环境和配置操作。

### 安装

```bash
git clone https://github.com/wei-py/lazymise.git
cd lazymise
cargo install --path . --locked
```

进入使用 mise 的项目目录后运行：

```bash
lazymise
```

### 常用功能

- 在一个统一 registry 选择器中查看工具；来源筛选由 `mise registry --json` 动态生成，npm、GitHub、Go、Cargo 等常见来源优先显示，同时保留 Aqua、asdf、vfox、pipx 和其他来源。
- 按 `a` 打开 registry，按 `Tab` / `Shift-Tab` 循环来源筛选，按 `/` 组合文字筛选。工具只有一个来源时直接进入版本列表；有多个来源时必须明确选择完整来源标识。
- 查看、添加、启用、安装和卸载 registry 工具及自定义后端工具。
- 多选并升级过期工具。
- 运行 `mise.toml` 中定义的项目任务。
- 使用 Environment 页面执行 `env`、`exec`、`which` 等命令。
- 按 `m` 打开当前页面相关操作，按 `:` 打开全部 mise 命令。
- 按 `A` 输入 `github:owner/repository`、`npm:package` 等完整自定义后端标识；此类标识已明确来源，不会再次要求选择来源。
- 按 `F2` 选择具体配置文件；Tools 的 `Enter/v` 与 `A` 通过 `--path` 写入该文件，库存不随目标过滤。
- 按 `8` 进入设置，用 `j/k` 选择语言，再按 `Enter` 保存并应用。

完整操作说明见 [USAGE.md](USAGE.md)。

### 开发

项目在 `mise.toml` 中固定使用 Rust 1.94.0。安装工具链并运行检查：

```bash
mise install
mise run check
mise run dev
```

## License

[MIT](LICENSE)
