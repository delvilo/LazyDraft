import Squire from 'squire-rte';
import type { SquireConfig } from 'squire-rte/dist/types/Editor';
import { cleanFragment, createMediaElement } from '../media.ts';
import type {
  EditorContext,
  EditorFactory,
  EditorHandle,
  FormatCommand,
  ImageSource,
  MediaSource,
} from '../contracts.ts';

function shimMediaInHTML(html: string): string {
  return html.replace(
    /<(video|audio)\b[\s\S]*?<\/\1>|<(video|audio)\b[^>]*\/?>/gi,
    (match) => {
      const encoded = encodeURIComponent(match);
      return `<figure data-squire-media-shim="true" data-squire-media-html="${encoded}"></figure>`;
    }
  );
}

function restoreMediaInRoot(root: HTMLElement): void {
  const shims = root.querySelectorAll<HTMLElement>('figure[data-squire-media-shim="true"]');
  for (const shim of Array.from(shims)) {
    const encoded = shim.getAttribute('data-squire-media-html');
    if (!encoded) continue;
    try {
      const raw = decodeURIComponent(encoded);
      const template = document.createElement('template');
      template.innerHTML = cleanFragment(raw);
      const element = template.content.firstElementChild;
      if (element instanceof HTMLVideoElement || element instanceof HTMLAudioElement) {
        shim.parentNode?.replaceChild(element, shim);
      } else {
        shim.remove();
      }
    } catch {
      shim.remove();
    }
  }
}

function toggleHeading(editor: Squire, level: number = 2): void {
  const headingTag = `H${level}`;
  const range = editor.getSelection();
  const root = editor.getRoot();
  const start = range.startContainer;
  const currentHeading = start instanceof Element
    ? start.closest('h1, h2, h3, h4, h5, h6')
    : start.parentElement?.closest('h1, h2, h3, h4, h5, h6');

  if (currentHeading && root.contains(currentHeading)) {
    editor.modifyBlocks((frag) => {
      const output = document.createDocumentFragment();
      if (frag.childNodes.length === 0) {
        output.appendChild(editor.createDefaultBlock());
        return output;
      }
      for (const child of Array.from(frag.childNodes)) {
        if (/^H[1-6]$/i.test(child.nodeName)) {
          const block = editor.createDefaultBlock();
          block.append(...Array.from(child.childNodes));
          output.appendChild(block);
        } else {
          output.appendChild(child);
        }
      }
      return output;
    });
  } else {
    editor.modifyBlocks((frag) => {
      const output = document.createDocumentFragment();
      if (frag.childNodes.length === 0) {
        const h = document.createElement(headingTag);
        h.appendChild(document.createElement('br'));
        output.appendChild(h);
        return output;
      }
      const hasBlocks = Array.from(frag.childNodes).some(
        (n) => n.nodeType === Node.ELEMENT_NODE && /^(DIV|P|H[1-6]|BLOCKQUOTE|PRE)$/i.test(n.nodeName)
      );
      if (hasBlocks) {
        for (const child of Array.from(frag.childNodes)) {
          if (child.nodeType === Node.ELEMENT_NODE && /^(DIV|P|H[1-6])$/i.test(child.nodeName)) {
            const h = document.createElement(headingTag);
            h.append(...Array.from(child.childNodes));
            output.appendChild(h);
          } else {
            output.appendChild(child);
          }
        }
      } else {
        const h = document.createElement(headingTag);
        h.append(...Array.from(frag.childNodes));
        output.appendChild(h);
      }
      return output;
    });
  }
}

function toggleCodeBlock(editor: Squire): void {
  const range = editor.getSelection();
  const root = editor.getRoot();
  const start = range.startContainer;
  const currentPre = start instanceof Element
    ? start.closest('pre')
    : start.parentElement?.closest('pre');

  if (currentPre && root.contains(currentPre)) {
    editor.modifyBlocks((frag) => {
      const output = document.createDocumentFragment();
      if (frag.childNodes.length === 0) {
        output.appendChild(editor.createDefaultBlock());
        return output;
      }
      for (const child of Array.from(frag.childNodes)) {
        if (child.nodeName.toUpperCase() === 'PRE') {
          const block = editor.createDefaultBlock();
          block.append(...Array.from(child.childNodes));
          output.appendChild(block);
        } else {
          output.appendChild(child);
        }
      }
      return output;
    });
  } else {
    editor.modifyBlocks((frag) => {
      const output = document.createDocumentFragment();
      if (frag.childNodes.length === 0) {
        const pre = document.createElement('pre');
        pre.appendChild(document.createElement('br'));
        output.appendChild(pre);
        return output;
      }
      const hasBlocks = Array.from(frag.childNodes).some(
        (n) => n.nodeType === Node.ELEMENT_NODE && /^(DIV|P|H[1-6]|BLOCKQUOTE|PRE)$/i.test(n.nodeName)
      );
      if (hasBlocks) {
        for (const child of Array.from(frag.childNodes)) {
          if (child.nodeType === Node.ELEMENT_NODE && /^(DIV|P|H[1-6]|BLOCKQUOTE)$/i.test(child.nodeName)) {
            const pre = document.createElement('pre');
            pre.append(...Array.from(child.childNodes));
            output.appendChild(pre);
          } else {
            output.appendChild(child);
          }
        }
      } else {
        const pre = document.createElement('pre');
        pre.append(...Array.from(frag.childNodes));
        output.appendChild(pre);
      }
      return output;
    });
  }
}

const createSquireEditor: EditorFactory = async (
  context: EditorContext
): Promise<EditorHandle> => {
  const container = document.createElement('div');
  container.className = 'squire-editor-container';
  container.style.minHeight = '360px';
  container.style.outline = 'none';
  container.style.padding = '12px';
  container.style.boxSizing = 'border-box';
  context.host.appendChild(container);

  const squireConfig: Partial<SquireConfig> = {
    blockTag: 'DIV',
    sanitizeToDOMFragment: (html: string) => {
      const cleaned = cleanFragment(html);
      const shimmed = shimMediaInHTML(cleaned);
      const template = document.createElement('template');
      template.innerHTML = shimmed;
      return document.importNode(template.content, true);
    },
    didError: (error: unknown) => {
      context.onError(error);
    }
  };

  const editor = new Squire(container, squireConfig);

  const safeSetHTML = (html: string): void => {
    editor.setHTML(html);
    restoreMediaInRoot(editor.getRoot());
    editor.saveUndoState();
  };

  if (context.initialSnapshot !== null) {
    safeSetHTML(context.initialSnapshot);
  }

  let savedRange: Range | null = null;

  const rememberSelection = (): void => {
    try {
      const range = editor.getSelection();
      if (range && editor.getRoot().contains(range.commonAncestorContainer)) {
        savedRange = range.cloneRange();
      }
    } catch {
      
    }
  };

  const restoreSelection = (): boolean => {
    if (!savedRange) return false;
    try {
      if (editor.getRoot().contains(savedRange.commonAncestorContainer)) {
        editor.setSelection(savedRange);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  };

  editor.addEventListener('undoStateChange', () => {
    restoreMediaInRoot(editor.getRoot());
  });

  editor.addEventListener('input', () => {
    restoreMediaInRoot(editor.getRoot());
    rememberSelection();
    context.onChange();
  });

  editor.addEventListener('select', () => {
    rememberSelection();
  });

  const handle: EditorHandle = {
    getSnapshot: (): string => {
      return editor.getHTML();
    },

    getHTML: (): string => {
      return cleanFragment(editor.getHTML());
    },

    command: (cmd: FormatCommand): void => {
      try {
        editor.focus();
        restoreSelection();

        switch (cmd.kind) {
          case 'bold':
            if (editor.hasFormat('B') || editor.hasFormat('STRONG')) {
              editor.removeBold();
            } else {
              editor.bold();
            }
            break;
          case 'italic':
            if (editor.hasFormat('I') || editor.hasFormat('EM')) {
              editor.removeItalic();
            } else {
              editor.italic();
            }
            break;
          case 'heading':
            toggleHeading(editor, 2);
            break;
          case 'bulletList':
            if (editor.hasFormat('UL')) {
              editor.removeList();
            } else {
              editor.makeUnorderedList();
            }
            break;
          case 'orderedList':
            if (editor.hasFormat('OL')) {
              editor.removeList();
            } else {
              editor.makeOrderedList();
            }
            break;
          case 'quote':
            if (editor.hasFormat('BLOCKQUOTE')) {
              editor.removeQuote();
            } else {
              editor.increaseQuoteLevel();
            }
            break;
          case 'codeBlock':
            toggleCodeBlock(editor);
            break;
          case 'undo':
            editor.undo();
            break;
          case 'redo':
            editor.redo();
            break;
          case 'link':
            if (cmd.url) {
              const range = editor.getSelection();
              if (range.collapsed) {
                const a = document.createElement('a');
                a.href = cmd.url;
                a.textContent = cmd.url;
                editor.insertElement(a);
              } else {
                editor.makeLink(cmd.url);
              }
            } else {
              editor.removeLink();
            }
            break;
          default: {
            const _exhaustive: never = cmd;
            context.onError(new Error(`Unhandled command kind: ${JSON.stringify(_exhaustive)}`));
            return;
          }
        }

        rememberSelection();
        context.onChange();
      } catch (error) {
        context.onError(error);
      }
    },

    rememberSelection: (): void => {
      rememberSelection();
    },

    insertImage: (image: ImageSource): void => {
      try {
        editor.focus();
        restoreSelection();
        editor.saveUndoState();
        editor.insertImage(image.src, { alt: image.alt });
        editor.saveUndoState();
        rememberSelection();
        context.onChange();
      } catch (error) {
        context.onError(error);
      }
    },

    insertMedia: (media: MediaSource): void => {
      try {
        editor.focus();
        restoreSelection();
        editor.saveUndoState();
        const mediaEl = createMediaElement(media);
        editor.insertElement(mediaEl);
        editor.saveUndoState();
        rememberSelection();
        context.onChange();
      } catch (error) {
        context.onError(error);
      }
    },

    focus: (): void => {
      editor.focus();
    },

    destroy: (): void => {
      try {
        editor.destroy();
      } catch {
        
      }
      if (container.parentElement === context.host) {
        context.host.removeChild(container);
      }
    },
  };

  return handle;
};

export default createSquireEditor;
