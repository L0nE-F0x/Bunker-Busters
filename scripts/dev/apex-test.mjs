// Scripted headless playthrough of Apex Vault (Act II). Needs `npm run dev`.
//   node scripts/dev/apex-test.mjs [pick|talk|vent|loud|all]
// pick: greeting, hangar pick, the hangar camera rings (gatehouse called), airlock keypad lockout
//       (Vesper's line, keypad disabled), SPLICE the airlock (cameras + lasers), vault pick, loot,
//       the exit ambush + merch crate, the debrief.
// talk: Social 5: the fan demo opens the hangar (no line), the code; the keypad reads the clock.
// vent: an Infiltrator spots the vent; pick the grate, in through the duct (interior mode), laser
//       tripped, breaker, vault charge at Demolition 5.
// loud: hangar charge standing (alarm, loud), the corridor camera rings, the ledger route.
import { open, STUBS } from './early-common.mjs';

const which = process.argv[2] || 'all';
const URL = 'http://localhost:5173/play/?webgl&autostart&hour=15';
const PRE = `(() => { const s = game.state; for (const f of ['briefed', 'debriefed', 'act1.broadcast', 'garage.complete', 'q:act1:done']) s.set(f); game.combat.difficulty = 'story'; })()`;
const loot = (t) => t.ev(`(async () => { for (const id of ['tank_a', 'tank_b', 'cistern']) { const sp = B.b.lootSpots.find((l) => l.id === id); game.player.teleport(sp.pos.clone().setY(O.y + 0.1)); act(id); await new Promise((r) => setTimeout(r, 300)); } })()`);

async function pick() {
  const t = await open(URL, 'pick');
  const { ev, wait, check, bug } = t;
  await ev(STUBS('apex'));
  await ev(PRE);
  await ev(`(() => { const s = game.state; s.data.skills.electronics = 3; s.data.skills.social = 0; s.data.skills.demolition = 0; s.addItem('lockpick', 4); })()`);
  await ev(`L(-10, 40)`);
  await wait(1500);
  await check('greeting on approach + seen:apex', `__subs.some((s) => /Welcome to Apex/.test(s)) && game.state.has('seen:apex')`);
  await ev(`L(-10, 16.4); act('hangar')`);
  await wait(2500);
  await check('hangar picked: both leaves slide, colliders gone, padlock hidden', `game.state.has('apex.hangar.open') && B.b.doors.hangarL.open > 0.8 && !B.b.doors.hangarL.collider && !B.b.doors.hangarR.collider && !B.b.lockMeshes.hangar.visible`);
  await check('feed posts the breach', `__toasts.some((x) => /@vesper/.test(x) && /hinges/.test(x))`);
  // the hangar camera on the airlock: stand in front of it, in its cone
  const squads0 = await ev(`game.recovery.census?.() ?? null`);
  await ev(`L(-8, -2.5)`);
  const rang = await t.until(`B.alarm > 0`, 8000);
  console.log(`${rang ? 'PASS' : 'FAIL'}  [pick] the hangar camera rings the alarm`);
  await check('alarm → apex.loud', `game.state.has('apex.loud')`);
  console.log('    census before/after:', JSON.stringify(squads0), JSON.stringify(await ev(`game.recovery.census?.() ?? null`)));
  await wait(11000);
  // airlock keypad: wrong twice
  await ev(`L(-10, -3.8); window.__keypad = 'wrong'; act('airlock')`); await wait(300);
  await check('keypad got the launch clock', `window.__code === B.clockDigits()`);
  await ev(`act('airlock')`); await wait(500);
  await check('second wrong code: lockout, Vesper says so', `B.alarm > 0 && __subs.some((s) => /Wrong code, twice/.test(s))`);
  await check('keypad now locked', `avail('airlock') === 'Keypad locked out'`);
  // SPLICE it
  await wait(11000);
  await ev(`window.__hack = null; act2('airlock')`);
  await wait(2500);
  await check('SPLICE: airlock, cameras, lasers', `JSON.stringify(__daemons) === '["airlock","cameras","lasers"]' && game.state.has('apex.airlock.open') && game.state.has('apex.cameras.off') && game.state.has('apex.lasers.off') && game.state.has('apex.spliced')`);
  await check('both airlock doors open, colliders gone', `B.b.doors.airlockOut.open > 0.8 && B.b.doors.airlockIn.open > 0.8 && !B.b.doors.airlockOut.collider && !B.b.doors.airlockIn.collider`);
  await check('lasers off: beams hidden', `B.b.lasers.every((l) => !l.mesh.visible)`);
  await ev(`L(-10, -15)`); await wait(200); await ev(`game.cam.snap(0, 0)`); await wait(800);
  await check('inside: interior mode', `B.playerInside && game.interiorName === 'apex'`);
  await ev(`L(-10, -21); act('vault')`);
  await wait(2500);
  await check('vault picked (6 pins)', `__pins === 6 && game.state.has('apex.vault.open') && !B.b.doors.vault.collider`);
  await loot(t);
  await wait(2500);
  await check('busted: water x10+, complete, banner', `game.state.has('apex.complete') && game.state.count('water') >= 10 && __banners.some((b) => /BUNKER BUSTED/.test(b))`);
  // the way out: the ambush + merch drone
  await ev(`L(-3, 24)`);
  const amb = await t.until(`game.state.has('apex.ambush')`, 9000);
  console.log(`${amb ? 'PASS' : 'FAIL'}  [pick] the exit ambush fires`);
  await t.until(`B.b.crate.userData.landed`, 16000);
  await check('the merch crate landed and is openable', `find('apex-merch').visible()`);
  await ev(`L(-3, 22.5); act('apex-merch')`);
  await check('merch opened once', `game.state.has('apex.merch') && !find('apex-merch').visible()`);
  await wait(1500);
  await check('quest act2 done', `game.state.has('q:act2:done')`);
  const deb = await ev(`(async () => { const m = await import('/src/content/story.ts'); return m.campRadio({ has: (f) => game.state.has(f), archetype: game.state.archetype }); })()`);
  console.log('    debrief', JSON.stringify(deb.flags), deb.pages.map((p) => p.text.slice(0, 50)));
  return t.done();
}

async function talk() {
  const t = await open(URL, 'talk');
  const { ev, wait, check, bug } = t;
  await ev(STUBS('apex'));
  await ev(PRE);
  await ev(`(() => { const s = game.state; s.data.skills.electronics = 0; s.data.skills.social = 5; s.data.skills.demolition = 0; s.addItem('lockpick', 4); })()`);
  await ev(`L(-4.4, 17.2); window.__talk = ['code', 'ok']; act('apex-intercom')`);
  await wait(300);
  await check('she told you how the code works', `game.state.has('apex.code')`);
  await ev(`window.__talk = ['fan', 'ok']; act('apex-intercom')`);
  await wait(2500);
  await check('the fan demo opens the hangar (apex.demo), no "skipped the waitlist" line', `game.state.has('apex.demo') && game.state.has('apex.hangar.open') && !__subs.some((s) => /waitlist. You skipped/.test(s))`);
  await ev(`(() => { const d = B.b.cameras; })(); L(-10, -3.8); window.__keypad = (o) => (o.code === B.clockDigits() ? 'ok' : 'wrong'); act('airlock')`);
  await wait(2500);
  await check('keypad: the hint reads the clock, the clock is the code', `/launch clock over the door reads T-/.test(__hint) && game.state.has('apex.airlock.open')`);
  return t.done();
}

async function vent() {
  // a fresh Infiltrator (autostart is the Infiltrator)
  const t = await open(URL, 'vent');
  const { ev, wait, check, bug } = t;
  await ev(STUBS('apex'));
  await ev(PRE);
  await check('archetype is the Infiltrator', `game.state.archetype.id === 'infiltrator'`);
  await ev(`(() => { const s = game.state; s.data.skills.electronics = 1; s.data.skills.demolition = 5; s.addItem('lockpick', 4); s.addItem('charge', 2); })()`);
  await ev(`L(20, -17.5)`);
  await wait(1200);
  await check('Infiltrator spots the vent', `game.state.has('apex.vent') && find('vent').visible()`);
  await ev(`L(0.4, -17.5); act('vent')`);
  await wait(2500);
  await check('vent picked: grate open, collider gone', `game.state.has('apex.vent.open') && !B.b.doors.vent.collider && B.b.doors.vent.open > 0.8`);
  await ev(`L(-9.5, -18.2)`); await wait(200); await ev(`game.cam.snap(0, 0)`); await wait(800);
  await check('out of the duct: inside, interior mode', `B.playerInside && game.interiorName === 'apex'`);
  await t.shot('apex-vent-corridor.png');
  // break the third beam (low) standing
  await ev(`L(-10, -20)`); await wait(400);
  await check('laser low2 broken: alarm + its own message', `B.alarm > 0 && __toasts.some((x) => /Jump the low/.test(x))`);
  await wait(11000);
  await ev(`window.__pick = ['charge']; L(-10, -21.4); act2('vault')`);
  await wait(500);
  await check('vault charge at Demolition 5: open + alarm (never quiet)', `game.state.has('apex.vault.open') && B.alarm > 0 && __subs.some((s) => /With a bomb/.test(s))`);
  await loot(t);
  await wait(2500);
  await check('busted', `game.state.has('apex.complete')`);
  const deb = await ev(`(async () => { const m = await import('/src/content/story.ts'); return m.apexDebrief({ has: (f) => game.state.has(f), archetype: game.state.archetype }); })()`);
  await check('debrief tells the vent story', `${JSON.stringify(JSON.stringify(deb))}.includes('vent')`);
  return t.done();
}

async function loud() {
  const t = await open(URL, 'loud');
  const { ev, wait, check, bug } = t;
  await ev(STUBS('apex'));
  await ev(`(() => { const s = game.state; for (const f of ['briefed', 'debriefed', 'act1.leverage', 'garage.complete']) s.set(f); game.combat.difficulty = 'story'; s.data.skills.electronics = 0; s.data.skills.social = 0; s.data.skills.demolition = 3; s.addItem('charge', 2); })()`);
  // the ledger route on the intercom (act1.leverage)
  await ev(`L(-4.4, 17.2); window.__talk = ['ledger', 'ok']; act('apex-intercom')`);
  await wait(2500);
  await check('ledger: the hangar opens', `game.state.has('apex.hangar.open')`);
  await bug('ledger route sets apex.demo, so the debrief says "she gave you a tour"', `game.state.has('apex.demo')`);
  // corridor camera: airlock forced open, stand down the middle of the corridor
  await ev(`game.state.set('apex.airlock.open'); B.applyFlags(); L(-9.6, -18.3)`);
  // (it sweeps: an Infiltrator standing still mid-corridor fills its meter about halfway, then it looks away)
  await t.wait(4000);
  await t.check('the corridor camera sees you (its meter rises)', `B.cameras.seen.some((v) => v > 0.2)`);
  return t.done();
}

const runs = { pick, talk, vent, loud };
let ok = true;
for (const [k, f] of Object.entries(runs)) if (which === 'all' || which === k) ok = (await f()) && ok;
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
