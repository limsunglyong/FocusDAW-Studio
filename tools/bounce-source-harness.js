#!/usr/bin/env node
/* ============================================================================
   FocusDAW — 트랙 원본 버퍼 등록 회귀 하네스 (v2.5.1, T-2.5.1-1)
   ----------------------------------------------------------------------------
     node tools/bounce-source-harness.js

   종료 코드: 하나라도 실패하면 1.

   ── 무엇을 지키는가 ────────────────────────────────────────────────────────
   엔진은 오디오를 두 군데에 들고 있다.

     track.buffer                 타임라인 재생용 렌더 — 재생·파형·미터가 쓴다
     track._rawBuffers[sourceId]  소스별 원본 — Pitch Editor·Analyze·De-noise가 쓴다

   Merge Tracks가 만든 bounce 트랙은 두 번째를 채우지 않아서, 파형은 멀쩡히
   보이는데 Pitch Editor만 "This clip is no longer available"을 냈다(v2.5.1에서
   수정, 재현율 100%). 다른 트랙으로 클립을 복사하면 그 부수 효과로 고쳐졌기
   때문에 사람에 따라 간헐적으로 보였다.

   ⚠️ 반대 방향의 위험이 같이 있다. 재열기 중인 트랙은 **무음 placeholder**
   버퍼를 들고 있고 소스가 needsAudio다. 그것을 raw로 등록해 버리면
   _rawBufferForSource가 _rawBuffers를 needsAudio보다 **먼저** 보기 때문에
   무음이 이겨서, 재연결이 끝나기 전에 클립이 무음으로 구워진다(v2.4.8이
   다뤘던 실패 모양). 그래서 이 하네스는 **양쪽을 함께** 본다 —
   "bounce는 등록되는가"와 "placeholder는 등록되지 않는가"는 한 몸이다.
   ========================================================================== */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── 가짜 Web Audio (오디오 장치 없이 엔진을 돌리기 위한 최소한) ─────────────
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

function tone(sr, secs, freq) {
  const n = Math.floor(sr * secs), a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / sr);
  return { sampleRate: sr, length: n, duration: secs, numberOfChannels: 1, getChannelData: () => a };
}

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  —  ' + detail : ''}`);
};

const DAW = loadEngine();

console.log('트랙 원본 버퍼 등록 (v2.5.1)\n');

// ── ① Merge Tracks 직후의 bounce ───────────────────────────────────────────
console.log('① Merge Tracks가 만든 bounce에서 소스 기반 기능이 즉시 되는가');
const b = DAW.addBounceTrack('Bounce 1', tone(48000, 5, 220),
                             { fileName: 'Bounce 1.wav', filePath: '/x/Bounce 1.wav' });
const clipId = b.clips[0].id;
check('_rawBuffers에 primary가 등록된다',
      !!(b._rawBuffers && b._rawBuffers[b.sources[0].id]),
      b._rawBuffers ? JSON.stringify(Object.keys(b._rawBuffers)) : 'undefined');
check('Pitch Editor (clipAudioInfo)', !!DAW.clipAudioInfo(b.id, clipId, 900),
      'null이면 "This clip is no longer available"');
check('Analyze (_pitchAnalysisSetup)', !!DAW._pitchAnalysisSetup(b.id, clipId, null));
check('De-noise가 읽는 raw', !!DAW._rawBufferForSource(b, b.clips[0].sourceId));

// ── ② 복사 없이 되어야 한다 (예전에는 복사가 부수 효과로 고쳤다) ────────────
console.log('\n② 다른 트랙으로 복사하지 않은 상태여야 한다 — 위 ①이 복사 전에 통과했는지');
check('bounce 외 트랙이 없다', DAW.tracks.length === 1, DAW.tracks.length + '개');

// ── ③ 재열기 placeholder는 오염되면 안 된다 (v2.4.8 영역) ──────────────────
console.log('\n③ 재열기 중인 placeholder는 raw로 등록되면 안 된다');
const ph = DAW._addTrack({
  name: 'Reopened', type: 'audio', kind: 'file',
  // ⚠️ 반드시 실제 버퍼 객체를 넘겨야 이 시험이 의미가 있다. buffer가 null이면 seeding
  // 자체가 일어날 수 없어 가드가 없어도 통과해 버린다(실제로 한 번 그렇게 썼다가
  // 가드를 빼는 변이 시험에서 이 항목이 통과하는 것을 보고 알았다).
  buffer: tone(48000, 5, 0),                       // importProject가 만드는 무음 placeholder
  needsAudio: true,
  sources: [{ id: 'src_ph', filePath: '/x/a.wav', fileName: 'a.wav', duration: 5, needsAudio: true }],
  clips: [{ id: 'c_ph', sourceId: 'src_ph', start: 0, duration: 5, offset: 0 }],
});
check('placeholder 트랙에 raw가 심기지 않는다',
      !(ph._rawBuffers && ph._rawBuffers['src_ph']),
      ph._rawBuffers ? JSON.stringify(Object.keys(ph._rawBuffers)) : '(비어 있음)');
check('_rawBufferForSource가 null을 준다 — 재연결 전까지 클립을 건너뛰게',
      !DAW._rawBufferForSource(ph, 'src_ph'));

// ── ④ 소스가 needsAudio가 아닌 일반 트랙은 정상 등록 ────────────────────────
console.log('\n④ 일반 트랙(소스 정상)은 종전대로 등록된다');
const ok = DAW._addTrack({
  name: 'Plain', type: 'audio', buffer: tone(48000, 3, 330),
  sources: [{ id: 'src_ok', fileName: 'x.wav', duration: 3, needsAudio: false }],
  clips: [{ id: 'c_ok', sourceId: 'src_ok', start: 0, duration: 3, offset: 0 }],
});
check('raw가 등록된다', !!(ok._rawBuffers && ok._rawBuffers['src_ok']));

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'} — ${pass}건 통과, ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
