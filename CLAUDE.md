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
- **14:20** Done since last entry:
  - 3D violin and bow (`src/violin3d.js`, original shapes built in code: flamed-maple body, f-holes, fingerboard,
    scroll, pegs, bridge, chinrest, strings, bow with frog/hair/tip). Violin runs from under the chin towards the
    left hand; bow frog sits in the right hand and the stick passes over the playing string; that string glows and
    shimmers with loudness. Without a camera it rests in the middle of the screen and the bow moves with the keys.
  - Sound loops: each recording's loop now uses its steadiest 2.2-3.2 s stretch, with loudness evened out
    (±6 dB max) so held notes don't swell and fade by themselves; waveform-matched loop points.
  - Bow detection made steadier against tracking jitter (one-euro smoothing 1.0 Hz, stroke threshold 0.3
    shoulder widths/s). Synthetic jitter test: 0 false strokes in 20 s at realistic jitter.
  - Slide mode: extra calibration step ("stretch your hand out") and a position bar with tick marks per note.
- **Delay measurements (synthetic + headless Chromium):**
  - Game decision after the bow starts moving (hand speeding up to 1.2 shoulder widths/s over 150 ms): **~133 ms**
    at 30 fps (100 ms for a brisk bow, ~200 ms for a very slow one). Direction change to new stroke: 67-117 ms.
  - Audio output delay (Web Audio, `latencyHint: 'interactive'`): base 10 ms + output 32 ms in headless Chromium.
  - Camera + tracking: can't be measured meaningfully here (headless uses software graphics: ~1 s per frame). On a
    real laptop expect roughly 30-60 ms; the debug view (`?debug=1`) shows live tracking time, camera delay, audio
    delay and a total "camera-to-sound" estimate for the real device.
- **14:40** More polish: stance picture on the start screen, bow-contact glow, screen wake lock, sound resumes after
  switching tabs, equal-power slurs, open strings ring a little longer when the bow stops, note name shown on the lit
  piano key, finger/note bubble above the left hand, calibration guides drawn on the video (circle for the left
  hand, arrows for the elbow), calibration card moved to the bottom-left so it doesn't cover the player.
  First-time calibration: Skip appears only after 20 s (the brief says skippable *after the first time*; this is an
  escape hatch if tracking struggles, and calibration is offered again next time).
  - New strokes: the soft recordings swell in slowly (up to 1.8 s), so strokes now start each recording at the point
    it reaches 60% of its sustain level, with a short accent (quick rise, small overshoot, brief brighter tone).
  - Audio output test reads the real output level: half volume ~70 ms after a stroke starts, steady held note
    through the loop point, gradual fade after the bow stops.
  - **Finger measure changed:** from "straightness" to "extension along the palm direction", because a finger bent
    down only at the knuckle stays straight and was invisible to the old measure. Thresholds: folded below 50% of the
    open-hand value, open again above 62%. A relaxed, slightly curled open hand stays "open". These are the first
    things to tune with real clips (see CLIPS.md).
- **14:40 Privacy fix:** found that MediaPipe Tasks has built-in usage logging that POSTs to
  `odml.pa.googleapis.com` every 60 s and when a model closes. The page's Content-Security-Policy already blocked it
  (so nothing ever left the device), but it was still trying. `scripts/patch-vendor.mjs` now switches that logging
  off in `vendor/mediapipe/vision_bundle.mjs` (re-run it after any MediaPipe update), and `tests/privacy.test.mjs`
  checks the patch, the CSP, no eval / outside addresses / other storage in the game code, and that no video files
  are in the repo. Also: switching the tracking model while playing now frees the old models.
- **14:55** Measured: sound reaches half volume 20-40 ms after the engine starts a stroke. Added: a small hand in the note panel showing which fingers the camera sees folded; the piano strip is
  playable (press and hold a key, mouse or touch; notes outside the key still play and say "Not in D major");
  optional `bowSource: 'hand'` tuning for the clip session. Slip: one commit went out with a timing-flaky test
  (my commit command didn't stop on failure); CI caught it and skipped that deploy, fixed in the next commit and
  my commit step now refuses to commit unless the output says `fail 0`. Live site checked in headless Chromium
  through the proxy: loads, plays, no console errors, no requests to other sites.
- **15:25** Added: tracking status chips in the top bar (Body / Left hand / Bow hand, green when seen), distance
  hints (too close / too far), the help table's notes are playable, "Play without camera" (keyboard or touch on the
  piano strip), download progress % while the ~35 MB of tracking files load, purfling line on the violin, a faint
  bow "catch" noise at stroke starts, slightly drifting vibrato speed, a "how to record the clips" guide in
  CLIPS.md, fuller README. Tests now close their pages even after a failure (one failure had cascaded into two
  more because a heavy tracking page kept running).
- **15:30 Checked against real tracker output** (no clips needed): ran the vendored MediaPipe models on MediaPipe's
  own Apache-2.0 test photos (kept in the scratchpad, not committed). Findings:
  - Convention confirmed: for a person facing the camera, pose landmark 11 (left shoulder) is on the image's right
    (x 0.54 vs 0.45), as the code assumes.
  - The hand model labelled every hand "Right" (open, fist, pointing, victory, thumbs up), so ignoring its
    left/right label and matching hands to the pose wrists was the right call.
  - Finger extension on image points: open fingers 0.88-0.99, folded -0.2 to -0.42 (a wide gap). On the 3D "world"
    points open fingers were only 0.60-0.77, too close to the unfold threshold, so finger counting now uses the
    image points. Calibration's open-hand floor lowered to 0.7.
  - The hand numbers from those photos are now a test fixture (`tests/fixtures/mediapipe-test-hands.json`, numbers
    only, listed in CREDITS.md): fist = 4, open hands = 0, pointing up = 3, victory = 2, thumbs up = 4. All pass.
- **15:43** Clip tester reworked for speed: each clip is tracked once; the points stay in the script's memory only
  (never written or printed) and the game's own logic is replayed over them in Node. `--sweep` tries 216 setting
  combinations (fold thresholds, steadiness frames, string stickiness, 2D vs 3D elbow height, pose vs hand for the
  bow) in seconds and prints the best. Tested on synthetic "clips" (computer-made frames). New tuning options for
  that session: `elbowSpace: '3d'` (elbow height from MediaPipe's 3D body coordinates, which shouldn't change if
  the player turns a little; axis directions checked on a MediaPipe test photo) and `minVisibility` (ignore joints
  the tracker can't really see: the string stays, the bow counts as lifted).
- **15:50** Tuning: re-measured each recording's pitch over its looped part with 60 ms windows (robust to the
  recordings' own vibrato) and use that for the per-file tuning correction (changes of up to 4 cents vs before).
  Note: the open-G recordings have almost no vibrato (as on a real violin, an open string can't be vibrated).
  (Log times before this entry were a few minutes ahead of the clock; from here they're read from the clock.)
- **15:48** New test plays all 20 D-major notes through the real sound engine and measures the output pitch: worst 5.9 cents off, average 2.8 cents.
- **15:58** Layout: note panel moved to the top-right (usually empty background beside the head) so it no longer hides the bowing arm or the string guide; hints moved to the bottom centre (top during calibration); finger chips now show each finger's note on the current string (O=D, 1=E, 2=F♯…); phone panel made more compact; phones get a 'prop your phone up' hint when the camera starts.
- **16:04** End-to-end check with real MediaPipe output (MediaPipe's test photos, scratchpad only): the whole game brain runs on it without problems. Arms held out level -> elbow height +0.13 (2D) / +0.04 (3D) -> G string; arms hanging down -> -0.80 / -0.79 -> E string. So the default range (G -0.1, E -0.8) fits real bodies, and 2D/3D agree for someone facing the camera. Violin sounds and tracking files now download at the same time.
- **16:12** Slide mode now glides between notes (short pitch slide on note changes while bowing). Debug numbers moved to bottom-left. CI fix: the deploy workflow cancelled running deploys whenever I pushed again (I push every few minutes, CI takes ~4), so the live site lagged behind; now a running deploy always finishes and only the newest waiting run is kept.
- **16:25** Added: Bow sensitivity setting, vibrato tag in the note panel, M to mute, reduced-motion support, help
  explains the status chips. CI note: one deploy failed inside GitHub's own deploy step ("no artifact found" right
  after uploading it): a GitHub hiccup, the tests had passed and the next run deployed fine.
- **16:48 Bug found and fixed** by hunting an intermittent test failure: two note changes within ~70 ms could make
  the sound engine's crossfade clash with the next volume change, and the browser threw an error. Worse, in the live
  game that error would have propagated into the camera loop and **stopped tracking for good**. Fixed three ways:
  crossfades now use a scheduling method that can't clash; the sound engine catches its own errors; the tracking
  loop always requests the next frame first, so nothing inside a frame can stop it. New stress test changes the
  note on every frame in both modes. Also: hands are found by body side if the body tracker's wrist guess is off.
- **17:10** Added a one-time 'first steps' coach after the first calibration: bow side to side, fold your index finger, change string with your elbow; each step ticks itself off when the camera sees it (or 'Got it, hide tips'). Free play is never blocked.

## End-of-day summary (plain English)

**Play it:** https://jacobgoodchild.github.io/air-violin/ (deployed from `main` by GitHub Actions after the tests pass).

**What works**
- Start with the camera: the game tracks your body and hands on your own device (MediaPipe), draws a 3D violin from
  your chin to your left hand and a bow in your right hand, and plays real solo-violin recordings (VSCO 2, CC0).
- Right elbow height picks the string (G high … E low) with stickiness; folded left-hand fingers (0-4, thumb
  ignored, 2 steady frames) pick the note; bow speed sets the volume smoothly; changing bow direction gives a new
  stroke with a real-sounding attack; changing note while bowing slurs; stopping lets the note fade (open strings
  ring a bit longer); a small quick wobble of the left hand adds vibrato.
- Always clear which note you're on: big note name, string, a row showing the note each finger gives, a little
  hand showing which fingers the camera sees folded, a bubble above your left hand, and the lit piano key.
- Calibration (hold still, bow with the elbow high, then low; plus a reach step in Slide mode), saved in the
  browser; first-time Skip appears after 20 s. Slide mode (hand distance along the neck, 17 notes G to B, with a
  glide between notes) is in Settings. Keys: C, G, D, A, E, F, B♭, E♭ major.
- No camera? Keyboard (G D A E, 0-4, Space/arrows to bow, Shift louder, V vibrato, M mute) or press and hold the
  piano keys or the notes in the help table.
- First-time players get a short self-ticking "first steps" coach after calibration.
- Debug view (`?debug=1` or Settings): skeleton, hand points, all the numbers, frame rate and delays.
- Phone in landscape: bigger, compact layout, "turn sideways" and "prop your phone up" hints.
- Privacy: nothing leaves the device. Strict Content-Security-Policy; MediaPipe's built-in usage logging switched
  off; no cookies; only settings/calibration in localStorage.

**How it was tested** (no real clips existed, so synthetic data plus some real tracker output)
- 43 automated tests run on every push: game logic on computer-made arm/hand movements (strings, fingers, notes,
  stickiness, steadiness, bow strokes, slurs, fades, vibrato, Slide mode, calibration, delay, jitter), the
  browser game in headless Chromium with Chromium's fake camera (page loads with no errors and no outside requests,
  keyboard and piano play, settings, calibration, tracking models load and run, model switching, phone layout),
  the sound engine's real output (attack speed, steady held notes through the loop, fades, every note's pitch
  within 6 cents, stress test of note changes every frame) and privacy rules.
- Finger counting checked on real MediaPipe output from MediaPipe's own test photos (fist, open hands, pointing,
  victory, thumbs up: all counted right), and the left/right and up/down conventions checked on a photo of a person.
- Screenshots looked at after each visual change (fake camera / pretend player only). The live site was checked in
  headless Chromium: it loads, plays, tracks the fake camera, no errors, no outside requests.

**Delays measured**: game reacts ~100-130 ms after the bow starts moving (that includes the hand speeding up);
sound reaches half volume 20-40 ms after a stroke starts; audio output delay ~40 ms. Camera + tracking time on a real
laptop couldn't be measured here (no GPU); the debug view shows it live.

**Not done / not known yet**
- Nothing has been tested with a real person on a real webcam yet: thresholds are sensible defaults, not tuned.
  The clip tester (`scripts/clip-test.mjs`, `CLIPS.md`) is ready for that, including an automatic settings sweep.
- Fingers vs Slide default is still Fingers, pending the 85% rule on real clips.
- Tracking runs on the main thread (no Web Worker); no left-handed mode; only two loudness layers of recordings.

## Ideas for next time (kept up to date)
1. **Real clips first**: record the set in CLIPS.md, run `node scripts/clip-test.mjs ~/private-clips --sweep`, put
   the best values into `DEFAULT_TUNING`, decide Fingers vs Slide (85% rule).
2. Compare `elbowSpace: '3d'` (turn-proof elbow height) and `bowSource: 'hand'` on the clips; make them default
   if they win.
3. Move tracking into a Web Worker (OffscreenCanvas) so drawing never competes with tracking; would cut delay a bit.
4. More sound: a middle loudness layer, spiccato recordings (VSCO has them) for very short strokes, a proper
   recorded room impulse instead of the synthetic one.
5. Left-handed mode (mirror the roles of the arms).
6. If finger counting stays shaky with real clips: count fingers from the angle at the middle knuckle as a
   second opinion, or require the palm to face the camera.
