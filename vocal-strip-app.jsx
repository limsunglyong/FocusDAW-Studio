// Vocal Channel Strip — dedicated window. Visual design ports _refer/Vocal Channel Strip 2.dc.html
// (the mockup's DCLogic runtime is only a reference; logic is reimplemented in React with the app's
// theme variables). Stage B wires 9-band EQ + Compressor; HPF / Noise Gate / De-esser / Spectrum
// are shown as mockup-styled cards but disabled ("다음 단계", design §9 C–E). Pitch / Echo / Output
// sections are intentionally omitted (design §7). FX params flow over the shared
// "focusdaw-advanced-effects-sync" channel via SET_TRACK_PARAM (flattened keys) → engine + native + save.

const vsChannel = new BroadcastChannel("focusdaw-advanced-effects-sync");

const EQ_FREQS = [60, 150, 320, 640, 1200, 2400, 4800, 9000, 15000];
const BAND_LABELS = ["60", "150", "320", "640", "1.2k", "2.4k", "4.8k", "9k", "15k"];

// Presets (mockup values; only EQ + Comp are wired, so hpf/deess are left at defaults).
const VOCAL_PRESETS = {
  "Clean Lead": { geq: [-2, -1, 0, 0, 1, 2, 2, 1, 1], comp: { threshold: -16, ratio: 2.5, attack: 8, release: 120, makeup: 1.5 } },
  "Warm Pop":   { geq: [-3, -2, -1, 0, 1, 3, 2, 1, 0], comp: { threshold: -18, ratio: 3, attack: 8, release: 120, makeup: 2 } },
  "Bright Air": { geq: [-2, -1, -1, 0, 2, 4, 4, 3, 3], comp: { threshold: -20, ratio: 3.5, attack: 8, release: 120, makeup: 3 } },
  "Podcast":    { geq: [-4, -2, -1, 0, 1, 3, 2, 1, 0], comp: { threshold: -22, ratio: 4, attack: 8, release: 120, makeup: 3.5 } },
};

function defaultVocalFx() {
  return {
    enabled: false,
    hpf: { on: false, freq: 90, slope: 24 },
    gate: { on: false, threshold: -42, ratio: 4, attack: 2, release: 120 },
    eq: { on: false, geq: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
    comp: { on: false, threshold: -18, ratio: 3, attack: 8, release: 120, makeup: 0 },
    deEss: { on: false, freq: 6800, threshold: -24, amount: 0.5 },
  };
}
function normalizeVocalFx(v) {
  const d = defaultVocalFx();
  if (!v || typeof v !== "object") return d;
  const geq = (v.eq && Array.isArray(v.eq.geq))
    ? d.eq.geq.map((_, i) => (Number.isFinite(+v.eq.geq[i]) ? +v.eq.geq[i] : 0))
    : d.eq.geq.slice();
  return {
    enabled: !!v.enabled,
    hpf: { ...d.hpf, ...(v.hpf || {}) },
    gate: { ...d.gate, ...(v.gate || {}) },
    eq: { on: !!(v.eq && v.eq.on), geq },
    comp: { ...d.comp, ...(v.comp || {}), on: !!(v.comp && v.comp.on) },
    deEss: { ...d.deEss, ...(v.deEss || {}) },
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Quantize to the step grid; toFixed kills the float drift (0.1 steps → 2.7000000000000006).
const snap = (v, step) => +(Math.round(v / step) * step).toFixed(4);
function getQueryTrack() { try { return new URLSearchParams(location.search).get("track") || ""; } catch (_) { return ""; } }

/* ---------- shared mockup styles ---------- */
const CARD = {
  background: "repeating-linear-gradient(135deg,rgba(255,255,255,.028) 0px,rgba(255,255,255,.028) 1px,transparent 1px,transparent 6px),linear-gradient(135deg,rgba(255,255,255,.03),rgba(0,0,0,.06)),var(--surface)",
  border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--shadow)", overflow: "hidden",
};
const CARD_HEAD = {
  display: "flex", alignItems: "center", gap: 11, padding: "11px 15px",
  borderBottom: "1px solid var(--line)", background: "linear-gradient(180deg,var(--surface2),var(--surface))",
};
const dotStyle = (on, disabled) => ({
  width: 13, height: 13, borderRadius: "50%", flex: "0 0 auto", padding: 0, border: "none",
  cursor: disabled ? "default" : "pointer",
  background: on ? "var(--amber)" : "var(--surface3)",
  boxShadow: on ? "0 0 8px var(--amber)" : "inset 0 0 0 1px var(--line-strong)",
  opacity: disabled ? 0.55 : 1,
});
// Card head's right-hand tag doubles as the per-effect ON/OFF switch (the left dot is the same
// toggle) — `disabled` only when the master strip itself is bypassed. ON uses the theme's
// highlight (--amber), same as the master STRIP ACTIVE button; OFF stays neutral/faint.
const tagStyle = (on, disabled) => ({
  fontFamily: "var(--ui)", fontSize: 9, fontWeight: 700, letterSpacing: ".1em",
  padding: "4px 11px", borderRadius: 5, cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.55 : 1,
  color: on ? "var(--amber)" : "var(--faint)",
  background: on ? "color-mix(in srgb,var(--amber) 20%,transparent)" : "var(--bg)",
  border: "1px solid " + (on ? "var(--amber)" : "var(--line)"),
  boxShadow: on ? "0 0 8px var(--amber-soft)" : "none",
});
const soonTag = {
  fontSize: 9, fontWeight: 700, letterSpacing: ".1em", padding: "3px 8px", borderRadius: 5,
  color: "var(--amber)", background: "var(--amber-soft)", border: "1px solid var(--amber-soft)",
};

function CardHead({ dotOn, onToggle, disabled, idx, title, sub, soon }) {
  const tip = disabled ? "STRIP ACTIVE를 먼저 켜세요" : dotOn ? "이 이펙트 끄기" : "이 이펙트 켜기";
  return (
    <div style={CARD_HEAD}>
      <button title={tip} disabled={disabled} onClick={disabled ? undefined : onToggle} style={dotStyle(dotOn, disabled)} />
      <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--faint)" }}>{idx}</span>
      <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".02em", color: "var(--cream)" }}>{title}</span>
      {sub && <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>}
      {!sub && <span style={{ flex: 1 }} />}
      {soon
        ? <span style={soonTag}>SOON</span>
        : <button title={tip} disabled={disabled} onClick={disabled ? undefined : onToggle} style={tagStyle(dotOn, disabled)}>{dotOn ? "ON" : "OFF"}</button>}
    </div>
  );
}

/* ---------- circular knob (mockup) ---------- */
function Knob({ value, min, max, label, fmt, color, size, step, disabled, onGrab, onChange }) {
  color = color || "var(--amber)"; size = size || 46;
  const r = size / 2, R = r - 3, arc = 2 * Math.PI * R * 0.75;
  const norm = clamp((value - min) / (max - min), 0, 1), ang = -135 + norm * 270;

  // Mouse wheel = ±1 step per notch, same as the EQ rails. React's onWheel is passive, so
  // stopping the panel from scrolling needs a native non-passive listener; latest props are read
  // through a ref so the listener installed once always sees current values.
  const knobRef = useRef(null);
  const cbRef = useRef({}); cbRef.current = { value, min, max, step, disabled, onGrab, onChange };
  useEffect(() => {
    const el = knobRef.current;
    if (!el) return;
    const onWheel = (e) => {
      const c = cbRef.current;
      if (c.disabled) return;
      e.preventDefault();
      const st = c.step || (c.max - c.min) / 100;
      const nv = clamp(snap(c.value + (e.deltaY < 0 ? st : -st), st), c.min, c.max);
      if (nv === c.value) return;
      if (c.onGrab) c.onGrab();
      c.onChange(nv);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const down = (e) => {
    if (disabled) return;
    e.preventDefault();
    const y0 = e.clientY, v0 = value;
    if (onGrab) onGrab();
    const move = (ev) => onChange(clamp(v0 + ((y0 - ev.clientY) / 150) * (max - min), min, max));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const dbl = () => { if (disabled) return; if (onGrab) onGrab(); onChange((min + max) / 2); };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, userSelect: "none", width: size + 22 }}>
      <div ref={knobRef} onMouseDown={down} onDoubleClick={dbl} title="드래그 · 더블클릭=중앙값 · 휠=미세 조절"
        style={{ width: size, height: size, cursor: disabled ? "default" : "ns-resize" }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={r} cy={r} r={R} fill="var(--bg)" stroke="rgba(0,0,0,.5)" strokeWidth="1.5" />
          <circle cx={r} cy={r} r={R} fill="none" stroke="var(--surface3)" strokeWidth="3" strokeDasharray={`${arc} 999`} transform={`rotate(135 ${r} ${r})`} strokeLinecap="round" />
          <circle cx={r} cy={r} r={R} fill="none" stroke={color} strokeWidth="3" strokeDasharray={`${arc * norm} 999`} transform={`rotate(135 ${r} ${r})`} strokeLinecap="round" />
          <line x1={r} y1={r} x2={r} y2="6" stroke={color} strokeWidth="2.2" strokeLinecap="round" transform={`rotate(${ang} ${r} ${r})`} />
        </svg>
      </div>
      <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--cream-2)", whiteSpace: "nowrap" }}>{fmt(value)}</div>
    </div>
  );
}
const krow = (children) => <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-start" }}>{children}</div>;

/* ---------- 9-band graphic EQ (vertical rail sliders, mockup) ---------- */
// `disabled` locks interaction (strip bypassed); `dim` is the softer "module is off but you can
// still grab a fader — it auto-arms" look.
function GraphicEq({ geq, disabled, dim, onGrab, onSetBand }) {
  const railH = 122, min = -12, max = 12, center = railH / 2, colW = 60, railW = 32;
  const yFor = (v) => railH - ((v - min) / (max - min)) * railH;
  const setBand = (i, cy, rect) => onSetBand(i, clamp(min + (1 - (cy - rect.top) / rect.height) * (max - min), min, max));
  const down = (i) => (e) => {
    if (disabled) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    if (onGrab) onGrab();
    setBand(i, e.clientY, rect);
    const move = (ev) => setBand(i, ev.clientY, rect);
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const dbl = (i) => () => { if (disabled) return; if (onGrab) onGrab(); onSetBand(i, 0); };

  // Mouse wheel = ±0.1 dB per notch. React registers `wheel` as passive, so preventDefault
  // (to stop the panel scrolling) needs a native non-passive listener. Latest props are read
  // through refs so the single listener installed once always sees current values.
  const wrapRef = useRef(null);
  const geqRef = useRef(geq); geqRef.current = geq;
  const cbRef = useRef({}); cbRef.current = { disabled, onGrab, onSetBand };
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      const rail = e.target.closest && e.target.closest("[data-band]");
      if (!rail) return;
      const { disabled: dis, onGrab: grab, onSetBand: set } = cbRef.current;
      if (dis) return;
      e.preventDefault();
      const i = +rail.getAttribute("data-band");
      const cur = geqRef.current[i] || 0;
      const nv = clamp(Math.round((cur + (e.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10, min, max);
      if (grab) grab();
      set(i, nv);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const cols = EQ_FREQS.map((f, i) => {
    const val = geq[i] || 0, ty = yFor(val), fillTop = Math.min(center, ty), fillH = Math.abs(center - ty);
    return (
      <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, width: colW }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 700, height: 13, color: val > 0.05 ? "var(--green)" : val < -0.05 ? "var(--red)" : "var(--faint)" }}>{(val >= 0 ? "+" : "") + val.toFixed(1)}</div>
        <div data-band={i} onMouseDown={down(i)} onDoubleClick={dbl(i)}
          title="드래그 · 더블클릭=0dB · 휠=0.1dB"
          style={{ position: "relative", width: railW, height: railH, borderRadius: railW / 2, cursor: disabled ? "default" : "ns-resize",
            background: "linear-gradient(180deg,var(--surface),var(--bg))", border: "1px solid var(--line-strong)", boxShadow: "inset 0 2px 7px rgba(0,0,0,.4)" }}>
          <div style={{ position: "absolute", left: 5, right: 5, top: center, height: 1.5, background: "var(--line-strong)", transform: "translateY(-50%)" }} />
          <div style={{ position: "absolute", left: 6, right: 6, top: fillTop, height: fillH, borderRadius: 4, background: "linear-gradient(180deg,color-mix(in srgb,var(--amber) 55%,transparent),color-mix(in srgb,var(--amber) 20%,transparent))" }} />
          <div style={{ position: "absolute", left: "50%", top: ty, width: railW + 6, height: 14, borderRadius: 5, transform: "translate(-50%,-50%)",
            background: "linear-gradient(180deg,var(--surface3),var(--surface2))", border: "1.5px solid var(--amber)", boxShadow: "0 3px 7px -2px #000,0 0 7px var(--amber-soft)" }}>
            <div style={{ position: "absolute", left: 7, right: 7, top: "50%", height: 2, transform: "translateY(-50%)", background: "var(--amber)", borderRadius: 2, opacity: 0.85 }} />
          </div>
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--muted)" }}>{BAND_LABELS[i]}</div>
      </div>
    );
  });
  return (
    <div ref={wrapRef} style={{ opacity: disabled ? 0.4 : dim ? 0.72 : 1, transition: "opacity .2s" }}>
      <div style={{ display: "flex", justifyContent: "center", gap: 0, padding: "4px 0 2px", borderRadius: 12, border: "1px solid var(--line-strong)", background: "radial-gradient(120% 120% at 50% 0%,var(--surface2) 0%,var(--bg) 75%)", overflowX: "auto" }}>
        <div style={{ position: "relative", flex: "0 0 26px", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "20px 0 24px", fontFamily: "var(--mono)", fontSize: 8, color: "var(--faint)", textAlign: "right", width: 26 }}>
          <span>+12</span><span>0</span><span>-12</span>
        </div>
        {cols}
      </div>
    </div>
  );
}

function WindowControls() {
  if (!window.electronAPI || window.electronAPI.platform === "darwin") return <div style={{ width: 84 }} />;
  const act = (e, name) => { e.currentTarget.blur(); window.electronAPI.winAction(name); };
  const s = { width: 44, display: "grid", placeItems: "center", color: "var(--cream-2)", background: "transparent", border: "none", cursor: "pointer", WebkitAppRegion: "no-drag" };
  return (
    <div style={{ display: "flex", alignItems: "stretch", height: "100%" }}>
      <button style={s} onMouseDown={(e) => e.preventDefault()} onClick={(e) => act(e, "minimize")} title="Minimize"><svg width="13" height="13" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none"><path d="M5 12h14" /></svg></button>
      <button style={s} onMouseDown={(e) => e.preventDefault()} onClick={(e) => act(e, "maximize")} title="Maximize"><svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none"><rect x="5" y="5" width="14" height="14" rx="1.5" /></svg></button>
      <button style={{ ...s, fontSize: 17 }} onMouseDown={(e) => e.preventDefault()} onClick={(e) => act(e, "close")} title="Close"
        onMouseEnter={(e) => { e.currentTarget.style.background = "#b94a3a"; e.currentTarget.style.color = "#fff"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--cream-2)"; }}>×</button>
    </div>
  );
}

/* ---------- placeholder body for not-yet-wired sections ---------- */
function PlaceholderBody({ note, children }) {
  return (
    <div style={{ padding: "15px 16px 17px" }}>
      <div style={{ opacity: 0.4, pointerEvents: "none", filter: "grayscale(.3)" }}>{children}</div>
      <div style={{ marginTop: 10, fontSize: 10.5, color: "var(--faint)", lineHeight: 1.5 }}>{note}</div>
    </div>
  );
}

function VocalStripApp() {
  const [theme, setTheme] = useState("default");
  const [tracks, setTracks] = useState([]);
  const [projectName, setProjectName] = useState("");
  const [targetId, setTargetId] = useState(getQueryTrack());
  const [vfx, setVfx] = useState(defaultVocalFx());
  const [isPlaying, setIsPlaying] = useState(false);
  const [preset, setPreset] = useState(null);
  // Drag handlers capture their callbacks at mousedown, so module on/off must be read through a
  // ref (state closed over at mousedown would stay stale for the whole drag).
  const vfxRef = useRef(vfx); vfxRef.current = vfx;
  // "User switched this module off on purpose" — gates auto-arm (see setBand / setComp).
  const userOffRef = useRef({ eq: false, comp: false });
  const targetIdRef = useRef(getQueryTrack());
  useEffect(() => { targetIdRef.current = targetId; }, [targetId]);

  useEffect(() => {
    vsChannel.postMessage({ type: "ADVANCED_READY" });
    const onMsg = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "INIT_STATE" || msg.type === "SYNC_STATE") {
        if (msg.theme) setTheme(msg.theme);
        if (typeof msg.projectName === "string") setProjectName(msg.projectName);
        if (typeof msg.isPlaying === "boolean") setIsPlaying(msg.isPlaying);
        if (Array.isArray(msg.tracks)) {
          const vocal = msg.tracks.filter((t) => t.kind === "audioIn" || t.kind === "bounce");
          setTracks(vocal);
          const cur = targetIdRef.current;
          const next = vocal.some((t) => t.id === cur) ? cur : (vocal[0] ? vocal[0].id : "");
          if (next !== cur) { setTargetId(next); targetIdRef.current = next; }
          // Refresh FX from the authoritative studio params. Studio only re-broadcasts on
          // ready / undo / redo / rename — never per SET_TRACK_PARAM — so this reflects
          // undo/redo (the whole reason the window must sync) without clobbering live edits.
          const tk = vocal.find((t) => t.id === next);
          if (tk) setVfx(normalizeVocalFx(tk.params && tk.params.vocalFx));
        }
      } else if (msg.type === "LEVEL_METERS") {
        if (typeof msg.isPlaying === "boolean") setIsPlaying(msg.isPlaying);
      }
    };
    vsChannel.addEventListener("message", onMsg);
    return () => vsChannel.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "default") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  // Live theme changes: the main app broadcasts on a dedicated channel on every theme
  // switch (app.jsx). INIT_STATE only carries the theme at open time, so without this the
  // strip's colors stay frozen when the user changes the app theme.
  useEffect(() => {
    let ch;
    try {
      ch = new BroadcastChannel("focusdaw-theme-sync");
      ch.addEventListener("message", (e) => { if (e.data && e.data.type === "THEME_CHANGED" && e.data.theme) setTheme(e.data.theme); });
    } catch (_) {}
    return () => { try { ch && ch.close(); } catch (_) {} };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") { e.preventDefault(); if (window.electronAPI) window.electronAPI.winAction("close"); else window.close(); return; }
      if (e.code === "Space") { e.preventDefault(); if (!e.repeat) vsChannel.postMessage({ type: "REQUEST_PLAY_PAUSE" }); return; }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); vsChannel.postMessage({ type: "REQUEST_UNDO" }); }
      if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); vsChannel.postMessage({ type: "REQUEST_REDO" }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const target = tracks.find((t) => t.id === targetId) || null;
  const grab = () => vsChannel.postMessage({ type: "BEFORE_CHANGE" });
  const send = (k, v) => { if (targetId) vsChannel.postMessage({ type: "SET_TRACK_PARAM", id: targetId, k, v }); };
  const apply = (mutator, keyList) => {
    setVfx((prev) => { const n = JSON.parse(JSON.stringify(prev)); mutator(n); return n; });
    keyList.forEach(([k, v]) => send(k, v));
  };
  const strip = !!vfx.enabled;
  const setEnabled = (on) => { grab(); apply((n) => { n.enabled = on; }, [["vocalEnabled", on ? 1 : 0]]); };
  const setEqOn = (on) => { userOffRef.current.eq = !on; grab(); apply((n) => { n.eq.on = on; }, [["vocalEqOn", on ? 1 : 0]]); };
  // Auto-arm: modules default to off, so without this the EQ/Comp controls were dead after
  // STRIP ACTIVE unless a preset was applied. Touching a control now enables its module in the
  // same edit (one undo step, since grab() already ran on mousedown). Suppressed once the user
  // switched the module off themselves (card-head ON/OFF) — an explicit off must stick, or A/B
  // by module would flip back on the next fader nudge.
  const setBand = (i, v) => {
    const arm = !vfxRef.current.eq.on && !userOffRef.current.eq;
    const keys = [["vocalEq" + i, v]];
    if (arm) keys.push(["vocalEqOn", 1]);
    apply((n) => { n.eq.geq[i] = v; if (arm) n.eq.on = true; }, keys);
  };
  const setCompOn = (on) => { userOffRef.current.comp = !on; grab(); apply((n) => { n.comp.on = on; }, [["vocalCompOn", on ? 1 : 0]]); };
  const setComp = (field, key, v) => {
    const arm = !vfxRef.current.comp.on && !userOffRef.current.comp;
    const keys = [[key, v]];
    if (arm) keys.push(["vocalCompOn", 1]);
    apply((n) => { n.comp[field] = v; if (arm) n.comp.on = true; }, keys);
  };
  const applyPreset = (name) => {
    const p = VOCAL_PRESETS[name];
    if (!p) return;
    userOffRef.current = { eq: false, comp: false }; // preset turns both modules on
    grab();
    const keys = [["vocalEnabled", 1], ["vocalEqOn", 1], ["vocalCompOn", 1],
      ["vocalCompThreshold", p.comp.threshold], ["vocalCompRatio", p.comp.ratio],
      ["vocalCompAttack", p.comp.attack], ["vocalCompRelease", p.comp.release], ["vocalCompMakeup", p.comp.makeup]];
    p.geq.forEach((v, i) => keys.push(["vocalEq" + i, v]));
    apply((n) => { n.enabled = true; n.eq.on = true; n.comp.on = true; n.eq.geq = p.geq.slice(); n.comp = { ...n.comp, ...p.comp, on: true }; }, keys);
    setPreset(name);
  };

  // Locked = master strip bypassed (nothing to adjust). Module off only dims — its controls stay
  // grabbable and auto-arm the module.
  const eqLocked = !strip, compLocked = !strip;
  const eqDim = strip && !vfx.eq.on, compDim = strip && !vfx.comp.on;

  const bar = (
    <div style={{ position: "relative", height: 38, flex: "0 0 38px", display: "flex", alignItems: "center", gap: 14, padding: "0 6px 0 14px",
      background: "linear-gradient(180deg,var(--bg2),var(--bg))", borderBottom: "1px solid var(--line)", userSelect: "none", WebkitAppRegion: "drag" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto", filter: "drop-shadow(0 0 6px var(--amber-soft))" }}><path d="M3 12h2l2-6 3 14 3-11 2 7 2-4h4" /></svg>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".14em", color: "var(--muted)" }}>VOCAL CHANNEL STRIP</span>
      </div>
      <div style={{ flex: 1, textAlign: "center", fontSize: 12.5, color: "var(--dim)", letterSpacing: ".02em" }}>
        FocusDAW Studio — <b style={{ color: "var(--cream-2)", fontWeight: 600 }}>{target ? target.name : "—"}</b>
      </div>
      <WindowControls />
    </div>
  );

  if (!target) {
    return (
      <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column", background: "var(--bg2)", color: "var(--cream)", fontFamily: "var(--ui)", overflow: "hidden" }}>
        {bar}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", color: "var(--muted)", fontSize: 12.5, lineHeight: 1.7, padding: 24 }}>
          보컬(Audio In / Bounce) 트랙이 없습니다.<br />먼저 보컬을 녹음하거나 트랙을 추가하세요.
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column", background: "var(--bg2)", color: "var(--cream)", fontFamily: "var(--ui)", fontSize: 13, lineHeight: 1.35, overflow: "hidden" }}>
      {bar}

      <div style={{ flex: "1 1 auto", overflowY: "auto", overflowX: "hidden", background: "var(--bg)" }}>
        <div style={{ maxWidth: 940, margin: "0 auto", padding: "18px 22px 40px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Track header: name + kind badge + track selector + project name */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontFamily: "'Michroma',var(--ui)", fontSize: 19, letterSpacing: ".02em", color: "var(--cream)" }}>{target.name}</span>
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--amber)", background: "var(--amber-soft)", border: "1px solid var(--amber-soft)", borderRadius: 5, padding: "3px 7px" }}>{target.kind === "bounce" ? "BOUNCE" : "AUDIO IN"}</span>
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--faint)" }}>{projectName ? "Project: " + projectName : "Insert chain · pre-fader"}</div>
            </div>
          </div>

          {/* PRESET row + master A/B */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 14px", ...CARD, boxShadow: "none" }}>
            <span style={{ flex: "0 0 auto", fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: "var(--muted)" }}>PRESET</span>
            <div style={{ flex: 1, minWidth: 220, display: "flex", gap: 7, flexWrap: "wrap" }}>
              {Object.keys(VOCAL_PRESETS).map((name) => {
                const act = preset === name;
                return (
                  <button key={name} onClick={() => applyPreset(name)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600,
                    border: "1px solid " + (act ? "var(--amber)" : "var(--line)"), background: act ? "var(--amber)" : "var(--bg)", color: act ? "var(--on-amber, var(--mixer-bar-fg))" : "var(--dim)", boxShadow: act ? "0 0 10px var(--amber-soft)" : "none" }}>
                    <span style={{ width: 6, height: 6, borderRadius: 2, background: act ? "var(--on-amber, var(--mixer-bar-fg))" : "var(--faint)" }} />{name}
                  </button>
                );
              })}
            </div>
            {/* Active = the theme's highlight colour (--amber follows the colour scheme), not a
                fixed green. Bypassed reads as disabled: neutral fill, faint text, no glow. */}
            <button onClick={() => setEnabled(!strip)} style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8, padding: "8px 15px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: ".06em",
              border: "1px solid " + (strip ? "var(--amber)" : "var(--line)"),
              background: strip ? "color-mix(in srgb,var(--amber) 20%,transparent)" : "var(--bg)",
              color: strip ? "var(--amber)" : "var(--faint)",
              boxShadow: strip ? "0 0 12px var(--amber-soft)" : "none",
              opacity: strip ? 1 : 0.65 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 4v8M6.5 7a8 8 0 1 0 11 0" /></svg>
              {strip ? "STRIP ACTIVE" : "Bypassed"}
            </button>
          </div>

          {/* Spectrum (Stage C placeholder) */}
          <div style={CARD}>
            <div style={CARD_HEAD}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 20V10M8 20V4M13 20v-7M18 20V8M22 20H2" /></svg>
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".02em", color: "var(--cream)" }}>Spectrum</span>
              <span style={{ fontSize: 10.5, color: "var(--muted)" }}>이펙트 적용 전 / 후 비교</span>
              <span style={{ flex: 1 }} />
              <span style={soonTag}>SOON</span>
            </div>
            <div style={{ padding: "14px 16px 16px" }}>
              <div style={{ height: 120, borderRadius: 12, border: "1px solid var(--line-strong)", background: "radial-gradient(130% 130% at 50% 0%,var(--surface2) 0%,var(--bg) 78%)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--faint)", fontSize: 11 }}>
                적용 전/후 실측 FFT 스펙트럼 — 다음 단계(Stage C)에서 제공
              </div>
            </div>
          </div>

          {/* HPF | Noise Gate (Stage D placeholder) */}
          <div style={CARD}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
              <div style={{ minWidth: 0 }}>
                <CardHead dotOn={false} disabled idx="01" title="High-Pass Filter" soon />
                <PlaceholderBody note="럼블 / 플로시브 제거 — Stage D">
                  {krow([
                    <Knob key="f" value={vfx.hpf.freq} min={40} max={300} label="Freq" color="var(--blue)" size={48} disabled fmt={(v) => v.toFixed(0) + " Hz"} onChange={() => {}} />,
                  ])}
                </PlaceholderBody>
              </div>
              <div style={{ minWidth: 0, borderLeft: "1px solid var(--line)" }}>
                <CardHead dotOn={false} disabled idx="02" title="Noise Gate" soon />
                <PlaceholderBody note="구간 무음(숨소리/룸톤) — Stage D">
                  {krow([
                    <Knob key="t" value={vfx.gate.threshold} min={-70} max={-10} label="Thresh" disabled fmt={(v) => v.toFixed(0) + " dB"} onChange={() => {}} />,
                    <Knob key="r" value={vfx.gate.ratio} min={1} max={10} label="Ratio" disabled fmt={(v) => v.toFixed(0) + ":1"} onChange={() => {}} />,
                  ])}
                </PlaceholderBody>
              </div>
            </div>
          </div>

          {/* 03 — 9-band EQ (functional) */}
          <div style={CARD}>
            <CardHead dotOn={vfx.eq.on} disabled={!strip} onToggle={() => setEqOn(!vfx.eq.on)} idx="03" title="Equalizer" sub="9밴드 그래픽 EQ — 페이더 드래그로 조절 (더블클릭=0dB)" />
            <div style={{ padding: "15px 16px 17px" }}>
              <GraphicEq geq={vfx.eq.geq} disabled={eqLocked} dim={eqDim} onGrab={grab} onSetBand={setBand} />
            </div>
          </div>

          {/* 04 — Compressor (functional) */}
          <div style={CARD}>
            <CardHead dotOn={vfx.comp.on} disabled={!strip} onToggle={() => setCompOn(!vfx.comp.on)} idx="04" title="Compressor" sub="다이나믹 제어 — 노브 드래그 · 휠 미세 조절 (더블클릭=중앙값)" />
            <div style={{ padding: "15px 16px 17px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap", opacity: compLocked ? 0.4 : compDim ? 0.72 : 1, transition: "opacity .2s" }}>
                {krow([
                  <Knob key="t" value={vfx.comp.threshold} min={-48} max={0} step={1} label="Thresh" disabled={compLocked} onGrab={grab} onChange={(v) => setComp("threshold", "vocalCompThreshold", v)} fmt={(v) => v.toFixed(0) + " dB"} />,
                  <Knob key="r" value={vfx.comp.ratio} min={1} max={12} step={0.1} label="Ratio" disabled={compLocked} onGrab={grab} onChange={(v) => setComp("ratio", "vocalCompRatio", v)} fmt={(v) => v.toFixed(1) + ":1"} />,
                  <Knob key="a" value={vfx.comp.attack} min={0.5} max={80} step={1} label="Attack" disabled={compLocked} onGrab={grab} onChange={(v) => setComp("attack", "vocalCompAttack", v)} fmt={(v) => v.toFixed(0) + " ms"} />,
                  <Knob key="rl" value={vfx.comp.release} min={30} max={400} step={5} label="Release" disabled={compLocked} onGrab={grab} onChange={(v) => setComp("release", "vocalCompRelease", v)} fmt={(v) => v.toFixed(0) + " ms"} />,
                  <Knob key="m" value={vfx.comp.makeup} min={0} max={12} step={0.1} label="Makeup" color="var(--green)" disabled={compLocked} onGrab={grab} onChange={(v) => setComp("makeup", "vocalCompMakeup", v)} fmt={(v) => "+" + v.toFixed(1)} />,
                ])}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 150, flex: 1 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em", color: "var(--muted)" }}>GAIN REDUCTION</span>
                  <div style={{ position: "relative", height: 14, borderRadius: 7, background: "var(--bg)", border: "1px solid var(--line)", overflow: "hidden" }}>
                    <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: vfx.comp.on ? "38%" : "0%", background: "linear-gradient(90deg,var(--amber),var(--red))", borderRadius: "0 6px 6px 0" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: 9, color: "var(--faint)" }}><span>-12</span><span>-6</span><span>0 dB</span></div>
                </div>
              </div>
            </div>
          </div>

          {/* 05 — De-esser (Stage E placeholder) */}
          <div style={CARD}>
            <CardHead dotOn={false} disabled idx="05" title="De-Esser" soon />
            <PlaceholderBody note="치찰음(sibilance) 제어 — Stage E">
              {krow([
                <Knob key="f" value={vfx.deEss.freq} min={2000} max={12000} label="Freq" color="var(--violet)" disabled fmt={(v) => (v / 1000).toFixed(1) + "k"} onChange={() => {}} />,
                <Knob key="t" value={vfx.deEss.threshold} min={-48} max={0} label="Thresh" disabled fmt={(v) => v.toFixed(0) + " dB"} onChange={() => {}} />,
                <Knob key="a" value={vfx.deEss.amount} min={0} max={1} label="Amount" color="var(--red)" disabled fmt={(v) => Math.round(v * 100) + "%"} onChange={() => {}} />,
              ])}
            </PlaceholderBody>
          </div>

        </div>
      </div>

      <div style={{ height: 30, flex: "0 0 30px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", background: "var(--bg)", borderTop: "1px solid rgba(0,0,0,.4)", fontSize: 10.5, color: "var(--faint)" }}>
        <span>{strip ? "채널 스트립 활성 — 인서트 pre-fader" : "스트립 우회중 (A/B 비교)"}</span>
        <span style={{ fontFamily: "var(--mono)" }}>{isPlaying ? "playing" : "stopped"} · EQ + Comp</span>
      </div>
    </div>
  );
}

ReactDOM.render(<VocalStripApp />, document.getElementById("root"));
