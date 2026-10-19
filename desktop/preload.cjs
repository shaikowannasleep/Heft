const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('heftDesktop', {
  saveAs: (name, bytes) => ipcRenderer.invoke('file:save-as', name, bytes),
  save: (path, bytes) => ipcRenderer.invoke('file:save', path, bytes),
  open: filters => ipcRenderer.invoke('file:open', filters),
});
