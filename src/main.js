// Air Violin: wires camera tracking, the game brain, sound and the screen together.

import { STRINGS, KEYS, KEY_ORDER, noteTable, slideNotes, isBlackKey, midiName } from './music.js';
import { Player, DEFAULT_SETTINGS } from './engine.js';
import { DEFAULT_CALIBRATION, DEFAULT_TUNING } from './tracking-logic.js';
import { Calibrator } from './calibration.js';
import { Tips, TIPS } from './tips.js';
import { ViolinAudio } from './audio.js';
import { Tracker } from './tracking.js';
import { makeFrame, rng } from './synthetic.js';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const DEMO = params.has('demo');
const $ = id => document.getElementById(id);

// ---------- Saved settings (localStorage only, always in try/catch) ----------
const STORE_KEY = 'airViolin.v1';
function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      settings: player.settings, calibration: player.cal,
      tuning: { stringStickiness: player.tuning.stringStickiness, stableFrames: player.tuning.stableFrames },
    }));
  } catch { /* storage blocked: settings just won't be remembered */ }
}
const stored = loadStore();
const player = new Player(stored.settings || {}, stored.calibration || {}, stored.tuning || {});
if (params.get('debug') === '1') player.settings.debug = true;
if (params.get('mode') === 'slide' || params.get('mode') === 'fingers') player.settings.mode = params.get('mode');

const audio = new ViolinAudio();
audio.volume = player.settings.volume;
const tracker = new Tracker();
let violin = null;
let calib = null;
let cameraOn = false;
let keyboardMode = false;
let lastFrameAt = 0;
let lastFrame = null;
let latency = { frameToSound: null, audioOut: null };

// ---------- Screen mapping: image coords (0..1, not mirrored) -> canvas pixels, mirrored ----------
const view = $('view');
const vctx = view.getContext('2d');
const video = $('video');
const mapping = { ox: 0, oy: 0, w: 1, h: 1, cw: 1, ch: 1, dpr: 1 };
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = view.getBoundingClientRect();
  view.width = Math.round(r.width * dpr); view.height = Math.round(r.height * dpr);
  mapping.cw = r.width; mapping.ch = r.height; mapping.dpr = dpr;
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
  const scale = Math.max(r.width / vw, r.height / vh);
  mapping.w = vw * scale; mapping.h = vh * scale;
  mapping.ox = (r.width - mapping.w) / 2; mapping.oy = (r.height - mapping.h) / 2;
  if (violin) violin.resize(r.width, r.height, dpr);
  $('rotate').hidden = !(window.matchMedia('(pointer: coarse)').matches && r.height > r.width * 1.1);
}
const toScreen = p => ({ x: mapping.ox + (1 - p.x) * mapping.w, y: mapping.oy + p.y * mapping.h });
window.addEventListener('resize', resize);

// ---------- Piano strip ----------
const PIANO_LO = 53, PIANO_HI = 86; // F3..D6
const pianoKeys = new Map();
function buildPiano() {
  const piano = $('piano');
  piano.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'keys-wrap';
  piano.appendChild(wrap);
  const whites = [];
  for (let m = PIANO_LO; m <= PIANO_HI; m++) if (!isBlackKey(m)) whites.push(m);
  const ww = 100 / whites.length;
  let wi = 0;
  for (let m = PIANO_LO; m <= PIANO_HI; m++) {
    const k = document.createElement('div');
    const black = isBlackKey(m);
    k.className = 'pkey ' + (black ? 'black' : 'white');
    if (black) { k.style.left = `${(wi - 0.32) * ww}%`; k.style.width = `${ww * 0.64}%`; }
    else { k.style.left = `${wi * ww}%`; k.style.width = `${ww}%`; wi++; }
    k.dataset.midi = m;
    k.title = midiName(m);
    if (!black && m % 12 === 0) k.textContent = midiName(m);
    wrap.appendChild(k);
    pianoKeys.set(m, k);
  }
  markKeyNotes();
}
// Press and hold a piano key to hear that note bowed (mouse or touch).
function pianoDown(e) {
  const k = e.target.closest('.pkey');
  if (!k || !$('start').hidden) return;
  e.preventDefault();
  const kb = player.keyboard;
  kb.midi = +k.dataset.midi;
  kb.bowDir = kb.lastDir === -1 ? 1 : -1; kb.lastDir = kb.bowDir; kb.strokeId++;
  kb.active = true; lastKeyAt = performance.now();
  if (!audio.ctx) audio.init().catch(() => {});
  try { k.setPointerCapture(e.pointerId); } catch { /* fine */ }
}
function pianoUp() {
  const kb = player.keyboard;
  if (kb.midi == null) return;
  kb.midi = null;
  if (!held.size) kb.bowDir = 0;
}
$('piano').addEventListener('pointerdown', pianoDown);
// Notes in the help table play too (press and hold), on that exact string and finger.
$('note-table').addEventListener('pointerdown', e => {
  const td = e.target.closest('td[data-midi]');
  if (!td) return;
  e.preventDefault();
  const kb = player.keyboard;
  kb.midi = null; kb.string = +td.dataset.string; kb.finger = +td.dataset.finger;
  kb.bowDir = kb.lastDir === -1 ? 1 : -1; kb.lastDir = kb.bowDir; kb.strokeId++;
  kb.active = true; lastKeyAt = performance.now();
  if (!audio.ctx) audio.init().catch(() => {});
  const stop = () => { if (!held.size) kb.bowDir = 0; window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
  window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
});
$('piano').addEventListener('pointerup', pianoUp);
$('piano').addEventListener('pointercancel', pianoUp);

function markKeyNotes() {
  const inKey = new Set(Object.values(noteTable(player.settings.key)).flat().map(n => n.midi));
  for (const [m, k] of pianoKeys) k.classList.toggle('inkey', inKey.has(m));
}

// ---------- Help table ----------
function buildHelp() {
  const t = noteTable(player.settings.key);
  $('help-key').textContent = KEYS[player.settings.key].label;
  const st = player.state;
  let html = '<tr><th></th><th colspan="5">Fingers folded down</th></tr><tr><th>String</th><th>Open</th><th>1</th><th>2</th><th>3</th><th>4</th></tr>';
  for (const s of STRINGS) {
    html += `<tr><td class="str">${s}</td>` + t[s].map(n =>
      `<td class="${st.string === s && st.finger === n.finger ? 'cur' : ''}" data-midi="${n.midi}" data-string="${STRINGS.indexOf(s)}" data-finger="${n.finger}">${n.name}<sub>${n.octave}</sub></td>`).join('') + '</tr>';
  }
  $('note-table').innerHTML = html;
  $('help-mode-text').textContent = player.settings.mode === 'slide'
    ? `Slide mode: move your left hand away from your shoulder to go up through ${slideNotes(player.settings.key).length} notes, from ${t.G[0].name} up to ${t.E[4].name}. Your right elbow isn't needed for the string.`
    : 'Fingers mode: right elbow picks the row (string), folded left-hand fingers pick the column.';
}

// ---------- Settings ----------
function initSettings() {
  const sel = $('set-key');
  sel.innerHTML = KEY_ORDER.map(k => `<option value="${k}">${KEYS[k].label}</option>`).join('');
  syncSettingsUI();
  const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
  on('set-key', 'change', e => { player.setSettings({ key: e.target.value }); markKeyNotes(); buildHelp(); saveStore(); });
  on('set-mode', 'change', e => { player.setSettings({ mode: e.target.value }); buildHelp(); saveStore(); });
  on('set-vibrato', 'change', e => { player.setSettings({ vibrato: e.target.checked }); saveStore(); });
  on('set-violin', 'change', e => { player.setSettings({ showViolin: e.target.checked }); saveStore(); });
  on('set-debug', 'change', e => { player.setSettings({ debug: e.target.checked }); saveStore(); });
  on('set-volume', 'input', e => { player.setSettings({ volume: +e.target.value }); audio.setVolume(+e.target.value); saveStore(); });
  on('set-bowsens', 'input', e => { player.setSettings({ bowSensitivity: +e.target.value }); saveStore(); });
  on('set-stick', 'input', e => { player.tuning.stringStickiness = +e.target.value; saveStore(); });
  on('set-stable', 'change', e => { player.tuning.stableFrames = +e.target.value; saveStore(); });
  on('set-model', 'change', async e => {
    player.setSettings({ model: e.target.value }); saveStore();
    if (cameraOn) {
      setStatus('Loading tracking model…');
      try {
        await tracker.loadModels(player.settings.model, 'GPU', f => setStatus(`Loading tracking model… ${Math.round(f * 100)}%`));
      } catch (err) {
        // Couldn't load it (e.g. connection dropped): go back to the fast model so tracking keeps working.
        console.warn('model switch failed', err);
        player.setSettings({ model: 'lite' }); syncSettingsUI(); saveStore();
        await tracker.loadModels('lite').catch(() => setStatus('Tracking stopped: please reload the page'));
      }
      if (tracker.pose) setStatus(`Tracking on this device${tracker.delegate === 'CPU' ? ' (CPU)' : ''}`);
    }
  });
  on('set-recal', 'click', () => { closeOverlays(); startCalibration(); });
  on('set-reset', 'click', () => {
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    player.setSettings({ ...DEFAULT_SETTINGS });
    player.setCalibration(DEFAULT_CALIBRATION);
    Object.assign(player.tuning, DEFAULT_TUNING);
    audio.setVolume(player.settings.volume);
    syncSettingsUI(); markKeyNotes(); buildHelp();
  });
  on('set-close', 'click', closeOverlays);
}
function syncSettingsUI() {
  const s = player.settings;
  $('set-key').value = s.key; $('set-mode').value = s.mode; $('set-vibrato').checked = s.vibrato;
  $('set-violin').checked = s.showViolin; $('set-debug').checked = s.debug; $('set-volume').value = s.volume;
  $('set-bowsens').value = s.bowSensitivity ?? 1;
  $('set-stick').value = player.tuning.stringStickiness; $('set-stable').value = String(player.tuning.stableFrames);
  $('set-model').value = s.model;
}
function openOverlay(id) { closeOverlays(); if (id === 'help') buildHelp(); if (id === 'settings') syncSettingsUI(); $(id).hidden = false; }
function closeOverlays() { $('settings').hidden = true; $('help').hidden = true; }

// ---------- Calibration ----------
function startCalibration() {
  if (!cameraOn && !TEST) { setHint('Calibration needs the camera. Press "Start with camera" first.'); return; }
  if (tips) { tips = null; $('tips-card').hidden = true; }
  calib = new Calibrator(player.cal, { slide: player.settings.mode === 'slide' });
  $('calib-card').hidden = false;
  document.body.classList.add('calibrating');
  // First calibration can't be skipped straight away; if it isn't going anywhere, offer a way out after 20 s.
  const first = !player.cal.done;
  $('calib-skip').textContent = first ? 'Having trouble? Skip for now' : 'Skip (use last calibration)';
  $('calib-skip').hidden = first;
  calib.startedAt = performance.now();
  renderCalib();
}
function renderCalib() {
  if (!calib) return;
  const st = calib.current;
  $('calib-step').textContent = `Step ${calib.step + 1} of ${calib.steps.length}`;
  $('calib-title').textContent = st.title;
  $('calib-text').textContent = st.text;
  $('calib-progress').style.width = `${Math.round(calib.progress * 100)}%`;
  $('calib-msg').textContent = calib.message;
  if ($('calib-skip').hidden && performance.now() - calib.startedAt > 20000) $('calib-skip').hidden = false;
}

function drawCalibGuide(frame) {
  // Shows where to put your hands for the current calibration step.
  if (!calib || !frame || !frame.pose) return;
  const ls = toScreen(frame.pose[11]), rs = toScreen(frame.pose[12]), re = toScreen(frame.pose[14]);
  const S = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  if (S < 10) return;
  const c = vctx;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pulse = calm ? 0.9 : 0.6 + 0.4 * Math.sin(performance.now() / 250);
  c.save();
  c.lineWidth = 4; c.setLineDash([10, 8]);
  c.strokeStyle = `rgba(127, 214, 138, ${pulse})`;
  c.fillStyle = 'rgba(127, 214, 138, 0.9)';
  c.font = `bold ${Math.max(14, S * 0.11)}px system-ui`; c.textAlign = 'center';
  const id = calib.current.id;
  if (id === 'hold' || id === 'far') {
    // Left hand target: up and out from the left shoulder (screen-left, since the picture is a mirror).
    const d = id === 'hold' ? 0.6 : (player.cal.slideNear + 1.2);
    const p = { x: ls.x - 0.82 * d * S, y: ls.y - 0.57 * d * S };
    c.beginPath(); c.arc(p.x, p.y, S * 0.28, 0, 7); c.stroke();
    c.fillText(id === 'hold' ? 'left hand here' : 'reach out here', p.x, p.y - S * 0.34);
  } else {
    const up = id === 'g';
    const x = re.x + S * 0.35;
    c.setLineDash([]);
    c.beginPath(); c.moveTo(x, re.y + (up ? 0.3 : -0.3) * S); c.lineTo(x, re.y + (up ? -0.3 : 0.3) * S); c.stroke();
    c.beginPath();
    const tipY = re.y + (up ? -0.3 : 0.3) * S, dir = up ? 1 : -1;
    c.moveTo(x - S * 0.08, tipY + dir * S * 0.1); c.lineTo(x, tipY); c.lineTo(x + S * 0.08, tipY + dir * S * 0.1); c.stroke();
    c.fillText(up ? 'elbow up' : 'elbow down', x, tipY - dir * S * 0.06 + (up ? -S * 0.06 : S * 0.14));
  }
  c.restore();
}
function finishCalibration(result) {
  if (result) { player.setCalibration(result); saveStore(); setHint('Calibrated! Now play.', 3000); }
  calib = null;
  $('calib-card').hidden = true;
  document.body.classList.remove('calibrating');
  if (!player.settings.tipsDone) startTips();
}
$('calib-skip').addEventListener('click', () => {
  // A first-time skip uses the standard settings for now; calibration is offered again next time.
  finishCalibration(null);
});

// ---------- First steps coach (once, after the first calibration) ----------
let tips = null;
function startTips() { tips = new Tips(); $('tips-card').hidden = false; renderTips(); }
function endTips() {
  tips = null; $('tips-card').hidden = true;
  player.setSettings({ tipsDone: true }); saveStore();
}
function renderTips() {
  if (!tips) return;
  $('tips-step').textContent = tips.current.id === 'done' ? 'First steps: done' : `First steps ${tips.step + 1} of ${TIPS.length - 1}`;
  $('tips-text').textContent = tips.current.text;
  $('tips-progress').style.width = `${Math.round(Math.min(1, tips.held / 600) * 100)}%`;
}
$('tips-close').addEventListener('click', endTips);

// ---------- Messages ----------
let hintTimer = null;
function setHint(text, ms = 0) {
  $('hint').textContent = text;
  clearTimeout(hintTimer);
  if (ms) hintTimer = setTimeout(() => { $('hint').textContent = ''; }, ms);
}
function setStatus(text) { $('status').textContent = text; }

// ---------- Frames: camera (or injected synthetic) -> game -> sound ----------
function onFrame(frame) {
  const tIn = performance.now();
  lastFrame = frame; lastFrameAt = tIn;
  const s = player.update(frame);
  audio.update(s);
  if (calib) {
    calib.update(s.features, player.bow.speed, frame.t);
    if (calib.done) finishCalibration(calib.result);
  } else if (tips) {
    tips.update(s, frame.t);
    if (tips.finished) endTips(); else renderTips();
  }
  // Delay from the camera capturing the picture to the sound being scheduled, plus the audio output delay.
  const out = audio.latencyMs();
  latency.audioOut = out;
  if (frame.captureTime) latency.frameToSound = (performance.now() - frame.captureTime) + (out || 0);
  else latency.frameToSound = (performance.now() - (frame.trackStart || tIn)) + (tracker.stats.trackMs || 0) + (out || 0);
}
tracker.onFrame = onFrame;

// ---------- Keyboard controls ----------
const held = new Set();
let lastKeyAt = -1e9;
function keyDown(e) {
  if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;
  const k = e.key;
  const kb = player.keyboard;
  if (k === 'Escape') { closeOverlays(); return; }
  if (k === 'h' || k === 'H' || k === '?') { $('help').hidden ? openOverlay('help') : closeOverlays(); return; }
  if (!$('start').hidden) return;
  const up = k.toUpperCase();
  let used = true;
  if ('GDAE'.includes(up) && up.length === 1) { kb.string = 'GDAE'.indexOf(up); kb.midi = null; }
  else if (/^[0-4]$/.test(k)) { kb.finger = +k; kb.midi = null; }
  else if (k === ' ' || k === 'ArrowLeft' || k === 'ArrowRight') {
    if (!held.has(k)) {
      held.add(k);
      if (k === ' ') kb.bowDir = kb.lastDir === -1 ? 1 : -1;
      else kb.bowDir = k === 'ArrowLeft' ? -1 : 1;
      kb.lastDir = kb.bowDir;
      kb.strokeId++;
    }
  } else if (k === 'Shift') kb.loud = true;
  else if (up === 'V') kb.vibrato = true;
  else if (up === 'M') {
    if (e.repeat) return;
    const muted = player.settings.volume === 0;
    const v = muted ? (player.settings.lastVolume || 0.8) : 0;
    if (!muted) player.settings.lastVolume = player.settings.volume;
    player.setSettings({ volume: v }); audio.setVolume(v); saveStore();
    setHint(v ? 'Sound on' : 'Muted (press M again for sound)', 1500);
    return;
  }
  else used = false;
  if (used) {
    e.preventDefault();
    kb.active = true; lastKeyAt = performance.now();
    if (!audio.ctx) audio.init().catch(() => {});
  }
}
function keyUp(e) {
  const k = e.key, kb = player.keyboard;
  if (k === ' ' || k === 'ArrowLeft' || k === 'ArrowRight') {
    held.delete(k);
    if (![' ', 'ArrowLeft', 'ArrowRight'].some(x => held.has(x))) kb.bowDir = 0;
  } else if (k === 'Shift') kb.loud = false;
  else if (k.toUpperCase() === 'V') kb.vibrato = false;
}
window.addEventListener('keydown', keyDown);
window.addEventListener('keyup', keyUp);

// ---------- Drawing ----------
const POSE_LINKS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [0, 11], [0, 12]];
const HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

function drawSkeleton(frame, strong) {
  const c = vctx;
  if (frame.pose) {
    c.lineWidth = strong ? 4 : 3; c.strokeStyle = strong ? 'rgba(120,255,160,0.9)' : 'rgba(255,230,200,0.35)';
    c.beginPath();
    for (const [a, b] of POSE_LINKS) {
      const pa = frame.pose[a], pb = frame.pose[b];
      if (!pa || !pb || (pa.visibility ?? 1) < 0.4 || (pb.visibility ?? 1) < 0.4) continue;
      const A = toScreen(pa), B = toScreen(pb);
      c.moveTo(A.x, A.y); c.lineTo(B.x, B.y);
    }
    c.stroke();
    if (strong) {
      c.fillStyle = '#7dffa0';
      for (const i of [11, 12, 13, 14, 15, 16]) { const p = toScreen(frame.pose[i]); c.beginPath(); c.arc(p.x, p.y, 5, 0, 7); c.fill(); }
    }
  }
  for (const h of frame.hands || []) {
    c.strokeStyle = strong ? 'rgba(255,200,90,0.95)' : 'rgba(255,230,200,0.35)'; c.lineWidth = 2;
    c.beginPath();
    for (const [a, b] of HAND_LINKS) { const A = toScreen(h.landmarks[a]), B = toScreen(h.landmarks[b]); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); }
    c.stroke();
    if (strong) { c.fillStyle = '#ffd27a'; for (const p of h.landmarks) { const s = toScreen(p); c.fillRect(s.x - 2, s.y - 2, 4, 4); } }
  }
}

function drawStringGuide(s) {
  // Elbow-height guide next to the right shoulder: four zones, current one lit.
  const f = s.features;
  if (!f || !f.ok || player.settings.mode === 'slide' || !lastFrame || !lastFrame.pose) return;
  const rs = toScreen(lastFrame.pose[12]);
  const S = f.S * mapping.h; // shoulder width in pixels (image height units * scale)
  const x = rs.x + S * 0.85; // just outside the right elbow (screen is mirrored)
  const cal = player.cal;
  const c = vctx;
  c.font = `bold ${Math.max(12, S * 0.12)}px system-ui`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const step = (cal.elbowE - cal.elbowG) / 3;
  for (let i = 0; i < 4; i++) {
    const v = cal.elbowG + i * step;
    const y = rs.y - v * S;
    const on = s.stringIndex === i;
    c.fillStyle = on ? 'rgba(255,190,80,0.95)' : 'rgba(0,0,0,0.45)';
    c.beginPath(); c.arc(x, y, Math.max(11, S * 0.09), 0, 7); c.fill();
    c.fillStyle = on ? '#2a1300' : 'rgba(255,240,220,0.8)';
    c.fillText(STRINGS[i], x, y + 1);
  }
  const ey = rs.y - (f.elbowSmooth ?? f.elbowRel) * S;
  c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(x - S * 0.14, ey); c.lineTo(x + S * 0.14, ey); c.stroke();
}

function drawHandBubble(s) {
  // Right above the left hand: what the camera thinks the fingers are doing, and the note.
  // A page element (not canvas drawing) so it stays on top of the 3D violin.
  const el = $('hand-bubble');
  const f = s.features;
  if (!f || !f.ok || !f.leftHand) { el.hidden = true; return; }
  const pts = f.leftHand.landmarks.map(toScreen);
  const top = Math.min(...pts.map(p => p.y));
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const r = Math.max(15, f.S * mapping.h * 0.11);
  const y = Math.max(top - r * 1.5, r + 52); // never under the top bar
  const label = player.settings.mode === 'slide' ? s.note.name : (s.finger === 0 ? 'open' : `${s.finger}`);
  const text = label === s.note.name ? label : `${label} · ${s.note.name}`;
  if (el.textContent !== text) el.textContent = text;
  el.hidden = false;
  el.classList.toggle('on', s.amp > 0.02);
  el.style.fontSize = `${Math.round(r * 1.1)}px`;
  el.style.transform = `translate(${Math.round(cx)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
}

const demoRand = rng(5);
let demoT0 = performance.now();
function demoFrame(now) {
  // A fake player for screenshots and the demo link: bows up and down, walks through the fingers and strings.
  const t = (now - demoT0) / 1000;
  const bar = Math.floor(t / 1.2);
  const stringIdx = Math.floor(bar / 5) % 4;
  const cal = player.cal, step = (cal.elbowE - cal.elbowG) / 3;
  return makeFrame({
    t: now, aspect: 16 / 9, S: 0.34, cx: 0.5, cy: 0.5, elbowRel: cal.elbowG + stringIdx * step,
    folds: bar % 5, bowX: -0.55 + 0.5 * Math.sin(t * Math.PI / 1.2), slideDist: 0.6 + 0.25 * Math.sin(t * 0.7),
    wobble: 0.015 * Math.sin(t * 2 * Math.PI * 6), noise: 0.002,
  }, demoRand);
}

let frameCount = 0, fpsT = performance.now(), fps = 0;
let vignette = null;
function render(now) {
  requestAnimationFrame(render);
  frameCount++;
  if (now - fpsT > 1000) { fps = frameCount * 1000 / (now - fpsT); frameCount = 0; fpsT = now; }
  if (DEMO && !cameraOn) onFrame(demoFrame(now));
  // Keyboard-only play (or camera lost): keep the sound engine ticking.
  const kb = player.keyboard;
  if (kb.active && kb.bowDir === 0 && now - lastKeyAt > 4000) kb.active = false;
  if (now - lastFrameAt > 150 && !DEMO) { const s = player.tick(now); audio.update(s); }

  const c = vctx;
  c.setTransform(mapping.dpr, 0, 0, mapping.dpr, 0, 0);
  c.clearRect(0, 0, mapping.cw, mapping.ch);
  if (cameraOn && video.readyState >= 2) {
    c.save();
    c.translate(mapping.ox + mapping.w, mapping.oy); c.scale(-1, 1);
    c.drawImage(video, 0, 0, mapping.w, mapping.h);
    c.restore();
    // Gentle shading at the top and bottom so the buttons and note panel stay readable on any background.
    if (!vignette || vignette.h !== mapping.ch) {
      const g = c.createLinearGradient(0, 0, 0, mapping.ch);
      g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(0.18, 'rgba(0,0,0,0)');
      g.addColorStop(0.75, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
      vignette = { g, h: mapping.ch };
    }
    c.fillStyle = vignette.g; c.fillRect(0, 0, mapping.cw, mapping.ch);
  }
  const s = player.state;
  const fresh = lastFrame && now - lastFrameAt < 500;
  if (fresh) {
    if (player.settings.debug) drawSkeleton(lastFrame, true);
    else if (DEMO || lastFrame.synthetic) drawSkeleton(lastFrame, false);
    if (calib) drawCalibGuide(lastFrame); else { drawStringGuide(s); drawHandBubble(s); }
  }
  if (!fresh || calib) $('hand-bubble').hidden = true;
  if (violin) violin.update(fresh ? lastFrame : null, s, toScreen, mapping, player.settings.showViolin);
  updatePanel(s, now);
}

let lastPanelKey = '';
function updatePanel(s, now) {
  const sounding = s.amp > 0.02;
  const n = s.note;
  const key = `${n.midi}|${s.string}|${s.finger}|${sounding}|${player.settings.mode}`;
  if (key !== lastPanelKey) {
    lastPanelKey = key;
    $('note-letter').textContent = n.name;
    $('note-octave').textContent = n.octave;
    $('note-string').textContent = `${s.string} string`;
    $('note-finger').textContent = n.outOfKey ? `Not in ${KEYS[player.settings.key].label}`
      : s.finger === 0 ? 'Open string' : `${s.finger} finger${s.finger > 1 ? 's' : ''} down`;
    $('note-panel').classList.toggle('silent', !sounding);
    // The five notes on this string: finger number on top, the note it gives underneath.
    const row = noteTable(player.settings.key)[s.string] || [];
    $('finger-dots').innerHTML = [0, 1, 2, 3, 4].map(i => `<span class="${i === s.finger && !n.outOfKey ? 'on' : ''}"><small>${i === 0 ? 'O' : i}</small>${row[i] ? row[i].name : ''}</span>`).join('');
    for (const [m, k] of pianoKeys) {
      const cur = m === n.midi;
      k.classList.toggle('on', sounding && cur); k.classList.toggle('ready', !sounding && cur);
      // Name on the current key (spelled for the chosen key, e.g. B♭ not A♯); octave C labels otherwise.
      k.textContent = cur ? n.name : (!isBlackKey(m) && m % 12 === 0 ? midiName(m) : '');
    }
    if (!$('help').hidden) buildHelp();
  }
  const slideOn = player.settings.mode === 'slide';
  const hand = $('hand-icon');
  hand.hidden = slideOn || s.source === 'keyboard';
  if (!hand.hidden) {
    hand.classList.toggle('unseen', !(s.features && s.features.extension));
    hand.querySelectorAll('i').forEach(el => el.classList.toggle('folded', player.fingers.folded[+el.dataset.f]));
  }
  $('slide-bar').hidden = !slideOn;
  if (slideOn) {
    const n = slideNotes(player.settings.key).length;
    const bar = $('slide-bar');
    if (bar.childElementCount !== n + 1) {
      bar.innerHTML = Array.from({ length: n }, (_, i) => `<i style="left:${(i / (n - 1)) * 100}%"></i>`).join('') + '<b id="slide-pos"></b>';
    }
    [...bar.querySelectorAll('i')].forEach((el, i) => el.classList.toggle('on', i === s.slideIndex));
    $('slide-pos').style.left = `${(player.slide.pos / (n - 1)) * 100}%`;
  }
  $('bow-dir').textContent = s.dir < 0 ? '⟵' : s.dir > 0 ? '⟶' : '·';
  $('vib-tag').classList.toggle('on', (s.vibDepth || 0) > 0.25 && s.amp > 0.02);
  $('bow-level').style.width = `${Math.round(Math.min(1, s.amp) * 100)}%`;
  if (calib) renderCalib();

  // What the camera can see right now.
  $('seen').hidden = !cameraOn;
  if (cameraOn) {
    const f = s.features, fresh = lastFrame && now - lastFrameAt < 500;
    $('seen-body').classList.toggle('ok', !!(fresh && f && f.ok));
    $('seen-left').classList.toggle('ok', !!(fresh && f && f.leftHand));
    $('seen-right').classList.toggle('ok', !!(fresh && f && f.ok && f.bowVis > 0.5));
  }
  // Friendly hints when tracking is lost.
  if (cameraOn && !calib) {
    const f = s.features;
    if (!lastFrame || now - lastFrameAt > 1500) setHintOnce('Waiting for the camera…');
    else if (!f || !f.ok) setHintOnce('Step back so your head, shoulders and both arms are in the picture.');
    else if (f.S > 0.55) setHintOnce('A bit closer than ideal: step back so both elbows fit in the picture.');
    else if (f.S < 0.13) setHintOnce('You look far away: come a little closer so your hands are easier to see.');
    else if (player.settings.mode === 'fingers' && !f.extension) setHintOnce('Hold your left hand up by your left shoulder, palm facing the camera.');
    else setHintOnce('');
  }
  const dbg = $('debug-panel');
  dbg.hidden = !player.settings.debug;
  if (player.settings.debug) dbg.textContent = debugText(s);
}
let lastAutoHint = null;
function setHintOnce(t) { if (t !== lastAutoHint) { lastAutoHint = t; setHint(t); } }

function debugText(s) {
  const f = s.features || {};
  const fx = (v, d = 2) => (v == null || !isFinite(v) ? '–' : (+v).toFixed(d));
  const tr = tracker.stats;
  return [
    `fps  draw ${fx(fps, 0)}  track ${fx(tr.fps, 0)}  (${tracker.delegate || (DEMO ? 'demo' : '-')})`,
    `delay  tracking ${fx(tr.trackMs, 0)} ms  camera ${fx(tr.cameraMs, 0)} ms  audio out ${fx(latency.audioOut, 0)} ms`,
    `       camera-to-sound ≈ ${fx(latency.frameToSound, 0)} ms`,
    `body ${f.ok ? 'yes' : 'no'}  shoulder width ${fx(f.S, 3)}`,
    `elbow height ${fx(f.elbowRel)}  smooth ${fx(f.elbowSmooth)}  zone ${fx(player.strings.pos)} -> ${s.string}`,
    `  cal G ${fx(player.cal.elbowG)}  E ${fx(player.cal.elbowE)}  stickiness ${fx(player.tuning.stringStickiness)}`,
    `fingers ${f.extension ? f.extension.map(v => fx(v)).join(' ') : 'no left hand'}`,
    `  raw count ${player.fingers.raw}  steady count ${player.fingers.count}`,
    `slide dist ${fx(f.slideSmooth ?? f.slideDist)}  pos ${fx(player.slide.pos, 1)}  (near ${fx(player.cal.slideNear)} far ${fx(player.cal.slideFar)})`,
    `bow speed ${fx(s.speed)}  amp ${fx(s.amp)}  dir ${s.dir}  strokes ${s.strokes}`,
    `vibrato ${fx(s.vibDepth)} @ ${fx(s.vibRate, 1)} Hz`,
    `note ${s.note.name}${s.note.octave} (midi ${s.note.midi})  mode ${player.settings.mode}  source ${s.source}`,
    `sound attacks ${audio.stats.attacks} slurs ${audio.stats.slurs}`,
  ].join('\n');
}

// ---------- Start ----------
async function startCamera() {
  $('start-msg').textContent = '';
  // Sound starts inside the click (browsers require that) and loads alongside the tracking files.
  const audioReady = audio.init().catch(e => console.warn('audio', e));
  setStatus('Loading body and hand tracking…');
  $('btn-start').disabled = true;
  try {
    await tracker.startCamera(video);
    resize();
    await tracker.loadModels(player.settings.model, 'GPU', f => setStatus(`Loading body and hand tracking… ${Math.round(f * 100)}%`));
    setStatus('Starting tracking…');
    await audioReady;
    tracker.start();
    cameraOn = true;
    $('start').hidden = true;
    setStatus(`Tracking on this device${tracker.delegate === 'CPU' ? ' (CPU)' : ''}`);
    if (!player.cal.done) startCalibration();
    if (window.matchMedia('(pointer: coarse)').matches) setHint('Prop your phone up sideways, about 1.5 m away, so your upper body fits in the picture.', 8000);
  } catch (e) {
    console.warn('camera', e);
    $('btn-start').disabled = false;
    setStatus('');
    $('start-msg').textContent = (e && e.name === 'NotAllowedError')
      ? 'Camera permission was refused. Allow the camera and try again, or play with the keyboard.'
      : 'Could not start the camera. You can still play with the keyboard.';
  }
}
async function startKeyboard() {
  keyboardMode = true;
  $('start').hidden = true;
  setStatus('No camera: keys G D A E + 0-4 + Space, or press the piano keys');
  setHint(window.matchMedia('(pointer: coarse)').matches ? 'Press and hold the piano keys to play. Help shows all the notes.' : 'Keyboard: G/D/A/E pick a string, 0–4 fingers, hold Space to bow. Or press the piano keys. H for help.', 7000);
  try { await audio.init(); } catch (e) { console.warn('audio', e); }
}

// Keep the screen awake while playing (phones), and bring the sound back after switching tabs.
let wakeLock = null;
async function keepAwake() {
  try { if (navigator.wakeLock && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not allowed: fine */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (audio.ctx && audio.ctx.state !== 'running') audio.ctx.resume().catch(() => {});
    if (cameraOn || keyboardMode) keepAwake();
  }
});

$('btn-start').addEventListener('click', () => { keepAwake(); startCamera(); });
$('btn-keys').addEventListener('click', () => { keepAwake(); startKeyboard(); });
$('btn-help').addEventListener('click', () => openOverlay('help'));
$('btn-settings').addEventListener('click', () => openOverlay('settings'));
$('btn-calibrate').addEventListener('click', startCalibration);
$('help-close').addEventListener('click', closeOverlays);
for (const id of ['settings', 'help']) $(id).addEventListener('click', e => { if (e.target.id === id) closeOverlays(); });

buildPiano();
initSettings();
buildHelp();
resize();
if (DEMO) { $('start').hidden = true; setStatus('Demo: a pretend player (no camera)'); }
requestAnimationFrame(render);

// 3D violin and bow are optional extras: the game still works if WebGL is unavailable.
import('./violin3d.js').then(m => {
  try { violin = new m.Violin3D($('three')); resize(); } catch (e) { console.warn('3D view unavailable', e); }
}).catch(e => console.warn('3D view unavailable', e));

// Test/debug hook (only with ?test or ?debug=1): lets automated tests feed synthetic frames.
if (TEST || params.get('debug') === '1') {
  window.airViolin = {
    player, audio, tracker, inject: onFrame, makeFrame,
    startCalibration, get calib() { return calib; }, get tips() { return tips; },
    initAudio: () => audio.init(), startKeyboard, saveStore, loadStore,
    get latency() { return latency; },
  };
}
