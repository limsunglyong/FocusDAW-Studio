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

  win.loadFile(path.join(__dirname, '..', 'studio.html'));

  // Forward close/minimize/maximize to renderer for custom title bar buttons
  win.on('maximize',   () => win.webContents.send('win-state', 'maximized'));
  win.on('unmaximize', () => win.webContents.send('win-state', 'normal'));
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

// Encode WAV → MP3 via ffmpeg
ipcMain.handle('encode-mp3', async (_, wavBuffer, options) => {
  if (!ffmpegPath) throw new Error('ffmpeg-static not installed. Run: npm install');
  const { bitrate = 320, sampleRate = 44100 } = options || {};
  const base   = `focusdaw_${Date.now()}`;
  const tmpWav = path.join(os.tmpdir(), base + '.wav');
  const tmpMp3 = path.join(os.tmpdir(), base + '.mp3');

  fs.writeFileSync(tmpWav, Buffer.from(wavBuffer));

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-y',
      '-i',  tmpWav,
      '-b:a', `${bitrate}k`,
      '-ar',  String(sampleRate),
      tmpMp3,
    ]);
    proc.stderr.on('data', () => {}); // suppress ffmpeg log noise
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)));
    proc.on('error', reject);
  });

  const mp3Buf = fs.readFileSync(tmpMp3);
  try { fs.unlinkSync(tmpWav); fs.unlinkSync(tmpMp3); } catch (e) {}
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
