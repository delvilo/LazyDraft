import Quill, { type Op } from 'quill';
import 'quill/dist/quill.snow.css';
import { BlockEmbed } from 'quill/blots/block.js';
import type {
  EditorContext,
  EditorFactory,
  EditorHandle,
  FormatCommand,
  ImageSource,
  MediaSource,
} from '../contracts.ts';
import { createMediaElement } from '../media.ts';

function parseMediaValue(value: unknown): MediaSource | null {
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        return parseMediaValue(parsed);
      } catch {
        return null;
      }
    }
    return null;
  }
  if ('kind' in value && 'url' in value) {
    const kind = value.kind;
    const url = String(value.url ?? '');
    if (kind === 'video' || kind === 'audio') {
      return { kind, url };
    }
    if (kind === 'youtube' || kind === 'vimeo') {
      const embedUrl = 'embedUrl' in value ? String(value.embedUrl ?? url) : url;
      return { kind, url, embedUrl };
    }
  }
  return null;
}

class MediaBlot extends BlockEmbed {
  static blotName = 'media';
  static tagName = 'figure';
  static className = 'ql-media';

  static create(value: unknown): HTMLElement {
    const node = super.create(value) as HTMLElement;
    node.setAttribute('contenteditable', 'false');

    const media = parseMediaValue(value);
    if (!media) {
      return node;
    }

    node.setAttribute('data-lab-media', media.kind);
    node.setAttribute('data-kind', media.kind);
    node.setAttribute('data-url', media.url);
    if ('embedUrl' in media && media.embedUrl) {
      node.setAttribute('data-embed-url', media.embedUrl);
    }

    const player = createMediaElement(media);
    player.style.maxWidth = '100%';
    player.style.display = 'block';
    node.appendChild(player);

    return node;
  }

  static value(domNode: HTMLElement): MediaSource {
    const kind = domNode.getAttribute('data-kind') ?? domNode.getAttribute('data-lab-media');
    const url = domNode.getAttribute('data-url') ?? '';
    const embedUrl = domNode.getAttribute('data-embed-url') ?? '';

    if (kind === 'youtube' || kind === 'vimeo') {
      return { kind, url: url || embedUrl, embedUrl: embedUrl || url };
    }
    if (kind === 'audio') {
      return { kind: 'audio', url };
    }
    return { kind: 'video', url };
  }

  html(): string {
    return this.domNode.outerHTML;
  }
}

function isOp(val: unknown): val is Op {
  if (typeof val !== 'object' || val === null || !('insert' in val)) return false;
  if ('attributes' in val && (typeof val.attributes !== 'object' || val.attributes === null || Array.isArray(val.attributes))) return false;
  return typeof val.insert === 'string' ||
    (typeof val.insert === 'object' && val.insert !== null && !Array.isArray(val.insert));
}

function isOpArray(val: unknown): val is Op[] {
  return Array.isArray(val) && val.length > 0 && val.every(isOp);
}

function parseQuillOps(val: unknown): Op[] | null {
  if (val && typeof val === 'object' && 'ops' in val && isOpArray(val.ops)) {
    return val.ops;
  }
  return null;
}

Quill.register(MediaBlot, true);

interface SavedRange {
  index: number;
  length: number;
}

const createQuillEditor: EditorFactory = async (
  context: EditorContext
): Promise<EditorHandle> => {
  const container = document.createElement('div');
  context.host.appendChild(container);

  let lastSelection: SavedRange | null = null;

  const rememberSelection = (): void => {
    const sel = quill.getSelection();
    if (sel) {
      lastSelection = { index: sel.index, length: sel.length };
    }
  };

  const quill = new Quill(container, {
    theme: 'snow',
    modules: {
      toolbar: {
        container: [
          [{ header: [1, 2, 3, false] }],
          ['bold', 'italic'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['blockquote', 'code-block'],
          ['link', 'image', 'video'],
          ['clean'],
        ],
        handlers: {
          image: () => {
            rememberSelection();
            context.pickImage();
          },
          video: () => {
            rememberSelection();
            context.requestMedia();
          },
        },
      },
      uploader: {
        mimetypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
        handler: async (range: { index: number; length: number }, files: File[]) => {
          for (const file of files) {
            try {
              quill.history.cutoff();
              const imageSource = await context.storeImage(file);
              quill.insertEmbed(range.index, 'image', imageSource.src, Quill.sources.USER);
              if (imageSource.alt) {
                quill.formatText(range.index, 1, 'alt', imageSource.alt, Quill.sources.USER);
              }
              quill.history.cutoff();
            } catch (err) {
              context.onError(err);
            }
          }
        },
      },
    },
  });

  quill.on(Quill.events.SELECTION_CHANGE, (range) => {
    if (range) {
      lastSelection = { index: range.index, length: range.length };
    }
  });

  if (context.initialSnapshot !== null) {
    try {
      const parsed: unknown = JSON.parse(context.initialSnapshot);
      const ops = parseQuillOps(parsed);
      if (!ops) {
        throw new Error('Invalid Quill snapshot: missing or corrupt ops array');
      }
      quill.setContents(ops, Quill.sources.SILENT);
      quill.history.clear();
    } catch (err) {
      context.onError(err);
      throw err;
    }
  }

  quill.on(Quill.events.TEXT_CHANGE, (_delta, _oldDelta, source) => {
    if (source === Quill.sources.USER) {
      context.onChange();
    }
  });

  const ensureTargetIndex = (): number => {
    if (lastSelection !== null) {
      return lastSelection.index;
    }
    const current = quill.getSelection();
    if (current) {
      return current.index;
    }
    return Math.max(0, quill.getLength() - 1);
  };

  const handle: EditorHandle = {
    getSnapshot: (): string => {
      return JSON.stringify(quill.getContents());
    },

    getHTML: (): string => {
      return quill.getSemanticHTML();
    },

    command: (cmd: FormatCommand): void => {
      const targetSelection = lastSelection ?? quill.getSelection();
      if (cmd.kind !== 'undo' && cmd.kind !== 'redo') {
        if (targetSelection) {
          quill.setSelection(targetSelection.index, targetSelection.length, Quill.sources.SILENT);
          lastSelection = targetSelection;
        } else {
          quill.focus();
        }
        quill.history.cutoff();
      }

      switch (cmd.kind) {
        case 'bold': {
          const current = quill.getFormat();
          quill.format('bold', !current.bold, Quill.sources.USER);
          break;
        }
        case 'italic': {
          const current = quill.getFormat();
          quill.format('italic', !current.italic, Quill.sources.USER);
          break;
        }
        case 'heading': {
          const current = quill.getFormat();
          quill.format('header', current.header ? false : 2, Quill.sources.USER);
          break;
        }
        case 'bulletList': {
          const current = quill.getFormat();
          quill.format('list', current.list === 'bullet' ? false : 'bullet', Quill.sources.USER);
          break;
        }
        case 'orderedList': {
          const current = quill.getFormat();
          quill.format('list', current.list === 'ordered' ? false : 'ordered', Quill.sources.USER);
          break;
        }
        case 'quote': {
          const current = quill.getFormat();
          quill.format('blockquote', !current.blockquote, Quill.sources.USER);
          break;
        }
        case 'codeBlock': {
          const current = quill.getFormat();
          quill.format('code-block', !current['code-block'], Quill.sources.USER);
          break;
        }
        case 'undo': {
          quill.history.undo();
          break;
        }
        case 'redo': {
          quill.history.redo();
          break;
        }
        case 'link': {
          if (cmd.url) {
            const range = targetSelection ?? quill.getSelection();
            if (!range || range.length === 0) {
              const insertIndex = range ? range.index : Math.max(0, quill.getLength() - 1);
              quill.insertText(insertIndex, cmd.url, 'link', cmd.url, Quill.sources.USER);
              const nextIndex = insertIndex + cmd.url.length;
              quill.setSelection(nextIndex, 0, Quill.sources.SILENT);
              lastSelection = { index: nextIndex, length: 0 };
            } else {
              quill.formatText(range.index, range.length, 'link', cmd.url, Quill.sources.USER);
            }
          } else {
            const range = targetSelection ?? quill.getSelection();
            if (range && range.length > 0) {
              quill.formatText(range.index, range.length, 'link', false, Quill.sources.USER);
            } else {
              quill.format('link', false, Quill.sources.USER);
            }
          }
          break;
        }
        default: {
          const _exhaustive: never = cmd;
          throw new Error(`Unhandled command: ${JSON.stringify(_exhaustive)}`);
        }
      }
      if (cmd.kind !== 'undo' && cmd.kind !== 'redo') {
        quill.history.cutoff();
      }
      rememberSelection();
    },

    rememberSelection,

    insertImage: (image: ImageSource): void => {
      const targetIndex = ensureTargetIndex();
      quill.history.cutoff();
      quill.insertEmbed(targetIndex, 'image', image.src, Quill.sources.USER);
      if (image.alt) {
        quill.formatText(targetIndex, 1, 'alt', image.alt, Quill.sources.USER);
      }
      quill.history.cutoff();
      const nextIndex = targetIndex + 1;
      quill.setSelection(nextIndex, 0, Quill.sources.SILENT);
      lastSelection = { index: nextIndex, length: 0 };
    },

    insertMedia: (media: MediaSource): void => {
      const targetIndex = ensureTargetIndex();
      quill.history.cutoff();
      quill.insertEmbed(targetIndex, 'media', media, Quill.sources.USER);
      quill.history.cutoff();
      const nextIndex = targetIndex + 1;
      quill.setSelection(nextIndex, 0, Quill.sources.SILENT);
      lastSelection = { index: nextIndex, length: 0 };
    },

    focus: (): void => {
      quill.focus();
    },

    destroy: (): void => {
      quill.off(Quill.events.TEXT_CHANGE);
      quill.off(Quill.events.SELECTION_CHANGE);
      context.host.innerHTML = '';
    },
  };

  return handle;
};

export default createQuillEditor;
