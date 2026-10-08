// Regenerate the website screenshots in public/media/ (1920×1080, Ultra, HUD hidden). Needs `npm run dev`.
//   node scripts/dev/marketing-shots.mjs            # all
//   node scripts/dev/marketing-shots.mjs night camp # some
// After changing hero.jpg, also regenerate the share card: node scripts/dev/og-card.mjs
import { fileURLToPath } from 'node:url';
import { launch, waitForGame } from './browser.mjs';
// dev server origin (BB_PORT=5183 for a second server, e.g. from a worktree)
const ORIGIN = `http://localhost:${process.env.BB_PORT || 5173}`;

const OUT = fileURLToPath(new URL('../../public/media/', import.meta.url));
const only = new Set(process.argv.slice(2));
const want = (n) => !only.size || only.has(n);

// teleport relative to The Garage, look (yaw, pitch), set the clock
const tp = (dx, dz, yaw, pitch, hour, extra = '') => `(() => { const g = window.game; const o = g.garage.b.origin; const p = o.clone(); p.x += ${dx}; p.z += ${dz}; p.y = g.hf.heightAt(p.x, p.z) + 0.2; g.player.teleport(p); g.cam.snap(${yaw}, ${pitch}); g.atmo.hour = ${hour}; g.envTimer = 0; ${extra} })()`;

const WORLD = [
  ['hero', tp(-14, 40, -0.32, 0.03, 17.55, 'g.hands.root.visible = false;')],
  ['night', tp(4, 25, 0.12, 0.02, 22.3, 'g.hands.root.visible = true; g.hands.flashlightOn = true; g.player.flashlight = true; const d = g.garage.drone; d.position.copy(o.clone().add(new d.position.constructor(-3, 3.2, 15)));')],
  ['interior', tp(5, -2.2, 1.35, -0.12, 21.0, 'g.hands.flashlightOn = false; g.player.flashlight = false; window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyC" }));')],
  // a firefight on the flats: a Recovery squad advancing and shooting, a rifle up
  ['combat', `(() => { const g = window.game; g.hands.root.visible = true; g.weather.storm(0, true); g.combat.difficulty = 'story'; setInterval(() => { g.state.data.health = 100; g.post.damage.value = 0; }, 16); g.state.addItem('rifle', 1, true, true); g.state.addItem('ammo3030', 30, true, true); g.state.data.arms.mags.rifle = 7; g.arms.equip('rifle'); const p = g.player.position.clone(); p.x = -60; p.z = 40; p.y = g.hf.heightAt(p.x, p.z) + 0.2; g.player.teleport(p); g.cam.snap(2.2, -0.04); g.atmo.hour = 17.45; g.envTimer = 0; setTimeout(() => g.recovery.summon(g.player.position, g.cam.yaw, 17, 4, true), 400); })()`, 3600],
  ['camp', `(() => { const g = window.game; window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyC" })); const c = g.landmarks.campPosition.clone(); c.x += 4.5; c.z += 4; c.y = g.hf.heightAt(c.x, c.z) + 0.2; g.player.teleport(c); g.cam.snap(Math.atan2(4.5, 4), -0.1); g.atmo.hour = 19.05; g.envTimer = 0; })()`],
];

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
