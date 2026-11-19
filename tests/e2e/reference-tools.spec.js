const { test, expect } = require('@playwright/test');
const fs = require('fs');
const tools = require('../../data/tools.json');

const toolPath = slug => `/tools/writing-text/${slug}/index.html`;
const engineSlugs = tools.filter(tool => tool.engine).map(tool => tool.slug);

async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((el, next) => {
    el.value = String(next);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function readDownload(download) {
  return fs.readFileSync(await download.path(), 'utf8');
}

test.describe('Reference-backed writing tools', () => {
  test('01 Text Cleaner applies default rules, auto-processes, undoes and copies', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(toolPath('text-cleaner'));
    // The reference starts with no rules selected; Default is the common preset.
    await page.click('#cln-default');

    await page.fill('#cln-input', '  <p>Hello   world 😀</p>  ');
    await page.click('#cln-clean');
    await expect(page.locator('#cln-input')).toHaveValue('Hello world ');
    await expect(page.locator('#cln-output')).toHaveValue('Hello world ');
    await expect(page.locator('#cln-status')).toContainText('Text cleaned.');

    await page.click('#cln-undo');
    await expect(page.locator('#cln-input')).toHaveValue('  <p>Hello   world 😀</p>  ');
    await expect(page.locator('#cln-status')).toContainText('Undid the last change.');

    await page.click('#cln-none');
    await expect(page.locator('#cln-status')).toContainText('No changes were needed.');
    await page.fill('#cln-input', '  Mixed   CASE 😀  ');
    // Typing alone does not process; a control change or button click does.
    await page.click('#cln-none');
    await expect(page.locator('#cln-output')).toHaveValue('  Mixed   CASE 😀  ');

    await page.click('#cln-default');
    await expect(page.locator('#cln-trim')).toBeChecked();
    await expect(page.locator('input[name="cln-letterCase"][value="noChange"]')).toBeChecked();
    await page.click('#cln-all');
    await expect(page.locator('#cln-wrapLines')).toBeChecked();
    await expect(page.locator('#cln-stripHtmlTags')).toBeChecked();

    await page.click('#cln-copy');
    await expect(page.locator('#cln-status')).toContainText('Text copied to clipboard!');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await page.locator('#cln-input').inputValue());
    expect(errors).toEqual([]);
  });

  test('01 Text Cleaner reports empty input and keeps the wrapping control independent', async ({ page }) => {
    await page.goto(toolPath('text-cleaner'));
    await page.fill('#cln-input', '');
    await page.click('#cln-clean');
    await expect(page.locator('#cln-output')).toHaveValue('');
    await expect(page.locator('#cln-status')).toContainText('No changes were needed.');
    await page.uncheck('#cln-wrapLines');
    expect(await page.locator('#cln-input').evaluate(el => el.style.whiteSpace)).toBe('pre');
    await page.check('#cln-wrapLines');
    expect(await page.locator('#cln-input').evaluate(el => el.style.whiteSpace)).toBe('normal');
  });

  test('06 Word Counter counts Unicode text, handles empty input, goals, uploads and copy', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(toolPath('word-counter'));
    await expect(page.locator('h1')).toHaveText('Word Counter & Text Statistics');

    await page.fill('#wc-input', 'Hello world. This is a test.');
    await expect(page.locator('#wc-words')).toHaveText('6');
    await expect(page.locator('#wc-chars')).toHaveText('28');
    await expect(page.locator('#wc-density tr').first()).not.toContainText('No keywords');

    await page.fill('#wc-input', '');
    await expect(page.locator('#wc-words')).toHaveText('0');
    await expect(page.locator('#wc-chars')).toHaveText('0');
    await expect(page.locator('#wc-density')).toContainText('No keywords to show yet.');

    await page.fill('#wc-goal', '5');
    await page.selectOption('#wc-goal-type', 'characters');
    await page.fill('#wc-input', 'abc');
    await expect(page.locator('#wc-goal-label')).toHaveText('3 / 5 characters (60%)');
    expect(await page.locator('#wc-goal-fill').evaluate(el => el.style.width)).toBe('60%');

    await page.locator('#wc-upload').setInputFiles({
      name: 'count.txt', mimeType: 'text/plain', buffer: Buffer.from('one two three')
    });
    await expect(page.locator('#wc-input')).toHaveValue('one two three');
    await expect(page.locator('#wc-words')).toHaveText('3');
    await expect(page.locator('#wc-status')).toContainText('File loaded.');

    await page.click('#wc-copy');
    await expect(page.locator('#wc-status')).toContainText('Text copied to clipboard.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('one two three');

    await page.click('#wc-clear');
    await expect(page.locator('#wc-input')).toHaveValue('');
    await expect(page.locator('#wc-status')).toContainText('Cleared.');
  });

  test('07 Lorem Ipsum Generator honours caps, formats, tabs, copy and download', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.goto(toolPath('lorem-ipsum-generator'));
        await expect(page.locator('#wli-preview')).not.toBeEmpty();
        await page.click('[data-quick="words"][data-n="50"]');
        await expect(page.locator('#wli-amount')).toHaveValue('50');
        await expect(page.locator('#wli-words')).toHaveText('50 words');
        const source = await page.locator('#wli-source').textContent();
        expect(source.trim().split(/\s+/)).toHaveLength(50);

        await page.locator('#wli-amount').fill('99999');
        await page.locator('#wli-amount').dispatchEvent('change');
        await expect(page.locator('#wli-amount')).toHaveValue('5000');
        await expect(page.locator('#wli-words')).toHaveText('5000 words');

        await page.check('input[name="wli-unit"][value="paragraphs"]');
        await page.locator('#wli-amount').fill('2');
        await page.locator('#wli-amount').dispatchEvent('change');
        await page.check('input[name="wli-format"][value="html"]');
        await expect(page.locator('#wli-source')).toContainText('<p>');
        await page.click('[data-tab="source"]');
        await expect(page.locator('#wli-source')).toBeVisible();
        await expect(page.locator('#wli-preview')).toBeHidden();

        await page.click('#wli-minus');
        await expect(page.locator('#wli-amount')).toHaveValue('1');
        await page.click('#wli-plus');
        await expect(page.locator('#wli-amount')).toHaveValue('2');

        await page.click('#wli-copy');
        await expect(page.locator('#wli-status')).toContainText('Text copied to clipboard.');
        const clipboard = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
        expect(clipboard).toBe((await page.locator('#wli-source').textContent()).replace(/\r\n/g, '\n'));
        await page.click('#wli-download');
      })()
    ]);
    expect(download.suggestedFilename()).toBe('lorem-ipsum.html');
    expect(await readDownload(download)).toContain('<p>');
  });

  test('08 Bionic Reading applies fixation rules, reading view, copy formats and download', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.goto(toolPath('bionic-reading'));
        await expect(page.locator('#br-preview b').first()).toBeVisible();
        await expect(page.locator('#br-stats')).toContainText('bold fixation point');

        await page.fill('#br-text', 'one two three four');
        await expect(page.locator('#br-count')).toHaveText('4 words');
        await expect(page.locator('#br-preview b')).toHaveCount(4);
        await page.check('input[name="br-sacc"][value="2"]');
        await expect(page.locator('#br-preview b')).toHaveCount(2);

        await setRange(page, 'br-fade', 60);
        await expect(page.locator('#br-fade-value')).toHaveText('60%');
        await expect(page.locator('.bionic-fade').first()).toBeVisible();
        await page.check('input[name="br-theme"][value="dark"]');
        await expect(page.locator('#br-preview')).toHaveClass(/theme-dark/);

        await page.click('#br-reading');
        await expect(page.locator('#br-rv')).toBeVisible();
        await page.click('#br-rv-theme');
        await expect(page.locator('#br-rv-theme')).toContainText('Light');
        await page.keyboard.press('Escape');
        await expect(page.locator('#br-rv')).toHaveCount(0);

        await page.click('#br-copy');
        await expect(page.locator('#br-status')).toContainText('Formatted text copied to clipboard.');
        expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('<b>');

        await page.click('#br-copy-md');
        await expect(page.locator('#br-status')).toContainText('Markdown copied to clipboard.');
        expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('**');

        await page.click('#br-download');
      })()
    ]);
    expect(download.suggestedFilename()).toBe('bionic-reading.html');
    expect(await readDownload(download)).toContain('<!DOCTYPE html>');

    await page.click('#br-clear');
    await expect(page.locator('#br-preview')).toBeEmpty();
    await page.click('#br-copy');
    await expect(page.locator('#br-status')).toContainText('Nothing to copy.');
  });

  test('09 AP Case Converter applies every switch and clears safely', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(toolPath('ap-case-converter'));

    await page.fill('#ap-input', 'the quick brown fox and a dog');
    await page.click('#ap-convert');
    await expect(page.locator('#ap-output')).toHaveText('The Quick Brown Fox and a Dog');
    await page.uncheck('#ap-titleCase');
    await page.click('#ap-convert');
    await expect(page.locator('#ap-output')).toHaveText('The quick brown fox and a dog');

    await page.check('#ap-titleCase');
    await page.fill('#ap-input', 'meeting in January in New York on 5');
    await page.click('#ap-convert');
    const styled = await page.locator('#ap-output').textContent();
    expect(styled).toContain('Jan.');
    expect(styled).toContain('N.Y.');
    expect(styled).toContain('five');

    await page.uncheck('#ap-monthAbbreviations');
    await page.uncheck('#ap-stateAbbreviations');
    await page.uncheck('#ap-numerals');
    await page.fill('#ap-input', 'January in New York on 5');
    await page.click('#ap-convert');
    await expect(page.locator('#ap-output')).toHaveText('January in New York on 5');

    await page.click('#ap-copy');
    await expect(page.locator('#ap-status')).toContainText('Output copied to clipboard.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('January in New York on 5');

    await page.click('#ap-clear');
    await expect(page.locator('#ap-input')).toHaveValue('');
    await expect(page.locator('#ap-output')).toBeEmpty();
  });

  test('10 Remove Extra Spaces handles paste, upload, oversized files, empty input and copy', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(toolPath('remove-extra-spaces'));

    await page.fill('#spaces-input', '  a\t b\n\n c  ');
    await page.click('#spaces-apply');
    await expect(page.locator('#spaces-result')).toHaveValue('a b c');
    await page.click('#spaces-copy');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('a b c');

    await page.locator('#spaces-upload').setInputFiles({
      name: 'spaces.txt', mimeType: 'text/plain', buffer: Buffer.from('one   two\nthree')
    });
    await expect(page.locator('#spaces-input')).toHaveValue('one   two\nthree');
    await page.click('#spaces-apply');
    await expect(page.locator('#spaces-result')).toHaveValue('one two three');

    await page.locator('#spaces-upload').setInputFiles({
      name: 'large.txt', mimeType: 'text/plain', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 32)
    });
    await expect(page.locator('#spaces-status')).toContainText('File is too large.');

    await page.fill('#spaces-input', '');
    await page.click('#spaces-apply');
    await expect(page.locator('#spaces-result')).toHaveValue('');
  });

  test('11 Find and Replace uses literal mode, live regex, errors, empty input and copy', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(toolPath('find-and-replace'));

    await page.fill('#fr-input', 'cat cat dog');
    await page.fill('#fr-find', 'cat');
    await page.fill('#fr-replace', 'dog');
    await expect(page.locator('#fr-case')).toBeChecked();
    await page.click('#fr-apply');
    await expect(page.locator('#fr-result')).toHaveValue('dog dog dog');
    await expect(page.locator('#fr-status')).toContainText('Replacement applied.');

    await page.click('#fr-copy');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('dog dog dog');

    // Unchecking case-sensitive switches Find to the reference's live-regex mode.
    await page.fill('#fr-input', 'a.b axb');
    await page.fill('#fr-find', 'a.b');
    await page.fill('#fr-replace', 'X');
    await page.uncheck('#fr-case');
    await page.click('#fr-apply');
    await expect(page.locator('#fr-result')).toHaveValue('X X');

    await page.fill('#fr-find', '[');
    await page.click('#fr-apply');
    await expect(page.locator('#fr-status')).toContainText('Invalid regular expression');

    await page.fill('#fr-input', '');
    await page.fill('#fr-find', 'cat');
    await page.click('#fr-apply');
    await expect(page.locator('#fr-result')).toHaveValue('');
  });

  test('12 Remove Emojis handles paste, file priority, special characters and copy', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(toolPath('remove-emojis'));

    await page.fill('#emoji-input', 'Café 😀❤️ hello');
    await page.click('#emoji-apply');
    await expect(page.locator('#emoji-result')).toHaveValue('Café  hello');
    await expect(page.locator('#emoji-status')).toContainText('Emoji removed.');

    await page.fill('#emoji-input', 'pasted text 😀');
    await page.locator('#emoji-upload').setInputFiles({
      name: 'emoji.txt', mimeType: 'text/plain', buffer: Buffer.from('from file 😀 done')
    });
    await expect(page.locator('#emoji-result')).toHaveValue('from file  done');
    await expect(page.locator('#emoji-status')).toContainText('File loaded and processed.');

    await page.click('#emoji-copy');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('from file  done');

    await page.fill('#emoji-input', '');
    await page.click('#emoji-apply');
    await expect(page.locator('#emoji-result')).toHaveValue('');
  });

  test('13 Text to List Converter covers splits, formats, errors, clear and copy', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(toolPath('text-to-list'));

    await page.fill('#tl-input', 'red, blue, green');
    await page.check('input[name="tl-split"][value="comma"]');
    await page.click('#tl-convert');
    await expect(page.locator('#tl-output')).toHaveText('• red\n• blue\n• green');
    await expect(page.locator('#tl-status')).toContainText('Conversion completed successfully!');

    await page.check('input[name="tl-format"][value="numbered"]');
    await page.click('#tl-convert');
    await expect(page.locator('#tl-output')).toHaveText('1. red\n2. blue\n3. green');
    await page.click('#tl-copy');
    expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe('1. red\n2. blue\n3. green');

    await page.check('input[name="tl-split"][value="custom"]');
    await page.check('input[name="tl-format"][value="bullet"]');
    await expect(page.locator('#tl-separator-wrap')).toBeVisible();
    await page.click('#tl-convert');
    await expect(page.locator('#tl-status')).toContainText('Please enter a custom separator');
    await expect(page.locator('#tl-output')).toBeEmpty();

    await page.fill('#tl-separator', '|');
    await page.fill('#tl-input', 'a|b');
    await page.click('#tl-convert');
    await expect(page.locator('#tl-output')).toHaveText('• a\n• b');

    await page.fill('#tl-input', '');
    await page.click('#tl-convert');
    await expect(page.locator('#tl-status')).toContainText('Please enter some text to convert');

    await page.click('#tl-clear');
    await expect(page.locator('#tl-status')).toContainText('All fields cleared!');
  });

  test('14 Text Filter removes and highlights whole words without executing markup', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(toolPath('text-filter'));

    await page.fill('#tf-input', 'apple and banana apricot');
    await page.fill('#tf-highlight', 'banana');
    await page.fill('#tf-remove', 'apple');
    await page.click('#tf-apply');
    await expect(page.locator('#tf-output')).toHaveText(' and banana apricot');
    await expect(page.locator('#tf-output .highlight')).toHaveText('banana');
    await page.click('#tf-copy');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(' and banana apricot');

    await page.fill('#tf-input', '<img src=x onerror="window.__xss=1"> keep');
    await page.fill('#tf-highlight', '');
    await page.fill('#tf-remove', '');
    await page.click('#tf-apply');
    await expect(page.locator('#tf-output img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();

    await page.fill('#tf-input', '');
    await page.click('#tf-apply');
    await expect(page.locator('#tf-output')).toBeEmpty();
    await expect(page.locator('#tf-status')).toContainText('Filter applied.');
  });

  test('05 Redact Text never transmits text, saves a private key, restores and rejects bad keys', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const [keyDownload] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.goto(toolPath('text-redactor'));
        await expect(page.locator('.hint.warning')).toContainText('never transmitted');
        await page.fill('#rdx-input', 'Email jane@example.com');
        await expect(page.locator('#rdx-output')).toHaveValue('Email [EMAIL_1]');
        await expect(page.locator('#rdx-found')).toHaveText('1 item found');

        await page.click('#rdx-copy');
        await expect(page.locator('#rdx-status')).toContainText('Redacted text copied.');
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Email [EMAIL_1]');

        await page.fill('#rdx-restore-input', 'Re: [EMAIL_1]');
        await page.click('#rdx-restore');
        await expect(page.locator('#rdx-restored')).toHaveValue('Re: jane@example.com');

        await page.click('#rdx-save-key');
      })()
    ]);
    expect(keyDownload.suggestedFilename()).toBe('redaction-key.json');
    const key = await readDownload(keyDownload);
    expect(key).toContain('original values you hid');
    expect(key).toContain('jane@example.com');

    await page.check('input[name="rdx-style"][value="bars"]');
    await expect(page.locator('#rdx-output')).toHaveValue('Email █████');
    await page.fill('#rdx-restore-input', 'Email █████');
    await page.click('#rdx-restore');
    await expect(page.locator('#rdx-status')).toContainText('Black bars cannot be reversed.');

    await page.locator('#rdx-key-file').setInputFiles({
      name: 'bad-key.txt', mimeType: 'text/plain', buffer: Buffer.from('not json')
    });
    await expect(page.locator('#rdx-status')).toContainText('not a valid redaction key');

    await page.click('#rdx-clear');
    await expect(page.locator('#rdx-output')).toHaveValue('');
  });

  test('04 Bank Statement Converter parses, checks, exports and rejects malformed text', async ({ page }) => {
    await page.goto(toolPath('bank-statement-converter'));
    await expect(page.locator('.hint.warning')).toContainText('does not extract PDF text');
    await expect(page.locator('#bk-sum-transactions')).toHaveText('4');
    await expect(page.locator('#bk-sum-check')).toHaveText('Balances match');

    const sample = '01/15/2026 Coffee Shop 4.50 995.50\n01/16/2026 Salary 1,000.00 1,995.50\n01/17/2026 Rent -650.00 1,345.50';
    await page.fill('#bk-input', sample);
    await page.click('#bk-parse');
    await expect(page.locator('#bk-sum-transactions')).toHaveText('3');
    await expect(page.locator('#bk-sum-in')).toHaveText('1004.50');
    await expect(page.locator('#bk-sum-out')).toHaveText('650.00');
    await expect(page.locator('.statement-table tbody tr')).toHaveCount(3);

    const [csv, qif] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#bk-csv')
    ]);
    expect(csv.suggestedFilename()).toBe('transactions.csv');
    expect(await readDownload(csv)).toContain('1000.00');
    const [qifDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#bk-qif')
    ]);
    expect(qifDownload.suggestedFilename()).toBe('transactions.qif');
    expect(await readDownload(qifDownload)).toContain('!Type:Bank');

    await page.fill('#bk-input', 'this is not a statement');
    await page.click('#bk-parse');
    await expect(page.locator('#bk-status')).toContainText('No transactions found.');
    await expect(page.locator('#bk-table')).toContainText('No transactions were found.');

    await page.selectOption('#bk-date-order', 'dmy');
    await page.fill('#bk-input', '03/04/2026 Shop 2.00 20.00');
    await page.click('#bk-parse');
    await expect(page.locator('.statement-table tbody tr').first()).toContainText('2026-04-03');

    await page.fill('#bk-input', '');
    await page.click('#bk-parse');
    await expect(page.locator('#bk-status')).toContainText('Paste statement text first.');
  });

  test('03 Handwriting to Font samples glyphs, previews a PNG and states its scope', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(toolPath('handwriting-to-font-converter'));
    await expect(page.locator('.hint.warning')).toContainText('does not generate an installable OpenType');
    await expect(page.locator('#hf-chars .chip')).toHaveCount(26);

    await page.click('#hf-eraser');
    await expect(page.locator('#hf-status')).toContainText('Eraser selected.');
    await page.click('#hf-pen');
    await expect(page.locator('#hf-status')).toContainText('Pen selected.');

    await page.check('input[name="hf-group"][value="num"]');
    await expect(page.locator('#hf-chars .chip')).toHaveCount(10);
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#hf-chars .chip.is-active')).toHaveText('1');

    await page.check('input[name="hf-group"][value="upper"]');
    await page.locator('#hf-pad').scrollIntoViewIfNeeded();
    const box = await page.locator('#hf-pad').boundingBox();
    await page.mouse.move(box.x + 150, box.y + 110);
    await page.mouse.down();
    await page.mouse.move(box.x + 290, box.y + 220, { steps: 6 });
    await page.mouse.up();
    await page.fill('#hf-text', 'A');
    await page.click('#hf-build');
    await expect(page.locator('#hf-status')).toContainText('1 glyph(s) previewed');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#hf-download')
    ]);
    expect(download.suggestedFilename()).toBe('handwriting-preview.png');
    await expect(page.locator('#hf-status')).toContainText('Preview image downloaded.');
    expect(errors).toEqual([]);
  });

  for (const width of [320, 375, 768, 1024, 1440]) {
    test(`reference workspaces have no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const slug of engineSlugs) {
        const errors = [];
        const onError = error => errors.push(error.message);
        page.on('pageerror', onError);
        await page.goto(toolPath(slug));
        await expect(page.locator('h1'), `${slug} heading should be visible`).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${slug} overflowed at ${width}px`).toBeLessThanOrEqual(1);
        expect(errors, `${slug} threw a browser error at ${width}px`).toEqual([]);
        page.off('pageerror', onError);
      }
    });
  }
});
