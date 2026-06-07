/* ================= FocusDAW — main app ================= */

const MENUS = ["File", "Edit", "View", "Track", "Transport", "Window", "Help"];

function TitleBar({ projectName }) {
  return (
    <div className="titlebar">
      <div className="lights"><span className="light l-r" /><span className="light l-y" /><span className="light l-g" /></div>
      <div className="title-c"><b>FocusDAW</b> &nbsp;—&nbsp; {projectName || "Untitled Project"} <span style={{ color: "var(--faint)" }}>· 120 BPM</span></div>
      <span className="title-badge">Electron</span>
    </div>
  );
}
function MenuBar() {
  return (
    <div className="menubar">
      <div style={{ display: "flex", alignItems: "center", paddingRight: 6 }}><Logo size={16} /></div>
      {MENUS.map((m) => <div key={m} className="menu-item">{m}</div>)}
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
          background: playing ? "var(--surface3)" : "var(--amber)", color: playing ? "var(--cream)" : "#241a0a", border: "1px solid " + (playing ? "var(--line-strong)" : "var(--amber)") }}>
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
      <button className="btn primary" onClick={onExport}><Icon name="download" size={15} /> Export MP3</button>
    </div>
  );
}
function ToolGroup({ children }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", background: "var(--bg)", borderRadius: 9, border: "1px solid var(--line)" }}>{children}</div>;
}

/* ---------- studio (arrange) ---------- */
function Studio({ projectName }) {
  useTick();
  const [pxPerSec, setPx] = useState(96);
  const [ampZoom, setAmp] = useState(1);
  const [loop, setLoop] = useState(true);
  const [showMixer, setShowMixer] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [laneH, setLaneH] = useState(96);
  const [, force] = useState(0);
  const playing = DAW.isPlaying;
  const playhead = DAW.getPlayhead();

  const playPause = useCallback(() => { DAW.isPlaying ? DAW.pause() : DAW.play(); }, []);
  useEffect(() => {
    const k = (e) => { if (e.code === "Space" && e.target.tagName !== "INPUT") { e.preventDefault(); playPause(); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [playPause]);

  const addFiles = async (files) => { for (const f of files) { try { await DAW.addFile(f); } catch (e) {} } force((n) => n + 1); };
  const param = (id) => (k, v) => { DAW.setTrackParam(id, k, v); force((n) => n + 1); };
  const removeTrack = (id) => { const i = DAW.tracks.findIndex((t) => t.id === id); if (i >= 0) DAW.tracks.splice(i, 1); force((n) => n + 1); };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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

      {/* arrange scroll area */}
      <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
        <Ruler pxPerSec={pxPerSec} playhead={playhead} onSeek={(t) => { DAW.seek(t); force((n) => n + 1); }} />
        {DAW.tracks.map((t, i) => (
          <TrackRow key={t.id} track={t} idx={i} pxPerSec={pxPerSec} ampZoom={ampZoom} laneH={laneH}
            playhead={playhead} level={DAW.getTrackLevel(t.id)} onParam={param(t.id)} onRemove={() => removeTrack(t.id)}
            onSeek={(time) => { DAW.seek(time); force((n) => n + 1); }} />
        ))}
        <OutputTrack pxPerSec={pxPerSec} laneH={Math.max(96, laneH * 0.9)} playhead={playhead}
          onSeek={(t) => { DAW.seek(t); force((n) => n + 1); }} />
        <div style={{ height: 40 }} />
      </div>

      {showMixer && <MixerWindow onClose={() => setShowMixer(false)} />}
      {showExport && <ExportDialog projectName={projectName} onClose={() => setShowExport(false)} />}
    </div>
  );
}

/* ---------- root ---------- */
function App() {
  const [screen, setScreen] = useState("loader");
  const [projectName, setProjectName] = useState("");
  useEffect(() => { DAW.init(); }, []);
  return (
    <div className="app">
      <TitleBar projectName={projectName} />
      <MenuBar />
      {screen === "loader"
        ? <LoaderScreen onOpen={(name) => { setProjectName(name); setScreen("studio"); }} />
        : <Studio projectName={projectName} />}
    </div>
  );
}

DAW.init();
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
