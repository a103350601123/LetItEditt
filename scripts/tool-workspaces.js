/* Build-time workspace templates for the faithful reference-tool engines.
 * Each function returns the interactive markup for one tool slug. The runtime
 * (js/reference-runtime.js) binds behaviour using the same element ids. */
'use strict';

function radios(name, options, selected) {
  return options.map(function (o) {
    const value = typeof o === 'string' ? o : o.value;
    const label = typeof o === 'string' ? o : o.label;
    const checked = value === selected ? ' checked' : '';
    return '<label class="opt"><input type="radio" name="' + name + '" value="' + value + '"' + checked + '> <span>' + label + '</span></label>';
  }).join('');
}

function checkbox(id, label, checked) {
  return '<label class="opt"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '> <span>' + label + '</span></label>';
}

function field(label, control) {
  return '<div class="field"><label>' + label + '</label>' + control + '</div>';
}

function checkGroup(prefix, items) {
  return items.map(function (item) {
    const id = prefix + '-' + item[0];
    return '<label class="opt"><input type="checkbox" id="' + id + '"' + (item[2] ? ' checked' : '') + '> <span>' + item[1] + '</span></label>';
  }).join('');
}

const WORKSPACES = {
  /* 07 — Lorem Ipsum Generator */
  'lorem-ipsum-generator': function () {
    return '<section class="container workspace engine-workspace" data-engine="lorem">\n' +
      '<div class="workspace-head"><h2>Generate placeholder text</h2><span class="card-tag">Runs in your browser</span></div>\n' +
      '<div class="engine-grid engine-lorem">\n' +
      '  <div class="engine-controls">\n' +
      '    <div class="opt-group"><span class="opt-title">Quick picks</span><div class="chip-row">\n' +
      '      <button type="button" class="chip" data-quick="paragraphs" data-n="1">1 paragraph</button>\n' +
      '      <button type="button" class="chip" data-quick="paragraphs" data-n="3">3 paragraphs</button>\n' +
      '      <button type="button" class="chip" data-quick="paragraphs" data-n="5">5 paragraphs</button>\n' +
      '      <button type="button" class="chip" data-quick="words" data-n="50">50 words</button>\n' +
      '      <button type="button" class="chip" data-quick="words" data-n="100">100 words</button>\n' +
      '      <button type="button" class="chip" data-quick="list" data-n="10">10 list items</button>\n' +
      '    </div></div>\n' +
      '    <div class="opt-group"><span class="opt-title">Amount</span><div class="stepper">\n' +
      '      <button type="button" id="wli-minus" aria-label="Decrease amount">−</button>\n' +
      '      <input type="number" id="wli-amount" min="1" max="100" step="1" value="3">\n' +
      '      <button type="button" id="wli-plus" aria-label="Increase amount">+</button>\n' +
      '    </div></div>\n' +
      '    <div class="opt-group"><span class="opt-title">Unit</span>' + radios('wli-unit', [
        { value: 'paragraphs', label: 'Paragraphs' }, { value: 'sentences', label: 'Sentences' },
        { value: 'words', label: 'Words' }, { value: 'list', label: 'List items' }
      ], 'paragraphs') + '</div>\n' +
      '    <div class="opt-group" id="wli-length-group"><span class="opt-title">Length</span>' + radios('wli-len', [
        { value: 'short', label: 'Short' }, { value: 'medium', label: 'Medium' }, { value: 'long', label: 'Long' }
      ], 'medium') + '</div>\n' +
      '    <div class="opt-group"><span class="opt-title">Style</span>' + radios('wli-style', [
        { value: 'classic', label: 'Classic vocabulary' }, { value: 'standard', label: 'Standard passage' }
      ], 'classic') + '</div>\n' +
      '    <div class="opt-group"><span class="opt-title">Format</span>' + radios('wli-format', [
        { value: 'plain', label: 'Plain text' }, { value: 'html', label: 'HTML' }, { value: 'markdown', label: 'Markdown' }
      ], 'plain') + '</div>\n' +
      '    <div class="opt-group" id="wli-list-group" hidden><span class="opt-title">List type</span>' + radios('wli-list', [
        { value: 'ul', label: 'Bulleted (ul)' }, { value: 'ol', label: 'Numbered (ol)' }
      ], 'ul') + '</div>\n' +
      '    <div class="opt-group"><span class="opt-title">Options</span>\n' +
      '      ' + checkbox('wli-start', 'Start with “Lorem ipsum dolor sit amet…”', true) + '\n' +
      '      ' + checkbox('wli-wrap', 'Wrap paragraphs in &lt;p&gt; tags (HTML)', true) + '\n' +
      '    </div>\n' +
      '    <div class="output-actions"><button type="button" class="btn" id="wli-generate">Generate text</button></div>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <div class="workspace-head"><h2>Output</h2><div class="tabs" role="tablist">\n' +
      '      <button type="button" class="tab is-active" data-tab="preview" role="tab">Preview</button>\n' +
      '      <button type="button" class="tab" data-tab="source" role="tab">Source</button>\n' +
      '    </div></div>\n' +
      '    <div id="wli-preview" class="output-box lorem-preview" role="tabpanel"></div>\n' +
      '    <pre id="wli-source" class="output-box" role="tabpanel" hidden></pre>\n' +
      '    <div class="status" id="wli-status" role="status" aria-live="polite"></div>\n' +
      '    <div class="engine-stats"><span id="wli-words">0 words</span><span id="wli-chars">0 characters</span><span id="wli-paras">0 paragraphs</span></div>\n' +
      '    <div class="output-actions">\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="wli-copy">Copy</button>\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="wli-regenerate">Regenerate</button>\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="wli-download">Download</button>\n' +
      '    </div>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  },

  /* 08 — Bionic Reading Converter */
  'bionic-reading': function () {
    return '<section class="container workspace engine-workspace" data-engine="bionic">\n' +
      '<div class="workspace-head"><h2>Interactive tool</h2><span class="card-tag">Runs in your browser</span></div>\n' +
      '<div class="engine-grid engine-bionic">\n' +
      '  <div class="engine-controls">\n' +
      '    ' + field('Text to convert', '<textarea id="br-text" rows="8" placeholder="Paste or type the text you want to read…"></textarea>') + '\n' +
      '    <div class="output-actions"><button type="button" class="btn btn-secondary btn-small" id="br-sample">Sample text</button><button type="button" class="btn btn-secondary btn-small" id="br-clear">Clear text</button><span class="pill" id="br-count">0 words</span></div>\n' +
      '    <div class="opt-group"><span class="opt-title">Fixation strength <small id="br-level-note">about 40%</small></span>' + radios('br-level', [
        { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }, { value: '5', label: '5' }
      ], '3') + '</div>\n' +
      '    <div class="opt-group"><span class="opt-title">Saccade (bold every)</span>' + radios('br-sacc', [
        { value: '1', label: 'Every word' }, { value: '2', label: '2nd word' }, { value: '3', label: '3rd word' }
      ], '1') + '</div>\n' +
      '    <div class="opt-group"><span class="opt-title">Fade the rest <small id="br-fade-value">Off</small></span><input type="range" id="br-fade" min="30" max="100" step="5" value="100"></div>\n' +
      '    <div class="opt-group"><span class="opt-title">Font</span>' + radios('br-font', [
        { value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }, { value: 'mono', label: 'Mono' }
      ], 'sans') + '</div>\n' +
      '    <div class="opt-group"><span class="opt-title">Font size <small id="br-size-value">18px</small></span><input type="range" id="br-size" min="14" max="28" step="1" value="18"></div>\n' +
      '    <div class="opt-group"><span class="opt-title">Line height <small id="br-line-height-value">1.7</small></span><input type="range" id="br-line-height" min="1.3" max="2.2" step="0.1" value="1.7"></div>\n' +
      '    <div class="opt-group"><span class="opt-title">Theme</span>' + radios('br-theme', [
        { value: 'light', label: 'Light' }, { value: 'sepia', label: 'Sepia' }, { value: 'dark', label: 'Dark' }
      ], 'light') + '</div>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <div class="workspace-head"><h2>Preview</h2><span class="pill" id="br-stats">0 points · about 1 min read</span></div>\n' +
      '    <div id="br-preview" class="output-box bionic-preview"></div>\n' +
      '    <div class="status" id="br-status" role="status" aria-live="polite"></div>\n' +
      '    <div class="output-actions">\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="br-reading">Reading view</button>\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="br-copy">Copy formatted</button>\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="br-copy-html">Copy as HTML</button>\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="br-copy-md">Copy as Markdown</button>\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="br-download">Download .html</button>\n' +
      '    </div>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  },

  /* 09 — AP Case Converter */
  'ap-case-converter': function () {
    return '<section class="container workspace engine-workspace" data-engine="ap-case">\n' +
      '<div class="workspace-head"><h2>Interactive tool</h2><span class="card-tag">Runs in your browser</span></div>\n' +
      '<div class="engine-grid engine-ap">\n' +
      '  <div class="engine-controls">\n' +
      '    ' + field('Input text', '<textarea id="ap-input" rows="9" placeholder="Enter your text here…"></textarea>') + '\n' +
      '    <div class="opt-group"><span class="opt-title">AP style rules</span>\n' +
      '      ' + checkbox('ap-titleCase', 'Apply title case rules', true) + '\n' +
      '      ' + checkbox('ap-lowercaseShortWords', 'Lowercase short words (3 letters or fewer)', true) + '\n' +
      '      ' + checkbox('ap-capitalizeFirstWord', 'Capitalize first word of sentences', true) + '\n' +
      '      ' + checkbox('ap-monthAbbreviations', 'Use AP style month abbreviations', true) + '\n' +
      '      ' + checkbox('ap-stateAbbreviations', 'Use AP style state abbreviations', true) + '\n' +
      '      ' + checkbox('ap-numerals', 'Apply AP style numeral rules', true) + '\n' +
      '    </div>\n' +
      '    <div class="output-actions"><button type="button" class="btn" id="ap-convert">Convert to AP Style</button><button type="button" class="btn btn-secondary btn-small" id="ap-clear">Clear</button></div>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <div class="workspace-head"><h2>Output</h2><button type="button" class="btn btn-secondary btn-small" id="ap-copy">Copy</button></div>\n' +
      '    <div id="ap-output" class="output-box"></div>\n' +
      '    <div class="status" id="ap-status" role="status" aria-live="polite"></div>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  },

  /* 10 — Remove Extra Spaces */
  'remove-extra-spaces': function () {
    return '<section class="container workspace engine-workspace" data-engine="extra-spaces">\n' +
      '<div class="workspace-head"><h2>Interactive tool</h2><span class="card-tag">Runs in your browser</span></div>\n' +
      '<div class="engine-grid engine-simple">\n' +
      '  <div class="engine-controls">\n' +
      '    ' + field('Upload text file (TXT/CSV/MD/DOCX)', '<input type="file" id="spaces-upload" accept=".txt,.csv,.tsv,.md,.markdown,.json,.log,.xml,.html,.htm,.docx,text/plain,text/csv">') + '\n' +
      '    ' + field('Or paste text here', '<textarea id="spaces-input" rows="8" placeholder="Paste text with extra spaces…"></textarea>') + '\n' +
      '    <div class="output-actions"><button type="button" class="btn" id="spaces-apply">Remove Extra Spaces</button></div>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <div class="workspace-head"><h2>Output</h2><button type="button" class="btn btn-secondary btn-small" id="spaces-copy">Copy</button></div>\n' +
      '    <textarea id="spaces-result" class="output-box" rows="8" readonly></textarea>\n' +
      '    <div class="status" id="spaces-status" role="status" aria-live="polite"></div>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  },

  /* 11 — Find and Replace */
  'find-and-replace': function () {
    return '<section class="container workspace engine-workspace" data-engine="find-replace">\n' +
      '<div class="workspace-head"><h2>Interactive tool</h2><span class="card-tag">Runs in your browser</span></div>\n' +
      '<div class="engine-grid engine-simple">\n' +
      '  <div class="engine-controls">\n' +
      '    <div class="two-cols">' + field('Find', '<input type="text" id="fr-find" placeholder="Text or pattern to find">') + field('Replace', '<input type="text" id="fr-replace" placeholder="Replacement text">') + '</div>\n' +
      '    <div class="opt-group"><span class="opt-title">Matching</span>\n' +
      '      ' + checkbox('fr-case', 'Case-sensitive literal match', true) + '\n' +
      '      ' + checkbox('fr-regex', 'Force regular expression (even when case-sensitive)') + '\n' +
      '      ' + checkbox('fr-whole', 'Whole word only') + '\n' +
      '    </div>\n' +
      '    <p class="hint">With Case-sensitive on, Find is literal. With it off, Find follows the reference behaviour and is compiled as a global, case-insensitive regular expression. Use Force regular expression to opt in explicitly.</p>\n' +
      '    ' + field('Upload TXT, CSV, MD or DOCX', '<input type="file" id="fr-upload" accept=".txt,.csv,.tsv,.md,.markdown,.json,.log,.xml,.html,.htm,.docx,text/plain,text/csv">') + '\n' +
      '    ' + field('Source text', '<textarea id="fr-input" rows="6" placeholder="Paste the source text here…"></textarea>') + '\n' +
      '    <p class="pill" id="fr-count">0 matches</p>\n' +
      '    <div class="output-actions">\n' +
      '      <button type="button" class="btn" id="fr-apply">Replace all</button>\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="fr-replace-one">Replace one</button>\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="fr-prev">Previous</button>\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="fr-next">Next</button>\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="fr-undo">Restore original</button>\n' +
      '    </div>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <div class="workspace-head"><h2>Source with matches</h2><span class="card-tag">Safe DOM preview</span></div>\n' +
      '    <div id="fr-preview" class="output-box"></div>\n' +
      '    <div class="workspace-head"><h2>Result</h2><div class="output-actions">\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="fr-copy">Copy</button>\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="fr-download">Download</button>\n' +
      '    </div></div>\n' +
      '    <textarea id="fr-result" class="output-box" rows="6" readonly></textarea>\n' +
      '    <div class="status" id="fr-status" role="status" aria-live="polite"></div>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  },

  /* 12 — Remove Emojis */
  'remove-emojis': function () {
    return '<section class="container workspace engine-workspace" data-engine="remove-emojis">\n' +
      '<div class="workspace-head"><h2>Interactive tool</h2><span class="card-tag">Runs in your browser</span></div>\n' +
      '<div class="engine-grid engine-simple">\n' +
      '  <div class="engine-controls">\n' +
      '    ' + field('Upload file (.txt)', '<input type="file" id="emoji-upload" accept=".txt,text/plain">') + '\n' +
      '    ' + field('Or paste text here', '<textarea id="emoji-input" rows="8" placeholder="Paste text containing emoji…"></textarea>') + '\n' +
      '    <p class="hint">A selected file takes priority over pasted text, matching the reference workflow.</p>\n' +
      '    <div class="output-actions"><button type="button" class="btn" id="emoji-apply">Remove Emojis</button></div>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <div class="workspace-head"><h2>Output</h2><button type="button" class="btn btn-secondary btn-small" id="emoji-copy">Copy</button></div>\n' +
      '    <textarea id="emoji-result" class="output-box" rows="8" readonly></textarea>\n' +
      '    <div class="status" id="emoji-status" role="status" aria-live="polite"></div>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  },

  /* 13 — Text to List Converter */
  'text-to-list': function () {
    return '<section class="container workspace engine-workspace" data-engine="text-to-list">\n' +
      '<div class="workspace-head"><h2>Interactive tool</h2><span class="card-tag">Runs in your browser</span></div>\n' +
      '<div class="engine-grid engine-simple">\n' +
      '  <div class="engine-controls">\n' +
      '    ' + field('Input text', '<textarea id="tl-input" rows="9" placeholder="Paste text to split into a list…"></textarea>') + '\n' +
      '    <div class="opt-group"><span class="opt-title">Split by</span>' + radios('tl-split', [
        { value: 'line', label: 'Line' }, { value: 'comma', label: 'Comma' }, { value: 'custom', label: 'Custom' }
      ], 'line') + '<div id="tl-separator-wrap" hidden><input type="text" id="tl-separator" placeholder="Custom separator"></div></div>\n' +
      '    <div class="opt-group"><span class="opt-title">Format</span>' + radios('tl-format', [
        { value: 'bullet', label: 'Bullet (•)' }, { value: 'numbered', label: 'Numbered (1.)' },
        { value: 'dash', label: 'Dash (-)' }, { value: 'custom', label: 'Custom prefix' }
      ], 'bullet') + '<div id="tl-prefix-wrap" hidden><input type="text" id="tl-prefix" placeholder="Custom prefix"></div></div>\n' +
      '    <div class="output-actions"><button type="button" class="btn" id="tl-convert">Convert to List</button><button type="button" class="btn btn-secondary btn-small" id="tl-clear">Clear</button></div>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <div class="workspace-head"><h2>Output</h2><button type="button" class="btn btn-secondary btn-small" id="tl-copy">Copy</button></div>\n' +
      '    <div id="tl-output" class="output-box"></div>\n' +
      '    <div class="status" id="tl-status" role="status" aria-live="polite"></div>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  },

  /* 14 — Text Filter */
  'text-filter': function () {
    return '<section class="container workspace engine-workspace" data-engine="text-filter">\n' +
      '<div class="workspace-head"><h2>Interactive tool</h2><span class="card-tag">Runs in your browser</span></div>\n' +
      '<div class="engine-grid engine-simple">\n' +
      '  <div class="engine-controls">\n' +
      '    ' + field('Input text', '<textarea id="tf-input" rows="9" placeholder="Enter your text here…"></textarea>') + '\n' +
      '    ' + field('Words to highlight (comma separated)', '<input type="text" id="tf-highlight" placeholder="word1, word2, word3">') + '\n' +
      '    ' + field('Words to remove (comma separated)', '<input type="text" id="tf-remove" placeholder="word1, word2, word3">') + '\n' +
      '    <div class="output-actions"><button type="button" class="btn" id="tf-apply">Apply Filter</button></div>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <div class="workspace-head"><h2>Output</h2><button type="button" class="btn btn-secondary btn-small" id="tf-copy">Copy</button></div>\n' +
      '    <div id="tf-output" class="output-box filter-output"></div>\n' +
      '    <div class="status" id="tf-status" role="status" aria-live="polite"></div>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  },

  /* 01 — Text Cleaner */
  'text-cleaner': function () {
    const whitespace = [
      ['trim', 'Trim each line', true], ['removeLeadingSpaces', 'Remove leading spaces', true], ['removeTrailingSpaces', 'Remove trailing spaces', true],
      ['removeBlankLines', 'Remove blank lines'], ['replaceLineBreakWithSpace', 'Replace line break with space'],
      ['multipleSpacesToSingle', 'Multiple spaces to single', true], ['multipleBlankLinesToSingle', 'Multiple blank lines to single', true],
      ['removeAllLineBreaks', 'Remove all line breaks']
    ];
    const characters = [
      ['removePunctuation', 'Remove punctuation'], ['stripEmojis', 'Strip emoji', true], ['removeAccents', 'Remove accents'],
      ['normalizeUnicode', 'Normalize Unicode (NFKC)'], ['removeReplacement', 'Remove replacement character'],
      ['removeNonAscii', 'Remove non-ASCII'], ['removeNonAlphanumeric', 'Remove non-alphanumeric']
    ];
    const html = [
      ['unescapeHtml', 'Unescape common HTML entities'], ['stripHtmlTags', 'Strip HTML tags', true], ['removeIds', 'Remove id attributes'],
      ['removeClasses', 'Remove class attributes'], ['removeInlineStyles', 'Remove inline styles'],
      ['decodeHtmlEntities', 'Decode HTML entities'], ['decodeUrlEncoded', 'Decode URL-encoded text']
    ];
    const other = [
      ['stripEmails', 'Strip email addresses'], ['removeBbCode', 'Remove BBCode'], ['removeWebUrls', 'Remove web URLs'],
      ['convertUrlsToLinks', 'Convert URLs to links']
    ];
    const formatting = [
      ['removeDuplicateLines', 'Remove duplicate lines'], ['removeRepeatingWords', 'Remove repeating words'],
      ['smartToRegular', 'Smart quotes to regular'], ['regularToSmart', 'Regular quotes to smart'],
      ['fixSpacesAfterPunctuation', 'Fix spaces after punctuation'], ['convertShorthand', 'Expand common shorthand']
    ];
    return '<section class="container workspace engine-workspace" data-engine="text-cleaner">\n' +
      '<div class="workspace-head"><h2>Interactive tool</h2><div class="output-actions"><button type="button" class="btn btn-secondary btn-small" id="cln-all">All</button><button type="button" class="btn btn-secondary btn-small" id="cln-none">None</button><button type="button" class="btn btn-secondary btn-small" id="cln-default">Default</button></div></div>\n' +
      '<div class="opt-group">' + checkbox('cln-wrapLines', 'Wrap lines in the input box', true) + '</div>\n' +
      '<div class="engine-grid engine-cleaner">\n' +
      '  <div class="engine-controls">\n' +
      '    ' + field('Paste text', '<textarea id="cln-input" rows="7" placeholder="Paste text here. Changes are applied when you click Clean Text."></textarea>') + '\n' +
      '    <div class="opt-set"><h3>Whitespace</h3>' + checkGroup('cln', whitespace) +
      '      <div class="inline-num"><label><input type="checkbox" id="cln-replaceSpacesWithTab"> Replace <input type="number" id="cln-spacesToTab" value="4" min="1" max="20"> spaces with a tab</label></div>' +
      '      <div class="inline-num"><label><input type="checkbox" id="cln-replaceTabWithSpaces"> Replace 1 tab with <input type="number" id="cln-tabToSpaces" value="4" min="1" max="20"> spaces</label></div>' +
      '      <div class="inline-num"><label><input type="checkbox" id="cln-trimLeft"> Remove <input type="number" id="cln-trimLeftChars" value="3" min="0" max="50"> characters from left</label></div>' +
      '      <div class="inline-num"><label><input type="checkbox" id="cln-trimRight"> Remove <input type="number" id="cln-trimRightChars" value="3" min="0" max="50"> characters from right</label></div>' +
      '    </div>\n' +
      '    <div class="opt-set"><h3>Characters</h3>' + checkGroup('cln', characters) + '</div>\n' +
      '    <div class="opt-set"><h3>HTML &amp; decoding</h3>' + checkGroup('cln', html) + '</div>\n' +
      '    <div class="opt-set"><h3>Other text &amp; links</h3>' + checkGroup('cln', other) + '</div>\n' +
      '    <div class="opt-set"><h3>Text formatting</h3>' + radios('cln-letterCase', [
        { value: 'uppercase', label: 'Uppercase' }, { value: 'lowercase', label: 'Lowercase' },
        { value: 'sentenceCase', label: 'Sentence case' }, { value: 'capitalizeWords', label: 'Capitalize each word' },
        { value: 'noChange', label: 'Do not change' }
      ], 'noChange') + checkGroup('cln', formatting) + '</div>\n' +
      '    <div class="output-actions"><button type="button" class="btn" id="cln-clean">Clean Text</button><button type="button" class="btn btn-secondary btn-small" id="cln-undo" disabled>Undo</button></div>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <div class="workspace-head"><h2>Output</h2><button type="button" class="btn btn-secondary btn-small" id="cln-copy">Copy to clipboard</button></div>\n' +
      '    <textarea id="cln-output" class="output-box" rows="14" readonly></textarea>\n' +
      '    <div class="status" id="cln-status" role="status" aria-live="polite"></div>\n' +
      '    <p class="hint">Processing order follows the reference tool. “Strip emoji” covers the common pictograph ranges only; it is not a complete Unicode emoji detector. Original text is kept in an undo stack.</p>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  },

  /* 06 — Word Counter */
  'word-counter': function () {
    return '<section class="container workspace engine-workspace" data-engine="word-counter">\n' +
      '<div class="workspace-head"><h2>Interactive tool</h2><div class="output-actions"><button type="button" class="btn btn-secondary btn-small" id="wc-sample">Sample text</button><button type="button" class="btn btn-secondary btn-small" id="wc-file">Open file</button><input type="file" id="wc-upload" accept=".txt,.csv,.tsv,.md,.markdown,.json,.log,.xml,.html,.htm,.docx,text/plain,text/csv" hidden><button type="button" class="btn btn-secondary btn-small" id="wc-copy">Copy</button><button type="button" class="btn btn-secondary btn-small" id="wc-clear">Clear</button></div></div>\n' +
      '<div class="engine-grid engine-counter">\n' +
      '  <div class="engine-controls">\n' +
      '    ' + field('Text', '<textarea id="wc-input" rows="10" placeholder="Start typing, paste text, or drop a .txt file here…"></textarea>') + '\n' +
      '    <p class="hint">Tip: select part of the text to count only that selection.</p>\n' +
      '    <div class="stat-grid">\n' +
      '      <div class="stat-tile"><span>Words</span><strong id="wc-words">0</strong></div>\n' +
      '      <div class="stat-tile"><span>Characters</span><strong id="wc-chars">0</strong></div>\n' +
      '      <div class="stat-tile"><span>Sentences</span><strong id="wc-sentences">0</strong></div>\n' +
      '      <div class="stat-tile"><span>Paragraphs</span><strong id="wc-paragraphs">0</strong></div>\n' +
      '      <div class="stat-tile"><span>Characters no spaces</span><strong id="wc-chars-nospace">0</strong></div>\n' +
      '      <div class="stat-tile"><span>Letters</span><strong id="wc-letters">0</strong></div>\n' +
      '      <div class="stat-tile"><span>Unique words</span><strong id="wc-unique">0</strong></div>\n' +
      '      <div class="stat-tile"><span>Avg word length</span><strong id="wc-avg">0</strong><small>characters per word</small></div>\n' +
      '      <div class="stat-tile"><span>Reading time</span><strong id="wc-reading">0s</strong><small>at 238 words per minute</small></div>\n' +
      '      <div class="stat-tile"><span>Speaking time</span><strong id="wc-speaking">0s</strong><small>at 150 words per minute</small></div>\n' +
      '    </div>\n' +
      '    <div class="status" id="wc-status" role="status" aria-live="polite"></div>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <div class="workspace-head"><h2>Keyword density</h2></div>\n' +
      '    <div class="opt-group"><span class="opt-title">Phrase length</span>' + radios('wc-n', [
        { value: '1', label: '1 word' }, { value: '2', label: '2 words' }, { value: '3', label: '3 words' }
      ], '1') + '</div>\n' +
      '    <div class="opt-group">' + checkbox('wc-ignore', 'Ignore common words', true) + '</div>\n' +
      '    <table class="density-table"><thead><tr><th>#</th><th>Keyword</th><th>Count</th><th>Density</th></tr></thead><tbody id="wc-density"></tbody></table>\n' +
      '    <div class="opt-group"><span class="opt-title">Goal</span><div class="goal-row"><input type="number" id="wc-goal" min="1" step="1" placeholder="e.g. 500"><select id="wc-goal-type"><option value="words">words</option><option value="characters">characters</option></select></div><div class="goal-meter"><span id="wc-goal-fill"></span></div><p class="hint" id="wc-goal-label">Set a goal to see your progress.</p></div>\n' +
      '    <p class="hint">Word counts use Unicode-aware tokenisation. Character counts use grapheme clusters, so a combined emoji counts as one. Sentence detection is heuristic and treats common abbreviations carefully.</p>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  },

  /* 05 — Redact Text */
  'text-redactor': function () {
    const cats = [
      ['name', 'Names', true], ['email', 'Emails', true], ['phone', 'Phone numbers', true], ['address', 'Addresses', true],
      ['money', 'Cards &amp; account numbers', true], ['id', 'SSNs &amp; IDs', true], ['secret', 'Keys &amp; passwords', true],
      ['net', 'IP addresses', true], ['user', 'Usernames', true], ['url', 'URLs &amp; domains', false], ['date', 'Dates', false]
    ];
    return '<section class="container workspace engine-workspace" data-engine="text-redactor">\n' +
      '<div class="workspace-head"><h2>Redact before you paste</h2><span class="card-tag">Runs in your browser</span></div>\n' +
      '<div class="engine-grid engine-redact">\n' +
      '  <div class="engine-controls">\n' +
      '    <h3 class="step-heading">1 · Paste your text</h3>\n' +
      '    ' + field('Source text', '<textarea id="rdx-input" rows="8" placeholder="Paste an email, chat, document or log file…"></textarea>') + '\n' +
      '    <div class="output-actions"><button type="button" class="btn btn-secondary btn-small" id="rdx-sample">Sample</button><button type="button" class="btn btn-secondary btn-small" id="rdx-clear">Clear</button><button type="button" class="btn btn-secondary btn-small" id="rdx-upload-btn">Upload file</button><input type="file" id="rdx-upload" accept=".txt,.log,.csv,.tsv,.json,.md,.eml,.xml,.yaml,.yml,.html,.htm,.env,.ini,.cfg,.conf,.properties,.toml,.sql,.js,.ts,.py,.rb,.php,.java,.go,.sh,.har,text/*,application/json" hidden></div>\n' +
      '    <div class="opt-set"><h4>What to hide</h4>' + checkGroup('rdx', cats) + '</div>\n' +
      '    <div class="opt-set"><h4>Replace with</h4>' + radios('rdx-style', [
        { value: 'label', label: 'Labels, like [EMAIL_1]' }, { value: 'fake', label: 'Realistic fake data' }, { value: 'bars', label: 'Black bars █████' }
      ], 'label') + '</div>\n' +
      '    ' + field('Always hide these words (comma or newline separated)', '<textarea id="rdx-words" rows="2" placeholder="Project Falcon, Jane Doe"></textarea>') + '\n' +
      '    <div class="opt-group">' + checkbox('rdx-remember', 'Remember these words on this device', false) + '</div>\n' +
      '    <p class="hint warning">Detection is heuristic: it can miss values or flag ordinary text. Your text is never transmitted by this tool. A saved key contains the <strong>original sensitive values</strong> — store it privately and delete it when finished. Black bars cannot be reversed.</p>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <h3 class="step-heading">2 · Copy the redacted text</h3>\n' +
      '    <div class="workspace-head"><button type="button" class="btn btn-secondary btn-small" id="rdx-copy">Copy redacted text</button><button type="button" class="btn btn-secondary btn-small" id="rdx-save-key">Save key</button></div>\n' +
      '    <textarea id="rdx-output" class="output-box" rows="8" readonly></textarea>\n' +
      '    <p class="hint" id="rdx-found">0 items found</p>\n' +
      '    <h3 class="step-heading">3 · Put the real values back</h3>\n' +
      '    ' + field('Paste the reply', '<textarea id="rdx-restore-input" rows="5" placeholder="Paste the AI reply containing labels…"></textarea>') + '\n' +
      '    <div class="output-actions"><button type="button" class="btn" id="rdx-restore">Restore values</button><button type="button" class="btn btn-secondary btn-small" id="rdx-load-key">Load key</button><input type="file" id="rdx-key-file" accept="application/json,.json" hidden></div>\n' +
      '    <textarea id="rdx-restored" class="output-box" rows="6" readonly></textarea>\n' +
      '    <div class="workspace-head"><button type="button" class="btn btn-secondary btn-small" id="rdx-copy-restored">Copy restored text</button></div>\n' +
      '    <div class="status" id="rdx-status" role="status" aria-live="polite"></div>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  },

  /* 04 — Bank Statement Converter (text / CSV / DOCX text subset) */
  'bank-statement-converter': function () {
    const columnOptions = function (label) {
      let html = '<option value="auto">Auto</option>';
      for (let i = 0; i < 12; i++) html += '<option value="' + i + '">' + (i + 1) + '</option>';
      return field(label, '<select id="bk-col-' + label + '">' + html + '</select>');
    };
    return '<section class="container workspace engine-workspace" data-engine="bank-statement-converter">\n' +
      '<div class="workspace-head"><h2>Interactive tool</h2><span class="card-tag">Runs in your browser</span></div>\n' +
      '<div class="engine-grid engine-statement">\n' +
      '  <div class="engine-controls">\n' +
      '    ' + field('Statement text or CSV', '<textarea id="bk-input" rows="8" placeholder="Paste plain-text transactions, one per line, for example:\n01/15/2026 Coffee Shop 4.50 995.50"></textarea>') + '\n' +
      '    <div class="output-actions"><button type="button" class="btn btn-secondary btn-small" id="bk-sample">Load sample</button><button type="button" class="btn btn-secondary btn-small" id="bk-upload-btn">Open file</button><input type="file" id="bk-upload" accept=".txt,.csv,.tsv,.md,.markdown,.json,.log,.xml,.docx,text/plain,text/csv" hidden><button type="button" class="btn btn-secondary btn-small" id="bk-clear">Clear</button></div>\n' +
      '    <div class="two-cols">' + field('Input format', '<select id="bk-format"><option value="auto">Automatic</option><option value="text">Plain text</option><option value="csv">CSV / TSV / semicolon</option></select>') +
      field('Date order', '<select id="bk-date-order"><option value="auto">Automatic</option><option value="mdy">Month first (MM/DD)</option><option value="dmy">Day first (DD/MM)</option></select>') +
      field('Statement type', '<select id="bk-kind"><option value="auto">Automatic</option><option value="bank">Bank account</option><option value="credit">Credit card</option></select>') +
      columnOptions('date') + columnOptions('description') + columnOptions('amount') + columnOptions('balance') + columnOptions('debit') + columnOptions('credit') + '</div>\n' +
      '    <div class="output-actions"><button type="button" class="btn" id="bk-parse">Parse transactions</button><button type="button" class="btn btn-secondary btn-small" id="bk-edit">Edit values</button><button type="button" class="btn btn-secondary btn-small" id="bk-apply-edits">Apply edits</button></div>\n' +
      '    <p class="hint warning">Scope: this browser-side build parses pasted text, CSV/TSV and DOCX text. It does <strong>not</strong> extract PDF text, run OCR, or export XLSX/QBO/XERO/OFX. Amounts are never rounded; check every row against the original statement.</p>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <div class="summary-grid">\n' +
      '      <div class="stat-tile"><span>Transactions</span><strong id="bk-sum-transactions">0</strong></div>\n' +
      '      <div class="stat-tile"><span>Money in</span><strong id="bk-sum-in">0.00</strong></div>\n' +
      '      <div class="stat-tile"><span>Money out</span><strong id="bk-sum-out">0.00</strong></div>\n' +
      '      <div class="stat-tile"><span>Balance check</span><strong id="bk-sum-check">No balances to check</strong></div>\n' +
      '    </div>\n' +
      '    <p class="hint" id="bk-warnings">No automatic warnings; review every row against the original statement.</p>\n' +
      '    <div class="table-wrap" id="bk-table"><p class="hint">Parse a statement to see its transactions.</p></div>\n' +
      '    <div class="output-actions"><button type="button" class="btn btn-secondary btn-small" id="bk-csv">Download CSV</button><button type="button" class="btn btn-secondary btn-small" id="bk-qif">Download QIF</button></div>\n' +
      '    <div class="status" id="bk-status" role="status" aria-live="polite"></div>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  },

  /* 03 — Handwriting to Font (scoped sampler + styled preview) */
  'handwriting-to-font': function () {
    return '<section class="container workspace engine-workspace" data-engine="handwriting-to-font">\n' +
      '<div class="workspace-head"><h2>Interactive tool</h2><span class="card-tag">Runs in your browser</span></div>\n' +
      '<div class="engine-grid engine-handwriting">\n' +
      '  <div class="engine-controls">\n' +
      '    <div class="opt-group"><span class="opt-title">Character group</span>' + radios('hf-group', [
        { value: 'upper', label: 'ABC' }, { value: 'lower', label: 'abc' }, { value: 'num', label: '123' }, { value: 'sym', label: '?!&' }
      ], 'upper') + '</div>\n' +
      '    <div class="opt-group"><span class="opt-title">Character</span><div class="chip-row" id="hf-chars"></div></div>\n' +
      '    <div class="workspace-head"><h3>Drawing pad</h3><div class="output-actions"><button type="button" class="btn btn-secondary btn-small" id="hf-pen">Pen</button><button type="button" class="btn btn-secondary btn-small" id="hf-eraser">Eraser</button><button type="button" class="btn btn-secondary btn-small" id="hf-undo">Undo</button><button type="button" class="btn btn-secondary btn-small" id="hf-clear">Clear</button></div></div>\n' +
      '    <canvas id="hf-pad" width="520" height="360" aria-label="Drawing area" class="draw-pad"></canvas>\n' +
      '    <div class="opt-group"><span class="opt-title">Pen size <small id="hf-pen-size-label">14px</small></span><input type="range" id="hf-pen-size" min="14" max="160" step="1" value="14"></div>\n' +
      '    <p class="hint">Tip: use ← and → to move between characters. Draw one glyph per character; keep it inside the guide box and sit letters on the baseline.</p>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <div class="workspace-head"><h2>Preview</h2><span class="pill" id="hf-loading" hidden>Building…</span></div>\n' +
      '    ' + field('Text to preview', '<textarea id="hf-text" rows="3" placeholder="Type something to see your glyphs…">Hello</textarea>') + '\n' +
      '    <div class="chip-row"><button type="button" class="chip" data-hf-phrase="The quick brown fox jumps over the lazy dog.">Pangram</button><button type="button" class="chip" data-hf-phrase="ABCDEFGHIJKLM NOPQRSTUVWXYZ 0123456789">Alphabet</button></div>\n' +
      '    <div class="two-cols">' + field('Preview size', '<input type="range" id="hf-size" min="18" max="110" step="1" value="44">') + field('Letter gap', '<input type="range" id="hf-gap" min="0" max="60" step="1" value="10">') + '</div>\n' +
      '    <div class="two-cols">' + field('Font family', '<select id="hf-font"><option value="sans">Sans-serif</option><option value="serif">Serif</option><option value="mono">Monospace</option><option value="script">Handwriting-style</option></select>') +
      field('Font style', '<select id="hf-style"><option value="regular">Regular</option><option value="bold">Bold</option><option value="italic">Italic</option><option value="bold-italic">Bold italic</option></select>') + '</div>\n' +
      '    <div class="two-cols">' + field('Text colour', '<input type="color" id="hf-color" value="#0f172a">') + field('Background', '<input type="color" id="hf-bg" value="#ffffff">') + '</div>\n' +
      '    <div class="two-cols">' + field('Line spacing <small id="hf-line-height-label">1.2</small>', '<input type="range" id="hf-line-height" min="0.8" max="2.4" step="0.1" value="1.2">') + field('Zoom <small id="hf-zoom-label">100%</small>', '<input type="range" id="hf-zoom" min="50" max="200" step="10" value="100">') + '</div>\n' +
      '    <div class="opt-group">' + checkbox('hf-live', 'Live preview while options change', false) + '</div>\n' +
      '    <div class="output-actions"><button type="button" class="btn" id="hf-build">Build preview</button><button type="button" class="btn btn-secondary btn-small" id="hf-download">Download PNG</button></div>\n' +
      '    <canvas id="hf-preview" width="760" height="240" class="preview-pad"></canvas>\n' +
      '    <div class="status" id="hf-status" role="status" aria-live="polite"></div>\n' +
      '    <p class="hint warning">Scope: this build lets you draw glyphs and export a <strong>picture preview</strong>. It does not generate an installable OpenType (.otf) font. Font family, style and colour affect fallback characters and preview styling; your drawn glyphs remain the images you drew. For handwritten pages and PDF/PNG export, use the separate <a href="/tools/text-to-handwriting/index.html">Text to Handwriting</a> tool.</p>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  },

  /* 15 — Remove Empty Lines (document-aware engine) */
  'remove-empty-lines': function () {
    return '<section class="container workspace engine-workspace" data-engine="remove-empty-lines">\n' +
      '<div class="workspace-head"><h2>Interactive tool</h2><span class="card-tag">Runs in your browser</span></div>\n' +
      '<div class="engine-grid engine-simple">\n' +
      '  <div class="engine-controls">\n' +
      '    ' + field('Upload TXT, CSV, MD or DOCX', '<input type="file" id="rel-upload" accept=".txt,.csv,.tsv,.md,.markdown,.json,.log,.xml,.html,.htm,.docx,text/plain,text/csv">') + '\n' +
      '    ' + field('Or paste text', '<textarea id="tool-input" rows="9" placeholder="Paste text with blank lines…"></textarea>') + '\n' +
      '    <div class="opt-group"><span class="opt-title">Blank lines</span>\n' +
      '      ' + checkbox('rel-preserve', 'Keep one blank line between paragraphs', false) + '\n' +
      '    </div>\n' +
      '    <p class="hint">Only empty and whitespace-only lines are removed. Tabs, indentation, punctuation and all other characters on real lines stay exactly as they are.</p>\n' +
      '    <div class="output-actions"><button type="button" class="btn" id="rel-apply">Remove empty lines</button><button type="button" class="btn btn-secondary btn-small" id="clear-input">Clear input</button></div>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <div class="workspace-head"><h2>Output</h2><div class="output-actions">\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="copy-output">Copy</button>\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="download-output">Download</button>\n' +
      '    </div></div>\n' +
      '    <pre id="tool-output" class="output-box"></pre>\n' +
      '    <div class="status" id="tool-status" role="status" aria-live="polite"></div>\n' +
      '    <p class="hint warning">DOCX support extracts text only; columns, tables and styling are not preserved. PDF and legacy .doc files are rejected with an explanation rather than silently mangled.</p>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  },

  /* 16 — Remove Punctuation (document-aware engine) */
  'remove-punctuation': function () {
    return '<section class="container workspace engine-workspace" data-engine="remove-punctuation">\n' +
      '<div class="workspace-head"><h2>Interactive tool</h2><span class="card-tag">Runs in your browser</span></div>\n' +
      '<div class="engine-grid engine-simple">\n' +
      '  <div class="engine-controls">\n' +
      '    ' + field('Upload TXT, CSV, MD or DOCX', '<input type="file" id="rp-upload" accept=".txt,.csv,.tsv,.md,.markdown,.json,.log,.xml,.html,.htm,.docx,text/plain,text/csv">') + '\n' +
      '    ' + field('Or paste text', '<textarea id="tool-input" rows="8" placeholder="Paste text containing punctuation…"></textarea>') + '\n' +
      '    <div class="two-cols">' + field('Punctuation to remove', '<select id="rp-types"><option value="all">All Unicode punctuation</option><option value="common">Common English marks</option><option value="custom">Custom characters</option></select>') +
      field('Custom characters', '<input type="text" id="rp-chars" placeholder="e.g. ,!?;:" disabled>') + '</div>\n' +
      '    <p class="hint">Letters, numbers, emoji, symbols, spaces and line breaks are preserved. Custom mode removes only the characters you type.</p>\n' +
      '    <div class="output-actions"><button type="button" class="btn" id="rp-apply">Remove punctuation</button><button type="button" class="btn btn-secondary btn-small" id="clear-input">Clear input</button></div>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <div class="workspace-head"><h2>Output</h2><div class="output-actions">\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="copy-output">Copy</button>\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="download-output">Download</button>\n' +
      '    </div></div>\n' +
      '    <pre id="tool-output" class="output-box"></pre>\n' +
      '    <div class="status" id="tool-status" role="status" aria-live="polite"></div>\n' +
      '    <p class="hint warning">DOCX support extracts text only; PDF and legacy .doc files are rejected with an explanation. Only the text is cleaned, never the document layout.</p>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  },

  /* 17 — Text Comparer (two-document engine) */
  'text-comparer': function () {
    return '<section class="container workspace engine-workspace" data-engine="text-comparer">\n' +
      '<div class="workspace-head"><h2>Interactive tool</h2><span class="card-tag">Runs in your browser</span></div>\n' +
      '<div class="engine-grid engine-simple">\n' +
      '  <div class="engine-controls">\n' +
      '    <div class="two-cols">\n' +
      '      <div class="field"><label for="tool-input-left">Original text</label><textarea id="tool-input-left" rows="6" placeholder="Paste the original version here…"></textarea><input type="file" id="cmp-upload-left" accept=".txt,.csv,.tsv,.md,.markdown,.json,.log,.xml,.html,.htm,.docx,text/plain,text/csv" aria-label="Open original text file"></div>\n' +
      '      <div class="field"><label for="tool-input-right">Changed text</label><textarea id="tool-input-right" rows="6" placeholder="Paste the changed version here…"></textarea><input type="file" id="cmp-upload-right" accept=".txt,.csv,.tsv,.md,.markdown,.json,.log,.xml,.html,.htm,.docx,text/plain,text/csv" aria-label="Open changed text file"></div>\n' +
      '    </div>\n' +
      '    <div class="opt-group"><span class="opt-title">Compare by</span>' + radios('cmp-unit', [
        { value: 'lines', label: 'Lines' }, { value: 'words', label: 'Words' }
      ], 'lines') + '</div>\n' +
      '    <div class="output-actions"><button type="button" class="btn" id="cmp-compare">Compare text</button><button type="button" class="btn btn-secondary btn-small" id="cmp-swap">Swap sides</button><button type="button" class="btn btn-secondary btn-small" id="cmp-clear">Clear both</button></div>\n' +
      '    <p class="hint warning">Only extracted text is compared, not formatting. DOCX uploads provide paragraph text; PDF and legacy .doc files are rejected rather than guessed.</p>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <div class="workspace-head"><h2>Differences</h2><span class="pill" id="cmp-summary">0 added · 0 removed</span></div>\n' +
      '    <div id="tool-output" class="output-box diff-output"></div>\n' +
      '    <div class="status" id="tool-status" role="status" aria-live="polite"></div>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  },

  /* 18 — HTML to Markdown (pure local converter) */
  'html-to-markdown': function () {
    return '<section class="container workspace engine-workspace" data-engine="html-to-markdown">\n' +
      '<div class="workspace-head"><h2>Interactive tool</h2><span class="card-tag">Runs in your browser</span></div>\n' +
      '<div class="engine-grid engine-simple">\n' +
      '  <div class="engine-controls">\n' +
      '    ' + field('Upload HTML, TXT or DOCX text', '<input type="file" id="h2m-upload" accept=".html,.htm,.txt,.md,.markdown,.csv,.json,.docx,text/html,text/plain">') + '\n' +
      '    ' + field('HTML to convert', '<textarea id="h2m-input" rows="9" placeholder="Paste HTML or rich text here…"></textarea>') + '\n' +
      '    <div class="output-actions"><button type="button" class="btn btn-secondary btn-small" id="h2m-clear">Clear</button></div>\n' +
      '    <p class="hint">Headings, links, lists, tables, code, quotes and emphasis are handled by a local parser. Scripts, styles, SVG and unsafe attributes are removed from the preview.</p>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <div class="workspace-head"><h2>Markdown source</h2><div class="output-actions">\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="h2m-copy">Copy</button>\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="h2m-download">Download</button>\n' +
      '    </div></div>\n' +
      '    <pre id="h2m-source" class="output-box"></pre>\n' +
      '    <p class="pill" id="h2m-count">0 Markdown characters</p>\n' +
      '    <div class="workspace-head"><h2>Safe preview</h2><span class="card-tag">DOM nodes only</span></div>\n' +
      '    <div id="h2m-preview" class="output-box"></div>\n' +
      '    <div class="status" id="h2m-status" role="status" aria-live="polite"></div>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  },

  /* 19 — Extract URLs (strict local extraction) */
  'extract-urls': function () {
    return '<section class="container workspace engine-workspace" data-engine="extract-urls">\n' +
      '<div class="workspace-head"><h2>Interactive tool</h2><span class="card-tag">Runs in your browser</span></div>\n' +
      '<div class="engine-grid engine-simple">\n' +
      '  <div class="engine-controls">\n' +
      '    ' + field('Upload TXT, CSV, MD or DOCX', '<input type="file" id="url-upload" accept=".txt,.csv,.tsv,.md,.markdown,.json,.log,.xml,.html,.htm,.docx,text/plain,text/csv">') + '\n' +
      '    ' + field('Text containing links', '<textarea id="url-input" rows="9" placeholder="Paste text with http, https, www or bare-domain URLs…"></textarea>') + '\n' +
      '    <div class="output-actions"><button type="button" class="btn btn-secondary btn-small" id="url-clear">Clear</button></div>\n' +
      '    <p class="hint">URLs are validated as http or https web addresses and de-duplicated in first-seen order. Punctuation around a link is trimmed; mailto: and javascript: values are ignored.</p>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <div class="workspace-head"><h2>Unique URLs</h2><div class="output-actions">\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="url-copy">Copy all</button>\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="url-download">Download</button>\n' +
      '    </div></div>\n' +
      '    <p class="pill" id="url-count">0 unique URLs</p>\n' +
      '    <div id="url-list" class="output-box"></div>\n' +
      '    <div class="status" id="url-status" role="status" aria-live="polite"></div>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  },

  /* 20 — Grammar & Spell Checker (rule-based, English only) */
  'grammar-spell-checker': function () {
    return '<section class="container workspace engine-workspace" data-engine="grammar-spell-checker">\n' +
      '<div class="workspace-head"><h2>Interactive tool</h2><span class="card-tag">Runs in your browser</span></div>\n' +
      '<div class="engine-grid engine-simple">\n' +
      '  <div class="engine-controls">\n' +
      '    ' + field('Upload TXT, CSV, MD or DOCX', '<input type="file" id="gs-upload" accept=".txt,.csv,.tsv,.md,.markdown,.json,.log,.xml,.html,.htm,.docx,text/plain,text/csv">') + '\n' +
      '    ' + field('Text to check', '<textarea id="gs-input" rows="8" placeholder="Paste English text to check…"></textarea>') + '\n' +
      '    <div class="two-cols">' + field('Style emphasis', '<select id="gs-style"><option value="Professional">Professional</option><option value="Academic">Academic</option><option value="Formal">Formal</option><option value="Casual">Casual</option><option value="Simple English">Simple English</option></select>') +
      field('Status', '<span class="pill" id="gs-count">0 suggestions</span>') + '</div>\n' +
      '    <div class="output-actions"><button type="button" class="btn" id="gs-apply">Apply selected</button><button type="button" class="btn btn-secondary btn-small" id="gs-select-all">Select all</button><button type="button" class="btn btn-secondary btn-small" id="gs-reject-all">Reject all</button><button type="button" class="btn btn-secondary btn-small" id="gs-clear">Clear</button></div>\n' +
      '    <p class="hint warning">Honest scope: English only, local rules for common spelling, grammar, repeated words, spacing and clarity. It is not full NLP, an AI rewriting service, or a substitute for human proofreading; no external or paid API is used.</p>\n' +
      '  </div>\n' +
      '  <div class="engine-output">\n' +
      '    <div class="workspace-head"><h2>Highlighted text</h2><span class="card-tag">Original is unchanged</span></div>\n' +
      '    <div id="gs-highlight" class="output-box"></div>\n' +
      '    <div class="workspace-head"><h2>Suggestions</h2></div>\n' +
      '    <div id="gs-list" class="output-box"></div>\n' +
      '    <div class="workspace-head"><h2>Corrected copy</h2><div class="output-actions">\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="gs-copy">Copy</button>\n' +
      '      <button type="button" class="btn btn-secondary btn-small" id="gs-download">Download</button>\n' +
      '    </div></div>\n' +
      '    <pre id="gs-original" class="output-box" hidden></pre>\n' +
      '    <pre id="gs-corrected" class="output-box"></pre>\n' +
      '    <div class="status" id="gs-status" role="status" aria-live="polite"></div>\n' +
      '  </div>\n' +
      '</div>\n</section>';
  }
};

function workspaceFor(slug) {
  return WORKSPACES[slug] ? WORKSPACES[slug]() : null;
}

module.exports = { workspaceFor: workspaceFor, WORKSPACES: WORKSPACES };
