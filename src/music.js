// Notes, keys and first-position fingerings. Pure functions, no browser APIs.

export const STRINGS = ['G', 'D', 'A', 'E'];

// Natural letters for open string + fingers 1-4 in first position.
const STRING_LETTERS = {
  G: [['G', 3], ['A', 3], ['B', 3], ['C', 4], ['D', 4]],
  D: [['D', 4], ['E', 4], ['F', 4], ['G', 4], ['A', 4]],
  A: [['A', 4], ['B', 4], ['C', 5], ['D', 5], ['E', 5]],
  E: [['E', 5], ['F', 5], ['G', 5], ['A', 5], ['B', 5]],
};

const LETTER_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Key signatures: letter -> +1 (sharp) or -1 (flat).
export const KEYS = {
  'C': { label: 'C major', acc: {} },
  'G': { label: 'G major', acc: { F: 1 } },
  'D': { label: 'D major', acc: { F: 1, C: 1 } },
  'A': { label: 'A major', acc: { F: 1, C: 1, G: 1 } },
  'E': { label: 'E major', acc: { F: 1, C: 1, G: 1, D: 1 } },
  'F': { label: 'F major', acc: { B: -1 } },
  'Bb': { label: 'B♭ major', acc: { B: -1, E: -1 } },
  'Eb': { label: 'E♭ major', acc: { B: -1, E: -1, A: -1 } },
};
export const KEY_ORDER = ['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Eb'];
export const DEFAULT_KEY = 'D';

function accName(a) { return a > 0 ? '♯' : a < 0 ? '♭' : ''; }

/** One note: { midi, name ('F♯'), octave, letter, string, finger } */
export function noteFor(key, string, finger) {
  const k = KEYS[key] || KEYS[DEFAULT_KEY];
  const [letter, octave] = STRING_LETTERS[string][finger];
  const acc = k.acc[letter] || 0;
  const midi = 12 * (octave + 1) + LETTER_SEMI[letter] + acc;
  return { midi, name: letter + accName(acc), octave, letter, string, finger };
}

/** Table: { G: [5 notes], D: [...], A: [...], E: [...] } */
export function noteTable(key) {
  const t = {};
  for (const s of STRINGS) t[s] = [0, 1, 2, 3, 4].map(f => noteFor(key, s, f));
  return t;
}

/**
 * Notes for Slide mode: every distinct first-position pitch from open G up to B on the E string
 * (the 20 string/finger slots minus the 3 duplicates where finger 4 equals the next open string).
 * Each note keeps the string/finger it is normally played with (lowest finger wins).
 */
export function slideNotes(key) {
  const out = [];
  const seen = new Set();
  for (const s of STRINGS) {
    for (let f = 0; f <= 4; f++) {
      const n = noteFor(key, s, f);
      if (seen.has(n.midi)) continue;
      // Prefer the open string of the next string over finger 4 of the previous one.
      if (f === 4 && s !== 'E') continue;
      seen.add(n.midi);
      out.push(n);
    }
  }
  return out.sort((a, b) => a.midi - b.midi);
}

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export function midiName(midi) {
  return SHARP_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

export function isBlackKey(midi) {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

export function midiToHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
