const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clock', {
  setup: () => ipcRenderer.invoke('clock:setup'),
  refresh: () => ipcRenderer.invoke('clock:refresh'),
  change: (key, value) => ipcRenderer.invoke('clock:change', key, value),
  login: () => ipcRenderer.invoke('clock:login'),
  logout: () => ipcRenderer.invoke('clock:logout'),
  open: url => ipcRenderer.invoke('clock:open', url),
  startup: () => ipcRenderer.invoke('clock:startup'),
  setStartup: enabled => ipcRenderer.invoke('clock:set-startup', enabled),
  hide: () => ipcRenderer.invoke('clock:hide'),
  close: () => ipcRenderer.invoke('clock:close'),
  dock: corner => ipcRenderer.invoke('clock:dock', corner),
  resize: (phase, x, y) => ipcRenderer.invoke('clock:resize', phase, x, y),
  sizePreset: preset => ipcRenderer.invoke('clock:size-preset', preset),
  onBackdrop: listener => {
    const handler = (_event, frame) => listener(frame);
    ipcRenderer.on('clock:backdrop', handler);
    return () => ipcRenderer.removeListener('clock:backdrop', handler);
  },
  openTimetable: id => ipcRenderer.invoke('clock:timetable-open', id),
  importCalendar: data => ipcRenderer.invoke('clock:timetable-calendar', data),
  cancelTimetable: () => ipcRenderer.invoke('clock:timetable-cancel'),
  saveTimetable: monday => ipcRenderer.invoke('clock:timetable-save', monday),
  saveSchedule: event => ipcRenderer.invoke('clock:schedule-save', event),
  removeSchedule: id => ipcRenderer.invoke('clock:schedule-remove', id),
  saveCountdown: item => ipcRenderer.invoke('clock:countdown-save', item),
  removeCountdown: id => ipcRenderer.invoke('clock:countdown-remove', id),
  showCountdown: (id, visible) => ipcRenderer.invoke('clock:countdown-visible', id, visible),
  onCountdowns: listener => {
    const handler = (_event, items) => listener(items);
    ipcRenderer.on('clock:countdowns', handler);
    return () => ipcRenderer.removeListener('clock:countdowns', handler);
  },
  onEditCountdown: listener => {
    const handler = (_event, id) => listener(id);
    ipcRenderer.on('clock:countdown-edit', handler);
    return () => ipcRenderer.removeListener('clock:countdown-edit', handler);
  },
  updateTodo: change => ipcRenderer.invoke('clock:todo-update', change),
  todoApiStatus: () => ipcRenderer.invoke('clock:todo-api-status'),
  configureTodoApi: enabled => ipcRenderer.invoke('clock:todo-api-configure', enabled),
  copyTodoApi: () => ipcRenderer.invoke('clock:todo-api-copy'),
  onTodos: listener => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on('clock:todos', handler);
    return () => ipcRenderer.removeListener('clock:todos', handler);
  },
  onTimetable: listener => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on('clock:timetable-result', handler);
    return () => ipcRenderer.removeListener('clock:timetable-result', handler);
  },
  onCorner: listener => {
    const handler = (_event, corner) => listener(corner);
    ipcRenderer.on('clock:corner', handler);
    return () => ipcRenderer.removeListener('clock:corner', handler);
  },

  onUpdate: listener => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('clock:state', handler);
    return () => ipcRenderer.removeListener('clock:state', handler);
  }
});
