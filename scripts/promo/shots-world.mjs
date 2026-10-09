// Trailer footage, session A: establishing shots on the free camera (no player), with the world's
// own sound (wind, fire, wildlife; music off). Writes <out>/<name>.mp4 + .wav.
//   node scripts/promo/shots-world.mjs <outdir> [names...]
import { openRig } from './rig.mjs';

const OUT = process.argv[2];
const only = new Set(process.argv.slice(3));
const J = JSON.stringify;

// Each shot: hour, seconds, and a camera move (eye/target from → to). Points are world
// [x, heightAboveGround, z] unless `space` says camp/town/garage (converted in the page).
const SHOTS = [
  { name: 'vista', hour: 17.6, dur: 7, e: [[-60, 1.6, 40], [-64, 2.6, 33]], a: [[-340, 40, -380], [-340, 38, -380]], fov: [40, 38] },
  { name: 'skyline', hour: 18.1, dur: 6, e: [[-20, 6, 90], [-6, 6.5, 84]], a: [[-300, 30, -330], [-300, 30, -330]], fov: [30, 30] },
  { name: 'jet', hour: 17.4, dur: 6, orbit: { c: [-300, 0, 255], ang: [3.25, 3.6], dist: [62, 56], h: [7, 5], atH: 3, fov: 45 } },
  { name: 'coldstorage', hour: 22.5, dur: 6, expo: 1.5, orbit: { c: [290, 0, -262], ang: [0.45, 0.55], dist: [62, 48], h: [3, 2.5], atH: 6, fov: 50 } },
  { name: 'garage-crane', hour: 17.5, dur: 6, orbit: { c: [96, 0, -150], ang: [5.62, 5.55], dist: [46, 40], h: [10, 4.5], atH: [5, 4], fov: 48 } },
  { name: 'garage-front', hour: 17.5, dur: 6, orbit: { c: [96, 0, -150], ang: [2.5, 2.7], dist: [44, 40], h: [3, 3.5], atH: 4, fov: 45 } },
  { name: 'garage-night', hour: 22.3, dur: 7, expo: 1.35, orbit: { c: [96, 0, -150], ang: [0.25, 0.35], dist: [32, 27], h: [1.6, 1.8], atH: 3, fov: 55 } },
  { name: 'creek', hour: 18.6, dur: 6, space: 'town', e: [[0.6, 1.5, 6.1], [0.2, 1.4, 4.6]], a: [[-0.7, 1.0, 0], [-0.7, 1.0, 0]], fov: [54, 52] },
  { name: 'camp', hour: 18.3, dur: 7, space: 'camp', e: [[-12.4, 1.45, 0.2], [-11.2, 1.3, 1.4]], a: [[-7.2, 0.95, 4.6], [-7.2, 0.95, 4.6]], fov: [50, 46] },
  { name: 'camp-wide', hour: 17.8, dur: 7, space: 'camp', e: [[-19, 2.3, -4.5], [-17.5, 2.0, -3.6]], a: [[-5.9, 1.2, 2.9], [-5.9, 1.1, 2.9]], fov: [32, 31] },
  { name: 'nightsky', hour: 23.0, dur: 6, expo: 1.3, e: [[-60, 2, 40], [-60, 2, 40]], a: [[-200, 140, -200], [-200, 25, -200]], fov: [60, 60], easing: 'ease' },
  { name: 'storm-wall', hour: 16.8, dur: 6, storm: 0.3, e: [[-60, 2, 40], [-58, 2.2, 36]], a: [[200, 30, 40], [200, 26, 0]], fov: [55, 55] },
  { name: 'storm-city', hour: 16.8, dur: 6, storm: 0.6, e: [[-60, 2, 40], [-60, 2.4, 34]], a: [[-60, 20, -300], [-40, 22, -300]], fov: [55, 52] },
  { name: 'lightning', hour: 21.5, dur: 7, storm: 0.95, expo: 1.6, strikes: [0.8, 3.6, 5.4], e: [[-60, 2, 40], [-60, 2.2, 38]], a: [[200, 40, 40], [200, 40, 20]], fov: [60, 60] },
  { name: 'dawn', hour: 6.25, dur: 6, e: [[-60, 3, 40], [-60, 3, 40]], a: [[300, 15, 60], [300, 15, 20]], fov: [45, 45] },
];

const camSrc = (s) => {
  const o = s.orbit;
  if (o) {
    const r = (v) => (Array.isArray(v) ? v : [v, v]);
    return `(t) => { const k = D.${s.easing || 'lin'}(t / ${s.dur}); const R = (v) => D.lerp(v[0], v[1], k);
      D.orbit(${J(o.c)}, R(${J(r(o.ang))}), R(${J(r(o.dist))}), R(${J(r(o.h))}), R(${J(r(o.atH))}), R(${J(r(o.fov))})); }`;
  }
  const conv = s.space ? `D.${s.space}` : '((p) => p)';
  return `(t) => { const c = ${conv}; D.move(t, ${s.dur}, c(${J(s.e[0])}), c(${J(s.e[1])}), c(${J(s.a[0])}), c(${J(s.a[1])}), ${s.fov[0]}, ${s.fov[1]}, '${s.easing || 'lin'}'); }`;
};

const shots = SHOTS.filter((s) => !only.size || only.has(s.name));
const rig = await openRig({ url: '/play/?webgl&q=ultra&skip=ui', audio: shots.reduce((a, s) => a + s.dur + 2.5, 10) });
await rig.begin({ music: 0, sfx: 0.9 });
for (const s of shots) {
  await rig.eval((s) => {
    D.cine(s.hour);
    D.g.weather.storm(s.storm || 0, true);
    D.expo = s.expo || 1;
  }, s);
  const cam = camSrc(s);
  await rig.run(2.0, { pre: `(t) => (${cam})(0)` });
  const strikes = J(s.strikes || []);
  await rig.record(`${OUT}/${s.name}.mp4`, s.dur, { pre: `(t, dt) => { (${cam})(t); for (const st of ${strikes}) if (t - dt < st && t >= st) D.g.weather.strike(1); }` });
}
await rig.close();
