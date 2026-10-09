// Frame-cost probe: where CPU time, draws and GL calls go at a set of spots (headless, nothing on screen).
//
//   node scripts/dev/perf-probe.mjs                              # all spots, 480×270, prints a table
//   node scripts/dev/perf-probe.mjs --spots camp,fight --frames 240 --size 1280x720 --gl --json out.json
//   node scripts/dev/perf-probe.mjs --url "http://localhost:5184/play/?webgl&autostart&q=high" --shots dir
//
// At 480×270 the GPU is never the limit, so frame CPU is what the desktop app (WebKitGTK: CPU-bound on
// draw submission) pays. Per spot: frame / update / physics / render ms (mean and p25: headless
// performance.now() is coarse, use means across runs), draws (main + shadow), triangles, GL calls
// per frame (--gl: every WebGL2 method is counted, which itself costs, so timings are then inflated),
// JS heap growth per frame (positive deltas only, --enable-precise-memory-info), programs compiled.
// --shots <dir> saves a screenshot per spot (A/B the look of a change at the same views).
// Spots: camp (night, fire), creek (Dry Creek noon), highway (noon), garage (inside), fight, wolves.
import fs from 'node:fs';
import path from 'node:path';
import { launch, waitForGame } from './browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const port = process.env.BB_PORT || '5173';
const url = opt('url', `http://localhost:${port}/play/?webgl&autostart&q=high`);
const [W, H] = opt('size', '480x270').split('x').map(Number);
const FRAMES = +opt('frames', 240);
const SETTLE = +opt('settle', 2500);
const spotsArg = opt('spots', 'camp,creek,highway,garage,fight,wolves').split(',');
const shots = opt('shots', null);
const GL = flag('gl');
const GPU = flag('gpu'); // GPU ms per frame (EXT_disjoint_timer_query_webgl2 around the whole frame)
const EVAL = opt('eval', null); // JS run once after load (A/B toggles: quality, skips)
if (shots) fs.mkdirSync(shots, { recursive: true });

// Each spot: JS run in the page (game = window.game). Teleport, then aim on the next frame.
const SPOTS = {
  camp: `{ const f = game.landmarks.campPosition; const at = game.landmarks.campPoint(-12.3, 0, 0);
    game.player.teleport(at); game.atmo.hour = 21.5; await next();
    game.cam.snap(Math.atan2(at.x - f.x, at.z - f.z), -0.08); }`,
  creek: `{ tp(-262 + 30, -48 + 40); game.atmo.hour = 12; await next();
    game.cam.snap(Math.atan2(30, 40), -0.05); }`,
  highway: `{ tp(22, 100); game.atmo.hour = 12.5; await next();
    game.cam.snap(Math.PI * 0.5, -0.03); }`,
  garage: `{ const p = game.garage.b.points.interior.clone(); p.y -= 0.9; game.player.teleport(p); game.atmo.hour = 12; await next();
    game.cam.snap(0.6, -0.1); }`,
  fight: `{ tp(60, 40); game.atmo.hour = 15; await next(); game.cam.snap(0, -0.02); await next();
    game.combat.difficulty = 'story'; game.recovery.summon(game.player.position, game.cam.yaw, 22, 4, true);
    window.__heal = setInterval(() => { game.state.data.health = Math.max(game.state.data.health, 50); }, 250); }`,
  wolves: `{ tp(-60, 180); game.atmo.hour = 10; await next(); game.cam.snap(0, -0.03); await next();
    game.combat.difficulty = 'story'; game.fauna.summonPack(game.player.position, 30, true, 4);
    window.__heal ??= setInterval(() => { game.state.data.health = Math.max(game.state.data.health, 50); }, 250); }`,
};

const b = await launch(process.env.GPU_MODE || 'nvidia', ['--enable-precise-memory-info']);
const p = await b.newPage({ viewport: { width: W, height: H } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/GL Driver/.test(m.text())) console.log('[console.error]', m.text().slice(0, 200)); });
await p.addInitScript((gl) => {
  window.__probe = { gl: 0, glOn: gl, programs: 0 };
  const P = WebGL2RenderingContext.prototype;
  const lp = P.linkProgram;
  P.linkProgram = function (...a) { window.__probe.programs++; return lp.apply(this, a); };
  if (gl) {
    for (const k of Object.getOwnPropertyNames(P)) {
      const d = Object.getOwnPropertyDescriptor(P, k);
      if (!d || typeof d.value !== 'function' || k === 'constructor') continue;
      const f = d.value;
      P[k] = function (...a) { window.__probe.gl++; return f.apply(this, a); };
    }
  }
}, GL);
const t0 = Date.now();
await p.goto(url);
await waitForGame(p, 180000);
const bootMs = Date.now() - t0;
// wait for the run to be playable (autostart → playing, the intro fade)
for (let i = 0; i < 100; i++) { if (await p.evaluate(() => window.game?.mode === 'playing' && !!window.game.player)) break; await p.waitForTimeout(300); }
await p.waitForTimeout(1500);
const warm = await p.evaluate(() => window.__probe.programs);

if (EVAL) await p.evaluate(EVAL);
await p.evaluate((gpu) => { window.__wantGpu = gpu; }, GPU);
// install the per-frame hooks
await p.evaluate(() => {
  const g = window.game;
  const s = (window.__s = { on: false, frames: [], cur: null });
  const be = g.renderer.backend;
  const draw = be.draw.bind(be);
  be.draw = (ro, info) => {
    if (s.cur) {
      const m = ro.material;
      if (m && m.isShadowPassMaterial) s.cur.shadow++; else s.cur.main++;
      const geo = ro.geometry;
      const idx = geo.index; const pos = geo.attributes?.position;
      const n = ro.object.isInstancedMesh ? ro.object.count : 1;
      s.cur.tris += ((idx ? idx.count : pos ? pos.count : 0) / 3) * n;
    }
    return draw(ro, info);
  };
  const phys = g.physics.step.bind(g.physics);
  g.physics.step = () => { const t = performance.now(); phys(); if (s.cur) s.cur.phys += performance.now() - t; };
  const post = g.post.render.bind(g.post);
  g.post.render = () => { const t = performance.now(); post(); if (s.cur) s.cur.render += performance.now() - t; };
  const frame = g.frame.bind(g);
  g.frame = () => {
    if (!s.on) return frame();
    const mem0 = performance.memory?.usedJSHeapSize ?? 0;
    const gl0 = window.__probe.gl;
    s.cur = { main: 0, shadow: 0, tris: 0, phys: 0, render: 0 };
    const t = performance.now();
    frame();
    const c = s.cur;
    c.ms = performance.now() - t;
    c.gl = window.__probe.gl - gl0;
    c.alloc = Math.max(0, (performance.memory?.usedJSHeapSize ?? 0) - mem0);
    s.frames.push(c);
    s.cur = null;
  };
  // GPU time: one TIME_ELAPSED query around each measured frame, read back a few frames later
  const gl = be.gl; const ext = gl && gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pool = [], pending = [];
  s.gpuOn = !!ext && window.__wantGpu;
  const frameGpu = (f) => {
    if (!s.gpuOn) return f();
    const q = pool.pop() || gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    f();
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    pending.push({ q, rec: s.on ? s.frames[s.frames.length - 1] : null });
    while (pending.length && gl.getQueryParameter(pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
      const { q: d, rec } = pending.shift();
      if (rec && !gl.getParameter(ext.GPU_DISJOINT_EXT)) rec.gpu = gl.getQueryParameter(d, gl.QUERY_RESULT) / 1e6;
      pool.push(d);
    }
  };
  const frame2 = g.frame;
  g.frame = () => frameGpu(frame2);
  g.renderer.setAnimationLoop(() => g.frame());
});

const rows = [];
for (const name of spotsArg) {
  const setup = SPOTS[name];
  if (!setup) { console.log('unknown spot', name); continue; }
  await p.evaluate(`(async () => { const game = window.game; const V = game.camera.position.constructor;
    const tp = (x, z) => game.player.teleport(new V(x, game.hf.heightAt(x, z) + 0.05, z));
    const next = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    ${setup} })()`);
  await p.waitForTimeout(SETTLE);
  const prog0 = await p.evaluate(() => window.__probe.programs);
  await p.evaluate(() => { window.__s.frames = []; window.__s.on = true; });
  await p.waitForFunction((n) => window.__s.frames.length >= n, FRAMES, { timeout: 120000, polling: 250 });
  const r = await p.evaluate(() => {
    const s = window.__s; s.on = false;
    const f = s.frames.slice();
    const mean = (k) => f.reduce((a, x) => a + x[k], 0) / f.length;
    const sorted = f.map((x) => x.ms).sort((a, b) => a - b);
    const g = window.game;
    return {
      frames: f.length,
      ms: mean('ms'), p25: sorted[Math.floor(sorted.length * 0.25)], p90: sorted[Math.floor(sorted.length * 0.9)],
      update: mean('ms') - mean('phys') - mean('render'), phys: mean('phys'), render: mean('render'),
      gpu: (() => { const v = f.filter((x) => x.gpu !== undefined).map((x) => x.gpu); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; })(),
      main: mean('main'), shadow: mean('shadow'), tris: mean('tris'), gl: mean('gl'), alloc: mean('alloc') / 1024,
      interior: g.interiorName, census: g.recovery?.census?.() ?? null,
    };
  });
  r.newPrograms = (await p.evaluate(() => window.__probe.programs)) - prog0;
  r.spot = name;
  rows.push(r);
  if (shots) {
    // the look, at a readable size (time is pinned so A/B pairs match: clouds, sway and flicker move)
    await p.setViewportSize({ width: 1280, height: 720 });
    await p.evaluate(() => { window.game.atmo.paused = true; });
    await p.waitForTimeout(800);
    await p.screenshot({ path: path.join(shots, `${name}.png`) });
    await p.evaluate(() => { window.game.atmo.paused = false; });
    await p.setViewportSize({ width: W, height: H });
  }
  console.log(`${name.padEnd(8)} frame ${r.ms.toFixed(2)} (p25 ${r.p25.toFixed(2)} p90 ${r.p90.toFixed(2)}) upd ${r.update.toFixed(2)} phys ${r.phys.toFixed(2)} ren ${r.render.toFixed(2)} | draws ${r.main.toFixed(0)}+${r.shadow.toFixed(0)} tris ${(r.tris / 1000).toFixed(0)}k${GL ? ` gl ${r.gl.toFixed(0)}` : ''} alloc ${r.alloc.toFixed(0)}KB${r.gpu !== null ? ` GPU ${r.gpu.toFixed(2)}` : ''}${r.newPrograms ? ` NEW PROGRAMS ${r.newPrograms}` : ''}${r.interior ? ` [${r.interior}]` : ''}`);
}
console.log(`boot ${bootMs} ms, programs after warm-up ${warm}, total ${await p.evaluate(() => window.__probe.programs)}`);
const jsonOut = opt('json', null);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ url, size: [W, H], bootMs, warm, rows }, null, 1));
await b.close();
