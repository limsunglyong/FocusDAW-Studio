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
const MUTATE = process.argv.includes('--mutate');
// v2.7.1 — 편집 모델 쪽 변이: 형제 조각 보존 루프를 빼고, 색 선택을 '첫 후보 고정'으로 바꾼다.
// ⑤의 형제 검사 2건과 ⑥의 테마 검사가 FAIL 해야 하네스가 진짜다.
const MUTATE_EDITS = process.argv.includes('--mutate-edits');

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
    src = src.replace(/  for \(const nt of notes\) \{\n    if \(ids\.has\(nt\.id\) \|\| peIsPristine\(nt\)\) continue;\n[\s\S]*?\n  \}\n/, '');
    const mid = src;
    src = src.replace('return best || any;', 'return cands[0] || null;');
    if (mid === before || src === mid) { console.error('편집 모델 변이 실패 — 패턴을 못 찾았다.'); process.exit(2); }
  }
  const a = src.indexOf('const peClamp ='), b = src.indexOf('function peScalePcs');
  if (a < 0 || b < 0) { console.error('편집 모델 블록을 못 찾았다.'); process.exit(2); }
  const ctx = { Math, Array, console, JSON, Number };
  vm.createContext(ctx);
  vm.runInContext(src.slice(a, b) +
    '\nthis.peApplyEdits = peApplyEdits; this.peEditsFromNotes = peEditsFromNotes;' +
    '\nthis.peIsPristine = peIsPristine; this.PE_TUNING = PE_TUNING;' +
    '\nthis.peRewriteEdits = peRewriteEdits; this.pePickEditedColor = pePickEditedColor;' +
    '\nthis.PE_EDITED_REDS = PE_EDITED_REDS; this.PE_EDITED_MIN_CONTRAST = PE_EDITED_MIN_CONTRAST;', ctx);
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
console.log(`\nStage D 편집 모델·지속 회귀선${MUTATE ? '  [변이: _serializedClips 의 pitch 제거]' : ''}${MUTATE_EDITS ? '  [변이: 형제 보존 제거 · 색 고정]' : ''}\n`);

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

// ── 마무리 ─────────────────────────────────────────────────────────────────
console.log(`\n${pass} PASS · ${fail} FAIL`);
if (MUTATE || MUTATE_EDITS) {
  console.log(fail > 0
    ? '\n✅ 변이 시험 통과 — 수정을 빼면 하네스가 잡아낸다.'
    : '\n🔴 변이했는데도 전건 통과 — 이 하네스는 ③④를 실제로 지키지 못한다.');
  process.exit(fail > 0 ? 0 : 1);
}
process.exit(fail ? 1 : 0);
