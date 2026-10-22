function loadScript(src) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
            if (existing.dataset.loaded === 'true') {
                resolve();
                return;
            }
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
            return;
        }
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => {
            s.dataset.loaded = 'true';
            resolve();
        };
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.body.appendChild(s);
    });
}

let swalLoadingPromise = null;
function ensureSwal() {
    if (typeof window.Sweetalert2 !== 'undefined') {
        return Promise.resolve();
    }
    if (swalLoadingPromise) {
        return swalLoadingPromise;
    }
    // Resolve readiness only: the SweetAlert2 constructor itself is thenable.
    swalLoadingPromise = loadScript('js/libraries/sweetalert2.all.min.js').then(() => {
        if (!window.Sweetalert2) throw new Error('SweetAlert2 did not initialize');
    }).catch(err => {
        swalLoadingPromise = null;
        console.error('Failed to lazy load SweetAlert2:', err);
        throw err;
    });
    return swalLoadingPromise;
}

// Transparent SweetAlert2 Proxy for load-on-demand
const Swal = new Proxy(function () {}, {
    apply(target, thisArg, args) {
        return ensureSwal().then(() => window.Sweetalert2.apply(thisArg, args));
    },
    get(target, prop) {
        if (typeof window.Sweetalert2 !== 'undefined' && window.Sweetalert2) {
            const value = window.Sweetalert2[prop];
            return typeof value === 'function' ? value.bind(window.Sweetalert2) : value;
        }
        if (prop === 'fire') {
            return function (...args) {
                return ensureSwal().then(() => window.Sweetalert2.fire(...args));
            };
        }
        if (prop === 'DismissReason') {
            return Object.freeze({
                cancel: 'cancel',
                backdrop: 'backdrop',
                close: 'close',
                esc: 'esc',
                timer: 'timer'
            });
        }
        if (prop === 'isVisible') {
            return function () {
                return typeof window.Sweetalert2 !== 'undefined' && window.Sweetalert2.isVisible ? window.Sweetalert2.isVisible() : false;
            };
        }
        if (prop === 'close') {
            return function (...args) {
                if (typeof window.Sweetalert2 !== 'undefined' && window.Sweetalert2.close) {
                    window.Sweetalert2.close(...args);
                }
            };
        }
        return function (...args) {
            return ensureSwal().then(() => {
                const realSwal = window.Sweetalert2;
                if (typeof realSwal[prop] === 'function') {
                    return realSwal[prop].apply(realSwal, args);
                }
                return realSwal[prop];
            });
        };
    }
});
window.Swal = Swal;
window.swal = Swal;
window.ensureSwal = ensureSwal;
window.loadScript = loadScript;

function getFileName(text = '') {
    const firstLine = String(text).split(/[\r\n]/, 1)[0].trim();
    return (firstLine || 'Notes-' + getCurrentDate()) + '.txt';
}
function getCurrentDate() {
    const currentDate = new Date();

    return currentDate.getDate() + '-' + (currentDate.getMonth() + 1) + '-' + currentDate.getFullYear();
}

function showToast(message, ownerDocument = document) {
    let toast = ownerDocument.getElementById('toast');
    if (!toast) {
        toast = ownerDocument.createElement('div');
        toast.id = 'toast';
        ownerDocument.body.appendChild(toast);
    }
    toast.setAttribute('role', 'status');
    toast.className = 'show';
    toast.innerHTML = message;
    
    setTimeout(function () {
        toast.className = toast.className.replace('show', '');
    }, 2000);
}

function debounce(func, wait, immediate) {
    let timeout;
    return function () {
        let context = this;
        let args = arguments;
        let later = function () {
            timeout = null;
            if (!immediate) {
                func.apply(context, args);
            }
        };

        let callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) {
            func.apply(context, args);
        }
    };
}

function saveTextAsFile(textToWrite, fileNameToSaveAs) {
    let textFileAsBlob = new Blob([textToWrite], { type: 'text/plain' });
    let downloadLink = document.createElement('a');
    downloadLink.download = fileNameToSaveAs;
    downloadLink.href = window.URL.createObjectURL(textFileAsBlob);
    downloadLink.style.display = 'none';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    setTimeout(() => {
        if (downloadLink.parentNode) {
            document.body.removeChild(downloadLink);
        }
        window.URL.revokeObjectURL(downloadLink.href);
    }, 100);
}

function getPWADisplayMode() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

    if (document.referrer.startsWith('android-app://')) {
        return 'twa';
    } else if (navigator.standalone || isStandalone) {
        return 'standalone';
    }

    return 'browser';
}

function syncTextareaContainerTheme() {
    const isDark = document.body ? document.body.classList.contains('dark') : false;
    const container = document.getElementById('textareaContainer') || window._appTextareaContainer;
    if (container) {
        container.classList.toggle('dark', isDark);
    }
}
window.syncTextareaContainerTheme = syncTextareaContainerTheme;

function enableDarkMode(lightmodeText, darkMetaColor, metaThemeColor) {
    $(document.body).addClass('dark');
    syncTextareaContainerTheme();
    $('.navbar').removeClass('navbar-default');
    $('#mode').attr('title', lightmodeText);
    $('#themeIcon').attr('src', 'img/navbar/light-theme.svg');
    metaThemeColor.setAttribute('content', darkMetaColor);
    localStorage.setItem('mode', 'dark');
}

function enableLightMode(darkmodeText, lightMetaColor, metaThemeColor) {
    $(document.body).removeClass('dark');
    syncTextareaContainerTheme();
    $('.navbar').addClass('navbar-default');
    $('#mode').attr('title', darkmodeText);
    $('#themeIcon').attr('src', 'img/navbar/dark-theme.svg');
    metaThemeColor.setAttribute('content', lightMetaColor);
    localStorage.setItem('mode', 'light');
}

function enableDeviceTheme(themeConfig) {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        enableDarkMode(themeConfig.lightmodeText, themeConfig.darkMetaColor, themeConfig.metaThemeColor)
    } else {
        enableLightMode(themeConfig.darkmodeText, themeConfig.lightMetaColor, themeConfig.metaThemeColor)
    }

    localStorage.setItem('mode', 'device');
}

function resetFontSize(defaultFontSize) {
    $('#note').css('font-size', defaultFontSize + "px");
    $('#fontSize').val(defaultFontSize);
}

function resetLineHeight(defaultLineHeight) {
    $('#note').css('line-height', defaultLineHeight + "px");
    $('#lineHeight').val(defaultLineHeight);
}

function resetFontWeight(defaultFontWeight) {
    $('#note').css('font-weight', defaultFontWeight);
    $('#fontWeight').val(defaultFontWeight);
}

function resetShowWordCountPill(defaultShowWordCountPill) {
    defaultShowWordCountPill === 'Yes' ? $('.word-count-container').show() : $('.word-count-container').hide();
    $('#showWordCountPill').prop('checked', defaultShowWordCountPill === 'Yes');
}


function resetTexture(defaultTexture) {
    $(document.body).removeClass('dotted-paper');
    $(document.body).removeClass('graph-paper');
    $(document.body).removeClass('chessboard-paper');
    $(document.body).removeClass('starfield-paper');
    $(document.body).removeClass('grain-paper');
    $(document.body).removeClass('linen-paper');
    $(document.body).removeClass('recycled-paper');
    $(document.body).removeClass('newspaper-paper');
    $(document.body).removeClass('marble-paper');
    $('#texture').val(defaultTexture);
}

function resetFont(defaultFont) {
    $('#note').removeClass('dyslexic monospaced serif handwritten humanist pixel typewriter crayon');
    $('#font').val(defaultFont);
}

function resetOptimalLineLength(defaultEditorPadding, defaultOption) {
    const textArea = document.getElementById('note');
    textArea.style.padding = defaultEditorPadding;
    $('#optimalLineLength').prop('checked', defaultOption);
}

/**
 * Counts Unicode code points, Han characters, and English words separately.
 * Whitespace contributes only to the total; internal apostrophes/hyphens join English words.
 * @param {string} str
 * @returns {{ characters: number, chinese: number, english: number }}
 */
function countText(str) {
    let characters = 0;
    let chinese = 0;
    let english = 0;
    const hanCharacter = /[\p{Unified_Ideograph}〇]/u;
    for (const character of str) {
        characters++;
        if (hanCharacter.test(character)) chinese++;
    }
    for (const match of str.matchAll(/[a-z]+(?:['’\-\u2010\u2011][a-z]+)*/gi)) {
        english++;
    }
    return { characters, chinese, english };
}

function calculateCharactersAndWords(str) {
    const { characters, chinese, english } = countText(str);
    return `共 ${characters} 字元 · 中文 ${chinese} 字 · 英文 ${english} 詞`;
}


function copyNotesToClipboard(note) {
    navigator.clipboard.writeText(note).then(function () {
        Swal.fire({
            toast: true,
            position: 'bottom',
            icon: 'success',
            title: 'Notes copied to clipboard!',
            showConfirmButton: false,
            timer: 2000,
            customClass: {
                popup: 'swal-toast-bottom-offset'
            }
        });
    }, function () {
        Swal.fire({
            toast: true,
            position: 'bottom',
            icon: 'error',
            title: 'Fail to copy. Check permissions for clipboard.',
            showConfirmButton: false,
            timer: 2000,
            customClass: {
                popup: 'swal-toast-bottom-offset'
            }
        });
    });
}

function toggleTheme({
    lightmodeText, 
    darkmodeText, 
    lightMetaColor, 
    darkMetaColor, 
    metaThemeColor
}) {
    get(document.body).toggleClass('dark');
    let bodyClass = get(document.body).attr('class');

    if (bodyClass === 'dark') {
        enableDarkMode(lightmodeText, darkMetaColor, metaThemeColor)
    } else {
        enableLightMode(darkmodeText, lightMetaColor, metaThemeColor)
    }

    setState('isUserPreferredTheme', 'true');
}

function deleteNotes() {
    const { notepad } = selector();
    
    Swal.fire({
        title: 'Want to delete notes?',
        text: "You won't be able to revert this!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Yes, Delete!',
        cancelButtonText: 'No, keep it.'
    }).then((result) => {
        if (result.value || result.isConfirmed) {
            const currentContent = notepad.note.val() || '';
            // Auto-backup to Tabbypad before clearing to prevent accidental data loss
            if (currentContent.trim() && window.TabbypadStorage && typeof window.TabbypadStorage.createNote === 'function') {
                window.TabbypadStorage.createNote(currentContent).catch(err => {
                    console.warn('[Clear Notes] Backup to Tabbypad failed:', err);
                });
            }
            try {
                setState('note', '');
            } catch (err) {
                Swal.fire({
                    type: 'error',
                    icon: 'error',
                    title: '清空失敗',
                    text: '無法清除儲存內容，原草稿已保留。'
                });
                return;
            }

            notepad.note.val('').focus();
            notepad.note[0].dispatchEvent(new Event('input', { bubbles: true }));
            updateWordCountPill('');
            if (window.MarkdownPreview && typeof window.MarkdownPreview.disable === 'function') {
                window.MarkdownPreview.disable({ contentChanged: true });
            }
            if (window.HtmlPreview && typeof window.HtmlPreview.disable === 'function') {
                window.HtmlPreview.disable({ contentChanged: true });
            }
            Swal.fire(
                'Deleted!',
                'Your notes has been deleted.',
                'success'
            )
        }
    })
}

let focusModeHoverTimer = null;

function toggleFocusMode(notepad) {
    const navbar = document.querySelector('.navbar');
    const bodyElement = document.body;
    const textArea = document.getElementById('note');
    const closeButton = document.getElementById('focusModeCloseButton');
    
    // Check if focus mode is currently active
    const isFocusMode = document.documentElement.hasAttribute('data-focus-mode');
    
    if (!isFocusMode) {
        // Entering focus mode
        document.documentElement.setAttribute('data-focus-mode', 'true');
        navbar.style.display = 'none';
        bodyElement.style.paddingTop = '0';
        textArea.style.borderRight = 'none';
        textArea.style.borderLeft = 'none';
        
        // Show close button
        closeButton.style.display = 'block';

        // Hide toast popup
        const toastPopup = document.querySelector('.toast-popup');
        if (toastPopup) {
            toastPopup.classList.remove('show');
        }
        
        notepad.bottomLine.hide();

        // Keep focus on preview if active, else textarea
        if (window.MarkdownPreview && typeof window.MarkdownPreview.focus === 'function' && window.MarkdownPreview.isEnabled()) {
            window.MarkdownPreview.focus();
        } else if (window.HtmlPreview && typeof window.HtmlPreview.focus === 'function' && window.HtmlPreview.isEnabled()) {
            window.HtmlPreview.focus();
        } else {
            textArea.focus();
        }
    } else {
        // Exiting focus mode
        turnOffFocusMode(notepad);
    }
}

// a function for turning off focus mode
function turnOffFocusMode(notepad) {
    const navbar = document.querySelector('.navbar');
    const bodyElement = document.body;
    const textArea = document.getElementById('note');
    const closeButton = document.getElementById('focusModeCloseButton');
    
    // Remove focus mode
    document.documentElement.removeAttribute('data-focus-mode');
    
    // Hide close button
    closeButton.style.display = 'none';
    
    // Reset styles
    navbar.style.display = '';
    bodyElement.style.paddingTop = '';
    textArea.style.borderRight = '';
    textArea.style.borderLeft = '';
    
    if (localStorage.getItem('userChosenWordCountPillSelected') === 'Yes' || selector().defaultConfig.defaultShowWordCountPill === 'Yes') {
        notepad.bottomLine.show();
    }

    // Keep focus on preview if active, else textarea
    if (window.MarkdownPreview && typeof window.MarkdownPreview.focus === 'function' && window.MarkdownPreview.isEnabled()) {
        window.MarkdownPreview.focus();
    } else if (window.HtmlPreview && typeof window.HtmlPreview.focus === 'function' && window.HtmlPreview.isEnabled()) {
        window.HtmlPreview.focus();
    } else {
        textArea.focus();
    }
}

function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
        $('#arrowPointsOut').hide();
        $('#arrowPointsIn').show();
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
            $('#arrowPointsIn').hide();
            $('#arrowPointsOut').show();
        }
    }
}

function shareNotes(textToShare) {
    if (navigator.share) {
        navigator.share({
            text: textToShare,
            url: window.location.href,
        })
        .then( () => console.log("Successful share"))
        .catch(e => console.log("Error sharing:", e))
    }
}

function updateWordCountPill (note = '') {
    // The editor container may have been adopted into a floating document.
    const counter = window._appTextareaContainer?.querySelector('#wordCount')
        || document.getElementById('wordCount');
    if (counter) counter.textContent = calculateCharactersAndWords(note);
}
