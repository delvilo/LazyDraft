import { test, expect } from '@playwright/test';

const isMac = process.platform === 'darwin';
const undoKey = isMac ? 'Meta+z' : 'Control+z';
const redoKey = isMac ? 'Meta+Shift+z' : 'Control+y';

test.describe('Boshiamy IME Composition and Commit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForLoadState('domcontentloaded');

    // Ensure IME is enabled by default for tests in this suite
    const toggle = page.locator('#boshiamyToggle');
    const isAlreadyEnabled = await toggle.evaluate((el) => el.getAttribute('aria-pressed') === 'true');
    if (!isAlreadyEnabled) {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    }

    // Clear note
    const note = page.locator('#note');
    await note.fill('');
  });

  test('full native commit: commits candidate via execCommand and triggers autosave', async ({ page }) => {
    const note = page.locator('#note');
    await note.focus();

    // Type radical 'a' -> candidate 0 is '對'
    await page.keyboard.type('a');

    const candidateBar = page.locator('#boshiamyBar');
    await expect(candidateBar).toBeVisible();

    // Space commits candidate 0 without inserting a space character
    await page.keyboard.press('Space');

    // Candidate bar should hide upon successful commit
    await expect(candidateBar).toBeHidden();

    // Note should have '對'
    await expect(note).toHaveValue('對');

    // Verify autosave updates localStorage note with debounce
    await expect.poll(() => page.evaluate(() => localStorage.getItem('note'))).toBe('對');
  });

  test('selection replacement and native Undo/Redo', async ({ page }) => {
    const toggle = page.locator('#boshiamyToggle');

    // Temporarily disable IME to enter base text natively with real keyboard
    const isEnabled = await toggle.evaluate((el) => el.getAttribute('aria-pressed') === 'true');
    if (isEnabled) {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    }

    const note = page.locator('#note');
    await note.fill('');
    await note.focus();

    // Type initial text natively
    await page.keyboard.type('ABC');
    await expect(note).toHaveValue('ABC');

    // Re-enable IME and refocus note
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await note.focus();

    // Select 'B' (index 1 to 2)
    await note.evaluate((el) => {
      el.setSelectionRange(1, 2);
    });

    // Type 'a' and commit candidate '對'
    await page.keyboard.type('a');
    await expect(page.locator('#boshiamyBar')).toBeVisible();
    await page.keyboard.press('Enter');

    // Selection 'B' was replaced by '對'
    await expect(note).toHaveValue('A對C');

    // Native undo should revert the commit and restore 'B'
    await page.keyboard.press(undoKey);
    await expect(note).toHaveValue('ABC');

    // Native redo should re-apply the commit
    await page.keyboard.press(redoKey);
    await expect(note).toHaveValue('A對C');
  });

  test('pending plain Undo vs shortcuts: pending radicals cancel without modifying document', async ({ page }) => {
    const toggle = page.locator('#boshiamyToggle');

    // Step 1: Establish deterministic native undo baseline with IME disabled
    const isEnabled = await toggle.evaluate((el) => el.getAttribute('aria-pressed') === 'true');
    if (isEnabled) {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    }

    const note = page.locator('#note');
    await note.fill('');
    await note.focus();

    // Type base text natively
    await page.keyboard.type('Base');
    await expect(note).toHaveValue('Base');

    // Step 2: Enable IME and commit a candidate to establish a distinct native undo boundary
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await note.focus();

    await page.keyboard.type('a');
    await expect(page.locator('#boshiamyBar')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(note).toHaveValue('Base對');

    // Step 3: Type pending radical 'a' (composition active)
    await page.keyboard.type('a');
    const candidateBar = page.locator('#boshiamyBar');
    await expect(candidateBar).toBeVisible();
    await expect(page.locator('#boshiamyBuffer')).toHaveText(/^[aA]$/);

    // Step 4: First Ctrl/Cmd+Z while radicals are pending must ONLY cancel composition
    await page.keyboard.press(undoKey);

    // Candidate bar must disappear
    await expect(candidateBar).toBeHidden();

    // Document text must remain unchanged ('Base對')
    await expect(note).toHaveValue('Base對');

    // Step 5: Second Ctrl/Cmd+Z when buffer is empty executes native textarea undo,
    // restoring the previous deterministic state ('Base')
    await page.keyboard.press(undoKey);
    await expect(note).toHaveValue('Base');
  });

  test('candidate clicking preserves textarea focus and commits candidate', async ({ page }) => {
    const note = page.locator('#note');
    await note.focus();

    // Type 'aa' to produce multiple candidates (e.g., '寸', '丶')
    await page.keyboard.type('aa');

    const candidateBar = page.locator('#boshiamyBar');
    await expect(candidateBar).toBeVisible();

    const candItems = page.locator('.boshiamy-cand-item');
    await expect(candItems.first()).toBeVisible();

    // Capture target candidate text
    const secondCand = candItems.nth(1);
    const targetChar = await secondCand.locator('.boshiamy-cand-char').textContent();

    // Click the candidate item directly
    await secondCand.click();

    // Candidate bar closes
    await expect(candidateBar).toBeHidden();

    // Note has received the candidate text
    await expect(note).toHaveValue(targetChar.trim());

    // Textarea must retain focus
    const isFocused = await note.evaluate((el) => document.activeElement === el);
    expect(isFocused).toBe(true);
  });

  test('native commit failure: composition retained when execCommand fails, recovers on retry', async ({ page }) => {
    // Navigate to fixture to test controller boundary under genuine fault injection
    await page.goto('/tests/ime-browser/fixture.html');
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(async () => {
      const { TextareaController } = await import('../../js/ime/v89/textarea-controller.js');
      const textarea = document.getElementById('fixture-note');
      const testDict = { a: ['測試'] };
      window._testController = new TextareaController(textarea, testDict);
      window._testController.setEnabled(true);

      // Fault injection: make execCommand return false
      window._origExecCommand = document.execCommand;
      document.execCommand = function (command, showUI, value) {
        if (command === 'insertText') {
          return false;
        }
        return window._origExecCommand.apply(document, arguments);
      };
    });

    const fixtureNote = page.locator('#fixture-note');
    await fixtureNote.focus();

    await page.keyboard.type('a');
    const bar = page.locator('#boshiamyBar');
    await expect(bar).toBeVisible();

    // Try committing
    await page.keyboard.press('Space');

    // Because execCommand returned false, commit failed:
    // Composition must remain active, buffer and candidates retained, error message shown
    await expect(bar).toBeVisible();
    await expect(page.locator('#boshiamyBuffer')).toHaveText(/^[aA]$/);
    await expect(fixtureNote).toHaveValue('');
    const status = page.locator('#boshiamyStatus');
    await expect(status).toBeVisible();

    // Restore genuine execCommand
    await page.evaluate(() => {
      document.execCommand = window._origExecCommand;
    });

    // Retry commit: now it succeeds!
    await page.keyboard.press('Space');
    await expect(bar).toBeHidden();
    await expect(fixtureNote).toHaveValue('測試');
  });

  test('synchronous input listener reentrancy: new radical during commit is preserved', async ({ page }) => {
    const note = page.locator('#note');
    await note.fill('');
    await note.focus();

    // Attach native input listener that synchronously starts a new composition on the first commit
    await page.evaluate(() => {
      const el = document.getElementById('note');
      el.addEventListener(
        'input',
        () => {
          // Dispatch keydown for radical 'a' synchronously during the execCommand commit
          const evt = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
          el.dispatchEvent(evt);
        },
        { once: true }
      );
    });

    // Type initial radical 'a' -> candidate 0 is '對'
    await page.keyboard.type('a');
    const candidateBar = page.locator('#boshiamyBar');
    await expect(candidateBar).toBeVisible();

    // Commit first radical with Space
    await page.keyboard.press('Space');

    // First commit inserted '對' into textarea
    await expect(note).toHaveValue('對');

    // The synchronously dispatched radical 'a' was NOT clobbered by the first commit finishing:
    // Candidate bar must remain visible with the new radical buffer!
    await expect(candidateBar).toBeVisible();
    await expect(page.locator('#boshiamyBuffer')).toHaveText(/^[aA]$/);

    // Commit the second radical
    await page.keyboard.press('Space');

    // Note now has both commits ('對對') and candidate bar is closed
    await expect(note).toHaveValue('對對');
    await expect(candidateBar).toBeHidden();
  });
});
