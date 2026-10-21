# LazyDraft

LazyDraft 是具備完整離線能力的輕量純文字記事本（PWA），底層透過 [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) 與 [Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) 實現資料持久化與秒開體驗。

> [繁體中文](README.md) · [English](README_EN.md) · [简体中文](README_ZH_CN.md)

![LazyDraft Snapshot](img/snapshot.png)

本專案 fork 自 [amitmerchant1990/notepad](https://github.com/amitmerchant1990/notepad)。經由移除冗餘功能、補足實用工具並全面扁平化介面呈現後，定位為**個人工作時的輕量純文字白板**。在日常編輯筆記或向 AI Agent 撰寫 Prompt 指令時，能透過乾淨無干擾的版面與清晰大字體，在筆電上獲得更舒適流暢的輸入體驗。

**日常核心工作流**：
1. 以中央編輯器作為主力輸入區。
2. 將不同專案或任務內容直接存入各自的 **Tabbypad 項目** 妥善歸檔。
3. 需要切換工作任務時，隨時從 Tabbypad 取出對應項目載入編輯與更新，其餘工具則作為即時輔助。

---

## 主要特色與功能

- **純文字即時自動儲存**：輸入內容會自動儲存在本地瀏覽器（`localStorage`），關閉或重開分頁資料不遺失。
- **內建嘸蝦米輸入法（Web IME）**：
  - 免在作業系統安裝任何輸入法，直接在編輯器內以嘸蝦米字根打中文。
  - 工具列提供「**蝦**」按鈕，亦可使用快捷鍵 <kbd>Ctrl</kbd> / <kbd>⌘ Cmd</kbd> + <kbd>B</kbd> 隨時切換。
  - 支援浮動候選字列；空白鍵或 Enter 送出目前候選頁第一字（不附加換行），數字鍵 `0` ~ `9` 選字（`0` 為第一字、`1` 為第二字）。上／下與 PageUp／PageDown 翻頁，在頁面邊界仍攔截；未組字時 Enter 正常換行。
  - 碼長上限由字典推導，目前為 **4 碼**；超碼鍵會被攔截並在候選列提示，原組字保留，不會把英文字根插入正文。
  - 查無候選字時按空白或 Enter、或按下不存在的候選編號，都會保留組字並提示；以 Backspace 修正或 Esc 取消，不自動清空或猜字。`, . ' [ ]` 仍依字典當作字根。
  - 左／右、Home／End、Delete、Tab、滑鼠移動游標或改變選取時取消組字，原生編輯照常執行；失焦、貼上、載入其他內容或停用也會取消。字根不進入正文或自動儲存。
  - 有未提交字根時，第一次 Ctrl/Cmd+Z 只取消組字；沒有字根時由瀏覽器處理原生 Undo／Redo，不保證每次選字獨立一步。原生文字提交失敗會保留字根、候選與錯誤提示，不採用會失去 Undo 保證的後備寫入。系統輸入法組字期間不攔截其按鍵。
  - **隨選字典與離線**：小型 ES 模組控制器隨主頁初始化；22,778 筆對照的 JSON 字典只在首次啟用時讀取與解析，既有候選順序不變。關閉後保留字典供再次啟用重用；載入失敗可點擊重試，載入中可取消啟用，期間輸入維持一般文字行為。先前啟用的偏好會在開頁時還原。
  - 主記事本 Service Worker 會預下載模組與字典供離線使用，但預下載不會在頁面執行或解析字典。首次完整安裝快取後，即使先前從未啟用 IME，亦能斷網啟用。
  - 正式驗收範圍為 **桌面 Chrome／Edge＋實體鍵盤**，包含懸浮視窗內輸入與返回主頁；不宣稱手機軟鍵盤或其他瀏覽器相容。
- **語音自動轉文字（Voice Dictation）**：
  - 工具列提供麥克風按鈕，支援快捷鍵 <kbd>Ctrl</kbd> / <kbd>⌘ Cmd</kbd> + <kbd>M</kbd> 切換。
  - 採用原生 Web Speech API，點擊後呈現紅色波紋動畫，口述內容即時插入至當前游標處。
  - 支援自動跟隨瀏覽器系統語系，或於偏好設定中自訂預設語種（繁中台/港、英、日、簡中）。
- **一鍵下載純文字檔（.txt）**：
  - 點擊工具列下載按鈕即可一鍵匯出 `.txt`，無需經過多層選單。
  - 檔名優先取用**筆記第一行文字**（自動過濾首尾空白）；若第一行為空白，則自動使用日期格式 `Notes-DD-MM-YYYY.txt`。
- **開啟本機文字檔**：左上角下載按鈕旁的資料夾圖示可載入文字、程式碼與設定檔；支援格式與草稿保護規則見下節。
- **Markdown 唯讀預覽**：左上角「MD」按鈕可在原文與排版預覽間切換；支援一般 Markdown 與 GFM，原文不會被改寫。
- **HTML 唯讀預覽**：左上角「HTML」按鈕可在原文與沙盒 HTML/CSS 預覽間切換；純文字／MD／HTML 模式互斥，原始碼不被改寫。
- **程式碼語法標亮（Syntax Highlighting）**：工具列提供「Syntax」開關與 8 種語言選單（HTML、PHP、JavaScript、TypeScript、Python、JSON、Bash、YAML）；HTML 原生支援內嵌 CSS 與 JavaScript，且單獨 CSS 檔直接使用 HTML 高亮。透過背景同步色彩層在編輯時即時標亮，原文、還原與輸入法完全保留。
- **Tabbypad 項目雙向整合**：
  - 點擊左上角 Tabbypad 圖示開啟項目管理對話框，即時列出既有卡片與建立時間。
  - **存為新項目**：將目前主編輯區內容存成新的 Tabbypad 卡片項目（寫入共用 IndexedDB `NotesDB`）。
  - **載入既有項目**：點選任一項目即可載入主編輯區進行編輯；若編輯區有未保存內容，會主動提示「另存新項目後載入」或「捨棄並載入」，保障原稿不被直接覆蓋。
  - **手動更新原項目**：載入項目後右下角出現狀態膠囊，修改內容後膠囊標示「(未更新)」，點擊「更新原項目」即可寫回原項目（保留原始顏色與建立時間）。
  - **防止多工覆蓋衝突**：若項目在其他分頁被修改或刪除，更新時會自動阻擋覆蓋並提示另存或重新載入。
  - **安全重載機制**：重新整理或重開分頁時，完整保留編輯器目前草稿，自動解除項目連結，防止後續無意間誤覆蓋原項目。
  - 對話框內亦提供「開啟 Tabbypad 頁面 ↗」按鈕，可隨時另開分頁檢視完整看板。
- **左上角獨立工具快捷列**：
  - 工具列整合 **Rich Text Notes**、**Markdown Editor**、**Tabbypad**、**AI-RegExr** 等實用小工具。
  - 點擊直接於新視窗（`_blank`）開啟或開啟專屬操作面板，不影響目前記事本工作區。
  - 在淺色模式與深色模式下均保持白色高對比與懸停發光效果。
- **AI-RegExr 正則表達式測試工具**：
  - 專為大文本（支援上限 10 MiB）設計的純前端、無伺服器 Regular Expression 測試工具，支援 **JavaScript (RegExp)** 與 **PCRE2 (WebAssembly)** 兩大引擎。
  - **PCRE2 相容性**：固定使用 PCRE2 `10.49`，由自有小型 C 介面回傳計數與位置，不建立捕獲字串或 JSON；不等同 PHP `preg_*`。支援 `g`、`i`、`m`、`s`、`x`、`u`。未啟用 `u` 時保留 PCRE2 位元組語意；落在 UTF-8 字元內部的匹配會涵蓋該字元標示並合併重疊範圍，但總數仍為原始匹配數。PCRE2 拒絕孤立 surrogate，JavaScript 保留原生 RegExp 行為。
  - **逾時與完整結果**：引擎就緒後，由主執行緒設定 3 秒匹配期限並終止逾時 Worker，不顯示部分計數或過期標示；下一次測試可直接恢復。背景分頁的計時器可能被瀏覽器延後，不保證精準於第 3 秒停止。完整結果最多標示前 10,000 筆；修改輸入即取消舊工作，停止輸入 300ms 後重算。
  - **傳送至主頁**：按紙飛機按鈕，將完整匹配項目（不含捕獲群組）以換行分隔送至同源主記事本。超過 10,000 筆須確認，只傳前 10,000 筆；合併文字超過 1 MiB 則取消傳送。PCRE2 位元組邊界落在字元內時，傳送涵蓋的完整字元。
  - **草稿保護**：空白主頁直接載入；已有內容時選擇覆蓋、附加或先備份至 Tabbypad。取消、備份失敗、儲存配額不足或確認期間草稿變更，均不取代原草稿。使用 BroadcastChannel 與同源 opener 通訊，先選定一個主頁再送資料，避免多分頁重複匯入；「已接收」不代表已確認寫入。
  - **未開啟主頁時**：確認後開啟主頁並複製匹配文字，請自行貼上；剪貼簿權限不足或新分頁被封鎖會顯示提示。工具本身不儲存測試文本，但主頁確認載入後會依原有機制儲存為本機草稿。
  - **獨立離線安裝**：直接開啟 `ai-regexr/`，待顯示「離線可用」後才能斷網使用；安裝主記事本不會預載本工具。引擎載入另設 15 秒期限。工具資源以 SHA-256 驗證後安裝；失敗保留舊版，不強制接管既有分頁。
  - **完全隱私零上傳**：無後端伺服器、無任何文字或模式上傳、不使用持久化快取紀錄測試文本，所有運算完全在使用者本機瀏覽器內完成。
- **Google 跨裝置資料同步（Redis）**：
  - 點擊左上角雲端同步按鈕，使用 Google 帳號登入後即可在不同裝置的 Chrome 瀏覽器間暫存與傳送文字。
  - 採用 Google 帳號永久 `sub` 識別碼作為 Redis Key，資料於本機 Redis 中暫存 48 小時。
  - **傳送到雲端 (Push)**：將目前編輯區內容送上雲端；若編輯區為空則確認後清空雲端暫存。
  - **從雲端取出 (Pull)**：將雲端內容拉回；若本地已有不同內容，彈窗提供「覆蓋 (Overwrite)」、「附加至末尾 (Append)」或「先備份至 Tabbypad 並載入」。
- **獨立懸浮子母視窗（Floating Window / PiP）**：
  - 支援桌面端 [Document Picture-in-Picture API](https://developer.mozilla.org/en-US/docs/Web/API/Document_Picture-in-Picture_API)，可將記事本置頂懸浮於所有視窗與應用程式之上。
  - 浮動視窗內部為 100% 純淨編輯畫面，透過系統原生外框關閉或返回即可無縫接回主分頁。
- **完整離線能力（PWA）**：支援安裝至手機主畫面或桌面端應用，離線狀態下所有編輯、Tabbypad 筆記、嘸蝦米輸入法功能皆能完整運作。
- **個人化外觀與排版**：
  - 深色模式（Dark mode）、淺色模式（Light mode）、跟隨系統（Device）。
  - 支援多種字型（Default、Serif、Monospaced、Dyslexic、Pixel 等）與自訂字體大小、行高。
  - 支援多種紙張材質背景紋理（Normal、Dotted、Graph、Marble 等）。
  - 支援最佳閱讀行寬排版（Optimal line length）。
  - 支援拼字檢查開關、Tab 縮排。
- **右下角統計概要**：顯示「共 N 字元 · 中文 N 字 · 英文 N 詞」，可在偏好設定顯示／隱藏；不提供完整 Statistics 視窗。
  - 總字元按 Unicode code point 計算，包含空白、Tab、換行、標點、數字與 emoji；單一 `😀` 計 1，組合 emoji 或附加符號可能包含多個 code point。
  - 中文逐漢字計數（含擴充漢字與 `〇`），不計中文標點、不做斷詞。英文以連續 `A–Z`／`a–z` 計詞，保留詞內撇號（`'`、`’`）與連字號（`-`、`‐`、`‑`）；純數字不計詞，數字或其他標點會分隔英文字母段。
  - 統計目前純文字原稿，不統計 Markdown／HTML 預覽渲染結果；輸入約 500ms 後更新，載入或清空後同步更新。嘸蝦米待提交字根不計入；懸浮視窗內也會更新，Tabbypad 連結狀態另列於摘要上方。

## Markdown 唯讀預覽

點擊本機開檔按鈕旁的 **MD**，將目前原文切換成同位置的唯讀預覽；再次點擊 MD 或預覽上方的「返回純文字」即可繼續編輯。切換不會改寫原文，會還原 textarea 的游標、選取範圍與捲動位置。重新整理或重開頁面時一律回到純文字模式，不記住預覽開關。

- **格式**：標題、粗體／斜體、刪除線、引用、清單、分隔線、連結、行內／區塊程式碼、GFM 表格與唯讀任務清單。不包含數學公式、Mermaid 或額外程式碼語法高亮。
- **安全**：內嵌 HTML 顯示標籤原文，不執行、不套用其樣式；Markdown 產生的 HTML 另經安全清理。HTTP／HTTPS 外部連結另開分頁並隔離來源視窗，危險協定不產生可點擊連結。
- **圖片**：自動載入完整 HTTPS 圖片網址。HTTP、相對路徑、`//` 開頭、`data:`、`blob:`、`file:` 等圖片只顯示說明與網址。遠端來源可能取得 IP 與載入時間；離線時圖片不保證可用。
- **原文操作**：下載、複製、Tabbypad 儲存與 Google Push 仍使用 Markdown 原文，不儲存預覽 HTML。
- **內容變更**：成功開啟本機檔案、載入／重載 Tabbypad、Google Pull、清空或接收語音輸入後，自動回到純文字模式。取消或失敗時保留預覽與原稿。
- **介面**：跟隨淺色／深色模式，程式碼區塊與寬表格可水平捲動。全螢幕、專注模式及浮動視窗均保留預覽；預覽內的「返回純文字」不依賴主工具列。
- **隨選動態載入**：首次點擊「MD」按鈕時才動態載入 Marked 與 DOMPurify，降低首頁初次載入開銷；Service Worker 同步預載入快取，即使在離線狀態下首次點擊亦可順暢載入。

## HTML 唯讀預覽

點擊工具列「MD」旁的 **HTML** 按鈕，將目前編輯區切換成沙盒隔離的唯讀 HTML+CSS 預覽畫面；再次點擊 HTML 或預覽上方的「返回純文字」即可回到純文字編輯。切換不改寫原文，完整保留游標位置與捲動高度。純文字、Markdown 預覽與 HTML 預覽三者互斥。

- **安全沙盒**：以隔離的沙盒 iframe 呈現，禁止 JavaScript 執行（移除事件屬性與腳本標籤），禁止表單送出、彈出視窗與自動跳轉。
- **外部資源**：僅允許完整 HTTPS 網址的圖片、外部樣式表（`<link rel="stylesheet">`）與字型；阻擋 HTTP、相對路徑與危險協定資源。
- **超連結**：保留原有排版與文字，但點擊不觸發跳轉，避免離開記事本。
- **外觀**：以原始 HTML 設定為準（未指定時預設白底深色文字），不強制覆蓋為深色模式，維持網頁原本設計。
- **隨選動態載入**：首次點擊「HTML」按鈕時才動態載入 DOMPurify 與預覽控制器，Service Worker 預快取支援離線首次使用。

## 程式碼語法標亮（Syntax Highlighting）

工具列提供 **Syntax** 開關與語言下拉選單，支援 **8 種主流語言選項**：HTML、PHP、JavaScript、TypeScript、Python、JSON、Bash、YAML。其中 HTML 語法標亮已完整支援內嵌 `<style>`（CSS）與 `<script>`（JavaScript），單獨的 CSS 檔案亦直接使用 HTML 進行專屬著色。

- **即時同步色彩**：採用背景色彩層與原生 textarea 像素級同步，僅改變文字色彩，不影響字寬、不改變行高。原生編輯、復原/重做（Undo/Redo）、嘸蝦米輸入法及語音輸入完全不受影響。
- **支援上限**：支援最大 1 MiB 原始碼即時標亮；超過上限自動保持純文字編輯並提示說明，絕不改寫或截斷原文。
- **開檔自動連動**：開啟本機檔案時，若為支援的副檔名會自動選取對應語言（但不自動強制開啟 Syntax；若已開啟則自動依新語言著色）。
- **離線 Web Worker**：語法解析於背景 Worker 中執行，避免編輯卡頓；Prism.js 完整離線預快取，完全無網路時亦可流暢著色。
- **重開行為**：記住最後選擇的語言，但每次開頁時 Syntax 預設保持關閉，維持記事本最輕量化啟動。

## 本機檔案載入

點擊左上角「開啟本機文字檔」資料夾按鈕，一次選取一個檔案。檔案由瀏覽器直接讀取，不上傳伺服器；HTML、SVG、Markdown 與程式碼只顯示原文，不執行、不渲染。

| 類別 | 支援的副檔名／檔名 |
| :--- | :--- |
| 基本文字與指定程式碼 | `.txt`、`.html`、`.md`、`.js`、`.php`、`.py`、`.css` |
| 網頁與前端 | `.htm`、`.markdown`、`.mjs`、`.cjs`、`.jsx`、`.ts`、`.tsx`、`.vue`、`.svelte`、`.scss`、`.sass`、`.less`、`.svg`、`.xml` |
| 資料與記錄 | `.json`、`.jsonc`、`.jsonl`、`.csv`、`.tsv`、`.log`、`.sql` |
| 設定與文件 | `.yaml`、`.yml`、`.toml`、`.ini`、`.cfg`、`.conf`、`.rst`、`.adoc` |
| Shell 與命令腳本 | `.sh`、`.bash`、`.zsh`、`.fish`、`.ps1`、`.bat`、`.cmd` |
| 其他程式語言 | `.rb`、`.pl`、`.lua`、`.r`、`.go`、`.rs`、`.c`、`.h`、`.cpp`、`.hpp`、`.cs`、`.java`、`.kt`、`.swift`、`.dart` |
| 特殊檔名 | `.env`、`.env.*`（例如 `.env.local`）、`.gitignore`、`.editorconfig`、`Dockerfile`、`Makefile` |

- **限制**：只接受上述清單，檔名比對不分大小寫；每檔最大 **1 MiB（1,048,576 bytes）**，僅支援有效 UTF-8（含 UTF-8 BOM）。載入時移除 BOM，換行依 textarea 慣例統一為 LF。不支援的格式、超限或解碼失敗皆不變更原稿。
- **選檔視窗**：為了顯示 `Dockerfile` 與點開頭的設定檔，不使用副檔名篩選；選取後仍會驗證格式。若系統隱藏點開頭的檔案，請開啟選檔視窗的隱藏檔顯示功能。
- **已有不同內容時**：對話框提供「覆蓋目前內容」、「附加於末尾」（以兩個換行分隔）、「備份至 Tabbypad 後載入」與「取消」。空檔案也適用此保護；相同內容不重複詢問。
- **Tabbypad**：備份必須成功寫入 IndexedDB 才載入檔案。覆蓋或備份後載入會解除原項目連結；附加則保留連結，重新計算「未更新」狀態，不會自動更新原卡片。
- **保存與衝突保護**：新內容必須先成功存入 `localStorage` 才替換編輯區，載入後更新字數統計。若確認或備份期間草稿／項目連結改變，會停止載入並保留目前內容；已建立的備份仍保留。儲存配額不足時不載入。
- **離線與隱私**：完成一次線上快取後可離線開檔。載入內容會保存成本機草稿；`.env` 或程式碼可能含密碼與金鑰，之後若手動執行 Google Sync Push，也會上傳目前草稿。

---

## 常用鍵盤快捷鍵

| 快捷鍵（Windows / Linux） | 快捷鍵（macOS） | 功能說明 |
| :--- | :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>S</kbd> | <kbd>⌘ Cmd</kbd> + <kbd>S</kbd> | 儲存/下載筆記為純文字檔（.txt） |
| <kbd>Ctrl</kbd> + <kbd>B</kbd> | <kbd>⌘ Cmd</kbd> + <kbd>B</kbd> | 切換**嘸蝦米輸入法**開關 |
| <kbd>Ctrl</kbd> + <kbd>M</kbd> | <kbd>⌘ Cmd</kbd> + <kbd>M</kbd> | 切換**語音轉文字錄音**開關 |
| <kbd>Alt</kbd> + <kbd>C</kbd> | <kbd>⌥ Option</kbd> + <kbd>C</kbd> | 一鍵複製整篇筆記到剪貼簿 |
| <kbd>Ctrl</kbd> + <kbd>,</kbd> | <kbd>⌘ Cmd</kbd> + <kbd>,</kbd> | 開啟偏好設定（Preferences） |
| <kbd>Ctrl</kbd> + <kbd>K</kbd> | <kbd>⌘ Cmd</kbd> + <kbd>K</kbd> | 開啟鍵盤快捷鍵清單 |
| <kbd>Alt</kbd> + <kbd>F</kbd> | <kbd>⌥ Option</kbd> + <kbd>F</kbd> | 切換專注模式（Focus Mode） |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Del</kbd> | <kbd>⌘ Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Backspace</kbd> | 清空目前筆記 |

---

## 本地運行

本專案為純靜態結構，無需建置步驟，使用任何本機伺服器即可直接開啟：

```sh
python3 -m http.server 8000
```

瀏覽器打開 `http://localhost:8000` 即可使用。初次連線載入後，主應用與 AI-RegExr 分別由各自的 Service Worker 建立獨立離線快取。

### 開發與工具指令（需要 Node.js）

專案根目錄提供標準化開發工具指令：

```sh
# 安裝鎖定版本的開發工具（一般靜態部署不需要執行）
npm ci --ignore-scripts

# 執行 Node 單元測試（包含嘸蝦米輸入核心與正則引擎）
npm test

# 執行 TypeScript 嚴格類型檢查（區分 DOM 與 WebWorker 環境）
npm run typecheck

# 安裝實際 Chrome／Edge（需要相應系統安裝權限），執行限定 IME 的瀏覽器驗收
npx playwright install chrome msedge
npm run test:ime:browser
# 可分別使用 -- --project=chrome 或 -- --project=msedge；
# 自訂實際瀏覽器路徑使用 IME_CHROME_PATH / IME_EDGE_PATH，缺少瀏覽器會失敗、不跳過。

# 重新生成 AI-RegExr 靜態離線 Manifest 與 Service Worker
npm run release

# 驗證已提交的 PCRE2 產物與 C 介面來源雜湊
npm run vendor

# 僅在修改 native 介面或升級引擎時重建：
# 需要 Git、CMake 與固定版 Emscripten 6.0.13；也可把 emcc 放在 PATH
EMSDK=/path/to/emsdk npm run vendor -- --build
npm run vendor
npm run release
```

---

## 部署與快取注意事項

1. **完整靜態目錄部署**：AI-RegExr 執行時只需要靜態 HTTP/HTTPS 服務，不需要 Node.js、PHP 或正規表示式後端。請保留完整專案資源結構。主記事本既有的選用 Google 同步仍依賴原本 PHP/Redis 服務，本次不變。
2. **Nginx / Tengine 連線設定**：若啟用 HTTP/2，務必保留 `keepalive_timeout 60s;`（切勿設為 `0`），避免瀏覽器並行下載資源時連線被重設（`ERR_CONNECTION_RESET`）。
3. **Service Worker 快取版本與獨立範圍**：
   - 主記事本 `sw.js` 快取版本為 `v82`，一般資源引用同步為 `?v=82`。未變更的 IME 完整模組與字典仍位於實體版本路徑 `js/ime/v76/`，避免原生相對 import 混版並維持 strict 型別解析。發佈時必須連同完整版本目錄與快取清單部署；舊頁面請重新載入。
   - 主記事本 `sw.js` 已排除 `ai-regexr/` 的預先快取，並在 Fetch 攔截器中直接略過 `ai-regexr/` 請求。
   - `ai-regexr/` 擁有專屬的獨立 Service Worker（`ai-regexr/sw.js`），由 `npm run release` 自動生成確定性版本快取，不使用 `skipWaiting` 強制接管，確保開啟的分頁與背景 Worker 模組版本一致。
4. **依賴庫與重建**：主記事本的固定版 Marked、DOMPurify、Prism.js 不變。AI-RegExr 的 PCRE2 來源鎖定至 `pcre2-10.49`／commit `6f9d7c1373262c541324a16a358785b33ef116cf`；`scripts/vendor-regexr.mjs --build` 會檢查編譯器版本與來源 commit，使用全新暫存目錄建置 `scripts/pcre2_shim.c`，不修改產生的膠水程式。授權位於 `ai-regexr/vendor/pcre2/LICENCE.md`，產物與來源雜湊記錄於 `vendor-manifest.json`。IME 的 `core.js`、`textarea-controller.js`、`candidate-view.js` 與生命週期入口 `boshiamy.js` 納入 strict JSDoc 檢查；ES module package 範圍限於 IME、AI-RegExr 與測試，主記事本其餘腳本維持原有載入方式。
5. **LazyDraft 更名與既有資料**：
   - 僅更新主品牌、共用返回入口及私有 npm 套件名稱 `lazydraft`；網站仍為 `note.lazyai.day`，GitHub repo 為 `delvilo/LazyDraft`。Tabbypad、AI-RegExr、Markdown Editor 等子工具維持原名；上游作者、授權與來源連結不變。
   - 保留 `index.html` PWA 入口與既有安裝身分，不新增或改動 manifest `id`／scope。草稿、偏好、Google 登入儲存鍵、Redis key 規則、`NotesDB`、歷史 `NotepadSnapshotsDB` 遷移來源、`notepad_bus` 及 `notepad:` 快取前綴均不因品牌更名而改名；請勿清除網站資料來更新品牌。
   - LD 字母圖示採青綠底、白色向量字形，不依賴字型。可編輯來源為 `img/lazydraft-icon.svg`；安裝開發依賴與 Chrome 後執行 `node scripts/build-icons.mjs` 重建 PNG、16／32／48px favicon 與 Safari 單色 mask。可用 `IME_CHROME_PATH` 指定 Chrome；PNG 包含 192／512px maskable 尺寸，Apple touch icon 為 180px。
   - 圖示 URL 維持原樣（包含歷史檔名 `img/notepad-apple-icon.png`），內容已換為 LD；主頁 v78 完整預快取新圖示。PWA 安裝介紹的五張截圖取自新版實際畫面。更換共用圖示或 AI-RegExr 品牌入口後，須執行 `npm run release` 重建其資源雜湊。
   - 既有桌面／主畫面捷徑的名稱與圖示更新由瀏覽器及作業系統管理，不保證重新整理一次立即生效；本次不要求解除安裝，也不清除任何筆記或設定。

## 授權條款

MIT License
