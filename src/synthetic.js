// Fake "player" data in the same shape MediaPipe gives us. Used by the tests, the clip-free demo and the debug view.
// Nothing here comes from a real camera.

import { POSE } from './tracking-logic.js';

/** Small seeded random generator so tests are repeatable. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Builds a 21-point hand (MediaPipe order) with the palm facing the camera and fingers pointing up.
 * folds: 4 numbers 0 (straight) .. 1 (fully folded) for index, middle, ring, little.
 * Returns points in metres, wrist at the origin, x to image right, y down, z towards the camera negative.
 */
export function handWorld(folds, { thumbOut = 1, spread = 1 } = {}) {
  const pts = new Array(21);
  pts[0] = { x: 0, y: 0, z: 0 };
  // The player's left hand seen from the front with the palm facing the camera: thumb towards image left.
  // Thumb
  const th = [{ x: -0.025, y: -0.02 }, { x: -0.045, y: -0.04 }, { x: -0.058 * thumbOut, y: -0.06 }, { x: -0.066 * thumbOut, y: -0.078 }];
  th.forEach((p, i) => { pts[1 + i] = { x: p.x, y: p.y, z: -0.01 }; });
  const baseX = [-0.022, -0.004, 0.014, 0.03];
  const baseY = [-0.09, -0.093, -0.088, -0.078];
  const segs = [[0.04, 0.025, 0.022], [0.045, 0.028, 0.024], [0.042, 0.026, 0.023], [0.033, 0.02, 0.02]];
  for (let f = 0; f < 4; f++) {
    const mcp = { x: baseX[f] * spread, y: baseY[f], z: 0 };
    pts[5 + 4 * f] = mcp;
    const fold = Math.max(0, Math.min(1, folds[f] || 0));
    // Joint bends towards the camera: MCP up to 80 deg, PIP up to 100 deg, DIP up to 70 deg.
    const bends = [80 * fold, 100 * fold, 70 * fold].map(d => d * Math.PI / 180);
    let ang = 0, p = mcp;
    for (let s = 0; s < 3; s++) {
      ang += bends[s];
      const L = segs[f][s];
      p = { x: p.x + (f - 1.5) * 0.002 * (1 - fold), y: p.y - L * Math.cos(ang), z: p.z - L * Math.sin(ang) };
      pts[6 + 4 * f + s] = p;
    }
  }
  return pts;
}

/**
 * One synthetic frame.
 * opts: elbowRel (right elbow height vs shoulder, shoulder widths), folds (count 0-4 or array of 4),
 * bowX (right wrist side offset from body centre, shoulder widths, + = player's left),
 * slideDist (left hand distance from left shoulder, shoulder widths), wobble (left hand offset, shoulder widths),
 * S (shoulder width as a fraction of image height), cx, cy (body centre, 0..1), aspect, noise (std, shoulder widths)
 */
export function makeFrame(opts = {}, rand = Math.random) {
  const o = { elbowRel: -0.45, folds: 0, bowX: 0, slideDist: 0.6, wobble: 0, S: 0.3, cx: 0.5, cy: 0.42,
    aspect: 4 / 3, noise: 0, t: 0, hands: true, ...opts };
  const S = o.S, a = o.aspect;
  const n = () => (o.noise ? (rand() + rand() + rand() - 1.5) * 1.15 * o.noise * S : 0);
  // Work in "aspect space" (x scaled by aspect), convert at the end.
  const cxA = o.cx * a;
  const ls = { x: cxA + S / 2, y: o.cy }, rs = { x: cxA - S / 2, y: o.cy };
  const nose = { x: cxA + 0.05 * S, y: o.cy - 0.55 * S };
  // Right arm: elbow out to the side and down/up per elbowRel, wrist in front of the body.
  const re = { x: rs.x - 0.35 * S, y: rs.y - o.elbowRel * S };
  const rw = { x: cxA + o.bowX * S, y: o.cy + 0.45 * S - 0.25 * o.elbowRel * S };
  // Left hand: up and out from the left shoulder, along an imaginary neck.
  const dir = { x: 0.82, y: -0.57 };
  const lhc = { x: ls.x + dir.x * o.slideDist * S + o.wobble * S, y: ls.y + dir.y * o.slideDist * S };
  const handScale = S / 0.38 * 1.0; // metres -> image units (shoulders ~38 cm)
  const lw = { x: lhc.x, y: lhc.y + 0.093 * handScale };
  const le = { x: ls.x + 0.45 * S, y: ls.y + 0.55 * S };
  const pose = new Array(33).fill(null).map(() => ({ x: cxA, y: o.cy + 0.8 * S, z: 0, visibility: 0.3 }));
  const set = (i, p, vis = 0.99) => { pose[i] = { x: p.x + n(), y: p.y + n(), z: 0, visibility: vis }; };
  set(POSE.NOSE, nose); set(POSE.L_SHOULDER, ls); set(POSE.R_SHOULDER, rs);
  set(23, { x: ls.x - 0.1 * S, y: ls.y + 1.5 * S }, 0.6); set(24, { x: rs.x + 0.1 * S, y: rs.y + 1.5 * S }, 0.6);
  set(POSE.L_ELBOW, le); set(POSE.R_ELBOW, re); set(POSE.L_WRIST, lw); set(POSE.R_WRIST, rw);
  for (const p of pose) p.x /= a;

  const hands = [];
  if (o.hands) {
    const folds = Array.isArray(o.folds) ? o.folds : [0, 1, 2, 3].map(i => (i < o.folds ? 1 : 0));
    const world = handWorld(folds);
    const hn = () => (o.noise ? (rand() - 0.5) * 0.004 : 0);
    const worldN = world.map(p => ({ x: p.x + hn(), y: p.y + hn(), z: p.z + hn() }));
    const landmarks = worldN.map(p => ({ x: (lw.x + p.x * handScale) / a, y: lw.y + p.y * handScale, z: p.z * handScale }));
    hands.push({ landmarks, world: worldN, label: 'Right' });
    // Right hand holding the bow: a loose fist.
    const rworld = handWorld([0.8, 0.8, 0.8, 0.8], { thumbOut: 0.5 });
    const rot = Math.PI / 2; // fingers pointing towards the player's left
    const rl = rworld.map(p => ({
      x: (rw.x + (p.x * Math.cos(rot) - p.y * Math.sin(rot)) * handScale) / a,
      y: rw.y + (p.x * Math.sin(rot) + p.y * Math.cos(rot)) * handScale, z: p.z * handScale,
    }));
    hands.push({ landmarks: rl, world: rworld, label: 'Left' });
  }
  return { t: o.t, aspect: a, pose, hands, synthetic: true };
}

/**
 * A scripted performance: list of segments {ms, ...frame opts, bow: 'down'|'up'|'still'|'saw', bowSpeed}.
 * Produces frames at fps. The bow position is integrated from the speed so direction changes are real.
 */
export function makeSequence(segments, { fps = 30, seed = 7, noise = 0.004, start = 0 } = {}) {
  const rand = rng(seed);
  const frames = [];
  let t = start, bowX = 0;
  for (const seg of segments) {
    const n = Math.round(seg.ms / 1000 * fps);
    for (let i = 0; i < n; i++) {
      const sp = seg.bowSpeed ?? 1.2;
      let v = 0;
      if (seg.bow === 'down') v = -sp;
      else if (seg.bow === 'up') v = sp;
      else if (seg.bow === 'saw') v = (Math.floor((t - start) / (seg.strokeMs || 800)) % 2 ? sp : -sp);
      bowX += v / fps;
      const wob = seg.wobble ? seg.wobble * Math.sin(2 * Math.PI * (seg.wobbleHz || 6) * t / 1000) : 0;
      frames.push({ ...makeFrame({ ...seg, bowX, wobble: wob, noise: seg.noise ?? noise, t }, rand), label: seg.label || null, expect: seg.expect || null });
      t += 1000 / fps;
    }
  }
  return frames;
}
