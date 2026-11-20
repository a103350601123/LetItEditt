/* Headless checks for LetitEdit constants, migration and model helpers. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'js');
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Math, Date, JSON, Object, Array, Number, String, Boolean,
  Map, Set, Promise, RegExp, Error, TypeError,
  Uint8ClampedArray, Uint8Array, ArrayBuffer,
  encodeURIComponent, decodeURIComponent, isNaN, parseInt, parseFloat
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const context = vm.createContext(sandbox);

for (const file of ['constants.js', 'utils.js', 'model.js', 'renderer.js']) {
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  vm.runInContext(code, context, { filename: file });
}
const VE = sandbox.VE;

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log('ok   ' + name);
  } catch (err) {
    failures++;
    console.error('FAIL ' + name + '\n     ' + (err && err.message ? err.message : err));
  }
}

test('branding and project extension', () => {
  assert.strictEqual(VE.APP_NAME, 'LetitEdit Video Editor');
  assert.strictEqual(VE.APP_SHORT, 'LetitEdit');
  assert.strictEqual(VE.PROJECT_EXT, '.letitedit.json');
  assert.strictEqual(VE.MAX_TRACKS, 24);
});

test('catalog counts exceed the requested minimums', () => {
  assert.ok(VE.FONTS.length >= 40, 'fonts: ' + VE.FONTS.length);
  assert.ok(VE.ANIMATIONS.length >= 41, 'animations: ' + VE.ANIMATIONS.length);
  assert.ok(VE.EFFECTS.length - 1 >= 24, 'real effects: ' + (VE.EFFECTS.length - 1));
  assert.strictEqual(VE.LIB_CATEGORIES.length, 10);
  assert.strictEqual(VE.PROCEDURAL.length, 22);
  assert.strictEqual(new Set(VE.ANIMATIONS.map(a => a.id)).size, VE.ANIMATIONS.length);
  assert.strictEqual(new Set(VE.FONTS.map(f => f.id)).size, VE.FONTS.length);
  assert.strictEqual(new Set(VE.EFFECTS.map(e => e.id)).size, VE.EFFECTS.length);
});

test('all effects use a renderer-supported kind', () => {
  const allowed = new Set([
    'none', 'filter', 'grain', 'glitch', 'vhs', 'duotone', 'sharpen',
    'vignette', 'leak', 'motion', 'composite', 'scanlines', 'chromatic', 'pixelate'
  ]);
  VE.EFFECTS.forEach(e => assert.ok(allowed.has(e.kind), e.id + ': ' + e.kind));
});

test('animation evaluator produces distinct results', () => {
  const samples = [0.05, 0.3, 0.8, 1.6, 3.1];
  const signatures = new Set();
  for (const spec of VE.ANIMATIONS) {
    const clip = VE.baseClip('text', 'Sample');
    Object.assign(clip, {
      type: 'text',
      duration: 4,
      animationId: spec.id,
      animDuration: spec.duration,
      animSpeed: 1,
      animDelay: 0,
      animDirection: spec.direction
    });
    signatures.add(samples.map(t => JSON.stringify(VE.animationState(clip, t))).join('|'));
  }
  assert.ok(signatures.size >= 40, 'distinct animation states: ' + signatures.size);
});

test('legacy project is migrated and sanitised', () => {
  const legacy = {
    name: 'Old project',
    app: 'ClipForge',
    version: 1,
    aspect: '16:9',
    tracks: [{
      id: 'track_1',
      type: 'video',
      name: 'Video 1',
      clips: [
        {
          id: 'clip_1', type: 'text', name: 'Title', text: 'Hi',
          start: -3, duration: 0, opacity: 5, x: 9,
          animationId: 'no-such-animation',
          effects: [{ id: 'fake', amount: 1 }, { id: 'film', amount: 5 }],
          locked: 'yes', hidden: undefined
        },
        { id: 'clip_2', type: 'audio', name: 'Sound', start: 2, duration: 3 }
      ]
    }]
  };
  const clean = VE.sanitizeProject(legacy);
  assert.ok(clean);
  assert.strictEqual(clean.app, VE.APP_NAME);
  assert.strictEqual(clean.version, 2);
  assert.strictEqual(clean.tracks[0].clips.length, 2);
  const clip = clean.tracks[0].clips[0];
  assert.strictEqual(clip.start, 0);
  assert.ok(clip.duration >= 0.1);
  assert.strictEqual(clip.opacity, 1);
  assert.strictEqual(clip.x, 2);
  assert.strictEqual(clip.animationId, 'none');
  assert.strictEqual(clip.effects.length, 1, 'effects: ' + JSON.stringify(clip.effects));
  assert.strictEqual(clip.effects[0].id, 'film');
  assert.strictEqual(clip.effects[0].amount, 1);
  assert.strictEqual(clip.locked, true);
  assert.strictEqual(clip.hidden, false);
  assert.ok(!JSON.stringify(clean).includes('ClipForge'));
});

test('wrapped project payloads and track cap are handled', () => {
  const payload = {
    app: 'ClipForge',
    project: { name: 'Wrapped', tracks: [{ id: 't', type: 'overlay', clips: [] }] }
  };
  assert.strictEqual(VE.sanitizeProject(payload).name, 'Wrapped');
  const many = { tracks: [] };
  for (let i = 0; i < 30; i++) many.tracks.push({ id: 't' + i, type: 'overlay', clips: [] });
  assert.strictEqual(VE.sanitizeProject(many).tracks.length, VE.MAX_TRACKS);
  assert.strictEqual(VE.sanitizeProject({ nope: true }), null);
});

test('layer order helpers move clips across tracks', () => {
  const project = VE.createProject();
  const track = project.tracks[0];
  const a = VE.baseClip('text', 'A');
  const b = VE.baseClip('text', 'B');
  track.clips.push(a, b);
  assert.strictEqual(VE.layerInfo(project, b.id).z, 2);
  assert.strictEqual(VE.layerInfo(project, a.id).z, 1);
  assert.strictEqual(VE.moveLayer(project, b.id, -1), true);
  assert.strictEqual(track.clips[0].id, b.id);
  assert.strictEqual(VE.moveLayer(project, b.id, -1), false);
  assert.strictEqual(VE.moveLayer(project, b.id, 1), true);
  assert.strictEqual(track.clips[1].id, b.id);
});

test('every procedural library item creates a renderable shape clip', () => {
  VE.PROCEDURAL.forEach(item => {
    const clip = VE.createShapeClip(item.id, { start: 1.5 });
    assert.strictEqual(clip.type, 'shape');
    assert.strictEqual(clip.shape, item.shape);
    assert.strictEqual(clip.name, item.label);
    assert.strictEqual(clip.assetId, null);
    assert.strictEqual(clip.start, 1.5);
  });
});

if (failures) {
  console.error('\n' + failures + ' check(s) failed.');
  process.exitCode = 1;
} else {
  console.log('\nAll LetitEdit self-checks passed.');
}
