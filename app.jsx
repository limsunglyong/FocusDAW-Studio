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

// Absolute path? Windows drive (C:\ or C:/), UNC (\\ or //), or POSIX root (/). A collected
// source stores a RELATIVE path (Save As, Phase 7); everything else is absolute.
function isAbsolutePath(p) {
  return /^([a-zA-Z]:[\\/]|[\\/]{2}|[\\/])/.test(p || "");
}
function dirnameFromPath(filePath) {
  const s = String(filePath || "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i >= 0 ? s.slice(0, i) : "";
}
// Resolve a stored source path for reading. A relative path (collected file) is resolved
// against the project's own folder; absolute paths (imported stems, legacy projects) pass
// through unchanged. read-audio-file then normalises the separators via path.resolve.
function resolveSourcePath(filePath, projectPath) {
  if (!filePath) return filePath;
  if (isAbsolutePath(filePath)) return filePath;
  const dir = dirnameFromPath(projectPath);
  return dir ? dir + "/" + filePath : filePath;
}

function releaseVersionLabel(version) {
  const v = String(version || "").trim();
  if (!v) return "unknown";
  return v.startsWith("v") ? v : `v${v}`;
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
        style={{ background: open ? "var(--surface)" : "transparent", color: accent ? "var(--menu-accent-fg,var(--amber))" : "var(--cream-2)", fontWeight: accent ? 600 : 400 }}>
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
                {it.icon && <Icon name={it.icon} size={15} style={{ color: "var(--menu-icon-fg,var(--amber))", flex: "0 0 auto" }} />}
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
                      {sub.icon && <Icon name={sub.icon} size={14} style={{ color: "var(--menu-icon-fg,var(--amber))", flex: "0 0 auto" }} />}
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

function MenuBar({ projectName, onRename, onNew, onImport, onImportFolder, onLoadDemo, onExport, onSave, onSaveAs, onOpenProject, onOpenRecentProject, onSettings, onAdvancedAmbience, onAdvancedPan, onAdvancedEq, onUndo, onRedo, canUndo, canRedo, onDeleteAllTracks, onHelpManual, onHelpReleaseNotes, onCheckUpdates, onHelpAbout }) {
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
    { label: "Check for Updates", icon: "download", onClick: onCheckUpdates },
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
function MenuTransportButton({ title, active, children, onClick, wide, disabled }) {
  const handleClick = (e) => {
    if (disabled) return;
    if (onClick) onClick(e);
    e.currentTarget.blur();
  };
  return (
    <button onClick={handleClick} title={title} disabled={!!disabled}
      style={{ width: wide ? 34 : 27, height: 27, borderRadius: 999, display: "grid", placeItems: "center",
        outline: "none",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "default" : "pointer",
        color: active ? "var(--transport-active-fg,#241a0a)" : "var(--cream-2)",
        background: active
          ? "var(--transport-active-bg,linear-gradient(180deg,var(--amber),var(--amber-deep)))"
          : "linear-gradient(180deg,var(--surface3),var(--surface2))",
        border: "1px solid " + (active ? "var(--transport-active-border,var(--amber))" : "var(--line-strong)"),
        boxShadow: active ? "var(--transport-active-shadow,0 0 12px var(--amber-soft), inset 0 1px 0 rgba(255,255,255,.24))" : "inset 0 1px 0 rgba(255,255,255,.05)",
        transition: "background .14s ease, color .14s ease, box-shadow .14s ease, transform .08s ease" }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = "translateY(1px)"; }}
      onMouseUp={(e) => (e.currentTarget.style.transform = "translateY(0)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}>
      {children}
    </button>
  );
}

/* ---------- count-in metronome (Phase 6 Stage 2) ----------
 * The click itself is generated in the native engine's own device callback
 * (MetronomeClick in AudioEngine.h) — that is what keeps it out of the recorded WAV
 * and out of Export. Everything here is the UI/timing side.
 *
 * The On/Off flag is a UI preference rather than engine or project state, so it is not
 * on DAW and not in the .focus file. MenuTransport (the toggle) and Studio (the record
 * flow) have no shared ancestor state, hence module level + localStorage. MenuTransport
 * re-renders every frame via useTick(), so a change needs no event to show up.
 */
const METRONOME_KEY = "focusdaw-metronome";
let metronomeEnabled = (() => {
  try {
    const raw = localStorage.getItem(METRONOME_KEY);
    return raw == null ? true : raw === "1"; // default On — the BPM count-in is the Stage 2 norm
  } catch (e) { return true; }
})();
const isMetronomeOn = () => metronomeEnabled;
const setMetronomeOn = (on) => {
  metronomeEnabled = !!on;
  try { localStorage.setItem(METRONOME_KEY, metronomeEnabled ? "1" : "0"); } catch (e) {}
};
const COUNT_IN_BEATS = 4;          // one 4/4 bar
const COUNT_IN_LEGACY_TICKS = 3;   // the pre-Stage-2 silent count-in: 3 ticks, a second apart
const COUNT_IN_LEGACY_MS = 1000;
const metronomeBpm = () => (window.DAW && window.DAW.tempo && window.DAW.tempo.projectBpm) || 0;
// A metronome needs a beat grid, and a project with no detected BPM has none. Rather
// than click at a made-up tempo, the toggle goes disabled and the count-in falls back
// to the legacy silent 3×1s path.
const metronomeAvailable = () => metronomeBpm() > 0;
const metronomeActive = () => isMetronomeOn() && metronomeAvailable();

/* ---------- pre-roll (Phase 6 Stage 2b) ----------
 * Record from a stopped transport rolls the EXISTING music for a few seconds first and
 * punches in at the original playhead, instead of counting clicks into it.
 *
 * Why this exists, and why it is measured in SECONDS: this app's material is imported
 * SUNO stems, not MIDI. Their tempo drifts mid-song, and even at a correct BPM a
 * synthesized click has no way to know the song's beat PHASE — so a click grid built
 * from one BPM number disagrees with the music. Pre-roll sidesteps both problems by not
 * being a grid at all: the lead-in IS the song, so it is in time by construction. Bars
 * would reintroduce the very assumption (a known beat grid) we cannot make.
 *
 * Falls back to the count-in when there is nothing to roll into (see prerollAnchorOk).
 */
const PREROLL_KEY = "focusdaw-preroll";
const PREROLL_CHOICES = [0, 2, 4, 8]; // 0 = off; the button cycles through these
const PREROLL_DEFAULT = 4;
let prerollSec = (() => {
  try {
    const raw = localStorage.getItem(PREROLL_KEY);
    if (raw == null) return PREROLL_DEFAULT;
    const n = Number(raw);
    return PREROLL_CHOICES.includes(n) ? n : PREROLL_DEFAULT;
  } catch (e) { return PREROLL_DEFAULT; }
})();
const prerollSeconds = () => prerollSec;
const setPrerollSeconds = (s) => {
  prerollSec = PREROLL_CHOICES.includes(s) ? s : 0;
  try { localStorage.setItem(PREROLL_KEY, String(prerollSec)); } catch (e) {}
};
const cyclePreroll = () => {
  const i = PREROLL_CHOICES.indexOf(prerollSec);
  setPrerollSeconds(PREROLL_CHOICES[(i + 1) % PREROLL_CHOICES.length]);
};

/* ---------- punch recording (Phase 6 Stage 6) ----------
 * A punch reuses the existing Repeat REGION (DAW.loopRange) as the [in, out] span. With
 * Punch ON and a valid region, Record pre-rolls into `in`, auto punch-ins at `in`, auto
 * punch-outs at `out`, and REPLACES only that span in the active take (the rest of the
 * arrangement is untouched) — instead of stacking a loop Take. The toggle is a global
 * mode flag, persisted like the metronome/pre-roll toggles. Requires a region to act;
 * with no region Record falls back to its normal behaviour.
 */
const PUNCH_KEY = "focusdaw-punch";
let punchEnabled = (() => { try { return localStorage.getItem(PUNCH_KEY) === "1"; } catch (e) { return false; } })();
const isPunchOn = () => punchEnabled;
const setPunchOn = (on) => {
  punchEnabled = !!on;
  try { localStorage.setItem(PUNCH_KEY, punchEnabled ? "1" : "0"); } catch (e) {}
};
// A region wide enough to punch into (same 0.05s floor the loop-Take path uses).
const punchRegionValid = () => { const lr = window.DAW && DAW.loopRange; return !!(lr && (lr.end - lr.start) > 0.05); };
// Is there anything to actually roll INTO? Two ways there isn't, and both must fall back
// to the count-in or Record would just sit there playing silence:
//   - the playhead is at (or within a hair of) the very start — nothing precedes it;
//   - the pre-roll window lands past the end of every other track, e.g. recording at 3:00
//     of a song whose music stops at 2:00.
const PREROLL_MIN_ANCHOR = 0.5;
const prerollAnchorOk = (playheadSec, songEnd, prerollLen) =>
  playheadSec > PREROLL_MIN_ANCHOR && songEnd > playheadSec - prerollLen;

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
  // Punch is a "replace the Repeat region" mode, so it only makes sense with a region set.
  // The button is disabled without one; if a region is later removed while Punch is on, clear
  // the flag here (useTick re-renders every frame) so Punch can never be armed region-less —
  // which would otherwise fall through to a destructive whole-track re-record.
  const punchRegion = punchRegionValid();
  if (!punchRegion && isPunchOn()) setPunchOn(false);
  // All transport actions go through Studio's rule-honoring handlers (count-in,
  // Repeat off/restore, ignore pause/return-to-start while recording, etc.).
  const tp = (action) => window.dispatchEvent(new CustomEvent("focusdaw-transport", { detail: { action } }));
  const toggleLoop = () => { DAW.setLoop(!loop); };
  const clickBpm = metronomeBpm();
  const clickOn = metronomeActive();
  const toggleMetronome = () => { setMetronomeOn(!isMetronomeOn()); };
  const proll = prerollSeconds();
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
        <MenuTransportButton
          title={!clickBpm
            ? "Metronome needs a project BPM — detect or set one first"
            : clickOn
              ? `Count-in metronome: On — ${COUNT_IN_BEATS} clicks at ${Math.round(clickBpm)} BPM before recording`
              : "Count-in metronome: Off — silent 3-2-1 count-in"}
          active={clickOn} disabled={!clickBpm} onClick={toggleMetronome}>
          <Icon name="metronome" size={13} />
        </MenuTransportButton>
        {/* One control, cycling off → 2s → 4s → 8s: the label always shows the current
            length, so there is no hidden state and no menu to open for a 4-value knob. */}
        <MenuTransportButton wide
          title={proll
            ? `Pre-roll: ${proll}s — Record plays the existing music for ${proll}s, then starts recording at the playhead. Click to change (2 → 4 → 8 → off).`
            : "Pre-roll: Off — Record starts with a count-in instead. Click to turn on (2 → 4 → 8 → off)."}
          active={proll > 0} onClick={cyclePreroll}>
          <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Icon name="preroll" size={11} />
            {proll > 0 && <span style={{ fontSize: 8.5, fontWeight: 600, lineHeight: 1 }}>{proll}</span>}
          </span>
        </MenuTransportButton>
        {/* Punch (Phase 6 Stage 6): mode toggle. With a Repeat region set, Record replaces
            only that [in,out] span in the active take instead of stacking a take. */}
        <MenuTransportButton
          disabled={!punchRegion}
          title={punchRegion
            ? (isPunchOn()
                ? (DAW.repeatPlayEnabled
                    ? "Punch + Repeat: Loop-Punch Comp — Record captures a Take per pass across the region, keeps the base outside it; switch passes in Take Lanes"
                    : "Punch: On — Record replaces the Repeat region [in→out] in the active take (pre-roll → auto punch-in/out). Turn Repeat ON too for Loop-Punch Comp")
                : "Punch: Off — Click to make Record replace only the Repeat region instead of stacking a take")
            : "To use Punch, set a Repeat region first — drag one on the timeline."}
          active={isPunchOn()} onClick={() => { setPunchOn(!isPunchOn()); }}>
          <Icon name="punch" size={13} />
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
        <span className="mono" style={{ fontSize: 18, fontWeight: 400, color: "var(--timecode-fg,var(--amber))", lineHeight: 1 }}>{fmtTransportTime(playhead)}</span>
        <span className="mono" style={{ fontSize: 10.8, fontWeight: 400, color: "var(--timecode-muted-fg,var(--muted))", lineHeight: 1 }}>/ {fmtTransportTime(duration)}</span>
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
          background: playing ? "var(--transport-active-bg,var(--amber))" : "var(--surface2)", color: playing ? "var(--transport-active-fg,#241a0a)" : "var(--cream)", border: "1px solid " + (playing ? "var(--transport-active-border,var(--amber))" : "var(--line-strong)"), boxShadow: playing ? "var(--transport-active-shadow,0 0 12px rgba(232,176,75,.45))" : "none" }}>
          <Icon name={playing ? "pause" : "play"} size={18} fill />
        </button>
        <button className={"iconbtn" + (loop ? " on" : "")} onClick={onLoop} title="Loop"><Icon name="repeat" size={16} /></button>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "3px 14px", background: "var(--bg)", borderRadius: 9, border: "1px solid var(--line)", minWidth: 118, height: 36 }}>
        <span className="mono" style={{ fontSize: 21, fontWeight: 400, color: "var(--timecode-fg,var(--amber))", letterSpacing: ".02em" }}>{fmtTime(playhead)}</span>
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
// Signature of everything a snapshot actually carries (buffers excluded — they are the
// same object references). Two snapshots with the same signature restore to an identical
// project, so undo() can use it to spot an entry that changes nothing. Comparing the
// snapshots themselves (not live DAW state) keeps it exact: state getSnapshot doesn't
// track — playhead, loop range, repeat — can't cause a false alarm either way.
function snapshotSig(snap) {
  if (!snap) return "";
  return JSON.stringify({
    duration: snap.duration,
    master: snap.master,
    eqBands: snap.eqBands,
    tempo: snap.tempo,
    tracks: (snap.tracks || []).map((t) => ({ id: t.id, params: t.params, clips: t.clips, takes: t.takes, activeTakeId: t.activeTakeId, comp: t.comp })),
  });
}
const TOOL_TIPS  = { select: "Select / Seek (S)", scissors: "Split clip (C)", join: "Merge clips (J)" };
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
              // Theme accent, not a literal: every theme redefines --amber (blue, green,
              // cyan…), so a hardcoded rgba(232,176,75) kept the default theme's amber while
              // the rest of the UI changed colour (v1.40.4).
              background: DAW.repeatPlayEnabled ? "color-mix(in srgb, var(--amber) 15%, transparent)" : "rgba(255,255,255,.04)",
              borderLeft: "1px dashed " + (DAW.repeatPlayEnabled ? "color-mix(in srgb, var(--amber) 50%, transparent)" : "rgba(255,255,255,.2)"),
              borderRight: "1px dashed " + (DAW.repeatPlayEnabled ? "color-mix(in srgb, var(--amber) 50%, transparent)" : "rgba(255,255,255,.2)"),
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
  const [flattenConfirm, setFlattenConfirm] = useState(null);
  const [laneH, setLaneH] = useState(96);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(null);
  // Set when a project load (boot restore / File>Open / drop) can't find one or more source
  // files. Shown as a themed modal (MissingAudioDialog) instead of a bare console warning.
  const [missingAudio, setMissingAudio] = useState(null);
  const [appNotice, setAppNotice] = useState(null);
  const showAppNotice = useCallback((title, message, tone = "info") => {
    setAppNotice({ title, message, tone });
  }, []);
  const [tool, setTool] = useState("select");
  // v1.22.0: the clip selection is a SET within one track — { trackId, clipIds: [...] }.
  // Multi-select is single-track by design: clip join/merge and the rigid group move are
  // both within-track operations, and keeping it local lets the drag ghost render inside
  // the owning TrackRow. Clicking a clip on another track starts a fresh selection there.
  // `selectedClip` below stays the single-clip anchor (last clicked) so every existing
  // one-clip op (copy / duplicate / trim / split / join / paste target) is untouched.
  const [clipSel, setClipSel] = useState(null); // { trackId, clipIds: string[] }
  const selectedClip = useMemo(
    () => (clipSel && clipSel.clipIds.length
      ? { trackId: clipSel.trackId, clipId: clipSel.clipIds[clipSel.clipIds.length - 1] }
      : null),
    [clipSel]);
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
  // Phase 6 Stage 1 — the record flow's ONE source of truth. Holds the busy phase
  // ("countIn" | "recording" | "stopping" | "finalizing") or null when the flow is not
  // running; recordPhase() below derives idle/armed from ARM for the full 7-state view.
  const recordPhaseRef = useRef(null);
  const recordSessionRef = useRef(null); // { trackId, start, end, loopEnabled, countIn }
  const autoStopRef = useRef(null);      // auto-stop-at-song-end monitor interval id
  const songEndRef = useRef(0);          // end (sec) of longest existing track, captured at record start
  const prevLoopRef = useRef(null);      // Loop (whole-song) flag saved at record start (restored on stop)
  const prevRepeatRef = useRef(null);    // Repeat-play (region) flag saved when a PUNCH began (restored on stop)
  const transportRef = useRef({});       // latest rule-honoring transport action fns (toolbar/keyboard/mixer)
  const [recordCount, setRecordCount] = useState(null); // 3→2→1 count-in overlay number (null = hidden)
  const [prerollLeft, setPrerollLeft] = useState(null); // seconds until punch-in (null = not pre-rolling)
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

  // Returns a token to hand to cancelUndo() if the operation turns out to be a no-op.
  const pushUndo = useCallback(() => {
    const savedRedo = redoStack.current;
    undoStack.current.push(DAW.getSnapshot());
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
    if (onUndoStateChange) onUndoStateChange({ canUndo: true, canRedo: false });
    return savedRedo;
  }, [onUndoStateChange]);
  // Undo an optimistic pushUndo() for an edit that ended up changing nothing (e.g. a clip
  // nudged while already butted against its neighbour). Popping the snapshot is NOT enough:
  // pushUndo also CLEARED the redo stack, so without restoring it a blocked move silently
  // kills Redo — the stack has to come back exactly as it was.
  const cancelUndo = useCallback((savedRedo) => {
    undoStack.current.pop();
    if (savedRedo) redoStack.current = savedRedo;
    if (onUndoStateChange) onUndoStateChange({
      canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0 });
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
      showAppNotice("Merge Tracks failed", err && err.message ? err.message : String(err || "Unknown error."), "error");
    } finally {
      setMergeTracksBusy(false);
    }
  }, [selectedFileTracks, mergeTracksBusy, mergeTracksOptions, mergeTracksName, getDefaultMergeTracksName, projectPath, pushUndo, showAppNotice]);

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
    const current = DAW.getSnapshot();
    const restore = undoStack.current.pop();
    redoStack.current.push(current);
    // An entry that restores what we already have means some handler snapshotted AFTER its
    // edit, or snapshotted for state getSnapshot doesn't carry (loop range, playhead). Such
    // an entry silently eats a Ctrl+Z and clears Redo — always a bug. This guard caught the
    // OUTPUT FX lane pushing a snapshot on a plain playbar click (v1.23.2).
    if (snapshotSig(current) === snapshotSig(restore)) {
      console.warn("[undo] no-op entry — a snapshot was pushed for something that changed nothing");
    }
    DAW.applySnapshot(restore);
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
            // Same as the main window's ARM: surface the failure and drop ARM instead of
            // arming a track whose input is not there.
            if (DAW.setAudioInput) DAW.setAudioInput(input).catch((e) => reportInputFailure(msg.id, e));
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

  // Save As collect (Phase 7): copy app-generated audio (recordings/bounces/consolidations)
  // into "<Project> Audio/" and repoint each source at its new location, stored RELATIVE to
  // the .focus so the project is self-contained and portable. Imported file-track stems are
  // NOT collected (user decision 2026-07-21) — they keep their absolute reference. Files
  // already inside the project folder are just re-pathed relative (no copy). Best-effort:
  // a failed copy leaves that source on its old path (the edit/save still stands).
  const collectProjectAudioForSave = useCallback(async (targetPath) => {
    if (!window.electronAPI || !window.electronAPI.collectProjectAudio || !targetPath) return;
    const items = [];
    const back = new Map();
    for (const t of DAW.tracks) {
      const trackCat = t.kind === "bounce" ? "Bounces" : t.kind === "audioIn" ? "Recordings" : null;
      for (const s of (t.sources || [])) {
        if (!s.filePath) continue;
        const consolidated = /consolidated/i.test(s.filePath) || /\(Consolidated\)/i.test(s.fileName || "");
        const cat = consolidated ? "Consolidated" : trackCat;
        if (!cat) continue; // imported file-track stem → not collected
        const key = t.id + "::" + s.id;
        items.push({ key, filePath: resolveSourcePath(s.filePath, projectPath), category: cat });
        back.set(key, { trackId: t.id, sourceId: s.id, fileName: s.fileName });
      }
    }
    if (!items.length) return;
    const res = await window.electronAPI.collectProjectAudio(targetPath, items);
    for (const r of (res && res.items) || []) {
      if (!r || r.error || !r.relPath) continue;
      const b = back.get(r.key); if (!b) continue;
      DAW.setSourcePath(b.trackId, b.sourceId, r.relPath, b.fileName);
    }
  }, [projectPath]);

  const saveProject = useCallback(async (forceDialog = false) => {
    const currentName = (projectNameRef && projectNameRef.current) || projectName || DEFAULT_PROJECT_NAME;
    let savedPath = projectPath || null;
    let savedName = currentName;
    if (window.electronAPI) {
      // Resolve the target path FIRST (Save As / first save open a dialog) so the audio can be
      // collected into the project folder and the sources re-pathed BEFORE the .focus is
      // written — otherwise the JSON would carry stale temp/absolute source paths.
      let targetPath = (!forceDialog && projectPath) ? projectPath : null;
      if (!targetPath && window.electronAPI.chooseProjectPath) {
        const chosen = await window.electronAPI.chooseProjectPath(currentName);
        if (!chosen || chosen.canceled || !chosen.path) return;
        targetPath = chosen.path;
      }
      if (targetPath) {
        try { await collectProjectAudioForSave(targetPath); }
        catch (err) { console.warn("[save] audio collect failed — sources keep old paths", err); }
      }
      // Export AFTER collecting so the JSON carries the new relative source paths.
      const json = DAW.exportProject(currentName);
      const result = await window.electronAPI.saveProject(json, currentName, targetPath);
      if (!result || result.saved === false) return;
      if (result.path) savedPath = result.path;
      // The project name follows the file name: a Save As to "untitled123.focus"
      // renames the project to "untitled123". Without this the Recent Saved list
      // and the title kept showing the pre-dialog name. The file itself is
      // stamped with the same name by the main process before writing.
      // ⚠️ ORDER MATTERS: renameProject() resets projectPath to null (a rename normally
      // means "now an unsaved project"), so it MUST run BEFORE we publish the saved path —
      // otherwise it clobbers projectPath, the 1.5s autosave then persists projectPath=null,
      // and on reboot the collected (relative) source paths can't be resolved
      // ("Invalid audio file path" → NO AUDIO). loadProjectJson already orders it this way.
      if (result.path) {
        savedName = projectNameFromPath(result.path);
        if (savedName !== currentName && onRenameProject) onRenameProject(savedName);
      }
      if (result.path && onProjectPathChange) onProjectPathChange(result.path);
    } else {
      const json = DAW.exportProject(currentName);
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = safeFileBase(currentName) + ".focus";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    saveRecentProject(savedName, savedPath, { updateSavedList: !!savedPath });
  }, [projectName, projectNameRef, projectPath, onProjectPathChange, onRenameProject, collectProjectAudioForSave]);

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

  // Phase 7 — write any freshly consolidated source to disk. A consolidated source is
  // rendered in memory, and importProject can only reload sources that carry a filePath,
  // so without this the clip falls back to the primary audio on reopen (the v1.21.7 known
  // bug). Best-effort and fire-and-forget: on failure the source stays memory-only, i.e.
  // the old behaviour, and the edit itself still stands.
  // audioBufferToWav lives in ui-dialogs.jsx — same global renderer scope (see 앱개발.md
  // "렌더러는 번들이 아니라 전역 스코프 공유").
  const persistConsolidated = useCallback(() => {
    if (!window.electronAPI || !window.electronAPI.saveConsolidatedAudio) return;
    if (!DAW.persistConsolidatedSources) return;
    const anchorPath = projectPath || (DAW.tracks
      .map((t) => t.filePath || (t.sources && t.sources[0] && t.sources[0].filePath) || null)
      .find(Boolean) || null);
    DAW.persistConsolidatedSources(async (buffer, suggestedName) => {
      const wavBuffer = await audioBufferToWav(buffer).arrayBuffer();
      return window.electronAPI.saveConsolidatedAudio(
        wavBuffer, projectPath || null, suggestedName, projectPath ? null : anchorPath);
    }).then((res) => {
      if (res && res.failed) console.warn("[consolidate] some sources stayed memory-only", res);
    }).catch((err) => console.warn("[consolidate] persist failed", err));
  }, [projectPath]);

  const handleSplit = useCallback((trackId, clipId, atSec) => {
    pushUndo(); DAW.splitClip(trackId, clipId, atSec); force((n) => n + 1);
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
  // additive (Ctrl/Cmd+click) toggles one clip in/out of the selection. A plain click
  // replaces it. Selecting on a different track always starts over (single-track rule).
  const handleSelectClip = useCallback((trackId, clipId, additive = false) => {
    lastClipTrackRef.current = trackId;
    setClipSel((prev) => {
      if (!additive || !prev || prev.trackId !== trackId) return { trackId, clipIds: [clipId] };
      const has = prev.clipIds.includes(clipId);
      // Re-adding an existing clip moves it to the end = it becomes the anchor.
      const clipIds = has ? prev.clipIds.filter((id) => id !== clipId) : [...prev.clipIds, clipId];
      return clipIds.length ? { trackId, clipIds } : null;
    });
  }, []);
  // Deselect = drop the clip selection AND release the scissors/join (C/J) tool.
  // Shared by the Esc key and the clip context menu's "Deselect" row so both behave
  // identically (fixes C/J staying stuck active after use).
  const handleDeselect = useCallback(() => { setClipSel(null); setTool("select"); }, []);
  // A clip edit can change the song length. Lock the timeline to the user's current
  // zoom (leave fit-to-view mode) so growing the song just widens the lane with
  // horizontal scroll, instead of re-fitting and shrinking every waveform.
  const lockTimelineZoom = useCallback(() => { fitTimelineRef.current = false; }, []);
  const handleMoveClip = useCallback((trackId, clipId, newStart) => {
    lockTimelineZoom(); pushUndo(); DAW.moveClip(trackId, clipId, newStart); force((n) => n + 1);
  }, [pushUndo, lockTimelineZoom]);
  // v1.22.0 — commit a rigid group drag (one undo for the whole group).
  const handleMoveClips = useCallback((trackId, clipIds, deltaSec) => {
    lockTimelineZoom();
    const savedRedo = pushUndo();
    // Drag commit → jump-capable (matches the drag ghost). Nudge commits via moveClipsBy.
    if (DAW.moveClipsByResolved(trackId, clipIds, deltaSec) === 0) cancelUndo(savedRedo); // fully blocked
    force((n) => n + 1);
  }, [pushUndo, cancelUndo, lockTimelineZoom]);
  const handleTrimStart = useCallback((trackId, clipId, newStart) => {
    lockTimelineZoom(); pushUndo(); DAW.trimClipStart(trackId, clipId, newStart); force((n) => n + 1);
  }, [pushUndo, lockTimelineZoom]);
  const handleTrimEnd = useCallback((trackId, clipId, newEnd) => {
    lockTimelineZoom(); pushUndo(); DAW.trimClipEnd(trackId, clipId, newEnd); force((n) => n + 1);
  }, [pushUndo, lockTimelineZoom]);
  // Deletes the WHOLE selection when the clicked/selected clip is part of it (one undo),
  // so Del on a multi-selection doesn't strand the other clips.
  const handleDeleteClip = useCallback((trackId, clipId) => {
    lockTimelineZoom(); pushUndo();
    const sel = clipSelRef.current;
    const group = sel && sel.trackId === trackId && sel.clipIds.includes(clipId) && sel.clipIds.length > 1
      ? sel.clipIds : null;
    if (group) DAW.deleteClips(trackId, group); else DAW.deleteClip(trackId, clipId);
    setClipSel(null); force((n) => n + 1);
  }, [pushUndo, lockTimelineZoom]);
  const handleDuplicateClip = useCallback((trackId, clipId) => {
    lockTimelineZoom(); pushUndo(); const id = DAW.duplicateClip(trackId, clipId);
    if (id) setClipSel({ trackId, clipIds: [id] }); force((n) => n + 1);
  }, [pushUndo, lockTimelineZoom]);
  const handleCopyClip = useCallback((trackId, clipId) => { DAW.copyClip(trackId, clipId); }, []);
  // Keyed by canConsolidateClips()'s reason code. Each says what to do next, not just what
  // went wrong — "same Take lane" alone left the user guessing which clip was the problem.
  const CONSOLIDATE_REFUSAL = {
    few: "Select 2 or more clips (Ctrl+click) to merge them.",
    lane: "These clips belong to different lanes.\n\nOne of them is shared audio (outside the punch/repeat region, heard under every take) and the other belongs to a single take. Merging them would either double that take under all the others, or make the shared audio disappear when you switch takes.\n\nSelect clips from the same take, or from the shared audio only.",
    between: "Another clip sits between the selected ones.\n\nThe merged clip would cover its position and push it out of place. Ctrl+click that middle clip to include it in the merge, or merge the neighbouring clips separately.",
    track: "Track not found.",
  };
  const FLATTEN_REFUSAL = {
    noTakes: "This track has no takes to commit — there is nothing to flatten.",
    empty: "This track has no audio to flatten.",
    raw: "The take audio is not fully loaded yet. Try again once every take shows a waveform.",
    track: "Track not found.",
  };
  // Phase 7 — Consolidate Clips: flatten the selected clips (+ the silence between them)
  // into one clip backed by a newly rendered WAV. Menu enables it only for 2+ clips.
  const handleConsolidateClips = useCallback((trackId, clipIds) => {
    const ids = Array.isArray(clipIds) ? clipIds : [];
    if (ids.length < 2) return;
    // Check first so the refusal can say WHICH rule was hit — and so no undo snapshot is
    // taken for an edit that will not happen.
    const check = DAW.canConsolidateClips ? DAW.canConsolidateClips(trackId, ids) : { ok: true };
    if (!check.ok) {
      showAppNotice("Merge Clips", CONSOLIDATE_REFUSAL[check.reason] || "Consolidate is not possible for this selection.", "warning");
      return;
    }
    lockTimelineZoom();
    const savedRedo = pushUndo();
    const id = DAW.consolidateClips(trackId, ids);
    if (!id) {
      cancelUndo(savedRedo);   // nothing changed → drop the empty snapshot, keep Redo alive
      showAppNotice("Merge Clips failed", "The clips' source audio is not loaded yet. Try again once the waveform is visible.", "error");
      return;
    }
    setClipSel({ trackId, clipIds: [id] });
    force((n) => n + 1);
    persistConsolidated();
  }, [pushUndo, cancelUndo, lockTimelineZoom, persistConsolidated, showAppNotice]);
  const commitFlattenComp = useCallback((trackId) => {
    lockTimelineZoom();
    const savedRedo = pushUndo();
    const ids = DAW.flattenComp(trackId);
    if (!ids) {
      cancelUndo(savedRedo);
      showAppNotice("Flatten Comp failed", "The take audio is not fully loaded yet. Try again once every take shows a waveform.", "error");
      return;
    }
    setClipSel(null);
    force((n) => n + 1);
    persistConsolidated();
  }, [pushUndo, cancelUndo, lockTimelineZoom, persistConsolidated, showAppNotice]);

  // Phase 7 Stage 4 — Comp Flatten. Confirms first: this is the one edit that discards the
  // alternate takes, so the dialog states exactly what survives (Undo, and the WAVs on disk)
  // rather than a bare "are you sure".
  const handleFlattenComp = useCallback((trackId) => {
    const check = DAW.canFlattenComp ? DAW.canFlattenComp(trackId) : { ok: false, reason: "track" };
    if (!check.ok) {
      showAppNotice("Flatten Comp", FLATTEN_REFUSAL[check.reason] || "Flatten is not possible for this track.", "warning");
      return;
    }
    setFlattenConfirm({ trackId, dropped: Math.max(0, check.takeCount - 1) });
  }, [showAppNotice]);

  // Merge TOOL (J: click a clip to merge it with its neighbour). Same handler as the menu,
  // so the refusal messages, undo hygiene and WAV persistence are identical on both routes.
  // It used to pushUndo() before calling the engine, which left a no-op undo entry whenever
  // the merge was refused — that entry eats the next Ctrl+Z (see "Undo 스냅샷 정합성" note).
  const handleJoin = useCallback((trackId, clipIdA, clipIdB) => {
    handleConsolidateClips(trackId, [clipIdA, clipIdB]);
  }, [handleConsolidateClips]);
  // Phase 6 Stage 4 — Take Lanes. Switching the active Take or deleting one re-bakes the
  // track (only the active lane plays), so both are undoable engine edits.
  const handleSetActiveTake = useCallback((trackId, takeId) => {
    const savedRedo = pushUndo();
    if (!DAW.setActiveTake(trackId, takeId)) cancelUndo(savedRedo); else force((n) => n + 1);
  }, [pushUndo, cancelUndo]);
  const handleDeleteTake = useCallback((trackId, takeId) => {
    const savedRedo = pushUndo();
    if (!DAW.deleteTake(trackId, takeId)) cancelUndo(savedRedo); else force((n) => n + 1);
  }, [pushUndo, cancelUndo]);
  // Phase 7 Comp Lane — swipe a region on a take lane to comp it in, or Clear to drop the comp.
  // Both re-bake the track (like setActiveTake), so both are undoable engine edits.
  const handleSetCompRegion = useCallback((trackId, start, end, takeId) => {
    const savedRedo = pushUndo();
    if (!DAW.setCompRegion(trackId, start, end, takeId)) cancelUndo(savedRedo); else force((n) => n + 1);
  }, [pushUndo, cancelUndo]);
  const handleClearComp = useCallback((trackId) => {
    const savedRedo = pushUndo();
    if (!DAW.clearComp(trackId)) cancelUndo(savedRedo); else force((n) => n + 1);
  }, [pushUndo, cancelUndo]);
  const handlePasteClip = useCallback((trackId, atStart) => {
    lockTimelineZoom(); pushUndo(); const id = DAW.pasteClip(trackId, atStart);
    lastClipTrackRef.current = trackId;
    if (id) setClipSel({ trackId, clipIds: [id] }); force((n) => n + 1);
  }, [pushUndo, lockTimelineZoom]);
  // Arrow-key precise nudge (1 / 10 / 100 ms). Holding the key fires ~30 repeats/sec and
  // every engine move re-bakes the whole track buffer + recomputes peaks, so committing
  // per repeat froze the UI for the whole hold and then jumped at once on release.
  // Instead a nudge burst only moves a visual GHOST (exactly like a drag does) and
  // commits ONE engine move + ONE undo on key-up.
  const [nudgeGhost, setNudgeGhost] = useState(null); // { trackId, clipIds, rawDelta, delta }
  const nudgeGhostRef = useRef(null);
  const nudgeTimerRef = useRef(0);
  const nudgeSelectedClip = useCallback((stepSec) => {
    const sel = clipSelRef.current; if (!sel || !sel.clipIds.length) return;
    const track = DAW.tracks.find((t) => t.id === sel.trackId); if (!track) return;
    const prev = nudgeGhostRef.current;
    // Accumulate against the clips' UNCHANGED positions, then clamp the total — so the
    // ghost butts against a neighbour exactly where the commit will land.
    const rawDelta = ((prev && prev.trackId === sel.trackId) ? prev.rawDelta : 0) + stepSec;
    const delta = DAW._clampGroupDelta ? DAW._clampGroupDelta(track, sel.clipIds, rawDelta) : rawDelta;
    const g = { trackId: sel.trackId, clipIds: sel.clipIds, rawDelta, delta };
    nudgeGhostRef.current = g; setNudgeGhost(g);
    // Safety net: commit even if the key-up is missed (focus loss, alt-tab mid-hold).
    clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = setTimeout(() => commitNudgeRef.current && commitNudgeRef.current(), 700);
  }, []);
  // Separate taps still coalesce into ONE undo within 700ms (the v1.21.4 rule) — the
  // deferred commit only changes WHEN the engine move runs, not the undo granularity.
  const nudgeCommitTsRef = useRef(0);
  const commitNudge = useCallback(() => {
    clearTimeout(nudgeTimerRef.current);
    const g = nudgeGhostRef.current; if (!g) return;
    nudgeGhostRef.current = null; setNudgeGhost(null);
    if (Math.abs(g.delta) < 1e-6) return; // fully blocked → nothing to commit, no undo entry
    const now = Date.now();
    const fresh = now - nudgeCommitTsRef.current > 700;
    let savedRedo = null;
    if (fresh) { lockTimelineZoom(); savedRedo = pushUndo(); }
    if (DAW.moveClipsBy(g.trackId, g.clipIds, g.delta) === 0) {
      if (fresh) cancelUndo(savedRedo);  // no move → drop the empty snapshot, keep Redo alive
      return;
    }
    nudgeCommitTsRef.current = now;
    force((n) => n + 1);
  }, [pushUndo, cancelUndo, lockTimelineZoom]);
  const commitNudgeRef = useRef(null);
  commitNudgeRef.current = commitNudge;
  useEffect(() => {
    const onUp = (e) => { if (e.code === "ArrowLeft" || e.code === "ArrowRight") commitNudge(); };
    window.addEventListener("keyup", onUp, true);
    return () => window.removeEventListener("keyup", onUp, true);
  }, [commitNudge]);

  // `pathForOpen` is passed explicitly by loadProjectJson because the projectPath PROP has
  // not re-rendered yet at that point — a collected source stores a path relative to the
  // .focus, so resolving it needs the project path being opened, not the previous one.
  //
  // Re-entrancy: a reconnect is async and slow (reads WAVs one by one). If a second one
  // starts while the first is mid-flight — the classic case is the boot auto-restore
  // reconnect still running when the user does File > Open — the stale loop holds track refs
  // that importProject has already replaced, and its DAW.addFileBuffer calls would race the
  // new loop. Each run takes a ticket; after every await it bails if a newer run superseded
  // it, so only the latest reconnect touches the tracks.
  const reconnectSeqRef = useRef(0);
  const reconnectProjectAudio = useCallback(async (pathForOpen) => {
    if (!window.electronAPI) return;
    const seq = ++reconnectSeqRef.current;
    const superseded = () => reconnectSeqRef.current !== seq;
    const base = pathForOpen || projectPath || null;
    setMissingAudio(null); // clear any modal from a previous load before this one reports
    const missing = DAW.tracks.filter((t) => t.needsAudio && t.filePath);
    if (!missing.length) return;
    // Sources we couldn't read, surfaced to the user in a themed modal when the run finishes.
    const failures = [];
    setLoading({ active: true, total: missing.length, done: 0, label: "Reconnecting audio..." });
    for (let i = 0; i < missing.length; i++) {
      if (superseded()) return;
      const track = missing[i];
      setLoading({ active: true, total: missing.length, done: i, label: basenameFromPath(track.filePath) || track.name });
      try {
        const abs = resolveSourcePath(track.filePath, base);
        const ab = await window.electronAPI.readAudioFile(abs);
        if (superseded()) return;
        // Pass the RESOLVED absolute path too: the native engine loads file tracks by path
        // and its cwd is the app root, so it can't open the relative `filePath` a collected
        // project stores. addFileBuffer stamps it on the track for the bridge to use.
        await DAW.addFileBuffer(track.fileName || track.name, ab, { filePath: track.filePath, absPath: abs, reconnectTrackId: track.id });
      } catch (err) {
        console.warn("Failed to reconnect audio:", track.filePath, err);
        failures.push({ name: track.name || track.fileName || basenameFromPath(track.filePath), filePath: track.filePath });
      }
    }
    // Phase 6 Stage 3: an Audio In track can hold several Takes, each a separate source
    // WAV. addFileBuffer above only reconnects the PRIMARY (sources[0]); reload every
    // additional Take's audio too, or the active lane (if it's a non-primary Take) bakes
    // to silence on reopen.
    for (const track of DAW.tracks) {
      const extras = (track.sources || []).slice(1).filter((s) => s.needsAudio && s.filePath);
      for (const src of extras) {
        if (superseded()) return;
        try {
          const abs = resolveSourcePath(src.filePath, base);
          const ab = await window.electronAPI.readAudioFile(abs);
          if (superseded()) return;
          await DAW.hydrateSource(track.id, src.id, ab, { filePath: src.filePath });
        } catch (err) {
          console.warn("Failed to reconnect take audio:", src.filePath, err);
          failures.push({ name: (track.name || basenameFromPath(src.filePath)), filePath: src.filePath });
        }
      }
    }
    if (superseded()) return;
    setLoading({ active: true, total: missing.length, done: missing.length, label: "Finalizing..." });
    setTimeout(() => setLoading(null), 220);
    // One modal for the whole load, listing every source that couldn't be found.
    if (failures.length) setMissingAudio({ items: failures });
  }, [projectPath]);

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
    await reconnectProjectAudio(nextPath);
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
        const back = (e.code === "Comma" || e.code === "ArrowLeft");
        // Snap the nudge onto the whole-second grid so a fractional mouse-seek
        // position (e.g. 10.66s) does not ride along forever as 01:66, 02:66…
        // (the original code did cur±1, preserving the sub-second offset). A tiny
        // epsilon keeps a value already sitting exactly on the grid from being a
        // no-op / double-step. seek() clamps the <0 result to 0.
        const cur = DAW.getPlayhead();
        const EPS = 1e-6;
        const next = back ? Math.ceil(cur - EPS) - 1 : Math.floor(cur + EPS) + 1;
        DAW.seek(next);
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
  const clipSelRef = useRef(null);      // v1.22.0 — the full selection set
  clipSelRef.current = clipSel;
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
      if (!clipSelRef.current) return;
      if (e.target.closest && (e.target.closest("[data-clip-hit]") || e.target.closest("[data-clip-menu]"))) return;
      setClipSel(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  // Boot audio reconnect. Runs ONCE when startup is ready. The base path is read straight
  // from the restored autosave snapshot rather than the projectPath STATE: collected sources
  // store paths relative to the .focus, and the state may not have propagated into this
  // reconnect's closure yet at boot — a null base leaves every relative path unresolvable and
  // the tracks stuck on "NO AUDIO". The ref guard keeps a dep change from starting a second
  // reconnect (which the seq guard would then abort mid-load).
  const bootReconnectedRef = useRef(false);
  useEffect(() => {
    if (!startupReady || bootReconnectedRef.current) return;
    bootReconnectedRef.current = true;
    const snapPath = (readRecentProjectSnapshot() || {}).projectPath || null;
    reconnectProjectAudio(snapPath).then(() => {
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
      showAppNotice("Recording unavailable", "Audio recording requires the desktop app and native audio engine.", "warning");
      return;
    }
    if (track.recording) {
      const active = recordingRef.current;
      if (!active || active.trackId !== track.id) return;
      if (!enterRecordPhase("stopping")) return; // a stop is already in flight
      DAW.stopRecording(active.partPath);
      try {
        await active.promise;
        enterRecordPhase("finalizing");
        const saved = await window.electronAPI.finalizeRecording(active.partPath, active.finalPath);
        const bytes = await window.electronAPI.readAudioFile(saved.path);
        // Phase 6 Stage 5 — input-latency compensation. A POSITIVE offset means the take
        // was captured that many seconds LATE, so slide its placement EARLIER; a NEGATIVE
        // offset (manual fine-tune, v1.33.1) slides it LATER. min(offset, start) is the
        // headroom clamp: for positive offsets it caps the pull so the window never crosses
        // 0 and truncates the clip's head (a recording starting within `offset` of 0 can't
        // be fully compensated); for negative offsets min() passes through unchanged (moving
        // right never hits 0). Applied value = the single number the Device Setup panel keeps.
        const recOffsetMs = Number(localStorage.getItem("focusdaw-record-offset-ms")) || 0;
        const recOffsetSec = recOffsetMs / 1000;
        // Stamp the record-time offset onto the take so "Recording Offset Cal." (v1.34.2) can
        // re-base off THIS take's offset, not the current global one (audio-engine recordedOffsetMs).
        const attachOptions = { filePath: saved.path, start: active.start, recordedOffsetMs: recOffsetMs };
        if (active.durationLimit > 0) attachOptions.end = active.durationLimit;
        {
          const shift = Math.min(recOffsetSec, attachOptions.start);
          attachOptions.start -= shift;
          if (attachOptions.end != null) attachOptions.end -= shift;
        }
        // Snapshot the PRE-take state so Undo removes exactly this recording (and only it).
        // attachRecording appends a Take; without this, the recording was not undoable, so
        // the next Ctrl+Z reverted the last edit BEFORE the take (e.g. a clip move) instead
        // — restoring an earlier layout and confusingly dropping the take. Pushed right
        // before the append (after finalize/read succeed) so a failed take leaves no entry.
        pushUndo();
        if (active.punch) {
          // Stage 6: replace ONLY the punch span in the active take with the new recording,
          // instead of stacking a Take. attachOptions.start/end already carry the (offset-
          // shifted) in/out points, so the engine empties that span and splices the clip in.
          await DAW.attachPunchRecording(track.id, saved.fileName, bytes, attachOptions);
        } else if (active.loopPunch) {
          // Phase 7 Stage 1: like loopTake, cut the continuous recording into one Take per
          // iteration — but empty the region on the base and keep it (Loop-Punch Comp). Same
          // offset-shifted loop window (preserves pass length = loopEnd - loopStart).
          const loopShift = Math.min(recOffsetSec, active.loopStart);
          await DAW.attachLoopPunchRecording(track.id, saved.fileName, bytes,
            { filePath: saved.path, loopStart: active.loopStart - loopShift, loopEnd: active.loopEnd - loopShift, recordedOffsetMs: recOffsetMs });
        } else if (active.loopTake) {
          // Stage 3b: cut the continuous loop recording into one Take per iteration.
          // Shift the whole loop window earlier by the same offset, preserving pass length
          // (loopEnd - loopStart) so every Take stays exactly one iteration long.
          const loopShift = Math.min(recOffsetSec, active.loopStart);
          await DAW.attachLoopRecording(track.id, saved.fileName, bytes,
            { filePath: saved.path, loopStart: active.loopStart - loopShift, loopEnd: active.loopEnd - loopShift, recordedOffsetMs: recOffsetMs });
        } else {
          await DAW.attachRecording(track.id, saved.fileName, bytes, attachOptions);
        }
      } catch (e) {
        showAppNotice("Recording could not be finalized", e.message || String(e), "error");
      }
      track.recording = false;
      delete track._recordingDurationLimit;
      delete track._recordLoop;
      recordingRef.current = null;
      recordSessionRef.current = null;
      enterRecordPhase(null); // → armed
      fitTimelineToProject();
      force((n) => n + 1);
      return;
    }
    if (recordingRef.current) {
      showAppNotice("Recording already active", "Only one Audio In track can record at a time.", "warning");
      return;
    }
    // Claim the flow BEFORE the awaits below (path prep + device open, both slow enough
    // to press Record again in): the phase — not `track.recording`, which is only set
    // once they resolve — is what stops a rival recorder from starting.
    if (!enterRecordPhase("recording")) return;
    let target, input;
    try {
      const sourcePath = DAW.tracks.find((t) => t.filePath)?.filePath || null;
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
      target = await window.electronAPI.prepareRecordingPath(projectPath, `${track.name} ${stamp}.wav`, sourcePath);
      input = audioInputSettingsForTrack(track);
      if (DAW.setAudioInput) await DAW.setAudioInput(input);
    } catch (e) {
      if (recordPhaseRef.current === "recording") enterRecordPhase(null); // nothing started; release
      showAppNotice("Recording could not start", e.message || String(e), "error");
      return;
    }
    // A Stop during those awaits already released the phase. Honor it — starting now
    // would leave a recorder running with the transport stopped and nobody to stop it.
    if (recordPhaseRef.current !== "recording") return;
    const session = recordSessionRef.current;
    const start = session && session.start != null ? session.start : DAW.getPlayhead();
    track.recording = true;
    track._recordingStart = start;
    // Loop-Take: tell the live-preview waveform to WRAP the growing recording back into the
    // Repeat region instead of drawing it off to the right past the loop end (Stage 3b/4 UX).
    // takeBase = how many Takes will precede this recording's passes in the final numbering, so
    // the live "Take X" badge (v1.36.1) matches what Take Lanes shows. Since v1.40.0 punch no
    // longer consumes the active take — displaced audio is parked as a take instead — so every
    // existing take survives. "Original" takes are named, not lettered, so they do not shift the
    // A/B/C counter and are excluded here (same rule as _normalizeTrackLayout).
    track._recordLoop = (session && (session.loopTake || session.loopPunch) && session.loopEnd > session.loopStart)
      ? { start: session.loopStart, end: session.loopEnd,
          takeBase: (track.takes || []).filter(t => t.kind !== "original").length }
      : null;
    track._recordingPeaks = [];
    track._recordingSampleRate = 44100;
    const durationLimit = Number(track._recordingDurationLimit) || 0;
    const promise = DAW.startRecording({
      filePath: target.partPath, channel: input.channel || 0, stereo: !!input.stereo,
      gain: Math.max(0.1, Math.min(4, track.params.inputGain == null ? 1 : track.params.inputGain)),
      monitor: !!track.params.monitor, limiter: track.params.limiter !== false,
    });
    // Carry loop-Take info through to the stop path (the session ref may be cleared by then).
    recordingRef.current = { trackId: track.id, ...target, start, durationLimit, promise,
      loopTake: !!(session && session.loopTake),
      loopPunch: !!(session && session.loopPunch),
      loopStart: session && session.loopStart || 0,
      loopEnd: session && session.loopEnd || 0,
      punch: !!(session && session.punch),
      punchStart: session && session.punchStart || 0,
      punchEnd: session && session.punchEnd || 0 };
    promise.catch((e) => {
      if (recordingRef.current && recordingRef.current.trackId === track.id) {
        track.recording = false;
        delete track._recordingDurationLimit;
        delete track._recordLoop;
        recordingRef.current = null;
        recordSessionRef.current = null;
        // The engine rejected the take AFTER we claimed the flow. Release it, or Record
        // stays dead for the rest of the session. Only from "recording": if a stop is
        // already winding down it owns the release (and awaits this same promise).
        if (recordPhaseRef.current === "recording") enterRecordPhase(null);
        showAppNotice("Recording failed", e.message || String(e), "error");
        force((n) => n + 1);
      }
    });
    force((n) => n + 1);
  }, [projectPath, fitTimelineToProject, pushUndo, showAppNotice]);

  // ---- Recording transport flow (record start/stop rules) ------------------
  // Record from a stopped transport shows a 3s count-in then starts play+record;
  // from a playing transport it records immediately. Repeat is turned off while
  // recording (restored on stop). Both play+record stop when playback reaches the
  // end of the longest existing track (no backing tracks → record until manual
  // stop). Pause and return-to-start are ignored while recording; any transport
  // press during the count-in cancels it.
  //
  // Phase 6 Stage 1 — explicit state machine:
  //   idle → armed → countIn → recording → stopping → finalizing → armed
  // `idle`/`armed` are DERIVED from ARM (a track property the user owns), so the machine
  // itself only holds the busy phases. Every transition goes through enterRecordPhase(),
  // which rejects illegal ones instead of letting two flows overlap. That is not
  // bookkeeping for its own sake — the start and stop paths both `await` (device open,
  // finalize, decode, attach), and before this the phase was inferred from
  // `track.recording`, which is only flipped AFTER those awaits. So a second Record/Stop
  // press inside the gap started a second recorder / finalized and attached the same take
  // twice. The guards close both windows.
  const RECORD_TRANSITIONS = {
    null:        ["countIn", "recording"],   // idle/armed: count-in, or record straight away
    countIn:     ["recording", null],        // count-in completed, or cancelled
    // `recording → null` is the ABORTED-START release. The phase is claimed before the
    // start's awaits, so if the start then fails (device error, engine reject) or a Stop
    // lands mid-await, there is no recorder to stop — the flow just releases. Without
    // this edge those paths are stuck in "recording" and Record dies for the session.
    recording:   ["stopping", null],
    stopping:    ["finalizing", null],       // null = the take failed; release the flow
    finalizing:  [null],
  };
  const recordPhase = () => {
    if (recordPhaseRef.current) return recordPhaseRef.current;
    return DAW.tracks.some((t) => t.kind === "audioIn" && t.params && t.params.arm) ? "armed" : "idle";
  };
  const enterRecordPhase = (next) => {
    const cur = recordPhaseRef.current;
    const allowed = RECORD_TRANSITIONS[cur === null ? "null" : cur] || [];
    if (!allowed.includes(next)) {
      console.warn(`[record] illegal transition ${cur || "idle/armed"} → ${next || "idle/armed"} (ignored)`);
      return false;
    }
    recordPhaseRef.current = next;
    // Mirror for the other renderers: the ARM lock (v1.20.11) and the record-lock badge
    // read this global. Kept as a mirror rather than a second source of truth.
    window.__recordCountdownActive = next === "countIn";
    return true;
  };
  // The input could not be opened (unplugged, held by another app, ...). Say so once and
  // clear ARM: an armed track whose device is gone shows a dead meter and no error, which
  // is exactly how a user ends up thinking the app is broken.
  const reportInputFailure = (trackId, err) => {
    console.warn("[AudioInput] arm prepare failed:", err);
    if (trackId) DAW.setTrackParam(trackId, "arm", false);
    force((n) => n + 1);
    showAppNotice("Audio input unavailable", (err && err.message) || String(err), "error");
  };
  // The engine lost the configured input device (USB pulled). Drop every ARM so no track
  // sits armed on a device that is not there. Deliberately does NOT reopen anything —
  // reopening drags the OUTPUT down with it (closeAudioDevice) and would cut playback.
  const disarmAllInputs = (deviceName) => {
    const armed = DAW.tracks.filter((t) => t.kind === "audioIn" && t.params && t.params.arm);
    if (!armed.length) return;
    armed.forEach((t) => DAW.setTrackParam(t.id, "arm", false));
    force((n) => n + 1);
    console.warn(`[AudioInput] input device lost (${deviceName || "unknown"}) — disarmed ${armed.length} track(s)`);
  };

  const isCountingIn = () => recordPhase() === "countIn";
  // "The recorder is busy" — recording OR winding down. Matches the old semantics
  // exactly: `track.recording` also stayed true through stop+finalize, so the transport
  // guards that used it kept blocking until the take was attached.
  const isRecordingActive = () => ["recording", "stopping", "finalizing"].includes(recordPhase());
  const stopAutoStopMonitor = () => { if (autoStopRef.current) { clearInterval(autoStopRef.current); autoStopRef.current = null; } };
  const startAutoStopMonitor = () => {
    stopAutoStopMonitor();
    autoStopRef.current = setInterval(() => {
      if (!isRecordingActive()) { stopAutoStopMonitor(); return; }
      const end = songEndRef.current;
      if (end > 0 && (DAW.getPlayhead() >= end - 0.03 || !DAW.isPlaying)) doStopRecording();
      // Loop-take / loop-punch record through the Repeat until manual Stop (no position limit);
      // only a dead transport (playback failed under us) forces it to end here.
      else if (recordingRef.current && (recordingRef.current.loopTake || recordingRef.current.loopPunch) && !DAW.isPlaying) doStopRecording();
    }, 120);
  };
  const beginRecorderAt = async (target) => {
    const session = recordSessionRef.current;
    songEndRef.current = session.end || 0;
    if (session.end > 0) target._recordingDurationLimit = session.end;
    else delete target._recordingDurationLimit;
    const wasPlaying = DAW.isPlaying;
    await toggleRecording(target);          // starts the recorder at session.start
    if (!isRecordingActive()) {             // start failed (device error etc.) → undo loop/repeat changes
      if (prevLoopRef.current) DAW.setLoop(true);
      prevLoopRef.current = null;
      if (prevRepeatRef.current && DAW.setRepeatPlayEnabled) DAW.setRepeatPlayEnabled(true);
      prevRepeatRef.current = null;
      recordSessionRef.current = null;
      return;
    }
    if (!wasPlaying) DAW.play();             // count-in case: begin playback from the same position
    startAutoStopMonitor();
    force((n) => n + 1);
  };
  // Phase 6 Stage 1 — the single entry point for "start recording".
  //   trackId     the Audio In track to record onto (default: the armed one)
  //   start       timeline seconds to record from, and the transport seeks there.
  //               Default null = "wherever the playhead is when the recorder actually
  //               starts" — NOT the playhead now: the start path awaits a device open,
  //               and while playing the playhead moves during it, so freezing it here
  //               would place the take early by that much.
  //   end         stop here; 0 = record until manual stop (default: end of the longest
  //               other track, which is what the auto-stop monitor has always used)
  //   loopEnabled record across Repeat iterations. Stage 3 splits a Take per iteration
  //               here; for now it is carried on the session and Repeat still goes off,
  //               so behavior is unchanged.
  //   countIn     count-in ticks before play+record (0 while already playing). Stage 2
  //               made these BEATS: with the metronome on and a project BPM, the default
  //               is one 4/4 bar (4 ticks, 60/BPM apart) with an audible native click.
  //               Off / no BPM keeps the legacy silent 3 ticks a second apart.
  const startRecordFlow = (opts = {}) => {
    const target = opts.trackId
      ? DAW.tracks.find((t) => t.id === opts.trackId)
      : DAW.tracks.find((t) => t.kind === "audioIn" && t.params && t.params.arm);
    if (!target || target.kind !== "audioIn") return;
    if (recordPhaseRef.current) return; // a flow is already running

    let songEnd = 0;
    DAW.tracks.forEach((t) => {
      if (t.id !== target.id && Array.isArray(t.clips)) t.clips.forEach((c) => { songEnd = Math.max(songEnd, c.end || 0); });
    });
    // Pre-roll wins over the count-in whenever there is actually music to roll into: the
    // song itself is a better lead-in than any click we could synthesize (see the
    // pre-roll notes above). `opts.preroll === 0` / no anchor falls back to the count-in.
    // Phase 6 Stage 6 — Punch. With Punch ON and a valid Repeat REGION, that region IS the
    // [in, out] span: the take begins at the region start (not the live playhead), auto
    // punch-outs at the region end, and REPLACES that span in the active take. Punch wins
    // over loop-Take recording (both key off the same region).
    const lr = DAW.loopRange;
    const region = !!(lr && (lr.end - lr.start) > 0.05);
    // Phase 7 Stage 1 — Loop-Punch Comp. With BOTH Punch AND Repeat ON over a region, Record
    // captures N passes across the region (loop-Take capture) but KEEPS the base outside it,
    // registering each pass as a region-scoped Take (attachLoopPunchRecording). Single Punch is
    // therefore now Punch ON while Repeat is OFF; loop-Take is Repeat ON while Punch is OFF.
    const loopPunch = !!(isPunchOn() && DAW.repeatPlayEnabled && region);
    const punch = !!(isPunchOn() && !DAW.repeatPlayEnabled && region);
    // Punch can only be armed while a Repeat region exists (the button is disabled otherwise,
    // and MenuTransport auto-clears the flag if the region is removed), so `punch`/`loopPunch`
    // above already reflect that. No region-less-punch guard is needed here.
    const punchAt = (punch || loopPunch) ? lr.start : DAW.getPlayhead();
    // Auto-stop target. songEnd is the end of the BACKING tracks (target excluded), and the
    // monitor stops the take when the playhead reaches it. But if recording BEGINS at or
    // past songEnd (playhead seeked beyond the backing material — e.g. adding an outro), the
    // monitor's very first tick already has playhead ≥ songEnd and kills the take instantly:
    // it resets the transport to 0 and leaves a broken take baked at a far-out start, which
    // then desyncs native playback. There is nothing to auto-stop against out there, so
    // record until manual Stop — exactly like a project with no backing tracks (songEnd 0).
    // punchAt is where the take begins for every path (immediate, count-in, pre-roll punch).
    // Punch fixes the auto-stop to the region end (out point); otherwise it is the backing end.
    const recordEnd = punch ? lr.end : ((songEnd > 0 && punchAt < songEnd - 0.05) ? songEnd : 0);
    const prerollLen = opts.preroll != null ? opts.preroll : prerollSeconds();
    // An active Repeat REGION jails the transport inside itself — getPlayhead() clamps to
    // [start,end] and play() yanks an outside playhead to the region start (audio-bridge).
    // A pre-roll that rolls back before the region would be dragged straight back in, so
    // it cannot work while repeat-play is on — UNLESS this is a punch, which turns repeat-play
    // OFF (below) precisely so it can roll into the in point and play through the out point.
    const useProll = prerollLen > 0 && !DAW.isPlaying && opts.countIn == null
      && (punch || !DAW.repeatPlayEnabled) && prerollAnchorOk(punchAt, songEnd, prerollLen);
    // Stage 2: one bar of clicks on the project's beat grid, or the legacy silent
    // 3×1s when the metronome is off or the project has no BPM to build a grid from.
    const click = !useProll && metronomeActive();
    const bpm = metronomeBpm();
    // Phase 6 Stage 3b — loop-Take recording. Pressing Record with the Repeat REGION active
    // records straight through the loop; on Stop the one continuous WAV is cut into a Take
    // per iteration (attachLoopRecording). The take clips sit at the loop start, the Repeat
    // stays ON so native keeps wrapping (LoopAudioSource), and there is NO position auto-stop
    // — the user stops manually. Falls back to normal single-take recording when Repeat is off.
    // Plain loop-Take is Repeat ON while Punch is OFF; Punch ON + Repeat ON is loopPunch above.
    const loopTake = !!(!isPunchOn() && DAW.repeatPlayEnabled && region);
    recordSessionRef.current = {
      trackId: target.id,
      // ⚠️ Pre-roll MUST leave this null. `start` is where the take's clip is placed, and
      // toggleRecording only reads the live playhead when it is null. Pinning it to
      // punchAt would place the clip at punchAt while the recorder actually starts a beat
      // later (poll tick + device-open await) — and unlike the count-in case the
      // transport is ROLLING through that gap, so the take would land early by however
      // long it took. Null keeps placement self-consistent with what was captured.
      // Loop-take pins start to the loop start so the take clips (and the seek) align to it.
      // Punch pins start to the region in point and end to the out point (auto punch-out).
      start: punch ? lr.start : ((loopTake || loopPunch) ? lr.start : (opts.start != null ? opts.start : null)),
      end: punch ? lr.end : ((loopTake || loopPunch) ? 0 : (opts.end != null ? opts.end : recordEnd)),
      punch,
      punchStart: punch ? lr.start : 0,
      punchEnd: punch ? lr.end : 0,
      loopTake,
      loopPunch,
      loopStart: (loopTake || loopPunch) ? lr.start : 0,
      loopEnd: (loopTake || loopPunch) ? lr.end : 0,
      loopEnabled: !!opts.loopEnabled,
      countIn: opts.countIn != null ? opts.countIn
        : (DAW.isPlaying || useProll ? 0 : (click ? COUNT_IN_BEATS : COUNT_IN_LEGACY_TICKS)),
      click,
      bpm,
      tickMs: click ? 60000 / bpm : COUNT_IN_LEGACY_MS,
      preroll: useProll ? prerollLen : 0,
      punchAt,                                 // where cancel puts the playhead back
    };
    const session = recordSessionRef.current;

    prevLoopRef.current = DAW.loopEnabled;
    if (DAW.loopEnabled) DAW.setLoop(false);
    // Punch turns repeat-play OFF for the take so the transport rolls into the in point and
    // plays THROUGH the out point (where the auto-stop punches out), instead of wrapping
    // inside the region. Saved and restored like the loop flag. Loop-Take deliberately keeps
    // repeat-play ON (it records across iterations), so only touch it for punch.
    prevRepeatRef.current = DAW.repeatPlayEnabled;
    if (session.punch && DAW.repeatPlayEnabled && DAW.setRepeatPlayEnabled) DAW.setRepeatPlayEnabled(false);

    if (useProll) {
      if (!enterRecordPhase("countIn")) return; // same phase: cancellable, ARM-locked, seek-blocked
      DAW.seek(Math.max(0, punchAt - prerollLen));
      DAW.play();
      setPrerollLeft(punchAt - DAW.getPlayhead());
      recordCountRef.current = setInterval(() => {
        // The transport is the clock here — not a timer counting down from the press.
        // Watching the playhead means a slow start or a stall cannot punch in early.
        const left = punchAt - DAW.getPlayhead();
        if (!DAW.isPlaying) { cancelCountIn(); return; } // playback died under us
        if (left <= 0) {
          clearInterval(recordCountRef.current); recordCountRef.current = null;
          setPrerollLeft(null);
          beginRecorderAt(target);             // countIn → recording, transport already rolling
        } else setPrerollLeft(left);
      }, 50);
      return;
    }

    if (session.start != null) DAW.seek(session.start);
    if (session.countIn <= 0) { beginRecorderAt(target); return; }

    let n = session.countIn;                 // count-in overlay before play+record
    if (!enterRecordPhase("countIn")) return;
    setRecordCount(n);
    // The native click owns the beat grid (it counts samples in the audio callback);
    // this timer only drives the on-screen number. Two clocks, but they are only asked
    // to agree for the length of one bar, so any drift between them stays far below
    // what an eye can catch against the clicks.
    if (session.click) DAW.startCountIn(session.bpm, session.countIn);
    recordCountRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(recordCountRef.current); recordCountRef.current = null;
        setRecordCount(null);
        beginRecorderAt(target);             // countIn → recording happens inside
      } else setRecordCount(n);
    }, session.tickMs);
  };
  const beginRecordFlow = () => startRecordFlow();
  const cancelCountIn = () => {
    if (recordPhaseRef.current !== "countIn") return;
    if (recordCountRef.current) { clearInterval(recordCountRef.current); recordCountRef.current = null; }
    // The click runs on the engine's own clock, so clearing the timer above does not
    // silence it — without this it would keep counting a bar that was cancelled.
    if (DAW.stopMetronome) DAW.stopMetronome();
    const session = recordSessionRef.current;
    enterRecordPhase(null);
    setRecordCount(null);
    setPrerollLeft(null);
    recordSessionRef.current = null;
    // A cancelled pre-roll has to undo what it did: the count-in never touched the
    // transport, but pre-roll rolled it back and started playback. Put the playhead back
    // where Record was pressed — dumping the user at 0 (plain stop) loses the spot they
    // were about to punch in at.
    if (session && session.preroll) {
      DAW.stop();
      DAW.seek(session.punchAt || 0);
    }
    if (prevLoopRef.current) DAW.setLoop(true); // nothing recorded → restore Loop
    prevLoopRef.current = null;
    if (prevRepeatRef.current && DAW.setRepeatPlayEnabled) DAW.setRepeatPlayEnabled(true); // restore punch's Repeat-play
    prevRepeatRef.current = null;
    force((n) => n + 1);
  };
  const doStopRecording = () => {
    // Only a live recording can be stopped. A press while the flow is already winding
    // down (stopping/finalizing) used to re-enter the stop path and finalize + attach
    // the same take twice; now it is a no-op.
    if (recordPhaseRef.current !== "recording") return;
    stopAutoStopMonitor();
    const target = DAW.tracks.find((t) => t.kind === "audioIn" && t.recording);
    if (target) toggleRecording(target);      // stop + finalize the recorder
    else enterRecordPhase(null);              // the start is still awaiting; release so it aborts
    DAW.stop();                               // stop playback (playhead → 0)
    if (prevLoopRef.current) DAW.setLoop(true); // restore Loop
    prevLoopRef.current = null;
    if (prevRepeatRef.current && DAW.setRepeatPlayEnabled) DAW.setRepeatPlayEnabled(true); // restore punch's Repeat-play
    prevRepeatRef.current = null;
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

  // The native engine noticed the configured input device disappear (see audio-bridge
  // "audioInputLost"). Nothing else tells the UI: an armed track just goes quiet.
  useEffect(() => {
    const onInputLost = (e) => disarmAllInputs(e && e.detail && e.detail.name);
    window.addEventListener("focusdaw-audio-input-lost", onInputLost);
    return () => window.removeEventListener("focusdaw-audio-input-lost", onInputLost);
  });

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
      // ARM has to answer "is the input actually there?" the same way Record does. It
      // used to swallow the failure into a console warning, so ARM would light up on a
      // device that was gone and the user only learned about it from a meter that never
      // moved (T-1.25.2 특이사항). Report it and drop ARM — a lit ARM button that cannot
      // hear anything is a lie.
      if (DAW.setAudioInput) DAW.setAudioInput(input).catch((e) => reportInputFailure(id, e));
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
  // Rename a track from the header (double-click the title). Track names are UI /
  // project metadata only: recorded WAV file paths remain stable and keep matching
  // through track.filePath + sources[].filePath.
  const renameTrack = async (id, newName) => {
    const track = DAW.tracks.find((t) => t.id === id);
    if (!track) return;
    const name = String(newName || "").trim();
    if (!name || name === track.name) return;
    pushUndo(); lastUndoKey.current = null;
    track.name = name;
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
      {/* Pre-roll's countdown now rides on the recording track's lane at the punch position
          (TrackRow `countIn`), which is exactly where the player is looking as the arrangement
          scrolls toward the entry — so the old top-of-screen pill is gone. */}
      {/* Count-in (no pre-roll: recording from a stopped transport) keeps the original big
          centre number. Only the PRE-ROLL countdown moved to an in-track badge (below), since
          during pre-roll the player is watching the arrangement scroll toward the punch. */}
      {recordCount != null && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "grid", placeItems: "center",
          background: "rgba(0,0,0,.45)", pointerEvents: "none" }}>
          <div key={recordCount} style={{ fontSize: "11vmin", fontWeight: 400, lineHeight: 1, color: "var(--cream)",
            fontFamily: '"Orbitron", var(--mono, monospace)', textShadow: "0 0 40px rgba(0,0,0,.85), 0 8px 30px rgba(0,0,0,.6)",
            // One pulse per tick. The .9s of the old 1s-per-tick count-in outlasts a beat
            // at any tempo over 67 BPM, which left the number frozen mid-pulse — each tick
            // remounts it (key) and restarts an animation that never got to finish.
            animation: `recordCountPulse ${Math.min(900, (recordSessionRef.current && recordSessionRef.current.tickMs ? recordSessionRef.current.tickMs : 1000) * 0.9)}ms ease-out` }}>
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
          {/* Select/Seek · Split · Merge tools hidden on screen (code kept) — re-enable: <ToolBar tool={tool} setTool={setTool} /> + a divider */}
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
                  selectedClipIds={clipSel && clipSel.trackId === t.id ? clipSel.clipIds : EMPTY_CLIP_IDS}
                  nudge={nudgeGhost && nudgeGhost.trackId === t.id ? nudgeGhost : null}
                  onSelectClip={handleSelectClip} onMoveClip={handleMoveClip} onMoveClips={handleMoveClips}
                  onTrimStart={handleTrimStart} onTrimEnd={handleTrimEnd}
                  onDeleteClip={handleDeleteClip} onCopyClip={handleCopyClip}
                  onPasteClip={handlePasteClip} onDuplicateClip={handleDuplicateClip}
                  onConsolidateClips={handleConsolidateClips}
                  onFlattenComp={handleFlattenComp}
                  onSetCompRegion={handleSetCompRegion} onClearComp={handleClearComp}
                  onDeselectClip={handleDeselect} onSetTool={setTool}
                  onSetActiveTake={handleSetActiveTake} onDeleteTake={handleDeleteTake}
                  viewScrollLeft={timelineView.scrollLeft}
                  tool={tool} onSplit={handleSplit} onJoin={handleJoin} onBeforeChange={pushUndo} />;
              })}
              {nonFileTracks.map((t) => {
                const i = DAW.tracks.findIndex((track) => track.id === t.id);
                const trackLaneH = t.kind === "audioIn" ? audioInLaneHeight : laneH;
                // PRE-ROLL only: show the countdown AS A BADGE at the punch position on the
                // recording track's own lane, so the player sees WHERE the take will begin
                // while the arrangement scrolls toward it. The plain count-in (no pre-roll)
                // keeps its original big centre number instead (see the overlay below).
                const rs = recordSessionRef.current;
                const countIn = prerollLeft != null && rs && rs.trackId === t.id ? {
                  atSec: rs.punchAt != null ? rs.punchAt : (rs.start != null ? rs.start : 0),
                  label: prerollLeft.toFixed(1) + "s",
                  kind: "preroll",
                } : null;
                return <TrackRow key={t.id} track={t} idx={i} pxPerSec={pxPerSec} ampZoom={ampZoom} laneH={trackLaneH} sizeLaneH={laneH} countIn={countIn}
                  playhead={playhead} playbackLevel={DAW.getTrackLevel(t.id)}
                  inputLevel={t.kind === "audioIn" ? DAW.getInputLevel() : 0}
                  inputGr={t.kind === "audioIn" && DAW.getInputGainReduction ? DAW.getInputGainReduction() : 0}
                  recordingActive={DAW.tracks.some((tr) => tr.kind === "audioIn" && tr.recording) || recordCount != null}
                  onParam={param(t.id)} onRemove={() => removeTrack(t.id)}
                  onSeek={guardedUserSeek}
                  onFocusFx={focusMixerFx}
                  onRename={renameTrack}
                  selectedClipId={selectedClip && selectedClip.trackId === t.id ? selectedClip.clipId : null}
                  selectedClipIds={clipSel && clipSel.trackId === t.id ? clipSel.clipIds : EMPTY_CLIP_IDS}
                  nudge={nudgeGhost && nudgeGhost.trackId === t.id ? nudgeGhost : null}
                  onSelectClip={handleSelectClip} onMoveClip={handleMoveClip} onMoveClips={handleMoveClips}
                  onTrimStart={handleTrimStart} onTrimEnd={handleTrimEnd}
                  onDeleteClip={handleDeleteClip} onCopyClip={handleCopyClip}
                  onPasteClip={handlePasteClip} onDuplicateClip={handleDuplicateClip}
                  onConsolidateClips={handleConsolidateClips}
                  onFlattenComp={handleFlattenComp}
                  onSetCompRegion={handleSetCompRegion} onClearComp={handleClearComp}
                  onDeselectClip={handleDeselect} onSetTool={setTool}
                  onSetActiveTake={handleSetActiveTake} onDeleteTake={handleDeleteTake}
                  viewScrollLeft={timelineView.scrollLeft}
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
                    background: DAW.repeatPlayEnabled
                      ? "color-mix(in srgb, var(--amber) 16%, transparent)"
                      : "color-mix(in srgb, var(--amber) 5%, transparent)",
                    borderLeft: "1px dashed " + (DAW.repeatPlayEnabled ? "color-mix(in srgb, var(--amber) 75%, transparent)" : "rgba(255,255,255,.35)"),
                    borderRight: "1px dashed " + (DAW.repeatPlayEnabled ? "color-mix(in srgb, var(--amber) 75%, transparent)" : "rgba(255,255,255,.35)"),
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
      {flattenConfirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(8,6,4,.6)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center" }}
          onMouseDown={() => setFlattenConfirm(null)}>
          <div onMouseDown={(e) => e.stopPropagation()}
            style={{ width: 480, maxWidth: "90vw", background: "var(--bg)", border: "1px solid var(--line-strong)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
              <Icon name="check" size={18} style={{ color: "var(--amber)" }} />
              <span style={{ fontWeight: 600, fontSize: 15 }}>Flatten Comp</span>
            </div>
            <div style={{ padding: "18px 20px", fontSize: 13, lineHeight: 1.55, color: "var(--cream-2)" }}>
              <div style={{ marginBottom: 10 }}>
                The active take and the shared audio become ordinary clips
                {flattenConfirm.dropped
                  ? `, and ${flattenConfirm.dropped} other take${flattenConfirm.dropped === 1 ? "" : "s"} ${flattenConfirm.dropped === 1 ? "is" : "are"} dropped.`
                  : "."}
              </div>
              <div>
                Undo restores the takes, and the recorded WAV files stay on disk either way.
              </div>
            </div>
            <div style={{ padding: "0 20px 18px", display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="btn" onClick={() => setFlattenConfirm(null)}
                style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line-strong)", background: "var(--surface2)", color: "var(--cream-2)", fontSize: 12.5, fontWeight: 600 }}>
                Cancel
              </button>
              <button className="btn" onClick={() => { const target = flattenConfirm.trackId; setFlattenConfirm(null); commitFlattenComp(target); }}
                style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--amber)", background: "var(--amber)", color: "var(--accent-fg)", fontSize: 12.5, fontWeight: 700 }}>
                Flatten
              </button>
            </div>
          </div>
        </div>
      )}
      {appNotice && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(8,6,4,.6)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center" }}
          onMouseDown={() => setAppNotice(null)}>
          <div onMouseDown={(e) => e.stopPropagation()}
            style={{ width: 460, maxWidth: "90vw", background: "var(--bg)", border: "1px solid var(--line-strong)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
              <Icon name={appNotice.tone === "error" ? "info" : "check"} size={18}
                style={{ color: appNotice.tone === "error" ? "var(--red)" : "var(--amber)" }} />
              <span style={{ fontWeight: 600, fontSize: 15 }}>{appNotice.title || "Notice"}</span>
            </div>
            <div style={{ padding: "18px 20px", fontSize: 13, lineHeight: 1.55, color: "var(--cream-2)" }}>
              {String(appNotice.message || "").split(/\n{2,}/).map((part, i) => (
                <div key={i} style={{ marginTop: i ? 10 : 0, whiteSpace: "pre-wrap" }}>{part}</div>
              ))}
            </div>
            <div style={{ padding: "0 20px 18px", display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="btn" onClick={() => setAppNotice(null)}
                style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line-strong)", background: "var(--surface2)", color: "var(--cream-2)", fontSize: 12.5, fontWeight: 600 }}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {missingAudio && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(8,6,4,.6)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center" }}
          onMouseDown={() => setMissingAudio(null)}>
          <div onMouseDown={(e) => e.stopPropagation()}
            style={{ width: 500, maxWidth: "90vw", background: "var(--bg)", border: "1px solid var(--line-strong)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
              <Icon name="info" size={18} style={{ color: "var(--amber)" }} />
              <span style={{ fontWeight: 600, fontSize: 15 }}>Some audio files could not be found</span>
            </div>
            <div style={{ padding: "16px 20px", fontSize: 13, lineHeight: 1.5, color: "var(--cream-2)" }}>
              <div style={{ marginBottom: 12 }}>
                The project opened, but {missingAudio.items.length} audio source{missingAudio.items.length === 1 ? "" : "s"} could not be loaded.
                Those tracks show <b>NO AUDIO</b> until the missing files are restored to their original location.
              </div>
              <div style={{ maxHeight: 210, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface2)" }}>
                {missingAudio.items.map((it, i) => (
                  <div key={i} style={{ padding: "8px 12px", borderBottom: i < missingAudio.items.length - 1 ? "1px solid var(--line)" : "none" }}>
                    <div style={{ fontWeight: 600, fontSize: 12.5 }}>{it.name}</div>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--cream-2)", opacity: 0.85, wordBreak: "break-all", marginTop: 2 }}>{it.filePath}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: "0 20px 18px", display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="btn" onClick={() => setMissingAudio(null)}
                style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line-strong)", background: "var(--surface2)", color: "var(--cream-2)", fontSize: 12.5, fontWeight: 600 }}>
                OK
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
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateDialog, setUpdateDialog] = useState(null);
  const manualUpdateCheckRef = useRef(false);
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

  const checkForUpdates = useCallback((manual = false) => {
    manualUpdateCheckRef.current = !!manual;
    if (manual) setUpdateDialog({ state: "checking" });
    if (!window.electronAPI || !window.electronAPI.checkForUpdates) {
      if (manual) setUpdateDialog({ state: "current", info: { currentVersion: APP_VERSION, latestVersion: APP_VERSION } });
      return;
    }
    window.electronAPI.checkForUpdates().catch((err) => {
      console.warn("Update check failed:", err);
      if (manualUpdateCheckRef.current) {
        manualUpdateCheckRef.current = false;
        setUpdateDialog({ state: "current", info: { currentVersion: APP_VERSION, latestVersion: APP_VERSION } });
      }
    });
  }, []);

  useEffect(() => {
    if (!startupReady) return;
    checkForUpdates(false);
  }, [startupReady, checkForUpdates]);

  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onUpdaterState) return undefined;
    return window.electronAPI.onUpdaterState((state) => {
      if (!state || !state.state) return;
      if (state.state === "checking") {
        if (manualUpdateCheckRef.current) setUpdateDialog({ state: "checking" });
        return;
      }
      if (state.state === "available") {
        setUpdateInfo({ ...state, updateAvailable: true });
        if (manualUpdateCheckRef.current) setUpdateDialog({ state: "available", info: state });
        manualUpdateCheckRef.current = false;
        return;
      }
      if (state.state === "current") {
        setUpdateInfo(null);
        if (manualUpdateCheckRef.current) setUpdateDialog({ state: "current", info: state });
        manualUpdateCheckRef.current = false;
        return;
      }
      if (state.state === "downloading") {
        setUpdateDialog((cur) => cur ? { state: "downloading", info: state } : cur);
        return;
      }
      if (state.state === "downloaded") {
        setUpdateInfo({ ...state, updateAvailable: true, downloaded: true });
        setUpdateDialog({ state: "downloaded", info: state });
        manualUpdateCheckRef.current = false;
        return;
      }
      if (state.state === "error") {
        setUpdateInfo(null);
        if (manualUpdateCheckRef.current || updateDialog) {
          setUpdateDialog({ state: "current", info: { ...state, latestVersion: state.currentVersion || APP_VERSION } });
        }
        manualUpdateCheckRef.current = false;
      }
    });
  }, [updateDialog]);

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
        onCheckUpdates={() => checkForUpdates(true)}
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
      {updateDialog && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(8,6,4,.6)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center" }}
          onMouseDown={() => updateDialog.state !== "checking" && setUpdateDialog(null)}>
          <div onMouseDown={(e) => e.stopPropagation()}
            style={{ width: 470, maxWidth: "90vw", background: "var(--bg)", border: "1px solid var(--line-strong)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
              <Icon name={updateDialog.state === "available" || updateDialog.state === "downloading" || updateDialog.state === "downloaded" ? "download" : "check"} size={18}
                style={{ color: "var(--amber)" }} />
              <span style={{ fontWeight: 600, fontSize: 15 }}>Check for Updates</span>
            </div>
            <div style={{ padding: "18px 20px", fontSize: 13, lineHeight: 1.55, color: "var(--cream-2)" }}>
              {updateDialog.state === "checking" && (
                <div>Checking GitHub Releases through electron-updater...</div>
              )}
              {updateDialog.state === "available" && updateDialog.info && (
                <React.Fragment>
                  <div style={{ marginBottom: 10 }}>A new FocusDAW Studio update is available.</div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--cream)" }}>
                    Current: v{updateDialog.info.currentVersion}
                    <br />
                    Latest: {releaseVersionLabel(updateDialog.info.latestVersion)}
                  </div>
                  {updateDialog.info.releaseDate && (
                    <div className="mono" style={{ marginTop: 8, fontSize: 10.5, color: "var(--muted)" }}>
                      Published: {new Date(updateDialog.info.releaseDate).toLocaleString()}
                    </div>
                  )}
                  <div style={{ marginTop: 10 }}>Press OK to download the update.</div>
                </React.Fragment>
              )}
              {updateDialog.state === "current" && updateDialog.info && (
                <React.Fragment>
                  <div style={{ marginBottom: 10 }}>FocusDAW Studio is up to date.</div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--cream)" }}>
                    Current: v{updateDialog.info.currentVersion}
                    <br />
                    Latest: {releaseVersionLabel(updateDialog.info.latestVersion || updateDialog.info.currentVersion)}
                  </div>
                </React.Fragment>
              )}
              {updateDialog.state === "downloading" && (
                <React.Fragment>
                  <div style={{ marginBottom: 10 }}>Downloading update...</div>
                  <div style={{ height: 8, borderRadius: 999, background: "var(--surface2)", overflow: "hidden", border: "1px solid var(--line)" }}>
                    <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, updateDialog.info && updateDialog.info.percent || 0))}%`, background: "var(--amber)" }} />
                  </div>
                  <div className="mono" style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
                    {Math.max(0, Math.min(100, updateDialog.info && updateDialog.info.percent || 0)).toFixed(1)}%
                  </div>
                </React.Fragment>
              )}
              {updateDialog.state === "downloaded" && (
                <React.Fragment>
                  <div style={{ marginBottom: 10 }}>The update has been downloaded.</div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--cream)" }}>
                    Ready: {releaseVersionLabel(updateDialog.info && updateDialog.info.latestVersion)}
                  </div>
                  <div style={{ marginTop: 10 }}>Press OK to restart and install.</div>
                </React.Fragment>
              )}
            </div>
            <div style={{ padding: "0 20px 18px", display: "flex", justifyContent: "flex-end", gap: 10 }}>
              {(updateDialog.state === "available" || updateDialog.state === "downloaded") && (
                <button className="btn" onClick={() => setUpdateDialog(null)}
                  style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line-strong)", background: "var(--surface2)", color: "var(--cream-2)", fontSize: 12.5, fontWeight: 600 }}>
                  Cancel
                </button>
              )}
              {updateDialog.state !== "checking" && updateDialog.state !== "downloading" && (
                <button className="btn" onClick={() => {
                    const state = updateDialog.state;
                    if (state === "available") {
                      setUpdateDialog({ state: "downloading", info: { percent: 0 } });
                      if (window.electronAPI && window.electronAPI.downloadUpdate) {
                        window.electronAPI.downloadUpdate().catch((err) => {
                          console.warn("Update download failed:", err);
                          setUpdateInfo(null);
                          setUpdateDialog({ state: "current", info: { currentVersion: APP_VERSION, latestVersion: APP_VERSION } });
                        });
                      }
                      return;
                    }
                    if (state === "downloaded") {
                      if (window.electronAPI && window.electronAPI.installUpdate) {
                        window.electronAPI.installUpdate().catch((err) => {
                          console.warn("Update install failed:", err);
                          setUpdateInfo(null);
                          setUpdateDialog({ state: "current", info: { currentVersion: APP_VERSION, latestVersion: APP_VERSION } });
                        });
                      }
                      return;
                    }
                    setUpdateDialog(null);
                  }}
                  style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--amber)", background: updateDialog.state === "available" || updateDialog.state === "downloaded" ? "var(--amber)" : "var(--surface2)", color: updateDialog.state === "available" || updateDialog.state === "downloaded" ? "var(--accent-fg)" : "var(--cream-2)", fontSize: 12.5, fontWeight: 700 }}>
                  OK
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="bottombar">
        <span className="bottom-project mono">{projectName || DEFAULT_PROJECT_NAME}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {updateInfo && updateInfo.updateAvailable && (
            <div className="update-ticker" title="New update available" aria-live="polite">
              <span className="update-ticker-text">
                New update available: {releaseVersionLabel(updateInfo.latestVersion)}
              </span>
            </div>
          )}
          <span style={{ fontSize: 10.5, color: "var(--dim)", fontWeight: 600, letterSpacing: ".03em" }}>FocusDAW Studio</span>
          <span className="version-badge">{APP_VERSION}</span>
        </div>
      </div>
    </div>
  );
}

DAW.init();
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
