const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startStream: (config) => ipcRenderer.invoke('start-stream', config),
  stopStream: () => ipcRenderer.invoke('stop-stream'),
  onAudioChunk: (cb) => ipcRenderer.on('audio-chunk', (_, data) => cb(data)),
  onLog: (cb) => ipcRenderer.on('log', (_, data) => cb(data))
});
