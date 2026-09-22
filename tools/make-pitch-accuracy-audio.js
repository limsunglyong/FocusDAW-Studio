#!/usr/bin/env node
/* ============================================================================
   FocusDAW — 음정 정확도 귀 검증용 음원 생성기 (T-2.8.1-1 추가3)
   ----------------------------------------------------------------------------
   실제 녹음으로는 "+2 반음이 **정확히** +2 였는가"를 귀로 알 수 없다. 원음의
   음정을 모르고, 보정된 소리를 비교할 기준도 없기 때문이다(사용자 보고
   2026-09-22).

   🔴 이 도구의 요점은 **맥놀이(beating)** 다.

   같은 음을 두 트랙에 겹쳐 재생하면, 두 음정이 정확히 같을 때만 하나로 뭉쳐
   들린다. 조금이라도 어긋나면 **소리가 주기적으로 커졌다 작아진다** — 그 주기가
   곧 주파수 차이다. 사람은 이 흔들림을 **음정 차이보다 훨씬 민감하게** 알아챈다.

     A3(220 Hz) 에서   5센트 차이 → 약 0.64 Hz (1.6 초에 한 번 출렁)
                     10센트 차이 → 약 1.27 Hz (0.8 초에 한 번)
                     20센트 차이 → 약 2.5 Hz  (확연한 떨림)

   2 초짜리 음이면 5센트도 한 번 이상 출렁이므로 들린다. 즉 **"출렁이지 않으면
   5센트 이내"** 라는 판정을 귀로 할 수 있다.

     node tools/make-pitch-accuracy-audio.js

   출력 (test-audio/ — WAV 은 .gitignore 대상, 이 스크립트만 커밋한다):
     pitch-acc-source.wav    보정할 원본 (A3 · C4 · E4 · G4, 각 2 초)
     pitch-acc-ref+2.wav     같은 것을 **처음부터 +2 반음으로** 합성한 기준
     pitch-acc-ref+5.wav     같은 것을 +5 반음으로
     pitch-acc-ref-3.wav     같은 것을 −3 반음으로
     pitch-acc-howto.md      시험 절차와 정답표

   ── 왜 비브라토도 포르타멘토도 없는가 ──────────────────────────────────────
   여기서 재는 것은 **음정의 정확도 하나**다. 흔들림이 있으면 맥놀이와 구별되지
   않는다. 노래다움은 make-pitch-test-audio.js 가 맡고, 이 파일은 일부러
   밋밋하다 — 다만 사인파는 아니다(배음이 있어야 PSOLA 가 실제로 하는 일을 한다).
   ========================================================================== */
const fs = require('fs');
const path = require('path');

const SR = 48000;
const OUT_DIR = path.join(__dirname, '..', 'test-audio');
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiName = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// make-pitch-test-audio.js 와 같은 성도 모델 — 배음 구조가 같아야 그쪽 결과와
// 이어서 읽을 수 있다.
const VOWELS = { a: [[730, 90, 1.0], [1090, 110, 0.55], [2440, 170, 0.28]] };
function resonance(f, F, B) {
  const Q = F / B, r = f / F;
  return 1 / Math.sqrt(Math.pow(1 - r * r, 2) + Math.pow(r / Q, 2));
}
function harmonicAmp(k, f0) {
  const f = k * f0;
  if (f > SR / 2 * 0.9) return 0;
  let form = 0;
  for (const [F, B, g] of VOWELS.a) form += g * resonance(f, F, B);
  return form / Math.pow(k, 1.1);
}

// 흔들림 없는 정상음 하나. 위상은 **고정 0** 으로 시작한다 — 난수로 두면 같은
// 스크립트를 두 번 돌릴 때 기준 파일이 달라져 A/B 가 성립하지 않는다.
function tone(buf, t0, dur, midi, gain = 0.5) {
  const i0 = Math.round(t0 * SR), len = Math.round(dur * SR);
  const f0 = midiHz(midi);
  const K = Math.min(40, Math.floor((SR / 2 * 0.9) / f0));
  const amps = [];
  let norm = 0;
  for (let k = 1; k <= K; k++) { const a = harmonicAmp(k, f0); amps.push(a); norm += a; }
  if (norm <= 0) return;
  const atk = Math.round(0.030 * SR), rel = Math.round(0.060 * SR);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let env = 1;
    if (i < atk) env = i / atk;
    else if (i > len - rel) env = (len - i) / rel;
    let s = 0;
    for (let k = 1; k <= K; k++) s += amps[k - 1] * Math.sin(2 * Math.PI * f0 * k * t);
    buf[i0 + i] += (s / norm) * env * gain;
  }
}

function writeWav(file, data) {
  const N = data.length;
  const b = Buffer.alloc(44 + N * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + N * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(N * 2, 40);
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(data[i]));
  const g = peak > 0.95 ? 0.95 / peak : 1;
  for (let i = 0; i < N; i++) {
    const v = Math.max(-1, Math.min(1, data[i] * g));
    b.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, b);
  return b.length;
}

// ── 음원 구성 ─────────────────────────────────────────────────────────────
// 음마다 2 초. 5 센트 차이(0.64 Hz)도 2 초 안에 한 번 이상 출렁이므로 들린다.
// 사이 0.6 초 무음 — 눈으로 구간을 찾고, 앞 음의 잔향이 다음 판정을 흐리지 않게.
const LEAD = 0.5, DUR = 2.0, GAP = 0.6;
const NOTES = [57, 60, 64, 67];          // A3 · C4 · E4 · G4
const SHIFTS = [2, 5, -3];

function build(shift) {
  const total = LEAD + NOTES.length * (DUR + GAP);
  const buf = new Float32Array(Math.round(total * SR) + SR);
  let t = LEAD;
  const rows = [];
  for (const m of NOTES) {
    tone(buf, t, DUR, m + shift);
    rows.push({ t0: t, t1: t + DUR, from: m, to: m + shift });
    t += DUR + GAP;
  }
  return { buf, rows };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const src = build(0);
writeWav(path.join(OUT_DIR, 'pitch-acc-source.wav'), src.buf);
const refs = {};
for (const s of SHIFTS) {
  const r = build(s);
  const name = 'pitch-acc-ref' + (s > 0 ? '+' : '') + s + '.wav';
  writeWav(path.join(OUT_DIR, name), r.buf);
  refs[s] = { name, rows: r.rows };
}

// ── 절차서 ────────────────────────────────────────────────────────────────
const fmt = (x) => x.toFixed(2);
let md = '# 음정 정확도 귀 검증 (T-2.8.1-1 추가3)\n\n';
md += '> `node tools/make-pitch-accuracy-audio.js` 가 만든 파일들. **WAV 은 저장소에 넣지 않는다** — 필요할 때 다시 만든다.\n\n';
md += '## 🔴 요점 — 맥놀이로 판정한다\n\n';
md += '같은 음을 두 트랙에 **겹쳐 재생**하면, 두 음정이 정확히 같을 때만 하나로 뭉쳐 들린다.\n';
md += '어긋나면 소리가 **주기적으로 커졌다 작아진다**(맥놀이). 사람은 이 흔들림을 음정 차이보다\n';
md += '훨씬 민감하게 알아챈다.\n\n';
md += '| 음정 차이 | A3(220 Hz)에서 맥놀이 | 2초 동안 |\n|---|---|---|\n';
md += '| 5센트 | 0.64 Hz | 약 1.3회 출렁 |\n| 10센트 | 1.27 Hz | 약 2.5회 |\n| 20센트 | 2.54 Hz | 약 5회 — 확연 |\n\n';
md += '👉 **출렁이지 않으면 5센트 이내**, 즉 합격이다.\n\n';
md += '## 절차\n\n';
md += '1. 새 프로젝트에 **`pitch-acc-source.wav`** 를 Audio In 트랙으로 가져온다.\n';
md += '2. 클립 우클릭 → `Pitch Editor...` → `Analyze`.\n';
md += '3. 네 블록이 **A3 · C4 · E4 · G4** 로 잡히는지 먼저 확인한다(여기가 틀리면 그다음은 의미 없다).\n';
md += '4. `Ctrl+A` 대신 **첫 블록 클릭 → 마지막 블록 Shift+클릭**으로 넷을 모두 고른다.\n';
md += '5. 아래 표의 이동량만큼 드래그한다. `AMT` 는 **100%**, `VIB` 는 아무거나(비브라토가 없다).\n';
md += '6. `Apply`.\n';
md += '7. **다른 트랙**에 해당 기준 WAV 를 가져와 **시작 위치를 정확히 0 으로 맞춘다**.\n';
md += '8. 두 트랙을 함께 재생한다 → 🔴 **출렁임이 들리는가?**\n';
md += '   - 안 들린다 → 합격(5센트 이내)\n';
md += '   - 느리게 한두 번 출렁 → 5~10센트\n';
md += '   - 확연히 떨림 → 20센트 이상, 불합격\n';
md += '9. 한 트랙씩 Solo 로 번갈아 들어 **음색 차이**도 본다(정확도와 별개로 PSOLA 의 음질).\n\n';
md += '⚠️ **두 클립의 시작 위치가 어긋나면 맥놀이가 아니라 에코로 들린다.** 스냅을 켜고 둘 다 0 에 붙일 것.\n\n';
md += '## 이동량별 기준 파일\n\n';
for (const s of SHIFTS) {
  md += '### ' + (s > 0 ? '+' : '') + s + ' 반음 → `' + refs[s].name + '`\n\n';
  md += '| 시각(초) | 원음 | 목표 |\n|---|---|---|\n';
  for (const r of refs[s].rows) {
    md += '| ' + fmt(r.t0) + ' ~ ' + fmt(r.t1) + ' | ' + midiName(r.from) + ' (' + midiHz(r.from).toFixed(2) + ' Hz) | '
        + midiName(r.to) + ' (' + midiHz(r.to).toFixed(2) + ' Hz) |\n';
  }
  md += '\n';
}
md += '## 참고 — 계측은 이미 통과했다\n\n';
md += '`node tools/psola-harness.js` 가 같은 것을 수치로 재고 있고 **오차 중앙값 0.3센트**다.\n';
md += '이 음원은 그 수치가 **실제 앱에서, 실제 파일로, 귀로도** 성립하는지를 보기 위한 것이다 —\n';
md += '하네스는 엔진 함수를 직접 부르지만 앱은 분석 → 노트 → 프린트 → 저장을 거친다.\n';
fs.writeFileSync(path.join(OUT_DIR, 'pitch-acc-howto.md'), md, 'utf8');

console.log('생성 완료 → ' + OUT_DIR);
console.log('  pitch-acc-source.wav   (' + NOTES.map(midiName).join(' · ') + ', 각 ' + DUR + '초)');
for (const s of SHIFTS) console.log('  ' + refs[s].name);
console.log('  pitch-acc-howto.md     ← 절차서. 먼저 읽을 것');
