// Webcam + MediaPipe pose and hand tracking, all on this device. Nothing is uploaded or saved.

const BASE = new URL('../vendor/', import.meta.url).href;

export class Tracker {
  constructor() {
    this.video = null; this.stream = null;
    this.pose = null; this.hands = null;
    this.running = false; this.lastTs = -1;
    this.onFrame = null;
    this.stats = { fps: 0, trackMs: 0, cameraMs: null, frames: 0 };
    this._fpsT = performance.now(); this._fpsN = 0;
  }

  /**
   * Downloads the tracking files with a progress report (they total ~35 MB, so a slow connection shouldn't look
   * frozen). The WebAssembly file is fetched first so the browser has it cached when MediaPipe asks for it.
   */
  async download(model, onProgress) {
    const simd = typeof WebAssembly === 'object' && WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    const files = [
      `${BASE}mediapipe/wasm/${simd ? 'vision_wasm_internal' : 'vision_wasm_nosimd_internal'}.wasm`,
      `${BASE}models/pose_landmarker_${model}.task`,
      `${BASE}models/hand_landmarker.task`,
    ];
    const sizes = files.map(() => 0), got = files.map(() => 0);
    const report = () => { const tot = sizes.reduce((a, b) => a + b, 0); if (onProgress && tot) onProgress(got.reduce((a, b) => a + b, 0) / tot); };
    const bufs = await Promise.all(files.map(async (url, i) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`could not load ${url}`);
      sizes[i] = +res.headers.get('content-length') || 0;
      if (!res.body || !sizes[i]) { const b = new Uint8Array(await res.arrayBuffer()); got[i] = sizes[i] = b.length; report(); return b; }
      const reader = res.body.getReader(); const parts = [];
      for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got[i] += value.length; report(); }
      const out = new Uint8Array(got[i]); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
      return out;
    }));
    return { pose: bufs[1], hand: bufs[2] };
  }

  async loadModels(model = 'lite', delegate = 'GPU', onProgress = null) {
    const { FilesetResolver, PoseLandmarker, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const data = await this.download(model, onProgress);
    const fileset = await FilesetResolver.forVisionTasks(BASE + 'mediapipe/wasm');
    const make = async (dlg) => Promise.all([
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: data.pose, delegate: dlg },
        runningMode: 'VIDEO', numPoses: 1,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      }),
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: data.hand, delegate: dlg },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      }),
    ]);
    // Swap models safely (e.g. lite -> full while the camera runs): stop using the old ones, then free them.
    const old = [this.pose, this.hands];
    this.pose = null; this.hands = null;
    for (const m of old) { try { m && m.close(); } catch { /* already closed */ } }
    let pose, hands;
    try { [pose, hands] = await make(delegate); this.delegate = delegate; }
    catch (e) {
      if (delegate === 'CPU') throw e;
      [pose, hands] = await make('CPU'); this.delegate = 'CPU';
    }
    this.pose = pose; this.hands = hands;
  }

  async startCamera(video) {
    this.video = video;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30 } },
    });
    video.srcObject = this.stream;
    video.muted = true; video.playsInline = true;
    await video.play();
  }

  start() {
    if (this.running) return;
    this.running = true;
    const v = this.video;
    const step = (now, meta) => {
      if (!this.running) return;
      this.process(now, meta);
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step);
      else requestAnimationFrame(t => step(t, null));
    };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step);
    else requestAnimationFrame(t => step(t, null));
  }

  process(now, meta) {
    const v = this.video;
    if (!v || v.readyState < 2 || !this.pose || !this.hands) return;
    let ts = Math.round(meta && meta.mediaTime != null ? meta.mediaTime * 1000 : performance.now());
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    const t0 = performance.now();
    let pose = null, poseWorld = null, hands = [];
    try {
      const pr = this.pose.detectForVideo(v, ts);
      if (pr.landmarks && pr.landmarks.length) { pose = pr.landmarks[0]; poseWorld = pr.worldLandmarks ? pr.worldLandmarks[0] : null; }
      const hr = this.hands.detectForVideo(v, ts);
      hands = (hr.landmarks || []).map((lm, i) => ({
        landmarks: lm, world: hr.worldLandmarks ? hr.worldLandmarks[i] : null,
        label: hr.handedness && hr.handedness[i] && hr.handedness[i][0] ? hr.handedness[i][0].categoryName : null,
      }));
    } catch (e) { console.warn('tracking error', e); return; }
    const t1 = performance.now();
    this.stats.trackMs = this.stats.trackMs * 0.9 + (t1 - t0) * 0.1;
    if (meta && meta.captureTime) this.stats.cameraMs = Math.max(0, t0 - meta.captureTime);
    this._fpsN++;
    if (t1 - this._fpsT > 1000) { this.stats.fps = this._fpsN * 1000 / (t1 - this._fpsT); this._fpsN = 0; this._fpsT = t1; }
    this.stats.frames++;
    const frame = { t: t1, aspect: v.videoWidth / v.videoHeight, pose, poseWorld, hands, captureTime: meta && meta.captureTime, trackDone: t1 };
    if (this.onFrame) this.onFrame(frame);
  }

  stop() {
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null;
  }
}
