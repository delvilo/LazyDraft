import { Editor, Node, mergeAttributes, type Content } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import type { Selection } from '@tiptap/pm/state';
import type {
  EditorFactory,
  EditorHandle,
  EditorContext,
  FormatCommand,
  MediaSource,
  ImageSource,
} from '../contracts';
import { parseMediaSource } from '../media';
import './prosemirror.css';


export const Media = Node.create({
  name: 'media',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      kind: {
        default: 'video',
        parseHTML: (element) => element.getAttribute('data-lab-media') ?? 'video',
        renderHTML: (attributes) => ({
          'data-lab-media': attributes.kind,
        }),
      },
      src: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-lab-source') ?? element.getAttribute('src') ?? '',
        renderHTML: (attributes) => ({
          'data-lab-source': attributes.src,
        }),
      },
      embedUrl: {
        default: '',
        parseHTML: (element) => element.getAttribute('src') ?? '',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'video',
        getAttrs: (dom) => {
          if (!(dom instanceof HTMLElement)) return false;
          const rawSrc = dom.getAttribute('data-lab-source') ?? dom.getAttribute('src') ?? '';
          if (!rawSrc) return false;
          try {
            const media = parseMediaSource(rawSrc);
            if (media.kind !== 'video') return false;
            return { kind: 'video', src: media.url, embedUrl: '' };
          } catch {
            return false;
          }
        },
      },
      {
        tag: 'audio',
        getAttrs: (dom) => {
          if (!(dom instanceof HTMLElement)) return false;
          const rawSrc = dom.getAttribute('data-lab-source') ?? dom.getAttribute('src') ?? '';
          if (!rawSrc) return false;
          try {
            const media = parseMediaSource(rawSrc);
            if (media.kind !== 'audio') return false;
            return { kind: 'audio', src: media.url, embedUrl: '' };
          } catch {
            return false;
          }
        },
      },
      {
        tag: 'iframe',
        getAttrs: (dom) => {
          if (!(dom instanceof HTMLElement)) return false;
          const rawSrc = dom.getAttribute('data-lab-source') ?? dom.getAttribute('src') ?? '';
          if (!rawSrc) return false;
          try {
            const media = parseMediaSource(rawSrc);
            if (media.kind === 'youtube' || media.kind === 'vimeo') {
              return { kind: media.kind, src: media.url, embedUrl: media.embedUrl };
            }
            return false;
          } catch {
            return false;
          }
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const kind = (node.attrs.kind as string | undefined) ?? 'video';
    const src = (node.attrs.src as string | undefined) ?? '';
    const embedUrl = (node.attrs.embedUrl as string | undefined) || src;

    if (kind === 'video') {
      return [
        'video',
        mergeAttributes(HTMLAttributes, {
          'data-lab-media': 'video',
          'data-lab-source': src,
          controls: 'true',
          src,
        }),
      ];
    }
    if (kind === 'audio') {
      return [
        'audio',
        mergeAttributes(HTMLAttributes, {
          'data-lab-media': 'audio',
          'data-lab-source': src,
          controls: 'true',
          src,
        }),
      ];
    }
    return [
      'iframe',
      mergeAttributes(HTMLAttributes, {
        'data-lab-media': kind,
        'data-lab-source': src,
        src: embedUrl,
        allowfullscreen: 'true',
        allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
      }),
    ];
  },
});

function isTiptapDocumentRoot(value: unknown): value is { type: 'doc' } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    'type' in value && value.type === 'doc';
}

function parseInitialContent(snapshot: string | null, onError: (err: unknown) => void): Content {
  if (snapshot === null) return null;
  const trimmed = snapshot.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err: unknown) {
    onError(err);
    throw err;
  }
  if (!isTiptapDocumentRoot(parsed)) {
    const err = new Error('Invalid Tiptap JSON snapshot: root must be an object with type "doc"');
    onError(err);
    throw err;
  }
  return parsed;
}

const createTiptapAdapter: EditorFactory = async (context: EditorContext): Promise<EditorHandle> => {
  let initialized = false;
  let savedSelection: Selection | null = null;

  const initialContent = parseInitialContent(context.initialSnapshot, context.onError);

  let editor: Editor;
  try {
    editor = new Editor({
      element: context.host,
      extensions: [
        StarterKit.configure({
          link: {
            openOnClick: false,
          },
        }),
        Image.configure({
          allowBase64: false,
        }),
        Media,
      ],
      content: initialContent,
      enableContentCheck: true,
      onContentError: ({ error }) => {
        context.onError(error);
        throw error;
      },
      onUpdate: () => {
        if (initialized) {
          context.onChange();
        }
      },
    editorProps: {
      handleDrop(view, event) {
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
          const file = files[0];
          if (file.type.startsWith('image/')) {
            event.preventDefault();
            void context
              .storeImage(file)
              .then((img) => {
                const { tr } = view.state;
                const coordsPos = view.posAtCoords({ left: event.clientX, top: event.clientY });
                const pos = coordsPos ? coordsPos.pos : view.state.selection.from;
                const node = view.state.schema.nodes.image?.create({ src: img.src, alt: img.alt });
                if (node) {
                  view.dispatch(tr.insert(pos, node));
                }
              })
              .catch((err: unknown) => {
                context.onError(err);
              });
            return true;
          }
        }
        return false;
      },
      handlePaste(view, event) {
        const files = event.clipboardData?.files;
        if (files && files.length > 0) {
          const file = files[0];
          if (file.type.startsWith('image/')) {
            event.preventDefault();
            void context
              .storeImage(file)
              .then((img) => {
                const { tr } = view.state;
                const node = view.state.schema.nodes.image?.create({ src: img.src, alt: img.alt });
                if (node) {
                  view.dispatch(tr.replaceSelectionWith(node));
                }
              })
              .catch((err: unknown) => {
                context.onError(err);
              });
            return true;
          }
        }
        return false;
      },
    },
    });
  } catch (err: unknown) {
    context.onError(err);
    throw err;
  }
  initialized = true;

  return {
    getSnapshot: (): string => {
      if (editor.isDestroyed) throw new Error('Tiptap editor is closed');
      return JSON.stringify(editor.getJSON());
    },

    getHTML: (): string => {
      if (editor.isDestroyed) throw new Error('Tiptap editor is closed');
      return editor.getHTML();
    },

    command: (cmd: FormatCommand): void => {
      if (editor.isDestroyed) return;

      const targetSelection = savedSelection;
      savedSelection = null;
      if (targetSelection) {
        try {
          editor.view.dispatch(editor.state.tr.setSelection(targetSelection));
        } catch {}
      }

      switch (cmd.kind) {
        case 'bold':
          editor.chain().focus().toggleBold().run();
          break;
        case 'italic':
          editor.chain().focus().toggleItalic().run();
          break;
        case 'heading':
          editor.chain().focus().toggleHeading({ level: 2 }).run();
          break;
        case 'bulletList':
          editor.chain().focus().toggleBulletList().run();
          break;
        case 'orderedList':
          editor.chain().focus().toggleOrderedList().run();
          break;
        case 'quote':
          editor.chain().focus().toggleBlockquote().run();
          break;
        case 'codeBlock':
          editor.chain().focus().toggleCodeBlock().run();
          break;
        case 'undo':
          editor.chain().focus().undo().run();
          break;
        case 'redo':
          editor.chain().focus().redo().run();
          break;
        case 'link':
          if (cmd.url) {
            const range = targetSelection ?? editor.state.selection;
            if (range.empty && !editor.isActive('link')) {
              editor
                .chain()
                .focus()
                .insertContent({
                  type: 'text',
                  text: cmd.url,
                  marks: [{ type: 'link', attrs: { href: cmd.url } }],
                })
                .run();
            } else {
              editor.chain().focus().extendMarkRange('link').setLink({ href: cmd.url }).run();
            }
          } else {
            editor.chain().focus().unsetLink().run();
          }
          break;
      }
    },

    rememberSelection: (): void => {
      if (editor.isDestroyed) return;
      savedSelection = editor.state.selection;
    },

    insertImage: (image: ImageSource): void => {
      if (editor.isDestroyed) return;
      if (savedSelection) {
        try {
          editor.view.dispatch(editor.state.tr.setSelection(savedSelection));
        } catch {}
        savedSelection = null;
      }
      editor.chain().focus().insertContent([
        { type: 'image', attrs: { src: image.src, alt: image.alt } },
        { type: 'paragraph' },
      ]).run();
    },

    insertMedia: (media: MediaSource): void => {
      if (editor.isDestroyed) return;
      if (savedSelection) {
        try {
          editor.view.dispatch(editor.state.tr.setSelection(savedSelection));
        } catch {}
        savedSelection = null;
      }
      const attrs = {
        kind: media.kind,
        src: media.url,
        embedUrl: 'embedUrl' in media ? media.embedUrl : media.url,
      };
      editor.chain().focus().insertContent([{ type: 'media', attrs }, { type: 'paragraph' }]).run();
    },

    focus: (): void => {
      if (!editor.isDestroyed) {
        if (savedSelection) {
          try {
            editor.view.dispatch(editor.state.tr.setSelection(savedSelection));
          } catch {}
          savedSelection = null;
        }
        editor.commands.focus();
      }
    },

    destroy: (): void => {
      if (!editor.isDestroyed) {
        editor.destroy();
      }
    },
  };
};

export default createTiptapAdapter;
