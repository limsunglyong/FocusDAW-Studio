# Playbar seek 수정 핸드오프 (2026-08-03)

> **목적**: 이 PC에서 오늘 수정한 **화살표 키 play bar seek** 버그 2건(v1.43.24, v1.43.25)을,
> 코드가 더 최신인 **다른 PC**에 다시 적용하기 위한 자립형 문서.
> 다른 PC는 라인 번호가 다를 수 있으므로 **아래 "찾을 코드(앵커)"로 검색**해서 바꾸세요.
> 대상 파일: `audio-bridge.js`, `app.jsx`, 버전 3파일(`version.js`·`package.json`·`ui-help.jsx`).
> **렌더러 재빌드만 필요**(`node scripts/build-renderers.js`). `audio-bridge.js`는 플레인 로드지만
> `app.jsx`는 esbuild 번들이므로 재빌드 필수. **네이티브(`FocusDAW-AudioEngine.exe`) 재빌드 불필요.**

---

## 증상 (네이티브 엔진 연결 상태에서만)

트랙을 여러 개 연 상태에서 키보드 화살표로 play bar를 움직일 때:

1. **forward(→) 들쭉날쭉**: 화살표를 누르고 있으면 순차 증가하지 않고 튐. 예) 01:01 → 01:05 → 01:02.
2. **backward(←) 제자리 고착**: 왼쪽 화살표로 시간이 감소하지 않음(사실상 안 움직임).

두 증상은 **원인이 다르다**. v1.43.24가 ①을, v1.43.25가 ②를 고쳤다.

---

## 수정 1 — v1.43.24: 네이티브 seek `ack` 프레임이 로컬 위치를 되돌림 (forward 튐)

### 원인
- 화살표 seek는 `cur = DAW.getPlayhead()`를 읽고 `DAW.seek(next)`를 호출한다. 네이티브+정지 상태에서
  `getPlayhead()`는 `nativeState.offset`을 반환하고, `seek()`는 그 자리에서 `nativeState.offset`을 권위 있게 갱신한다.
- 네이티브 엔진은 **seek 명령마다 `ack:true` playbackPosition 프레임을 되쏜다**(`WebSocketServer.cpp`,
  play/pause/stop/seek 공통). 그런데 stale-프레임 방어선이 `!msg.ack`인 프레임만 버리고 **ack는 통과**시켰다.
- 화살표를 누르고 있으면 seek가 ~50ms마다 연발되는데, ack는 왕복 지연이 있어 **이미 offset이 앞서간 뒤
  한 박자 늦은 ack(옛 위치)** 가 도착해 `nativeState.offset`을 과거 값으로 덮어씀 → 다음 넛지가 되돌아간
  값 기준으로 계산 → 앞뒤로 튐.

### 변경 — `audio-bridge.js` (`handleNativeMessage` 안, `msg.event === "playbackPosition"` 블록)

**찾을 코드(앵커):**
```js
      const stale = (!msg.ack && msg.isPlaying === false && nativeState.isPlaying &&
        (Date.now() - nativeState.lastPlaySentAt) < 500) ||
        (!msg.ack && (Date.now() - nativeState.lastSeekSentAt) < 500);
```

**바꿀 코드:** (seek 절에서 `!msg.ack &&` 제거 — ack 프레임도 함께 드롭)
```js
      // The seek clause drops ALL frames within the window, including ack:true.
      // The engine echoes an ack playbackPosition for every seek command
      // (WebSocketServer.cpp), and that ack lags by a round-trip. When an arrow
      // key is HELD, seek() fires every ~50ms and already set nativeState.offset
      // authoritatively; a late ack carrying an EARLIER seek's position would
      // then clobber offset back to a stale value, so getPlayhead() returns a
      // rewound position and the next nudge is computed from it — the playbar
      // jitters non-monotonically forward and makes no progress backward. Since
      // seek() is the authority for offset, no incoming frame (ack or not) may
      // override it during the seek window. Each held press refreshes
      // lastSeekSentAt so the window persists for the whole hold; on release a
      // normal broadcast settles offset to the final seek target after 500ms.
      const stale = (!msg.ack && msg.isPlaying === false && nativeState.isPlaying &&
        (Date.now() - nativeState.lastPlaySentAt) < 500) ||
        ((Date.now() - nativeState.lastSeekSentAt) < 500);
```

> 핵심 diff는 마지막 줄뿐: `(!msg.ack && (Date.now() - nativeState.lastSeekSentAt) < 500)`
> → `((Date.now() - nativeState.lastSeekSentAt) < 500)`. play/pause 절(`lastPlaySentAt`)은 그대로 둔다.

---

## 수정 2 — v1.43.25: backward 넛지가 비동기 getPlayhead 표류로 제자리 고착

### 원인
- 화살표 seek가 **매 키 반복마다** `DAW.getPlayhead()`를 다시 읽어 `ceil(cur)-1`(back)/`floor(cur)+1`(fwd)로 계산했다.
- 네이티브에서 `getPlayhead()`는 **비동기**다. 재생 중이거나 seek 직후 `startTime`이 갱신된 상태에서는
  `offset + elapsed`로 프레임 사이에 조금씩 앞으로 흐른다. 키를 누르고 있으면 seek가 ~50ms마다 발사되는데,
  그 사이 보고 위치가 살짝 커져 **backward는 `ceil(cur)-1`이 계속 같은 정수로 계산 → 제자리 고착**.
  forward는 `floor(cur)+1`이라 앞으로는 전진해 증상이 안 보였다(비대칭).

### 변경 A — `app.jsx`: 넛지 체인용 ref 추가

play bar 화살표 seek를 처리하는 `useEffect`(키다운 핸들러 `const k = (e) => {...}`가 들어 있는 것) **바로 앞**에
ref 하나를 선언한다. 이 PC에서는 `}, [loadProjectJson, electronFilePath]);` 직후였다.

**찾을 코드(앵커):** (해당 useEffect의 시작부. 다른 PC에선 deps 배열이 다를 수 있으니 `isTextInput` 정의로 찾는 게 안전)
```js
  useEffect(() => {
    const isTextInput = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };
```

**바꿀 코드:** (위 `useEffect(` 앞에 ref 선언 삽입)
```js
  // Held ←/→ playhead nudge chains off its last commanded target ({at, target})
  // instead of re-reading the async native playhead each repeat — see the seek
  // block below for why (backward used to stall on the native engine).
  const seekNudgeRef = useRef(null);

  useEffect(() => {
    const isTextInput = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };
```

### 변경 B — `app.jsx`: 화살표 seek 계산을 "직전 목표 연쇄"로 교체

**찾을 코드(앵커):** (Comma/ArrowLeft/Period/ArrowRight seek 블록. v1.43.24까지 반영된 상태거나,
그 이전 원본이면 `const cur = DAW.getPlayhead();` 한 줄짜리일 수 있다 — 어느 쪽이든 이 블록 전체를 아래로 교체)
```js
      if (!mod && (e.code === "Comma" || e.code === "ArrowLeft" || e.code === "Period" || e.code === "ArrowRight")) {
        e.preventDefault();
        const T = transportRef.current;
        if ((T.isRecordingActive && T.isRecordingActive()) || (T.isCountingIn && T.isCountingIn())) return; // no seeking mid-record
        const back = (e.code === "Comma" || e.code === "ArrowLeft");
        const cur = DAW.getPlayhead();
        const EPS = 1e-6;
        const next = back ? Math.ceil(cur - EPS) - 1 : Math.floor(cur + EPS) + 1;
        DAW.seek(next);
        force((n) => n + 1);
        return;
      }
```

**바꿀 코드:**
```js
      if (!mod && (e.code === "Comma" || e.code === "ArrowLeft" || e.code === "Period" || e.code === "ArrowRight")) {
        e.preventDefault();
        const T = transportRef.current;
        if ((T.isRecordingActive && T.isRecordingActive()) || (T.isCountingIn && T.isCountingIn())) return; // no seeking mid-record
        const back = (e.code === "Comma" || e.code === "ArrowLeft");
        // Whole-second grid nudge. Do NOT recompute from DAW.getPlayhead() on every
        // key repeat: with the native engine that value is asynchronous. A held key
        // fires a seek every ~50ms while getPlayhead lags/creeps forward between
        // presses (when isPlaying, it is offset + elapsed). That drift made BACKWARD
        // stall — ceil(cur)-1 kept resolving to the same integer as the reported
        // position crept back up — even though FORWARD (floor(cur)+1) still advanced.
        // Instead chain each held step off the LAST commanded target so the sequence
        // is deterministic and symmetric in both directions. A fresh press (>400ms
        // gap) re-reads the real playhead to pick up mouse seeks / playback.
        // A tiny epsilon keeps a value already on the grid from being a no-op /
        // double-step; the result is clamped to [0, duration].
        const now = Date.now();
        const chain = seekNudgeRef.current && (now - seekNudgeRef.current.at) < 400;
        const base = chain ? seekNudgeRef.current.target : DAW.getPlayhead();
        const EPS = 1e-6;
        const stepped = back ? Math.ceil(base - EPS) - 1 : Math.floor(base + EPS) + 1;
        const next = Math.max(0, Math.min(stepped, DAW.duration || Infinity));
        seekNudgeRef.current = { at: now, target: next };
        DAW.seek(next);
        force((n) => n + 1);
        return;
      }
```

> 참고: 이 블록 바로 위에 "선택된 클립이 있으면 ←/→를 클립 넛지로 가로채는" 블록
> (`if ((e.code === "ArrowLeft" || e.code === "ArrowRight") && selectedClipRef.current) {`)이 있다.
> 그건 건드리지 않는다 — clip 선택이 없을 때만 위 play bar seek로 떨어진다.

---

## 버전 상향 (다른 PC의 현재 버전에서 patch만 올리면 됨)

이 PC 기준으로는 `1.43.23` → `1.43.24`(forward) → `1.43.25`(backward)였다. 다른 PC는 버전이 더 높을 수
있으니 **거기 현재 버전에서 patch +1** 로 맞추면 된다. 세 곳을 동일 문자열로:

- `version.js` — `window.APP_VERSION = "..."`
- `package.json` — `"version": "..."`
- `ui-help.jsx` — `RELEASE_NOTES.range`("v… - v…")의 끝 버전, 그리고 `fixes` 배열에 아래 항목 추가:
  ```
  "Fixed the arrow-key play bar movement on the native engine — the right arrow now steps forward smoothly instead of jumping around, and the left arrow steps backward reliably (held keys chain off the last step so backward no longer stalls).",
  ```

---

## 재빌드 & 검증

```
node scripts/build-renderers.js     # app.js·ui-help.js 등 번들 (필수)
node -c audio-bridge.js             # 구문 확인(선택)
```

**시험(T-1.43.24-1)** — 네이티브 엔진 연결 + 스템 여러 개, 정지 상태:
- play bar를 중간(약 5초)에 마우스로 찍는다.
- **→** 꾹 누름 → 되돌아가거나 튀지 않고 매끄럽게 증가.
- **←** 꾹 누름 → 실제로 감소해 0초까지 내려감(제자리 고착 없음).
- →/← 짧게 탭 → 매번 정수 초 그리드로 ±1초.

---

## 관련 문서(이 PC 기준)
- `앱개발.md` v1.43.24 / v1.43.25 섹션 (원인·수정·검증 상세)
- `시험-아카이브.md` — T-1.43.24-1 통과(2026-08-03)
- 근본 배경: `WebSocketServer.cpp`의 seek ack 브로드캐스트, `audio-bridge.js`의 `nativeState.offset`/`getPlayhead()`/`seek()`
