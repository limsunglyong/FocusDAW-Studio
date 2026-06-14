#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const INPUT_DIR = path.join(__dirname, 'input');
const OUT_DIR = path.join(__dirname, 'out');
const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const DURATION_SEC = 12;
const RATIOS = [0.75, 0.9, 1.1, 1.25];
const INPUT_EXT_RE = /\.(wav|mp3|m4a|aac|ogg|flac|aiff?|opus)$/i;

const CANDIDATES = [
  {
    id: 'ffmpeg-atempo',
    label: 'ffmpeg atempo',
    process: processWithFfmpegAtempo,
  },
];

const SAMPLES = [
  { id: 'drums', label: 'Drums / transients', render: renderDrums },
  { id: 'lead', label: 'Lead / pitched', render: renderLead },
  { id: 'fullmix', label: 'Full mix', render: renderFullMix },
];

main();

function main() {
  fs.mkdirSync(INPUT_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ffmpegPath = resolveFfmpegPath();
  const report = [];
  const samples = [...SAMPLES, ...loadInputSamples()];

  console.log('FocusDAW time-stretch benchmark');
  console.log(`Input:  ${INPUT_DIR}`);
  console.log(`Output: ${OUT_DIR}`);
  if (samples.length === SAMPLES.length) {
    console.log('No external input WAV files found; using built-in synthetic samples only.');
  }
  console.log('');

  for (const sample of samples) {
    const prepared = prepareSample(sample, ffmpegPath);
    const buffer = prepared.buffer;
    const inputPath = prepared.inputPath;
    const inputStats = analyzePcm(buffer);

    for (const ratio of RATIOS) {
      for (const candidate of CANDIDATES) {
        const outputPath = path.join(OUT_DIR, `${sample.id}_${candidate.id}_${ratioLabel(ratio)}.wav`);
        const started = Date.now();
        candidate.process({ ffmpegPath, inputPath, outputPath, ratio });
        const elapsedMs = Date.now() - started;
        const output = readWav16(outputPath);
        const stats = analyzePcm(output.samples);
        const expectedDuration = inputStats.durationSec / ratio;
        const durationErrorMs = (stats.durationSec - expectedDuration) * 1000;
        const row = {
          sample: sample.id,
          candidate: candidate.id,
          ratio,
          expectedDuration,
          actualDuration: stats.durationSec,
          durationErrorMs,
          peak: stats.peak,
          rms: stats.rms,
          rmsDeltaDb: db(stats.rms / Math.max(1e-9, inputStats.rms)),
          elapsedMs,
          output: path.relative(ROOT, outputPath),
        };
        report.push(row);
        console.log([
          sample.id.padEnd(7),
          candidate.id.padEnd(14),
          ratio.toFixed(2).padStart(4),
          `${stats.durationSec.toFixed(3)}s`.padStart(8),
          `${durationErrorMs.toFixed(1)}ms`.padStart(10),
          `${row.rmsDeltaDb.toFixed(2)}dB`.padStart(9),
          `${elapsedMs}ms`.padStart(8),
        ].join('  '));
      }
    }
  }

  writeReport(report);
  console.log('');
  console.log(`Wrote ${path.relative(ROOT, path.join(OUT_DIR, 'report.md'))}`);
}

function resolveFfmpegPath() {
  let ffmpegPath = null;
  try {
    ffmpegPath = require('ffmpeg-static');
  } catch (error) {
    throw new Error('ffmpeg-static is not installed. Run npm install first.');
  }
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    throw new Error(`ffmpeg executable not found: ${ffmpegPath}`);
  }
  return ffmpegPath;
}

function loadInputSamples() {
  if (!fs.existsSync(INPUT_DIR)) return [];
  const files = fs.readdirSync(INPUT_DIR)
    .filter(name => INPUT_EXT_RE.test(name))
    .sort((a, b) => a.localeCompare(b));
  return files.map((name) => {
    const id = `input-${safeId(path.basename(name, path.extname(name)))}`;
    return {
      id,
      label: `Input / ${name}`,
      inputFile: path.join(INPUT_DIR, name),
    };
  });
}

function prepareSample(sample, ffmpegPath) {
  if (sample.inputFile) {
    const inputPath = path.join(OUT_DIR, `${sample.id}_source.wav`);
    decodeInputToWav(ffmpegPath, sample.inputFile, inputPath);
    const wav = readWav16(inputPath);
    const buffer = normalizeChannels(wav.samples, CHANNELS);
    return { buffer, inputPath };
  }
  const buffer = sample.render(SAMPLE_RATE, DURATION_SEC);
  const inputPath = path.join(OUT_DIR, `${sample.id}_source.wav`);
  writeWav16(inputPath, buffer, SAMPLE_RATE, CHANNELS);
  return { buffer, inputPath };
}

function decodeInputToWav(ffmpegPath, inputFile, outputPath) {
  const args = [
    '-y',
    '-i', inputFile,
    '-ac', String(CHANNELS),
    '-ar', String(SAMPLE_RATE),
    '-sample_fmt', 's16',
    outputPath,
  ];
  const result = spawnSync(ffmpegPath, args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    throw new Error(`Failed to decode input ${inputFile}: ${stderr.slice(-2000)}`);
  }
}

function processWithFfmpegAtempo({ ffmpegPath, inputPath, outputPath, ratio }) {
  const filter = buildAtempoFilter(ratio);
  const args = ['-y', '-i', inputPath, '-filter:a', filter, '-ar', String(SAMPLE_RATE), outputPath];
  const result = spawnSync(ffmpegPath, args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    throw new Error(`ffmpeg atempo failed (${ratio}): ${stderr.slice(-2000)}`);
  }
}

function buildAtempoFilter(rate) {
  let r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) throw new Error(`Invalid ratio: ${rate}`);
  const parts = [];
  while (r < 0.5) { parts.push(0.5); r /= 0.5; }
  while (r > 2.0) { parts.push(2.0); r /= 2.0; }
  parts.push(Math.max(0.5, Math.min(2.0, r)));
  return parts.map(v => `atempo=${trimFloat(v)}`).join(',');
}

function writeReport(rows) {
  const lines = [
    '# Time Stretch Benchmark Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| Sample | Candidate | Ratio | Expected | Actual | Duration error | RMS delta | Peak | Time | Output |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---|',
  ];
  for (const r of rows) {
    lines.push([
      `| ${r.sample}`,
      r.candidate,
      r.ratio.toFixed(2),
      `${r.expectedDuration.toFixed(3)}s`,
      `${r.actualDuration.toFixed(3)}s`,
      `${r.durationErrorMs.toFixed(1)}ms`,
      `${r.rmsDeltaDb.toFixed(2)}dB`,
      r.peak.toFixed(4),
      `${r.elapsedMs}ms`,
      r.output,
    ].join(' | ') + ' |');
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- This is an objective smoke benchmark, not a listening test.');
  lines.push('- Add future candidates next to `ffmpeg-atempo` and compare the generated WAV files by ear.');
  lines.push('- The current baseline matches the Electron Export Keep pitch path conceptually, but excludes LUFS loudnorm and app mix automation.');
  fs.writeFileSync(path.join(OUT_DIR, 'report.md'), lines.join('\n'), 'utf8');
}

function renderDrums(sr, seconds) {
  const frames = Math.floor(sr * seconds);
  const mono = new Float32Array(frames);
  for (let t = 0; t < seconds; t += 0.5) addHat(mono, sr, t);
  for (let t = 0; t < seconds; t += 1.0) addKick(mono, sr, t);
  for (let t = 0.5; t < seconds; t += 1.0) addSnare(mono, sr, t);
  return stereoFromMono(mono);
}

function renderLead(sr, seconds) {
  const frames = Math.floor(sr * seconds);
  const mono = new Float32Array(frames);
  const notes = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63];
  let idx = 0;
  for (let t = 0; t < seconds; t += 0.5) {
    addTone(mono, sr, t, 0.44, notes[idx % notes.length], 0.45);
    idx++;
  }
  return stereoFromMono(mono);
}

function renderFullMix(sr, seconds) {
  const drums = renderDrums(sr, seconds);
  const lead = renderLead(sr, seconds);
  const frames = drums[0].length;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const bassNotes = [65.41, 87.31, 98.0, 82.41];
  const bass = new Float32Array(frames);
  for (let t = 0, i = 0; t < seconds; t += 1.0, i++) {
    addTone(bass, sr, t, 0.9, bassNotes[i % bassNotes.length], 0.4);
  }
  for (let i = 0; i < frames; i++) {
    left[i] = softClip(drums[0][i] * 0.75 + lead[0][i] * 0.55 + bass[i] * 0.7);
    right[i] = softClip(drums[1][i] * 0.75 + lead[1][i] * 0.55 + bass[i] * 0.7);
  }
  return [left, right];
}

function addKick(dst, sr, startSec) {
  const start = Math.floor(startSec * sr);
  const len = Math.floor(0.35 * sr);
  for (let i = 0; i < len && start + i < dst.length; i++) {
    const t = i / sr;
    const freq = 130 * Math.exp(-t * 24) + 42;
    dst[start + i] += Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 9) * 0.95;
  }
}

function addSnare(dst, sr, startSec) {
  const start = Math.floor(startSec * sr);
  const len = Math.floor(0.18 * sr);
  let seed = 12345 + start;
  for (let i = 0; i < len && start + i < dst.length; i++) {
    const t = i / sr;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = ((seed / 0xffffffff) * 2 - 1) * 0.7;
    const tone = Math.sin(2 * Math.PI * 180 * t) * 0.3;
    dst[start + i] += (noise + tone) * Math.exp(-t * 24) * 0.65;
  }
}

function addHat(dst, sr, startSec) {
  const start = Math.floor(startSec * sr);
  const len = Math.floor(0.05 * sr);
  let seed = 98765 + start;
  for (let i = 0; i < len && start + i < dst.length; i++) {
    const t = i / sr;
    seed = (seed * 1103515245 + 12345) >>> 0;
    const noise = (seed / 0xffffffff) * 2 - 1;
    dst[start + i] += noise * Math.exp(-t * 95) * 0.22;
  }
}

function addTone(dst, sr, startSec, durSec, freq, amp) {
  const start = Math.floor(startSec * sr);
  const len = Math.floor(durSec * sr);
  for (let i = 0; i < len && start + i < dst.length; i++) {
    const t = i / sr;
    const x = i / Math.max(1, len - 1);
    const env = Math.min(1, x / 0.04) * Math.min(1, (1 - x) / 0.08);
    const value = (
      Math.sin(2 * Math.PI * freq * t) +
      Math.sin(2 * Math.PI * freq * 2 * t) * 0.25 +
      Math.sin(2 * Math.PI * freq * 3 * t) * 0.12
    ) * amp * env;
    dst[start + i] += value;
  }
}

function stereoFromMono(mono) {
  const left = new Float32Array(mono.length);
  const right = new Float32Array(mono.length);
  for (let i = 0; i < mono.length; i++) {
    left[i] = softClip(mono[i] * 0.95);
    right[i] = softClip(mono[i] * 0.88);
  }
  return [left, right];
}

function softClip(x) {
  return Math.tanh(x * 1.05);
}

function writeWav16(filePath, channels, sampleRate, numChannels) {
  const frames = channels[0].length;
  const bytesPerSample = 2;
  const dataSize = frames * numChannels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i] || 0));
      buffer.writeInt16LE(Math.round(v * 32767), offset);
      offset += 2;
    }
  }
  fs.writeFileSync(filePath, buffer);
}

function readWav16(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Not a WAV file: ${filePath}`);
  }
  let pos = 12;
  let fmt = null;
  let dataStart = -1;
  let dataSize = 0;
  while (pos + 8 <= buffer.length) {
    const id = buffer.toString('ascii', pos, pos + 4);
    const size = buffer.readUInt32LE(pos + 4);
    const start = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    } else if (id === 'data') {
      dataStart = start;
      dataSize = size;
      break;
    }
    pos = start + size + (size % 2);
  }
  if (!fmt || dataStart < 0) throw new Error(`Invalid WAV chunks: ${filePath}`);
  if (fmt.format !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error(`Only PCM16 WAV is supported in this benchmark: ${filePath}`);
  }
  const frames = Math.floor(dataSize / (fmt.channels * 2));
  const samples = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  let offset = dataStart;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      samples[c][i] = buffer.readInt16LE(offset) / 32768;
      offset += 2;
    }
  }
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, samples };
}

function analyzePcm(channels) {
  const frames = channels[0].length;
  let peak = 0;
  let sumSq = 0;
  let count = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      peak = Math.max(peak, Math.abs(v));
      sumSq += v * v;
      count++;
    }
  }
  return {
    durationSec: frames / SAMPLE_RATE,
    peak,
    rms: Math.sqrt(sumSq / Math.max(1, count)),
  };
}

function normalizeChannels(samples, targetChannels) {
  if (samples.length === targetChannels) return samples;
  if (targetChannels === 2 && samples.length === 1) {
    return [samples[0], new Float32Array(samples[0])];
  }
  if (targetChannels === 1 && samples.length > 1) {
    const frames = samples[0].length;
    const mono = new Float32Array(frames);
    for (const ch of samples) {
      for (let i = 0; i < frames; i++) mono[i] += ch[i] / samples.length;
    }
    return [mono];
  }
  return samples.slice(0, targetChannels);
}

function db(value) {
  return 20 * Math.log10(Math.max(1e-9, value));
}

function ratioLabel(ratio) {
  return trimFloat(ratio).replace('.', 'p') + 'x';
}

function trimFloat(value) {
  return Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function safeId(value) {
  return String(value || 'sample')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sample';
}
