// src/preload.js
// Preload scripts can be used to securely expose Node.js APIs to the renderer process.
// For now, it's empty, but we've configured it in main.js.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
  closeSettings: () => ipcRenderer.send('close-settings'),
  saveSetting: (key, value) => ipcRenderer.send('save-setting', key, value),
  getSetting: (key) => ipcRenderer.invoke('get-setting', key),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getOptions: () => ipcRenderer.invoke('get-options'),
  setConfig: (config) => ipcRenderer.send('set-config', config),
  resetConfig: () => ipcRenderer.send('reset-config'),
  onConfigUpdated: (callback) => ipcRenderer.on('config-updated', (event, ...args) => callback(...args)),
  copyToAssets: (sourcePath) => ipcRenderer.invoke('copy-to-assets', sourcePath),
  deleteFromAssets: (rendererRelativePath) => ipcRenderer.invoke('delete-from-assets', rendererRelativePath),
  saveModelState: (modelState) => ipcRenderer.send('save-model-state', modelState),
  getModelState: () => ipcRenderer.invoke('get-model-state'),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
}); 