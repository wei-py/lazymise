---
name: lazymise
description: Use lazymise to manage mise tools, versions, tasks, and environments.
globs:
  - "mise.toml"
  - "**/mise.toml"
  - ".mise.toml"
  - "**/.mise.toml"
alwaysApply: false
---

# lazymise — mise CLI & TUI for agent-driven dev-environment management

`lazymise` wraps the `mise` CLI with a fast keyboard-driven TUI and a thin passthrough CLI.
It does NOT reimplement mise; every install, upgrade, version switch, and task execution is
delegated to the local `mise` binary. Use lazymise when you need to discover, install, or
switch tool versions inside a project (or globally) without remembering mise's full CLI surface.

## CLI Quick Reference

Run any of these non-interactively — output goes to stdout/stderr exactly as `mise` would:

| Command | Description |
|---|---|
| `lazymise` | Open interactive TUI (default) |
| `lazymise ls` | List installed tools (`mise ls`) |
| `lazymise current` | Show current tool versions (`mise current`) |
| `lazymise outdated` | Check for outdated tools (`mise outdated`) |
| `lazymise registry [QUERY]` | Search tool registry (`mise registry`) |
| `lazymise install <TOOL@VER>` | Install a tool version (`mise install --yes`) |
| `lazymise uninstall <TOOL@VER>` | Uninstall a tool version (`mise uninstall --yes`) |
| `lazymise upgrade [TOOLS...]` | Upgrade tools; all if none given (`mise upgrade --yes`) |
| `lazymise use <TOOL@VER>` | Set tool version in current scope (`mise use --yes`) |
| `lazymise run <TASK>` | Run a mise task (`mise run`) |
| `lazymise tasks` | List available tasks (`mise tasks`) |
| `lazymise help [COMMAND]` | Show mise help for a command |
| `lazymise update` | Update lazymise itself to the latest version |
| `lazymise --help` | Show lazymise help |
| `lazymise --version` | Show lazymise version |

All CLI commands are thin wrappers that pass arguments directly to `mise`. Output is
inherited — the agent sees exactly what `mise` would print.

## When to Use lazymise CLI vs Raw `mise`

- **Prefer `lazymise <cmd>`** when you want a single surface for all mise operations.
  It adds `--yes` automatically for install/uninstall/upgrade/use (no interactive prompts).
- **Use raw `mise`** when you need flags lazymise doesn't expose (e.g. `--jobs`, `--verbose`).

## Typical Agent Workflows

### Check what tools a project needs
```bash
lazymise ls          # list installed tools with versions
lazymise current     # active versions per tool
lazymise outdated    # what needs upgrading
```

### Install a specific tool version
```bash
lazymise install node@22.18.0
lazymise use python@3.13       # set as current + install
```

### Add a tool from a backend
```bash
lazymise install npm:pnpm@10
lazymise use cargo:ripgrep@latest
```

### Run project tasks
```bash
lazymise tasks       # discover available tasks
lazymise run dev     # run the "dev" task
lazymise run test    # run the "test" task
```

### Batch upgrade
```bash
lazymise upgrade              # upgrade all outdated tools
lazymise upgrade node python  # upgrade specific tools
```

### Self-update lazymise
```bash
lazymise update
```
Tries: mise → cargo install → direct GitHub release download.

### Discover available tools in the registry
```bash
lazymise registry node       # search registry for "node"
lazymise registry            # list all registry entries
```

## TUI (Interactive Mode)

Run `lazymise` with no arguments to open the terminal UI. The TUI is keyboard-driven:

| Key | Action |
|---|---|
| `1-8` | Jump to page (Dashboard, Tools, Updates, Tasks, Environment, Config, System, Preferences) |
| `j/k` or `↑/↓` | Navigate lists |
| `h/l` or `←/→` | Switch panels |
| `Tab` | Cycle focus (Sections → List → Details) |
| `Enter` | Select / execute |
| `a` | Add tool (opens registry picker) |
| `u` / `U` | Upgrade selected / all |
| `d` | Delete / uninstall |
| `i` | Install version |
| `v` | View & switch version |
| `r` | Refresh |
| `/` | Search / filter |
| `q` | Quit / cancel |
| `:` | Expert command entry |

## Environment & Scope

- **Project scope**: writes to the nearest `mise.toml` (default).
- **Global scope**: writes to `~/.config/mise/config.toml`.
- Switch scope inside the TUI with `p` (project) / `G` (global).
- CLI commands use mise's default scope resolution; use `mise use --global ...` directly for global.

## Important Constraints

- `lazymise` MUST be run from within a project directory (or with mise already activated)
  for project-scoped operations to work correctly.
- The TUI MUST run in a real terminal — do NOT attempt to drive the TUI programmatically.
  Use CLI subcommands for automation.
- `lazymise` adds `--yes` automatically to destructive commands. There is no confirmation
  prompt when using CLI mode.
- Self-update (`lazymise update`) requires either `mise`, `cargo`, or `curl` on the host.