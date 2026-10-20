// Sample-based violin voice using the Web Audio API.
// Real recordings (VSCO 2 CE solo violin, CC0) looped in their sustain, two loudness layers crossfaded by bow speed.

import { midiToHz } from './music.js';

const ATTACK_SLUR = 0.07;   // s crossfade when the note changes mid-stroke
const ATTACK_STROKE = 0.012; // s fade-in on a new bow stroke (the recording supplies the real attack)
const RELEASE = 0.09;       // time constant for the fade when the bow stops (~0.3 s to silence)
const SLUR_SKIP = 0.25;       // s past a recording's attack point where slurred notes start

export class ViolinAudio {
  constructor() {
    this.ctx = null;
    this.samples = [];
    this.voice = null;
    this.loaded = false;
    this.volume = 0.8;
    this.stats = { attacks: 0, slurs: 0, releases: 0, voices: 0 };
    this.lastAmp = 0;
  }

  /** Must be called from a user gesture (click/key) so the browser allows sound. */
  async init(base = 'assets/audio/') {
    if (this.ctx) { if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    // Gentle body resonance + a small synthetic room (no extra files needed).
    this.body = ctx.createBiquadFilter();
    this.body.type = 'peaking'; this.body.frequency.value = 2800; this.body.Q.value = 0.8; this.body.gain.value = 2;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 3; this.comp.attack.value = 0.003; this.comp.release.value = 0.2;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeRoom(1.6);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.18;
    this.dry = ctx.createGain(); this.dry.gain.value = 1;
    this.bus = ctx.createGain();
    this.bus.connect(this.body);
    this.body.connect(this.dry); this.body.connect(this.reverb); this.reverb.connect(this.wet);
    this.dry.connect(this.master); this.wet.connect(this.master);
    this.master.connect(this.comp); this.comp.connect(ctx.destination);
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024;
    this.comp.connect(this.analyser);
    this._meterBuf = new Float32Array(this.analyser.fftSize);
    // Vibrato LFO shared by all voices (depth set per update).
    this.lfo = ctx.createOscillator(); this.lfo.frequency.value = 5.5;
    this.lfoGain = ctx.createGain(); this.lfoGain.gain.value = 0;
    this.lfo.connect(this.lfoGain); this.lfo.start();
    // A little noise for the bow hair catching the string at the start of a stroke.
    this.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.15), ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    let seed = 777;
    for (let i = 0; i < nd.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; nd[i] = seed / 0x7fffffff * 2 - 1; }
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    await this.load(base);
  }

  async load(base) {
    const man = await (await fetch(base + 'manifest.json')).json();
    const list = await Promise.all(man.samples.map(async s => {
      const buf = await (await fetch(base + s.file)).arrayBuffer();
      const audio = await this.ctx.decodeAudioData(buf);
      return { ...s, buffer: audio };
    }));
    this.samples = list;
    this.loaded = true;
  }

  makeRoom(seconds) {
    const ctx = this.ctx, rate = ctx.sampleRate, len = Math.floor(seconds * rate);
    const buf = ctx.createBuffer(2, len, rate);
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        d[i] = rnd() * Math.exp(-t * 3.2) * (t < 0.01 ? t / 0.01 : 1) * 0.5;
      }
    }
    return buf;
  }

  nearest(midi, layer) {
    let best = null;
    for (const s of this.samples) {
      if (s.layer !== layer) continue;
      const d = Math.abs(s.midi - midi) + (s.midi > midi ? 0.1 : 0);
      if (!best || d < best.d) best = { s, d };
    }
    return best && best.s;
  }

  /** mode 'stroke': start at the recording's attack point; 'slur': start inside the sustain. */
  makeVoice(midi, mode, fadeIn) {
    const ctx = this.ctx, now = ctx.currentTime;
    const v = { midi, out: ctx.createGain(), filt: ctx.createBiquadFilter(), layers: {}, start: now };
    v.filt.type = 'lowpass'; v.filt.frequency.value = 6000; v.filt.Q.value = 0.5;
    v.out.gain.setValueAtTime(0, now);
    v.filt.connect(v.out); v.out.connect(this.bus);
    for (const layer of ['p', 'f']) {
      const s = this.nearest(midi, layer);
      if (!s) continue;
      const src = ctx.createBufferSource();
      src.buffer = s.buffer;
      src.loop = true; src.loopStart = s.loopStart; src.loopEnd = s.loopEnd;
      src.playbackRate.value = midiToHz(midi) / midiToHz(s.midi + s.cents / 100);
      this.lfoGain.connect(src.detune);
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(g); g.connect(v.filt);
      const offset = (s.attack || 0) + (mode === 'slur' ? SLUR_SKIP : 0);
      src.start(now, Math.min(offset, s.loopStart - 0.05));
      v.layers[layer] = { src, g };
    }
    v.fadeIn = fadeIn;
    this.stats.voices++;
    return v;
  }

  killVoice(v, time = 0.06) {
    if (!v) return;
    const now = this.ctx.currentTime;
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setValueAtTime(v.out.gain.value, now);
    v.out.gain.linearRampToValueAtTime(0, now + time);
    for (const l of Object.values(v.layers)) {
      try { l.src.stop(now + time + 0.05); } catch { /* already stopped */ }
      setTimeout(() => { try { this.lfoGain.disconnect(l.src.detune); } catch { /* gone */ } }, (time + 0.2) * 1000);
    }
    setTimeout(() => { try { v.out.disconnect(); } catch { /* gone */ } }, (time + 0.2) * 1000);
  }

  /**
   * Apply the current playing state. Called every tracking frame (and every animation frame for the keyboard).
   * state: { note: {midi}, amp 0..1, dir, newStroke, vibDepth 0..1, vibRate }
   */
  update(state) {
    if (!this.loaded || !this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const midi = state.note.midi;
    const amp = Math.max(0, Math.min(1, state.amp || 0));
    const sounding = this.voice && this.lastAmp > 0.01;

    if (state.newStroke && amp >= 0) {
      // Fresh bow stroke: new voice from the start of the recording (its real bow attack).
      const old = this.voice;
      this.voice = this.makeVoice(midi, 'stroke', ATTACK_STROKE);
      this.killVoice(old, 0.05);
      this.accent(this.voice, amp);
      this.stats.attacks++;
    } else if (this.voice && midi !== this.voice.midi) {
      if (sounding) {
        // Slur: smooth crossfade into the new note, no new attack.
        const old = this.voice;
        this.voice = this.makeVoice(midi, 'slur', ATTACK_SLUR);
        // Equal-power crossfade: the two notes are different sounds, so this keeps the level even.
        const lvl = this.levelFor(this.lastAmp);
        const n = 16, fadeIn = new Float32Array(n), fadeOut = new Float32Array(n);
        const from = old.out.gain.value;
        for (let i = 0; i < n; i++) { const x = i / (n - 1); fadeIn[i] = lvl * Math.sin(x * Math.PI / 2); fadeOut[i] = from * Math.cos(x * Math.PI / 2); }
        this.voice.out.gain.cancelScheduledValues(now);
        this.voice.out.gain.setValueCurveAtTime(fadeIn, now, ATTACK_SLUR);
        this.voice.rampUntil = now + ATTACK_SLUR + 0.005;
        old.out.gain.cancelScheduledValues(now);
        old.out.gain.setValueCurveAtTime(fadeOut, now, ATTACK_SLUR);
        for (const l of Object.values(old.layers)) {
          try { l.src.stop(now + ATTACK_SLUR + 0.05); } catch { /* already stopped */ }
          setTimeout(() => { try { this.lfoGain.disconnect(l.src.detune); } catch { /* gone */ } }, (ATTACK_SLUR + 0.2) * 1000);
        }
        setTimeout(() => { try { old.out.disconnect(); } catch { /* gone */ } }, (ATTACK_SLUR + 0.25) * 1000);
        this.stats.slurs++;
      } else {
        // Silent: just retune so the next stroke starts on the right note.
        this.killVoice(this.voice, 0.02);
        this.voice = null;
      }
    } else if (!this.voice && amp > 0.02) {
      this.voice = this.makeVoice(midi, 'stroke', ATTACK_STROKE);
      this.accent(this.voice, amp);
      this.stats.attacks++;
    }

    const v = this.voice;
    if (v) {
      const level = this.levelFor(amp);
      if (!(v.rampUntil && now < v.rampUntil)) {
        // Open strings ring on a little longer when the bow stops, as on a real violin.
        const release = state.finger === 0 ? RELEASE * 2 : RELEASE;
        const tc = amp < this.lastAmp - 0.02 ? (amp < 0.01 ? release : 0.04) : (v.fadeIn ?? 0.03);
        v.out.gain.setTargetAtTime(level, now, tc);
        v.fadeIn = 0.03;
      }
      // Loud bow = more of the loud recording and a brighter tone.
      const fmix = Math.pow(amp, 1.3);
      if (v.layers.p) v.layers.p.g.gain.setTargetAtTime(Math.cos(fmix * Math.PI / 2), now, 0.03);
      if (v.layers.f) v.layers.f.g.gain.setTargetAtTime(Math.sin(fmix * Math.PI / 2), now, 0.03);
      if (!(v.rampUntil && now < v.rampUntil)) v.filt.frequency.setTargetAtTime(this.cutoff(amp), now, 0.04);
      if (amp < 0.01 && this.lastAmp >= 0.01) this.stats.releases++;
      // Free the voice after a long silence.
      if (amp < 0.005) { v.silentSince ??= now; if (now - v.silentSince > 2) { this.killVoice(v, 0.02); this.voice = null; } }
      else v.silentSince = null;
    }
    // Vibrato: up to +-28 cents on top of the recording's own gentle vibrato.
    this.lfoGain.gain.setTargetAtTime((state.vibDepth || 0) * 28, now, 0.08);
    // Real vibrato is never perfectly even: let the speed drift a little.
    const drift = 0.25 * Math.sin(now * 0.9) + 0.15 * Math.sin(now * 2.3 + 1);
    this.lfo.frequency.setTargetAtTime((state.vibRate || 5.5) + drift, now, 0.1);
    this.lastAmp = amp;
  }

  cutoff(amp) { return 2200 + 9000 * Math.pow(amp, 0.8); }

  /** The "bite" of a fresh bow stroke: a quick rise with a small overshoot and a brief brighter tone. */
  accent(v, amp) {
    const now = this.ctx.currentTime;
    const a = Math.min(0.85, Math.max(0.2, amp * 2));
    const peak = this.levelFor(a) * 1.15;
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setValueAtTime(0, now);
    v.out.gain.linearRampToValueAtTime(peak, now + ATTACK_STROKE);
    v.out.gain.setTargetAtTime(this.levelFor(Math.max(amp, a * 0.6)), now + ATTACK_STROKE, 0.05);
    v.filt.frequency.cancelScheduledValues(now);
    v.filt.frequency.setValueAtTime(this.cutoff(a) + 3500, now);
    v.filt.frequency.setTargetAtTime(this.cutoff(amp), now + 0.03, 0.05);
    v.rampUntil = now + 0.07;
    // Bow "catch": a very short, quiet burst of filtered noise, pitched a little with the note.
    const src = this.ctx.createBufferSource(); src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.value = 1800 + 25 * (v.midi - 55) * 10;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.05 * a, now + 0.004);
    g.gain.setTargetAtTime(0, now + 0.006, 0.02);
    src.connect(bp); bp.connect(g); g.connect(this.bus);
    src.start(now); src.stop(now + 0.15);
    src.onended = () => { try { g.disconnect(); } catch { /* gone */ } };
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  levelFor(amp) { return amp <= 0 ? 0 : 0.08 + 0.92 * Math.pow(amp, 1.4); }

  /** Current output level (RMS of the last ~20 ms), for tests and the debug view. */
  meter() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this._meterBuf);
    let ss = 0; for (const v of this._meterBuf) ss += v * v;
    return Math.sqrt(ss / this._meterBuf.length);
  }

  /** Output delay of the audio system itself, in ms. */
  latencyMs() {
    if (!this.ctx) return null;
    return ((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000;
  }
}
