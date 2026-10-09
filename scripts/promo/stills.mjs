// Key art for social posts: 2560×1440 stills, HUD off, staged on the virtual clock. Each scene
// writes a few candidates (<name>-<k>.png) so the best moment can be picked.
//   node scripts/promo/stills.mjs <outdir> [names...]
import fs from 'node:fs';
import { openRig } from './rig.mjs';

const OUT = process.argv[2];
const only = new Set(process.argv.slice(3));
const SIZE = [2560, 1440];
const FIGHT = fs.readFileSync(new URL('./shots-combat.mjs', import.meta.url), 'utf8').match(/const FIGHT = `([\s\S]*?)`;/)[1];

// [name, setup js, seconds to run before the first still, stills: [count, every s], pre?, post?]
const SCENES = [
  ['camp', `D.cine(17.85); D.expo = 1; const c = D.camp; D.cam(c([-18.6, 2.15, -4.2]), c([-5.9, 1.15, 2.9]), 31);`, 2, [2, 0.6]],
  ['camp-close', `D.cine(18.3); const c = D.camp; D.cam(c([-11.6, 1.35, 1.0]), c([-7.2, 0.95, 4.6]), 46);`, 2, [2, 0.6]],
  ['skyline', `D.cine(18.1); D.cam([-14, 6.2, 87], [-300, 30, -330], 30);`, 2, [1, 1]],
  ['vista', `D.cine(17.6); D.cam([-62, 2.0, 37], [-340, 40, -380], 39);`, 2, [1, 1]],
  ['garage-sunset', `D.cine(17.5); D.orbit([96, 0, -150], 5.58, 42, 6.5, 4.5, 48);`, 3, [4, 1.2]],
  ['garage-night', `D.cine(22.3); D.expo = 1.35; D.orbit([96, 0, -150], 0.3, 29, 1.7, 3, 55);`, 3, [4, 1.0]],
  ['creek', `D.cine(18.6); D.expo = 1; const t = D.town; D.cam(t([0.4, 1.45, 5.4]), t([-0.7, 1.0, 0]), 53);`, 2, [3, 0.8]],
  ['jet', `D.cine(17.4); D.orbit([-300, 0, 255], 3.45, 58, 6, 3, 45);`, 2, [1, 1]],
  ['coldstorage', `D.cine(22.5); D.expo = 1.5; D.orbit([290, 0, -262], 0.5, 52, 2.6, 6, 50);`, 2, [1, 1]],
  ['storm-city', `D.cine(16.8); D.g.weather.storm(0.6, true); D.cam([-60, 2.3, 36], [-50, 21, -300], 53);`, 3, [2, 1]],
  // playing mode from here (the free camera via the post hook, or first person)
  ['seedbot', `D.g.mode = 'playing'; D.g.player.model.root.visible = true; D.expo = 1.25; D.g.weather.storm(0, true); D.arm('revolver'); D.g.arms.equip(null, true); D.tame();
    const o = D.g.garage.b.origin; D.place(o.x + 3, o.z + 16, 0.1, 0.12); D.g.atmo.hour = 22.3; D.g.atmo.paused = true; D.g.envTimer = 0;
    D.g.hands.flashlightOn = true; D.g.player.flashlight = true; const d = D.g.garage.drone; d.position.set(o.x + 1, o.y + 3.4, o.z + 11);`, 0.6, [8, 0.25],
    `(t, dt) => { D.g.hands.root.visible = false; }`, `(t) => { const d = D.g.garage.drone.position, p = D.g.player.position; D.cam([p.x + 1.7, 0.45, p.z + 2.6], d, 50); }`],
  ['combat', `D.g.mode = 'playing'; D.g.player.model.root.visible = true; D.expo = 1; D.g.weather.storm(0, true); D.releaseAll(); D.place(-60, 40, 0.6, -0.03); D.g.atmo.hour = 17.45; D.g.atmo.paused = true; D.g.envTimer = 0;
    D.g.hands.flashlightOn = false; D.g.player.flashlight = false; D.arm('rifle'); D.g.recovery.summon(D.g.player.position, D.g.cam.yaw, 14, 4, true); F.reset();`, 1.2, [14, 0.35],
    `(t, dt) => F.shoot(t, dt, { rate: 7, every: 0.7, delay: 0.3, tol: 0.03, h: 1.3 })`],
  ['contractor', `D.g.mode = 'playing'; D.g.player.model.root.visible = true; D.expo = 1; D.releaseAll(); D.place(-60, 40, 0.6, 0); D.g.atmo.hour = 17.5; D.g.atmo.paused = true; D.g.envTimer = 0;
    D.arm('rifle'); D.g.recovery.summon(D.g.player.position, D.g.cam.yaw, 15, 3, true); F.reset();`, 3, [8, 0.4],
    `(t, dt) => { D.g.hands.root.visible = false; }`,
    `(t) => { const sq = D.squad(); if (!sq.length) return; const m = F.s.close && F.s.close.alive ? F.s.close : (F.s.close = sq[0]);
      const c = m.h.pos, p = D.g.player.position; const toP = Math.atan2(p.x - c.x, p.z - c.z); const a = toP + 0.75 + t * 0.06, r = 3.4;
      D.cam([c.x + Math.sin(a) * r, 0.9, c.z + Math.cos(a) * r], [c.x, 1.25, c.z], 40); }`],
  ['wolves', `D.g.mode = 'playing'; D.g.player.model.root.visible = true; D.expo = 1; D.releaseAll(); D.place(-20, 120, 2.2, 0); D.g.atmo.hour = 18.3; D.g.atmo.paused = true; D.g.envTimer = 0;
    D.arm('revolver'); D.g.fauna.summonPack(D.g.player.position, 34, true, 4); F.reset();`, 3.0, [10, 0.3],
    `(t, dt) => { D.g.hands.root.visible = false; }`,
    `(t) => { const w = F.wolf(); const p = D.g.player.position; if (!w) return; F.s.c = F.s.c || [w.pos.x, w.pos.z];
      F.s.c[0] += (w.pos.x - F.s.c[0]) * 0.06; F.s.c[1] += (w.pos.z - F.s.c[1]) * 0.06;
      const dx = F.s.c[0] - p.x, dz = F.s.c[1] - p.z, L = Math.hypot(dx, dz) || 1;
      D.cam([p.x - dz / L * 3 + dx / L * 1.0, 0.45, p.z + dx / L * 3 + dz / L * 1.0], [F.s.c[0], 0.6, F.s.c[1]], 36); }`],
];

const list = SCENES.filter(([n]) => !only.size || only.has(n));
fs.mkdirSync(OUT, { recursive: true });
const rig = await openRig({ url: '/play/?webgl&q=ultra&skip=ui&autostart', size: SIZE });
await rig.begin();
await rig.eval(FIGHT);
for (const [name, setup, lead, [count, every], pre, post] of list) {
  await rig.eval(`(() => { ${setup} })()`);
  await rig.run(lead, { pre, post });
  for (let k = 0; k < count; k++) {
    if (k) await rig.run(every, { pre, post });
    await rig.still(`${OUT}/${name}-${k}.png`);
  }
  console.log('stills', name);
}
await rig.close();
