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
  var text = (hint ? hint + ' ' : '') + 'Each input file is limited to 500 MB and stays on your device.';
  return field(label, '<input type="file" id="' + id + '" accept="' + accept + '">', text);
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
    visual = '<div style="width:100%;display:flex;flex-direction:column;gap:7px">' +
      '<p class="hint" id="v-source-meta">Load a file to see its real duration, channels and sample rate.</p>' +
      '<canvas id="v-waveform" class="video-canvas waveform" width="640" height="170" role="img" aria-label="Editable audio waveform preview"></canvas>' +
      '<p class="hint" id="v-metrics">Before/after levels appear here once you apply edits.</p>' +
      '<p class="hint" id="v-detected">Silence and repeated sections are detected from the decoded samples.</p>' +
      '<audio id="v-audio" controls playsinline hidden></audio>' +
      '<audio id="v-audio-original" controls playsinline hidden></audio>' +
      '</div>';
  } else if (tool.engine === 'subtitle-generator') {
    visual = '<label class="field" for="v-transcript">Editable timed transcript</label>' +
      '<textarea id="v-transcript" class="video-textarea" spellcheck="false" placeholder="Timed lines appear here as 00:00:01.200 --> 00:00:03.400 | text"></textarea>';
  } else if (tool.engine === 'video-to-shorts') {
    visual = '<div style="width:100%;display:flex;flex-direction:column;gap:7px">' +
      '<div id="v-source-info" hidden>' +
      '<strong id="v-source-name" style="display:block;overflow-wrap:anywhere;font-size:.84rem"></strong>' +
      '<span id="v-source-details" class="hint" style="display:block"></span>' +
      '<span id="v-source-time" class="hint" style="display:block">00:00.000 / 00:00.000</span>' +
      '<div class="output-actions">' +
      '<button class="btn btn-small" type="button" id="v-source-change">Change file</button>' +
      '<button class="btn btn-small" type="button" id="v-source-remove">Remove file</button>' +
      '</div></div>' +
      '<video id="v-source-video" class="video-player" controls playsinline hidden></video>' +
      '<div id="v-progress" style="width:100%;height:9px;border-radius:99px;background:#dbeafe;overflow:hidden" hidden>' +
      '<div id="v-progress-bar" style="height:100%;width:0;background:#2563eb;transition:width .2s ease"></div></div>' +
      '<div id="v-clips" class="clip-list"><p class="hint">Analyse a video to see real candidate clips here.</p></div>' +
      '</div>';
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
        'Decoded locally. WAV, MP3, M4A, OGG, MP4 and WebM usually work.') +
        buttons([
          { id: 'v-play-original', label: 'Play original' },
          { id: 'v-play', label: 'Play edited' },
          { id: 'v-stop', label: 'Stop' },
          { id: 'v-undo', label: 'Undo' },
          { id: 'v-redo', label: 'Redo' },
          { id: 'v-reset', label: 'Reset' }
        ])),
      group('Trim & zoom', range('v-start', 'Start', 0, 1000, 0, 1) +
        range('v-end', 'End', 0, 1000, 1000, 1) +
        range('v-zoom', 'Waveform zoom', 1, 16, 1, 1) +
        range('v-scroll', 'Waveform scroll', 0, 1000, 0, 1) +
        '<p class="hint">Drag on the waveform to set a cut point inside the zoomed view.</p>'),
      group('Level & dynamics', range('v-gain', 'Volume %', 0, 200, 100, 1) +
        check('v-normalize', 'Normalise peak', 'Measures the real peak and raises or lowers it to the target.') +
        range('v-loudness', 'Target peak %', 10, 100, 95, 1) +
        check('v-compress', 'Compress dynamics') +
        range('v-threshold', 'Threshold (dB)', -60, -6, -18, 1) +
        range('v-ratio', 'Ratio', 1, 12, 3, 0.5) +
        check('v-limiter', 'Soft limiter', 'Reduces remaining peaks with a tanh soft clip.')),
      group('Fades & order', range('v-fade-in', 'Fade in (ms)', 0, 3000, 0, 50) +
        range('v-fade-out', 'Fade out (ms)', 0, 3000, 0, 50) +
        check('v-reverse', 'Reverse audio')),
      group('EQ & pitch', range('v-bass', 'Bass', -100, 100, 0, 5) +
        range('v-treble', 'Treble', -100, 100, 0, 5) +
        range('v-presence', 'Presence (2–4 kHz)', -100, 100, 0, 5) +
        select('v-voice-effect', 'Audio effect', [
          ['none', 'None'], ['telephone', 'Telephone band-pass'], ['radio', 'Radio band-pass'],
          ['pitch-up', 'Pitch up (resample)'], ['pitch-down', 'Pitch down (resample)'],
          ['formant-bright', 'Bright filter'], ['formant-dark', 'Dark filter']
        ]) +
        range('v-pitch', 'Pitch (semitones)', -12, 12, 0, 1) +
        range('v-speed', 'Speed (resampling)', 25, 200, 100, 5) +
        '<p class="hint">Pitch and speed use linear resampling: duration and tone change together. ' +
        'Named effects are filter/pitch/formant-style audio effects, not voice or identity conversion.</p>'),
      group('Noise reduction', check('v-noise-reduction', 'Apply spectral filtering and gate') +
        select('v-noise-profile', 'Noise profile', [
          ['hiss', 'Hiss'], ['fan', 'Fan / rumble'], ['hum', 'Mains hum (50/60 Hz)'],
          ['static', 'Static'], ['traffic', 'Traffic rumble'], ['voice', 'Voice cleanup']
        ]) +
        range('v-noise-strength', 'Strength', 0, 100, 60, 5) +
        '<p class="hint">Uses high-pass, low-pass, notch and an estimated noise-floor gate. ' +
        'It can reduce steady noise but cannot recover words hidden by it. Compare with Play original.</p>'),
      group('Cleanup & enhancement', check('v-remove-silence', 'Remove detected silence') +
        range('v-silence-threshold', 'Silence threshold (dB)', -80, -20, -42, 1) +
        range('v-silence-min', 'Minimum silence (s)', 0.1, 3, 0.3, 0.1) +
        check('v-remove-repeats', 'Remove adjacent repeated sections') +
        check('v-voice-enhance', 'Voice enhancement',
          'High-pass, presence EQ, gentle compression and peak normalisation.')),
      group('Channels & music', check('v-mono', 'Mix down to mono') +
        range('v-balance', 'Stereo balance', -100, 100, 0, 5) +
        file('v-music-file', 'Background music track 1', 'audio/*', 'Decoded locally and mixed under the edited audio.') +
        range('v-music-gain', 'Music 1 level %', 0, 100, 20, 5) +
        file('v-music-file2', 'Background music track 2', 'audio/*', 'Optional second track, mixed with its own level.') +
        range('v-music-gain2', 'Music 2 level %', 0, 100, 0, 5) +
        range('v-music-start', 'Music start (s)', 0, 60, 0, 0.5)),
      group('Optional transcript', check('v-ai-consent', 'Download and run Whisper tiny locally',
        'First use downloads roughly 75-80 MB of model/runtime files. No media is uploaded; no paid API is used.') +
        select('v-language', 'Language', [
          ['auto', 'Detect automatically'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'],
          ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['hi', 'Hindi']
        ]) + buttons([
          { id: 'v-transcribe', label: 'Generate transcript' },
          { id: 'v-srt', label: 'SRT' }, { id: 'v-vtt', label: 'VTT' }, { id: 'v-txt', label: 'TXT' }
        ]) + '<textarea id="v-transcript" class="video-textarea" spellcheck="false" placeholder="Timed lines appear here as 00:00:01.200 --> 00:00:03.400 | text"></textarea>'),
      group('Export', select('v-format', 'Format', [
        ['mp3', 'MP3 (local LAME)'], ['wav', 'WAV (lossless)'], ['m4a', 'M4A / AAC (if supported)']
      ]) + buttons([{ id: 'v-process', label: 'Apply edits', primary: true }]) +
        '<p class="hint">Play edited and export use the same processed samples. Undo restores the previous state.</p>')
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
        'The real video plays on the right with its name, duration, resolution, size and current time. Change or remove it at any time.')),
      group('Clip review', numbered('v-clip-start', 'Start (seconds)', 0, 0, 86400, 0.1) +
        numbered('v-clip-end', 'End (seconds)', 30, 0.1, 86400, 0.1) +
        numbered('v-clip-duration', 'Duration (seconds)', 30, 0.2, 600, 0.1) +
        buttons([
          { id: 'v-clip-preview', label: 'Preview range' },
          { id: 'v-clip-add', label: 'Add clip' },
          { id: 'v-clip-auto', label: 'Find candidates' }
        ]) + '<p class="hint">Preview plays the chosen range from the source. Add as many clips as you need, then reorder or delete them below.</p>'),
      group('Manual layout', select('v-layout', 'Frame layout', [
        ['9:16', '9:16 vertical crop'], ['1:1', '1:1 square crop'], ['4:5', '4:5 portrait crop'],
        ['16:9', '16:9 landscape crop'], ['face', '9:16 subject-centred crop (opt-in model)'],
        ['speaker', '9:16 motion/audio-balance crop (not speaker recognition)'],
        ['split', '1:1 split view (same source)'], ['presenter', '1:1 presenter + inset (same source)'],
        ['blur', '9:16 blurred fill']
      ]) + range('v-crop-x', 'Crop left / right', 0, 100, 50, 1) +
        range('v-crop-y', 'Crop top / bottom', 0, 100, 50, 1) +
        range('v-crop-zoom', 'Crop zoom', 100, 300, 100, 5) +
        check('v-face-consent', 'Opt in to local face detection for subject crop',
          'Downloads a small MediaPipe face-detection model (roughly 200-250 KB) on first use from an official Google host. Falls back to the centre crop if no face is found. No media is uploaded.')),
      group('Captions', '<textarea id="v-caption" class="video-textarea" spellcheck="false" placeholder="00:00:00.500 --> 00:00:02.000 | Captions for the selected clip"></textarea>' +
        buttons([{ id: 'v-caption-apply', label: 'Apply to selected clip' }, { id: 'v-caption-download', label: 'Download clip SRT' }]) +
        '<p class="hint">Captions are written by you or, if you opt in, drafted from local Whisper output. Always review the text.</p>'),
      group('Analysis & export', check('v-ai-consent', 'Use Whisper to favour speech-heavy moments',
        'Downloads roughly 75-80 MB on first use. Media stays local. Without this, only audio and motion analysis runs. No paid API is used.') +
        select('v-count', 'Number of clips', [
          ['2', '2 clips'], ['1', '1 clip'], ['3', '3 clips'], ['4', '4 clips']
        ]) + select('v-length', 'Clip length', [
        ['30', '30 seconds'], ['15', '15 seconds'], ['45', '45 seconds'], ['60', '60 seconds']
      ]) + select('v-format', 'Export', [['mp4', 'MP4'], ['webm', 'WebM']]) +
        buttons([{ id: 'v-process', label: 'Generate all clips', primary: true }]))
    ]);
  },

  'screen-recorder': function (tool) {
    return inputPanel(tool, [
      group('Capture', select('v-source', 'Capture mode', [
        ['picker', 'Browser picker (tab, window or screen)'],
        ['tab', 'Prefer this tab (where supported)']
      ]) + check('v-mic', 'Include microphone',
        'The browser will ask for separate microphone permission.')),
      group('Recording', buttons([
        { id: 'v-start', label: 'Start capture', primary: true },
        { id: 'v-pause', label: 'Pause' },
        { id: 'v-stop', label: 'Stop' }
      ]) + '<p class="hint">The browser share prompt decides which surface is captured. The “prefer this tab” option is only a hint and is ignored where unsupported. Stop sharing from the browser bar at any time.</p>'),
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
