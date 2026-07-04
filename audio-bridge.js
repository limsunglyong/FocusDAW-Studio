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
    trackLevels: {},
    masterStereo: { l: 0, r: 0 },
    masterBandLevels: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    stretchPreviewPreparing: false
  };

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
      const hasNativeBands = nativeState.masterBandLevels.some((v) => v > 0.0001);
      return hasNativeBands ? nativeState.masterBandLevels : LocalDAW.getMasterBandLevels();
    },

    // Command forwarders. Transport commands go to the native engine only after
    // the output handover — before that the web engine is the audible output and
    // activateNativeOutput() transfers the transport state when native is ready.
    play(options) {
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
        nativeState.offset = 0;
      }
    },

    seek(t) {
      LocalDAW.seek(t);
      if (this.isNative && nativeOutputActive) {
        sendToNative({ command: "seek", positionSeconds: t });
        nativeState.offset = Math.max(0, Math.min(t, LocalDAW.duration));
        nativeState.startTime = Date.now();
      }
    },

    setTrackParam(id, key, val) {
      LocalDAW.setTrackParam(id, key, val);
      if (this.isNative) {
        // Volume automation (points array, on/off, curve toggle) is not a scalar —
        // forward the full automation state via a dedicated command so the native
        // engine can apply it during offline export.
        if (key === "automation" || key === "autoOn" || key === "autoCurve") {
          const track = LocalDAW.tracks.find((t) => t.id === id);
          if (track) sendTrackAutomationToNative(track);
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

    setMaster(key, val) {
      if (key === "volume" && this.isNative) {
        LocalDAW.setMaster(key, val);
        sendToNative({ command: "setMaster", key, value: val });
      } else {
        LocalDAW.setMaster(key, val);
        if (this.isNative) {
          sendToNative({ command: "setMaster", key, value: val });
        }
      }
    },

    setMasterBand(i, db) {
      LocalDAW.setMasterBand(i, db);
      if (this.isNative) {
        sendToNative({ command: "setMasterBand", index: i, db });
      }
    },

    setMasterGroup(group, db) {
      LocalDAW.setMasterGroup(group, db);
      if (this.isNative) {
        sendToNative({ command: "setMasterGroup", group, db });
      }
    },

    setMasterBands(arr) {
      LocalDAW.setMasterBands(arr);
      if (this.isNative) {
        sendToNative({ command: "setMasterBands", bands: arr });
      }
    },

    applyEQPreset(name) {
      LocalDAW.applyEQPreset(name);
      if (this.isNative) {
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
      if (this.isNative) sendRoomToNative();
    },

    setRoomParam(k, v) {
      LocalDAW.setRoomParam(k, v);
      if (this.isNative) sendRoomToNative();
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
      LocalDAW.removeTrack(id);
      if (this.isNative) {
        sendToNative({ command: "removeTrack", trackId: id });
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

    importProject(json) {
      LocalDAW.importProject(json);
      if (this.isNative) {
        // Send full sync project configuration to native C++ engine
        sendToNative({ command: "importProject", project: json });
        sendToNative({ command: "setLoop", enabled: !!LocalDAW.loopEnabled });
        // The native engine has no importProject handler, so explicitly push tempo +
        // key (transpose) state — otherwise an imported project plays at the original
        // key/tempo even though the UI shows the restored Key.
        syncTempoKeyToNative();
        // The FULL master state (volume/EQ/sends/room/fades) must likewise be pushed
        // explicitly — LocalDAW.importProject only applied it to the web engine.
        syncMasterToNative();
        // Since JUCE engine needs actual files, let's trigger loading for any files that have filePath
        LocalDAW.tracks.forEach(track => {
          if (track.filePath) {
            sendLoadTrack({ command: "loadTrack", trackId: track.id, filePath: track.filePath });
          }
        });
      }
    },

    async renderMix(onProgress, options = {}) {
      if (options.forceLocal || !this.isNative) {
        return LocalDAW.renderMix(onProgress, options);
      }
      const tempoRate = LocalDAW && LocalDAW._projectRate ? LocalDAW._projectRate() : 1;
      const exportDuration = tempoRate > 0 ? LocalDAW.duration / tempoRate : LocalDAW.duration;
      return new Promise((resolve, reject) => {
        const exportId = "exp_" + Date.now();
        window._activeExport = {
          exportId,
          onProgress,
          resolve,
          reject
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

      // Sync current tempo & key settings (incl. keyShift — see syncTempoKeyToNative).
      syncTempoKeyToNative();

      // Sync current track layout if already loaded
      if (LocalDAW.tracks.length > 0) {
        LocalDAW.tracks.forEach(track => syncTrackToNative(track));
      }

      // Sync the FULL master state (volume/EQ/sends/room/fades). A restored
      // project applies these to the web engine only; without this push the
      // native output plays at default master settings (e.g. volume 1.0) while
      // the mixer sliders show the restored values, until a slider is touched.
      syncMasterToNative();
      sendToNative({ command: "setLoop", enabled: !!LocalDAW.loopEnabled });

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

  // Handle incoming status messages from the JUCE C++ engine
  function handleNativeMessage(msg) {
    if (!msg || !msg.event) return;

    if (msg.event === "playbackPosition") {
      // Drop a stale "stopped" frame the 100ms timer captured BEFORE our play
      // command was processed — the engine's ack (ack:true) that follows the
      // command supersedes it. Without this the playhead flashes back to 0 for
      // a frame right after pressing play.
      const stale = !msg.ack && msg.isPlaying === false && nativeState.isPlaying &&
        (Date.now() - nativeState.lastPlaySentAt) < 500;
      if (!stale) {
        nativeState.offset = msg.positionSeconds;
        nativeState.startTime = Date.now();
        if (typeof msg.isPlaying === "boolean") {
          nativeState.isPlaying = msg.isPlaying;
        }
        LocalDAW._emit();
      }
    } else if (msg.event === "trackLoaded") {
      if (msg.trackId) onNativeTrackLoaded(msg.trackId);
      LocalDAW._emit();
    } else if (msg.event === "levels") {
      if (msg.tracks) nativeState.trackLevels = msg.tracks;
      if (msg.master) nativeState.masterStereo = msg.master;
      if (msg.masterBands) nativeState.masterBandLevels = msg.masterBands;
      // Do not call _emit on every level message to avoid React overload, React uses useTick polling
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

  // Helper to synchronize a newly added track to JUCE C++ engine
  function syncTrackToNative(track) {
    if (!track) return;
    if (track.filePath) {
      sendLoadTrack({
        command: "loadTrack",
        trackId: track.id,
        filePath: track.filePath,
        type: track.type,
        color: track.color
      });
    } else {
      // If it's a demo or synthesized track, we need its PCM data.
      // We convert it to WAV locally and save as temporary file.
      const wavBytes = bufferToWav(track.buffer);
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
            color: track.color
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

  // Periodic tick loop to update UI playhead while playing in C++ mode
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
