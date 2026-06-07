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

/* ---------- master strip ---------- */
function MasterStrip({ level, master, onMaster }) {
  return (
    <div style={{ width: 116, flex: "0 0 116px", display: "flex", flexDirection: "column", alignItems: "center",
      padding: "10px 8px", gap: 8, background: "linear-gradient(180deg,rgba(232,176,75,.06),transparent)", borderLeft: "1px solid var(--line-strong)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".12em", color: "var(--amber)" }}>MASTER</div>
      <div style={{ display: "flex", gap: 4 }}>
        <Knob value={master.eqLow} min={-12} max={12} size={30} color="var(--red)" label="LOW" onChange={(v) => onMaster("eqLow", v)} format={(v) => v.toFixed(0)} />
        <Knob value={master.eqMid} min={-12} max={12} size={30} color="var(--amber)" label="MID" onChange={(v) => onMaster("eqMid", v)} format={(v) => v.toFixed(0)} />
        <Knob value={master.eqHigh} min={-12} max={12} size={30} color="var(--blue)" label="HIGH" onChange={(v) => onMaster("eqHigh", v)} format={(v) => v.toFixed(0)} />
      </div>
      <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: ".1em", marginTop: 2 }}>EQUALIZER · dB</div>
      <div style={{ display: "flex", gap: 7, alignItems: "flex-end", marginTop: 6 }}>
        <Fader value={master.volume} height={140} color="var(--amber)" onChange={(v) => onMaster("volume", v)} />
        <Meter level={level} height={140} width={8} />
        <Meter level={level * 0.92} height={140} width={8} />
      </div>
      <div className="mono" style={{ fontSize: 9.5, color: "var(--amber)" }}>{fmtDb(master.volume)} dB</div>
    </div>
  );
}

/* ---------- mixer window (floating, OS-style) ---------- */
function MixerWindow({ onClose }) {
  useTick();
  const [pos, setPos] = useState({ x: Math.max(40, window.innerWidth - 760), y: 96 });
  const dragRef = useRef(null);
  const onTitleDown = (e) => {
    dragRef.current = { mx: e.clientX, my: e.clientY, x: pos.x, y: pos.y };
    const move = (ev) => setPos({ x: dragRef.current.x + (ev.clientX - dragRef.current.mx), y: Math.max(44, dragRef.current.y + (ev.clientY - dragRef.current.my)) });
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const param = (id) => (k, v) => DAW.setTrackParam(id, k, v);
  return (
    <div style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 1000, width: "min(720px,94vw)",
      background: "var(--bg)", borderRadius: 12, border: "1px solid var(--line-strong)", boxShadow: "var(--shadow)", overflow: "hidden" }}>
      <div onMouseDown={onTitleDown} style={{ height: 36, display: "flex", alignItems: "center", gap: 10, padding: "0 12px",
        background: "linear-gradient(#2a2520,#221d17)", borderBottom: "1px solid var(--line)", cursor: "grab" }}>
        <div className="lights"><span className="light l-r" onClick={onClose} style={{ cursor: "pointer" }} /><span className="light l-y" /><span className="light l-g" /></div>
        <Icon name="mixer" size={15} style={{ color: "var(--amber)", marginLeft: 4 }} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Mixer</span>
        <span className="chip" style={{ fontSize: 9 }}>separate window</span>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>synced · BroadcastChannel</span>
      </div>
      <div style={{ display: "flex", overflowX: "auto", maxWidth: "100%", background: "repeating-linear-gradient(90deg,transparent,transparent 91px,var(--line) 91px,var(--line) 92px)" }}>
        <div style={{ display: "flex" }}>
          {DAW.tracks.map((t) => <ChannelStrip key={t.id} track={t} level={DAW.getTrackLevel(t.id)} onParam={param(t.id)} />)}
        </div>
        <MasterStrip level={DAW.getMasterLevel()} master={DAW.master} onMaster={(k, v) => DAW.setMaster(k, v)} />
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
          <Knob value={m.eqLow} min={-12} max={12} size={28} color="var(--red)" label="LOW" onChange={(v) => DAW.setMaster("eqLow", v)} format={(v) => v.toFixed(0)} />
          <Knob value={m.eqMid} min={-12} max={12} size={28} color="var(--amber)" label="MID" onChange={(v) => DAW.setMaster("eqMid", v)} format={(v) => v.toFixed(0)} />
          <Knob value={m.eqHigh} min={-12} max={12} size={28} color="var(--blue)" label="HIGH" onChange={(v) => DAW.setMaster("eqHigh", v)} format={(v) => v.toFixed(0)} />
          <div style={{ flex: 1 }} />
          <Meter level={DAW.getMasterLevel()} height={46} width={7} />
        </div>
      </div>
      {/* lane with fade overlay */}
      <div className="outlane" onMouseDown={(e) => { if (e.target.closest(".fadeh")) return; const r = e.currentTarget.getBoundingClientRect(); onSeek(((e.clientX - r.left) / laneW) * DAW.duration); }}
        style={{ position: "relative", width: laneW, height: laneH, background: "rgba(232,176,75,.04)", cursor: "text", overflow: "hidden" }}>
        <BarGrid pxPerSec={pxPerSec} height={laneH} />
        {/* EQ band overlay text */}
        <div style={{ position: "absolute", left: 10, top: 6, display: "flex", gap: 10, fontSize: 10, color: "var(--muted)" }} className="mono">
          <span>EQ L{m.eqLow >= 0 ? "+" : ""}{m.eqLow.toFixed(0)}</span>
          <span>M{m.eqMid >= 0 ? "+" : ""}{m.eqMid.toFixed(0)}</span>
          <span>H{m.eqHigh >= 0 ? "+" : ""}{m.eqHigh.toFixed(0)}</span>
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

Object.assign(window, { ChannelStrip, MasterStrip, MixerWindow, OutputTrack });
