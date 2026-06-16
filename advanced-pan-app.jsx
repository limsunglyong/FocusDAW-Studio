const advancedChannel = new BroadcastChannel("focusdaw-advanced-effects-sync");

const ROOM = { w: 1102, h: 472, lx: 551, ly: 439, near: 70, far: 392, angle: 72 };
const TRACK_VOLUME_MIN = 0;
const TRACK_VOLUME_MAX = 2;

const INSTRUMENTS = {
  piano: { label: "Piano", color: "var(--cream-2)", icon: "piano" },
  percussion: { label: "Percussion", color: "var(--amber)", icon: "perc" },
  organ: { label: "Organ", color: "var(--violet)", icon: "organ" },
  guitar: { label: "Guitar", color: "var(--green)", icon: "guitar" },
  bass: { label: "Bass", color: "var(--blue)", icon: "bass" },
  strings: { label: "Strings", color: "var(--red)", icon: "strings" },
  brass: { label: "Brass", color: "var(--amber-deep)", icon: "brass" },
  reed: { label: "Reed", color: "var(--green)", icon: "reed" },
  pipe: { label: "Pipe", color: "var(--blue)", icon: "pipe" },
  synth: { label: "Synth", color: "var(--violet)", icon: "synth" },
  vocal: { label: "Vocal", color: "var(--red)", icon: "vocal" },
  unknown: { label: "Track", color: "var(--dim)", icon: "synth" },
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function dbFromGain(gain) {
  if (gain <= 0.0001) return -60;
  return 20 * Math.log10(gain);
}

function gainFromDb(db) {
  if (db <= -60) return 0;
  return Math.pow(10, db / 20);
}

function distFromGain(gain) {
  return clamp((TRACK_VOLUME_MAX - clamp(gain, TRACK_VOLUME_MIN, TRACK_VOLUME_MAX)) / (TRACK_VOLUME_MAX - TRACK_VOLUME_MIN), 0, 1);
}

function gainFromDist(dist) {
  return TRACK_VOLUME_MAX - clamp(dist, 0, 1) * (TRACK_VOLUME_MAX - TRACK_VOLUME_MIN);
}

function panLabel(pan) {
  const pct = Math.round(Math.abs(pan) * 100);
  if (pct <= 2) return "C";
  return (pan < 0 ? "L" : "R") + pct;
}

function gainLabel(gain) {
  if (gain <= 0.0001) return "-inf dB";
  const db = dbFromGain(gain);
  return (db >= 0 ? "+" : "") + db.toFixed(1) + " dB";
}

function shortTrackName(name) {
  const cleaned = String(name || "Track").replace(/\.[^.]+$/, "").trim();
  return cleaned.replace(/^\d+\s+/, "") || "Track";
}

function matchInstrument(name) {
  const n = String(name || "").toLowerCase();
  const tests = [
    ["perc", "percussion"], ["drum", "percussion"], ["kit", "percussion"], ["kick", "percussion"], ["snare", "percussion"],
    ["bass", "bass"], ["sub", "bass"],
    ["guitar", "guitar"], ["gtr", "guitar"],
    ["string", "strings"], ["violin", "strings"], ["cello", "strings"], ["orchestr", "strings"], ["viola", "strings"],
    ["synth", "synth"], ["lead", "synth"], ["pad", "synth"], ["saw", "synth"], ["arp", "synth"],
    ["piano", "piano"], ["keys", "piano"], ["rhodes", "piano"], ["wurli", "piano"], ["key", "piano"],
    ["organ", "organ"], ["hammond", "organ"],
    ["brass", "brass"], ["trumpet", "brass"], ["horn", "brass"], ["trombone", "brass"], ["tuba", "brass"],
    ["sax", "reed"], ["reed", "reed"], ["clarinet", "reed"], ["oboe", "reed"], ["bassoon", "reed"],
    ["flute", "pipe"], ["pipe", "pipe"], ["recorder", "pipe"], ["whistle", "pipe"], ["piccolo", "pipe"],
    ["vocal", "vocal"], ["vox", "vocal"], ["voice", "vocal"], ["singer", "vocal"],
  ];
  const found = tests.find(([key]) => n.includes(key));
  return found ? found[1] : "unknown";
}

function place(pan, dist) {
  const a = clamp(pan || 0, -1, 1) * ROOM.angle * Math.PI / 180;
  const r = ROOM.near + clamp(dist, 0, 1) * (ROOM.far - ROOM.near);
  return { x: ROOM.lx + r * Math.sin(a), y: ROOM.ly - r * Math.cos(a) };
}

function pt(angle, r) {
  const a = angle * Math.PI / 180;
  return { x: ROOM.lx + r * Math.sin(a), y: ROOM.ly - r * Math.cos(a) };
}

function mapPointer(clientX, clientY, roomEl) {
  const rect = roomEl.getBoundingClientRect();
  const x = (clientX - rect.left) * (ROOM.w / rect.width);
  const y = (clientY - rect.top) * (ROOM.h / rect.height);
  const dx = x - ROOM.lx;
  const dy = ROOM.ly - y;
  const radius = Math.hypot(dx, dy);
  const angle = Math.atan2(dx, dy) * 180 / Math.PI;
  return {
    pan: clamp(angle / ROOM.angle, -1, 1),
    dist: clamp((radius - ROOM.near) / (ROOM.far - ROOM.near), 0, 1),
  };
}

function SvgDefs() {
  return (
    <svg style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} aria-hidden="true">
      <defs>
        <radialGradient id="g-bezel" cx="0.5" cy="0.4" r="0.62">
          <stop offset="0" stopColor="var(--surface3)" />
          <stop offset="0.55" stopColor="var(--surface)" />
          <stop offset="1" stopColor="var(--bg)" />
        </radialGradient>
        <radialGradient id="g-cap" cx="0.5" cy="0.32" r="0.78">
          <stop offset="0" stopColor="var(--surface3)" />
          <stop offset="0.5" stopColor="var(--surface2)" />
          <stop offset="1" stopColor="var(--bg2)" />
        </radialGradient>
        <radialGradient id="g-stage" cx="0.5" cy="0.96" r="0.85">
          <stop offset="0" stopColor="var(--amber-soft)" />
          <stop offset="0.45" stopColor="rgba(255,255,255,0.035)" />
          <stop offset="1" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <linearGradient id="g-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--bg2)" />
          <stop offset="1" stopColor="var(--bg)" />
        </linearGradient>
        <symbol id="ic-piano" viewBox="0 0 24 24">
          <rect x="3" y="6" width="18" height="12" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7.5 6v12M12 6v12M16.5 6v12" stroke="currentColor" strokeWidth="1" opacity="0.45" />
          <rect x="6" y="6" width="2" height="7" rx="0.5" fill="currentColor" /><rect x="10.6" y="6" width="2" height="7" rx="0.5" fill="currentColor" /><rect x="15.2" y="6" width="2" height="7" rx="0.5" fill="currentColor" />
        </symbol>
        <symbol id="ic-perc" viewBox="0 0 24 24">
          <ellipse cx="12" cy="8" rx="7.6" ry="2.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4.4 8v5.8c0 1.6 3.4 2.9 7.6 2.9s7.6-1.3 7.6-2.9V8" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5.2 9.6l2 3.6M18.8 9.6l-2 3.6M9.4 10.8l1.1 3.6M14.6 10.8l-1.1 3.6" stroke="currentColor" strokeWidth="0.9" opacity="0.5" />
          <path d="M6.5 3l4 5M17.5 3l-4 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </symbol>
        <symbol id="ic-organ" viewBox="0 0 24 24">
          <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <line x1="4.5" y1="19" x2="4.5" y2="10" /><line x1="8.4" y1="19" x2="8.4" y2="5.5" /><line x1="12" y1="19" x2="12" y2="8" /><line x1="15.6" y1="19" x2="15.6" y2="4.5" /><line x1="19.5" y1="19" x2="19.5" y2="11" />
          </g>
          <line x1="2.5" y1="20.4" x2="21.5" y2="20.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </symbol>
        <symbol id="ic-guitar" viewBox="0 0 24 24">
          <circle cx="8.4" cy="15.6" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8.4" cy="15.6" r="1.7" fill="currentColor" />
          <path d="M12.4 11.6 19.6 4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M18.7 3.1l2.2 2.2-1.3 1.3-2.2-2.2z" fill="currentColor" />
        </symbol>
        <symbol id="ic-bass" viewBox="0 0 24 24">
          <ellipse cx="7.4" cy="16.4" rx="4.6" ry="5.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="7.4" cy="16.4" r="1.3" fill="currentColor" />
          <path d="M10.6 12.6 20.6 2.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M19.8 1.7h2.4v2.4l-2 2-2-2z" fill="currentColor" />
          <path d="M18.4 5.4l1.6 1.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </symbol>
        <symbol id="ic-strings" viewBox="0 0 24 24">
          <path d="M8.5 21c-2.2 0-3.9-1.5-3.9-3.6 0-1.4 1-2.2 1-3.3 0-1-1-1.8-1-3.2 0-2 1.7-3.5 3.9-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M8.5 21c2.2 0 3.9-1.5 3.9-3.6 0-1.4-1-2.2-1-3.3 0-1 1-1.8 1-3.2 0-2-1.7-3.5-3.9-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M8.5 7.4V3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="8.5" cy="2.4" r="1.3" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6.9 12.6l3.2 3.2M10.1 12.6l-3.2 3.2" stroke="currentColor" strokeWidth="0.8" opacity="0.55" />
        </symbol>
        <symbol id="ic-brass" viewBox="0 0 24 24">
          <path d="M3 8.2v7.4l5-1.6V9.8z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M8 9.8h9.4c1.5 0 2.6 1 2.6 2.2 0 1.2-1.1 2.2-2.6 2.2H8" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M11 9.8V6.6M14 9.8V6.6M17 9.8V6.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </symbol>
        <symbol id="ic-reed" viewBox="0 0 24 24">
          <path d="M15.4 3.2h2.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M15.4 3.4v7.8c0 3.6-2.9 6.5-6.5 6.5-2 0-3.5-1.5-3.5-3.4 0-1.4 1-2.4 2.3-2.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M5.5 14.4c1.2-.3 2.4.4 2.9 1.8l.5 1.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="13.6" cy="7" r="0.8" fill="currentColor" /><circle cx="12.5" cy="10" r="0.8" fill="currentColor" /><circle cx="10.8" cy="12.6" r="0.8" fill="currentColor" />
        </symbol>
        <symbol id="ic-pipe" viewBox="0 0 24 24">
          <g transform="rotate(-21 12 12)">
            <rect x="2.6" y="9.8" width="18.8" height="4.4" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="6.6" cy="12" r="0.9" fill="currentColor" /><circle cx="10.1" cy="12" r="0.9" fill="currentColor" /><circle cx="13.6" cy="12" r="0.9" fill="currentColor" /><circle cx="17.1" cy="12" r="0.9" fill="currentColor" />
            <circle cx="4.4" cy="12" r="0.7" fill="none" stroke="currentColor" strokeWidth="0.9" />
          </g>
        </symbol>
        <symbol id="ic-synth" viewBox="0 0 24 24">
          <rect x="3" y="5" width="18" height="14" rx="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5.6 15.2l3-6 0 6 3-6 0 6 3-6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="17.6" cy="8.4" r="1.4" fill="currentColor" />
        </symbol>
        <symbol id="ic-vocal" viewBox="0 0 24 24">
          <path d="M12 13a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v3a4 4 0 0 0 4 4Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5.5 10.5a6.5 6.5 0 0 0 13 0M12 17v4M8.5 21h7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </symbol>
      </defs>
    </svg>
  );
}

function WindowControlsAef() {
  if (!window.electronAPI || window.electronAPI.platform === "darwin") return <div style={{ width: 84 }} />;
  const act = (e, name) => {
    e.currentTarget.blur();
    window.electronAPI.winAction(name);
  };
  const suppressFocus = (e) => e.preventDefault();
  return (
    <div className="window-controls" aria-label="Window controls">
      <button className="window-control" onMouseDown={suppressFocus} onClick={(e) => act(e, "minimize")} title="Minimize" aria-label="Minimize"><span aria-hidden="true">-</span></button>
      <button className="window-control" onMouseDown={suppressFocus} onClick={(e) => act(e, "maximize")} title="Maximize" aria-label="Maximize"><span aria-hidden="true">□</span></button>
      <button className="window-control close" onMouseDown={suppressFocus} onClick={(e) => act(e, "close")} title="Close" aria-label="Close"><span aria-hidden="true">×</span></button>
    </div>
  );
}

function Stage({ tracks, selectedId, onSelect, onBeforeChange, onParam }) {
  const roomRef = useRef(null);
  const dragRef = useRef(null);
  const [activeId, setActiveId] = useState(null);
  const [roomSize, setRoomSize] = useState({ width: ROOM.w, height: ROOM.h });

  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    const resize = () => {
      const rect = room.getBoundingClientRect();
      setRoomSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(room);
    return () => observer.disconnect();
  }, []);

  const updateFromPointer = useCallback((e) => {
    if (!dragRef.current || !roomRef.current) return;
    const mapped = mapPointer(e.clientX, e.clientY, roomRef.current);
    onParam(dragRef.current, "pan", Math.round(mapped.pan * 1000) / 1000);
    onParam(dragRef.current, "volume", Math.round(gainFromDist(mapped.dist) * 1000) / 1000);
  }, [onParam]);

  const onMove = useCallback((e) => updateFromPointer(e), [updateFromPointer]);
  const onUp = useCallback(() => {
    dragRef.current = null;
    setActiveId(null);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }, [onMove]);

  const startNode = (track) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(track.id);
    onBeforeChange();
    dragRef.current = track.id;
    setActiveId(track.id);
    updateFromPointer(e);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const ringDefs = [
    { gain: TRACK_VOLUME_MAX },
    { gain: 1 },
    { gain: 0.5 },
    { gain: 0.25 },
    { gain: TRACK_VOLUME_MIN },
  ];
  const rings = ringDefs.map(({ gain }) => {
    const d = distFromGain(gain);
    const r = ROOM.near + d * (ROOM.far - ROOM.near);
    const s = pt(-ROOM.angle, r);
    const e = pt(ROOM.angle, r);
    const isZeroDb = Math.abs(gain - 1) < 0.0001;
    return {
      label: gainLabel(gain),
      isZeroDb,
      d: `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${e.x.toFixed(1)} ${e.y.toFixed(1)}`,
      lx: s.x - 8,
      ly: s.y,
    };
  });
  const spokes = [-1, -0.5, 0, 0.5, 1].map((pan) => {
    const angle = pan * ROOM.angle;
    const e = pt(angle, ROOM.far + 16);
    const l = pt(angle, ROOM.far + 30);
    const center = pan === 0;
    return { pan, e, l, center };
  });
  const c1 = pt(-ROOM.angle, ROOM.far);
  const c2 = pt(ROOM.angle, ROOM.far);
  const cone = `M ${ROOM.lx} ${ROOM.ly} L ${c1.x.toFixed(1)} ${c1.y.toFixed(1)} A ${ROOM.far} ${ROOM.far} 0 0 1 ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} Z`;
  const selectedTrack = tracks.find((t) => t.id === selectedId);
  const selectedType = selectedTrack ? matchInstrument(selectedTrack.name || selectedTrack.fileName) : null;
  const selectedInst = selectedType ? INSTRUMENTS[selectedType] : null;
  const selectedPos = selectedTrack ? place((selectedTrack.params || {}).pan || 0, distFromGain((selectedTrack.params || {}).volume ?? 1)) : null;
  const scaleX = roomSize.width / ROOM.w;
  const scaleY = roomSize.height / ROOM.h;

  return (
    <div className="aef-room" ref={roomRef}>
      <svg width="100%" height="100%" viewBox="0 0 1102 472" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, display: "block" }}>
        <rect x="0" y="0" width="1102" height="472" fill="url(#g-floor)" />
        <path d={cone} fill="url(#g-stage)" />
        {rings.map((ring) => (
          <g key={ring.label}>
            <path d={ring.d} fill="none" stroke={ring.isZeroDb ? "var(--amber-soft-strong)" : "var(--line-strong)"} strokeWidth={ring.isZeroDb ? "2.4" : "1.2"} />
            <text x={ring.lx} y={ring.ly} fontFamily="var(--mono)" fontSize="10" letterSpacing="1.5" fill={ring.isZeroDb ? "var(--amber-deep)" : "var(--faint)"} textAnchor="end" dominantBaseline="middle">{ring.label}</text>
          </g>
        ))}
        {spokes.map((spoke) => (
          <g key={spoke.pan}>
            <line x1="551" y1="439" x2={spoke.e.x} y2={spoke.e.y} stroke={spoke.center ? "var(--amber-soft-strong)" : "var(--line)"} strokeWidth={spoke.center ? 1.4 : 1} strokeDasharray={spoke.center ? "6 5" : "2 6"} />
            <text x={spoke.l.x} y={spoke.l.y + 3} fontFamily="var(--mono)" fontSize="10.5" letterSpacing="0.5" fill={spoke.center ? "var(--amber-deep)" : "var(--faint)"} textAnchor="middle">{panLabel(spoke.pan)}</text>
          </g>
        ))}
        {selectedPos && (
          <line x1="551" y1="439" x2={selectedPos.x} y2={selectedPos.y} stroke={selectedInst ? selectedInst.color : "var(--amber)"} strokeWidth="1.6" strokeDasharray="3 4" opacity="0.9" />
        )}
        <circle cx="551" cy="439" r="22" fill="none" stroke="var(--amber-soft-strong)" strokeWidth="1.2" />
        <circle cx="551" cy="439" r="13" fill="var(--surface)" stroke="var(--amber)" strokeWidth="1.6" />
        <path d="M551 428 l5 8 -10 0 z" fill="var(--amber)" />
        <circle cx="539" cy="441" r="3.4" fill="none" stroke="var(--amber)" strokeWidth="1.4" />
        <circle cx="563" cy="441" r="3.4" fill="none" stroke="var(--amber)" strokeWidth="1.4" />
        <text x="551" y="462" fontFamily="var(--mono)" fontSize="9.5" letterSpacing="1.5" fill="var(--muted)" textAnchor="middle">LISTENER</text>
      </svg>
      {tracks.map((track, index) => {
        const params = track.params || {};
        const type = matchInstrument(track.name || track.fileName);
        const inst = INSTRUMENTS[type] || INSTRUMENTS.unknown;
        const dist = distFromGain(params.volume ?? 1);
        const pos = place(params.pan || 0, dist);
        const selected = selectedId === track.id;
        const scale = clamp(1.16 - dist * 0.46, 0.7, 1.2);
        const z = selected ? 400 : Math.round((1 - dist) * 200) + 10;
        return (
          <div
            key={track.id}
            className="aef-node"
            onPointerDown={startNode(track)}
            style={{ left: pos.x * scaleX, top: pos.y * scaleY, zIndex: z }}
          >
            <div className={"aef-node-label" + (selected ? " selected" : "")}>
              <span className="mono">{index + 1}</span> {shortTrackName(track.name || track.fileName)}
            </div>
            <div
              className={"aef-token" + (selected ? " selected" : "") + (activeId === track.id ? " active" : "")}
              style={{ color: inst.color, transform: `scale(${scale.toFixed(3)})` }}
            >
              <svg width="30" height="30" viewBox="0 0 24 24" style={{ overflow: "visible", pointerEvents: "none" }}>
                <use href={`#ic-${inst.icon}`} />
              </svg>
            </div>
            <div className={"aef-vol" + (selected ? " selected" : "")}>{gainLabel(params.volume ?? 1)}</div>
          </div>
        );
      })}
    </div>
  );
}

function makeTicks() {
  const rOut = 47;
  const seg = (a, len) => {
    const rad = a * Math.PI / 180;
    const x1 = 52 + rOut * Math.sin(rad);
    const y1 = 52 - rOut * Math.cos(rad);
    const x2 = 52 + (rOut - len) * Math.sin(rad);
    const y2 = 52 - (rOut - len) * Math.cos(rad);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  let minor = "";
  let major = "";
  let center = "";
  for (let k = 0; k <= 20; k += 1) {
    const a = -135 + k * 13.5;
    const isMajor = [-135, -67.5, 67.5, 135].some((m) => Math.abs(m - a) < 0.6);
    if (Math.abs(a) < 0.6) center += seg(a, 9) + " ";
    else if (isMajor) major += seg(a, 7) + " ";
    else minor += seg(a, 4.5) + " ";
  }
  return { minor: minor.trim(), major: major.trim(), center: center.trim() };
}

const TICKS = makeTicks();

function MiniTrackMeter({ level, height = 58, width = 6 }) {
  const gap = 1.5;
  const segs = Math.max(6, Math.min(22, Math.round((height - gap) / 3.5)));
  const lit = Math.round(clamp(level || 0, 0, 1) * segs);
  const cells = [];
  for (let i = 0; i < segs; i += 1) {
    const frac = i / segs;
    const on = i < lit;
    let col = "var(--green)";
    if (frac > 0.82) col = "var(--red)";
    else if (frac > 0.62) col = "var(--amber)";
    cells.push(
      <div
        key={i}
        style={{
          flex: 1,
          minHeight: 1,
          background: on ? col : "rgba(0,0,0,.32)",
          borderRadius: 1,
          opacity: on ? 1 : .85,
          boxShadow: on ? `0 0 4px ${col}` : "none",
          transition: "opacity .05s",
        }}
      />
    );
  }
  return <div className="aef-track-meter" style={{ width, height }}>{cells}</div>;
}

function PanKnob({ track, index, selected, level, onSelect, onBeforeChange, onParam }) {
  const params = track.params || {};
  const pan = params.pan || 0;
  const type = matchInstrument(track.name || track.fileName);
  const inst = INSTRUMENTS[type] || INSTRUMENTS.unknown;
  const dragRef = useRef(null);

  const onMove = useCallback((e) => {
    if (!dragRef.current) return;
    const next = clamp(dragRef.current.startPan + (dragRef.current.startY - e.clientY) / 70, -1, 1);
    onParam(track.id, "pan", Math.round(next * 1000) / 1000);
  }, [onParam, track.id]);

  const onUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }, [onMove]);

  const startKnob = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(track.id);
    onBeforeChange();
    dragRef.current = { startY: e.clientY, startPan: pan };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const reset = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onBeforeChange();
    onParam(track.id, "pan", 0);
  };

  const knobDeg = pan * 135;
  const dotPos = 50 + pan * 48;

  return (
    <div className={"aef-knob-cell" + (selected ? " selected" : "")} onClick={() => onSelect(track.id)}>
      <div className="aef-knob-title">
        <span className="mono">{index + 1}</span>
        <span>{shortTrackName(track.name || track.fileName)}</span>
      </div>
      <div className="aef-knob-body">
        <svg width="100" height="100" viewBox="0 0 104 104" onPointerDown={startKnob} onDoubleClick={reset} className="aef-pan-svg">
          <path d={TICKS.minor} stroke="var(--faint)" strokeWidth="1.4" strokeLinecap="round" />
          <path d={TICKS.major} stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" />
          <path d={TICKS.center} stroke="var(--amber)" strokeWidth="2.4" strokeLinecap="round" />
          <text x="14" y="84" fontFamily="var(--mono)" fontSize="9" letterSpacing="0.5" fill="var(--faint)" textAnchor="middle">L</text>
          <text x="52" y="11.5" fontFamily="var(--mono)" fontSize="9" letterSpacing="0.5" fill="var(--muted)" textAnchor="middle">C</text>
          <text x="90" y="84" fontFamily="var(--mono)" fontSize="9" letterSpacing="0.5" fill="var(--faint)" textAnchor="middle">R</text>
          <circle cx="52" cy="52" r="38" fill="url(#g-bezel)" stroke="rgba(0,0,0,0.45)" strokeWidth="1" />
          <circle cx="52" cy="52" r="36.5" fill="none" stroke="rgba(0,0,0,0.38)" strokeWidth="3.2" strokeDasharray="1.5 2.6" />
          <g transform={`rotate(${knobDeg.toFixed(2)} 52 52)`} className="aef-knob-pointer">
            <path d="M52 15 L57.6 30.5 L46.4 30.5 Z" fill="url(#g-cap)" stroke="rgba(0,0,0,0.55)" strokeWidth="0.8" strokeLinejoin="round" />
            <circle cx="52" cy="52" r="25" fill="url(#g-cap)" stroke="rgba(255,242,214,0.12)" strokeWidth="1" />
            <ellipse cx="52" cy="45" rx="18" ry="10" fill="rgba(255,242,214,0.05)" />
            <line x1="52" y1="31" x2="52" y2="47" stroke="var(--cream)" strokeWidth="2.6" strokeLinecap="round" />
            <circle cx="52" cy="21.5" r="2.6" fill={inst.color} className="aef-led" />
          </g>
          <circle cx="52" cy="52" r="3.2" fill="var(--bg)" stroke="rgba(255,242,214,0.14)" strokeWidth="1" />
        </svg>
        <MiniTrackMeter level={level} />
      </div>
      <div className="aef-pan-readout" style={{ color: inst.color }}>{panLabel(pan)}</div>
      <div className="aef-mini-bar">
        <div className="aef-mini-center" />
        <div className="aef-mini-dot" style={{ left: `${dotPos.toFixed(2)}%`, background: inst.color, boxShadow: `0 0 7px ${inst.color}` }} />
      </div>
      <div className="aef-pan-caption">PAN</div>
    </div>
  );
}

function AdvancedPanApp() {
  const [tracks, setTracks] = useState([]);
  const [theme, setTheme] = useState("default");
  const [selectedId, setSelectedId] = useState(null);
  const [levels, setLevels] = useState({});
  const selectedTrack = tracks.find((t) => t.id === selectedId) || tracks[0] || null;

  useEffect(() => {
    advancedChannel.postMessage({ type: "ADVANCED_READY" });
    const handleMessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "INIT_STATE" || msg.type === "SYNC_STATE") {
        const nextTracks = msg.tracks || [];
        setTracks(nextTracks);
        if (msg.trackLevels) setLevels(msg.trackLevels);
        if (msg.theme) setTheme(msg.theme);
        setSelectedId((cur) => {
          if (cur && nextTracks.some((t) => t.id === cur)) return cur;
          return (nextTracks[0] && nextTracks[0].id) || null;
        });
      } else if (msg.type === "LEVEL_METERS") {
        setLevels(msg.trackLevels || {});
      }
    };
    advancedChannel.addEventListener("message", handleMessage);
    return () => advancedChannel.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "default") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape" || e.key === "F3") {
        e.preventDefault();
        if (window.electronAPI && window.electronAPI.winAction) window.electronAPI.winAction("close");
        else window.close();
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        advancedChannel.postMessage({ type: "REQUEST_UNDO" });
      }
      if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        advancedChannel.postMessage({ type: "REQUEST_REDO" });
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const beforeChange = useCallback(() => {
    advancedChannel.postMessage({ type: "BEFORE_CHANGE" });
  }, []);

  const setParam = useCallback((id, key, value) => {
    setTracks((prev) => prev.map((t) => t.id === id ? { ...t, params: { ...t.params, [key]: value } } : t));
    advancedChannel.postMessage({ type: "SET_TRACK_PARAM", id, k: key, v: value });
  }, []);

  const resetAll = useCallback(() => {
    if (!tracks.length) return;
    beforeChange();
    tracks.forEach((track) => {
      setParam(track.id, "pan", 0);
      setParam(track.id, "volume", 1);
    });
  }, [beforeChange, setParam, tracks]);

  const selectedParams = (selectedTrack && selectedTrack.params) || {};
  const selectedLine = selectedTrack
    ? `${selectedTrack.name || selectedTrack.fileName || "Track"}  -  ${panLabel(selectedParams.pan || 0)}  -  ${gainLabel(selectedParams.volume ?? 1)}`
    : "Select a track to inspect";

  return (
    <div className="aef-backdrop">
      <SvgDefs />
      <div className="aef-shell">
        <div className="aef-window">
          <div className="aef-titlebar">
            <div className="title-c">FocusDAW Studio <b>Advanced Pan</b></div>
            <WindowControlsAef />
          </div>

          <div className="aef-toolbar">
            <span className="aef-toolbar-label">SPATIAL FIELD</span>
            <div className="aef-tabs">
              <span className="aef-tab active">Soundstage</span>
              <span className="aef-tab">Distance - Vol</span>
            </div>
            <div className="aef-flex" />
            <span className="aef-selected-line mono">{selectedLine}</span>
            <button onClick={resetAll} className="aef-reset">Reset Pan</button>
          </div>

          <Stage tracks={tracks} selectedId={selectedTrack && selectedTrack.id} onSelect={setSelectedId} onBeforeChange={beforeChange} onParam={setParam} />

          <div className="aef-knobs">
            <div className="aef-knob-row">
              {tracks.length ? tracks.map((track, index) => (
                <PanKnob
                  key={track.id}
                  track={track}
                  index={index}
                  selected={selectedTrack && selectedTrack.id === track.id}
                  level={levels[track.id] || 0}
                  onSelect={setSelectedId}
                  onBeforeChange={beforeChange}
                  onParam={setParam}
                />
              )) : (
                <div className="aef-empty">Load tracks in FocusDAW Studio to place instruments on the soundstage.</div>
              )}
            </div>
          </div>

          <div className="aef-footer">
            <span>Drag an instrument across the stage, or turn a knob - pan stays in sync</span>
            <span className="mono">{tracks.length} tracks - spatialized</span>
          </div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.render(<AdvancedPanApp />, document.getElementById("root"));
