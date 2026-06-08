/* ================= FocusDAW — main app ================= */

const RECENT_PROJECT_KEY = "focusdaw-recent-project";
const DEFAULT_PROJECT_NAME = "untitled";
const APP_VERSION = "v0.15.32";

function safeFileBase(name) {
  const cleaned = String(name || DEFAULT_PROJECT_NAME)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[.\s]+$/g, "");
  return cleaned || DEFAULT_PROJECT_NAME;
}

function basenameFromPath(filePath) {
  return (filePath || "").split(/[\\/]/).pop() || "";
}

function projectNameFromPath(filePath) {
  return basenameFromPath(filePath).replace(/\.focus$/i, "") || DEFAULT_PROJECT_NAME;
}

function saveRecentProject(projectName) {
  try {
    localStorage.setItem(RECENT_PROJECT_KEY, JSON.stringify(DAW.exportProject(projectName)));
  } catch (err) {
    console.warn("Failed to save recent project:", err);
  }
}

function loadRecentProject(onRename) {
  const raw = localStorage.getItem(RECENT_PROJECT_KEY);
  if (!raw) {
    DAW.clearTracks();
    return false;
  }
  try {
    const json = JSON.parse(raw);
    DAW.importProject(json);
    if (json.projectName && onRename) onRename(json.projectName);
    return true;
  } catch (err) {
    console.warn("Failed to load recent project:", err);
    localStorage.removeItem(RECENT_PROJECT_KEY);
    DAW.clearTracks();
    return false;
  }
}

/* ---------- dropdown menu ---------- */
function Dropdown({ label, items, accent }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative", display: "flex", alignItems: "stretch" }}>
      <div className="menu-item" onClick={() => setOpen((o) => !o)}
        style={{ background: open ? "var(--surface)" : "transparent", color: accent ? "var(--amber)" : "var(--cream-2)", fontWeight: accent ? 600 : 400 }}>
        {label}
      </div>
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, minWidth: 220, background: "var(--surface)",
          border: "1px solid var(--line-strong)", borderRadius: 10, boxShadow: "var(--shadow)", padding: 6, zIndex: 200 }}>
          {items.map((it, i) => it.sep ? (
            <div key={i} style={{ height: 1, background: "var(--line)", margin: "5px 6px" }} />
          ) : (
            <div key={i} onClick={() => { setOpen(false); it.onClick && it.onClick(); }}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 7, cursor: "pointer", fontSize: 12.5 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface3)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              {it.icon && <Icon name={it.icon} size={15} style={{ color: "var(--amber)", flex: "0 0 auto" }} />}
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.hint && <span className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>{it.hint}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WindowControls() {
  if (!window.electronAPI || window.electronAPI.platform === "darwin") return null;
  const act = (name) => window.electronAPI.winAction(name);
  return (
    <div className="window-controls" aria-label="Window controls">
      <button className="window-control" onClick={() => act("minimize")} title="Minimize" aria-label="Minimize">
        <span aria-hidden="true">-</span>
      </button>
      <button className="window-control" onClick={() => act("maximize")} title="Maximize" aria-label="Maximize">
        <span aria-hidden="true">□</span>
      </button>
      <button className="window-control close" onClick={() => act("close")} title="Close" aria-label="Close">
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

function MenuBar({ projectName, onRename, onNew, onImport, onImportFolder, onLoadDemo, onExport, onSave, onOpenProject, onSettings }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(projectName);
  useEffect(() => setDraft(projectName), [projectName]);
  const commit = () => { onRename(draft.trim() || DEFAULT_PROJECT_NAME); setEditing(false); };
  const updateDraft = (value) => {
    setDraft(value);
    if (value.trim()) onRename(value.trim());
  };
  const projectItems = [
    { label: "New Project", icon: "plus", hint: "\u2318N", onClick: onNew },
    { sep: true },
    { label: "Open Project\u2026", icon: "folder", hint: "\u2318O", onClick: onOpenProject },
    { label: "Save Project", icon: "download", hint: "\u2318S", onClick: onSave },
    { sep: true },
    { label: "Import Stem Folder\u2026", icon: "folder", onClick: onImportFolder },
    { label: "Import Audio Files\u2026", icon: "wave", onClick: onImport },
    { label: "Load Demo Session", icon: "disc", onClick: onLoadDemo },
    { sep: true },
    { label: "Export MP3\u2026", icon: "download", hint: "\u2318E", onClick: onExport },
  ];
  return (
    <div className="menubar">
      <div style={{ display: "flex", alignItems: "center", paddingRight: 6 }}><Logo size={17} /></div>
      <Dropdown label="Project" items={projectItems} accent />
      <div className="menu-item" onClick={onSettings} style={{ cursor: "pointer" }}>Settings</div>
      <div style={{ position: "absolute", left: "50%", top: 0, height: "100%", transform: "translateX(-50%)", display: "flex", alignItems: "center", zIndex: 3 }}>
        <MenuTransport />
      </div>
      <div style={{ flex: 1 }} />
      {/* project name, right-aligned, inline-editable */}
      {editing ? (
        <input className="project-name-edit" autoFocus value={draft} onChange={(e) => updateDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          style={{ background: "var(--bg)", border: "1px solid var(--amber-deep)", borderRadius: 6, color: "var(--cream)",
            fontFamily: "var(--ui)", fontSize: 12.5, height: 28, lineHeight: "20px", padding: "3px 8px", outline: "none", width: 240, textAlign: "right" }} />
      ) : (
        <div className="project-name-edit" onClick={() => setEditing(true)} title="Rename project"
          style={{ display: "flex", alignItems: "center", gap: 8, height: 28, padding: "3px 10px", borderRadius: 7, cursor: "text", whiteSpace: "nowrap", flex: "0 0 auto", alignSelf: "center" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
          <Icon name="disc" size={13} style={{ color: "var(--faint)", flex: "0 0 auto" }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--cream-2)", whiteSpace: "nowrap" }}>{projectName || DEFAULT_PROJECT_NAME}</span>
        </div>
      )}
      <WindowControls />
    </div>
  );
}

/* ---------- transport ---------- */
function MenuTransportButton({ title, active, children, onClick, wide }) {
  return (
    <button onClick={onClick} title={title}
      style={{ width: wide ? 34 : 27, height: 27, borderRadius: 999, display: "grid", placeItems: "center",
        color: active ? "#241a0a" : "var(--cream-2)",
        background: active
          ? "linear-gradient(180deg,var(--amber),var(--amber-deep))"
          : "linear-gradient(180deg,var(--surface3),var(--surface2))",
        border: "1px solid " + (active ? "var(--amber)" : "var(--line-strong)"),
        boxShadow: active ? "0 0 12px var(--amber-soft), inset 0 1px 0 rgba(255,255,255,.24)" : "inset 0 1px 0 rgba(255,255,255,.05)",
        transition: "background .14s ease, color .14s ease, box-shadow .14s ease, transform .08s ease" }}
      onMouseDown={(e) => (e.currentTarget.style.transform = "translateY(1px)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "translateY(0)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}>
      {children}
    </button>
  );
}

function MenuTransport() {
  useTick();
  const [, force] = useState(0);
  const [loop, setLoop] = useState(true);
  const playing = DAW.isPlaying;
  const playhead = DAW.getPlayhead();
  const playPause = () => { DAW.isPlaying ? DAW.pause() : DAW.play(); force((n) => n + 1); };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, height: 36 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, height: 32, padding: "2px 4px",
        borderRadius: 999, background: "linear-gradient(180deg,var(--bg2),var(--bg))",
        border: "1px solid var(--line-strong)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.04), 0 8px 18px -14px rgba(0,0,0,.8)" }}>
        <MenuTransportButton title="Return to start" onClick={() => { DAW.seek(0); force((n) => n + 1); }}>
          <Icon name="toStart" size={13} />
        </MenuTransportButton>
        <MenuTransportButton title="Stop" onClick={() => { DAW.stop(); force((n) => n + 1); }}>
          <Icon name="stop" size={11} fill />
        </MenuTransportButton>
        <MenuTransportButton title="Play / Pause" active={playing} wide onClick={playPause}>
          <Icon name={playing ? "pause" : "play"} size={14} fill />
        </MenuTransportButton>
        <MenuTransportButton title="Loop" active={loop} onClick={() => setLoop((l) => !l)}>
          <Icon name="loop" size={13} />
        </MenuTransportButton>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 15px",
        background: "linear-gradient(180deg,var(--surface2),var(--bg))", borderRadius: 999,
        border: "1px solid var(--line-strong)", minWidth: 124, height: 32,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)" }}>
        <span className="mono" style={{ fontSize: 18, fontWeight: 400, color: "var(--amber)", lineHeight: 1 }}>{fmtTime(playhead)}</span>
      </div>
    </div>
  );
}

function Transport({ playing, onPlay, onStop, onToStart, loop, onLoop, playhead }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ display: "flex", gap: 4 }}>
        <button className="iconbtn" onClick={onToStart} title="Return to start"><Icon name="toStart" size={17} /></button>
        <button className="iconbtn" onClick={onStop} title="Stop"><Icon name="stop" size={15} fill /></button>
        <button onClick={onPlay} title="Play / Pause" style={{ width: 42, height: 36, borderRadius: 9, display: "grid", placeItems: "center",
          background: playing ? "var(--amber)" : "var(--surface2)", color: playing ? "#241a0a" : "var(--cream)", border: "1px solid " + (playing ? "var(--amber)" : "var(--line-strong)"), boxShadow: playing ? "0 0 12px rgba(232,176,75,.45)" : "none" }}>
          <Icon name={playing ? "pause" : "play"} size={18} fill />
        </button>
        <button className={"iconbtn" + (loop ? " on" : "")} onClick={onLoop} title="Loop"><Icon name="loop" size={16} /></button>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "3px 14px", background: "var(--bg)", borderRadius: 9, border: "1px solid var(--line)", minWidth: 118, height: 36 }}>
        <span className="mono" style={{ fontSize: 21, fontWeight: 400, color: "var(--amber)", letterSpacing: ".02em" }}>{fmtTime(playhead)}</span>
      </div>
    </div>
  );
}

/* ---------- toolbar (zoom / tools / actions) ---------- */
const TIME_ZOOM_BASE_MIN = 28;
const TIME_ZOOM_MAX = 420;

function timelineMinPx(containerWidth) {
  const width = containerWidth || window.innerWidth || 1980;
  const visibleLaneW = Math.max(320, width - HEADER_W - 16);
  const dur = Math.max(1, DAW.duration || 1);
  return Math.max(0.05, Math.min(TIME_ZOOM_BASE_MIN, visibleLaneW / dur));
}

function timelineStep(minPx) {
  if (minPx < 1) return 0.01;
  if (minPx < 10) return 0.1;
  return 1;
}

function ZoomGroup({ label, onMinus, onPlus, sliderProps }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "5px 9px", background: "var(--bg)", borderRadius: 10, border: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, letterSpacing: ".06em", marginRight: 3 }}>{label}</span>
        <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={onMinus}><Icon name="zoomOut" size={14} /></button>
        <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={onPlus}><Icon name="zoomIn" size={14} /></button>
      </div>
      <SleekSlider {...sliderProps} />
    </div>
  );
}
function ZoomBar({ pxPerSec, setPx, ampZoom, setAmp, timeMin }) {
  const timeStep = timelineStep(timeMin);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <ZoomGroup label="TIME"
        onMinus={() => setPx(Math.max(timeMin, pxPerSec / 1.4))} onPlus={() => setPx(Math.min(TIME_ZOOM_MAX, pxPerSec * 1.4))}
        sliderProps={{ value: Math.max(timeMin, pxPerSec), min: timeMin, max: TIME_ZOOM_MAX, step: timeStep, onChange: setPx, width: 108 }} />
      <ZoomGroup label="AMP"
        onMinus={() => setAmp(Math.max(0.4, ampZoom - 0.3))} onPlus={() => setAmp(Math.min(3, ampZoom + 0.3))}
        sliderProps={{ value: ampZoom, min: 0.4, max: 3, step: 0.05, onChange: setAmp, width: 96 }} />
    </div>
  );
}

/* ---------- edit tool selector ---------- */
const TOOL_ICONS = { select: "cursor", scissors: "scissors", join: "join" };
const TOOL_TIPS  = { select: "Select / Seek (S)", scissors: "Split clip (C)", join: "Join clips (J)" };
function ToolBar({ tool, setTool }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 6px",
      background: "var(--bg)", borderRadius: 9, border: "1px solid var(--line)" }}>
      {["select", "scissors", "join"].map((t) => (
        <button key={t} title={TOOL_TIPS[t]}
          onClick={() => setTool(t)}
          style={{ width: 30, height: 28, borderRadius: 6, display: "grid", placeItems: "center",
            background: tool === t ? "var(--amber-soft)" : "transparent",
            color: tool === t ? "var(--amber)" : "var(--muted)",
            border: "none", cursor: "pointer", transition: ".12s" }}>
          <ToolIcon name={t} size={15} />
        </button>
      ))}
    </div>
  );
}
/* inline SVG icons for tools */
function ToolIcon({ name, size }) {
  if (name === "select") return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2l10 5.5-5 1.5-1.5 5z" />
    </svg>
  );
  if (name === "scissors") return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="4.5" cy="5" r="2" /><circle cx="4.5" cy="11" r="2" />
      <line x1="6.3" y1="6.3" x2="13" y2="3" /><line x1="6.3" y1="9.7" x2="13" y2="13" />
    </svg>
  );
  if (name === "join") return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 8h5M9 8h5" /><path d="M7 5l-2 3 2 3M9 5l2 3-2 3" />
    </svg>
  );
  return null;
}
function ActionBar({ onAddTrack, onMixer, mixerOpen, onExport }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
      <button className="btn" onClick={onAddTrack}><Icon name="plus" size={15} /> Track</button>
      <button className={"btn" + (mixerOpen ? " primary" : "")} onClick={onMixer}><Icon name="mixer" size={15} /> Mixer</button>
      <button className="btn" onClick={onExport}><Icon name="download" size={15} /> Export MP3</button>
    </div>
  );
}

function TimelineMinimap({ arrangeRef, pxPerSec, playhead, viewState, setPx, timeMin }) {
  const ref = useRef(null);
  const duration = Math.max(0.001, DAW.duration || 0.001);
  const laneW = Math.max(1, duration * pxPerSec);
  const viewLeft = Math.max(0, Math.min(1, (viewState.scrollLeft || 0) / laneW));
  const viewWidth = Math.max(0.012, Math.min(1, (viewState.clientWidth || laneW) / laneW));
  const playPct = Math.max(0, Math.min(1, playhead / duration));
  const ticks = [];
  for (let t = 0; t <= duration + 0.001; t += 10) ticks.push(t);
  if (ticks[ticks.length - 1] < duration) ticks.push(duration);

  const moveViewFromClientX = (clientX) => {
    const host = ref.current;
    const scrollHost = arrangeRef.current;
    if (!host || !scrollHost) return;
    const r = host.getBoundingClientRect();
    const innerLeft = r.left + 10;
    const innerW = Math.max(1, r.width - 20);
    const pct = Math.max(0, Math.min(1, (clientX - innerLeft) / innerW));
    const t = pct * duration;
    const visibleW = Math.max(1, scrollHost.clientWidth - HEADER_W);
    scrollHost.scrollLeft = Math.max(0, Math.min(laneW - visibleW, t * pxPerSec - visibleW / 2));
  };
  const onDown = (e) => {
    e.preventDefault();
    moveViewFromClientX(e.clientX);
    const move = (ev) => moveViewFromClientX(ev.clientX);
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const onWheel = (e) => {
    e.preventDefault();
    const next = e.deltaY < 0 ? pxPerSec * 1.18 : pxPerSec / 1.18;
    setPx(Math.max(timeMin, Math.min(TIME_ZOOM_MAX, next)));
  };

  return (
    <div ref={ref} onMouseDown={onDown} onWheel={onWheel} title="Timeline minimap"
      style={{ flex: "1 1 420px", minWidth: 220, height: 40, position: "relative", overflow: "hidden",
        borderRadius: 10, border: "1px solid var(--line)", background: "linear-gradient(180deg,var(--bg),var(--bg2))",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.035)", cursor: "pointer" }}>
      <div style={{ position: "absolute", inset: "6px 10px 7px", borderRadius: 7, overflow: "hidden", background: "rgba(255,255,255,.018)" }}>
        <span style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 1, background: "rgba(232,212,170,.045)" }} />
        {ticks.map((t) => {
          const isMajor = Math.round(t) % 30 === 0;
          return (
            <span key={t} style={{ position: "absolute", left: `${(t / duration) * 100}%`, top: isMajor ? 3 : 7, bottom: isMajor ? 3 : 7, width: 1,
              background: isMajor ? "rgba(232,212,170,.14)" : "rgba(232,212,170,.075)" }} />
          );
        })}
        {DAW.tracks.length === 0 && (
          <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 10, color: "var(--faint)", letterSpacing: ".08em" }}>TIMELINE</span>
        )}

        <div style={{ position: "absolute", left: `${viewLeft * 100}%`, top: 0, width: `${viewWidth * 100}%`, minWidth: 18, height: "100%",
          borderRadius: 7, border: "1px solid rgba(232,176,75,.65)", background: "rgba(232,176,75,.08)",
          boxShadow: "0 0 12px rgba(232,176,75,.16)" }}>
          <span style={{ position: "absolute", left: "50%", top: 4, bottom: 4, width: 1, background: "rgba(232,176,75,.55)", transform: "translateX(-50%)" }} />
          <span style={{ position: "absolute", left: 5, right: 5, top: "50%", height: 1, background: "rgba(232,176,75,.45)", transform: "translateY(-50%)" }} />
        </div>
        <span style={{ position: "absolute", left: `${playPct * 100}%`, top: -2, bottom: -2, width: 2,
          borderRadius: 2, background: "var(--amber)", boxShadow: "0 0 10px rgba(232,176,75,.65)", transform: "translateX(-1px)",
          pointerEvents: "none" }} />
      </div>
    </div>
  );
}

function ToolGroup({ children }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", background: "var(--bg)", borderRadius: 9, border: "1px solid var(--line)" }}>{children}</div>;
}

/* ---------- empty state ---------- */
function EmptyState({ onPick, onPickFolder, onDemo, dragOver }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
      <div style={{ textAlign: "center", maxWidth: 460, padding: "40px 44px", borderRadius: 16, pointerEvents: "auto",
        border: `1.5px dashed ${dragOver ? "var(--amber)" : "var(--line-strong)"}`,
        background: dragOver ? "var(--amber-soft)" : "rgba(255,255,255,.015)", transition: ".15s" }}>
        <Logo size={42} />
        <div style={{ fontSize: 19, fontWeight: 700, marginTop: 14, letterSpacing: "-.01em" }}>Drop your stems to begin</div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 8, lineHeight: 1.6 }}>
          Drag a stem folder or audio files anywhere here.<br />One track is created per file, named from the filename.
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 22 }}>
          <button className="btn primary" onClick={onPickFolder}><Icon name="folder" size={15} /> Import Folder</button>
          <button className="btn" onClick={onPick}><Icon name="wave" size={15} /> Import Files</button>
        </div>
        <button className="btn ghost" onClick={onDemo} style={{ marginTop: 12, color: "var(--amber)" }}>
          <Icon name="disc" size={14} /> Load demo session
        </button>
      </div>
    </div>
  );
}

function LoadingOverlay({ state }) {
  if (!state || !state.active) return null;
  const total = Math.max(1, state.total || 1);
  const done = Math.max(0, Math.min(total, state.done || 0));
  const pct = Math.round((done / total) * 100);
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 120, display: "grid", placeItems: "center",
      background: "rgba(12,10,8,.58)", backdropFilter: "blur(6px)", pointerEvents: "auto" }}>
      <div style={{ width: 340, maxWidth: "calc(100vw - 40px)", borderRadius: 14,
        background: "linear-gradient(180deg,var(--surface),var(--bg2))",
        border: "1px solid var(--line-strong)", boxShadow: "var(--shadow)",
        padding: "24px 26px", textAlign: "center" }}>
        <div style={{ width: 58, height: 58, margin: "0 auto 16px", borderRadius: "50%",
          border: "1px solid var(--line-strong)", display: "grid", placeItems: "center",
          background: "radial-gradient(circle at 50% 50%, var(--amber-soft), transparent 62%)" }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%",
            border: "3px solid var(--line-strong)", borderTopColor: "var(--amber)",
            animation: "spin .9s linear infinite", boxShadow: "0 0 18px var(--amber-soft)" }} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--cream)", marginBottom: 5 }}>Loading audio</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", minHeight: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {state.label || "Preparing files..."}
        </div>
        <div style={{ marginTop: 17, height: 6, borderRadius: 999, background: "var(--bg)",
          border: "1px solid var(--line)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, borderRadius: 999,
            background: "linear-gradient(90deg,var(--amber-deep),var(--amber))",
            boxShadow: "0 0 10px var(--amber-soft)", transition: "width .18s ease" }} />
        </div>
        <div className="mono" style={{ marginTop: 9, fontSize: 10.5, color: "var(--faint)" }}>
          {done}/{total} files
        </div>
      </div>
    </div>
  );
}

/* ---------- studio (arrange) ---------- */
function Studio({ projectName, projectNameRef, projectPath, registerHandlers, onRenameProject, onProjectPathChange }) {
  useTick();
  const [pxPerSec, setPx] = useState(96);
  const [timeMinPx, setTimeMinPx] = useState(TIME_ZOOM_BASE_MIN);
  const [ampZoom, setAmp] = useState(1);
  const [showMixer, setShowMixer] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [laneH, setLaneH] = useState(96);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(null);
  const [tool, setTool] = useState("select");
  const [timelineView, setTimelineView] = useState({ scrollLeft: 0, clientWidth: 1 });
  const [, force] = useState(0);
  const fileRef = useRef(null);
  const folderRef = useRef(null);
  const focusRef = useRef(null);
  const arrangeRef = useRef(null);
  const fitTimelineRef = useRef(true);
  const playhead = DAW.getPlayhead();
  const sessionDuration = DAW.duration;

  const updateTimelineView = useCallback(() => {
    const el = arrangeRef.current;
    if (!el) return;
    setTimelineView({ scrollLeft: el.scrollLeft, clientWidth: Math.max(1, el.clientWidth - HEADER_W) });
  }, []);

  const updateTimeMin = useCallback(() => {
    const next = timelineMinPx(arrangeRef.current && arrangeRef.current.clientWidth);
    setTimeMinPx(next);
    return next;
  }, []);

  const fitTimelineToProject = useCallback(() => {
    const next = updateTimeMin();
    fitTimelineRef.current = true;
    setPx(next);
  }, [updateTimeMin]);

  const setPxFromUser = useCallback((value) => {
    const nextMin = timelineMinPx(arrangeRef.current && arrangeRef.current.clientWidth);
    const snappedToMin = value <= nextMin + timelineStep(nextMin) * 0.5;
    fitTimelineRef.current = snappedToMin;
    setPx(snappedToMin ? nextMin : value);
  }, []);

  useEffect(() => {
    const onResize = () => {
      const next = updateTimeMin();
      setPx((px) => fitTimelineRef.current
        ? next
        : Math.max(next, Math.min(TIME_ZOOM_MAX, px)));
      updateTimelineView();
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateTimeMin, updateTimelineView]);

  useEffect(() => {
    const el = arrangeRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateTimelineView);
    };
    updateTimelineView();
    el.addEventListener("scroll", onScroll);
    return () => { cancelAnimationFrame(raf); el.removeEventListener("scroll", onScroll); };
  }, [updateTimelineView, pxPerSec, sessionDuration]);

  useEffect(() => {
    const next = updateTimeMin();
    setPx((px) => fitTimelineRef.current
      ? next
      : Math.max(next, Math.min(TIME_ZOOM_MAX, px)));
    requestAnimationFrame(updateTimelineView);
  }, [sessionDuration, updateTimeMin, updateTimelineView]);

  const saveProject = useCallback(async () => {
    const currentName = (projectNameRef && projectNameRef.current) || projectName || DEFAULT_PROJECT_NAME;
    const json = DAW.exportProject(currentName);
    if (window.electronAPI) {
      const currentBase = safeFileBase(currentName);
      const pathBase = projectPath ? safeFileBase(projectNameFromPath(projectPath)) : null;
      const targetPath = currentBase === pathBase ? projectPath : null;
      const result = await window.electronAPI.saveProject(json, currentName, targetPath);
      if (!result || result.saved === false) return;
      if (result.path && onProjectPathChange) onProjectPathChange(result.path);
    } else {
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = safeFileBase(currentName) + ".focus";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    saveRecentProject(currentName);
  }, [projectName, projectNameRef, projectPath, onProjectPathChange]);

  const playPause = useCallback(() => { DAW.isPlaying ? DAW.pause() : DAW.play(); }, []);

  useEffect(() => {
    const id = setInterval(() => saveRecentProject(projectName), 1500);
    return () => clearInterval(id);
  }, [projectName]);

  const handleSplit = useCallback((trackId, clipId, atSec) => {
    DAW.splitClip(trackId, clipId, atSec); force((n) => n + 1);
  }, []);
  const handleJoin = useCallback((trackId, clipIdA, clipIdB) => {
    DAW.joinClips(trackId, clipIdA, clipIdB); force((n) => n + 1);
  }, []);

  const reconnectProjectAudio = useCallback(async () => {
    if (!window.electronAPI) return;
    const missing = DAW.tracks.filter((t) => t.needsAudio && t.filePath);
    if (!missing.length) return;
    setLoading({ active: true, total: missing.length, done: 0, label: "Reconnecting audio..." });
    for (let i = 0; i < missing.length; i++) {
      const track = missing[i];
      setLoading({ active: true, total: missing.length, done: i, label: basenameFromPath(track.filePath) || track.name });
      try {
        const ab = await window.electronAPI.readAudioFile(track.filePath);
        await DAW.addFileBuffer(track.fileName || track.name, ab, { filePath: track.filePath });
      } catch (err) {
        console.warn("Failed to reconnect audio:", track.filePath, err);
      }
    }
    setLoading({ active: true, total: missing.length, done: missing.length, label: "Finalizing..." });
    setTimeout(() => setLoading(null), 220);
  }, []);

  const openProjectFile = useCallback(async (file) => {
    let text;
    let openedPath = null;
    if (window.electronAPI) {
      const opened = await window.electronAPI.openProject();
      if (!opened) return;
      text = typeof opened === "string" ? opened : opened.text;
      openedPath = typeof opened === "string" ? null : opened.path;
    } else if (file) {
      text = await file.text();
      openedPath = file.name;
    } else { return; }
    try {
      const json = JSON.parse(text);
      DAW.importProject(json);
      const nextName = json.projectName || projectNameFromPath(openedPath);
      if (onRenameProject) onRenameProject(nextName);
      if (openedPath && onProjectPathChange) onProjectPathChange(openedPath);
      await reconnectProjectAudio();
      fitTimelineToProject();
      saveRecentProject(nextName);
      force((n) => n + 1);
    } catch (err) { console.error("Failed to open project:", err); }
  }, [onRenameProject, onProjectPathChange, fitTimelineToProject, reconnectProjectAudio]);

  useEffect(() => {
    const k = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "s") { e.preventDefault(); saveProject(); return; }
      if (mod && e.key === "o") {
        e.preventDefault();
        if (window.electronAPI) openProjectFile(null);
        else focusRef.current && focusRef.current.click();
        return;
      }
      if (e.target.tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); playPause(); }
      if (!mod && (e.key === "s" || e.key === "S")) setTool("select");
      if (!mod && (e.key === "c" || e.key === "C")) setTool("scissors");
      if (!mod && (e.key === "j" || e.key === "J")) setTool("join");
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [playPause, saveProject, openProjectFile]);

  useEffect(() => {
    reconnectProjectAudio().then(() => {
      fitTimelineToProject();
      force((n) => n + 1);
    });
  }, [reconnectProjectAudio, fitTimelineToProject]);

  const addFiles = async (files, rootOnly = false) => {
    const audioFiles = files.filter((f) => {
      const rel = f.webkitRelativePath || "";
      const isNested = rel && rel.split("/").filter(Boolean).length > 2;
      return !(rootOnly && isNested) && /\.(mp3|wav|aiff?|m4a|ogg|flac)$/i.test(f.name);
    });
    if (!audioFiles.length) return;
    setLoading({ active: true, total: audioFiles.length, done: 0, label: "Preparing files..." });
    for (let i = 0; i < audioFiles.length; i++) {
      const f = audioFiles[i];
      setLoading({ active: true, total: audioFiles.length, done: i, label: f.name });
      try { await DAW.addFile(f); } catch (e) { console.error("Failed to add", f.name, e); }
    }
    fitTimelineToProject();
    saveRecentProject(projectName);
    setLoading({ active: true, total: audioFiles.length, done: audioFiles.length, label: "Finalizing..." });
    setTimeout(() => setLoading(null), 220);
    force((n) => n + 1);
  };
  const addElectronFiles = useCallback(async (items) => {
    if (!items.length) return;
    setLoading({ active: true, total: items.length, done: 0, label: "Preparing files..." });
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setLoading({ active: true, total: items.length, done: i, label: item.name });
      try {
        const ab = await window.electronAPI.readAudioFile(item.path);
        await DAW.addFileBuffer(item.name, ab, { filePath: item.path, displayName: item.displayName });
      } catch (e) { console.error("Failed to add", item.name, e); }
    }
    fitTimelineToProject();
    saveRecentProject(projectName);
    setLoading({ active: true, total: items.length, done: items.length, label: "Finalizing..." });
    setTimeout(() => setLoading(null), 220);
    force((n) => n + 1);
  }, [fitTimelineToProject, projectName]);

  const pickAudioFiles = useCallback(async () => {
    if (window.electronAPI) {
      const items = await window.electronAPI.selectFiles();
      if (items.length) addElectronFiles(items);
    } else {
      fileRef.current && fileRef.current.click();
    }
  }, [addElectronFiles]);

  const pickAudioFolder = useCallback(async () => {
    if (window.electronAPI) {
      const items = await window.electronAPI.openFolder();
      if (items.length) addElectronFiles(items);
    } else {
      folderRef.current && folderRef.current.click();
    }
  }, [addElectronFiles]);

  const newProject = () => {
    const nextName = DEFAULT_PROJECT_NAME;
    DAW.clearTracks();
    if (onRenameProject) onRenameProject(nextName);
    if (onProjectPathChange) onProjectPathChange(null);
    fitTimelineRef.current = true;
    updateTimeMin();
    saveRecentProject(nextName);
    force((n) => n + 1);
  };
  const loadDemo = () => {
    const nextName = projectName || "Demo Session";
    DAW.addDemoTracks();
    if (onRenameProject) onRenameProject(nextName);
    if (onProjectPathChange) onProjectPathChange(null);
    fitTimelineRef.current = false;
    updateTimeMin();
    setPx(96);
    saveRecentProject(nextName);
    force((n) => n + 1);
  };
  // expose menu actions to parent
  useEffect(() => {
    registerHandlers({
      onNew: newProject,
      onImport: pickAudioFiles,
      onImportFolder: pickAudioFolder,
      onLoadDemo: loadDemo,
      onExport: () => setShowExport(true),
      onSave: saveProject,
      onOpenProject: window.electronAPI
        ? () => openProjectFile(null)
        : () => focusRef.current && focusRef.current.click(),
    });
  }, [registerHandlers, saveProject, openProjectFile, pickAudioFiles, pickAudioFolder, loadDemo, newProject]);

  const param = (id) => (k, v) => { DAW.setTrackParam(id, k, v); saveRecentProject(projectName); force((n) => n + 1); };
  const removeTrack = (id) => {
    const i = DAW.tracks.findIndex((t) => t.id === id);
    if (i >= 0) DAW.tracks.splice(i, 1);
    DAW._spectrum = null;
    saveRecentProject(projectName);
    force((n) => n + 1);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files];
    if (window.electronAPI) {
      const items = files
        .filter((f) => /\.(mp3|wav|aiff?|m4a|ogg|flac)$/i.test(f.name) && f.path)
        .map((f) => ({ name: f.name, displayName: f.name.replace(/\.(mp3|wav|aiff?|m4a|ogg|flac)$/i, ""), path: f.path }));
      if (items.length) { addElectronFiles(items); return; }
    }
    addFiles(files);
  };
  const onDragOver = (e) => { e.preventDefault(); if (!dragOver) setDragOver(true); };
  const onDragLeave = (e) => { if (e.currentTarget === e.target) setDragOver(false); };
  const empty = DAW.tracks.length === 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
      <input ref={fileRef} type="file" multiple accept=".mp3,.wav,.aiff,.m4a,.ogg,.flac" style={{ display: "none" }}
        onChange={(e) => { addFiles([...e.target.files]); e.target.value = ""; }} />
      <input ref={folderRef} type="file" webkitdirectory="" directory="" multiple style={{ display: "none" }}
        onChange={(e) => { addFiles([...e.target.files], true); e.target.value = ""; }} />
      <input ref={focusRef} type="file" accept=".focus,application/json" style={{ display: "none" }}
        onChange={(e) => { if (e.target.files[0]) { openProjectFile(e.target.files[0]); e.target.value = ""; } }} />

      {/* control bar */}
      <div style={{ height: 60, flex: "0 0 60px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "0 16px",
        background: "linear-gradient(180deg,var(--surface),var(--bg2))", borderBottom: "1px solid var(--line-strong)", position: "relative" }}>
        {/* left cluster: zoom + tools + row height */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <ZoomBar pxPerSec={pxPerSec} setPx={setPxFromUser} ampZoom={ampZoom} setAmp={setAmp} timeMin={timeMinPx} />
          <div style={{ width: 1, height: 30, background: "var(--line)" }} />
          <ToolBar tool={tool} setTool={setTool} />
          <div style={{ width: 1, height: 30, background: "var(--line)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, letterSpacing: ".06em" }}>TRACK SIZE</span>
            <Seg small value={laneH} onChange={setLaneH} options={[{ v: 68, l: "S" }, { v: 96, l: "M" }, { v: 132, l: "L" }]} />
          </div>
        </div>
        <TimelineMinimap arrangeRef={arrangeRef} pxPerSec={pxPerSec} playhead={playhead} viewState={timelineView} setPx={setPxFromUser} timeMin={timeMinPx} />
        {/* right cluster: actions */}
        <ActionBar onAddTrack={pickAudioFiles} onMixer={() => setShowMixer((s) => !s)} mixerOpen={showMixer} onExport={() => setShowExport(true)} />
      </div>

      {/* arrange scroll area (whole area is a dropzone) */}
      <div ref={arrangeRef} data-arrange-scroll="true" onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
        style={{ flex: 1, overflow: "auto", position: "relative", outline: dragOver && !empty ? "2px dashed var(--amber)" : "none", outlineOffset: -4 }}>
        {empty ? (
          <EmptyState dragOver={dragOver} onPick={pickAudioFiles} onPickFolder={pickAudioFolder} onDemo={loadDemo} />
        ) : (
          <React.Fragment>
            <Ruler pxPerSec={pxPerSec} playhead={playhead} onSeek={(t) => { DAW.seek(t); force((n) => n + 1); }} />
            {DAW.tracks.map((t, i) => (
              <TrackRow key={t.id} track={t} idx={i} pxPerSec={pxPerSec} ampZoom={ampZoom} laneH={laneH}
                playhead={playhead} level={DAW.getTrackLevel(t.id)} onParam={param(t.id)} onRemove={() => removeTrack(t.id)}
                onSeek={(time) => { DAW.seek(time); force((n) => n + 1); }}
                tool={tool} onSplit={handleSplit} onJoin={handleJoin} />
            ))}
            <OutputTrack pxPerSec={pxPerSec} laneH={Math.max(96, laneH * 0.9)} playhead={playhead}
              onSeek={(t) => { DAW.seek(t); force((n) => n + 1); }} />
            <div style={{ height: 40 }} />
          </React.Fragment>
        )}
      </div>

      {showMixer && <MixerWindow onClose={() => setShowMixer(false)} />}
      {showExport && <ExportDialog projectName={projectName} onClose={() => setShowExport(false)} />}
      <LoadingOverlay state={loading} />
    </div>
  );
}

/* ---------- root ---------- */
function App() {
  const [projectName, setProjectName] = useState(DEFAULT_PROJECT_NAME);
  const projectNameRef = useRef(DEFAULT_PROJECT_NAME);
  const [projectPath, setProjectPath] = useState(null);
  const handlersRef = useRef({});
  const [, force] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("focusdaw-theme") || "default");
  const registerHandlers = useCallback((h) => { handlersRef.current = h; }, []);
  const renameProject = useCallback((name) => {
    const nextName = name || DEFAULT_PROJECT_NAME;
    projectNameRef.current = nextName;
    setProjectName(nextName);
    setProjectPath(null);
  }, []);

  useEffect(() => {
    DAW.init();
    loadRecentProject((name) => {
      projectNameRef.current = name || DEFAULT_PROJECT_NAME;
      setProjectName(projectNameRef.current);
    });
    force((n) => n + 1);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "default") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    localStorage.setItem("focusdaw-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.title = `${projectName || DEFAULT_PROJECT_NAME}-FocusDAW Studio`;
  }, [projectName]);

  const H = handlersRef.current;
  return (
    <div className="app">
      <MenuBar projectName={projectName} onRename={renameProject}
        onNew={() => H.onNew && H.onNew()} onImport={() => H.onImport && H.onImport()}
        onImportFolder={() => H.onImportFolder && H.onImportFolder()} onLoadDemo={() => H.onLoadDemo && H.onLoadDemo()}
        onExport={() => H.onExport && H.onExport()}
        onSave={() => H.onSave && H.onSave()}
        onOpenProject={() => H.onOpenProject && H.onOpenProject()}
        onSettings={() => setShowSettings(true)} />
      <Studio projectName={projectName} projectNameRef={projectNameRef} projectPath={projectPath}
        registerHandlers={registerHandlers}
        onRenameProject={renameProject}
        onProjectPathChange={setProjectPath} />
      {showSettings && <SettingsDialog currentTheme={theme} onThemeChange={setTheme} onClose={() => setShowSettings(false)} />}
      <div className="bottombar">
        <span className="bottom-project mono">{projectName || DEFAULT_PROJECT_NAME}</span>
        <span className="version-badge">{APP_VERSION}</span>
      </div>
    </div>
  );
}

DAW.init();
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
