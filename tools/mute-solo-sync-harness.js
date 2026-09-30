#!/usr/bin/env node
/* ============================================================
 * mute-solo-sync-harness.js — Solo/Mute 가 화면과 네이티브에서 같은가 (v2.11.3)
 *
 * 사용자 보고(2026-09-30): 가끔 Audio In 1 만 소리가 안 난다. 믹서의 마스터 미터는
 * 움직이는데 Audio In 1 트랙 미터는 0 — 즉 **네이티브가 그 트랙을 끄고 있다**
 * (memory: silent-output-disconnected-device 판별표 첫 줄). 화면의 S/M 은 모두 꺼져 있다.
 * Solo/Mute · 파일 트랙 일괄 Mute 를 만지다 생긴다고 추정.
 *
 * 방법 — 엔진 경계에서 잰다(memory: bridge-wrapper-required).
 *   실제 audio-engine.js + audio-bridge.js 를 vm 에 올리고, WebSocket 을 가짜로 바꿔
 *   건너편에 **C++ AudioEngine 과 같은 규칙의 네이티브 모형**을 둔다:
 *     - loadTrack: 목록(registry)에 즉시 등록, 디코드는 뒤에서(비동기) — 끝나면 registry 의
 *       mute/solo 를 복사해 설치하고 trackLoaded 를 보낸다. 최신 seq 가 아니면 설치하지 않는다.
 *     - setTrackParam: registry 와 설치된 트랙 둘 다, Solo/Mute 상호 배타.
 *     - clearAllMuteSolo · removeTrack.
 *     - 출력 = !(mute || (anySolo && !solo)).
 *   그 위에서 사용자 조작을 무작위로 섞고, 조용해진 뒤 **화면(LocalDAW) 상태와 네이티브 상태**를
 *   트랙마다 비교한다.
 *
 *   node tools/mute-solo-sync-harness.js [--runs N] [--seed S] [--verbose]
 * ============================================================ */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv;
const argNum = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
const RUNS = argNum('--runs', 300);
const SEED0 = argNum('--seed', 1);
const VERBOSE = argv.includes('--verbose');

// ── 결정적 난수 ───────────────────────────────────────────────────────────────
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; }; }

// ── Web Audio 가짜 ────────────────────────────────────────────────────────────
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
  return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (c) => d[c],
           copyToChannel() {}, copyFromChannel() {} };
};
FakeCtx.prototype.decodeAudioData = function () { return Promise.resolve(this.createBuffer(1, 48000 * 4, 48000)); };
FakeCtx.prototype.resume = () => Promise.resolve();
FakeCtx.prototype.suspend = () => Promise.resolve();
FakeCtx.prototype.close = () => Promise.resolve();
FakeCtx.prototype.setSinkId = () => Promise.resolve();

// ── 네이티브 모형 (AudioEngine.cpp 규칙) ───────────────────────────────────────
function makeNative(rand, deliver) {
  const reg = new Map();      // tracks (TrackInfo) — registered synchronously on loadTrack
  const juce = new Map();     // juceTracks — installed after decode
  const latest = new Map();   // latestLoadSeq
  let seq = 0;
  const pending = new Set();
  const excl = (o, key, v) => { if (key === 'mute') { o.mute = v; if (v) o.solo = false; } else { o.solo = v; if (v) o.mute = false; } };
  const log = [];
  return {
    reg, juce, log, pending,
    handle(msg) {
      log.push(msg);
      if (msg.command === 'loadTrack') {
        const id = msg.trackId;
        if (!reg.has(id)) reg.set(id, { mute: false, solo: false });
        const mySeq = ++seq; latest.set(id, mySeq);
        const job = { id, seq: mySeq };
        pending.add(job);
        // background decode: 0–40 ms
        setTimeout(() => {
          pending.delete(job);
          let ok = false;
          if (latest.get(id) === mySeq && reg.has(id)) {
            const r = reg.get(id);
            juce.set(id, { mute: r.mute, solo: r.solo });   // "Sync parameters (incl. any that arrived while decoding)"
            ok = true;
          }
          deliver({ event: 'trackLoaded', trackId: id, ok, pending: pending.size });
        }, Math.floor(rand() * 40));
      } else if (msg.command === 'setTrackParam' && (msg.key === 'mute' || msg.key === 'solo')) {
        const v = msg.value === true || Number(msg.value) > 0.5;
        if (reg.has(msg.trackId)) excl(reg.get(msg.trackId), msg.key, v);
        if (juce.has(msg.trackId)) excl(juce.get(msg.trackId), msg.key, v);
      } else if (msg.command === 'clearAllMuteSolo') {
        for (const o of reg.values()) { o.mute = false; o.solo = false; }
        for (const o of juce.values()) { o.mute = false; o.solo = false; }
      } else if (msg.command === 'removeTrack') {
        reg.delete(msg.trackId); latest.delete(msg.trackId); juce.delete(msg.trackId);
      } else if (msg.command === 'clearTracks' || msg.command === 'clear') {
        reg.clear(); juce.clear(); latest.clear();
      }
    },
    audible(id) {
      const t = juce.get(id); if (!t) return null;
      const anySolo = [...juce.values()].some(o => o.solo);
      return !(t.mute || (anySolo && !t.solo));
    },
  };
}

// ── 앱 하나를 띄운다 ─────────────────────────────────────────────────────────
function boot(seed) {
  const rand = rng(seed);
  const engineSrc = fs.readFileSync(path.join(ROOT, 'audio-engine.js'), 'utf8').split('\r').join('');
  const bridgeSrc = fs.readFileSync(path.join(ROOT, 'audio-bridge.js'), 'utf8').split('\r').join('');
  const sb = { console: { log() {}, warn() {}, error: console.error, info() {}, debug() {} },
    Math, Float32Array, Uint8Array, Int16Array, Int32Array, ArrayBuffer, DataView, Uint16Array, Blob: class { constructor(p) { this.p = p; } arrayBuffer() { return Promise.resolve(new ArrayBuffer(8)); } },
    Array, Object, Number, String, JSON, Date, Set, Map, WeakMap, isFinite, isNaN, parseInt, parseFloat, Promise, Error, Symbol, Reflect, Proxy,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, performance: { now: () => Date.now() },
    queueMicrotask };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  sb.document = { documentElement: {}, createElement: () => ({ style: {}, getContext: () => null }), addEventListener() {}, querySelector: () => null, visibilityState: 'visible', readyState: 'complete' };
  sb.addEventListener = () => {}; sb.removeEventListener = () => {};
  sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  sb.navigator = { userAgent: 'node', mediaDevices: null };
  sb.AudioContext = FakeCtx; sb.OfflineAudioContext = FakeCtx; sb.webkitAudioContext = FakeCtx;
  sb.requestAnimationFrame = (f) => setTimeout(f, 16);
  sb.Meyda = undefined;
  sb.BroadcastChannel = function () { return { postMessage() {}, close() {}, addEventListener() {} }; };
  let tmpN = 0;
  sb.electronAPI = { writeTempAudio: () => new Promise(r => setTimeout(() => r('/tmp/t' + (++tmpN) + '.wav'), Math.floor(rand() * 30))) };

  let native = null, sock = null;
  function FakeWS() { sock = this; this.readyState = 0; }
  FakeWS.OPEN = 1; FakeWS.CONNECTING = 0; FakeWS.CLOSED = 3;
  FakeWS.prototype.send = function (s) { native.handle(JSON.parse(s)); };
  FakeWS.prototype.close = function () {};
  sb.WebSocket = FakeWS;
  vm.createContext(sb);
  vm.runInContext(engineSrc, sb, { filename: 'audio-engine.js' });
  vm.runInContext(bridgeSrc, sb, { filename: 'audio-bridge.js' });
  const deliver = (m) => { if (sock && sock.onmessage) sock.onmessage({ data: JSON.stringify(m) }); };
  native = makeNative(rand, deliver);
  return { sb, DAW: sb.DAW, LocalDAW: sb.LocalDAW, native, rand, open() { sock.readyState = 1; sock.onopen && sock.onopen(); } };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function scenario(seed) {
  const app = boot(seed);
  const { DAW, LocalDAW, native, rand } = app;
  LocalDAW.clearTracks();
  const buf = new FakeCtx().createBuffer(1, 48000 * 4, 48000);
  const names = ['1 Backing Vocals', '3 Bass', 'Drums-1', 'Misc-1'];
  for (const n of names) LocalDAW.addBounceTrack(n, buf, { fileName: n + '.wav', filePath: '/p/' + n + '.wav' });
  const ai = LocalDAW.addAudioInTrack('Audio In 1');
  await LocalDAW.attachRecording(ai.id, 'Lead.wav', new ArrayBuffer(8), { filePath: '/p/Lead.wav' });
  app.open();
  await sleep(120);

  // app.jsx 의 undo 모형
  const undoStack = [], redoStack = [];
  let lastUndoKey = null;
  const pushUndo = () => { undoStack.push(DAW.getSnapshot()); redoStack.length = 0; };
  const isFileGroup = (t) => t.kind !== 'audioIn';
  const trackIds = () => LocalDAW.tracks.map(t => t.id);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const ops = [];
  const OPS = {
    mute() { const id = pick(trackIds()); const t = LocalDAW.tracks.find(x => x.id === id);
      const k = `${id}-mute`; if (lastUndoKey !== k) { pushUndo(); lastUndoKey = k; }
      DAW.setTrackParam(id, 'mute', !t.params.mute); return `mute ${t.name} → ${!!t.params.mute}`; },
    solo() { const id = pick(trackIds()); const t = LocalDAW.tracks.find(x => x.id === id);
      const k = `${id}-solo`; if (lastUndoKey !== k) { pushUndo(); lastUndoKey = k; }
      DAW.setTrackParam(id, 'solo', !t.params.solo); return `solo ${t.name} → ${!!t.params.solo}`; },
    muteAllFiles() { const ref = pick(LocalDAW.tracks.filter(isFileGroup)); const next = !ref.params.mute;
      pushUndo(); lastUndoKey = null;
      LocalDAW.tracks.forEach(t => { if (isFileGroup(t)) DAW.setTrackParam(t.id, 'mute', next); });
      return `muteAllFiles → ${next}`; },
    mixerMuteAllFiles() { const next = rand() < 0.5;
      LocalDAW.tracks.forEach(t => { if (isFileGroup(t)) DAW.setTrackParam(t.id, 'mute', next); });
      return `mixer MUTE_ALL_FILES → ${next}`; },
    clearAll() { DAW.clearAllMuteSolo(); return 'MUTE CLR'; },
    undo() { if (!undoStack.length) return 'undo (empty)';
      const cur = DAW.getSnapshot(); const r = undoStack.pop(); redoStack.push(cur); DAW.applySnapshot(r); lastUndoKey = null; return 'undo'; },
    redo() { if (!redoStack.length) return 'redo (empty)';
      undoStack.push(DAW.getSnapshot()); const r = redoStack.pop(); DAW.applySnapshot(r); lastUndoKey = null; return 'redo'; },
    reload() { const t = pick(LocalDAW.tracks); if (DAW.splitClip && t.clips && t.clips[0]) {
        pushUndo(); lastUndoKey = null;
        const c = t.clips[0]; DAW.splitClip(t.id, c.id, (c.start + c.end) / 2); return `split ${t.name} (reload)`; }
      return 'reload (skip)'; },
    wait() { return 'wait'; },
  };
  const weights = [['mute', 5], ['solo', 4], ['muteAllFiles', 2], ['mixerMuteAllFiles', 1], ['clearAll', 1], ['undo', 3], ['redo', 2], ['reload', 1], ['wait', 2]];
  const total = weights.reduce((a, [, w]) => a + w, 0);
  const choose = () => { let x = rand() * total; for (const [k, w] of weights) { if ((x -= w) < 0) return k; } return 'wait'; };

  const nOps = 10 + Math.floor(rand() * 25);
  for (let i = 0; i < nOps; i++) {
    const k = choose();
    ops.push(OPS[k]());
    await sleep(Math.floor(rand() * 25));   // 사람의 클릭 간격(짧게) — 로드가 도는 중에 끼어든다
  }
  await sleep(250);   // 조용해질 때까지

  // 비교
  const jsAnySolo = LocalDAW.tracks.some(t => t.params.solo);
  const bad = [];
  for (const t of LocalDAW.tracks) {
    const jsAud = !(t.params.mute || (jsAnySolo && !t.params.solo));
    const nAud = native.audible(t.id);
    const nj = native.juce.get(t.id);
    if (nAud === null) { bad.push(`${t.name}: 네이티브에 설치돼 있지 않다`); continue; }
    if (jsAud !== nAud || !!t.params.mute !== nj.mute || !!t.params.solo !== nj.solo)
      bad.push(`${t.name}: 화면 mute=${!!t.params.mute} solo=${!!t.params.solo} (들림 ${jsAud}) · 네이티브 mute=${nj.mute} solo=${nj.solo} (들림 ${nAud})`);
  }
  const extra = [...native.juce.keys()].filter(id => !LocalDAW.tracks.some(t => t.id === id));
  if (extra.length) bad.push(`네이티브에만 남은 트랙: ${extra.join(',')}`);
  return { seed, ops, bad, native };
}

(async () => {
  console.log(`\nSolo/Mute 화면 ↔ 네이티브 일치 — ${RUNS}회 무작위 (seed ${SEED0}…)\n`);
  let failures = 0; const shown = [];
  for (let r = 0; r < RUNS; r++) {
    const res = await scenario(SEED0 + r);
    if (res.bad.length) {
      failures++;
      if (shown.length < 3) shown.push(res);
    }
  }
  for (const res of shown) {
    console.log(`── seed ${res.seed} ─ 어긋남`);
    res.bad.forEach(b => console.log('   ✗ ' + b));
    console.log('   조작: ' + res.ops.join(' · '));
    if (VERBOSE) console.log('   네이티브 명령: ' + res.native.log.filter(m => /mute|solo|Mute|Solo|loadTrack|removeTrack/.test(JSON.stringify(m))).map(m => m.command + (m.key ? ':' + m.key + '=' + m.value : '') + ' ' + (m.trackId || '')).join(' | '));
    console.log('');
  }
  console.log(`${RUNS - failures} PASS · ${failures} FAIL`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
