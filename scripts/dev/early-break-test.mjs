// Trying to break the first three bunkers: Continue mid-heist, quitting during an alarm, timers that
// outlive the run, Vesper's reaction lines on a Continue. Needs `npm run dev`.
//   node scripts/dev/early-break-test.mjs [continue|quit|timers|vesper|lockout|all]
import { open, STUBS } from './early-common.mjs';
import { waitForGame } from './browser.mjs';

const which = process.argv[2] || 'all';
const AUTO = 'http://localhost:5173/play/?webgl&autostart&hour=15';

/** Reload into the saved run from the title, the way a player does (the title runs a few seconds first). */
async function continueFromTitle(t, hook = '') {
  await t.p.goto('http://localhost:5173/play/?webgl');
  await waitForGame(t.p);
  await t.wait(4000);
  if (hook) await t.ev(hook);
  await t.ev(`[...document.querySelectorAll('button, .btn, [role=button]')].find((b) => /^\\s*Continue\\s*$/.test(b.textContent))?.click()`);
  await t.until(`game.mode === 'playing' && !!game.player`, 20000);
  await t.wait(3000);
}

async function cont() {
  const t = await open(AUTO, 'continue');
  const { ev, wait, check } = t;
  // Garage: gate, side door, vault open, one crate looted, the side wire disarmed, lasers on; save inside
  await ev(STUBS('garage'));
  await ev(`(() => { const s = game.state; for (const f of ['briefed', 'garage.gate.open', 'garage.side.open', 'garage.vault.open', 'garage.tw_side.disarmed']) s.set(f); B.applyFlags(true); B.drone.recall(600); L(0, -9); act('crate_a'); })()`);
  await wait(800);
  await ev(`L(0, -3); game.save(true)`);
  await wait(300);
  await t.p.goto('http://localhost:5173/play/?webgl&continue');
  await waitForGame(t.p); await wait(3500);
  await ev(STUBS('garage'));
  await check('Garage after Continue: doors open, colliders gone', `['gateL','gateR','side','vault'].every((d) => B.b.doors[d].open > 0.99 && !B.b.doors[d].collider) && !B.b.doors.gap.collider === false`);
  await check('Garage after Continue: lasers on, side wire gone, gate wire armed', `B.b.lasers.every((l) => l.mesh.visible) && !find('tw_side').visible() && find('tw_gate').visible()`);
  await check('Garage after Continue: crate_a open (lid), crate_b and safe left', `!find('crate_a').visible() && find('crate_b').visible() && find('safe').visible() && B.b.lootSpots.find((l) => l.id === 'crate_a').lid.rotation.x < -1.8`);
  await check('Garage after Continue: inside, interior mode', `B.playerInside`);
  // Apex: hangar + airlock open, lasers on, in the corridor
  await ev(STUBS('apex'));
  await ev(`(() => { const s = game.state; for (const f of ['apex.hangar.open', 'apex.airlock.open', 'apex.cam.x']) s.set(f); B.applyFlags(true); L(-10, -11); game.save(true); })()`);
  await wait(300);
  await t.p.goto('http://localhost:5173/play/?webgl&continue');
  await waitForGame(t.p); await wait(3500);
  await ev(STUBS('apex'));
  await check('Apex after Continue: hangar + airlock open, colliders gone, padlock gone', `['hangarL','hangarR','airlockOut','airlockIn'].every((d) => B.b.doors[d].open > 0.99 && !B.b.doors[d].collider) && !B.b.lockMeshes.hangar.visible && !!B.b.doors.vault.collider`);
  await check('Apex after Continue: in the corridor (inside)', `B.playerInside`);
  // Panopticon: gate open, two cameras cut, Ada met and ready
  await ev(STUBS('panopticon'));
  await ev(`(() => { const s = game.state; for (const f of ['panopticon.gate.open', 'panopticon.enrolled', 'panopticon.cam.cam1.off', 'panopticon.cam.cam2.off', 'panopticon.ada.met', 'panopticon.ada.ready']) s.set(f); B.applyFlags(true); L(-7, 3); game.save(true); })()`);
  await wait(300);
  await t.p.goto('http://localhost:5173/play/?webgl&continue');
  await waitForGame(t.p); await wait(3500);
  await ev(STUBS('panopticon'));
  await check('Panopticon after Continue: gate open, cam1+2 dark (LEDs, boxes), cam3+4 live, Ada at her desk', `!B.b.doors.gateL.collider && B.b.doors.gateL.open > 0.99 && !find('pan-box-cam1').visible() && !find('pan-box-cam2').visible() && find('pan-box-cam3').visible() && B.cameras.cams[0].lens.value === 0 && B.cameras.cams[2].lens.value > 0 && find('pan-ada').visible()`);
  return t.done();
}

async function quit() {
  const t = await open(AUTO, 'quit');
  const { ev, wait, check, bug } = t;
  await ev(STUBS('panopticon'));
  await ev(`(() => { const s = game.state; s.set('briefed'); L(0, 20.4); B.triggerAlarm(null, 'test alarm'); })()`);
  await wait(500);
  await check('alarm ringing', `B.alarm > 10`);
  // quit to the title (no autostart, so it stays there)
  await ev(`history.replaceState(null, '', '/play/?webgl'); game.toTitle()`);
  await wait(15000);
  await bug('quit mid-alarm: on the title 15 s later the alarm has not decayed (the siren, if audio is up, keeps going)', `B.alarm > 10`);
  console.log('    title: alarm', await ev(`B.alarm.toFixed(1)`), 'siren', await ev(`!!game.audio.alarm`), 'bunkerAlarm', await ev(`game.bunkerAlarm`));
  // New Game: the old run's alarm carries into it
  await ev(`(async () => { const m = await import('/src/game/State.ts'); const w = await import('/src/content/world.ts'); game.startGame(m.GameState.fresh('infiltrator', w.SPAWN)); })()`);
  await t.until(`game.mode === 'playing' && !!game.player`, 20000);
  await wait(500);
  await bug('a brand-new run starts with the old run\'s Panopticon alarm still ringing (bunkerAlarm: no autosave, no fast travel)', `game.bunkerAlarm && B.alarm > 0`);
  return t.done();
}

async function timers() {
  const t = await open(AUTO, 'timers');
  const { ev, wait, check, bug } = t;
  // the Garage's busted banner fires 1.8 s after the last crate; quit inside that window
  await ev(STUBS('garage'));
  await ev(`(() => { const s = game.state; for (const f of ['briefed', 'garage.gate.open', 'garage.side.open', 'garage.vault.open', 'garage.loot.crate_a', 'garage.loot.crate_b']) s.set(f); B.applyFlags(true); B.drone.recall(600); L(4.8, -9.7); act('safe'); history.replaceState(null, '', '/play/?webgl'); game.toTitle(); })()`);
  await wait(2500);
  const e1 = t.errors.slice();
  console.log('    errors after quitting inside the busted window:', JSON.stringify(e1));
  await bug('the busted timer runs after a quit to the title (TypeError on a null state)', `${JSON.stringify(e1)}.some((e) => /null|undefined/.test(e))`);
  t.errors.length = 0;
  // Kofi's report fires 2.6 s after he sees you
  await ev(`(async () => { const m = await import('/src/game/State.ts'); const w = await import('/src/content/world.ts'); game.startGame(m.GameState.fresh('infiltrator', w.SPAWN)); })()`);
  await t.until(`game.mode === 'playing' && !!game.player`, 20000);
  await wait(800);
  await ev(STUBS('panopticon'));
  await ev(`(() => { const s = game.state; s.set('briefed'); s.set('panopticon.gate.open'); B.applyFlags(true); L(7.7, -4.4); const k = B.people.find((p) => p.id === 'kofi'); k.nextGlance = 0; k.glance = 0; k.seen = 0.99; })()`);
  await t.until(`game.state.has('panopticon.kofi')`, 6000);
  await ev(`history.replaceState(null, '', '/play/?webgl'); game.toTitle()`);
  await wait(3500);
  const e2 = t.errors.slice();
  console.log('    errors after quitting inside Kofi\'s window:', JSON.stringify(e2));
  await bug('Kofi\'s report timer runs after a quit to the title (TypeError)', `${JSON.stringify(e2)}.some((e) => /null|undefined/.test(e))`);
  t.errors.length = 0;
  return t.done();
}

async function vesper() {
  const t = await open(AUTO, 'vesper');
  const { ev, wait, check, bug } = t;
  // a save where Apex's lasers are off (and long since busted), standing at the camp
  await ev(`(() => { const s = game.state; for (const f of ['briefed', 'debriefed', 'garage.complete', 'apex.hangar.open', 'apex.airlock.open', 'apex.lasers.off', 'apex.cameras.off', 'apex.vault.open', 'apex.complete', 'act2.debriefed']) s.set(f); game.save(true); })()`);
  await wait(300);
  await continueFromTitle(t, `window.__subs = []; const sub = game.ui.subtitle.bind(game.ui); game.ui.subtitle = (sp, tx, v) => { window.__subs.push(sp + ': ' + tx); return sub(sp, tx, v); };`);
  console.log('    subtitles after Continue:', JSON.stringify(await ev(`__subs`)));
  console.log('    distance to Apex (m):', await ev(`Math.round(game.player.position.distanceTo(game.apex.b.origin))`));
  await bug('Continue from the title: Vesper\'s "lasers were a feature" plays wherever you are, even long after Apex', `__subs.some((s) => /lasers were a feature/.test(s))`);
  return t.done();
}

async function lockout() {
  const t = await open(AUTO, 'lockout');
  const { ev, wait, check, bug } = t;
  await ev(STUBS('panopticon'));
  await ev(`(() => { const s = game.state; s.set('briefed'); for (const f of ['panopticon.gate.open', 'panopticon.cam.cam1.off', 'panopticon.cam.cam2.off', 'panopticon.cam.cam3.off', 'panopticon.cam.cam4.off']) s.set(f); B.applyFlags(true); s.data.skills.electronics = 3; s.data.skills.demolition = 0; L(-7, 0); window.__keypad = 'wrong'; })()`);
  await ev(`act('tower')`); await wait(300); await ev(`act('tower')`); await wait(13500);
  await check('locked out', `avail('tower') === 'Keypad locked out'`);
  await ev(`game.save(true)`);
  await t.p.goto('http://localhost:5173/play/?webgl&continue');
  await waitForGame(t.p); await wait(3500);
  await ev(STUBS('panopticon'));
  await check('after Continue the keypad works again (the only way out of the lock)', `avail('tower') === true`);
  return t.done();
}

const runs = { continue: cont, quit, timers, vesper, lockout };
let ok = true;
for (const [k, f] of Object.entries(runs)) if (which === 'all' || which === k) ok = (await f()) && ok;
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
