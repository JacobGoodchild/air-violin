// Takes a screenshot of the game with the fake camera or demo mode (never a real clip). Output: screenshots/ (git-ignored).
// node scripts/screenshot.mjs "?demo=1" demo.png 1280 720 3000 [keys]
import fs from 'node:fs';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';
fs.mkdirSync(new URL('../screenshots/', import.meta.url), { recursive: true });
const s = await serve(0); const base = `http://127.0.0.1:${s.address().port}/`;
const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const [, , q = '?demo=1', out = 'demo.png', w = '1280', h = '720', wait = '3000', keys = ''] = process.argv;
const p = await b.newPage({ viewport: { width: +w, height: +h } });
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text()); });
p.on('pageerror', e => console.log('pageerror', e.message));
await p.goto(base + 'index.html' + q);
if (keys) { await p.click('#btn-keys'); for (const k of keys.split(',')) { if (k === 'BOW') { await p.keyboard.down(' '); } else await p.keyboard.press(k); } }
await p.waitForTimeout(+wait);
await p.screenshot({ path: new URL('../screenshots/', import.meta.url).pathname + out });
await b.close(); s.close();
