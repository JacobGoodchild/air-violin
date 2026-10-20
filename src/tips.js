// "First steps" coach shown once after calibration: each tip ticks itself off when the player does it.
// Pure logic (fed the game state each frame); the page only shows the current text.

export const TIPS = [
  { id: 'bow', text: 'Bow side to side with your right hand. Hear that? Faster = louder.' },
  { id: 'finger', text: 'Now fold your index finger down while you bow: the note goes up one step.' },
  { id: 'string', text: 'Raise or lower your right elbow while bowing to change string (higher elbow = lower string).' },
  { id: 'done', text: 'That\'s it! Play freely. Press Help (H) to see every note.' },
];

export class Tips {
  constructor() { this.step = 0; this.held = 0; this.lastT = null; this.startString = null; this.finished = false; }
  get current() { return TIPS[this.step]; }

  update(s, t) {
    if (this.finished) return;
    const dt = this.lastT == null ? 0 : Math.min(100, t - this.lastT);
    this.lastT = t;
    const sounding = s.amp > 0.08;
    const id = this.current.id;
    let ok = false;
    if (id === 'bow') ok = sounding;
    else if (id === 'finger') ok = sounding && s.finger >= 1;
    else if (id === 'string') {
      if (this.startString == null) this.startString = s.stringIndex;
      ok = sounding && s.stringIndex !== this.startString;
    }
    // Each tip needs the move held for 0.6 s; the last one just shows for 4 s.
    if (id === 'done') this.held += dt;
    else this.held = ok ? this.held + dt : 0;
    const need = id === 'done' ? 4000 : 600;
    if (this.held >= need) {
      this.held = 0;
      if (this.step < TIPS.length - 1) this.step++;
      else this.finished = true;
    }
  }
}
