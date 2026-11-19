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
