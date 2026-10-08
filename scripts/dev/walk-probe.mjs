// Movement regression probe: hold W in straight lines from random spots on the map and report every
// place the player stalls, with the colliders it was touching. Needs `npm run dev`; nothing on screen.
//
//   node scripts/dev/walk-probe.mjs [lines=150] [--sprint]        FPS=144 node scripts/dev/walk-probe.mjs
//
// Expect stalls only at real obstacles (rocks, wrecks, fences, terrain faces > ~45°). Ground-only
// stalls on gentle slopes mean the controller regressed (see NOTES "Invisible walls").
import { launch, waitForGame } from './browser.mjs';

const trials = +(process.argv[2] || 120);
const sprint = process.argv.includes('--sprint');
const b = await launch();
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(`${process.env.DEV_ORIGIN || 'http://localhost:5173'}/play/?webgl&autostart&skip=post,dust,haze`); // DEV_ORIGIN: another dev server
console.log('mode:', await waitForGame(p));
await p.waitForTimeout(3000);
const res = await p.evaluate(({ trials, sprint, FPS }) => {
  const g = window.game, pl = g.player, ph = g.physics, hf = g.hf, R = ph.R;
  g.mode = 'probe'; // stop playFrame from driving the player while we do
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const fake = { isDown: (c) => c === 'KeyW' || (sprint && c === 'ShiftLeft'), pressed: () => false };
  const describe = (col) => {
    const t = col.translation(), s = col.shape;
    const type = ['Ball', 'Cuboid', 'Capsule', 'Segment', 'Polyline', 'Triangle', 'TriMesh', 'HeightField', 'Compound', 'ConvexPolyhedron', 'Cylinder', 'Cone', 'RoundCuboid'][col.shapeType()] ?? col.shapeType();
    const extra = s.radius !== undefined ? ` r=${s.radius.toFixed(2)}` : s.halfExtents ? ` half=${['x', 'y', 'z'].map((k) => s.halfExtents[k].toFixed(2)).join(',')}` : '';
    return `${type}${extra} @${t.x.toFixed(1)},${t.y.toFixed(1)},${t.z.toFixed(1)}${s.halfHeight !== undefined ? ` hh=${s.halfHeight.toFixed(2)}` : ''}`;
  };
  const stalls = [];
  const dt = 1 / FPS;
  let walked = 0;
  for (let k = 0; k < trials; k++) {
    const lim = hf.size * 0.38;
    const x = (rnd() - 0.5) * 2 * lim, z = (rnd() - 0.5) * 2 * lim;
    const yaw = rnd() * Math.PI * 2;
    pl.teleport(new pl.position.constructor(x, hf.heightAt(x, z) + 0.1, z));
    ph.world.timestep = dt;
    ph.step();
    let slow = 0, last = null;
    for (let i = 0; i < FPS * 25; i++) {
      pl.update(dt, fake, yaw, true);
      ph.step();
      const hs = Math.hypot(pl.velocity.x, pl.velocity.z);
      walked += hs * dt;
      if (i > FPS * 1.5 && hs < 0.6) slow++; else slow = 0;
      if (slow === Math.round(FPS / 4)) {
        const c = pl.controller;
        const hits = [];
        for (let j = 0; j < c.numComputedCollisions(); j++) {
          const h = c.computedCollision(j);
          if (h?.collider) hits.push(`${describe(h.collider)} n=${h.normal1 ? [h.normal1.x, h.normal1.y, h.normal1.z].map((v) => v.toFixed(2)).join(',') : '?'}`);
        }
        const pp = pl.position;
        const ground = hf.heightAt(pp.x, pp.z);
        const nrm = hf.normalAt(pp.x, pp.z);
        last = { trial: k, at: [pp.x.toFixed(1), pp.y.toFixed(2), pp.z.toFixed(2)].join(','), groundVisual: ground.toFixed(2), slopeDeg: (Math.acos(nrm.y) * 180 / Math.PI).toFixed(1), grounded: pl.grounded, yaw: yaw.toFixed(2), hits };
        stalls.push(last);
        break;
      }
    }
  }
  return { stalls, walked: Math.round(walked) };
}, { trials, sprint, FPS: +process.env.FPS || 60 });
console.log(`walked ${res.walked} m over ${trials} lines, ${res.stalls.length} stalls`);
for (const s of res.stalls) console.log(JSON.stringify(s));
await b.close();
