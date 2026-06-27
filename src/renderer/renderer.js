const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ?0123456789.,!=: '.split('');
const MODULE_COUNT = 20;
const HOMING_STEPS = 3;

const displays = new Map();
let selectedId = null;
let homingStep = 0;
let homingActive = false;

// DOM refs
const listEl        = document.getElementById('display-list');
const emptyEl       = document.getElementById('empty-state');
const noSelectionEl = document.getElementById('no-selection');
const controlsEl    = document.getElementById('display-controls');
const statusEl      = document.getElementById('status');

const textInput      = document.getElementById('text-input');
const intervalInput  = document.getElementById('interval-input');
const sendBtn        = document.getElementById('send-btn');
const sendFeedback   = document.getElementById('send-feedback');

const moduleSelect        = document.getElementById('module-select');
const displaycharGrid     = document.getElementById('displaychar-grid');
const displaycharFeedback = document.getElementById('displaychar-feedback');

const startHomingBtn = document.getElementById('start-homing-btn');
const homingFeedback = document.getElementById('homing-feedback');
const homingCard     = document.getElementById('homing-card');

const homingConfirmEl        = document.getElementById('homing-confirmation');
const homingConfirmStep      = document.getElementById('homing-confirm-step');
const homingConfirmGrid      = document.getElementById('homing-confirm-grid');
const homingConfirmFeedback  = document.getElementById('homing-confirm-feedback');
const cancelHomingBtn        = document.getElementById('cancel-homing-btn');

const moduleCommandsEl = document.querySelector('#display-controls > div:last-of-type');

// ── Bootstrap ────────────────────────────────────────────────

const allOpt = document.createElement('option');
allOpt.value = '@';
allOpt.textContent = 'All modules';
moduleSelect.appendChild(allOpt);

for (let i = 0; i < MODULE_COUNT; i++) {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = `Module ${i}`;
  moduleSelect.appendChild(opt);
}

function updateHomingCardState() {
  const isAll = moduleSelect.value === '@';
  homingCard.style.opacity = isAll ? '0.35' : '';
  homingCard.style.pointerEvents = isAll ? 'none' : '';
}

moduleSelect.addEventListener('change', updateHomingCardState);
updateHomingCardState();

buildAlphaGrid(displaycharGrid, onDisplayChar);
buildAlphaGrid(homingConfirmGrid, onHomingChar);

// ── Display list ─────────────────────────────────────────────

// ── Manual displays ───────────────────────────────────────────

const MANUAL_KEY = 'manual-displays';

function loadManualDisplays() {
  try { return JSON.parse(localStorage.getItem(MANUAL_KEY) ?? '[]'); } catch { return []; }
}

function saveManualDisplays() {
  const manual = Array.from(displays.values()).filter((d) => d.manual);
  localStorage.setItem(MANUAL_KEY, JSON.stringify(manual));
}

function makeManualDisplay(ip, name) {
  return {
    id: `manual@${ip}`,
    name: name || ip,
    host: ip,
    port: 80,
    addresses: [ip],
    manual: true,
  };
}

// Restore persisted manual displays
for (const display of loadManualDisplays()) {
  displays.set(display.id, display);
  window.splitflap.addManualDisplay(display);
}

const addToggleBtn  = document.getElementById('add-display-toggle');
const addForm       = document.getElementById('add-display-form');
const manualNameEl  = document.getElementById('manual-name');
const manualIpEl    = document.getElementById('manual-ip');
const manualAddBtn  = document.getElementById('manual-add-btn');

addToggleBtn.addEventListener('click', () => {
  const open = addForm.style.display === 'flex';
  addForm.style.display = open ? 'none' : 'flex';
  if (!open) manualIpEl.focus();
});

manualAddBtn.addEventListener('click', addManualDisplay);
manualIpEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') addManualDisplay(); });

function addManualDisplay() {
  const ip = manualIpEl.value.trim();
  if (!ip) return;
  const display = makeManualDisplay(ip, manualNameEl.value.trim());
  displays.set(display.id, display);
  window.splitflap.addManualDisplay(display);
  saveManualDisplays();
  manualNameEl.value = '';
  manualIpEl.value = '';
  addForm.style.display = 'none';
  renderList();
}

function removeManualDisplay(id) {
  displays.delete(id);
  window.splitflap.removeManualDisplay(id);
  saveManualDisplays();
  if (selectedId === id) {
    selectedId = null;
    controlsEl.style.display = 'none';
    noSelectionEl.style.display = '';
    resetHoming();
  }
  renderList();
}

// ── Display list ─────────────────────────────────────────────

function renderList() {
  document.querySelectorAll('.display-item').forEach((el) => el.remove());

  if (displays.size === 0) {
    emptyEl.style.display = '';
  } else {
    emptyEl.style.display = 'none';
    for (const display of displays.values()) {
      const el = document.createElement('div');
      el.className = 'display-item' + (display.id === selectedId ? ' selected' : '');
      el.dataset.id = display.id;
      el.innerHTML = `<div class="display-name">${display.name}</div>
                      <div class="display-host">${display.host}:${display.port}</div>
                      ${display.manual ? '<button class="remove-btn" title="Remove">×</button>' : ''}`;
      el.addEventListener('click', () => selectDisplay(display.id));
      if (display.manual) {
        el.querySelector('.remove-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          removeManualDisplay(display.id);
        });
      }
      listEl.appendChild(el);
    }
  }

  statusEl.textContent = displays.size === 0
    ? 'Scanning…'
    : `${displays.size} display${displays.size !== 1 ? 's' : ''} found`;
}

function selectDisplay(id) {
  saveFirmwareState(selectedId);
  selectedId = id;
  renderList();
  noSelectionEl.style.display = 'none';
  controlsEl.style.display = '';
  clearFeedback();
  resetHoming();
  updateHomingCardState();
  restoreFirmwareState(id);
  restoreDeviceLogState(id);
  speedSelect.value = '20';
  window.splitflap.sendCommand(id, '@', 'MAXSPEED', '20');
  textInput.focus();
}

// ── Helpers ───────────────────────────────────────────────────

function buildAlphaGrid(container, onClick) {
  for (const ch of ALPHA) {
    const btn = document.createElement('button');
    btn.className = 'alpha-btn';
    btn.textContent = ch === ' ' ? '␣' : ch;
    btn.dataset.char = ch;
    btn.addEventListener('click', () => onClick(ch));
    container.appendChild(btn);
  }
}

function setFeedback(el, result, successMsg = 'Done.') {
  el.textContent = result.ok ? successMsg : (result.error ?? 'Failed.');
  el.className = 'feedback ' + (result.ok ? 'ok' : 'error');
}

function clearFeedback() {
  [sendFeedback, displaycharFeedback, homingFeedback, homingConfirmFeedback, firmwareFeedback, deviceLogFeedback].forEach((el) => {
    el.textContent = '';
    el.className = 'feedback';
  });
}

function enterHomingConfirmation() {
  homingActive = true;
  moduleCommandsEl.style.display = 'none';
  homingConfirmEl.style.display = 'flex';
  updateHomingConfirmStep();
}

function resetHoming() {
  homingActive = false;
  homingStep = 0;
  moduleCommandsEl.style.display = '';
  homingConfirmEl.style.display = 'none';
  homingFeedback.textContent = '';
  homingFeedback.className = 'feedback';
}

function updateHomingConfirmStep() {
  homingConfirmStep.textContent = `Step ${homingStep + 1} / ${HOMING_STEPS}`;
}

// ── Send message ──────────────────────────────────────────────

sendBtn.addEventListener('click', async () => {
  if (!selectedId) return;
  const text = textInput.value.trim();
  if (!text) return;

  const interval = intervalInput.value.trim();
  const command = interval ? `@:SHOWPERIODIC:${text}:${interval}` : null;

  sendBtn.disabled = true;
  const result = command
    ? await window.splitflap.sendRaw(selectedId, command)
    : await window.splitflap.sendText(selectedId, text);
  sendBtn.disabled = false;
  setFeedback(sendFeedback, result, 'Sent.');
});

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendBtn.click();
});

// ── Actions (reboot / blink) ──────────────────────────────────

const actionsFeedback = document.getElementById('actions-feedback');

document.getElementById('reboot-btn').addEventListener('click', async () => {
  if (!selectedId) return;
  const result = await window.splitflap.sendCommand(selectedId, moduleSelect.value, 'REBOOT', '');
  setFeedback(actionsFeedback, result, 'Rebooting…');
});

document.getElementById('blink-btn').addEventListener('click', async () => {
  if (!selectedId) return;
  const result = await window.splitflap.sendCommand(selectedId, moduleSelect.value, 'BLINK', '');
  setFeedback(actionsFeedback, result, 'Blinking.');
});

// ── Display character ─────────────────────────────────────────

async function onDisplayChar(ch) {
  if (!selectedId) return;
  const result = await window.splitflap.sendCommand(selectedId, moduleSelect.value, 'DISPLAYCHAR', ch);
  setFeedback(displaycharFeedback, result, `Sent "${ch}".`);
}

// ── Smart homing ──────────────────────────────────────────────

startHomingBtn.addEventListener('click', async () => {
  if (!selectedId) return;

  startHomingBtn.disabled = true;
  const result = await window.splitflap.sendCommand(
    selectedId, moduleSelect.value, 'SMARTHOME', String(HOMING_STEPS)
  );
  startHomingBtn.disabled = false;

  if (!result.ok) {
    setFeedback(homingFeedback, result);
    return;
  }

  homingStep = 0;
  enterHomingConfirmation();
});

async function onHomingChar(ch) {
  if (!selectedId || !homingActive) return;

  const result = await window.splitflap.sendCommand(
    selectedId, moduleSelect.value, 'SMARTHOME_CHAR', ch
  );

  if (!result.ok) {
    setFeedback(homingConfirmFeedback, result);
    return;
  }

  homingStep++;
  if (homingStep >= HOMING_STEPS) {
    resetHoming();
    setFeedback(homingFeedback, { ok: true }, 'Homing complete.');
  } else {
    updateHomingConfirmStep();
  }
}

cancelHomingBtn.addEventListener('click', resetHoming);

// ── Max speed ─────────────────────────────────────────────────

const speedSelect = document.getElementById('speed-select');

speedSelect.addEventListener('change', async () => {
  const speed = speedSelect.value;
  if (!speed || !selectedId) return;
  await window.splitflap.sendCommand(selectedId, '@', 'MAXSPEED', speed);
});

// ── Firmware update ───────────────────────────────────────────

let firmwareFilePath = null;
let firmwarePendingAcks = new Set();
let updatingDisplayId = null;
const firmwareStateByDisplay = new Map();

function saveFirmwareState(id) {
  if (!id) return;
  firmwareStateByDisplay.set(id, {
    pendingAcks: new Set(firmwarePendingAcks),
    gridHTML: firmwareModuleGrid.innerHTML,
    labelText: firmwareProgressLabel.textContent,
    showingProgress: firmwareProgress.style.display !== 'none',
  });
}

function restoreFirmwareState(id) {
  const state = firmwareStateByDisplay.get(id);
  if (state) {
    firmwarePendingAcks = new Set(state.pendingAcks);
    firmwareModuleGrid.innerHTML = state.gridHTML;
    firmwareProgressLabel.textContent = state.labelText;
    firmwareForm.style.display = state.showingProgress ? 'none' : '';
    firmwareProgress.style.display = state.showingProgress ? 'flex' : 'none';
  } else {
    firmwarePendingAcks = new Set();
    firmwareModuleGrid.innerHTML = '';
    firmwareProgressLabel.textContent = '';
    firmwareForm.style.display = '';
    firmwareProgress.style.display = 'none';
  }
  firmwareUpdateBtn.disabled = !firmwareFilePath || !firmwareSsid.value.trim();
}

const firmwareDropzone   = document.getElementById('firmware-dropzone');
const firmwareFileInfo   = document.getElementById('firmware-file-info');
const firmwareFileName   = document.getElementById('firmware-file-name');
const firmwareClearBtn   = document.getElementById('firmware-clear-btn');
const firmwareSsid       = document.getElementById('firmware-ssid');
const firmwarePassword   = document.getElementById('firmware-password');
const firmwareUpdateBtn  = document.getElementById('firmware-update-btn');
const firmwareForm       = document.getElementById('firmware-form');
const firmwareProgress   = document.getElementById('firmware-progress');
const firmwareProgressLabel = document.getElementById('firmware-progress-label');
const firmwareModuleGrid = document.getElementById('firmware-module-grid');
const firmwareCancelBtn  = document.getElementById('firmware-cancel-btn');
const firmwareFeedback   = document.getElementById('firmware-feedback');
const firmwarePasswordToggle = document.getElementById('firmware-password-toggle');
const firmwareTabFile    = document.getElementById('firmware-tab-file');
const firmwareTabUrl     = document.getElementById('firmware-tab-url');
const firmwareUrlInput   = document.getElementById('firmware-url-input');
const firmwareTestQrImg  = document.getElementById('firmware-test-qr-img');
const firmwareTestLink   = document.getElementById('firmware-test-link');
const firmwareWindowsWarn = document.getElementById('firmware-windows-warn');
const firmwareFirewallBtn = document.getElementById('firmware-firewall-btn');

firmwareFirewallBtn.addEventListener('click', () => {
  window.splitflap.openFirewallPort(18456);
});

let firmwareServerInfo = null;

async function initFirmwareServerInfo() {
  const result = await window.splitflap.getFirmwareServerInfo();
  if (!result.ok) return;
  firmwareServerInfo = result;
  firmwareTestQrImg.src = result.qrDataUrl;
  firmwareTestLink.textContent = result.testUrl;
  firmwareTestLink.onclick = () => window.splitflap.openExternal(result.testUrl);
  const platform = await window.splitflap.platform();
  firmwareWindowsWarn.style.display = platform === 'win32' ? '' : 'none';
}

initFirmwareServerInfo();

let firmwareMode = 'file'; // 'file' | 'url'

firmwareTabFile.addEventListener('click', () => {
  firmwareMode = 'file';
  firmwareTabFile.classList.add('active');
  firmwareTabUrl.classList.remove('active');
  firmwareDropzone.style.display = firmwareFilePath ? 'none' : '';
  firmwareFileInfo.style.display = firmwareFilePath ? 'flex' : 'none';
  firmwareUrlInput.style.display = 'none';
  refreshFirmwareBtn();
});

firmwareTabUrl.addEventListener('click', () => {
  firmwareMode = 'url';
  firmwareTabUrl.classList.add('active');
  firmwareTabFile.classList.remove('active');
  firmwareDropzone.style.display = 'none';
  firmwareFileInfo.style.display = 'none';
  firmwareUrlInput.style.display = '';
  firmwareUrlInput.focus();
  refreshFirmwareBtn();
});

firmwarePasswordToggle.addEventListener('click', () => {
  const isPassword = firmwarePassword.type === 'password';
  firmwarePassword.type = isPassword ? 'text' : 'password';
  firmwarePasswordToggle.title = isPassword ? 'Hide password' : 'Show password';
  firmwarePasswordToggle.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
});

// Restore saved credentials
firmwareSsid.value = localStorage.getItem('firmware.ssid') ?? '';
firmwarePassword.value = localStorage.getItem('firmware.password') ?? '';

firmwareSsid.addEventListener('input', () => {
  localStorage.setItem('firmware.ssid', firmwareSsid.value);
  refreshFirmwareBtn();
});
firmwarePassword.addEventListener('input', () => {
  localStorage.setItem('firmware.password', firmwarePassword.value);
});
firmwareUrlInput.addEventListener('input', refreshFirmwareBtn);

function setFirmwareFile(filePath) {
  firmwareFilePath = filePath;
  firmwareFileName.textContent = filePath.split(/[\\/]/).pop();
  firmwareDropzone.style.display = 'none';
  firmwareFileInfo.style.display = 'flex';
  refreshFirmwareBtn();
}

// Click to open native file picker
firmwareDropzone.addEventListener('click', async () => {
  const filePath = await window.splitflap.pickFirmwareFile();
  if (filePath) setFirmwareFile(filePath);
});

// Drag and drop
firmwareDropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  firmwareDropzone.classList.add('drag-over');
});
firmwareDropzone.addEventListener('dragleave', () => {
  firmwareDropzone.classList.remove('drag-over');
});
firmwareDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  firmwareDropzone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file?.path) setFirmwareFile(file.path);
});

firmwareClearBtn.addEventListener('click', () => {
  firmwareFilePath = null;
  firmwareDropzone.style.display = '';
  firmwareFileInfo.style.display = 'none';
  refreshFirmwareBtn();
});

function refreshFirmwareBtn() {
  if (firmwareMode === 'url') {
    firmwareUpdateBtn.disabled = !firmwareUrlInput.value.trim() || !firmwareSsid.value.trim();
  } else {
    firmwareUpdateBtn.disabled = !firmwareFilePath || !firmwareSsid.value.trim();
  }
}

refreshFirmwareBtn();

firmwareUpdateBtn.addEventListener('click', async () => {
  if (!selectedId) return;

  const ssid = firmwareSsid.value.trim();
  const password = firmwarePassword.value;
  const modules = moduleSelect.value === '@'
    ? Array.from({ length: MODULE_COUNT }, (_, i) => i)
    : [parseInt(moduleSelect.value, 10)];

  firmwareUpdateBtn.disabled = true;
  firmwareFeedback.textContent = '';
  firmwareFeedback.className = 'feedback';

  if (firmwareMode === 'url') {
    const url = firmwareUrlInput.value.trim();
    if (!url) { firmwareUpdateBtn.disabled = false; return; }

    const result = await window.splitflap.sendFirmwareUpdateFromUrl(selectedId, modules, url, ssid, password);
    if (result.ok) {
      setFeedback(firmwareFeedback, result,
        `Update initiated for ${modules.length} module${modules.length !== 1 ? 's' : ''}. Modules will download firmware and reboot automatically.`);
    } else {
      setFeedback(firmwareFeedback, result);
    }
    firmwareUpdateBtn.disabled = !url || !ssid;
    return;
  }

  if (!firmwareFilePath) { firmwareUpdateBtn.disabled = false; return; }

  await window.splitflap.startFirmwareServer(firmwareFilePath);

  if (!firmwareServerInfo) {
    setFeedback(firmwareFeedback, { ok: false, error: 'Server not ready' });
    firmwareUpdateBtn.disabled = false;
    return;
  }

  const { ip, port } = firmwareServerInfo;

  updatingDisplayId = selectedId;
  firmwarePendingAcks = new Set(modules);
  buildFirmwareProgressGrid(modules);
  firmwareProgressLabel.textContent = `Waiting for ${modules.length} module${modules.length !== 1 ? 's' : ''} to confirm…`;
  firmwareForm.style.display = 'none';
  firmwareProgress.style.display = 'flex';

  const result = await window.splitflap.sendFirmwareUpdate(selectedId, modules, ip, port, ssid, password);
  if (!result.ok) {
    setFeedback(firmwareFeedback, result);
    stopFirmwareUpdate();
  }
});

firmwareCancelBtn.addEventListener('click', stopFirmwareUpdate);

function buildFirmwareProgressGrid(modules) {
  firmwareModuleGrid.innerHTML = '';
  for (const mod of modules) {
    const el = document.createElement('div');
    el.className = 'firmware-module-item';
    el.id = `fw-mod-${mod}`;
    el.textContent = mod;
    firmwareModuleGrid.appendChild(el);
  }
}

function stopFirmwareUpdate() {
  window.splitflap.stopFirmwareServer();
  firmwarePendingAcks.clear();
  firmwareStateByDisplay.delete(updatingDisplayId);
  updatingDisplayId = null;
  firmwareForm.style.display = '';
  firmwareProgress.style.display = 'none';
  refreshFirmwareBtn();
}

function applyModuleClassToState(state, index, className) {
  const temp = document.createElement('div');
  temp.innerHTML = state.gridHTML;
  const el = temp.querySelector(`#fw-mod-${index}`);
  if (el) el.className = className;
  state.gridHTML = temp.innerHTML;
}

window.splitflap.onFirmwareRequested(({ index }) => {
  if (updatingDisplayId === selectedId) {
    const el = document.getElementById(`fw-mod-${index}`);
    if (el) el.className = 'firmware-module-item requested';
  } else {
    const state = firmwareStateByDisplay.get(updatingDisplayId);
    if (state) applyModuleClassToState(state, index, 'firmware-module-item requested');
  }
});

window.splitflap.onFirmwareAck(({ index }) => {
  if (updatingDisplayId === selectedId) {
    const el = document.getElementById(`fw-mod-${index}`);
    if (el) el.className = 'firmware-module-item ok';

    firmwarePendingAcks.delete(index);
    firmwareProgressLabel.textContent = firmwarePendingAcks.size === 0
      ? 'All modules updated.'
      : `Waiting for ${firmwarePendingAcks.size} more module${firmwarePendingAcks.size !== 1 ? 's' : ''}…`;

    if (firmwarePendingAcks.size === 0) {
      stopFirmwareUpdate();
      setFeedback(firmwareFeedback, { ok: true }, 'Firmware update complete.');
    }
  } else {
    const state = firmwareStateByDisplay.get(updatingDisplayId);
    if (state) {
      applyModuleClassToState(state, index, 'firmware-module-item ok');
      state.pendingAcks.delete(index);
      state.labelText = state.pendingAcks.size === 0
        ? 'All modules updated.'
        : `Waiting for ${state.pendingAcks.size} more module${state.pendingAcks.size !== 1 ? 's' : ''}…`;
      if (state.pendingAcks.size === 0) {
        state.showingProgress = false;
        window.splitflap.stopFirmwareServer();
        firmwareStateByDisplay.delete(updatingDisplayId);
        updatingDisplayId = null;
      }
    }
  }
});

// ── mDNS events ───────────────────────────────────────────────

window.splitflap.onDisplayFound((display) => {
  displays.set(display.id, display);
  renderList();
});

window.splitflap.onDisplayLost((id) => {
  displays.delete(id);
  if (updatingDisplayId === id) {
    window.splitflap.stopFirmwareServer();
    firmwareStateByDisplay.delete(id);
    updatingDisplayId = null;
  }
  if (selectedId === id) {
    selectedId = null;
    controlsEl.style.display = 'none';
    noSelectionEl.style.display = '';
    resetHoming();
    firmwarePendingAcks.clear();
    firmwareForm.style.display = '';
    firmwareProgress.style.display = 'none';
  }
  renderList();
});

document.getElementById('footer-link').addEventListener('click', () => {
  window.splitflap.openExternal('https://www.flipforward.de');
});

// ── Activity log ──────────────────────────────────────────────

const logToggleBtn  = document.getElementById('log-toggle');
const logEntriesEl  = document.getElementById('log-entries');
const logClearBtn   = document.getElementById('log-clear-btn');
let logAutoScroll   = true;

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function buildLogEntryEl(entry) {
  const el = document.createElement('div');
  el.className = 'log-entry ' + (entry.ok ? 'log-ok' : 'log-err');

  let label, statusText;
  if (entry.direction === 'out') {
    label = `${entry.url}  ${entry.command}`;
    statusText = entry.ok ? `${entry.status ?? 200}` : (entry.error ?? 'error');
  } else {
    label = `← ${entry.method} ${entry.path}`;
    statusText = entry.ok ? `${entry.status}` : `${entry.status} ${entry.error ?? ''}`.trim();
  }

  el.innerHTML =
    `<span class="log-time">${formatTime(entry.ts)}</span>` +
    `<span class="log-dir ${entry.direction === 'out' ? 'out' : 'in'}">${entry.direction === 'out' ? '↑' : '↓'}</span>` +
    `<span class="log-label" title="${label.replace(/"/g, '&quot;')}">${label}</span>` +
    `<span class="log-status">${statusText}</span>`;

  return el;
}

function appendLogEntry(entry) {
  const el = buildLogEntryEl(entry);
  logEntriesEl.appendChild(el);
  if (logAutoScroll) logEntriesEl.scrollTop = logEntriesEl.scrollHeight;
}

logEntriesEl.addEventListener('scroll', () => {
  const { scrollTop, scrollHeight, clientHeight } = logEntriesEl;
  logAutoScroll = scrollHeight - scrollTop - clientHeight < 8;
});

logClearBtn.addEventListener('click', () => {
  logEntriesEl.innerHTML = '';
});

logToggleBtn.addEventListener('click', () => {
  const open = document.body.classList.toggle('log-open');
  logToggleBtn.classList.toggle('active', open);
  if (open) logEntriesEl.scrollTop = logEntriesEl.scrollHeight;
});

window.splitflap.getLogs().then((entries) => {
  for (const entry of entries) appendLogEntry(entry);
});

window.splitflap.onLogEntry((entry) => {
  appendLogEntry(entry);
});

window.splitflap.listDisplays().then((list) => {
  for (const d of list) displays.set(d.id, d);
  renderList();
});

// ── Device log ────────────────────────────────────────────────

const deviceLogFormEl      = document.getElementById('device-log-form');
const deviceLogWaitingEl   = document.getElementById('device-log-waiting');
const deviceLogWaitLabel   = document.getElementById('device-log-wait-label');
const deviceLogWaitGrid    = document.getElementById('device-log-wait-grid');
const deviceLogResultEl    = document.getElementById('device-log-result');
const deviceLogCountEl     = document.getElementById('device-log-result-count');
const deviceLogModuleTabs  = document.getElementById('device-log-module-tabs');
const deviceLogListEl      = document.getElementById('device-log-list');
const deviceLogFeedback    = document.getElementById('device-log-feedback');
const fetchLogBtn          = document.getElementById('fetch-log-btn');
const deviceLogFinishBtn   = document.getElementById('device-log-finish-btn');
const deviceLogRefetchBtn  = document.getElementById('device-log-refetch-btn');
const deviceLogSsid        = document.getElementById('device-log-ssid');
const deviceLogPassword    = document.getElementById('device-log-password');
const deviceLogPwdToggle   = document.getElementById('device-log-pwd-toggle');

const EVENT_BADGE_LABELS = {
  0x01: 'BOOT',
  0x02: 'OTA START',
  0x03: 'OTA OK',
  0x04: 'OTA FAIL',
  0x05: 'HOMING OK',
  0x07: 'ROTATION',
  0x08: 'WIFI UP',
  0x09: 'WIFI DROP',
  0x0A: 'BAD CMD',
  0x0B: 'WIFI FAIL',
  0x0C: 'NO UPDATE',
};

function eventBadgeClass(event) {
  if (event === 0x01) return 'evt-boot';
  if (event === 0x08) return 'evt-wifi-ok';
  if (event === 0x09) return 'evt-wifi-drop';
  if (event === 0x05) return 'evt-homing';
  if (event === 0x07) return 'evt-rotation';
  if ([0x02, 0x03, 0x0C].includes(event)) return 'evt-ota';
  if ([0x04, 0x0A, 0x0B].includes(event)) return 'evt-error';
  return 'evt-unknown';
}

function eventDetail(entry) {
  switch (entry.event) {
    case 0x01: return entry.str ? `fw ${entry.str}` : '';
    case 0x02: return [entry.str ? `url: ${entry.str}` : '', entry.value ? `heap: ${entry.value}` : ''].filter(Boolean).join('  ');
    case 0x04: return [entry.str || '', entry.value ? `err ${entry.value}` : ''].filter(Boolean).join('  ');
    case 0x07: return `${entry.value} lifetime rotations`;
    case 0x0A: return entry.str ? `cmd: ${entry.str}` : '';
    case 0x0B: return `wl_status: ${entry.value}`;
    default:   return entry.str || '';
  }
}

function formatDeviceLogTime(ts) {
  if (!ts) return 'no time';
  const d = new Date(ts * 1000);
  return d.toLocaleString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function buildDeviceLogEntryEl(entry) {
  const el = document.createElement('div');
  el.className = 'device-log-entry';
  const label = EVENT_BADGE_LABELS[entry.event] ?? entry.name;
  const badgeClass = eventBadgeClass(entry.event);
  const detail = eventDetail(entry);
  el.innerHTML =
    `<span class="evt-badge ${badgeClass}">${label}</span>` +
    `<span class="device-log-num">#${entry.eventNumber}</span>` +
    `<span class="device-log-time">${formatDeviceLogTime(entry.timestamp)}</span>` +
    `<span class="device-log-detail" title="${detail.replace(/"/g, '&quot;')}">${detail}</span>`;
  return el;
}

// deviceLogs: displayId → Map<moduleIndex, entries[]>
const deviceLogs = new Map();
let deviceLogPendingModules = new Set();
let deviceLogFetchingId = null;
let deviceLogActiveModule = null;
function showDeviceLogForm() {
  deviceLogFormEl.style.display = '';
  deviceLogWaitingEl.style.display = 'none';
  deviceLogResultEl.style.display = 'none';
}

function startDeviceLogWaiting(modules) {
  deviceLogFormEl.style.display = 'none';
  deviceLogWaitingEl.style.display = '';
  deviceLogResultEl.style.display = 'none';
  deviceLogWaitGrid.innerHTML = '';
  for (const mod of [...modules].sort((a, b) => a - b)) {
    const el = document.createElement('div');
    el.className = 'device-log-wait-item';
    el.id = `dl-wait-${mod}`;
    el.textContent = mod;
    deviceLogWaitGrid.appendChild(el);
  }
  const count = modules.length;
  deviceLogWaitLabel.textContent = `Waiting for ${count} module${count !== 1 ? 's' : ''} to upload logs…`;
}

function markModuleLogReceived(modIdx) {
  const el = document.getElementById(`dl-wait-${modIdx}`);
  if (el) el.className = 'device-log-wait-item received';
  deviceLogPendingModules.delete(modIdx);
  const remaining = deviceLogPendingModules.size;
  if (remaining > 0) {
    deviceLogWaitLabel.textContent = `Waiting for ${remaining} more module${remaining !== 1 ? 's' : ''}…`;
  } else {
    showDeviceLogResult(deviceLogFetchingId);
  }
}

function showDeviceLogResult(id) {
  const logs = deviceLogs.get(id);
  if (!logs || logs.size === 0) return;

  deviceLogFormEl.style.display = 'none';
  deviceLogWaitingEl.style.display = 'none';
  deviceLogResultEl.style.display = '';

  const moduleIds = [...logs.keys()].sort((a, b) => a - b);

  // Rebuild module tabs
  deviceLogModuleTabs.innerHTML = '';
  if (moduleIds.length > 1) {
    for (const modIdx of moduleIds) {
      const btn = document.createElement('button');
      btn.className = 'device-log-mod-tab';
      btn.textContent = `Module ${modIdx}`;
      btn.dataset.mod = modIdx;
      btn.addEventListener('click', () => renderModuleLog(id, modIdx));
      deviceLogModuleTabs.appendChild(btn);
    }
  }

  // Show previously active module or first available
  if (deviceLogActiveModule === null || !logs.has(deviceLogActiveModule)) {
    deviceLogActiveModule = moduleIds[0];
  }
  renderModuleLog(id, deviceLogActiveModule);
}

function renderModuleLog(id, modIdx) {
  deviceLogActiveModule = modIdx;
  const logs = deviceLogs.get(id);
  const entries = logs?.get(modIdx) ?? [];

  deviceLogModuleTabs.querySelectorAll('.device-log-mod-tab').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.mod, 10) === modIdx);
  });

  deviceLogListEl.innerHTML = '';
  const reversed = [...entries].reverse();
  for (const entry of reversed) deviceLogListEl.appendChild(buildDeviceLogEntryEl(entry));

  const moduleLabel = deviceLogs.get(id)?.size > 1 ? ` · Module ${modIdx}` : '';
  deviceLogCountEl.textContent = `${entries.length} entries${moduleLabel}`;
}

function restoreDeviceLogState(id) {
  deviceLogPendingModules = new Set();
  deviceLogFetchingId = null;
  deviceLogActiveModule = null;
  const saved = deviceLogs.get(id);
  if (saved && saved.size > 0) {
    showDeviceLogResult(id);
  } else {
    showDeviceLogForm();
  }
  deviceLogFeedback.textContent = '';
  deviceLogFeedback.className = 'feedback';
}

// Pre-fill from the same localStorage keys as the firmware card
deviceLogSsid.value     = localStorage.getItem('firmware.ssid') ?? '';
deviceLogPassword.value = localStorage.getItem('firmware.password') ?? '';

deviceLogSsid.addEventListener('input', () => localStorage.setItem('firmware.ssid', deviceLogSsid.value));
deviceLogPassword.addEventListener('input', () => localStorage.setItem('firmware.password', deviceLogPassword.value));

deviceLogPwdToggle.addEventListener('click', () => {
  const isPwd = deviceLogPassword.type === 'password';
  deviceLogPassword.type = isPwd ? 'text' : 'password';
  deviceLogPwdToggle.title = isPwd ? 'Hide password' : 'Show password';
});

fetchLogBtn.addEventListener('click', async () => {
  if (!selectedId) return;
  const ssid = deviceLogSsid.value.trim();
  if (!ssid) { setFeedback(deviceLogFeedback, { ok: false, error: 'WiFi SSID is required.' }); return; }
  const password = deviceLogPassword.value;

  const modules = moduleSelect.value === '@'
    ? Array.from({ length: MODULE_COUNT }, (_, i) => i)
    : [parseInt(moduleSelect.value, 10)];

  fetchLogBtn.disabled = true;
  deviceLogFeedback.textContent = '';
  deviceLogFeedback.className = 'feedback';

  deviceLogPendingModules = new Set(modules);
  deviceLogFetchingId = selectedId;

  const result = await window.splitflap.fetchDeviceLog(selectedId, modules, ssid, password);
  fetchLogBtn.disabled = false;

  if (!result.ok) {
    setFeedback(deviceLogFeedback, result);
    deviceLogPendingModules = new Set();
    deviceLogFetchingId = null;
    return;
  }

  startDeviceLogWaiting(modules);
});

deviceLogFinishBtn.addEventListener('click', () => {
  deviceLogPendingModules = new Set();
  const logs = deviceLogs.get(deviceLogFetchingId);
  if (logs && logs.size > 0) {
    showDeviceLogResult(deviceLogFetchingId);
    const count = logs.size;
    setFeedback(deviceLogFeedback, { ok: true }, `Showing logs from ${count} module${count !== 1 ? 's' : ''}.`);
  } else {
    showDeviceLogForm();
  }
});

deviceLogRefetchBtn.addEventListener('click', () => {
  deviceLogActiveModule = null;
  showDeviceLogForm();
});

window.splitflap.onDeviceLogEntries(({ id, module: modIdx, entries }) => {
  if (!deviceLogs.has(id)) deviceLogs.set(id, new Map());
  deviceLogs.get(id).set(modIdx, entries);

  if (id === deviceLogFetchingId) {
    if (id === selectedId) markModuleLogReceived(modIdx);
    else deviceLogPendingModules.delete(modIdx);

    if (deviceLogPendingModules.size === 0) {
      const total = deviceLogs.get(id).size;
      if (id === selectedId) {
        setFeedback(deviceLogFeedback, { ok: true }, `Fetched logs from ${total} module${total !== 1 ? 's' : ''}.`);
      }
    }
  } else if (id === selectedId) {
    showDeviceLogResult(id);
  }
});
