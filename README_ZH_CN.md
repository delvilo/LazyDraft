# LazyDraft

LazyDraft 是具备完整离线能力的轻量纯文本记事本（PWA），底层通过 [Service Worker API](https://developer.mozilla.org/zh-CN/docs/Web/API/Service_Worker_API) 与 [Web Storage API](https://developer.mozilla.org/zh-CN/docs/Web/API/Window/localStorage) 实现数据持久化与秒开体验。

> [繁體中文](README.md) · [English](README_EN.md) · [简体中文](README_ZH_CN.md)

![LazyDraft Snapshot](img/snapshot.png)

本项目 fork 自 [amitmerchant1990/notepad](https://github.com/amitmerchant1990/notepad)。经由移除冗余功能、补足实用工具并全面扁平化界面呈现后，定位为**个人工作时的轻量纯文本白板**。在日常编辑笔记或向 AI Agent 撰写 Prompt 指令时，能通过干净无干扰的版面与清晰大字体，在笔记本电脑上获得更舒适流畅的输入体验。

**日常核心工作流**：
1. 以中央编辑器作为主力输入区。
2. 将不同项目或任务内容直接存入各自的 **Tabbypad 项目** 妥善归档。
3. 需要切换工作任务时，随时从 Tabbypad 取出对应项目载入编辑与更新，其余工具则作为即时辅助。

---

## 主要特色与功能

- **纯文本即时自动保存**：输入内容会自动保存在本地浏览器（`localStorage`），关闭或重开标签页数据不丢失。
- **内置呒虾米输入法（Web IME）**：
  - 免在操作系统安装任何输入法，直接在编辑器内以呒虾米字根打中文。
  - 工具栏提供“**虾**”按钮，亦可使用快捷键 <kbd>Ctrl</kbd> / <kbd>⌘ Cmd</kbd> + <kbd>B</kbd> 随时切换。
  - 支持浮动候选字列；空格键或 Enter 发送当前候选页第一字（不附加换行），数字键 `0` ~ `9` 选字（`0` 为第一字、`1` 为第二字）。上／下与 PageUp／PageDown 翻页，在页面边界仍拦截；未组字时 Enter 正常换行。
  - 码长上限由词典推导，目前为 **4 码**；超码键会被拦截并在候选列提示，原组字保留，不会把英文字根插入正文。
  - 查无候选字时按空格或 Enter、或按下不存在的候选编号，都会保留组字并提示；以 Backspace 修正或 Esc 取消，不自动清空或猜字。`, . ' [ ]` 仍依词典当作字根。
  - 左／右、Home／End、Delete、Tab、鼠标移动光标或改变选区时取消组字，原生编辑照常执行；失焦、粘贴、载入其他内容或停用也会取消。字根不进入正文或自动保存。
  - 有未提交字根时，第一次 Ctrl/Cmd+Z 只取消组字；没有字根时由浏览器处理原生 Undo／Redo，不保证每次选字独立一步。原生文字提交失败会保留字根、候选与错误提示，不采用会失去 Undo 保证的后备写入。系统输入法组字期间不拦截其按键。
  - **随选词典与离线**：小型 ES 模块控制器随主页初始化；22,778 笔对照的 JSON 词典只在首次启用时读取与解析，既有候选顺序不变。关闭后保留词典供再次启用重用；载入失败可点击重试，载入中可取消启用，期间输入维持一般文字行为。此前启用的偏好会在打开页面时恢复。
  - 主记事本 Service Worker 会预下载模块与词典供离线使用，但预下载不会在页面执行或解析词典。首次完整安装缓存后，即使此前从未启用 IME，亦能断网启用。
  - 正式验收范围为 **桌面 Chrome／Edge＋实体键盘**，包含悬浮视窗内输入与返回主页；不宣称手机软键盘或其他浏览器兼容。
- **语音自动转文字（Voice Dictation）**：
  - 工具栏提供麦克风按钮，支持快捷键 <kbd>Ctrl</kbd> / <kbd>⌘ Cmd</kbd> + <kbd>M</kbd> 切换。
  - 采用原生 Web Speech API，点击后呈现红色波纹动画，口述内容即时插入至当前光标处。
  - 支持自动跟随浏览器系统语言，或于首选项中自定义默认语种（繁中台/港、英、日、简中）。
- **一键下载纯文本文件（.txt）**：
  - 点击工具栏下载按钮即可一键导出 `.txt`，无需经过多层菜单。
  - 文件名优先取用**笔记第一行文字**（自动过滤首尾空格）；若第一行为空，则自动使用日期格式 `Notes-DD-MM-YYYY.txt`。
- **打开本地文本文件**：左上角下载按钮旁的文件夹图标可载入文本、代码与配置文件；支持格式与草稿保护规则见下节。
- **Markdown 只读预览**：左上角“MD”图标按钮可在原文与排版预览间切换；支持常规 Markdown 与 GFM，原文不会被改写。
- **HTML 只读预览**：左上角“HTML”图标按钮可在原文与沙盒 HTML/CSS 预览间切换；纯文本／MD／HTML 模式互斥，源代码不被改写。
- **代码语法高亮（Syntax Highlighting）**：工具栏提供“Syntax”魔棒开关与 8 种语言下拉菜单（HTML、PHP、JavaScript、TypeScript、Python、JSON、Bash、YAML）；HTML 原生支持内嵌 CSS 与 JavaScript，且单独 CSS 文件直接使用 HTML 高亮。通过背景同步色彩层在编辑时即时高亮，原文、撤销与输入法完全保留。语言菜单在启用高亮时自动展开，未启用时折叠隐藏。
- **Tabbypad 项目双向整合**：
  - 点击左上角 Tabbypad 图标打开项目管理对话框，即时列出既有卡片与创建时间。
  - **存为新项目**：将当前主编辑区内容存成新的 Tabbypad 卡片项目（写入共享 IndexedDB `NotesDB`）。
  - **载入既有项目**：点击任一项目即可载入主编辑区进行编辑；若编辑区有未保存内容，会主动提示“另存新项目后载入”或“丢弃并载入”，保障原稿不被直接覆盖。
  - **手动更新原项目**：载入项目后右下角出现状态胶囊，修改内容后胶囊标示“(未更新)”，点击“更新原项目”即可写回原项目（保留原始颜色与创建时间）。
  - **防止多任务覆盖冲突**：若项目在其他标签页被修改或删除，更新时会自动阻挡覆盖并提示另存或重新载入。
  - **安全重载机制**：刷新或重开标签页时，完整保留编辑器当前草稿，自动解除项目链接，防止后续无意间误覆盖原项目。
  - 对话框内亦提供“打开 Tabbypad 页面 ↗”按钮，可随时另开标签页查看完整看板。
- **左上角独立工具快捷栏**：
  - 工具栏整合 **Rich Text Notes**、**Markdown Editor**、**Tabbypad**、**AI-RegExr** 等实用小工具。
  - 点击直接于新视窗（`_blank`）打开或打开专属操作面板，不影响当前记事本工作区。
  - 在浅色模式与深色模式下均保持白色高对比与悬停发光效果。
- **AI-RegExr 正则表达式测试工具**：
  - 专为大文本（支持上限 10 MiB）设计的纯前端、无服务器 Regular Expression 测试工具，支持 **JavaScript (RegExp)** 与 **PCRE2 (WebAssembly)** 两大引擎。
  - **打开本地文档**：导航栏提供“打开文件”按钮，支持直接载入最大 10 MiB 的本地纯文本、日志或数据文件；原有文本覆盖前提供保护确认。
  - **PCRE2 兼容性**：固定使用 PCRE2 `10.49`，由自有小型 C 接口返回计数与位置，不建立捕获字符串或 JSON；不等同 PHP `preg_*`。支持 `g`、`i`、`m`、`s`、`x`、`u`。未启用 `u` 时保留 PCRE2 字节语义；落在 UTF-8 字符内部的匹配会涵盖该字符标示并合并重叠范围，但总数仍为原始匹配数。PCRE2 拒绝孤立 surrogate，JavaScript 保留原生 RegExp 行为。
  - **超时与完整结果**：引擎就绪后，由主线程设定 3 秒匹配期限并终止超时 Worker，不显示部分计数或过期标示；下一次测试可直接恢复。后台标签页的计时器可能被浏览器延后，不保证精准于第 3 秒停止。完整结果最多标示前 10,000 条；修改输入即取消旧工作，停止输入 300ms 后重算。
  - **发送至主页**：点击纸飞机按钮，将完整匹配项（不含捕获分组）以换行分隔发送至同源主记事本。超过 10,000 条须确认，只传前 10,000 条；合并文字超过 1 MiB 则取消发送。PCRE2 字节边界落在字符内时，发送涵盖的完整字符。
  - **草稿保护**：空白主页直接载入；已有内容时选择覆盖、追加或先备份至 Tabbypad。取消、备份失败、存储配额不足或确认期间草稿变更，均不取代原草稿。使用 BroadcastChannel 与同源 opener 通讯，先选定一个主页再送数据，避免多标签页重复导入；“已接收”不代表已确认写入。
  - **未打开主页时**：确认后打开主页并复制匹配文字，请自行粘贴；剪贴板权限不足或新标签页被拦截会显示提示。工具本身不存储测试文本，但主页确认载入后会依原有机制作存为本地草稿。
  - **独立离线安装**：直接访问 `ai-regexr/`，待显示“离线可用”后才能断网使用；安装主记事本不会预载本工具。引擎载入另设 15 秒期限。工具资源以 SHA-256 验证后安装；失败保留旧版，不强制接管既有标签页。
  - **完全隐私零上传**：无后端服务器、无任何文字或模式上传、不使用持久化缓存记录测试文本，所有运算完全在用户本地浏览器内完成。
- **Google 跨设备数据同步（Redis）**：
  - 点击左上角云端同步按钮，使用 Google 账号登录后即可在不同设备的 Chrome 浏览器间暂存与传输文本。
  - 采用 Google 账号永久 `sub` 标识符作为 Redis Key，数据于本地 Redis 中暂存 48 小时。
  - **发送到云端 (Push)**：将当前编辑区内容送上云端；若编辑区为空则确认后清空云端暂存。
  - **从云端取出 (Pull)**：将云端内容拉回；若本地已有不同内容，弹窗提供“覆盖 (Overwrite)”、“追加至末尾 (Append)”或“先备份至 Tabbypad 并载入”。
- **独立悬浮画中画视窗（Floating Window / PiP）**：
  - 支持桌面端 [Document Picture-in-Picture API](https://developer.mozilla.org/zh-CN/docs/Web/API/Document_Picture-in-Picture_API)，可将记事本置顶悬浮于所有视窗与应用程序之上。
  - 浮动视窗内部为 100% 纯净编辑画面，通过系统原生外框关闭或返回即可无缝接回主标签页。
- **完整离线能力（PWA）**：支持安装至手机主屏幕或桌面端应用，离线状态下所有编辑、Tabbypad 笔记、呒虾米输入法功能皆能完整运行。
- **个性化外观与排版**：
  - 深色模式（Dark mode）、浅色模式（Light mode）、跟随系统（Device）。
  - 支持多种字体（Default、Serif、Monospaced、Dyslexic、Pixel 等）与自定义字号、行高。
  - 支持多种纸张材质背景纹理（Normal、Dotted、Graph、Marble 等）。
  - 支持最佳阅读行宽排版（Optimal line length）。
  - 支持拼写检查开关、Tab 缩进。
- **右下角统计概要**：显示“共 N 字符 · 中文 N 字 · 英文 N 词”，可在偏好设置中显示／隐藏；不提供完整 Statistics 窗口。
  - 总字符按 Unicode code point 计算，包含空格、Tab、换行、标点、数字与 emoji；单个 `😀` 计 1，复合 emoji 或附加符号可能包含多个 code point。
  - 中文按汉字逐字计数（含扩展汉字与 `〇`），不计中文标点、不做分词。英文以连续 `A–Z`／`a–z` 计词，保留词内撇号（`'`、`’`）与连字符（`-`、`‐`、`‑`）；纯数字不计词，数字或其他标点会分隔英文字母段。
  - 统计当前纯文本原稿，不统计 Markdown／HTML 预览渲染结果；输入约 500ms 后更新，载入或清空后同步更新。呒虾米待提交字根不计入；悬浮视窗内也会更新，Tabbypad 链接状态另列于摘要上方。

## Markdown 只读预览

点击本地开档按钮旁的 **MD** 图标，将当前原文切换成同位置的只读预览；再次点击或预览上方的“返回纯文本”即可继续编辑。切换不会改写原文，会还原 textarea 的光标、选区与滚动位置。刷新或重开页面时一律回到纯文本模式，不记住预览开关。

- **格式**：标题、粗体／斜体、删除线、引用、列表、分隔线、链接、行内／块级代码、GFM 表格与只读任务列表。不包含数学公式、Mermaid 或额外代码语法高亮。
- **安全**：内嵌 HTML 显示标签原文，不执行、不套用其样式；Markdown 产生的 HTML 另经安全过滤净化。HTTP／HTTPS 外部链接另开标签页并隔离来源视窗，危险协议不产生可点击链接。
- **图片**：自动载入完整 HTTPS 图片地址。HTTP、相对路径、`//` 开头、`data:`、`blob:`、`file:` 等图片只显示说明与网址。远程来源可能获取 IP 与载入时间；离线时图片不保证可用。
- **原文操作**：下载、复制、Tabbypad 保存与 Google Push 仍使用 Markdown 原文，不保存预览 HTML。
- **内容变更**：成功打开本地文件、载入／重载 Tabbypad、Google Pull、清空或接收语音输入后，自动回到纯文本模式。取消或失败时保留预览与原稿。
- **界面**：跟随浅色／深色模式，代码块与宽表格可水平滚动。全屏、专注模式及浮动视窗均保留预览；预览内的“返回纯文本”不依赖主工具栏。
- **随选动态载入**：首次点击“MD”按钮时才动态载入 Marked 与 DOMPurify，降低首页初次加载开销；Service Worker 同步预载入缓存，即使在离线状态下首次点击亦可顺畅载入。

## HTML 只读预览

点击工具栏“MD”旁的 **HTML** 图标按钮，将当前编辑区切换成沙盒隔离的只读 HTML+CSS 预览画面；再次点击或预览上方的“返回纯文本”即可回到纯文本编辑。切换不改写原文，完整保留光标位置与滚动高度。纯文本、Markdown 预览与 HTML 预览三者互斥。

- **安全沙盒**：以隔离的沙盒 iframe 呈现，禁止 JavaScript 执行（移除事件属性与脚本标签），禁止表单提交、弹窗与自动跳转。
- **外部资源**：仅允许完整 HTTPS 地址的图片、外部样式表（`<link rel="stylesheet">`）与字体；拦截 HTTP、相对路径与危险协议资源。
- **超链接**：保留原有排版与文字，但点击不触发跳转，避免离开记事本。
- **外观**：以原始 HTML 设置为准（未指定时默认白底深色文字），不强制覆盖为深色模式，维持网页原本设计。
- **随选动态载入**：首次点击“HTML”按钮时才动态载入 DOMPurify 与预览控制器，Service Worker 预缓存支持离线首次使用。

## 代码语法高亮（Syntax Highlighting）

工具栏提供 **Syntax** 魔棒开关与语言下拉菜单，支持 **8 种主流语言选项**：HTML、PHP、JavaScript、TypeScript、Python、JSON、Bash、YAML。其中 HTML 语法高亮已完整支持内嵌 `<style>`（CSS）与 `<script>`（JavaScript），单独的 CSS 文件亦直接使用 HTML 进行专属着色。

- **即时同步色彩**：采用背景色彩层与原生 textarea 像素级同步，仅改变文字色彩，不影响字宽、不改变行高。原生编辑、撤销/重做（Undo/Redo）、呒虾米输入法及语音输入完全不受影响。
- **支持上限**：支持最大 1 MiB 源码即时高亮；超过上限自动保持纯文本编辑并提示说明，绝不改写或截断原文。
- **开档自动联动**：打开本地文件时，若为支持的扩展名会自动选取对应语言（但不自动强制开启 Syntax；若已开启则自动依新语言着色）。
- **离线 Web Worker**：语法解析于后台 Worker 中执行，避免编辑卡顿；Prism.js 完整离线预缓存，完全无网络时亦可流畅着色。
- **重开行为**：记住最后选择的语言，但每次打开页面时 Syntax 默认保持关闭，维持记事本最轻量化启动。

## 本地文件载入

点击左上角“打开本地文本文件”文件夹按钮，一次选取一个文件。文件由浏览器直接读取，不上传服务器；HTML、SVG、Markdown 与代码只显示原文，不执行、不渲染。

| 类别 | 支持的扩展名／文件名 |
| :--- | :--- |
| 基本文本与指定代码 | `.txt`、`.html`、`.md`、`.js`、`.php`、`.py`、`.css` |
| 网页与前端 | `.htm`、`.markdown`、`.mjs`、`.cjs`、`.jsx`、`.ts`、`.tsx`、`.vue`、`.svelte`、`.scss`、`.sass`、`.less`、`.svg`、`.xml` |
| 数据与记录 | `.json`、`.jsonc`、`.jsonl`、`.csv`、`.tsv`、`.log`、`.sql` |
| 配置与文档 | `.yaml`、`.yml`、`.toml`、`.ini`、`.cfg`、`.conf`、`.rst`、`.adoc` |
| Shell 与命令脚本 | `.sh`、`.bash`、`.zsh`、`.fish`、`.ps1`、`.bat`、`.cmd` |
| 其他编程语言 | `.rb`、`.pl`、`.lua`、`.r`、`.go`、`.rs`、`.c`、`.h`、`.cpp`、`.hpp`、`.cs`、`.java`、`.kt`、`.swift`、`.dart` |
| 特殊文件名 | `.env`、`.env.*`（例如 `.env.local`）、`.gitignore`、`.editorconfig`、`Dockerfile`、`Makefile` |

- **限制**：只接受上述清单，文件名匹配不区分大小写；每文件最大 **1 MiB（1,048,576 bytes）**，仅支持有效 UTF-8（含 UTF-8 BOM）。载入时移除 BOM，换行依 textarea 惯例统一为 LF。不支持的格式、超限或解码失败皆不变更原稿。
- **文件选择窗口**：为了显示 `Dockerfile` 与点开头的配置文件，不使用扩展名筛选；选取后仍会验证格式。若系统隐藏点开头的文件，请开启文件选择窗口的隐藏文件显示功能。
- **已有不同内容时**：对话框提供“覆盖当前内容”、“追加于末尾”（以两个换行分隔）、“备份至 Tabbypad 后载入”与“取消”。空文件也适用此保护；相同内容不重复询问。
- **Tabbypad**：备份必须成功写入 IndexedDB 才载入文件。覆盖或备份后载入会解除原项目关联；追加则保留关联，重新计算“未更新”状态，不会自动更新原卡片。
- **保存与冲突保护**：新内容必须先成功存入 `localStorage` 才替换编辑区，载入后更新字数统计。若确认或备份期间草稿／项目关联改变，会停止载入并保留当前内容；已创建的备份仍保留。存储配额不足时不载入。
- **离线与隐私**：完成一次在线缓存后可离线开档。载入内容会保存成本地草稿；`.env` 或代码可能包含密码与私钥，之后若手动执行 Google Sync Push，也会上传当前草稿。

---

## 常用键盘快捷键

| 快捷键（Windows / Linux） | 快捷键（macOS） | 功能说明 |
| :--- | :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>S</kbd> | <kbd>⌘ Cmd</kbd> + <kbd>S</kbd> | 保存/下载笔记为纯文本文件（.txt） |
| <kbd>Ctrl</kbd> + <kbd>B</kbd> | <kbd>⌘ Cmd</kbd> + <kbd>B</kbd> | 切换**呒虾米输入法**开关 |
| <kbd>Ctrl</kbd> + <kbd>M</kbd> | <kbd>⌘ Cmd</kbd> + <kbd>M</kbd> | 切换**语音听写录音**开关 |
| <kbd>Alt</kbd> + <kbd>C</kbd> | <kbd>⌥ Option</kbd> + <kbd>C</kbd> | 一键复制整篇笔记到剪贴板 |
| <kbd>Ctrl</kbd> + <kbd>,</kbd> | <kbd>⌘ Cmd</kbd> + <kbd>,</kbd> | 打开偏好设置（Preferences） |
| <kbd>Ctrl</kbd> + <kbd>K</kbd> | <kbd>⌘ Cmd</kbd> + <kbd>K</kbd> | 打开键盘快捷键清单 |
| <kbd>Alt</kbd> + <kbd>F</kbd> | <kbd>⌥ Option</kbd> + <kbd>F</kbd> | 切换专注模式（Focus Mode） |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Del</kbd> | <kbd>⌘ Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Backspace</kbd> | 清空当前笔记 |

---

## 本地运行

本项目为纯静态结构，无需构建步骤，使用任何本地简易服务器即可直接打开：

```sh
python3 -m http.server 8000
```

浏览器打开 `http://localhost:8000` 即可使用。初次联网载入后，主应用与 AI-RegExr 分别由各自的 Service Worker 建立独立离线缓存。

### 开发与工具命令（需要 Node.js）

项目根目录提供标准化开发工具命令：

```sh
# 安装锁定版本的开发工具（常规静态部署不需要运行）
npm ci --ignore-scripts

# 运行 Node 单元测试（包含呒虾米输入核心与正则引擎）
npm test

# 运行 TypeScript 严格类型检查（区分 DOM 与 WebWorker 环境）
npm run typecheck

# 安装真实 Chrome／Edge（需要相应系统安装权限），运行限定 IME 的浏览器验收测试
npx playwright install chrome msedge
npm run test:ime:browser
# 可分别使用 -- --project=chrome 或 -- --project=msedge；
# 自定义真实浏览器路径使用 IME_CHROME_PATH / IME_EDGE_PATH，缺少浏览器会直接报错，不会静默跳过。

# 重新生成 AI-RegExr 静态离线 Manifest 与 Service Worker
npm run release

# 验证已提交的 PCRE2 产物与 C 接口源码哈希
npm run vendor

# 仅在修改 native 接口或升级引擎时重建：
# 需要 Git、CMake 与固定版本 Emscripten 6.0.13；也可把 emcc 放在 PATH
EMSDK=/path/to/emsdk npm run vendor -- --build
npm run vendor
npm run release
```

---

## 部署与缓存注意事项

1. **完整静态目录部署**：AI-RegExr 运行时只需要静态 HTTP/HTTPS 服务，不需要 Node.js、PHP 或正则表达式后端。请保留完整项目资源目录结构。主记事本既有的可选 Google 同步仍依赖原本的 PHP/Redis 辅助服务，保持兼容不变。
2. **Nginx / Tengine 连接设置**：若启用 HTTP/2，务必保留 `keepalive_timeout 60s;`（切勿设为 `0`），避免浏览器并行下载静态资产时连接被重置（`ERR_CONNECTION_RESET`）。
3. **Service Worker 缓存版本与独立作用域**：
   - 主记事本 `sw.js` 缓存版本为 `v82`，常规资源引用同步为 `?v=82`。未变更的 IME 完整模块与词典仍位于物理版本路径 `js/ime/v76/`，避免原生相对 import 混版并维持 strict 类型解析。发布时必须连同完整版本目录与缓存清单一同部署；旧页面请重新刷新。
   - 主记事本 `sw.js` 已排除 `ai-regexr/` 的预先缓存，并在 Fetch 拦截器中直接忽略 `ai-regexr/` 请求。
   - `ai-regexr/` 拥有专属的独立 Service Worker（`ai-regexr/sw.js`），由 `npm run release` 确定性自动生成版本缓存，不使用 `skipWaiting` 强制接管，确保已打开的标签页与后台 Worker 模块版本一致。
4. **依赖库与重建**：主记事本的固定版本 Marked、DOMPurify、Prism.js 保持不变。AI-RegExr 的 PCRE2 源码锁定至 `pcre2-10.49`／commit `6f9d7c1373262c541324a16a358785b33ef116cf`；`scripts/vendor-regexr.mjs --build` 会检查编译器版本与源码 commit，使用全新临时目录构建 `scripts/pcre2_shim.c`，不修改生成的胶水脚本。授权位于 `ai-regexr/vendor/pcre2/LICENCE.md`，产物与源码哈希记录于 `vendor-manifest.json`。IME 的 `core.js`、`textarea-controller.js`、`candidate-view.js` 与生命周期入口 `boshiamy.js` 纳入 strict JSDoc 检查；ES module package 范围限于 IME、AI-RegExr 与测试，主记事本其余脚本维持原有载入方式。
5. **LazyDraft 更名与既有数据保持**：
   - 仅更新主品牌、共享返回入口及私有 npm 软件包名称 `lazydraft`；站点仍为 `note.lazyai.day`，GitHub repo 为 `delvilo/LazyDraft`。Tabbypad、AI-RegExr、Markdown Editor 等子工具维持原名；上游作者、授权与来源链接不变。
   - 保留 `index.html` PWA 入口与既有安装身份，不新增或改动 manifest `id`／scope。草稿、偏好、Google 登录存储键、Redis key 规则、`NotesDB`、历史 `NotepadSnapshotsDB` 迁移来源、`notepad_bus` 及 `notepad:` 缓存前缀均不因品牌更名而改名；请勿清除网站数据来更新品牌。
   - LD 字母图标采用青绿底、白色矢量字形，不依赖任何第三方字体。可编辑源码为 `img/lazydraft-icon.svg`；安装开发依赖与 Chrome 后运行 `node scripts/build-icons.mjs` 重建 PNG、16／32／48px favicon 与 Safari 单色 mask。可用 `IME_CHROME_PATH` 指定 Chrome；PNG 包含 192／512px maskable 尺寸，Apple touch icon 为 180px。
   - 图标 URL 保持原有路径（包含历史文件名 `img/notepad-apple-icon.png`），内部内容已更新为 LD；主页完整预缓存新图标。PWA 安装展示的五张截图均取自新版实际画面。更换共享图标或 AI-RegExr 品牌入口后，须运行 `npm run release` 重建其资源哈希。
   - 既有桌面／主屏幕快捷方式的名称与图标更新由浏览器及操作系统管理，不保证刷新一次立即生效；更名不需要卸载应用，也绝不清除任何现有笔记或设置。

---

## 授权条款

MIT License
