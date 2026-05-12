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
                      <div class="display-host">${display.host}:${display.port}</div>`;
      el.addEventListener('click', () => selectDisplay(display.id));
      listEl.appendChild(el);
    }
  }

  statusEl.textContent = displays.size === 0
    ? 'Scanning…'
    : `${displays.size} display${displays.size !== 1 ? 's' : ''} found`;
}

function selectDisplay(id) {
  selectedId = id;
  renderList();
  noSelectionEl.style.display = 'none';
  controlsEl.style.display = '';
  clearFeedback();
  resetHoming();
  updateHomingCardState();
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
  [sendFeedback, displaycharFeedback, homingFeedback, homingConfirmFeedback, firmwareFeedback].forEach((el) => {
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
  firmwareUpdateBtn.disabled = !firmwareFilePath || !firmwareSsid.value.trim();
}

refreshFirmwareBtn();

firmwareUpdateBtn.addEventListener('click', async () => {
  if (!selectedId || !firmwareFilePath) return;

  const ssid = firmwareSsid.value.trim();
  const password = firmwarePassword.value;

  firmwareUpdateBtn.disabled = true;
  firmwareFeedback.textContent = '';
  firmwareFeedback.className = 'feedback';

  const serverResult = await window.splitflap.startFirmwareServer(firmwareFilePath);
  if (!serverResult.ok) {
    setFeedback(firmwareFeedback, serverResult);
    firmwareUpdateBtn.disabled = false;
    return;
  }

  const { ip, port } = serverResult;
  const modules = moduleSelect.value === '@'
    ? Array.from({ length: MODULE_COUNT }, (_, i) => i)
    : [parseInt(moduleSelect.value, 10)];

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
  firmwareForm.style.display = '';
  firmwareProgress.style.display = 'none';
  firmwareUpdateBtn.disabled = !firmwareFilePath || !firmwareSsid.value.trim();
}

window.splitflap.onFirmwareAck(({ index }) => {
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
});

// ── mDNS events ───────────────────────────────────────────────

window.splitflap.onDisplayFound((display) => {
  displays.set(display.id, display);
  renderList();
});

window.splitflap.onDisplayLost((id) => {
  displays.delete(id);
  if (selectedId === id) {
    selectedId = null;
    controlsEl.style.display = 'none';
    noSelectionEl.style.display = '';
    resetHoming();
  }
  renderList();
});

document.getElementById('footer-link').addEventListener('click', () => {
  window.splitflap.openExternal('https://www.flipforward.de');
});

window.splitflap.listDisplays().then((list) => {
  for (const d of list) displays.set(d.id, d);
  renderList();
});
