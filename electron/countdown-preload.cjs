const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('countdown', {
  setup: () => ipcRenderer.invoke('countdown:setup'),
  edit: () => ipcRenderer.invoke('countdown:edit'),
  hide: () => ipcRenderer.invoke('countdown:hide'),
  onUpdate: listener => {
    const handler = (_event, item) => listener(item);
    ipcRenderer.on('countdown:update', handler);
    return () => ipcRenderer.removeListener('countdown:update', handler);
  },
  onBackdrop: listener => {
    const handler = (_event, frame) => listener(frame);
    ipcRenderer.on('clock:backdrop', handler);
    return () => ipcRenderer.removeListener('clock:backdrop', handler);
  }
});
