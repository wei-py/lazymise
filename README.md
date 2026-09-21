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
| `1`…`8` | Open a primary page |
| `a` | Open the unified registry, filter by backend, choose a source when needed, then choose a version |
| `A` | Enter a complete custom backend spec such as `github:owner/repository` or `npm:package` |
| `v` | Browse versions and activate one |
| `i` | Browse versions and install one |
| `d` | Uninstall the selected version after confirmation |
| `Space` / `U` | Select updates / upgrade |
| `m` | Open actions related to the current page |
| `:` | Open the complete mise command catalog |
| `/` | Filter the current list, registry tools, backend choices, or versions |
| `o` | Open lazymise preferences |
| `?` | Open built-in help |
| `q` | Quit |

See [USAGE.md](USAGE.md) for the complete workflow and key reference.

## Language

Press `8` or `o`, select **Language**, and press `Enter` to switch between English and Chinese. The choice is applied immediately and saved to:

```text
~/.config/lazymise/settings.json
```

`LAZYMISE_CONFIG_DIR` and `XDG_CONFIG_HOME` are supported.

## Scope

The header and add/version pickers show the current write target:

- `p`: project scope (`mise.toml`)
- `G`: global scope (`config.toml`)

These shortcuts also work inside a picker when its filter field is not active. The custom-backend input shows the target and uses `Tab` to switch it.

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
- 按 `8` 或 `o` 进入设置，按 `Enter` 切换中文和英文。

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
