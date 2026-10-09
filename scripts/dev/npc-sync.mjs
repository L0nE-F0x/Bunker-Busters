// Do the townsfolk move in lockstep? Walks the player in and out of a crowd's range (real time),
// logs every clip switch and head turn, then fast-forwards the crowd 5 minutes and checks that
// people playing the same motion are still out of phase. Needs `npm run dev`.
//
//   node scripts/dev/npc-sync.mjs [camp|creek] [--minutes 5]
//
// Prints: when each person noticed you and turned their head (should be staggered, not one frame),
// every switch (neighbours within 4.5 m must never start one motion within 3 s of each other), and
// the phase gaps between same-motion pairs after the fast-forward.
import { launch, waitForGame } from './browser.mjs';

const args = process.argv.slice(2);
const which = args.find((a) => !a.startsWith('--')) ?? 'camp';
const mi = args.indexOf('--minutes');
const minutes = mi >= 0 ? Number(args[mi + 1]) : 5;

const b = await launch();
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/GL Driver/.test(m.text())) console.log('[console.error]', m.text().slice(0, 300)); });
await p.goto((process.env.DEV_ORIGIN ?? 'http://localhost:5173') + '/play/?webgl&autostart');
console.log('mode:', await waitForGame(p));

const setup = await p.evaluate((which) => {
  const g = window.game;
  const crowds = [g.landmarks.campCrowd, ...(g.settlement?.crowds ?? [])].filter(Boolean);
  const C = which === 'camp' ? g.landmarks.campCrowd : crowds.find((c) => c.figs.some((f) => f.def.id === 'sol'));
  if (!C) return null;
  window.__C = C;
  const figs = C.figs.filter((f) => f.actor);
  const heads = C.heads().filter((h) => figs.some((f) => f.def.id === h.id));
  const c = heads.reduce((a, h) => a.add(h.pos), heads[0].pos.clone().multiplyScalar(0)).multiplyScalar(1 / heads.length);
  // approach from where the crowd faces (the average facing, in world space)
  C.mesh.updateWorldMatrix(true, false);
  const yaw = figs.reduce((a, f) => a + f.def.yaw, 0) / figs.length;
  const q = C.mesh.getWorldQuaternion(C.mesh.quaternion.clone());
  const dir = new c.constructor(Math.sin(yaw), 0, Math.cos(yaw)).applyQuaternion(q);
  window.__path = { c, dir };
  return { ids: figs.map((f) => f.def.id), r: figs.map((f) => +f.r.toFixed(2)), notice: figs.map((f) => f.def.notice ?? 5.5) };
}, which);
if (!setup) { console.log('no such crowd'); process.exit(1); }
console.log('crowd', which, setup);

// the walk: 15 m out → 3 m → wait → 15 m → wait → 3 m → wait (1.5 m/s), sampled every 100 ms
const legs = [[15, 15, 2], [15, 3, 0], [3, 3, 12], [3, 15, 0], [15, 15, 10], [15, 3, 0], [3, 3, 15]];
const log = await p.evaluate(async (legs) => {
  const g = window.game, C = window.__C, { c, dir } = window.__path;
  const out = [];
  let t0 = performance.now();
  const at = (d) => c.clone().addScaledVector(dir, d);
  for (const [from, to, hold] of legs) {
    const dur = hold || Math.abs(to - from) / 1.5;
    for (let s = 0; s <= dur; s += 0.1) {
      const d = hold ? from : from + (to - from) * (s / dur);
      const pos = at(d);
      pos.y = g.hf.heightAt(pos.x, pos.z);
      g.player.teleport(pos);
      const look = c.clone().sub(pos);
      g.cam.snap(Math.atan2(-look.x, -look.z), -0.1);
      await new Promise((r) => setTimeout(r, 100));
      out.push({
        t: (performance.now() - t0) / 1000, d: +d.toFixed(2),
        f: C.figs.filter((f) => f.actor).map((f) => ({ id: f.def.id, near: f.near, mode: f.mode, look: +f.look.toFixed(3), ...f.actor.state() })),
      });
    }
  }
  return out;
}, legs);

// ---- report
const ids = setup.ids;
const nb = await p.evaluate(() => Object.fromEntries(window.__C.figs.filter((f) => f.actor).map((f) => [f.def.id, f.nb.map((g) => g.def.id)])));
console.log('neighbours (≤4.5 m):', nb);
for (const id of ids) {
  const ev = [];
  let prev = null;
  for (const s of log) {
    const f = s.f.find((x) => x.id === id);
    if (!prev || prev.near !== f.near) ev.push(`${s.t.toFixed(1)}s near=${f.near} (d ${s.d})`);
    if (prev && prev.mode !== f.mode) ev.push(`${s.t.toFixed(1)}s head→${f.mode}`);
    if (prev && prev.clip !== f.clip) ev.push(`${s.t.toFixed(1)}s ${prev.clip}→${f.clip} [${f.src}] @${f.t.toFixed(2)}`);
    prev = f;
  }
  console.log(`\n${id} (rate ${log[0].f.find((x) => x.id === id).rate.toFixed(3)}):\n  ` + ev.join('\n  '));
}
// neighbours starting one motion within 3 s of each other
const starts = [];
for (let i = 1; i < log.length; i++) for (const f of log[i].f) {
  const pf = log[i - 1].f.find((x) => x.id === f.id);
  if (pf.clip !== f.clip) starts.push({ id: f.id, src: f.src, t: log[i].t });
}
const clash = starts.filter((a, i) => starts.some((b2, j) => j !== i && b2.id !== a.id && nb[a.id]?.includes(b2.id) && b2.src === a.src && Math.abs(b2.t - a.t) < 3));
console.log(`\nswitches: ${starts.length}; neighbours starting the same motion within 3 s: ${clash.length ? JSON.stringify(clash) : 'none'}`);
const sameSecond = starts.filter((a, i) => starts.some((b2, j) => j !== i && b2.id !== a.id && Math.abs(b2.t - a.t) < 1 && b2.src === a.src));
console.log(`anyone starting the same motion within 1 s of anyone: ${sameSecond.length ? JSON.stringify(sameSecond) : 'none'}`);

// ---- fast-forward: the player standing at 3 m for `minutes`, then walking away for as long
const ff = await p.evaluate((minutes) => {
  const g = window.game, C = window.__C, { c, dir } = window.__path;
  const res = [];
  for (const d of [3, 15]) {
    const pos = c.clone().addScaledVector(dir, d);
    pos.y = g.hf.heightAt(pos.x, pos.z) + 1.6;
    const t0 = performance.now();
    let switches = 0;
    const last = new Map();
    for (let i = 0; i < minutes * 60 * 30; i++) {
      C.update(1 / 30, pos);
      for (const f of C.figs) if (f.actor) { const s = f.actor.state().clip; if (last.has(f.def.id) && last.get(f.def.id) !== s) switches++; last.set(f.def.id, s); }
    }
    const st = C.figs.filter((f) => f.actor).map((f) => ({ id: f.def.id, ...f.actor.state() }));
    res.push({ d, ms: Math.round(performance.now() - t0), switches, st });
  }
  return res;
}, minutes);
for (const r of ff) {
  console.log(`\nafter ${minutes} min with the player at ${r.d} m (${r.switches} switches, ${(r.ms / (minutes * 60 * 30)).toFixed(3)} ms/update):`);
  for (const s of r.st) console.log(`  ${s.id.padEnd(7)} ${s.clip.padEnd(8)} ${s.src.padEnd(28)} t=${s.t.toFixed(2)} rate ${s.rate.toFixed(3)}`);
  for (let i = 0; i < r.st.length; i++) for (let j = i + 1; j < r.st.length; j++) {
    const a = r.st[i], c2 = r.st[j];
    if (a.src === c2.src) console.log(`  same motion: ${a.id}/${c2.id} ${a.clip}/${c2.clip} Δt ${Math.abs(a.t - c2.t).toFixed(2)} s`);
  }
}
await b.close();
