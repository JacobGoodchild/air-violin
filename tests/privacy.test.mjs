// Guards the privacy and safety rules in the repo itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
  .flatMap(d => d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);

test('MediaPipe usage logging is switched off in the vendored bundle', () => {
  assert.ok(read('vendor/mediapipe/vision_bundle.mjs').includes('flush(t,e){this.i=[];return void t?.();'));
});

test('game code: no eval, no outside addresses, storage only through try/catch helpers', () => {
  for (const f of walk('src')) {
    const s = read(f);
    assert.ok(!/\beval\s*\(|new Function\s*\(/.test(s), `${f} uses eval`);
    assert.ok(!/https?:\/\//.test(s.replace(/\/\/.*$/gm, '')), `${f} mentions an outside address`);
    assert.ok(!/document\.cookie|sessionStorage|indexedDB/.test(s), `${f} uses other storage`);
  }
  const main = read('src/main.js');
  assert.equal((main.match(/localStorage\./g) || []).length, 3, 'only the three wrapped localStorage calls');
});

test('page has a strict content security policy', () => {
  const html = read('index.html');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /connect-src 'self'/);
  assert.ok(!/https?:\/\/(?!jacobgoodchild)/.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'no outside links in the page');
});

test('.gitignore keeps screenshots, test output and video clips out of the repo', () => {
  const gi = read('.gitignore');
  for (const p of ['screenshots/', 'test-output/', 'test-results/', '*.mp4', '*.mov', '*.webm']) assert.ok(gi.includes(p), p);
  const tracked = walk('.').filter(f => !f.startsWith('node_modules') && !f.startsWith('.git/'));
  assert.ok(!tracked.some(f => /\.(mp4|mov|webm|mkv|avi)$/i.test(f)), 'no video files in the repo folder');
});
