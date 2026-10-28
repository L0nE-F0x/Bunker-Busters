// Scripted headless playthrough of the Garage (Act I). Needs `npm run dev`.
//   node scripts/dev/garage-test.mjs [pick|talk|loud|all]
// pick: greeting, gate pick, tripwire tripped/disarmed, side door pick, a laser, the fuse box, keypad lockout
//       then pick the vault, loot all three, busted once, the quest's steps.
// talk: Social 5 at the intercom (recall, gate, side door, code), keypad with the code, SPLICE (vault,
//       seedbot, lasers), loot; then the debrief and the intercom afterwards.
// loud: gap (intel), charge on the side door (loud + quiet), vault charge at Demolition 5, SeedBot alert + zap
//       (caught: teleported out, a pick lost), EMP.
import { open, STUBS } from './early-common.mjs';

const which = process.argv[2] || 'all';
const URL = 'http://localhost:5173/play/?webgl&autostart&hour=15';

async function pick() {
  const t = await open(URL, 'pick');
  const { ev, wait, check, until, bug } = t;
  await ev(STUBS('garage'));
  await ev(`(() => { const s = game.state; s.set('briefed'); s.data.skills.electronics = 0; s.data.skills.social = 0; s.data.skills.demolition = 0; s.addItem('lockpick', 4); game.combat.difficulty = 'story'; B.drone.recall(600); })()`);
  await ev(`L(0, 30)`);
  await wait(1500);
  await check('greeting on approach', `__subs.some((s) => /PRIVATE apocalypse/.test(s))`);
  await check('gate: primary is a 3-pin pick', `find('gate').primary.label === 'Pick lock · 3 pins' && avail('gate') === true`);
  await check('gate: charge greyed (no charge)', `typeof avail('gate', true) === 'string'`);
  await ev(`L(0, 21.5); act('gate')`);
  await wait(1800);
  await check('gate open: flag, doors swing, colliders gone, padlock hidden', `game.state.has('garage.gate.open') && B.b.doors.gateL.open > 0.8 && !B.b.doors.gateL.collider && !B.b.doors.gateR.collider && !B.b.lockMeshes.gate.visible`);
  await check('quest: fence step done', `game.state.has('q:act1:fence')`);
  // tripwire: cross it standing
  // (in steps: a jump of more than 2 m in a frame counts as a teleport, not a step)
  for (const z of [19, 18.4, 17.8, 17.0, 16.4]) { await ev(`L(0, ${z})`); await wait(z === 19 ? 500 : 150); }
  await wait(300);
  await check('tripwire crossed standing: alarm', `B.alarm > 0 && __toasts.some((x) => /tripped a wire/.test(x))`);
  await wait(8000);
  await check('alarm decays', `B.alarm <= 0`);
  // disarm the side wire
  await ev(`L(11.75, -6.5)`); await wait(300);
  await check('tripwire disarm needs Electronics 1', `typeof avail('tw_side') === 'string'`);
  await ev(`game.state.data.skills.electronics = 1; act('tw_side')`);
  await check('tripwire disarmed', `game.state.has('garage.tw_side.disarmed') && !find('tw_side').visible()`);
  // the side door
  await ev(`L(9.4, -3); act('side')`);
  await wait(1500);
  await check('side door picked: open, collider gone', `game.state.has('garage.side.open') && B.b.doors.side.open > 0.8 && !B.b.doors.side.collider`);
  await check('side door line once', `__subs.filter((s) => /load-bearing/.test(s)).length === 1`);
  // lasers: stand in the low beam
  await ev(`L(0, -0.6)`); await wait(400);
  await check('inside the house', `B.playerInside`);
  await ev(`L(0, -1.6)`); await wait(300);
  await check('laser broken: alarm', `B.alarm > 0 && __toasts.some((x) => /Laser tripped/.test(x))`);
  await ev(`L(-6.5, -0.9); act('fuse')`);
  await wait(500);
  await check('fuse box (circuit): lasers off, beams hidden', `game.state.has('garage.lasers.off') && B.b.lasers.every((l) => !l.mesh.visible)`);
  await wait(8000);
  // keypad lockout, then the pick
  await ev(`L(0, -5); window.__keypad = 'wrong'; window.__pick = ['pad']; act2('vault')`); await wait(200);
  await ev(`window.__pick = ['pad']; act2('vault')`); await wait(200);
  await check('two wrong codes: no alarm yet', `B.alarm <= 0`);
  await ev(`window.__pick = ['pad']; act2('vault')`); await wait(300);
  await check('third wrong code: lockout alarm', `B.alarm > 0 && __toasts.some((x) => /lockout/i.test(x))`);
  await ev(`window.__pick = ['pad']; act2('vault')`); await wait(200);
  await check('keypad now disabled on the card', `__last.choices.find((c) => c.id === 'pad').disabled === 'Keypad locked out'`);
  await ev(`window.__keypad = 'ok'; act('vault')`);
  await wait(1500);
  await check('vault picked: open', `game.state.has('garage.vault.open') && B.b.doors.vault.open > 0.8 && !B.b.doors.vault.collider`);
  // loot
  const xp0 = await ev(`game.state.data.xp`);
  for (const id of ['crate_a', 'crate_b', 'safe']) { await ev(`(() => { const sp = B.b.lootSpots.find((l) => l.id === '${id}'); game.player.teleport(sp.pos.clone().setY(O.y + 0.1)); act('${id}'); })()`); await wait(300); }
  await wait(2500);
  await check('busted: complete, manifest + water, banner', `game.state.has('garage.complete') && game.state.count('seed_manifest') === 1 && game.state.count('water') >= 4 && __banners.some((b) => /BUNKER BUSTED/.test(b))`);
  await check('busted counted once', `game.state.data.stats.busted === 1`);
  await check('lids open', `B.b.lootSpots.filter((l) => l.lid).every((l) => l.lid.rotation.x < -1.5)`);
  await check('loot interactables gone', `['crate_a', 'crate_b', 'safe'].every((id) => !find(id).visible())`);
  await wait(1500);
  await check('quest steps: vault, loot', `game.state.has('q:act1:vault') && game.state.has('q:act1:loot')`);
  console.log('    xp gained', (await ev(`game.state.data.xp`)) - xp0);
  return t.done();
}

async function talk() {
  const t = await open(URL, 'talk');
  const { ev, wait, check, bug } = t;
  await ev(STUBS('garage'));
  await ev(`(() => { const s = game.state; s.set('briefed'); s.data.skills.electronics = 2; s.data.skills.social = 5; s.data.skills.demolition = 0; game.combat.difficulty = 'story'; })()`);
  await ev(`L(0, 25); window.__talk = ['recall', 'bye']; act('intercom-out')`);
  await wait(300);
  await check('recall: SeedBot sent home', `game.state.has('social.recalled')`);
  await ev(`window.__talk = ['gate', 'bye']; act('intercom-out')`);
  await wait(1500);
  await check('talked the gate open (doors, colliders)', `game.state.has('garage.gate.open') && game.state.has('social.gate') && !B.b.doors.gateL.collider`);
  // (round the gate's tripwire, not across it)
  await ev(`L(5, 21)`); await wait(200); await ev(`L(5, 16.5)`); await wait(200);
  await ev(`L(2.4, 16.5); window.__talk = ['side', 'bye']; act('intercom-in')`);
  await wait(1500);
  await check('talked the side door open', `game.state.has('garage.side.open') && !B.b.doors.side.collider`);
  await t.bug('Tanner unlatches the side door himself, then complains about it being broken', `__subs.some((s) => /load-bearing/.test(s))`);
  await ev(`window.__talk = ['code', 'bye']; act('intercom-in')`);
  await check('he said the code', `game.state.has('social.code')`);
  // keypad with the code (hint) + SPLICE for the lasers & SeedBot after
  await ev(`L(0, -0.4); window.__pick = ['splice']; window.__hack = null; act2('vault')`);
  await wait(1500);
  await check('SPLICE offered vault, seedbot, lasers', `JSON.stringify(__daemons) === '["vault","seedbot","lasers"]'`);
  await check('SPLICE: vault open, lasers off, no alarm', `game.state.has('garage.vault.open') && game.state.has('garage.lasers.off') && B.alarm <= 0`);
  for (const id of ['crate_a', 'crate_b', 'safe']) { await ev(`(() => { const sp = B.b.lootSpots.find((l) => l.id === '${id}'); game.player.teleport(sp.pos.clone().setY(O.y + 0.1)); act('${id}'); })()`); await wait(300); }
  await wait(2500);
  await check('busted', `game.state.has('garage.complete')`);
  // the intercom afterwards: 'after'; then after the debrief
  await ev(`L(2.4, 16.5); window.__talk = ['bye']; act('intercom-in')`);
  await check('after-talk starts at "after"', `__conv[0][0] === 'after'`);
  const pages = await ev(`(async () => { const m = await import('/src/content/story.ts'); return m.campRadio({ has: (f) => game.state.has(f), archetype: game.state.archetype }); })()`);
  console.log('    debrief:', JSON.stringify(pages.flags), pages.pages.length, 'pages');
  await ev(`game.state.set('debriefed')`);
  await t.bug('the "reseller" choice needs debriefed, but the intercoms vanish at debriefed (dead dialogue)', `!find('intercom-in').visible() && !find('intercom-out').visible()`);
  return t.done();
}

async function loud() {
  const t = await open(URL, 'loud');
  const { ev, wait, check, until, bug } = t;
  await ev(STUBS('garage'));
  await ev(`(() => { const s = game.state; s.set('briefed'); s.data.skills.electronics = 0; s.data.skills.social = 0; s.data.skills.demolition = 5; s.addItem('charge', 3); game.combat.difficulty = 'story'; })()`);
  await check('gap hidden without intel', `!find('gap').visible()`);
  await ev(`game.state.set('garage.gap'); B.drone.recall(600); L(24, -12.5)`);
  await wait(200);
  await ev(`act('gap')`);
  await wait(2500);
  await check('gap opened (panel swings, collider gone)', `game.state.has('garage.gap.open') && !B.b.doors.gap.collider && B.b.doors.gap.open > 0.8`);
  // charge on the side door standing: loud
  await ev(`L(9.4, -3); window.__pick = ['charge']; act2('side')`);
  await wait(400);
  await check('side charge standing: alarm', `game.state.has('garage.side.open') && B.alarm > 0 && game.state.count('charge') === 2`);
  await wait(8000);
  // vault charge (Demolition 5: never quiet)
  await ev(`game.state.set('garage.lasers.off'); B.applyFlags(); L(0, -5); window.__pick = ['charge']; act2('vault')`);
  await wait(400);
  await check('vault charge: open + alarm', `game.state.has('garage.vault.open') && B.alarm > 0`);
  await wait(8000);
  // SeedBot: out in the yard, standing in its face
  await ev(`B.drone.recall(0); B.drone.state = 'patrol';`);
  const picks0 = await ev(`(game.state.addItem('lockpick', 3), game.state.count('lockpick'))`);
  await ev(`(() => { const d = B.drone; const f = new V(Math.sin(d.yaw), 0, Math.cos(d.yaw)); go(d.position.x + f.x * 2.5, d.position.z + f.z * 2.5); })()`);
  // keep standing in front of it until it zaps
  let zapped = false;
  for (let i = 0; i < 40 && !zapped; i++) {
    await ev(`(() => { const d = B.drone; if (d.state === 'disabled') return; const f = new V(Math.sin(d.yaw), 0, Math.cos(d.yaw)); if (game.player.position.distanceTo(d.position) > 4) go(d.position.x + f.x * 2.2, d.position.z + f.z * 2.2); })()`);
    await wait(250);
    zapped = await ev(`game.state.data.stats.caught > 0`);
  }
  await check('SeedBot alerted and zapped you', `game.state.data.stats.caught > 0`);
  await wait(4000);
  await check('caught: outside the gate, a pick gone', `game.player.position.distanceTo(B.outsidePoint) < 2 && game.state.count('lockpick') === ${picks0} - 1`);
  // EMP
  await ev(`B.drone.recall(0); const pos = B.drone.position.clone(); window.__empHit = B.emp(pos, 8.5)`);
  await check('EMP fries SeedBot', `__empHit && B.drone.state === 'disabled'`);
  return t.done();
}

const runs = { pick, talk, loud };
let ok = true;
for (const [k, f] of Object.entries(runs)) if (which === 'all' || which === k) ok = (await f()) && ok;
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
