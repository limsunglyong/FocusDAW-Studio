/* ============================================================
 * project-duration-harness.js — 프로젝트 타임라인 길이 회귀선 (v2.8.4)
 *
 * 지키는 것: **길이는 내용이 정한다.** 클립이 하나라도 있으면 그 끝이 프로젝트
 * 길이이고, 하한은 **아무것도 없을 때만** 쓴다.
 *
 * 🔴 이 결함은 한 번 고쳐졌다가 되살아난 적이 있다(B-Project-MinDuration) —
 *    v0.16.16 이 `addFileBuffer` 의 갈래로 고쳤는데, v1.17.15 의 새 함수
 *    `_projectClipDuration()` 이 `Math.max(DURATION, …)` 으로 하한을 도로 씌웠다.
 *    그래서 **같은 결함이 다시 들어오지 못하게** 하네스를 둔다.
 *
 *   node tools/project-duration-harness.js
 *   node tools/project-duration-harness.js --mutate   ← 하한을 되살린다. FAIL 이 정상.
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
  let src = fs.readFileSync(path.join(ROOT, 'audio-engine.js'), 'utf8').split(String.fromCharCode(13)).join('');
  if (MUTATE) {
    const before = src;
    // 하한을 되살린다 — 고쳐진 것이 다시 들어오는 모양 그대로.
    src = src.replace('return maxClipEnd > 0 ? maxClipEnd : PROJECT_MIN_SEC;',
                      'return Math.max(PROJECT_MIN_SEC, maxClipEnd);');
    if (src === before) { console.error('변이 실패 — _projectClipDuration 을 못 찾았다.'); process.exit(2); }
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
  return DAW;
}

const SR = 48000;
const buf = (secs) => { const b = new FakeCtx().createBuffer(1, Math.round(SR * secs), SR); return b; };
let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  —  ' + detail : ''}`);
};
const near = (a, b) => Math.abs(a - b) < 0.02;

console.log(`\n프로젝트 타임라인 길이 회귀선${MUTATE ? '  [변이: 16초 하한 부활]' : ''}\n`);

console.log('① 길이는 내용이 정한다');
{
  const D = loadEngine();
  check('init() 직후 데모가 있으면 16초 (데모 버퍼가 16초다)', near(D._projectClipDuration(), 16),
        D._projectClipDuration().toFixed(2) + 's · 데모 ' + D.tracks.filter(t => t.isDemo).length + '개');
  D.clearTracks();
  check('빈 프로젝트는 표시용 하한', near(D.duration, 16), D.duration.toFixed(2) + 's');

  // 🔴 이것이 사용자가 신고한 바로 그 경우다 — 11.9초 클립.
  D.addBounceTrack('A', buf(11.9), { fileName: 'A.wav', filePath: '/x/A.wav' });
  check('🔴 11.9초 클립 하나 → 11.90초 (16초로 늘어나지 않는다)', near(D.duration, 11.9),
        D.duration.toFixed(2) + 's');
  check('_projectClipDuration 도 같은 값', near(D._projectClipDuration(), 11.9),
        D._projectClipDuration().toFixed(2) + 's');
}

console.log('');
console.log('② 하한은 아무것도 없을 때만');
{
  const D = loadEngine(); D.clearTracks();
  D.addBounceTrack('S', buf(3.0), { fileName: 'S.wav', filePath: '/x/S.wav' });
  check('3초 클립 → 3.00초', near(D.duration, 3), D.duration.toFixed(2) + 's');
  D.addBounceTrack('L', buf(25.0), { fileName: 'L.wav', filePath: '/x/L.wav' });
  check('25초를 더하면 25.00초 (가장 긴 것이 정한다)', near(D.duration, 25), D.duration.toFixed(2) + 's');
}

console.log('');
console.log('③ 데모 세션은 그대로 16초 (별도 분기 없이)');
{
  const D = loadEngine(); D.clearTracks();
  D.addDemoTracks();
  check('데모만 있으면 16초', near(D._projectClipDuration(), 16), D._projectClipDuration().toFixed(2) + 's');
  D.addBounceTrack('A', buf(11.9), { fileName: 'A.wav', filePath: '/x/A.wav' });
  check('데모 + 11.9초 → 16초 (데모 오디오가 실제로 16초이므로 맞다)',
        near(D.duration, 16), D.duration.toFixed(2) + 's');
  D.addBounceTrack('B', buf(30.0), { fileName: 'B.wav', filePath: '/x/B.wav' });
  check('데모 + 30초 → 30초', near(D.duration, 30), D.duration.toFixed(2) + 's');
}

console.log('');
console.log('④ 저장·재열기·Undo 가 같은 답을 낸다 (경로마다 달랐던 것이 결함이었다)');
{
  const D = loadEngine(); D.clearTracks();
  D.addBounceTrack('A', buf(11.9), { fileName: 'A.wav', filePath: '/x/A.wav' });
  const j = JSON.parse(JSON.stringify(D.exportProject('P')));
  check('저장된 길이가 11.90', near(j.duration, 11.9), String(j.duration && j.duration.toFixed(2)));
  D.importProject(j);
  check('🔴 재열기 후에도 11.90 (여기가 16초로 돌아가던 자리)', near(D.duration, 11.9), D.duration.toFixed(2) + 's');

  const snap = D.getSnapshot();
  D.clearTracks();
  check('지우면 하한으로', near(D.duration, 16), D.duration.toFixed(2) + 's');
  D.applySnapshot(snap);
  check('Undo 로 되돌리면 11.90', near(D.duration, 11.9), D.duration.toFixed(2) + 's');

  // 🔴 옛 프로젝트 파일에는 16이 저장돼 있다 — 그것을 그대로 믿으면 안 된다.
  const old = JSON.parse(JSON.stringify(j)); old.duration = 16;
  D.importProject(old);
  check('🔴 저장된 길이가 16이어도 내용(11.9)이 이긴다', near(D.duration, 11.9), D.duration.toFixed(2) + 's');
}

console.log('');
console.log('⑤ 편집이 길이를 줄일 수 있다');
{
  const D = loadEngine(); D.clearTracks();
  const tr = D.addBounceTrack('A', buf(25.0), { fileName: 'A.wav', filePath: '/x/A.wav' });
  check('25초', near(D.duration, 25), D.duration.toFixed(2) + 's');
  // ⚠️ 클립 객체를 직접 고치면 안 된다 — 트랙의 **베이크된 버퍼**가 아직 25초라
  //    `_projectClipDuration` 이 그것을 센다. 앱이 쓰는 경로(trimClipEnd)를 써야
  //    재베이크까지 일어나 길이가 실제로 줄어든다.
  check('trimClipEnd 가 받는다', D.trimClipEnd(tr.id, tr.clips[0].id, 5) !== false);
  check('🔴 클립을 5초로 줄이면 5.00초 (하한에 걸리지 않는다)', near(D.duration, 5), D.duration.toFixed(2) + 's');
  check('트랙 버퍼도 함께 줄었다', near(tr.buffer.duration, 5), tr.buffer.duration.toFixed(2) + 's');
}

console.log(`\n${pass} PASS · ${fail} FAIL`);
if (MUTATE) {
  console.log(fail > 0 ? '\n✅ 변이 시험 통과 — 하한이 되살아나면 하네스가 잡아낸다.'
                       : '\n🔴 변이했는데도 전건 통과 — 이 하네스는 하한 부활을 막지 못한다.');
  process.exit(fail > 0 ? 0 : 1);
}
process.exit(fail ? 1 : 0);
