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
  sendFirmwareUpdate: (id, modules, ip, port, ssid, password) =>
    ipcRenderer.invoke('firmware:update', { id, modules, ip, port, ssid, password }),

  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  onDisplayFound:  (cb) => ipcRenderer.on('display:found',  (_e, d)    => cb(d)),
  onDisplayLost:   (cb) => ipcRenderer.on('display:lost',   (_e, id)   => cb(id)),
  onFirmwareAck:   (cb) => ipcRenderer.on('firmware:ack',   (_e, data) => cb(data)),
});
