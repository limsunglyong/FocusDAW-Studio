/* ================= FocusDAW — main app ================= */

const MENUS = ["Edit", "View", "Track", "Transport", "Window", "Help"];

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
    <div ref={ref} style={{ position: "relative" }}>
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

function MenuBar({ projectName, onRename, onNew, onImport, onImportFolder, onLoadDemo, onExport }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(projectName);
  useEffect(() => setDraft(projectName), [projectName]);
  const commit = () => { onRename(draft.trim() || "Untitled Project"); setEditing(false); };
  const projectItems = [
    { label: "New Project", icon: "plus", hint: "\u2318N", onClick: onNew },
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
      {MENUS.map((m) => <div key={m} className="menu-item">{m}</div>)}
      <div style={{ flex: 1 }} />
      {/* project name, right-aligned, inline-editable */}
      {editing ? (
        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          style={{ background: "var(--bg)", border: "1px solid var(--amber-deep)", borderRadius: 6, color: "var(--cream)",
            fontFamily: "var(--ui)", fontSize: 12.5, padding: "3px 8px", outline: "none", width: 240, textAlign: "right" }} />
      ) : (
        <div onClick={() => setEditing(true)} title="Rename project"
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 10px", borderRadius: 7, cursor: "text", whiteSpace: "nowrap", flex: "0 0 auto" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
          <Icon name="disc" size={13} style={{ color: "var(--faint)", flex: "0 0 auto" }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--cream-2)", whiteSpace: "nowrap" }}>{projectName || "Untitled Project"}</span>
          <span className="mono" style={{ fontSize: 10, color: "var(--faint)", flex: "0 0 auto" }}>120 BPM</span>
        </div>
      )}
    </div>
  );
}

/* ---------- transport ---------- */
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
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "3px 14px", background: "var(--bg)", borderRadius: 9, border: "1px solid var(--line)", minWidth: 110 }}>
        <span className="mono" style={{ fontSize: 19, fontWeight: 700, color: "var(--amber)", letterSpacing: ".02em" }}>{fmtTime(playhead)}</span>
        <span className="mono" style={{ fontSize: 9, color: "var(--faint)", letterSpacing: ".1em" }}>BAR {Math.floor(playhead / DAW.secPerBar) + 1} · 120 BPM</span>
      </div>
    </div>
  );
}

/* ---------- toolbar (zoom / tools / actions) ---------- */
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
function ZoomBar({ pxPerSec, setPx, ampZoom, setAmp }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <ZoomGroup label="TIME"
        onMinus={() => setPx(Math.max(28, pxPerSec / 1.4))} onPlus={() => setPx(Math.min(420, pxPerSec * 1.4))}
        sliderProps={{ value: pxPerSec, min: 28, max: 420, step: 1, onChange: setPx, width: 108 }} />
      <ZoomGroup label="AMP"
        onMinus={() => setAmp(Math.max(0.4, ampZoom - 0.3))} onPlus={() => setAmp(Math.min(3, ampZoom + 0.3))}
        sliderProps={{ value: ampZoom, min: 0.4, max: 3, step: 0.05, onChange: setAmp, width: 96 }} />
    </div>
  );
}
function ActionBar({ onAddFiles, onMixer, mixerOpen, onExport }) {
  const fileRef = useRef(null);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
      <input ref={fileRef} type="file" multiple accept=".mp3,.wav,.aiff,.m4a,.ogg,.flac" style={{ display: "none" }}
        onChange={(e) => { onAddFiles([...e.target.files]); e.target.value = ""; }} />
      <button className="btn" onClick={() => fileRef.current.click()}><Icon name="plus" size={15} /> Track</button>
      <button className={"btn" + (mixerOpen ? " primary" : "")} onClick={onMixer}><Icon name="mixer" size={15} /> Mixer</button>
      <button className="btn" onClick={onExport}><Icon name="download" size={15} /> Export MP3</button>
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

/* ---------- studio (arrange) ---------- */
function Studio({ projectName, registerHandlers }) {
  useTick();
  const [pxPerSec, setPx] = useState(96);
  const [ampZoom, setAmp] = useState(1);
  const [loop, setLoop] = useState(true);
  const [showMixer, setShowMixer] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [laneH, setLaneH] = useState(96);
  const [dragOver, setDragOver] = useState(false);
  const [, force] = useState(0);
  const fileRef = useRef(null);
  const folderRef = useRef(null);
  const playing = DAW.isPlaying;
  const playhead = DAW.getPlayhead();

  const playPause = useCallback(() => { DAW.isPlaying ? DAW.pause() : DAW.play(); }, []);
  useEffect(() => {
    const k = (e) => { if (e.code === "Space" && e.target.tagName !== "INPUT") { e.preventDefault(); playPause(); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [playPause]);

  const addFiles = async (files) => {
    for (const f of files) { if (/\.(mp3|wav|aiff?|m4a|ogg|flac)$/i.test(f.name)) { try { await DAW.addFile(f); } catch (e) {} } }
    force((n) => n + 1);
  };
  const newProject = () => { DAW.clearTracks(); force((n) => n + 1); };
  const loadDemo = () => { DAW.addDemoTracks(); force((n) => n + 1); };
  // expose menu actions to parent
  useEffect(() => {
    registerHandlers({
      onNew: newProject,
      onImport: () => fileRef.current.click(),
      onImportFolder: () => folderRef.current.click(),
      onLoadDemo: loadDemo,
      onExport: () => setShowExport(true),
    });
  }, [registerHandlers]);

  const param = (id) => (k, v) => { DAW.setTrackParam(id, k, v); force((n) => n + 1); };
  const removeTrack = (id) => { const i = DAW.tracks.findIndex((t) => t.id === id); if (i >= 0) DAW.tracks.splice(i, 1); DAW._spectrum = null; force((n) => n + 1); };

  const onDrop = (e) => { e.preventDefault(); setDragOver(false); addFiles([...e.dataTransfer.files]); };
  const onDragOver = (e) => { e.preventDefault(); if (!dragOver) setDragOver(true); };
  const onDragLeave = (e) => { if (e.currentTarget === e.target) setDragOver(false); };
  const empty = DAW.tracks.length === 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <input ref={fileRef} type="file" multiple accept=".mp3,.wav,.aiff,.m4a,.ogg,.flac" style={{ display: "none" }}
        onChange={(e) => { addFiles([...e.target.files]); e.target.value = ""; }} />
      <input ref={folderRef} type="file" webkitdirectory="" directory="" multiple style={{ display: "none" }}
        onChange={(e) => { addFiles([...e.target.files]); e.target.value = ""; }} />

      {/* control bar */}
      <div style={{ height: 60, flex: "0 0 60px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "0 16px",
        background: "linear-gradient(180deg,var(--surface),var(--bg2))", borderBottom: "1px solid var(--line-strong)", position: "relative" }}>
        {/* left cluster: zoom + row height */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <ZoomBar pxPerSec={pxPerSec} setPx={setPx} ampZoom={ampZoom} setAmp={setAmp} />
          <div style={{ width: 1, height: 30, background: "var(--line)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, letterSpacing: ".06em" }}>ROW H</span>
            <Seg small value={laneH} onChange={setLaneH} options={[{ v: 68, l: "S" }, { v: 96, l: "M" }, { v: 132, l: "L" }]} />
          </div>
        </div>
        {/* centered transport */}
        <div style={{ position: "absolute", left: "50%", top: 0, height: "100%", transform: "translateX(-50%)", display: "flex", alignItems: "center", zIndex: 5 }}>
          <Transport playing={playing} playhead={playhead} loop={loop}
            onPlay={playPause} onStop={() => { DAW.stop(); force((n) => n + 1); }} onToStart={() => { DAW.seek(0); force((n) => n + 1); }}
            onLoop={() => setLoop((l) => !l)} />
        </div>
        {/* right cluster: actions */}
        <ActionBar onAddFiles={addFiles} onMixer={() => setShowMixer((s) => !s)} mixerOpen={showMixer} onExport={() => setShowExport(true)} />
      </div>

      {/* arrange scroll area (whole area is a dropzone) */}
      <div onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
        style={{ flex: 1, overflow: "auto", position: "relative", outline: dragOver && !empty ? "2px dashed var(--amber)" : "none", outlineOffset: -4 }}>
        {empty ? (
          <EmptyState dragOver={dragOver} onPick={() => fileRef.current.click()} onPickFolder={() => folderRef.current.click()} onDemo={loadDemo} />
        ) : (
          <React.Fragment>
            <Ruler pxPerSec={pxPerSec} playhead={playhead} onSeek={(t) => { DAW.seek(t); force((n) => n + 1); }} />
            {DAW.tracks.map((t, i) => (
              <TrackRow key={t.id} track={t} idx={i} pxPerSec={pxPerSec} ampZoom={ampZoom} laneH={laneH}
                playhead={playhead} level={DAW.getTrackLevel(t.id)} onParam={param(t.id)} onRemove={() => removeTrack(t.id)}
                onSeek={(time) => { DAW.seek(time); force((n) => n + 1); }} />
            ))}
            <OutputTrack pxPerSec={pxPerSec} laneH={Math.max(96, laneH * 0.9)} playhead={playhead}
              onSeek={(t) => { DAW.seek(t); force((n) => n + 1); }} />
            <div style={{ height: 40 }} />
          </React.Fragment>
        )}
      </div>

      {showMixer && <MixerWindow onClose={() => setShowMixer(false)} />}
      {showExport && <ExportDialog projectName={projectName} onClose={() => setShowExport(false)} />}
    </div>
  );
}

/* ---------- root ---------- */
function App() {
  const [projectName, setProjectName] = useState("Midnight Drive \u2014 Stems");
  const handlersRef = useRef({});
  const [, force] = useState(0);
  const registerHandlers = useCallback((h) => { handlersRef.current = h; }, []);
  useEffect(() => { DAW.init(); force((n) => n + 1); }, []);
  const H = handlersRef.current;
  return (
    <div className="app">
      <MenuBar projectName={projectName} onRename={setProjectName}
        onNew={() => H.onNew && H.onNew()} onImport={() => H.onImport && H.onImport()}
        onImportFolder={() => H.onImportFolder && H.onImportFolder()} onLoadDemo={() => H.onLoadDemo && H.onLoadDemo()}
        onExport={() => H.onExport && H.onExport()} />
      <Studio projectName={projectName} registerHandlers={registerHandlers} />
    </div>
  );
}

DAW.init();
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
