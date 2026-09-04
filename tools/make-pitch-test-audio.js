#!/usr/bin/env node
/* ============================================================================
   FocusDAW — Pitch Editor 시험용 보컬 신호 생성기 (T-2.4.0-1)
   ----------------------------------------------------------------------------
   실제 녹음은 정답을 모르기 때문에 "블록이 부른 음표와 맞는가"를 판정할 수 없다.
   이 스크립트는 **정답을 아는** 보컬형 신호를 만들고, 같은 실행에서 정답표를
   마크다운으로 내보낸다.

     node tools/make-pitch-test-audio.js

   출력 (test-audio/ — WAV은 크므로 .gitignore 대상, 이 스크립트만 커밋한다):
     pitch-test-solo.wav     단성만 — 진짜 합/불합 판정용
     pitch-test-full.wav     단성 + 하모니 — 사용자가 요청한 "섞인" 신호
     pitch-test-notes.md     정답표 (사람이 읽는 것)
     pitch-test-notes.json   같은 정답 (회귀 하네스가 읽는 것)

   ── 왜 사인파가 아닌가 ──────────────────────────────────────────────────────
   YIN은 배음 구조에 따라 전혀 다르게 행동한다. 순수 사인파는 실전보다 훨씬
   쉽고(1옥타브 아래 오검출이 잘 안 난다), 그래서 사인파로 통과한 임계값은
   실제 노래에서 무너진다. 여기서는 성도 공명(포먼트)으로 배음 크기를 빚고
   지터·셰이머·숨소리를 얹어, **틀릴 수 있는 신호**를 만든다.

   ── 왜 105 BPM인가 ────────────────────────────────────────────────────────
   peNoteGrid()는 minNoteSec = clamp(gridSec * 0.75, 60ms, 200ms)다. 105 BPM에서
     1/8  → 285.7ms * 0.75 = 214ms → 상한 200ms
     1/16 → 142.9ms * 0.75 = 107ms
     1/32 →  71.4ms * 0.75 =  54ms → 하한  60ms
   세 값이 전부 갈린다. 그래서 8·16·32분음표 구간의 노트 개수가 MIN 설정마다
   달라야 하고, 그 개수를 정답으로 적을 수 있다(T-2.4.0-2 ②).
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const SR = 48000;
const BPM = 105;
const BEAT = 60 / BPM;                 // 0.571429 s
const OUT_DIR = path.join(__dirname, '..', 'test-audio');

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiName = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const n = (name) => {                  // "A4" / "F#3" -> midi
  const m = /^([A-G]#?)(-?\d+)$/.exec(name);
  if (!m) throw new Error('bad note ' + name);
  return NAMES.indexOf(m[1]) + (parseInt(m[2], 10) + 1) * 12;
};

/* ── 모음 (포먼트 주파수 / 대역폭) ──────────────────────────────────────────
   2극 공명기 세 개를 병렬로 더해 배음 진폭을 만든다. 모음마다 배음 무게중심이
   달라지므로, 한 모음으로만 시험하면 그 모음에서만 맞는 임계값이 나온다. */
const VOWELS = {
  a: [[730, 90, 1.0], [1090, 110, 0.55], [2440, 170, 0.28]],
  o: [[570, 80, 1.0], [840, 100, 0.50], [2410, 170, 0.18]],
  e: [[530, 80, 1.0], [1840, 130, 0.62], [2480, 180, 0.32]],
  i: [[270, 70, 1.0], [2290, 140, 0.55], [3010, 200, 0.30]],
};

// 2극 공명기의 크기 응답.
function resonance(f, F, B) {
  const Q = F / B, r = f / F;
  return 1 / Math.sqrt(Math.pow(1 - r * r, 2) + Math.pow(r / Q, 2));
}

// 배음 n의 진폭 = 스펙트럼 기울기 × 포먼트 공명. 기울기 -12 dB/oct 정도.
function harmonicAmp(k, f0, vowel) {
  const f = k * f0;
  if (f > SR / 2 * 0.9) return 0;
  let form = 0;
  for (const [F, B, g] of VOWELS[vowel]) form += g * resonance(f, F, B);
  return form / Math.pow(k, 1.1);
}

/* ── 한 성부를 버퍼에 더한다 ───────────────────────────────────────────────
   ev = { t0, dur, midi, vowel, vib:{cents,rate}, glideFrom, gain, decayTail }
   glideFrom 이 있으면 앞 음에서 30 ms 포르타멘토로 들어온다 — 실제 노래는
   음정이 계단처럼 뛰지 않고, 그 짧은 미끄러짐이 경계 판정의 실제 조건이다. */
function renderVoice(buf, ev) {
  const { t0, dur, midi, vowel = 'a', gain = 1 } = ev;
  const vib = ev.vib || { cents: 0, rate: 5.5 };
  const i0 = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  const atk = Math.round(0.035 * SR);
  const rel = Math.round(0.070 * SR);
  const glide = ev.glideFrom != null ? Math.round(0.030 * SR) : 0;

  // 배음 진폭은 음마다 한 번만 계산한다(f0가 비브라토로 흔들려도 포먼트는 고정).
  const f0base = midiHz(midi);
  const K = Math.min(40, Math.floor((SR / 2 * 0.9) / f0base));
  const amps = [];
  let norm = 0;
  for (let k = 1; k <= K; k++) { const a = harmonicAmp(k, f0base, vowel); amps.push(a); norm += a; }
  if (norm <= 0) return;

  const vibPhase = Math.random() * Math.PI * 2;
  const phases = new Float64Array(K);        // 배음별 위상 누적 (주파수가 변하므로 필수)
  for (let k = 0; k < K; k++) phases[k] = Math.random() * Math.PI * 2;

  let jitter = 0;                            // 성대 지터 — 몇 센트짜리 무작위 보행
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    // 포르타멘토 · 비브라토 · 지터를 전부 센트로 더한 뒤 한 번에 주파수로 바꾼다.
    let cents = 0;
    if (glide && i < glide) {
      const u = i / glide;                   // 코사인 이징 — 선형은 꺾인 자국이 남는다
      const e = 0.5 - 0.5 * Math.cos(Math.PI * u);
      cents += (ev.glideFrom - midi) * 100 * (1 - e);
    }
    // 비브라토는 시작하자마자 최대 깊이가 되지 않는다(약 0.25 s에 걸쳐 열린다).
    const vibOpen = Math.min(1, t / 0.25);
    cents += vib.cents * vibOpen * Math.sin(2 * Math.PI * vib.rate * t + vibPhase);
    jitter += (Math.random() * 2 - 1) * 0.9;
    jitter *= 0.97;
    cents += jitter;

    const f0 = f0base * Math.pow(2, cents / 1200);

    // 진폭 포락선
    let env = 1;
    if (i < atk) env = 0.5 - 0.5 * Math.cos(Math.PI * (i / atk));
    else if (i > len - rel) env = 0.5 - 0.5 * Math.cos(Math.PI * ((len - i) / rel));
    // decayTail: 프레이즈 끝이 숨으로 사그라드는 구간. 옥타브 오검출이 실제로
    // 터지는 자리라, 일부러 만든다(사용자 보고의 F2 건).
    if (ev.decayTail) {
      const dt = ev.decayTail;
      if (t > dur - dt) env *= Math.pow(1 - (t - (dur - dt)) / dt, 2.2);
    }
    env *= 1 + 0.04 * Math.sin(2 * Math.PI * 4.7 * t);   // 셰이머(진폭 요동)

    let s = 0;
    for (let k = 0; k < K; k++) {
      phases[k] += 2 * Math.PI * f0 * (k + 1) / SR;
      if (phases[k] > 1e6) phases[k] -= 1e6;
      s += amps[k] * Math.sin(phases[k]);
    }
    s /= norm;

    const idx = i0 + i;
    if (idx >= 0 && idx < buf.length) buf[idx] += gain * env * s;
  }
}

// 숨소리. 유성 구간에도 조금 섞이고, 음이 없는 자리에는 아주 작게 남는다.
function addBreath(buf, t0, dur, level) {
  const i0 = Math.round(t0 * SR), len = Math.round(dur * SR);
  let lp = 0, hp = 0, prev = 0;
  for (let i = 0; i < len; i++) {
    const wn = Math.random() * 2 - 1;
    lp += 0.28 * (wn - lp);                 // 저역 통과 후 고역 통과 = 대역 잡음
    hp = 0.92 * (hp + lp - prev); prev = lp;
    const idx = i0 + i;
    if (idx >= 0 && idx < buf.length) buf[idx] += level * hp;
  }
}

/* ── 악보 ─────────────────────────────────────────────────────────────────
   시간 단위는 박(beat). 105 BPM에서 1박 = 0.5714 s.
   legato: true 인 구간은 음 사이에 무음이 없다 — 유성 구간이 하나로 이어지므로
   세그멘테이션이 "무음으로 나누기"가 아니라 **음정 계단**으로 잘라야 한다.
   그것이 이 시험의 요점이다(무음으로 끊으면 어떤 알고리즘도 통과한다). */

const SECTIONS = [
  {
    id: 'A', title: 'SOLO — 4분음표 스케일 (레가토)',
    note: '음 사이에 무음이 없다. 반음 계단(E4→F4, B4→C5)이 포함돼 있어 최소 간격도 갈라지는지 본다.',
    judge: '판정 대상', legato: true, vowel: 'a',
    seq: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'].map((p) => ({ p, beats: 1 })),
    vib: { cents: 12, rate: 5.2 },
  },
  {
    id: 'B', title: 'SOLO — 비브라토 긴 음 (각 4박)',
    note: '**한 음이 여러 조각으로 쪼개지면 안 된다.** 깊이를 넷 다르게 줬다 — 아래 표의 ± 값 참조.',
    judge: '판정 대상', legato: false, vowel: 'a',
    seq: [
      { p: 'A4', beats: 4, vib: { cents: 40, rate: 5.5 }, vowel: 'a' },
      { p: 'F4', beats: 4, vib: { cents: 80, rate: 6.0 }, vowel: 'o' },
      { p: 'D4', beats: 4, vib: { cents: 120, rate: 4.5 }, vowel: 'e' },
      { p: 'A3', beats: 4, vib: { cents: 60, rate: 5.5 }, vowel: 'a' },
    ],
  },
  {
    id: 'C', title: 'SOLO — 8분 → 16분 → 32분 (레가토, MIN 설정 판별용)',
    note: 'MIN 설정마다 노트 개수가 달라야 하는 구간. 아래 "MIN 설정별 정답 개수" 참조.',
    judge: '판정 대상', legato: true, vowel: 'a',
    seq: [
      ...['C4', 'D4', 'E4', 'F4', 'G4', 'F4', 'E4', 'D4'].map((p) => ({ p, beats: 0.5 })),
      ...['C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4'].map((p) => ({ p, beats: 0.25 })),
      ...['G4', 'A4', 'B4', 'C5', 'B4', 'A4', 'G4', 'F4'].map((p) => ({ p, beats: 0.125 })),
      { p: 'E4', beats: 2 },
    ],
    vib: { cents: 10, rate: 5.2 },
  },
  {
    id: 'D', title: 'SOLO — 낮은 음 · 프레이즈 끝 감쇠 (옥타브 오검출 유도)',
    note: '⚠️ **여기가 사용자가 보고한 F2 건을 재현하려는 자리다.** 마지막 음은 숨으로 사그라든다. 지금은 아직 안 고친 상태이므로 **틀리는 것이 예상되는 구간**이다.',
    judge: '진단용 (현재 미수정)', legato: false, vowel: 'o',
    seq: [
      { p: 'F3', beats: 3, vib: { cents: 35, rate: 5.0 } },
      { p: 'C3', beats: 3, vib: { cents: 30, rate: 4.8 } },
      { p: 'F4', beats: 4, vib: { cents: 50, rate: 5.5 }, decayTail: 1.6, vowel: 'a' },
    ],
  },
  {
    id: 'E', title: 'SOLO — 글리산도 (경계가 원래 모호한 구간)',
    note: '사람마다 다르게 볼 수 있는 자리다. **개수가 한두 개 달라도 정상**이며, 판정 기준에서 제외한다.',
    judge: '참고만', legato: false, vowel: 'a',
    seq: [
      { p: 'C4', beats: 2, glideTo: 'G4' },
      { p: 'G4', beats: 2, glideTo: 'C4' },
    ],
  },
  {
    id: 'F', title: '하모니 2성 — 3도 · 5도 · 6도',
    note: '⚠️ **판정 대상이 아니다.** YIN은 단성 추적기라 동시에 울리는 두 음을 분리할 수 없다. 특히 완전5도(C4+G4)는 **두 음의 공약수인 한 옥타브 아래를 보고할 수 있고 그것은 알고리즘상 정상**이다. 여기서 볼 것은 "무엇을 고르는가"뿐이다.',
    judge: '진단용 (단성 추적기의 한계)', legato: false, vowel: 'a', harmony: true,
    seq: [
      { chord: ['C4', 'E4'], beats: 2 },
      { chord: ['C4', 'G4'], beats: 2 },
      { chord: ['A3', 'F4'], beats: 2 },
      { chord: ['D4', 'A4'], beats: 2 },
    ],
  },
  {
    id: 'G', title: '하모니 3성 — 합창 화음',
    note: '⚠️ **판정 대상이 아니다.** F와 같은 이유.',
    judge: '진단용 (단성 추적기의 한계)', legato: false, vowel: 'o', harmony: true,
    seq: [
      { chord: ['C4', 'E4', 'G4'], beats: 4 },
      { chord: ['F3', 'A3', 'C4'], beats: 4 },
      { chord: ['G3', 'B3', 'D4'], beats: 4 },
    ],
  },
];

const LEAD_IN = 0.6;        // 앞 여백
const GAP_SECTION = 0.9;    // 구간 사이 무음 — 파형에서 눈으로 구간을 찾을 수 있게
const GAP_NOTE = 0.10;      // legato가 아닌 구간의 음 사이 짧은 숨

/* ── 배치 ──────────────────────────────────────────────────────────────── */
function layout(sections) {
  let t = LEAD_IN;
  const events = [], rows = [], bounds = {};
  for (const sec of sections) {
    const secStart = t;
    let prev = null;
    for (const item of sec.seq) {
      const dur = item.beats * BEAT;
      const vowel = item.vowel || sec.vowel;
      const vib = item.vib || sec.vib || { cents: 15, rate: 5.4 };
      if (item.chord) {
        // 화음: 아래 성부를 조금 크게 — 실제 합창의 균형이고, YIN이 무엇을 잡는지도 갈린다.
        const ms = item.chord.map(n);
        ms.forEach((m, i) => events.push({
          t0: t, dur, midi: m, vowel, vib, gain: i === 0 ? 0.62 : 0.42,
        }));
        rows.push({ sec: sec.id, t0: t, t1: t + dur, label: item.chord.join(' + '),
                    midi: ms.join(', '), dur, kind: `${ms.length}성` });
      } else {
        const m = n(item.p);
        const ev = { t0: t, dur, midi: m, vowel, vib, gain: 0.85 };
        if (sec.legato && prev != null) ev.glideFrom = prev;
        if (item.decayTail) ev.decayTail = item.decayTail;
        if (item.glideTo) {
          // 글리산도는 "다음 음에서 들어오는" 것이 아니라 이 음 안에서 끝까지 미끄러진다.
          ev.glideSlideTo = n(item.glideTo);
        }
        events.push(ev);
        rows.push({ sec: sec.id, t0: t, t1: t + dur, label: item.glideTo ? `${item.p} → ${item.glideTo}` : item.p,
                    midi: item.glideTo ? `${m} → ${n(item.glideTo)}` : String(m), dur,
                    kind: item.glideTo ? '글리산도' : (vib.cents >= 30 ? `비브라토 ±${vib.cents}¢` : '') });
        prev = m;
      }
      t += dur + (sec.legato ? 0 : GAP_NOTE);
    }
    // ⚠️ 구간 경계는 반환값으로 돌려준다. layout()은 SECTIONS의 **복사본**을 받으므로
    // 여기서 sec에 써 봐야 호출자에게 닿지 않는다 — 그래서 정답표의 모든 구간 시각이
    // NaN으로 찍혔었다.
    bounds[sec.id] = { t0: secStart, t1: t };
    t += GAP_SECTION;
  }
  return { events, rows, bounds, total: t + 0.6 };
}

// 글리산도는 renderVoice의 glideFrom과 반대 방향이라 따로 처리한다.
function renderGlide(buf, ev) {
  const steps = 24, sub = ev.dur / steps;
  for (let i = 0; i < steps; i++) {
    const u0 = i / steps;
    const m = ev.midi + (ev.glideSlideTo - ev.midi) * (0.5 - 0.5 * Math.cos(Math.PI * u0));
    renderVoice(buf, {
      t0: ev.t0 + i * sub, dur: sub * 1.06, midi: m, vowel: ev.vowel,
      vib: { cents: 8, rate: 5.2 }, gain: ev.gain * (i === 0 ? 1 : 1),
    });
  }
}

function render(events, total) {
  const buf = new Float64Array(Math.ceil(total * SR));
  for (const ev of events) {
    if (ev.glideSlideTo != null) renderGlide(buf, ev);
    else renderVoice(buf, ev);
    addBreath(buf, ev.t0, ev.dur, 0.020);          // 유성 구간에 섞이는 숨
  }
  addBreath(buf, 0, total, 0.0016);                // 방 잡음 — 완전 무음은 비현실적이다
  // 정규화 (-1 dBFS)
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  const g = peak > 0 ? Math.pow(10, -1 / 20) / peak : 1;
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round(buf[i] * g * 32767)));
  }
  return out;
}

function writeWav(file, samples) {
  const dataBytes = samples.length * 2;
  const b = Buffer.alloc(44 + dataBytes);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataBytes, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(samples[i], 44 + i * 2);
  fs.writeFileSync(file, b);
  return b.length;
}

/* ── 실행 ──────────────────────────────────────────────────────────────── */
fs.mkdirSync(OUT_DIR, { recursive: true });

const soloSections = SECTIONS.filter((s) => !s.harmony);
const full = layout(SECTIONS.map((s) => ({ ...s })));
const solo = layout(soloSections.map((s) => ({ ...s })));

const fullWav = path.join(OUT_DIR, 'pitch-test-full.wav');
const soloWav = path.join(OUT_DIR, 'pitch-test-solo.wav');
writeWav(fullWav, render(full.events, full.total));
writeWav(soloWav, render(solo.events, solo.total));

// MIN 설정별 최소 노트 길이 (peNoteGrid와 같은 산수)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const minNote = (div) => clamp((60 / BPM) * (4 / div) * 0.75, 0.06, 0.20);
const fmt = (t) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

// ⚠️ MIN 설정별 노트 개수는 "minNoteSec보다 긴 음만 살아남는다"로 계산할 수 없다.
// peSegmentPass는 짧은 조각을 지우지 않고 **이웃에 흡수**시키므로(설계 §12-1), 결과 개수는
// 대략 (구간 길이 / minNoteSec)에 가깝지 훨씬 크다. 그래서 예측하지 않고, 아래 MEASURED에
// 실제 빌드로 측정한 값을 적어 둔다.
const MIN_MS = [8, 16, 32].map((div) => ({ div, mn: minNote(div) }));

// v2.4.6 빌드에서 pitch-test-full.wav를 실제로 분석·분할해 얻은 값(참고치).
// 임계를 만지면 이 값이 바뀐다 — 바뀌는 것이 정상이고, 여기를 같이 갱신할 것.
const MEASURED = {
  note: 'v2.4.7 · pitch-test-full.wav 실측 (PITCH_MIN_CONF = 0.5)',
  perSection: {
    //        1/8  1/16  1/32
    A: [8, 8, 8], B: [5, 17, 48], C: [14, 19, 25], D: [3, 3, 3], E: [6, 11, 16],
    F: [5, 10, 14], G: [15, 15, 16],
  },
  // 참고 — PITCH_MIN_CONF = 0(게이트 끔, v2.4.6)이면 [42, 75, 128]이 되고 하모니 구간이 줄어든다.
  total: [56, 83, 130],
};

let md = `# Pitch Editor 시험용 신호 — 정답표

> \`node tools/make-pitch-test-audio.js\` 로 생성. **이 파일을 고치지 말 것** — 다시 생성하면 덮어쓴다.
> 생성 조건: **${BPM} BPM · 4/4 · ${SR} Hz · 16-bit mono**

## 파일

| 파일 | 길이 | 내용 | 용도 |
|------|------|------|------|
| \`pitch-test-solo.wav\` | ${solo.total.toFixed(1)} s | 단성만 (구간 ${soloSections.map((s) => s.id).join('·')}) | **합/불합 판정용** |
| \`pitch-test-full.wav\` | ${full.total.toFixed(1)} s | 단성 + 하모니 (구간 ${SECTIONS.map((s) => s.id).join('·')}) | 요청하신 "섞인" 신호 |

## 쓰는 법

1. 스튜디오에서 **프로젝트 BPM을 \`${BPM}\`으로 설정**한다. ⚠️ 이걸 안 하면 상태줄이
   \`Min note 120 ms (no project BPM)\`가 되고 아래 개수 정답이 전부 어긋난다.
2. 파일을 **Audio In 트랙**에 넣는다(스템 트랙에는 Pitch Editor가 뜨지 않는다).
3. 클립 우클릭 → \`Pitch Editor...\` → \`Analyze\`(또는 \`Ctrl\`+\`R\`).
4. 아래 표의 시각으로 이동해 블록의 음이름과 대조한다.

## MIN 설정별 최소 노트 길이 (${BPM} BPM)

| MIN | 상태줄에 이렇게 떠야 한다 |
|-----|--------------------------|
${MIN_MS.map((c) => `| 1/${c.div} | \`Min note ${Math.round(c.mn * 1000)} ms (1/${c.div} @ ${BPM} BPM)\` |`).join('\n')}

> 구간 C의 8분음표는 ${(0.5 * BEAT * 1000).toFixed(0)} ms, 16분음표는 ${(0.25 * BEAT * 1000).toFixed(0)} ms,
> 32분음표는 ${(0.125 * BEAT * 1000).toFixed(0)} ms다 — 각각 위 임계값의 위/아래로 갈리도록 ${BPM} BPM을 골랐다.
> **1/8 < 1/16 < 1/32 순으로 노트가 많아져야 한다.**

## 참고치 — ${MEASURED.note}

> 정답이 아니라 **현재 빌드가 실제로 내놓은 값**이다. 사용자가 화면에서 세는 값이 여기서 크게
> 벗어나면 그 자체가 보고거리다. 임계를 조정하면 이 숫자는 바뀌는 것이 정상이다.

| MIN | 전체 | ${SECTIONS.map((s) => s.id).join(' | ')} |
|-----|------|${SECTIONS.map(() => '---').join('|')}|
${[8, 16, 32].map((d, i) => `| 1/${d} | ${MEASURED.total[i]} | ${SECTIONS.map((s) => MEASURED.perSection[s.id][i]).join(' | ')} |`).join('\n')}

⚠️ **구간 B의 19 · 48을 보라 — 정답은 4다.** 비브라토가 깊으면 한 음이 쪼개진다.
측정해 보면 **±60¢까지는 어느 MIN에서도 1개, ±70¢부터 무너진다**(비브라토 속도와 무관).
그 경계는 우연이 아니라 \`PE_HYST_ST = 0.6반음 = 60센트\`와 같은 값이다.
**아직 고치지 않은 상태이므로 구간 B의 ±80¢·±120¢ 음이 쪼개지는 것은 예상된 결과다** —
다시 보고하지 않으셔도 된다.

---

## 구간별 정답

`;

for (const sec of SECTIONS) {
  const rows = full.rows.filter((r) => r.sec === sec.id);
  md += `### 구간 ${sec.id} — ${sec.title}\n\n`;
  const bF = full.bounds[sec.id], bS = solo.bounds[sec.id];
  md += `- **시각**: full \`${fmt(bF.t0)}\` ~ \`${fmt(bF.t1)}\``
      + (bS ? ` · solo \`${fmt(bS.t0)}\` ~ \`${fmt(bS.t1)}\`` : ' · *(solo 파일에는 없는 구간)*') + `\n`;
  md += `- **판정**: ${sec.judge}\n`;
  md += `- ${sec.note}\n\n`;
  md += `| 시작 | 끝 | 음 | MIDI | 길이 | 비고 |\n|------|------|------|------|------|------|\n`;
  for (const r of rows) {
    md += `| \`${fmt(r.t0)}\` | \`${fmt(r.t1)}\` | **${r.label}** | ${r.midi} | ${(r.dur * 1000).toFixed(0)} ms | ${r.kind || ''} |\n`;
  }
  md += `\n**이 구간의 음 개수: ${rows.length}**\n\n`;
}

const judged = SECTIONS.filter((s) => s.judge === '판정 대상');
md += `---

## 요약 — 무엇을 보면 되는가

**판정 대상은 구간 ${judged.map((s) => s.id).join('·')}뿐이다.**

- **구간 A** — 8개. 레가토라 무음으로 나눌 수 없으므로, **음정 계단만으로** 8개가 나와야 한다.
  ${MEASURED.note}에서는 세 MIN 설정 모두 8개로 맞았다.
- **구간 B** — 4개. **여기가 핵심이고, 지금은 통과하지 못한다.**
  ±40¢·±60¢ 음은 1개로 잘 나오지만 **±80¢·±120¢ 음이 쪼개진다**(위 참고치의 19·48).
  **이미 알고 있는 결함이므로 다시 보고하지 않으셔도 된다.** 여기서 봐 주실 것은 하나뿐 —
  **음이름이 맞는가**(쪼개져도 조각마다 F4·D4로 읽히는지). 음이름까지 틀리면 그것은 새 정보다.
- **구간 C** — MIN 설정에 따라 개수가 달라져야 하고, **1/8 < 1/16 < 1/32 순서**면 된다.
  정확한 개수는 흡수 규칙 때문에 정답을 못 박을 수 없으니 참고치와 대조만 해 주시면 된다.

**판정 대상이 아닌 구간**(D·E·F·G)은 결과만 적어 주시면 된다 —
- **D**는 옥타브 오검출을 유도하려고 만든 구간이다(낮은 음 + 프레이즈 끝 감쇠).
  ⚠️ **합성 신호로는 재현되지 않았다** — ${MEASURED.note}에서 F3·C3·F4 모두 정확했다.
  즉 실제 녹음의 F2 건은 이 모델에 없는 무언가(성대 프라이·잔향 꼬리 등) 때문일 가능성이 크다.
  **여기서 틀린다면 그것은 새 정보이니 꼭 보고해 주시길.**
- **E**(글리산도)는 경계가 원래 모호하다. 개수는 보지 않는다.
- **F·G**(하모니)는 단성 추적기의 원리적 한계다. 맞고 틀리고가 아니라 **무엇을 고르는지**를 본다.
  특히 완전5도(\`0:33.76\` C4+G4)에서 한 옥타브 아래를 보고해도 알고리즘상 정상이다.

보고 서식은 \`시각 · 정답 음 · 표시된 음\` 세 쪽이면 충분하다. 예: \`${fmt(full.rows.find((r) => r.sec === 'D').t0)} · F3 · F2로 표시됨\`
`;

const mdPath = path.join(OUT_DIR, 'pitch-test-notes.md');
fs.writeFileSync(mdPath, md, 'utf8');

// 같은 정답을 기계가 읽을 수 있는 형태로도 내보낸다 — 임계값을 만진 뒤 이 신호로
// 회귀를 돌리려면 표가 아니라 이것이 필요하다.
const jsonPath = path.join(OUT_DIR, 'pitch-test-notes.json');
fs.writeFileSync(jsonPath, JSON.stringify({
  bpm: BPM, sampleRate: SR, files: { solo: path.basename(soloWav), full: path.basename(fullWav) },
  // 두 파일은 배치가 다르다(solo에는 하모니 구간이 없어 뒤가 전부 당겨진다).
  // 회귀 하네스가 어느 파일을 읽든 맞는 시각을 쓰도록 둘 다 싣는다.
  sections: SECTIONS.map((s) => ({
    id: s.id, title: s.title, judge: s.judge, harmony: !!s.harmony,
    full: full.bounds[s.id], solo: solo.bounds[s.id] || null,
    count: full.rows.filter((r) => r.sec === s.id).length,
  })),
  rows: { full: full.rows, solo: solo.rows },
}, null, 2), 'utf8');

const kb = (f) => (fs.statSync(f).size / 1024 / 1024).toFixed(1) + ' MB';
console.log(`BPM ${BPM} · ${SR} Hz · 16-bit mono`);
console.log(`  ${soloWav}  ${solo.total.toFixed(1)} s  ${kb(soloWav)}`);
console.log(`  ${fullWav}  ${full.total.toFixed(1)} s  ${kb(fullWav)}`);
console.log(`  ${mdPath}`);
console.log('\nMIN 설정별 최소 노트 길이:');
for (const c of MIN_MS) console.log(`  1/${c.div}: ${Math.round(c.mn * 1000)} ms`);
