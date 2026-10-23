import { test, expect } from '@playwright/test';

test.describe('Boshiamy IME Application Lifecycle', () => {
  test('cold disabled: dictionary is not fetched on startup and input remains native', async ({ page }) => {
    let dictFetched = false;
    page.on('request', (req) => {
      if (req.url().includes('boshiamy-dict.json')) {
        dictFetched = true;
      }
    });

    await page.goto('/index.html');
    await page.waitForLoadState('networkidle');

    // Dictionary must not be fetched on cold disabled startup
    expect(dictFetched).toBe(false);

    // Toggle button should be inactive with aria-pressed="false"
    const toggle = page.locator('#boshiamyToggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    // Clear existing welcome note draft before asserting exact native typing
    const note = page.locator('#note');
    await note.fill('');
    await note.focus();
    await page.keyboard.type('test');
    await expect(note).toHaveValue('test');

    const candidateBar = page.locator('#boshiamyBar');
    await expect(candidateBar).toBeHidden();
  });

  test('enabling and saved preference: toggle activates, persists across reload', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('userChosenSpellCheck', 'Yes'));
    await page.goto('/index.html');
    await page.waitForLoadState('domcontentloaded');

    const toggle = page.locator('#boshiamyToggle');
    const prefCheckbox = page.locator('#boshiamyImePref');

    // Initially inactive
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    // Click toggle to enable
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(prefCheckbox).toBeChecked();
    await expect(page.locator('#note')).toHaveAttribute('spellcheck', 'false');
    await expect(page.locator('#spellCheck')).toBeDisabled();
    await expect(page.locator('#spellCheck')).not.toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('userChosenSpellCheck'))).toBe('Yes');

    // Verify localStorage preference
    const savedPref = await page.evaluate(() => localStorage.getItem('userChosenBoshiamy'));
    expect(savedPref).toBe('Yes');

    // Reload page; saved preference should restore enabled state
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const reloadedToggle = page.locator('#boshiamyToggle');
    await expect(reloadedToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#note')).toHaveAttribute('spellcheck', 'false');
    await expect(page.locator('#spellCheck')).toBeDisabled();

    // Verify IME responds to radical typing
    const note = page.locator('#note');
    await note.fill('');
    await note.focus();
    await page.keyboard.type('a');

    const candidateBar = page.locator('#boshiamyBar');
    await expect(candidateBar).toBeVisible();
    await expect(page.locator('#boshiamyBuffer')).toHaveText(/^[aA]$/);

    // Cancel pending buffer with Escape
    await page.keyboard.press('Escape');
    await expect(candidateBar).toBeHidden();
    await reloadedToggle.click();
    await expect(note).toHaveAttribute('spellcheck', 'true');
    await expect(page.locator('#spellCheck')).toBeEnabled();
    await expect(page.locator('#spellCheck')).toBeChecked();
  });

  test('rapid enable-disable during delayed load: respects target state', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('userChosenSpellCheck', 'Yes'));
    // Intercept dictionary request to simulate network latency
    let fulfillDict;
    const dictPromise = new Promise((resolve) => {
      fulfillDict = resolve;
    });

    await page.route('**/js/ime/v89/boshiamy-dict.json', async (route) => {
      await dictPromise;
      await route.continue();
    });

    await page.goto('/index.html');
    await page.waitForLoadState('domcontentloaded');

    const toggle = page.locator('#boshiamyToggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    // Click to enable (starts loading)
    await toggle.click();

    // Wait until aria-busy="true" is set
    await expect(toggle).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#note')).toHaveAttribute('spellcheck', 'false');
    await expect(page.locator('#spellCheck')).toBeDisabled();

    // While loading, rapidly click again to cancel/disable
    await toggle.click();
    await expect(page.locator('#note')).toHaveAttribute('spellcheck', 'true');
    await expect(page.locator('#spellCheck')).toBeEnabled();

    // Allow dictionary load to finish
    fulfillDict();

    // IME must settle in disabled state and not be busy
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveAttribute('aria-busy', 'false');

    // Verify typing is native, not intercepted
    const note = page.locator('#note');
    await note.fill('');
    await note.focus();
    await page.keyboard.type('a');
    await expect(note).toHaveValue('a');
    await expect(page.locator('#boshiamyBar')).toBeHidden();
  });

  test('load error then explicit retry: recovers on retry', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('userChosenSpellCheck', 'Yes'));
    let shouldFail = true;
    await page.route('**/js/ime/v89/boshiamy-dict.json', async (route) => {
      if (shouldFail) {
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    await page.goto('/index.html');
    await page.waitForLoadState('domcontentloaded');

    const toggle = page.locator('#boshiamyToggle');

    // First attempt fails
    await toggle.click();

    // Wait for failure state to settle
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#note')).toHaveAttribute('spellcheck', 'true');
    await expect(page.locator('#spellCheck')).toBeEnabled();
    expect(await page.evaluate(() => localStorage.getItem('userChosenSpellCheck'))).toBe('Yes');

    // Fix network for retry
    shouldFail = false;

    // Second attempt (explicit retry)
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#note')).toHaveAttribute('spellcheck', 'false');
    await expect(page.locator('#spellCheck')).toBeDisabled();

    // Verify functionality after successful retry
    const note = page.locator('#note');
    await note.fill('');
    await note.focus();
    await page.keyboard.type('a');
    await expect(page.locator('#boshiamyBar')).toBeVisible();

    await page.keyboard.press('Escape');
  });

  test('startup intent pauses spellcheck before the module loads, and reset cancels that intent', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('userChosenBoshiamy', 'Yes');
      localStorage.setItem('userChosenSpellCheck', 'Yes');
    });
    let releaseModule;
    const moduleReady = new Promise(resolve => { releaseModule = resolve; });
    let dictionaryFetched = false;
    page.on('request', request => {
      if (request.url().includes('boshiamy-dict.json')) dictionaryFetched = true;
    });
    await page.route('**/js/ime/v89/boshiamy.js', async route => {
      await moduleReady;
      await route.continue();
    });
    try {
      await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
      const note = page.locator('#note');
      const spellcheck = page.locator('#spellCheck');
      await expect(spellcheck).toBeDisabled();
      await expect(note).toHaveAttribute('spellcheck', 'false');
      await page.locator('#boshiamyToggle').click();
      await expect(note).toHaveAttribute('spellcheck', 'true');
      await expect(spellcheck).toBeEnabled();
      await page.locator('#boshiamyToggle').click();
      await expect(note).toHaveAttribute('spellcheck', 'false');
      await page.locator('a#preferences').click();
      await page.locator('#resetPreferences').click();
      await expect(note).toHaveAttribute('spellcheck', 'true');
      await expect(spellcheck).toBeEnabled();
      await expect(spellcheck).toBeChecked();
      releaseModule();
      await expect(page.locator('#boshiamyToggle')).toHaveAttribute('aria-busy', 'false');
      await expect(page.locator('#boshiamyToggle')).toHaveAttribute('aria-pressed', 'false');
      expect(dictionaryFetched).toBe(false);
      expect(await page.evaluate(() => localStorage.getItem('userChosenBoshiamy'))).toBeNull();
      expect(await page.evaluate(() => localStorage.getItem('userChosenSpellCheck'))).toBeNull();
    } finally {
      releaseModule();
    }
  });

  test('offline first enable: works via Service Worker precache', async ({ browser }) => {
    const context = await browser.newContext({
      serviceWorkers: 'allow',
    });
    const page = await context.newPage();

    // Load page and wait for Service Worker to activate
    await page.goto('/index.html');
    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        return !!reg.active;
      }
      return false;
    });

    // Short pause to ensure precache is populated
    await page.waitForTimeout(500);

    // Go offline
    await context.setOffline(true);

    // Enable Boshiamy while offline
    const toggle = page.locator('#boshiamyToggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    // Candidate lookup must work offline
    const note = page.locator('#note');
    await note.fill('');
    await note.focus();
    await page.keyboard.type('a');

    const candidateBar = page.locator('#boshiamyBar');
    await expect(candidateBar).toBeVisible();
    await expect(page.locator('#boshiamyBuffer')).toHaveText(/^[aA]$/);

    await page.keyboard.press('Escape');
    await context.close();
  });
});
