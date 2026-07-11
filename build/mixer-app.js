const channel = new BroadcastChannel("focusdaw-mixer-sync");
window.DAW = {
  tracks: [],
  master: {
    volume: 1,
    reverb: 0,
    echo: 0,
    saturation: 0,
    widener: 0,
    exciter: 0,
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    fadeIn: 0,
    fadeOut: 0
  },
  EQ_FREQS: [60, 150, 320, 640, 1200, 2400, 4800, 9e3, 15e3],
  _levels: {},
  _masterLevel: 0,
  _masterStereo: { l: 0, r: 0 },
  _masterBandLevels: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  _inputLevel: 0,
  _fftData: [],
  _isPlaying: false,
  _playhead: 0,
  _inputChannelNames: [],
  _anySolo() {
    return this.tracks.some((t) => t.params.solo);
  },
  getInputChannelNames() {
    return this._inputChannelNames || [];
  },
  getTrackLevel(id) {
    return this._levels[id] || 0;
  },
  getMasterLevel() {
    return this._masterLevel;
  },
  getMasterStereoLevels() {
    return this._masterStereo || { l: this._masterLevel, r: this._masterLevel };
  },
  getMasterBandLevels() {
    return this._masterBandLevels;
  },
  getInputLevel() {
    return this._inputLevel || 0;
  },
  computeSpectrum() {
    return this._fftData;
  },
  setTrackParam(id, k, v) {
    const t = this.tracks.find((tr) => tr.id === id);
    if (t && t.needsAudio && (k === "solo" || k === "mute")) return;
    if (t) {
      t.params[k] = v;
    }
    channel.postMessage({ type: "SET_TRACK_PARAM", id, k, v });
  },
  // Shift+Mute on a file-track channel toggles Mute for ALL file tracks at once
  // (file tracks only). The main window is authoritative and echoes the result
  // back via SYNC_STATE.
  muteAllFileTracks(next) {
    const on = !!next;
    this.tracks.forEach((t) => {
      if (t.kind === "file" && t.params) t.params.mute = on;
    });
    channel.postMessage({ type: "MUTE_ALL_FILES", v: on });
  },
  setMaster(k, v) {
    this.master[k] = v;
    channel.postMessage({ type: "SET_MASTER_PARAM", k, v });
  },
  setMasterBand(i, v) {
    this.master.bands[i] = v;
    this.master.eqPreset = null;
    channel.postMessage({ type: "SET_MASTER_BAND", i, v });
  },
  applyEQPreset(name) {
    this.master.eqPreset = name === "Flat" ? null : name;
    channel.postMessage({ type: "APPLY_EQ_PRESET", name });
  }
};
let _fxPulseStyleInjected = false;
function focusFxKnob(trackId, param) {
  if (!_fxPulseStyleInjected) {
    const st = document.createElement("style");
    st.textContent = "@keyframes fxKnobPulse{0%,100%{box-shadow:0 0 0 0 rgba(232,176,75,0)}25%{box-shadow:0 0 0 3px var(--amber),0 0 16px 3px var(--amber)}}.fx-knob-pulse{animation:fxKnobPulse .6s ease-in-out 2}";
    document.head.appendChild(st);
    _fxPulseStyleInjected = true;
  }
  const sel = `[data-track-id="${window.CSS && CSS.escape ? CSS.escape(trackId) : trackId}"][data-fx="${param}"]`;
  let tries = 0;
  const attempt = () => {
    const el = document.querySelector(sel);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      if (el._fxPulseTimer) clearTimeout(el._fxPulseTimer);
      el.classList.remove("fx-knob-pulse");
      void el.offsetWidth;
      el.classList.add("fx-knob-pulse");
      el._fxPulseTimer = setTimeout(() => {
        el.classList.remove("fx-knob-pulse");
        el._fxPulseTimer = null;
      }, 1400);
      return;
    }
    if (tries++ < 40) requestAnimationFrame(attempt);
  };
  attempt();
}
function MixerApp() {
  useTick();
  const [theme, setTheme] = React.useState("default");
  const [mixerTexture, setMixerTexture] = React.useState("none");
  const [, force] = React.useState(0);
  React.useEffect(() => {
    channel.postMessage({ type: "MIXER_READY" });
    const handleMessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "INIT_STATE") {
        window.DAW.tracks = msg.tracks;
        window.DAW.master = msg.master;
        setTheme(msg.theme);
        setMixerTexture(msg.mixerTexture || "none");
        window.DAW._inputChannelNames = Array.isArray(msg.inputChannelNames) ? msg.inputChannelNames : [];
        window.DAW._isPlaying = !!msg.isPlaying;
        window.DAW._playhead = msg.playhead || 0;
        force((n) => n + 1);
      } else if (msg.type === "SYNC_STATE") {
        window.DAW.tracks = msg.tracks;
        window.DAW.master = msg.master;
        if (msg.theme) setTheme(msg.theme);
        if (msg.mixerTexture) setMixerTexture(msg.mixerTexture);
        if (Array.isArray(msg.inputChannelNames)) window.DAW._inputChannelNames = msg.inputChannelNames;
        window.DAW._isPlaying = !!msg.isPlaying;
        window.DAW._playhead = msg.playhead || 0;
        force((n) => n + 1);
      } else if (msg.type === "FOCUS_KNOB") {
        focusFxKnob(msg.trackId, msg.param);
      } else if (msg.type === "LEVEL_METERS") {
        window.DAW._levels = msg.trackLevels;
        window.DAW._inputLevel = msg.inputLevel || 0;
        window.DAW._masterLevel = msg.masterLevel;
        window.DAW._masterStereo = msg.masterStereo || { l: msg.masterLevel, r: msg.masterLevel };
        window.DAW._masterBandLevels = msg.masterBandLevels;
        window.DAW._fftData = msg.fftData;
        window.DAW._isPlaying = !!msg.isPlaying;
        window.DAW._playhead = msg.playhead || 0;
      }
    };
    channel.addEventListener("message", handleMessage);
    const onVisible = () => {
      if (document.visibilityState === "visible") channel.postMessage({ type: "MIXER_SHOWN" });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      channel.removeEventListener("message", handleMessage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  React.useEffect(() => {
    const root = document.documentElement;
    if (theme === "default") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
  React.useEffect(() => {
    const k = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "F3") {
        e.preventDefault();
        handleWinAction("close");
        return;
      }
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        channel.postMessage({ type: "REQUEST_UNDO" });
        return;
      }
      if (mod && (e.key === "y" || e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        channel.postMessage({ type: "REQUEST_REDO" });
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        channel.postMessage({ type: "REQUEST_PLAY_PAUSE" });
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  React.useEffect(() => {
    if (window.electronAPI && window.electronAPI.reportMixerSize) {
      const handleResize = () => {
        window.electronAPI.reportMixerSize(window.innerWidth, window.innerHeight);
      };
      window.addEventListener("resize", handleResize);
      handleResize();
      return () => window.removeEventListener("resize", handleResize);
    }
  }, []);
  const handleWinAction = (action) => {
    if (window.electronAPI && window.electronAPI.winAction) {
      window.electronAPI.winAction(action);
    } else {
      if (action === "close") window.close();
    }
  };
  const handleWindowButton = (e, action) => {
    e.currentTarget.blur();
    handleWinAction(action);
  };
  const suppressFocus = (e) => e.preventDefault();
  const isMac = window.electronAPI && window.electronAPI.platform === "darwin";
  const playing = window.DAW._isPlaying;
  return /* @__PURE__ */ React.createElement("div", { className: "mixer-app" }, /* @__PURE__ */ React.createElement("div", { className: "mixer-titlebar", style: { position: "relative" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement(Icon, { name: "mixer", size: 14, style: { color: "var(--amber)" } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, fontWeight: 700, letterSpacing: ".06em", color: "var(--cream-2)" } }, "MIXER CONSOLE")), /* @__PURE__ */ React.createElement("div", { style: {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%,-50%)",
    display: "flex",
    alignItems: "center",
    gap: 12
  } }, /* @__PURE__ */ React.createElement("div", { className: "title-c", style: { flex: "none" } }, "FocusDAW Studio ", /* @__PURE__ */ React.createElement("b", null, "Mixer")), /* @__PURE__ */ React.createElement("div", { style: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 4px",
    borderRadius: 999,
    background: "linear-gradient(180deg,var(--bg2),var(--bg))",
    border: "1px solid var(--line-strong)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,.04)"
  } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      title: "Stop",
      onClick: (e) => {
        channel.postMessage({ type: "REQUEST_STOP" });
        e.currentTarget.blur();
      },
      style: {
        width: 27,
        height: 27,
        borderRadius: 999,
        display: "grid",
        placeItems: "center",
        outline: "none",
        color: "var(--cream-2)",
        background: "linear-gradient(180deg,var(--surface3),var(--surface2))",
        border: "1px solid var(--line-strong)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)"
      }
    },
    /* @__PURE__ */ React.createElement(Icon, { name: "stop", size: 11, fill: true })
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      title: "Play / Pause",
      onClick: (e) => {
        channel.postMessage({ type: "REQUEST_PLAY_PAUSE" });
        e.currentTarget.blur();
      },
      style: {
        width: 34,
        height: 27,
        borderRadius: 999,
        display: "grid",
        placeItems: "center",
        outline: "none",
        color: playing ? "#241a0a" : "var(--cream-2)",
        background: playing ? "linear-gradient(180deg,var(--amber),var(--amber-deep))" : "linear-gradient(180deg,var(--surface3),var(--surface2))",
        border: "1px solid " + (playing ? "var(--amber)" : "var(--line-strong)"),
        boxShadow: playing ? "0 0 12px var(--amber-soft), inset 0 1px 0 rgba(255,255,255,.24)" : "inset 0 1px 0 rgba(255,255,255,.05)"
      }
    },
    /* @__PURE__ */ React.createElement(Icon, { name: playing ? "pause" : "play", size: 14, fill: true })
  ))), !isMac && window.electronAPI ? /* @__PURE__ */ React.createElement("div", { className: "window-controls", style: { marginLeft: "auto" } }, /* @__PURE__ */ React.createElement("button", { className: "window-control", onMouseDown: suppressFocus, onClick: (e) => handleWindowButton(e, "minimize"), title: "Minimize", "aria-label": "Minimize" }, /* @__PURE__ */ React.createElement("span", { "aria-hidden": "true" }, "-")), /* @__PURE__ */ React.createElement("button", { className: "window-control", onMouseDown: suppressFocus, onClick: (e) => handleWindowButton(e, "maximize"), title: "Maximize", "aria-label": "Maximize" }, /* @__PURE__ */ React.createElement("span", { "aria-hidden": "true" }, "\u25A1")), /* @__PURE__ */ React.createElement("button", { className: "window-control close", onMouseDown: suppressFocus, onClick: (e) => handleWindowButton(e, "close"), title: "Close", "aria-label": "Close" }, /* @__PURE__ */ React.createElement("span", { "aria-hidden": "true" }, "\xD7"))) : /* @__PURE__ */ React.createElement("div", { style: { width: 80, marginLeft: "auto" } })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flex: 1, minHeight: 0, overflow: "hidden", background: "var(--bg)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flex: "1 1 auto", overflowX: "auto" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flex: "0 0 auto" } }, window.DAW.tracks.map((t) => /* @__PURE__ */ React.createElement(
    ChannelStrip,
    {
      key: t.id,
      track: t,
      texture: mixerTexture,
      level: window.DAW.getTrackLevel(t.id),
      onBeforeChange: () => channel.postMessage({ type: "BEFORE_CHANGE" }),
      onParam: (k, v) => {
        window.DAW.setTrackParam(t.id, k, v);
        force((n) => n + 1);
      }
    }
  ))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, background: "var(--bg)" } })), /* @__PURE__ */ React.createElement(
    MasterPanel,
    {
      level: window.DAW.getMasterLevel(),
      master: window.DAW.master,
      onMaster: (k, v) => {
        window.DAW.setMaster(k, v);
        force((n) => n + 1);
      },
      onBeforeChange: () => channel.postMessage({ type: "BEFORE_CHANGE" }),
      onOpenAdvancedPan: () => channel.postMessage({ type: "REQUEST_ADVANCED_PAN" })
    }
  )));
}
ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(MixerApp, null));

