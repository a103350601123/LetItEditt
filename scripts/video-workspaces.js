/* Build-time workspace templates for Video & Audio tools.
 * Every string here is static markup; js/video-runtime.js binds behaviour by id.
 * Heavy media engines are loaded on demand by js/video-core.js, so these pages
 * carry no codec or model script tags. */
'use strict';

function field(label, control, hint) {
  return '<div class="field"><label>' + label + '</label>' + control +
    (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>';
}

function group(title, content) {
  return '<div class="opt-group"><span class="opt-title">' + title + '</span>' + content + '</div>';
}

function range(id, label, min, max, value, step) {
  return '<div class="field range-field"><label for="' + id + '">' + label +
    ' <output id="' + id + '-value">' + value + '</output></label>' +
    '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '"></div>';
}

function numbered(id, label, value, min, max, step) {
  return '<div class="field"><label for="' + id + '">' + label + '</label>' +
    '<input type="number" id="' + id + '" value="' + value + '" min="' + min + '" max="' + max + '" step="' + step + '"></div>';
}

function select(id, label, options) {
  var body = options.map(function (pair) {
    return '<option value="' + pair[0] + '">' + pair[1] + '</option>';
  }).join('');
  return field(label, '<select id="' + id + '">' + body + '</select>');
}

function file(id, label, accept, hint) {
  return field(label, '<input type="file" id="' + id + '" accept="' + accept + '">', hint);
}

function check(id, label, hint) {
  return '<label class="check-line"><input type="checkbox" id="' + id + '"> <span>' + label + '</span></label>' +
    (hint ? '<p class="hint">' + hint + '</p>' : '');
}

function buttons(items) {
  var body = items.map(function (item) {
    return '<button class="btn btn-small' + (item.primary ? ' btn-primary' : '') +
      '" type="button" id="' + item.id + '">' + item.label + '</button>';
  }).join('');
  return '<div class="output-actions">' + body + '</div>';
}

function outputPanel(tool) {
  var visual = '';
  if (tool.engine === 'audio-editor') {
    visual = '<canvas id="v-waveform" class="video-canvas waveform" width="640" height="170" role="img" aria-label="Audio waveform preview"></canvas>' +
      '<audio id="v-audio" controls playsinline hidden></audio>';
  } else if (tool.engine === 'subtitle-generator') {
    visual = '<label class="field" for="v-transcript">Editable timed transcript</label>' +
      '<textarea id="v-transcript" class="video-textarea" spellcheck="false" placeholder="Timed lines appear here as 00:00:01.200 --> 00:00:03.400 | text"></textarea>';
  } else if (tool.engine === 'video-to-shorts') {
    visual = '<div id="v-clips" class="clip-list"><p class="hint">Analyse a video to see real candidate clips here.</p></div>';
  } else if (tool.engine === 'watermark-remover') {
    visual = '<canvas id="v-mask-canvas" class="video-canvas" width="640" height="360" role="img" aria-label="Source frame with mask selection"></canvas>' +
      '<video id="v-preview" class="video-player" controls playsinline hidden></video>';
  } else if (tool.engine === 'mp4-to-gif') {
    visual = '<img id="v-gif" class="gif-preview" alt="Animated GIF preview of the selected video range" hidden>';
  } else {
    visual = '<video id="v-preview" class="video-player" controls playsinline></video>';
  }
  return '<div class="image-preview-frame video-preview-frame">' + visual + '</div>' +
    '<p class="status" id="v-status" role="status" aria-live="polite">Choose a file to begin.</p>' +
    '<div class="output-actions">' +
    '<button class="btn btn-small" type="button" id="v-cancel" disabled>Cancel</button>' +
    '<button class="btn btn-small btn-primary" type="button" id="v-download" disabled>Download</button>' +
    '</div>';
}

function inputPanel(tool, groups) {
  return '<section class="container"><div class="workspace video-workspace">' +
    '<div class="workspace-head"><h2>' + tool.name + ' workspace</h2>' +
    '<span class="card-tag">Local processing</span></div>' +
    '<div class="image-grid video-grid">' +
    '<div class="image-controls video-controls">' + groups.join('') + '</div>' +
    '<div class="image-output video-output">' + outputPanel(tool) + '</div>' +
    '</div></div></section>';
}

const NAMES = {
  'audio-editor': 'Audio Editor',
  'screen-recorder': 'Screen Recorder',
  'video-trimmer': 'Video Trimmer',
  'mp4-to-gif': 'MP4 to GIF',
  'video-background-remover': 'Video Background Remover',
  'subtitle-generator': 'Multilingual Subtitle Generator',
  'watermark-remover': 'Video Text & Watermark Remover',
  'video-to-shorts': 'AI Video-to-Shorts',
  'video-editor': 'Professional Video Editor'
};

const WORKSPACES = {
  'audio-editor': function (tool) {
    return inputPanel(tool, [
      group('Source', file('v-file', 'Audio or video file', 'audio/*,video/*',
        'Decoded locally. WAV, MP3, M4A, OGG, MP4 and WebM usually work.')),
      group('Trim', range('v-start', 'Start', 0, 1000, 0, 1) + range('v-end', 'End', 0, 1000, 1000, 1)),
      group('Sound', range('v-gain', 'Volume %', 0, 200, 100, 1) +
        range('v-fade-in', 'Fade in (ms)', 0, 3000, 0, 50) +
        range('v-fade-out', 'Fade out (ms)', 0, 3000, 0, 50) +
        check('v-reverse', 'Reverse audio')),
      group('Export', select('v-format', 'Format', [
        ['mp3', 'MP3 (local LAME)'], ['wav', 'WAV (lossless)'], ['m4a', 'M4A / AAC (if supported)']
      ]) + buttons([
        { id: 'v-process', label: 'Apply edits', primary: true },
        { id: 'v-play', label: 'Play preview' },
        { id: 'v-stop', label: 'Stop' },
        { id: 'v-reset', label: 'Reset' }
      ]) + '<p class="hint">The preview and export use the same edited samples.</p>')
    ]);
  },

  'video-trimmer': function (tool) {
    return inputPanel(tool, [
      group('Source', file('v-file', 'Video file', 'video/*', 'The timeline reflects the real decoded duration.')),
      group('Selection', range('v-start', 'Start', 0, 1000, 0, 1) +
        range('v-end', 'End', 0, 1000, 1000, 1) +
        '<p class="hint">Stream copy seeks to the nearest keyframe. Choose re-encode for frame-accurate cuts.</p>'),
      group('Output', select('v-format', 'Container', [
        ['auto', 'Match source'], ['mp4', 'MP4'], ['webm', 'WebM']
      ]) + check('v-copy', 'Stream copy when possible',
        'Faster and lossless, but cut points may shift to keyframes.') +
        buttons([{ id: 'v-process', label: 'Trim video', primary: true }]))
    ]);
  },

  'mp4-to-gif': function (tool) {
    return inputPanel(tool, [
      group('Source', file('v-file', 'MP4 or other video', 'video/*',
        'Frames are decoded locally; only the chosen range is encoded.')),
      group('Range', range('v-start', 'Start', 0, 1000, 0, 1) + range('v-end', 'End', 0, 1000, 1000, 1)),
      group('GIF', select('v-fps', 'Frames per second', [
        ['10', '10 fps'], ['8', '8 fps'], ['12', '12 fps'], ['15', '15 fps'], ['5', '5 fps']
      ]) + select('v-width', 'Width', [
        ['320', '320 px'], ['240', '240 px'], ['480', '480 px'], ['640', '640 px']
      ]) + check('v-dither', 'Dither gradients', 'Smoother colour transitions, slightly larger file.') +
        buttons([{ id: 'v-process', label: 'Create GIF', primary: true }]))
    ]);
  },

  'video-background-remover': function (tool) {
    return inputPanel(tool, [
      group('Source', file('v-file', 'Video with a person', 'video/*',
        'Person segmentation works best on clear, front-facing shots.')),
      group('Local AI opt-in', check('v-ai-consent',
        'Download and run MediaPipe segmentation locally',
        'About 15 MB of code/model files are fetched once from official hosts. Your video is not uploaded.')),
      group('Replacement', select('v-bg', 'Background', [
        ['color', 'Solid colour'], ['image', 'Uploaded image'], ['transparent', 'Transparent WebM (if supported)']
      ]) + '<input type="color" id="v-color" value="#2563eb" aria-label="Background colour">' +
        file('v-bg-file', 'Background image (optional)', 'image/*')),
      group('Mask', range('v-threshold', 'Confidence', 50, 95, 70, 1) +
        range('v-feather', 'Edge softness', 0, 12, 3, 1) +
        select('v-format', 'Export', [['webm', 'WebM'], ['mp4', 'MP4 (no transparency)']]) +
        buttons([{ id: 'v-process', label: 'Replace background', primary: true }]))
    ]);
  },

  'subtitle-generator': function (tool) {
    return inputPanel(tool, [
      group('Source', file('v-file', 'Audio or video', 'audio/*,video/*',
        'Speech is converted from the local audio track.')),
      group('Recognition', check('v-ai-consent', 'Download and run Whisper tiny locally',
        'First use downloads roughly 75-80 MB of model/runtime files. Nothing is uploaded.') +
        select('v-language', 'Language', [
          ['auto', 'Detect automatically'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'],
          ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['hi', 'Hindi'],
          ['ja', 'Japanese'], ['zh', 'Chinese']
        ])),
      group('Transcript', buttons([{ id: 'v-process', label: 'Generate transcript', primary: true }]) +
        '<p class="hint">Edit the timed lines on the right, then download SRT, VTT or plain text.</p>'),
      group('Download', buttons([
        { id: 'v-srt', label: 'SRT' }, { id: 'v-vtt', label: 'VTT' }, { id: 'v-txt', label: 'TXT' }
      ]))
    ]);
  },

  'watermark-remover': function (tool) {
    return inputPanel(tool, [
      group('Source', file('v-file', 'Video file', 'video/*',
        'Drag on the first frame to select the area to cover.')),
      group('Area (%)', numbered('v-x', 'X', 10, 0, 100, 1) + numbered('v-y', 'Y', 10, 0, 100, 1) +
        numbered('v-w', 'Width', 25, 1, 100, 1) + numbered('v-h', 'Height', 15, 1, 100, 1)),
      group('Cover method', select('v-method', 'Method', [
        ['blur', 'Heavy blur'], ['mosaic', 'Mosaic / pixelate'], ['fill', 'Solid fill'], ['clone', 'Neighbour colour fill']
      ]) + range('v-strength', 'Strength', 1, 20, 8, 1) +
        '<p class="hint">This masks the region. It does not reconstruct pixels that were behind the text.</p>' +
        buttons([{ id: 'v-process', label: 'Apply mask', primary: true }]))
    ]);
  },

  'video-to-shorts': function (tool) {
    return inputPanel(tool, [
      group('Source', file('v-file', 'Longer video', 'video/*',
        'Moments are ranked from real audio energy and frame changes.')),
      group('Clips', select('v-count', 'Number of clips', [
        ['2', '2 clips'], ['1', '1 clip'], ['3', '3 clips']
      ]) + select('v-length', 'Clip length', [
        ['30', '30 seconds'], ['15', '15 seconds'], ['45', '45 seconds'], ['60', '60 seconds']
      ]) + select('v-format', 'Export', [['mp4', 'MP4'], ['webm', 'WebM']])),
      group('Optional local AI', check('v-ai-consent', 'Use Whisper to favour speech-heavy moments',
        'Downloads roughly 75-80 MB on first use. Media stays local. Without this, only audio and motion analysis runs.') +
        buttons([{ id: 'v-process', label: 'Find and export clips', primary: true }]))
    ]);
  },

  'screen-recorder': function (tool) {
    return inputPanel(tool, [
      group('Capture', select('v-source', 'What to record', [
        ['screen', 'Entire screen'], ['tab', 'Current tab'], ['window', 'Window']
      ]) + check('v-mic', 'Include microphone',
        'The browser will ask for separate microphone permission.')),
      group('Recording', buttons([
        { id: 'v-start', label: 'Start capture', primary: true },
        { id: 'v-pause', label: 'Pause' },
        { id: 'v-stop', label: 'Stop' }
      ]) + '<p class="hint">Choose what to share in the browser prompt. Stop sharing from the browser bar at any time.</p>'),
      group('Privacy', '<p class="hint">Frames and audio stay in memory until you download or reload. ' +
        'Mobile browsers often do not expose screen capture; the tool will say so clearly.</p>')
    ]);
  },

  'video-editor': function () { return ''; }
};

function workspaceFor(engine) {
  var builder = WORKSPACES[engine];
  if (!builder) return null;
  return builder({ name: NAMES[engine], engine: engine });
}

module.exports = {
  has: function (engine) { return Object.prototype.hasOwnProperty.call(WORKSPACES, engine); },
  workspaceFor: workspaceFor,
  vendorScripts: function () { return []; }
};
