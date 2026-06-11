const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
if (process.env.NODE_ENV !== 'production') {
  try { require('electron-reload')(__dirname); } catch (_) {}
}
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');
const { Bonjour } = require('bonjour-service');

let mainWindow;
let bonjour;
const displays = new Map();

let firmwareServer = null;
let currentFirmwarePath = null;

// ── Log store ─────────────────────────────────────────────────

const MAX_LOG_ENTRIES = 500;
const logEntries = [];
let logIdCounter = 0;

function addLogEntry(entry) {
  entry.id = ++logIdCounter;
  entry.ts = Date.now();
  logEntries.push(entry);
  if (logEntries.length > MAX_LOG_ENTRIES) logEntries.shift();
  mainWindow?.webContents.send('log:entry', entry);
}

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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Connection': 'close' },
      body: body.toString(),
      signal: controller.signal,
    });
    if (!res.ok) {
      addLogEntry({ direction: 'out', target: display.name, url, command: commandStr, ok: false, status: res.status, error: `HTTP ${res.status}` });
      return { ok: false, error: `HTTP ${res.status}` };
    }
    addLogEntry({ direction: 'out', target: display.name, url, command: commandStr, ok: true, status: res.status });
    return { ok: true };
  } catch (err) {
    const error = err.name === 'AbortError' ? 'Request timed out' : err.message;
    addLogEntry({ direction: 'out', target: display.name, url, command: commandStr, ok: false, error });
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

// ── Firmware server ───────────────────────────────────────────

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  // Skip virtual/VPN adapters common on Windows (Hyper-V, WSL, Bluetooth, VPN tap/tun)
  const skipPattern = /^(vethernet|vmnet|loopback|wsl|bluetooth|vlan|tap|tun|vpn|hamachi|virtualbox|vmware)/i;
  for (const name of Object.keys(ifaces)) {
    if (skipPattern.test(name)) continue;
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  // Fallback: first non-internal IPv4
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const iface of addrs) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

const FIRMWARE_PORT = 18456;

const TEST_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>flip forward — connection test</title>
  <style>
    body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;
         justify-content:center;min-height:100vh;margin:0;background:#111;color:#fff;gap:.75rem}
    .ok{font-size:3rem}
    h1{font-size:1.5rem;margin:0}
    p{color:#888;margin:0;font-size:.9rem}
  </style>
</head>
<body>
  <div class="ok">&#10003;</div>
  <h1>flip forward</h1>
  <p>Connection successful — your device can reach this machine.</p>
</body>
</html>`;

async function startFirmwareServer() {
  if (firmwareServer) return;

  await new Promise((resolve, reject) => {
    firmwareServer = http.createServer((req, res) => {
      const parsed = new URL(req.url, 'http://localhost');
      const index = parsed.searchParams.get('index');

      if (req.method === 'GET') {
        if (parsed.pathname === '/test') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(TEST_PAGE_HTML);
          addLogEntry({ direction: 'in', method: 'GET', path: '/test', status: 200, ok: true });
          return;
        }
        if (!currentFirmwarePath) {
          res.writeHead(503);
          res.end();
          addLogEntry({ direction: 'in', method: 'GET', path: req.url, status: 503, ok: false, error: 'No firmware loaded' });
          return;
        }
        console.log(`[firmware] GET ${req.url} — serving file`);
        if (index !== null) {
          mainWindow?.webContents.send('firmware:requested', { index: parseInt(index, 10) });
        }
        fs.stat(currentFirmwarePath, (err, stat) => {
          if (err) {
            res.writeHead(404);
            res.end();
            addLogEntry({ direction: 'in', method: 'GET', path: req.url, status: 404, ok: false, error: 'File not found' });
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': stat.size,
          });
          fs.createReadStream(currentFirmwarePath).pipe(res);
          addLogEntry({ direction: 'in', method: 'GET', path: req.url, status: 200, ok: true });
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
          addLogEntry({ direction: 'in', method: 'POST', path: req.url, status: 200, ok: true });
        });
      } else {
        res.writeHead(405);
        res.end();
        addLogEntry({ direction: 'in', method: req.method, path: req.url, status: 405, ok: false, error: 'Method not allowed' });
      }
    });

    firmwareServer.listen(FIRMWARE_PORT, '0.0.0.0', resolve);
    firmwareServer.on('error', reject);
  });

  console.log(`[firmware] server listening on port ${FIRMWARE_PORT}`);
}

async function getFirmwareServerInfo() {
  const ip = getLocalIP();
  const port = FIRMWARE_PORT;
  const testUrl = `http://${ip}:${port}/test`;
  const qrDataUrl = await QRCode.toDataURL(testUrl, { width: 160, margin: 1 });
  return { ip, port, testUrl, qrDataUrl };
}

function stopFirmwareServer() {
  if (firmwareServer) {
    firmwareServer.close();
    firmwareServer = null;
  }
}

// ── IPC handlers ──────────────────────────────────────────────

ipcMain.handle('log:get', () => logEntries);

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
  const cmdStr = content ? `${module}:${command}:${content}` : `${module}:${command}`;
  return postCommand(display, cmdStr);
});

ipcMain.handle('firmware:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Firmware', extensions: ['bin'] }],
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('firmware:start', async (_event, { filePath }) => {
  currentFirmwarePath = filePath;
  return { ok: true };
});

ipcMain.handle('firmware:server-info', async () => {
  try {
    const info = await getFirmwareServerInfo();
    return { ok: true, ...info };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('app:platform', () => process.platform);

ipcMain.handle('firewall:open-port', async (_event, port) => {
  if (process.platform !== 'win32') return { ok: false, error: 'Not Windows' };
  const { execFile } = require('child_process');
  const ruleName = `flip forward port ${port}`;
  const cmd = `netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=TCP localport=${port}`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-Command', `Start-Process cmd -Verb RunAs -ArgumentList '/c ${cmd}'`], (err) => {
      resolve(err ? { ok: false, error: err.message } : { ok: true });
    });
  });
});

ipcMain.handle('firmware:stop', () => {
  currentFirmwarePath = null;
  return { ok: true };
});

ipcMain.handle('firmware:update-url', async (_event, { id, modules, url, ssid, password }) => {
  const display = displays.get(id);
  if (!display) return { ok: false, error: 'Display not found' };

  const sorted = [...modules].sort((a, b) => b - a);
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 200));
    const mod = sorted[i];
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
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 200));
    const mod = sorted[i];
    const cmdUrl = `http://${ip}:${port}/firmware.bin?index=${mod}`;
    const command = `${mod}:FIRMWAREUPDATE:${cmdUrl}%${ssid}%${password}`;
    console.log(`[firmware] sending: ${command}`);
    const result = await postCommand(display, command);
    if (!result.ok) return { ok: false, error: `Module ${mod}: ${result.error}` };
  }
  return { ok: true };
});

// ── App lifecycle ─────────────────────────────────────────────

app.whenReady().then(async () => {
  try { await startFirmwareServer(); } catch (err) { console.error('[firmware] failed to start server:', err.message); }
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
