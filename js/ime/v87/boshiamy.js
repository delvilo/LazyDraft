/** Lightweight IME lifecycle; the dictionary is fetched and parsed only on enable. */
import { TextareaController } from './textarea-controller.js';

/** @typedef {import('./core.js').BoshiamyDictionary} Dictionary */
/** @typedef {'unloaded' | 'loading' | 'disabled' | 'enabled' | 'failed'} Phase */
/** @typedef {'chinese' | 'english'} InputMode */
/** @typedef {{phase: Phase, desiredEnabled: boolean, inputMode: InputMode}} ImeState */
/** @typedef {{textarea: HTMLTextAreaElement, onStateChange?: (state: ImeState) => void, onError?: (error: Error) => void}} Options */

/** @type {Promise<Dictionary> | null} */
let dictionaryPromise = null;

/** Failed fetches are retryable; unlike rejected module imports, they do not poison the module map. */
function loadDictionary() {
    if (!dictionaryPromise) {
        dictionaryPromise = fetch(new URL('./boshiamy-dict.json', import.meta.url))
            .then(async response => {
                if (!response.ok) throw new Error(`嘸蝦米字典載入失敗（HTTP ${response.status}）`);
                return /** @type {Dictionary} */ (await response.json());
            }).catch(error => {
                dictionaryPromise = null;
                throw error;
            });
    }
    return dictionaryPromise;
}

/** @param {Options} options */
export function createBoshiamy({ textarea, onStateChange, onError }) {
    /** @type {TextareaController | null} */
    let controller = null;
    /** @type {Promise<void> | null} */
    let loading = null;
    /** @type {Phase} */
    let phase = 'unloaded';
    let desiredEnabled = false;
    /** @type {InputMode} */
    let inputMode = 'chinese';
    let destroyed = false;

    // Chord tracking state
    let ctrlDown = false;
    let altDown = false;
    let altIsRight = false;
    let chordArmed = false;
    let chordInvalid = false;
    let chordToggled = false;

    const doc = textarea ? (textarea.ownerDocument || (typeof document !== 'undefined' ? document : null)) : null;
    /** @type {Window | null} */
    let currentWindow = doc ? (doc.defaultView || (typeof window !== 'undefined' ? window : null)) : null;

    const publish = () => onStateChange?.({ phase, desiredEnabled, inputMode });

    function resetChord() {
        ctrlDown = false;
        altDown = false;
        altIsRight = false;
        chordArmed = false;
        chordInvalid = false;
        chordToggled = false;
    }

    function isEditableAndFocused() {
        if (!textarea) return false;
        if (textarea.disabled || textarea.readOnly) return false;
        const ownerDoc = textarea.ownerDocument || (typeof document !== 'undefined' ? document : null);
        if (!ownerDoc || ownerDoc.activeElement !== textarea) return false;
        return true;
    }

    /** @param {KeyboardEvent} e */
    function isAltGr(e) {
        if (typeof e.getModifierState === 'function' && e.getModifierState('AltGraph')) {
            return true;
        }
        if (e.key === 'AltGraph') {
            return true;
        }
        if (e.code === 'AltRight' && (e.ctrlKey || ctrlDown)) {
            return true;
        }
        return false;
    }

    function toggleMode() {
        inputMode = inputMode === 'chinese' ? 'english' : 'chinese';
        if (controller) {
            controller.cancel();
            controller.setEnabled(desiredEnabled && inputMode === 'chinese');
        }
        publish();
    }

    /** @param {KeyboardEvent} e */
    function onKeyDown(e) {
        if (destroyed) return;

        if (e.isComposing || e.keyCode === 229) {
            resetChord();
            return;
        }

        if (!isEditableAndFocused()) {
            resetChord();
            return;
        }

        if (phase === 'failed' || !desiredEnabled) {
            resetChord();
            return;
        }

        if (isAltGr(e)) {
            chordArmed = false;
            chordInvalid = true;
            return;
        }

        // Third key: Shift or Meta
        if (e.shiftKey || e.metaKey || e.key === 'Shift' || e.key === 'Meta') {
            chordArmed = false;
            chordInvalid = true;
            return;
        }

        const isCtrlKey = e.key === 'Control' || e.code === 'ControlLeft' || e.code === 'ControlRight';
        const isAltKey = e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight';
        if (!e.repeat && ((isCtrlKey && ctrlDown) || (isAltKey && altDown))) {
            chordArmed = false;
            chordInvalid = true;
            return;
        }

        if (isCtrlKey) {
            if (e.repeat) {
                if (!ctrlDown) {
                    chordInvalid = true;
                }
                return;
            }

            if (e.altKey && !altDown) {
                chordInvalid = true;
                return;
            }

            if (altDown && altIsRight) {
                chordArmed = false;
                chordInvalid = true;
                return;
            }

            ctrlDown = true;
            if (!chordInvalid && !chordToggled && altDown && !altIsRight) {
                chordArmed = true;
            }
            return;
        }

        if (isAltKey) {
            if (e.code === 'AltRight') {
                altIsRight = true;
                if (ctrlDown || e.ctrlKey) {
                    chordArmed = false;
                    chordInvalid = true;
                    return;
                }
            }

            if (e.repeat) {
                if (!altDown) {
                    chordInvalid = true;
                }
                return;
            }

            if (e.ctrlKey && !ctrlDown) {
                chordInvalid = true;
                return;
            }

            altDown = true;
            if (!chordInvalid && !chordToggled && ctrlDown && !altIsRight) {
                chordArmed = true;
            }
            return;
        }

        // Any other key while holding modifier(s) or during chord invalidates until both released
        chordArmed = false;
        chordInvalid = true;
    }

    /** @param {KeyboardEvent} e */
    function onKeyUp(e) {
        if (destroyed) return;

        if (!isEditableAndFocused() || phase === 'failed' || !desiredEnabled) {
            resetChord();
            return;
        }

        if (typeof e.getModifierState === 'function' && e.getModifierState('AltGraph')) {
            resetChord();
            return;
        }

        const isCtrlKey = e.key === 'Control' || e.code === 'ControlLeft' || e.code === 'ControlRight';
        const isAltKey = e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight';

        if (isCtrlKey) {
            const wasBothArmed = chordArmed && !chordInvalid && !chordToggled;
            ctrlDown = false;
            if (wasBothArmed) {
                chordToggled = true;
                chordArmed = false;
                toggleMode();
                e.preventDefault();
                e.stopPropagation();
            }
            if (!ctrlDown && !altDown) {
                resetChord();
            }
            return;
        }

        if (isAltKey) {
            const wasBothArmed = chordArmed && !chordInvalid && !chordToggled;
            altDown = false;
            altIsRight = false;
            if (wasBothArmed) {
                chordToggled = true;
                chordArmed = false;
                toggleMode();
                e.preventDefault();
                e.stopPropagation();
            }
            if (!ctrlDown && !altDown) {
                resetChord();
            }
            return;
        }

        if (!ctrlDown && !altDown) {
            resetChord();
        }
    }

    function onTextareaBlur() {
        resetChord();
    }

    function onWindowBlur() {
        resetChord();
    }

    function onCompositionStart() {
        resetChord();
    }

    if (textarea) {
        textarea.addEventListener('keydown', onKeyDown, true);
        textarea.addEventListener('keyup', onKeyUp, true);
        textarea.addEventListener('blur', onTextareaBlur);
        textarea.addEventListener('compositionstart', onCompositionStart);
    }
    if (currentWindow && typeof currentWindow.addEventListener === 'function') {
        currentWindow.addEventListener('blur', onWindowBlur);
    }

    /** @param {boolean} enabled */
    async function setEnabled(enabled) {
        if (destroyed) throw new Error('Boshiamy instance has been destroyed');
        if (enabled) {
            if (!desiredEnabled || phase === 'failed') {
                inputMode = 'chinese';
            }
            desiredEnabled = true;
        } else {
            desiredEnabled = false;
            resetChord();
        }

        if (controller) {
            controller.setEnabled(desiredEnabled && inputMode === 'chinese');
            phase = desiredEnabled ? 'enabled' : 'disabled';
            publish();
            return;
        }
        if (!desiredEnabled) {
            phase = loading ? 'loading' : 'unloaded';
            publish();
            return;
        }
        if (!loading) {
            phase = 'loading';
            publish();
            loading = loadDictionary().then(dictionary => {
                if (destroyed) return;
                controller = new TextareaController(textarea, dictionary);
                controller.setEnabled(desiredEnabled && inputMode === 'chinese');
                phase = desiredEnabled ? 'enabled' : 'disabled';
                publish();
            }).catch(error => {
                if (destroyed) return;
                phase = desiredEnabled ? 'failed' : 'unloaded';
                publish();
                if (desiredEnabled) onError?.(error instanceof Error ? error : new Error(String(error)));
            }).finally(() => { loading = null; });
        } else {
            publish();
        }
        await loading;
    }

    publish();
    return {
        setEnabled,
        toggle: () => setEnabled(phase === 'failed' || !desiredEnabled),
        cancel() {
            resetChord();
            controller?.cancel();
        },
        refreshDocument() {
            resetChord();
            controller?.refreshDocument();
            const nextDoc = textarea ? (textarea.ownerDocument || (typeof document !== 'undefined' ? document : null)) : null;
            const nextWindow = nextDoc ? (nextDoc.defaultView || (typeof window !== 'undefined' ? window : null)) : null;
            if (nextWindow !== currentWindow) {
                if (currentWindow && typeof currentWindow.removeEventListener === 'function') {
                    currentWindow.removeEventListener('blur', onWindowBlur);
                }
                currentWindow = nextWindow;
                if (currentWindow && typeof currentWindow.addEventListener === 'function') {
                    currentWindow.addEventListener('blur', onWindowBlur);
                }
            }
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            resetChord();
            desiredEnabled = false;
            if (currentWindow && typeof currentWindow.removeEventListener === 'function') {
                currentWindow.removeEventListener('blur', onWindowBlur);
                currentWindow = null;
            }
            if (textarea) {
                textarea.removeEventListener('keydown', onKeyDown, true);
                textarea.removeEventListener('keyup', onKeyUp, true);
                textarea.removeEventListener('blur', onTextareaBlur);
                textarea.removeEventListener('compositionstart', onCompositionStart);
            }
            controller?.destroy();
            controller = null;
        }
    };
}
