/* ================= FocusDAW — mixer window + output effect track ================= */

const AUDIO_INPUT_TEXTURES = {
  /* no pattern — just the recessed inner panel frame (concave side sheen) */
  none: {
    backgroundImage: "linear-gradient(90deg,rgba(255,255,255,.08) 0,rgba(0,0,0,.34) 6px,transparent 24%,transparent 76%,rgba(0,0,0,.34) calc(100% - 6px),rgba(255,255,255,.06) 100%)",
    backgroundSize: "auto",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  },
  /* full-cover diagonal grain; the recessed inner panel frames it to the border */
  diagonal: {
    backgroundImage: "linear-gradient(90deg,rgba(255,255,255,.08) 0,rgba(0,0,0,.34) 6px,transparent 24%,transparent 76%,rgba(0,0,0,.34) calc(100% - 6px),rgba(255,255,255,.06) 100%),repeating-linear-gradient(135deg,transparent 0 6px,rgba(0,0,0,.28) 6px 7px,color-mix(in srgb,var(--bg2) 72%,var(--bg) 28%) 7px 8.5px,transparent 8.5px 15px)",
    backgroundSize: "auto,auto",
    backgroundPosition: "center,center",
    backgroundRepeat: "no-repeat,no-repeat",
  },
  /* full-cover dot grid; the recessed inner panel frames it to the border */
  dots: {
    backgroundImage: "linear-gradient(90deg,rgba(255,255,255,.08) 0,rgba(0,0,0,.34) 6px,transparent 24%,transparent 76%,rgba(0,0,0,.34) calc(100% - 6px),rgba(255,255,255,.06) 100%),radial-gradient(circle,rgba(0,0,0,.24) 0 2px,transparent 2.8px)",
    backgroundSize: "auto,8px 8px",
    backgroundPosition: "center,center",
    backgroundRepeat: "no-repeat,repeat",
  },
  /* Dark brushed metal — full-panel diagonal grain (ref: _refer/DAW Mixer),
   * theme-tinted and darkened (surface mixed toward black). The opaque 115° metal
   * fills the strip; a concave side-sheen overlay adds depth. */
  brushed: {
    backgroundImage: "linear-gradient(90deg,rgba(255,255,255,.08) 0,rgba(0,0,0,.34) 6px,transparent 24%,transparent 76%,rgba(0,0,0,.34) calc(100% - 6px),rgba(255,255,255,.06) 100%),repeating-linear-gradient(115deg,var(--mixer-metal) 0px,color-mix(in srgb,var(--mixer-metal) 80%,#fff 20%) 2px,color-mix(in srgb,var(--mixer-metal) 82%,#000 18%) 3px,var(--mixer-metal) 5px)",
    backgroundSize: "auto,auto",
    backgroundPosition: "center,center",
    backgroundRepeat: "no-repeat,no-repeat",
  },
  /* full-cover ribbed lines; the recessed inner panel frames it to the border */
  edges: {
    backgroundImage: "linear-gradient(90deg,rgba(255,255,255,.08) 0,rgba(0,0,0,.34) 6px,transparent 24%,transparent 76%,rgba(0,0,0,.34) calc(100% - 6px),rgba(255,255,255,.06) 100%),repeating-linear-gradient(180deg,transparent 0 3px,rgba(0,0,0,.30) 3px 4px,color-mix(in srgb,var(--bg2) 78%,var(--bg) 22%) 4px 5px,transparent 5px 7px)",
    backgroundSize: "auto,auto",
    backgroundPosition: "center,center",
    backgroundRepeat: "no-repeat,no-repeat",
  },
};

/* ---------- channel strip ---------- */
const MIXER_CHANNEL_W = 92;
const MIXER_AUDIO_IN_CHANNEL_W = 138;

const ARM_BUTTON_BG = "linear-gradient(180deg,color-mix(in srgb,var(--input-gain-arm-button, #e33a48) 78%,#fff 22%) 0%,var(--input-gain-arm-button, #e33a48) 52%,color-mix(in srgb,var(--input-gain-arm-button, #e33a48) 76%,#000 24%) 100%)";
const ARM_BUTTON_SHADOW = "inset 0 1px 0 rgba(255,255,255,.36), inset 0 -2px 0 rgba(0,0,0,.28), 0 2px 4px rgba(0,0,0,.22), 0 0 8px color-mix(in srgb,var(--input-gain-arm-button, #e33a48) 38%,transparent)";
const AUDIO_INPUT_PORT_OPTIONS = [
  { label: "Input 1", channel: 0, stereo: false },
  { label: "Input 2", channel: 1, stereo: false },
  { label: "Input 1-2", channel: 0, stereo: true },
];
// Build the input-port list from the interface's real input channels, relayed
// from the main window via INIT_STATE/SYNC_STATE (the mixer window has no native
// bridge of its own). Mirrors buildInputPortOptions in ui-tracks.jsx so both
// selects show identical labels; falls back to the static list when no device
// channel names are known yet.
function buildInputPortOptions() {
  const names = window.DAW && window.DAW.getInputChannelNames ? window.DAW.getInputChannelNames() : [];
  const n = Array.isArray(names) ? names.length : 0;
  if (n < 1) return AUDIO_INPUT_PORT_OPTIONS;
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

function AudioInputButton({ active, children, title, onClick, activeBg = "var(--amber-soft)", activeColor = "var(--audio-input-button-active-fg, var(--amber))", activeBorder = "var(--amber-deep)", activeShadow = "none" }) {
  return (
    <button title={title} onClick={onClick}
      style={{ flex: 1, minWidth: 0, height: 21, borderRadius: 5, padding: "0 4px",
        fontSize: 8.5, fontWeight: 800, letterSpacing: ".04em",
        background: active ? activeBg : "rgba(0,0,0,.14)",
        color: active ? activeColor : "var(--audio-input-button-fg, var(--muted))",
        border: "1px solid " + (active ? activeBorder : "var(--line-strong)"),
        boxShadow: active ? activeShadow : "inset 0 1px 0 rgba(255,255,255,.05)",
        transform: active ? "translateY(1px)" : "none" }}>
      {children}
    </button>
  );
}

/* ---------- combined LED-ring input meter + gain knob ----------
 * Outer dashed LED ring = live input level (green→amber→red); the dark-metal
 * knob body rotates to set input gain (drag vertically, dbl-click = unity,
 * wheel = ±0.1). Design ref: assets/knob design/led knob-4.html */
const GAIN_MIN = 0.1, GAIN_MAX = 4, GAIN_SWEEP = 270, GAIN_START = -135;
function InputGainKnob({ value, active, onChange, onBeforeChange, size = 80 }) {
  const ref = useRef(null);
  const gain = Math.max(GAIN_MIN, Math.min(GAIN_MAX, value));
  const norm = (gain - GAIN_MIN) / (GAIN_MAX - GAIN_MIN);
  const ang = GAIN_START + norm * GAIN_SWEEP;           // indicator + rim-arc angle

  const drag = useRef(null);
  const onDown = (e) => {
    e.preventDefault();
    if (onBeforeChange) onBeforeChange();
    drag.current = { y: e.clientY, v: gain };
    const move = (ev) => {
      const dy = drag.current.y - ev.clientY;
      let nv = drag.current.v + (dy / 160) * (GAIN_MAX - GAIN_MIN);
      nv = Math.round(Math.max(GAIN_MIN, Math.min(GAIN_MAX, nv)) * 10) / 10;
      onChange(nv);
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  useWheelStep(ref, (dir) => {
    let nv = Math.round((gain + dir * 0.1) * 10) / 10;
    nv = Math.max(GAIN_MIN, Math.min(GAIN_MAX, nv));
    if (nv === gain) return;
    if (onBeforeChange) onBeforeChange();
    onChange(nv);
  });
  const onDbl = () => { if (onBeforeChange) onBeforeChange(); onChange(1); };

  // viewBox is 100×100; convert (radius, angle°) → point. 0°=up, clockwise.
  const C = 50;
  const pol = (r, a) => { const t = (a - 90) * Math.PI / 180; return [C + r * Math.cos(t), C + r * Math.sin(t)]; };
  const SEGS = 42;
  const ticks = [];
  for (let i = 0; i < SEGS; i++) {
    const f = i / (SEGS - 1);
    const on = f <= norm + 1e-6;         // rim now fills to the gain value (single soft color)
    const a = GAIN_START + f * GAIN_SWEEP;
    const [x1, y1] = pol(40, a), [x2, y2] = pol(46, a);
    // thin lit ticks with a soft glow; light themes can override this for contrast.
    ticks.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={on ? "var(--input-gain-led, var(--dim))" : "var(--line-strong)"} strokeOpacity={on ? 1 : 0.9}
      strokeWidth={on ? 1.4 : 1.2} strokeLinecap="round"
      style={on ? { filter: "drop-shadow(0 0 2.5px var(--input-gain-led-glow, rgba(255,255,255,.6))) drop-shadow(0 0 1px var(--input-gain-led, var(--dim)))" } : undefined} />);
  }
  const [inx, iny] = pol(33, ang);     // indicator notch — outer, on the knob skirt
  const [ibx, iby] = pol(28, ang);     // indicator notch — inner

  return (
    <div ref={ref} onMouseDown={onDown} onDoubleClick={onDbl}
      title="Input gain · drag to set · dbl-click = unity"
      style={{ width: size, height: size, cursor: "ns-resize", position: "relative", userSelect: "none" }}>
      <svg width={size} height={size} viewBox="0 0 100 100">
        <defs>
          {/* main body metal — theme-tinted but darkened (mixed toward black) */}
          <radialGradient id="igkMetal" cx="50%" cy="50%" r="52%" fx="34%" fy="30%">
            <stop offset="0%" stopColor="color-mix(in srgb, var(--surface2) 66%, #000 34%)" />
            <stop offset="40%" stopColor="color-mix(in srgb, var(--bg2) 70%, #000 30%)" />
            <stop offset="100%" stopColor="color-mix(in srgb, var(--bg) 52%, #000 48%)" />
          </radialGradient>
          {/* center cap — darkened theme-tinted metal dome */}
          <radialGradient id="igkCap" cx="50%" cy="33%" r="74%">
            <stop offset="0%" stopColor="color-mix(in srgb, var(--surface2) 64%, #000 36%)" />
            <stop offset="30%" stopColor="color-mix(in srgb, var(--bg2) 64%, #000 36%)" />
            <stop offset="62%" stopColor="color-mix(in srgb, var(--bg) 55%, #000 45%)" />
            <stop offset="100%" stopColor="#050505" />
          </radialGradient>
          <linearGradient id="igkSheen" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
            <stop offset="48%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.40" />
          </linearGradient>
          {/* glossy specular reflection near the top of the cap */}
          <radialGradient id="igkSpec" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          {/* tight falloff glows for the armed state */}
          <filter id="igkGlowOuter" x="-34%" y="-34%" width="168%" height="168%">
            <feGaussianBlur stdDeviation="1.65" />
          </filter>
          <filter id="igkGlowCore" x="-24%" y="-24%" width="148%" height="148%">
            <feGaussianBlur stdDeviation="1.05" />
          </filter>
        </defs>
        {/* bezel / recessed housing — darkened theme tint */}
        <circle cx="50" cy="50" r="47" fill="color-mix(in srgb, var(--bg) 46%, #000 54%)" stroke="var(--line-strong)" strokeWidth="0.6" />
        <circle cx="50" cy="50" r="43.5" fill="none" stroke="rgba(0,0,0,.5)" strokeWidth="2.5" />
        {/* rim ring — soft single-color arc showing the gain amount */}
        {ticks}
        {/* knob shadow + body */}
        <ellipse cx="50" cy="52.5" rx="34" ry="34" fill="#000" opacity="0.5" />
        <circle cx="50" cy="50" r="34" fill="url(#igkMetal)" stroke="var(--line-strong)" strokeWidth="0.5" />
        <circle cx="50" cy="50" r="34" fill="url(#igkSheen)" />
        {/* armed: strong true-red halo glowing outward from the center cap */}
        {active && <>
          <circle cx="50" cy="50" r="29" fill="none" stroke="var(--input-gain-arm-glow-outer, #c9001b)" strokeWidth="1.9" opacity="0.5" filter="url(#igkGlowOuter)" />
          <circle cx="50" cy="50" r="27" fill="none" stroke="var(--input-gain-arm-glow-core, #ff1730)" strokeWidth="3.8" opacity="0.98" filter="url(#igkGlowCore)" />
        </>}
        {/* center cap — brushed metal dome */}
        <circle cx="50" cy="50" r="27" fill="url(#igkCap)" stroke="var(--line-strong)" strokeWidth="0.5" />
        <circle cx="50" cy="50" r="27" fill="url(#igkSheen)" opacity="0.6" />
        <ellipse cx="50" cy="40" rx="12" ry="5.5" fill="url(#igkSpec)" opacity="0.55" />
        <circle cx="50" cy="50" r="22.5" fill="none" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="0.6" />
        {/* gain indicator — white notch on the knob skirt */}
        <line x1={ibx} y1={iby} x2={inx} y2={iny} stroke="rgba(255,255,255,.92)" strokeWidth="2.6" strokeLinecap="round"
          style={{ filter: "drop-shadow(0 0 2px rgba(255,255,255,.6))" }} />
        {/* center pivot hub */}
        <circle cx="50" cy="50" r="3.4" fill="color-mix(in srgb, var(--bg) 40%, #000 60%)" stroke="var(--line-strong)" strokeWidth="0.5" />
        <circle cx="50" cy="48.7" r="1.2" fill="#ffffff" opacity="0.16" />
      </svg>
    </div>
  );
}

/* input-level LED meter — explicit green → yellow → red steps (theme-independent) */
function InputLevelMeter({ level, height = 80, width = 7 }) {
  const gap = 1.5;
  const segs = Math.max(6, Math.min(22, Math.round((height - gap) / 3.5)));
  const lit = Math.round((level || 0) * segs);
  const cells = [];
  for (let i = 0; i < segs; i++) {
    const frac = i / segs;
    const on = i < lit;
    let col = "#5ec46a";                     // green
    if (frac > 0.82) col = "#e0574a";        // red
    else if (frac > 0.60) col = "#e8c53c";   // yellow
    cells.push(<div key={i} style={{ flex: 1, minHeight: 1, background: on ? col : "rgba(0,0,0,.34)",
      borderRadius: 1, opacity: on ? 1 : 0.85, boxShadow: on ? `0 0 4px ${col}` : "none", transition: "opacity .05s" }} />);
  }
  return <div style={{ display: "flex", flexDirection: "column-reverse", gap, width, height }}>{cells}</div>;
}

// Limiter gain-reduction meter: hangs DOWN from the top (0 dB at top), amber for
// light reduction deepening to red. gr is a positive dB amount, mapped over 0..12 dB.
function InputGrMeter({ gr, height = 80, width = 7 }) {
  const gap = 1.5;
  const segs = Math.max(6, Math.min(22, Math.round((height - gap) / 3.5)));
  const frac = Math.max(0, Math.min(1, (gr || 0) / 12));
  const lit = Math.round(frac * segs);
  const cells = [];
  for (let i = 0; i < segs; i++) {
    const on = i < lit;                       // light from the top down
    const f = i / segs;
    let col = "#e0a23a";                       // amber (shallow reduction)
    if (f > 0.66) col = "#e0574a";             // red (heavy reduction)
    else if (f > 0.33) col = "#e8963c";
    cells.push(<div key={i} style={{ flex: 1, minHeight: 1, background: on ? col : "rgba(0,0,0,.34)",
      borderRadius: 1, opacity: on ? 1 : 0.85, boxShadow: on ? `0 0 4px ${col}` : "none", transition: "opacity .05s" }} />);
  }
  return <div style={{ display: "flex", flexDirection: "column", gap, width, height }}>{cells}</div>;
}

function AudioInputControls({ track, inputLevel, inputGr = 0, onParam, onBeforeChange }) {
  const p = track.params || {};
  const inputGain = Math.max(0.1, Math.min(4, p.inputGain == null ? 1 : p.inputGain));
  const armed = !!p.arm;
  const liveLevel = armed || track.recording ? Math.max(0, Math.min(1, inputLevel || 0)) : 0;
  const hot = liveLevel >= .92;
  // Limiter gain reduction (positive dB), only while armed/recording with LIM on.
  const armedGr = (armed || track.recording) && p.limiter !== false ? Math.max(0, inputGr || 0) : 0;
  const commit = (k, v) => { onBeforeChange && onBeforeChange(); onParam(k, v); };
  const inputChannel = Math.max(0, Number.isFinite(+p.inputChannel) ? +p.inputChannel : 0);
  const inputStereo = !!p.inputStereo;
  const inputPortValue = `${inputStereo ? "stereo" : "mono"}:${inputChannel}`;
  const commitInputPort = (value) => {
    const [mode, ch] = String(value || "mono:0").split(":");
    const nextChannel = Math.max(0, Number(ch) || 0);
    const nextStereo = mode === "stereo";
    onBeforeChange && onBeforeChange();
    onParam("inputChannel", nextChannel);
    onParam("inputStereo", nextStereo);
  };

  return (
    <div style={{ width: "100%", display: "grid", gap: 5, padding: "6px 7px",
      borderRadius: 7, background: "rgba(0,0,0,.16)", border: "1px solid var(--line)" }}>
      <div style={{ display: "flex", gap: 4 }}>
        <AudioInputButton active={armed} title="Arm this input track for recording"
          activeBg={ARM_BUTTON_BG} activeColor="var(--arm-on-fg, #0d0d0d)" activeBorder="color-mix(in srgb,var(--input-gain-arm-button, #e33a48) 68%,#000 32%)" activeShadow={ARM_BUTTON_SHADOW}
          onClick={() => commit("arm", !p.arm)}>ARM</AudioInputButton>
        <AudioInputButton active={!!p.monitor} title="Monitor this input while recording"
          onClick={() => commit("monitor", !p.monitor)}>MON</AudioInputButton>
        <AudioInputButton active={p.limiter !== false} title="Input limiter · ceiling -1.0 dBFS"
          onClick={() => commit("limiter", p.limiter === false)}>LIM</AudioInputButton>
      </div>
      <select className="audio-input-port-select" value={inputPortValue} title="Input port for this Audio In track"
        onChange={(e) => commitInputPort(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "100%", height: 23, borderRadius: 5, padding: "0 6px",
          background: "var(--audio-input-port-bg, var(--surface2))",
          color: "var(--audio-input-port-fg, var(--cream-2))", border: "1px solid var(--line-strong)",
          fontSize: 10.5, fontWeight: 650, outline: "none" }}>
        {buildInputPortOptions().map((opt) => (
          <option key={`${opt.stereo ? "stereo" : "mono"}:${opt.channel}`} value={`${opt.stereo ? "stereo" : "mono"}:${opt.channel}`}
            style={{ background: "var(--bg)", color: "var(--cream)" }}>
            {opt.label}
          </option>
        ))}
      </select>
      <div style={{ display: "flex", alignItems: "flex-start", padding: "2px 0 1px" }}>
        {/* Input-gain knob, centered in the space left of the meters, with a 2-row GAIN
            readout (label on top, value below). The knob column is a fixed 64px so the value's
            digit count can't shift it, and the meters stay pinned right regardless of the value. */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center" }}>
          <div style={{ display: "grid", justifyItems: "center", gap: 3, width: 64 }}>
            <InputGainKnob value={inputGain} active={armed || track.recording} size={64}
              onChange={(v) => onParam("inputGain", v)} onBeforeChange={onBeforeChange} />
            <div style={{ display: "grid", justifyItems: "center", gap: 1, whiteSpace: "nowrap" }} title={`Input gain ${fmtDb(inputGain)} dB`}>
              <span style={{ fontSize: 8, color: "var(--muted)", fontWeight: 700, letterSpacing: ".1em" }}>GAIN</span>
              <span className="mono" style={{ fontSize: 9.5, color: "var(--cream-2)" }}>{fmtDb(inputGain)} dB</span>
            </div>
          </div>
        </div>
        {/* IN + GR meters grouped and pinned to the right edge */}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flex: "0 0 auto" }}>
          {/* live input-level LED meter (green→yellow→red) */}
          <div style={{ display: "grid", justifyItems: "center", gap: 3 }}>
            <InputLevelMeter level={liveLevel} height={80} width={7} />
            <span className="mono" title="Live input level" style={{ fontSize: 8, fontWeight: 400, letterSpacing: ".06em",
              color: hot ? "var(--red)" : liveLevel > 0 ? "var(--green)" : "var(--dim)" }}>IN</span>
          </div>
          {/* limiter gain-reduction meter (right of IN) */}
          <div style={{ display: "grid", justifyItems: "center", gap: 3 }}>
            <InputGrMeter gr={armedGr} height={80} width={7} />
            <span className="mono" title={`Limiter gain reduction ${armedGr.toFixed(1)} dB`} style={{ fontSize: 8, fontWeight: 400, letterSpacing: ".06em",
              color: armedGr > 6 ? "var(--red)" : armedGr > 0.3 ? "var(--amber)" : "var(--dim)" }}>GR</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChannelStrip({ track, level, texture = "none", onParam, onBeforeChange }) {
  const p = track.params;
  const isAudioIn = track.kind === "audioIn";
  const noAudio = !!track.needsAudio;
  const faderAreaRef = useRef(null);
  const [faderH, setFaderH] = useState(120);
  const textureStyle = isAudioIn ? (AUDIO_INPUT_TEXTURES[texture] || AUDIO_INPUT_TEXTURES.none) : null;
  // audio-in channel tint follows the theme accent (var(--blue)) and sits on a
  // darkened base (bg2 → bg) so the strip reads dark & theme-matched
  const audioInputNoneBg = "linear-gradient(180deg,color-mix(in srgb,var(--blue) 12%,transparent),color-mix(in srgb,var(--blue) 4%,transparent)),linear-gradient(180deg,var(--bg2),var(--bg))";
  const audioInputTexturedBg = "linear-gradient(180deg,color-mix(in srgb,var(--blue) 4%,transparent),color-mix(in srgb,var(--blue) 1%,transparent)),linear-gradient(180deg,var(--bg2),var(--bg))";
  const audioInputCapBg = "linear-gradient(180deg,rgba(255,255,255,.055) 0,rgba(255,255,255,.025) 4px,rgba(0,0,0,.09) 11px,transparent 24%,transparent 76%,rgba(0,0,0,.11) calc(100% - 11px),rgba(255,255,255,.025) calc(100% - 4px),rgba(255,255,255,.05) 100%)";
  const audioInputBaseBg = texture === "none" ? audioInputNoneBg : audioInputTexturedBg;
  const textureCapBg = textureStyle && textureStyle.capImage ? `${textureStyle.capImage},${textureStyle.capImage},` : "";
  const textureCapSize = textureStyle && textureStyle.capSize ? `${textureStyle.capSize},` : "";
  const textureCapPosition = textureStyle && textureStyle.capPosition ? `${textureStyle.capPosition},` : "";
  const textureCapRepeat = textureStyle && textureStyle.capRepeat ? `${textureStyle.capRepeat},` : "";
  const audioInputBg = textureStyle ? `${textureStyle.backgroundImage}, ${textureCapBg} ${audioInputCapBg}, ${audioInputBaseBg}` : undefined;
  const audioInputBgSize = textureStyle ? `${textureStyle.backgroundSize}, ${textureCapSize} auto, auto` : undefined;
  const audioInputBgPosition = textureStyle ? `${textureStyle.backgroundPosition}, ${textureCapPosition} center, center` : undefined;
  const audioInputBgRepeat = textureStyle ? `${textureStyle.backgroundRepeat}, ${textureCapRepeat} no-repeat, no-repeat` : undefined;
  // Every audio-in texture now fills the whole strip. To keep the texture on the
  // border only, we lay a recessed inner panel over the middle (texture shows
  // through as a frame), engraved with an inset shadow. It sits above the texture
  // background but below the controls (z-index:-1 in the channel's own stacking
  // context). The panel fill is kept slightly translucent (~84%) so the texture
  // beneath still faintly reads through the centre.
  const framePanel = isAudioIn;
  const framePanelBg = "linear-gradient(180deg,color-mix(in srgb,var(--blue) 4%,transparent),color-mix(in srgb,var(--blue) 1%,transparent)),linear-gradient(180deg,color-mix(in srgb,var(--bg2) 84%,transparent),color-mix(in srgb,var(--bg) 84%,transparent))";
  useEffect(() => {
    const el = faderAreaRef.current; if (!el) return;
    const obs = new ResizeObserver(([e]) => setFaderH(Math.max(40, Math.floor(e.contentRect.height))));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div style={{ width: isAudioIn ? MIXER_AUDIO_IN_CHANNEL_W : MIXER_CHANNEL_W, flex: `0 0 ${isAudioIn ? MIXER_AUDIO_IN_CHANNEL_W : MIXER_CHANNEL_W}px`, height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", alignItems: "center",
      padding: "10px 6px", borderRight: "1px solid var(--line)", gap: 8,
      position: "relative", overflow: "hidden", isolation: isAudioIn ? "isolate" : undefined,
      background: isAudioIn ? "var(--bg)" : p.solo ? "rgba(232,176,75,.05)" : "transparent",
      backgroundImage: isAudioIn ? audioInputBg : undefined,
      backgroundSize: isAudioIn ? audioInputBgSize : undefined,
      backgroundPosition: isAudioIn ? audioInputBgPosition : undefined,
      backgroundRepeat: isAudioIn ? audioInputBgRepeat : undefined }}>
      {framePanel && <div aria-hidden="true" style={{ position: "absolute", inset: 9, borderRadius: 10, zIndex: -1, pointerEvents: "none",
        background: framePanelBg,
        boxShadow: "inset 0 2px 8px rgba(0,0,0,.55), inset 0 -2px 6px rgba(0,0,0,.32), inset 0 0 0 1px rgba(0,0,0,.45), 0 1px 0 rgba(255,255,255,.05)" }} />}
      <div style={{ height: 3, width: "70%", borderRadius: 2, background: track.color, boxShadow: `0 0 8px ${track.color}` }} />
      <div style={{ fontSize: 11.5, fontWeight: 600, textAlign: "center", height: 28, overflow: "hidden", lineHeight: 1.1 }}>{track.name}</div>
      {/* FX knobs — data-fx tags let a track-header VRB/ECHO click (FOCUS_KNOB msg) locate & pulse them */}
      <div style={{ display: "flex", gap: 4 }}>
        <div data-track-id={track.id} data-fx="reverb" style={{ borderRadius: 10 }}>
          <Knob value={p.reverb} size={28} color="var(--violet)" label="VRB" onBeforeChange={onBeforeChange} onChange={(v) => onParam("reverb", v)} />
        </div>
        <div data-track-id={track.id} data-fx="echo" style={{ borderRadius: 10 }}>
          <Knob value={p.echo} size={28} color="var(--blue)" label="ECHO" onBeforeChange={onBeforeChange} onChange={(v) => onParam("echo", v)} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 5 }}>
        <SoloBtn on={p.solo} disabled={noAudio} size={22} onClick={() => { onBeforeChange && onBeforeChange(); onParam("solo", !p.solo); }} />
        <MuteBtn on={p.mute} auto={DAW._anySolo() && !p.solo} disabled={noAudio} size={22} onClick={(e) => {
          onBeforeChange && onBeforeChange();
          if (e && e.shiftKey && track.kind === "file" && DAW.muteAllFileTracks) DAW.muteAllFileTracks(!p.mute);
          else onParam("mute", !p.mute);
        }} />
      </div>
      <Knob value={p.pan} min={-1} max={1} size={26} color="var(--pan-arc, var(--cream-2))" label="PAN"
        onBeforeChange={onBeforeChange}
        onChange={(v) => onParam("pan", v)} format={(v) => (Math.abs(v) < 0.02 ? "C" : (v < 0 ? "L" : "R") + Math.round(Math.abs(v) * 100))} />
      {/* fader + meter — flex:1 fills remaining height */}
      <div ref={faderAreaRef} style={{ display: "flex", gap: 6, alignItems: "flex-end", flex: 1, minHeight: 0, justifyContent: "center" }}>
        <Fader value={p.volume} height={faderH} max={2} scale="linear" onBeforeChange={onBeforeChange} onChange={(v) => onParam("volume", v)} />
        <Meter level={level} height={faderH} width={7} />
      </div>
      <div className="mono" style={{ fontSize: 9.5, color: "var(--cream-2)" }}>{fmtDb(p.volume)} dB</div>
      {isAudioIn && <AudioInputControls track={track} inputLevel={DAW.getInputLevel ? DAW.getInputLevel() : 0} inputGr={DAW.getInputGainReduction ? DAW.getInputGainReduction() : 0} onParam={onParam} onBeforeChange={onBeforeChange} />}
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
function MasterEQ({ width = 320, height = 156, onBeforeChange }) {
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
    onBeforeChange && onBeforeChange();
    const move = (ev) => {
      const r = ref.current.getBoundingClientRect();
      DAW.setMasterBand(i, Math.round(yToGain(ev.clientY - r.top) * 10) / 10);
      force((n) => n + 1);
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const resetBand = (i) => (e) => { e.preventDefault(); e.stopPropagation(); onBeforeChange && onBeforeChange(); DAW.setMasterBand(i, 0); force((n) => n + 1); };

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

  // Currently-selected EQ name (engine master.eqPreset). On manual deviation from flat
  // (no named preset) show a breathing "custom"; on reset/flat show nothing.
  const presetName = DAW.master.eqPreset;
  const bandsFlat = bands.every((b) => Math.abs(b || 0) < 0.05);
  let presetLabel = null, nameCustom = false;
  if (presetName) presetLabel = (EQ_PRESET_BTNS.find(([, n]) => n === presetName) || [presetName])[0];
  else if (!bandsFlat) { presetLabel = "custom"; nameCustom = true; }

  return (
    <div style={{ width, position: "relative" }}>
      {presetLabel && (
        <div style={{ position: "absolute", top: 6, right: 8, zIndex: 2, pointerEvents: "none",
          fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: ".08em",
          color: "var(--amber)", textTransform: "uppercase", opacity: .92,
          textShadow: "0 1px 3px rgba(0,0,0,.6)",
          animation: nameCustom ? "eq-flash 1s steps(1,end) infinite" : "none" }}>{presetLabel}</div>
      )}
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

function MasterEQOverlay({ width = 300, height = 156, onBeforeChange }) {
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
    onBeforeChange && onBeforeChange();
    const move = (ev) => {
      const r = ref.current.getBoundingClientRect();
      DAW.setMasterBand(i, Math.round(yToGain(ev.clientY - r.top) * 10) / 10);
      force((n) => n + 1);
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const resetBand = (i) => (e) => { e.preventDefault(); e.stopPropagation(); onBeforeChange && onBeforeChange(); DAW.setMasterBand(i, 0); force((n) => n + 1); };

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

function MasterLevelMeter({ width = 300, height = 156, onBeforeChange }) {
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
      <MasterEQOverlay width={width} height={height} onBeforeChange={onBeforeChange} />
    </div>
  );
}

/* ---------- mini EQ graph (output track header) ----------
   `gray` = the EFFECT bypass is active: draw the curve in gray so the header
   shows at a glance that the EQ is not being applied. */
function MiniEQGraph({ width = 116, height = 30, gray = false }) {
  const bands = DAW.master.bands;
  const fmin = 30, fmax = 18000;
  const freqToX = (f) => (Math.log(f / fmin) / Math.log(fmax / fmin)) * width;
  const gainToY = (g) => height / 2 - (g / 12) * (height / 2 - 2);
  const FQ = DAW.EQ_FREQS;
  const pts = FQ.map((f, i) => [freqToX(f), gainToY(bands[i])]);
  const curveP = [[0, gainToY(bands[0])], ...pts, [width, gainToY(bands[8])]];
  const eqLine = smoothPath(curveP);
  const zeroY = gainToY(0);
  const isFlat = bands.every(b => Math.abs(b) < 0.1);
  const fill = gray ? (isFlat ? "rgba(160,160,160,.04)" : "rgba(160,160,160,.12)")
                    : (isFlat ? "rgba(232,176,75,.04)" : "rgba(232,176,75,.14)");
  const stroke = gray ? (isFlat ? "rgba(160,160,160,.28)" : "rgba(160,160,160,.75)")
                      : (isFlat ? "rgba(232,176,75,.28)" : "var(--amber)");
  return (
    <svg width={width} height={height} style={{ display: "block", flexShrink: 0, borderRadius: 5,
      background: "var(--eq-graph-bg, rgba(0,0,0,.32))", overflow: "hidden" }}>
      <line x1="0" y1={zeroY} x2={width} y2={zeroY} stroke="rgba(232,212,170,.15)" strokeWidth="1" />
      <path d={`${eqLine} L${width} ${zeroY} L0 ${zeroY} Z`} fill={fill} />
      <path d={eqLine} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

/* ---------- fx on/off chip-button (REV / WIDE bypass toggle) ---------- */
function FxChip({ label, active, color, onClick, canEnable = true }) {
  return (
    <button onClick={onClick} onMouseDown={(e) => e.preventDefault()}
      title={`${label} ${active ? "ON — click to bypass" : canEnable ? "OFF — click to enable" : "OFF — set amount in mixer to enable"}`}
      style={{ height: 30, padding: "0 7px", borderRadius: 5, display: "flex", alignItems: "center",
      flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: ".06em", cursor: active || canEnable ? "pointer" : "default", outline: "none",
      background: active ? color : "rgba(0,0,0,.28)",
      color: active ? "var(--accent-fg)" : "var(--outfx-chip-off-fg, var(--faint))",
      border: "1px solid " + (active ? color : "rgba(232,212,170,.08)"),
      boxShadow: active ? `0 0 8px ${color}88` : "none",
      transition: "background .2s, color .2s, border-color .2s, box-shadow .2s" }}>
      {label}
    </button>
  );
}

/* ---------- master effect card ----------
   Icon doubles as an on/off (bypass) button. The slider amount is remembered in
   `<paramKey>Stored` on the master object so toggling off→on instantly restores it. */
function FxCard({ icon, name, paramKey, color, master, onMaster, onBeforeChange, sliderWidth = 120 }) {
  const value = master[paramKey] || 0;
  const on = value > 0.001;
  const storedKey = paramKey + "Stored";
  const stored = master[storedKey];
  // off but re-enableable: stored amount exists. False only when the user zeroed
  // the slider (stored cleared to 0) — then the button is intentionally a no-op.
  const canEnable = stored === undefined || stored > 0.001;
  const toggle = (e) => {
    e.currentTarget.blur();
    if (on) {
      onBeforeChange && onBeforeChange();
      onMaster(storedKey, value); // remember current amount before bypassing
      onMaster(paramKey, 0);
    } else if (canEnable) {
      onBeforeChange && onBeforeChange();
      onMaster(paramKey, stored === undefined ? 0.4 : stored);
    }
    // off & !canEnable → no-op: user set the slider to 0, so there is nothing to restore
  };
  const setAmount = (v) => {
    onMaster(paramKey, v);
    if (v <= 0.001) onMaster(storedKey, 0); // zeroing the slider clears the remembered amount
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 9,
      background: on ? "rgba(255,255,255,.03)" : "rgba(255,255,255,.012)", border: "1px solid " + (on ? "var(--line-strong)" : "var(--line)") }}>
      <button onClick={toggle} onMouseDown={(e) => e.preventDefault()}
        title={`${name} ${on ? "ON — click to bypass" : canEnable ? "OFF — click to enable" : "OFF — raise the slider to enable"}`}
        style={{ width: 28, height: 28, borderRadius: 7, display: "grid", placeItems: "center", flex: "0 0 auto",
          cursor: on || canEnable ? "pointer" : "default", padding: 0, outline: "none",
          background: on ? color : "var(--surface2)", color: on ? "#15110b" : "var(--muted)",
          border: "1px solid " + (on ? color : "var(--line-strong)"),
          boxShadow: on ? `0 0 8px ${color}66` : "none", transition: "background .15s, color .15s, box-shadow .15s" }}>
        <Icon name={icon} size={15} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: on ? "var(--cream)" : "var(--dim)" }}>{name}</div>
        <SleekSlider value={value} min={0} max={1} step={0.01} onBeforeChange={onBeforeChange} onChange={setAmount} width={sliderWidth} ticks={4} />
      </div>
      <span className="mono" style={{ fontSize: 10, color: on ? "var(--cream-2)" : "var(--faint)", width: 30, textAlign: "right" }}>{Math.round(value * 100)}%</span>
    </div>
  );
}

/* ---------- master panel (wide) ---------- */
const EQ_PRESET_BTNS = [
  ["Reset", "Flat", "var(--dim)"],
  ["POP", "Pop", "var(--amber)"],
  ["Classic", "Classic", "var(--blue)"],
  ["HIP HOP", "HipHop", "var(--violet)"],
];
function MasterPanel({ level, master, onMaster, onBeforeChange, onOpenAdvancedPan }) {
  const [view, setView] = useState("eq");
  const [, force] = useState(0);
  const stereo = DAW.getMasterStereoLevels ? DAW.getMasterStereoLevels() : { l: level, r: level };
  const applyPreset = (name) => { onBeforeChange && onBeforeChange(); DAW.applyEQPreset(name); force((n) => n + 1); };
  return (
    <div style={{ width: 400, flex: "0 0 400px", display: "flex", flexDirection: "column", padding: "12px 14px", gap: 11,
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
          {view === "eq" ? <MasterEQ width={300} height={156} onBeforeChange={onBeforeChange} /> : <MasterLevelMeter width={300} height={156} onBeforeChange={onBeforeChange} />}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 9, color: "var(--muted)", fontWeight: 600, letterSpacing: ".08em" }}>VOL</span>
          <div style={{ display: "flex", gap: 5, alignItems: "flex-end" }}>
            <Fader value={master.volume} height={132} max={2} scale="linear" color="var(--amber)" onBeforeChange={onBeforeChange} onChange={(v) => onMaster("volume", v)} />
            <Meter level={stereo.l} height={132} width={7} />
            <Meter level={stereo.r} height={132} width={7} />
          </div>
        </div>
      </div>

      {/* EQ presets */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em", color: "var(--muted)" }}>EQ&nbsp;PRESET</span>
        {EQ_PRESET_BTNS.map(([lbl, name, col]) => (
          <button key={name} onClick={(e) => { applyPreset(name); e.currentTarget.blur(); }} title={`Apply ${lbl} EQ`}
            style={{ flex: 1, padding: "5px 0", borderRadius: 7, background: "rgba(255,255,255,.02)",
              border: "1px solid var(--line)", color: "var(--dim)", fontSize: 10, fontWeight: 600,
              letterSpacing: ".04em", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              outline: "none" }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = col; e.currentTarget.style.color = "var(--cream)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; e.currentTarget.style.color = "var(--dim)"; }}>
            <span style={{ width: 6, height: 6, borderRadius: 2, background: col }} />
            {lbl}
          </button>
        ))}
      </div>

      {/* effects */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: "var(--muted)", textTransform: "uppercase" }}>Output Effects</span>
        <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
        <button onClick={(e) => { onOpenAdvancedPan && onOpenAdvancedPan(); e.currentTarget.blur(); }} className="chip"
          style={{ fontSize: 9, cursor: "pointer", color: "var(--amber)", background: "var(--amber-soft)", border: "1px solid var(--line)" }}>
          Advanced
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
        <FxCard icon="disc" name="Reverb" paramKey="reverb" color="var(--violet)" master={master} onMaster={onMaster} onBeforeChange={onBeforeChange} sliderWidth={64} />
        <FxCard icon="loop" name="Delay" paramKey="echo" color="var(--blue)" master={master} onMaster={onMaster} onBeforeChange={onBeforeChange} sliderWidth={64} />
        <FxCard icon="wave" name="Saturation" paramKey="saturation" color="var(--red)" master={master} onMaster={onMaster} onBeforeChange={onBeforeChange} sliderWidth={64} />
        <FxCard icon="auto" name="Widener" paramKey="widener" color="var(--amber)" master={master} onMaster={onMaster} onBeforeChange={onBeforeChange} sliderWidth={64} />
        <div style={{ gridColumn: "span 2" }}>
          <FxCard icon="eq" name="Exciter / Enhancer" paramKey="exciter" color="var(--green)" master={master} onMaster={onMaster} onBeforeChange={onBeforeChange} sliderWidth={250} />
        </div>
      </div>
    </div>
  );
}

/* ---------- mixer window (floating, OS-style) ---------- */
function MixerWindow({ onClose, onBeforeChange }) {
  useTick();
  const masterW = 400;
  const bodyW = DAW.tracks.reduce((sum, track) => sum + (track.kind === "audioIn" ? MIXER_AUDIO_IN_CHANNEL_W : MIXER_CHANNEL_W), 0) + masterW;
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
        background: "var(--mixer-bar-bg)", borderBottom: "1px solid var(--line)", cursor: "grab" }}>
        <Icon name="mixer" size={15} style={{ color: "var(--mixer-bar-fg)", marginLeft: 4 }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mixer-bar-fg)" }}>Mixer</span>
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
          {/* file tracks first (creation order), audio-in tracks grouped last — stable sort */}
          {[...DAW.tracks].sort((a, b) => (a.kind === "audioIn" ? 1 : 0) - (b.kind === "audioIn" ? 1 : 0)).map((t) => <ChannelStrip key={t.id} track={t} level={DAW.getTrackLevel(t.id)} onParam={param(t.id)} onBeforeChange={onBeforeChange} />)}
        </div>
        <MasterPanel level={DAW.getMasterLevel()} master={DAW.master} onMaster={(k, v) => DAW.setMaster(k, v)} onBeforeChange={onBeforeChange} />
      </div>
    </div>
  );
}

/* ---------- output effect track (master fade + EQ overlay on timeline) ---------- */
function OutputTrack({ pxPerSec, laneH, playhead, onSeek, onOpenMixer, onBeforeChange, onClearMuteSolo }) {
  useTick();
  const laneW = Math.max(1, DAW.duration * pxPerSec);
  const m = DAW.master;
  // EFFECT = temporary bypass of ALL master effects (EQ + the Ambience-window fx;
  // Spatial Field / volume / fades excluded) for A/B comparison. Node-level only —
  // master state, undo history and project data stay untouched.
  const fxOn = !DAW.masterFxBypassed;
  const toggleAllFx = () => DAW.setMasterFxBypass(fxOn);
  // Fixed effect buttons shown under the EQ graph. Amount > 0 = applied.
  // Colors match each effect's FxCard icon background in the mixer (MasterPanel).
  const fxBadges = [
    ["R", "Reverb", "reverb", m.reverb > 0.001, "var(--violet)"],
    ["D", "Delay", "echo", m.echo > 0.001, "var(--blue)"],
    ["S", "Saturation", "saturation", m.saturation > 0.001, "var(--red)"],
    ["W", "Widener", "widener", m.widener > 0.001, "var(--amber)"],
    ["E", "Exciter", "exciter", m.exciter > 0.001, "var(--green)"],
  ];
  const toggleOutputFx = (paramKey) => {
    const value = m[paramKey] || 0;
    const storedKey = paramKey + "Stored";
    const stored = m[storedKey];
    const on = value > 0.001;
    const canEnable = stored === undefined || stored > 0.001;
    if (on) {
      onBeforeChange && onBeforeChange();
      DAW.setMaster(storedKey, value);
      DAW.setMaster(paramKey, 0);
    } else if (canEnable) {
      onBeforeChange && onBeforeChange();
      DAW.setMaster(paramKey, stored === undefined ? 0.4 : stored);
    }
  };
  const ROOM_BADGE = { studio: "Studio", home: "Home", concert: "Concert", far: "Far", tunnel: "Tunnel", custom: "Custom" };
  const roomWet = (m.roomParams && m.roomParams.wet) || 0;
  const roomBadge = m.room !== "none" && roomWet > 0.001 ? ROOM_BADGE[m.room] : null;
  const phx = (playhead / DAW.duration) * laneW;
  const inX = m.fadeIn * pxPerSec;
  const outX = (DAW.duration - m.fadeOut) * pxPerSec;

  const loopRange = DAW.loopRange;
  const repeatOn = DAW.repeatPlayEnabled;
  const leftX = loopRange ? (loopRange.start / DAW.duration) * laneW : 0;
  const rightX = loopRange ? (loopRange.end / DAW.duration) * laneW : 0;

  const onOutlaneMouseDown = (e) => {
    if (e.target.closest(".fadeh") || e.target.closest(".loop-btn-x") || e.target.closest(".loop-btn-repeat")) return;

    onBeforeChange && onBeforeChange();
    const r = e.currentTarget.getBoundingClientRect();
    const startX = e.clientX - r.left;
    const startTime = (startX / laneW) * DAW.duration;

    let dragType = "new";
    let initialRange = loopRange ? { ...loopRange } : null;

    if (loopRange) {
      const leftHandleX = (loopRange.start / DAW.duration) * laneW;
      const rightHandleX = (loopRange.end / DAW.duration) * laneW;
      if (Math.abs(startX - leftHandleX) <= 8) {
        dragType = "start";
      } else if (Math.abs(startX - rightHandleX) <= 8) {
        dragType = "end";
      }
    }

    let moved = false;

    const move = (ev) => {
      moved = true;
      const curX = Math.max(0, Math.min(laneW, ev.clientX - r.left));
      const curTime = (curX / laneW) * DAW.duration;

      if (dragType === "new") {
        const t1 = Math.min(startTime, curTime);
        const t2 = Math.max(startTime, curTime);
        if (t2 - t1 > 0.05) {
          DAW.setLoopRange({ start: t1, end: t2 });
        }
      } else if (dragType === "start") {
        const newStart = Math.max(0, Math.min(curTime, initialRange.end - 0.05));
        DAW.setLoopRange({ start: newStart, end: initialRange.end });
      } else if (dragType === "end") {
        const newEnd = Math.max(initialRange.start + 0.05, Math.min(curTime, DAW.duration));
        DAW.setLoopRange({ start: initialRange.start, end: newEnd });
      }
    };

    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (!moved) {
        onSeek(startTime);
      } else if (DAW.repeatPlayEnabled && DAW.loopRange && DAW.snapPlayheadToLoop) {
        // Region was created/moved. If repeat is on, pull playback into the (possibly
        // relocated) range ONCE now that the drag has settled — a single seek, no drone.
        DAW.snapPlayheadToLoop();
      }
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

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
        background: "var(--outfx-bg)", borderRight: "1px solid var(--line-strong)", padding: "10px 12px",
        display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
          <Icon name="eq" size={15} style={{ color: "var(--outfx-fg)", flex: "0 0 auto" }} />
          <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: ".05em", color: "var(--outfx-fg)" }}>OUTPUT&nbsp;FX</span>
          <button className="chip" onClick={onClearMuteSolo} style={{ fontSize: 9, marginLeft: "auto", cursor: "pointer" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--cream)"; e.currentTarget.style.background = "var(--surface3)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--dim)"; e.currentTarget.style.background = "var(--surface2)"; }}>
            MUTE Clr
          </button>
          <span className="chip" style={{ fontSize: 9 }}>master</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div onClick={onOpenMixer} title="Open mixer" style={{ cursor: "pointer", display: "flex", borderRadius: 5 }}>
                <MiniEQGraph width={112} height={30} gray={!fxOn} />
              </div>
              <FxChip label="EFFECT" active={fxOn} color="var(--green)" onClick={toggleAllFx} />
              <div style={{ flex: 1 }} />
            </div>
            {/* fixed-position effect toggles (below the EQ graph) — dimmed while bypassed */}
            <div style={{ display: "flex", alignItems: "center", gap: 3, minHeight: 15, flexWrap: "nowrap", overflow: "hidden",
              opacity: fxOn ? 1 : 0.35, transition: "opacity .2s" }}>
              {fxBadges.map(([abbr, name, paramKey, on, color]) => {
                const stored = m[paramKey + "Stored"];
                const canEnable = stored === undefined || stored > 0.001;
                return (
                <button key={abbr} title={`${name} ${on ? "ON — click to bypass" : canEnable ? "OFF — click to enable" : "OFF — raise the slider in mixer to enable"}${fxOn ? "" : " (all effects bypassed)"}`}
                  onClick={(e) => { e.currentTarget.blur(); toggleOutputFx(paramKey); }}
                  onMouseDown={(e) => e.preventDefault()}
                  className="mono"
                  style={{ width: 19, height: 15, display: "grid", placeItems: "center", padding: 0, borderRadius: 4,
                    fontSize: 8.5, fontWeight: 700, lineHeight: 1, flex: "0 0 19px",
                    color: on ? color : "var(--outfx-chip-off-fg, var(--faint))",
                    background: on ? `color-mix(in srgb, ${color} 16%, transparent)` : "rgba(0,0,0,.18)",
                    border: "1px solid " + (on ? color : "rgba(232,212,170,.10)"),
                    boxShadow: on ? `0 0 6px ${color}66` : "none",
                    cursor: on || canEnable ? "pointer" : "default", userSelect: "none", outline: "none" }}>
                  {abbr}
                </button>
              );})}
              {roomBadge && (
                <span title={"Ambience: " + roomBadge + (fxOn ? "" : " (bypassed)")} className="mono"
                  style={{ fontSize: 8.5, fontWeight: 700, lineHeight: 1, padding: "3px 5px", borderRadius: 4,
                    color: "var(--blue)", border: "1px solid var(--blue)", flexShrink: 0, cursor: "default", userSelect: "none" }}>
                  {roomBadge}
                </span>
              )}
            </div>
          </div>
          <Meter level={DAW.getMasterLevel()} height={46} width={7} />
        </div>
      </div>
      {/* lane with fade overlay */}
      <div className="outlane" onMouseDown={onOutlaneMouseDown}
        // isolate: make the lane its own stacking context so the playhead / loop overlays can never
        // paint above the sibling sticky header when scrolled left (seek-back + zoom-in). See TrackRow.
        style={{ position: "relative", width: laneW, height: laneH, background: "rgba(232,176,75,.04)", cursor: "text", overflow: "hidden", isolation: "isolate" }}>
        <TimeGrid pxPerSec={pxPerSec} height={laneH} />
        {/* fade in */}
        <svg width={laneW} height={laneH} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <path d={`M0 ${laneH} L${inX} 0 L${inX} ${laneH} Z`} fill="rgba(148,192,106,.18)" stroke="var(--green)" strokeWidth="1.5" />
          <path d={`M${outX} 0 L${laneW} ${laneH} L${outX} ${laneH} Z`} fill="rgba(217,106,78,.16)" stroke="var(--red)" strokeWidth="1.5" />
        </svg>
        <div className="fadeh" onMouseDown={dragFade("in")} style={{ position: "absolute", left: inX - 6, top: -2, width: 12, height: 12, borderRadius: "50%", background: "var(--green)", border: "2px solid #1b1712", cursor: "ew-resize" }} />
        <div className="fadeh" onMouseDown={dragFade("out")} style={{ position: "absolute", left: outX - 6, top: -2, width: 12, height: 12, borderRadius: "50%", background: "var(--red)", border: "2px solid #1b1712", cursor: "ew-resize" }} />
        <div style={{ position: "absolute", left: 6, bottom: 5, fontSize: 9.5, color: "var(--green)" }} className="mono">FADE IN {m.fadeIn.toFixed(1)}s</div>
        <div style={{ position: "absolute", right: 6, bottom: 5, fontSize: 9.5, color: "var(--red)" }} className="mono">FADE OUT {m.fadeOut.toFixed(1)}s</div>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: phx, width: 1.5, background: "var(--cream)", pointerEvents: "none", zIndex: 10 }} />

        {loopRange && (
          <React.Fragment>
            {/* Shaded loop range highlight */}
            <div
              style={{
                position: "absolute",
                left: leftX,
                width: rightX - leftX,
                top: 0,
                bottom: 0,
                background: repeatOn ? "rgba(232,176,75,.24)" : "rgba(232,176,75,.08)",
                borderLeft: "2px solid " + (repeatOn ? "var(--amber)" : "var(--line-strong)"),
                borderRight: "2px solid " + (repeatOn ? "var(--amber)" : "var(--line-strong)"),
                pointerEvents: "none",
                zIndex: 4
              }}
            />

            {/* Repeat Button & Close Button Container */}
            <div
              style={{
                position: "absolute",
                left: leftX,
                width: rightX - leftX,
                top: 0,
                bottom: 0,
                pointerEvents: "none",
                zIndex: 5
              }}
            >
              <button
                className="loop-btn-x"
                onClick={() => {
                  onBeforeChange && onBeforeChange();
                  DAW.setLoopRange(null);
                  DAW.setRepeatPlayEnabled(false);
                }}
                style={{
                  position: "absolute",
                  right: 4,
                  top: 4,
                  width: 16,
                  height: 16,
                  padding: "1px",
                  borderRadius: 3,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(8,6,4,.6)",
                  color: "var(--cream-2)",
                  border: "1px solid var(--line-strong)",
                  cursor: "pointer",
                  fontSize: 8.5,
                  fontWeight: 800,
                  pointerEvents: "auto",
                  lineHeight: 1
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--red)";
                  e.currentTarget.style.color = "#fff";
                  e.currentTarget.style.borderColor = "var(--red)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(8,6,4,.6)";
                  e.currentTarget.style.color = "var(--cream-2)";
                  e.currentTarget.style.borderColor = "var(--line-strong)";
                }}
              >
                X
              </button>

              <button
                className="loop-btn-repeat"
                onClick={() => {
                  onBeforeChange && onBeforeChange();
                  DAW.setRepeatPlayEnabled(!repeatOn);
                }}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  padding: "4px 10px",
                  borderRadius: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: ".04em",
                  cursor: "pointer",
                  background: repeatOn ? "var(--amber)" : "var(--surface2)",
                  color: repeatOn ? "#1b1712" : "var(--cream-2)",
                  border: "1px solid " + (repeatOn ? "var(--amber)" : "var(--line-strong)"),
                  boxShadow: repeatOn ? "0 0 10px rgba(232,176,75,.4)" : "none",
                  pointerEvents: "auto",
                  whiteSpace: "nowrap",
                  transition: "background .15s, color .15s, box-shadow .15s"
                }}
              >
                Repeat {repeatOn ? "ON" : "OFF"}
              </button>
            </div>

            {/* Edge resize handles */}
            <div
              style={{
                position: "absolute",
                left: leftX - 4,
                width: 8,
                top: 0,
                bottom: 0,
                cursor: "ew-resize",
                zIndex: 6
              }}
            />
            <div
              style={{
                position: "absolute",
                left: rightX - 4,
                width: 8,
                top: 0,
                bottom: 0,
                cursor: "ew-resize",
                zIndex: 6
              }}
            />
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { ChannelStrip, MasterPanel, MasterEQ, MasterEQOverlay, MasterViewTab, MasterLevelMeter, FxCard, MiniEQGraph, FxChip, MixerWindow, OutputTrack, InputGainKnob });
