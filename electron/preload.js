'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform:      process.platform,

  // File system
  openFolder:     ()              => ipcRenderer.invoke('open-folder'),
  selectFiles:    ()              => ipcRenderer.invoke('select-files'),
  readAudioFile:  (filePath)      => ipcRenderer.invoke('read-audio-file', filePath),

  // Project persistence
  saveProject:    (json, name, targetPath) => ipcRenderer.invoke('save-project', json, name, targetPath),
  openProject:    ()              => ipcRenderer.invoke('open-project'),

  // MP3 encoding via ffmpeg (opts.cover = { data: base64, mime } for album art)
  encodeMp3:      (wavBuf, opts)  => ipcRenderer.invoke('encode-mp3', wavBuf, opts),

  // Save rendered audio via native OS dialog (with overwrite confirmation)
  saveAudio:      (buf, name)     => ipcRenderer.invoke('save-audio', buf, name),

  // Window controls (Windows / Linux custom title bar)
  winAction:      (action)        => ipcRenderer.invoke('win-action', action),
  onWinState:     (cb)            => ipcRenderer.on('win-state', (_, s) => cb(s)),
});
