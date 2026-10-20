// 3D violin and bow drawn into the player's hands. Original shapes built in code (no model files).
// Units inside the models are centimetres; they are scaled to the player's shoulder width on screen.

import * as THREE from 'three';

const BODY_LEN = 35.5;
const BRIDGE_X = 16;
const NUT_X = 48.5;
const TOP_Z = 4.6;            // top plate height (extrude depth + bevel)
const BRIDGE_H = 3.3;
const STRING_Y_BRIDGE = [1.7, 0.57, -0.57, -1.7]; // G D A E
const STRING_Y_NUT = [0.78, 0.26, -0.26, -0.78];
const SHOULDER_CM = 38;

function grainTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, '#7a2f0c'); grad.addColorStop(0.5, '#c8661f'); grad.addColorStop(1, '#7a2f0c');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  // Flamed maple stripes.
  for (let i = 0; i < 40; i++) {
    const y = i * 6.4 + Math.sin(i) * 2;
    g.fillStyle = `rgba(255, 210, 140, ${0.05 + 0.06 * Math.abs(Math.sin(i * 1.7))})`;
    g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(90, y - 8, 170, y + 8, 256, y - 2); g.lineTo(256, y + 3); g.bezierCurveTo(170, y + 11, 90, y - 5, 0, y + 3); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function bodyShape() {
  // Half-outline from the tail end (x=0) to the neck end (x=35.5): lower bout, C-bouts with corners, upper bout.
  const half = [[0, 0], [0.5, 4.4], [2.6, 8.1], [6.5, 10.1], [10.5, 10.2], [13.6, 9.0], [15.6, 8.4], [16.1, 7.2],
    [17.3, 5.9], [19.4, 5.6], [21.3, 6.2], [22.0, 7.4], [22.6, 7.9], [25.5, 8.3], [29.2, 8.1], [32.6, 6.6], [34.8, 3.8], [35.5, 0]];
  const pts = [...half.map(([x, y]) => new THREE.Vector2(x, y)), ...half.slice(1, -1).reverse().map(([x, y]) => new THREE.Vector2(x, -y))];
  const s = new THREE.Shape();
  s.moveTo(pts[0].x, pts[0].y);
  s.splineThru([...pts.slice(1), pts[0]]);
  return s;
}

function fHoleShape(sign) {
  const s = new THREE.Shape();
  s.absellipse(0, 0, 3.4, 0.28, 0, Math.PI * 2, false, 0.25 * sign);
  return s;
}

function buildViolin() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ map: grainTexture(), roughness: 0.32, metalness: 0.05, color: 0xffffff });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x5a240a, roughness: 0.4 });
  const ebony = new THREE.MeshStandardMaterial({ color: 0x141010, roughness: 0.35 });
  const maple = new THREE.MeshStandardMaterial({ color: 0xe8c48a, roughness: 0.6 });
  const black = new THREE.MeshBasicMaterial({ color: 0x0a0604 });

  // Body: rounded extruded outline.
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(bodyShape(), {
    depth: 3.6, bevelEnabled: true, bevelThickness: 1.0, bevelSize: 0.7, bevelSegments: 4, curveSegments: 40 }), wood);
  body.position.z = 0;
  g.add(body);
  // Purfling-ish darker rim and f-holes.
  for (const sign of [1, -1]) {
    const f = new THREE.Mesh(new THREE.ShapeGeometry(fHoleShape(sign), 16), black);
    f.position.set(BRIDGE_X + 0.3, sign * 3.6, TOP_Z + 0.02);
    f.rotation.z = sign * 0.08;
    g.add(f);
    for (const dx of [-3.1, 3.3]) {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.45, 12), black);
      dot.position.set(BRIDGE_X + 0.3 + dx, sign * (3.6 + (dx > 0 ? 0.35 : -0.35) * sign * sign), TOP_Z + 0.03);
      g.add(dot);
    }
  }
  // Neck, pegbox and scroll.
  const neck = new THREE.Mesh(new THREE.BoxGeometry(NUT_X - BODY_LEN + 1, 2.6, 2.4), darkWood);
  neck.position.set((BODY_LEN + NUT_X) / 2, 0, TOP_Z - 0.6);
  g.add(neck);
  const pegbox = new THREE.Mesh(new THREE.BoxGeometry(7.5, 2.3, 2.6), darkWood);
  pegbox.position.set(NUT_X + 3.6, 0, TOP_Z - 0.4);
  g.add(pegbox);
  const scroll = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.75, 12, 24), darkWood);
  scroll.position.set(NUT_X + 8.6, 0, TOP_Z + 0.2);
  scroll.rotation.x = Math.PI / 2;
  g.add(scroll);
  const scrollEye = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 8), darkWood);
  scrollEye.position.copy(scroll.position);
  g.add(scrollEye);
  for (let i = 0; i < 4; i++) {
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 6.2, 8), ebony);
    peg.position.set(NUT_X + 1.6 + i * 1.6, 0, TOP_Z - 0.4);
    g.add(peg);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 8), ebony);
    head.scale.set(1, 0.45, 1.3);
    head.position.set(NUT_X + 1.6 + i * 1.6, (i % 2 ? 1 : -1) * 3.3, TOP_Z - 0.4);
    g.add(head);
  }
  // Fingerboard: tapered ebony board raised above the top.
  const fb = new THREE.Shape();
  fb.moveTo(21.5, -2.1); fb.lineTo(NUT_X, -1.2); fb.lineTo(NUT_X, 1.2); fb.lineTo(21.5, 2.1); fb.closePath();
  const fingerboard = new THREE.Mesh(new THREE.ExtrudeGeometry(fb, { depth: 0.7, bevelEnabled: false }), ebony);
  fingerboard.position.z = TOP_Z + 0.9;
  g.add(fingerboard);
  // Tailpiece and chinrest.
  const tp = new THREE.Shape();
  tp.moveTo(1.2, -1.9); tp.lineTo(12.5, -1.1); tp.lineTo(12.5, 1.1); tp.lineTo(1.2, 1.9); tp.closePath();
  const tail = new THREE.Mesh(new THREE.ExtrudeGeometry(tp, { depth: 0.6, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.2, bevelSegments: 2 }), ebony);
  tail.position.z = TOP_Z + 0.5;
  g.add(tail);
  const chin = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 1.2, 24), ebony);
  chin.rotation.x = Math.PI / 2;
  chin.scale.set(1, 1, 0.75);
  chin.position.set(3.6, 4.6, TOP_Z + 0.6);
  g.add(chin);
  // Bridge.
  const br = new THREE.Shape();
  br.moveTo(-2.1, 0); br.lineTo(-1.7, BRIDGE_H * 0.92); br.quadraticCurveTo(0, BRIDGE_H * 1.05, 1.7, BRIDGE_H * 0.92); br.lineTo(2.1, 0); br.closePath();
  const bridge = new THREE.Mesh(new THREE.ExtrudeGeometry(br, { depth: 0.35, bevelEnabled: false }), maple);
  bridge.rotation.set(Math.PI / 2, Math.PI / 2, 0);
  bridge.position.set(BRIDGE_X, 0, TOP_Z);
  g.add(bridge);

  // Strings: tailpiece -> bridge -> nut. One glowing halo per string for "this string is playing".
  const strings = [];
  for (let i = 0; i < 4; i++) {
    const a = new THREE.Vector3(12.2, STRING_Y_BRIDGE[i] * 0.6, TOP_Z + 1.3);
    const b = new THREE.Vector3(BRIDGE_X, STRING_Y_BRIDGE[i], TOP_Z + BRIDGE_H);
    const c = new THREE.Vector3(NUT_X, STRING_Y_NUT[i], TOP_Z + 1.8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9d4cc, metalness: 0.8, roughness: 0.3, emissive: 0x000000 });
    const r = [0.085, 0.07, 0.06, 0.045][i];
    const seg1 = cylinderBetween(a, b, r, mat);
    const seg2 = cylinderBetween(b, c, r, mat);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = cylinderBetween(b, c, 0.28, glowMat);
    g.add(seg1, seg2, glow);
    strings.push({ mat, glowMat, glow, b, c });
  }
  return { group: g, strings };
}

function cylinderBetween(a, b, r, mat) {
  const len = a.distanceTo(b);
  const geo = new THREE.CylinderGeometry(r, r, len, 8, 1, true);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

function buildBow() {
  const g = new THREE.Group();
  const L = 74;
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x4a1d08, roughness: 0.35, metalness: 0.1 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0xf3eee2, roughness: 0.9, emissive: 0x2a2620 });
  const ebony = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.9, roughness: 0.25 });
  // Stick with a gentle inward curve (camber), built from short pieces.
  const pts = [];
  for (let i = 0; i <= 16; i++) { const x = i / 16 * L; pts.push(new THREE.Vector3(x, 1.6 - 0.5 * Math.sin(Math.PI * x / L), 0)); }
  const curve = new THREE.CatmullRomCurve3(pts);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.42, 8, false), stickMat));
  const hair = new THREE.Mesh(new THREE.BoxGeometry(L - 3, 0.12, 1.0), hairMat);
  hair.position.set(L / 2 + 0.5, 0, 0);
  g.add(hair);
  const frog = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.0, 1.4), ebony);
  frog.position.set(1.8, 0.9, 0);
  g.add(frog);
  const eye = new THREE.Mesh(new THREE.CircleGeometry(0.35, 12), silver);
  eye.position.set(1.8, 0.9, 0.71);
  g.add(eye);
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 2.2, 10), silver);
  screw.rotation.z = Math.PI / 2;
  screw.position.set(-1.0, 1.6, 0);
  g.add(screw);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.0, 0.9), new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.5 }));
  tip.position.set(L + 0.2, 0.8, 0);
  g.add(tip);
  return g;
}

export class Violin3D {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 0, -1, -5000, 5000);
    this.camera.position.z = 2000;
    this.scene.add(new THREE.HemisphereLight(0xfff2e0, 0x3a2412, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-0.5, 0.8, 1);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffd29a, 0.8);
    rim.position.set(0.7, -0.3, 0.6);
    this.scene.add(rim);

    const v = buildViolin();
    this.violin = new THREE.Group();     // placed in screen space (rotation in the picture plane)
    this.violinRoll = new THREE.Group(); // tilt about the violin's own length
    this.violinRoll.add(v.group);
    this.violin.add(this.violinRoll);
    this.strings = v.strings;
    this.scene.add(this.violin);
    this.bow = buildBow();
    this.bowRoot = new THREE.Group();
    this.bowRoot.add(this.bow);
    this.scene.add(this.bowRoot);
    this.smooth = null;
    this.time = 0;
    this.w = 1; this.h = 1;
  }

  resize(w, h, dpr) {
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    Object.assign(this.camera, { left: 0, right: w, top: 0, bottom: -h });
    this.camera.updateProjectionMatrix();
  }

  /** Works out where the violin and bow go on screen (pixels, y down). */
  targets(frame, state, toScreen) {
    const f = state.features;
    if (frame && frame.pose && f && f.ok) {
      const P = i => toScreen(frame.pose[i]);
      const ls = P(11), rs = P(12), nose = P(0);
      const S = Math.hypot(ls.x - rs.x, ls.y - rs.y);
      const lh = f.leftHand ? toScreen(f.leftHand.landmarks[9]) : P(15);
      const rhPts = f.rightHand ? [0, 5, 9, 13, 17].map(i => toScreen(f.rightHand.landmarks[i])) : null;
      const rh = rhPts ? { x: rhPts.reduce((a, p) => a + p.x, 0) / 5, y: rhPts.reduce((a, p) => a + p.y, 0) / 5 } : P(16);
      // Tail end of the violin sits under the chin, between the neck and the left shoulder.
      const tail = { x: ls.x + (rs.x - ls.x) * 0.3, y: ls.y + (nose.y - ls.y) * 0.25 };
      return { tail, lh, rh, S, ok: true };
    }
    // No camera: a resting position so the keyboard player still sees an instrument.
    const S = Math.min(this.w, this.h * 1.4) * 0.3;
    const tail = { x: this.w * 0.55, y: this.h * 0.52 };
    const lh = { x: tail.x - S * 1.35, y: tail.y - S * 0.55 };
    const sway = Math.sin(this.time * 2.2) * (state.dir ? 0 : 0);
    const rh = { x: tail.x + S * 0.25 + (this.kbBow || 0) * S * 0.7, y: tail.y + S * 0.65 + sway };
    return { tail, lh, rh, S, ok: false };
  }

  update(frame, state, toScreen, mapping, visible) {
    this.time += 1 / 60;
    this.renderer.domElement.style.display = visible ? '' : 'none';
    if (!visible) return;
    // Keyboard bowing moves the resting bow side to side.
    if (!frame) this.kbBow = Math.max(-1, Math.min(1, (this.kbBow || 0) + (state.dir || 0) * -0.02 * (0.5 + state.amp)));
    const t = this.targets(frame, state, toScreen);
    const k = this.smooth ? 0.45 : 1;
    const sm = this.smooth || (this.smooth = {});
    for (const key of ['tail', 'lh', 'rh']) {
      sm[key] = sm[key] ? { x: sm[key].x + (t[key].x - sm[key].x) * k, y: sm[key].y + (t[key].y - sm[key].y) * k } : { ...t[key] };
    }
    sm.S = sm.S ? sm.S + (t.S - sm.S) * 0.2 : t.S;
    const pxPerCm = sm.S / SHOULDER_CM;

    // Violin: from the chin towards the left hand (screen y down -> world y up).
    const dx = sm.lh.x - sm.tail.x, dy = -(sm.lh.y - sm.tail.y);
    const ang = Math.atan2(dy, dx);
    this.violin.position.set(sm.tail.x, -sm.tail.y, 0);
    this.violin.rotation.set(0, 0, ang);
    this.violin.scale.setScalar(pxPerCm);
    // Tilt so we see the top and a bit of the side, G side up.
    this.violinRoll.rotation.set(Math.cos(ang) < 0 ? 0.55 : -0.55, 0, 0);

    // Playing string glows; when sounding it shimmers like a vibrating string.
    const amp = state.amp || 0;
    this.strings.forEach((s, i) => {
      const on = i === state.stringIndex;
      s.mat.emissive.setHex(on ? 0xffa53a : 0x000000);
      s.mat.emissiveIntensity = on ? 0.6 + 1.6 * amp : 0;
      s.glowMat.opacity = on ? 0.25 + 0.55 * amp : 0;
      s.glow.scale.set(on ? 1 + amp * (1.2 + 0.6 * Math.sin(this.time * 60)) : 1, 1, on ? 1 + amp * 1.5 : 1);
    });

    // Bow: frog in the right hand, stick passing over the playing string between bridge and fingerboard.
    this.violin.updateMatrixWorld(true);
    const s = this.strings[state.stringIndex ?? 1] || this.strings[1];
    const contactLocal = s.b.clone().lerp(s.c, 0.12);
    contactLocal.z += 0.3;
    const contact = this.violinRoll.children[0].localToWorld(contactLocal.clone());
    const hand = new THREE.Vector3(sm.rh.x, -sm.rh.y, contact.z + 2 * pxPerCm);
    const dir = new THREE.Vector3(contact.x - hand.x, contact.y - hand.y, 0);
    if (dir.length() > 6 * pxPerCm) this.bowDir = Math.atan2(dir.y, dir.x);
    this.bowRoot.position.copy(hand);
    this.bowRoot.rotation.set(0, 0, this.bowDir ?? Math.PI);
    this.bowRoot.scale.setScalar(pxPerCm);
    this.bow.rotation.set(-0.35, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }
}
