import { DEBOUNCE_MS, MAX_TEXT_BYTES, MAX_HIGHLIGHTS, RegexError } from './contracts.js';
import { ENGINE_FLAGS, parsePattern, formatPattern, utf8ByteLength } from './pattern.js';
import { RegexRunner } from './runner.js';
import { HighlightView } from './render.js';
import { initOffline } from './offline.js';

/** @template {HTMLElement} T @param {string} id @param {{new(): T}} type @returns {T} */
function element(id, type) {
    const found = document.getElementById(id);
    if (!(found instanceof type)) throw new Error(`Missing element: ${id}`);
    return found;
}

const patternInput = element('patternInput', HTMLInputElement);
const textarea = element('longTextarea', HTMLTextAreaElement);
const engineSelect = element('engineSelect', HTMLSelectElement);
const flagsContainer = element('flagsContainer', HTMLDivElement);
const statusBadge = element('statusBadge', HTMLSpanElement);
const statusText = element('statusText', HTMLSpanElement);
const statusTime = element('statusTime', HTMLDivElement);
const copyButton = element('copyPatternBtn', HTMLButtonElement);
const sendButton = element('sendToNotepadBtn', HTMLButtonElement);
const openFileButton = element('openFileBtn', HTMLButtonElement);
const fileInput = element('localFileInput', HTMLInputElement);
const view = new HighlightView(textarea, element('backdrop', HTMLDivElement), element('highlightsPre', HTMLPreElement));

/** Preference failures must not disable the editor or affect main-notepad storage.
 * @param {string} key @returns {string | null}
 */
function readPreference(key) {
    try { return localStorage.getItem(key); }
    catch { return null; }
}
/** @param {string} key @param {string} value */
function savePreference(key, value) {
    try { localStorage.setItem(key, value); }
    catch { statusTime.textContent = '偏好設定無法儲存'; }
}

/** @type {import('./contracts.js').Engine} */
let engine = readPreference('ai_regexr_engine') === 'pcre' ? 'pcre' : 'javascript';
let flags = supportedFlags(readPreference('ai_regexr_flags') ?? 'gm');
let revision = 0;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let debounceTimer;
let composing = false;
/** @type {{text: string, ranges: Uint32Array, totalMatches: number} | null} */
let lastResultData = null;

/** @param {string} candidate */
function supportedFlags(candidate) {
    return [...new Set(candidate)].filter(flag => ENGINE_FLAGS[engine].some(item => item.flag === flag)).join('');
}

/** @param {string} badge @param {string} message @param {string} [state] */
function status(badge, message, state = '') {
    statusBadge.className = `regexr-status-badge ${state}`;
    statusBadge.textContent = badge;
    statusText.textContent = message;
    statusTime.textContent = '';
}

const runner = new RegexRunner(phase => {
    if (phase === 'loading') status('載入中', '正在載入測試引擎（上限 15 秒）', 'is-loading');
    else status('計算中', '正在測試；超過 3 秒將中止，不顯示部分結果', 'is-loading');
});

/** @param {unknown} error */
function showError(error) {
    const kind = error instanceof RegexError ? error.kind : 'worker';
    const labels = { load: '引擎載入失敗', syntax: '表示式語法錯誤', flags: '旗標錯誤', timeout: '匹配逾時', worker: '執行失敗', cancelled: '已取消', memory: '引擎記憶體不足', input: '文本編碼錯誤' };
    const message = error instanceof Error ? error.message : String(error);
    patternInput.classList.toggle('is-invalid', kind === 'syntax' || kind === 'flags');
    status(labels[kind], message, 'has-error');
}

function renderFlags() {
    flagsContainer.replaceChildren();
    for (const item of ENGINE_FLAGS[engine]) {
        const label = document.createElement('label');
        label.className = 'regexr-flag-label';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.flag = item.flag;
        input.value = item.flag;
        input.checked = flags.includes(item.flag);
        input.addEventListener('change', () => {
            // Editing flags takes ownership from a previously pasted /pattern/flags.
            try {
                const parsed = parsePattern(patternInput.value, flags, engine);
                if (parsed.delimited) patternInput.value = parsed.pattern;
            } catch { /* Keep invalid source visible so the next run reports it. */ }
            flags = Array.from(flagsContainer.querySelectorAll('input:checked'), item => /** @type {HTMLInputElement} */ (item).value).join('');
            savePreference('ai_regexr_flags', flags);
            schedule();
        });
        label.append(input, document.createTextNode(item.label));
        flagsContainer.append(label);
    }
}

function invalidate() {
    revision++;
    clearTimeout(debounceTimer);
    runner.cancel();
    patternInput.classList.remove('is-invalid');
    lastResultData = null;
    view.clear(textarea.value);
}

function schedule() {
    invalidate();
    if (composing) { status('輸入中', '組字完成後開始測試'); return; }
    status('等待中', '輸入停止 300ms 後測試');
    const expectedRevision = revision;
    debounceTimer = setTimeout(() => void execute(expectedRevision), DEBOUNCE_MS);
}

/** @param {number} expectedRevision */
async function execute(expectedRevision) {
    if (expectedRevision !== revision) return;
    try {
        const text = textarea.value;
        const bytes = utf8ByteLength(text);
        if (bytes > MAX_TEXT_BYTES) {
            status('文本超限', `文本 ${(bytes / 1048576).toFixed(2)} MiB，超過 10 MiB；原文完整保留，未執行測試。`, 'has-error');
            return;
        }
        const parsed = parsePattern(patternInput.value, flags, engine);
        if (parsed.delimited && flags !== parsed.flags) {
            flags = parsed.flags;
            savePreference('ai_regexr_flags', flags);
            renderFlags();
        }
        if (!parsed.pattern) { status('無表示式', '請輸入或貼上 Regular Expression'); return; }
        const snapshot = { engine, pattern: parsed.pattern, flags: parsed.flags, text };
        const result = await runner.run(snapshot);
        if (expectedRevision !== revision) return;
        view.render(snapshot.text, result.ranges);
        lastResultData = { text: snapshot.text, ranges: result.ranges, totalMatches: result.totalMatches };
        const total = result.totalMatches.toLocaleString();
        status(`${total} 筆匹配`, result.totalMatches > MAX_HIGHLIGHTS
            ? `全文共 ${total} 筆，僅標示前 ${MAX_HIGHLIGHTS.toLocaleString()} 筆`
            : `全文搜尋完成，共 ${total} 筆`, result.totalMatches ? 'has-matches' : '');
        statusTime.textContent = `${Math.round(result.executionMs)} ms · ${result.version}`;
        if (result.projected) statusText.textContent += '（位元組匹配以涵蓋字元標示，重疊範圍合併）';
    } catch (error) {
        if (expectedRevision !== revision || (error instanceof RegexError && error.kind === 'cancelled')) return;
        lastResultData = null;
        view.clear(textarea.value);
        showError(error);
    }
}

patternInput.addEventListener('input', schedule);
textarea.addEventListener('input', schedule);
for (const input of [patternInput, textarea]) {
    input.addEventListener('compositionstart', () => { composing = true; invalidate(); status('輸入中', '組字完成後開始測試'); });
    input.addEventListener('compositionend', () => { composing = false; schedule(); });
}
engineSelect.value = engine;
engineSelect.addEventListener('change', () => {
    engine = engineSelect.value === 'pcre' ? 'pcre' : 'javascript';
    flags = supportedFlags(flags);
    savePreference('ai_regexr_engine', engine);
    savePreference('ai_regexr_flags', flags);
    renderFlags();
    schedule();
});

element('themeToggleBtn', HTMLButtonElement).addEventListener('click', () => {
    const dark = document.body.classList.toggle('dark');
    savePreference('ai_regexr_theme', dark ? 'dark' : 'light');
});
document.body.classList.toggle('dark', (readPreference('ai_regexr_theme') ?? readPreference('mode')) === 'dark');

element('clearTextBtn', HTMLButtonElement).addEventListener('click', () => {
    if (textarea.value && confirm('確定清空長文本編輯區嗎？')) {
        textarea.value = '';
        schedule();
        textarea.focus();
    }
});

openFileButton.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;

    if (file.size > MAX_TEXT_BYTES) {
        alert(`檔案大小為 ${(file.size / 1024 / 1024).toFixed(2)} MiB，超過最大限制 10 MiB（10,485,760 bytes），未載入檔案。`);
        return;
    }

    if (textarea.value && textarea.value.trim() !== '') {
        if (!confirm(`長文本編輯區已有內容，載入「${file.name}」將會覆蓋現有文字，是否確定？`)) {
            return;
        }
    }

    try {
        const bytes = await file.arrayBuffer();
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n');
        textarea.value = decoded;
        schedule();
        textarea.focus();
        statusTime.textContent = `已載入本機檔案：${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    } catch (error) {
        alert('檔案不是有效的 UTF-8 純文字檔，請先轉成 UTF-8 編碼後再開啟。');
    }
});
copyButton.addEventListener('click', async () => {
    try {
        const parsed = parsePattern(patternInput.value, flags, engine);
        if (!parsed.pattern) return;
        await navigator.clipboard.writeText(formatPattern(parsed.pattern, parsed.flags, engine));
        copyButton.title = '已複製表示式';
        statusTime.textContent = '已複製表示式';
    } catch (error) {
        statusTime.textContent = `無法複製：${error instanceof Error ? error.message : String(error)}`;
    }
});

/** Finds one main-page receiver before sending text, so multiple tabs cannot import twice.
 * @param {string} text
 * @returns {Promise<'received' | 'busy' | 'unavailable'>}
 */
function sendMatches(text) {
    return new Promise(resolve => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        /** @type {BroadcastChannel | null} */
        let channel = null;
        let selected = false;
        const timer = setTimeout(() => finish('unavailable'), 1500);
        /** @param {'received' | 'busy' | 'unavailable'} result */
        function finish(result) {
            clearTimeout(timer);
            window.removeEventListener('message', onMessage);
            channel?.close();
            resolve(result);
        }
        /** @param {{type?: string, id?: string, receiver?: string, received?: boolean}} data
         * @param {(message: object) => void} reply */
        function receive(data, reply) {
            if (!data || data.id !== id) return;
            if (data.type === 'REGEXR_READY' && typeof data.receiver === 'string' && !selected) {
                selected = true;
                reply({ type: 'REGEXR_SEND_MATCHES', id, receiver: data.receiver, matches: text });
            } else if (data.type === 'REGEXR_MATCHES_ACK' && selected) {
                finish(data.received ? 'received' : 'busy');
            }
        }
        /** @param {MessageEvent} event */
        function onMessage(event) {
            if (event.origin !== location.origin || event.source !== window.opener) return;
            receive(event.data, message => window.opener.postMessage(message, location.origin));
        }
        window.addEventListener('message', onMessage);
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                const bus = new BroadcastChannel('notepad_bus');
                channel = bus;
                bus.onmessage = event => receive(event.data, message => bus.postMessage(message));
                bus.postMessage({ type: 'REGEXR_PING', id });
            } catch (error) {
                channel?.close();
                channel = null;
            }
        }
        if (window.opener && !window.opener.closed) {
            try { window.opener.postMessage({ type: 'REGEXR_PING', id }, location.origin); }
            catch { /* BroadcastChannel remains available when opener cannot be reached. */ }
        }
    });
}

sendButton.addEventListener('click', async () => {
    if (sendButton.disabled) return;
    if (!lastResultData || lastResultData.totalMatches === 0 || lastResultData.ranges.length === 0) {
        statusTime.textContent = '目前無任何匹配項目可傳送';
        return;
    }

    const { text, ranges, totalMatches } = lastResultData;
    if (totalMatches > MAX_HIGHLIGHTS
        && !confirm(`共找到 ${totalMatches.toLocaleString()} 筆匹配，為保護主頁效能，將僅傳送前 10,000 筆至主頁記事本。是否繼續？`)) return;

    const extractedMatches = [];
    const rangeLimit = Math.min(ranges.length, MAX_HIGHLIGHTS * 2);
    for (let i = 0; i < rangeLimit; i += 2) {
        extractedMatches.push(text.slice(ranges[i], ranges[i + 1]));
    }
    const payloadText = extractedMatches.join('\n');
    const payloadBytes = utf8ByteLength(payloadText);
    if (payloadBytes > 1024 * 1024) {
        alert(`匹配資料總大小為 ${(payloadBytes / 1024 / 1024).toFixed(2)} MiB，超出主頁記事本 1 MiB 上限，已取消傳送。`);
        return;
    }

    sendButton.disabled = true;
    statusTime.textContent = '正在尋找主頁記事本…';
    try {
        const result = await sendMatches(payloadText);
        if (result === 'received') {
            statusTime.textContent = `主頁已接收 ${extractedMatches.length.toLocaleString()} 筆資料；若有草稿，請至主頁確認寫入方式。`;
            try { window.opener?.focus(); } catch { /* Focus is best-effort. */ }
        } else if (result === 'busy') {
            statusTime.textContent = '主頁正在處理另一筆載入，請完成後再傳送。';
        } else if (confirm(`未偵測到主頁記事本。是否開啟主頁並將 ${extractedMatches.length.toLocaleString()} 筆匹配資料複製到剪貼簿，供您貼上？`)) {
            // Copy while this document is focused; opening a tab first can deny clipboard access.
            let copied = false;
            try {
                await navigator.clipboard.writeText(payloadText);
                copied = true;
            } catch { /* Report denial; the source document remains unchanged. */ }
            const mainWindow = window.open('../', '_blank');
            statusTime.textContent = copied
                ? (mainWindow ? '匹配資料已複製，請在新開啟的主頁貼上。'
                    : '匹配資料已複製；新分頁被封鎖，請自行開啟主頁貼上。')
                : '無法存取剪貼簿，資料未複製；原文與匹配仍保留，請開啟主頁後重新傳送。';
        } else {
            statusTime.textContent = '未開啟主頁，未寫入任何資料。';
        }
    } catch (error) {
        statusTime.textContent = `無法傳送：${error instanceof Error ? error.message : String(error)}`;
    } finally {
        sendButton.disabled = false;
    }
});
window.addEventListener('pagehide', invalidate);
window.addEventListener('pageshow', event => { if (event.persisted) schedule(); });

textarea.value = `Welcome to AI-RegExr!
貼上長文本，在上方輸入或貼上 Gemini 提供的表示式；不會上傳或儲存文本。

範例日誌 (Sample Log Data):
[2026-10-21 14:32:01] INFO  User 1042 login from 192.168.1.45:51230 - status: 200 OK
[2026-10-21 14:32:05] WARN  Disk space usage exceeded 85% on /var/log
[2026-10-21 14:32:10] ERROR Connection timed out after 3000ms
[2026-10-21 14:32:15] INFO  Batch job #8892 processed 4,520 records in 184ms
`;
patternInput.value = String.raw`\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\s+(\w+)`;
renderFlags();
initOffline(element('offlineStatus', HTMLSpanElement));
schedule();
