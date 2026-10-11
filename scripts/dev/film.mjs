// Film a sequence headlessly into a contact sheet (one PNG of N frames), for judging motion.
//   node scripts/dev/film.mjs "<url>" out.png --setup file.js --each file.js --frames 12 --every 120 [--cols 4] [--size 640x360]
// --setup runs once after load (async body; `return` ignored). --each runs before every frame
// (e.g. to follow a subject with the camera). Both see `window.game`. Needs `npm run dev`.
import { launch, waitForGame } from './browser.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [url, out, ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const frames = +opt('--frames', 12), every = +opt('--every', 120), cols = +opt('--cols', 4);
const [w, h] = opt('--size', '640x360').split('x').map(Number);
const setup = opt('--setup') ? fs.readFileSync(opt('--setup'), 'utf8') : '';
const each = opt('--each') ? fs.readFileSync(opt('--each'), 'utf8') : '';
const b = await launch();
const p = await b.newPage({ viewport: { width: w, height: h } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('console', (m) => { const t = m.text(); if (t.startsWith('[film]')) console.log(t); });
await p.goto(url);
await waitForGame(p);
await p.waitForTimeout(1500);
if (setup) await p.evaluate(`(async () => { ${setup} })()`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-'));
for (let i = 0; i < frames; i++) {
  if (each) await p.evaluate(`(async () => { ${each} })()`);
  await p.waitForTimeout(40);
  await p.screenshot({ path: path.join(dir, `f${String(i).padStart(3, '0')}.png`) });
  await p.waitForTimeout(every);
}
await b.close();
const rows = Math.ceil(frames / cols);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dir, 'f%03d.png'), '-vf', `tile=${cols}x${rows}`, '-frames:v', '1', out]);
fs.rmSync(dir, { recursive: true });
console.log('saved', out);
