/* ============================================================
   FocusDAW — Web Audio engine
   Real audio graph, demo-stem synthesis, transport, per-track
   FX (filter / reverb / echo), master EQ + fade, metering,
   and sample-accurate volume automation.
   ============================================================ */
(function () {
  "use strict";

  const DEMO_STEP = 0.5;
  const DEMO_SECTION = 2;
  const DEMO_SECTIONS = 4;
  const DURATION = DEMO_SECTIONS * DEMO_SECTION; // 8s loop
  const PROJECT_SCHEMA_VERSION = 2;

  function makeCtx() {
    const C = window.AudioContext || window.webkitAudioContext;
    return new C();
  }

  // ---------- synthesis helpers --------------------------------
  function noise(len) {
    const a = new Float32Array(len);
    for (let i = 0; i < len; i++) a[i] = Math.random() * 2 - 1;
    return a;
  }
  function adsr(i, len, a, d, s, r, sus) {
    // returns env value at sample i over a note of `len` samples
    const t = i / len;
    const at = a, dt = a + d, rt = 1 - r;
    if (t < at) return t / at;
    if (t < dt) return 1 - (1 - s) * ((t - at) / d);
    if (t < rt) return s;
    return s * (1 - (t - rt) / r);
  }

  // build one mono Float32 buffer of DURATION using a render fn
  function renderMono(ctx, fn) {
    const sr = ctx.sampleRate;
    const len = Math.floor(DURATION * sr);
    const buf = ctx.createBuffer(1, len, sr);
    const ch = buf.getChannelData(0);
    fn(ch, sr, len);
    // soft clip / normalize a touch
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(ch[i]));
    if (peak > 0.0001) {
      const g = 0.82 / peak;
      for (let i = 0; i < len; i++) ch[i] = Math.tanh(ch[i] * g * 1.05);
    }
    return buf;
  }

  function addNote(ch, sr, startSec, durSec, freq, type, amp) {
    const start = Math.floor(startSec * sr);
    const len = Math.floor(durSec * sr);
    for (let i = 0; i < len; i++) {
      const idx = start + i;
      if (idx >= ch.length) break;
      const t = i / sr;
      let s;
      const ph = 2 * Math.PI * freq * t;
      if (type === "saw") {
        s = 0;
        for (let h = 1; h <= 8; h++) s += Math.sin(ph * h) / h;
        s *= 0.5;
      } else if (type === "square") {
        s = Math.sign(Math.sin(ph)) * 0.6;
      } else if (type === "tri") {
        s = (2 / Math.PI) * Math.asin(Math.sin(ph));
      } else {
        s = Math.sin(ph); // sine
      }
      const env = adsr(i, len, 0.02, 0.15, 0.6, 0.25, true);
      ch[idx] += s * env * amp;
    }
  }

  function synthDrums(ch, sr) {
    const step = DEMO_STEP;
    for (let section = 0; section < DEMO_SECTIONS; section++) {
      const b0 = section * DEMO_SECTION;
      // kick on first and third pulses
      [0, 2].forEach((bt) => kick(ch, sr, b0 + bt * step));
      // snare on second and fourth pulses
      [1, 3].forEach((bt) => snare(ch, sr, b0 + bt * step));
      // hats on half-step pulses
      for (let h = 0; h < 8; h++) hat(ch, sr, b0 + h * (step / 2));
    }
  }
  function kick(ch, sr, at) {
    const len = Math.floor(0.32 * sr), s0 = Math.floor(at * sr);
    for (let i = 0; i < len; i++) {
      const idx = s0 + i; if (idx >= ch.length) break;
      const t = i / sr;
      const f = 120 * Math.exp(-t * 30) + 42;
      const env = Math.exp(-t * 9);
      ch[idx] += Math.sin(2 * Math.PI * f * t) * env * 0.95;
    }
  }
  function snare(ch, sr, at) {
    const len = Math.floor(0.2 * sr), s0 = Math.floor(at * sr);
    const n = noise(len);
    for (let i = 0; i < len; i++) {
      const idx = s0 + i; if (idx >= ch.length) break;
      const t = i / sr;
      const env = Math.exp(-t * 22);
      const tone = Math.sin(2 * Math.PI * 180 * t) * 0.3;
      ch[idx] += (n[i] * 0.7 + tone) * env * 0.6;
    }
  }
  function hat(ch, sr, at) {
    const len = Math.floor(0.05 * sr), s0 = Math.floor(at * sr);
    const n = noise(len);
    for (let i = 0; i < len; i++) {
      const idx = s0 + i; if (idx >= ch.length) break;
      const t = i / sr;
      const env = Math.exp(-t * 90);
      ch[idx] += n[i] * env * 0.22;
    }
  }

  // chord progression Am - F - C - G
  const PROG = [
    { bass: 110.0, chord: [220.0, 261.63, 329.63] }, // Am
    { bass: 87.31, chord: [174.61, 220.0, 261.63] }, // F
    { bass: 130.81, chord: [261.63, 329.63, 392.0] }, // C
    { bass: 98.0, chord: [196.0, 246.94, 293.66] }, // G
  ];

  function synthBass(ch, sr) {
    const step = DEMO_STEP;
    PROG.forEach((p, section) => {
      const b0 = section * DEMO_SECTION;
      // root note pulses on every step
      for (let bt = 0; bt < 4; bt++) {
        addNote(ch, sr, b0 + bt * step, step * 0.9, p.bass, "saw", 0.5);
      }
    });
  }
  function synthKeys(ch, sr) {
    PROG.forEach((p, section) => {
      const b0 = section * DEMO_SECTION;
      p.chord.forEach((f) =>
        addNote(ch, sr, b0, DEMO_SECTION * 0.98, f, "tri", 0.22)
      );
    });
  }
  function synthLead(ch, sr) {
    const step = DEMO_STEP;
    // simple melodic line per section
    const mel = [
      [659.25, 587.33, 523.25, 587.33],
      [523.25, 440.0, 349.23, 440.0],
      [523.25, 587.33, 659.25, 783.99],
      [587.33, 493.88, 392.0, 493.88],
    ];
    mel.forEach((section, si) => {
      const b0 = si * DEMO_SECTION;
      section.forEach((f, ni) =>
        addNote(ch, sr, b0 + ni * step, step * 0.85, f, "square", 0.16)
      );
    });
  }

  // impulse response for reverb
  function makeIR(ctx, seconds, decay) {
    const sr = ctx.sampleRate, len = Math.floor(seconds * sr);
    const ir = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++)
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return ir;
  }

  // Procedural impulse response for the Ambience (Sound Environment / room type)
  // bus. Builds pre-delay + a diffuse decaying tail with HF damping (distance /
  // material absorption) + a few early reflections, with controllable stereo
  // width. Shared by realtime playback and offline (Export) render so both
  // reflect the chosen room identically. `spec` = a ROOM_PRESETS entry.
  // Slap-echo tap times (seconds, relative to pre-delay end) for a given size —
  // shared by the engine IR and the UI graph so both agree. base ~90ms × size.
  function roomEchoTaps(spec) {
    const echo = spec.echo || 0;
    if (echo <= 0) return [];
    const base = 0.09 * (0.5 + (spec.size == null ? 0.5 : spec.size)); // ~45..135ms
    const taps = [];
    for (let n = 1; n <= 3; n++) taps.push({ t: base * n, g: echo * Math.pow(0.55, n - 1) });
    return taps;
  }

  function makeRoomIR(ctx, spec) {
    const sr = ctx.sampleRate;
    const sizeScale = 0.5 + (spec.size == null ? 0.5 : spec.size); // 0.5..1.5 spatial scale
    const pre = Math.max(0, Math.floor(((spec.preDelay || 0) / 1000) * sr));
    const tail = Math.max(1, Math.floor((spec.decay || 0.001) * sr));
    const taps = roomEchoTaps(spec);
    const echoSpan = taps.length ? Math.ceil((taps[taps.length - 1].t + 0.02) * sr) : 0;
    const len = pre + Math.max(tail, echoSpan);
    const ir = ctx.createBuffer(2, len, sr);
    const damp = Math.min(spec.damp || 20000, sr / 2);
    const lpCoef = Math.exp(-2 * Math.PI * damp / sr);          // 1-pole LP retention
    const width = spec.width == null ? 1 : spec.width;
    const stereo = Math.max(0, Math.min(1, width / 1.5));        // 0 = mono .. 1 = decorrelated
    const L = ir.getChannelData(0), R = ir.getChannelData(1);
    let lpM = 0, lpL = 0, lpR = 0;
    for (let i = 0; i < tail; i++) {
      const env = Math.pow(1 - i / tail, spec.shape || 2);
      const nM = (Math.random() * 2 - 1) * env;
      const nL = (Math.random() * 2 - 1) * env;
      const nR = (Math.random() * 2 - 1) * env;
      lpM = lpCoef * lpM + (1 - lpCoef) * nM;
      lpL = lpCoef * lpL + (1 - lpCoef) * nL;
      lpR = lpCoef * lpR + (1 - lpCoef) * nR;
      L[pre + i] = (1 - stereo) * lpM + stereo * lpL;
      R[pre + i] = (1 - stereo) * lpM + stereo * lpR;
    }
    // early reflections (discrete taps) — give the space its initial signature.
    // Tap times scale with room size; erGain scales their prominence (lower for
    // distant/diffuse spaces so the tail reads as "distance").
    const er = spec.erGain == null ? 1 : spec.erGain;
    const earlies = [[0.007, 0.8], [0.013, -0.6], [0.019, 0.5], [0.029, -0.4], [0.041, 0.3]];
    for (const [t, g] of earlies) {
      const idx = pre + Math.floor(t * sizeScale * sr);
      if (idx < len) { L[idx] += g * er; R[idx] += g * er * (0.85 + 0.3 * stereo); }
    }
    // discrete slap echo(es) — distinct repeats independent of the diffuse tail
    for (const tap of taps) {
      const idx = pre + Math.floor(tap.t * sr);
      if (idx < len) { L[idx] += tap.g; R[idx] += tap.g * (0.9 + 0.2 * stereo); }
    }
    return ir;
  }

  // ---------- peaks for waveform drawing -----------------------
  function computePeaks(buffer, buckets) {
    const ch = buffer.getChannelData(0);
    const block = Math.floor(ch.length / buckets);
    const peaks = new Float32Array(buckets * 2);
    for (let b = 0; b < buckets; b++) {
      let min = 1, max = -1;
      const s = b * block, e = Math.min(s + block, ch.length);
      for (let i = s; i < e; i++) {
        const v = ch[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      peaks[b * 2] = min;
      peaks[b * 2 + 1] = max;
    }
    return peaks;
  }

  // Largest absolute sample peak from a computePeaks() array (interleaved min,max).
  // Used to flag track saturation (peak * volume > 1.0) for the waveform red overlay
  // and the Advanced Pan gain slider glow.
  function maxAbsPeak(peaksArr) {
    if (!peaksArr || !peaksArr.length) return 0;
    let m = 0;
    for (let i = 0; i < peaksArr.length; i++) {
      const a = Math.abs(peaksArr[i]);
      if (a > m) m = a;
    }
    return m;
  }

  // Pre-compute 3 resolution levels: coarse(512), medium(2048), fine(duration-based).
  // choosePeaks() in ui-tracks.jsx selects the level that best matches the current zoom.
  function computePeakLevels(buffer) {
    const fineN = Math.max(1600, Math.floor(buffer.duration * 200));
    return {
      coarse: computePeaks(buffer, 512),
      medium: computePeaks(buffer, 2048),
      fine:   computePeaks(buffer, fineN),
    };
  }

  // ============================================================
  //  ENGINE
  // ============================================================
  const TRACK_DEFS = [
    { name: "Drums", type: "drums", color: "#e8b04b", synth: synthDrums },
    { name: "Bass", type: "bass", color: "#d98a55", synth: synthBass },
    { name: "Keys", type: "keys", color: "#9bbf7a", synth: synthKeys },
    { name: "Lead", type: "lead", color: "#c98fb0", synth: synthLead },
  ];

  let ctx = null;
  let convolver = null;
  let masterBus, eqNodes = [], masterFade, masterVol, masterMix, masterAnalyser, mRevSend, mEchoSend, mDelay, mFb, mConv;
  let masterOutputGain; // last stage before ctx.destination — muted while the native engine is the active output
  let ambSend, ambConv; // dedicated Ambience (room type) bus
  let mSatDry, mSatWet, mSatShaper, mSatOut;
  let mWidSplit, mWidMerge, mWidLL, mWidRL, mWidLR, mWidRR, mWidOut;
  let mExcHPF, mExcShaper, mExcWet, mExcOut;
  let masterMeterSplit, masterAnalyserL, masterAnalyserR;
  const EQ_FREQS = [60, 150, 320, 640, 1200, 2400, 4800, 9000, 15000]; // 3 low / 3 mid / 3 high
  // recommended 9-band EQ presets (dB per band, range -12..+12), aligned to EQ_FREQS
  const EQ_PRESETS = {
    Flat:    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    Pop:     [3, 1.5, 0, -1, -1.5, -1, 0.5, 2.5, 3.5],
    Classic: [3, 2, 1, 0, 0, -1, -0.5, 2, 3],
    HipHop:  [6, 4, 2, 0.5, -0.5, 0, 0.5, 1.5, 2.5],
  };
  // Ambience (Sound Environment / room type) presets — drive the dedicated
  // ambience convolver bus. decay(s) · shape(decay curve) · preDelay(ms) ·
  // wet(send gain 0..1) · damp(HF absorption LP Hz) · width(stereo spread) ·
  // echo(discrete slap level 0..1) · size(room size 0..1; scales ER/echo spacing).
  // `none` = dry (default; existing projects unaffected).
  const ROOM_PRESETS = {
    none:    { decay: 0.001, shape: 1,   preDelay: 0,  wet: 0,    damp: 20000, width: 1.0, echo: 0,    size: 0.30 },
    studio:  { decay: 0.35,  shape: 1.6, preDelay: 5,  wet: 0.12, damp: 9000,  width: 0.8, echo: 0.05, size: 0.18 },
    home:    { decay: 0.7,   shape: 2.2, preDelay: 8,  wet: 0.20, damp: 5500,  width: 0.9, echo: 0.07, size: 0.32 },
    concert: { decay: 3.0,   shape: 2.8, preDelay: 40, wet: 0.38, damp: 7000,  width: 1.4, echo: 0.10, size: 0.85 },
    // Far field — distant source: almost no reverb tail, just a light slap echo.
    far:     { decay: 0.35,  shape: 3.0, preDelay: 60, wet: 0.32, damp: 3500,  width: 1.2, echo: 0.14, size: 0.70, erGain: 0.30 },
    tunnel:  { decay: 2.6,   shape: 1.4, preDelay: 30, wet: 0.45, damp: 4000,  width: 0.7, echo: 0.24, size: 0.60 },
  };
  const Engine = {
    ctx: null,
    duration: DURATION,
    EQ_FREQS,
    EQ_PRESETS,
    ROOM_PRESETS,
    tracks: [],
    loopEnabled: true,
    loopRange: null,
    repeatPlayEnabled: false,
    tempo: { projectBpm: null, playbackBpm: null, variBpm: false, key: null, keyShift: 0, variKey: false, detectedKey: null },
    master: { volume: 0.9, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0], eqPreset: null, reverb: 0, echo: 0, reverbStored: 0.4, echoStored: 0.35, widener: 0.0, saturation: 0.0, exciter: 0.0, fadeIn: 0.0, fadeOut: 0.0, room: 'none', roomParams: { ...ROOM_PRESETS.none } },
    isPlaying: false,
    _startTime: 0,
    _offset: 0,
    _sources: [],
    _tickCbs: [],
    _autoSchedTimer: null,
    _decodedCache: new Map(),
    _decodedCacheOrder: [],
    _decodedCacheLimit: 8,
    _renderCacheKey: null,
    _renderCacheBuffer: null,
    _stretchPreviewPreparing: false,
    _stretchPreviewDoneSeq: 0,
    _tempoRestartTimer: null,
    _playToken: 0,
    _outputMuted: false, // true while the native engine is the active output (web stays silent)
    _clipCounter: 0,
    // Clip ids must be unique: a duplicate makes two clips select together (the UI matches
    // by id) and DELETE together (deleteClip filters by id), which is how a clip lost its
    // waveform and left an empty rectangle behind.
    // The counter alone can't guarantee that — clips restored from a project file or an
    // undo snapshot keep their original 'cN' names while the counter restarts at 0, so the
    // next split/paste/duplicate re-issues an id that is still live. Skipping ids already
    // in use is self-healing: it can't be defeated by a load path that forgets to seed the
    // counter (_sourceId has no such problem — it is random).
    _clipIdInUse(id) {
      return (this.tracks || []).some(t => (t.clips || []).some(c => c && c.id === id));
    },
    _cid() {
      let id;
      do { id = 'c' + (++this._clipCounter); } while (this._clipIdInUse(id));
      return id;
    },
    _sourceId() { return "src_" + Math.random().toString(36).slice(2, 10); },
    _takeId() { return "take_" + Math.random().toString(36).slice(2, 10); },
    // "Take A", "Take B", … "Take Z", "Take AA" — spreadsheet-column labelling so a long
    // loop session keeps readable names. index is 0-based.
    _takeLabel(index) {
      let n = Math.max(0, index | 0), s = "";
      do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
      return "Take " + s;
    },
    // The active take is the one lane whose clips bake / play / export. A track with no
    // takes (file/bounce, or a legacy Audio In from before Stage 3) has none, and then
    // EVERY clip is live — so non-audioIn tracks and old projects are unaffected.
    _activeTakeId(track) {
      if (track && track.activeTakeId && (track.takes || []).some(t => t.id === track.activeTakeId)) {
        return track.activeTakeId;
      }
      return null;
    },
    // A clip is "live" when it belongs to the active take, OR carries no takeId at all
    // (file/bounce clips, consolidations, anything predating takes) — those are shared
    // across lanes and must always render. Only a clip tagged with a DIFFERENT take is
    // hidden from bake/overlap/playback.
    _isActiveClip(track, clip) {
      const act = this._activeTakeId(track);
      if (!act) return true;
      return !clip.takeId || clip.takeId === act;
    },
    _activeClips(track) {
      return (track.clips || []).filter(c => this._isActiveClip(track, c));
    },
    _trackKindFor({ kind = null, isDemo = false } = {}) {
      if (kind === "audioIn" || kind === "bounce" || kind === "file") return kind;
      return isDemo ? "file" : "file";
    },
    _sourceFromTrack(track, overrides = {}) {
      const buffer = overrides.buffer || track.buffer || null;
      return {
        id: overrides.id || (track.sources && track.sources[0] && track.sources[0].id) || this._sourceId(),
        filePath: overrides.filePath !== undefined ? overrides.filePath : (track.filePath || null),
        fileName: overrides.fileName !== undefined ? overrides.fileName : (track.fileName || track.name || null),
        duration: overrides.duration !== undefined ? overrides.duration : (buffer ? buffer.duration : (track.duration || 0)),
        sampleRate: overrides.sampleRate !== undefined ? overrides.sampleRate : (buffer ? buffer.sampleRate : null),
        channels: overrides.channels !== undefined ? overrides.channels : (buffer ? buffer.numberOfChannels : null),
        needsAudio: overrides.needsAudio !== undefined ? !!overrides.needsAudio : !!track.needsAudio,
      };
    },
    _normalizeClip(clip, sourceId, sourceDuration = 0) {
      const start = Number.isFinite(clip && clip.start) ? clip.start : 0;
      const sourceOffset = Number.isFinite(clip && clip.sourceOffset)
        ? clip.sourceOffset
        : (Number.isFinite(clip && clip.offset) ? clip.offset : 0);
      const duration = Number.isFinite(clip && clip.duration)
        ? clip.duration
        : Math.max(0, (Number.isFinite(clip && clip.end) ? clip.end : (start + (sourceDuration || 0))) - start);
      const end = Number.isFinite(clip && clip.end) ? clip.end : start + duration;
      return {
        id: (clip && clip.id) || this._cid(),
        sourceId,
        start,
        end,
        offset: sourceOffset,
        sourceOffset,
        duration: Math.max(0, duration || (end - start) || 0),
        gain: Number.isFinite(clip && clip.gain) ? clip.gain : 1.0,
        muted: !!(clip && clip.muted),
        takeId: (clip && clip.takeId) || null,
        params: clip && clip.params ? { ...clip.params } : null,
        automation: clip && clip.automation ? clip.automation.map(p => ({ ...p })) : null,
      };
    },
    _normalizeTrackLayout(track) {
      if (!track) return track;
      track.kind = this._trackKindFor(track);
      track.lockedToZero = track.lockedToZero !== undefined ? !!track.lockedToZero : track.kind === "file";
      const primary = (track.sources && track.sources[0])
        ? { ...track.sources[0] }
        : this._sourceFromTrack(track);
      primary.filePath = primary.filePath || track.filePath || null;
      primary.fileName = primary.fileName || track.fileName || track.name || null;
      primary.duration = primary.duration || (track.buffer ? track.buffer.duration : 0);
      primary.sampleRate = primary.sampleRate || (track.buffer ? track.buffer.sampleRate : null);
      primary.channels = primary.channels || (track.buffer ? track.buffer.numberOfChannels : null);
      primary.needsAudio = !!track.needsAudio;
      track.sources = [primary, ...(track.sources || []).slice(1).map(s => ({ ...s }))];
      if (!track.clips || !track.clips.length) {
        track.clips = [this._normalizeClip({ start: 0, end: primary.duration || 0, offset: 0 }, primary.id, primary.duration || 0)];
      } else {
        track.clips = track.clips.map(c => this._normalizeClip(c, c.sourceId || primary.id, primary.duration || 0));
      }
      track.takes = Array.isArray(track.takes) ? track.takes.map(t => ({ ...t })) : [];
      if (track.activeTakeId === undefined) track.activeTakeId = null;
      // --- Take hygiene: deterministic, gap-free numbering ---
      // Undo/redo across track delete + re-add (the undo stack still holds the old track's
      // takes), or deleting a take's clip, could leave `takes` out of sync with the clips
      // actually present — orphan take entries no clip references, or a non-contiguous index
      // that makes a fresh 1st recording label itself "Take C". This runs on every serialize/
      // snapshot/import/undo-apply, so keep the take list == the takes the clips actually use,
      // in recording (append) order, and renumber labels A, B, C… with no gaps. The next
      // recording is then always the next letter and no phantom take can reappear.
      if (track.takes.length || (track.clips || []).some(c => c.takeId)) {
        const referenced = new Set((track.clips || []).map(c => c.takeId).filter(Boolean));
        const rebuilt = track.takes.filter(t => referenced.has(t.id));  // keep append order
        const liveIds = new Set(rebuilt.map(t => t.id));
        // A clip pointing at a take that no longer exists (dangling id — never a real entry,
        // or dropped above) would be hidden forever by _isActiveClip. Detach it (takeId=null)
        // so it stays visible as a shared clip instead of vanishing.
        for (const c of (track.clips || [])) { if (c.takeId && !liveIds.has(c.takeId)) c.takeId = null; }
        rebuilt.forEach((t, i) => { t.index = i; t.name = this._takeLabel(i); });
        track.takes = rebuilt;
      }
      // Drop a dangling activeTakeId (points at a take that no longer exists) so
      // _activeTakeId() falls back sensibly instead of hiding every clip.
      if (track.activeTakeId && !track.takes.some(t => t.id === track.activeTakeId)) {
        track.activeTakeId = track.takes.length ? track.takes[track.takes.length - 1].id : null;
      }
      return track;
    },
    _serializedSources(track) {
      this._normalizeTrackLayout(track);
      return (track.sources || []).map(s => ({
        id: s.id,
        filePath: s.filePath || null,
        fileName: s.fileName || null,
        duration: s.duration || 0,
        sampleRate: s.sampleRate || null,
        channels: s.channels || null,
        needsAudio: !!s.needsAudio,
        sourceTrackIds: Array.isArray(s.sourceTrackIds) ? [...s.sourceTrackIds] : [],
      }));
    },
    _serializedClips(track) {
      this._normalizeTrackLayout(track);
      return (track.clips || []).map(c => ({
        id: c.id,
        sourceId: c.sourceId || (track.sources && track.sources[0] && track.sources[0].id) || null,
        start: c.start,
        end: c.end,
        offset: c.offset,
        sourceOffset: c.sourceOffset,
        duration: c.duration,
        gain: c.gain,
        muted: !!c.muted,
        takeId: c.takeId || null,
        params: c.params ? { ...c.params } : null,
        automation: c.automation ? c.automation.map(p => ({ ...p })) : null,
      }));
    },
    _projectClipDuration() {
      const maxClipEnd = this.tracks.reduce((m, t) => {
        const clips = Array.isArray(t.clips) ? t.clips : [];
        const clipEnd = clips.reduce((cm, c) => Math.max(cm, (c.start || 0) + (c.duration || ((c.end || 0) - (c.start || 0)) || 0)), 0);
        const bufferEnd = (t.buffer && !t.needsAudio) ? t.buffer.duration : 0;
        return Math.max(m, clipEnd, bufferEnd);
      }, 0);
      return Math.max(DURATION, maxClipEnd);
    },
    _displayName(fileName) {
      return (fileName || "").replace(/\.(mp3|wav|aiff?|m4a|ogg|flac)$/i, "");
    },

    init() {
      if (ctx) return;
      ctx = makeCtx();
      this.ctx = ctx;
      // Re-apply a device selection made before the context existed (startup restore).
      if (this._outputDeviceLabel) this.setOutputDevice(this._outputDeviceLabel);
      convolver = ctx.createConvolver();
      convolver.buffer = makeIR(ctx, 2.4, 2.6);

      // master chain
      masterBus = ctx.createGain();
      // 9-band graphic EQ (3 low / 3 mid / 3 high)
      eqNodes = EQ_FREQS.map((f, i) => {
        const b = ctx.createBiquadFilter();
        b.type = "peaking"; b.frequency.value = f; b.Q.value = 1.1; b.gain.value = this.master.bands[i] || 0;
        return b;
      });
      masterFade = ctx.createGain();
      masterVol = ctx.createGain(); masterVol.gain.value = this.master.volume;
      // master FX (reverb + echo) inserted post-volume
      mConv = ctx.createConvolver(); mConv.buffer = makeIR(ctx, 2.8, 3.0);
      mRevSend = ctx.createGain(); mRevSend.gain.value = this.master.reverb;
      mDelay = ctx.createDelay(1.2); mDelay.delayTime.value = 0.3;
      mFb = ctx.createGain(); mFb.gain.value = 0.36;
      mEchoSend = ctx.createGain(); mEchoSend.gain.value = this.master.echo;
      masterMix = ctx.createGain();
      
      // ==========================================
      // Tape Saturation Nodes
      // ==========================================
      mSatDry = ctx.createGain(); mSatDry.gain.value = 1.0;
      mSatWet = ctx.createGain(); mSatWet.gain.value = 0.0;
      mSatShaper = ctx.createWaveShaper();
      mSatOut = ctx.createGain();
      
      const satCurve = new Float32Array(44100);
      const satK = 4.0;
      const satComp = 1.0 / Math.tanh(satK);
      for (let i = 0; i < 44100; ++i) {
          const x = (i * 2) / 44099 - 1;
          satCurve[i] = Math.tanh(satK * x) * satComp;
      }
      mSatShaper.curve = satCurve;
      mSatShaper.connect(mSatWet);
      
      // ==========================================
      // Stereo Widener Nodes
      // ==========================================
      mWidSplit = ctx.createChannelSplitter(2);
      mWidMerge = ctx.createChannelMerger(2);
      mWidLL = ctx.createGain();
      mWidRL = ctx.createGain();
      mWidLR = ctx.createGain();
      mWidRR = ctx.createGain();
      mWidOut = ctx.createGain();
      
      mWidSplit.connect(mWidLL, 0);
      mWidSplit.connect(mWidLR, 0);
      mWidSplit.connect(mWidRL, 1);
      mWidSplit.connect(mWidRR, 1);
      
      mWidLL.connect(mWidMerge, 0, 0);
      mWidRL.connect(mWidMerge, 0, 0);
      mWidLR.connect(mWidMerge, 0, 1);
      mWidRR.connect(mWidMerge, 0, 1);
      mWidMerge.connect(mWidOut);
      
      const wInit = 1.0;
      mWidLL.gain.value = 0.5 * (1.0 + wInit);
      mWidRR.gain.value = 0.5 * (1.0 + wInit);
      mWidRL.gain.value = 0.5 * (1.0 - wInit);
      mWidLR.gain.value = 0.5 * (1.0 - wInit);
      
      // ==========================================
      // Exciter / Enhancer Nodes
      // ==========================================
      mExcHPF = ctx.createBiquadFilter();
      mExcHPF.type = "highpass";
      mExcHPF.frequency.value = 3000;
      mExcHPF.Q.value = 0.707;
      
      mExcShaper = ctx.createWaveShaper();
      const excCurve = new Float32Array(44100);
      for (let i = 0; i < 44100; ++i) {
          const x = (i * 2) / 44099 - 1;
          excCurve[i] = x + 0.35 * x * x;
      }
      mExcShaper.curve = excCurve;
      
      mExcWet = ctx.createGain(); mExcWet.gain.value = 0.0;
      mExcOut = ctx.createGain();
      
      mExcHPF.connect(mExcShaper);
      mExcShaper.connect(mExcWet);

      const masterComp = ctx.createDynamicsCompressor();
      masterComp.threshold.value = -2; masterComp.knee.value = 4; masterComp.ratio.value = 12;
      masterComp.attack.value = 0.003; masterComp.release.value = 0.18;
      masterAnalyser = ctx.createAnalyser(); masterAnalyser.fftSize = 1024;

      // chain EQ bands in series
      let node = masterBus;
      eqNodes.forEach((b) => { node.connect(b); node = b; });
      node.connect(masterFade); masterFade.connect(masterVol);
      masterVol.connect(masterMix);                                                            // dry
      masterVol.connect(mRevSend); mRevSend.connect(mConv); mConv.connect(masterMix);          // master reverb
      masterVol.connect(mEchoSend); mEchoSend.connect(mDelay); mDelay.connect(mFb); mFb.connect(mDelay); mDelay.connect(masterMix); // master echo
      // dedicated Ambience (Sound Environment / room type) bus — independent of master reverb
      const _room0 = this.master.roomParams || ROOM_PRESETS[this.master.room] || ROOM_PRESETS.none;
      ambConv = ctx.createConvolver(); ambConv.buffer = makeRoomIR(ctx, _room0);
      ambSend = ctx.createGain(); ambSend.gain.value = _room0.wet;
      masterVol.connect(ambSend); ambSend.connect(ambConv); ambConv.connect(masterMix);        // ambience

      // Route through Saturation -> Widener -> Exciter -> Compressor
      masterMix.connect(mSatDry);
      masterMix.connect(mSatShaper);
      mSatDry.connect(mSatOut);
      mSatWet.connect(mSatOut);
      
      mSatOut.connect(mWidSplit);
      
      mWidOut.connect(mExcOut);
      mWidOut.connect(mExcHPF);
      mExcWet.connect(mExcOut);
      
      mExcOut.connect(masterComp);
      masterComp.connect(masterAnalyser);
      // Dedicated output-mute gain (last stage before the speakers). When the native
      // JUCE engine is connected it becomes the sole audio output, so the web engine
      // must stay silent to avoid double playback (two engines, same tracks, drifting
      // clocks → phasing/comb-filtering). Muting here cuts only the speaker feed; the
      // analyser above still receives signal so meters keep working. Kept separate from
      // masterVol because importProject/snapshot restores rewrite masterVol.gain from
      // master.volume and would otherwise un-mute the web output unexpectedly.
      masterOutputGain = ctx.createGain();
      masterOutputGain.gain.value = this._outputMuted ? 0 : 1;
      masterAnalyser.connect(masterOutputGain);
      masterOutputGain.connect(ctx.destination);

      // Stereo L/R metering tap (post-pan/comp) — true per-channel levels for the master meter
      masterMeterSplit = ctx.createChannelSplitter(2);
      masterAnalyserL = ctx.createAnalyser(); masterAnalyserL.fftSize = 1024;
      masterAnalyserR = ctx.createAnalyser(); masterAnalyserR.fftSize = 1024;
      masterComp.connect(masterMeterSplit);
      masterMeterSplit.connect(masterAnalyserL, 0);
      masterMeterSplit.connect(masterAnalyserR, 1);

      // per-track reverb return (pre-EQ bus)
      const revReturn = ctx.createGain(); revReturn.gain.value = 0.9;
      convolver.connect(revReturn); revReturn.connect(masterBus);
      this._revReturn = revReturn;

      // build demo tracks
      TRACK_DEFS.forEach((def, i) => {
        const buffer = renderMono(ctx, (ch, sr) => def.synth(ch, sr));
        this._addTrack({
          name: def.name, type: def.type, color: def.color, buffer, isDemo: true,
        });
      });
    },

    _addTrack({ name, type, color, buffer, peaks = null, isDemo = false, fileName = null, filePath = null, needsAudio = false, kind = null, lockedToZero = undefined, sources = null, clips = null, takes = null, activeTakeId = null }) {
      const id = "t" + (this.tracks.length + 1) + "_" + Math.random().toString(36).slice(2, 6);
      // persistent nodes
      const fader = ctx.createGain();
      const autoGain = ctx.createGain();
      const panner = ctx.createStereoPanner();
      const meter = ctx.createAnalyser(); meter.fftSize = 512;
      const reverbSend = ctx.createGain(); reverbSend.gain.value = 0;
      const echoSend = ctx.createGain(); echoSend.gain.value = 0;
      // Per-track echo — kept numerically identical to the native JUCE engine
      // (FeedbackDelay: 0.3s delay, 0.34 feedback, wet mix = send × 0.45). See AudioEngine.h.
      const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.3;
      const fb = ctx.createGain(); fb.gain.value = 0.34;
      const echoReturn = ctx.createGain(); echoReturn.gain.value = 0.45;

      // graph: (source) -> fader -> autoGain -> panner -> meter & bus
      fader.connect(autoGain); autoGain.connect(panner);
      panner.connect(meter);
      panner.connect(masterBus);             // dry
      panner.connect(reverbSend); reverbSend.connect(convolver); // reverb send
      panner.connect(echoSend); echoSend.connect(delay);
      delay.connect(fb); fb.connect(delay); delay.connect(echoReturn); echoReturn.connect(masterBus); // echo (wet ×0.45)

      const { coarse, medium, fine } = peaks || (buffer ? computePeakLevels(buffer) : {
        coarse: new Float32Array(0), medium: new Float32Array(0), fine: new Float32Array(0),
      });
      const trackKind = this._trackKindFor({ kind, isDemo });
      const sourceId = (sources && sources[0] && sources[0].id) || this._sourceId();
      const sourceDuration = buffer ? buffer.duration : 0;
      const track = {
        id, name, type, color, buffer,
        kind: trackKind,
        lockedToZero: lockedToZero !== undefined ? !!lockedToZero : trackKind === "file",
        peaks: fine, peaksMedium: medium, peaksCoarse: coarse, peakAmp: maxAbsPeak(coarse),
        nodes: { fader, autoGain, panner, meter, reverbSend, echoSend, delay, fb },
        params: {
          volume: 1.0, pan: 0, mute: false, solo: false,
          reverb: 0, echo: 0,
          bpmSource: false,
          inputGain: 1.0, arm: false, monitor: false, limiter: true,
          inputChannel: 0, inputStereo: false,
          autoOn: false,
          autoCurve: false,
          automation: defaultAutomation(type),
        },
        sources: sources ? sources.map(s => ({ ...s })) : [{
          id: sourceId,
          filePath,
          fileName: fileName || name,
          duration: sourceDuration,
          sampleRate: buffer ? buffer.sampleRate : null,
          channels: buffer ? buffer.numberOfChannels : null,
          needsAudio: !!needsAudio,
        }],
        clips: clips ? clips.map(c => ({ ...c })) : [this._normalizeClip({ start: 0, end: sourceDuration, offset: 0 }, sourceId, sourceDuration)],
        takes: Array.isArray(takes) ? takes.map(t => ({ ...t })) : [],
        activeTakeId: activeTakeId || null,
        isDemo, fileName, filePath, needsAudio, audioRev: 0,
        _meterBuf: new Float32Array(meter.fftSize),
      };
      this._normalizeTrackLayout(track);
      // Keep file/demo tracks grouped ahead of Audio In tracks: a new file track
      // is inserted before the first Audio In track (not appended after it), so the
      // array stays [file tracks…, audio-in tracks…]. Audio In tracks append at the
      // end. Track references are by id, so reordering the array is display-only.
      if (track.kind === "audioIn") {
        this.tracks.push(track);
      } else {
        const firstInputIdx = this.tracks.findIndex((t) => t.kind === "audioIn");
        if (firstInputIdx === -1) this.tracks.push(track);
        else this.tracks.splice(firstInputIdx, 0, track);
      }
      this._applyMix();
      return track;
    },

    addAudioInTrack(name = "Audio In") {
      this.init();
      const palette = ["#e8b04b", "#d98a55", "#9bbf7a", "#c98fb0", "#7fb0c4", "#cf6f5c"];
      return this._addTrack({
        name, type: "audio", color: palette[this.tracks.length % palette.length],
        buffer: null, kind: "audioIn", lockedToZero: false, needsAudio: false,
        sources: [], clips: [],
      });
    },

    async attachRecording(trackId, name, arrayBuffer, options = {}) {
      const track = this.tracks.find((t) => t.id === trackId && t.kind === "audioIn");
      if (!track) throw new Error("Audio In track was not found.");
      const decoded = await this._decodeAudio(arrayBuffer, null);
      const sourceId = this._sourceId();
      // Stage 3 — each recording APPENDS a Take instead of replacing the track's audio.
      // The pre-Stage-3 code reset track._rawBuffers/_layoutBaked/sources here (a take was
      // the whole track, so the previous one had to be torn down). Now every take is kept:
      // _registerSource adds this source + its raw buffer additively (see _captureRawBuffers),
      // the take is tagged onto its clip, and _ensureBaked bakes only the ACTIVE take's
      // clips. So we must NOT clear those maps — doing so would drop earlier takes' raws.
      this._captureRawBuffers(track);   // preserve the current primary raw before we grow
      this._registerSource(track, {
        id: sourceId, filePath: options.filePath || null, fileName: name,
        duration: decoded.buffer.duration, sampleRate: decoded.buffer.sampleRate,
        channels: decoded.buffer.numberOfChannels, needsAudio: false,
      }, decoded.buffer);
      // Track-level fileName/filePath identify the PRIMARY (first) take/source — the one
      // importProject reloads as sources[0]. Only stamp them on the first recording so a
      // reopened project's track identity stays pinned to Take A, not the latest take.
      if (!track.fileName) track.fileName = name;
      if (!track.filePath) track.filePath = options.filePath || null;
      // Re-recording onto a reopened (placeholder) Audio In track must clear the
      // track-level needsAudio too. Leaving it true keeps the NO AUDIO badge and
      // makes setTrackParam drop Solo/Mute/bpmSource (audio-engine setTrackParam /
      // audio-bridge gate), even though the buffer now plays fine.
      track.needsAudio = false;
      // Register the take and make it active — the newest take is what plays/bakes/exports
      // (matches a DAW punching in a fresh take). Inactive takes are preserved as data only.
      const takeId = this._takeId();
      const takeIndex = (track.takes || []).length;
      track.takes = [...(track.takes || []), {
        id: takeId, name: this._takeLabel(takeIndex), index: takeIndex,
        sourceId, partial: !!options.partial,
      }];
      track.activeTakeId = takeId;
      const start = Math.max(0, options.start || 0);
      const limitEnd = Number(options.end) > start ? Number(options.end) : 0;
      const clipEnd = limitEnd ? Math.min(start + decoded.buffer.duration, limitEnd) : start + decoded.buffer.duration;
      const clipDuration = Math.max(0, clipEnd - start);
      track.clips = [...track.clips, this._normalizeClip({ start, end: clipEnd, offset: 0, duration: clipDuration, takeId }, sourceId, decoded.buffer.duration)];
      // A take punched in past 0 (record-while-playing, pre-roll, mid-song count-in) is a
      // NON-trivial layout — its audio belongs at clip.start, not at 0 — so it MUST be
      // baked, per the 전략 B invariant. Without this bake, track.buffer stays a raw decode
      // (audio at sample 0) while the bridge's trackIsBakedLayout() still reports "baked"
      // (it keys off !_isTrivialLayout, and start>0 is already non-trivial). syncTrackToNative
      // then pushes the RAW pcm with startSeconds=0, so the take sounds at 0:00 while its
      // waveform sits at clip.start — a visible clip with no sound where it is. Baking makes
      // track.buffer the timeline-indexed layout (leading silence + take) so native gets it
      // right. A take at 0 stays trivial here and keeps the cheap filePath fast-path.
      this._ensureBaked(track);
      this.duration = limitEnd ? Math.max(limitEnd, this._projectClipDuration()) : Math.max(this.duration, start + decoded.buffer.duration);
      this._applyMix();
      this._startHotAddedTrack(track);
      return track;
    },

    // Phase 6 Stage 3b — loop-Take recording. One continuous WAV was captured across N
    // Repeat iterations (native records the input straight through; LoopAudioSource makes
    // every iteration exactly floor((end-start)*rate) samples, so the passes are equal
    // length). Instead of writing one file per pass on the audio thread, we register the
    // WHOLE recording as ONE source and cut it into Takes by sourceOffset: Take k reads
    // [k*passDur, (k+1)*passDur) of that source and is placed at loopStart. All Takes share
    // one source + one file, so reopen reloads them with the existing single-source path.
    // The active-lane model (Stage 3a) already bakes/plays only the active Take, and the
    // alternates (same start, same source, different offset) are legal because overlap is
    // judged per-lane.
    async attachLoopRecording(trackId, name, arrayBuffer, options = {}) {
      const track = this.tracks.find((t) => t.id === trackId && t.kind === "audioIn");
      if (!track) throw new Error("Audio In track was not found.");
      const decoded = await this._decodeAudio(arrayBuffer, null);
      const buf = decoded.buffer;
      const loopStart = Math.max(0, options.loopStart || 0);
      const loopEnd = Number(options.loopEnd) > loopStart ? Number(options.loopEnd) : loopStart + buf.duration;
      const passDur = Math.max(0.05, loopEnd - loopStart);
      const total = buf.duration;
      // Whole passes + a trailing partial. A tail under ~50ms is dropped as capture slop;
      // a recording shorter than one pass is kept as a single (partial) Take, not lost.
      const EPS = 0.02;
      let nFull = Math.max(0, Math.floor((total + EPS) / passDur));
      const tail = total - nFull * passDur;
      const hasPartial = tail > 0.05;
      if (nFull === 0 && !hasPartial) { nFull = 1; }

      // One source = the whole recording; every Take slices it via sourceOffset.
      this._captureRawBuffers(track);
      const sourceId = this._sourceId();
      this._registerSource(track, {
        id: sourceId, filePath: options.filePath || null, fileName: name,
        duration: buf.duration, sampleRate: buf.sampleRate, channels: buf.numberOfChannels, needsAudio: false,
      }, buf);
      if (!track.fileName) track.fileName = name;
      if (!track.filePath) track.filePath = options.filePath || null;
      track.needsAudio = false;

      const addTake = (offset, dur, partial) => {
        const takeId = this._takeId();
        const idx = (track.takes || []).length;
        track.takes = [...(track.takes || []), {
          id: takeId, name: this._takeLabel(idx), index: idx, sourceId, partial: !!partial,
        }];
        track.clips = [...track.clips, this._normalizeClip(
          { start: loopStart, end: loopStart + dur, offset, sourceOffset: offset, duration: dur, takeId },
          sourceId, buf.duration)];
        return takeId;
      };
      let lastFull = null;
      for (let i = 0; i < nFull; i++) lastFull = addTake(i * passDur, passDur, false);
      const partialId = hasPartial ? addTake(nFull * passDur, tail, true) : null;
      // Land on the last COMPLETE pass (a full-length take), or the partial if that is all
      // there is. The user can switch lanes once Stage 4 ships.
      track.activeTakeId = lastFull || partialId;

      this._ensureBaked(track);
      this.duration = Math.max(this.duration, this._projectClipDuration());
      this._applyMix();
      this._startHotAddedTrack(track);
      return track;
    },

    // ---- Phase 6 Stage 4 — Take Lanes -------------------------------------
    // Make a different Take the live one. Only the active Take bakes/plays/exports
    // (Stage 3a), so this re-bakes and the bridge re-syncs native.
    setActiveTake(trackId, takeId) {
      const t = this.tracks.find(x => x.id === trackId); if (!t) return false;
      if (!(t.takes || []).some(k => k.id === takeId)) return false;
      if (t.activeTakeId === takeId) return false;
      t.activeTakeId = takeId;
      this._ensureBaked(t);
      return true;
    },
    // Delete one Take and its clips. _normalizeTrackLayout then prunes/renumbers the rest
    // (Take hygiene) and drops the source's raw if nothing references it anymore.
    deleteTake(trackId, takeId) {
      const t = this.tracks.find(x => x.id === trackId); if (!t) return false;
      if (!(t.takes || []).some(k => k.id === takeId)) return false;
      const goneSources = new Set((t.clips || []).filter(c => c.takeId === takeId).map(c => c.sourceId));
      t.clips = (t.clips || []).filter(c => c.takeId !== takeId);
      if (t.activeTakeId === takeId) {
        const remain = (t.takes || []).filter(k => k.id !== takeId);
        t.activeTakeId = remain.length ? remain[remain.length - 1].id : null;
      }
      t.takes = (t.takes || []).filter(k => k.id !== takeId);
      // Drop now-unreferenced source metadata + raw so it can't linger or be re-baked.
      for (const sid of goneSources) {
        if (!(t.clips || []).some(c => c.sourceId === sid)) {
          t.sources = (t.sources || []).filter((s, i) => i === 0 || s.id !== sid); // never drop primary
          if (t._rawBuffers) delete t._rawBuffers[sid];
          if (t._sourcePeaks) delete t._sourcePeaks[sid];
        }
      }
      this._normalizeTrackLayout(t);
      this._ensureBaked(t);
      this._applyMix();
      return true;
    },
    // Peaks for a source's RAW buffer, cached per source. Take lanes render inactive Takes
    // (not in the baked buffer) by sampling their source raw at the clip's sourceOffset.
    _sourcePeaksFor(track, sourceId) {
      const raw = this._rawBufferForSource(track, sourceId);
      if (!raw) return null;
      track._sourcePeaks = track._sourcePeaks || {};
      const cached = track._sourcePeaks[sourceId];
      if (cached && cached.buffer === raw) return cached;
      const pk = computePeakLevels(raw);
      const entry = { buffer: raw, peaks: pk.fine, peaksMedium: pk.medium, peaksCoarse: pk.coarse,
        peakAmp: maxAbsPeak(pk.coarse) };
      track._sourcePeaks[sourceId] = entry;
      return entry;
    },
    // UI-facing: one entry per Take with everything the lane needs to draw + label.
    // `render` is a pseudo-track (source raw buffer + peaks, layoutBaked=false) so the
    // existing Waveform can draw it by sampling clip.offset (source-indexed).
    getTakeLanes(trackId) {
      const t = this.tracks.find(x => x.id === trackId);
      if (!t || !(t.takes || []).length) return [];
      return (t.takes || []).map(tk => {
        const clips = (t.clips || []).filter(c => c.takeId === tk.id);
        const sp = clips.length ? this._sourcePeaksFor(t, clips[0].sourceId) : null;
        return {
          id: tk.id, name: tk.name, index: tk.index, partial: !!tk.partial,
          active: t.activeTakeId === tk.id, clips,
          render: sp ? {
            buffer: sp.buffer, peaks: sp.peaks, peaksMedium: sp.peaksMedium,
            peaksCoarse: sp.peaksCoarse, peakAmp: sp.peakAmp, color: t.color,
            _layoutBaked: false, recording: false, audioRev: t.audioRev || 0,
          } : null,
        };
      });
    },

    // Remove a single track from the live graph. Splicing the tracks array (as the
    // UI used to do) left the running BufferSource connected through the track's
    // fader → masterBus, so a deleted track kept sounding during playback. Here we
    // stop that source and disconnect the track's persistent nodes so it goes
    // silent immediately, whether or not transport is playing.
    removeTrack(id) {
      const i = this.tracks.findIndex((t) => t.id === id);
      if (i < 0) return;
      const t = this.tracks[i];
      if (t._liveSource) {
        try { t._liveSource.stop(); } catch (e) {}
        try { t._liveSource.disconnect(); } catch (e) {}
        const si = this._sources.indexOf(t._liveSource);
        if (si >= 0) this._sources.splice(si, 1);
        t._liveSource = null;
      }
      if (t.nodes) {
        Object.values(t.nodes).forEach((n) => { try { n.disconnect(); } catch (e) {} });
      }
      this.tracks.splice(i, 1);
      this._spectrum = null;
      // When the project becomes empty, reset the tempo so Project/Playback BPM
      // return to the uninitialized "---" state (matches a fresh project), and
      // STOP the transport — otherwise isPlaying/offset linger and the next
      // loaded track would resume playing from the stale position.
      if (this.tracks.length === 0) {
        this.tempo = { projectBpm: null, playbackBpm: null, variBpm: false, key: null, keyShift: 0, variKey: false, detectedKey: null };
        this.loopRange = null;
        this.repeatPlayEnabled = false;
        this.stop();
      }
      this._applyMix();
    },

    _decodedCacheKeyForFile(file) {
      if (!file) return null;
      const size = Number.isFinite(file.size) ? file.size : "unknown";
      const modified = Number.isFinite(file.lastModified) ? file.lastModified : 0;
      return `file:${file.name}:${size}:${modified}`;
    },

    _decodedCacheKeyForBuffer(name, arrayBuffer, options = {}) {
      if (options.cacheKey) return options.cacheKey;
      const size = Number.isFinite(options.fileSize) ? options.fileSize : (arrayBuffer ? arrayBuffer.byteLength : "unknown");
      const modified = Number.isFinite(options.fileMtimeMs) ? Math.round(options.fileMtimeMs) : 0;
      if (options.filePath) return `path:${options.filePath}:${size}:${modified}`;
      return `buffer:${name}:${size}`;
    },

    _rememberDecodedAudio(key, buffer) {
      if (!key || !buffer) return null;
      if (this._decodedCache.has(key)) {
        this._decodedCacheOrder = this._decodedCacheOrder.filter((x) => x !== key);
      }
      const entry = { buffer, peaks: computePeakLevels(buffer) };
      this._decodedCache.set(key, entry);
      this._decodedCacheOrder.push(key);
      while (this._decodedCacheOrder.length > this._decodedCacheLimit) {
        const old = this._decodedCacheOrder.shift();
        this._decodedCache.delete(old);
      }
      return entry;
    },

    async _decodeAudio(arrayBuffer, cacheKey) {
      if (cacheKey && this._decodedCache.has(cacheKey)) {
        return this._decodedCache.get(cacheKey);
      }
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      return this._rememberDecodedAudio(cacheKey, buffer) || { buffer, peaks: computePeakLevels(buffer) };
    },

    _assignDecodedToTrack(track, decoded) {
      track.buffer = decoded.buffer;
      track.peaks = decoded.peaks.fine;
      track.peaksMedium = decoded.peaks.medium;
      track.peaksCoarse = decoded.peaks.coarse;
      track.peakAmp = maxAbsPeak(decoded.peaks.coarse);
      track.needsAudio = false;
      this._normalizeTrackLayout(track);
      if (track.sources && track.sources[0]) {
        track.sources[0].duration = decoded.buffer.duration;
        track.sources[0].sampleRate = decoded.buffer.sampleRate;
        track.sources[0].channels = decoded.buffer.numberOfChannels;
        track.sources[0].needsAudio = false;
        track.sources[0].filePath = track.filePath || track.sources[0].filePath || null;
        track.sources[0].fileName = track.fileName || track.sources[0].fileName || track.name || null;
      }
      if (track.clips && track.clips.length === 1 && track.clips[0].start === 0) {
        track.clips[0] = this._normalizeClip({ ...track.clips[0], end: decoded.buffer.duration, duration: decoded.buffer.duration }, track.sources[0].id, decoded.buffer.duration);
      }
      track.audioRev = (track.audioRev || 0) + 1;
      track._stretchPreview = null;
      track._keyShiftPreview = null;
      // A reopened project may restore a moved/trimmed Audio In / Bounce layout. The
      // decoded audio above is the raw source; re-bake so t.buffer matches the clip
      // layout (timeline-indexed) exactly as it was during live editing (전략 B).
      // Trivial layouts (file tracks, un-edited recordings) keep the raw buffer.
      if (!this._isTrivialLayout(track)) this._ensureBaked(track);
      else track._layoutBaked = false;
    },

    async addFileBuffer(name, arrayBuffer, options = {}) {
      this.init();
      const cacheKey = this._decodedCacheKeyForBuffer(name, arrayBuffer, options);
      const decoded = await this._decodeAudio(arrayBuffer, cacheKey);
      const buffer = decoded.buffer;
      if (this.tracks.some(t => t.isDemo)) {
        this.duration = Math.max(this.duration, buffer.duration);
      } else {
        const maxExisting = this.tracks.reduce((m, t) => Math.max(m, (t.buffer && !t.needsAudio) ? t.buffer.duration : 0), 0);
        this.duration = Math.max(maxExisting, buffer.duration);
      }
      const filePath = options.filePath || null;
      const displayName = options.displayName || this._displayName(name);
      const reconnectTrackId = options.reconnectTrackId || null;
      const ph = this.tracks.find(t => t.needsAudio && (
        (reconnectTrackId && t.id === reconnectTrackId) ||
        (filePath && t.filePath === filePath)
      ));
      if (ph) {
        ph.fileName = ph.fileName || name;
        ph.filePath = filePath || ph.filePath || null;
        this._assignDecodedToTrack(ph, decoded);
        this._applyMix();
        this._startHotAddedTrack(ph);
        return ph;
      }
      const palette = ["#e8b04b", "#d98a55", "#9bbf7a", "#c98fb0", "#7fb0c4", "#cf6f5c"];
      const color = palette[this.tracks.length % palette.length];
      const t = this._addTrack({ name: displayName, type: "audio", color, buffer, peaks: decoded.peaks, fileName: name, filePath });
      this.duration = Math.max(this.duration, this._projectClipDuration());
      this._startHotAddedTrack(t);
      return t;
    },

    // Reload a NON-primary source's audio (a second/third Take) after a project reopen.
    // addFileBuffer/_assignDecodedToTrack only reconnect sources[0]; the extra Takes each
    // have their own recording WAV, so the reconnect flow calls this per source. We drop the
    // decoded buffer into _rawBuffers[sourceId], clear the source's needsAudio, and re-bake
    // so the active lane (which may BE this source) picks it up.
    async hydrateSource(trackId, sourceId, arrayBuffer, options = {}) {
      const track = this.tracks.find(t => t.id === trackId);
      if (!track) return null;
      const src = (track.sources || []).find(s => s.id === sourceId);
      if (!src) return null;
      const cacheKey = this._decodedCacheKeyForBuffer(src.fileName || track.name, arrayBuffer, { filePath: src.filePath });
      const decoded = await this._decodeAudio(arrayBuffer, cacheKey);
      track._rawBuffers = track._rawBuffers || {};
      track._rawBuffers[sourceId] = decoded.buffer;
      src.needsAudio = false;
      src.duration = decoded.buffer.duration;
      src.sampleRate = decoded.buffer.sampleRate;
      src.channels = decoded.buffer.numberOfChannels;
      this._ensureBaked(track);
      this._applyMix();
      this._startHotAddedTrack(track);
      return track;
    },

    async addFile(file) {
      this.init();
      const cacheKey = this._decodedCacheKeyForFile(file);
      let decoded = cacheKey && this._decodedCache.get(cacheKey);
      if (!decoded) {
        const arr = await file.arrayBuffer();
        decoded = await this._decodeAudio(arr, cacheKey);
      }
      const buffer = decoded.buffer;
      const fileName = file.name;
      const name = this._displayName(fileName);
      const filePath = file.path || null;
      if (this.tracks.some(t => t.isDemo)) {
        this.duration = Math.max(this.duration, buffer.duration);
      } else {
        const maxExisting = this.tracks.reduce((m, t) => Math.max(m, (t.buffer && !t.needsAudio) ? t.buffer.duration : 0), 0);
        this.duration = Math.max(maxExisting, buffer.duration);
      }
      // Browser File objects usually do not expose absolute paths. Without an exact
      // path, keep imports as new tracks instead of guessing by file name.
      const ph = this.tracks.find(t => t.needsAudio && filePath && t.filePath === filePath);
      if (ph) {
        ph.fileName = ph.fileName || fileName;
        ph.filePath = filePath || ph.filePath || null;
        this._assignDecodedToTrack(ph, decoded);
        this._applyMix();
        this._startHotAddedTrack(ph);
        return ph;
      }
      const palette = ["#e8b04b", "#d98a55", "#9bbf7a", "#c98fb0", "#7fb0c4", "#cf6f5c"];
      const color = palette[this.tracks.length % palette.length];
      const t = this._addTrack({ name, type: "audio", color, buffer, peaks: decoded.peaks, fileName, filePath });
      this.duration = Math.max(this.duration, this._projectClipDuration());
      this._startHotAddedTrack(t);
      return t;
    },

    addBounceTrack(name, buffer, options = {}) {
      this.init();
      if (!buffer) throw new Error("Bounce buffer is empty.");
      const fileName = options.fileName || `${name || "Bounce"}.wav`;
      const filePath = options.filePath || null;
      const displayName = options.displayName || this._displayName(name || fileName) || "Bounce";
      const palette = ["#e8b04b", "#d98a55", "#9bbf7a", "#c98fb0", "#7fb0c4", "#cf6f5c"];
      const color = options.color || palette[this.tracks.length % palette.length];
      const sourceId = this._sourceId();
      const source = {
        id: sourceId,
        filePath,
        fileName,
        duration: buffer.duration,
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
        needsAudio: false,
        sourceTrackIds: Array.isArray(options.sourceTrackIds) ? [...options.sourceTrackIds] : [],
      };
      const t = this._addTrack({
        name: displayName,
        type: "audio",
        color,
        buffer,
        peaks: computePeakLevels(buffer),
        fileName,
        filePath,
        kind: "bounce",
        lockedToZero: false,
        sources: [source],
        clips: [this._normalizeClip({ start: 0, end: buffer.duration, offset: 0 }, sourceId, buffer.duration)],
      });
      this.duration = Math.max(this.duration, this._projectClipDuration());
      this._startHotAddedTrack(t);
      return t;
    },

    async mergeTracks(trackIds, onProgress, options = {}) {
      const ids = Array.isArray(trackIds) ? trackIds.filter(Boolean) : [];
      if (ids.length < 2) throw new Error("Select at least two tracks to merge.");
      return this.renderMix(onProgress, { ...options, trackIds: ids, forceLocal: true });
    },

    _anySolo() { return this.tracks.some((t) => t.params.solo && !t.needsAudio && t.buffer); },

    addDemoTracks() {
      this.init();
      TRACK_DEFS.forEach((def) => {
        const buffer = renderMono(ctx, (ch, sr) => def.synth(ch, sr));
        this._addTrack({ name: def.name, type: def.type, color: def.color, buffer, isDemo: true });
      });
      this._spectrum = null;
    },
    clearTracks() {
      this.stop();
      this.tracks.length = 0;
      this.duration = DURATION;
      this.loopRange = null;
      this.repeatPlayEnabled = false;
      this._spectrum = null;
      this.tempo = { projectBpm: null, playbackBpm: null, variBpm: false, key: null, keyShift: 0, variKey: false, detectedKey: null };
      this._renderCacheKey = null;
      this._renderCacheBuffer = null;
      this._stretchPreviewPreparing = false;
      clearTimeout(this._tempoRestartTimer);
      this._tempoRestartTimer = null;
      this.master = { volume: 0.9, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0], reverb: 0, echo: 0, reverbStored: 0.4, echoStored: 0.35, widener: 0.0, saturation: 0.0, exciter: 0.0, fadeIn: 0.0, fadeOut: 0.0, room: 'none', roomParams: { ...ROOM_PRESETS.none } };
      if (ctx) {
        ramp(masterVol.gain, 0.9);
        ramp(mRevSend.gain, 0);
        ramp(mEchoSend.gain, 0);
        if (ambConv) { ambConv.buffer = makeRoomIR(ctx, ROOM_PRESETS.none); ramp(ambSend.gain, 0); }
        ramp(mSatWet.gain, 0);
        ramp(mSatDry.gain, 1.0);
        ramp(mExcWet.gain, 0);
        const wInit = 1.0;
        ramp(mWidLL.gain, 0.5 * (1.0 + wInit));
        ramp(mWidRR.gain, 0.5 * (1.0 + wInit));
        ramp(mWidRL.gain, 0.5 * (1.0 - wInit));
        ramp(mWidLR.gain, 0.5 * (1.0 - wInit));
        if (masterFade) {
          try {
            masterFade.gain.cancelScheduledValues(ctx.currentTime);
            masterFade.gain.setValueAtTime(1.0, ctx.currentTime);
          } catch (e) {}
        }
        for (let i = 0; i < EQ_FREQS.length; i++) {
          if (eqNodes[i]) ramp(eqNodes[i].gain, 0);
        }
      }
    },
    // Remove every audio track but PRESERVE all project-wide (master) settings —
    // master volume, reverb/echo, ambience/room, EQ, widener/saturation/exciter,
    // fades. Track-scoped settings (pan, per-track volume gain, etc.) disappear
    // with their tracks, as intended. Used by the Edit ▸ "Delete all tracks"
    // action so the user can swap in different stems while keeping the effect
    // chain. Tempo is reset to the uninitialised state to match an empty project
    // (the incoming stems will define a new tempo), mirroring removeTrack().
    clearTracksKeepMaster() {
      this.stop();
      this.tracks.length = 0;
      this.duration = DURATION;
      this.loopRange = null;
      this.repeatPlayEnabled = false;
      this._spectrum = null;
      this.tempo = { projectBpm: null, playbackBpm: null, variBpm: false, key: null, keyShift: 0, variKey: false, detectedKey: null };
      this._renderCacheKey = null;
      this._renderCacheBuffer = null;
      this._stretchPreviewPreparing = false;
      clearTimeout(this._tempoRestartTimer);
      this._tempoRestartTimer = null;
      // NB: this.master and the master audio nodes are deliberately left untouched.
    },

    _applyMix() {
      const anySolo = this._anySolo();
      this.tracks.forEach((t) => {
        const p = t.params;
        const audible = p.mute ? 0 : (anySolo && !p.solo ? 0 : 1);
        const g = audible * p.volume;
        ramp(t.nodes.fader.gain, g);
        ramp(t.nodes.panner.pan ? null : null, 0); // noop guard
        try { t.nodes.panner.pan.value = p.pan; } catch (e) {}
        ramp(t.nodes.reverbSend.gain, p.reverb);
        ramp(t.nodes.echoSend.gain, p.echo);
      });
    },

    setTrackParam(id, key, val) {
      const t = this.tracks.find((x) => x.id === id);
      if (!t) return;
      if ((key === "solo" || key === "mute" || key === "bpmSource") && t.needsAudio) {
        t.params[key] = false;
        this._applyMix();
        return;
      }
      if (key === "bpmSource" && val) {
        this.tracks.forEach((track) => {
          if (track.id !== id) track.params.bpmSource = false;
        });
      }
      t.params[key] = val;
      // Solo/Mute are mutually exclusive on the same track
      if (key === "solo" && val) t.params.mute = false;
      else if (key === "mute" && val) t.params.solo = false;
      this._applyMix();
      if (key === "autoOn" || key === "automation") {
        // Coalesce rapid edits (e.g. dragging an automation point) so we don't
        // re-schedule every track × every loop on each mousemove.
        if (this.isPlaying) this._scheduleAutomationSoon();
      }
    },

    clearAllMuteSolo() {
      this.tracks.forEach((t) => {
        t.params.solo = false;
        t.params.mute = false;
      });
      this._applyMix();
    },

    _normalizeBpm(bpm) {
      if (bpm == null || bpm === "") return null;
      const n = Number(bpm);
      if (!Number.isFinite(n)) return null;
      return Math.max(20, Math.min(300, Math.round(n)));
    },

    setProjectBpm(bpm) {
      const next = this._normalizeBpm(bpm);
      if (!next) return false;
      this.tempo.projectBpm = next;
      if (!this.tempo.playbackBpm) this.tempo.playbackBpm = next;
      this._restartPlaybackForTempo();
      this._emit();
      return true;
    },

    setPlaybackBpm(bpm) {
      if (!this.tempo.projectBpm) return false;
      const next = this._normalizeBpm(bpm);
      if (!next) return false;
      this.tempo.playbackBpm = next;
      this._restartPlaybackForTempo();
      this._emit();
      return true;
    },

    adjustPlaybackBpm(delta) {
      const base = this.tempo.playbackBpm || this.tempo.projectBpm;
      if (!base) return false;
      return this.setPlaybackBpm(base + delta);
    },

    // Vari BPM 모드 on/off. on이면 재생 BPM 비율로 곡 전체 속도를 조정한다.
    setVariBpm(on) {
      this.tempo.variBpm = !!on;
      this._restartPlaybackForTempo();
      this._emit();
      return this.tempo.variBpm;
    },

    setVariKey(on) {
      this.tempo.variKey = !!on;
      this._restartPlaybackForKey();
      this._emit();
      return this.tempo.variKey;
    },

    getBpmSourceTrack() {
      return this.tracks.find((t) => t.params && t.params.bpmSource) || null;
    },

    detectBpmFromTrack(id) {
      const t = this.tracks.find((x) => x.id === id);
      if (!t || !t.buffer || t.needsAudio) return null;
      const bpm = estimateBpm(t.buffer);
      if (!bpm) return null;
      // 옥타브(2배) 오검출 보정: 결과가 180 이상으로 의심스러우면 곡 앞 1/3의
      // 중간 지점(len/6)에서 한 번 더 검출한다. 그 값이 충분히 낮으면(≈절반)
      // 처음 값의 1/2을 결과로 본다.
      if (bpm >= 180) {
        const frontCenter = Math.floor((t.buffer.length || 0) / 6); // 앞 1/3의 중간
        const frontBpm = estimateBpm(t.buffer, frontCenter);
        if (frontBpm && frontBpm < bpm * 0.75) {
          return Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(bpm / 2)));
        }
      }
      return bpm;
    },

    detectKeyFromTrack(id) {
      const t = this.tracks.find((x) => x.id === id);
      if (!t || !t.buffer || t.needsAudio) return null;
      return estimateKey(t.buffer);
    },

    // 키 검출은 BPM 소스 트랙 선택과 무관하게, 오디오가 있고 mute가 아닌 모든
    // 트랙의 화성 내용을 신뢰도 가중으로 합산해 추정한다. (mute 트랙은 제외)
    detectKeyFromAllTracks() {
      const included = [];
      const excluded = [];
      const anySolo = this._anySolo();
      this.tracks.forEach((t, i) => {
        const name = (t && (t.name || t.fileName || t.id)) || `Track ${i + 1}`;
        const p = t && t.params ? t.params : {};
        if (!t || !t.buffer) {
          excluded.push(`${name} (no audio)`);
        } else if (t.needsAudio) {
          excluded.push(`${name} (needs audio)`);
        } else if (p.mute) {
          excluded.push(`${name} (muted)`);
        } else if (anySolo && !p.solo) {
          excluded.push(`${name} (solo-muted)`);
        } else {
          included.push(t);
        }
      });
      console.log("[KeyDetection] Included tracks:", included.map((t) => t.name || t.fileName || t.id));
      console.log("[KeyDetection] Excluded tracks:", excluded);
      const buffers = included.map((t) => t.buffer);
      const labels = included.map((t) => t.name || t.fileName || t.id);
      if (!buffers.length) return null;
      return estimateKeyFromBuffers(buffers, labels);
    },

    // Restore keyShift for save/undo compat: use the stored integer when present,
    // otherwise derive it from detectedKey -> key, else 0.
    _resolveKeyShift(rawTempo, detectedKey, key) {
      if (rawTempo && rawTempo.keyShift != null) return this._normalizeKeyShift(rawTempo.keyShift);
      if (detectedKey && key) return this._normalizeKeyShift(semitoneDiff(detectedKey, key));
      return 0;
    },

    // Clamp a key-shift to an integer in -6..+6. Non-numeric → 0.
    _normalizeKeyShift(value) {
      const n = Math.round(Number(value));
      if (!Number.isFinite(n)) return 0;
      return Math.max(-6, Math.min(6, n));
    },

    // The semitone amount actually applied to audio: only when Vari Key is on and
    // an original key was detected. Otherwise 0 (play/export at original pitch).
    _keyShiftSemitones() {
      if (!this.tempo.variKey || !this.tempo.detectedKey) return 0;
      return this._normalizeKeyShift(this.tempo.keyShift);
    },

    // Primary entry point: store the semitone offset, recompute the applied key
    // string from the detected key, and (if transposing during playback) restart
    // with the same debounce as a tempo change.
    setKeyShift(semitones) {
      const next = this._normalizeKeyShift(semitones);
      this.tempo.keyShift = next;
      this.tempo.key = this.tempo.detectedKey ? shiftKeyString(this.tempo.detectedKey, next) : null;
      this._restartPlaybackForKey();
      this._emit();
      return this.tempo.keyShift;
    },

    // Kept for external/back-compat callers. Stores the applied key string but also
    // derives keyShift from the detected key so the integer stays the source of truth.
    setKey(key) {
      this.tempo.key = key || null;
      if (this.tempo.detectedKey && key) {
        this.tempo.keyShift = this._normalizeKeyShift(semitoneDiff(this.tempo.detectedKey, key));
      } else if (!key) {
        this.tempo.keyShift = 0;
      }
      this._emit();
      return this.tempo.key;
    },
    setDetectedKey(key) {
      this.tempo.detectedKey = key || null;
      // A new original key invalidates the previous transposition (per spec: reset).
      this.tempo.keyShift = 0;
      this.tempo.key = null;
      this._emit();
      return this.tempo.detectedKey;
    },

    _projectRate() {
      // Vari BPM 스위치가 꺼져 있으면 재생 BPM으로 곡 속도를 조정하지 않는다.
      if (!this.tempo.variBpm) return 1;
      const project = this.tempo.projectBpm;
      const playback = this.tempo.playbackBpm || project;
      if (!project || !playback) return 1;
      return Math.max(0.25, Math.min(4, playback / project));
    },

    _trackPlaybackRate() {
      // All tracks share the global tempo ratio (Playback BPM / Project BPM).
      return this._projectRate();
    },

    _shouldUseRealtimeStretch(rate = this._projectRate()) {
      return this.tempo.variBpm && Math.abs(rate - 1) > 0.001;
    },

    _stretchPreviewKey(track, rate) {
      const b = track && track.buffer;
      if (!b) return "";
      return [
        track.id,
        track.audioRev || 0,
        b.sampleRate || 0,
        b.numberOfChannels || 0,
        b.length || 0,
        Math.round(rate * 1000000),
      ].join(":");
    },

    async _prepareRealtimeStretch(rate = this._projectRate()) {
      if (!this._shouldUseRealtimeStretch(rate)) return false;
      this.init();
      this._stretchPreviewPreparing = true;
      this._emit();
      await waitForPaint();
      try {
        for (const t of this.tracks) {
          if (!t || !t.buffer || t.needsAudio) continue;
          const key = this._stretchPreviewKey(t, rate);
          if (t._stretchPreview && t._stretchPreview.key === key && t._stretchPreview.buffer) continue;
          await new Promise((resolve) => setTimeout(resolve, 0));
          const targetLength = Math.max(1, Math.ceil(t.buffer.length / rate));
          t._stretchPreview = {
            key,
            rate,
            buffer: timeStretchBuffer(ctx, t.buffer, rate, targetLength),
          };
        }
        return true;
      } finally {
        this._stretchPreviewPreparing = false;
        this._stretchPreviewDoneSeq = (this._stretchPreviewDoneSeq || 0) + 1;
        this._emit();
      }
    },

    // Semitones to pitch-shift for the WebAudio fallback PLAYBACK path. Only when the
    // web engine is the audible output (native disconnected → not muted): when native
    // is connected the web engine is silenced, so baking would be wasted work.
    _fallbackKeyShiftSemis() {
      if (this._outputMuted) return 0;
      if (!this.tempo.variKey || !this.tempo.detectedKey) return 0;
      return this._normalizeKeyShift(this.tempo.keyShift);
    },

    // Semitones for the EXPORT (offline render) path. Not gated on _outputMuted — an
    // export that falls back to the web renderer must apply the shift even while the
    // native engine is connected (it's the web render that produces the file).
    _exportKeyShiftSemis() {
      if (!this.tempo.variKey || !this.tempo.detectedKey) return 0;
      return this._normalizeKeyShift(this.tempo.keyShift);
    },

    // Pre-bake pitch-shifted buffers for the current key shift (async, yielding between
    // tracks so the UI can paint a "preparing" spinner). Bakes on top of the BPM
    // stretch preview when Vari BPM is also active, so the two combine.
    async _prepareKeyShift(rate = this._projectRate()) {
      const semis = this._fallbackKeyShiftSemis();
      if (semis === 0) return false;
      this.init();
      this._stretchPreviewPreparing = true;
      this._emit();
      await waitForPaint();
      try {
        for (const t of this.tracks) {
          if (!t || !t.buffer || t.needsAudio) continue;
          let base = t.buffer;
          if (this._shouldUseRealtimeStretch(rate)) {
            const pv = t._stretchPreview;
            if (pv && pv.rate === rate && pv.buffer) base = pv.buffer;
          }
          const kp = t._keyShiftPreview;
          if (kp && kp.semis === semis && kp.base === base && kp.buffer) continue;
          await new Promise((resolve) => setTimeout(resolve, 0));
          t._keyShiftPreview = { semis, base, buffer: pitchShiftBuffer(ctx, base, semis) };
        }
        return true;
      } finally {
        this._stretchPreviewPreparing = false;
        this._stretchPreviewDoneSeq = (this._stretchPreviewDoneSeq || 0) + 1;
        this._emit();
      }
    },

    _playbackBufferForTrack(track, rate = this._projectRate()) {
      let base = track.buffer;
      if (this._shouldUseRealtimeStretch(rate)) {
        const preview = track._stretchPreview;
        if (preview && preview.rate === rate && preview.buffer) base = preview.buffer;
      }
      const semis = this._fallbackKeyShiftSemis();
      if (semis !== 0) {
        const kp = track._keyShiftPreview;
        // Pitch shift preserves length, so the keyShift preview shares its base's
        // duration → _sourceOffsetForTrack math is unchanged.
        if (kp && kp.semis === semis && kp.base === base && kp.buffer) return kp.buffer;
      }
      return base;
    },

    _sourceOffsetForTrack(track, sourceBuffer, rate = this._projectRate()) {
      const offset = Math.max(0, this._offset || 0);
      if (!sourceBuffer || !sourceBuffer.duration) return 0;
      if (sourceBuffer !== track.buffer && this._shouldUseRealtimeStretch(rate)) {
        return Math.min(sourceBuffer.duration - 0.001, (offset / rate) % sourceBuffer.duration);
      }
      return offset % sourceBuffer.duration;
    },

    // Join a file that finished decoding while transport is already running.
    // During section Repeat it joins immediately too; the existing common seek at
    // the next loopRange.start then removes any residual sub-block alignment error.
    _startHotAddedTrack(track) {
      if (!ctx || !this.isPlaying || !track || !track.buffer || track.needsAudio) return;

      if (track._liveSource) {
        try { track._liveSource.stop(); } catch (e) {}
        const oldIndex = this._sources.indexOf(track._liveSource);
        if (oldIndex >= 0) this._sources.splice(oldIndex, 1);
        track._liveSource = null;
      }

      const rate = this._activePlaybackRate();
      const startAt = ctx.currentTime + 0.01;
      const projectPosition = this._projectPositionAt(startAt, rate);
      const sourceBuffer = this._playbackBufferForTrack(track, rate);
      if (!sourceBuffer || !sourceBuffer.duration) return;

      const src = ctx.createBufferSource();
      const joinGain = ctx.createGain();
      src.buffer = sourceBuffer;
      const usingStretchPreview = sourceBuffer !== track.buffer && this._shouldUseRealtimeStretch(rate);
      try { src.playbackRate.value = usingStretchPreview ? 1 : rate; } catch (e) {}
      src.connect(joinGain);
      joinGain.connect(track.nodes.fader);
      joinGain.gain.setValueAtTime(0, startAt);
      joinGain.gain.linearRampToValueAtTime(1, startAt + 0.008);

      const sourceOffset = usingStretchPreview
        ? (projectPosition / rate) % sourceBuffer.duration
        : projectPosition % sourceBuffer.duration;
      src.start(startAt, Math.max(0, Math.min(sourceBuffer.duration - 0.001, sourceOffset)));
      track._liveSource = src;
      this._sources.push(src);
      this._scheduleAutomation();
    },

    _scheduleRealtimeStretchRestart(oldRate, nextRate) {
      clearTimeout(this._tempoRestartTimer);
      this._stretchPreviewPreparing = true;
      this._emit();
      this._tempoRestartTimer = setTimeout(() => {
        this._tempoRestartTimer = null;
        if (!ctx || !this.isPlaying) {
          this._stretchPreviewPreparing = false;
          this._stretchPreviewDoneSeq = (this._stretchPreviewDoneSeq || 0) + 1;
          this._emit();
          return;
        }
        const raw = this._projectPositionAt(ctx.currentTime, oldRate);
        const pos = this.loopEnabled ? raw % this.duration : Math.min(raw, this.duration);
        this._offset = pos;
        this._stopSources();
        this.isPlaying = false;
        this.play({ skipFade: true });
      }, 500);
    },

    _activePlaybackRate() {
      const rate = this.isPlaying ? this._appliedRate : this._projectRate();
      return Number.isFinite(rate) && rate > 0 ? rate : 1;
    },

    _projectPositionAt(audioTime, rate = this._activePlaybackRate()) {
      return this._offset + (audioTime - this._startTime) * rate;
    },

    _renderCacheSignature(sampleRate, normalize, renderRate, preservePitch) {
      return JSON.stringify({
        sampleRate,
        normalize: normalize !== false,
        renderRate,
        preservePitch: !!preservePitch,
        duration: this.duration,
        tempo: this.tempo,
        master: { ...this.master, volume: 1 },
        tracks: this.tracks.map((t) => ({
          id: t.id,
          name: t.name,
          type: t.type,
          kind: t.kind || "file",
          lockedToZero: t.lockedToZero !== undefined ? !!t.lockedToZero : true,
          fileName: t.fileName || null,
          filePath: t.filePath || null,
          isDemo: !!t.isDemo,
          needsAudio: !!t.needsAudio,
          sources: this._serializedSources(t),
          buffer: t.buffer ? {
            duration: t.buffer.duration,
            sampleRate: t.buffer.sampleRate,
            channels: t.buffer.numberOfChannels,
            length: t.buffer.length,
          } : null,
          params: t.params,
          clips: this._serializedClips(t),
          takes: Array.isArray(t.takes) ? t.takes : [],
          activeTakeId: t.activeTakeId || null,
        })),
      });
    },

    _restartPlaybackForTempo() {
      if (!ctx || !this.isPlaying) return;
      // 실제 적용되는 재생 rate가 바뀌지 않으면 재시작하지 않는다.
      // (예: Vari BPM이 OFF인 상태에서 재생 BPM 값만 스크롤로 바꿀 때 → rate는 계속 1이므로
      //  소스를 재시작할 필요가 없고, 재시작하면 오히려 클릭/글리치가 발생함.)
      const oldRate = this._activePlaybackRate();
      const nextRate = this._projectRate();
      if (nextRate === oldRate) {
        clearTimeout(this._tempoRestartTimer);
        this._tempoRestartTimer = null;
        this._stretchPreviewPreparing = false;
        return;
      }
      if (this._shouldUseRealtimeStretch(nextRate)) {
        this._scheduleRealtimeStretchRestart(oldRate, nextRate);
        return;
      }
      clearTimeout(this._tempoRestartTimer);
      this._tempoRestartTimer = null;
      this._stretchPreviewPreparing = false;
      const raw = this._projectPositionAt(ctx.currentTime, oldRate);
      const pos = this.loopEnabled ? raw % this.duration : Math.min(raw, this.duration);
      this._offset = pos;
      this._stopSources();
      this.isPlaying = false;
      this.play({ skipFade: true });
    },

    // Re-bake + restart playback after a key change, debounced like the tempo restart.
    // No-op when the native engine is the audible output (web muted) — there the native
    // engine applies the pitch shift live and no web re-bake is needed.
    _restartPlaybackForKey() {
      if (!ctx || !this.isPlaying || this._outputMuted) return;
      clearTimeout(this._keyRestartTimer);
      this._stretchPreviewPreparing = true;
      this._emit();
      this._keyRestartTimer = setTimeout(async () => {
        this._keyRestartTimer = null;
        if (!ctx || !this.isPlaying) {
          this._stretchPreviewPreparing = false;
          this._stretchPreviewDoneSeq = (this._stretchPreviewDoneSeq || 0) + 1;
          this._emit();
          return;
        }
        const pos = this.getPlayhead();
        this._offset = this.loopEnabled ? (pos % this.duration) : Math.min(pos, this.duration);
        this._stopSources();
        this.isPlaying = false;
        await this.play({ skipFade: true });
      }, 250);
    },

    setMaster(key, val) {
      this.master[key] = val;
      if (!ctx) return;
      // While the Output FX EFFECT bypass is active, effect keys only update state —
      // the nodes stay neutral until the bypass is lifted (volume/fades pass through).
      if (this.masterFxBypassed && (key === "reverb" || key === "echo" || key === "widener" || key === "saturation" || key === "exciter")) return;
      if (key === "volume") ramp(masterVol.gain, val);
      if (key === "reverb") ramp(mRevSend.gain, val);
      if (key === "echo") ramp(mEchoSend.gain, val);
      if (key === "widener") {
        const w = 1.0 + val * 1.5;
        ramp(mWidLL.gain, 0.5 * (1.0 + w));
        ramp(mWidRR.gain, 0.5 * (1.0 + w));
        ramp(mWidRL.gain, 0.5 * (1.0 - w));
        ramp(mWidLR.gain, 0.5 * (1.0 - w));
      }
      if (key === "saturation") {
        ramp(mSatWet.gain, val * 0.8);
        ramp(mSatDry.gain, 1.0 - val * 0.4);
      }
      if (key === "exciter") {
        ramp(mExcWet.gain, val * 0.5);
      }
      if ((key === "fadeIn" || key === "fadeOut") && this.isPlaying) this._scheduleFade();
    },

    setLoopRange(range) {
      this.loopRange = range;
      this._emit();
    },

    // Accept a loop range only if it is usable on THIS project: finite, non-empty, and
    // inside the current duration. Guards a hand-edited/older .focus and a project whose
    // duration shrank since it was saved (a region past the end would draw off-timeline
    // and arm the native loop at an unreachable boundary). Call after `duration` is set.
    _sanitizeLoopRange(range) {
      if (!range) return null;
      const start = Number(range.start);
      const end = Number(range.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      const s = Math.max(0, Math.min(start, this.duration));
      const e = Math.max(0, Math.min(end, this.duration));
      return e > s ? { start: s, end: e } : null;
    },

    setRepeatPlayEnabled(on) {
      const on2 = !!on;
      // Read the true playhead before enabling — mirrors the bridge; snap into the
      // loop whenever the playhead is outside it, in both playing and stopped states.
      const phBefore = this.getPlayhead();
      this.repeatPlayEnabled = on2;
      if (on2 && this.loopRange &&
          (phBefore < this.loopRange.start || phBefore > this.loopRange.end)) {
        this.seek(this.loopRange.start);
      }
      this._emit();
    },

    // Ambience (Sound Environment / room type) — the dedicated bus IR + wet send
    // are driven by `master.roomParams` (effective spec). Reflected in realtime
    // and Export (both share makeRoomIR + roomParams).
    _applyRoom() {
      if (!ctx || !ambConv) return;
      const spec = this.master.roomParams || ROOM_PRESETS.none;
      ambConv.buffer = makeRoomIR(ctx, spec);
      ramp(ambSend.gain, this.masterFxBypassed ? 0 : spec.wet);
    },
    // Select a named preset — resets fine-tune params to that preset's values.
    setRoom(key) {
      const room = ROOM_PRESETS[key] ? key : 'none';
      this.master.room = room;
      this.master.roomParams = { ...ROOM_PRESETS[room] };
      this._applyRoom();
    },
    // Fine-tune a single ambience parameter (Mix/Pre-delay/Decay/Damping/Width).
    // Marks the room as 'custom'. `wet` only re-ramps the send (cheap); other
    // params rebuild the IR.
    setRoomParam(k, v) {
      const base = this.master.roomParams || ROOM_PRESETS[this.master.room] || ROOM_PRESETS.none;
      this.master.roomParams = { ...base, [k]: v };
      this.master.room = 'custom';
      if (!ctx || !ambConv) return;
      if (k === 'wet') ramp(ambSend.gain, this.masterFxBypassed ? 0 : v);
      else this._applyRoom();
    },

    // Temporary master-FX bypass (Output FX track's EFFECT button, for A/B
    // comparison). Silences every master effect at the NODE level — EQ bands,
    // reverb, delay(echo), widener, saturation, exciter, ambience wet — WITHOUT
    // touching this.master, so project data / undo / the mixer UI keep the real
    // values and lifting the bypass restores the exact sound. Master volume,
    // fades and Spatial Field are not effects and stay active. Offline export
    // (renderMix) builds its own graph from this.master, so it is unaffected.
    masterFxBypassed: false,
    setMasterFxBypass(bypassed) {
      this.masterFxBypassed = !!bypassed;
      this._applyMasterFxNodes();
      this._emit();
    },
    _applyMasterFxNodes() {
      if (!ctx) return;
      const byp = this.masterFxBypassed;
      const m = this.master;
      ramp(mRevSend.gain, byp ? 0 : m.reverb);
      ramp(mEchoSend.gain, byp ? 0 : m.echo);
      const w = 1.0 + (byp ? 0 : m.widener) * 1.5;
      ramp(mWidLL.gain, 0.5 * (1.0 + w));
      ramp(mWidRR.gain, 0.5 * (1.0 + w));
      ramp(mWidRL.gain, 0.5 * (1.0 - w));
      ramp(mWidLR.gain, 0.5 * (1.0 - w));
      const sat = byp ? 0 : m.saturation;
      ramp(mSatWet.gain, sat * 0.8);
      ramp(mSatDry.gain, 1.0 - sat * 0.4);
      ramp(mExcWet.gain, (byp ? 0 : m.exciter) * 0.5);
      for (let i = 0; i < EQ_FREQS.length; i++) {
        if (eqNodes[i]) ramp(eqNodes[i].gain, byp ? 0 : (m.bands[i] || 0));
      }
      if (ambSend) {
        const spec = m.roomParams || ROOM_PRESETS[m.room] || ROOM_PRESETS.none;
        ramp(ambSend.gain, byp ? 0 : (spec.wet || 0));
      }
    },

    setMasterBand(i, db) {
      this.master.bands[i] = db;
      if (eqNodes[i] && !this.masterFxBypassed) ramp(eqNodes[i].gain, db);
      this.master.eqPreset = null; // manual band edit → custom (no named preset)
    },
    setMasterGroup(group, db) { // 0=low 1=mid 2=high
      for (let i = group * 3; i < group * 3 + 3; i++) this.setMasterBand(i, db);
    },
    setMasterBands(arr) { // apply all 9 bands at once (e.g. a preset)
      for (let i = 0; i < EQ_FREQS.length; i++) this.setMasterBand(i, arr[i] || 0);
    },
    applyEQPreset(name) {
      const p = EQ_PRESETS[name];
      if (p) this.setMasterBands(p); // clears eqPreset via setMasterBand…
      this.master.eqPreset = (name === 'Flat') ? null : name; // …then tag the named preset (Flat/Reset = none)
    },
    getMasterGroup(group) {
      const b = this.master.bands;
      return (b[group * 3] + b[group * 3 + 1] + b[group * 3 + 2]) / 3;
    },

    exportProject(projectName) {
      return {
        version: "0.12",
        schemaVersion: PROJECT_SCHEMA_VERSION,
        projectName,
        duration: this.duration,
        // The Repeat region travels with the project. Only the region — Repeat itself
        // is deliberately NOT persisted; see importProject.
        loopRange: this.loopRange
          ? { start: this.loopRange.start, end: this.loopRange.end }
          : null,
        tempo: { ...this.tempo },
        master: { ...this.master, bands: [...this.master.bands] },
        tracks: this.tracks.map(t => ({
          id: t.id,
          name: t.name,
          type: t.type,
          kind: t.kind || "file",
          lockedToZero: t.lockedToZero !== undefined ? !!t.lockedToZero : true,
          color: t.color,
          isDemo: !!t.isDemo,
          fileName: t.fileName || null,
          filePath: t.filePath || null,
          sources: this._serializedSources(t),
          params: {
            ...t.params,
            automation: t.params.automation.map(p => ({ ...p })),
          },
          clips: this._serializedClips(t),
          takes: Array.isArray(t.takes) ? t.takes.map(take => ({ ...take })) : [],
          activeTakeId: t.activeTakeId || null,
        })),
      };
    },

    getSnapshot() {
      return {
        duration: this.duration,
        master: {
          volume: this.master.volume,
          reverb: this.master.reverb,
          echo: this.master.echo,
          fadeIn: this.master.fadeIn,
          fadeOut: this.master.fadeOut,
          room: this.master.room,
          roomParams: { ...this.master.roomParams },
        },
        eqBands: [...this.master.bands],
        tempo: { ...this.tempo },
        tracks: this.tracks.map(t => ({
          id: t.id,
          name: t.name,
          type: t.type,
          color: t.color,
          kind: t.kind || "file",
          lockedToZero: t.lockedToZero !== undefined ? !!t.lockedToZero : true,
          isDemo: !!t.isDemo,
          fileName: t.fileName || null,
          filePath: t.filePath || null,
          needsAudio: !!t.needsAudio,
          // Store the RAW source buffer, never the baked (timeline-indexed, truncated)
          // one. Otherwise an undo/redo could reinstate a baked buffer as the track's
          // "raw", and clips whose sourceOffset lies past its (shorter) end would vanish
          // on the next re-bake. _rawBufferForSource returns the raw when baked, else t.buffer.
          buffer: (this._rawBufferForSource(t, t.sources && t.sources[0] && t.sources[0].id) || t.buffer) || null,
          // Every source's raw buffer, by id (kept by reference — undo stack is in-memory).
          // Needed so non-primary Takes' audio survives undo/redo, not just the primary's.
          rawBuffers: t._rawBuffers ? { ...t._rawBuffers } : null,
          sources: this._serializedSources(t),
          params: { ...t.params, automation: t.params.automation.map(p => ({ ...p })) },
          clips: this._serializedClips(t),
          takes: Array.isArray(t.takes) ? t.takes.map(take => ({ ...take })) : [],
          activeTakeId: t.activeTakeId || null,
        })),
      };
    },

    applySnapshot(snap) {
      if (snap.master) {
        this.setMaster("volume", snap.master.volume ?? this.master.volume);
        this.setMaster("reverb", snap.master.reverb ?? this.master.reverb);
        this.setMaster("echo", snap.master.echo ?? this.master.echo);
        this.setMaster("fadeIn", snap.master.fadeIn ?? this.master.fadeIn);
        this.setMaster("fadeOut", snap.master.fadeOut ?? this.master.fadeOut);
        if (snap.master.roomParams) {
          this.master.room = snap.master.room ?? this.master.room;
          this.master.roomParams = { ...snap.master.roomParams };
          this._applyRoom();
        } else {
          this.setRoom(snap.master.room ?? this.master.room);
        }
      }
      if (snap.eqBands) this.setMasterBands(snap.eqBands);
      if (snap.tempo) {
        const detectedKey = snap.tempo.detectedKey ?? null;
        const key = snap.tempo.key ?? null;
        this.tempo = {
          projectBpm: this._normalizeBpm(snap.tempo.projectBpm),
          playbackBpm: this._normalizeBpm(snap.tempo.playbackBpm),
          variBpm: !!snap.tempo.variBpm,
          detectedKey,
          key,
          keyShift: this._resolveKeyShift(snap.tempo, detectedKey, key),
          variKey: !!snap.tempo.variKey,
        };
      }
      const snapTracks = Array.isArray(snap.tracks) ? snap.tracks : [];
      const snapIds = new Set(snapTracks.map(st => st && st.id).filter(Boolean));
      this.tracks.slice().forEach((t) => {
        if (!snapIds.has(t.id)) this.removeTrack(t.id);
      });
      for (const st of snapTracks) {
        let t = this.tracks.find(x => x.id === st.id);
        if (!t) {
          const source = Array.isArray(st.sources) && st.sources[0] ? st.sources[0] : null;
          const sourceDuration = (source && source.duration) || (st.buffer ? st.buffer.duration : this.duration);
          const buffer = st.buffer || ctx.createBuffer(1, Math.max(1, Math.ceil(sourceDuration * ctx.sampleRate)), ctx.sampleRate);
          t = this._addTrack({
            name: st.name || st.fileName || "Track",
            type: st.type || "audio",
            color: st.color,
            buffer,
            kind: st.kind || "file",
            lockedToZero: st.lockedToZero,
            sources: Array.isArray(st.sources) ? st.sources.map(s => ({ ...s })) : null,
            clips: Array.isArray(st.clips) ? st.clips.map(c => ({ ...c })) : null,
            takes: Array.isArray(st.takes) ? st.takes.map(take => ({ ...take })) : [],
            activeTakeId: st.activeTakeId || null,
            isDemo: !!st.isDemo,
            fileName: st.fileName || (source && source.fileName) || null,
            filePath: st.filePath || (source && source.filePath) || null,
            needsAudio: !!st.needsAudio,
          });
          t.id = st.id;
        } else {
          if (st.name !== undefined) t.name = st.name;
          if (st.type !== undefined) t.type = st.type;
          if (st.color !== undefined) t.color = st.color;
          if (st.fileName !== undefined) t.fileName = st.fileName;
          if (st.filePath !== undefined) t.filePath = st.filePath;
          if (st.needsAudio !== undefined) t.needsAudio = !!st.needsAudio;
          if (st.buffer) {
            t.buffer = st.buffer;
            const peaks = computePeakLevels(st.buffer);
            t.peaks = peaks.fine;
            t.peaksMedium = peaks.medium;
            t.peaksCoarse = peaks.coarse;
            t.peakAmp = maxAbsPeak(peaks.coarse);
          }
        }
        const { automation, ...rest } = st.params || {};
        Object.assign(t.params, rest);
        t.params.automation = Array.isArray(automation) ? automation.map(p => ({ ...p })) : defaultAutomation(t.type);
        if (st.kind) t.kind = st.kind;
        if (st.lockedToZero !== undefined) t.lockedToZero = !!st.lockedToZero;
        if (Array.isArray(st.sources)) t.sources = st.sources.map(s => ({ ...s }));
        if (Array.isArray(st.takes)) t.takes = st.takes.map(take => ({ ...take }));
        if (st.activeTakeId !== undefined) t.activeTakeId = st.activeTakeId || null;
        if (Array.isArray(st.clips)) t.clips = st.clips.map(c => ({ ...c }));
        this._normalizeTrackLayout(t);
        // getSnapshot kept every source's RAW buffer by reference (snapshots live in the
        // in-memory undo stack, so holding AudioBuffers is fine). Restore the WHOLE map so
        // a non-primary Take's audio survives undo/redo — otherwise re-baking the active
        // lane after an undo would find its source missing and drop the clip.
        if (st.rawBuffers) t._rawBuffers = { ...st.rawBuffers };
        // Re-seat the primary raw from st.buffer too (corrects any baked buffer a prior
        // undo may have cached as "raw"), then re-derive the display buffer from the clip
        // layout — so undo/redo can never make a clip vanish by shrinking the raw.
        if (t.buffer && t.sources && t.sources[0]) {
          t._rawBuffers = t._rawBuffers || {};
          t._rawBuffers[t.sources[0].id] = t.buffer;
        }
        if (t.buffer && !this._isTrivialLayout(t)) this._ensureBaked(t);
        else t._layoutBaked = false;
      }
      if (snapTracks.length) {
        const order = new Map(snapTracks.map((st, i) => [st.id, i]));
        this.tracks.sort((a, b) => (order.get(a.id) ?? 999999) - (order.get(b.id) ?? 999999));
      }
      this.duration = Math.max(snap.duration || DURATION, this._projectClipDuration());
      this._applyMix();
      if (this.isPlaying) this._scheduleAutomationSoon();
    },

    importProject(json) {
      this.init();
      this.stop();
      this.tracks.length = 0;
      this._spectrum = null;
      this.duration = json.duration || DURATION;
      // Restore the Repeat region, but open with Repeat OFF: a project that starts
      // looping a region the moment it opens would be a surprise, and the region is
      // right there to switch on. Projects saved before v1.24.1 have no loopRange
      // field at all — sanitize handles that (and a region past a now-shorter
      // duration) by returning null, so no migration is needed.
      this.loopRange = this._sanitizeLoopRange(json.loopRange);
      this.repeatPlayEnabled = false;
      const jt = json.tempo || {};
      const jtDetectedKey = jt.detectedKey ?? null;
      const jtKey = jt.key ?? null;
      this.tempo = {
        projectBpm: this._normalizeBpm(jt.projectBpm),
        playbackBpm: this._normalizeBpm(jt.playbackBpm),
        variBpm: !!jt.variBpm,
        detectedKey: jtDetectedKey,
        key: jtKey,
        keyShift: this._resolveKeyShift(jt, jtDetectedKey, jtKey),
        variKey: !!jt.variKey,
      };
      if (json.master) {
        Object.assign(this.master, json.master);
        ramp(masterVol.gain, this.master.volume);
        ramp(mRevSend.gain, this.master.reverb || 0);
        ramp(mEchoSend.gain, this.master.echo || 0);
        if (this.master.widener !== undefined) this.setMaster("widener", this.master.widener);
        if (this.master.saturation !== undefined) this.setMaster("saturation", this.master.saturation);
        if (this.master.exciter !== undefined) this.setMaster("exciter", this.master.exciter);
        if (this.master.bands) { const ep = this.master.eqPreset; this.master.bands.forEach((db, i) => this.setMasterBand(i, db)); this.master.eqPreset = ep || null; }
        if (this.master.roomParams) this._applyRoom();
        else this.setRoom(this.master.room || 'none');
      }
      (json.tracks || []).forEach(td => {
        const primarySource = Array.isArray(td.sources) && td.sources[0] ? td.sources[0] : null;
        const fileName = td.fileName || (primarySource && primarySource.fileName) || null;
        const filePath = td.filePath || (primarySource && primarySource.filePath) || null;
        const isAudioPlaceholder = !td.isDemo && (!!fileName || !!filePath);
        const sourceDuration = (primarySource && primarySource.duration) || this.duration;
        let buffer;
        if (td.isDemo) {
          const def = TRACK_DEFS.find(d => d.type === td.type || d.name === td.name);
          buffer = def
            ? renderMono(ctx, (ch, sr) => def.synth(ch, sr))
            : ctx.createBuffer(1, Math.ceil(this.duration * ctx.sampleRate), ctx.sampleRate);
        } else {
          buffer = ctx.createBuffer(1, Math.max(1, Math.ceil(sourceDuration * ctx.sampleRate)), ctx.sampleRate);
        }
        const sources = Array.isArray(td.sources) && td.sources.length
          ? td.sources.map(s => ({ ...s, needsAudio: isAudioPlaceholder }))
          : null;
        const primaryId = sources && sources[0] && sources[0].id;
        const clips = Array.isArray(td.clips)
          ? td.clips.map(c => ({ ...c, sourceId: c.sourceId || primaryId }))
          : null;
        const track = this._addTrack({
          name: td.name, type: td.type, color: td.color, buffer,
          kind: td.kind || "file",
          lockedToZero: td.lockedToZero,
          sources,
          clips,
          takes: td.takes,
          activeTakeId: td.activeTakeId || null,
          isDemo: !!td.isDemo, fileName, filePath,
          needsAudio: isAudioPlaceholder,
        });
        track.id = td.id;
        if (td.params) {
          Object.assign(track.params, td.params);
          if (td.params.automation) track.params.automation = td.params.automation.map(p => ({ ...p }));
        }
        if (track.needsAudio) {
          track.params.solo = false;
          track.params.mute = false;
          track.params.bpmSource = false;
        }
        this._normalizeTrackLayout(track);
      });
      this.duration = Math.max(this.duration, this._projectClipDuration());
      this._applyMix();
    },

    splitClip(trackId, clipId, atSec) {
      const t = this.tracks.find(x => x.id === trackId); if (!t) return;
      const ci = t.clips.findIndex(c => c.id === clipId); if (ci < 0) return;
      const clip = t.clips[ci];
      if (atSec <= clip.start + 0.01 || atSec >= clip.end - 0.01) return;
      const sourceId = clip.sourceId || (t.sources && t.sources[0] && t.sources[0].id) || null;
      const leftDuration = atSec - clip.start;
      const rightDuration = clip.end - atSec;
      const left  = { id: this._cid(), start: clip.start, end: atSec,
        offset: clip.offset, sourceId, sourceOffset: clip.sourceOffset ?? clip.offset, duration: leftDuration,
        gain: clip.gain ?? 1.0, muted: !!clip.muted, takeId: clip.takeId || null,
        params: clip.params ? { ...clip.params } : null, automation: null };
      const right = { id: this._cid(), start: atSec, end: clip.end,
        offset: clip.offset + (atSec - clip.start), sourceId, sourceOffset: (clip.sourceOffset ?? clip.offset) + (atSec - clip.start), duration: rightDuration,
        gain: clip.gain ?? 1.0, muted: !!clip.muted, takeId: clip.takeId || null,
        params: null, automation: null };
      // Each clip keeps its OWN sourceId — passing the split clip's sourceId for the whole
      // array re-pointed every other clip at this source while leaving their sourceOffset
      // alone, so an untouched clip rendered THIS clip's audio (a track holds clips from
      // several sources once join/consolidate or paste is used).
      t.clips = [...t.clips.slice(0, ci), left, right, ...t.clips.slice(ci + 1)]
        .map(c => this._normalizeClip(c, c.sourceId || sourceId, 0));
      this._ensureBaked(t);   // keep buffer/peaks/_layoutBaked consistent with the new clip count
      if (this.isPlaying) this._scheduleAutomation();
    },

    // Concatenate two clips' ACTUAL audio into a fresh source buffer + register it, with
    // a micro-fade at the seam. Used when joining clips that are NOT source-contiguous
    // (e.g. copies, or different source ranges) so neither half is lost: a single
    // source-read clip cannot represent "sourceA[..] then sourceB[..]". gapSec (timeline
    // silence between the two clips) is written between them so the join keeps both clips
    // where they sit. Returns the new sourceId, or null if a raw buffer is missing.
    _consolidateClips(track, first, second, gapSec = 0) {
      if (!ctx) return null;
      this._captureRawBuffers(track);
      const rawA = this._rawBufferForSource(track, first.sourceId);
      const rawB = this._rawBufferForSource(track, second.sourceId);
      if (!rawA || !rawB) return null;
      const sr = rawA.sampleRate;
      const ch = Math.max(rawA.numberOfChannels, rawB.numberOfChannels);
      const offA = Math.max(0, Math.round((first.sourceOffset != null ? first.sourceOffset : (first.offset || 0)) * sr));
      const offB = Math.max(0, Math.round((second.sourceOffset != null ? second.sourceOffset : (second.offset || 0)) * sr));
      const durA = Math.round((first.duration || 0) * sr);
      const durB = Math.round((second.duration || 0) * sr);
      const nA = Math.max(0, Math.min(durA, rawA.length - offA));
      const nB = Math.max(0, Math.min(durB, rawB.length - offB));
      const gapN = Math.max(0, Math.round((gapSec || 0) * sr));
      const total = Math.max(1, durA + gapN + durB);
      const out = ctx.createBuffer(ch, total, sr);
      const gA = first.gain == null ? 1 : first.gain;
      const gB = second.gain == null ? 1 : second.gain;
      const fadeN = Math.min(Math.floor(this._MICRO_FADE * sr), Math.floor(Math.min(nA, nB) / 2));
      for (let c = 0; c < ch; c++) {
        const dst = out.getChannelData(c);
        const sA = rawA.getChannelData(Math.min(c, rawA.numberOfChannels - 1));
        for (let i = 0; i < nA; i++) {
          let g = gA;
          if (fadeN > 0 && i >= nA - fadeN) g *= (nA - i) / fadeN; // fade out at seam
          dst[i] = sA[offA + i] * g;
        }
        const sB = rawB.getChannelData(Math.min(c, rawB.numberOfChannels - 1));
        for (let i = 0; i < nB; i++) {
          let g = gB;
          if (fadeN > 0 && i < fadeN) g *= i / fadeN;             // fade in at seam
          dst[durA + gapN + i] = sB[offB + i] * g;
        }
      }
      // _sourceId(), not _cid(): this is a source, and _cid() is the CLIP counter — it
      // was handing out "cN" ids into the source namespace.
      return this._registerSource(track, {
        id: this._sourceId(), duration: total / sr, sampleRate: sr, channels: ch,
        fileName: (track.sources && track.sources[0] && track.sources[0].fileName) || track.name || null,
        filePath: null, needsAudio: false,
      }, out);
    },

    joinClips(trackId, clipIdA, clipIdB) {
      const t = this.tracks.find(x => x.id === trackId); if (!t) return;
      const a = t.clips.find(c => c.id === clipIdA);
      const b = t.clips.find(c => c.id === clipIdB);
      if (!a || !b || a === b) return;
      if ((a.duration || 0) <= 0 || (b.duration || 0) <= 0) return; // empty placeholder — nothing to join
      // Order by TIMELINE position and require timeline adjacency. This used to compare
      // ARRAY indices (|ia-ib| === 1), which silently refused a perfectly valid join as
      // soon as anything (e.g. a zero-duration placeholder) sat between them in the array.
      const first = a.start <= b.start ? a : b;
      const second = first === a ? b : a;
      const between = t.clips.some(c => c !== first && c !== second && (c.duration || 0) > 0
        && c.start > first.start + 1e-6 && c.start < second.start - 1e-6);
      if (between) return; // not neighbours on the timeline
      const firstOff = first.sourceOffset != null ? first.sourceOffset : (first.offset || 0);
      const secondOff = second.sourceOffset != null ? second.sourceOffset : (second.offset || 0);
      // Gap on the timeline: joining across it must keep both clips where they are, so the
      // merged clip spans first.start..second.end with the gap carried as silence.
      const gap = Math.max(0, second.start - (first.start + (first.duration || 0)));
      // Contiguous = a true re-join of split-adjacent pieces (same source, no timeline gap,
      // second picks up exactly where first ends): a single continuous source read is
      // correct & cheap. With a gap the source read would slide the second half earlier.
      const contiguous = first.sourceId === second.sourceId
        && gap < 1e-3
        && Math.abs(secondOff - (firstOff + (first.duration || 0))) < 1e-3;
      let merged;
      if (contiguous) {
        const sourceId = first.sourceId || second.sourceId || (t.sources && t.sources[0] && t.sources[0].id) || null;
        merged = { id: this._cid(), start: first.start, end: second.end,
          offset: firstOff, sourceId, sourceOffset: firstOff,
          duration: second.end - first.start, gain: first.gain ?? 1.0, muted: !!first.muted,
          takeId: first.takeId || second.takeId || null, params: first.params, automation: first.automation };
      } else {
        // Copies / different ranges: consolidate both audios into a new source, else the
        // second clip's audio would be lost on the next re-bake (reads past source end).
        const sid = this._consolidateClips(t, first, second, gap);
        if (!sid) return; // missing raw — leave the clips untouched rather than lose audio
        const dur = (first.duration || 0) + gap + (second.duration || 0);
        merged = { id: this._cid(), start: first.start, end: first.start + dur,
          offset: 0, sourceId: sid, sourceOffset: 0, duration: dur,
          gain: 1.0, muted: !!first.muted, takeId: first.takeId || second.takeId || null,
          params: null, automation: null };
      }
      // Drop the two source clips by identity (not by index) and re-sort, so the array
      // stays in timeline order no matter where they sat.
      t.clips = [...t.clips.filter(c => c !== first && c !== second), merged]
        .sort((x, y) => (x.start || 0) - (y.start || 0));
      this._normalizeTrackLayout(t);
      this._ensureBaked(t);   // was missing → join left a stale buffer; the next edit re-baked and dropped audio
      if (this.isPlaying) this._scheduleAutomation();
    },

    setClipParam(trackId, clipId, key, val) {
      const t = this.tracks.find(x => x.id === trackId); if (!t) return;
      const clip = t.clips.find(c => c.id === clipId); if (!clip) return;
      if (!clip.params) clip.params = {};
      clip.params[key] = val;
      t.clips = [...t.clips];
      if (this.isPlaying) this._scheduleAutomation();
    },

    // ============================================================
    //  Phase 5 — clip editing (전략 B: layout bake)
    //  clips[] is the non-destructive source of truth. On edit we re-bake a
    //  flattened t.buffer (each clip's source slice placed at its timeline start,
    //  + micro fade + clip.gain) so the existing single-source playback / Export /
    //  native loadTrack path keeps working (buffer-time == timeline-time).
    // ============================================================
    _MICRO_FADE: 0.004,   // 4ms click/pop guard at clip boundaries
    _MIN_CLIP: 0.02,      // 20ms minimum clip length

    // Pristine per-source audio, captured lazily before the first bake (at which
    // point t.buffer is still the original decoded primary source). Re-bakes always
    // read from here, never from an already-baked buffer.
    // Lazily register the raw buffer of a track whose audio arrived as a plain decode
    // (import, reconnect, first recording): those paths only set track.buffer, so the
    // per-source map has to be seeded from it.
    //
    // Additive on purpose. This used to be `if (track._rawBuffers) return;` — first call
    // wins, nothing is ever added — which quietly capped a track at ONE registered
    // source. Consolidate (v1.21.7) already worked around it by writing _rawBuffers
    // directly; Take accumulation (Stage 3) would have hit the same wall. Use
    // _registerSource() to add a source and its raw buffer together.
    _captureRawBuffers(track) {
      if (!track._rawBuffers) track._rawBuffers = {};
      const primary = track.sources && track.sources[0];
      // Only seed from track.buffer while it still IS a raw decode. Once baked it is the
      // flattened timeline render, and storing that as a "source" would feed a re-bake
      // its own output.
      if (primary && track.buffer && !track._layoutBaked && !track._rawBuffers[primary.id]) {
        track._rawBuffers[primary.id] = track.buffer;
      }
    },
    // Append a source to the track AND register its raw buffer in one step. These two
    // must never drift apart: a source whose raw buffer is missing bakes to silence and
    // its clip vanishes (see _bakeTrackLayout's "no raw buffer" warning).
    _registerSource(track, meta, rawBuffer) {
      this._captureRawBuffers(track);
      track.sources = [...(track.sources || []), meta];
      if (rawBuffer) track._rawBuffers[meta.id] = rawBuffer;
      return meta.id;
    },
    _rawBufferForSource(track, sourceId) {
      if (sourceId && track._rawBuffers && track._rawBuffers[sourceId]) return track._rawBuffers[sourceId];
      const primary = track.sources && track.sources[0];
      const primaryRaw = primary && track._rawBuffers ? track._rawBuffers[primary.id] : null;
      // A source still awaiting reopen hydration (needsAudio, e.g. a non-primary Take or the
      // shared loop-recording source) legitimately has no raw yet. Return null so the bake
      // SKIPS its clip (silence) until hydrateSource re-bakes — substituting the primary here
      // would briefly play the wrong Take — and stay quiet (this window is expected).
      const srcMeta = sourceId ? (track.sources || []).find(s => s.id === sourceId) : null;
      if (srcMeta && srcMeta.needsAudio) return null;
      // Only shout for the case that actually corrupts audio: a clip names a NON-primary
      // source (a real second take/consolidation), that source is missing, yet the primary
      // IS registered — so we would hand back the primary's audio in its place. Asking for
      // the primary and missing it (or missing everything) is not a substitution: the
      // caller gets null and falls back to track.buffer, which is the right raw. That
      // benign path is hit on every undo snapshot of a not-yet-baked track, and warning
      // there was pure noise (the false positive T-1.26.1-2 surfaced).
      if (sourceId && primary && sourceId !== primary.id && primaryRaw) {
        console.warn("[rawBuffer] source not registered — substituting primary audio",
          { track: track.id, sourceId, registered: Object.keys(track._rawBuffers || {}) });
      }
      return primaryRaw || null;
    },
    _sourceDuration(track, sourceId) {
      const raw = this._rawBufferForSource(track, sourceId);
      if (raw) return raw.duration;
      const src = (track.sources || []).find(s => s.id === sourceId) || (track.sources && track.sources[0]);
      return (src && src.duration) || 0;
    },

    // A layout is "trivial" (needs no bake) when the raw buffer already satisfies
    // buffer-time == timeline-time: one clip at 0, no source offset, unity gain,
    // full source length, no per-clip params/automation. Matches the untouched
    // import/record case so existing projects stay byte-identical (no bake).
    _isTrivialLayout(track) {
      // Any track carrying more than one take is never trivial: the trivial fast-path
      // hands back the PRIMARY source's raw buffer as-is, but the live audio is the
      // ACTIVE take (which may be a non-primary source at a non-zero start). Force a bake
      // so track.buffer reflects the active lane, not Take A. Single-take/legacy tracks
      // fall through to the original test and keep byte-identical behavior.
      if ((track.takes || []).length > 1) return false;
      const clips = track.clips || [];
      if (clips.length !== 1) return false;
      const c = clips[0];
      const src = track.sources && track.sources[0];
      const dur = (src && src.duration) || (track.buffer && track.buffer.duration) || 0;
      const off = (c.sourceOffset != null ? c.sourceOffset : (c.offset || 0));
      return Math.abs(c.start || 0) < 1e-3
        && Math.abs(off) < 1e-3
        && Math.abs((c.gain == null ? 1 : c.gain) - 1) < 1e-4
        && !c.muted
        && Math.abs((c.duration || 0) - dur) < 2e-2
        && !c.params && !(c.automation && c.automation.length);
    },

    // Render clips[] into a fresh flattened AudioBuffer. Geometry + static clip.gain
    // + boundary micro-fade only; clip.params.volume / automation stay dynamic in
    // _buildCompositeCurve so they are not double-applied.
    _bakeTrackLayout(track) {
      if (!ctx) return null;
      this._captureRawBuffers(track);
      // Bake the ACTIVE take only (Stage 3 / Q3): inactive takes are preserved as data
      // but never mixed into the flattened buffer, so overlapping alternates don't sum.
      const clips = this._activeClips(track).filter(c => !c.muted && (c.duration || 0) > 0);
      const layoutEnd = clips.reduce((m, c) => Math.max(m, (c.start || 0) + (c.duration || 0)), 0);
      let sr = ctx.sampleRate, chCount = 2;
      const anyRaw = this._rawBufferForSource(track, clips[0] && clips[0].sourceId);
      if (anyRaw) { sr = anyRaw.sampleRate; chCount = anyRaw.numberOfChannels; }
      const length = Math.max(1, Math.ceil(layoutEnd * sr));
      const out = ctx.createBuffer(chCount, length, sr);
      for (const c of clips) {
        const raw = this._rawBufferForSource(track, c.sourceId);
        if (!raw) {
          // A source still flagged needsAudio is EXPECTED to be missing here: on reopen the
          // primary reconnect re-bakes before the extra Takes are hydrated (hydrateSource
          // re-bakes once each arrives). Only shout for a source that should already be loaded.
          const src = (track.sources || []).find(s => s.id === c.sourceId);
          if (!(src && src.needsAudio)) {
            console.warn("[bake] clip skipped — no raw buffer for source", { track: track.id, clip: c.id, sourceId: c.sourceId });
          }
          continue;
        }
        const gain = (c.gain == null ? 1 : c.gain);
        const srcStart = Math.max(0, Math.round((c.sourceOffset != null ? c.sourceOffset : (c.offset || 0)) * sr));
        const dstStart = Math.max(0, Math.round((c.start || 0) * sr));
        const n = Math.min(Math.round((c.duration || 0) * sr), raw.length - srcStart, length - dstStart);
        if (n <= 0) {
          // A clip baking to zero samples = it will vanish. Should not happen after the
          // undo/redo raw-buffer fix; if it recurs, these numbers pinpoint the cause.
          const usedPrimaryFallback = !(c.sourceId && track._rawBuffers && track._rawBuffers[c.sourceId]);
          console.warn("[bake] clip skipped — empty span (sourceOffset past raw end?)",
            { track: track.id, clip: c.id, sourceId: c.sourceId, sourceOffset: c.sourceOffset, duration: c.duration,
              rawDuration: raw.duration, srcStart, layoutLen: length, dstStart, usedPrimaryFallback });
          continue;
        }
        const fadeN = Math.min(Math.floor(this._MICRO_FADE * sr), Math.floor(n / 2));
        for (let ch = 0; ch < chCount; ch++) {
          const src = raw.getChannelData(Math.min(ch, raw.numberOfChannels - 1));
          const dst = out.getChannelData(ch);
          for (let i = 0; i < n; i++) {
            let g = gain;
            if (fadeN > 0) {
              if (i < fadeN) g *= i / fadeN;
              else if (i >= n - fadeN) g *= (n - i) / fadeN;
            }
            dst[dstStart + i] += src[srcStart + i] * g;
          }
        }
      }
      return out;
    },

    // Sync t.buffer to clips[]: bake when non-trivial, else restore raw. Refreshes
    // peaks/audioRev and, if playing, restarts the track's live source.
    _ensureBaked(track) {
      if (!track) return;
      this._captureRawBuffers(track);
      if (this._isTrivialLayout(track)) {
        const primary = track.sources && track.sources[0];
        const raw = primary && track._rawBuffers ? track._rawBuffers[primary.id] : null;
        if (raw && track.buffer !== raw) track.buffer = raw;
        // Raw buffer is source-indexed: the Waveform samples peaks by clip.offset.
        track._layoutBaked = false;
      } else {
        const baked = this._bakeTrackLayout(track);
        // Baked buffer is TIMELINE-indexed (clip audio placed at clip.start), so the
        // Waveform must sample its peaks by timeline position, not clip.offset.
        if (baked) { track.buffer = baked; track._layoutBaked = true; }
      }
      if (track.buffer) {
        const pk = computePeakLevels(track.buffer);
        track.peaks = pk.fine; track.peaksMedium = pk.medium; track.peaksCoarse = pk.coarse;
        track.peakAmp = maxAbsPeak(pk.coarse);
      }
      track.audioRev = (track.audioRev || 0) + 1;
      // Recompute exactly (not Math.max) so moving/trimming a clip earlier lets the
      // ruler shrink back; _projectClipDuration keeps the DURATION floor + other tracks.
      this.duration = this._projectClipDuration();
      if (this.isPlaying) { this._startHotAddedTrack(track); this._scheduleAutomation(); }
    },

    // Positional clip edits are allowed only on Audio In / Bounce tracks. File
    // tracks stay locked to 0 (작업원칙 2).
    _clipEditable(track) {
      return !!track && !track.lockedToZero && (track.kind === "audioIn" || track.kind === "bounce");
    },
    _reindexClips(track) {
      track.clips.sort((a, b) => (a.start || 0) - (b.start || 0));
      // Enforce the "no overlap within a track" invariant: any clip that starts before
      // the previous clip ends is pushed right to clear it (forward pass keeps order &
      // cascades). Self-heals coincident/overlapping clips left by older buggy pastes
      // so they can't persist as an uneditable empty clip. Zero-duration placeholders
      // (start==end) are inert here.
      // The no-overlap invariant is per-LANE: only the active take's clips must not
      // collide. Inactive takes are alternates for the same time span and are expected to
      // overlap the active lane, so they are skipped here (Q3 — 겹침 판정 활성 레인 한정).
      let prevEnd = 0;
      for (const c of track.clips) {
        if (!this._isActiveClip(track, c)) continue;
        const dur = c.duration || 0;
        if (dur > 0 && (c.start || 0) < prevEnd - 1e-6) {
          c.start = prevEnd; c.end = prevEnd + dur;
        }
        prevEnd = Math.max(prevEnd, (c.start || 0) + dur);
      }
      track.clips = track.clips.map(c => this._normalizeClip(c, c.sourceId, this._sourceDuration(track, c.sourceId)));
    },
    // Overlap clamp: nudge a proposed start so [s, s+dur) clears every sibling.
    // On any overlap we push RIGHT to that clip's end and re-scan until a whole pass
    // is clear. s only grows, so this always converges. (The old single greedy pass
    // with a left/right tie-break could land s exactly on an already-checked sibling
    // — e.g. a 2nd paste at the same playhead — creating a fully-overlapping clip.)
    _clampStartNoOverlap(track, clipId, start, dur) {
      let s = Math.max(0, start);
      const others = track.clips.filter(c => c.id !== clipId && this._isActiveClip(track, c)).sort((a, b) => a.start - b.start);
      let moved = true, guard = 0;
      while (moved && guard++ <= others.length) {
        moved = false;
        for (const o of others) {
          const oS = o.start, oE = o.start + o.duration;
          if (s < oE && s + dur > oS) { s = oE; moved = true; }
        }
      }
      return Math.max(0, s);
    },

    // Drag-drop placement (moveClip): resolve a proposed start against siblings using a
    // LOCAL directional snap, and reject (return null) when the intended slot won't fit —
    // the caller then keeps the clip at its origin (snap back), rather than teleporting it
    // past a neighbour.
    //  - end intrudes a clip (start free)  → snap BEFORE it   (user clip end butts its start)
    //  - start intrudes a clip (end free)  → snap AFTER it    (user clip start butts its end)
    //  - both / fully envelops             → snap to the nearer side
    //  - that single directional slot isn't free → null → snap back.
    // (paste/duplicate keep _clampStartNoOverlap's "always push right" behavior.)
    _resolveMovePosition(track, clipId, start, dur) {
      const s0 = Math.max(0, start);
      const clips = (track.clips || []).filter(c => c.id !== clipId && (c.duration || 0) > 0 && this._isActiveClip(track, c));
      const free = (pos) => pos >= -1e-6 && !clips.some(o => {
        const oS = o.start, oE = o.start + o.duration;
        return pos < oE - 1e-6 && pos + dur > oS + 1e-6;
      });
      if (free(s0)) return s0;
      const uE = s0 + dur;
      const overlaps = clips.filter(o => s0 < o.start + o.duration && uE > o.start);
      if (!overlaps.length) return s0;
      const startInside = overlaps.some(o => o.start <= s0 && s0 < o.start + o.duration);
      const endInside   = overlaps.some(o => o.start < uE && uE <= o.start + o.duration);
      let leftStart = Infinity, rightEnd = -Infinity;
      for (const o of overlaps) { leftStart = Math.min(leftStart, o.start); rightEnd = Math.max(rightEnd, o.start + o.duration); }
      const candL = leftStart - dur;   // user clip's END butts the leftmost overlap's start
      const candR = rightEnd;          // user clip's START butts the rightmost overlap's end
      let cand;
      if (endInside && !startInside) cand = candL;       // end intruded → before
      else if (startInside && !endInside) cand = candR;  // start intruded → after
      else cand = (Math.abs(candL - s0) <= Math.abs(candR - s0)) ? candL : candR; // envelop → nearer
      if (cand >= -1e-6 && free(Math.max(0, cand))) return Math.max(0, cand);
      return null; // intended slot blocked → snap back to origin
    },

    // Incremental move (arrow-key nudge): clamp c.start+delta to the free range between
    // its immediate neighbors — butts against a neighbor and blocks (no jump-over, unlike
    // drop placement). Returns the clamped start.
    _clampNudgeStart(track, c, delta) {
      const dur = c.duration || 0;
      let lo = 0, hi = Infinity;
      for (const o of (track.clips || [])) {
        if (o.id === c.id || (o.duration || 0) <= 0 || !this._isActiveClip(track, o)) continue;
        const oS = o.start, oE = o.start + o.duration;
        if (oE <= c.start + 1e-6) lo = Math.max(lo, oE);          // neighbor to the left
        else if (oS >= c.end - 1e-6) hi = Math.min(hi, oS - dur); // neighbor to the right
      }
      let s = c.start + delta;
      if (s > hi) s = hi;
      if (s < lo) s = lo;
      return Math.max(0, s);
    },

    // Rigid group move (v1.22.0): every selected clip shifts by ONE shared delta, so their
    // spacing is preserved. The delta is clamped to the TIGHTEST constraint among them —
    // if one clip butts a neighbour, the whole group stops. Clips inside the selection
    // never block each other (only non-selected clips are obstacles), which is what makes
    // a run of adjacent selected clips movable at all. Returns the clamped delta.
    _clampGroupDelta(track, clipIds, delta) {
      const sel = new Set(clipIds || []);
      const picked = (track.clips || []).filter(c => sel.has(c.id) && (c.duration || 0) > 0);
      if (!picked.length) return 0;
      const others = (track.clips || []).filter(c => !sel.has(c.id) && (c.duration || 0) > 0 && this._isActiveClip(track, c));
      let dMin = -Infinity, dMax = Infinity;
      for (const c of picked) {
        const cS = c.start, cE = c.start + (c.duration || 0);
        let lo = 0, hi = Infinity;   // lo = earliest free start (0 = timeline head)
        for (const o of others) {
          const oS = o.start, oE = o.start + o.duration;
          if (oE <= cS + 1e-6) lo = Math.max(lo, oE);              // blocker on the left
          else if (oS >= cE - 1e-6) hi = Math.min(hi, oS - (c.duration || 0)); // on the right
        }
        dMin = Math.max(dMin, lo - cS);
        dMax = Math.min(dMax, hi - cS);
      }
      let d = delta;
      if (d > dMax) d = dMax;
      if (d < dMin) d = dMin;
      return Number.isFinite(d) ? d : 0;
    },

    // Rigid group DROP placement (drag) — the group analogue of _resolveMovePosition. Lets
    // the whole selection JUMP a non-selected neighbour (land before it / after it) instead
    // of butting against it, so a middle run (B-C of A-B-C-D) can be dragged ahead of A or
    // past D, exactly as a single clip can. _clampGroupDelta (butt, no jump) stays for the
    // arrow-key nudge, matching the single-clip nudge which also does not jump. Returns the
    // resolved shared delta, or null if neither side fits (drag snaps back to origin).
    _resolveGroupDelta(track, clipIds, delta) {
      const sel = new Set(clipIds || []);
      const picked = (track.clips || []).filter(c => sel.has(c.id) && (c.duration || 0) > 0);
      if (!picked.length) return 0;
      const others = (track.clips || []).filter(c => !sel.has(c.id) && (c.duration || 0) > 0 && this._isActiveClip(track, c));
      const gMinStart = Math.min(...picked.map(c => c.start));
      const gMaxEnd = Math.max(...picked.map(c => c.start + (c.duration || 0)));
      // The whole group shifted by d clears every non-selected clip and stays at/after 0.
      const freeAt = (d) => {
        if (gMinStart + d < -1e-6) return false;
        for (const c of picked) {
          const cS = c.start + d, cE = c.start + (c.duration || 0) + d;
          for (const o of others) {
            if (cS < o.start + o.duration - 1e-6 && cE > o.start + 1e-6) return false;
          }
        }
        return true;
      };
      // Pin the group to the timeline head when the drag overshoots before 0 — mirrors
      // _resolveMovePosition's `s0 = max(0, start)`. Without this, dragging the group well
      // past A lands it in negative space where it no longer overlaps A, so the jump logic
      // below sees no obstacle and wrongly reports "blocked" instead of parking before A.
      const d0 = Math.max(delta, -gMinStart);
      if (freeAt(d0)) return d0;
      // Non-selected clips the group would overlap at the pinned delta.
      const hit = others.filter(o => picked.some(c =>
        (c.start + d0) < o.start + o.duration - 1e-6 && (c.start + (c.duration || 0) + d0) > o.start + 1e-6));
      if (!hit.length) return null;
      let leftStart = Infinity, rightEnd = -Infinity;
      for (const o of hit) { leftStart = Math.min(leftStart, o.start); rightEnd = Math.max(rightEnd, o.start + o.duration); }
      const candL = leftStart - gMaxEnd;   // group's RIGHT edge butts the leftmost obstacle → jump BEFORE
      const candR = rightEnd - gMinStart;  // group's LEFT edge butts the rightmost obstacle → jump AFTER
      const startInside = hit.some(o => o.start <= gMinStart + d0 && gMinStart + d0 < o.start + o.duration);
      const endInside   = hit.some(o => o.start < gMaxEnd + d0 && gMaxEnd + d0 <= o.start + o.duration);
      let cand;
      if (endInside && !startInside) cand = candL;       // group's leading edge intruded → go before
      else if (startInside && !endInside) cand = candR;  // trailing edge intruded → go after
      else cand = (Math.abs(candL - d0) <= Math.abs(candR - d0)) ? candL : candR; // envelop → nearer
      if (freeAt(cand)) return cand;
      const alt = (cand === candL) ? candR : candL;      // first choice blocked → try the other side
      if (freeAt(alt)) return alt;
      return null;
    },

    // Drag commit for a 2+ clip selection: jump-capable (see _resolveGroupDelta). The nudge
    // path uses moveClipsBy (butt/clamp) instead. Returns the delta applied (0 = blocked).
    moveClipsByResolved(trackId, clipIds, deltaSec) {
      const t = this.tracks.find(x => x.id === trackId); if (!this._clipEditable(t)) return 0;
      const ids = (clipIds || []).filter(id => t.clips.some(c => c.id === id));
      if (!ids.length) return 0;
      const d = this._resolveGroupDelta(t, ids, deltaSec);
      if (d == null || Math.abs(d) < 1e-6) return 0;
      const sel = new Set(ids);
      for (const c of t.clips) {
        if (!sel.has(c.id)) continue;
        c.start += d; c.end = c.start + (c.duration || 0);
      }
      this._shiftInactiveTakeClips(t, d);
      this._reindexClips(t);
      this._ensureBaked(t);
      return d;
    },

    // Apply a rigid group move. Used by both the arrow-key nudge and the drag commit when
    // 2+ clips are selected. Returns the delta actually applied (0 = fully blocked).
    moveClipsBy(trackId, clipIds, deltaSec) {
      const t = this.tracks.find(x => x.id === trackId); if (!this._clipEditable(t)) return 0;
      const ids = (clipIds || []).filter(id => t.clips.some(c => c.id === id));
      if (!ids.length) return 0;
      const d = this._clampGroupDelta(t, ids, deltaSec);
      if (Math.abs(d) < 1e-6) return 0;
      const sel = new Set(ids);
      for (const c of t.clips) {
        if (!sel.has(c.id)) continue;
        c.start += d; c.end = c.start + (c.duration || 0);
      }
      this._shiftInactiveTakeClips(t, d);
      this._reindexClips(t);
      this._ensureBaked(t);
      return d;
    },

    // Delete several clips in one pass (one undo step at the caller).
    deleteClips(trackId, clipIds) {
      const t = this.tracks.find(x => x.id === trackId); if (!this._clipEditable(t)) return false;
      const sel = new Set(clipIds || []);
      if (!t.clips.some(c => sel.has(c.id))) return false;
      t.clips = t.clips.filter(c => !sel.has(c.id));
      if (!t.clips.length) { // keep at least an empty placeholder clip
        const sid = (t.sources && t.sources[0] && t.sources[0].id) || null;
        t.clips = [this._normalizeClip({ start: 0, end: 0, offset: 0, duration: 0 }, sid, 0)];
      }
      this._ensureBaked(t);
      return true;
    },

    // Comp move (Stage 4, Q: "all takes move together"): the visible/editable clip is always
    // the ACTIVE Take's; when it moves, the INACTIVE Takes' clips ride along by the same delta
    // so the alternates stay aligned as one region. Only inactive Takes shift here — the active
    // move itself is applied by the caller, and null-takeId clips (shared) stay put.
    _shiftInactiveTakeClips(track, delta) {
      if (!delta || Math.abs(delta) < 1e-9) return;
      const act = this._activeTakeId(track);
      if (!act) return;
      for (const c of track.clips) {
        if (c.takeId && c.takeId !== act) {
          c.start = Math.max(0, (c.start || 0) + delta);
          c.end = c.start + (c.duration || 0);
        }
      }
    },

    moveClip(trackId, clipId, newStart) {
      const t = this.tracks.find(x => x.id === trackId); if (!this._clipEditable(t)) return false;
      const c = t.clips.find(x => x.id === clipId); if (!c) return false;
      const s = this._resolveMovePosition(t, clipId, newStart, c.duration);
      if (s == null || Math.abs(s - c.start) < 1e-6) return false; // no valid/effective slot → keep origin
      const delta = s - c.start;
      c.start = s; c.end = s + c.duration;
      this._shiftInactiveTakeClips(t, delta);
      this._reindexClips(t);
      this._ensureBaked(t);
      return true;
    },

    // Move the selected clip by a small time delta (arrow-key precise nudge), butting
    // against neighbors. Returns true only if the clip actually moved.
    nudgeClip(trackId, clipId, deltaSec) {
      const t = this.tracks.find(x => x.id === trackId); if (!this._clipEditable(t)) return false;
      const c = t.clips.find(x => x.id === clipId); if (!c) return false;
      const s = this._clampNudgeStart(t, c, deltaSec);
      if (Math.abs(s - c.start) < 1e-6) return false;
      const delta = s - c.start;
      c.start = s; c.end = s + (c.duration || 0);
      this._shiftInactiveTakeClips(t, delta);
      this._reindexClips(t);
      this._ensureBaked(t);
      return true;
    },

    // Move a clip's left edge, keeping its audio anchored (adjusts sourceOffset).
    trimClipStart(trackId, clipId, newStart) {
      const t = this.tracks.find(x => x.id === trackId); if (!this._clipEditable(t)) return false;
      const c = t.clips.find(x => x.id === clipId); if (!c) return false;
      const curOff = (c.sourceOffset != null ? c.sourceOffset : (c.offset || 0));
      const minStart = c.start - curOff;                 // can't reveal audio before source 0
      const maxStart = c.end - this._MIN_CLIP;
      const s = Math.min(Math.max(newStart, minStart, 0), maxStart);
      const delta = s - c.start;
      c.sourceOffset = curOff + delta; c.offset = c.sourceOffset;
      c.start = s; c.duration = c.end - s;
      this._reindexClips(t);
      this._ensureBaked(t);
      return true;
    },

    // Move a clip's right edge (bounded by available source audio).
    trimClipEnd(trackId, clipId, newEnd) {
      const t = this.tracks.find(x => x.id === trackId); if (!this._clipEditable(t)) return false;
      const c = t.clips.find(x => x.id === clipId); if (!c) return false;
      const curOff = (c.sourceOffset != null ? c.sourceOffset : (c.offset || 0));
      const srcDur = this._sourceDuration(t, c.sourceId);
      const maxEnd = c.start + Math.max(this._MIN_CLIP, srcDur - curOff);
      const e = Math.min(Math.max(newEnd, c.start + this._MIN_CLIP), maxEnd);
      c.end = e; c.duration = e - c.start;
      this._reindexClips(t);
      this._ensureBaked(t);
      return true;
    },

    deleteClip(trackId, clipId) {
      const t = this.tracks.find(x => x.id === trackId); if (!this._clipEditable(t)) return false;
      if (!t.clips.some(c => c.id === clipId)) return false;
      t.clips = t.clips.filter(c => c.id !== clipId);
      if (!t.clips.length) { // keep at least an empty placeholder clip
        const sid = (t.sources && t.sources[0] && t.sources[0].id) || null;
        t.clips = [this._normalizeClip({ start: 0, end: 0, offset: 0, duration: 0 }, sid, 0)];
      }
      this._ensureBaked(t);
      return true;
    },

    // Empty [from, to) on a track: fully-covered clips removed, edges trimmed, a
    // spanning clip split in two. Reused by Phase 6 Punch Recording (place a new
    // clip in the emptied range).
    deleteRange(trackId, from, to) {
      const t = this.tracks.find(x => x.id === trackId); if (!this._clipEditable(t)) return false;
      if (!(to > from)) return false;
      const next = [];
      for (const c of t.clips) {
        const cS = c.start, cE = c.start + c.duration;
        if (cE <= from || cS >= to) { next.push(c); continue; }        // untouched
        if (cS >= from && cE <= to) continue;                          // fully removed
        const curOff = (c.sourceOffset != null ? c.sourceOffset : (c.offset || 0));
        if (cS < from && cE > to) {                                    // spanning → split
          next.push(this._normalizeClip({ ...c, id: this._cid(), start: cS, end: from, duration: from - cS, sourceOffset: curOff, offset: curOff }, c.sourceId, 0));
          const rOff = curOff + (to - cS);
          next.push(this._normalizeClip({ ...c, id: this._cid(), start: to, end: cE, duration: cE - to, sourceOffset: rOff, offset: rOff, params: null, automation: null }, c.sourceId, 0));
        } else if (cS < from) {                                        // trim right edge
          next.push(this._normalizeClip({ ...c, start: cS, end: from, duration: from - cS }, c.sourceId, 0));
        } else {                                                       // trim left edge
          const nOff = curOff + (to - cS);
          next.push(this._normalizeClip({ ...c, start: to, end: cE, duration: cE - to, sourceOffset: nOff, offset: nOff }, c.sourceId, 0));
        }
      }
      t.clips = next.length ? next : [this._normalizeClip({ start: 0, end: 0, offset: 0, duration: 0 }, (t.sources && t.sources[0] && t.sources[0].id) || null, 0)];
      this._reindexClips(t);
      this._ensureBaked(t);
      return true;
    },

    // Non-destructive: a duplicate references the same source at a new timeline slot.
    duplicateClip(trackId, clipId, atStart = null) {
      const t = this.tracks.find(x => x.id === trackId); if (!this._clipEditable(t)) return false;
      const c = t.clips.find(x => x.id === clipId); if (!c) return false;
      const start = this._clampStartNoOverlap(t, null, atStart == null ? c.end : atStart, c.duration);
      const copy = this._normalizeClip({ ...c, id: this._cid(), start, end: start + c.duration,
        params: c.params ? { ...c.params } : null, automation: c.automation ? c.automation.map(p => ({ ...p })) : null },
        c.sourceId, 0);
      t.clips = [...t.clips, copy];
      this._reindexClips(t);
      this._ensureBaked(t);
      return copy.id;
    },

    // Clipboard stores a clip descriptor plus its raw source buffer, so paste works
    // across tracks (referenced source travels with it).
    copyClip(trackId, clipId) {
      const t = this.tracks.find(x => x.id === trackId); if (!t) return false;
      const c = t.clips.find(x => x.id === clipId); if (!c) return false;
      this._captureRawBuffers(t);
      this._clipboard = {
        clip: { ...c, id: null, params: c.params ? { ...c.params } : null, automation: c.automation ? c.automation.map(p => ({ ...p })) : null },
        sourceId: c.sourceId,
        rawBuffer: this._rawBufferForSource(t, c.sourceId),
        sourceMeta: (t.sources || []).find(s => s.id === c.sourceId) || null,
      };
      return true;
    },
    pasteClip(trackId, atStart = 0) {
      const cb = this._clipboard; if (!cb) return false;
      const t = this.tracks.find(x => x.id === trackId); if (!this._clipEditable(t)) return false;
      // ensure the target track can resolve the clip's source buffer
      let sid = cb.sourceId;
      if (cb.rawBuffer) {
        const hasSource = (t.sources || []).some(s => s.id === sid);
        if (!hasSource && cb.sourceMeta) t.sources = [...(t.sources || []), { ...cb.sourceMeta }];
        this._captureRawBuffers(t);
        t._rawBuffers = t._rawBuffers || {};
        if (!t._rawBuffers[sid]) t._rawBuffers[sid] = cb.rawBuffer;
      }
      const dur = cb.clip.duration || 0;
      const start = this._clampStartNoOverlap(t, null, atStart, dur);
      const clip = this._normalizeClip({ ...cb.clip, id: this._cid(), start, end: start + dur }, sid, 0);
      t.clips = [...t.clips, clip];
      this._reindexClips(t);
      this._ensureBaked(t);
      return clip.id;
    },

    _buildCompositeCurve(track, n) {
      const dur = this.duration;
      const curve = new Float32Array(n);
      const curved = !!track.params.autoCurve;
      // one sampler per clip (linear or monotone-cubic), built lazily and reused
      const samplerCache = new Map();
      const samplerFor = (clip) => {
        if (samplerCache.has(clip)) return samplerCache.get(clip);
        const autoSrc = clip.automation || (track.params.autoOn ? track.params.automation : null);
        const s = (autoSrc && autoSrc.length >= 2) ? makeAutoSampler(autoSrc, curved) : null;
        samplerCache.set(clip, s);
        return s;
      };
      // Only the active take is baked/played, so per-clip volume/automation must be read
      // from the active lane — an inactive alternate overlapping this position must not win.
      const liveClips = this._activeClips(track);
      for (let i = 0; i < n; i++) {
        const pos = (i / (n - 1)) * dur;
        const clip = liveClips.find(c => pos >= c.start && pos < c.end);
        if (!clip) { curve[i] = 0.0001; continue; }
        const clipDur = (clip.end - clip.start) || 1e-6;
        const localT = (pos - clip.start) / clipDur;
        let v = (clip.params && clip.params.volume !== undefined) ? clip.params.volume : 1;
        const sampler = samplerFor(clip);
        if (sampler) v *= sampler(localT);
        curve[i] = Math.max(0.0001, v);
      }
      return curve;
    },

    // averaged magnitude spectrum of the whole song (static FFT), cached
    computeSpectrum() {
      this.init();
      const key = this.tracks.length + ":" + this.duration.toFixed(2);
      if (this._spectrum && this._specKey === key) return this._spectrum;
      const sr = ctx.sampleRate, N = 2048;
      const total = Math.floor(this.duration * sr);
      const mono = new Float32Array(total);
      this.tracks.forEach((t) => {
        // Audio In tracks start with a null buffer (empty until recorded) and
        // reopened placeholders are needsAudio — skip both, or getChannelData(0)
        // on null throws and blanks the mixer window (which pulls the spectrum).
        if (!t.buffer || t.needsAudio) return;
        const ch = t.buffer.getChannelData(0);
        const m = Math.min(total, ch.length);
        for (let i = 0; i < m; i++) mono[i] += ch[i];
      });
      const win = new Float32Array(N);
      for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
      const mag = new Float32Array(N / 2);
      const totalFrames = Math.max(1, Math.floor((total - N) / N));
      const stride = Math.max(1, Math.floor(totalFrames / 200));
      let count = 0;
      for (let f = 0; f + N <= total; f += N * stride) {
        const re = new Float32Array(N), im = new Float32Array(N);
        for (let i = 0; i < N; i++) re[i] = mono[f + i] * win[i];
        fft(re, im);
        for (let i = 0; i < N / 2; i++) mag[i] += Math.hypot(re[i], im[i]);
        count++;
      }
      for (let i = 0; i < N / 2; i++) mag[i] /= Math.max(1, count);
      const fmin = 30, fmax = Math.min(20000, sr / 2), P = 150, pts = [];
      let mn = Infinity, mx = -Infinity;
      for (let p = 0; p < P; p++) {
        const fr = fmin * Math.pow(fmax / fmin, p / (P - 1));
        const bin = Math.min(N / 2 - 1, Math.max(1, Math.round(fr / (sr / N))));
        const db = 20 * Math.log10(mag[bin] + 1e-6);
        pts.push({ f: fr, db });
        mn = Math.min(mn, db); mx = Math.max(mx, db);
      }
      pts.forEach((p) => (p.n = (p.db - mn) / Math.max(1e-6, mx - mn)));
      this._spectrum = pts; this._specKey = key;
      return pts;
    },

    // debounced reschedule for high-frequency edits (drag); ~50ms coalescing window
    _scheduleAutomationSoon() {
      clearTimeout(this._autoSchedTimer);
      this._autoSchedTimer = setTimeout(() => {
        this._autoSchedTimer = null;
        if (this.isPlaying) this._scheduleAutomation();
      }, 50);
    },

    _scheduleAutomation() {
      clearTimeout(this._autoSchedTimer); this._autoSchedTimer = null; // supersede any pending debounce
      const now = ctx.currentTime;
      // When the native engine is the audible output the web graph is muted
      // (masterOutputGain=0), so this per-track curve scheduling is INAUDIBLE — and it is
      // the crash source: it pre-schedules 64 loops of setValueCurveAtTime, and a gap-track
      // curve (audioIn's leading silence) scheduled as playback starts near the song end
      // trips a Chromium Web Audio CHECK, hard-crashing the renderer (exit 0x80000003, no JS
      // error). Native applies automation itself (sendTrackAutomationToNative), so skip it
      // while muted: park each autoGain neutral and clear pending events. (_startHotAddedTrack
      // gates on _outputMuted the same way.)
      if (this._outputMuted) {
        this.tracks.forEach((t) => { const g = t.nodes.autoGain.gain; g.cancelScheduledValues(now); g.setValueAtTime(1, now); });
        return;
      }
      const dur = this.duration;
      const loops = 64;
      this.tracks.forEach((t) => {
        const g = t.nodes.autoGain.gain;
        g.cancelScheduledValues(now);
        const hasGaps = t.clips && (t.clips.length > 1 || (t.clips[0] && (t.clips[0].start > 0.01 || t.clips[0].end < this.duration - 0.01)));
        const hasClipOverrides = t.clips && t.clips.some(c => c.params || c.automation);
        if (!t.params.autoOn && !hasGaps && !hasClipOverrides) { g.setValueAtTime(1, now); return; }
        const curve = (hasGaps || hasClipOverrides)
          ? this._buildCompositeCurve(t, 256)
          : buildAutoCurve(t, 256);
        // current playhead position within the loop
        const rate = this._activePlaybackRate();
        const pos = this._projectPositionAt(now, rate) % dur;
        const base = now - (pos / rate);      // audio time of loop start (pos = 0)
        const startT = now + 0.001;
        // current (partial) loop: slice the curve from `pos` so it stays aligned 1:1
        // with the audio (instead of cramming the whole loop into the remaining time).
        const partial = sliceCurveFrom(curve, pos / dur);
        const remain = (base + (dur / rate)) - startT; // ends exactly at the next loop boundary
        try {
          if (remain > 0.002 && partial.length >= 2) g.setValueCurveAtTime(partial, startT, remain);
          else g.setValueAtTime(curve[curve.length - 1], startT);
        } catch (e) {
          try { g.setValueAtTime(partial[0], startT); } catch (e2) {}
        }
        // subsequent full loops, back-to-back and aligned to audio loop boundaries
        for (let l = 1; l <= loops; l++) {
          const tstart = base + l * (dur / rate);
          if (tstart < now) continue;
          try { g.setValueCurveAtTime(curve, tstart, dur / rate); } catch (e) {}
        }
      });
    },

    _scheduleFade() {
      const g = masterFade.gain;
      const now = ctx.currentTime;
      // Inaudible while native drives the output (native does its own master fade). Skip the
      // 64-loop ramp pre-scheduling for the same CHECK-crash reason as _scheduleAutomation.
      if (this._outputMuted) { g.cancelScheduledValues(now); g.setValueAtTime(1, now); return; }
      const dur = this.duration;
      const fi = Math.min(this.master.fadeIn, dur / 2);
      const fo = Math.min(this.master.fadeOut, dur / 2);
      const rate = this._activePlaybackRate();
      const pos = this._projectPositionAt(now, rate) % dur;
      g.cancelScheduledValues(now);
      const base = now - (pos / rate);
      g.setValueAtTime(fadeVal(pos, dur, fi, fo), now);
      // ramp through the rest of this loop
      const steps = 48;
      for (let i = 1; i <= steps; i++) {
        const lp = (i / steps) * dur;
        if (lp <= pos) continue;
        g.linearRampToValueAtTime(fadeVal(lp, dur, fi, fo), base + (lp / rate));
      }
      // Schedule the same fade envelope for subsequent loop passes.
      const loops = 64;
      for (let loop = 1; loop <= loops; loop++) {
        const loopStart = base + loop * (dur / rate);
        g.setValueAtTime(fadeVal(0, dur, fi, fo), loopStart);
        for (let i = 1; i <= steps; i++) {
          const lp = (i / steps) * dur;
          g.linearRampToValueAtTime(
            fadeVal(lp, dur, fi, fo),
            loopStart + (lp / rate)
          );
        }
      }
    },

    setLoop(val) { this.loopEnabled = !!val; },

    // Mute/un-mute the audible web-audio output WITHOUT touching master.volume state.
    // The audio bridge calls this when the native JUCE engine connects/disconnects:
    // while native is the active output the web engine is muted to prevent double
    // playback; on fallback to local it is un-muted so the web engine is audible again.
    setOutputMuted(muted) {
      const wasMuted = this._outputMuted;
      this._outputMuted = !!muted;
      if (!ctx || !masterOutputGain) return;
      ramp(masterOutputGain.gain, this._outputMuted ? 0 : 1);
      // Un-muting mid-playback (native crash → switchToLocal safety net): automation/fade
      // were skipped while muted, so the web output would be flat until the next play.
      // Reschedule now so the fallback is audible with correct envelopes.
      if (wasMuted && !this._outputMuted && this.isPlaying) {
        this._scheduleAutomation();
        this._scheduleFade();
      }
    },

    async play(options = {}) {
      this.init();
      if (ctx.state === "suspended") ctx.resume();
      if (this.isPlaying) return;
      if (this.repeatPlayEnabled && this.loopRange) {
        if (this._offset < this.loopRange.start || this._offset > this.loopRange.end) {
          this._offset = this.loopRange.start;
        }
      }
      const token = ++this._playToken;
      const requestedRate = this._projectRate();
      if (this._shouldUseRealtimeStretch(requestedRate)) {
        await this._prepareRealtimeStretch(requestedRate);
        if (token !== this._playToken || this.isPlaying) return;
      }
      if (this._fallbackKeyShiftSemis() !== 0) {
        await this._prepareKeyShift(requestedRate);
        if (token !== this._playToken || this.isPlaying) return;
      }
      const now = ctx.currentTime + 0.02;
      this._startTime = now;
      this._sources = [];
      this._appliedRate = this._projectRate(); // 현재 재생에 적용된 전역 템포 rate (재시작 판단용)
      this.tracks.forEach((t) => {
        const src = ctx.createBufferSource();
        const rate = this._trackPlaybackRate(t);
        const sourceBuffer = this._playbackBufferForTrack(t, rate);
        const usingStretchPreview = sourceBuffer !== t.buffer;
        src.buffer = sourceBuffer;
        try { src.playbackRate.value = rate; } catch (e) {}
        if (usingStretchPreview) {
          try { src.playbackRate.value = 1; } catch (e) {}
        }
        // Repeat is controlled by the engine at the song boundary so toggling
        // the button during playback does not require rebuilding live sources.
        src.loop = false;
        src.connect(t.nodes.fader);
        src.start(now, this._sourceOffsetForTrack(t, sourceBuffer, rate));
        t._liveSource = src; // so removeTrack() can stop just this track mid-playback
        this._sources.push(src);
      });
      this.isPlaying = true;
      this._scheduleAutomation();
      if (options.skipFade) {
        try {
          masterFade.gain.cancelScheduledValues(ctx.currentTime);
          masterFade.gain.setValueAtTime(1, ctx.currentTime);
        } catch (e) {}
      } else {
        this._scheduleFade();
      }
      // Tag this rAF loop with the play token so a later play/seek/stop (each bumps
      // _playToken) retires it. Without the tag, seek-while-playing (stop→play) leaves the
      // previous loop's already-scheduled rAF alive — it re-checks only isPlaying, which
      // the new play has set true again — so every such seek accretes another concurrent
      // _loop chain. They pile up, each firing _emit() (a full React re-render) per frame,
      // until the renderer saturates and the window goes black.
      this._loop(this._playToken);
    },

    pause() {
      if (!ctx || !this.isPlaying) return;
      this._playToken++;
      clearTimeout(this._tempoRestartTimer);
      this._tempoRestartTimer = null;
      clearTimeout(this._keyRestartTimer);
      this._keyRestartTimer = null;
      this._stretchPreviewPreparing = false;
      this._offset = this.getPlayhead();
      this._stopSources();
      this.isPlaying = false;
    },

    stop() {
      this._playToken++;
      clearTimeout(this._tempoRestartTimer);
      this._tempoRestartTimer = null;
      clearTimeout(this._keyRestartTimer);
      this._keyRestartTimer = null;
      this._stretchPreviewPreparing = false;
      if (this.repeatPlayEnabled && this.loopRange) {
        this._offset = this.loopRange.start;
      } else {
        this._offset = 0;
      }
      if (ctx) this._stopSources();
      this.isPlaying = false;
      this._emit();
    },

    _stopSources() {
      clearTimeout(this._autoSchedTimer); this._autoSchedTimer = null;
      this._sources.forEach((s) => { try { s.stop(); } catch (e) {} });
      this._sources = [];
      this.tracks.forEach((t) => { t._liveSource = null; });
    },

    seek(t) {
      this._offset = Math.max(0, Math.min(t, this.duration));
      if (this.isPlaying) { this._stopSources(); this.isPlaying = false; this.play(); }
      else this._emit();
    },

    getPlayhead() {
      if (!ctx) return this._offset;
      if (!this.isPlaying) return this._offset;
      const raw = this._projectPositionAt(ctx.currentTime);
      return this.loopEnabled ? raw % this.duration : Math.min(raw, this.duration);
    },

    getTrackLevel(id) {
      const t = this.tracks.find((x) => x.id === id);
      if (!t || !ctx) return 0;
      const buf = t._meterBuf;
      t.nodes.meter.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      return Math.min(1, Math.sqrt(sum / buf.length) * 2.2);
    },

    getMasterLevel() {
      if (!ctx) return 0;
      const buf = new Float32Array(masterAnalyser.fftSize);
      masterAnalyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      return Math.min(1, Math.sqrt(sum / buf.length) * 2.0);
    },

    getMasterStereoLevels() {
      if (!ctx || !masterAnalyserL || !masterAnalyserR) {
        const m = this.getMasterLevel();
        return { l: m, r: m };
      }
      const rms = (an) => {
        const buf = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        return Math.min(1, Math.sqrt(sum / buf.length) * 2.0);
      };
      return { l: rms(masterAnalyserL), r: rms(masterAnalyserR) };
    },

    getMasterBandLevels() {
      if (!ctx || !masterAnalyser) return EQ_FREQS.map(() => 0);
      const bins = new Uint8Array(masterAnalyser.frequencyBinCount);
      masterAnalyser.getByteFrequencyData(bins);
      const nyquist = ctx.sampleRate / 2;
      const bounds = EQ_FREQS.map((f, i) => {
        const lo = i === 0 ? 30 : Math.sqrt(EQ_FREQS[i - 1] * f);
        const hi = i === EQ_FREQS.length - 1 ? nyquist : Math.sqrt(f * EQ_FREQS[i + 1]);
        return [lo, hi];
      });
      return bounds.map(([lo, hi], i) => {
        const a = Math.max(0, Math.floor((lo / nyquist) * bins.length));
        const b = Math.min(bins.length - 1, Math.ceil((hi / nyquist) * bins.length));
        let sum = 0, count = 0;
        for (let k = a; k <= b; k++) { sum += bins[k]; count++; }
        const shaped = Math.pow((sum / Math.max(1, count)) / 255, 0.72);
        return Math.max(0, Math.min(1, shaped + (this.master.bands[i] || 0) / 42));
      });
    },

    // Route the web engine's output to a specific device (settings UI). The native
    // engine picks its own device via JUCE; this keeps the pre-handover / fallback
    // web output on the same interface so sound doesn't jump between devices.
    // `label` is the device display name as the OS reports it ("" = system default).
    // AudioContext.setSinkId wants a Chromium deviceId, so match by label.
    async setOutputDevice(label) {
      this._outputDeviceLabel = label || "";
      if (!ctx || typeof ctx.setSinkId !== "function") return false;
      try {
        if (!this._outputDeviceLabel) { await ctx.setSinkId(""); return true; }
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outs = devices.filter((d) => d.kind === "audiooutput");
        const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
        const want = norm(this._outputDeviceLabel);
        const hit = outs.find((d) => norm(d.label) === want)
                 || outs.find((d) => norm(d.label).includes(want) || want.includes(norm(d.label)));
        if (!hit) return false;
        await ctx.setSinkId(hit.deviceId);
        return true;
      } catch (e) {
        console.warn("[audio-engine] setOutputDevice failed:", e);
        return false;
      }
    },

    onTick(cb) { this._tickCbs.push(cb); },
    _emit() { this._tickCbs.forEach((cb) => cb()); },
    _lastLoop: 0,
    _loop(token) {
      // Stale chain from a superseded play/seek/stop — let it die (see play()).
      if (!this.isPlaying || token !== this._playToken) return;
      // Source nodes are one-shot. At the song boundary the engine decides
      // whether to start a fresh pass or stop, using the latest Repeat state.
      const raw = this._projectPositionAt(ctx.currentTime);
      if (this.repeatPlayEnabled && this.loopRange) {
        if (raw >= this.loopRange.end) {
          this._offset = this.loopRange.start;
          this._stopSources();
          this.isPlaying = false;
          this.play({ skipFade: true });
          return;
        }
      }
      if (raw >= this.duration) {
        if (this.loopEnabled) {
          this._offset = 0;
          this._stopSources();
          this.isPlaying = false;
          this.play({ skipFade: true });
          return;
        }
        this.stop();
        return;
      }
      this._emit();
      requestAnimationFrame(() => this._loop(token));
    },

    // ---- offline render to WAV (for export) ----
    async renderMix(onProgress, options = {}) {
      this.init();
      const trackIds = Array.isArray(options.trackIds) ? options.trackIds.filter(Boolean) : null;
      const selectedTrackSet = trackIds && trackIds.length ? new Set(trackIds) : null;
      const tracksForRender = selectedTrackSet
        ? this.tracks.filter((t) => selectedTrackSet.has(t.id))
        : this.tracks;
      // Render at the requested target sample rate (export dialog), not the system
      // device rate. Source buffers are auto-resampled by OfflineAudioContext.
      const reqSr = options.sampleRate || ctx.sampleRate;
      const sr = Math.max(8000, Math.min(192000, reqSr));
      const renderRate = options.applyTempo === false ? 1 : this._projectRate();
      const preservePitch = !!options.preservePitch && Math.abs(renderRate - 1) > 0.001;
      const graphRate = preservePitch ? 1 : renderRate;
      const renderDuration = this.duration / graphRate;
      const targetDuration = this.duration / renderRate;
      const hasRenderRange = options.range && Number.isFinite(options.range.start) && Number.isFinite(options.range.end) && options.range.end > options.range.start;
      const outputChannels = (options.channels === 1 || options.channels === "mono") ? 1 : 2;
      const cacheable = !selectedTrackSet && !hasRenderRange && outputChannels === 2;
      const cacheKey = cacheable ? this._renderCacheSignature(sr, options.normalize, renderRate, preservePitch) : null;
      if (cacheable && this._renderCacheKey === cacheKey && this._renderCacheBuffer) {
        if (onProgress) onProgress(1);
        return this._renderCacheBuffer;
      }
      const len = Math.ceil(renderDuration * sr);
      const off = new OfflineAudioContext(2, len, sr);
      // rebuild graph in offline ctx
      const conv = off.createConvolver(); conv.buffer = makeIR(off, 2.4, 2.6);
      const mBus = off.createGain();
      // 9-band master EQ
      let node = mBus;
      EQ_FREQS.forEach((f, i) => {
        const b = off.createBiquadFilter();
        b.type = "peaking";
        b.frequency.setValueAtTime(f, 0);
        b.Q.setValueAtTime(1.1, 0);
        b.gain.setValueAtTime(this.master.bands[i] || 0, 0);
        node.connect(b); node = b;
      });
      const fade = off.createGain();
      // Intentional export policy:
      // Master Volume is a listener-side monitoring control for the user's
      // speakers/headphones, so it must not attenuate rendered files. Exports
      // should reflect track gain, automation, pan, master EQ/FX, and fades,
      // while ignoring only the playback monitoring volume. Do not replace
      // this with `this.master.volume` unless the export policy changes.
      const mv = off.createGain(); mv.gain.setValueAtTime(1, 0);
      // master FX
      const mConvO = off.createConvolver(); mConvO.buffer = makeIR(off, 2.8, 3.0);
      const mRev = off.createGain(); mRev.gain.setValueAtTime(this.master.reverb, 0);
      const mDel = off.createDelay(1.2); mDel.delayTime.setValueAtTime(0.3, 0);
      const mFbO = off.createGain(); mFbO.gain.setValueAtTime(0.36, 0);
      const mEch = off.createGain(); mEch.gain.setValueAtTime(this.master.echo, 0);
      const mMix = off.createGain();

      // Ambience (room type) bus — mirror the realtime graph so Export matches playback
      const ambSpec = this.master.roomParams || ROOM_PRESETS[this.master.room] || ROOM_PRESETS.none;
      const ambCO = off.createConvolver(); ambCO.buffer = makeRoomIR(off, ambSpec);
      const ambSO = off.createGain(); ambSO.gain.setValueAtTime(ambSpec.wet, 0);

      node.connect(fade); fade.connect(mv);
      mv.connect(mMix);
      mv.connect(mRev); mRev.connect(mConvO); mConvO.connect(mMix);
      mv.connect(mEch); mEch.connect(mDel); mDel.connect(mFbO); mFbO.connect(mDel); mDel.connect(mMix);
      mv.connect(ambSO); ambSO.connect(ambCO); ambCO.connect(mMix);

      // Master tone shaping — Saturation → Widener → Exciter/Enhancer.
      // Mirror of the realtime monitoring chain (see init()) so Export matches
      // playback. Each stage is inserted ONLY when its amount is non-zero: with
      // everything at 0 the signal path is `mMix → limiter` exactly as before, so
      // projects that don't use these effects render byte-for-byte unchanged.
      // (The realtime chain ends in a DynamicsCompressor; Export keeps its
      // zero-latency soft-clipper limiter below instead, by render policy.)
      const FX_EPS = 1e-4;
      const satVal = this.master.saturation || 0;
      const widVal = this.master.widener || 0;
      const excVal = this.master.exciter || 0;
      let colorTail = mMix;

      if (satVal > FX_EPS) {
        // Saturation: tanh waveshaper with dry/wet blend.
        const satDry = off.createGain(); satDry.gain.setValueAtTime(1.0 - satVal * 0.4, 0);
        const satWet = off.createGain(); satWet.gain.setValueAtTime(satVal * 0.8, 0);
        const satShaper = off.createWaveShaper();
        const n = 44100, k = 4.0, comp = 1.0 / Math.tanh(k), cv = new Float32Array(n);
        for (let i = 0; i < n; i++) { const x = (i * 2) / (n - 1) - 1; cv[i] = Math.tanh(k * x) * comp; }
        satShaper.curve = cv;
        const satOut = off.createGain();
        colorTail.connect(satDry); satDry.connect(satOut);
        colorTail.connect(satShaper); satShaper.connect(satWet); satWet.connect(satOut);
        colorTail = satOut;
      }

      if (widVal > FX_EPS) {
        // Stereo Widener: mid/side matrix via split → 4 gains → merge.
        const wW = 1.0 + widVal * 1.5;
        const widSplit = off.createChannelSplitter(2);
        const widMerge = off.createChannelMerger(2);
        const widLL = off.createGain(); widLL.gain.setValueAtTime(0.5 * (1.0 + wW), 0);
        const widRR = off.createGain(); widRR.gain.setValueAtTime(0.5 * (1.0 + wW), 0);
        const widRL = off.createGain(); widRL.gain.setValueAtTime(0.5 * (1.0 - wW), 0);
        const widLR = off.createGain(); widLR.gain.setValueAtTime(0.5 * (1.0 - wW), 0);
        const widOut = off.createGain();
        colorTail.connect(widSplit);
        widSplit.connect(widLL, 0); widSplit.connect(widLR, 0);
        widSplit.connect(widRL, 1); widSplit.connect(widRR, 1);
        widLL.connect(widMerge, 0, 0); widRL.connect(widMerge, 0, 0);
        widLR.connect(widMerge, 0, 1); widRR.connect(widMerge, 0, 1);
        widMerge.connect(widOut);
        colorTail = widOut;
      }

      if (excVal > FX_EPS) {
        // Exciter / Enhancer: high-passed harmonic generation blended back in (wet).
        const excHPF = off.createBiquadFilter();
        excHPF.type = "highpass"; excHPF.frequency.setValueAtTime(3000, 0); excHPF.Q.setValueAtTime(0.707, 0);
        const excShaper = off.createWaveShaper();
        const n = 44100, cv = new Float32Array(n);
        for (let i = 0; i < n; i++) { const x = (i * 2) / (n - 1) - 1; cv[i] = x + 0.35 * x * x; }
        excShaper.curve = cv;
        const excWet = off.createGain(); excWet.gain.setValueAtTime(excVal * 0.5, 0);
        const excOut = off.createGain();
        colorTail.connect(excOut); // dry
        colorTail.connect(excHPF); excHPF.connect(excShaper); excShaper.connect(excWet); excWet.connect(excOut);
        colorTail = excOut;
      }

      const useLimiter = options.normalize !== false;
      if (useLimiter) {
        // WaveShaper soft-clipper: zero look-ahead latency (DynamicsCompressor added ~10ms delay)
        const clipper = off.createWaveShaper();
        const nc = 4096;
        const cv = new Float32Array(nc);
        const kn = 0.9;
        for (let i = 0; i < nc; i++) {
          const x = (i * 2) / (nc - 1) - 1;
          const a = Math.abs(x);
          const y = a <= kn ? a : kn + (1 - kn) * Math.tanh((a - kn) / (1 - kn));
          cv[i] = x >= 0 ? y : -y;
        }
        clipper.curve = cv;
        colorTail.connect(clipper); clipper.connect(off.destination);
      } else {
        colorTail.connect(off.destination);
      }
      const rr = off.createGain(); rr.gain.setValueAtTime(0.9, 0); conv.connect(rr); rr.connect(mBus);
      // fade automation
      const fi = Math.min(this.master.fadeIn / graphRate, renderDuration / 2);
      const fo = Math.min(this.master.fadeOut / graphRate, renderDuration / 2);
      fade.gain.setValueAtTime(fi > 0 ? 0 : 1, 0);
      if (fi > 0) fade.gain.linearRampToValueAtTime(1, fi);
      if (fo > 0) { fade.gain.setValueAtTime(1, renderDuration - fo); fade.gain.linearRampToValueAtTime(0, renderDuration); }

      const anySolo = options.respectSolo === false ? false : this._anySolo();
      // Pitch-shift (Vari Key) for the offline render. Baked into the source buffer so
      // the exported file matches realtime playback. Tempo is still applied by graphRate
      // (playbackRate) below; for the common Vari-Key-only case graphRate is 1 so the
      // shift is exact.
      const exportSemis = this._exportKeyShiftSemis();
      tracksForRender.forEach((t) => {
        if (!t || !t.buffer || t.needsAudio) return;
        const p = t.params;
        const audible = options.respectMute === false ? 1 : (p.mute ? 0 : (anySolo && !p.solo ? 0 : 1));
        let srcBuffer = t.buffer;
        if (exportSemis !== 0 && t.buffer) {
          const kp = t._keyShiftPreview;
          srcBuffer = (kp && kp.semis === exportSemis && kp.base === t.buffer && kp.buffer)
            ? kp.buffer
            : pitchShiftBuffer(off, t.buffer, exportSemis);
        }
        const src = off.createBufferSource(); src.buffer = srcBuffer;
        const rate = graphRate;
        try { src.playbackRate.setValueAtTime(rate, 0); } catch (e) {}
        const fd = off.createGain(); fd.gain.setValueAtTime(audible * p.volume, 0);
        const ag = off.createGain();
        const pn = off.createStereoPanner(); pn.pan.setValueAtTime(p.pan, 0);
        const rs = off.createGain(); rs.gain.setValueAtTime(p.reverb, 0);
        const es = off.createGain(); es.gain.setValueAtTime(p.echo, 0);
        // Match native/realtime per-track echo: 0.3s delay, 0.34 fb, wet ×0.45.
        const dl = off.createDelay(1.0); dl.delayTime.setValueAtTime(0.3, 0);
        const fb = off.createGain(); fb.gain.setValueAtTime(0.34, 0);
        const er = off.createGain(); er.gain.setValueAtTime(0.45, 0);
        src.connect(fd); fd.connect(ag); ag.connect(pn);
        pn.connect(mBus); pn.connect(rs); rs.connect(conv);
        pn.connect(es); es.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(er); er.connect(mBus);
        const rHasGaps = t.clips && (t.clips.length > 1 || (t.clips[0] && (t.clips[0].start > 0.01 || t.clips[0].end < this.duration - 0.01)));
        const rHasOverrides = t.clips && t.clips.some(c => c.params || c.automation);
        if (p.autoOn || rHasGaps || rHasOverrides) {
          const curve = (rHasGaps || rHasOverrides)
            ? this._buildCompositeCurve(t, 512)
            : buildAutoCurve(t, 512);
          ag.gain.setValueCurveAtTime(curve, 0, renderDuration);
        }
        src.start(0);
      });
      let rendered;
      if (onProgress) {
        let prog = 0;
        const iv = setInterval(() => { prog = Math.min(0.95, prog + Math.random() * 0.13); onProgress(prog); }, 120);
        rendered = await off.startRendering();
        clearInterval(iv); onProgress(1);
      } else {
        rendered = await off.startRendering();
      }
      // Trim any leading silence the render pipeline introduces, but PRESERVE the
      // target render length: shift left by `ts` and zero-fill the tail. Shortening
      // the buffer even by 1 frame makes duration e.g. 4.999979s, which Windows
      // Explorer floors to "4s" for a nominally 5s file.
      let ts = 0;
      const c0 = rendered.getChannelData(0);
      const c1 = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : c0;
      const maxTs = Math.floor(sr * 0.05); // max 50ms
      while (ts < maxTs && ts < c0.length && Math.abs(c0[ts]) < 1e-4 && Math.abs(c1[ts]) < 1e-4) ts++;
      let result = rendered;
      if (ts > 0) {
        const out = off.createBuffer(rendered.numberOfChannels, rendered.length, sr);
        for (let c = 0; c < rendered.numberOfChannels; c++)
          out.getChannelData(c).set(rendered.getChannelData(c).subarray(ts)); // tail stays zero-filled
        result = out;
      }
      if (preservePitch) {
        result = timeStretchBuffer(off, result, renderRate, Math.max(1, Math.ceil(targetDuration * sr)));
      }
      if (hasRenderRange) {
        const startFrame = Math.max(0, Math.floor((options.range.start / Math.max(0.001, renderRate)) * result.sampleRate));
        const endFrame = Math.min(result.length, Math.ceil((options.range.end / Math.max(0.001, renderRate)) * result.sampleRate));
        const outLen = Math.max(1, endFrame - startFrame);
        const ranged = off.createBuffer(result.numberOfChannels, outLen, result.sampleRate);
        for (let c = 0; c < result.numberOfChannels; c++) {
          ranged.getChannelData(c).set(result.getChannelData(c).subarray(startFrame, endFrame));
        }
        result = ranged;
      }
      if (outputChannels === 1 && result.numberOfChannels > 1) {
        const mono = off.createBuffer(1, result.length, result.sampleRate);
        const dst = mono.getChannelData(0);
        const channels = result.numberOfChannels;
        for (let c = 0; c < channels; c++) {
          const src = result.getChannelData(c);
          for (let i = 0; i < result.length; i++) dst[i] += src[i] / channels;
        }
        result = mono;
      }
      if (cacheable) {
        this._renderCacheKey = cacheKey;
        this._renderCacheBuffer = result;
      }
      return result;
    },
  };

  // ---------- helpers exposed ----------------------------------
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }
  function ramp(param, val) {
    if (!param || !ctx) return;
    try {
      param.cancelScheduledValues(ctx.currentTime);
      param.setTargetAtTime(val, ctx.currentTime, 0.02);
    } catch (e) { try { param.value = val; } catch (e2) {} }
  }
  function fadeVal(pos, dur, fi, fo) {
    if (fi > 0 && pos < fi) return pos / fi;
    if (fo > 0 && pos > dur - fo) return Math.max(0, (dur - pos) / fo);
    return 1;
  }

  function waitForPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function timeStretchBuffer(context, input, rate, targetLength) {
    const sr = input.sampleRate || 44100;
    const channels = input.numberOfChannels || 1;
    const outLen = Math.max(1, targetLength || Math.ceil(input.length / Math.max(0.001, rate)));
    const output = context.createBuffer(channels, outLen, sr);
    if (!input.length || Math.abs(rate - 1) < 0.001) {
      for (let c = 0; c < channels; c++) {
        output.getChannelData(c).set(input.getChannelData(c).subarray(0, outLen));
      }
      return output;
    }

    const grainSize = Math.max(1024, Math.min(4096, Math.floor(sr * 0.055)));
    const hopOut = Math.max(256, Math.floor(grainSize / 4));
    const overlap = grainSize - hopOut;
    const searchRadius = Math.max(128, Math.min(768, Math.floor(sr * 0.012)));
    const searchStep = 32;
    const matchLength = Math.max(128, Math.min(768, overlap, grainSize));
    const inChannels = [];
    const outChannels = [];
    for (let c = 0; c < channels; c++) {
      inChannels.push(input.getChannelData(c));
      outChannels.push(output.getChannelData(c));
    }

    let frame = 0;
    for (let outPos = 0; outPos < outLen; outPos += hopOut, frame++) {
      const nominalIn = Math.round(frame * hopOut * rate);
      const inPos = frame === 0
        ? 0
        : findBestWsolaPosition(inChannels, outChannels, nominalIn, outPos, input.length, grainSize, overlap, matchLength, searchRadius, searchStep);
      const frames = Math.min(grainSize, input.length - inPos, outLen - outPos);
      if (frames <= 0) break;
      for (let c = 0; c < channels; c++) {
        const src = inChannels[c];
        const dst = outChannels[c];
        for (let i = 0; i < frames; i++) {
          const oi = outPos + i;
          const v = src[inPos + i];
          if (frame > 0 && i < overlap && oi < outLen) {
            const fadeIn = i / overlap;
            dst[oi] = dst[oi] * (1 - fadeIn) + v * fadeIn;
          } else {
            dst[oi] = v;
          }
        }
      }
    }
    return output;
  }

  // Pitch-shift an AudioBuffer by `semitones` while preserving its length/tempo, used
  // by the WebAudio fallback (Phase 2) so the browser path can transpose like the
  // native SoundTouch engine. The output buffer has the SAME length as the input, so
  // multi-track sync, playhead, and offset math are unchanged.
  //
  // soundtouchjs' SimpleFilter stops processing the final <16384-frame input chunk, so
  // we pad the source with trailing silence to flush the real tail through the pipe,
  // then keep only the first `input.length` output frames (verified: leading latency ≈
  // 0, full energy preserved to the end).
  function pitchShiftBuffer(context, input, semitones) {
    const sr = input.sampleRate || 44100;
    const channels = input.numberOfChannels || 1;
    const len = input.length || 0;
    const output = context.createBuffer(channels, Math.max(1, len), sr);
    const STJS = (typeof window !== "undefined") ? window.SoundTouchJS : null;
    if (!len || !semitones || !STJS) {
      for (let c = 0; c < channels; c++) {
        output.getChannelData(c).set(input.getChannelData(c).subarray(0, len));
      }
      return output;
    }
    const { SoundTouch, SimpleFilter, WebAudioBufferSource } = STJS;
    const PAD = 32768;
    const padded = context.createBuffer(channels, len + PAD, sr);
    for (let c = 0; c < channels; c++) padded.getChannelData(c).set(input.getChannelData(c));

    const st = new SoundTouch();
    st.tempo = 1;
    st.rate = 1;
    st.pitchSemitones = semitones;
    const filter = new SimpleFilter(new WebAudioBufferSource(padded), st);
    const BUF = 8192;
    const tmp = new Float32Array(BUF * 2); // SoundTouch emits interleaved stereo
    const outCh = [];
    for (let c = 0; c < channels; c++) outCh.push(output.getChannelData(c));
    let written = 0, got;
    while ((got = filter.extract(tmp, BUF)) > 0) {
      for (let i = 0; i < got && written < len; i++) {
        for (let c = 0; c < channels; c++) outCh[c][written] = tmp[i * 2 + (c > 0 ? 1 : 0)];
        written++;
      }
      if (written >= len) break;
    }
    return output;
  }

  function findBestWsolaPosition(inChannels, outChannels, nominalIn, outPos, inputLength, grainSize, overlap, matchLength, searchRadius, searchStep) {
    const minIn = Math.max(0, nominalIn - searchRadius);
    const maxIn = Math.max(minIn, Math.min(inputLength - grainSize, nominalIn + searchRadius));
    let best = Math.max(0, Math.min(inputLength - grainSize, nominalIn));
    let bestScore = -Infinity;
    const compareOut = Math.max(0, outPos);
    for (let cand = minIn; cand <= maxIn; cand += searchStep) {
      const score = wsolaCorrelation(inChannels, outChannels, cand, compareOut, matchLength);
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    return best;
  }

  function wsolaCorrelation(inChannels, outChannels, inPos, outPos, length) {
    let xy = 0, xx = 0, yy = 0;
    const channels = Math.min(2, inChannels.length, outChannels.length);
    for (let i = 0; i < length; i += 2) {
      let a = 0, b = 0;
      for (let c = 0; c < channels; c++) {
        a += inChannels[c][inPos + i] || 0;
        b += outChannels[c][outPos + i] || 0;
      }
      a /= channels;
      b /= channels;
      xy += a * b;
      xx += a * a;
      yy += b * b;
    }
    if (xx <= 1e-12 || yy <= 1e-12) return 0;
    return xy / Math.sqrt(xx * yy);
  }

  function defaultAutomation(type) {
    if (type === "lead") return [{ t: 0, v: 0.3 }, { t: 0.25, v: 1 }, { t: 0.6, v: 1 }, { t: 1, v: 0.5 }];
    if (type === "keys") return [{ t: 0, v: 0.85 }, { t: 0.5, v: 1 }, { t: 1, v: 0.7 }];
    return [{ t: 0, v: 1 }, { t: 1, v: 1 }];
  }

  // Meyda 라이브러리가 로드되지 않으면 BPM·Key 감지가 모두 무력화된다(조용히 null/false 반환).
  // 패키징 누락(예: build.files에 meyda.min.js 미포함)이나 스크립트 404 시 즉시 인지할 수 있도록
  // 최초 1회 콘솔에 명확한 경고를 남긴다.
  let _meydaWarned = false;
  function warnMeydaMissing(feature) {
    if (_meydaWarned) return;
    _meydaWarned = true;
    console.error(
      `[FocusDAW] Meyda 라이브러리가 로드되지 않아 ${feature} 감지를 사용할 수 없습니다. ` +
      `studio.html이 참조하는 meyda.min.js가 패키지(asar)에 포함되었는지 확인하세요 ` +
      `(package.json build.files).`
    );
  }

  // BPM 측정 (표준 onset detection + tempo estimation 흐름):
  //   1) 곡 중앙의 연속 구간(최대 ~75초)에서 spectral-flux onset strength 곡선 생성
  //   2) 전체 구간 자기상관(ACF)으로 periodicity 추정 + tempo prior 가중
  //   3) 다중 후보 중 옥타브(½×·2×) 해소 후 best tempo 선택, 포물선 보간으로 정밀화
  // 구간 분할/RMS 없이 단일 global 추정값을 반환한다.
  const BPM_MIN = 40;
  const BPM_MAX = 240;
  const BPM_PRIOR_CENTER = 120; // tempo prior 중심(BPM)
  const BPM_PRIOR_SIGMA = 0.9;  // log2 영역 표준편차(약 ±1 옥타브)

  // tempo prior: 로그정규 분포. 중심에서 멀수록(특히 옥타브 단위) 가중 감소.
  function tempoPrior(bpm) {
    const z = Math.log2(bpm / BPM_PRIOR_CENTER) / BPM_PRIOR_SIGMA;
    return Math.exp(-0.5 * z * z);
  }

  // 대표 구간에 대한 onset strength 곡선을 만들고 best tempo를 추정한다.
  // centerSample을 주면 그 지점을 중심으로, 없으면 곡 중앙을 분석한다.
  function estimateBpm(buffer, centerSample) {
    if (typeof Meyda === "undefined") { warnMeydaMissing("BPM"); return null; }
    const sr = buffer.sampleRate || 44100;
    const len = buffer.length || 0;
    if (!len) return null;

    // 1) 분석 구간: 지정 지점(기본 곡 중앙) 중심의 연속된 최대 75초 (periodicity 증거 보존)
    const spanLen = Math.min(len, Math.floor(sr * 75));
    const center = (centerSample == null) ? Math.floor(len / 2) : Math.floor(centerSample);
    let rangeStart = Math.max(0, center - Math.floor(spanLen / 2));
    let rangeEnd = Math.min(len, rangeStart + spanLen);
    rangeStart = Math.max(0, rangeEnd - spanLen);
    if ((rangeEnd - rangeStart) / sr < 4) return null; // periodicity 추정에 부족

    // 2) Spectral Flux onset strength 곡선
    const onset = computeOnsetEnvelope(buffer, rangeStart, rangeEnd);
    if (!onset || onset.curve.length < 32) return null;

    // 3) ACF + tempo prior + 옥타브 해소
    const bpm = estimateTempoFromOnset(onset.curve, onset.envelopeSR);
    if (!bpm) return null;
    return Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(bpm)));
  }

  // 한 버퍼의 곡 중앙 최대 120초 구간을 분석해 프레임별 정규화한 크로마를 누적 chroma에 더한다.
  // 여러 트랙을 하나의 chroma에 합산하면 곧 "전체 믹스의 화성 내용"을 분석하는 효과.
  function accumulateChroma(buffer, chroma) {
    if (typeof Meyda === "undefined") { warnMeydaMissing("Key"); return false; }
    if (!buffer) return false;
    const sr = buffer.sampleRate || 44100;
    const len = buffer.length || 0;
    if (!len) return false;

    // 분석 구간: 곡 중앙의 연속된 최대 120초 (구간이 길수록 으뜸음 통계가 안정적)
    const spanLen = Math.min(len, Math.floor(sr * 120));
    const center = Math.floor(len / 2);
    let rangeStart = Math.max(0, center - Math.floor(spanLen / 2));
    let rangeEnd = Math.min(len, rangeStart + spanLen);
    rangeStart = Math.max(0, rangeEnd - spanLen);
    // 0.5초 이상의 짧은 루프/샘플도 분석할 수 있도록 한도를 4초 -> 0.5초로 하향 조정
    if ((rangeEnd - rangeStart) / sr < 0.5) return false;

    const frameSize = 4096;
    const hopSize = 2048;
    Meyda.bufferSize = frameSize;
    Meyda.sampleRate = sr;
    Meyda.windowingFunction = "hanning";
    // Meyda caches the chroma filter bank for whatever bufferSize it first built it
    // with and never rebuilds it on a bufferSize change. If BPM detection ran earlier
    // (amplitudeSpectrum @ bufferSize 2048), the first chroma extract here would build
    // a stale 2048-sized bank → dimension mismatch → NaN/flat chroma → key always "C".
    // Clearing it forces a rebuild for the current frameSize/sampleRate.
    Meyda.chromaFilterBank = undefined;

    const channelData = buffer.getChannelData(0);
    let frames = 0;
    for (let i = rangeStart; i <= rangeEnd - frameSize; i += hopSize) {
      const frame = channelData.slice(i, i + frameSize);
      const c = Meyda.extract("chroma", frame);
      if (!c) continue;
      let sum = 0, max = 0;
      for (let k = 0; k < 12; k++) { sum += c[k]; if (c[k] > max) max = c[k]; }
      if (sum < 1e-6) continue; // 거의 무음인 프레임은 건너뛴다
      // 음정 게이팅: 크로마가 거의 평평한(비음정·타악·노이즈) 프레임은 키 정보가 없고
      // 노이즈 바닥만 더하므로 버린다. (최댓값 < 평균*1.6 이면 평평한 것으로 간주)
      if (max * 12 < sum * 1.6) continue;
      // 프레임별 정규화: 카덴차의 V 화음 같은 짧고 큰 화음이 평균을 지배해
      // 으뜸음(I) 대신 딸림음(V)이 뽑히는 perfect-fifth 오류를 줄인다.
      for (let k = 0; k < 12; k++) chroma[k] += c[k] / sum;
      frames++;
    }
    return frames > 0;
  }

  // 단일 버퍼의 키 추정. 예: "C", "G#m".
  function estimateKey(buffer) {
    const chroma = new Float64Array(12);
    if (!accumulateChroma(buffer, chroma)) return null;
    return keyFromChroma(chroma);
  }

  // --- Key transposition helpers (mirror app.jsx so the engine can recompute the
  // applied key from detectedKey + keyShift without depending on the UI layer). ---
  const KEY_PC_MAJOR = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const KEY_PC_MINOR = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];
  function pitchClassOf(k) {
    if (!k) return -1;
    let name = k.endsWith("m") ? k.slice(0, -1) : k;
    switch (name) {
      case "C": return 0;
      case "C#": case "Db": return 1;
      case "D": return 2;
      case "D#": case "Eb": return 3;
      case "E": return 4;
      case "F": return 5;
      case "F#": case "Gb": return 6;
      case "G": return 7;
      case "G#": case "Ab": return 8;
      case "A": return 9;
      case "A#": case "Bb": return 10;
      case "B": return 11;
      default: return -1;
    }
  }
  // Transpose a key string by N semitones, preserving major/minor mode.
  function shiftKeyString(key, semitones) {
    const pc = pitchClassOf(key);
    if (pc === -1) return key || null;
    const arr = key.endsWith("m") ? KEY_PC_MINOR : KEY_PC_MAJOR;
    return arr[((pc + semitones) % 12 + 12) % 12];
  }
  // Smallest signed semitone distance (origKey -> targetKey), folded to -6..+6.
  function semitoneDiff(origKey, targetKey) {
    const o = pitchClassOf(origKey);
    const t = pitchClassOf(targetKey);
    if (o === -1 || t === -1) return 0;
    let diff = t - o;
    while (diff > 6) diff -= 12;
    while (diff < -6) diff += 12;
    return diff;
  }

  // 신뢰도 가중 결합: 각 트랙의 크로마를 따로 구해 "그 트랙이 어떤 키와 얼마나
  // 강하게 맞는지(피어슨 최대 상관)"를 신뢰도로 삼고, 그 가중치로 정규화 크로마를
  // 합산한 뒤 한 번에 키를 추정한다. 음정이 또렷한 트랙(베이스·피아노)은 큰 비중,
  // 드럼·노이즈처럼 평평한 트랙은 작은 비중을 갖는다.
  function estimateKeyFromBuffers(buffers, labels = []) {
    console.log("[KeyDetection] Starting key estimation on", buffers.length, "included buffers");
    const combined = new Float64Array(12);
    let totalWeight = 0;
    let validBuffers = [];

    for (let i = 0; i < buffers.length; i++) {
      const b = buffers[i];
      const c = new Float64Array(12);
      const label = labels[i] || `Buffer ${i}`;
      if (!accumulateChroma(b, c)) {
        console.log(`[KeyDetection] Buffer ${i} (${label}): accumulateChroma returned false (too short or silent)`);
        continue;
      }
      let sum = 0;
      for (let k = 0; k < 12; k++) sum += c[k];
      if (sum <= 0) {
        console.log(`[KeyDetection] Buffer ${i} (${label}): sum of chroma is 0`);
        continue;
      }
      
      validBuffers.push({ index: i, buffer: b, chroma: c, sum });
      const conf = Math.max(0, bestKeyCorrelation(c));
      const w = conf * conf; // 제곱으로 비음정 트랙을 더 강하게 억제
      console.log(`[KeyDetection] Buffer ${i} (${label}): max template correlation = ${conf.toFixed(4)}, weight = ${w.toFixed(4)}`);
      
      if (w <= 0) continue;
      for (let k = 0; k < 12; k++) combined[k] += (c[k] / sum) * w; // 정규화 후 가중 합
      totalWeight += w;
    }

    if (totalWeight <= 0) {
      if (validBuffers.length === 0) {
        console.warn("[KeyDetection] Key estimation failed: no valid buffers to analyze.");
        return null;
      }
      
      // Fallback: Weighted summation failed because all correlations were <= 0 (e.g. noisy/percussive tracks only,
      // or low-correlation melodic tracks). Use unweighted sum of normalized chromas so we still produce a best guess.
      console.log(`[KeyDetection] Weighted sum totalWeight is 0. Falling back to unweighted sum of ${validBuffers.length} valid buffers.`);
      const fallbackCombined = new Float64Array(12);
      for (const item of validBuffers) {
        for (let k = 0; k < 12; k++) {
          fallbackCombined[k] += item.chroma[k] / item.sum;
        }
      }
      const finalKey = keyFromChroma(fallbackCombined);
      console.log("[KeyDetection] Fallback detected key:", finalKey);
      return finalKey;
    }

    const finalKey = keyFromChroma(combined);
    console.log(`[KeyDetection] Successful key estimation: ${finalKey} (totalWeight = ${totalWeight.toFixed(4)})`);
    return finalKey;
  }

  // Albrecht & Shanahan(2013) 키 프로파일. 원래의 Krumhansl-Schmugler 대신 쓰는 이유는
  // 특성음(4도·이끔음)의 가중 차이가 훨씬 커서 으뜸/딸림(완전5도) 혼동을 크게 줄이기 때문.
  const KEY_PROFILE_MAJOR = [0.238, 0.006, 0.111, 0.006, 0.137, 0.094, 0.016, 0.214, 0.009, 0.080, 0.008, 0.081];
  const KEY_PROFILE_MINOR = [0.220, 0.006, 0.104, 0.123, 0.019, 0.103, 0.012, 0.214, 0.062, 0.022, 0.061, 0.052];
  // 관용적 조표 표기(샤프/플랫): 참조 사이트와 동일하게 읽히도록 장·단조별로 다르게 둔다.
  const KEY_MAJOR_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const KEY_MINOR_NAMES = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];

  // chroma를 shift만큼 회전해 후보 으뜸음을 인덱스 0에 정렬한 뒤 프로파일과 피어슨 상관 계산.
  function chromaCorr(chroma, profile, shift) {
    let sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
    for (let i = 0; i < 12; i++) {
      const x = chroma[(i + shift) % 12];
      const y = profile[i];
      sx += x; sy += y; sxy += x * y; sx2 += x * x; sy2 += y * y;
    }
    const num = 12 * sxy - sx * sy;
    const den = Math.sqrt((12 * sx2 - sx * sx) * (12 * sy2 - sy * sy));
    return den === 0 ? -Infinity : num / den;
  }

  // 이 크로마가 24개 조성 중 가장 잘 맞는 정도(최대 상관) = 트랙 신뢰도.
  function bestKeyCorrelation(chroma) {
    let total = 0;
    for (let k = 0; k < 12; k++) total += chroma[k];
    if (total <= 0) return 0;
    let best = -Infinity;
    for (let s = 0; s < 12; s++) {
      const a = chromaCorr(chroma, KEY_PROFILE_MAJOR, s); if (a > best) best = a;
      const b = chromaCorr(chroma, KEY_PROFILE_MINOR, s); if (b > best) best = b;
    }
    return best;
  }

  // 결합 크로마를 12개 장조/12개 단조 후보와 피어슨 상관 비교해 최적 조성을 고른다.
  function keyFromChroma(chroma) {
    const major = KEY_PROFILE_MAJOR, minor = KEY_PROFILE_MINOR;
    const majorNames = KEY_MAJOR_NAMES, minorNames = KEY_MINOR_NAMES;
    let total = 0;
    for (let k = 0; k < 12; k++) total += chroma[k];
    if (total <= 0) return null;

    const corr = (profile, shift) => chromaCorr(chroma, profile, shift);

    const majScore = new Array(12), minScore = new Array(12);
    let best = { score: -Infinity, mode: "maj", tonic: 0 };
    for (let s = 0; s < 12; s++) {
      majScore[s] = corr(major, s);
      minScore[s] = corr(minor, s);
      if (majScore[s] > best.score) best = { score: majScore[s], mode: "maj", tonic: s };
      if (minScore[s] > best.score) best = { score: minScore[s], mode: "min", tonic: s };
    }

    // 딸림음 혼동 보정(장조): 검출기는 6/7음을 공유하는 딸림조(으뜸음 +완전5도)를
    // 으뜸조 대신 고르기 쉽다. 어떤 장조 X와 그 버금딸림조 Y=X+5는 정확히 한 음만 다른데
    // — X는 이끔음(X+11)을, Y는 X+10을 가진다. 이 두 크로마 빈을 직접 비교해 가린다.
    // (X가 맞으면 이끔음 X+11이 더 크고, 진짜가 Y면 X+10이 더 커서 안전하게 자기교정)
    if (best.mode === "maj") {
      const X = best.tonic;
      const Y = (X + 5) % 12; // 버금딸림조 으뜸음 (= X - 7)
      if (majScore[Y] > majScore[X] - 0.2) {
        const leadX = chroma[(X + 11) % 12]; // X의 이끔음
        const altY = chroma[(X + 10) % 12];  // Y를 가리키는 특성음
        if (altY > leadX) best = { score: majScore[Y], mode: "maj", tonic: Y };
      }
    } else if (best.mode === "min") {
      // 단조도 동일한 딸림음 혼동이 생긴다(예: Gm을 Dm으로). 자연단조 X와 그
      // 버금딸림조 Y=X+5는 한 음만 다르다 — X는 자연2도(X+2), Y는 X+1(b2).
      const X = best.tonic;
      const Y = (X + 5) % 12;
      if (minScore[Y] > minScore[X] - 0.2) {
        const degX = chroma[(X + 2) % 12]; // X단조의 자연2도 (X를 가리킴)
        const altY = chroma[(X + 1) % 12]; // Y단조를 가리키는 특성음
        if (altY > degX) best = { score: minScore[Y], mode: "min", tonic: Y };
      }
    }

    return best.mode === "maj" ? majorNames[best.tonic] : minorNames[best.tonic];
  }

  // STFT spectral flux → 로그 압축·국소 평균 차감으로 정규화한 onset strength 곡선.
  function computeOnsetEnvelope(buffer, rangeStart, rangeEnd) {
    const sr = buffer.sampleRate || 44100;
    const frameSize = 2048;
    const hopSize = 512;
    Meyda.bufferSize = frameSize;
    Meyda.windowingFunction = "hanning";

    const channelData = buffer.getChannelData(0);
    const fluxes = [];
    let prevSpectrum = null;
    for (let i = rangeStart; i <= rangeEnd - frameSize; i += hopSize) {
      const frame = channelData.slice(i, i + frameSize);
      let spectrum = Meyda.extract("amplitudeSpectrum", frame);
      if (!spectrum) spectrum = new Float32Array(frameSize / 2);
      // 로그 압축: 큰 저역 에너지가 flux를 지배하는 것을 완화 (librosa 방식)
      let flux = 0;
      const cur = new Float32Array(spectrum.length);
      for (let k = 0; k < spectrum.length; k++) {
        cur[k] = Math.log1p(spectrum[k]);
        if (prevSpectrum) {
          const diff = cur[k] - prevSpectrum[k];
          if (diff > 0) flux += diff; // half-wave rectify
        }
      }
      if (prevSpectrum) fluxes.push(flux);
      prevSpectrum = cur;
    }
    if (fluxes.length < 32) return null;

    // 국소 평균 차감(adaptive threshold)으로 DC·느린 에너지 드리프트 제거
    const envelopeSR = sr / hopSize;
    const win = Math.max(4, Math.round(envelopeSR * 0.5)); // ~0.5초 이동 평균
    const curve = new Float32Array(fluxes.length);
    let acc = 0;
    for (let i = 0; i < fluxes.length; i++) {
      acc += fluxes[i];
      if (i >= win) acc -= fluxes[i - win];
      const localMean = acc / Math.min(i + 1, win);
      curve[i] = Math.max(0, fluxes[i] - localMean);
    }
    return { curve, envelopeSR };
  }

  // onset 곡선의 자기상관 + tempo prior로 best tempo(BPM)를 산출한다.
  function estimateTempoFromOnset(curve, envelopeSR) {
    const n = curve.length;
    const lagMin = Math.max(1, Math.floor((60 * envelopeSR) / BPM_MAX));
    const lagMax = Math.min(n - 2, Math.ceil((60 * envelopeSR) / BPM_MIN));
    if (lagMax <= lagMin) return null;

    // biased 자기상관: r[lag] = (1/n)·Σ curve[i]·curve[i+lag].
    // 분모를 n으로 고정하면 큰 lag(낮은 BPM)에서 항 수가 줄어 자연히 감쇠 → 저-BPM 과대평가 방지.
    const r = new Float32Array(lagMax + 2);
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let sum = 0;
      for (let i = 0; i < n - lag; i++) sum += curve[i] * curve[i + lag];
      r[lag] = sum / n;
    }

    const lagToBpm = (lag) => (60 * envelopeSR) / lag;

    // 후보: 자기상관의 국소 최대(peak)
    const candidates = [];
    for (let lag = lagMin + 1; lag < lagMax; lag++) {
      if (r[lag] > r[lag - 1] && r[lag] >= r[lag + 1] && r[lag] > 0) candidates.push(lag);
    }
    if (!candidates.length) return null;

    // 옥타브 해소: harmonic comb score × tempo prior로 fundamental 선택.
    // comb(L)=Σ_{m=1..4} r[m·L] 는 기본 템포 L이 자기 배음(2L·3L…) 피크의 지지를 흡수하므로,
    // half-tempo(2L) 후보보다 항상 강해져 "더 빠른 기본 템포"를 선택하게 된다.
    let bestLag = 0;
    let bestScore = -Infinity;
    for (const L of candidates) {
      let comb = 0;
      for (let m = 1; m <= 4; m++) {
        const ml = Math.round(m * L);
        if (ml > lagMax) break;
        comb += r[ml];
      }
      const score = comb * tempoPrior(lagToBpm(L));
      if (score > bestScore) {
        bestScore = score;
        bestLag = L;
      }
    }
    if (!bestLag) return null;

    // 옥타브 하향 보정: harmonic comb은 배음을 흡수해 빠른 템포를 선호하므로,
    // 결과가 빠른데(>160bpm) 그 절반 템포(2×lag) 부근의 실제 자기상관 피크가
    // 충분히(>1.15배) 더 강하면 빠른 값은 잘게 쪼갠 박(subdivision)이고 절반이
    // 진짜 기본 박이다. → 절반으로 내린다. (예: 185bpm r=22.7 vs 93bpm r=34.1)
    if (lagToBpm(bestLag) > 160) {
      const lo = Math.max(lagMin, bestLag * 2 - 2);
      const hi = Math.min(lagMax, bestLag * 2 + 2);
      let halfLag = -1, halfR = -Infinity;
      for (let l = lo; l <= hi; l++) { if (r[l] > halfR) { halfR = r[l]; halfLag = l; } }
      if (halfLag > 0 && halfR > r[bestLag] * 1.15) bestLag = halfLag;
    }

    // 포물선 보간으로 lag 정밀화
    const refinedLag = parabolicPeakLag(r, bestLag, lagMin, lagMax);
    return lagToBpm(refinedLag);
  }

  // y[L-1], y[L], y[L+1]을 이용한 포물선 정점 보간으로 소수점 lag를 추정한다.
  function parabolicPeakLag(y, L, lagMin, lagMax) {
    if (L <= lagMin || L >= lagMax) return L;
    const a = y[L - 1], b = y[L], c = y[L + 1];
    const denom = a - 2 * b + c;
    if (denom === 0) return L;
    const delta = (0.5 * (a - c)) / denom;
    if (delta < -1 || delta > 1) return L;
    return L + delta;
  }
  function automationCurve(bps, n) {
    const pts = [...bps].sort((a, b) => a.t - b.t);
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      // find segment
      let a = pts[0], b = pts[pts.length - 1];
      for (let k = 0; k < pts.length - 1; k++) {
        if (t >= pts[k].t && t <= pts[k + 1].t) { a = pts[k]; b = pts[k + 1]; break; }
      }
      const span = (b.t - a.t) || 1;
      const f = Math.min(1, Math.max(0, (t - a.t) / span));
      c[i] = Math.max(0.0001, a.v + (b.v - a.v) * f);
    }
    return c;
  }

  // Smooth volume envelope: piecewise cubic Hermite with monotone (Fritsch–Carlson)
  // tangents. Each segment is a cubic; passes through every control point and never
  // overshoots the neighbouring values, so gain stays within [0,1].
  function monotoneCubicCurve(bps, n) {
    const pts = [...bps].sort((a, b) => a.t - b.t);
    const c = new Float32Array(n);
    const m = pts.length;
    if (m === 0) { c.fill(1); return c; }
    if (m === 1) { c.fill(Math.max(0.0001, Math.min(1, pts[0].v))); return c; }
    const dx = new Array(m - 1), slope = new Array(m - 1);
    for (let i = 0; i < m - 1; i++) {
      dx[i] = (pts[i + 1].t - pts[i].t) || 1e-6;
      slope[i] = (pts[i + 1].v - pts[i].v) / dx[i];
    }
    const tan = new Array(m);
    tan[0] = slope[0];
    tan[m - 1] = slope[m - 2];
    for (let i = 1; i < m - 1; i++) {
      tan[i] = (slope[i - 1] * slope[i] <= 0) ? 0 : (slope[i - 1] + slope[i]) / 2;
    }
    for (let i = 0; i < m - 1; i++) {
      if (slope[i] === 0) { tan[i] = 0; tan[i + 1] = 0; continue; }
      const a = tan[i] / slope[i], b = tan[i + 1] / slope[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); tan[i] = k * a * slope[i]; tan[i + 1] = k * b * slope[i]; }
    }
    let seg = 0;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      while (seg < m - 2 && t > pts[seg + 1].t) seg++;
      const x0 = pts[seg].t, h = dx[seg];
      const u = Math.min(1, Math.max(0, (t - x0) / h)), u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      const v = h00 * pts[seg].v + h10 * h * tan[seg] + h01 * pts[seg + 1].v + h11 * h * tan[seg + 1];
      c[i] = Math.max(0.0001, Math.min(1, v));
    }
    return c;
  }

  // dispatch: smooth curve when the track has curve-fitting enabled, else linear.
  // Memoized per track: recomputes only when automation array reference or autoCurve flag changes.
  function buildAutoCurve(track, n) {
    const auto = track.params.automation;
    const curved = !!track.params.autoCurve;
    let c = track._curveCache;
    if (!c || c.auto !== auto || c.curved !== curved) {
      c = { auto, curved };
      track._curveCache = c;
    }
    if (!c[n]) {
      c[n] = curved ? monotoneCubicCurve(auto, n) : automationCurve(auto, n);
    }
    return c[n];
  }

  // Point-evaluable automation sampler: returns f(t) -> gain in [0.0001, 1].
  // `curved` picks monotone cubic (Fritsch–Carlson) vs linear interpolation.
  // Tangents are precomputed once, so it is cheap to call per output sample —
  // used by _buildCompositeCurve (clip path) to honour the curve-fitting toggle.
  function makeAutoSampler(bps, curved) {
    const pts = [...bps].sort((a, b) => a.t - b.t);
    const m = pts.length;
    if (m === 0) return () => 1;
    if (m === 1) { const v = Math.max(0.0001, Math.min(1, pts[0].v)); return () => v; }
    let tan = null;
    if (curved) {
      const slope = new Array(m - 1);
      for (let i = 0; i < m - 1; i++) slope[i] = (pts[i + 1].v - pts[i].v) / ((pts[i + 1].t - pts[i].t) || 1e-6);
      tan = new Array(m);
      tan[0] = slope[0]; tan[m - 1] = slope[m - 2];
      for (let i = 1; i < m - 1; i++) tan[i] = (slope[i - 1] * slope[i] <= 0) ? 0 : (slope[i - 1] + slope[i]) / 2;
      for (let i = 0; i < m - 1; i++) {
        if (slope[i] === 0) { tan[i] = 0; tan[i + 1] = 0; continue; }
        const a = tan[i] / slope[i], b = tan[i + 1] / slope[i], s = a * a + b * b;
        if (s > 9) { const k = 3 / Math.sqrt(s); tan[i] = k * a * slope[i]; tan[i + 1] = k * b * slope[i]; }
      }
    }
    return (t) => {
      let seg = 0;
      while (seg < m - 2 && t > pts[seg + 1].t) seg++;
      const x0 = pts[seg].t, h = (pts[seg + 1].t - x0) || 1e-6;
      const u = Math.min(1, Math.max(0, (t - x0) / h));
      let v;
      if (curved) {
        const u2 = u * u, u3 = u2 * u;
        v = (2 * u3 - 3 * u2 + 1) * pts[seg].v + (u3 - 2 * u2 + u) * h * tan[seg]
          + (-2 * u3 + 3 * u2) * pts[seg + 1].v + (u3 - u2) * h * tan[seg + 1];
      } else {
        v = pts[seg].v + (pts[seg + 1].v - pts[seg].v) * u;
      }
      return Math.max(0.0001, Math.min(1, v));
    };
  }

  // return the tail of a sampled curve starting at fraction `frac` of its length,
  // with the first sample interpolated at exactly `frac` (≥2 samples for 0<frac<1).
  function sliceCurveFrom(curve, frac) {
    const n = curve.length;
    if (!(frac > 0)) return curve;
    if (frac >= 1) return curve.slice(n - 1);
    const fi = frac * (n - 1), i0 = Math.floor(fi), fr = fi - i0;
    const next = (curve[i0 + 1] !== undefined) ? curve[i0 + 1] : curve[i0];
    const out = new Float32Array(n - i0);
    out[0] = curve[i0] + (next - curve[i0]) * fr;
    for (let k = i0 + 1, j = 1; k < n; k++, j++) out[j] = curve[k];
    return out;
  }

  Engine.automationCurve = automationCurve;
  Engine.monotoneCubicCurve = monotoneCubicCurve;
  Engine.buildAutoCurve = buildAutoCurve;
  Engine.computePeaks = computePeaks;
  Engine.splitClip = Engine.splitClip.bind(Engine);
  Engine.joinClips = Engine.joinClips.bind(Engine);
  Engine.setClipParam = Engine.setClipParam.bind(Engine);
  // Phase 5 clip editing (전략 B)
  Engine.moveClip = Engine.moveClip.bind(Engine);
  Engine._resolveMovePosition = Engine._resolveMovePosition.bind(Engine);
  Engine.nudgeClip = Engine.nudgeClip.bind(Engine);
  // v1.22.0 multi-clip selection (rigid group move)
  Engine.moveClipsBy = Engine.moveClipsBy.bind(Engine);
  Engine.moveClipsByResolved = Engine.moveClipsByResolved.bind(Engine);
  Engine._clampGroupDelta = Engine._clampGroupDelta.bind(Engine);
  Engine._resolveGroupDelta = Engine._resolveGroupDelta.bind(Engine);
  Engine.deleteClips = Engine.deleteClips.bind(Engine);
  Engine.trimClipStart = Engine.trimClipStart.bind(Engine);
  Engine.trimClipEnd = Engine.trimClipEnd.bind(Engine);
  Engine.deleteClip = Engine.deleteClip.bind(Engine);
  Engine.deleteRange = Engine.deleteRange.bind(Engine);
  Engine.duplicateClip = Engine.duplicateClip.bind(Engine);
  Engine.copyClip = Engine.copyClip.bind(Engine);
  Engine.pasteClip = Engine.pasteClip.bind(Engine);
  window.DAW = Engine;
})();
