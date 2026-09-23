/* ============================================================
 * native-handover-harness.js — 네이티브 출력 핸드오버 게이트 (v2.9.1)
 *
 * 지키는 것: **보낼 것이 남았으면 넘기지 않는다.**
 *
 * 🔴 v2.4.8 이 "오디오가 아직 손에 없는 트랙은 건너뛴다"를 넣으면서 그 트랙들이
 *    `pendingNativeLoads` 에 들어가지 않게 됐는데, 게이트는 그 집합만 봤다. 그래서
 *    보낼 것이 남았는데도 통과해 **웹 엔진이 음소거되고 늦게 오는 트랙이 안 들렸다.**
 *    프로젝트를 열자마자 Play 를 누를 때만 드러나는 종류였다.
 *
 * ⚠️ audio-bridge.js 는 WebSocket 을 열며 자동 초기화되어 통째로 vm 에 실을 수 없다.
 *    그래서 **판정 함수(`trackAudioReady`)를 떼어 내 진리표를 재고**, 게이트가 그것을
 *    실제로 경유하는지는 **구조 검사**로 지킨다. 타이밍 자체는 사용자 시험의 몫이다.
 *
 *   node tools/native-handover-harness.js
 *   node tools/native-handover-harness.js --mutate   ← 게이트를 옛 모습으로. FAIL 이 정상.
 * ============================================================ */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MUTATE = process.argv.includes('--mutate');
const SRC_PATH = path.join(ROOT, 'audio-bridge.js');
let SRC = fs.readFileSync(SRC_PATH, 'utf8').split(String.fromCharCode(13)).join('');

if (MUTATE) {
  const before = SRC;
  // 고친 것을 되돌린다 — 보낸 것만 세던 옛 게이트.
  SRC = SRC.replace('if (nativeLoadsOutstanding()) return;', 'if (pendingNativeLoads.size > 0) return;');
  if (SRC === before) { console.error('변이 실패 — 게이트를 못 찾았다.'); process.exit(2); }
}

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  —  ' + detail : ''}`);
};

console.log(`\n네이티브 핸드오버 게이트${MUTATE ? '  [변이: 보낸 것만 세던 옛 게이트]' : ''}\n`);

// ── ① 판정 함수를 떼어 낸다 ───────────────────────────────────────────────
console.log('① trackAudioReady — 이 트랙을 지금 밀어도 되는가');
{
  const a = SRC.indexOf('function trackAudioReady(track) {');
  if (a < 0) { console.error('trackAudioReady 를 못 찾았다.'); process.exit(2); }
  const b = SRC.indexOf(String.fromCharCode(10) + '  }', a);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(SRC.slice(a, b + 4) + String.fromCharCode(10) + 'this.f = trackAudioReady;', ctx);
  const ready = ctx.f;

  check('보통 트랙은 밀어도 된다', ready({ sources: [{ filePath: '/a.wav' }] }) === true);
  check('트랙이 없으면 아니다', ready(null) === false);
  check('🔴 needsAudio 인 트랙은 아직 아니다 (재연결 전의 상대 경로가 밀린다)',
        ready({ needsAudio: true, sources: [] }) === false);
  check('녹음 중인 트랙은 밀지 않는다 (재디코딩이 입력을 끊는다)',
        ready({ recording: true, sources: [] }) === false);
  check('🔴 여분 Take 하나라도 재연결 전이면 아직 아니다',
        ready({ sources: [{ filePath: '/a.wav' }, { needsAudio: true, filePath: '/b.wav' }] }) === false);
  check('filePath 없는 placeholder 는 막지 않는다 (밀 것이 없다)',
        ready({ sources: [{ needsAudio: true }] }) === true);
  check('sources 가 없어도 통과한다', ready({}) === true);
}

// ── ② 게이트가 그 판정을 실제로 경유하는가 (구조 검사) ─────────────────────
console.log('');
console.log('② 핸드오버 게이트가 "보낼 것이 남았는가"를 본다');
{
  const g = SRC.indexOf('function maybeActivateNativeOutput()');
  const body = g < 0 ? '' : SRC.slice(g, SRC.indexOf(String.fromCharCode(10) + '  }', g));
  check('게이트가 있다', g >= 0);
  check('🔴 ② 게이트가 nativeLoadsOutstanding() 을 거친다',
        body.indexOf('nativeLoadsOutstanding()') >= 0,
        body.indexOf('pendingNativeLoads.size') >= 0 ? '아직 보낸 것만 센다' : 'ok');

  const o = SRC.indexOf('function nativeLoadsOutstanding()');
  const obody = o < 0 ? '' : SRC.slice(o, SRC.indexOf(String.fromCharCode(10) + '  }', o));
  check('판정 함수가 있다', o >= 0);
  check('🔴 아직 보낸 것도 센다 (진행 중인 로드)', obody.indexOf('pendingNativeLoads.size') >= 0);
  check('🔴 아직 못 보낸 것도 센다 (trackAudioReady)', obody.indexOf('trackAudioReady') >= 0);
  check('녹음 중인 트랙은 막지 않는다', obody.indexOf('recording') >= 0);
}

// ── ③ 영구 대기 방지 ──────────────────────────────────────────────────────
console.log('');
console.log('③ 영영 준비되지 않는 트랙이 있어도 막히지 않는다');
{
  check('15초 폴백이 그대로 있다', SRC.indexOf('activating native output anyway') >= 0);
  check('폴백이 pendingNativeLoads 를 비우고 강제로 넘긴다',
        /pendingNativeLoads\.clear\(\);[\s\S]{0,80}activateNativeOutput\(\);/.test(SRC));
}

console.log(`\n${pass} PASS · ${fail} FAIL`);
if (MUTATE) {
  console.log(fail > 0 ? '\n✅ 변이 시험 통과 — 옛 게이트로 되돌리면 하네스가 잡아낸다.'
                       : '\n🔴 변이했는데도 전건 통과 — 이 하네스는 게이트를 지키지 못한다.');
  process.exit(fail > 0 ? 0 : 1);
}
process.exit(fail ? 1 : 0);
