/**
 * Live Syntax Highlighting Coordinator
 * Coordinates background parsing, metrics synchronization, and load-on-demand Prism execution.
 */
(function (global) {
  'use strict';

  const STORAGE_LANG_KEY = 'userChosenSyntaxLang';
  const MAX_HIGHLIGHT_SIZE = 1024 * 1024; // 1 MiB boundary

  const SUPPORTED_LANGUAGES = {
    html: { label: 'HTML', prism: 'markup', extensions: ['html', 'htm', 'css'] },
    php: { label: 'PHP', prism: 'php', extensions: ['php'] },
    javascript: { label: 'JavaScript', prism: 'javascript', extensions: ['js', 'mjs', 'cjs'] },
    typescript: { label: 'TypeScript', prism: 'typescript', extensions: ['ts'] },
    python: { label: 'Python', prism: 'python', extensions: ['py'] },
    json: { label: 'JSON', prism: 'json', extensions: ['json'] },
    bash: { label: 'Bash', prism: 'bash', extensions: ['sh', 'bash'] },
    yaml: { label: 'YAML', prism: 'yaml', extensions: ['yaml', 'yml'] }
  };

  let elements = null;
  let initialized = false;
  let isSyntaxActive = false;
  let currentLang = 'html';
  let worker = null;
  let requestId = 0;
  let recolorTimeout = null;
  let resizeObserver = null;

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getPrismGrammar(langKey, text = '') {
    if (langKey === 'html') {
      // If the content is purely CSS without HTML tags, dispatch to Prism's CSS grammar
      // so selectors and declarations are perfectly highlighted.
      const hasHtmlTags = /<[a-z!/][\s\S]*>/i.test(text);
      const looksLikeCss = /[{}:;]/.test(text) && !hasHtmlTags;
      if (looksLikeCss) {
        return 'css';
      }
      return 'markup';
    }
    const info = SUPPORTED_LANGUAGES[langKey] || SUPPORTED_LANGUAGES.html;
    return info.prism;
  }

  function syncMetrics() {
    if (!elements || !elements.note || !elements.backdrop || !elements.layer) return;

    const textarea = elements.note;
    const computed = window.getComputedStyle(textarea);

    elements.layer.style.fontFamily = computed.fontFamily;
    elements.layer.style.fontSize = computed.fontSize;
    elements.layer.style.fontWeight = computed.fontWeight;
    elements.layer.style.lineHeight = computed.lineHeight;
    elements.layer.style.letterSpacing = computed.letterSpacing;
    elements.layer.style.paddingTop = computed.paddingTop;
    elements.layer.style.paddingRight = computed.paddingRight;
    elements.layer.style.paddingBottom = computed.paddingBottom;
    elements.layer.style.paddingLeft = computed.paddingLeft;
    elements.layer.style.borderTopWidth = computed.borderTopWidth;
    elements.layer.style.borderRightWidth = computed.borderRightWidth;
    elements.layer.style.borderBottomWidth = computed.borderBottomWidth;
    elements.layer.style.borderLeftWidth = computed.borderLeftWidth;
    elements.layer.style.borderStyle = 'solid';
    elements.layer.style.borderColor = 'transparent';
    elements.layer.style.boxSizing = computed.boxSizing;

    elements.backdrop.scrollTop = textarea.scrollTop;
    elements.backdrop.scrollLeft = textarea.scrollLeft;
  }

  function syncScroll() {
    if (!elements || !elements.note || !elements.backdrop) return;
    elements.backdrop.scrollTop = elements.note.scrollTop;
    elements.backdrop.scrollLeft = elements.note.scrollLeft;
  }

  function initWorker() {
    if (worker) return worker;
    try {
      worker = new Worker('js/syntax-worker.js');
      worker.onmessage = function (e) {
        const data = e.data;
        if (!data || data.id !== requestId) return; // Discard stale worker responses

        if (data.error) {
          console.warn('Syntax worker error:', data.error);
          return;
        }

        if (elements && elements.layer && isSyntaxActive) {
          elements.layer.innerHTML = data.highlighted + '\n';
          syncScroll();
        }
      };
      worker.onerror = function (err) {
        console.error('Syntax worker initialization failed:', err);
      };
    } catch (e) {
      console.warn('Worker creation failed, fallback to main-thread Prism:', e);
      worker = null;
    }
    return worker;
  }

  function triggerRecolor() {
    if (!isSyntaxActive || !elements || !elements.note || !elements.layer) return;

    const text = elements.note.value || '';
    syncMetrics();

    // Size boundary check
    if (text.length > MAX_HIGHLIGHT_SIZE) {
      elements.layer.textContent = text + '\n';
      if (typeof global.Swal !== 'undefined' && global.Swal && !elements.sizeWarned) {
        elements.sizeWarned = true;
        global.Swal.fire({
          toast: true,
          position: 'bottom',
          icon: 'info',
          title: '文件超過 1 MiB，保持純文字編輯以確保流暢度',
          showConfirmButton: false,
          timer: 3000
        });
      }
      return;
    }

    // While recoloring is pending, display the current text uncolored to prevent stale display
    elements.layer.textContent = text + '\n';
    syncScroll();

    clearTimeout(recolorTimeout);
    recolorTimeout = setTimeout(() => {
      requestId++;
      const reqId = requestId;
      const prismLang = getPrismGrammar(currentLang, text);

      const w = initWorker();
      if (w) {
        w.postMessage({
          id: reqId,
          text: text,
          language: prismLang
        });
      } else if (global.Prism && global.Prism.languages[prismLang]) {
        // Synchronous fallback if worker blocked
        try {
          const out = global.Prism.highlight(text, global.Prism.languages[prismLang], prismLang);
          if (reqId === requestId && isSyntaxActive) {
            elements.layer.innerHTML = out + '\n';
            syncScroll();
          }
        } catch (e) {
          elements.layer.textContent = text + '\n';
        }
      }
    }, 40); // 40ms debounce for live typing responsiveness
  }

  function isEnabled() {
    return isSyntaxActive;
  }

  function enable() {
    if (isSyntaxActive) return;
    isSyntaxActive = true;

    if (elements && elements.container) {
      elements.container.classList.add('syntax-active');
    }
    if (elements && elements.toggleBtn) {
      elements.toggleBtn.setAttribute('aria-pressed', 'true');
      elements.toggleBtn.classList.add('active');
      elements.toggleBtn.title = '關閉程式碼語法標亮';
      const parent = elements.toggleBtn.closest('.syntax-controls-container');
      if (parent) parent.classList.add('active');
    }

    initWorker();
    syncMetrics();
    triggerRecolor();
  }

  function disable() {
    if (!isSyntaxActive) return;
    isSyntaxActive = false;

    clearTimeout(recolorTimeout);

    if (elements && elements.container) {
      elements.container.classList.remove('syntax-active');
    }
    if (elements && elements.toggleBtn) {
      elements.toggleBtn.setAttribute('aria-pressed', 'false');
      elements.toggleBtn.classList.remove('active');
      elements.toggleBtn.title = '啟用程式碼語法標亮';
      const parent = elements.toggleBtn.closest('.syntax-controls-container');
      if (parent) parent.classList.remove('active');
    }
    if (elements && elements.layer) {
      elements.layer.textContent = '';
    }
  }

  function toggle() {
    if (isSyntaxActive) {
      disable();
    } else {
      enable();
    }
  }

  function setLanguage(langKey) {
    if (!SUPPORTED_LANGUAGES[langKey]) return;
    currentLang = langKey;
    localStorage.setItem(STORAGE_LANG_KEY, langKey);

    if (elements && elements.langSelect) {
      elements.langSelect.value = langKey;
    }

    if (isSyntaxActive) {
      triggerRecolor();
    }
  }

  function getLanguage() {
    return currentLang;
  }

  function detectLanguageFromFilename(filename) {
    if (typeof filename !== 'string') return null;
    const name = filename.toLowerCase();
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';

    for (const [lang, info] of Object.entries(SUPPORTED_LANGUAGES)) {
      if (info.extensions.includes(ext)) {
        return lang;
      }
    }
    return null;
  }

  function onFileImported(filename) {
    const detected = detectLanguageFromFilename(filename);
    if (detected) {
      setLanguage(detected);
      // If syntax is active, recolor immediately with new language; if inactive, keep language ready without enabling
    } else {
      // Unsupported format: disable syntax highlighting
      if (isSyntaxActive) {
        disable();
      }
    }
  }

  function init() {
    if (initialized) return;

    const note = document.getElementById('note');
    const container = document.getElementById('textareaContainer');
    const backdrop = document.getElementById('syntaxBackdrop');
    const layer = document.getElementById('syntaxHighlightLayer');
    const toggleBtn = document.getElementById('syntaxToggleBtn');
    const langSelect = document.getElementById('syntaxLangSelect');

    if (!note || !container || !backdrop || !layer) return;

    elements = {
      note,
      container,
      backdrop,
      layer,
      toggleBtn,
      langSelect,
      sizeWarned: false
    };

    initialized = true;

    // Restore saved language preference (Syntax starts off)
    // Migrate legacy 'css' preference to unified 'html'
    let savedLang = localStorage.getItem(STORAGE_LANG_KEY);
    if (savedLang === 'css') {
      savedLang = 'html';
      localStorage.setItem(STORAGE_LANG_KEY, 'html');
    }
    if (savedLang && SUPPORTED_LANGUAGES[savedLang]) {
      currentLang = savedLang;
    }
    if (elements.langSelect) {
      elements.langSelect.value = currentLang;
      elements.langSelect.addEventListener('change', function () {
        setLanguage(this.value);
      });
    }

    // Toggle button listener
    if (elements.toggleBtn) {
      elements.toggleBtn.addEventListener('click', function (e) {
        e.preventDefault();
        toggle();
      });
    }

    // Real-time synchronization listeners
    note.addEventListener('input', function () {
      if (isSyntaxActive) triggerRecolor();
    });

    note.addEventListener('scroll', syncScroll);

    window.addEventListener('resize', syncMetrics);

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        syncMetrics();
      });
      resizeObserver.observe(note);
    }
  }

  global.SyntaxHighlighter = {
    init,
    enable,
    disable,
    toggle,
    isEnabled,
    setLanguage,
    getLanguage,
    onFileImported,
    triggerRecolor,
    syncMetrics
  };

})(typeof window !== 'undefined' ? window : globalThis);
