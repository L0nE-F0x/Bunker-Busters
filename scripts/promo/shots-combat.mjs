// Trailer footage, session B: fights in first person (scripted aim) and third person, with the
// game's own sound (music off). Writes <out>/<name>.mp4 + .wav.
//   node scripts/promo/shots-combat.mjs <outdir> [names...]
import { openRig } from './rig.mjs';

const OUT = process.argv[2];
const only = new Set(process.argv.slice(3));
const want = (n) => !only.size || only.has(n);

// page-side choreography: aim at the nearest live thing, fire when on it
const FIGHT = `
  window.F = {
    s: {},
    reset() { F.s = { cool: 0.5, tgt: null, hold: 0 }; },
    groundY(p) { return D.ground(p.x, p.z); },
    /** Track and shoot. rate: aim speed; every: seconds between shots; tol: rad; h: aim height. */
    shoot(t, dt, { rate = 6, every = 0.8, tol = 0.022, maxAng = 1.0, delay = 0, h = 1.2, list, lead = 0 } = {}) {
      const s = F.s;
      const dead = (x) => !x.alive;
      if (s.tgt && dead(s.tgt)) { s.tgt = null; s.hold = 0.35; }
      if (!s.tgt) s.tgt = list ? list() : D.target(maxAng);
      s.cool -= dt; s.hold -= dt;
      if (!s.tgt) return;
      const x = s.tgt;
      const p = x.h ? D.chest(x, h) : new D.V(x.pos.x, F.groundY(x.pos) + h, x.pos.z);
      // a hand on the mouse: quick to close in, then a tight track
      const err0 = D.aim(p, 0, dt);
      const err = D.aim(p, err0 < 0.08 ? rate * 2.5 : rate, dt);
      if (t > delay && err < tol && s.cool <= 0 && s.hold <= 0) { D.g.arms.trigger(); s.cool = every; }
    },
    wolf() {
      let best = null, bd = 1e9;
      for (const w of D.g.fauna.pack.wolves) if (w.alive && w.out) { const d = w.pos.distanceTo(D.g.player.position); if (d < bd) { bd = d; best = w; } }
      return best;
    },
  };
`;

const takes = [];
const take = (name, dur, setup, pre, opts = {}) => takes.push({ name, dur, setup, pre, ...opts });
const stage = (x, z, yaw, pitch, hour, extra = '') => `() => {
  D.releaseAll(); D.g.weather.storm(0, true); D.place(${x}, ${z}, ${yaw}, ${pitch});
  D.g.atmo.hour = ${hour}; D.g.atmo.paused = true; D.g.envTimer = 0; D.expo = 1;
  D.g.hands.flashlightOn = false; D.g.player.flashlight = false; ${extra} }`;

// lever rifle at golden hour, hip fire, a squad pushing in under the old city's towers
take('rifle-a', 9, stage(-60, 40, 0.6, -0.03, 17.45, `D.arm('rifle'); D.g.recovery.summon(D.g.player.position, D.g.cam.yaw, 15, 4, true);`),
  `(t, dt) => F.shoot(t, dt, { rate: 7, every: 0.7, delay: 0.8, tol: 0.03, h: 1.3 })`, { settle: 1.0 });
// down the sights at range: head shots
take('rifle-b', 8, stage(-80, 20, 1.0, -0.02, 17.5, `D.arm('rifle'); D.g.recovery.summon(D.g.player.position, D.g.cam.yaw, 19, 3, true);`),
  `(t, dt) => { D.hold('aim', t > 0.3); F.shoot(t, dt, { rate: 7, every: 0.85, delay: 1.0, h: 1.6, tol: 0.016 }); }`, { settle: 1.0 });
// pump shotgun: they rush you
take('shotgun', 6, stage(-80, 20, 1.2, -0.05, 17.3, `D.arm('shotgun'); D.g.recovery.summon(D.g.player.position, D.g.cam.yaw, 11, 2, true);`),
  `(t, dt) => F.shoot(t, dt, { rate: 9, every: 0.95, tol: 0.035, delay: 1.0, h: 1.1 })`, { settle: 1.0 });
// six-shooter against a wolf pack, last light
take('wolves-fp', 11, stage(-20, 120, 2.2, -0.04, 17.75, `D.arm('revolver'); D.g.fauna.summonPack(D.g.player.position, 30, true, 4);`),
  `(t, dt) => F.shoot(t, dt, { list: F.wolf, rate: 8, every: 0.42, tol: 0.035, delay: 2.0, h: 0.5, maxAng: 3 })`, { settle: 2.5 });
// close on a contractor in the fight: the camera circles him while he shoots at you
take('contractor-close', 7, stage(-60, 40, 0.6, 0, 17.5, `D.arm('rifle'); D.g.recovery.summon(D.g.player.position, D.g.cam.yaw, 15, 3, true);`),
  `(t, dt) => { D.g.hands.root.visible = false; }`, {
    settle: 3.0,
    post: `(t) => {
      const sq = D.squad(); if (!sq.length) return;
      const m = F.s.close && F.s.close.alive ? F.s.close : (F.s.close = sq[0]);
      const c = m.h.pos, p = D.g.player.position;
      const toP = Math.atan2(p.x - c.x, p.z - c.z);
      const a = toP + 0.75 + t * 0.06, r = 3.4;
      D.cam([c.x + Math.sin(a) * r, 0.9, c.z + Math.cos(a) * r], [c.x, 1.25, c.z], 40);
    }`,
  });
// a compliance charge in the middle of them (third person, wide)
take('blast-tp', 6, stage(-30, 0, 0.6, 0, 17.6, `D.arm('rifle'); D.g.recovery.summon(D.g.player.position, D.g.cam.yaw, 16, 4, false);`),
  `(t, dt) => { D.g.hands.root.visible = false; if (!F.s.boom && t > 1.5) { F.s.boom = 1; const ms = D.squad(); if (ms.length) { const c = ms.reduce((a, m) => a.add(m.h.pos), new D.V()).multiplyScalar(1 / ms.length); D.g.combat.explode(c, 5, 160, { source: 'player' }); } } }`, {
    settle: 1.5,
    post: `(t) => { const p = D.g.player.position, y = 0.6, f = [-Math.sin(y), -Math.cos(y)], r = [Math.cos(y), -Math.sin(y)];
      D.cam([p.x + r[0] * 6 + f[0] * 4, 1.0 + t * 0.06, p.z + r[1] * 6 + f[1] * 4], [p.x + f[0] * 16, 1.2, p.z + f[1] * 16], 46); }`,
  });
// first person: the charge from your side, then the rifle (a charge thrown, the blast, the rest)
take('blast-fp', 7, stage(-30, 0, 0.6, -0.05, 17.6, `D.arm('rifle'); D.g.recovery.summon(D.g.player.position, D.g.cam.yaw, 17, 4, false);`),
  `(t, dt) => { if (!F.s.boom && t > 1.2) { F.s.boom = 1; const ms = D.squad(); if (ms.length) { const c = ms.reduce((a, m) => a.add(m.h.pos), new D.V()).multiplyScalar(1 / ms.length); D.g.combat.explode(c, 5, 160, { source: 'player' }); } }
    if (t > 2.4) F.shoot(t, dt, { rate: 6, every: 0.75, list: () => D.squad()[0] || null }); }`, { settle: 1.5 });
// SeedBot finds you in the Garage yard at night (first person, torch on; tame zaps)
take('seedbot-fp', 9, stage(0, 0, 0.1, 0.12, 22.3, `D.arm('revolver'); D.g.arms.equip(null, true); D.tame();
  const o = D.g.garage.b.origin; D.place(o.x + 3, o.z + 16, 0.1, 0.12); D.expo = 1.25;
  D.g.hands.flashlightOn = true; D.g.player.flashlight = true;
  const d = D.g.garage.drone; d.position.set(o.x - 2, o.y + 3.4, o.z + 8);`),
  `(t, dt) => { const d = D.g.garage.drone; const p = d.position.clone(); p.y -= 0.25; D.aim(p, 3.5, dt); }`, { settle: 0.6 });
// SeedBot from below, its spotlight on you
take('seedbot-tp', 7, stage(0, 0, 0.1, 0.12, 22.3, `D.arm('revolver'); D.g.arms.equip(null, true); D.tame();
  const o = D.g.garage.b.origin; D.place(o.x + 3, o.z + 16, 0.1, 0.12); D.expo = 1.25;
  D.g.hands.flashlightOn = true; D.g.player.flashlight = true;
  const d = D.g.garage.drone; d.position.set(o.x + 1, o.y + 3.4, o.z + 11);`),
  `(t, dt) => { D.g.hands.root.visible = false; }`, {
    settle: 1.2,
    post: `(t) => { const d = D.g.garage.drone.position, p = D.g.player.position;
      D.cam([p.x + 1.6 + t * 0.12, 0.45, p.z + 2.6], d, 50); }`,
  });

// pickups: an unaware squad close in (the first shot lands before they know), wolves on the ridge
take('rifle-c', 8, stage(-60, 40, 0.6, -0.03, 17.45, `D.arm('rifle'); D.g.recovery.summon(D.g.player.position, D.g.cam.yaw, 12, 4, false);`),
  `(t, dt) => F.shoot(t, dt, { rate: 7, every: 0.72, delay: 0.9, tol: 0.03, h: 1.3, list: () => D.squad().sort((a, b) => a.h.pos.distanceTo(D.g.player.position) - b.h.pos.distanceTo(D.g.player.position))[0] || null })`, { settle: 0.8 });
take('wolves-tp2', 9, stage(-20, 120, 2.2, 0, 18.05, `D.arm('revolver'); D.g.fauna.summonPack(D.g.player.position, 34, true, 4);`),
  `(t, dt) => { D.g.hands.root.visible = false; }`, {
    settle: 1.0,
    post: `(t) => { const w = F.wolf(); const p = D.g.player.position; if (!w) return;
      F.s.c = F.s.c || [w.pos.x, w.pos.z];
      F.s.c[0] += (w.pos.x - F.s.c[0]) * 0.06; F.s.c[1] += (w.pos.z - F.s.c[1]) * 0.06;
      const dx = F.s.c[0] - p.x, dz = F.s.c[1] - p.z, L = Math.hypot(dx, dz) || 1;
      D.cam([p.x - dz / L * 3 + dx / L * 1.0, 0.45, p.z + dx / L * 3 + dz / L * 1.0], [F.s.c[0], 0.6, F.s.c[1]], 36); }`,
  });
take('wolves-charge', 8, stage(-20, 120, 2.2, 0, 18.0, `D.arm('revolver'); D.g.fauna.summonPack(D.g.player.position, 26, true, 4);`),
  `(t, dt) => { D.g.hands.root.visible = false; }`, {
    settle: 2.0,
    post: `(t) => { const p = D.g.player.position; const ws = D.g.fauna.pack.wolves.filter((w) => w.alive && w.out); if (!ws.length) return;
      const c = ws.reduce((a, w) => [a[0] + w.pos.x / ws.length, a[1] + w.pos.z / ws.length], [0, 0]);
      F.s.c = F.s.c || c; F.s.c[0] += (c[0] - F.s.c[0]) * 0.05; F.s.c[1] += (c[1] - F.s.c[1]) * 0.05;
      const dx = F.s.c[0] - p.x, dz = F.s.c[1] - p.z, L = Math.hypot(dx, dz) || 1;
      D.cam([p.x - dx / L * 1.2 + dz / L * 0.8, 0.35, p.z - dz / L * 1.2 - dx / L * 0.8], [F.s.c[0], 0.5, F.s.c[1]], 42); }`,
  });
take('approach2', 6, stage(0, 0, 0.15, 0.03, 22.4, `D.arm('revolver'); D.g.arms.equip(null, true); D.tame();
  const o = D.g.garage.b.origin; D.place(o.x + 6, o.z + 36, 0.15, 0.03); D.expo = 1.35;`),
  `(t, dt) => { D.hold('forward', true); D.hold('crouch', true); }`, { settle: 0.5 });

const list = takes.filter((t) => want(t.name));
const rig = await openRig({ url: '/play/?webgl&q=ultra&skip=ui&autostart', audio: list.reduce((a, t) => a + t.dur + (t.settle ?? 1.5) + 0.5, 10) });
await rig.begin({ music: 0, sfx: 0.9 });
await rig.eval(FIGHT);
for (const t of list) {
  await rig.eval(`(${t.setup})(); F.reset(); D.g.state.data.health = 100;`);
  await rig.run(t.settle ?? 1.5, { pre: t.pre, post: t.post });
  await rig.record(`${OUT}/${t.name}.mp4`, t.dur, { pre: t.pre, post: t.post });
  console.log('   squad', JSON.stringify(await rig.eval(() => (D.g.recovery.patrol?.members ?? []).map((m) => m.state[0]).join(''))));
}
await rig.close();
