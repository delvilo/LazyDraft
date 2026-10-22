# LazyDraft

个人工作用的轻量纯文本白板，适合笔记、草稿与 AI Prompt。支持本地自动保存、Tabbypad 归档与离线 PWA。

> [繁體中文](README.md) · [English](README_EN.md) · [简体中文](README_ZH_CN.md)

![LazyDraft Snapshot](img/snapshot.png)

Fork 自 [amitmerchant1990/notepad](https://github.com/amitmerchant1990/notepad)。日常流程：**编辑草稿 → 新增／更新 Tabbypad 项目 → 自动清空并开始下一份草稿**。

## 编辑与工具

- **自动保存**：草稿存于浏览器 `localStorage`，重开仍保留；Tabbypad 使用 IndexedDB。清除网站数据会移除本地内容，重要笔记请另行下载备份。
- **下载与复制**：一键复制全文或下载 `.txt`；文件名取第一行，若第一行为空则使用 `Notes-DD-MM-YYYY.txt`。
- **外观**：浅色／深色／跟随系统，字体、字号、行高、纸张纹理、最佳行宽、拼写检查与 Tab 缩进皆可调整。
- **字数摘要**：右下角显示总字符、中文字数与英文词数，可隐藏。总字符按 Unicode code point 计算（含空格与换行），中文按汉字逐字、英文按字母词段计数；复合 emoji 不一定只计一字。
- **悬浮视窗**：需桌面浏览器支持 Document Picture-in-Picture；以原生外框关闭／返回主页。另提供专注与全屏模式。
- **独立工具**：工具栏可打开 Rich Text Notes、Markdown Editor、Tabbypad 与 AI-RegExr，不取代当前草稿。

### 呒虾米与语音

- 按“蝦”或 `Ctrl/Cmd+B` 开关呒虾米。字母字根仅限小写，保留 `, . ' [ ]`；大写直接输出并取消待选字根，不切换模式。最多 4 码；空格或 Enter 发送当页第一字，`0–9` 选字（0 为第一字），上／下或 PageUp／PageDown 翻页，Backspace 修正、Esc 取消。
- 无候选或输入错误时保留组字并提示；待提交字根不进入正文或自动保存。有字根时第一次 `Ctrl/Cmd+Z` 仅取消组字，其余撤销／重做由浏览器处理，不保证每次选字独立一步。
- 词典首次启用时解析，载入失败可重试。完成主页离线缓存后，首次启用亦可离线使用。验收范围为**桌面 Chrome／Edge＋实体键盘**，不保证手机软键盘或其他浏览器兼容。
- 启用后每次从中文模式开始，不记忆中英模式。textarea 有焦点时，纯 `Ctrl+Alt`（macOS `Control+Option`）放开一键切换一次；第三键、AltGr 或失去焦点则取消。切英文会取消待选字根，所有输入走原生；切换时提示模式，悬浮视窗亦适用。系统可能拦截快捷键，例如 VoiceOver。
- 中文模式（含载入与开页恢复）关闭原生拼写检查与自动校正，Spellcheck 锁定并附原因。英文模式恢复拼写偏好及可调整开关，设置英文语言提示与 `autocorrect=on`；停用、取消或载入失败恢复原设置。模式切换不改写拼写偏好，实际检查与校正依浏览器／系统能力；重设偏好恢复默认值。
- 麦克风或 `Ctrl/Cmd+M` 切换语音转文字，文字插入光标处。使用 Web Speech API；语言可跟随浏览器或于偏好设置选择。可用性依浏览器与语音服务而定，不保证离线。
- 载入时仅创建辨识对象，不启动录音或询问权限；API 不存在或构造失败时，隐藏麦克风、语言设置与语音快捷键说明，且不拦截 `Ctrl/Cmd+M`。成功创建不保证服务可用；使用时的权限／服务错误会提示，保留入口供重试。

### Tabbypad 与 Google 同步

- **Tabbypad**：可载入既有项目编辑，或存为新项目。新增与手动“更新原项目”（含右下角按钮）成功后，若草稿与关联未变更，会清空并解除关联、关闭管理视窗，焦点回到纯文本编辑器；刷新仍维持空白。
- **保存保护**：保存失败、取消、冲突未解决或等待期间草稿／关联改变，都不清空当前内容。若已存入 Tabbypad，但无法保存空白本地草稿，会提示“已保存，但未清空”，保留内容与关联供处理。
- **备份与载入**：载入另一项目前可另存草稿或丢弃；备份成功才继续载入，不会停在空白画面，备份失败则保留原稿。更新仍检查其他标签页的修改／删除冲突；未归档的本地草稿重开仍保留，但解除项目关联。
- **Google 同步（可选）**：Google 登录后跨设备 Push／Pull；后端以账号 `sub` 标识，Redis 暂存 **48 小时**。Push 上传当前草稿；空白草稿须确认才清空云端。Pull 遇到不同原稿时可覆盖、追加或先备份至 Tabbypad。
- **隐私**：常规编辑与本地开档不会自动上传；手动 Push 会上传全文，包含可能存在的密码与密钥。同步需要 PHP／Redis 后端，不是纯静态部署功能。

## 预览与语法高亮

**MD（眼睛）／HTML（视窗）**切换只读预览，再次点击或按“返回纯文本”继续编辑。两种预览与纯文本模式互斥，切换保留原文、光标与滚动位置；重开回到纯文本。下载、复制、归档与 Push 都使用原文。

- **Markdown**：支持常规 Markdown／GFM、表格、代码与只读任务列表；不含数学公式、Mermaid 或预览内代码高亮。内嵌 HTML 显示原文，生成的 HTML 经安全过滤；外部 HTTP(S) 链接另开隔离标签页，危险协议不提供链接。
- **HTML**：沙盒呈现 HTML＋CSS，禁止脚本、事件处理、表单、弹窗与跳转；链接不可导航，外观依原 HTML，不强制深色。只允许完整 HTTPS 图片、样式表与字体。
- **远程资源**：Markdown 仅自动载入完整 HTTPS 图片。两种预览的远程资源都可能泄露 IP／请求时间，离线不保证可用；相对路径与非 HTTPS 资源不载入。
- **Syntax（魔棒）**：8 个选项为 HTML、PHP、JavaScript、TypeScript、Python、JSON、Bash、YAML。HTML 包含内嵌 CSS／JS，纯 CSS 也选 HTML。只改色彩，不改原文与原生编辑；上限 **1 MiB**，超限保留纯文本、不截断。
- 支持的本地文件会自动选取语言，但不强制启用 Syntax。记住语言，重开仍默认关闭。预览与高亮所需资源已纳入主页离线缓存。

## 载入本地文件

文件夹按钮一次读取一个文件，仅载入原文、不执行代码。每文件最大 **1 MiB（1,048,576 bytes）**，须为有效 **UTF-8**（可含 BOM，载入时移除；换行统一为 LF）。

- 支持文本、Markdown、HTML／CSS、常见代码、JSON／CSV／日志、YAML／INI、Shell 等格式；另支持 `.env`、`.env.*`、`.gitignore`、`.editorconfig`、`Dockerfile`、`Makefile`。仅接受支持清单内的名称，并非任意扩展名；匹配不区分大小写。
- 文件选择窗口不筛选扩展名，但选取后仍验证格式；点开头文件可能需开启系统的隐藏文件显示。
- 遇到不同草稿（含载入空文件）可**覆盖、追加、备份至 Tabbypad 后载入或取消**。追加保留项目关联，不自动更新卡片；覆盖／备份后载入会解除关联。
- 备份及本地保存成功后才替换内容；格式／解码错误、超限、配额不足或确认期间草稿／关联改变，皆保留原稿。已成功创建的备份仍保留。
- 完成主页缓存后可离线开档。载入内容会保存为本地草稿；含凭证的文件不应随意 Push 到云端。

## AI-RegExr

打开 [AI-RegExr](ai-regexr/) 测试 JavaScript RegExp 或 **PCRE2 10.49（WASM）**。可打开有效 UTF-8 本地文本文件（不限制扩展名），上限 **10 MiB**，覆盖既有文本前须确认。测试文本与模式不持久化、不上传；PCRE2 不等同 PHP `preg_*`。

- 匹配在 Worker 执行，设定 **3 秒**期限；后台标签页计时器可能延后。超时终止任务、不显示部分结果，下次可重试；引擎载入期限另为 15 秒。最多标示前 **10,000** 条。
- 纸飞机发送完整匹配（非捕获分组），换行分隔至一个同源主页。超过 10,000 条须确认，只传前 10,000 条；文字超过 **1 MiB** 不发送。PCRE2 字节匹配跨入字符内部时，显示与发送涵盖完整字符。
- 主页已有草稿时可覆盖、追加或先备份；取消、备份／保存失败或确认期间草稿改变均不覆盖。未开主页时，确认后开页并复制，需自行粘贴；导入主页后才依草稿机制保存。
- **独立离线缓存**：须先打开本工具，等待“离线可用”后再断网；安装主记事本不会预载它。更新经 SHA-256 验证，失败保留旧版，不强制接管既有标签页。

## 快捷键

| 功能 | Windows／Linux | macOS |
| :--- | :--- | :--- |
| 下载 `.txt` | Ctrl+S | Cmd+S |
| 呒虾米 | Ctrl+B | Cmd+B |
| 语音转文字 | Ctrl+M | Cmd+M |
| 复制全文 | Alt+C | Option+C |
| 偏好设置 | Ctrl+, | Cmd+, |
| 快捷键清单 | Ctrl+K | Cmd+K |
| 专注模式 | Alt+F | Option+F |
| 清空笔记 | Ctrl+Shift+Del | Cmd+Shift+Backspace |

## 本地启动与开发

主应用与 AI-RegExr 无需构建，于项目根目录执行后打开 `http://localhost:8000`：

```sh
python3 -m http.server 8000
```

开发工具需要 Node.js；常规静态部署不需安装：

```sh
npm ci --ignore-scripts
npm test                        # 单元测试
npm run typecheck               # DOM／Worker 严格类型检查
npx playwright install chrome msedge
npm run test:ime:browser         # 真实 Chrome／Edge IME 验收
npm run vendor                  # 验证 PCRE2 产物与源码哈希
npm run release                 # 重建 AI-RegExr manifest／Service Worker
```

浏览器测试可加 `-- --project=chrome` 或 `-- --project=msedge`，或以 `IME_CHROME_PATH`／`IME_EDGE_PATH` 指定可执行文件；缺少浏览器会失败。

仅在修改原生接口或升级引擎时重建 PCRE2，需 Git、CMake、Emscripten **6.0.13**（`emcc` 可放 PATH）：

```sh
EMSDK=/path/to/emsdk npm run vendor -- --build
npm run vendor
npm run release
```

## 部署与维护

- 完整部署静态目录至 HTTP／HTTPS；离线功能须 HTTPS 或 localhost 并完成首次缓存。Google 同步另需 PHP／Redis。Nginx／Tengine 使用 HTTP/2 时保留 `keepalive_timeout 60s;`，勿设为 `0`。
- 主页 `sw.js` 缓存为 `v87`；变更资源时同步更新对应 URL 与缓存清单。完整部署 `js/ime/v87/`，不要混用模块版本。AI-RegExr 有独立 Service Worker，主页不拦截其请求；资源变更后执行 `npm run release`，重新载入旧页面。
- PCRE2 固定源码与哈希见 `vendor-manifest.json`，授权见 [PCRE2 LICENCE](ai-regexr/vendor/pcre2/LICENCE.md)；请通过构建流程重建，不手改生成的胶水代码。
- 图标源码为 `img/lazydraft-icon.svg`；安装开发工具与 Chrome 后执行 `node scripts/build-icons.mjs`。变更共享图标后也须执行 `npm run release`。
- 保留既有 PWA 身份、存储键与数据库名称。安装入口与提示由浏览器管理，页面不提供自定义安装按钮。更新不需卸载或清除网站数据；桌面快捷方式名称／图标更新由浏览器与系统管理。

## 授权

[MIT License](LICENSE.txt)
