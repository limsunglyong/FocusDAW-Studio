// Advanced Effect — Equalizer module.
// Full-size graphic 9-band EQ editor that drives the studio master EQ
// (DAW.master.bands) over the shared BroadcastChannel. Shows the combined
// Output-track FFT as a live backdrop, exposes the engine's base presets
// (Flat/Pop/Classic/HipHop) and 5 renameable user preset slots with an
// over-roll Save/Recall menu. Space toggles transport (forwarded to studio).

const eqChannel = new BroadcastChannel("focusdaw-advanced-effects-sync");

// Fallbacks — overwritten by INIT_STATE.eqFreqs / eqPresets from the studio.
const EQ_FREQS_FALLBACK = [60, 150, 320, 640, 1200, 2400, 4800, 9000, 15000];
const EQ_PRESETS_FALLBACK = { Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0] };
const BAND_LABELS = ["60", "150", "320", "640", "1.2k", "2.4k", "4.8k", "9k", "15k"];
// 3 low / 3 mid / 3 high → red / amber / blue zones, mirroring the mixer.
const ZONE_COL = ["var(--red)", "var(--amber)", "var(--blue)"];
const zoneOf = (i) => (i < 3 ? 0 : i < 6 ? 1 : 2);

// Base-preset buttons (label, engine preset key, accent colour).
const BASE_PRESETS = [
  ["Reset", "Flat", "var(--dim)"],
  ["Pop", "Pop", "var(--amber)"],
  ["Classic", "Classic", "var(--blue)"],
  ["Hip Hop", "HipHop", "var(--violet)"],
];

const USER_KEY = "focusdaw-eq-user-presets";
const N_USER = 5;
function loadUserPresets() {
  try {
    const raw = JSON.parse(localStorage.getItem(USER_KEY) || "null");
    if (Array.isArray(raw) && raw.length === N_USER) return raw.map(normalizeSlot);
  } catch (_) {}
  return Array.from({ length: N_USER }, (_, i) => ({ name: "User " + (i + 1), bands: null }));
}
function normalizeSlot(s) {
  const bands = Array.isArray(s && s.bands) && s.bands.length === 9 ? s.bands.map(Number) : null;
  return { name: (s && s.name) || "User", bands };
}
function saveUserPresets(slots) {
  try { localStorage.setItem(USER_KEY, JSON.stringify(slots)); } catch (_) {}
}

function sameBands(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs((a[i] || 0) - (b[i] || 0)) > 0.05) return false;
  return true;
}
function baseLabel(name) {
  const e = BASE_PRESETS.find(([, n]) => n === name);
  return e ? e[0] : name;
}

// Catmull-Rom → cubic-bezier smoothing for the EQ curve.
function smoothPath(pts) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function WindowControlsAef() {
  if (!window.electronAPI || window.electronAPI.platform === "darwin") return <div style={{ width: 84 }} />;
  const act = (e, name) => { e.currentTarget.blur(); window.electronAPI.winAction(name); };
  const suppressFocus = (e) => e.preventDefault();
  return (
    <div className="window-controls" aria-label="Window controls">
      <button className="window-control" onMouseDown={suppressFocus} onClick={(e) => act(e, "minimize")} title="Minimize" aria-label="Minimize"><span aria-hidden="true">-</span></button>
      <button className="window-control" onMouseDown={suppressFocus} onClick={(e) => act(e, "maximize")} title="Maximize" aria-label="Maximize"><span aria-hidden="true">□</span></button>
      <button className="window-control close" onMouseDown={suppressFocus} onClick={(e) => act(e, "close")} title="Close" aria-label="Close"><span aria-hidden="true">×</span></button>
    </div>
  );
}

/* ---------- The interactive EQ stage (FFT backdrop + curve + band handles) ---------- */
function EqStage({ bands, freqs, fft, bandLevels, presetName, nameCustom, onBeforeChange, onSetBand }) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const [size, setSize] = useState({ w: 760, h: 360 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.max(320, r.width), h: Math.max(220, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const pad = 20;
  const fmin = 30, fmax = 18000;
  const freqToX = (f) => (Math.log(f / fmin) / Math.log(fmax / fmin)) * w;
  const gainToY = (g) => h / 2 - (g / 12) * (h / 2 - pad);
  const yToGain = (y) => Math.max(-12, Math.min(12, ((h / 2 - y) / (h / 2 - pad)) * 12));

  const pts = freqs.map((f, i) => [freqToX(f), gainToY(bands[i] || 0)]);
  const curveP = [[0, gainToY(bands[0] || 0)], ...pts, [w, gainToY(bands[8] || 0)]];
  const eqLine = smoothPath(curveP);
  const zeroY = gainToY(0);
  const isFlat = bands.every((b) => Math.abs(b) < 0.1);

  // Output-track FFT backdrop (combined tracks). n is normalized 0..1 per point.
  const specPath = (() => {
    if (!fft || !fft.length) return null;
    const sp = fft.map((p) => [freqToX(p.f), h - pad * 0.4 - p.n * (h - pad * 1.6)]);
    return smoothPath(sp) + ` L${w} ${h} L0 ${h} Z`;
  })();

  const onPtDown = (i) => (e) => {
    e.preventDefault(); e.stopPropagation();
    onBeforeChange();
    const move = (ev) => {
      const r = svgRef.current.getBoundingClientRect();
      onSetBand(i, Math.round(yToGain(ev.clientY - r.top) * 10) / 10);
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const resetBand = (i) => (e) => { e.preventDefault(); e.stopPropagation(); onBeforeChange(); onSetBand(i, 0); };

  const GRID_DB = [-12, -6, 0, 6, 12];

  return (
    <div ref={wrapRef} className="eq-stage">
      {presetName && <div className={"eq-stage-name" + (nameCustom ? " custom" : "")}>{presetName}</div>}
      <svg ref={svgRef} width={w} height={h} className="eq-svg" style={{ cursor: "ns-resize" }}>
        <defs>
          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--amber)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--amber)" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="eqSpec" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--amber)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--amber)" stopOpacity="0" />
          </linearGradient>
          <filter id="eqGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* FFT backdrop */}
        {specPath && <path d={specPath} fill="url(#eqSpec)" stroke="var(--amber)" strokeWidth="1" strokeOpacity="0.28" />}

        {/* live band-level columns (pulse during playback) */}
        {bandLevels && pts.map((p, i) => {
          const lv = Math.max(0, Math.min(1, bandLevels[i] || 0));
          const colH = lv * (h - pad * 1.4);
          return <rect key={"lv" + i} x={p[0] - 13} y={h - pad * 0.4 - colH} width={26} height={colH}
            rx="3" fill={ZONE_COL[zoneOf(i)]} opacity={0.10 + lv * 0.16} />;
        })}

        {/* dB grid */}
        {GRID_DB.map((g) => (
          <g key={g}>
            <line x1="0" y1={gainToY(g)} x2={w} y2={gainToY(g)}
              stroke={g === 0 ? "rgba(232,212,170,.28)" : "rgba(232,212,170,.08)"} strokeWidth={g === 0 ? 1.2 : 0.8} />
            <text x="6" y={gainToY(g) - 4} className="eq-grid-lbl">{g > 0 ? "+" + g : g}</text>
          </g>
        ))}
        {/* freq grid */}
        {freqs.map((f, i) => (
          <line key={"fg" + i} x1={freqToX(f)} y1={pad * 0.4} x2={freqToX(f)} y2={h - pad * 0.4}
            stroke="rgba(232,212,170,.05)" strokeWidth="1" />
        ))}

        {/* EQ curve — the connecting line is always drawn, including the flat/reset state */}
        <path d={`${eqLine} L${w} ${zeroY} L0 ${zeroY} Z`} fill="url(#eqFill)" opacity={isFlat ? 0.4 : 1} />
        <path d={eqLine} fill="none" stroke="var(--amber)" strokeWidth="2.6"
          filter="url(#eqGlow)" strokeLinecap="round" strokeLinejoin="round" />

        {/* band handles */}
        {pts.map((p, i) => (
          <g key={"h" + i}>
            <line x1={p[0]} y1={zeroY} x2={p[0]} y2={p[1]} stroke={ZONE_COL[zoneOf(i)]} strokeWidth="1.4" opacity=".5" />
            <circle cx={p[0]} cy={p[1]} r="8.5" fill={ZONE_COL[zoneOf(i)]} stroke="var(--bg)" strokeWidth="2"
              className="eq-handle" onMouseDown={onPtDown(i)} onDoubleClick={resetBand(i)}>
              <title>{BAND_LABELS[i]} Hz — drag to set, double-click to reset</title>
            </circle>
          </g>
        ))}
      </svg>

      {/* frequency / dB readout strip */}
      <div className="eq-readout">
        {freqs.map((f, i) => (
          <div key={"r" + i} className="eq-readout-cell">
            <span className="eq-readout-db mono" style={{ color: Math.abs(bands[i]) < 0.1 ? "var(--faint)" : ZONE_COL[zoneOf(i)] }}>
              {bands[i] > 0 ? "+" : ""}{(bands[i] || 0).toFixed(1)}
            </span>
            <span className="eq-readout-hz mono">{BAND_LABELS[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- user preset slot with over-roll Save/Recall/Rename menu ---------- */
function UserSlot({ slot, index, active, onSave, onRecall, onRename }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(slot.name);
  const ref = useRef(null);
  const hasData = !!slot.bands;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const commitRename = () => {
    const name = draft.trim() || slot.name;
    setEditing(false);
    onRename(index, name);
  };

  return (
    <div className="eq-uslot" ref={ref}>
      {editing ? (
        <input className="eq-uslot-input mono" value={draft} autoFocus maxLength={14}
          onChange={(e) => setDraft(e.target.value)} onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setDraft(slot.name); setEditing(false); } }} />
      ) : (
        <button className={"eq-uslot-btn" + (hasData ? " filled" : "") + (active ? " active" : "")} onClick={() => setOpen((o) => !o)}
          title={hasData ? "Saved preset — click for Save / Recall" : "Empty slot — click to Save current EQ"}>
          <span className="eq-uslot-dot" data-on={hasData} />
          <span className="eq-uslot-name">{slot.name}</span>
        </button>
      )}
      {open && (
        <div className="eq-uslot-menu">
          <button className="eq-uslot-item" onClick={() => { onSave(index); setOpen(false); }}>Save here</button>
          <button className={"eq-uslot-item" + (hasData ? "" : " disabled")} disabled={!hasData}
            onClick={() => { if (hasData) { onRecall(index); setOpen(false); } }}>Recall</button>
          <button className="eq-uslot-item" onClick={() => { setDraft(slot.name); setEditing(true); setOpen(false); }}>Rename…</button>
        </div>
      )}
    </div>
  );
}

function AdvancedEqApp() {
  const [theme, setTheme] = useState("default");
  const [bands, setBands] = useState([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const [freqs, setFreqs] = useState(EQ_FREQS_FALLBACK);
  const [presets, setPresets] = useState(EQ_PRESETS_FALLBACK);
  const [fft, setFft] = useState(null);
  const [bandLevels, setBandLevels] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [userSlots, setUserSlots] = useState(loadUserPresets);
  const [eqPreset, setEqPreset] = useState(null); // selected base preset key (engine master.eqPreset)
  const [userSel, setUserSel] = useState(null);    // selected user slot index (window-local)

  // Sync from the studio.
  useEffect(() => {
    eqChannel.postMessage({ type: "ADVANCED_READY" });
    const handleMessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "INIT_STATE" || msg.type === "SYNC_STATE") {
        if (msg.theme) setTheme(msg.theme);
        if (msg.master && msg.master.bands) setBands([...msg.master.bands]);
        if (msg.master) setEqPreset(msg.master.eqPreset || null);
        if (msg.eqFreqs) setFreqs(msg.eqFreqs);
        if (msg.eqPresets) setPresets(msg.eqPresets);
        if (msg.fftData) setFft(msg.fftData);
        if (typeof msg.isPlaying === "boolean") setIsPlaying(msg.isPlaying);
      } else if (msg.type === "LEVEL_METERS") {
        if (msg.masterBandLevels) setBandLevels(msg.masterBandLevels);
        if (msg.bands) setBands([...msg.bands]);
        if (typeof msg.isPlaying === "boolean") setIsPlaying(msg.isPlaying);
      }
    };
    eqChannel.addEventListener("message", handleMessage);
    return () => eqChannel.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "default") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  // Transport + undo/redo forwarded to the studio, same as the other Advanced windows.
  useEffect(() => {
    const handleKey = (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return; // let inline rename type freely
      if (e.key === "Escape" || e.key === "F3") {
        e.preventDefault();
        if (window.electronAPI && window.electronAPI.winAction) window.electronAPI.winAction("close");
        else window.close();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) eqChannel.postMessage({ type: "REQUEST_PLAY_PAUSE" });
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); eqChannel.postMessage({ type: "REQUEST_UNDO" }); }
      if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); eqChannel.postMessage({ type: "REQUEST_REDO" }); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Drop a stale user-slot selection once the bands no longer match it (e.g. edited
  // here or from the mixer). Runs whenever bands/selection/slots change.
  useEffect(() => {
    if (userSel != null && !(userSlots[userSel] && sameBands(bands, userSlots[userSel].bands))) setUserSel(null);
  }, [bands, userSel, userSlots]);

  const grab = () => eqChannel.postMessage({ type: "BEFORE_CHANGE" });
  const setBand = (i, v) => {
    setBands((b) => { const n = [...b]; n[i] = v; return n; }); // optimistic; studio echoes
    setEqPreset(null); setUserSel(null); // manual edit → custom
    eqChannel.postMessage({ type: "SET_MASTER_BAND", i, v });
  };
  const applyPreset = (name) => {
    grab();
    const arr = presets[name];
    if (arr) setBands([...arr]);
    setEqPreset(name === "Flat" ? null : name); setUserSel(null);
    eqChannel.postMessage({ type: "APPLY_EQ_PRESET", name });
  };
  const applyBands = (arr) => {
    grab();
    setBands([...arr]);
    setEqPreset(null);
    arr.forEach((v, i) => eqChannel.postMessage({ type: "SET_MASTER_BAND", i, v }));
  };

  const saveSlot = (i) => setUserSlots((slots) => {
    const next = slots.map((s, k) => (k === i ? { ...s, bands: [...bands] } : s));
    saveUserPresets(next); return next;
  });
  const renameSlot = (i, name) => setUserSlots((slots) => {
    const next = slots.map((s, k) => (k === i ? { ...s, name } : s));
    saveUserPresets(next); return next;
  });
  // Renaming the currently-recalled slot should re-tag the shared name (mixer overlay too).
  useEffect(() => {
    if (userSel != null && userSlots[userSel]) {
      const nm = userSlots[userSel].name;
      setEqPreset(nm);
      eqChannel.postMessage({ type: "SET_EQ_PRESET_NAME", name: nm });
    }
  }, [userSel, userSlots]);
  const recallSlot = (i) => {
    const s = userSlots[i];
    if (s && s.bands) {
      applyBands(s.bands);           // applies bands; engine clears eqPreset…
      setUserSel(i);                 // …the effect above re-tags the slot name to engine + mixer
    }
  };

  // Currently-selected name shown in the stage: user slot › base preset › "custom"
  // (any manual deviation from flat) › nothing (flat/reset).
  const bandsFlat = bands.every((b) => Math.abs(b || 0) < 0.05);
  let displayName = null, nameCustom = false;
  if (userSel != null && userSlots[userSel]) displayName = userSlots[userSel].name;
  else if (eqPreset) displayName = baseLabel(eqPreset);
  else if (!bandsFlat) { displayName = "custom"; nameCustom = true; }

  return (
    <div className="aef-backdrop">
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
              <span className="aef-toolbar-label">EQUALIZER</span>
            </span>
            <AdvancedViewMenu current="eq" />
            <div className="title-c" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", flex: "none" }}>FocusDAW Studio <b>Equalizer</b></div>
            <div style={{ marginLeft: "auto" }} />
            <WindowControlsAef />
          </div>

          <div className="aef-room eq-room">
            <EqStage bands={bands} freqs={freqs} fft={fft} bandLevels={isPlaying ? bandLevels : null}
              presetName={displayName} nameCustom={nameCustom} onBeforeChange={grab} onSetBand={setBand} />

            <div className="eq-controls">
              <div className="eq-preset-row">
                <span className="eq-row-label">PRESET</span>
                {BASE_PRESETS.map(([lbl, name, col]) => (
                  <button key={name} className={"eq-preset-btn" + (userSel == null && eqPreset === name ? " active" : "")}
                    onClick={(e) => { applyPreset(name); e.currentTarget.blur(); }}
                    title={`Apply ${lbl} EQ`} style={{ "--chip": col }}>
                    <span className="eq-preset-dot" />{lbl}
                  </button>
                ))}
              </div>
              <div className="eq-preset-row">
                <span className="eq-row-label">USER</span>
                {userSlots.map((s, i) => (
                  <UserSlot key={i} slot={s} index={i} active={userSel === i} onSave={saveSlot} onRecall={recallSlot} onRename={renameSlot} />
                ))}
              </div>
            </div>
          </div>

          <div className="aef-footer">
            <span>Equalizer · Output bus · {isPlaying ? "playing" : "stopped"}</span>
            <span className="mono">FocusDAW Studio</span>
          </div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.render(<AdvancedEqApp />, document.getElementById("root"));
