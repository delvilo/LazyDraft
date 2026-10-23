export function getLabBase(): URL {
  if (typeof document === 'undefined') {
    throw new Error('getLabBase must be called in a browser environment');
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="editor-lab-base"]');
  if (!meta) {
    throw new Error('Missing <meta name="editor-lab-base">');
  }
  const content = meta.getAttribute('content');
  if (!content) {
    throw new Error('<meta name="editor-lab-base"> missing content attribute');
  }
  const baseUri = document.baseURI || window.location.href;
  return new URL(content, baseUri);
}
