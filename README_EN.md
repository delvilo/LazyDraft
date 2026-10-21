# LazyDraft

LazyDraft is an offline-capable, lightweight plain-text notepad (PWA) powered by the [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) and [Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) for instant loading and data persistence.

> [繁體中文](README.md) · [English](README_EN.md) · [简体中文](README_ZH_CN.md)

This project is forked from [amitmerchant1990/notepad](https://github.com/amitmerchant1990/notepad). After trimming unnecessary features, integrating essential tools, and flattening the user interface, it is tailored as a **lightweight digital whiteboard for daily work**. It provides a clean, distraction-free layout with clear, large typography—perfect for drafting notes or composing prompts for AI Agents on laptops.

**Core Workflow**:
1. Use the central editor as the primary writing workspace.
2. Save distinct tasks and projects directly into individual **Tabbypad items** for organized archiving.
3. Switch contexts seamlessly by pulling up existing Tabbypad items to edit and update, keeping other mini-tools handy for instant utility.

---

## Notable Features

- **Instant Plain-Text Auto-Save**: All changes are automatically preserved locally in your browser (`localStorage`). Notes persist across reloads and browser sessions.
- **Built-in Boshiamy Web IME (嘸蝦米輸入法)**:
  - Type Chinese directly using Boshiamy radicals without installing an OS-level input method.
  - Dedicated "**蝦**" button in the toolbar, with shortcut <kbd>Ctrl</kbd> / <kbd>⌘ Cmd</kbd> + <kbd>B</kbd>.
  - Floating candidate bar: Space or Enter commits the first candidate on the current page without a newline. Digits `0`–`9` select candidates (`0` is first, `1` is second). Up/Down and PageUp/PageDown change pages and remain consumed at boundaries. Enter inserts a normal newline when no code is pending.
  - The code-length limit is derived from the dictionary, currently **4 characters**. Overflow keys are intercepted with an inline candidate-bar notice; the pending code is retained and never leaks into the document.
  - Unknown codes confirmed with Space/Enter and nonexistent candidate numbers retain composition with a notice. Use Backspace to correct or Esc to cancel; no automatic clearing or guessed commits. The symbols `, . ' [ ]` remain dictionary radicals.
  - Left/Right, Home/End, Delete, Tab, pointer movement of the caret, and selection changes cancel composition before native editing proceeds. Blur, paste, external content loading, and disabling also cancel. Pending radicals never enter the document or autosave.
  - With pending radicals, the first Ctrl/Cmd+Z only cancels composition. Otherwise native Undo/Redo applies with browser-defined grouping, not one step per candidate. Failed native insertion retains the code, candidates, and an error notice; there is no fallback write that silently loses Undo guarantees. OS IME composition keystrokes are not intercepted.
  - **Lazy dictionary and offline support**: Small ES controller modules initialize with the page; the unchanged 22,778-entry JSON dictionary is fetched and parsed only on first activation. It remains cached in memory after disabling. Failed loads can be retried explicitly; activation can be cancelled while loading, during which typing remains native. Previously enabled preferences restore on page load.
  - The root Service Worker predownloads the modules and dictionary without executing or parsing the dictionary in the page. Once the complete cache is installed, first activation also works offline.
  - Formal acceptance covers **desktop Chrome/Edge with physical keyboards**, including floating-window input and return to the main tab. Mobile software keyboards and other browsers are not claimed compatible.
- **Voice Dictation (Speech-to-Text)**:
  - Toolbar microphone button with shortcut <kbd>Ctrl</kbd> / <kbd>⌘ Cmd</kbd> + <kbd>M</kbd>.
  - Built with the native Web Speech API (`SpeechRecognition`).
  - Active recording is indicated by a glowing red pulse animation.
  - Transcriptions are inserted directly at the current cursor position.
  - Supports automatic browser language matching or configurable default languages (Traditional Chinese TW/HK, English, Japanese, Simplified Chinese) in Preferences.
- **One-Click Plain Text Download (.txt)**:
  - Direct download button in the toolbar without nested submenus.
  - Filename dynamically takes the **first non-empty line** of the note, falling back to `Notes-DD-MM-YYYY.txt` if blank.
- **Open Local Text Files**: The folder button beside Download loads text, source code, and configuration files. Supported formats and draft protection rules are listed below.
- **Read-Only Markdown Preview**: The top-left **MD** button switches between source and formatted Markdown/GFM without rewriting the original text.
- **Read-Only HTML Preview**: The top-left **HTML** button switches between source code and an isolated sandboxed HTML+CSS preview; Plaintext/MD/HTML modes are mutually exclusive.
- **Live Syntax Highlighting**: Toolbar "Syntax" toggle with a 9-language selector (HTML, CSS, PHP, JavaScript, TypeScript, Python, JSON, Bash, YAML); colors code live in the editor while preserving native editing, undo/redo, and input methods.
- **Two-Way Tabbypad Integration**:
  - Click the top-left Tabbypad icon to open the item management dialog.
  - **Save As New Item**: Persist the main editor's content directly as a new Tabbypad item in the shared IndexedDB (`NotesDB`).
  - **Load Existing Item**: Load any item into the main editor. If you have unsaved text, a prompt prevents accidental overwrites with options to save as a new item or discard.
  - **Manual Update**: A floating status pill appears when an item is linked. Edits are flagged as "(未更新) / (Modified)", and clicking "更新原項目 (Update Original)" writes changes back while preserving original creation time and color.
  - **Conflict Guard**: Detects if another tab modified or deleted the note before updating, preventing accidental data loss.
  - **Safe Reload**: Refreshing or reopening the page keeps your draft intact while unlinking the item to prevent accidental overwrites.
  - Includes a direct "Open Tabbypad Page ↗" button to view the full Kanban grid.
- **Top-Left Utility Toolbar**:
  - Direct quick-launch buttons for **Rich Text Notes**, **Markdown Editor**, **Tabbypad**, and **AI-RegExr**.
  - Opens in new tabs/windows (`target="_blank"`) or dedicated dialogs without interrupting your current workspace.
  - Styled with high-contrast white icons and hover glow in both Light and Dark themes.
- **AI-RegExr Regular Expression Tester**:
  - A distraction-free, pure client-side Regular Expression tester tailored for large texts (up to 10 MiB), featuring both **JavaScript (RegExp)** and **PCRE2 (WebAssembly)** engines.
  - **PCRE2 compatibility**: Pins PCRE2 `10.49` with a small native C interface returning counts and ranges without capture strings or JSON. This is not PHP `preg_*`. Supports `g`, `i`, `m`, `s`, `x`, `u`. Without `u`, native byte semantics are preserved: boundaries inside UTF-8 codepoints are projected onto whole visible characters and overlapping highlights are combined, without changing the match count. PCRE2 rejects lone surrogates; JavaScript retains native RegExp behavior.
  - **Deadlines and complete results**: After engine initialization, a main-thread 3-second deadline terminates an overlong Worker. No partial count or stale highlights are displayed; the next run recovers automatically. Background-tab timer throttling can delay termination; this is not a real-time guarantee. Complete results display at most the first 10,000 matches. Input changes cancel the old job immediately; reruns follow a 300ms typing pause.
  - **Send to main notepad**: The paper-plane button sends full matches (not capture groups), separated by newlines, to one same-origin main page. More than 10,000 matches requires confirmation and exports only the first 10,000; joined text over 1 MiB is rejected. PCRE2 byte matches ending inside a character export the covering whole character.
  - **Draft protection**: An empty main editor loads directly; an existing draft offers overwrite, append, or backup to Tabbypad before loading. Cancellation, failed backup, storage quota failure, or edits during confirmation preserve the draft. BroadcastChannel and same-origin opener messaging select one receiver before sending text, avoiding duplicate imports across tabs. Receipt acknowledgement does not imply the user confirmed writing.
  - **No main page open**: Confirmation opens the main page and copies matches for manual pasting. Clipboard denial and blocked popups are reported. Test text is not stored by the tool; explicitly importing into the main page persists it as a local draft.
  - **Independent offline installation**: Visit `ai-regexr/` and wait for “離線可用” before going offline. Installing the main notepad does not preload this tool. Engine loading has a separate 15-second deadline. SHA-256 checks reject incomplete or mixed releases; failed updates retain the old version without forcing takeover of open tabs.
  - **Zero Telemetry & Absolute Privacy**: No backend server, no cloud uploads, no persistent caching of user patterns or input text. All processing occurs strictly within the local browser runtime.
- **Cross-Device Google Cloud Sync (Redis)**:
  - Click the top-left cloud sync button to sign in with your Google account and transfer text seamlessly between Chrome browsers on different devices.
  - Uses the permanent Google `sub` (User ID) as the Redis key with a 48-hour TTL.
  - **Push**: Send current editor text to the cloud, or clear cloud content if the editor is blank.
  - **Pull**: Retrieve cloud text. If the local editor already has different content, choose between Overwrite, Append, or Backup to Tabbypad before loading.
- **Floating Window (Picture-in-Picture)**:
  - Uses the native [Document Picture-in-Picture API](https://developer.mozilla.org/en-US/docs/Web/API/Document_Picture-in-Picture_API) to pin the notepad above all other windows and applications.
  - The floating window presents a 100% clean editor surface, seamlessly returning to the main tab when closed via native window frame controls.
- **Full Offline PWA Support**: Installable to Android home screen or desktop application with 100% offline functionality.
- **Customizable Appearance & Typography**:
  - Themes: Light, Dark, or follow system (Device).
  - Fonts: Default, Serif, Monospaced, Dyslexic, Pixel, and customizable size and line height.
  - Textures: Normal, Dotted, Graph, Marble paper textures, and more.
  - Optimal line length layout, Spellcheck, and Tab indentation.
- **Bottom-right count summary**: Shows total characters, Chinese characters, and English words, with a visibility preference and no full Statistics modal.
  - Total characters are Unicode code points, including spaces, tabs, newlines, punctuation, numbers, and emoji. A single `😀` counts as one; compound emoji and combining sequences can contain multiple code points.
  - Chinese counts individual Han characters, including supplementary ideographs and `〇`, without punctuation or word segmentation. English counts runs of `A–Z`/`a–z`, retaining internal apostrophes (`'`, `’`) and hyphens (`-`, `‐`, `‑`). Numbers alone do not count as words; digits and other punctuation separate letter runs.
  - Counts use the plain-text source, not rendered Markdown/HTML. Typing updates after about 500ms; loading or clearing updates the summary as well. Pending Boshiamy radicals are excluded. The summary remains live in floating windows, with linked Tabbypad status displayed above it.

## Read-Only Markdown Preview

Click **MD** beside the local-file button to replace the editor view with a read-only preview. Click MD again, or **返回純文字 (Return to Plain Text)** inside the preview, to resume editing. Toggling preserves the exact source, cursor, selection, and textarea scroll positions. Reloading or reopening always starts in plain-text mode; the preview preference is not persisted.

- **Formatting**: Headings, emphasis, strikethrough, blockquotes, lists, dividers, links, inline/fenced code, GFM tables, and disabled task-list checkboxes. Math, Mermaid, and additional syntax highlighting are not included.
- **Security**: Embedded HTML is displayed as literal source, never executed or styled. Generated Markdown HTML is also sanitized. External HTTP/HTTPS links open in isolated new tabs; dangerous URL schemes do not become clickable links.
- **Images**: Only explicit absolute HTTPS image URLs load automatically. HTTP, relative, protocol-relative, `data:`, `blob:`, and `file:` image URLs appear as description/URL text instead. Remote hosts may receive your IP and request time; images are not guaranteed offline.
- **Source operations**: Downloads, copy, Tabbypad saves, and Google Push continue to use raw Markdown, never the rendered HTML.
- **Content changes**: Successful local-file imports, Tabbypad loads/reloads, Google Pull, clearing, and incoming dictation return to plain text. Cancellation or failure preserves the preview and draft.
- **Layout**: Light/dark themes, horizontally scrollable code and wide tables, fullscreen, focus mode, and floating windows are supported. The preview's return-to-source control remains available when the main toolbar is hidden.
- **Load on Demand**: Marked and DOMPurify are dynamically loaded only when the "MD" button is first clicked, reducing initial payload. The Service Worker pre-caches them so the on-demand load works seamlessly even offline.

## Read-Only HTML Preview

Click **HTML** beside the "MD" button to view a sandboxed, static HTML+CSS preview. Click HTML again or **返回純文字 (Return to Plain Text)** to resume editing. Toggling preserves raw HTML source, cursor selection, and scroll position. Plaintext, Markdown, and HTML preview modes are strictly mutually exclusive.

- **Sandbox Security**: Rendered inside an isolated iframe sandbox with JavaScript execution disabled (no script tags or event handlers), form submissions blocked, popups disabled, and navigation prevented.
- **External Resources**: Only explicit absolute HTTPS URLs for images, stylesheets (`<link rel="stylesheet">`), and fonts are allowed. HTTP, relative, and insecure protocols are stripped.
- **Links**: Hyperlinks retain their visual styles but cannot be navigated.
- **Appearance**: Follows original HTML styling (defaults to light background with dark text) rather than forcing theme overrides, preserving the intended web layout.
- **Load on Demand**: DOMPurify and the HTML preview module are loaded only when "HTML" is first clicked. Service Worker pre-caching ensures offline availability.

## Live Syntax Highlighting

The toolbar includes a **Syntax** toggle button and a language selector supporting **8 core language options**: HTML, PHP, JavaScript, TypeScript, Python, JSON, Bash, and YAML. The HTML grammar natively supports embedded `<style>` (CSS) and `<script>` (JavaScript), and standalone CSS files are seamlessly highlighted under the HTML option.

- **Zero-Shift Layering**: A synchronized background layer colors tokens behind the native textarea without altering character metrics or line heights. Native typing, undo/redo, Boshiamy IME, and dictation remain 100% intact.
- **1 MiB Boundary**: Real-time highlighting is supported up to 1 MiB. Files exceeding 1 MiB remain fully editable in plain text with a non-destructive notice.
- **File Open Integration**: Opening a recognized local source file automatically selects its matching language without forcibly enabling Syntax (or recolors live if Syntax is already active).
- **Worker & Offline**: Parsing runs off the main thread in a dedicated Web Worker using a local Prism bundle. Service Worker caching ensures full offline functionality.
- **Persistence**: The selected language is remembered across reloads, while Syntax defaults to OFF on startup to preserve instant page loads.

## Opening Local Files

Click the top-left **Open Local Text File** folder button and select one file. Reading happens entirely in the browser, without uploading the file. HTML, SVG, Markdown, and source code remain literal text; nothing is executed or rendered.

| Category | Supported extensions / filenames |
| :--- | :--- |
| Basic text and source code | `.txt`, `.html`, `.md`, `.js`, `.php`, `.py`, `.css` |
| Web and frontend | `.htm`, `.markdown`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.tsx`, `.vue`, `.svelte`, `.scss`, `.sass`, `.less`, `.svg`, `.xml` |
| Data and logs | `.json`, `.jsonc`, `.jsonl`, `.csv`, `.tsv`, `.log`, `.sql` |
| Configuration and documentation | `.yaml`, `.yml`, `.toml`, `.ini`, `.cfg`, `.conf`, `.rst`, `.adoc` |
| Shell and command scripts | `.sh`, `.bash`, `.zsh`, `.fish`, `.ps1`, `.bat`, `.cmd` |
| Other languages | `.rb`, `.pl`, `.lua`, `.r`, `.go`, `.rs`, `.c`, `.h`, `.cpp`, `.hpp`, `.cs`, `.java`, `.kt`, `.swift`, `.dart` |
| Special filenames | `.env`, `.env.*` (such as `.env.local`), `.gitignore`, `.editorconfig`, `Dockerfile`, `Makefile` |

- **Limits**: Only the listed formats are accepted, matched case-insensitively. Maximum **1 MiB (1,048,576 bytes)** per file; valid UTF-8 only, including UTF-8 BOM. The BOM is removed and line endings are normalized to LF to match textarea behavior. Unsupported names, oversized files, and decoding failures leave the draft unchanged.
- **File picker**: No extension filter is applied so extensionless files and dotfiles can be selected; the application still validates the filename. Enable hidden-file visibility in the system picker if dotfiles are hidden.
- **Different existing content**: Choose Overwrite, Append (separated by two newlines), Backup to Tabbypad then Load, or Cancel. Empty files require the same protection; identical content does not prompt again.
- **Tabbypad**: A backup must commit to IndexedDB before loading. Overwrite and backup-then-load unlink the original item. Append retains the link and recalculates its modified state without automatically updating the card.
- **Persistence and conflicts**: Imported content must save to `localStorage` before the editor changes; character/word counts update after loading. If the draft or linked item changes during confirmation or backup, loading stops and the latest draft remains intact. Any completed backup is retained. Storage quota failures prevent replacement.
- **Offline and privacy**: Local import works offline after an initial successful online cache installation. Imported content becomes a locally saved draft. Configuration and source files may contain credentials; a later manual Google Sync Push also uploads the current draft.

---

## Keyboard Shortcuts

| Shortcut (Windows / Linux) | Shortcut (macOS) | Description |
| :--- | :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>S</kbd> | <kbd>⌘ Cmd</kbd> + <kbd>S</kbd> | Save / Download notes as `.txt` |
| <kbd>Ctrl</kbd> + <kbd>B</kbd> | <kbd>⌘ Cmd</kbd> + <kbd>B</kbd> | Toggle **Boshiamy Web IME** on/off |
| <kbd>Ctrl</kbd> + <kbd>M</kbd> | <kbd>⌘ Cmd</kbd> + <kbd>M</kbd> | Toggle **Voice Dictation** recording |
| <kbd>Alt</kbd> + <kbd>C</kbd> | <kbd>⌥ Option</kbd> + <kbd>C</kbd> | Copy note to clipboard |
| <kbd>Ctrl</kbd> + <kbd>,</kbd> | <kbd>⌘ Cmd</kbd> + <kbd>,</kbd> | Open Preferences |
| <kbd>Ctrl</kbd> + <kbd>K</kbd> | <kbd>⌘ Cmd</kbd> + <kbd>K</kbd> | Open Keyboard Shortcuts list |
| <kbd>Alt</kbd> + <kbd>F</kbd> | <kbd>⌥ Option</kbd> + <kbd>F</kbd> | Toggle Focus Mode |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Del</kbd> | <kbd>⌘ Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Backspace</kbd> | Delete all notes |

---

## Running Locally

Run a local HTTP server in the repository root:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000` in your browser. Upon first load, the main notepad and AI-RegExr each install independent offline caches via their respective Service Workers.

### Developer & Tooling Commands (Requires Node.js)

The repository root provides standard developer commands:

```sh
# Install pinned developer tools (not required for ordinary static deployment)
npm ci --ignore-scripts

# Run Node unit tests (including the Boshiamy core and regex engines)
npm test

# Run TypeScript typechecks under strict checkJs (separate DOM and WebWorker configs)
npm run typecheck

# Install actual Chrome/Edge (requires appropriate system install permissions), then run IME browser acceptance
npx playwright install chrome msedge
npm run test:ime:browser
# Select a project with -- --project=chrome or -- --project=msedge.
# IME_CHROME_PATH / IME_EDGE_PATH can specify actual browser binaries; missing browsers fail, never skip.

# Generate static release manifest and scoped Service Worker for AI-RegExr
npm run release

# Verify committed PCRE2 artifacts and native shim source hashes
npm run vendor

# Only when changing the native interface or upgrading the engine:
# Requires Git, CMake and Emscripten 6.0.13; emcc may also be on PATH
EMSDK=/path/to/emsdk npm run vendor -- --build
npm run vendor
npm run release
```

---

## Deployment & Cache Notes

1. **Static Deployment**: AI-RegExr requires only static HTTP/HTTPS hosting, not Node.js, PHP, or a regex backend. Preserve the complete resource directory structure. The main notepad's optional Google sync still uses its existing PHP/Redis backend; that integration is unchanged.
2. **Nginx / Tengine Configuration**:
   - If HTTP/2 is enabled, ensure `keepalive_timeout 60s;` (never set to `0`), or browsers will encounter `ERR_CONNECTION_RESET` when fetching assets in parallel.
3. **Service Worker Versioning & Independent Scope**:
   - The root LazyDraft cache version is `v82`, with ordinary asset queries synchronized to `?v=82`. The unchanged IME module graph and dictionary retain physical release paths under `js/ime/v76/`, keeping relative native imports version-consistent and strictly type-resolvable. Deploy the entire release directory with the cache manifest; reload old pages after deployment.
   - Root `sw.js` excludes `ai-regexr/` from precaching and bypasses `ai-regexr/` requests in its fetch handler.
   - `ai-regexr/` manages its own scoped Service Worker (`ai-regexr/sw.js`), generated deterministically by `npm run release` with immutable cache versioning. It avoids forced `skipWaiting` takeover to protect active tabs and background workers from version drift.
4. **Dependencies and rebuilds**: Main-notepad Marked, DOMPurify, and Prism.js dependencies are unchanged. AI-RegExr pins PCRE2 tag `pcre2-10.49`, commit `6f9d7c1373262c541324a16a358785b33ef116cf`. `scripts/vendor-regexr.mjs --build` checks the compiler version and source commit, builds `scripts/pcre2_shim.c` in a fresh temporary directory, and never hand-edits generated glue. See `ai-regexr/vendor/pcre2/LICENCE.md` and `vendor-manifest.json`. IME `core.js`, `textarea-controller.js`, `candidate-view.js`, and lifecycle entry `boshiamy.js` are covered by strict JSDoc checking. ES-module package scopes are limited to IME, AI-RegExr, and tests; other main-page scripts retain their existing loading convention.
5. **LazyDraft rename and existing data**:
   - Only the parent product brand, shared home links, and private npm package name (`lazydraft`) change. The website remains `note.lazyai.day` and the repository is `delvilo/LazyDraft`. Tabbypad, AI-RegExr, Markdown Editor, and other child tools retain their names; upstream authors, licensing, and source links remain unchanged.
   - Preserve the `index.html` PWA entry and existing install identity; no manifest `id` or scope change is introduced. Draft/preference and Google session storage keys, Redis key rules, `NotesDB`, the legacy `NotepadSnapshotsDB` migration source, `notepad_bus`, and the `notepad:` cache prefix retain their compatibility identities. Do not clear site data to update the brand.
   - The LD monogram uses white, font-independent vector paths on teal. Edit `img/lazydraft-icon.svg`, then run `node scripts/build-icons.mjs` after installing development dependencies and Chrome to rebuild PNGs, 16/32/48px favicons, and the monochrome Safari mask. `IME_CHROME_PATH` can select Chrome. PNGs include 192/512px maskable sizes and a 180px Apple touch icon.
   - Existing icon URLs, including the historical `img/notepad-apple-icon.png` filename, remain stable but now serve LD artwork. Root v78 precaches the complete icon set. The five PWA install screenshots show the current application. Run `npm run release` after changing shared icons or the AI-RegExr brand entry to rebuild its resource hashes.
   - Browser/OS-managed names and icons on existing desktop/home-screen shortcuts may not update after a single reload. The rename does not require uninstalling the app or deleting notes/settings.
---

## License

MIT License
