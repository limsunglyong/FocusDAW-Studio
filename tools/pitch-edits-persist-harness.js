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
// v2.9.3 — 드래그 한계를 무력화한다(peClampDrag 가 받은 폭을 그대로 돌려준다). ⑬이 FAIL 해야 정상.
const MUTATE_LIMIT = process.argv.includes('--mutate-limit');
const MUTATE_CTX = process.argv.includes('--mutate-ctx');   // v2.10.0 (R-3)
const MUTATE_WRAP = process.argv.includes('--mutate-wrap');  // v2.10.2 (B-PE-LastClipWrap)
const MUTATE_SNAPLIMIT = process.argv.includes('--mutate-snaplimit'); // v2.10.3 (Key 스냅 경고)
const MUTATE_RESETAUDIO = process.argv.includes('--mutate-resetaudio'); // v2.10.4 (Reset 이 소리까지)

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
  if (MUTATE_RESETAUDIO) {
    const before = src;
    // 모양이 비었을 때 revert 대신 print 를 고르게 만든다 = 보정 0 으로 PSOLA 를 다시 돌린다.
    src = src.replace('return hasShape ? "print" : "revert";', 'return "print";');
    if (src === before) { console.error('변이 실패 — pePostResetAction 을 못 찾았다.'); process.exit(2); }
  }
  if (MUTATE_SNAPLIMIT) {
    const before = src;
    // 옛 판정으로 되돌린다: 산술 한계에 **정확히** 닿았을 때만 경고. Key 스냅에서 한계
    // 안쪽의 조성 음에 갇히는 경우를 놓친다.
    src = src.replace('if (nt.target >= hi || nt.target <= lo) return true;',
                      'if (1) return nt.target === hi || nt.target === lo;');
    if (src === before) { console.error('변이 실패 — peAtShiftLimit 을 못 찾았다.'); process.exit(2); }
  }
  if (MUTATE_WRAP) {
    const before = src;
    // 옛 판정으로 되돌린다: "끝에 닿았는가". 되감긴 플레이헤드(음수)는 못 잡는다.
    src = src.replace('return Number.isFinite(pRel) && dur > 0 && pRel >= -1e-3 && pRel < dur - 1e-3;',
                      'return Number.isFinite(pRel) && dur > 0 && pRel < dur - 1e-3;');
    if (src === before) { console.error('변이 실패 — peInsideClip 을 못 찾았다.'); process.exit(2); }
  }
  if (MUTATE_CTX) {
    const before = src;
    // 선택 안을 우클릭해도 그 노트 하나만 대상이 되게 만든다 = 여러 개에 적용이 불가능해진다.
    src = src.replace('if (sel.has(noteId)) return { ids: new Set(sel), retarget: false };', '');
    if (src === before) { console.error('변이 실패 — peContextTarget 을 못 찾았다.'); process.exit(2); }
  }
  if (MUTATE_LIMIT) {
    const before = src;
    src = src.replace('function peClampDrag(notes, dSemi) {','function peClampDrag(notes, dSemi) { if (1) return dSemi;');
    if (src === before) { console.error('변이 실패 — peClampDrag 진입부를 못 찾았다.'); process.exit(2); }
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
    '\nthis.PE_MIN_NOTE_FLOOR = PE_MIN_NOTE_FLOOR; this.peShapeSig = peShapeSig; this.PE_PRESETS = PE_PRESETS; this.peMatchPreset = peMatchPreset;' +
    '\nthis.peShiftRange = peShiftRange; this.peClampDrag = peClampDrag; this.peAtShiftLimit = peAtShiftLimit; this.PE_MAX_SHIFT_SEMIS = PE_MAX_SHIFT_SEMIS; this.peContextTarget = peContextTarget; this.pePostResetAction = pePostResetAction; this.peLayoutRelease = peLayoutRelease; this.peInsideClip = peInsideClip; this.peShouldStopAtClip = peShouldStopAtClip; this.peTimeCells = peTimeCells;', ctx);
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
console.log(`\nStage D 편집 모델·지속 회귀선${MUTATE ? '  [변이: _serializedClips 의 pitch 제거]' : ''}${MUTATE_EDITS ? '  [변이: 형제 보존 제거 · 색 고정]' : ''}${MUTATE_DEFAULTS ? '  [변이: defaults 직렬화 제거]' : ''}${MUTATE_LAYOUT ? '  [변이: 소유 구간 스플라이스 무력화]' : ''}${MUTATE_LIMIT ? '  [변이: 드래그 한계 제거]' : ''}${MUTATE_CTX ? '  [변이: 우클릭이 선택을 무시]' : ''}${MUTATE_WRAP ? '  [변이: 되감김을 못 보는 옛 판정]' : ''}${MUTATE_SNAPLIMIT ? '  [변이: 산술 한계만 보는 옛 경고]' : ''}${MUTATE_RESETAUDIO ? '  [변이: 빈 모양에도 print]' : ''}\n`);

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

// ── ⑪ 프린트 지문 생성기 (v2.8.3) ─────────────────────────────────────────
// 🔴 Apply 를 "화면과 소리가 다를 때만" 켜는 근거가 이 함수다. 같은 모양에 같은 값을
//    주지 않으면 Apply 가 영영 켜진 채(v2.8.2 의 증상) 또는 영영 꺼진 채 남는다.
console.log('');
console.log('⑪ 프린트 지문은 같은 모양에 같은 값을 준다');
{
  const ed1 = [{ t0: 1.0, t1: 2.0, target: 64, strength: 0.8, keepVibrato: false }];
  const ed2 = [{ t0: 1.0, t1: 2.0, target: 64, strength: 0.8, keepVibrato: false }];
  const d = { strength: 1, keepVibrato: true };
  const ly = [{ t0: 0.5, t1: 1.5, cuts: [1.0] }];
  check('같은 내용이면 같은 지문', E.peShapeSig(ed1, d, ly) === E.peShapeSig(ed2, d, ly));
  check('값이 다르면 지문도 다르다',
        E.peShapeSig(ed1, d, ly) !== E.peShapeSig([{ ...ed1[0], target: 65 }], d, ly));
  check('강도가 다르면 지문도 다르다',
        E.peShapeSig(ed1, d, ly) !== E.peShapeSig([{ ...ed1[0], strength: 0.5 }], d, ly));
  check('비브라토가 다르면 지문도 다르다',
        E.peShapeSig(ed1, d, ly) !== E.peShapeSig([{ ...ed1[0], keepVibrato: true }], d, ly));
  check('클립 기본값이 다르면 지문도 다르다',
        E.peShapeSig(ed1, d, ly) !== E.peShapeSig(ed1, { strength: 0.5, keepVibrato: true }, ly));
  check('경계가 다르면 지문도 다르다',
        E.peShapeSig(ed1, d, ly) !== E.peShapeSig(ed1, d, [{ t0: 0.5, t1: 1.5, cuts: [] }]));
  check('🔴 빈 편집과 편집 있음이 구분된다 (되돌리기 판정의 근거)',
        E.peShapeSig([], d, []) !== E.peShapeSig(ed1, d, ly));
  // 🔴 부동소수 표기 흔들림에 휘둘리면 안 된다 — 같은 값인데 지문이 달라지면
  //    Apply 가 영영 켜진 채 남고, 그것이 v2.8.2 에서 사용자가 본 증상이다.
  check('미세한 표기 차이는 무시한다',
        E.peShapeSig([{ t0: 1.0000000001, t1: 2.0, target: 64, strength: 0.8, keepVibrato: false }], d, ly)
        === E.peShapeSig(ed1, d, ly));
  check('빈 입력도 값을 준다 (null 이 아니다)', typeof E.peShapeSig([], d, []) === 'string');
}


// ── ⑫ 보정 프리셋 (v2.9.0, 설계 §7) ───────────────────────────────────────
console.log('');
console.log('⑫ 프리셋이 설계가 정한 값을 그대로 낸다');
{
  const byId = {};
  for (const p of E.PE_PRESETS) byId[p.id] = p;
  check('프리셋이 셋이다', E.PE_PRESETS.length === 3, E.PE_PRESETS.map((p) => p.id).join(' · '));
  // 🔴 설계 §7 이 정한 값 — 여기가 어긋나면 이름과 소리가 따로 논다.
  check('Natural = 0.7 · 비브라토 유지', byId.natural && byId.natural.strength === 0.7 && byId.natural.keepVibrato === true);
  check('Tight   = 1.0 · 비브라토 유지', byId.tight && byId.tight.strength === 1.0 && byId.tight.keepVibrato === true);
  check('Hard    = 1.0 · 비브라토 미유지', byId.hard && byId.hard.strength === 1.0 && byId.hard.keepVibrato === false);
  check('모두 이름이 있다', E.PE_PRESETS.every((p) => p.label && p.tip));

  // 되짚기 — 지금 값이 어느 프리셋과 같은가
  check('0.7/유지 → natural', E.peMatchPreset(0.7, true) === 'natural');
  check('1.0/유지 → tight', E.peMatchPreset(1.0, true) === 'tight');
  check('1.0/미유지 → hard', E.peMatchPreset(1.0, false) === 'hard');
  check('🔴 어느 것과도 다르면 null (직접 만진 값)', E.peMatchPreset(0.5, true) === null);
  check('0.7/미유지도 null (조합이 프리셋에 없다)', E.peMatchPreset(0.7, false) === null);

  // 🔴 프리셋 값은 pristine 판정과도 맞아야 한다 — Tight 는 기본값과 같으므로
  //    그것만으로는 \"손댄 노트\"가 되지 않는다.
  const nt = { id: 'p1', t0: 0, t1: 1, midi: 60.1, target: 60, strength: 1.0, keepVibrato: true };
  check('Tight 값은 기본값과 같아 pristine 이다', E.peIsPristine(nt, E.PE_DEFAULTS) === true);
  const nat = { ...nt, strength: 0.7 };
  check('Natural 은 기본값과 달라 저장된다', E.peEditsFromNotes([nat], E.PE_DEFAULTS).length === 1);
}


// ── ⑬ 이동량 한계에서 드래그가 멈춘다 (v2.9.3, R-1) ─────────────────────────────
console.log('');
console.log('⑬ 드래그는 부른 음높이에서 ±6 에서 멈추고, 묶음은 함께 선다');
{
  const N = (id, midi, target) => ({ id, t0: 0, t1: 1, midi, target: target === undefined ? Math.round(midi) : target, strength: 1, keepVibrato: true });
  check('상한 상수는 6 (엔진 PSOLA_MAX_SEMIS 와 같음 — psola 하네스가 대조)', E.PE_MAX_SHIFT_SEMIS === 6);
  // 🔴 안 ② — 소수 midi 기준. 60.6 → 55..66 (처음 칸 61 에서 위로 5칸).
  const r = E.peShiftRange(N('a', 60.6));
  check('60.6 의 범위는 55..66', r.lo === 55 && r.hi === 66, r.lo + '..' + r.hi);
  const r0 = E.peShiftRange(N('b', 60));
  check('정수 60 은 54..66 (경계 포함)', r0.lo === 54 && r0.hi === 66, r0.lo + '..' + r0.hi);
  // 한 노트
  check('한 노트 +12 → +5 에서 멈춤 (60.6 → 66)', E.peClampDrag([N('a', 60.6)], 12) === 5);
  check('한 노트 −12 → −6 에서 멈춤 (61 → 55)', E.peClampDrag([N('a', 60.6)], -12) === -6);
  check('한계 안의 폭은 그대로', E.peClampDrag([N('a', 60.6)], 3) === 3 && E.peClampDrag([N('a', 60.6)], -2) === -2);
  check('이동 없음은 0', E.peClampDrag([N('a', 60.6)], 0) === 0);
  for (const m of [48.2, 55.5, 60, 60.49, 60.51, 71.9]) {
    const nt = N('x', m), up = E.peClampDrag([nt], 30), dn = E.peClampDrag([nt], -30);
    check(`🔴 ${m}: 끝까지 끌어도 |target−midi| ≤ 6`,
          Math.abs(nt.target + up - m) <= 6 + 1e-9 && Math.abs(nt.target + dn - m) <= 6 + 1e-9,
          (nt.target + up) + ' / ' + (nt.target + dn));
  }
  // 안 ① — 묶음 정지: 먼저 닿는 노트에서 전체가 선다 → 음정 간격 유지
  const g = [N('a', 60.0, 63), N('b', 64.0)];   // a 는 이미 +3 옮겨져 있다
  const d = E.peClampDrag(g, 10);
  check('🔴 묶음은 가장 먼저 닿는 노트(a, 여유 3)에서 함께 멈춘다', d === 3, String(d));
  check('묶음의 간격이 유지된다', (g[1].target + d) - (g[0].target + d) === g[1].target - g[0].target);
  check('아래로는 b 의 여유(6)와 a 의 여유(9) 중 작은 쪽', E.peClampDrag(g, -20) === -6);
  // 옛 파일 — 이미 한계 밖(+12)
  const old = N('o', 60, 72);
  check('한계 밖 노트는 바깥으로 더 못 간다', E.peClampDrag([old], 3) === 0);
  check('한계 밖 노트도 안쪽으로는 돌아온다', E.peClampDrag([old], -8) === -8);
  // Key 스냅이 한계를 넘지 않는다 — C major, 60.6 의 hi=66 (F#, 조성 밖) → 65 (F)
  const C = E.peScalePcs('C') || E.peScalePcs('C major');
  if (C) {
    const t = E.peDragTarget(N('a', 60.6, 64), 2, C);     // raw 66 → 스냅하면 67(G) 이 될 수 있다
    check('🔴 Key 스냅이 한계(66) 밖으로 끌어내지 않는다', t <= 66 && C.has(((t % 12) + 12) % 12), String(t));
  } else {
    check('peScalePcs 로 C 조성을 만들 수 있다', false, 'peScalePcs 의 입력 형식 확인 필요');
  }
  // 경고
  check('한계에 닿은 노트만 경고 대상', E.peAtShiftLimit(N('a', 60.6, 66)) && E.peAtShiftLimit(N('a', 60.6, 55)) && !E.peAtShiftLimit(N('a', 60.6, 65)));
  check('손대지 않은 노트는 경고 대상이 아니다', !E.peAtShiftLimit(N('a', 60.6)) && !E.peAtShiftLimit(N('b', 60.5)));
}


// ── ⑭ 우클릭이 무엇을 대상으로 삼는가 (v2.10.0 R-3) ─────────────────────────
//
// 메뉴 자체는 제스처라 하네스가 못 본다. 잴 수 있는 것은 **대상 판정**이고, 그것이 이
// 기능의 전부다: 선택 안을 우클릭하면 선택 전체, 선택 밖을 우클릭하면 그 하나.
console.log('\n⑭ 우클릭 대상 판정 (설계 — DAW 관례)');
{
  const sel3 = new Set(['a', 'b', 'c']);
  const inSel = E.peContextTarget('b', sel3);
  check('🔴 선택 안을 우클릭하면 선택 전체가 대상', inSel.ids.size === 3 && !inSel.retarget,
    inSel.ids.size + '개, retarget=' + inSel.retarget);
  const outSel = E.peContextTarget('z', sel3);
  check('🔴 선택 밖을 우클릭하면 그 노트만 대상이고 선택을 옮긴다',
    outSel.ids.size === 1 && outSel.ids.has('z') && outSel.retarget,
    outSel.ids.size + '개, retarget=' + outSel.retarget);
  const none = E.peContextTarget('q', new Set());
  check('선택이 없으면 우클릭한 노트 하나', none.ids.size === 1 && none.ids.has('q') && none.retarget);
  check('노트가 아닌 곳은 대상이 없다', E.peContextTarget(null, sel3).ids === null);
  // 원본 Set 을 돌려주면 메뉴가 열린 동안 선택이 바뀌면 대상도 따라 바뀐다 — 사본이어야 한다.
  const copy = E.peContextTarget('a', sel3);
  sel3.add('d');
  check('대상은 선택의 **사본** (메뉴가 열린 뒤 선택이 바뀌어도 대상은 그대로)',
    copy.ids.size === 3 && !copy.ids.has('d'), copy.ids.size + '개');
}

// ── ⑮ 배선 구조 검사 — R-3 · R-5 (v2.10.0) ─────────────────────────────────
//
// 판정이 옳아도 배선이 없으면 아무 일도 안 난다. 여기서는 build 산출물의 **구조**만 본다
// (native-handover 하네스가 게이트에 쓴 것과 같은 낮춘 형태).
console.log('\n⑮ 배선 — 우클릭 메뉴와 0 키가 실제로 연결되어 있다');
{
  const ed = fs.readFileSync(path.join(ROOT, 'build', 'pitch-editor-app.js'), 'utf8');
  check('롤에 onContextMenu 가 붙어 있다', /onContextMenu:\s*onCtx/.test(ed));
  check('우클릭이 peContextTarget 을 거친다', ed.includes('peContextTarget(noteId'));
  // ⚠️ v2.6.1 에서 같은 실수를 했다 — 버블 단계로 걸면 아래에서 stopPropagation 하는
  // 핸들러에 가려 메뉴가 안 닫힌 채로 남는다.
  check('🔴 바깥 클릭 리스너가 캡처 단계다', /addEventListener\("mousedown",\s*close,\s*true\)/.test(ed));
  check('🔴 Escape 도 캡처 단계 — 메뉴만 닫고 창은 안 닫는다',
    /addEventListener\("keydown",\s*onKey,\s*true\)/.test(ed));
  check('📌 상태줄 Reset 버튼은 남아 있다', ed.includes('onClick: resetSelected'));
  check('메뉴의 Reset 은 붙들고 있던 집합에 적용된다', ed.includes('resetIds(ctx.ids)'));
  // R-5 — NumLock 이 꺼져 있으면 숫자패드 0 은 `Insert` 로 온다. code 쪽이 진짜 판정이다.
  check('🔴 0 키를 code === "Numpad0" 로도 받는다 (NumLock 꺼짐)', ed.includes('"Numpad0"'));
  check('0 키가 클립 맨 앞으로 보낸다', /seekTo\(0\)/.test(ed));
  check('입력 칸 안에서는 0 을 가로채지 않는다',
    ed.includes('"TEXTAREA"') && ed.includes('isContentEditable'));
}

// ── ⑯ R-4 — 시간 표시 칩이 테마 토큰만 쓴다 ────────────────────────────────
//
// 하드코딩한 색을 쓰면 밝은 테마(ivory·sage)에서 글자가 사라진다. 여기서 확인하는 것은
// "이미 열 가지 테마에서 증명된 .pe-badge 와 **같은 토큰 세 벌**을 쓴다" 는 것이다.
console.log('\n⑯ 전송 시간 표시 (R-4)');
{
  const css = fs.readFileSync(path.join(ROOT, 'pitch-editor.html'), 'utf8');
  const rule = (name) => {
    const i = css.indexOf('.' + name + '{');
    return i < 0 ? null : css.slice(i, css.indexOf('}', i));
  };
  const time = rule('pe-time');
  check('.pe-time 규칙이 있다', !!time);
  if (time) {
    // 🔴 글자색은 --amber 가 **아니다**. 계측이 반증했다: amber 글자를 amber-soft 배경에
    // 얹으면 ivory 에서 대비 2.18 로, 큰 글씨 기준선(3.0)에도 못 미친다. 배경 알파를 올리면
    // 배경이 글자색으로 수렴하므로 더 나빠진다(0.6 에서 1.46). amber 는 **칩의 색**으로만
    // 두고 글자는 본문색(--cream, 최악 6.03)을 쓴다 — 시인성을 높이라는 요청 그대로다.
    check('🔴 글자색이 배경과 같은 계열이 아니다', /color:var\(--cream\)/.test(time), time);
    check('🔴 하드코딩한 색이 없다', !/#[0-9a-fA-F]{3,8}/.test(time));
    check('둥근 상자다', /border-radius:/.test(time));
    // v2.10.1 — 사용자 지정: Saira Condensed, 현재 시간 ExtraLight 200, 전체 길이 Thin 100
    // 에 현재 시간의 60~70% 크기.
    check('🔴 Saira Condensed 를 쓴다', /font-family:"Saira Condensed"/.test(time), time);
    const cur = rule('pe-time-cur'), tot = rule('pe-time-total');
    const px = (r) => { const m = r && /font-size:([0-9.]+)px/.exec(r); return m ? parseFloat(m[1]) : NaN; };
    const wt = (r) => { const m = r && /font-weight:([0-9]+)/.exec(r); return m ? parseInt(m[1], 10) : NaN; };
    check('현재 시간이 ExtraLight 200', wt(cur) === 200, String(wt(cur)));
    check('전체 길이가 Thin 100', wt(tot) === 100, String(wt(tot)));
    check('현재 시간이 예전(11.5px)보다 훨씬 크다', px(cur) >= 20, String(px(cur)));
    const ratio = px(tot) / px(cur);
    check('🔴 전체 길이가 현재 시간의 60~70%', ratio >= 0.6 && ratio <= 0.7, (ratio * 100).toFixed(0) + '%');
  }
  // 🔴 토큰 이름이 색을 보장하지 않는다(v2.4.4 — navy 는 --amber 와 --surface3 가 같은 색).
  // amber-soft 는 amber 를 ~16% 알파로 얹은 것이므로, **툴바 배경(--bg) 위에 합성한 뒤**
  // 글자(--amber)와의 대비를 재야 진짜 값이 나온다.
  {
    const parse = (b) => { const o = {}; for (const m of b.matchAll(/--([a-z0-9-]+)\s*:\s*([^;}]+)/g)) o[m[1]] = m[2].trim(); return o; };
    const rs = css.indexOf(':root{');
    const root = parse(css.slice(rs, css.indexOf('}', rs)));
    const themes = { default: root };
    for (const m of css.matchAll(/:root\[data-theme="([a-z]+)"\]\{([^}]*)\}/g)) themes[m[1]] = Object.assign({}, themes[m[1]] || root, parse(m[2]));
    const hex = (x) => { x = x.replace('#', ''); if (x.length === 3) x = x.split('').map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
    const rgba = (v) => { const m = /rgba?\(([^)]+)\)/.exec(v); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
    const over = (fg, a, bg) => fg.map((v, i) => v * a + bg[i] * (1 - a));
    const lum = (c) => { const g = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2]; };
    const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    let n = 0, worst = Infinity, worstName = '', worstBox = Infinity, worstBoxName = '';
    for (const [name, t] of Object.entries(themes)) {
      if (!t.amber || !t['amber-soft'] || !t.bg || !t.cream) continue;
      const soft = rgba(t['amber-soft']);
      if (!soft) { check(name + ': --amber-soft 를 못 읽었다', false, t['amber-soft']); continue; }
      n++;
      const bg = hex(t.bg);
      const box = over(soft.c, soft.a, bg);            // 칩 배경 = amber-soft over --bg
      const text = cr(hex(t.cream), box);              // 글자 대비 (--cream)
      const edge = cr(box, bg);                        // 칩이 툴바에서 떨어져 보이는가
      if (text < worst) { worst = text; worstName = name; }
      if (edge < worstBox) { worstBox = edge; worstBoxName = name; }
    }
    check('테마 ' + n + '개에서 칩 색을 계산했다', n >= 10, String(n));
    // 본문 기준선 4.5 를 쓴다 — 15px 은 WCAG large text(18.66px bold) 에 못 미치고,
    // 애초에 이 요청은 "시인성을 더욱 높인다" 였으므로 낮춘 기준선을 쓸 이유가 없다.
    check('🔴 글자 대비 최악 >= 4.5 (본문 기준선)', worst >= 4.5, worst.toFixed(2) + ' (' + worstName + ')');
    check('칩 배경이 툴바 배경과 구분된다 (대비 >= 1.05)', worstBox >= 1.05, worstBox.toFixed(3) + ' (' + worstBoxName + ')');
  }
  // v2.11.0 — 폰트가 로컬(assets/fonts/fonts.css)로 옮겨졌다. 창이 그 CSS 를 읽고, CSS 에
  // 100 · 200 두 웨이트가 모두 있고, 가리키는 파일이 실제로 있는지를 본다.
  {
    const fcss = fs.readFileSync(path.join(ROOT, 'assets', 'fonts', 'fonts.css'), 'utf8');
    const faces = [...fcss.matchAll(/@font-face\s*\{[^}]*\}/g)].map(m => m[0])
      .filter(b => /font-family:\s*'Saira Condensed'/.test(b));
    const has = (w) => faces.some(b => new RegExp('font-weight:\\s*' + w + ';').test(b));
    const files = faces.map(b => /url\(([^)]+)\)/.exec(b)[1]);
    const missing = files.filter(f => !fs.existsSync(path.join(ROOT, 'assets', 'fonts', f)));
    check('🔴 Saira Condensed 100/200 을 실제로 불러온다 (로컬)',
      /href="assets\/fonts\/fonts\.css"/.test(css) && has(100) && has(200) && files.length > 0 && !missing.length,
      missing.length ? 'missing ' + missing.join(', ') : faces.length + ' faces');
  }
  // 툴바 가운데 = 3칸 그리드. spacer 두 개로는 **가운데가 아니었다**(T-2.10.0-3 사용자 판정):
  // flex 여백은 좌우 내용의 폭 차이만큼 밀린다.
  const ed = fs.readFileSync(path.join(ROOT, 'build', 'pitch-editor-app.js'), 'utf8');
  const bar = rule('pe-toolbar');
  check('🔴 툴바가 3칸 그리드다', !!bar && /display:grid/.test(bar) && /grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\)/.test(bar), bar);
  check('왼쪽 칸이 긴 파일 이름에 밀리지 않는다 (min-width:0 · overflow)',
    /\.pe-tbar-left\{[^}]*min-width:0[^}]*overflow:hidden/.test(css));
  // 좌 · 중 · 우 세 칸이 이 **순서대로** 있어야 가운데 칸이 가운데에 온다.
  const iL = ed.indexOf('"pe-tbar-left"'), iT = ed.indexOf('"pe-time"'), iR = ed.indexOf('"pe-tbar-right"');
  check('🔴 좌 → 시간 → 우 순서다', iL >= 0 && iT > iL && iR > iT, iL + ' / ' + iT + ' / ' + iR);
  check('시간이 현재와 전체 두 벌로 나뉘어 있다',
    ed.includes('"pe-time-cur"') && ed.includes('"pe-time-total"'));
  // 🔴 전체 길이는 **클립 길이**여야 한다. 곡 전체 길이를 쓰면 요청과 정반대가 된다.
  check('🔴 전체 길이가 클립 길이(info.duration)다',
    /pe-time-total[^]{0,120}info\.duration/.test(ed), '클립 상대시간');
}

// ── ⑰ R-6 — New Project 가 확인을 거친다 ────────────────────────────────────
//
// Delete all tracks 는 처음부터 확인을 받았는데 New Project 는 **더 많은 것을 지우면서**
// 확인이 없었다(트랙 + 이름 + 경로 + Undo 이력).
console.log('\n⑰ New Project 확인 (R-6)');
{
  const app = fs.readFileSync(path.join(ROOT, 'build', 'app.js'), 'utf8');
  check('🔴 File ▸ New Project 가 곧장 newProject 로 가지 않는다',
    /onNew:\s*confirmNewProject/.test(app), '메뉴 배선');
  // ⚠️ esbuild 가 중괄호를 펴서 다시 쓰므로 원문 한 줄과의 문자열 일치로는 못 본다.
  const gi = app.indexOf('const confirmNewProject');
  const cg = gi < 0 ? '' : app.slice(gi, gi + 300);
  check('트랙이 하나라도 있으면 묻는다',
    cg.includes('DAW.tracks.length === 0') && cg.includes('newProject()') && cg.includes('setConfirmNew(true)'),
    gi < 0 ? 'confirmNewProject 가 없다' : '게이트 본문');
  check('확인 모달이 있다', app.includes('confirmNew &&') && app.includes('Start a new project'));
  check('모달의 실행 버튼이 newProject 를 부른다', /onClick:\s*newProject/.test(app));
  check('되돌릴 수 없다고 말한다', app.includes('cannot be undone'));
  // 화면 문구는 영어다 (프로젝트 규칙).
  const i = app.indexOf('Start a new project');
  const seg = app.slice(i, i + 700);
  let han = 0;
  for (const ch of seg) { const c = ch.codePointAt(0); if (c >= 0xac00 && c <= 0xd7a3) han++; }
  check('🔴 모달 문구에 한글이 없다 (UI 는 영어)', han === 0, han + '자');
}


// ── ⑱ 클립 밖으로 나간 재생을 멈춘다 (v2.10.2 B-PE-LastClipWrap) ───────────
//
// 🔴 사용자 보고: 곡 끝에 붙은 **마지막 클립**에서 재생이 안 멈추고 곡이 처음부터 다시
// 돌았다. 옛 판정은 "끝에 닿았는가"였는데, 엔진의 getPlayhead() 는 곡 루프가 켜져 있으면
// (기본값) `raw % duration` 을 돌려주므로 **닿는 순간이 33 ms 폴링에 안 걸린다.**
console.log('\n⑱ 클립을 벗어난 재생 정지 (B-PE-LastClipWrap)');
{
  const D = 60;                                  // 클립 길이 60 초
  check('클립 안이면 안이라고 한다', E.peInsideClip(0, D) && E.peInsideClip(30, D));
  check('끝은 안이 아니다 (여기서 멈춰야 한다)', !E.peInsideClip(D, D) && !E.peInsideClip(D - 0.0005, D));
  check('클립 앞은 안이 아니다', !E.peInsideClip(-1, D));
  check('값이 없으면 판정하지 않는다', !E.peInsideClip(NaN, D) && !E.peInsideClip(5, 0));

  // ▶ 직후 한 틱: 아직 SEEK 가 반영되지 않아 "재생 중 + 바깥" 이 관측된다.
  check('🔴 아직 들어온 적 없으면 멈추지 않는다 (▶ 직후 오탐 방지)',
    !E.peShouldStopAtClip(-120, D, false));
  check('들어왔다가 끝을 지나면 멈춘다', E.peShouldStopAtClip(D, D, true));
  check('들어와 있는 동안에는 안 멈춘다', !E.peShouldStopAtClip(30, D, true));

  // 🔴 이 사건이 결함 그 자체다. 곡 300 초, 마지막 클립 240~300 초.
  // 곡 끝에서 엔진이 0 으로 되감으면 getPlayhead() 는 0 → 클립 상대시간은 -240.
  {
    const songDur = 300, clipStart = 240, clipDur = 60;
    const rel = (songTime) => songTime - clipStart;
    let entered = false, stops = 0;
    // 재생 경과를 흉내낸다: 클립 시작 → 끝 직전 → **되감김(0)** → 그 뒤로도 계속.
    for (const songTime of [240, 260, 290, 299.99, 0, 0.5, 1.0]) {
      const p = rel(songTime);
      if (E.peInsideClip(p, clipDur)) { entered = true; continue; }
      if (E.peShouldStopAtClip(p, clipDur, entered)) { stops++; break; }
    }
    check('🔴 되감긴 마지막 클립에서 정지가 **일어난다**', stops === 1, stops + '회');
    // 옛 판정이었다면? p = -240 이므로 p >= dur 이 성립하지 않아 영원히 안 멈춘다.
    const oldWouldStop = [240, 260, 290, 299.99, 0, 0.5, 1.0]
      .some((t) => { const p = rel(t); return Number.isFinite(p) && clipDur > 0 && p >= clipDur - 1e-3; });
    check('🔴 옛 판정("끝에 닿았는가")이었다면 못 잡았다', !oldWouldStop, String(oldWouldStop));
  }

  // 중간 클립은 예전에도 정상이었다 — 고치면서 깨지지 않았는지 본다.
  {
    const clipStart = 60, clipDur = 60;
    let entered = false, stops = 0;
    for (const songTime of [60, 90, 119.99, 120.5]) {
      const p = songTime - clipStart;
      if (E.peInsideClip(p, clipDur)) { entered = true; continue; }
      if (E.peShouldStopAtClip(p, clipDur, entered)) { stops++; break; }
    }
    check('중간 클립도 끝에서 한 번 멈춘다 (회귀 아님)', stops === 1, stops + '회');
  }

  // 배선 구조 검사.
  const ed = fs.readFileSync(path.join(ROOT, 'build', 'pitch-editor-app.js'), 'utf8');
  check('자동 정지가 peInsideClip 을 거친다', ed.includes('peInsideClip(transport.playhead'));
  check('🔴 진입 래치가 있다 (▶ 직후 오탐 방지)', ed.includes('enteredClipRef'));
  check('▶ 도 같은 판정을 쓴다 (경계가 두 벌이 아니다)',
    /peInsideClip\(t\.playhead/.test(ed));
  check('스튜디오가 시작한 재생은 여전히 건드리지 않는다', ed.includes('ownPlayRef'));
  check('CLIP 루프 중에는 여전히 건너뛴다', /clipLoop \|\| !info\) return/.test(ed));
}

// ── ⑲ 시간 표시의 글자 칸 (v2.10.2 보완 요청 2) ────────────────────────────
//
// 숫자가 바뀔 때 좌우로 흔들리지 않으려면 **글자마다 같은 폭의 칸**이 있어야 한다.
// CSS 의 tabular-nums 는 글꼴이 tnum 표를 가질 때만 듣는다 — 그것에 기대지 않는다.
console.log('\n⑲ 시간 표시가 흔들리지 않는다 (보완 요청 2)');
{
  const cells = E.peTimeCells('3:01.06');
  check('글자 수만큼 칸이 나온다', cells.length === 7, String(cells.length));
  check('숫자와 구분자를 나눈다',
    cells.filter((c) => c.dig).length === 5 && cells.filter((c) => !c.dig).length === 2);
  check('구분자는 : 와 .', cells.filter((c) => !c.dig).map((c) => c.ch).join('') === ':.');
  check('빈 값도 죽지 않는다', E.peTimeCells(null).length === 0 && E.peTimeCells('--:--').length === 5);
  const css = fs.readFileSync(path.join(ROOT, 'pitch-editor.html'), 'utf8');
  const rule = (n) => { const i = css.indexOf('.' + n + '{'); return i < 0 ? null : css.slice(i, css.indexOf('}', i)); };
  const dig = rule('pe-dig');
  check('🔴 숫자 칸의 폭이 고정이다', !!dig && /width:[0-9.]+em/.test(dig) && /display:inline-block/.test(dig), dig);
  check('폭이 em 이라 두 크기에서 함께 맞는다', !!dig && /width:[0-9.]+em/.test(dig));
  check('구분자는 좁은 칸을 따로 쓴다', !!rule('pe-pun'));
  // 보완 요청 1 — 전체 길이를 약 80% 로 연하게.
  const tot = rule('pe-time-total');
  const op = tot && /opacity:([0-9.]+)/.exec(tot);
  check('🔴 전체 길이가 약 80% 로 연하다', !!op && Math.abs(parseFloat(op[1]) - 0.8) < 0.06, op && op[1]);
}


// ── ⑳ ±6 경고가 Key 스냅에서도 뜬다 (v2.10.3, 사용자 보고) ──────────────────
//
// 🔴 옛 판정은 "target 이 산술 한계(hi/lo)와 **같은가**" 였다. C major 에서 hi = 66(F#)은
// 조성 밖이라 스냅이 거기로 보내지 않는다 — 노트는 65(F)에서 서고, 더 끌어도 꼼짝 않는데
// 경고가 안 떴다. 이제는 드래그와 **같은 계산**으로 "한 칸 더 끌면 움직이나"를 묻는다.
console.log('\n⑳ ±6 한계 경고 (Key 스냅 포함)');
{
  const N = (midi, target) => ({ id: 'a', t0: 0, t1: 1, midi, target: target == null ? Math.round(midi) : target });
  const C = E.peScalePcs('C');
  check('peScalePcs 로 C 조성을 만들 수 있다', !!C);

  // Chromatic 은 예전에도 옳았다 — 무회귀 확인.
  check('Chromatic: 산술 한계에서 경고', E.peAtShiftLimit(N(60.5, 66), null) && E.peAtShiftLimit(N(60.5, 55), null));
  check('Chromatic: 한계 안에서는 경고 없음', !E.peAtShiftLimit(N(60.5, 65), null));
  check('Chromatic: 5.5 반음도 한계면 경고', E.peAtShiftLimit(N(60.5, 66), null), '60.5 → 66 = +5.5');

  if (C) {
    // 🔴 결함 그 자체: 66(F#)은 조성 밖이라 65(F)에서 갇힌다.
    const stuck = N(60.0, 65);
    const moved = E.peDragTarget(stuck, E.peClampDrag([stuck], 1), C);
    check('🔴 Key C: 65 에서 더 못 올라간다 (전제)', moved === 65, String(moved));
    check('🔴 Key C: 그 노트에 경고가 뜬다', E.peAtShiftLimit(stuck, C), '옛 판정은 놓쳤다');
    // 아직 여유가 있는 노트에는 뜨면 안 된다.
    check('Key C: 아직 올라갈 수 있으면 경고 없음', !E.peAtShiftLimit(N(60.0, 62), C));
    check('Key C: 손대지 않은 노트는 경고 없음', !E.peAtShiftLimit(N(60.0), C) && !E.peAtShiftLimit(N(67.3), C));
  }

  // ⚠️ Array.filter 는 두 번째 인자로 **인덱스**를 넘긴다 — 그대로 넘기면 snapPcs 자리에
  // 숫자가 들어가 판정이 뒤집힌다. 배선에서 막는다.
  const ed = fs.readFileSync(path.join(ROOT, 'build', 'pitch-editor-app.js'), 'utf8');
  check('🔴 filter 에 함수를 그대로 넘기지 않는다', !/filter\(peAtShiftLimit\)/.test(ed));
  check('경고 집계가 snapPcs 를 넘긴다', /peAtShiftLimit\(nt, snapPcs\)/.test(ed));

  // 전수 스윕: 놓침도 오탐도 0 이어야 한다.
  {
    let miss = 0, falsePos = 0;
    const keys = ['C', 'G', 'F', 'Am', 'Em'];
    for (const kn of [null, ...keys]) {
      const snap = kn ? E.peScalePcs(kn) : null;
      if (kn && !snap) continue;
      for (let pc = 0; pc < 12; pc++) {
        for (const fr of [0, 0.25, 0.5, 0.75]) {
          const midi = 60 + pc + fr;
          const { lo, hi } = E.peShiftRange({ midi });
          for (let target = lo; target <= hi; target++) {
            const nt = N(midi, target);
            const canUp = E.peDragTarget(nt, E.peClampDrag([nt], 1), snap) !== target;
            const canDn = E.peDragTarget(nt, E.peClampDrag([nt], -1), snap) !== target;
            const outStuck = (target > midi && !canUp) || (target < midi && !canDn) || target >= hi || target <= lo;
            const warn = E.peAtShiftLimit(nt, snap);
            if (outStuck && !warn) miss++;
            if (!outStuck && warn) falsePos++;
          }
        }
      }
    }
    check('🔴 전수 스윕 — 못 움직이는데 경고 없는 경우 0건', miss === 0, String(miss));
    check('🔴 전수 스윕 — 움직이는데 경고 뜨는 경우 0건', falsePos === 0, String(falsePos));
  }
}

// ── ㉑ 우클릭 메뉴가 실제로 눌린다 · Reset 이 소리까지 되돌린다 (v2.10.3) ────
//
// 🔴 사용자 보고: 우클릭 메뉴의 Reset 이 아무 일도 안 했다. 원인은 **바깥 클릭 리스너가
// 메뉴 자신을 죽인 것** — 캡처 단계 mousedown 이 버튼보다 먼저 뛰어 메뉴를 떼어 내므로
// 이어지는 click 이 발생하지 않는다. 캡처 단계로 거는 것만으로는 절반이었다.
console.log('\n㉑ 우클릭 메뉴가 눌리고, Reset 이 소리까지 되돌린다');
{
  const ed = fs.readFileSync(path.join(ROOT, 'build', 'pitch-editor-app.js'), 'utf8');
  check('🔴 바깥 클릭 리스너가 **메뉴 안**을 예외로 둔다',
    /ctxRef\.current\.contains\(e\.target\)/.test(ed), '없으면 메뉴 항목이 눌리지 않는다');
  check('메뉴에 ref 가 달려 있다', /ref:\s*ctxRef/.test(ed));
  check('리스너는 여전히 캡처 단계다 (v2.6.1)', /addEventListener\("mousedown",\s*close,\s*true\)/.test(ed));
  // Reset → 소리 맞추기. 📌 v2.10.4 에서 구현이 바뀌었으므로 상세 검사는 ㉒ 에 있다.
  check('Reset 이 소리 맞추기를 걸어 둔다', /setPendingPrint\(\{/.test(ed));
}


// ── ㉒ Reset 뒤 소리를 맞추는 판정 (v2.10.4, 사용자 보고) ────────────────────
//
// 🔴 사용자 보고: 노트 4개(하나는 손대지 않음) 를 모두 골라 Reset 하면 노트는 돌아가는데
// **소리가 안 돌아왔다.** 편집된 3개만 고르면 정상이었다.
//
// ⚠️ 먼저 **두 선택이 같은 결과를 내는지 쟀다** — edits · layout · 이후 화면 상태가 모두
// 같았다. 즉 선택 내용은 원인이 아니었고, 문제는 **그 다음 단계**였다: 판정이 파생 상태와
// ref 표식에 걸려 있어 **조용히 아무 일도 안 하는 길이 셋** 있었다.
console.log('\n㉒ Reset 뒤 소리 맞추기 (B-PE-ResetAudioSilent)');
{
  const SIG_A = '[[["0.5","1"]],[1,1],[]]';      // 프린트된 모양
  const SIG_EMPTY = '[[],[1,1],[]]';             // 전부 Reset 한 모양

  check('프린트된 적 없으면 할 일 없음', E.pePostResetAction(SIG_EMPTY, null, false, false) === 'none');
  check('이미 그 소리면 할 일 없음', E.pePostResetAction(SIG_A, SIG_A, true, true) === 'none');
  check('🔴 모양이 하나도 안 남았으면 revert', E.pePostResetAction(SIG_EMPTY, SIG_A, true, false) === 'revert',
    E.pePostResetAction(SIG_EMPTY, SIG_A, true, false));
  check('보정이 남았으면 다시 굽는다', E.pePostResetAction(SIG_A, '[[],[1,1],[]]', true, true) === 'print');

  // 🔴 사용자가 마주친 사건: 전부 Reset → 남은 모양 없음 → revert 여야 한다.
  {
    const notes4 = [
      { id: 'n1', t0: 0.0, t1: 0.5, midi: 65.05, target: 65, strength: 1, keepVibrato: true },
      { id: 'n2', t0: 0.5, t1: 1.0, midi: 65.10, target: 66, strength: 1, keepVibrato: true },
      { id: 'n3', t0: 1.0, t1: 1.5, midi: 66.90, target: 68, strength: 1, keepVibrato: true },
      { id: 'n4', t0: 1.5, t1: 2.0, midi: 64.95, target: 66, strength: 1, keepVibrato: true },
    ];
    const edits0 = [
      { t0: 0.5, t1: 1.0, target: 66, strength: 1, keepVibrato: true },
      { t0: 1.0, t1: 1.5, target: 68, strength: 1, keepVibrato: true },
      { t0: 1.5, t1: 2.0, target: 66, strength: 1, keepVibrato: true },
    ];
    const defs = E.PE_DEFAULTS;
    const printedSig = E.peShapeSig(edits0, defs, []);
    const run = (ids) => {
      const sel = new Set(ids);
      const picked = notes4.filter((nt) => sel.has(nt.id));
      const nextEdits = E.peRewriteEdits(notes4, edits0, sel, () => null, E.PE_TUNING.reattachTau, defs);
      const nextLayout = picked.length ? E.peLayoutRelease([], picked[0].t0, picked[picked.length - 1].t1) : [];
      const sig = E.peShapeSig(nextEdits, defs, nextLayout);
      const hasShape = !!(nextEdits.length || nextLayout.length);
      return { sig, act: E.pePostResetAction(sig, printedSig, true, hasShape) };
    };
    const only3 = run(['n2', 'n3', 'n4']);          // 사용자: 정상이었다
    const all4  = run(['n1', 'n2', 'n3', 'n4']);    // 사용자: 소리가 안 돌아왔다
    check('🔴 손대지 않은 노트를 끼워 골라도 결과가 같다', only3.sig === all4.sig && only3.act === all4.act,
      only3.act + ' / ' + all4.act);
    check('🔴 둘 다 revert 를 고른다 (소리가 원래대로)', only3.act === 'revert' && all4.act === 'revert');
  }

  // 배선 — 조용히 넘어가는 길이 없어야 한다.
  const ed = fs.readFileSync(path.join(ROOT, 'build', 'pitch-editor-app.js'), 'utf8');
  check('🔴 표식(ref)이 아니라 값(state)으로 이어진다',
    ed.includes('setPendingPrint') && !/autoPrintRef/.test(ed), 'ref 는 렌더를 일으키지 않는다');
  check('Reset 이 만든 모양을 그대로 싣는다', /setPendingPrint\(\{ edits: nextEdits, layout: nextLayout \}\)/.test(ed));
  check('🔴 작업 중이면 값을 **남겨 둔 채** 물러난다',
    /if \(printing \|\| busy\) return;\s*const want = pendingPrint/.test(ed), 'v2.10.3 은 여기서 표식을 지웠다');
  check('판정이 pePostResetAction 하나를 거친다', ed.includes('pePostResetAction(sig'));
  check('🔴 파생 상태가 아니라 클립이 담은 것을 본다', /inf\.pitch\.printedSourceId/.test(ed) && /inf\.pitch\.printedSig/.test(ed));
  check('🔴 canApply · revertCorrection 의 조용한 가드를 타지 않는다',
    !/pendingPrint[^]{0,900}canApply/.test(ed) && !/pendingPrint[^]{0,900}revertCorrection\(\)/.test(ed));
  check('구울 수 없으면 말은 한다 (분석 없음)',
    ed.includes('Press Analyze, then Apply'), '조용히 넘어가면 화면과 소리가 어긋난 채 남는다');
}


// ── 마무리 ─────────────────────────────────────────────────────────────────
console.log(`\n${pass} PASS · ${fail} FAIL`);
if (MUTATE || MUTATE_EDITS || MUTATE_DEFAULTS || MUTATE_LAYOUT || MUTATE_LIMIT || MUTATE_CTX || MUTATE_WRAP || MUTATE_SNAPLIMIT || MUTATE_RESETAUDIO) {
  console.log(fail > 0
    ? '\n✅ 변이 시험 통과 — 수정을 빼면 하네스가 잡아낸다.'
    : '\n🔴 변이했는데도 전건 통과 — 이 하네스는 ③④를 실제로 지키지 못한다.');
  process.exit(fail > 0 ? 0 : 1);
}
process.exit(fail ? 1 : 0);
