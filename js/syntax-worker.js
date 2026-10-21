/**
 * Syntax Highlighting Web Worker
 * Uses self-contained Prism.js bundle (Offline & CSP-safe)
 */
let loadError = null;
try {
    const origin = (self.location && self.location.origin) || '';
    const bundleUrl = origin + '/js/libraries/prism-bundle.js';
    self.importScripts(bundleUrl);
} catch (e) {
    loadError = (e && e.message) || String(e);
}

self.addEventListener('message', function (e) {
    const data = e.data;
    if (!data) return;

    const id = data.id;
    const text = data.text || '';
    const language = data.language || 'markup';

    if (loadError) {
        self.postMessage({ id: id, error: 'Prism bundle load error: ' + loadError });
        return;
    }
    if (!self.Prism || !self.Prism.languages) {
        self.postMessage({ id: id, error: 'Prism or languages undefined. typeof Prism=' + (typeof self.Prism) });
        return;
    }
    try {
        const grammar = self.Prism.languages[language];
        if (!grammar) {
            self.postMessage({ id: id, error: 'Unknown language: ' + language });
            return;
        }

        const highlighted = self.Prism.highlight(text, grammar, language);
        self.postMessage({
            id: id,
            language: language,
            highlighted: highlighted
        });
    } catch (err) {
        self.postMessage({
            id: id,
            error: (err && err.message) || String(err)
        });
    }
});
