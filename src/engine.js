// Game brain: takes tracking frames (or keyboard input) and decides what the violin is playing right now.
// No browser APIs: the clip tester and unit tests drive it directly.

import { STRINGS, noteFor, noteTable, slideNotes, midiName } from './music.js';
import {
  extractFeatures, OneEuro, StringSelector, FingerCounter, SlideSelector, BowTracker, VibratoDetector,
  DEFAULT_CALIBRATION, DEFAULT_TUNING,
} from './tracking-logic.js';

export const DEFAULT_SETTINGS = {
  key: 'D',
  mode: 'fingers',   // 'fingers' | 'slide'
  vibrato: true,
  debug: false,
  volume: 0.8,
  model: 'lite',     // pose model: 'lite' | 'full'
  showViolin: true,
  bowSensitivity: 1,  // >1: smaller/slower bowing already gives full volume
};

/**
 * A note picked on the piano strip: the matching violin note in this key if there is one (lowest string first),
 * otherwise the nearest place on the right string (shown as an approximate finger).
 */
export function noteForMidi(key, midi) {
  const t = noteTable(key);
  for (const st of STRINGS) for (const n of t[st]) if (n.midi === midi && !(n.finger === 4 && st !== 'E')) return n;
  const st = midi < 62 ? 'G' : midi < 69 ? 'D' : midi < 76 ? 'A' : 'E';
  let best = t[st][0];
  for (const n of t[st]) if (Math.abs(n.midi - midi) < Math.abs(best.midi - midi)) best = n;
  const name = midiName(midi).replace(/-?\d+$/, '');
  return { midi, name, octave: Math.floor(midi / 12) - 1, letter: name[0], string: st, finger: best.finger, outOfKey: true };
}

export class Player {
  constructor(settings = {}, calibration = {}, tuning = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.cal = { ...DEFAULT_CALIBRATION, ...calibration };
    this.tuning = { ...DEFAULT_TUNING, ...tuning };
    this.strings = new StringSelector();
    this.fingers = new FingerCounter();
    this.slide = new SlideSelector();
    this.bow = new BowTracker();
    this.vib = new VibratoDetector();
    this.elbowFilter = new OneEuro(1.2, 0.4);
    this.slideFilter = new OneEuro(1.5, 0.5);
    this.keyboard = { active: false, string: 1, finger: 0, bowDir: 0, loud: false, vibrato: false, strokeId: 0 };
    this._kbStroke = 0;
    this.state = this.blankState();
  }

  blankState() {
    return { t: 0, tracked: false, stringIndex: 1, string: 'D', finger: 0, note: noteFor(this.settings.key, 'D', 0),
      amp: 0, dir: 0, newStroke: false, strokes: 0, speed: 0, vibDepth: 0, vibRate: 5.5, features: null, source: 'none' };
  }

  /** Feed one tracking frame. Returns the new state. */
  update(frame) {
    const f = extractFeatures(frame);
    const t = frame.t;
    const s = { ...this.state, t, features: f, tracked: f.ok, newStroke: false, source: 'camera' };
    if (f.ok) {
      f.slideSmooth = this.slideFilter.filter(f.slideDist, t);
      // Ignore the body tracker's guesses for joints it can't really see (e.g. out of the picture).
      if (f.elbowVis >= this.tuning.minVisibility) {
        if (this.tuning.elbowSpace === '3d' && f.elbowRel3d != null) f.elbowRel = f.elbowRel3d;
        f.elbowSmooth = this.elbowFilter.filter(f.elbowRel, t);
        s.stringIndex = this.strings.update(f.elbowSmooth, this.cal, this.tuning);
      }
      if (f.extension) this.fingers.update(f.extension, this.cal, this.tuning, t);
      const bowSeen = f.bowVis >= this.tuning.minVisibility || f.bowXHand != null;
      const bowCal = { ...this.cal, bowFull: this.cal.bowFull / (this.settings.bowSensitivity || 1) };
      const b = this.bow.update(bowSeen ? this.bowPosition(f) : null, t, bowCal, this.tuning);
      s.amp = b.amp; s.dir = b.dir; s.speed = b.speed; s.newStroke = b.newStroke; s.strokes = this.bow.strokes;
      const v = this.vib.update(f.leftX, f.leftY, t);
      s.vibDepth = this.settings.vibrato ? v.depth : 0; s.vibRate = v.rate;
    } else {
      const b = this.bow.update(null, t, this.cal, this.tuning);
      s.amp = b.amp * 0.8; s.dir = b.dir;
      s.vibDepth *= 0.9;
    }
    this.pickNote(s, f);
    if (this.keyboard.active) this.applyKeyboard(s);
    this.state = s;
    return s;
  }

  /**
   * Bow hand position. With bowSource 'hand', the hand tracker's palm centre is used when seen; the gap between it
   * and the body tracker's wrist is tracked all the time so switching between them never makes the bow "jump".
   */
  bowPosition(f) {
    if (this.tuning.bowSource !== 'hand') return f.bowX;
    if (f.bowXHand != null) {
      const gap = f.bowXHand - f.bowX;
      this._bowGap = this._bowGap == null ? gap : this._bowGap + 0.1 * (gap - this._bowGap);
      return f.bowXHand;
    }
    return f.bowX + (this._bowGap || 0);
  }

  pickNote(s, f) {
    if (this.settings.mode === 'slide') {
      const notes = slideNotes(this.settings.key);
      const idx = this.slide.update(f && f.ok ? f.slideSmooth : null, notes.length, this.cal, this.tuning);
      const n = notes[idx];
      s.note = n; s.string = n.string; s.stringIndex = STRINGS.indexOf(n.string); s.finger = n.finger;
      s.slideIndex = idx; s.slidePos = this.slide.pos;
      s.glide = true;
    } else {
      s.glide = false;
      s.string = STRINGS[s.stringIndex];
      s.finger = this.fingers.count;
      s.note = noteFor(this.settings.key, s.string, s.finger);
    }
  }

  /** Keyboard play overrides the camera for string, finger and bow. */
  applyKeyboard(s) {
    const k = this.keyboard;
    s.source = 'keyboard';
    if (k.midi != null) {
      s.note = noteForMidi(this.settings.key, k.midi);
      s.string = s.note.string; s.stringIndex = STRINGS.indexOf(s.string); s.finger = s.note.finger;
    } else {
      s.stringIndex = k.string; s.string = STRINGS[k.string]; s.finger = k.finger;
      s.note = noteFor(this.settings.key, s.string, s.finger);
    }
    s.dir = k.bowDir;
    s.amp = k.bowDir ? (k.loud ? 0.95 : 0.55) : 0;
    s.speed = k.bowDir ? (k.loud ? 2 : 1) : 0;
    if (k.strokeId !== this._kbStroke) { this._kbStroke = k.strokeId; s.newStroke = k.bowDir !== 0; if (s.newStroke) s.strokes++; }
    if (k.vibrato && this.settings.vibrato) { s.vibDepth = 0.8; s.vibRate = 5.5; }
  }

  /** Keyboard-only tick when there is no camera frame. */
  tick(t) {
    const s = { ...this.state, t, newStroke: false, tracked: false };
    if (this.keyboard.active) this.applyKeyboard(s);
    else { s.amp = 0; s.dir = 0; }
    this.state = s;
    return s;
  }

  setSettings(p) { Object.assign(this.settings, p); }
  setCalibration(c) { this.cal = { ...DEFAULT_CALIBRATION, ...c }; }
}
