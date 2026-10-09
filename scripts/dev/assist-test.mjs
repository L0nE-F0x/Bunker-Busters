// Controller aim assist (combat/aimAssist.ts), headless with a fake standard gamepad:
//   node scripts/dev/assist-test.mjs        (BB_URL=http://localhost:5173)
// Friction: the same right-stick push turns the view less across a contractor than across open desert.
// Pull: raising the sights a few degrees off a contractor eases the aim toward it; on the mouse it doesn't.
import { launch, waitForGame } from './browser.mjs';

const BASE = `${process.env.BB_URL || 'http://localhost:5173'}/play/?webgl&autostart`;
const b = await launch(process.env.GPU_MODE || 'nvidia');
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/GL Driver|Failed to load/.test(t)) console.log('[console.error]', t.slice(0, 300)); });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.addInitScript(() => {
  const pad = (window.__pad = { buttons: new Array(17).fill(0), axes: [0, 0, 0, 0] });
  navigator.getGamepads = () => [{
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
    buttons: pad.buttons.map((v) => ({ pressed: v > 0.5, touched: v > 0, value: v })), axes: pad.axes.slice(),
  }, null, null, null];
});
const wait = (ms) => p.waitForTimeout(ms);
const ev = (js) => p.evaluate(js);
const check = (name, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
await p.goto(BASE);
console.log('mode:', await waitForGame(p));
await wait(2000);
// a quiet spot, the revolver, one contractor 22 m ahead who isn't hunting (Story: nobody gets hurt)
await ev(`game.atmo.hour = 10; game.combat.difficulty = 'story';
  const P = game.player.position.clone(); P.set(-60, 0, 120); P.y = game.hf.heightAt(P.x, P.z) + 0.1; game.player.teleport(P);
  game.arms.equip('revolver'); 1`);
await wait(900);
await ev(`game.recovery.summon(game.player.position, game.cam.yaw, 22, 1, false);
  window.__t = () => [...game.recovery.hostiles()].filter((h) => h.alive).sort((a, b) => a.center.distanceTo(game.camera.position) - b.center.distanceTo(game.camera.position))[0]; 1`);
await wait(400);
// angle (rad) from the view to the contractor's chest; aim `off` rad to its right
const angTo = `(() => { const h = __t(); const to = h.center.clone().sub(game.camera.position).normalize(); return Math.acos(Math.min(1, to.dot(game.cam.forward))); })()`;
const aimAt = (off, pitchOff = 0) => ev(`(() => { const h = __t(); const d = h.center.clone().sub(game.camera.position); game.cam.snap(Math.atan2(-d.x, -d.z) - ${off}, Math.atan2(d.y, Math.hypot(d.x, d.z)) + ${pitchOff}); return 1; })()`);
// make the pad the device in use (a nudge of the right stick)
await ev(`window.__pad.axes = [0, 0, 0.5, 0]`); await wait(60); await ev(`window.__pad.axes = [0, 0, 0, 0]`); await wait(200);
check('pad is the device', (await ev('game.input.device')) === 'pad');

// friction: sweep across the target vs across nothing, same stick, same time
const sweep = async (off) => {
  await aimAt(off); await wait(150);
  const y0 = await ev('game.cam.yaw');
  await ev(`window.__pad.axes = [0, 0, 0.32, 0]`); await wait(250); await ev(`window.__pad.axes = [0, 0, 0, 0]`); await wait(80);
  return Math.abs((await ev('game.cam.yaw')) - y0);
};
const onT = await sweep(0.02), offT = await sweep(0.6);
check('friction slows the stick over a contractor', onT < offT * 0.8, `turned ${onT.toFixed(4)} over it vs ${offT.toFixed(4)} over sand (x${(onT / offT).toFixed(2)})`);

// pull: 3.5 degrees off, raise the sights (LT)
await aimAt(0.06, 0.02); await wait(150);
const a0 = await ev(angTo);
await ev(`window.__pad.buttons[6] = 1`); await wait(450);
const a1 = await ev(angTo);
await ev(`window.__pad.buttons[6] = 0`); await wait(500);
check('ADS pulls toward the contractor', a1 < a0 * 0.75, `${(a0 * 57.3).toFixed(2)} deg -> ${(a1 * 57.3).toFixed(2)} deg`);

// the pull is once per raise, and only a part of the way
check('the pull leaves the last bit to you', a1 > 0.004, `${(a1 * 57.3).toFixed(2)} deg left`);

// mouse: no pull
await ev(`game.input.setDevice('kbm')`);
await aimAt(0.06, 0.02); await wait(150);
const m0 = await ev(angTo);
await p.mouse.down({ button: 'right' }); await wait(450);
const m1 = await ev(angTo);
await p.mouse.up({ button: 'right' }); await wait(200);
check('no pull on the mouse', Math.abs(m1 - m0) < 0.004, `${(m0 * 57.3).toFixed(2)} deg -> ${(m1 * 57.3).toFixed(2)} deg`);

// through a wall: nothing (the target behind the player's own back = out of the cone; behind cover = no line)
const slowBehind = await ev(`(() => { const a = game.aimAssist; return a ? a.slow : -1; })()`);
check('assist exists', slowBehind >= 0);
await b.close();
