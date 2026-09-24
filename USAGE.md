# lazymise 操作手册

## 启动

```bash
lazymise
```

在目标项目目录运行；也可将项目目录作为 TUI 的位置参数。CLI 子命令继续直接调用 mise，其参数不受 TUI 配置目标影响。

## 配置文件优先

启动时默认选中已发现的全局配置文件，顶部显示其路径及 `F2 选择`。路径依次遵循 `MISE_GLOBAL_CONFIG_FILE`、`MISE_CONFIG_DIR`、`XDG_CONFIG_HOME/mise`，否则使用 `~/.config/mise/config.toml`。没有有效全局文件时显示“未选择”，不会自动创建文件或改选列表第一项。F2 可切换到项目等其他文件，刷新保留手动选择；下次启动重新默认全局，不恢复上次目标。

1. 按 `F2` 打开配置选择器，或按 `6` 进入 Config，在列表中按 `Enter` 选择当前文件。
2. 选择器合并显示发现的项目和全局文件，按绝对路径去重；高亮仅表示游标位置，不等于已经选择。
3. 选择后顶部显示写入路径，Config 当前目标行带 `●` 标记。项目内路径使用 `./` 前缀；详情及选择器可查看完整路径。
4. 再按 `a` 添加工具、`A` 输入自定义工具，或在 Tools 列表按 `Enter/v` 选择版本。

目标未选择时，以上写入入口先要求选择文件；成功后只恢复原流程，不直接提交命令。取消不会执行任何命令。

### 配置选择器

| 按键                          | 操作                                               |
| ----------------------------- | -------------------------------------------------- |
| `j/k`、上下方向键、`Home/End` | 选择文件或操作行                                   |
| `/`                           | 按路径子串搜索，不区分大小写                       |
| `Enter`                       | 验证并选择文件，或进入当前操作                     |
| `r`                           | 非编辑态重新发现配置；失败保留原列表并显示原始原因 |
| `Esc/q`                       | 非编辑态返回上一级                                 |
| `PgUp/PgDn`                   | 根据位置提示滚动过长的路径或错误内容               |

“新建当前项目 mise.toml”仅在该路径不存在时出现。“输入配置文件路径…”始终可用；这两条操作不参与搜索，也不伪装为已发现配置。

### 手动路径与新建

可输入绝对路径、相对项目目录的路径，或显式 `~/` 路径。仅 `~/` 展开为主目录，`$VAR` 等文字不展开。

- 已有目标必须是普通 `.toml` 文件；允许指向普通文件的符号链接，执行时仍传入用户选择的绝对路径。
- 拒绝目录、断链、特殊文件、`rust-toolchain.toml` 和其他格式。发现的其他格式仍可在 Config 中 `e` 编辑、`y` 复制。
- 不存在的目标显示包含完整路径的创建确认。父目录必须已经存在；应用不自动创建目录。
- `Enter/y` 批准创建，`Esc/n/q` 取消并保留原路径输入。**批准只保存创建授权，不创建文件。** 后续 Use 才交给 mise 创建。
- 路径输入中的 `Esc` 返回选择器列表并保留文字；`Ctrl+u` 清空输入。

每次 Use 都重新验证文件。已有文件后来消失会阻止提交，保留工具及版本输入，允许通过 F2 修正；不会退回默认项目或全局文件。文件实际创建后即消耗创建授权，后来删除必须重新确认。权限、内容解析及真正写入错误由 mise 报告，不通过事先权限检查承诺成功。

### 目标影响范围

仅引导的 Use 与 Custom Tool 使用目标：

```text
mise use --yes --path /absolute/config.toml cargo:example@1.2.3
```

路径与完整 spec 各自是独立 argv 参数，空格不会拆开文件路径。目标不通过 `--global`、cwd 或 HOME 模拟；环境中的默认全局配置路径不会替代明确的 `--path`。切换目标也不会改变已经提交的命令。

Tools 始终保留完整库存。配置目标不控制以下操作：

- Install：`mise install --yes TOOL@VERSION`
- Uninstall：确认后 `mise uninstall --yes TOOL@VERSION`
- Upgrade、Tasks、页面命令及专家参数

Upgrade 和专家命令仍可能按 mise 自身规则修改配置；选择目标并不是它们的沙箱。旧 `p/G` 作用域切换已移除，Custom Tool 的 Tab 不再隐藏地切换目标。目标仅保存在本次会话，只有语言设置持久化。

## 页面与焦点

| 按键 | 焦点        |
| ---- | ----------- |
| `1`  | Navigation  |
| `2`  | List        |
| `3`  | Details     |

页面通过 Navigation 的 `Enter` 进入，`[` / `]` 在相邻页面间切换；数字只移动焦点，不重置选中行。

三个焦点为 Navigation、List、Details，青色边框和高亮表示当前位置：

- Navigation：`j/k` 或上下键浏览分区；`Enter` 进入 List。
- List：`j/k` 移动选中行，`Home/End` 跳到首尾。
- Details：`j/k`、`Ctrl+d/u`、`Home/End` 滚动实际内容，位置计数显示可见范围。
- `h/l` 或左右键移动焦点；`Tab/Shift-Tab` 循环焦点。
- `Esc` 依次 Details → List → Navigation；Navigation 中 Esc 不动作。

列表按实际面板高度分页，选中行始终可见。所有页面的三栏布局统一按导航、列表、详情约 1:2:2 分配，终端列数取整时列表与详情最多相差一列；工具名随可用宽度展开。窄窗口仍使用上下布局，过小窗口显示调整尺寸提示。

### List 的 Enter 主动作

| 页面                 | Enter                            |
| -------------------- | -------------------------------- |
| Dashboard            | 无隐藏命令；用 `m` 查看页面命令  |
| Tools                | 为选中工具打开 Use 版本选择      |
| Updates              | 确认已标记工具；未标记时仅当前行 |
| Tasks                | 执行选中的 `mise run <task>`     |
| Environment / System | 打开选中命令的帮助及参数输入     |
| Config               | 将当前文件设为写入目标，不跳页   |
| Console / Logs       | 聚焦输出 Details                 |

Enter 在任何页面打开 Details。所有选中项动作键（Tools：`I`/`i`/`D`，Updates：`Space`/`u`/`U`，Tasks 与 Environment/System：`R`，Config：`s`/`e`/`y`，Console：`D`）只在 List 生效；Details 焦点不会触发列表动作键。

## 添加、切换、安装与卸载

### registry 添加工具

1. 按 `a`；若尚无目标，先选择配置文件。
2. 从 `mise registry --json` 加载工具和来源；`Tab/Shift-Tab` 循环实际发现的来源过滤。
3. `/` 编辑搜索；`Enter` 接受查询并退出编辑，再按 Enter 选择工具。搜索也接受完整后端标识：未收录进 mise 注册表的工具（如 `npm:uapp`）以“完整标识”行出现，Enter 进入版本选择；带 `@版本` 的标识（`npm:uapp@3.2.1`）与 Custom Tool 相同，直接提交 Use。
4. 多个来源时进入来源选择；零或单一来源直接进入版本选择。
5. 选择版本，Enter 提交 Use。完整后端工具标识保持原样传入 mise。

返回只沿实际经过的层级：版本 → 来源（若经过）→ registry。每层保留查询、过滤和游标；从 Tools 直接打开版本时，Esc 返回 Tools，不出现空 registry。

### 自定义工具

按 `A` 输入完整 spec，例如：

```text
cargo:example@1.2.3
github:owner/repository@latest
npm:package@1.0.0
```

Enter 直接以原 spec 提交 Use，不额外解释标识。输入框显示同一个配置目标。加载完成的写入选择器或 Custom Tool 中按 `F2` 可选择新目标，返回后保留输入和选中版本，仍需用户 Enter 才提交。加载中 F2 只提示等待。安装-only、确认、Help 和专家 Builder 不截获 F2。

### Tools

- `Enter/v`：查询远程版本并写入所选配置文件；Use 也会安装缺失版本。
- `i`：查询版本并仅安装，明确显示“不修改配置”，不要求目标。
- `d`：显示准确 `tool@version` 的卸载确认；确认前和取消后都不运行卸载。

## 搜索、返回与加载

`/` 显式打开搜索。未绑定字母不会自动进入搜索；编辑时 `p/G/j/k/q` 都是文字。

- Enter 接受查询，退出编辑，不同时选择结果。
- Esc 恢复进入编辑前的查询和游标；再次 Esc 才返回上级。
- Ctrl+u 清空当前文本，Backspace 一次删除一个完整 grapheme，包括组合字符和 emoji。
- 其他 Ctrl/Meta 不输入文字，也不穿透执行动作。
- 非文本态 Esc/q 返回一级；Ctrl+c 取消整个弹窗流程。主页面 q/Ctrl+c 退出。

页面过滤与高亮、详情、Enter 使用同一批可见记录：Tools 名称/版本，Updates 名称/当前版本，Tasks 名称/描述，Config 路径/工具，Console 标签/命令/输出，Logs 命令/输出，Environment/System 所属页面命令的名称/描述。Console 与 Logs 都按最新优先顺序显示。

registry、远程版本和命令帮助先显示加载层。取消或换页后到达的结果丢弃，不重开弹窗。查询失败留在当前层显示原始原因；非编辑态 `r` 重试。Builder 在帮助阅读模式按 r 重试，参数输入中的 r 仍是文字。

## 更新确认

1. 按 `3` 进入 Updates，用 `j/k` 选择当前行。
2. `Space` 标记或取消标记。改变过滤条件不会丢弃隐藏行的标记。
3. `Enter/u` 确认全部已标记工具；没有标记时，仅确认当前一项。
4. `U` 明确确认当前过滤结果中的全部工具，与标记集合无关。
5. 确认展示完整名单、数量和范围。用 `j/k`、方向键、Home/End 滚动；固定底行保留 `Enter/y` 确认及 `Esc/n/q` 取消。

空列表不发命令。确认时捕获名字数组，之后过滤或快照变化不会扩大目标。刷新后仅移除已经不存在的工具标记，不自动全量升级。

## 页面命令与专家命令

`m` 只列当前页所属命令；Dashboard 才显示 Dashboard 命令。Environment 与 System 的 List 也直接展示各自命令。

`:` 打开完整动态命令目录，作为专家入口。选择命令后显示 `mise <command> -h`，输入参数并 Enter 执行；**不会隐式加入当前配置目标或 --path**。参数框沿用现有空白分隔规则，不是 shell，也不展开变量或执行 shell 表达式。

Builder 的 Tab 在参数和帮助间切换；帮助态用 j/k、方向键、Home/End 阅读，Esc/q 先回参数。参数态的 q 是文字，Esc 返回原命令目录并保留目录查询。危险命令确认取消后回到原 Builder，保留参数和帮助位置；成功提交消耗整个流程。

`upgrade` 与现有危险命令一样要求确认。专家确认展示确切命令，目标由显式参数和 mise 决定，不宣称使用顶部文件。

`exec`、`en`、`watch`、`mcp` 等交互命令透传终端。子进程无法修改父 shell；永久激活 mise 仍需在 shell 配置中执行，例如：

```bash
eval "$(mise activate zsh)"
```

## Console 与 Logs

Use、Install、Uninstall、Upgrade 在后台执行，不阻塞 UI。按 `9` 查看 Console，按 `0` 查看 Logs。

Console 显示 pending/running/done/failed、命令、耗时及输出。必须等进程退出且 stdout/stderr 读取完成，才标记最终状态；启动失败、非零退出、输出读取或完成处理失败也会写入日志，不退出 TUI。成功后刷新；失败保留数据及原始错误。

Enter 聚焦输出。Console List 的 d 清除已完成/失败项，保留运行项。两个列表各最多 100 条；新任务插入或成功刷新尽量保留当前选中实体，而不是让游标跳到另一条记录。

## 编辑与复制配置

Config List 的 e 编辑当前文件，y 复制文件全文；都不受是否可作为引导写入目标限制。剪贴板调用按系统使用 macOS `pbcopy`、Linux `wl-copy`、Windows `clip`，失败显示原始原因。

编辑由 `mise edit <path>` 执行，编辑器选择遵循 mise 自身配置与环境。编辑和专家流程的执行异常会显示在状态和日志中。

## 语言与帮助

按 `:` 打开设置弹层（语言 / 主题两行）：`j/k` 选行，`Enter`/`l` 下一值、`h` 上一值，即时生效并保存，`Esc` 关闭；`L` 直接切换语言。保存失败保留原语言。

默认语言设置路径为 `~/.config/lazymise/settings.json`，支持 `LAZYMISE_CONFIG_DIR` 和 `XDG_CONFIG_HOME`。不持久化配置目标。

`?` 打开帮助，支持滚动及 Esc/q 返回。全局 footer 按页面与焦点显示真实动作；每个弹窗还有本地操作提示。过长路径和错误可按 PgUp/PgDn 查看，位置提示出现在弹窗边框。

## 故障定位

只读检查：

```bash
mise config ls --json
mise use --help
mise ls-remote node --json
mise tasks --json
```

配置发现解析失败不会伪装为空列表；旧快照和旧目标继续保留。写入失败不回退全局或默认目录。完整输出可在 Console/Logs 查看。
