import { test, expect } from '@playwright/test';

async function openDisabledApp(page) {
  await page.goto('/index.html');
  await expect(page.locator('#boshiamyToggle')).toHaveAttribute('aria-pressed', 'false');
}

async function enable(page) {
  await page.locator('#boshiamyToggle').click();
  await expect(page.locator('#boshiamyToggle')).toHaveAttribute('aria-pressed', 'true');
}

async function disable(page) {
  await page.locator('#boshiamyToggle').click();
  await expect(page.locator('#boshiamyToggle')).toHaveAttribute('aria-pressed', 'false');
}

async function commitCandidate(page) {
  const note = page.locator('#note');
  await note.fill('');
  await note.focus();
  await page.keyboard.type('a');
  await expect(page.locator('#boshiamyBar')).toBeVisible();
  await expect(page.locator('.boshiamy-cand-char').first()).toHaveText('對');
  await page.keyboard.press('Space');
  await expect(note).toHaveValue('對');
}

test.describe('Boshiamy dictionary IndexedDB cache', () => {
  test('warm reload commits candidates without fetching the JSON dictionary again', async ({ page }) => {
    let fetches = 0;
    page.on('request', request => {
      if (request.url().includes('boshiamy-dict.json')) fetches++;
    });
    await openDisabledApp(page);
    await enable(page);
    await commitCandidate(page);
    await disable(page);
    expect(fetches).toBe(1);

    await page.route('**/boshiamy-dict.json', route => route.abort('blockedbyclient'));
    await openDisabledApp(page);
    await enable(page);
    await commitCandidate(page);
    expect(fetches).toBe(1);
  });

  test('a dictionary from another release cannot replace current candidates', async ({ page }) => {
    await openDisabledApp(page);
    await page.evaluate(async () => {
      const { packDictionary } = await import('/js/ime/v89/dictionary-table.js');
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('lazydraft-ime-cache', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('dictionaries');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('dictionaries', 'readwrite');
          const oldSource = new URL('js/ime/previous-release/boshiamy-dict.json', location.href).href;
          transaction.objectStore('dictionaries').put(packDictionary({ a: ['舊字'] }), oldSource);
          transaction.oncomplete = () => { db.close(); resolve(); };
          transaction.onabort = () => { db.close(); reject(transaction.error); };
        };
      });
    });
    await enable(page);
    await commitCandidate(page);
  });

  test('cache read errors fall back to the actual JSON dictionary', async ({ page }) => {
    await page.addInitScript(() => {
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (...args) {
        if (this.transaction.db.name === 'lazydraft-ime-cache') {
          throw new DOMException('Unavailable cache read', 'TransactionInactiveError');
        }
        return get.apply(this, args);
      };
    });
    await openDisabledApp(page);
    await enable(page);
    await commitCandidate(page);
  });

  test('failed cache writes keep input usable and allow a fresh load after reload', async ({ page }) => {
    await page.addInitScript(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.transaction.db.name === 'lazydraft-ime-cache') {
          throw new DOMException('Cache quota exhausted', 'QuotaExceededError');
        }
        return put.apply(this, args);
      };
    });
    let fetches = 0;
    page.on('request', request => {
      if (request.url().includes('boshiamy-dict.json')) fetches++;
    });
    await openDisabledApp(page);
    await enable(page);
    await commitCandidate(page);
    await disable(page);
    await openDisabledApp(page);
    await enable(page);
    await commitCandidate(page);
    expect(fetches).toBe(2);
  });

  test('denied IndexedDB access does not prevent Chinese input', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        get() { throw new DOMException('Storage access denied', 'SecurityError'); },
      });
    });
    await openDisabledApp(page);
    await enable(page);
    await commitCandidate(page);
  });

  test('dictionary cache cycles preserve the local draft and existing Tabbypad data', async ({ page }) => {
    await openDisabledApp(page);
    const archived = await page.evaluate(async () => {
      const note = await window.TabbypadStorage.createNote('Existing user archive');
      localStorage.setItem('note', 'Existing user draft');
      return note;
    });
    await openDisabledApp(page);
    await enable(page);
    await disable(page);
    await openDisabledApp(page);
    await enable(page);

    await expect(page.locator('#note')).toHaveValue('Existing user draft');
    const retained = await page.evaluate(async id => ({
      draft: localStorage.getItem('note'),
      archive: await window.TabbypadStorage.getNoteById(id),
    }), archived.id);
    expect(retained).toEqual({ draft: 'Existing user draft', archive: archived });
  });
});
