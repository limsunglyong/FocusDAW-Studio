// Pitch Editor — dedicated window, one CLIP at a time (v2.0.0+, 피치-에디터-설계.md).
//
// Stage A gave it a window and a waveform; Stage B added pitch detection and the curve.
// v2.2.0 added the things that make it usable while listening: transport, a playhead, and
// time / pitch zoom. Note segmentation (C), editing (D) and rendering (E) are still ahead —
// their toolbar buttons stay disabled until the stage that gives them meaning.
//
// Why a window per clip rather than a track panel: pitch editing targets one clip's audio, and
// the 244px track header has no horizontal slack left (the vocal strip's FX control already had
// to shrink to an icon for that reason). Entry point is the clip's right-click menu.
//
// State arrives over the SAME "focusdaw-advanced-effects-sync" channel the mixer / advanced /
// vocal-strip windows use, so theme, project name and undo/redo broadcasts are reused unchanged.

const peChannel = new BroadcastChannel("focusdaw-advanced-effects-sync");

function peQuery(k) { try { return new URLSearchParams(location.search).get(k) || ""; } catch (_) { return ""; } }

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const isBlackKey = (midi) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
const midiName = (midi) => NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);

// Absolute limits of the keyboard, with headroom on both sides of the vocal range the
// detector actually searches (65~1100 Hz ≈ C2~C6), so a detected note is never off-screen.
const PITCH_MIN = 36;   // C2
const PITCH_MAX = 84;   // C6
const MIN_SPAN = 8;     // closest vertical zoom, in semitones
const KEY_W = 54;       // keyboard gutter (px)
const RULER_H = 20;     // time ruler (px)
const SB = 10;          // scrollbar thickness (px) — 참조 디자인 §3e
const MIN_VIEW_SEC = 0.25;   // closest time zoom

// The visible pitch window is a FLOAT range (v2.3.0). It used to be two integers because the
// only operation was "zoom about the centre"; panning by whole semitones would jump the view
// a full row (~15px) at a time, which reads as stuttering rather than scrolling.
const peSpan = (r) => r.hi - r.lo;
function peFitPitch(lo, hi) {
  const span = peClamp(hi - lo, MIN_SPAN, PITCH_MAX - PITCH_MIN);
  let l = lo, h = lo + span;
  if (l < PITCH_MIN) { l = PITCH_MIN; h = l + span; }
  if (h > PITCH_MAX) { h = PITCH_MAX; l = h - span; }
  return { lo: l, hi: h };
}

// The pitch the singer was actually on at time t — used to light the key under the playhead
// so the ear and the eye can be compared while listening (T-2.0.2-1 ④의 상시 확인 수단).
function peMidiAt(an, t) {
  if (!an || !an.frames || !Number.isFinite(t)) return null;
  const k = Math.round((t - an.winSec / 2) / an.hopSec);
  if (k < 0 || k >= an.frames || !an.voiced[k]) return null;
  return an.midi[k];
}

/* ---------- piano preview tone ---------- */

// A struck-string-ish tone, synthesised rather than sampled: four decaying partials is a few
// lines and no asset, and the point is pitch reference, not a convincing piano.
//
// This window opens its OWN AudioContext. That is safe — the studio already runs the web
// engine's context alongside the native engine — but it does NOT inherit the studio's output
// device, so the sink has to be matched explicitly or the preview comes out of the laptop
// speakers while the mix plays through the interface (audio-engine.js `setOutputDevice`
// does the same label match for the same reason).
let peCtx = null;
let peSinkDone = false;

async function peSyncSink() {
  if (peSinkDone || !peCtx || typeof peCtx.setSinkId !== "function") return;
  peSinkDone = true;
  try {
    const saved = JSON.parse(localStorage.getItem("focusdaw-audio-device") || "null");
    const label = (saved && saved.name) || "";
    if (!label) { await peCtx.setSinkId(""); return; }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const norm = (x) => (x || "").toLowerCase().replace(/\s+/g, " ").trim();
    const want = norm(label);
    const outs = devices.filter((d) => d.kind === "audiooutput");
    const hit = outs.find((d) => norm(d.label) === want)
             || outs.find((d) => norm(d.label).includes(want) || want.includes(norm(d.label)));
    if (hit) await peCtx.setSinkId(hit.deviceId);
  } catch (_) { /* preview falls back to the default device — never worth an error dialog */ }
}

function peTone(midi) {
  try {
    if (!peCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      peCtx = new AC();
      peSyncSink();
    }
    if (peCtx.state === "suspended") peCtx.resume();
    const t0 = peCtx.currentTime;
    const f0 = 440 * Math.pow(2, (midi - 69) / 12);
    const out = peCtx.createGain();
    out.gain.value = 0.22;
    // A gentle low-pass keeps the upper partials from sounding like a square-wave beep.
    const lp = peCtx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.min(9000, f0 * 9);
    lp.connect(out); out.connect(peCtx.destination);
    const PARTIALS = [[1, 1.0, 1.5], [2, 0.42, 1.0], [3, 0.20, 0.7], [4, 0.10, 0.5]];
    for (const [mult, amp, decay] of PARTIALS) {
      const osc = peCtx.createOscillator();
      const g = peCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = f0 * mult;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(amp, t0 + 0.006);          // a hammer, not a fade-in
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);  // higher partials die first
      osc.connect(g); g.connect(lp);
      osc.start(t0); osc.stop(t0 + decay + 0.05);
    }
  } catch (_) { /* no preview is better than a broken window */ }
}

// ui-kit.js already owns fmtTime and loads FIRST, and the renderers share one global scope
// (앱개발.md 상시 노트) — declaring another `fmtTime` here throws "already declared" and kills
// the whole window. Window-local symbols therefore carry the `pe` prefix, and the formatting
// itself is reused rather than reimplemented.
// Negative guard matters here: the read-out shows CLIP-relative time, so a transport parked
// earlier in the song is legitimately negative — and ui-kit's fmtTime renders that as
// "-1:-5.-15". Outside the clip there is no clip position to show, so say so.
const peFmtTime = (s) => (Number.isFinite(s) && s >= 0 ? fmtTime(s) : "--:--");
// 🔴 HARNESS BOUNDARY — START. tools/pitch-edits-persist-harness.js lifts everything from
// this line down to `const peCentsOff =` into a vm and measures the real code, so that whole
// span must stay PURE: no React, no DOM, no window at module level.
//
// The markers are CODE, not comments — esbuild strips comments from build/pitch-editor-app.js,
// which is what the harness actually reads. v2.7.3 moved the end marker from `function
// peScalePcs` to `const peCentsOff =`: the new Key-snap helpers call peScalePcs, so the window
// could no longer END at the thing they depend on. **New pure helpers go before peCentsOff.**
const peClamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Applied to <html> the moment a theme arrives, NOT from an effect. React runs CHILD effects
// before PARENT effects, so a parent effect that sets data-theme would land AFTER the piano
// roll's redraw — the canvas would read the previous theme's CSS variables and keep the old
// colours until the window was reopened (v2.0.0 defect, T-2.0.0-1 ④).
function peApplyThemeAttr(theme) {
  const root = document.documentElement;
  if (!theme || theme === "default") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

// Pitch range that frames what was actually sung, with a little air above and below. Falls
// back to the full keyboard when nothing was detected.
function peFitRange(an) {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < an.frames; k++) {
    if (!an.voiced[k]) continue;
    if (an.midi[k] < lo) lo = an.midi[k];
    if (an.midi[k] > hi) hi = an.midi[k];
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: PITCH_MIN, hi: PITCH_MAX };
  let l = Math.floor(lo) - 4, h = Math.ceil(hi) + 4;
  if (h - l < MIN_SPAN) { const pad = Math.ceil((MIN_SPAN - (h - l)) / 2); l -= pad; h += pad; }
  return { lo: Math.max(PITCH_MIN, l), hi: Math.min(PITCH_MAX, h) };
}

/* ---------- Stage C — note segmentation (설계 §12-1) ---------- */

// The rule that decides how many notes appear is a MUSICAL one, not a signal one.
//
// Stage B's curve wobbles: a singer holding one note crosses a semitone boundary several times
// on vibrato alone, so cutting on the pitch threshold by itself turns one sung note into three
// or four blocks. Segmentation therefore takes its shortest-note length from the BEAT — "no
// note is shorter than a 1/16" is how music says it, and it scales with the song instead of
// being a constant that is too coarse at 60 BPM and too fine at 180.
const PE_DIVISIONS = [8, 16, 32];        // 1/8 · 1/16 · 1/32
const PE_MIN_NOTE_FLOOR = 0.06;          // the detector's own limit (설계 §5-3)
const PE_MIN_NOTE_CEIL = 0.20;           // so a slow song does not swallow a genuine fast run
const PE_MIN_NOTE_NOBPM = 0.12;          // used when the project has no BPM — a normal state
const PE_HYST_ST = 0.6;                  // semitones; the pitch step that can open a new note
const PE_GAP_SEC = 0.04;                 // unvoiced longer than this is a note boundary
const PE_DENSITY_SLACK = 1.2;            // notes may exceed one-per-grid-slot by this much
const PE_DENSITY_PASSES = 2;             // extra re-cuts allowed when the cap is blown

// Shortest admissible note, and where that number came from — the UI shows both, because a
// user who sees 40 notes where they sang 12 needs to know which rule produced them.
function peNoteGrid(tempo, division) {
  const bpm = tempo && Number.isFinite(tempo.projectBpm) && tempo.projectBpm > 0 ? tempo.projectBpm : null;
  const div = PE_DIVISIONS.includes(division) ? division : 16;
  if (!bpm) return { bpm: null, division: div, gridSec: null, minNoteSec: PE_MIN_NOTE_NOBPM };
  const gridSec = (60 / bpm) * (4 / div);          // a 1/16 at 96 BPM = 156 ms
  return { bpm, division: div, gridSec, minNoteSec: peClamp(gridSec * 0.75, PE_MIN_NOTE_FLOOR, PE_MIN_NOTE_CEIL) };
}

function peMedian(arr) {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  return a[a.length >> 1];
}

// The note's pitch is the median of its CENTRAL 60% (설계 §5-3): the attack scoops and the
// release drifts, and neither is the note the singer meant.
function peCoreMedian(an, idx) {
  const n = idx.length;
  if (n < 4) return peMedian(idx.map((k) => an.midi[k]));
  const a = Math.floor(n * 0.2), b = Math.ceil(n * 0.8);
  const core = [];
  for (let i = a; i < b; i++) core.push(an.midi[idx[i]]);
  return peMedian(core.length ? core : idx.map((k) => an.midi[k]));
}

// Voiced stretches, bridging unvoiced gaps shorter than PE_GAP_SEC. A consonant in the middle
// of a word is not a note boundary; a breath is.
function peVoicedRuns(an) {
  const gapFrames = Math.max(1, Math.round(PE_GAP_SEC / an.hopSec));
  const runs = [];
  let k = 0;
  while (k < an.frames) {
    if (!an.voiced[k]) { k++; continue; }
    const idx = [k];
    let i = k + 1;
    while (i < an.frames) {
      if (an.voiced[i]) { idx.push(i); i++; continue; }
      let j = i;
      while (j < an.frames && !an.voiced[j]) j++;
      if (j >= an.frames || j - i >= gapFrames) break;   // a real gap ends the run
      i = j;                                             // a short one does not
    }
    runs.push(idx);
    k = idx[idx.length - 1] + 1;
  }
  return runs;
}

// One pass of segmentation at the given thresholds. Returns notes in clip-relative seconds.
//
// Two things stop the over-splitting, and the SECOND one is the important half:
//  1. the pitch has to move more than `hystSt` from the note's running reference, and
//  2. it has to STAY there for half a minimum note before the boundary is accepted.
// Vibrato satisfies 1 constantly and 2 never, which is exactly the distinction that was
// missing while the minimum was a flat 60 ms.
function peSegmentPass(an, clipDur, hystSt, minNoteSec) {
  const hop = an.hopSec, half = an.winSec / 2;
  const holdCount = Math.max(2, Math.round((minNoteSec / 2) / hop));
  const notes = [];
  let seq = 0;

  for (const idx of peVoicedRuns(an)) {
    // cut the run wherever the pitch genuinely steps
    let segs = [];
    let segStart = 0;
    let ref = an.midi[idx[0]];
    let devStart = -1;
    for (let p = 1; p < idx.length; p++) {
      const v = an.midi[idx[p]];
      if (Math.abs(v - ref) > hystSt) {
        if (devStart < 0) devStart = p;
        if (p - devStart + 1 >= holdCount) {
          segs.push(idx.slice(segStart, devStart));
          segStart = devStart;
          ref = an.midi[idx[devStart]];
          devStart = -1;
        }
      } else {
        devStart = -1;
        // The reference follows the note slowly, so a portamento does not read as a step — but
        // only from frames INSIDE the note, or a deviation would drag the reference after it
        // and the boundary would never fire.
        ref += 0.08 * (v - ref);
      }
    }
    segs.push(idx.slice(segStart));
    segs = segs.filter((x) => x.length);

    // Absorb fragments (설계 §12-1). Deleting them would leave holes that Stage E then cannot
    // correct, so a short piece joins whichever NEIGHBOUR it is closest to in pitch. Merging
    // can never empty a run: the last note standing is kept whatever its length, and a run too
    // short even for the detector's own floor was never a note to begin with.
    const durOf = (x) => (x[x.length - 1] - x[0] + 1) * hop;
    while (segs.length > 1) {
      let worst = -1, worstDur = Infinity;
      for (let i = 0; i < segs.length; i++) {
        const d = durOf(segs[i]);
        if (d < minNoteSec && d < worstDur) { worst = i; worstDur = d; }
      }
      if (worst < 0) break;
      const mine = peCoreMedian(an, segs[worst]);
      const prev = worst > 0 ? Math.abs(peCoreMedian(an, segs[worst - 1]) - mine) : Infinity;
      const next = worst < segs.length - 1 ? Math.abs(peCoreMedian(an, segs[worst + 1]) - mine) : Infinity;
      const into = prev <= next ? worst - 1 : worst + 1;
      const lo = Math.min(into, worst), hi = Math.max(into, worst);
      segs.splice(lo, 2, segs[lo].concat(segs[hi]));
    }
    if (segs.length === 1 && durOf(segs[0]) < PE_MIN_NOTE_FLOOR) continue;

    for (const sg of segs) {
      // A frame stands for the hop around its centre, so the block reaches half a hop past the
      // outermost frames — otherwise every note is drawn one frame short at each end.
      const t0 = peClamp(sg[0] * hop + half - hop / 2, 0, clipDur);
      const t1 = peClamp(sg[sg.length - 1] * hop + half + hop / 2, 0, clipDur);
      if (t1 - t0 <= 0) continue;
      let csum = 0;
      for (const k of sg) csum += an.conf[k];
      const midi = peCoreMedian(an, sg);
      notes.push({
        id: "n" + (++seq),
        t0, t1,
        midi,                       // as detected
        target: Math.round(midi),   // Stage D lets this move; Stage C shows the nearest semitone
        strength: 1,
        keepVibrato: true,
        confidence: peClamp(csum / sg.length, 0, 1),
      });
    }
  }
  return notes;
}

// Segmentation with the density cap in front of it (설계 §12-1). The cap is a last line of
// defence, not the main mechanism: however messy the signal, the roll must not end up carpeted
// in blocks. When it trips, the thresholds go up and the clip is cut again — at most twice, so
// a pathological take cannot spin here.
function peBuildNotes(an, grid, clipDur) {
  if (!an || !an.frames || !clipDur) return { notes: [], relaxed: 0 };
  const cap = grid.gridSec ? Math.ceil(clipDur / grid.gridSec) * PE_DENSITY_SLACK : Infinity;
  let hyst = PE_HYST_ST, minSec = grid.minNoteSec, notes = [];
  for (let pass = 0; ; pass++) {
    notes = peSegmentPass(an, clipDur, hyst, minSec);
    if (notes.length <= cap || pass >= PE_DENSITY_PASSES) return { notes, relaxed: pass };
    hyst *= 1.5;
    minSec = Math.min(minSec * 1.5, PE_MIN_NOTE_CEIL * 1.5);
  }
}


// ── Stage D — 편집 모델 (설계 §4-1) ────────────────────────────────────────
//
// 편집은 노트 id 가 아니라 **시간 구간**에 앵커된다. id 는 세그멘테이션 한 번 안에서만
// 유일하고, 세그멘테이션은 ⓐ재열기 후 Analyze(곡선을 저장하지 않으므로 매번) ⓑNOTES
// 설정 변경 ⓒ세그멘터 결함을 고치는 날 — 세 가지로 바뀐다. ⓒ가 결정적이었다: id 기반
// 이면 버그 수정이 기존 프로젝트의 편집을 전부 무효로 만든다.

// 튜닝 값은 모듈 const 가 아니라 이 객체에 둔다. 엔진의 PITCH_MIN_CONF 와 같은 방식이라
// 개발자 도구에서 `window.PE_TUNING.reattachTau = 0.4` 로 **재빌드 없이** 바꿔 볼 수 있고,
// 하네스가 같은 코드를 같은 파라미터로 스윕한다 — 재는 것과 도는 것이 갈라지지 않는다.
const PE_TUNING = {
  // edit 길이 대비 겹침 비율이 이 값 이상인 새 노트에 편집이 다시 붙는다.
  //
  // 계측으로 골랐다(2026-09-15 · 곡 8개 × 조건 7가지 · 무성 경계와 레가토 양쪽):
  //   τ      보존율   dup(번짐)   비고
  //   0.10    98%      0.3%      번짐이 생긴다 — 건드리지 않은 옆 음이 바뀐다
  //   0.25    92%      0%        ← 채택
  //   0.50    85%      0%        보존율만 7%p 낮고 얻는 것이 없다
  //
  // 🔴 이 값이 영향을 주는 것은 **사용자가 NOTES 설정을 바꿨을 때뿐**이다. 가장 흔한
  // 경로인 재열기(설정 동일)는 어느 값에서도 100% 였다. 올리면 막아 주는 것 없이
  // 편집이 조용히 사라지는 쪽으로만 기운다 — 0.5 를 고르려던 내 짐작이 계측에서 틀렸다.
  // 바꾸려면 `node tools/pitch-edit-reattach-harness.js` 를 먼저 돌릴 것.
  reattachTau: 0.25,
};
if (typeof window !== "undefined") window.PE_TUNING = PE_TUNING;

const peOverlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

// v2.7.3 — the clip-wide defaults. Mirrors the engine's pitchDefaults(): a project written
// before v2.7.3 has no block and reads as the values the app shipped with, which is what it
// was built under. 🔴 Keep the two in step — the engine clamps what is stored, this decides
// what is DRAWN, and a disagreement shows up as notes that look edited but save as pristine.
const PE_DEFAULTS = { strength: 1, keepVibrato: true };
function peDefaults(d) {
  // 🔴 Number(null) === 0 (NaN 이 아니다). 엔진의 pitchDefaults 와 같은 함정 — 그쪽 주석 참조.
  const s = d ? Number(d.strength) : NaN;
  return {
    strength: Number.isFinite(s) ? peClamp(s, 0, 1) : PE_DEFAULTS.strength,
    keepVibrato: d && d.keepVibrato !== undefined ? d.keepVibrato !== false : PE_DEFAULTS.keepVibrato,
  };
}

// 노트가 검출기가 제안한 그대로인가. 기본값은 저장하지 않는다 — peSegmentPass 가
// target 을 Math.round(midi) 로 **자동으로** 채우므로, 전부 저장하면 "사용자가 지정한
// 값"과 "검출값의 반올림"을 영영 구분할 수 없다. edits[] 에 있다는 것 자체가 사용자가
// 손댔다는 뜻이어야 한다.
//
// v2.7.3 — "그대로"의 기준이 상수 1/true 가 아니라 **클립 기본값**이다. 전역 슬라이더를
// 70% 로 내린 클립에서 70% 인 노트는 손대지 않은 것이고, 그래서 저장되지도 않고 화면에서
// 빨개지지도 않는다. 이 한 줄이 전역 기본값을 별도 필드로 둔 이유 전부다.
function peIsPristine(nt, defs) {
  const d = defs || PE_DEFAULTS;
  return nt.target === Math.round(nt.midi) && nt.strength === d.strength && nt.keepVibrato === d.keepVibrato;
}

// v2.7.3 — 🔴 peSegmentPass stamps every FRESH note with 1 / true, because that is what the
// detector proposes and it knows nothing about this clip. Re-stamp them with the clip's
// defaults before the stored edits go on. Skip this and a clip whose default is 0.5 opens with
// every note reading as "the user set this one to 1" — stored on the next save, and drawn in
// the moved-note colour — which is precisely what keeping the defaults out of edits[] was for.
// The stored edits are applied AFTER, so notes the user really did touch keep their own values.
function peSeedDefaults(notes, defs) {
  const d = defs || PE_DEFAULTS;
  return (notes || []).map((nt) => ({ ...nt, strength: d.strength, keepVibrato: d.keepVibrato }));
}

function peEditsFromNotes(notes, defs) {
  const out = [];
  for (const nt of notes || []) {
    if (peIsPristine(nt, defs)) continue;
    out.push({ t0: nt.t0, t1: nt.t1, target: nt.target, strength: nt.strength, keepVibrato: nt.keepVibrato });
  }
  return out;
}

// 저장된 edits[] 를 새 세그멘테이션에 다시 붙인다.
// 원본 notes 는 건드리지 않고 새 배열을 돌려준다(React state 규칙).
// missed = 붙을 노트를 못 찾은 편집 수. 🔴 조용히 버리면 안 된다 — 사용자는 편집이
// 사라진 것을 모른다. 화면에 개수를 띄운다.
function peApplyEdits(notes, edits, tau) {
  if (!edits || !edits.length) return { notes, missed: 0 };
  const t = Number.isFinite(tau) ? tau : PE_TUNING.reattachTau;
  const out = notes.map((nt) => ({ ...nt }));
  let missed = 0;
  for (const ed of edits) {
    const len = ed.t1 - ed.t0;
    if (!(len > 0)) { missed++; continue; }
    let hit = 0;
    for (const nt of out) {
      if (peOverlap(ed.t0, ed.t1, nt.t0, nt.t1) / len < t) continue;
      hit++;
      if (Number.isFinite(ed.target)) nt.target = ed.target;
      if (Number.isFinite(ed.strength)) nt.strength = ed.strength;
      if (typeof ed.keepVibrato === "boolean") nt.keepVibrato = ed.keepVibrato;
    }
    if (!hit) missed++;
  }
  return { notes: out, missed };
}

// v2.7.1 — rewrite the stored edits for the notes whose ids are in `ids`. `change(note)` returns
// the note as it should now be, or null for "back to what the detector proposed" (Reset).
//
// Every edit that currently LANDS on one of these notes (the same overlap rule as peApplyEdits)
// is taken out and replaced by one keyed to the note's own span. v2.7.0 matched edits by the
// note's exact t0/t1 instead, which missed an edit re-attached from a different span after a
// NOTES change and left two edits fighting over one note.
// A note OUTSIDE `ids` that shared a removed edit — one sung note cut into two pieces — gets
// its own copy, so editing or resetting one piece never silently resets its sibling. Nothing
// pristine is ever stored (설계 §4-1). Pure, so the harness measures exactly this code.
function peRewriteEdits(notes, edits, ids, change, tau, defs) {
  const t = Number.isFinite(tau) ? tau : PE_TUNING.reattachTau;
  const span = (nt) => ({ t0: nt.t0, t1: nt.t1, target: nt.target, strength: nt.strength, keepVibrato: nt.keepVibrato });
  const lands = (ed, nt) => { const len = ed.t1 - ed.t0; return len > 0 && peOverlap(ed.t0, ed.t1, nt.t0, nt.t1) / len >= t; };
  const hit = notes.filter((nt) => ids.has(nt.id));
  const removed = edits.filter((ed) => hit.some((nt) => lands(ed, nt)));
  const next = edits.filter((ed) => !removed.includes(ed));
  for (const nt of notes) {
    if (ids.has(nt.id) || peIsPristine(nt, defs)) continue;
    if (removed.some((ed) => lands(ed, nt))) next.push(span(nt));
  }
  for (const nt of hit) {
    const after = change(nt);
    if (after && !peIsPristine(after, defs)) next.push(span(after));
  }
  return next;
}

// v2.7.1 (R2) / v2.7.2 — colour for notes the user has moved.
//
// v2.7.1 picked among the theme's --violet / --blue / --green. The user then asked for something
// that stands out more — "a deep red family" (T-2.7.1-3). A FIXED deep red measured badly:
//   · 8 of the 10 themes are dark, and a deep red is itself dark — 1.21:1 against the roll in
//     "solar", i.e. LESS visible than what it replaced;
//   · the detected-pitch curve is --red, and in "sage" --red is already a deep crimson (#ba1a1a)
//     — a deep-red block there is 1.03:1 against the curve, and blocks are painted OVER it.
// So the colour comes from a red-family PALETTE, deep to vivid, picked PER THEME at paint time:
// among entries with at least PE_EDITED_MIN_CONTRAST against the roll background, the one
// farthest from both that theme's --red (the curve) and --amber (untouched notes). Result over
// the 10 themes: light "ivory" gets the deep red that was asked for, dark themes get a vivid
// crimson, and "sage" — light, but whose curve is already deep red — gets a vivid one to stay
// off the curve. Worst case: contrast 3.01, distance 61 from the curve, 81 from amber.
//
// ⚠️ Hex literals in canvas code are normally a smell here (v2.4.3: hardcoded canvas colours
// escaped the theme pass). These are a deliberate exception: no theme defines a red-family token
// distinct from --red, and every entry is FILTERED against the live theme tokens, so a theme
// change still re-picks. Pure and hex-only so tools/pitch-edits-persist-harness.js checks every
// theme with this exact code.
const PE_EDITED_REDS = ["#8f1022", "#a3122b", "#b8142e", "#d1182f", "#e8213a", "#ff2d4a", "#ff4d6d"];
const PE_EDITED_MIN_CONTRAST = 3.0;
function peHexRgb(s) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(s || "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function peRelLum(c) {
  const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}
function pePickEditedColor(cands, amber, red, bg) {
  const A = peHexRgb(amber), R = peHexRgb(red), B = peHexRgb(bg);
  if (!A || !R) return null;
  const dist = (x, y) => Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
  let best = null, bestScore = -1, any = null, anyScore = -1;
  for (const c of cands) {
    const X = peHexRgb(c);
    if (!X) continue;
    const score = Math.min(dist(X, A), dist(X, R));
    const cr = B ? (Math.max(peRelLum(X), peRelLum(B)) + 0.05) / (Math.min(peRelLum(X), peRelLum(B)) + 0.05) : 99;
    if (score > anyScore) { any = c; anyScore = score; }
    if (cr >= PE_EDITED_MIN_CONTRAST && score > bestScore) { best = c; bestScore = score; }
  }
  return best || any;
}
function peShade(hex, k) {
  const c = peHexRgb(hex);
  if (!c) return hex;
  return "rgb(" + c.map((v) => Math.round(v * k)).join(",") + ")";
}

// Pitch classes of the project's detected key, for the "outside the key" outline (설계 §12-2).
// The key string is the engine's own format — "C", "F#", "Am" — so minor is the trailing "m".
const PE_MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const PE_MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
function peScalePcs(key) {
  if (!key || typeof key !== "string") return null;
  const m = /^([A-G])([#b]?)(m?)$/.exec(key.trim());
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  const tonic = (base + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12) % 12;
  const steps = m[3] === "m" ? PE_MINOR_STEPS : PE_MAJOR_STEPS;
  return new Set(steps.map((x) => (tonic + x) % 12));
}

// v2.7.3 — Key snap. Returns the semitone in `pcs` nearest to `midi`.
//
// It takes a FRACTIONAL midi on purpose. `Snap all to key` feeds it the detected pitch, not
// the rounded target: a note sung at 60.6 in C major belongs on 60 by two thirds of a
// semitone, and rounding to 61 first would throw that away and then have to guess between
// 60 and 62.
//
// `dir` settles an exact tie — the pitch sitting halfway between two scale notes, which in a
// major key happens at every one of the five gaps. During a drag it is the direction of
// travel, so pushing up never lands the note below where it already was and the gesture
// cannot stall. With no direction (Snap all to key) ties go up, as Math.round does with .5.
function peSnapToScale(midi, pcs, dir) {
  const near = Math.round(midi);
  if (!pcs || !pcs.size) return near;
  let best = null, bestD = Infinity;
  for (let m = near - 6; m <= near + 6; m++) {
    if (!pcs.has(((m % 12) + 12) % 12)) continue;
    const d = Math.abs(m - midi);
    if (best === null || d < bestD - 1e-9) { best = m; bestD = d; continue; }
    if (Math.abs(d - bestD) <= 1e-9 && (dir < 0 ? m < best : m > best)) { best = m; bestD = d; }
  }
  return best === null ? near : best;
}

// Where one note lands for a drag of `dSemi` rows. Chromatic is the row itself; Key pulls
// that row to the nearest scale note. 🔴 Per note, never one shared delta: a selection of
// several notes sits on different scale degrees, so a shared delta would drag some of them
// out of the key the mode exists to keep them in.
function peDragTarget(nt, dSemi, pcs) {
  const raw = nt.target + dSemi;
  return pcs ? peSnapToScale(raw, pcs, dSemi) : raw;
}

// ══ v2.7.5 — 분할 / 병합: 경계는 사용자가 소유한다 (설계 §4-2) ════════════════════
//
// edits[] 가 "이 구간의 값"을 담는다면 layout[] 은 "이 구간의 경계"를 담는다. 값은 여전히
// 시간 겹침으로 다시 붙고(τ), 경계는 그 구간을 **통째로 대체**한다 — 사용자가 이긴다.
//
//   { t0, t1, cuts: [] }      → 병합. 내부 경계가 없다 = 한 음이다
//   { t0, t1, cuts: [1.62] }  → 분할. 1.62 에서 자른다

// 그 구간 안의 유성 프레임. 경계가 사용자 마음대로이므로 세그멘터의 run 을 쓸 수 없다.
function peFramesIn(an, t0, t1) {
  const idx = [], half = an.winSec / 2;
  for (let k = 0; k < an.frames; k++) {
    if (!an.voiced[k]) continue;
    const t = k * an.hopSec + half;          // frame CENTRE, as peSegmentPass uses
    if (t >= t0 && t <= t1) idx.push(k);
  }
  return idx;
}

// 한 소유 구간의 노트를 **지금 분석 결과에서** 만든다.
// 🔴 midi·confidence 를 저장값에서 읽지 않는 것이 핵심이다(설계 §4-2). 두 음을 합쳤으면
// 합친 구간 전체의 중앙값이 그 노트의 검출 음정이어야 하고, 그래야 peIsPristine 의
// `target === Math.round(midi)` 판정이 계속 참을 말한다 — 아니면 "움직인 노트" 색이 거짓이 된다.
function peSpanNotes(an, t0, t1, cuts, defs, idPrefix) {
  const d = defs || PE_DEFAULTS;
  const bounds = [t0].concat(cuts || []).concat([t1]);
  const out = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i], b = bounds[i + 1];
    if (!(b - a > 0)) continue;
    const idx = peFramesIn(an, a, b);
    if (!idx.length) continue;               // 무성뿐인 조각에는 노트가 없다
    let csum = 0;
    for (const k of idx) csum += an.conf[k];
    const midi = peCoreMedian(an, idx);
    out.push({
      id: idPrefix + i, t0: a, t1: b,
      midi, target: Math.round(midi),
      strength: d.strength, keepVibrato: d.keepVibrato,
      confidence: peClamp(csum / idx.length, 0, 1),
    });
  }
  return out;
}

// 세그멘터가 낸 노트 위에 소유 구간을 덮는다. `spans` 는 실제로 덮은 구간 수 — 화면에 알린다
// (설계 §4-2 ③). 알리지 않으면 NOTES 를 바꿔도 일부가 안 변하는 것이 고장으로 보인다.
function peApplyLayout(notes, layout, an, defs) {
  const src = notes || [];
  if (!an || !layout || !layout.length) return { notes: src, spans: 0 };
  let out = src.slice();
  let spans = 0, seq = 0;
  for (const sp of layout) {
    const mine = peSpanNotes(an, sp.t0, sp.t1, sp.cuts, defs, "L" + (++seq) + "_");
    if (!mine.length) continue;              // 유성이 없는 구간은 덮지 않는다
    const kept = [];
    for (const nt of out) {
      if (nt.t1 <= sp.t0 || nt.t0 >= sp.t1) { kept.push(nt); continue; }   // 바깥 — 그대로
      // 걸친 노트는 **잘라낸다**(설계 §4-2 ②). 남은 조각도 midi 를 다시 계산해야 정직하다.
      // 검출기 자신의 최소 길이보다 짧은 부스러기는 버린다.
      if (nt.t0 < sp.t0 && sp.t0 - nt.t0 >= PE_MIN_NOTE_FLOOR) {
        const p = peSpanNotes(an, nt.t0, sp.t0, [], defs, nt.id + "a");
        if (p.length) kept.push({ ...p[0], id: nt.id + "a" });
      }
      if (nt.t1 > sp.t1 && nt.t1 - sp.t1 >= PE_MIN_NOTE_FLOOR) {
        const q = peSpanNotes(an, sp.t1, nt.t1, [], defs, nt.id + "b");
        if (q.length) kept.push({ ...q[0], id: nt.id + "b" });
      }
    }
    out = kept.concat(mine);
    spans++;
  }
  // 🔴 시간 순으로 되돌린다 — Shift 구간 선택(v2.7.4)이 배열 순서를 그대로 믿는다.
  out.sort((a, b) => a.t0 - b.t0);
  return { notes: out, spans };
}

// 구간 하나를 소유 목록에 넣는다. 겹치는 기존 구간은 흡수해 하나로 합친다.
//   addCut    분할이면 자른 자리, 병합이면 null
//   dropInner 병합이면 true — 흡수한 구간의 **안쪽** 경계는 사라져야 병합이 된다.
//             바깥에 걸친 경계는 살린다(그 부분은 이번 조작의 대상이 아니다).
function peLayoutPut(layout, a, b, addCut, dropInner) {
  let t0 = a, t1 = b;
  const keep = [], cuts = [];
  for (const sp of layout || []) {
    if (sp.t1 <= a || sp.t0 >= b) { keep.push(sp); continue; }
    t0 = Math.min(t0, sp.t0); t1 = Math.max(t1, sp.t1);
    for (const c of sp.cuts || []) {
      if (dropInner && c > a && c < b) continue;
      cuts.push(c);
    }
  }
  if (Number.isFinite(addCut)) cuts.push(addCut);
  cuts.sort((x, y) => x - y);
  const uniq = [];
  for (const c of cuts) {
    if (c <= t0 || c >= t1) continue;
    if (uniq.length && c - uniq[uniq.length - 1] <= 1e-6) continue;
    uniq.push(c);
  }
  keep.push({ t0, t1, cuts: uniq });
  keep.sort((x, y) => x.t0 - y.t0);
  return keep;
}

// 구간을 세그멘터에게 돌려준다 (설계 §4-2 ④ — Reset). 걸친 구간은 **통째로** 놓는다:
// 일부만 놓아 조각을 남기면 사용자가 무엇을 소유 중인지 설명할 수 없게 된다.
function peLayoutRelease(layout, a, b) {
  return (layout || []).filter((sp) => sp.t1 <= a || sp.t0 >= b);
}

// 🔴 HARNESS BOUNDARY — END. peCentsOff is the first line the harness does NOT take.
// How far off the nearest semitone the singer actually was.
const peCentsOff = (nt) => Math.round((nt.midi - Math.round(nt.midi)) * 100);
const peFmtCents = (c) => (c > 0 ? "+" : "") + c + "¢";

// One shared empty set, so a roll with no selection does not allocate one per draw.
const PE_NO_SEL = new Set();

// v2.7.1 — which audio a pitch curve belongs to. Only these three change what was analysed:
// De-noise and other prints register a NEW source id, a trim moves the offset or the duration.
// Moving a clip on the timeline changes none of them — the curve is clip-relative.
// v2.8.1 — 🔴 기준은 `sourceId` 가 아니라 **분석이 실제로 읽은 오디오**, 즉 baseSourceId 다.
// Apply 는 clip.sourceId 를 프린트 결과로 갈아 끼우는데, 분석은 언제나 base 를 본다
// (engine `_pitchAnalysisSetup`, 설계 §2). sourceId 로 재면 Apply 할 때마다 곡선이 버려져
// 사용자가 매번 다시 Analyze 해야 한다 — 실제로는 잰 것이 그대로인데도.
const peAudioKey = (inf) => (inf
  ? ((inf.pitch && inf.pitch.baseSourceId) || inf.sourceId) + "|" + inf.sourceOffset + "|" + inf.duration
  : null);

// Canvas roundRect exists in this Electron, but it throws when the radius exceeds half the
// box — which happens on every note narrower than 6px. Clamping here keeps the caller simple.
function peRoundRect(g, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/* ---------- window frame ---------- */

function WindowControls() {
  if (!window.electronAPI || window.electronAPI.platform === "darwin") return <div style={{ width: 84 }} />;
  const act = (e, name) => { e.currentTarget.blur(); window.electronAPI.winAction(name); };
  const s = { width: 44, display: "grid", placeItems: "center", color: "var(--cream-2)", background: "transparent", border: "none", cursor: "pointer", WebkitAppRegion: "no-drag" };
  return (
    <div style={{ display: "flex", alignItems: "stretch", height: "100%" }}>
      {/* Minimize removed in v2.6.0: this window is a `parent:` (owned) window, so Windows gives
          it no taskbar button, and `frame: false` leaves nothing to minimise into - it collapsed
          to a stub bar with no way back. See electron/main.js minimizable:false. */}
      <button style={s} onMouseDown={(e) => e.preventDefault()} onClick={(e) => act(e, "maximize")} title="Maximize"><svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none"><rect x="5" y="5" width="14" height="14" rx="1.5" /></svg></button>
      <button style={{ ...s, fontSize: 17 }} onMouseDown={(e) => e.preventDefault()} onClick={(e) => act(e, "close")} title="Close"
        onMouseEnter={(e) => { e.currentTarget.style.background = "#b94a3a"; e.currentTarget.style.color = "#fff"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--cream-2)"; }}>×</button>
    </div>
  );
}

/* ---------- piano roll canvas ---------- */

// Drawn on a canvas rather than in the DOM: Stage C will put one note block per sung syllable
// and Stage B a pitch point every ~5 ms, which is thousands of elements for a 5-minute vocal.
//
// A canvas is NOT restyled by a CSS variable change — it holds pixels, not styled elements. The
// colours below are read once per draw, so `theme` has to be a real dependency of the drawing
// effect or the roll keeps the palette it was painted with (v2.0.0 defect, T-2.0.0-1 ④).
//
// The PLAYHEAD is deliberately a DOM element on top, not part of the drawing: it moves ~30
// times a second, and repainting the grid + waveform + curve at that rate to move one line
// would be pure waste.
function PianoRoll({ info, analysis, notes, selection, scalePcs, defs, view, range, theme, playhead, litMidi,
                     onSeek, onView, onRange, onPreview, onSelectNote, onNoteDrag }) {
  const wrapRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  // The wheel handler is attached imperatively (it needs passive:false to preventDefault), so
  // it reads live state through a ref instead of being torn down and rebound on every change.
  const liveRef = React.useRef(null);
  liveRef.current = { view, range, size, dur: (info && info.duration) || 0, notes, selection, onSeek, onView, onRange, onSelectNote, onNoteDrag };

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Geometry. The vertical scrollbar takes SB px off the right edge (there is no horizontal
  // one — the CLIP MAP strip above does that job), and every conversion below has to agree on
  // that or the playhead and click-to-seek land a few pixels off.
  const geo = (L) => {
    const rollW = Math.max(1, L.size.w - KEY_W - SB);
    const rollH = Math.max(1, L.size.h - RULER_H);
    const rows = peSpan(L.range) + 1;
    return { rollW, rollH, rows, rowH: rollH / rows };
  };
  const xToTime = (px) => {
    const L = liveRef.current, G = geo(L);
    return L.view.start + ((px - KEY_W) / G.rollW) * L.view.dur;
  };
  const yToMidi = (py) => {
    const L = liveRef.current, G = geo(L);
    return peClamp(Math.round(L.range.hi + 1 - (py - RULER_H) / G.rowH), PITCH_MIN, PITCH_MAX);
  };

  // Wheel. Conventions follow 참조 디자인 (plain = vertical, Shift = horizontal, Ctrl = time
  // zoom, Ctrl+Shift = key zoom); Alt stays a synonym for key zoom because v2.2.0 taught it and
  // there is no reason to break a habit that costs nothing.
  //
  // Both zooms anchor on the CURSOR, not the edge or the centre — that is what keeps the note
  // under the pointer still while zooming, the difference between "usable" and "chasing the
  // view". Scrolling is 1:1 with pixels: the content moves by what the wheel moved.
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      const L = liveRef.current;
      const dur = L.dur;
      if (!dur) return;
      e.preventDefault();
      const G = geo(L);
      const zoomTimeAt = (factor, anchorPx) => {
        const anchor = peClamp(xToTime(anchorPx), 0, dur);
        const nextDur = peClamp(L.view.dur * factor, Math.min(MIN_VIEW_SEC, dur), dur);
        const frac = L.view.dur > 0 ? (anchor - L.view.start) / L.view.dur : 0;
        L.onView({ start: peClamp(anchor - frac * nextDur, 0, Math.max(0, dur - nextDur)), dur: nextDur });
      };
      const zoomKeyAt = (factor, anchorPx) => {
        const span = peSpan(L.range);
        const next = peClamp(span * factor, MIN_SPAN, PITCH_MAX - PITCH_MIN);
        const anchor = L.range.hi + 1 - (anchorPx - RULER_H) / G.rowH;
        const frac = span > 0 ? peClamp((L.range.hi - anchor) / span, 0, 1) : 0.5;
        const hi = anchor + frac * next;
        L.onRange(peFitPitch(hi - next, hi));
      };
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        zoomKeyAt(Math.exp(e.deltaY * 0.0015), e.offsetY);
      } else if (e.ctrlKey || e.metaKey) {
        zoomTimeAt(Math.exp(e.deltaY * 0.0015), e.offsetX);
      } else if (e.altKey) {
        zoomKeyAt(Math.exp(e.deltaY * 0.0015), e.offsetY);
      } else if (e.shiftKey) {
        const step = ((e.deltaY || e.deltaX) / G.rollW) * L.view.dur;
        L.onView({ start: peClamp(L.view.start + step, 0, Math.max(0, dur - L.view.dur)), dur: L.view.dur });
      } else {
        // Wheel down = down the keyboard, so the range slides toward the low notes.
        const d = -(e.deltaY / G.rollH) * G.rows;
        L.onRange(peFitPitch(L.range.lo + d, L.range.hi + d));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  React.useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (css.getPropertyValue(name) || "").trim() || fallback;
    const C = {
      bg: v("--bg2", "#221d17"), bg1: v("--bg", "#1b1712"), surface: v("--surface", "#2a2520"),
      line: v("--line", "rgba(232,212,170,.10)"), lineStrong: v("--line-strong", "rgba(232,212,170,.18)"),
      cream: v("--cream", "#efe6d4"), dim: v("--dim", "#b0a690"), faint: v("--faint", "#5f574a"),
      muted: v("--muted", "#857c6b"), amber: v("--amber", "#e8b04b"), red: v("--red", "#d96a4e"),
      amberDeep: v("--amber-deep", "#8a6b2e"),
      onAmber: v("--mixer-bar-fg", "#241a0a"),
      keyWhite: v("--key-white", "#e6dcc6"), keyWhite2: v("--key-white-2", "#cbc0a6"),
      keyBlack: v("--key-black", "#221e18"), keyInk: v("--key-ink", "#4a4033"),
    };
    // v2.7.2 — red family, picked per theme (see PE_EDITED_REDS for the measurements).
    C.edited = pePickEditedColor(PE_EDITED_REDS, C.amber, C.red, C.bg) || C.amber;
    C.editedDeep = peShade(C.edited, 0.72);

    const W = size.w, H = size.h;
    const rollW = Math.max(1, W - KEY_W - SB);
    const rollH = Math.max(1, H - RULER_H);
    const rows = peSpan(range) + 1;
    const rowH = rollH / rows;
    const yOf = (midi) => RULER_H + (range.hi + 0.5 - midi) * rowH;
    const t0 = view.start, tDur = Math.max(1e-6, view.dur);
    const xOf = (t) => KEY_W + ((t - t0) / tDur) * rollW;
    const mLo = Math.max(PITCH_MIN, Math.floor(range.lo) - 1);
    const mHi = Math.min(PITCH_MAX, Math.ceil(range.hi) + 1);

    g.clearRect(0, 0, W, H);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);

    // Everything below draws into the roll box only; the last SB px on the right belong to
    // the vertical scrollbar, a DOM element sitting on top.
    g.save();
    g.beginPath(); g.rect(0, 0, W - SB, H); g.clip();

    // pitch rows — black keys shaded, octave boundaries stronger
    for (let m = mLo; m <= mHi; m++) {
      const y = yOf(m);
      if (isBlackKey(m)) { g.fillStyle = C.bg1; g.fillRect(KEY_W, y, rollW, rowH); }
      g.strokeStyle = (m % 12 === 0) ? C.lineStrong : C.line;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(KEY_W, Math.round(y) + 0.5); g.lineTo(W - SB, Math.round(y) + 0.5); g.stroke();
    }

    // Time ruler. The tick step follows the zoom — a fixed 1 s grid is a solid wall when
    // zoomed out and three lonely lines when zoomed in.
    g.fillStyle = C.bg1;
    g.fillRect(0, 0, W, RULER_H);
    g.strokeStyle = C.lineStrong;
    g.beginPath(); g.moveTo(0, RULER_H + 0.5); g.lineTo(W, RULER_H + 0.5); g.stroke();
    const pxPerSec = rollW / tDur;
    const STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    const step = STEPS.find((x) => x * pxPerSec >= 64) || STEPS[STEPS.length - 1];
    g.font = '9px "Space Mono", ui-monospace, monospace';
    g.textBaseline = "middle";
    for (let t = Math.floor(t0 / step) * step; t <= t0 + tDur + 1e-9; t += step) {
      if (t < -1e-9) continue;
      const x = Math.round(xOf(t)) + 0.5;
      if (x < KEY_W) continue;
      g.strokeStyle = C.lineStrong;
      g.beginPath(); g.moveTo(x, 4); g.lineTo(x, RULER_H); g.stroke();
      g.fillStyle = C.muted;
      g.fillText(peFmtTime(t), x + 3, RULER_H / 2);
      g.strokeStyle = C.line;
      g.beginPath(); g.moveTo(x, RULER_H); g.lineTo(x, H); g.stroke();
    }

    // waveform — behind the pitch information, centred, so it reads as "this is the audio
    // under the notes" rather than competing with them
    const peaks = info && info.peaks;
    const clipDur = (info && info.duration) || 0;
    if (peaks && peaks.mins && peaks.maxs && peaks.mins.length && clipDur > 0) {
      const n = peaks.mins.length;
      const midY = RULER_H + rollH / 2;
      const amp = (rollH / 2) * 0.86;
      const bucketSec = clipDur / n;
      const i0 = Math.max(0, Math.floor(t0 / bucketSec));
      const i1 = Math.min(n - 1, Math.ceil((t0 + tDur) / bucketSec));
      g.globalAlpha = 0.34;
      g.fillStyle = C.dim;
      const w = Math.max(1, bucketSec * pxPerSec);
      for (let i = i0; i <= i1; i++) {
        const x = xOf(i * bucketSec);
        const top = midY - Math.max(0, peaks.maxs[i]) * amp;
        const bot = midY - Math.min(0, peaks.mins[i]) * amp;
        g.fillRect(x, top, w, Math.max(1, bot - top));
      }
      g.globalAlpha = 1;
    }

    // Stage B — the detected pitch curve. Voiced runs are stroked as continuous segments and
    // unvoiced gaps genuinely break the line: a curve that bridged a breath would invent pitch
    // that is not there. Confidence drives opacity, so shaky detections look shaky.
    const an = analysis;
    if (an && an.frames) {
      g.lineWidth = 2;
      g.lineJoin = "round";
      g.lineCap = "round";
      // only the frames inside the visible window
      const k0 = peClamp(Math.floor((t0 - an.winSec) / an.hopSec), 0, an.frames - 1);
      const k1 = peClamp(Math.ceil((t0 + tDur) / an.hopSec), 0, an.frames - 1);
      let k = k0;
      while (k <= k1) {
        if (!an.voiced[k]) { k++; continue; }
        let end = k;
        while (end + 1 <= k1 && an.voiced[end + 1]) end++;
        if (end > k) {
          let csum = 0;
          for (let i = k; i <= end; i++) csum += an.conf[i];
          g.globalAlpha = 0.35 + 0.65 * peClamp(csum / (end - k + 1), 0, 1);
          // Red, not amber: Stage C hangs AMBER note blocks over this curve, and a detected
          // curve in the same colour as the target notes is unreadable the moment both are on
          // screen (참조 디자인 §3d — notes amber, detected pitch red).
          g.strokeStyle = C.red;
          g.beginPath();
          for (let i = k; i <= end; i++) {
            const t = i * an.hopSec + an.winSec / 2;   // frame centre, not its left edge
            const x = xOf(t), y = yOf(an.midi[i]);
            if (i === k) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
        }
        k = end + 1;
      }
      g.globalAlpha = 1;
    }

    // Stage C — the note blocks, drawn OVER the curve. Amber block, red curve (참조 디자인
    // §3d): the block is what a correction will act on, the curve is what was actually sung,
    // and the two have to be tellable apart at a glance.
    if (notes && notes.length) {
      const sel = selection || PE_NO_SEL;
      const nh = Math.max(3, Math.min(rowH - 2, 26));
      g.textBaseline = "middle";
      for (const nt of notes) {
        if (nt.t1 < t0 || nt.t0 > t0 + tDur) continue;
        const row = nt.target;
        if (row < mLo || row > mHi) continue;
        const x0 = xOf(nt.t0);
        const w = Math.max(2, xOf(nt.t1) - x0);
        const y = yOf(row) + (rowH - nh) / 2;
        const rad = Math.min(3, nh / 2, w / 2);
        const isSel = sel.has(nt.id);
        const offKey = scalePcs ? !scalePcs.has(((row % 12) + 12) % 12) : false;

        // A note the user has moved is filled in a different colour so it can be found again
        // among dozens of untouched ones (사용자 요청 R2). "Moved" is exactly peIsPristine's
        // negation — the same rule that decides what gets saved — so dragging a note back to
        // the detected pitch also turns it back to amber.
        const edited = !peIsPristine(nt, defs);
        const grad = g.createLinearGradient(0, y, 0, y + nh);
        grad.addColorStop(0, edited ? C.edited : C.amber);
        grad.addColorStop(1, edited ? C.editedDeep : C.amberDeep);
        // A block is only as solid as the detection behind it, so a shaky note looks shaky —
        // the same rule the curve already follows.
        g.globalAlpha = 0.45 + 0.55 * peClamp(nt.confidence, 0, 1);
        g.fillStyle = grad;
        peRoundRect(g, x0, y, w, nh, rad); g.fill();
        g.globalAlpha = 1;

        // Two outlines that must coexist: selection is a BRIGHT ring, "outside the project's
        // key" is a DASHED one (설계 §12-2). Colour therefore carries selection and the dash
        // carries the key, instead of both competing for the same channel.
        g.lineWidth = isSel ? 2 : 1;
        g.setLineDash(offKey ? [3, 2] : []);
        g.strokeStyle = isSel ? C.cream : (offKey ? C.dim : "rgba(0,0,0,.45)");
        peRoundRect(g, x0 + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, nh - 1), rad); g.stroke();
        g.setLineDash([]);

        // 설계 §12-2 — the block itself says which note it is; reading it off the keyboard
        // gutter is hard once the view is zoomed out. Thresholds are the reference design's
        // declutter rule (name at rowH >= 12 && w > 30, cents from w > 62): a label spilling
        // out of its block is worse than no label, so it is clipped to the block as well.
        if (rowH >= 12 && w > 30) {
          g.save();
          g.beginPath(); g.rect(x0, y, w, nh); g.clip();
          g.fillStyle = C.onAmber;
          g.font = "700 " + Math.min(11, Math.max(8, nh - 4)) + 'px "Space Mono", ui-monospace, monospace';
          g.fillText(midiName(row) + (w > 62 ? " " + peFmtCents(peCentsOff(nt)) : ""), x0 + 4, y + nh / 2);
          g.restore();
        }
      }
    }

    // Keyboard gutter — drawn last so nothing bleeds under it.
    //
    // The faces come from their own --key-* tokens rather than --cream / --bg (v2.2.0). Those
    // two are TEXT colours: on the light themes --cream is nearly black, so the "white" keys
    // came out dark and the note names — drawn in --faint, the palette's least-visible colour —
    // disappeared into them (T-2.2.0-2 요청 ③). A piano key is a piano key in every theme.
    g.fillStyle = C.surface;
    g.fillRect(0, RULER_H, KEY_W, rollH);
    const whiteFace = g.createLinearGradient(0, 0, KEY_W, 0);
    whiteFace.addColorStop(0, C.keyWhite2);
    whiteFace.addColorStop(1, C.keyWhite);
    for (let m = mLo; m <= mHi; m++) {
      const y = yOf(m);
      const black = isBlackKey(m);
      const kw = black ? KEY_W * 0.62 : KEY_W;   // sharps sit short, like the real thing
      const lit = litMidi === m;                 // sounding, or under the playhead
      g.fillStyle = lit ? C.amber : (black ? C.keyBlack : whiteFace);
      g.fillRect(0, y, kw, Math.max(1, rowH - 1));
      g.fillStyle = "rgba(0,0,0,.35)";
      g.fillRect(0, y, kw, 1);                   // key separation, independent of the theme
      // Label every C, and every white key once the rows are tall enough to read one. Bold,
      // dark ink, right-aligned against the key's edge — sized with the row so a tall row gets
      // a readable label instead of a fixed 8px one.
      const label = lit || (m % 12 === 0) || (!black && rowH >= 13);
      if (label && rowH >= 7) {
        g.fillStyle = lit ? C.onAmber : (black ? C.keyWhite : C.keyInk);
        g.font = "700 " + Math.min(9, Math.max(7, rowH - 4)) + 'px "Space Mono", ui-monospace, monospace';
        g.textAlign = "right";
        g.textBaseline = "middle";
        g.fillText(midiName(m), (black ? kw : KEY_W) - 5, y + rowH / 2);
        g.textAlign = "left";                    // the ruler draws left-aligned; leave it as found
      }
    }
    g.strokeStyle = C.lineStrong;
    g.beginPath(); g.moveTo(KEY_W + 0.5, RULER_H); g.lineTo(KEY_W + 0.5, H); g.stroke();
    g.restore();
    // `theme` is unused inside the draw, but it IS what the CSS variables above depend on —
    // it is in the dependency list to force a repaint, so do not "clean it up".
  }, [size, info, analysis, notes, selection, scalePcs, defs, view, range, theme, litMidi]);

  // Playhead overlay. Hidden when the transport sits outside this clip, so playback elsewhere
  // in the song does not park a misleading line at the edge of the roll.
  const clipDur = (info && info.duration) || 0;
  const rollW = Math.max(1, size.w - KEY_W - SB);
  const rollH = Math.max(1, size.h - RULER_H);
  const phX = (Number.isFinite(playhead) && playhead >= -1e-6 && playhead <= clipDur + 1e-6)
    ? KEY_W + ((playhead - view.start) / Math.max(1e-6, view.dur)) * rollW
    : null;

  // Mouse down on the roll. Left button seeks — or sounds a key, in the gutter. The MIDDLE
  // button pans both axes: it has to be a different button because the whole roll surface is
  // already the seek target, and Stage D's pan tool will take this over.
  const onDown = (e) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (px > size.w - SB) return;                          // the scrollbar gutter
    if (e.button === 1) {
      e.preventDefault();
      const v0 = { ...view }, r0 = { ...range }, sx = e.clientX, sy = e.clientY;
      const G = geo(liveRef.current);
      const move = (ev) => {
        const dt = -((ev.clientX - sx) / G.rollW) * v0.dur;
        const dm = ((ev.clientY - sy) / G.rollH) * G.rows;
        onView({ start: peClamp(v0.start + dt, 0, Math.max(0, clipDur - v0.dur)), dur: v0.dur });
        onRange(peFitPitch(r0.lo + dm, r0.hi + dm));
      };
      const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return;
    }
    if (e.button !== 0) return;
    if (px < KEY_W) {
      // The keyboard gutter is not a seek surface — it is a keyboard. Clicking a key sounds it,
      // which is what makes the detected curve checkable by ear (사용자 요청, T-2.0.2-1 ④).
      if (py > RULER_H && onPreview) onPreview(yToMidi(py));
      return;
    }
    // A click on a note SELECTS it instead of seeking. The block is what Stage D will edit,
    // and a note that could not be picked up without moving the transport would be unusable;
    // everywhere else the roll stays the seek surface it has always been.
    const L = liveRef.current;
    if (L.onSelectNote) {
      const t = xToTime(px), m = yToMidi(py);
      const hit = (L.notes || []).find((nt) => nt.target === m && t >= nt.t0 && t <= nt.t1);
      if (hit) {
        // v2.7.1 (B1). Pressing a note that is ALREADY selected must not change the selection
        // yet: Ctrl/Shift+press used to toggle it OFF on mousedown, so the drag that followed
        // moved that one note alone while the rest stayed highlighted (T-2.7.0-1 ②b). A plain
        // press on one note of a multi-selection had the same hole — it collapsed the group
        // before the drag could carry it. The change is now deferred: if the gesture turns into
        // a drag the whole selection moves; if it ends without moving it was a click, and the
        // toggle / collapse is applied on mouseup — the usual DAW behaviour.
        // v2.7.4 (R1) — Ctrl wins over Shift if both are held, because Ctrl asks for the
        // smaller, more deliberate change.
        const mode = (e.ctrlKey || e.metaKey) ? "toggle" : (e.shiftKey ? "range" : "replace");
        const selNow = L.selection || PE_NO_SEL;
        // The deferral still covers every mode that would DISTURB a selection the press might
        // be about to drag: toggle would drop this note, range would rebuild the set, and a
        // plain press on one note of a group would collapse it.
        const deferSelect = selNow.has(hit.id) && (mode !== "replace" || selNow.size > 1);
        if (!deferSelect) L.onSelectNote(hit.id, mode);
        if (deferSelect && !L.onNoteDrag) L.onSelectNote(hit.id, mode);
        // Stage D — the same press that selects also starts a vertical drag on the target
        // pitch. Rows are whole semitones, so the delta is rounded to a row: dragging is a
        // chromatic move, never a continuous detune (that is what `strength` is for).
        // 🔴 The gesture reports live for the on-screen preview but commits ONCE, on mouseup —
        // 설계 §11-2 requires one undo entry per drag, not one per mouse-move.
        if (L.onNoteDrag) {
          const G = geo(L);
          const sy = e.clientY;
          let last = 0, moved = false;
          const move = (ev) => {
            const d = Math.round(-(ev.clientY - sy) / Math.max(1, G.rowH));
            if (d === last) return;
            last = d; moved = true;
            L.onNoteDrag(hit.id, d, false);
          };
          const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
            if (moved) L.onNoteDrag(hit.id, last, true);
            else if (deferSelect) L.onSelectNote(hit.id, mode);
          };
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        }
        return;
      }
      L.onSelectNote(null, "replace");
    }
    if (onSeek) onSeek(peClamp(xToTime(px), 0, clipDur));
  };

  // The vertical thumb maps its pixel delta back through the same ratio that sized it.
  const dragBar = (e) => {
    e.preventDefault(); e.stopPropagation();
    const sy = e.clientY;
    const r0 = { ...range };
    const total = PITCH_MAX - PITCH_MIN + 1;
    const move = (ev) => {
      const dm = -((ev.clientY - sy) / Math.max(1, rollH)) * total;
      onRange(peFitPitch(r0.lo + dm, r0.hi + dm));
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const total = PITCH_MAX - PITCH_MIN + 1;
  const vFrac = peClamp((peSpan(range) + 1) / total, 0, 1);
  const vPos = peClamp((PITCH_MAX - range.hi) / total, 0, 1);

  return (
    <div className="pe-roll" ref={wrapRef} onMouseDown={onDown}>
      <canvas ref={canvasRef} />
      {phX !== null && phX >= KEY_W && phX <= size.w - SB &&
        <div className="pe-playhead" style={{ left: phX }} />}
      <div className="pe-vbar" title="Drag to move up / down the keyboard">
        <div className="pe-thumb" onMouseDown={dragBar}
          style={{ top: (vPos * 100) + "%", height: "max(24px," + (vFrac * 100) + "%)" }} />
      </div>
    </div>
  );
}

/* ---------- clip overview strip ---------- */

// The whole clip at a glance, with the current view drawn on it as a box. This is the piece
// that was missing when the user reported "좌우로 이동(탐색)이 되지 않습니다": plain-wheel
// scrolling did work, but with no scrollbar and no map there was nothing on screen to say so,
// and no way to see WHERE in the clip the view sat.
//
// It draws the same 4000-bucket peaks the roll already holds, so it costs no extra analysis —
// only a second, cheaper paint.
function ClipOverview({ info, analysis, view, playhead, theme, onView }) {
  const wrapRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  // Height is MEASURED, not assumed: the strip's CSS box is 46px minus its bottom border, and
  // a backing store sized to the wrong number quietly scales every pixel drawn into it.
  const [{ w, H }, setBox] = React.useState({ w: 0, H: 0 });
  const dur = (info && info.duration) || 0;

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, H: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !w || !H) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const v = (n, f) => (css.getPropertyValue(n) || "").trim() || f;
    const C = { bg: v("--bg", "#1b1712"), dim: v("--dim", "#b0a690"), amber: v("--amber", "#e8b04b"),
                red: v("--red", "#d96a4e") };

    g.clearRect(0, 0, w, H);
    g.fillStyle = C.bg; g.fillRect(0, 0, w, H);
    const xOf = (t) => (dur > 0 ? (t / dur) * w : 0);

    const peaks = info && info.peaks;
    if (peaks && peaks.mins && peaks.mins.length && dur > 0) {
      const n = peaks.mins.length, mid = H / 2, amp = (H / 2) * 0.82;
      g.globalAlpha = 0.5; g.fillStyle = C.dim;
      // One column per screen pixel, taking the EXTREMES of every bucket that falls in it.
      // Sampling instead (one bucket per column) would drop short peaks entirely — 4000 buckets
      // squeezed into ~700 px throws away five out of six of them.
      for (let x = 0; x < w; x++) {
        const a = Math.floor((x / w) * n), b = Math.max(a + 1, Math.floor(((x + 1) / w) * n));
        let lo = 0, hi = 0;
        for (let i = a; i < b && i < n; i++) {
          if (peaks.mins[i] < lo) lo = peaks.mins[i];
          if (peaks.maxs[i] > hi) hi = peaks.maxs[i];
        }
        g.fillRect(x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
      }
      g.globalAlpha = 1;
    }

    // Where the detector found a pitch — a two-pixel ribbon along the bottom. It answers
    // "which part of this clip is even worth zooming into" at a glance.
    if (analysis && analysis.frames && dur > 0) {
      g.fillStyle = C.red; g.globalAlpha = 0.55;
      const fw = Math.max(1, (analysis.hopSec / dur) * w);
      for (let k = 0; k < analysis.frames; k++) {
        if (!analysis.voiced[k]) continue;
        g.fillRect(xOf(k * analysis.hopSec), H - 3, fw, 2);
      }
      g.globalAlpha = 1;
    }

    // The viewport box: DIM what is off-screen rather than outline what is on it, so the eye
    // reads the bright part as "this is what you are looking at".
    if (dur > 0 && view.dur < dur - 1e-6) {
      const x0 = xOf(view.start), x1 = xOf(view.start + view.dur);
      g.fillStyle = "rgba(0,0,0,.45)";
      g.fillRect(0, 0, x0, H); g.fillRect(x1, 0, w - x1, H);
      g.strokeStyle = C.amber; g.lineWidth = 1;
      g.strokeRect(Math.round(x0) + 0.5, 0.5, Math.max(2, x1 - x0) - 1, H - 1);
    }

    if (Number.isFinite(playhead) && playhead >= 0 && playhead <= dur) {
      g.fillStyle = C.red; g.fillRect(Math.round(xOf(playhead)), 0, 1.5, H);
    }
  }, [w, H, info, analysis, view, playhead, theme]);

  // Click outside the box jumps there; inside it drags; the edges resize (= zoom).
  const onDown = (e) => {
    if (!dur || !w || e.button !== 0) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const x0 = (view.start / dur) * w, x1 = ((view.start + view.dur) / dur) * w;
    const EDGE = 5;
    const v0 = { ...view }, sx = e.clientX;
    let mode = "jump";
    if (v0.dur < dur - 1e-6) {
      if (Math.abs(px - x0) <= EDGE) mode = "l";
      else if (Math.abs(px - x1) <= EDGE) mode = "r";
      else if (px > x0 && px < x1) mode = "pan";
    }
    if (mode === "jump") {
      const t = peClamp((px / w) * dur, 0, dur);
      onView({ start: peClamp(t - view.dur / 2, 0, Math.max(0, dur - view.dur)), dur: view.dur });
      return;
    }
    const move = (ev) => {
      const dt = ((ev.clientX - sx) / w) * dur;
      if (mode === "pan") {
        onView({ start: peClamp(v0.start + dt, 0, Math.max(0, dur - v0.dur)), dur: v0.dur });
      } else if (mode === "l") {
        const start = peClamp(v0.start + dt, 0, v0.start + v0.dur - MIN_VIEW_SEC);
        onView({ start, dur: v0.start + v0.dur - start });
      } else {
        const end = peClamp(v0.start + v0.dur + dt, v0.start + MIN_VIEW_SEC, dur);
        onView({ start: v0.start, dur: end - v0.start });
      }
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="pe-overview">
      <div className="pe-ovlabel"><span>CLIP</span><span style={{ opacity: .7 }}>MAP</span></div>
      <div className="pe-ovcanvas" ref={wrapRef} onMouseDown={onDown}
        title="Click to jump · drag the bright box to scroll · drag its edges to zoom">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

/* ---------- app ---------- */

function PitchEditorApp() {
  const trackId = React.useMemo(() => peQuery("track"), []);
  const clipId = React.useMemo(() => peQuery("clip"), []);
  const [theme, setTheme] = React.useState("default");
  const [projectName, setProjectName] = React.useState("");
  const [info, setInfo] = React.useState(null);
  const [error, setError] = React.useState("");
  const [analysis, setAnalysis] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [note, setNote] = React.useState("");
  // Visible time window in CLIP-relative seconds, and the visible pitch range in MIDI.
  const [view, setView] = React.useState({ start: 0, dur: 0 });
  const [range, setRange] = React.useState({ lo: PITCH_MIN, hi: PITCH_MAX });
  const [transport, setTransport] = React.useState({ playhead: null, isPlaying: false });
  const [clipLoop, setClipLoop] = React.useState(false);
  const [sideOpen, setSideOpen] = React.useState(true);
  // Stage C. `division` is the note grid the segmenter measures against (설계 §12-1) and
  // `selection` holds note ids — a Set, because Stage D selects ranges of them.
  const [division, setDivision] = React.useState(16);
  const [selection, setSelection] = React.useState(PE_NO_SEL);
  // Stage D (설계 §4-1). `edits` is the truth the STUDIO owns and the project file keeps;
  // the notes on screen are derived from (analysis → segmentation → these). `drag` is the
  // in-flight gesture — held apart so a drag paints live without pushing an undo per pixel.
  //
  // v2.7.1 (B2) — there is NO window-local undo stack any more. Every edit is one entry on the
  // studio stack and Ctrl+Z / Ctrl+Y are forwarded, like every other satellite window. See
  // 설계 §11-2 (개정 2026-09-17) for why the local stack existed and why it had to go.
  const [edits, setEdits] = React.useState([]);
  // v2.7.3 — the clip-wide defaults those edits depart from. A SECOND piece of studio-owned
  // truth, deliberately not folded into edits[]: see peIsPristine. `snapMode` is window-local
  // by contrast — it steers the next gesture and changes nothing about the clip, so it has no
  // business in the project file or on the undo stack.
  const [defs, setDefs] = React.useState(PE_DEFAULTS);
  // v2.7.5 — the spans whose BOUNDARIES the user owns (설계 §4-2). Studio-owned truth like
  // edits and defaults; the third and last thing the project file keeps for a pitch edit.
  const [layout, setLayout] = React.useState([]);
  const [snapMode, setSnapMode] = React.useState("chromatic");
  // v2.8.1 — Apply 가 도는 중인가. 렌더는 스튜디오 창에서 돌고 이 창은 답을 기다린다.
  const [printing, setPrinting] = React.useState(false);
  const [printPct, setPrintPct] = React.useState(0);
  const [drag, setDrag] = React.useState(null);
  const defsRef = React.useRef(defs); defsRef.current = defs;
  const layoutRef = React.useRef(layout); layoutRef.current = layout;
  const editsRef = React.useRef(edits); editsRef.current = edits;
  const selectionRef = React.useRef(selection); selectionRef.current = selection;
  const notesRef = React.useRef([]);
  // Identity of the audio the current curve was measured on (source · offset · duration).
  // A studio undo/redo used to drop the curve unconditionally — correct while this window was
  // read-only, but once notes could be edited, undoing a single note move threw away seconds of
  // analysis (T-2.7.0-4). The curve is now dropped only when this identity actually changes.
  const analysisKeyRef = React.useRef(null);
  const [struck, setStruck] = React.useState(null);   // key flashed by a preview click
  const viewRef = React.useRef(view); viewRef.current = view;
  const infoRef = React.useRef(info); infoRef.current = info;
  const transportRef = React.useRef(transport); transportRef.current = transport;
  const transportSeenRef = React.useRef(false);   // a real report has arrived, not the default
  const stoppedOnOpen = React.useRef(false);
  // "Did playback start from THIS window?" — see the auto-stop effect for why it matters.
  const ownPlayRef = React.useRef(false);
  const wasPlayingRef = React.useRef(false);
  const clipLoopRef = React.useRef(false); clipLoopRef.current = clipLoop;
  const struckTimer = React.useRef(null);

  const requestClip = React.useCallback(() => {
    if (!trackId || !clipId) { setError("No clip was passed to the editor."); return; }
    // 4000 is the engine's cap. Peaks are computed once and then zoomed INTO, so asking for
    // the maximum is what keeps the waveform from turning blocky as soon as the user zooms.
    peChannel.postMessage({ type: "REQUEST_PITCH_CLIP", trackId, clipId, buckets: 4000 });
  }, [trackId, clipId]);

  const runAnalyze = React.useCallback(() => {
    if (!trackId || !clipId || busy) return;
    setBusy(true); setProgress(0); setNote(""); setAnalysis(null);
    peChannel.postMessage({ type: "REQUEST_PITCH_ANALYZE", trackId, clipId });
  }, [trackId, clipId, busy]);

  React.useEffect(() => {
    peChannel.postMessage({ type: "ADVANCED_READY" });
    const onMsg = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "INIT_STATE" || msg.type === "SYNC_STATE") {
        if (msg.theme) { peApplyThemeAttr(msg.theme); setTheme(msg.theme); }
        if (typeof msg.projectName === "string") setProjectName(msg.projectName);
        // Studio re-broadcasts on ready / undo / redo / rename. Undo can move, trim or
        // replace this clip, so re-pull it on every broadcast rather than trusting the copy
        // taken when the window opened.
        requestClip();
        // v2.7.1 — the curve is NOT dropped here any more. A curve measured from old audio
        // would still quietly lie, so the check moved to the PITCH_CLIP reply this request
        // produces, where it can compare the audio's identity instead of assuming it changed.
      } else if (msg.type === "PITCH_PRINT_PROGRESS") {
        if (msg.trackId !== trackId || msg.clipId !== clipId) return;
        setPrintPct(msg.total ? msg.done / msg.total : 0);
      } else if (msg.type === "PITCH_PRINTED" || msg.type === "PITCH_REVERTED") {
        if (msg.trackId !== trackId || msg.clipId !== clipId) return;
        setPrinting(false);
        setPrintPct(0);
        setNote(msg.message || "");
        // 🔴 곡선은 버리지 않는다. 분석은 baseSourceId 를 읽고 그것은 프린트로 바뀌지
        //    않는다(peAudioKey 가 그 기준이다) — 사용자가 다시 Analyze 할 이유가 없다.
        requestClip();
      } else if (msg.type === "PITCH_CLIP") {
        if (msg.trackId !== trackId || msg.clipId !== clipId) return;
        if (msg.ok && msg.info) {
          setInfo(msg.info);
          setError("");
          // Stage D — the studio's edits are the truth (first load, a studio undo/redo, or the
          // echo of our own send). Adopt them whenever they differ from what is on screen.
          const incoming = (msg.info.pitch && Array.isArray(msg.info.pitch.edits)) ? msg.info.pitch.edits : [];
          if (JSON.stringify(incoming) !== JSON.stringify(editsRef.current)) setEdits(incoming);
          // v2.7.3 — same rule for the defaults. peDefaults() fills in for a project saved
          // before this version, so an old clip opens as the 1 / true it was built under.
          const inDefs = peDefaults(msg.info.pitch && msg.info.pitch.defaults);
          const curDefs = defsRef.current;
          if (inDefs.strength !== curDefs.strength || inDefs.keepVibrato !== curDefs.keepVibrato) setDefs(inDefs);
          // v2.7.5 — and the owned spans. Same rule: the studio's copy is the truth.
          const inLay = (msg.info.pitch && Array.isArray(msg.info.pitch.layout)) ? msg.info.pitch.layout : [];
          if (JSON.stringify(inLay) !== JSON.stringify(layoutRef.current)) setLayout(inLay);
          // v2.7.1 (B2) — drop the curve only if the AUDIO under it changed. De-noise makes a
          // new source id, a trim changes offset/duration; a note-edit undo or a clip MOVE
          // changes neither (the curve is clip-relative), so the analysis survives those.
          const key = peAudioKey(msg.info);
          if (analysisKeyRef.current && analysisKeyRef.current !== key) {
            analysisKeyRef.current = null;
            setAnalysis(null);
          }
          // Fit the whole clip on first load, and re-fit if the clip got shorter under us
          // (a trim or an undo) so the view can never point past the end.
          const dur = msg.info.duration || 0;
          const cur = viewRef.current;
          if (!cur.dur || cur.dur > dur || cur.start + cur.dur > dur + 1e-6) setView({ start: 0, dur });
        } else { setInfo(null); setError(msg.message || "This clip could not be read."); }
      } else if (msg.type === "PITCH_ANALYZE_PROGRESS") {
        if (msg.trackId !== trackId || msg.clipId !== clipId) return;
        setProgress(msg.total ? msg.done / msg.total : 0);
      } else if (msg.type === "PITCH_ANALYSIS") {
        if (msg.trackId !== trackId || msg.clipId !== clipId) return;
        setBusy(false); setProgress(0);
        if (msg.ok && msg.analysis) {
          setAnalysis(msg.analysis);
          analysisKeyRef.current = peAudioKey(infoRef.current);
          setNote("");
          setRange(peFitRange(msg.analysis));   // frame what was actually sung
        } else { setAnalysis(null); setNote(msg.message || "Pitch analysis failed."); }
      } else if (msg.type === "TRANSPORT_STATE") {
        transportSeenRef.current = true;
        const clip = infoRef.current;
        // The studio reports SONG time; this window works in clip time.
        const rel = (clip && Number.isFinite(msg.playhead)) ? msg.playhead - (clip.start || 0) : null;
        setTransport({ playhead: rel, isPlaying: !!msg.isPlaying });
      }
    };
    peChannel.addEventListener("message", onMsg);
    requestClip();
    return () => peChannel.removeEventListener("message", onMsg);
  }, [requestClip, trackId, clipId]);

  // Poll the transport (~30 fps). The studio does broadcast the playhead every frame, but only
  // while the mixer / advanced windows are open — polling keeps this window independent of
  // whether those happen to be up, the same choice the vocal strip made for its GR meters.
  React.useEffect(() => {
    const iv = setInterval(() => peChannel.postMessage({ type: "REQUEST_TRANSPORT" }), 33);
    return () => clearInterval(iv);
  }, []);

  // Follow the playhead while playing, but only when zoomed in: at full-clip zoom there is
  // nothing to follow, and scrolling a fitted view would just fight the user.
  React.useEffect(() => {
    if (!transport.isPlaying || !info) return;
    const dur = info.duration || 0;
    const p = transport.playhead;
    if (!Number.isFinite(p) || view.dur >= dur - 1e-6) return;
    if (p < view.start || p > view.start + view.dur) {
      setView({ start: peClamp(p - view.dur * 0.15, 0, Math.max(0, dur - view.dur)), dur: view.dur });
    }
  }, [transport.playhead, transport.isPlaying, info, view.start, view.dur]);

  // Safety net only (initial mount, and any future path that sets theme without the helper).
  React.useEffect(() => { peApplyThemeAttr(theme); }, [theme]);

  // Theme changes are broadcast on their own channel while this window is open (same as the
  // vocal strip): INIT_STATE only carries the theme at open time.
  React.useEffect(() => {
    let ch = null;
    try {
      ch = new BroadcastChannel("focusdaw-theme-sync");
      ch.addEventListener("message", (e) => {
        if (e.data && e.data.type === "THEME_CHANGED" && e.data.theme) { peApplyThemeAttr(e.data.theme); setTheme(e.data.theme); }
      });
    } catch (_) { /* channel unavailable — theme still arrives with INIT_STATE */ }
    return () => { try { ch && ch.close(); } catch (_) {} };
  }, []);

  const seekTo = React.useCallback((tRel) => {
    const clip = infoRef.current;
    if (!clip) return;
    peChannel.postMessage({ type: "REQUEST_SEEK", t: (clip.start || 0) + tRel });
  }, []);
  // ▶ starts at the CLIP, not at wherever the song happens to be parked. This window edits one
  // clip; a Play that begins somewhere else in the song is a Play that does nothing audible
  // here. Already inside the clip, the position is left alone — otherwise it would be
  // impossible to resume from the middle.
  const playPause = React.useCallback(() => {
    const t = transportRef.current, clip = infoRef.current;
    if (!t.isPlaying) ownPlayRef.current = true;      // this window is starting playback
    if (!t.isPlaying && clip) {
      const p = t.playhead;
      if (!Number.isFinite(p) || p < 0 || p > (clip.duration || 0)) {
        peChannel.postMessage({ type: "REQUEST_SEEK", t: clip.start || 0 });
      }
    }
    peChannel.postMessage({ type: "REQUEST_PLAY_PAUSE" });
  }, []);

  // ■ returns to the start of the CLIP for the same reason — the song's 0 s is not this
  // window's zero. (`stopRef` lets the auto-stop effect above call this without depending on
  // declaration order.)
  const stopRef = React.useRef(null);
  const stop = React.useCallback(() => {
    peChannel.postMessage({ type: "REQUEST_STOP", fromEditor: true });
    const clip = infoRef.current;
    if (clip) peChannel.postMessage({ type: "REQUEST_SEEK", t: clip.start || 0 });
  }, []);
  stopRef.current = stop;

  // Opening this window while the song is rolling is confusing: the editor's transport is
  // clip-scoped, so a studio playing something else underneath reads as the editor being
  // broken (사용자 보고, v2.3.3). Stop ONCE — when the window first knows both the clip and
  // the real transport state — and never again, so playing from here afterwards is free.
  // The studio side refuses this while recording: a take must not be cut short by opening a
  // window. Stopping goes through stop(), which parks at the clip's start rather than the
  // song's zero.
  React.useEffect(() => {
    if (stoppedOnOpen.current || !info || !transportSeenRef.current) return;
    stoppedOnOpen.current = true;
    if (transport.isPlaying) stopRef.current();
  }, [info, transport]);

  // Playback started here stops at the end of the CLIP. Editing one clip while the song keeps
  // rolling past it is the transport running away from the work — and with the roll ending at
  // the clip's edge there is nothing left on screen to follow.
  //
  // Only playback THIS window started, though: leaving the editor open while auditioning the
  // whole song from the studio must not cut that off at the clip's edge. Ownership is claimed
  // when ▶ is pressed here and released on the next observed play→stop transition, so a Play
  // pressed in the studio never carries this window's flag.
  //
  // Skipped when CLIP loop is on — there the engine wraps at the same boundary, which is the
  // whole point of the toggle.
  React.useEffect(() => {
    if (!transport.isPlaying && wasPlayingRef.current) ownPlayRef.current = false;
    wasPlayingRef.current = transport.isPlaying;
    if (!transport.isPlaying || !ownPlayRef.current || clipLoop || !info) return;
    const d = info.duration || 0;
    const p = transport.playhead;
    if (!d || !Number.isFinite(p) || p < d - 1e-3) return;
    // Through stop(), so the end of the clip leaves the transport exactly where ■ would —
    // two ways to reach the same state must not park the playhead in two different places.
    ownPlayRef.current = false;   // one stop per run, not one per 33 ms poll until it takes
    stopRef.current();
  }, [transport.isPlaying, transport.playhead, clipLoop, info]);

  // CLIP loop. The studio already has a working loop (the Repeat region, honoured by both the
  // web and the native engine), so this BORROWS it rather than inventing a second mechanism —
  // and hands the user's own region back on release. The studio side refuses the takeover
  // while recording, where the region means something else entirely (punch's in/out).
  const applyClipLoop = React.useCallback((on) => {
    const clip = infoRef.current;
    if (on && clip) {
      const start = clip.start || 0;
      peChannel.postMessage({ type: "REQUEST_LOOP_RANGE", start, end: start + (clip.duration || 0) });
    } else {
      peChannel.postMessage({ type: "REQUEST_LOOP_RANGE", restore: true });
    }
  }, []);
  const toggleClipLoop = React.useCallback(() => setClipLoop((on) => !on), []);

  // Closing the editor must not leave the studio looping a clip the user never asked to loop.
  React.useEffect(() => {
    const release = () => {
      if (clipLoopRef.current) peChannel.postMessage({ type: "REQUEST_LOOP_RANGE", restore: true });
    };
    window.addEventListener("beforeunload", release);
    return () => { window.removeEventListener("beforeunload", release); release(); };
  }, []);

  // ONE place applies the loop, so a toggle and a clip that moved underneath cannot each send
  // their own message. The clip can move or be trimmed under us (an undo, an edit in the
  // studio), and the loop has to follow it or it keeps looping the span the clip used to hold.
  const loopInit = React.useRef(false);
  React.useEffect(() => {
    if (!loopInit.current) { loopInit.current = true; if (!clipLoop) return; }   // nothing to release on mount
    applyClipLoop(clipLoop && !!info);
  }, [clipLoop, info && info.start, info && info.duration, applyClipLoop]);

  // Sounding a key is what makes the detected curve checkable by ear; the flash tells the eye
  // which key it was, since the sound is gone in a second.
  const previewKey = React.useCallback((midi) => {
    peTone(midi);
    setStruck(midi);
    clearTimeout(struckTimer.current);
    struckTimer.current = setTimeout(() => setStruck(null), 420);
  }, []);

  // Click = select one; Ctrl/Shift+click = add or remove. Clicking empty roll clears, and
  // returns the SAME set when it was already empty so the roll is not repainted for nothing.
  // v2.7.4 (R1) — three ways to select, the way a file list or any other DAW does it.
  // v2.7.3 and earlier had ONE: Ctrl and Shift both toggled a single note, so there was no way
  // to take a run of notes without clicking every one of them (사용자 요청 2026-09-21).
  //
  //   "replace"  plain click      — this note alone, and it becomes the anchor
  //   "toggle"   Ctrl / Cmd+click — add or remove this one, and it becomes the anchor
  //   "range"    Shift+click      — everything from the anchor to here
  //
  // The anchor STAYS PUT after a range select, so shift-clicking again re-measures from the
  // same note instead of creeping — that is what makes a range adjustable.
  const anchorRef = React.useRef(null);
  const selectNote = React.useCallback((id, mode) => {
    if (id == null) {
      // Clicking empty space clears the anchor too. Leaving it would let the next Shift+click
      // sweep up a range measured from a note the user stopped caring about.
      anchorRef.current = null;
      setSelection((prev) => (prev.size ? PE_NO_SEL : prev));
      return;
    }
    let m = mode;
    if (m === "range") {
      // notesRef is in time order (peVoicedRuns walks the clip forwards), so the range is just
      // the slice between the two indices.
      const all = notesRef.current || [];
      const i = all.findIndex((nt) => nt.id === anchorRef.current);
      const j = all.findIndex((nt) => nt.id === id);
      if (i >= 0 && j >= 0) {
        const lo = Math.min(i, j), hi = Math.max(i, j);
        const next = new Set();
        for (let k = lo; k <= hi; k++) next.add(all[k].id);
        setSelection(next);
        return;
      }
      // No usable anchor — the window just opened, or a re-cut retired the note it named.
      // Fall back to a plain click rather than doing nothing the user can explain.
      m = "replace";
    }
    if (m === "toggle") {
      setSelection((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      anchorRef.current = id;
      return;
    }
    setSelection((prev) => ((prev.size === 1 && prev.has(id)) ? prev : new Set([id])));
    anchorRef.current = id;
  }, []);

  React.useEffect(() => {
    const onKey = (e) => {
      // Undo / redo belong to the window the user is looking at. Every other satellite window
      // already forwards them (vocal strip, advanced EQ, mixer); this one did not, so a clip
      // change made from here had to be undone by clicking back to the studio first — the
      // inconvenience reported against T-2.0.2-1 ⑧. There was no design reason for it: Stage
      // A/B make no edits of their own, so nothing had asked for the binding yet.
      //
      // v2.7.1 — note edits live on the STUDIO stack too, so this forward is the whole story:
      // one stack, one order, Redo included. (Stage D first shipped a window-local stack in
      // front of this; it fought the studio stack — 설계 §11-2 개정.)
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault(); peChannel.postMessage({ type: "REQUEST_UNDO" }); return;
      }
      if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault(); peChannel.postMessage({ type: "REQUEST_REDO" }); return;
      }
      // Ctrl/Cmd+R runs the analysis. The button lives in the side panel, so folding the
      // panel used to make the window's most-used action unreachable — the user hit this
      // while testing the v2.4.4 progress overlay, which exists precisely for the folded
      // case. Ctrl+R is free: the application menu is removed (electron/main.js
      // Menu.setApplicationMenu(null)), so there is no default reload accelerator to fight.
      // runAnalyze is a no-op while an analysis is already running or no clip loaded.
      if (mod && e.key.toLowerCase() === "r") {
        e.preventDefault(); runAnalyze(); return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (window.electronAPI) window.electronAPI.winAction("close"); else window.close();
        return;
      }
      // Space is the transport key everywhere else in the app. Blur first, or it would also
      // "click" whichever toolbar button happens to have focus.
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        playPause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playPause, runAnalyze]);

  const dur = (info && info.duration) || 0;
  const zoomTime = (factor) => {
    const centre = view.start + view.dur / 2;
    const nextDur = peClamp(view.dur * factor, Math.min(MIN_VIEW_SEC, dur), dur);
    setView({ start: peClamp(centre - nextDur / 2, 0, Math.max(0, dur - nextDur)), dur: nextDur });
  };
  const zoomPitch = (factor) => {
    const span = peSpan(range);
    const next = peClamp(span * factor, MIN_SPAN, PITCH_MAX - PITCH_MIN);
    const centre = (range.hi + range.lo) / 2;
    setRange(peFitPitch(centre - next / 2, centre + next / 2));
  };

  const tempo = info && info.tempo;
  const transposed = !!(tempo && tempo.variKey && tempo.keyShift);
  const zoomedTime = dur > 0 && view.dur < dur - 1e-6;

  // Stage C — notes are DERIVED from the analysis, never stored alongside it. Re-cutting a
  // 5-minute take costs a few ms (the expensive part was the detection, already done), so
  // changing the grid re-segments instantly instead of asking for another Analyze.
  const grid = peNoteGrid(tempo, division);
  // v2.7.3 — the project's key as a set of pitch classes. It lives up HERE, not beside the
  // controls that offer it, because the drag preview below needs it.
  const scalePcs = React.useMemo(() => peScalePcs(tempo && tempo.detectedKey), [tempo && tempo.detectedKey]);
  // null = no snapping: either the user chose Chromatic, or this project has no detected key
  // and Key mode is unreachable — the same rule that greys out MIN without a BPM (v1.46.0).
  const snapPcs = snapMode === "key" && scalePcs ? scalePcs : null;

  const seg = React.useMemo(
    () => peBuildNotes(analysis, grid, dur),
    [analysis, grid.minNoteSec, grid.gridSec, dur]
  );
  // Stage D — the notes the user sees are the segmentation with their edits re-attached by
  // time overlap, and then the in-flight drag painted on top. `missed` is how many stored
  // edits found nothing to attach to; it is surfaced in the footer rather than swallowed.
  // v2.7.5 — 설계 §4-2 의 순서: 세그멘테이션 → **소유 구간 덮기** → 기본값 심기 → 값 얹기.
  // 경계가 값보다 먼저다. 값은 시간 겹침으로 붙으므로 어떤 경계 위에서도 붙을 수 있지만,
  // 그 반대는 성립하지 않는다.
  const laid = React.useMemo(
    () => peApplyLayout(seg.notes, layout, analysis, defs),
    [seg, layout, analysis, defs]
  );
  const applied = React.useMemo(
    () => peApplyEdits(peSeedDefaults(laid.notes, defs), edits, PE_TUNING.reattachTau),
    [laid, edits, defs]
  );
  const notes = React.useMemo(() => {
    if (!drag || !drag.dSemi) return applied.notes;
    return applied.notes.map((nt) => (drag.ids.has(nt.id)
      ? { ...nt, target: peDragTarget(nt, drag.dSemi, snapPcs) } : nt));
  }, [applied.notes, drag, snapPcs]);
  notesRef.current = notes;

  // One gesture → one message → one entry on the studio undo stack.
  // A gesture that changes nothing sends nothing: a no-op entry would eat the next Ctrl+Z and
  // clear Redo (앱개발.md 상시 노트 "Undo 스냅샷 정합성").
  const pushEdits = React.useCallback((next) => {
    if (JSON.stringify(next) === JSON.stringify(editsRef.current)) return;
    setEdits(next);
    peChannel.postMessage({ type: "SET_PITCH_EDITS", trackId, clipId, edits: next });
  }, [trackId, clipId]);

  // v2.7.3 — the same contract for the clip-wide defaults: one gesture, one message, one undo
  // entry, and an unchanged value sends nothing.
  // v2.7.5 — 경계(그리고 필요하면 값까지)를 **한 메시지**로 보낸다. Reset 은 값과 소유를
  // 함께 놓아야 하는데(설계 §4-2 ④), 메시지를 둘로 나누면 Undo 항목이 둘이 되어 §11-2 를
  // 어긴다. 바뀐 것이 없으면 아무것도 보내지 않는 것은 pushEdits 와 같다.
  const pushShape = React.useCallback((nextLayout, nextEdits) => {
    const layChanged = nextLayout && JSON.stringify(nextLayout) !== JSON.stringify(layoutRef.current);
    const edChanged = nextEdits && JSON.stringify(nextEdits) !== JSON.stringify(editsRef.current);
    if (!layChanged && !edChanged) return;
    if (layChanged) setLayout(nextLayout);
    if (edChanged) setEdits(nextEdits);
    peChannel.postMessage({
      type: "SET_PITCH_SHAPE", trackId, clipId,
      layout: layChanged ? nextLayout : null,
      edits: edChanged ? nextEdits : null,
    });
  }, [trackId, clipId]);

  const pushDefaults = React.useCallback((next) => {
    const cur = defsRef.current;
    if (next.strength === cur.strength && next.keepVibrato === cur.keepVibrato) return;
    setDefs(next);
    peChannel.postMessage({ type: "SET_PITCH_DEFAULTS", trackId, clipId, defaults: next });
  }, [trackId, clipId]);

  // The logic lives in peRewriteEdits (module scope) so the harness measures the same code.
  const rewriteEdits = React.useCallback(
    (ids, change) => peRewriteEdits(applied.notes, editsRef.current, ids, change, PE_TUNING.reattachTau, defsRef.current),
    [applied.notes]
  );

  const onNoteDrag = React.useCallback((id, dSemi, done) => {
    const sel = selectionRef.current;
    const ids = sel.has(id) ? new Set(sel) : new Set([id]);
    if (!done) {
      setDrag({ ids, dSemi });
      // v2.7.1 (R1) — sound the new pitch on every semitone step, with the same tone a click
      // on the keyboard makes. Only the GRABBED note: sounding every selected note at once is
      // a chord, which is harder to judge by ear than the one note under the pointer.
      const grabbed = applied.notes.find((nt) => nt.id === id);
      if (grabbed) previewKey(peDragTarget(grabbed, dSemi, snapPcs));
      return;
    }
    setDrag(null);
    if (!dSemi) return;
    // 🔴 Snapped per note, not by one shared delta — see peDragTarget. A gesture that snaps
    // every note back to where it started writes nothing: pushEdits refuses an identical list.
    pushEdits(rewriteEdits(ids, (nt) => ({ ...nt, target: peDragTarget(nt, dSemi, snapPcs) })));
  }, [applied.notes, previewKey, rewriteEdits, pushEdits, snapPcs]);

  // v2.7.1 (R2) — Reset: put the selected notes back to the detected pitch. One undo entry, so
  // Ctrl+Z brings the edits back (the user's own reason for wanting it: with Undo/Redo working,
  // Reset is safe to press).
  const selectedEdited = React.useMemo(
    () => notes.some((nt) => selection.has(nt.id) && !peIsPristine(nt, defs)),
    [notes, selection, defs]
  );
  //
  // v2.7.5 — Reset 의 뜻은 "검출기가 제안한 그대로로" 하나이고, 설계 §4-2 이후로는 거기에
  // **경계**도 들어간다: 선택이 덮는 구간의 소유를 세그멘터에게 돌려준다. 값과 소유를 한
  // 메시지로 보내 Ctrl+Z 한 번에 둘 다 돌아오게 한다(§11-2).
  // ⚠️ 대가 — 병합해 둔 음의 음정만 되돌리고 싶어도 병합까지 풀린다(설계 §4-2 ④에 기록).
  const resetSelected = React.useCallback(() => {
    const sel = selectionRef.current;
    if (!sel.size) return;
    const picked = (notesRef.current || []).filter((nt) => sel.has(nt.id));
    const nextEdits = rewriteEdits(sel, () => null);
    const nextLayout = picked.length
      ? peLayoutRelease(layoutRef.current, picked[0].t0, picked[picked.length - 1].t1)
      : layoutRef.current;
    pushShape(nextLayout, nextEdits);
  }, [rewriteEdits, pushShape]);

  // ══ v2.7.5 — Split / Merge (설계 §4-2) ═══════════════════════════════════════════
  //
  // 둘 다 layout[] 에 구간 하나를 쓰는 것이 전부다. 그 구간 안 노트들의 **값은 여전히**
  // edits[] 가 시간 겹침으로 정한다(§4-1) — 🔴 값을 여기에도 적으면 같은 값이 두 군데
  // 살면서 한 노트를 놓고 다투게 되고, 그것이 v2.7.1 이 peRewriteEdits 를 만들어 겨우
  // 풀어낸 결함의 모양이다.

  // 분할 지점은 플레이헤드다(설계 §4-2 ⑤) — 소리를 들어 가며 음절 경계를 맞출 수 있다.
  // 양쪽 조각이 모두 검출기 최소 길이를 넘어야 한다. 넘지 못하면 아무도 볼 수 없는 노트를
  // 만드는 셈이므로 아예 버튼을 잠근다.
  const canSplit = React.useMemo(() => {
    if (!analysis || selection.size !== 1) return null;
    const nt = notes.find((x) => selection.has(x.id));
    const c = transport.playhead;
    if (!nt || !Number.isFinite(c)) return null;
    if (c - nt.t0 < PE_MIN_NOTE_FLOOR || nt.t1 - c < PE_MIN_NOTE_FLOOR) return null;
    return { t0: nt.t0, t1: nt.t1, c };
  }, [analysis, selection, notes, transport.playhead]);

  const splitNote = React.useCallback(() => {
    if (!canSplit) return;
    pushShape(peLayoutPut(layoutRef.current, canSplit.t0, canSplit.t1, canSplit.c, false), null);
  }, [canSplit, pushShape]);

  // 🔴 이웃한 노트만 합친다. 선택하지 않은 노트를 사이에 두고 합치면 그 노트를 말없이
  // 삼키게 된다 — 선택하지 않은 것은 건드리지 않는다.
  const canMerge = React.useMemo(() => {
    if (!analysis || selection.size < 2) return null;
    const idx = [];
    notes.forEach((nt, i) => { if (selection.has(nt.id)) idx.push(i); });
    if (idx.length < 2) return null;
    if (idx[idx.length - 1] - idx[0] !== idx.length - 1) return null;
    return { t0: notes[idx[0]].t0, t1: notes[idx[idx.length - 1]].t1 };
  }, [analysis, selection, notes]);

  const mergeNotes = React.useCallback(() => {
    if (!canMerge) return;
    pushShape(peLayoutPut(layoutRef.current, canMerge.t0, canMerge.t1, null, true), null);
  }, [canMerge, pushShape]);

  // ══ v2.8.1 — Apply / Revert (설계 §6) ══════════════════════════════════════════
  //
  // 🔴 여기서 처음으로 소리가 바뀐다. 스튜디오가 pushUndo → 렌더 → 새 소스 → 디스크
  // 기록 → 재베이크를 한 덩어리로 처리하므로 Ctrl+Z 한 번에 통째로 돌아온다.
  //
  // 곡선(analysis)을 **그대로 실어 보낸다** — 엔진이 다시 분석하면 그사이 NOTES 설정이
  // 달라 화면과 다른 노트로 프린트할 수 있다. 사용자가 본 것이 렌더되어야 한다.
  const printed = !!(info && info.pitch && info.pitch.printedSourceId);
  const anyEdit = React.useMemo(
    () => notes.some((nt) => !peIsPristine(nt, defs)),
    [notes, defs]
  );
  const canApply = !!analysis && !!notes.length && anyEdit && !printing && !busy;
  const applyCorrection = React.useCallback(() => {
    if (!canApply) return;
    setPrinting(true);
    setPrintPct(0);
    setNote("Rendering the correction…");
    peChannel.postMessage({
      type: "REQUEST_PITCH_PRINT", trackId, clipId,
      analysis, notes: notesRef.current,
    });
  }, [canApply, analysis, trackId, clipId]);
  const revertCorrection = React.useCallback(() => {
    if (!printed || printing) return;
    setPrinting(true);
    peChannel.postMessage({ type: "REQUEST_PITCH_REVERT", trackId, clipId });
  }, [printed, printing, trackId, clipId]);

  // Reset 은 값이 바뀌었을 때뿐 아니라 **경계를 소유하고 있을 때도** 나와야 한다 — 병합만
  // 해 두고 음정은 안 건드린 경우, 이것이 없으면 소유를 돌려줄 길이 없다.
  const selectedOwned = React.useMemo(() => {
    const picked = notes.filter((nt) => selection.has(nt.id));
    if (!picked.length) return false;
    const a = picked[0].t0, b = picked[picked.length - 1].t1;
    return (layout || []).some((sp) => !(sp.t1 <= a || sp.t0 >= b));
  }, [notes, selection, layout]);

  // v2.7.3 — STRENGTH / VIBRATO. ONE control pair with TWO targets: the selected notes when
  // something is selected, the clip default when nothing is. Two separate pairs on screen
  // would leave the user working out which one wins; instead the label above them names the
  // target before they touch it.
  const setCorrection = React.useCallback((patch) => {
    const sel = selectionRef.current;
    if (sel.size) pushEdits(rewriteEdits(sel, (nt) => ({ ...nt, ...patch })));
    else pushDefaults({ ...defsRef.current, ...patch });
  }, [rewriteEdits, pushEdits, pushDefaults]);

  // What those controls READ. With a selection they show the selection's own value — and when
  // the selected notes disagree, the first one's: a slider has no "mixed" position to rest at,
  // and inventing one would be a third state the user has no way to set.
  const corrOf = React.useMemo(
    () => (selection.size ? (notes.find((nt) => selection.has(nt.id)) || defs) : defs),
    [selection, notes, defs]
  );

  // v2.7.4 (B1) — one slider drag is ONE undo entry.
  //
  // An <input type=range> fires onChange on every intermediate value the thumb passes, and
  // v2.7.3 sent a message per change: dragging 100% → 50% left six entries on the studio
  // stack, and HOW MANY depended on how fast the mouse moved (T-2.7.3-1 — the reported
  // 100→85→70→60→55→50 is mouse sampling, not the slider's step of 5). 설계 §11-2 asks for one
  // gesture = one entry, which the note drag has done since v2.7.1; the slider did not.
  //
  // So the slider paints from `pendingAmt` while the gesture is in flight and commits once it
  // ends. 🔴 There are THREE ends, not one, and missing any of them loses the user's change:
  //   · the pointer is released — on WINDOW, because a release outside the input never
  //     reaches the input itself, exactly as the note drag does it;
  //   · the arrow keys move the thumb with no pointer involved at all;
  //   · focus leaves mid-gesture (clicking a note, say).
  const [pendingAmt, setPendingAmt] = React.useState(null);
  const pendingAmtRef = React.useRef(null); pendingAmtRef.current = pendingAmt;
  const commitAmt = React.useCallback(() => {
    const v = pendingAmtRef.current;
    if (v === null) return;
    setPendingAmt(null);
    // setCorrection routes to the selection or the clip default, and both refuse a value that
    // is already there — so a drag that wanders and comes home writes nothing.
    setCorrection({ strength: v });
  }, [setCorrection]);
  const beginAmt = React.useCallback(() => {
    const up = () => { window.removeEventListener("pointerup", up); commitAmt(); };
    window.addEventListener("pointerup", up);
  }, [commitAmt]);
  // What the slider and the readout show: the in-flight value while dragging, the stored one
  // otherwise. A selection change mid-gesture drops the pending value rather than writing it
  // to whatever got selected instead.
  const amtShown = pendingAmt !== null ? pendingAmt : corrOf.strength;
  React.useEffect(() => { setPendingAmt(null); }, [selection]);

  // v2.7.3 — 설계 §10-4. Explicit, never automatic: a take that arrived already corrected
  // would leave the user unable to tell the singing from the correction.
  // 🔴 Snapped from the DETECTED pitch, not the current target, so pressing it after a drag
  // corrects the note rather than compounding the drag, and pressing it twice changes nothing.
  const snapAllToKey = React.useCallback(() => {
    if (!scalePcs || !applied.notes.length) return;
    const ids = new Set(applied.notes.map((nt) => nt.id));
    pushEdits(rewriteEdits(ids, (nt) => ({ ...nt, target: peSnapToScale(nt.midi, scalePcs, 0) })));
  }, [scalePcs, applied.notes, rewriteEdits, pushEdits]);
  // Ids are only unique within one segmentation, so a selection cannot outlive the notes it
  // pointed at — a re-cut (new analysis, new grid) starts from nothing selected.
  React.useEffect(() => { setSelection(PE_NO_SEL); anchorRef.current = null; }, [seg]);
  const selNote = selection.size === 1 ? notes.find((nt) => selection.has(nt.id)) : null;

  // While playing, light the key the singer was actually on. It is the cheapest way to check
  // the detected curve against the piano by ear and by eye at the same time — the standing
  // task the user kept open on T-2.0.2-1 ④. A key just struck by hand wins, briefly.
  const sungMidi = transport.isPlaying ? peMidiAt(analysis, transport.playhead) : null;
  const litMidi = struck !== null ? struck : (sungMidi === null ? null : Math.round(sungMidi));

  const zoomBtns = (label, minus, fit, plus, tip) => (
    <div className="pe-row" title={tip}>
      <span className="pe-rowlbl">{label}</span>
      <button className="pe-zbtn" onClick={minus.fn} disabled={minus.off}>−</button>
      <button className="pe-zbtn" onClick={fit.fn} disabled={fit.off} title={fit.title}>⤢</button>
      <button className="pe-zbtn" onClick={plus.fn} disabled={plus.off}>+</button>
    </div>
  );

  return (
    <div className="pe-shell">
      <div className="pe-titlebar">
        <div className="pe-brand"><span className="pe-brand-dot" />PITCH EDITOR</div>
        <div className="pe-title-c">{projectName ? <b>{projectName}</b> : "FocusDAW Studio"}</div>
        <div style={{ flex: 1 }} />
        <WindowControls />
      </div>

      {/* Transport bar. v2.3.0 empties it of everything that is not transport or identity —
          zoom, analysis and correction moved to the side panel — because this row wrapped onto
          a second line as soon as the window was narrowed, eating the roll's height. */}
      <div className="pe-toolbar">
        <button className={"pe-icbtn" + (transport.isPlaying ? " on" : "")} onClick={playPause}
          disabled={!info} title={transport.isPlaying ? "Pause (Space)" : "Play from the clip (Space)"}>
          {transport.isPlaying
            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg>}
        </button>
        <button className="pe-icbtn" onClick={stop} disabled={!info} title="Stop and return to the start of the clip">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="1.5" /></svg>
        </button>
        {/* CLIP loop: borrows the studio's Repeat region for the length of this clip, and hands
            it back when switched off or when the window closes. */}
        <button className={"pe-btn" + (clipLoop ? " primary" : "")} onClick={toggleClipLoop} disabled={!info}
          title={clipLoop
            ? "Playback is looping this clip — the studio's own Repeat region is restored when you switch this off"
            : "Loop playback over this clip only (temporarily takes over the studio's Repeat region)"}
          style={{ padding: "6px 10px", fontSize: 10 }}>
          CLIP
        </button>
        {/* Clip-relative, and blank when the transport is somewhere else in the song — the
            same condition that hides the playhead line, so the two never disagree. */}
        <span className="mono pe-time">{peFmtTime(transport.playhead)}</span>

        <div className="pe-clipname">
          <b>{info ? (info.fileName || info.trackName || "Clip") : "—"}</b>
          <span className="pe-clipmeta">
            {info ? `${peFmtTime(info.duration)} · ${info.sampleRate} Hz · ${info.channels === 1 ? "mono" : `${info.channels} ch`}` : ""}
          </span>
        </div>
        <div className="pe-spacer" />
        <button className={"pe-icbtn" + (sideOpen ? " on" : "")} onClick={() => setSideOpen((o) => !o)}
          title={sideOpen ? "Hide the panel" : "Show the panel"}>
          <svg width="13" height="13" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none">
            <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" />
          </svg>
        </button>
      </div>

      <div className="pe-body">
        <div className="pe-center">
          {/* Analysis can take seconds on a long take and the side panel may be folded away,
              so say so over the roll rather than only in the button. See .pe-analyzing. */}
          {busy &&
            <div className="pe-analyzing">
              <div className="pe-analyzing-card">
                <div className="pe-analyzing-ring" />
                <div className="pe-analyzing-label">Analyzing pitch…</div>
                <div className="pe-analyzing-bar">
                  <div className="pe-analyzing-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <div className="pe-analyzing-pct">{Math.round(progress * 100)}%</div>
              </div>
            </div>}
          {info && !error &&
            <ClipOverview info={info} analysis={analysis} view={view} playhead={transport.playhead}
              theme={theme} onView={setView} />}
          {error
            ? <div className="pe-empty">{error}</div>
            : (info
              ? <PianoRoll info={info} analysis={analysis} notes={notes} selection={selection}
                  scalePcs={scalePcs} defs={defs} view={view} range={range} theme={theme}
                  playhead={transport.playhead} litMidi={litMidi} onSeek={seekTo} onView={setView}
                  onRange={setRange} onPreview={previewKey} onSelectNote={selectNote}
                  onNoteDrag={onNoteDrag} />
              : <div className="pe-empty">Loading clip…</div>)}
        </div>

        {sideOpen &&
          <div className="pe-side">
            <div className="pe-sec">
              <div className="pe-sechd">VIEW</div>
              {zoomBtns("TIME",
                { fn: () => zoomTime(1 / 0.6), off: !zoomedTime },
                { fn: () => setView({ start: 0, dur }), off: !zoomedTime, title: "Fit the whole clip" },
                { fn: () => zoomTime(0.6), off: !info },
                "Time zoom — or Ctrl + wheel over the roll")}
              {zoomBtns("KEY",
                { fn: () => zoomPitch(1 / 0.7), off: peSpan(range) >= PITCH_MAX - PITCH_MIN },
                { fn: () => setRange(analysis ? peFitRange(analysis) : { lo: PITCH_MIN, hi: PITCH_MAX }),
                  off: false, title: analysis ? "Fit to the detected range" : "Show the full range" },
                { fn: () => zoomPitch(0.7), off: peSpan(range) <= MIN_SPAN },
                "Key zoom — vertical, or Alt + wheel over the roll")}
              <div className="pe-hint" style={{ marginTop: 9 }}>
                <kbd>Wheel</kbd> up / down · <kbd>Shift</kbd>+wheel left / right<br />
                <kbd>Ctrl</kbd>+wheel Time zoom · <kbd>Alt</kbd>+wheel Key zoom<br />
                <kbd>Middle-drag</kbd> to pan both axes
              </div>
            </div>

            <div className="pe-sec">
              <div className="pe-sechd">ANALYSIS</div>
              <button className="pe-btn pe-wide" onClick={runAnalyze} disabled={!info || busy}
                title="Detect the sung pitch across this clip (Ctrl+R)" style={{ marginBottom: 9 }}>
                {busy ? `Analyzing… ${Math.round(progress * 100)}%` : (analysis ? "Re-analyze" : "Analyze")}
              </button>
              <div className="pe-stat">
                {note
                  ? note
                  : (analysis
                    // Voiced coverage is the honest headline number: it says how much of the
                    // clip the detector actually found a pitch in, which is what Stage C segments.
                    ? <>
                        <b>{(100 * analysis.voicedFrames / analysis.frames).toFixed(0)}%</b> voiced<br />
                        {analysis.frames} frames @ {Math.round(analysis.hopSec * 1000)} ms<br />
                        analysed in {(analysis.elapsedMs / 1000).toFixed(1)} s
                      </>
                    : "Press Analyze to detect the sung pitch.")}
              </div>
            </div>

            {/* Stage C. The grid lives with the notes it produces, above CORRECTION, because
                it decides WHAT gets corrected before anything decides how. */}
            <div className="pe-sec">
              <div className="pe-sechd">NOTES</div>
              <div className="pe-row">
                <span className="pe-rowlbl">MIN</span>
                <select className="pe-select" value={division} disabled={!grid.bpm}
                  onChange={(e) => setDivision(+e.target.value)}
                  title={grid.bpm
                    ? "Shortest note the segmenter may produce, as a fraction of a bar"
                    : "This project has no BPM, so the shortest note is a fixed 120 ms — set a BPM in the studio to use a musical grid"}>
                  {PE_DIVISIONS.map((d) => <option key={d} value={d}>{"1/" + d + " note"}</option>)}
                </select>
              </div>
              <div className="pe-stat" style={{ marginTop: 8 }}>
                {!analysis
                  ? "Notes appear once the clip has been analysed."
                  : <>
                      <b>{notes.length}</b> notes · shortest <b>{Math.round(grid.minNoteSec * 1000)} ms</b><br />
                      {applied.missed > 0 && (
                        /* 🔴 Never swallow this. A re-cut can leave an edit with nothing to
                           attach to, and the user has no other way to learn their work was
                           dropped — measured at ~7% when the NOTES division changes. */
                        <span style={{ color: "var(--red)" }}>
                          <b>{applied.missed}</b> edit{applied.missed > 1 ? "s" : ""} could not be re-attached<br />
                        </span>
                      )}
                      {grid.bpm ? `1/${grid.division} at ${grid.bpm} BPM` : "no project BPM — fixed default"}
                      {/* Say when the density cap had to step in, rather than quietly handing
                          back fewer notes than the grid asked for. */}
                      {seg.relaxed > 0 ? <><br />density cap — thresholds raised ×{seg.relaxed}</> : null}
                      {/* 설계 §4-2 ③ — 소유 구간은 NOTES 를 바꿔도 변하지 않는다. 말해 주지
                          않으면 화면 일부가 안 따라오는 것이 고장으로 보인다. */}
                      {laid.spans > 0 ? <><br /><b>{laid.spans}</b> span{laid.spans > 1 ? "s" : ""} kept from your edits</> : null}
                    </>}
              </div>
              {/* v2.7.5 — 경계 편집은 CORRECTION 이 아니라 NOTES 에 둔다. 무엇이 한 음인지를
                  정하는 일이고, 그것은 어떻게 보정할지보다 앞선다(설계 §4-2). */}
              <div className="pe-row" style={{ marginTop: 9 }}>
                <button className="pe-btn" style={{ flex: 1 }} onClick={splitNote} disabled={!canSplit}
                  title={canSplit
                    ? "Split the selected note at the playhead"
                    : "Select one note and put the playhead inside it — both halves must be at least 60 ms"}>
                  Split
                </button>
                <button className="pe-btn" style={{ flex: 1 }} onClick={mergeNotes} disabled={!canMerge}
                  title={canMerge
                    ? "Merge the selected notes into one"
                    : "Select two or more notes that sit next to each other"}>
                  Merge
                </button>
              </div>
              <div className="pe-hint" style={{ marginTop: 7 }}>
                Notes you split or merge keep their boundaries when the clip is analysed again.
                <kbd>Reset</kbd> hands a note back to the detector.
              </div>
            </div>

            <div className="pe-sec" style={{ borderBottom: "none" }}>
              <div className="pe-sechd">CORRECTION</div>
              {/* v2.7.3 — SNAP steers the next drag. Key needs a detected key, so without one
                  the choice is not offered at all rather than offered and then ignored — the
                  same handling as MIN without a BPM (v1.46.0). */}
              <div className="pe-row">
                <span className="pe-rowlbl">SNAP</span>
                <select className="pe-select" value={scalePcs ? snapMode : "chromatic"}
                  disabled={!analysis || !scalePcs}
                  onChange={(e) => setSnapMode(e.target.value)}
                  title={scalePcs
                    ? "What a dragged note lands on — every semitone, or only notes of the project key"
                    : "This project has no detected key, so notes can only snap to semitones"}>
                  <option value="chromatic">Chromatic</option>
                  <option value="key">Key{tempo && tempo.detectedKey ? " — " + tempo.detectedKey : ""}</option>
                </select>
              </div>
              {/* 설계 §10-4 — explicit, never automatic. */}
              <button className="pe-btn pe-wide" onClick={snapAllToKey}
                disabled={!analysis || !scalePcs || !notes.length}
                style={{ marginTop: 9, marginBottom: 9 }}
                title={scalePcs
                  ? "Move every note to the nearest note of the project key. One undo step."
                  : "This project has no detected key — set or detect one in the studio first"}>
                Snap all to key
              </button>

              {/* STRENGTH / VIBRATO. One pair, two targets — the label says which one the
                  next move writes to (setCorrection). */}
              <div className="pe-sechd" style={{ marginTop: 2 }}>
                {selection.size ? `${selection.size} NOTE${selection.size > 1 ? "S" : ""} SELECTED` : "ALL NOTES"}
              </div>
              <div className="pe-row" title={selection.size
                ? "How far the selected notes move toward their target pitch"
                : "How far notes move toward their target pitch, unless a note says otherwise"}>
                <span className="pe-rowlbl">AMT</span>
                <input className="pe-range" type="range" min="0" max="100" step="5"
                  value={Math.round(peClamp(amtShown, 0, 1) * 100)}
                  disabled={!analysis || !notes.length}
                  onPointerDown={beginAmt}
                  onChange={(e) => setPendingAmt(+e.target.value / 100)}
                  onKeyUp={commitAmt}
                  onBlur={commitAmt} />
                <span className="pe-rangeval mono">{Math.round(peClamp(amtShown, 0, 1) * 100)}%</span>
              </div>
              <div className="pe-row">
                <span className="pe-rowlbl">VIB</span>
                <button className={"pe-btn pe-wide" + (corrOf.keepVibrato ? " on" : "")}
                  disabled={!analysis || !notes.length}
                  onClick={() => setCorrection({ keepVibrato: !corrOf.keepVibrato })}
                  title="Keep the singer's vibrato and glides while moving the pitch. Off flattens them.">
                  {corrOf.keepVibrato ? "Keep vibrato" : "Flatten vibrato"}
                </button>
              </div>
              {/* 🔴 Without this line the first test report is "the values go in but nothing
                  sounds different" — which is correct behaviour, not a defect. */}
              <div className="pe-hint" style={{ marginTop: 9 }}>
                Amount and vibrato are stored now and applied when the correction is rendered (Apply).
              </div>

              <div className="pe-row" style={{ marginTop: 9 }}>
                <button className="pe-btn primary" style={{ flex: 1 }} onClick={applyCorrection}
                  disabled={!canApply}
                  title={printing ? "Rendering…"
                    : !analysis ? "Analyse the clip first"
                    : !anyEdit ? "Move a note first — there is nothing to apply"
                    : "Render the correction into the audio. The original take is kept and Ctrl+Z undoes it."}>
                  {printing ? (printPct > 0 ? `Applying… ${Math.round(printPct * 100)}%` : "Applying…") : "Apply"}
                </button>
                <button className="pe-btn" style={{ flex: 1 }} onClick={revertCorrection}
                  disabled={!printed || printing}
                  title={printed
                    ? "Put the original take back. Your note edits are kept, so you can apply again."
                    : "Available once a correction has been applied"}>
                  Revert
                </button>
              </div>
              {printed && <div className="pe-hint" style={{ marginTop: 7 }}>
                This clip plays the corrected audio. The original take is untouched — <kbd>Revert</kbd> brings it back.
              </div>}
            </div>


          </div>}
      </div>

      <div className="pe-footer">
        {/* Left: what is selected, or how to get there. A selected note pushes the standing
            hint aside — while one is picked, its numbers are the useful thing to show. */}
        <span className="pe-fseg">
          {selNote
            ? `${midiName(selNote.target)} · ${peFmtTime(selNote.t0)} → ${peFmtTime(selNote.t1)} · ${(selNote.t1 - selNote.t0).toFixed(2)} s · ${peFmtCents(peCentsOff(selNote))} · ${Math.round(selNote.confidence * 100)}% conf`
            : (!info ? "—" : `${info.trackName || "track"} · clip at ${peFmtTime(info.start)} · click a key to hear it`
              + (!analysis ? " · press Ctrl+R to detect pitch"
                : selection.size > 1 ? ` · ${selection.size} notes selected`
                : notes.length ? " · click a note to select it" : ""))}
        </span>
        {analysis && (selectedEdited || selectedOwned) && (
          <button className="pe-zbtn" onClick={resetSelected}
            style={{ width: "auto", padding: "0 9px", flex: "0 0 auto" }}
            title="Return the selected notes to the detected pitch. Ctrl+Z brings the edit back.">
            Reset
          </button>
        )}
        {/* Middle: WHICH rule produced the notes on screen (설계 §12-1). Without it a user who
            sang twelve notes and sees forty has no way to tell whether the grid or the singing
            is responsible. */}
        {analysis &&
          <span className="pe-fseg mono" style={{ flex: "0 0 auto" }}
            title={grid.bpm
              ? "Shortest note allowed, derived from the project BPM"
              : "Shortest note allowed. The project has no BPM, so a fixed default is used instead of a musical grid."}>
            {`Min note ${Math.round(grid.minNoteSec * 1000)} ms ` + (grid.bpm ? `(1/${grid.division} @ ${grid.bpm} BPM)` : "(no project BPM)")}
          </span>}
        {/* Vari Key/BPM never bake into timeline audio, so analysis and rendering always work
            in the original domain. Say so when playback is transposed, or the note names on
            screen silently disagree with what the user hears (설계 §3). */}
        {transposed
          ? <span className="pe-badge">VARI KEY {tempo.keyShift > 0 ? "+" : ""}{tempo.keyShift} — editing the original pitch</span>
          : <span>{tempo && tempo.detectedKey ? `Key ${tempo.detectedKey}` : ""}</span>}
      </div>
    </div>
  );
}

ReactDOM.render(<PitchEditorApp />, document.getElementById("root"));
