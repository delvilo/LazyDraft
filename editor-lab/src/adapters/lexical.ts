import {
  createEditor,
  type LexicalEditor,
  type EditorConfig,
  type EditorUpdateOptions,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type SerializedEditorState,
  type DOMExportOutput,
  type RangeSelection,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  $createParagraphNode,
  $createTextNode,
  $applyNodeReplacement,
  FORMAT_TEXT_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
  COMMAND_PRIORITY_HIGH,
  DROP_COMMAND,
  DecoratorNode,
} from 'lexical';
import {
  registerRichText,
  HeadingNode,
  QuoteNode,
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
} from '@lexical/rich-text';
import { registerHistory, createEmptyHistoryState } from '@lexical/history';
import {
  registerList,
  ListNode,
  ListItemNode,
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from '@lexical/list';
import { LinkNode, AutoLinkNode, $createLinkNode, $toggleLink } from '@lexical/link';
import { $getNearestNodeOfType } from '@lexical/utils';
import { CodeNode, $createCodeNode, $isCodeNode } from '@lexical/code';
import { $setBlocksType } from '@lexical/selection';
import { $generateHtmlFromNodes } from '@lexical/html';
import type {
  EditorFactory,
  EditorHandle,
  EditorContext,
  FormatCommand,
  ImageSource,
  MediaSource,
} from '../contracts.ts';
import { createMediaElement, cleanFragment, parseImageURL, parseMediaSource } from '../media.ts';

export interface SerializedImageNode extends SerializedLexicalNode {
  type: 'lab-image';
  version: 1;
  src: string;
  alt: string;
}

export class ImageNode extends DecoratorNode<null> {
  __src: string;
  __alt: string;

  static getType(): string {
    return 'lab-image';
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__alt, node.__key);
  }

  constructor(src: string, alt: string, key?: NodeKey) {
    super(key);
    this.__src = src;
    this.__alt = alt;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const container = document.createElement('figure');
    container.className = 'lab-image-container';
    container.setAttribute('data-lab-image', 'true');
    container.contentEditable = 'false';

    const img = document.createElement('img');
    img.src = this.__src;
    img.alt = this.__alt;
    img.className = 'lab-image';
    container.appendChild(img);

    if (this.__alt) {
      const caption = document.createElement('figcaption');
      caption.textContent = this.__alt;
      container.appendChild(caption);
    }

    return container;
  }

  updateDOM(prevNode: ImageNode): boolean {
    return prevNode.__src !== this.__src || prevNode.__alt !== this.__alt;
  }

  exportDOM(): DOMExportOutput {
    const container = document.createElement('figure');
    container.className = 'lab-image-container';
    container.setAttribute('data-lab-image', 'true');

    const img = document.createElement('img');
    img.setAttribute('src', this.__src);
    img.setAttribute('alt', this.__alt);
    img.className = 'lab-image';
    container.appendChild(img);

    if (this.__alt) {
      const caption = document.createElement('figcaption');
      caption.textContent = this.__alt;
      container.appendChild(caption);
    }

    return { element: container };
  }

  exportJSON(): SerializedImageNode {
    return {
      type: 'lab-image',
      version: 1,
      src: this.__src,
      alt: this.__alt,
    };
  }

  static importJSON(serializedNode: unknown): ImageNode {
    if (
      typeof serializedNode !== 'object' || serializedNode === null ||
      !('src' in serializedNode) || typeof serializedNode.src !== 'string' ||
      !('alt' in serializedNode) || typeof serializedNode.alt !== 'string'
    ) throw new Error('圖片節點資料損壞。');
    return $createImageNode({ src: parseImageURL(serializedNode.src).src, alt: serializedNode.alt });
  }

  decorate(): null {
    return null;
  }

  isInline(): boolean {
    return false;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  isIsolated(): boolean {
    return true;
  }

  getTextContent(): string {
    return this.__alt ? `[image: ${this.__alt}]` : '[image]';
  }
}

export function $createImageNode(payload: ImageSource): ImageNode {
  return $applyNodeReplacement(new ImageNode(payload.src, payload.alt));
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode;
}

export interface SerializedMediaNode extends SerializedLexicalNode {
  type: 'lab-media';
  version: 1;
  media: MediaSource;
}

export class MediaNode extends DecoratorNode<null> {
  __media: MediaSource;

  static getType(): string {
    return 'lab-media';
  }

  static clone(node: MediaNode): MediaNode {
    return new MediaNode(node.__media, node.__key);
  }

  constructor(media: MediaSource, key?: NodeKey) {
    super(key);
    this.__media = media;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const container = document.createElement('div');
    container.className = 'lab-media-container';
    container.contentEditable = 'false';
    const mediaEl = createMediaElement(this.__media);
    container.appendChild(mediaEl);
    return container;
  }

  updateDOM(prevNode: MediaNode): boolean {
    return (
      prevNode.__media.kind !== this.__media.kind ||
      prevNode.__media.url !== this.__media.url
    );
  }

  exportDOM(): DOMExportOutput {
    const el = createMediaElement(this.__media);
    return { element: el };
  }

  exportJSON(): SerializedMediaNode {
    return {
      type: 'lab-media',
      version: 1,
      media: this.__media,
    };
  }

  static importJSON(serializedNode: unknown): MediaNode {
    if (
      typeof serializedNode !== 'object' || serializedNode === null ||
      !('media' in serializedNode) || typeof serializedNode.media !== 'object' || serializedNode.media === null ||
      !('url' in serializedNode.media) || typeof serializedNode.media.url !== 'string'
    ) throw new Error('影音節點資料損壞。');
    return $createMediaNode(parseMediaSource(serializedNode.media.url));
  }

  decorate(): null {
    return null;
  }

  isInline(): boolean {
    return false;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  isIsolated(): boolean {
    return true;
  }

  getTextContent(): string {
    return `[media: ${this.__media.url}]`;
  }
}

export function $createMediaNode(media: MediaSource): MediaNode {
  return $applyNodeReplacement(new MediaNode(media));
}

export function $isMediaNode(node: LexicalNode | null | undefined): node is MediaNode {
  return node instanceof MediaNode;
}

function isValidLexicalSnapshot(val: unknown): val is SerializedEditorState {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) return false;
  if (!('root' in val)) return false;
  const root = val.root;
  if (typeof root !== 'object' || root === null || Array.isArray(root)) return false;
  return 'type' in root && root.type === 'root' && 'children' in root && Array.isArray(root.children);
}

const createLexicalEditor: EditorFactory = async (context: EditorContext): Promise<EditorHandle> => {
  const contentEditable = document.createElement('div');
  contentEditable.contentEditable = 'true';
  contentEditable.className = 'editor-input lexical-content-editable';
  contentEditable.setAttribute('role', 'textbox');
  contentEditable.setAttribute('spellcheck', 'true');
  contentEditable.setAttribute('data-lexical-editor', 'true');
  context.host.appendChild(contentEditable);

  const editor: LexicalEditor = createEditor({
    namespace: 'lazydraft-lexical',
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      LinkNode,
      AutoLinkNode,
      CodeNode,
      ImageNode,
      MediaNode,
    ],
    onError: (err: Error) => {
      context.onError(err);
    },
  });

  editor.setRootElement(contentEditable);

  const unregisterRichText = registerRichText(editor);
  const historyState = createEmptyHistoryState();
  const unregisterHistory = registerHistory(editor, historyState, 300);
  const unregisterList = registerList(editor);

  let isInitialized = false;

  const unregisterUpdateListener = editor.registerUpdateListener(
    ({ dirtyElements, dirtyLeaves, tags }) => {
      if (!isInitialized || tags.has('initial')) {
        return;
      }
      if (dirtyElements.size > 0 || dirtyLeaves.size > 0) {
        context.onChange();
      }
    }
  );

  const unregisterDrop = editor.registerCommand(
    DROP_COMMAND,
    (event: DragEvent) => {
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) {
        event.preventDefault();
        const file = files[0];
        if (file && file.type.startsWith('image/')) {
          context.storeImage(file).then(
            (imageSource) => {
              void handle.insertImage(imageSource);
            },
            (err: unknown) => {
              context.onError(err);
            }
          );
        }
        return true;
      }
      return false;
    },
    COMMAND_PRIORITY_HIGH
  );

  if (context.initialSnapshot !== null) {
    const parsed: unknown = JSON.parse(context.initialSnapshot);
    if (!isValidLexicalSnapshot(parsed)) {
      throw new Error('Invalid Lexical snapshot JSON structure');
    }
    const parsedState = editor.parseEditorState(parsed);
    editor.setEditorState(parsedState);
    historyState.current = { editor, editorState: editor.getEditorState() };
    historyState.undoStack = [];
    historyState.redoStack = [];
  } else {
    editor.update(
      () => {
        const root = $getRoot();
        if (root.getChildrenSize() === 0) {
          root.append($createParagraphNode());
        }
      },
      { tag: 'initial', discrete: true }
    );
    historyState.current = { editor, editorState: editor.getEditorState() };
    historyState.undoStack = [];
    historyState.redoStack = [];
  }

  isInitialized = true;

  let rememberedSelection: RangeSelection | null = null;

  function $restoreRememberedSelection(): RangeSelection | null {
    const saved = rememberedSelection;
    rememberedSelection = null;
    if (saved) {
      $setSelection(saved.clone());
    }
    const sel = $getSelection();
    if ($isRangeSelection(sel)) {
      return sel;
    }
    return null;
  }
  // Programmatic edits must not depend on the deprecated window.event global.
  const commandOptions = {
    discrete: true,
    event: new Event('editor-lab-command'),
  } satisfies EditorUpdateOptions;

  const handle: EditorHandle = {
    getSnapshot(): string {
      const state = editor.getEditorState();
      return JSON.stringify(state.toJSON());
    },

    getHTML(): string {
      let rawHtml = '';
      editor.read(() => {
        rawHtml = $generateHtmlFromNodes(editor, null);
      });
      return cleanFragment(rawHtml);
    },

    command(cmd: FormatCommand): void {
      switch (cmd.kind) {
        case 'undo':
          editor.update(() => {
            rememberedSelection = null;
            editor.dispatchCommand(UNDO_COMMAND, undefined);
          }, commandOptions);
          break;
        case 'redo':
          editor.update(() => {
            rememberedSelection = null;
            editor.dispatchCommand(REDO_COMMAND, undefined);
          }, commandOptions);
          break;
        case 'bold':
          editor.update(() => {
            $restoreRememberedSelection();
            editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold');
          }, commandOptions);
          break;
        case 'italic':
          editor.update(() => {
            $restoreRememberedSelection();
            editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic');
          }, commandOptions);
          break;
        case 'heading':
          editor.update(() => {
            const selection = $restoreRememberedSelection();
            if (selection) {
              const anchor = selection.anchor.getNode();
              const topElement = anchor.getKey() === 'root' ? anchor : anchor.getTopLevelElementOrThrow();
              if ($isHeadingNode(topElement)) {
                $setBlocksType(selection, () => $createParagraphNode());
              } else {
                $setBlocksType(selection, () => $createHeadingNode('h2'));
              }
            }
          }, commandOptions);
          break;
        case 'bulletList':
          editor.update(() => {
            const selection = $restoreRememberedSelection();
            if (selection) {
              const anchor = selection.anchor.getNode();
              const listNode = $getNearestNodeOfType(anchor, ListNode);
              if ($isListNode(listNode) && listNode.getListType() === 'bullet') {
                editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
              } else {
                editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
              }
            } else {
              editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
            }
          }, commandOptions);
          break;
        case 'orderedList':
          editor.update(() => {
            const selection = $restoreRememberedSelection();
            if (selection) {
              const anchor = selection.anchor.getNode();
              const listNode = $getNearestNodeOfType(anchor, ListNode);
              if ($isListNode(listNode) && listNode.getListType() === 'number') {
                editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
              } else {
                editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
              }
            } else {
              editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
            }
          }, commandOptions);
          break;
        case 'quote':
          editor.update(() => {
            const selection = $restoreRememberedSelection();
            if (selection) {
              const anchor = selection.anchor.getNode();
              const topElement = anchor.getKey() === 'root' ? anchor : anchor.getTopLevelElementOrThrow();
              if ($isQuoteNode(topElement)) {
                $setBlocksType(selection, () => $createParagraphNode());
              } else {
                $setBlocksType(selection, () => $createQuoteNode());
              }
            }
          }, commandOptions);
          break;
        case 'codeBlock':
          editor.update(() => {
            const selection = $restoreRememberedSelection();
            if (selection) {
              const anchor = selection.anchor.getNode();
              const topElement = anchor.getKey() === 'root' ? anchor : anchor.getTopLevelElementOrThrow();
              if ($isCodeNode(topElement)) {
                $setBlocksType(selection, () => $createParagraphNode());
              } else {
                $setBlocksType(selection, () => $createCodeNode());
              }
            }
          }, commandOptions);
          break;
        case 'link':
          editor.update(() => {
            const selection = $restoreRememberedSelection();
            if (!cmd.url) {
              $toggleLink(null);
              return;
            }
            if (selection && !selection.isCollapsed()) {
              $toggleLink(cmd.url);
            } else {
              const linkNode = $createLinkNode(cmd.url);
              const textNode = $createTextNode(cmd.url);
              linkNode.append(textNode);
              if (selection) {
                selection.insertNodes([linkNode]);
              } else {
                const root = $getRoot();
                const lastChild = root.getLastChild();
                if (lastChild && 'append' in lastChild && typeof lastChild.append === 'function') {
                  lastChild.append(linkNode);
                } else {
                  const p = $createParagraphNode();
                  p.append(linkNode);
                  root.append(p);
                }
              }
              textNode.selectEnd();
            }
          }, commandOptions);
          break;
        default: {
          const _exhaustive: never = cmd;
          throw new Error(`Unhandled command: ${JSON.stringify(_exhaustive)}`);
        }
      }
    },

    rememberSelection(): void {
      editor.read(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) {
          rememberedSelection = sel.clone();
        }
      });
    },

    insertImage(image: ImageSource): void {
      editor.update(() => {
        const selection = $restoreRememberedSelection();
        const node = $createImageNode(image);
        if (selection) {
          selection.insertNodes([node]);
        } else {
          $getRoot().append(node);
        }
        const next = node.getNextSibling();
        if (!next) {
          const p = $createParagraphNode();
          node.insertAfter(p);
          p.select();
        }
      }, commandOptions);
    },

    insertMedia(media: MediaSource): void {
      editor.update(() => {
        const selection = $restoreRememberedSelection();
        const node = $createMediaNode(media);
        if (selection) {
          selection.insertNodes([node]);
        } else {
          $getRoot().append(node);
        }
        const next = node.getNextSibling();
        if (!next) {
          const p = $createParagraphNode();
          node.insertAfter(p);
          p.select();
        }
      }, commandOptions);
    },

    focus(): void {
      editor.update(() => editor.focus(), commandOptions);
    },

    destroy(): void {
      unregisterRichText();
      unregisterHistory();
      unregisterList();
      unregisterUpdateListener();
      unregisterDrop();
      editor.setRootElement(null);
      contentEditable.remove();
    },
  };

  return handle;
};

export default createLexicalEditor;
