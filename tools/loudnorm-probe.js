/**
 * loudnorm-probe — measure what Export's loudness normalization actually does.
 *
 * Runs the REAL chain from electron/main.js (processAudioFfmpeg, extracted with its helpers)
 * so the numbers describe the shipping code, and reports per target:
 *   achieved LUFS · achieved true peak · miss vs target · gain swing
 *
 * "gain swing" is the 5th–95th percentile spread of the per-10ms RMS ratio
 * (processed / source), in dB. A static gain gives ~0. The bigger it is, the more the
 * processor is MOVING the gain around — which is what pumps and distorts transients.
 *
 * History: before v1.41.0 the chain asked loudnorm for `linear=true`, but loudnorm honours
 * that only while the required gain is negative; any positive gain fell back to Dynamic mode.
 * Measured on the synthetic signal below, at I=-9 that meant a 16.9 dB gain swing and the
 * target still missed by 3.75 dB (user report: drums distort at -9 LUFS). v1.41.0 makes
 * getting louder go through a look-ahead limiter instead: 5.7 dB swing, target missed by 0.74.
 *
 * Usage:
 *   node tools/loudnorm-probe.js                # synthetic kick + bed signal
 *   node tools/loudnorm-probe.js path/to.wav    # your own mix (most useful)
 */
'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');

const TARGETS = [-23, -16, -14, -12, -9];
const TP = -1, LRA = 11, SR = 44100;

// ---- load the shipping chain ------------------------------------------------
const mainPath = path.join(__dirname, '..', 'electron', 'main.js');
const src = fs.readFileSync(mainPath, 'utf8');
function extractFn(name) {
  let st = src.indexOf('function ' + name + '(');
  if (st < 0) throw new Error('not found in electron/main.js: ' + name);
  if (src.slice(Math.max(0, st - 6), st) === 'async ') st -= 6;   // keep `async`
  let p = src.indexOf('(', st), pd = 0;
  for (; p < src.length; p++) {
    if (src[p] === '(') pd++;
    else if (src[p] === ')') { pd--; if (pd === 0) { p++; break; } }
  }
  let d = 0;
  for (p = src.indexOf('{', p); p < src.length; p++) {
    if (src[p] === '{') d++;
    else if (src[p] === '}') { d--; if (d === 0) return src.slice(st, p + 1); }
  }
}
function extractConst(name) {
  const m = src.match(new RegExp('^const ' + name + ' = .*?;$', 'm'));
  if (!m) throw new Error('const not found in electron/main.js: ' + name);
  return m[0];
}
const mod = { exports: {} };
new Function('require', 'console', 'Buffer', 'fs', 'os', 'path', 'spawn', 'resolveFfmpegPath', 'module', 'process',
  [extractConst('LIMITER_ATTACK_MS'), extractConst('LIMITER_RELEASE_MS'), extractConst('LIMITER_ISP_HEADROOM_DB'),
   extractFn('buildAtempoFilter'), extractFn('parseLoudnormJson'), extractFn('buildLoudnormFilter'),
   extractFn('runFfmpeg'), extractFn('processAudioFfmpeg'),
   'module.exports = { processAudioFfmpeg };'].join('\n\n')
)(require, console, Buffer, fs, os, path, spawn, () => ffmpegPath, mod, process);
const { processAudioFfmpeg } = mod.exports;

// ---- measurement ------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'focusdaw-loudnorm-'));
const cap = a => (spawnSync(ffmpegPath, a, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }).stderr || Buffer.alloc(0)).toString('utf8');

function measure(file) {
  const o = cap(['-y', '-i', file, '-filter:a', `loudnorm=I=-14:TP=${TP}:LRA=${LRA}:print_format=json`, '-f', 'null', '-']);
  const s = o.lastIndexOf('{'), e = o.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('could not parse loudnorm json:\n' + o.slice(-800));
  return JSON.parse(o.slice(s, e + 1));
}
function pcm(file) {
  const r = spawnSync(ffmpegPath, ['-v', 'quiet', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'],
    { encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024 });
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
}
function gainSwing(srcFile, outFile) {
  const a = pcm(srcFile), b = pcm(outFile);
  const N = Math.min(a.length, b.length), W = Math.round(SR * 0.01);
  const r = [];
  for (let i = 0; i + W <= N; i += W) {
    let sa = 0, sb = 0;
    for (let j = 0; j < W; j++) { sa += a[i + j] * a[i + j]; sb += b[i + j] * b[i + j]; }
    const ra = Math.sqrt(sa / W);
    if (ra < 1e-4) continue;                       // skip near-silence
    r.push(20 * Math.log10(Math.sqrt(sb / W) / ra));
  }
  if (r.length < 10) return null;
  r.sort((x, y) => x - y);
  const q = p => r[Math.min(r.length - 1, Math.floor(r.length * p))];
  return +(q(0.95) - q(0.05)).toFixed(2);
}

function writeSyntheticWav(file, secs = 12) {
  const n = SR * secs, d = Buffer.alloc(44 + n * 2);
  d.write('RIFF', 0); d.writeUInt32LE(36 + n * 2, 4); d.write('WAVE', 8); d.write('fmt ', 12);
  d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(SR, 24);
  d.writeUInt32LE(SR * 2, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34);
  d.write('data', 36); d.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const lvl = (Math.floor(t / 2) % 2) ? 0.35 : 0.08;          // loud/quiet bars → LRA > 0
    const bed = lvl * Math.sin(2 * Math.PI * 220 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.7 * t));
    const b = t % 0.5;                                          // 120 BPM kick
    const env = b < 0.12 ? Math.exp(-b * 40) : 0;
    const v = Math.max(-1, Math.min(1, bed + 0.9 * env * Math.sin(2 * Math.PI * 55 * b)));
    d.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, d);
}

(async () => {
  const input = process.argv[2] ? path.resolve(process.argv[2]) : path.join(tmp, 'synthetic.wav');
  if (!process.argv[2]) writeSyntheticWav(input);
  if (!fs.existsSync(input)) { console.error('input not found:', input); process.exit(1); }

  const base = measure(input);
  console.log('input : %s', input);
  console.log('source: integrated %s LUFS | true peak %s dBTP | LRA %s\n',
    base.input_i, base.input_tp, base.input_lra);
  console.log('target   achieved LUFS   achieved TP   miss    gain swing');
  console.log('------   -------------   -----------   -----   ----------');

  const inBuf = fs.readFileSync(input);
  const inAB = inBuf.buffer.slice(inBuf.byteOffset, inBuf.byteOffset + inBuf.byteLength);

  for (const I of TARGETS) {
    const ab = await processAudioFfmpeg(inAB, { rate: 1, sampleRate: SR, loudnorm: { I, TP, LRA } });
    const out = path.join(tmp, `out_${Math.abs(I)}.wav`);
    fs.writeFileSync(out, Buffer.from(ab));
    const m = measure(out);
    const miss = parseFloat(m.input_i) - I;
    console.log('%s   %s   %s   %s   %s dB',
      String(I).padStart(6),
      String(m.input_i).padStart(13),
      String(m.input_tp).padStart(11),
      ((miss >= 0 ? '+' : '') + miss.toFixed(2)).padStart(5),
      String(gainSwing(input, out)).padStart(7));
  }

  console.log('\nrendered files kept in: %s', tmp);
  console.log('gain swing: 0 = static gain (transparent). Large = the processor is moving gain');
  console.log('around, which is what pumps and distorts transients. Attenuating targets take the');
  console.log('linear loudnorm path and should read ~0; louder targets go through the limiter.');
})();
