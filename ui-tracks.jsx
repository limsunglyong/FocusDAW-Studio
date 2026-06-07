/* ================= FocusDAW — track lanes, waveforms, automation ================= */
const HEADER_W = 244;

/* ---------- waveform canvas ---------- */
function Waveform({ track, clips, pxPerSec, ampZoom, height }) {
  const ref = useRef(null);
  const laneW = Math.max(1, DAW.duration * pxPerSec);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = laneW * dpr; cv.height = height * dpr;
    cv.style.width = laneW + "px"; cv.style.height = height + "px";
    const c2d = cv.getContext("2d"); c2d.scale(dpr, dpr);
    c2d.clearRect(0, 0, laneW, height);
    const peaks = track.peaks; const nb = peaks.length / 2;
    const bufDur = track.buffer.duration;
    const mid = height / 2;
    const clipArr = clips || [{ start: 0, end: bufDur, offset: 0, params: null }];

    clipArr.forEach((clip) => {
      const clipW = (clip.end - clip.start) * pxPerSec;
      const clipX = clip.start * pxPerSec;
      if (clipW <= 0) return;

      // baseline
      c2d.strokeStyle = "rgba(255,255,255,.05)"; c2d.lineWidth = 1;
      c2d.beginPath(); c2d.moveTo(clipX, mid); c2d.lineTo(clipX + clipW, mid); c2d.stroke();

      // waveform body
      c2d.fillStyle = track.color + "33";
      c2d.strokeStyle = track.color;
      c2d.lineWidth = 1;
      c2d.beginPath();
      for (let px = 0; px <= clipW; px++) {
        const bufPos = clip.offset + (px / clipW) * (clip.end - clip.start);
        const bIdx = Math.floor((bufPos / bufDur) * nb);
        const max = peaks[Math.min(nb - 1, bIdx) * 2 + 1] || 0;
        c2d.lineTo(clipX + px, mid - max * mid * 0.92 * ampZoom);
      }
      for (let px = clipW; px >= 0; px--) {
        const bufPos = clip.offset + (px / clipW) * (clip.end - clip.start);
        const bIdx = Math.floor((bufPos / bufDur) * nb);
        const min = peaks[Math.min(nb - 1, bIdx) * 2] || 0;
        c2d.lineTo(clipX + px, mid - min * mid * 0.92 * ampZoom);
      }
      c2d.closePath(); c2d.fill();
      c2d.globalAlpha = .85; c2d.stroke(); c2d.globalAlpha = 1;

      // clip boundary lines
      c2d.strokeStyle = "rgba(232,212,170,.30)"; c2d.lineWidth = 1.5;
      c2d.beginPath(); c2d.moveTo(clipX, 0); c2d.lineTo(clipX, height); c2d.stroke();
      c2d.beginPath(); c2d.moveTo(clipX + clipW, 0); c2d.lineTo(clipX + clipW, height); c2d.stroke();
    });
  }, [pxPerSec, ampZoom, height, laneW, track, clips]);
  return <canvas ref={ref} style={{ position: "absolute", inset: 0, display: "block" }} />;
}

/* ---------- volume automation overlay (editable) ---------- */
function AutomationOverlay({ track, pxPerSec, height }) {
  const laneW = Math.max(1, DAW.duration * pxPerSec);
  const auto = track.params.automation;
  const drag = useRef(null);
  const toXY = (p) => [p.t * laneW, (1 - p.v) * height];
  const update = (arr) => DAW.setTrackParam(track.id, "automation", arr);

  const onPtDown = (i) => (e) => {
    e.stopPropagation(); e.preventDefault();
    drag.current = i;
    const move = (ev) => {
      const svg = ev.currentTarget;
      const host = document.getElementById("auto-" + track.id);
      const r = host.getBoundingClientRect();
      let t = (ev.clientX - r.left) / laneW;
      let v = 1 - (ev.clientY - r.top) / height;
      v = Math.max(0, Math.min(1, v));
      const arr = auto.map((p) => ({ ...p }));
      if (i === 0) t = 0; else if (i === arr.length - 1) t = 1;
      else t = Math.max(arr[i - 1].t + 0.001, Math.min(arr[i + 1].t - 0.001, t));
      arr[i] = { t, v };
      update(arr);
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); drag.current = null; };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const onPtRemove = (i) => (e) => {
    e.preventDefault(); e.stopPropagation();
    if (i === 0 || i === auto.length - 1) return;
    update(auto.filter((_, k) => k !== i));
  };
  const onLineDown = (e) => {
    const host = document.getElementById("auto-" + track.id);
    const r = host.getBoundingClientRect();
    const t = (e.clientX - r.left) / laneW;
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / height));
    const arr = [...auto, { t, v }].sort((a, b) => a.t - b.t);
    update(arr);
  };
  const pathD = auto.map((p, i) => { const [x, y] = toXY(p); return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1); }).join(" ");
  const areaD = pathD + ` L${laneW} ${height} L0 ${height} Z`;
  return (
    <svg id={"auto-" + track.id} width={laneW} height={height} onMouseDown={onLineDown}
      style={{ position: "absolute", inset: 0, cursor: "crosshair" }}>
      <path d={areaD} fill="rgba(232,176,75,.10)" />
      <path d={pathD} fill="none" stroke="var(--amber)" strokeWidth="2" strokeLinejoin="round" />
      {auto.map((p, i) => { const [x, y] = toXY(p); return (
        <circle key={i} cx={x} cy={y} r={5.5} fill="var(--amber)" stroke="#241a0a" strokeWidth="1.5"
          style={{ cursor: "grab" }} onMouseDown={onPtDown(i)} onContextMenu={onPtRemove(i)} />
      ); })}
    </svg>
  );
}

/* ---------- track header ---------- */
function TrackHeader({ track, idx, level, onParam, onRemove, automationView }) {
  const p = track.params;
  return (
    <div style={{ width: HEADER_W, flex: `0 0 ${HEADER_W}px`, position: "sticky", left: 0, zIndex: 6,
      background: "linear-gradient(180deg,var(--surface),var(--bg2))", borderRight: "1px solid var(--line-strong)",
      borderBottom: "1px solid var(--line)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 4, alignSelf: "stretch", borderRadius: 3, background: track.color, boxShadow: `0 0 8px ${track.color}66` }} />
        <span className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>{String(idx + 1).padStart(2, "0")}</span>
        <span style={{ fontWeight: 600, fontSize: 13.5, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.name}</span>
        <SoloBtn on={p.solo} onClick={() => onParam("solo", !p.solo)} />
        <MuteBtn on={p.mute} onClick={() => onParam("mute", !p.mute)} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        {/* horizontal volume fader */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <Icon name="wave" size={13} style={{ color: "var(--muted)", flex: "0 0 auto" }} />
          <input type="range" min="0" max="1" step="0.005" value={p.volume}
            onChange={(e) => onParam("volume", +e.target.value)} style={{ flex: 1, minWidth: 0 }} />
          <span className="mono" style={{ fontSize: 9.5, color: "var(--cream-2)", width: 28, textAlign: "right", flex: "0 0 auto" }}>{fmtDb(p.volume)}</span>
        </div>
        <Knob value={p.pan} min={-1} max={1} size={28} color="var(--blue)"
          onChange={(v) => onParam("pan", v)} />
        <Meter level={level} height={28} width={6} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button className="iconbtn" style={{ width: 26, height: 22, borderRadius: 5,
          background: p.autoOn ? "var(--amber-soft)" : "transparent", color: p.autoOn ? "var(--amber)" : "var(--muted)" }}
          title="Volume automation" onClick={() => onParam("autoOn", !p.autoOn)}>
          <Icon name="auto" size={15} />
        </button>
        <span style={{ fontSize: 10, color: p.autoOn ? "var(--amber)" : "var(--faint)", fontWeight: 600, letterSpacing: ".04em" }}>VOL AUTO</span>
        <div style={{ flex: 1 }} />
        {track.needsAudio
          ? <span title="Drop the audio file here to re-link" style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4,
              fontWeight: 700, letterSpacing: ".04em", background: "rgba(217,106,78,.18)",
              color: "var(--red)", border: "1px solid rgba(217,106,78,.28)" }}>NO AUDIO</span>
          : <span className="chip" style={{ fontSize: 9, padding: "2px 5px" }}>{track.type}</span>
        }
        {onRemove && <button className="iconbtn" style={{ width: 22, height: 22 }} title="Remove track" onClick={onRemove}><Icon name="trash" size={13} /></button>}
      </div>
    </div>
  );
}

/* ---------- one track row (header + lane) ---------- */
function TrackRow({ track, idx, pxPerSec, ampZoom, laneH, playhead, level, onParam, onRemove, onSeek, tool, onSplit, onJoin }) {
  const laneW = Math.max(1, DAW.duration * pxPerSec);
  const phx = (playhead / DAW.duration) * laneW;
  const p = track.params;
  const [hoveredClipId, setHoveredClipId] = useState(null);

  const laneMouseMove = (e) => {
    if (tool !== 'scissors' && tool !== 'join') { setHoveredClipId(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const sec = ((e.clientX - r.left) / laneW) * DAW.duration;
    const clip = track.clips && track.clips.find(c => sec >= c.start && sec < c.end);
    setHoveredClipId(clip ? clip.id : null);
  };

  const laneClick = (e) => {
    if (e.target.closest("svg")) return;
    const r = e.currentTarget.getBoundingClientRect();
    const sec = ((e.clientX - r.left) / laneW) * DAW.duration;

    if (tool === 'scissors') {
      const clip = track.clips && track.clips.find(c => sec >= c.start && sec < c.end);
      if (clip) onSplit(track.id, clip.id, sec);
      return;
    }
    if (tool === 'join') {
      if (!track.clips) return;
      const ci = track.clips.findIndex(c => sec >= c.start && sec < c.end);
      if (ci >= 0 && ci < track.clips.length - 1)
        onJoin(track.id, track.clips[ci].id, track.clips[ci + 1].id);
      else if (ci > 0)
        onJoin(track.id, track.clips[ci - 1].id, track.clips[ci].id);
      return;
    }
    onSeek(sec);
  };

  const toolCursor = tool === 'scissors' ? 'crosshair' : tool === 'join' ? 'cell' : 'text';

  return (
    <div style={{ display: "flex", minWidth: "min-content" }}>
      <TrackHeader track={track} idx={idx} level={level} onParam={onParam} onRemove={onRemove} />
      <div onMouseDown={laneClick} onMouseMove={laneMouseMove} onMouseLeave={() => setHoveredClipId(null)}
        style={{ position: "relative", width: laneW, height: laneH,
          background: idx % 2 ? "rgba(255,255,255,.012)" : "transparent",
          borderBottom: "1px solid var(--line)", overflow: "hidden", cursor: toolCursor }}>
        <BarGrid pxPerSec={pxPerSec} height={laneH} />
        <Waveform track={track} clips={track.clips} pxPerSec={pxPerSec} ampZoom={ampZoom} height={laneH} />
        {p.autoOn && <AutomationOverlay track={track} pxPerSec={pxPerSec} height={laneH} />}
        {/* scissors hover highlight */}
        {hoveredClipId && tool === 'scissors' && (() => {
          const clip = track.clips.find(c => c.id === hoveredClipId);
          if (!clip) return null;
          return <div style={{ position: "absolute", top: 0, bottom: 0,
            left: clip.start * pxPerSec, width: (clip.end - clip.start) * pxPerSec,
            background: "rgba(232,176,75,.07)", border: "1px solid rgba(232,176,75,.3)",
            pointerEvents: "none" }} />;
        })()}
        {/* join hover highlight */}
        {hoveredClipId && tool === 'join' && (() => {
          const ci = track.clips ? track.clips.findIndex(c => c.id === hoveredClipId) : -1;
          if (ci < 0 || !track.clips) return null;
          const clipA = track.clips[ci], clipB = track.clips[ci + 1] || track.clips[ci - 1];
          if (!clipA || !clipB) return null;
          const x1 = Math.min(clipA.start, clipB.start) * pxPerSec;
          const x2 = Math.max(clipA.end, clipB.end) * pxPerSec;
          return <div style={{ position: "absolute", top: 0, bottom: 0,
            left: x1, width: x2 - x1,
            background: "rgba(159,191,122,.07)", border: "1px solid rgba(159,191,122,.3)",
            pointerEvents: "none" }} />;
        })()}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: phx, width: 1.5, background: "var(--cream)", boxShadow: "0 0 6px rgba(239,230,212,.6)", pointerEvents: "none" }} />
      </div>
    </div>
  );
}

/* ---------- bar grid lines ---------- */
function BarGrid({ pxPerSec, height }) {
  const bars = DAW.bars; const beatsPerBar = 4;
  const lines = [];
  const totalBeats = bars * beatsPerBar;
  for (let b = 0; b <= totalBeats; b++) {
    const x = (b * (DAW.secPerBar / beatsPerBar)) * pxPerSec;
    const isBar = b % beatsPerBar === 0;
    lines.push(<div key={b} style={{ position: "absolute", top: 0, bottom: 0, left: x, width: 1,
      background: isBar ? "rgba(232,212,170,.10)" : "rgba(232,212,170,.04)" }} />);
  }
  return <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>{lines}</div>;
}

/* ---------- ruler (time scale) ---------- */
function rulerLabel(t, step) {
  const m = Math.floor(t / 60), s = t % 60;
  if (step < 1) return `${m}:${String(Math.floor(s)).padStart(2, "0")}.${Math.round((s % 1) * 10)}`;
  return `${m}:${String(Math.floor(s)).padStart(2, "0")}`;
}
function Ruler({ pxPerSec, playhead, onSeek }) {
  const laneW = Math.max(1, DAW.duration * pxPerSec);
  const STEPS = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
  const step = STEPS.find((s) => s * pxPerSec >= 76) || 60;
  const marks = [];
  for (let i = 0; i * step <= DAW.duration + 1e-6; i++) {
    const t = i * step;
    const x = t * pxPerSec;
    marks.push(
      <div key={i} style={{ position: "absolute", left: x, top: 0, bottom: 0, display: "flex", alignItems: "flex-end", paddingBottom: 3 }}>
        <div style={{ width: 1, background: "var(--line-strong)", position: "absolute", top: 10, bottom: 0 }} />
        <span className="mono" style={{ fontSize: 10, color: "var(--dim)", paddingLeft: 5 }}>{rulerLabel(t, step)}</span>
      </div>
    );
    // minor tick at half-step
    const hx = x + (step / 2) * pxPerSec;
    if ((i + 0.5) * step <= DAW.duration + 1e-6)
      marks.push(<div key={i + "h"} style={{ position: "absolute", left: hx, top: 18, bottom: 0, width: 1, background: "rgba(232,212,170,.06)" }} />);
  }
  const phx = (playhead / DAW.duration) * laneW;
  const seek = (e) => { const r = e.currentTarget.getBoundingClientRect(); onSeek(((e.clientX - r.left) / laneW) * DAW.duration); };
  return (
    <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 8 }}>
      <div style={{ width: HEADER_W, flex: `0 0 ${HEADER_W}px`, position: "sticky", left: 0, zIndex: 9,
        background: "var(--bg2)", borderRight: "1px solid var(--line-strong)", borderBottom: "1px solid var(--line-strong)",
        height: 30, display: "flex", alignItems: "center", gap: 7, padding: "0 12px" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".1em", color: "var(--muted)", textTransform: "uppercase" }}>Time</span>
        <span className="mono" style={{ fontSize: 9.5, color: "var(--faint)", marginLeft: "auto" }}>m:ss</span>
      </div>
      <div onMouseDown={seek} style={{ position: "relative", width: laneW, height: 30, background: "var(--bg2)",
        borderBottom: "1px solid var(--line-strong)", cursor: "text" }}>
        {marks}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: phx, width: 1.5, background: "var(--amber)" }} />
        <div style={{ position: "absolute", top: 0, left: phx - 5, width: 10, height: 8, background: "var(--amber)", clipPath: "polygon(0 0,100% 0,50% 100%)" }} />
      </div>
    </div>
  );
}

Object.assign(window, { Waveform, AutomationOverlay, TrackHeader, TrackRow, Ruler, BarGrid, HEADER_W });
