// Turns body/hand landmarks into playing decisions: string, finger count, slide position, bowing, vibrato.
// Pure logic (no browser APIs) so it runs the same in the game, in Node unit tests and in the clip tester.

export const POSE = { NOSE: 0, L_SHOULDER: 11, R_SHOULDER: 12, L_ELBOW: 13, R_ELBOW: 14, L_WRIST: 15, R_WRIST: 16 };
const FINGERS = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]; // index..little

export const DEFAULT_CALIBRATION = {
  // Right elbow height above the right shoulder, in shoulder widths (negative = below).
  elbowG: -0.1,
  elbowE: -0.8,
  // Finger extension (see fingerExtension) of the open hand, per finger.
  openExtension: [0.97, 0.97, 0.97, 0.97],
  // Slide mode: left hand distance from left shoulder, in shoulder widths.
  slideNear: 0.55,
  slideFar: 1.75,
  // Bow speed (shoulder widths per second) that counts as "full" loudness.
  bowFull: 2.2,
  done: false,
};

export const DEFAULT_TUNING = {
  stringStickiness: 0.25, // fraction of a zone the elbow must pass a boundary by before the string changes
  foldRatio: 0.5,         // folded when extension < open * foldRatio
  unfoldRatio: 0.62,      // unfolded again when extension > open * unfoldRatio
  stableFrames: 2,        // finger count must repeat this many frames before the note changes
  slideStickiness: 0.3,   // fraction of a note step for Slide mode
  bowOn: 0.3,             // shoulder widths / s to start a stroke
  bowOff: 0.10,           // below this the bow counts as stopped
  bowStopMs: 140,         // how long below bowOff before the stroke ends
  bowCutoff: 1.0,         // bow position smoothing (one-euro filter): lower = steadier but slower
  bowBeta: 0.8,
  bowSource: 'pose',      // 'pose' = body tracker's wrist, 'hand' = hand tracker's palm centre when seen
};

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * How far each finger reaches out along the palm's direction, as a fraction of its length.
 * 1 = pointing straight on from the palm (open), ~0 = bent at the knuckle towards the camera, < 0 = curled in.
 * This catches both ways of folding a finger: curling it, or bending it down at the knuckle.
 */
export function fingerExtension(points) {
  const w = points[0], m9 = points[9];
  let ax = m9.x - w.x, ay = m9.y - w.y, az = (m9.z || 0) - (w.z || 0);
  const al = Math.hypot(ax, ay, az) || 1;
  ax /= al; ay /= al; az /= al;
  return FINGERS.map(([m, p, d, t]) => {
    const len = d3(points[m], points[p]) + d3(points[p], points[d]) + d3(points[d], points[t]);
    if (len < 1e-9) return 1;
    const dx = points[t].x - points[m].x, dy = points[t].y - points[m].y, dz = (points[t].z || 0) - (points[m].z || 0);
    return (dx * ax + dy * ay + dz * az) / len;
  });
}

/**
 * frame: { t (ms), aspect (width/height), pose: 33 landmarks {x,y,z,visibility} in 0..1 image coords (not mirrored)
 *          or null, hands: [{ landmarks: 21 pts, world: 21 pts or null }] }
 * Returns measurements in shoulder-width units. x grows to the image right, which is the player's LEFT.
 */
export function extractFeatures(frame) {
  const f = { ok: false, t: frame.t };
  const pose = frame.pose;
  if (!pose || pose.length < 17) return f;
  const a = frame.aspect || 4 / 3;
  const P = i => ({ x: pose[i].x * a, y: pose[i].y, z: pose[i].z || 0, v: pose[i].visibility ?? 1 });
  const ls = P(POSE.L_SHOULDER), rs = P(POSE.R_SHOULDER);
  const re = P(POSE.R_ELBOW), rw = P(POSE.R_WRIST), lw = P(POSE.L_WRIST), le = P(POSE.L_ELBOW);
  const S = d2(ls, rs);
  if (S < 0.02) return f;
  f.ok = true;
  f.S = S;
  f.points = { ls, rs, re, rw, lw, le, nose: P(POSE.NOSE) };
  f.elbowRel = (rs.y - re.y) / S;
  f.elbowVis = Math.min(re.v, rs.v);
  f.bowX = rw.x / S;
  f.bowY = rw.y / S;
  f.bowVis = rw.v;

  // Match tracked hands to the pose wrists (more reliable than the hand model's own left/right label).
  let left = null, right = null, bestL = 0.9 * S, bestR = 0.9 * S;
  for (const h of frame.hands || []) {
    const w = { x: h.landmarks[0].x * a, y: h.landmarks[0].y };
    const dl = d2(w, lw), dr = d2(w, rw);
    if (dl < bestL && dl <= dr) { bestL = dl; left = h; }
    else if (dr < bestR) { bestR = dr; right = h; }
  }
  f.leftHand = left;
  f.rightHand = right;
  // Left hand centre: middle-finger knuckle if the hand is tracked, else the pose wrist.
  const lc = left ? { x: left.landmarks[9].x * a, y: left.landmarks[9].y } : lw;
  f.leftX = lc.x / S;
  f.leftY = lc.y / S;
  f.slideDist = d2(lc, ls) / S;
  if (left) {
    // Image points (x and z scaled to the same units as y). Checked on MediaPipe's own test photos: open fingers
    // score 0.88-0.99 and folded ones -0.2 to -0.4 this way; the 3D "world" points gave open hands only 0.6-0.77.
    const pts = left.landmarks.map(p => ({ x: p.x * a, y: p.y, z: (p.z || 0) * a }));
    f.extension = fingerExtension(pts);
  }
  if (right) {
    // Bow direction from the right hand (wrist to knuckles), for drawing the bow.
    const w = right.landmarks[0], k = right.landmarks[9];
    f.rightHandAngle = Math.atan2(k.y - w.y, (k.x - w.x) * a);
    const palm = [0, 5, 9, 13, 17].reduce((acc, i) => acc + right.landmarks[i].x * a, 0) / 5;
    f.bowXHand = palm / S;
  }
  return f;
}

/** Four elbow-height zones with stickiness. */
export class StringSelector {
  constructor() { this.index = 1; this.value = null; }
  update(elbowRel, cal, tuning) {
    if (elbowRel == null || !isFinite(elbowRel)) return this.index;
    this.value = elbowRel;
    const g = cal.elbowG, e = cal.elbowE;
    const step = (e - g) / 3; // negative when G is higher, as normal
    // Position along the G..E axis in zone units: 0 = G centre, 3 = E centre.
    const pos = step !== 0 ? (elbowRel - g) / step : 0;
    const raw = clamp(Math.round(pos), 0, 3);
    if (raw !== this.index) {
      const boundary = (raw > this.index) ? this.index + 0.5 : this.index - 0.5;
      const margin = tuning.stringStickiness;
      if ((raw > this.index && pos > boundary + margin) || (raw < this.index && pos < boundary - margin)) {
        this.index = raw;
      }
    }
    this.pos = pos;
    return this.index;
  }
}

/** Counts folded fingers (thumb ignored) and only changes after a steady run of frames. */
export class FingerCounter {
  constructor() {
    this.folded = [false, false, false, false];
    this.count = 0;
    this.candidate = 0;
    this.run = 0;
    this.raw = 0;
    this.lastSeen = -1e9;
  }
  update(extension, cal, tuning, t) {
    if (!extension) return this.count;
    this.lastSeen = t;
    for (let i = 0; i < 4; i++) {
      const open = cal.openExtension[i] || 0.97;
      if (this.folded[i]) { if (extension[i] > open * tuning.unfoldRatio) this.folded[i] = false; }
      else if (extension[i] < open * tuning.foldRatio) this.folded[i] = true;
    }
    const raw = this.folded.filter(Boolean).length;
    this.raw = raw;
    if (raw === this.candidate) this.run++;
    else { this.candidate = raw; this.run = 1; }
    if (this.run >= tuning.stableFrames) this.count = this.candidate;
    return this.count;
  }
}

/** Slide mode: left hand distance from the shoulder picks one of the slide notes. */
export class SlideSelector {
  constructor() { this.index = 0; this.pos = 0; }
  update(dist, n, cal, tuning) {
    if (dist == null || !isFinite(dist)) return this.index;
    const span = cal.slideFar - cal.slideNear;
    const pos = clamp((dist - cal.slideNear) / span * (n - 1), 0, n - 1);
    this.pos = pos;
    const raw = Math.round(pos);
    if (raw !== this.index && Math.abs(pos - this.index) > 0.5 + tuning.slideStickiness) this.index = raw;
    this.index = clamp(this.index, 0, n - 1);
    return this.index;
  }
}

/** One-euro filter: smooths jitter when still, follows quickly when moving. */
export class OneEuro {
  constructor(minCutoff = 1.5, beta = 0.6, dCutoff = 1.0) {
    Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: null });
  }
  static alpha(cutoff, dt) { const r = 2 * Math.PI * cutoff * dt; return r / (r + 1); }
  filter(x, t) {
    if (this.x == null || this.t == null) { this.x = x; this.t = t; return x; }
    const dt = Math.max(1e-3, (t - this.t) / 1000);
    this.t = t;
    const dx = (x - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (x - this.x);
    return this.x;
  }
  reset() { this.x = null; this.t = null; this.dx = 0; }
}

/**
 * Bowing: right wrist side-to-side speed sets loudness; direction flips and restarts after a stop start new strokes.
 * dir: -1 = down bow (towards the player's right), +1 = up bow, 0 = stopped.
 */
export class BowTracker {
  constructor() {
    this.fx = null;
    this.prevX = null; this.prevT = null;
    this.speed = 0; this.vel = 0;
    this.dir = 0; this.belowSince = null;
    this.strokes = 0;
    this.amp = 0;
  }
  update(x, t, cal, tuning) {
    const out = { newStroke: false };
    if (x == null || !isFinite(x)) {
      this.vel *= 0.5; this.speed = Math.abs(this.vel);
    } else {
      if (!this.fx) this.fx = new OneEuro(tuning.bowCutoff ?? 1.0, tuning.bowBeta ?? 0.8);
      const fx = this.fx.filter(x, t);
      if (this.prevX != null) {
        const dt = Math.max(1e-3, (t - this.prevT) / 1000);
        const v = (fx - this.prevX) / dt;
        const k = 1 - Math.exp(-dt / 0.05);
        this.vel += k * (v - this.vel);
      }
      this.prevX = fx; this.prevT = t;
      this.speed = Math.abs(this.vel);
    }
    const sign = this.vel < 0 ? -1 : 1;
    if (this.speed > tuning.bowOn && sign !== this.dir) {
      this.dir = sign; this.strokes++; out.newStroke = true; this.belowSince = null;
    } else if (this.speed < tuning.bowOff) {
      if (this.belowSince == null) this.belowSince = t;
      if (this.dir !== 0 && t - this.belowSince > tuning.bowStopMs) this.dir = 0;
    } else this.belowSince = null;
    // Smooth loudness curve: 0 below bowOff, rising to 1 at the calibrated full speed.
    const s = clamp((this.speed - tuning.bowOff) / Math.max(0.2, cal.bowFull - tuning.bowOff), 0, 1);
    this.amp = this.dir === 0 && this.speed < tuning.bowOn ? 0 : Math.pow(s, 0.75);
    out.dir = this.dir; out.speed = this.speed; out.amp = this.amp; out.vel = this.vel;
    return out;
  }
}

/** A small quick wobble of the left hand (about 3-10 per second) becomes vibrato depth 0..1 and a rate. */
export class VibratoDetector {
  constructor() { this.hist = []; this.depth = 0; this.rate = 5.5; this.slow = null; }
  update(x, y, t) {
    if (x == null || !isFinite(x)) { this.depth *= 0.9; return { depth: this.depth, rate: this.rate }; }
    if (!this.slow) this.slow = { x, y, t };
    const dt = Math.max(1e-3, (t - this.slow.t) / 1000);
    const k = 1 - Math.exp(-dt / 0.3);
    this.slow.x += k * (x - this.slow.x); this.slow.y += k * (y - this.slow.y); this.slow.t = t;
    const hx = x - this.slow.x, hy = y - this.slow.y;
    // Use the larger of the two directions: wobble can be along or across the neck.
    this.hist.push({ t, hx, hy });
    while (this.hist.length && t - this.hist[0].t > 600) this.hist.shift();
    if (this.hist.length < 8) return { depth: this.depth, rate: this.rate };
    let best = null;
    for (const key of ['hx', 'hy']) {
      let ss = 0, zc = 0, prev = 0;
      for (const h of this.hist) { const v = h[key]; ss += v * v; if (prev && Math.sign(v) !== Math.sign(prev)) zc++; if (v) prev = v; }
      const rms = Math.sqrt(ss / this.hist.length);
      const span = (this.hist[this.hist.length - 1].t - this.hist[0].t) / 1000;
      const hz = span > 0 ? zc / 2 / span : 0;
      if (!best || rms > best.rms) best = { rms, hz };
    }
    // Small (0.6% - 12% of shoulder width) and quick (3-10 Hz). Bigger moves are note/slide changes.
    let target = 0;
    if (best.hz >= 3 && best.hz <= 10 && best.rms < 0.12) target = clamp((best.rms - 0.006) / 0.025, 0, 1);
    this.depth += (target > this.depth ? 0.35 : 0.12) * (target - this.depth);
    if (target > 0) this.rate += 0.2 * (clamp(best.hz, 4, 8) - this.rate);
    return { depth: this.depth, rate: this.rate, rms: best.rms, hz: best.hz };
  }
}

/** Helpers for the calibration steps. */
export function median(arr) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
export function percentile(arr, p) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[clamp(Math.floor(p * (s.length - 1)), 0, s.length - 1)];
}

/** Builds a calibration from what was recorded in each step. Falls back to defaults where data is missing. */
export function buildCalibration(rec, base = DEFAULT_CALIBRATION) {
  const cal = { ...base, openExtension: [...base.openExtension] };
  if (rec.hold && rec.hold.extension.length >= 5) {
    for (let i = 0; i < 4; i++) cal.openExtension[i] = clamp(median(rec.hold.extension.map(s => s[i])), 0.7, 1.0);
  }
  if (rec.hold && rec.hold.slideDist.length >= 5) {
    cal.slideNear = clamp(median(rec.hold.slideDist), 0.2, 1.5);
    cal.slideFar = cal.slideNear + 1.2;
  }
  if (rec.far && rec.far.slideDist.length >= 5) {
    // Aim a little short of the furthest comfortable reach so the top note is easy to hit.
    const far = median(rec.far.slideDist) * 0.95;
    if (far - cal.slideNear >= 0.4) cal.slideFar = far;
  }
  let g = rec.g && rec.g.elbow.length >= 5 ? median(rec.g.elbow) : null;
  let e = rec.e && rec.e.elbow.length >= 5 ? median(rec.e.elbow) : null;
  if (g != null && e != null && g - e >= 0.2) { cal.elbowG = g; cal.elbowE = e; }
  else if (g != null && e != null) {
    // Too close together to tell strings apart: centre a default-sized range on what we saw.
    const mid = (g + e) / 2; cal.elbowG = mid + 0.35; cal.elbowE = mid - 0.35;
  }
  const speeds = [...(rec.g?.speed || []), ...(rec.e?.speed || [])].filter(v => v > 0.2);
  if (speeds.length >= 10) cal.bowFull = clamp(percentile(speeds, 0.8), 0.8, 5);
  cal.done = true;
  return cal;
}
