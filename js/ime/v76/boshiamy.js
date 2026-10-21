/** Lightweight IME lifecycle; the dictionary is fetched and parsed only on enable. */
import { TextareaController } from './textarea-controller.js';

/** @typedef {import('./core.js').BoshiamyDictionary} Dictionary */
/** @typedef {'unloaded' | 'loading' | 'disabled' | 'enabled' | 'failed'} Phase */
/** @typedef {{phase: Phase, desiredEnabled: boolean}} ImeState */
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
    let destroyed = false;
    const publish = () => onStateChange?.({ phase, desiredEnabled });

    /** @param {boolean} enabled */
    async function setEnabled(enabled) {
        if (destroyed) throw new Error('Boshiamy instance has been destroyed');
        desiredEnabled = enabled;
        if (controller) {
            controller.setEnabled(enabled);
            phase = enabled ? 'enabled' : 'disabled';
            publish();
            return;
        }
        if (!enabled) {
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
                controller.setEnabled(desiredEnabled);
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
        cancel: () => controller?.cancel(),
        refreshDocument: () => controller?.refreshDocument(),
        destroy() {
            if (destroyed) return;
            destroyed = true;
            desiredEnabled = false;
            controller?.destroy();
            controller = null;
        }
    };
}
