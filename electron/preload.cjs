'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const listen = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('starfallDesktop', {
  ready: () => ipcRenderer.invoke('desktop:ready'),
  info: () => ipcRenderer.invoke('desktop:info'),
  toggleFullscreen: () => ipcRenderer.invoke('desktop:fullscreen'),
  quit: () => ipcRenderer.invoke('desktop:quit'),
  onFullscreen: (callback) => listen('desktop:fullscreen', callback),
  onCommand: (callback) => listen('desktop:command', callback),
  onBeforeClose: (callback) =>
    listen('desktop:before-close', async (id) => {
      let ok = false;
      try {
        ok = (await callback()) === true;
      } catch {
        /* Main process will keep the window open. */
      }
      ipcRenderer.send('desktop:close-result', { id, ok });
    }),
  saves: {
    list: () => ipcRenderer.invoke('saves:list'),
    read: (id) => ipcRenderer.invoke('saves:read', id),
    write: (input) => ipcRenderer.invoke('saves:write', input),
    rename: (id, title) => ipcRenderer.invoke('saves:rename', id, title),
    delete: (id) => ipcRenderer.invoke('saves:delete', id),
    importFile: () => ipcRenderer.invoke('saves:import'),
    exportFile: (id) => ipcRenderer.invoke('saves:export', id),
    importLegacy: (raw) => ipcRenderer.invoke('saves:import-legacy', raw),
  },
});
