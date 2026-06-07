/* ================= FocusDAW — mixer window + output effect track ================= */

/* ---------- channel strip ---------- */
function ChannelStrip({ track, level, onParam }) {
  const p = track.params;
  return (
    <div style={{ width: 92, flex: "0 0 92px", display: "flex", flexDirection: "column", alignItems: "center",
      padding: "10px 6px", borderRight: "1px solid var(--line)", gap: 8, background: p.solo ? "rgba(232,176,75,.05)" : "transparent" }}>
      <div style={{ height: 3, width: "70%", borderRadius: 2, background: track.color, boxShadow: `0 0 8px ${track.color}` }} />
      <div style={{ fontSize: 11.5, fontWeight: 600, textAlign: "center", height: 28, overflow: "hidden", lineHeight: 1.1 }}>{track.name}</div>
      {/* FX knobs */}
      <div style={{ display: "flex", gap: 4 }}>
        <Knob value={p.reverb} size={28} color="var(--violet)" label="VRB" onChange={(v) => onParam("reverb", v)} />
        <Knob value={p.echo} size={28} color="var(--blue)" label="ECHO" onChange={(v) => onParam("echo", v)} />
      </div>
      <Knob value={p.filterFreq} min={200} max={20000} curve={3} size={30} color="var(--green)" label="FILTER"
        onChange={(v) => onParam("filterFreq", v)} format={(v) => (v >= 19000 ? "OFF" : (v / 1000).toFixed(1) + "k")} />
      <div style={{ display: "flex", gap: 5 }}>
        <SoloBtn on={p.solo} size={22} onClick={() => onParam("solo", !p.solo)} />
        <MuteBtn on={p.mute} size={22} onClick={() => onParam("mute", !p.mute)} />
      </div>
      <Knob value={p.pan} min={-1} max={1} size={26} color="var(--cream-2)" label="PAN"
        onChange={(v) => onParam("pan", v)} format={(v) => (Math.abs(v) < 0.02 ? "C" : (v < 0 ? "L" : "R") + Math.round(Math.abs(v) * 100))} />
      {/* fader + meter */}
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end", marginTop: 2 }}>
        <Fader value={p.volume} height={120} onChange={(v) => onParam("volume", v)} />
        <Meter level={level} height={120} width={7} />
      </div>
      <div className="mono" style={{ fontSize: 9.5, color: "var(--cream-2)" }}>{fmtDb(p.volume)} dB</div>
    </div>
  );
}

/* ---------- master: FFT + draggable 9-band EQ ---------- */
function smoothPath(P) {
  if (P.length < 2) return "";
  let d = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || P[i + 1];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
function MasterEQ({ width = 320, height = 156 }) {
  useTick(false);
  const [, force] = useState(0);
  const ref = useRef(null);
  const fmin = 30, fmax = 18000, pad = 14;
  const freqToX = (f) => (Math.log(f / fmin) / Math.log(fmax / fmin)) * width;
  const gainToY = (g) => height / 2 - (g / 12) * (height / 2 - pad);
  const yToGain = (y) => Math.max(-12, Math.min(12, ((height / 2 - y) / (height / 2 - pad)) * 12));
  const spec = DAW.computeSpectrum();
  const bands = DAW.master.bands;
  const FQ = DAW.EQ_FREQS;
  const zoneCol = ["var(--red)", "var(--amber)", "var(--blue)"];
  const zoneOf = (i) => (i < 3 ? 0 : i < 6 ? 1 : 2);

  const onPtDown = (i) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const move = (ev) => {
      const r = ref.current.getBoundingClientRect();
      DAW.setMasterBand(i, Math.round(yToGain(ev.clientY - r.top) * 10) / 10);
      force((n) => n + 1);
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const resetBand = (i) => (e) => { e.preventDefault(); e.stopPropagation(); DAW.setMasterBand(i, 0); force((n) => n + 1); };

  // spectrum backdrop area
  let specD = `M0 ${height}`;
  spec.forEach((p) => { specD += ` L${freqToX(p.f).toFixed(1)} ${(height - p.n * (height * 0.86)).toFixed(1)}`; });
  specD += ` L${width} ${height} Z`;
  // EQ response curve through band pts + edge anchors
  const pts = FQ.map((f, i) => [freqToX(f), gainToY(bands[i])]);
  const curveP = [[0, gainToY(bands[0])], ...pts, [width, gainToY(bands[8])]];
  const eqLine = smoothPath(curveP);
  const eqArea = eqLine + ` L${width} ${gainToY(0)} L0 ${gainToY(0)} Z`;
  // zone boundaries
  const b1 = freqToX(Math.sqrt(FQ[2] * FQ[3])), b2 = freqToX(Math.sqrt(FQ[5] * FQ[6]));

  return (
    <div style={{ width, position: "relative" }}>
      <svg ref={ref} width={width} height={height} style={{ display: "block", borderRadius: 8, background: "#15110b", cursor: "ns-resize" }}>
        {/* zone tints */}
        <rect x="0" y="0" width={b1} height={height} fill="rgba(217,106,78,.05)" />
        <rect x={b1} y="0" width={b2 - b1} height={height} fill="rgba(232,176,75,.05)" />
        <rect x={b2} y="0" width={width - b2} height={height} fill="rgba(127,176,196,.05)" />
        {/* gridlines (dB) */}
        {[-12, -6, 0, 6, 12].map((g) => (
          <g key={g}>
            <line x1="0" y1={gainToY(g)} x2={width} y2={gainToY(g)} stroke={g === 0 ? "rgba(232,212,170,.20)" : "rgba(232,212,170,.06)"} strokeWidth={g === 0 ? 1 : 0.75} />
            <text x="3" y={gainToY(g) - 2} fill="var(--faint)" fontSize="8" fontFamily="var(--mono)">{g > 0 ? "+" + g : g}</text>
          </g>
        ))}
        {/* whole-song FFT spectrum */}
        <path d={specD} fill="rgba(216,205,182,.12)" stroke="rgba(216,205,182,.28)" strokeWidth="1" />
        {/* EQ response */}
        <path d={eqArea} fill="rgba(232,176,75,.12)" />
        <path d={eqLine} fill="none" stroke="var(--amber)" strokeWidth="2" />
        {/* band handles */}
        {pts.map((p, i) => (
          <g key={i}>
            <line x1={p[0]} y1={gainToY(0)} x2={p[0]} y2={p[1]} stroke={zoneCol[zoneOf(i)]} strokeWidth="1" opacity=".4" />
            <circle cx={p[0]} cy={p[1]} r="6" fill={zoneCol[zoneOf(i)]} stroke="#15110b" strokeWidth="1.5"
              style={{ cursor: "ns-resize" }} onMouseDown={onPtDown(i)} onDoubleClick={resetBand(i)} />
          </g>
        ))}
      </svg>
      {/* frequency labels */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: -13, height: 12 }}>
        {FQ.map((f, i) => (
          <span key={i} className="mono" style={{ position: "absolute", left: freqToX(f), transform: "translateX(-50%)", fontSize: 7.5, color: "var(--faint)" }}>
            {f >= 1000 ? (f / 1000) + "k" : f}
          </span>
        ))}
      </div>
    </div>
  );
}

function MasterViewTab({ active, children, onClick }) {
  return (
    <button onClick={onClick} className="chip" style={{
      fontSize: 9, textTransform: "uppercase", border: "1px solid " + (active ? "rgba(232,176,75,.5)" : "transparent"),
      color: active ? "var(--amber)" : "var(--dim)", background: active ? "rgba(232,176,75,.12)" : "rgba(255,255,255,.05)",
      cursor: "pointer",
    }}>
      {children}
    </button>
  );
}

function MasterEQOverlay({ width = 300, height = 156 }) {
  const [, force] = useState(0);
  const ref = useRef(null);
  const fmin = 30, fmax = 18000, pad = 14;
  const freqToX = (f) => (Math.log(f / fmin) / Math.log(fmax / fmin)) * width;
  const gainToY = (g) => height / 2 - (g / 12) * (height / 2 - pad);
  const yToGain = (y) => Math.max(-12, Math.min(12, ((height / 2 - y) / (height / 2 - pad)) * 12));
  const bands = DAW.master.bands;
  const FQ = DAW.EQ_FREQS;
  const zoneCol = ["var(--red)", "var(--amber)", "var(--blue)"];
  const zoneOf = (i) => (i < 3 ? 0 : i < 6 ? 1 : 2);
  const pts = FQ.map((f, i) => [freqToX(f), gainToY(bands[i])]);
  const curveP = [[0, gainToY(bands[0])], ...pts, [width, gainToY(bands[8])]];
  const eqLine = smoothPath(curveP);

  const onPtDown = (i) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const move = (ev) => {
      const r = ref.current.getBoundingClientRect();
      DAW.setMasterBand(i, Math.round(yToGain(ev.clientY - r.top) * 10) / 10);
      force((n) => n + 1);
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const resetBand = (i) => (e) => { e.preventDefault(); e.stopPropagation(); DAW.setMasterBand(i, 0); force((n) => n + 1); };

  return (
    <svg ref={ref} width={width} height={height} style={{ position: "absolute", inset: 0, display: "block", cursor: "ns-resize" }}>
      {[-12, -6, 0, 6, 12].map((g) => (
        <line key={g} x1="0" y1={gainToY(g)} x2={width} y2={gainToY(g)}
          stroke={g === 0 ? "rgba(232,212,170,.24)" : "rgba(232,212,170,.07)"} strokeWidth={g === 0 ? 1 : 0.75} />
      ))}
      <path d={`${eqLine} L${width} ${gainToY(0)} L0 ${gainToY(0)} Z`} fill="rgba(232,176,75,.08)" />
      <path d={eqLine} fill="none" stroke="var(--amber)" strokeWidth="2.2" />
      {pts.map((p, i) => (
        <g key={i}>
          <line x1={p[0]} y1={gainToY(0)} x2={p[0]} y2={p[1]} stroke={zoneCol[zoneOf(i)]} strokeWidth="1" opacity=".45" />
          <circle cx={p[0]} cy={p[1]} r="6" fill={zoneCol[zoneOf(i)]} stroke="#15110b" strokeWidth="1.6"
            style={{ cursor: "ns-resize" }} onMouseDown={onPtDown(i)} onDoubleClick={resetBand(i)} />
        </g>
      ))}
    </svg>
  );
}

function MasterLevelMeter({ width = 300, height = 156 }) {
  useTick();
  const labels = ["60", "150", "320", "640", "1.2k", "2.4k", "4.8k", "9k", "15k"];
  const colors = ["var(--red)", "var(--red)", "var(--red)", "var(--amber)", "var(--amber)", "var(--amber)", "var(--blue)", "var(--blue)", "var(--blue)"];
  const steps = 15;
  const levels = DAW.getMasterBandLevels ? DAW.getMasterBandLevels() : DAW.EQ_FREQS.map(() => DAW.getMasterLevel());
  return (
    <div style={{ width, height, position: "relative", borderRadius: 8, background: "#15110b", border: "1px solid rgba(232,212,170,.06)",
      overflow: "hidden", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.015)" }}>
      <div style={{ position: "absolute", inset: 0, padding: "11px 12px 16px", display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 8, opacity: .82 }}>
        {levels.map((lv, i) => {
          const active = Math.round(Math.max(0, Math.min(1, lv)) * steps);
          return (
            <div key={labels[i]} style={{ minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{ flex: 1, width: "100%", display: "flex", flexDirection: "column-reverse", gap: 3 }}>
                {Array.from({ length: steps }).map((_, s) => {
                  const on = s < active;
                  const hot = s > steps * 0.78;
                  return (
                    <span key={s} style={{ height: 5, borderRadius: 2, background: on ? (hot ? "var(--amber)" : colors[i]) : "rgba(232,212,170,.05)",
                      boxShadow: on ? `0 0 ${hot ? 10 : 7}px ${hot ? "var(--amber)" : colors[i]}` : "none",
                      opacity: on ? 0.9 : 1 }} />
                  );
                })}
              </div>
              <span className="mono" style={{ fontSize: 7.5, color: "var(--faint)" }}>{labels[i]}</span>
            </div>
          );
        })}
      </div>
      <MasterEQOverlay width={width} height={height} />
    </div>
  );
}

/* ---------- master effect card ---------- */
function FxCard({ icon, name, value, color, onChange }) {
  const on = value > 0.001;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 9,
      background: on ? "rgba(255,255,255,.03)" : "rgba(255,255,255,.012)", border: "1px solid " + (on ? "var(--line-strong)" : "var(--line)") }}>
      <div style={{ width: 28, height: 28, borderRadius: 7, display: "grid", placeItems: "center", flex: "0 0 auto",
        background: on ? color : "var(--surface2)", color: on ? "#15110b" : "var(--muted)" }}>
        <Icon name={icon} size={15} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: on ? "var(--cream)" : "var(--dim)" }}>{name}</div>
        <SleekSlider value={value} min={0} max={1} step={0.01} onChange={onChange} width={120} ticks={4} />
      </div>
      <span className="mono" style={{ fontSize: 10, color: on ? "var(--cream-2)" : "var(--faint)", width: 30, textAlign: "right" }}>{Math.round(value * 100)}%</span>
    </div>
  );
}

/* ---------- master panel (wide) ---------- */
function MasterPanel({ level, master, onMaster }) {
  const [view, setView] = useState("eq");
  const grpDb = (g) => master.bands.slice(g * 3, g * 3 + 3).reduce((a, b) => a + b, 0) / 3;
  return (
    <div style={{ width: 392, flex: "0 0 392px", display: "flex", flexDirection: "column", padding: "12px 14px", gap: 11,
      background: "linear-gradient(180deg,rgba(232,176,75,.06),transparent 40%)", borderLeft: "1px solid var(--line-strong)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", color: "var(--amber)" }}>MASTER</span>
        <MasterViewTab active={view === "eq"} onClick={() => setView("eq")}>Graphic EQ · FFT</MasterViewTab>
        <MasterViewTab active={view === "meter"} onClick={() => setView("meter")}>Level meter</MasterViewTab>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10, color: "var(--cream-2)" }}>{fmtDb(master.volume)} dB</span>
      </div>

      {/* EQ + fader row */}
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div style={{ paddingBottom: 14 }}>
          {view === "eq" ? <MasterEQ width={300} height={156} /> : <MasterLevelMeter width={300} height={156} />}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 9, color: "var(--muted)", fontWeight: 600, letterSpacing: ".08em" }}>VOL</span>
          <div style={{ display: "flex", gap: 5, alignItems: "flex-end" }}>
            <Fader value={master.volume} height={132} color="var(--amber)" onChange={(v) => onMaster("volume", v)} />
            <Meter level={level} height={132} width={7} />
            <Meter level={level * 0.92} height={132} width={7} />
          </div>
        </div>
      </div>

      {/* zone summary */}
      <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
        {[["LOW", "var(--red)", 0], ["MID", "var(--amber)", 1], ["HIGH", "var(--blue)", 2]].map(([lbl, col, g]) => (
          <div key={lbl} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "5px 0", borderRadius: 7, background: "rgba(255,255,255,.02)", border: "1px solid var(--line)" }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: col }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: "var(--dim)", letterSpacing: ".06em" }}>{lbl}</span>
            <span className="mono" style={{ fontSize: 10, color: "var(--cream-2)" }}>{grpDb(g) >= 0 ? "+" : ""}{grpDb(g).toFixed(1)}</span>
          </div>
        ))}
      </div>

      {/* effects */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: "var(--muted)", textTransform: "uppercase" }}>Output Effects</span>
        <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <FxCard icon="disc" name="Reverb" color="var(--violet)" value={master.reverb} onChange={(v) => onMaster("reverb", v)} />
        <FxCard icon="loop" name="Echo / Delay" color="var(--blue)" value={master.echo} onChange={(v) => onMaster("echo", v)} />
        <button style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 9, border: "1px dashed var(--line-strong)", color: "var(--muted)", fontSize: 11.5, justifyContent: "center", background: "transparent" }}>
          <Icon name="plus" size={13} /> Add effect
        </button>
      </div>
    </div>
  );
}

/* ---------- mixer window (floating, OS-style) ---------- */
function MixerWindow({ onClose }) {
  useTick();
  const channelW = 92;
  const masterW = 392;
  const bodyW = DAW.tracks.length * channelW + masterW;
  const windowW = Math.min(window.innerWidth - 56, bodyW + 2);
  const [pos, setPos] = useState({ x: Math.max(28, window.innerWidth - windowW - 52), y: 96 });
  const dragRef = useRef(null);
  const onTitleDown = (e) => {
    dragRef.current = { mx: e.clientX, my: e.clientY, x: pos.x, y: pos.y };
    const move = (ev) => setPos({ x: dragRef.current.x + (ev.clientX - dragRef.current.mx), y: Math.max(44, dragRef.current.y + (ev.clientY - dragRef.current.my)) });
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const param = (id) => (k, v) => DAW.setTrackParam(id, k, v);
  return (
    <div style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 1000, width: windowW,
      background: "var(--bg)", borderRadius: 12, border: "1px solid var(--line-strong)", boxShadow: "var(--shadow)", overflow: "hidden" }}>
      <div onMouseDown={onTitleDown} style={{ height: 36, display: "flex", alignItems: "center", gap: 10, padding: "0 12px",
        background: "linear-gradient(#2a2520,#221d17)", borderBottom: "1px solid var(--line)", cursor: "grab" }}>
        <Icon name="mixer" size={15} style={{ color: "var(--amber)", marginLeft: 4 }} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Mixer</span>
        <div style={{ flex: 1 }} />
        <button onMouseDown={(e) => e.stopPropagation()} onClick={onClose} title="Close mixer"
          style={{ width: 28, height: 24, borderRadius: 7, display: "grid", placeItems: "center",
            background: "var(--surface2)", color: "var(--cream-2)", border: "1px solid var(--line-strong)",
            fontSize: 14, fontWeight: 700, lineHeight: 1 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--red)"; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "var(--red)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface2)"; e.currentTarget.style.color = "var(--cream-2)"; e.currentTarget.style.borderColor = "var(--line-strong)"; }}>
          ×
        </button>
      </div>
      <div style={{ display: "flex", overflowX: "auto", maxWidth: "100%", background: "var(--bg)" }}>
        <div style={{ display: "flex", flex: "0 0 auto" }}>
          {DAW.tracks.map((t) => <ChannelStrip key={t.id} track={t} level={DAW.getTrackLevel(t.id)} onParam={param(t.id)} />)}
        </div>
        <MasterPanel level={DAW.getMasterLevel()} master={DAW.master} onMaster={(k, v) => DAW.setMaster(k, v)} />
      </div>
    </div>
  );
}

/* ---------- output effect track (master fade + EQ overlay on timeline) ---------- */
function OutputTrack({ pxPerSec, laneH, playhead, onSeek }) {
  useTick();
  const laneW = Math.max(1, DAW.duration * pxPerSec);
  const m = DAW.master;
  const phx = (playhead / DAW.duration) * laneW;
  const inX = m.fadeIn * pxPerSec;
  const outX = (DAW.duration - m.fadeOut) * pxPerSec;
  const dragFade = (which) => (e) => {
    e.stopPropagation(); e.preventDefault();
    const host = e.currentTarget.closest(".outlane");
    const move = (ev) => {
      const r = host.getBoundingClientRect();
      const t = Math.max(0, Math.min(DAW.duration, (ev.clientX - r.left) / pxPerSec));
      if (which === "in") DAW.setMaster("fadeIn", Math.min(t, DAW.duration / 2));
      else DAW.setMaster("fadeOut", Math.min(DAW.duration - t, DAW.duration / 2));
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  return (
    <div style={{ display: "flex", minWidth: "min-content", borderTop: "2px solid var(--amber-deep)" }}>
      {/* header */}
      <div style={{ width: HEADER_W, flex: `0 0 ${HEADER_W}px`, position: "sticky", left: 0, zIndex: 6,
        background: "linear-gradient(180deg,#2c2418,#221d14)", borderRight: "1px solid var(--line-strong)", padding: "10px 12px",
        display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
          <Icon name="eq" size={15} style={{ color: "var(--amber)", flex: "0 0 auto" }} />
          <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: ".05em", color: "var(--amber)" }}>OUTPUT&nbsp;FX</span>
          <span className="chip" style={{ fontSize: 9, marginLeft: "auto" }}>master</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Knob value={DAW.getMasterGroup(0)} min={-12} max={12} size={28} color="var(--red)" label="LOW" onChange={(v) => DAW.setMasterGroup(0, v)} format={(v) => v.toFixed(0)} />
          <Knob value={DAW.getMasterGroup(1)} min={-12} max={12} size={28} color="var(--amber)" label="MID" onChange={(v) => DAW.setMasterGroup(1, v)} format={(v) => v.toFixed(0)} />
          <Knob value={DAW.getMasterGroup(2)} min={-12} max={12} size={28} color="var(--blue)" label="HIGH" onChange={(v) => DAW.setMasterGroup(2, v)} format={(v) => v.toFixed(0)} />
          <div style={{ flex: 1 }} />
          <Meter level={DAW.getMasterLevel()} height={46} width={7} />
        </div>
      </div>
      {/* lane with fade overlay */}
      <div className="outlane" onMouseDown={(e) => { if (e.target.closest(".fadeh")) return; const r = e.currentTarget.getBoundingClientRect(); onSeek(((e.clientX - r.left) / laneW) * DAW.duration); }}
        style={{ position: "relative", width: laneW, height: laneH, background: "rgba(232,176,75,.04)", cursor: "text", overflow: "hidden" }}>
        <TimeGrid pxPerSec={pxPerSec} height={laneH} />
        {/* EQ band overlay text */}
        <div style={{ position: "absolute", left: 10, top: 6, display: "flex", gap: 10, fontSize: 10, color: "var(--muted)" }} className="mono">
          <span>EQ L{DAW.getMasterGroup(0) >= 0 ? "+" : ""}{DAW.getMasterGroup(0).toFixed(0)}</span>
          <span>M{DAW.getMasterGroup(1) >= 0 ? "+" : ""}{DAW.getMasterGroup(1).toFixed(0)}</span>
          <span>H{DAW.getMasterGroup(2) >= 0 ? "+" : ""}{DAW.getMasterGroup(2).toFixed(0)}</span>
        </div>
        {/* fade in */}
        <svg width={laneW} height={laneH} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <path d={`M0 ${laneH} L${inX} 0 L${inX} ${laneH} Z`} fill="rgba(148,192,106,.18)" stroke="var(--green)" strokeWidth="1.5" />
          <path d={`M${outX} 0 L${laneW} ${laneH} L${outX} ${laneH} Z`} fill="rgba(217,106,78,.16)" stroke="var(--red)" strokeWidth="1.5" />
        </svg>
        <div className="fadeh" onMouseDown={dragFade("in")} style={{ position: "absolute", left: inX - 6, top: -2, width: 12, height: 12, borderRadius: "50%", background: "var(--green)", border: "2px solid #1b1712", cursor: "ew-resize" }} />
        <div className="fadeh" onMouseDown={dragFade("out")} style={{ position: "absolute", left: outX - 6, top: -2, width: 12, height: 12, borderRadius: "50%", background: "var(--red)", border: "2px solid #1b1712", cursor: "ew-resize" }} />
        <div style={{ position: "absolute", left: 6, bottom: 5, fontSize: 9.5, color: "var(--green)" }} className="mono">FADE IN {m.fadeIn.toFixed(1)}s</div>
        <div style={{ position: "absolute", right: 6, bottom: 5, fontSize: 9.5, color: "var(--red)" }} className="mono">FADE OUT {m.fadeOut.toFixed(1)}s</div>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: phx, width: 1.5, background: "var(--cream)", pointerEvents: "none" }} />
      </div>
    </div>
  );
}

Object.assign(window, { ChannelStrip, MasterPanel, MasterEQ, MasterEQOverlay, MasterViewTab, MasterLevelMeter, FxCard, MixerWindow, OutputTrack });
