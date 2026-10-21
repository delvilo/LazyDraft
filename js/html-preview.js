/**
 * HTML Read-Only Preview Module
 *
 * Provides a sandboxed, static HTML+CSS preview for the main editor textarea.
 * The textarea remains the single source of truth.
 *
 * Rules:
 * - Script execution blocked: no JS, no event handlers, no javascript: URIs.
 * - Form submission blocked: forms cannot submit, inputs are disabled.
 * - Links: display styled links, but navigation is disabled (cannot navigate/redirect).
 * - External resources: HTTPS absolute images, CSS, fonts allowed. HTTP/relative/protocol-relative blocked.
 * - Base tag removed: cannot rewrite relative resolution base.
 * - Preserves original HTML appearance: default white background with dark text.
 */
(function (global) {
  'use strict';

  let elements = null;
  let initialized = false;
  let isPreviewActive = false;

  let savedSelectionStart = 0;
  let savedSelectionEnd = 0;
  let savedSelectionDirection = 'none';
  let savedScrollTop = 0;
  let savedScrollLeft = 0;

  /**
   * Helper: Check whether a URL is an explicit HTTPS absolute URL
   */
  function isHttpsAbsoluteUrl(url) {
    if (typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!/^https:\/\//i.test(trimmed)) return false;
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'https:' && Boolean(parsed.hostname);
    } catch (e) {
      return false;
    }
  }

  /**
   * DOMPurify sanitization configuration for static HTML+CSS preview
   */
  const HTML_PURIFY_CONFIG = {
    WHOLE_DOCUMENT: true,
    ALLOWED_TAGS: [
      'html', 'head', 'body', 'meta', 'title', 'style',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'blockquote', 'pre', 'code', 'hr', 'br',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'strong', 'b', 'em', 'i', 'del', 's', 'strike', 'span', 'small', 'sub', 'sup',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
      'a', 'img', 'figure', 'figcaption',
      'div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main',
      'details', 'summary', 'fieldset', 'legend', 'label', 'input', 'button', 'select', 'textarea',
      'link'
    ],
    ALLOWED_ATTR: [
      'href', 'title', 'target', 'rel',
      'src', 'alt', 'loading', 'decoding', 'width', 'height',
      'type', 'checked', 'disabled', 'readonly', 'tabindex', 'aria-hidden', 'aria-label',
      'align', 'valign', 'class', 'style', 'color', 'bgcolor', 'border', 'cellpadding', 'cellspacing',
      'colspan', 'rowspan', 'media'
    ],
    ALLOWED_URI_REGEXP: /^https:/i,
    ALLOW_DATA_ATTR: false,
    SANITIZE_DOM: true,
    KEEP_CONTENT: true,
    FORBID_TAGS: ['script', 'iframe', 'frame', 'object', 'embed', 'form', 'base', 'video', 'audio', 'source', 'track', 'applet'],
    FORBID_ATTR: ['action', 'formaction', 'srcdoc', 'xlink:href', 'manifest']
  };

  /**
   * Display user-facing error dialog on rendering failure
   */
  function showRenderError(err) {
    const message = (err && err.message) ? err.message : String(err || '無法解析 HTML');
    if (typeof global.Swal !== 'undefined' && global.Swal && typeof global.Swal.fire === 'function') {
      try {
        global.Swal.fire({
          toast: true,
          position: 'bottom',
          type: 'error',
          title: 'HTML 預覽渲染失敗',
          text: message,
          showConfirmButton: false,
          timer: 4000
        });
        return;
      } catch (e) {}
    }
    if (typeof global.alert === 'function') {
      global.alert('HTML 預覽渲染失敗: ' + message);
    }
  }

  /**
   * Clean and build the sandboxed document for the iframe srcdoc
   */
  function buildCleanHtmlDocument(rawHtml) {
    if (!global.DOMPurify || typeof global.DOMPurify.sanitize !== 'function') {
      throw new Error('安全清理程式尚未載入，請重新整理後再試。');
    }

    // First pass sanitize with full document preservation
    const cleanHtml = global.DOMPurify.sanitize(rawHtml, HTML_PURIFY_CONFIG);

    // Parse sanitized DOM to enforce HTTPS-only external resources & disable interactive forms/links
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanHtml, 'text/html');

    // Remove any base tags
    doc.querySelectorAll('base').forEach(el => el.remove());

    // Enforce HTTPS on <link rel="stylesheet">
    doc.querySelectorAll('link[rel="stylesheet"]').forEach(el => {
      const href = el.getAttribute('href') || '';
      if (!isHttpsAbsoluteUrl(href)) {
        el.remove();
      }
    });

    // Enforce HTTPS on <img> src
    doc.querySelectorAll('img').forEach(el => {
      const src = el.getAttribute('src') || '';
      if (!isHttpsAbsoluteUrl(src)) {
        const alt = el.getAttribute('alt') || '';
        const fallback = document.createElement('span');
        fallback.className = 'html-untrusted-image';
        fallback.textContent = alt ? `[圖片未載入: ${alt}]` : '[未載入非 HTTPS 圖片]';
        fallback.style.cssText = 'display:inline-block;padding:2px 6px;border:1px dashed #f87171;color:#b91c1c;font-size:12px;border-radius:3px;';
        el.replaceWith(fallback);
      } else {
        el.setAttribute('loading', 'lazy');
        el.setAttribute('decoding', 'async');
      }
    });

    // Enforce non-navigating links: disable click navigation
    doc.querySelectorAll('a').forEach(el => {
      el.removeAttribute('target');
      // Set href to javascript:void(0) or preserve visual style while preventing navigation
      el.setAttribute('data-original-href', el.getAttribute('href') || '');
      el.setAttribute('href', '#');
      el.style.pointerEvents = 'none';
      el.style.cursor = 'default';
    });

    // Disable all form inputs/buttons
    doc.querySelectorAll('input, button, select, textarea').forEach(el => {
      el.setAttribute('disabled', 'disabled');
      el.setAttribute('tabindex', '-1');
    });

    // Add baseline isolation styling inside iframe: default white background, dark text, reset link cursors
    const isolationStyle = doc.createElement('style');
    isolationStyle.textContent = `
      :root {
        color-scheme: light;
      }
      html, body {
        background-color: #ffffff !important;
        color: #24292f !important;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        line-height: 1.5;
        margin: 0;
        padding: 16px;
        box-sizing: border-box;
        word-break: break-word;
      }
      a {
        pointer-events: none !important;
        cursor: default !important;
      }
    `;
    doc.head.insertBefore(isolationStyle, doc.head.firstChild);

    return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  }

  function isEnabled() {
    return isPreviewActive;
  }

  function enable() {
    if (isEnabled()) return;
    if (!elements || !elements.note || !elements.previewSection || !elements.previewFrame) {
      init();
      if (!elements || !elements.note || !elements.previewSection || !elements.previewFrame) {
        return;
      }
    }

    // Save exact selection range and scroll positions from textarea
    savedSelectionStart = typeof elements.note.selectionStart === 'number' ? elements.note.selectionStart : 0;
    savedSelectionEnd = typeof elements.note.selectionEnd === 'number' ? elements.note.selectionEnd : 0;
    savedSelectionDirection = elements.note.selectionDirection || 'none';
    savedScrollTop = elements.note.scrollTop || 0;
    savedScrollLeft = elements.note.scrollLeft || 0;

    const rawHtml = elements.note.value || '';
    let finalDocHtml = '';

    try {
      finalDocHtml = buildCleanHtmlDocument(rawHtml);
    } catch (err) {
      console.error('HTML preview build error:', err);
      showRenderError(err);
      return;
    }

    // Set sandboxed iframe srcdoc
    elements.previewFrame.srcdoc = finalDocHtml;

    isPreviewActive = true;

    if (elements.textareaContainer) {
      elements.textareaContainer.classList.add('html-preview-active');
    }
    elements.previewSection.classList.remove('hidden');

    if (elements.toggleButton) {
      elements.toggleButton.setAttribute('aria-pressed', 'true');
      elements.toggleButton.classList.add('active');
      elements.toggleButton.title = '切換為純文字編輯';
    }

    try {
      elements.previewSection.focus({ preventScroll: true });
    } catch (e) {
      elements.previewSection.focus();
    }
  }

  function disable(options) {
    if (!isEnabled()) return;

    const contentChanged = Boolean(options && options.contentChanged);
    isPreviewActive = false;

    if (elements && elements.textareaContainer) {
      elements.textareaContainer.classList.remove('html-preview-active');
    }
    if (elements && elements.previewSection) {
      elements.previewSection.classList.add('hidden');
    }
    if (elements && elements.toggleButton) {
      elements.toggleButton.setAttribute('aria-pressed', 'false');
      elements.toggleButton.classList.remove('active');
      elements.toggleButton.title = '啟用 HTML 唯讀預覽';
    }

    // Clear iframe srcdoc to release memory
    if (elements && elements.previewFrame) {
      elements.previewFrame.srcdoc = 'about:blank';
    }

    if (!elements || !elements.note) return;

    if (contentChanged) {
      try {
        elements.note.focus({ preventScroll: true });
      } catch (e) {
        elements.note.focus();
      }
      try {
        elements.note.setSelectionRange(0, 0);
      } catch (e) {
        elements.note.selectionStart = 0;
        elements.note.selectionEnd = 0;
      }
      elements.note.scrollTop = 0;
      elements.note.scrollLeft = 0;
    } else {
      try {
        elements.note.focus({ preventScroll: true });
      } catch (e) {
        elements.note.focus();
      }
      try {
        elements.note.setSelectionRange(savedSelectionStart, savedSelectionEnd, savedSelectionDirection);
      } catch (e) {
        elements.note.selectionStart = savedSelectionStart;
        elements.note.selectionEnd = savedSelectionEnd;
      }
      elements.note.scrollTop = savedScrollTop;
      elements.note.scrollLeft = savedScrollLeft;
    }
  }

  function toggle() {
    if (isEnabled()) {
      disable({ contentChanged: false });
    } else {
      enable();
    }
  }

  function focus() {
    if (isEnabled() && elements && elements.previewSection) {
      try {
        elements.previewSection.focus({ preventScroll: true });
      } catch (e) {
        elements.previewSection.focus();
      }
    } else if (elements && elements.note) {
      try {
        elements.note.focus({ preventScroll: true });
      } catch (e) {
        elements.note.focus();
      }
    }
  }

  function init() {
    if (initialized && elements && elements.note && elements.previewSection) {
      return;
    }

    const note = document.getElementById('note');
    const textareaContainer = document.getElementById('textareaContainer');
    const previewSection = document.getElementById('htmlPreviewSection');
    const previewFrame = document.getElementById('htmlPreviewFrame');
    const toggleButton = document.getElementById('htmlPreviewToggle');

    if (!note || !previewSection || !previewFrame) {
      return;
    }

    elements = {
      note,
      textareaContainer: textareaContainer || note.parentElement,
      previewSection,
      previewFrame,
      toggleButton
    };

    initialized = true;

    // Return to source control inside preview section
    elements.previewSection.addEventListener('click', function (e) {
      const sourceBtn = e.target && e.target.closest && e.target.closest('[data-html-source]');
      if (sourceBtn) {
        e.preventDefault();
        e.stopPropagation();
        disable({ contentChanged: false });
      }
    });
  }

  global.HtmlPreview = {
    init,
    enable,
    disable,
    toggle,
    focus,
    isEnabled
  };

})(typeof window !== 'undefined' ? window : globalThis);
