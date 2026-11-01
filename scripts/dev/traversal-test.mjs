// Ladders, mantling and what you can stand on (player/Traversal.ts, world/ladders.ts), headless.
//   node scripts/dev/traversal-test.mjs [all|ladders|mantle|safety|input]   (BB_PORT=5181 for a worktree's server)
// Screenshots go to $SHOTS (default: the system temp dir). Needs `npm run dev`.
import os from 'node:os';
import path from 'node:path';
import { launch, waitForGame } from './browser.mjs';

const ORIGIN = process.env.DEV_ORIGIN || `http://localhost:${process.env.BB_PORT || 5173}`;
const OUT = process.env.SHOTS ?? os.tmpdir();
const only = process.argv[2] || 'all';
const want = (k) => only === 'all' || only === k;

const b = await launch(process.env.GPU_MODE || 'nvidia');
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/GL Driver|GPU stall|Failed to load resource/.test(t)) errors.push(t.slice(0, 240)); });
// a fake standard gamepad (off until the input checks)
await p.addInitScript(() => {
  const pad = (window.__pad = { buttons: new Array(17).fill(0), axes: [0, 0, 0, 0], on: false });
  navigator.getGamepads = () => [pad.on ? {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
    buttons: pad.buttons.map((v) => ({ pressed: v > 0.5, touched: v > 0, value: v })), axes: pad.axes.slice(),
  } : null, null, null, null];
});
await p.goto(`${ORIGIN}/play/?webgl&autostart`);
await waitForGame(p);
await p.waitForTimeout(2500);

const ev = (js) => p.evaluate(js);
const wait = (ms) => p.waitForTimeout(ms);
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); return ok; };
const until = async (js, ms) => { for (let t = 0; t < ms; t += 50) { if (await ev(js).catch(() => false)) return true; await wait(50); } return false; };
const shot = async (name) => { const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('    shot', f); };
const st = () => ev(`(() => { const pl = game.player, t = pl.trav; return { k: t.kind, h: +t.h.toFixed(2), y: +pl.position.y.toFixed(3), g: pl.grounded, eq: game.arms?.equipped ?? null, x: pl.position.x, z: pl.position.z }; })()`);

await ev(`(() => {
  game.openPause = () => {};
  game.atmo.hour = 11;
  game.combat.difficulty = 'story';
  window.V = game.player.position.constructor;
  window.L = (id) => game.ladders.find((l) => l.id === id);
  // stand \`d\` m out from a ladder's foot, facing it
  window.atLadder = (id, d = 1.0) => { const l = L(id); const q = l.base.clone().addScaledVector(l.out, d); q.y = game.hf.heightAt(q.x, q.z) + 0.05; if (q.y < l.base.y - 0.3) q.y = l.base.y + 0.05; game.player.teleport(q); game.cam.snap(Math.atan2(l.out.x, l.out.z), 0.05); };
  window.press = (a) => game.input.press('act:' + a);
  window.release = (a) => game.input.release('act:' + a);
  window.releaseAll = () => { for (const a of ['forward', 'back', 'jump', 'sprint', 'crouch', 'interact']) game.input.release('act:' + a); game.input.moveZ = 0; };
  window.tap = async (a) => { press(a); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); release(a); };
})()`);
const pipes = () => ev(`game.renderer._pipelines?.caches?.size ?? -1`);
const pipes0 = await pipes();
const ladderIds = await ev(`game.ladders.map((l) => l.id)`);
console.log('ladders:', ladderIds.join(', '), '· pipelines at start:', pipes0);

// ---------------------------------------------------------------- ladders
async function climbToTop(id, label) {
  await ev(`atLadder('${id}', 1.0)`);
  await wait(400);
  await ev(`press('forward')`);
  const grabbed = await until(`game.player.trav.kind === 'ladder' || game.player.trav.kind === 'mount'`, 2500);
  check(`${label}: walking into it grabs it`, grabbed);
  const off = await until(`game.player.trav.kind === null && game.player.grounded && game.player.position.y > L('${id}').top.y - 0.3`, 15000);
  await ev(`release('forward')`);
  await wait(500);
  const s = await st();
  const top = await ev(`L('${id}').top.y`);
  check(`${label}: tops out standing on the landing`, off && Math.abs(s.y - top) < 0.15 && s.g && s.k === null, `y ${s.y} vs landing ${top.toFixed(3)}`);
  return s;
}

if (want('ladders')) {
  // the camp roof (the owner's screenshot): walk in, the gun goes away, up, over, the gun comes back
  const eq0 = (await st()).eq;
  await ev(`atLadder('camp-roof', 1.0)`);
  await wait(500);
  await shot('trav-ladder-foot.png');
  const prompt = await ev(`document.querySelector('.prompt')?.textContent ?? ''`);
  check('camp: a prompt at the foot names it', /Climb the ladder/.test(prompt), JSON.stringify(prompt));
  await ev(`press('forward')`);
  await until(`game.player.trav.kind === 'ladder'`, 2500);
  await wait(700);
  const s1 = await st();
  check('camp: on the ladder, gun put away', s1.k === 'ladder' && s1.eq === null, JSON.stringify({ k: s1.k, eq: s1.eq, had: eq0 }));
  const prompt2 = await ev(`document.querySelector('.prompt')?.textContent ?? ''`);
  check('camp: "Let go" names the jump key', /Let go/.test(prompt2), JSON.stringify(prompt2));
  await until(`game.player.trav.h > 1.6`, 4000);
  await shot('trav-ladder-climbing.png');
  await ev(`game.cam.snap(game.cam.yaw, 0.55)`);
  await wait(120);
  await shot('trav-ladder-lookup.png');
  await ev(`game.cam.snap(game.cam.yaw, 0.05)`);
  await until(`game.player.trav.kind === 'topOut' && game.player.trav.progress > 0.3`, 6000);
  await shot('trav-ladder-topout.png');
  const off = await until(`game.player.trav.kind === null && game.player.grounded`, 4000);
  await ev(`release('forward')`);
  await wait(900);
  const s2 = await st();
  const roof = await ev(`L('camp-roof').top.y`);
  check('camp: steps off onto the roof, standing on it', off && Math.abs(s2.y - roof) < 0.12 && s2.g, `y ${s2.y} roof ${roof.toFixed(3)}`);
  check('camp: the gun comes back out', !eq0 || s2.eq === eq0, `${s2.eq} (had ${eq0})`);
  await ev(`game.cam.snap(game.cam.yaw + 2.6, -0.1)`);
  await wait(300);
  await shot('trav-roof.png');
  // stand still on the roof a moment: no sinking, no sliding
  const y0 = (await st()).y;
  await wait(800);
  check('camp: the roof holds you (no sinking)', Math.abs((await st()).y - y0) < 0.02);

  // back down: walk off the top where the ladder is
  await ev(`(() => { const l = L('camp-roof'); const q = l.top.clone().addScaledVector(l.out, -0.7); q.y = l.top.y + 0.05; game.player.teleport(q); game.cam.snap(Math.atan2(-l.out.x, -l.out.z), -0.2); })()`);
  await wait(400);
  const promptTop = await ev(`document.querySelector('.prompt')?.textContent ?? ''`);
  check('camp: a prompt at the top to climb down', /Climb down/.test(promptTop), JSON.stringify(promptTop));
  await ev(`press('forward')`);
  const topIn = await until(`game.player.trav.kind === 'topIn'`, 2000);
  check('camp: walking off the top climbs down onto it', topIn);
  await until(`game.player.trav.kind === 'topIn' && game.player.trav.progress > 0.5`, 1500);
  await shot('trav-ladder-topin.png');
  await until(`game.player.trav.kind === 'ladder'`, 2000);
  await ev(`release('forward')`);
  await ev(`(() => { const l = L('camp-roof'); game.cam.snap(Math.atan2(l.out.x, l.out.z), 0); })()`);
  await ev(`press('back')`);
  const down = await until(`game.player.trav.kind === null && game.player.grounded`, 9000);
  await ev(`release('back')`);
  await wait(400);
  const s3 = await st();
  const base = await ev(`L('camp-roof').base.y`);
  check('camp: back down at the foot, off the ladder', down && Math.abs(s3.y - base) < 0.2, `y ${s3.y} base ${base.toFixed(3)}`);

  // let go halfway: jump
  await ev(`atLadder('camp-roof', 1.0)`);
  await wait(300);
  await ev(`press('forward')`);
  await until(`game.player.trav.h > 1.8`, 6000);
  await ev(`release('forward')`);
  await ev(`tap('jump')`);
  const fell = await until(`game.player.trav.kind === null`, 1000);
  const landed = await until(`game.player.grounded && game.player.position.y < L('camp-roof').base.y + 0.4`, 3000);
  check('camp: jump lets go and you drop to the ground', fell && landed, JSON.stringify(await st()));
  await wait(800);

  // Use at the foot climbs it too
  await ev(`atLadder('camp-roof', 0.9)`);
  await wait(400);
  await ev(`tap('interact')`);
  check('camp: Use at the foot grabs it', await until(`game.player.trav.kind === 'ladder'`, 1500));
  await ev(`press('back')`);
  await until(`game.player.trav.kind === null`, 3000);
  await ev(`release('back')`);
  await wait(500);

  // the other climbable ladders
  for (const id of ladderIds.filter((x) => x !== 'camp-roof')) {
    const s = await climbToTop(id, id);
    await ev(`game.cam.snap(game.cam.yaw + 3.0, -0.15)`);
    await wait(300);
    await shot(`trav-top-${id.replace(/[:]/g, '-')}.png`);
    void s;
  }
}

// ---------------------------------------------------------------- mantling
if (want('mantle')) {
  // a camp crate (0.8 m) by the fire: jump into it, pull up, stand on it
  const go = async (lx, lz, dx, dz) => ev(`(() => { const f = game.landmarks.campFrame; const c = f.p(${lx}, 0, ${lz}), s = f.p(${lx + dx}, 0, ${lz + dz}); game.player.teleport(new V(s.x, f.y + 0.05, s.z)); game.cam.snap(Math.atan2(s.x - c.x, s.z - c.z), -0.1); })()`);
  await go(-14, 2, 1.2, 0.2);
  await wait(500);
  const y0 = (await st()).y;
  await ev(`tap('jump')`);
  const started = await until(`game.player.trav.kind === 'mantle'`, 600);
  await until(`game.player.trav.progress > 0.3`, 800);
  await shot('trav-mantle-crate-mid.png');
  await until(`game.player.trav.kind === null && game.player.grounded`, 1500);
  await wait(400);
  const s1 = await st();
  check('mantle: onto a camp crate', started && Math.abs(s1.y - y0 - 0.9) < 0.15, `rise ${(s1.y - y0).toFixed(2)} (crate top ~0.9 above the feet)`);
  await shot('trav-mantle-crate-on.png');
  // the stack by the fire: from the ground straight to the top crate (1.55)
  await go(-6, 7, 1.25, 0.3);
  await wait(500);
  const y1 = (await st()).y;
  await ev(`tap('jump')`);
  await until(`game.player.trav.kind === 'mantle'`, 600);
  await until(`game.player.trav.progress > 0.25`, 800);
  await shot('trav-mantle-stack-mid.png');
  await until(`game.player.trav.kind === null && game.player.grounded`, 1500);
  await wait(400);
  const s2 = await st();
  check('mantle: up the stacked crates', s2.y - y1 > 0.7, `rise ${(s2.y - y1).toFixed(2)}`);

  // a wreck's hood (not its roof): stand off its nose, jump
  const car = await ev(`(() => {
    const cp = game.landmarks.campPosition;
    const w = game.props.wreckBoxes.filter((c) => c.upright && c.kind !== 'convertible' && c.kind !== 'van').sort((a, b) => a.pos.distanceTo(cp) - b.pos.distanceTo(cp));
    for (const c of w) {
      const ax = new V(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
      const s = c.pos.clone().addScaledVector(ax, c.half.x + 0.75);
      const g = game.hf.heightAt(s.x, s.z);
      if (Math.abs(g - (c.pos.y - c.half.y)) < 0.25) return { s: [s.x, g, s.z], yaw: Math.atan2(ax.x, ax.z), bottom: c.pos.y - c.half.y, top: c.pos.y + c.half.y, kind: c.kind };
    }
    return null;
  })()`);
  if (check('mantle: found an upright wreck on flat ground', !!car)) {
    await ev(`(() => { game.player.teleport(new V(${car.s[0]}, ${car.s[1]} + 0.05, ${car.s[2]})); game.cam.snap(${car.yaw}, -0.2); })()`);
    await wait(500);
    await ev(`tap('jump')`);
    await until(`game.player.trav.kind === 'mantle'`, 600);
    await until(`game.player.trav.progress > 0.3`, 800);
    await shot('trav-mantle-hood-mid.png');
    await until(`game.player.trav.kind === null && game.player.grounded`, 1500);
    await wait(400);
    const s3 = await st();
    check(`mantle: onto a ${car.kind}'s hood, not its roof`, s3.y - car.bottom > 0.6 && s3.y < car.top - 0.25, `feet ${(s3.y - car.bottom).toFixed(2)} above its bottom, roof at ${(car.top - car.bottom).toFixed(2)}`);
    await shot('trav-mantle-hood-on.png');
    // and from the hood onto the roof
    await ev(`game.cam.snap(${car.yaw}, -0.1)`);
    await ev(`press('forward')`);
    await wait(250);
    await ev(`tap('jump')`);
    await until(`game.player.trav.kind === 'mantle'`, 600);
    await until(`game.player.trav.kind === null && game.player.grounded`, 1500);
    await ev(`release('forward')`);
    await wait(400);
    const s4 = await st();
    check('mantle: from the hood up onto the roof', Math.abs(s4.y - car.top) < 0.2, `feet ${s4.y.toFixed(2)} roof ${car.top.toFixed(2)}`);
  }

  // too high: the store's wall (4.2 m). A plain jump, no mantle
  await ev(`(() => { const f = game.landmarks.campFrame; const s = f.p(0, 0, -8.5 + 0.6); game.player.teleport(new V(s.x, f.y + 0.05, s.z)); game.cam.snap(Math.atan2(-Math.sin(f.yaw) * 0 + (f.p(0, 0, -12).x - s.x), f.p(0, 0, -12).z - s.z), 0); })()`);
  await wait(400);
  await ev(`tap('jump')`);
  await wait(300);
  check('mantle: not up a 4 m wall', (await st()).k === null);
  await wait(600);

  // hands full (the Spire's core) or frozen: no climbing
  await go(-14, 2, 1.2, 0.2);
  // (both arms round the Spire's core: the flag clears itself away from the Spire, so pin the body's own)
  await ev(`Object.defineProperty(game.player, 'heavy', { configurable: true, get: () => true, set: () => {} })`);
  await wait(300);
  await ev(`tap('jump')`);
  await wait(250);
  check('mantle: not with both arms round the core', (await st()).k !== 'mantle');
  await ev(`delete game.player.heavy; game.player.heavy = false`);
  await wait(800);
  await ev(`game.player.frozen = true`);
  await go(-14, 2, 1.2, 0.2);
  await wait(300);
  await ev(`tap('jump')`);
  await wait(250);
  check('mantle: not while frozen (a cutscene, a minigame)', (await st()).k !== 'mantle');
  await ev(`game.player.frozen = false`);
  await wait(300);
}

// ---------------------------------------------------------------- the bunkers stay shut
if (want('safety')) {
  // the Dome: its 1.2 m stem wall with the glass above (no climbing in)
  const r0 = await ev(`(() => { const o = game.dome.b.origin; game.player.teleport(new V(o.x, game.hf.heightAt(o.x, o.z + 23) + 0.1, o.z + 23)); game.cam.snap(0, 0); return 23; })()`);
  await wait(500);
  await ev(`press('forward')`);
  await wait(300);
  await ev(`tap('jump')`);
  await wait(900);
  await ev(`tap('jump')`);
  await wait(900);
  await ev(`release('forward')`);
  const rd = await ev(`(() => { const o = game.dome.b.origin, p = game.player.position; return Math.hypot(p.x - o.x, p.z - o.z); })()`);
  check('Dome: no climbing over the stem wall into the glass', rd > 22.2, `r ${rd.toFixed(2)} (from ${r0})`);
  await shot('trav-dome-stem.png');
  // the Dome's fence: you can't walk through it (its colliders were fins across it)
  await ev(`(() => { const o = game.dome.b.origin; const a = 0.7; const x = o.x + Math.sin(a) * 41.6, z = o.z + Math.cos(a) * 41.6; game.player.teleport(new V(x, game.hf.heightAt(x, z) + 0.1, z)); game.cam.snap(a, 0); })()`);
  await wait(400);
  await ev(`press('forward')`);
  await wait(2500);
  await ev(`tap('jump')`);
  await wait(1000);
  await ev(`release('forward')`);
  const rf = await ev(`(() => { const o = game.dome.b.origin, p = game.player.position; return Math.hypot(p.x - o.x, p.z - o.z); })()`);
  check('Dome: the fence stops you (walking and jumping into it)', rf > 40.1, `r ${rf.toFixed(2)}`);
  // the Spire's road: no vaulting either guardrail (onto the cut bank, or off the drop) to walk round the beams
  for (const end of ['a', 'b']) {
    const rail = await ev(`(() => {
      const tw = game.spire.b.tripwires.find((t) => t.id === 'beam2');
      if (!tw) return null;
      const from = tw.${end === 'a' ? 'b' : 'a'}, to = tw.${end};
      const dir = to.clone().sub(from).setY(0).normalize();
      const s = to.clone().addScaledVector(dir, -0.75).addScaledVector(new V(-dir.z, 0, dir.x), 1.5);
      s.y = game.hf.heightAt(s.x, s.z) + 0.1;
      game.player.teleport(s);
      game.cam.snap(Math.atan2(-dir.x, -dir.z), 0);
      const beyond = to.clone().addScaledVector(dir, 0.6);
      window.__rail = { x: to.x, z: to.z, dx: dir.x, dz: dir.z };
      return { bank: game.hf.heightAt(beyond.x, beyond.z) - game.hf.heightAt(s.x, s.z) };
    })()`);
    if (!check(`Spire: found the road beams (${end} side)`, !!rail)) continue;
    await wait(400);
    await ev(`press('forward')`);
    await wait(500);
    await ev(`tap('jump')`);
    await wait(800);
    await ev(`tap('jump')`);
    await wait(800);
    await ev(`release('forward')`);
    const k = await ev(`(() => { const r = window.__rail, p = game.player.position; return (p.x - r.x) * r.dx + (p.z - r.z) * r.dz; })()`);
    check(`Spire: no vault over the road's ${end} guardrail`, k < 0, `past the rail by ${k.toFixed(2)} m (ground beyond ${rail.bank.toFixed(2)} m above the road)`);
  }
  // the Spire's laser stairwell is a no-climb zone
  const ladMod = await ev(`(() => { const o = game.spire.b.origin; return [game.noMantle.has({ x: o.x + 1, y: o.y + 2, z: o.z }), game.noMantle.has({ x: o.x + 30, y: o.y + 2, z: o.z })]; })()`);
  check('Spire: the stairwell is a no-climb zone (and outside isn\'t)', ladMod[0] === true && ladMod[1] === false, JSON.stringify(ladMod));
  // the Dome's outfall still lets you in under the fence, crouched, once its grate is open (last: inside
  // the Dome's grounds its Helpers come for you)
  await ev(`(() => { const D = game.dome; D.setDoor(D.b.doors.grate, true, true); const p = D.b.points.culvert, q = D.b.points.culvertIn; game.player.teleport(new V(p.x, game.hf.heightAt(p.x, p.z) + 0.1, p.z)); game.cam.snap(Math.atan2(p.x - q.x, p.z - q.z), 0); })()`);
  await wait(400);
  await ev(`press('crouch')`);
  await wait(300);
  await ev(`press('forward')`);
  await wait(4000);
  await ev(`releaseAll()`);
  await wait(300);
  const rc = await ev(`(() => { const o = game.dome.b.origin, p = game.player.position; return Math.hypot(p.x - o.x, p.z - o.z); })()`);
  check('Dome: the open culvert still takes you under the fence', rc < 39.4, `r ${rc.toFixed(2)}`);
  await shot('trav-dome-culvert.png');
  await ev(`(() => { const D = game.dome; D.setDoor(D.b.doors.grate, false, true); D.alarm = 0; })()`);
  // (a Helper's catch walks you back out with a fade: let it land before anything else)
  await ev(`atLadder('camp-roof', 3)`);
  await wait(3500);
}

// ---------------------------------------------------------------- a controller and the touch stick climb too
if (want('input')) {
  await ev(`atLadder('camp-roof', 1.0)`);
  await wait(400);
  await ev(`atLadder('camp-roof', 1.0)`);
  await ev(`window.__pad.on = true`);
  await wait(500);
  await ev(`window.__pad.axes = [0, -1, 0, 0]`);
  const g1 = await until(`game.player.trav.kind === 'ladder' && game.player.trav.h > 0.8`, 4000);
  check('pad: the left stick climbs', g1, JSON.stringify(await st()));
  await ev(`window.__pad.axes = [0, 0, 0, 0]`);
  await ev(`window.__pad.buttons[0] = 1`);
  await wait(120);
  await ev(`window.__pad.buttons[0] = 0`);
  check('pad: A lets go', await until(`game.player.trav.kind === null`, 1000));
  await ev(`window.__pad.on = false`);
  await until(`game.player.grounded`, 3000);
  await wait(600);
  await ev(`atLadder('camp-roof', 1.0)`);
  await wait(400);
  await ev(`game.input.moveZ = 1`);
  const g2 = await until(`game.player.trav.kind === 'ladder' && game.player.trav.h > 0.8`, 4000);
  check('touch: the move stick climbs', g2, JSON.stringify(await st()));
  await ev(`game.input.moveZ = -1`);
  check('touch: and back down off it', await until(`game.player.trav.kind === null`, 5000));
  await ev(`releaseAll()`);
}

const pipes1 = await pipes();
check('no new render pipelines from climbing or mantling', pipes1 === pipes0, `${pipes0} → ${pipes1}`);
console.log(errors.length ? `ERRORS (${errors.length}):\n  ${[...new Set(errors)].slice(0, 12).join('\n  ')}` : 'no page errors');
const ok = results.every(Boolean) && !errors.length;
console.log(ok ? 'ALL PASS' : `FAILED ${results.filter((x) => !x).length} of ${results.length}`);
await b.close();
process.exit(ok ? 0 : 1);
