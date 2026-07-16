/* ================= FocusDAW — main app ================= */

const RECENT_PROJECT_KEY = "focusdaw-recent-project";
const RECENT_PROJECT_LIST_KEY = "focusdaw-recent-project-list";
const DEFAULT_PROJECT_NAME = "untitled";
const APP_VERSION = "v" + (window.APP_VERSION || "0.0.0"); // source: version.js

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

// Folder name that contains the given file path (e.g. ".../MySong/drums.wav" -> "MySong").
function parentFolderName(filePath) {
  const parts = (filePath || "").split(/[\\/]/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : "";
}

function readDirectoryEntryRootFiles(entry) {
  return new Promise((resolve) => {
    if (!entry || !entry.isDirectory || !entry.createReader) {
      resolve([]);
      return;
    }
    const reader = entry.createReader();
    const entries = [];
    const readNext = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          const fileEntries = entries.filter((item) => item && item.isFile && item.file);
          Promise.all(fileEntries.map((fileEntry) => new Promise((done) => {
            fileEntry.file((file) => done(file), () => done(null));
          }))).then((files) => resolve(files.filter(Boolean)));
          return;
        }
        entries.push(...batch);
        readNext();
      }, () => resolve([]));
    };
    readNext();
  });
}

function recentProjectId(projectName, projectPath) {
  return projectPath ? `path:${projectPath}` : `autosave:${projectName || DEFAULT_PROJECT_NAME}`;
}

function readRecentProjectSnapshot() {
  try {
    const raw = localStorage.getItem(RECENT_PROJECT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn("Failed to read recent project:", err);
    localStorage.removeItem(RECENT_PROJECT_KEY);
    return null;
  }
}

function readRecentProjectList() {
  try {
    const raw = localStorage.getItem(RECENT_PROJECT_LIST_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => x && x.path && x.json).slice(0, 10) : [];
  } catch (err) {
    console.warn("Failed to read recent project list:", err);
    localStorage.removeItem(RECENT_PROJECT_LIST_KEY);
    return [];
  }
}

function saveRecentProject(projectName, projectPath = null, options = {}) {
  try {
    const json = DAW.exportProject(projectName);
    json.projectPath = projectPath || null;
    const now = Date.now();
    const entry = {
      id: recentProjectId(projectName, projectPath),
      name: projectName || DEFAULT_PROJECT_NAME,
      path: projectPath || null,
      updatedAt: now,
      json,
    };
    localStorage.setItem(RECENT_PROJECT_KEY, JSON.stringify(json));
    if (!options.updateSavedList || !projectPath) return;

    const list = readRecentProjectList().filter((item) => item.id !== entry.id);
    list.unshift(entry);
    localStorage.setItem(RECENT_PROJECT_LIST_KEY, JSON.stringify(list.slice(0, 10)));
  } catch (err) {
    console.warn("Failed to save recent project:", err);
  }
}

function loadRecentProject(onRename, onPath) {
  const json = readRecentProjectSnapshot();
  if (!json) {
    DAW.clearTracks();
    return false;
  }
  try {
    DAW.importProject(json);
    if (json.projectName && onRename) onRename(json.projectName);
    if (onPath) onPath(json.projectPath || null);
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
  const [hoveredSubmenu, setHoveredSubmenu] = useState(null);
  const ref = useRef(null);
  const submenuTimerRef = useRef(null);
  const showSubmenu = (idx) => {
    if (submenuTimerRef.current) clearTimeout(submenuTimerRef.current);
    submenuTimerRef.current = null;
    setHoveredSubmenu(idx);
  };
  const hideSubmenuSoon = (idx) => {
    if (submenuTimerRef.current) clearTimeout(submenuTimerRef.current);
    submenuTimerRef.current = setTimeout(() => {
      setHoveredSubmenu((cur) => (cur === idx ? null : cur));
      submenuTimerRef.current = null;
    }, 220);
  };
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => {
      window.removeEventListener("mousedown", h);
      if (submenuTimerRef.current) clearTimeout(submenuTimerRef.current);
    };
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
            <div key={i} style={{ position: "relative" }}
              onMouseEnter={() => it.submenu ? showSubmenu(i) : setHoveredSubmenu(null)}
              onMouseLeave={() => it.submenu && hideSubmenuSoon(i)}>
              <div onClick={() => { if (it.disabled) return; setOpen(false); it.onClick && it.onClick(); }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 7, cursor: it.disabled ? "default" : "pointer", fontSize: 12.5, opacity: it.disabled ? 0.38 : 1 }}
                onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = "var(--surface3)"; }}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                {it.icon && <Icon name={it.icon} size={15} style={{ color: "var(--amber)", flex: "0 0 auto" }} />}
                <span style={{ flex: 1 }}>{it.label}</span>
                {it.hint && <span className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>{it.hint}</span>}
                {it.submenu && <span style={{ color: "var(--faint)", marginLeft: 2 }}>›</span>}
              </div>
              {it.submenu && hoveredSubmenu === i && (
                <React.Fragment>
                <div style={{ position: "absolute", left: "100%", top: -6, width: 12, height: "calc(100% + 12px)", zIndex: 255 }} />
                <div style={{ position: "absolute", left: "calc(100% + 6px)", top: -6, width: 280, maxHeight: 380, overflow: "auto",
                  background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: 10, boxShadow: "var(--shadow)", padding: 6, zIndex: 260 }}>
                  {it.submenu.map((sub, si) => sub.sep ? (
                    <div key={si} style={{ height: 1, background: "var(--line)", margin: "5px 6px" }} />
                  ) : sub.header ? (
                    <div key={si} style={{ padding: "7px 9px 5px", fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>{sub.label}</div>
                  ) : (
                    <div key={si} onClick={(e) => { e.stopPropagation(); if (sub.disabled) return; setOpen(false); sub.onClick && sub.onClick(); }}
                      style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 34, padding: "7px 9px", borderRadius: 7,
                        cursor: sub.disabled ? "default" : "pointer", opacity: sub.disabled ? 0.42 : 1 }}
                      onMouseEnter={(e) => { if (!sub.disabled) e.currentTarget.style.background = "var(--surface3)"; }}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                      {sub.icon && <Icon name={sub.icon} size={14} style={{ color: "var(--amber)", flex: "0 0 auto" }} />}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12.2, color: "var(--cream-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub.label}</div>
                        {sub.detail && <div className="mono" style={{ marginTop: 2, fontSize: 9.5, color: "var(--faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub.detail}</div>}
                      </div>
                    </div>
                  ))}
                </div>
                </React.Fragment>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WindowControls() {
  if (!window.electronAPI || window.electronAPI.platform === "darwin") return null;
  const act = (e, name) => {
    e.currentTarget.blur();
    window.electronAPI.winAction(name);
  };
  const suppressFocus = (e) => e.preventDefault();
  return (
    <div className="window-controls" aria-label="Window controls">
      <button className="window-control" onMouseDown={suppressFocus} onClick={(e) => act(e, "minimize")} title="Minimize" aria-label="Minimize">
        <span aria-hidden="true">-</span>
      </button>
      <button className="window-control" onMouseDown={suppressFocus} onClick={(e) => act(e, "maximize")} title="Maximize" aria-label="Maximize">
        <span aria-hidden="true">□</span>
      </button>
      <button className="window-control close" onMouseDown={suppressFocus} onClick={(e) => act(e, "close")} title="Close" aria-label="Close">
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

function recentDateLabel(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function MenuBar({ projectName, onRename, onNew, onImport, onImportFolder, onLoadDemo, onExport, onSave, onSaveAs, onOpenProject, onOpenRecentProject, onSettings, onAdvancedAmbience, onAdvancedPan, onAdvancedEq, onUndo, onRedo, canUndo, canRedo, onDeleteAllTracks, onHelpManual, onHelpReleaseNotes, onHelpAbout }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(projectName);
  useEffect(() => setDraft(projectName), [projectName]);
  const commit = () => { onRename(draft.trim() || DEFAULT_PROJECT_NAME); setEditing(false); };
  const updateDraft = (value) => {
    setDraft(value);
    if (value.trim()) onRename(value.trim());
  };
  const currentRecent = readRecentProjectSnapshot();
  const recentList = readRecentProjectList();
  const currentRecentName = (currentRecent && currentRecent.projectName) || projectName || DEFAULT_PROJECT_NAME;
  const currentRecentPath = (currentRecent && currentRecent.projectPath) || null;
  const recentSubmenu = [
    { header: true, label: "Recent project" },
    currentRecent
      ? { label: currentRecentName, detail: currentRecentPath || "Autosaved exit/current state", icon: currentRecentPath ? "folder" : "disc", onClick: () => onOpenRecentProject && onOpenRecentProject(currentRecent, currentRecentPath) }
      : { label: "No autosaved project", disabled: true },
    { sep: true },
    { header: true, label: "Recent saved" },
    // The project you just saved must stay listed here. This used to filter out
    // the currently-open project, so saving "a123.focus" made it vanish from
    // Recent saved and appear only under Recent project — the opposite of what
    // saving should look like. The two sections mean different things ("Recent
    // project" = autosaved current state, possibly with unsaved edits; "Recent
    // saved" = the .focus files on disk), so listing it in both is correct.
    ...recentList
      .slice(0, 10)
      .map((item) => ({
        label: item.name || DEFAULT_PROJECT_NAME,
        detail: item.path || recentDateLabel(item.updatedAt) || "Autosaved session",
        icon: item.path ? "folder" : "disc",
        onClick: () => onOpenRecentProject && onOpenRecentProject(item.json, item.path || null),
      })),
  ];
  if (recentSubmenu[recentSubmenu.length - 1].header) {
    recentSubmenu.push({ label: "No recent work", disabled: true });
  }

  const projectItems = [
    { label: "New Project", icon: "plus", hint: "\u2318N", onClick: onNew },
    { sep: true },
    { label: "Open Project\u2026", icon: "folder", hint: "\u2318O", onClick: onOpenProject, submenu: recentSubmenu },
    { label: "Save Project", icon: "download", hint: "\u2318S", onClick: onSave },
    { label: "Save As\u2026", icon: "download", onClick: onSaveAs },
    { sep: true },
    { label: "Import Stem Folder\u2026", icon: "folder", onClick: onImportFolder },
    { label: "Import Audio Files\u2026", icon: "wave", onClick: onImport },
    { label: "Load Demo Session", icon: "disc", onClick: onLoadDemo },
    { sep: true },
    { label: "Export\u2026", icon: "download", hint: "\u2318E", onClick: onExport },
  ];
  const editItems = [
    { label: "Undo", icon: "undo", hint: "Ctrl+Z", onClick: onUndo, disabled: !canUndo },
    { label: "Redo", icon: "redo", hint: "Ctrl+Y", onClick: onRedo, disabled: !canRedo },
    { sep: true },
    { label: "Delete all tracks", icon: "trash", onClick: onDeleteAllTracks },
  ];
  const advancedItems = [
    { label: "Ambience", icon: "disc", onClick: onAdvancedAmbience },
    { label: "Auto Panning", icon: "auto", onClick: onAdvancedPan },
    { label: "Equalizer Setup", icon: "eq", onClick: onAdvancedEq },
  ];
  const helpItems = [
    { label: "Manual", icon: "book", onClick: onHelpManual },
    { label: "Release Notes", icon: "info", onClick: onHelpReleaseNotes },
    { label: "About", icon: "info", onClick: onHelpAbout },
  ];
  return (
    <div className="menubar">
      <div style={{ display: "flex", alignItems: "center", paddingRight: 6 }}><Logo size={30} /></div>
      <Dropdown label="Project" items={projectItems} accent />
      <Dropdown label="Edit" items={editItems} />
      <Dropdown label="Advanced Effects" items={advancedItems} />
      <div className="menu-item" onClick={onSettings} style={{ cursor: "pointer" }}>Settings</div>
      <Dropdown label="Help" items={helpItems} />
      <div style={{ position: "absolute", left: "50%", top: 0, height: "100%", transform: "translateX(-50%)", display: "flex", alignItems: "center", zIndex: 3 }}>
        <MenuTransport />
      </div>
      <div style={{ flex: 1 }} />
      {/* project name, right-aligned, inline-editable */}
      {editing ? (
        <input className="project-name-edit" autoFocus value={draft} onChange={(e) => updateDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          style={{ alignSelf: "center", background: "var(--bg)", border: "1px solid var(--amber-deep)", borderRadius: 6, color: "var(--cream)",
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
  const handleClick = (e) => {
    if (onClick) onClick(e);
    e.currentTarget.blur();
  };
  return (
    <button onClick={handleClick} title={title}
      style={{ width: wide ? 34 : 27, height: 27, borderRadius: 999, display: "grid", placeItems: "center",
        outline: "none",
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

function fmtTransportTime(s) {
  const v = Math.max(0, Number.isFinite(s) ? s : 0);
  const m = Math.floor(v / 60);
  const sec = Math.floor(v % 60);
  const ms = Math.floor((v % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}

function MenuTransport() {
  useTick();
  const loop = DAW.loopEnabled; // source of truth (useTick re-renders each frame)
  const playing = DAW.isPlaying;
  const playhead = DAW.getPlayhead();
  const duration = DAW.duration || 0;
  const armedInput = DAW.tracks.find((t) => t.kind === "audioIn" && t.params && t.params.arm);
  const recordingInput = DAW.tracks.find((t) => t.kind === "audioIn" && t.recording);
  const canRecord = !!(armedInput || recordingInput);
  // All transport actions go through Studio's rule-honoring handlers (count-in,
  // Repeat off/restore, ignore pause/return-to-start while recording, etc.).
  const tp = (action) => window.dispatchEvent(new CustomEvent("focusdaw-transport", { detail: { action } }));
  const toggleLoop = () => { DAW.setLoop(!loop); };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, height: 36 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, height: 32, padding: "2px 4px",
        borderRadius: 999, background: "linear-gradient(180deg,var(--bg2),var(--bg))",
        border: "1px solid var(--line-strong)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.04), 0 8px 18px -14px rgba(0,0,0,.8)" }}>
        <MenuTransportButton title="Return to start" onClick={() => tp("tostart")}>
          <Icon name="toStart" size={13} />
        </MenuTransportButton>
        <MenuTransportButton title="Stop" onClick={() => tp("stop")}>
          <Icon name="stop" size={11} fill />
        </MenuTransportButton>
        <MenuTransportButton title="Play / Pause" active={playing} wide onClick={() => tp("playpause")}>
          <Icon name={playing ? "pause" : "play"} size={14} fill />
        </MenuTransportButton>
        <MenuTransportButton title="Loop" active={loop} onClick={toggleLoop}>
          <Icon name="repeat" size={13} />
        </MenuTransportButton>
        <MenuTransportButton title={recordingInput ? "Stop recording" : canRecord ? "Record armed Audio In track" : "Arm an Audio In track first"}
          active={!!recordingInput} onClick={() => tp("record")}>
          <span className={recordingInput ? "record-blink" : undefined}
            style={{ display: "block", width: recordingInput ? 11 : 9, height: recordingInput ? 11 : 9,
              borderRadius: recordingInput ? 4 : "50%", background: canRecord ? "var(--red)" : "var(--dim)",
              transformOrigin: "center" }} />
        </MenuTransportButton>
      </div>
      <div title={`${fmtTransportTime(playhead)} / ${fmtTransportTime(duration)}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0 15px",
        background: "linear-gradient(180deg,var(--surface2),var(--bg))", borderRadius: 999,
        border: "1px solid var(--line-strong)", minWidth: 168, height: 32,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)" }}>
        <span className="mono" style={{ fontSize: 18, fontWeight: 400, color: "var(--amber)", lineHeight: 1 }}>{fmtTransportTime(playhead)}</span>
        <span className="mono" style={{ fontSize: 10.8, fontWeight: 400, color: "var(--muted)", lineHeight: 1 }}>/ {fmtTransportTime(duration)}</span>
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
        <button className={"iconbtn" + (loop ? " on" : "")} onClick={onLoop} title="Loop"><Icon name="repeat" size={16} /></button>
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
const TOOLBAR_PANEL_H = 52;

function timelineMinPx(containerWidth) {
  const width = containerWidth || window.innerWidth || 1980;
  const visibleLaneW = Math.max(320, width - HEADER_W - 16);
  const dur = Math.max(1, DAW.duration || 1);
  const fitPx = visibleLaneW / dur;
  return Math.max(0.05, Math.min(TIME_ZOOM_MAX, fitPx));
}

function timelineStep(minPx) {
  if (minPx < 1) return 0.01;
  if (minPx < 10) return 0.1;
  return 1;
}

function ZoomGroup({ label, onMinus, onPlus, sliderProps }) {
  return (
    <div style={{ height: TOOLBAR_PANEL_H, display: "flex", flexDirection: "column", justifyContent: "center", gap: 5, padding: "5px 9px", background: "var(--bg)", borderRadius: 10, border: "1px solid var(--line)" }}>
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
  // Use log scale so equal slider movements = equal zoom ratio changes (same feel at all zoom levels).
  const logMin = Math.log(Math.max(0.1, timeMin));
  const logMax = Math.log(TIME_ZOOM_MAX);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <ZoomGroup label="TIME"
        onMinus={() => setPx(Math.max(timeMin, pxPerSec / 1.4))} onPlus={() => setPx(Math.min(TIME_ZOOM_MAX, pxPerSec * 1.4))}
        sliderProps={{ value: Math.log(Math.max(0.1, pxPerSec)), min: logMin, max: logMax, step: 0.005,
          onChange: (v) => setPx(Math.exp(v)), width: 108,
          // log-scale zoom: wheel multiplies px/sec (matches minimap scroll-zoom) so one notch
          // always clears the "snap to fit-width minimum" deadzone in setPxFromUser.
          onWheel: (dir) => setPx(Math.max(timeMin, Math.min(TIME_ZOOM_MAX, pxPerSec * (dir > 0 ? 1.18 : 1 / 1.18)))) }} />
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
function ActionBar({ onMixer, mixerOpen, onExport }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
      <button className={"btn" + (mixerOpen ? " primary" : "")} onClick={(e) => { onMixer(); e.currentTarget.blur(); }}><Icon name="mixer" size={15} /> Mixer</button>
      <button className="btn" onClick={onExport} title="Export mixdown (MP3 / WAV)"><Icon name="download" size={15} /> Export</button>
    </div>
  );
}

function VariSwitch({ label, title, on, onToggle }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, height: TOOLBAR_PANEL_H, flex: "0 0 auto" }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".07em", lineHeight: 1, whiteSpace: "nowrap", color: on ? "var(--amber)" : "var(--muted)" }}>{label}</span>
      <button role="switch" aria-checked={on} onClick={onToggle} title={title}
        style={{ width: 40, height: 20, padding: 0, borderRadius: 999, position: "relative", cursor: "pointer",
          border: "1px solid " + (on ? "var(--amber)" : "var(--line-strong)"),
          background: on ? "var(--amber)" : "var(--surface2)", transition: "background .15s, border-color .15s" }}>
        <span style={{ position: "absolute", top: 1.5, left: on ? 21.5 : 1.5, width: 15, height: 15, borderRadius: "50%",
          background: on ? "var(--accent-fg)" : "var(--dim)", boxShadow: "0 1px 2px rgba(0,0,0,.4)", transition: "left .15s, background .15s" }} />
      </button>
    </div>
  );
}

function VariBpmSwitch({ on, onToggle }) {
  return (
    <VariSwitch label="Vari BPM" on={on} onToggle={onToggle}
      title="Vari BPM: 켜면 재생(Playback) BPM으로 곡 전체 속도를 조정합니다. 끄면 속도가 변하지 않습니다." />
  );
}

function VariKeySwitch({ on, onToggle }) {
  return (
    <VariSwitch label="Vari Key" on={on} onToggle={onToggle}
      title="Vari Key: 곡의 Key 변경 적용 여부를 전환합니다." />
  );
}

// All 24 keys (+ none) for manual override, using the same conventional spelling
// the detector outputs so a stored value round-trips to the right <option>.
const KEY_OPTIONS = {
  major: ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"],
  minor: ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"],
};

// Render a key string with the value in Elms Sans and any accidental (sharp "#"
// or flat "b") in Tai Heritage Pro italic at 60% size. Note letters are uppercase
// A–G, so a lowercase "b" is always a flat (never the note B) and "m" is minor.
function renderKeyValue(text) {
  return Array.from(text).map((ch, i) =>
    (ch === "#" || ch === "b" || ch === "♯" || ch === "♭")
      ? <span key={i} style={{ fontFamily: "var(--key-accidental-font)", fontStyle: "italic", fontSize: "60%" }}>{ch}</span>
      : <React.Fragment key={i}>{ch}</React.Fragment>
  );
}

function pitchClassOf(k) {
  if (!k) return -1;
  let name = k;
  if (name.endsWith("m")) name = name.slice(0, -1);

  switch (name) {
    case "C": return 0;
    case "C#": case "Db": return 1;
    case "D": return 2;
    case "D#": case "Eb": return 3;
    case "E": return 4;
    case "F": return 5;
    case "F#": case "Gb": return 6;
    case "G": return 7;
    case "G#": case "Ab": return 8;
    case "A": return 9;
    case "A#": case "Bb": return 10;
    case "B": return 11;
    default: return -1;
  }
}

function getSemitoneDifference(origKey, targetKey) {
  const orig = pitchClassOf(origKey);
  const target = pitchClassOf(targetKey);
  if (orig === -1 || target === -1) return 0;

  let diff = target - orig;
  while (diff > 6) diff -= 12;
  while (diff < -6) diff += 12;
  return diff;
}

// Transpose a key string by N semitones, preserving major/minor mode. The result
// is the canonical KEY_OPTIONS spelling for that pitch class (e.g. shifting "C"
// up 1 → "Db", "Am" up 1 → "C#m"). Returns null for a null key.
function shiftKey(key, semitones) {
  const pc = pitchClassOf(key);
  if (pc === -1) return key || null;
  const isMinor = key.endsWith("m");
  const arr = isMinor ? KEY_OPTIONS.minor : KEY_OPTIONS.major;
  const idx = ((pc + semitones) % 12 + 12) % 12;
  return arr[idx];
}

// Shared readout markup for a key box (used by both the toolbar indicator and the
// in-panel "original key" box). `shift` (semitones) renders the offset super/subscript;
// pass 0 to hide it. The label / note / mode are laid out as a flex column by the parent.
function KeyReadout({ keyValue, shift }) {
  const isMinor = !!keyValue && keyValue.slice(-1) === "m";
  const noteText = keyValue ? (isMinor ? keyValue.slice(0, -1) : keyValue) : "--";
  const modeText = keyValue ? (isMinor ? "Minor" : "Major") : null;
  const shiftText = shift > 0 ? `+${shift}` : `${shift}`;
  return (
    <React.Fragment>
      <span style={{ fontSize: 6.3, lineHeight: 1, fontWeight: 400, letterSpacing: ".12em", color: "var(--bpm-label-fg, var(--cream-2))" }}>Key</span>
      <span style={{
        fontFamily: "var(--key-number-font)",
        fontSize: 17,
        lineHeight: 1,
        fontWeight: 400,
        color: "var(--bpm-fg, var(--cream))",
        textShadow: "0 0 8px var(--amber-soft)",
        position: "relative"
      }}>
        {renderKeyValue(noteText)}
        {shift !== 0 && (
          shift > 0 ? (
            <sup style={{ fontSize: "9px", color: "var(--amber)", position: "absolute", top: -2, left: "100%", marginLeft: 2, fontFamily: "var(--mono)", fontWeight: "bold" }}>{shiftText}</sup>
          ) : (
            <sub style={{ fontSize: "9px", color: "var(--amber)", position: "absolute", bottom: -2, left: "100%", marginLeft: 2, fontFamily: "var(--mono)", fontWeight: "bold" }}>{shiftText}</sub>
          )
        )}
      </span>
      {modeText && <span style={{ fontFamily: "var(--ui)", fontStyle: "normal", fontSize: 7.56, lineHeight: 1, fontWeight: 400, letterSpacing: ".06em", color: "var(--bpm-label-fg, var(--cream-2))" }}>{modeText}</span>}
    </React.Fragment>
  );
}

// Read-out of the project's musical key. The narrow readout box (64px) drops a
// wider setup panel (150px) straight down from its bottom edge — visually
// connected (no gap), forming a stepped shape so the Detect button fits.
//
// Flow: `detectedKey` (the original/원Key) is set by Detect and shown only in the
// in-panel "original" box. `key` (the applied key) is set only by Apply and is what
// the toolbar indicator shows — it stays "--" until the user commits a key with Apply.
// The +/- buttons adjust a local *draft* semitone offset (preview only, ±6, wrapping
// within an octave); Apply commits `key = shiftKey(detectedKey, draft)`. The Vari Key
// switch (separate) decides whether playback is transposed to `key` or left at原Key.
function KeyIndicator({ tempo, open, detecting, hasAudio, onToggle, onActivity, onMouseInside, onDetect, onApplyKey }) {
  const key = (tempo && tempo.key) || null;
  const detectedKey = (tempo && tempo.detectedKey) || null;
  const keyShift = (tempo && Number.isFinite(tempo.keyShift)) ? tempo.keyShift : 0;
  const canDetect = hasAudio && !detecting;

  // Toolbar indicator shows the APPLIED key only; the offset is the committed
  // keyShift (the integer is the source of truth — deriving it from the key string
  // would lose the sign at ±6, since +6 and −6 land on the same pitch class).
  const pitchShift = (detectedKey && key) ? keyShift : 0;

  // Draft offset for the +/- preview. Initialised from the committed keyShift
  // whenever the panel opens or the detected key / shift changes (Detect resets it
  // to 0 since it clears the shift; Apply re-syncs it to the just-committed offset).
  const [draft, setDraft] = useState(0);
  useEffect(() => {
    if (open) setDraft(detectedKey ? keyShift : 0);
  }, [open, detectedKey, keyShift]);
  const adjust = (d) => setDraft((v) => Math.max(-6, Math.min(6, v + d)));
  const draftText = draft > 0 ? `+${draft}` : `${draft}`;
  const applyDraft = () => { if (detectedKey) onApplyKey(draft); };

  const stepBtnStyle = (enabled) => ({
    width: 32, height: 21, padding: 0, borderRadius: 6, border: "1px solid var(--line-strong)",
    background: "var(--bg)", color: "var(--cream)", fontSize: 15, fontWeight: 700, lineHeight: 1,
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: enabled ? "pointer" : "default", opacity: enabled ? 1 : 0.4,
  });

  return (
    <div className="key-indicator" onMouseEnter={() => onMouseInside(true)} onMouseLeave={() => onMouseInside(false)}
      style={{ position: "relative", zIndex: 30, width: 64, height: TOOLBAR_PANEL_H, flex: "0 0 64px" }}>
      <button title="Project key — click to detect" onClick={onToggle}
        style={{ position: "relative", zIndex: 1, height: TOOLBAR_PANEL_H, width: 64, padding: 0, cursor: "pointer",
          border: "1px solid var(--line-strong)", borderBottom: open ? "none" : "1px solid var(--line-strong)",
          borderRadius: open ? "10px 10px 0 0" : 10,
          background: "var(--bpm-bg, linear-gradient(180deg,var(--bg2),var(--bg)))",
          boxShadow: open ? "inset 0 1px 0 rgba(255,255,255,.045)" : "inset 0 1px 0 rgba(255,255,255,.045), 0 0 10px rgba(232,176,75,.12)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
        <KeyReadout keyValue={key} shift={pitchShift} />
      </button>
      {open && (
        <div onMouseDown={onActivity} onKeyDown={onActivity} onWheel={onActivity}
          style={{ position: "absolute", left: 0, top: TOOLBAR_PANEL_H, width: 150, overflow: "hidden",
            padding: "10px 10px 11px", border: "1px solid var(--line-strong)", borderRadius: "0 10px 10px 10px",
            background: "var(--bpm-bg, linear-gradient(180deg,var(--bg2),var(--bg)))",
            boxShadow: "var(--shadow), inset 0 1px 0 rgba(255,255,255,.045)",
            cursor: "default", animation: "keyPanelDrop .2s ease both" }}>
          <div style={{ textAlign: "center", fontSize: 11, fontWeight: 700, letterSpacing: ".12em", color: "var(--muted)", marginBottom: 10 }}>
            KEY SETUP
          </div>
          <button className="btn" disabled={!canDetect} onClick={onDetect}
            style={{ width: "100%", height: 30, padding: "0 8px", display: "flex", alignItems: "center", justifyContent: "center", opacity: canDetect || detecting ? 1 : 0.45 }}>
            {detecting ? (
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid var(--amber-soft)", borderTopColor: "var(--amber)", animation: "spin .7s linear infinite", display: "inline-block" }} />
                Analyzing…
              </span>
            ) : "Detect"}
          </button>
          {/* Original key (원Key) box | draft offset | semitone stepper — laid out as
              three columns so the +/- buttons never overlap the offset number. The box
              mirrors the toolbar readout but always shows the detected key with no
              offset; the stepper tweaks the draft offset that Apply commits. */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, margin: "11px 0 9px" }}>
            <div style={{ height: TOOLBAR_PANEL_H, width: 54, border: "1px solid var(--line-strong)", borderRadius: 10,
              background: "var(--bpm-bg, linear-gradient(180deg,var(--bg2),var(--bg)))", boxShadow: "inset 0 1px 0 rgba(255,255,255,.045)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
              <KeyReadout keyValue={detectedKey} shift={0} />
            </div>
            <span style={{ fontFamily: "var(--mono)", fontSize: 15, fontWeight: 700, color: "var(--amber)", minWidth: 24, textAlign: "center", lineHeight: 1 }}>{draftText}</span>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
              <button title="Up a semitone" onClick={() => adjust(1)} disabled={!detectedKey || draft >= 6}
                style={stepBtnStyle(!!detectedKey && draft < 6)}>+</button>
              <button title="Down a semitone" onClick={() => adjust(-1)} disabled={!detectedKey || draft <= -6}
                style={stepBtnStyle(!!detectedKey && draft > -6)}>−</button>
            </div>
          </div>
          <button className="btn" disabled={!detectedKey} onClick={applyDraft}
            style={{ width: "100%", height: 30, padding: "0 8px", display: "flex", alignItems: "center", justifyContent: "center", opacity: detectedKey ? 1 : 0.45 }}>
            Apply
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "9px 0 7px" }}>
            <span style={{ flex: 1, height: 1, background: "var(--line-strong)" }} />
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em", color: "var(--muted)" }}>KEY SET</span>
            <span style={{ flex: 1, height: 1, background: "var(--line-strong)" }} />
          </div>
          {/* Read-only key list: shows the original (detected) key highlighted; the
              user cannot change the key here (selection reverts — Apply is the only
              way to set the applied key). */}
          <select value={detectedKey || ""} onChange={() => {}} title="원곡 Key (선택 불가)"
            style={{ width: "100%", height: 30, borderRadius: 7, border: "1px solid var(--line-strong)",
              background: "var(--bg)", color: "var(--cream)", padding: "0 6px", fontSize: 12, cursor: "pointer", fontFamily: "var(--ui)" }}>
            <option value="">—</option>
            <optgroup label="Major">
              {KEY_OPTIONS.major.map((k) => (
                <option key={k} value={k}
                  style={k === detectedKey ? { color: "var(--amber)", fontWeight: 700 } : undefined}>{k} major</option>
              ))}
            </optgroup>
            <optgroup label="Minor">
              {KEY_OPTIONS.minor.map((k) => (
                <option key={k} value={k}
                  style={k === detectedKey ? { color: "var(--amber)", fontWeight: 700 } : undefined}>{k.slice(0, -1)} minor</option>
              ))}
            </optgroup>
          </select>
        </div>
      )}
    </div>
  );
}

function BpmIndicator({
  tempo,
  open,
  manualBpm,
  measuredBpm,
  detecting,
  detectSeq,
  applySeq,
  tapInfo,
  selectedTrack,
  selectedTrackIndex,
  hasOnlyOneTrack,
  onlyTrack,
  onToggle,
  onActivity,
  onMouseInside,
  onPlaybackAdjust,
  playbackBpmDraft,
  onManualBpm,
  onDetect,
  onTap,
  onApply,
}) {
  const projectBpm = tempo && tempo.projectBpm;
  const playbackBpm = playbackBpmDraft || (tempo && tempo.playbackBpm) || projectBpm;
  const canAdjust = !!projectBpm;
  const canDetect = !detecting && (
    (!!selectedTrack && !selectedTrack.needsAudio) ||
    (hasOnlyOneTrack && onlyTrack && !onlyTrack.needsAudio)
  );
  // Keying these spans by applySeq/detectSeq remounts them on each APPLY / Detect,
  // which replays the bpmPop "punch" animation so a fresh value is clearly noticeable.
  const display = projectBpm ? (
    <React.Fragment>
      <span key={applySeq} style={{ fontFamily: "var(--bpm-number-font)", fontSize: 17, lineHeight: 1, fontWeight: 400, color: "var(--bpm-fg, var(--cream))", textShadow: "0 0 8px var(--amber-soft)", display: "inline-block", animation: "bpmPop .45s cubic-bezier(.22,1.2,.36,1) both" }}>{Math.round(projectBpm)}</span>
      <span style={{ fontSize: 10.5, lineHeight: 1, fontWeight: 400, letterSpacing: ".12em", color: "var(--bpm-label-fg, var(--cream-2))" }}>BPM</span>
      <span style={{ color: "var(--line-strong)", fontSize: 13, padding: "0 1px" }}>|</span>
      <span className="mono" style={{ fontSize: 15, lineHeight: 1, fontWeight: 400, color: "var(--bpm-fg, var(--cream))", textShadow: "0 0 7px var(--amber-soft)" }}>{Math.round(playbackBpm)}</span>
    </React.Fragment>
  ) : (
    <span className="mono" style={{ fontSize: 17, lineHeight: 1, fontWeight: 700, color: "var(--bpm-fg, var(--cream))", textShadow: "0 0 8px var(--amber-soft)" }}>---</span>
  );
  const adjust = (delta, e) => {
    if (e) e.stopPropagation();
    if (!canAdjust) return;
    onActivity();
    onPlaybackAdjust(delta);
  };
  const onWheel = (e) => {
    if (!canAdjust) return;
    e.preventDefault();
    adjust(e.deltaY < 0 ? 1 : -1, e);
  };
  return (
    <div className="bpm-indicator" onMouseEnter={() => onMouseInside(true)} onMouseLeave={() => onMouseInside(false)} onWheel={onWheel}
      style={{ position: "relative", zIndex: 30, width: 150, height: TOOLBAR_PANEL_H, flex: "0 0 150px" }}>
      <div style={{ position: "absolute", right: 0, top: 0, width: 150, maxHeight: open ? 410 : TOOLBAR_PANEL_H,
        overflow: "hidden", borderRadius: 10, border: "1px solid var(--line-strong)",
        background: "var(--bpm-bg, linear-gradient(180deg,var(--bg2),var(--bg)))",
        boxShadow: open ? "var(--shadow), inset 0 1px 0 rgba(255,255,255,.045)" : "inset 0 1px 0 rgba(255,255,255,.045), 0 0 10px rgba(232,176,75,.12)",
        transition: "max-height .18s ease, box-shadow .16s ease" }}>
      <button title="Project BPM" onClick={onToggle} onWheel={onWheel}
        style={{ height: TOOLBAR_PANEL_H, width: "100%", padding: "0 10px 0 14px", display: "flex", justifyContent: "center", alignItems: "center", gap: 8,
          borderRadius: 0, border: 0, background: "transparent", cursor: "pointer" }}>
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, lineHeight: 1 }}>{display}</span>
        {canAdjust && (
          <span style={{ display: "flex", flexDirection: "column", gap: 2, marginLeft: 1 }}>
            <span onClick={(e) => adjust(1, e)} style={{ width: 14, height: 12, display: "grid", placeItems: "center", borderRadius: 3, color: "var(--bpm-label-fg, var(--cream-2))", fontSize: 8, lineHeight: 1 }}>▲</span>
            <span onClick={(e) => adjust(-1, e)} style={{ width: 14, height: 12, display: "grid", placeItems: "center", borderRadius: 3, color: "var(--bpm-label-fg, var(--cream-2))", fontSize: 8, lineHeight: 1 }}>▼</span>
          </span>
        )}
      </button>
      {open && (
        <div onMouseDown={onActivity} onKeyDown={onActivity} onWheel={onActivity}
          style={{ padding: "10px 10px 11px", borderTop: "1px solid var(--line-strong)",
            background: "linear-gradient(180deg,rgba(0,0,0,.08),rgba(0,0,0,.18))",
            color: "var(--cream)", cursor: "default", animation: "bpmPanelIn .16s ease both" }}>
          {/* Two-column header: [BPM SOURCE / track name] | [Track / number] */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", color: "var(--muted)" }}>BPM SOURCE</div>
              <div title={selectedTrack ? selectedTrack.name : undefined}
                style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: selectedTrack ? "var(--bpm-fg, var(--cream))" : "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selectedTrack ? selectedTrack.name : "Select track"}
              </div>
            </div>
            <div style={{ width: 36, flex: "0 0 36px", textAlign: "center" }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", color: "var(--muted)", lineHeight: 1 }}>Track</div>
              <span className="mono" title="Selected BPM source track number"
                style={{ marginTop: 4, width: 34, height: 22, display: "grid", placeItems: "center", borderRadius: 6,
                  border: "1px solid var(--line-strong)", background: "rgba(0,0,0,.18)",
                  color: selectedTrack ? "var(--bpm-fg, var(--cream))" : "var(--muted)", fontSize: 11 }}>
                {selectedTrackIndex ? String(selectedTrackIndex).padStart(2, "0") : "--"}
              </span>
            </div>
          </div>
          {/* Full-width Detect button, centered label */}
          <div title={!canDetect ? "If there are more two tracks, please select one track for BPM measurement." : undefined} style={{ width: "100%", marginBottom: 10 }}>
            <button className="btn" disabled={!canDetect} onClick={onDetect}
              style={{ width: "100%", height: 30, padding: "0 8px", display: "flex", alignItems: "center", justifyContent: "center", opacity: canDetect || detecting ? 1 : 0.45, pointerEvents: !canDetect ? "none" : "auto" }}>
              {detecting ? (
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid var(--amber-soft)", borderTopColor: "var(--amber)", animation: "spin .7s linear infinite", display: "inline-block" }} />
                  Analyzing…
                </span>
              ) : "Detect"}
            </button>
          </div>
          <div style={{ textAlign: "center", fontSize: 11, fontWeight: 700, letterSpacing: ".12em", color: "var(--muted)" }}>
            BPM SETUP
          </div>
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 7, alignItems: "center" }}>
            <input key={detectSeq} className="mono" type="number" min="20" max="300" step="1" value={manualBpm}
              onChange={(e) => onManualBpm(e.target.value)}
              placeholder={measuredBpm ? String(measuredBpm) : "BPM"}
              style={{ height: 34, borderRadius: 7, border: "1px solid var(--line-strong)", background: "var(--bg)", color: "var(--cream)", padding: "0 10px", fontSize: 15, fontWeight: 700,
                animation: detectSeq ? "bpmPop .4s cubic-bezier(.22,1.2,.36,1) both" : "none" }} />
            <button className="btn primary" onClick={onApply} style={{ height: 30, padding: "0 10px" }}>APPLY</button>
          </div>
          <button onClick={onTap}
            style={{ marginTop: 9, width: "100%", height: 50, borderRadius: 8, border: "1px solid var(--amber)",
              background: "var(--amber)", color: "var(--accent-fg)", fontWeight: 800, letterSpacing: ".08em", cursor: "pointer",
              boxShadow: "0 0 12px rgba(232,176,75,.4)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1.05, gap: 1 }}>
            {tapInfo && tapInfo.count > 0 ? (
              <React.Fragment>
                <span className="mono" style={{ fontSize: 20, fontWeight: 800 }}>{tapInfo.bpm != null ? tapInfo.bpm : "·"}</span>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".14em", opacity: 0.85 }}>TAP · {tapInfo.count}</span>
              </React.Fragment>
            ) : (
              <span style={{ fontSize: 18 }}>TAP</span>
            )}
          </button>
        </div>
      )}
      </div>
    </div>
  );
}

function ToolbarDivider() {
  return <div aria-hidden="true" style={{ width: 1, height: TOOLBAR_PANEL_H - 8, background: "var(--line-strong)", boxShadow: "1px 0 0 rgba(255,255,255,.04)" }} />;
}

function TimelineMinimap({ arrangeRef, pxPerSec, playhead, viewState, setPx, timeMin, onScroll }) {
  const ref = useRef(null);
  const duration = Math.max(0.001, DAW.duration || 0.001);
  const laneW = Math.max(1, duration * pxPerSec);
  // Clamp viewLeft so the box never overflows the right edge of the minimap.
  const viewWidth = Math.max(0.012, Math.min(1, (viewState.clientWidth || laneW) / laneW));
  const viewLeft = Math.max(0, Math.min(1 - viewWidth, (viewState.scrollLeft || 0) / laneW));
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
    const newSL = Math.max(0, Math.min(laneW - visibleW, t * pxPerSec - visibleW / 2));
    // Use callback to update DOM scroll + React state in the same frame (no rAF lag).
    onScroll ? onScroll(newSL) : (scrollHost.scrollLeft = newSL);
  };
  const onDown = (e) => {
    e.preventDefault();
    moveViewFromClientX(e.clientX);
    const move = (ev) => moveViewFromClientX(ev.clientX);
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const next = e.deltaY < 0 ? pxPerSec * 1.18 : pxPerSec / 1.18;
    setPx(Math.max(timeMin, Math.min(TIME_ZOOM_MAX, next)));
  }, [pxPerSec, setPx, timeMin]);

  // React 17+ delegates wheel as passive at the document root, so e.preventDefault()
  // inside an onWheel prop is blocked. Register directly with {passive:false} instead.
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  return (
    <div ref={ref} onMouseDown={onDown} title="Timeline minimap"
      style={{ flex: "1 1 252px", minWidth: 150, height: TOOLBAR_PANEL_H, position: "relative", overflow: "hidden",
        borderRadius: 10, border: "1px solid var(--line)", background: "#0b0b0d",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.035)", cursor: "pointer" }}>
      <div style={{ position: "absolute", inset: "8px 10px", borderRadius: 7, overflow: "hidden", background: "rgba(255,255,255,.018)" }}>
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

        {/* Shaded loop range highlight in Minimap */}
        {DAW.loopRange && (
          <div
            style={{
              position: "absolute",
              left: `${(DAW.loopRange.start / duration) * 100}%`,
              width: `${((DAW.loopRange.end - DAW.loopRange.start) / duration) * 100}%`,
              top: 0,
              bottom: 0,
              background: DAW.repeatPlayEnabled ? "rgba(232,176,75,.15)" : "rgba(255,255,255,.04)",
              borderLeft: "1px dashed " + (DAW.repeatPlayEnabled ? "rgba(232,176,75,.5)" : "rgba(255,255,255,.2)"),
              borderRight: "1px dashed " + (DAW.repeatPlayEnabled ? "rgba(232,176,75,.5)" : "rgba(255,255,255,.2)"),
              pointerEvents: "none"
            }}
          />
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
        <Logo size={42} style={{ margin: "0 auto" }} />
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
  const indeterminate = !!state.indeterminate;
  const total = Math.max(1, state.total || 1);
  const done = Math.max(0, Math.min(total, state.done || 0));
  const pct = Math.round((done / total) * 100);
  const title = state.title || (indeterminate ? "Preparing audio" : "Loading audio");
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
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--cream)", marginBottom: 5 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", minHeight: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {state.label || "Preparing files..."}
        </div>
        <div style={{ marginTop: 17, height: 6, borderRadius: 999, background: "var(--bg)",
          border: "1px solid var(--line)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: indeterminate ? "48%" : `${pct}%`, borderRadius: 999,
            background: "linear-gradient(90deg,var(--amber-deep),var(--amber))",
            boxShadow: "0 0 10px var(--amber-soft)", transition: "width .18s ease",
            animation: indeterminate ? "loadingSweep 1.15s ease-in-out infinite alternate" : "none" }} />
        </div>
        <div className="mono" style={{ marginTop: 9, fontSize: 10.5, color: "var(--faint)" }}>
          {state.progressText || (indeterminate ? "working..." : `${done}/${total} files`)}
        </div>
      </div>
    </div>
  );
}

function TimeStretchBusyBadge({ active, x, y }) {
  if (!active) return null;
  return (
    <div title="Preparing Time Stretch preview"
      style={{ position: "absolute", left: x == null ? "50%" : x, top: y == null ? "50%" : y,
        transform: "translate(-50%, -50%)", zIndex: 35,
        width: 30, height: 30, borderRadius: "50%",
        display: "grid", placeItems: "center", pointerEvents: "none",
        border: "1px solid var(--line-strong)", background: "var(--surface2)",
        boxShadow: "0 0 12px var(--amber-soft)" }}>
      <div style={{ width: 18, height: 18, borderRadius: "50%",
        border: "2px solid var(--line-strong)", borderTopColor: "var(--amber)",
        animation: "spin .75s linear infinite" }} />
    </div>
  );
}

/* ---------- studio (arrange) ---------- */
function defaultAudioInputSettings() {
  return { type: "", name: "", channel: 0, stereo: false, sampleRate: 0, bufferSize: 0 };
}

function audioInputSettingsForTrack(track) {
  const saved = (DAW.getSavedAudioInput && DAW.getSavedAudioInput()) || defaultAudioInputSettings();
  const p = (track && track.params) || {};
  return {
    ...defaultAudioInputSettings(),
    ...saved,
    channel: Math.max(0, Number.isFinite(+p.inputChannel) ? +p.inputChannel : Number(saved.channel) || 0),
    stereo: p.inputStereo != null ? !!p.inputStereo : !!saved.stereo,
  };
}

function Studio({ projectName, projectNameRef, projectPath, startupReady, registerHandlers, onRenameProject, onProjectPathChange, onUndoStateChange, theme, mixerTexture }) {
  useTick();
  const [pxPerSec, setPx] = useState(96);
  const [timeMinPx, setTimeMinPx] = useState(TIME_ZOOM_BASE_MIN);
  const [ampZoom, setAmp] = useState(1);
  const [fileTracksCollapsed, setFileTracksCollapsed] = useState(() => {
    try { return localStorage.getItem("focusdaw-file-tracks-collapsed") === "true"; }
    catch (e) { return false; }
  });
  const [selectedFileTrackIds, setSelectedFileTrackIds] = useState([]);
  const lastSelectedFileTrackId = useRef(null);
  const [mergeTracksNotice, setMergeTracksNotice] = useState(false);
  const [mergeTracksName, setMergeTracksName] = useState("");
  const [mergeTracksOptions, setMergeTracksOptions] = useState({ channels: "stereo", originals: "mute" });
  const [mergeTracksBusy, setMergeTracksBusy] = useState(false);
  const [showMixer, setShowMixer] = useState(false);
  const [showAdvancedPan, setShowAdvancedPan] = useState(false);
  const audioInTrackCount = DAW.tracks.filter((t) => t.kind === "audioIn").length;
  const mixerTrackInfo = useMemo(() => ({
    tracksCount: DAW.tracks.length,
    audioInCount: audioInTrackCount,
  }), [DAW.tracks.length, audioInTrackCount]);
  const mixerChannelRef = useRef(null);
  const advancedChannelRef = useRef(null);
  // Pending "focus this knob" request while the mixer window is still opening; flushed on MIXER_READY.
  const pendingMixerFocusRef = useRef(null);

  // Broadcast real-time level meter and FFT spectrum data to mixer / advanced windows (runs every frame via useTick)
  useEffect(() => {
    const needsLevels = (showMixer && mixerChannelRef.current) || (showAdvancedPan && advancedChannelRef.current);
    if (!needsLevels) return;

    const trackLevels = {};
    DAW.tracks.forEach((t) => {
      trackLevels[t.id] = DAW.getTrackLevel(t.id);
    });

    if (showMixer && mixerChannelRef.current) {
      mixerChannelRef.current.postMessage({
        type: "LEVEL_METERS",
        trackLevels,
        inputLevel: DAW.getInputLevel ? DAW.getInputLevel() : 0,
        inputGr: DAW.getInputGainReduction ? DAW.getInputGainReduction() : 0,
        masterLevel: DAW.getMasterLevel(),
        masterStereo: DAW.getMasterStereoLevels ? DAW.getMasterStereoLevels() : null,
        masterBandLevels: DAW.getMasterBandLevels ? DAW.getMasterBandLevels() : DAW.EQ_FREQS.map(() => DAW.getMasterLevel()),
        fftData: DAW.computeSpectrum(),
        isPlaying: DAW.isPlaying,
        playhead: DAW.getPlayhead(),
        // ARM lock state (recording or count-in) — pushed every tick so the mixer
        // window can disable its ARM buttons in lock-step with the main header.
        recLock: DAW.tracks.some((t) => t.kind === "audioIn" && t.recording) || !!window.__recordCountdownActive,
      });
    }

    if (showAdvancedPan && advancedChannelRef.current) {
      advancedChannelRef.current.postMessage({
        type: "LEVEL_METERS",
        trackLevels,
        masterBandLevels: DAW.getMasterBandLevels ? DAW.getMasterBandLevels() : null,
        bands: [...DAW.master.bands],
        isPlaying: DAW.isPlaying,
        playhead: DAW.getPlayhead(),
      });
    }
  });

  // Track project parameters and broadcast changes to mixer window
  const currentTracksStateStr = JSON.stringify(
    DAW.tracks.map((t) => ({ id: t.id, name: t.name, color: t.color, kind: t.kind, needsAudio: !!t.needsAudio, recording: !!t.recording, params: t.params }))
  );
  const currentMasterStateStr = JSON.stringify({
    volume: DAW.master.volume,
    reverb: DAW.master.reverb,
    echo: DAW.master.echo,
    reverbStored: DAW.master.reverbStored,
    echoStored: DAW.master.echoStored,
    saturation: DAW.master.saturation,
    saturationStored: DAW.master.saturationStored,
    widener: DAW.master.widener,
    widenerStored: DAW.master.widenerStored,
    exciter: DAW.master.exciter,
    exciterStored: DAW.master.exciterStored,
    bands: DAW.master.bands,
    eqPreset: DAW.master.eqPreset || null,
    fadeIn: DAW.master.fadeIn,
    fadeOut: DAW.master.fadeOut,
  });

  useEffect(() => {
    if (showMixer && mixerChannelRef.current) {
      mixerChannelRef.current.postMessage({
        type: "SYNC_STATE",
        tracks: DAW.tracks.map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color,
          kind: t.kind,
          needsAudio: !!t.needsAudio,
          recording: !!t.recording,
          params: { ...t.params },
        })),
        master: {
          volume: DAW.master.volume,
          reverb: DAW.master.reverb,
          echo: DAW.master.echo,
          reverbStored: DAW.master.reverbStored,
          echoStored: DAW.master.echoStored,
          saturation: DAW.master.saturation,
          saturationStored: DAW.master.saturationStored,
          widener: DAW.master.widener,
          widenerStored: DAW.master.widenerStored,
          exciter: DAW.master.exciter,
          exciterStored: DAW.master.exciterStored,
          bands: [...DAW.master.bands],
          eqPreset: DAW.master.eqPreset || null,
          fadeIn: DAW.master.fadeIn,
          fadeOut: DAW.master.fadeOut,
        },
        theme,
        mixerTexture,
        inputChannelNames: DAW.getInputChannelNames ? DAW.getInputChannelNames() : [],
        isPlaying: DAW.isPlaying,
        playhead: DAW.getPlayhead(),
      });
    }
  }, [showMixer, currentTracksStateStr, currentMasterStateStr, theme, mixerTexture]);

  useEffect(() => {
    if (showAdvancedPan && advancedChannelRef.current) {
      advancedChannelRef.current.postMessage({
        type: "SYNC_STATE",
        tracks: DAW.tracks.map((t) => ({
          id: t.id,
          name: t.name,
          fileName: t.fileName,
          color: t.color,
          params: { ...t.params },
          peak: t.peakAmp || 0,
        })),
        trackLevels: Object.fromEntries(DAW.tracks.map((t) => [t.id, DAW.getTrackLevel(t.id)])),
        theme,
        master: { ...DAW.master, bands: [...DAW.master.bands] },
        eqFreqs: [...DAW.EQ_FREQS],
        eqPresets: DAW.EQ_PRESETS,
        fftData: DAW.computeSpectrum ? DAW.computeSpectrum() : null,
        isPlaying: DAW.isPlaying,
      });
    }
  }, [showAdvancedPan, currentTracksStateStr, currentMasterStateStr, theme]);

  // Resize the Electron mixer window only when the channel COUNT changes.
  // Previously this lived in the SYNC_STATE effect (keyed on theme/params too),
  // so every color-scheme change triggered an extra setSize round-trip that
  // compounded the Windows frameless getBounds() drift and grew the window.
  useEffect(() => {
    if (showMixer && window.electronAPI && window.electronAPI.resizeMixer) {
      window.electronAPI.resizeMixer(mixerTrackInfo);
    }
  }, [showMixer, mixerTrackInfo]);

  const toggleMixer = useCallback(() => {
    if (window.electronAPI) {
      if (showMixer) {
        window.electronAPI.closeMixer();
      } else {
        window.electronAPI.openMixer(mixerTrackInfo);
      }
    } else {
      if (showMixer) {
        if (window.mixerPopup && !window.mixerPopup.closed) {
          window.mixerPopup.close();
        }
        setShowMixer(false);
      } else {
        const MIXER_BOUNDS_KEY = "focusdaw-mixer-bounds";
        const channelW = 92;
        const audioInChannelW = 138;
        const masterW = 400;
        const contentW = DAW.tracks.reduce((sum, track) => sum + (track.kind === "audioIn" ? audioInChannelW : channelW), 0) + masterW;
        let popW = Math.max(600, Math.min(1440, contentW));
        let popH = 515;
        let popLeft = null;
        let popTop = null;
        try {
          const cached = localStorage.getItem(MIXER_BOUNDS_KEY);
          if (cached) {
            const bounds = JSON.parse(cached);
            popW = bounds.width || popW;
            popH = bounds.height || popH;
            if (typeof bounds.left === 'number') popLeft = bounds.left;
            if (typeof bounds.top === 'number') popTop = bounds.top;
          }
        } catch (e) {}

        let features = `width=${popW},height=${popH}`;
        if (popLeft !== null && popTop !== null) {
          features += `,left=${popLeft},top=${popTop}`;
        }

        window.mixerPopup = window.open("mixer.html", "FocusDAWMixer", features);
        setShowMixer(true);

        if (window.mixerPopup) {
          const saveBounds = () => {
            try {
              if (!localStorage.getItem(MIXER_BOUNDS_KEY)) {
                return;
              }
              if (window.mixerPopup && !window.mixerPopup.closed) {
                const bounds = {
                  left: window.mixerPopup.screenX,
                  top: window.mixerPopup.screenY,
                  width: window.mixerPopup.outerWidth,
                  height: window.mixerPopup.outerHeight
                };
                localStorage.setItem(MIXER_BOUNDS_KEY, JSON.stringify(bounds));
              }
            } catch (e) {}
          };
          window.mixerPopup.addEventListener("beforeunload", saveBounds);
        }

        const timer = setInterval(() => {
          if (!window.mixerPopup || window.mixerPopup.closed) {
            clearInterval(timer);
            setShowMixer(false);
          }
        }, 500);
      }
    }
  }, [showMixer, mixerTrackInfo]);

  // Open the mixer only if it isn't already open (no-op when open).
  const openMixerIfClosed = useCallback(() => {
    if (!showMixer) toggleMixer();
  }, [showMixer, toggleMixer]);

  // Clicking a VRB/ECHO badge in a track header: open (or raise) the mixer window and tell it to
  // scroll to + highlight that track's reverb/echo knob. The request is stashed in
  // pendingMixerFocusRef and flushed by the mixer's MIXER_READY (first cold load) or MIXER_SHOWN
  // (every time it becomes visible — Electron's close only HIDES the window, so MIXER_READY never
  // fires again on reopen). When it's already visible, no visibility change fires, so flush now.
  const focusMixerFx = useCallback((trackId, param) => {
    pendingMixerFocusRef.current = { trackId, param };
    if (showMixer) {
      if (window.electronAPI) window.electronAPI.openMixer(mixerTrackInfo);
      else if (window.mixerPopup && !window.mixerPopup.closed) { try { window.mixerPopup.focus(); } catch (e) {} }
      const pf = pendingMixerFocusRef.current;
      if (pf && mixerChannelRef.current) {
        pendingMixerFocusRef.current = null;
        mixerChannelRef.current.postMessage({ type: "FOCUS_KNOB", trackId: pf.trackId, param: pf.param });
      }
    } else {
      toggleMixer();
    }
  }, [showMixer, toggleMixer, mixerTrackInfo]);

  const openAdvancedPan = useCallback(() => {
    if (window.electronAPI && window.electronAPI.openAdvancedPan) {
      window.electronAPI.openAdvancedPan("pan");
      return;
    }
    const features = "width=1120,height=760,resizable=yes,scrollbars=no";
    const popup = window.open("advanced-pan.html", "FocusDAWAdvancedPan", features);
    if (popup) setShowAdvancedPan(true);
  }, []);

  const openAdvancedAmbience = useCallback(() => {
    if (window.electronAPI && window.electronAPI.openAdvancedPan) {
      window.electronAPI.openAdvancedPan("ambience");
      return;
    }
    const features = "width=1120,height=760,resizable=yes,scrollbars=no";
    const popup = window.open("advanced-ambience.html", "FocusDAWAdvancedAmbience", features);
    if (popup) setShowAdvancedPan(true);
  }, []);

  const openAdvancedEq = useCallback(() => {
    if (window.electronAPI && window.electronAPI.openAdvancedPan) {
      window.electronAPI.openAdvancedPan("eq");
      return;
    }
    const features = "width=1120,height=760,resizable=yes,scrollbars=no";
    const popup = window.open("advanced-eq.html", "FocusDAWAdvancedEq", features);
    if (popup) setShowAdvancedPan(true);
  }, []);

  useEffect(() => {
    if (!showMixer) {
      if (document.activeElement && typeof document.activeElement.blur === "function") {
        document.activeElement.blur();
      }
    }
  }, [showMixer]);

  const [showExport, setShowExport] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [laneH, setLaneH] = useState(96);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(null);
  const [tool, setTool] = useState("select");
  const [selectedClip, setSelectedClip] = useState(null); // Phase 5: { trackId, clipId }
  const [timelineView, setTimelineView] = useState({ scrollLeft: 0, clientWidth: 1 });
  const [vScroll, setVScroll] = useState({ up: false, down: false });
  const [bpmOpen, setBpmOpen] = useState(false);
  const [bpmHover, setBpmHover] = useState(false);
  const [bpmTouchedAt, setBpmTouchedAt] = useState(Date.now());
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyHover, setKeyHover] = useState(false);
  const [keyTouchedAt, setKeyTouchedAt] = useState(Date.now());
  const [detectingKey, setDetectingKey] = useState(false);
  const [manualBpm, setManualBpm] = useState("");
  const [measuredBpm, setMeasuredBpm] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [detectSeq, setDetectSeq] = useState(0); // bumps on each detect/tap → replays measured-value pop
  const [applySeq, setApplySeq] = useState(0);    // bumps on each APPLY → replays project-BPM pop
  const [tapInfo, setTapInfo] = useState({ bpm: null, count: 0 }); // live TAP readout
  const [playbackBpmDraft, setPlaybackBpmDraft] = useState(null);
  const tapTimesRef = useRef([]);
  const playbackBpmDraftRef = useRef(null);
  const playbackBpmCommitTimer = useRef(null);
  const [, force] = useState(0);
  const fileRef = useRef(null);
  const folderRef = useRef(null);
  const focusRef = useRef(null);
  const arrangeRef = useRef(null);
  const fitTimelineRef = useRef(true);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const lastUndoKey = useRef(null);
  const recordingRef = useRef(null);
  const recordCountRef = useRef(null);   // count-in interval id (null = not counting)
  const autoStopRef = useRef(null);      // auto-stop-at-song-end monitor interval id
  const songEndRef = useRef(0);          // end (sec) of longest existing track, captured at record start
  const prevLoopRef = useRef(null);      // Repeat flag saved when a recording began (restored on stop)
  const transportRef = useRef({});       // latest rule-honoring transport action fns (toolbar/keyboard/mixer)
  const [recordCount, setRecordCount] = useState(null); // 3→2→1 count-in overlay number (null = hidden)
  const MAX_UNDO = 50;
  const stretchPreparing = !!DAW._stretchPreviewPreparing;
  const stretchDoneSeq = DAW._stretchPreviewDoneSeq || 0;
  const fileTracks = DAW.tracks.filter((t) => !t.kind || t.kind === "file" || t.kind === "bounce");
  const nonFileTracks = DAW.tracks.filter((t) => t.kind && t.kind !== "file" && t.kind !== "bounce");
  const fileTrackIdSet = useMemo(() => new Set(fileTracks.map((t) => t.id)), [fileTracks.map((t) => t.id).join("|")]);
  const selectedFileTrackSet = useMemo(() => new Set(selectedFileTrackIds), [selectedFileTrackIds.join("|")]);
  const selectedFileTracks = fileTracks.filter((t) => selectedFileTrackSet.has(t.id));
  const getDefaultMergeTracksName = useCallback((tracks = selectedFileTracks) => {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
    const firstTrackBase = tracks[0] && (tracks[0].name || tracks[0].fileName);
    const baseName = safeFileBase((projectName && projectName !== DEFAULT_PROJECT_NAME) ? projectName : (firstTrackBase || DEFAULT_PROJECT_NAME));
    return `${baseName} Bounce ${stamp}`;
  }, [projectName, selectedFileTracks]);
  const fileTrackStats = (() => {
    const anySolo = DAW._anySolo ? DAW._anySolo() : false;
    let mutedCount = 0;
    let soloCount = 0;
    let audibleCount = 0;
    let level = 0;
    fileTracks.forEach((track) => {
      const p = track.params || {};
      if (p.mute) mutedCount += 1;
      if (p.solo) soloCount += 1;
      const audible = !!(track.buffer && !track.needsAudio && !p.mute && !(anySolo && !p.solo));
      if (audible) audibleCount += 1;
      level = Math.max(level, DAW.getTrackLevel(track.id) || 0);
    });
    return { mutedCount, soloCount, audibleCount, level };
  })();
  const visibleTrackCount = nonFileTracks.length + (fileTracksCollapsed ? 0 : fileTracks.length);
  const arrangeNode = arrangeRef.current;
  const rulerH = 30;
  const trackStackTop = rulerH;
  const fileGroupH = fileTracks.length ? 38 : 0;
  const audioInLaneHeight = laneH <= 68 ? laneH : laneH <= 104 ? 134 : Math.max(163, laneH);
  const visibleTrackHeight = (fileTracksCollapsed ? 0 : fileTracks.length * laneH)
    + nonFileTracks.reduce((sum, track) => sum + (track.kind === "audioIn" ? audioInLaneHeight : laneH), 0);
  const trackStackBottom = rulerH + fileGroupH + Math.max(laneH, visibleTrackHeight);
  const visibleTop = arrangeNode ? Math.max(trackStackTop, arrangeNode.scrollTop) : trackStackTop;
  const visibleBottom = arrangeNode ? Math.min(trackStackBottom, arrangeNode.scrollTop + arrangeNode.clientHeight) : trackStackBottom;
  const overlayY = visibleBottom > visibleTop ? (visibleTop + visibleBottom) / 2 : (trackStackTop + trackStackBottom) / 2;
  const overlayX = arrangeNode ? arrangeNode.scrollLeft + (arrangeNode.clientWidth / 2) : null;
  const playhead = DAW.getPlayhead();
  const sessionDuration = DAW.duration;
  const selectedBpmTrack = DAW.getBpmSourceTrack ? DAW.getBpmSourceTrack() : null;
  const selectedBpmTrackIndex = selectedBpmTrack ? DAW.tracks.findIndex((t) => t.id === selectedBpmTrack.id) + 1 : null;
  const touchBpmPanel = useCallback(() => setBpmTouchedAt(Date.now()), []);
  const touchKeyPanel = useCallback(() => setKeyTouchedAt(Date.now()), []);

  const toggleFileTracks = useCallback(() => {
    setFileTracksCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem("focusdaw-file-tracks-collapsed", String(next)); } catch (e) {}
      return next;
    });
  }, []);

  useEffect(() => {
    setSelectedFileTrackIds((ids) => ids.filter((id) => fileTrackIdSet.has(id)));
    if (lastSelectedFileTrackId.current && !fileTrackIdSet.has(lastSelectedFileTrackId.current)) {
      lastSelectedFileTrackId.current = null;
    }
  }, [fileTrackIdSet]);

  const selectFileTrack = useCallback((trackId, e) => {
    if (!fileTrackIdSet.has(trackId)) return;
    const ctrl = !!(e && (e.ctrlKey || e.metaKey));
    const shift = !!(e && e.shiftKey);
    if (e && e.target && e.target.closest && e.target.closest("button,input,select,textarea") && !ctrl && !shift) return;
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const orderedIds = fileTracks.map((track) => track.id);
    setSelectedFileTrackIds((current) => {
      const anchorId = lastSelectedFileTrackId.current && fileTrackIdSet.has(lastSelectedFileTrackId.current)
        ? lastSelectedFileTrackId.current
        : current.find((id) => fileTrackIdSet.has(id));
      if (shift && anchorId) {
        const from = orderedIds.indexOf(anchorId);
        const to = orderedIds.indexOf(trackId);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          const range = orderedIds.slice(start, end + 1);
          return ctrl ? Array.from(new Set([...current, ...range])) : range;
        }
      }
      if (ctrl) {
        return current.includes(trackId)
          ? current.filter((id) => id !== trackId)
          : [...current, trackId];
      }
      if (current.length === 1 && current[0] === trackId) {
        lastSelectedFileTrackId.current = null;
        return [];
      }
      return [trackId];
    });
    if (!shift) lastSelectedFileTrackId.current = trackId;
  }, [fileTracks, fileTrackIdSet]);

  const updateMergeTracksOption = useCallback((key, value) => {
    setMergeTracksOptions((current) => ({ ...current, [key]: value }));
  }, []);

  const openMergeTracksDialog = useCallback(() => {
    setMergeTracksName(getDefaultMergeTracksName());
    setMergeTracksNotice(true);
  }, [getDefaultMergeTracksName]);

  const updateTimelineView = useCallback(() => {
    const el = arrangeRef.current;
    if (!el) return;
    setTimelineView({ scrollLeft: el.scrollLeft, clientWidth: Math.max(1, el.clientWidth - HEADER_W) });
  }, []);

  const updateVScroll = useCallback(() => {
    const el = arrangeRef.current;
    if (!el) { setVScroll({ up: false, down: false }); return; }
    const max = el.scrollHeight - el.clientHeight;
    setVScroll({ up: el.scrollTop > 1, down: el.scrollTop < max - 1 });
  }, []);

  const scrollArrangeV = useCallback((dir) => {
    const el = arrangeRef.current;
    if (!el) return;
    el.scrollBy({ top: dir * Math.max(laneH, el.clientHeight * 0.6), behavior: "smooth" });
  }, [laneH]);

  const updateTimeMin = useCallback(() => {
    const next = timelineMinPx(arrangeRef.current && arrangeRef.current.clientWidth);
    setTimeMinPx(next);
    return next;
  }, []);

  const fitTimelineToProject = useCallback(() => {
    fitTimelineRef.current = true;
    const applyFit = () => {
      const next = updateTimeMin();
      setPx(next);
      updateTimelineView();
    };
    applyFit();
    requestAnimationFrame(applyFit);
  }, [updateTimeMin, updateTimelineView]);

  const pushUndo = useCallback(() => {
    undoStack.current.push(DAW.getSnapshot());
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
    if (onUndoStateChange) onUndoStateChange({ canUndo: true, canRedo: false });
  }, [onUndoStateChange]);

  const renderMergedTracks = useCallback(async () => {
    const tracks = selectedFileTracks.filter((track) => track && track.buffer && !track.needsAudio);
    if (tracks.length < 2 || mergeTracksBusy) return;
    const selectedIds = tracks.map((track) => track.id);
    const firstTrackPath = tracks[0] && (tracks[0].filePath || (tracks[0].sources && tracks[0].sources[0] && tracks[0].sources[0].filePath) || null);
    const bounceName = (mergeTracksName || "").trim() || getDefaultMergeTracksName(tracks);
    const wavName = `${safeFileBase(bounceName)}.wav`;

    setMergeTracksBusy(true);
    setMergeTracksNotice(false);
    setLoading({ active: true, total: 100, done: 0, label: "Rendering bounce..." });
    try {
      const rendered = await DAW.mergeTracks(selectedIds, (p) => {
        setLoading({ active: true, total: 100, done: Math.round(Math.max(0, Math.min(1, p || 0)) * 100), label: "Rendering bounce..." });
      }, {
        sampleRate: 44100,
        channels: mergeTracksOptions.channels === "mono" ? 1 : 2,
        normalize: true,
        respectMute: true,
        respectSolo: false,
        forceLocal: true,
      });

      let saved = null;
      if (window.electronAPI && window.electronAPI.saveBounceAudio && (projectPath || firstTrackPath)) {
        const wavBlob = audioBufferToWav(rendered);
        const wavBuffer = await wavBlob.arrayBuffer();
        saved = await window.electronAPI.saveBounceAudio(wavBuffer, projectPath || null, wavName, firstTrackPath || null);
      }

      pushUndo();
      const bounceTrack = DAW.addBounceTrack(bounceName, rendered, {
        fileName: (saved && saved.fileName) || wavName,
        filePath: (saved && saved.path) || null,
        sourceTrackIds: selectedIds,
      });

      if (mergeTracksOptions.originals === "mute") {
        selectedIds.forEach((id) => DAW.setTrackParam(id, "mute", true));
      } else if (mergeTracksOptions.originals === "delete") {
        selectedIds.forEach((id) => DAW.removeTrack(id));
      }

      lastSelectedFileTrackId.current = bounceTrack.id;
      setSelectedFileTrackIds([bounceTrack.id]);
      saveRecentProject(projectName, projectPath);
      force((n) => n + 1);
      setLoading({ active: true, total: 100, done: 100, label: saved && saved.path ? "Saved to Bounces." : "Bounce track created." });
      setTimeout(() => setLoading(null), 350);
    } catch (err) {
      console.error("Merge Tracks failed:", err);
      setLoading(null);
      window.alert(`Merge Tracks failed: ${err && err.message ? err.message : err}`);
    } finally {
      setMergeTracksBusy(false);
    }
  }, [selectedFileTracks, mergeTracksBusy, mergeTracksOptions, mergeTracksName, getDefaultMergeTracksName, projectPath, pushUndo]);

  const setProjectBpmFromInput = useCallback((value) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    pushUndo();
    if (DAW.setProjectBpm(next)) {
      // APPLY sets BOTH Project BPM and Playback BPM to the same value.
      if (DAW.setPlaybackBpm) DAW.setPlaybackBpm(next);
      const applied = DAW.tempo && DAW.tempo.projectBpm ? DAW.tempo.projectBpm : Math.round(next);
      setMeasuredBpm(applied);
      setManualBpm(String(applied));
      setApplySeq((n) => n + 1);
      saveRecentProject(projectName, projectPath);
      force((n) => n + 1);
    }
  }, [pushUndo, projectName, projectPath]);

  const applyBpm = useCallback(() => {
    const candidate = manualBpm || measuredBpm;
    if (!candidate) return;
    touchBpmPanel();
    setProjectBpmFromInput(candidate);
  }, [manualBpm, measuredBpm, touchBpmPanel, setProjectBpmFromInput]);

  const detectBpm = useCallback(async () => {
    let targetTrack = selectedBpmTrack;
    if (!targetTrack && DAW.tracks.length === 1) {
      const onlyTrack = DAW.tracks[0];
      if (onlyTrack && !onlyTrack.needsAudio) {
        pushUndo();
        DAW.setTrackParam(onlyTrack.id, "bpmSource", true);
        saveRecentProject(projectName, projectPath);
        force((n) => n + 1);
        targetTrack = onlyTrack;
      }
    }
    if (!targetTrack || !DAW.detectBpmFromTrack || detecting) return;
    touchBpmPanel();
    setDetecting(true);
    // Yield two frames so the "Analyzing…" state actually paints before the
    // synchronous STFT analysis blocks the main thread.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    let bpm = null;
    try {
      bpm = DAW.detectBpmFromTrack(targetTrack.id);
    } finally {
      setDetecting(false);
    }
    if (!bpm) return;
    setMeasuredBpm(bpm);
    setManualBpm(String(bpm));
    setDetectSeq((n) => n + 1);
    saveRecentProject(projectName, projectPath);
    force((n) => n + 1);
  }, [selectedBpmTrack, detecting, touchBpmPanel, projectName, projectPath, pushUndo]);

  const detectKey = useCallback(async () => {
    // Key detection is independent of the BPM source track — it analyses every
    // audio track's harmonic content together.
    if (!DAW.detectKeyFromAllTracks || detectingKey) return;
    touchKeyPanel();
    const anySolo = DAW._anySolo ? DAW._anySolo() : false;
    const analyzedTracks = DAW.tracks
      .filter((t) => {
        const p = t && t.params ? t.params : {};
        return t && t.buffer && !t.needsAudio && !p.mute && !(anySolo && !p.solo);
      })
      .map((t) => t.name || t.fileName || t.id);
    console.log("[KeyDetection] UI analyze request:", analyzedTracks.length, analyzedTracks);
    setDetectingKey(true);
    // Yield two frames so "Analyzing…" paints before the synchronous analysis blocks.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    let key = null;
    try {
      key = DAW.detectKeyFromAllTracks();
    } finally {
      setDetectingKey(false);
    }
    if (!key) {
      console.warn("[KeyDetection] UI detection returned no key; clearing stale detected key.");
      if (DAW.setDetectedKey) DAW.setDetectedKey(null);
      if (DAW.setKey) DAW.setKey(null);
      saveRecentProject(projectName, projectPath);
      force((n) => n + 1);
      return;
    }
    console.log("[KeyDetection] UI detected key:", key);
    // Detect only sets the original/원Key (shown in the panel). The applied key
    // (toolbar indicator) stays cleared until the user commits one with Apply.
    if (DAW.setDetectedKey) DAW.setDetectedKey(key);
    if (DAW.setKey) DAW.setKey(null);
    saveRecentProject(projectName, projectPath);
    force((n) => n + 1);
  }, [detectingKey, touchKeyPanel, projectName, projectPath]);

  // Commit a key from the Key panel's Apply button. Receives the draft semitone
  // offset (−6..+6); setKeyShift stores it and recomputes the applied key that the
  // toolbar indicator displays (the original/원Key is left untouched).
  const applyKey = useCallback((semitones) => {
    if (!DAW.setKeyShift) return;
    touchKeyPanel();
    DAW.setKeyShift(semitones | 0);
    saveRecentProject(projectName, projectPath);
    force((n) => n + 1);
  }, [touchKeyPanel, projectName, projectPath]);

  const tapBpm = useCallback(() => {
    const now = performance.now();
    const taps = tapTimesRef.current;
    // Start a fresh tapping session if the gap since the last tap is too long
    // (≈ more than ~2 beats, or 2.5s when no interval yet) — i.e. a new tempo.
    if (taps.length) {
      const gap = now - taps[taps.length - 1];
      const lastInterval = taps.length >= 2 ? taps[taps.length - 1] - taps[taps.length - 2] : 0;
      const resetGap = lastInterval ? Math.max(2000, lastInterval * 2.2) : 2500;
      if (gap > resetGap) taps.length = 0;
    }
    taps.push(now);
    if (taps.length > 40) taps.splice(0, taps.length - 40); // bound memory, keep many taps for precision
    touchBpmPanel();
    const n = taps.length;
    if (n < 2) { setTapInfo({ bpm: null, count: n }); return; }
    // Least-squares regression of tap time vs beat index: t_i ≈ a + b·i.
    // slope b = ms per beat. Uses ALL taps (robust to per-tap jitter) and
    // converges/stabilises as more taps accumulate — unlike a sliding mean.
    let sumI = 0, sumT = 0, sumII = 0, sumIT = 0;
    for (let i = 0; i < n; i++) { sumI += i; sumT += taps[i]; sumII += i * i; sumIT += i * taps[i]; }
    const denom = n * sumII - sumI * sumI;
    const slope = denom !== 0 ? (n * sumIT - sumI * sumT) / denom : (taps[n - 1] - taps[0]) / (n - 1);
    if (!(slope > 0)) return;
    const bpm = Math.max(20, Math.min(300, Math.round(60000 / slope)));
    setMeasuredBpm(bpm);
    setManualBpm(String(bpm));
    setTapInfo({ bpm, count: n });
    setDetectSeq((s) => s + 1);
  }, [touchBpmPanel]);

  const adjustPlaybackBpm = useCallback((delta) => {
    if (!DAW.setPlaybackBpm || !(DAW.tempo && DAW.tempo.projectBpm)) return;
    if (DAW._stretchPreviewPreparing) return;
    const base = playbackBpmDraftRef.current || DAW.tempo.playbackBpm || DAW.tempo.projectBpm;
    const next = Math.max(20, Math.min(300, Math.round(base + delta)));
    playbackBpmDraftRef.current = next;
    setPlaybackBpmDraft(next);
    clearTimeout(playbackBpmCommitTimer.current);
    playbackBpmCommitTimer.current = setTimeout(() => {
      playbackBpmCommitTimer.current = null;
      playbackBpmDraftRef.current = null;
      setPlaybackBpmDraft(null);
      if (!DAW.setPlaybackBpm(next)) return;
      saveRecentProject(projectName, projectPath);
      force((n) => n + 1);
    }, 500);
  }, [projectName, projectPath]);

  useEffect(() => {
    return () => clearTimeout(playbackBpmCommitTimer.current);
  }, []);

  useEffect(() => {
    clearTimeout(playbackBpmCommitTimer.current);
    playbackBpmCommitTimer.current = null;
    playbackBpmDraftRef.current = null;
    setPlaybackBpmDraft(null);
  }, [stretchDoneSeq]);

  const toggleVariBpm = useCallback(() => {
    if (!DAW.setVariBpm) return;
    DAW.setVariBpm(!(DAW.tempo && DAW.tempo.variBpm));
    saveRecentProject(projectName, projectPath);
    force((n) => n + 1);
  }, [projectName, projectPath]);

  const toggleVariKey = useCallback(() => {
    if (!DAW.setVariKey) return;
    DAW.setVariKey(!(DAW.tempo && DAW.tempo.variKey));
    saveRecentProject(projectName, projectPath);
    force((n) => n + 1);
  }, [projectName, projectPath]);

  const undo = useCallback(() => {
    if (!undoStack.current.length) return;
    redoStack.current.push(DAW.getSnapshot());
    DAW.applySnapshot(undoStack.current.pop());
    lastUndoKey.current = null;
    if (onUndoStateChange) onUndoStateChange({ canUndo: undoStack.current.length > 0, canRedo: true });
    saveRecentProject(projectName, projectPath);
    force(n => n + 1);
  }, [onUndoStateChange, projectName, projectPath]);

  const redo = useCallback(() => {
    if (!redoStack.current.length) return;
    undoStack.current.push(DAW.getSnapshot());
    DAW.applySnapshot(redoStack.current.pop());
    lastUndoKey.current = null;
    if (onUndoStateChange) onUndoStateChange({ canUndo: true, canRedo: redoStack.current.length > 0 });
    saveRecentProject(projectName, projectPath);
    force(n => n + 1);
  }, [onUndoStateChange, projectName, projectPath]);

  // BroadcastChannel for Mixer Window sync
  useEffect(() => {
    const channel = new BroadcastChannel("focusdaw-mixer-sync");
    mixerChannelRef.current = channel;

    const handleMessage = (e) => {
      const msg = e.data;
      if (!msg) return;

      switch (msg.type) {
        case "MIXER_READY":
          channel.postMessage({
            type: "INIT_STATE",
            tracks: DAW.tracks.map((t) => ({
              id: t.id,
              name: t.name,
              color: t.color,
              kind: t.kind,
              needsAudio: !!t.needsAudio,
              recording: !!t.recording,
              params: { ...t.params },
            })),
            master: {
              volume: DAW.master.volume,
              reverb: DAW.master.reverb,
              echo: DAW.master.echo,
              reverbStored: DAW.master.reverbStored,
              echoStored: DAW.master.echoStored,
              saturation: DAW.master.saturation,
              saturationStored: DAW.master.saturationStored,
              widener: DAW.master.widener,
              widenerStored: DAW.master.widenerStored,
              exciter: DAW.master.exciter,
              exciterStored: DAW.master.exciterStored,
              bands: [...DAW.master.bands],
              eqPreset: DAW.master.eqPreset || null,
              fadeIn: DAW.master.fadeIn,
              fadeOut: DAW.master.fadeOut,
            },
            theme: localStorage.getItem("focusdaw-theme") || "default",
            mixerTexture: localStorage.getItem("focusdaw-mixer-texture") || "none",
            inputChannelNames: DAW.getInputChannelNames ? DAW.getInputChannelNames() : [],
            isPlaying: DAW.isPlaying,
            playhead: DAW.getPlayhead(),
          });
          // Flush a pending "focus knob" request now that the mixer is up and about to render strips.
          if (pendingMixerFocusRef.current) {
            const pf = pendingMixerFocusRef.current;
            pendingMixerFocusRef.current = null;
            channel.postMessage({ type: "FOCUS_KNOB", trackId: pf.trackId, param: pf.param });
          }
          break;

        case "MIXER_SHOWN":
          // Mixer window became visible again (e.g. reopened after an Electron hide-on-close, which
          // does NOT re-fire MIXER_READY). Flush any pending focus request now that it's on screen.
          if (pendingMixerFocusRef.current) {
            const pf2 = pendingMixerFocusRef.current;
            pendingMixerFocusRef.current = null;
            channel.postMessage({ type: "FOCUS_KNOB", trackId: pf2.trackId, param: pf2.param });
          }
          break;

        case "BEFORE_CHANGE":
          pushUndo();
          break;

        case "REQUEST_UNDO":
          undo();
          break;

        case "REQUEST_REDO":
          redo();
          break;

        case "REQUEST_PLAY_PAUSE":
          transportRef.current.transportPlayPause && transportRef.current.transportPlayPause();
          break;

        case "REQUEST_STOP":
          transportRef.current.transportStop && transportRef.current.transportStop();
          break;

        case "REQUEST_ADVANCED_PAN":
          openAdvancedPan();
          break;

        case "SET_TRACK_PARAM":
          {
            const targetTrack = DAW.tracks.find((track) => track.id === msg.id);
            if (targetTrack && targetTrack.needsAudio && (msg.k === "solo" || msg.k === "mute")) {
              break;
            }
          }
          // Lock ARM while recording / count-in — mirror of the header param()
          // guard so the mixer window can't disarm the running take either.
          if (msg.k === "arm" &&
              (DAW.tracks.some((t) => t.kind === "audioIn" && t.recording) || window.__recordCountdownActive))
            break;
          if (msg.k === "arm" && msg.v) {
            DAW.tracks.forEach((track) => {
              if (track.id !== msg.id && track.kind === "audioIn" && track.params && track.params.arm)
                DAW.setTrackParam(track.id, "arm", false);
            });
            const targetTrack = DAW.tracks.find((track) => track.id === msg.id);
            const input = audioInputSettingsForTrack(targetTrack);
            if (DAW.setAudioInput) DAW.setAudioInput(input).catch((e) => console.warn("[AudioInput] mixer arm prepare failed:", e));
            if (DAW.setInputGain) DAW.setInputGain(
              Math.max(0.1, Math.min(4, targetTrack && targetTrack.params && targetTrack.params.inputGain != null
                ? targetTrack.params.inputGain : 1))
            );
          }
          if (msg.k === "arm" && !msg.v && DAW.setInputGain) DAW.setInputGain(1);
          if (msg.k === "inputGain") {
            const targetTrack = DAW.tracks.find((track) => track.id === msg.id);
            if (targetTrack && targetTrack.kind === "audioIn"
                && targetTrack.params && (targetTrack.params.arm || targetTrack.recording)
                && DAW.setInputGain)
              DAW.setInputGain(msg.v);
          }
          DAW.setTrackParam(msg.id, msg.k, msg.v);
          if ((msg.k === "inputChannel" || msg.k === "inputStereo")) {
            const targetTrack = DAW.tracks.find((track) => track.id === msg.id);
            if (targetTrack && targetTrack.kind === "audioIn"
                && targetTrack.params && (targetTrack.params.arm || targetTrack.recording)
                && DAW.setAudioInput)
              DAW.setAudioInput(audioInputSettingsForTrack(targetTrack)).catch((e) => console.warn("[AudioInput] mixer port switch failed:", e));
          }
          saveRecentProject(projectName, projectPath);
          force((n) => n + 1);
          break;

        case "MUTE_ALL_FILES":
          // Shift+Mute in the mixer: toggle Mute for every file track (file
          // tracks only). The main window is authoritative and re-syncs the
          // mixer via the normal state broadcast.
          DAW.tracks.forEach((track) => {
            if (track.kind === "file") DAW.setTrackParam(track.id, "mute", !!msg.v);
          });
          saveRecentProject(projectName, projectPath);
          force((n) => n + 1);
          break;

        case "SET_MASTER_PARAM":
          DAW.setMaster(msg.k, msg.v);
          saveRecentProject(projectName, projectPath);
          force((n) => n + 1);
          break;

        case "SET_MASTER_BAND":
          DAW.setMasterBand(msg.i, msg.v);
          saveRecentProject(projectName, projectPath);
          force((n) => n + 1);
          break;

        case "APPLY_EQ_PRESET":
          DAW.applyEQPreset(msg.name);
          saveRecentProject(projectName, projectPath);
          force((n) => n + 1);
          break;

        default:
          break;
      }
    };

    channel.addEventListener("message", handleMessage);

    let unsubMixerState = null;
    if (window.electronAPI && window.electronAPI.onMixerState) {
      unsubMixerState = window.electronAPI.onMixerState((state) => {
        setShowMixer(state);
      });
    }

    return () => {
      channel.removeEventListener("message", handleMessage);
      channel.close();
      mixerChannelRef.current = null;
      if (unsubMixerState) unsubMixerState();
    };
  }, [projectName, projectPath, pushUndo, undo, redo, openAdvancedPan]);

  // BroadcastChannel for Advanced Effect Factory windows.
  useEffect(() => {
    const channel = new BroadcastChannel("focusdaw-advanced-effects-sync");
    advancedChannelRef.current = channel;

    const sendInit = () => {
      channel.postMessage({
        type: "INIT_STATE",
        tracks: DAW.tracks.map((t) => ({
          id: t.id,
          name: t.name,
          fileName: t.fileName,
          color: t.color,
          params: { ...t.params },
          peak: t.peakAmp || 0,
        })),
        trackLevels: Object.fromEntries(DAW.tracks.map((t) => [t.id, DAW.getTrackLevel(t.id)])),
        theme: localStorage.getItem("focusdaw-theme") || "default",
        master: { ...DAW.master, bands: [...DAW.master.bands] },
        room: DAW.master.room || "none",
        roomParams: { ...DAW.master.roomParams },
        eqFreqs: [...DAW.EQ_FREQS],
        eqPresets: DAW.EQ_PRESETS,
        fftData: DAW.computeSpectrum ? DAW.computeSpectrum() : null,
        isPlaying: DAW.isPlaying,
      });
    };

    const handleMessage = (e) => {
      const msg = e.data;
      if (!msg) return;

      switch (msg.type) {
        case "ADVANCED_READY":
          sendInit();
          break;
        case "BEFORE_CHANGE":
          pushUndo();
          break;
        case "REQUEST_PLAY_PAUSE":
          transportRef.current.transportPlayPause && transportRef.current.transportPlayPause();
          break;
        case "REQUEST_UNDO":
          undo();
          sendInit(); // re-broadcast restored state so advanced windows reflect the undo
          break;
        case "REQUEST_REDO":
          redo();
          sendInit();
          break;
        case "SET_TRACK_PARAM":
          DAW.setTrackParam(msg.id, msg.k, msg.v);
          saveRecentProject(projectName, projectPath);
          force((n) => n + 1);
          break;
        case "SET_MASTER_BAND":
          DAW.setMasterBand(msg.i, msg.v);
          saveRecentProject(projectName, projectPath);
          force((n) => n + 1);
          break;
        case "APPLY_EQ_PRESET":
          DAW.applyEQPreset(msg.name);
          saveRecentProject(projectName, projectPath);
          force((n) => n + 1);
          break;
        case "SET_EQ_PRESET_NAME":
          // Tag the current EQ with a name (e.g. a recalled user preset) without
          // touching bands — sent after the band values so it survives setMasterBand's clear.
          DAW.master.eqPreset = msg.name || null;
          saveRecentProject(projectName, projectPath);
          force((n) => n + 1);
          break;
        case "SET_ROOM_PRESET":
          pushUndo();
          DAW.setRoom(msg.room);
          sendInit(); // broadcast full state (incl. room/roomParams) so windows stay in sync
          saveRecentProject(projectName, projectPath);
          force((n) => n + 1);
          break;
        case "SET_ROOM_PARAM":
          // Fine-tune a single ambience param. Undo is captured via BEFORE_CHANGE
          // (sent on slider grab), so we don't pushUndo per drag event here.
          DAW.setRoomParam(msg.k, msg.v);
          saveRecentProject(projectName, projectPath);
          force((n) => n + 1);
          break;
        case "SET_MASTER_PARAM":
          DAW.setMaster(msg.k, msg.v);
          saveRecentProject(projectName, projectPath);
          force((n) => n + 1);
          break;
        default:
          break;
      }
    };

    channel.addEventListener("message", handleMessage);

    let unsubAdvancedPanState = null;
    if (window.electronAPI && window.electronAPI.onAdvancedPanState) {
      unsubAdvancedPanState = window.electronAPI.onAdvancedPanState((state) => {
        setShowAdvancedPan(state);
      });
    }

    return () => {
      channel.removeEventListener("message", handleMessage);
      channel.close();
      advancedChannelRef.current = null;
      if (unsubAdvancedPanState) unsubAdvancedPanState();
    };
  }, [projectName, projectPath, pushUndo, undo, redo]);

  // Scroll the arrange area AND update timelineView in the same React render — no rAF lag.
  const scrollArrangeTo = useCallback((sl) => {
    const el = arrangeRef.current;
    if (!el) return;
    el.scrollLeft = sl;
    setTimelineView({ scrollLeft: sl, clientWidth: Math.max(1, el.clientWidth - HEADER_W) });
  }, []);

  const setPxFromUser = useCallback((value) => {
    const nextMin = timelineMinPx(arrangeRef.current && arrangeRef.current.clientWidth);
    const snappedToMin = value <= nextMin + timelineStep(nextMin) * 0.5;
    fitTimelineRef.current = snappedToMin;
    const nextPx = snappedToMin ? nextMin : value;
    // Clamp scrollLeft synchronously so the minimap box stays in bounds in the same render.
    const el = arrangeRef.current;
    if (el) {
      const newLaneW = Math.max(1, DAW.duration * nextPx);
      const visibleW = Math.max(1, el.clientWidth - HEADER_W);
      el.scrollLeft = Math.min(el.scrollLeft, Math.max(0, newLaneW - visibleW));
      setTimelineView({ scrollLeft: el.scrollLeft, clientWidth: visibleW });
    }
    setPx(nextPx);
  }, []);

  // Timeline shortcuts on the arrange scroller:
  //   Ctrl(+Cmd)+wheel  → zoom in/out centered on the cursor's time position
  //   Shift+wheel       → pan left/right
  //   (no modifier)     → native vertical scroll (untouched)
  const pendingZoomScrollRef = useRef(null);
  const onArrangeWheel = useCallback((e) => {
    const el = arrangeRef.current;
    if (!el) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // Cursor position measured from the lane origin (right of the sticky track header).
      const cursorLaneX = Math.max(0, (e.clientX - rect.left) - HEADER_W); // on-screen px
      const anchorTime = (el.scrollLeft + cursorLaneX) / pxPerSec;         // time under cursor
      const nextMin = timelineMinPx(el.clientWidth);
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      const nextPx = Math.max(nextMin, Math.min(TIME_ZOOM_MAX, pxPerSec * factor));
      if (nextPx === pxPerSec) return;
      // Keep the cursor's time fixed on screen once the lane re-renders at the new width.
      pendingZoomScrollRef.current = Math.max(0, anchorTime * nextPx - cursorLaneX);
      fitTimelineRef.current = nextPx <= nextMin + timelineStep(nextMin) * 0.5;
      setPx(nextPx);
    } else if (e.shiftKey) {
      e.preventDefault();
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      el.scrollLeft += delta;
      updateTimelineView();
    }
  }, [pxPerSec, updateTimelineView]);

  // React 17+ delegates wheel as passive at the document root, so preventDefault() inside an
  // onWheel prop is ignored. Register directly with {passive:false} (same as the minimap).
  useEffect(() => {
    const el = arrangeRef.current;
    if (!el) return;
    el.addEventListener("wheel", onArrangeWheel, { passive: false });
    return () => el.removeEventListener("wheel", onArrangeWheel);
  }, [onArrangeWheel]);

  // After a Ctrl+wheel zoom re-renders the lane at its new width, apply the anchored scrollLeft.
  React.useLayoutEffect(() => {
    if (pendingZoomScrollRef.current == null) return;
    const el = arrangeRef.current;
    if (el) {
      const visibleW = Math.max(1, el.clientWidth - HEADER_W);
      const laneW = Math.max(1, DAW.duration * pxPerSec);
      el.scrollLeft = Math.max(0, Math.min(pendingZoomScrollRef.current, laneW - visibleW));
      updateTimelineView();
    }
    pendingZoomScrollRef.current = null;
  }, [pxPerSec]);

  useEffect(() => {
    const onResize = () => {
      const next = updateTimeMin();
      setPx((px) => fitTimelineRef.current
        ? next
        : Math.max(next, Math.min(TIME_ZOOM_MAX, px)));
      updateTimelineView();
      updateVScroll();
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateTimeMin, updateTimelineView, updateVScroll]);

  useEffect(() => {
    const el = arrangeRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { updateTimelineView(); updateVScroll(); });
    };
    updateTimelineView();
    updateVScroll();
    el.addEventListener("scroll", onScroll);
    return () => { cancelAnimationFrame(raf); el.removeEventListener("scroll", onScroll); };
  }, [updateTimelineView, updateVScroll, pxPerSec, sessionDuration]);

  // Recompute vertical-scroll edges when the track count or lane height changes.
  useEffect(() => { updateVScroll(); }, [updateVScroll, laneH, DAW.tracks.length, fileTracksCollapsed]);

  useEffect(() => {
    const next = updateTimeMin();
    setPx((px) => fitTimelineRef.current
      ? next
      : Math.max(next, Math.min(TIME_ZOOM_MAX, px)));
    requestAnimationFrame(updateTimelineView);
  }, [sessionDuration, updateTimeMin, updateTimelineView]);

  useEffect(() => {
    const reset = () => { lastUndoKey.current = null; };
    window.addEventListener("mouseup", reset);
    return () => window.removeEventListener("mouseup", reset);
  }, []);

  useEffect(() => {
    const projectBpm = DAW.tempo && DAW.tempo.projectBpm;
    if (!projectBpm) {
      setManualBpm("");
      setMeasuredBpm(null);
      return;
    }
    setManualBpm(String(Math.round(projectBpm)));
    setMeasuredBpm(Math.round(projectBpm));
  }, [projectName, projectPath, DAW.tempo && DAW.tempo.projectBpm]);

  useEffect(() => {
    if (!bpmOpen) return;
    // Use the live DOM `:hover` state rather than the React `bpmHover` flag — Detect
    // blocks the main thread during analysis, so a `mouseleave` fired meanwhile is
    // swallowed and the flag can get stuck `true` (same issue as the Key panel).
    const timer = setInterval(() => {
      const el = document.querySelector(".bpm-indicator");
      const hovered = el ? el.matches(":hover") : false;
      if (!hovered && Date.now() - bpmTouchedAt >= 5000) setBpmOpen(false);
    }, 500);
    return () => clearInterval(timer);
  }, [bpmOpen, bpmTouchedAt]);

  useEffect(() => {
    if (!keyOpen) return;
    // Same rule as the BPM panel: stay open while the cursor is over it, close ~5s
    // after the mouse leaves. NOTE: we can't rely on the React `keyHover` flag here —
    // key detection blocks the main thread for several seconds (it STFT-analyses every
    // track), so a `mouseleave` fired while "Analyzing…" is swallowed and keyHover gets
    // stuck `true`, preventing the panel from ever closing. Querying the live DOM
    // `:hover` state reflects the real pointer position even after such a block.
    const timer = setInterval(() => {
      const el = document.querySelector(".key-indicator");
      const hovered = el ? el.matches(":hover") : false;
      if (!hovered && Date.now() - keyTouchedAt >= 5000) setKeyOpen(false);
    }, 500);
    return () => clearInterval(timer);
  }, [keyOpen, keyTouchedAt]);

  // Reset the TAP tempo session whenever the panel closes, so each open starts fresh.
  useEffect(() => {
    if (!bpmOpen) {
      tapTimesRef.current = [];
      setTapInfo({ bpm: null, count: 0 });
    }
  }, [bpmOpen]);

  const saveProject = useCallback(async (forceDialog = false) => {
    const currentName = (projectNameRef && projectNameRef.current) || projectName || DEFAULT_PROJECT_NAME;
    const json = DAW.exportProject(currentName);
    let savedPath = projectPath || null;
    let savedName = currentName;
    if (window.electronAPI) {
      const targetPath = !forceDialog ? projectPath : null;
      const result = await window.electronAPI.saveProject(json, currentName, targetPath);
      if (!result || result.saved === false) return;
      if (result.path && onProjectPathChange) onProjectPathChange(result.path);
      if (result.path) savedPath = result.path;
      // The project name follows the file name: a Save As to "untitled123.focus"
      // renames the project to "untitled123". Without this the Recent Saved list
      // and the title kept showing the pre-dialog name. The file itself is
      // stamped with the same name by the main process before writing.
      if (result.path) {
        savedName = projectNameFromPath(result.path);
        if (savedName !== currentName && onRenameProject) onRenameProject(savedName);
      }
    } else {
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = safeFileBase(currentName) + ".focus";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    saveRecentProject(savedName, savedPath, { updateSavedList: !!savedPath });
  }, [projectName, projectNameRef, projectPath, onProjectPathChange, onRenameProject]);

  const saveProjectAs = useCallback(() => saveProject(true), [saveProject]);

  const playPause = useCallback(() => { DAW.isPlaying ? DAW.pause() : DAW.play(); }, []);

  const electronFilePath = useCallback((file) => {
    if (!file) return "";
    if (file.path) return file.path;
    if (window.electronAPI && window.electronAPI.getPathForFile) {
      try { return window.electronAPI.getPathForFile(file) || ""; } catch (e) {}
    }
    return "";
  }, []);

  useEffect(() => {
    const id = setInterval(() => saveRecentProject(projectName, projectPath), 1500);
    return () => clearInterval(id);
  }, [projectName, projectPath]);

  const handleSplit = useCallback((trackId, clipId, atSec) => {
    pushUndo(); DAW.splitClip(trackId, clipId, atSec); force((n) => n + 1);
  }, [pushUndo]);
  const handleJoin = useCallback((trackId, clipIdA, clipIdB) => {
    pushUndo(); DAW.joinClips(trackId, clipIdA, clipIdB); force((n) => n + 1);
  }, [pushUndo]);

  // Phase 5 — Audio In / Bounce clip editing (전략 B). Each mutating op takes one
  // undo snapshot; drag-move/trim call these once on mouse-up (single undo per drag).
  // Paste needs a target track, but the clip selection is cleared whenever the
  // user clicks away (e.g. clicking the lane to move the playhead before
  // pasting). Remember the last clip-edited track separately so Ctrl+V still
  // knows where to paste after a deselect.
  const lastClipTrackRef = useRef(null);
  const pasteTargetTrackId = useCallback(() => {
    if (selectedClipRef.current) return selectedClipRef.current.trackId;
    const remembered = lastClipTrackRef.current;
    if (remembered && DAW.tracks.some((t) => t.id === remembered && !t.lockedToZero)) return remembered;
    // Fall back to the only editable track, if there is exactly one.
    const editable = DAW.tracks.filter((t) => !t.lockedToZero && (t.kind === "audioIn" || t.kind === "bounce"));
    return editable.length === 1 ? editable[0].id : null;
  }, []);
  const handleSelectClip = useCallback((trackId, clipId) => {
    lastClipTrackRef.current = trackId;
    setSelectedClip({ trackId, clipId });
  }, []);
  // Deselect = drop the clip selection AND release the scissors/join (C/J) tool.
  // Shared by the Esc key and the clip context menu's "Deselect" row so both behave
  // identically (fixes C/J staying stuck active after use).
  const handleDeselect = useCallback(() => { setSelectedClip(null); setTool("select"); }, []);
  // A clip edit can change the song length. Lock the timeline to the user's current
  // zoom (leave fit-to-view mode) so growing the song just widens the lane with
  // horizontal scroll, instead of re-fitting and shrinking every waveform.
  const lockTimelineZoom = useCallback(() => { fitTimelineRef.current = false; }, []);
  const handleMoveClip = useCallback((trackId, clipId, newStart) => {
    lockTimelineZoom(); pushUndo(); DAW.moveClip(trackId, clipId, newStart); force((n) => n + 1);
  }, [pushUndo, lockTimelineZoom]);
  const handleTrimStart = useCallback((trackId, clipId, newStart) => {
    lockTimelineZoom(); pushUndo(); DAW.trimClipStart(trackId, clipId, newStart); force((n) => n + 1);
  }, [pushUndo, lockTimelineZoom]);
  const handleTrimEnd = useCallback((trackId, clipId, newEnd) => {
    lockTimelineZoom(); pushUndo(); DAW.trimClipEnd(trackId, clipId, newEnd); force((n) => n + 1);
  }, [pushUndo, lockTimelineZoom]);
  const handleDeleteClip = useCallback((trackId, clipId) => {
    lockTimelineZoom(); pushUndo(); DAW.deleteClip(trackId, clipId); setSelectedClip(null); force((n) => n + 1);
  }, [pushUndo, lockTimelineZoom]);
  const handleDuplicateClip = useCallback((trackId, clipId) => {
    lockTimelineZoom(); pushUndo(); const id = DAW.duplicateClip(trackId, clipId);
    if (id) setSelectedClip({ trackId, clipId: id }); force((n) => n + 1);
  }, [pushUndo, lockTimelineZoom]);
  const handleCopyClip = useCallback((trackId, clipId) => { DAW.copyClip(trackId, clipId); }, []);
  const handlePasteClip = useCallback((trackId, atStart) => {
    lockTimelineZoom(); pushUndo(); const id = DAW.pasteClip(trackId, atStart);
    lastClipTrackRef.current = trackId;
    if (id) setSelectedClip({ trackId, clipId: id }); force((n) => n + 1);
  }, [pushUndo, lockTimelineZoom]);
  // Arrow-key precise nudge of the selected clip (1 / 10 / 100 ms). Consecutive nudges
  // within a short window coalesce into ONE undo (like a drag). A nudge that changes
  // nothing (butted against a neighbor) discards the just-pushed snapshot.
  const nudgeTsRef = useRef(0);
  const nudgeSelectedClip = useCallback((deltaSec) => {
    const sel = selectedClipRef.current; if (!sel) return;
    const now = Date.now();
    const fresh = now - nudgeTsRef.current > 700;
    if (fresh) { lockTimelineZoom(); pushUndo(); }
    const changed = DAW.nudgeClip(sel.trackId, sel.clipId, deltaSec);
    if (changed) { nudgeTsRef.current = now; force((n) => n + 1); }
    else if (fresh) { undoStack.current.pop(); } // no move → drop the empty snapshot
  }, [pushUndo, lockTimelineZoom]);

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
        await DAW.addFileBuffer(track.fileName || track.name, ab, { filePath: track.filePath, reconnectTrackId: track.id });
      } catch (err) {
        console.warn("Failed to reconnect audio:", track.filePath, err);
      }
    }
    setLoading({ active: true, total: missing.length, done: missing.length, label: "Finalizing..." });
    setTimeout(() => setLoading(null), 220);
  }, []);

  const loadProjectJson = useCallback(async (json, openedPath = null) => {
    const nextPath = openedPath || json.projectPath || null;
    DAW.importProject(json);
    // File name wins whenever the project has one — opening "untitled123.focus"
    // must show "untitled123" even if the file was written by an older build
    // that stored a stale projectName inside. Only a path-less snapshot (the
    // autosaved exit state) falls back to the name recorded in the json.
    const nextName = nextPath ? projectNameFromPath(nextPath) : (json.projectName || DEFAULT_PROJECT_NAME);
    if (onRenameProject) onRenameProject(nextName);
    if (onProjectPathChange) onProjectPathChange(nextPath);
    setAmp(1);
    undoStack.current = [];
    redoStack.current = [];
    if (onUndoStateChange) onUndoStateChange({ canUndo: false, canRedo: false });
    await reconnectProjectAudio();
    fitTimelineToProject();
    saveRecentProject(nextName, nextPath);
    force((n) => n + 1);
  }, [onRenameProject, onProjectPathChange, fitTimelineToProject, reconnectProjectAudio, onUndoStateChange]);

  const openProjectFile = useCallback(async (file) => {
    try {
      let text;
      let openedPath = null;
      if (window.electronAPI) {
        const filePath = electronFilePath(file);
        if (filePath && window.electronAPI.readProjectFile) {
          const opened = await window.electronAPI.readProjectFile(filePath);
          if (!opened) return;
          text = opened.text;
          openedPath = opened.path;
        } else if (file && typeof file.text === "function") {
          text = await file.text();
          openedPath = file.name;
        } else {
          const opened = await window.electronAPI.openProject();
          if (!opened) return;
          text = typeof opened === "string" ? opened : opened.text;
          openedPath = typeof opened === "string" ? null : opened.path;
        }
      } else if (file) {
        text = await file.text();
        openedPath = file.name;
      } else { return; }
      const json = JSON.parse(text);
      await loadProjectJson(json, openedPath);
    } catch (err) { console.error("Failed to open project:", err); }
  }, [loadProjectJson, electronFilePath]);

  useEffect(() => {
    const isTextInput = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };
    const isRangeInput = (el) => el && el.tagName === "INPUT" && el.type === "range";
    const k = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === "Space" && (!isTextInput(e.target) || isRangeInput(e.target))) {
        e.preventDefault();
        transportRef.current.transportPlayPause && transportRef.current.transportPlayPause();
        return;
      }
      if (e.key === "F3") { e.preventDefault(); toggleMixer(); return; }
      if (mod && e.key === "s") { e.preventDefault(); saveProject(); return; }
      if (mod && e.key === "o") {
        e.preventDefault();
        if (window.electronAPI) openProjectFile(null);
        else focusRef.current && focusRef.current.click();
        return;
      }
      if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); return; }
      if (isTextInput(e.target)) return;
      // A selected clip captures ←/→ for precise nudge (Shift=100ms, Ctrl=10ms, else 1ms).
      // With no clip selected these fall through to playhead seek below.
      if ((e.code === "ArrowLeft" || e.code === "ArrowRight") && selectedClipRef.current) {
        e.preventDefault();
        const dir = e.code === "ArrowLeft" ? -1 : 1;
        const step = e.shiftKey ? 0.1 : ((e.ctrlKey || e.metaKey) ? 0.01 : 0.001);
        nudgeSelectedClip(dir * step);
        return;
      }
      if (!mod && (e.code === "Digit0" || e.code === "Numpad0")) {
        e.preventDefault();
        transportRef.current.transportToStart && transportRef.current.transportToStart();
        return;
      }
      if (!mod && (e.code === "Comma" || e.code === "ArrowLeft" || e.code === "Period" || e.code === "ArrowRight")) {
        e.preventDefault();
        const T = transportRef.current;
        if ((T.isRecordingActive && T.isRecordingActive()) || (T.isCountingIn && T.isCountingIn())) return; // no seeking mid-record
        const delta = (e.code === "Comma" || e.code === "ArrowLeft") ? -1 : 1;
        DAW.seek(DAW.getPlayhead() + delta);
        force((n) => n + 1);
        return;
      }
      if (!mod && (e.key === "s" || e.key === "S")) setTool("select");
      if (!mod && (e.key === "c" || e.key === "C")) setTool("scissors");
      if (!mod && (e.key === "j" || e.key === "J")) setTool("join");
    };
    window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
  }, [playPause, saveProject, openProjectFile, undo, redo, toggleMixer, nudgeSelectedClip]);

  // Phase 5 — clip-editing keyboard shortcuts (operate on the selected clip).
  const selectedClipRef = useRef(null);
  selectedClipRef.current = selectedClip;
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      const sel = selectedClipRef.current;
      if (e.key === "Escape") {
        if (sel) e.preventDefault();
        handleDeselect(); // clear clip selection + release scissors/join tool
        return;
      }
      if (!mod && (e.key === "Delete" || e.key === "Backspace")) {
        if (sel) { e.preventDefault(); handleDeleteClip(sel.trackId, sel.clipId); }
        return;
      }
      if (mod && (e.key === "c" || e.key === "C")) { if (sel) { e.preventDefault(); handleCopyClip(sel.trackId, sel.clipId); } return; }
      if (mod && (e.key === "d" || e.key === "D")) { if (sel) { e.preventDefault(); handleDuplicateClip(sel.trackId, sel.clipId); } return; }
      if (mod && (e.key === "v" || e.key === "V")) {
        // Paste does NOT require a live selection — the usual flow is copy, click
        // the lane to move the playhead (which deselects), then paste.
        const targetId = pasteTargetTrackId();
        if (targetId && DAW._clipboard) { e.preventDefault(); handlePasteClip(targetId, DAW.getPlayhead()); }
        return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [handleDeleteClip, handleCopyClip, handleDuplicateClip, handlePasteClip, pasteTargetTrackId, handleDeselect]);

  // Clicking anywhere that is not a clip rect (or the clip's own context menu)
  // drops the clip selection. Bubble phase + a closest() marker check, so the
  // clip's own mousedown (which selects) is never undone by this listener
  // regardless of handler order.
  useEffect(() => {
    const onDown = (e) => {
      if (!selectedClipRef.current) return;
      if (e.target.closest && (e.target.closest("[data-clip-hit]") || e.target.closest("[data-clip-menu]"))) return;
      setSelectedClip(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    if (!startupReady) return;
    reconnectProjectAudio().then(() => {
      fitTimelineToProject();
      force((n) => n + 1);
    });
  }, [startupReady, reconnectProjectAudio, fitTimelineToProject]);

  // When a folder is imported onto the *initial* (fresh) screen, name the project
  // after that folder. "Fresh" = no tracks yet, still the default name, and not a
  // saved project — so adding stems to an existing/named project never clobbers it.
  // Must be evaluated BEFORE any file is added (DAW.tracks mutates during import).
  const folderImportProjectName = useCallback((folderName) => {
    const fresh = DAW.tracks.length === 0
      && (projectName === DEFAULT_PROJECT_NAME || !projectName)
      && !projectPath;
    const clean = (folderName || "").trim();
    return fresh && clean ? clean : null;
  }, [projectName, projectPath]);

  const addFiles = async (files, rootOnly = false, folderName = null) => {
    const audioFiles = files.filter((f) => {
      const rel = f.webkitRelativePath || "";
      const isNested = rel && rel.split("/").filter(Boolean).length > 2;
      return !(rootOnly && isNested) && /\.(mp3|wav|aiff?|m4a|ogg|flac)$/i.test(f.name);
    });
    if (!audioFiles.length) return;
    const renameTo = folderImportProjectName(folderName);
    setLoading({ active: true, total: audioFiles.length, done: 0, label: "Preparing files..." });
    for (let i = 0; i < audioFiles.length; i++) {
      const f = audioFiles[i];
      setLoading({ active: true, total: audioFiles.length, done: i, label: f.name });
      try { await DAW.addFile(f); } catch (e) { console.error("Failed to add", f.name, e); }
    }
    if (renameTo && onRenameProject) onRenameProject(renameTo);
    fitTimelineToProject();
    saveRecentProject(renameTo || projectName, projectPath);
    setLoading({ active: true, total: audioFiles.length, done: audioFiles.length, label: "Finalizing..." });
    setTimeout(() => setLoading(null), 220);
    force((n) => n + 1);
  };
  const addElectronFiles = useCallback(async (items, opts = {}) => {
    if (!items.length) return;
    const renameTo = folderImportProjectName(opts.folderName);
    setLoading({ active: true, total: items.length, done: 0, label: "Preparing files..." });
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setLoading({ active: true, total: items.length, done: i, label: item.name });
      try {
        const ab = await window.electronAPI.readAudioFile(item.path);
        await DAW.addFileBuffer(item.name, ab, {
          filePath: item.path,
          displayName: item.displayName,
          fileSize: item.size,
          fileMtimeMs: item.mtimeMs,
        });
      } catch (e) { console.error("Failed to add", item.name, e); }
    }
    if (renameTo && onRenameProject) onRenameProject(renameTo);
    fitTimelineToProject();
    saveRecentProject(renameTo || projectName, projectPath);
    setLoading({ active: true, total: items.length, done: items.length, label: "Finalizing..." });
    setTimeout(() => setLoading(null), 220);
    force((n) => n + 1);
  }, [fitTimelineToProject, folderImportProjectName, onRenameProject, projectName, projectPath]);

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
      if (items.length) addElectronFiles(items, { folderName: parentFolderName(items[0].path) });
    } else {
      folderRef.current && folderRef.current.click();
    }
  }, [addElectronFiles]);

  const addAudioInTrack = useCallback(() => {
    const count = DAW.tracks.filter((t) => t.kind === "audioIn").length + 1;
    const track = DAW.addAudioInTrack(`Audio In ${count}`);
    const input = (DAW.getSavedAudioInput && DAW.getSavedAudioInput()) || defaultAudioInputSettings();
    if (track && track.params) {
      track.params.inputChannel = Number(input.channel) || 0;
      track.params.inputStereo = !!input.stereo;
    }
    // Pre-warming the input here is only a first-record latency optimization.
    // Doing it WHILE PLAYING forces a cold WASAPI device reopen (to add the input
    // channel on a boot-time output-only device), which froze the transport and
    // bounced the playhead back to 0 (v1.20.10). Skip it during playback — the
    // input opens when the user actually arms/records (toggleRecording awaits
    // setAudioInput), and the startup warm-up already covers the common case so
    // subsequent adds hit the native "keep warm" fast path with no reopen.
    if (DAW.setAudioInput && !DAW.isPlaying) DAW.setAudioInput(input).catch((e) => console.warn("[AudioInput] prepare failed:", e));
    force((n) => n + 1);
  }, []);

  const toggleRecording = useCallback(async (track) => {
    if (!window.electronAPI || !DAW.isNative) {
      alert("Audio recording requires the desktop app and native audio engine.");
      return;
    }
    if (track.recording) {
      const active = recordingRef.current;
      if (!active || active.trackId !== track.id) return;
      DAW.stopRecording(active.partPath);
      try {
        await active.promise;
        const saved = await window.electronAPI.finalizeRecording(active.partPath, active.finalPath);
        const bytes = await window.electronAPI.readAudioFile(saved.path);
        const attachOptions = { filePath: saved.path, start: active.start };
        if (active.durationLimit > 0) attachOptions.end = active.durationLimit;
        await DAW.attachRecording(track.id, saved.fileName, bytes, attachOptions);
      } catch (e) {
        alert(`Recording could not be finalized: ${e.message || e}`);
      }
      track.recording = false;
      delete track._recordingDurationLimit;
      recordingRef.current = null;
      fitTimelineToProject();
      force((n) => n + 1);
      return;
    }
    if (recordingRef.current) {
      alert("Only one Audio In track can record at a time.");
      return;
    }
    const sourcePath = DAW.tracks.find((t) => t.filePath)?.filePath || null;
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
    const target = await window.electronAPI.prepareRecordingPath(projectPath, `${track.name} ${stamp}.wav`, sourcePath);
    const input = audioInputSettingsForTrack(track);
    try {
      if (DAW.setAudioInput) await DAW.setAudioInput(input);
    } catch (e) {
      alert(e.message || String(e));
      return;
    }
    const start = DAW.getPlayhead();
    track.recording = true;
    track._recordingStart = start;
    track._recordingPeaks = [];
    track._recordingSampleRate = 44100;
    const durationLimit = Number(track._recordingDurationLimit) || 0;
    const promise = DAW.startRecording({
      filePath: target.partPath, channel: input.channel || 0, stereo: !!input.stereo,
      gain: Math.max(0.1, Math.min(4, track.params.inputGain == null ? 1 : track.params.inputGain)),
      monitor: !!track.params.monitor, limiter: track.params.limiter !== false,
    });
    recordingRef.current = { trackId: track.id, ...target, start, durationLimit, promise };
    promise.catch((e) => {
      if (recordingRef.current && recordingRef.current.trackId === track.id) {
        track.recording = false;
        delete track._recordingDurationLimit;
        recordingRef.current = null;
        alert(e.message || String(e));
        force((n) => n + 1);
      }
    });
    force((n) => n + 1);
  }, [projectPath, fitTimelineToProject]);

  // ---- Recording transport flow (record start/stop rules) ------------------
  // Record from a stopped transport shows a 3s count-in then starts play+record;
  // from a playing transport it records immediately. Repeat is turned off while
  // recording (restored on stop). Both play+record stop when playback reaches the
  // end of the longest existing track (no backing tracks → record until manual
  // stop). Pause and return-to-start are ignored while recording; any transport
  // press during the count-in cancels it.
  const isCountingIn = () => recordCountRef.current != null;
  const isRecordingActive = () => DAW.tracks.some((t) => t.kind === "audioIn" && t.recording);
  const stopAutoStopMonitor = () => { if (autoStopRef.current) { clearInterval(autoStopRef.current); autoStopRef.current = null; } };
  const startAutoStopMonitor = () => {
    stopAutoStopMonitor();
    autoStopRef.current = setInterval(() => {
      if (!isRecordingActive()) { stopAutoStopMonitor(); return; }
      const end = songEndRef.current;
      if (end > 0 && (DAW.getPlayhead() >= end - 0.03 || !DAW.isPlaying)) doStopRecording();
    }, 120);
  };
  const beginRecorderAt = async (target) => {
    let end = 0;
    DAW.tracks.forEach((t) => {
      if (t.id !== target.id && Array.isArray(t.clips)) t.clips.forEach((c) => { end = Math.max(end, c.end || 0); });
    });
    songEndRef.current = end;
    if (end > 0) target._recordingDurationLimit = end;
    else delete target._recordingDurationLimit;
    const wasPlaying = DAW.isPlaying;
    await toggleRecording(target);          // starts the recorder at the current playhead
    if (!isRecordingActive()) {             // start failed (device error etc.) → undo repeat change
      if (prevLoopRef.current) DAW.setLoop(true);
      prevLoopRef.current = null;
      return;
    }
    if (!wasPlaying) DAW.play();             // count-in case: begin playback from the same position
    startAutoStopMonitor();
    force((n) => n + 1);
  };
  const beginRecordFlow = () => {
    const target = DAW.tracks.find((t) => t.kind === "audioIn" && t.params && t.params.arm);
    if (!target) return;
    prevLoopRef.current = DAW.loopEnabled;
    if (DAW.loopEnabled) DAW.setLoop(false);
    if (DAW.isPlaying) { beginRecorderAt(target); return; }
    let n = 3;                               // 3-second count-in overlay before play+record
    setRecordCount(n);
    window.__recordCountdownActive = true;
    recordCountRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(recordCountRef.current); recordCountRef.current = null;
        window.__recordCountdownActive = false;
        setRecordCount(null);
        beginRecorderAt(target);
      } else setRecordCount(n);
    }, 1000);
  };
  const cancelCountIn = () => {
    if (recordCountRef.current) { clearInterval(recordCountRef.current); recordCountRef.current = null; }
    window.__recordCountdownActive = false;
    setRecordCount(null);
    if (prevLoopRef.current) DAW.setLoop(true); // nothing recorded → restore Repeat
    prevLoopRef.current = null;
    force((n) => n + 1);
  };
  const doStopRecording = () => {
    stopAutoStopMonitor();
    const target = DAW.tracks.find((t) => t.kind === "audioIn" && t.recording);
    if (target) toggleRecording(target);      // stop + finalize the recorder
    DAW.stop();                               // stop playback (playhead → 0)
    if (prevLoopRef.current) DAW.setLoop(true); // restore Repeat
    prevLoopRef.current = null;
    force((n) => n + 1);
  };
  const transportRecordToggle = () => { if (isCountingIn()) return cancelCountIn(); if (isRecordingActive()) return doStopRecording(); beginRecordFlow(); };
  const transportStop = () => { if (isCountingIn()) return cancelCountIn(); if (isRecordingActive()) return doStopRecording(); DAW.stop(); force((n) => n + 1); };
  const transportPlayPause = () => { if (isCountingIn()) return cancelCountIn(); if (isRecordingActive()) return; DAW.isPlaying ? DAW.pause() : DAW.play(); force((n) => n + 1); };
  const transportToStart = () => { if (isCountingIn() || isRecordingActive()) return; DAW.seek(0); force((n) => n + 1); };
  transportRef.current = { transportRecordToggle, transportStop, transportPlayPause, transportToStart, isRecordingActive, isCountingIn };
  // Mouse seeks (ruler / track lanes / output track) are ignored while recording
  // or counting in, matching the keyboard seek keys — the playhead must not jump
  // mid-take.
  const guardedUserSeek = (t) => {
    if (isRecordingActive() || isCountingIn()) return;
    DAW.userSeek(t);
    force((n) => n + 1);
  };

  useEffect(() => {
    const onRecordToggle = () => transportRef.current.transportRecordToggle && transportRef.current.transportRecordToggle();
    const onTransport = (e) => {
      const a = e.detail && e.detail.action;
      const T = transportRef.current;
      if (a === "record") T.transportRecordToggle && T.transportRecordToggle();
      else if (a === "stop") T.transportStop && T.transportStop();
      else if (a === "playpause") T.transportPlayPause && T.transportPlayPause();
      else if (a === "tostart") T.transportToStart && T.transportToStart();
    };
    window.addEventListener("focusdaw-record-toggle", onRecordToggle);
    window.addEventListener("focusdaw-transport", onTransport);
    return () => {
      window.removeEventListener("focusdaw-record-toggle", onRecordToggle);
      window.removeEventListener("focusdaw-transport", onTransport);
    };
  }, [toggleRecording]);

  const newProject = () => {
    const nextName = DEFAULT_PROJECT_NAME;
    DAW.clearTracks();
    if (onRenameProject) onRenameProject(nextName);
    if (onProjectPathChange) onProjectPathChange(null);
    setPx(96);
    setAmp(1);
    undoStack.current = [];
    redoStack.current = [];
    if (onUndoStateChange) onUndoStateChange({ canUndo: false, canRedo: false });
    fitTimelineRef.current = true;
    updateTimeMin();
    saveRecentProject(nextName, null);
    force((n) => n + 1);
  };
  // Edit ▸ "Delete all tracks": wipe every audio track but KEEP project-wide
  // (master) settings — effects, master EQ, ambience, fades. Track-scoped
  // settings (pan, per-track gain) vanish with their tracks, as requested.
  // This cannot be undone (deleted track buffers aren't held in snapshots), so
  // it goes through a confirmation dialog and clears the undo/redo history.
  const requestDeleteAllTracks = useCallback(() => {
    if (DAW.tracks.length === 0) return; // nothing to delete
    setConfirmDeleteAll(true);
  }, []);
  const deleteAllTracks = useCallback(() => {
    DAW.clearTracksKeepMaster();
    undoStack.current = [];
    redoStack.current = [];
    if (onUndoStateChange) onUndoStateChange({ canUndo: false, canRedo: false });
    fitTimelineRef.current = true;
    updateTimeMin();
    saveRecentProject(projectName, projectPath);
    setConfirmDeleteAll(false);
    force((n) => n + 1);
  }, [onUndoStateChange, projectName, projectPath]);
  const loadDemo = () => {
    const nextName = projectName || "Demo Session";
    DAW.addDemoTracks();
    if (onRenameProject) onRenameProject(nextName);
    if (onProjectPathChange) onProjectPathChange(null);
    setAmp(1);
    undoStack.current = [];
    redoStack.current = [];
    if (onUndoStateChange) onUndoStateChange({ canUndo: false, canRedo: false });
    fitTimelineToProject();
    saveRecentProject(nextName, null);
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
      onSaveAs: saveProjectAs,
      onOpenProject: window.electronAPI
        ? () => openProjectFile(null)
        : () => focusRef.current && focusRef.current.click(),
      onOpenRecentProject: (json, path) => loadProjectJson(json, path || null),
      onOpenAdvancedAmbience: openAdvancedAmbience,
      onOpenAdvancedPan: openAdvancedPan,
      onOpenAdvancedEq: openAdvancedEq,
      onUndo: undo,
      onRedo: redo,
      onDeleteAllTracks: requestDeleteAllTracks,
    });
  }, [registerHandlers, saveProject, saveProjectAs, openProjectFile, loadProjectJson, pickAudioFiles, pickAudioFolder, loadDemo, newProject, openAdvancedAmbience, openAdvancedPan, openAdvancedEq, undo, redo, requestDeleteAllTracks]);

  const param = (id) => (k, v) => {
    const targetTrack = DAW.tracks.find((track) => track.id === id);
    // While recording (or during the 3s record count-in) the armed input is
    // fixed — toggling ARM would disarm the running take or reroute the input
    // mid-record. Ignore ARM changes then (no undo snapshot either). Same guard
    // mirrored in the mixer-window path (SET_TRACK_PARAM).
    if (k === "arm" && (isRecordingActive() || isCountingIn())) return;
    const undoKey = `${id}-${k}`;
    if (lastUndoKey.current !== undoKey) { pushUndo(); lastUndoKey.current = undoKey; }
    if (k === "arm" && v) {
      DAW.tracks.forEach((track) => {
        if (track.id !== id && track.kind === "audioIn" && track.params && track.params.arm)
          DAW.setTrackParam(track.id, "arm", false);
      });
      const input = audioInputSettingsForTrack(targetTrack);
      if (DAW.setAudioInput) DAW.setAudioInput(input).catch((e) => console.warn("[AudioInput] arm prepare failed:", e));
      if (DAW.setInputGain) DAW.setInputGain(
        Math.max(0.1, Math.min(4, targetTrack && targetTrack.params && targetTrack.params.inputGain != null
          ? targetTrack.params.inputGain : 1))
      );
    }
    if (k === "arm" && !v && DAW.setInputGain) DAW.setInputGain(1);
    if (k === "inputGain" && targetTrack && targetTrack.kind === "audioIn"
        && targetTrack.params && (targetTrack.params.arm || targetTrack.recording)
        && DAW.setInputGain)
      DAW.setInputGain(v);
    DAW.setTrackParam(id, k, v);
    if ((k === "inputChannel" || k === "inputStereo")) {
      const updatedTrack = DAW.tracks.find((track) => track.id === id);
      if (updatedTrack && updatedTrack.kind === "audioIn"
          && updatedTrack.params && (updatedTrack.params.arm || updatedTrack.recording)
          && DAW.setAudioInput)
        DAW.setAudioInput(audioInputSettingsForTrack(updatedTrack)).catch((e) => console.warn("[AudioInput] port switch failed:", e));
    }
    saveRecentProject(projectName, projectPath);
    force((n) => n + 1);
  };
  // Shift+Mute on a file track toggles Mute for ALL file tracks at once (file
  // tracks only). One undo snapshot covers the whole batch.
  const muteAllFileTracks = (next) => {
    pushUndo(); lastUndoKey.current = null;
    DAW.tracks.forEach((track) => {
      if (track.kind === "file") DAW.setTrackParam(track.id, "mute", next);
    });
    saveRecentProject(projectName, projectPath);
    force((n) => n + 1);
  };
  // Rename a track from the header (double-click the title). For Audio In tracks
  // that own a recorded WAV, also rename the file on disk to match and re-point
  // the track/source references (imported stem files are never renamed).
  const renameTrack = async (id, newName) => {
    const track = DAW.tracks.find((t) => t.id === id);
    if (!track) return;
    const name = String(newName || "").trim();
    if (!name || name === track.name) return;
    pushUndo(); lastUndoKey.current = null;
    track.name = name;
    force((n) => n + 1);
    if (track.kind === "audioIn" && track.filePath && window.electronAPI && window.electronAPI.renameRecording) {
      try {
        const res = await window.electronAPI.renameRecording(track.filePath, name);
        if (res && res.path) {
          track.filePath = res.path;
          track.fileName = res.fileName;
          if (Array.isArray(track.sources) && track.sources[0]) {
            track.sources[0].filePath = res.path;
            track.sources[0].fileName = res.fileName;
          }
        }
      } catch (e) {
        alert(`Track renamed, but its recording file could not be renamed: ${e.message || e}`);
      }
    }
    saveRecentProject(projectName, projectPath);
    force((n) => n + 1);
  };
  const clearMuteSolo = useCallback(() => {
    pushUndo();
    DAW.clearAllMuteSolo();
    saveRecentProject(projectName, projectPath);
    force((n) => n + 1);
  }, [pushUndo, projectName, projectPath]);
  const removeTrack = (id) => {
    const deletingLastTrack = DAW.tracks.length === 1 && DAW.tracks[0] && DAW.tracks[0].id === id;
    if (deletingLastTrack) {
      undoStack.current = [];
      redoStack.current = [];
      lastUndoKey.current = null;
      if (onUndoStateChange) onUndoStateChange({ canUndo: false, canRedo: false });
    } else {
      pushUndo();
    }
    // Delegate to the engine so the track's live audio source is stopped and its
    // nodes disconnected (and the native engine is told to drop it). Splicing the
    // array alone left the deleted track audible during playback.
    DAW.removeTrack(id);
    setSelectedFileTrackIds((ids) => ids.filter((trackId) => trackId !== id));
    if (deletingLastTrack) {
      fitTimelineRef.current = true;
      updateTimeMin();
    }
    saveRecentProject(projectName, projectPath);
    force((n) => n + 1);
  };

  const onDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files];
    const focusFile = files.find((f) => /\.focus$/i.test(f.name));
    if (focusFile) {
      await openProjectFile(focusFile);
      return;
    }
    const transferItems = [...(e.dataTransfer.items || [])];
    const droppedFolders = transferItems
      .map((item) => {
        if (!item || item.kind !== "file" || !item.webkitGetAsEntry) return null;
        const entry = item.webkitGetAsEntry();
        if (!entry || !entry.isDirectory) return null;
        const file = (item.getAsFile ? item.getAsFile() : null)
          || files.find((f) => f && f.name === entry.name)
          || null;
        return { entry, file, name: entry.name || (file && file.name) || "", path: electronFilePath(file) };
      })
      .filter(Boolean);
    if (droppedFolders.length && window.electronAPI && window.electronAPI.scanAudioFolder) {
      const scannedItems = [];
      let folderName = droppedFolders[0].name;
      for (const folder of droppedFolders) {
        if (!folder.path) continue;
        try {
          const result = await window.electronAPI.scanAudioFolder(folder.path);
          if (result && result.folderName && !folderName) folderName = result.folderName;
          if (result && Array.isArray(result.items)) scannedItems.push(...result.items);
        } catch (err) {
          console.error("Failed to scan dropped folder", folder.path, err);
        }
      }
      if (scannedItems.length) {
        addElectronFiles(scannedItems, { folderName });
      }
      return;
    }
    if (droppedFolders.length && !window.electronAPI) {
      const folder = droppedFolders[0];
      const rootFiles = await readDirectoryEntryRootFiles(folder.entry);
      if (rootFiles.length) {
        await addFiles(rootFiles, false, folder.name);
      }
      return;
    }
    if (window.electronAPI) {
      const items = files
        .map((f) => ({ file: f, path: electronFilePath(f) }))
        .filter((item) => /\.(mp3|wav|aiff?|m4a|ogg|flac)$/i.test(item.file.name) && item.path)
        .map((item) => ({
          name: item.file.name,
          displayName: item.file.name.replace(/\.(mp3|wav|aiff?|m4a|ogg|flac)$/i, ""),
          path: item.path,
          size: item.file.size,
          mtimeMs: item.file.lastModified,
        }));
      if (items.length) { addElectronFiles(items); return; }
    }
    addFiles(files);
  };
  // Only react to external FILE drags (audio import). Internal element/text drags are
  // suppressed globally (see studio.html dragstart handler); this Files check is a
  // second guard so a stray non-file drag never lights up the import dropzone outline.
  const isFileDrag = (e) => {
    const types = e.dataTransfer && e.dataTransfer.types;
    return !!types && Array.prototype.indexOf.call(types, "Files") !== -1;
  };
  const onDragOver = (e) => { if (!isFileDrag(e)) return; e.preventDefault(); if (!dragOver) setDragOver(true); };
  const onDragLeave = (e) => { if (e.currentTarget === e.target) setDragOver(false); };
  const empty = DAW.tracks.length === 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
      {recordCount != null && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "grid", placeItems: "center",
          background: "rgba(0,0,0,.45)", pointerEvents: "none" }}>
          <div key={recordCount} style={{ fontSize: "11vmin", fontWeight: 400, lineHeight: 1, color: "var(--cream)",
            fontFamily: '"Orbitron", var(--mono, monospace)', textShadow: "0 0 40px rgba(0,0,0,.85), 0 8px 30px rgba(0,0,0,.6)",
            animation: "recordCountPulse .9s ease-out" }}>
            {recordCount}
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" multiple accept=".mp3,.wav,.aiff,.m4a,.ogg,.flac" style={{ display: "none" }}
        onChange={(e) => { addFiles([...e.target.files]); e.target.value = ""; }} />
      <input ref={folderRef} type="file" webkitdirectory="" directory="" multiple style={{ display: "none" }}
        onChange={(e) => {
          const files = [...e.target.files];
          const rel = files[0] && files[0].webkitRelativePath;
          addFiles(files, true, rel ? rel.split("/")[0] : null);
          e.target.value = "";
        }} />
      <input ref={focusRef} type="file" accept=".focus,application/json" style={{ display: "none" }}
        onChange={(e) => { if (e.target.files[0]) { openProjectFile(e.target.files[0]); e.target.value = ""; } }} />

      {/* control bar */}
      <div style={{ height: 68, flex: "0 0 68px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "0 16px",
        background: "linear-gradient(180deg,var(--surface),var(--bg2))", borderBottom: "1px solid var(--line-strong)", position: "relative" }}>
        {/* left cluster: undo/redo + zoom + tools + row height + minimap */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "1 1 auto", minWidth: 0 }}>
          <div style={{ display: "flex", gap: 2 }}>
            <button className="iconbtn" style={{ width: 30, height: 30, opacity: undoStack.current.length ? 1 : 0.32 }}
              onClick={undo} title="Undo (Ctrl+Z)" disabled={!undoStack.current.length}>
              <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7H10.5a3.5 3.5 0 010 7H7" /><path d="M5.5 4.5L3 7l2.5 2.5" />
              </svg>
            </button>
            <button className="iconbtn" style={{ width: 30, height: 30, opacity: redoStack.current.length ? 1 : 0.32 }}
              onClick={redo} title="Redo (Ctrl+Y / Ctrl+Shift+Z)" disabled={!redoStack.current.length}>
              <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 7H5.5a3.5 3.5 0 000 7H9" /><path d="M10.5 4.5L13 7l-2.5 2.5" />
              </svg>
            </button>
          </div>
          <div style={{ width: 1, height: 30, background: "var(--line)" }} />
          <ZoomBar pxPerSec={pxPerSec} setPx={setPxFromUser} ampZoom={ampZoom} setAmp={setAmp} timeMin={timeMinPx} />
          <div style={{ width: 1, height: 30, background: "var(--line)" }} />
          {/* Select/Seek · Split · Join tools hidden on screen (code kept) — re-enable: <ToolBar tool={tool} setTool={setTool} /> + a divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, letterSpacing: ".06em" }}>TRACK SIZE</span>
            <Seg small value={laneH} onChange={setLaneH} options={[{ v: 68, l: "S" }, { v: 96, l: "M" }, { v: 132, l: "L" }]} />
          </div>
          <TimelineMinimap arrangeRef={arrangeRef} pxPerSec={pxPerSec} playhead={playhead} viewState={timelineView} setPx={setPxFromUser} timeMin={timeMinPx} onScroll={scrollArrangeTo} />
        </div>
        {/* right cluster: project tempo + actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: "auto", flex: "0 0 auto" }}>
          <BpmIndicator
            tempo={DAW.tempo}
            open={bpmOpen}
            manualBpm={manualBpm}
            measuredBpm={measuredBpm}
            detecting={detecting}
            detectSeq={detectSeq}
            applySeq={applySeq}
            tapInfo={tapInfo}
            selectedTrack={selectedBpmTrack}
            selectedTrackIndex={selectedBpmTrackIndex}
            hasOnlyOneTrack={DAW.tracks.length === 1}
            onlyTrack={DAW.tracks[0] || null}
            onToggle={() => { touchBpmPanel(); setBpmOpen((v) => !v); }}
            onActivity={touchBpmPanel}
            onMouseInside={setBpmHover}
            onPlaybackAdjust={adjustPlaybackBpm}
            playbackBpmDraft={playbackBpmDraft}
            onManualBpm={(value) => { touchBpmPanel(); setManualBpm(value); }}
            onDetect={detectBpm}
            onTap={tapBpm}
            onApply={applyBpm}
          />
          <VariBpmSwitch on={!!(DAW.tempo && DAW.tempo.variBpm)} onToggle={toggleVariBpm} />
          <ToolbarDivider />
          <KeyIndicator
            tempo={DAW.tempo}
            open={keyOpen}
            detecting={detectingKey}
            hasAudio={DAW.tracks.some((t) => t && t.buffer && !t.needsAudio && !(t.params && t.params.mute))}
            onToggle={() => { touchKeyPanel(); setKeyOpen((v) => !v); }}
            onActivity={touchKeyPanel}
            onMouseInside={setKeyHover}
            onDetect={detectKey}
            onApplyKey={applyKey}
          />
          <VariKeySwitch on={!!(DAW.tempo && DAW.tempo.variKey)} onToggle={toggleVariKey} />
          <ToolbarDivider />
          <ActionBar onMixer={toggleMixer} mixerOpen={showMixer} onExport={() => setShowExport(true)} />
        </div>
      </div>

      {/* arrange scroll area (whole area is a dropzone) */}
      <div ref={arrangeRef} data-arrange-scroll="true" onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
        style={{ flex: 1, overflow: "auto", position: "relative", outline: dragOver && !empty ? "2px dashed var(--amber)" : "none", outlineOffset: -4 }}>
        <TimeStretchBusyBadge active={stretchPreparing} x={overlayX} y={overlayY} />
        {empty ? (
          <EmptyState dragOver={dragOver} onPick={pickAudioFiles} onPickFolder={pickAudioFolder} onDemo={loadDemo} />
        ) : (
          <React.Fragment>
            <div style={{ position: "relative", minWidth: "min-content" }}>
              <Ruler pxPerSec={pxPerSec} playhead={playhead} onSeek={guardedUserSeek} onAddTrack={pickAudioFiles} onAddAudioIn={addAudioInTrack} />
              {fileTracks.length > 0 && (
                <FileTrackGroupHeader tracks={fileTracks} count={fileTracks.length} collapsed={fileTracksCollapsed}
                  onToggle={toggleFileTracks} pxPerSec={pxPerSec} playhead={playhead}
                  stats={fileTrackStats} selectedCount={selectedFileTracks.length}
                  onMergeSelected={openMergeTracksDialog} />
              )}
              {!fileTracksCollapsed && fileTracks.map((t) => {
                const i = DAW.tracks.findIndex((track) => track.id === t.id);
                // Bounce tracks live in this group too (fileTracks includes kind:"bounce") and
                // they are clip-editable, so they need the same clip-edit props as Audio In.
                // Without them the overlay rendered but every edit was a silent no-op.
                // Plain file tracks are lockedToZero, so TrackRow's own clipEditable check
                // keeps the overlay off them.
                return <TrackRow key={t.id} track={t} idx={i} pxPerSec={pxPerSec} ampZoom={ampZoom} laneH={laneH}
                  headerIndent={15}
                  playhead={playhead} playbackLevel={DAW.getTrackLevel(t.id)} onParam={param(t.id)} onRemove={() => removeTrack(t.id)}
                  onSeek={guardedUserSeek}
                  onFocusFx={focusMixerFx}
                  selected={selectedFileTrackSet.has(t.id)}
                  onSelect={(e) => selectFileTrack(t.id, e)}
                  onMuteAllFiles={muteAllFileTracks}
                  onRename={renameTrack}
                  selectedClipId={selectedClip && selectedClip.trackId === t.id ? selectedClip.clipId : null}
                  onSelectClip={handleSelectClip} onMoveClip={handleMoveClip}
                  onTrimStart={handleTrimStart} onTrimEnd={handleTrimEnd}
                  onDeleteClip={handleDeleteClip} onCopyClip={handleCopyClip}
                  onPasteClip={handlePasteClip} onDuplicateClip={handleDuplicateClip}
                  onDeselectClip={handleDeselect} onSetTool={setTool}
                  tool={tool} onSplit={handleSplit} onJoin={handleJoin} onBeforeChange={pushUndo} />;
              })}
              {nonFileTracks.map((t) => {
                const i = DAW.tracks.findIndex((track) => track.id === t.id);
                const trackLaneH = t.kind === "audioIn" ? audioInLaneHeight : laneH;
                return <TrackRow key={t.id} track={t} idx={i} pxPerSec={pxPerSec} ampZoom={ampZoom} laneH={trackLaneH} sizeLaneH={laneH}
                  playhead={playhead} playbackLevel={DAW.getTrackLevel(t.id)}
                  inputLevel={t.kind === "audioIn" ? DAW.getInputLevel() : 0}
                  inputGr={t.kind === "audioIn" && DAW.getInputGainReduction ? DAW.getInputGainReduction() : 0}
                  recordingActive={DAW.tracks.some((tr) => tr.kind === "audioIn" && tr.recording) || recordCount != null}
                  onParam={param(t.id)} onRemove={() => removeTrack(t.id)}
                  onSeek={guardedUserSeek}
                  onFocusFx={focusMixerFx}
                  onRename={renameTrack}
                  selectedClipId={selectedClip && selectedClip.trackId === t.id ? selectedClip.clipId : null}
                  onSelectClip={handleSelectClip} onMoveClip={handleMoveClip}
                  onTrimStart={handleTrimStart} onTrimEnd={handleTrimEnd}
                  onDeleteClip={handleDeleteClip} onCopyClip={handleCopyClip}
                  onPasteClip={handlePasteClip} onDuplicateClip={handleDuplicateClip}
                  onDeselectClip={handleDeselect} onSetTool={setTool}
                  tool={tool} onSplit={handleSplit} onJoin={handleJoin} onBeforeChange={pushUndo} />;
              })}
              <OutputTrack pxPerSec={pxPerSec} laneH={Math.max(110, laneH * 0.9)} playhead={playhead}
                onSeek={guardedUserSeek}
                onOpenMixer={openMixerIfClosed} onBeforeChange={pushUndo}
                onClearMuteSolo={clearMuteSolo} />
              {DAW.loopRange && (
                <div
                  style={{
                    position: "absolute",
                    left: (window.HEADER_W || 274) + (DAW.loopRange.start / DAW.duration) * Math.max(1, DAW.duration * pxPerSec),
                    width: ((DAW.loopRange.end - DAW.loopRange.start) / DAW.duration) * Math.max(1, DAW.duration * pxPerSec),
                    top: 0,
                    bottom: 0,
                    background: DAW.repeatPlayEnabled ? "rgba(232,176,75,.16)" : "rgba(232,176,75,.05)",
                    borderLeft: "1px dashed " + (DAW.repeatPlayEnabled ? "rgba(232,176,75,.75)" : "rgba(255,255,255,.35)"),
                    borderRight: "1px dashed " + (DAW.repeatPlayEnabled ? "rgba(232,176,75,.75)" : "rgba(255,255,255,.35)"),
                    pointerEvents: "none",
                    zIndex: 9
                  }}
                >
                  {/* Sticky header container to lock triangles to the sticky Time Ruler */}
                  <div style={{ position: "sticky", top: 0, height: 30, width: "100%", overflow: "visible" }}>
                    {/* Loop Start Triangle Bracket (fills top-left 10x10 corner) */}
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        width: 10,
                        height: 10,
                        background: DAW.repeatPlayEnabled ? "var(--amber)" : "rgba(255,255,255,.4)",
                        clipPath: "polygon(0 0, 100% 0, 0 100%)"
                      }}
                    />
                    {/* Loop End Triangle Bracket (fills top-right 10x10 corner) */}
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: 0,
                        width: 10,
                        height: 10,
                        background: DAW.repeatPlayEnabled ? "var(--amber)" : "rgba(255,255,255,.4)",
                        clipPath: "polygon(0 0, 100% 0, 100% 100%)"
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
            <div style={{ height: 40 }} />
          </React.Fragment>
        )}
      </div>

      {/* vertical scroll arrows — appear only when the track list overflows */}
      {!empty && vScroll.up && (
        <button className="arrange-scroll-arrow up" onClick={() => scrollArrangeV(-1)} title="Scroll up" aria-label="Scroll tracks up">
          <span className="arrange-scroll-disc">
            <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="4 15 12 7 20 15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        </button>
      )}
      {!empty && vScroll.down && (
        <button className="arrange-scroll-arrow down" onClick={() => scrollArrangeV(1)} title="Scroll down" aria-label="Scroll tracks down">
          <span className="arrange-scroll-disc">
            <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="4 9 12 17 20 9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        </button>
      )}

      {showExport && <ExportDialog projectName={projectName} onClose={() => setShowExport(false)} />}
      {mergeTracksNotice && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(8,6,4,.6)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center" }}
          onMouseDown={() => { if (!mergeTracksBusy) setMergeTracksNotice(false); }}>
          <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 460, background: "var(--bg)", border: "1px solid var(--line-strong)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
              <Icon name="mixer" size={17} style={{ color: "var(--amber)" }} />
              <span style={{ fontWeight: 600, fontSize: 14 }}>Merge Tracks</span>
            </div>
            <div style={{ padding: "18px 20px", display: "grid", gap: 14 }}>
              <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--surface2)", border: "1px solid var(--line)", color: "var(--cream-2)", fontSize: 12.5, lineHeight: 1.5 }}>
                {selectedFileTracks.map((track) => track.name).join(", ")}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: "12px 14px", alignItems: "center", fontSize: 12.5 }}>
                <span style={{ color: "var(--muted)", fontWeight: 600 }}>Track Name</span>
                <input value={mergeTracksName}
                  disabled={mergeTracksBusy}
                  onChange={(e) => setMergeTracksName(e.target.value)}
                  style={{ width: "100%", minWidth: 0, height: 32, borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--cream)", padding: "0 10px", outline: "none", fontSize: 12.5 }}
                  onFocus={(e) => e.target.select()} />
                <span style={{ color: "var(--muted)", fontWeight: 600 }}>Channels</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className={mergeTracksOptions.channels === "stereo" ? "btn primary" : "btn"}
                    disabled={mergeTracksBusy}
                    onClick={() => updateMergeTracksOption("channels", "stereo")}
                    style={{ padding: "7px 12px" }}>Stereo</button>
                  <button className={mergeTracksOptions.channels === "mono" ? "btn primary" : "btn"}
                    disabled={mergeTracksBusy}
                    onClick={() => updateMergeTracksOption("channels", "mono")}
                    style={{ padding: "7px 12px" }}>Mono</button>
                </div>
                <span style={{ color: "var(--muted)", fontWeight: 600 }}>Originals</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className={mergeTracksOptions.originals === "mute" ? "btn primary" : "btn"}
                    disabled={mergeTracksBusy}
                    onClick={() => updateMergeTracksOption("originals", "mute")}
                    style={{ padding: "7px 12px" }}>Keep + Mute</button>
                  <button className={mergeTracksOptions.originals === "keep" ? "btn primary" : "btn"}
                    disabled={mergeTracksBusy}
                    onClick={() => updateMergeTracksOption("originals", "keep")}
                    style={{ padding: "7px 12px" }}>Keep</button>
                  <button className={mergeTracksOptions.originals === "delete" ? "btn primary" : "btn"}
                    disabled={mergeTracksBusy}
                    onClick={() => updateMergeTracksOption("originals", "delete")}
                    style={{ padding: "7px 12px" }}>Delete</button>
                </div>
              </div>
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 2 }}>
                <button className="btn" disabled={mergeTracksBusy} onClick={() => setMergeTracksNotice(false)}>Cancel</button>
                <button className="btn primary" disabled={mergeTracksBusy || selectedFileTracks.length < 2} onClick={renderMergedTracks}>
                  {mergeTracksBusy ? "Rendering..." : "Create Bounce"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {confirmDeleteAll && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(8,6,4,.6)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center" }}
          onMouseDown={() => setConfirmDeleteAll(false)}>
          <div onMouseDown={(e) => e.stopPropagation()}
            style={{ width: 420, background: "var(--bg)", border: "1px solid var(--line-strong)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
              <Icon name="trash" size={18} style={{ color: "var(--red)" }} />
              <span style={{ fontWeight: 600, fontSize: 15 }}>Delete all tracks</span>
            </div>
            <div style={{ padding: "18px 20px", fontSize: 13, lineHeight: 1.5, color: "var(--cream-2)" }}>
              Remove every audio track from this project? Project-wide settings
              (effects, master EQ, ambience) are kept, but this clears all tracks
              and <b>cannot be undone</b>.
            </div>
            <div style={{ padding: "0 20px 18px", display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="btn" onClick={() => setConfirmDeleteAll(false)}
                style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line-strong)", background: "var(--surface2)", color: "var(--cream-2)", fontSize: 12.5, fontWeight: 600 }}>
                Cancel
              </button>
              <button className="btn" onClick={deleteAllTracks}
                style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--red)", background: "var(--red)", color: "#fff", fontSize: 12.5, fontWeight: 600 }}>
                Delete all
              </button>
            </div>
          </div>
        </div>
      )}
      <LoadingOverlay state={loading} />
    </div>
  );
}

/* ---------- root ---------- */
function App() {
  const [projectName, setProjectName] = useState(DEFAULT_PROJECT_NAME);
  const projectNameRef = useRef(DEFAULT_PROJECT_NAME);
  const [projectPath, setProjectPath] = useState(null);
  const [startupReady, setStartupReady] = useState(false);
  const handlersRef = useRef({});
  const [, force] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("focusdaw-theme") || "default");
  const [mixerTexture, setMixerTexture] = useState(() => localStorage.getItem("focusdaw-mixer-texture") || "none");
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false });
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
    }, setProjectPath);
    setStartupReady(true);
    force((n) => n + 1);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "default") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    localStorage.setItem("focusdaw-theme", theme);
    try {
      const channel = new BroadcastChannel("focusdaw-theme-sync");
      channel.postMessage({ type: "THEME_CHANGED", theme });
      channel.close();
    } catch (e) {}
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("focusdaw-mixer-texture", mixerTexture || "none");
  }, [mixerTexture]);

  useEffect(() => {
    document.title = `${projectName || DEFAULT_PROJECT_NAME}-FocusDAW Studio`;
  }, [projectName]);

  const openHelpManual = useCallback(() => {
    if (window.electronAPI && window.electronAPI.openHelp) {
      window.electronAPI.openHelp();
      return;
    }
    const features = "width=1040,height=760,resizable=yes,scrollbars=no";
    const popup = window.open("help.html", "FocusDAWHelp", features);
    if (!popup) setShowHelp(true);
  }, []);

  const H = handlersRef.current;
  return (
    <div className="app">
      <MenuBar projectName={projectName} onRename={renameProject}
        onNew={() => H.onNew && H.onNew()} onImport={() => H.onImport && H.onImport()}
        onImportFolder={() => H.onImportFolder && H.onImportFolder()} onLoadDemo={() => H.onLoadDemo && H.onLoadDemo()}
        onExport={() => H.onExport && H.onExport()}
        onSave={() => H.onSave && H.onSave()}
        onSaveAs={() => H.onSaveAs && H.onSaveAs()}
        onOpenProject={() => H.onOpenProject && H.onOpenProject()}
        onOpenRecentProject={(json, path) => H.onOpenRecentProject && H.onOpenRecentProject(json, path)}
        onSettings={() => setShowSettings(true)}
        onAdvancedAmbience={() => H.onOpenAdvancedAmbience && H.onOpenAdvancedAmbience()}
        onAdvancedPan={() => H.onOpenAdvancedPan && H.onOpenAdvancedPan()}
        onAdvancedEq={() => H.onOpenAdvancedEq && H.onOpenAdvancedEq()}
        onUndo={() => H.onUndo && H.onUndo()} onRedo={() => H.onRedo && H.onRedo()}
        canUndo={undoState.canUndo} canRedo={undoState.canRedo}
        onDeleteAllTracks={() => H.onDeleteAllTracks && H.onDeleteAllTracks()}
        onHelpManual={openHelpManual}
        onHelpReleaseNotes={() => setShowReleaseNotes(true)}
        onHelpAbout={() => setShowAbout(true)} />
      <Studio projectName={projectName} projectNameRef={projectNameRef} projectPath={projectPath} startupReady={startupReady}
        registerHandlers={registerHandlers}
        onRenameProject={renameProject}
        onProjectPathChange={setProjectPath}
        onUndoStateChange={setUndoState}
        theme={theme}
        mixerTexture={mixerTexture} />
      {showSettings && <SettingsDialog currentTheme={theme} onThemeChange={setTheme}
        mixerTexture={mixerTexture} onMixerTextureChange={setMixerTexture}
        onClose={() => setShowSettings(false)} />}
      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
      {showReleaseNotes && <ReleaseNotesDialog onClose={() => setShowReleaseNotes(false)} />}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      <div className="bottombar">
        <span className="bottom-project mono">{projectName || DEFAULT_PROJECT_NAME}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10.5, color: "var(--dim)", fontWeight: 600, letterSpacing: ".03em" }}>FocusDAW Studio</span>
          <span className="version-badge">{APP_VERSION}</span>
        </div>
      </div>
    </div>
  );
}

DAW.init();
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
