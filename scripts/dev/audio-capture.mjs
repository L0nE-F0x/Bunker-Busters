// Record the game's audio headlessly (npm run dev must be running): the master mix to a WAV, plus
// per-bus loudness (music / ambience / sfx) once a second. Pair with ffmpeg for a spectrogram:
//
//   node scripts/dev/audio-capture.mjs "http://localhost:5173/play/?webgl&autostart" out.wav 60 \
//     --eval "game.atmo.hour = 22"
//   ffmpeg -y -i out.wav -lavfi showspectrumpic=s=1600x600:legend=1:fscale=log out.png
//
// Steps before recording: --wait <ms> | --eval "<js>". --during "<js>" runs every 250 ms while
// recording (e.g. to hold the drone's detection up). Audio starts without a gesture (autoplay flag).
import fs from 'node:fs';
import { launch, waitForGame } from './browser.mjs';

const [url, out = 'capture.wav', secs = '30', ...rest] = process.argv.slice(2);
if (!url) { console.log('usage: node scripts/dev/audio-capture.mjs <url> <out.wav> <seconds> [--wait ms] [--eval js] [--during js]'); process.exit(1); }
let during = '';
const di = rest.indexOf('--during');
if (di >= 0) { during = rest[di + 1]; rest.splice(di, 2); }

const b = await launch(undefined, ['--autoplay-policy=no-user-gesture-required']);
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/GL Driver/.test(m.text())) console.log('[console.error]', m.text().slice(0, 200)); });
await p.goto(url);
console.log('mode:', await waitForGame(p));
await p.evaluate(() => window.game.audio.start());
for (let i = 0; i < rest.length; i += 2) {
  if (rest[i] === '--wait') await p.waitForTimeout(+rest[i + 1]);
  else if (rest[i] === '--eval') console.log('eval →', await p.evaluate(rest[i + 1]));
}
const pcm = await p.evaluate(async ({ secs, during }) => {
  const a = window.game.audio;
  const ctx = a.ctx;
  const taps = { master: a.master, music: a.music, amb: a.ambOut, sfx: a.sfx };
  const rec = { left: [], right: [] };
  const levels = [];
  const acc = {};
  const procs = [];
  for (const [name, node] of Object.entries(taps)) {
    const sp = ctx.createScriptProcessor(4096, 2, 2);
    acc[name] = { sum: 0, n: 0, peak: 0 };
    sp.onaudioprocess = (e) => {
      const l = e.inputBuffer.getChannelData(0), r = e.inputBuffer.getChannelData(1);
      if (name === 'master') { rec.left.push(new Float32Array(l)); rec.right.push(new Float32Array(r)); }
      const A = acc[name];
      for (let i = 0; i < l.length; i++) { const v = (l[i] + r[i]) * 0.5; A.sum += v * v; A.n++; A.peak = Math.max(A.peak, Math.abs(l[i]), Math.abs(r[i])); }
    };
    node.connect(sp);
    const mute = ctx.createGain(); mute.gain.value = 0; sp.connect(mute).connect(ctx.destination);
    procs.push(sp);
  }
  const db = (x) => (x > 1e-9 ? (20 * Math.log10(x)).toFixed(1) : '-inf');
  const iv = setInterval(() => {
    const row = { t: ctx.currentTime.toFixed(0), mood: window.game.mode, hour: window.game.atmo.hour.toFixed(2) };
    for (const [k, A] of Object.entries(acc)) { row[k] = `${db(Math.sqrt(A.sum / Math.max(1, A.n)))} pk ${db(A.peak)}`; A.sum = A.n = A.peak = 0; }
    levels.push(row);
    if (during) { try { (0, eval)(during); } catch (e) { /* ignore */ } }
  }, 1000);
  const di = during ? setInterval(() => { try { (0, eval)(during); } catch { /* ignore */ } }, 250) : 0;
  await new Promise((r) => setTimeout(r, secs * 1000));
  clearInterval(iv); clearInterval(di);
  for (const sp of procs) sp.disconnect();
  const join = (arr) => { const n = arr.reduce((s, x) => s + x.length, 0); const o = new Float32Array(n); let k = 0; for (const x of arr) { o.set(x, k); k += x.length; } return Array.from(o, (v) => Math.round(Math.max(-1, Math.min(1, v)) * 32767)); };
  return { sr: ctx.sampleRate, left: join(rec.left), right: join(rec.right), levels };
}, { secs: +secs, during });
for (const l of pcm.levels) console.log(JSON.stringify(l));
// 16-bit stereo WAV
const n = pcm.left.length;
const buf = Buffer.alloc(44 + n * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(pcm.sr, 24);
buf.writeUInt32LE(pcm.sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) { buf.writeInt16LE(pcm.left[i], 44 + i * 4); buf.writeInt16LE(pcm.right[i], 46 + i * 4); }
fs.writeFileSync(out, buf);
console.log(`saved ${out} (${(n / pcm.sr).toFixed(1)} s)`);
await b.close();
