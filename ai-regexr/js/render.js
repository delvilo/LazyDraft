/** @type {Record<string, string>} */
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** @param {string} text */
function escapeHtml(text) {
    return text.replace(/[&<>"']/g, character => HTML_ESCAPES[character]);
}

export class HighlightView {
    /** @param {HTMLTextAreaElement} textarea @param {HTMLElement} backdrop @param {HTMLPreElement} pre */
    constructor(textarea, backdrop, pre) {
        this.textarea = textarea;
        this.backdrop = backdrop;
        this.pre = pre;
        this.observer = new ResizeObserver(() => this.sync());
        this.observer.observe(textarea);
        textarea.addEventListener('scroll', () => this.sync());
    }

    /** @param {string} text */
    clear(text) {
        this.pre.textContent = text + '\u200b';
        this.sync();
    }

    /** Only render offsets against the immutable snapshot that produced them.
     * @param {string} text @param {Uint32Array} ranges
     */
    render(text, ranges) {
        const chunks = [];
        let cursor = 0;
        let previousStart = 0;
        for (let index = 0; index < ranges.length; index += 2) {
            let start = ranges[index];
            const end = ranges[index + 1];
            if (start < previousStart || end < start || end > text.length) throw new Error('Invalid engine match offsets');
            previousStart = start;
            // Byte-mode matches can cover the same visible character. Paint
            // their union without duplicating source text or changing totals.
            if (start < cursor) {
                if (end <= cursor) continue;
                start = cursor;
            }
            chunks.push(escapeHtml(text.slice(cursor, start)));
            chunks.push(start === end ? '<mark class="zero-match"></mark>' : `<mark>${escapeHtml(text.slice(start, end))}</mark>`);
            cursor = end;
        }
        chunks.push(escapeHtml(text.slice(cursor)), '\u200b');
        this.pre.innerHTML = chunks.join('');
        this.sync();
    }

    sync() {
        // Textarea clientWidth excludes its scrollbar. A hidden backdrop must use
        // the same wrapping width even when only the textarea has a scrollbar.
        this.pre.style.width = `${this.textarea.clientWidth}px`;
        this.backdrop.scrollTop = this.textarea.scrollTop;
        this.backdrop.scrollLeft = this.textarea.scrollLeft;
    }
}
