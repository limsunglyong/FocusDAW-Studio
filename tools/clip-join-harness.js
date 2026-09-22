/* ============================================================
 * clip-join-harness.js — 클립 Join(Merge)의 게인 처리 회귀선 (v2.7.6)
 *
 * 지키는 것: **Join 은 각 클립에 적용된 게인을 보존한다.**
 *
 * v2.7.5 까지의 결함 — `_isHealableRun` 이 게인을 보지 않아, 쪼갠 조각을 도로 붙이는
 * "heal" 경로가 **첫 클립의 게인만** 남기고 나머지를 버렸다. 현장 보고 2건이
 * 정확히 이것이었다(2026-09-22):
 *   A(1.0) + B(0.3) → B 가 1.0 으로 올라감
 *   B(0.3) + C(1.0) → C 가 0.3 으로 내려감
 *
 * 🔴 이 하네스는 플래그가 아니라 **실제 렌더 결과의 진폭**을 잰다. 전략 이름만 보면
 *    "render 로 갔다"까지만 알 수 있고 소리가 맞는지는 모른다.
 *
 *   node tools/clip-join-harness.js
 *   node tools/clip-join-harness.js --mutate   ← 게인 검사를 뺀다. FAIL 이 나와야 정상.
 * ============================================================ */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MUTATE = process.argv.includes('--mutate');

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
  let src = fs.readFileSync(path.join(ROOT, 'audio-engine.js'), 'utf8').replace(/\r/g, '');
  if (MUTATE) {
    const before = src;
    // v2.7.6 의 수정을 되돌린다 — 게인이 달라도 healable 이라고 답하게 만든다.
    src = src.replace('        if (Math.abs(gainOf(c) - gainOf(first)) > 1e-4) return false;', '');
    if (src === before) { console.error('변이 실패 — 게인 검사를 못 찾았다.'); process.exit(2); }
  }
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
  DAW.tracks.length = 0;
  return DAW;
}

// 진폭 1.0 의 DC 에 가까운 신호 — 구간별 RMS 가 곧 게인이 된다. 사인파를 쓰면 RMS 가
// 0.707 배로 나와 "게인 0.3 인가"를 읽기가 번거롭다.
function flat(sr, secs) {
  const n = Math.round(sr * secs);
  const b = new FakeCtx().createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = 1.0;
  return b;
}

// 구간 [t0,t1) 의 평균 절대값.
//
// 🔴 재는 대상은 렌더된 소스가 아니라 **track.buffer — 즉 bake 결과**다. 이유가 있다:
//    heal 경로는 오디오를 건드리지 않고 clip.gain 을 bake 때 곱하고, render 경로는 게인을
//    소스에 구워 넣은 뒤 clip.gain 을 1 로 둔다. 소스를 재면 heal 쪽은 언제나 원본 진폭이
//    나와 "들리는 소리"를 말해 주지 못한다. bake 를 재면 **두 경로를 같은 잣대로** 잴 수
//    있고, 그것이 사용자가 듣는 것이다.
//    bake 는 타임라인 시각 = 버퍼 시각이므로 구간을 그대로 쓸 수 있다.
// 경계의 마이크로 페이드/크로스페이드를 피해 안쪽만 본다.
function levelAt(buf, t0, t1) {
  const sr = buf.sampleRate, d = buf.getChannelData(0);
  const a = Math.round(t0 * sr), b = Math.min(d.length, Math.round(t1 * sr));
  let s = 0, n = 0;
  for (let i = a; i < b; i++) { s += Math.abs(d[i]); n++; }
  return n ? s / n : 0;
}

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  —  ' + detail : ''}`);
};

console.log(`\n클립 Join 게인 회귀선${MUTATE ? '  [변이: 게인 검사 제거]' : ''}\n`);

// 3분할 + 가운데만 게인을 내린 트랙을 만든다 (현장 보고와 같은 모양).
function makeSplit3(gains) {
  const DAW = loadEngine();
  const tr = DAW.addBounceTrack('Vox', flat(48000, 9), { fileName: 'V.wav', filePath: '/x/V.wav' });
  DAW.splitClip(tr.id, tr.clips[0].id, 3);
  const mid = tr.clips.find((c) => Math.abs(c.start - 3) < 1e-6);
  DAW.splitClip(tr.id, mid.id, 6);
  const cl = tr.clips.slice().sort((a, b) => a.start - b.start);
  if (cl.length !== 3) { console.error('분할이 3개가 아니다: ' + cl.length); process.exit(2); }
  cl.forEach((c, i) => { if (gains[i] !== 1) DAW.setClipGain(tr.id, c.id, gains[i]); });
  return { DAW, tr, cl: tr.clips.slice().sort((a, b) => a.start - b.start) };
}

console.log('① 전략 선택 — 게인이 다르면 heal 이 아니다');
{
  const same = makeSplit3([1, 1, 1]);
  const s1 = same.DAW.canConsolidateClips(same.tr.id, [same.cl[0].id, same.cl[1].id]);
  check('게인이 같으면 heal (파일을 안 만든다)', s1.ok && s1.strategy === 'heal', s1.strategy);

  const diff = makeSplit3([1, 0.3, 1]);
  const s2 = diff.DAW.canConsolidateClips(diff.tr.id, [diff.cl[0].id, diff.cl[1].id]);
  check('🔴 게인이 다르면 render (게인을 구워 넣는다)', s2.ok && s2.strategy === 'render', s2.strategy);
  const s3 = diff.DAW.canConsolidateClips(diff.tr.id, [diff.cl[1].id, diff.cl[2].id]);
  check('🔴 반대 순서도 render', s3.ok && s3.strategy === 'render', s3.strategy);
  const s4 = diff.DAW.canConsolidateClips(diff.tr.id, [diff.cl[0].id, diff.cl[1].id, diff.cl[2].id]);
  check('3개를 한 번에 골라도 render', s4.ok && s4.strategy === 'render', s4.strategy);
}

console.log('');
console.log('② case A — A(1.0) + B(0.3) 을 Join 하면 B 가 0.3 으로 남는가');
{
  const { DAW, tr, cl } = makeSplit3([1, 0.3, 1]);
  const id = DAW.joinClips(tr.id, cl[0].id, cl[1].id);
  check('Join 이 성공한다', !!id);
  const merged = tr.clips.find((c) => c.id === id);
  check('합친 클립이 0~6 초를 덮는다', merged && Math.abs(merged.start) < 1e-6 && Math.abs(merged.duration - 6) < 1e-3,
        merged ? merged.start + '~' + (merged.start + merged.duration) : 'none');
  check('렌더된 소스가 생겼다', !!tr._rawBuffers[merged.sourceId]);
  const a = levelAt(tr.buffer, 0.5, 2.5), b = levelAt(tr.buffer, 3.5, 5.5);
  check('A 구간은 1.0 그대로', Math.abs(a - 1.0) < 0.02, a.toFixed(3));
  check('🔴 B 구간이 0.3 으로 남는다 (case A 의 증상)', Math.abs(b - 0.3) < 0.02, b.toFixed(3));
  check('합친 클립의 gain 은 1.0 (게인은 오디오에 구워졌다)', Math.abs((merged.gain == null ? 1 : merged.gain) - 1) < 1e-6,
        String(merged.gain));
  check('건드리지 않은 C 는 그대로 1.0', Math.abs((tr.clips.find((c) => Math.abs(c.start - 6) < 1e-6).gain ?? 1) - 1) < 1e-6);
}

console.log('');
console.log('③ case B — B(0.3) + C(1.0) 을 Join 하면 C 가 1.0 으로 남는가');
{
  const { DAW, tr, cl } = makeSplit3([1, 0.3, 1]);
  const id = DAW.joinClips(tr.id, cl[1].id, cl[2].id);
  const merged = tr.clips.find((c) => c.id === id);
  check('Join 이 성공한다', !!merged);
  // ⚠️ bake 는 타임라인 시각이다 — 여기서 합친 것은 3~9 초 구간이므로 B 는 3.5~5.5,
  //    C 는 6.5~8.5 다. 소스 로컬 좌표(0 부터)로 재면 엉뚱한 곳을 본다.
  const b = levelAt(tr.buffer, 3.5, 5.5), c = levelAt(tr.buffer, 6.5, 8.5);
  check('건드리지 않은 A 는 그대로 1.0', Math.abs(levelAt(tr.buffer, 0.5, 2.5) - 1.0) < 0.02);
  check('B 구간은 0.3 그대로', Math.abs(b - 0.3) < 0.02, b.toFixed(3));
  check('🔴 C 구간이 1.0 으로 남는다 (case B 의 증상)', Math.abs(c - 1.0) < 0.02, c.toFixed(3));
}

console.log('');
console.log('④ 3개를 한 번에 Join 해도 각자의 게인이 남는가');
{
  const { DAW, tr, cl } = makeSplit3([1, 0.3, 0.6]);
  const id = DAW.consolidateClips(tr.id, [cl[0].id, cl[1].id, cl[2].id]);
  const merged = tr.clips.find((c) => c.id === id);
  check('하나로 합쳐진다', !!merged && tr.clips.length === 1);
  const a = levelAt(tr.buffer, 0.5, 2.5), b = levelAt(tr.buffer, 3.5, 5.5), c = levelAt(tr.buffer, 6.5, 8.5);
  check('A = 1.0', Math.abs(a - 1.0) < 0.02, a.toFixed(3));
  check('B = 0.3', Math.abs(b - 0.3) < 0.02, b.toFixed(3));
  check('C = 0.6', Math.abs(c - 0.6) < 0.02, c.toFixed(3));
}

console.log('');
console.log('⑤ 무회귀 — 게인을 건드리지 않은 Join 은 종전대로 파일을 만들지 않는다');
{
  const { DAW, tr, cl } = makeSplit3([1, 1, 1]);
  const before = (tr.sources || []).length;
  const id = DAW.joinClips(tr.id, cl[0].id, cl[1].id);
  const merged = tr.clips.find((c) => c.id === id);
  check('Join 이 성공한다', !!merged);
  check('새 소스를 만들지 않는다 (heal)', (tr.sources || []).length === before, before + ' → ' + (tr.sources || []).length);
  check('소스를 그대로 읽는다', merged.sourceId === cl[0].sourceId);
  check('gain 은 1.0', Math.abs((merged.gain == null ? 1 : merged.gain) - 1) < 1e-6);

  // 셋 다 같은 값으로 내려 둔 경우도 heal 이어야 한다 — 값이 하나뿐이면 표현할 수 있다.
  const same = makeSplit3([0.5, 0.5, 0.5]);
  const s = same.DAW.canConsolidateClips(same.tr.id, [same.cl[0].id, same.cl[1].id]);
  check('셋 다 같은 게인이면 heal', s.strategy === 'heal', s.strategy);
  const id2 = same.DAW.joinClips(same.tr.id, same.cl[0].id, same.cl[1].id);
  const m2 = same.tr.clips.find((c) => c.id === id2);
  check('그 게인이 그대로 남는다', Math.abs(m2.gain - 0.5) < 1e-6, String(m2.gain));
  // heal 이어도 들리는 결과를 재 둔다 — 두 경로가 같은 잣대를 통과해야 한다.
  const lv = levelAt(same.tr.buffer, 0.5, 2.5), lv2 = levelAt(same.tr.buffer, 3.5, 5.5);
  check('들리는 소리도 0.5 (heal 경로)', Math.abs(lv - 0.5) < 0.02 && Math.abs(lv2 - 0.5) < 0.02,
        lv.toFixed(3) + ' / ' + lv2.toFixed(3));
}

console.log(`\n${pass} PASS · ${fail} FAIL`);
if (MUTATE) {
  console.log(fail > 0
    ? '\n✅ 변이 시험 통과 — 게인 검사를 빼면 하네스가 잡아낸다.'
    : '\n🔴 변이했는데도 전건 통과 — 이 하네스는 게인 보존을 실제로 지키지 못한다.');
  process.exit(fail > 0 ? 0 : 1);
}
process.exit(fail ? 1 : 0);
