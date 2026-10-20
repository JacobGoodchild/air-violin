// Patches the vendored MediaPipe bundle so it never tries to send usage logs to Google.
// (MediaPipe Tasks has built-in logging that POSTs to odml.pa.googleapis.com every 60 s and when a task closes.)
// Run after updating vendor/mediapipe: node scripts/patch-vendor.mjs   (safe to run more than once)
import fs from 'node:fs';

const file = new URL('../vendor/mediapipe/vision_bundle.mjs', import.meta.url);
let src = fs.readFileSync(file, 'utf8');
const MARK = 'flush(t,e){this.i=[];return void t?.();';
if (src.includes(MARK)) { console.log('already patched'); process.exit(0); }
const target = 'flush(t,e){if(this.error)e?.("net-send-failed");';
if (!src.includes(target)) { console.error('logging code not found: check the bundle by hand'); process.exit(1); }
src = src.replace(target, MARK + 'if(this.error)e?.("net-send-failed");');
fs.writeFileSync(file, src);
console.log('patched: MediaPipe usage logging disabled');
