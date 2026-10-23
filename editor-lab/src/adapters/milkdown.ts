import { Crepe } from '@milkdown/crepe';
import { commandsCtx, editorViewCtx, schemaCtx } from '@milkdown/kit/core';
import { $nodeSchema, $prose, $remark } from '@milkdown/kit/utils';
import {
  blockquoteSchema,
  bulletListSchema,
  codeBlockSchema,
  emphasisSchema,
  headingSchema,
  linkSchema,
  listItemSchema,
  orderedListSchema,
  paragraphSchema,
  strongSchema,
} from '@milkdown/kit/preset/commonmark';
import { lift, setBlockType, toggleMark, wrapIn } from '@milkdown/kit/prose/commands';
import { liftListItem, wrapInList } from '@milkdown/kit/prose/schema-list';
import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history';
import { DOMSerializer, Fragment, Slice } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, type Selection } from '@milkdown/kit/prose/state';
import type {
  EditorFactory,
  EditorHandle,
  EditorContext,
  FormatCommand,
  MediaSource,
  ImageSource,
} from '../contracts';
import { parseMediaSource } from '../media';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/classic.css';
import './prosemirror.css';

interface MdAstNode {
  type: string;
  value?: string;
  children?: MdAstNode[];
  [key: string]: unknown;
}

function parseMediaAttributes(html: string): { kind: string; src: string; embedUrl: string } | null {
  const trimmed = html.trim();
  if (!trimmed.startsWith('<video') && !trimmed.startsWith('<audio') && !trimmed.startsWith('<iframe')) {
    return null;
  }
  const div = document.createElement('div');
  div.innerHTML = trimmed;
  const el = div.firstElementChild;
  if (!el) return null;

  const tag = el.tagName.toLowerCase();
  if (tag === 'video' || tag === 'audio') {
    const rawSrc = el.getAttribute('data-lab-source') ?? el.getAttribute('src') ?? '';
    if (!rawSrc) return null;
    try {
      const media = parseMediaSource(rawSrc);
      if (media.kind !== tag) return null;
      return { kind: media.kind, src: media.url, embedUrl: '' };
    } catch {
      return null;
    }
  }
  if (tag === 'iframe') {
    const rawSrc = el.getAttribute('data-lab-source') ?? el.getAttribute('src') ?? '';
    if (!rawSrc) return null;
    try {
      const media = parseMediaSource(rawSrc);
      if (media.kind === 'youtube' || media.kind === 'vimeo') {
        return { kind: media.kind, src: media.url, embedUrl: media.embedUrl };
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

function visitMediaNodes(tree: MdAstNode): void {
  function walk(node: MdAstNode): void {
    if (!Array.isArray(node.children)) return;

    const nextChildren: MdAstNode[] = [];
    for (const child of node.children) {
      if (child.type === 'html' && typeof child.value === 'string') {
        const parsed = parseMediaAttributes(child.value);
        if (parsed) {
          nextChildren.push({ type: 'media', ...parsed });
          continue;
        }
      }
      if (child.type === 'paragraph' && Array.isArray(child.children)) {
        if (
          child.children.length > 0 &&
          child.children.every((c) => c?.type === 'html' && typeof c.value === 'string')
        ) {
          const joined = child.children.map((c) => c.value).join('');
          const parsed = parseMediaAttributes(joined);
          if (parsed) {
            nextChildren.push({ type: 'media', ...parsed });
            continue;
          }
        }
      }
      walk(child);
      nextChildren.push(child);
    }
    node.children = nextChildren;
  }

  walk(tree);
}

export const remarkMediaPlugin = $remark(
  'remark-media',
  () => () => (tree: unknown) => {
    if (typeof tree === 'object' && tree !== null) {
      visitMediaNodes(tree as MdAstNode);
    }
  }
);

export const mediaSchema = $nodeSchema('media', () => {
  return {
    inline: false,
    group: 'block',
    selectable: true,
    draggable: true,
    marks: '',
    atom: true,
    priority: 60,
    attrs: {
      kind: { default: 'video', validate: 'string' },
      src: { default: '', validate: 'string' },
      embedUrl: { default: '', validate: 'string' },
    },
    parseDOM: [
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
    ],
    toDOM: (node) => {
      const { kind, src, embedUrl } = node.attrs as { kind: string; src: string; embedUrl: string };
      if (kind === 'video') {
        return ['video', { 'data-lab-media': 'video', 'data-lab-source': src, controls: 'true', src }];
      }
      if (kind === 'audio') {
        return ['audio', { 'data-lab-media': 'audio', 'data-lab-source': src, controls: 'true', src }];
      }
      return [
        'iframe',
        {
          'data-lab-media': kind,
          'data-lab-source': src,
          src: embedUrl || src,
          allowfullscreen: 'true',
          allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
        },
      ];
    },
    parseMarkdown: {
      match: ({ type }) => type === 'media',
      runner: (state, node, type) => {
        state.addNode(type, {
          kind: (node.kind as string | undefined) ?? 'video',
          src: (node.src as string | undefined) ?? '',
          embedUrl: (node.embedUrl as string | undefined) ?? '',
        });
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === 'media',
      runner: (state, node) => {
        const { kind, src, embedUrl } = node.attrs as { kind: string; src: string; embedUrl: string };
        let htmlStr = '';
        if (kind === 'video') {
          htmlStr = `<video data-lab-media="video" data-lab-source="${src}" controls src="${src}"></video>`;
        } else if (kind === 'audio') {
          htmlStr = `<audio data-lab-media="audio" data-lab-source="${src}" controls src="${src}"></audio>`;
        } else {
          const eUrl = embedUrl || src;
          htmlStr = `<iframe data-lab-media="${kind}" data-lab-source="${src}" src="${eUrl}" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"></iframe>`;
        }
        state.addNode('html', undefined, htmlStr);
      },
    },
  };
});

const changePluginKey = new PluginKey('MILKDOWN_LAB_CHANGE');

function createChangePlugin(onChange: () => void, isReady: () => boolean) {
  return $prose(
    () =>
      new Plugin({
        key: changePluginKey,
        state: {
          init: () => undefined,
          apply: (tr) => {
            if (isReady() && tr.docChanged) {
              onChange();
            }
          },
        },
      })
  );
}

const createMilkdownAdapter: EditorFactory = async (context: EditorContext): Promise<EditorHandle> => {
  let initialized = false;
  let savedSelection: Selection | null = null;
  let destroyed = false;

  const crepe = new Crepe({
    root: context.host,
    defaultValue: context.initialSnapshot ?? '',
    featureConfigs: {
      [Crepe.Feature.ImageBlock]: {
        onUpload: async (file: File): Promise<string> => {
          try {
            const img = await context.storeImage(file);
            return img.src;
          } catch (err: unknown) {
            context.onError(err);
            throw err;
          }
        },
      },
      [Crepe.Feature.BlockEdit]: {
        buildMenu: (builder) => {
          const advanced = builder.getGroup('advanced');
          if (advanced) {
            advanced.addItem('media', {
              label: 'Video / Audio',
              icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/></svg>`,
              onRun: () => {
                context.requestMedia();
              },
            });
          }
        },
      },
    },
  });

  const changePlugin = createChangePlugin(context.onChange, () => initialized);

  crepe.editor.use(remarkMediaPlugin).use(mediaSchema).use(changePlugin);

  try {
    await crepe.create();
  } catch (err: unknown) {
    context.onError(err);
    throw err;
  }

  initialized = true;

  return {
    getSnapshot: (): string => {
      if (destroyed) throw new Error('Milkdown editor is closed');
      return crepe.getMarkdown();
    },

    getHTML: (): string => {
      if (destroyed) throw new Error('Milkdown editor is closed');
      const schema = crepe.editor.ctx.get(schemaCtx);
      const view = crepe.editor.ctx.get(editorViewCtx);
      const serializer = DOMSerializer.fromSchema(schema);
      const fragment = serializer.serializeFragment(view.state.doc.content);
      const div = document.createElement('div');
      div.appendChild(fragment);
      div.querySelectorAll('img').forEach((img) => {
        if (!img.getAttribute('alt') && img.getAttribute('caption')) {
          img.setAttribute('alt', img.getAttribute('caption') ?? '');
        }
      });
      return div.innerHTML;
    },

    command: (cmd: FormatCommand): void => {
      if (destroyed) return;

      crepe.editor.action((ctx) => {
        const commands = ctx.get(commandsCtx);
        const view = ctx.get(editorViewCtx);

        if (savedSelection) {
          try {
            view.dispatch(view.state.tr.setSelection(savedSelection));
          } catch {}
          savedSelection = null;
        }

        const state = view.state;
        switch (cmd.kind) {
          case 'bold':
            toggleMark(strongSchema.type(ctx))(state, view.dispatch);
            break;

          case 'italic':
            toggleMark(emphasisSchema.type(ctx))(state, view.dispatch);
            break;

          case 'heading': {
            const headingType = headingSchema.type(ctx);
            const paragraphType = paragraphSchema.type(ctx);
            const { $from } = state.selection;
            if ($from.parent.type === headingType) {
              setBlockType(paragraphType)(state, view.dispatch);
            } else {
              setBlockType(headingType, { level: 2 })(state, view.dispatch);
            }
            break;
          }

          case 'bulletList': {
            const bulletListType = bulletListSchema.type(ctx);
            const listItemType = listItemSchema.type(ctx);
            const { $from } = state.selection;
            let inList = false;
            for (let d = $from.depth; d > 0; d--) {
              if ($from.node(d).type === bulletListType) {
                inList = true;
                break;
              }
            }
            if (inList) {
              liftListItem(listItemType)(state, view.dispatch);
            } else {
              wrapInList(bulletListType)(state, view.dispatch);
            }
            break;
          }

          case 'orderedList': {
            const orderedListType = orderedListSchema.type(ctx);
            const listItemType = listItemSchema.type(ctx);
            const { $from } = state.selection;
            let inList = false;
            for (let d = $from.depth; d > 0; d--) {
              if ($from.node(d).type === orderedListType) {
                inList = true;
                break;
              }
            }
            if (inList) {
              liftListItem(listItemType)(state, view.dispatch);
            } else {
              wrapInList(orderedListType)(state, view.dispatch);
            }
            break;
          }

          case 'quote': {
            const blockquoteType = blockquoteSchema.type(ctx);
            const { $from } = state.selection;
            let inQuote = false;
            for (let d = $from.depth; d > 0; d--) {
              if ($from.node(d).type === blockquoteType) {
                inQuote = true;
                break;
              }
            }
            if (inQuote) {
              lift(state, view.dispatch);
            } else {
              wrapIn(blockquoteType)(state, view.dispatch);
            }
            break;
          }

          case 'codeBlock': {
            const codeBlockType = codeBlockSchema.type(ctx);
            const paragraphType = paragraphSchema.type(ctx);
            const { $from } = state.selection;
            if ($from.parent.type === codeBlockType) {
              setBlockType(paragraphType)(state, view.dispatch);
            } else {
              setBlockType(codeBlockType)(state, view.dispatch);
            }
            break;
          }

          case 'undo':
            commands.call(undoCommand.key);
            break;

          case 'redo':
            commands.call(redoCommand.key);
            break;

          case 'link': {
            const linkType = linkSchema.type(ctx);
            if (cmd.url) {
              if (state.selection.empty) {
                const mark = linkType.create({ href: cmd.url });
                const textNode = state.schema.text(cmd.url, [mark]);
                view.dispatch(state.tr.replaceSelectionWith(textNode, false));
              } else {
                const mark = linkType.create({ href: cmd.url });
                const { from, to } = state.selection;
                view.dispatch(state.tr.removeMark(from, to, linkType).addMark(from, to, mark));
              }
            } else {
              const { from, to } = state.selection;
              view.dispatch(state.tr.removeMark(from, to, linkType));
            }
            break;
          }
        }

        view.focus();
      });
    },

    rememberSelection: (): void => {
      if (destroyed) return;
      crepe.editor.action((ctx) => {
        savedSelection = ctx.get(editorViewCtx).state.selection;
      });
    },

    insertImage: (image: ImageSource): void => {
      if (destroyed) return;
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (savedSelection) {
          try {
            view.dispatch(view.state.tr.setSelection(savedSelection));
          } catch {}
          savedSelection = null;
        }
        const schema = ctx.get(schemaCtx);
        const nodeType = schema.nodes['image-block'];
        const paragraphType = schema.nodes.paragraph;
        if (!nodeType || !paragraphType) throw new Error('Milkdown 圖片區塊結構不可用。');
        const node = nodeType.createAndFill({
          src: image.src,
          caption: image.alt || '',
          ratio: 1,
        });
        if (!node) throw new Error('無法建立 Milkdown 圖片區塊。');
        const content = new Slice(Fragment.fromArray([node, paragraphType.create()]), 0, 0);
        view.dispatch(view.state.tr.replaceSelection(content).scrollIntoView());
        view.focus();
      });
    },

    insertMedia: (media: MediaSource): void => {
      if (destroyed) return;
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (savedSelection) {
          try {
            view.dispatch(view.state.tr.setSelection(savedSelection));
          } catch {}
          savedSelection = null;
        }
        const schema = ctx.get(schemaCtx);
        const mediaType = schema.nodes['media'];
        const paragraphType = schema.nodes.paragraph;
        if (!mediaType || !paragraphType) throw new Error('Milkdown 影音區塊結構不可用。');
        const node = mediaType.createAndFill({
          kind: media.kind,
          src: media.url,
          embedUrl: 'embedUrl' in media ? media.embedUrl : media.url,
        });
        if (!node) throw new Error('無法建立 Milkdown 影音區塊。');
        const content = new Slice(Fragment.fromArray([node, paragraphType.create()]), 0, 0);
        view.dispatch(view.state.tr.replaceSelection(content).scrollIntoView());
        view.focus();
      });
    },

    focus: (): void => {
      if (destroyed) return;
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (savedSelection) {
          try {
            view.dispatch(view.state.tr.setSelection(savedSelection));
          } catch {}
          savedSelection = null;
        }
        view.focus();
      });
    },

    destroy: (): void => {
      if (!destroyed) {
        destroyed = true;
        void crepe.destroy();
      }
    },
  };
};

export default createMilkdownAdapter;
