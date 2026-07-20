/**
 * loudnorm-probe — diagnose Export loudness normalization.
 *
 * Why this exists: at loud targets (-9 LUFS especially) exported files have audible
 * distortion on transients (drum hits) that in-app playback does not have. This probe
 * runs the SAME two-pass ffmpeg chain electron/main.js uses (processAudioFfmpeg) and
 * reports, per target, which normalization mode ffmpeg actually chose and what loudness
 * it actually achieved.
 *
 * Finding (2026-07-20): `linear=true` is only honoured when the required gain is
 * NEGATIVE. Any positive gain would push true peak past TP=-1 dBTP, so loudnorm silently
 * falls back to Dynamic mode — a time-varying gain whose built-in limiter distorts
 * transients, worse the more gain is demanded. The target is also not reached.
 *
 * Usage:
 *   node tools/loudnorm-probe.js                # synthetic kick+bed signal
 *   node tools/loudnorm-probe.js path/to.wav    # your own material (most useful)
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpeg = require('ffmpeg-static');

const TARGETS = [-23, -16, -14, -12, -9];
const TP = -1, LRA = 11;
const SR = 44100;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'focusdaw-loudnorm-'));

function ffmpegStderr(args) {
  const r = spawnSync(ffmpeg, args, { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
  return (r.stderr || Buffer.alloc(0)).toString('utf8');
}

// loudnorm prints its JSON report last on stderr — same parse as electron/main.js.
function measure(file, target = -14) {
  const out = ffmpegStderr(['-y', '-i', file, '-filter:a',
    `loudnorm=I=${target}:TP=${TP}:LRA=${LRA}:print_format=json`, '-f', 'null', '-']);
  const s = out.lastIndexOf('{'), e = out.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('could not parse loudnorm json:\n' + out.slice(-800));
  return JSON.parse(out.slice(s, e + 1));
}

// Kick transients over a bed, with loud/quiet bars so LRA is non-zero (a flat signal
// reports LRA 0 and pushes loudnorm into Dynamic mode for unrelated reasons).
function writeSyntheticWav(file, secs = 12) {
  const n = SR * secs;
  const d = Buffer.alloc(44 + n * 2);
  d.write('RIFF', 0); d.writeUInt32LE(36 + n * 2, 4); d.write('WAVE', 8);
  d.write('fmt ', 12); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20);
  d.writeUInt16LE(1, 22); d.writeUInt32LE(SR, 24); d.writeUInt32LE(SR * 2, 28);
  d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34);
  d.write('data', 36); d.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const loudBar = Math.floor(t / 2) % 2;
    const lvl = loudBar ? 0.35 : 0.08;
    const bed = lvl * Math.sin(2 * Math.PI * 220 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.7 * t));
    const b = t % 0.5;                                  // 120 BPM
    const env = b < 0.12 ? Math.exp(-b * 40) : 0;
    const kick = 0.9 * env * Math.sin(2 * Math.PI * 55 * b);
    const v = Math.max(-1, Math.min(1, bed + kick));
    d.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, d);
}

const input = process.argv[2] ? path.resolve(process.argv[2]) : path.join(tmp, 'synthetic.wav');
if (!process.argv[2]) writeSyntheticWav(input);
if (!fs.existsSync(input)) { console.error('input not found:', input); process.exit(1); }

const base = measure(input);
console.log('input : %s', input);
console.log('source: integrated %s LUFS | true peak %s dBTP | LRA %s\n',
  base.input_i, base.input_tp, base.input_lra);
console.log('target   gain needed   ffmpeg mode   achieved LUFS   achieved TP   miss');
console.log('------   -----------   -----------   -------------   -----------   ----');

for (const I of TARGETS) {
  const m = measure(input, I);                                   // pass 1 (as the app does)
  const out = path.join(tmp, `out_${Math.abs(I)}.wav`);
  const chain = `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}` +
    `:measured_I=${m.input_i}:measured_TP=${m.input_tp}` +
    `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}` +
    `:offset=${m.target_offset}:linear=true:print_format=summary`;
  const p2 = ffmpegStderr(['-y', '-i', input, '-filter:a', chain, '-ar', String(SR), out]);
  const mode = (p2.match(/Normalization Type:\s*(\w+)/i) || [])[1] || '?';
  const after = measure(out);
  const need = I - parseFloat(m.input_i);
  const miss = parseFloat(after.input_i) - I;
  console.log('%s   %s   %s   %s   %s   %s',
    String(I).padStart(6),
    (need >= 0 ? '+' : '') + need.toFixed(2).padStart(10),
    mode.padEnd(11),
    String(after.input_i).padStart(13),
    String(after.input_tp).padStart(11),
    (miss >= 0 ? '+' : '') + miss.toFixed(2));
}

console.log('\nrendered files kept in: %s', tmp);
console.log('Dynamic mode = loudnorm could not reach the target with a static gain without\n' +
            'breaching TP, so it applied time-varying gain. That is the transient distortion.');
