import { Jodit } from 'jodit';
import 'jodit/es2021/jodit.min.css';
import { cleanFragment, mediaHTML } from '../media.ts';
import type {
  EditorContext,
  EditorFactory,
  EditorHandle,
  FormatCommand,
  ImageSource,
  MediaSource,
} from '../contracts.ts';

function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return false;
  const docTheme =
    document.documentElement.getAttribute('data-theme') ||
    document.body.getAttribute('data-theme');
  if (docTheme) return docTheme === 'dark';
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
  );
}

const createJoditAdapter: EditorFactory = async (
  context: EditorContext
): Promise<EditorHandle> => {
  const target = document.createElement('textarea');
  context.host.appendChild(target);

  let savedRange: Range | null = null;
  let liveRange: Range | null = null;
  let isInitialized = false;

  const jodit = Jodit.make(target, {
    theme: isDarkTheme() ? 'dark' : 'default',
    toolbarAdaptive: false,
    buttons: [
      'undo',
      'redo',
      '|',
      'bold',
      'italic',
      'underline',
      'strikethrough',
      '|',
      'paragraph',
      '|',
      'ul',
      'ol',
      '|',
      'blockquote',
      '|',
      'link',
      'image',
      'video',
      '|',
      'fullsize',
    ],
    uploader: {
      insertImageAsBase64URI: false,
      url: '',
      showTabInFileSelector: true,
      customUploadFunction: async (
        requestData: FormData,
        showProgress: (progress: number) => void
      ) => {
        const files: File[] = [];
        if (requestData && typeof requestData.values === 'function') {
          for (const val of requestData.values()) {
            if (val instanceof File) {
              files.push(val);
            }
          }
        }

        if (files.length === 0) {
          return {
            success: false,
            time: new Date().toISOString(),
            data: {
              messages: ['未選取檔案。'],
              files: [],
              baseurl: '',
            },
          };
        }

        showProgress(20);
        try {
          const urls: string[] = [];
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const stored = await context.storeImage(file);
            urls.push(stored.src);
            showProgress(20 + Math.round(((i + 1) / files.length) * 70));
          }
          showProgress(100);

          return {
            success: true,
            time: new Date().toISOString(),
            data: {
              baseurl: '',
              files: urls,
              isImages: urls.map(() => true),
            },
          };
        } catch (err) {
          context.onError(err);
          return {
            success: false,
            time: new Date().toISOString(),
            data: {
              messages: [err instanceof Error ? err.message : String(err)],
              files: [],
              baseurl: '',
            },
          };
        }
      },
    },
    controls: {
      image: {
        icon: 'image',
        tooltip: 'Insert image',
        exec: () => context.pickImage(),
      },
      video: {
        icon: 'video',
        tooltip: 'Insert video',
        exec: () => {
          context.requestMedia();
        },
      },
    },
  });

  await jodit.waitForReady();

  jodit.container.addEventListener(
    'click',
    (e: MouseEvent) => {
      const targetEl = e.target instanceof Element ? e.target : null;
      const btn = targetEl?.closest(
        'button[data-ref="video"], .jodit-toolbar-button_video button, button[data-ref="image"], .jodit-toolbar-button_image button'
      );
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        if (btn.closest('[data-ref="image"], .jodit-toolbar-button_image')) context.pickImage();
        else context.requestMedia();
      }
    },
    { capture: true }
  );

  if (context.initialSnapshot !== null) {
    jodit.value = context.initialSnapshot;
  }
  jodit.history.clear();

  isInitialized = true;

  jodit.events.on('change', () => {
    if (isInitialized) {
      context.onChange();
    }
  });

  function syncTheme(): void {
    if (isDarkTheme()) {
      jodit.container.classList.add('jodit_theme_dark');
    } else {
      jodit.container.classList.remove('jodit_theme_dark');
    }
  }

  const themeObserver = new MutationObserver(() => syncTheme());
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  syncTheme();

  const selectionDocument = context.host.ownerDocument;
  const trackLiveSelection = (): void => {
    const selection = selectionDocument.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (jodit.editor.contains(range.startContainer) && jodit.editor.contains(range.endContainer)) {
      liveRange = range.cloneRange();
    }
  };
  const onSelectionChange = (): void => {
    if (context.host.contains(selectionDocument.activeElement)) trackLiveSelection();
  };
  jodit.editor.addEventListener('keyup', trackLiveSelection);
  jodit.editor.addEventListener('mouseup', trackLiveSelection);
  selectionDocument.addEventListener('selectionchange', onSelectionChange);

  function restoreSavedSelection(): void {
    const range = savedRange;
    savedRange = null;
    if (range && jodit.editor.contains(range.startContainer) && jodit.editor.contains(range.endContainer)) {
      jodit.s.selectRange(range);
    }
  }

  const handle: EditorHandle = {
    getSnapshot: () => {
      return jodit.value;
    },
    getHTML: () => {
      return cleanFragment(jodit.value);
    },
    command: (command: FormatCommand) => {
      restoreSavedSelection();
      // Close pending typing so each explicit edit has its own undo step.
      if (command.kind !== 'undo' && command.kind !== 'redo') {
        jodit.e.fire('internalUpdate');
      }
      switch (command.kind) {
        case 'bold':
          jodit.execCommand('bold');
          break;
        case 'italic':
          jodit.execCommand('italic');
          break;
        case 'heading': {
          const current = jodit.s.current();
          const currentEl =
            current instanceof Element
              ? current
              : current?.parentElement instanceof Element
                ? current.parentElement
                : null;
          const isHeading = Boolean(
            currentEl?.closest('h1, h2, h3, h4, h5, h6')
          );
          if (isHeading) {
            jodit.execCommand('formatBlock', false, 'p');
          } else {
            jodit.execCommand('formatBlock', false, 'h2');
          }
          break;
        }
        case 'bulletList':
          jodit.execCommand('insertUnorderedList');
          break;
        case 'orderedList':
          jodit.execCommand('insertOrderedList');
          break;
        case 'quote': {
          const current = jodit.s.current();
          const currentEl =
            current instanceof Element
              ? current
              : current?.parentElement instanceof Element
                ? current.parentElement
                : null;
          const isQuote = Boolean(currentEl?.closest('blockquote'));
          if (isQuote) {
            jodit.execCommand('formatBlock', false, 'p');
          } else {
            jodit.execCommand('formatBlock', false, 'blockquote');
          }
          break;
        }
        case 'codeBlock': {
          const current = jodit.s.current();
          const currentEl =
            current instanceof Element
              ? current
              : current?.parentElement instanceof Element
                ? current.parentElement
                : null;
          const isPre = Boolean(currentEl?.closest('pre'));
          if (isPre) {
            jodit.execCommand('formatBlock', false, 'p');
          } else {
            jodit.execCommand('formatBlock', false, 'pre');
          }
          break;
        }
        case 'undo':
          jodit.execCommand('undo');
          break;
        case 'redo':
          jodit.execCommand('redo');
          break;
        case 'link': {
          const range = jodit.s.range;
          if (range.collapsed) {
            const a = jodit.createInside.element('a');
            a.href = command.url;
            a.textContent = command.url;
            jodit.s.insertNode(a, false, false);
          } else {
            jodit.s.commitStyle({
              element: 'a',
              attributes: {
                href: command.url,
              },
            });
          }
          break;
        }
        default: {
          const _exhaustive: never = command;
          return _exhaustive;
        }
      }
      jodit.synchronizeValues();
      context.onChange();
    },
    rememberSelection: () => {
      trackLiveSelection();
      savedRange = liveRange;
    },
    insertImage: (image: ImageSource) => {
      restoreSavedSelection();
      jodit.e.fire('internalUpdate');
      const img = jodit.createInside.element('img');
      img.setAttribute('src', image.src);
      img.setAttribute('alt', image.alt || '');
      jodit.s.insertImage(img);
      jodit.synchronizeValues();
      context.onChange();
    },
    insertMedia: (media: MediaSource) => {
      restoreSavedSelection();
      jodit.e.fire('internalUpdate');
      jodit.s.insertHTML(`<figure>${mediaHTML(media)}</figure><p><br></p>`);
      jodit.synchronizeValues();
      context.onChange();
    },
    focus: () => {
      jodit.focus();
    },
    destroy: () => {
      themeObserver.disconnect();
      jodit.editor.removeEventListener('keyup', trackLiveSelection);
      jodit.editor.removeEventListener('mouseup', trackLiveSelection);
      selectionDocument.removeEventListener('selectionchange', onSelectionChange);
      try {
        jodit.destruct();
      } catch (err) {
        context.onError(err);
      }
      target.remove();
    },
  };

  return handle;
};

export default createJoditAdapter;
