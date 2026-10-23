import { test, expect } from '@playwright/test';

async function openQr(page) {
  await page.evaluate(() => {
    window.qrShown = new Promise(resolve => {
      window.jQuery('#textQrModal').one('shown.bs.modal', () => resolve());
    });
  });
  await page.locator('#textQrToggle').click();
  await page.evaluate(() => window.qrShown);
}

async function closeQr(page, escape = false) {
  await page.evaluate(() => {
    window.qrHidden = new Promise(resolve => {
      window.jQuery('#textQrModal').one('hidden.bs.modal', () => resolve());
    });
  });
  if (escape) await page.keyboard.press('Escape');
  else await page.locator('#textQrModal .modal-footer button').click();
  await page.evaluate(() => window.qrHidden);
}

test.describe('Text QR snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
  });

  for (const [name, text] of [
    ['Unicode and markup', '  中文 😀 <script>alert(1)</script>\n第二行\t保留空白  \n'],
    ['whitespace-only text', ' \n\t '],
    ['exactly 2048 UTF-8 bytes', '字'.repeat(682) + 'AB']
  ]) {
    test(`captures the full draft: ${name}`, async ({ page }) => {
      const note = page.locator('#note');
      await note.fill(text);
      await note.evaluate(el => el.setSelectionRange(0, 0));
      await openQr(page);
      await expect(page.locator('#textQrSource')).toContainText('全文');
      await expect(page.locator('#textQrPreview')).toHaveValue(text);
      await expect(page.locator('#textQrPreview')).toHaveAttribute('readonly', '');
      await expect(page.locator('#textQrCode svg')).toBeVisible();
      await expect(page.locator('#textQrStatus')).toBeHidden();
      await expect(page.locator('#textQrByteCount')).toHaveText(
        `${new TextEncoder().encode(text).length.toLocaleString('en-US')} / 2,048 UTF-8 bytes`);
      await closeQr(page);
      await expect(note).toHaveValue(text);
    });
  }

  test('selection takes precedence over an oversized draft without changing text or selection', async ({ page }) => {
    const text = '不傳'.repeat(400) + '[選取 🎯\n含空白  ]' + '不傳';
    const selected = '[選取 🎯\n含空白  ]';
    const start = text.indexOf(selected);
    const end = start + selected.length;
    const note = page.locator('#note');
    await note.fill(text);
    await note.evaluate((el, range) => el.setSelectionRange(...range), [start, end]);
    await openQr(page);
    await expect(page.locator('#textQrSource')).toContainText('選取');
    await expect(page.locator('#textQrPreview')).toHaveValue(selected);
    await expect(page.locator('#textQrCode svg')).toBeVisible();
    await closeQr(page, true);
    await expect(note).toHaveValue(text);
    expect(await note.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([start, end]);
  });

  for (const [name, text] of [['empty', ''], ['2049 UTF-8 bytes', '字'.repeat(683)]]) {
    test(`refuses ${name} without truncating`, async ({ page }) => {
      await page.locator('#note').fill(text);
      await openQr(page);
      await expect(page.locator('#textQrCode svg')).toHaveCount(0);
      await expect(page.locator('#textQrStatus')).toBeVisible();
      await expect(page.locator('#textQrPreview')).toHaveValue(text);
      await closeQr(page, true);
      await expect(page.locator('#textQrStatus')).toHaveText('');
      await expect(page.locator('#note')).toHaveValue(text);
    });
  }

  test('freezes the rendered snapshot, clears on close and captures fresh content on reopen', async ({ page }) => {
    const note = page.locator('#note');
    await note.fill('第一筆內容 😀');
    await openQr(page);
    const path = await page.locator('#textQrCode path').getAttribute('d');
    await note.evaluate(el => {
      el.value = '背景修改後的第二筆內容';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#textQrPreview')).toHaveValue('第一筆內容 😀');
    await expect(page.locator('#textQrCode path')).toHaveAttribute('d', path);
    await closeQr(page);
    await expect(page.locator('#textQrCode')).toBeEmpty();
    await expect(page.locator('#textQrPreview')).toHaveValue('');
    await expect(page.locator('#textQrSource')).toHaveText('');
    await expect(page.locator('#textQrByteCount')).toHaveText('');
    await expect(page.locator('#textQrToggle')).toBeFocused();
    await openQr(page);
    await expect(page.locator('#textQrPreview')).toHaveValue('背景修改後的第二筆內容');
    await expect(page.locator('#textQrCode svg')).toBeVisible();
    await closeQr(page, true);
  });

  test('closing during encoder loading cannot restore the old snapshot when loading finishes', async ({ page }) => {
    let release;
    const loading = new Promise(resolve => { release = resolve; });
    await page.route('**/js/libraries/qrcodegen-1.8.0.js', async route => {
      await loading;
      await route.continue();
    });
    try {
      await page.locator('#note').fill('關閉後不得再顯示的文字');
      await openQr(page);
      await expect(page.locator('#textQrCode')).toBeEmpty();
      await closeQr(page);
      release();
      await page.waitForFunction(() => Boolean(window.qrcodegen));
      await expect(page.locator('#textQrPreview')).toHaveValue('');
      await expect(page.locator('#textQrCode')).toBeEmpty();
      await page.locator('#note').fill('重新開啟的新快照');
      await openQr(page);
      await expect(page.locator('#textQrPreview')).toHaveValue('重新開啟的新快照');
      await expect(page.locator('#textQrCode svg')).toBeVisible();
      await closeQr(page, true);
    } finally {
      release();
    }
  });
});

test('first QR generation works after offline reload without any previous online generation', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    await page.goto('/index.html');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise(resolve => {
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
        });
      }
    });
    await context.setOffline(true);
    await page.reload();
    const text = '離線首度產生 QR\nOffline 😀';
    await page.locator('#note').fill(text);
    await openQr(page);
    await expect(page.locator('#textQrPreview')).toHaveValue(text);
    await expect(page.locator('#textQrCode svg')).toBeVisible();
    await expect(page.locator('#textQrStatus')).toBeHidden();
    await closeQr(page, true);
  } finally {
    await context.close();
  }
});
