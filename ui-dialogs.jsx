/* ================= FocusDAW — loader screen + export dialog ================= */

function Logo({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="18" fill="none" stroke="var(--amber)" strokeWidth="2" />
      <circle cx="20" cy="20" r="11" fill="none" stroke="var(--amber-deep)" strokeWidth="1.5" />
      <circle cx="20" cy="20" r="4" fill="var(--amber)" />
      <line x1="20" y1="2" x2="20" y2="8" stroke="var(--amber)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- loader / project setup ---------- */
function LoaderScreen({ onOpen }) {
  const [name, setName] = useState("Midnight Drive — Stems");
  const [stems, setStems] = useState(() => DAW.tracks.map((t) => ({ id: t.id, name: t.name, type: t.type, dur: t.buffer.duration, on: true, demo: true })));
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  useTick();

  const addFiles = async (files) => {
    setBusy(true);
    for (const f of files) {
      if (!/\.(mp3|wav|aiff?|m4a|ogg|flac)$/i.test(f.name)) continue;
      try { const t = await DAW.addFile(f); setStems((s) => [...s, { id: t.id, name: t.name, type: "audio", dur: t.buffer.duration, on: true }]); } catch (e) {}
    }
    setBusy(false);
  };
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); addFiles([...e.dataTransfer.files]); };
  const pick = (e) => addFiles([...e.target.files]);
  const toggle = (id) => setStems((s) => s.map((x) => x.id === id ? { ...x, on: !x.on } : x));
  const enabled = stems.filter((s) => s.on);

  const open = () => {
    // remove un-registered demo tracks from engine
    stems.filter((s) => !s.on).forEach((s) => { const i = DAW.tracks.findIndex((t) => t.id === s.id); if (i >= 0) DAW.tracks.splice(i, 1); });
    onOpen(name);
  };

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden", background: "radial-gradient(120% 80% at 80% -10%,rgba(232,176,75,.10),transparent 60%),var(--bg)" }}>
      {/* brand panel */}
      <div style={{ width: 320, flex: "0 0 320px", borderRight: "1px solid var(--line)", padding: "44px 36px",
        display: "flex", flexDirection: "column", background: "linear-gradient(180deg,rgba(255,255,255,.015),transparent)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Logo size={36} />
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.01em" }}>FocusDAW</div>
            <div className="mono" style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".12em" }}>STEM STUDIO</div>
          </div>
        </div>
        <p style={{ marginTop: 28, color: "var(--cream-2)", fontSize: 14, lineHeight: 1.6, maxWidth: 230 }}>
          Load a song's separated stems, balance and shape them per section, and bounce a single master.
        </p>
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {["Bulk-register a stem folder", "Per-track filter · reverb · echo", "Volume automation overlay", "Master EQ + fade · MP3 bounce"].map((f) => (
            <div key={f} style={{ display: "flex", gap: 9, alignItems: "center", fontSize: 12.5, color: "var(--dim)" }}>
              <span style={{ width: 16, height: 16, borderRadius: 5, background: "var(--amber-soft)", color: "var(--amber)", display: "grid", placeItems: "center" }}><Icon name="check" size={11} /></span>{f}
            </div>
          ))}
          <div className="mono" style={{ fontSize: 10, color: "var(--faint)", marginTop: 14 }}>v0.9.0 · Electron · macOS / Win / Linux</div>
        </div>
      </div>

      {/* project setup */}
      <div style={{ flex: 1, padding: "40px 48px", overflowY: "auto" }}>
        <div style={{ maxWidth: 620 }}>
          <div className="chip" style={{ color: "var(--amber)", background: "var(--amber-soft)" }}>New Project</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: "14px 0 24px", letterSpacing: "-.02em" }}>Set up your session</h1>

          <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", color: "var(--muted)", textTransform: "uppercase" }}>Project name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", marginTop: 7, marginBottom: 22, height: 42, padding: "0 14px",
            background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: 9, color: "var(--cream)", fontSize: 15, fontFamily: "var(--ui)", outline: "none" }} />

          {/* drop zone */}
          <label onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}
            style={{ display: "block", border: `1.5px dashed ${dragOver ? "var(--amber)" : "var(--line-strong)"}`, borderRadius: 12, padding: "26px 20px",
              textAlign: "center", background: dragOver ? "var(--amber-soft)" : "rgba(255,255,255,.012)", cursor: "pointer", transition: ".15s" }}>
            <input type="file" multiple accept=".mp3,.wav,.aiff,.m4a,.ogg,.flac" onChange={pick} style={{ display: "none" }} />
            <Icon name="folder" size={30} style={{ color: "var(--amber)" }} />
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 8 }}>Select a project folder, or drop stem files</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>Bulk-registers every .wav / .mp3 — one track per file. A <span className="mono" style={{ color: "var(--cream-2)" }}>.focus</span> project file is created.</div>
          </label>

          {/* scanned stems */}
          <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", color: "var(--muted)", textTransform: "uppercase" }}>Detected stems</span>
            <span className="chip">{enabled.length} of {stems.length} registered</span>
            {busy && <span className="mono" style={{ fontSize: 10, color: "var(--amber)" }}>decoding…</span>}
            <span className="mono" style={{ fontSize: 10, color: "var(--faint)", marginLeft: "auto" }}>demo session preloaded</span>
          </div>
          <div style={{ marginTop: 10, border: "1px solid var(--line)", borderRadius: 11, overflow: "hidden" }}>
            {stems.map((s, i) => (
              <div key={s.id} onClick={() => toggle(s.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", cursor: "pointer",
                borderBottom: i < stems.length - 1 ? "1px solid var(--line)" : "none", background: s.on ? "transparent" : "rgba(0,0,0,.18)" }}>
                <span style={{ width: 18, height: 18, borderRadius: 5, border: "1.5px solid " + (s.on ? "var(--amber)" : "var(--faint)"), background: s.on ? "var(--amber)" : "transparent", color: "#241a0a", display: "grid", placeItems: "center" }}>{s.on && <Icon name="check" size={12} />}</span>
                <Icon name="wave" size={15} style={{ color: s.on ? "var(--amber)" : "var(--faint)" }} />
                <span style={{ fontSize: 13.5, fontWeight: 500, opacity: s.on ? 1 : .5 }}>{s.name}</span>
                <span className="chip" style={{ fontSize: 9 }}>{s.demo ? "synth" : "wav"}</span>
                <span className="mono" style={{ fontSize: 10.5, color: "var(--muted)", marginLeft: "auto" }}>{fmtTime(s.dur)}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 26 }}>
            <button className="btn primary" onClick={open} disabled={!enabled.length} style={{ height: 44, padding: "0 22px", opacity: enabled.length ? 1 : .5 }}>
              <Icon name="disc" size={16} /> Create Project &amp; Open Studio
            </button>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--faint)" }}>{enabled.length} tracks · 120 BPM · {fmtTime(DAW.duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- WAV encoder ---------- */
function audioBufferToWav(buf) {
  const numCh = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length * numCh * 2;
  const ab = new ArrayBuffer(44 + len); const dv = new DataView(ab);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, "RIFF"); dv.setUint32(4, 36 + len, true); wr(8, "WAVE"); wr(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, numCh, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * numCh * 2, true); dv.setUint16(32, numCh * 2, true);
  dv.setUint16(34, 16, true); wr(36, "data"); dv.setUint32(40, len, true);
  let off = 44;
  const chs = []; for (let c = 0; c < numCh; c++) chs.push(buf.getChannelData(c));
  for (let i = 0; i < buf.length; i++) for (let c = 0; c < numCh; c++) {
    let s = Math.max(-1, Math.min(1, chs[c][i])); dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2;
  }
  return new Blob([ab], { type: "audio/wav" });
}

/* ---------- export dialog ---------- */
function ExportDialog({ projectName, onClose }) {
  const [bitrate, setBitrate] = useState(320);
  const [sr, setSr] = useState(44100);
  const [normalize, setNormalize] = useState(true);
  const [stage, setStage] = useState("settings"); // settings | rendering | done
  const [prog, setProg] = useState(0);
  const [url, setUrl] = useState(null);

  const render = async () => {
    setStage("rendering"); setProg(0);
    const rendered = await DAW.renderMix((p) => setProg(p));
    const blob = audioBufferToWav(rendered);
    setUrl(URL.createObjectURL(blob));
    setStage("done");
  };
  const fileName = projectName.replace(/[^\w\-]+/g, "_") + ".mp3";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(8,6,4,.6)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center" }} onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 460, background: "var(--bg)", border: "1px solid var(--line-strong)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="download" size={18} style={{ color: "var(--amber)" }} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>Bounce to MP3</span>
          <div style={{ flex: 1 }} />
          <button className="iconbtn" onClick={onClose}><Icon name="scissors" size={0} /><span style={{ fontSize: 18 }}>×</span></button>
        </div>

        {stage === "settings" && (
          <div style={{ padding: 20 }}>
            <Row label="File name"><span className="mono" style={{ fontSize: 12.5, color: "var(--cream-2)" }}>{fileName}</span></Row>
            <Row label="Format"><Seg small value="mp3" onChange={() => {}} options={[{ v: "mp3", l: "MP3" }, { v: "wav", l: "WAV" }]} /></Row>
            <Row label="Bitrate"><Seg small value={bitrate} onChange={setBitrate} options={[{ v: 192, l: "192" }, { v: 256, l: "256" }, { v: 320, l: "320 kbps" }]} /></Row>
            <Row label="Sample rate"><Seg small value={sr} onChange={setSr} options={[{ v: 44100, l: "44.1k" }, { v: 48000, l: "48k" }]} /></Row>
            <Row label="Normalize"><button onClick={() => setNormalize(!normalize)} style={{ width: 40, height: 22, borderRadius: 12, background: normalize ? "var(--amber)" : "var(--surface3)", position: "relative", transition: ".15s" }}><span style={{ position: "absolute", top: 2, left: normalize ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#241a0a", transition: ".15s" }} /></button></Row>
            <div style={{ marginTop: 8, padding: "10px 12px", background: "rgba(232,176,75,.06)", borderRadius: 9, fontSize: 11.5, color: "var(--dim)", lineHeight: 1.5 }}>
              Includes all unmuted tracks with their FX, automation, master EQ &amp; fades. Length {fmtTime(DAW.duration)}.
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button className="btn" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
              <button className="btn primary" onClick={render} style={{ flex: 2 }}><Icon name="disc" size={15} /> Render</button>
            </div>
          </div>
        )}

        {stage === "rendering" && (
          <div style={{ padding: "34px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "var(--cream-2)", marginBottom: 16 }}>Rendering mix… <span className="mono" style={{ color: "var(--amber)" }}>{Math.round(prog * 100)}%</span></div>
            <div style={{ height: 8, background: "var(--surface)", borderRadius: 5, overflow: "hidden" }}>
              <div style={{ height: "100%", width: prog * 100 + "%", background: "linear-gradient(90deg,var(--amber-deep),var(--amber))", borderRadius: 5, transition: "width .12s" }} />
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 14 }}>offline render · {sr / 1000}kHz · {bitrate}kbps</div>
          </div>
        )}

        {stage === "done" && (
          <div style={{ padding: "30px 24px", textAlign: "center" }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--amber-soft)", color: "var(--amber)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}><Icon name="check" size={26} /></div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Mixdown ready</div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--muted)", margin: "6px 0 18px" }}>{fileName} · {fmtTime(DAW.duration)} · {sr / 1000}kHz</div>
            <a className="btn primary" href={url} download={fileName.replace(/\.mp3$/, ".wav")} style={{ textDecoration: "none", justifyContent: "center" }}><Icon name="download" size={15} /> Save file</a>
            <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 12, lineHeight: 1.5 }}>Browser preview renders WAV — the native build pipes through ffmpeg for true MP3 encode.</div>
            <button className="btn ghost" onClick={onClose} style={{ marginTop: 8 }}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
function Row({ label, children }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--line)" }}>
    <span style={{ fontSize: 12.5, color: "var(--dim)" }}>{label}</span>{children}</div>;
}

Object.assign(window, { LoaderScreen, ExportDialog, Logo, audioBufferToWav });
