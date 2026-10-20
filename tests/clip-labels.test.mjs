// The clip tester's label parsing and scoring, checked with made-up results (no real clips).
import test from 'node:test';
import assert from 'node:assert/strict';
import { labelsFromName, scoreClip } from '../scripts/clip-test.mjs';

test('labels come from file names', () => {
  assert.deepEqual(labelsFromName('string-G.mp4'), { kind: 'steady', string: 'G' });
  assert.deepEqual(labelsFromName('fingers-3.webm'), { kind: 'steady', finger: 3 });
  assert.deepEqual(labelsFromName('String-A-Fingers-2.MOV'), { kind: 'steady', string: 'A', finger: 2 });
  assert.equal(labelsFromName('still.mp4').kind, 'still');
  assert.equal(labelsFromName('changes.mp4').kind, 'changes');
  assert.equal(labelsFromName('slide.mp4').kind, 'slide');
  assert.equal(labelsFromName('calibrate.mp4').kind, 'calibrate');
});

test('scoring counts steady frames after the first second', () => {
  const frames = Array.from({ length: 60 }, (_, i) => ({ t: i * 100, body: true, hand: true,
    string: i < 40 ? 'G' : 'D', finger: 3, rawFinger: i % 10 ? 3 : 2, amp: 0, stroke: false }));
  const r = scoreClip({ kind: 'steady', string: 'G', finger: 3 }, null, { frames });
  assert.equal(r.stringValue, 30 / 50);
  assert.equal(r.fingerValue, 1);
  assert.equal(r.fingerRawAccuracy, '90.0%');
  assert.equal(r.stringChanges, 1);
});

test('evaluate + sweep on synthetic "clips" (computer-made frames, no video)', async () => {
  const { evaluate, sweepGrid } = await import('../scripts/clip-test.mjs');
  const { makeSequence } = await import('../src/synthetic.js');
  const { DEFAULT_CALIBRATION: cal, DEFAULT_TUNING } = await import('../src/tracking-logic.js');
  const step = (cal.elbowE - cal.elbowG) / 3;
  const clip = (name, segs, seed) => ({ name, lab: labelsFromName(name), ranges: null, frames: makeSequence(segs, { seed, noise: 0.006 }) });
  const clips = [
    clip('string-A.mp4', [{ ms: 4000, elbowRel: cal.elbowG + 2 * step, bow: 'saw', strokeMs: 900 }], 1),
    clip('fingers-3.mp4', [{ ms: 4000, folds: 3, bow: 'saw', strokeMs: 900 }], 2),
    clip('still.mp4', [{ ms: 4000, bow: 'still' }], 3),
  ];
  const e = evaluate(clips, DEFAULT_TUNING, {}, {});
  assert.equal(e.sAcc, 1);
  assert.equal(e.fAcc, 1);
  assert.equal(e.stillStrokes, 0);
  const grid = [...sweepGrid()];
  assert.equal(grid.length, 216);
  assert.ok(grid.every(t => t.unfoldRatio > t.foldRatio));
});
