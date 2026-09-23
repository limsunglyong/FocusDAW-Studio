/* ============================================================
 * psola-harness.js — Stage E 렌더 품질 계측 (v2.8.0)
 *
 * 🔴 이 하네스가 v2.8.0 의 유일한 판정이다. 사용자 시험은 없다 —
 *    배선을 먼저 하면 "소리가 이상하다"에서 DSP 문제인지 배선 문제인지 가릴 수 없다.
 *
 * 정답을 아는 합성 신호로 렌더하고, **앱이 쓰는 그 YIN 으로** 결과를 다시 분석해
 * 오차를 센트로 낸다. 착수 전에 정한 기준(앱개발.md v2.8.0):
 *   ① 음정 정확도   중앙값 ≤ 5센트 · 95%ile ≤ 15센트
 *   ② 길이 불변     샘플 수 정확히 동일
 *   ③ 무성 구간     원본과 비트 동일
 *   ④ strength=0    입력과 비트 동일 (무연산)
 *   ⑤ keepVibrato   켜면 편차 유지 · 끄면 평평
 *   ⑥ 클릭 없음     인접 샘플 최대 델타가 원본의 1.5배 이내
 *   ⑦ 레벨 보존     구간 RMS 오차 ≤ 0.5 dB
 *   ⑧ 재편집 무누적 두 번 보정해도 ① 유지
 *
 *   node tools/psola-harness.js
 *   node tools/psola-harness.js --mutate   ← strength 보간을 무시하게 만든다. FAIL 이 정상.
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
    src = src.replace('out[k] = orig + s * (desired - orig);', 'out[k] = desired;');
    if (src === before) { console.error('변이 실패 — 목표 곡선 보간을 못 찾았다.'); process.exit(2); }
  }
  const sb = { console, Math, Float32Array, Uint8Array, Int32Array, Array, Object, Number, String, JSON, Date,
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

const SR = 48000;
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);

// 성문 펄스에 가까운 하모닉 스택. 사인 하나로는 YIN 이 주기를 못 잡고, 실제 보컬은
// 배음이 많아 **마크 찾기가 어려운 쪽**이 정직한 시험이다.
function voice(n, f0At, amp = 0.4) {
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const f = f0At(i / SR);
    ph += 2 * Math.PI * f / SR;
    let v = 0;
    for (let h = 1; h <= 12; h++) v += Math.sin(ph * h) / h;   // 톱니에 가깝다
    x[i] = amp * v * 0.5;
  }
  return x;
}
function noiseSeg(n, amp = 0.05) {
  const x = new Float32Array(n);
  let s = 12345;
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; x[i] = ((s / 0x7fffffff) * 2 - 1) * amp; }
  return x;
}

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  —  ' + detail : ''}`);
};
const pct = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN; };
const rmsOf = (d, a, b) => { let s = 0; for (let i = a; i < b; i++) s += d[i] * d[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const maxDelta = (d, a, b) => { let m = 0; for (let i = a + 1; i < b; i++) m = Math.max(m, Math.abs(d[i] - d[i - 1])); return m; };

// ⑨ 고역 비중 — 🔴 ⑦(RMS)이 가리는 것을 재기 위해 있다.
//
// 구간 RMS 를 원본에 맞춰 놓으면 음량은 맞지만, 겹친 그레인이 어긋나며 깎아 먹은
// **고역**은 그대로 남는다(소리가 둔해진다). 1극 고역통과를 한 번 물려 고역 에너지의
// 비율을 보면 그 손실이 드러난다. 절대값이 아니라 **원본 대비 비율**을 본다.
const hfRatio = (d, a, b, fc) => {
  const al = 1 - Math.exp(-2 * Math.PI * fc / SR);
  let lo = 0, hi = 0, tot = 0;
  for (let i = a; i < b; i++) { lo += al * (d[i] - lo); const h = d[i] - lo; hi += h * h; tot += d[i] * d[i]; }
  return tot > 1e-12 ? hi / tot : 0;
};

// 버퍼를 트랙에 얹고 엔진의 분석을 돌린다 (앱이 쓰는 그 YIN).
function analyse(DAW, x) {
  const buf = new FakeCtx().createBuffer(1, x.length, SR);
  buf.getChannelData(0).set(x);
  DAW.tracks.length = 0;
  const tr = DAW.addBounceTrack('T', buf, { fileName: 'T.wav', filePath: '/x/T.wav' });
  const an = DAW.analyzeClipPitch(tr.id, tr.clips[0].id);
  return { DAW, tr, buf, an };
}

// 유성 구간의 f0 오차(센트). 가장자리 한 주기는 빼고 본다.
function centsError(an, wantMidiAt) {
  const errs = [];
  const half = an.winSec / 2;
  for (let k = 0; k < an.frames; k++) {
    if (!an.voiced[k]) continue;
    const t = k * an.hopSec + half;
    const want = wantMidiAt(t);
    if (!Number.isFinite(want) || !Number.isFinite(an.midi[k])) continue;
    errs.push(Math.abs(an.midi[k] - want) * 100);
  }
  return errs;
}

console.log(`\nStage E — TD-PSOLA 렌더 계측${MUTATE ? '  [변이: strength 보간 무시]' : ''}\n`);

const DAW = loadEngine();

// ── 시험 신호: [무성 0.3s] [A3 1.2s] [무성 0.3s] [C4 1.2s] [무성 0.3s]
const SEG = Math.round(SR * 0.3), TONE = Math.round(SR * 1.2);
const A3 = 57, C4 = 60;
function buildSignal() {
  const parts = [noiseSeg(SEG), voice(TONE, () => midiToHz(A3)), noiseSeg(SEG),
                 voice(TONE, () => midiToHz(C4)), noiseSeg(SEG)];
  const n = parts.reduce((s, p) => s + p.length, 0);
  const x = new Float32Array(n);
  let w = 0;
  for (const p of parts) { x.set(p, w); w += p.length; }
  return x;
}
const X = buildSignal();
const T1 = [SEG / SR, (SEG + TONE) / SR];                       // A3 구간 (초)
const T2 = [(2 * SEG + TONE) / SR, (2 * SEG + 2 * TONE) / SR];  // C4 구간

const base = analyse(DAW, X);
const AN = base.an;
check('시험 신호가 분석된다', !!AN && AN.frames > 0, AN ? AN.frames + ' frames' : 'none');
{
  const e = centsError(AN, (t) => (t >= T1[0] + 0.05 && t <= T1[1] - 0.05) ? A3
                               : (t >= T2[0] + 0.05 && t <= T2[1] - 0.05) ? C4 : NaN);
  check('원본 자체의 검출 오차가 작다 (기준선)', pct(e, 0.5) < 5, '중앙값 ' + pct(e, 0.5).toFixed(1) + '센트');
}

// 화면에 보이던 노트라고 치는 목록
const noteAt = (t0, t1, m, target, strength, keepVibrato) =>
  ({ t0, t1, midi: m, target, strength, keepVibrato, confidence: 0.9 });

console.log('');
console.log('① 음정 정확도 — A3 를 +2 반음, C4 를 −1 반음으로');
{
  const notes = [noteAt(T1[0], T1[1], A3, A3 + 2, 1, true), noteAt(T2[0], T2[1], C4, C4 - 1, 1, true)];
  const out = DAW._psolaRender(base.buf, AN, notes);
  check('렌더가 버퍼를 돌려준다', !!out);
  check('② 길이가 같다', out.length === base.buf.length, out.length + ' vs ' + base.buf.length);
  const y = out.getChannelData(0);

  const re = analyse(loadEngine(), y);
  const e = centsError(re.an, (t) => (t >= T1[0] + 0.1 && t <= T1[1] - 0.1) ? A3 + 2
                                  : (t >= T2[0] + 0.1 && t <= T2[1] - 0.1) ? C4 - 1 : NaN);
  const med = pct(e, 0.5), p95 = pct(e, 0.95);
  check('🔴 ① 오차 중앙값 ≤ 5센트', med <= 5, med.toFixed(1) + '센트 (' + e.length + ' 프레임)');
  check('🔴 ① 95%ile ≤ 15센트', p95 <= 15, p95.toFixed(1) + '센트');

  // ③ 무성 구간은 손대지 않는다.
  //
  // ⚠️ 기준은 **분석이 본 유성 구간**이지 합성 신호의 경계가 아니다. YIN 의 창이 42.7 ms 라
  //    경계를 걸치는 프레임은 톤이 시작되기 조금 전부터 유성으로 잡힌다(실측 0.288~1.515 s,
  //    합성은 0.300~1.500 s). 합성 경계로 재면 **코드가 아니라 시험이 틀린다** — 처음에
  //    그렇게 썼다가 FAIL 이 났고, 진단해 보니 유성 구간 밖에서 바뀐 샘플은 0 이었다.
  //    지켜야 할 약속은 "손대겠다고 한 곳 밖은 건드리지 않는다" 이다.
  const runs = DAW._psolaVoicedRuns(AN, SR, X.length);
  const inRun = (i) => runs.some((r) => i >= r[0] && i < r[1]);
  let outside = 0;
  for (let i = 0; i < X.length; i++) if (y[i] !== X[i] && !inRun(i)) outside++;
  check('🔴 ③ 유성 구간 밖은 원본과 비트 동일', outside === 0, outside + ' 샘플');
  // 그리고 무성 구간이 실제로 통째로 남아 있는지도 함께 본다(구간 안쪽만).
  let quietSame = true;
  for (let i = 0; i < SEG - Math.round(SR * 0.02); i++) if (y[i] !== X[i]) { quietSame = false; break; }
  check('③ 앞쪽 무성 구간(가장자리 20 ms 제외)이 그대로', quietSame);

  // ⑥ 클릭 없음
  const a0 = Math.round(T1[0] * SR), a1 = Math.round(T1[1] * SR);
  const dIn = maxDelta(X, a0, a1), dOut = maxDelta(y, a0, a1);
  check('🔴 ⑥ 인접 샘플 최대 델타가 원본의 1.5배 이내', dOut <= dIn * 1.5,
        dOut.toFixed(4) + ' vs ' + dIn.toFixed(4) + ' (×' + (dOut / dIn).toFixed(2) + ')');

  // ⑦ 레벨 보존
  const rIn = rmsOf(X, a0 + 2000, a1 - 2000), rOut = rmsOf(y, a0 + 2000, a1 - 2000);
  const dB = 20 * Math.log10(rOut / rIn);
  check('🔴 ⑦ 구간 RMS 오차 ≤ 0.5 dB', Math.abs(dB) <= 0.5, dB.toFixed(2) + ' dB');

  // ⑨ — ⑦이 스칼라 이득으로 가려 버리는 것. 2·f0 위쪽 에너지 비중이 원본 대비
  //     얼마나 남는가. 이것이 PSOLA 가 실제로 잃는 것이고, 귀에는 "둔해졌다"로 들린다.
  const fc = midiToHz(A3) * 2;
  const hIn = hfRatio(X, a0 + 2000, a1 - 2000, fc), hOut = hfRatio(y, a0 + 2000, a1 - 2000, fc);
  const keepPct = 100 * hOut / Math.max(1e-12, hIn);
  check('🔴 ⑨ 고역 비중이 원본의 70% 이상 남는다', keepPct >= 70, keepPct.toFixed(0) + '% (원본 대비)');
}

console.log('');
console.log('④ strength = 0 은 진짜 무연산이어야 한다');
{
  const notes = [noteAt(T1[0], T1[1], A3, A3 + 2, 0, true), noteAt(T2[0], T2[1], C4, C4 - 1, 0, true)];
  const out = DAW._psolaRender(base.buf, AN, notes);
  check('🔴 ④ 렌더 자체를 하지 않는다 (null)', out === null, out === null ? 'null' : '버퍼를 만들었다');
}
{
  // 노트가 아예 없어도 마찬가지
  check('노트가 없으면 렌더하지 않는다', DAW._psolaRender(base.buf, AN, []) === null);
  // target 이 검출값 그대로면 보정할 것이 없다
  const flat = [noteAt(T1[0], T1[1], A3, A3, 1, true)];
  const o = DAW._psolaRender(base.buf, AN, flat);
  if (o) {
    let same = true;
    const y = o.getChannelData(0);
    for (let i = 0; i < X.length; i++) if (Math.abs(y[i] - X[i]) > 1e-6) { same = false; break; }
    check('target 이 검출값과 같으면 사실상 무변화', same);
  } else {
    check('target 이 검출값과 같으면 렌더하지 않는다', true, 'null');
  }
}

console.log('');
console.log('④b strength 가 중간이면 중간까지만 간다');
{
  // 🔴 이 검사가 없으면 변이 시험이 ④ 하나밖에 못 잡는다 — strength=1 일 때 보간은
  //    항등이라 나머지 검사가 전부 눈을 감는다. 절반만 가는지를 직접 재야 한다.
  for (const [s, want] of [[0.25, A3 + 1], [0.5, A3 + 2], [0.75, A3 + 3]]) {
    const notes = [noteAt(T1[0], T1[1], A3, A3 + 4, s, true)];
    const out = DAW._psolaRender(base.buf, AN, notes);
    if (!out) { check('strength=' + s + ' 이 렌더된다', false); continue; }
    const re = analyse(loadEngine(), out.getChannelData(0));
    const e = centsError(re.an, (t) => (t >= T1[0] + 0.1 && t <= T1[1] - 0.1) ? want : NaN);
    const med = pct(e, 0.5);
    check('🔴 strength=' + s + ' → +4 반음의 ' + (s * 100) + '% 지점(' + (want - A3) + '반음)',
          med <= 10, med.toFixed(1) + '센트');
  }
}

console.log('');
console.log('⑤ keepVibrato — 비브라토를 살리는가 / 누르는가');
{
  // ±40센트 · 5.5 Hz 비브라토를 A3 위에 얹는다
  const vib = (t) => midiToHz(A3 + 0.4 * Math.sin(2 * Math.PI * 5.5 * t));
  const n0 = Math.round(SR * 0.3), n1 = Math.round(SR * 1.6);
  const parts = [noiseSeg(n0), voice(n1, (t) => vib(t)), noiseSeg(n0)];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const V = new Float32Array(total);
  let w = 0; for (const p of parts) { V.set(p, w); w += p.length; }
  const vb = analyse(loadEngine(), V);
  const VT = [n0 / SR, (n0 + n1) / SR];
  const nt = (keep) => [noteAt(VT[0], VT[1], A3, A3 + 2, 1, keep)];

  const devOf = (an, lo, hi) => {
    const d = [];
    for (let k = 0; k < an.frames; k++) {
      if (!an.voiced[k]) continue;
      const t = k * an.hopSec + an.winSec / 2;
      if (t < lo || t > hi) continue;
      d.push(an.midi[k]);
    }
    const mean = d.reduce((s, v) => s + v, 0) / Math.max(1, d.length);
    return d.map((v) => (v - mean) * 100);   // 센트 편차
  };
  const sd = (a) => { const m = a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
                      return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / Math.max(1, a.length)); };

  const inDev = devOf(vb.an, VT[0] + 0.15, VT[1] - 0.15);
  check('원본에 비브라토가 있다 (기준선)', sd(inDev) > 15, '편차 표준편차 ' + sd(inDev).toFixed(1) + '센트');

  const keepOut = vb.DAW._psolaRender(vb.buf, vb.an, nt(true));
  const flatOut = vb.DAW._psolaRender(vb.buf, vb.an, nt(false));
  check('둘 다 렌더된다', !!keepOut && !!flatOut);

  const kd = devOf(analyse(loadEngine(), keepOut.getChannelData(0)).an, VT[0] + 0.15, VT[1] - 0.15);
  const fd = devOf(analyse(loadEngine(), flatOut.getChannelData(0)).an, VT[0] + 0.15, VT[1] - 0.15);
  check('🔴 ⑤ Keep 은 비브라토를 남긴다', sd(kd) > sd(inDev) * 0.7,
        sd(kd).toFixed(1) + '센트 (원본 ' + sd(inDev).toFixed(1) + ')');
  check('🔴 ⑤ Flatten 은 평평하게 만든다', sd(fd) < sd(inDev) * 0.35,
        sd(fd).toFixed(1) + '센트');
  check('Flatten 이 Keep 보다 확실히 평평하다', sd(fd) < sd(kd) * 0.5,
        sd(fd).toFixed(1) + ' vs ' + sd(kd).toFixed(1));
}

console.log('');
console.log('⑧ 재편집 무누적 — 원본에서 다시 렌더하므로 두 번 해도 같다');
{
  const once = DAW._psolaRender(base.buf, AN, [noteAt(T1[0], T1[1], A3, A3 + 2, 1, true)]);
  const twice = DAW._psolaRender(base.buf, AN, [noteAt(T1[0], T1[1], A3, A3 + 2, 1, true)]);
  let same = true;
  const a = once.getChannelData(0), b = twice.getChannelData(0);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; }
  check('🔴 ⑧ 같은 입력이면 같은 출력 (결정적)', same);

  const re = analyse(loadEngine(), a);
  const e = centsError(re.an, (t) => (t >= T1[0] + 0.1 && t <= T1[1] - 0.1) ? A3 + 2 : NaN);
  check('⑧ 한 번 보정한 결과의 오차가 기준 안', pct(e, 0.5) <= 5, pct(e, 0.5).toFixed(1) + '센트');
}

// ── ⑩ 프린트 경로 (v2.8.1) ─────────────────────────────────────────────────
console.log('');
console.log('⑩ 프린트 — 클립 구간만 보정하고 길이·오프셋을 지킨다');
{
  const D = loadEngine();
  // 9초짜리 소스: [무성 0.3][A3 1.2][무성 0.3][C4 1.2][무성 0.3] 뒤에 여분 무성
  const tail = noiseSeg(Math.round(SR * 5));
  const full = new Float32Array(X.length + tail.length);
  full.set(X, 0); full.set(tail, X.length);
  const fb = new FakeCtx().createBuffer(1, full.length, SR);
  fb.getChannelData(0).set(full);
  D.tracks.length = 0;
  const tr = D.addBounceTrack('P', fb, { fileName: 'P.wav', filePath: '/x/P.wav' });
  const clip = tr.clips[0];

  // 🔴 클립을 **잘라** 소스 오프셋이 0 이 아니게 만든다. 여기가 함정이 있던 자리다 —
  //    분석은 클립 구간만 보고 프레임 0 = 클립 시각 0 이므로, 소스 전체를 렌더에 넘기면
  //    오프셋만큼 어긋난 곳을 보정한다.
  const OFF = 0.2;
  clip.sourceOffset = OFF; clip.offset = OFF;
  clip.duration = (X.length / SR) - OFF;
  clip.end = clip.start + clip.duration;

  const an = D.analyzeClipPitch(tr.id, clip.id);
  check('잘린 클립이 분석된다', !!an && an.frames > 0, an ? an.frames + ' frames' : 'none');

  // 클립 시각 기준 노트(소스 시각에서 OFF 를 뺀 값)
  const nA = { t0: T1[0] - OFF, t1: T1[1] - OFF, midi: A3, target: A3 + 2, strength: 1, keepVibrato: true };
  const before = (tr.sources || []).length;
  const sid = D.printClipPitch(tr.id, clip.id, an, [nA]);
  check('프린트가 새 소스를 만든다', !!sid && (tr.sources || []).length === before + 1);
  check('clip.sourceId 가 갈아끼워졌다', clip.sourceId === sid);
  check('🔴 baseSourceId 는 원본 그대로', clip.pitch.baseSourceId !== sid && !!clip.pitch.baseSourceId);
  check('printedSourceId 가 기록된다', clip.pitch.printedSourceId === sid);
  check('디스크 기록 대기열에 올라간다', D._pendingConsolidations.some((q) => q.sourceId === sid && q.suffix === 'Pitched'));

  const outRaw = tr._rawBuffers[sid];
  check('🔴 새 소스 길이가 원본과 같다 (오프셋·duration 이 그대로 유효)',
        outRaw && outRaw.length === full.length, outRaw ? outRaw.length + ' vs ' + full.length : 'none');

  const y = outRaw.getChannelData(0);
  // 🔴 클립 **밖**(소스 앞 0~OFF, 그리고 클립 뒤 꼬리)은 손대지 않았어야 한다.
  let outside = 0;
  for (let i = 0; i < Math.round(OFF * SR); i++) if (y[i] !== full[i]) outside++;
  for (let i = X.length; i < full.length; i++) if (y[i] !== full[i]) outside++;
  check('🔴 클립 구간 밖은 비트 동일', outside === 0, outside + ' 샘플');

  // 보정이 **제자리에** 들어갔는가 — 소스 시각 기준 A3 구간이 A3+2 로 들려야 한다.
  const re = analyse(loadEngine(), y.subarray(Math.round(OFF * SR), X.length));
  const e = centsError(re.an, (t) => {
    const src = t + OFF;                       // 잘라 낸 구간의 시각 → 소스 시각
    return (src >= T1[0] + 0.1 && src <= T1[1] - 0.1) ? A3 + 2
         : (src >= T2[0] + 0.1 && src <= T2[1] - 0.1) ? C4 : NaN;
  });
  check('🔴 보정이 제자리에 들어갔다 (A3 는 +2, C4 는 그대로)', pct(e, 0.5) <= 5,
        pct(e, 0.5).toFixed(1) + '센트 (' + e.length + ' 프레임)');

  // Revert
  check('Revert 가 원본으로 되돌린다', D.revertClipPitch(tr.id, clip.id) === true);
  check('sourceId 가 base 로', clip.sourceId === clip.pitch.baseSourceId);
  check('printedSourceId 가 비워진다', clip.pitch.printedSourceId === null);
  check('편집은 남는다 (다시 Apply 할 수 있다)', !!clip.pitch);
  check('두 번 Revert 하면 아무 일도 없다', D.revertClipPitch(tr.id, clip.id) === false);

  // 보정할 것이 없으면 프린트하지 않는다
  const nFlat = { t0: T1[0] - OFF, t1: T1[1] - OFF, midi: A3, target: A3, strength: 1, keepVibrato: true };
  check('🔴 보정할 것이 없으면 프린트하지 않는다', D.printClipPitch(tr.id, clip.id, an, [nFlat]) === null);
}


// ── ⑪ 슬라이스 렌더 (v2.8.1) ───────────────────────────────────────────────
// 🔴 비동기 경로는 동기와 **같은 결과**여야 한다. 슬라이스가 결과를 바꾸면 그것은
//    최적화가 아니라 결함이다 — 유성 구간끼리 독립이라는 전제를 지키는 검사다.
// ── ⑫ 프린트 후 편집을 비우면 되돌아갈 수 있어야 한다 (v2.8.2, 사용자 보고) ──
console.log('');
console.log('⑫ 프린트한 뒤 노트를 전부 제자리로 돌리면 원본으로 돌아갈 길이 있다');
{
  const D = loadEngine();
  const fb = new FakeCtx().createBuffer(1, X.length, SR);
  fb.getChannelData(0).set(X);
  D.tracks.length = 0;
  const tr = D.addBounceTrack('R', fb, { fileName: 'R.wav', filePath: '/x/R.wav' });
  const clip = tr.clips[0];
  const an = D.analyzeClipPitch(tr.id, clip.id);

  const moved = [{ t0: T1[0], t1: T1[1], midi: A3, target: A3 + 2, strength: 1, keepVibrato: true }];
  const sid = D.printClipPitch(tr.id, clip.id, an, moved);
  check('먼저 프린트한다', !!sid && clip.sourceId === sid);
  const baseId = clip.pitch.baseSourceId;

  // 사용자가 Reset(또는 드래그)으로 노트를 원래 자리로 되돌린 상태 = 보정 0
  const pristine = [{ t0: T1[0], t1: T1[1], midi: A3, target: A3, strength: 1, keepVibrato: true }];
  check('🔴 보정이 0 이면 렌더는 null 을 준다 (여기까지는 의도된 동작)',
        D.printClipPitch(tr.id, clip.id, an, pristine) === null);
  // 🔴 그 null 을 실패로 끝내면 사용자는 화면과 소리가 어긋난 채 맞출 길이 없다.
  //    앱은 이때 revert 로 처리한다 — 그 경로가 실제로 되돌리는지 본다.
  check('🔴 ⑫ 되돌리기가 그 자리를 메운다', D.revertClipPitch(tr.id, clip.id) === true);
  check('오디오가 원본으로 돌아온다', clip.sourceId === baseId);
  check('printedSourceId 가 비워진다', clip.pitch.printedSourceId === null);
  check('편집 구조는 남는다 (다시 Apply 가능)', !!clip.pitch && clip.pitch.baseSourceId === baseId);
}


// ── ⑬ 프린트 지문 — Apply 를 "다를 때만" 켜기 위한 것 (v2.8.3, 사용자 보고) ──
console.log('');
console.log('⑬ 무엇을 프린트했는지 기억한다 (printedSig)');
{
  const D = loadEngine();
  const fb = new FakeCtx().createBuffer(1, X.length, SR);
  fb.getChannelData(0).set(X);
  D.tracks.length = 0;
  const tr = D.addBounceTrack('G', fb, { fileName: 'G.wav', filePath: '/x/G.wav' });
  const clip = tr.clips[0];
  const an = D.analyzeClipPitch(tr.id, clip.id);
  const moved = [{ t0: T1[0], t1: T1[1], midi: A3, target: A3 + 2, strength: 1, keepVibrato: true }];

  check('프린트 전에는 지문이 없다', !clip.pitch || !clip.pitch.printedSig);
  const sid = D.printClipPitch(tr.id, clip.id, an, moved, 'SIG-A');
  check('프린트가 지문을 기록한다', !!sid && clip.pitch.printedSig === 'SIG-A', String(clip.pitch.printedSig));

  // 🔴 이것이 Apply 를 끄는 근거다 — 화면이 요구하는 것과 프린트된 것이 같다.
  check('clipAudioInfo 가 에디터로 지문을 실어 보낸다',
        ((D.clipAudioInfo(tr.id, clip.id, 50) || {}).pitch || {}).printedSig === 'SIG-A');

  // 저장 왕복
  const j = JSON.parse(JSON.stringify(D.exportProject('G')));
  check('exportProject 에 지문이 실린다', (j.tracks[0].clips[0].pitch || {}).printedSig === 'SIG-A');
  D.importProject(j);
  check('importProject 후에도 남는다',
        ((D.tracks[0].clips[0] || {}).pitch || {}).printedSig === 'SIG-A');

  // 스냅샷(Undo) 왕복
  const sn = D.getSnapshot();
  check('getSnapshot 에 지문이 있다', ((sn.tracks[0].clips[0] || {}).pitch || {}).printedSig === 'SIG-A');

}
{
  // ⚠️ 재프린트·Revert 는 **새 엔진**에서 본다. importProject 는 디스크에서 오디오를
  //    다시 읽지 못하므로(하네스에는 파일이 없다) 원본 버퍼가 사라져 렌더 자체가 안 된다 —
  //    거기서 이어 시험하면 코드가 아니라 시험이 실패한다.
  const D2 = loadEngine();
  const fb2 = new FakeCtx().createBuffer(1, X.length, SR);
  fb2.getChannelData(0).set(X);
  D2.tracks.length = 0;
  const t2 = D2.addBounceTrack('G2', fb2, { fileName: 'G2.wav', filePath: '/x/G2.wav' });
  const c2 = t2.clips[0];
  const an2 = D2.analyzeClipPitch(t2.id, c2.id);
  const m1 = [{ t0: T1[0], t1: T1[1], midi: A3, target: A3 + 2, strength: 1, keepVibrato: true }];
  const m2 = [{ t0: T1[0], t1: T1[1], midi: A3, target: A3 + 3, strength: 1, keepVibrato: true }];
  D2.printClipPitch(t2.id, c2.id, an2, m1, 'SIG-A');
  check('첫 프린트 지문', c2.pitch.printedSig === 'SIG-A', String(c2.pitch.printedSig));
  D2.printClipPitch(t2.id, c2.id, an2, m2, 'SIG-B');
  check('다시 프린트하면 지문이 갱신된다 (Apply 가 다시 꺼지는 근거)',
        c2.pitch.printedSig === 'SIG-B', String(c2.pitch.printedSig));
  // 🔴 Revert 는 지문도 지운다 — 안 지우면 되돌린 뒤에도 Apply 가 꺼진 채 남는다
  check('Revert 가 성공한다', D2.revertClipPitch(t2.id, c2.id) === true);
  check('🔴 ⑬ Revert 가 지문도 지운다', c2.pitch.printedSig === null, String(c2.pitch.printedSig));
  check('되돌린 뒤 편집은 남는다 (다시 Apply 가능)', !!c2.pitch.baseSourceId);
}

// ── ⑭ 이동량 상한 (v2.8.4) ────────────────────────────────────────────────
console.log('');
console.log('⑭ 이동량 상한이 엔진과 에디터에서 같은 값이다');
{
  const D = loadEngine();
  // 에디터 쪽 상수는 소스에서 직접 읽는다 — 이 하네스는 편집 모델을 로드하지 않는다.
  const es = fs.readFileSync(ROOT + '/pitch-editor-app.js'.replace('/pitch-editor-app.js', '/pitch-editor-app.jsx'), 'utf8');
  const m = /const PE_MAX_SHIFT_SEMIS = (\d+);/.exec(es);
  check('에디터에 상한 상수가 있다', !!m, m ? m[1] : 'none');
  const peMax = m ? Number(m[1]) : NaN;
  check('🔴 엔진 PSOLA_MAX_SEMIS 와 에디터 PE_MAX_SHIFT_SEMIS 가 같다',
        D.PSOLA_MAX_SEMIS === peMax, '엔진 ' + D.PSOLA_MAX_SEMIS + ' vs 에디터 ' + peMax);
  check('상한이 6 이다 (Vari Key 의 ±6 과 같은 선)', D.PSOLA_MAX_SEMIS === 6, String(D.PSOLA_MAX_SEMIS));

  // 🔴 상한을 넘겨 달라고 해도 렌더는 거기서 자른다.
  const fb = new FakeCtx().createBuffer(1, X.length, SR);
  fb.getChannelData(0).set(X);
  D.tracks.length = 0;
  const tr = D.addBounceTrack('M', fb, { fileName: 'M.wav', filePath: '/x/M.wav' });
  const an = D.analyzeClipPitch(tr.id, tr.clips[0].id);
  const far = [{ t0: T1[0], t1: T1[1], midi: A3, target: A3 + 12, strength: 1, keepVibrato: true }];
  const out = D._psolaRender(fb, an, far);
  check('상한 밖 요청도 렌더는 된다', !!out);
  if (out) {
    const re = analyse(loadEngine(), out.getChannelData(0)).an;
    const v = [];
    for (let k = 0; k < re.frames; k++) {
      if (!re.voiced[k]) continue;
      const t = k * re.hopSec + re.winSec / 2;
      if (t >= T1[0] + 0.2 && t <= T1[1] - 0.2) v.push(re.midi[k]);
    }
    v.sort((a, b) => a - b);
    const got = v[v.length >> 1];
    check('🔴 +12 를 요청해도 +6 까지만 간다', Math.abs(got - (A3 + 6)) < 0.2,
          '목표 ' + (A3 + 12) + ' 요청 → ' + got.toFixed(2) + ' (상한 ' + (A3 + 6) + ')');
  }
}


const asyncChecks = (async () => {
  console.log('');
  console.log('⑪ 슬라이스 렌더가 동기 렌더와 같은 결과를 낸다');
  const mk = () => {
    const D = loadEngine();
    const fb = new FakeCtx().createBuffer(1, X.length, SR);
    fb.getChannelData(0).set(X);
    D.tracks.length = 0;
    const tr = D.addBounceTrack('S', fb, { fileName: 'S.wav', filePath: '/x/S.wav' });
    const an = D.analyzeClipPitch(tr.id, tr.clips[0].id);
    return { D, tr, clip: tr.clips[0], an };
  };
  const notes = [{ t0: T1[0], t1: T1[1], midi: A3, target: A3 + 2, strength: 1, keepVibrato: true },
                 { t0: T2[0], t1: T2[1], midi: C4, target: C4 - 1, strength: 0.5, keepVibrato: false }];

  const a = mk(), b = mk();
  const sidSync = a.D.printClipPitch(a.tr.id, a.clip.id, a.an, notes);
  let seen = 0, lastTotal = 0;
  const sidAsync = await b.D.printClipPitchAsync(b.tr.id, b.clip.id, b.an, notes, (d, t) => { seen++; lastTotal = t; });
  check('동기·비동기 둘 다 프린트된다', !!sidSync && !!sidAsync);
  check('진행률이 보고된다', seen > 0 && lastTotal > 0, seen + '회 · 구간 ' + lastTotal + '개');

  const ys = a.tr._rawBuffers[sidSync].getChannelData(0);
  const ya = b.tr._rawBuffers[sidAsync].getChannelData(0);
  let diff = 0, maxd = 0;
  for (let i = 0; i < ys.length; i++) { const d = Math.abs(ys[i] - ya[i]); if (d > 0) diff++; if (d > maxd) maxd = d; }
  check('🔴 ⑪ 비트 단위로 동일하다', diff === 0, diff + ' 샘플 다름 (최대 ' + maxd.toExponential(1) + ')');

  // 보정할 것이 없으면 비동기도 null
  const c = mk();
  const flat = [{ t0: T1[0], t1: T1[1], midi: A3, target: A3, strength: 1, keepVibrato: true }];
  check('보정할 것이 없으면 비동기도 프린트하지 않는다',
        (await c.D.printClipPitchAsync(c.tr.id, c.clip.id, c.an, flat, null)) === null);

  console.log(`\n${pass} PASS · ${fail} FAIL`);
  if (MUTATE) {
    console.log(fail > 0 ? '\n✅ 변이 시험 통과 — strength 보간을 빼면 하네스가 잡아낸다.'
                         : '\n🔴 변이했는데도 전건 통과 — 이 하네스는 보간을 지키지 못한다.');
    process.exit(fail > 0 ? 0 : 1);
  }
  process.exit(fail ? 1 : 0);
})();

