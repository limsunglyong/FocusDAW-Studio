const ambienceChannel = new BroadcastChannel("focusdaw-advanced-effects-sync");
const ROOMS = [
  { key: "concert", label: "Concert Hall", desc: "\uB113\uACE0 \uAE34 \uC794\uD5A5", img: "assets/ambience/concert-hall.png" },
  { key: "home", label: "Home", desc: "\uC544\uB291\uD55C \uC2E4\uB0B4", img: "assets/ambience/home.png" },
  { key: "far", label: "Far Field", desc: "\uC6D0\uAC70\uB9AC\xB7\uC2AC\uB7A9 \uC5D0\uCF54", img: "assets/ambience/far-field.png" },
  { key: "studio", label: "Studio", desc: "\uD0C0\uC774\uD2B8\xB7\uB4DC\uB77C\uC774", img: "assets/ambience/studio.png" },
  { key: "tunnel", label: "Tunnel", desc: "\uAE08\uC18D \uBC18\uC0AC\xB7\uC6B8\uB9BC", img: "assets/ambience/tunnel.png" }
];
const FINE = [
  { k: "wet", label: "Mix", control: "knob", min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + "%" },
  { k: "echo", label: "Echo", control: "knob", min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + "%" },
  { k: "width", label: "Width", control: "knob", min: 0, max: 1.5, step: 0.05, fmt: (v) => Math.round(v * 100) + "%" },
  { k: "decay", label: "Decay", control: "slider", min: 0.1, max: 4, step: 0.05, fmt: (v) => v.toFixed(2) + " s", minLabel: "Short", maxLabel: "Long" },
  { k: "preDelay", label: "Pre-delay", control: "slider", min: 0, max: 120, step: 1, fmt: (v) => Math.round(v) + " ms", minLabel: "Near", maxLabel: "Late" },
  { k: "size", label: "Room Size", control: "slider", min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + "%", minLabel: "Small", maxLabel: "Large" },
  { k: "damp", label: "Damping", control: "slider", min: 1e3, max: 2e4, step: 100, fmt: (v) => (v / 1e3).toFixed(1) + " kHz", minLabel: "Dark", maxLabel: "Bright" }
];
const DEFAULT_ROOM_PARAMS = { decay: 1e-3, shape: 1, preDelay: 0, wet: 0, damp: 2e4, width: 1, echo: 0, size: 0.3 };
const DEFAULT_MASTER = {
  reverb: 0,
  echo: 0,
  saturation: 0,
  widener: 0,
  exciter: 0,
  reverbStored: 0.4,
  echoStored: 0.35
};
function ambEchoTaps(spec) {
  const echo = spec.echo || 0;
  if (echo <= 0) return [];
  const base = 0.09 * (0.5 + (spec.size == null ? 0.5 : spec.size));
  const taps = [];
  for (let n = 1; n <= 3; n++) taps.push({ t: base * n, g: echo * Math.pow(0.55, n - 1) });
  return taps;
}
function AmbKnob({ value, min, max, onBeforeChange, onChange, label, format, wheelStep = 0.01, size = 66 }) {
  const ref = useRef(null);
  const norm = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const ang = -135 + norm * 270;
  const r = size / 2, ringR = r - 3.5, capR = r - 11, N = 21;
  const onDown = (e) => {
    e.preventDefault();
    if (onBeforeChange) onBeforeChange();
    const startY = e.clientY, startV = value;
    const move = (ev) => {
      const dy = startY - ev.clientY;
      let nv = startV + dy / 160 * (max - min);
      nv = Math.max(min, Math.min(max, nv));
      onChange(nv);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  useWheelStep(ref, (dir) => {
    let nv = value + dir * wheelStep;
    nv = Math.max(min, Math.min(max, nv));
    if (nv === value) return;
    if (onBeforeChange) onBeforeChange();
    onChange(nv);
  });
  const dots = [];
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1);
    const a = (-135 + f * 270) * Math.PI / 180;
    const x = r + ringR * Math.sin(a);
    const y = r - ringR * Math.cos(a);
    dots.push(/* @__PURE__ */ React.createElement("circle", { key: i, cx: x.toFixed(2), cy: y.toFixed(2), r: "1.5", className: "amb-led" + (f <= norm + 1e-6 ? " on" : "") }));
  }
  return /* @__PURE__ */ React.createElement("div", { className: "amb-knob" }, /* @__PURE__ */ React.createElement("span", { className: "amb-knob-val mono" }, format ? format(value) : value), /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "amb-knob-dial",
      ref,
      onMouseDown: onDown,
      onDoubleClick: () => {
        if (onBeforeChange) onBeforeChange();
        onChange((min + max) / 2);
      }
    },
    /* @__PURE__ */ React.createElement("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}` }, dots, /* @__PURE__ */ React.createElement("circle", { cx: r, cy: r, r: capR, fill: "url(#ambCap)", stroke: "rgba(0,0,0,0.55)", strokeWidth: "1.2" }), /* @__PURE__ */ React.createElement("ellipse", { cx: r, cy: r - capR * 0.32, rx: capR * 0.62, ry: capR * 0.4, fill: "rgba(255,242,214,0.06)" }), /* @__PURE__ */ React.createElement(
      "line",
      {
        x1: r,
        y1: r,
        x2: r,
        y2: r - capR + 2,
        stroke: "var(--amber)",
        strokeWidth: "2.4",
        strokeLinecap: "round",
        transform: `rotate(${ang.toFixed(1)} ${r} ${r})`
      }
    ), /* @__PURE__ */ React.createElement("circle", { cx: r, cy: r, r: "1.6", fill: "rgba(0,0,0,0.5)" }))
  ), /* @__PURE__ */ React.createElement("span", { className: "amb-knob-name" }, label));
}
function AmbSlider({ value, min, max, step, onBeforeChange, onChange, label, format, minLabel, maxLabel }) {
  const ref = useRef(null);
  const norm = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const before = () => {
    if (onBeforeChange) onBeforeChange();
  };
  const commit = (raw) => {
    const nv = Math.max(min, Math.min(max, Number(raw)));
    onChange(nv);
  };
  useWheelStep(ref, (dir) => {
    const nv = Math.max(min, Math.min(max, value + dir * step));
    if (nv === value) return;
    before();
    onChange(nv);
  });
  return /* @__PURE__ */ React.createElement("div", { className: "amb-slider", style: { "--amb-slider-pct": `${norm * 100}%` } }, /* @__PURE__ */ React.createElement("div", { className: "amb-slider-head" }, /* @__PURE__ */ React.createElement("span", { className: "amb-slider-name" }, label), /* @__PURE__ */ React.createElement("span", { className: "amb-slider-val mono" }, format ? format(value) : value)), /* @__PURE__ */ React.createElement(
    "input",
    {
      ref,
      className: "amb-slider-input",
      type: "range",
      min,
      max,
      step,
      value,
      onMouseDown: before,
      onTouchStart: before,
      onChange: (e) => commit(e.target.value),
      "aria-label": label
    }
  ), /* @__PURE__ */ React.createElement("div", { className: "amb-slider-scale" }, /* @__PURE__ */ React.createElement("span", null, minLabel || format(min)), /* @__PURE__ */ React.createElement("span", null, maxLabel || format(max))));
}
function DecayGraph({ spec }) {
  const W = 536, H = 192, pad = 6;
  const wet = spec.wet == null ? 0 : spec.wet;
  const decay = spec.decay || 1e-3;
  const preS = (spec.preDelay || 0) / 1e3;
  const shape = spec.shape || 2;
  const taps = ambEchoTaps(spec);
  const lastTap = taps.length ? taps[taps.length - 1].t : 0;
  const total = Math.max(0.08, preS + decay, preS + lastTap + 0.02);
  const xOf = (t) => pad + t / total * (W - 2 * pad);
  const yOf = (a) => H - pad - Math.max(0, Math.min(1, a)) * (H - 2 * pad);
  const N = 72, pts = [];
  for (let i = 0; i <= N; i++) {
    const td = i / N;
    const a = Math.pow(Math.max(0, 1 - td), shape) * wet;
    pts.push(xOf(preS + td * decay).toFixed(1) + "," + yOf(a).toFixed(1));
  }
  const area = `${xOf(preS).toFixed(1)},${H - pad} ` + pts.join(" ") + ` ${xOf(preS + decay).toFixed(1)},${H - pad}`;
  const fracs = [0.25, 0.5, 0.75];
  return /* @__PURE__ */ React.createElement("svg", { className: "amb-graph", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("g", { className: "amb-graph-grid" }, fracs.map((a, i) => /* @__PURE__ */ React.createElement("line", { key: "h" + i, x1: pad, y1: yOf(a).toFixed(1), x2: W - pad, y2: yOf(a).toFixed(1) })), fracs.map((t, i) => {
    const x = pad + t * (W - 2 * pad);
    return /* @__PURE__ */ React.createElement("line", { key: "v" + i, x1: x.toFixed(1), y1: pad, x2: x.toFixed(1), y2: H - pad });
  })), /* @__PURE__ */ React.createElement("line", { x1: pad, y1: H - pad, x2: W - pad, y2: H - pad, className: "amb-graph-axis" }), preS > 0 && /* @__PURE__ */ React.createElement("line", { x1: xOf(preS).toFixed(1), y1: pad, x2: xOf(preS).toFixed(1), y2: H - pad, className: "amb-graph-pre" }), /* @__PURE__ */ React.createElement("polygon", { points: area, className: "amb-graph-fill" }), /* @__PURE__ */ React.createElement("polyline", { points: pts.join(" "), className: "amb-graph-line" }), taps.map((tp, i) => {
    const x = xOf(preS + tp.t);
    return /* @__PURE__ */ React.createElement("line", { key: "e" + i, x1: x.toFixed(1), y1: (H - pad).toFixed(1), x2: x.toFixed(1), y2: yOf(tp.g * wet).toFixed(1), className: "amb-graph-echo" });
  }), /* @__PURE__ */ React.createElement("text", { x: pad + 1, y: H - pad - 2, className: "amb-graph-tick", textAnchor: "start" }, "0"), /* @__PURE__ */ React.createElement("text", { x: W - pad - 1, y: H - pad - 2, className: "amb-graph-tick", textAnchor: "end" }, total.toFixed(2), "s"), /* @__PURE__ */ React.createElement("text", { x: pad + 1, y: pad + 11, className: "amb-graph-tick", textAnchor: "start" }, "1.0"));
}
function AmbMeters({ spec }) {
  const widthNorm = Math.max(0, Math.min(1, (spec.width == null ? 1 : spec.width) / 1.5));
  const dampNorm = Math.max(0, Math.min(1, ((spec.damp == null ? 2e4 : spec.damp) - 1e3) / 19e3));
  return /* @__PURE__ */ React.createElement("div", { className: "amb-meters", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("div", { className: "amb-meter" }, /* @__PURE__ */ React.createElement("span", { className: "amb-meter-name" }, "WIDTH"), /* @__PURE__ */ React.createElement("div", { className: "amb-width-meter" }, /* @__PURE__ */ React.createElement("span", { className: "amb-width-line", style: { left: `${50 - widthNorm * 44}%`, right: `${50 - widthNorm * 44}%` } }), /* @__PURE__ */ React.createElement("span", { className: "amb-width-center" })), /* @__PURE__ */ React.createElement("span", { className: "amb-meter-value mono" }, Math.round((spec.width == null ? 1 : spec.width) * 100), "%")), /* @__PURE__ */ React.createElement("div", { className: "amb-meter" }, /* @__PURE__ */ React.createElement("span", { className: "amb-meter-name" }, "DAMPING"), /* @__PURE__ */ React.createElement("div", { className: "amb-damp-meter" }, /* @__PURE__ */ React.createElement("span", { className: "amb-damp-fill", style: { width: `${dampNorm * 100}%` } })), /* @__PURE__ */ React.createElement("span", { className: "amb-meter-value mono" }, dampNorm < 0.34 ? "Dark" : dampNorm < 0.67 ? "Warm" : "Bright")));
}
function AmbFxCard({ icon, name, paramKey, color, master, onMaster, onBeforeChange }) {
  const value = master[paramKey] || 0;
  const on = value > 1e-3;
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const storedKey = paramKey + "Stored";
  const stored = master[storedKey];
  const canEnable = stored === void 0 || stored > 1e-3;
  const before = () => {
    if (onBeforeChange) onBeforeChange();
  };
  const toggle = (e) => {
    e.currentTarget.blur();
    if (on) {
      before();
      onMaster(storedKey, value);
      onMaster(paramKey, 0);
    } else if (canEnable) {
      before();
      onMaster(paramKey, stored === void 0 ? 0.4 : stored);
    }
  };
  const setAmount = (v) => {
    onMaster(paramKey, v);
    if (v <= 1e-3) onMaster(storedKey, 0);
  };
  return /* @__PURE__ */ React.createElement("div", { className: "amb-fx-card" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "amb-fx-toggle" + (on ? " on" : ""),
      onClick: toggle,
      onMouseDown: (e) => e.preventDefault(),
      title: `${name} ${on ? "ON - click to bypass" : canEnable ? "OFF - click to enable" : "OFF - raise the slider to enable"}`,
      style: { "--amb-fx-color": color }
    },
    /* @__PURE__ */ React.createElement(Icon, { name: icon, size: 15 })
  ), /* @__PURE__ */ React.createElement("div", { className: "amb-fx-main" }, /* @__PURE__ */ React.createElement("div", { className: "amb-fx-name" }, name), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "amb-fx-slider",
      style: { "--amb-fx-color": color, "--amb-fx-pct": `${pct}%` },
      type: "range",
      min: "0",
      max: "1",
      step: "0.01",
      value,
      onMouseDown: before,
      onTouchStart: before,
      onChange: (e) => setAmount(Number(e.target.value)),
      "aria-label": `${name} amount`
    }
  )), /* @__PURE__ */ React.createElement("span", { className: "amb-fx-val mono" }, Math.round(value * 100), "%"));
}
function WindowControlsAef() {
  if (!window.electronAPI || window.electronAPI.platform === "darwin") return /* @__PURE__ */ React.createElement("div", { style: { width: 84 } });
  const act = (e, name) => {
    e.currentTarget.blur();
    window.electronAPI.winAction(name);
  };
  const suppressFocus = (e) => e.preventDefault();
  return /* @__PURE__ */ React.createElement("div", { className: "window-controls", "aria-label": "Window controls" }, /* @__PURE__ */ React.createElement("button", { className: "window-control", onMouseDown: suppressFocus, onClick: (e) => act(e, "minimize"), title: "Minimize", "aria-label": "Minimize" }, /* @__PURE__ */ React.createElement("span", { "aria-hidden": "true" }, "-")), /* @__PURE__ */ React.createElement("button", { className: "window-control", onMouseDown: suppressFocus, onClick: (e) => act(e, "maximize"), title: "Maximize", "aria-label": "Maximize" }, /* @__PURE__ */ React.createElement("span", { "aria-hidden": "true" }, "\u25A1")), /* @__PURE__ */ React.createElement("button", { className: "window-control close", onMouseDown: suppressFocus, onClick: (e) => act(e, "close"), title: "Close", "aria-label": "Close" }, /* @__PURE__ */ React.createElement("span", { "aria-hidden": "true" }, "\xD7")));
}
function AdvancedAmbienceApp() {
  const [theme, setTheme] = useState("default");
  const [room, setRoomState] = useState("none");
  const [params, setParams] = useState(DEFAULT_ROOM_PARAMS);
  const [master, setMaster] = useState(DEFAULT_MASTER);
  const scrollRef = useRef(null);
  const [scrollState, setScrollState] = useState({ up: false, down: false });
  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const next = {
      up: el.scrollTop > 1,
      down: el.scrollTop + el.clientHeight < el.scrollHeight - 1
    };
    setScrollState((prev) => {
      return prev.up === next.up && prev.down === next.down ? prev : next;
    });
  }, []);
  useEffect(() => {
    ambienceChannel.postMessage({ type: "ADVANCED_READY" });
    const handleMessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "INIT_STATE" || msg.type === "SYNC_STATE") {
        if (msg.theme) setTheme(msg.theme);
        if (msg.room !== void 0) setRoomState(msg.room || "none");
        if (msg.roomParams) setParams({ ...DEFAULT_ROOM_PARAMS, ...msg.roomParams });
        if (msg.master) setMaster({ ...DEFAULT_MASTER, ...msg.master });
      }
    };
    ambienceChannel.addEventListener("message", handleMessage);
    return () => ambienceChannel.removeEventListener("message", handleMessage);
  }, []);
  useEffect(() => {
    updateScrollState();
    window.addEventListener("resize", updateScrollState);
    return () => window.removeEventListener("resize", updateScrollState);
  }, [updateScrollState]);
  useEffect(() => {
    requestAnimationFrame(updateScrollState);
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "default") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape" || e.key === "F3") {
        e.preventDefault();
        if (window.electronAPI && window.electronAPI.winAction) window.electronAPI.winAction("close");
        else window.close();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) ambienceChannel.postMessage({ type: "REQUEST_PLAY_PAUSE" });
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        ambienceChannel.postMessage({ type: "REQUEST_UNDO" });
      }
      if (mod && (e.key.toLowerCase() === "y" || e.key.toLowerCase() === "z" && e.shiftKey)) {
        e.preventDefault();
        ambienceChannel.postMessage({ type: "REQUEST_REDO" });
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
  const chooseRoom = (key) => {
    setRoomState(key);
    ambienceChannel.postMessage({ type: "SET_ROOM_PRESET", room: key });
  };
  const grabParam = () => ambienceChannel.postMessage({ type: "BEFORE_CHANGE" });
  const changeParam = (k, v) => {
    setParams((p) => ({ ...p, [k]: v }));
    setRoomState("custom");
    ambienceChannel.postMessage({ type: "SET_ROOM_PARAM", k, v });
  };
  const changeMaster = (k, v) => {
    setMaster((m) => ({ ...m, [k]: v }));
    ambienceChannel.postMessage({ type: "SET_MASTER_PARAM", k, v });
  };
  const scrollRoom = (dir) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ top: dir * Math.max(220, el.clientHeight * 0.72), behavior: "smooth" });
  };
  const currentLabel = room === "none" ? "Dry (no room)" : room === "custom" ? "Custom" : (ROOMS.find((r) => r.key === room) || {}).label;
  const activeFx = [];
  if (master.reverb > 1e-3) activeFx.push("REVERB");
  if (master.echo > 1e-3) activeFx.push("DELAY");
  if (master.saturation > 1e-3) activeFx.push("SATURATION");
  if (master.widener > 1e-3) activeFx.push("WIDENER");
  if (master.exciter > 1e-3) activeFx.push("EXCITER");
  const fxText = activeFx.length > 0 ? activeFx.join(", ") : "NONE";
  return /* @__PURE__ */ React.createElement("div", { className: "aef-backdrop" }, /* @__PURE__ */ React.createElement("svg", { width: "0", height: "0", style: { position: "absolute" }, "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("defs", null, /* @__PURE__ */ React.createElement("radialGradient", { id: "ambCap", cx: "0.5", cy: "0.32", r: "0.8" }, /* @__PURE__ */ React.createElement("stop", { offset: "0", stopColor: "var(--surface3)" }), /* @__PURE__ */ React.createElement("stop", { offset: "0.6", stopColor: "var(--surface)" }), /* @__PURE__ */ React.createElement("stop", { offset: "1", stopColor: "var(--bg2)" })))), /* @__PURE__ */ React.createElement("div", { className: "aef-shell" }, /* @__PURE__ */ React.createElement("div", { className: "aef-window" }, /* @__PURE__ */ React.createElement("div", { className: "aef-titlebar" }, /* @__PURE__ */ React.createElement("span", { className: "aef-brand" }, /* @__PURE__ */ React.createElement("svg", { className: "aef-brand-icon", width: "17", height: "17", viewBox: "0 0 24 24", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("g", { stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round" }, /* @__PURE__ */ React.createElement("line", { x1: "6", y1: "4", x2: "6", y2: "20" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "4", x2: "12", y2: "20" }), /* @__PURE__ */ React.createElement("line", { x1: "18", y1: "4", x2: "18", y2: "20" })), /* @__PURE__ */ React.createElement("g", { fill: "var(--bg2, #1a1a1a)", stroke: "currentColor", strokeWidth: "1.6" }, /* @__PURE__ */ React.createElement("circle", { cx: "6", cy: "9", r: "2.3" }), /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "14.5", r: "2.3" }), /* @__PURE__ */ React.createElement("circle", { cx: "18", cy: "8", r: "2.3" }))), /* @__PURE__ */ React.createElement("span", { className: "aef-toolbar-label" }, "AMBIENCE")), /* @__PURE__ */ React.createElement(AdvancedViewMenu, { current: "ambience" }), /* @__PURE__ */ React.createElement("div", { className: "title-c", style: { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", flex: "none" } }, "FocusDAW Studio ", /* @__PURE__ */ React.createElement("b", null, "Ambience")), /* @__PURE__ */ React.createElement("div", { style: { marginLeft: "auto" } }), /* @__PURE__ */ React.createElement(WindowControlsAef, null)), /* @__PURE__ */ React.createElement("div", { className: "aef-room" }, /* @__PURE__ */ React.createElement("div", { className: "amb-room", ref: scrollRef, onScroll: updateScrollState }, /* @__PURE__ */ React.createElement("section", { className: "amb-section" }, /* @__PURE__ */ React.createElement("h1", { className: "amb-section-title" }, "SOUND ENVIRONMENT"), /* @__PURE__ */ React.createElement("div", { className: "amb-preset-label" }, "PRESET"), /* @__PURE__ */ React.createElement("div", { className: "amb-grid", role: "radiogroup", "aria-label": "Sound environment preset" }, /* @__PURE__ */ React.createElement("button", { className: "amb-card amb-card-reset" + (room === "none" ? " active" : ""), onClick: () => chooseRoom("none"), title: "Reset ambience (dry)" }, /* @__PURE__ */ React.createElement("span", { className: "amb-card-img amb-reset-img" }, /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 48 48", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { d: "M37 24a13 13 0 1 1-3.8-9.2", fill: "none", stroke: "currentColor", strokeWidth: "3", strokeLinecap: "round" }), /* @__PURE__ */ React.createElement("polyline", { points: "33 6 33 15 24 15", fill: "none", stroke: "currentColor", strokeWidth: "3", strokeLinecap: "round", strokeLinejoin: "round" }))), /* @__PURE__ */ React.createElement("span", { className: "amb-card-name" }, "Reset"), /* @__PURE__ */ React.createElement("span", { className: "amb-card-desc" }, "\uD6A8\uACFC \uC5C6\uC74C (Dry)")), ROOMS.map((r) => {
    const active = room === r.key;
    return /* @__PURE__ */ React.createElement("button", { key: r.key, className: "amb-card" + (active ? " active" : ""), role: "radio", "aria-checked": active, onClick: () => chooseRoom(r.key), title: r.label }, /* @__PURE__ */ React.createElement("span", { className: "amb-card-img" }, /* @__PURE__ */ React.createElement("img", { src: r.img, alt: r.label, draggable: "false" })), /* @__PURE__ */ React.createElement("span", { className: "amb-card-name" }, r.label), /* @__PURE__ */ React.createElement("span", { className: "amb-card-desc" }, r.desc));
  }), /* @__PURE__ */ React.createElement("button", { className: "amb-card amb-card-custom" + (room === "custom" ? " active" : ""), role: "radio", "aria-checked": room === "custom", onClick: () => setRoomState("custom"), title: "Custom ambience settings" }, /* @__PURE__ */ React.createElement("span", { className: "amb-card-img amb-custom-img" }, /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 48 48", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("g", { fill: "none", stroke: "currentColor", strokeWidth: "3", strokeLinecap: "round" }, /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "13", x2: "36", y2: "13" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "24", x2: "36", y2: "24" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "35", x2: "36", y2: "35" })), /* @__PURE__ */ React.createElement("g", { fill: "var(--bg2)", stroke: "currentColor", strokeWidth: "3" }, /* @__PURE__ */ React.createElement("circle", { cx: "19", cy: "13", r: "4" }), /* @__PURE__ */ React.createElement("circle", { cx: "30", cy: "24", r: "4" }), /* @__PURE__ */ React.createElement("circle", { cx: "23", cy: "35", r: "4" })))), /* @__PURE__ */ React.createElement("span", { className: "amb-card-name" }, "Custom"), /* @__PURE__ */ React.createElement("span", { className: "amb-card-desc" }, "\uC0AC\uC6A9\uC790 \uC124\uC815"))), /* @__PURE__ */ React.createElement("div", { className: "amb-divider" }), /* @__PURE__ */ React.createElement("div", { className: "amb-finetune-head" }, /* @__PURE__ */ React.createElement("span", null, "FINE-TUNE"), /* @__PURE__ */ React.createElement("span", { className: "amb-finetune-current" }, currentLabel)), /* @__PURE__ */ React.createElement("div", { className: "amb-finetune-body" }, /* @__PURE__ */ React.createElement("div", { className: "amb-knobs amb-knobs-vertical" }, FINE.filter((f) => f.control === "knob").map((f) => /* @__PURE__ */ React.createElement(AmbKnob, { key: f.k, value: params[f.k] ?? f.min, min: f.min, max: f.max, label: f.label, format: f.fmt, wheelStep: f.step, onBeforeChange: grabParam, onChange: (nv) => changeParam(f.k, nv) }))), /* @__PURE__ */ React.createElement("div", { className: "amb-graph-wrap" }, /* @__PURE__ */ React.createElement(DecayGraph, { spec: params }), /* @__PURE__ */ React.createElement(AmbMeters, { spec: params }), /* @__PURE__ */ React.createElement("div", { className: "amb-graph-caption" }, "\uC570\uBC84=\uC794\uD5A5 \uC2DC\uAC04(Mix\xB7Decay\xB7Pre-delay) \xB7 \uD770=\uC2AC\uB7A9 \uC5D0\uCF54(Size\xB7Echo)")), /* @__PURE__ */ React.createElement("div", { className: "amb-sliders" }, FINE.filter((f) => f.control === "slider").map((f) => /* @__PURE__ */ React.createElement(AmbSlider, { key: f.k, value: params[f.k] ?? f.min, min: f.min, max: f.max, step: f.step, label: f.label, format: f.fmt, minLabel: f.minLabel, maxLabel: f.maxLabel, onBeforeChange: grabParam, onChange: (nv) => changeParam(f.k, nv) }))))), /* @__PURE__ */ React.createElement("div", { className: "amb-divider amb-output-divider" }), /* @__PURE__ */ React.createElement("section", { className: "amb-section amb-output-section" }, /* @__PURE__ */ React.createElement("h2", { className: "amb-section-title" }, "OUTPUT EFFECTS"), /* @__PURE__ */ React.createElement("div", { className: "amb-output-grid" }, /* @__PURE__ */ React.createElement(AmbFxCard, { icon: "disc", name: "Reverb", paramKey: "reverb", color: "var(--violet)", master, onMaster: changeMaster, onBeforeChange: grabParam }), /* @__PURE__ */ React.createElement(AmbFxCard, { icon: "loop", name: "Delay", paramKey: "echo", color: "var(--blue)", master, onMaster: changeMaster, onBeforeChange: grabParam }), /* @__PURE__ */ React.createElement(AmbFxCard, { icon: "wave", name: "Saturation", paramKey: "saturation", color: "var(--red)", master, onMaster: changeMaster, onBeforeChange: grabParam }), /* @__PURE__ */ React.createElement(AmbFxCard, { icon: "auto", name: "Widener", paramKey: "widener", color: "var(--amber)", master, onMaster: changeMaster, onBeforeChange: grabParam }), /* @__PURE__ */ React.createElement("div", { className: "amb-output-wide" }, /* @__PURE__ */ React.createElement(AmbFxCard, { icon: "eq", name: "Exciter / Enhancer", paramKey: "exciter", color: "var(--green)", master, onMaster: changeMaster, onBeforeChange: grabParam }))))), scrollState.up && /* @__PURE__ */ React.createElement("button", { className: "amb-scroll-arrow amb-scroll-up", onClick: () => scrollRoom(-1), "aria-label": "Scroll up" }, /* @__PURE__ */ React.createElement("span", { className: "amb-arrow-glyph up", "aria-hidden": "true" })), scrollState.down && /* @__PURE__ */ React.createElement("button", { className: "amb-scroll-arrow amb-scroll-down", onClick: () => scrollRoom(1), "aria-label": "Scroll down" }, /* @__PURE__ */ React.createElement("span", { className: "amb-arrow-glyph down", "aria-hidden": "true" }))), /* @__PURE__ */ React.createElement("div", { className: "aef-footer" }, /* @__PURE__ */ React.createElement("span", null, "Sound Environment - ", currentLabel), /* @__PURE__ */ React.createElement("span", { className: "mono" }, fxText)))));
}
ReactDOM.render(/* @__PURE__ */ React.createElement(AdvancedAmbienceApp, null), document.getElementById("root"));

