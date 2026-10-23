/**
 * @fileoverview Boshiamy IME Textarea Controller.
 * Manages synchronous edit transactions, native composition bypass,
 * selection/pointer/blur/mutation tracking, and owner-document adoption.
 */

import { BoshiamyCore } from './core.js';
import { CandidateView } from './candidate-view.js';

/**
 * @typedef {import('./core.js').DictionarySource} BoshiamyDictionary
 */

export class TextareaController {
  /**
   * @param {HTMLTextAreaElement} textarea
   * @param {BoshiamyDictionary} [dictionary]
   */
  constructor(textarea, dictionary = {}) {
    /** @type {HTMLTextAreaElement} */
    this.textarea = textarea;
    /** @type {BoshiamyCore} */
    this.core = new BoshiamyCore(dictionary);
    /** @type {boolean} */
    this.enabled = false;
    /** @type {boolean} */
    this.isCommitting = false;
    /** @type {boolean} */
    this.isComposing = false;
    /** @type {number} */
    this.generation = 0;

    /** @type {string} */
    this.baselineValue = textarea ? textarea.value : '';
    /** @type {number} */
    this.baselineSelectionStart = textarea ? textarea.selectionStart : 0;
    /** @type {number} */
    this.baselineSelectionEnd = textarea ? textarea.selectionEnd : 0;

    /** @type {Document} */
    this.ownerDoc = textarea ? (textarea.ownerDocument || document) : document;

    /** @type {CandidateView} */
    this.view = new CandidateView(textarea, (idx) => this.selectCandidate(idx));

    // Bound event listeners
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPaste = this._onPaste.bind(this);
    this._onDrop = this._onDrop.bind(this);
    this._onInput = this._onInput.bind(this);
    this._onCompositionStart = this._onCompositionStart.bind(this);
    this._onCompositionEnd = this._onCompositionEnd.bind(this);
    this._onSelectionChange = this._onSelectionChange.bind(this);

    /** @type {MutationObserver | null} */
    this._observer = null;

    this._bindTextareaListeners();
    this._bindDocumentListeners();
    this._initObserver();
  }

  /**
   * @private
   */
  _bindTextareaListeners() {
    if (!this.textarea) return;
    this.textarea.addEventListener('keydown', this._onKeyDown, true);
    this.textarea.addEventListener('blur', this._onBlur);
    this.textarea.addEventListener('pointerdown', this._onPointerDown);
    this.textarea.addEventListener('paste', this._onPaste);
    this.textarea.addEventListener('drop', this._onDrop);
    this.textarea.addEventListener('input', this._onInput);
    this.textarea.addEventListener('compositionstart', this._onCompositionStart);
    this.textarea.addEventListener('compositionend', this._onCompositionEnd);
  }

  /**
   * @private
   */
  _unbindTextareaListeners() {
    if (!this.textarea) return;
    this.textarea.removeEventListener('keydown', this._onKeyDown, true);
    this.textarea.removeEventListener('blur', this._onBlur);
    this.textarea.removeEventListener('pointerdown', this._onPointerDown);
    this.textarea.removeEventListener('paste', this._onPaste);
    this.textarea.removeEventListener('drop', this._onDrop);
    this.textarea.removeEventListener('input', this._onInput);
    this.textarea.removeEventListener('compositionstart', this._onCompositionStart);
    this.textarea.removeEventListener('compositionend', this._onCompositionEnd);
  }

  /**
   * @private
   */
  _bindDocumentListeners() {
    if (this.ownerDoc) {
      this.ownerDoc.addEventListener('selectionchange', this._onSelectionChange);
    }
  }

  /**
   * @private
   */
  _unbindDocumentListeners() {
    if (this.ownerDoc) {
      this.ownerDoc.removeEventListener('selectionchange', this._onSelectionChange);
    }
  }

  /**
   * Observes readonly and disabled attribute mutations on textarea to cancel composition.
   * @private
   */
  _initObserver() {
    if (typeof MutationObserver !== 'undefined' && this.textarea) {
      this._observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && (m.attributeName === 'readonly' || m.attributeName === 'disabled')) {
            if (this.textarea.readOnly || this.textarea.disabled) {
              this.cancel();
            }
          }
        }
      });
      this._observer.observe(this.textarea, {
        attributes: true,
        attributeFilter: ['readonly', 'disabled']
      });
    }
  }

  /**
   * Captures baseline value and selection coordinates before composition begins.
   * @private
   */
  _syncBaseline() {
    if (!this.textarea) return;
    this.baselineValue = this.textarea.value;
    this.baselineSelectionStart = this.textarea.selectionStart;
    this.baselineSelectionEnd = this.textarea.selectionEnd;
  }

  /**
   * Verifies that external programmatic mutation did not alter textarea value or selection directly.
   * @private
   * @returns {boolean} True if external mutation was detected and composition cancelled.
   */
  _checkExternalMutation() {
    if (this.core.buffer.length > 0 && this.textarea) {
      if (
        this.textarea.value !== this.baselineValue ||
        this.textarea.selectionStart !== this.baselineSelectionStart ||
        this.textarea.selectionEnd !== this.baselineSelectionEnd
      ) {
        this.cancel();
        return true;
      }
    }
    return false;
  }

  /**
   * Enables or disables the IME controller.
   * @param {boolean} enabled
   * @returns {void}
   */
  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) {
      this.isComposing = false;
      this.cancel();
    }
  }

  /**
   * Cancels active composition without affecting document content.
   * @returns {void}
   */
  cancel() {
    this.generation++;
    this.core.reset();
    this.view.hide();
    this._syncBaseline();
  }

  /**
   * Synchronizes view UI with core state.
   * @returns {void}
   */
  updateView() {
    if (!this.enabled || !this.core.buffer) {
      this.view.hide();
      return;
    }
    this.view.render(
      this.core.buffer,
      this.core.candidates,
      this.core.pageIndex,
      this.core.pageSize,
      this.core.message
    );
  }

  /**
   * Commits text natively via document.execCommand('insertText').
   * Snapshots composition before execution and clears core synchronously.
   * Restores snapshot only on genuine failure without newer generation or external changes.
   * @param {string} text
   * @returns {boolean}
   */
  commitText(text) {
    if (!this.textarea || !text) return false;
    const el = this.textarea;
    const doc = el.ownerDocument || document;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const oldVal = el.value;
    const selectedText = oldVal.slice(start, end);
    const isReplacingSameText = (selectedText === text);

    // Snapshot composition fields before clearing core
    const snapshot = {
      buffer: this.core.buffer,
      candidates: this.core.candidates,
      pageIndex: this.core.pageIndex,
      message: this.core.message
    };

    const commitGen = ++this.generation;

    // Clear core synchronously before execCommand (view stays visible until result)
    this.core.reset();

    this.isCommitting = true;
    let inserted = false;

    try {
      el.focus();
      if (typeof el.setSelectionRange === 'function') {
        el.setSelectionRange(start, end);
      }
      inserted = doc.execCommand('insertText', false, text);
    } catch (err) {
      inserted = false;
    } finally {
      this.isCommitting = false;
    }

    const didInsert = inserted || (el.value !== oldVal) ||
      (isReplacingSameText && el.selectionStart === start + text.length && el.selectionEnd === start + text.length);

    if (didInsert) {
      // Insertion succeeded: hide view and sync baseline if no reentrant composition started
      if (this.generation === commitGen) {
        this.view.hide();
        this.view.invalidateGeometry();
        this._syncBaseline();
      }
      return true;
    } else {
      // Genuine failure: restore snapshot ONLY without newer generation or external doc changes
      if (this.generation === commitGen && el.value === oldVal) {
        this.core.buffer = snapshot.buffer;
        this.core.candidates = snapshot.candidates;
        this.core.pageIndex = snapshot.pageIndex;
        this.core.message = '輸入失敗，請重新選字';
        this.updateView();
      }
      return false;
    }
  }

  /**
   * Selects a candidate by its page-relative index (0-9).
   * @param {number} slotIndex
   * @returns {void}
   */
  selectCandidate(slotIndex) {
    if (!this.enabled || this.textarea.readOnly || this.textarea.disabled) return;
    if (this._checkExternalMutation()) return;
    if (this.core.buffer.length === 0) return;

    const result = this.core.select(slotIndex);
    if (result.commit != null) {
      this.commitText(result.commit);
    } else {
      this.updateView();
    }
  }

  /**
   * Handles keydown event from textarea.
   * Core owns key policy; controller delegates without duplicate policy checks.
   * @private
   * @param {KeyboardEvent} e
   */
  _onKeyDown(e) {
    if (!this.enabled || this.textarea.readOnly || this.textarea.disabled) return;

    if (this.isComposing || e.isComposing || e.keyCode === 229) {
      this.cancel();
      return;
    }

    if (this._checkExternalMutation()) {
      return;
    }

    // Capture baseline when transitioning from empty to composing
    if (this.core.buffer.length === 0) {
      this._syncBaseline();
    }

    const prevBuffer = this.core.buffer;
    const result = this.core.handleKey(e);

    if (result.consume) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (result.commit != null) {
      this.commitText(result.commit);
    } else {
      if (this.core.buffer !== prevBuffer) {
        this.generation++;
      }
      this.updateView();
    }
  }

  /**
   * @private
   */
  _onSelectionChange() {
    if (this.isCommitting) return;
    if (this.textarea.ownerDocument.activeElement === this.textarea) {
      if (this.core.buffer.length > 0) {
        if (this.textarea.selectionStart !== this.baselineSelectionStart ||
            this.textarea.selectionEnd !== this.baselineSelectionEnd) {
          this.cancel();
        }
      }
      this.view.invalidateGeometry();
    }
  }

  /**
   * @private
   */
  _onInput() {
    if (this.isCommitting) return;
    if (this.core.buffer.length > 0) {
      this.cancel();
    }
    this._syncBaseline();
    this.view.invalidateGeometry();
  }

  /**
   * @private
   */
  _onPointerDown() {
    if (this.isCommitting) return;
    if (this.core.buffer.length > 0) {
      this.cancel();
    }
  }

  /**
   * @private
   */
  _onBlur() {
    this.isComposing = false;
    if (this.isCommitting) return;
    this.cancel();
  }

  /**
   * @private
   */
  _onPaste() {
    if (this.isCommitting) return;
    this.cancel();
  }

  /**
   * @private
   */
  _onDrop() {
    if (this.isCommitting) return;
    this.cancel();
  }

  /**
   * @private
   */
  _onCompositionStart() {
    this.isComposing = true;
    this.cancel();
  }

  /**
   * @private
   */
  _onCompositionEnd() {
    this.isComposing = false;
  }

  /**
   * Rebinds owner-document listeners and candidate view when textarea is adopted
   * into a new document (such as Document Picture-in-Picture window).
   * @returns {void}
   */
  refreshDocument() {
    this.isComposing = false;
    this.cancel();
    this._unbindDocumentListeners();
    this.ownerDoc = this.textarea ? (this.textarea.ownerDocument || document) : document;
    this.view.refreshDocument(this.textarea);
    this._bindDocumentListeners();
  }

  /**
   * Destroys controller and cleans up all listeners and DOM elements.
   * @returns {void}
   */
  destroy() {
    this.isComposing = false;
    this.cancel();
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    this._unbindTextareaListeners();
    this._unbindDocumentListeners();
    this.view.destroy();
  }
}
