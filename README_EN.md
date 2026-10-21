# LazyDraft

A lightweight plain-text whiteboard for notes, drafts, and AI prompts, with local autosave, Tabbypad archiving, and offline PWA support.

> [繁體中文](README.md) · [English](README_EN.md) · [简体中文](README_ZH_CN.md)

![LazyDraft Snapshot](img/snapshot.png)

Forked from [amitmerchant1990/notepad](https://github.com/amitmerchant1990/notepad). Daily workflow: **draft → save as a Tabbypad item → load, edit, and update manually**.

## Editor & Tools

- **Autosave**: Drafts persist in browser `localStorage`; Tabbypad uses IndexedDB. Clearing site data removes local content; download separate backups of important notes.
- **Download and copy**: Copy the entire note or download `.txt`. The filename uses the first line, falling back to `Notes-DD-MM-YYYY.txt` when that line is blank.
- **Appearance**: Light, dark, or system theme; fonts, size, line height, paper textures, optimal line width, spellcheck, and Tab indentation.
- **Count summary**: Optional bottom-right totals for characters, Chinese characters, and English words. Characters count Unicode code points, including whitespace; Chinese counts individual Han characters, English counts letter-based words. Compound emoji may count as more than one character.
- **Floating window**: Requires desktop Document Picture-in-Picture support; close or return through native frame controls. Focus and fullscreen modes are also available.
- **Utilities**: Open Rich Text Notes, Markdown Editor, Tabbypad, and AI-RegExr from the toolbar without replacing the draft.

### Boshiamy & Dictation

- Click **蝦** or press `Ctrl/Cmd+B` for Boshiamy Chinese input without installing an OS IME. Codes have up to 4 characters. Space/Enter commits the page's first candidate; `0–9` selects candidates (0 is first); Up/Down or PageUp/PageDown changes pages; Backspace corrects and Esc cancels.
- Invalid codes or selections retain composition with a notice. Pending radicals never enter the document or autosave. With pending code, the first `Ctrl/Cmd+Z` only cancels composition; other undo/redo grouping is browser-defined, not necessarily one step per candidate.
- The dictionary is parsed on first activation; failed loads can be retried. First activation works offline after the main cache is installed. Acceptance covers **desktop Chrome/Edge with physical keyboards**, not mobile software keyboards or other browsers.
- The microphone or `Ctrl/Cmd+M` toggles Web Speech API dictation at the cursor. Language follows the browser or Preferences. Availability depends on the browser and speech service; offline operation is not guaranteed.

### Tabbypad & Google Sync

- **Tabbypad**: Save new items, load existing ones, and manually click **更新原項目 (Update Original)**. Loading offers to save or discard the current draft; updates detect changes/deletions from other tabs. Reloading retains the draft but unlinks the item to prevent accidental updates.
- **Optional Google sync**: Sign in to Push/Pull across devices. The backend identifies accounts by Google `sub`; Redis retains text for **48 hours**. Push uploads the current draft; an empty draft clears cloud text only after confirmation. Pull offers overwrite, append, or backup to Tabbypad when local content differs.
- **Privacy**: Normal editing and local imports do not automatically upload text. Manual Push uploads the entire draft, including any credentials it contains. Sync requires a PHP/Redis backend, unlike the static editor.

## Preview & Highlighting

**MD (eye) / HTML (window)** toggles read-only preview; click again or use **返回純文字 (Return to Plain Text)** to edit. Plain text and both previews are mutually exclusive. Toggling preserves source, cursor, and scroll; reopening starts in plain text. Downloads, copy, archiving, and Push always use the source.

- **Markdown**: Standard Markdown/GFM, tables, code, and read-only task lists; no math, Mermaid, or preview code highlighting. Embedded HTML is literal text; generated HTML is sanitized. External HTTP(S) links open in isolated tabs; dangerous schemes are not clickable.
- **HTML**: Sandboxed HTML+CSS with scripts, event handlers, forms, popups, and navigation blocked. Links cannot navigate; original HTML styling is retained rather than forced dark. Only absolute HTTPS images, stylesheets, and fonts are allowed.
- **Remote resources**: Markdown automatically loads only absolute HTTPS images. Remote resources in either preview may reveal IP/request time and may be unavailable offline. Relative and non-HTTPS resources do not load.
- **Syntax (wand)**: Eight choices: HTML, PHP, JavaScript, TypeScript, Python, JSON, Bash, YAML. HTML includes embedded CSS/JS and standalone CSS. Highlighting changes color, not source or native editing. The limit is **1 MiB**; larger content stays plain text without truncation.
- Recognized local files select their language without enabling Syntax. Language is remembered, but Syntax starts off on reopening. Preview/highlighting dependencies are included in the main offline cache.

## Opening Local Files

The folder button reads one file as literal text, never executing code. Maximum **1 MiB (1,048,576 bytes)** per file, valid **UTF-8** only. UTF-8 BOM is accepted and removed; line endings become LF.

- Supported formats include text, Markdown, HTML/CSS, common source code, JSON/CSV/logs, YAML/INI, and shell scripts; also `.env`, `.env.*`, `.gitignore`, `.editorconfig`, `Dockerfile`, and `Makefile`. Only supported names are accepted, case-insensitively—not arbitrary extensions.
- The picker has no extension filter, but selected files are still validated. Enable hidden-file visibility to select dotfiles if needed.
- A different draft, including when importing an empty file, offers **overwrite, append, backup to Tabbypad then load, or cancel**. Append retains the linked item without updating its card; overwrite/backup-then-load unlinks it.
- Backup and local persistence must succeed before replacement. Invalid format/encoding, oversized files, quota failures, or draft/link changes during confirmation preserve the current draft. Completed backups remain available.
- Import works offline after the main cache installs. Imported text becomes a local draft; avoid manually Pushing files containing credentials.

## AI-RegExr

Open [AI-RegExr](ai-regexr/) to test JavaScript RegExp or **PCRE2 10.49 (WASM)**. Local files must contain valid UTF-8, with no extension restriction and a **10 MiB** limit; replacing existing text requires confirmation. Test text and patterns are neither persisted nor uploaded. PCRE2 is not PHP `preg_*`.

- Matching runs in a Worker with a **3-second** deadline; background-tab timers may delay termination. Timeouts discard partial results; the next run can retry. Engine loading has a separate 15-second deadline. At most the first **10,000** matches are highlighted.
- The paper plane sends full matches, not capture groups, separated by newlines to one same-origin main page. More than 10,000 requires confirmation and sends only the first 10,000; joined text over **1 MiB** is rejected. PCRE2 byte boundaries inside characters are expanded to whole characters for display/export.
- Existing main-page drafts offer overwrite, append, or backup. Cancellation, backup/storage failure, or draft changes during confirmation prevent replacement. Without an open main page, confirmation opens one and copies matches for manual pasting. Imported text then persists as a main-page draft.
- **Separate offline cache**: Visit the tool and wait for **離線可用 (Offline ready)** before disconnecting; installing the main notepad does not preload it. Updates are SHA-256 verified, retain the old version on failure, and do not force takeover of active tabs.

## Shortcuts

| Action | Windows / Linux | macOS |
| :--- | :--- | :--- |
| Download `.txt` | Ctrl+S | Cmd+S |
| Boshiamy IME | Ctrl+B | Cmd+B |
| Dictation | Ctrl+M | Cmd+M |
| Copy all | Alt+C | Option+C |
| Preferences | Ctrl+, | Cmd+, |
| Shortcut list | Ctrl+K | Cmd+K |
| Focus mode | Alt+F | Option+F |
| Clear note | Ctrl+Shift+Del | Cmd+Shift+Backspace |

## Local Setup & Development

The main app and AI-RegExr require no build. Run from the repository root, then open `http://localhost:8000`:

```sh
python3 -m http.server 8000
```

Developer tools require Node.js; ordinary static deployment does not:

```sh
npm ci --ignore-scripts
npm test                        # Unit tests
npm run typecheck               # Strict DOM/Worker checks
npx playwright install chrome msedge
npm run test:ime:browser         # Actual Chrome/Edge IME acceptance
npm run vendor                  # Verify PCRE2 artifacts/source hashes
npm run release                 # Rebuild AI-RegExr manifest/Service Worker
```

Browser tests accept `-- --project=chrome` or `-- --project=msedge`, and `IME_CHROME_PATH` / `IME_EDGE_PATH` for custom binaries. Missing browsers fail the run.

Rebuild PCRE2 only for native-interface changes or engine upgrades. Requires Git, CMake, and Emscripten **6.0.13** (`emcc` may be on PATH):

```sh
EMSDK=/path/to/emsdk npm run vendor -- --build
npm run vendor
npm run release
```

## Deployment & Maintenance

- Deploy the complete static directory over HTTP/HTTPS. Offline support requires HTTPS or localhost and a completed initial cache. Google sync additionally needs PHP/Redis. With Nginx/Tengine HTTP/2, keep `keepalive_timeout 60s;`, never `0`.
- Root `sw.js` uses cache `v82`; synchronize changed asset URLs and cache entries. Deploy all of `js/ime/v76/` without mixing module versions. AI-RegExr has its own Service Worker, bypassed by the root worker. Run `npm run release` after tool asset changes, then reload old pages.
- PCRE2 source pins and hashes are in `vendor-manifest.json`; see [PCRE2 LICENCE](ai-regexr/vendor/pcre2/LICENCE.md). Rebuild through tooling rather than hand-editing generated glue.
- Icon source: `img/lazydraft-icon.svg`. With developer tools and Chrome installed, run `node scripts/build-icons.mjs`; shared icon changes also require `npm run release`.
- Preserve the existing PWA identity, storage keys, and database names. Updates do not require uninstalling or clearing site data; shortcut name/icon refresh is browser/OS-managed.

## License

[MIT License](LICENSE.txt)
