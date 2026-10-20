# Credits and licences

Every third-party file in this repo, where it came from and its licence.

| What | Where in the repo | Source | Licence |
|---|---|---|---|
| Violin recordings (Solo Violin "Arco Vib", G3–C6, soft and loud) | `assets/audio/*.wav` | [VS Chamber Orchestra: Community Edition (VSCO 2 CE)](https://github.com/sgossner/VSCO-2-CE) by Versilian Studios: recorded by Sam Gossner & Simon Dalzell, sample cutting by Elan Hickler/Soundemote | CC0 1.0 Universal (public domain), see the LICENSE file in that repo |
| MediaPipe Tasks Vision library + WebAssembly | `vendor/mediapipe/` | npm `@mediapipe/tasks-vision` 1.1.1, Google (patched by `scripts/patch-vendor.mjs` to switch off its built-in usage logging) | Apache 2.0 |
| Pose landmarker models (lite, full) and hand landmarker model | `vendor/models/` | Google MediaPipe model storage (`storage.googleapis.com/mediapipe-models`) | Apache 2.0 |
| Hand landmark numbers (no images) found by the vendored hand model in MediaPipe's test photos `fist.jpg`, `right_hands.jpg`, `pointing_up.jpg`, `victory.jpg`, `thumb_up.jpg` | `tests/fixtures/mediapipe-test-hands.json` | `storage.googleapis.com/mediapipe-assets` (MediaPipe's test assets) | Apache 2.0 |
| Three.js | `vendor/three/` | npm `three` 0.186.1 | MIT (`vendor/three/LICENSE`) |

The recordings were converted by `scripts/prep-samples.py` (mono, 32 kHz, trimmed, loop crossfade baked in, levels
matched). The violin and bow 3D shapes, the icon and the room echo are original and made in code.

Everything else in this repo: MIT licence (see `LICENSE`).
