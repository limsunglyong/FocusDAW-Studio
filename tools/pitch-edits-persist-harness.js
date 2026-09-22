/* ============================================================================
 * pitch-edits-persist-harness.js — Stage D 편집의 모델·지속 회귀선 (v2.7.0)
 *
 * 무엇을 지키는가
 *   ① 기본값은 저장되지 않는다 (설계 §4-1). target 은 세그멘터가 Math.round(midi) 로
 *      자동으로 채우므로, 전부 저장하면 "사용자가 지정한 값"과 "검출값의 반올림"을
 *      영영 구분할 수 없다.
 *   ② edits[] 가 새 세그멘테이션에 시간 겹침으로 다시 붙는다.
 *   ③ 🔴 저장(exportProject → importProject) 을 건너 살아남는다.
 *   ④ 🔴 Undo 스냅샷(getSnapshot → applySnapshot) 을 건너 살아남는다.
 *   ⑤ (v2.7.1) 드래그·Reset 이 편집을 다시 쓸 때 — 한 음이 쪼개진 형제 조각을 조용히 되돌리지
 *      않고, 다른 구간에서 재부착된 편집을 두 개로 겹쳐 남기지 않는다.
 *   ⑥ (v2.7.1 → v2.7.2) 움직인 노트 색(적색 팔레트, 테마별 선택)이 10개 테마 모두에서 배경 대비
 *      3.0 이상이고, 곡선(--red)·기존 노트(--amber)와 거리 60 이상 떨어진다. 고정 짙은 적색은
 *      solar 에서 배경 대비 1.21, sage 에서 곡선과 대비 1.03 이었다.
 *
 * ③④가 이 하네스의 존재 이유다 — v2.7.0 착수 조사에서 `_serializedClips` 가
 * `clip.pitch` 를 **통째로 빠뜨리고 있었다**는 것을 발견했다. _normalizeClip 은 Stage A
 * 부터 pitch 를 실어 날랐지만, exportProject 와 getSnapshot 이 둘 다 쓰는 그 직렬화기가
 * 복사하지 않아 저장에서도 Undo 에서도 조용히 사라지고 있었다. Stage D 이전에는 아무도
 * clip.pitch 에 쓰지 않아 드러나지 않았을 뿐이다.
 *
 * 실행: node tools/pitch-edits-persist-harness.js   (실패 시 종료 코드 1)
 *   변이 시험: node tools/pitch-edits-persist-harness.js --mutate
 *   → _serializedClips 의 pitch 블록을 빼고 돌린다. ③④가 FAIL 해야 하네스가 진짜다.
 * ==========================================================================*/

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NL_ = String.fromCharCode(10);
const MUTATE = process.argv.includes('--mutate');
// v2.7.1 — 편집 모델 쪽 변이: 형제 조각 보존 루프를 빼고, 색 선택을 '첫 후보 고정'으로 바꾼다.
// ⑤의 형제 검사 2건과 ⑥의 테마 검사가 FAIL 해야 하네스가 진짜다.
const MUTATE_EDITS = process.argv.includes('--mutate-edits');
// v2.7.3 — 직렬화에서 `defaults` 만 정확히 떼어 낸다. --mutate 는 pitch 블록을 통째로
// 지우므로 "defaults 줄이 정말 일을 하는가"는 증명하지 못한다. ⑦이 FAIL 해야 정상.
const MUTATE_DEFAULTS = process.argv.includes('--mutate-defaults');
// v2.7.5 — 소유 구간 스플라이스를 무력화한다(경계를 덮지 않고 세그멘터 결과를 그대로 둔다).
// ⑨가 FAIL 해야 정상.
const MUTATE_LAYOUT = process.argv.includes('--mutate-layout');

// ── 가짜 Web Audio (bounce-source-harness.js 와 같은 최소 스텁) ─────────────
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
  // ⚠️ 작업본이 CRLF다 — vm에 넣기 전에 제거한다(앱개발.md). 안 하면 아래 변이 패치가
  // 조용히 빗나가서 "변이했는데도 통과"라는 가짜 안심을 준다.
  let src = fs.readFileSync(path.join(ROOT, 'audio-engine.js'), 'utf8').replace(/\r/g, '');
  if (MUTATE) {
    const before = src.length;
    src = src.replace(
      /\n *pitch: c\.pitch \? \{[\s\S]*?\n *\} : null,\n/,
      '\n'
    );
    if (src.length === before) { console.error('변이 실패 — _serializedClips 의 pitch 블록을 못 찾았다.'); process.exit(2); }
  }
  if (MUTATE_DEFAULTS) {
    // 🔴 줄 전체가 그 필드인 경우만. clip.pitch 초기화 줄에도 같은 글자가 있고, 그 줄까지
    // 지우면 변이가 아니라 크래시가 된다 (clip.pitch 가 영영 null).
    const L = src.split(NL_), keep = L.filter((x) => x.trim().indexOf('defaults: pitchDefaults(') !== 0);
    if (keep.length === L.length) { console.error('변이 실패 — defaults 직렬화 줄을 못 찾았다.'); process.exit(2); }
    src = keep.join(NL_);
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

// ── 에디터 쪽 편집 모델을 build 산출물에서 떼어 온다 ───────────────────────
function loadEditModel() {
  const file = path.join(ROOT, 'build', 'pitch-editor-app.js');
  if (!fs.existsSync(file)) { console.error('먼저 `npm run build:renderers`.'); process.exit(2); }
  let src = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  if (MUTATE_EDITS) {
    const before = src;
    src = src.replace(/  for \(const nt of notes\) \{\n    if \(ids\.has\(nt\.id\) \|\| peIsPristine\(nt, defs\)\) continue;\n[\s\S]*?\n  \}\n/, '');
    const mid = src;
    src = src.replace('return best || any;', 'return cands[0] || null;');
    if (mid === before || src === mid) { console.error('편집 모델 변이 실패 — 패턴을 못 찾았다.'); process.exit(2); }
  }
  if (MUTATE_LAYOUT) {
    const before = src;
    // peApplyLayout 이 곧장 원본을 돌려주게 만든다 = 소유 구간이 무시된다.
    src = src.replace('const src = notes || [];', 'const src = notes || []; if (1) return { notes: src, spans: 0 };');
    if (src === before) { console.error('변이 실패 — peApplyLayout 진입부를 못 찾았다.'); process.exit(2); }
  }
  // v2.7.3 — 끝 경계가 `function peScalePcs` 에서 `const peCentsOff =` 로 옮겨졌다.
  // Key 스냅 함수가 peScalePcs 를 쓰므로, 의존하는 것에서 창이 끝날 수 없었다.
  // ⚠️ 경계는 반드시 코드다 — esbuild 가 build 산출물에서 주석을 지운다.
  const a = src.indexOf('const peClamp ='), b = src.indexOf('const peCentsOff =');
  if (a < 0 || b < 0) { console.error('편집 모델 블록을 못 찾았다.'); process.exit(2); }
  const ctx = { Math, Array, console, JSON, Number };
  vm.createContext(ctx);
  vm.runInContext(src.slice(a, b) +
    '\nthis.peApplyEdits = peApplyEdits; this.peEditsFromNotes = peEditsFromNotes;' +
    '\nthis.peIsPristine = peIsPristine; this.PE_TUNING = PE_TUNING;' +
    '\nthis.peRewriteEdits = peRewriteEdits; this.pePickEditedColor = pePickEditedColor;' +
    '\nthis.PE_EDITED_REDS = PE_EDITED_REDS; this.PE_EDITED_MIN_CONTRAST = PE_EDITED_MIN_CONTRAST;' +
    '\nthis.peScalePcs = peScalePcs; this.peSnapToScale = peSnapToScale; this.peDragTarget = peDragTarget;' +
    '\nthis.peDefaults = peDefaults; this.PE_DEFAULTS = PE_DEFAULTS;' +
    '\nthis.PE_MIN_NOTE_FLOOR = PE_MIN_NOTE_FLOOR;', ctx);
  return ctx;
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

// ══ 시작 ═══════════════════════════════════════════════════════════════════
console.log(`\nStage D 편집 모델·지속 회귀선${MUTATE ? '  [변이: _serializedClips 의 pitch 제거]' : ''}${MUTATE_EDITS ? '  [변이: 형제 보존 제거 · 색 고정]' : ''}${MUTATE_DEFAULTS ? '  [변이: defaults 직렬화 제거]' : ''}${MUTATE_LAYOUT ? '  [변이: 소유 구간 스플라이스 무력화]' : ''}\n`);

const E = loadEditModel();

// ── ① 기본값은 저장되지 않는다 ─────────────────────────────────────────────
console.log('① 기본값은 edits[] 에 들어가지 않는다 (설계 §4-1)');
const pristine = { id: 'n1', t0: 0, t1: 1, midi: 60.2, target: 60, strength: 1, keepVibrato: true };
const edited   = { id: 'n2', t0: 1, t1: 2, midi: 62.4, target: 64, strength: 1, keepVibrato: true };
const weakened = { id: 'n3', t0: 2, t1: 3, midi: 65.1, target: 65, strength: 0.5, keepVibrato: true };
check('검출 그대로인 노트는 pristine', E.peIsPristine(pristine) === true);
check('target 을 바꾼 노트는 pristine 아님', E.peIsPristine(edited) === false);
check('strength 만 바꿔도 pristine 아님', E.peIsPristine(weakened) === false);
const derived = E.peEditsFromNotes([pristine, edited, weakened]);
check('edits[] 에는 손댄 2개만 들어간다', derived.length === 2, `${derived.length}개`);
check('기본값 노트의 구간은 들어가지 않는다', !derived.some((e) => e.t0 === 0), JSON.stringify(derived.map((e) => e.t0)));

// ── ② 재부착 ───────────────────────────────────────────────────────────────
console.log('\n② edits[] 가 새 세그멘테이션에 시간 겹침으로 다시 붙는다');
const fresh = [
  { id: 'a', t0: 0.00, t1: 0.50, midi: 60.1, target: 60, strength: 1, keepVibrato: true },
  { id: 'b', t0: 0.55, t1: 1.10, midi: 62.2, target: 62, strength: 1, keepVibrato: true },
  { id: 'c', t0: 1.20, t1: 1.80, midi: 64.0, target: 64, strength: 1, keepVibrato: true },
];
const r1 = E.peApplyEdits(fresh, [{ t0: 0.55, t1: 1.10, target: 65, strength: 0.7, keepVibrato: false }], E.PE_TUNING.reattachTau);
check('겹치는 노트에 값이 적용된다', r1.notes[1].target === 65 && r1.notes[1].strength === 0.7 && r1.notes[1].keepVibrato === false);
check('다른 노트는 그대로', r1.notes[0].target === 60 && r1.notes[2].target === 64);
check('원본 배열은 변하지 않는다 (React state 규칙)', fresh[1].target === 62);
check('missed = 0', r1.missed === 0, String(r1.missed));
// 경계가 옮겨간 경우 — 노트가 둘로 쪼개지면 양쪽에 붙는다(의도된 동작)
const split = [
  { id: 'b1', t0: 0.55, t1: 0.82, midi: 62.2, target: 62, strength: 1, keepVibrato: true },
  { id: 'b2', t0: 0.83, t1: 1.10, midi: 62.3, target: 62, strength: 1, keepVibrato: true },
];
const r2 = E.peApplyEdits(split, [{ t0: 0.55, t1: 1.10, target: 65, strength: 1, keepVibrato: true }], E.PE_TUNING.reattachTau);
check('한 음이 쪼개지면 양쪽에 적용된다', r2.notes[0].target === 65 && r2.notes[1].target === 65);
// 붙을 데가 없는 편집은 세어서 알린다
const r3 = E.peApplyEdits(fresh, [{ t0: 9.0, t1: 9.5, target: 70, strength: 1, keepVibrato: true }], E.PE_TUNING.reattachTau);
check('붙을 노트가 없으면 missed 로 센다', r3.missed === 1, String(r3.missed));
check('τ 가 파라미터다 (고정값이 아니다)', E.peApplyEdits(fresh, [{ t0: 0.40, t1: 1.40, target: 70, strength: 1, keepVibrato: true }], 0.9).missed === 1
   && E.peApplyEdits(fresh, [{ t0: 0.40, t1: 1.40, target: 70, strength: 1, keepVibrato: true }], 0.1).missed === 0,
   `기본 τ=${E.PE_TUNING.reattachTau}`);

// ── ③④ 엔진 왕복 ──────────────────────────────────────────────────────────
console.log('\n③ 저장 → 재열기를 건너 살아남는가  (🔴 _serializedClips 구멍)');
const DAW = loadEngine();
const tr = DAW.addBounceTrack('Vox', tone(48000, 4, 220), { fileName: 'Vox.wav', filePath: '/x/Vox.wav' });
const cid = tr.clips[0].id;
const EDITS = [
  { t0: 0.50, t1: 1.20, target: 64, strength: 0.8, keepVibrato: false },
  { t0: 2.00, t1: 2.60, target: 67, strength: 1, keepVibrato: true },
];
check('setClipPitchEdits 가 받는다', DAW.setClipPitchEdits(tr.id, cid, EDITS) === true);
check('clip.pitch.edits 에 저장된다', (tr.clips[0].pitch.edits || []).length === 2);
check('clipAudioInfo 가 에디터로 실어 보낸다',
      ((DAW.clipAudioInfo(tr.id, cid, 100) || {}).pitch || {}).edits?.length === 2);

const json = JSON.parse(JSON.stringify(DAW.exportProject('T')));
const ser = json.tracks[0].clips[0];
check('exportProject 결과에 pitch 가 있다', !!ser.pitch, ser.pitch ? 'ok' : '🔴 직렬화에서 빠졌다');
check('exportProject 결과에 edits 2건', (ser.pitch && ser.pitch.edits || []).length === 2);

DAW.importProject(json);
const rt = DAW.tracks[0];
const rEd = ((rt.clips[0] || {}).pitch || {}).edits || [];
check('importProject 후 edits 2건', rEd.length === 2, `${rEd.length}건`);
check('값이 그대로', rEd[0] && rEd[0].target === 64 && rEd[0].strength === 0.8 && rEd[0].keepVibrato === false,
      rEd[0] ? JSON.stringify(rEd[0]) : 'none');

console.log('\n④ Undo 스냅샷을 건너 살아남는가  (🔴 같은 구멍)');
// ⚠️ 스냅샷을 JSON 복제하면 안 된다 — getSnapshot 은 실제 AudioBuffer 를 그대로 들고
// 있고, 복제하면 applySnapshot 의 computePeakLevels 가 getChannelData 를 잃는다.
// clips 는 _serializedClips 가 이미 새 객체로 내주므로 복제할 이유도 없다.
const snap = DAW.getSnapshot();
const sEd = ((snap.tracks[0].clips[0] || {}).pitch || {}).edits || [];
check('getSnapshot 에 edits 2건', sEd.length === 2, `${sEd.length}건`);
DAW.setClipPitchEdits(DAW.tracks[0].id, DAW.tracks[0].clips[0].id, []);
check('지운 뒤에는 0건', (DAW.tracks[0].clips[0].pitch.edits || []).length === 0);
DAW.applySnapshot(snap);
const uEd = ((DAW.tracks[0].clips[0] || {}).pitch || {}).edits || [];
check('applySnapshot 으로 되돌아온다', uEd.length === 2, `${uEd.length}건`);

// ── ⑤ 편집 다시 쓰기 (v2.7.1) ─────────────────────────────────────────────
console.log('\n⑤ 드래그·Reset 이 편집을 다시 쓴다 (peRewriteEdits)');
{
  const tau = E.PE_TUNING.reattachTau;
  // 한 음(0.5~1.1초, 원래 편집 target 65)이 NOTES 변경으로 두 조각 p1·p2 로 쪼개진 상태
  const edits0 = [{ t0: 0.55, t1: 1.10, target: 65, strength: 1, keepVibrato: true }];
  const raw = [
    { id: 'p0', t0: 0.00, t1: 0.50, midi: 60.1, target: 60, strength: 1, keepVibrato: true },
    { id: 'p1', t0: 0.55, t1: 0.82, midi: 62.2, target: 62, strength: 1, keepVibrato: true },
    { id: 'p2', t0: 0.83, t1: 1.10, midi: 62.3, target: 62, strength: 1, keepVibrato: true },
  ];
  const view = E.peApplyEdits(raw, edits0, tau).notes;          // 화면: p1·p2 둘 다 65
  // p1 만 한 칸 더 올린다
  const up = E.peRewriteEdits(view, edits0, new Set(['p1']), (nt) => ({ ...nt, target: nt.target + 1 }), tau);
  const after = E.peApplyEdits(raw, up, tau).notes;
  check('끈 조각(p1)은 66', after[1].target === 66, String(after[1].target));
  check('🔴 형제 조각(p2)은 65 그대로 — 조용히 되돌아가지 않는다', after[2].target === 65, String(after[2].target));
  check('손대지 않은 노트(p0)는 그대로', after[0].target === 60);
  // p1 만 Reset
  const rs = E.peRewriteEdits(after, up, new Set(['p1']), () => null, tau);
  const afterReset = E.peApplyEdits(raw, rs, tau).notes;
  check('Reset 한 조각(p1)은 검출값 62', afterReset[1].target === 62, String(afterReset[1].target));
  check('Reset 해도 형제(p2)는 65 유지', afterReset[2].target === 65, String(afterReset[2].target));
  // 원래 음높이로 되돌리면 저장 목록에서 빠진다
  const back = E.peRewriteEdits(view, edits0, new Set(['p1', 'p2']), (nt) => ({ ...nt, target: Math.round(nt.midi) }), tau);
  check('검출값으로 되돌린 노트는 edits[] 에 남지 않는다', back.length === 0, JSON.stringify(back));
  // 다른 구간에서 재부착된 편집을 다시 끌면 겹친 두 편집이 남지 않는다 (v2.7.0 의 정확-일치 결함)
  const wide = [{ t0: 0.50, t1: 1.12, target: 64, strength: 1, keepVibrato: true }];
  const one = [{ id: 'q', t0: 0.55, t1: 1.10, midi: 62.0, target: 62, strength: 1, keepVibrato: true }];
  const v1 = E.peApplyEdits(one, wide, tau).notes;
  const re = E.peRewriteEdits(v1, wide, new Set(['q']), (nt) => ({ ...nt, target: nt.target + 1 }), tau);
  check('재부착된 편집을 다시 끌면 편집이 1건으로 정리된다', re.length === 1 && re[0].target === 65, JSON.stringify(re));
}

// ── ⑥ 움직인 노트 색 — 적색 팔레트, 10개 테마 (v2.7.2) ─────────────────────
console.log('\n⑥ 움직인 노트 색이 모든 테마에서 눈에 띄고 곡선·기존 노트와 구분된다');
{
  const html = fs.readFileSync(path.join(ROOT, 'pitch-editor.html'), 'utf8');
  const parse = (b) => { const o = {}; for (const m of b.matchAll(/--([a-z0-9-]+)\s*:\s*([^;}]+)/g)) o[m[1]] = m[2].trim(); return o; };
  const rs = html.indexOf(':root{');
  const root = parse(html.slice(rs, html.indexOf('}', rs)));
  const themes = { default: root };
  for (const m of html.matchAll(/:root\[data-theme="([a-z]+)"\]\{([^}]*)\}/g)) themes[m[1]] = Object.assign({}, themes[m[1]] || root, parse(m[2]));
  const hex = (x) => { x = x.replace('#', ''); if (x.length === 3) x = x.split('').map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
  const dist = (a, b) => Math.sqrt(a.reduce((acc, v, i) => acc + (v - b[i]) ** 2, 0));
  const lum = (c) => { const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  let n = 0, wCr = Infinity, wRed = Infinity, wAmb = Infinity, nCr = '', nRed = '', nAmb = '';
  for (const [name, t] of Object.entries(themes)) {
    if (!t.amber || !t.bg2 || !t.red) continue;
    const pick = E.pePickEditedColor(E.PE_EDITED_REDS, t.amber, t.red, t.bg2);
    if (!pick) { check(name + ': 색을 고르지 못함', false); continue; }
    n++;
    const c = hex(pick);
    const a = cr(c, hex(t.bg2)), dr = dist(c, hex(t.red)), da = dist(c, hex(t.amber));
    if (a < wCr) { wCr = a; nCr = name + ' ' + pick; }
    if (dr < wRed) { wRed = dr; nRed = name + ' ' + pick; }
    if (da < wAmb) { wAmb = da; nAmb = name + ' ' + pick; }
  }
  check('테마 ' + n + '개 전부에서 색을 골랐다', n >= 10, String(n));
  check('배경 대비 최악 ≥ ' + E.PE_EDITED_MIN_CONTRAST + ' (눈에 띈다)', wCr >= E.PE_EDITED_MIN_CONTRAST, wCr.toFixed(2) + ' (' + nCr + ')');
  check('🔴 곡선(--red)과 거리 최악 ≥ 60 (곡선에 묻히지 않는다)', wRed >= 60, wRed.toFixed(0) + ' (' + nRed + ')');
  check('기존 노트(--amber)와 거리 최악 ≥ 60', wAmb >= 60, wAmb.toFixed(0) + ' (' + nAmb + ')');
}

// ── ⑦ 클립 기본값 (v2.7.3) ────────────────────────────────────────────────
console.log('');
console.log('⑦ 클립 단위 기본값이 저장·스냅샷을 건너 살아남고, pristine 판정을 바꾼다');
{
  const D2 = loadEngine();
  const t2 = D2.addBounceTrack('Vox2', tone(48000, 3, 220), { fileName: 'V2.wav', filePath: '/x/V2.wav' });
  const c2 = t2.clips[0].id;

  // 구프로젝트 — defaults 를 한 번도 쓴 적 없는 클립.
  D2.setClipPitchEdits(t2.id, c2, [{ t0: 0.1, t1: 0.5, target: 64, strength: 1, keepVibrato: true }]);
  const d0 = t2.clips[0].pitch.defaults;
  check('defaults 를 안 써도 블록이 생긴다 (1 / true)', !!d0 && d0.strength === 1 && d0.keepVibrato === true,
        JSON.stringify(d0));

  check('setClipPitchDefaults 가 받는다', D2.setClipPitchDefaults(t2.id, c2, { strength: 0.5, keepVibrato: false }) === true);
  check('클립에 저장된다', t2.clips[0].pitch.defaults.strength === 0.5 && t2.clips[0].pitch.defaults.keepVibrato === false);
  // 🔴 엔진이 클램프한다 — 슬라이더가 0~100 이어도 메시지는 무엇이든 담아 올 수 있다.
  D2.setClipPitchDefaults(t2.id, c2, { strength: 1.7 });
  check('1 초과는 1 로 클램프', t2.clips[0].pitch.defaults.strength === 1, String(t2.clips[0].pitch.defaults.strength));
  D2.setClipPitchDefaults(t2.id, c2, { strength: -3 });
  check('음수는 0 으로 클램프', t2.clips[0].pitch.defaults.strength === 0, String(t2.clips[0].pitch.defaults.strength));
  D2.setClipPitchDefaults(t2.id, c2, { strength: 0.5, keepVibrato: false });

  check('clipAudioInfo 가 에디터로 실어 보낸다',
        (((D2.clipAudioInfo(t2.id, c2, 100) || {}).pitch || {}).defaults || {}).strength === 0.5);

  const j2 = JSON.parse(JSON.stringify(D2.exportProject('T2')));
  const sd = (j2.tracks[0].clips[0].pitch || {}).defaults;
  check('🔴 exportProject 결과에 defaults 가 있다', !!sd, sd ? JSON.stringify(sd) : '🔴 직렬화에서 빠졌다');
  check('값이 그대로', !!sd && sd.strength === 0.5 && sd.keepVibrato === false, JSON.stringify(sd));
  D2.importProject(j2);
  const rd = ((D2.tracks[0].clips[0] || {}).pitch || {}).defaults;
  check('importProject 후에도 그대로', !!rd && rd.strength === 0.5 && rd.keepVibrato === false, JSON.stringify(rd));

  const sn2 = D2.getSnapshot();
  const nd = ((sn2.tracks[0].clips[0] || {}).pitch || {}).defaults;
  check('🔴 getSnapshot 에 defaults 가 있다', !!nd && nd.strength === 0.5, nd ? JSON.stringify(nd) : '🔴 스냅샷에서 빠졌다');
  D2.setClipPitchDefaults(D2.tracks[0].id, D2.tracks[0].clips[0].id, { strength: 1, keepVibrato: true });
  D2.applySnapshot(sn2);
  const ud = ((D2.tracks[0].clips[0] || {}).pitch || {}).defaults;
  check('applySnapshot 으로 되돌아온다 (Undo)', !!ud && ud.strength === 0.5 && ud.keepVibrato === false, JSON.stringify(ud));

  // 🔴 이것이 기본값을 별도 필드로 둔 이유다 — 전역을 내려도 노트는 손대지 않은 것이다.
  const half = { strength: 0.5, keepVibrato: true };
  const nt = { id: 'x1', t0: 0, t1: 1, midi: 60.1, target: 60, strength: 0.5, keepVibrato: true };
  check('기본값이 0.5 면 strength 0.5 노트는 pristine', E.peIsPristine(nt, half) === true);
  check('기본값이 1 이면 같은 노트가 pristine 이 아니다', E.peIsPristine(nt, E.PE_DEFAULTS) === false);
  check('→ 기본값 0.5 에서는 저장되지 않는다', E.peEditsFromNotes([nt], half).length === 0);
  check('→ 기본값 1 에서는 저장된다', E.peEditsFromNotes([nt], E.PE_DEFAULTS).length === 1);
  check('peDefaults 가 없는 블록을 1 / true 로 읽는다',
        E.peDefaults(null).strength === 1 && E.peDefaults(null).keepVibrato === true);
  check('peDefaults 도 0~1 로 클램프', E.peDefaults({ strength: 9 }).strength === 1);

  // 🔴 세그멘터는 새 노트를 언제나 1 / true 로 찍는다. 기본값을 심지 않으면 기본값 0.5 인
  //    클립이 열리자마자 전 노트가 '사용자가 1 로 지정한 것'이 되어 저장되고 빨개진다.
  const fresh = [
    { id: 'f1', t0: 0, t1: 1, midi: 60.1, target: 60, strength: 1, keepVibrato: true },
    { id: 'f2', t0: 1, t1: 2, midi: 64.0, target: 64, strength: 1, keepVibrato: true },
  ];
  const seeded = E.peSeedDefaults(fresh, half);
  check('심은 뒤 노트가 클립 기본값을 갖는다', seeded.every((n) => n.strength === 0.5));
  check('🔴 그래서 pristine 이고 저장되지 않는다', E.peEditsFromNotes(seeded, half).length === 0,
        JSON.stringify(E.peEditsFromNotes(seeded, half)));
  check('심지 않으면 전부 저장된다 (이 검사가 지키는 것)', E.peEditsFromNotes(fresh, half).length === 2);
  check('원본 배열은 건드리지 않는다 (React state 규칙)', fresh[0].strength === 1);
  // 기본값을 심은 뒤에 편집을 얹는다 — 진짜 손댄 노트는 제 값을 지킨다.
  const withEdit = E.peApplyEdits(seeded, [{ t0: 1.0, t1: 2.0, target: 65, strength: 1, keepVibrato: true }], 0.25);
  check('편집이 얹힌 노트는 제 값 유지', withEdit.notes[1].strength === 1 && withEdit.notes[1].target === 65);
  check('나머지는 기본값 그대로', withEdit.notes[0].strength === 0.5);
}

// ── ⑧ Key 스냅 (v2.7.3) ───────────────────────────────────────────────────
console.log('');
console.log('⑧ Key 스냅 — 스케일 밖 음으로는 갈 수 없다');
{
  const C = E.peScalePcs('C');        // C D E F G A B
  const Am = E.peScalePcs('Am');      // A B C D E F G — 같은 건반, 다른 으뜸음
  check('C major 가 7음', C && C.size === 7, String(C && C.size));
  check('C# 는 C major 밖', !C.has(1));
  check('Am 도 7음이고 C# 는 밖', Am && Am.size === 7 && !Am.has(1));

  check('스케일 안의 음은 그대로', E.peSnapToScale(60, C, 0) === 60, String(E.peSnapToScale(60, C, 0)));
  // 61(C#) 은 60 과 62 에서 정확히 같은 거리 — 동률은 끄는 방향이 정한다.
  check('동률: 올리는 드래그는 위로 (61 → 62)', E.peSnapToScale(61, C, 1) === 62, String(E.peSnapToScale(61, C, 1)));
  check('동률: 내리는 드래그는 아래로 (61 → 60)', E.peSnapToScale(61, C, -1) === 60, String(E.peSnapToScale(61, C, -1)));
  check('방향이 없으면 위로 (Snap all)', E.peSnapToScale(61, C, 0) === 62, String(E.peSnapToScale(61, C, 0)));
  // 동률이 아닌 경우는 방향과 무관하게 가까운 쪽 — 66(F#) 은 65(F) 에 1, 67(G) 에 1... 동률.
  // 대신 분수 midi 로 본다: 60.6 은 60 에 0.6, 62 에 1.4.
  check('분수 midi 는 진짜 가까운 쪽으로 (60.6 → 60)', E.peSnapToScale(60.6, C, 0) === 60, String(E.peSnapToScale(60.6, C, 0)));
  check('61.4 → 62', E.peSnapToScale(61.4, C, 0) === 62, String(E.peSnapToScale(61.4, C, 0)));
  check('스케일이 없으면 반올림만', E.peSnapToScale(60.6, null, 0) === 61, String(E.peSnapToScale(60.6, null, 0)));

  const n60 = { target: 60, midi: 60.1 };
  check('Chromatic 은 줄 그대로 (+1 → 61)', E.peDragTarget(n60, 1, null) === 61, String(E.peDragTarget(n60, 1, null)));
  check('Key 는 스케일로 당긴다 (+1 → 62)', E.peDragTarget(n60, 1, C) === 62, String(E.peDragTarget(n60, 1, C)));
  check('Key, 아래로 (-1 → 59)', E.peDragTarget(n60, -1, C) === 59, String(E.peDragTarget(n60, -1, C)));

  // 🔴 여러 노트를 한 델타로 옮기면 안 된다 — 각자 제 자리에서 스케일로 간다.
  const a1 = { target: 60, midi: 60 }, a2 = { target: 64, midi: 64 };   // C, E
  const m1 = E.peDragTarget(a1, 1, C), m2 = E.peDragTarget(a2, 1, C);
  check('같은 +1 이어도 이동폭이 다르다 (C→D 2반음, E→F 1반음)',
        m1 - a1.target === 2 && m2 - a2.target === 1, `${m1 - a1.target} / ${m2 - a2.target}`);
  check('두 노트 모두 스케일 안', C.has(((m1 % 12) + 12) % 12) && C.has(((m2 % 12) + 12) % 12));

  // Snap all to key — 검출값에서 스냅하므로 두 번 눌러도 같다.
  const det = [60.1, 61.0, 62.4, 66.5, 70.2];
  const once = det.map((m) => E.peSnapToScale(m, C, 0));
  const twice = once.map((m) => E.peSnapToScale(m, C, 0));
  check('Snap all 결과가 전부 스케일 안', once.every((m) => C.has(((m % 12) + 12) % 12)), once.join(','));
  check('두 번 눌러도 같다 (멱등)', JSON.stringify(once) === JSON.stringify(twice), twice.join(','));
}

// ── ⑨ 분할 / 병합 — 소유 구간 (v2.7.5, 설계 §4-2) ─────────────────────────
console.log('');
console.log('⑨ 사용자가 정한 경계가 재분석을 이긴다');
{
  // 가짜 분석: 40 프레임 · hop 0.01 s · win 0.04 s. 앞 20개는 60, 뒤 20개는 64, 전부 유성.
  const an = { frames: 40, hopSec: 0.01, winSec: 0.04, midi: [], conf: [], voiced: [] };
  for (let k = 0; k < 40; k++) { an.midi.push(k < 30 ? 60 : 64); an.conf.push(0.9); an.voiced.push(true); }
  const D1 = E.PE_DEFAULTS;
  const mk = (id, t0, t1, m) => ({ id, t0, t1, midi: m, target: m, strength: 1, keepVibrato: true, confidence: 0.9 });
  // 🔴 저장된 midi 를 일부러 말이 안 되는 값(99)으로 둔다 — 합친 노트가 99 로 나오면
  //    코드가 분석이 아니라 저장값을 재활용하고 있다는 뜻이다.
  const segd = [mk('n1', 0.00, 0.22, 99), mk('n2', 0.22, 0.42, 99)];

  const merged = E.peApplyLayout(segd, [{ t0: 0.00, t1: 0.42, cuts: [] }], an, D1);
  check('병합하면 노트가 1개', merged.notes.length === 1, merged.notes.length + '개');
  check('소유 구간 수를 알려 준다 (화면 알림용)', merged.spans === 1, String(merged.spans));
  // 프레임 40개 중 30개가 60, 10개가 64 → 합친 구간의 중앙값은 60.
  // (중앙값은 평균이 아니다 — peCoreMedian 은 가운데 20~80% 의 median 을 고른다.)
  check('🔴 합친 음의 검출 음정을 분석에서 다시 계산한다', merged.notes[0] && merged.notes[0].midi === 60,
        merged.notes[0] ? String(merged.notes[0].midi) : 'none');
  check('🔴 저장된 값(99)을 재활용하지 않는다', merged.notes[0].midi !== 99, String(merged.notes[0].midi));
  check('target 도 다시 계산한 음정에서 나온다', merged.notes[0].target === 60, String(merged.notes[0].target));
  check('신뢰도도 그 구간에서 다시 낸다', Math.abs(merged.notes[0].confidence - 0.9) < 1e-9,
        String(merged.notes[0].confidence));
  check('경계가 구간 전체', merged.notes[0].t0 === 0 && merged.notes[0].t1 === 0.42);

  const split = E.peApplyLayout(segd, [{ t0: 0.00, t1: 0.22, cuts: [0.11] }], an, D1);
  check('분할하면 그 자리 노트가 2개로', split.notes.filter((x) => x.t0 < 0.22).length === 2,
        split.notes.map((x) => x.t0.toFixed(2)).join(','));
  check('건드리지 않은 노트는 그대로', split.notes.some((x) => x.id === 'n2'));

  // 🔴 요청의 핵심 — NOTES 를 바꿔 세그멘테이션이 4개로 달라져도 소유 구간은 그대로다.
  const recut = [mk('m1', 0.00, 0.10, 60), mk('m2', 0.10, 0.20, 60), mk('m3', 0.20, 0.30, 62), mk('m4', 0.30, 0.42, 64)];
  const kept = E.peApplyLayout(recut, [{ t0: 0.00, t1: 0.42, cuts: [] }], an, D1);
  check('🔴 재분할이 4개로 잘라도 소유 구간은 1개를 지킨다', kept.notes.length === 1, kept.notes.length + '개');

  const wide = [mk('w1', 0.00, 0.42, 62)];
  const trimmed = E.peApplyLayout(wide, [{ t0: 0.12, t1: 0.30, cuts: [] }], an, D1);
  check('걸친 노트가 양쪽으로 잘린다 (3개)', trimmed.notes.length === 3, trimmed.notes.length + '개');
  check('잘린 조각의 경계가 구간에 맞는다',
        Math.abs(trimmed.notes[0].t1 - 0.12) < 1e-9 && Math.abs(trimmed.notes[2].t0 - 0.30) < 1e-9,
        trimmed.notes.map((x) => x.t0.toFixed(2) + '~' + x.t1.toFixed(2)).join(' '));
  check('시간 순으로 돌려준다 (Shift 구간 선택이 배열 순서를 믿는다)',
        trimmed.notes.every((x, q, a) => q === 0 || a[q - 1].t0 <= x.t0));

  const sliver = E.peApplyLayout(wide, [{ t0: 0.03, t1: 0.42, cuts: [] }], an, D1);
  check('60 ms 미만 조각은 버린다', sliver.notes.length === 1, sliver.notes.length + '개');

  let LY = E.peLayoutPut([], 0.00, 0.22, 0.11, false);
  check('분할이 구간 하나를 만든다', LY.length === 1 && LY[0].cuts.length === 1, JSON.stringify(LY));
  LY = E.peLayoutPut(LY, 0.00, 0.42, null, true);
  check('🔴 병합이 흡수한 안쪽 경계를 지운다', LY.length === 1 && LY[0].cuts.length === 0, JSON.stringify(LY));
  check('흡수하면서 구간이 넓어진다', LY[0].t0 === 0 && LY[0].t1 === 0.42);
  LY = E.peLayoutPut(LY, 0.00, 0.42, 0.20, false);
  check('다시 분할하면 경계가 생긴다', LY[0].cuts.length === 1 && LY[0].cuts[0] === 0.20, JSON.stringify(LY));
  check('구간 밖 경계는 받지 않는다', E.peLayoutPut([], 0.1, 0.2, 0.5, false)[0].cuts.length === 0);

  check('Reset 이 걸친 구간을 통째로 놓는다 (설계 §4-2 ④)', E.peLayoutRelease(LY, 0.10, 0.30).length === 0);
  check('겹치지 않는 구간은 남는다', E.peLayoutRelease(LY, 1.0, 2.0).length === 1);

  const none = E.peApplyLayout(segd, [], an, D1);
  check('layout 이 비면 세그멘터 결과 그대로', none.notes === segd && none.spans === 0);
  const noAn = E.peApplyLayout(segd, [{ t0: 0, t1: 0.42, cuts: [] }], null, D1);
  check('분석이 없으면 손대지 않는다', noAn.notes === segd && noAn.spans === 0);
}

// ── ⑩ 소유 구간의 저장 왕복 (v2.7.5) ──────────────────────────────────────
console.log('');
console.log('⑩ layout[] 이 저장·스냅샷을 건너 살아남는다');
{
  const D3 = loadEngine();
  const t3 = D3.addBounceTrack('Vox3', tone(48000, 3, 220), { fileName: 'V3.wav', filePath: '/x/V3.wav' });
  const c3 = t3.clips[0].id;
  const LAY = [{ t0: 0.5, t1: 1.5, cuts: [1.0] }, { t0: 2.0, t1: 2.8, cuts: [] }];
  check('setClipPitchLayout 이 받는다', D3.setClipPitchLayout(t3.id, c3, LAY) === true);
  check('클립에 저장된다', (t3.clips[0].pitch.layout || []).length === 2);

  // 🔴 엔진이 정리한다 — 뒤집힌 구간과 구간 밖 경계는 받지 않는다.
  D3.setClipPitchLayout(t3.id, c3, [{ t0: 1, t1: 0.5, cuts: [] }, { t0: 0.5, t1: 1.5, cuts: [9, 1.0, 0.5] }]);
  const cl3 = t3.clips[0].pitch.layout;
  check('뒤집힌 구간은 버린다', cl3.length === 1, cl3.length + '개');
  check('구간 밖·경계 위의 cut 은 버린다', cl3[0].cuts.length === 1 && cl3[0].cuts[0] === 1.0, JSON.stringify(cl3[0].cuts));
  D3.setClipPitchLayout(t3.id, c3, LAY);

  check('clipAudioInfo 가 에디터로 실어 보낸다',
        (((D3.clipAudioInfo(t3.id, c3, 100) || {}).pitch || {}).layout || []).length === 2);
  const j3 = JSON.parse(JSON.stringify(D3.exportProject('T3')));
  const sl = (j3.tracks[0].clips[0].pitch || {}).layout;
  check('🔴 exportProject 결과에 layout 이 있다', !!sl && sl.length === 2, sl ? JSON.stringify(sl) : '🔴 직렬화에서 빠졌다');
  D3.importProject(j3);
  const rl = ((D3.tracks[0].clips[0] || {}).pitch || {}).layout || [];
  check('importProject 후에도 그대로', rl.length === 2 && rl[0].cuts[0] === 1.0, JSON.stringify(rl));

  const sn3 = D3.getSnapshot();
  const nl = ((sn3.tracks[0].clips[0] || {}).pitch || {}).layout || [];
  check('🔴 getSnapshot 에 layout 이 있다', nl.length === 2, nl.length + '개');
  D3.setClipPitchLayout(D3.tracks[0].id, D3.tracks[0].clips[0].id, []);
  check('지운 뒤에는 0건', (D3.tracks[0].clips[0].pitch.layout || []).length === 0);
  D3.applySnapshot(sn3);
  check('applySnapshot 으로 되돌아온다 (Undo)',
        (((D3.tracks[0].clips[0] || {}).pitch || {}).layout || []).length === 2);
}

// ── 마무리 ─────────────────────────────────────────────────────────────────
console.log(`\n${pass} PASS · ${fail} FAIL`);
if (MUTATE || MUTATE_EDITS || MUTATE_DEFAULTS || MUTATE_LAYOUT) {
  console.log(fail > 0
    ? '\n✅ 변이 시험 통과 — 수정을 빼면 하네스가 잡아낸다.'
    : '\n🔴 변이했는데도 전건 통과 — 이 하네스는 ③④를 실제로 지키지 못한다.');
  process.exit(fail > 0 ? 0 : 1);
}
process.exit(fail ? 1 : 0);
