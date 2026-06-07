'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform:      process.platform,

  // File system
  openFolder:     ()              => ipcRenderer.invoke('open-folder'),
  selectFiles:    ()              => ipcRenderer.invoke('select-files'),
  readAudioFile:  (filePath)      => ipcRenderer.invoke('read-audio-file', filePath),

  // Project persistence
  saveProject:    (json, name)    => ipcRenderer.invoke('save-project', json, name),
  openProject:    ()              => ipcRenderer.invoke('open-project'),

  // MP3 encoding via ffmpeg
  encodeMp3:      (wavBuf, opts)  => ipcRenderer.invoke('encode-mp3', wavBuf, opts),

  // Window controls (Windows / Linux custom title bar)
  winAction:      (action)        => ipcRenderer.invoke('win-action', action),
  onWinState:     (cb)            => ipcRenderer.on('win-state', (_, s) => cb(s)),
});
