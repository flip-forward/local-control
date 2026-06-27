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

// ── Device log parsing ────────────────────────────────────────

const LOG_ENTRY_SIZE = 64;
const EVENT_NAMES = {
  0x01: 'EVT_BOOT',
  0x02: 'EVT_OTA_START',
  0x03: 'EVT_OTA_OK',
  0x04: 'EVT_OTA_FAIL',
  0x05: 'EVT_HOMING_OK',
  0x07: 'EVT_ROTATION',
  0x08: 'EVT_WIFI_CONNECT',
  0x09: 'EVT_WIFI_DROP',
  0x0A: 'EVT_OTA_BAD_CONFIG',
  0x0B: 'EVT_OTA_WIFI_FAIL',
  0x0C: 'EVT_OTA_NO_UPDATE',
};

function parseLogEntries(buf) {
  const entries = [];
  for (let i = 0; i + LOG_ENTRY_SIZE <= buf.length; i += LOG_ENTRY_SIZE) {
    if (buf[i] !== 0xAB) continue;
    const event = buf[i + 1];
    const eventNumber = buf.readUInt32LE(i + 2);
    const timestamp = buf.readUInt32LE(i + 6);
    const value = buf.readUInt32LE(i + 10);
    const strLen = Math.min(buf[i + 14], 48);
    const str = strLen > 0 ? buf.slice(i + 15, i + 15 + strLen).toString('utf8').replace(/\0/g, '') : '';
    entries.push({
      event,
      name: EVENT_NAMES[event] ?? `0x${event.toString(16).padStart(2, '0')}`,
      eventNumber,
      timestamp,
      value,
      str,
    });
  }
  return entries;
}

// ── Firmware server ───────────────────────────────────────────

function getLocalIP() {
  const { createSocket } = require('dgram');
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    socket.connect(80, '8.8.8.8', () => {
      const addr = socket.address().address;
      socket.close();
      resolve(addr);
    });
    socket.on('error', () => {
      socket.close();
      resolve('127.0.0.1');
    });
  });
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
        if (parsed.pathname === '/log') {
          const displayId = parsed.searchParams.get('id') ?? '';
          const modStr = parsed.searchParams.get('module');
          const modIdx = modStr !== null ? parseInt(modStr, 10) : 0;
          const chunks = [];
          req.on('data', chunk => chunks.push(chunk));
          req.on('end', () => {
            const buf = Buffer.concat(chunks);
            const entries = parseLogEntries(buf);
            mainWindow?.webContents.send('device-log:entries', { id: displayId, module: modIdx, entries });
            res.writeHead(200);
            res.end();
            addLogEntry({ direction: 'in', method: 'POST', path: '/log', status: 200, ok: true, target: displayId });
          });
          return;
        }
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
  const ip = await getLocalIP();
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

ipcMain.handle('display:fetch-log', async (_event, { id, modules, ssid, password }) => {
  const display = displays.get(id);
  if (!display) return { ok: false, error: 'Display not found' };
  const ip = await getLocalIP();
  const sorted = [...modules].sort((a, b) => b - a);
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 200));
    const mod = sorted[i];
    const url = `http://${ip}:${FIRMWARE_PORT}/log?id=${id}&module=${mod}`;
    const result = await postCommand(display, `${mod}:UPLOADLOG:${url}%${ssid}%${password}`);
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
