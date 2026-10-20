#!/usr/bin/env node
// Runs the game's tracking over webcam clips and reports how often the string and finger count were right.
//
//   node scripts/clip-test.mjs ~/private-clips [--model lite|full] [--fps 30] [--tuning '{"foldRatio":0.7}']
//                                              [--calibration cal.json] [--mode fingers|slide] [--verbose]
//
// PRIVACY: the clip folder must be OUTSIDE this repo. Nothing from the clips (frames, tracked points, measurements)
// is written anywhere; only accuracy totals are printed to the terminal. See CLIPS.md.
//
// Labels come from file names (case-insensitive, any video extension):
//   string-G.mp4          whole clip should be on the G string
//   fingers-3.mp4         whole clip should have 3 fingers folded
//   string-A-fingers-2.mp4  both
//   still.mp4             player holds still: expect no bow strokes and no string/finger flicker
//   changes.mp4           free changes: reports how often things changed (optional labels file, see below)
//   slide.mp4             Slide mode: reports the range of notes reached and how smooth it was
//   calibrate.mp4         if present, run first through the calibration steps; its result is used for the rest
// Optional per-clip labels: <clip name>.labels.txt with lines "start_s end_s string finger" (use - for "any"),
// e.g. "0.0 2.5 G 0". These take priority over the file name.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v)$/i;
const STEADY_SKIP_S = 1.0; // ignore the first second of each clip (settling in)

function parseArgs(argv) {
  const a = { dir: null, model: 'lite', fps: 30, tuning: {}, calibration: null, mode: null, verbose: false, delegate: 'CPU' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--model') a.model = argv[++i];
    else if (k === '--fps') a.fps = +argv[++i];
    else if (k === '--tuning') a.tuning = JSON.parse(argv[++i]);
    else if (k === '--calibration') a.calibration = JSON.parse(fs.readFileSync(argv[++i], 'utf8'));
    else if (k === '--mode') a.mode = argv[++i];
    else if (k === '--delegate') a.delegate = argv[++i];
    else if (k === '--verbose') a.verbose = true;
    else if (!a.dir) a.dir = k;
  }
  return a;
}

export function labelsFromName(file) {
  const base = path.basename(file).replace(VIDEO_EXT, '').toLowerCase();
  const lab = { kind: 'other' };
  const s = base.match(/string-([gdae])\b/);
  const f = base.match(/fingers?-([0-4])\b/);
  if (s) lab.string = s[1].toUpperCase();
  if (f) lab.finger = +f[1];
  if (s || f) lab.kind = 'steady';
  if (/^still/.test(base)) lab.kind = 'still';
  if (/^changes/.test(base)) lab.kind = 'changes';
  if (/^slide/.test(base)) lab.kind = 'slide';
  if (/^calibrat/.test(base)) lab.kind = 'calibrate';
  return lab;
}

function readLabelFile(file) {
  const lf = file.replace(VIDEO_EXT, '') + '.labels.txt';
  if (!fs.existsSync(lf)) return null;
  return fs.readFileSync(lf, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
    const [a, b, s, f] = l.split(/\s+/);
    return { start: +a, end: +b, string: s && s !== '-' ? s.toUpperCase() : null, finger: f && f !== '-' ? +f : null };
  });
}

function pct(n, d) { return d ? `${(100 * n / d).toFixed(1)}%` : 'n/a'; }

export function scoreClip(lab, ranges, res) {
  const fr = res.frames;
  const tracked = fr.filter(x => x.body).length;
  const handSeen = fr.filter(x => x.hand).length;
  const r = { frames: fr.length, body: pct(tracked, fr.length), leftHand: pct(handSeen, fr.length) };
  const changes = key => fr.reduce((n, x, i) => n + (i && x[key] !== fr[i - 1][key] ? 1 : 0), 0);
  const expectAt = x => {
    if (ranges) { const g = ranges.find(q => x.t / 1000 >= q.start && x.t / 1000 < q.end); return g || null; }
    return lab.kind === 'steady' ? { string: lab.string ?? null, finger: lab.finger ?? null } : null;
  };
  let sN = 0, sOk = 0, fN = 0, fOk = 0, fRawOk = 0;
  for (const x of fr) {
    if (x.t / 1000 < STEADY_SKIP_S || !x.body) continue;
    const e = expectAt(x);
    if (!e) continue;
    if (e.string != null) { sN++; if (x.string === e.string) sOk++; }
    if (e.finger != null && x.hand) { fN++; if (x.finger === e.finger) fOk++; if (x.rawFinger === e.finger) fRawOk++; }
  }
  if (sN) { r.stringAccuracy = pct(sOk, sN); r.stringValue = sOk / sN; }
  if (fN) { r.fingerAccuracy = pct(fOk, fN); r.fingerValue = fOk / fN; r.fingerRawAccuracy = pct(fRawOk, fN); }
  r.stringChanges = changes('string');
  r.fingerChanges = changes('finger');
  r.strokes = fr.filter(x => x.stroke).length;
  if (lab.kind === 'still') r.soundingFrames = pct(fr.filter(x => x.amp > 0.02).length, fr.length);
  if (lab.kind === 'slide') {
    const idx = fr.map(x => x.slideIndex).filter(v => v != null);
    r.slideLowest = Math.min(...idx); r.slideHighest = Math.max(...idx); r.slideChanges = changes('slideIndex');
  }
  return r;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) { console.error('Usage: node scripts/clip-test.mjs <folder outside the repo> [options]'); process.exit(2); }
  const dir = path.resolve(args.dir.replace(/^~(?=$|\/)/, os.homedir()));
  const rel = path.relative(REPO, dir);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    console.error(`Refusing: ${dir} is inside the repo. Clips must live outside it (e.g. ~/private-clips). See CLIPS.md.`);
    process.exit(2);
  }
  const files = fs.readdirSync(dir).filter(f => VIDEO_EXT.test(f)).sort((a, b) => (labelsFromName(a).kind === 'calibrate' ? -1 : 0) - (labelsFromName(b).kind === 'calibrate' ? -1 : 0));
  if (!files.length) { console.error(`No video files in ${dir}`); process.exit(2); }

  // Chromium may not decode every format (e.g. H.264 in some builds), so clips are converted to WebM in a private
  // temporary folder outside the repo, which is deleted at the end.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'airviolin-clips-'));
  const cleanup = () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } };
  process.on('exit', cleanup);

  const app = await serve(0);
  const clipServer = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1));
    const file = path.join(tmp, path.basename(name));
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const data = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': 'video/webm', 'Access-Control-Allow-Origin': '*', 'Content-Length': data.length });
    res.end(data);
  });
  await new Promise(r => clipServer.listen(0, '127.0.0.1', r));
  const clipBase = `http://127.0.0.1:${clipServer.address().port}/`;

  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(`http://127.0.0.1:${app.address().port}/tools/clip-runner.html`);
  await page.waitForFunction(() => window.ready);
  await page.evaluate(([m, d]) => window.initTracking(m, d), [args.model, args.delegate]);

  let calibration = args.calibration || {};
  const settings = { vibrato: false };
  console.log(`Clip test: ${files.length} clip(s), model ${args.model}, ${args.fps} fps, tuning ${JSON.stringify(args.tuning)}`);
  const summary = [];
  for (const f of files) {
    const lab = labelsFromName(f);
    const ranges = readLabelFile(path.join(dir, f));
    const webm = path.join(tmp, f.replace(VIDEO_EXT, '') + '.webm');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dir, f), '-an', '-vf', `fps=${args.fps},scale=-2:'min(720,ih)'`,
      '-c:v', 'libvpx', '-b:v', '4M', '-deadline', 'realtime', '-cpu-used', '8', webm]);
    const mode = args.mode || (lab.kind === 'slide' ? 'slide' : 'fingers');
    const t0 = Date.now();
    const res = await page.evaluate(([u, fps, s, c, t, cb]) => window.trackClip(u, fps, s, c, t, cb),
      [clipBase + encodeURIComponent(path.basename(webm)), args.fps, { ...settings, mode }, calibration, args.tuning, lab.kind === 'calibrate']);
    fs.rmSync(webm, { force: true });
    if (lab.kind === 'calibrate') {
      if (res.calibration) {
        calibration = res.calibration;
        console.log(`\n${f}: calibration learned  G elbow ${calibration.elbowG.toFixed(2)}  E elbow ${calibration.elbowE.toFixed(2)}  bow full ${calibration.bowFull.toFixed(2)}`);
      } else console.log(`\n${f}: calibration did not finish (reached step ${res.calibStep + 1} of 3); using defaults`);
      continue;
    }
    const r = scoreClip(lab, ranges, res);
    summary.push({ clip: f, ...r });
    console.log(`\n${f}  (${lab.kind}${lab.string ? ' string ' + lab.string : ''}${lab.finger != null ? ' fingers ' + lab.finger : ''}${ranges ? ', labels file' : ''}, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    for (const [k, v] of Object.entries(r)) if (!/Value$/.test(k)) console.log(`  ${k.padEnd(18)} ${v}`);
  }
  const avg = key => { const v = summary.map(s => s[key]).filter(x => x != null); return v.length ? pct(v.reduce((a, b) => a + b, 0), v.length) : 'n/a'; };
  console.log(`\nOVERALL  string accuracy ${avg('stringValue')}   finger accuracy ${avg('fingerValue')}   (steady frames, first ${STEADY_SKIP_S}s skipped)`);
  const fv = summary.map(s => s.fingerValue).filter(x => x != null);
  if (fv.length) {
    const mean = fv.reduce((a, b) => a + b, 0) / fv.length;
    console.log(mean < 0.85 ? 'Finger counting is under 85%: if tuning cannot fix it, make Slide the default (see CLIPS.md).'
      : 'Finger counting is at or above 85%: keep Fingers as the default.');
  }
  await browser.close(); app.close(); clipServer.close();
  cleanup();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exit(1); });
}
