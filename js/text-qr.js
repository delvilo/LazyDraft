(function () {
  'use strict';

  const MAX_BYTES = 2048;
  const QUIET_ZONE = 4;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let encoderReady = null;

  function loadEncoder() {
    if (!encoderReady) {
      encoderReady = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'js/libraries/qrcodegen-1.8.0.js';
        script.onload = () => {
          script.remove();
          resolve(window.qrcodegen);
        };
        script.onerror = () => {
          script.remove();
          reject(new Error('Unable to load the local QR encoder'));
        };
        document.head.append(script);
      }).catch(error => {
        encoderReady = null;
        throw error;
      });
    }
    return encoderReady;
  }

  function renderQr(bytes, { QrCode, QrSegment }) {
    // Explicit UTF-8 ECI: scanners must not guess an encoding for Chinese/emoji.
    const qr = QrCode.encodeSegments([
      QrSegment.makeEci(26),
      QrSegment.makeBytes(bytes)
    ], QrCode.Ecc.MEDIUM);
    const extent = qr.size + QUIET_ZONE * 2;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${extent} ${extent}`);
    svg.setAttribute('width', String(extent * 4));
    svg.setAttribute('height', String(extent * 4));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '本次文字快照的 QR 圖碼');
    svg.setAttribute('shape-rendering', 'crispEdges');
    const background = document.createElementNS(SVG_NS, 'rect');
    background.setAttribute('width', '100%');
    background.setAttribute('height', '100%');
    background.setAttribute('fill', '#fff');
    const path = document.createElementNS(SVG_NS, 'path');
    let data = '';
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size;) {
        if (!qr.getModule(x, y)) {
          x++;
          continue;
        }
        const start = x;
        while (x < qr.size && qr.getModule(x, y)) x++;
        const length = x - start;
        data += `M${start + QUIET_ZONE},${y + QUIET_ZONE}h${length}v1h-${length}z`;
      }
    }
    path.setAttribute('d', data);
    path.setAttribute('fill', '#000');
    svg.append(background, path);
    return svg;
  }

  window.initTextQr = function (textarea) {
    const modal = $('#textQrModal');
    const source = document.getElementById('textQrSource');
    const byteCount = document.getElementById('textQrByteCount');
    const preview = document.getElementById('textQrPreview');
    const status = document.getElementById('textQrStatus');
    const code = document.getElementById('textQrCode');
    let pendingBytes = null;
    let sequence = 0;

    function clearSnapshot() {
      sequence++;
      pendingBytes = null;
      code.replaceChildren();
      preview.value = '';
      source.textContent = '';
      byteCount.textContent = '';
      status.textContent = '';
      status.hidden = true;
    }

    modal.on('show.bs.modal', function () {
      clearSnapshot();
      const selected = textarea.selectionStart !== textarea.selectionEnd;
      const text = selected
        ? textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)
        : textarea.value;
      const bytes = new TextEncoder().encode(text);
      source.textContent = selected ? '來源：選取內容' : '來源：草稿全文';
      byteCount.textContent = `${bytes.length.toLocaleString('en-US')} / 2,048 UTF-8 bytes`;
      preview.value = text;
      if (bytes.length === 0) {
        status.textContent = '沒有可傳送的內容，請先輸入文字。';
      } else if (bytes.length > MAX_BYTES) {
        status.textContent = '超過 2,048 UTF-8 bytes，請縮短內容或選取較短的文字後重新開啟。不會截斷或分割內容。';
      } else {
        pendingBytes = bytes;
        const token = sequence;
        status.textContent = '正在產生 QR…';
        loadEncoder().then(encoder => {
          if (token !== sequence) return;
          const snapshot = pendingBytes;
          pendingBytes = null;
          code.append(renderQr(snapshot, encoder));
          status.textContent = '';
          status.hidden = true;
        }).catch(error => {
          if (token !== sequence) return;
          pendingBytes = null;
          console.error('Text QR generation failed', error);
          status.textContent = '無法產生 QR，請關閉後重試；草稿未變更。';
          status.hidden = false;
        });
      }
      status.hidden = status.textContent === '';
      // Pending payloads are cleared on close; only the encoder is retained for reuse.
    });
    modal.on('hide.bs.modal', clearSnapshot);
    modal.on('hidden.bs.modal', function () {
      document.getElementById('textQrToggle').focus();
    });
    $('#textQrToggle').on('click', function () {
      modal.modal('show');
    });
  };
})();
