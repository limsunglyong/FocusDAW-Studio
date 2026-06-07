/* ============================================================
   FocusDAW — Web Audio engine
   Real audio graph, demo-stem synthesis, transport, per-track
   FX (filter / reverb / echo), master EQ + fade, metering,
   and sample-accurate volume automation.
   ============================================================ */
(function () {
  "use strict";

  const BPM = 120;
  const BARS = 4;
  const SECPERBAR = (60 / BPM) * 4; // 2s
  const DURATION = BARS * SECPERBAR; // 8s loop

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
    const beat = 60 / BPM; // 0.5s
    for (let bar = 0; bar < BARS; bar++) {
      const b0 = bar * SECPERBAR;
      // kick on 1 and 3
      [0, 2].forEach((bt) => kick(ch, sr, b0 + bt * beat));
      // snare on 2 and 4
      [1, 3].forEach((bt) => snare(ch, sr, b0 + bt * beat));
      // hats on 8ths
      for (let h = 0; h < 8; h++) hat(ch, sr, b0 + h * (beat / 2));
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
    const beat = 60 / BPM;
    PROG.forEach((p, bar) => {
      const b0 = bar * SECPERBAR;
      // root note pulses on every beat
      for (let bt = 0; bt < 4; bt++) {
        addNote(ch, sr, b0 + bt * beat, beat * 0.9, p.bass, "saw", 0.5);
      }
    });
  }
  function synthKeys(ch, sr) {
    PROG.forEach((p, bar) => {
      const b0 = bar * SECPERBAR;
      p.chord.forEach((f) =>
        addNote(ch, sr, b0, SECPERBAR * 0.98, f, "tri", 0.22)
      );
    });
  }
  function synthLead(ch, sr) {
    const beat = 60 / BPM;
    // simple melodic line per bar (scale tones over the chord)
    const mel = [
      [659.25, 587.33, 523.25, 587.33],
      [523.25, 440.0, 349.23, 440.0],
      [523.25, 587.33, 659.25, 783.99],
      [587.33, 493.88, 392.0, 493.88],
    ];
    mel.forEach((bar, bi) => {
      const b0 = bi * SECPERBAR;
      bar.forEach((f, ni) =>
        addNote(ch, sr, b0 + ni * beat, beat * 0.85, f, "square", 0.16)
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
  const EQ_FREQS = [60, 150, 320, 640, 1200, 2400, 4800, 9000, 15000]; // 3 low / 3 mid / 3 high
  const Engine = {
    ctx: null,
    duration: DURATION,
    bpm: BPM,
    bars: BARS,
    secPerBar: SECPERBAR,
    EQ_FREQS,
    tracks: [],
    master: { volume: 0.9, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0], reverb: 0, echo: 0, fadeIn: 0.6, fadeOut: 1.4 },
    isPlaying: false,
    _startTime: 0,
    _offset: 0,
    _sources: [],
    _tickCbs: [],

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
      masterMix.connect(masterComp); masterComp.connect(masterAnalyser); masterAnalyser.connect(ctx.destination);

      // per-track reverb return (pre-EQ bus)
      const revReturn = ctx.createGain(); revReturn.gain.value = 0.9;
      convolver.connect(revReturn); revReturn.connect(masterBus);
      this._revReturn = revReturn;

      // build demo tracks
      TRACK_DEFS.forEach((def, i) => {
        const buffer = renderMono(ctx, (ch, sr) => def.synth(ch, sr));
        this._addTrack({
          name: def.name, type: def.type, color: def.color, buffer,
        });
      });
    },

    _addTrack({ name, type, color, buffer }) {
      const id = "t" + (this.tracks.length + 1) + "_" + Math.random().toString(36).slice(2, 6);
      // persistent nodes
      const fader = ctx.createGain();
      const autoGain = ctx.createGain();
      const filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 20000; filter.Q.value = 0.7;
      const panner = ctx.createStereoPanner();
      const meter = ctx.createAnalyser(); meter.fftSize = 512;
      const reverbSend = ctx.createGain(); reverbSend.gain.value = 0;
      const echoSend = ctx.createGain(); echoSend.gain.value = 0;
      const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.25;
      const fb = ctx.createGain(); fb.gain.value = 0.34;

      // graph: (source) -> fader -> autoGain -> filter -> panner -> meter & bus
      fader.connect(autoGain); autoGain.connect(filter); filter.connect(panner);
      panner.connect(meter);
      panner.connect(masterBus);             // dry
      panner.connect(reverbSend); reverbSend.connect(convolver); // reverb send
      panner.connect(echoSend); echoSend.connect(delay);
      delay.connect(fb); fb.connect(delay); delay.connect(masterBus); // echo

      const peaks = computePeaks(buffer, 1600);
      const track = {
        id, name, type, color, buffer, peaks,
        nodes: { fader, autoGain, filter, panner, meter, reverbSend, echoSend, delay, fb },
        params: {
          volume: 0.8, pan: 0, mute: false, solo: false,
          filterFreq: 20000, reverb: 0, echo: 0,
          autoOn: false,
          automation: defaultAutomation(type),
        },
        _meterBuf: new Float32Array(meter.fftSize),
      };
      this.tracks.push(track);
      this._applyMix();
      return track;
    },

    async addFile(file) {
      this.init();
      const arr = await file.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arr);
      const name = file.name.replace(/\.(mp3|wav|aiff?|m4a|ogg|flac)$/i, "");
      const palette = ["#e8b04b", "#d98a55", "#9bbf7a", "#c98fb0", "#7fb0c4", "#cf6f5c"];
      const color = palette[this.tracks.length % palette.length];
      // override duration if longer
      this.duration = Math.max(this.duration, buffer.duration);
      const t = this._addTrack({ name, type: "audio", color, buffer });
      t.peaks = computePeaks(buffer, Math.max(1600, Math.floor(buffer.duration * 200)));
      return t;
    },

    _anySolo() { return this.tracks.some((t) => t.params.solo); },

    addDemoTracks() {
      this.init();
      TRACK_DEFS.forEach((def) => {
        const buffer = renderMono(ctx, (ch, sr) => def.synth(ch, sr));
        this._addTrack({ name: def.name, type: def.type, color: def.color, buffer });
      });
      this._spectrum = null;
    },
    clearTracks() {
      this.stop();
      this.tracks.length = 0;
      this.duration = DURATION;
      this._spectrum = null;
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
        ramp(t.nodes.filter.frequency, p.filterFreq);
        ramp(t.nodes.reverbSend.gain, p.reverb);
        ramp(t.nodes.echoSend.gain, p.echo);
      });
    },

    setTrackParam(id, key, val) {
      const t = this.tracks.find((x) => x.id === id);
      if (!t) return;
      t.params[key] = val;
      this._applyMix();
      if (key === "autoOn" || key === "automation") {
        if (this.isPlaying) this._scheduleAutomation();
      }
    },

    setMaster(key, val) {
      this.master[key] = val;
      if (!ctx) return;
      if (key === "volume") ramp(masterVol.gain, val);
      if (key === "reverb") ramp(mRevSend.gain, val);
      if (key === "echo") ramp(mEchoSend.gain, val);
      if ((key === "fadeIn" || key === "fadeOut") && this.isPlaying) this._scheduleFade();
    },

    setMasterBand(i, db) {
      this.master.bands[i] = db;
      if (eqNodes[i]) ramp(eqNodes[i].gain, db);
    },
    setMasterGroup(group, db) { // 0=low 1=mid 2=high
      for (let i = group * 3; i < group * 3 + 3; i++) this.setMasterBand(i, db);
    },
    getMasterGroup(group) {
      const b = this.master.bands;
      return (b[group * 3] + b[group * 3 + 1] + b[group * 3 + 2]) / 3;
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

    _scheduleAutomation() {
      const now = ctx.currentTime;
      const dur = this.duration;
      const loops = 64;
      this.tracks.forEach((t) => {
        const g = t.nodes.autoGain.gain;
        g.cancelScheduledValues(now);
        if (!t.params.autoOn) { g.setValueAtTime(1, now); return; }
        const curve = automationCurve(t.params.automation, 256);
        // align to current loop position
        const pos = (this._offset + (now - this._startTime)) % dur;
        // schedule remaining of current loop then full loops
        const startAt = now;
        // first partial: approximate by scheduling full curve from loop start in the past
        let base = now - pos;
        for (let l = 0; l < loops; l++) {
          const tstart = base + l * dur;
          if (tstart + dur < now) continue;
          try { g.setValueCurveAtTime(curve, Math.max(tstart, now + 0.001), dur - Math.max(0, now - tstart)); }
          catch (e) { try { g.setValueCurveAtTime(curve, now + 0.001, dur); } catch (e2) {} }
          break; // schedule current loop; ticker re-arms each loop
        }
        // schedule subsequent loops cleanly
        for (let l = 1; l <= loops; l++) {
          const tstart = base + l * dur;
          if (tstart < now) continue;
          try { g.setValueCurveAtTime(curve, tstart, dur); } catch (e) {}
        }
      });
    },

    _scheduleFade() {
      const g = masterFade.gain;
      const now = ctx.currentTime;
      const dur = this.duration;
      const fi = Math.min(this.master.fadeIn, dur / 2);
      const fo = Math.min(this.master.fadeOut, dur / 2);
      const pos = (this._offset + (now - this._startTime)) % dur;
      g.cancelScheduledValues(now);
      // simple: only apply fade on first loop pass
      const base = now - pos;
      g.setValueAtTime(fadeVal(pos, dur, fi, fo), now);
      // ramp through the rest of this loop
      const steps = 48;
      for (let i = 1; i <= steps; i++) {
        const lp = (i / steps) * dur;
        if (lp <= pos) continue;
        g.linearRampToValueAtTime(fadeVal(lp, dur, fi, fo), base + lp);
      }
      // subsequent loops: keep at 1 (fades are a one-shot master gesture)
      g.setValueAtTime(1, base + dur);
    },

    play() {
      this.init();
      if (ctx.state === "suspended") ctx.resume();
      if (this.isPlaying) return;
      const now = ctx.currentTime + 0.02;
      this._startTime = now;
      this._sources = [];
      this.tracks.forEach((t) => {
        const src = ctx.createBufferSource();
        src.buffer = t.buffer;
        src.loop = true;
        src.loopEnd = Math.min(this.duration, t.buffer.duration);
        src.connect(t.nodes.fader);
        src.start(now, this._offset % t.buffer.duration);
        this._sources.push(src);
      });
      this.isPlaying = true;
      this._scheduleAutomation();
      this._scheduleFade();
      this._loop();
    },

    pause() {
      if (!ctx || !this.isPlaying) return;
      this._offset = this.getPlayhead();
      this._stopSources();
      this.isPlaying = false;
    },

    stop() {
      this._offset = 0;
      if (ctx) this._stopSources();
      this.isPlaying = false;
      this._emit();
    },

    _stopSources() {
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
      return (this._offset + (ctx.currentTime - this._startTime)) % this.duration;
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

    onTick(cb) { this._tickCbs.push(cb); },
    _emit() { this._tickCbs.forEach((cb) => cb()); },
    _lastLoop: 0,
    _loop() {
      if (!this.isPlaying) return;
      const ph = this.getPlayhead();
      const loopIdx = Math.floor((this._offset + (ctx.currentTime - this._startTime)) / this.duration);
      this._emit();
      requestAnimationFrame(() => this._loop());
    },

    // ---- offline render to WAV (for export) ----
    async renderMix(onProgress) {
      this.init();
      const sr = ctx.sampleRate;
      const len = Math.ceil(this.duration * sr);
      const off = new OfflineAudioContext(2, len, sr);
      // rebuild graph in offline ctx
      const conv = off.createConvolver(); conv.buffer = makeIR(off, 2.4, 2.6);
      const mBus = off.createGain();
      // 9-band master EQ
      let node = mBus;
      EQ_FREQS.forEach((f, i) => {
        const b = off.createBiquadFilter(); b.type = "peaking"; b.frequency.value = f; b.Q.value = 1.1; b.gain.value = this.master.bands[i] || 0;
        node.connect(b); node = b;
      });
      const fade = off.createGain();
      const mv = off.createGain(); mv.gain.value = this.master.volume;
      // master FX
      const mConvO = off.createConvolver(); mConvO.buffer = makeIR(off, 2.8, 3.0);
      const mRev = off.createGain(); mRev.gain.value = this.master.reverb;
      const mDel = off.createDelay(1.2); mDel.delayTime.value = 0.3;
      const mFbO = off.createGain(); mFbO.gain.value = 0.36;
      const mEch = off.createGain(); mEch.gain.value = this.master.echo;
      const mMix = off.createGain();
      const comp = off.createDynamicsCompressor();
      comp.threshold.value = -2; comp.knee.value = 4; comp.ratio.value = 12; comp.attack.value = 0.003; comp.release.value = 0.18;
      node.connect(fade); fade.connect(mv);
      mv.connect(mMix);
      mv.connect(mRev); mRev.connect(mConvO); mConvO.connect(mMix);
      mv.connect(mEch); mEch.connect(mDel); mDel.connect(mFbO); mFbO.connect(mDel); mDel.connect(mMix);
      mMix.connect(comp); comp.connect(off.destination);
      const rr = off.createGain(); rr.gain.value = 0.9; conv.connect(rr); rr.connect(mBus);
      // fade automation
      const fi = Math.min(this.master.fadeIn, this.duration / 2);
      const fo = Math.min(this.master.fadeOut, this.duration / 2);
      fade.gain.setValueAtTime(fi > 0 ? 0 : 1, 0);
      if (fi > 0) fade.gain.linearRampToValueAtTime(1, fi);
      if (fo > 0) { fade.gain.setValueAtTime(1, this.duration - fo); fade.gain.linearRampToValueAtTime(0, this.duration); }

      const anySolo = this._anySolo();
      this.tracks.forEach((t) => {
        const p = t.params;
        const audible = p.mute ? 0 : (anySolo && !p.solo ? 0 : 1);
        const src = off.createBufferSource(); src.buffer = t.buffer;
        const fd = off.createGain(); fd.gain.value = audible * p.volume;
        const ag = off.createGain();
        const fl = off.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = p.filterFreq; fl.Q.value = 0.7;
        const pn = off.createStereoPanner(); pn.pan.value = p.pan;
        const rs = off.createGain(); rs.gain.value = p.reverb;
        const es = off.createGain(); es.gain.value = p.echo;
        const dl = off.createDelay(1.0); dl.delayTime.value = 0.25;
        const fb = off.createGain(); fb.gain.value = 0.34;
        src.connect(fd); fd.connect(ag); ag.connect(fl); fl.connect(pn);
        pn.connect(mBus); pn.connect(rs); rs.connect(conv);
        pn.connect(es); es.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(mBus);
        if (p.autoOn) {
          const curve = automationCurve(p.automation, 256);
          ag.gain.setValueCurveAtTime(curve, 0, this.duration);
        }
        src.start(0);
      });
      if (onProgress) {
        let prog = 0;
        const iv = setInterval(() => { prog = Math.min(0.95, prog + Math.random() * 0.13); onProgress(prog); }, 120);
        const rendered = await off.startRendering();
        clearInterval(iv); onProgress(1);
        return rendered;
      }
      return await off.startRendering();
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
  function defaultAutomation(type) {
    if (type === "lead") return [{ t: 0, v: 0.3 }, { t: 0.25, v: 1 }, { t: 0.6, v: 1 }, { t: 1, v: 0.5 }];
    if (type === "keys") return [{ t: 0, v: 0.85 }, { t: 0.5, v: 1 }, { t: 1, v: 0.7 }];
    return [{ t: 0, v: 1 }, { t: 1, v: 1 }];
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

  Engine.automationCurve = automationCurve;
  Engine.computePeaks = computePeaks;
  window.DAW = Engine;
})();
