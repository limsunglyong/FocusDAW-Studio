/* ============================================================================
 * pitch-edit-reattach-harness.js — Stage D 착수 전 계측 (D-0)
 *
 * 무엇을 재는가
 *   설계 §4-1이 유일한 미결로 남긴 값, **재부착 겹침 임계**를 고른다.
 *   편집은 노트 id가 아니라 `clip.pitch.edits[]`의 시간 구간에 앵커되고,
 *   `Analyze`/재분할 뒤에는 "시간이 겹치는 새 노트"에 다시 붙는다.
 *   그 "얼마나 겹쳐야 같은 것으로 보는가"를 짐작으로 정하지 않기 위한 하네스다.
 *
 * 왜 계측하는가
 *   이 프로젝트에서 피치 쪽 짐작은 대체로 틀렸다 — 2026-09-02에 자신 있던
 *   수정안 3건이 계측에서 전부 기각됐다(앱개발.md). 임계 하나도 같은 대접을 한다.
 *
 * 어떻게
 *   1. build/pitch-editor-app.js 에서 세그멘테이션 코드만 떼어 vm 으로 돌린다.
 *      ⚠️ 작업본이 CRLF 라 \r 를 먼저 제거한다 — 안 그러면 정규식 추출이 조용히 실패한다.
 *   2. 정답을 아는 합성 분석 결과(an)를 만든다. 오디오를 거치지 않는다 —
 *      peBuildNotes 는 an(프레임별 midi/voiced/conf)만 받으므로 그게 전부다.
 *   3. NOTES 설정 A 로 세그멘테이션 → 그중 몇 개에 편집을 심는다.
 *   4. NOTES 설정 B 로 재세그멘테이션(= 사용자가 설정을 바꾸거나 결함을 고친 뒤).
 *   5. 임계 τ 별로 재부착해, 편집이 **원래 노래하던 그 음**에 돌아갔는지 센다.
 *
 * 판정
 *   correct   원래의 정답 노트를 덮는 새 노트에 붙었다
 *   wrong     다른 정답 노트에 붙었다      ← 가장 나쁘다. 사용자 편집이 엉뚱한 음에 간다
 *   missed    아무 데도 못 붙었다          ← 편집이 사라진 것처럼 보인다
 *   dup       두 개 이상에 붙었다          ← 한 음이 쪼개진 경우. 사라지는 것보단 낫다
 *
 * 실행: node tools/pitch-edit-reattach-harness.js
 * ==========================================================================*/

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ── 1. 세그멘터 추출 ────────────────────────────────────────────────────────
function loadSegmenter() {
  const file = path.join(ROOT, 'build', 'pitch-editor-app.js');
  if (!fs.existsSync(file)) {
    console.error('build/pitch-editor-app.js 가 없다. 먼저 `npm run build:renderers`.');
    process.exit(1);
  }
  // ⚠️ CRLF 제거가 먼저다.
  const src = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const from = src.indexOf('const peClamp =');
  const to = src.indexOf('function peScalePcs');
  if (from < 0 || to < 0 || to < from) {
    console.error('세그멘테이션 블록을 찾지 못했다 (peClamp ~ peScalePcs).');
    process.exit(1);
  }
  const ctx = { Math, Array, console };
  vm.createContext(ctx);
  vm.runInContext(src.slice(from, to) + '\nthis.peBuildNotes = peBuildNotes; this.peNoteGrid = peNoteGrid;', ctx);
  if (typeof ctx.peBuildNotes !== 'function') {
    console.error('peBuildNotes 를 끌어내지 못했다.');
    process.exit(1);
  }
  return ctx;
}

// ── 2. 정답을 아는 합성 분석 ────────────────────────────────────────────────
// Stage B 가 내놓는 것과 같은 모양: 프레임별 midi / voiced / conf.
// 프레임률은 실제와 맞춘다(hop 10.67 ms ≈ 93.7 fps, 앱개발.md 샘플레이트 지침).
const HOP = 1 / 93.75;
const WIN = 0.0427;

// 한 곡: [midi, 길이초, 비브라토폭센트] 의 나열. 음 사이에 짧은 무성 자음을 넣는다.
function makeSong(seed) {
  const rnd = mulberry(seed);
  const scale = [60, 62, 64, 65, 67, 69, 71, 72];
  const song = [];
  for (let i = 0; i < 14; i++) {
    const midi = scale[Math.floor(rnd() * scale.length)];
    // 길이를 넓게 흩는다 — 짧은 음일수록 설정 변경에 민감하다
    const dur = 0.18 + rnd() * 0.75;
    const vib = rnd() < 0.35 ? 30 + rnd() * 50 : 0;   // ±30~80센트
    song.push({ midi, dur, vib });
  }
  return song;
}

function synth(song, legato) {
  const midi = [], voiced = [], conf = [];
  const truth = [];                       // {midi, t0, t1} — 정답표
  let t = 0;
  for (const nt of song) {
    const t0 = t;
    const n = Math.max(2, Math.round(nt.dur / HOP));
    for (let k = 0; k < n; k++) {
      const ph = (k * HOP) * 5.5 * 2 * Math.PI;        // 5.5 Hz 비브라토
      midi.push(nt.midi + (nt.vib / 100) * Math.sin(ph));
      voiced.push(1);
      conf.push(0.9);
    }
    t += n * HOP;
    truth.push({ midi: nt.midi, t0, t1: t });
    // 자음/숨 — PE_GAP_SEC(0.04)보다 길게 넣어 확실한 경계로 만든다.
    // 🔴 legato 면 이것을 없앤다: 붙여 부르는 구간에는 무성 경계가 없고, 편집이
    // 옆 음까지 번질 수 있는 유일한 자리가 바로 거기다. 무성 구간이 있는 곡만
    // 재고 임계를 고르면 그 경우를 놓친다(v2.4.7 교훈 — 합성이 통과해도 다르다).
    const g = legato ? 0 : Math.max(5, Math.round(0.06 / HOP));
    for (let k = 0; k < g; k++) { midi.push(0); voiced.push(0); conf.push(0.1); }
    t += g * HOP;
  }
  const frames = midi.length;
  return {
    an: { frames, midi, voiced, conf, hopSec: HOP, winSec: WIN },
    truth,
    clipDur: frames * HOP + WIN,
  };
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 3. 재부착 ──────────────────────────────────────────────────────────────
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

// 채택안(설계 §4-1): edit 길이 대비 겹침 비율이 τ 이상인 새 노트에 붙인다.
function reattach(edits, notes, tau) {
  return edits.map((ed) => {
    const len = ed.t1 - ed.t0;
    const hits = [];
    for (const nt of notes) {
      const ov = overlap(ed.t0, ed.t1, nt.t0, nt.t1);
      if (len > 0 && ov / len >= tau) hits.push(nt);
    }
    return { ed, hits };
  });
}

// 그 시각에 실제로 노래하던 음 — 정답 판정의 기준
function truthAt(truth, t) {
  for (let i = 0; i < truth.length; i++) {
    if (t >= truth[i].t0 && t < truth[i].t1) return i;
  }
  return -1;
}

// ── 4. 한 조건을 잰다 ──────────────────────────────────────────────────────
function measure(ctx, seed, divA, divB, bpm, taus, legato) {
  const song = makeSong(seed);
  const { an, truth, clipDur } = synth(song, legato);
  const tempo = { projectBpm: bpm };

  const gridA = ctx.peNoteGrid(tempo, divA);
  const gridB = ctx.peNoteGrid(tempo, divB);
  const notesA = ctx.peBuildNotes(an, gridA, clipDur).notes;
  const notesB = ctx.peBuildNotes(an, gridB, clipDur).notes;
  if (!notesA.length || !notesB.length) return null;

  // 편집을 심는다 — 두 개 걸러 하나, 사용자가 군데군데 손본 모양
  const edits = [];
  for (let i = 0; i < notesA.length; i += 2) {
    const nt = notesA[i];
    const ti = truthAt(truth, (nt.t0 + nt.t1) / 2);
    if (ti < 0) continue;                       // 정답 구간을 못 짚는 노트는 제외
    edits.push({ t0: nt.t0, t1: nt.t1, truthIdx: ti, target: Math.round(nt.midi) + 1 });
  }
  if (!edits.length) return null;

  const out = {};
  for (const tau of taus) {
    let correct = 0, wrong = 0, missed = 0, dupClean = 0, dupSpill = 0;
    for (const { ed, hits } of reattach(edits, notesB, tau)) {
      if (!hits.length) { missed++; continue; }
      const idxs = hits.map((nt) => truthAt(truth, (nt.t0 + nt.t1) / 2));
      const good = idxs.filter((x) => x === ed.truthIdx).length;
      if (good === 0) wrong++;
      else if (hits.length > 1) {
        // dup 은 두 가지다. 같은 정답 노트가 여러 조각으로 쪼개져 편집이 그 조각들에
        // 복제된 것(harmless — 사용자가 의도한 음이 그대로 유지된다)과, 옆의 다른
        // 음까지 번진 것(spill — 건드리지 않은 음이 바뀐다. 이건 진짜 오류다).
        if (good === hits.length) dupClean++; else dupSpill++;
      }
      else correct++;
    }
    out[tau] = { correct, wrong, missed, dupClean, dupSpill, total: edits.length };
  }
  return { out, nA: notesA.length, nB: notesB.length, nEd: edits.length, nTruth: truth.length };
}

// ── 5. 실행 ────────────────────────────────────────────────────────────────
const ctx = loadSegmenter();
const TAUS = [0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

// 재분할이 일어나는 실제 경우들
const CASES = [
  { name: 'NOTES 1/16 → 1/32', divA: 16, divB: 32, bpm: 105 },
  { name: 'NOTES 1/16 → 1/8 ', divA: 16, divB: 8,  bpm: 105 },
  { name: 'NOTES 1/8  → 1/32', divA: 8,  divB: 32, bpm: 105 },
  { name: '설정 동일(재열기)  ', divA: 16, divB: 16, bpm: 105 },
  { name: '레가토 1/16 → 1/32', divA: 16, divB: 32, bpm: 105, legato: true },
  { name: '레가토 1/16 → 1/8 ', divA: 16, divB: 8,  bpm: 105, legato: true },
  { name: '레가토 재열기      ', divA: 16, divB: 16, bpm: 105, legato: true },
];

console.log('\n=== 편집 재부착 임계 계측 (Stage D / 설계 §4-1) ===');
console.log(`곡 ${SEEDS.length}개 · BPM 105 · 프레임률 ${(1 / HOP).toFixed(1)} fps\n`);

const grand = {};
for (const tau of TAUS) grand[tau] = { correct: 0, wrong: 0, missed: 0, dupClean: 0, dupSpill: 0, total: 0 };

for (const c of CASES) {
  const agg = {};
  for (const tau of TAUS) agg[tau] = { correct: 0, wrong: 0, missed: 0, dupClean: 0, dupSpill: 0, total: 0 };
  let nA = 0, nB = 0, runs = 0;
  for (const seed of SEEDS) {
    const r = measure(ctx, seed, c.divA, c.divB, c.bpm, TAUS, c.legato);
    if (!r) continue;
    runs++; nA += r.nA; nB += r.nB;
    for (const tau of TAUS) {
      for (const k of ['correct', 'wrong', 'missed', 'dupClean', 'dupSpill', 'total']) {
        agg[tau][k] += r.out[tau][k];
        if (c.divA !== c.divB) grand[tau][k] += r.out[tau][k];
      }
    }
  }
  if (!runs) { console.log(`${c.name}: 측정 불가\n`); continue; }
  console.log(`--- ${c.name}  (노트 ${(nA / runs).toFixed(1)} → ${(nB / runs).toFixed(1)} 개/곡) ---`);
  console.log('  τ     correct   missed  dup(같은음)  dup(번짐)    wrong   |  보존율');
  for (const tau of TAUS) {
    const a = agg[tau], p = (v) => String(v).padStart(4) + ' (' + String(Math.round(v / a.total * 100)).padStart(3) + '%)';
    console.log(`  ${tau.toFixed(2)}  ${p(a.correct)} ${p(a.missed)} ${p(a.dupClean)} ${p(a.dupSpill)} ${p(a.wrong)}   | ${String(Math.round((a.correct+a.dupClean)/a.total*100)).padStart(4)}%`);
  }
  console.log('');
}

console.log('=== 설정이 실제로 바뀐 경우만 합산 (재열기 제외) ===');
console.log('  τ     correct   missed  dup(같은음)  dup(번짐)    wrong   |  보존율');
for (const tau of TAUS) {
  const a = grand[tau], p = (v) => String(v).padStart(4) + ' (' + String(Math.round(v / a.total * 100)).padStart(3) + '%)';
  console.log(`  ${tau.toFixed(2)}  ${p(a.correct)} ${p(a.missed)} ${p(a.dupClean)} ${p(a.dupSpill)} ${p(a.wrong)}   | ${String(Math.round((a.correct+a.dupClean)/a.total*100)).padStart(4)}%`);
}
console.log('');
