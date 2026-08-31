# lazymise 操作手册

`lazymise` 是基于 Rust、Ratatui 和 Crossterm 的 mise TUI。界面负责发现、选择和确认；实际的安装、切换、卸载、升级和任务执行仍由本机 `mise` CLI 完成。

## 安装与启动

```bash
cargo install --path .
lazymise
```

开发模式：

```bash
cargo run
```

请在目标项目目录中运行。`lazymise` 会读取当前目录生效的全局与项目级 mise 配置。

## 界面布局

```text
┌──────────────────────────────────────────────────────────────────────┐
│ LAZYMISE                         [PROJECT]           mise 2026.x     │
├───────────────┬────────────────────────┬─────────────────────────────┤
│ Sections      │ 当前分区列表             │ 选中项详情                    │
│               │                        │                             │
│ ▸ Dashboard   │ [ ] node  24 → 25      │ Current       24            │
│   Tools       │ [x] python 3.13 → 3.14 │ Latest        25            │
│   Updates     │                        │ Selected      yes           │
│   Tasks       │                        │                             │
│   Environment │                        │ Enter open action           │
│   Config      │                        │ m related actions           │
│   System      │                        │                             │
│   Preferences │                        │                             │
│   Command Log │                        │                             │
├───────────────┴────────────────────────┴─────────────────────────────┤
│ Ready  m 页面操作  E 环境  o 设置  : 专家入口  ? 帮助              │
└──────────────────────────────────────────────────────────────────────┘
```

- 左侧：功能分区和当前环境摘要。
- 中间：工具、版本、更新、任务、配置或命令列表。
- 右侧：选中项详情。
- 青色边框：当前获得键盘焦点的面板。
- 窗口较窄时，列表和详情自动变为上下布局。
- 顶部 `[PROJECT]` / `[GLOBAL]` 表示新增或切换版本时写入哪个作用域。

## 完整快捷键

### 导航

| 按键                | 操作                                  |
| ------------------- | ------------------------------------- |
| `h` / `←` / `Esc`   | 向左移动焦点；`Esc` 直接返回 Sections |
| `l` / `→` / `Enter` | 向右移动焦点                          |
| `j` / `↓`           | 下一个分区、下一行，或向下滚动详情    |
| `k` / `↑`           | 上一个分区、上一行，或向上滚动详情    |
| `Tab`               | 按 Sections → List → Details 循环切换 |
| `Shift-Tab`         | 按 Details → List → Sections 反向循环 |
| `Ctrl-d`            | 向下移动或滚动 5 行                   |
| `Ctrl-u`            | 向上移动或滚动 5 行                   |
| `Home` / `End`      | 在列表中跳到第一行 / 最后一行         |
| `[` / `]`           | 上一个 / 下一个分区                   |

界面有三个可聚焦面板：Sections、List、Details。青色边框明确表示当前焦点。焦点在 Sections 时 `j/k` 切换分区；在 List 时切换列表项；在 Details 时滚动详细内容。

### 页面跳转

| 按键      | 页面               |
| --------- | ------------------ |
| `1` / `g` | Dashboard          |
| `2`       | Tools              |
| `3` / `u` | Updates            |
| `4` / `t` | Tasks              |
| `5` / `E` | Environment        |
| `6` / `c` | Config             |
| `7` / `s` | System             |
| `8` / `o` | Preferences / 设置 |
| `x`       | Command Log        |

### 界面语言

`lazymise` 支持中文和英文界面：

1. 按 `8` 或 `o` 打开 Preferences / 设置。
2. 选中 Language / 语言。
3. 按 `Enter` 在 `中文` 与 `English` 之间切换。

切换立即生效并自动保存。默认配置路径：

```text
~/.config/lazymise/settings.json
```

遵循 `$LAZYMISE_CONFIG_DIR` 和 `$XDG_CONFIG_HOME`；设置前者时，文件写入 `$LAZYMISE_CONFIG_DIR/settings.json`。

### 搜索和选择

| 按键        | 操作                                                  |
| ----------- | ----------------------------------------------------- |
| `/`         | 搜索或过滤当前列表；在选择器中再次按 `/` 可过滤候选项 |
| `Backspace` | 删除一个搜索字符                                      |
| `Enter`     | 应用搜索，或选择当前候选项                            |
| `Esc`       | 清除搜索并关闭输入框，或取消选择器                    |
| `Space`     | 在 Updates 页面选中或取消选中更新项                   |

搜索覆盖 Tools、Updates、Tasks、Environment、Config、System 和 Command Log。工具注册表支持按工具名、描述、后端及多个关键词筛选；输入没有注册表匹配项的 `github:owner/repository` 后按 `Enter`，可直接查询该后端的版本。版本选择器可按版本号搜索。

### 工具管理
工具列表的“最新”列仅评估已安装且当前启用的版本：`是` 表示 `mise outdated` 未报告更新，`否` 表示存在更新，`—` 表示该版本未启用或尚未安装。


| 按键 | 生效位置   | 操作                                                         |
| ---- | ---------- | ------------------------------------------------------------ |
| `a`  | 任意主页面 | 打开 mise registry；选择器内按 `c` 可输入自定义后端工具      |
| `A`  | 任意主页面 | 直接输入 `github:owner/repo`、`npm:package` 等后端工具标识   |
| `v`  | Tools      | 查询选中工具的所有远程版本，选择后安装并激活到当前 scope     |
| `i`  | Tools      | 查询选中工具的所有远程版本，仅安装选中版本，不修改配置       |
| `d`  | Tools      | 请求确认后卸载选中的已安装版本                               |
| `p`  | 任意主页面 | 将写入作用域设为 Project                                     |
| `G`  | 任意主页面 | 将写入作用域设为 Global                                      |

不在 mise registry 中的工具也可以添加。例如 LazySQL：

```text
A → github:jorgerojas26/lazysql → 选择版本
```

也可以粘贴 GitHub URL，或输入 `owner/repository`，lazymise 会转换为 `github:` 后端标识。

对应的 mise 命令：

```text
a / v + PROJECT  → mise use --yes TOOL@VERSION
a / v + GLOBAL   → mise use --yes --global TOOL@VERSION
i                  → mise install --yes TOOL@VERSION
d                  → mise uninstall --yes TOOL@VERSION
```

### 更新、任务和配置

| 按键           | 操作                                      |
| -------------- | ----------------------------------------- |
| `Space`        | 选中或取消选中当前更新                    |
| `U`            | 升级已选工具；未选择时升级全部过期工具    |
| `Enter`        | 在 Tasks 页面执行选中的 `mise run <task>` |
| `e`            | 在 Config 页面打开选中的配置文件          |
| `r`            | 重新读取工具、更新、任务和配置状态        |
| `?`            | 打开完整内置帮助                          |
| `q` / `Ctrl-c` | 退出；在弹窗内 `q` 通常关闭弹窗           |

## 按工作流组织 mise 功能

大部分命令不再要求先按 `:`。主界面按照用户目标组织，而不是照抄 CLI 字母表：

| 页面               | 主要命令与能力                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Dashboard          | `doctor`、`bootstrap`、`version`、`self-update`、`help`                                           |
| Tools              | 工具列表、版本发现、`install`、`use`、`uninstall`、`registry`、`plugins`、`backends`、`sync` 等   |
| Updates            | `outdated`、多选 `upgrade`、`prune`                                                               |
| Tasks              | 任务列表、`run`、`watch`、`tasks`、`deps`                                                         |
| Environment        | `activate`、`deactivate`、`env`、`en`、`exec`、`shell`、`shell-alias`、`bin-paths`、`which`       |
| Config             | 配置列表与编辑、`config`、`fmt`、`lock`、`set`、`unset`、`settings`、`trust`、`untrust`           |
| System             | `doctor`、`bootstrap`、`cache`、`completion`、`generate`、`mcp`、`oci`、`self-update`、`token` 等 |
| Preferences / 设置 | 切换并持久化 lazymise 界面语言；当前支持中文和英文                                                |
| Command Log        | 最近命令、状态和输出                                                                              |

### 页面内相关操作

在任意页面按 `m`，只显示与当前工作流相关的命令：

```text
Tools + m    → install/use/uninstall/registry/plugins/backends/...
Tasks + m    → run/watch/tasks/deps
Config + m   → config/edit/fmt/set/unset/settings/trust/...
Updates + m  → outdated/upgrade/prune
```

这样无需从 59 个无关命令中搜索。

### Environment 和 System 页面

Environment 与 System 页面直接把相关命令作为 List 内容：

1. 按 `5` / `E` 进入 Environment，或按 `7` / `s` 进入 System。
2. `j/k` 选择操作。
3. 右侧查看用途。
4. `Enter` 打开该命令的实时帮助和参数框。
5. 输入参数后再次 `Enter` 执行。

例如执行：

```bash
mise exec node@22 -- node --version
```

无需打开全局面板：

```text
E → 选择 exec → Enter
参数：node@22 -- node --version
Enter
```

参数页实时显示 `mise <command> -h`。参数支持 shell 引号，但参数框不重复输入 `mise` 和命令名。

### `:` 仅作为专家兜底

`:` 的定位是：已经知道准确命令时的快速入口，以及未来新增命令的自动兜底。命令列表通过当前安装版本的 `mise -h` 动态生成。

当前 59 个顶层命令全部分配到了至少一个工作流，同时也全部可以从 `:` 访问：

```text
activate       backends       bin-paths       bootstrap
cache          completion     config          deactivate
deps           doctor         edit            en
env            exec           fmt             generate
implode        install        install-into    latest
link           lock           ls              ls-remote
mcp            oci            outdated        patrons
plugins        prune          registry        reshim
run            search         self-update     set
settings       shell          shell-alias     sponsors
sync           tasks          test-tool       token
tool           tool-alias     tool-stub       trust
uninstall      unset          untrust         unuse
upgrade        use            version         watch
where          which          help
```

`cache`、`config`、`implode`、`prune`、`self-update`、`sync`、`uninstall`、`unset`、`untrust`、`unuse` 执行前追加确认。

`exec`、`en`、`watch`、`mcp` 等交互式或长时间运行命令使用真实终端透传，结束后返回 lazymise。

### Shell 命令限制

`activate`、`deactivate`、`env` 和 `shell` 可以执行并查看输出，但子进程无法修改启动 lazymise 的父 shell。永久启用 mise 仍应在 shell 配置中执行：

```bash
eval "$(mise activate zsh)"
```

## 智能版本发现

### 查看某个工具有哪些版本

1. 按 `2` 进入 Tools。
2. 用 `j/k` 选中工具。
3. 按 `v` 或 `i`。
4. lazymise 调用：

   ```bash
   mise ls-remote <tool> --json
   ```

5. 版本按最新到最旧排列，同时显示发布时间和状态：

   ```text
   Version             Released                  State
   26.7.0              2026-08-20T...            active
   26.6.0              2026-08-10T...            installed
   26.5.0              2026-07-30T...
   ```

6. 候选很多时按 `/` 输入主版本，例如 `24.`，只显示匹配版本。
7. `Enter` 选择；`Esc` 取消。

`v` 表示“安装并写入当前 scope”；`i` 表示“仅安装”。两者不会混淆。

### 添加当前没有的工具

1. 按 `a`。
2. lazymise 调用 `mise registry --json` 加载官方注册表。
3. 按 `/` 搜索工具名、描述或后端，例如 `java`、`AI`、`github:owner`。
4. `Enter` 选择注册表工具；若输入的是无匹配项的 `github:owner/repository`，则直接查询该后端。
5. 搜索并选择版本。
6. lazymise 根据顶部 scope 执行 Project 或 Global 的 `mise use`。

这样不需要提前记住 backend 或版本号。

## Project 与 Global scope

### Project

按：

```text
p
```

顶部显示 `[PROJECT]`。`a` 和 `v` 默认写入当前项目的 `mise.toml`。

### Global

按：

```text
G
```

顶部显示 `[GLOBAL]`。`a` 和 `v` 使用 `mise use --global` 写入全局配置。

`i` 只安装版本，不写配置，因此不受 scope 影响。`d` 删除具体安装版本，也不修改 `mise.toml`。

### 示例：全局 Node 26，项目使用 Node 22

全局默认版本：

```bash
mise use --global node@26
```

进入项目后设置项目版本：

```bash
cd ~/workspace/my-node-22-project
mise use node@22
```

第二条命令会创建或更新项目目录中的 `mise.toml`：

```toml
[tools]
node = "22"
```

mise 按目录解析配置，项目配置优先于全局配置：

```text
~/workspace/my-node-22-project  → node 22
其他没有项目配置的目录           → node 26
```

可以检查当前实际生效版本：

```bash
mise current node
node --version
```

前提是 shell 已启用 mise，例如 zsh 的 `~/.zshrc` 中包含：

```bash
eval "$(mise activate zsh)"
```

在 lazymise 中，先按 `p` 切换到 `[PROJECT]`，再按 `v` 给 Node 选择 22；这等价于项目内执行 `mise use node@22`。按 `G` 只会把后续 `a`/`v` 的写入目标改成全局，它本身不会立即改变任何版本。

## 批量更新

1. 按 `u` 进入 Updates。
2. 使用 `j/k` 移动。
3. 用 `Space` 选择多个更新，选中项显示 `[x]`。
4. 按大写 `U` 升级选中工具。
5. 如果一个都没有选择，`U` 升级全部过期工具。

小写 `u` 只跳转页面；大写 `U` 才执行升级，避免误操作。

## 删除版本

1. Tools 页面选中一个已安装版本。
2. 按 `d`。
3. 确认窗口显示准确的 `tool@version`。
4. `Enter` / `y` 确认；`n` / `Esc` 取消。

卸载只执行 `mise uninstall`，不会偷偷修改 mise 配置。若配置仍引用该版本，刷新后会显示为缺失，应使用 `v` 切换到其他版本或手动修改配置。

## Command Log

按 `x` 打开命令日志。每条记录包含：

- 实际执行的命令；
- 成功或失败状态；
- mise 的 stdout 和 stderr；
- 编辑器与交互任务的完成状态。

命令失败后状态栏会提示按 `x` 查看输出。日志最多保留当前会话最近 100 条，避免无限增长。

## 配置编辑器

Config 页按 `e`，编辑器选择优先级：

1. `$VISUAL`
2. `$EDITOR`
3. `vi`

支持带参数的命令：

```bash
export EDITOR="zed --wait"
export VISUAL="nvim"
```

## 安全边界

- `d` 必须经过确认弹窗。
- `U` 只升级 Space 选中的工具；无选择时才升级全部。
- Project / Global 始终显示在顶部，写入前可明确检查。
- `i` 不激活版本；`v` 和 `a` 才会写配置。
- lazymise 不重新实现 mise，不直接操作 mise 的安装目录。

## 故障处理

确认 mise 可用：

```bash
mise --version
```

确认某个 backend 可以返回版本：

```bash
mise ls-remote node --json
```

确认当前项目任务：

```bash
mise tasks --json
```

如果命令失败，在 lazymise 中按 `x` 查看完整输出。终端显示异常时，请使用支持 UTF-8 的终端并检查 `$TERM`。
