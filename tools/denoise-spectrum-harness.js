#!/usr/bin/env node
/* ============================================================================
   FocusDAW — De-noise 프린트 후 PRE 곡선 갱신 회귀 하네스 (v2.5.2, T-2.5.2-1)
   ----------------------------------------------------------------------------
   audio-engine.js를 그대로 vm에 올려 **진짜 De-noise 프린트**를 걸고, 그 직후
   `computeTrackSpectrum()`이 **새 오디오의 곡선**을 주는지 본다.

     node tools/denoise-spectrum-harness.js

   종료 코드: 하나라도 실패하면 1.

   ── 왜 이 하네스가 따로 필요한가 ────────────────────────────────────────────
   spectrum-harness ⑦은 `audioRev`를 **손으로 올려** 캐시 무효화만 봤다. v2.5.2가
   기대는 것은 그보다 강한 성질이다 — **`denoiseClip`이 반환하기 전에 audioRev가
   이미 올라가 있다**(그 안에서 `_ensureBaked`를 부르므로). 그래야 스트립이
   `DENOISE_RESULT`를 받은 자리에서 곧바로 스펙트럼을 요청해도 **경쟁이 없다.**
   이 순서가 깨지면(예: 베이크를 다음 프레임으로 미루는 최적화) 곡선은 조용히
   프린트 이전 모습으로 남는다 — 로그도 예외도 없이. 그것을 여기서 잡는다.

   ⚠️ 사용자 시험(T-2.5.2-1)을 대신하지 못한다. 스트립이 실제로 그 요청을
   보내는지(창 사이 BroadcastChannel 배선)는 React 창이 필요하므로 앱에서 본다.
   여기서 보는 것은 **엔진이 그 요청에 옳게 답할 준비가 돼 있는가**이다.
   ========================================================================== */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── 가짜 Web Audio (bounce-source-harness와 같은 최소 구현) ─────────────────
const param = () => ({ value: 0, setValueAtTime() { return this; }, linearRampToValueAtTime() { return this; },
  exponentialRampToValueAtTime() { return this; }, setTargetAtTime() { return this; },
  cancelScheduledValues() { return this; }, setValueCurveAtTime() { return this; } });
const node = () => ({ connect() { return arguments[0]; }, disconnect() {}, start() {}, stop() {},
  getFloatTimeDomainData() {}, getByteFrequencyData() {}, getFloatFrequencyData() {},
  gain: param(), pan: param(), delayTime: param(), frequency: param(), Q: param(), detune: param(),
  threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
  playbackRate: param(), reduction: 0, fftSize: 512, frequencyBinCount: 256,
  type: '', curve: null, oversample: '', buffer: null, loop: false, normalize: true, onended: null });

function FakeCtx() { this.sampleRate = 48000; this.currentTime = 0; this.state = 'running';
                     this.destination = node(); this.listener = node(); }
for (const m of ['createGain','createStereoPanner','createAnalyser','createDelay','createBiquadFilter',
                 'createDynamicsCompressor','createBufferSource','createConvolver','createWaveShaper',
                 'createChannelSplitter','createChannelMerger','createOscillator','createPanner',
                 'createScriptProcessor','createConstantSource','createIIRFilter','createPeriodicWave'])
  FakeCtx.prototype[m] = () => node();
FakeCtx.prototype.createBuffer = function (ch, len, sr) {
  const d = []; for (let c = 0; c < ch; c++) d.push(new Float32Array(len));
  return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (c) => d[c] };
};
FakeCtx.prototype.decodeAudioData = () => Promise.reject(new Error('n/a'));
FakeCtx.prototype.resume = () => Promise.resolve();
FakeCtx.prototype.suspend = () => Promise.resolve();
FakeCtx.prototype.close = () => Promise.resolve();
FakeCtx.prototype.setSinkId = () => Promise.resolve();

function loadEngine() {
  // ⚠️ 작업본이 CRLF다 — vm에 넣기 전에 제거한다(앱개발.md).
  const src = fs.readFileSync(path.join(ROOT, 'audio-engine.js'), 'utf8').replace(/\r/g, '');
  const sb = { console, Math, Float32Array, Uint8Array, Array, Object, Number, String, JSON, Date,
    Set, Map, isFinite, parseInt, parseFloat, Promise, Error,
    setTimeout, clearTimeout, setInterval, clearInterval, performance: { now: () => Date.now() } };
  sb.window = sb; sb.self = sb;
  sb.document = { documentElement: {}, createElement: () => ({ style: {} }), addEventListener() {}, querySelector: () => null };
  sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  sb.navigator = { userAgent: 'node' };
  sb.AudioContext = FakeCtx; sb.OfflineAudioContext = FakeCtx;
  sb.requestAnimationFrame = (f) => setTimeout(f, 16);
  sb.Meyda = undefined;
  sb.BroadcastChannel = function () { return { postMessage() {}, close() {} }; };
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'audio-engine.js' });
  const DAW = sb.DAW;
  DAW.init();
  DAW.tracks.length = 0;      // init이 붙이는 데모 트랙 제거
  return DAW;
}

// 앞 NOISE_SEC는 5 kHz "룸톤"만, 그 뒤는 100 Hz 본신호 + 같은 룸톤.
// 프로파일을 앞 구간에서 배우므로 프린트는 5 kHz를 곡 전체에서 깎아야 한다.
const SR = 48000, SECS = 6, NOISE_SEC = 1.2, TONE = 100, NOISE = 5000;
function takeBuffer() {
  const n = Math.floor(SR * SECS), a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    a[i] = 0.20 * Math.sin(2 * Math.PI * NOISE * t)
         + (t >= NOISE_SEC ? 0.50 * Math.sin(2 * Math.PI * TONE * t) : 0);
  }
  return { sampleRate: SR, length: n, duration: SECS, numberOfChannels: 1, getChannelData: () => a };
}

const dbAt = (pts, f) => pts.reduce((b, p) => (Math.abs(p.f - f) < Math.abs(b.f - f) ? p : b), pts[0]).db;

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  —  ' + detail : ''}`);
};

const DAW = loadEngine();
console.log('De-noise 프린트 후 PRE 곡선 (v2.5.2)\n');

const track = DAW._addTrack({
  name: 'Vox', type: 'audio', kind: 'audioIn', buffer: takeBuffer(),
  sources: [{ id: 'src_vox', fileName: 'vox.wav', duration: SECS, sampleRate: SR, channels: 1, needsAudio: false }],
  clips: [{ id: 'c_vox', sourceId: 'src_vox', start: 0, duration: SECS, offset: 0, sourceOffset: 0 }],
});

console.log('① 프린트 전 곡선 — 룸톤(5 kHz)이 들어 있다');
const before = DAW.computeTrackSpectrum(track.id);
const nzBefore = dbAt(before, NOISE), tnBefore = dbAt(before, TONE);
check('곡선이 그려진다', before.length === 150, `${before.length}점`);
check('5 kHz가 바닥보다 높다', nzBefore > dbAt(before, 12000) + 10,
      `5k ${nzBefore.toFixed(1)} dB / 12k ${dbAt(before, 12000).toFixed(1)} dB`);

console.log('\n② De-noise 프린트 — 앞 구간을 룸톤으로 배워 곡 전체에서 깎는다');
const learned = DAW.learnDenoiseProfile(track.id, 'c_vox', 0, NOISE_SEC);
check('프로파일 학습', !!learned, learned ? `${learned.seconds.toFixed(2)} s` : 'null');
const revBefore = track.audioRev || 0;
const newSourceId = DAW.denoiseClip(track.id, 'c_vox', { amount: 0.8 });
check('프린트가 새 소스를 만든다', !!newSourceId, String(newSourceId));

console.log('\n③ 🔴 denoiseClip은 반환하기 전에 audioRev를 올린다 (v2.5.2가 기대는 성질)');
// 이것이 깨지면 스트립이 DENOISE_RESULT 자리에서 요청해도 옛 캐시를 받는다 —
// 예외도 로그도 없이 곡선만 프린트 이전 모습으로 남는다.
check('audioRev가 올라가 있다', (track.audioRev || 0) > revBefore,
      `${revBefore} → ${track.audioRev}`);

console.log('\n④ 추가 조작 없이 곡선이 새 오디오를 반영한다 (창을 닫았다 열 필요 없음)');
const after = DAW.computeTrackSpectrum(track.id);
const nzAfter = dbAt(after, NOISE), tnAfter = dbAt(after, TONE);
const drop = nzBefore - nzAfter, keep = tnBefore - tnAfter;
check('5 kHz 룸톤이 내려간다', drop > 6, `${nzBefore.toFixed(1)} → ${nzAfter.toFixed(1)} dB (−${drop.toFixed(1)})`);
check('100 Hz 본신호는 남는다', Math.abs(keep) < 3, `${tnBefore.toFixed(1)} → ${tnAfter.toFixed(1)} dB`);

console.log('\n⑤ 무회귀 — 아무 일도 없으면 곡선은 그대로다 (매번 흔들리면 안 된다)');
const again = DAW.computeTrackSpectrum(track.id);
check('같은 값을 준다', again.every((p, i) => Math.abs(p.db - after[i].db) < 1e-9),
      `${again.length}점 비교`);

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'} — ${pass}건 통과, ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
