// Unit tests for the playing logic, using synthetic movement data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { noteTable, noteFor, slideNotes, KEY_ORDER } from '../src/music.js';
import { makeFrame, makeSequence, rng, handWorld } from '../src/synthetic.js';
import { extractFeatures, fingerExtension, buildCalibration, DEFAULT_CALIBRATION } from '../src/tracking-logic.js';
import { Player } from '../src/engine.js';

const names = arr => arr.map(n => n.name).join(' ');

test('D major first-position table matches the brief', () => {
  const t = noteTable('D');
  assert.equal(names(t.G), 'G A B C♯ D');
  assert.equal(names(t.D), 'D E F♯ G A');
  assert.equal(names(t.A), 'A B C♯ D E');
  assert.equal(names(t.E), 'E F♯ G A B');
  assert.equal(t.G[0].midi, 55);
  assert.equal(t.E[4].midi, 83);
});

test('every key has 20 slots and Slide mode has 17 distinct rising notes', () => {
  for (const k of KEY_ORDER) {
    const t = noteTable(k);
    assert.equal(Object.values(t).flat().length, 20);
    const s = slideNotes(k);
    assert.equal(s.length, 17, k);
    for (let i = 1; i < s.length; i++) assert.ok(s[i].midi > s[i - 1].midi, k);
  }
  assert.equal(names(noteTable('Bb').D), 'D E♭ F G A');
  assert.equal(names(noteTable('C').A), 'A B C D E');
});

test('synthetic hand: extension drops as fingers fold', () => {
  for (let c = 0; c <= 4; c++) {
    const f = extractFeatures(makeFrame({ folds: c }));
    const folded = f.extension.filter(s => s < 0.5).length;
    assert.equal(folded, c, `count ${c}: ${f.extension.map(v => v.toFixed(2))}`);
  }
});

test('features are measured in shoulder widths (same at any distance)', () => {
  const near = extractFeatures(makeFrame({ S: 0.45, elbowRel: -0.3 }));
  const far = extractFeatures(makeFrame({ S: 0.18, elbowRel: -0.3 }));
  assert.ok(Math.abs(near.elbowRel + 0.3) < 1e-6);
  assert.ok(Math.abs(far.elbowRel + 0.3) < 1e-6);
});

function playSegments(segs, opts = {}, settings = {}) {
  const p = new Player(settings);
  const frames = makeSequence(segs, opts);
  return frames.map(fr => ({ fr, s: p.update(fr) }));
}

test('elbow height picks the string, G highest, E lowest', () => {
  const cal = DEFAULT_CALIBRATION;
  const step = (cal.elbowE - cal.elbowG) / 3;
  for (let i = 0; i < 4; i++) {
    const out = playSegments([{ ms: 500, elbowRel: cal.elbowG + i * step, bow: 'down' }]);
    assert.equal(out.at(-1).s.string, 'GDAE'[i]);
  }
});

test('string choice is sticky at the zone edges (no flicker)', () => {
  const cal = DEFAULT_CALIBRATION;
  const step = (cal.elbowE - cal.elbowG) / 3;
  const edge = cal.elbowG + 1.5 * step; // exactly between D and A
  const out = playSegments([
    { ms: 400, elbowRel: cal.elbowG + step },          // D
    { ms: 2000, elbowRel: edge, noise: 0.03 },         // hover on the edge with jitter
  ], { seed: 3 });
  const strings = new Set(out.slice(15).map(o => o.s.string));
  assert.equal(strings.size, 1, `flickered: ${[...strings]}`);
});

test('finger count 0-4 gives the right note on each string', () => {
  const cal = DEFAULT_CALIBRATION;
  const step = (cal.elbowE - cal.elbowG) / 3;
  const table = noteTable('D');
  for (let si = 0; si < 4; si++) {
    for (let c = 0; c <= 4; c++) {
      const out = playSegments([{ ms: 300, elbowRel: cal.elbowG + si * step, folds: c, bow: 'down' }]);
      const s = out.at(-1).s;
      assert.equal(s.finger, c);
      assert.equal(s.note.midi, table['GDAE'[si]][c].midi);
    }
  }
});

test('finger count waits for a steady run before changing', () => {
  const p = new Player({}, {}, { stableFrames: 2 });
  const f0 = makeFrame({ folds: 0, t: 0 });
  p.update(f0); p.update({ ...f0, t: 33 });
  const one = makeFrame({ folds: 1, t: 66 });
  assert.equal(p.update(one).finger, 0, 'single frame should not change the note');
  assert.equal(p.update({ ...one, t: 99 }).finger, 1, 'two steady frames change it');
});

test('bowing: speed sets loudness smoothly, direction change = new stroke, stop fades', () => {
  const out = playSegments([
    { ms: 300, bow: 'still' },
    { ms: 800, bow: 'down', bowSpeed: 0.6 },
    { ms: 800, bow: 'up', bowSpeed: 1.8 },
    { ms: 800, bow: 'still' },
  ]);
  const strokes = out.filter(o => o.s.newStroke).length;
  assert.equal(strokes, 2, 'one stroke per direction');
  const ampAt = ms => out.find(o => o.fr.t >= ms).s.amp;
  assert.equal(ampAt(200), 0);
  assert.ok(ampAt(900) > 0.1 && ampAt(900) < ampAt(1800), `slow ${ampAt(900)} < fast ${ampAt(1800)}`);
  assert.equal(out.at(-1).s.amp, 0, 'stopped bow is silent');
  assert.equal(out.at(-1).s.dir, 0);
  // Loudness is continuous, not stepped: many distinct values while speeding up.
  const vals = new Set(out.slice(10, 40).map(o => o.s.amp.toFixed(3)));
  assert.ok(vals.size > 10);
});

test('changing note mid-stroke does not start a new stroke (slur)', () => {
  const out = playSegments([
    { ms: 600, bow: 'down', folds: 0 },
    { ms: 600, bow: 'down', folds: 2 },
  ]);
  assert.equal(out.filter(o => o.s.newStroke).length, 1);
  assert.equal(out.at(-1).s.finger, 2);
});

test('vibrato: small quick wobble adds vibrato, still hand does not', () => {
  const still = playSegments([{ ms: 1500, bow: 'down', wobble: 0 }]);
  const wob = playSegments([{ ms: 1500, bow: 'down', wobble: 0.04, wobbleHz: 6 }]);
  assert.ok(still.at(-1).s.vibDepth < 0.15, `still ${still.at(-1).s.vibDepth}`);
  assert.ok(wob.at(-1).s.vibDepth > 0.5, `wobble ${wob.at(-1).s.vibDepth}`);
  const off = playSegments([{ ms: 1500, bow: 'down', wobble: 0.04 }], {}, { vibrato: false });
  assert.equal(off.at(-1).s.vibDepth, 0);
});

test('slide mode: further from the shoulder = higher note', () => {
  const cal = DEFAULT_CALIBRATION;
  const notes = slideNotes('D');
  const at = d => playSegments([{ ms: 300, slideDist: d }], {}, { mode: 'slide' }).at(-1).s;
  assert.equal(at(cal.slideNear).note.midi, notes[0].midi);
  assert.equal(at(cal.slideFar).note.midi, notes.at(-1).midi);
  const mid = at((cal.slideNear + cal.slideFar) / 2);
  assert.equal(mid.note.midi, notes[8].midi);
});

test('calibration learns the elbow range and bow speed', () => {
  const r = rng(2);
  const rec = { hold: { extension: [], slideDist: [] }, g: { elbow: [], speed: [] }, e: { elbow: [], speed: [] } };
  for (let i = 0; i < 20; i++) {
    const f = extractFeatures(makeFrame({ slideDist: 0.5, noise: 0.003 }, r));
    rec.hold.extension.push(f.extension); rec.hold.slideDist.push(f.slideDist);
    rec.g.elbow.push(0.2 + (r() - 0.5) * 0.05); rec.g.speed.push(1 + r());
    rec.e.elbow.push(-0.9 + (r() - 0.5) * 0.05); rec.e.speed.push(1 + r());
  }
  const cal = buildCalibration(rec);
  assert.ok(Math.abs(cal.elbowG - 0.2) < 0.05);
  assert.ok(Math.abs(cal.elbowE + 0.9) < 0.05);
  assert.ok(cal.bowFull > 1.2 && cal.bowFull < 2.1);
  assert.ok(Math.abs(cal.slideNear - 0.5) < 0.05);
  assert.equal(cal.done, true);
});

test('fingerExtension of a straight line is 1', () => {
  const pts = Array.from({ length: 21 }, (_, i) => ({ x: 0, y: -i * 0.01, z: 0 }));
  fingerExtension(pts).forEach(v => assert.ok(Math.abs(v - 1) < 1e-9));
  assert.equal(noteFor('D', 'A', 2).name, 'C♯');
});

test('delay from bow movement to sound, and no false strokes from tracking jitter', () => {
  const p = new Player(); const r = rng(3); let x = 0, hit = null;
  for (let i = 0; i < 60; i++) {
    const t = i * 1000 / 30;
    const v = t >= 500 ? -1.2 * Math.min(1, (t - 500) / 150) : 0; // bow starts, reaching 1.2 shoulder widths/s
    x += v / 30;
    const s = p.update(makeFrame({ t, bowX: x, noise: 0.005 }, r));
    if (hit == null && s.amp > 0) hit = t - 500;
  }
  console.log(`# movement-to-sound decision delay: ${hit.toFixed(0)} ms (plus camera, tracking and audio output)`);
  assert.ok(hit <= 150, `${hit} ms`);
  const still = new Player(); const r2 = rng(9); let strokes = 0;
  for (let i = 0; i < 600; i++) if (still.update(makeFrame({ t: i * 33.3, bowX: -0.5, noise: 0.015 }, r2)).newStroke) strokes++;
  assert.equal(strokes, 0);
});

test('finger folding is caught whether curled or bent at the knuckle; a relaxed hand counts as open', () => {
  const tun = { foldRatio: 0.5 };
  const ext = folds => fingerExtension(handWorld(folds));
  const knuckle = fingerExtension(handWorld([1, 1, 0, 0], { knuckleOnly: true }));
  assert.ok(knuckle[0] < tun.foldRatio && knuckle[1] < tun.foldRatio, `knuckle bend ${knuckle}`);
  assert.ok(knuckle[2] > 0.9 && knuckle[3] > 0.9);
  const relaxed = ext([0.2, 0.2, 0.2, 0.2]);
  assert.ok(relaxed.every(v => v > 0.62), `relaxed ${relaxed}`);
  const firm = ext([0.6, 0.6, 0.6, 0.6]);
  assert.ok(firm.every(v => v < 0.5 * 0.84), `firm fold ${firm}`);
});
