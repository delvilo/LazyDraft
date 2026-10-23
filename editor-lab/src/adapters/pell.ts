import pell from 'pell';
import 'pell/dist/pell.css';
import { cleanFragment, mediaHTML } from '../media.ts';
import type {
  EditorContext,
  EditorFactory,
  EditorHandle,
  FormatCommand,
  ImageSource,
  MediaSource,
} from '../contracts.ts';

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isInsideTag(root: HTMLElement, ...tagNames: string[]): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  let el: Element | null = range.commonAncestorContainer instanceof Element
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  const lowerTags = tagNames.map((t) => t.toLowerCase());
  while (el && el !== root && root.contains(el)) {
    if (lowerTags.includes(el.tagName.toLowerCase())) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

function validateLinkUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Link URL cannot be empty');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid link URL: "${raw}"`);
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'mailto:' && protocol !== 'tel:') {
    throw new Error(`Unsupported link protocol: "${parsed.protocol}". Only http:, https:, mailto:, and tel: are allowed.`);
  }
  return parsed.href;
}

const createPellEditor: EditorFactory = async (
  context: EditorContext
): Promise<EditorHandle> => {
  const container = document.createElement('div');
  container.className = 'pell';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  context.host.appendChild(container);

  let savedRange: Range | null = null;
  let pendingRange: Range | null = null;
  let isRestoring = true;

  const rememberSelection = (): void => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (content && content.contains(range.commonAncestorContainer)) {
        savedRange = range.cloneRange();
      }
    }
  };

  const restoreSelection = (): boolean => {
    const range = pendingRange ?? savedRange;
    pendingRange = null;
    content.focus();
    const sel = window.getSelection();
    if (!range || !sel || !content.contains(range.commonAncestorContainer)) return false;
    sel.removeAllRanges();
    sel.addRange(range);
    savedRange = range;
    return true;
  };

  const pellInstance = pell.init({
    element: container,
    defaultParagraphSeparator: 'p',
    onChange: () => {
      if (isRestoring) return;
      rememberSelection();
      context.onChange();
    },
    actions: [
      'bold',
      'italic',
      'underline',
      'strikethrough',
      {
        name: 'heading1',
        result: () => {
          restoreSelection();
          if (isInsideTag(content, 'h1')) {
            document.execCommand('formatBlock', false, '<p>');
          } else {
            document.execCommand('formatBlock', false, '<h1>');
          }
          rememberSelection();
          context.onChange();
        },
      },
      {
        name: 'heading2',
        result: () => {
          restoreSelection();
          if (isInsideTag(content, 'h2')) {
            document.execCommand('formatBlock', false, '<p>');
          } else {
            document.execCommand('formatBlock', false, '<h2>');
          }
          rememberSelection();
          context.onChange();
        },
      },
      'paragraph',
      {
        name: 'quote',
        result: () => {
          restoreSelection();
          if (isInsideTag(content, 'blockquote')) {
            document.execCommand('formatBlock', false, '<p>');
          } else {
            document.execCommand('formatBlock', false, '<blockquote>');
          }
          rememberSelection();
          context.onChange();
        },
      },
      'olist',
      'ulist',
      {
        name: 'code',
        result: () => {
          restoreSelection();
          if (isInsideTag(content, 'pre')) {
            document.execCommand('formatBlock', false, '<p>');
          } else {
            document.execCommand('formatBlock', false, '<pre>');
          }
          rememberSelection();
          context.onChange();
        },
      },
      'line',
      {
        name: 'link',
        icon: '&#128279;',
        title: 'Link',
        result: () => {
          rememberSelection();
          const raw = window.prompt('Enter the link URL');
          if (raw === null) return;
          try {
            const safeUrl = validateLinkUrl(raw);
            applyLink(safeUrl);
          } catch (error) {
            context.onError(error);
          }
        },
      },
      {
        name: 'image',
        icon: '&#128247;',
        title: 'Image',
        result: () => {
          rememberSelection();
          context.pickImage();
        },
      },
    ],
  });

  const content = pellInstance.content;
  content.style.minHeight = '320px';
  content.style.height = 'auto';

  const onSelectionChange = (): void => {
    if (document.activeElement === content) {
      rememberSelection();
    }
  };

  content.addEventListener('keyup', rememberSelection);
  content.addEventListener('mouseup', rememberSelection);
  content.addEventListener('touchend', rememberSelection);
  content.addEventListener('focus', rememberSelection);
  document.addEventListener('selectionchange', onSelectionChange);

  // Pell's first-text formatting must not run in the middle of composition.
  content.innerHTML = context.initialSnapshot || '<p><br></p>';
  isRestoring = false;

  const insertHTMLUndoable = (html: string): void => {
    restoreSelection();
    const inserted = document.execCommand('insertHTML', false, html);
    if (!inserted) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const template = document.createElement('template');
        template.innerHTML = html;
        range.insertNode(template.content);
        range.collapse(false);
      } else {
        content.insertAdjacentHTML('beforeend', html);
      }
    }
    rememberSelection();
    context.onChange();
  };

  const applyLink = (url: string): void => {
    restoreSelection();
    if (!url) {
      document.execCommand('unlink', false);
      rememberSelection();
      context.onChange();
      return;
    }

    const sel = window.getSelection();
    const isCollapsed = !sel || sel.rangeCount === 0 || sel.isCollapsed || sel.getRangeAt(0).collapsed;
    if (isCollapsed) {
      const linkHtml = `<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>`;
      insertHTMLUndoable(linkHtml);
    } else {
      document.execCommand('createLink', false, url);
      rememberSelection();
      context.onChange();
    }
  };

  const handle: EditorHandle = {
    getSnapshot: (): string => {
      return content.innerHTML;
    },

    getHTML: (): string => {
      return cleanFragment(content.innerHTML);
    },

    command: (cmd: FormatCommand): void => {
      restoreSelection();

      switch (cmd.kind) {
        case 'bold':
          document.execCommand('bold', false);
          break;
        case 'italic':
          document.execCommand('italic', false);
          break;
        case 'heading':
          if (isInsideTag(content, 'h1', 'h2', 'h3', 'h4', 'h5', 'h6')) {
            document.execCommand('formatBlock', false, '<p>');
          } else {
            document.execCommand('formatBlock', false, '<h2>');
          }
          break;
        case 'bulletList':
          document.execCommand('insertUnorderedList', false);
          break;
        case 'orderedList':
          document.execCommand('insertOrderedList', false);
          break;
        case 'quote':
          if (isInsideTag(content, 'blockquote')) {
            document.execCommand('formatBlock', false, '<p>');
          } else {
            document.execCommand('formatBlock', false, '<blockquote>');
          }
          break;
        case 'codeBlock':
          if (isInsideTag(content, 'pre')) {
            document.execCommand('formatBlock', false, '<p>');
          } else {
            document.execCommand('formatBlock', false, '<pre>');
          }
          break;
        case 'undo':
          document.execCommand('undo', false);
          break;
        case 'redo':
          document.execCommand('redo', false);
          break;
        case 'link':
          if (cmd.url) {
            applyLink(cmd.url);
            return;
          } else {
            document.execCommand('unlink', false);
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
    },

    rememberSelection: (): void => {
      rememberSelection();
      pendingRange = savedRange;
    },

    insertImage: (image: ImageSource): void => {
      try {
        const imgHtml = `<img src="${escapeAttr(image.src)}" alt="${escapeAttr(image.alt)}" />`;
        insertHTMLUndoable(imgHtml);
      } catch (error) {
        context.onError(error);
      }
    },

    insertMedia: (media: MediaSource): void => {
      try {
        const mediaCode = mediaHTML(media);
        insertHTMLUndoable(mediaCode);
      } catch (error) {
        context.onError(error);
      }
    },

    focus: (): void => {
      content.focus();
    },

    destroy: (): void => {
      content.removeEventListener('keyup', rememberSelection);
      content.removeEventListener('mouseup', rememberSelection);
      content.removeEventListener('touchend', rememberSelection);
      content.removeEventListener('focus', rememberSelection);
      document.removeEventListener('selectionchange', onSelectionChange);
      if (container.parentElement === context.host) {
        context.host.removeChild(container);
      }
    },
  };

  return handle;
};

export default createPellEditor;
