'use strict';

const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const { spawn } = require('child_process');

let ffmpegPath = null;
try { ffmpegPath = require('ffmpeg-static'); } catch (e) {
  console.warn('[FocusDAW] ffmpeg-static not found — MP3 encoding unavailable. Run: npm install');
}

const AUDIO_EXT = /\.(mp3|wav|aiff?|m4a|ogg|flac)$/i;

function resolveFfmpegPath() {
  if (!ffmpegPath) return null;

  const normalizedPath = String(ffmpegPath);
  const unpackedPath = normalizedPath
    .replace(/([\\/])app\.asar([\\/])/i, '$1app.asar.unpacked$2');
  if (unpackedPath !== normalizedPath) return unpackedPath;

  return normalizedPath;
}

function audioItem(filePath) {
  const fileName = path.basename(filePath);
  let stat = null;
  try { stat = fs.statSync(filePath); } catch (e) {}
  return {
    name: fileName,
    displayName: fileName.replace(AUDIO_EXT, ''),
    path: filePath,
    size: stat ? stat.size : null,
    mtimeMs: stat ? stat.mtimeMs : null,
  };
}

function safeFileBase(name) {
  const cleaned = String(name || 'untitled')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[.\s]+$/g, '');
  return cleaned || 'untitled';
}

function buildAtempoFilter(rate) {
  let r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return null;
  const parts = [];
  while (r < 0.5) { parts.push(0.5); r /= 0.5; }
  while (r > 2.0) { parts.push(2.0); r /= 2.0; }
  parts.push(Math.max(0.5, Math.min(2.0, r)));
  return parts.map(v => `atempo=${v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`).join(',');
}

// Run ffmpeg and resolve with captured stderr (used for loudnorm measurement).
function runFfmpeg(ffmpegPath, args) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited with code ${code}${stderr ? `: ${stderr.slice(-1500).trim()}` : ''}`));
    });
    proc.on('error', reject);
  });
}

// Extract the trailing JSON block ffmpeg's loudnorm print_format=json writes to stderr.
function parseLoudnormJson(stderr) {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(stderr.slice(start, end + 1)); } catch (e) { return null; }
}

// Build a loudnorm filter string. When `measured` is supplied, use linear (two-pass
// transparent) normalization; otherwise single-pass dynamic measurement.
function buildLoudnormFilter(ln, measured, printFormat) {
  const I = Number.isFinite(ln.I) ? ln.I : -14;
  const TP = Number.isFinite(ln.TP) ? ln.TP : -1;
  const LRA = Number.isFinite(ln.LRA) ? ln.LRA : 11;
  let f = `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}`;
  if (measured) {
    f += `:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}` +
         `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}` +
         `:offset=${measured.target_offset}:linear=true`;
  }
  if (printFormat) f += `:print_format=${printFormat}`;
  return f;
}

let mainWindow = null;
let mixerWindow = null;
let advancedPanWindow = null;
let helpWindow = null;
let forceCloseMixerWindow = false;
let forceCloseAdvancedPanWindow = false;

function createWindow() {
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'logo.png'),
    ...(isMac ? { titleBarStyle: 'hiddenInset' } : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    backgroundColor: '#1b1712',
  });

  mainWindow = win;

  win.webContents.on('console-message', (_event, _level, message) => {
    if (typeof message === 'string' && message.startsWith('[KeyDetection]')) {
      console.log(message);
    }
  });

  win.loadFile(path.join(__dirname, '..', 'studio.html'));


  // Forward close/minimize/maximize to renderer for custom title bar buttons
  win.on('maximize',   () => win.webContents.send('win-state', 'maximized'));
  win.on('unmaximize', () => win.webContents.send('win-state', 'normal'));

  win.on('closed', () => {
    mainWindow = null;
    if (mixerWindow && !mixerWindow.isDestroyed()) {
      forceCloseMixerWindow = true;
      mixerWindow.close();
    }
    if (advancedPanWindow && !advancedPanWindow.isDestroyed()) {
      forceCloseAdvancedPanWindow = true;
      advancedPanWindow.close();
    }
    if (helpWindow && !helpWindow.isDestroyed()) {
      helpWindow.close();
    }
  });
}

let audioEngineProc = null;

function startAudioEngine() {
  const isWin = process.platform === 'win32';
  const binName = isWin ? 'FocusDAW-AudioEngine.exe' : 'FocusDAW-AudioEngine';
  
  const rawPaths = [
    path.join(__dirname, '..', 'bin', binName),
    path.join(__dirname, '..', binName),
    path.join(app.getAppPath(), 'bin', binName)
  ];
  
  const pathsToTry = rawPaths.map(p => {
    const normalized = String(p);
    const unpacked = normalized.replace(/([\\/])app\.asar([\\/])/i, '$1app.asar.unpacked$2');
    return unpacked;
  });
  
  let binaryPath = null;
  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      binaryPath = p;
      break;
    }
  }
  
  if (!binaryPath) {
    console.warn('[FocusDAW] JUCE Native Audio Engine binary not found. Falling back to Web Audio API.');
    return;
  }
  
  console.log(`[FocusDAW] Spawning JUCE Audio Engine: ${binaryPath}`);
  try {
    audioEngineProc = spawn(binaryPath, ['--port', '8082'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    audioEngineProc.stdout.on('data', (data) => {
      console.log(`[AudioEngine Out] ${data.toString().trim()}`);
    });
    
    audioEngineProc.stderr.on('data', (data) => {
      console.error(`[AudioEngine Err] ${data.toString().trim()}`);
    });
    
    audioEngineProc.on('close', (code) => {
      console.log(`[AudioEngine] Process exited with code ${code}`);
      audioEngineProc = null;
    });
  } catch (err) {
    console.error('[FocusDAW] Failed to spawn JUCE Audio Engine:', err);
  }
}

function stopAudioEngine() {
  if (audioEngineProc) {
    console.log('[FocusDAW] Killing JUCE Audio Engine process...');
    audioEngineProc.kill();
    audioEngineProc = null;
  }
}

app.whenReady().then(() => {
  startAudioEngine();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  stopAudioEngine();
});

// ── IPC handlers ──────────────────────────────────────────────────────────────

// Scan a folder for audio files
ipcMain.handle('open-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Stem Folder',
  });
  if (canceled || !filePaths[0]) return [];
  const dir = filePaths[0];
  return fs.readdirSync(dir)
    .filter(f => AUDIO_EXT.test(f))
    .map(f => audioItem(path.join(dir, f)));
});

// Select individual audio files
ipcMain.handle('select-files', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'aif', 'aiff', 'm4a', 'ogg', 'flac'] }],
    title: 'Import Audio Files',
  });
  if (canceled) return [];
  return filePaths.map(p => audioItem(p));
});

// Read an audio file and return its raw bytes as ArrayBuffer
ipcMain.handle('read-audio-file', async (_, filePath) => {
  const buf = fs.readFileSync(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

// Write a temporary WAV file from raw bytes (used for demo tracks sync to native engine)
ipcMain.handle('write-temp-audio', async (_, wavBuffer, fileName) => {
  const base = path.basename(fileName, path.extname(fileName)) + `_${Date.now()}`;
  const tmpWav = path.join(os.tmpdir(), base + '.wav');
  fs.writeFileSync(tmpWav, Buffer.from(wavBuffer));
  return tmpWav;
});

// Save project via native Save dialog
ipcMain.handle('save-project', async (_, json, defaultName, targetPath) => {
  if (targetPath) {
    fs.writeFileSync(targetPath, JSON.stringify(json, null, 2), 'utf8');
    return { saved: true, path: targetPath, dir: path.dirname(targetPath) };
  }
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: safeFileBase(defaultName) + '.focus',
    filters: [{ name: 'FocusDAW Project', extensions: ['focus'] }],
    title: 'Save Project',
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf8');
  return { saved: true, path: filePath, dir: path.dirname(filePath) };
});

// Open project via native Open dialog
ipcMain.handle('open-project', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'FocusDAW Project', extensions: ['focus'] }],
    title: 'Open Project',
  });
  if (canceled || !filePaths[0]) return null;
  const filePath = filePaths[0];
  return {
    text: fs.readFileSync(filePath, 'utf8'),
    path: filePath,
    dir: path.dirname(filePath),
  };
});

// Encode WAV → MP3 via ffmpeg (with ID3v2 tags + optional embedded cover art)
ipcMain.handle('encode-mp3', async (_, wavBuffer, options) => {
  const resolvedFfmpegPath = resolveFfmpegPath();
  if (!resolvedFfmpegPath) throw new Error('ffmpeg-static not installed. Run: npm install');
  if (!fs.existsSync(resolvedFfmpegPath)) throw new Error(`ffmpeg executable not found: ${resolvedFfmpegPath}`);
  const { bitrate = 320, sampleRate = 44100, meta = {}, cover = null } = options || {};
  const base   = `focusdaw_${Date.now()}`;
  const tmpWav = path.join(os.tmpdir(), base + '.wav');
  const tmpMp3 = path.join(os.tmpdir(), base + '.mp3');

  fs.writeFileSync(tmpWav, Buffer.from(wavBuffer));

  // Album art: write the base64 image bytes to a temp file for ffmpeg to attach
  let tmpCover = null;
  if (cover && cover.data) {
    const ext = cover.mime === 'image/png' ? 'png'
      : cover.mime === 'image/webp' ? 'webp'
      : cover.mime === 'image/gif' ? 'gif'
      : 'jpg';
    tmpCover = path.join(os.tmpdir(), base + '_cover.' + ext);
    fs.writeFileSync(tmpCover, Buffer.from(cover.data, 'base64'));
  }

  const args = ['-y', '-i', tmpWav];
  if (tmpCover) {
    args.push('-i', tmpCover,
      '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-c:v', 'copy',
      '-disposition:v:0', 'attached_pic',
      '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)');
  } else {
    args.push('-c:a', 'libmp3lame');
  }
  args.push('-b:a', `${bitrate}k`, '-ar', String(sampleRate), '-id3v2_version', '3');

  // text tags — id3v2.3 derives Year (TYER) + Date (TDAT) from a full ISO date
  const addMeta = (k, v) => { if (v != null && String(v).length) args.push('-metadata', `${k}=${v}`); };
  addMeta('title', meta.title);
  addMeta('artist', meta.artist);
  addMeta('album_artist', meta.artist);
  addMeta('composer', meta.artist);
  addMeta('album', meta.album);
  addMeta('date', meta.date || meta.year);

  args.push(tmpMp3);

  await new Promise((resolve, reject) => {
    let stderr = '';
    const proc = spawn(resolvedFfmpegPath, args, { windowsHide: true });
    proc.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
    proc.on('error', reject);
  });

  const mp3Buf = fs.readFileSync(tmpMp3);
  try { fs.unlinkSync(tmpWav); fs.unlinkSync(tmpMp3); if (tmpCover) fs.unlinkSync(tmpCover); } catch (e) {}
  return mp3Buf.buffer.slice(mp3Buf.byteOffset, mp3Buf.byteOffset + mp3Buf.byteLength);
});

// Post-render audio processing via ffmpeg: optional pitch-preserving tempo (atempo)
// and/or LUFS loudness normalization (loudnorm, two-pass linear). Both stages run in
// one filter chain so the audio is written/decoded only once.
//   options = { rate, sampleRate, loudnorm: { I, TP, LRA } | null }
async function processAudioFfmpeg(wavBuffer, options) {
  const resolvedFfmpegPath = resolveFfmpegPath();
  if (!resolvedFfmpegPath) throw new Error('ffmpeg-static not installed. Run: npm install');
  if (!fs.existsSync(resolvedFfmpegPath)) throw new Error(`ffmpeg executable not found: ${resolvedFfmpegPath}`);
  const { rate = 1, sampleRate = 44100, loudnorm = null } = options || {};

  // Tempo stage (skipped when rate ~= 1).
  const tempoFilter = Math.abs(Number(rate) - 1) > 0.001 ? buildAtempoFilter(rate) : null;
  if (Math.abs(Number(rate) - 1) > 0.001 && !tempoFilter) throw new Error(`Invalid tempo rate: ${rate}`);

  const base = `focusdaw_audio_${Date.now()}`;
  const tmpIn = path.join(os.tmpdir(), base + '_in.wav');
  const tmpOut = path.join(os.tmpdir(), base + '_out.wav');
  fs.writeFileSync(tmpIn, Buffer.from(wavBuffer));

  try {
    let measured = null;
    if (loudnorm) {
      // Pass 1: measure loudness on the tempo-adjusted signal (output discarded).
      const p1 = ['-y', '-i', tmpIn];
      const p1chain = [tempoFilter, buildLoudnormFilter(loudnorm, null, 'json')].filter(Boolean).join(',');
      p1.push('-filter:a', p1chain, '-f', 'null', '-');
      const stderr = await runFfmpeg(resolvedFfmpegPath, p1);
      measured = parseLoudnormJson(stderr);
    }

    // Final pass: tempo + (linear loudnorm with measured values, or atempo only).
    const finalChain = [tempoFilter];
    if (loudnorm) finalChain.push(buildLoudnormFilter(loudnorm, measured, 'summary'));
    const chain = finalChain.filter(Boolean).join(',');
    const args = ['-y', '-i', tmpIn];
    if (chain) args.push('-filter:a', chain);
    args.push('-ar', String(sampleRate), tmpOut);
    await runFfmpeg(resolvedFfmpegPath, args);

    const out = fs.readFileSync(tmpOut);
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  } finally {
    try { fs.unlinkSync(tmpIn); } catch (e) {}
    try { fs.unlinkSync(tmpOut); } catch (e) {}
  }
}

ipcMain.handle('process-audio', (_, wavBuffer, options) => processAudioFfmpeg(wavBuffer, options));

// Backward-compatible alias: tempo-only processing.
ipcMain.handle('process-tempo', (_, wavBuffer, options) => {
  const { rate = 1, sampleRate = 44100 } = options || {};
  return processAudioFfmpeg(wavBuffer, { rate, sampleRate, loudnorm: null });
});

// Save rendered audio via native Save dialog (handles overwrite confirmation)
ipcMain.handle('save-audio', async (_, buffer, defaultName) => {
  const ext = path.extname(defaultName).replace('.', '') || 'mp3';
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: ext.toUpperCase() + ' Audio', extensions: [ext] }],
    title: 'Save Audio File',
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return { saved: true };
});

// Save natively rendered audio file (supports WAV copy and MP3 encoding with tags/cover)
ipcMain.handle('save-native-audio', async (_, tempFilePath, format, options, defaultName) => {
  const ext = format === 'mp3' ? 'mp3' : 'wav';
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: ext.toUpperCase() + ' Audio', extensions: [ext] }],
    title: 'Save Audio File',
  });
  if (canceled || !filePath) return { saved: false };

  try {
    if (format === 'wav') {
      fs.copyFileSync(tempFilePath, filePath);
      try { fs.unlinkSync(tempFilePath); } catch (e) {}
      return { saved: true };
    } else {
      const resolvedFfmpegPath = resolveFfmpegPath();
      if (!resolvedFfmpegPath) throw new Error('ffmpeg-static not installed. Run: npm install');
      if (!fs.existsSync(resolvedFfmpegPath)) throw new Error(`ffmpeg executable not found: ${resolvedFfmpegPath}`);
      
      const { bitrate = 320, sampleRate = 44100, meta = {}, cover = null } = options || {};
      
      let tmpCover = null;
      if (cover && cover.data) {
        const base = `focusdaw_cover_${Date.now()}`;
        const extCover = cover.mime === 'image/png' ? 'png'
          : cover.mime === 'image/webp' ? 'webp'
          : cover.mime === 'image/gif' ? 'gif'
          : 'jpg';
        tmpCover = path.join(os.tmpdir(), base + '.' + extCover);
        fs.writeFileSync(tmpCover, Buffer.from(cover.data, 'base64'));
      }

      const args = ['-y', '-i', tempFilePath];
      if (tmpCover) {
        args.push('-i', tmpCover,
          '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-c:v', 'copy',
          '-disposition:v:0', 'attached_pic',
          '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)');
      } else {
        args.push('-c:a', 'libmp3lame');
      }
      args.push('-b:a', `${bitrate}k`, '-ar', String(sampleRate), '-id3v2_version', '3');

      const addMeta = (k, v) => { if (v != null && String(v).length) args.push('-metadata', `${k}=${v}`); };
      addMeta('title', meta.title);
      addMeta('artist', meta.artist);
      addMeta('album_artist', meta.artist);
      addMeta('composer', meta.artist);
      addMeta('album', meta.album);
      addMeta('date', meta.date || meta.year);

      args.push(filePath);

      await runFfmpeg(resolvedFfmpegPath, args);

      try { fs.unlinkSync(tempFilePath); if (tmpCover) fs.unlinkSync(tmpCover); } catch (e) {}
      return { saved: true };
    }
  } catch (err) {
    console.error('[FocusDAW] save-native-audio error:', err);
    throw err;
  }
});

// Window control actions (for custom title bar on Windows/Linux)
ipcMain.handle('win-action', (_, action) => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') {
    if (win === mixerWindow) {
      hideMixerWindow();
    } else {
      win.close();
    }
  }
});

ipcMain.handle('open-help', async () => {
  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.focus();
    return;
  }

  helpWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    frame: process.platform === 'darwin',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
    autoHideMenuBar: true,
    parent: undefined,
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    backgroundColor: '#1b1712',
    title: 'FocusDAW Studio Help',
  });

  helpWindow.setMenuBarVisibility(false);
  helpWindow.removeMenu();
  helpWindow.loadFile(path.join(__dirname, '..', 'help.html'));
  helpWindow.on('closed', () => {
    helpWindow = null;
  });
});

// Remember the CONTENT bounds (both position and size) across mixer open/close.
// By using delta-based calculations relative to the initial loaded size, we isolate
// and eliminate the OS-level frameless resize-hit inset (#51679) feedback loop.
let mixerWinBounds = null;   // { x, y, width, height }
let advancedPanWinBounds = null; // { x, y, width, height }
let isMixerBoundsReset = false;
let isMixerFullyLoaded = false;

let requestedWidth = 0;
let requestedHeight = 0;
let initialContentWidth = 0;
let initialContentHeight = 0;

const MIXER_HEIGHT = 515;
const ADVANCED_PAN_WIDTH = 1162;
const ADVANCED_PAN_HEIGHT = 770;

function sendMixerState(isOpen) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('mixer-state', isOpen);
  }
}

function sendAdvancedPanState(isOpen) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('advanced-pan-state', isOpen);
  }
}

function hideMixerWindow() {
  if (!mixerWindow || mixerWindow.isDestroyed()) return;
  const cb = mixerWindow.getContentBounds();
  if (mixerWinBounds) {
    mixerWinBounds.x = cb.x;
    mixerWinBounds.y = cb.y;
  } else {
    mixerWinBounds = { x: cb.x, y: cb.y, width: cb.width, height: cb.height };
  }
  mixerWindow.hide();
  sendMixerState(false);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
  }
}

function hideAdvancedPanWindow() {
  if (!advancedPanWindow || advancedPanWindow.isDestroyed()) return;
  const cb = advancedPanWindow.getContentBounds();
  advancedPanWinBounds = { x: cb.x, y: cb.y, width: cb.width, height: cb.height };
  advancedPanWindow.hide();
  sendAdvancedPanState(false);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
  }
}

function preferredMixerWidth(tracksCount) {
  const channelW = 92;
  const masterW = 400;
  const count = typeof tracksCount === 'number' ? tracksCount : 0;
  const contentWidth = count * channelW + masterW + 2;
  return Math.max(600, Math.min(1440, contentWidth));
}

// Keep restored bounds inside a connected display's work area, so the mixer
// never reopens off-screen (after a monitor change, an edge-resize, etc.).
function clampMixerBounds(b) {
  const wa = screen.getDisplayMatching(b).workArea;
  const width = Math.min(b.width, wa.width);
  const height = Math.min(b.height, wa.height);
  const x = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - width));
  const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - height));
  return { x, y, width, height };
}

// Mixer window control actions
ipcMain.handle('open-mixer', async (_, tracksCount) => {
  if (mixerWindow && !mixerWindow.isDestroyed()) {
    const nextWidth = preferredMixerWidth(tracksCount);
    const currentContent = mixerWindow.getContentBounds();
    if (nextWidth > currentContent.width) {
      mixerWindow.setContentSize(nextWidth, currentContent.height);
      requestedWidth = nextWidth;
      if (mixerWinBounds) mixerWinBounds.width = nextWidth;
    }
    mixerWindow.show();
    mixerWindow.focus();
    sendMixerState(true);
    return;
  }

  const isMac = process.platform === 'darwin';
  requestedWidth = mixerWinBounds ? mixerWinBounds.width : preferredMixerWidth(tracksCount);
  requestedHeight = mixerWinBounds ? mixerWinBounds.height : MIXER_HEIGHT;
  const bounds = mixerWinBounds
    ? clampMixerBounds(mixerWinBounds)
    : null;

  isMixerFullyLoaded = false;

  mixerWindow = new BrowserWindow({
    width: requestedWidth,
    height: requestedHeight,
    useContentSize: true, // Crucial: width and height are content dimensions
    minWidth: 500,
    minHeight: 350,
    parent: mainWindow || undefined,
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'logo.png'),
    ...(isMac ? { titleBarStyle: 'hiddenInset' } : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    backgroundColor: '#1b1712',
  });

  mixerWindow.loadFile(path.join(__dirname, '..', 'mixer.html'));

  if (bounds) {
    mixerWindow.setContentBounds(bounds);
  }

  // Allow startup positioning and OS inset adjustments to settle before capturing manual size changes
  setTimeout(() => {
    if (mixerWindow && !mixerWindow.isDestroyed()) {
      const cb = mixerWindow.getContentBounds();
      initialContentWidth = cb.width;
      initialContentHeight = cb.height;
      isMixerFullyLoaded = true;
    }
  }, 300);

  // Capture content position (x, y) on moved/resized immediately on startup
  const captureMixerPos = () => {
    if (mixerWindow && !mixerWindow.isDestroyed()) {
      const cb = mixerWindow.getContentBounds();
      if (mixerWinBounds) {
        mixerWinBounds.x = cb.x;
        mixerWinBounds.y = cb.y;
      } else {
        mixerWinBounds = { x: cb.x, y: cb.y, width: requestedWidth, height: requestedHeight };
      }
    }
  };
  mixerWindow.on('moved', captureMixerPos);
  mixerWindow.on('resized', captureMixerPos);

  mixerWindow.on('close', (event) => {
    if (isMixerBoundsReset) {
      mixerWinBounds = null;
      isMixerBoundsReset = false;
      forceCloseMixerWindow = true;
    }
    if (!forceCloseMixerWindow) {
      event.preventDefault();
      hideMixerWindow();
    }
  });

  mixerWindow.on('closed', () => {
    forceCloseMixerWindow = false;
    mixerWindow = null;
    sendMixerState(false);
  });

  sendMixerState(true);
});

const advancedFiles = { ambience: 'advanced-ambience.html', eq: 'advanced-eq.html', pan: 'advanced-pan.html' };

ipcMain.handle('open-advanced-pan', async (_, target = 'pan') => {
  const targetFile = advancedFiles[target] || advancedFiles.pan;
  if (advancedPanWindow && !advancedPanWindow.isDestroyed()) {
    const cb = advancedPanWindow.getContentBounds();
    if (cb.width < ADVANCED_PAN_WIDTH || cb.height < ADVANCED_PAN_HEIGHT) {
      advancedPanWindow.setContentSize(Math.max(cb.width, ADVANCED_PAN_WIDTH), Math.max(cb.height, ADVANCED_PAN_HEIGHT));
    }
    advancedPanWindow.loadFile(path.join(__dirname, '..', targetFile));
    advancedPanWindow.show();
    advancedPanWindow.focus();
    sendAdvancedPanState(true);
    return;
  }

  const isMac = process.platform === 'darwin';
  const savedBounds = advancedPanWinBounds
    ? {
        ...advancedPanWinBounds,
        width: Math.max(ADVANCED_PAN_WIDTH, advancedPanWinBounds.width || 0),
        height: Math.max(ADVANCED_PAN_HEIGHT, advancedPanWinBounds.height || 0),
      }
    : null;
  const bounds = savedBounds
    ? clampMixerBounds(savedBounds)
    : null;

  advancedPanWindow = new BrowserWindow({
    width: bounds ? bounds.width : ADVANCED_PAN_WIDTH,
    height: bounds ? bounds.height : ADVANCED_PAN_HEIGHT,
    useContentSize: true,
    minWidth: Math.min(ADVANCED_PAN_WIDTH, screen.getPrimaryDisplay().workArea.width),
    minHeight: Math.min(ADVANCED_PAN_HEIGHT, screen.getPrimaryDisplay().workArea.height),
    parent: mainWindow || undefined,
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'logo.png'),
    ...(isMac ? { titleBarStyle: 'hiddenInset' } : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    backgroundColor: '#1b1712',
    title: 'FocusDAW Advanced Effect Factory',
  });

  advancedPanWindow.loadFile(path.join(__dirname, '..', targetFile));
  if (bounds) advancedPanWindow.setContentBounds(bounds);

  const captureBounds = () => {
    if (advancedPanWindow && !advancedPanWindow.isDestroyed()) {
      const cb = advancedPanWindow.getContentBounds();
      advancedPanWinBounds = { x: cb.x, y: cb.y, width: cb.width, height: cb.height };
    }
  };
  advancedPanWindow.on('moved', captureBounds);
  advancedPanWindow.on('resized', captureBounds);

  advancedPanWindow.on('close', (event) => {
    if (!forceCloseAdvancedPanWindow) {
      event.preventDefault();
      hideAdvancedPanWindow();
    }
  });

  advancedPanWindow.on('closed', () => {
    forceCloseAdvancedPanWindow = false;
    advancedPanWindow = null;
    sendAdvancedPanState(false);
  });

  sendAdvancedPanState(true);
});

// Switch the (shared) advanced-effect window between its modules without
// recreating the window — keeps bounds, hide/close behaviour, and state intact.
ipcMain.handle('navigate-advanced', (_, target) => {
  if (!advancedPanWindow || advancedPanWindow.isDestroyed()) return;
  const file = advancedFiles[target] || advancedFiles.pan;
  advancedPanWindow.loadFile(path.join(__dirname, '..', file));
});

ipcMain.handle('close-mixer', async () => {
  hideMixerWindow();
});

ipcMain.handle('resize-mixer', async (_, tracksCount) => {
  if (!mixerWindow || mixerWindow.isDestroyed()) return;
  const currentContent = mixerWindow.getContentBounds();
  const nextWidth = preferredMixerWidth(tracksCount);
  // Grow only, and only when more channels need the room
  if (nextWidth > currentContent.width) {
    isMixerFullyLoaded = false;
    mixerWindow.setContentSize(nextWidth, currentContent.height);
    
    requestedWidth = nextWidth;
    if (mixerWinBounds) {
      mixerWinBounds.width = nextWidth;
    }
    
    setTimeout(() => {
      if (mixerWindow && !mixerWindow.isDestroyed()) {
        const cb = mixerWindow.getContentBounds();
        initialContentWidth = cb.width;
        initialContentHeight = cb.height;
        isMixerFullyLoaded = true;
      }
    }, 500);
  }
});

ipcMain.handle('report-mixer-size', (_, w, h) => {
  if (!isMixerFullyLoaded) return;
  if (mixerWindow && !mixerWindow.isDestroyed()) {
    const deltaW = w - initialContentWidth;
    const deltaH = h - initialContentHeight;
    
    if (mixerWinBounds) {
      mixerWinBounds.width = requestedWidth + deltaW;
      mixerWinBounds.height = requestedHeight + deltaH;
    } else {
      const cb = mixerWindow.getContentBounds();
      mixerWinBounds = {
        x: cb.x,
        y: cb.y,
        width: requestedWidth + deltaW,
        height: requestedHeight + deltaH
      };
    }
  }
});

ipcMain.handle('reset-mixer-bounds', () => {
  isMixerBoundsReset = true;
  mixerWinBounds = null;
  requestedWidth = 0;
  requestedHeight = 0;
  initialContentWidth = 0;
  initialContentHeight = 0;
  if (mixerWindow && !mixerWindow.isDestroyed()) {
    forceCloseMixerWindow = true;
    mixerWindow.close();
  }
});
