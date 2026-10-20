# Air Violin: build brief

You're working on your own until **18:30 UK time today**. I won't be around to answer questions, so make sensible
choices yourself and write them down in the progress log. Check the time with `TZ=Europe/London date`.
Save this brief as CLAUDE.md in the repo first, and keep the progress log at the bottom of it.

## Wake-ups (do this before anything else)
Usage limits sometimes stop you part-way. Use your tool for scheduling messages back into this same session to
schedule one every 30 minutes until 18:30 UK time. Each should say: "Wake-up check: if you stopped, read the
progress log in CLAUDE.md, check git status, and carry on from where you left off. If you're already working,
ignore this." If you have no such tool, say so at the top of the progress log and carry on anyway. Commit and push
after every small working step, and update the log as you go, so nothing is lost if you're cut off.

## The goal
A browser game where you play a violin in the air in front of your webcam. The webcam watches your arms and hands;
the game draws a violin and bow into your hands on screen and plays realistic violin sound from your movements.
**Free play only**: the player chooses every note. Published on GitHub Pages from this repo. Built mainly for a
laptop webcam; on a phone it should still work in landscape with bigger text and a "prop your phone up" hint.

The player reads music and plays piano but has never played the violin, so the screen must always make it obvious
which note they're playing.

## How playing works (these decisions are made; follow them)
Camera: facing the player, picture mirrored like a mirror, upper body in shot.

- **Pose:** left hand up near the left shoulder (where a violin's neck would be), palm facing the camera. Right
  hand holds an imaginary bow (or a stick) and moves side to side across the body.
- **Which string (G, D, A, E):** chosen by how high the right elbow is compared with the right shoulder, as on a
  real violin: elbow highest = G, lowest = E. Four zones, measured relative to shoulder width so it works at any
  distance. Add "stickiness" (hysteresis) so it doesn't flicker between strings at the zone edges.
- **Which note on the string ("Fingers" mode, the default for now):** the number of left-hand fingers folded down,
  0 to 4. An open hand (all fingers up) = open string; folding index, middle, ring, little = 1, 2, 3, 4. Count
  folded fingers and ignore the thumb. A count must hold steady for about 2 frames before the note changes
  (accuracy matters more than speed here).
- **Notes:** first-position violin notes in the chosen key. Default key D major: G string G A B C♯ D, D string
  D E F♯ G A, A string A B C♯ D E, E string E F♯ G A B. Key menu: C, G, D, A, F and B♭ major at least.
- **Bowing:** right wrist movement drives the sound. Bow speed sets the loudness (smooth, not stepped). Changing
  bow direction starts a fresh stroke (a new attack). Changing the note mid-stroke slurs smoothly into the new note
  without a new attack. Stopping the bow lets the note fade naturally over a short moment.
- **Vibrato:** a small, quick wobble of the left hand adds vibrato. Optional in settings.
- **Calibration** at the start (skippable after the first time, saved in localStorage): hold the pose still for
  3 seconds, then bow on the highest and lowest strings so the game learns your range.
- **"Slide" mode (backup, built as a setting from the start):** instead of counting fingers, slide the left hand
  along an imaginary neck: the further the hand from the left shoulder, the higher the note, snapping to the 20
  notes above (G up to B in the chosen key). Real test clips in a later session will decide which mode becomes the
  default; until then, Fingers is the default.

## What's on screen
- The mirrored webcam picture with a 3D violin under the chin following the left shoulder and hand, and a bow in
  the right hand following its angle and movement. The string being played glows. Original designs only.
- A **piano keyboard strip** along the bottom that lights up the note being played, plus the note name, which
  string, and the finger count, in big text.
- A help screen with the string/finger note table for the current key.
- A **debug view** (toggle in settings and at `?debug=1`): skeleton and hand points drawn over the video, all the
  numbers (elbow height, zone, finger count, bow speed), and the frame rate and delay.
- **Keyboard controls for testing without a camera:** keys for strings, fingers and bowing, so the sound can be
  checked and played even with no webcam.

## Sound
Realistic violin built from real recordings with a licence that allows reuse (for example the VSCO 2 Community
Edition samples, if their licence checks out; verify and record it). Long sustained notes that loop smoothly,
volume following bow speed, proper attacks on new strokes, smooth slurs, vibrato. Use the browser's audio system
with as little delay as possible. Measure the delay from movement to sound and log it.

## Tracking
Use well-known open-source in-browser body and hand tracking (for example Google's MediaPipe pose and hand
landmarkers, Apache 2.0 licence). Copy the library and model files into `vendor/` so nothing loads from the internet
at runtime. If this environment can't download them, make a GitHub Actions workflow that fetches them and commits
them, then pull them down; say in the log which route you used.

## Test clips: NOT this session
There are **no real test clips yet, so don't wait for or ask for any**. Build and test everything with synthetic
data (fake arm and hand movements you generate in code) for now.

In a later session I'll upload short webcam clips of myself directly into the session. Get ready for that now:
build a clip-testing script (`scripts/clip-test.mjs` or similar) that takes a folder path **outside the repo**, runs
the tracking over every video in it, and reports how often the string and finger count were right, using labels
from the file names (for example `string-G.mp4`, `fingers-3.mp4`, `still.mp4`, `changes.mp4`, `slide.mp4`). Write
`CLIPS.md` explaining how a future session should use it: tune the thresholds, stickiness and calibration until
accuracy is as high as possible, log accuracy before and after per clip, and if finger counting is right in under
about 85% of steady frames after tuning, make Slide the default mode.

## Privacy and safety (very important)
- The game never uploads, records or saves webcam video. Everything is processed on the player's device.
- **Rules for test clips (now and in future sessions):** clips must be stored only in a folder outside the repo
  (for example `~/private-clips/`), never inside the repo folder. Never commit, publish or screenshot clips,
  frames from them, or anything extracted from them (tracked points, measurements), and never put them on the
  GitHub Pages site or in test output. Write these rules into CLIPS.md too, so future sessions follow them.
- Keep `screenshots/` and any test output folders in `.gitignore`. Screenshots of the game must use a blank or
  fake camera feed.
- The automated tests in this public repo use synthetic data only.
- Only use assets with a licence that allows reuse (CC0, CC-BY, Apache, MIT); list each in CREDITS.md.
- No network requests while playing, no tracking, no cookies, no eval, no secrets. Only localStorage (in try/catch).
- Plain ES modules, no build step, Three.js and the tracking library copied into `vendor/`, an import map in
  index.html. Only well-known npm packages.
- Keep it working after every commit. If something breaks, undo it rather than stacking fixes on top.
- GitHub Actions: run the tests on every push to `main` and deploy to Pages only if they pass.

## How to check your work (before every commit)
1. Run the tests (headless Chromium with a fake camera): no console errors, the page loads, calibration and
   settings work, and synthetic movement data produces the right string, finger count, note and sound behaviour.
2. Take screenshots (with the fake camera) and look at them; fix anything ugly.
3. Commit with a clear message, one feature per commit, and push to `main`.

## Order of work
1. Setup: repo structure, vendored libraries and tracking models, tests with a fake camera, deploy workflow,
   privacy rules in `.gitignore`. Get a first version live quickly.
2. Tracking core and the debug view, with synthetic test data.
3. Sound engine, playable with the keyboard controls.
4. The main play screen: strings, fingers, notes, bowing, calibration, piano strip.
5. Slide mode.
6. The clip-testing script and CLIPS.md, ready for later.
7. The 3D violin and bow drawn into the hands.
8. Polish: vibrato, sound realism, lower delay, settings, help screen, phone layout.
9. If all that's done early, keep refining whatever would make it feel most like really playing.

## At the end
At about 18:25 UK time, stop starting new work, make sure `main` is deployed and working, and write a short summary
in plain English: what works, what was tested and how, the link to the live game, what isn't done, and the best
ideas for next time.

---

# Progress log

Newest entries at the bottom. Times are UK time.

- **13:45** Started. Repo was empty. Wake-ups scheduled with the `send_later` tool: one every 30 minutes,
  14:15 to 18:15 UK time.
- **13:50** Downloads work directly from this environment (npm, Google's model storage, raw GitHub), so the
  libraries and models were copied into `vendor/` directly (no GitHub Actions fetch workflow needed):
  `@mediapipe/tasks-vision` 1.1.1 (Apache 2.0), `three` 0.186.1 (MIT), pose landmarker lite + full and hand
  landmarker models (Apache 2.0).
- **13:50** Sound: VSCO 2 Community Edition, Solo Violin "Arco Vib" samples. Licence checked: the repo's LICENSE
  file is CC0 1.0 Universal. Only vibrato sustains exist for the solo violin (no non-vibrato sustains), so the
  base sound always has a gentle natural vibrato; the "wobble" vibrato adds extra pitch wobble on top.
  `scripts/prep-samples.py` turns them into 22 small mono WAVs (G3 to C6, soft and loud layers) with baked
  crossfade loops and a tuning correction measured per file.
- **Branches:** the brief says push to `main`; this session was also given `claude/gracious-sagan-ajnctq`. I work
  on `main` and push the same commits to both, so nothing is lost and Pages deploys from `main`.
- **14:05** First playable version pushed: tracking logic (`src/tracking-logic.js`), game brain (`src/engine.js`),
  sound engine (`src/audio.js`), play screen with piano strip, note panel, help table, settings, calibration,
  keyboard controls and debug view (`src/main.js`). Tests: 14 Node unit tests on synthetic data + 7 browser tests in
  headless Chromium with Chromium's fake camera. All pass. Decisions:
  - Slide mode uses the **17 distinct pitches** from open G to B on the E string (the 20 string/finger slots include
    3 duplicates, e.g. 4th finger on G = open D), so every slide position is a different note.
  - All four open strings follow the key signature too (e.g. in B♭ major the E string's open note becomes E♭) so
    every note on the table is in the chosen key. Keys: C, G, D, A, E, F, B♭, E♭ major.
  - Left/right hands are matched to the body's wrists by distance rather than trusting the hand model's labels
    (those assume a mirrored picture).
  - Bow direction "down bow" = right hand moving to the player's right.
  - Page has a strict Content-Security-Policy (only same-origin scripts, `wasm-unsafe-eval` for MediaPipe's
    WebAssembly, a hash for the import map), which also blocks any network request to other sites.
  - `?demo=1` runs a pretend player (synthetic data) without a camera; `?test=1` exposes a hook for tests.
- **14:15** Clip tester ready: `scripts/clip-test.mjs` + `tools/clip-runner.html` + `CLIPS.md`. Tested end to end on
  computer-generated test-pattern videos in the scratchpad (no person, so 0% body found, as expected). CPU delegate
  runs ~10 frames/s headless. Refuses folders inside the repo; prints totals only.
