const channel = new BroadcastChannel("focusdaw-mixer-sync");

// Mocking DAW interface for ui-mixer.jsx components
window.DAW = {
  tracks: [],
  master: {
    volume: 1,
    reverb: 0,
    echo: 0,
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    fadeIn: 0,
    fadeOut: 0
  },
  EQ_FREQS: [60, 150, 320, 640, 1200, 2400, 4800, 9000, 15000],
  _levels: {},
  _masterLevel: 0,
  _masterBandLevels: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  _fftData: [],

  _anySolo() {
    return this.tracks.some(t => t.params.solo);
  },
  getTrackLevel(id) {
    return this._levels[id] || 0;
  },
  getMasterLevel() {
    return this._masterLevel;
  },
  getMasterBandLevels() {
    return this._masterBandLevels;
  },
  computeSpectrum() {
    return this._fftData;
  },

  setTrackParam(id, k, v) {
    const t = this.tracks.find(tr => tr.id === id);
    if (t) {
      t.params[k] = v;
    }
    channel.postMessage({ type: 'SET_TRACK_PARAM', id, k, v });
  },
  setMaster(k, v) {
    this.master[k] = v;
    channel.postMessage({ type: 'SET_MASTER_PARAM', k, v });
  },
  setMasterBand(i, v) {
    this.master.bands[i] = v;
    channel.postMessage({ type: 'SET_MASTER_BAND', i, v });
  },
  applyEQPreset(name) {
    channel.postMessage({ type: 'APPLY_EQ_PRESET', name });
  }
};

function MixerApp() {
  useTick(); // polling ticks for real-time level meters
  const [theme, setTheme] = React.useState("default");
  const [, force] = React.useState(0);

  React.useEffect(() => {
    // Notify main window that mixer is ready and request initial state
    channel.postMessage({ type: "MIXER_READY" });

    const handleMessage = (e) => {
      const msg = e.data;
      if (!msg) return;

      if (msg.type === "INIT_STATE") {
        window.DAW.tracks = msg.tracks;
        window.DAW.master = msg.master;
        setTheme(msg.theme);
        force(n => n + 1);
      } else if (msg.type === "SYNC_STATE") {
        window.DAW.tracks = msg.tracks;
        window.DAW.master = msg.master;
        force(n => n + 1);
      } else if (msg.type === "LEVEL_METERS") {
        window.DAW._levels = msg.trackLevels;
        window.DAW._masterLevel = msg.masterLevel;
        window.DAW._masterBandLevels = msg.masterBandLevels;
        window.DAW._fftData = msg.fftData;
        // Levels are updated rapidly, relying on useTick() for visual refresh without React component lag
      }
    };

    channel.addEventListener("message", handleMessage);
    return () => {
      channel.removeEventListener("message", handleMessage);
    };
  }, []);

  React.useEffect(() => {
    const root = document.documentElement;
    if (theme === "default") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  React.useEffect(() => {
    const k = (e) => {
      if (e.key === "F3") {
        e.preventDefault();
        handleWinAction("close");
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const handleWinAction = (action) => {
    if (window.electronAPI && window.electronAPI.winAction) {
      window.electronAPI.winAction(action);
    } else {
      if (action === "close") window.close();
    }
  };

  const isMac = window.electronAPI && window.electronAPI.platform === "darwin";

  return (
    <div className="mixer-app">
      {/* Custom Titlebar */}
      <div className="mixer-titlebar">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="mixer" size={14} style={{ color: "var(--amber)" }} />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", color: "var(--cream-2)" }}>MIXER CONSOLE</span>
        </div>
        <div className="title-c">
          FocusDAW Studio <b>Mixer</b>
        </div>
        {(!isMac && window.electronAPI) ? (
          <div className="window-controls">
            <button className="window-control" onClick={() => handleWinAction("minimize")} title="Minimize">—</button>
            <button className="window-control" onClick={() => handleWinAction("maximize")} title="Maximize">▢</button>
            <button className="window-control close" onClick={() => handleWinAction("close")} title="Close">×</button>
          </div>
        ) : (
          <div style={{ width: 80 }} />
        )}
      </div>

      {/* Mixer Console Container */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden", background: "var(--bg)" }}>
        <div style={{ display: "flex", flex: "1 1 auto", overflowX: "auto" }}>
          <div style={{ display: "flex", flex: "0 0 auto" }}>
            {window.DAW.tracks.map((t) => (
              <ChannelStrip
                key={t.id}
                track={t}
                level={window.DAW.getTrackLevel(t.id)}
                onParam={(k, v) => {
                  channel.postMessage({ type: "BEFORE_CHANGE" });
                  window.DAW.setTrackParam(t.id, k, v);
                  force(n => n + 1);
                }}
              />
            ))}
          </div>
          <div style={{ flex: 1, background: "var(--bg)" }} />
        </div>
        <MasterPanel
          level={window.DAW.getMasterLevel()}
          master={window.DAW.master}
          onMaster={(k, v) => {
            channel.postMessage({ type: "BEFORE_CHANGE" });
            window.DAW.setMaster(k, v);
            force(n => n + 1);
          }}
          onBeforeChange={() => channel.postMessage({ type: "BEFORE_CHANGE" })}
        />
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<MixerApp />);
