# Testing with real webcam clips

This is for a future session, once the player has recorded short webcam clips of themselves. Until then all tests
use synthetic (computer-made) movement data.

## Privacy rules (always follow these, in every session)

1. **Clips live only in a folder outside the repo**, for example `~/private-clips/`. Never copy, move or save a clip
   anywhere inside the repo folder. `scripts/clip-test.mjs` refuses to run on a folder inside the repo.
2. **Never commit, push or publish** clips, single frames from them, screenshots of them, or anything extracted from
   them (tracked body/hand points, per-frame measurements, per-frame decisions). Only overall accuracy percentages
   may be written to the progress log.
3. **Never put clip material on the GitHub Pages site or in test output.** The automated tests in this public repo
   use synthetic data only. `screenshots/` and test output folders are git-ignored; screenshots of the game must use
   a blank or fake camera feed, never a clip.
4. The clip tester converts each clip to a temporary WebM in the system temp folder (outside the repo) and deletes it
   straight after. It prints only totals to the terminal.
5. When finished, leave the clips where the player put them. Don't upload them anywhere.

## How to record the clips (for the player)

- Use the same laptop webcam you'll play with, in your normal room and lighting (light in front of you, not behind).
- Sit or stand so your head, both shoulders, both elbows and both hands are in the picture, about where you'd play.
- Hold the pose from the game: left hand up by your left shoulder, palm towards the camera; right hand bowing
  side to side (a pencil or chopstick as a bow is fine).
- Each clip: about **10 to 15 seconds**, any common format (.mp4, .mov, .webm). Record with the camera app
  (not mirrored is fine: the tester doesn't care).
- Suggested set (about 15 clips, under 5 minutes in total):
  `calibrate.mp4` (do the 3 calibration steps: still 3 s, elbow high bowing 4 s, elbow low bowing 4 s),
  `string-G.mp4`, `string-D.mp4`, `string-A.mp4`, `string-E.mp4` (bowing on one string, open hand),
  `fingers-0.mp4` … `fingers-4.mp4` (while bowing on the D or A string),
  `still.mp4` (pose held, not bowing), `changes.mp4` (play freely), `slide.mp4` (Slide mode movement).
- Put them in a folder **outside** the repo, e.g. `~/private-clips/`, and tell the next session where they are.

## Naming the clips

Labels come from the file names (any of .mp4 .webm .mov .mkv .m4v):

| File name | What the player does | What is checked |
|---|---|---|
| `calibrate.mp4` | The calibration routine: hold the pose 3 s, bow 3+ s with the elbow high (G), then 3+ s low (E) | Run first; its learned calibration is used for all other clips |
| `string-G.mp4`, `string-D.mp4`, `string-A.mp4`, `string-E.mp4` | Bows on one string the whole clip | % of steady frames on the right string |
| `fingers-0.mp4` … `fingers-4.mp4` | Holds that many fingers folded the whole clip (while bowing) | % of steady frames with the right finger count (and the raw, unsmoothed count) |
| `string-A-fingers-2.mp4` | Both | Both |
| `still.mp4` | Holds still, not bowing | No bow strokes, no sound, no flicker |
| `changes.mp4` | Moves between strings and fingers | Number of changes (add a labels file for accuracy) |
| `slide.mp4` | Slide mode: hand moves slowly along the neck from near the shoulder to far | Range of notes reached, number of changes |

Optional labels file next to a clip, `<clip name>.labels.txt`, one line per time range:
`start_seconds end_seconds string finger` (use `-` for "don't check"), for example:

```
0.0 2.0 G 0
2.0 4.5 G 2
4.5 7.0 A -
```

The first second of every clip is skipped (settling in). Frames where no body is seen are not counted as right or
wrong but are reported as tracking coverage ("body", "leftHand").

## Running it

```
npm ci                       # first time only
node scripts/clip-test.mjs ~/private-clips
node scripts/clip-test.mjs ~/private-clips --model full
node scripts/clip-test.mjs ~/private-clips --tuning '{"foldRatio":0.68,"unfoldRatio":0.8,"stableFrames":3}'
node scripts/clip-test.mjs ~/private-clips --calibration /path/outside/repo/cal.json
```

Options: `--model lite|full` (pose model), `--fps 30`, `--mode fingers|slide`, `--tuning '<json>'`,
`--calibration <json file>`, `--delegate CPU|GPU` (CPU is faster in headless Chromium).

Tunable values (defaults in `src/tracking-logic.js`, `DEFAULT_TUNING`):

| Name | What it does |
|---|---|
| `stringStickiness` | How far past a zone edge the elbow must go before the string changes (fraction of a zone) |
| `foldRatio` / `unfoldRatio` | A finger counts as folded when its extension drops below `open × foldRatio`, and unfolded again above `open × unfoldRatio` |
| `stableFrames` | How many frames in a row a new finger count must show before the note changes |
| `slideStickiness` | Stickiness for Slide mode notes |
| `bowOn` / `bowOff` / `bowStopMs` | Bow speeds (shoulder widths per second) for starting and stopping a stroke |
| `bowSource` | `'pose'` (default) uses the body tracker's wrist for bowing; `'hand'` uses the hand tracker's palm centre when it sees the right hand (probably steadier). Compare both |
| `bowCutoff` / `bowBeta` | Smoothing of the bow hand position: lower cutoff = fewer false strokes from jitter but slower response. Check `still.mp4` has 0 strokes |

Calibration values (`DEFAULT_CALIBRATION`): `elbowG`, `elbowE` (elbow height in shoulder widths), `openExtension`,
`slideNear`, `slideFar`, `bowFull`.

## What the future session should do

1. Check the clips are outside the repo (`git status` must show nothing new).
2. Run the tester once with the current settings and **write the "before" accuracy for every clip** in the progress
   log in `CLAUDE.md` (percentages only).
3. Tune: try different `--tuning` values (and `--model full`) and see which give the highest accuracy across all
   clips. Look at the raw finger accuracy too: if raw is high but steady is low, `stableFrames` is too high; if both
   are low, change `foldRatio`/`unfoldRatio`, or improve how folding is measured in `fingerExtension()`. If the
   string is wrong, look at the default elbow range and the calibration.
4. Put the best values into `DEFAULT_TUNING` / `DEFAULT_CALIBRATION`, run `npm test`, and **log the "after"
   accuracy for every clip**.
5. **If finger counting is right in under about 85% of steady frames after tuning, make Slide the default mode**
   (`DEFAULT_SETTINGS.mode = 'slide'` in `src/engine.js`) and say so in the log.
6. Commit only code and settings changes. Never commit anything from the clips.
