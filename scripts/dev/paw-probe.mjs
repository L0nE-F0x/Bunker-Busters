// Feet against the ground for the Meshy wolves/coyotes: each frame, the lowest skinned vertex of
// every paw vs the terrain under it (m; negative = through the soil). Needs `npm run dev`.
//   node scripts/dev/paw-probe.mjs [seconds=20] [--coyote] [--walk] [--shots dir]
import { launch, waitForGame } from './browser.mjs';

const args = process.argv.slice(2);
const secs = +(args.find((a) => /^\d+$/.test(a)) ?? 20);
const coyote = args.includes('--coyote');
const shotsAt = args.indexOf('--shots');
const shots = shotsAt >= 0 ? args[shotsAt + 1] : null;
const url = 'http://localhost:5173/play/?webgl&autostart' + (args.includes('--proc') ? '&procwolf' : '');
const b = await launch();
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(url);
await waitForGame(p);
await p.waitForTimeout(2500);
await p.evaluate(({ coyote, walk }) => {
  const g = window.game;
  g.combat.difficulty = 'story';
  g.atmo.hour = 10;
  const P = g.player.position;
  if (coyote) g.fauna.coyotes.summon?.(P);
  else g.fauna.summonPack(P, walk ? 40 : 22, !walk, 4);
  const skins = coyote ? g.fauna.coyotes.skins : g.fauna.skins;
  const T = window.THREE_ || null;
  // paw vertices: weighted > 0.5 to a leg's last bone, the lowest 40 at bind per paw
  const s0 = skins.slots[0];
  const mesh = s0.skinned[0];
  const bones = mesh.skeleton.bones.map((b) => b.name);
  const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight, pos = mesh.geometry.attributes.position;
  const paws = {};
  for (let v = 0; v < si.count; v++) {
    for (let k = 0; k < 4; k++) {
      const n = bones[si.getComponent(v, k)];
      if (sw.getComponent(v, k) > 0.5 && /leg2$/.test(n)) (paws[n] ??= []).push(v);
    }
  }
  for (const n in paws) paws[n] = paws[n].sort((a, b) => pos.getY(a) - pos.getY(b)).slice(0, 40);
  window.__paw = { skins, paws, rec: [] };
}, { coyote, walk: args.includes('--walk') });
const t0 = Date.now();
let shotN = 0;
while (Date.now() - t0 < secs * 1000) {
  await p.evaluate(() => {
    const { skins, paws, rec } = window.__paw;
    const g = window.game;
    const v = new g.player.position.constructor();
    const wolves = skins === g.fauna.skins ? g.fauna.pack.wolves : g.fauna.coyotes.pack;
    skins.slots.forEach((s, i) => {
      if (!s.root.visible) return;
      const w = wolves.find((w) => w.slot === i);
      const mesh = s.skinned[0];
      mesh.skeleton.update();
      const row = { i, sp: +(w?.speed ?? 0).toFixed(2), dead: w?.dead ?? -1, paws: {}, slide: [] };
      const now = performance.now() / 1000;
      const prev = (window.__paw.prev ??= {});
      for (const n in paws) {
        let lo = 1e9, lx = 0, lz = 0;
        for (const vi of paws[n]) {
          mesh.getVertexPosition(vi, v);
          v.applyMatrix4(mesh.matrixWorld);
          const d = v.y - g.hf.heightAt(v.x, v.z);
          if (d < lo) { lo = d; lx = v.x; lz = v.z; }
        }
        row.paws[n] = +lo.toFixed(3);
        // the IK's own sole point (fixed on the paw, not whichever vertex is lowest)
        const leg = s.legs?.find((l) => l.end.name === n);
        if (leg) {
          let best = 1e9;
          for (const sp of leg.sole) { const p2 = sp.clone().applyMatrix4(leg.end.matrixWorld); if (p2.y < best) { best = p2.y; lx = p2.x; lz = p2.z; } }
          lo = best - g.hf.heightAt(lx, lz);
        }
        // a planted paw's ground speed (m/s): skating
        const k = i + n, q = prev[k];
        if (q && now - q.t < 0.1 && lo < 0.006 && q.lo < 0.006) row.slide.push(Math.hypot(lx - q.x, lz - q.z) / (now - q.t));
        prev[k] = { x: lx, z: lz, lo, t: now };
      }
      rec.push(row);
    });
  });
  if (shots && shotN < 12 && (Date.now() - t0) > shotN * 700 + 1500) {
    await p.evaluate(() => {
      const { skins } = window.__paw; const g = window.game;
      const s = skins.slots.find((s) => s.root.visible);
      if (!s) return;
      const P = s.root.position; const yaw = s.root.rotation.y;
      // a low side view, 3.2 m off its flank
      const side = { x: Math.cos(yaw), z: -Math.sin(yaw) };
      g.player.teleport(new P.constructor(P.x + side.x * 3.2, P.y, P.z + side.z * 3.2));
      g.cam.snap(Math.atan2(-side.x, -side.z) + Math.PI, -0.12);
    });
    await p.waitForTimeout(60);
    await p.screenshot({ path: `${shots}/paw-${String(shotN).padStart(2, '0')}.png` });
    shotN++;
  }
  await p.waitForTimeout(30);
}
const rec = await p.evaluate(() => window.__paw.rec);
await b.close();
const by = (f) => rec.filter(f);
const report = (label, rows) => {
  if (!rows.length) return;
  const all = rows.flatMap((r) => Object.values(r.paws));
  const minPer = rows.map((r) => Math.min(...Object.values(r.paws)));
  const q = (a, k) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(k * (s.length - 1))]; };
  const sl = rows.flatMap((r) => r.slide);
  const sp = rows.map((r) => r.sp);
  if (sl.length) console.log(`${label.padEnd(10)} speed p50 ${q(sp, 0.5)}  planted-paw skate m/s: p50 ${q(sl, 0.5).toFixed(2)} p90 ${q(sl, 0.9).toFixed(2)}`);
  console.log(`${label.padEnd(10)} n=${rows.length}  lowest paw/frame: p5 ${q(minPer, 0.05).toFixed(3)} p50 ${q(minPer, 0.5).toFixed(3)} p95 ${q(minPer, 0.95).toFixed(3)}  all paws p5 ${q(all, 0.05).toFixed(3)}  frames with a paw < -3cm: ${(100 * minPer.filter((x) => x < -0.03).length / rows.length).toFixed(0)}%  > +5cm: ${(100 * minPer.filter((x) => x > 0.05).length / rows.length).toFixed(0)}%`);
};
report('standing', by((r) => r.dead < 0 && r.sp < 0.2));
report('walk', by((r) => r.dead < 0 && r.sp >= 0.2 && r.sp < 3));
report('trot', by((r) => r.dead < 0 && r.sp >= 3 && r.sp <= 6));
report('run', by((r) => r.dead < 0 && r.sp > 6));
report('dead', by((r) => r.dead >= 0));
