// Browser tests: headless Chromium with a fake camera (Chromium's built-in test pattern) and synthetic movement data.
// Screenshots go to screenshots/ (git-ignored). No real video is ever used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const SHOTS = new URL('../screenshots/', import.meta.url);
fs.mkdirSync(SHOTS, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH || undefined;

let server, base, browser;
test.before(async () => {
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({
    executablePath,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required',
      '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  });
});
test.after(async () => { await browser?.close(); server?.close(); });
// Close every page a test opened, even if it failed, so one failure can't slow down the next tests.
const contexts = new Set();
test.afterEach(async () => { for (const c of contexts) await c.close().catch(() => {}); contexts.clear(); });

async function open(query = '', { viewport = { width: 1280, height: 720 }, storage = null, touch = false } = {}) {
  const context = await browser.newContext({ viewport, permissions: ['camera'], hasTouch: touch, isMobile: touch });
  contexts.add(context);
  if (storage) await context.addInitScript(s => { try { localStorage.setItem('airViolin.v1', s); } catch { /* */ } }, storage);
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => requests.push(r.url()));
  await page.goto(base + 'index.html' + query);
  return { page, errors, requests, context };
}

/** Feed a scripted synthetic performance into the page, frame by frame. */
async function play(page, segments, opts = {}) {
  return page.evaluate(async ({ segments, opts }) => {
    const { makeSequence } = await import('./src/synthetic.js');
    const t0 = performance.now();
    const frames = makeSequence(segments, { ...opts, start: t0 });
    const log = [];
    for (const f of frames) {
      window.airViolin.inject(f);
      const s = window.airViolin.player.state;
      log.push({ t: f.t - t0, label: f.label, string: s.string, finger: s.finger, midi: s.note.midi, name: s.note.name,
        amp: s.amp, newStroke: s.newStroke, vib: s.vibDepth });
      await new Promise(r => setTimeout(r, 1000 / 30));
    }
    return log;
  }, { segments, opts });
}

test('page loads with no console errors and no outside requests', async () => {
  const { page, errors, requests, context } = await open();
  await page.waitForTimeout(800);
  assert.equal(await page.title(), 'Air Violin');
  assert.ok(await page.isVisible('#start'));
  assert.ok(await page.isVisible('#piano'));
  await page.screenshot({ path: new URL('start.png', SHOTS).pathname });
  const outside = requests.filter(u => !u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:'));
  assert.deepEqual(outside, []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('keyboard play: strings, fingers, bowing and sound engine', async () => {
  const { page, errors, context } = await open('?test=1');
  await page.click('#btn-keys');
  await page.waitForFunction(() => window.airViolin.audio.loaded, null, { timeout: 15000 });
  await page.keyboard.press('a');
  await page.keyboard.press('2');
  await page.keyboard.down(' ');
  await page.waitForTimeout(400);
  let st = await page.evaluate(() => ({ ...window.airViolin.player.state, features: null }));
  assert.equal(st.string, 'A');
  assert.equal(st.note.name, 'C♯');
  assert.ok(st.amp > 0.3);
  assert.equal(await page.textContent('#note-letter'), 'C♯');
  assert.equal(await page.getAttribute('.pkey.on', 'data-midi'), '73');
  await page.screenshot({ path: new URL('keyboard.png', SHOTS).pathname });
  await page.keyboard.press('3'); // slur
  await page.waitForTimeout(200);
  await page.keyboard.up(' ');
  await page.waitForTimeout(500);
  const stats = await page.evaluate(() => window.airViolin.audio.stats);
  assert.equal(stats.attacks, 1);
  assert.equal(stats.slurs, 1);
  st = await page.evaluate(() => window.airViolin.player.state.amp);
  assert.equal(st, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('synthetic movement: right string, finger, note and sound behaviour', async () => {
  const { page, errors, context } = await open('?test=1');
  await page.click('#btn-keys');
  await page.waitForFunction(() => window.airViolin.audio.loaded, null, { timeout: 15000 });
  const cal = await page.evaluate(() => window.airViolin.player.cal);
  const step = (cal.elbowE - cal.elbowG) / 3;
  const log = await play(page, [
    { ms: 500, label: 'G0', elbowRel: cal.elbowG, folds: 0, bow: 'down' },
    { ms: 500, label: 'G2', elbowRel: cal.elbowG, folds: 2, bow: 'down' },
    { ms: 500, label: 'A1', elbowRel: cal.elbowG + 2 * step, folds: 1, bow: 'up' },
    { ms: 500, label: 'E4', elbowRel: cal.elbowE, folds: 4, bow: 'down', bowSpeed: 2 },
    { ms: 600, label: 'stop', elbowRel: cal.elbowE, folds: 4, bow: 'still' },
  ]);
  const last = l => log.filter(x => x.label === l).at(-1);
  assert.equal(last('G0').name, 'G'); assert.equal(last('G0').midi, 55);
  assert.equal(last('G2').name, 'B');
  assert.equal(last('A1').string, 'A'); assert.equal(last('A1').name, 'B'); assert.equal(last('A1').midi, 71);
  assert.equal(last('E4').midi, 83);
  assert.equal(last('stop').amp, 0);
  const stats = await page.evaluate(() => window.airViolin.audio.stats);
  assert.ok(stats.attacks >= 3 && stats.attacks <= 4, `attacks ${stats.attacks}`); // down, up, down (+ maybe one at start)
  assert.ok(stats.slurs >= 1, 'G0 -> G2 is slurred');
  assert.deepEqual(errors, []);
  await context.close();
});

test('settings change and are remembered; help shows the note table', async () => {
  const { page, errors, context } = await open('?test=1');
  await page.click('#btn-keys');
  await page.click('#btn-settings');
  await page.selectOption('#set-key', 'C');
  await page.selectOption('#set-mode', 'slide');
  await page.screenshot({ path: new URL('settings.png', SHOTS).pathname });
  await page.click('#set-close');
  await page.click('#btn-help');
  const table = await page.textContent('#note-table');
  assert.ok(table.includes('F5'), 'C major E string has F natural');
  assert.ok(!table.includes('♯'));
  await page.screenshot({ path: new URL('help.png', SHOTS).pathname });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('airViolin.v1')));
  assert.equal(saved.settings.key, 'C');
  assert.equal(saved.settings.mode, 'slide');
  await page.reload();
  assert.equal(await page.inputValue('#set-key'), 'C');
  assert.deepEqual(errors, []);
  await context.close();
});

test('calibration learns the player\'s elbow range from synthetic movement', async () => {
  const { page, errors, context } = await open('?test=1');
  await page.click('#btn-keys');
  await page.evaluate(() => window.airViolin.startCalibration());
  assert.ok(await page.isVisible('#calib-card'));
  await play(page, [{ ms: 3600, elbowRel: -0.4, folds: 0, bow: 'still' }]);
  assert.equal(await page.evaluate(() => window.airViolin.calib.step), 1);
  await play(page, [{ ms: 3800, elbowRel: 0.25, bow: 'saw', bowSpeed: 1.5, strokeMs: 700 }]);
  assert.equal(await page.evaluate(() => window.airViolin.calib.step), 2);
  await page.screenshot({ path: new URL('calibration.png', SHOTS).pathname });
  await play(page, [{ ms: 3800, elbowRel: -1.0, bow: 'saw', bowSpeed: 1.5, strokeMs: 700 }]);
  const cal = await page.evaluate(() => window.airViolin.player.cal);
  assert.ok(Math.abs(cal.elbowG - 0.25) < 0.1, `G ${cal.elbowG}`);
  assert.ok(Math.abs(cal.elbowE + 1.0) < 0.1, `E ${cal.elbowE}`);
  assert.equal(cal.done, true);
  assert.ok(await page.isHidden('#calib-card'));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('airViolin.v1')));
  assert.equal(saved.calibration.done, true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('fake camera: tracking models load and run on the device', async () => {
  const { page, errors, requests, context } = await open('?test=1&debug=1');
  await page.click('#btn-start');
  await page.waitForFunction(() => window.airViolin.tracker.stats.frames > 5, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const stats = await page.evaluate(() => ({ ...window.airViolin.tracker.stats, delegate: window.airViolin.tracker.delegate }));
  console.log('# tracking on fake camera:', JSON.stringify(stats));
  await page.screenshot({ path: new URL('camera-debug.png', SHOTS).pathname });
  assert.ok(await page.isVisible('#seen'));
  assert.ok(!(await page.getAttribute('#seen-body', 'class') || '').includes('ok'), 'no person in the fake camera picture');
  const outside = requests.filter(u => !u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:'));
  assert.deepEqual(outside, []);
  assert.deepEqual(errors.filter(e => !/WebGL|GPU|gl_|GL_/.test(e)), []);
  await context.close();
});

test('phone landscape layout and demo mode render', async () => {
  const { page, errors, context } = await open('?demo=1', { viewport: { width: 844, height: 390 }, touch: true });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: new URL('phone-demo.png', SHOTS).pathname });
  const fs = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.note-name')).fontSize));
  assert.ok(fs >= 48, `note text ${fs}px`);
  assert.deepEqual(errors, []);
  await context.close();
  const p2 = await open('', { viewport: { width: 390, height: 844 }, touch: true });
  await p2.page.waitForTimeout(300);
  assert.ok(await p2.page.isVisible('#rotate'));
  assert.ok(await p2.page.isVisible('.phone-hint'));
  await p2.context.close();
});

test('slide mode: calibration learns the reach, hand distance picks the note', async () => {
  const { page, errors, context } = await open('?test=1&mode=slide');
  await page.click('#btn-keys');
  await page.waitForFunction(() => window.airViolin.audio.loaded, null, { timeout: 15000 });
  await page.evaluate(() => window.airViolin.startCalibration());
  await play(page, [{ ms: 3600, slideDist: 0.5, bow: 'still' }]);
  await play(page, [{ ms: 3800, elbowRel: 0.2, slideDist: 0.5, bow: 'saw', bowSpeed: 1.5, strokeMs: 700 }]);
  await play(page, [{ ms: 3800, elbowRel: -1.0, slideDist: 0.5, bow: 'saw', bowSpeed: 1.5, strokeMs: 700 }]);
  assert.equal(await page.textContent('#calib-step'), 'Step 4 of 4');
  await play(page, [{ ms: 3800, slideDist: 1.6, bow: 'still' }]);
  const cal = await page.evaluate(() => window.airViolin.player.cal);
  assert.ok(Math.abs(cal.slideNear - 0.5) < 0.1, `near ${cal.slideNear}`);
  assert.ok(Math.abs(cal.slideFar - 1.52) < 0.1, `far ${cal.slideFar}`);
  const log = await play(page, [
    { ms: 600, label: 'near', slideDist: cal.slideNear, bow: 'down' },
    { ms: 800, label: 'far', slideDist: cal.slideFar, bow: 'down' },
  ]);
  assert.equal(log.filter(x => x.label === 'near').at(-1).midi, 55);
  assert.equal(log.filter(x => x.label === 'far').at(-1).midi, 83);
  const st = await page.evaluate(() => window.airViolin.audio.stats);
  assert.ok(st.glides >= 1, `slide mode glides between notes: ${JSON.stringify(st)} ${JSON.stringify(log.filter(x => x.label === 'far').slice(0, 3))}`);
  assert.ok(await page.isVisible('#slide-bar'));
  await page.screenshot({ path: new URL('slide.png', SHOTS).pathname });
  assert.deepEqual(errors, []);
  await context.close();
});

test('sound output: quick attack, steady held note, natural fade when the bow stops', async () => {
  const { page, errors, context } = await open('?test=1');
  await page.click('#btn-keys');
  await page.waitForFunction(() => window.airViolin.audio.loaded, null, { timeout: 15000 });
  const levels = await page.evaluate(async () => {
    const a = window.airViolin.audio, kb = window.airViolin.player.keyboard;
    const out = [];
    const sample = async (ms, tag) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { out.push({ t: performance.now(), tag, v: a.meter(), started: a.stats.attacks > 0 }); await new Promise(r => setTimeout(r, 10)); } };
    kb.active = true; kb.string = 1; kb.finger = 2; kb.bowDir = -1; kb.strokeId++;
    const t0 = performance.now();
    await sample(3000, 'hold');
    kb.bowDir = 0;
    await sample(900, 'release');
    return out.map(o => ({ ...o, t: o.t - t0 }));
  });
  const hold = levels.filter(l => l.tag === 'hold');
  const sustain = hold.filter(l => l.t > 500);
  const avg = sustain.reduce((s, l) => s + l.v, 0) / sustain.length;
  const start = hold.find(l => l.started).t;
  const half = { t: hold.find(l => l.v > 0.5 * avg).t - start };
  assert.ok(start < 400, `stroke registered ${start.toFixed(0)} ms after the key`);
  console.log(`# half volume ${half.t.toFixed(0)} ms after the stroke starts, held ${avg.toFixed(3)}, min/max held ${Math.min(...sustain.map(l => l.v)).toFixed(3)}/${Math.max(...sustain.map(l => l.v)).toFixed(3)}`);
  assert.ok(avg > 0.01, 'makes sound');
  assert.ok(half.t < 150, `attack reaches half volume within 150 ms (took ${half.t.toFixed(0)} ms)`);
  assert.ok(Math.min(...sustain.map(l => l.v)) > 0.35 * avg, 'held note does not drop out (loop is smooth)');
  const rel = levels.filter(l => l.tag === 'release');
  const after = rel.filter(l => l.t - rel[0].t > 700);
  assert.ok(after.every(l => l.v < 0.15 * avg), 'fades after the bow stops');
  const mid = rel.find(l => l.t - rel[0].t > 60);
  assert.ok(mid.v > 0.05 * avg, 'fade is gradual, not an abrupt cut');
  assert.deepEqual(errors, []);
  await context.close();
});

test('switching the tracking model while the camera runs keeps tracking going', async () => {
  const { page, errors, context } = await open('?test=1');
  await page.click('#btn-start');
  await page.waitForFunction(() => window.airViolin.tracker.stats.frames > 2, null, { timeout: 60000 });
  await page.click('#btn-settings');
  await page.selectOption('#set-model', 'full');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Tracking') || document.getElementById('status').textContent === '', null, { timeout: 60000 });
  const before = await page.evaluate(() => window.airViolin.tracker.stats.frames);
  await page.waitForFunction(n => window.airViolin.tracker.stats.frames > n + 2, before, { timeout: 60000 });
  assert.deepEqual(errors.filter(e => !/WebGL|GPU|gl_|GL_/.test(e)), []);
  await context.close();
});

test('press and hold a piano key (or a help-table note) to play it', async () => {
  const { page, errors, context } = await open('?test=1');
  await page.click('#btn-keys');
  await page.waitForFunction(() => window.airViolin.audio.loaded, null, { timeout: 15000 });
  const key = page.locator('.pkey[data-midi="66"]'); // F♯4: D string, 2 fingers in D major
  const box = await key.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
  await page.mouse.down();
  await page.waitForFunction(() => window.airViolin.player.state.amp > 0, null, { timeout: 3000 });
  const st = await page.evaluate(() => { const s = window.airViolin.player.state; return { midi: s.note.midi, string: s.string, finger: s.finger, amp: s.amp }; });
  assert.deepEqual({ ...st, amp: st.amp > 0 }, { midi: 66, string: 'D', finger: 2, amp: true });
  assert.equal(await page.textContent('#note-letter'), 'F♯');
  await page.mouse.up();
  await page.waitForFunction(() => window.airViolin.player.state.amp === 0, null, { timeout: 3000 });
  // A note outside the key still plays, and says so.
  const k2 = await page.locator('.pkey[data-midi="65"]').boundingBox(); // F natural
  await page.mouse.move(k2.x + k2.width / 2, k2.y + k2.height * 0.8);
  await page.mouse.down();
  await page.waitForFunction(() => document.getElementById('note-letter').textContent === 'F', null, { timeout: 3000 });
  assert.match(await page.textContent('#note-finger'), /Not in D major/);
  await page.mouse.up();
  // Notes in the help table play too.
  await page.click('#btn-help');
  const td = await page.locator('#note-table td[data-midi="71"][data-string="2"]').boundingBox(); // A string, 1 finger = B
  await page.mouse.move(td.x + td.width / 2, td.y + td.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => { const s = window.airViolin.player.state; return s.amp > 0 && s.note.midi === 71 && s.string === 'A'; }, null, { timeout: 3000 });
  await page.mouse.up();
  await page.waitForFunction(() => window.airViolin.player.state.amp === 0, null, { timeout: 3000 });
  assert.deepEqual(errors, []);
  await context.close();
});

test('every note comes out at the right pitch (measured from the audio output)', async () => {
  const { page, errors, context } = await open('?test=1');
  await page.click('#btn-keys');
  await page.waitForFunction(() => window.airViolin.audio.loaded, null, { timeout: 15000 });
  const results = await page.evaluate(async () => {
    const a = window.airViolin.audio, kb = window.airViolin.player.keyboard;
    a.analyser.fftSize = 4096;
    const buf = new Float32Array(4096);
    const sr = a.ctx.sampleRate;
    const pitch = (lo, hi) => {
      a.analyser.getFloatTimeDomainData(buf);
      let best = 0, bestLag = 0; const ac = [];
      for (let lag = Math.floor(sr / hi); lag <= Math.ceil(sr / lo); lag++) {
        let s = 0; for (let i = 0; i < buf.length - lag; i++) s += buf[i] * buf[i + lag];
        ac[lag] = s; if (s > best) { best = s; bestLag = lag; }
      }
      const y0 = ac[bestLag - 1] ?? best, y2 = ac[bestLag + 1] ?? best;
      return sr / (bestLag + 0.5 * (y0 - y2) / (y0 - 2 * best + y2 || 1));
    };
    const out = [];
    for (let si = 0; si < 4; si++) for (let f = 0; f <= 4; f++) {
      kb.active = true; kb.string = si; kb.finger = f; kb.bowDir = -1; kb.strokeId++;
      await new Promise(r => setTimeout(r, 700));
      const midi = window.airViolin.player.state.note.midi;
      const f0 = 440 * Math.pow(2, (midi - 69) / 12);
      const est = [];
      for (let k = 0; k < 6; k++) { est.push(pitch(f0 * 0.85, f0 * 1.18)); await new Promise(r => setTimeout(r, 60)); }
      const hz = est.reduce((x, y) => x + y, 0) / est.length;
      out.push({ midi, cents: 1200 * Math.log2(hz / f0) });
      kb.bowDir = 0;
      await new Promise(r => setTimeout(r, 150));
    }
    return out;
  });
  const worst = results.reduce((w, r) => Math.abs(r.cents) > Math.abs(w.cents) ? r : w);
  console.log(`# pitch error across all 20 notes: worst ${worst.cents.toFixed(1)} cents (midi ${worst.midi}), mean abs ${(results.reduce((s, r) => s + Math.abs(r.cents), 0) / 20).toFixed(1)} cents`);
  for (const r of results) assert.ok(Math.abs(r.cents) < 20, `midi ${r.midi} is ${r.cents.toFixed(1)} cents out`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('M mutes and unmutes; vibrato tag shows while wobbling', async () => {
  const { page, errors, context } = await open('?test=1');
  await page.click('#btn-keys');
  await page.waitForFunction(() => window.airViolin.audio.loaded, null, { timeout: 15000 });
  await page.keyboard.press('m');
  assert.equal(await page.evaluate(() => window.airViolin.player.settings.volume), 0);
  await page.keyboard.press('m');
  assert.ok(await page.evaluate(() => window.airViolin.player.settings.volume) > 0);
  await page.keyboard.down('v'); await page.keyboard.down(' ');
  await page.waitForFunction(() => document.getElementById('vib-tag').classList.contains('on'), null, { timeout: 3000 });
  await page.keyboard.up(' '); await page.keyboard.up('v');
  assert.deepEqual(errors, []);
  await context.close();
});
