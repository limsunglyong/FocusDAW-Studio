'use strict';

const { app, BrowserWindow, ipcMain, dialog, screen, Menu, shell } = require('electron');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (err) {
  console.warn('[FocusDAW] electron-updater not available:', err && err.message);
}

// Shared renderer webPreferences. `devTools` is gated on !app.isPackaged so the
// DevTools / debug console is fully unavailable in packaged release builds
// (F12, Ctrl+Shift+I, right-click Inspect and the View menu all become no-ops),
// while local `npm start` development keeps it. Combined with the removed
// application menu (see app.whenReady), release builds expose no debug surface.
function buildWebPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    devTools: !app.isPackaged,
  };
}

let ffmpegPath = null;
try { ffmpegPath = require('ffmpeg-static'); } catch (e) {
  console.warn('[FocusDAW] ffmpeg-static not found — MP3 encoding unavailable. Run: npm install');
}

const AUDIO_EXT = /\.(mp3|wav|aiff?|m4a|ogg|flac)$/i;
const PROJECT_EXT = /\.focus$/i;

function assertTrustedIpc(event) {
  const senderUrl = event && event.senderFrame && event.senderFrame.url;
  if (!senderUrl || !senderUrl.startsWith('file://')) {
    throw new Error('Blocked IPC request from an untrusted renderer.');
  }
  const rendererPath = path.resolve(decodeURIComponent(new URL(senderUrl).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
  const appRoot = path.resolve(app.getAppPath());
  const relative = path.relative(appRoot, rendererPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Blocked IPC request from outside the application.');
  }
}

function assertFilePath(filePath, extensionPattern, label) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !extensionPattern.test(filePath)) {
    throw new Error(`Invalid ${label} path.`);
  }
  return path.resolve(filePath);
}

function assertDirectoryPath(dirPath) {
  if (typeof dirPath !== 'string' || !path.isAbsolute(dirPath)) {
    throw new Error('Invalid folder path.');
  }
  const resolved = path.resolve(dirPath);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error('Path is not a folder.');
  }
  return resolved;
}

// True when `child` resolves to a path strictly inside `parent`.
function isInside(parent, child) {
  try {
    const rel = path.relative(path.resolve(parent), path.resolve(String(child || '')));
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  } catch (e) { return false; }
}

function assertTempWavPath(filePath) {
  const resolved = assertFilePath(filePath, /\.wav$/i, 'temporary audio');
  // Accept the app's own temp folder (Documents\FocusDAW\Temp) AND the OS temp dir — the
  // native engine may render an export straight into os.tmpdir(), while renderer-staged
  // scratch lives under appTempDir().
  if (!isInside(appTempDir(), resolved) && !isInside(os.tmpdir(), resolved)) {
    throw new Error('Temporary audio path is outside the app temp directory.');
  }
  return resolved;
}

// All of the app's scratch files (recordings/bounces/consolidations before the first save,
// plus per-op export/decode intermediates) live under one discoverable folder in the user's
// Documents — "Documents\FocusDAW\Temp" — instead of buried in the OS temp dir, so the user
// can find and identify them. isUnderTempDir / assertTempWavPath were updated to treat this
// as an app temp root.
function appTempDir() {
  const dir = path.join(app.getPath('documents'), 'FocusDAW', 'Temp');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  return dir;
}

function tempFilePath(prefix, extension) {
  return path.join(appTempDir(), `${prefix}_${crypto.randomUUID()}.${extension}`);
}

function removeFileQuietly(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch (e) {
    if (!e || e.code !== 'ENOENT') console.warn(`[FocusDAW] Failed to remove temp file: ${filePath}`, e);
  }
}

// True when `p` lives inside an app temp root (Documents\FocusDAW\Temp or the OS temp dir).
// Used to tell an unsaved-project temp recording/consolidation (safe to delete after it's
// collected into the project folder) from a real file elsewhere (an imported stem's Bounces,
// a prior project's Audio folder on Save As) that must never be removed.
function isUnderTempDir(p) {
  return isInside(appTempDir(), p) || isInside(os.tmpdir(), p);
}

// Delete leftover scratch FILES sitting directly in the app temp folder (Documents\FocusDAW
// \Temp) — baked native WAVs (write-temp-audio) and per-op decode/export/mp3 intermediates.
// These are runtime
// only and never referenced by a saved OR autosaved project (their paths are non-persisted
// _nativePath / immediately-deleted temps), so any that survive are dead weight from a
// previous run. The FocusDAW category SUBFOLDERS (Recordings/Bounces/Consolidated) are
// left intact — an unsaved project's autosave restore may still need that staged audio.
// Run at startup (clears previous sessions) and at quit (clears this session, after the
// native engine has released its file handles).
function cleanupTempScratch() {
  let names;
  try { names = fs.readdirSync(appTempDir()); } catch (e) { return; }
  for (const name of names) {
    const p = path.join(appTempDir(), name);
    let stat; try { stat = fs.statSync(p); } catch (e) { continue; }
    if (stat.isFile()) removeFileQuietly(p); // open files (a live engine's baked WAV) fail to unlink and are skipped
  }
}

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

function scanAudioFolderRoot(dirPath) {
  const dir = assertDirectoryPath(dirPath);
  const items = fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && AUDIO_EXT.test(entry.name))
    .map(entry => audioItem(path.join(dir, entry.name)));
  return { folderName: path.basename(dir), items };
}

function safeFileBase(name) {
  const cleaned = String(name || 'untitled')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[.\s]+$/g, '');
  return cleaned || 'untitled';
}

function uniqueFilePath(dir, baseName, extension) {
  const safeBase = safeFileBase(baseName);
  const ext = String(extension || '').replace(/^\./, '') || 'wav';
  let candidate = path.join(dir, `${safeBase}.${ext}`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${safeBase} ${index}.${ext}`);
    index += 1;
  }
  return candidate;
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
// Look-ahead limiter used when Export has to make the mix LOUDER (see processAudioFfmpeg).
// 5 ms attack keeps drum transients intact while still catching them; 50 ms release is slow
// enough not to pump on a kick pattern. The headroom is because alimiter measures sample
// peaks only — inter-sample peaks can sit above them.
const LIMITER_ATTACK_MS = 5;
const LIMITER_RELEASE_MS = 50;
const LIMITER_ISP_HEADROOM_DB = 0.3;

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
let updaterReady = false;
let updaterBusy = false;
let updaterDownloaded = false;

function updatePayload(state, extra = {}) {
  return {
    state,
    currentVersion: app.getVersion(),
    ...extra,
  };
}

function releasePayload(info) {
  return {
    latestVersion: (info && (info.version || info.tag || info.releaseName)) || null,
    releaseName: (info && info.releaseName) || null,
    releaseDate: (info && info.releaseDate) || null,
    releaseNotes: (info && info.releaseNotes) || null,
    htmlUrl: 'https://github.com/limsunglyong/FocusDAW-Studio/releases/latest',
  };
}

function setupAutoUpdater() {
  if (updaterReady || !autoUpdater) return;
  updaterReady = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    updaterBusy = true;
    sendToMain('updater-state', updatePayload('checking'));
  });
  autoUpdater.on('update-available', (info) => {
    updaterBusy = false;
    updaterDownloaded = false;
    sendToMain('updater-state', updatePayload('available', releasePayload(info)));
  });
  autoUpdater.on('update-not-available', (info) => {
    updaterBusy = false;
    updaterDownloaded = false;
    sendToMain('updater-state', updatePayload('current', releasePayload(info)));
  });
  autoUpdater.on('download-progress', (progress) => {
    sendToMain('updater-state', updatePayload('downloading', {
      percent: Number(progress && progress.percent) || 0,
      transferred: Number(progress && progress.transferred) || 0,
      total: Number(progress && progress.total) || 0,
      bytesPerSecond: Number(progress && progress.bytesPerSecond) || 0,
    }));
  });
  autoUpdater.on('update-downloaded', (info) => {
    updaterBusy = false;
    updaterDownloaded = true;
    sendToMain('updater-state', updatePayload('downloaded', releasePayload(info)));
  });
  autoUpdater.on('error', (err) => {
    updaterBusy = false;
    console.warn('[FocusDAW] update check failed:', err && err.message ? err.message : err);
    sendToMain('updater-state', updatePayload('current', { latestVersion: app.getVersion() }));
  });
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1258,
    minHeight: 600,
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'logo.png'),
    ...(isMac ? { titleBarStyle: 'hiddenInset' } : { frame: false }),
    webPreferences: buildWebPreferences(),
    backgroundColor: '#1b1712',
  });

  mainWindow = win;

  win.webContents.on('console-message', (details) => {
    const { message } = details;
    if (typeof message === 'string' && message.startsWith('[KeyDetection]')) {
      console.log(message);
    }
  });

  // DevTools shortcut (F12 / Ctrl+Shift+I / Cmd+Opt+I). The application menu is
  // removed (Menu.setApplicationMenu(null)), which also strips the default
  // View-role accelerators, so in dev there was otherwise no way to open the
  // console. Gate on !app.isPackaged so packaged release builds stay fully
  // locked down (devTools is also disabled there via buildWebPreferences()).
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = (input.key || '').toLowerCase();
      const toggle = key === 'f12' || ((input.control || input.meta) && input.shift && key === 'i');
      if (toggle) {
        event.preventDefault();
        win.webContents.toggleDevTools();
      }
    });
  }

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
  // Pass the bundled ffmpeg path so the native engine can decode compressed files
  // (e.g. MP3) accurately. JUCE's own MP3 reader reports wrong lengths (over/under by
  // tens of seconds), which streamed-seek drift and skewed automation timing; decoding
  // to PCM via ffmpeg gives exact length + content. Env var avoids arg-quoting issues.
  const ffmpegForEngine = resolveFfmpegPath();
  try {
    audioEngineProc = spawn(binaryPath, ['--port', '8082'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: ffmpegForEngine ? { ...process.env, FOCUSDAW_FFMPEG: ffmpegForEngine } : process.env
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
  // Remove the default application menu entirely. Besides hiding the native menu
  // bar, this strips the built-in View ▸ Toggle Developer Tools item and the
  // Alt-key menu, so a release build has no menu path to the debug console.
  Menu.setApplicationMenu(null);
  cleanupTempScratch(); // clear dead scratch from previous runs before this session writes any
  setupAutoUpdater();
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
  stopAudioEngine();       // release native file handles first…
  cleanupTempScratch();    // …then remove this session's scratch WAVs
});

// ── IPC handlers ──────────────────────────────────────────────────────────────

// Scan a folder for audio files
ipcMain.handle('open-folder', async (event) => {
  assertTrustedIpc(event);
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Stem Folder',
  });
  if (canceled || !filePaths[0]) return [];
  return scanAudioFolderRoot(filePaths[0]).items;
});

ipcMain.handle('scan-audio-folder', async (event, folderPath) => {
  assertTrustedIpc(event);
  return scanAudioFolderRoot(folderPath);
});

// Select individual audio files
ipcMain.handle('select-files', async (event) => {
  assertTrustedIpc(event);
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'aif', 'aiff', 'm4a', 'ogg', 'flac'] }],
    title: 'Import Audio Files',
  });
  if (canceled) return [];
  return filePaths.map(p => audioItem(p));
});

// Read an audio file and return its raw bytes as ArrayBuffer
ipcMain.handle('read-audio-file', async (event, filePath) => {
  assertTrustedIpc(event);
  const safePath = assertFilePath(filePath, AUDIO_EXT, 'audio file');
  const buf = fs.readFileSync(safePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

// Write a temporary WAV file from raw bytes (used for demo tracks sync to native engine)
ipcMain.handle('write-temp-audio', async (event, wavBuffer, fileName) => {
  assertTrustedIpc(event);
  const base = safeFileBase(path.basename(String(fileName || 'audio'), path.extname(String(fileName || 'audio'))));
  const tmpWav = tempFilePath(base, 'wav');
  fs.writeFileSync(tmpWav, Buffer.from(wavBuffer));
  return tmpWav;
});

// Save a rendered bounce without prompting:
//   saved   -> <Project> Audio/Bounces/Bounce ....wav
//   unsaved -> %TEMP%/temporary/FocusDAW Bounces/ (collected into the project on Save As)
// sourcePath is no longer used to pick the folder: writing next to imported stems
// littered the user's stem folder with Bounces/Recordings/Consolidated and left them
// behind after save (not under temp, so not cleaned up). Everything now stages in temp
// until the project is saved.
ipcMain.handle('save-bounce-audio', async (event, wavBuffer, projectPath, fileName, sourcePath) => {
  assertTrustedIpc(event);
  let bounceDir = null;
  if (projectPath) {
    const safeProjectPath = assertFilePath(projectPath, PROJECT_EXT, 'project');
    const projectBase = safeFileBase(path.basename(safeProjectPath, path.extname(safeProjectPath)));
    bounceDir = path.join(path.dirname(safeProjectPath), `${projectBase} Audio`, 'Bounces');
  } else {
    bounceDir = path.join(appTempDir(), 'FocusDAW Bounces');
  }
  fs.mkdirSync(bounceDir, { recursive: true });
  const rawName = String(fileName || 'Bounce.wav');
  const base = safeFileBase(path.basename(rawName, path.extname(rawName) || '.wav'));
  const outPath = uniqueFilePath(bounceDir, base, 'wav');
  fs.writeFileSync(outPath, Buffer.from(wavBuffer));
  return {
    saved: true,
    path: outPath,
    fileName: path.basename(outPath),
    dir: bounceDir,
  };
});

// Save a consolidated clip render (Phase 7 "Consolidate Clips"):
//   saved   -> <Project> Audio/Consolidated/<name>.wav
//   unsaved -> %TEMP%/temporary/FocusDAW Consolidated/ (collected on Save As)
// This MUST succeed even before the first save — a consolidated source with no filePath
// cannot be reloaded on reopen — so unsaved projects stage in temp (not next to imported
// stems, which littered the stem folder and left files behind after save).
ipcMain.handle('save-consolidated-audio', async (event, wavBuffer, projectPath, fileName, sourcePath) => {
  assertTrustedIpc(event);
  let outDir = null;
  if (projectPath) {
    const safeProjectPath = assertFilePath(projectPath, PROJECT_EXT, 'project');
    const projectBase = safeFileBase(path.basename(safeProjectPath, path.extname(safeProjectPath)));
    outDir = path.join(path.dirname(safeProjectPath), `${projectBase} Audio`, 'Consolidated');
  } else {
    outDir = path.join(appTempDir(), 'FocusDAW Consolidated');
  }
  fs.mkdirSync(outDir, { recursive: true });
  const rawName = String(fileName || 'Consolidated.wav');
  const base = safeFileBase(path.basename(rawName, path.extname(rawName) || '.wav'));
  const outPath = uniqueFilePath(outDir, base, 'wav');
  fs.writeFileSync(outPath, Buffer.from(wavBuffer));
  return {
    saved: true,
    path: outPath,
    fileName: path.basename(outPath),
    dir: outDir,
    temp: !projectPath,
  };
});

// Choose a project save path WITHOUT writing (Save As collect flow, Phase 7). The renderer
// needs the path up front so it can copy the project's audio into that folder and rewrite
// the source paths BEFORE the .focus is written (save-project does the actual write after).
ipcMain.handle('choose-project-path', async (event, defaultName) => {
  assertTrustedIpc(event);
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: safeFileBase(defaultName) + '.focus',
    filters: [{ name: 'FocusDAW Project', extensions: ['focus'] }],
    title: 'Save Project',
  });
  if (canceled || !filePath) return { canceled: true };
  return { path: filePath, dir: path.dirname(filePath) };
});

// Collect the project's app-generated audio (recordings / bounces / consolidations) into the
// project's own "<Project> Audio/<category>/" folder and return each file's path RELATIVE to
// the .focus, so the saved project is self-contained and portable (Save As copy rules, Phase 7).
// Imported file-track stems are intentionally NOT collected (user decision 2026-07-21): they
// stay referenced where they are. Files already inside the project folder are left in place and
// just reported with their relative path (idempotent on a plain re-save).
//   items: [{ key, filePath (absolute), category }]  category ∈ Recordings|Bounces|Consolidated
//   returns: [{ key, relPath, absPath }]  or  { key, error } when a copy fails
ipcMain.handle('collect-project-audio', async (event, targetPath, items) => {
  assertTrustedIpc(event);
  const safeProjectPath = assertFilePath(targetPath, PROJECT_EXT, 'project');
  const projectDir = path.dirname(safeProjectPath);
  const projectBase = safeFileBase(path.basename(safeProjectPath, path.extname(safeProjectPath)));
  const audioRoot = path.join(projectDir, `${projectBase} Audio`);
  const CATEGORIES = new Set(['Recordings', 'Bounces', 'Consolidated']);
  const asRel = (abs) => path.relative(projectDir, abs).split(path.sep).join('/');
  const norm = (p) => { try { const r = path.resolve(String(p || '')); return process.platform === 'win32' ? r.toLowerCase() : r; } catch (e) { return ''; } };
  // Several sources can reference the SAME physical file (an Audio In track's primary
  // source + a Take source both point at one recording WAV). Collect each unique file
  // ONCE and map every source that shares it to the same destination — otherwise the
  // first copy deletes the temp original and the second source is left pointing at a
  // now-missing temp path (the "sources[1] keeps a temp filePath" reopen bug).
  const done = new Map(); // normalized srcAbs -> { relPath, absPath }
  const out = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    const key = item && item.key;
    try {
      const srcAbs = assertFilePath(item && item.filePath, AUDIO_EXT, 'source audio');
      const nk = norm(srcAbs);
      if (done.has(nk)) { out.push({ key, ...done.get(nk) }); continue; } // shared file already collected this run
      const category = CATEGORIES.has(item.category) ? item.category : 'Recordings';
      if (!fs.existsSync(srcAbs)) {
        // Source file is gone. It may already have been collected under this project by an
        // older build that left a shared Take source pointing at the now-deleted temp path
        // — if a same-named file sits in the target category folder, adopt it so the stale
        // reference heals on this re-save instead of staying broken.
        const healAbs = path.join(audioRoot, category, path.basename(srcAbs));
        if (fs.existsSync(healAbs)) {
          const d = { relPath: asRel(healAbs), absPath: healAbs };
          done.set(nk, d); out.push({ key, ...d });
          continue;
        }
        out.push({ key, error: 'missing' });
        continue;
      }
      // Already inside this project's Audio folder → keep in place, just report relative.
      const rel = path.relative(audioRoot, srcAbs);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        const d = { relPath: asRel(srcAbs), absPath: srcAbs };
        done.set(nk, d); out.push({ key, ...d });
        continue;
      }
      const destDir = path.join(audioRoot, category);
      fs.mkdirSync(destDir, { recursive: true });
      const ext = (path.extname(srcAbs).slice(1) || 'wav').toLowerCase();
      const base = safeFileBase(path.basename(srcAbs, path.extname(srcAbs)));
      const destAbs = uniqueFilePath(destDir, base, ext);
      fs.copyFileSync(srcAbs, destAbs);
      // The temp original (an unsaved-project recording/consolidation under the OS
      // temp dir) is now safely inside the project folder — remove it so temp files
      // don't accumulate. Real files elsewhere are left untouched.
      if (isUnderTempDir(srcAbs)) removeFileQuietly(srcAbs);
      const d = { relPath: asRel(destAbs), absPath: destAbs };
      done.set(nk, d); out.push({ key, ...d });
    } catch (err) {
      console.warn('[collect] failed to collect source', key, err);
      out.push({ key, error: String(err && err.message || err) });
    }
  }
  return { items: out, dir: audioRoot };
});

// Clean Up Unused Recordings (Phase 7): list app-generated WAVs in the project's
// "<Project> Audio/{Recordings,Bounces,Consolidated}/" that no source references.
// The renderer passes the FULL referenced set — current project sources PLUS every
// live undo/redo snapshot's sources — so a file that an undo could bring back is
// treated as still in use and never listed. Nothing is deleted here (scan only).
//   referenced: string[] of absolute source paths
//   returns: { items: [{ path, name, category, size }], audioRoot }
ipcMain.handle('scan-unused-recordings', async (event, projectPath, referenced) => {
  assertTrustedIpc(event);
  const safeProjectPath = assertFilePath(projectPath, PROJECT_EXT, 'project');
  const projectDir = path.dirname(safeProjectPath);
  const projectBase = safeFileBase(path.basename(safeProjectPath, path.extname(safeProjectPath)));
  const audioRoot = path.join(projectDir, `${projectBase} Audio`);
  // Windows paths are case-insensitive; normalise both sides so a case/separator
  // difference doesn't make a referenced file look unused (which would trash it).
  const norm = (p) => {
    try { const r = path.resolve(String(p || '')); return process.platform === 'win32' ? r.toLowerCase() : r; }
    catch (e) { return ''; }
  };
  const refSet = new Set((Array.isArray(referenced) ? referenced : []).map(norm).filter(Boolean));
  const items = [];
  for (const category of ['Recordings', 'Bounces', 'Consolidated']) {
    const dir = path.join(audioRoot, category);
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { continue; } // folder may not exist
    for (const name of names) {
      if (!/\.wav(\.part)?$/i.test(name)) continue; // stray .wav / orphaned .wav.part
      const abs = path.join(dir, name);
      let stat; try { stat = fs.statSync(abs); } catch (e) { continue; }
      if (!stat.isFile()) continue;
      if (refSet.has(norm(abs))) continue; // still referenced somewhere → keep
      items.push({ path: abs, name, category, size: stat.size });
    }
  }
  return { items, audioRoot };
});

// Move the given files to the OS recycle bin (recoverable). Called after the user
// confirms in the Clean Up Unused Recordings dialog. shell.trashItem keeps the files
// restorable, matching the "safe cleanup" policy.
ipcMain.handle('trash-files', async (event, paths) => {
  assertTrustedIpc(event);
  const trashed = [], failed = [];
  for (const p of (Array.isArray(paths) ? paths : [])) {
    try {
      const abs = path.resolve(String(p || ''));
      if (!/\.wav(\.part)?$/i.test(abs)) throw new Error('Refusing to trash a non-audio file.');
      if (!fs.existsSync(abs)) { trashed.push(abs); continue; } // already gone → treat as done
      await shell.trashItem(abs);
      trashed.push(abs);
    } catch (err) {
      failed.push({ path: String(p), error: String(err && err.message || err) });
    }
  }
  return { trashed, failed };
});

ipcMain.handle('prepare-recording-path', async (event, projectPath, fileName, sourcePath) => {
  assertTrustedIpc(event);
  let recordingDir;
  if (projectPath) {
    const safeProjectPath = assertFilePath(projectPath, PROJECT_EXT, 'project');
    const projectBase = safeFileBase(path.basename(safeProjectPath, path.extname(safeProjectPath)));
    recordingDir = path.join(path.dirname(safeProjectPath), `${projectBase} Audio`, 'Recordings');
  } else {
    // Unsaved: stage in temp (not next to imported stems). Collected on Save As.
    recordingDir = path.join(appTempDir(), 'FocusDAW Recordings');
  }
  fs.mkdirSync(recordingDir, { recursive: true });
  const base = safeFileBase(path.basename(String(fileName || 'Recording'), path.extname(String(fileName || 'Recording'))));
  const finalPath = uniqueFilePath(recordingDir, base, 'wav');
  return { partPath: `${finalPath}.part`, finalPath };
});

ipcMain.handle('finalize-recording', async (event, partPath, finalPath) => {
  assertTrustedIpc(event);
  const part = path.resolve(String(partPath || ''));
  const final = assertFilePath(finalPath, AUDIO_EXT, 'recording');
  if (part !== `${final}.part`) throw new Error('Invalid recording temporary path.');
  fs.renameSync(part, final);
  return { path: final, fileName: path.basename(final) };
});

// Save project via native Save dialog
// The project name always follows the FILE NAME. The renderer exports the json
// before the Save dialog runs, so json.projectName still holds the old in-app
// name at this point — stamp the chosen file's basename in before writing, or
// the file would claim a name that contradicts what it is saved as (a project
// saved as "untitled123.focus" kept reporting "untitled" on reopen).
function stampProjectNameFromPath(json, filePath) {
  const name = path.basename(filePath).replace(/\.focus$/i, '');
  if (json && typeof json === 'object' && name) json.projectName = name;
  return json;
}

ipcMain.handle('save-project', async (event, json, defaultName, targetPath) => {
  assertTrustedIpc(event);
  if (targetPath) {
    const safeTargetPath = assertFilePath(targetPath, PROJECT_EXT, 'project');
    stampProjectNameFromPath(json, safeTargetPath);
    fs.writeFileSync(safeTargetPath, JSON.stringify(json, null, 2), 'utf8');
    return { saved: true, path: safeTargetPath, dir: path.dirname(safeTargetPath) };
  }
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: safeFileBase(defaultName) + '.focus',
    filters: [{ name: 'FocusDAW Project', extensions: ['focus'] }],
    title: 'Save Project',
  });
  if (canceled || !filePath) return { saved: false };
  stampProjectNameFromPath(json, filePath);
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf8');
  return { saved: true, path: filePath, dir: path.dirname(filePath) };
});

// Open project via native Open dialog
ipcMain.handle('open-project', async (event) => {
  assertTrustedIpc(event);
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

ipcMain.handle('read-project-file', async (event, filePath) => {
  assertTrustedIpc(event);
  const safePath = assertFilePath(filePath, PROJECT_EXT, 'project');
  return {
    text: fs.readFileSync(safePath, 'utf8'),
    path: safePath,
    dir: path.dirname(safePath),
  };
});

// Encode WAV → MP3 via ffmpeg (with ID3v2 tags + optional embedded cover art)
ipcMain.handle('encode-mp3', async (event, wavBuffer, options) => {
  assertTrustedIpc(event);
  const resolvedFfmpegPath = resolveFfmpegPath();
  if (!resolvedFfmpegPath) throw new Error('ffmpeg-static not installed. Run: npm install');
  if (!fs.existsSync(resolvedFfmpegPath)) throw new Error(`ffmpeg executable not found: ${resolvedFfmpegPath}`);
  const { bitrate = 320, sampleRate = 44100, meta = {}, cover = null } = options || {};
  const base   = `focusdaw_${crypto.randomUUID()}`;
  const tmpWav = path.join(appTempDir(), base + '.wav');
  const tmpMp3 = path.join(appTempDir(), base + '.mp3');

  let tmpCover = null;
  try {
    fs.writeFileSync(tmpWav, Buffer.from(wavBuffer));

    // Album art: write the base64 image bytes to a temp file for ffmpeg to attach
    if (cover && cover.data) {
      const ext = cover.mime === 'image/png' ? 'png'
        : cover.mime === 'image/webp' ? 'webp'
        : cover.mime === 'image/gif' ? 'gif'
        : 'jpg';
      tmpCover = path.join(appTempDir(), base + '_cover.' + ext);
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

    const addMeta = (k, v) => { if (v != null && String(v).length) args.push('-metadata', `${k}=${v}`); };
    addMeta('title', meta.title);
    addMeta('artist', meta.artist);
    addMeta('album_artist', meta.artist);
    addMeta('composer', meta.artist);
    addMeta('album', meta.album);
    addMeta('date', meta.date || meta.year);
    args.push(tmpMp3);

    await runFfmpeg(resolvedFfmpegPath, args);
    const mp3Buf = fs.readFileSync(tmpMp3);
    return mp3Buf.buffer.slice(mp3Buf.byteOffset, mp3Buf.byteOffset + mp3Buf.byteLength);
  } finally {
    removeFileQuietly(tmpWav);
    removeFileQuietly(tmpMp3);
    removeFileQuietly(tmpCover);
  }
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
  const tmpIn = path.join(appTempDir(), base + '_in.wav');
  const tmpOut = path.join(appTempDir(), base + '_out.wav');
  fs.writeFileSync(tmpIn, Buffer.from(wavBuffer));

  const stage1 = path.join(appTempDir(), base + '_s1.wav');
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

    // Getting LOUDER needs a limiter, not loudnorm's dynamic mode.
    //
    // loudnorm honours `linear=true` only while the required gain is NEGATIVE. Any positive
    // gain would push true peak past TP, so it silently falls back to Dynamic mode — a
    // time-varying gain whose built-in limiter mangles transients. Measured on a kick+bed
    // signal: at I=-9 the applied gain swung over a 16.9 dB range and the target was still
    // missed by 3.75 dB (user report: drums distort at -9 LUFS, subtly at -14).
    //
    // So: static gain first, then a real look-ahead limiter, then one measured trim.
    // Same signal, same target: gain swing 5.7 dB and the target missed by 0.74 dB.
    // Attenuating still goes through linear loudnorm, which is exact and transparent there.
    const needGain = loudnorm && measured && Number.isFinite(parseFloat(measured.input_i))
      ? Number(loudnorm.I ?? -14) - parseFloat(measured.input_i)
      : 0;

    if (loudnorm && needGain > 0.05) {
      const tp = Number.isFinite(loudnorm.TP) ? loudnorm.TP : -1;
      // alimiter watches SAMPLE peaks, not inter-sample peaks, so aim below the true-peak
      // ceiling — without this margin a -1 dBTP target can still overshoot after resampling.
      const ceil = Math.pow(10, (tp - LIMITER_ISP_HEADROOM_DB) / 20).toFixed(4);
      const lim = `alimiter=limit=${ceil}:attack=${LIMITER_ATTACK_MS}:release=${LIMITER_RELEASE_MS}:level=disabled`;

      // Stage 1 — tempo (once) + the whole gain, caught by the limiter.
      const s1chain = [tempoFilter, `volume=${needGain.toFixed(2)}dB`, lim].filter(Boolean).join(',');
      await runFfmpeg(resolvedFfmpegPath, ['-y', '-i', tmpIn, '-filter:a', s1chain, '-ar', String(sampleRate), stage1]);

      // Limiting costs a little loudness; measure what we actually got and trim once.
      // One trim lands within ~0.1 dB; more passes creep closer but re-limit harder and
      // start moving the gain around again, which is the thing we are removing.
      const s1log = await runFfmpeg(resolvedFfmpegPath,
        ['-y', '-i', stage1, '-filter:a', buildLoudnormFilter(loudnorm, null, 'json'), '-f', 'null', '-']);
      const m1 = parseLoudnormJson(s1log);
      const trim = m1 && Number.isFinite(parseFloat(m1.input_i))
        ? Number(loudnorm.I ?? -14) - parseFloat(m1.input_i)
        : 0;

      if (Math.abs(trim) > 0.05) {
        await runFfmpeg(resolvedFfmpegPath, ['-y', '-i', stage1, '-filter:a',
          `volume=${trim.toFixed(2)}dB,${lim}`, '-ar', String(sampleRate), tmpOut]);
      } else {
        fs.copyFileSync(stage1, tmpOut);
      }
    } else {
      // Attenuating (or no loudnorm): tempo + linear loudnorm exactly as before.
      const finalChain = [tempoFilter];
      if (loudnorm) finalChain.push(buildLoudnormFilter(loudnorm, measured, 'summary'));
      const chain = finalChain.filter(Boolean).join(',');
      const args = ['-y', '-i', tmpIn];
      if (chain) args.push('-filter:a', chain);
      args.push('-ar', String(sampleRate), tmpOut);
      await runFfmpeg(resolvedFfmpegPath, args);
    }

    const out = fs.readFileSync(tmpOut);
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  } finally {
    try { fs.unlinkSync(tmpIn); } catch (e) {}
    try { fs.unlinkSync(tmpOut); } catch (e) {}
    try { fs.unlinkSync(stage1); } catch (e) {}
  }
}

ipcMain.handle('process-audio', (event, wavBuffer, options) => {
  assertTrustedIpc(event);
  return processAudioFfmpeg(wavBuffer, options);
});

// Backward-compatible alias: tempo-only processing.
ipcMain.handle('process-tempo', (event, wavBuffer, options) => {
  assertTrustedIpc(event);
  const { rate = 1, sampleRate = 44100 } = options || {};
  return processAudioFfmpeg(wavBuffer, { rate, sampleRate, loudnorm: null });
});

// Save rendered audio via native Save dialog (handles overwrite confirmation)
ipcMain.handle('save-audio', async (event, buffer, defaultName) => {
  assertTrustedIpc(event);
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

function inspectPcmWav(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a PCM WAV file.');
  }

  let channels = 2;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let dataStart = -1;
  let dataLen = 0;
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const chunkStart = pos + 8;
    if (id === 'fmt ' && size >= 16) {
      channels = buf.readUInt16LE(chunkStart + 2);
      sampleRate = buf.readUInt32LE(chunkStart + 4);
      bitsPerSample = buf.readUInt16LE(chunkStart + 14);
    } else if (id === 'data') {
      dataStart = chunkStart;
      dataLen = Math.min(size, buf.length - chunkStart);
      break;
    }
    pos = chunkStart + size + (size % 2);
  }

  if (dataStart < 0 || dataLen <= 0) {
    return { exists: true, bytes: buf.length, samples: 0, peak: 0, rms: 0, duration: 0, silent: true };
  }
  if (bitsPerSample !== 16) {
    throw new Error(`Unsupported WAV bit depth for inspection: ${bitsPerSample}`);
  }

  let sumSq = 0;
  let peak = 0;
  let samples = 0;
  const end = dataStart + dataLen;
  for (let i = dataStart; i + 1 < end; i += 2) {
    const v = buf.readInt16LE(i) / 32768;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sumSq += v * v;
    samples++;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, samples));
  const duration = samples / Math.max(1, channels) / Math.max(1, sampleRate);
  return {
    exists: true,
    bytes: buf.length,
    samples,
    peak,
    rms,
    duration,
    silent: peak < 0.0001 && rms < 0.00001,
  };
}

ipcMain.handle('inspect-native-audio', async (event, tempFilePath) => {
  assertTrustedIpc(event);
  const safeTempFilePath = assertTempWavPath(tempFilePath);
  if (!fs.existsSync(safeTempFilePath)) {
    return { exists: false, silent: true, error: 'Native export temp file not found.' };
  }
  try {
    return inspectPcmWav(safeTempFilePath);
  } catch (err) {
    return {
      exists: true,
      silent: false,
      error: err && err.message ? err.message : String(err || 'Audio inspection failed.'),
    };
  }
});

// Save natively rendered audio file (supports WAV copy and MP3 encoding with tags/cover)
ipcMain.handle('save-native-audio', async (event, tempFilePath, format, options, defaultName) => {
  assertTrustedIpc(event);
  const safeTempFilePath = assertTempWavPath(tempFilePath);
  const ext = format === 'mp3' ? 'mp3' : 'wav';
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: ext.toUpperCase() + ' Audio', extensions: [ext] }],
    title: 'Save Audio File',
  });
  if (canceled || !filePath) return { saved: false };

  let tmpCover = null;
  try {
    if (format === 'wav') {
      fs.copyFileSync(safeTempFilePath, filePath);
      return { saved: true };
    } else {
      const resolvedFfmpegPath = resolveFfmpegPath();
      if (!resolvedFfmpegPath) throw new Error('ffmpeg-static not installed. Run: npm install');
      if (!fs.existsSync(resolvedFfmpegPath)) throw new Error(`ffmpeg executable not found: ${resolvedFfmpegPath}`);
      
      const { bitrate = 320, sampleRate = 44100, meta = {}, cover = null } = options || {};
      
      if (cover && cover.data) {
        const base = `focusdaw_cover_${crypto.randomUUID()}`;
        const extCover = cover.mime === 'image/png' ? 'png'
          : cover.mime === 'image/webp' ? 'webp'
          : cover.mime === 'image/gif' ? 'gif'
          : 'jpg';
        tmpCover = path.join(appTempDir(), base + '.' + extCover);
        fs.writeFileSync(tmpCover, Buffer.from(cover.data, 'base64'));
      }

      const args = ['-y', '-i', safeTempFilePath];
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

      return { saved: true };
    }
  } catch (err) {
    console.error('[FocusDAW] save-native-audio error:', err);
    throw err;
  } finally {
    removeFileQuietly(safeTempFilePath);
    removeFileQuietly(tmpCover);
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
    webPreferences: buildWebPreferences(),
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

ipcMain.handle('open-external-url', async (event, url) => {
  assertTrustedIpc(event);
  const parsed = new URL(String(url || ''));
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') {
    throw new Error('Blocked external URL.');
  }
  await shell.openExternal(parsed.toString());
  return true;
});

ipcMain.handle('updater-check', async (event) => {
  assertTrustedIpc(event);
  if (!autoUpdater) {
    sendToMain('updater-state', updatePayload('current', { latestVersion: app.getVersion() }));
    return false;
  }
  if (!app.isPackaged) {
    sendToMain('updater-state', updatePayload('current', { latestVersion: app.getVersion() }));
    return false;
  }
  if (updaterBusy) {
    sendToMain('updater-state', updatePayload('current', { latestVersion: app.getVersion() }));
    return false;
  }
  setupAutoUpdater();
  await autoUpdater.checkForUpdates();
  return true;
});

ipcMain.handle('updater-download', async (event) => {
  assertTrustedIpc(event);
  if (!autoUpdater) throw new Error('electron-updater is not available.');
  if (!app.isPackaged) throw new Error('Auto update downloads run in the packaged app.');
  if (updaterBusy) return false;
  updaterBusy = true;
  await autoUpdater.downloadUpdate();
  return true;
});

ipcMain.handle('updater-install', async (event) => {
  assertTrustedIpc(event);
  if (!autoUpdater) throw new Error('electron-updater is not available.');
  if (!updaterDownloaded) throw new Error('No downloaded update is ready to install.');
  autoUpdater.quitAndInstall(false, true);
  return true;
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

// Send an IPC message to the main renderer, tolerating a torn-down render frame.
// isDestroyed()/isCrashed() don't always cover the transient "render frame was
// disposed" state (e.g. while the renderer is being recreated after a child-process
// crash), so guard the send itself with try/catch to avoid an unhandled rejection.
function sendToMain(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  if (!wc || wc.isDestroyed() || wc.isCrashed()) return;
  try {
    wc.send(channel, payload);
  } catch (err) {
    console.warn(`[main] dropped IPC '${channel}' (renderer frame unavailable):`, err && err.message);
  }
}

function sendMixerState(isOpen) {
  sendToMain('mixer-state', isOpen);
}

function sendAdvancedPanState(isOpen) {
  sendToMain('advanced-pan-state', isOpen);
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

function preferredMixerWidth(trackInfo) {
  const channelW = 92;
  const audioInChannelW = 138;
  const masterW = 400;
  const count = typeof trackInfo === 'number' ? trackInfo : (trackInfo && typeof trackInfo.tracksCount === 'number' ? trackInfo.tracksCount : 0);
  const audioInCount = trackInfo && typeof trackInfo === 'object' && typeof trackInfo.audioInCount === 'number'
    ? Math.max(0, Math.min(count, trackInfo.audioInCount))
    : 0;
  const fileCount = Math.max(0, count - audioInCount);
  const contentWidth = fileCount * channelW + audioInCount * audioInChannelW + masterW + 2;
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
    webPreferences: buildWebPreferences(),
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
    webPreferences: buildWebPreferences(),
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
