'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform:      process.platform,

  // File system
  openFolder:     ()              => ipcRenderer.invoke('open-folder'),
  scanAudioFolder:(folderPath)    => ipcRenderer.invoke('scan-audio-folder', folderPath),
  selectFiles:    ()              => ipcRenderer.invoke('select-files'),
  getPathForFile: (file)          => webUtils && webUtils.getPathForFile ? webUtils.getPathForFile(file) : (file && file.path) || '',
  readAudioFile:  (filePath)      => ipcRenderer.invoke('read-audio-file', filePath),
  writeTempAudio: (wavBuf, fileName) => ipcRenderer.invoke('write-temp-audio', wavBuf, fileName),
  saveBounceAudio: (wavBuf, projectPath, fileName, sourcePath) => ipcRenderer.invoke('save-bounce-audio', wavBuf, projectPath, fileName, sourcePath),
  saveConsolidatedAudio: (wavBuf, projectPath, fileName, sourcePath) => ipcRenderer.invoke('save-consolidated-audio', wavBuf, projectPath, fileName, sourcePath),
  prepareRecordingPath: (projectPath, fileName, sourcePath) => ipcRenderer.invoke('prepare-recording-path', projectPath, fileName, sourcePath),
  finalizeRecording: (partPath, finalPath) => ipcRenderer.invoke('finalize-recording', partPath, finalPath),
  renameRecording: (oldPath, newBaseName) => ipcRenderer.invoke('rename-recording', oldPath, newBaseName),

  // Project persistence
  saveProject:    (json, name, targetPath) => ipcRenderer.invoke('save-project', json, name, targetPath),
  chooseProjectPath: (name)       => ipcRenderer.invoke('choose-project-path', name),
  collectProjectAudio: (targetPath, items) => ipcRenderer.invoke('collect-project-audio', targetPath, items),
  openProject:    ()              => ipcRenderer.invoke('open-project'),
  readProjectFile:(filePath)      => ipcRenderer.invoke('read-project-file', filePath),

  // MP3 encoding via ffmpeg (opts.cover = { data: base64, mime } for album art)
  encodeMp3:      (wavBuf, opts)  => ipcRenderer.invoke('encode-mp3', wavBuf, opts),
  processTempo:   (wavBuf, opts)  => ipcRenderer.invoke('process-tempo', wavBuf, opts),
  processAudio:   (wavBuf, opts)  => ipcRenderer.invoke('process-audio', wavBuf, opts),

  // Save rendered audio via native OS dialog (with overwrite confirmation)
  saveAudio:      (buf, name)     => ipcRenderer.invoke('save-audio', buf, name),
  inspectNativeAudio: (tempPath)  => ipcRenderer.invoke('inspect-native-audio', tempPath),
  saveNativeAudio: (tempPath, format, opts, name) => ipcRenderer.invoke('save-native-audio', tempPath, format, opts, name),

  // Window controls (Windows / Linux custom title bar)
  winAction:      (action)        => ipcRenderer.invoke('win-action', action),
  onWinState:     (cb)            => ipcRenderer.on('win-state', (_, s) => cb(s)),
  openHelp:       ()              => ipcRenderer.invoke('open-help'),
  openAdvancedPan: (target)       => ipcRenderer.invoke('open-advanced-pan', target),
  navigateAdvanced: (target)      => ipcRenderer.invoke('navigate-advanced', target),

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
  },
  onAdvancedPanState: (cb)        => {
    const listener = (_, state) => cb(state);
    ipcRenderer.on('advanced-pan-state', listener);
    return () => ipcRenderer.removeListener('advanced-pan-state', listener);
  }
});
