// Calibration steps: hold still, then bow on the highest string (G) and the lowest string (E).
// Pure logic: feed it features each frame; the UI just shows step/progress/message.

import { buildCalibration } from './tracking-logic.js';

export const STEPS = [
  { id: 'hold', title: 'Hold the pose',
    text: 'Left hand up by your left shoulder, palm facing the camera, fingers up. Right hand ready to bow. Keep still.' },
  { id: 'g', title: 'Highest string (G)',
    text: 'Lift your right elbow up high, as high as feels comfortable, and bow side to side.' },
  { id: 'e', title: 'Lowest string (E)',
    text: 'Now drop your right elbow down low, close to your side, and keep bowing side to side.' },
];
export const FAR_STEP = { id: 'far', title: 'Slide reach',
  text: 'Slide mode: move your left hand out along the neck, as far as is comfortable, and hold it there.' };
const NEED_MS = 3000;

export class Calibrator {
  constructor(prev, { slide = false } = {}) {
    this.prev = prev;
    this.steps = slide ? [...STEPS, FAR_STEP] : STEPS;
    this.step = 0;
    this.good = 0; this.lastT = null;
    this.rec = { hold: { extension: [], slideDist: [] }, g: { elbow: [], speed: [] }, e: { elbow: [], speed: [] }, far: { slideDist: [] } };
    this.message = ''; this.done = false; this.result = null;
  }
  get current() { return this.steps[this.step]; }
  get progress() { return Math.min(1, this.good / NEED_MS); }

  /** f: features from extractFeatures (with elbowSmooth), bowSpeed: from the bow tracker. */
  update(f, bowSpeed, t) {
    if (this.done) return;
    const dt = this.lastT == null ? 0 : Math.min(100, t - this.lastT);
    this.lastT = t;
    const id = this.current.id;
    if (!f || !f.ok) { this.message = 'Step back so your head, shoulders and both arms are in the picture.'; return; }
    if (id === 'hold') {
      if (!f.extension) { this.message = 'I can\'t see your left hand yet. Hold it up by your left shoulder, palm to the camera.'; return; }
      if (f.extension.some(s => s < 0.65)) { this.message = 'Open your left hand: all fingers straight up.'; return; }
      this.message = 'Great, hold still…';
      this.good += dt;
      this.rec.hold.extension.push(f.extension);
      this.rec.hold.slideDist.push(f.slideDist);
    } else if (id === 'far') {
      const near = this.rec.hold.slideDist.length ? this.rec.hold.slideDist[Math.floor(this.rec.hold.slideDist.length / 2)] : 0.55;
      if (f.slideDist < near + 0.4) { this.message = 'Further: stretch your left hand out along the neck.'; return; }
      this.message = 'Good, hold it there…';
      this.good += dt;
      this.rec.far.slideDist.push(f.slideDist);
    } else {
      const r = this.rec[id];
      if (bowSpeed < 0.2) { this.message = 'Keep bowing side to side with your right hand.'; return; }
      this.message = id === 'g' ? 'Good! Elbow up high, keep bowing…' : 'Good! Elbow down low, keep bowing…';
      this.good += dt;
      r.elbow.push(f.elbowSmooth ?? f.elbowRel);
      r.speed.push(bowSpeed);
    }
    if (this.good >= NEED_MS) this.next();
  }

  next() {
    this.good = 0;
    if (this.step < this.steps.length - 1) { this.step++; return; }
    this.result = buildCalibration(this.rec, this.prev);
    this.done = true;
  }
}
