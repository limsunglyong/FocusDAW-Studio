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
const SB = 10;          // scrollbar thickness (px) — 참조 디자인 §3e
const MIN_VIEW_SEC = 0.25;   // closest time zoom

// The visible pitch window is a FLOAT range (v2.3.0). It used to be two integers because the
// only operation was "zoom about the centre"; panning by whole semitones would jump the view
// a full row (~15px) at a time, which reads as stuttering rather than scrolling.
const peSpan = (r) => r.hi - r.lo;
function peFitPitch(lo, hi) {
  const span = peClamp(hi - lo, MIN_SPAN, PITCH_MAX - PITCH_MIN);
  let l = lo, h = lo + span;
  if (l < PITCH_MIN) { l = PITCH_MIN; h = l + span; }
  if (h > PITCH_MAX) { h = PITCH_MAX; l = h - span; }
  return { lo: l, hi: h };
}

// The pitch the singer was actually on at time t — used to light the key under the playhead
// so the ear and the eye can be compared while listening (T-2.0.2-1 ④의 상시 확인 수단).
function peMidiAt(an, t) {
  if (!an || !an.frames || !Number.isFinite(t)) return null;
  const k = Math.round((t - an.winSec / 2) / an.hopSec);
  if (k < 0 || k >= an.frames || !an.voiced[k]) return null;
  return an.midi[k];
}

/* ---------- piano preview tone ---------- */

// A struck-string-ish tone, synthesised rather than sampled: four decaying partials is a few
// lines and no asset, and the point is pitch reference, not a convincing piano.
//
// This window opens its OWN AudioContext. That is safe — the studio already runs the web
// engine's context alongside the native engine — but it does NOT inherit the studio's output
// device, so the sink has to be matched explicitly or the preview comes out of the laptop
// speakers while the mix plays through the interface (audio-engine.js `setOutputDevice`
// does the same label match for the same reason).
let peCtx = null;
let peSinkDone = false;

async function peSyncSink() {
  if (peSinkDone || !peCtx || typeof peCtx.setSinkId !== "function") return;
  peSinkDone = true;
  try {
    const saved = JSON.parse(localStorage.getItem("focusdaw-audio-device") || "null");
    const label = (saved && saved.name) || "";
    if (!label) { await peCtx.setSinkId(""); return; }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const norm = (x) => (x || "").toLowerCase().replace(/\s+/g, " ").trim();
    const want = norm(label);
    const outs = devices.filter((d) => d.kind === "audiooutput");
    const hit = outs.find((d) => norm(d.label) === want)
             || outs.find((d) => norm(d.label).includes(want) || want.includes(norm(d.label)));
    if (hit) await peCtx.setSinkId(hit.deviceId);
  } catch (_) { /* preview falls back to the default device — never worth an error dialog */ }
}

function peTone(midi) {
  try {
    if (!peCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      peCtx = new AC();
      peSyncSink();
    }
    if (peCtx.state === "suspended") peCtx.resume();
    const t0 = peCtx.currentTime;
    const f0 = 440 * Math.pow(2, (midi - 69) / 12);
    const out = peCtx.createGain();
    out.gain.value = 0.22;
    // A gentle low-pass keeps the upper partials from sounding like a square-wave beep.
    const lp = peCtx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.min(9000, f0 * 9);
    lp.connect(out); out.connect(peCtx.destination);
    const PARTIALS = [[1, 1.0, 1.5], [2, 0.42, 1.0], [3, 0.20, 0.7], [4, 0.10, 0.5]];
    for (const [mult, amp, decay] of PARTIALS) {
      const osc = peCtx.createOscillator();
      const g = peCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = f0 * mult;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(amp, t0 + 0.006);          // a hammer, not a fade-in
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);  // higher partials die first
      osc.connect(g); g.connect(lp);
      osc.start(t0); osc.stop(t0 + decay + 0.05);
    }
  } catch (_) { /* no preview is better than a broken window */ }
}

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
function PianoRoll({ info, analysis, view, range, theme, playhead, litMidi, onSeek, onView, onRange, onPreview }) {
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

  // Geometry. The vertical scrollbar takes SB px off the right edge (there is no horizontal
  // one — the CLIP MAP strip above does that job), and every conversion below has to agree on
  // that or the playhead and click-to-seek land a few pixels off.
  const geo = (L) => {
    const rollW = Math.max(1, L.size.w - KEY_W - SB);
    const rollH = Math.max(1, L.size.h - RULER_H);
    const rows = peSpan(L.range) + 1;
    return { rollW, rollH, rows, rowH: rollH / rows };
  };
  const xToTime = (px) => {
    const L = liveRef.current, G = geo(L);
    return L.view.start + ((px - KEY_W) / G.rollW) * L.view.dur;
  };
  const yToMidi = (py) => {
    const L = liveRef.current, G = geo(L);
    return peClamp(Math.round(L.range.hi + 1 - (py - RULER_H) / G.rowH), PITCH_MIN, PITCH_MAX);
  };

  // Wheel. Conventions follow 참조 디자인 (plain = vertical, Shift = horizontal, Ctrl = time
  // zoom, Ctrl+Shift = key zoom); Alt stays a synonym for key zoom because v2.2.0 taught it and
  // there is no reason to break a habit that costs nothing.
  //
  // Both zooms anchor on the CURSOR, not the edge or the centre — that is what keeps the note
  // under the pointer still while zooming, the difference between "usable" and "chasing the
  // view". Scrolling is 1:1 with pixels: the content moves by what the wheel moved.
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      const L = liveRef.current;
      const dur = L.dur;
      if (!dur) return;
      e.preventDefault();
      const G = geo(L);
      const zoomTimeAt = (factor, anchorPx) => {
        const anchor = peClamp(xToTime(anchorPx), 0, dur);
        const nextDur = peClamp(L.view.dur * factor, Math.min(MIN_VIEW_SEC, dur), dur);
        const frac = L.view.dur > 0 ? (anchor - L.view.start) / L.view.dur : 0;
        L.onView({ start: peClamp(anchor - frac * nextDur, 0, Math.max(0, dur - nextDur)), dur: nextDur });
      };
      const zoomKeyAt = (factor, anchorPx) => {
        const span = peSpan(L.range);
        const next = peClamp(span * factor, MIN_SPAN, PITCH_MAX - PITCH_MIN);
        const anchor = L.range.hi + 1 - (anchorPx - RULER_H) / G.rowH;
        const frac = span > 0 ? peClamp((L.range.hi - anchor) / span, 0, 1) : 0.5;
        const hi = anchor + frac * next;
        L.onRange(peFitPitch(hi - next, hi));
      };
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        zoomKeyAt(Math.exp(e.deltaY * 0.0015), e.offsetY);
      } else if (e.ctrlKey || e.metaKey) {
        zoomTimeAt(Math.exp(e.deltaY * 0.0015), e.offsetX);
      } else if (e.altKey) {
        zoomKeyAt(Math.exp(e.deltaY * 0.0015), e.offsetY);
      } else if (e.shiftKey) {
        const step = ((e.deltaY || e.deltaX) / G.rollW) * L.view.dur;
        L.onView({ start: peClamp(L.view.start + step, 0, Math.max(0, dur - L.view.dur)), dur: L.view.dur });
      } else {
        // Wheel down = down the keyboard, so the range slides toward the low notes.
        const d = -(e.deltaY / G.rollH) * G.rows;
        L.onRange(peFitPitch(L.range.lo + d, L.range.hi + d));
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
      muted: v("--muted", "#857c6b"), amber: v("--amber", "#e8b04b"), red: v("--red", "#d96a4e"),
      onAmber: v("--mixer-bar-fg", "#241a0a"),
      keyWhite: v("--key-white", "#e6dcc6"), keyWhite2: v("--key-white-2", "#cbc0a6"),
      keyBlack: v("--key-black", "#221e18"), keyInk: v("--key-ink", "#4a4033"),
    };

    const W = size.w, H = size.h;
    const rollW = Math.max(1, W - KEY_W - SB);
    const rollH = Math.max(1, H - RULER_H);
    const rows = peSpan(range) + 1;
    const rowH = rollH / rows;
    const yOf = (midi) => RULER_H + (range.hi + 0.5 - midi) * rowH;
    const t0 = view.start, tDur = Math.max(1e-6, view.dur);
    const xOf = (t) => KEY_W + ((t - t0) / tDur) * rollW;
    const mLo = Math.max(PITCH_MIN, Math.floor(range.lo) - 1);
    const mHi = Math.min(PITCH_MAX, Math.ceil(range.hi) + 1);

    g.clearRect(0, 0, W, H);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);

    // Everything below draws into the roll box only; the last SB px on the right belong to
    // the vertical scrollbar, a DOM element sitting on top.
    g.save();
    g.beginPath(); g.rect(0, 0, W - SB, H); g.clip();

    // pitch rows — black keys shaded, octave boundaries stronger
    for (let m = mLo; m <= mHi; m++) {
      const y = yOf(m);
      if (isBlackKey(m)) { g.fillStyle = C.bg1; g.fillRect(KEY_W, y, rollW, rowH); }
      g.strokeStyle = (m % 12 === 0) ? C.lineStrong : C.line;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(KEY_W, Math.round(y) + 0.5); g.lineTo(W - SB, Math.round(y) + 0.5); g.stroke();
    }

    // Time ruler. The tick step follows the zoom — a fixed 1 s grid is a solid wall when
    // zoomed out and three lonely lines when zoomed in.
    g.fillStyle = C.bg1;
    g.fillRect(0, 0, W, RULER_H);
    g.strokeStyle = C.lineStrong;
    g.beginPath(); g.moveTo(0, RULER_H + 0.5); g.lineTo(W, RULER_H + 0.5); g.stroke();
    const pxPerSec = rollW / tDur;
    const STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    const step = STEPS.find((x) => x * pxPerSec >= 64) || STEPS[STEPS.length - 1];
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
          // Red, not amber: Stage C hangs AMBER note blocks over this curve, and a detected
          // curve in the same colour as the target notes is unreadable the moment both are on
          // screen (참조 디자인 §3d — notes amber, detected pitch red).
          g.strokeStyle = C.red;
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

    // Keyboard gutter — drawn last so nothing bleeds under it.
    //
    // The faces come from their own --key-* tokens rather than --cream / --bg (v2.2.0). Those
    // two are TEXT colours: on the light themes --cream is nearly black, so the "white" keys
    // came out dark and the note names — drawn in --faint, the palette's least-visible colour —
    // disappeared into them (T-2.2.0-2 요청 ③). A piano key is a piano key in every theme.
    g.fillStyle = C.surface;
    g.fillRect(0, RULER_H, KEY_W, rollH);
    const whiteFace = g.createLinearGradient(0, 0, KEY_W, 0);
    whiteFace.addColorStop(0, C.keyWhite2);
    whiteFace.addColorStop(1, C.keyWhite);
    for (let m = mLo; m <= mHi; m++) {
      const y = yOf(m);
      const black = isBlackKey(m);
      const kw = black ? KEY_W * 0.62 : KEY_W;   // sharps sit short, like the real thing
      const lit = litMidi === m;                 // sounding, or under the playhead
      g.fillStyle = lit ? C.amber : (black ? C.keyBlack : whiteFace);
      g.fillRect(0, y, kw, Math.max(1, rowH - 1));
      g.fillStyle = "rgba(0,0,0,.35)";
      g.fillRect(0, y, kw, 1);                   // key separation, independent of the theme
      // Label every C, and every white key once the rows are tall enough to read one. Bold,
      // dark ink, right-aligned against the key's edge — sized with the row so a tall row gets
      // a readable label instead of a fixed 8px one.
      const label = lit || (m % 12 === 0) || (!black && rowH >= 13);
      if (label && rowH >= 7) {
        g.fillStyle = lit ? C.onAmber : (black ? C.keyWhite : C.keyInk);
        g.font = "700 " + Math.min(9, Math.max(7, rowH - 4)) + 'px "Space Mono", ui-monospace, monospace';
        g.textAlign = "right";
        g.textBaseline = "middle";
        g.fillText(midiName(m), (black ? kw : KEY_W) - 5, y + rowH / 2);
        g.textAlign = "left";                    // the ruler draws left-aligned; leave it as found
      }
    }
    g.strokeStyle = C.lineStrong;
    g.beginPath(); g.moveTo(KEY_W + 0.5, RULER_H); g.lineTo(KEY_W + 0.5, H); g.stroke();
    g.restore();
    // `theme` is unused inside the draw, but it IS what the CSS variables above depend on —
    // it is in the dependency list to force a repaint, so do not "clean it up".
  }, [size, info, analysis, view, range, theme, litMidi]);

  // Playhead overlay. Hidden when the transport sits outside this clip, so playback elsewhere
  // in the song does not park a misleading line at the edge of the roll.
  const clipDur = (info && info.duration) || 0;
  const rollW = Math.max(1, size.w - KEY_W - SB);
  const rollH = Math.max(1, size.h - RULER_H);
  const phX = (Number.isFinite(playhead) && playhead >= -1e-6 && playhead <= clipDur + 1e-6)
    ? KEY_W + ((playhead - view.start) / Math.max(1e-6, view.dur)) * rollW
    : null;

  // Mouse down on the roll. Left button seeks — or sounds a key, in the gutter. The MIDDLE
  // button pans both axes: it has to be a different button because the whole roll surface is
  // already the seek target, and Stage D's pan tool will take this over.
  const onDown = (e) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (px > size.w - SB) return;                          // the scrollbar gutter
    if (e.button === 1) {
      e.preventDefault();
      const v0 = { ...view }, r0 = { ...range }, sx = e.clientX, sy = e.clientY;
      const G = geo(liveRef.current);
      const move = (ev) => {
        const dt = -((ev.clientX - sx) / G.rollW) * v0.dur;
        const dm = ((ev.clientY - sy) / G.rollH) * G.rows;
        onView({ start: peClamp(v0.start + dt, 0, Math.max(0, clipDur - v0.dur)), dur: v0.dur });
        onRange(peFitPitch(r0.lo + dm, r0.hi + dm));
      };
      const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return;
    }
    if (e.button !== 0) return;
    if (px < KEY_W) {
      // The keyboard gutter is not a seek surface — it is a keyboard. Clicking a key sounds it,
      // which is what makes the detected curve checkable by ear (사용자 요청, T-2.0.2-1 ④).
      if (py > RULER_H && onPreview) onPreview(yToMidi(py));
      return;
    }
    if (onSeek) onSeek(peClamp(xToTime(px), 0, clipDur));
  };

  // The vertical thumb maps its pixel delta back through the same ratio that sized it.
  const dragBar = (e) => {
    e.preventDefault(); e.stopPropagation();
    const sy = e.clientY;
    const r0 = { ...range };
    const total = PITCH_MAX - PITCH_MIN + 1;
    const move = (ev) => {
      const dm = -((ev.clientY - sy) / Math.max(1, rollH)) * total;
      onRange(peFitPitch(r0.lo + dm, r0.hi + dm));
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const total = PITCH_MAX - PITCH_MIN + 1;
  const vFrac = peClamp((peSpan(range) + 1) / total, 0, 1);
  const vPos = peClamp((PITCH_MAX - range.hi) / total, 0, 1);

  return (
    <div className="pe-roll" ref={wrapRef} onMouseDown={onDown}>
      <canvas ref={canvasRef} />
      {phX !== null && phX >= KEY_W && phX <= size.w - SB &&
        <div className="pe-playhead" style={{ left: phX }} />}
      <div className="pe-vbar" title="Drag to move up / down the keyboard">
        <div className="pe-thumb" onMouseDown={dragBar}
          style={{ top: (vPos * 100) + "%", height: "max(24px," + (vFrac * 100) + "%)" }} />
      </div>
    </div>
  );
}

/* ---------- clip overview strip ---------- */

// The whole clip at a glance, with the current view drawn on it as a box. This is the piece
// that was missing when the user reported "좌우로 이동(탐색)이 되지 않습니다": plain-wheel
// scrolling did work, but with no scrollbar and no map there was nothing on screen to say so,
// and no way to see WHERE in the clip the view sat.
//
// It draws the same 4000-bucket peaks the roll already holds, so it costs no extra analysis —
// only a second, cheaper paint.
function ClipOverview({ info, analysis, view, playhead, theme, onView }) {
  const wrapRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  // Height is MEASURED, not assumed: the strip's CSS box is 46px minus its bottom border, and
  // a backing store sized to the wrong number quietly scales every pixel drawn into it.
  const [{ w, H }, setBox] = React.useState({ w: 0, H: 0 });
  const dur = (info && info.duration) || 0;

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, H: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !w || !H) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const v = (n, f) => (css.getPropertyValue(n) || "").trim() || f;
    const C = { bg: v("--bg", "#1b1712"), dim: v("--dim", "#b0a690"), amber: v("--amber", "#e8b04b"),
                red: v("--red", "#d96a4e") };

    g.clearRect(0, 0, w, H);
    g.fillStyle = C.bg; g.fillRect(0, 0, w, H);
    const xOf = (t) => (dur > 0 ? (t / dur) * w : 0);

    const peaks = info && info.peaks;
    if (peaks && peaks.mins && peaks.mins.length && dur > 0) {
      const n = peaks.mins.length, mid = H / 2, amp = (H / 2) * 0.82;
      g.globalAlpha = 0.5; g.fillStyle = C.dim;
      // One column per screen pixel, taking the EXTREMES of every bucket that falls in it.
      // Sampling instead (one bucket per column) would drop short peaks entirely — 4000 buckets
      // squeezed into ~700 px throws away five out of six of them.
      for (let x = 0; x < w; x++) {
        const a = Math.floor((x / w) * n), b = Math.max(a + 1, Math.floor(((x + 1) / w) * n));
        let lo = 0, hi = 0;
        for (let i = a; i < b && i < n; i++) {
          if (peaks.mins[i] < lo) lo = peaks.mins[i];
          if (peaks.maxs[i] > hi) hi = peaks.maxs[i];
        }
        g.fillRect(x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
      }
      g.globalAlpha = 1;
    }

    // Where the detector found a pitch — a two-pixel ribbon along the bottom. It answers
    // "which part of this clip is even worth zooming into" at a glance.
    if (analysis && analysis.frames && dur > 0) {
      g.fillStyle = C.red; g.globalAlpha = 0.55;
      const fw = Math.max(1, (analysis.hopSec / dur) * w);
      for (let k = 0; k < analysis.frames; k++) {
        if (!analysis.voiced[k]) continue;
        g.fillRect(xOf(k * analysis.hopSec), H - 3, fw, 2);
      }
      g.globalAlpha = 1;
    }

    // The viewport box: DIM what is off-screen rather than outline what is on it, so the eye
    // reads the bright part as "this is what you are looking at".
    if (dur > 0 && view.dur < dur - 1e-6) {
      const x0 = xOf(view.start), x1 = xOf(view.start + view.dur);
      g.fillStyle = "rgba(0,0,0,.45)";
      g.fillRect(0, 0, x0, H); g.fillRect(x1, 0, w - x1, H);
      g.strokeStyle = C.amber; g.lineWidth = 1;
      g.strokeRect(Math.round(x0) + 0.5, 0.5, Math.max(2, x1 - x0) - 1, H - 1);
    }

    if (Number.isFinite(playhead) && playhead >= 0 && playhead <= dur) {
      g.fillStyle = C.red; g.fillRect(Math.round(xOf(playhead)), 0, 1.5, H);
    }
  }, [w, H, info, analysis, view, playhead, theme]);

  // Click outside the box jumps there; inside it drags; the edges resize (= zoom).
  const onDown = (e) => {
    if (!dur || !w || e.button !== 0) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const x0 = (view.start / dur) * w, x1 = ((view.start + view.dur) / dur) * w;
    const EDGE = 5;
    const v0 = { ...view }, sx = e.clientX;
    let mode = "jump";
    if (v0.dur < dur - 1e-6) {
      if (Math.abs(px - x0) <= EDGE) mode = "l";
      else if (Math.abs(px - x1) <= EDGE) mode = "r";
      else if (px > x0 && px < x1) mode = "pan";
    }
    if (mode === "jump") {
      const t = peClamp((px / w) * dur, 0, dur);
      onView({ start: peClamp(t - view.dur / 2, 0, Math.max(0, dur - view.dur)), dur: view.dur });
      return;
    }
    const move = (ev) => {
      const dt = ((ev.clientX - sx) / w) * dur;
      if (mode === "pan") {
        onView({ start: peClamp(v0.start + dt, 0, Math.max(0, dur - v0.dur)), dur: v0.dur });
      } else if (mode === "l") {
        const start = peClamp(v0.start + dt, 0, v0.start + v0.dur - MIN_VIEW_SEC);
        onView({ start, dur: v0.start + v0.dur - start });
      } else {
        const end = peClamp(v0.start + v0.dur + dt, v0.start + MIN_VIEW_SEC, dur);
        onView({ start: v0.start, dur: end - v0.start });
      }
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="pe-overview">
      <div className="pe-ovlabel"><span>CLIP</span><span style={{ opacity: .7 }}>MAP</span></div>
      <div className="pe-ovcanvas" ref={wrapRef} onMouseDown={onDown}
        title="Click to jump · drag the bright box to scroll · drag its edges to zoom">
        <canvas ref={canvasRef} />
      </div>
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
  const [clipLoop, setClipLoop] = React.useState(false);
  const [sideOpen, setSideOpen] = React.useState(true);
  const [struck, setStruck] = React.useState(null);   // key flashed by a preview click
  const viewRef = React.useRef(view); viewRef.current = view;
  const infoRef = React.useRef(info); infoRef.current = info;
  const transportRef = React.useRef(transport); transportRef.current = transport;
  const transportSeenRef = React.useRef(false);   // a real report has arrived, not the default
  const stoppedOnOpen = React.useRef(false);
  // "Did playback start from THIS window?" — see the auto-stop effect for why it matters.
  const ownPlayRef = React.useRef(false);
  const wasPlayingRef = React.useRef(false);
  const clipLoopRef = React.useRef(false); clipLoopRef.current = clipLoop;
  const struckTimer = React.useRef(null);

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
        transportSeenRef.current = true;
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
  // ▶ starts at the CLIP, not at wherever the song happens to be parked. This window edits one
  // clip; a Play that begins somewhere else in the song is a Play that does nothing audible
  // here. Already inside the clip, the position is left alone — otherwise it would be
  // impossible to resume from the middle.
  const playPause = React.useCallback(() => {
    const t = transportRef.current, clip = infoRef.current;
    if (!t.isPlaying) ownPlayRef.current = true;      // this window is starting playback
    if (!t.isPlaying && clip) {
      const p = t.playhead;
      if (!Number.isFinite(p) || p < 0 || p > (clip.duration || 0)) {
        peChannel.postMessage({ type: "REQUEST_SEEK", t: clip.start || 0 });
      }
    }
    peChannel.postMessage({ type: "REQUEST_PLAY_PAUSE" });
  }, []);

  // ■ returns to the start of the CLIP for the same reason — the song's 0 s is not this
  // window's zero. (`stopRef` lets the auto-stop effect above call this without depending on
  // declaration order.)
  const stopRef = React.useRef(null);
  const stop = React.useCallback(() => {
    peChannel.postMessage({ type: "REQUEST_STOP", fromEditor: true });
    const clip = infoRef.current;
    if (clip) peChannel.postMessage({ type: "REQUEST_SEEK", t: clip.start || 0 });
  }, []);
  stopRef.current = stop;

  // Opening this window while the song is rolling is confusing: the editor's transport is
  // clip-scoped, so a studio playing something else underneath reads as the editor being
  // broken (사용자 보고, v2.3.3). Stop ONCE — when the window first knows both the clip and
  // the real transport state — and never again, so playing from here afterwards is free.
  // The studio side refuses this while recording: a take must not be cut short by opening a
  // window. Stopping goes through stop(), which parks at the clip's start rather than the
  // song's zero.
  React.useEffect(() => {
    if (stoppedOnOpen.current || !info || !transportSeenRef.current) return;
    stoppedOnOpen.current = true;
    if (transport.isPlaying) stopRef.current();
  }, [info, transport]);

  // Playback started here stops at the end of the CLIP. Editing one clip while the song keeps
  // rolling past it is the transport running away from the work — and with the roll ending at
  // the clip's edge there is nothing left on screen to follow.
  //
  // Only playback THIS window started, though: leaving the editor open while auditioning the
  // whole song from the studio must not cut that off at the clip's edge. Ownership is claimed
  // when ▶ is pressed here and released on the next observed play→stop transition, so a Play
  // pressed in the studio never carries this window's flag.
  //
  // Skipped when CLIP loop is on — there the engine wraps at the same boundary, which is the
  // whole point of the toggle.
  React.useEffect(() => {
    if (!transport.isPlaying && wasPlayingRef.current) ownPlayRef.current = false;
    wasPlayingRef.current = transport.isPlaying;
    if (!transport.isPlaying || !ownPlayRef.current || clipLoop || !info) return;
    const d = info.duration || 0;
    const p = transport.playhead;
    if (!d || !Number.isFinite(p) || p < d - 1e-3) return;
    // Through stop(), so the end of the clip leaves the transport exactly where ■ would —
    // two ways to reach the same state must not park the playhead in two different places.
    ownPlayRef.current = false;   // one stop per run, not one per 33 ms poll until it takes
    stopRef.current();
  }, [transport.isPlaying, transport.playhead, clipLoop, info]);

  // CLIP loop. The studio already has a working loop (the Repeat region, honoured by both the
  // web and the native engine), so this BORROWS it rather than inventing a second mechanism —
  // and hands the user's own region back on release. The studio side refuses the takeover
  // while recording, where the region means something else entirely (punch's in/out).
  const applyClipLoop = React.useCallback((on) => {
    const clip = infoRef.current;
    if (on && clip) {
      const start = clip.start || 0;
      peChannel.postMessage({ type: "REQUEST_LOOP_RANGE", start, end: start + (clip.duration || 0) });
    } else {
      peChannel.postMessage({ type: "REQUEST_LOOP_RANGE", restore: true });
    }
  }, []);
  const toggleClipLoop = React.useCallback(() => setClipLoop((on) => !on), []);

  // Closing the editor must not leave the studio looping a clip the user never asked to loop.
  React.useEffect(() => {
    const release = () => {
      if (clipLoopRef.current) peChannel.postMessage({ type: "REQUEST_LOOP_RANGE", restore: true });
    };
    window.addEventListener("beforeunload", release);
    return () => { window.removeEventListener("beforeunload", release); release(); };
  }, []);

  // ONE place applies the loop, so a toggle and a clip that moved underneath cannot each send
  // their own message. The clip can move or be trimmed under us (an undo, an edit in the
  // studio), and the loop has to follow it or it keeps looping the span the clip used to hold.
  const loopInit = React.useRef(false);
  React.useEffect(() => {
    if (!loopInit.current) { loopInit.current = true; if (!clipLoop) return; }   // nothing to release on mount
    applyClipLoop(clipLoop && !!info);
  }, [clipLoop, info && info.start, info && info.duration, applyClipLoop]);

  // Sounding a key is what makes the detected curve checkable by ear; the flash tells the eye
  // which key it was, since the sound is gone in a second.
  const previewKey = React.useCallback((midi) => {
    peTone(midi);
    setStruck(midi);
    clearTimeout(struckTimer.current);
    struckTimer.current = setTimeout(() => setStruck(null), 420);
  }, []);

  React.useEffect(() => {
    const onKey = (e) => {
      // Undo / redo belong to the window the user is looking at. Every other satellite window
      // already forwards them (vocal strip, advanced EQ, mixer); this one did not, so a clip
      // change made from here had to be undone by clicking back to the studio first — the
      // inconvenience reported against T-2.0.2-1 ⑧. There was no design reason for it: Stage
      // A/B make no edits of their own, so nothing had asked for the binding yet.
      //
      // Stage D adds a WINDOW-LOCAL note-edit stack IN FRONT of this: Ctrl+Z will pop that
      // first and only fall through to the studio once it is empty, Apply (print) will push a
      // single entry onto the studio stack, and a studio undo will drop the local stack the
      // same way it drops the analysis below (the clip may have changed underneath).
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault(); peChannel.postMessage({ type: "REQUEST_UNDO" }); return;
      }
      if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault(); peChannel.postMessage({ type: "REQUEST_REDO" }); return;
      }
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
    const span = peSpan(range);
    const next = peClamp(span * factor, MIN_SPAN, PITCH_MAX - PITCH_MIN);
    const centre = (range.hi + range.lo) / 2;
    setRange(peFitPitch(centre - next / 2, centre + next / 2));
  };

  const tempo = info && info.tempo;
  const transposed = !!(tempo && tempo.variKey && tempo.keyShift);
  const zoomedTime = dur > 0 && view.dur < dur - 1e-6;

  // While playing, light the key the singer was actually on. It is the cheapest way to check
  // the detected curve against the piano by ear and by eye at the same time — the standing
  // task the user kept open on T-2.0.2-1 ④. A key just struck by hand wins, briefly.
  const sungMidi = transport.isPlaying ? peMidiAt(analysis, transport.playhead) : null;
  const litMidi = struck !== null ? struck : (sungMidi === null ? null : Math.round(sungMidi));

  const zoomBtns = (label, minus, fit, plus, tip) => (
    <div className="pe-row" title={tip}>
      <span className="pe-rowlbl">{label}</span>
      <button className="pe-zbtn" onClick={minus.fn} disabled={minus.off}>−</button>
      <button className="pe-zbtn" onClick={fit.fn} disabled={fit.off} title={fit.title}>⤢</button>
      <button className="pe-zbtn" onClick={plus.fn} disabled={plus.off}>+</button>
    </div>
  );

  return (
    <div className="pe-shell">
      <div className="pe-titlebar">
        <div className="pe-brand"><span className="pe-brand-dot" />PITCH EDITOR</div>
        <div className="pe-title-c">{projectName ? <b>{projectName}</b> : "FocusDAW Studio"}</div>
        <div style={{ flex: 1 }} />
        <WindowControls />
      </div>

      {/* Transport bar. v2.3.0 empties it of everything that is not transport or identity —
          zoom, analysis and correction moved to the side panel — because this row wrapped onto
          a second line as soon as the window was narrowed, eating the roll's height. */}
      <div className="pe-toolbar">
        <button className={"pe-icbtn" + (transport.isPlaying ? " on" : "")} onClick={playPause}
          disabled={!info} title={transport.isPlaying ? "Pause (Space)" : "Play from the clip (Space)"}>
          {transport.isPlaying
            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg>}
        </button>
        <button className="pe-icbtn" onClick={stop} disabled={!info} title="Stop and return to the start of the clip">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="1.5" /></svg>
        </button>
        {/* CLIP loop: borrows the studio's Repeat region for the length of this clip, and hands
            it back when switched off or when the window closes. */}
        <button className={"pe-btn" + (clipLoop ? " primary" : "")} onClick={toggleClipLoop} disabled={!info}
          title={clipLoop
            ? "Playback is looping this clip — the studio's own Repeat region is restored when you switch this off"
            : "Loop playback over this clip only (temporarily takes over the studio's Repeat region)"}
          style={{ padding: "6px 10px", fontSize: 10 }}>
          CLIP
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
        <button className={"pe-icbtn" + (sideOpen ? " on" : "")} onClick={() => setSideOpen((o) => !o)}
          title={sideOpen ? "Hide the panel" : "Show the panel"}>
          <svg width="13" height="13" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none">
            <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" />
          </svg>
        </button>
      </div>

      <div className="pe-body">
        <div className="pe-center">
          {info && !error &&
            <ClipOverview info={info} analysis={analysis} view={view} playhead={transport.playhead}
              theme={theme} onView={setView} />}
          {error
            ? <div className="pe-empty">{error}</div>
            : (info
              ? <PianoRoll info={info} analysis={analysis} view={view} range={range} theme={theme}
                  playhead={transport.playhead} litMidi={litMidi} onSeek={seekTo} onView={setView}
                  onRange={setRange} onPreview={previewKey} />
              : <div className="pe-empty">Loading clip…</div>)}
        </div>

        {sideOpen &&
          <div className="pe-side">
            <div className="pe-sec">
              <div className="pe-sechd">VIEW</div>
              {zoomBtns("TIME",
                { fn: () => zoomTime(1 / 0.6), off: !zoomedTime },
                { fn: () => setView({ start: 0, dur }), off: !zoomedTime, title: "Fit the whole clip" },
                { fn: () => zoomTime(0.6), off: !info },
                "Time zoom — or Ctrl + wheel over the roll")}
              {zoomBtns("KEY",
                { fn: () => zoomPitch(1 / 0.7), off: peSpan(range) >= PITCH_MAX - PITCH_MIN },
                { fn: () => setRange(analysis ? peFitRange(analysis) : { lo: PITCH_MIN, hi: PITCH_MAX }),
                  off: false, title: analysis ? "Fit to the detected range" : "Show the full range" },
                { fn: () => zoomPitch(0.7), off: peSpan(range) <= MIN_SPAN },
                "Key zoom — vertical, or Alt + wheel over the roll")}
              <div className="pe-hint" style={{ marginTop: 9 }}>
                <kbd>Wheel</kbd> up / down · <kbd>Shift</kbd>+wheel left / right<br />
                <kbd>Ctrl</kbd>+wheel Time zoom · <kbd>Alt</kbd>+wheel Key zoom<br />
                <kbd>Middle-drag</kbd> to pan both axes
              </div>
            </div>

            <div className="pe-sec">
              <div className="pe-sechd">ANALYSIS</div>
              <button className="pe-btn pe-wide" onClick={runAnalyze} disabled={!info || busy}
                title="Detect the sung pitch across this clip" style={{ marginBottom: 9 }}>
                {busy ? `Analyzing… ${Math.round(progress * 100)}%` : (analysis ? "Re-analyze" : "Analyze")}
              </button>
              <div className="pe-stat">
                {note
                  ? note
                  : (analysis
                    // Voiced coverage is the honest headline number: it says how much of the
                    // clip the detector actually found a pitch in, which is what Stage C segments.
                    ? <>
                        <b>{(100 * analysis.voicedFrames / analysis.frames).toFixed(0)}%</b> voiced<br />
                        {analysis.frames} frames @ {Math.round(analysis.hopSec * 1000)} ms<br />
                        analysed in {(analysis.elapsedMs / 1000).toFixed(1)} s
                      </>
                    : "Press Analyze to detect the sung pitch.")}
              </div>
            </div>

            <div className="pe-sec" style={{ borderBottom: "none" }}>
              <div className="pe-sechd">CORRECTION</div>
              {/* Enabled by the stage that gives them meaning, so a half-wired button never
                  sits in front of the user. */}
              <button className="pe-btn pe-wide" disabled title="Note editing lands in Stage D"
                style={{ marginBottom: 7 }}>Snap all to key</button>
              <div className="pe-row">
                <button className="pe-btn primary" style={{ flex: 1 }} disabled
                  title="Rendering and printing land in Stage E">Apply</button>
                <button className="pe-btn" style={{ flex: 1 }} disabled
                  title="Available once a correction has been printed (Stage E)">Revert</button>
              </div>
            </div>


          </div>}
      </div>

      <div className="pe-footer">
        <span>
          {!info ? "—" : `${info.trackName || "track"} · clip at ${peFmtTime(info.start)} · click a key to hear it`
            + (analysis ? "" : " · press Analyze to detect pitch")}
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
