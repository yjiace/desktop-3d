// src/preload.js
// Preload scripts can be used to securely expose Node.js APIs to the renderer process.
// For now, it's empty, but we've configured it in main.js.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
}); 