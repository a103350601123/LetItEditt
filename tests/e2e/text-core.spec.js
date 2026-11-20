const path = require('path');
const { test, expect } = require('@playwright/test');

const corePath = path.resolve(__dirname, '../../js/text-core.js');

test('TextCore HTML-to-Markdown preserves nested blocks in a real browser', async ({ page }) => {
  await page.goto('about:blank');
  await page.addScriptTag({ path: corePath });

  const markdown = await page.evaluate(() => window.TextCore.htmlToMarkdown(`
    <h2>Heading <em>two</em></h2>
    <p>Hello <strong>world</strong> with <a href="https://example.com/a(b)">a link</a> and <code>x=1</code>.</p>
    <ul><li>One<ul><li>Nested</li></ul></li><li>Two</li></ul>
    <ol start="3"><li>Three</li></ol>
    <table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>A</td><td>1 | 2</td></tr></tbody></table>
    <blockquote><p>Quoted line</p></blockquote>
    <pre><code class="language-js">const x = 1;</code></pre>
    <p><img src="/pic.png" alt="Example image" title="Pic"></p>
    <script>alert('x')</script>
  `));

  expect(markdown).toContain('## Heading _two_');
  expect(markdown).toContain('Hello **world** with [a link](https://example.com/a(b)) and `x=1`.');
  expect(markdown).toContain('- One\n    - Nested\n- Two');
  expect(markdown).toContain('3. Three');
  expect(markdown).toContain('| Name | Value |');
  expect(markdown).toContain('| A | 1 \\| 2 |');
  expect(markdown).toContain('> Quoted line');
  expect(markdown).toContain('```js\nconst x = 1;\n```');
  expect(markdown).toContain('![Example image](/pic.png "Pic")');
  expect(markdown).not.toContain("alert('x')");
});
