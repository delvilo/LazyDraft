import Trix from 'trix';
import type { Editor as TrixEditor } from 'trix';
import 'trix/dist/trix.css';
import type {
  EditorContext,
  EditorFactory,
  EditorHandle,
  FormatCommand,
  ImageSource,
  MediaSource,
} from '../contracts.ts';
import { cleanFragment, createMediaElement, parseMediaSource } from '../media.ts';

const ALLOWED_MIME_TYPES: Record<string, true> = {
  'image/png': true,
  'image/jpeg': true,
  'image/webp': true,
  'image/gif': true,
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;


Trix.config.blockAttributes.heading1 = {
  tagName: 'h1',
  terminal: true,
  breakOnReturn: true,
  group: false,
};
Trix.config.blockAttributes.quote = {
  tagName: 'blockquote',
  nestable: true,
};
Trix.config.blockAttributes.code = {
  tagName: 'pre',
  terminal: true,
  text: { plaintext: true },
};

if (!customElements.get('trix-editor')) {
  customElements.define('trix-toolbar', Trix.elements.TrixToolbarElement);
  customElements.define('trix-editor', Trix.elements.TrixEditorElement);
}

interface TrixManagedAttachment {
  file?: File | null;
  setAttributes(attrs: Record<string, unknown>): void;
  releaseFile(): void;
  remove(): void;
}

function isManagedAttachment(value: unknown): value is TrixManagedAttachment {
  if (!value || typeof value !== 'object') return false;
  return 'setAttributes' in value && 'releaseFile' in value && 'remove' in value;
}
interface TrixSnapshotPayload {
  document: unknown[];
  selectedRange?: [number, number];
}

function isTrixSnapshotPayload(value: unknown): value is TrixSnapshotPayload {
  if (!value || typeof value !== 'object') return false;
  if (!('document' in value)) return false;
  const doc = value.document;
  return Array.isArray(doc) && doc.length > 0;
}

function parseSelectedRange(val: unknown): [number, number] {
  if (
    Array.isArray(val) &&
    typeof val[0] === 'number' &&
    Number.isFinite(val[0]) &&
    typeof val[1] === 'number' &&
    Number.isFinite(val[1])
  ) {
    return [val[0], val[1]];
  }
  return [0, 0];
}


function extractEventFile(event: Event): File | undefined {
  if ('file' in event && event.file instanceof File) {
    return event.file;
  }
  if (
    'detail' in event &&
    event.detail &&
    typeof event.detail === 'object' &&
    'file' in event.detail &&
    event.detail.file instanceof File
  ) {
    return event.detail.file;
  }
  return undefined;
}

function extractEventAttachment(event: Event): TrixManagedAttachment | undefined {
  if ('attachment' in event && isManagedAttachment(event.attachment)) {
    return event.attachment;
  }
  if (
    'detail' in event &&
    event.detail &&
    typeof event.detail === 'object' &&
    'attachment' in event.detail &&
    isManagedAttachment(event.detail.attachment)
  ) {
    return event.detail.attachment;
  }
  return undefined;
}

function attachmentMedia(attachment: Element): HTMLElement | null {
  const raw = attachment.getAttribute('data-trix-attachment');
  if (!raw) return null;
  const attributes: unknown = JSON.parse(raw);
  if (typeof attributes !== 'object' || attributes === null ||
    !('content' in attributes) || typeof attributes.content !== 'string') return null;
  const content = new DOMParser().parseFromString(attributes.content, 'text/html');
  const source = content.querySelector('[data-lab-source]')?.getAttribute('data-lab-source');
  return source ? createMediaElement(parseMediaSource(source)) : null;
}

function cleanTrixHTML(html: string): string {
  if (!html || typeof html !== 'string') {
    return '';
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const removableSelectors = [
    '.attachment__toolbar',
    '.attachment__progress',
    '[data-trix-cursor-target]',
    '[data-lab-projection]',
  ];
  for (const selector of removableSelectors) {
    const elements = Array.from(doc.body.querySelectorAll(selector));
    for (const el of elements) {
      el.remove();
    }
  }

  const attachments = Array.from(doc.body.querySelectorAll('[data-trix-attachment]'));
  for (const att of attachments) {
    const mediaChild = attachmentMedia(att) ?? att.querySelector('[data-lab-media]');
    if (mediaChild && att !== mediaChild) {
      att.replaceWith(mediaChild);
    } else {
      att.removeAttribute('data-trix-attachment');
      att.removeAttribute('data-trix-attributes');
      att.removeAttribute('data-trix-content-type');
      att.removeAttribute('data-trix-id');
      att.removeAttribute('tabindex');
    }
  }

  const figcaptions = Array.from(doc.body.querySelectorAll('figcaption'));
  for (const fc of figcaptions) {
    if (!fc.textContent?.trim()) {
      fc.remove();
    }
  }

  return doc.body.innerHTML.trim();
}

const createTrixEditor: EditorFactory = async (
  context: EditorContext
): Promise<EditorHandle> => {
  const editorElement = document.createElement('trix-editor') as HTMLElement & {
    editor?: TrixEditor;
    value: string;
    toolbarElement?: HTMLElement;
  };

  context.host.appendChild(editorElement);

  if (!editorElement.editor) {
    const { promise, resolve } = Promise.withResolvers<void>();
    const onInit = (): void => {
      editorElement.removeEventListener('trix-initialize', onInit);
      resolve();
    };
    editorElement.addEventListener('trix-initialize', onInit);
    await promise;
  }

  const editor = editorElement.editor;
  if (!editor) {
    throw new Error('Trix editor failed to initialize');
  }

  function projectMediaAttachments(): void {
    for (const attachment of editorElement.querySelectorAll<HTMLElement>('[data-trix-attachment]')) {
      if (attachment.querySelector('[data-lab-projection]')) continue;
      const media = attachmentMedia(attachment);
      if (!media) continue;
      attachment.setAttribute('data-trix-mutable', 'true');
      const projection = document.createElement('div');
      projection.dataset.trixMutable = 'true';
      projection.dataset.labProjection = '';
      projection.append(media);
      for (const child of Array.from(attachment.children)) {
        if (!child.matches('.attachment__caption, .attachment__toolbar, progress')) child.remove();
      }
      attachment.prepend(projection);
      attachment.style.display = 'block';
      attachment.style.width = '100%';
    }
  }

  const trixObserver = new MutationObserver(() => projectMediaAttachments());
  trixObserver.observe(editorElement, { childList: true, subtree: true });
  editorElement.addEventListener('trix-change', projectMediaAttachments);

  let lastRange: [number, number] | null = null;

  const rememberSelection = (): void => {
    const range = editor.getSelectedRange();
    if (range && (range[0] !== 0 || range[1] !== 0 || document.activeElement === editorElement)) {
      lastRange = range;
    }
  };

  const restoreRange = (range: [number, number] | null): void => {
    if (!range) return;
    const length = editor.getDocument().getLength();
    editor.setSelectedRange([Math.min(range[0], length), Math.min(range[1], length)]);
  };

  editorElement.addEventListener('trix-selection-change', () => {
    rememberSelection();
  });

  const toolbar = editorElement.toolbarElement ?? context.host.querySelector('trix-toolbar');
  if (toolbar) {
    const attachButton = toolbar.querySelector('[data-trix-action="attachFiles"]');
    if (attachButton) {
      attachButton.addEventListener(
        'click',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          rememberSelection();
          context.pickImage();
        },
        true
      );
    }
  }

  editorElement.addEventListener('trix-file-accept', (event: Event) => {
    const file = extractEventFile(event);
    if (!file) {
      return;
    }

    if (!ALLOWED_MIME_TYPES[file.type.toLowerCase()]) {
      event.preventDefault();
      context.onError(
        new Error(`Unsupported file type: ${file.type}. Only PNG, JPEG, WebP, and GIF are allowed.`)
      );
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      event.preventDefault();
      context.onError(new Error(`File size ${file.size} exceeds 5MiB limit.`));
      return;
    }
  });

  editorElement.addEventListener('trix-attachment-add', (event: Event) => {
    const attachment = extractEventAttachment(event);
    if (!attachment) {
      return;
    }

    const file = attachment.file;
    if (file) {
      context
        .storeImage(file)
        .then((imageSource) => {
          attachment.setAttributes({
            url: imageSource.src,
            href: imageSource.src,
            filename: file.name,
            filesize: file.size,
            contentType: file.type,
            previewable: true,
          });
          attachment.releaseFile();
        })
        .catch((err) => {
          attachment.remove();
          context.onError(err);
        });
    }
  });

  if (context.initialSnapshot !== null) {
    try {
      const parsed: unknown = JSON.parse(context.initialSnapshot);
      if (!isTrixSnapshotPayload(parsed)) {
        throw new Error('Invalid Trix snapshot: missing or invalid document array');
      }
      const document = Trix.Document.fromJSON(parsed.document);
      const selectedRange = parseSelectedRange(
        'selectedRange' in parsed ? parsed.selectedRange : undefined
      );
      editor.loadSnapshot({
        document,
        selectedRange,
      });
    } catch (err) {
      context.onError(err);
      throw err;
    }
  }

  editorElement.addEventListener('trix-change', () => {
    context.onChange();
  });

  const handle: EditorHandle = {
    getSnapshot: (): string => {
      return JSON.stringify(editor.toJSON());
    },

    getHTML: (): string => {
      const rawHtml = editorElement.value || editorElement.innerHTML;
      return cleanFragment(cleanTrixHTML(rawHtml));
    },

    command: (cmd: FormatCommand): void => {
      const targetRange = lastRange;
      editorElement.focus();
      if (cmd.kind !== 'undo' && cmd.kind !== 'redo') {
        restoreRange(targetRange);
        editor.recordUndoEntry('Formatting');
      }

      switch (cmd.kind) {
        case 'bold': {
          if (editor.attributeIsActive('bold')) {
            editor.deactivateAttribute('bold');
          } else {
            editor.activateAttribute('bold');
          }
          break;
        }
        case 'italic': {
          if (editor.attributeIsActive('italic')) {
            editor.deactivateAttribute('italic');
          } else {
            editor.activateAttribute('italic');
          }
          break;
        }
        case 'heading': {
          if (editor.attributeIsActive('heading1')) {
            editor.deactivateAttribute('heading1');
          } else {
            editor.activateAttribute('heading1');
          }
          break;
        }
        case 'bulletList': {
          if (editor.attributeIsActive('bullet')) {
            editor.deactivateAttribute('bullet');
          } else {
            editor.activateAttribute('bullet');
          }
          break;
        }
        case 'orderedList': {
          if (editor.attributeIsActive('number')) {
            editor.deactivateAttribute('number');
          } else {
            editor.activateAttribute('number');
          }
          break;
        }
        case 'quote': {
          if (editor.attributeIsActive('quote')) {
            editor.deactivateAttribute('quote');
          } else {
            editor.activateAttribute('quote');
          }
          break;
        }
        case 'codeBlock': {
          if (editor.attributeIsActive('code')) {
            editor.deactivateAttribute('code');
          } else {
            editor.activateAttribute('code');
          }
          break;
        }
        case 'undo': {
          if (editor.canUndo()) {
            editor.undo();
          }
          break;
        }
        case 'redo': {
          if (editor.canRedo()) {
            editor.redo();
          }
          break;
        }
        case 'link': {
          if (!cmd.url) {
            editor.deactivateAttribute('href');
            break;
          }
          const [start, end] = editor.getSelectedRange();
          if (start === end) {
            editor.insertString(cmd.url);
            editor.setSelectedRange([start, start + cmd.url.length]);
            editor.activateAttribute('href', cmd.url);
            editor.setSelectedRange(start + cmd.url.length);
          } else {
            editor.activateAttribute('href', cmd.url);
          }
          break;
        }
        default: {
          const _exhaustive: never = cmd;
          throw new Error(`Unhandled command: ${JSON.stringify(_exhaustive)}`);
        }
      }
      rememberSelection();
    },

    rememberSelection,

    insertImage: (image: ImageSource): void => {
      const targetRange = lastRange;
      editorElement.focus();
      restoreRange(targetRange);
      editor.recordUndoEntry('Insert Attachment');
      const attachment = new Trix.Attachment({
        url: image.src,
        href: image.src,
        filename: image.alt || 'image',
        contentType: 'image/png',
        previewable: true,
        caption: image.alt || '',
      });
      editor.insertAttachment(attachment);
      rememberSelection();
    },

    insertMedia: (media: MediaSource): void => {
      const targetRange = lastRange;
      editorElement.focus();
      restoreRange(targetRange);
      const mediaEl = createMediaElement(media);
      const figure = document.createElement('figure');
      figure.style.display = 'block';
      figure.style.margin = '1em 0';
      mediaEl.style.maxWidth = '100%';
      mediaEl.style.display = 'block';
      figure.appendChild(mediaEl);

      editor.recordUndoEntry('Insert Attachment');
      const attachment = new Trix.Attachment({
        content: figure.outerHTML,
      });
      editor.insertAttachment(attachment);
      rememberSelection();
    },

    focus: (): void => {
      editorElement.focus();
    },

    destroy: (): void => {
      context.host.innerHTML = '';
      trixObserver.disconnect();
    },
  };

  return handle;
};

export default createTrixEditor;
