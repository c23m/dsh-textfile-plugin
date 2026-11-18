# dsh-textfile-editor

一个小型 DSH 插件：在**右侧栏**里提供一个文本编辑器，由官方文件预览作为入口。第一版刻意做小，
后续再扩展（例如 Markdown 预览）。

## 安装

在 DSH 里让 agent 用 `plugin_manager` 的 `install_bundle` 安装：

- **npm 已发布版**：target 传 `dsh-textfile-editor`（或 `dsh-textfile-editor@0.1.0`）。
- **本地开发版**：target 传本目录的绝对路径（会装成 `link`，改完即热替换）。
- **GitHub 版**：target 传 `github:c23m/dsh-textfile-plugin`。

## 功能

- 注册右侧栏页签类型 `textfile`，**不注册 guide 卡片** —— 它故意不出现在右侧栏的指南页里。
  唯一入口是本插件加在文件预览工具栏上的**纯图标**铅笔按钮（tooltip「用文本编辑器打开」）。
- 页签标题显示**轮廓文件图标 + 当前文件名**（`sidebar.right.pane.tab.title` 座位；图标用轮廓样式，
  以便和预览自带的实心文件类型图标区分）。
- `keepMounted: true` 让缓冲区在切走页签时保持挂载：切到预览页签再切回来，打开的文件不会丢。
  **没有文件可显示**的编辑页签（例如刷新页面后被布局恢复出来的页签，没有待打开路径）会直接关闭
  自己，而不是显示空占位。
- 编辑器主体包含：头部（左侧文件名与未保存圆点，右侧图标按钮组中**最左是设置**，然后是重新加载、
  保存）、文本编辑区、超大文件提示，以及底部栏（行数/字符数、绝对路径、状态）。
- 保存通过 Host 命令 `textfile-save` 完成：它经组合后的文件系统解析路径，并按会话的沙箱策略写入
  （只读会话仍然只读）。文件自身的末尾换行在保存后会保留。

## 渲染默认值

当前渲染是预设行为（以后可以做成配置），默认规则如下：

- **等宽字体** —— 编辑器与装饰层统一使用 `Consolas, "Courier New", monospace`（VS Code 在 Windows
  上的默认栈）。另外用 `@font-face` + `size-adjust: 110%` 包了一层 CJK 字体：中文字形天然 1em，
  而 Consolas 的字符格是 0.55em，所以 1.1em 正好等于两个英文格宽；中英混排能对齐成列。
- **空白可见** —— 空格显示为淡灰圆点（`·`），制表符按其实际占格显示淡灰箭头（`→`）；文件字节不变。
- **行号** —— 右对齐的行号栏，数字左右留白相等。仅当窗口宽于屏幕一半、且面板宽度 ≥ 360px 时，
  才预留至少 4 位数字；窗口或面板较窄时，只预留当前实际需要的位数
  （`RENDER.minGutterDigits`、`narrowWindowRatio`、`roomyEditorPx`）。
- **设置浮层** —— 头部右侧按钮组最左的滑杆按钮，**悬停**即弹出；点击按钮是**开关**（点一下立刻
  收起，并且在鼠标离开按钮/浮层或再次点击之前，悬停不会让它重新弹出）；键盘聚焦也会打开。鼠标
  离开后有 250ms 延迟再收起（`RENDER.settingsCloseDelayMs`），用于跨过按钮到浮层之间的空隙；
  Esc 或点击外部也会关闭。浮层锚定在**编辑器面板右边缘**（内缩 6px），而不是按钮右缘。里面放
  不常改的设置：换行开/关、缩进单位（`空格` / `Tab`）、制表符宽度（2 或 4）、是否显示空白、是否
  显示行号。每一行整体都是开关：点标签或任一取值都会切到另一个值。设置保存在 `localStorage`
  （`dsh.textfile.settings.v1`），对所有文件生效。
- **Tab 输入** —— 浏览器默认会把 Tab 用于移动焦点，因此编辑器拦截 Tab：插入当前缩进单位（选
  `空格` 时，空格数量等于制表符宽度；有选区时对每一行缩进），Shift+Tab 反缩进。只读预览不拦截，
  保留浏览器默认 Tab 行为。
- **自动换行** —— 默认开启；在设置浮层里控制，只影响显示（关闭后长行横向滚动），不改变文件内容。
- **Markdown 高亮** —— 对 `.md` / `.markdown` / `.mdx` 文件，装饰层按 VS Code 默认方案着色：
  标题、链接、列表标记为**蓝色**，行内代码与代码块为**琥珀色**，引用为**绿色**，`**加粗**` 加粗、
  `*斜体*` 倾斜。颜色取自应用内置的静态设计令牌，浅色/深色各有一对
  （`--dsw-static-blue-600` / `-blue-400`、`-amber-600` / `-amber-400`、`-green-900` / `-green-400`，
  在 `body[data-ds-dark-theme]` 下覆盖 —— 和官方 Shiki 样式表同样的做法），所以两套主题下都是
  真实的调色板颜色。标记与其内容共享样式（`#` 与标题同蓝、`**` 与内容同粗）。只做样式：不增删
  字符、不改变字重/间距所影响的前进宽度，所以 textarea 与装饰层的排版完全一致；它依附于同一
  装饰层，超大文件回退时一并跳过。
- **滚动到底留白** —— 滚动范围在最后一行下方保留约编辑器视口三分之一的空白
  （`RENDER.tailSpaceRatio`），滚到底时最后一行不会贴底。

实现方式：真实文本仍在原生 `<textarea>` 里（编辑、选择、输入法、撤销都是原生的），上面叠一个
`<pre>` 装饰层，字体、内边距、换行规则和滚动偏移完全一致，用来绘制标记；textarea 的文字设为透明，
只保留可见光标。装饰层通过 transform 跟随 textarea 滚动，通过 ResizeObserver 跟随内容宽度，保证
两层对齐。两个刻意的限制：

- 页面很大时（超过 4000 行或 30 万字符）跳过装饰层，退回普通等宽 textarea（没有空白标记/行号）。
- 输入法组字期间隐藏装饰层、显示 textarea 自己的文字，避免组字内容不可见。

## 唯一入口：预览工具栏的编辑按钮

官方预览在拿到被预览文件的 Host 绝对路径（`absolutePath`）后，会渲染
`sidebar.right.tab.document.actions` 插槽。本插件在其中注册一个占用者：

- 按钮**只对文本类扩展名显示**（`TEXT_EXTENSIONS`：txt、md、json、yaml、代码文件……）；图片、PDF
  等二进制文件保持官方预览不变。
- 点击时请求编辑器页签（`ctx.sidebarRight.openTab('textfile')`），并在进程内把路径交给编辑器。
  页签按面板去重，所以再点另一个文件时会切到已挂载的编辑器并载入新文件，而不是开第二个页签。
- 会话工作区**之外**的文件也能在这里读取（读不受限），但 `workspace-write` 会话保存时会被沙箱
  拒绝，错误显示在底部栏。

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | Bundle 清单：`dsh.bundle.patch`（Host 行）与 `dsh.client`（浏览器半边） |
| `cordis.patch.yml` | Loader patch：把 `textfile` 插件行插进 profile 组合 |
| `index.js` | Host 半边：注册 `textfile-save` 命令（用到 `commands`、`fs`、`workingDirectory`、`sandboxPolicy`） |
| `client.js` | 浏览器半边：页签类型、页签主体、页签标题座位、预览工具栏的编辑动作 |
| `locale/en.json`、`locale/zh.json` | 插件管理器的标题/描述 |
| `icon.svg` | 插件管理器图标 |

## 开发

以**链接**方式安装到本目录。**浏览器半边**改完由 Client HMR 链热替换（没生效就刷新页面）。
**Host 半边不会热更新**：源码监听是关的（`hmr.root: []`），改动的 host 文件要等下一次 profile
重组才生效 —— 用 `plugin_manager` 的 `set_plugin` 把 `include:textfile` 关掉再打开，或重启应用。
重新加载前先跑 `node --check client.js index.js`。

卸载：`plugin_manager` 的 `remove_bundle`，target `dsh-textfile-editor`。

**UI 文案约定（整个工作区）：** 面板内文案一律中文。插件管理器的元数据单独放在
`locale/en.json` + `locale/zh.json`，随界面语言显示。

## Git 工作流

- 远程：`git@github.com:c23m/dsh-textfile-plugin.git`（SSH），默认分支 `main`。
- 提交前先自检：`node scripts/check.mjs`（清单/资源校验，CI 跑同一个脚本），再
  `node --check index.js` 与 `node --check client.js`。
- 日常流程：

  ```sh
  git add -A
  git commit -m "feat: ..."   # 或 fix:/docs:/chore:
  git push
  ```

- 只影响插件目录本身：它在 profile 里是 `link` 安装，提交/推送不会改动运行中的插件；浏览器半边由
  Client HMR 热替换，Host 半边仍需一次 profile 重组才生效（见上一节）。
- CI：`.github/workflows/ci.yml` 在 push / PR 到 `main` 时跑 `node --check` 与
  `node scripts/check.mjs`。

## 后续想法

- 在同一个页签里加 Markdown 预览和编辑/预览切换。
- 按页签记住换行状态与打开路径（用页签自己的 store），刷新后恢复。
- 把保存操作同时暴露为 Agent 工具，实现文档里说的「一个操作、两个调用方」。
