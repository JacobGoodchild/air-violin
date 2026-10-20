# Air Violin

Play a violin in the air in front of your webcam. Your webcam watches your arms and hands, the game draws a violin and
bow into your hands and plays real violin recordings from your movements.

**Play it:** https://jacobgoodchild.github.io/air-violin/

- Right elbow high or low picks the string (high = G, low = E).
- Fold left-hand fingers (0–4) to pick the note. Or switch to "Slide" mode in Settings.
- Bow side to side with your right hand: faster = louder.
- No camera? Press "Play with keyboard only": `G D A E` strings, `0`–`4` fingers, hold `Space` to bow.

Privacy: everything runs on your device. Video is never uploaded, recorded or saved. No cookies, no tracking.

Developers: `npm ci && npm test` (headless Chromium with a fake camera), `npm run serve` for a local server.
`?debug=1` shows the tracking numbers, `?demo=1` runs a pretend player with no camera. Clip testing: see `CLIPS.md`.
Credits: see `CREDITS.md`.
