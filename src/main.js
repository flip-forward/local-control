const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
if (process.env.NODE_ENV !== 'production') {
  try { require('electron-reload')(__dirname); } catch (_) {}
}
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { Bonjour } = require('bonjour-service');

let mainWindow;
let bonjour;
const displays = new Map();

let firmwareServer = null;

// ── Window ────────────────────────────────────────────────────

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 680,
    titleBarStyle: 'hiddenInset',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'flip forward',
  });

  if (process.platform === 'darwin') app.dock.setIcon(iconPath);

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── mDNS discovery ────────────────────────────────────────────

function startDiscovery() {
  bonjour = new Bonjour();

  const browser = bonjour.find({ type: 'splitflap' }, (service) => {
    const id = `${service.name}@${service.host}`;
    const display = {
      id,
      name: service.name,
      host: service.host,
      port: service.port,
      addresses: service.addresses,
    };
    displays.set(id, display);
    mainWindow?.webContents.send('display:found', display);
  });

  browser.on('down', (service) => {
    const id = `${service.name}@${service.host}`;
    displays.delete(id);
    mainWindow?.webContents.send('display:lost', id);
  });
}

// ── Shared HTTP helper ────────────────────────────────────────

async function postCommand(display, commandStr) {
  const ip = display.addresses?.[0] ?? display.host;
  const url = `http://${ip}/command`;
  const body = new URLSearchParams({ command: commandStr });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'Request timed out' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

// ── Firmware server ───────────────────────────────────────────

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function startFirmwareServer(filePath) {
  return new Promise((resolve, reject) => {
    stopFirmwareServer();

    firmwareServer = http.createServer((req, res) => {
      const parsed = new URL(req.url, 'http://localhost');
      const index = parsed.searchParams.get('index');

      if (req.method === 'GET') {
        console.log(`[firmware] GET ${req.url} — serving file`);
        if (index !== null) {
          mainWindow?.webContents.send('firmware:requested', { index: parseInt(index, 10) });
        }
        fs.stat(filePath, (err, stat) => {
          if (err) { res.writeHead(404); res.end(); return; }
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': stat.size,
          });
          fs.createReadStream(filePath).pipe(res);
        });
      } else if (req.method === 'POST') {
        req.resume();
        req.on('end', () => {
          res.writeHead(200);
          res.end();
          if (index !== null) {
            console.log(`[firmware] POST ack received for module ${index}`);
            mainWindow?.webContents.send('firmware:ack', { index: parseInt(index, 10) });
          }
        });
      } else {
        res.writeHead(405);
        res.end();
      }
    });

    firmwareServer.listen(0, '0.0.0.0', () => {
      resolve({ ip: getLocalIP(), port: firmwareServer.address().port });
    });

    firmwareServer.on('error', reject);
  });
}

function stopFirmwareServer() {
  if (firmwareServer) {
    firmwareServer.close();
    firmwareServer = null;
  }
}

// ── IPC handlers ──────────────────────────────────────────────

ipcMain.handle('open-external', (_event, url) => shell.openExternal(url));

ipcMain.handle('display:add-manual', (_event, display) => {
  displays.set(display.id, display);
  return { ok: true };
});

ipcMain.handle('display:remove-manual', (_event, id) => {
  displays.delete(id);
  return { ok: true };
});

ipcMain.handle('displays:list', () => Array.from(displays.values()));

ipcMain.handle('display:send', async (_event, { id, text }) => {
  const display = displays.get(id);
  if (!display) return { ok: false, error: 'Display not found' };
  return postCommand(display, `@:SHOWWORD:${text}`);
});

ipcMain.handle('display:send-raw', async (_event, { id, command }) => {
  const display = displays.get(id);
  if (!display) return { ok: false, error: 'Display not found' };
  return postCommand(display, command);
});

ipcMain.handle('module:command', async (_event, { id, module, command, content }) => {
  const display = displays.get(id);
  if (!display) return { ok: false, error: 'Display not found' };
  return postCommand(display, `${module}:${command}:${content}`);
});

ipcMain.handle('firmware:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Firmware', extensions: ['bin'] }],
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('firmware:start', async (_event, { filePath }) => {
  try {
    const { ip, port } = await startFirmwareServer(filePath);
    console.log(`[firmware] server started: http://${ip}:${port}/firmware.bin (serving ${filePath})`);
    return { ok: true, ip, port };
  } catch (err) {
    console.error('[firmware] server failed to start:', err.message);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('firmware:stop', () => {
  stopFirmwareServer();
  return { ok: true };
});

ipcMain.handle('firmware:update-url', async (_event, { id, modules, url, ssid, password }) => {
  const display = displays.get(id);
  if (!display) return { ok: false, error: 'Display not found' };

  const sorted = [...modules].sort((a, b) => b - a);
  for (const mod of sorted) {
    const command = `${mod}:FIRMWAREUPDATE:${url}%${ssid}%${password}`;
    console.log(`[firmware] sending url update: ${command}`);
    const result = await postCommand(display, command);
    if (!result.ok) return { ok: false, error: `Module ${mod}: ${result.error}` };
  }
  return { ok: true };
});

ipcMain.handle('firmware:update', async (_event, { id, modules, ip, port, ssid, password }) => {
  const display = displays.get(id);
  if (!display) return { ok: false, error: 'Display not found' };

  // Send from highest module index to lowest so lower modules don't reboot first
  console.log(`[firmware] server: http://${ip}:${port}/firmware.bin`);
  const sorted = [...modules].sort((a, b) => b - a);
  for (const mod of sorted) {
    const cmdUrl = `http://${ip}:${port}/firmware.bin?index=${mod}`;
    const command = `${mod}:FIRMWAREUPDATE:${cmdUrl}%${ssid}%${password}`;
    console.log(`[firmware] sending: ${command}`);
    const result = await postCommand(display, command);
    if (!result.ok) return { ok: false, error: `Module ${mod}: ${result.error}` };
  }
  return { ok: true };
});

// ── App lifecycle ─────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  startDiscovery();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopFirmwareServer();
  bonjour?.destroy();
  if (process.platform !== 'darwin') app.quit();
});
