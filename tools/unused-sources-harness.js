#!/usr/bin/env node
/* ============================================================
 * unused-sources-harness.js — 쓰이지 않는 소스 정리 회귀선 (v2.11.2)
 *
 * 사용자 보고: 프로젝트를 열면 마지막 파일 트랙(Misc-1.wav)이 유독 오래 걸린다.
 * 실제로는 그 뒤에 **Audio In 트랙의 옛 피치 보정본 17개**(42 MB × 17)를 읽고 있었고,
 * 진행 표시가 그 단계에서 갱신되지 않아 Misc-1 이 느려 보였다.
 *
 * 지키는 것
 *   ① liveSourceIds — 주 소스 · 클립 sourceId · 클립 pitch 의 원본/보정본만 "쓰인다"
 *   ② importProject — 쓰이지 않는 소스를 목록에서 뺀다 (열린 직후 Undo 는 비어 있다)
 *   ③ exportProject — 쓰이지 않는 소스를 파일에 적지 않는다. 메모리 목록은 그대로
 *   ④ getSnapshot  — 🔴 건드리지 않는다 (Undo 가 옛 보정본을 실제로 되살린다)
 *   ⑤ Clean Up 판정 — 스냅샷은 **그 스냅샷의 클립**으로 판정 → Undo 가 되살릴 파일은 보호
 *   ⑥ 보정본 이름 — "(Pitched) 3 (Pitched) (Pitched)" 처럼 꼬리가 쌓이지 않는다
 *
 *   node tools/unused-sources-harness.js
 *   ⑦ hydrateSource — 디코드 도중 자동 저장(normalize)이 끼어도 **살아 있는** 소스가 준비된다 (v2.11.4)
 *
 *   node tools/unused-sources-harness.js --mutate           ← 열기 가지치기를 끈다. FAIL 이 정상.
 *   node tools/unused-sources-harness.js --mutate-hydrate   ← await 앞에서 잡은 소스에 쓴다(v2.11.3). FAIL 이 정상.
 * ============================================================ */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MUTATE = process.argv.includes('--mutate');
const MUTATE_HYDRATE = process.argv.includes('--mutate-hydrate');

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
// ⑦ 은 디코드가 **시간이 걸려야** 경합이 생긴다 — 30 ms 뒤에 푼다.
FakeCtx.prototype.decodeAudioData = function () { return new Promise((r) => setTimeout(() => r(this.createBuffer(1, 48000, 48000)), 30)); };
FakeCtx.prototype.resume = () => Promise.resolve();
FakeCtx.prototype.suspend = () => Promise.resolve();
FakeCtx.prototype.close = () => Promise.resolve();
FakeCtx.prototype.setSinkId = () => Promise.resolve();

function loadEngine() {
  let src = fs.readFileSync(path.join(ROOT, 'audio-engine.js'), 'utf8').split(String.fromCharCode(13)).join('');
  if (MUTATE) {
    const before = src;
    src = src.replace('sources = sources.filter(s => live.has(s.id));', '/* mutated: no prune */');
    if (src === before) { console.error('변이 실패 — importProject 의 가지치기를 못 찾았다.'); process.exit(2); }
  }
  if (MUTATE_HYDRATE) {
    const before = src;
    src = src.replace('const live = (liveTrack.sources || []).find(s => s.id === sourceId) || src;', 'const live = src;');
    if (src === before) { console.error('변이 실패 — hydrateSource 의 재조회를 못 찾았다.'); process.exit(2); }
  }
  const sb = { console, Math, Float32Array, Uint8Array, Int32Array, Array, Object, Number, String, JSON, Date,
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
  return DAW;
}

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  —  ' + detail : ''}`);
};
const ids = (list) => (list || []).map(s => s.id).join(',');
const src = (id, filePath) => ({ id, filePath, fileName: filePath ? path.basename(filePath) : id, duration: 10,
  sampleRate: 48000, channels: 1, needsAudio: !!filePath, sourceTrackIds: [] });
const clip = (id, sourceId, extra) => ({ id, start: 0, end: 5, offset: 0, sourceId, sourceOffset: 0, duration: 5,
  gain: 1, muted: false, ...(extra || {}) });

// 사용자 프로젝트(test1.focus)의 모양을 줄인 것 — Audio In 트랙: 경로 없는 주 소스 + 원본 녹음 +
// 옛 보정본 여러 개(아무도 안 씀) + 지금 쓰는 보정본 하나(printedSourceId) + 클립이 직접 쓰는 것 하나.
function projectJson() {
  return {
    version: '0.12', schemaVersion: 2, projectName: 'h', duration: 10, loopRange: null,
    tempo: { projectBpm: 120, playbackBpm: 120, variBpm: false, key: 'C', keyShift: 0, variKey: false },
    master: { volume: 0.9, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    tracks: [
      { id: 'tf', name: 'Bass', kind: 'file', fileName: 'Bass.wav', filePath: '/p/Bass.wav',
        sources: [src('s_bass', '/p/Bass.wav')], clips: [clip('cf', 's_bass')], takes: [] },
      { id: 'ta', name: 'Audio In 1', kind: 'audioIn', fileName: null, filePath: null,
        sources: [
          src('s_prim', null),
          src('s_orig', 'rel/Recordings/Lead.wav'),
          src('s_old1', 'rel/Consolidated/Lead (Pitched).wav'),
          src('s_old2', 'rel/Consolidated/Lead (Pitched) 2.wav'),
          src('s_old3', 'rel/Consolidated/Lead (Pitched) 3 (Pitched).wav'),
          src('s_print', 'rel/Consolidated/Lead (Pitched) 4.wav'),
          src('s_direct', 'rel/Recordings/Lead 2.wav'),
        ],
        clips: [
          clip('c1', 's_prim'),
          clip('c2', 's_print', { pitch: { baseSourceId: 's_orig', printedSourceId: 's_print', notes: [], edits: [] } }),
          clip('c3', 's_direct'),
        ],
        takes: [] },
    ],
  };
}

console.log(`\n쓰이지 않는 소스 정리 회귀선${MUTATE ? '  [변이: 열기 가지치기 끔]' : ''}\n`);

console.log('① liveSourceIds');
{
  const D = loadEngine();
  const j = projectJson().tracks[1];
  const live = D.liveSourceIds(j.sources, j.clips);
  const got = [...live].sort().join(',');
  check('주 소스 · 클립 sourceId · pitch 원본/보정본만', got === 's_direct,s_orig,s_prim,s_print', got);
  check('옛 보정본 3개는 쓰이지 않는다', !live.has('s_old1') && !live.has('s_old2') && !live.has('s_old3'));
  check('클립이 없어도 주 소스는 쓰인다', D.liveSourceIds([src('only', '/x.wav')], []).has('only'));
}

console.log('');
console.log('② importProject — 열 때 목록에서 뺀다');
{
  const D = loadEngine();
  D.importProject(projectJson());
  const a = D.tracks.find(t => t.id === 'ta');
  check('🔴 Audio In 소스 7개 → 4개 (옛 보정본 3개 제거)', ids(a.sources) === 's_prim,s_orig,s_print,s_direct', ids(a.sources));
  check('파일 트랙은 그대로', ids(D.tracks.find(t => t.id === 'tf').sources) === 's_bass');
  // 이것이 브리지의 trackAudioReady 가 보는 조건이다 — 남아 있으면 트랙이 네이티브로 안 간다.
  const pendingUnused = a.sources.filter(s => s.needsAudio && s.filePath && /^s_old/.test(s.id));
  check('불러오지 않을 소스가 needsAudio 로 남지 않는다 (trackAudioReady 를 막지 않는다)', pendingUnused.length === 0);
  check('pitch 원본·보정본 참조가 살아 있다', !!a.clips.find(c => c.pitch && c.pitch.printedSourceId === 's_print'));
}

console.log('');
console.log('③ exportProject — 파일에 적지 않는다, 메모리는 그대로');
{
  const D = loadEngine();
  D.importProject(projectJson());
  const a = D.tracks.find(t => t.id === 'ta');
  // 세션 중 Apply 가 새 보정본을 만들고 옛 것은 Undo 를 위해 목록에 남긴 상황을 흉내 낸다.
  a.sources.push(src('s_superseded', 'rel/Consolidated/Lead (Pitched) 5.wav'));
  const out = D.exportProject('h').tracks.find(t => t.id === 'ta');
  check('🔴 저장 파일에 쓰이지 않는 소스가 없다', !out.sources.some(s => s.id === 's_superseded'), ids(out.sources));
  check('쓰이는 소스는 모두 적힌다', ['s_prim', 's_orig', 's_print', 's_direct'].every(id => out.sources.some(s => s.id === id)));
  check('메모리의 목록은 그대로 (Undo 대비)', a.sources.some(s => s.id === 's_superseded'));
}

console.log('');
console.log('④ getSnapshot — 건드리지 않는다');
{
  const D = loadEngine();
  D.importProject(projectJson());
  const a = D.tracks.find(t => t.id === 'ta');
  a.sources.push(src('s_superseded', 'rel/Consolidated/Lead (Pitched) 5.wav'));
  const snap = D.getSnapshot().tracks.find(t => t.id === 'ta');
  check('🔴 스냅샷은 쓰이지 않는 소스도 담는다', snap.sources.some(s => s.id === 's_superseded'), ids(snap.sources));
}

console.log('');
console.log('⑤ Clean Up 판정 — 스냅샷은 그 스냅샷의 클립으로');
{
  const D = loadEngine();
  D.importProject(projectJson());
  const a = D.tracks.find(t => t.id === 'ta');
  // Apply 직전 스냅샷: c2 가 s_print 를 쓴다. Apply 뒤: c2 가 새 보정본 s_new 를 쓴다.
  const before = D.getSnapshot().tracks.find(t => t.id === 'ta');
  a.sources.push(src('s_new', 'rel/Consolidated/Lead (Pitched) 6.wav'));
  const c2 = a.clips.find(c => c.id === 'c2');
  c2.sourceId = 's_new'; c2.pitch.printedSourceId = 's_new';
  const nowLive = D.liveSourceIds(a.sources, a.clips);
  const snapLive = D.liveSourceIds(before.sources, before.clips);
  check('현재 상태에서 옛 보정본은 쓰이지 않는다', !nowLive.has('s_print'));
  check('🔴 Undo 스냅샷이 쓰므로 보호된다 (Clean Up 이 지우지 않는다)', snapLive.has('s_print'));
  check('아무도 안 쓰는 것은 어느 쪽에서도 쓰이지 않는다 → 지울 수 있다',
        !nowLive.has('s_old1') && !snapLive.has('s_old1'));
}

console.log('');
console.log('⑥ 보정본 이름에 꼬리가 쌓이지 않는다');
{
  const D = loadEngine();
  D.clearTracks();
  const b = new FakeCtx().createBuffer(1, 4800, 48000);
  const t = D.addBounceTrack('Lead', b, { fileName: 'Lead.wav', filePath: '/x/Lead.wav' });
  const cases = [
    ['Lead.wav', 'Lead (Pitched).wav'],
    ['Lead (Pitched).wav', 'Lead (Pitched).wav'],
    ['Lead (Pitched) 3 (Pitched) (Pitched).wav', 'Lead (Pitched).wav'],
    ['Lead (De-noised) (Pitched) 2.wav', 'Lead (De-noised) (Pitched).wav'],   // 다른 종류 꼬리는 남는다
    ['Take (1).wav', 'Take (1) (Pitched).wav'],   // 우리가 붙인 꼬리가 아니면 건드리지 않는다
  ];
  (async () => {
    for (const [fileName, want] of cases) {
      const sid = 'sx_' + Math.random().toString(36).slice(2, 7);
      t.sources.push({ id: sid, filePath: null, fileName, duration: 0.1, sampleRate: 48000, channels: 1, needsAudio: false });
      t._rawBuffers = t._rawBuffers || {}; t._rawBuffers[sid] = b;
      D._pendingConsolidations.push({ trackId: t.id, sourceId: sid, suffix: 'Pitched' });
      let name = null;
      await D.persistConsolidatedSources(async (_raw, n) => { name = n; return { path: '/x/' + n }; });
      check(`"${fileName}" → "${want}"`, name === want, name);
    }

    console.log('');
    console.log('⑦ hydrateSource — 디코드 도중 자동 저장이 끼어도 살아 있는 소스가 준비된다');
    {
      const D2 = loadEngine();
      D2.importProject(projectJson());
      const a = D2.tracks.find(t => t.id === 'ta');
      const p = D2.hydrateSource('ta', 's_orig', new ArrayBuffer(8), { filePath: 'rel/Recordings/Lead.wav' });
      // 디코드(30 ms)가 도는 사이 자동 저장 — exportProject 가 _normalizeTrackLayout 으로 sources 를 복사본으로 바꾼다.
      await new Promise((res) => setTimeout(res, 5));
      D2.exportProject('h');
      await p;
      const live = a.sources.find(s => s.id === 's_orig');
      check('🔴 살아 있는 소스의 needsAudio 가 풀린다 (브리지 trackAudioReady 가 통과한다)', !!live && live.needsAudio === false,
            live ? 'needsAudio=' + live.needsAudio : 'source missing');
      check('원본 버퍼가 id 로 등록돼 있다', !!(a._rawBuffers && a._rawBuffers.s_orig));
    }
    console.log(`\n${pass} PASS · ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  })();
}
