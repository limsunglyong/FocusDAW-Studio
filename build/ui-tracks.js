const HEADER_W = 274;
function choosePeaks(track, pxPerSec) {
  const bufDur = track.buffer ? track.buffer.duration : 0;
  if (!bufDur || !track.peaksCoarse) return track.peaks || [];
  const bucketsNeeded = pxPerSec * bufDur;
  if (bucketsNeeded <= 512) return track.peaksCoarse;
  if (bucketsNeeded <= 2048) return track.peaksMedium || track.peaks || [];
  return track.peaks || [];
}
function Waveform({ track, clips, pxPerSec, ampZoom, height, volume = 1, normalizeToPeak = false }) {
  const ref = useRef(null);
  const isVisibleRef = useRef(true);
  const scheduleRef = useRef(null);
  const laneW = Math.max(1, DAW.duration * pxPerSec);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
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
  }, []);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const scrollHost = cv.closest("[data-arrange-scroll]");
    const dpr = window.devicePixelRatio || 1;
    const peaks = choosePeaks(track, pxPerSec);
    const nb = peaks.length / 2;
    const bufDur = track.buffer ? track.buffer.duration : 0;
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
      const drawLiveRecording = () => {
        const livePeaks = track.recording && Array.isArray(track._recordingPeaks) ? track._recordingPeaks : null;
        if (!livePeaks || livePeaks.length < 3) return;
        const sr = track._recordingSampleRate || 44100;
        const recordingStart = track._recordingStart || 0;
        const pointCount = Math.floor(livePeaks.length / 3);
        const lastSample = livePeaks[(pointCount - 1) * 3] || 1;
        const totalSeconds = lastSample / sr;
        const visibleStartSeconds = Math.max(0, drawStart / pxPerSec - recordingStart);
        const visibleEndSeconds = Math.min(totalSeconds, (drawStart + drawW) / pxPerSec - recordingStart);
        const firstPoint = Math.max(0, Math.floor(visibleStartSeconds / Math.max(totalSeconds, 1e-3) * pointCount) - 2);
        const lastPoint = Math.min(pointCount, Math.ceil(visibleEndSeconds / Math.max(totalSeconds, 1e-3) * pointCount) + 2);
        const stride = Math.max(1, Math.floor((lastPoint - firstPoint) / Math.max(1, drawW * 1.5)));
        const mid2 = height / 2;
        c2d.strokeStyle = track.color;
        c2d.lineWidth = 1;
        c2d.globalAlpha = 0.9;
        c2d.beginPath();
        for (let i = firstPoint; i < lastPoint; i += stride) {
          const sample = livePeaks[i * 3];
          const min = livePeaks[i * 3 + 1] || 0;
          const max = livePeaks[i * 3 + 2] || 0;
          const x = (recordingStart + sample / sr) * pxPerSec - drawStart;
          c2d.moveTo(x, mid2 - max * mid2 * 0.92 * ampZoom);
          c2d.lineTo(x, mid2 - min * mid2 * 0.92 * ampZoom);
        }
        c2d.stroke();
        c2d.globalAlpha = 1;
        const endX = (recordingStart + totalSeconds) * pxPerSec - drawStart;
        c2d.fillStyle = "#df5b52";
        c2d.fillRect(endX, 0, 1.5, height);
      };
      if (!nb || !bufDur) {
        drawLiveRecording();
        return;
      }
      const mid = height / 2;
      let peakScale = volume * 0.92 * ampZoom;
      if (normalizeToPeak) {
        let maxPeak = Number.isFinite(track.peakAmp) ? track.peakAmp : 0;
        if (maxPeak <= 0) {
          for (let i = 0; i < peaks.length; i++) maxPeak = Math.max(maxPeak, Math.abs(peaks[i] || 0));
        }
        peakScale = maxPeak > 1e-6 ? 0.94 / maxPeak : 0;
      }
      clipArr.forEach((clip) => {
        const clipStartX = clip.start * pxPerSec;
        const clipEndX = clip.end * pxPerSec;
        const clipW = clipEndX - clipStartX;
        if (clipW <= 0 || clipEndX < drawStart || clipStartX > drawStart + drawW) return;
        const x0 = Math.max(0, Math.floor(clipStartX - drawStart));
        const x1 = Math.min(drawW, Math.ceil(clipEndX - drawStart));
        c2d.strokeStyle = "rgba(255,255,255,.05)";
        c2d.lineWidth = 1;
        c2d.beginPath();
        c2d.moveTo(x0, mid);
        c2d.lineTo(x1, mid);
        c2d.stroke();
        c2d.fillStyle = track.color + (track.recording ? "12" : "33");
        c2d.strokeStyle = track.color;
        c2d.lineWidth = 1;
        c2d.beginPath();
        for (let x = x0; x <= x1; x++) {
          const timelinePx = drawStart + x;
          const clipPx = timelinePx - clipStartX;
          const bufPos = clip.offset + clipPx / clipW * (clip.end - clip.start);
          const bIdx = Math.floor(bufPos / bufDur * nb);
          const max = peaks[Math.min(nb - 1, Math.max(0, bIdx)) * 2 + 1] || 0;
          c2d.lineTo(x, mid - max * mid * peakScale);
        }
        for (let x = x1; x >= x0; x--) {
          const timelinePx = drawStart + x;
          const clipPx = timelinePx - clipStartX;
          const bufPos = clip.offset + clipPx / clipW * (clip.end - clip.start);
          const bIdx = Math.floor(bufPos / bufDur * nb);
          const min = peaks[Math.min(nb - 1, Math.max(0, bIdx)) * 2] || 0;
          c2d.lineTo(x, mid - min * mid * peakScale);
        }
        c2d.closePath();
        c2d.fill();
        c2d.globalAlpha = track.recording ? 0.22 : 0.85;
        c2d.stroke();
        c2d.globalAlpha = 1;
        if (volume > 1) {
          c2d.fillStyle = "rgba(220,70,60,.70)";
          c2d.beginPath();
          for (let x = x0; x <= x1; x++) {
            const timelinePx = drawStart + x;
            const clipPx = timelinePx - clipStartX;
            const bufPos = clip.offset + clipPx / clipW * (clip.end - clip.start);
            const bIdx = Math.floor(bufPos / bufDur * nb);
            const maxPk = peaks[Math.min(nb - 1, Math.max(0, bIdx)) * 2 + 1] || 0;
            const minPk = peaks[Math.min(nb - 1, Math.max(0, bIdx)) * 2] || 0;
            if (maxPk * volume > 1 || Math.abs(minPk) * volume > 1) {
              const yTop = Math.max(0, mid - maxPk * mid * peakScale);
              const yBot = Math.min(height, mid - minPk * mid * peakScale);
              c2d.rect(x, yTop, 1, Math.max(1, yBot - yTop));
            }
          }
          c2d.fill();
        }
        c2d.strokeStyle = "rgba(232,212,170,.30)";
        c2d.lineWidth = 1.5;
        const leftEdge = clipStartX - drawStart;
        const rightEdge = clipEndX - drawStart;
        if (leftEdge >= 0 && leftEdge <= drawW) {
          c2d.beginPath();
          c2d.moveTo(leftEdge, 0);
          c2d.lineTo(leftEdge, height);
          c2d.stroke();
        }
        if (rightEdge >= 0 && rightEdge <= drawW) {
          c2d.beginPath();
          c2d.moveTo(rightEdge, 0);
          c2d.lineTo(rightEdge, height);
          c2d.stroke();
        }
      });
      drawLiveRecording();
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
  }, [
    pxPerSec,
    ampZoom,
    height,
    laneW,
    track,
    clips,
    track.audioRev,
    track.recording,
    track._recordingPeaks && track._recordingPeaks.length,
    volume,
    normalizeToPeak
  ]);
  return /* @__PURE__ */ React.createElement("canvas", { ref, style: { position: "absolute", top: 0, height, display: "block" } });
}
function AutomationOverlay({ track, pxPerSec, height, onBeforeChange }) {
  const laneW = Math.max(1, DAW.duration * pxPerSec);
  const auto = track.params.automation;
  const drag = useRef(null);
  const toXY = (p) => [p.t * laneW, (1 - p.v) * height];
  const update = (arr) => DAW.setTrackParam(track.id, "automation", arr);
  const onPtDown = (i) => (e) => {
    e.stopPropagation();
    e.preventDefault();
    onBeforeChange && onBeforeChange();
    drag.current = i;
    const move = (ev) => {
      const host = document.getElementById("auto-" + track.id);
      const r = host.getBoundingClientRect();
      let t = (ev.clientX - r.left) / laneW;
      let v = 1 - (ev.clientY - r.top) / height;
      v = Math.max(0, Math.min(1, v));
      const arr = auto.map((p) => ({ ...p }));
      if (i === 0) t = 0;
      else if (i === arr.length - 1) t = 1;
      else t = Math.max(arr[i - 1].t + 1e-3, Math.min(arr[i + 1].t - 1e-3, t));
      arr[i] = { t, v };
      update(arr);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      drag.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const onPtRemove = (i) => (e) => {
    e.preventDefault();
    e.stopPropagation();
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
  const pathD = auto.map((p, i) => {
    const [x, y] = toXY(p);
    return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
  }).join(" ");
  const appliedD = React.useMemo(() => {
    if (curveFit && DAW.monotoneCubicCurve && auto.length >= 2) {
      const N = Math.max(64, Math.min(512, Math.round(laneW / 3)));
      const c = DAW.monotoneCubicCurve(auto, N);
      let d = "";
      for (let i = 0; i < N; i++) {
        const x = i / (N - 1) * laneW;
        const y = (1 - c[i]) * height;
        d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      }
      return d;
    }
    return pathD;
  }, [auto, curveFit, laneW, height, pathD]);
  const areaD = appliedD + ` L${laneW} ${height} L0 ${height} Z`;
  return /* @__PURE__ */ React.createElement(
    "svg",
    {
      id: "auto-" + track.id,
      width: laneW,
      height,
      onMouseDown: onLineDown,
      style: { position: "absolute", inset: 0, cursor: "crosshair" }
    },
    /* @__PURE__ */ React.createElement("path", { d: areaD, fill: "rgba(232,176,75,.10)" }),
    curveFit && /* @__PURE__ */ React.createElement("path", { d: pathD, fill: "none", stroke: "var(--amber)", strokeWidth: "1.4", strokeLinejoin: "round", opacity: "0.35", strokeDasharray: "4 3" }),
    /* @__PURE__ */ React.createElement("path", { d: appliedD, fill: "none", stroke: "var(--amber)", strokeWidth: "2", strokeLinejoin: "round" }),
    auto.map((p, i) => {
      const [x, y] = toXY(p);
      return /* @__PURE__ */ React.createElement(
        "circle",
        {
          key: i,
          cx: x,
          cy: y,
          r: 5.5,
          fill: "var(--amber)",
          stroke: "#241a0a",
          strokeWidth: "1.5",
          style: { cursor: "grab" },
          onMouseDown: onPtDown(i),
          onContextMenu: onPtRemove(i)
        }
      );
    })
  );
}
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
        setMarquee((prev) => prev.distance === distance && prev.duration === duration ? prev : { distance, duration });
      } else {
        setMarquee((prev) => prev.distance === 0 && prev.duration === 6 ? prev : { distance: 0, duration: 6 });
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
  return /* @__PURE__ */ React.createElement(
    "span",
    {
      ref: wrapRef,
      className: "track-title-marquee" + (marquee.distance > 0 ? " is-overflowing" : ""),
      title: name,
      tabIndex: marquee.distance > 0 ? 0 : void 0,
      style: {
        fontWeight: 600,
        fontSize: compact ? 12.5 : 13.5,
        "--marquee-distance": marquee.distance + "px",
        "--marquee-duration": marquee.duration + "s"
      }
    },
    /* @__PURE__ */ React.createElement("span", { ref: textRef, className: "track-title-text" }, name)
  );
}
const VARI_BPM_BLINK_MS = 1600;
function VariBpmTag() {
  const delayRef = React.useRef(-(performance.now() % VARI_BPM_BLINK_MS / 1e3));
  return /* @__PURE__ */ React.createElement(
    "span",
    {
      className: "vari-bpm-tag",
      title: "Vari BPM active \u2014 playback tempo applied to this track",
      style: {
        fontSize: 9,
        padding: "2px 4px",
        borderRadius: 4,
        fontWeight: 400,
        letterSpacing: ".04em",
        textTransform: "uppercase",
        cursor: "default",
        animationDelay: delayRef.current + "s",
        background: "rgba(217,106,78,.18)",
        color: "var(--red)",
        border: "1px solid rgba(217,106,78,.28)"
      }
    },
    "BPM"
  );
}
function FxTag({ label, color, on, onClick }) {
  return /* @__PURE__ */ React.createElement(
    "span",
    {
      title: on ? `\uBBF9\uC11C\uC5D0\uC11C ${label} \uB178\uBE0C \uC5F4\uAE30` : void 0,
      onClick: on && onClick ? onClick : void 0,
      style: {
        fontSize: 7.5,
        padding: "1px 2px",
        borderRadius: 3,
        fontWeight: 700,
        letterSpacing: 0,
        lineHeight: 1,
        whiteSpace: "nowrap",
        flex: "0 0 auto",
        background: `color-mix(in srgb, ${color} 18%, transparent)`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
        cursor: on && onClick ? "pointer" : "default",
        visibility: on ? "visible" : "hidden"
      },
      onMouseEnter: on ? (e) => {
        e.currentTarget.style.background = `color-mix(in srgb, ${color} 34%, transparent)`;
      } : void 0,
      onMouseLeave: on ? (e) => {
        e.currentTarget.style.background = `color-mix(in srgb, ${color} 18%, transparent)`;
      } : void 0
    },
    label
  );
}
function TrackHeader({ track, idx, playbackLevel, inputLevel, onParam, onRemove, laneH, sizeLaneH = laneH, onFocusFx, selected = false, onSelect, indent = 0 }) {
  const p = track.params;
  const inputGainValue = Math.max(0.1, Math.min(4, p.inputGain == null ? 1 : p.inputGain));
  const inputGainTickLeft = (value) => `${(value - 0.1) / 3.9 * 100}%`;
  const armedInputLevel = p.arm ? Math.max(0, Math.min(1, inputLevel || 0)) : 0;
  const inputOverload = p.arm && armedInputLevel >= 0.92;
  const noAudio = !!track.needsAudio;
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const volRef = useRef(null);
  const inputGainRef = useRef(null);
  useWheelStep(volRef, (dir) => onParam("volume", nudgeGainDb(p.volume, dir, 2, 0.1)));
  useWheelStep(inputGainRef, (dir) => {
    const next = Math.max(0.1, Math.min(4, Math.round((inputGainValue + dir * 0.1) * 10) / 10));
    onParam("inputGain", next);
  });
  const effectiveSizeLaneH = sizeLaneH;
  const compact = effectiveSizeLaneH <= 76;
  const medium = effectiveSizeLaneH <= 104 && !compact;
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
    opacity: noAudio ? 0.38 : 1,
    cursor: noAudio ? "not-allowed" : "pointer"
  };
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
    "div",
    {
      onMouseDown: onSelect,
      style: {
        width: HEADER_W - indent,
        flex: `0 0 ${HEADER_W - indent}px`,
        marginLeft: indent,
        position: "sticky",
        left: indent,
        zIndex: 6,
        background: track.kind === "audioIn" ? "var(--audio-in-track-bg)" : selected ? "linear-gradient(180deg, color-mix(in srgb, var(--surface3) 84%, var(--amber) 16%), color-mix(in srgb, var(--bg2) 88%, var(--amber) 12%))" : p.solo ? "linear-gradient(rgba(232,176,75,.05),rgba(232,176,75,.05)), linear-gradient(180deg,var(--surface),var(--bg2))" : "linear-gradient(180deg,var(--surface),var(--bg2))",
        borderRight: "1px solid var(--line-strong)",
        borderBottom: "1px solid var(--line)",
        padding: pad,
        height: laneH,
        minHeight: laneH,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: compact ? "space-between" : "flex-start",
        gap,
        boxShadow: selected ? "inset 4px 0 0 var(--amber)" : "none"
      }
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: compact ? 6 : 8, minHeight: compact ? 22 : 24 } }, /* @__PURE__ */ React.createElement("div", { style: { width: 4, alignSelf: "stretch", borderRadius: 3, background: track.color, boxShadow: `0 0 8px ${track.color}66` } }), /* @__PURE__ */ React.createElement("span", { className: "mono", style: { fontSize: 10, color: "var(--faint)" } }, String(idx + 1).padStart(2, "0")), /* @__PURE__ */ React.createElement(ScrollingTrackTitle, { name: track.name, compact }), track.kind !== "audioIn" && /* @__PURE__ */ React.createElement("button", { title: noAudio ? "BPM source unavailable until audio is re-linked" : "Use this track for BPM detection", disabled: noAudio, onClick: noAudio ? void 0 : () => onParam("bpmSource", !p.bpmSource), style: bpmButtonStyle }, "B"), /* @__PURE__ */ React.createElement(SoloBtn, { size: buttonSize, on: p.solo, disabled: noAudio, onClick: () => onParam("solo", !p.solo) }), /* @__PURE__ */ React.createElement(MuteBtn, { size: buttonSize, on: p.mute, auto: DAW._anySolo() && !p.solo, disabled: noAudio, onClick: () => onParam("mute", !p.mute) })),
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: compact ? 7 : 9, minWidth: 0, minHeight: compact ? 24 : 28 } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "flex", alignItems: "center", gap: 6, minWidth: 0 } }, /* @__PURE__ */ React.createElement(Icon, { name: "wave", size: compact ? 12 : 13, style: { color: "var(--muted)", flex: "0 0 auto" } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, position: "relative", minWidth: 0 } }, /* @__PURE__ */ React.createElement(
      "input",
      {
        ref: volRef,
        type: "range",
        min: "0",
        max: "2.0",
        step: "0.005",
        value: p.volume,
        onChange: (e) => onParam("volume", +e.target.value),
        style: { width: "100%", display: "block" }
      }
    ), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", width: 1.5, height: 4, background: "var(--muted)", borderRadius: 1, pointerEvents: "none" } })), !compact && /* @__PURE__ */ React.createElement("span", { className: "mono", style: { fontSize: 9.5, color: "var(--cream-2)", width: 28, textAlign: "right", flex: "0 0 auto" } }, fmtDb(p.volume))), /* @__PURE__ */ React.createElement(
      Knob,
      {
        value: p.pan,
        min: -1,
        max: 1,
        size: knobSize,
        color: "var(--pan-arc, var(--cream-2))",
        onChange: (v) => onParam("pan", v)
      }
    ), /* @__PURE__ */ React.createElement(Meter, { level: playbackLevel, height: meterH, width: 6 })),
    !compact && track.kind === "audioIn" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "flex-start", gap: 3, minHeight: 31 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => onParam("arm", !p.arm), style: {
      height: 22,
      padding: "0 5px",
      borderRadius: 5,
      fontSize: 9,
      fontWeight: 750,
      background: p.arm ? "var(--red)" : "transparent",
      color: p.arm ? "#fff" : "var(--muted)",
      border: "1px solid " + (p.arm ? "var(--red)" : "var(--line-strong)")
    } }, "ARM"), /* @__PURE__ */ React.createElement("button", { onClick: () => onParam("monitor", !p.monitor), style: {
      height: 22,
      padding: "0 5px",
      borderRadius: 5,
      fontSize: 9,
      fontWeight: 700,
      background: p.monitor ? "var(--amber-soft)" : "transparent",
      color: p.monitor ? "var(--amber)" : "var(--muted)",
      border: "1px solid " + (p.monitor ? "var(--amber-deep)" : "var(--line-strong)")
    } }, "MON"), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => onParam("limiter", p.limiter === false),
        title: "Input limiter \xB7 ceiling -1.0 dBFS",
        style: {
          height: 22,
          padding: "0 4px",
          borderRadius: 5,
          fontSize: 8.5,
          fontWeight: 700,
          background: p.limiter !== false ? "var(--amber-soft)" : "transparent",
          color: p.limiter !== false ? "var(--amber)" : "var(--muted)",
          border: "1px solid " + (p.limiter !== false ? "var(--amber-deep)" : "var(--line-strong)")
        }
      },
      "LIM"
    ), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", display: "flex", alignItems: "flex-start", gap: 3 } }, /* @__PURE__ */ React.createElement(
      "span",
      {
        className: "mono",
        title: `Current input gain ${fmtDb(inputGainValue)} dB`,
        style: {
          width: 28,
          height: 16,
          display: "grid",
          placeItems: "center",
          borderRadius: 3,
          border: "1px solid var(--line-strong)",
          background: "var(--panel-deep, #171512)",
          color: "var(--cream-2)",
          fontSize: 7.5,
          fontVariantNumeric: "tabular-nums"
        }
      },
      fmtDb(inputGainValue)
    ), /* @__PURE__ */ React.createElement("span", { className: "mono", style: {
      fontSize: 8.5,
      color: inputOverload ? "var(--red)" : p.arm ? "#55c879" : "var(--dim)",
      textShadow: inputOverload ? "0 0 5px rgba(223,91,82,.75)" : p.arm ? "0 0 4px rgba(85,200,121,.45)" : "none"
    } }, "IN"), /* @__PURE__ */ React.createElement("span", { style: { position: "relative", width: 69, height: 31, display: "block" } }, /* @__PURE__ */ React.createElement("span", { style: { position: "absolute", left: 0, right: 0, top: 6, height: 4, borderRadius: 3, background: "#3a342c", overflow: "hidden" } }, /* @__PURE__ */ React.createElement("span", { style: { display: "block", width: `${armedInputLevel * 100}%`, height: "100%", overflow: "hidden" } }, /* @__PURE__ */ React.createElement("span", { style: {
      display: "block",
      width: 69,
      height: "100%",
      background: "linear-gradient(90deg,#55c879 0%,#55c879 64%,#e5c84b 74%,#e5c84b 84%,#df5b52 92%,#df5b52 100%)"
    } }))), /* @__PURE__ */ React.createElement(
      "input",
      {
        ref: inputGainRef,
        className: "input-level-slider",
        title: `Input gain ${fmtDb(inputGainValue)} dB \xB7 mouse wheel \xB10.1`,
        type: "range",
        min: "0.1",
        max: "4",
        step: "0.1",
        value: inputGainValue,
        onChange: (e) => onParam("inputGain", +e.target.value),
        style: { position: "absolute", left: 0, top: 0, width: 69, height: 16, margin: 0 }
      }
    ), /* @__PURE__ */ React.createElement("span", { "aria-hidden": "true", style: { position: "absolute", left: 0, right: 0, top: 16, height: 15, pointerEvents: "none" } }, [0.5, 1.5, 2.5, 3.5].map(
      (value) => /* @__PURE__ */ React.createElement("span", { key: value, style: {
        position: "absolute",
        left: inputGainTickLeft(value),
        top: 0,
        width: 1,
        height: 3,
        background: "var(--dim)",
        transform: "translateX(-50%)"
      } })
    ), [1, 2, 3, 4].map(
      (value) => /* @__PURE__ */ React.createElement(React.Fragment, { key: value }, /* @__PURE__ */ React.createElement("span", { style: {
        position: "absolute",
        left: inputGainTickLeft(value),
        top: 0,
        width: 1,
        height: 6,
        background: "var(--cream-2)",
        transform: "translateX(-50%)"
      } }), /* @__PURE__ */ React.createElement("span", { className: "mono", style: {
        position: "absolute",
        left: inputGainTickLeft(value),
        top: 6,
        color: "var(--dim)",
        fontSize: 6.5,
        lineHeight: 1,
        transform: "translateX(-50%)"
      } }, value))
    ))))),
    !compact && /* @__PURE__ */ React.createElement("div", { style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      minHeight: medium ? 20 : 22,
      marginTop: track.kind === "audioIn" && medium ? "auto" : 0
    } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        title: "Volume automation on/off",
        onClick: () => onParam("autoOn", !p.autoOn),
        style: {
          display: "flex",
          alignItems: "center",
          gap: 5,
          height: 22,
          padding: "0 9px",
          borderRadius: 6,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: ".04em",
          cursor: "pointer",
          whiteSpace: "nowrap",
          flex: "0 0 auto",
          background: p.autoOn ? "var(--amber-soft)" : "transparent",
          color: p.autoOn ? "var(--amber)" : "var(--muted)",
          border: "1px solid " + (p.autoOn ? "var(--amber-deep)" : "var(--line-strong)")
        }
      },
      /* @__PURE__ */ React.createElement(Icon, { name: "auto", size: 13 }),
      " AUTO"
    ), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 2, flex: "0 0 auto" } }, /* @__PURE__ */ React.createElement(
      FxTag,
      {
        label: "VRB",
        color: "var(--violet)",
        on: p.reverb > 1e-3,
        onClick: onFocusFx ? () => onFocusFx(track.id, "reverb") : void 0
      }
    ), /* @__PURE__ */ React.createElement(
      FxTag,
      {
        label: "ECHO",
        color: "var(--blue)",
        on: p.echo > 1e-3,
        onClick: onFocusFx ? () => onFocusFx(track.id, "echo") : void 0
      }
    )), DAW.tempo && DAW.tempo.variBpm && !p.mute && !(DAW._anySolo() && !p.solo) && /* @__PURE__ */ React.createElement(VariBpmTag, null), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }), track.needsAudio ? /* @__PURE__ */ React.createElement("span", { title: "Drop the audio file here to re-link", style: {
      fontSize: 9,
      padding: "2px 4px",
      borderRadius: 4,
      fontWeight: 400,
      letterSpacing: ".04em",
      background: "rgba(217,106,78,.18)",
      color: "var(--red)",
      border: "1px solid rgba(217,106,78,.28)"
    } }, "NO AUDIO") : /* @__PURE__ */ React.createElement("span", { className: "chip", style: { fontSize: 9, padding: "2px 4px", fontWeight: 400 } }, track.type), onRemove && /* @__PURE__ */ React.createElement(
      "button",
      {
        title: "Remove track",
        onClick: () => setConfirmRemove(true),
        style: {
          width: 22,
          height: 22,
          borderRadius: 5,
          display: "grid",
          placeItems: "center",
          background: "var(--surface2)",
          color: "var(--cream-2)",
          border: "1px solid var(--line-strong)",
          fontSize: 14,
          fontWeight: 700,
          lineHeight: 1,
          cursor: "pointer",
          transition: ".12s"
        },
        onMouseEnter: (e) => {
          e.currentTarget.style.background = "var(--red)";
          e.currentTarget.style.color = "#fff";
          e.currentTarget.style.borderColor = "var(--red)";
        },
        onMouseLeave: (e) => {
          e.currentTarget.style.background = "var(--surface2)";
          e.currentTarget.style.color = "var(--cream-2)";
          e.currentTarget.style.borderColor = "var(--line-strong)";
        }
      },
      "\u2212"
    )),
    !compact && !medium && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, minHeight: 18 } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        title: "Reset automation graph",
        onClick: () => setConfirmReset(true),
        style: {
          flex: 1,
          height: 20,
          borderRadius: 6,
          fontSize: 10,
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          background: "transparent",
          color: "var(--muted)",
          border: "1px solid var(--line-strong)"
        }
      },
      /* @__PURE__ */ React.createElement(Icon, { name: "loop", size: 12 }),
      " Reset"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        title: "Curve fitting on/off",
        onClick: () => onParam("autoCurve", !p.autoCurve),
        style: {
          flex: 1,
          height: 20,
          borderRadius: 6,
          fontSize: 10,
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          background: p.autoCurve ? "var(--amber-soft)" : "transparent",
          color: p.autoCurve ? "var(--amber)" : "var(--muted)",
          border: "1px solid " + (p.autoCurve ? "var(--amber-deep)" : "var(--line-strong)")
        }
      },
      /* @__PURE__ */ React.createElement(Icon, { name: "auto", size: 12 }),
      " Curve"
    ))
  ), confirmReset && /* @__PURE__ */ React.createElement(
    "div",
    {
      style: { position: "fixed", inset: 0, zIndex: 1200, background: "rgba(8,6,4,.6)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center" },
      onMouseDown: () => setConfirmReset(false)
    },
    /* @__PURE__ */ React.createElement("div", { onMouseDown: (e) => e.stopPropagation(), style: { width: 340, background: "var(--bg)", border: "1px solid var(--line-strong)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement(Icon, { name: "auto", size: 17, style: { color: "var(--amber)" } }), /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 600, fontSize: 14 } }, "Automation \uCD08\uAE30\uD654")), /* @__PURE__ */ React.createElement("div", { style: { padding: "18px 20px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: "var(--cream-2)", lineHeight: 1.6 } }, "'", track.name, "' \uD2B8\uB799\uC758 \uD3B8\uC9D1\uB41C \uBCFC\uB968 automation\uC744 \uBAA8\uB450 \uCD08\uAE30\uD654\uD560\uAE4C\uC694? \uB418\uB3CC\uB9B4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4."), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, marginTop: 18 } }, /* @__PURE__ */ React.createElement("button", { className: "btn", style: { flex: 1 }, onClick: () => setConfirmReset(false) }, "\uCDE8\uC18C"), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "btn primary",
        style: { flex: 1 },
        onClick: () => {
          onParam("automation", [{ t: 0, v: 1 }, { t: 1, v: 1 }]);
          setConfirmReset(false);
        }
      },
      "\uCD08\uAE30\uD654"
    ))))
  ), confirmRemove && /* @__PURE__ */ React.createElement(
    "div",
    {
      style: { position: "fixed", inset: 0, zIndex: 1200, background: "rgba(8,6,4,.6)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center" },
      onMouseDown: () => setConfirmRemove(false)
    },
    /* @__PURE__ */ React.createElement("div", { onMouseDown: (e) => e.stopPropagation(), style: { width: 340, background: "var(--bg)", border: "1px solid var(--line-strong)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 22, height: 22, borderRadius: 5, display: "grid", placeItems: "center", background: "var(--red)", color: "#fff", fontSize: 14, fontWeight: 700, lineHeight: 1 } }, "\u2212"), /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 600, fontSize: 14 } }, "\uD2B8\uB799 \uC0AD\uC81C")), /* @__PURE__ */ React.createElement("div", { style: { padding: "18px 20px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: "var(--cream-2)", lineHeight: 1.6 } }, "'", track.name, "' \uD2B8\uB799\uC744 \uC0AD\uC81C\uD560\uAE4C\uC694? \uB418\uB3CC\uB9B4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4."), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, marginTop: 18 } }, /* @__PURE__ */ React.createElement("button", { className: "btn", style: { flex: 1 }, onClick: () => setConfirmRemove(false) }, "\uCDE8\uC18C"), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "btn primary",
        style: { flex: 1 },
        onClick: () => {
          setConfirmRemove(false);
          onRemove();
        }
      },
      "\uC0AD\uC81C"
    ))))
  ));
}
function TrackRow({ track, idx, pxPerSec, ampZoom, laneH, sizeLaneH = laneH, playhead, playbackLevel, inputLevel = 0, onParam, onRemove, onSeek, tool, onSplit, onJoin, onBeforeChange, onFocusFx, selected = false, onSelect, headerIndent = 0 }) {
  const laneW = Math.max(1, DAW.duration * pxPerSec);
  const phx = playhead / DAW.duration * laneW;
  const p = track.params;
  const [hoveredClipId, setHoveredClipId] = useState(null);
  const laneMouseMove = (e) => {
    if (tool !== "scissors" && tool !== "join") {
      setHoveredClipId(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const sec = (e.clientX - r.left) / laneW * DAW.duration;
    const clip = track.clips && track.clips.find((c) => sec >= c.start && sec < c.end);
    setHoveredClipId(clip ? clip.id : null);
  };
  const laneClick = (e) => {
    if (e.target.closest("svg")) return;
    const r = e.currentTarget.getBoundingClientRect();
    const sec = (e.clientX - r.left) / laneW * DAW.duration;
    if (tool === "scissors") {
      const clip = track.clips && track.clips.find((c) => sec >= c.start && sec < c.end);
      if (clip) onSplit(track.id, clip.id, sec);
      return;
    }
    if (tool === "join") {
      if (!track.clips) return;
      const ci = track.clips.findIndex((c) => sec >= c.start && sec < c.end);
      if (ci >= 0 && ci < track.clips.length - 1)
        onJoin(track.id, track.clips[ci].id, track.clips[ci + 1].id);
      else if (ci > 0)
        onJoin(track.id, track.clips[ci - 1].id, track.clips[ci].id);
      return;
    }
    onSeek(sec);
  };
  const toolCursor = tool === "scissors" ? "crosshair" : tool === "join" ? "cell" : "text";
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", minWidth: "min-content" } }, /* @__PURE__ */ React.createElement(TrackHeader, { track, idx, playbackLevel, inputLevel, onParam, onRemove, laneH, sizeLaneH, onFocusFx, selected, onSelect, indent: headerIndent }), /* @__PURE__ */ React.createElement(
    "div",
    {
      onMouseDown: (e) => {
        if (onSelect) onSelect(e);
        if (!(e.ctrlKey || e.metaKey || e.shiftKey)) laneClick(e);
      },
      onMouseMove: laneMouseMove,
      onMouseLeave: () => setHoveredClipId(null),
      style: {
        position: "relative",
        width: laneW,
        height: laneH,
        background: track.kind === "audioIn" ? "linear-gradient(90deg,color-mix(in srgb,var(--blue) 8%,transparent),transparent 42%)" : selected ? "linear-gradient(90deg, rgba(232,176,75,.08), transparent 38%)" : idx % 2 ? "rgba(255,255,255,.012)" : "transparent",
        // isolate: make the lane its own stacking context so the absolutely-positioned playhead
        // (and any overlay) can never paint above the sibling sticky TrackHeader when it scrolls
        // left of the viewport (seek-back + time zoom-in). Header (zIndex 6) sits above the lane.
        isolation: "isolate",
        borderBottom: "1px solid var(--line)",
        overflow: "hidden",
        cursor: toolCursor
      }
    },
    /* @__PURE__ */ React.createElement(TimeGrid, { pxPerSec, height: laneH }),
    /* @__PURE__ */ React.createElement(Waveform, { track, clips: track.clips, pxPerSec, ampZoom, height: laneH, volume: track.params.volume }),
    p.autoOn && /* @__PURE__ */ React.createElement(AutomationOverlay, { track, pxPerSec, height: laneH, onBeforeChange }),
    hoveredClipId && tool === "scissors" && (() => {
      const clip = track.clips.find((c) => c.id === hoveredClipId);
      if (!clip) return null;
      return /* @__PURE__ */ React.createElement("div", { style: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: clip.start * pxPerSec,
        width: (clip.end - clip.start) * pxPerSec,
        background: "rgba(232,176,75,.07)",
        border: "1px solid rgba(232,176,75,.3)",
        pointerEvents: "none"
      } });
    })(),
    hoveredClipId && tool === "join" && (() => {
      const ci = track.clips ? track.clips.findIndex((c) => c.id === hoveredClipId) : -1;
      if (ci < 0 || !track.clips) return null;
      const clipA = track.clips[ci], clipB = track.clips[ci + 1] || track.clips[ci - 1];
      if (!clipA || !clipB) return null;
      const x1 = Math.min(clipA.start, clipB.start) * pxPerSec;
      const x2 = Math.max(clipA.end, clipB.end) * pxPerSec;
      return /* @__PURE__ */ React.createElement("div", { style: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: x1,
        width: x2 - x1,
        background: "rgba(159,191,122,.07)",
        border: "1px solid rgba(159,191,122,.3)",
        pointerEvents: "none"
      } });
    })(),
    /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: 0, bottom: 0, left: phx, width: 1.5, background: "var(--cream)", boxShadow: "0 0 6px rgba(239,230,212,.6)", pointerEvents: "none", zIndex: 10 } })
  ));
}
function FileTrackGroupHeader({ tracks, count, collapsed, onToggle, pxPerSec, playhead, stats, selectedCount = 0, onMergeSelected }) {
  const laneW = Math.max(1, DAW.duration * pxPerSec);
  const phx = playhead / Math.max(1e-3, DAW.duration) * laneW;
  const label = collapsed ? "Expand file tracks" : "Collapse file tracks";
  const rowH = 38;
  const mutedCount = stats && stats.mutedCount || 0;
  const soloCount = stats && stats.soloCount || 0;
  const audibleCount = stats && stats.audibleCount || 0;
  const groupLevel = stats && Number.isFinite(stats.level) ? stats.level : 0;
  const canMerge = selectedCount >= 2;
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", minWidth: "min-content", height: rowH } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: onToggle,
      "aria-expanded": !collapsed,
      "aria-label": label,
      title: label,
      style: {
        width: HEADER_W,
        flex: `0 0 ${HEADER_W}px`,
        position: "sticky",
        left: 0,
        zIndex: 7,
        height: rowH,
        padding: "0 12px",
        display: "flex",
        alignItems: "center",
        gap: 9,
        background: "color-mix(in srgb, var(--surface2) 88%, var(--amber) 12%)",
        color: "var(--cream-2)",
        border: 0,
        borderRight: "1px solid var(--line-strong)",
        borderBottom: "1px solid var(--line-strong)",
        cursor: "pointer",
        textAlign: "left"
      }
    },
    /* @__PURE__ */ React.createElement("span", { "aria-hidden": "true", style: {
      width: 18,
      height: 18,
      display: "grid",
      placeItems: "center",
      color: "var(--amber)",
      transition: "transform .16s ease",
      transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)"
    } }, /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 20 20", width: "15", height: "15" }, /* @__PURE__ */ React.createElement(
      "path",
      {
        d: "M4 7l6 6 6-6",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2",
        strokeLinecap: "round",
        strokeLinejoin: "round"
      }
    ))),
    /* @__PURE__ */ React.createElement("span", { style: { minWidth: 0, display: "flex", flexDirection: "column", gap: 1 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, fontWeight: 750, letterSpacing: ".08em", textTransform: "uppercase" } }, "File Tracks"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9.5, color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" } }, count, " trk \xB7 ", audibleCount, " active")),
    /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 } }, soloCount > 0 && /* @__PURE__ */ React.createElement(
      "span",
      {
        title: `${soloCount} soloed file track${soloCount === 1 ? "" : "s"}`,
        style: {
          minWidth: 18,
          height: 17,
          borderRadius: 4,
          display: "grid",
          placeItems: "center",
          background: "var(--amber)",
          color: "var(--accent-fg)",
          fontSize: 9,
          fontWeight: 800
        }
      },
      "S",
      soloCount > 1 ? soloCount : ""
    ), mutedCount > 0 && /* @__PURE__ */ React.createElement(
      "span",
      {
        title: `${mutedCount} muted file track${mutedCount === 1 ? "" : "s"}`,
        style: {
          minWidth: 18,
          height: 17,
          borderRadius: 4,
          display: "grid",
          placeItems: "center",
          background: "var(--red)",
          color: "#fff",
          fontSize: 9,
          fontWeight: 800
        }
      },
      "M",
      mutedCount > 1 ? mutedCount : ""
    ), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: "var(--dim)", letterSpacing: ".04em", textTransform: "uppercase" } }, collapsed ? "Show" : "Hide"))
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: onToggle,
      "aria-label": label,
      tabIndex: -1,
      style: {
        position: "relative",
        width: laneW,
        height: rowH,
        padding: "0 16px",
        display: "flex",
        alignItems: "center",
        gap: 9,
        overflow: "hidden",
        background: "color-mix(in srgb, var(--surface2) 94%, var(--amber) 6%)",
        color: "var(--muted)",
        border: 0,
        borderBottom: "1px solid var(--line-strong)",
        cursor: "pointer",
        textAlign: "left"
      }
    },
    collapsed && /* @__PURE__ */ React.createElement("span", { "aria-hidden": "true", style: { position: "absolute", inset: 0, pointerEvents: "none" } }, (tracks || []).filter((track) => !(track.params && track.params.mute)).map((track) => /* @__PURE__ */ React.createElement("span", { key: track.id, style: { position: "absolute", inset: 0, opacity: 0.42 } }, /* @__PURE__ */ React.createElement(
      Waveform,
      {
        track,
        clips: track.clips,
        pxPerSec,
        ampZoom: 1,
        height: rowH,
        volume: 1,
        normalizeToPeak: true
      }
    )))),
    /* @__PURE__ */ React.createElement("span", { style: {
      width: 18,
      height: 14,
      borderRadius: "3px 3px 2px 2px",
      border: "1px solid var(--amber-deep)",
      background: "var(--amber-soft)",
      position: "relative",
      flex: "0 0 auto",
      zIndex: 2
    } }, /* @__PURE__ */ React.createElement("span", { style: {
      position: "absolute",
      left: 2,
      top: -4,
      width: 8,
      height: 4,
      borderRadius: "2px 2px 0 0",
      background: "var(--amber-deep)"
    } })),
    /* @__PURE__ */ React.createElement("span", { style: {
      position: "relative",
      zIndex: 2,
      fontSize: 10.5,
      fontWeight: 600,
      padding: "2px 6px",
      borderRadius: 5,
      background: collapsed ? "color-mix(in srgb, var(--bg2) 78%, transparent)" : "transparent",
      textShadow: collapsed ? "0 1px 3px var(--bg)" : "none"
    } }, collapsed ? `${count} file ${count === 1 ? "track" : "tracks"} hidden` : "File-based tracks"),
    /* @__PURE__ */ React.createElement("span", { style: {
      position: "relative",
      zIndex: 2,
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontSize: 9.5,
      fontWeight: 650,
      color: "var(--cream-2)"
    } }, /* @__PURE__ */ React.createElement("span", { style: {
      width: 46,
      height: 6,
      borderRadius: 999,
      overflow: "hidden",
      background: "rgba(0,0,0,.32)",
      border: "1px solid var(--line)"
    } }, /* @__PURE__ */ React.createElement("span", { style: {
      display: "block",
      width: `${Math.max(0, Math.min(1, groupLevel)) * 100}%`,
      height: "100%",
      borderRadius: 999,
      background: "var(--green)",
      boxShadow: "0 0 5px var(--green)"
    } }))),
    /* @__PURE__ */ React.createElement(
      "span",
      {
        onClick: (e) => {
          e.stopPropagation();
          if (canMerge && onMergeSelected) onMergeSelected();
        },
        title: canMerge ? "Merge selected file tracks" : "Select two or more file tracks",
        "aria-disabled": !canMerge,
        style: {
          position: "relative",
          zIndex: 4,
          marginLeft: "auto",
          height: 22,
          padding: "0 9px",
          borderRadius: 6,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          fontSize: 9.5,
          fontWeight: 750,
          letterSpacing: ".04em",
          textTransform: "uppercase",
          background: canMerge ? "var(--amber-soft)" : "rgba(255,255,255,.035)",
          color: canMerge ? "var(--amber)" : "var(--dim)",
          border: "1px solid " + (canMerge ? "var(--amber-deep)" : "var(--line-strong)"),
          cursor: canMerge ? "pointer" : "default"
        }
      },
      selectedCount > 0 && /* @__PURE__ */ React.createElement("span", { className: "mono", style: { fontSize: 9, minWidth: 12, textAlign: "center" } }, selectedCount),
      /* @__PURE__ */ React.createElement(
        "svg",
        {
          viewBox: "0 0 16 16",
          width: "14",
          height: "14",
          "aria-hidden": "true",
          style: { flex: "0 0 auto", color: canMerge ? "var(--amber)" : "var(--dim)" }
        },
        /* @__PURE__ */ React.createElement("path", { d: "M3 1.8h6.4L13 5.4v8.8H3z", fill: "none", stroke: "currentColor", strokeWidth: "1.35", strokeLinejoin: "round" }),
        /* @__PURE__ */ React.createElement("path", { d: "M9.4 1.8v3.6H13", fill: "none", stroke: "currentColor", strokeWidth: "1.35", strokeLinejoin: "round" }),
        /* @__PURE__ */ React.createElement("path", { d: "M5.3 7.8h5.2M5.3 10.2h5.2", fill: "none", stroke: "currentColor", strokeWidth: "1.1", strokeLinecap: "round", opacity: ".72" })
      ),
      "Merge Tracks..."
    ),
    /* @__PURE__ */ React.createElement("span", { style: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: phx,
      width: 1.5,
      background: "var(--amber)",
      opacity: 0.8,
      pointerEvents: "none",
      zIndex: 3
    } })
  ));
}
function TimeGrid({ pxPerSec, height }) {
  const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
  const majorStep = steps.find((s) => s * pxPerSec >= 96) || steps[steps.length - 1];
  const minorStep = majorStep / 2;
  const lines = [];
  for (let i = 0; i * minorStep <= DAW.duration + 1e-6; i++) {
    const t = i * minorStep;
    const x = t * pxPerSec;
    const isMajor = i % 2 === 0;
    lines.push(/* @__PURE__ */ React.createElement("div", { key: i, style: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: x,
      width: 1,
      background: isMajor ? "rgba(232,212,170,.10)" : "rgba(232,212,170,.04)"
    } }));
  }
  return /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", inset: 0, pointerEvents: "none" } }, lines);
}
function rulerLabel(t, step) {
  const m = Math.floor(t / 60), s = t % 60;
  if (step < 1) return `${m}:${String(Math.floor(s)).padStart(2, "0")}.${Math.round(s % 1 * 10)}`;
  return `${m}:${String(Math.floor(s)).padStart(2, "0")}`;
}
function Ruler({ pxPerSec, playhead, onSeek, onAddTrack, onAddAudioIn }) {
  const laneW = Math.max(1, DAW.duration * pxPerSec);
  const STEPS = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
  const step = STEPS.find((s) => s * pxPerSec >= 76) || STEPS[STEPS.length - 1];
  const marks = [];
  for (let i = 0; i * step <= DAW.duration + 1e-6; i++) {
    const t = i * step;
    const x = t * pxPerSec;
    marks.push(
      /* @__PURE__ */ React.createElement("div", { key: i, style: { position: "absolute", left: x, top: 0, bottom: 0, display: "flex", alignItems: "flex-end", paddingBottom: 3 } }, /* @__PURE__ */ React.createElement("div", { style: { width: 1, background: "var(--line-strong)", position: "absolute", top: 10, bottom: 0 } }), /* @__PURE__ */ React.createElement("span", { className: "mono", style: { fontSize: 10, color: "var(--dim)", paddingLeft: 5 } }, rulerLabel(t, step)))
    );
    const hx = x + step / 2 * pxPerSec;
    if ((i + 0.5) * step <= DAW.duration + 1e-6)
      marks.push(/* @__PURE__ */ React.createElement("div", { key: i + "h", style: { position: "absolute", left: hx, top: 18, bottom: 0, width: 1, background: "rgba(232,212,170,.06)" } }));
  }
  const phx = playhead / DAW.duration * laneW;
  const seek = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek((e.clientX - r.left) / laneW * DAW.duration);
  };
  return (
    // minWidth:min-content — without it this sticky flex shrinks to the viewport width (unlike
    // TrackRow/OutputTrack which set it), so the time-row flex item shrinks below laneW and its
    // background (var(--bg2)) cuts off mid-timeline while the absolutely-positioned ticks still
    // span the full width. Growing to content width keeps the ruler background full-length.
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", minWidth: "min-content", position: "sticky", top: 0, zIndex: 8 } }, /* @__PURE__ */ React.createElement("div", { style: {
      width: HEADER_W,
      flex: `0 0 ${HEADER_W}px`,
      position: "sticky",
      left: 0,
      zIndex: 9,
      background: "var(--bg2)",
      borderRight: "1px solid var(--line-strong)",
      borderBottom: "1px solid var(--line-strong)",
      height: 30,
      display: "flex",
      alignItems: "center",
      gap: 7,
      padding: "0 12px"
    } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", color: "var(--muted)", textTransform: "uppercase" } }, "Track"), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: onAddTrack,
        title: "Add track",
        style: {
          width: 18,
          height: 18,
          display: "grid",
          placeItems: "center",
          borderRadius: 5,
          flex: "0 0 auto",
          background: "var(--surface2)",
          color: "var(--cream-2)",
          border: "1px solid var(--line-strong)",
          cursor: "pointer",
          padding: 0
        }
      },
      /* @__PURE__ */ React.createElement(Icon, { name: "plus", size: 12 })
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: onAddAudioIn,
        title: "Add Audio In track",
        style: {
          height: 18,
          padding: "0 6px",
          borderRadius: 5,
          flex: "0 0 auto",
          fontSize: 9,
          fontWeight: 700,
          background: "var(--surface2)",
          color: "var(--cream-2)",
          border: "1px solid var(--line-strong)",
          cursor: "pointer"
        }
      },
      "+ Audio In"
    ), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", color: "var(--muted)", textTransform: "uppercase" } }, "Time"), /* @__PURE__ */ React.createElement("span", { className: "mono", style: { fontSize: 9.5, color: "var(--faint)" } }, "m:ss"))), /* @__PURE__ */ React.createElement("div", { onMouseDown: seek, style: {
      position: "relative",
      width: laneW,
      height: 30,
      background: "var(--bg2)",
      // isolate: keep the playhead line/marker below the sticky ruler corner (see TrackRow lane).
      isolation: "isolate",
      borderBottom: "1px solid var(--line-strong)",
      cursor: "text"
    } }, marks, /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: 0, bottom: 0, left: phx, width: 1.5, background: "var(--amber)", zIndex: 10 } }), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: 0, left: phx - 5, width: 10, height: 8, background: "var(--amber)", clipPath: "polygon(0 0,100% 0,50% 100%)", zIndex: 10 } })))
  );
}
Object.assign(window, { Waveform, AutomationOverlay, TrackHeader, TrackRow, FileTrackGroupHeader, Ruler, TimeGrid, HEADER_W });

