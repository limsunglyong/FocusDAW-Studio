// Advanced Effect — Ambience module (Sound Environment / room type).
// Preset picker (illustrated cards) + Reset card + a Fine-tune panel with
// LED-ring rotary knobs and a live decay/echo-envelope graph. Drives the
// dedicated ambience bus in the studio engine via the shared BroadcastChannel;
// reflected in playback and Export.

const ambienceChannel = new BroadcastChannel("focusdaw-advanced-effects-sync");

// Sound Environment / room-type presets. `key` matches ROOM_PRESETS in
// audio-engine.js; `img` is the preset illustration under assets/ambience/.
const ROOMS = [
  { key: "concert", label: "Concert Hall", desc: "넓고 긴 잔향", img: "assets/ambience/concert-hall.png" },
  { key: "home", label: "Home", desc: "아늑한 실내", img: "assets/ambience/home.png" },
  { key: "far", label: "Far Field", desc: "원거리·슬랩 에코", img: "assets/ambience/far-field.png" },
  { key: "studio", label: "Studio", desc: "타이트·드라이", img: "assets/ambience/studio.png" },
  { key: "tunnel", label: "Tunnel", desc: "금속 반사·울림", img: "assets/ambience/tunnel.png" },
];

// Fine-tune controls — keys must match audio-engine.js makeRoomIR / setRoomParam.
const FINE = [
  { k: "wet", label: "Mix", control: "knob", min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + "%" },
  { k: "echo", label: "Echo", control: "knob", min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + "%" },
  { k: "width", label: "Width", control: "knob", min: 0, max: 1.5, step: 0.05, fmt: (v) => Math.round(v * 100) + "%" },
  { k: "decay", label: "Decay", control: "slider", min: 0.1, max: 4, step: 0.05, fmt: (v) => v.toFixed(2) + " s", minLabel: "Short", maxLabel: "Long" },
  { k: "preDelay", label: "Pre-delay", control: "slider", min: 0, max: 120, step: 1, fmt: (v) => Math.round(v) + " ms", minLabel: "Near", maxLabel: "Late" },
  { k: "size", label: "Room Size", control: "slider", min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + "%", minLabel: "Small", maxLabel: "Large" },
  { k: "damp", label: "Damping", control: "slider", min: 1000, max: 20000, step: 100, fmt: (v) => (v / 1000).toFixed(1) + " kHz", minLabel: "Dark", maxLabel: "Bright" },
];

const DEFAULT_ROOM_PARAMS = { decay: 0.001, shape: 1, preDelay: 0, wet: 0, damp: 20000, width: 1.0, echo: 0, size: 0.3 };
const DEFAULT_MASTER = {
  reverb: 0,
  echo: 0,
  saturation: 0,
  widener: 0,
  exciter: 0,
  reverbStored: 0.4,
  echoStored: 0.35,
};

// Slap-echo tap times — MUST mirror roomEchoTaps() in audio-engine.js so the
// graph matches what is actually rendered.
function ambEchoTaps(spec) {
  const echo = spec.echo || 0;
  if (echo <= 0) return [];
  const base = 0.09 * (0.5 + (spec.size == null ? 0.5 : spec.size));
  const taps = [];
  for (let n = 1; n <= 3; n++) taps.push({ t: base * n, g: echo * Math.pow(0.55, n - 1) });
  return taps;
}

// LED-ring rotary knob (classic cap + amber LED ring). Value above, name below.
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
      let nv = startV + (dy / 160) * (max - min);
      nv = Math.max(min, Math.min(max, nv));
      onChange(nv);
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
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
    dots.push(<circle key={i} cx={x.toFixed(2)} cy={y.toFixed(2)} r="1.5" className={"amb-led" + (f <= norm + 1e-6 ? " on" : "")} />);
  }
  return (
    <div className="amb-knob">
      <span className="amb-knob-val mono">{format ? format(value) : value}</span>
      <div className="amb-knob-dial" ref={ref} onMouseDown={onDown}
        onDoubleClick={() => { if (onBeforeChange) onBeforeChange(); onChange((min + max) / 2); }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {dots}
          <circle cx={r} cy={r} r={capR} fill="url(#ambCap)" stroke="rgba(0,0,0,0.55)" strokeWidth="1.2" />
          <ellipse cx={r} cy={r - capR * 0.32} rx={capR * 0.62} ry={capR * 0.4} fill="rgba(255,242,214,0.06)" />
          <line x1={r} y1={r} x2={r} y2={r - capR + 2} stroke="var(--amber)" strokeWidth="2.4" strokeLinecap="round"
            transform={`rotate(${ang.toFixed(1)} ${r} ${r})`} />
          <circle cx={r} cy={r} r="1.6" fill="rgba(0,0,0,0.5)" />
        </svg>
      </div>
      <span className="amb-knob-name">{label}</span>
    </div>
  );
}

function AmbSlider({ value, min, max, step, onBeforeChange, onChange, label, format, minLabel, maxLabel }) {
  const ref = useRef(null);
  const norm = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const before = () => { if (onBeforeChange) onBeforeChange(); };
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
  return (
    <div className="amb-slider" style={{ "--amb-slider-pct": `${norm * 100}%` }}>
      <div className="amb-slider-head">
        <span className="amb-slider-name">{label}</span>
        <span className="amb-slider-val mono">{format ? format(value) : value}</span>
      </div>
      <input
        ref={ref}
        className="amb-slider-input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onMouseDown={before}
        onTouchStart={before}
        onChange={(e) => commit(e.target.value)}
        aria-label={label}
      />
      <div className="amb-slider-scale">
        <span>{minLabel || format(min)}</span>
        <span>{maxLabel || format(max)}</span>
      </div>
    </div>
  );
}

function DecayGraph({ spec }) {
  const W = 536, H = 192, pad = 6;
  const wet = spec.wet == null ? 0 : spec.wet;
  const decay = spec.decay || 0.001;
  const preS = (spec.preDelay || 0) / 1000;
  const shape = spec.shape || 2;
  const taps = ambEchoTaps(spec);
  const lastTap = taps.length ? taps[taps.length - 1].t : 0;
  const total = Math.max(0.08, preS + decay, preS + lastTap + 0.02);
  const xOf = (t) => pad + (t / total) * (W - 2 * pad);
  const yOf = (a) => (H - pad) - Math.max(0, Math.min(1, a)) * (H - 2 * pad);
  const N = 72, pts = [];
  for (let i = 0; i <= N; i++) {
    const td = i / N;
    const a = Math.pow(Math.max(0, 1 - td), shape) * wet;
    pts.push(xOf(preS + td * decay).toFixed(1) + "," + yOf(a).toFixed(1));
  }
  const area = `${xOf(preS).toFixed(1)},${H - pad} ` + pts.join(" ") + ` ${xOf(preS + decay).toFixed(1)},${H - pad}`;
  const fracs = [0.25, 0.5, 0.75];
  return (
    <svg className="amb-graph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <g className="amb-graph-grid">
        {fracs.map((a, i) => <line key={"h" + i} x1={pad} y1={yOf(a).toFixed(1)} x2={W - pad} y2={yOf(a).toFixed(1)} />)}
        {fracs.map((t, i) => { const x = pad + t * (W - 2 * pad); return <line key={"v" + i} x1={x.toFixed(1)} y1={pad} x2={x.toFixed(1)} y2={H - pad} />; })}
      </g>
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} className="amb-graph-axis" />
      {preS > 0 && <line x1={xOf(preS).toFixed(1)} y1={pad} x2={xOf(preS).toFixed(1)} y2={H - pad} className="amb-graph-pre" />}
      <polygon points={area} className="amb-graph-fill" />
      <polyline points={pts.join(" ")} className="amb-graph-line" />
      {taps.map((tp, i) => {
        const x = xOf(preS + tp.t);
        return <line key={"e" + i} x1={x.toFixed(1)} y1={(H - pad).toFixed(1)} x2={x.toFixed(1)} y2={yOf(tp.g * wet).toFixed(1)} className="amb-graph-echo" />;
      })}
      <text x={pad + 1} y={H - pad - 2} className="amb-graph-tick" textAnchor="start">0</text>
      <text x={W - pad - 1} y={H - pad - 2} className="amb-graph-tick" textAnchor="end">{total.toFixed(2)}s</text>
      <text x={pad + 1} y={pad + 11} className="amb-graph-tick" textAnchor="start">1.0</text>
    </svg>
  );
}

function AmbMeters({ spec }) {
  const widthNorm = Math.max(0, Math.min(1, (spec.width == null ? 1 : spec.width) / 1.5));
  const dampNorm = Math.max(0, Math.min(1, ((spec.damp == null ? 20000 : spec.damp) - 1000) / 19000));
  return (
    <div className="amb-meters" aria-hidden="true">
      <div className="amb-meter">
        <span className="amb-meter-name">WIDTH</span>
        <div className="amb-width-meter">
          <span className="amb-width-line" style={{ left: `${50 - widthNorm * 44}%`, right: `${50 - widthNorm * 44}%` }} />
          <span className="amb-width-center" />
        </div>
        <span className="amb-meter-value mono">{Math.round((spec.width == null ? 1 : spec.width) * 100)}%</span>
      </div>
      <div className="amb-meter">
        <span className="amb-meter-name">DAMPING</span>
        <div className="amb-damp-meter">
          <span className="amb-damp-fill" style={{ width: `${dampNorm * 100}%` }} />
        </div>
        <span className="amb-meter-value mono">{dampNorm < 0.34 ? "Dark" : dampNorm < 0.67 ? "Warm" : "Bright"}</span>
      </div>
    </div>
  );
}

function AmbFxCard({ icon, name, paramKey, color, master, onMaster, onBeforeChange }) {
  const value = master[paramKey] || 0;
  const on = value > 0.001;
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const storedKey = paramKey + "Stored";
  const stored = master[storedKey];
  const canEnable = stored === undefined || stored > 0.001;
  const before = () => { if (onBeforeChange) onBeforeChange(); };
  const toggle = (e) => {
    e.currentTarget.blur();
    if (on) {
      before();
      onMaster(storedKey, value);
      onMaster(paramKey, 0);
    } else if (canEnable) {
      before();
      onMaster(paramKey, stored === undefined ? 0.4 : stored);
    }
  };
  const setAmount = (v) => {
    onMaster(paramKey, v);
    if (v <= 0.001) onMaster(storedKey, 0);
  };
  return (
    <div className="amb-fx-card">
      <button
        className={"amb-fx-toggle" + (on ? " on" : "")}
        onClick={toggle}
        onMouseDown={(e) => e.preventDefault()}
        title={`${name} ${on ? "ON - click to bypass" : canEnable ? "OFF - click to enable" : "OFF - raise the slider to enable"}`}
        style={{ "--amb-fx-color": color }}
      >
        <Icon name={icon} size={15} />
      </button>
      <div className="amb-fx-main">
        <div className="amb-fx-name">{name}</div>
        <input
          className="amb-fx-slider"
          style={{ "--amb-fx-color": color, "--amb-fx-pct": `${pct}%` }}
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={value}
          onMouseDown={before}
          onTouchStart={before}
          onChange={(e) => setAmount(Number(e.target.value))}
          aria-label={`${name} amount`}
        />
      </div>
      <span className="amb-fx-val mono">{Math.round(value * 100)}%</span>
    </div>
  );
}

function WindowControlsAef() {
  if (!window.electronAPI || window.electronAPI.platform === "darwin") return <div style={{ width: 84 }} />;
  const act = (e, name) => {
    e.currentTarget.blur();
    window.electronAPI.winAction(name);
  };
  const suppressFocus = (e) => e.preventDefault();
  return (
    <div className="window-controls" aria-label="Window controls">
      <button className="window-control" onMouseDown={suppressFocus} onClick={(e) => act(e, "minimize")} title="Minimize" aria-label="Minimize"><span aria-hidden="true">-</span></button>
      <button className="window-control" onMouseDown={suppressFocus} onClick={(e) => act(e, "maximize")} title="Maximize" aria-label="Maximize"><span aria-hidden="true">□</span></button>
      <button className="window-control close" onMouseDown={suppressFocus} onClick={(e) => act(e, "close")} title="Close" aria-label="Close"><span aria-hidden="true">×</span></button>
    </div>
  );
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
      down: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    };
    setScrollState((prev) => {
      return prev.up === next.up && prev.down === next.down ? prev : next;
    });
  }, []);

  // Follow the studio's colour theme + current room/params, shared channel.
  useEffect(() => {
    ambienceChannel.postMessage({ type: "ADVANCED_READY" });
    const handleMessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "INIT_STATE" || msg.type === "SYNC_STATE") {
        if (msg.theme) setTheme(msg.theme);
        if (msg.room !== undefined) setRoomState(msg.room || "none");
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

  // Transport + undo/redo forwarded to the studio even when this window is focused.
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
      if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        ambienceChannel.postMessage({ type: "REQUEST_REDO" });
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const chooseRoom = (key) => {
    setRoomState(key); // optimistic; studio echoes full state (incl. roomParams)
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

  const currentLabel = room === "none" ? "Dry (no room)"
    : room === "custom" ? "Custom"
    : (ROOMS.find((r) => r.key === room) || {}).label;

  return (
    <div className="aef-backdrop">
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <radialGradient id="ambCap" cx="0.5" cy="0.32" r="0.8">
            <stop offset="0" stopColor="var(--surface3)" />
            <stop offset="0.6" stopColor="var(--surface)" />
            <stop offset="1" stopColor="var(--bg2)" />
          </radialGradient>
        </defs>
      </svg>
      <div className="aef-shell">
        <div className="aef-window">
          <div className="aef-titlebar">
            <span className="aef-brand">
              <svg className="aef-brand-icon" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <line x1="6" y1="4" x2="6" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /><line x1="18" y1="4" x2="18" y2="20" />
                </g>
                <g fill="var(--bg2, #1a1a1a)" stroke="currentColor" strokeWidth="1.6">
                  <circle cx="6" cy="9" r="2.3" /><circle cx="12" cy="14.5" r="2.3" /><circle cx="18" cy="8" r="2.3" />
                </g>
              </svg>
              <span className="aef-toolbar-label">AMBIENCE</span>
            </span>
            <AdvancedViewMenu current="ambience" />
            <div className="title-c" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", flex: "none" }}>FocusDAW Studio <b>Ambience</b></div>
            <div style={{ marginLeft: "auto" }} />
            <WindowControlsAef />
          </div>

          <div className="aef-room">
            <div className="amb-room" ref={scrollRef} onScroll={updateScrollState}>
              <section className="amb-section">
                <h1 className="amb-section-title">SOUND ENVIRONMENT</h1>
                <div className="amb-preset-label">PRESET</div>
                <div className="amb-grid" role="radiogroup" aria-label="Sound environment preset">
                  <button className={"amb-card amb-card-reset" + (room === "none" ? " active" : "")} onClick={() => chooseRoom("none")} title="Reset ambience (dry)">
                    <span className="amb-card-img amb-reset-img">
                      <svg viewBox="0 0 48 48" aria-hidden="true">
                        <path d="M37 24a13 13 0 1 1-3.8-9.2" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                        <polyline points="33 6 33 15 24 15" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="amb-card-name">Reset</span>
                    <span className="amb-card-desc">효과 없음 (Dry)</span>
                  </button>
                  {ROOMS.map((r) => {
                    const active = room === r.key;
                    return (
                      <button key={r.key} className={"amb-card" + (active ? " active" : "")} role="radio" aria-checked={active} onClick={() => chooseRoom(r.key)} title={r.label}>
                        <span className="amb-card-img"><img src={r.img} alt={r.label} draggable="false" /></span>
                        <span className="amb-card-name">{r.label}</span>
                        <span className="amb-card-desc">{r.desc}</span>
                      </button>
                    );
                  })}
                  <button className={"amb-card amb-card-custom" + (room === "custom" ? " active" : "")} role="radio" aria-checked={room === "custom"} onClick={() => setRoomState("custom")} title="Custom ambience settings">
                    <span className="amb-card-img amb-custom-img">
                      <svg viewBox="0 0 48 48" aria-hidden="true">
                        <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                          <line x1="12" y1="13" x2="36" y2="13" />
                          <line x1="12" y1="24" x2="36" y2="24" />
                          <line x1="12" y1="35" x2="36" y2="35" />
                        </g>
                        <g fill="var(--bg2)" stroke="currentColor" strokeWidth="3">
                          <circle cx="19" cy="13" r="4" />
                          <circle cx="30" cy="24" r="4" />
                          <circle cx="23" cy="35" r="4" />
                        </g>
                      </svg>
                    </span>
                    <span className="amb-card-name">Custom</span>
                    <span className="amb-card-desc">사용자 설정</span>
                  </button>
                </div>
                <div className="amb-divider" />
                <div className="amb-finetune-head">
                  <span>FINE-TUNE</span>
                  <span className="amb-finetune-current">{currentLabel}</span>
                </div>
                <div className="amb-finetune-body">
                  <div className="amb-knobs amb-knobs-vertical">
                    {FINE.filter((f) => f.control === "knob").map((f) => (
                      <AmbKnob key={f.k} value={params[f.k] ?? f.min} min={f.min} max={f.max} label={f.label} format={f.fmt} wheelStep={f.step} onBeforeChange={grabParam} onChange={(nv) => changeParam(f.k, nv)} />
                    ))}
                  </div>
                  <div className="amb-graph-wrap">
                    <DecayGraph spec={params} />
                    <AmbMeters spec={params} />
                    <div className="amb-graph-caption">앰버=잔향 시간(Mix·Decay·Pre-delay) · 흰=슬랩 에코(Size·Echo)</div>
                  </div>
                  <div className="amb-sliders">
                    {FINE.filter((f) => f.control === "slider").map((f) => (
                      <AmbSlider key={f.k} value={params[f.k] ?? f.min} min={f.min} max={f.max} step={f.step} label={f.label} format={f.fmt} minLabel={f.minLabel} maxLabel={f.maxLabel} onBeforeChange={grabParam} onChange={(nv) => changeParam(f.k, nv)} />
                    ))}
                  </div>
                </div>
              </section>
              <div className="amb-divider amb-output-divider" />
              <section className="amb-section amb-output-section">
                <h2 className="amb-section-title">OUTPUT EFFECTS</h2>
                <div className="amb-output-grid">
                  <AmbFxCard icon="disc" name="Reverb" paramKey="reverb" color="var(--violet)" master={master} onMaster={changeMaster} onBeforeChange={grabParam} />
                  <AmbFxCard icon="loop" name="Delay" paramKey="echo" color="var(--blue)" master={master} onMaster={changeMaster} onBeforeChange={grabParam} />
                  <AmbFxCard icon="wave" name="Saturation" paramKey="saturation" color="var(--red)" master={master} onMaster={changeMaster} onBeforeChange={grabParam} />
                  <AmbFxCard icon="auto" name="Widener" paramKey="widener" color="var(--amber)" master={master} onMaster={changeMaster} onBeforeChange={grabParam} />
                  <div className="amb-output-wide">
                    <AmbFxCard icon="eq" name="Exciter / Enhancer" paramKey="exciter" color="var(--green)" master={master} onMaster={changeMaster} onBeforeChange={grabParam} />
                  </div>
                </div>
              </section>
            </div>
            {scrollState.up && <button className="amb-scroll-arrow amb-scroll-up" onClick={() => scrollRoom(-1)} aria-label="Scroll up"><span className="amb-arrow-glyph up" aria-hidden="true" /></button>}
            {scrollState.down && <button className="amb-scroll-arrow amb-scroll-down" onClick={() => scrollRoom(1)} aria-label="Scroll down"><span className="amb-arrow-glyph down" aria-hidden="true" /></button>}
          </div>

          <div className="aef-footer">
            <span>Sound Environment - {currentLabel}</span>
            <span className="mono">FocusDAW Studio</span>
          </div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.render(<AdvancedAmbienceApp />, document.getElementById("root"));
