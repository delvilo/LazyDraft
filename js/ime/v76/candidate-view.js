/**
 * @fileoverview Boshiamy IME Floating Candidate View.
 * Owner-document specific UI and caret mirror with geometry caching, rAF coalescing,
 * and zero DOM allocation per keystroke.
 */

const MIRROR_PROPERTIES = [
  'direction',
  'box-sizing',
  'width',
  'height',
  'overflow-x',
  'overflow-y',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-style',
  'font-variant',
  'font-weight',
  'font-stretch',
  'font-size',
  'font-size-adjust',
  'line-height',
  'font-family',
  'text-align',
  'text-transform',
  'text-indent',
  'text-decoration',
  'letter-spacing',
  'word-spacing',
  'tab-size'
];

/**
 * @typedef {Object} CaretPosition
 * @property {number} left
 * @property {number} top
 * @property {number} height
 */

/**
 * @callback CandidateSelectCallback
 * @param {number} slotIndex Relative candidate index on current page (0-9)
 * @returns {void}
 */

export class CandidateView {
  /**
   * @param {HTMLTextAreaElement} textarea
   * @param {CandidateSelectCallback} onSelect
   */
  constructor(textarea, onSelect) {
    /** @type {HTMLTextAreaElement} */
    this.textarea = textarea;
    /** @type {CandidateSelectCallback} */
    this.onSelect = onSelect;
    /** @type {Document} */
    this.doc = textarea.ownerDocument || document;

    /** @type {HTMLElement | null} */
    this.bar = null;
    /** @type {HTMLElement | null} */
    this.bufferSpan = null;
    /** @type {HTMLElement | null} */
    this.candList = null;
    /** @type {HTMLElement | null} */
    this.pageInfo = null;
    /** @type {HTMLElement | null} */
    this.status = null;

    /** @type {HTMLDivElement | null} */
    this.mirror = null;
    /** @type {Text | null} */
    this.mirrorTextNode = null;
    /** @type {HTMLSpanElement | null} */
    this.mirrorMarker = null;

    /** @type {Array<{ root: HTMLElement, idx: HTMLElement, char: HTMLElement }>} */
    this.candItems = [];
    /** @type {HTMLElement | null} */
    this.emptySpan = null;

    /** @type {CaretPosition | null} */
    this.cachedCaretRect = null;
    /** @type {number} */
    this.rafId = 0;
    /** @type {boolean} */
    this.isVisible = false;

    /** @type {MutationObserver | null} */
    this.styleObserver = null;
    /** @type {ResizeObserver | null} */
    this.resizeObserver = null;

    this._onScroll = this._onScroll.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onFontsReady = this._onFontsReady.bind(this);

    this._initUI();
    this._bindListeners();
  }

  /**
   * Initializes candidate bar and caret mirror in this.doc.
   * @private
   */
  _initUI() {
    const doc = this.doc;

    // Clean up any stale bar in this document
    const oldBar = doc.getElementById('boshiamyBar');
    if (oldBar && oldBar.parentNode) {
      oldBar.parentNode.removeChild(oldBar);
    }

    // Build bar container
    const bar = doc.createElement('div');
    bar.id = 'boshiamyBar';
    bar.className = 'boshiamy-candidate-bar';
    bar.style.display = 'none';

    // Composition buffer container
    const comp = doc.createElement('div');
    comp.className = 'boshiamy-comp';

    const modeTag = doc.createElement('span');
    modeTag.className = 'boshiamy-mode-tag';
    modeTag.textContent = '蝦';

    const bufferSpan = doc.createElement('span');
    bufferSpan.id = 'boshiamyBuffer';
    bufferSpan.className = 'boshiamy-buffer';

    comp.appendChild(modeTag);
    comp.appendChild(bufferSpan);

    // Candidates container
    const candList = doc.createElement('div');
    candList.id = 'boshiamyCandidates';
    candList.className = 'boshiamy-candidates';

    // Pre-create reusable max-10 candidate items
    this.candItems = [];
    for (let i = 0; i < 10; i++) {
      const item = doc.createElement('span');
      item.className = 'boshiamy-cand-item';
      item.dataset.index = String(i);
      item.style.display = 'none';

      const idxSpan = doc.createElement('span');
      idxSpan.className = 'boshiamy-cand-idx';
      idxSpan.textContent = String(i);

      const charSpan = doc.createElement('span');
      charSpan.className = 'boshiamy-cand-char';

      item.appendChild(idxSpan);
      item.appendChild(charSpan);
      candList.appendChild(item);

      this.candItems.push({ root: item, idx: idxSpan, char: charSpan });
    }

    // Pre-create empty placeholder
    const emptySpan = doc.createElement('span');
    emptySpan.className = 'boshiamy-no-cand';
    emptySpan.textContent = '(無候選字)';
    emptySpan.style.display = 'none';
    candList.appendChild(emptySpan);
    this.emptySpan = emptySpan;

    // Single delegated pointerdown for candidate selection
    candList.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const target = /** @type {HTMLElement | null} */ (e.target);
      if (!target || typeof target.closest !== 'function') return;
      const item = target.closest('.boshiamy-cand-item');
      if (!item) return;
      const idx = Number(/** @type {HTMLElement} */ (item).dataset.index);
      if (!Number.isNaN(idx)) {
        this.onSelect(idx);
      }
    });

    // Page indicator
    const pageInfo = doc.createElement('div');
    pageInfo.id = 'boshiamyPage';
    pageInfo.className = 'boshiamy-page';
    pageInfo.style.display = 'none';

    // Status message
    const status = doc.createElement('span');
    status.id = 'boshiamyStatus';
    status.className = 'boshiamy-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;

    bar.appendChild(comp);
    bar.appendChild(candList);
    bar.appendChild(pageInfo);
    bar.appendChild(status);

    doc.body.appendChild(bar);

    this.bar = bar;
    this.bufferSpan = bufferSpan;
    this.candList = candList;
    this.pageInfo = pageInfo;
    this.status = status;

    // Create caret mirror div with pre-allocated text node and marker span
    const mirror = doc.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    mirror.style.position = 'absolute';
    mirror.style.top = '0px';
    mirror.style.left = '-9999px';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.overflow = 'hidden';
    mirror.style.visibility = 'hidden';
    mirror.style.pointerEvents = 'none';

    const textNode = doc.createTextNode('');
    const marker = doc.createElement('span');
    marker.textContent = '.';

    mirror.appendChild(textNode);
    mirror.appendChild(marker);
    doc.body.appendChild(mirror);

    this.mirror = mirror;
    this.mirrorTextNode = textNode;
    this.mirrorMarker = marker;
  }

  /**
   * Binds scroll, resize, style/class/dir mutation, and font loading listeners.
   * @private
   */
  _bindListeners() {
    const win = this.doc.defaultView || window;
    win.addEventListener('scroll', this._onScroll, true);
    win.addEventListener('resize', this._onResize);
    if (this.textarea) {
      this.textarea.addEventListener('scroll', this._onScroll);

      if (typeof MutationObserver !== 'undefined') {
        this.styleObserver = new MutationObserver(() => {
          this.invalidateGeometry();
          if (this.isVisible) this.schedulePosition();
        });
        this.styleObserver.observe(this.textarea, {
          attributes: true,
          attributeFilter: ['style', 'class', 'dir']
        });
      }

      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => {
          this.invalidateGeometry();
          if (this.isVisible) this.schedulePosition();
        });
        this.resizeObserver.observe(this.textarea);
      }
    }

    const docWithFonts = /** @type {Document & { fonts?: EventTarget }} */ (this.doc);
    if (docWithFonts.fonts && typeof docWithFonts.fonts.addEventListener === 'function') {
      docWithFonts.fonts.addEventListener('loadingdone', this._onFontsReady);
    }
  }

  /**
   * Unbinds all listeners and disconnects observers.
   * @private
   */
  _unbindListeners() {
    const win = this.doc.defaultView || window;
    win.removeEventListener('scroll', this._onScroll, true);
    win.removeEventListener('resize', this._onResize);
    if (this.textarea) {
      this.textarea.removeEventListener('scroll', this._onScroll);
    }
    if (this.styleObserver) {
      this.styleObserver.disconnect();
      this.styleObserver = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    const docWithFonts = /** @type {Document & { fonts?: EventTarget }} */ (this.doc);
    if (docWithFonts.fonts && typeof docWithFonts.fonts.removeEventListener === 'function') {
      docWithFonts.fonts.removeEventListener('loadingdone', this._onFontsReady);
    }
  }

  /**
   * @private
   */
  _onScroll() {
    this.invalidateGeometry();
    if (this.isVisible) {
      this.schedulePosition();
    }
  }

  /**
   * @private
   */
  _onResize() {
    this.invalidateGeometry();
    if (this.isVisible) {
      this.schedulePosition();
    }
  }

  /**
   * @private
   */
  _onFontsReady() {
    this.invalidateGeometry();
    if (this.isVisible) {
      this.schedulePosition();
    }
  }

  /**
   * Invalidates the cached caret position coordinates.
   * @returns {void}
   */
  invalidateGeometry() {
    this.cachedCaretRect = null;
  }

  /**
   * Coalesces positioning updates into a single requestAnimationFrame.
   * @returns {void}
   */
  schedulePosition() {
    if (this.rafId) return;
    const win = this.doc.defaultView || window;
    this.rafId = win.requestAnimationFrame(() => {
      this.rafId = 0;
      this.applyPosition();
    });
  }

  /**
   * Measures current client position of the textarea caret using reusable mirror DOM.
   * @returns {CaretPosition | null}
   */
  computeCaretPosition() {
    const textarea = this.textarea;
    const mirror = this.mirror;
    const textNode = this.mirrorTextNode;
    const marker = this.mirrorMarker;
    if (!textarea || !mirror || !textNode || !marker || typeof textarea.selectionStart !== 'number') {
      return null;
    }

    const win = this.doc.defaultView || window;
    const computed = win.getComputedStyle(textarea);
    const rect = textarea.getBoundingClientRect();

    for (let i = 0; i < MIRROR_PROPERTIES.length; i++) {
      const prop = MIRROR_PROPERTIES[i];
      mirror.style.setProperty(prop, computed.getPropertyValue(prop));
    }

    mirror.style.setProperty('position', 'absolute');
    mirror.style.setProperty('top', '0px');
    mirror.style.setProperty('left', '-9999px');
    mirror.style.setProperty('white-space', 'pre-wrap');
    mirror.style.setProperty('word-wrap', 'break-word');
    mirror.style.setProperty('overflow', 'hidden');
    mirror.style.setProperty('visibility', 'hidden');
    mirror.style.setProperty('pointer-events', 'none');

    const paddingLeft = parseFloat(computed.paddingLeft) || 0;
    const paddingRight = parseFloat(computed.paddingRight) || 0;
    const contentWidth = Math.max(0, textarea.clientWidth - paddingLeft - paddingRight);

    mirror.style.setProperty('box-sizing', 'content-box');
    mirror.style.setProperty('width', `${contentWidth}px`);
    mirror.style.setProperty('height', `${textarea.clientHeight}px`);

    const value = textarea.value;
    const caretIndex = textarea.selectionStart;
    const textBefore = value.substring(0, caretIndex);
    const nextChar = value.charAt(caretIndex) || '.';

    textNode.nodeValue = textBefore;
    marker.textContent = nextChar;

    const borderLeft = parseFloat(computed.borderLeftWidth) || 0;
    const borderTop = parseFloat(computed.borderTopWidth) || 0;
    const lineHeight = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) || 16;
    const left = rect.left + marker.offsetLeft + borderLeft - textarea.scrollLeft;
    const top = rect.top + marker.offsetTop + borderTop - textarea.scrollTop;

    return {
      left,
      top,
      height: lineHeight
    };
  }

  /**
   * Applies the candidate bar position near caret, clamping to narrow viewports.
   * @returns {void}
   */
  applyPosition() {
    if (!this.bar || !this.textarea) return;

    const win = this.doc.defaultView || window;
    const vw = win.innerWidth || 1024;
    const vh = win.innerHeight || 768;

    if (!this.cachedCaretRect) {
      this.cachedCaretRect = this.computeCaretPosition();
    }
    const pos = this.cachedCaretRect;

    const barWidth = this.bar.offsetWidth || 320;
    const barHeight = this.bar.offsetHeight || 38;

    let left = 10;
    let top = 10;

    if (pos && pos.left > 0 && pos.top > 0) {
      left = pos.left;
      top = pos.top + (pos.height || 22) + 6;

      // Clamp horizontal within viewport
      if (left + barWidth > vw - 10) {
        left = Math.max(10, vw - barWidth - 10);
      }
      if (left < 10) left = 10;

      // Flip above caret if overflowing bottom
      if (top + barHeight > vh - 10) {
        const flippedTop = pos.top - barHeight - 6;
        top = (flippedTop >= 10) ? flippedTop : Math.max(10, vh - barHeight - 10);
      }
    } else {
      // Fallback based on textarea bounding rect
      const rect = this.textarea.getBoundingClientRect();
      left = Math.max(10, Math.min(rect.left + 20, vw - barWidth - 10));
      top = Math.max(10, Math.min(rect.bottom - 50, vh - barHeight - 10));
    }

    this.bar.style.left = `${left}px`;
    this.bar.style.top = `${top}px`;
  }

  /**
   * Updates and renders candidate bar contents without array slicing.
   * @param {string} buffer
   * @param {readonly string[]} candidates
   * @param {number} pageIndex
   * @param {number} pageSize
   * @param {string} [message]
   * @returns {void}
   */
  render(buffer, candidates, pageIndex, pageSize, message = '') {
    if (!this.bar || !this.bufferSpan || !this.candList || !this.pageInfo || !this.status) return;

    if (!buffer) {
      this.hide();
      return;
    }

    this.bufferSpan.textContent = buffer;
    this.status.textContent = message;
    this.status.hidden = !message;

    const total = candidates.length;
    const start = pageIndex * pageSize;
    const end = Math.min(start + pageSize, total);
    const count = Math.max(0, end - start);

    if (count === 0) {
      if (this.emptySpan) this.emptySpan.style.display = '';
      for (let i = 0; i < 10; i++) {
        this.candItems[i].root.style.display = 'none';
      }
    } else {
      if (this.emptySpan) this.emptySpan.style.display = 'none';
      for (let i = 0; i < 10; i++) {
        const item = this.candItems[i];
        const candIdx = start + i;
        if (candIdx < end) {
          item.root.style.display = '';
          item.root.classList.toggle('boshiamy-primary-cand', i === 0);
          item.idx.textContent = String(i);
          item.char.textContent = candidates[candIdx];
        } else {
          item.root.style.display = 'none';
        }
      }
    }

    const totalPages = Math.ceil(total / pageSize);
    if (totalPages > 1) {
      this.pageInfo.textContent = `${pageIndex + 1}/${totalPages}`;
      this.pageInfo.style.display = 'inline-block';
    } else {
      this.pageInfo.textContent = '';
      this.pageInfo.style.display = 'none';
    }

    this.bar.style.display = 'flex';
    this.isVisible = true;

    // Apply cached position immediately or compute once
    this.applyPosition();
  }

  /**
   * Hides the candidate bar.
   * @returns {void}
   */
  hide() {
    if (this.rafId) {
      const win = this.doc.defaultView || window;
      win.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.isVisible = false;
    if (this.bar) {
      this.bar.style.display = 'none';
    }
    if (this.status) {
      this.status.textContent = '';
      this.status.hidden = true;
    }
  }

  /**
   * Rebinds UI and caret mirror to a new owner document (e.g. upon PiP adoption).
   * @param {HTMLTextAreaElement} textarea
   * @returns {void}
   */
  refreshDocument(textarea) {
    this._unbindListeners();
    this.hide();

    if (this.bar && this.bar.parentNode) {
      this.bar.parentNode.removeChild(this.bar);
    }
    if (this.mirror && this.mirror.parentNode) {
      this.mirror.parentNode.removeChild(this.mirror);
    }

    this.textarea = textarea;
    this.doc = textarea.ownerDocument || document;
    this.cachedCaretRect = null;

    this._initUI();
    this._bindListeners();
  }

  /**
   * Completely tears down UI, mirror, observers, and listeners.
   * @returns {void}
   */
  destroy() {
    this._unbindListeners();
    this.hide();

    if (this.bar && this.bar.parentNode) {
      this.bar.parentNode.removeChild(this.bar);
    }
    if (this.mirror && this.mirror.parentNode) {
      this.mirror.parentNode.removeChild(this.mirror);
    }

    this.bar = null;
    this.bufferSpan = null;
    this.candList = null;
    this.pageInfo = null;
    this.status = null;
    this.mirror = null;
    this.mirrorTextNode = null;
    this.mirrorMarker = null;
    this.candItems = [];
    this.emptySpan = null;
    this.cachedCaretRect = null;
  }
}
