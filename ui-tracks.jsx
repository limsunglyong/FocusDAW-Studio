/* ================= FocusDAW — track lanes, waveforms, automation ================= */
const HEADER_W = 274;

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
        const firstPoint = Math.max(0, Math.floor((visibleStartSeconds / Math.max(totalSeconds, .001)) * pointCount) - 2);
        const lastPoint = Math.min(pointCount, Math.ceil((visibleEndSeconds / Math.max(totalSeconds, .001)) * pointCount) + 2);
        const stride = Math.max(1, Math.floor((lastPoint - firstPoint) / Math.max(1, drawW * 1.5)));
        const mid = height / 2;
        c2d.strokeStyle = track.color;
        c2d.lineWidth = 1;
        c2d.globalAlpha = .9;
        c2d.beginPath();
        for (let i = firstPoint; i < lastPoint; i += stride) {
          // Aggregate min/max across the whole stride window. Skipping the
          // in-between points made recorded transients (claps) shrink each time
          // the growing take pushed stride past the next integer.
          const windowEnd = Math.min(lastPoint, i + stride);
          let min = 0, max = 0;
          for (let j = i; j < windowEnd; j++) {
            const pMin = livePeaks[j * 3 + 1] || 0;
            const pMax = livePeaks[j * 3 + 2] || 0;
            if (pMin < min) min = pMin;
            if (pMax > max) max = pMax;
          }
          const sample = livePeaks[i * 3];
          const x = (recordingStart + sample / sr) * pxPerSec - drawStart;
          c2d.moveTo(x, mid - max * mid * .92 * ampZoom);
          c2d.lineTo(x, mid - min * mid * .92 * ampZoom);
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
        peakScale = maxPeak > 0.000001 ? 0.94 / maxPeak : 0;
      }
      clipArr.forEach((clip) => {
        const clipStartX = clip.start * pxPerSec;
        const clipEndX = clip.end * pxPerSec;
        const clipW = clipEndX - clipStartX;
        if (clipW <= 0 || clipEndX < drawStart || clipStartX > drawStart + drawW) return;

        const x0 = Math.max(0, Math.floor(clipStartX - drawStart));
        // x1 MUST be an integer pixel column. drawW can be fractional (laneW =
        // duration×pxPerSec, or a fractional host width), and when it is the
        // smaller term here x1 becomes fractional. The bottom-envelope fill loop
        // below starts AT x1 and steps down by 1, so every colMin[x - x0] index
        // would be fractional → undefined → NaN → lineTo(x, NaN) is dropped and
        // the entire LOWER half of the waveform vanished at fit-to-view zooms
        // (~px/s 13). The top loop starts at the integer x0 so it was unaffected.
        const x1 = Math.min(Math.floor(drawW), Math.ceil(clipEndX - drawStart));

        // baseline
        c2d.strokeStyle = "rgba(255,255,255,.05)"; c2d.lineWidth = 1;
        c2d.beginPath(); c2d.moveTo(x0, mid); c2d.lineTo(x1, mid); c2d.stroke();

        // waveform body (volume-scaled)
        // During a new take, keep the previous recording as a quiet visual
        // reference and draw the live take on top after all stored clips.
        // Each pixel column aggregates min/max over EVERY peak bucket it covers.
        // Sampling a single bucket per pixel made short transients (claps) land
        // between the sampled buckets and appear/vanish as zoom moved the grid.
        const cols = x1 - x0 + 1;
        const colMin = new Float32Array(cols);
        const colMax = new Float32Array(cols);
        const bucketAt = (timelinePx) => {
          const clipPx = timelinePx - clipStartX;
          // Baked tracks (전략 B) store audio TIMELINE-indexed, so sample peaks by
          // timeline position; raw tracks are source-indexed, sample by clip.offset.
          const bufPos = track._layoutBaked
            ? (clip.start + (clipPx / clipW) * (clip.end - clip.start))
            : (clip.offset + (clipPx / clipW) * (clip.end - clip.start));
          return (bufPos / bufDur) * nb;
        };
        for (let x = x0; x <= x1; x++) {
          let b0 = Math.floor(bucketAt(drawStart + x));
          let b1 = Math.ceil(bucketAt(drawStart + x + 1));
          b0 = Math.min(nb - 1, Math.max(0, b0));
          b1 = Math.min(nb, Math.max(b0 + 1, b1));
          let mn = 0, mx = 0;
          for (let b = b0; b < b1; b++) {
            const bMin = peaks[b * 2] || 0;
            const bMax = peaks[b * 2 + 1] || 0;
            if (bMin < mn) mn = bMin;
            if (bMax > mx) mx = bMax;
          }
          colMin[x - x0] = mn;
          colMax[x - x0] = mx;
        }

        c2d.fillStyle = track.color + (track.recording ? "12" : "33");
        c2d.strokeStyle = track.color;
        c2d.lineWidth = 1;
        c2d.beginPath();
        for (let x = x0; x <= x1; x++) c2d.lineTo(x, mid - colMax[x - x0] * mid * peakScale);
        for (let x = x1; x >= x0; x--) c2d.lineTo(x, mid - colMin[x - x0] * mid * peakScale);
        c2d.closePath(); c2d.fill();
        c2d.globalAlpha = track.recording ? .22 : .85; c2d.stroke(); c2d.globalAlpha = 1;

        // clipping indicator: peak × volume > 1.0 (ampZoom 무관, 신호 레벨만 판정)
        if (volume > 1.0) {
          c2d.fillStyle = "rgba(220,70,60,.70)";
          c2d.beginPath();
          for (let x = x0; x <= x1; x++) {
            const maxPk = colMax[x - x0];
            const minPk = colMin[x - x0];
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
  }, [pxPerSec, ampZoom, height, laneW, track, clips, track.audioRev, track.recording,
      track._recordingPeaks && track._recordingPeaks.length, volume, normalizeToPeak]);
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
function ScrollingTrackTitle({ name, compact, onRename }) {
  const wrapRef = useRef(null);
  const textRef = useRef(null);
  const inputRef = useRef(null);
  const [marquee, setMarquee] = useState({ distance: 0, duration: 6 });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const startEdit = () => { if (!onRename) return; setDraft(name); setEditing(true); };
  const commitEdit = () => {
    setEditing(false);
    const v = (draft || "").trim();
    if (v && v !== name && onRename) onRename(v);
  };
  useEffect(() => {
    if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [editing]);

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
  }, [name, compact, editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitEdit}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
          else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
        }}
        style={{
          width: "100%", minWidth: 0, fontWeight: 600, fontSize: compact ? 12.5 : 13.5,
          color: "var(--cream)", background: "var(--bg)", border: "1px solid var(--amber)",
          borderRadius: 4, padding: "1px 5px", outline: "none",
        }} />
    );
  }

  return (
    <span
      ref={wrapRef}
      className={"track-title-marquee" + (marquee.distance > 0 ? " is-overflowing" : "")}
      title={onRename ? "Double-click to rename" : name}
      onDoubleClick={onRename ? (e) => { e.stopPropagation(); startEdit(); } : undefined}
      tabIndex={marquee.distance > 0 ? 0 : undefined}
      style={{
        fontWeight: 600,
        fontSize: compact ? 12.5 : 13.5,
        cursor: onRename ? "text" : undefined,
        "--marquee-distance": marquee.distance + "px",
        "--marquee-duration": marquee.duration + "s",
      }}>
      <span ref={textRef} className="track-title-text">{name}</span>
    </span>
  );
}

// Per-track FX indicator tag (VRB / ECHO). Sits in a fixed slot next to VOL AUTO: the slot
// always occupies its space (visibility toggles, not mounting) so VRB/ECHO never shift position
// when the other is off. Shown only when the effect send amount is non-zero.
function FxTag({ label, color, on, onClick, title }) {
  return (
    <span title={on ? (title != null ? title : `믹서에서 ${label} 노브 열기`) : undefined}
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

const TRACK_ARM_BUTTON_BG = "linear-gradient(180deg,color-mix(in srgb,var(--input-gain-arm-button, #e33a48) 78%,#fff 22%) 0%,var(--input-gain-arm-button, #e33a48) 52%,color-mix(in srgb,var(--input-gain-arm-button, #e33a48) 76%,#000 24%) 100%)";
const TRACK_ARM_BUTTON_SHADOW = "inset 0 1px 0 rgba(255,255,255,.36), inset 0 -2px 0 rgba(0,0,0,.28), 0 2px 4px rgba(0,0,0,.22), 0 0 8px color-mix(in srgb,var(--input-gain-arm-button, #e33a48) 38%,transparent)";
const TRACK_AUDIO_INPUT_PORT_OPTIONS = [
  { label: "Input 1", channel: 0, stereo: false },
  { label: "Input 2", channel: 1, stereo: false },
  { label: "Input 1-2", channel: 0, stereo: true },
];
// Build the per-track input-port list from the interface's real input channels
// (reported by the native engine). Each channel gets a mono port; consecutive
// channels also get a stereo pair. Falls back to the static list when the device
// hasn't been opened yet (no channel names known).
function buildInputPortOptions(channelNames) {
  const names = Array.isArray(channelNames) ? channelNames : [];
  const n = names.length;
  if (n < 1) return TRACK_AUDIO_INPUT_PORT_OPTIONS;
  // WASAPI reports generic per-channel names like "Input channel 1"; show a clean
  // "Input N" instead. A real device-provided name (e.g. ASIO "Analogue 1") is
  // kept as-is so multichannel/ASIO interfaces read meaningfully.
  const label = (i) => {
    const raw = names[i] && String(names[i]).trim();
    return raw && !/^input channel \d+$/i.test(raw) ? raw : `Input ${i + 1}`;
  };
  const isGeneric = (i) => /^Input \d+$/.test(label(i));
  const opts = [];
  for (let i = 0; i < n; i++) opts.push({ label: label(i), channel: i, stereo: false });
  for (let i = 0; i + 1 < n; i += 2) {
    const pair = isGeneric(i) && isGeneric(i + 1) ? `Input ${i + 1}-${i + 2}` : `${label(i)} + ${label(i + 1)}`;
    opts.push({ label: pair, channel: i, stereo: true });
  }
  return opts;
}
const INPUT_GAIN_SLIDER_WIDTH = 69;
const INPUT_GAIN_THUMB_SIZE = 13;
const INPUT_GAIN_MIN = 0.1;
const INPUT_GAIN_MAX = 4;

function inputGainTickLeft(value) {
  const norm = Math.max(0, Math.min(1, (value - INPUT_GAIN_MIN) / (INPUT_GAIN_MAX - INPUT_GAIN_MIN)));
  const pad = INPUT_GAIN_THUMB_SIZE / 2;
  return pad + norm * (INPUT_GAIN_SLIDER_WIDTH - INPUT_GAIN_THUMB_SIZE);
}

function TrackHeader({ track, idx, playbackLevel, inputLevel, inputGr = 0, recordingActive = false, onParam, onRemove, laneH, sizeLaneH = laneH, onFocusFx, selected = false, onSelect, indent = 0, onMuteAllFiles, onRename }) {
  const p = track.params;
  const inputGainValue = Math.max(0.1, Math.min(4, p.inputGain == null ? 1 : p.inputGain));
  const inputChannel = Math.max(0, Number.isFinite(+p.inputChannel) ? +p.inputChannel : 0);
  const inputStereo = !!p.inputStereo;
  const inputPortValue = `${inputStereo ? "stereo" : "mono"}:${inputChannel}`;
  const inputPortOptions = buildInputPortOptions(DAW.getInputChannelNames ? DAW.getInputChannelNames() : []);
  const commitInputPort = (value) => {
    const [mode, ch] = String(value || "mono:0").split(":");
    onParam("inputChannel", Math.max(0, Number(ch) || 0));
    onParam("inputStereo", mode === "stereo");
  };
  const armedInputLevel = p.arm ? Math.max(0, Math.min(1, inputLevel || 0)) : 0;
  const inputOverload = p.arm && armedInputLevel >= .92;
  // Limiter gain reduction (positive dB); meter fills 0..12 dB. Only meaningful
  // while armed with the limiter engaged.
  const armedInputGr = p.arm && p.limiter !== false ? Math.max(0, inputGr || 0) : 0;
  const inputGrFrac = Math.min(1, armedInputGr / 12);
  const noAudio = !!track.needsAudio;
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const volRef = useRef(null);
  const inputGainRef = useRef(null);
  // wheel over the volume fader = 0.1 dB per notch (display is dB)
  useWheelStep(volRef, (dir) => onParam("volume", nudgeGainDb(p.volume, dir, 2, 0.1)));
  useWheelStep(inputGainRef, (dir) => {
    const next = Math.max(0.1, Math.min(4, Math.round((inputGainValue + dir * 0.1) * 10) / 10));
    onParam("inputGain", next);
  });
  const effectiveSizeLaneH = sizeLaneH;
  const compact = effectiveSizeLaneH <= 76;
  const medium = effectiveSizeLaneH <= 104 && !compact;
  const audioInInlineControls = track.kind === "audioIn" && !compact;
  const pad = compact ? "7px 10px" : medium ? "8px 11px" : "10px 11px";
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
    opacity: noAudio ? .38 : 1,
    cursor: noAudio ? "not-allowed" : "pointer",
  };
  // ARM is locked while a take is recording or counting in — toggling it then
  // would disarm the running take or reroute the input mid-record. The main
  // window's param() handler enforces this authoritatively; here we just reflect
  // it (disabled + dimmed) so the button visibly can't be used.
  const armLocked = track.kind === "audioIn" && recordingActive;
  const compactArmButtonStyle = {
    height: buttonSize,
    minWidth: 34,
    padding: "0 5px",
    borderRadius: 5,
    display: "grid",
    placeItems: "center",
    fontSize: 8.5,
    fontWeight: 800,
    lineHeight: 1,
    cursor: armLocked ? "not-allowed" : "pointer",
    opacity: armLocked ? 0.45 : 1,
    background: p.arm ? TRACK_ARM_BUTTON_BG : "var(--surface2)",
    color: p.arm ? "var(--arm-on-fg, #0d0d0d)" : "var(--cream-2)",
    border: "1px solid " + (p.arm ? "color-mix(in srgb,var(--input-gain-arm-button, #e33a48) 68%,#000 32%)" : "var(--line-strong)"),
    boxShadow: p.arm ? TRACK_ARM_BUTTON_SHADOW : "none",
    transform: p.arm ? "translateY(1px)" : "none",
  };
  return (
    <React.Fragment>
    <div onMouseDown={onSelect}
      style={{ width: HEADER_W - indent, flex: `0 0 ${HEADER_W - indent}px`, marginLeft: indent, position: "sticky", left: indent, zIndex: 6,
      background: track.kind === "audioIn"
        ? "var(--audio-in-track-bg)"
        : selected
        ? "linear-gradient(180deg, color-mix(in srgb, var(--surface3) 84%, var(--amber) 16%), color-mix(in srgb, var(--bg2) 88%, var(--amber) 12%))"
        : p.solo
          ? "linear-gradient(rgba(232,176,75,.05),rgba(232,176,75,.05)), linear-gradient(180deg,var(--surface),var(--bg2))"
          : "linear-gradient(180deg,var(--surface),var(--bg2))", borderRight: "1px solid var(--line-strong)",
      borderBottom: "1px solid var(--line)", padding: pad, height: laneH, minHeight: laneH,
      overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: compact ? "space-between" : "flex-start", gap,
      boxShadow: selected ? "inset 4px 0 0 var(--amber)" : "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: compact ? 6 : 8, minHeight: compact ? 22 : 24 }}>
        <div style={{ width: 4, alignSelf: "stretch", borderRadius: 3, background: track.color, boxShadow: `0 0 8px ${track.color}66` }} />
        <span className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>{String(idx + 1).padStart(2, "0")}</span>
        <ScrollingTrackTitle name={track.name} compact={compact} onRename={onRename ? (newName) => onRename(track.id, newName) : undefined} />
        {track.kind !== "audioIn" && <button title={noAudio ? "BPM source unavailable until audio is re-linked" : "Use this track for BPM detection"} disabled={noAudio} onClick={noAudio ? undefined : () => onParam("bpmSource", !p.bpmSource)} style={bpmButtonStyle}>B</button>}
        {(compact || audioInInlineControls) && track.kind === "audioIn" && <button title={armLocked ? "Recording — ARM locked" : p.arm ? "Disarm Audio In track" : "Arm Audio In track"} disabled={armLocked} onClick={armLocked ? undefined : () => onParam("arm", !p.arm)} style={compactArmButtonStyle}>ARM</button>}
        <SoloBtn size={buttonSize} on={p.solo} disabled={noAudio} onClick={() => onParam("solo", !p.solo)} />
        <MuteBtn size={buttonSize} on={p.mute} auto={DAW._anySolo() && !p.solo} disabled={noAudio} onClick={(e) => {
          if (e && e.shiftKey && track.kind === "file" && onMuteAllFiles) onMuteAllFiles(!p.mute);
          else onParam("mute", !p.mute);
        }} />
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
        <Meter level={playbackLevel} height={meterH} width={6} />
      </div>
      {!compact && track.kind === "audioIn" && <div style={{ display: "flex", alignItems: "flex-start", gap: 6, minHeight: audioInInlineControls ? 25 : 48 }}>
        <span style={{ display: "grid", gap: 4, width: 86, flex: "0 0 86px" }}>
          <span style={{ display: "flex", gap: 3 }}>
            {!audioInInlineControls && <button title={armLocked ? "Recording — ARM locked" : p.arm ? "Disarm Audio In track" : "Arm Audio In track"} disabled={armLocked} onClick={armLocked ? undefined : () => onParam("arm", !p.arm)} style={{ height: 22, padding: "0 5px", borderRadius: 5, fontSize: 9, fontWeight: 750,
              cursor: armLocked ? "not-allowed" : "pointer", opacity: armLocked ? 0.45 : 1,
              background: p.arm ? TRACK_ARM_BUTTON_BG : "transparent", color: p.arm ? "var(--arm-on-fg, #0d0d0d)" : "var(--muted)",
              border: "1px solid " + (p.arm ? "color-mix(in srgb,var(--input-gain-arm-button, #e33a48) 68%,#000 32%)" : "var(--line-strong)"),
              boxShadow: p.arm ? TRACK_ARM_BUTTON_SHADOW : "inset 0 1px 0 rgba(255,255,255,.05)",
              transform: p.arm ? "translateY(1px)" : "none" }}>ARM</button>}
            {audioInInlineControls && <select className="audio-input-port-select" value={inputPortValue} title="Input port for this Audio In track"
              onChange={(e) => commitInputPort(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              style={{ width: 68, height: 22, borderRadius: 5, padding: "0 4px",
                background: "var(--audio-input-port-bg, var(--surface2))",
                color: "var(--audio-input-port-fg, var(--cream-2))", border: "1px solid var(--line-strong)",
                fontSize: 9, fontWeight: 650, outline: "none" }}>
              {inputPortOptions.map((opt) => (
                <option key={`${opt.stereo ? "stereo" : "mono"}:${opt.channel}`} value={`${opt.stereo ? "stereo" : "mono"}:${opt.channel}`}
                  style={{ background: "var(--bg)", color: "var(--cream)" }}>
                  {opt.label}
                </option>
              ))}
            </select>}
            <button onClick={() => onParam("monitor", !p.monitor)} style={{ height: 22, padding: "0 5px", borderRadius: 5, fontSize: 9, fontWeight: 700,
              background: p.monitor ? "var(--amber-soft)" : "transparent", color: p.monitor ? "var(--amber)" : "var(--muted)", border: "1px solid " + (p.monitor ? "var(--amber-deep)" : "var(--line-strong)") }}>MON</button>
            <button onClick={() => onParam("limiter", p.limiter === false)} title="Input limiter · ceiling -1.0 dBFS"
              style={{ height: 22, padding: "0 4px", borderRadius: 5, fontSize: 8.5, fontWeight: 700,
                background: p.limiter !== false ? "var(--amber-soft)" : "transparent", color: p.limiter !== false ? "var(--amber)" : "var(--muted)",
                border: "1px solid " + (p.limiter !== false ? "var(--amber-deep)" : "var(--line-strong)") }}>LIM</button>
          </span>
          {!audioInInlineControls && <select className="audio-input-port-select" value={inputPortValue} title="Input port for this Audio In track"
            onChange={(e) => commitInputPort(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ width: "100%", height: 20, borderRadius: 5, padding: "0 5px",
              background: "var(--audio-input-port-bg, var(--surface2))",
              color: "var(--audio-input-port-fg, var(--cream-2))", border: "1px solid var(--line-strong)",
              fontSize: 9.5, fontWeight: 650, outline: "none" }}>
            {inputPortOptions.map((opt) => (
              <option key={`${opt.stereo ? "stereo" : "mono"}:${opt.channel}`} value={`${opt.stereo ? "stereo" : "mono"}:${opt.channel}`}
                style={{ background: "var(--bg)", color: "var(--cream)" }}>
                {opt.label}
              </option>
            ))}
          </select>}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "flex-start", gap: 3 }}>
          <span className="mono" title={`Current input gain ${fmtDb(inputGainValue)} dB`}
            style={{ width: 28, height: 16, display: "grid", placeItems: "center", borderRadius: 3,
              border: "1px solid var(--line-strong)", background: "var(--panel-deep, #171512)",
              color: "var(--cream-2)", fontSize: 7.5, fontVariantNumeric: "tabular-nums" }}>
            {fmtDb(inputGainValue)}
          </span>
          <span className="mono" style={{ fontSize: 8.5,
            color: inputOverload ? "var(--red)" : p.arm ? "#55c879" : "var(--dim)",
            textShadow: inputOverload ? "0 0 5px rgba(223,91,82,.75)"
              : p.arm ? "0 0 4px rgba(85,200,121,.45)" : "none" }}>IN</span>
          <span style={{ position: "relative", width: INPUT_GAIN_SLIDER_WIDTH, height: 25, display: "block" }}>
            <span style={{ position: "absolute", left: 0, right: 0, top: 6, height: 4, borderRadius: 3, background: "#3a342c", overflow: "hidden" }}>
              <span style={{ display: "block", width: `${armedInputLevel * 100}%`, height: "100%", overflow: "hidden" }}>
                <span style={{ display: "block", width: INPUT_GAIN_SLIDER_WIDTH, height: "100%",
                  background: "linear-gradient(90deg,#55c879 0%,#55c879 64%,#e5c84b 74%,#e5c84b 84%,#df5b52 92%,#df5b52 100%)" }} />
              </span>
            </span>
            {/* Limiter gain-reduction meter: fills from the right as the limiter clamps (0..12 dB). */}
            <span title={`Limiter gain reduction ${armedInputGr.toFixed(1)} dB`}
              style={{ position: "absolute", left: 0, right: 0, top: 11.5, height: 2.5, borderRadius: 2, background: "#2a2620", overflow: "hidden", pointerEvents: "none" }}>
              <span style={{ position: "absolute", right: 0, top: 0, height: "100%", width: `${inputGrFrac * 100}%`,
                background: "linear-gradient(270deg,#df5b52 0%,#e5a13b 100%)", borderRadius: 2 }} />
            </span>
            <input ref={inputGainRef} className="input-level-slider" title={`Input gain ${fmtDb(inputGainValue)} dB · mouse wheel ±0.1`} type="range" min="0.1" max="4" step="0.1"
              value={inputGainValue} onChange={(e) => onParam("inputGain", +e.target.value)}
              style={{ position: "absolute", left: 0, top: 0, width: INPUT_GAIN_SLIDER_WIDTH, height: 16, margin: 0 }} />
            <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 16, height: 8, pointerEvents: "none" }}>
              {[0.5, 1.5, 2.5, 3.5].map((value) =>
                <span key={value} style={{ position: "absolute", left: inputGainTickLeft(value), top: 0, width: 1, height: 3,
                  background: "var(--dim)", transform: "translateX(-50%)" }} />
              )}
              {[1, 2, 3, 4].map((value) =>
                <span key={value} style={{ position: "absolute", left: inputGainTickLeft(value), top: 0, width: 1, height: 6,
                  background: "var(--cream-2)", transform: "translateX(-50%)" }} />
              )}
            </span>
          </span>
        </span>
      </div>}
      {!compact && <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: medium ? 20 : 22,
        marginTop: 0 }}>
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
        {/* fixed-position VRB / ECHO / BPM indicators (colors match the mixer VRB/ECHO knobs).
            Grouped so the row spends one gap, not two, on this tight (244px) header.
            BPM lights up (no animation) when Vari BPM playback tempo applies to this track. */}
        <div style={{ display: "flex", gap: 2, flex: "0 0 auto" }}>
          <FxTag label="VRB" color="var(--violet)" on={p.reverb > 0.001}
            onClick={onFocusFx ? () => onFocusFx(track.id, "reverb") : undefined} />
          <FxTag label="ECHO" color="var(--blue)" on={p.echo > 0.001}
            onClick={onFocusFx ? () => onFocusFx(track.id, "echo") : undefined} />
          <FxTag label="BPM" color="var(--red)"
            on={!!(DAW.tempo && DAW.tempo.variBpm && !p.mute && !(DAW._anySolo() && !p.solo))}
            title="Vari BPM active — playback tempo applied to this track" />
        </div>
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
// Right-click menu for a clip: the edit actions with their keyboard shortcuts.
// Positioned at the cursor and clamped so it never spills out of the window.
//
// PORTALED TO document.body ON PURPOSE. Rendered inside the track lane it was
// trapped in the lane's stacking context: later siblings (the OUTPUT FX lane)
// painted OVER it, so the playhead line showed through the menu and — worse —
// the menu rows overlapping that lane were covered, making Duplicate/Delete
// unclickable while Copy (higher up, still inside its own lane) worked. The
// portal also stops menu clicks from bubbling into the lane's onClick, which
// was firing a seek and moving the playhead out from under "Paste at playhead".
function ClipContextMenu({ x, y, items, hint, onClose }) {
  const W = 232;
  const H = items.length * 32 + (hint ? 44 : 12);
  const left = Math.max(8, Math.min(x, window.innerWidth - W - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - H - 8));
  useEffect(() => {
    const close = (e) => { if (!e.target.closest("[data-clip-menu]")) onClose(); };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", onKey, true); };
  }, [onClose]);
  return ReactDOM.createPortal(
    // stopPropagation is REQUIRED even though this is portaled: React propagates
    // events through the REACT tree, not the DOM tree, so a press here would still
    // reach the lane's onMouseDown — which seeks — and yank the playhead to wherever
    // the menu row happens to sit, right before "Paste at playhead" reads it.
    <div data-clip-menu="1" onContextMenu={(e) => e.preventDefault()}
      onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
      style={{ position: "fixed", left, top, width: W, background: "var(--surface)", border: "1px solid var(--line-strong)",
        borderRadius: 10, boxShadow: "var(--shadow)", padding: 6, zIndex: 4000 }}>
      {items.map((it, i) => it.sep ? (
        <div key={i} style={{ height: 1, background: "var(--line)", margin: "5px 6px" }} />
      ) : (
        <div key={i} onClick={() => { if (it.disabled) return; onClose(); it.onClick && it.onClick(); }}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 7,
            cursor: it.disabled ? "default" : "pointer", fontSize: 12.5, opacity: it.disabled ? 0.38 : 1 }}
          onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = "var(--surface3)"; }}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
          {it.icon && <Icon name={it.icon} size={15} style={{ color: "var(--amber)", flex: "0 0 auto" }} />}
          <span style={{ flex: 1 }}>{it.label}</span>
          {it.hint && <span className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>{it.hint}</span>}
        </div>
      ))}
      {hint && <React.Fragment>
        <div style={{ height: 1, background: "var(--line)", margin: "5px 6px" }} />
        <div style={{ padding: "2px 10px 4px", fontSize: 10.5, color: "var(--faint)", lineHeight: 1.5, whiteSpace: "pre-line" }}>{hint}</div>
      </React.Fragment>}
    </div>,
    document.body
  );
}

function TrackRow({ track, idx, pxPerSec, ampZoom, laneH, sizeLaneH = laneH, playhead, playbackLevel, inputLevel = 0, inputGr = 0, recordingActive = false, onParam, onRemove, onSeek, tool, onSplit, onJoin, onBeforeChange, onFocusFx, selected = false, onSelect, headerIndent = 0, onMuteAllFiles, onRename, selectedClipId = null, onSelectClip, onMoveClip, onTrimStart, onTrimEnd, onDeleteClip, onCopyClip, onPasteClip, onDuplicateClip }) {
  const laneW = Math.max(1, DAW.duration * pxPerSec);
  const phx = (playhead / DAW.duration) * laneW;
  const p = track.params;
  const [hoveredClipId, setHoveredClipId] = useState(null);

  // Phase 5 (전략 B): clip move/trim on Audio In / Bounce tracks. During a drag we
  // only move a visual "ghost" and commit the engine edit (which re-bakes t.buffer)
  // once on mouse-up, so the buffer isn't re-baked on every mousemove.
  const clipEditable = !track.lockedToZero && (track.kind === "audioIn" || track.kind === "bounce");
  const clipDrag = useRef(null);
  const [, bumpDrag] = useState(0);
  // clipId null = the menu was opened over empty lane space (paste target only).
  const [clipMenu, setClipMenu] = useState(null); // { clipId, x, y }
  const closeClipMenu = useCallback(() => setClipMenu(null), []);
  const openClipMenu = (e, clip) => {
    if (!clipEditable) return;
    e.preventDefault(); e.stopPropagation();
    if (clip && onSelectClip) onSelectClip(track.id, clip.id);
    setClipMenu({ clipId: clip ? clip.id : null, x: e.clientX, y: e.clientY });
  };
  // Right-click on empty lane space: offer Paste so a copied clip can be dropped
  // where there is no clip to right-click on.
  const openLaneMenu = (e) => {
    if (!clipEditable || tool !== "select" || p.autoOn) return;
    if (e.target.closest("[data-clip-hit]")) return; // the clip's own handler owns this
    openClipMenu(e, null);
  };
  const clipMenuItems = (clip) => clip ? [
    { label: "Copy", hint: "Ctrl+C", onClick: () => onCopyClip && onCopyClip(track.id, clip.id) },
    { label: "Paste at playhead", hint: "Ctrl+V", disabled: !DAW._clipboard,
      onClick: () => onPasteClip && onPasteClip(track.id, DAW.getPlayhead()) },
    { label: "Duplicate", hint: "Ctrl+D", onClick: () => onDuplicateClip && onDuplicateClip(track.id, clip.id) },
    { sep: true },
    { label: "Delete", hint: "Del", icon: "trash", onClick: () => onDeleteClip && onDeleteClip(track.id, clip.id) },
  ] : [
    { label: "Paste at playhead", hint: "Ctrl+V", disabled: !DAW._clipboard,
      onClick: () => onPasteClip && onPasteClip(track.id, DAW.getPlayhead()) },
  ];
  const startClipDrag = (e, clip, mode) => {
    if (!clipEditable) return;
    if (e.button !== 0) return; // right/middle press must not start a drag — only the context menu
    e.stopPropagation(); e.preventDefault();
    const startX = e.clientX;
    const d = { clipId: clip.id, mode, startX, moved: false,
      origStart: clip.start, origEnd: clip.end,
      ghostStart: clip.start, ghostEnd: clip.end };
    clipDrag.current = d; bumpDrag((n) => n + 1);
    if (onSelectClip) onSelectClip(track.id, clip.id);
    const move = (ev) => {
      const dsec = ((ev.clientX - startX) / laneW) * DAW.duration;
      if (Math.abs(ev.clientX - startX) > 2) d.moved = true;
      const len = d.origEnd - d.origStart;
      if (mode === "move") { const ns = Math.max(0, d.origStart + dsec); d.ghostStart = ns; d.ghostEnd = ns + len; }
      else if (mode === "trimStart") { d.ghostStart = Math.min(Math.max(0, d.origStart + dsec), d.origEnd - 0.02); }
      else if (mode === "trimEnd") { d.ghostEnd = Math.max(d.origStart + 0.02, d.origEnd + dsec); }
      bumpDrag((n) => n + 1);
    };
    const up = () => {
      window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
      const dd = clipDrag.current; clipDrag.current = null; bumpDrag((n) => n + 1);
      if (!dd || !dd.moved) return; // pure click = select only (already done above)
      if (mode === "move" && Math.abs(dd.ghostStart - dd.origStart) > 1e-3 && onMoveClip) onMoveClip(track.id, clip.id, dd.ghostStart);
      else if (mode === "trimStart" && Math.abs(dd.ghostStart - dd.origStart) > 1e-3 && onTrimStart) onTrimStart(track.id, clip.id, dd.ghostStart);
      else if (mode === "trimEnd" && Math.abs(dd.ghostEnd - dd.origEnd) > 1e-3 && onTrimEnd) onTrimEnd(track.id, clip.id, dd.ghostEnd);
    };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };

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
      <TrackHeader track={track} idx={idx} playbackLevel={playbackLevel} inputLevel={inputLevel} inputGr={inputGr} recordingActive={recordingActive} onParam={onParam} onRemove={onRemove} laneH={laneH} sizeLaneH={sizeLaneH} onFocusFx={onFocusFx} selected={selected} onSelect={onSelect} indent={headerIndent} onMuteAllFiles={onMuteAllFiles} onRename={onRename} />
      <div onMouseDown={(e) => { if (e.button !== 0) return; if (onSelect) onSelect(e); if (!(e.ctrlKey || e.metaKey || e.shiftKey)) laneClick(e); }}
        onContextMenu={openLaneMenu} onMouseMove={laneMouseMove} onMouseLeave={() => setHoveredClipId(null)}
        style={{ position: "relative", width: laneW, height: laneH,
          background: track.kind === "audioIn"
            ? "linear-gradient(90deg,color-mix(in srgb,var(--blue) 8%,transparent),transparent 42%)"
            : selected
            ? "linear-gradient(90deg, rgba(232,176,75,.08), transparent 38%)"
            : idx % 2 ? "rgba(255,255,255,.012)" : "transparent",
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
        {/* Phase 5 clip-editing overlay: draggable clip bodies + trim handles.
            Only on editable (Audio In / Bounce) tracks, in select mode, when not
            editing automation. Clip rects cover only clip ranges, so lane gaps
            remain click-to-seek. */}
        {clipEditable && tool === "select" && !p.autoOn && (track.clips || []).map((clip) => {
          const dr = clipDrag.current && clipDrag.current.clipId === clip.id ? clipDrag.current : null;
          const s = dr ? dr.ghostStart : clip.start;
          const en = dr ? dr.ghostEnd : clip.end;
          const left = s * pxPerSec;
          const width = Math.max(2, (en - s) * pxPerSec);
          const sel = selectedClipId === clip.id;
          if ((clip.end - clip.start) <= 0) return null; // skip empty placeholder clip
          return (
            <div key={clip.id} title="Drag to move · drag edges to trim · right-click for actions"
              data-clip-hit="1"
              onMouseDown={(e) => startClipDrag(e, clip, "move")}
              onContextMenu={(e) => openClipMenu(e, clip)}
              style={{ position: "absolute", top: 2, bottom: 2, left, width,
                boxSizing: "border-box", borderRadius: 4, cursor: "grab", zIndex: 6,
                border: sel ? "1.5px solid var(--amber)" : "1px solid rgba(255,255,255,.16)",
                background: dr ? "rgba(232,176,75,.14)" : sel ? "rgba(232,176,75,.06)" : "transparent",
                boxShadow: sel ? "0 0 0 1px rgba(232,176,75,.25) inset" : "none" }}>
              <div onMouseDown={(e) => startClipDrag(e, clip, "trimStart")}
                style={{ position: "absolute", left: -1, top: 0, bottom: 0, width: 8, cursor: "ew-resize",
                  borderLeft: sel ? "2px solid var(--amber)" : "2px solid transparent" }} />
              <div onMouseDown={(e) => startClipDrag(e, clip, "trimEnd")}
                style={{ position: "absolute", right: -1, top: 0, bottom: 0, width: 8, cursor: "ew-resize",
                  borderRight: sel ? "2px solid var(--amber)" : "2px solid transparent" }} />
            </div>
          );
        })}
        {clipMenu && (() => {
          const clip = clipMenu.clipId ? (track.clips || []).find((c) => c.id === clipMenu.clipId) : null;
          if (clipMenu.clipId && !clip) return null; // clip vanished (deleted/undo) — drop the menu
          return <ClipContextMenu x={clipMenu.x} y={clipMenu.y} items={clipMenuItems(clip)}
            hint={clip ? "Drag to move · drag edges to trim\nEsc or click away to deselect" : null}
            onClose={closeClipMenu} />;
        })()}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: phx, width: 1.5, background: "var(--cream)", boxShadow: "0 0 6px rgba(239,230,212,.6)", pointerEvents: "none", zIndex: 10 }} />
      </div>
    </div>
  );
}

/* ---------- collapsible file-track group ---------- */
function FileTrackGroupHeader({ tracks, count, collapsed, onToggle, pxPerSec, playhead, stats, selectedCount = 0, onMergeSelected }) {
  const laneW = Math.max(1, DAW.duration * pxPerSec);
  const phx = (playhead / Math.max(0.001, DAW.duration)) * laneW;
  const label = collapsed ? "Expand file tracks" : "Collapse file tracks";
  const rowH = 38;
  const mutedCount = stats && stats.mutedCount || 0;
  const soloCount = stats && stats.soloCount || 0;
  const audibleCount = stats && stats.audibleCount || 0;
  const groupLevel = stats && Number.isFinite(stats.level) ? stats.level : 0;
  const canMerge = selectedCount >= 2;

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
          <span style={{ fontSize: 9.5, color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>
            {count} trk · {audibleCount} active
          </span>
        </span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          {soloCount > 0 && <span title={`${soloCount} soloed file track${soloCount === 1 ? "" : "s"}`}
            style={{ minWidth: 18, height: 17, borderRadius: 4, display: "grid", placeItems: "center",
              background: "var(--amber)", color: "var(--accent-fg)", fontSize: 9, fontWeight: 800 }}>S{soloCount > 1 ? soloCount : ""}</span>}
          {mutedCount > 0 && <span title={`${mutedCount} muted file track${mutedCount === 1 ? "" : "s"}`}
            style={{ minWidth: 18, height: 17, borderRadius: 4, display: "grid", placeItems: "center",
              background: "var(--red)", color: "#fff", fontSize: 9, fontWeight: 800 }}>M{mutedCount > 1 ? mutedCount : ""}</span>}
          <span style={{ fontSize: 9, color: "var(--dim)", letterSpacing: ".04em", textTransform: "uppercase" }}>
            {collapsed ? "Show" : "Hide"}
          </span>
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
        <span style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", gap: 6,
          fontSize: 9.5, fontWeight: 650, color: "var(--cream-2)" }}>
          <span style={{ width: 46, height: 6, borderRadius: 999, overflow: "hidden",
            background: "rgba(0,0,0,.32)", border: "1px solid var(--line)" }}>
            <span style={{ display: "block", width: `${Math.max(0, Math.min(1, groupLevel)) * 100}%`,
              height: "100%", borderRadius: 999, background: "var(--green)", boxShadow: "0 0 5px var(--green)" }} />
          </span>
        </span>
        <span onClick={(e) => { e.stopPropagation(); if (canMerge && onMergeSelected) onMergeSelected(); }}
          title={canMerge ? "Merge selected file tracks" : "Select two or more file tracks"}
          aria-disabled={!canMerge}
          style={{ position: "relative", zIndex: 4, marginLeft: "auto", height: 22, padding: "0 9px",
            borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            fontSize: 9.5, fontWeight: 750, letterSpacing: ".04em", textTransform: "uppercase",
            background: canMerge ? "var(--amber-soft)" : "rgba(255,255,255,.035)",
            color: canMerge ? "var(--amber)" : "var(--dim)",
            border: "1px solid " + (canMerge ? "var(--amber-deep)" : "var(--line-strong)"),
            cursor: canMerge ? "pointer" : "default" }}>
          {selectedCount > 0 && <span className="mono" style={{ fontSize: 9, minWidth: 12, textAlign: "center" }}>
            {selectedCount}
          </span>}
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"
            style={{ flex: "0 0 auto", color: canMerge ? "var(--amber)" : "var(--dim)" }}>
            <path d="M3 1.8h6.4L13 5.4v8.8H3z" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
            <path d="M9.4 1.8v3.6H13" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
            <path d="M5.3 7.8h5.2M5.3 10.2h5.2" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity=".72" />
          </svg>
          Merge Tracks...
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
function Ruler({ pxPerSec, playhead, onSeek, onAddTrack, onAddAudioIn }) {
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
        <button onClick={onAddAudioIn} title="Add Audio In track"
          style={{ height: 18, padding: "0 6px", borderRadius: 5, flex: "0 0 auto", fontSize: 9, fontWeight: 700,
            background: "var(--surface2)", color: "var(--cream-2)", border: "1px solid var(--line-strong)", cursor: "pointer" }}>
          + Audio In
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
