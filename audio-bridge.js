/* ============================================================
   FocusDAW — Audio Engine Bridge (Hybrid Web Audio / JUCE)
   ============================================================ */
(function () {
  "use strict";

  const wsUrl = "ws://localhost:8082";
  let socket = null;
  let connectionState = "connecting"; // "connecting", "connected", "failed"
  let fallbackTimer = null;
  let retryCount = 0;
  const maxRetries = 5;

  // Native Engine State Cache
  const nativeState = {
    isPlaying: false,
    startTime: 0,
    offset: 0,
    lastPlaySentAt: 0,
    lastSeekSentAt: 0,
    trackLevels: {},
    masterStereo: { l: 0, r: 0 },
    masterBandLevels: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    hasNativeBandData: false, // true once the native engine broadcasts masterBands
    stretchPreviewPreparing: false,
    audioDevices: null,        // last "audioDevices" event from the native engine
    audioDeviceResolvers: [],  // pending requestAudioDevices() promises
    audioInputRequestSeq: 0,
    audioInputPending: {},
    audioInputResolvers: [],
    inputLevel: 0,
    inputGr: 0,
    recording: false,
    recordingRequestedAt: 0,
    recordingResolve: null,
    recordingReject: null
  };

  // App-specific audio output device (Settings dialog). Stored locally — this is
  // an app preference, not project data. { type, name } with JUCE's names; absent
  // or empty = system default device.
  const AUDIO_DEVICE_KEY = "focusdaw-audio-device";
  const AUDIO_INPUT_KEY = "focusdaw-audio-input";
  function loadSavedAudioDevice() {
    try { return JSON.parse(localStorage.getItem(AUDIO_DEVICE_KEY) || "null"); } catch (e) { return null; }
  }
  // Called when the saved audio device fails to open on launch (e.g. an Exclusive
  // device that can't do Exclusive). Clearing it prevents the broken selection
  // from being re-applied on the next launch, where it could block the whole
  // device-list enumeration (symptom: no devices in any mode).
  function resetSavedAudioDeviceOnLaunchFailure(err) {
    try { localStorage.removeItem(AUDIO_DEVICE_KEY); } catch (e) {}
    try { localStorage.removeItem(AUDIO_INPUT_KEY); } catch (e) {}
    console.warn("[AudioBridge] Saved audio device could not open on launch — reset to system default.", err || "");
  }

  // Web → native output handover. On connect the native engine still has to
  // decode every synced track (async loadTrack), so the web engine keeps playing
  // audibly until all pending loads report back via "trackLoaded". Only then is
  // the web output muted and the current transport state (position + playing)
  // handed to the native engine. Before this fix the web was muted immediately
  // on connect and an in-progress playback was silently dropped: sound cut out
  // and the playhead snapped to 0 until the user pressed Stop+Play.
  let nativeOutputActive = false;        // native is the audible output (post-handover)
  const pendingNativeLoads = new Set();  // trackIds sent to native, not yet loaded
  let handoverFallbackTimer = null;

  function sendLoadTrack(msg) {
    if (!(socket && socket.readyState === WebSocket.OPEN)) return;
    pendingNativeLoads.add(msg.trackId);
    if (!nativeOutputActive) armHandoverFallback();
    sendToNative(msg);
  }

  function onNativeTrackLoaded(trackId) {
    pendingNativeLoads.delete(trackId);
    if (!nativeOutputActive) armHandoverFallback(); // loads are progressing
    maybeActivateNativeOutput();
  }

  function maybeActivateNativeOutput() {
    if (!Bridge.isNative || nativeOutputActive) return;
    if (pendingNativeLoads.size > 0) return;
    activateNativeOutput();
  }

  function activateNativeOutput() {
    if (!Bridge.isNative || nativeOutputActive) return;
    nativeOutputActive = true;
    clearTimeout(handoverFallbackTimer);
    handoverFallbackTimer = null;

    // Hand the current transport state over. These commands queue after all
    // loadTrack commands the native engine has already finished, so they apply
    // to a fully loaded project.
    const pos = LocalDAW.getPlayhead();
    sendToNative({ command: "seek", positionSeconds: pos });
    nativeState.offset = Math.max(0, Math.min(pos, LocalDAW.duration));
    nativeState.startTime = Date.now();
    if (LocalDAW.isPlaying) {
      sendToNative({ command: "play" });
      nativeState.isPlaying = true;
      nativeState.lastPlaySentAt = Date.now();
      startLocalTickLoop();
    } else {
      nativeState.isPlaying = false;
    }

    // Native engine is now the sole audio output. Mute the local web-audio output
    // so the two engines don't play the same tracks simultaneously (double playback
    // → drifting clocks, phasing, doubled FX, half-applied mute/solo). LocalDAW is
    // still driven for state/automation/playhead, just silenced at the speakers.
    try { LocalDAW.setOutputMuted(true); } catch (e) {}
    console.log("[AudioBridge] Native output active (all pending track loads done).");
    LocalDAW._emit();
  }

  function resetNativeProjectState() {
    sendToNative({ command: "clearTracks" });
    pendingNativeLoads.clear();
    clearTimeout(handoverFallbackTimer);
    handoverFallbackTimer = null;
    nativeOutputActive = false;
    nativeState.isPlaying = false;
    nativeState.offset = 0;
    nativeState.startTime = 0;
    nativeState.lastPlaySentAt = 0;
    nativeState.lastSeekSentAt = 0;
    nativeState.trackLevels = {};
    nativeState.masterStereo = { l: 0, r: 0 };
    nativeState.masterBandLevels = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    nativeState.hasNativeBandData = false;
    lastLoopRangeSent = ""; // the engine's copy is gone with the project; force a resend
    try { LocalDAW.setOutputMuted(false); } catch (e) {}
  }

  // If the engine never reports its loads (e.g. an outdated binary without the
  // trackLoaded event), fall back to activating after 15s without progress so we
  // don't stay on the web engine forever.
  function armHandoverFallback() {
    if (nativeOutputActive) return;
    clearTimeout(handoverFallbackTimer);
    handoverFallbackTimer = setTimeout(() => {
      if (Bridge.isNative && !nativeOutputActive) {
        console.warn("[AudioBridge] trackLoaded events stalled; activating native output anyway.");
        pendingNativeLoads.clear();
        activateNativeOutput();
      }
    }, 15000);
  }

  // We capture the original DAW engine (Web Audio API)
  const LocalDAW = window.DAW;
  window.LocalDAW = LocalDAW;

  // Audio Bridge Adapter
  const Bridge = {
    isNative: false,
    
    init() {
      // Always initialize LocalDAW so that the context and demo tracks are ready for fallback
      LocalDAW.init();

      // Point the web engine at the saved output device right away — before the
      // native handover (and in web-only fallback) the web engine is what's audible.
      const savedDev = loadSavedAudioDevice();
      if (savedDev && savedDev.name) LocalDAW.setOutputDevice(savedDev.name);

      // If we are in Electron and not connected yet, try connecting
      if (window.electronAPI && connectionState === "connecting" && !socket) {
        setupWebSocket();
      }
    },

    // Native State getters. All fall back to the web engine until the output
    // handover completes — before that the native transport is idle and its
    // state (stopped at 0) must not drive the UI.
    getPlayhead() {
      if (!this.isNative || !nativeOutputActive) return LocalDAW.getPlayhead();
      if (!nativeState.isPlaying) return nativeState.offset;
      const rate = LocalDAW._projectRate();
      const elapsed = (Date.now() - nativeState.startTime) / 1000;
      const raw = nativeState.offset + elapsed * rate;
      if (LocalDAW.repeatPlayEnabled && LocalDAW.loopRange) {
        if (raw >= LocalDAW.loopRange.end) {
          const len = LocalDAW.loopRange.end - LocalDAW.loopRange.start;
          if (len > 0) {
            return LocalDAW.loopRange.start + ((raw - LocalDAW.loopRange.start) % len);
          }
          return LocalDAW.loopRange.start;
        }
        return Math.max(LocalDAW.loopRange.start, Math.min(raw, LocalDAW.loopRange.end));
      }
      return LocalDAW.loopEnabled ? (raw % LocalDAW.duration) : Math.min(raw, LocalDAW.duration);
    },

    getTrackLevel(id) {
      if (!this.isNative || !nativeOutputActive) return LocalDAW.getTrackLevel(id);
      return nativeState.trackLevels[id] || 0;
    },

    getMasterLevel() {
      if (!this.isNative || !nativeOutputActive) return LocalDAW.getMasterLevel();
      const nativeLevel = (nativeState.masterStereo.l + nativeState.masterStereo.r) / 2;
      return nativeLevel > 0.0001 ? nativeLevel : LocalDAW.getMasterLevel();
    },

    getMasterStereoLevels() {
      if (!this.isNative || !nativeOutputActive) return LocalDAW.getMasterStereoLevels();
      const nativeLevel = (nativeState.masterStereo.l + nativeState.masterStereo.r) / 2;
      return nativeLevel > 0.0001 ? nativeState.masterStereo : LocalDAW.getMasterStereoLevels();
    },

    getMasterBandLevels() {
      if (!this.isNative || !nativeOutputActive) return LocalDAW.getMasterBandLevels();
      // Once the native engine broadcasts band levels, always use them — the old
      // any-nonzero check fell back to the muted web engine during silence, which
      // painted the web engine's reverb tail on the spectrum meter.
      if (nativeState.hasNativeBandData) return nativeState.masterBandLevels;
      return LocalDAW.getMasterBandLevels();
    },

    // --- Audio output device selection (Settings dialog) -----------------------
    // The native engine owns the audible device via JUCE; the web engine mirrors
    // the choice via setSinkId so pre-handover / fallback playback uses the same
    // interface. The selection is an app preference persisted in localStorage.
    getSavedAudioDevice() { return loadSavedAudioDevice(); },

    requestAudioDevices() {
      if (!this.isNative || !socket || socket.readyState !== WebSocket.OPEN)
        return Promise.resolve(null); // web-only mode: no native device list
      return new Promise((resolve) => {
        nativeState.audioDeviceResolvers.push(resolve);
        sendToNative({ command: "listAudioDevices" });
        setTimeout(() => { // don't leave the dialog hanging if the engine stalls
          const i = nativeState.audioDeviceResolvers.indexOf(resolve);
          if (i >= 0) { nativeState.audioDeviceResolvers.splice(i, 1); resolve(nativeState.audioDevices); }
        }, 10000);
      });
    },

    setAudioDevice(type, name) {
      try {
        if (!type && !name) localStorage.removeItem(AUDIO_DEVICE_KEY);
        else localStorage.setItem(AUDIO_DEVICE_KEY, JSON.stringify({ type: type || "", name: name || "" }));
      } catch (e) {}
      LocalDAW.setOutputDevice(name || "");
      if (this.isNative) sendToNative({ command: "setAudioDevice", type: type || "", name: name || "" });
    },

    getSavedAudioInput() {
      try { return JSON.parse(localStorage.getItem(AUDIO_INPUT_KEY) || "null"); } catch (e) { return null; }
    },

    // Input channel names of the currently open device (from the last audioDevices
    // event), so the per-track input port dropdown reflects the real interface.
    getInputChannelNames() {
      const cur = nativeState.audioDevices && nativeState.audioDevices.current;
      return cur && Array.isArray(cur.inputChannelNames) ? cur.inputChannelNames : [];
    },

    setAudioInput(settings) {
      const next = {
        type: settings && settings.type || "",
        name: settings && settings.name || "",
        channel: Number(settings && settings.channel) || 0,
        stereo: !!(settings && settings.stereo),
        sampleRate: Number(settings && settings.sampleRate) || 0,
        bufferSize: Number(settings && settings.bufferSize) || 0
      };
      try { localStorage.setItem(AUDIO_INPUT_KEY, JSON.stringify(next)); } catch (e) {}
      if (!this.isNative) return Promise.resolve();
      // Only an EXPLICIT outputName (from the Settings dialog via applyDeviceSetup)
      // may change the output endpoint in the same setup call — that is what keeps
      // an Exclusive-mode device switch atomic. Per-track arm/record must NOT pass
      // an output, so the native side preserves the current output device. Auto-
      // pairing the saved output here rerouted playback + monitoring off the device
      // the user was listening on when arming, which made MON go silent.
      const outputName = (settings && settings.outputName) || "";
      const payload = { ...next, outputName };
      const key = JSON.stringify(payload);
      // NO "already applied this exact payload" cache here. It assumed the same request
      // always deserves the same answer, but the answer depends on hardware that changes
      // underneath us: unplug the mic and the identical payload must now FAIL and say so.
      // The cache resolved it from memory instead, so the engine was never asked, its
      // "unknown input device" check never ran, and recording silently produced silence —
      // for the rest of the session, replug or not (only an app restart cleared it).
      // The engine has its own keep-warm fast path for a genuinely unchanged device, so
      // asking every time costs a round trip, not a WASAPI reopen.
      // `audioInputPending` below still de-dupes requests that are IN FLIGHT — that is a
      // different thing and stays.
      return new Promise((resolve, reject) => {
        let requestId = nativeState.audioInputPending[key];
        if (!requestId) {
          requestId = `input-${++nativeState.audioInputRequestSeq}`;
          nativeState.audioInputPending[key] = requestId;
          sendToNative({ command: "setAudioInput", requestId, ...payload });
        }
        nativeState.audioInputResolvers.push({ requestId, key, resolve, reject, sentAt: performance.now() });
      });
    },

    // Unified device setup for the Settings dialog: one mode/type drives BOTH the
    // input and output endpoint so they can never end up on conflicting device
    // types (the root of the Exclusive-mode howling bug). Persists both choices
    // and applies them atomically via setAudioInput's outputName pairing.
    applyDeviceSetup(cfg) {
      const type = (cfg && cfg.type) || "";
      const inputName = (cfg && cfg.inputName) || "";
      const outputName = (cfg && cfg.outputName) || "";
      // Back up the current persisted selection so a failed open (e.g. a device
      // that can't do Exclusive) does not leave a broken choice saved — that
      // broken choice would be re-applied on the next launch and block device
      // enumeration (no device list at all).
      const prevDev = localStorage.getItem(AUDIO_DEVICE_KEY);
      const prevInput = localStorage.getItem(AUDIO_INPUT_KEY);
      const restorePrev = () => {
        try {
          if (prevDev == null) localStorage.removeItem(AUDIO_DEVICE_KEY); else localStorage.setItem(AUDIO_DEVICE_KEY, prevDev);
          if (prevInput == null) localStorage.removeItem(AUDIO_INPUT_KEY); else localStorage.setItem(AUDIO_INPUT_KEY, prevInput);
        } catch (e) {}
      };
      try {
        if (!type && !outputName) localStorage.removeItem(AUDIO_DEVICE_KEY);
        else localStorage.setItem(AUDIO_DEVICE_KEY, JSON.stringify({ type, name: outputName }));
      } catch (e) {}
      LocalDAW.setOutputDevice(outputName || "");
      if (inputName) {
        // Pass outputName explicitly so the input+output are applied atomically
        // (keeps the Exclusive-mode switch from stranding the output on a stale
        // default). Per-track arm/record does NOT pass outputName, so it leaves
        // the output — and thus monitoring routing — untouched.
        return this.setAudioInput({
          type, name: inputName, outputName,
          channel: Number(cfg && cfg.channel) || 0,
          stereo: !!(cfg && cfg.stereo),
          sampleRate: Number(cfg && cfg.sampleRate) || 0,
          bufferSize: Number(cfg && cfg.bufferSize) || 0,
        }).catch((e) => { restorePrev(); throw e; });
      }
      // No input chosen: set output only and drop any stale saved input so a
      // reconnect does not grab an input device (esp. exclusively).
      try { localStorage.removeItem(AUDIO_INPUT_KEY); } catch (e) {}
      this.setAudioDevice(type, outputName);
      return Promise.resolve();
    },

    getInputLevel() { return nativeState.inputLevel || 0; },
    getInputGainReduction() { return nativeState.inputGr || 0; },

    setInputGain(gain) {
      const value = Math.max(0.1, Math.min(4, Number.isFinite(+gain) ? +gain : 1));
      if (this.isNative) sendToNative({ command: "setInputGain", gain: value });
    },

    startRecording(options) {
      if (!this.isNative) return Promise.reject(new Error("Native audio engine is required for recording."));
      if (nativeState.recordingResolve) return Promise.reject(new Error("A recording is already active."));
      return new Promise((resolve, reject) => {
        nativeState.recordingResolve = resolve;
        nativeState.recordingReject = reject;
        nativeState.recordingRequestedAt = performance.now();
        sendToNative({ command: "startRecording", ...options });
      });
    },

    stopRecording(filePath) {
      if (this.isNative) sendToNative({ command: "stopRecording", filePath });
    },

    cancelRecording() {
      if (this.isNative) sendToNative({ command: "cancelRecording" });
      nativeState.recording = false;
      nativeState.recordingResolve = null;
      nativeState.recordingReject = null;
    },

    // Temporary master-FX bypass (Output FX EFFECT button). The web engine
    // bypasses at the node level; the native engine mirrors it via neutral
    // parameter pushes (state in LocalDAW.master stays untouched on both sides).
    setMasterFxBypass(bypassed) {
      LocalDAW.setMasterFxBypass(bypassed);
      pushMasterFxStateToNative();
    },

    // Command forwarders. Transport commands go to the native engine only after
    // the output handover — before that the web engine is the audible output and
    // activateNativeOutput() transfers the transport state when native is ready.
    play(options) {
      if (LocalDAW.repeatPlayEnabled && LocalDAW.loopRange) {
        const currentPh = this.getPlayhead();
        if (currentPh < LocalDAW.loopRange.start || currentPh > LocalDAW.loopRange.end) {
          this.seek(LocalDAW.loopRange.start);
        }
      }
      LocalDAW.play(options); // Keep LocalDAW state in sync
      if (this.isNative && nativeOutputActive) {
        sendToNative({ command: "play", options });
        nativeState.isPlaying = true;
        nativeState.startTime = Date.now();
        nativeState.lastPlaySentAt = Date.now();
        startLocalTickLoop();
      }
    },

    pause() {
      if (this.isNative && nativeOutputActive) {
        const pauseOffset = this.getPlayhead();
        LocalDAW.pause();
        sendToNative({ command: "pause" });
        nativeState.isPlaying = false;
        nativeState.offset = pauseOffset;
      } else {
        LocalDAW.pause();
      }
    },

    stop() {
      LocalDAW.stop();
      if (this.isNative && nativeOutputActive) {
        sendToNative({ command: "stop" });
        nativeState.isPlaying = false;
        if (LocalDAW.repeatPlayEnabled && LocalDAW.loopRange) {
          nativeState.offset = LocalDAW.loopRange.start;
          sendToNative({ command: "seek", positionSeconds: LocalDAW.loopRange.start });
        } else {
          nativeState.offset = 0;
        }
      }
    },

    seek(t) {
      LocalDAW.seek(t);
      if (this.isNative && nativeOutputActive) {
        nativeState.lastSeekSentAt = Date.now();
        sendToNative({ command: "seek", positionSeconds: t });
        nativeState.offset = Math.max(0, Math.min(t, LocalDAW.duration));
        nativeState.startTime = Date.now();
      }
    },

    // Timeline click seek (ruler / track lane / Output FX lane). While Repeat is on the
    // playhead is "jailed" inside the loop range: a click that lands OUTSIDE the range is
    // ignored so the section keeps looping instead of the end-wrap yanking it to the start
    // (past-end click) or playback escaping the loop (before-start click). Clicks inside
    // the range seek normally. Deliberate transport nav (Return-to-start, arrow nudge)
    // keeps using seek() directly and is not restricted.
    userSeek(t) {
      if (LocalDAW.repeatPlayEnabled && LocalDAW.loopRange &&
          (t < LocalDAW.loopRange.start || t > LocalDAW.loopRange.end)) {
        return;
      }
      this.seek(t);
    },

    setTrackParam(id, key, val) {
      const track = LocalDAW.tracks.find((t) => t.id === id);
      LocalDAW.setTrackParam(id, key, val);
      if ((key === "solo" || key === "mute" || key === "bpmSource") && track && track.needsAudio) return;
      if (this.isNative) {
        // Volume automation (points array, on/off, curve toggle) is not a scalar —
        // forward the full automation state via a dedicated command so the native
        // engine can apply it during offline export.
        if (key === "automation" || key === "autoOn" || key === "autoCurve") {
          const automationTrack = LocalDAW.tracks.find((t) => t.id === id);
          if (automationTrack) sendTrackAutomationToNative(automationTrack);
        } else {
          sendToNative({ command: "setTrackParam", trackId: id, key, value: val });
        }
      }
    },

    clearAllMuteSolo() {
      LocalDAW.clearAllMuteSolo();
      if (this.isNative) {
        sendToNative({ command: "clearAllMuteSolo" });
      }
    },

    setProjectBpm(bpm) {
      const res = LocalDAW.setProjectBpm(bpm);
      if (this.isNative && res) {
        sendToNative({ command: "setProjectBpm", bpm: LocalDAW.tempo.projectBpm });
      }
      return res;
    },

    setPlaybackBpm(bpm) {
      const res = LocalDAW.setPlaybackBpm(bpm);
      if (this.isNative && res) {
        sendToNative({ command: "setPlaybackBpm", bpm: LocalDAW.tempo.playbackBpm });
      }
      return res;
    },

    adjustPlaybackBpm(delta) {
      const res = LocalDAW.adjustPlaybackBpm(delta);
      if (this.isNative && res) {
        sendToNative({ command: "setPlaybackBpm", bpm: LocalDAW.tempo.playbackBpm });
      }
      return res;
    },

    setVariBpm(on) {
      const res = LocalDAW.setVariBpm(on);
      if (this.isNative) {
        sendToNative({ command: "setVariBpm", on: !!on });
      }
      return res;
    },

    setVariKey(on) {
      const res = LocalDAW.setVariKey(on);
      if (this.isNative) {
        sendToNative({ command: "setVariKey", on: !!on });
      }
      return res;
    },

    setLoop(val) {
      LocalDAW.setLoop(val);
      if (this.isNative) {
        sendToNative({ command: "setLoop", enabled: !!val });
      }
    },

    setLoopRange(range) {
      LocalDAW.setLoopRange(range);
      pushLoopRangeToNative();
    },

    // Count-in metronome (Phase 6 Stage 2). Native-only by design, and not a gap:
    // recording itself is native-only (the web engine has no getUserMedia), so a
    // count-in click with no native engine has nothing to count into. The native
    // click is generated in its own device callback, which is what keeps it out of
    // the recorded WAV and out of Export (see MetronomeClick in AudioEngine.h).
    startCountIn(bpm, beats) {
      if (!this.isNative || !nativeOutputActive) return false;
      if (!(bpm > 0) || !(beats > 0)) return false;
      sendToNative({ command: "startCountIn", bpm, beats: beats | 0 });
      return true;
    },

    stopMetronome() {
      if (!this.isNative) return;
      sendToNative({ command: "stopMetronome" });
    },

    // Pull playback into the repeat range EXACTLY ONCE (called on loop-region drag end).
    // Repeat only self-sustains via the END boundary (the native engine wraps there; the
    // web engine's rAF loop restarts there), so a region moved AHEAD of the playhead is
    // never entered on its own. We deliberately do NOT snap continuously during the drag — doing
    // that (as the reverted v1.15.2 did in the position-frame wrap) fires a seek per frame
    // while the region is still moving, which restarts the SoundTouch grain repeatedly and
    // produces a buzzing drone. A single seek on release behaves like a normal user seek.
    // Judge "outside the loop" from the RAW transport position, not getPlayhead() — the
    // latter clamps into [start,end] while repeat is on and would hide an outside playhead.
    snapPlayheadToLoop() {
      if (!LocalDAW.repeatPlayEnabled || !LocalDAW.loopRange) return;
      let raw;
      if (this.isNative && nativeOutputActive) {
        if (nativeState.isPlaying) {
          const rate = LocalDAW._projectRate();
          raw = nativeState.offset + (Date.now() - nativeState.startTime) / 1000 * rate;
        } else {
          raw = nativeState.offset;
        }
      } else {
        raw = LocalDAW.getPlayhead(); // web engine getPlayhead does not clamp to loopRange
      }
      if (raw < LocalDAW.loopRange.start || raw >= LocalDAW.loopRange.end) {
        this.seek(LocalDAW.loopRange.start);
      }
    },

    setRepeatPlayEnabled(on) {
      const on2 = !!on;
      // Read the TRUE playhead BEFORE flipping the flag. Once repeatPlayEnabled is
      // true, the native getPlayhead() clamps/wraps its result into the loop range,
      // which hides a playhead sitting outside (esp. ahead of) the loop and defeats
      // the "snap into loop" check below. this.getPlayhead()/this.seek() both handle
      // native vs web-only internally, so a single path covers both engines.
      const phBefore = this.getPlayhead();
      // During the first Electron native-output handover, the native position cache
      // can briefly lag behind the Web Audio transport that was driving the visible
      // playhead. Treat the local transport as corroborating evidence: only snap when
      // BOTH positions are outside. This preserves the intended outside-range snap
      // while preventing an in-range playhead from jumping to the start on the first
      // Repeat enable.
      const localPhBefore = (this.isNative && nativeOutputActive)
        ? LocalDAW.getPlayhead()
        : phBefore;
      LocalDAW.repeatPlayEnabled = on2;
      if (on2 && LocalDAW.loopRange) {
        const { start, end } = LocalDAW.loopRange;
        const nativeOutside = phBefore < start || phBefore > end;
        const localOutside = localPhBefore < start || localPhBefore > end;
        if (nativeOutside && localOutside) {
          this.seek(start);
        }
      }
      pushLoopRangeToNative();
      LocalDAW._emit();
    },

    setKeyShift(semitones) {
      const res = LocalDAW.setKeyShift(semitones);
      if (this.isNative) {
        // Send the integer semitone offset the engine resolved (already clamped).
        sendToNative({ command: "setKeyShift", semitones: LocalDAW.tempo.keyShift });
        // Keep the native key string in sync for display/back-compat.
        sendToNative({ command: "setKey", key: LocalDAW.tempo.key });
      }
      return res;
    },

    setKey(key) {
      const res = LocalDAW.setKey(key);
      if (this.isNative) {
        sendToNative({ command: "setKey", key: key });
      }
      return res;
    },

    setDetectedKey(key) {
      const res = LocalDAW.setDetectedKey(key);
      if (this.isNative) {
        sendToNative({ command: "setDetectedKey", key: key });
      }
      return res;
    },

    // While the Output FX EFFECT bypass is active, effect edits are stored in
    // LocalDAW.master (the web engine guards its own nodes) but must NOT reach the
    // native engine — it is running neutral values. Lifting the bypass re-pushes
    // the full, latest master state via syncMasterToNative().
    _fxEditBlocked(key) {
      const fxKeys = ["reverb", "echo", "widener", "saturation", "exciter"];
      return LocalDAW.masterFxBypassed && (key === undefined || fxKeys.includes(key));
    },

    setMaster(key, val) {
      LocalDAW.setMaster(key, val);
      if (this.isNative && !this._fxEditBlocked(key)) {
        sendToNative({ command: "setMaster", key, value: val });
      }
    },

    setMasterBand(i, db) {
      LocalDAW.setMasterBand(i, db);
      if (this.isNative && !LocalDAW.masterFxBypassed) {
        sendToNative({ command: "setMasterBand", index: i, db });
      }
    },

    setMasterGroup(group, db) {
      LocalDAW.setMasterGroup(group, db);
      if (this.isNative && !LocalDAW.masterFxBypassed) {
        sendToNative({ command: "setMasterGroup", group, db });
      }
    },

    setMasterBands(arr) {
      LocalDAW.setMasterBands(arr);
      if (this.isNative && !LocalDAW.masterFxBypassed) {
        sendToNative({ command: "setMasterBands", bands: arr });
      }
    },

    applyEQPreset(name) {
      LocalDAW.applyEQPreset(name);
      if (this.isNative && !LocalDAW.masterFxBypassed) {
        // The native engine has no applyEQPreset handler (manual band drags use
        // setMasterBand, which is why those worked but presets didn't). Forward the
        // resolved 9-band values — LocalDAW.master.bands now holds the preset — via
        // the setMasterBands command the engine already understands.
        sendToNative({ command: "setMasterBands", bands: LocalDAW.master.bands });
      }
    },

    // Ambience (room type). The native engine implements the same procedural room IR
    // convolution as the web engine, so forward the resolved roomParams after LocalDAW
    // applies the preset / fine-tune so realtime native playback (and export) get it.
    setRoom(key) {
      LocalDAW.setRoom(key);
      if (this.isNative && !LocalDAW.masterFxBypassed) sendRoomToNative();
    },

    setRoomParam(k, v) {
      LocalDAW.setRoomParam(k, v);
      if (this.isNative && !LocalDAW.masterFxBypassed) sendRoomToNative();
    },

    // Track addition: run locally (for waveforms) and sync with JUCE
    async addFileBuffer(name, arrayBuffer, options = {}) {
      const track = await LocalDAW.addFileBuffer(name, arrayBuffer, options);
      if (this.isNative && track) {
        syncTrackToNative(track);
      }
      return track;
    },

    async addFile(file) {
      const track = await LocalDAW.addFile(file);
      if (this.isNative && track) {
        syncTrackToNative(track);
      }
      return track;
    },

    addBounceTrack(name, buffer, options = {}) {
      const track = LocalDAW.addBounceTrack(name, buffer, options);
      if (this.isNative && track) {
        syncTrackToNative(track);
      }
      return track;
    },

    addAudioInTrack(name) {
      return LocalDAW.addAudioInTrack(name);
    },

    async attachRecording(trackId, name, arrayBuffer, options = {}) {
      const track = await LocalDAW.attachRecording(trackId, name, arrayBuffer, options);
      if (this.isNative && track) syncTrackToNative(track);
      return track;
    },

    // Phase 5 clip editing (전략 B): run on the web engine, then re-sync the
    // affected track's baked layout to native. copyClip is pure clipboard state,
    // so it falls through the proxy to LocalDAW unchanged (no native sync needed).
    moveClip(trackId, clipId, newStart) {
      const ok = LocalDAW.moveClip(trackId, clipId, newStart);
      if (ok && this.isNative) syncTrackToNative(LocalDAW.tracks.find(t => t.id === trackId));
      return ok;
    },
    trimClipStart(trackId, clipId, newStart) {
      const ok = LocalDAW.trimClipStart(trackId, clipId, newStart);
      if (ok && this.isNative) syncTrackToNative(LocalDAW.tracks.find(t => t.id === trackId));
      return ok;
    },
    trimClipEnd(trackId, clipId, newEnd) {
      const ok = LocalDAW.trimClipEnd(trackId, clipId, newEnd);
      if (ok && this.isNative) syncTrackToNative(LocalDAW.tracks.find(t => t.id === trackId));
      return ok;
    },
    deleteClip(trackId, clipId) {
      const ok = LocalDAW.deleteClip(trackId, clipId);
      if (ok && this.isNative) syncTrackToNative(LocalDAW.tracks.find(t => t.id === trackId));
      return ok;
    },
    deleteRange(trackId, from, to) {
      const ok = LocalDAW.deleteRange(trackId, from, to);
      if (ok && this.isNative) syncTrackToNative(LocalDAW.tracks.find(t => t.id === trackId));
      return ok;
    },
    duplicateClip(trackId, clipId, atStart) {
      const id = LocalDAW.duplicateClip(trackId, clipId, atStart);
      if (id && this.isNative) syncTrackToNative(LocalDAW.tracks.find(t => t.id === trackId));
      return id;
    },
    pasteClip(trackId, atStart) {
      const id = LocalDAW.pasteClip(trackId, atStart);
      if (id && this.isNative) syncTrackToNative(LocalDAW.tracks.find(t => t.id === trackId));
      return id;
    },
    nudgeClip(trackId, clipId, deltaSec) {
      const ok = LocalDAW.nudgeClip(trackId, clipId, deltaSec);
      if (ok && this.isNative) syncTrackToNative(LocalDAW.tracks.find(t => t.id === trackId));
      return ok;
    },
    moveClipsBy(trackId, clipIds, deltaSec) {
      const d = LocalDAW.moveClipsBy(trackId, clipIds, deltaSec);
      if (d && this.isNative) syncTrackToNative(LocalDAW.tracks.find(t => t.id === trackId));
      return d;
    },
    moveClipsByResolved(trackId, clipIds, deltaSec) {
      const d = LocalDAW.moveClipsByResolved(trackId, clipIds, deltaSec);
      if (d && this.isNative) syncTrackToNative(LocalDAW.tracks.find(t => t.id === trackId));
      return d;
    },
    deleteClips(trackId, clipIds) {
      const ok = LocalDAW.deleteClips(trackId, clipIds);
      if (ok && this.isNative) syncTrackToNative(LocalDAW.tracks.find(t => t.id === trackId));
      return ok;
    },
    splitClip(trackId, clipId, atSec) {
      LocalDAW.splitClip(trackId, clipId, atSec);
      if (this.isNative) syncTrackToNative(LocalDAW.tracks.find(t => t.id === trackId));
    },
    joinClips(trackId, clipIdA, clipIdB) {
      LocalDAW.joinClips(trackId, clipIdA, clipIdB);
      if (this.isNative) syncTrackToNative(LocalDAW.tracks.find(t => t.id === trackId));
    },

    addDemoTracks() {
      LocalDAW.addDemoTracks();
      if (this.isNative) {
        LocalDAW.tracks.forEach(track => {
          syncTrackToNative(track);
        });
      }
    },

    // Track removal: drop it locally (stops the web source + disconnects nodes) and
    // tell the native engine to drop it too, so neither engine keeps playing a track
    // the user deleted from the header.
    removeTrack(id) {
      const fxWasBypassed = LocalDAW.masterFxBypassed;
      LocalDAW.removeTrack(id);
      if (this.isNative) {
        sendToNative({ command: "removeTrack", trackId: id });
        pendingNativeLoads.delete(id); // an in-flight load of this track is voided
        // Last track removed → both engines stop (web via LocalDAW.removeTrack,
        // native inside its removeTrack). Mirror that here so the UI doesn't show
        // the stale position for the ~100ms until the next native broadcast.
        if (LocalDAW.tracks.length === 0) {
          nativeState.isPlaying = false;
          nativeState.offset = 0;
          maybeActivateNativeOutput();
          // Emptying the project lifted the EFFECT bypass inside LocalDAW.removeTrack;
          // the native engine is still holding the neutral values — re-push the real ones.
          if (fxWasBypassed && !LocalDAW.masterFxBypassed) pushMasterFxStateToNative();
        }
      }
    },

    clearTracks() {
      LocalDAW.clearTracks();
      if (this.isNative) {
        sendToNative({ command: "clearTracks" });
        // Native drops its queued (not yet started) loads without reporting them,
        // so clear our pending set too or the output handover would wait on
        // trackLoaded events that will never come.
        pendingNativeLoads.clear();
        maybeActivateNativeOutput();
        // Native clearTracks only drops the tracks; it does not reset master effects.
        // Push the freshly-reset master state (LocalDAW.clearTracks just restored the
        // defaults) so a New Project starts clean instead of inheriting the previous
        // project's EQ / reverb / echo / widener / saturation / exciter / volume.
        syncMasterToNative();
        nativeState.offset = 0;
        nativeState.isPlaying = false;
      }
    },

    // Edit ▸ "Delete all tracks" (keep master fx). Without this wrapper the DAW
    // proxy fell through to LocalDAW only, so the native engine kept (and kept
    // playing) its copies of the deleted tracks. Master state is preserved by
    // design, so unlike clearTracks() we do NOT reset it on the native side —
    // except when the EFFECT bypass was active: LocalDAW.clearTracksKeepMaster
    // lifts it, so the neutral values on native must be replaced with the real ones.
    clearTracksKeepMaster() {
      const fxWasBypassed = LocalDAW.masterFxBypassed;
      LocalDAW.clearTracksKeepMaster();
      if (this.isNative) {
        sendToNative({ command: "clearTracks" });
        pendingNativeLoads.clear();
        maybeActivateNativeOutput();
        if (fxWasBypassed && !LocalDAW.masterFxBypassed) pushMasterFxStateToNative();
        nativeState.offset = 0;
        nativeState.isPlaying = false;
      }
    },

    applySnapshot(snap) {
      const wasNative = this.isNative;
      if (wasNative) resetNativeProjectState();
      LocalDAW.applySnapshot(snap);
      if (wasNative) {
        syncTempoKeyToNative();
        syncMasterToNative();
        LocalDAW.tracks.forEach(track => {
          if (track && track.buffer && !track.needsAudio) syncTrackToNative(track);
        });
        sendToNative({ command: "setLoop", enabled: !!LocalDAW.loopEnabled });
        pushLoopRangeToNative();
        if (LocalDAW.masterFxBypassed) pushMasterFxStateToNative();
        maybeActivateNativeOutput();
        if (!nativeOutputActive) armHandoverFallback();
      }
    },

    importProject(json) {
      // The EFFECT bypass is a transient A/B state — a newly opened project
      // always starts with its effects audible.
      if (LocalDAW.masterFxBypassed) LocalDAW.setMasterFxBypass(false);
      if (this.isNative) resetNativeProjectState();
      LocalDAW.importProject(json);
      if (this.isNative) {
        sendToNative({ command: "setLoop", enabled: !!LocalDAW.loopEnabled });
        pushLoopRangeToNative();
        // The native engine has no importProject handler, so explicitly push tempo +
        // key (transpose) state — otherwise an imported project plays at the original
        // key/tempo even though the UI shows the restored Key.
        syncTempoKeyToNative();
        // The FULL master state (volume/EQ/sends/room/fades) must likewise be pushed
        // explicitly — LocalDAW.importProject only applied it to the web engine.
        syncMasterToNative();
        // Only load tracks that already have decoded audio. Missing placeholders are
        // reconnected by app.jsx first; this avoids native keeping or retrying stale paths.
        LocalDAW.tracks.forEach(track => {
          if (track.filePath && !track.needsAudio) {
            const clip = Array.isArray(track.clips) ? track.clips[0] : null;
            sendLoadTrack({ command: "loadTrack", trackId: track.id, filePath: track.filePath,
              startSeconds: clip && clip.start > 0 ? clip.start : 0,
              songLength: LocalDAW.duration || 0 });
          }
        });
      }
    },

    async renderMix(onProgress, options = {}) {
      if (options.forceLocal || !this.isNative) {
        return LocalDAW.renderMix(onProgress, options);
      }
      // The native export renders with the engine's LIVE master params. If the
      // EFFECT bypass is active they are neutral — restore the real values for
      // the render and re-apply the bypass afterwards (export always includes fx).
      const fxWasBypassed = LocalDAW.masterFxBypassed;
      if (fxWasBypassed) syncMasterToNative();
      const restoreBypass = (v) => {
        if (fxWasBypassed) pushMasterFxStateToNative();
        return v;
      };
      const tempoRate = LocalDAW && LocalDAW._projectRate ? LocalDAW._projectRate() : 1;
      const exportDuration = tempoRate > 0 ? LocalDAW.duration / tempoRate : LocalDAW.duration;
      return new Promise((resolve, reject) => {
        const exportId = "exp_" + Date.now();
        window._activeExport = {
          exportId,
          onProgress,
          resolve: (v) => resolve(restoreBypass(v)),
          reject: (e) => { restoreBypass(); reject(e); }
        };
        // Re-sync the current key state so the offline render matches realtime
        // playback even if the user exported without ever starting playback.
        const t = LocalDAW.tempo || {};
        sendToNative({ command: "setVariKey", on: !!t.variKey });
        sendToNative({ command: "setDetectedKey", key: t.detectedKey ?? null });
        sendToNative({ command: "setKeyShift", semitones: t.keyShift | 0 });
        sendToNative({ command: "setKey", key: t.key ?? null });
        // Master fade in/out — convert project-second fade lengths to the export
        // (output) timeline exactly like LocalDAW.renderMix (fadeIn/graphRate, clamped
        // to half the render duration), so the native render matches the web fallback.
        const m = LocalDAW.master || {};
        const fadeInOut = (v) => Math.min(Math.max(0, (v || 0) / (tempoRate > 0 ? tempoRate : 1)), exportDuration / 2);
        sendToNative({
          command: "export",
          exportId,
          format: options.format || "wav",
          sampleRate: options.sampleRate || 44100,
          bitrate: options.bitrate || 320,
          normalize: options.normalize !== false,
          lufsTarget: options.lufsTarget || -14.0,
          preservePitch: !!options.preservePitch,
          duration: exportDuration,
          fadeIn: fadeInOut(m.fadeIn),
          fadeOut: fadeInOut(m.fadeOut)
        });
      });
    },

    async mergeTracks(trackIds, onProgress, options = {}) {
      return LocalDAW.mergeTracks(trackIds, onProgress, { ...options, forceLocal: true });
    }
  };

  // Setup WebSocket connection to JUCE Audio Engine
  function setupWebSocket() {
    console.log(`[AudioBridge] Connecting to JUCE Audio Engine at ${wsUrl}... (Attempt ${retryCount + 1}/${maxRetries + 1})`);
    
    socket = new WebSocket(wsUrl);
    
    fallbackTimer = setTimeout(() => {
      if (connectionState === "connecting") {
        console.warn("[AudioBridge] JUCE Engine WebSocket connection timeout.");
        handleConnectionFailure();
      }
    }, 3000); // 3000ms connect timeout

    socket.onopen = () => {
      clearTimeout(fallbackTimer);
      connectionState = "connected";
      Bridge.isNative = true;
      retryCount = 0;
      console.log("[AudioBridge] Connected to JUCE Native Audio Engine!");

      // NOTE: the web output is NOT muted here. Tracks below still have to be
      // decoded by the native engine, so the web engine stays the audible output
      // (an already-running playback keeps going) until every pending load
      // reports back — see activateNativeOutput(), which mutes the web engine
      // and hands the transport state over.

      // Send initial handshake/init command
      sendToNative({ command: "init", sampleRate: LocalDAW.ctx ? LocalDAW.ctx.sampleRate : 44100 });

      // Restore the app-specific output device (Settings dialog). The native engine
      // always boots on the system default; like tempo/key/master state it must be
      // re-pushed on every (re)connect.
      const savedDev = loadSavedAudioDevice();
      let savedInput = null;
      try { savedInput = JSON.parse(localStorage.getItem(AUDIO_INPUT_KEY) || "null"); } catch (e) {}
      if (savedInput && savedInput.name) {
        // Apply input+output in ONE command so the type switch never leaves the
        // output on a stale default (Exclusive-mode howling / wrong device). Pair
        // the saved output only when it shares the input's mode/type.
        const sameType = savedDev && (savedDev.type || "") === (savedInput.type || "");
        const outputName = sameType ? (savedDev.name || "") : "";
        // Self-heal: if this saved device can't be opened on launch (e.g. an
        // Exclusive device that can't do Exclusive), reset it to the system
        // default so it isn't re-applied — and left blocking enumeration — next
        // launch. The result comes back on audioInputChanged.
        nativeState.startupDeviceReapply = true;
        sendToNative({ command: "setAudioInput", requestId: "startup-device", ...savedInput, outputName });
      } else if (savedInput) {
        // A saved input with an EMPTY name means the user has used the DEFAULT
        // input before (via + Audio In, which persists AUDIO_INPUT_KEY). Boot
        // opens the device OUTPUT-ONLY, so the FIRST setAudioInput has to cold-
        // reopen WASAPI to add the input channel — and doing that mid-playback
        // froze the transport and bounced the playhead to 0 (v1.20.10). Warm the
        // default input HERE, while idle, so that reopen is invisible and later
        // (mid-playback) adds hit the native "keep warm" fast path instead.
        // Restore the saved OUTPUT first (with self-heal), then warm the input
        // preserving it (empty outputName). Use a distinct requestId so a warm
        // failure (e.g. no input device on this machine) does NOT reset the saved
        // output the way "startup-device" does — there is no input name to heal.
        if (savedDev && (savedDev.type || savedDev.name)) {
          nativeState.startupDeviceReapply = true;
          sendToNative({ command: "setAudioDevice", type: savedDev.type || "", name: savedDev.name || "" });
        }
        sendToNative({ command: "setAudioInput", requestId: "startup-warm", ...savedInput, outputName: "" });
      } else if (savedDev && (savedDev.type || savedDev.name)) {
        nativeState.startupDeviceReapply = true;
        sendToNative({ command: "setAudioDevice", type: savedDev.type || "", name: savedDev.name || "" });
      }

      // Sync current tempo & key settings (incl. keyShift — see syncTempoKeyToNative).
      syncTempoKeyToNative();

      // Sync current track layout if already loaded. This is already a full push at the
      // current duration, so suppress the per-track songLength re-sync hook (it would make
      // each track trigger another full pass) and seed lastPushedSongLength directly.
      if (LocalDAW.tracks.length > 0) {
        syncingAllTracks = true;
        LocalDAW.tracks.forEach(track => syncTrackToNative(track));
        syncingAllTracks = false;
        lastPushedSongLength = LocalDAW.duration || 0;
      }

      // Sync the FULL master state (volume/EQ/sends/room/fades). A restored
      // project applies these to the web engine only; without this push the
      // native output plays at default master settings (e.g. volume 1.0) while
      // the mixer sliders show the restored values, until a slider is touched.
      syncMasterToNative();
      sendToNative({ command: "setLoop", enabled: !!LocalDAW.loopEnabled });
      lastLoopRangeSent = ""; // a fresh engine knows nothing; never let the dedupe skip
      pushLoopRangeToNative();

      // If the Output FX EFFECT bypass is active, syncMasterToNative just pushed
      // the real values — override them with neutral ones so both engines match.
      if (LocalDAW.masterFxBypassed) pushMasterFxStateToNative();

      // No tracks to load → native is ready right away; otherwise the handover
      // fires from onNativeTrackLoaded once the last pending load reports in.
      maybeActivateNativeOutput();
      if (!nativeOutputActive) armHandoverFallback();

      LocalDAW._emit();
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleNativeMessage(msg);
      } catch (err) {
        console.error("[AudioBridge] Error parsing native message:", err);
      }
    };

    socket.onerror = (err) => {
      console.warn("[AudioBridge] WebSocket error:", err);
      if (connectionState === "connecting") {
        clearTimeout(fallbackTimer);
        handleConnectionFailure();
      }
    };

    socket.onclose = () => {
      if (connectionState === "connected") {
        console.warn("[AudioBridge] JUCE Engine connection closed. Falling back to Local Web Audio.");
        switchToLocal();
      }
    };
  }

  function handleConnectionFailure() {
    if (socket) {
      try { socket.close(); } catch(e){}
      socket = null;
    }
    if (retryCount < maxRetries) {
      retryCount++;
      connectionState = "connecting";
      console.log(`[AudioBridge] Connection failed. Retrying in 1000ms...`);
      setTimeout(setupWebSocket, 1000);
    } else {
      console.warn("[AudioBridge] JUCE Engine connection failed after max retries. Falling back to Local Web Audio.");
      switchToLocal();
    }
  }

  function switchToLocal() {
    connectionState = "failed";
    Bridge.isNative = false;
    socket = null;
    nativeOutputActive = false;
    pendingNativeLoads.clear();
    clearTimeout(handoverFallbackTimer);
    handoverFallbackTimer = null;
    // Native engine is gone — un-mute the web output so the local fallback is audible.
    try { LocalDAW.setOutputMuted(false); } catch (e) {}
    LocalDAW._emit();
  }

  // Forward the current ambience (room) spec to the native engine, which builds the
  // matching room IR. Defaults mirror audio-engine.js makeRoomIR for any absent field.
  function sendRoomToNative() {
    const p = (LocalDAW.master && LocalDAW.master.roomParams) || {};
    sendToNative({
      command: "setMasterRoom",
      decay: p.decay ?? 0.001,
      shape: p.shape ?? 2,
      preDelay: p.preDelay ?? 0,
      wet: p.wet ?? 0,
      damp: p.damp ?? 20000,
      width: p.width ?? 1,
      echo: p.echo ?? 0,
      size: p.size ?? 0.5,
      erGain: p.erGain ?? 1,
    });
  }

  function sendToNative(obj) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(obj));
    }
  }

  // Mirror the web engine's master-FX bypass on the native engine: push neutral
  // effect values while bypassed, re-push the real master state when lifted.
  // LocalDAW.master keeps the real values throughout, so syncMasterToNative()
  // restores everything (incl. the ambience room spec).
  function pushMasterFxStateToNative() {
    if (!Bridge.isNative) return;
    if (LocalDAW.masterFxBypassed) {
      sendToNative({ command: "setMasterBands", bands: [0, 0, 0, 0, 0, 0, 0, 0, 0] });
      ["reverb", "echo", "widener", "saturation", "exciter"].forEach((k) =>
        sendToNative({ command: "setMaster", key: k, value: 0 }));
      sendToNative({ command: "setMasterRoom", decay: 0.001, shape: 2, preDelay: 0, wet: 0, damp: 20000, width: 1, echo: 0, size: 0.5, erGain: 1 });
    } else {
      syncMasterToNative();
    }
  }

  // Push the COMPLETE master section state to the native engine. Like tempo/key,
  // the native side has no importProject handler, so this must run on (re)connect,
  // after every project import, and after clearTracks — otherwise the native output
  // keeps its previous/default master volume, EQ bands, reverb/echo sends, widener,
  // saturation, exciter, ambience and fades while the UI shows the restored values
  // (audible mismatch until the user touches a control, which re-sends that one key).
  function syncMasterToNative() {
    const m = LocalDAW.master || {};
    if (Array.isArray(m.bands)) sendToNative({ command: "setMasterBands", bands: m.bands });
    sendToNative({ command: "setMaster", key: "volume", value: (m.volume ?? 1) });
    sendToNative({ command: "setMaster", key: "reverb", value: m.reverb || 0 });
    sendToNative({ command: "setMaster", key: "echo", value: m.echo || 0 });
    sendToNative({ command: "setMaster", key: "widener", value: m.widener || 0 });
    sendToNative({ command: "setMaster", key: "saturation", value: m.saturation || 0 });
    sendToNative({ command: "setMaster", key: "exciter", value: m.exciter || 0 });
    sendToNative({ command: "setMaster", key: "fadeIn", value: m.fadeIn || 0 });
    sendToNative({ command: "setMaster", key: "fadeOut", value: m.fadeOut || 0 });
    sendRoomToNative(); // ambience (room IR) spec
  }

  // Push the full tempo + key (transpose) state to the native engine. The native side
  // has no "importProject" handler — its DSP state is driven entirely by these
  // individual commands — so this must run on (re)connect and after every project
  // import, or a restored project plays at the wrong key/tempo. Crucially keyShift
  // must be sent: updateDspParams() derives the pitch shift from the integer keyShift,
  // not from the key strings, so omitting it leaves the engine at the original pitch.
  function syncTempoKeyToNative() {
    const t = LocalDAW.tempo;
    if (!t) return;
    if (t.projectBpm) sendToNative({ command: "setProjectBpm", bpm: t.projectBpm });
    if (t.playbackBpm) sendToNative({ command: "setPlaybackBpm", bpm: t.playbackBpm });
    sendToNative({ command: "setVariBpm", on: !!t.variBpm });
    sendToNative({ command: "setVariKey", on: !!t.variKey });
    if (t.detectedKey) sendToNative({ command: "setDetectedKey", key: t.detectedKey });
    sendToNative({ command: "setKeyShift", semitones: t.keyShift | 0 });
    if (t.key) sendToNative({ command: "setKey", key: t.key });
  }

  // Push the Repeat region to the native engine, which wraps playback at the loop end
  // inside its audio callback (Phase 6 Stage 0) instead of being polled and seeked from
  // here. Like tempo/key, the native side has no importProject — this must run on
  // (re)connect and after every import/snapshot restore, or a restored project's Repeat
  // region silently reverts to whole-song looping.
  let lastLoopRangeSent = "";
  function pushLoopRangeToNative() {
    if (!Bridge.isNative) return;
    const r = LocalDAW.loopRange;
    const enabled = !!(LocalDAW.repeatPlayEnabled && r && r.end > r.start);
    const msg = {
      command: "setLoopRange",
      enabled,
      start: enabled ? r.start : 0,
      end: enabled ? r.end : 0,
    };
    // Dragging the loop region calls setLoopRange on every mousemove; only the ones
    // that actually move the range are worth a command.
    const sig = JSON.stringify(msg);
    if (sig === lastLoopRangeSent) return;
    lastLoopRangeSent = sig;
    sendToNative(msg);
  }

  // Handle incoming status messages from the JUCE C++ engine
  function handleNativeMessage(msg) {
    if (!msg || !msg.event) return;

    if (msg.event === "playbackPosition") {
      // Drop a stale "stopped" frame the 100ms timer captured BEFORE our play
      // command was processed — the engine's ack (ack:true) that follows the
      // command supersedes it. Without this the playhead flashes back to 0 for
      // a frame right after pressing play. Also drop stale frames shortly after seek.
      const stale = (!msg.ack && msg.isPlaying === false && nativeState.isPlaying &&
        (Date.now() - nativeState.lastPlaySentAt) < 500) ||
        (!msg.ack && (Date.now() - nativeState.lastSeekSentAt) < 500);
      if (!stale) {
        nativeState.offset = msg.positionSeconds;
        nativeState.startTime = Date.now();
        if (typeof msg.isPlaying === "boolean") {
          nativeState.isPlaying = msg.isPlaying;
        }

        // The loop wrap used to be forced from here (seek back whenever a broadcast
        // arrived past the loop end). Since Phase 6 Stage 0 the engine wraps itself at
        // the exact sample inside its audio callback, so a seek from here would only
        // fight it: a broadcast is up to 100ms old, and by the time it arrives the
        // engine has already rewound and is legitimately playing inside the range again.
        LocalDAW._emit();
      }
    } else if (msg.event === "trackLoaded") {
      if (msg.trackId) onNativeTrackLoaded(msg.trackId);
      LocalDAW._emit();
    } else if (msg.event === "levels") {
      if (msg.tracks) nativeState.trackLevels = msg.tracks;
      if (msg.master) nativeState.masterStereo = msg.master;
      if (msg.masterBands) {
        nativeState.masterBandLevels = msg.masterBands;
        nativeState.hasNativeBandData = true;
      }
      if (typeof msg.input === "number") nativeState.inputLevel = msg.input;
      if (typeof msg.inputGr === "number") nativeState.inputGr = msg.inputGr;
      if (typeof msg.recording === "boolean") nativeState.recording = msg.recording;
      // Do not call _emit on every level message to avoid React overload, React uses useTick polling
    } else if (msg.event === "audioDevices") {
      nativeState.audioDevices = msg;
      nativeState.audioDeviceResolvers.splice(0).forEach((resolve) => resolve(msg));
      LocalDAW._emit();
    } else if (msg.event === "audioDeviceChanged") {
      if (nativeState.startupDeviceReapply) {
        nativeState.startupDeviceReapply = false;
        if (!msg.ok) resetSavedAudioDeviceOnLaunchFailure(msg.error);
      }
      if (!msg.ok) console.warn("[AudioBridge] Audio device change failed:", msg.error);
      LocalDAW._emit();
    } else if (msg.event === "audioInputChanged") {
      if (msg.requestId === "startup-device" || nativeState.startupDeviceReapply) {
        nativeState.startupDeviceReapply = false;
        if (!msg.ok) resetSavedAudioDeviceOnLaunchFailure(msg.error);
      }
      const requestId = msg.requestId || (nativeState.audioInputResolvers[0] && nativeState.audioInputResolvers[0].requestId);
      const matching = nativeState.audioInputResolvers.filter((entry) => entry.requestId === requestId);
      nativeState.audioInputResolvers = nativeState.audioInputResolvers.filter((entry) => entry.requestId !== requestId);
      const completedKey = matching[0] && matching[0].key;
      if (completedKey) delete nativeState.audioInputPending[completedKey];
      matching.forEach((entry) => {
        console.log(`[AudioInputTiming] setAudioInput ${msg.ok ? "ready" : "failed"} in ${(performance.now() - entry.sentAt).toFixed(1)}ms`);
        if (msg.ok) entry.resolve();
        else entry.reject(new Error(msg.error || "Audio input could not be prepared."));
      });
      if (!msg.ok) console.warn("[AudioBridge] Audio input change failed:", msg.error);
      LocalDAW._emit();
    } else if (msg.event === "audioInputLost") {
      // The engine saw the configured input device leave the system. Tell the UI so it
      // can drop ARM — an armed track on a device that is gone shows a dead meter and no
      // error, which is how a user concludes the app is broken (T-1.25.2 특이사항).
      // Nothing is reopened here: that would close the OUTPUT too and cut playback.
      console.warn("[AudioBridge] Input device lost:", msg.name || "(unknown)");
      window.dispatchEvent(new CustomEvent("focusdaw-audio-input-lost", { detail: { name: msg.name || "" } }));
      LocalDAW._emit();
    } else if (msg.event === "recordingStarted") {
      nativeState.recording = !!msg.ok;
      if (nativeState.recordingRequestedAt) {
        console.log(`[AudioInputTiming] recordingStarted ${msg.ok ? "ready" : "failed"} in ${(performance.now() - nativeState.recordingRequestedAt).toFixed(1)}ms (native ${Number(msg.elapsedMs) || 0}ms)`);
        nativeState.recordingRequestedAt = 0;
      }
      if (!msg.ok && nativeState.recordingReject) {
        nativeState.recordingReject(new Error(msg.error || "Recording could not start."));
        nativeState.recordingResolve = null;
        nativeState.recordingReject = null;
      }
      LocalDAW._emit();
    } else if (msg.event === "recordingPeaks") {
      const track = LocalDAW.tracks.find((t) => t.kind === "audioIn" && t.recording);
      if (track && Array.isArray(msg.points)) {
        if (!Array.isArray(track._recordingPeaks)) track._recordingPeaks = [];
        track._recordingPeaks.push(...msg.points);
        track._recordingSampleRate = Number(msg.sampleRate) || track._recordingSampleRate || 44100;
        const lastSample = msg.points.length >= 3 ? Number(msg.points[msg.points.length - 3]) : 0;
        const recordedEnd = (track._recordingStart || 0) + lastSample / track._recordingSampleRate;
        if (!track._recordingDurationLimit && recordedEnd >= LocalDAW.duration - 1) LocalDAW.duration = recordedEnd + 60;
        track.audioRev = (track.audioRev || 0) + 1;
        LocalDAW._emit();
      }
    } else if (msg.event === "recordingStopped") {
      nativeState.recording = false;
      if (msg.ok && nativeState.recordingResolve) nativeState.recordingResolve(msg);
      else if (nativeState.recordingReject) nativeState.recordingReject(new Error(msg.error || "Recording failed."));
      nativeState.recordingResolve = null;
      nativeState.recordingReject = null;
      LocalDAW._emit();
    } else if (msg.event === "recordingCancelled") {
      nativeState.recording = false;
      nativeState.recordingResolve = null;
      nativeState.recordingReject = null;
      LocalDAW._emit();
    } else if (msg.event === "stretchPreviewPreparing") {
      nativeState.stretchPreviewPreparing = !!msg.preparing;
      LocalDAW._emit();
    } else if (msg.event === "exportProgress") {
      if (window._activeExport && window._activeExport.exportId === msg.exportId) {
        if (window._activeExport.onProgress) {
          window._activeExport.onProgress(msg.progress);
        }
      }
    } else if (msg.event === "exportDone") {
      if (window._activeExport && window._activeExport.exportId === msg.exportId) {
        const resolve = window._activeExport.resolve;
        window._activeExport = null;
        resolve({ isNative: true, tempFilePath: msg.tempFilePath });
      }
    } else if (msg.event === "exportError") {
      if (window._activeExport && window._activeExport.exportId === msg.exportId) {
        const reject = window._activeExport.reject;
        window._activeExport = null;
        reject(new Error(msg.error || "Native export failed"));
      }
    }
  }

  // The native engine plays each track as a single in-memory buffer looped at its
  // OWN length. A short Audio In recording (e.g. 1s) among full-length stems would
  // therefore repeat every second. Pass the clip's timeline start and the song
  // length so native can place the clip with lead-in silence and pad it out to the
  // song length — then per-track looping wraps at the song boundary, in sync.
  function trackTimelinePlacement(track) {
    const clip = track && Array.isArray(track.clips) ? track.clips[0] : null;
    return {
      startSeconds: clip && clip.start > 0 ? clip.start : 0,
      songLength: (LocalDAW && LocalDAW.duration) || 0,
    };
  }

  // Phase 5: a clip-edited track's t.buffer is a baked layout (전략 B) whose audio
  // no longer matches its original filePath, and whose clip positions are already
  // baked in (leading silence included). Such a track must be pushed to native as
  // its baked PCM with startSeconds=0, NOT via the original filePath. A trivial
  // (un-edited) layout still uses the fast filePath path.
  function trackIsBakedLayout(track) {
    return !!(track && LocalDAW && typeof LocalDAW._isTrivialLayout === "function"
      && track.buffer && !LocalDAW._isTrivialLayout(track));
  }

  // The native engine loops each track at its OWN padded buffer length (songLength baked
  // in at load time — AudioEngine.cpp decodeAndInstallTrack + per-track setLooping). All
  // tracks must therefore share the SAME songLength, or they wrap at different points: a
  // file track loaded when the song was 2:55 keeps looping at 2:55 even after a clip is
  // moved/recorded out to 3:30, so it "restarts from the top" partway through while the
  // rest of the mix plays on. syncTrackToNative pushes the CURRENT duration for the one
  // track it syncs; the others go stale. When the project GROWS, re-push every track's
  // songLength so the whole mix loops as one. Same mechanism the reconnect path uses.
  let lastPushedSongLength = 0;
  let syncingAllTracks = false; // re-entrancy guard: suppress the per-track hook during a bulk push
  function ensureSongLengthConsistent() {
    if (!Bridge.isNative || syncingAllTracks) return;
    const d = LocalDAW.duration || 0;
    if (Math.abs(d - lastPushedSongLength) < 0.01) return; // duration unchanged → nothing stale
    lastPushedSongLength = d;
    syncingAllTracks = true;
    // Skip a track that is still recording — re-decoding it mid-take would drop the input.
    LocalDAW.tracks.forEach((t) => { if (t.buffer && !t.needsAudio && !t.recording) syncTrackToNative(t); });
    syncingAllTracks = false;
  }

  // Helper to synchronize a newly added track to JUCE C++ engine
  function syncTrackToNative(track) {
    if (!track) return;
    const place = trackTimelinePlacement(track);
    const baked = trackIsBakedLayout(track);
    if (track.filePath && !baked) {
      sendLoadTrack({
        command: "loadTrack",
        trackId: track.id,
        filePath: track.filePath,
        type: track.type,
        color: track.color,
        startSeconds: place.startSeconds,
        songLength: place.songLength
      });
    } else if (track.buffer) {
      // Demo/synthesized track (no filePath), OR a baked clip-edited layout: push
      // the in-memory PCM as a temp WAV. Baked layouts carry their clip positions
      // inside the buffer, so startSeconds is 0.
      const wavBytes = bufferToWav(track.buffer);
      const startSeconds = baked ? 0 : place.startSeconds;
      if (window.electronAPI && window.electronAPI.writeTempAudio) {
        // Reserve the pending slot NOW so the handover can't slip through the
        // gap while the temp WAV is being written.
        pendingNativeLoads.add(track.id);
        if (!nativeOutputActive) armHandoverFallback();
        window.electronAPI.writeTempAudio(wavBytes, track.name).then((tmpPath) => {
          sendLoadTrack({
            command: "loadTrack",
            trackId: track.id,
            filePath: tmpPath,
            type: track.type,
            color: track.color,
            startSeconds: startSeconds,
            songLength: place.songLength
          });
        }).catch((err) => {
          console.warn("[AudioBridge] writeTempAudio failed:", err);
          pendingNativeLoads.delete(track.id);
          maybeActivateNativeOutput();
        });
      }
    }

    // Sync current params (incl. per-track reverb/echo sends — the native engine
    // stores them in TrackInfo and applies them when the async decode installs).
    sendToNative({ command: "setTrackParam", trackId: track.id, key: "volume", value: track.params.volume });
    sendToNative({ command: "setTrackParam", trackId: track.id, key: "pan", value: track.params.pan });
    sendToNative({ command: "setTrackParam", trackId: track.id, key: "mute", value: track.params.mute });
    sendToNative({ command: "setTrackParam", trackId: track.id, key: "solo", value: track.params.solo });
    sendToNative({ command: "setTrackParam", trackId: track.id, key: "reverb", value: track.params.reverb || 0 });
    sendToNative({ command: "setTrackParam", trackId: track.id, key: "echo", value: track.params.echo || 0 });
    sendTrackAutomationToNative(track);

    // If this edit grew (or shrank) the project, the OTHER tracks now hold a stale
    // songLength and would loop at the wrong point. Re-push them all to the new length.
    // Guarded so a bulk push does not recurse per track.
    ensureSongLengthConsistent();
  }

  // Forward a track's volume automation to the native engine as an interleaved
  // [t0,v0,t1,v1,...] float array (t normalized 0..1, v gain 0..1), plus the on/off
  // and curve-fitting flags. The native engine applies this during offline export.
  function sendTrackAutomationToNative(track) {
    if (!track) return;
    const p = track.params || {};
    const pts = Array.isArray(p.automation) ? p.automation : [];
    const flat = [];
    for (const pt of pts) { flat.push(pt.t, pt.v); }
    sendToNative({
      command: "setTrackAutomation",
      trackId: track.id,
      autoOn: !!p.autoOn,
      curved: !!p.autoCurve,
      points: flat,
    });
  }

  // Convert AudioBuffer to WAV ArrayBuffer
  function bufferToWav(buffer) {
    const numOfChan = buffer.numberOfChannels,
      length = buffer.length * numOfChan * 2 + 44,
      bufferArr = new ArrayBuffer(length),
      view = new DataView(bufferArr),
      channels = [],
      sampleRate = buffer.sampleRate;
    let i, sample, offset = 0, pos = 0;

    // write WAV header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"
    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16);         // chunk length
    setUint16(1);          // sample format (raw PCM)
    setUint16(numOfChan);
    setUint32(sampleRate);
    setUint32(sampleRate * numOfChan * 2); // byte rate
    setUint16(numOfChan * 2);              // block align
    setUint16(16);                         // bits per sample
    setUint32(0x61746164); // "data" chunk
    setUint32(length - pos - 4); // chunk length

    for (i = 0; i < numOfChan; i++) channels.push(buffer.getChannelData(i));

    while (pos < length) {
      for (i = 0; i < numOfChan; i++) {
        sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
        sample = (sample < 0 ? sample * 0x8000 : sample * 0x7fff) | 0; // scale to 16-bit
        view.setInt16(pos, sample, true);
        pos += 2;
      }
      offset++;
    }

    return bufferArr;

    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }
  }

  // Periodic tick loop to update the UI playhead while playing in C++ mode. This used
  // to ALSO drive the Repeat wrap (poll the playhead every 30ms, seek back once it had
  // already overshot the loop end) — which made every iteration a different length and
  // let the error accumulate. The engine now wraps at the exact sample in its audio
  // callback (Phase 6 Stage 0, `setLoopRange`), so this is purely a UI refresh; the
  // wrap the playbar shows comes from Bridge.getPlayhead(), which models the same range.
  let localTickInterval = null;
  function startLocalTickLoop() {
    if (localTickInterval) clearInterval(localTickInterval);
    localTickInterval = setInterval(() => {
      if (!nativeState.isPlaying) {
        clearInterval(localTickInterval);
        return;
      }
      LocalDAW._emit();
    }, 30);
  }

  // Construct Proxy to transparently forward all other properties/methods of DAW to LocalDAW
  const DAWProxy = new Proxy(Bridge, {
    get(target, prop, receiver) {
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      // Delegate to LocalDAW
      const val = LocalDAW[prop];
      if (typeof val === "function") {
        return function (...args) {
          return val.apply(LocalDAW, args);
        };
      }
      return val;
    },
    set(target, prop, value, receiver) {
      if (prop in target) {
        return Reflect.set(target, prop, value, receiver);
      }
      return Reflect.set(LocalDAW, prop, value);
    }
  });

  window.DAW = DAWProxy;

  // Auto initialize on script load
  if (document.readyState === "complete" || document.readyState === "interactive") {
    Bridge.init();
  } else {
    window.addEventListener("DOMContentLoaded", () => Bridge.init());
  }
})();
