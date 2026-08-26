// Pitch Editor — dedicated window, one CLIP at a time (v2.0.0+, 피치-에디터-설계.md).
//
// Stage A gave it a window and a waveform; Stage B added pitch detection and the curve.
// v2.2.0 added the things that make it usable while listening: transport, a playhead, and
// time / pitch zoom. Note segmentation (C), editing (D) and rendering (E) are still ahead —
// their toolbar buttons stay disabled until the stage that gives them meaning.
//
// Why a window per clip rather than a track panel: pitch editing targets one clip's audio, and
// the 244px track header has no horizontal slack left (the vocal strip's FX control already had
// to shrink to an icon for that reason). Entry point is the clip's right-click menu.
//
// State arrives over the SAME "focusdaw-advanced-effects-sync" channel the mixer / advanced /
// vocal-strip windows use, so theme, project name and undo/redo broadcasts are reused unchanged.

const peChannel = new BroadcastChannel("focusdaw-advanced-effects-sync");

function peQuery(k) { try { return new URLSearchParams(location.search).get(k) || ""; } catch (_) { return ""; } }

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const isBlackKey = (midi) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
const midiName = (midi) => NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);

// Absolute limits of the keyboard, with headroom on both sides of the vocal range the
// detector actually searches (65~1100 Hz ≈ C2~C6), so a detected note is never off-screen.
const PITCH_MIN = 36;   // C2
const PITCH_MAX = 84;   // C6
const MIN_SPAN = 8;     // closest vertical zoom, in semitones
const KEY_W = 54;       // keyboard gutter (px)
const RULER_H = 20;     // time ruler (px)
const MIN_VIEW_SEC = 0.25;   // closest time zoom

// ui-kit.js already owns fmtTime and loads FIRST, and the renderers share one global scope
// (앱개발.md 상시 노트) — declaring another `fmtTime` here throws "already declared" and kills
// the whole window. Window-local symbols therefore carry the `pe` prefix, and the formatting
// itself is reused rather than reimplemented.
// Negative guard matters here: the read-out shows CLIP-relative time, so a transport parked
// earlier in the song is legitimately negative — and ui-kit's fmtTime renders that as
// "-1:-5.-15". Outside the clip there is no clip position to show, so say so.
const peFmtTime = (s) => (Number.isFinite(s) && s >= 0 ? fmtTime(s) : "--:--");
const peClamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Applied to <html> the moment a theme arrives, NOT from an effect. React runs CHILD effects
// before PARENT effects, so a parent effect that sets data-theme would land AFTER the piano
// roll's redraw — the canvas would read the previous theme's CSS variables and keep the old
// colours until the window was reopened (v2.0.0 defect, T-2.0.0-1 ④).
function peApplyThemeAttr(theme) {
  const root = document.documentElement;
  if (!theme || theme === "default") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

// Pitch range that frames what was actually sung, with a little air above and below. Falls
// back to the full keyboard when nothing was detected.
function peFitRange(an) {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < an.frames; k++) {
    if (!an.voiced[k]) continue;
    if (an.midi[k] < lo) lo = an.midi[k];
    if (an.midi[k] > hi) hi = an.midi[k];
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: PITCH_MIN, hi: PITCH_MAX };
  let l = Math.floor(lo) - 4, h = Math.ceil(hi) + 4;
  if (h - l < MIN_SPAN) { const pad = Math.ceil((MIN_SPAN - (h - l)) / 2); l -= pad; h += pad; }
  return { lo: Math.max(PITCH_MIN, l), hi: Math.min(PITCH_MAX, h) };
}

/* ---------- window frame ---------- */

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

/* ---------- piano roll canvas ---------- */

// Drawn on a canvas rather than in the DOM: Stage C will put one note block per sung syllable
// and Stage B a pitch point every ~5 ms, which is thousands of elements for a 5-minute vocal.
//
// A canvas is NOT restyled by a CSS variable change — it holds pixels, not styled elements. The
// colours below are read once per draw, so `theme` has to be a real dependency of the drawing
// effect or the roll keeps the palette it was painted with (v2.0.0 defect, T-2.0.0-1 ④).
//
// The PLAYHEAD is deliberately a DOM element on top, not part of the drawing: it moves ~30
// times a second, and repainting the grid + waveform + curve at that rate to move one line
// would be pure waste.
function PianoRoll({ info, analysis, view, range, theme, playhead, onSeek, onView, onRange }) {
  const wrapRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  // The wheel handler is attached imperatively (it needs passive:false to preventDefault), so
  // it reads live state through a ref instead of being torn down and rebound on every change.
  const liveRef = React.useRef(null);
  liveRef.current = { view, range, size, dur: (info && info.duration) || 0, onSeek, onView, onRange };

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const xToTime = (px) => {
    const L = liveRef.current;
    const rollW = Math.max(1, L.size.w - KEY_W);
    return L.view.start + ((px - KEY_W) / rollW) * L.view.dur;
  };

  // Wheel: scroll in time; Ctrl = zoom time about the cursor; Alt/Shift = zoom pitch.
  // Zooming about the CURSOR (not the left edge) is what keeps the note under the pointer
  // still while zooming — the difference between "usable" and "chasing the view".
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      const L = liveRef.current;
      const dur = L.dur;
      if (!dur) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(e.deltaY * 0.0015);
        const anchor = peClamp(xToTime(e.offsetX), 0, dur);
        const nextDur = peClamp(L.view.dur * factor, Math.min(MIN_VIEW_SEC, dur), dur);
        const frac = L.view.dur > 0 ? (anchor - L.view.start) / L.view.dur : 0;
        L.onView({ start: peClamp(anchor - frac * nextDur, 0, Math.max(0, dur - nextDur)), dur: nextDur });
      } else if (e.altKey || e.shiftKey) {
        const factor = Math.exp(e.deltaY * 0.0015);
        const span = L.range.hi - L.range.lo;
        const nextSpan = peClamp(span * factor, MIN_SPAN, PITCH_MAX - PITCH_MIN);
        const centre = (L.range.hi + L.range.lo) / 2;
        let lo = Math.round(centre - nextSpan / 2), hi = Math.round(centre + nextSpan / 2);
        if (lo < PITCH_MIN) { hi += PITCH_MIN - lo; lo = PITCH_MIN; }
        if (hi > PITCH_MAX) { lo -= hi - PITCH_MAX; hi = PITCH_MAX; }
        L.onRange({ lo: Math.max(PITCH_MIN, lo), hi: Math.min(PITCH_MAX, hi) });
      } else {
        const step = (e.deltaY || e.deltaX) * 0.0012 * L.view.dur;
        L.onView({ start: peClamp(L.view.start + step, 0, Math.max(0, dur - L.view.dur)), dur: L.view.dur });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  React.useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (css.getPropertyValue(name) || "").trim() || fallback;
    const C = {
      bg: v("--bg2", "#221d17"), bg1: v("--bg", "#1b1712"), surface: v("--surface", "#2a2520"),
      line: v("--line", "rgba(232,212,170,.10)"), lineStrong: v("--line-strong", "rgba(232,212,170,.18)"),
      cream: v("--cream", "#efe6d4"), dim: v("--dim", "#b0a690"), faint: v("--faint", "#5f574a"),
      muted: v("--muted", "#857c6b"), amber: v("--amber", "#e8b04b"),
    };

    const W = size.w, H = size.h;
    const rollW = Math.max(1, W - KEY_W);
    const rollH = Math.max(1, H - RULER_H);
    const rows = Math.max(1, range.hi - range.lo + 1);
    const rowH = rollH / rows;
    const yOf = (midi) => RULER_H + (range.hi + 0.5 - midi) * rowH;
    const t0 = view.start, tDur = Math.max(1e-6, view.dur);
    const xOf = (t) => KEY_W + ((t - t0) / tDur) * rollW;

    g.clearRect(0, 0, W, H);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);

    // pitch rows — black keys shaded, octave boundaries stronger
    for (let m = range.lo; m <= range.hi; m++) {
      const y = yOf(m);
      if (isBlackKey(m)) { g.fillStyle = C.bg1; g.fillRect(KEY_W, y, rollW, rowH); }
      g.strokeStyle = (m % 12 === 0) ? C.lineStrong : C.line;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(KEY_W, Math.round(y) + 0.5); g.lineTo(W, Math.round(y) + 0.5); g.stroke();
    }

    // Time ruler. The tick step follows the zoom — a fixed 1 s grid is a solid wall when
    // zoomed out and three lonely lines when zoomed in.
    g.fillStyle = C.bg1;
    g.fillRect(0, 0, W, RULER_H);
    g.strokeStyle = C.lineStrong;
    g.beginPath(); g.moveTo(0, RULER_H + 0.5); g.lineTo(W, RULER_H + 0.5); g.stroke();
    const pxPerSec = rollW / tDur;
    const STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    const step = STEPS.find((s) => s * pxPerSec >= 64) || STEPS[STEPS.length - 1];
    g.font = '9px "Space Mono", ui-monospace, monospace';
    g.textBaseline = "middle";
    for (let t = Math.floor(t0 / step) * step; t <= t0 + tDur + 1e-9; t += step) {
      if (t < -1e-9) continue;
      const x = Math.round(xOf(t)) + 0.5;
      if (x < KEY_W) continue;
      g.strokeStyle = C.lineStrong;
      g.beginPath(); g.moveTo(x, 4); g.lineTo(x, RULER_H); g.stroke();
      g.fillStyle = C.muted;
      g.fillText(peFmtTime(t), x + 3, RULER_H / 2);
      g.strokeStyle = C.line;
      g.beginPath(); g.moveTo(x, RULER_H); g.lineTo(x, H); g.stroke();
    }

    // waveform — behind the pitch information, centred, so it reads as "this is the audio
    // under the notes" rather than competing with them
    const peaks = info && info.peaks;
    const clipDur = (info && info.duration) || 0;
    if (peaks && peaks.mins && peaks.maxs && peaks.mins.length && clipDur > 0) {
      const n = peaks.mins.length;
      const midY = RULER_H + rollH / 2;
      const amp = (rollH / 2) * 0.86;
      const bucketSec = clipDur / n;
      const i0 = Math.max(0, Math.floor(t0 / bucketSec));
      const i1 = Math.min(n - 1, Math.ceil((t0 + tDur) / bucketSec));
      g.globalAlpha = 0.34;
      g.fillStyle = C.dim;
      const w = Math.max(1, bucketSec * pxPerSec);
      for (let i = i0; i <= i1; i++) {
        const x = xOf(i * bucketSec);
        const top = midY - Math.max(0, peaks.maxs[i]) * amp;
        const bot = midY - Math.min(0, peaks.mins[i]) * amp;
        g.fillRect(x, top, w, Math.max(1, bot - top));
      }
      g.globalAlpha = 1;
    }

    // Stage B — the detected pitch curve. Voiced runs are stroked as continuous segments and
    // unvoiced gaps genuinely break the line: a curve that bridged a breath would invent pitch
    // that is not there. Confidence drives opacity, so shaky detections look shaky.
    const an = analysis;
    if (an && an.frames) {
      g.lineWidth = 2;
      g.lineJoin = "round";
      g.lineCap = "round";
      // only the frames inside the visible window
      const k0 = peClamp(Math.floor((t0 - an.winSec) / an.hopSec), 0, an.frames - 1);
      const k1 = peClamp(Math.ceil((t0 + tDur) / an.hopSec), 0, an.frames - 1);
      let k = k0;
      while (k <= k1) {
        if (!an.voiced[k]) { k++; continue; }
        let end = k;
        while (end + 1 <= k1 && an.voiced[end + 1]) end++;
        if (end > k) {
          let csum = 0;
          for (let i = k; i <= end; i++) csum += an.conf[i];
          g.globalAlpha = 0.35 + 0.65 * peClamp(csum / (end - k + 1), 0, 1);
          g.strokeStyle = C.amber;
          g.beginPath();
          for (let i = k; i <= end; i++) {
            const t = i * an.hopSec + an.winSec / 2;   // frame centre, not its left edge
            const x = xOf(t), y = yOf(an.midi[i]);
            if (i === k) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
        }
        k = end + 1;
      }
      g.globalAlpha = 1;
    }

    // keyboard gutter — drawn last so nothing bleeds under it
    g.fillStyle = C.surface;
    g.fillRect(0, RULER_H, KEY_W, rollH);
    for (let m = range.lo; m <= range.hi; m++) {
      const y = yOf(m);
      const black = isBlackKey(m);
      g.fillStyle = black ? C.bg1 : C.cream;
      g.fillRect(0, y, black ? KEY_W * 0.62 : KEY_W - 1, Math.max(1, rowH - 1));
      // Label every C, and every white key once the rows are tall enough to read one.
      const label = (m % 12 === 0) || (!black && rowH >= 13);
      if (label && rowH >= 7) {
        g.fillStyle = C.faint;
        g.font = '8px "Space Mono", ui-monospace, monospace';
        g.textBaseline = "middle";
        g.fillText(midiName(m), KEY_W - 22, y + rowH / 2);
      }
    }
    g.strokeStyle = C.lineStrong;
    g.beginPath(); g.moveTo(KEY_W + 0.5, RULER_H); g.lineTo(KEY_W + 0.5, H); g.stroke();
    // `theme` is unused inside the draw, but it IS what the CSS variables above depend on —
    // it is in the dependency list to force a repaint, so do not "clean it up".
  }, [size, info, analysis, view, range, theme]);

  // Playhead overlay. Hidden when the transport sits outside this clip, so playback elsewhere
  // in the song does not park a misleading line at the edge of the roll.
  const clipDur = (info && info.duration) || 0;
  const rollW = Math.max(1, size.w - KEY_W);
  const phX = (Number.isFinite(playhead) && playhead >= -1e-6 && playhead <= clipDur + 1e-6)
    ? KEY_W + ((playhead - view.start) / Math.max(1e-6, view.dur)) * rollW
    : null;

  const seekAt = (e) => {
    if (!onSeek) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < KEY_W) return;                       // the keyboard gutter is not a seek surface
    onSeek(peClamp(xToTime(px), 0, clipDur));
  };

  return (
    <div className="pe-roll" ref={wrapRef} onMouseDown={seekAt}>
      <canvas ref={canvasRef} />
      {phX !== null && phX >= KEY_W && phX <= size.w &&
        <div className="pe-playhead" style={{ left: phX }} />}
    </div>
  );
}

/* ---------- app ---------- */

function PitchEditorApp() {
  const trackId = React.useMemo(() => peQuery("track"), []);
  const clipId = React.useMemo(() => peQuery("clip"), []);
  const [theme, setTheme] = React.useState("default");
  const [projectName, setProjectName] = React.useState("");
  const [info, setInfo] = React.useState(null);
  const [error, setError] = React.useState("");
  const [analysis, setAnalysis] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [note, setNote] = React.useState("");
  // Visible time window in CLIP-relative seconds, and the visible pitch range in MIDI.
  const [view, setView] = React.useState({ start: 0, dur: 0 });
  const [range, setRange] = React.useState({ lo: PITCH_MIN, hi: PITCH_MAX });
  const [transport, setTransport] = React.useState({ playhead: null, isPlaying: false });
  const viewRef = React.useRef(view); viewRef.current = view;
  const infoRef = React.useRef(info); infoRef.current = info;

  const requestClip = React.useCallback(() => {
    if (!trackId || !clipId) { setError("No clip was passed to the editor."); return; }
    // 4000 is the engine's cap. Peaks are computed once and then zoomed INTO, so asking for
    // the maximum is what keeps the waveform from turning blocky as soon as the user zooms.
    peChannel.postMessage({ type: "REQUEST_PITCH_CLIP", trackId, clipId, buckets: 4000 });
  }, [trackId, clipId]);

  const runAnalyze = React.useCallback(() => {
    if (!trackId || !clipId || busy) return;
    setBusy(true); setProgress(0); setNote(""); setAnalysis(null);
    peChannel.postMessage({ type: "REQUEST_PITCH_ANALYZE", trackId, clipId });
  }, [trackId, clipId, busy]);

  React.useEffect(() => {
    peChannel.postMessage({ type: "ADVANCED_READY" });
    const onMsg = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "INIT_STATE" || msg.type === "SYNC_STATE") {
        if (msg.theme) { peApplyThemeAttr(msg.theme); setTheme(msg.theme); }
        if (typeof msg.projectName === "string") setProjectName(msg.projectName);
        // Studio re-broadcasts on ready / undo / redo / rename. Undo can move, trim or
        // replace this clip, so re-pull it on every broadcast rather than trusting the copy
        // taken when the window opened.
        requestClip();
        // A curve measured from the old audio would sit over the new waveform and quietly
        // lie. Drop it and let the user re-analyse.
        setAnalysis(null);
      } else if (msg.type === "PITCH_CLIP") {
        if (msg.trackId !== trackId || msg.clipId !== clipId) return;
        if (msg.ok && msg.info) {
          setInfo(msg.info);
          setError("");
          // Fit the whole clip on first load, and re-fit if the clip got shorter under us
          // (a trim or an undo) so the view can never point past the end.
          const dur = msg.info.duration || 0;
          const cur = viewRef.current;
          if (!cur.dur || cur.dur > dur || cur.start + cur.dur > dur + 1e-6) setView({ start: 0, dur });
        } else { setInfo(null); setError(msg.message || "This clip could not be read."); }
      } else if (msg.type === "PITCH_ANALYZE_PROGRESS") {
        if (msg.trackId !== trackId || msg.clipId !== clipId) return;
        setProgress(msg.total ? msg.done / msg.total : 0);
      } else if (msg.type === "PITCH_ANALYSIS") {
        if (msg.trackId !== trackId || msg.clipId !== clipId) return;
        setBusy(false); setProgress(0);
        if (msg.ok && msg.analysis) {
          setAnalysis(msg.analysis);
          setNote("");
          setRange(peFitRange(msg.analysis));   // frame what was actually sung
        } else { setAnalysis(null); setNote(msg.message || "Pitch analysis failed."); }
      } else if (msg.type === "TRANSPORT_STATE") {
        const clip = infoRef.current;
        // The studio reports SONG time; this window works in clip time.
        const rel = (clip && Number.isFinite(msg.playhead)) ? msg.playhead - (clip.start || 0) : null;
        setTransport({ playhead: rel, isPlaying: !!msg.isPlaying });
      }
    };
    peChannel.addEventListener("message", onMsg);
    requestClip();
    return () => peChannel.removeEventListener("message", onMsg);
  }, [requestClip, trackId, clipId]);

  // Poll the transport (~30 fps). The studio does broadcast the playhead every frame, but only
  // while the mixer / advanced windows are open — polling keeps this window independent of
  // whether those happen to be up, the same choice the vocal strip made for its GR meters.
  React.useEffect(() => {
    const iv = setInterval(() => peChannel.postMessage({ type: "REQUEST_TRANSPORT" }), 33);
    return () => clearInterval(iv);
  }, []);

  // Follow the playhead while playing, but only when zoomed in: at full-clip zoom there is
  // nothing to follow, and scrolling a fitted view would just fight the user.
  React.useEffect(() => {
    if (!transport.isPlaying || !info) return;
    const dur = info.duration || 0;
    const p = transport.playhead;
    if (!Number.isFinite(p) || view.dur >= dur - 1e-6) return;
    if (p < view.start || p > view.start + view.dur) {
      setView({ start: peClamp(p - view.dur * 0.15, 0, Math.max(0, dur - view.dur)), dur: view.dur });
    }
  }, [transport.playhead, transport.isPlaying, info, view.start, view.dur]);

  // Safety net only (initial mount, and any future path that sets theme without the helper).
  React.useEffect(() => { peApplyThemeAttr(theme); }, [theme]);

  // Theme changes are broadcast on their own channel while this window is open (same as the
  // vocal strip): INIT_STATE only carries the theme at open time.
  React.useEffect(() => {
    let ch = null;
    try {
      ch = new BroadcastChannel("focusdaw-theme-sync");
      ch.addEventListener("message", (e) => {
        if (e.data && e.data.type === "THEME_CHANGED" && e.data.theme) { peApplyThemeAttr(e.data.theme); setTheme(e.data.theme); }
      });
    } catch (_) { /* channel unavailable — theme still arrives with INIT_STATE */ }
    return () => { try { ch && ch.close(); } catch (_) {} };
  }, []);

  const seekTo = React.useCallback((tRel) => {
    const clip = infoRef.current;
    if (!clip) return;
    peChannel.postMessage({ type: "REQUEST_SEEK", t: (clip.start || 0) + tRel });
  }, []);
  const playPause = React.useCallback(() => peChannel.postMessage({ type: "REQUEST_PLAY_PAUSE" }), []);
  const stop = React.useCallback(() => peChannel.postMessage({ type: "REQUEST_STOP" }), []);

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (window.electronAPI) window.electronAPI.winAction("close"); else window.close();
        return;
      }
      // Space is the transport key everywhere else in the app. Blur first, or it would also
      // "click" whichever toolbar button happens to have focus.
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        playPause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playPause]);

  const dur = (info && info.duration) || 0;
  const zoomTime = (factor) => {
    const centre = view.start + view.dur / 2;
    const nextDur = peClamp(view.dur * factor, Math.min(MIN_VIEW_SEC, dur), dur);
    setView({ start: peClamp(centre - nextDur / 2, 0, Math.max(0, dur - nextDur)), dur: nextDur });
  };
  const zoomPitch = (factor) => {
    const span = range.hi - range.lo;
    const next = peClamp(span * factor, MIN_SPAN, PITCH_MAX - PITCH_MIN);
    const centre = (range.hi + range.lo) / 2;
    let lo = Math.round(centre - next / 2), hi = Math.round(centre + next / 2);
    if (lo < PITCH_MIN) { hi += PITCH_MIN - lo; lo = PITCH_MIN; }
    if (hi > PITCH_MAX) { lo -= hi - PITCH_MAX; hi = PITCH_MAX; }
    setRange({ lo: Math.max(PITCH_MIN, lo), hi: Math.min(PITCH_MAX, hi) });
  };

  const tempo = info && info.tempo;
  const transposed = !!(tempo && tempo.variKey && tempo.keyShift);
  const zoomedTime = dur > 0 && view.dur < dur - 1e-6;

  return (
    <div className="pe-shell">
      <div className="pe-titlebar">
        <div className="pe-brand"><span className="pe-brand-dot" />PITCH EDITOR</div>
        <div className="pe-title-c">{projectName ? <b>{projectName}</b> : "FocusDAW Studio"}</div>
        <div style={{ flex: 1 }} />
        <WindowControls />
      </div>

      <div className="pe-toolbar">
        {/* Transport first: this window is used while listening, so play/stop sit where the
            hand already is rather than behind the analysis controls. */}
        <button className={"pe-icbtn" + (transport.isPlaying ? " on" : "")} onClick={playPause}
          disabled={!info} title={transport.isPlaying ? "Pause (Space)" : "Play (Space)"}>
          {transport.isPlaying
            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg>}
        </button>
        <button className="pe-icbtn" onClick={stop} disabled={!info} title="Stop">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="1.5" /></svg>
        </button>
        {/* Clip-relative, and blank when the transport is somewhere else in the song — the
            same condition that hides the playhead line, so the two never disagree. */}
        <span className="mono pe-time">{peFmtTime(transport.playhead)}</span>

        <div className="pe-clipname">
          <b>{info ? (info.fileName || info.trackName || "Clip") : "—"}</b>
          <span className="pe-clipmeta">
            {info ? `${peFmtTime(info.duration)} · ${info.sampleRate} Hz · ${info.channels === 1 ? "mono" : `${info.channels} ch`}` : ""}
          </span>
        </div>
        <div className="pe-spacer" />

        {/* Zoom. Ctrl+wheel / Alt+wheel do the same over the roll; the buttons exist because a
            visible control beats a modifier nobody was told about. */}
        <div className="pe-zoomgrp" title="Time zoom — or Ctrl + wheel over the roll">
          <span className="pe-zoomlbl">TIME</span>
          <button className="pe-zbtn" onClick={() => zoomTime(1 / 0.6)} disabled={!zoomedTime}>−</button>
          <button className="pe-zbtn" onClick={() => setView({ start: 0, dur })} disabled={!zoomedTime} title="Fit the whole clip">⤢</button>
          <button className="pe-zbtn" onClick={() => zoomTime(0.6)} disabled={!info}>+</button>
        </div>
        <div className="pe-zoomgrp" title="Pitch zoom — or Alt + wheel over the roll">
          <span className="pe-zoomlbl">PITCH</span>
          <button className="pe-zbtn" onClick={() => zoomPitch(1 / 0.7)} disabled={range.hi - range.lo >= PITCH_MAX - PITCH_MIN}>−</button>
          <button className="pe-zbtn" onClick={() => setRange(analysis ? peFitRange(analysis) : { lo: PITCH_MIN, hi: PITCH_MAX })}
            title={analysis ? "Fit to the detected range" : "Show the full range"}>⤢</button>
          <button className="pe-zbtn" onClick={() => zoomPitch(0.7)} disabled={range.hi - range.lo <= MIN_SPAN}>+</button>
        </div>

        {/* Controls are enabled by the stage that gives them meaning, so a half-wired button
            never sits in front of the user. */}
        <button className="pe-btn" onClick={runAnalyze} disabled={!info || busy}
          title="Detect the sung pitch across this clip">
          {busy ? `Analyzing… ${Math.round(progress * 100)}%` : (analysis ? "Re-analyze" : "Analyze")}
        </button>
        <button className="pe-btn" disabled title="Note editing lands in Stage D">Snap all to key</button>
        <button className="pe-btn primary" disabled title="Rendering and printing land in Stage E">Apply</button>
        <button className="pe-btn" disabled title="Available once a correction has been printed (Stage E)">Revert</button>
      </div>

      <div className="pe-body">
        {error
          ? <div className="pe-empty">{error}</div>
          : (info
            ? <PianoRoll info={info} analysis={analysis} view={view} range={range} theme={theme}
                playhead={transport.playhead} onSeek={seekTo} onView={setView} onRange={setRange} />
            : <div className="pe-empty">Loading clip…</div>)}
      </div>

      <div className="pe-footer">
        <span>
          {!info ? "—" : (note ? note : (analysis
            // Voiced coverage is the honest headline number: it says how much of the clip the
            // detector actually found a pitch in, which is what the next stage segments.
            ? `${info.trackName || "track"} · ${(100 * analysis.voicedFrames / analysis.frames).toFixed(0)}% voiced`
              + ` · ${analysis.frames} frames @ ${Math.round(analysis.hopSec * 1000)} ms`
              + ` · analysed in ${(analysis.elapsedMs / 1000).toFixed(1)} s`
            : `${info.trackName || "track"} · clip at ${peFmtTime(info.start)} · press Analyze to detect pitch`))}
        </span>
        {/* Vari Key/BPM never bake into timeline audio, so analysis and rendering always work
            in the original domain. Say so when playback is transposed, or the note names on
            screen silently disagree with what the user hears (설계 §3). */}
        {transposed
          ? <span className="pe-badge">VARI KEY {tempo.keyShift > 0 ? "+" : ""}{tempo.keyShift} — editing the original pitch</span>
          : <span>{tempo && tempo.detectedKey ? `Key ${tempo.detectedKey}` : ""}</span>}
      </div>
    </div>
  );
}

ReactDOM.render(<PitchEditorApp />, document.getElementById("root"));
