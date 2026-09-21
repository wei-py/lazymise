---
name: lazymise-development
description: Project-level engineering rules for Bun, @opentui/core TUI, state and event architecture, mise CLI integration, safety, testing, performance, i18n, and Git changes in lazymise.
globs:
  - "src/**/*.js"
  - "package.json"
  - "bun.lock"
  - "mise.toml"
  - "README.md"
  - "USAGE.md"
alwaysApply: true
---

# lazymise 项目开发规范

本规范适用于 lazymise 的所有代码、配置、测试和文档修改。关键词 `MUST`、`MUST NOT`、`SHOULD`、`MAY` 按 RFC 2119 理解。

## 修改前的固定检查

1. 先读取受影响模块及相邻实现，复用现有模式，不引入第二套架构。
2. 修改公开 PAGE、FOCUS、SCOPE、OVERLAY_TYPE 等枚举，或 Application 方法签名前，查找并迁移全部调用点。
3. 明确状态不变量、用户可见行为、失败路径和需要保护的现有行为。
4. UI 修改必须在实际 TUI 中验证；行为修改必须有覆盖该行为的测试或可复现的运行证据。

## 1. JavaScript 代码规范

- MUST 使用当前稳定、直接、可读的 JavaScript (ES modules)；优先纯函数、解构和现代语法。
- MUST 让状态对象表达不变量。有限状态使用枚举常量（`state.js` 中的 PAGE/FOCUS/SCOPE），避免互相矛盾的布尔值集合。
- MUST 保持所有 switch/case 穷尽；新增页面/overlay 时同步处理渲染、标题、计数、选择和退出路径。
- MUST NOT 在生产路径使用未捕获的 throw；失败路径 MUST 转换为本地化 status 或日志。
- SHOULD 避免不必要的对象分配和数组复制；热路径优先引用传递。
- SHOULD 使用 `clipColumns`、`moveIndex`、边界夹取处理 TUI 索引、尺寸与滚动值。
- MUST 通过 ESLint（`bun run lint`）；不得用宽泛 disable 注释隐藏可修复问题。
- MUST NOT 为单一调用点创建无语义包装或抽象层；抽象必须减少重复并明确边界。

## 2. @opentui/core UI 规范

- `view.js` MUST 只读取 `Application.state` 并渲染；不得调用 mise、修改应用状态或执行阻塞 I/O。
- MUST 使用 `box`、`panel`、`showNode`、`renderBox` 和 `layoutMode` 处理终端尺寸；不得假设固定宽高。
- MUST 在窄终端（`layoutMode === 'small'`）和短终端下保持边框、标题、关键内容和 footer 不重叠。
- 列表 MUST 保持选中项可见（`windowContent`）；筛选、选中和渲染必须使用同一谓词和可见索引语义。
- 长文本 MUST 使用 `clipColumns` 截断（带 `…`），detail panel 使用 `detailScroll` 滚动并显示位置提示。
- 当前焦点 MUST 有可见的颜色反馈（`COLORS.accent`/`COLORS.selected`）；不可只靠文字描述焦点。
- MUST 复用 `panel`、`box`、`renderBox`、`windowContent`、`clipColumns`、`pageActionsHint` 等现有渲染 helper。
- MUST NOT 在每个页面创建不同的 modal、颜色或快捷键表达方式。
- 用户可见 UI 修改完成后，MUST 运行真实 TUI 并验证目标页面、overlay、窄尺寸和中英文中的实际显示。

## 3. TUI 状态管理

- `Application.state` 是应用状态的唯一所有者；状态转换集中在 `controller.js` 的 `Application` 类中。
- overlay 专属状态 MUST 存放在 `state.overlay` 的对应 `OVERLAY_TYPE` 变体中，不得散落为无关全局字段。
- 状态更新 MUST 是确定性的：同一状态和同一按键产生同一新状态。
- 每次查询、筛选、页面或数据集改变后，MUST 通过 `clampSelection()` 重置或夹取 `selected`、`detailScroll`，防止越界。
- 返回上一级 overlay 时，MUST 恢复用户仍需要的查询、筛选和选中位置；取消整个流程时才丢弃状态。
- 同步外部查询失败时，MUST 保留来源 overlay/输入，允许用户重试或选择其他项。
- MUST NOT 在渲染阶段修复状态；越界防护和状态不变量应在 `update()` 前的转换发生时维护。

## 4. Event / 按键架构

- 输入流 MUST 保持：@opentui/core key event → `Application.handleKey()` → 状态更新 → `this.update()` → `view` 渲染。
- `handleKey` MUST 负责解释按键和更新状态；MUST NOT 直接操作终端。
- 外部副作用（mise 命令、编辑器）由 `executeCommand`/`executeBackground`/`openConfig` 等方法处理，不经过 action 枚举。
- overlay MUST 先消费输入（`handleOverlayKey`）；全局快捷键不得穿透 overlay。
- 新增按键 MUST 同步：所有页面 case、页脚 `pageActionsHint`、帮助 overlay 和 i18n。
- MUST NOT 在多个 key handler 中复制相同转换；抽取小型状态 helper，并保持 overlay 优先于全局快捷键。

## 5. mise CLI 调用规范

- 所有 mise 数据访问、解析和命令执行边界 MUST 集中在 `mise.js` 的既有函数中。
- MUST 使用 `Bun.spawn(['mise', ...args])` 或 `execute()` helper；MUST NOT 用 shell 字符串执行用户输入。
- 可机器读取的数据 MUST 优先请求 `--json` 并用 `JSON.parse` 解析；解析错误必须包含具体 mise 子命令上下文。
- backend spec、工具名和版本是 opaque value；MUST 原样传递，不得擅自去前缀、改写别名或丢失来源。
- `mise use`、`install`、`uninstall`、`upgrade` 的参数顺序、scope 和 `--yes` 语义必须保持现有行为。
- 命令展示字符串只用于日志/状态；不得把展示字符串重新解析成执行参数。
- stdout 与 stderr 的合并、退出状态和无输出行为 MUST 一致记录到 `logs` 和 `consoleTasks`。
- 新增 mise 集成前 MUST 检查当前安装版本的真实 `mise <command> -h`/JSON 输出，不依赖记忆猜测接口。

## 6. 错误处理

- 可失败操作 MUST try/catch，并在失败时设置本地化 `state.status` 或写入 `logs`；不得使 TUI 崩溃。
- 错误信息 MUST 包含失败操作和必要参数，但 MUST NOT 泄露 token、环境机密或完整敏感配置。
- MUST 保留原始错误 message；不得用含糊的"失败"替代根因。
- 终端 raw mode/alternate screen 的恢复 MUST 由 @opentui/core 的 `createApp`/exit 生命周期保证。
- MUST NOT 静默吞掉失败；若故意降级，必须有可观察状态或日志。

## 7. 后台任务规范

- mise install/use/upgrade/uninstall MUST 通过 `executeBackground()` 异步执行，不阻塞 UI 事件循环。
- `executeBackground` 使用 `Bun.spawn` + `new Response(proc.stdout).text()` 非阻塞捕获输出。
- 后台任务结果 MUST 写入 `consoleTasks`（实时状态）和 `logs`（历史记录）。
- `consoleTasks` 上限 100 条；`logs` 上限 100 条。
- 任务状态 MUST 能识别 pending/running/done/failed 四种状态。
- MUST 避免无界后台任务；同类任务各有独立的 spawn 实例。

## 8. 页面 / 文件拆分

- `main.js`：进程启动、终端生命周期（@opentui/core `createApp`）。
- `controller.js`：Application 类，领域状态、选择器/overlay 状态机、按键转换、mise 命令执行。
- `view.js`：纯 @opentui/core 布局和渲染函数（`navContent`、`listContent`、`detailContent`、`renderStatus`、`renderOverlay`）。
- `state.js`：PAGE/FOCUS/SCOPE/OVERLAY_TYPE 枚举、PAGE_ORDER、layoutMode、focusSeq、moveIndex、clipColumns、containsCaseInsensitive。
- `mise.js`：mise 进程调用、输出模型、解析、snapshot 加载。
- `config/i18n.js`：EN/ZH 词典和 `t()` 翻译函数。
- `config/settings.js`：持久设置（语言、scope）。
- `cli.js`：CLI 入口（`mise lazymise` 子命令）。
- 新页面 MUST 有清晰的状态来源、可见列表长度、选择 getter、按键路径和渲染分支。
- 跨文件共享类型（PAGE 等）集中在 `state.js`；仅 UI 使用的格式化 helper 留在 `view.js`。

## 9. Keyboard shortcut 规范

- 全局导航保持 Vim 与方向键成对：`h/j/k/l` 对应 `←/↓/↑/→`。
- overlay MUST 先消费输入；全局快捷键不得穿透 overlay。
- 文本输入模式中普通字符 MUST 输入文本；需要 `hjkl` 导航时必须有显式焦点/模式，并给出可见提示。
- `Esc` 表示返回、取消或清除当前局部模式；`q` 仅在非文本输入时取消 overlay/退出。
- `/` 表示筛选；`Enter` 表示应用、选择或执行；`Tab` 只用于焦点/筛选循环，并必须在 footer 解释局部语义。
- 新快捷键 MUST 检查所有页面、overlay、大小写和修饰键冲突，并同步 footer（`pageActionsHint`）、帮助 overlay、README/USAGE。
- destructive shortcut 不得直接执行；必须先进入确认 overlay（`OVERLAY_TYPE.ConfirmDelete`/`ConfirmCommand`）。
- `1-8` 页面跳转保持稳定顺序；新增页面使用字母键且不冲突。

## 10. i18n 规范

- 所有用户可见固定文本 MUST 同时提供 EN 和 ZH，复用 `t(language, key, params)`。
- 动态句子因语序不同不能简单插值时，MUST 按 language 分支构造完整句子。
- 不翻译命令名、backend spec、版本、路径、环境变量和代码片段。
- 中英文必须表达相同操作、风险和快捷键，不得只更新一种语言。
- 布局 MUST 使用 `clipColumns`（grapheme-aware）处理中文字符显示宽度和英文长文本；不得用字节长度作为终端显示宽度。
- 新增状态/错误/footer/help 后 MUST 在两种语言实际渲染验证。
- 持久语言切换 MUST 通过 `config/settings.js`，不得增加独立 locale 状态源。

## 11. destructive action 必须 confirmation

- uninstall、批量 upgrade、删除/覆盖配置及其他可能丢失状态的动作 MUST 在执行前显示明确确认 overlay。
- 确认内容 MUST 显示准确动作和目标；批量操作必须说明范围或目标集合。
- `Enter/y` 确认，`Esc/n/q` 取消的既有模式 SHOULD 保持一致。
- `--yes` 只能在用户已明确确认后添加；不得用 `--yes` 绕过产品确认。
- 新增/变更 destructive command 时 MUST 验证：首次按键只打开确认、取消不执行、确认正确执行。

## 12. 不允许破坏现有 mise.toml 行为

- MUST 保留现有 mise.toml 中的 task 定义和工具声明，除非用户明确要求迁移。
- 新 task/tool 必须与现有任务兼容。
- 代码不得编辑用户项目的 `mise.toml`，除非用户通过明确的 mise action 选择该行为；scope 必须尊重 SCOPE.Project/SCOPE.Global。
- 修改 `mise.toml` 前后 MUST 运行相关 `mise run <task>` 并证明现有入口仍工作。

## 13. 测试规范

- 测试 MUST 覆盖用户可观察契约、边界和失败路径，不测试源代码文本或偶然实现细节。
- 纯匹配、解析、索引和视口 helper SHOULD 使用表驱动测试覆盖空值、首尾、溢出和过滤后索引。
- mise parser 测试 MUST 使用代表性真实输出，并包含 malformed/缺字段行为；不得调用网络。
- UI 逻辑 helper 必须验证窄尺寸、末尾夹取、Unicode/截断；显著 UI 改动还必须运行真实 TUI。
- 每个测试必须确定、隔离、快速，不依赖用户全局 mise 状态；需要真实 mise 的验证属于 smoke scenario，不替代单元测试。
- 完成永久修改后 MUST 运行 `bun run lint`。修 bug 时先证明旧行为可复现，再证明修复后不再出现。

## 14. 性能规范

- render 和按键热路径 MUST NOT 启动进程、读取磁盘或执行网络操作。
- 避免每帧重复排序、lowercase、JSON 解析和构建完整中间集合；稳定派生数据应在数据加载/状态更新时计算一次。
- 迭代筛选后选择 MUST 保持同一遍历语义；能用迭代器时不必先构建完整数组。
- MUST 避免无意义对象分配；但为了跨异步边界而进行的小型、明确复制 MAY 接受。
- 命令参数应预估容量；大输出使用一次性转换，不反复拼接。
- 滚动、尺寸和索引使用 O(1) 更新。
- 性能优化前 MUST 指明热路径或测量依据；不得以"优化"为名牺牲正确性和可维护性。

## 15. Git / Commit 规范

- MUST 把工作区现有修改视为用户工作；不得回滚、覆盖、stash 或格式化无关文件。
- 提交范围 MUST 单一且可解释；只包含当前任务相关源码、测试和文档。
- MUST NOT 使用 `git reset --hard`、`git clean`、强制 checkout、强推或其他破坏性 Git 命令。
- 未经用户明确要求 MUST NOT 创建 commit、修改历史、amend、rebase 或 push。
- 用户要求提交时，commit message SHOULD 使用简洁 imperative 形式；可采用 `feat:`、`fix:`、`refactor:`、`test:`、`docs:`、`chore:` 前缀，并准确描述用户可见结果。
- 提交前 MUST 运行 `bun run lint`，检查 staged 文件只包含目标改动，并避免提交构建产物、凭据和本机配置。
- 不得把 unrelated cleanup 混入功能提交；被 clean cutover 明确淘汰的旧代码属于同一提交，应完整删除。

## 完成检查

- 架构边界未被绕过，所有新增状态与页面都被穷尽处理。
- 中英文 UI、快捷键提示、确认路径和失败恢复同步完成。
- mise backend spec、scope、参数数组和 `mise.toml` 既有行为保持不变。
- `bun run lint` 通过。
- UI 改动已在实际 TUI 中运行并观察目标流程。
- Git 仅包含当前任务范围内的改动；没有未经请求的 commit 或历史修改。