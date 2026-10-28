// Scripted headless playthrough of the Panopticon (Act III). Needs `npm run dev`.
//   node scripts/dev/panopticon-test.mjs [splice|talk|short|all]
// splice: greeting, the lamp (Kade called once), the face gate refuses, SPLICE (enrol + poles), a box cut
//         out of order (alarm, lockdown on the tower), Ada (order, code, ready), the chain in order, the
//         keypad lockout, SPLICE the tower (+ towercams), Ezra and the archive (take), Ada walks out,
//         loot, the lamp goes out, the debrief.
// talk:   Social 4 at the gate (invited), Kofi reports you (alarm), Jun doesn't, a tower charge (Demolition 5),
//         the archive broadcast.
// short:  shorting the gate motor (quiet), then what the debrief says about it; the keypad soft-lock.
import { open, STUBS } from './early-common.mjs';

const which = process.argv[2] || 'all';
const URL = 'http://localhost:5173/play/?webgl&autostart&at=panopticon&hour=15';
const PRE = `(() => { const s = game.state; for (const f of ['briefed', 'debriefed', 'act1.broadcast', 'garage.complete', 'apex.complete', 'act2.debriefed', 'q:act1:done', 'q:act2:done']) s.set(f); game.combat.difficulty = 'story'; })()`;
const loot = (t) => t.ev(`(async () => { for (const id of ['cistern', 'locker', 'shelf']) { const sp = B.b.lootSpots.find((l) => l.id === id); game.player.teleport(sp.pos.clone().setY(O.y + 0.1)); act(id); await new Promise((r) => setTimeout(r, 300)); } })()`);

async function splice() {
  const t = await open(URL, 'splice');
  const { ev, wait, check, bug, until } = t;
  await ev(STUBS('panopticon'));
  await ev(PRE);
  await ev(`(() => { const s = game.state; s.data.skills.electronics = 4; s.data.skills.social = 0; s.data.skills.demolition = 0; })()`);
  // the lamp: stand in the open 60 m down the valley until the beam comes round (the poles are behind you)
  await ev(`L(0, 60)`);
  const swept = await until(`(game.state.data.health = 100, game.state.has('panopticon.swept'))`, 44000);
  console.log(`${swept ? 'PASS' : 'FAIL'}  [splice] the lamp finds you in the valley (Kade called)`);
  await check('Ezra says so', `__subs.some((s) => /There you are/.test(s))`);
  console.log('    census', JSON.stringify(await ev(`game.recovery.census().map((m) => m.state)`)));
  // the gate refuses a face
  await ev(`L(0, 20.4); act('gate')`);
  await wait(400);
  await check('the face gate refuses (Ezra: denied)', `!game.state.has('panopticon.gate.open') && game.state.has('panopticon.denied')`);
  await ev(`window.__pick = ['splice']; act2('gate')`);
  await wait(2500);
  await check('SPLICE: enrol + poles; gate open; poles dark', `JSON.stringify(__daemons) === '["enrol","poles"]' && game.state.has('panopticon.enrolled') && game.state.has('panopticon.gate.open') && ['pole1','pole2','pole3'].every((p) => game.state.has('panopticon.cam.' + p + '.off')) && !B.b.doors.gateL.collider`);
  // cut cam3 out of order (cam2 watches its box)
  await ev(`L(9.2, -1.2); game.player.crouching = true`); await wait(300);
  await ev(`act('pan-box-cam3')`); await wait(500);
  await check('cam3 cut out of order: alarm, Ezra\'s chain line', `B.alarm > 0 && __subs.some((s) => /saw you do that/.test(s)) && game.state.has('panopticon.loud')`);
  await check('lockdown: the tower is shut while it rings', `/Lockdown/.test(avail('tower'))`);
  // wait it out back at the gate: crouched at camera 3's box you're in camera 2's view, and it rings
  // again every time its cooldown ends (a reviewer's glance during the cut can ring it again too)
  await ev(`game.player.crouching = false; L(0, 20.4)`);
  await until('B.alarm <= 0 && B.cameras.seen.every((v) => v < 0.05)', 40000);
  // Ada
  await ev(`L(-4.2, -7.3); window.__talk = ['cams', 'back', 'door', 'back', 'come', 'ok']; act('pan-ada')`);
  await wait(300);
  await check('Ada: met, chain, code, ready', `['panopticon.ada.met', 'panopticon.chain', 'panopticon.code', 'panopticon.ada.ready'].every((f) => game.state.has(f))`);
  // the reviewers glance back at random, and the camera 1 box is at Kofi's glass: keep them on their screens
  // here (Kofi reporting you has its own check), or a glance mid-cut rings a second alarm now and then
  await ev(`B.people.forEach((pr) => { if (pr.id !== 'ada') { pr.nextGlance = 99; pr.glance = 0; pr.seen = 0; } })`);
  for (const c of ['cam1', 'cam2', 'cam4']) { await ev(`(() => { const p = P['box_${c}']; game.player.teleport(new V(p.x, O.y + 0.1, p.z)); act('pan-box-${c}'); })()`); await wait(400); console.log('    after', c, JSON.stringify(await ev(`({ alarm: +B.alarm.toFixed(1), toasts: __toasts.slice(-2), seen: B.cameras.seen.map((v) => +v.toFixed(2)), kofi: game.state.has('panopticon.kofi') })`))); }
  await check('chain cut in order: all dark, no second alarm', `['cam1','cam2','cam3','cam4'].every((c) => game.state.has('panopticon.cam.' + c + '.off')) && B.alarm <= 0`);
  // keypad lockout
  await ev(`L(-7, 0); window.__keypad = 'wrong'; act('tower')`); await wait(300);
  await ev(`act('tower')`); await wait(400);
  await check('two wrong: lockout alarm, Ezra\'s line', `B.alarm > 0 && __subs.some((s) => /Two wrong numbers/.test(s))`);
  await wait(13000);
  await check('keypad locked out even with the code known', `avail('tower') === 'Keypad locked out'`);
  await ev(`window.__pick = ['splice']; window.__hack = null; act2('tower')`);
  await wait(2500);
  await check('SPLICE the tower: open', `game.state.has('panopticon.tower.open') && !B.b.doors.towerDoor.collider`);
  console.log('    tower daemons', JSON.stringify(await ev(`__daemons`)));
  // Ezra + the archive
  await ev(`L(1.2, 0.4); window.__talk = ['ada', 'back', 'archive', 'decide']; window.__pick = ['take']; act('pan-ezra')`);
  await wait(800);
  await check('the archive: taken (drive in the pack)', `game.state.has('panopticon.archive.take') && game.state.count('archive_drive') === 1 && !find('pan-archive').visible()`);
  // Ada leaves
  const gone = await until(`game.state.has('panopticon.ada.free')`, 12000);
  console.log(`${gone ? 'PASS' : 'FAIL'}  [splice] Ada walks out while you're in the tower`);
  await loot(t);
  await wait(2500);
  await check('busted, the lamp\'s beam off', `game.state.has('panopticon.complete') && !B.b.lampBeam.mesh.visible`);
  await wait(1500);
  await check('quest act3 done', `game.state.has('q:act3:done')`);
  const deb = await ev(`(async () => { const m = await import('/src/content/story.ts'); return m.campRadio({ has: (f) => game.state.has(f), archetype: game.state.archetype }); })()`);
  console.log('    debrief', JSON.stringify(deb.flags), deb.pages.map((p) => p.speaker + ': ' + p.text.slice(0, 60)));
  return t.done();
}

async function talk() {
  const t = await open(URL, 'talk');
  const { ev, wait, check, bug, until } = t;
  await ev(STUBS('panopticon'));
  await ev(PRE);
  await ev(`(() => { const s = game.state; s.data.skills.electronics = 0; s.data.skills.social = 4; s.data.skills.demolition = 5; s.addItem('charge', 2); })()`);
  await ev(`L(2.8, 21); window.__talk = ['witness', 'ok']; act('pan-intercom')`);
  await wait(2500);
  await check('Social 4: invited, gate open, intercom gone', `game.state.has('panopticon.invited') && game.state.has('panopticon.gate.open') && !find('pan-intercom').visible()`);
  // stand at Kofi's glass until he glances back
  await ev(`L(7.7, -4.4)`);
  const rep = await until(`game.state.has('panopticon.kofi')`, 30000);
  console.log(`${rep ? 'PASS' : 'FAIL'}  [talk] Kofi glances back and reports you`);
  await wait(3200);
  await check('Kofi\'s report rings the alarm', `B.alarm > 0`);
  await wait(13000);
  await ev(`L(-7.7, 4.4)`);
  const jun = await until(`game.state.has('panopticon.jun')`, 30000);
  console.log(`${jun ? 'PASS' : 'FAIL'}  [talk] Jun sees you, says nothing`);
  await check('Jun: no alarm', `B.alarm <= 0`);
  await ev(`L(-7, 0); window.__pick = ['charge']; act2('tower')`);
  await wait(2500);
  await check('tower charge (Demolition 5): open + alarm', `game.state.has('panopticon.tower.open') && B.alarm > 0`);
  await ev(`L(-1.5, -1.6); window.__pick = ['broadcast']; act('pan-archive')`);
  await wait(400);
  await check('archive broadcast', `game.state.has('panopticon.archive.broadcast')`);
  await loot(t);
  await wait(2500);
  await check('busted', `game.state.has('panopticon.complete')`);
  await check('Ada stays at her desk (never met)', `!game.state.has('panopticon.ada.free')`);
  return t.done();
}

async function short() {
  const t = await open(URL, 'short');
  const { ev, wait, check, bug } = t;
  await ev(STUBS('panopticon'));
  await ev(PRE);
  await ev(`(() => { const s = game.state; s.data.skills.electronics = 3; s.data.skills.social = 0; s.data.skills.demolition = 0; })()`);
  await ev(`L(0, 20.4); window.__pick = ['short']; act2('gate')`);
  await wait(2500);
  await check('gate motor shorted: open, no alarm', `game.state.has('panopticon.gate.open') && B.alarm <= 0 && !game.state.has('panopticon.loud')`);
  // the keypad soft-lock: Electronics 3, Demolition 0, two wrong codes (tower cameras off, so nothing re-rings)
  await ev(`for (const c of ['cam1','cam2','cam3','cam4']) game.state.set('panopticon.cam.' + c + '.off'); B.applyFlags(); game.state.set('panopticon.code')`);
  await ev(`L(-7, 0); window.__keypad = 'wrong'; act('tower')`); await wait(300);
  await ev(`act('tower')`); await wait(300);
  await wait(13500);
  await ev(`window.__pick = []; act2('tower')`); await wait(200);
  await check('tower keypad locked out after two wrong codes', `avail('tower') === 'Keypad locked out'`);
  // a minute on, with the alarm over, it takes guesses again (it used to stay locked: no way in until a reload)
  await ev(`B.t += 61; B.alarm = 0`);
  await check('tower keypad: a minute later it takes guesses again', `avail('tower') === true`);
  console.log('    card', JSON.stringify(__last_ = await ev(`__last.choices.map((c) => c.id + ':' + (c.disabled ?? 'ok'))`)));
  // the rest through flags, then the debrief
  await ev(`for (const f of ['panopticon.tower.open', 'panopticon.archive', 'panopticon.archive.wipe', 'panopticon.loot.cistern', 'panopticon.loot.locker', 'panopticon.loot.shelf', 'panopticon.complete']) game.state.set(f)`);
  const pages = await ev(`(async () => { const m = await import('/src/content/story.ts'); return m.panopticonDebrief({ has: (f) => game.state.has(f), archetype: game.state.archetype }); })()`);
  console.log('    debrief:', pages.map((p) => p.text.slice(0, 80)));
  await bug('debrief after a quiet motor short says "I heard the rails go"', `${JSON.stringify(JSON.stringify(pages))}.includes('rails go')`);
  return t.done();
}

let __last_;
const runs = { splice, talk, short };
let ok = true;
for (const [k, f] of Object.entries(runs)) if (which === 'all' || which === k) ok = (await f()) && ok;
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
