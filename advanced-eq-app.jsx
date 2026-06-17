// Advanced Effect — Equalizer module.
// Currently a bare window frame (titlebar + view switcher + footer); the
// interior is intentionally empty and will be filled out later.

const eqChannel = new BroadcastChannel("focusdaw-advanced-effects-sync");

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

function AdvancedEqApp() {
  const [theme, setTheme] = useState("default");

  // Follow the studio's colour theme, same channel/messages as the Pan module.
  useEffect(() => {
    eqChannel.postMessage({ type: "ADVANCED_READY" });
    const handleMessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if ((msg.type === "INIT_STATE" || msg.type === "SYNC_STATE") && msg.theme) {
        setTheme(msg.theme);
      }
    };
    eqChannel.addEventListener("message", handleMessage);
    return () => eqChannel.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "default") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <div className="aef-backdrop">
      <div className="aef-shell">
        <div className="aef-window">
          <div className="aef-titlebar">
            {/* Left: module label + view switcher */}
            <span className="aef-brand">
              <svg className="aef-brand-icon" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <line x1="6" y1="4" x2="6" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /><line x1="18" y1="4" x2="18" y2="20" />
                </g>
                <g fill="var(--bg2, #1a1a1a)" stroke="currentColor" strokeWidth="1.6">
                  <circle cx="6" cy="9" r="2.3" /><circle cx="12" cy="14.5" r="2.3" /><circle cx="18" cy="8" r="2.3" />
                </g>
              </svg>
              <span className="aef-toolbar-label">EQUALIZER</span>
            </span>
            <AdvancedViewMenu current="eq" />

            {/* Center: window title */}
            <div className="title-c" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", flex: "none" }}>FocusDAW Studio <b>Equalizer</b></div>

            <div style={{ marginLeft: "auto" }} />
            <WindowControlsAef />
          </div>

          <div className="aef-room" style={{ display: "grid", placeItems: "center" }}>
            <div className="aef-empty">Equalizer module - coming soon.</div>
          </div>

          <div className="aef-footer">
            <span>Equalizer</span>
            <span className="mono">FocusDAW Studio</span>
          </div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.render(<AdvancedEqApp />, document.getElementById("root"));
