/* ================= FocusDAW — track lanes, waveforms, automation ================= */
const HEADER_W = 244;

// Select the coarsest peak level that still provides ≥1 bucket per pixel.
// Falls back to fine (highest resolution) when needed.
function choosePeaks(track, pxPerSec) {
  const bufDur = track.buffer ? track.buffer.duration : 0;
  if (!bufDur || !track.peaksCoarse) return track.peaks || [];
  const bucketsNeeded = pxPerSec * bufDur;
  if (bucketsNeeded <= 512) return track.peaksCoarse;
  if (bucketsNeeded <= 2048) return track.peaksMedium || track.peaks || [];
  return track.peaks || [];
}

/* ---------- waveform canvas ---------- */
function Waveform({ track, clips, pxPerSec, ampZoom, height, volume = 1, normalizeToPeak = false }) {
  const ref = useRef(null);
  const isVisibleRef = useRef(true);   // shared between observer and draw effects
  const scheduleRef  = useRef(null);   // latest schedule fn, for observer to trigger redraw
  const laneW = Math.max(1, DAW.duration * pxPerSec);

  // IntersectionObserver — created once on mount, never recreated on zoom/data changes.
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const obsEl = cv.parentElement || cv;
    const obs = new IntersectionObserver(
      ([entry]) => {
        isVisibleRef.current = entry.isIntersecting;
        if (entry.isIntersecting && scheduleRef.current) scheduleRef.current();
      },
      { rootMargin: "200px 0px", threshold: 0 }
    );
    obs.observe(obsEl);
    return () => obs.disconnect();
  }, []); // mount / unmount only

  // Drawing effect — re-runs whenever zoom, data, or size changes.
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const scrollHost = cv.closest("[data-arrange-scroll]");
    const dpr = window.devicePixelRatio || 1;
    const peaks = choosePeaks(track, pxPerSec);
    const nb = peaks.length / 2;
    const bufDur = track.buffer.duration;
    const clipArr = clips || [{ start: 0, end: bufDur, offset: 0, params: null }];
    let raf = null;

    const draw = () => {
      if (!isVisibleRef.current) return;
      const hostW = scrollHost ? scrollHost.clientWidth : window.innerWidth;
      const scrollLeft = scrollHost ? scrollHost.scrollLeft : 0;
      const overscan = 600;
      const drawStart = Math.max(0, scrollLeft - overscan);
      const drawW = Math.max(1, Math.min(laneW - drawStart, hostW + overscan * 2));
      const bitmapW = Math.max(1, Math.ceil(drawW * dpr));
      const bitmapH = Math.max(1, Math.ceil(height * dpr));
      if (cv.width !== bitmapW) cv.width = bitmapW;
      if (cv.height !== bitmapH) cv.height = bitmapH;
      cv.style.left = drawStart + "px";
      cv.style.width = drawW + "px";
      cv.style.height = height + "px";

      const c2d = cv.getContext("2d");
      c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      c2d.clearRect(0, 0, drawW, height);
      if (!nb || !bufDur) return;

      const mid = height / 2;
      let peakScale = volume * 0.92 * ampZoom;
      if (normalizeToPeak) {
        let maxPeak = Number.isFinite(track.peakAmp) ? track.peakAmp : 0;
        if (maxPeak <= 0) {
          for (let i = 0; i < peaks.length; i++) maxPeak = Math.max(maxPeak, Math.abs(peaks[i] || 0));
        }
        peakScale = maxPeak > 0.000001 ? 0.94 / maxPeak : 0;
      }
      clipArr.forEach((clip) => {
        const clipStartX = clip.start * pxPerSec;
        const clipEndX = clip.end * pxPerSec;
        const clipW = clipEndX - clipStartX;
        if (clipW <= 0 || clipEndX < drawStart || clipStartX > drawStart + drawW) return;

        const x0 = Math.max(0, Math.floor(clipStartX - drawStart));
        const x1 = Math.min(drawW, Math.ceil(clipEndX - drawStart));

        // baseline
        c2d.strokeStyle = "rgba(255,255,255,.05)"; c2d.lineWidth = 1;
        c2d.beginPath(); c2d.moveTo(x0, mid); c2d.lineTo(x1, mid); c2d.stroke();

        // waveform body (volume-scaled)
        c2d.fillStyle = track.color + "33";
        c2d.strokeStyle = track.color;
        c2d.lineWidth = 1;
        c2d.beginPath();
        for (let x = x0; x <= x1; x++) {
          const timelinePx = drawStart + x;
          const clipPx = timelinePx - clipStartX;
          const bufPos = clip.offset + (clipPx / clipW) * (clip.end - clip.start);
          const bIdx = Math.floor((bufPos / bufDur) * nb);
          const max = peaks[Math.min(nb - 1, Math.max(0, bIdx)) * 2 + 1] || 0;
          c2d.lineTo(x, mid - max * mid * peakScale);
        }
        for (let x = x1; x >= x0; x--) {
          const timelinePx = drawStart + x;
          const clipPx = timelinePx - clipStartX;
          const bufPos = clip.offset + (clipPx / clipW) * (clip.end - clip.start);
          const bIdx = Math.floor((bufPos / bufDur) * nb);
          const min = peaks[Math.min(nb - 1, Math.max(0, bIdx)) * 2] || 0;
          c2d.lineTo(x, mid - min * mid * peakScale);
        }
        c2d.closePath(); c2d.fill();
        c2d.globalAlpha = .85; c2d.stroke(); c2d.globalAlpha = 1;

        // clipping indicator: peak × volume > 1.0 (ampZoom 무관, 신호 레벨만 판정)
        if (volume > 1.0) {
          c2d.fillStyle = "rgba(220,70,60,.70)";
          c2d.beginPath();
          for (let x = x0; x <= x1; x++) {
            const timelinePx = drawStart + x;
            const clipPx = timelinePx - clipStartX;
            const bufPos = clip.offset + (clipPx / clipW) * (clip.end - clip.start);
            const bIdx = Math.floor((bufPos / bufDur) * nb);
            const maxPk = peaks[Math.min(nb - 1, Math.max(0, bIdx)) * 2 + 1] || 0;
            const minPk = peaks[Math.min(nb - 1, Math.max(0, bIdx)) * 2] || 0;
            if (maxPk * volume > 1.0 || Math.abs(minPk) * volume > 1.0) {
              const yTop = Math.max(0, mid - maxPk * mid * peakScale);
              const yBot = Math.min(height, mid - minPk * mid * peakScale);
              c2d.rect(x, yTop, 1, Math.max(1, yBot - yTop));
            }
          }
          c2d.fill();
        }

        // clip boundary lines
        c2d.strokeStyle = "rgba(232,212,170,.30)"; c2d.lineWidth = 1.5;
        const leftEdge = clipStartX - drawStart;
        const rightEdge = clipEndX - drawStart;
        if (leftEdge >= 0 && leftEdge <= drawW) {
          c2d.beginPath(); c2d.moveTo(leftEdge, 0); c2d.lineTo(leftEdge, height); c2d.stroke();
        }
        if (rightEdge >= 0 && rightEdge <= drawW) {
          c2d.beginPath(); c2d.moveTo(rightEdge, 0); c2d.lineTo(rightEdge, height); c2d.stroke();
        }
      });
    };

    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    scheduleRef.current = schedule;
    draw();
    scrollHost && scrollHost.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      scheduleRef.current = null;
      if (raf) cancelAnimationFrame(raf);
      scrollHost && scrollHost.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [pxPerSec, ampZoom, height, laneW, track, clips, track.audioRev, volume, normalizeToPeak]);
  return <canvas ref={ref} style={{ position: "absolute", top: 0, height, display: "block" }} />;
}

/* ---------- volume automation overlay (editable) ---------- */
function AutomationOverlay({ track, pxPerSec, height, onBeforeChange }) {
  const laneW = Math.max(1, DAW.duration * pxPerSec);
  const auto = track.params.automation;
  const drag = useRef(null);
  const toXY = (p) => [p.t * laneW, (1 - p.v) * height];
  const update = (arr) => DAW.setTrackParam(track.id, "automation", arr);

  const onPtDown = (i) => (e) => {
    e.stopPropagation(); e.preventDefault();
    onBeforeChange && onBeforeChange();
    drag.current = i;
    const move = (ev) => {
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
    onBeforeChange && onBeforeChange();
    update(auto.filter((_, k) => k !== i));
  };
  const onLineDown = (e) => {
    onBeforeChange && onBeforeChange();
    const host = document.getElementById("auto-" + track.id);
    const r = host.getBoundingClientRect();
    const t = (e.clientX - r.left) / laneW;
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / height));
    const arr = [...auto, { t, v }].sort((a, b) => a.t - b.t);
    update(arr);
  };
  const curveFit = track.params.autoCurve;
  const pathD = auto.map((p, i) => { const [x, y] = toXY(p); return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1); }).join(" ");
  // applied curve — memoized so SVG path is only recomputed when points/curve flag/size change.
  const appliedD = React.useMemo(() => {
    if (curveFit && DAW.monotoneCubicCurve && auto.length >= 2) {
      const N = Math.max(64, Math.min(512, Math.round(laneW / 3)));
      const c = DAW.monotoneCubicCurve(auto, N);
      let d = "";
      for (let i = 0; i < N; i++) { const x = (i / (N - 1)) * laneW; const y = (1 - c[i]) * height; d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1); }
      return d;
    }
    return pathD;
  }, [auto, curveFit, laneW, height, pathD]);
  const areaD = appliedD + ` L${laneW} ${height} L0 ${height} Z`;
  return (
    <svg id={"auto-" + track.id} width={laneW} height={height} onMouseDown={onLineDown}
      style={{ position: "absolute", inset: 0, cursor: "crosshair" }}>
      <path d={areaD} fill="rgba(232,176,75,.10)" />
      {/* edit graph (control-point polyline): faint dashed when curve fitting is on */}
      {curveFit && <path d={pathD} fill="none" stroke="var(--amber)" strokeWidth="1.4" strokeLinejoin="round" opacity="0.35" strokeDasharray="4 3" />}
      {/* applied graph (what the audio actually uses) */}
      <path d={appliedD} fill="none" stroke="var(--amber)" strokeWidth="2" strokeLinejoin="round" />
      {auto.map((p, i) => { const [x, y] = toXY(p); return (
        <circle key={i} cx={x} cy={y} r={5.5} fill="var(--amber)" stroke="#241a0a" strokeWidth="1.5"
          style={{ cursor: "grab" }} onMouseDown={onPtDown(i)} onContextMenu={onPtRemove(i)} />
      ); })}
    </svg>
  );
}

/* ---------- track header ---------- */
function ScrollingTrackTitle({ name, compact }) {
  const wrapRef = useRef(null);
  const textRef = useRef(null);
  const [marquee, setMarquee] = useState({ distance: 0, duration: 6 });

  useEffect(() => {
    const wrap = wrapRef.current;
    const text = textRef.current;
    if (!wrap || !text) return;

    const measure = () => {
      const distance = Math.ceil(text.scrollWidth - wrap.clientWidth);
      if (distance > 2) {
        const duration = Math.max(5, Math.min(14, distance / 28 + 4));
        setMarquee((prev) => (
          prev.distance === distance && prev.duration === duration ? prev : { distance, duration }
        ));
      } else {
        setMarquee((prev) => (
          prev.distance === 0 && prev.duration === 6 ? prev : { distance: 0, duration: 6 }
        ));
      }
    };

    measure();
    let raf = requestAnimationFrame(measure);
    let ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(measure);
      });
      ro.observe(wrap);
      ro.observe(text);
    } else {
      window.addEventListener("resize", measure);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", measure);
    };
  }, [name, compact]);

  return (
    <span
      ref={wrapRef}
      className={"track-title-marquee" + (marquee.distance > 0 ? " is-overflowing" : "")}
      title={name}
      tabIndex={marquee.distance > 0 ? 0 : undefined}
      style={{
        fontWeight: 600,
        fontSize: compact ? 12.5 : 13.5,
        "--marquee-distance": marquee.distance + "px",
        "--marquee-duration": marquee.duration + "s",
      }}>
      <span ref={textRef} className="track-title-text">{name}</span>
    </span>
  );
}

// Vari BPM indicator. The blink is synced across all tracks by aligning each
// tag's animation to a shared global clock via a negative animation-delay,
// computed once at mount (recomputing on re-render would break the phase).
const VARI_BPM_BLINK_MS = 1600;
function VariBpmTag() {
  const delayRef = React.useRef(-((performance.now() % VARI_BPM_BLINK_MS) / 1000));
  return (
    <span className="vari-bpm-tag" title="Vari BPM active — playback tempo applied to this track"
      style={{ fontSize: 9, padding: "2px 4px", borderRadius: 4, fontWeight: 400, letterSpacing: ".04em",
        textTransform: "uppercase", cursor: "default", animationDelay: delayRef.current + "s",
        background: "rgba(217,106,78,.18)", color: "var(--red)", border: "1px solid rgba(217,106,78,.28)" }}>
      BPM
    </span>
  );
}

// Per-track FX indicator tag (VRB / ECHO). Sits in a fixed slot next to VOL AUTO: the slot
// always occupies its space (visibility toggles, not mounting) so VRB/ECHO never shift position
// when the other is off. Shown only when the effect send amount is non-zero.
function FxTag({ label, color, on, onClick }) {
  return (
    <span title={on ? `믹서에서 ${label} 노브 열기` : undefined}
      onClick={on && onClick ? onClick : undefined}
      style={{ fontSize: 7.5, padding: "1px 2px", borderRadius: 3, fontWeight: 700, letterSpacing: 0,
        lineHeight: 1, whiteSpace: "nowrap", flex: "0 0 auto",
        background: `color-mix(in srgb, ${color} 18%, transparent)`, color,
        border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
        cursor: on && onClick ? "pointer" : "default",
        visibility: on ? "visible" : "hidden" }}
      onMouseEnter={on ? (e) => { e.currentTarget.style.background = `color-mix(in srgb, ${color} 34%, transparent)`; } : undefined}
      onMouseLeave={on ? (e) => { e.currentTarget.style.background = `color-mix(in srgb, ${color} 18%, transparent)`; } : undefined}>
      {label}
    </span>
  );
}

function TrackHeader({ track, idx, level, onParam, onRemove, laneH, onFocusFx }) {
  const p = track.params;
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const volRef = useRef(null);
  // wheel over the volume fader = 0.1 dB per notch (display is dB)
  useWheelStep(volRef, (dir) => onParam("volume", nudgeGainDb(p.volume, dir, 2, 0.1)));
  const compact = laneH <= 76;
  const medium = laneH <= 104 && !compact;
  const pad = compact ? "7px 10px" : medium ? "8px 11px" : "10px 12px";
  const gap = compact ? 5 : 6;
  const buttonSize = compact ? 22 : 24;
  const knobSize = compact ? 24 : 28;
  const meterH = compact ? 22 : medium ? 24 : 28;
  const bpmButtonStyle = {
    width: buttonSize,
    height: buttonSize,
    borderRadius: 5,
    display: "grid",
    placeItems: "center",
    fontSize: 10,
    fontWeight: 800,
    lineHeight: 1,
    cursor: "pointer",
    background: p.bpmSource ? "var(--amber)" : "var(--surface2)",
    color: p.bpmSource ? "var(--accent-fg)" : "var(--cream-2)",
    border: "1px solid " + (p.bpmSource ? "var(--amber)" : "var(--line-strong)"),
    boxShadow: p.bpmSource ? "0 0 10px rgba(232,176,75,.5)" : "none",
  };
  return (
    <React.Fragment>
    <div style={{ width: HEADER_W, flex: `0 0 ${HEADER_W}px`, position: "sticky", left: 0, zIndex: 6,
      background: p.solo
        ? "linear-gradient(rgba(232,176,75,.05),rgba(232,176,75,.05)), linear-gradient(180deg,var(--surface),var(--bg2))"
        : "linear-gradient(180deg,var(--surface),var(--bg2))", borderRight: "1px solid var(--line-strong)",
      borderBottom: "1px solid var(--line)", padding: pad, height: laneH, minHeight: laneH,
      overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: compact ? "space-between" : "flex-start", gap }}>
      <div style={{ display: "flex", alignItems: "center", gap: compact ? 6 : 8, minHeight: compact ? 22 : 24 }}>
        <div style={{ width: 4, alignSelf: "stretch", borderRadius: 3, background: track.color, boxShadow: `0 0 8px ${track.color}66` }} />
        <span className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>{String(idx + 1).padStart(2, "0")}</span>
        <ScrollingTrackTitle name={track.name} compact={compact} />
        <button title="Use this track for BPM detection" onClick={() => onParam("bpmSource", !p.bpmSource)} style={bpmButtonStyle}>B</button>
        <SoloBtn size={buttonSize} on={p.solo} onClick={() => onParam("solo", !p.solo)} />
        <MuteBtn size={buttonSize} on={p.mute} auto={DAW._anySolo() && !p.solo} onClick={() => onParam("mute", !p.mute)} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: compact ? 7 : 9, minWidth: 0, minHeight: compact ? 24 : 28 }}>
        {/* horizontal volume fader */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <Icon name="wave" size={compact ? 12 : 13} style={{ color: "var(--muted)", flex: "0 0 auto" }} />
          <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
            <input ref={volRef} type="range" min="0" max="2.0" step="0.005" value={p.volume}
              onChange={(e) => onParam("volume", +e.target.value)} style={{ width: "100%", display: "block" }} />
            {/* 0dB tick: value=1.0 is at 1.0/2.0 = 50.0% of slider */}
            <div style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", width: 1.5, height: 4, background: "var(--muted)", borderRadius: 1, pointerEvents: "none" }} />
          </div>
          {!compact && <span className="mono" style={{ fontSize: 9.5, color: "var(--cream-2)", width: 28, textAlign: "right", flex: "0 0 auto" }}>{fmtDb(p.volume)}</span>}
        </div>
        <Knob value={p.pan} min={-1} max={1} size={knobSize} color="var(--pan-arc, var(--cream-2))"
          onChange={(v) => onParam("pan", v)} />
        <Meter level={level} height={meterH} width={6} />
      </div>
      {!compact && <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: medium ? 20 : 22 }}>
        {/* VOL AUTO — rounded toggle (replaces the old icon button) */}
        <button title="Volume automation on/off" onClick={() => onParam("autoOn", !p.autoOn)}
          style={{ display: "flex", alignItems: "center", gap: 5, height: 22, padding: "0 9px", borderRadius: 6,
            fontSize: 10, fontWeight: 700, letterSpacing: ".04em", cursor: "pointer",
            whiteSpace: "nowrap", flex: "0 0 auto",
            background: p.autoOn ? "var(--amber-soft)" : "transparent",
            color: p.autoOn ? "var(--amber)" : "var(--muted)",
            border: "1px solid " + (p.autoOn ? "var(--amber-deep)" : "var(--line-strong)") }}>
          <Icon name="auto" size={13} /> AUTO
        </button>
        {/* fixed-position VRB / ECHO send indicators (colors match the mixer VRB/ECHO knobs).
            Grouped so the row spends one gap, not two, on this tight (244px) header. */}
        <div style={{ display: "flex", gap: 2, flex: "0 0 auto" }}>
          <FxTag label="VRB" color="var(--violet)" on={p.reverb > 0.001}
            onClick={onFocusFx ? () => onFocusFx(track.id, "reverb") : undefined} />
          <FxTag label="ECHO" color="var(--blue)" on={p.echo > 0.001}
            onClick={onFocusFx ? () => onFocusFx(track.id, "echo") : undefined} />
        </div>
        {DAW.tempo && DAW.tempo.variBpm && !p.mute && !(DAW._anySolo() && !p.solo) && <VariBpmTag />}
        <div style={{ flex: 1 }} />
        {track.needsAudio
          ? <span title="Drop the audio file here to re-link" style={{ fontSize: 9, padding: "2px 4px", borderRadius: 4,
              fontWeight: 400, letterSpacing: ".04em", background: "rgba(217,106,78,.18)",
              color: "var(--red)", border: "1px solid rgba(217,106,78,.28)" }}>NO AUDIO</span>
          : <span className="chip" style={{ fontSize: 9, padding: "2px 4px", fontWeight: 400 }}>{track.type}</span>
        }
        {onRemove && <button title="Remove track" onClick={() => setConfirmRemove(true)}
          style={{ width: 22, height: 22, borderRadius: 5, display: "grid", placeItems: "center",
            background: "var(--surface2)", color: "var(--cream-2)", border: "1px solid var(--line-strong)",
            fontSize: 14, fontWeight: 700, lineHeight: 1, cursor: "pointer", transition: ".12s" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--red)"; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "var(--red)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface2)"; e.currentTarget.style.color = "var(--cream-2)"; e.currentTarget.style.borderColor = "var(--line-strong)"; }}>−</button>}
      </div>}
      {/* L size only: Reset + Curve fitting controls under the VOL AUTO button */}
      {!compact && !medium && <div style={{ display: "flex", gap: 6, minHeight: 18 }}>
        <button title="Reset automation graph" onClick={() => setConfirmReset(true)}
          style={{ flex: 1, height: 20, borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            background: "transparent", color: "var(--muted)", border: "1px solid var(--line-strong)" }}>
          <Icon name="loop" size={12} /> Reset
        </button>
        <button title="Curve fitting on/off" onClick={() => onParam("autoCurve", !p.autoCurve)}
          style={{ flex: 1, height: 20, borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            background: p.autoCurve ? "var(--amber-soft)" : "transparent",
            color: p.autoCurve ? "var(--amber)" : "var(--muted)",
            border: "1px solid " + (p.autoCurve ? "var(--amber-deep)" : "var(--line-strong)") }}>
          <Icon name="auto" size={12} /> Curve
        </button>
      </div>}
    </div>
    {confirmReset && (
      <div style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(8,6,4,.6)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center" }}
        onMouseDown={() => setConfirmReset(false)}>
        <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 340, background: "var(--bg)", border: "1px solid var(--line-strong)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
            <Icon name="auto" size={17} style={{ color: "var(--amber)" }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>Automation 초기화</span>
          </div>
          <div style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 12.5, color: "var(--cream-2)", lineHeight: 1.6 }}>
              '{track.name}' 트랙의 편집된 볼륨 automation을 모두 초기화할까요? 되돌릴 수 없습니다.
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => setConfirmReset(false)}>취소</button>
              <button className="btn primary" style={{ flex: 1 }}
                onClick={() => { onParam("automation", [{ t: 0, v: 1 }, { t: 1, v: 1 }]); setConfirmReset(false); }}>초기화</button>
            </div>
          </div>
        </div>
      </div>
    )}
    {confirmRemove && (
      <div style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(8,6,4,.6)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center" }}
        onMouseDown={() => setConfirmRemove(false)}>
        <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 340, background: "var(--bg)", border: "1px solid var(--line-strong)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 22, height: 22, borderRadius: 5, display: "grid", placeItems: "center", background: "var(--red)", color: "#fff", fontSize: 14, fontWeight: 700, lineHeight: 1 }}>−</span>
            <span style={{ fontWeight: 600, fontSize: 14 }}>트랙 삭제</span>
          </div>
          <div style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 12.5, color: "var(--cream-2)", lineHeight: 1.6 }}>
              '{track.name}' 트랙을 삭제할까요? 되돌릴 수 없습니다.
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => setConfirmRemove(false)}>취소</button>
              <button className="btn primary" style={{ flex: 1 }}
                onClick={() => { setConfirmRemove(false); onRemove(); }}>삭제</button>
            </div>
          </div>
        </div>
      </div>
    )}
    </React.Fragment>
  );
}

/* ---------- one track row (header + lane) ---------- */
function TrackRow({ track, idx, pxPerSec, ampZoom, laneH, playhead, level, onParam, onRemove, onSeek, tool, onSplit, onJoin, onBeforeChange, onFocusFx }) {
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
      <TrackHeader track={track} idx={idx} level={level} onParam={onParam} onRemove={onRemove} laneH={laneH} onFocusFx={onFocusFx} />
      <div onMouseDown={laneClick} onMouseMove={laneMouseMove} onMouseLeave={() => setHoveredClipId(null)}
        style={{ position: "relative", width: laneW, height: laneH,
          background: idx % 2 ? "rgba(255,255,255,.012)" : "transparent",
          // isolate: make the lane its own stacking context so the absolutely-positioned playhead
          // (and any overlay) can never paint above the sibling sticky TrackHeader when it scrolls
          // left of the viewport (seek-back + time zoom-in). Header (zIndex 6) sits above the lane.
          isolation: "isolate",
          borderBottom: "1px solid var(--line)", overflow: "hidden", cursor: toolCursor }}>
        <TimeGrid pxPerSec={pxPerSec} height={laneH} />
        <Waveform track={track} clips={track.clips} pxPerSec={pxPerSec} ampZoom={ampZoom} height={laneH} volume={track.params.volume} />
        {p.autoOn && <AutomationOverlay track={track} pxPerSec={pxPerSec} height={laneH} onBeforeChange={onBeforeChange} />}
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
        <div style={{ position: "absolute", top: 0, bottom: 0, left: phx, width: 1.5, background: "var(--cream)", boxShadow: "0 0 6px rgba(239,230,212,.6)", pointerEvents: "none", zIndex: 10 }} />
      </div>
    </div>
  );
}

/* ---------- collapsible file-track group ---------- */
function FileTrackGroupHeader({ tracks, count, collapsed, onToggle, pxPerSec, playhead }) {
  const laneW = Math.max(1, DAW.duration * pxPerSec);
  const phx = (playhead / Math.max(0.001, DAW.duration)) * laneW;
  const label = collapsed ? "Expand file tracks" : "Collapse file tracks";
  const rowH = 38;

  return (
    <div style={{ display: "flex", minWidth: "min-content", height: rowH }}>
      <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-label={label} title={label}
        style={{ width: HEADER_W, flex: `0 0 ${HEADER_W}px`, position: "sticky", left: 0, zIndex: 7,
          height: rowH, padding: "0 12px", display: "flex", alignItems: "center", gap: 9,
          background: "color-mix(in srgb, var(--surface2) 88%, var(--amber) 12%)",
          color: "var(--cream-2)", border: 0, borderRight: "1px solid var(--line-strong)",
          borderBottom: "1px solid var(--line-strong)", cursor: "pointer", textAlign: "left" }}>
        <span aria-hidden="true" style={{ width: 18, height: 18, display: "grid", placeItems: "center",
          color: "var(--amber)", transition: "transform .16s ease",
          transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>
          <svg viewBox="0 0 20 20" width="15" height="15">
            <path d="M4 7l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 11, fontWeight: 750, letterSpacing: ".08em", textTransform: "uppercase" }}>
            File Tracks
          </span>
          <span style={{ fontSize: 9.5, color: "var(--muted)", fontWeight: 600 }}>
            {count} {count === 1 ? "track" : "tracks"}
          </span>
        </span>
        <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--dim)", letterSpacing: ".04em",
          textTransform: "uppercase" }}>
          {collapsed ? "Show" : "Hide"}
        </span>
      </button>
      <button type="button" onClick={onToggle} aria-label={label} tabIndex={-1}
        style={{ position: "relative", width: laneW, height: rowH, padding: "0 16px",
          display: "flex", alignItems: "center", gap: 9, overflow: "hidden",
          background: "color-mix(in srgb, var(--surface2) 94%, var(--amber) 6%)",
          color: "var(--muted)", border: 0, borderBottom: "1px solid var(--line-strong)",
          cursor: "pointer", textAlign: "left" }}>
        {collapsed && (
          <span aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            {(tracks || []).filter((track) => !(track.params && track.params.mute)).map((track) => (
              <span key={track.id} style={{ position: "absolute", inset: 0, opacity: .42 }}>
                <Waveform track={track} clips={track.clips} pxPerSec={pxPerSec}
                  ampZoom={1} height={rowH} volume={1} normalizeToPeak={true} />
              </span>
            ))}
          </span>
        )}
        <span style={{ width: 18, height: 14, borderRadius: "3px 3px 2px 2px",
          border: "1px solid var(--amber-deep)", background: "var(--amber-soft)",
          position: "relative", flex: "0 0 auto", zIndex: 2 }}>
          <span style={{ position: "absolute", left: 2, top: -4, width: 8, height: 4,
            borderRadius: "2px 2px 0 0", background: "var(--amber-deep)" }} />
        </span>
        <span style={{ position: "relative", zIndex: 2, fontSize: 10.5, fontWeight: 600,
          padding: "2px 6px", borderRadius: 5,
          background: collapsed ? "color-mix(in srgb, var(--bg2) 78%, transparent)" : "transparent",
          textShadow: collapsed ? "0 1px 3px var(--bg)" : "none" }}>
          {collapsed ? `${count} file ${count === 1 ? "track" : "tracks"} hidden` : "File-based tracks"}
        </span>
        <span style={{ position: "absolute", top: 0, bottom: 0, left: phx, width: 1.5,
          background: "var(--amber)", opacity: .8, pointerEvents: "none", zIndex: 3 }} />
      </button>
    </div>
  );
}

/* ---------- time grid lines ---------- */
function TimeGrid({ pxPerSec, height }) {
  const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
  const majorStep = steps.find((s) => s * pxPerSec >= 96) || steps[steps.length - 1];
  const minorStep = majorStep / 2;
  const lines = [];
  for (let i = 0; i * minorStep <= DAW.duration + 1e-6; i++) {
    const t = i * minorStep;
    const x = t * pxPerSec;
    const isMajor = i % 2 === 0;
    lines.push(<div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: x, width: 1,
      background: isMajor ? "rgba(232,212,170,.10)" : "rgba(232,212,170,.04)" }} />);
  }
  return <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>{lines}</div>;
}

/* ---------- ruler (time scale) ---------- */
function rulerLabel(t, step) {
  const m = Math.floor(t / 60), s = t % 60;
  if (step < 1) return `${m}:${String(Math.floor(s)).padStart(2, "0")}.${Math.round((s % 1) * 10)}`;
  return `${m}:${String(Math.floor(s)).padStart(2, "0")}`;
}
function Ruler({ pxPerSec, playhead, onSeek, onAddTrack }) {
  const laneW = Math.max(1, DAW.duration * pxPerSec);
  const STEPS = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
  const step = STEPS.find((s) => s * pxPerSec >= 76) || STEPS[STEPS.length - 1];
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
    // minWidth:min-content — without it this sticky flex shrinks to the viewport width (unlike
    // TrackRow/OutputTrack which set it), so the time-row flex item shrinks below laneW and its
    // background (var(--bg2)) cuts off mid-timeline while the absolutely-positioned ticks still
    // span the full width. Growing to content width keeps the ruler background full-length.
    <div style={{ display: "flex", minWidth: "min-content", position: "sticky", top: 0, zIndex: 8 }}>
      <div style={{ width: HEADER_W, flex: `0 0 ${HEADER_W}px`, position: "sticky", left: 0, zIndex: 9,
        background: "var(--bg2)", borderRight: "1px solid var(--line-strong)", borderBottom: "1px solid var(--line-strong)",
        height: 30, display: "flex", alignItems: "center", gap: 7, padding: "0 12px" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", color: "var(--muted)", textTransform: "uppercase" }}>Track</span>
        <button onClick={onAddTrack} title="Add track"
          style={{ width: 18, height: 18, display: "grid", placeItems: "center", borderRadius: 5, flex: "0 0 auto",
            background: "var(--surface2)", color: "var(--cream-2)", border: "1px solid var(--line-strong)", cursor: "pointer", padding: 0 }}>
          <Icon name="plus" size={12} />
        </button>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", color: "var(--muted)", textTransform: "uppercase" }}>Time</span>
          <span className="mono" style={{ fontSize: 9.5, color: "var(--faint)" }}>m:ss</span>
        </span>
      </div>
      <div onMouseDown={seek} style={{ position: "relative", width: laneW, height: 30, background: "var(--bg2)",
        // isolate: keep the playhead line/marker below the sticky ruler corner (see TrackRow lane).
        isolation: "isolate",
        borderBottom: "1px solid var(--line-strong)", cursor: "text" }}>
        {marks}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: phx, width: 1.5, background: "var(--amber)", zIndex: 10 }} />
        <div style={{ position: "absolute", top: 0, left: phx - 5, width: 10, height: 8, background: "var(--amber)", clipPath: "polygon(0 0,100% 0,50% 100%)", zIndex: 10 }} />
      </div>
    </div>
  );
}

Object.assign(window, { Waveform, AutomationOverlay, TrackHeader, TrackRow, FileTrackGroupHeader, Ruler, TimeGrid, HEADER_W });
