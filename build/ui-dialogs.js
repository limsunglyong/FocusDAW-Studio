function Logo({ size = 30, style }) {
  return /* @__PURE__ */ React.createElement(
    "img",
    {
      src: "assets/logo.png",
      width: size,
      height: size,
      style: { borderRadius: Math.round(size * 0.22), display: "block", objectFit: "cover", ...style },
      alt: "FocusDAW Studio"
    }
  );
}
function LoaderScreen({ onOpen }) {
  const [name, setName] = useState("Midnight Drive \u2014 Stems");
  const [stems, setStems] = useState(() => DAW.tracks.map((t) => ({ id: t.id, name: t.name, type: t.type, dur: t.buffer.duration, on: true, demo: true })));
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  useTick();
  const addFiles = async (files) => {
    setBusy(true);
    for (const f of files) {
      if (!/\.(mp3|wav|aiff?|m4a|ogg|flac)$/i.test(f.name)) continue;
      try {
        const t = await DAW.addFile(f);
        setStems((s) => [...s, { id: t.id, name: t.name, type: "audio", dur: t.buffer.duration, on: true }]);
      } catch (e) {
      }
    }
    setBusy(false);
  };
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    addFiles([...e.dataTransfer.files]);
  };
  const pick = (e) => addFiles([...e.target.files]);
  const toggle = (id) => setStems((s) => s.map((x) => x.id === id ? { ...x, on: !x.on } : x));
  const enabled = stems.filter((s) => s.on);
  const open = () => {
    stems.filter((s) => !s.on).forEach((s) => {
      const i = DAW.tracks.findIndex((t) => t.id === s.id);
      if (i >= 0) DAW.tracks.splice(i, 1);
    });
    onOpen(name);
  };
  return /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "flex", overflow: "hidden", background: "radial-gradient(120% 80% at 80% -10%,rgba(232,176,75,.10),transparent 60%),var(--bg)" } }, /* @__PURE__ */ React.createElement("div", { style: {
    width: 320,
    flex: "0 0 320px",
    borderRight: "1px solid var(--line)",
    padding: "44px 36px",
    display: "flex",
    flexDirection: "column",
    background: "linear-gradient(180deg,rgba(255,255,255,.015),transparent)"
  } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 14 } }, /* @__PURE__ */ React.createElement(Logo, { size: 72 }), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 20, fontWeight: 700, letterSpacing: "-.01em" } }, "FocusDAW"), /* @__PURE__ */ React.createElement("div", { className: "mono", style: { fontSize: 10, color: "var(--muted)", letterSpacing: ".12em" } }, "STEM STUDIO"))), /* @__PURE__ */ React.createElement("p", { style: { marginTop: 28, color: "var(--cream-2)", fontSize: 14, lineHeight: 1.6, maxWidth: 230 } }, "Load a song's separated stems, balance and shape them per section, and bounce a single master."), /* @__PURE__ */ React.createElement("div", { style: { marginTop: "auto", display: "flex", flexDirection: "column", gap: 12 } }, ["Bulk-register a stem folder", "Per-track panning \xB7 reverb \xB7 echo", "Volume automation overlay", "Master EQ + fade \xB7 MP3 bounce"].map((f) => /* @__PURE__ */ React.createElement("div", { key: f, style: { display: "flex", gap: 9, alignItems: "center", fontSize: 12.5, color: "var(--dim)" } }, /* @__PURE__ */ React.createElement("span", { style: { width: 16, height: 16, borderRadius: 5, background: "var(--amber-soft)", color: "var(--amber)", display: "grid", placeItems: "center" } }, /* @__PURE__ */ React.createElement(Icon, { name: "check", size: 11 })), f)), /* @__PURE__ */ React.createElement("div", { className: "mono", style: { fontSize: 10, color: "var(--faint)", marginTop: 14 } }, "v", window.APP_VERSION || "0.0.0", " \xB7 Electron \xB7 macOS / Win / Linux"))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, padding: "40px 48px", overflowY: "auto" } }, /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 620 } }, /* @__PURE__ */ React.createElement("div", { className: "chip", style: { color: "var(--amber)", background: "var(--amber-soft)" } }, "New Project"), /* @__PURE__ */ React.createElement("h1", { style: { fontSize: 26, fontWeight: 700, margin: "14px 0 24px", letterSpacing: "-.02em" } }, "Set up your session"), /* @__PURE__ */ React.createElement("label", { style: { fontSize: 11, fontWeight: 600, letterSpacing: ".06em", color: "var(--muted)", textTransform: "uppercase" } }, "Project name"), /* @__PURE__ */ React.createElement("input", { value: name, onChange: (e) => setName(e.target.value), style: {
    width: "100%",
    marginTop: 7,
    marginBottom: 22,
    height: 42,
    padding: "0 14px",
    background: "var(--surface)",
    border: "1px solid var(--line-strong)",
    borderRadius: 9,
    color: "var(--cream)",
    fontSize: 15,
    fontFamily: "var(--ui)",
    outline: "none"
  } }), /* @__PURE__ */ React.createElement(
    "label",
    {
      onDragOver: (e) => {
        e.preventDefault();
        setDragOver(true);
      },
      onDragLeave: () => setDragOver(false),
      onDrop,
      style: {
        display: "block",
        border: `1.5px dashed ${dragOver ? "var(--amber)" : "var(--line-strong)"}`,
        borderRadius: 12,
        padding: "26px 20px",
        textAlign: "center",
        background: dragOver ? "var(--amber-soft)" : "rgba(255,255,255,.012)",
        cursor: "pointer",
        transition: ".15s"
      }
    },
    /* @__PURE__ */ React.createElement("input", { type: "file", multiple: true, accept: ".mp3,.wav,.aiff,.m4a,.ogg,.flac", onChange: pick, style: { display: "none" } }),
    /* @__PURE__ */ React.createElement(Icon, { name: "folder", size: 30, style: { color: "var(--amber)" } }),
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 600, marginTop: 8 } }, "Select a project folder, or drop stem files"),
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: "var(--muted)", marginTop: 4 } }, "Bulk-registers every .wav / .mp3 \u2014 one track per file. A ", /* @__PURE__ */ React.createElement("span", { className: "mono", style: { color: "var(--cream-2)" } }, ".focus"), " project file is created.")
  ), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 24, display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, fontWeight: 600, letterSpacing: ".06em", color: "var(--muted)", textTransform: "uppercase" } }, "Detected stems"), /* @__PURE__ */ React.createElement("span", { className: "chip" }, enabled.length, " of ", stems.length, " registered"), busy && /* @__PURE__ */ React.createElement("span", { className: "mono", style: { fontSize: 10, color: "var(--amber)" } }, "decoding\u2026"), /* @__PURE__ */ React.createElement("span", { className: "mono", style: { fontSize: 10, color: "var(--faint)", marginLeft: "auto" } }, "demo session preloaded")), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 10, border: "1px solid var(--line)", borderRadius: 11, overflow: "hidden" } }, stems.map((s, i) => /* @__PURE__ */ React.createElement("div", { key: s.id, onClick: () => toggle(s.id), style: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "11px 14px",
    cursor: "pointer",
    borderBottom: i < stems.length - 1 ? "1px solid var(--line)" : "none",
    background: s.on ? "transparent" : "rgba(0,0,0,.18)"
  } }, /* @__PURE__ */ React.createElement("span", { style: { width: 18, height: 18, borderRadius: 5, border: "1.5px solid " + (s.on ? "var(--amber)" : "var(--faint)"), background: s.on ? "var(--amber)" : "transparent", color: "#241a0a", display: "grid", placeItems: "center" } }, s.on && /* @__PURE__ */ React.createElement(Icon, { name: "check", size: 12 })), /* @__PURE__ */ React.createElement(Icon, { name: "wave", size: 15, style: { color: s.on ? "var(--amber)" : "var(--faint)" } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13.5, fontWeight: 500, opacity: s.on ? 1 : 0.5 } }, s.name), /* @__PURE__ */ React.createElement("span", { className: "chip", style: { fontSize: 9 } }, s.demo ? "synth" : "wav"), /* @__PURE__ */ React.createElement("span", { className: "mono", style: { fontSize: 10.5, color: "var(--muted)", marginLeft: "auto" } }, fmtTime(s.dur))))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, marginTop: 26 } }, /* @__PURE__ */ React.createElement("button", { className: "btn primary", onClick: open, disabled: !enabled.length, style: { height: 44, padding: "0 22px", opacity: enabled.length ? 1 : 0.5 } }, /* @__PURE__ */ React.createElement(Icon, { name: "disc", size: 16 }), " Create Project & Open Studio"), /* @__PURE__ */ React.createElement("span", { className: "mono", style: { fontSize: 10.5, color: "var(--faint)" } }, enabled.length, " tracks \xB7 120 BPM \xB7 ", fmtTime(DAW.duration))))));
}
async function audioBufferToMp3(audioBuf, bitrate, onProgress) {
  const lame = window.lamejs;
  if (!lame) throw new Error("lamejs not loaded");
  const numCh = Math.min(2, audioBuf.numberOfChannels);
  const sr = audioBuf.sampleRate;
  const enc = new lame.Mp3Encoder(numCh, sr, bitrate);
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
    if (i % (block * 64) === 0) await new Promise((r) => setTimeout(r, 0));
  }
  const end = enc.flush();
  if (end.length) chunks.push(new Uint8Array(end));
  if (onProgress) onProgress(1);
  return new Blob(chunks, { type: "audio/mpeg" });
}
function buildWavInfoChunk(meta) {
  if (!meta) return null;
  const fields = [
    ["INAM", meta.title],
    // title
    ["IART", meta.artist],
    // artist / composer
    ["IPRD", meta.album],
    // album (product)
    ["ICRD", meta.date || meta.year],
    // creation date
    ["ISFT", "FocusDAW Studio"]
    // software
  ].filter(([, v]) => v != null && String(v).length);
  if (!fields.length) return null;
  const enc = new TextEncoder();
  const subs = fields.map(([id, v]) => {
    let bytes = enc.encode(String(v) + "\0");
    if (bytes.length % 2) {
      const p = new Uint8Array(bytes.length + 1);
      p.set(bytes);
      bytes = p;
    }
    return { id, bytes };
  });
  let body = 4;
  subs.forEach((s) => {
    body += 8 + s.bytes.length;
  });
  const out = new Uint8Array(8 + body);
  const dv = new DataView(out.buffer);
  const tag = (o2, t) => {
    for (let i = 0; i < 4; i++) out[o2 + i] = t.charCodeAt(i);
  };
  tag(0, "LIST");
  dv.setUint32(4, body, true);
  tag(8, "INFO");
  let o = 12;
  subs.forEach((s) => {
    tag(o, s.id);
    dv.setUint32(o + 4, s.bytes.length, true);
    out.set(s.bytes, o + 8);
    o += 8 + s.bytes.length;
  });
  return out;
}
function audioBufferToWav(buf, meta) {
  const numCh = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length * numCh * 2;
  const info = buildWavInfoChunk(meta);
  const infoLen = info ? info.length : 0;
  const ab = new ArrayBuffer(44 + len + infoLen);
  const dv = new DataView(ab);
  const wr = (o, s) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  wr(0, "RIFF");
  dv.setUint32(4, 36 + len + infoLen, true);
  wr(8, "WAVE");
  wr(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, numCh, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * numCh * 2, true);
  dv.setUint16(32, numCh * 2, true);
  dv.setUint16(34, 16, true);
  wr(36, "data");
  dv.setUint32(40, len, true);
  let off = 44;
  const chs = [];
  for (let c = 0; c < numCh; c++) chs.push(buf.getChannelData(c));
  for (let i = 0; i < buf.length; i++) for (let c = 0; c < numCh; c++) {
    let s = Math.max(-1, Math.min(1, chs[c][i]));
    dv.setInt16(off, s < 0 ? s * 32768 : s * 32767, true);
    off += 2;
  }
  if (info) new Uint8Array(ab).set(info, 44 + len);
  return new Blob([ab], { type: "audio/wav" });
}
function _dataUrlParts(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  return m ? { mime: m[1], base64: m[2] } : null;
}
function _base64ToBytes(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function _id3Uint32(n) {
  return [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
}
function _id3Synchsafe(n) {
  return [n >> 21 & 127, n >> 14 & 127, n >> 7 & 127, n & 127];
}
function _id3Frame(id, dataArr) {
  const frame = new Uint8Array(10 + dataArr.length);
  for (let i = 0; i < 4; i++) frame[i] = id.charCodeAt(i);
  const sz = _id3Uint32(dataArr.length);
  frame[4] = sz[0];
  frame[5] = sz[1];
  frame[6] = sz[2];
  frame[7] = sz[3];
  frame.set(dataArr, 10);
  return frame;
}
function _id3TextFrame(id, value) {
  if (value == null || !String(value).length) return null;
  const str = String(value);
  const data = new Uint8Array(1 + 2 + str.length * 2 + 2);
  data[0] = 1;
  data[1] = 255;
  data[2] = 254;
  let o = 3;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    data[o++] = c & 255;
    data[o++] = c >> 8 & 255;
  }
  return _id3Frame(id, data);
}
function _id3ApicFrame(mime, bytes) {
  if (!bytes || !bytes.length) return null;
  const head = [0];
  for (let i = 0; i < mime.length; i++) head.push(mime.charCodeAt(i) & 255);
  head.push(0, 3, 0);
  const data = new Uint8Array(head.length + bytes.length);
  data.set(head, 0);
  data.set(bytes, head.length);
  return _id3Frame("APIC", data);
}
function buildId3v2(meta, coverBytes, coverMime) {
  const frames = [];
  const add = (f) => {
    if (f) frames.push(f);
  };
  add(_id3TextFrame("TIT2", meta.title));
  add(_id3TextFrame("TPE1", meta.artist));
  add(_id3TextFrame("TCOM", meta.artist));
  add(_id3TextFrame("TALB", meta.album));
  const ym = String(meta.date || meta.year || "").match(/^(\d{4})(?:-(\d{2})-(\d{2}))?/);
  if (ym) {
    add(_id3TextFrame("TYER", ym[1]));
    if (ym[2] && ym[3]) add(_id3TextFrame("TDAT", ym[3] + ym[2]));
  }
  if (coverBytes) add(_id3ApicFrame(coverMime || "image/jpeg", coverBytes));
  let total = 0;
  frames.forEach((f) => {
    total += f.length;
  });
  const ss = _id3Synchsafe(total);
  const out = new Uint8Array(10 + total);
  out[0] = 73;
  out[1] = 68;
  out[2] = 51;
  out[3] = 3;
  out[4] = 0;
  out[5] = 0;
  out[6] = ss[0];
  out[7] = ss[1];
  out[8] = ss[2];
  out[9] = ss[3];
  let o = 10;
  frames.forEach((f) => {
    out.set(f, o);
    o += f.length;
  });
  return out;
}
function makePresetCovers() {
  const defs = [
    { name: "Amber Glow", a: "#e8b04b", b: "#5a2c0c" },
    { name: "Indigo Night", a: "#5b9bd5", b: "#0e1b30" },
    { name: "Forest", a: "#5de87a", b: "#0f1a13" },
    { name: "Monochrome", a: "#d8d8d8", b: "#1a1a1a" }
  ];
  return defs.map((d) => {
    const cv = document.createElement("canvas");
    cv.width = 600;
    cv.height = 600;
    const g = cv.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 600, 600);
    grad.addColorStop(0, d.a);
    grad.addColorStop(1, d.b);
    g.fillStyle = grad;
    g.fillRect(0, 0, 600, 600);
    g.strokeStyle = "rgba(255,255,255,0.10)";
    g.lineWidth = 2;
    for (let r = 60; r < 420; r += 60) {
      g.beginPath();
      g.arc(300, 300, r, 0, Math.PI * 2);
      g.stroke();
    }
    return { name: d.name, dataUrl: cv.toDataURL("image/jpeg", 0.9) };
  });
}
function safeExportFileBase(name) {
  const cleaned = String(name || "untitled").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[.\s]+$/g, "");
  return cleaned || "untitled";
}
function ExportDialog({ projectName, onClose }) {
  const [format, setFormat] = useState("mp3");
  const [bitrate, setBitrate] = useState(320);
  const [sr, setSr] = useState(44100);
  const [normalize, setNormalize] = useState(() => localStorage.getItem("focusdaw-export-normalize") === "1");
  const [lufsTarget, setLufsTarget] = useState(() => {
    const v = parseFloat(localStorage.getItem("focusdaw-export-lufs"));
    return Number.isFinite(v) ? v : -14;
  });
  useEffect(() => {
    try {
      localStorage.setItem("focusdaw-export-normalize", normalize ? "1" : "0");
    } catch (e) {
    }
  }, [normalize]);
  useEffect(() => {
    try {
      localStorage.setItem("focusdaw-export-lufs", String(lufsTarget));
    } catch (e) {
    }
  }, [lufsTarget]);
  const [preservePitch, setPreservePitch] = useState(() => {
    const d = window.DAW;
    return !!(d && d.tempo && d.tempo.variBpm);
  });
  const [stage, setStage] = useState("settings");
  const [prog, setProg] = useState(0);
  const [stepLabel, setLabel] = useState("Rendering mix\u2026");
  const [url, setUrl] = useState(null);
  const [ext, setExt] = useState("mp3");
  const [audioBlob, setAudioBlob] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [exportNotice, setExportNotice] = useState(null);
  const _now = /* @__PURE__ */ new Date();
  const _curYear = String(_now.getFullYear());
  const _curDate = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-${String(_now.getDate()).padStart(2, "0")}`;
  const _projTitle = projectName || "untitled";
  const [title, setTitle] = useState(_projTitle);
  const [artist, setArtist] = useState("unknown");
  const [album, setAlbum] = useState(_projTitle);
  const [year, setYear] = useState(_curYear);
  const [mdate, setMdate] = useState(_curDate);
  const [cover, setCover] = useState(null);
  const [presets] = useState(makePresetCovers);
  const coverFileRef = useRef(null);
  const artEnabled = format === "mp3";
  const onCoverSelect = (e) => {
    const v = e.target.value;
    if (v === "none") {
      setCover(null);
      return;
    }
    if (v === "file") {
      if (coverFileRef.current) coverFileRef.current.click();
      return;
    }
    if (v.startsWith("preset:")) {
      const i = +v.slice(7);
      const p = presets[i];
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
    e.target.value = "";
  };
  const render = async () => {
    try {
      setErrorMsg("");
      setExportNotice(null);
      setStage("rendering");
      setProg(0);
      setLabel("Rendering mix\u2026");
      let forceLocalRender = false;
      if (DAW && DAW.isNative) {
        try {
          const nativeResult = await DAW.renderMix((p) => setProg(p), {
            format,
            bitrate,
            sampleRate: sr,
            normalize,
            lufsTarget,
            preservePitch
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
              tempFilePath: nativeResult.tempFilePath
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
            text: "Native export failed or produced silence. This file was rendered with Web Audio fallback."
          });
          setProg(0);
          setLabel("Native export unavailable - rendering with Web Audio...");
        }
      }
      const ratio = format === "mp3" ? 0.75 : 1;
      const tempoRate2 = DAW && DAW._projectRate ? DAW._projectRate() : 1;
      const tempoChanged2 = Math.abs(tempoRate2 - 1) > 1e-3;
      const nativeAudio = !!(window.electronAPI && window.electronAPI.processAudio);
      const nativeKeepPitch = nativeAudio && preservePitch && tempoChanged2;
      const nativeLoudnorm = nativeAudio && normalize;
      const ffmpegProcess = nativeKeepPitch || nativeLoudnorm;
      const rendered = await DAW.renderMix((p) => setProg(p * ratio), {
        // Skip the in-graph clipper when ffmpeg loudnorm will normalize loudness/true-peak.
        normalize: normalize && !nativeLoudnorm,
        sampleRate: sr,
        preservePitch: preservePitch && !nativeKeepPitch,
        applyTempo: !nativeKeepPitch,
        forceLocal: forceLocalRender
      });
      const audioProcessOpts = {
        rate: nativeKeepPitch ? tempoRate2 : 1,
        sampleRate: sr,
        loudnorm: nativeLoudnorm ? { I: lufsTarget, TP: -1, LRA: 11 } : null
      };
      const yr = String(year || "").trim();
      const dt = String(mdate || "").trim();
      let tagDate = dt;
      if (/^\d{4}$/.test(yr)) tagDate = /^\d{4}-\d{2}-\d{2}/.test(dt) ? yr + dt.slice(4) : yr;
      const meta = { title, artist, album, year: yr, date: tagDate };
      const coverParts = cover ? _dataUrlParts(cover.dataUrl) : null;
      let blob;
      if (format === "mp3") {
        if (window.electronAPI && window.electronAPI.encodeMp3) {
          setLabel(ffmpegProcess ? "Processing audio via ffmpeg\u2026" : "Encoding MP3 via ffmpeg\u2026");
          setProg(0.78);
          const wavBlob = audioBufferToWav(rendered);
          let wavAb = await wavBlob.arrayBuffer();
          if (ffmpegProcess) {
            wavAb = await window.electronAPI.processAudio(wavAb, audioProcessOpts);
            setLabel("Encoding MP3 via ffmpeg\u2026");
            setProg(0.84);
          }
          const coverArg = coverParts ? { data: coverParts.base64, mime: coverParts.mime } : null;
          const mp3Ab = await window.electronAPI.encodeMp3(wavAb, { bitrate, sampleRate: sr, meta, cover: coverArg });
          blob = new Blob([mp3Ab], { type: "audio/mpeg" });
          setProg(1);
        } else if (window.lamejs) {
          setLabel("Encoding MP3\u2026");
          const mp3Blob = await audioBufferToMp3(rendered, bitrate, (p) => setProg(0.75 + p * 0.22));
          const mp3Ab = await mp3Blob.arrayBuffer();
          const coverBytes = coverParts ? _base64ToBytes(coverParts.base64) : null;
          const id3 = buildId3v2(meta, coverBytes, coverParts ? coverParts.mime : null);
          blob = new Blob([id3, mp3Ab], { type: "audio/mpeg" });
          setProg(1);
        } else {
          setLabel("lamejs unavailable \u2014 saving WAV\u2026");
          blob = audioBufferToWav(rendered, meta);
          setExt("wav");
        }
      } else {
        const wavBlob = audioBufferToWav(rendered, meta);
        if (ffmpegProcess) {
          setLabel("Processing audio via ffmpeg\u2026");
          setProg(0.84);
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
          text: "This file was rendered with Web Audio fallback."
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
  const tempoChanged = Math.abs(tempoRate - 1) > 1e-3;
  const exportDuration = tempoChanged ? DAW.duration / tempoRate : DAW.duration;
  const variBpmEnabled = !!(window.DAW && window.DAW.tempo && window.DAW.tempo.variBpm);
  return /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", inset: 0, zIndex: 1100, background: "rgba(8,6,4,.6)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center" }, onMouseDown: onClose }, /* @__PURE__ */ React.createElement("div", { onMouseDown: (e) => e.stopPropagation(), style: { width: stage === "settings" ? 720 : 460, background: "var(--bg)", border: "1px solid var(--line-strong)", borderRadius: 14, boxShadow: "var(--shadow)", overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement(Icon, { name: "download", size: 18, style: { color: "var(--amber)" } }), /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 600, fontSize: 15 } }, "Export mixdown"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }), /* @__PURE__ */ React.createElement("button", { className: "iconbtn", onClick: onClose }, /* @__PURE__ */ React.createElement(Icon, { name: "scissors", size: 0 }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 18 } }, "\xD7"))), stage === "settings" && /* @__PURE__ */ React.createElement("div", { style: { padding: 20, maxHeight: "76vh", overflowY: "auto" } }, /* @__PURE__ */ React.createElement("input", { ref: coverFileRef, type: "file", accept: "image/*", onChange: onCoverFile, style: { display: "none" } }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 20, alignItems: "stretch" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 2, fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" } }, "Export"), /* @__PURE__ */ React.createElement(Row, { label: "File name" }, /* @__PURE__ */ React.createElement("span", { className: "mono", style: { fontSize: 12, color: "var(--cream-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 } }, fileName)), /* @__PURE__ */ React.createElement(Row, { label: "Format" }, /* @__PURE__ */ React.createElement(Seg, { small: true, value: format, onChange: setFormat, options: [{ v: "mp3", l: "MP3" }, { v: "wav", l: "WAV" }] })), /* @__PURE__ */ React.createElement(Row, { label: "Bitrate" }, /* @__PURE__ */ React.createElement(Seg, { small: true, value: bitrate, onChange: setBitrate, options: [{ v: 192, l: "192" }, { v: 256, l: "256" }, { v: 320, l: "320" }] })), /* @__PURE__ */ React.createElement(Row, { label: "Sample rate" }, /* @__PURE__ */ React.createElement(Seg, { small: true, value: sr, onChange: setSr, options: [{ v: 44100, l: "44.1k" }, { v: 48e3, l: "48k" }] })), /* @__PURE__ */ React.createElement(Row, { label: "Normalize" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, normalize && window.electronAPI && window.electronAPI.processAudio && /* @__PURE__ */ React.createElement(
    "select",
    {
      value: lufsTarget,
      onChange: (e) => setLufsTarget(parseFloat(e.target.value)),
      title: "Integrated loudness target (LUFS)",
      style: { height: 24, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 7, color: "var(--cream)", fontSize: 11, padding: "0 6px", maxWidth: 150 }
    },
    /* @__PURE__ */ React.createElement("option", { value: -9 }, "\u22129 LUFS \xB7 loud master"),
    /* @__PURE__ */ React.createElement("option", { value: -12 }, "\u221212 LUFS \xB7 loud"),
    /* @__PURE__ */ React.createElement("option", { value: -14 }, "\u221214 LUFS \xB7 streaming"),
    /* @__PURE__ */ React.createElement("option", { value: -16 }, "\u221216 LUFS \xB7 podcast"),
    /* @__PURE__ */ React.createElement("option", { value: -23 }, "\u221223 LUFS \xB7 broadcast")
  ), /* @__PURE__ */ React.createElement("button", { onClick: () => setNormalize(!normalize), title: window.electronAPI && window.electronAPI.processAudio ? `Normalize loudness to ${lufsTarget} LUFS (true peak \u22121 dBTP)` : "Soft-limit peaks (browser fallback)", style: { width: 40, height: 22, borderRadius: 12, background: normalize ? "var(--amber)" : "var(--surface3)", position: "relative", transition: ".15s", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("span", { style: { position: "absolute", top: 2, left: normalize ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#241a0a", transition: ".15s" } })))), /* @__PURE__ */ React.createElement(Row, { label: "Keep pitch" }, /* @__PURE__ */ React.createElement("button", { onClick: () => setPreservePitch(!preservePitch), disabled: !variBpmEnabled, title: variBpmEnabled ? "Export tempo changes without changing pitch" : "Enable Vari BPM first", style: { width: 40, height: 22, borderRadius: 12, background: preservePitch && variBpmEnabled ? "var(--amber)" : "var(--surface3)", position: "relative", transition: ".15s", opacity: variBpmEnabled ? 1 : 0.45 } }, /* @__PURE__ */ React.createElement("span", { style: { position: "absolute", top: 2, left: preservePitch && variBpmEnabled ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#241a0a", transition: ".15s" } }))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12, padding: "10px 12px", background: "rgba(232,176,75,.06)", borderRadius: 9, fontSize: 11, color: "var(--dim)", lineHeight: 1.5 } }, "All unmuted tracks with FX, automation, master EQ & fades. Length ", fmtTime(exportDuration), ".", normalize && window.electronAPI && window.electronAPI.processAudio ? ` Loudness normalized to ${lufsTarget} LUFS.` : "", preservePitch && variBpmEnabled && tempoChanged ? " Keep pitch uses the stable desktop time-stretch path after mix render." : "")), /* @__PURE__ */ React.createElement("div", { style: { width: 1, background: "var(--line-strong)", alignSelf: "stretch" } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 2, fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" } }, "Audio info (tags)"), /* @__PURE__ */ React.createElement(Row, { label: "Title" }, /* @__PURE__ */ React.createElement(MetaInput, { value: title, onChange: setTitle, placeholder: "Track title" })), /* @__PURE__ */ React.createElement(Row, { label: "Artist / Composer" }, /* @__PURE__ */ React.createElement(MetaInput, { value: artist, onChange: setArtist, placeholder: "unknown" })), /* @__PURE__ */ React.createElement(Row, { label: "Album" }, /* @__PURE__ */ React.createElement(MetaInput, { value: album, onChange: setAlbum, placeholder: "Album title" })), /* @__PURE__ */ React.createElement(Row, { label: "Year" }, /* @__PURE__ */ React.createElement(MetaInput, { value: year, onChange: setYear, placeholder: _curYear })), /* @__PURE__ */ React.createElement(Row, { label: "Date" }, /* @__PURE__ */ React.createElement(MetaInput, { value: mdate, onChange: setMdate, placeholder: _curDate })), /* @__PURE__ */ React.createElement(Row, { label: artEnabled ? "Album art" : "Album art (MP3 only)" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" } }, cover && artEnabled && /* @__PURE__ */ React.createElement("img", { src: cover.dataUrl, alt: "cover", style: { width: 30, height: 30, borderRadius: 5, objectFit: "cover", border: "1px solid var(--line)" } }), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: cover ? cover.key : "none",
      disabled: !artEnabled,
      onChange: onCoverSelect,
      style: { height: 28, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 7, color: "var(--cream)", fontSize: 11.5, padding: "0 6px", maxWidth: 150, opacity: artEnabled ? 1 : 0.4 }
    },
    /* @__PURE__ */ React.createElement("option", { value: "none" }, "None"),
    /* @__PURE__ */ React.createElement("optgroup", { label: "Presets" }, presets.map((p, i) => /* @__PURE__ */ React.createElement("option", { key: i, value: "preset:" + i }, p.name))),
    cover && cover.key === "custom" && /* @__PURE__ */ React.createElement("option", { value: "custom" }, cover.name),
    /* @__PURE__ */ React.createElement("option", { value: "file" }, "Choose file\u2026")
  ))))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, marginTop: 18 } }, /* @__PURE__ */ React.createElement("button", { className: "btn", onClick: onClose, style: { flex: 1 } }, "Cancel"), /* @__PURE__ */ React.createElement("button", { className: "btn primary", onClick: render, style: { flex: 2 } }, /* @__PURE__ */ React.createElement(Icon, { name: "disc", size: 15 }), " Render"))), stage === "rendering" && /* @__PURE__ */ React.createElement("div", { style: { padding: "34px 24px", textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 13, color: "var(--cream-2)", marginBottom: 16 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 18, height: 18, borderRadius: "50%", border: "2px solid var(--line-strong)", borderTopColor: "var(--amber)", animation: "spin .8s linear infinite", flex: "0 0 auto" } }), stepLabel, " ", /* @__PURE__ */ React.createElement("span", { className: "mono", style: { color: "var(--amber)" } }, Math.round(prog * 100), "%"), /* @__PURE__ */ React.createElement("span", { className: "rec-dot", style: { width: 6, height: 6, borderRadius: "50%", background: "var(--amber)", flex: "0 0 auto" } })), /* @__PURE__ */ React.createElement("div", { style: { height: 8, background: "var(--surface)", borderRadius: 5, overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: { height: "100%", width: prog * 100 + "%", background: "linear-gradient(90deg,var(--amber-deep),var(--amber))", borderRadius: 5, transition: "width .12s" } })), /* @__PURE__ */ React.createElement("div", { className: "mono", style: { fontSize: 10.5, color: "var(--faint)", marginTop: 14 } }, "offline render \xB7 ", sr / 1e3, "kHz", format === "mp3" ? ` \xB7 ${bitrate}kbps MP3` : " \xB7 WAV", preservePitch && variBpmEnabled && tempoChanged ? " \xB7 keep pitch" : "")), stage === "error" && /* @__PURE__ */ React.createElement("div", { style: { padding: "30px 24px", textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 52, height: 52, borderRadius: "50%", background: "rgba(217,106,78,.14)", color: "var(--red)", display: "grid", placeItems: "center", margin: "0 auto 14px", fontWeight: 700, fontSize: 24 } }, "!"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 600 } }, "Export failed"), /* @__PURE__ */ React.createElement("div", { style: { margin: "8px auto 18px", maxHeight: 96, overflow: "auto", fontSize: 11.5, color: "var(--dim)", lineHeight: 1.45, wordBreak: "break-word" } }, errorMsg), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement("button", { className: "btn", onClick: () => setStage("settings"), style: { flex: 1 } }, "Back"), /* @__PURE__ */ React.createElement("button", { className: "btn primary", onClick: render, style: { flex: 1 } }, /* @__PURE__ */ React.createElement(Icon, { name: "disc", size: 15 }), " Retry"))), stage === "done" && /* @__PURE__ */ React.createElement("div", { style: { padding: "30px 24px", textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 52, height: 52, borderRadius: "50%", background: "var(--amber-soft)", color: "var(--amber)", display: "grid", placeItems: "center", margin: "0 auto 14px" } }, /* @__PURE__ */ React.createElement(Icon, { name: "check", size: 26 })), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 600 } }, "Mixdown ready"), /* @__PURE__ */ React.createElement("div", { className: "mono", style: { fontSize: 11.5, color: "var(--muted)", margin: "6px 0 18px" } }, fileName, " \xB7 ", fmtTime(exportDuration), " \xB7 ", sr / 1e3, "kHz \xB7 ", ext.toUpperCase(), preservePitch && variBpmEnabled && tempoChanged ? " \xB7 keep pitch" : ""), exportNotice && /* @__PURE__ */ React.createElement("div", { style: {
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
  } }, /* @__PURE__ */ React.createElement("strong", { style: { color: "var(--amber)" } }, "Web Audio fallback used."), " ", exportNotice.text), window.electronAPI ? /* @__PURE__ */ React.createElement("button", { className: "btn-save", disabled: saving, onClick: async () => {
    setSaving(true);
    if (audioBlob && audioBlob.isNative) {
      const yr = String(year || "").trim();
      const dt = String(mdate || "").trim();
      let tagDate = dt;
      if (/^\d{4}$/.test(yr)) tagDate = /^\d{4}-\d{2}-\d{2}/.test(dt) ? yr + dt.slice(4) : yr;
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
  } }, /* @__PURE__ */ React.createElement(Icon, { name: "download", size: 18 }), " ", saving ? "Saving\u2026" : "Save file") : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("a", { className: "btn-save", href: url, download: fileName }, /* @__PURE__ */ React.createElement(Icon, { name: "download", size: 18 }), " Save file"), format === "mp3" && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10.5, color: "var(--faint)", marginTop: 12, lineHeight: 1.5 } }, "Browser build encodes MP3 via lamejs with ID3v2 tags & cover art. The desktop build uses ffmpeg.")), /* @__PURE__ */ React.createElement("button", { className: "btn ghost", onClick: onClose, style: { marginTop: 8 } }, "Done"))));
}
function Row({ label, children }) {
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--line)" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12.5, color: "var(--dim)" } }, label), children);
}
function MetaInput({ value, onChange, placeholder, disabled }) {
  return /* @__PURE__ */ React.createElement(
    "input",
    {
      value,
      placeholder,
      disabled,
      onChange: (e) => onChange(e.target.value),
      style: {
        width: 168,
        height: 28,
        padding: "0 9px",
        background: disabled ? "var(--surface)" : "var(--bg)",
        border: "1px solid var(--line)",
        borderRadius: 7,
        color: "var(--cream)",
        fontSize: 12,
        fontFamily: "var(--ui)",
        outline: "none",
        opacity: disabled ? 0.4 : 1
      }
    }
  );
}
const THEMES = [
  {
    id: "default",
    name: "Warm Analog",
    desc: "espresso + amber \xB7 vintage console",
    bg: "#1b1712",
    bg2: "#221d17",
    surface: "#2a2520",
    accent: "#e8b04b",
    text: "#efe6d4",
    text2: "#b0a690",
    green: "#94c06a",
    red: "#d96a4e",
    blue: "#7fb0c4"
  },
  {
    id: "ivory",
    name: "Classical Ivory",
    desc: "warm paper \xB7 deep amber \xB7 bright & calm",
    bg: "#efe7d6",
    bg2: "#e7ddc8",
    surface: "#f8f3e8",
    accent: "#bf7f2e",
    text: "#3b3327",
    text2: "#6e6149",
    green: "#7c9a4f",
    red: "#c2593b",
    blue: "#5f86a6"
  },
  {
    id: "blue",
    name: "Modern Blue",
    desc: "deep navy \xB7 cool accent \xB7 bold & focused",
    bg: "#0e1b30",
    bg2: "#13243d",
    surface: "#1c3050",
    accent: "#5b9bd5",
    text: "#eaf1fb",
    text2: "#a7b8d0",
    green: "#3fb985",
    red: "#e8654a",
    blue: "#7fb9e8"
  },
  {
    id: "forest",
    name: "Forest Green",
    desc: "dark forest \xB7 vivid green \xB7 natural & deep",
    bg: "#0f1a13",
    bg2: "#162319",
    surface: "#1d3022",
    accent: "#5de87a",
    text: "#d8f0d0",
    text2: "#9ec49a",
    green: "#aae060",
    red: "#e06058",
    blue: "#60b8c8"
  },
  {
    id: "arctic",
    name: "Arctic Frost",
    desc: "deep ice \xB7 cyan glow \xB7 crisp & precise",
    bg: "#0b1326",
    bg2: "#131b2e",
    surface: "#171f33",
    accent: "#22d3ee",
    text: "#dbe2fd",
    text2: "#bbcabf",
    green: "#6ffbbe",
    red: "#ffb4ab",
    blue: "#95d3ba"
  },
  {
    id: "lime",
    name: "Neon Lime",
    desc: "black lime \xB7 high energy \xB7 electronic",
    bg: "#0c0e0a",
    bg2: "#151a11",
    surface: "#1a1e15",
    accent: "#a3e635",
    text: "#e4ead8",
    text2: "#c2c9b4",
    green: "#bef264",
    red: "#ffb4ab",
    blue: "#bacac3"
  },
  {
    id: "slate",
    name: "Minimal Slate",
    desc: "near black \xB7 quiet chrome \xB7 minimal",
    bg: "#020617",
    bg2: "#0f172a",
    surface: "#111827",
    accent: "#e2e8f0",
    text: "#f8fafc",
    text2: "#94a3b8",
    green: "#94a3b8",
    red: "#fca5a5",
    blue: "#cbd5e1"
  },
  {
    id: "sage",
    name: "Sage Mist",
    desc: "soft green \xB7 airy light \xB7 calm",
    bg: "#f7f9f8",
    bg2: "#eef4f1",
    surface: "#e7ece9",
    accent: "#236a56",
    text: "#191c1a",
    text2: "#3f4945",
    green: "#7abea7",
    red: "#ba1a1a",
    blue: "#4f7f93"
  },
  {
    id: "solar",
    name: "Solar Gold",
    desc: "warm black \xB7 golden pulse \xB7 confident",
    bg: "#1c1917",
    bg2: "#292524",
    surface: "#292524",
    accent: "#fbbf24",
    text: "#fef3c7",
    text2: "#d6d3d1",
    green: "#84cc16",
    red: "#f87171",
    blue: "#38bdf8"
  },
  {
    id: "navy",
    name: "Slate Navy",
    desc: "charcoal navy \xB7 cyan edge \xB7 technical",
    bg: "#0e1416",
    bg2: "#161d1e",
    surface: "#1a2122",
    accent: "#44d8f1",
    text: "#dde3e5",
    text2: "#bbc9cc",
    green: "#64d8a7",
    red: "#ffb4ab",
    blue: "#44d8f1"
  }
];
function ThemeSwatch({ theme, active, onClick }) {
  const t = theme;
  return /* @__PURE__ */ React.createElement("div", { onClick, style: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    cursor: "pointer",
    width: "100%",
    maxWidth: 130,
    margin: "0 auto"
  } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, fontWeight: 700, color: active ? "var(--accent)" : "var(--cream)", paddingLeft: 1, lineHeight: 1.2 } }, t.name), /* @__PURE__ */ React.createElement("div", { style: {
    borderRadius: 6,
    overflow: "hidden",
    border: `1.5px solid ${active ? t.accent : "transparent"}`,
    boxShadow: active ? `0 0 0 2px ${t.accent}44` : "0 1px 6px rgba(0,0,0,.35)",
    transition: ".15s",
    background: t.bg
  } }, /* @__PURE__ */ React.createElement("div", { style: { height: 11, background: t.bg2, display: "flex", alignItems: "center", gap: 3, padding: "0 4px", borderBottom: `1px solid ${t.text}18` } }, /* @__PURE__ */ React.createElement("div", { style: { width: 4, height: 4, borderRadius: "50%", border: `1px solid ${t.accent}` } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 5, fontWeight: 700, color: t.accent, letterSpacing: ".06em" } }, "PROJECT"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 5, color: t.text2 } }, "Edit \xB7 View")), [["Drums", t.accent, "62%"], ["Bass", t.blue, "44%"], ["Lead", t.green, "55%"]].map(([name, col, fill]) => /* @__PURE__ */ React.createElement("div", { key: name, style: { display: "flex", alignItems: "center", gap: 3, padding: "3px 4px", borderBottom: `1px solid ${t.text}10` } }, /* @__PURE__ */ React.createElement("div", { style: { width: 2, height: 9, borderRadius: 2, background: col } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 6, fontWeight: 600, color: t.text, width: 17 } }, name), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, height: 2, background: t.surface, borderRadius: 2, position: "relative" } }, /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", left: 0, top: 0, height: "100%", width: fill, background: t.accent, borderRadius: 2 } })))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", height: 4 } }, [t.bg, t.surface, t.text, t.accent, t.green, t.red, t.blue].map((c, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { flex: 1, background: c } }))), /* @__PURE__ */ React.createElement("div", { style: { padding: "4px 5px", background: t.bg2 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 6, color: t.text2, lineHeight: 1.3 } }, t.desc))));
}
function AudioDeviceSection() {
  const [devices, setDevices] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(() => DAW.getSavedAudioDevice ? DAW.getSavedAudioDevice() : null);
  const isNative = !!DAW.isNative;
  const refresh = async () => {
    if (!DAW.requestAudioDevices) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const list = await DAW.requestAudioDevices();
    setDevices(list);
    setLoading(false);
  };
  useEffect(() => {
    refresh();
  }, []);
  const types = (devices && devices.types || []).filter((t) => !/directsound/i.test(t.type));
  const current = devices && devices.current;
  const savedValue = saved && (saved.type || saved.name) ? JSON.stringify([saved.type || "", saved.name || ""]) : "";
  const savedInList = !savedValue || types.some((t) => t.type === (saved.type || "") && (t.devices || []).includes(saved.name || ""));
  const onChange = (e) => {
    const v = e.target.value;
    const [type, name] = v ? JSON.parse(v) : ["", ""];
    setSaved(v ? { type, name } : null);
    if (DAW.setAudioDevice) DAW.setAudioDevice(type, name);
    setTimeout(refresh, 800);
  };
  return /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid var(--line)", paddingTop: 18, marginTop: 22 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, fontWeight: 600, letterSpacing: ".06em", color: "var(--dim)", textTransform: "uppercase", marginBottom: 10 } }, "Audio Output Device"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, padding: "8px 0" } }, /* @__PURE__ */ React.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 600, color: "var(--cream)" } }, "Output Device"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: "var(--muted)", marginTop: 2 } }, 'App-only setting \u2014 the Windows default device is not changed. "Windows Audio (Exclusive Mode)" takes over the device for the lowest latency.'), current && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: "var(--dim)", marginTop: 6 } }, "Active: ", current.name || "(system default)", " \xB7 ", current.type, " \xB7 ", Math.round(current.sampleRate || 0), " Hz / ", current.bufferSize || 0, " samples"), !isNative && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: "var(--muted)", marginTop: 6 } }, "Native audio engine not connected \u2014 the system default output is in use.")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", flexShrink: 0 } }, /* @__PURE__ */ React.createElement(
    "select",
    {
      value: savedValue,
      onChange,
      disabled: !isNative || loading,
      style: { maxWidth: 300, height: 32, fontSize: 12.5, background: "var(--bg)", color: "var(--cream)", border: "1px solid var(--line-strong)", borderRadius: 7, padding: "0 8px" }
    },
    /* @__PURE__ */ React.createElement("option", { value: "" }, "System Default"),
    !savedInList && savedValue && /* @__PURE__ */ React.createElement("option", { value: savedValue }, (saved.name || "?") + " (saved \u2014 not found)"),
    types.map((t) => /* @__PURE__ */ React.createElement("optgroup", { key: t.type, label: t.type }, (t.devices || []).map((name) => /* @__PURE__ */ React.createElement("option", { key: t.type + "|" + name, value: JSON.stringify([t.type, name]) }, name))))
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "btn",
      onClick: refresh,
      disabled: !isNative || loading,
      style: { height: 32, fontSize: 12.5, padding: "0 12px", border: "1px solid var(--line-strong)" }
    },
    loading ? "\u2026" : "Rescan"
  ))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" } }, /* @__PURE__ */ React.createElement("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 11.5 } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { style: { background: "var(--bg)", color: "var(--dim)", textAlign: "left" } }, ["Mode", "Path", "Latency", "Other apps", "Notes"].map((h) => /* @__PURE__ */ React.createElement("th", { key: h, style: { padding: "7px 10px", fontWeight: 600, borderBottom: "1px solid var(--line)" } }, h)))), /* @__PURE__ */ React.createElement("tbody", { style: { color: "var(--muted)" } }, [
    ["Windows Audio (Exclusive Mode)", "App \u2192 device directly", "Lowest (a few ms)", "Muted", "Takes over the device; the app sets the sample rate"],
    ["Windows Audio (Low Latency Mode)", "App \u2192 Windows mixer (small buffer) \u2192 device", "Low (~3\u201310 ms)", "Audible", "Windows 10+; actual latency depends on the audio driver"],
    ["Windows Audio", "App \u2192 Windows mixer \u2192 device", "Normal (10\u201330 ms)", "Audible", "Most stable \u2014 recommended for everyday use"]
  ].map((row, i) => /* @__PURE__ */ React.createElement("tr", { key: i, style: { borderBottom: i < 2 ? "1px solid var(--line)" : "none" } }, row.map((cell, j) => /* @__PURE__ */ React.createElement("td", { key: j, style: { padding: "7px 10px", verticalAlign: "top", color: j === 0 ? "var(--cream)" : void 0, fontWeight: j === 0 ? 600 : 400 } }, cell)))))), /* @__PURE__ */ React.createElement("div", { style: { padding: "7px 10px", fontSize: 11, color: "var(--dim)", borderTop: "1px solid var(--line)", background: "var(--bg)" } }, "Lower latency trades away stability \u2014 if you hear dropouts or crackles, switch back to Windows Audio (shared).")));
}
function SettingsDialog({ currentTheme, onThemeChange, onClose }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      style: { position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 800 },
      onClick: (e) => e.target === e.currentTarget && onClose()
    },
    /* @__PURE__ */ React.createElement("div", { style: { background: "var(--bg2)", border: "1px solid var(--line-strong)", borderRadius: 14, width: 760, maxWidth: "95vw", maxHeight: "92vh", boxShadow: "var(--shadow)", display: "flex", flexDirection: "column" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--line)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 15 } }, "Settings"), /* @__PURE__ */ React.createElement("button", { className: "iconbtn", onClick: onClose, style: { fontSize: 18, lineHeight: 1 } }, "\xD7")), /* @__PURE__ */ React.createElement("div", { style: { padding: "20px 22px 24px", overflowY: "auto" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, fontWeight: 600, letterSpacing: ".06em", color: "var(--dim)", textTransform: "uppercase", marginBottom: 14 } }, "Color Theme"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 26 } }, THEMES.map((t) => /* @__PURE__ */ React.createElement(ThemeSwatch, { key: t.id, theme: t, active: currentTheme === t.id, onClick: () => onThemeChange(t.id) }))), /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid var(--line)", paddingTop: 18 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, fontWeight: 600, letterSpacing: ".06em", color: "var(--dim)", textTransform: "uppercase", marginBottom: 10 } }, "Mixer Console Window"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 600, color: "var(--cream)" } }, "Reset Window Bounds"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: "var(--muted)", marginTop: 2 } }, "Restore the Mixer window size and screen coordinates to their default settings.")), /* @__PURE__ */ React.createElement("button", { className: "btn", onClick: () => {
      localStorage.removeItem("focusdaw-mixer-bounds");
      if (window.electronAPI && window.electronAPI.resetMixerBounds) {
        window.electronAPI.resetMixerBounds();
      } else {
        if (window.mixerPopup && !window.mixerPopup.closed) {
          window.mixerPopup.close();
        }
      }
      alert("Mixer window position and size have been reset.");
    }, style: { height: 32, fontSize: 12.5, padding: "0 14px", border: "1px solid var(--line-strong)" } }, "Reset Position"))), /* @__PURE__ */ React.createElement(AudioDeviceSection, null)), /* @__PURE__ */ React.createElement("div", { style: { padding: "12px 22px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end" } }, /* @__PURE__ */ React.createElement("button", { className: "btn primary", onClick: onClose }, "Done")))
  );
}
Object.assign(window, { LoaderScreen, ExportDialog, SettingsDialog, Logo, audioBufferToWav });

