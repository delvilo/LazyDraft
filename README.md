# LazyDraft

個人工作用的輕量純文字白板，適合筆記、草稿與 AI Prompt。支援本機自動儲存、Tabbypad 歸檔與離線 PWA。

> [繁體中文](README.md) · [English](README_EN.md) · [简体中文](README_ZH_CN.md)

![LazyDraft Snapshot](img/snapshot.png)

Fork 自 [amitmerchant1990/notepad](https://github.com/amitmerchant1990/notepad)。日常流程：**編輯草稿 → 新增／更新 Tabbypad 項目 → 自動清空並開始下一份草稿**。

## 編輯與工具

- **自動儲存**：草稿存於瀏覽器 `localStorage`，重開仍保留；Tabbypad 使用 IndexedDB。清除網站資料會移除本機內容，重要筆記請另行下載備份。
- **下載與複製**：一鍵複製全文或下載 `.txt`；檔名取第一行，若第一行空白則使用 `Notes-DD-MM-YYYY.txt`。
- **外觀**：淺色／深色／跟隨系統，字型、字級、行高、紙張紋理、最佳行寬、拼字檢查與 Tab 縮排皆可調整。
- **字數摘要**：右下角顯示總字元、中文字數與英文詞數，可隱藏。總字元按 Unicode code point 計算（含空白與換行），中文逐漢字、英文按字母詞段計數；組合 emoji 不一定只計一字。
- **懸浮視窗**：需桌面瀏覽器支援 Document Picture-in-Picture；以原生外框關閉／返回主頁。另提供專注與全螢幕模式。
- **獨立工具**：工具列可開啟 Rich Text Notes、Markdown Editor、Tabbypad 與 AI-RegExr，不取代目前草稿。
- **文字 QR**：工具列開啟唯讀快照，優先使用選取文字，否則使用草稿全文。上限 **2,048 UTF-8 bytes**（含），保留空白、換行、中文與 emoji；無內容或超限不產生、不截斷、不分割。任何看見圖碼的人都能讀取明文；不提供下載或接收確認。關閉即清除預覽與圖碼，不新增傳送紀錄，不更動草稿或 Tabbypad。
- **掃描與離線**：由外部手機相機或掃描工具讀取後自行複製貼上，非即時同步亦不自動清空草稿；高密度圖碼不保證所有相機皆能辨識或完整複製。完成首次連線快取後可離線產生；編碼器僅於首次開啟 QR 時執行，無須 CDN、伺服器或 WebRTC。

### 嘸蝦米與語音

- 按「蝦」或 `Ctrl/Cmd+B` 開關嘸蝦米。字母字根僅限小寫，保留 `, . ' [ ]`；大寫直接輸出並取消待選字根，不切換模式。最多 4 碼；空白或 Enter 送出當頁第一字，`0–9` 選字（0 為第一字），上／下或 PageUp／PageDown 翻頁，Backspace 修正、Esc 取消。
- 無候選或輸入錯誤時保留組字並提示；待提交字根不進入正文或自動儲存。有字根時第一次 `Ctrl/Cmd+Z` 僅取消組字，其餘復原／重做由瀏覽器處理，不保證每次選字獨立一步。
- 字典資料僅在啟用時讀取；啟動先準備獨立 IndexedDB `lazydraft-ime-cache` 連線，快取平坦字根／候選文字、位移表與最大碼長，依完整版本化 URL 區分，不改動草稿或 Tabbypad 資料。暖載入不解析完整 JSON，按輸入字根查找候選；未命中或儲存不可用時由 JSON 檔重建。載入失敗可重試，完成主頁快取後亦可離線啟用。驗收範圍為**桌面 Chrome／Edge＋實體鍵盤**，不保證手機或其他瀏覽器相容。
- 啟用後每次從中文模式開始，不記憶中英模式。textarea 有焦點時，純 `Ctrl+Alt`（macOS `Control+Option`）放開一鍵切換一次；第三鍵、AltGr 或失去焦點則取消。切英文會取消待選字根，所有輸入走原生；切換時提示模式，懸浮視窗亦適用。系統可能攔截快捷鍵，例如 VoiceOver。
- 中文模式（含載入與開頁還原）關閉原生拼字檢查與自動校正，Spellcheck 鎖定並附原因。英文模式恢復拼字偏好及可調整開關，設定英文語言提示與 `autocorrect=on`；停用、取消或載入失敗恢復原設定。模式切換不改寫拼字偏好，實際檢查與校正依瀏覽器／系統能力；重設偏好恢復預設值。
- 麥克風或 `Ctrl/Cmd+M` 切換語音轉文字，文字插入游標處。使用 Web Speech API；語言可跟隨瀏覽器或於偏好設定選擇。可用性依瀏覽器與語音服務而定，不保證離線。
- 載入時僅建立辨識物件，不啟動錄音或詢問權限；API 不存在或建構失敗時，隱藏麥克風、語言設定與語音快捷鍵說明，且不攔截 `Ctrl/Cmd+M`。成功建立不保證服務可用；使用時的權限／服務錯誤會提示，保留入口供重試。

### Tabbypad

- **Tabbypad**：可載入既有項目編輯，或存為新項目。新增與手動「更新原項目」（含右下角按鈕）成功後，若草稿與連結未變更，會清空並解除連結、關閉管理視窗，焦點回到純文字編輯器；重新整理仍維持空白。
- **儲存保護**：儲存失敗、取消、衝突未解決或等待期間草稿／連結改變，都不清空目前內容。若已存入 Tabbypad，但無法保存空白本機草稿，會提示「已儲存，但未清空」，保留內容與連結供處理。
- **備份與載入**：載入另一項目前可另存草稿或捨棄；備份成功才繼續載入，不會停在空白畫面，備份失敗則保留原稿。更新仍檢查其他分頁的修改／刪除衝突；未歸檔的本機草稿重開仍保留，但解除項目連結。

## 預覽與語法標亮

**MD（眼睛）／HTML（視窗）**切換唯讀預覽，再次點擊或按「返回純文字」繼續編輯。兩種預覽與純文字模式互斥，切換保留原文、游標與捲動；重開回到純文字。下載、複製、歸檔與 Push 都使用原文。

- **Markdown**：支援一般 Markdown／GFM、表格、程式碼與唯讀任務清單；不含數學公式、Mermaid 或預覽內程式碼高亮。內嵌 HTML 顯示原文，產生的 HTML 經清理；外部 HTTP(S) 連結另開隔離分頁，危險協定不提供連結。
- **HTML**：沙盒呈現 HTML＋CSS，禁止腳本、事件處理、表單、彈窗與跳轉；連結不可導航，外觀依原 HTML，不強制深色。只允許完整 HTTPS 圖片、樣式表與字型。
- **遠端資源**：Markdown 僅自動載入完整 HTTPS 圖片。兩種預覽的遠端資源都可能洩露 IP／請求時間，離線不保證可用；相對路徑與非 HTTPS 資源不載入。
- **Syntax（魔棒）**：8 個選項為 HTML、PHP、JavaScript、TypeScript、Python、JSON、Bash、YAML。HTML 包含內嵌 CSS／JS，純 CSS 也選 HTML。只改色彩，不改原文與原生編輯；上限 **1 MiB**，超限保留純文字、不截斷。
- 支援的本機檔會自動選取語言，但不強制啟用 Syntax。記住語言，重開仍預設關閉。預覽與高亮所需資源已納入主頁離線快取。

## 載入本機檔案

資料夾按鈕一次讀取一個檔案，僅載入原文、不執行程式碼。每檔最大 **1 MiB（1,048,576 bytes）**，須為有效 **UTF-8**（可含 BOM，載入時移除；換行統一為 LF）。

- 支援文字、Markdown、HTML／CSS、常見程式碼、JSON／CSV／日誌、YAML／INI、Shell 等格式；另支援 `.env`、`.env.*`、`.gitignore`、`.editorconfig`、`Dockerfile`、`Makefile`。僅接受支援清單內的名稱，並非任意副檔名；比對不分大小寫。
- 選檔視窗不篩選副檔名，但選取後仍驗證格式；點開頭檔案可能需開啟系統的隱藏檔顯示。
- 遇到不同草稿（含載入空檔）可**覆蓋、附加、備份至 Tabbypad 後載入或取消**。附加保留項目連結，不自動更新卡片；覆蓋／備份後載入會解除連結。
- 備份及本機儲存成功後才替換內容；格式／解碼錯誤、超限、配額不足或確認期間草稿／連結改變，皆保留原稿。已成功建立的備份仍保留。
- 完成主頁快取後可離線開檔。載入內容會保存為本機草稿；含憑證的檔案不應隨意 Push 到雲端。

## AI-RegExr

開啟 [AI-RegExr](ai-regexr/) 測試 JavaScript RegExp 或 **PCRE2 10.49（WASM）**。可開啟有效 UTF-8 本機文字檔（不限制副檔名），上限 **10 MiB**，覆蓋既有文本前須確認。測試文本與模式不持久化、不上傳；PCRE2 不等同 PHP `preg_*`。

- 匹配在 Worker 執行，設定 **3 秒**期限；背景分頁計時器可能延後。逾時終止工作、不顯示部分結果，下次可重試；引擎載入期限另為 15 秒。最多標示前 **10,000** 筆。
- 紙飛機傳送完整匹配（非捕獲群組），換行分隔至一個同源主頁。超過 10,000 筆須確認，只傳前 10,000 筆；文字超過 **1 MiB** 不傳送。PCRE2 位元組匹配跨入字元內部時，顯示與傳送涵蓋完整字元。
- 主頁已有草稿時可覆蓋、附加或先備份；取消、備份／儲存失敗或確認期間草稿改變均不覆蓋。未開主頁時，確認後開頁並複製，需自行貼上；匯入主頁後才依草稿機制保存。
- **獨立離線快取**：須先開啟本工具，等待「離線可用」後再斷網；安裝主記事本不會預載它。更新經 SHA-256 驗證，失敗保留舊版，不強制接管既有分頁。

## 編輯器比較實驗室

[比較入口](editor-lab/)提供 Squire、Trix、Tiptap、Lexical、Editor.js 與 Trumbowyg（依賴 jQuery 3.7.1）。不替換既有 Rich Text Notes，也不預選勝出者。

`editor-lab/index.html` 會轉至 `dist/` 的建置版本；`hub.html` 僅供 Vite 建置使用。

- 各頁保留原生文件格式與介面。Squire、Tiptap、Lexical 使用標示為自製的工具列；Trumbowyg 保留原生工具列並依賴鎖定的 jQuery 3.7.1。共用契約見 [`src/contracts.ts`](editor-lab/src/contracts.ts)。
- 草稿按編輯器分開存入 LocalStorage。本機 PNG、JPEG、WebP、GIF 原始檔存入獨立 IndexedDB，每檔上限 **5 MiB**，不把 Base64 圖片寫進草稿。
- HTML 匯出內嵌本機圖片。PDF 使用瀏覽器列印，僅列印文件與影音來源連結，不包含工具列。
- 實驗室需要 HTTPS 或 localhost。Service Worker 不可用時會停止初始化並提示，不清除既有草稿。
- 等待「離線可用」後，六款編輯器與本機圖片可離線使用。網址圖片、YouTube、Vimeo 與遠端影音仍需連線，不下載影片。
- 比較頁顯示建置資源圖與 Chrome 實測。載入、儲存時間包含測試工具往返，僅代表該次環境，不是跨設備效能保證。

## 快捷鍵

| 功能 | Windows／Linux | macOS |
| :--- | :--- | :--- |
| 下載 `.txt` | Ctrl+S | Cmd+S |
| 嘸蝦米 | Ctrl+B | Cmd+B |
| 語音轉文字 | Ctrl+M | Cmd+M |
| 複製全文 | Alt+C | Option+C |
| 偏好設定 | Ctrl+, | Cmd+, |
| 快捷鍵清單 | Ctrl+K | Cmd+K |
| 專注模式 | Alt+F | Option+F |
| 清空筆記 | Ctrl+Shift+Del | Cmd+Shift+Backspace |

## 本地啟動與開發

主應用與 AI-RegExr 無需建置，於專案根目錄執行後開啟 `http://localhost:8000`：

```sh
python3 -m http.server 8000
```

開發工具需要 Node.js；一般靜態部署不需安裝：

```sh
npm ci --ignore-scripts
npm test                        # 單元測試
npm run typecheck               # DOM／Worker 嚴格型別檢查
npx playwright install chrome msedge
npm run test:ime:browser         # 真實 Chrome／Edge IME／QR 驗收
npm run bench:ime                # 20 次暖快取重新載入，每次啟用皆須 <50ms
npm run vendor                  # 驗證 PCRE2 產物與來源雜湊
npm run release                 # 重建 AI-RegExr manifest／Service Worker
```

瀏覽器測試可加 `-- --project=chrome` 或 `-- --project=msedge`，或以 `IME_CHROME_PATH`／`IME_EDGE_PATH` 指定執行檔；缺少瀏覽器會失敗。

效能驗收使用隔離的無頭桌面 Chrome，先冷啟用寫入 IndexedDB，再重開頁面 20 次；禁用 Service Worker 與 JSON 回退，每次須命中 IndexedDB 且低於 50ms，否則指令失敗，不平均或捨棄樣本。頁內計時從真實工具列點擊開始，派送 `a` 給原控制器，至「對」候選 DOM 可見並完成布局為止，不含 Playwright 往返或下一幀合成。門檻限定本機暖快取驗收，非冷載入或所有設備保證。

### 編輯器實驗室的建置與測試

使用 Node.js 26。原始碼與鎖定版本位於 `editor-lab/`，可直接部署的產物位於 `editor-lab/dist/`。

```sh
npm --prefix editor-lab ci --ignore-scripts
npm --prefix editor-lab exec -- playwright install chrome msedge firefox
npm --prefix editor-lab run build
npm --prefix editor-lab test
npm --prefix editor-lab run verify:release
LAB_BASE_URL=http://localhost:8000/editor-lab/dist/ npm --prefix editor-lab run measure
```

量測指令使用上方已啟動的本機網站。`measurements.json` 保存瀏覽器、日期與實測結果，不納入版本雜湊。`dist/release.json` 記錄檔案 SHA-256、各頁完整資源與套件授權，完整聲明見 `dist/THIRD_PARTY_NOTICES.txt`。

`npm --prefix editor-lab run dev` 先建置，再啟動實驗室預覽。修改原始碼後須重新執行。瀏覽器測試涵蓋合成組字事件，不等同實體鍵盤、系統輸入法或手機驗證。

### PCRE2 引擎重建

僅在修改原生介面或升級引擎時重建 PCRE2，需 Git、CMake、Emscripten **6.0.13**（`emcc` 可放 PATH）：

```sh
EMSDK=/path/to/emsdk npm run vendor -- --build
npm run vendor
npm run release
```

## 部署與維護

- 完整部署靜態目錄至 HTTP／HTTPS，不需 PHP／Redis；離線功能須 HTTPS 或 localhost 並完成首次快取。升級時同步刪除已移除的舊檔（含雲端同步後端），勿只覆蓋新檔。Nginx／Tengine 使用 HTTP/2 時保留 `keepalive_timeout 60s;`，勿設為 `0`。
- 主頁 `sw.js` 快取為 `v91`；變更資源時同步更新對應 URL 與快取清單。完整部署 `js/ime/v89/`，不要混用模組版本。AI-RegExr 與 Editor Lab 有獨立 Service Worker，主頁不攔截其請求；各工具的資源須由各自建置流程更新。
- PCRE2 固定來源與雜湊見 `vendor-manifest.json`，授權見 [PCRE2 LICENCE](ai-regexr/vendor/pcre2/LICENCE.md)；請透過建置流程重建，不手改產生的膠水程式。
- 圖示來源為 `img/lazydraft-icon.svg`；安裝開發工具與 Chrome 後執行 `node scripts/build-icons.mjs`。變更共用圖示後也須執行 `npm run release`。
- 保留既有 PWA 身分、儲存鍵與資料庫名稱。安裝入口與提示由瀏覽器管理，頁面不提供自訂安裝按鈕。更新不需卸載或清除網站資料；桌面捷徑名稱／圖示更新由瀏覽器與系統管理。

## 授權

- [MIT License](LICENSE.txt)
- QR Code 生成庫採用 [Nayuki QR Code generator v1.8.0](https://github.com/nayuki/QR-Code-generator/releases/tag/v1.8.0)（[MIT License](js/libraries/qrcodegen-1.8.0.LICENSE)）。
