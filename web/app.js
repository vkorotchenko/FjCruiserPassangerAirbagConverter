'use strict';
/*
 * FJ OCS Converter web UI.
 * Talks to the ESP32 bridge over a single WebSocket using the newline-JSON
 * control protocol (include/control_protocol.h). The ESP32 relays verbatim
 * to/from the M0, which is the single source of truth for config and state.
 */

// ----- WebSocket plumbing --------------------------------------------------
let ws;
let seq = 1;
const pending = new Map();          // command id -> description (for ack/err toasts)
let logPaused = false;

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => setPill('pill-link', 'ok');
  ws.onclose = () => { setPill('pill-link', 'down'); setTimeout(connect, 1500); };
  ws.onmessage = (e) => {
    // The ESP32 may batch lines; split on newlines just in case.
    e.data.split('\n').forEach((line) => {
      line = line.trim();
      if (line) handle(JSON.parse(line));
    });
  };
}

function send(obj, desc) {
  if (!ws || ws.readyState !== WebSocket.OPEN) { toast('Not connected', true); return; }
  obj.id = seq++;
  if (desc) pending.set(obj.id, desc);
  ws.send(JSON.stringify(obj));
}

// ----- Incoming message dispatch ------------------------------------------
function handle(m) {
  switch (m.t) {
    case 'config': applyConfig(m.cfg); break;
    case 'state':  applyState(m); break;
    case 'log':    appendLog(m); break;
    case 'frame':  onFrame(m); break;
    case 'ack':    pending.delete(m.id); break;
    case 'err':    toast(`Error: ${m.code} ${m.msg || ''}`, true); pending.delete(m.id); break;
  }
}

// ----- Monitor -------------------------------------------------------------
const PASSENGER = ['None', 'Child', 'Adult'];

function applyState(s) {
  if ('buckled' in s) {
    const el = document.getElementById('m-buckled');
    el.textContent = s.buckled ? 'Buckled' : 'Unbuckled';
    el.className = 'value ' + (s.buckled ? 'on' : 'off');
  }
  if ('passengerType' in s) {
    const el = document.getElementById('m-passenger');
    el.textContent = PASSENGER[s.passengerType] || '—';
    el.className = 'value ' + (s.passengerType === 2 ? 'on' : s.passengerType === 1 ? 'warn' : 'off');
  }
  if ('override' in s) {
    const el = document.getElementById('m-override');
    el.textContent = s.override ? 'Active' : 'Off';
    el.className = 'value ' + (s.override ? 'warn' : '');
  }
  if ('linkKline' in s) setPill('pill-kline', s.linkKline === 'ok' ? 'ok' : 'down');
  if ('linkCan' in s)   setPill('pill-can', s.linkCan === 'ok' ? 'ok' : 'down');
  if ('linkM0' in s)    setPill('pill-link', s.linkM0 === 'ok' ? 'ok' : 'down');
}

const logEl = document.getElementById('log');
function appendLog(m) {
  if (logPaused) return;
  if (m.lvl === 'debug' && !document.getElementById('log-debug').checked) return;
  const line = document.createElement('div');
  if (m.lvl === 'debug') line.className = 'debug';
  line.textContent = m.msg;
  logEl.appendChild(line);
  while (logEl.childNodes.length > 500) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

// ----- Config / Tuning two-way binding ------------------------------------
let knownConfig = {};

function applyConfig(cfg) {
  knownConfig = Object.assign(knownConfig, cfg);
  document.querySelectorAll('[data-cfg]').forEach((el) => {
    const k = el.dataset.cfg;
    if (!(k in cfg)) return;
    if (el.type === 'checkbox') el.checked = !!cfg[k];
    else el.value = cfg[k];
    if (el.type === 'range') syncOutput(el);
  });
  document.querySelectorAll('[data-cfg-hex]').forEach((el) => {
    const k = el.dataset.cfgHex;
    if (k in cfg) el.value = '0x' + Number(cfg[k]).toString(16).toUpperCase();
  });
  if ('version' in cfg) document.getElementById('cfg-version').textContent = cfg.version;
}

function syncOutput(rangeEl) {
  const out = document.querySelector(`output[data-for="${rangeEl.dataset.cfg}"]`);
  if (out) out.textContent = rangeEl.value;
}

function setConfig(partial, desc) {
  send({ t: 'set_config', cfg: partial }, desc || 'set_config');
}

// Bind the boolean toggles, sliders and protocol select (auto-persist on change).
document.querySelectorAll('[data-cfg]').forEach((el) => {
  if (el.type === 'range') el.addEventListener('input', () => syncOutput(el));
  el.addEventListener('change', () => {
    const k = el.dataset.cfg;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'range' || el.tagName === 'SELECT') v = parseInt(el.value, 10);
    else v = el.value;
    setConfig({ [k]: v });
  });
});

// Config tab: Save hex fields (CAN IDs + PIDs) together.
document.getElementById('cfg-save').addEventListener('click', () => {
  const cfg = {};
  let bad = false;
  document.querySelectorAll('[data-cfg-hex]').forEach((el) => {
    const n = parseInt(el.value.trim().replace(/^0x/i, ''), 16);
    if (Number.isNaN(n)) { bad = true; el.style.borderColor = 'var(--down)'; }
    else { el.style.borderColor = ''; cfg[el.dataset.cfgHex] = n; }
  });
  if (bad) { toast('Invalid hex value', true); return; }
  setConfig(cfg, 'save');
  toast('Saved to flash');
});

document.getElementById('cfg-reset').addEventListener('click', () => {
  if (confirm('Reset all settings to factory defaults?')) send({ t: 'reset' }, 'reset');
});

// Manual override
document.getElementById('ov-apply').addEventListener('click', () => {
  send({
    t: 'set_override',
    enabled: document.getElementById('ov-enabled').checked,
    buckled: document.getElementById('ov-buckled').checked,
    passengerType: parseInt(document.getElementById('ov-passenger').value, 10),
  }, 'override');
  toast('Override applied');
});

// ----- Capture -------------------------------------------------------------
const captured = new Map();         // key -> { bus, id, len, data, prev, count, mode }
const capBody = document.querySelector('#cap-table tbody');

function capKey(f) { return `${f.bus}:${f.id}`; }

function onFrame(f) {
  const key = capKey(f);
  let row = captured.get(key);
  if (!row) {
    row = { bus: f.bus, id: f.id, mode: f.mode, len: f.len, data: f.data, prev: f.data, count: 0 };
    captured.set(key, row);
  } else {
    row.prev = row.data; row.data = f.data; row.len = f.len;
  }
  row.count++;
  renderCapture();
}

function hex(n, pad) { return '0x' + Number(n).toString(16).toUpperCase().padStart(pad || 0, '0'); }

function renderCapture() {
  const rows = [...captured.values()].sort((a, b) => (a.bus - b.bus) || (a.id - b.id));
  capBody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    const bytes = r.data.map((b, i) => {
      const changed = r.prev && r.prev[i] !== b;
      return `<span class="byte${changed ? ' changed' : ''}">${b.toString(16).toUpperCase().padStart(2, '0')}</span>`;
    }).join(' ');
    const idLabel = r.bus === 0 ? hex(r.id, 3) : `mode ${hex(r.mode)} pid ${hex(r.id, 2)}`;
    tr.innerHTML =
      `<td>${r.bus === 0 ? 'CAN' : 'K-line'}</td><td>${idLabel}</td>` +
      `<td>${r.len}</td><td>${bytes}</td><td>${r.count}</td>`;
    capBody.appendChild(tr);
  }
  document.getElementById('cap-count').textContent = `${captured.size} ids`;
}

document.getElementById('cap-start').addEventListener('click', () => {
  send({ t: 'start_capture', src: document.getElementById('cap-src').value }, 'capture');
});
document.getElementById('cap-stop').addEventListener('click', () => send({ t: 'stop_capture' }, 'capture'));
document.getElementById('cap-clear').addEventListener('click', () => { captured.clear(); renderCapture(); });

// Export captured frames as a vehicle_protocols.json signals[] snippet.
document.getElementById('cap-export-json').addEventListener('click', () => {
  const signals = [...captured.values()].map((r) => (r.bus === 0 ? {
    key: `captured_can_${hex(r.id, 3)}`,
    transport: 'can',
    id: hex(r.id, 3),
    len: r.len,
    byteEncoding: null,
    sampleData: r.data,
    framesSeen: r.count,
    source: 'captured',
    verified: false,
  } : {
    key: `captured_kline_${hex(r.id, 2)}`,
    transport: 'k-line-pid',
    mode: hex(r.mode),
    id: hex(r.id, 2),
    len: r.len,
    sampleData: r.data,
    source: 'captured',
    verified: false,
  }));
  download('captured_signals.json', JSON.stringify({ signals }, null, 2));
});

// Export as Mongo updateOne lines for data/vehicle_protocols.mongo.js style store.
document.getElementById('cap-export-mongo').addEventListener('click', () => {
  const lines = ['// Fill in the target vehicle _id before running.'];
  for (const r of captured.values()) {
    const frame = r.bus === 0
      ? { id: hex(r.id, 3), bus: 'can', len: r.len, sampleData: r.data, decoded: false }
      : { pid: hex(r.id, 2), bus: 'kline', mode: hex(r.mode), len: r.len, sampleData: r.data, decoded: false };
    lines.push(
      `db.vehicles.updateOne({ _id: 'TARGET_ID' }, ` +
      `{ $push: { 'occupantClassification.canFrames': ${JSON.stringify(frame)} } });`
    );
  }
  download('captured_frames.mongo.js', lines.join('\n'));
});

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ----- UI chrome -----------------------------------------------------------
function setPill(id, cls) {
  const el = document.getElementById(id);
  el.className = 'pill ' + cls;
}

let toastTimer;
function toast(msg, isErr) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 2200);
}

document.querySelectorAll('nav#tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav#tabs button').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + btn.dataset.tab));
  });
});

document.getElementById('log-pause').addEventListener('click', (e) => {
  logPaused = !logPaused;
  e.target.textContent = logPaused ? 'Resume' : 'Pause';
});
document.getElementById('log-clear').addEventListener('click', () => (logEl.innerHTML = ''));

connect();
