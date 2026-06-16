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
  const Engine = {
    ctx: null,
    duration: DURATION,
    EQ_FREQS,
    EQ_PRESETS,
    tracks: [],
    loopEnabled: true,
    tempo: { projectBpm: null, playbackBpm: null, variBpm: false, key: null, variKey: false, detectedKey: null },
    master: { volume: 0.9, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0], reverb: 0, echo: 0, reverbStored: 0.4, echoStored: 0.35, widener: 0.0, saturation: 0.0, exciter: 0.0, fadeIn: 0.0, fadeOut: 0.0 },
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
    _clipCounter: 0,
    _cid() { return 'c' + (++this._clipCounter); },
    _displayName(fileName) {
      return (fileName || "").replace(/\.(mp3|wav|aiff?|m4a|ogg|flac)$/i, "");
    },

    init() {
      if (ctx) return;
      ctx = makeCtx();
      this.ctx = ctx;
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
      masterAnalyser.connect(ctx.destination);

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

    _addTrack({ name, type, color, buffer, peaks = null, isDemo = false, fileName = null, filePath = null, needsAudio = false }) {
      const id = "t" + (this.tracks.length + 1) + "_" + Math.random().toString(36).slice(2, 6);
      // persistent nodes
      const fader = ctx.createGain();
      const autoGain = ctx.createGain();
      const panner = ctx.createStereoPanner();
      const meter = ctx.createAnalyser(); meter.fftSize = 512;
      const reverbSend = ctx.createGain(); reverbSend.gain.value = 0;
      const echoSend = ctx.createGain(); echoSend.gain.value = 0;
      const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.25;
      const fb = ctx.createGain(); fb.gain.value = 0.34;

      // graph: (source) -> fader -> autoGain -> panner -> meter & bus
      fader.connect(autoGain); autoGain.connect(panner);
      panner.connect(meter);
      panner.connect(masterBus);             // dry
      panner.connect(reverbSend); reverbSend.connect(convolver); // reverb send
      panner.connect(echoSend); echoSend.connect(delay);
      delay.connect(fb); fb.connect(delay); delay.connect(masterBus); // echo

      const { coarse, medium, fine } = peaks || computePeakLevels(buffer);
      const track = {
        id, name, type, color, buffer,
        peaks: fine, peaksMedium: medium, peaksCoarse: coarse,
        nodes: { fader, autoGain, panner, meter, reverbSend, echoSend, delay, fb },
        params: {
          volume: 1.0, pan: 0, mute: false, solo: false,
          reverb: 0, echo: 0,
          bpmSource: false,
          autoOn: false,
          autoCurve: false,
          automation: defaultAutomation(type),
        },
        clips: [{ id: this._cid(), start: 0, end: buffer.duration, offset: 0, params: null, automation: null }],
        isDemo, fileName, filePath, needsAudio, audioRev: 0,
        _meterBuf: new Float32Array(meter.fftSize),
      };
      this.tracks.push(track);
      this._applyMix();
      return track;
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
      track.needsAudio = false;
      track.audioRev = (track.audioRev || 0) + 1;
      track._stretchPreview = null;
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
      const ph = this.tracks.find(t => t.needsAudio && (
        (filePath && t.filePath === filePath) || t.fileName === name || t.name === name || t.name === displayName
      ));
      if (ph) {
        this._assignDecodedToTrack(ph, decoded);
        ph.fileName = ph.fileName || name;
        ph.filePath = filePath || ph.filePath || null;
        this._applyMix();
        return ph;
      }
      const palette = ["#e8b04b", "#d98a55", "#9bbf7a", "#c98fb0", "#7fb0c4", "#cf6f5c"];
      const color = palette[this.tracks.length % palette.length];
      const t = this._addTrack({ name: displayName, type: "audio", color, buffer, peaks: decoded.peaks, fileName: name, filePath });
      return t;
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
      if (this.tracks.some(t => t.isDemo)) {
        this.duration = Math.max(this.duration, buffer.duration);
      } else {
        const maxExisting = this.tracks.reduce((m, t) => Math.max(m, (t.buffer && !t.needsAudio) ? t.buffer.duration : 0), 0);
        this.duration = Math.max(maxExisting, buffer.duration);
      }
      // link to a placeholder track from an imported project
      const ph = this.tracks.find(t => t.needsAudio && (t.fileName === fileName || t.fileName === name || t.name === name));
      if (ph) {
        this._assignDecodedToTrack(ph, decoded);
        ph.fileName = ph.fileName || fileName;
        this._applyMix();
        return ph;
      }
      const palette = ["#e8b04b", "#d98a55", "#9bbf7a", "#c98fb0", "#7fb0c4", "#cf6f5c"];
      const color = palette[this.tracks.length % palette.length];
      const t = this._addTrack({ name, type: "audio", color, buffer, peaks: decoded.peaks, fileName });
      return t;
    },

    _anySolo() { return this.tracks.some((t) => t.params.solo); },

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
      this._spectrum = null;
      this.tempo = { projectBpm: null, playbackBpm: null, variBpm: false, key: null, variKey: false, detectedKey: null };
      this._renderCacheKey = null;
      this._renderCacheBuffer = null;
      this._stretchPreviewPreparing = false;
      clearTimeout(this._tempoRestartTimer);
      this._tempoRestartTimer = null;
      this.master = { volume: 0.9, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0], reverb: 0, echo: 0, reverbStored: 0.4, echoStored: 0.35, widener: 0.0, saturation: 0.0, exciter: 0.0, fadeIn: 0.0, fadeOut: 0.0 };
      if (ctx) {
        ramp(masterVol.gain, 0.9);
        ramp(mRevSend.gain, 0);
        ramp(mEchoSend.gain, 0);
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
      const buffers = this.tracks
        .filter((t) => t && t.buffer && !t.needsAudio && !(t.params && t.params.mute))
        .map((t) => t.buffer);
      if (!buffers.length) return null;
      return estimateKeyFromBuffers(buffers);
    },

    setKey(key) {
      this.tempo.key = key || null;
      this._emit();
      return this.tempo.key;
    },
    setDetectedKey(key) {
      this.tempo.detectedKey = key || null;
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

    _playbackBufferForTrack(track, rate = this._projectRate()) {
      if (this._shouldUseRealtimeStretch(rate)) {
        const preview = track._stretchPreview;
        if (preview && preview.rate === rate && preview.buffer) return preview.buffer;
      }
      return track.buffer;
    },

    _sourceOffsetForTrack(track, sourceBuffer, rate = this._projectRate()) {
      const offset = Math.max(0, this._offset || 0);
      if (!sourceBuffer || !sourceBuffer.duration) return 0;
      if (sourceBuffer !== track.buffer && this._shouldUseRealtimeStretch(rate)) {
        return Math.min(sourceBuffer.duration - 0.001, (offset / rate) % sourceBuffer.duration);
      }
      return offset % sourceBuffer.duration;
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
          fileName: t.fileName || null,
          filePath: t.filePath || null,
          isDemo: !!t.isDemo,
          needsAudio: !!t.needsAudio,
          buffer: t.buffer ? {
            duration: t.buffer.duration,
            sampleRate: t.buffer.sampleRate,
            channels: t.buffer.numberOfChannels,
            length: t.buffer.length,
          } : null,
          params: t.params,
          clips: t.clips,
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

    setMaster(key, val) {
      this.master[key] = val;
      if (!ctx) return;
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

    setMasterBand(i, db) {
      this.master.bands[i] = db;
      if (eqNodes[i]) ramp(eqNodes[i].gain, db);
    },
    setMasterGroup(group, db) { // 0=low 1=mid 2=high
      for (let i = group * 3; i < group * 3 + 3; i++) this.setMasterBand(i, db);
    },
    setMasterBands(arr) { // apply all 9 bands at once (e.g. a preset)
      for (let i = 0; i < EQ_FREQS.length; i++) this.setMasterBand(i, arr[i] || 0);
    },
    applyEQPreset(name) {
      const p = EQ_PRESETS[name];
      if (p) this.setMasterBands(p);
    },
    getMasterGroup(group) {
      const b = this.master.bands;
      return (b[group * 3] + b[group * 3 + 1] + b[group * 3 + 2]) / 3;
    },

    exportProject(projectName) {
      return {
        version: "0.11",
        projectName,
        duration: this.duration,
        tempo: { ...this.tempo },
        master: { ...this.master, bands: [...this.master.bands] },
        tracks: this.tracks.map(t => ({
          id: t.id,
          name: t.name,
          type: t.type,
          color: t.color,
          isDemo: !!t.isDemo,
          fileName: t.fileName || null,
          filePath: t.filePath || null,
          params: {
            ...t.params,
            automation: t.params.automation.map(p => ({ ...p })),
          },
          clips: t.clips.map(c => ({
            id: c.id, start: c.start, end: c.end, offset: c.offset,
            params: c.params ? { ...c.params } : null,
            automation: c.automation ? c.automation.map(p => ({ ...p })) : null,
          })),
        })),
      };
    },

    getSnapshot() {
      return {
        master: {
          volume: this.master.volume,
          reverb: this.master.reverb,
          echo: this.master.echo,
          fadeIn: this.master.fadeIn,
          fadeOut: this.master.fadeOut,
        },
        eqBands: [...this.master.bands],
        tempo: { ...this.tempo },
        tracks: this.tracks.map(t => ({
          id: t.id,
          params: { ...t.params, automation: t.params.automation.map(p => ({ ...p })) },
          clips: t.clips.map(c => ({
            id: c.id, start: c.start, end: c.end, offset: c.offset,
            params: c.params ? { ...c.params } : null,
            automation: c.automation ? c.automation.map(p => ({ ...p })) : null,
          })),
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
      }
      if (snap.eqBands) this.setMasterBands(snap.eqBands);
      if (snap.tempo) {
        this.tempo = {
          projectBpm: this._normalizeBpm(snap.tempo.projectBpm),
          playbackBpm: this._normalizeBpm(snap.tempo.playbackBpm),
          variBpm: !!snap.tempo.variBpm,
          key: snap.tempo.key ?? null,
          variKey: !!snap.tempo.variKey,
        };
      }
      for (const st of snap.tracks) {
        const t = this.tracks.find(x => x.id === st.id);
        if (!t) continue;
        const { automation, ...rest } = st.params;
        Object.assign(t.params, rest);
        t.params.automation = automation.map(p => ({ ...p }));
        t.clips = st.clips.map(c => ({
          ...c,
          params: c.params ? { ...c.params } : null,
          automation: c.automation ? c.automation.map(p => ({ ...p })) : null,
        }));
      }
      this._applyMix();
      if (this.isPlaying) this._scheduleAutomationSoon();
    },

    importProject(json) {
      this.init();
      this.stop();
      this.tracks.length = 0;
      this._spectrum = null;
      this.duration = json.duration || DURATION;
      this.tempo = {
        projectBpm: this._normalizeBpm(json.tempo && json.tempo.projectBpm),
        playbackBpm: this._normalizeBpm(json.tempo && json.tempo.playbackBpm),
        variBpm: !!(json.tempo && json.tempo.variBpm),
        key: (json.tempo && json.tempo.key) ?? null,
        variKey: !!(json.tempo && json.tempo.variKey),
        detectedKey: (json.tempo && json.tempo.detectedKey) ?? null,
      };
      if (json.master) {
        Object.assign(this.master, json.master);
        ramp(masterVol.gain, this.master.volume);
        ramp(mRevSend.gain, this.master.reverb || 0);
        ramp(mEchoSend.gain, this.master.echo || 0);
        if (this.master.widener !== undefined) this.setMaster("widener", this.master.widener);
        if (this.master.saturation !== undefined) this.setMaster("saturation", this.master.saturation);
        if (this.master.exciter !== undefined) this.setMaster("exciter", this.master.exciter);
        if (this.master.bands) this.master.bands.forEach((db, i) => this.setMasterBand(i, db));
      }
      (json.tracks || []).forEach(td => {
        const isAudioPlaceholder = !td.isDemo && (!!td.fileName || !!td.filePath);
        let buffer;
        if (td.isDemo) {
          const def = TRACK_DEFS.find(d => d.type === td.type || d.name === td.name);
          buffer = def
            ? renderMono(ctx, (ch, sr) => def.synth(ch, sr))
            : ctx.createBuffer(1, Math.ceil(this.duration * ctx.sampleRate), ctx.sampleRate);
        } else {
          buffer = ctx.createBuffer(1, Math.max(1, Math.ceil(this.duration * ctx.sampleRate)), ctx.sampleRate);
        }
        const track = this._addTrack({
          name: td.name, type: td.type, color: td.color, buffer,
          isDemo: !!td.isDemo, fileName: td.fileName || null, filePath: td.filePath || null,
          needsAudio: isAudioPlaceholder,
        });
        track.id = td.id;
        if (td.params) {
          Object.assign(track.params, td.params);
          if (td.params.automation) track.params.automation = td.params.automation.map(p => ({ ...p }));
        }
        if (td.clips) track.clips = td.clips.map(c => ({ ...c }));
      });
      this._applyMix();
    },

    splitClip(trackId, clipId, atSec) {
      const t = this.tracks.find(x => x.id === trackId); if (!t) return;
      const ci = t.clips.findIndex(c => c.id === clipId); if (ci < 0) return;
      const clip = t.clips[ci];
      if (atSec <= clip.start + 0.01 || atSec >= clip.end - 0.01) return;
      const left  = { id: this._cid(), start: clip.start, end: atSec,
        offset: clip.offset, params: clip.params ? { ...clip.params } : null, automation: null };
      const right = { id: this._cid(), start: atSec, end: clip.end,
        offset: clip.offset + (atSec - clip.start), params: null, automation: null };
      t.clips = [...t.clips.slice(0, ci), left, right, ...t.clips.slice(ci + 1)];
      if (this.isPlaying) this._scheduleAutomation();
    },

    joinClips(trackId, clipIdA, clipIdB) {
      const t = this.tracks.find(x => x.id === trackId); if (!t) return;
      const ia = t.clips.findIndex(c => c.id === clipIdA);
      const ib = t.clips.findIndex(c => c.id === clipIdB);
      if (ia < 0 || ib < 0 || Math.abs(ia - ib) !== 1) return;
      const fi = Math.min(ia, ib);
      const first = t.clips[fi], second = t.clips[fi + 1];
      const merged = { id: this._cid(), start: first.start, end: second.end,
        offset: first.offset, params: first.params, automation: first.automation };
      t.clips = [...t.clips.slice(0, fi), merged, ...t.clips.slice(fi + 2)];
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
      for (let i = 0; i < n; i++) {
        const pos = (i / (n - 1)) * dur;
        const clip = track.clips.find(c => pos >= c.start && pos < c.end);
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
      const dur = this.duration;
      const fi = Math.min(this.master.fadeIn, dur / 2);
      const fo = Math.min(this.master.fadeOut, dur / 2);
      const rate = this._activePlaybackRate();
      const pos = this._projectPositionAt(now, rate) % dur;
      g.cancelScheduledValues(now);
      // simple: only apply fade on first loop pass
      const base = now - (pos / rate);
      g.setValueAtTime(fadeVal(pos, dur, fi, fo), now);
      // ramp through the rest of this loop
      const steps = 48;
      for (let i = 1; i <= steps; i++) {
        const lp = (i / steps) * dur;
        if (lp <= pos) continue;
        g.linearRampToValueAtTime(fadeVal(lp, dur, fi, fo), base + (lp / rate));
      }
      // subsequent loops: keep at 1 (fades are a one-shot master gesture)
      g.setValueAtTime(1, base + (dur / rate));
    },

    setLoop(val) { this.loopEnabled = !!val; },

    async play(options = {}) {
      this.init();
      if (ctx.state === "suspended") ctx.resume();
      if (this.isPlaying) return;
      const token = ++this._playToken;
      const requestedRate = this._projectRate();
      if (this._shouldUseRealtimeStretch(requestedRate)) {
        await this._prepareRealtimeStretch(requestedRate);
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
      this._loop();
    },

    pause() {
      if (!ctx || !this.isPlaying) return;
      this._playToken++;
      clearTimeout(this._tempoRestartTimer);
      this._tempoRestartTimer = null;
      this._stretchPreviewPreparing = false;
      this._offset = this.getPlayhead();
      this._stopSources();
      this.isPlaying = false;
    },

    stop() {
      this._playToken++;
      clearTimeout(this._tempoRestartTimer);
      this._tempoRestartTimer = null;
      this._stretchPreviewPreparing = false;
      this._offset = 0;
      if (ctx) this._stopSources();
      this.isPlaying = false;
      this._emit();
    },

    _stopSources() {
      clearTimeout(this._autoSchedTimer); this._autoSchedTimer = null;
      this._sources.forEach((s) => { try { s.stop(); } catch (e) {} });
      this._sources = [];
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

    onTick(cb) { this._tickCbs.push(cb); },
    _emit() { this._tickCbs.forEach((cb) => cb()); },
    _lastLoop: 0,
    _loop() {
      if (!this.isPlaying) return;
      // Source nodes are one-shot. At the song boundary the engine decides
      // whether to start a fresh pass or stop, using the latest Repeat state.
      const raw = this._projectPositionAt(ctx.currentTime);
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
      requestAnimationFrame(() => this._loop());
    },

    // ---- offline render to WAV (for export) ----
    async renderMix(onProgress, options = {}) {
      this.init();
      // Render at the requested target sample rate (export dialog), not the system
      // device rate. Source buffers are auto-resampled by OfflineAudioContext.
      const reqSr = options.sampleRate || ctx.sampleRate;
      const sr = Math.max(8000, Math.min(192000, reqSr));
      const renderRate = options.applyTempo === false ? 1 : this._projectRate();
      const preservePitch = !!options.preservePitch && Math.abs(renderRate - 1) > 0.001;
      const graphRate = preservePitch ? 1 : renderRate;
      const renderDuration = this.duration / graphRate;
      const targetDuration = this.duration / renderRate;
      const cacheKey = this._renderCacheSignature(sr, options.normalize, renderRate, preservePitch);
      if (this._renderCacheKey === cacheKey && this._renderCacheBuffer) {
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

      node.connect(fade); fade.connect(mv);
      mv.connect(mMix);
      mv.connect(mRev); mRev.connect(mConvO); mConvO.connect(mMix);
      mv.connect(mEch); mEch.connect(mDel); mDel.connect(mFbO); mFbO.connect(mDel); mDel.connect(mMix);

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
        mMix.connect(clipper); clipper.connect(off.destination);
      } else {
        mMix.connect(off.destination);
      }
      const rr = off.createGain(); rr.gain.setValueAtTime(0.9, 0); conv.connect(rr); rr.connect(mBus);
      // fade automation
      const fi = Math.min(this.master.fadeIn / graphRate, renderDuration / 2);
      const fo = Math.min(this.master.fadeOut / graphRate, renderDuration / 2);
      fade.gain.setValueAtTime(fi > 0 ? 0 : 1, 0);
      if (fi > 0) fade.gain.linearRampToValueAtTime(1, fi);
      if (fo > 0) { fade.gain.setValueAtTime(1, renderDuration - fo); fade.gain.linearRampToValueAtTime(0, renderDuration); }

      const anySolo = this._anySolo();
      this.tracks.forEach((t) => {
        const p = t.params;
        const audible = p.mute ? 0 : (anySolo && !p.solo ? 0 : 1);
        const src = off.createBufferSource(); src.buffer = t.buffer;
        const rate = graphRate;
        try { src.playbackRate.setValueAtTime(rate, 0); } catch (e) {}
        const fd = off.createGain(); fd.gain.setValueAtTime(audible * p.volume, 0);
        const ag = off.createGain();
        const pn = off.createStereoPanner(); pn.pan.setValueAtTime(p.pan, 0);
        const rs = off.createGain(); rs.gain.setValueAtTime(p.reverb, 0);
        const es = off.createGain(); es.gain.setValueAtTime(p.echo, 0);
        const dl = off.createDelay(1.0); dl.delayTime.setValueAtTime(0.25, 0);
        const fb = off.createGain(); fb.gain.setValueAtTime(0.34, 0);
        src.connect(fd); fd.connect(ag); ag.connect(pn);
        pn.connect(mBus); pn.connect(rs); rs.connect(conv);
        pn.connect(es); es.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(mBus);
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
      this._renderCacheKey = cacheKey;
      this._renderCacheBuffer = result;
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
    if (typeof Meyda === "undefined") return null;
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
    if (typeof Meyda === "undefined" || !buffer) return false;
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

  // 신뢰도 가중 결합: 각 트랙의 크로마를 따로 구해 "그 트랙이 어떤 키와 얼마나
  // 강하게 맞는지(피어슨 최대 상관)"를 신뢰도로 삼고, 그 가중치로 정규화 크로마를
  // 합산한 뒤 한 번에 키를 추정한다. 음정이 또렷한 트랙(베이스·피아노)은 큰 비중,
  // 드럼·노이즈처럼 평평한 트랙은 작은 비중을 갖는다.
  function estimateKeyFromBuffers(buffers) {
    console.log("[KeyDetection] Starting key estimation on", buffers.length, "buffers");
    const combined = new Float64Array(12);
    let totalWeight = 0;
    let validBuffers = [];

    for (let i = 0; i < buffers.length; i++) {
      const b = buffers[i];
      const c = new Float64Array(12);
      if (!accumulateChroma(b, c)) {
        console.log(`[KeyDetection] Buffer ${i}: accumulateChroma returned false (too short or silent)`);
        continue;
      }
      let sum = 0;
      for (let k = 0; k < 12; k++) sum += c[k];
      if (sum <= 0) {
        console.log(`[KeyDetection] Buffer ${i}: sum of chroma is 0`);
        continue;
      }
      
      validBuffers.push({ index: i, buffer: b, chroma: c, sum });
      const conf = Math.max(0, bestKeyCorrelation(c));
      const w = conf * conf; // 제곱으로 비음정 트랙을 더 강하게 억제
      console.log(`[KeyDetection] Buffer ${i}: max template correlation = ${conf.toFixed(4)}, weight = ${w.toFixed(4)}`);
      
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
  window.DAW = Engine;
})();
