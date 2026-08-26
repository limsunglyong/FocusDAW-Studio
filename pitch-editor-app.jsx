// Pitch Editor — dedicated window, one CLIP at a time (v2.0.0, 피치-에디터-설계.md).
//
// Stage A = skeleton only: the window opens on a clip, draws its waveform on a piano-roll grid,
// and reports what it knows about the clip. It does NOT analyse pitch (Stage B), edit notes
// (Stage D), or touch audio (Stage E) — those buttons are present but disabled so the shape of
// the feature is visible while every stage stays independently testable.
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

// Vocal range with headroom on both sides. Stage B's detector uses the same window
// (65~1100 Hz ≈ C2~C6), so what is drawn is what can be analysed.
const PITCH_LO = 36;   // C2
const PITCH_HI = 84;   // C6
const KEY_W = 54;      // keyboard gutter (px)
const RULER_H = 20;    // time ruler (px)

// ui-kit.js already owns fmtTime and loads FIRST, and the renderers share one global scope
// (앱개발.md 상시 노트) — declaring another `fmtTime` here throws "already declared" and kills
// the whole window. Window-local symbols therefore carry the `pe` prefix, and the formatting
// itself is reused rather than reimplemented.
const peFmtTime = (s) => (Number.isFinite(s) ? fmtTime(s) : "--:--");

// Applied to <html> the moment a theme arrives, NOT from an effect. React runs CHILD effects
// before PARENT effects, so a parent effect that sets data-theme would land AFTER the piano
// roll's redraw — the canvas would read the previous theme's CSS variables and keep the old
// colours until the window was reopened (v2.0.0 defect, T-2.0.0-1 ④).
function peApplyThemeAttr(theme) {
  const root = document.documentElement;
  if (!theme || theme === "default") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
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
function PianoRoll({ info, analysis, theme }) {
  const wrapRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
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
    const rows = PITCH_HI - PITCH_LO + 1;
    const rowH = rollH / rows;
    const yOf = (midi) => RULER_H + (PITCH_HI - midi) * rowH;   // high notes at the top
    const dur = (info && info.duration) || 0;
    const xOf = (t) => KEY_W + (dur > 0 ? (t / dur) * rollW : 0);

    g.clearRect(0, 0, W, H);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);

    // pitch rows — black keys shaded, octave boundaries stronger
    for (let m = PITCH_LO; m <= PITCH_HI; m++) {
      const y = yOf(m);
      if (isBlackKey(m)) { g.fillStyle = C.bg1; g.fillRect(KEY_W, y, rollW, rowH); }
      g.strokeStyle = (m % 12 === 0) ? C.lineStrong : C.line;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(KEY_W, Math.round(y) + 0.5); g.lineTo(W, Math.round(y) + 0.5); g.stroke();
    }

    // time ruler — a tick every 1 s, labelled every 5 s (or every second on short clips)
    g.fillStyle = C.bg1;
    g.fillRect(0, 0, W, RULER_H);
    g.strokeStyle = C.lineStrong;
    g.beginPath(); g.moveTo(0, RULER_H + 0.5); g.lineTo(W, RULER_H + 0.5); g.stroke();
    if (dur > 0) {
      const labelEvery = dur <= 12 ? 1 : (dur <= 60 ? 5 : 15);
      g.font = '9px "Space Mono", ui-monospace, monospace';
      g.textBaseline = "middle";
      for (let t = 0; t <= dur + 1e-6; t += 1) {
        const x = Math.round(xOf(t)) + 0.5;
        const major = Math.abs(t % labelEvery) < 1e-6;
        g.strokeStyle = major ? C.lineStrong : C.line;
        g.beginPath(); g.moveTo(x, major ? 4 : 12); g.lineTo(x, RULER_H); g.stroke();
        if (major) {
          g.fillStyle = C.muted;
          g.fillText(peFmtTime(t), x + 3, RULER_H / 2);
        }
        if (major) {
          g.strokeStyle = C.line;
          g.beginPath(); g.moveTo(x, RULER_H); g.lineTo(x, H); g.stroke();
        }
      }
    }

    // waveform — drawn behind future note blocks, centred on the roll so it reads as
    // "this is the audio under the notes" rather than competing with pitch information.
    const peaks = info && info.peaks;
    if (peaks && peaks.mins && peaks.maxs && peaks.mins.length) {
      const n = peaks.mins.length;
      const midY = RULER_H + rollH / 2;
      const amp = (rollH / 2) * 0.86;
      g.globalAlpha = 0.34;
      g.fillStyle = C.dim;
      for (let i = 0; i < n; i++) {
        const x = KEY_W + (i / n) * rollW;
        const w = Math.max(1, rollW / n);
        const top = midY - Math.max(0, peaks.maxs[i]) * amp;
        const bot = midY - Math.min(0, peaks.mins[i]) * amp;
        g.fillRect(x, top, w, Math.max(1, bot - top));
      }
      g.globalAlpha = 1;
    }

    // Stage B — the detected pitch curve, drawn on top of the waveform and under whatever
    // Stage C will put here. Voiced runs are stroked as continuous segments and unvoiced gaps
    // genuinely break the line: a curve that bridges a breath would invent pitch that is not
    // there. Confidence drives opacity, so shaky detections look shaky.
    const an = analysis;
    if (an && an.frames && dur > 0) {
      const yOfMidi = (m) => RULER_H + (PITCH_HI + 0.5 - m) * rowH;
      g.lineWidth = 2;
      g.lineJoin = "round";
      g.lineCap = "round";
      let k = 0;
      while (k < an.frames) {
        if (!an.voiced[k]) { k++; continue; }
        let end = k;
        while (end + 1 < an.frames && an.voiced[end + 1]) end++;
        if (end > k) {
          // one stroke per run, alpha from the run's mean confidence
          let csum = 0;
          for (let i = k; i <= end; i++) csum += an.conf[i];
          const meanConf = csum / (end - k + 1);
          g.globalAlpha = 0.35 + 0.65 * Math.max(0, Math.min(1, meanConf));
          g.strokeStyle = C.amber;
          g.beginPath();
          for (let i = k; i <= end; i++) {
            const t = i * an.hopSec + an.winSec / 2;   // frame centre, not its left edge
            const x = xOf(t), y = yOfMidi(an.midi[i]);
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
    for (let m = PITCH_LO; m <= PITCH_HI; m++) {
      const y = yOf(m);
      const black = isBlackKey(m);
      g.fillStyle = black ? C.bg1 : C.cream;
      g.fillRect(0, y, black ? KEY_W * 0.62 : KEY_W - 1, Math.max(1, rowH - 1));
      if (!black && m % 12 === 0 && rowH >= 7) {
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
  }, [size, info, analysis, theme]);

  return (
    <div className="pe-roll" ref={wrapRef}>
      <canvas ref={canvasRef} />
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

  const runAnalyze = React.useCallback(() => {
    if (!trackId || !clipId || busy) return;
    setBusy(true); setProgress(0); setNote(""); setAnalysis(null);
    peChannel.postMessage({ type: "REQUEST_PITCH_ANALYZE", trackId, clipId });
  }, [trackId, clipId, busy]);

  const requestClip = React.useCallback(() => {
    if (!trackId || !clipId) { setError("No clip was passed to the editor."); return; }
    peChannel.postMessage({ type: "REQUEST_PITCH_CLIP", trackId, clipId, buckets: 1200 });
  }, [trackId, clipId]);

  React.useEffect(() => {
    peChannel.postMessage({ type: "ADVANCED_READY" });
    const onMsg = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "INIT_STATE" || msg.type === "SYNC_STATE") {
        if (msg.theme) { peApplyThemeAttr(msg.theme); setTheme(msg.theme); }
        if (typeof msg.projectName === "string") setProjectName(msg.projectName);
        // Studio re-broadcasts on ready / undo / redo / rename. Undo can move, trim or
        // replace this clip, so re-pull the clip on every broadcast rather than trusting
        // the copy taken when the window opened.
        requestClip();
        // The clip may have been trimmed, moved or undone — a curve measured from the old
        // audio would sit over the new waveform and quietly lie. Drop it and let the user
        // re-analyse.
        setAnalysis(null);
      } else if (msg.type === "PITCH_CLIP") {
        if (msg.trackId !== trackId || msg.clipId !== clipId) return;
        if (msg.ok && msg.info) { setInfo(msg.info); setError(""); }
        else { setInfo(null); setError(msg.message || "This clip could not be read."); }
      } else if (msg.type === "PITCH_ANALYZE_PROGRESS") {
        if (msg.trackId !== trackId || msg.clipId !== clipId) return;
        setProgress(msg.total ? msg.done / msg.total : 0);
      } else if (msg.type === "PITCH_ANALYSIS") {
        if (msg.trackId !== trackId || msg.clipId !== clipId) return;
        setBusy(false); setProgress(0);
        if (msg.ok && msg.analysis) { setAnalysis(msg.analysis); setNote(""); }
        else { setAnalysis(null); setNote(msg.message || "Pitch analysis failed."); }
      }
    };
    peChannel.addEventListener("message", onMsg);
    requestClip();
    return () => peChannel.removeEventListener("message", onMsg);
  }, [requestClip, trackId, clipId]);

  // Safety net only (initial mount, and any future path that sets theme without the helper).
  // The attribute is normally already correct by the time this runs — see peApplyThemeAttr.
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

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (window.electronAPI) window.electronAPI.winAction("close"); else window.close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tempo = info && info.tempo;
  const transposed = !!(tempo && tempo.variKey && tempo.keyShift);

  return (
    <div className="pe-shell">
      <div className="pe-titlebar">
        <div className="pe-brand"><span className="pe-brand-dot" />PITCH EDITOR</div>
        <div className="pe-title-c">{projectName ? <b>{projectName}</b> : "FocusDAW Studio"}</div>
        <div style={{ flex: 1 }} />
        <WindowControls />
      </div>

      <div className="pe-toolbar">
        <div className="pe-clipname">
          <b>{info ? (info.fileName || info.trackName || "Clip") : "—"}</b>
          <span className="pe-clipmeta">
            {info ? `${peFmtTime(info.duration)} · ${info.sampleRate} Hz · ${info.channels === 1 ? "mono" : `${info.channels} ch`}` : ""}
          </span>
        </div>
        <div className="pe-spacer" />
        {/* Controls are enabled by the stage that gives them meaning, so a half-wired button
            never sits in front of the user. */}
        <button className="pe-btn" onClick={runAnalyze} disabled={!info || busy}
          title="Detect the sung pitch across this clip">
          {busy ? `Analyzing… ${Math.round(progress * 100)}%` : (analysis ? "Re-analyze" : "Analyze")}
        </button>
        <button className="pe-btn" disabled title="Note editing lands in Stage D">Snap all to key</button>
        <button className="pe-btn primary" disabled title="Rendering and printing land in Stage E">Apply</button>
        <button className="pe-btn" disabled title="Available once a correction has been printed (Stage E)">Revert</button>
        <span className="pe-stagetag">STAGE B</span>
      </div>

      <div className="pe-body">
        {error
          ? <div className="pe-empty">{error}</div>
          : (info ? <PianoRoll info={info} analysis={analysis} theme={theme} /> : <div className="pe-empty">Loading clip…</div>)}
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
