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

function textInput(id, label, value, placeholder) {
  return '<div class="field"><label for="' + id + '">' + label + '</label>' +
    '<input type="text" id="' + id + '" value="' + (value || '') + '" placeholder="' + (placeholder || '') + '"></div>';
}

function textarea(id, label, rows, placeholder) {
  return '<div class="field"><label for="' + id + '">' + label + '</label>' +
    '<textarea id="' + id + '" rows="' + (rows || 3) + '" placeholder="' + (placeholder || '') + '"></textarea></div>';
}

function color(id, label, value) {
  return '<div class="field color-field"><label for="' + id + '">' + label + '</label>' +
    '<input type="color" id="' + id + '" value="' + value + '"></div>';
}

function check(id, label, checked) {
  return '<label class="opt"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') +
    '> <span>' + label + '</span></label>';
}

function buttons(items) {
  return '<div class="output-actions">' + items.map(item =>
    '<button type="button" class="' + (item[2] || 'btn btn-secondary btn-small') + '" id="' + item[0] + '">' + item[1] + '</button>'
  ).join('') + '</div>';
}

function chips(id, items) {
  return '<div class="chip-row" id="' + id + '">' + items.map(item =>
    '<button type="button" class="chip"' + (item[2] ? ' data-' + item[2][0] + '="' + item[2][1] + '"' : '') +
    ' data-value="' + item[0] + '">' + item[1] + '</button>').join('') + '</div>';
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
    const controls = upload('image/png,image/jpeg,image/webp', false, 'JPG, PNG and WebP are supported. Everything stays in your browser.') +
      group('Crop & aspect', '<div class="two-cols">' +
        range('ie-crop-x', 'Left', 0, 100, 0, 1, 'px') + range('ie-crop-y', 'Top', 0, 100, 0, 1, 'px') +
        range('ie-crop-w', 'Width', 1, 100, 100, 1, 'px') + range('ie-crop-h', 'Height', 1, 100, 100, 1, 'px') + '</div>' +
        select('ie-aspect', 'Aspect ratio', [['free', 'Free form'], ['1', 'Square (1:1)'], ['1.333333', 'Photo (4:3)'],
          ['1.5', 'Classic (3:2)'], ['1.777778', 'Widescreen (16:9)'], ['0.5625', 'Portrait (9:16)'], ['2', 'Panorama (2:1)']]) +
        buttons([['ie-crop-apply', 'Apply crop'], ['ie-crop-full', 'Full image']])) +
      group('Resize & canvas', '<div class="two-cols">' +
        number('ie-out-w', 'Width (px)', 0, 1, 8000, 1) + number('ie-out-h', 'Height (px)', 0, 1, 8000, 1) + '</div>' +
        check('ie-resize-lock', 'Lock aspect ratio', true) +
        select('ie-resize-fit', 'When dimensions differ', [['fit', 'Fit inside box'], ['fill', 'Fill and crop'], ['stretch', 'Stretch exactly']]) +
        buttons([['ie-resize-apply', 'Resize'], ['ie-resize-reset', 'Original size']]) +
        '<div class="two-cols">' + number('ie-canvas-w', 'Canvas width', 0, 1, 8000, 1) + number('ie-canvas-h', 'Canvas height', 0, 1, 8000, 1) + '</div>' +
        color('ie-canvas-color', 'Canvas colour', '#ffffff') +
        select('ie-canvas-pos', 'Image placement', [['center', 'Centre'], ['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']]) +
        buttons([['ie-canvas-apply', 'Apply canvas']])) +
      group('Rotation & orientation', buttons([['ie-rot-left', '↶ Left'], ['ie-rot-right', '↷ Right'], ['ie-flip-h', '⇄ Flip H'], ['ie-flip-v', '⇅ Flip V']]) +
        range('ie-rotate-angle', 'Arbitrary rotation', -180, 180, 0, 1, '°') +
        check('ie-rotate-expand', 'Expand canvas to fit corners', true) +
        color('ie-rotate-bg', 'Corner fill', '#ffffff') +
        buttons([['ie-rotate-apply', 'Apply rotation'], ['ie-rotate-reset', 'Reset angle']])) +
      group('Adjustments', '<div class="two-cols">' +
        range('ie-brightness', 'Brightness', 0, 200, 100, 1, '%') + range('ie-contrast', 'Contrast', 0, 200, 100, 1, '%') +
        range('ie-saturation', 'Saturation', 0, 200, 100, 1, '%') + range('ie-exposure', 'Exposure', -100, 100, 0, 1, '') +
        range('ie-temperature', 'Temperature', -100, 100, 0, 1, '') + range('ie-highlights', 'Highlights', -100, 100, 0, 1, '') +
        range('ie-shadows', 'Shadows', -100, 100, 0, 1, '') + range('ie-sharpness', 'Sharpness', 0, 200, 100, 1, '%') +
        range('ie-blur', 'Blur', 0, 20, 0, 0.5, 'px') + range('ie-vignette', 'Vignette', 0, 100, 0, 1, '%') +
        range('ie-grayscale', 'Grayscale', 0, 100, 0, 1, '%') + range('ie-sepia', 'Sepia', 0, 100, 0, 1, '%') + '</div>' +
        buttons([['ie-adjust-reset', 'Reset adjustments']])) +
      group('Filter presets', chips('ie-filters', [
        ['none', 'Original', ['ie-filter', 'none']], ['vivid', 'Vivid'], ['mono', 'Mono'], ['warm', 'Warm'],
        ['cool', 'Cool'], ['faded', 'Faded'], ['noir', 'High contrast']
      ])) +
      group('Text layers', textarea('ie-text', 'Text layer', 2, 'Optional caption. Press Enter for a new line.') +
        '<div class="two-cols">' + select('ie-text-font', 'Font', [['system-ui, sans-serif', 'Sans serif'], ['Georgia, serif', 'Serif'],
          ['ui-monospace, Consolas, monospace', 'Monospace'], ['Impact, sans-serif', 'Impact']]) +
          number('ie-text-size', 'Text size (%)', 5, 1, 30, 1) + '</div>' +
        color('ie-text-color', 'Text colour', '#ffffff') + color('ie-text-outline', 'Outline colour', '#0f172a') +
        range('ie-text-outline-w', 'Outline width', 0, 20, 6, 1, '%') +
        range('ie-text-x', 'Text position X', 0, 100, 50, 1, '%') + range('ie-text-y', 'Text position Y', 0, 100, 85, 1, '%') +
        range('ie-text-rotation', 'Text rotation', -180, 180, 0, 1, '°') +
        check('ie-text-bg', 'Readable backing', true) +
        buttons([['ie-text-add', 'Add layer'], ['ie-text-update', 'Update layer']]) +
        '<div id="ie-layers" class="pm-order"><p class="hint">Extra text layers appear here.</p></div>') +
      group('Shapes, borders & background', select('ie-shape', 'Shape or sticker', [['none', 'None'], ['rectangle', 'Rectangle'],
        ['circle', 'Circle'], ['triangle', 'Triangle'], ['star', 'Star'], ['heart', 'Heart'], ['arrow', 'Arrow'], ['★', 'Star emoji'], ['❤', 'Heart emoji']]) +
        color('ie-shape-color', 'Shape colour', '#2563eb') + range('ie-shape-size', 'Shape size', 1, 60, 12, 1, '%') +
        '<div class="two-cols">' + range('ie-shape-x', 'Shape X', 0, 100, 85, 1, '%') + range('ie-shape-y', 'Shape Y', 0, 100, 15, 1, '%') + '</div>' +
        range('ie-border-width', 'Border width', 0, 100, 0, 1, 'px') + color('ie-border-color', 'Border colour', '#ffffff') +
        select('ie-frame', 'Frame style', [['none', 'No frame'], ['rounded', 'Rounded corners'], ['polaroid', 'Polaroid'], ['shadow', 'Drop shadow']]) +
        check('ie-bg-enable', 'Custom background colour', false) + color('ie-bg-color', 'Background', '#ffffff')) +
      group('Watermark', textInput('ie-watermark-text', 'Watermark text', '', '© Your name') +
        '<div class="two-cols">' + select('ie-watermark-pos', 'Position', [['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'],
          ['top-right', 'Top right'], ['top-left', 'Top left'], ['center', 'Centre']]) +
          range('ie-watermark-size', 'Size', 1, 15, 4, 1, '%') + '</div>' +
        range('ie-watermark-opacity', 'Opacity', 5, 100, 45, 1, '%') + color('ie-watermark-color', 'Colour', '#ffffff')) +
      group('Background removal', '<p class="hint">Removes plain, evenly lit backgrounds connected to the image edges. It is a local colour-flood tool, not AI segmentation.</p>' +
        check('ie-bgremove-enable', 'Remove plain background', false) + range('ie-bgremove-tol', 'Colour tolerance', 5, 160, 45, 1, '') +
        buttons([['ie-bgremove-apply', 'Apply background removal']])) +
      group('History & export', buttons([['ie-undo', '↶ Undo'], ['ie-redo', '↷ Redo']]) +
        select('ie-format', 'Format', [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']]) +
        range('ie-quality', 'Quality (JPG/WebP)', 0.1, 1, 0.92, 0.01, '') +
        check('ie-transparent', 'Keep PNG transparency', true) +
        '<div class="two-cols">' + number('ie-export-w', 'Export width (optional)', 0, 0, 8000, 1) +
          number('ie-export-h', 'Export height (optional)', 0, 0, 8000, 1) + '</div>');
    return workspace('image-editor', controls, output('Crop, adjust, annotate and export locally.'));
  },

  'heic-viewer': function () {
    const controls = upload('.heic,.heif,image/heic,image/heif,image/heif-sequence', true, 'HEIC and HEIF files are identified by their ftyp brand and decoded locally with a bundled libheif build.') +
      group('Source details', '<div class="stat-grid">' +
        '<div class="stat-tile"><span>Original filename</span><strong id="heic-original-name">—</strong></div>' +
        '<div class="stat-tile"><span>Detected format</span><strong id="heic-original-format">—</strong></div></div>' +
        '<p class="hint" id="heic-output-name">Output: choose a format below. The original file is never modified.</p>') +
      group('Download format', select('heic-format', 'Format for previews and downloads', [['png', 'PNG (lossless)'], ['jpeg', 'JPG (smaller)']]) +
        range('heic-quality', 'JPG quality', 0.1, 1, 0.92, 0.01, '') +
        check('heic-orientation', 'Apply EXIF orientation when present', true) +
        check('heic-transparency', 'Keep alpha channel for PNG', true) +
        buttons([['heic-download-all', 'Download all decoded images']])) +
      group('How it works', '<p class="hint">Every thumbnail is a decoded variant exposed by the local library. Files are validated by signature before decoding; unsupported brands are reported honestly, never relabelled as JPEG.</p>');
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
    const controls = upload('image/png,image/jpeg,image/webp', true, 'Up to six files are accepted. Drag the arrows in Image order to change the arrangement.') +
      group('Layout', '<div class="opt-row">' +
        '<label class="opt"><input type="radio" name="pm-direction" value="horizontal" checked> <span>Horizontal row</span></label>' +
        '<label class="opt"><input type="radio" name="pm-direction" value="vertical"> <span>Vertical stack</span></label>' +
        '<label class="opt"><input type="radio" name="pm-direction" value="grid"> <span>Grid</span></label>' +
        '<label class="opt"><input type="radio" name="pm-direction" value="custom"> <span>Custom</span></label></div>') +
      group('Frame size', select('pm-size-mode', 'Sizing', [['original', 'Original sizes'], ['equalWidth', 'Equal width'],
        ['equalHeight', 'Equal height'], ['equalFrame', 'Equal frames'], ['custom', 'Custom cell size']]) +
        check('pm-aspect', 'Maintain aspect ratio', true) +
        select('pm-fit', 'When images differ', [['fit', 'Fit inside frame'], ['fill', 'Fill and crop']]) +
        '<div class="two-cols">' + number('pm-cell-w', 'Cell width (px)', 0, 0, 8000, 1) +
          number('pm-cell-h', 'Cell height (px)', 0, 0, 8000, 1) + '</div>' +
        number('pm-cols', 'Grid columns', 2, 1, 12, 1) +
        select('pm-align', 'Alignment inside frame', [['center', 'Centre'], ['start', 'Top / left'], ['end', 'Bottom / right']])) +
      group('Spacing and background', range('pm-spacing', 'Gap between images', 0, 100, 12, 1, 'px') +
        color('pm-bg', 'Canvas colour', '#ffffff') + range('pm-border-w', 'Border around frames', 0, 40, 0, 1, 'px') +
        color('pm-border-color', 'Border colour', '#0f172a')) +
      group('Image order', '<div class="pm-order" id="pm-order"><p class="hint">Add images to see their order here.</p></div>') +
      group('Merge', buttons([['pm-merge', 'Merge images']]));
    return workspace('photo-merger', controls, output('Merged canvas · gaps use the selected canvas colour, not transparency.'));
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
      '<p class="hint">The Tesseract.js worker and English data load with this page. Recognition never sends your image anywhere.</p>') +
      group('Language', select('ocr-language', 'Recognition language', [['eng', 'English (bundled data)']]) +
        '<p class="hint warning" id="ocr-lang-notice">Only English trained data is present locally. Other languages require their own Tesseract .traineddata file to be supplied and are not offered here.</p>') +
      upload('image/png,image/jpeg,image/webp', false, 'Printed English text works best: large, high-contrast characters on a plain background.') +
      group('Preprocessing', '<div class="two-cols">' +
        check('ocr-gray', 'Grayscale') + check('ocr-contrast', 'Boost contrast') +
        check('ocr-threshold', 'Threshold') + check('ocr-denoise', 'Reduce noise') +
        check('ocr-deskew', 'Deskew / rotate') + check('ocr-ink', 'Blue / dark ink enhancement') + '</div>' +
        range('ocr-threshold-level', 'Threshold level', 0, 255, 150, 1, '') +
        range('ocr-angle', 'Rotation correction', -20, 20, 0, 0.5, '°') +
        '<p class="hint">These toggles really alter the pixels sent to Tesseract. The processed version is shown on the right.</p>') +
      group('Recognition', buttons([['ocr-extract', 'Extract text', 'btn']])) +
      group('Result', '<textarea id="ocr-output" class="output-box" rows="9" placeholder="Extracted text appears here after recognition. You can edit it."></textarea>' +
        '<p class="hint" id="ocr-confidence">Confidence: —</p>' +
        '<p class="hint warning" id="ocr-warnings" hidden></p>' +
        range('ocr-preview-size', 'Result preview font size', 12, 36, 18, 1, 'px') +
        buttons([['ocr-copy', 'Copy text'], ['ocr-download', 'Download .txt']]));
    const out = '<div class="image-output">' +
      '<div class="workspace-head"><h2>Source & processed preview</h2><span class="pill" id="image-meta">No image loaded</span></div>' +
      '<div class="two-cols">' +
        '<div><p class="hint">Original</p><div class="image-preview-frame"><canvas id="image-preview" width="600" height="300" aria-label="Image being recognised"></canvas></div></div>' +
        '<div><p class="hint">After preprocessing</p><div class="image-preview-frame"><canvas id="ocr-preview-processed" width="600" height="300" aria-label="Processed OCR image"></canvas></div></div>' +
      '</div>' +
      '<pre class="output-box" id="ocr-text-preview" style="max-height:110px;font-size:18px">Extracted text will appear here.</pre>' +
      '<div class="status" id="image-status" role="status" aria-live="polite"></div>' +
      '<p class="hint">Recognition is never perfect. Compare the result with the source, especially punctuation and similar characters.</p>' +
    '</div>';
    return workspace('image-to-text', controls, out);
  },

  'qr-code-generator': function () {
    const controls = group('Payload type', select('qr-type', 'What should the code contain?', [
      ['text', 'Plain text'], ['url', 'Website URL'], ['email', 'Email address'], ['phone', 'Phone number'],
      ['sms', 'SMS'], ['wifi', 'Wi-Fi network'], ['vcard', 'Contact (vCard)'], ['location', 'Map location'],
      ['calendar', 'Calendar event'], ['whatsapp', 'WhatsApp message'], ['image', 'Image data URL']
    ]) +
      '<div class="opt-row" id="qr-mode-row"><label class="opt"><input type="radio" name="qr-mode" value="text" checked> <span>Simple text</span></label>' +
      '<label class="opt"><input type="radio" name="qr-mode" value="image"> <span>Image data URL</span></label></div>') +
      group('Payload details', '<div id="qr-fields-text">' + textarea('qr-text', 'Text', 3, 'Paste a URL or the text you want to encode…') + '</div>' +
        '<div id="qr-fields-url" hidden>' + textInput('qr-url', 'URL', '', 'https://example.com/page') + '</div>' +
        '<div id="qr-fields-email" hidden>' + textInput('qr-email', 'Email address', '', 'name@example.com') +
          textInput('qr-subject', 'Subject (optional)', '', 'Hello') +
          textarea('qr-body', 'Message (optional)', 2, 'Written message…') + '</div>' +
        '<div id="qr-fields-phone" hidden>' + textInput('qr-phone', 'Phone number', '', '+1 555 0100') + '</div>' +
        '<div id="qr-fields-sms" hidden>' + textInput('qr-sms-phone', 'Phone number', '', '+1 555 0100') +
          textarea('qr-message', 'Message', 2, 'Hi, please call me.') + '</div>' +
        '<div id="qr-fields-wifi" hidden>' + textInput('qr-ssid', 'Network name (SSID)', '', 'My Network') +
          select('qr-encryption', 'Security', [['WPA', 'WPA / WPA2'], ['WEP', 'WEP'], ['nopass', 'Open network']]) +
          textInput('qr-password', 'Password', '', 'Network password') + check('qr-hidden', 'Hidden network', false) + '</div>' +
        '<div id="qr-fields-vcard" hidden>' + textInput('qr-name', 'Full name', '', 'Ada Lovelace') +
          textInput('qr-org', 'Organisation (optional)', '', 'Example Ltd') +
          textInput('qr-vcard-phone', 'Phone (optional)', '', '+1 555 0100') +
          textInput('qr-vcard-email', 'Email (optional)', '', 'ada@example.com') +
          textInput('qr-vcard-url', 'Website (optional)', '', 'https://example.com') + '</div>' +
        '<div id="qr-fields-location" hidden>' + '<div class="two-cols">' +
          number('qr-latitude', 'Latitude', 51.5, -90, 90, 0.000001) + number('qr-longitude', 'Longitude', -0.12, -180, 180, 0.000001) + '</div></div>' +
        '<div id="qr-fields-calendar" hidden>' + textInput('qr-event-title', 'Event title', '', 'Team meeting') +
          textInput('qr-event-location', 'Location (optional)', '', 'Meeting room') +
          '<div class="two-cols">' + textInput('qr-start', 'Starts', '2026-12-01T09:00', 'YYYY-MM-DDTHH:mm') +
            textInput('qr-end', 'Ends', '2026-12-01T10:00', 'YYYY-MM-DDTHH:mm') + '</div></div>' +
        '<div id="qr-fields-whatsapp" hidden>' + textInput('qr-whatsapp-phone', 'Number with country code', '', '15550100') +
          textarea('qr-whatsapp-message', 'Prefilled message (optional)', 2, 'Hello!') + '</div>' +
        '<div id="qr-fields-image" hidden>' +
          '<input type="file" id="qr-image-file" accept="image/png,image/jpeg,image/webp">' +
          '<p class="hint">Small images only. Nothing is uploaded; a data URL is embedded locally.</p></div>' +
        '<p class="hint warning" id="qr-validation" hidden></p>') +
      group('Encoding', select('qr-kind', 'Code type', [['qr', 'QR code (2D)'], ['code128', 'Code 128'], ['code39', 'Code 39'],
        ['ean13', 'EAN-13'], ['ean8', 'EAN-8'], ['upca', 'UPC-A'], ['itf', 'ITF / Interleaved 2 of 5']]) +
        '<p class="hint" id="qr-kind-note">Barcodes encode short numeric or alphanumeric payloads; choose QR for links, Wi-Fi and contacts.</p>' +
        check('qr-live', 'Live preview while typing', false) +
        select('qr-ecc', 'QR error correction', [['L', 'Low (largest capacity)'], ['M', 'Medium'], ['Q', 'High'], ['H', 'Highest']]) +
        range('qr-size', 'Module size', 2, 16, 8, 1, 'px') +
        range('qr-bar-height', 'Barcode height', 40, 400, 120, 10, 'px')) +
      group('Colours, logo & spacing', color('qr-foreground', 'Modules', '#0f172a') +
        color('qr-background', 'Background', '#ffffff') +
        range('qr-margin', 'Quiet zone', 2, 8, 4, 1, ' modules') +
        '<input type="file" id="qr-logo-file" accept="image/png,image/jpeg,image/webp">' +
        range('qr-logo-size', 'Logo size', 5, 28, 18, 1, '%') +
        '<p class="hint">A centre logo uses QR error correction. Verify the result before printing.</p>') +
      group('Generate & verify', buttons([['qr-generate', 'Generate code', 'btn'], ['qr-verify', 'Verify QR'], ['qr-print', 'Print'], ['qr-reset', 'Reset']]));
    return workspace('qr-code-generator', controls, output('Live code preview', [
      '<button type="button" class="btn btn-secondary btn-small" id="qr-download-svg" disabled>Download SVG</button>'
    ]));
  },

  'thumbnail-generator': function () {
    const presets = [
      ['youtube', 'YouTube thumbnail — 1280×720'], ['shorts', 'YouTube Shorts — 1080×1920'],
      ['instagram-post', 'Instagram post — 1080×1080'], ['instagram-reel', 'Instagram Reel — 1080×1920'],
      ['instagram-story', 'Instagram Story — 1080×1920'], ['tiktok', 'TikTok — 1080×1920'],
      ['facebook-post', 'Facebook post — 1200×630'], ['facebook-cover', 'Facebook cover — 851×315'],
      ['facebook-video', 'Facebook video — 1280×720'], ['linkedin-post', 'LinkedIn post — 1200×627'],
      ['linkedin-banner', 'LinkedIn banner — 1584×396'], ['x-post', 'X / Twitter — 1200×675'],
      ['pinterest', 'Pinterest Pin — 1000×1500'], ['custom', 'Custom size']
    ];
    /* The script-specific font list is replaced by the editor at runtime. */
    const basicFonts = [
      ['700 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', 'Sans'],
      ['700 Georgia, "Times New Roman", serif', 'Serif'],
      ['900 Impact, "Arial Black", sans-serif', 'Impact'],
      ['700 ui-monospace, Consolas, monospace', 'Monospace']
    ];
    const textField = '<div class="field"><label for="tg-text">Text or emoji</label>' +
      '<textarea id="tg-text" rows="2" dir="auto" placeholder="Add a headline, label or emoji…"></textarea>' +
      '<p class="hint">Unicode is preserved exactly. Direction is detected from the first strong character.</p></div>';

    const controls = upload('image/png,image/jpeg,image/webp', true,
      'Upload up to eight photos. Each image stays an independent layer; no upload leaves your device.') +
      group('Canvas preset', select('tg-preset', 'Verified size preset', presets) +
        '<div class="two-cols">' + number('tg-width', 'Width (px)', 1280, 64, 8000, 1) + number('tg-height', 'Height (px)', 720, 64, 8000, 1) + '</div>' +
        '<p class="hint" id="tg-preset-note">YouTube thumbnails are 1280×720 px.</p>' +
        chips('tg-preset-chips', [['youtube', 'YouTube'], ['instagram-post', 'Instagram'], ['tiktok', 'TikTok'], ['linkedin-post', 'LinkedIn']])) +
      group('Background & layout', select('tg-bg-type', 'Background', [['gradient', 'Gradient'], ['solid', 'Solid colour'], ['transparent', 'Transparent']]) +
        color('tg-color1', 'First / solid colour', '#0f172a') + color('tg-color2', 'Second colour', '#2563eb') +
        range('tg-padding', 'Image padding', 0, 200, 40, 1, 'px') + range('tg-radius', 'Corner radius', 0, 120, 18, 1, 'px') +
        range('tg-shadow', 'Shadow strength', 0, 100, 35, 1, '%') +
        check('tg-remove-bg', 'Remove plain photo background', false) +
        range('tg-bg-tolerance', 'Background colour tolerance', 5, 160, 45, 1, '') +
        check('tg-safe-guides', 'Show platform safe area', false)) +
      group('Layers', textInput('tg-layer-name', 'Layer name', 'Title', 'Text, sticker or photo') +
        select('tg-layer-type', 'Layer type', [['text', 'Text'], ['shape', 'Shape'], ['sticker', 'Emoji / sticker'], ['image', 'Uploaded image']]) +
        textField +
        select('tg-direction', 'Text direction', [['auto', 'Auto (Unicode)'], ['ltr', 'Left to right'], ['rtl', 'Right to left']]) +
        '<div class="two-cols">' + select('tg-font', 'Font', basicFonts) +
        select('tg-font-weight', 'Font weight', [['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extra bold'], ['900', 'Black']]) + '</div>' +
        '<div class="two-cols">' + number('tg-font-size', 'Font size (px)', 92, 8, 500, 1) +
        range('tg-line-height', 'Line height', 0.8, 2.4, 1.15, 0.05, '') + '</div>' +
        range('tg-letter-spacing', 'Letter spacing', -4, 20, 0, 0.5, 'px') +
        color('tg-text-color', 'Colour', '#ffffff') + check('tg-gradient', 'Gradient text fill') +
        color('tg-outline-color', 'Outline colour', '#0f172a') +
        range('tg-outline-width', 'Outline width', 0, 20, 5, 1, 'px') +
        check('tg-text-shadow', 'Text shadow', true) + color('tg-shadow-color', 'Shadow colour', '#0f172a') +
        range('tg-shadow-blur', 'Shadow blur', 0, 60, 12, 1, 'px') +
        check('tg-text-bg', 'Readable text backing', false) +
        select('tg-align', 'Text alignment', [['start', 'Start'], ['center', 'Centre'], ['end', 'End'], ['left', 'Left (legacy)'], ['right', 'Right (legacy)']]) +
        range('tg-layer-rotation', 'Layer rotation', -180, 180, 0, 1, '°') +
        '<div class="two-cols">' + range('tg-layer-x', 'X position', 0, 100, 50, 1, '%') + range('tg-layer-y', 'Y position', 0, 100, 50, 1, '%') + '</div>' +
        '<div class="two-cols">' + range('tg-layer-w', 'Width', 2, 100, 70, 1, '%') + range('tg-layer-h', 'Height', 2, 100, 30, 1, '%') + '</div>' +
        range('tg-layer-opacity', 'Opacity', 0, 100, 100, 1, '%') +
        select('tg-layer-blend', 'Blend mode', [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'],
          ['overlay', 'Overlay'], ['lighten', 'Lighten'], ['darken', 'Darken'], ['color-dodge', 'Colour dodge']]) +
        '<div class="tg-layer-flags">' + check('tg-layer-visible', 'Visible', true) + check('tg-layer-locked', 'Locked', false) + '</div>' +
        buttons([['tg-layer-add', 'Add layer'], ['tg-layer-update', 'Update'], ['tg-layer-duplicate', 'Duplicate'], ['tg-layer-delete', 'Delete']]) +
        buttons([['tg-layer-up', '↑ Bring forward'], ['tg-layer-down', '↓ Send back']]) +
        '<div class="pm-order" id="tg-layers"><p class="hint">No extra layers yet.</p></div>') +
      group('Image layer', select('tg-image-src', 'Image on this layer', [['', 'No image uploaded']]) +
        select('tg-image-fit', 'Fit', [['contain', 'Contain'], ['cover', 'Cover'], ['stretch', 'Stretch']]) +
        '<div class="tg-layer-flags">' + check('tg-image-flip-x', 'Flip horizontally', false) + check('tg-image-flip-y', 'Flip vertically', false) + '</div>' +
        '<div class="two-cols">' + range('tg-crop-left', 'Crop left', 0, 45, 0, 1, '%') + range('tg-crop-right', 'Crop right', 0, 45, 0, 1, '%') + '</div>' +
        '<div class="two-cols">' + range('tg-crop-top', 'Crop top', 0, 45, 0, 1, '%') + range('tg-crop-bottom', 'Crop bottom', 0, 45, 0, 1, '%') + '</div>' +
        range('tg-image-border', 'Border width', 0, 40, 0, 1, 'px') + color('tg-image-border-color', 'Border colour', '#ffffff') +
        range('tg-image-radius', 'Corner radius', 0, 120, 16, 1, 'px') + check('tg-image-shadow', 'Drop shadow', false) +
        check('tg-image-remove-bg', 'Remove plain background', false)) +
      group('Shapes & stickers', select('tg-shape', 'Shape', [['none', 'None'], ['rect', 'Rectangle'], ['circle', 'Circle'],
        ['triangle', 'Triangle'], ['star', 'Star'], ['heart', 'Heart'], ['arrow', 'Arrow'], ['line', 'Line']]) +
        textInput('tg-sticker-glyph', 'Sticker glyph', '★', 'A Unicode emoji or symbol')) +
      group('Templates & stickers', '<p class="hint">Templates are original layouts made from editable text, shapes and photos.</p>' +
        chips('tg-templates', [['bold', 'Bold headline'], ['quote', 'Quote card'], ['badge', 'Sale badge'],
          ['split', 'Split photo'], ['global', 'Global scripts']]) +
        chips('tg-stickers', [['★', '★'], ['❤', '❤'], ['✓', '✓'], ['→', '→'], ['●', '●'], ['◆', '◆'], ['🎉', '🎉'], ['🔥', '🔥']])) +
      group('Photo adjustments', '<div class="two-cols">' +
        range('tg-brightness', 'Brightness', 0, 200, 100, 1, '%') + range('tg-contrast', 'Contrast', 0, 200, 100, 1, '%') +
        range('tg-saturation', 'Saturation', 0, 200, 100, 1, '%') + range('tg-blur', 'Blur', 0, 12, 0, 0.5, 'px') + '</div>' +
        select('tg-filter', 'Filter', [['none', 'None'], ['vivid', 'Vivid'], ['mono', 'Mono'], ['warm', 'Warm'], ['cool', 'Cool']])) +
      group('Alignment & history', check('tg-guides', 'Show alignment guides', true) +
        buttons([['tg-align-left', '⇤ Left'], ['tg-align-center', '↔ Centre'], ['tg-align-right', '⇥ Right'],
          ['tg-align-top', '↑ Top'], ['tg-align-middle', '↕ Middle'], ['tg-align-bottom', '↓ Bottom']]) +
        buttons([['tg-undo', '↶ Undo'], ['tg-redo', '↷ Redo']])) +
      group('Project', buttons([['tg-project-save', 'Save project JSON'], ['tg-project-load', 'Load project'], ['tg-reset-project', 'Reset project']]) +
        '<input type="file" id="tg-project-file" accept="application/json,.json">' +
        '<p class="hint">Projects and uploaded images stay on this device. Nothing is uploaded.</p>') +
      group('Export', select('tg-format', 'Format', [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']]) +
        range('tg-quality', 'Quality (JPG/WebP)', 0.1, 1, 0.92, 0.01, '') +
        '<p class="hint">Drag a layer on the preview to move, pull a corner handle to resize, or use the rotate handle. Arrow keys nudge the selected layer.</p>');

    const previewButton = function (id, glyph, label) {
      return '<button type="button" class="btn btn-secondary btn-small" id="' + id + '" title="' + label + '" aria-label="' + label + '">' + glyph + '</button>';
    };
    const out = '<div class="image-output thumbnail-output">' +
      '<div class="workspace-head"><h2>Thumbnail canvas</h2><span class="pill" id="image-meta">1280×720 · 1 layer</span></div>' +
      '<div class="tg-preview-toolbar" role="toolbar" aria-label="Preview controls">' +
        previewButton('tg-zoom-in', '+', 'Zoom in') + previewButton('tg-zoom-out', '−', 'Zoom out') +
        previewButton('tg-zoom-fit', 'Fit', 'Fit preview to frame') + previewButton('tg-fullscreen', '⛶', 'Fullscreen preview') +
        '<span class="tg-toolbar-divider" aria-hidden="true"></span>' +
        previewButton('tg-mode-preview', 'Preview', 'Preview mode') + previewButton('tg-mode-controls', 'Controls', 'Editing controls mode') +
      '</div>' +
      '<div class="image-preview-frame thumbnail-preview-frame tg-stage" id="tg-stage">' +
        '<div class="tg-stage-inner" id="tg-stage-inner" style="position:relative;display:inline-block;width:100%;transform-origin:center center;">' +
          '<canvas id="image-preview" width="1280" height="720" tabindex="0" aria-label="Thumbnail preview" style="display:block;width:100%;height:auto;"></canvas>' +
          '<canvas id="tg-overlay" width="1280" height="720" tabindex="0" aria-label="Thumbnail layer handles" style="position:absolute;inset:0;left:0;top:0;width:100%;height:100%;touch-action:none;"></canvas>' +
        '</div>' +
      '</div>' +
      '<div class="status" id="image-status" role="status" aria-live="polite"></div>' +
      '<div class="output-actions"><button type="button" class="btn" id="image-download" disabled>Download thumbnail</button></div>' +
      '<div class="image-output-note">Thumbnail canvas · drag layers to edit · all processing is local.</div>' +
    '</div>';
    return workspace('thumbnail-generator', controls, out);
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
  'qr-code-generator': ['js/vendor/qrcode-generator.js', 'js/vendor/jsQR.js']
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
