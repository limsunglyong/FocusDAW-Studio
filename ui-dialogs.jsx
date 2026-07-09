/* ================= FocusDAW — loader screen + export dialog ================= */

function Logo({ size = 30, style }) {
  return (
    <img src="assets/logo.png" width={size} height={size}
      style={{ borderRadius: Math.round(size * 0.22), display: "block", objectFit: "cover", ...style }}
      alt="FocusDAW Studio" />
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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <Logo size={72} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.01em" }}>FocusDAW</div>
            <div className="mono" style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".12em" }}>STEM STUDIO</div>
          </div>
        </div>
        <p style={{ marginTop: 28, color: "var(--cream-2)", fontSize: 14, lineHeight: 1.6, maxWidth: 230 }}>
          Load a song's separated stems, balance and shape them per section, and bounce a single master.
        </p>
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {["Bulk-register a stem folder", "Per-track panning · reverb · echo", "Volume automation overlay", "Master EQ + fade · MP3 bounce"].map((f) => (
            <div key={f} style={{ display: "flex", gap: 9, alignItems: "center", fontSize: 12.5, color: "var(--dim)" }}>
              <span style={{ width: 16, height: 16, borderRadius: 5, background: "var(--amber-soft)", color: "var(--amber)", display: "grid", placeItems: "center" }}><Icon name="check" size={11} /></span>{f}
            </div>
          ))}
          <div className="mono" style={{ fontSize: 10, color: "var(--faint)", marginTop: 14 }}>v{window.APP_VERSION || "0.0.0"} · Electron · macOS / Win / Linux</div>
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

/* ---------- MP3 encoder (browser / lamejs fallback) ---------- */
async function audioBufferToMp3(audioBuf, bitrate, onProgress) {
  const lame = window.lamejs;
  if (!lame) throw new Error("lamejs not loaded");
  const numCh = Math.min(2, audioBuf.numberOfChannels);
  const sr    = audioBuf.sampleRate;
  const enc   = new lame.Mp3Encoder(numCh, sr, bitrate);
  const toI16 = (f32) => {
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++)
      i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32767 | 0));
    return i16;
  };
  const L = toI16(audioBuf.getChannelData(0));
  const R = numCh > 1 ? toI16(audioBuf.getChannelData(1)) : L;
  const block = 1152;
  const chunks = [];
  for (let i = 0; i < L.length; i += block) {
    const mp3 = enc.encodeBuffer(L.subarray(i, i + block), R.subarray(i, i + block));
    if (mp3.length) chunks.push(new Uint8Array(mp3));
    if (onProgress) onProgress(Math.min(0.98, i / L.length));
    if (i % (block * 64) === 0) await new Promise(r => setTimeout(r, 0));
  }
  const end = enc.flush();
  if (end.length) chunks.push(new Uint8Array(end));
  if (onProgress) onProgress(1);
  return new Blob(chunks, { type: "audio/mpeg" });
}

/* ---------- WAV encoder ---------- */
// Build a RIFF LIST/INFO chunk from metadata (Title/Artist/Album/Date) so players
// and Windows Explorer can read WAV tags. Album art is not part of the WAV standard.
function buildWavInfoChunk(meta) {
  if (!meta) return null;
  const fields = [
    ["INAM", meta.title],   // title
    ["IART", meta.artist],  // artist / composer
    ["IPRD", meta.album],   // album (product)
    ["ICRD", meta.date || meta.year], // creation date
    ["ISFT", "FocusDAW Studio"],      // software
  ].filter(([, v]) => v != null && String(v).length);
  if (!fields.length) return null;
  const enc = new TextEncoder();
  const subs = fields.map(([id, v]) => {
    let bytes = enc.encode(String(v) + "\0");
    if (bytes.length % 2) { const p = new Uint8Array(bytes.length + 1); p.set(bytes); bytes = p; } // word-align
    return { id, bytes };
  });
  let body = 4; // "INFO"
  subs.forEach((s) => { body += 8 + s.bytes.length; });
  const out = new Uint8Array(8 + body);
  const dv = new DataView(out.buffer);
  const tag = (o, t) => { for (let i = 0; i < 4; i++) out[o + i] = t.charCodeAt(i); };
  tag(0, "LIST"); dv.setUint32(4, body, true); tag(8, "INFO");
  let o = 12;
  subs.forEach((s) => {
    tag(o, s.id); dv.setUint32(o + 4, s.bytes.length, true); out.set(s.bytes, o + 8);
    o += 8 + s.bytes.length;
  });
  return out;
}

function audioBufferToWav(buf, meta) {
  const numCh = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length * numCh * 2;
  const info = buildWavInfoChunk(meta);
  const infoLen = info ? info.length : 0;
  const ab = new ArrayBuffer(44 + len + infoLen); const dv = new DataView(ab);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, "RIFF"); dv.setUint32(4, 36 + len + infoLen, true); wr(8, "WAVE"); wr(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, numCh, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * numCh * 2, true); dv.setUint16(32, numCh * 2, true);
  dv.setUint16(34, 16, true); wr(36, "data"); dv.setUint32(40, len, true);
  let off = 44;
  const chs = []; for (let c = 0; c < numCh; c++) chs.push(buf.getChannelData(c));
  for (let i = 0; i < buf.length; i++) for (let c = 0; c < numCh; c++) {
    let s = Math.max(-1, Math.min(1, chs[c][i])); dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2;
  }
  if (info) new Uint8Array(ab).set(info, 44 + len); // INFO chunk after data; duration unaffected
  return new Blob([ab], { type: "audio/wav" });
}

/* ---------- ID3v2.3 tag builder (for browser lamejs MP3 — ffmpeg handles tags natively) ---------- */
function _dataUrlParts(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  return m ? { mime: m[1], base64: m[2] } : null;
}
function _base64ToBytes(b64) {
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function _id3Uint32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
function _id3Synchsafe(n) { return [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]; }
function _id3Frame(id, dataArr) {
  const frame = new Uint8Array(10 + dataArr.length);
  for (let i = 0; i < 4; i++) frame[i] = id.charCodeAt(i);
  const sz = _id3Uint32(dataArr.length);
  frame[4] = sz[0]; frame[5] = sz[1]; frame[6] = sz[2]; frame[7] = sz[3];
  frame.set(dataArr, 10); // flags (8,9) left 0
  return frame;
}
function _id3TextFrame(id, value) {
  if (value == null || !String(value).length) return null;
  const str = String(value);
  // encoding 0x01 = UTF-16 with BOM (ID3v2.3 supports Unicode this way → Korean OK)
  const data = new Uint8Array(1 + 2 + str.length * 2 + 2);
  data[0] = 0x01; data[1] = 0xff; data[2] = 0xfe; // encoding + LE BOM
  let o = 3;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); data[o++] = c & 255; data[o++] = (c >> 8) & 255; }
  return _id3Frame(id, data); // trailing 2 bytes stay 0 = null terminator
}
function _id3ApicFrame(mime, bytes) {
  if (!bytes || !bytes.length) return null;
  const head = [0x00]; // text encoding for description = latin1
  for (let i = 0; i < mime.length; i++) head.push(mime.charCodeAt(i) & 255);
  head.push(0x00, 0x03, 0x00); // mime null term, picture type 0x03 (front cover), empty description null term
  const data = new Uint8Array(head.length + bytes.length);
  data.set(head, 0); data.set(bytes, head.length);
  return _id3Frame("APIC", data);
}
function buildId3v2(meta, coverBytes, coverMime) {
  const frames = [];
  const add = (f) => { if (f) frames.push(f); };
  add(_id3TextFrame("TIT2", meta.title));
  add(_id3TextFrame("TPE1", meta.artist));
  add(_id3TextFrame("TCOM", meta.artist));
  add(_id3TextFrame("TALB", meta.album));
  const ym = String(meta.date || meta.year || "").match(/^(\d{4})(?:-(\d{2})-(\d{2}))?/);
  if (ym) { add(_id3TextFrame("TYER", ym[1])); if (ym[2] && ym[3]) add(_id3TextFrame("TDAT", ym[3] + ym[2])); } // TDAT = DDMM
  if (coverBytes) add(_id3ApicFrame(coverMime || "image/jpeg", coverBytes));
  let total = 0; frames.forEach((f) => { total += f.length; });
  const ss = _id3Synchsafe(total);
  const out = new Uint8Array(10 + total);
  out[0] = 0x49; out[1] = 0x44; out[2] = 0x33; out[3] = 0x03; out[4] = 0x00; out[5] = 0x00; // "ID3" v2.3.0 flags
  out[6] = ss[0]; out[7] = ss[1]; out[8] = ss[2]; out[9] = ss[3];
  let o = 10; frames.forEach((f) => { out.set(f, o); o += f.length; });
  return out;
}

/* ---------- preset album covers (generated via canvas — works in browser & Electron) ---------- */
function makePresetCovers() {
  const defs = [
    { name: "Amber Glow", a: "#e8b04b", b: "#5a2c0c" },
    { name: "Indigo Night", a: "#5b9bd5", b: "#0e1b30" },
    { name: "Forest", a: "#5de87a", b: "#0f1a13" },
    { name: "Monochrome", a: "#d8d8d8", b: "#1a1a1a" },
  ];
  return defs.map((d) => {
    const cv = document.createElement("canvas"); cv.width = 600; cv.height = 600;
    const g = cv.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 600, 600);
    grad.addColorStop(0, d.a); grad.addColorStop(1, d.b);
    g.fillStyle = grad; g.fillRect(0, 0, 600, 600);
    g.strokeStyle = "rgba(255,255,255,0.10)"; g.lineWidth = 2;
    for (let r = 60; r < 420; r += 60) { g.beginPath(); g.arc(300, 300, r, 0, Math.PI * 2); g.stroke(); }
    return { name: d.name, dataUrl: cv.toDataURL("image/jpeg", 0.9) };
  });
}

/* ---------- export dialog ---------- */
function safeExportFileBase(name) {
  const cleaned = String(name || "untitled")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[.\s]+$/g, "");
  return cleaned || "untitled";
}

function ExportDialog({ projectName, onClose }) {
  const [format, setFormat]     = useState("mp3");
  const [bitrate, setBitrate]   = useState(320);
  const [sr, setSr]             = useState(44100);
  // Normalize defaults OFF; both Normalize and the LUFS target persist across sessions.
  const [normalize, setNormalize] = useState(() => localStorage.getItem("focusdaw-export-normalize") === "1");
  const [lufsTarget, setLufsTarget] = useState(() => {
    const v = parseFloat(localStorage.getItem("focusdaw-export-lufs"));
    return Number.isFinite(v) ? v : -14;
  });
  useEffect(() => { try { localStorage.setItem("focusdaw-export-normalize", normalize ? "1" : "0"); } catch (e) {} }, [normalize]);
  useEffect(() => { try { localStorage.setItem("focusdaw-export-lufs", String(lufsTarget)); } catch (e) {} }, [lufsTarget]);
  const [preservePitch, setPreservePitch] = useState(() => {
    const d = window.DAW;
    return !!(d && d.tempo && d.tempo.variBpm);
  });
  const [stage, setStage]       = useState("settings"); // settings | rendering | error | done
  const [prog, setProg]         = useState(0);
  const [stepLabel, setLabel]   = useState("Rendering mix…");
  const [url, setUrl]           = useState(null);
  const [ext, setExt]           = useState("mp3");
  const [audioBlob, setAudioBlob] = useState(null);
  const [saving, setSaving]     = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [exportNotice, setExportNotice] = useState(null);

  // ---- metadata (tags) ----
  const _now = new Date();
  const _curYear = String(_now.getFullYear());
  const _curDate = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-${String(_now.getDate()).padStart(2, "0")}`;
  const _projTitle = projectName || "untitled";
  const [title, setTitle]   = useState(_projTitle);   // default: project title
  const [artist, setArtist] = useState("unknown");     // composer, default: unknown
  const [album, setAlbum]   = useState(_projTitle);    // default: project title
  const [year, setYear]     = useState(_curYear);      // default: current year
  const [mdate, setMdate]   = useState(_curDate);      // default: current date
  const [cover, setCover]   = useState(null);          // { key, name, dataUrl } — MP3 only
  const [presets] = useState(makePresetCovers);        // generated once (canvas)
  const coverFileRef = useRef(null);
  const artEnabled = format === "mp3";

  const onCoverSelect = (e) => {
    const v = e.target.value;
    if (v === "none") { setCover(null); return; }
    if (v === "file") { if (coverFileRef.current) coverFileRef.current.click(); return; }
    if (v.startsWith("preset:")) {
      const i = +v.slice(7); const p = presets[i];
      if (p) setCover({ key: v, name: p.name, dataUrl: p.dataUrl });
    }
  };
  const onCoverFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) {
      const reader = new FileReader();
      reader.onload = () => setCover({ key: "custom", name: f.name, dataUrl: reader.result });
      reader.readAsDataURL(f);
    }
    e.target.value = ""; // allow re-picking the same file
  };

  const render = async () => {
    try {
      setErrorMsg("");
      setExportNotice(null);
      setStage("rendering"); setProg(0); setLabel("Rendering mix…");

      let forceLocalRender = false;
      if (DAW && DAW.isNative) {
        try {
          const nativeResult = await DAW.renderMix((p) => setProg(p), {
            format,
            bitrate,
            sampleRate: sr,
            normalize,
            lufsTarget,
            preservePitch,
          });

          if (nativeResult && nativeResult.isNative && nativeResult.tempFilePath) {
            if (window.electronAPI && window.electronAPI.inspectNativeAudio) {
              const inspected = await window.electronAPI.inspectNativeAudio(nativeResult.tempFilePath);
              if (inspected && inspected.silent) {
                throw new Error(`Native export produced silence (peak ${Number(inspected.peak || 0).toExponential(2)}, rms ${Number(inspected.rms || 0).toExponential(2)}).`);
              }
            }
            setAudioBlob({
              isNative: true,
              tempFilePath: nativeResult.tempFilePath,
            });
            setProg(1);
            setStage("done");
            return;
          }
          throw new Error("Native export returned no output file.");
        } catch (nativeErr) {
          console.warn("Native export failed; falling back to Web Audio export:", nativeErr);
          forceLocalRender = true;
          setExportNotice({
            type: "fallback",
            text: "Native export failed or produced silence. This file was rendered with Web Audio fallback.",
          });
          setProg(0);
          setLabel("Native export unavailable - rendering with Web Audio...");
        }
      }

      const ratio = format === "mp3" ? 0.75 : 1;
      const tempoRate = DAW && DAW._projectRate ? DAW._projectRate() : 1;
      const tempoChanged = Math.abs(tempoRate - 1) > 0.001;
      const nativeAudio = !!(window.electronAPI && window.electronAPI.processAudio);
      // Pitch-preserving tempo via ffmpeg atempo (desktop only).
      const nativeKeepPitch = nativeAudio && preservePitch && tempoChanged;
      // LUFS loudness normalization via ffmpeg loudnorm (desktop only). Replaces the
      // in-graph soft-clipper "Normalize", which only attenuated and never made up gain.
      const nativeLoudnorm = nativeAudio && normalize;
      const ffmpegProcess = nativeKeepPitch || nativeLoudnorm;
      const rendered = await DAW.renderMix((p) => setProg(p * ratio), {
        // Skip the in-graph clipper when ffmpeg loudnorm will normalize loudness/true-peak.
        normalize: normalize && !nativeLoudnorm,
        sampleRate: sr,
        preservePitch: preservePitch && !nativeKeepPitch,
        applyTempo: !nativeKeepPitch,
        forceLocal: forceLocalRender,
      });
      const audioProcessOpts = {
        rate: nativeKeepPitch ? tempoRate : 1,
        sampleRate: sr,
        loudnorm: nativeLoudnorm ? { I: lufsTarget, TP: -1, LRA: 11 } : null,
      };
      // Combine Year (authoritative) + Date (month/day) into one ISO date for tags;
      // ID3v2.3 derives Year (TYER) + Date (TDAT) from the full date.
      const yr = String(year || "").trim();
      const dt = String(mdate || "").trim();
      let tagDate = dt;
      if (/^\d{4}$/.test(yr)) tagDate = /^\d{4}-\d{2}-\d{2}/.test(dt) ? (yr + dt.slice(4)) : yr;
      const meta = { title, artist, album, year: yr, date: tagDate };
      const coverParts = cover ? _dataUrlParts(cover.dataUrl) : null;

      let blob;
      if (format === "mp3") {
        if (window.electronAPI && window.electronAPI.encodeMp3) {
          // Electron path: ffmpeg (tags + cover embedded as ID3v2)
          setLabel(ffmpegProcess ? "Processing audio via ffmpeg…" : "Encoding MP3 via ffmpeg…"); setProg(0.78);
          const wavBlob = audioBufferToWav(rendered); // intermediate PCM; tags go via ffmpeg
          let wavAb = await wavBlob.arrayBuffer();
          if (ffmpegProcess) {
            wavAb = await window.electronAPI.processAudio(wavAb, audioProcessOpts);
            setLabel("Encoding MP3 via ffmpeg…"); setProg(0.84);
          }
          const coverArg = coverParts ? { data: coverParts.base64, mime: coverParts.mime } : null;
          const mp3Ab   = await window.electronAPI.encodeMp3(wavAb, { bitrate, sampleRate: sr, meta, cover: coverArg });
          blob = new Blob([mp3Ab], { type: "audio/mpeg" });
          setProg(1);
        } else if (window.lamejs) {
          // Browser path: lamejs + hand-built ID3v2 tag (text + APIC cover)
          setLabel("Encoding MP3…");
          const mp3Blob = await audioBufferToMp3(rendered, bitrate, (p) => setProg(0.75 + p * 0.22));
          const mp3Ab = await mp3Blob.arrayBuffer();
          const coverBytes = coverParts ? _base64ToBytes(coverParts.base64) : null;
          const id3 = buildId3v2(meta, coverBytes, coverParts ? coverParts.mime : null);
          blob = new Blob([id3, mp3Ab], { type: "audio/mpeg" });
          setProg(1);
        } else {
          // lamejs not loaded: fall back to WAV
          setLabel("lamejs unavailable — saving WAV…");
          blob = audioBufferToWav(rendered, meta);
          setExt("wav");
        }
      } else {
        const wavBlob = audioBufferToWav(rendered, meta); // WAV tags via RIFF INFO chunk
        if (ffmpegProcess) {
          setLabel("Processing audio via ffmpeg…"); setProg(0.84);
          const wavAb = await wavBlob.arrayBuffer();
          const processed = await window.electronAPI.processAudio(wavAb, audioProcessOpts);
          blob = new Blob([processed], { type: "audio/wav" });
        } else {
          blob = wavBlob;
        }
        setExt("wav");
      }

      setUrl(URL.createObjectURL(blob));
      setAudioBlob(blob);
      if (!exportNotice && forceLocalRender) {
        setExportNotice({
          type: "fallback",
          text: "This file was rendered with Web Audio fallback.",
        });
      }
      setStage("done");
    } catch (err) {
      console.error("Export failed:", err);
      setErrorMsg(err && err.message ? err.message : String(err || "Unknown export error"));
      setStage("error");
    }
  };

  const baseName = safeExportFileBase(projectName);
  const fileName = baseName + (format === "mp3" ? ".mp3" : ".wav");
  const tempoRate = DAW && DAW._projectRate ? DAW._projectRate() : 1;
  const tempoChanged = Math.abs(tempoRate - 1) > 0.001;
  const exportDuration = tempoChanged ? DAW.duration / tempoRate : DAW.duration;
  const variBpmEnabled = !!(window.DAW && window.DAW.tempo && window.DAW.tempo.variBpm);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(8,6,4,.6)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center" }} onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: stage === "settings" ? 720 : 460, background: "var(--bg)", border: "1px solid var(--line-strong)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="download" size={18} style={{ color: "var(--amber)" }} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>Export mixdown</span>
          <div style={{ flex: 1 }} />
          <button className="iconbtn" onClick={onClose}><Icon name="scissors" size={0} /><span style={{ fontSize: 18 }}>×</span></button>
        </div>

        {stage === "settings" && (
          <div style={{ padding: 20, maxHeight: "76vh", overflowY: "auto" }}>
            <input ref={coverFileRef} type="file" accept="image/*" onChange={onCoverFile} style={{ display: "none" }} />
            <div style={{ display: "flex", gap: 20, alignItems: "stretch" }}>
              {/* ---- left: export settings ---- */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ marginBottom: 2, fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>Export</div>
                <Row label="File name"><span className="mono" style={{ fontSize: 12, color: "var(--cream-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>{fileName}</span></Row>
                <Row label="Format"><Seg small value={format} onChange={setFormat} options={[{ v: "mp3", l: "MP3" }, { v: "wav", l: "WAV" }]} /></Row>
                <Row label="Bitrate"><Seg small value={bitrate} onChange={setBitrate} options={[{ v: 192, l: "192" }, { v: 256, l: "256" }, { v: 320, l: "320" }]} /></Row>
                <Row label="Sample rate"><Seg small value={sr} onChange={setSr} options={[{ v: 44100, l: "44.1k" }, { v: 48000, l: "48k" }]} /></Row>
                <Row label="Normalize">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {normalize && window.electronAPI && window.electronAPI.processAudio && (
                      <select value={lufsTarget} onChange={(e) => setLufsTarget(parseFloat(e.target.value))}
                        title="Integrated loudness target (LUFS)"
                        style={{ height: 24, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 7, color: "var(--cream)", fontSize: 11, padding: "0 6px", maxWidth: 150 }}>
                        <option value={-9}>−9 LUFS · loud master</option>
                        <option value={-12}>−12 LUFS · loud</option>
                        <option value={-14}>−14 LUFS · streaming</option>
                        <option value={-16}>−16 LUFS · podcast</option>
                        <option value={-23}>−23 LUFS · broadcast</option>
                      </select>
                    )}
                    <button onClick={() => setNormalize(!normalize)} title={(window.electronAPI && window.electronAPI.processAudio) ? `Normalize loudness to ${lufsTarget} LUFS (true peak −1 dBTP)` : "Soft-limit peaks (browser fallback)"} style={{ width: 40, height: 22, borderRadius: 12, background: normalize ? "var(--amber)" : "var(--surface3)", position: "relative", transition: ".15s", flexShrink: 0 }}><span style={{ position: "absolute", top: 2, left: normalize ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#241a0a", transition: ".15s" }} /></button>
                  </div>
                </Row>
                <Row label="Keep pitch"><button onClick={() => setPreservePitch(!preservePitch)} disabled={!variBpmEnabled} title={variBpmEnabled ? "Export tempo changes without changing pitch" : "Enable Vari BPM first"} style={{ width: 40, height: 22, borderRadius: 12, background: preservePitch && variBpmEnabled ? "var(--amber)" : "var(--surface3)", position: "relative", transition: ".15s", opacity: variBpmEnabled ? 1 : 0.45 }}><span style={{ position: "absolute", top: 2, left: preservePitch && variBpmEnabled ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#241a0a", transition: ".15s" }} /></button></Row>
                <div style={{ marginTop: 12, padding: "10px 12px", background: "rgba(232,176,75,.06)", borderRadius: 9, fontSize: 11, color: "var(--dim)", lineHeight: 1.5 }}>
                  All unmuted tracks with FX, automation, master EQ &amp; fades. Length {fmtTime(exportDuration)}.
                  {normalize && window.electronAPI && window.electronAPI.processAudio ? ` Loudness normalized to ${lufsTarget} LUFS.` : ""}
                  {preservePitch && variBpmEnabled && tempoChanged ? " Keep pitch uses the stable desktop time-stretch path after mix render." : ""}
                </div>
              </div>

              {/* ---- vertical divider ---- */}
              <div style={{ width: 1, background: "var(--line-strong)", alignSelf: "stretch" }} />

              {/* ---- right: audio info / metadata ---- */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ marginBottom: 2, fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>Audio info (tags)</div>
                <Row label="Title"><MetaInput value={title} onChange={setTitle} placeholder="Track title" /></Row>
                <Row label="Artist / Composer"><MetaInput value={artist} onChange={setArtist} placeholder="unknown" /></Row>
                <Row label="Album"><MetaInput value={album} onChange={setAlbum} placeholder="Album title" /></Row>
                <Row label="Year"><MetaInput value={year} onChange={setYear} placeholder={_curYear} /></Row>
                <Row label="Date"><MetaInput value={mdate} onChange={setMdate} placeholder={_curDate} /></Row>
                <Row label={artEnabled ? "Album art" : "Album art (MP3 only)"}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {cover && artEnabled && <img src={cover.dataUrl} alt="cover" style={{ width: 30, height: 30, borderRadius: 5, objectFit: "cover", border: "1px solid var(--line)" }} />}
                    <select value={cover ? cover.key : "none"} disabled={!artEnabled} onChange={onCoverSelect}
                      style={{ height: 28, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 7, color: "var(--cream)", fontSize: 11.5, padding: "0 6px", maxWidth: 150, opacity: artEnabled ? 1 : 0.4 }}>
                      <option value="none">None</option>
                      <optgroup label="Presets">
                        {presets.map((p, i) => <option key={i} value={"preset:" + i}>{p.name}</option>)}
                      </optgroup>
                      {cover && cover.key === "custom" && <option value="custom">{cover.name}</option>}
                      <option value="file">Choose file…</option>
                    </select>
                  </div>
                </Row>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button className="btn" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
              <button className="btn primary" onClick={render} style={{ flex: 2 }}><Icon name="disc" size={15} /> Render</button>
            </div>
          </div>
        )}

        {stage === "rendering" && (
          <div style={{ padding: "34px 24px", textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 13, color: "var(--cream-2)", marginBottom: 16 }}>
              <span style={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid var(--line-strong)", borderTopColor: "var(--amber)", animation: "spin .8s linear infinite", flex: "0 0 auto" }} />
              {stepLabel} <span className="mono" style={{ color: "var(--amber)" }}>{Math.round(prog * 100)}%</span>
              <span className="rec-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--amber)", flex: "0 0 auto" }} />
            </div>
            <div style={{ height: 8, background: "var(--surface)", borderRadius: 5, overflow: "hidden" }}>
              <div style={{ height: "100%", width: prog * 100 + "%", background: "linear-gradient(90deg,var(--amber-deep),var(--amber))", borderRadius: 5, transition: "width .12s" }} />
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 14 }}>
              offline render · {sr / 1000}kHz{format === "mp3" ? ` · ${bitrate}kbps MP3` : " · WAV"}{preservePitch && variBpmEnabled && tempoChanged ? " · keep pitch" : ""}
            </div>
          </div>
        )}

        {stage === "error" && (
          <div style={{ padding: "30px 24px", textAlign: "center" }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(217,106,78,.14)", color: "var(--red)", display: "grid", placeItems: "center", margin: "0 auto 14px", fontWeight: 700, fontSize: 24 }}>!</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Export failed</div>
            <div style={{ margin: "8px auto 18px", maxHeight: 96, overflow: "auto", fontSize: 11.5, color: "var(--dim)", lineHeight: 1.45, wordBreak: "break-word" }}>{errorMsg}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" onClick={() => setStage("settings")} style={{ flex: 1 }}>Back</button>
              <button className="btn primary" onClick={render} style={{ flex: 1 }}><Icon name="disc" size={15} /> Retry</button>
            </div>
          </div>
        )}

        {stage === "done" && (
          <div style={{ padding: "30px 24px", textAlign: "center" }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--amber-soft)", color: "var(--amber)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}><Icon name="check" size={26} /></div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Mixdown ready</div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--muted)", margin: "6px 0 18px" }}>{fileName} · {fmtTime(exportDuration)} · {sr / 1000}kHz · {ext.toUpperCase()}{preservePitch && variBpmEnabled && tempoChanged ? " · keep pitch" : ""}</div>
            {exportNotice && (
              <div style={{
                margin: "0 auto 16px",
                maxWidth: 420,
                padding: "9px 11px",
                border: "1px solid rgba(232,176,75,.45)",
                background: "rgba(232,176,75,.10)",
                borderRadius: 7,
                color: "var(--cream)",
                fontSize: 12,
                lineHeight: 1.45,
                textAlign: "left"
              }}>
                <strong style={{ color: "var(--amber)" }}>Web Audio fallback used.</strong> {exportNotice.text}
              </div>
            )}
            {window.electronAPI ? (
              <button className="btn-save" disabled={saving} onClick={async () => {
                setSaving(true);
                if (audioBlob && audioBlob.isNative) {
                  const yr = String(year || "").trim();
                  const dt = String(mdate || "").trim();
                  let tagDate = dt;
                  if (/^\d{4}$/.test(yr)) tagDate = /^\d{4}-\d{2}-\d{2}/.test(dt) ? (yr + dt.slice(4)) : yr;
                  const meta = { title, artist, album, year: yr, date: tagDate };
                  const coverParts = cover ? _dataUrlParts(cover.dataUrl) : null;
                  const coverArg = coverParts ? { data: coverParts.base64, mime: coverParts.mime } : null;

                  const result = await window.electronAPI.saveNativeAudio(
                    audioBlob.tempFilePath,
                    format,
                    { bitrate, sampleRate: sr, meta, cover: coverArg },
                    fileName
                  );
                  setSaving(false);
                  if (result && result.saved) onClose();
                } else {
                  const ab = await audioBlob.arrayBuffer();
                  const result = await window.electronAPI.saveAudio(ab, fileName);
                  setSaving(false);
                  if (result && result.saved) onClose();
                }
              }}><Icon name="download" size={18} /> {saving ? "Saving…" : "Save file"}</button>
            ) : (
              <>
                <a className="btn-save" href={url} download={fileName}><Icon name="download" size={18} /> Save file</a>
                {format === "mp3" && (
                  <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 12, lineHeight: 1.5 }}>Browser build encodes MP3 via lamejs with ID3v2 tags &amp; cover art. The desktop build uses ffmpeg.</div>
                )}
              </>
            )}
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
function MetaInput({ value, onChange, placeholder, disabled }) {
  return <input value={value} placeholder={placeholder} disabled={disabled}
    onChange={(e) => onChange(e.target.value)}
    style={{ width: 168, height: 28, padding: "0 9px", background: disabled ? "var(--surface)" : "var(--bg)",
      border: "1px solid var(--line)", borderRadius: 7, color: "var(--cream)", fontSize: 12,
      fontFamily: "var(--ui)", outline: "none", opacity: disabled ? 0.4 : 1 }} />;
}

/* ---------- settings dialog ---------- */
const THEMES = [
  {
    id: "default",
    name: "Warm Analog",
    desc: "espresso + amber · vintage console",
    bg: "#1b1712", bg2: "#221d17", surface: "#2a2520",
    accent: "#e8b04b", text: "#efe6d4", text2: "#b0a690",
    green: "#94c06a", red: "#d96a4e", blue: "#7fb0c4",
  },
  {
    id: "ivory",
    name: "Classical Ivory",
    desc: "warm paper · deep amber · bright & calm",
    bg: "#efe7d6", bg2: "#e7ddc8", surface: "#f8f3e8",
    accent: "#bf7f2e", text: "#3b3327", text2: "#6e6149",
    green: "#7c9a4f", red: "#c2593b", blue: "#5f86a6",
  },
  {
    id: "blue",
    name: "Modern Blue",
    desc: "deep navy · cool accent · bold & focused",
    bg: "#0e1b30", bg2: "#13243d", surface: "#1c3050",
    accent: "#5b9bd5", text: "#eaf1fb", text2: "#a7b8d0",
    green: "#3fb985", red: "#e8654a", blue: "#7fb9e8",
  },
  {
    id: "forest",
    name: "Forest Green",
    desc: "dark forest · vivid green · natural & deep",
    bg: "#0f1a13", bg2: "#162319", surface: "#1d3022",
    accent: "#5de87a", text: "#d8f0d0", text2: "#9ec49a",
    green: "#aae060", red: "#e06058", blue: "#60b8c8",
  },
  {
    id: "arctic",
    name: "Arctic Frost",
    desc: "deep ice · cyan glow · crisp & precise",
    bg: "#0b1326", bg2: "#131b2e", surface: "#171f33",
    accent: "#22d3ee", text: "#dbe2fd", text2: "#bbcabf",
    green: "#6ffbbe", red: "#ffb4ab", blue: "#95d3ba",
  },
  {
    id: "lime",
    name: "Neon Lime",
    desc: "black lime · high energy · electronic",
    bg: "#0c0e0a", bg2: "#151a11", surface: "#1a1e15",
    accent: "#a3e635", text: "#e4ead8", text2: "#c2c9b4",
    green: "#bef264", red: "#ffb4ab", blue: "#bacac3",
  },
  {
    id: "slate",
    name: "Minimal Slate",
    desc: "near black · quiet chrome · minimal",
    bg: "#020617", bg2: "#0f172a", surface: "#111827",
    accent: "#e2e8f0", text: "#f8fafc", text2: "#94a3b8",
    green: "#94a3b8", red: "#fca5a5", blue: "#cbd5e1",
  },
  {
    id: "sage",
    name: "Sage Mist",
    desc: "soft green · airy light · calm",
    bg: "#f7f9f8", bg2: "#eef4f1", surface: "#e7ece9",
    accent: "#236a56", text: "#191c1a", text2: "#3f4945",
    green: "#7abea7", red: "#ba1a1a", blue: "#4f7f93",
  },
  {
    id: "solar",
    name: "Solar Gold",
    desc: "warm black · golden pulse · confident",
    bg: "#1c1917", bg2: "#292524", surface: "#292524",
    accent: "#fbbf24", text: "#fef3c7", text2: "#d6d3d1",
    green: "#84cc16", red: "#f87171", blue: "#38bdf8",
  },
  {
    id: "navy",
    name: "Slate Navy",
    desc: "charcoal navy · cyan edge · technical",
    bg: "#0e1416", bg2: "#161d1e", surface: "#1a2122",
    accent: "#44d8f1", text: "#dde3e5", text2: "#bbc9cc",
    green: "#64d8a7", red: "#ffb4ab", blue: "#44d8f1",
  },
];

function ThemeSwatch({ theme, active, onClick }) {
  const t = theme;
  return (
    <div onClick={onClick} style={{
      display: "flex", flexDirection: "column", gap: 3, cursor: "pointer",
      width: "100%", maxWidth: 130, margin: "0 auto",
    }}>
      {/* scheme name on top */}
      <div style={{ fontSize: 12, fontWeight: 700, color: active ? "var(--accent)" : "var(--cream)", paddingLeft: 1, lineHeight: 1.2 }}>{t.name}</div>
      <div style={{
        borderRadius: 6, overflow: "hidden",
        border: `1.5px solid ${active ? t.accent : "transparent"}`,
        boxShadow: active ? `0 0 0 2px ${t.accent}44` : "0 1px 6px rgba(0,0,0,.35)",
        transition: ".15s", background: t.bg,
      }}>
        {/* mini menubar */}
        <div style={{ height: 11, background: t.bg2, display: "flex", alignItems: "center", gap: 3, padding: "0 4px", borderBottom: `1px solid ${t.text}18` }}>
          <div style={{ width: 4, height: 4, borderRadius: "50%", border: `1px solid ${t.accent}` }} />
          <span style={{ fontSize: 5, fontWeight: 700, color: t.accent, letterSpacing: ".06em" }}>PROJECT</span>
          <span style={{ fontSize: 5, color: t.text2 }}>Edit · View</span>
        </div>
        {/* mini tracks */}
        {[["Drums", t.accent, "62%"], ["Bass", t.blue, "44%"], ["Lead", t.green, "55%"]].map(([name, col, fill]) => (
          <div key={name} style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 4px", borderBottom: `1px solid ${t.text}10` }}>
            <div style={{ width: 2, height: 9, borderRadius: 2, background: col }} />
            <span style={{ fontSize: 6, fontWeight: 600, color: t.text, width: 17 }}>{name}</span>
            <div style={{ flex: 1, height: 2, background: t.surface, borderRadius: 2, position: "relative" }}>
              <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: fill, background: t.accent, borderRadius: 2 }} />
            </div>
          </div>
        ))}
        {/* palette bar */}
        <div style={{ display: "flex", height: 4 }}>
          {[t.bg, t.surface, t.text, t.accent, t.green, t.red, t.blue].map((c, i) => (
            <div key={i} style={{ flex: 1, background: c }} />
          ))}
        </div>
        {/* description */}
        <div style={{ padding: "4px 5px", background: t.bg2 }}>
          <div style={{ fontSize: 6, color: t.text2, lineHeight: 1.3 }}>{t.desc}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- audio output device section (Settings) ---------- */
// App-only output device selection. The list comes from the native (JUCE) engine —
// including "Windows Audio (Exclusive Mode)" for low latency — and the choice is
// pushed to both engines via DAW.setAudioDevice (bridge persists it in localStorage
// and re-applies it on every reconnect/restart).
function AudioDeviceSection() {
  const [devices, setDevices] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(() => (DAW.getSavedAudioDevice ? DAW.getSavedAudioDevice() : null));

  const isNative = !!DAW.isNative;

  const refresh = async () => {
    if (!DAW.requestAudioDevices) { setLoading(false); return; }
    setLoading(true);
    const list = await DAW.requestAudioDevices();
    setDevices(list);
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  // DirectSound is a legacy API that Windows emulates on top of the shared WASAPI
  // mixer anyway (an extra hop = more latency, no benefit), so hide it.
  const types = ((devices && devices.types) || []).filter((t) => !/directsound/i.test(t.type));
  const current = devices && devices.current;
  const savedValue = saved && (saved.type || saved.name) ? JSON.stringify([saved.type || "", saved.name || ""]) : "";
  const savedInList = !savedValue ||
    types.some((t) => t.type === (saved.type || "") && (t.devices || []).includes(saved.name || ""));

  const onChange = (e) => {
    const v = e.target.value;
    const [type, name] = v ? JSON.parse(v) : ["", ""];
    setSaved(v ? { type, name } : null);
    if (DAW.setAudioDevice) DAW.setAudioDevice(type, name);
    setTimeout(refresh, 800); // engine broadcasts the refreshed state after the switch
  };

  return (
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 18, marginTop: 22 }}>
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".06em", color: "var(--dim)", textTransform: "uppercase", marginBottom: 10 }}>■ Audio Output Device</div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, padding: "8px 0" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cream)" }}>Output Device</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
            App-only setting — the Windows default device is not changed. "Windows Audio (Exclusive Mode)" takes over the device for the lowest latency.
          </div>
          {current && (
            <div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 6 }}>
              Active: {current.name || "(system default)"} · {current.type} · {Math.round(current.sampleRate || 0)} Hz / {current.bufferSize || 0} samples
            </div>
          )}
          {!isNative && (
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
              Native audio engine not connected — the system default output is in use.
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <select value={savedValue} onChange={onChange} disabled={!isNative || loading}
            style={{ maxWidth: 300, height: 32, fontSize: 12.5, background: "var(--bg)", color: "var(--cream)", border: "1px solid var(--line-strong)", borderRadius: 7, padding: "0 8px" }}>
            <option value="">System Default</option>
            {!savedInList && savedValue && (
              <option value={savedValue}>{(saved.name || "?") + " (saved — not found)"}</option>
            )}
            {types.map((t) => (
              <optgroup key={t.type} label={t.type}>
                {(t.devices || []).map((name) => (
                  <option key={t.type + "|" + name} value={JSON.stringify([t.type, name])}>{name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <button className="btn" onClick={refresh} disabled={!isNative || loading}
            style={{ height: 32, fontSize: 12.5, padding: "0 12px", border: "1px solid var(--line-strong)" }}>
            {loading ? "…" : "Rescan"}
          </button>
        </div>
      </div>

      {/* driver-mode comparison guide */}
      <div style={{ marginTop: 12, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr style={{ background: "var(--bg)", color: "var(--dim)", textAlign: "left" }}>
              {["Mode", "Path", "Latency", "Other apps", "Notes"].map((h) => (
                <th key={h} style={{ padding: "7px 10px", fontWeight: 600, borderBottom: "1px solid var(--line)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody style={{ color: "var(--muted)" }}>
            {[
              ["Windows Audio (Exclusive Mode)", "App → device directly", "Lowest (a few ms)", "Muted", "Takes over the device; the app sets the sample rate"],
              ["Windows Audio (Low Latency Mode)", "App → Windows mixer (small buffer) → device", "Low (~3–10 ms)", "Audible", "Windows 10+; actual latency depends on the audio driver"],
              ["Windows Audio", "App → Windows mixer → device", "Normal (10–30 ms)", "Audible", "Most stable — recommended for everyday use"],
            ].map((row, i) => (
              <tr key={i} style={{ borderBottom: i < 2 ? "1px solid var(--line)" : "none" }}>
                {row.map((cell, j) => (
                  <td key={j} style={{ padding: "7px 10px", verticalAlign: "top", color: j === 0 ? "var(--cream)" : undefined, fontWeight: j === 0 ? 600 : 400 }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: "7px 10px", fontSize: 11, color: "var(--dim)", borderTop: "1px solid var(--line)", background: "var(--bg)" }}>
          Lower latency trades away stability — if you hear dropouts or crackles, switch back to Windows Audio (shared).
        </div>
      </div>
    </div>
  );
}

function DeviceSetupSection() {
  const [devices, setDevices] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(() => (DAW.getSavedAudioInput && DAW.getSavedAudioInput()) || {
    type: "", name: "", channel: 0, stereo: false, sampleRate: 0, bufferSize: 0,
  });
  const refresh = async () => {
    setLoading(true);
    setDevices(DAW.requestAudioDevices ? await DAW.requestAudioDevices() : null);
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);
  const types = ((devices && devices.types) || []).filter((t) =>
    !/directsound/i.test(t.type) && (t.inputDevices || []).length
  );
  const value = settings.name ? JSON.stringify([settings.type || "", settings.name]) : "";
  const apply = (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (DAW.setAudioInput) DAW.setAudioInput(next);
  };
  return (
    <section id="settings-device-setup" style={{ borderTop: "1px solid var(--line)", paddingTop: 18, marginTop: 22, scrollMarginTop: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".06em", color: "var(--dim)", textTransform: "uppercase", marginBottom: 10 }}>■ Audio Input Device</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 12 }}>Choose the input used by new Audio In tracks. This setting is stored for the app, not the project.</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(190px, 1fr) 120px 105px 110px", gap: 10 }}>
        <label style={{ fontSize: 11, color: "var(--dim)" }}>Audio Input
          <select value={value} disabled={!DAW.isNative || loading} onChange={(e) => {
            const [type, name] = e.target.value ? JSON.parse(e.target.value) : ["", ""];
            apply({ type, name });
          }} style={{ display: "block", width: "100%", height: 32, marginTop: 5, background: "var(--bg)", color: "var(--cream)", border: "1px solid var(--line-strong)", borderRadius: 7, padding: "0 8px" }}>
            <option value="">System Default Input</option>
            {types.map((t) => <optgroup key={t.type} label={t.type}>
              {t.inputDevices.map((name) => <option key={t.type + name} value={JSON.stringify([t.type, name])}>{name}</option>)}
            </optgroup>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: "var(--dim)" }}>Input Channel
          <select value={(settings.stereo ? "stereo:" : "mono:") + settings.channel} onChange={(e) => {
            const [mode, channel] = e.target.value.split(":"); apply({ stereo: mode === "stereo", channel: +channel });
          }} style={{ display: "block", width: "100%", height: 32, marginTop: 5, background: "var(--bg)", color: "var(--cream)", border: "1px solid var(--line-strong)", borderRadius: 7 }}>
            <option value="mono:0">Mono Input 1</option><option value="mono:1">Mono Input 2</option><option value="stereo:0">Stereo 1–2</option>
          </select>
        </label>
        <label style={{ fontSize: 11, color: "var(--dim)" }}>Sample Rate
          <select value={settings.sampleRate || 0} onChange={(e) => apply({ sampleRate: +e.target.value })}
            style={{ display: "block", width: "100%", height: 32, marginTop: 5, background: "var(--bg)", color: "var(--cream)", border: "1px solid var(--line-strong)", borderRadius: 7 }}>
            <option value="0">Default</option><option value="44100">44.1 kHz</option><option value="48000">48 kHz</option><option value="96000">96 kHz</option>
          </select>
        </label>
        <label style={{ fontSize: 11, color: "var(--dim)" }}>Buffer
          <select value={settings.bufferSize || 0} onChange={(e) => apply({ bufferSize: +e.target.value })}
            style={{ display: "block", width: "100%", height: 32, marginTop: 5, background: "var(--bg)", color: "var(--cream)", border: "1px solid var(--line-strong)", borderRadius: 7 }}>
            <option value="0">Device Default</option><option value="64">64 samples</option><option value="128">128 samples</option><option value="256">256 samples</option><option value="512">512 samples</option>
          </select>
        </label>
      </div>
      {!DAW.isNative && <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--red)" }}>Native audio engine not connected — recording is unavailable.</div>}
    </section>
  );
}

function SettingsDialog({ currentTheme, onThemeChange, onClose }) {
  const sections = [
    { id: "settings-color-theme", label: "Color Theme" },
    { id: "settings-mixer-console", label: "Mixer Console Window" },
    { id: "settings-device-setup", label: "Audio Input Device" },
    { id: "settings-audio-output", label: "Audio Output Device" },
  ];
  const [activeSection, setActiveSection] = useState(sections[0].id);
  const contentRef = useRef(null);

  const goToSection = (id) => {
    const section = document.getElementById(id);
    if (!section) return;
    setActiveSection(id);
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const updateActiveSection = () => {
    const content = contentRef.current;
    if (!content) return;
    if (content.scrollTop + content.clientHeight >= content.scrollHeight - 2) {
      setActiveSection(sections[sections.length - 1].id);
      return;
    }
    const contentTop = content.getBoundingClientRect().top;
    let current = sections[0].id;
    sections.forEach(({ id }) => {
      const section = document.getElementById(id);
      if (section && section.getBoundingClientRect().top - contentTop <= 48) current = id;
    });
    setActiveSection(current);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 800 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "var(--bg2)", border: "1px solid var(--line-strong)", borderRadius: 14, width: 940, maxWidth: "95vw", maxHeight: "92vh", boxShadow: "var(--shadow)", display: "flex", flexDirection: "column" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Settings</div>
          <button className="iconbtn" onClick={onClose} style={{ fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        {/* body: fixed table of contents + independently scrolling settings */}
        <div style={{ display: "flex", minHeight: 0, flex: 1 }}>
          <nav aria-label="Settings sections" style={{ width: 184, flexShrink: 0, padding: "20px 14px", borderRight: "1px solid var(--line)" }}>
            <div style={{ padding: "0 10px 9px", marginBottom: 5, borderBottom: "1px solid var(--line)", fontSize: 10.5, fontWeight: 700, letterSpacing: ".09em", color: "var(--dim)", textTransform: "uppercase" }}>Contents</div>
            {sections.map(({ id, label }) => {
              const active = activeSection === id;
              return (
                <button key={id} type="button" onClick={() => goToSection(id)} aria-current={active ? "location" : undefined}
                  style={{
                    width: "100%", padding: "9px 10px", border: 0, borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}`,
                    borderRadius: "0 6px 6px 0", background: active ? "var(--surface)" : "transparent",
                    color: active ? "var(--cream)" : "var(--muted)", fontSize: 12, fontWeight: active ? 650 : 500,
                    lineHeight: 1.3, textAlign: "left", cursor: "pointer",
                  }}>
                  {label}
                </button>
              );
            })}
          </nav>

          <div ref={contentRef} className="theme-scroll" onScroll={updateActiveSection}
            style={{ padding: "20px 22px 24px", overflowY: "auto", minWidth: 0, flex: 1 }}>
            <section id="settings-color-theme" style={{ scrollMarginTop: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".06em", color: "var(--dim)", textTransform: "uppercase", marginBottom: 14 }}>■ Color Theme</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 26 }}>
                {THEMES.map(t => (
                  <ThemeSwatch key={t.id} theme={t} active={currentTheme === t.id} onClick={() => onThemeChange(t.id)} />
                ))}
              </div>
            </section>

            <section id="settings-mixer-console" style={{ borderTop: "1px solid var(--line)", paddingTop: 18, scrollMarginTop: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".06em", color: "var(--dim)", textTransform: "uppercase", marginBottom: 10 }}>■ Mixer Console Window</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cream)" }}>Reset Window Bounds</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>Restore the Mixer window size and screen coordinates to their default settings.</div>
                </div>
                <button className="btn" onClick={() => {
                  localStorage.removeItem("focusdaw-mixer-bounds");
                  if (window.electronAPI && window.electronAPI.resetMixerBounds) {
                    window.electronAPI.resetMixerBounds();
                  } else if (window.mixerPopup && !window.mixerPopup.closed) {
                    window.mixerPopup.close();
                  }
                  alert("Mixer window position and size have been reset.");
                }} style={{ height: 32, fontSize: 12.5, padding: "0 14px", border: "1px solid var(--line-strong)" }}>Reset Position</button>
              </div>
            </section>

            <DeviceSetupSection />

            <div id="settings-audio-output" style={{ scrollMarginTop: 20 }}>
              <AudioDeviceSection />
            </div>
          </div>
        </div>

        <div style={{ padding: "12px 22px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end" }}>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LoaderScreen, ExportDialog, SettingsDialog, Logo, audioBufferToWav });
