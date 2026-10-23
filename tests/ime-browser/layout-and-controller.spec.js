import { test, expect } from '@playwright/test';

test.describe('Boshiamy IME Layout, OwnerDocument Adoption, and Teardown', () => {
  test('narrowed layout: candidate bar clamps within narrow viewport without clipping', async ({ page }) => {
    // Set a narrow mobile-like viewport
    await page.setViewportSize({ width: 340, height: 600 });
    await page.goto('/index.html');
    await page.waitForLoadState('domcontentloaded');

    const note = page.locator('#note');
    await note.fill('MMMMMMMMMMMMMMMMMM');
    await note.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b');
    await expect(page.locator('#boshiamyToggle')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('a');

    const candidateBar = page.locator('#boshiamyBar');
    await expect(candidateBar).toBeVisible();

    const box = await candidateBar.boundingBox();
    expect(box).not.toBeNull();

    // Candidate bar must stay inside the viewport
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(340);

    await page.keyboard.press('Escape');
  });

  test('floating editor commits in its own document and resumes after returning to the main tab', async ({ page, context }) => {
    await page.addInitScript(() => localStorage.setItem('userChosenSpellCheck', 'Yes'));
    await page.goto('/index.html');
    const note = page.locator('#note');
    await note.fill('');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b');
    await expect(page.locator('#boshiamyToggle')).toHaveAttribute('aria-pressed', 'true');
    const windowReady = context.waitForEvent('page');
    await page.locator('#pip').click();
    const floating = await windowReady;
    const floatingNote = floating.locator('#note');
    await floatingNote.focus();
    await floating.keyboard.type('a');
    await expect(floating.locator('#boshiamyBar')).toBeVisible();
    await floating.keyboard.press('Space');
    await expect(floatingNote).toHaveValue('對');
    await expect(floatingNote).toHaveAttribute('spellcheck', 'false');
    await floating.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b');
    await expect(floatingNote).toHaveAttribute('spellcheck', 'true');
    await expect(page.locator('#spellCheck')).toBeEnabled();
    await floating.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b');
    await expect(floatingNote).toHaveAttribute('spellcheck', 'false');
    await floating.close();
    await expect(note).toHaveValue('對');
    await expect(note).toHaveAttribute('spellcheck', 'false');
    await note.focus();
    await page.keyboard.type('a');
    await expect(page.locator('#boshiamyBar')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(note).toHaveValue('對對');
  });

  test('destroy removes candidate bar and detaches listeners without stale errors', async ({ page }) => {
    await page.goto('/tests/ime-browser/fixture.html');
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(async () => {
      const { TextareaController } = await import('../../js/ime/v89/textarea-controller.js');
      const textarea = document.getElementById('fixture-note');
      const testDict = { a: ['字'] };

      const controller = new TextareaController(textarea, testDict);
      controller.setEnabled(true);

      // Destroy controller
      controller.destroy();
    });

    // Verify candidate bar is removed from DOM
    const bar = page.locator('#boshiamyBar');
    await expect(bar).toHaveCount(0);

    // Typing in textarea should be standard native text with no errors
    const fixtureNote = page.locator('#fixture-note');
    await fixtureNote.focus();
    await page.keyboard.type('a');
    await expect(fixtureNote).toHaveValue('a');
    await expect(bar).toHaveCount(0);
  });
});
