import { test, expect } from '@playwright/test';

test.describe('Boshiamy IME Input Boundaries and Invalidation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForLoadState('domcontentloaded');

    const toggle = page.locator('#boshiamyToggle');
    const isAlreadyEnabled = await toggle.evaluate((el) => el.getAttribute('aria-pressed') === 'true');
    if (!isAlreadyEnabled) {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    }

    const note = page.locator('#note');
    await note.fill('');
  });

  test('candidate paging consumes boundaries; horizontal movement cancels and edits normally', async ({ page }) => {
    await page.goto('/tests/ime-browser/fixture.html');
    await page.evaluate(async () => {
      const { TextareaController } = await import('../../js/ime/v76/textarea-controller.js');
      const note = document.getElementById('fixture-note');
      const controller = new TextareaController(note, { a: Array.from('甲乙丙丁戊己庚辛壬癸子丑') });
      controller.setEnabled(true);
    });
    const note = page.locator('#fixture-note');
    await note.fill('abcdef');
    await note.evaluate(el => el.setSelectionRange(3, 3));
    await page.keyboard.type('a');
    await expect(page.locator('#boshiamyPage')).toHaveText('1/2');
    for (const key of ['ArrowUp', 'PageUp']) {
      await page.keyboard.press(key);
      await expect(page.locator('#boshiamyPage')).toHaveText('1/2');
    }
    await page.keyboard.press('PageDown');
    await expect(page.locator('#boshiamyPage')).toHaveText('2/2');
    for (const key of ['ArrowDown', 'PageDown']) {
      await page.keyboard.press(key);
      await expect(page.locator('#boshiamyPage')).toHaveText('2/2');
    }
    expect(await note.evaluate(el => el.selectionStart)).toBe(3);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#boshiamyBar')).toBeHidden();
    expect(await note.evaluate(el => el.selectionStart)).toBe(2);
    await expect(note).toHaveValue('abcdef');
    await page.keyboard.type('a');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('1');
    await expect(note).toHaveValue('ab丑cdef');
  });

  test('selection changes, pointer repositioning, and blur cancel without changing the draft', async ({ page }) => {
    const note = page.locator('#note');
    await note.fill('ABCDE');
    await note.evaluate(el => el.setSelectionRange(2, 2));
    await page.keyboard.type('a');
    const bar = page.locator('#boshiamyBar');
    await expect(bar).toBeVisible();
    await note.evaluate(el => el.setSelectionRange(3, 3));
    await expect(bar).toBeHidden();
    await expect(note).toHaveValue('ABCDE');
    await page.keyboard.type('a');
    await expect(bar).toBeVisible();
    await note.click({ position: { x: 400, y: 200 } });
    await expect(bar).toBeHidden();
    await expect(note).toHaveValue('ABCDE');
    await page.keyboard.type('a');
    await expect(bar).toBeVisible();
    await note.evaluate(el => el.blur());
    await expect(bar).toBeHidden();
    await expect(note).toHaveValue('ABCDE');
  });

  test('paste and external mutations invalidate pending composition', async ({ page }) => {
    const note = page.locator('#note');
    await note.focus();

    // Type pending radical
    await page.keyboard.type('a');
    const candidateBar = page.locator('#boshiamyBar');
    await expect(candidateBar).toBeVisible();

    // Simulating paste event invalidates pending composition
    await note.evaluate((el) => {
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
      el.dispatchEvent(pasteEvent);
    });
    await expect(candidateBar).toBeHidden();

    // Re-type radical
    await page.keyboard.type('a');
    await expect(candidateBar).toBeVisible();

    // External content mutation invalidates pending composition
    await note.evaluate((el) => {
      el.value = 'External content update';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(candidateBar).toBeHidden();
  });

  test('native composition handing off via synthetic composition events', async ({ page }) => {
    // Honestly named test: dispatches synthetic compositionstart to simulate native OS IME taking over
    const note = page.locator('#note');
    await note.focus();

    // Type Boshiamy radical
    await page.keyboard.type('a');
    const candidateBar = page.locator('#boshiamyBar');
    await expect(candidateBar).toBeVisible();

    // Synthetic compositionstart indicates native IME began
    await note.evaluate((el) => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, cancelable: true }));
    });

    // Boshiamy must yield and cancel its pending buffer immediately
    await expect(candidateBar).toBeHidden();

    // While native composition is active, radical keystrokes must pass through
    await note.evaluate((el) => {
      const keyEvent = new KeyboardEvent('keydown', { key: 'a', isComposing: true, bubbles: true, cancelable: true });
      el.dispatchEvent(keyEvent);
    });
    await expect(candidateBar).toBeHidden();

    // When native composition ends, Boshiamy resumes normal operation
    await note.evaluate((el) => {
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, cancelable: true }));
    });

    await page.keyboard.type('a');
    await expect(candidateBar).toBeVisible();
    await page.keyboard.press('Escape');
  });
});
