#!/usr/bin/env node
/* ============================================================================
   FocusDAW — 스펙트럼 코어 회귀 하네스 (v2.5.0, T-2.5.0-1~4)
   ----------------------------------------------------------------------------
   audio-engine.js를 그대로 vm에 올려 `computeSpectrum()` / `computeTrackSpectrum()`
   을 실제 코드로 돌린다. 앱도 오디오 장치도 창도 필요 없다.

     node tools/spectrum-harness.js            기능 확인 10항목 (기본)
     node tools/spectrum-harness.js --time     프레임 예산·구축 시간 계측
     node tools/spectrum-harness.js --all      둘 다

   종료 코드: 기능 확인이 하나라도 실패하면 1. CI나 커밋 전 확인에 쓸 수 있다.

   ── 왜 하네스인가 ──────────────────────────────────────────────────────────
   "곡선이 맞아 보이는가"는 눈으로 볼 수 있지만 "gain을 절반으로 줄이면 정확히
   -6 dB 내려가는가"는 볼 수 없다. 그리고 스펙트럼 코드는 앞으로도 손댈 곳이다
   (제안.md의 K-weighting 건, Stage E 피치 프린트 후 곡선 갱신). 그때 이 파일이
   명령 한 줄짜리 회귀선이 된다.
   ⚠️ 사용자 시험(T-2.5.0-*)을 대신하지 못한다. 여기서 통과해도 "화면에서 자연
   스러운가 · 버벅이지 않는가"는 실제 앱에서 봐야 한다.

   ── vm에 올릴 때의 함정 (앱개발.md 경고) ────────────────────────────────────
   작업본이 CRLF라 \r를 먼저 제거하지 않으면 소스를 다루는 정규식이 조용히
   빗나간다. 아래 loadEngine()이 항상 제거한다.

   ── 왜 사인파를 쓰는가 ──────────────────────────────────────────────────────
   피치 하네스(make-pitch-test-audio.js)와 반대다. 저기서는 YIN이 배음 구조에
   따라 다르게 행동하므로 사인파가 실전보다 쉬워 못 쓴다. 여기서 재는 것은
   "합성·가중치·캐시가 맞는가"이지 검출 난이도가 아니므로, 피크가 어디에 있어야
   하는지 명확한 사인파가 오히려 정답을 아는 신호다.
   ========================================================================== */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const runFn = !args.includes('--time') || args.includes('--all');
const runTime = args.includes('--time') || args.includes('--all');

// ── 엔진 적재 ───────────────────────────────────────────────────────────────
function loadEngine() {
  // ⚠️ CRLF 제거는 선택이 아니다 — 앱개발.md 참조.
  const src = fs.readFileSync(path.join(ROOT, 'audio-engine.js'), 'utf8').replace(/\r/g, '');
  const sb = {
    console, Math, Float32Array, Array, Object, Number, String, JSON, Date, Set, Map,
    isFinite, parseInt, parseFloat, setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 },
  };
  sb.window = sb; sb.self = sb;
  sb.document = { documentElement: {}, createElement: () => ({ style: {} }),
                  addEventListener() {}, querySelector: () => null };
  sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  sb.navigator = { userAgent: 'node' };
  // 오디오 장치가 없으므로 ctx는 만들 수 없다. 스펙트럼 코어는 ctx를 쓰지 않는다
  // (레이트를 buffer.sampleRate에서 읽는 것이 v2.5.0의 요점이다) — init만 막으면 된다.
  sb.AudioContext = function () { throw new Error('no audio device in harness'); };
  sb.OfflineAudioContext = sb.AudioContext;
  sb.requestAnimationFrame = (f) => setTimeout(f, 16);
  sb.Meyda = undefined;
  sb.BroadcastChannel = function () { return { postMessage() {}, close() {} }; };
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'audio-engine.js' });
  const DAW = sb.DAW;
  DAW.init = () => {};
  DAW._anySolo = function () { return this.tracks.some((t) => t.params.solo); };
  return DAW;
}

// ── 시험용 트랙 ─────────────────────────────────────────────────────────────
function tone(id, freq, sr, secs, params) {
  const n = Math.floor(sr * secs);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / sr);
  return {
    id, name: id, kind: 'file', audioRev: 1, needsAudio: false, recording: false,
    params: Object.assign({ volume: 1, mute: false, solo: false }, params || {}),
    buffer: { sampleRate: sr, length: n, duration: secs, numberOfChannels: 1,
              getChannelData: () => a },
  };
}

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;
const peakF = (pts) => pts.reduce((b, p) => (p.db > b.db ? p : b), pts[0]).f;
const dbAt = (pts, f) => pts.reduce((b, p) => (Math.abs(p.f - f) < Math.abs(b.f - f) ? p : b), pts[0]).db;
// 격자가 로그 150점(점 간격 약 4.5%)이라 피크는 정확히 그 주파수에 떨어지지 않는다.
const near = (got, want, tolPct = 6) => Math.abs(got - want) / want * 100 <= tolPct;
// 구축이 끝날 때까지 프레임을 돌린다(앱에서 여러 프레임에 걸쳐 일어나는 일).
const drain = (DAW, n = 600) => { let r = null; for (let k = 0; k < n; k++) r = DAW.computeSpectrum(); return r; };

let pass = 0, fail = 0;
function check(label, ok, detail) {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  —  ' + detail : ''}`);
}

// ── 기능 확인 ───────────────────────────────────────────────────────────────
function functional() {
  const DAW = loadEngine();
  const SR = 48000, SECS = 8;
  console.log('스펙트럼 코어 기능 확인 (v2.5.0)\n');

  console.log('① N을 레이트에서 유도하는가 — 두 PC가 같은 bin 폭을 봐야 한다');
  for (const [sr, wantN] of [[44100, 4096], [48000, 4096], [96000, 8192]]) {
    const N = DAW._specFftSize(sr);
    check(`sr=${sr} → N=${N}`, N === wantN, `bin ${(sr / N).toFixed(2)} Hz`);
  }

  console.log('\n② mute를 반영하는가 (사용자 요청의 핵심)');
  DAW.tracks = [tone('low', 100, SR, SECS), tone('high', 5000, SR, SECS)];
  DAW.tracks[1].params.mute = true;
  check('high mute → 저역이 남는다', near(peakF(drain(DAW)), 100), `피크 ${peakF(drain(DAW)).toFixed(0)} Hz`);
  DAW.tracks[1].params.mute = false; DAW.tracks[0].params.mute = true;
  check('low mute → 고역이 남는다', near(peakF(drain(DAW)), 5000), `피크 ${peakF(drain(DAW)).toFixed(0)} Hz`);
  DAW.tracks[0].params.mute = false;

  console.log('\n③ solo를 반영하는가');
  DAW.tracks[1].params.solo = true;
  check('high solo', near(peakF(drain(DAW)), 5000), `피크 ${peakF(drain(DAW)).toFixed(0)} Hz`);
  DAW.tracks[1].params.solo = false;

  console.log('\n④ 트랙 gain을 반영하는가 — 눈으로는 못 보는 항목');
  const full = drain(DAW);
  const l0 = dbAt(full, 100), h0 = dbAt(full, 5000);
  DAW.tracks[0].params.volume = 0.5;
  const half = drain(DAW);
  const dl = dbAt(half, 100) - l0, dh = dbAt(half, 5000) - h0;
  check('gain 1.0 → 0.5 = -6 dB', Math.abs(dl + 6) < 0.3, `${dl.toFixed(2)} dB`);
  check('다른 트랙은 그대로', Math.abs(dh) < 0.3, `${dh.toFixed(2)} dB`);
  DAW.tracks[0].params.volume = 1.0;

  console.log('\n⑤ 보컬 스트립은 mute/gain을 무시하는가 (사용자 확정 2026-09-07)');
  DAW.tracks[0].params.mute = true; DAW.tracks[0].params.volume = 0.25;
  DAW._specCache = {};
  const strip = DAW.computeTrackSpectrum('low');
  check('mute+gain에도 곡선이 그대로', near(peakF(strip), 100) && strip.length === 150,
        `피크 ${peakF(strip).toFixed(0)} Hz, ${strip.length}점`);
  DAW.tracks[0].params.mute = false; DAW.tracks[0].params.volume = 1.0;

  console.log('\n⑥ 레이트가 섞여도 되는가 — v2.4.9 결함이 구조적으로 불가능한지');
  // bounce는 44.1kHz로 강제 렌더되므로(제안.md ②) 실제로 섞인다.
  DAW.tracks = [tone('a48k', 440, 48000, SECS), tone('b44k', 440, 44100, SECS)];
  DAW._specCache = {};
  check('48k + 44.1k 혼재', near(peakF(drain(DAW)), 440), `피크 ${peakF(drain(DAW)).toFixed(0)} Hz`);
  DAW.tracks = [tone('b44k', 440, 44100, SECS)];
  DAW._specCache = {};
  check('44.1k 단독', near(peakF(drain(DAW)), 440), `피크 ${peakF(drain(DAW)).toFixed(0)} Hz`);

  console.log('\n⑦ 내용이 바뀌면 다시 계산하는가 (제안.md P-1 · B-StripSpec-Stale)');
  DAW.tracks = [tone('t', 100, SR, SECS)];
  DAW._specCache = {};
  const before = peakF(drain(DAW));
  // 길이는 그대로 두고 내용만 교체 = De-noise 프린트. 옛 캐시 키가 놓치던 바로 그 경우.
  DAW.tracks[0].buffer = tone('t', 5000, SR, SECS).buffer;
  DAW.tracks[0].audioRev = 2;
  const after = peakF(drain(DAW));
  check('길이 같고 내용만 바뀐 경우', near(before, 100) && near(after, 5000),
        `${before.toFixed(0)} Hz → ${after.toFixed(0)} Hz`);

  console.log('\n⑧ 녹음 중에는 재구축하지 않는가 — 안 그러면 영원히 안 끝난다');
  DAW.tracks[0].recording = true;
  DAW.tracks[0].audioRev = 3;   // recordingPeaks 배치가 올리는 것을 흉내
  check('직전 스펙트럼을 유지', near(peakF(DAW.computeSpectrum()), 5000),
        `피크 ${peakF(DAW.computeSpectrum()).toFixed(0)} Hz`);
  DAW.tracks[0].recording = false;

  console.log('\n⑨ 보컬 스트립은 1회 호출로 완성되는가 — 부분 곡선이 남으면 안 된다');
  DAW.tracks = [tone('vox', 300, 48000, SECS)];
  DAW._specCache = {};
  const one = DAW.computeTrackSpectrum('vox');
  const e = DAW._specCache['vox'];
  check('done=true', e && e.done === true && near(peakF(one), 300),
        `프레임 ${e ? e.count : 0}개, 피크 ${peakF(one).toFixed(0)} Hz`);

  console.log('\n⑩ 오디오가 없는 트랙을 건너뛰는가');
  DAW.tracks = [tone('ok', 440, SR, SECS),
                { id: 'empty', params: { volume: 1 }, buffer: null, audioRev: 1 },
                { id: 'ph', params: { volume: 1 }, needsAudio: true, audioRev: 1,
                  buffer: tone('x', 440, SR, SECS).buffer }];
  DAW._specCache = {};
  let threw = null;
  try { drain(DAW); } catch (err) { threw = err; }
  check('buffer=null · needsAudio를 건너뛴다', !threw, threw ? threw.message : '예외 없음');
}

// ── 시간 계측 ───────────────────────────────────────────────────────────────
function timing() {
  console.log('\n\n프레임 예산 계측 — 실제 프로젝트 크기\n');
  console.log('⚠️ computeSpectrum()은 app.jsx의 매 프레임 상태 푸시에서 불리고,');
  console.log('   믹서와 Advanced 창이 둘 다 열려 있으면 프레임당 2회다.');
  console.log('   따라서 "호출당 x2"가 60fps 예산 16.7 ms 안에 들어야 한다.\n');
  for (const [sr, secs, ntr, label] of [
    [96000, 300, 8, '5분 · 96kHz · 8트랙  (집 PC — 가장 무거움)'],
    [48000, 300, 8, '5분 · 48kHz · 8트랙  (회사 PC)'],
    [96000, 120, 4, '2분 · 96kHz · 4트랙'],
  ]) {
    const DAW = loadEngine();
    DAW.tracks = [];
    for (let i = 0; i < ntr; i++) DAW.tracks.push(tone('t' + i, 200 + i * 300, sr, secs));
    DAW._specCache = {}; DAW._spectrum = null;
    const ds = [];
    for (let k = 0; k < 20000; k++) {
      const t0 = now(); DAW.computeSpectrum(); ds.push(now() - t0);
      if (DAW.tracks.every((t) => DAW._specCache[t.id] && DAW._specCache[t.id].done)) break;
    }
    // 첫 호출은 fft의 최초 JIT 컴파일이라 세션당 한 번뿐이다(옛 코드도 냈던 비용).
    const first = ds[0];
    const rest = ds.slice(1).sort((a, b) => a - b);
    const q = (x) => rest[Math.min(rest.length - 1, Math.floor(rest.length * x))];
    console.log(label);
    console.log(`  구축 ${ds.length}회 호출 → 60fps에서 약 ${(ds.length / 60).toFixed(1)}초에 걸쳐 곡선이 선명해진다`);
    console.log(`  첫 호출 ${first.toFixed(1)} ms (fft 최초 JIT — 세션당 1회)`);
    console.log(`  이후    중앙 ${q(0.5).toFixed(1)} ms · p95 ${q(0.95).toFixed(1)} ms · 최대 ${rest[rest.length - 1].toFixed(1)} ms`);
    console.log(`  창 2개 동시 p95 ${(q(0.95) * 2).toFixed(1)} ms  vs 예산 16.7 ms`);
    const t1 = now();
    for (let k = 0; k < 200; k++) { DAW.tracks[0].params.volume = 0.5 + (k % 10) / 20; DAW.computeSpectrum(); }
    console.log(`  완성 후 gain 드래그 1프레임 ${((now() - t1) / 200).toFixed(3)} ms\n`);
  }
}

if (runFn) functional();
if (runTime) timing();
if (runFn) {
  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'} — ${pass}건 통과, ${fail}건 실패`);
  process.exit(fail === 0 ? 0 : 1);
}
