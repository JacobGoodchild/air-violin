# Air Violin

Play a violin in the air in front of your webcam. The webcam watches your arms and hands; the game draws a 3D violin
and bow into your hands and plays real violin recordings from your movements.

**Play it:** https://jacobgoodchild.github.io/air-violin/

## How to play

- **Left hand** up by your left shoulder, palm facing the camera. Fold fingers down to change note: open hand =
  open string, fold index, middle, ring, little finger = 1, 2, 3, 4 fingers (the thumb doesn't count).
- **Right elbow** high or low picks the string: highest = G (lowest notes), lowest = E (highest notes).
- **Right hand** bows side to side: faster = louder. Change direction for a new stroke; change fingers while
  bowing to slur. Stop and the note fades.
- **Vibrato:** a small, quick wobble of your left hand.
- **Slide mode** (Settings): slide your left hand along the neck instead of folding fingers.
- The screen always shows the note: big note name, string and finger count, a lit piano key, and a bubble over
  your left hand. Help (`H`) shows the whole note table for the chosen key (C, G, D, A, E, F, B♭, E♭ major).

No camera? Press **Play without camera**: `G D A E` pick the string, `0`–`4` fingers, hold `Space` (or `←`/`→`)
to bow, `Shift` louder, `V` vibrato. Or press and hold the piano keys or the notes in the help table.

## Privacy

Everything runs on your device. Video is never uploaded, recorded or saved. No cookies, no tracking, no requests to
other sites (enforced by the page's Content-Security-Policy; MediaPipe's built-in usage logging is switched off).
Only your settings and calibration are saved, in your browser's local storage.

## For developers

- Plain ES modules, no build step. Libraries and models are in `vendor/` (see `CREDITS.md`).
- `npm ci && npm test`: unit tests plus headless Chromium tests with a fake camera and synthetic movement data.
- `npm run serve` starts a local server on port 8080. `?debug=1` shows tracking points and numbers (including
  delays), `?demo=1` runs a pretend player with no camera.
- `node scripts/screenshot.mjs "?demo=1" demo.png` takes a screenshot into `screenshots/` (git-ignored).
- Real-clip testing and tuning: see `CLIPS.md` (clips stay outside the repo, always).
- Pushing to `main` runs the tests on GitHub Actions and deploys to GitHub Pages only if they pass.
