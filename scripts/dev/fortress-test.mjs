// Scripted headless playthrough of the Chip Fortress (Act VII), both endings. Needs `npm run dev`.
//
//   node scripts/dev/fortress-test.mjs [shut|realloc|both]
//
// The UI's cards, conversations and minigames are stubbed (as in dome-test.mjs). PASS/FAIL per check.
//   shut:    the queue's note and the gate code; a technician walks you out; the keep picked; the board
//            (chillers off: the thermal cameras go blind; lights off; the vault door powered); the master key.
//   realloc: a swim (it hurts; you come out cold); the frost door; the pump house and the drain; Marek
//            (his badge, the board, he'll run the turbine); the keep by badge; the grid off at the board;
//            the table rewritten.
import { launch, waitForGame } from './browser.mjs';

const which = process.argv[2] || 'both';
const URL = 'http://localhost:5173/play/?webgl&autostart&at=fortress&hour=15';

async function run(ending) {
  const b = await launch();
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/GL Driver|GPU stall/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await p.goto(URL);
  await waitForGame(p);
  await p.waitForTimeout(2500);
  const checks = [];
  const check = async (name, js) => {
    const ok = await p.evaluate(js).catch((e) => `error: ${e.message}`);
    checks.push([name, ok === true]);
    console.log(`${ok === true ? 'PASS' : 'FAIL'}  [${ending}] ${name}${ok === true ? '' : `  (${JSON.stringify(ok)})`}`);
  };
  const ev = (js) => p.evaluate(js);
  const wait = (ms) => p.waitForTimeout(ms);
  const until = async (js, ms) => {
    for (let t = 0; t < ms; t += 250) { if (await ev(js).catch(() => false)) return true; await wait(250); }
    return false;
  };

  await ev(`(() => {
    const s = game.state;
    for (const f of ['briefed', 'debriefed', 'apex.complete', 'act2.debriefed', 'panopticon.complete', 'act3.debriefed', 'spire.complete', 'spire.core',
      'act4.debriefed', 'dome.complete', 'dome.end', 'act5.debriefed', 'cathedral.complete', 'cathedral.end', 'act6.debriefed']) s.set(f);
    s.data.skills.electronics = 3;
    s.addItem('lockpick', 4);
    game.combat.difficulty = 'story';
    window.V = game.player.position.constructor;
    window.F = game.fortress;
    window.O = F.b.origin;
    window.P = F.b.points;
    window.go = (x, z, y) => game.player.teleport(new V(x, y ?? game.hf.heightAt(x, z) + 0.15, z));
    window.L = (x, z, y = 0.1) => game.player.teleport(new V(O.x + x, O.y + y, O.z + z));
    window.find = (id) => F.interactables.find((i) => i.id === id) ?? game.interactables.find((i) => i.id === id);
    window.act = (id) => { const it = find(id); if (!it) throw new Error('no interactable ' + id); return it.primary.run(); };
    window.__pick = [];
    window.__talk = [];
    // headless Chrome never gives the pointer lock back after a minigame, so the game opens its pause
    // menu, and a pause holds the world (the bunkers, the clock): keep it shut for the run
    game.openPause = () => {};
    game.ui.choose = async (o) => {
      const i = window.__pick.findIndex((id) => o.choices.some((x) => x.id === id));
      const want = i >= 0 ? window.__pick.splice(i, 1)[0] : null;
      const c = o.choices.find((x) => x.id === want && !x.disabled) ?? (want ? null : o.choices.find((x) => !x.disabled));
      window.__last = o.text;
      return c ? c.id : 'no';
    };
    game.ui.converse = async (o) => {
      let id = o.start;
      for (let i = 0; i < 16 && id; i++) {
        const node = o.node(id); if (!node) break;
        const want = window.__talk.shift();
        const c = node.choices.find((x) => x.id === want && !x.disabled);
        if (!c) break;
        o.onChoice(id, c.id);
        id = c.next || '';
      }
    };
    game.ui.keypad = async () => 'ok';
    game.ui.lockpick = async () => 'success';
    game.ui.circuit = async () => true;
    game.ui.hack = async (o) => ({ aborted: false, traced: false, done: o.daemons.map((d) => d.id) });
  })()`);

  await ev(`go(P.road.x, P.road.z)`);
  await wait(1200);
  await check('seen the Fortress (marker)', `game.state.has('seen:fortress') && game.state.has('fortress.marker')`);

  if (ending === 'shut') {
    await ev(`go(P.queue.x, P.queue.z); window.__pick = ['ok']; act('fort-queue')`);
    await wait(400);
    await check('read the queue note (the code hint)', `game.state.has('fortress.queue') && /1,599/.test(window.__last)`);
    await ev(`go(P.gatehouse.x, P.gatehouse.z); act('bridge')`);
    await wait(3500);
    await check('the bridge is down, the gate open', `game.state.has('fortress.bridge.open') && F.b.doors.bridge.open > 0.9 && F.b.doors.gate.open > 0.9`);
    await check('the deck is walkable (a collider over the moat)', `!!F.deck`);
    // a technician in the yard walks you out
    await ev(`(() => { const t = F.techs.get('t1'); const f = t.facing(); go(t.pos.x + f.x * 3, t.pos.z + f.z * 3, O.y + 0.1); })()`);
    const caught = await until(`game.state.has('fortress.caught')`, 12000);
    checks.push(['a technician caught you', caught]);
    console.log(`${caught ? 'PASS' : 'FAIL'}  [${ending}] a technician walked you out`);
    await wait(2500);
    await check('caught: back of the queue', `game.player.position.distanceTo(P.outside) < 6`);
    // the keep, picked
    await ev(`go(P.keepDoor.x, P.keepDoor.z, O.y + 0.1); act('keep')`);
    await wait(700);
    await check('keep picked open', `game.state.has('fortress.keep.open')`);
    // the board: chillers off, lights off, then the vault's two units
    await ev(`L(-4.3, -1.0); window.__pick = ['chillers', 'lights', 'vault', 'no']; act('fort-board')`);
    await wait(1200);
    await check('board: chillers and lights off, the vault powered (3 of 3)', `F.power().vault && !F.power().chillers && !F.power().lights && F.used() <= 3`);
    await check('the thermal cameras are blind', `F.cameraSight() === 0`);
  } else {
    // the swim
    await ev(`(() => { const r = (${'F'}.b ? 27.2 : 0); game.player.teleport(new V(O.x - r, O.y - 3.3, O.z + 6)); })()`);
    await wait(1500);
    await check('in the coolant: hurting, cold', `game.state.has('fortress.swam') && F.coldT > 20 && game.state.data.health < 100`);
    await ev(`L(-16, 0.2, 0.2)`);
    await wait(800);
    await check('out on the berm: the cameras can barely see you', `F.coldT > 0 && F.cameraSight() < 0.1`);
    // the frost door
    await ev(`go(P.postern.x, P.postern.z, O.y + 0.1); act('postern')`);
    await wait(700);
    await check('frost door picked', `game.state.has('fortress.postern.open')`);
    // the pump house, the drain
    await ev(`go(P.pumpDoor.x, P.pumpDoor.z); act('pump')`);
    await wait(700);
    await ev(`go(P.drain.x, P.drain.z, P.drain.y - 1.1); window.__pick = ['drain']; act('fort-drain')`);
    await wait(3000);
    await check('drained: flag, the surface sinking, the cameras blind', `game.state.has('fortress.drained') && F.b.coolant.position.y < -1.2 && F.cameraSight() === 0`);
    // Marek: badge, the board, he'll run the turbine
    await ev(`go(P.marek.x, P.marek.z, O.y + 0.1); window.__talk = ['badge', 'ok', 'board', 'ok', 'run', 'yes', 'bye']; act('fort-marek')`);
    await wait(800);
    await check('Marek: met, badge, board, ready', `game.state.has('fortress.marek.met') && game.state.count('marek_badge') === 1 && game.state.has('fortress.marek.board') && game.state.has('fortress.marek.ready')`);
    await ev(`go(P.keepDoor.x, P.keepDoor.z, O.y + 0.1); window.__pick = ['badge']; find('keep').secondary.run()`);
    await wait(900);
    await check('keep open by badge', `game.state.has('fortress.keep.open')`);
    await ev(`L(-4.3, -1.0); window.__pick = ['grid', 'lights', 'vault', 'no']; act('fort-board')`);
    await wait(1200);
    await check('board: the grid down, lights off, the vault powered', `F.power().vault && !F.power().grid && game.state.has('fortress.lasers.off')`);
  }
  // the vault and the console
  await ev(`go(P.vaultDoor.x, P.vaultDoor.z, O.y + 0.1); act('vault')`);
  await wait(900);
  await check('vault open (powered)', `game.state.has('fortress.vault.open')`);
  await ev(`go(P.kit.x, P.kit.z, O.y + 0.1); window.__talk = ['decide']; window.__pick = ['${ending}']; act('fort-kit')`);
  await wait(1500);
  if (ending === 'shut') await check('shut: ended, the coolant warming', `game.state.has('fortress.end.shut') && F.techs.list.every((t) => t.state !== 'chase')`);
  else await check('realloc: ended, the board rewritten', `game.state.has('fortress.end.realloc') && F.boardKey.includes('LAST CHANCE')`);
  await ev(`(() => { for (const id of ['tank', 'dispenser', 'kitdesk']) { const sp = F.b.lootSpots.find((l) => l.id === id); go(sp.pos.x, sp.pos.z, O.y + 0.1); act(id); } })()`);
  await wait(2600);
  await check('busted: fortress.complete', `game.state.has('fortress.complete')`);
  const debrief = await ev(`(async () => { const m = await import('/src/content/story.ts'); return m.campRadio({ has: (f) => game.state.has(f), archetype: game.state.archetype }); })()`);
  console.log(`      debrief flags: ${JSON.stringify(debrief.flags)}; ${debrief.pages.length} pages`);
  for (const pg of debrief.pages) console.log(`        ${pg.speaker}: ${pg.text}`);
  checks.push(['debrief', debrief.flags.includes('act7.debriefed')]);
  await ev(`game.state.set('act7.debriefed'); game.state.data.days = (game.state.data.days ?? 0) + 1`);
  await wait(300);
  if (ending === 'shut') await check('afterwards: the seep at the Cut runs', `game.interactables.find((i) => i.id === 'fort-seep').visible()`);
  else await check('afterwards: the battery rack at the camp', `game.interactables.find((i) => i.id === 'fort-rack').visible()`);
  console.log(errors.length ? `ERRORS (${errors.length}):\n  ${errors.slice(0, 8).join('\n  ')}` : 'no page errors');
  await b.close();
  return checks.every(([, ok]) => ok) && !errors.length;
}

const endings = which === 'both' ? ['shut', 'realloc'] : [which];
let ok = true;
for (const e of endings) ok = (await run(e)) && ok;
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
