import $ from 'jquery';
import icons from 'trumbowyg/dist/ui/icons.svg?raw';
import 'trumbowyg/dist/ui/trumbowyg.min.css';
import './trumbowyg.css';
import { cleanFragment, mediaHTML } from '../media.ts';
import type { EditorFactory, FormatCommand } from '../contracts.ts';

const createTrumbowyg: EditorFactory = async context => {
  const previousJQuery = window.jQuery;
  window.jQuery = $;
  try {
    await import('trumbowyg');
    await import('trumbowyg/dist/plugins/history/trumbowyg.history.js');
    await import('trumbowyg/dist/plugins/preformatted/trumbowyg.preformatted.js');
  } finally {
    if (previousJQuery) window.jQuery = previousJQuery;
    else delete window.jQuery;
  }

  const sprite = document.createElement('div');
  sprite.id = 'trumbowyg-icons';
  sprite.hidden = true;
  sprite.innerHTML = icons;
  context.host.append(sprite);
  const textarea = document.createElement('textarea');
  textarea.value = cleanFragment(context.initialSnapshot ?? '<p><br></p>');
  context.host.append(textarea);
  const target = $(textarea);
  let instance: TrumbowygInstance;
  let editor: HTMLElement;
  let liveRange: Range | null = null;
  let pendingRange: Range | null = null;
  let sourceMode = false;

  const captureRange = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.startContainer) && editor.contains(range.endContainer)) liveRange = range.cloneRange();
  };
  const rememberSelection = () => {
    captureRange();
    pendingRange = liveRange?.cloneRange() ?? null;
  };
  const restoreSelection = () => {
    const range = pendingRange ?? liveRange;
    pendingRange = null;
    editor.focus();
    if (range && editor.contains(range.startContainer) && editor.contains(range.endContainer)) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else {
      const end = document.createRange();
      end.selectNodeContents(editor);
      end.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(end);
    }
    instance.saveRange();
  };

  target.trumbowyg({
    svgPath: '',
    semantic: false,
    semanticKeepAttributes: true,
    tagsToKeep: ['img', 'video', 'audio', 'iframe', 'figure'],
    tagsToRemove: ['script', 'style', 'object', 'embed'],
    btns: [
      ['viewHTML'], ['historyUndo', 'historyRedo'], ['formatting'],
      ['strong', 'em', 'del'], ['unorderedList', 'orderedList'],
      ['link'], ['labImage', 'labMedia'], ['preformatted'], ['removeformat', 'fullscreen'],
    ],
    btnsDef: {
      labImage: { title: '插入本機圖片', ico: 'insertImage', fn: () => { rememberSelection(); context.pickImage(); } },
      labMedia: { title: '影音來源', ico: 'insertImage', fn: () => { rememberSelection(); context.requestMedia(); } },
    },
  });
  instance = target.data('trumbowyg');
  instance.btnsDef.viewHTML.fn = () => {
    if (sourceMode) {
      textarea.value = cleanFragment(textarea.value);
      instance.syncCode(true);
    }
    sourceMode = !sourceMode;
    instance.toggle();
    context.onChange();
  };
  const editable = instance.$ed.get(0);
  if (!(editable instanceof HTMLElement)) throw new Error('Trumbowyg editable element is unavailable');
  editor = editable;

  const changed = () => {
    captureRange();
    context.onChange();
  };
  const onInput = () => {
    instance.syncTextarea();
    target.trigger('tbwchange');
  };
  target.on('tbwchange.editorLab', changed);
  editor.addEventListener('input', onInput);
  textarea.addEventListener('input', changed);
  document.addEventListener('selectionchange', captureRange);
  const observer = new MutationObserver(changed);
  observer.observe(editor, { subtree: true, childList: true, characterData: true, attributes: true });

  const getSnapshot = (): string => {
    if (sourceMode) return textarea.value;
    instance.syncTextarea();
    const html = instance.html();
    if (typeof html !== 'string') throw new Error('Trumbowyg did not return HTML');
    return html;
  };
  const insertHTML = (html: string) => {
    restoreSelection();
    instance.execCmd('insertHTML', html);
    captureRange();
    changed();
  };
  const command = (action: FormatCommand) => {
    if (sourceMode) throw new Error('請先離開 HTML 原始碼模式，再使用格式或媒體操作。');
    restoreSelection();
    switch (action.kind) {
      case 'bold': instance.execCmd('bold'); break;
      case 'italic': instance.execCmd('italic'); break;
      case 'heading': instance.execCmd('formatBlock', 'h2'); break;
      case 'bulletList': instance.execCmd('insertUnorderedList'); break;
      case 'orderedList': instance.execCmd('insertOrderedList'); break;
      case 'quote': instance.execCmd('formatBlock', 'blockquote'); break;
      case 'codeBlock': instance.execCmd('formatBlock', 'pre'); break;
      case 'undo':
      case 'redo': {
        const name = action.kind === 'undo' ? 'historyUndo' : 'historyRedo';
        const operation = instance.btnsDef[name]?.fn;
        if (typeof operation !== 'function') throw new Error('Trumbowyg history plugin is unavailable');
        operation();
        break;
      }
      case 'link': {
        const anchor = document.createElement('a');
        anchor.href = action.url;
        anchor.textContent = action.url;
        if (window.getSelection()?.isCollapsed) instance.execCmd('insertHTML', cleanFragment(anchor.outerHTML));
        else instance.execCmd('createLink', action.url, false, true);
        break;
      }
    }
    changed();
  };

  return {
    getSnapshot,
    getHTML: () => cleanFragment(getSnapshot()),
    command,
    rememberSelection,
    insertImage: image => {
      if (sourceMode) throw new Error('請先離開 HTML 原始碼模式，再插入圖片。');
      const node = document.createElement('img');
      node.src = image.src;
      node.alt = image.alt;
      insertHTML(`${node.outerHTML}<p><br></p>`);
    },
    insertMedia: media => {
      if (sourceMode) throw new Error('請先離開 HTML 原始碼模式，再插入影音。');
      insertHTML(`<figure>${mediaHTML(media)}</figure><p><br></p>`);
    },
    focus: () => editor.focus(),
    destroy: () => {
      observer.disconnect();
      target.off('.editorLab');
      editor.removeEventListener('input', onInput);
      textarea.removeEventListener('input', changed);
      document.removeEventListener('selectionchange', captureRange);
      instance.destroy();
      sprite.remove();
      textarea.remove();
    },
  };
};

export default createTrumbowyg;
