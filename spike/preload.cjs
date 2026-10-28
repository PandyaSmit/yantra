const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  start: (size) => ipcRenderer.invoke('pty:start', size),
  input: (data) => ipcRenderer.send('pty:input', data),
  resize: (size) => ipcRenderer.send('pty:resize', size),
  onData: (cb) => ipcRenderer.on('pty:data', (_e, data) => cb(data)),
});
