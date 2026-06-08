/* ============ FocusDAW UI kit: icons, knobs, faders, meters ============ */
const { useState, useEffect, useRef, useCallback, useMemo } = React;

/* ---------- icons (simple geometric line glyphs) ---------- */
const IC = {
  play: "M8 5v14l11-7z",
  pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
  stop: "M6 6h12v12H6z",
  toStart: "M7 5v14M19 5l-9 7 9 7z",
  loop: "M4 9a6 6 0 0 1 6-6h7l-2.2-2.2M20 15a6 6 0 0 1-6 6H7l2.2 2.2",
  repeat: "M5 10V8h11M14 5l3 3-3 3M19 14v2H8M10 19l-3-3 3-3",
  plus: "M12 5v14M5 12h14",
  folder: "M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.2h7A1.5 1.5 0 0 1 19 8.7v9.3A1.5 1.5 0 0 1 17.5 19.5h-13A1.5 1.5 0 0 1 3 18z",
  mixer: "M5 4v6M5 14v6M12 4v3M12 11v9M19 4v9M19 17v3M2.5 12h5M9.5 8h5M16.5 14h5",
  wave: "M3 12h2l2-6 3 14 3-11 2 7 2-4h4",
  eq: "M4 6h16M4 12h16M4 18h16M9 6v0M15 12v0M7 18v0",
  scissors: "M6 6l12 12M6 18L18 6M8 6.5A2.5 2.5 0 1 1 3 6.5a2.5 2.5 0 0 1 5 0zM8 17.5A2.5 2.5 0 1 1 3 17.5a2.5 2.5 0 0 1 5 0z",
  download: "M12 4v10m0 0l-4-4m4 4l4-4M5 19h14",
  solo: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5v8",
  zoomIn: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M11 8v6M8 11h6",
  zoomOut: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6",
  auto: "M4 16c4 0 5-9 9-9s5 6 7 6",
  power: "M12 4v8M6.5 7a8 8 0 1 0 11 0",
  check: "M5 12l5 5L20 6",
  chevron: "M9 6l6 6-6 6",
  trash: "M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13",
  disc: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
};
function Icon({ name, size = 18, stroke = 1.7, fill = false, style }) {
  const d = IC[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style}
      fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"}
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/* ---------- engine tick hook (re-render on transport / meters) ---------- */
function useTick(active = true) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf;
    const loop = () => { set((n) => (n + 1) % 1e6); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}

/* ---------- rotary knob ---------- */
function Knob({ value, min = 0, max = 1, onChange, size = 38, label, unit, format, color = "var(--amber)", curve = 1 }) {
  const ref = useRef(null);
  const norm = (value - min) / (max - min);
  const ang = -135 + Math.pow(norm, 1 / curve) * 270;
  const drag = useRef(null);
  const onDown = (e) => {
    e.preventDefault();
    drag.current = { y: e.clientY, v: value };
    const move = (ev) => {
      const dy = drag.current.y - ev.clientY;
      let nv = drag.current.v + (dy / 160) * (max - min);
      nv = Math.max(min, Math.min(max, nv));
      onChange(nv);
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const onDbl = () => onChange((min + max) / 2);
  const r = size / 2;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, userSelect: "none" }}>
      <div ref={ref} onMouseDown={onDown} onDoubleClick={onDbl}
        style={{ width: size, height: size, cursor: "ns-resize", position: "relative" }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={r} cy={r} r={r - 2} fill="#211c16" stroke="rgba(0,0,0,.5)" strokeWidth="1.5" />
          <circle cx={r} cy={r} r={r - 2} fill="none" stroke="#3a342c" strokeWidth="3"
            strokeDasharray={`${2 * Math.PI * (r - 2) * 0.75} 999`}
            transform={`rotate(135 ${r} ${r})`} strokeLinecap="round" />
          <circle cx={r} cy={r} r={r - 2} fill="none" stroke={color} strokeWidth="3"
            strokeDasharray={`${2 * Math.PI * (r - 2) * 0.75 * norm} 999`}
            transform={`rotate(135 ${r} ${r})`} strokeLinecap="round" />
          <line x1={r} y1={r} x2={r} y2={6} stroke={color} strokeWidth="2.2" strokeLinecap="round"
            transform={`rotate(${ang} ${r} ${r})`} />
        </svg>
      </div>
      {label && <div style={{ fontSize: 9.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600 }}>{label}</div>}
      {format && <div className="mono" style={{ fontSize: 10, color: "var(--cream-2)" }}>{format(value)}</div>}
    </div>
  );
}

/* ---------- vertical fader ---------- */
function Fader({ value, onChange, height = 120, color = "var(--amber)", showVal }) {
  const ref = useRef(null);
  const set = (clientY) => {
    const el = ref.current; const r = el.getBoundingClientRect();
    let n = 1 - (clientY - r.top) / r.height;
    onChange(Math.max(0, Math.min(1, n)));
  };
  const onDown = (e) => {
    e.preventDefault(); set(e.clientY);
    const move = (ev) => set(ev.clientY);
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  return (
    <div ref={ref} onMouseDown={onDown} style={{ width: 26, height, position: "relative", cursor: "ns-resize" }}>
      <div style={{ position: "absolute", left: "50%", top: 4, bottom: 4, width: 4, transform: "translateX(-50%)", background: "#1a1611", borderRadius: 3, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.5)" }} />
      <div style={{ position: "absolute", left: "50%", bottom: `calc(${value * 100}% - 8px)`, width: 4, transform: "translateX(-50%)", height: 4, background: color, borderRadius: 3, top: 4 }} />
      <div style={{ position: "absolute", left: "50%", bottom: `calc(${value * (height - 8)}px)`, transform: "translate(-50%,50%)", width: 22, height: 13, borderRadius: 3, background: "linear-gradient(#4a4338,#2c2720)", border: "1px solid rgba(0,0,0,.5)", boxShadow: "0 2px 4px rgba(0,0,0,.5)" }}>
        <div style={{ position: "absolute", top: "50%", left: 3, right: 3, height: 1.5, transform: "translateY(-50%)", background: color, opacity: .8 }} />
      </div>
    </div>
  );
}

/* ---------- VU meter (vertical, reads engine level) ---------- */
function Meter({ level, height = 120, width = 8, stereo = false }) {
  const segs = 22;
  const lit = Math.round(level * segs);
  const cells = [];
  for (let i = 0; i < segs; i++) {
    const frac = i / segs;
    const on = i < lit;
    let col = "var(--green)";
    if (frac > 0.82) col = "var(--red)"; else if (frac > 0.62) col = "var(--amber)";
    cells.push(<div key={i} style={{ flex: 1, background: on ? col : "#2a251f", borderRadius: 1, opacity: on ? 1 : .5, boxShadow: on ? `0 0 4px ${col}` : "none", transition: "opacity .05s" }} />);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column-reverse", gap: 1.5, width, height }}>{cells}</div>
  );
}

/* ---------- solo / mute buttons ---------- */
function SoloBtn({ on, onClick, size = 24 }) {
  return <button onClick={onClick} title="Solo" style={{ width: size, height: size, borderRadius: 6, fontWeight: 700, fontSize: 11,
    background: on ? "var(--amber)" : "var(--surface2)", color: on ? "#241a0a" : "var(--dim)",
    border: "1px solid " + (on ? "var(--amber)" : "var(--line-strong)"), boxShadow: on ? "0 0 10px rgba(232,176,75,.5)" : "none" }}>S</button>;
}
function MuteBtn({ on, auto, onClick, size = 24 }) {
  // `auto` = implicitly muted because another track is soloed (display only)
  const active = on || auto;
  return <button onClick={onClick} title={!on && auto ? "Muted (Solo active elsewhere)" : "Mute"}
    style={{ width: size, height: size, borderRadius: 6, fontWeight: 700, fontSize: 11,
    background: on ? "var(--red)" : (auto ? "rgba(217,106,78,.22)" : "var(--surface2)"),
    color: on ? "#fff" : (auto ? "var(--red)" : "var(--dim)"),
    border: "1px solid " + (active ? "var(--red)" : "var(--line-strong)"),
    opacity: !on && auto ? 0.9 : 1 }}>M</button>;
}

/* ---------- segmented toggle ---------- */
function Seg({ options, value, onChange, small }) {
  return (
    <div style={{ display: "inline-flex", background: "var(--bg)", borderRadius: 8, padding: 2, border: "1px solid var(--line)" }}>
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)} style={{ padding: small ? "3px 9px" : "5px 12px", fontSize: small ? 11 : 12, fontWeight: 600, borderRadius: 6,
          background: value === o.v ? "var(--surface3)" : "transparent", color: value === o.v ? "var(--cream)" : "var(--muted)" }}>{o.l}</button>
      ))}
    </div>
  );
}

function fmtTime(s) {
  const m = Math.floor(s / 60); const sec = Math.floor(s % 60); const ms = Math.floor((s % 1) * 100);
  return `${m}:${String(sec).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}
function fmtDb(g) { if (g <= 0.0001) return "-\u221e"; const db = 20 * Math.log10(g); return (db >= 0 ? "+" : "") + db.toFixed(1); }

/* ---------- sleek horizontal slider ---------- */
function SleekSlider({ value, min = 0, max = 1, step = 0.01, onChange, width = 108, ticks = 5 }) {
  const ref = useRef(null);
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const set = (clientX) => {
    const r = ref.current.getBoundingClientRect();
    let f = (clientX - r.left) / r.width;
    f = Math.max(0, Math.min(1, f));
    let v = min + f * (max - min);
    if (step) v = Math.round(v / step) * step;
    onChange(Math.max(min, Math.min(max, v)));
  };
  const onDown = (e) => {
    e.preventDefault(); set(e.clientX);
    const move = (ev) => set(ev.clientX);
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  return (
    <div className="sleek" ref={ref} onMouseDown={onDown} style={{ width }}>
      <div className="strack" />
      {Array.from({ length: ticks }).map((_, i) => (
        <span key={i} className="stick" style={{ left: `${(i / (ticks - 1)) * 100}%` }} />
      ))}
      <div className="sfill" style={{ width: `${frac * 100}%` }} />
      <div className="sthumb" style={{ left: `${frac * 100}%` }} />
    </div>
  );
}

Object.assign(window, { Icon, IC, useTick, Knob, Fader, Meter, SoloBtn, MuteBtn, Seg, SleekSlider, fmtTime, fmtDb,
  useState, useEffect, useRef, useCallback, useMemo });
