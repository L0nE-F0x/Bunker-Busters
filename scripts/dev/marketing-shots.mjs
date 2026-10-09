// Regenerate the website screenshots in public/media/ (1920×1080, Ultra, HUD hidden). Needs `npm run dev`.
//   node scripts/dev/marketing-shots.mjs            # all
//   node scripts/dev/marketing-shots.mjs night camp # some
//   BB_MEDIA_OUT=/tmp/media/ node scripts/dev/marketing-shots.mjs  # preview somewhere else first
// After changing hero.jpg, also regenerate the share card: node scripts/dev/og-card.mjs
import { fileURLToPath } from 'node:url';
import { launch, waitForGame } from './browser.mjs';
// dev server origin (BB_PORT=5183 for a second server, e.g. from a worktree)
const ORIGIN = `http://localhost:${process.env.BB_PORT || 5173}`;

const OUT = process.env.BB_MEDIA_OUT || fileURLToPath(new URL('../../public/media/', import.meta.url));
const only = new Set(process.argv.slice(2));
const want = (n) => !only.size || only.has(n);

// teleport relative to The Garage, look (yaw, pitch), set the clock
const tp = (dx, dz, yaw, pitch, hour, extra = '') => `(() => { const g = window.game; const o = g.garage.b.origin; const p = o.clone(); p.x += ${dx}; p.z += ${dz}; p.y = g.hf.heightAt(p.x, p.z) + 0.2; g.player.teleport(p); g.cam.snap(${yaw}, ${pitch}); g.atmo.hour = ${hour}; g.envTimer = 0; ${extra} })()`;

// Free-camera shots from the title screen (no player, no hands): eye and target in camp space
// (Landmarks.campPoint: the fire at (−8, 0, 5), y above the ground) or Dry Creek's town space
// (its root group; the fire circle at (−0.4, 2.3)).
// The title's left-side menu shade is kept for the hero (the site's headline sits there).
const cine = (space, eye, at, fov, hour, shade = false) => `(() => {
  const g = window.game;
  g.mode = ${shade ? "'title'" : "'cine'"}; g.director.title = () => null; g.director.fade = 0; g.post.fade.value = 0;
  g.atmo.hour = ${hour}; g.atmo.paused = true; g.envTimer = 0;
  const V = g.camera.position.constructor;
  const town = (x, y, z) => { const v = g.scene.getObjectByName('dry-creek').localToWorld(new V(x, 0, z)); v.y = g.hf.heightAt(v.x, v.z) + y; return v; };
  const pt = (a) => '${space}' === 'camp' ? g.landmarks.campPoint(a[0], a[1], a[2]) : town(a[0], a[1], a[2]);
  g.camera.position.copy(pt(${JSON.stringify(eye)}));
  g.camera.fov = ${fov}; g.camera.updateProjectionMatrix();
  g.camera.lookAt(pt(${JSON.stringify(at)}));
})()`;

const CINE = [
  // the camp four round the fire at golden hour, under the canopy, framed right of the headline
  // (a long lens from across the forecourt, so the four stay together right of the headline)
  ['hero', cine('camp', [-19, 2.3, -4.5], [-5.9, 1.2, 2.9], 32, 17.75)],
  // the same fire at blue hour, string lights on, nearer
  ['camp', cine('camp', [-12.4, 1.45, 0.2], [-7.2, 0.95, 4.6], 50, 18.45)],
  // Dry Creek's fire circle at dusk: Sol on his log, Ren on her crate, the diner behind
  ['place-creek', cine('town', [0.6, 1.5, 6.1], [-0.7, 1.0, 0], 54, 18.6)],
];

const WORLD = [
  ['night', tp(4, 25, 0.12, 0.02, 22.3, 'g.hands.root.visible = true; g.hands.flashlightOn = true; g.player.flashlight = true; const d = g.garage.drone; d.position.copy(o.clone().add(new d.position.constructor(-3, 3.2, 15)));')],
  ['interior', tp(5, -2.2, 1.35, -0.12, 21.0, 'g.hands.flashlightOn = false; g.player.flashlight = false; window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyC" }));')],
  // a firefight on the flats: a Recovery squad advancing and shooting, a rifle up (sun behind you, so the
  // hi-vis catches it; the towers of the old city on the skyline)
  ['combat', `(() => { const g = window.game; g.hands.root.visible = true; g.weather.storm(0, true); g.combat.difficulty = 'story'; setInterval(() => { g.state.data.health = 100; g.post.damage.value = 0; }, 16); g.state.addItem('rifle', 1, true, true); g.state.addItem('ammo3030', 30, true, true); g.state.data.arms.mags.rifle = 7; g.arms.equip('rifle'); const p = g.player.position.clone(); p.x = -60; p.z = 40; p.y = g.hf.heightAt(p.x, p.z) + 0.2; g.player.teleport(p); g.cam.snap(0.6, -0.04); g.atmo.hour = 17.45; g.envTimer = 0; setTimeout(() => g.recovery.summon(g.player.position, g.cam.yaw, 14, 4, true), 400); })()`, 3400],
];

// Free camera in world space (from a running game): eye/target x, z, height above the ground at each
const free = (eye, at, fov, hour, cover = 0.55) => `(() => {
  const g = window.game; g.arms?.equip?.(null, true); g.hands.root.visible = false; g.mode = 'cine'; g.weather.storm(0, true); g.atmo.hour = ${hour}; g.atmo.paused = true; g.atmo.cloudCover = ${cover}; g.envTimer = 0;
  const c = g.camera; const [ex, eh, ez] = ${JSON.stringify(eye)}, [ax, ah, az] = ${JSON.stringify(at)};
  c.position.set(ex, g.hf.heightAt(ex, ez) + eh, ez); c.fov = ${fov}; c.updateProjectionMatrix();
  c.lookAt(ax, g.hf.heightAt(ax, az) + ah, az);
})()`;
// the new places: Apex Vault's rocket over the salt at golden hour, Waitlist City in its basin
// (free-camera shots go last in WORLD: they leave the game in 'cine')
WORLD.push(
  ['place-apex', free([-284, 1.6, -204], [-366, 12, -126], 50, 17.55)], // framed for the site's 21:9 crop
  // the jet down in the gouge under the cliff, low gold sun across the berms
  ['place-jet', free([-279, 1.4, 233], [-302, 4.5, 258], 54, 17.45)],
  ['place-waitlist', free([352, 2.2, 286], [300, 6, 312], 58, 16.9)],
);

const b = await launch();
async function session(url, steps) {
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await p.goto(url);
  await waitForGame(p);
  await p.waitForTimeout(9000); // let shaders compile + world settle
  for (const [name, js, wait = 6000] of steps) {
    await p.evaluate(js);
    await p.waitForTimeout(wait);
    await p.screenshot({ path: OUT + name + '.jpg', type: 'jpeg', quality: 86 });
    console.log('saved', name + '.jpg');
  }
  await p.close();
}
const cineShots = CINE.filter(([n]) => want(n));
if (cineShots.length) await session(ORIGIN + '/play/?webgl&q=ultra&skip=ui', cineShots);
const world = WORLD.filter(([n]) => want(n));
if (world.length) await session(ORIGIN + '/play/?webgl&q=ultra&skip=ui&autostart', world);
if (want('lockpick')) {
  await session(ORIGIN + '/play/?webgl&q=ultra&autostart', [[
    'lockpick',
    `(() => { void window.game.ctx.ui.lockpick({ pins: 5, title: 'VAULT LOCK', onBreak: () => true }); setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' })), 300); setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })), 600); })()`,
    1300,
  ]]);
}
await b.close();
