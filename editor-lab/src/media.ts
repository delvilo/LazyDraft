import DOMPurify from 'dompurify';
import type { ImageSource, MediaSource } from './contracts.ts';

export function parseImageURL(input: string): ImageSource {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Image URL cannot be empty');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid image URL: "${input}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid image URL protocol: "${parsed.protocol}". Only http: and https: are allowed.`);
  }

  const rawFilename = parsed.pathname.split('/').filter(Boolean).pop();
  let alt = 'image';
  if (rawFilename) {
    const dotIndex = rawFilename.lastIndexOf('.');
    const baseName = dotIndex > 0 ? rawFilename.slice(0, dotIndex) : rawFilename;
    try {
      alt = decodeURIComponent(baseName);
    } catch {
      alt = baseName;
    }
  }

  return {
    src: parsed.href,
    alt: alt || 'image',
  };
}

export function parseMediaSource(input: string): MediaSource {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Media URL cannot be empty');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid media URL: "${input}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid media URL protocol: "${parsed.protocol}". Only http: and https: are allowed.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname;

  // YouTube hostnames and path formats
  if (
    hostname === 'youtube.com' ||
    hostname === 'www.youtube.com' ||
    hostname === 'm.youtube.com' ||
    hostname === 'www.youtube-nocookie.com'
  ) {
    let videoId: string | null = null;
    if (pathname === '/watch') {
      videoId = parsed.searchParams.get('v');
    } else if (pathname.startsWith('/embed/')) {
      videoId = pathname.slice('/embed/'.length).split('/')[0] || null;
    } else if (pathname.startsWith('/v/')) {
      videoId = pathname.slice('/v/'.length).split('/')[0] || null;
    } else if (pathname.startsWith('/shorts/')) {
      videoId = pathname.slice('/shorts/'.length).split('/')[0] || null;
    }
    if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return {
        kind: 'youtube',
        url: parsed.href,
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
      };
    }
  } else if (hostname === 'youtu.be') {
    const videoId = pathname.slice(1).split('/')[0] || null;
    if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return {
        kind: 'youtube',
        url: parsed.href,
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
      };
    }
  }

  // Vimeo hostnames and path formats
  if (hostname === 'vimeo.com' || hostname === 'www.vimeo.com') {
    const segments = pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    if (lastSegment && /^\d+$/.test(lastSegment)) {
      return {
        kind: 'vimeo',
        url: parsed.href,
        embedUrl: `https://player.vimeo.com/video/${lastSegment}`,
      };
    }
  } else if (hostname === 'player.vimeo.com') {
    if (pathname.startsWith('/video/')) {
      const videoId = pathname.slice('/video/'.length).split('/')[0];
      if (videoId && /^\d+$/.test(videoId)) {
        return {
          kind: 'vimeo',
          url: parsed.href,
          embedUrl: `https://player.vimeo.com/video/${videoId}`,
        };
      }
    }
  }

  // Direct audio and video formats
  const lowerPath = pathname.toLowerCase();
  if (
    lowerPath.endsWith('.mp4') ||
    lowerPath.endsWith('.m4v') ||
    lowerPath.endsWith('.webm') ||
    lowerPath.endsWith('.ogv')
  ) {
    return {
      kind: 'video',
      url: parsed.href,
    };
  }

  if (
    lowerPath.endsWith('.mp3') ||
    lowerPath.endsWith('.wav') ||
    lowerPath.endsWith('.ogg') ||
    lowerPath.endsWith('.oga') ||
    lowerPath.endsWith('.m4a') ||
    lowerPath.endsWith('.aac') ||
    lowerPath.endsWith('.flac')
  ) {
    return {
      kind: 'audio',
      url: parsed.href,
    };
  }

  throw new Error(
    `Unsupported media URL: "${input}". Supported: YouTube, Vimeo, direct video (.mp4, .webm, .ogv), and direct audio (.mp3, .wav, .ogg).`
  );
}

export function createMediaElement(media: MediaSource): HTMLElement {
  if (typeof document === 'undefined') {
    throw new Error('createMediaElement requires a DOM environment');
  }

  switch (media.kind) {
    case 'video': {
      const video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.src = media.url;
      video.setAttribute('data-lab-media', 'video');
      video.setAttribute('data-lab-source', media.url);
      video.className = 'lab-media-video';
      return video;
    }
    case 'audio': {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.src = media.url;
      audio.setAttribute('data-lab-media', 'audio');
      audio.setAttribute('data-lab-source', media.url);
      audio.className = 'lab-media-audio';
      return audio;
    }
    case 'youtube':
    case 'vimeo': {
      const container = document.createElement('div');
      container.className = 'lab-media-embed';
      container.setAttribute('data-lab-media', media.kind);
      container.setAttribute('data-lab-source', media.url);

      const iframe = document.createElement('iframe');
      iframe.src = media.embedUrl;
      iframe.title = media.kind === 'youtube' ? 'YouTube video player' : 'Vimeo video player';
      iframe.setAttribute('frameborder', '0');
      iframe.setAttribute(
        'allow',
        'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
      );
      iframe.setAttribute('allowfullscreen', 'true');
      iframe.setAttribute('loading', 'lazy');
      iframe.setAttribute('data-lab-media', media.kind);
      iframe.setAttribute('data-lab-source', media.url);

      container.appendChild(iframe);
      return container;
    }
    default: {
      const _exhaustive: never = media;
      throw new Error(`Unhandled media kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export function mediaHTML(media: MediaSource): string {
  const el = createMediaElement(media);
  return el.outerHTML;
}

export function cleanFragment(html: string): string {
  if (!html || typeof html !== 'string') {
    return '';
  }

  const config = {
    ALLOWED_TAGS: [
      'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr', 'blockquote', 'code', 'pre', 'span',
      'ul', 'ol', 'li',
      'img', 'video', 'audio', 'source', 'iframe',
      'div', 'figure', 'figcaption',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
      'details', 'summary', 'sub', 'sup', 'mark'
    ],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'title', 'class', 'style', 'target', 'rel',
      'controls', 'preload', 'loop', 'muted', 'playsinline', 'type',
      'width', 'height', 'frameborder', 'allow', 'allowfullscreen', 'loading'
    ],
    ALLOW_DATA_ATTR: true,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    ADD_DATA_URI_TAGS: ['img'],
  };

  const sanitized = DOMPurify.sanitize(html, config);
  const sanitizedString = typeof sanitized === 'string' ? sanitized : String(sanitized);

  if (typeof DOMParser === 'undefined') {
    return sanitizedString;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitizedString, 'text/html');

  const iframes = Array.from(doc.body.querySelectorAll('iframe'));
  for (const iframe of iframes) {
    const src = iframe.getAttribute('src') || '';
    if (!isTrustedEmbedUrl(src)) {
      const parent = iframe.parentElement;
      iframe.remove();
      if (parent && parent.classList.contains('lab-media-embed') && parent.childNodes.length === 0) {
        parent.remove();
      }
    }
  }

  const images = Array.from(doc.body.querySelectorAll('img'));
  for (const img of images) {
    const src = img.getAttribute('src') || '';
    if (!isSafeImageProtocol(src)) {
      img.remove();
    }
    else if (!src.toLowerCase().startsWith('data:')) {
      img.setAttribute('src', new URL(src, document.baseURI).href);
    }
  }

  for (const element of doc.body.querySelectorAll('[data-lab-source], video[src], audio[src], source[src]')) {
    for (const attribute of ['src', 'data-lab-source']) {
      if (attribute === 'src' && !element.matches('video, audio, source')) continue;
      const source = element.getAttribute(attribute);
      if (!source) continue;
      try {
        const url = new URL(source, document.baseURI);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('不支援的影音協定。');
        element.setAttribute(attribute, url.href);
      } catch {
        if (attribute === 'src') element.remove();
        else element.removeAttribute(attribute);
      }
    }
  }
  for (const player of doc.body.querySelectorAll('video, audio')) {
    if (!player.getAttribute('src') && !player.querySelector('source[src]')) player.remove();
  }

  return doc.body.innerHTML;
}

function isTrustedEmbedUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname === 'www.youtube-nocookie.com') {
      return /^\/embed\/[a-zA-Z0-9_-]{11}$/.test(parsed.pathname);
    }
    if (parsed.hostname === 'player.vimeo.com') {
      return /^\/video\/\d+$/.test(parsed.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

function isSafeImageProtocol(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('data:image/')) {
    return /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(trimmed);
  }
  try {
    const parsed = new URL(trimmed, 'http://localhost/');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
