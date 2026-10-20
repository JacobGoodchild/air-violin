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

  async loadModels(model = 'lite', delegate = 'GPU') {
    const { FilesetResolver, PoseLandmarker, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(BASE + 'mediapipe/wasm');
    const make = async (dlg) => Promise.all([
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}models/pose_landmarker_${model}.task`, delegate: dlg },
        runningMode: 'VIDEO', numPoses: 1,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      }),
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}models/hand_landmarker.task`, delegate: dlg },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      }),
    ]);
    try { [this.pose, this.hands] = await make(delegate); this.delegate = delegate; }
    catch (e) {
      if (delegate === 'CPU') throw e;
      [this.pose, this.hands] = await make('CPU'); this.delegate = 'CPU';
    }
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
    if (!v || v.readyState < 2 || !this.pose) return;
    let ts = Math.round(meta && meta.mediaTime != null ? meta.mediaTime * 1000 : performance.now());
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    const t0 = performance.now();
    let pose = null, hands = [];
    try {
      const pr = this.pose.detectForVideo(v, ts);
      if (pr.landmarks && pr.landmarks.length) pose = pr.landmarks[0];
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
    const frame = { t: t1, aspect: v.videoWidth / v.videoHeight, pose, hands, captureTime: meta && meta.captureTime, trackDone: t1 };
    if (this.onFrame) this.onFrame(frame);
  }

  stop() {
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null;
  }
}
