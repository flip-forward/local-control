const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splitflap', {
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  sendText: (id, text) => ipcRenderer.invoke('display:send', { id, text }),
  sendRaw: (id, command) => ipcRenderer.invoke('display:send-raw', { id, command }),
  sendCommand: (id, module, command, content) =>
    ipcRenderer.invoke('module:command', { id, module, command, content }),

  pickFirmwareFile: () => ipcRenderer.invoke('firmware:pick'),
  startFirmwareServer: (filePath) => ipcRenderer.invoke('firmware:start', { filePath }),
  stopFirmwareServer: () => ipcRenderer.invoke('firmware:stop'),
  getFirmwareServerInfo: () => ipcRenderer.invoke('firmware:server-info'),
  sendFirmwareUpdate: (id, modules, ip, port, ssid, password) =>
    ipcRenderer.invoke('firmware:update', { id, modules, ip, port, ssid, password }),
  sendFirmwareUpdateFromUrl: (id, modules, url, ssid, password) =>
    ipcRenderer.invoke('firmware:update-url', { id, modules, url, ssid, password }),

  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  platform: () => ipcRenderer.invoke('app:platform'),
  openFirewallPort: (port) => ipcRenderer.invoke('firewall:open-port', port),
  addManualDisplay: (display) => ipcRenderer.invoke('display:add-manual', display),
  removeManualDisplay: (id) => ipcRenderer.invoke('display:remove-manual', id),

  onDisplayFound:  (cb) => ipcRenderer.on('display:found',  (_e, d)    => cb(d)),
  onDisplayLost:   (cb) => ipcRenderer.on('display:lost',   (_e, id)   => cb(id)),
  onFirmwareRequested: (cb) => ipcRenderer.on('firmware:requested', (_e, data) => cb(data)),
  onFirmwareAck:       (cb) => ipcRenderer.on('firmware:ack',       (_e, data) => cb(data)),

  getLogs: () => ipcRenderer.invoke('log:get'),
  onLogEntry: (cb) => ipcRenderer.on('log:entry', (_e, entry) => cb(entry)),
});
