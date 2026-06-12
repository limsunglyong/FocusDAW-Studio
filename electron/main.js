'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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
  return {
    name: fileName,
    displayName: fileName.replace(AUDIO_EXT, ''),
    path: filePath,
  };
}

function safeFileBase(name) {
  const cleaned = String(name || 'untitled')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[.\s]+$/g, '');
  return cleaned || 'untitled';
}

let mainWindow = null;
let mixerWindow = null;
let helpWindow = null;

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

  win.loadFile(path.join(__dirname, '..', 'studio.html'));

  // Forward close/minimize/maximize to renderer for custom title bar buttons
  win.on('maximize',   () => win.webContents.send('win-state', 'maximized'));
  win.on('unmaximize', () => win.webContents.send('win-state', 'normal'));

  win.on('closed', () => {
    mainWindow = null;
    if (mixerWindow && !mixerWindow.isDestroyed()) {
      mixerWindow.close();
    }
    if (helpWindow && !helpWindow.isDestroyed()) {
      helpWindow.close();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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

// Window control actions (for custom title bar on Windows/Linux)
ipcMain.handle('win-action', (_, action) => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.close();
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

let lastMixerBounds = null;
let isMixerBoundsReset = false;

function preferredMixerWidth(tracksCount) {
  const channelW = 92;
  const masterW = 400;
  const count = typeof tracksCount === 'number' ? tracksCount : 0;
  const contentWidth = count * channelW + masterW + 2;
  return Math.max(600, Math.min(1440, contentWidth));
}

// Mixer window control actions
ipcMain.handle('open-mixer', async (_, tracksCount) => {
  if (mixerWindow && !mixerWindow.isDestroyed()) {
    mixerWindow.focus();
    return;
  }

  const isMac = process.platform === 'darwin';
  const winWidth = lastMixerBounds ? lastMixerBounds.width : preferredMixerWidth(tracksCount);
  const winHeight = lastMixerBounds ? lastMixerBounds.height : 490;

  mixerWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    ...(lastMixerBounds ? { x: lastMixerBounds.x, y: lastMixerBounds.y } : {}),
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

  mixerWindow.on('close', () => {
    try {
      if (isMixerBoundsReset) {
        lastMixerBounds = null;
        isMixerBoundsReset = false;
      } else if (mixerWindow && !mixerWindow.isDestroyed()) {
        lastMixerBounds = mixerWindow.getBounds();
      }
    } catch (e) {
      console.error("Failed to save mixer bounds:", e);
    }
  });

  mixerWindow.on('closed', () => {
    mixerWindow = null;
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('mixer-state', false);
    }
  });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mixer-state', true);
  }
});

ipcMain.handle('close-mixer', async () => {
  if (mixerWindow && !mixerWindow.isDestroyed()) {
    mixerWindow.close();
  }
});

ipcMain.handle('resize-mixer', async (_, tracksCount) => {
  if (!mixerWindow || mixerWindow.isDestroyed()) return;
  const bounds = mixerWindow.getBounds();
  const nextWidth = preferredMixerWidth(tracksCount);
  if (nextWidth > bounds.width) {
    mixerWindow.setSize(nextWidth, bounds.height);
  }
});

ipcMain.handle('reset-mixer-bounds', () => {
  isMixerBoundsReset = true;
  lastMixerBounds = null;
  if (mixerWindow && !mixerWindow.isDestroyed()) {
    mixerWindow.close();
  }
});
