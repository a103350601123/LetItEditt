import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = fs.readFileSync(path.join(root, 'js/video-core.js'), 'utf8');

class FakeAudioBuffer {
  constructor(lengthOrOptions, channels, sampleRate) {
    const options = typeof lengthOrOptions === 'object' && lengthOrOptions !== null
      ? lengthOrOptions
      : { length: lengthOrOptions, numberOfChannels: channels, sampleRate: sampleRate };
    this.length = options.length;
    this.numberOfChannels = options.numberOfChannels;
    this.sampleRate = options.sampleRate;
    this.duration = this.length / this.sampleRate;
    this._data = Array.from({ length: this.numberOfChannels }, () => new Float32Array(this.length));
  }

  getChannelData(channel) { return this._data[channel]; }
}

let V;

beforeAll(() => {
  globalThis.AudioBuffer = FakeAudioBuffer;
  globalThis.document = { baseURI: 'http://localhost/', currentScript: null, getElementById: () => null };
  new Function(source)();
  V = globalThis.VideoCore;
  expect(V).toBeTruthy();
});

describe('video core formatting and validation helpers', () => {
  it('formats media times and byte sizes', () => {
    expect(V.formatTime(0)).toBe('00:00.000');
    expect(V.formatTime(62.3456)).toBe('01:02.345');
    expect(V.formatTime(3661.5)).toBe('1:01:01.500');
    expect(V.formatTime(NaN)).toBe('00:00.000');
    expect(V.formatBytes(0)).toBe('0 B');
    expect(V.formatBytes(54912)).toBe('53.6 KB');
  });

  it('rejects empty, missing and oversized files with useful messages', () => {
    expect(() => V.validateFile(null)).toThrow('Choose a file first.');
    expect(() => V.validateFile({ size: 0 })).toThrow('empty');
    expect(() => V.validateFile({ size: 200 }, 100)).toThrow('larger than 100 B');
    expect(V.validateFile({ size: 50 }, 100)).toBe(true);
  });

  it('normalises abort and other errors', () => {
    const abort = V.abortError();
    expect(abort.name).toBe('AbortError');
    expect(V.friendlyError(abort)).toBe('Cancelled.');
    expect(V.friendlyError(new Error('boom'))).toBe('boom');
    expect(() => V.checkSignal({ aborted: true })).toThrow('Cancelled.');
    expect(() => V.checkSignal({ aborted: false })).not.toThrow();
  });
});

describe('audio editing', () => {
  it('trims, gains, fades and reverses real sample arrays', () => {
    const buffer = new FakeAudioBuffer(1000, 1, 1000);
    for (let i = 0; i < 1000; i++) buffer.getChannelData(0)[i] = i < 500 ? 0.5 : -0.25;
    const edited = V.editAudio(buffer, {
      start: 0.1, end: 0.4, gain: 100, fadeIn: 0, fadeOut: 0, reverse: false
    });
    expect(edited.length).toBe(300);
    expect(edited.getChannelData(0)[0]).toBeCloseTo(0.5, 5);
    expect(edited.getChannelData(0)[299]).toBeCloseTo(0.5, 5);

    const reversed = V.editAudio(buffer, {
      start: 0.4, end: 0.8, gain: 100, fadeIn: 0, fadeOut: 0, reverse: true
    });
    expect(reversed.getChannelData(0)[0]).toBeCloseTo(-0.25, 5);
    expect(reversed.getChannelData(0)[399]).toBeCloseTo(0.5, 5);

    const faded = V.editAudio(buffer, {
      start: 0, end: 1, gain: 100, fadeIn: 200, fadeOut: 200, reverse: false
    });
    expect(faded.getChannelData(0)[0]).toBe(0);
    expect(faded.getChannelData(0)[999]).toBeCloseTo(0, 2);
    expect(faded.getChannelData(0)[500]).toBeCloseTo(-0.25, 5);
  });

  it('writes a valid 16-bit PCM WAV header and interleaved samples', async () => {
    const buffer = new FakeAudioBuffer(2, 2, 8000);
    buffer.getChannelData(0).set([1, -1]);
    buffer.getChannelData(1).set([0.5, -0.5]);
    const blob = V.writeWav(buffer);
    expect(blob.type).toBe('audio/wav');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = offset => String.fromCharCode(...bytes.slice(offset, offset + 4));
    expect(text(0)).toBe('RIFF');
    expect(text(8)).toBe('WAVE');
    expect(text(12)).toBe('fmt ');
    expect(text(36)).toBe('data');
    expect(new DataView(bytes.buffer).getUint16(22, true)).toBe(2);
    expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(8000);
    expect(new DataView(bytes.buffer).getUint32(40, true)).toBe(8);
    expect(bytes.slice(44, 52)).toEqual(new Uint8Array([255, 127, 255, 63, 0, 128, 0, 192]));
  });
});

describe('subtitle helpers', () => {
  it('parses and formats SRT, VTT and plain text from editable lines', () => {
    const text = '00:00:01.200 --> 00:00:03.400 | Hello | world\n00:00:04.000 --> 00:00:05.500 | Next line';
    const lines = V.parseTimedTranscript(text);
    expect(lines).toEqual([
      { start: 1.2, end: 3.4, text: 'Hello | world' },
      { start: 4, end: 5.5, text: 'Next line' }
    ]);
    expect(V.formatTranscript(lines, 'srt')).toContain('1\n00:00:01,200 --> 00:00:03,400\nHello | world');
    expect(V.formatTranscript(lines, 'vtt')).toContain('WEBVTT\n\n1\n00:00:01.200 --> 00:00:03.400');
    expect(V.formatTranscript(lines, 'txt')).toBe('Hello | world\nNext line');
    expect(V.parseTimedTranscript('no timing here')).toEqual([]);
  });

  it('groups word-level transcript chunks into readable timed lines', () => {
    const chunks = [
      { text: 'Hello', timestamp: [0, 0.2] },
      { text: 'there,', timestamp: [0.2, 0.4] },
      { text: 'friend', timestamp: [0.4, 0.7] },
      { text: '', timestamp: [0.7, 0.8] }
    ];
    expect(V.chunkLines(chunks)).toEqual([{ start: 0, end: 0.7, text: 'Hello there, friend' }]);
  });
});

describe('highlight analysis', () => {
  it('normalises series and ranks overlapping windows without duplicates', () => {
    expect(V.normalise([0, 1, 2, 1])).toEqual([0, 0.5, 1, 0.5]);
    const energies = [0.1, 1, 0.2, 0.9, 0.1, 0.8, 0.2, 0.1, 0.3, 0.2];
    const windows = V.findHighlights({
      audioSeries: energies.map((energy, time) => ({ time, energy })),
      audioStep: 1,
      motion: energies.map(energy => energy * 0.5),
      motionStep: 1,
      transcript: [{ start: 1, end: 2, text: 'Speech' }],
      useAI: true,
      duration: 10,
      length: 5,
      count: 2
    });
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.every(window => window.end - window.start === 5)).toBe(true);
    expect(windows.every(window => window.start >= 0 && window.end <= 10)).toBe(true);
  });

  it('computes RMS energy windows from an audio buffer', () => {
    const buffer = new FakeAudioBuffer(2000, 1, 1000);
    for (let i = 0; i < 2000; i++) buffer.getChannelData(0)[i] = i < 1000 ? 0.5 : 0;
    const series = V.seriesFromAudio(buffer, 0.5);
    expect(series.length).toBe(4);
    expect(series[0].energy).toBeCloseTo(0.5, 5);
    expect(series[3].energy).toBe(0);
  });
});

describe('local DSP helpers', () => {
  it('slices, joins and splits buffers without mutating the source', () => {
    const buffer = new FakeAudioBuffer(1000, 1, 1000);
    for (let i = 0; i < 1000; i++) buffer.getChannelData(0)[i] = i / 1000;
    const parts = V.splitBuffer(buffer, 0.4);
    expect(parts[0].length).toBe(400);
    expect(parts[1].length).toBe(600);
    const joined = V.concatBuffers(parts);
    expect(joined.length).toBe(1000);
    expect(joined.getChannelData(0)[999]).toBeCloseTo(0.999, 3);
    expect(buffer.getChannelData(0)[0]).toBe(0);
    expect(() => V.concatBuffers([])).toThrow('no audio buffers');
  });

  it('measures peaks and normalises only when asked', () => {
    const buffer = new FakeAudioBuffer(1000, 1, 1000);
    buffer.getChannelData(0).fill(0.25);
    const metrics = V.audioMetrics(buffer);
    expect(metrics.peak).toBeCloseTo(0.25, 5);
    expect(metrics.rms).toBeCloseTo(0.25, 5);

    const normalised = V.normaliseBuffer(buffer, 0.8);
    expect(V.audioMetrics(normalised).peak).toBeCloseTo(0.8, 5);

    const untouched = V.editAudio(buffer, {
      start: 0, end: 1, gain: 100, normalize: false, normalizeTarget: 0.95, loudness: 95
    });
    expect(V.audioMetrics(untouched).peak).toBeCloseTo(0.25, 5);
  });

  it('compresses, limits and applies real EQ to samples', () => {
    const loud = new FakeAudioBuffer(2000, 1, 8000);
    loud.getChannelData(0).fill(0.9);
    expect(V.audioMetrics(V.compressorBuffer(loud, { threshold: -18, ratio: 6 })).peak)
      .toBeLessThan(0.9);
    expect(V.audioMetrics(V.limiterBuffer(loud, 0.97)).peak).toBeLessThan(0.97);

    const lowTone = new FakeAudioBuffer(2000, 1, 16000);
    for (let i = 0; i < 2000; i++) lowTone.getChannelData(0)[i] = Math.sin(2 * Math.PI * 100 * i / 16000) * 0.5;
    expect(V.audioMetrics(V.toneBuffer(lowTone, { bass: 100 })).peak)
      .toBeGreaterThan(V.audioMetrics(lowTone).peak);
  });

  it('changes duration and pitch through honest linear resampling', () => {
    const buffer = new FakeAudioBuffer(1000, 1, 1000);
    buffer.getChannelData(0).fill(0.4);
    const faster = V.resampleSpeed(buffer, { speed: 2, pitch: 0 });
    expect(faster.length).toBe(500);
    const higher = V.resampleSpeed(buffer, { speed: 1, pitch: 12 });
    expect(higher.length).toBe(500);
    expect(buffer.length).toBe(1000);
  });

  it('detects and removes silence and adjacent repeats from decoded samples', () => {
    const buffer = new FakeAudioBuffer(2000, 1, 1000);
    for (let i = 1000; i < 2000; i++) buffer.getChannelData(0)[i] = 0.5;
    const silence = V.detectSilence(buffer, { threshold: -42, minDuration: 0.3 });
    expect(silence.length).toBe(1);
    expect(silence[0].start).toBeCloseTo(0, 2);
    expect(silence[0].end).toBeCloseTo(1, 2);
    expect(V.removeRanges(buffer, silence).length).toBe(1000);

    const repeated = new FakeAudioBuffer(2000, 1, 1000);
    for (let i = 0; i < 1200; i++) repeated.getChannelData(0)[i] = 0.5;
    const repeats = V.detectRepeats(repeated, { minDuration: 0.6, tolerance: 0.12 });
    expect(repeats.length).toBe(1);
    expect(repeats[0].end - repeats[0].start).toBeGreaterThanOrEqual(0.6);
  });

  it('applies filtering, voice effects, stereo changes and music mixing', () => {
    const noise = new FakeAudioBuffer(8000, 1, 8000);
    for (let i = 0; i < 8000; i++) noise.getChannelData(0)[i] = i % 2 ? 0.08 : -0.08;
    const reduced = V.noiseReduceBuffer(noise, { profile: 'hiss', strength: 100 });
    expect(V.audioMetrics(reduced).peak).toBeLessThan(V.audioMetrics(noise).peak);

    const tone = new FakeAudioBuffer(1000, 1, 8000);
    tone.getChannelData(0).fill(0.4);
    expect(V.audioMetrics(V.voiceEffectBuffer(tone, 'telephone')).peak).not.toBeCloseTo(0.4, 2);

    const stereo = new FakeAudioBuffer(1000, 2, 1000);
    stereo.getChannelData(0).fill(0.6);
    stereo.getChannelData(1).fill(0.2);
    expect(V.stereoBuffer(stereo, { mono: true }).numberOfChannels).toBe(1);
    expect(V.stereoBuffer(stereo, { mono: true }).getChannelData(0)[0]).toBeCloseTo(0.4, 5);
    const balanced = V.stereoBuffer(stereo, { balance: -100 });
    expect(balanced.getChannelData(0)[0]).toBeCloseTo(1, 5);
    expect(balanced.getChannelData(1)[0]).toBe(0);

    const music = new FakeAudioBuffer(50, 1, 1000);
    music.getChannelData(0).fill(0.2);
    const mixed = V.mixAudio(tone, [{ buffer: music, gain: 0.5, start: 0 }]);
    expect(mixed.getChannelData(0)[0]).toBeCloseTo(0.5, 5);
    expect(mixed.getChannelData(0)[99]).toBeCloseTo(0.4, 5);
  });

  it('samples peaks and computes crop and stereo focus hints', () => {
    const stereo = new FakeAudioBuffer(100, 2, 1000);
    stereo.getChannelData(0).fill(0.5);
    stereo.getChannelData(1).fill(-0.25);
    const peaks = V.samplePeaks(stereo, 4, 0, 1);
    expect(peaks).toHaveLength(4);
    expect(peaks[0].max).toBeCloseTo(0.5, 5);
    expect(peaks[0].min).toBeCloseTo(-0.25, 5);

    expect(V.layoutDimensions('1:1')).toMatchObject({ width: 1080, height: 1080 });
    expect(V.layoutDimensions('unknown')).toMatchObject({ width: 720, height: 1280 });
    const crop = V.cropRect(1920, 1080, 720, 1280, 1, 0.5, 2);
    expect(crop.width).toBeCloseTo(303.75, 2);
    expect(crop.height).toBeCloseTo(540, 2);
    expect(crop.x).toBeCloseTo(1920 - 303.75, 2);
    expect(crop.y).toBe(270);

    expect(V.audioFocus(stereo, 0, 0.1)).toBeCloseTo(0.8, 5);
    const rightOnly = new FakeAudioBuffer(100, 2, 1000);
    rightOnly.getChannelData(1).fill(0.5);
    expect(V.audioFocus(rightOnly, 0, 0.1)).toBe(0);
    expect(typeof V.layoutProcessor({ layout: '9:16' })).toBe('function');
  });
});

describe('segmentation and cancellation helpers', () => {
  function withFakeCanvas(run) {
    const previous = globalThis.document;
    const canvases = [];
    globalThis.document = {
      createElement() {
        const canvas = { width: 0, height: 0, pixels: null };
        canvas.getContext = () => ({
          createImageData(width, height) {
            const image = { data: new Uint8ClampedArray(width * height * 4) };
            canvas.pixels = image;
            return image;
          },
          putImageData() {},
          drawImage() {}
        });
        canvases.push(canvas);
        return canvas;
      }
    };
    try { return run(canvases); } finally { globalThis.document = previous; }
  }

  it('reads the person confidence mask and falls back to category indices', () => {
    const result = {
      categoryMask: { getAsUint8Array: () => new Uint8Array([1, 0]) },
      confidenceMasks: [
        { getAsFloat32Array: () => new Float32Array([0.8, 0.2]) },
        { getAsFloat32Array: () => new Float32Array([0.2, 0.8]) }
      ]
    };
    expect(Array.from(V.segmentationMaskFromResult(result, 1, 2))).toEqual([51, 204]);

    const categoryOnly = { categoryMask: { getAsUint8Array: () => new Uint8Array([0, 1]) } };
    expect(Array.from(V.segmentationMaskFromResult(categoryOnly, 1, 2))).toEqual([0, 1]);
    expect(V.segmentationMaskFromResult({}, 1, 2)).toBeNull();
  });

  it('builds a mask from 0/1 categories or 0-255 confidence bytes', () => {
    withFakeCanvas(canvases => {
      const category = V.maskFromCategories(new Uint8Array([0, 1, 1, 0]), 2, 2, 70, 0);
      expect(category.width).toBe(2);
      expect(Array.from([3, 7, 11, 15]).map(index => category.pixels.data[index]))
        .toEqual([0, 255, 255, 0]);

      const confidence = V.maskFromCategories(new Uint8Array([10, 200, 180, 20]), 2, 2, 70, 0);
      expect(Array.from([3, 7, 11, 15]).map(index => confidence.pixels.data[index]))
        .toEqual([0, 255, 255, 0]);
      expect(canvases).toHaveLength(2);
    });
  });

  it('honours an aborted signal before and during transcription', async () => {
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(V.transcribe(new Float32Array(1), { signal: preAborted.signal }))
      .rejects.toThrow('Cancelled.');

    const previousWorker = globalThis.Worker;
    let terminated = false;
    globalThis.Worker = class {
      constructor() { this.onmessage = null; this.onerror = null; }
      postMessage() {}
      terminate() { terminated = true; }
    };
    const controller = new AbortController();
    try {
      const pending = V.transcribe(new Float32Array(1), { signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toThrow('Cancelled.');
      expect(terminated).toBe(true);
    } finally {
      globalThis.Worker = previousWorker;
    }
  });
});
