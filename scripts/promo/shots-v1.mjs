// v1.0 launch footage: all eight bunkers, the world, the heists, the people. Each shot is data:
// a clock, an exposure, a setup (JS run once in the page) and a camera move, so a framing approved
// in a scout is exactly the one that gets recorded.
//   node scripts/promo/shots-v1.mjs <outdir> --scout [--size 1280x720] [names...]   # stills at start/middle/end + a sheet
//   node scripts/promo/shots-v1.mjs <outdir> [--size 2560x1440] [names...]          # 60 fps takes + game audio
// Names may be prefixes ending in '*' (e.g. 'apex*'). BB_PORT picks the dev server.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { openRig } from './rig.mjs';
import { SHOTS } from './shots-v1-list.mjs';

const args = process.argv.slice(2);
const OUT = args[0];
const scout = args.includes('--scout');
const si = args.indexOf('--size');
const SIZE = (si >= 0 ? args[si + 1] : scout ? '1280x720' : '2560x1440').split('x').map(Number);
const names = args.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i] !== SIZE.join('x'));
// frames that aren't grabbed (the pre-roll, a scout's way to its stills) step at 20 fps: the game
// caps its own step at 1/20 s, so nothing moves differently, and there are a third of the frames
const STEP = 20;
const pick = (s) => !names.length || names.some((n) => (n.endsWith('*') ? s.name.startsWith(n.slice(0, -1)) : s.name === n));
const list = SHOTS.filter(pick);
if (!list.length) { console.log('no shots match', names); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const J = JSON.stringify;

/** The camera as page-side source: (t) => void, t in seconds from the start of the move. */
function camSrc(s) {
  const c = s.cam;
  if (typeof c === 'string') return c;
  const conv = (sp) => (!sp ? '((p) => p)' : sp.startsWith('rel:') ? `((p) => D.rel('${sp.slice(4)}', p))` : `D.${sp}`);
  if (c.orbit) {
    const o = c.orbit;
    const r = (v) => (Array.isArray(v) ? v : [v, v]);
    return `(t) => { const k = D.${c.ease || 'lin'}(t / ${s.dur}); const R = (v) => D.lerp(v[0], v[1], k); const cv = ${conv(c.space)}; const cc = cv(${J(o.c)});
      D.orbit(cc, R(${J(r(o.ang))}), R(${J(r(o.dist))}), R(${J(r(o.h))}), R(${J(r(o.atH ?? 1.5))}), R(${J(r(o.fov ?? 50))}), R(${J(r(o.roll ?? 0))})); }`;
  }
  const fov = Array.isArray(c.fov) ? c.fov : [c.fov ?? 50, c.fov ?? 50];
  const e = c.e.length === 2 && Array.isArray(c.e[0]) ? c.e : [c.e, c.e];
  const a = c.a.length === 2 && Array.isArray(c.a[0]) ? c.a : [c.a, c.a];
  return `(t) => { const cv = ${conv(c.space)}; D.move(t, ${s.dur}, cv(${J(e[0])}), cv(${J(e[1])}), cv(${J(a[0])}), cv(${J(a[1])}), ${fov[0]}, ${fov[1]}, '${c.ease || 'lin'}', ${c.roll ?? 0}); }`;
}

/** Page-side setup for a shot: the mode, the clock, the weather, the exposure, then its own setup. */
const setupSrc = (s) => `(() => {
  const g = D.g;
  D.releaseAll?.(); document.body.classList.remove('capmg');
  try { window.__lp?.finish?.('abort'); } catch {} try { window.__kp?.abort?.(); } catch {}
  try { window.__hk?.finish?.({ done: [], traced: false, aborted: true }); } catch {}
  S.reset();
  ${s.mode === 'play' ? `g.mode = 'playing'; g.atmo.hour = ${s.hour}; g.atmo.paused = true; g.envTimer = 0; if (g.hands) g.hands.root.visible = ${!!s.hands};` : `D.cine(${s.hour});`}
  g.weather.storm(${s.storm || 0}, true);
  ${s.cover !== undefined ? `g.atmo.cloudCover = ${s.cover};` : ''}
  D.expo = ${s.expo || 1};
  ${s.setup || ''}
})()`;

const rig = await openRig({
  url: '/play/?webgl&q=ultra&skip=ui&autostart',
  size: SIZE,
  audio: scout ? 0 : list.reduce((t, s) => t + s.dur + (s.settle ?? 2) + 0.5, 10),
});
await rig.begin({ music: 0, sfx: 0.9 });
await rig.eval(fs.readFileSync(new URL('./solvers.js', import.meta.url), 'utf8') + '\n;void 0;');
await rig.wait(600); // (the solvers import the minigame modules)
const rows = [];
for (const s of list) {
  await rig.eval(setupSrc(s));
  const cam = camSrc(s);
  const hook = (moving) => {
    const at = moving ? '(t)' : '(0)';
    const strikes = J(s.strikes || []);
    // (`each` only runs during the move itself, not the pre-roll: it's where timed events go)
    const body = `(t, dt) => { (${cam})${at}; ${moving ? `for (const st of ${strikes}) if (t - dt < st && t >= st) D.g.weather.strike(1);` : ''} ${s.each && moving ? `(${s.each})(t, dt);` : ''} }`;
    return s.mode === 'play' ? { post: body, pre: s.pre } : { pre: body };
  };
  await rig.run(s.settle ?? 2, { ...hook(false), fps: STEP });
  if (scout) {
    const marks = s.scoutAt ?? [0, 0.5, 1];
    const files = [];
    let t = 0;
    const h = hook(true);
    for (const [k, m] of marks.entries()) {
      const at = m * s.dur;
      if (k === 0) await rig.run(0.05, { ...h, fps: STEP }); // the move's first frame (resets t)
      else await rig.run(at - t, { ...h, keepT: true, fps: STEP });
      t = at;
      const f = `${OUT}/${s.name}-${k}.png`;
      await rig.still(f);
      files.push(f);
    }
    rows.push([s.name, files]);
    console.log('scouted', s.name);
  } else {
    await rig.record(`${OUT}/${s.name}.mp4`, s.dur, hook(true));
  }
  if (s.after) await rig.eval(s.after);
}
await rig.close();
if (scout && rows.length) {
  // one sheet: a row per shot (start, middle, end), labelled
  const sheet = `${OUT}/sheet-${Date.now() % 100000}.jpg`;
  const tiles = rows.flatMap(([, f]) => f);
  execFileSync('montage', [...tiles, '-tile', `3x${rows.length}`, '-geometry', '640x360+4+4', '-background', '#111', '-quality', '82', sheet]);
  console.log('sheet', sheet, rows.map(([n]) => n).join(' '));
}
