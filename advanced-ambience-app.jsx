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
  { k: "wet", label: "Mix", min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + "%" },
  { k: "decay", label: "Decay", min: 0.1, max: 4, step: 0.05, fmt: (v) => v.toFixed(2) + " s" },
  { k: "preDelay", label: "Pre-delay", min: 0, max: 120, step: 1, fmt: (v) => Math.round(v) + " ms" },
  { k: "size", label: "Size", min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + "%" },
  { k: "echo", label: "Echo", min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + "%" },
  { k: "damp", label: "Damping", min: 1000, max: 20000, step: 100, fmt: (v) => (v / 1000).toFixed(1) + " kHz" },
  { k: "width", label: "Width", min: 0, max: 1.5, step: 0.05, fmt: (v) => Math.round(v * 100) + "%" },
];

const DEFAULT_ROOM_PARAMS = { decay: 0.001, shape: 1, preDelay: 0, wet: 0, damp: 20000, width: 1.0, echo: 0, size: 0.3 };

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
  // Damping → high-frequency decay curve: highs lose energy faster as damping
  // lowers (darker). dampNorm 1 = bright (HF ≈ main), 0 = dark (HF dies quickly).
  const dampNorm = Math.max(0, Math.min(1, ((spec.damp == null ? 20000 : spec.damp) - 1000) / 19000));
  const hf = [];
  for (let i = 0; i <= N; i++) {
    const td = i / N;
    const main = Math.pow(Math.max(0, 1 - td), shape) * wet;
    hf.push(xOf(preS + td * decay).toFixed(1) + "," + yOf(main * Math.exp(-(1 - dampNorm) * 4 * td)).toFixed(1));
  }
  // Width → stereo-spread meter at the top of the graph (centre dot = mono).
  const widthNorm = Math.max(0, Math.min(1, (spec.width == null ? 1 : spec.width) / 1.5));
  const cx = W / 2, half = widthNorm * (W * 0.42), wy = pad + 6;
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
      <polyline points={hf.join(" ")} className="amb-graph-hf" />
      {taps.map((tp, i) => {
        const x = xOf(preS + tp.t);
        return <line key={"e" + i} x1={x.toFixed(1)} y1={(H - pad).toFixed(1)} x2={x.toFixed(1)} y2={yOf(tp.g * wet).toFixed(1)} className="amb-graph-echo" />;
      })}
      {/* Width meter (top): widens left/right from centre with stereo width */}
      <line x1={(cx - half).toFixed(1)} y1={wy} x2={(cx + half).toFixed(1)} y2={wy} className="amb-graph-width" />
      <line x1={(cx - half).toFixed(1)} y1={wy - 3} x2={(cx - half).toFixed(1)} y2={wy + 3} className="amb-graph-width" />
      <line x1={(cx + half).toFixed(1)} y1={wy - 3} x2={(cx + half).toFixed(1)} y2={wy + 3} className="amb-graph-width" />
      <circle cx={cx} cy={wy} r="1.6" className="amb-graph-wdot" />
      <text x={cx} y={wy - 5} className="amb-graph-tick" textAnchor="middle">WIDTH</text>
      <text x={W - pad - 1} y={pad + 11} className="amb-graph-hf-lbl" textAnchor="end">HF · Damping</text>
      <text x={pad + 1} y={H - pad - 2} className="amb-graph-tick" textAnchor="start">0</text>
      <text x={W - pad - 1} y={H - pad - 2} className="amb-graph-tick" textAnchor="end">{total.toFixed(2)}s</text>
      <text x={pad + 1} y={pad + 11} className="amb-graph-tick" textAnchor="start">1.0</text>
    </svg>
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
      }
    };
    ambienceChannel.addEventListener("message", handleMessage);
    return () => ambienceChannel.removeEventListener("message", handleMessage);
  }, []);

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

          <div className="aef-room amb-room">
            <div className="amb-section-label">SOUND ENVIRONMENT</div>
            <div className="amb-grid" role="radiogroup" aria-label="Sound environment preset">
              <button
                className={"amb-card amb-card-reset" + (room === "none" ? " active" : "")}
                onClick={() => chooseRoom("none")}
                title="Reset ambience (dry)"
              >
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
                  <button
                    key={r.key}
                    className={"amb-card" + (active ? " active" : "")}
                    role="radio"
                    aria-checked={active}
                    onClick={() => chooseRoom(r.key)}
                    title={r.label}
                  >
                    <span className="amb-card-img">
                      <img src={r.img} alt={r.label} draggable="false" />
                    </span>
                    <span className="amb-card-name">{r.label}</span>
                    <span className="amb-card-desc">{r.desc}</span>
                  </button>
                );
              })}
            </div>

            <div className="amb-finetune">
              <div className="amb-section-label">FINE-TUNE <span className="amb-finetune-current">{currentLabel}</span></div>
              <div className="amb-finetune-body">
                <div className="amb-graph-wrap">
                  <DecayGraph spec={params} />
                  <div className="amb-graph-caption">앰버=잔향(Mix·Decay) · 흰=에코 · 파선=HF(Damping) · 상단 바=Width(스테레오)</div>
                </div>
                <div className="amb-knobs">
                  {FINE.map((f) => (
                    <AmbKnob
                      key={f.k}
                      value={params[f.k] ?? f.min} min={f.min} max={f.max}
                      label={f.label} format={f.fmt} wheelStep={f.step}
                      onBeforeChange={grabParam}
                      onChange={(nv) => changeParam(f.k, nv)}
                    />
                  ))}
                </div>
              </div>
            </div>
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
