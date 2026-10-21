function getState(state) {
    return localStorage.getItem(state);
}

function setState(state, value) {
    localStorage.setItem(state, value);
}

function removeState(state) {
    localStorage.removeItem(state);
}

function selectById(id) {
    return $(`#${id}`);
}

function selectByClassName(className) {
    return $(`.${className}`);
}

function get(context) {
    return $(context);
}

function selector() {
    return {
        notepad: {
            clearNotes: selectById('clearNotes'),
            copyToClipboard: selectById('copyToClipboard'),
            downloadNotes: selectById('downloadNotes'),
            openLocalFile: selectById('openLocalFile'),
            localFileInput: selectById('localFileInput'),
            fontSize: selectById('fontSize'),
            fontWeight: selectById('fontWeight'),
            lineHeight: selectById('lineHeight'),
            texture: selectById('texture'),
            note: selectById('note'),
            preferencesModal: selectById('preferencesModal'),
            resetPreferences: selectById('resetPreferences'),
            showWordCountPill: selectById('showWordCountPill'),
            wordCountPref: selectById('wordCountPref'),
            boshiamyToggle: selectById('boshiamyToggle'),
            boshiamyImePref: selectById('boshiamyImePref'),
            voiceDictationToggle: selectById('voiceDictationToggle'),
            wordCount: selectById('wordCount'),
            wordCountContainer: selectByClassName('word-count-container'),
            keyboardShortcutsModal: selectById('keyboardShortcutsModal'),
            fullScreenButton: selectById('fullScreenButton'),
            optimalLineLength: selectById('optimalLineLength'),
            monospaced: selectById('monospaced'),
            shareNotes: selectById('shareNotes'),
            dyslexic: selectById('dyslexic'),
            spellCheck: selectById('spellCheck'),
            tabIndentation: selectById('tabIndentation'),
            voiceLang: selectById('voiceLang'),
            openTabbypadModalBtn: selectById('openTabbypadModalBtn'),
            tabbypadModal: selectById('tabbypadModal'),
            tabbypadSaveNewBtn: selectById('tabbypadSaveNewBtn'),
            tabbypadUpdateLinkedBtn: selectById('tabbypadUpdateLinkedBtn'),
            tabbypadSearchInput: selectById('tabbypadSearchInput'),
            tabbypadList: selectById('tabbypadList'),
            tabbypadStats: selectById('tabbypadStats'),
            tabbypadLinkedPill: selectById('tabbypadLinkedPill'),
            tabbypadPillTitle: selectById('tabbypadPillTitle'),
            tabbypadPillUpdateBtn: selectById('tabbypadPillUpdateBtn'),
            tabbypadPillUnlinkBtn: selectById('tabbypadPillUnlinkBtn'),
            bottomLine: selectByClassName('bottom-line'),
            focusModeButton: selectById('focusModeButton'),
            focusModeCloseButton: selectById('focusModeCloseButton'),
            serif: selectById('serif'),
        },
        state: {
            note: getState('note'),
            mode: getState('mode'),
            isUserPreferredTheme: getState('isUserPreferredTheme'),
            userChosenFontSize: getState('userChosenFontSize'),
            userChosenFontWeight: getState('userChosenFontWeight'),
            userChosenLineHeight: getState('userChosenLineHeight'),
            userChosenWordCountPillSelected: getState('userChosenWordCountPillSelected'),
            userChosenTexture: getState('userChosenTexture'),
            userChosenOptimalLineLengthSelected: getState('userChosenOptimalLineLengthSelected'),
            isMonospaced: getState('monospaced'),
            isDyslexic: getState('dyslexicFont'),
            isSerif: getState('serifFont'),
            userChosenSpellCheck: getState('userChosenSpellCheck'),
            userChosenTabIndentation: getState('userChosenTabIndentation'),
            userChosenBoshiamy: getState('userChosenBoshiamy'),
            userChosenVoiceLang: getState('userChosenVoiceLang'),
            selectedFont: getState('selectedFont')
        },
        defaultConfig: {
            defaultFontSize: 18,
            defaultLineHeight: 26,
            defaultFont: 'default',
            defaultFontWeight: 'normal',
            defaultShowWordCountPill: 'Yes',
            defaultTexture: 'normal',
            defaultOptimalLineLength: false,
            defaultOptimalLineLengthPadding: '15px 24px 80px',
            defaultSpellCheck: true,
            defaultTabIndentation: false,
            defaultBoshiamy: false,
            defaultVoiceLang: 'auto',
        },
        get,
        getState,
        setState,
        removeState,
        selectById,
        selectByClassName
    }
}