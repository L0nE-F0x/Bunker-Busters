// Scripted headless playthrough of the Cloud Cathedral (Act VI), both endings. Needs `npm run dev`.
//
//   node scripts/dev/cathedral-test.mjs [close|hand|both]
//
// The UI's cards, conversations and minigames are stubbed (as in dome-test.mjs): `window.__pick`
// answers cards (by choice id), `window.__talk` picks conversation choices in order, keypads, locks
// and SPLICE succeed. PASS/FAIL per check.
//   close: no rider's order; caught by the swarm on the lot; in through the dock; an obstruction on the
//          floor and a floor drone; the floor E-stopped; the code off the plaque; the site key.
//   hand:  Rider 9's order (the swarm lets you be); the returns line; Lo (badge, code, she'll run it);
//          the swarm grounded; the transfer.
import { launch, waitForGame } from './browser.mjs';

const which = process.argv[2] || 'both';
const URL = 'http://localhost:5173/play/?webgl&autostart&at=cathedral&hour=15';

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
  /** Poll `js` every 250 ms for up to `ms`. */
  const until = async (js, ms) => {
    for (let t = 0; t < ms; t += 250) { if (await ev(js).catch(() => false)) return true; await wait(250); }
    return false;
  };

  await ev(`(() => {
    const s = game.state;
    for (const f of ['briefed', 'debriefed', 'act1.leverage', 'apex.complete', 'act2.debriefed', 'panopticon.complete', 'act3.debriefed',
      'spire.complete', 'spire.core', 'act4.debriefed', 'dome.complete', 'dome.end', 'dome.end.plug', 'act5.debriefed']) s.set(f);
    if (${ending === 'hand'}) s.set('q.rider.log');
    s.data.skills.electronics = 4;
    s.addItem('lockpick', 3);
    game.combat.difficulty = 'story';
    window.V = game.player.position.constructor;
    window.C = game.cathedral;
    window.O = C.b.origin;
    window.P = C.b.points;
    window.go = (x, z, y) => game.player.teleport(new V(x, y ?? Math.max(game.hf.heightAt(x, z), O.y - 50) + 0.15, z));
    window.L = (x, z, y = 0.1) => game.player.teleport(new V(O.x + x, O.y + y, O.z + z));
    window.find = (id) => C.interactables.find((i) => i.id === id) ?? game.interactables.find((i) => i.id === id);
    window.act = (id) => { const it = find(id); if (!it) throw new Error('no interactable ' + id); return it.primary.run(); };
    window.avail = (id) => { const it = find(id); return it ? it.primary.available() : 'missing'; };
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

  // the road: seen, marked
  await ev(`go(P.road.x, P.road.z)`);
  await wait(1200);
  await check('seen the Cathedral (marker)', `game.state.has('seen:cathedral') && game.state.has('cathedral.marker')`);
  await check('the pods are on the floor', `C.floor.census().pods > 40`);

  // the lot: stand where a drone is looking
  const underDrone = `(() => { const d = C.swarm.list.find((x) => !x.inside && x.state === 'patrol'); const f = { x: Math.sin(d.yaw) * 2, z: Math.cos(d.yaw) * 2 }; go(d.pos.x + f.x, d.pos.z + f.z); })()`;
  if (ending === 'close') {
    await ev(underDrone);
    await check('a drone tagged you (swarm converging)', `(async () => { for (let i = 0; i < 40; i++) { if (C.swarm.tagged) return true; await new Promise((r) => setTimeout(r, 250)); const d = C.swarm.list.find((x) => !x.inside && x.state === 'patrol'); if (d && i % 6 === 5) { const f = { x: Math.sin(d.yaw) * 2, z: Math.cos(d.yaw) * 2 }; go(d.pos.x + f.x, d.pos.z + f.z); } } return C.swarm.tagged; })()`);
    const caught = await until(`game.state.has('cathedral.caught')`, 22000);
    checks.push(['returned to sender', caught]);
    console.log(`${caught ? 'PASS' : 'FAIL'}  [${ending}] returned to sender (the swarm crowded you)`);
    await wait(2500);
    await check("caught: carried to the lot's edge", `game.player.position.distanceTo(P.outside) < 8`);
  } else {
    for (let i = 0; i < 24 && !(await ev(`game.state.has('cathedral.rider')`)); i++) { await ev(underDrone); await wait(500); }
    await check('rider on an open order: not tagged', `!C.swarm.tagged && game.state.has('cathedral.rider')`);
  }

  // in: the dock (close) or the returns line (hand)
  if (ending === 'close') {
    await ev(`go(P.dock.x, P.dock.z)`);
    await wait(400);
    await ev(`act('dock')`);
    await wait(800);
    await check('dock wicket picked open', `game.state.has('cathedral.dock.open')`);
    await ev(`go(P.dockIn.x, P.dockIn.z, O.y + 0.2)`);
    await wait(600);
    await check('inside the hall', `C.playerInside`);
  } else {
    await ev(`go(P.kiosk.x, P.kiosk.z)`);
    await wait(400);
    await check("the kiosk hint is Rider 9's order", `C.sec.entries.find((e) => e.id === 'returns').primary.hints[0].when.includes('q.rider.log')`);
    await ev(`window.__pick = ['in']; act('returns')`);
    await wait(1500);
    await check('returns open, riding', `game.state.has('cathedral.returns.open') && C.riding`);
    await check('riding: crouched, frozen', `game.player.frozen && game.player.forceCrouch`);
    const rode = await until(`!C.riding`, 30000);
    checks.push(['the ride ends', rode]);
    console.log(`${rode ? 'PASS' : 'FAIL'}  [${ending}] the returns line delivered you`);
    await check('tipped out in the crossing', `game.state.has('cathedral.rode') && game.player.position.distanceTo(P.rideEnd) < 1.5 && C.playerInside && !game.player.frozen`);
  }

  // the floor
  if (ending === 'close') {
    // stand in the cell a moving pod is heading for: it holds and reports an obstruction
    await until(`(() => {
      const f = C.floor;
      const q = f.pods.find((x) => x.moving && x.t < 0.15);
      if (!q) return false;
      const c = f.cellPos(q.i, q.j); game.player.teleport(new V(c.x, O.y + 0.1, c.z));
      return true;
    })()`, 10000);
    const ob = await until(`C.obstructions > 0`, 5000);
    checks.push(['obstruction reported', ob]);
    console.log(`${ob ? 'PASS' : 'FAIL'}  [${ending}] a drive stopped for you and reported an obstruction`);
    await check('a floor drone goes to look', `C.swarm.list.some((d) => d.inside && d.state === 'inspect')`);
    // the floor kiosk: E-stop
    await ev(`L(-7.5, 16.3)`);
    await wait(300);
    await ev(`act('cath-floorkiosk')`);
    await wait(500);
    await check('E-stop: the floor freezes', `C.eStop > 60 && C.floorHost().mode() === 'stop'`);
    // the plaque gives the code's hint
    await ev(`go(P.plaque.x, P.plaque.z, O.y + 0.1); window.__pick = ['ok']; act('cath-plaque')`);
    await wait(400);
    await check('read the plaque', `game.state.has('cathedral.plaque')`);
  } else {
    // Lo: Mateo's badge, the code, and she'll run it
    await ev(`go(P.lo.x, P.lo.z, O.y + 0.1)`);
    await wait(400);
    await ev(`window.__talk = ['drives', 'ok', 'office', 'ok', 'after', 'yes', 'bye']; act('cath-lo')`);
    await wait(800);
    await check('Lo: met, badge, code, ready', `game.state.has('cathedral.lo.met') && game.state.count('mateo_badge') === 1 && game.state.has('cathedral.lo.code') && game.state.has('cathedral.lo.ready')`);
    // with the badge, a pod heading for you holds without a report
    const before = await ev(`C.obstructions`);
    await until(`(() => {
      const f = C.floor;
      const q = f.pods.find((x) => x.moving && x.t < 0.15);
      if (!q) return false;
      const c = f.cellPos(q.i, q.j); game.player.teleport(new V(c.x, O.y + 0.1, c.z));
      return true;
    })()`, 10000);
    await wait(2500);
    await check('badge: no obstruction reports', `C.obstructions === ${before}`);
    // the swarm controller at the bell tower's foot (from outside)
    await ev(`go(P.panel.x, P.panel.z)`);
    await wait(300);
    await ev(`act('cath-swarmpanel')`);
    await wait(500);
    await check('swarm grounded (flag, heading home)', `game.state.has('cathedral.swarm.grounded') && C.swarm.list.filter((d) => !d.inside).every((d) => ['home', 'landed', 'down', 'falling'].includes(d.state))`);
  }

  // the office
  await ev(`go(P.officeDoor.x, P.officeDoor.z, O.y + 5.6)`);
  await wait(500);
  await ev(`act('office')`);
  await wait(600);
  await check('office open (code)', `game.state.has('cathedral.office.open')`);
  await ev(`go(P.orrin.x, P.orrin.z, O.y + 5.6)`);
  await wait(500);
  await ev(`window.__talk = ['decide']; window.__pick = ['${ending}']; act('cath-orrin')`);
  await wait(1500);
  if (ending === 'close') {
    await check('close: ended, doors open, floor off', `game.state.has('cathedral.end.close') && !C.b.doors.frontW.collider && C.floorHost().mode() === 'off'`);
    await wait(2500);
    await check('close: the swarm goes home', `C.swarm.list.every((d) => ['home', 'landed', 'down', 'falling'].includes(d.state))`);
  } else {
    await check('hand: ended, owner on the board, drones friendly', `game.state.has('cathedral.end.hand') && C.swarmHost().mode() === 'friendly' && C.boardKey.includes('L. IBARRA')`);
    await check('hand: Orrin works returns', `find('cath-orrin-returns').visible()`);
  }
  // the loot
  await ev(`(() => { for (const id of ['pallet', 'desk', 'shelf']) { const sp = C.b.lootSpots.find((l) => l.id === id); go(sp.pos.x, sp.pos.z, O.y + 5.6); act(id); } })()`);
  await wait(2600);
  await check('busted: cathedral.complete', `game.state.has('cathedral.complete')`);
  if (ending === 'close') {
    await ev(`C.leaveT = 200; go(P.road.x, P.road.z)`);
    await wait(800);
    await check('the associates walked out', `game.state.has('cathedral.assoc.gone')`);
  }
  // the debrief
  const debrief = await ev(`(async () => { const m = await import('/src/content/story.ts'); return m.campRadio({ has: (f) => game.state.has(f), archetype: game.state.archetype }); })()`);
  console.log(`      debrief flags: ${JSON.stringify(debrief.flags)}; ${debrief.pages.length} pages`);
  for (const pg of debrief.pages) console.log(`        ${pg.speaker}: ${pg.text}`);
  checks.push(['debrief', debrief.flags.includes('act6.debriefed')]);
  await ev(`game.state.set('act6.debriefed'); game.state.data.days = (game.state.data.days ?? 0) + 1`);
  await wait(300);
  if (ending === 'close') await check('afterwards: Lo at the camp', `game.interactables.find((i) => i.id === 'cath-lo-camp').visible()`);
  else await check('afterwards: the Dropt parcel at the camp', `game.interactables.find((i) => i.id === 'cath-drop').visible()`);
  console.log(errors.length ? `ERRORS (${errors.length}):\n  ${errors.slice(0, 8).join('\n  ')}` : 'no page errors');
  await b.close();
  return checks.every(([, ok]) => ok) && !errors.length;
}

const endings = which === 'both' ? ['close', 'hand'] : [which];
let ok = true;
for (const e of endings) ok = (await run(e)) && ok;
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
