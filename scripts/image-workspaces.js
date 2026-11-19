/* Build-time workspace templates for the Image & Photo category.
 * Every string here is static markup; the runtime binds behaviour by id. */
'use strict';

function field(label, control, hint) {
  return '<div class="field"><label>' + label + '</label>' + control +
    (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>';
}

function group(title, content) {
  return '<div class="opt-group"><span class="opt-title">' + title + '</span>' + content + '</div>';
}

function range(id, label, min, max, value, step, unit) {
  return '<div class="field range-field"><label for="' + id + '">' + label +
    ' <output id="' + id + '-value">' + value + (unit || '') + '</output></label>' +
    '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '"></div>';
}

function number(id, label, value, min, max, step) {
  return '<div class="field"><label for="' + id + '">' + label + '</label>' +
    '<input type="number" id="' + id + '" value="' + value + '" min="' + min + '" max="' + max + '" step="' + step + '"></div>';
}

function select(id, label, options) {
  return '<div class="field"><label for="' + id + '">' + label + '</label><select id="' + id + '">' +
    options.map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join('') + '</select></div>';
}

function color(id, label, value) {
  return '<div class="field color-field"><label for="' + id + '">' + label + '</label>' +
    '<input type="color" id="' + id + '" value="' + value + '"></div>';
}

function buttons(items) {
  return '<div class="output-actions">' + items.map(item =>
    '<button type="button" class="' + (item[2] || 'btn btn-secondary btn-small') + '" id="' + item[0] + '">' + item[1] + '</button>'
  ).join('') + '</div>';
}

function upload(accept, multiple, help) {
  return group('Source image',
    '<label class="image-drop" for="image-file">' +
      '<span class="image-drop-icon" aria-hidden="true">📁</span>' +
      '<strong>Choose an image or drop it here</strong>' +
      '<span>' + (multiple ? 'You can select several files at once.' : 'One file at a time.') + '</span>' +
    '</label>' +
    '<input type="file" id="image-file" accept="' + accept + '"' + (multiple ? ' multiple' : '') + '>' +
    '<div class="output-actions">' +
      '<button type="button" class="btn btn-secondary btn-small" id="image-change">Change image</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="image-reset">Reset</button>' +
    '</div>' +
    (help ? '<p class="hint">' + help + '</p>' : ''));
}

function output(engine, extraActions, previewLabel) {
  return '<div class="image-output">' +
    '<div class="workspace-head"><h2>' + (previewLabel || 'Preview') + '</h2><span class="pill" id="image-meta">No image loaded</span></div>' +
    '<div class="image-preview-frame"><canvas id="image-preview" width="800" height="480" aria-label="Image preview"></canvas></div>' +
    '<div class="status" id="image-status" role="status" aria-live="polite"></div>' +
    '<div class="output-actions">' +
      '<button type="button" class="btn" id="image-download" disabled>Download image</button>' +
      (extraActions || []).join('') +
    '</div>' +
    '<div class="image-output-note">' + engine + '</div>' +
  '</div>';
}

function workspace(engine, controls, outputBlock) {
  return '<section class="container workspace image-workspace" data-image-engine="' + engine + '">\n' +
    '<div class="workspace-head"><h2>Interactive tool</h2><span class="card-tag">Runs in your browser</span></div>\n' +
    '<div class="image-grid"><div class="image-controls">' + controls + '</div>' + outputBlock + '</div>\n' +
    '</section>';
}

const WORKSPACES = {
  'image-editor': function () {
    const controls = upload('image/png,image/jpeg,image/webp', false, 'JPG, PNG and WebP are supported. Very large files are rejected with a clear message.') +
      group('Crop', range('ie-crop-x', 'Left', 0, 100, 0, 1, 'px') + range('ie-crop-y', 'Top', 0, 100, 0, 1, 'px') +
        range('ie-crop-w', 'Width', 1, 100, 100, 1, 'px') + range('ie-crop-h', 'Height', 1, 100, 100, 1, 'px') +
        buttons([['ie-crop-apply', 'Apply crop']])) +
      group('Orientation', buttons([['ie-rot-left', '↶ Left'], ['ie-rot-right', '↷ Right'], ['ie-flip-h', '⇄ Flip H'], ['ie-flip-v', '⇅ Flip V']])) +
      group('Adjustments', range('ie-brightness', 'Brightness', 0, 200, 100, 1, '%') + range('ie-contrast', 'Contrast', 0, 200, 100, 1, '%') +
        range('ie-saturation', 'Saturation', 0, 200, 100, 1, '%') + range('ie-blur', 'Blur', 0, 20, 0, 0.5, 'px') +
        range('ie-grayscale', 'Grayscale', 0, 100, 0, 1, '%') + range('ie-sepia', 'Sepia', 0, 100, 0, 1, '%') +
        buttons([['ie-adjust-reset', 'Reset adjustments']])) +
      group('Text overlay', field('Caption', '<textarea id="ie-text" rows="2" placeholder="Optional caption. Press Enter for a new line."></textarea>') +
        range('ie-text-size', 'Text size', 1, 20, 5, 1, '%') + color('ie-text-color', 'Text colour', '#ffffff') +
        '<label class="opt"><input type="checkbox" id="ie-text-bg" checked> <span>Readable backing</span></label>' +
        range('ie-text-x', 'Text position X', 0, 100, 50, 1, '%') + range('ie-text-y', 'Text position Y', 0, 100, 85, 1, '%')) +
      group('Export', select('ie-format', 'Format', [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']]) +
        range('ie-quality', 'Quality (JPG/WebP)', 0.1, 1, 0.92, 0.01, ''));
    return workspace('image-editor', controls, output('Crop, adjust and annotate locally'));
  },

  'heic-viewer': function () {
    const controls = upload('.heic,.heif,image/heic,image/heif', true, 'HEIC and HEIF files are decoded locally with a bundled libheif build. Unsupported files are reported, never faked.') +
      group('Download format', select('heic-format', 'Format for previews and downloads', [['png', 'PNG'], ['jpeg', 'JPG']]) +
        buttons([['heic-download-all', 'Download all decoded images']])) +
      group('How it works', '<p class="hint">Each file is decoded with the local library. Collapsed or unsupported variants appear in the failure list. Choose a thumbnail to inspect a larger preview.</p>');
    const out = '<div class="image-output">' +
      '<div class="workspace-head"><h2>Decoded images</h2><span class="pill" id="image-meta">0 decoded</span></div>' +
      '<div class="image-preview-frame"><canvas id="image-preview" width="800" height="480" aria-label="Selected HEIC preview"></canvas></div>' +
      '<div class="status" id="image-status" role="status" aria-live="polite"></div>' +
      '<div class="heic-gallery" id="heic-gallery" aria-label="Decoded image thumbnails"></div>' +
      '<div class="output-actions"><button type="button" class="btn" id="image-download" disabled>Download selected</button></div>' +
      '<div class="image-output-note">Files are decoded in your browser; no upload is involved.</div>' +
    '</div>';
    return workspace('heic-viewer', controls, out);
  },

  'add-border-to-image': function () {
    const controls = upload('image/png,image/jpeg,image/webp', false, 'The original file stays unchanged; only the downloaded copy includes the frame.') +
      group('Border', range('brd-width', 'Border width', 0, 200, 20, 1, 'px') + color('brd-color', 'Border colour', '#ffffff') +
        '<div class="chip-row" id="brd-presets">' +
        '<button type="button" class="chip" data-brd-color="#ffffff">White</button>' +
        '<button type="button" class="chip" data-brd-color="#0f172a">Navy</button>' +
        '<button type="button" class="chip" data-brd-color="#2563eb">Blue</button>' +
        '<button type="button" class="chip" data-brd-color="#f97316">Orange</button>' +
        '</div>');
    return workspace('add-border-to-image', controls, output('Live border preview'));
  },

  'photo-merger': function () {
    const controls = upload('image/png,image/jpeg,image/webp', true, 'Up to six files are accepted. Order matters: the first image appears first.') +
      group('Layout', '<div class="opt-row"><label class="opt"><input type="radio" name="pm-direction" value="horizontal" checked> <span>Horizontal row</span></label>' +
        '<label class="opt"><input type="radio" name="pm-direction" value="vertical"> <span>Vertical stack</span></label></div>') +
      group('Spacing and background', range('pm-spacing', 'Gap between images', 0, 100, 12, 1, 'px') + color('pm-bg', 'Canvas colour', '#ffffff')) +
      group('Image order', '<div class="pm-order" id="pm-order"><p class="hint">Add images to see their order here.</p></div>') +
      group('Merge', buttons([['pm-merge', 'Merge images']]));
    return workspace('photo-merger', controls, output('Merged canvas'));
  },

  'screenshot-beautifier': function () {
    const controls = upload('image/png,image/jpeg,image/webp', false, 'PNG screenshots work best because text stays sharp before the effect is applied.') +
      group('Presets', '<div class="chip-row" id="sb-presets">' +
        '<button type="button" class="chip" data-sb-preset="soft">Soft blue</button>' +
        '<button type="button" class="chip" data-sb-preset="dark">Dark slate</button>' +
        '<button type="button" class="chip" data-sb-preset="paper">Paper</button>' +
        '</div>') +
      group('Background', select('sb-bg-type', 'Background style', [['gradient', 'Gradient'], ['solid', 'Solid colour'], ['pattern', 'Pattern'], ['transparent', 'Transparent']]) +
        color('sb-color1', 'First / solid colour', '#2563eb') + color('sb-color2', 'Second colour', '#60a5fa') +
        select('sb-gradient-direction', 'Gradient direction', [['to right', 'Left to right'], ['to bottom', 'Top to bottom'], ['135deg', 'Diagonal']]) +
        select('sb-pattern', 'Pattern', [['stripes', 'Diagonal stripes'], ['dots', 'Dots'], ['grid', 'Grid']])) +
      group('Frame', range('sb-padding', 'Padding', 0, 120, 40, 1, 'px') + range('sb-radius', 'Corner radius', 0, 60, 12, 1, 'px') +
        range('sb-shadow-blur', 'Shadow blur', 0, 80, 24, 1, 'px') + range('sb-shadow-x', 'Shadow X', -40, 40, 0, 1, 'px') +
        range('sb-shadow-y', 'Shadow Y', -40, 60, 12, 1, 'px') + range('sb-shadow-opacity', 'Shadow opacity', 0, 100, 30, 1, '%')) +
      group('Filters', range('sb-brightness', 'Brightness', 0, 200, 100, 1, '%') + range('sb-contrast', 'Contrast', 0, 200, 100, 1, '%') +
        range('sb-saturation', 'Saturation', 0, 200, 100, 1, '%') + range('sb-blur', 'Blur', 0, 12, 0, 0.5, 'px')) +
      group('Text overlay', field('Overlay text', '<input type="text" id="sb-overlay-text" placeholder="Optional caption">') +
        range('sb-font-size', 'Text size', 12, 96, 24, 1, 'px') + color('sb-text-color', 'Text colour', '#ffffff') +
        select('sb-text-position', 'Text position', [['top', 'Top'], ['center', 'Centre'], ['bottom', 'Bottom']])) +
      group('Title bar', '<label class="opt"><input type="checkbox" id="sb-titlebar"> <span>Show title bar</span></label>' +
        select('sb-titlebar-style', 'Title bar style', [['mac', 'Mac-like'], ['windows', 'Windows-like']]) +
        field('Title bar text', '<input type="text" id="sb-titlebar-text" value="Screenshot">') +
        color('sb-titlebar-bg', 'Title bar colour', '#f6f6f6') + color('sb-titlebar-text-color', 'Title text colour', '#333333')) +
      group('Apply', buttons([['sb-apply', 'Apply style']]));
    return workspace('screenshot-beautifier', controls, output('Styled screenshot'));
  },

  'black-and-white-image-converter': function () {
    const controls = upload('image/png,image/jpeg,image/webp', false, 'Transparent pixels keep their original alpha in both modes.') +
      group('Conversion', select('bw-mode', 'Mode', [['grayscale', 'Smooth grayscale'], ['threshold', 'High-contrast threshold']]) +
        range('bw-threshold', 'Threshold level', 0, 255, 128, 1, '')) +
      group('Export', select('bw-format', 'Format', [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']]) +
        range('bw-quality', 'Quality (JPG/WebP)', 0.1, 1, 0.92, 0.01, ''));
    return workspace('black-and-white-image-converter', controls, output('Black and white preview'));
  },

  'image-flip-rotate': function () {
    const controls = upload('image/png,image/jpeg,image/webp', false, 'Operations can be combined in any order. Each quarter turn swaps width and height.') +
      group('Orientation', buttons([['fr-rot-left', '↶ Rotate left'], ['fr-rot-right', '↷ Rotate right'], ['fr-flip-h', '⇄ Flip horizontal'], ['fr-flip-v', '⇅ Flip vertical']])) +
      group('Export', select('fr-format', 'Format', [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']]) +
        range('fr-quality', 'Quality (JPG/WebP)', 0.1, 1, 0.92, 0.01, ''));
    return workspace('image-flip-rotate', controls, output('Orientation preview'));
  },

  'image-resizer': function () {
    const controls = upload('image/png,image/jpeg,image/webp', false, 'Output dimensions are capped at 8,000 px on each edge and 40 million pixels in total.') +
      group('Target size', '<div class="two-cols">' + number('rs-width', 'Width (px)', 800, 1, 8000, 1) + number('rs-height', 'Height (px)', 600, 1, 8000, 1) + '</div>' +
        '<label class="opt"><input type="checkbox" id="rs-lock" checked> <span>Lock aspect ratio</span></label>' +
        select('rs-mode', 'When dimensions differ', [['fit', 'Fit inside box'], ['stretch', 'Stretch to exact box']]) +
        buttons([['rs-apply', 'Resize image']])) +
      group('Export', select('rs-format', 'Format', [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']]) +
        range('rs-quality', 'Quality (JPG/WebP)', 0.1, 1, 0.92, 0.01, ''));
    return workspace('image-resizer', controls, output('Resized preview'));
  },

  'image-to-svg': function () {
    const controls = upload('image/png,image/jpeg,image/webp', false, 'The SVG embeds the original pixels as a Base64 data URL. It is a wrapper, not a vector trace.') +
      group('What you get', '<p class="hint">The exported .svg contains width, height and a single &lt;image&gt; element with an embedded data URL. Lines and shapes are not editable, and scaling enlarges the same pixels.</p>');
    return workspace('image-to-svg', controls, output('SVG wrapper preview'));
  },

  'image-inverter': function () {
    const controls = upload('image/png,image/jpeg,image/webp', false, 'Red, green and blue values are reversed. Alpha is preserved exactly.') +
      group('Export', select('inv-format', 'Format', [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']]) +
        range('inv-quality', 'Quality (JPG/WebP)', 0.1, 1, 0.92, 0.01, ''));
    return workspace('image-inverter', controls, output('Negative preview'));
  },

  'image-to-text': function () {
    const controls = group('OCR engine', '<p class="hint" id="ocr-worker-status">Loading local OCR engine…</p>' +
      '<p class="hint">The Tesseract.js worker and English data load with this page. Your image is recognised in the browser.</p>') +
      upload('image/png,image/jpeg,image/webp', false, 'Printed English text works best: large, high-contrast characters on a plain background.') +
      group('Recognition', buttons([['ocr-extract', 'Extract text', 'btn']])) +
      group('Result', '<textarea id="ocr-output" class="output-box" rows="9" readonly placeholder="Extracted text appears here after recognition."></textarea>' +
        buttons([['ocr-copy', 'Copy text'], ['ocr-download', 'Download .txt']]));
    const out = '<div class="image-output">' +
      '<div class="workspace-head"><h2>Source preview</h2><span class="pill" id="image-meta">No image loaded</span></div>' +
      '<div class="image-preview-frame"><canvas id="image-preview" width="800" height="480" aria-label="Image being recognised"></canvas></div>' +
      '<div class="status" id="image-status" role="status" aria-live="polite"></div>' +
      '<p class="hint">Recognition is never perfect. Compare the result with the source, especially punctuation and similar characters.</p>' +
    '</div>';
    return workspace('image-to-text', controls, out);
  },

  'qr-code-generator': function () {
    const controls = group('Content', '<div class="opt-row"><label class="opt"><input type="radio" name="qr-mode" value="text" checked> <span>Text or URL</span></label>' +
      '<label class="opt"><input type="radio" name="qr-mode" value="image"> <span>Image data URL</span></label></div>' +
      '<textarea id="qr-text" rows="4" placeholder="Paste a URL or the text you want to encode…"></textarea>' +
      '<input type="file" id="qr-image-file" accept="image/png,image/jpeg,image/webp">' +
      '<p class="hint">Image mode only embeds a data URL when it fits the QR capacity. Nothing is uploaded; use a hosted public URL for larger pictures.</p>') +
      group('Encoding', select('qr-ecc', 'Error correction', [['L', 'Low (largest capacity)'], ['M', 'Medium'], ['Q', 'High'], ['H', 'Highest']]) +
        range('qr-size', 'Module size', 2, 16, 8, 1, 'px')) +
      group('Colours and spacing', color('qr-foreground', 'Modules', '#0f172a') + color('qr-background', 'Background', '#ffffff') +
        range('qr-margin', 'Quiet zone', 2, 8, 4, 1, ' modules')) +
      group('Generate', buttons([['qr-generate', 'Generate QR code', 'btn'], ['qr-reset', 'Reset QR code']]));
    return workspace('qr-code-generator', controls, output('QR preview', [
      '<button type="button" class="btn btn-secondary btn-small" id="qr-download-svg" disabled>Download SVG</button>'
    ]));
  },

  'image-compressor': function () {
    const controls = upload('image/png,image/jpeg,image/webp', false, 'Files above 50 MB are rejected so the page remains responsive.') +
      group('Compression', select('cmp-format', 'Output format', [['jpeg', 'JPG'], ['webp', 'WebP'], ['png', 'PNG']]) +
        range('cmp-quality', 'Quality (JPG/WebP)', 0.1, 1, 0.75, 0.01, '') +
        number('cmp-max-dimension', 'Maximum longest edge (blank = original)', '', 1, 8000, 1)) +
      group('Result', '<div class="stat-grid"><div class="stat-tile"><span>Original</span><strong id="cmp-original-size">—</strong></div>' +
        '<div class="stat-tile"><span>Compressed</span><strong id="cmp-result-size">—</strong></div></div>');
    return workspace('image-compressor', controls, output('Compressed preview'));
  }
};

const VENDOR_SCRIPTS = {
  'heic-viewer': ['js/vendor/libheif-bundle.js'],
  'image-to-text': ['js/vendor/tesseract.min.js'],
  'qr-code-generator': ['js/vendor/qrcode-generator.js']
};

function has(engine) {
  return Object.prototype.hasOwnProperty.call(WORKSPACES, engine);
}

function workspaceFor(engine) {
  return has(engine) ? WORKSPACES[engine]() : null;
}

function vendorScripts(engine) {
  return VENDOR_SCRIPTS[engine] || [];
}

module.exports = { has, workspaceFor, vendorScripts, WORKSPACES };
