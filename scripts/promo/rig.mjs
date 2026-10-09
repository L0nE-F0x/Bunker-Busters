// Frame-exact capture rig for trailers: the page runs on a virtual clock, every frame is stepped by
// exactly 1/fps and grabbed, so footage is perfectly smooth however slow the headless render is.
// With `audio`, the game's Web Audio graph renders into an OfflineAudioContext in lockstep with the
// frames (suspended at every frame boundary), so each take gets its own sample-accurate sound.
// Needs `npm run dev`. Headless only (see scripts/dev/browser.mjs for the GPU rules).
//
//   const rig = await openRig({ url: '/play/?webgl&q=ultra&skip=ui&autostart', audio: 300 });
//   await rig.begin();                                   // virtual clock from here on (audio starts)
//   await rig.eval(() => game.atmo.hour = 18);           // set up a shot
//   await rig.run(1.5);                                  // let it settle on the virtual clock
//   await rig.record('take.mp4', 4.0, { pre: '...' });   // 4 s at 60 fps (+ take.wav at the end)
//   await rig.close();                                   // renders the audio out, writes the WAVs
//
// `__cap.pre(t, dt, i)` (a function source passed to run/record) runs before each frame: move the
// camera, hold keys, pull triggers. `__cap.post` runs right after the game's playFrame (first-person
// camera), for cameras that must win over it.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { launch, waitForGame } from '../dev/browser.mjs';

const ORIGIN = `http://localhost:${process.env.BB_PORT || 5173}`;

/** Installed before any page script: a switchable virtual clock (and offline audio). */
const SHIM = (audioLen) => {
  const realNow = performance.now.bind(performance);
  const realDate = Date.now;
  const realRAF = window.requestAnimationFrame.bind(window);
  const realCAF = window.cancelAnimationFrame.bind(window);
  const realST = window.setTimeout.bind(window), realCT = window.clearTimeout.bind(window);
  const realSI = window.setInterval.bind(window), realCI = window.clearInterval.bind(window);
  let virtual = false, vNow = 0, dateBase = 0;
  let rafQ = [], rafId = 1e9;
  const timers = new Map();
  let timerId = 1e9;

  // ---- offline audio: the game's `new AudioContext()` gets an OfflineAudioContext we step by hand
  const SR = 48000, Q = 128 / SR;
  let off = null, offStarted = false, offDone = null, aT = 0, aEnd = 0;
  if (audioLen) {
    const RealAC = window.AudioContext;
    window.AudioContext = function () {
      off = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(audioLen * SR), sampleRate: SR });
      aEnd = audioLen - 0.25;
      off.__resume = off.resume.bind(off);
      off.resume = () => Promise.resolve(); // the game can't run the clock (nor un-suspend it)
      cap.audio = off;
      return off;
    };
    window.AudioContext.prototype = RealAC.prototype;
  }

  const cap = (window.__cap = {
    audio: null, aNow: 0,
    get virtual() { return virtual; },
    pre: null, post: null, t: 0, i: 0, frames: 0,
    start() {
      if (virtual) return;
      vNow = realNow(); dateBase = realDate() - vNow; virtual = true; cap.t = 0; cap.i = 0;
    },
    /** Advance the offline audio by dt (resolves once it has rendered up to there). */
    audioStep(dt) {
      if (!off) return null;
      if (aT + dt > aEnd) { if (!cap.audioFull) { cap.audioFull = true; console.error('[cap] audio buffer full'); } return null; }
      aT += dt;
      const t = Math.ceil(aT / Q - 1e-6) * Q;
      return new Promise((res) => {
        off.suspend(t).then(() => { cap.aNow = off.currentTime; res(); });
        if (!offStarted) { offStarted = true; offDone = off.startRendering(); } else off.__resume();
      });
    },
    /** Render the rest of the audio and hand back [startSec, seconds] slices as 16-bit stereo PCM (base64). */
    async audioSlices(slices) {
      if (!off || !offStarted) return [];
      off.__resume();
      const buf = await offDone;
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      return slices.map(([s, d]) => {
        const a = Math.max(0, Math.round(s * SR)), n = Math.round(d * SR);
        const out = new Int16Array(n * 2);
        for (let i = 0; i < n; i++) {
          const l = L[a + i] ?? 0, r = R[a + i] ?? 0;
          out[i * 2] = Math.max(-32768, Math.min(32767, Math.round(l * 32767)));
          out[i * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(r * 32767)));
        }
        const u8 = new Uint8Array(out.buffer);
        let bin = '';
        for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return btoa(bin);
      });
    },
    /** One frame: advance the clock (and audio), fire due timers, the pre hook, then frame callbacks. */
    step(dt) {
      const a = cap.audioStep(dt);
      const frame = () => {
        vNow += dt * 1000;
        cap.t += dt;
        for (let guard = 0; guard < 64; guard++) {
          let due = null;
          for (const [id, tm] of timers) if (tm.at <= vNow && (!due || tm.at < due[1].at)) due = [id, tm];
          if (!due) break;
          const [id, tm] = due;
          if (tm.every) tm.at += tm.every; else timers.delete(id);
          try { tm.fn(); } catch (e) { console.error('[cap timer]', e && e.stack || e); }
        }
        if (cap.pre) { try { cap.pre(cap.t, dt, cap.i); } catch (e) { console.error('[cap pre]', e && e.stack || e); } }
        const q = rafQ; rafQ = [];
        for (const r of q) { try { r.cb(vNow); } catch (e) { console.error('[cap raf]', e && e.stack || e); } }
        cap.i++; cap.frames++;
      };
      if (a) return a.then(frame);
      frame();
      return null;
    },
    async steps(n, dt) { for (let i = 0; i < n; i++) { const p = cap.step(dt); if (p) await p; } },
  });
  performance.now = () => (virtual ? vNow : realNow());
  Date.now = () => (virtual ? dateBase + vNow : realDate());
  window.requestAnimationFrame = (cb) => {
    if (!virtual) return realRAF(cb);
    const id = ++rafId; rafQ.push({ id, cb }); return id;
  };
  window.cancelAnimationFrame = (id) => { if (id > 1e9) rafQ = rafQ.filter((r) => r.id !== id); else realCAF(id); };
  window.setTimeout = (fn, ms = 0, ...a) => {
    if (!virtual || typeof fn !== 'function') return realST(fn, ms, ...a);
    const id = ++timerId; timers.set(id, { fn: () => fn(...a), at: vNow + (+ms || 0) }); return id;
  };
  window.clearTimeout = (id) => { if (id > 1e9) timers.delete(id); else realCT(id); };
  window.setInterval = (fn, ms = 0, ...a) => {
    if (!virtual || typeof fn !== 'function') return realSI(fn, ms, ...a);
    const id = ++timerId; const every = Math.max(1, +ms || 1); timers.set(id, { fn: () => fn(...a), at: vNow + every, every }); return id;
  };
  window.clearInterval = (id) => { if (id > 1e9) timers.delete(id); else realCI(id); };
};

function wav(path, b64, sr = 48000) {
  const pcm = Buffer.from(b64, 'base64');
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(path, Buffer.concat([h, pcm]));
}

const DIRECTOR = fs.readFileSync(new URL('./director.js', import.meta.url), 'utf8');

/**
 * Open the game headlessly. `url` is a path on the dev server; `size` the viewport; `audio` the
 * seconds of offline audio to allot for the whole session (0 = no audio). `settle` waits (real ms)
 * after loading for shaders and streaming.
 */
export async function openRig({ url, size = [1920, 1080], settle = 6000, audio = 0, log = true } = {}) {
  const browser = await launch(undefined, ['--autoplay-policy=no-user-gesture-required', '--hide-scrollbars']);
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
  page.on('pageerror', (e) => log && console.log('[pageerror]', e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (!log || /GL Driver|DevTools|\[voice\] clip/.test(t)) return;
    if (m.type() === 'error' || t.startsWith('[cap') || t.startsWith('[dir')) console.log(`[${m.type()}]`, t.slice(0, 400));
  });
  await page.addInitScript(SHIM, audio);
  await page.goto(url.startsWith('http') ? url : ORIGIN + url);
  await waitForGame(page);
  if (settle) await page.waitForTimeout(settle);
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(DIRECTOR);
  // the director's hook after playFrame (the first-person camera), so a scripted camera wins; and
  // one right before the render (exposure lift for night shots: Game sets exposure every frame)
  await page.evaluate(() => {
    const g = window.game;
    const pf = g.playFrame;
    g.playFrame = function (dt) { pf.call(this, dt); if (window.__cap.post) { try { window.__cap.post(window.__cap.t, dt); } catch (e) { console.error('[cap post]', e && e.stack || e); } } };
    const r = g.post.render.bind(g.post);
    g.post.render = function () {
      if (window.D.expo !== 1) g.post.exposure.value *= window.D.expo;
      if (window.D.god) { g.post.damage.value = 0; g.post.lowHp.value = 0; }
      if (window.D.grain !== undefined) g.post.grain.value = window.D.grain;
      return r();
    };
  });
  const takes = []; // [wavPath, audioStart, seconds]

  const setHooks = (pre, post) => page.evaluate(({ pre, post }) => {
    window.__cap.pre = pre ? (0, eval)(`(${pre})`) : null;
    window.__cap.post = post ? (0, eval)(`(${post})`) : null;
    window.__cap.t = 0; window.__cap.i = 0;
  }, { pre: pre && String(pre), post: post && String(post) });

  const rig = {
    page, browser, cdp, size,
    eval: (fn, arg) => page.evaluate(fn, arg),
    wait: (ms) => page.waitForTimeout(ms),
    /** Switch to the virtual clock for the rest of the session; starts the game's audio. */
    async begin({ music = 0, sfx = 0.9 } = {}) {
      await page.evaluate(({ music, sfx, audio }) => {
        window.__cap.start();
        if (audio) { window.game.audio.start(); window.game.audio.setVolumes({ music, sfx }); }
      }, { music, sfx, audio });
      // hand the game loop over: its requestAnimationFrame already in flight only lands (and
      // re-queues on the virtual clock) once Chrome draws a frame, so force frames until it does
      for (let i = 0; i < 100; i++) {
        await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 10 });
        const moved = await page.evaluate(async () => { const f = window.game.frames; const p = window.__cap.step(1 / 60); if (p) await p; return window.game.frames > f; });
        if (moved) return;
        await page.waitForTimeout(16);
      }
      throw new Error('the game loop never reached the virtual clock');
    },
    /** Run frames on the virtual clock without capturing (let a shot settle). */
    async run(seconds, { fps = 60, pre, post } = {}) {
      await setHooks(pre, post);
      const n = Math.round(seconds * fps);
      for (let i = 0; i < n; i += 20) await page.evaluate(({ k, dt }) => window.__cap.steps(k, dt), { k: Math.min(20, n - i), dt: 1 / fps });
    },
    /**
     * Record `seconds` of footage to `out` (.mp4, near-lossless; plus a .wav beside it when the
     * session has audio). `pre`/`post` are functions (or sources) run in the page: (t, dt, i) => void.
     */
    async record(out, seconds, { fps = 60, pre, post, quality = 94, stills = [] } = {}) {
      await setHooks(pre, post);
      const n = Math.round(seconds * fps);
      const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '10', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
      const done = new Promise((r) => ff.on('close', r));
      const t0 = Date.now();
      let a0 = null;
      for (let i = 0; i < n; i++) {
        const aNow = await page.evaluate(async (dt) => { const p = window.__cap.step(dt); if (p) await p; return window.__cap.aNow; }, 1 / fps);
        if (i === 0) a0 = aNow;
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality, optimizeForSpeed: true });
        if (!ff.stdin.write(Buffer.from(data, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
        if (stills.includes(i)) await rig.still(out.replace(/\.mp4$/, `-${i}.png`));
      }
      ff.stdin.end();
      await done;
      if (audio) takes.push([out.replace(/\.mp4$/, '.wav'), a0, n / fps]);
      await setHooks(null, null);
      const secs = (Date.now() - t0) / 1000;
      console.log(`  ${out.split('/').pop()}: ${n} frames in ${secs.toFixed(0)} s (${(n / secs).toFixed(1)} fps)`);
    },
    /** Audio only: run `seconds` on the virtual clock (no frames grabbed) and keep the sound as `out` (.wav). */
    async listen(out, seconds, { fps = 30, pre, post } = {}) {
      if (!audio) throw new Error('listen() needs a session with audio');
      await setHooks(pre, post);
      const n = Math.round(seconds * fps);
      const a0 = await page.evaluate(async (dt) => { const p = window.__cap.step(dt); if (p) await p; return window.__cap.aNow; }, 1 / fps);
      for (let i = 1; i < n; i += 30) await page.evaluate(({ k, dt }) => window.__cap.steps(k, dt), { k: Math.min(30, n - i), dt: 1 / fps });
      takes.push([out, a0, n / fps]);
      await setHooks(null, null);
      console.log(`  ${out.split('/').pop()}: ${seconds} s of audio`);
    },
    /** A full-quality still of the current frame (PNG). */
    async still(out) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(out, Buffer.from(data, 'base64'));
    },
    async close() {
      if (audio && takes.length) {
        const pcm = await page.evaluate((s) => window.__cap.audioSlices(s), takes.map(([, a, d]) => [a, d]));
        takes.forEach(([p], i) => wav(p, pcm[i]));
        console.log(`  audio: ${takes.length} take(s) written`);
      }
      await browser.close();
    },
  };
  return rig;
}
