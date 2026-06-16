'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform:      process.platform,

  // File system
  openFolder:     ()              => ipcRenderer.invoke('open-folder'),
  selectFiles:    ()              => ipcRenderer.invoke('select-files'),
  readAudioFile:  (filePath)      => ipcRenderer.invoke('read-audio-file', filePath),
  writeTempAudio: (wavBuf, fileName) => ipcRenderer.invoke('write-temp-audio', wavBuf, fileName),

  // Project persistence
  saveProject:    (json, name, targetPath) => ipcRenderer.invoke('save-project', json, name, targetPath),
  openProject:    ()              => ipcRenderer.invoke('open-project'),

  // MP3 encoding via ffmpeg (opts.cover = { data: base64, mime } for album art)
  encodeMp3:      (wavBuf, opts)  => ipcRenderer.invoke('encode-mp3', wavBuf, opts),
  processTempo:   (wavBuf, opts)  => ipcRenderer.invoke('process-tempo', wavBuf, opts),
  processAudio:   (wavBuf, opts)  => ipcRenderer.invoke('process-audio', wavBuf, opts),

  // Save rendered audio via native OS dialog (with overwrite confirmation)
  saveAudio:      (buf, name)     => ipcRenderer.invoke('save-audio', buf, name),
  saveNativeAudio: (tempPath, format, opts, name) => ipcRenderer.invoke('save-native-audio', tempPath, format, opts, name),

  // Window controls (Windows / Linux custom title bar)
  winAction:      (action)        => ipcRenderer.invoke('win-action', action),
  onWinState:     (cb)            => ipcRenderer.on('win-state', (_, s) => cb(s)),
  openHelp:       ()              => ipcRenderer.invoke('open-help'),

  // Mixer window controls
  openMixer:      (tracksCount)   => ipcRenderer.invoke('open-mixer', tracksCount),
  resizeMixer:    (tracksCount)   => ipcRenderer.invoke('resize-mixer', tracksCount),
  closeMixer:     ()              => ipcRenderer.invoke('close-mixer'),
  resetMixerBounds: ()            => ipcRenderer.invoke('reset-mixer-bounds'),
  reportMixerSize: (width, height) => ipcRenderer.invoke('report-mixer-size', width, height),
  onMixerState:   (cb)            => {
    const listener = (_, state) => cb(state);
    ipcRenderer.on('mixer-state', listener);
    return () => ipcRenderer.removeListener('mixer-state', listener);
  }
});
