/**
 * Markdown Read-Only Preview Module
 *
 * Provides a secure, GitHub-Flavored Markdown preview for the main editor textarea.
 * The textarea remains the single source of truth.
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
   * Helper: Escape HTML special characters for preserving raw tags as literal text
   */
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Helper: Validate whether an image URL is an explicit HTTPS absolute URL
   * Disallows relative paths, protocol-relative URLs, http, data, blob, file, javascript.
   */
  function isSafeHttpsImageUrl(href) {
    if (typeof href !== 'string') return false;
    const trimmed = href.trim();
    if (!/^https:\/\//i.test(trimmed)) return false;
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'https:' && Boolean(parsed.hostname);
    } catch (e) {
      return false;
    }
  }

  /**
   * Helper: Validate whether a link URL is safe (http, https, mailto, or safe fragment)
   * Disallows javascript, data, blob, file, vbscript, protocol-relative, etc.
   */
  function isSafeLinkUrl(href) {
    if (typeof href !== 'string') return false;
    const trimmed = href.trim();
    if (!trimmed) return false;

    // Safe in-page fragment identifier
    if (/^#[a-zA-Z0-9_\-.:%]*$/.test(trimmed)) {
      return true;
    }

    if (trimmed.startsWith('//')) {
      return false;
    }

    try {
      const parsed = new URL(trimmed);
      const proto = parsed.protocol.toLowerCase();
      return proto === 'https:' || proto === 'http:' || proto === 'mailto:';
    } catch (e) {
      return false;
    }
  }

  /**
   * Create isolated Marked instance with GFM and strict security renderer overrides
   */
  function createMarkedInstance() {
    const MarkedConstructor = global.marked && global.marked.Marked;
    if (typeof MarkedConstructor !== 'function') {
      throw new Error('Marked library not loaded');
    }

    const instance = new MarkedConstructor({
      gfm: true,
      breaks: false
    });

    instance.use({
      renderer: {
        // Token-based raw HTML escaping ensures embedded raw HTML tags display as literal text
        html(token) {
          const rawText = (token && (token.text || token.raw)) || '';
          return escapeHtml(rawText);
        },

        // Images: auto-load explicit HTTPS absolute URLs only; unsafe/relative/http display description+URL text without fetching.
        // URLs are filtered here BEFORE producing an <img> tag so no browser network request can occur.
        image(token) {
          const rawHref = (token && token.href ? token.href : '').trim();
          let altText = (token && token.text) || '';

          if (token && token.tokens && this.parser && typeof this.parser.parseInline === 'function') {
            altText = this.parser.parseInline(token.tokens, this.parser.textRenderer);
          }

          if (!isSafeHttpsImageUrl(rawHref)) {
            const desc = altText.trim();
            const fallbackText = desc ? `${desc} (${rawHref})` : rawHref;
            return `<span class="markdown-untrusted-image">${escapeHtml(fallbackText)}</span>`;
          }

          let out = `<img src="${escapeHtml(rawHref)}" alt="${escapeHtml(altText)}"`;
          if (token && token.title) {
            out += ` title="${escapeHtml(token.title)}"`;
          }
          out += ' loading="lazy" decoding="async">';
          return out;
        },

        // Links: safe links only (http/https/mailto/fragment); external links open in new tab with noopener/noreferrer
        link(token) {
          const rawHref = (token && token.href ? token.href : '').trim();
          let linkText = '';

          if (token && token.tokens && this.parser && typeof this.parser.parseInline === 'function') {
            linkText = this.parser.parseInline(token.tokens);
          } else {
            linkText = escapeHtml((token && token.text) || '');
          }

          if (!isSafeLinkUrl(rawHref)) {
            return linkText;
          }

          const isExternal = /^https?:\/\//i.test(rawHref);
          let out = `<a href="${escapeHtml(rawHref)}"`;
          if (token && token.title) {
            out += ` title="${escapeHtml(token.title)}"`;
          }
          if (isExternal) {
            out += ' target="_blank" rel="noopener noreferrer"';
          }
          out += `>${linkText}</a>`;
          return out;
        },

        // Task list checkboxes: disabled, readonly checkboxes only
        checkbox(token) {
          const isChecked = Boolean(token && token.checked);
          return `<input type="checkbox"${isChecked ? ' checked=""' : ''} disabled="" tabindex="-1"> `;
        }
      }
    });

    return instance;
  }

  let markedInstance = null;

  /**
   * DOMPurify sanitization configuration
   * Enforces narrow allowlist of tags and attributes, forbidding custom styles, scripts, iframes, SVG, DOM clobbering.
   */
  const DOMPURIFY_CONFIG = {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'blockquote', 'pre', 'code', 'hr', 'br',
      'ul', 'ol', 'li',
      'strong', 'b', 'em', 'i', 'del', 's', 'strike', 'span',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'a', 'img', 'input'
    ],
    ALLOWED_ATTR: [
      'href', 'title', 'target', 'rel',
      'src', 'alt', 'loading', 'decoding',
      'type', 'checked', 'disabled', 'tabindex', 'start',
      'align', 'class'
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#[a-zA-Z0-9_\-.:%]*$)/i,
    ALLOW_DATA_ATTR: false,
    // The URI policy must not treat these renderer-controlled values as URLs.
    ADD_URI_SAFE_ATTR: ['type', 'target', 'rel', 'loading', 'decoding', 'tabindex', 'align', 'start'],
    SANITIZE_DOM: true,
    KEEP_CONTENT: true,
    FORBID_TAGS: ['style', 'script', 'iframe', 'frame', 'object', 'embed', 'form', 'svg', 'math', 'base', 'meta', 'link'],
    FORBID_ATTR: ['style', 'id', 'name', 'action', 'formaction', 'srcdoc', 'xlink:href']
  };

  /**
   * Display user-facing error dialog on rendering failure
   */
  function showRenderError(err) {
    const message = (err && err.message) ? err.message : String(err || '無法解析 Markdown');
    if (typeof global.Swal !== 'undefined' && global.Swal && typeof global.Swal.fire === 'function') {
      try {
        global.Swal.fire({
          toast: true,
          position: 'bottom',
          icon: 'error',
          title: 'Markdown 預覽渲染失敗',
          text: message,
          showConfirmButton: false,
          timer: 4000
        });
        return;
      } catch (e) {
        // Fallback below
      }
    }
    if (typeof global.alert === 'function') {
      global.alert('Markdown 預覽渲染失敗: ' + message);
    }
  }

  /**
   * Check whether preview mode is currently active
   */
  function isEnabled() {
    return isPreviewActive;
  }

  /**
   * Enable Markdown Preview
   * Replaces textarea with read-only preview without modifying raw source.
   */
  function enable() {
    if (isEnabled()) return;
    if (!elements || !elements.note || !elements.previewSection || !elements.previewContent) {
      init();
      if (!elements || !elements.note || !elements.previewSection || !elements.previewContent) {
        return;
      }
    }

    // Save exact selection range and scroll positions from textarea
    savedSelectionStart = typeof elements.note.selectionStart === 'number' ? elements.note.selectionStart : 0;
    savedSelectionEnd = typeof elements.note.selectionEnd === 'number' ? elements.note.selectionEnd : 0;
    savedSelectionDirection = elements.note.selectionDirection;
    savedScrollTop = elements.note.scrollTop || 0;
    savedScrollLeft = elements.note.scrollLeft || 0;

    if (!markedInstance) {
      try {
        markedInstance = createMarkedInstance();
      } catch (err) {
        console.error('Failed to initialize Marked instance:', err);
        showRenderError(err);
        return;
      }
    }

    const rawMarkdown = elements.note.value || '';
    let cleanHtml = '';

    try {
      const rawParsed = markedInstance.parse(rawMarkdown);
      if (!global.DOMPurify || typeof global.DOMPurify.sanitize !== 'function') {
        throw new Error('安全清理程式尚未載入，請重新整理後再試。');
      }
      cleanHtml = global.DOMPurify.sanitize(rawParsed, DOMPURIFY_CONFIG);
    } catch (err) {
      console.error('Markdown preview render error:', err);
      // Rendering failure leaves plaintext intact and mode off with user error
      showRenderError(err);
      return;
    }

    // Clear and render ONLY content div, preserving preview toolbar and return control
    elements.previewContent.innerHTML = cleanHtml;

    // Reset preview scroll positions each enable
    elements.previewSection.scrollTop = 0;
    elements.previewSection.scrollLeft = 0;
    elements.previewContent.scrollTop = 0;
    elements.previewContent.scrollLeft = 0;

    isPreviewActive = true;

    if (elements.textareaContainer) {
      elements.textareaContainer.classList.add('markdown-preview-active');
    }
    elements.previewSection.classList.remove('hidden');

    if (elements.toggleButton) {
      elements.toggleButton.setAttribute('aria-pressed', 'true');
      elements.toggleButton.classList.add('active');
      elements.toggleButton.title = '切換為純文字編輯';
    }

    // Focus visible preview
    try {
      elements.previewSection.focus({ preventScroll: true });
    } catch (e) {
      elements.previewSection.focus();
    }
  }

  /**
   * Disable Markdown Preview
   * Restores textarea with exact source, selection, and scroll positions.
   *
   * @param {Object} [options]
   * @param {boolean} [options.contentChanged=false] - True if content was programmatically mutated;
   *                                                  exits without restoring old selection/scroll and focuses editor at start.
   */
  function disable(options) {
    if (!isEnabled()) return;

    const contentChanged = Boolean(options && options.contentChanged);
    isPreviewActive = false;

    if (elements && elements.textareaContainer) {
      elements.textareaContainer.classList.remove('markdown-preview-active');
    }
    if (elements && elements.previewSection) {
      elements.previewSection.classList.add('hidden');
    }
    if (elements && elements.toggleButton) {
      elements.toggleButton.setAttribute('aria-pressed', 'false');
      elements.toggleButton.classList.remove('active');
      elements.toggleButton.title = '啟用 Markdown 唯讀預覽';
    }

    // Clear rendered content div when disabled to free memory
    if (elements && elements.previewContent) {
      elements.previewContent.innerHTML = '';
    }

    if (!elements || !elements.note) return;

    if (contentChanged) {
      // Exit without restoring old selection/scroll; focus editor at start
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
      // Plain toggle disable restores source selection+scroll synchronously after focus preventScroll
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

  /**
   * Toggle Markdown Preview
   */
  function toggle() {
    if (isEnabled()) {
      disable({ contentChanged: false });
    } else {
      enable();
    }
  }

  /**
   * Focus visible preview if enabled, else textarea
   */
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

  /**
   * Initialize module and capture DOM references once to survive container adoption across windows
   */
  function init() {
    if (initialized && elements && elements.note && elements.previewSection) {
      return;
    }

    const note = document.getElementById('note');
    const textareaContainer = document.getElementById('textareaContainer');
    const previewSection = document.getElementById('markdownPreview');
    const previewContent = document.getElementById('markdownPreviewContent');
    const toggleButton = document.getElementById('markdownPreviewToggle');

    if (!note || !previewSection || !previewContent) {
      return;
    }

    // Capture DOM element references once
    elements = {
      note,
      textareaContainer: textareaContainer || note.parentElement,
      previewSection,
      previewContent,
      toggleButton
    };

    initialized = true;

    // Toggle button listener is managed by app.js loader/coordinator

    // Return to source control inside preview section: delegated listener on captured section
    elements.previewSection.addEventListener('click', function (e) {
      const sourceBtn = e.target && e.target.closest && e.target.closest('[data-markdown-source]');
      if (sourceBtn) {
        e.preventDefault();
        e.stopPropagation();
        disable({ contentChanged: false });
      }
    });

  }
  global.MarkdownPreview = {
    init,
    enable,
    disable,
    toggle,
    focus,
    isEnabled
  };

})(typeof window !== 'undefined' ? window : globalThis);
