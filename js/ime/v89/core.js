/**
 * @fileoverview Pure Boshiamy (嘸蝦米) IME Core state machine.
 * Static native ES module with strict JSDoc, decoupled from DOM.
 */

/**
 * @typedef {Readonly<Record<string, readonly string[]>>} BoshiamyDictionary
 */
/** @typedef {import('./dictionary-table.js').IndexedDictionary} IndexedDictionary */
/** @typedef {BoshiamyDictionary | IndexedDictionary} DictionarySource */

/** @param {DictionarySource} dictionary @returns {dictionary is IndexedDictionary} */
function isIndexedDictionary(dictionary) {
  return typeof dictionary.lookup === 'function' && typeof dictionary.maxCodeLength === 'number';
}

/**
 * @typedef {Object} KeyStroke
 * @property {string} key
 * @property {string} [code]
 * @property {boolean} [ctrlKey]
 * @property {boolean} [altKey]
 * @property {boolean} [metaKey]
 * @property {boolean} [shiftKey]
 * @property {boolean} [isComposing]
 * @property {number} [keyCode]
 */

/**
 * @typedef {Object} KeyResult
 * @property {boolean} consume
 * @property {string | null} commit
 */

/** @type {readonly string[]} */
const EMPTY_CANDIDATES = Object.freeze([]);

/**
 * BoshiamyCore pure IME state machine.
 */
export class BoshiamyCore {
  /**
   * @param {DictionarySource} [dictionary]
   */
  constructor(dictionary = {}) {
    /** @type {DictionarySource} */
    this.dictionary = Object.freeze({});
    /** @type {number} */
    this.maxCodeLength = 0;
    /** @type {string} */
    this.buffer = '';
    /** @type {readonly string[]} */
    this.candidates = EMPTY_CANDIDATES;
    /** @type {number} */
    this.pageIndex = 0;
    /** @type {number} */
    this.pageSize = 10;
    /** @type {string} */
    this.message = '';

    this.setDictionary(dictionary);
  }

  /**
   * Sets the active dictionary, using its cached bound or recalculating it.
   * Preserves dictionary reference without copying.
   * @param {DictionarySource} [dictionary]
   * @returns {void}
   */
  setDictionary(dictionary) {
    this.dictionary = dictionary || Object.freeze({});
    let max = 0;
    if (isIndexedDictionary(this.dictionary)) max = this.dictionary.maxCodeLength;
    else {
      for (const key of Object.keys(this.dictionary)) {
        if (key.length > max) max = key.length;
      }
    }
    this.maxCodeLength = max;
    this.reset();
  }

  /** @private @param {string} code @returns {readonly string[]} */
  lookupCandidates(code) {
    if (isIndexedDictionary(this.dictionary)) return this.dictionary.lookup(code);
    return this.dictionary[code] || EMPTY_CANDIDATES;
  }

  /**
   * Resets active composition state.
   * @returns {void}
   */
  reset() {
    this.buffer = '';
    this.candidates = EMPTY_CANDIDATES;
    this.pageIndex = 0;
    this.message = '';
  }

  /**
   * Retrieves the candidate string for a given slot index on the current page.
   * @param {number} index Relative candidate slot index (0 to pageSize - 1).
   * @returns {string | null} Candidate string or null if not found.
   */
  candidate(index) {
    if (index < 0 || index >= this.pageSize) {
      return null;
    }
    const abs = this.pageIndex * this.pageSize + index;
    return this.candidates[abs] ?? null;
  }

  /**
   * Selects a candidate by its page-relative slot index (0 to pageSize - 1).
   * Note: Core does NOT clear the buffer on successful selection; the host clears on success.
   * @param {number} index
   * @returns {KeyResult}
   */
  select(index) {
    if (this.buffer.length === 0) {
      return { consume: false, commit: null };
    }
    const cand = this.candidate(index);
    if (cand != null) {
      return { consume: true, commit: cand };
    }
    this.message = '無此候選編號，請重新選字';
    return { consume: true, commit: null };
  }

  /**
   * Handles a key event or plain normalized key descriptor.
   * @param {KeyStroke} event
   * @returns {KeyResult}
   */
  handleKey(event) {
    if (!event || typeof event.key !== 'string') {
      return { consume: false, commit: null };
    }

    // Native composition bypass & invalidation
    if (event.isComposing || event.keyCode === 229) {
      this.reset();
      return { consume: false, commit: null };
    }

    const { key } = event;

    // Standalone modifier keys should never cancel pending composition
    if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta' || key === 'CapsLock') {
      return { consume: false, commit: null };
    }

    // Undo shortcut: Ctrl/Cmd + Z (without Shift or Alt)
    const isUndo = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
      (key === 'z' || key === 'Z' || event.code === 'KeyZ');
    if (isUndo) {
      if (this.buffer.length > 0) {
        this.reset();
        return { consume: true, commit: null };
      }
      return { consume: false, commit: null };
    }

    // Other modifier shortcuts: Ctrl, Alt, Meta
    if (event.ctrlKey || event.altKey || event.metaKey) {
      if (this.buffer.length > 0) {
        this.reset();
      }
      return { consume: false, commit: null };
    }

    // Escape: cancel current composition
    if (key === 'Escape') {
      if (this.buffer.length > 0) {
        this.reset();
        return { consume: true, commit: null };
      }
      return { consume: false, commit: null };
    }

    // Backspace: remove last radical
    if (key === 'Backspace') {
      if (this.buffer.length > 0) {
        this.buffer = this.buffer.slice(0, -1);
        this.pageIndex = 0;
        this.message = '';
        this.candidates = this.buffer ? this.lookupCandidates(this.buffer) : EMPTY_CANDIDATES;
        return { consume: true, commit: null };
      }
      return { consume: false, commit: null };
    }

    // Space & Enter: commit current page first candidate, or retain buffer with message if unknown code
    if (key === ' ' || event.code === 'Space' || key === 'Enter') {
      if (this.buffer.length > 0) {
        if (this.candidates.length > 0) {
          const firstCand = this.candidates[this.pageIndex * this.pageSize];
          if (firstCand != null) {
            return { consume: true, commit: firstCand };
          }
        }
        this.message = '無候選字，請按 Backspace 修正或 Esc 取消';
        return { consume: true, commit: null };
      }
      return { consume: false, commit: null };
    }

    // Candidate paging: ArrowDown / PageDown (next page)
    if (key === 'ArrowDown' || key === 'PageDown') {
      if (this.buffer.length > 0) {
        const totalPages = Math.max(1, Math.ceil(this.candidates.length / this.pageSize));
        if (this.pageIndex < totalPages - 1) {
          this.pageIndex++;
          this.message = '';
        }
        return { consume: true, commit: null };
      }
      return { consume: false, commit: null };
    }

    // Candidate paging: ArrowUp / PageUp (prev page)
    if (key === 'ArrowUp' || key === 'PageUp') {
      if (this.buffer.length > 0) {
        if (this.pageIndex > 0) {
          this.pageIndex--;
          this.message = '';
        }
        return { consume: true, commit: null };
      }
      return { consume: false, commit: null };
    }

    // Candidate selection digits 0-9
    if (/^[0-9]$/.test(key)) {
      if (this.buffer.length > 0) {
        return this.select(Number(key));
      }
      return { consume: false, commit: null };
    }

    // Non-IME editing / navigation keys cancel pending composition and pass through
    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End' || key === 'Delete' || key === 'Tab') {
      if (this.buffer.length > 0) {
        this.reset();
      }
      return { consume: false, commit: null };
    }

    // Radicals: lowercase letters (a-z) and symbols (, . ' [ ])
    if (/^[a-z,.'\[\]]$/.test(key)) {
      if (this.buffer.length < this.maxCodeLength) {
        this.buffer += key;
        this.candidates = this.lookupCandidates(this.buffer);
        this.pageIndex = 0;
        this.message = '';
      } else {
        this.message = `已達最大碼長 ${this.maxCodeLength}，請選字或按 Backspace 修正`;
      }
      return { consume: true, commit: null };
    }

    // Any other key while composing cancels composition and passes through
    if (this.buffer.length > 0) {
      this.reset();
    }
    return { consume: false, commit: null };
  }
}
