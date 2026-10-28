// Scripted headless playthrough of Bunker Zero (Act VIII), both endings. Needs `npm run dev`.
//
//   node scripts/dev/zero-test.mjs [keep|open|both]
//
// The UI's cards, conversations and minigames are stubbed (as in fortress-test.mjs). PASS/FAIL per check.
//   keep: Mara's call starts Act VIII; the dials; the ladder down (interior mode, the sky's light
//         dimmed); the 1961 door; a placard; a Doorman walks you back to the ladder; the clock gate's
//         keypad; the board (cameras and Doormen off, Model Zero powered); Agnes (why); the key kept;
//         the loot; the debrief; the camp's share by the manway.
//   open: the padlock picked; the grid's junction box; the clock gate spliced; the board (Doormen and
//         lights off); Agnes (the well); the key broken and the well sent up; the standpipe.
import { launch, waitForGame } from './browser.mjs';

const which = process.argv[2] || 'both';
const URL = 'http://localhost:5173/play/?webgl&autostart&at=zero&hour=15';

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
    for (const f of ['briefed', 'debriefed', 'garage.complete', 'apex.complete', 'act2.debriefed', 'panopticon.complete', 'act3.debriefed', 'spire.complete', 'spire.core',
      'act4.debriefed', 'dome.complete', 'dome.end', 'act5.debriefed', 'cathedral.complete', 'cathedral.end', 'act6.debriefed',
      'fortress.complete', 'fortress.end', 'fortress.end.shut', 'act7.debriefed']) s.set(f);
    s.data.skills.electronics = ${ending === 'open' ? 4 : 3};
    s.addItem('lockpick', 4);
    game.combat.difficulty = 'story';
    window.V = game.player.position.constructor;
    window.Z = game.zero;
    window.O = Z.b.origin;
    window.P = Z.b.points;
    window.FY = O.y - 26;
    window.go = (x, z, y) => game.player.teleport(new V(x, y ?? game.hf.heightAt(x, z) + 0.15, z));
    window.L = (x, z) => game.player.teleport(new V(O.x + x, FY + 0.1, O.z + z));
    window.find = (id) => Z.interactables.find((i) => i.id === id) ?? game.interactables.find((i) => i.id === id);
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
    window.__code = null;
    game.ui.keypad = async (o) => { window.__code = o.code; window.__hint = o.hint; return 'ok'; };
    game.ui.lockpick = async () => 'success';
    game.ui.circuit = async () => true;
    game.ui.hack = async (o) => ({ aborted: false, traced: false, done: o.daemons.map((d) => d.id) });
  })()`);

  // Mara's call after Act VII starts Act VIII
  const call = await ev(`(async () => { const m = await import('/src/content/story.ts'); return m.campRadio({ has: (f) => game.state.has(f), archetype: game.state.archetype }); })()`);
  checks.push(['Mara\'s call starts Act VIII', call.flags.includes('zero.known') && call.flags.includes('zero.permit')]);
  console.log(`${call.flags.includes('zero.known') ? 'PASS' : 'FAIL'}  [${ending}] Mara's call: ${JSON.stringify(call.flags)}`);
  await ev(`for (const f of ${JSON.stringify(call.flags)}) game.state.set(f)`);
  await wait(600);
  await check('the manway is live (and on the map)', `find('hatch').visible() && game.mapMarkers?.().some?.((m) => m.id === 'zero') !== false`);

  // the manway
  await ev(`go(P.hatch.x, P.hatch.z + 0.3)`);
  await wait(300);
  if (ending === 'keep') {
    await ev(`act('hatch')`);
    await wait(500);
    await check('dials: the code is the bore\'s depth (hinted)', `window.__code === '2100' && /two thousand one hundred/.test(window.__hint)`);
  } else {
    await ev(`window.__pick = ['lockpick']; find('hatch').secondary.run()`);
    await wait(500);
  }
  await wait(1500);
  await check('the manway is open (the lid up, the hole showing)', `game.state.has('zero.hatch.open') && Z.b.doors.hatch.open > 0.8 && Z.b.hole.visible`);
  // down the ladder
  await ev(`act('zero-down')`);
  await wait(3200);
  await check('down the ladder: at the foot, inside, Agnes greets', `Z.playerInside && game.player.position.distanceTo(P.foot) < 1.5 && game.state.has('zero.down') && game.state.has('seen:zero')`);
  await wait(1200);
  await check('underground: the sky\'s light dimmed, the world hidden (interior mode)', `game.atmo.cover > 0.6 && game.interiorName === 'zero' && Z.b.interior.visible`);
  await check('Model Zero: seven founders lit green', `Z.b.cylOk.slice(0, 7).every((u) => u.value > 1) && Z.b.cylNo[7].value > 0`);
  await ev(`act('door61')`);
  await wait(1500);
  await check('the 1961 door swings open', `game.state.has('zero.door61.open') && Z.b.doors.door61.open > 0.8`);
  await ev(`L(-3.2, -7.7); window.__pick = ['ok']; act('zero-bay-garage')`);
  await wait(400);
  await check('a placard read (Job 0412)', `game.state.has('zero.bay.garage') && /C\\.O\\. 44/.test(window.__last)`);

  if (ending === 'keep') {
    // a Doorman walks you back to the ladder
    await ev(`(() => { const d = Z.doormen.get('d1'); const f = d.facing(); game.player.teleport(new V(d.pos.x + f.x * 2.5, d.pos.y + 0.1, d.pos.z + f.z * 2.5)); })()`);
    const caught = await until(`game.state.has('zero.caught')`, 12000);
    checks.push(['a Doorman caught you', caught]);
    console.log(`${caught ? 'PASS' : 'FAIL'}  [${ending}] a Doorman caught you`);
    await wait(3800);
    await check('caught: back at the ladder\'s foot, still underground', `game.player.position.distanceTo(P.foot) < 2 && Z.playerInside`);
    // the clock gate's keypad
    await ev(`L(1.9, -23.6); act('clock')`);
    await wait(900);
    await check('clock gate: the code is the clock (HHMM)', `game.state.has('zero.clock.open') && window.__code === Z.clockDigits()`);
    // the board: cameras and Doormen off, Model Zero its two units
    await ev(`L(9.3, -41.5); window.__pick = ['cameras', 'doormen', 'vault', 'no']; act('zero-board')`);
    await wait(1500);
    await check('board: cameras and Doormen off, Model Zero powered (4 of 4)', `Z.power().vault && !Z.power().cameras && !Z.power().doormen && Z.used() <= 4 && game.state.has('zero.cameras.off')`);
    await check('the Doormen sat down', `Z.doormen.list.every((d) => d.state === 'off')`);
  } else {
    // the grid's junction box (Electronics 4: no minigame)
    await ev(`L(-5.1, -26.5); act('gridbox')`);
    await wait(500);
    await check('grid down', `game.state.has('zero.lasers.off')`);
    await ev(`L(1.9, -23.6); window.__pick = ['splice']; find('clock').secondary.run()`);
    await wait(900);
    await check('clock gate spliced (and the cameras looped)', `game.state.has('zero.clock.open') && game.state.has('zero.cameras.off')`);
    await ev(`L(9.3, -41.5); window.__pick = ['doormen', 'lights', 'vault', 'no']; act('zero-board')`);
    await wait(1500);
    await check('board: the Doormen and lights off, Model Zero powered', `Z.power().vault && !Z.power().doormen && !Z.power().lights`);
    // and back on: the Doormen get up again (then off for good)
    await ev(`window.__pick = ['vault', 'doormen', 'no']; act('zero-board')`);
    await wait(900);
    await check('board: Doormen back on, they get up', `Z.power().doormen && Z.doormen.list.every((d) => d.state !== 'off')`);
    await ev(`window.__pick = ['doormen', 'vault', 'no']; act('zero-board')`);
    await wait(900);
  }
  // Model Zero
  await ev(`L(0, -43.6); act('zero')`);
  await wait(2500);
  await check('Model Zero open (it swings out)', `game.state.has('zero.zero.open') && Z.b.doors.zeroDoor.open > 0.8 && Z.b.cylOk[7].value > 1`);
  // Agnes, and the master board
  await ev(`L(4.7, -61.7)`);
  await wait(600);
  if (ending === 'keep') {
    await ev(`window.__talk = ['heard', 'why', 'key', 'back', 'decide']; window.__pick = ['keep']; act('zero-agnes')`);
  } else {
    await ev(`window.__talk = ['well', 'ok', 'decide']; window.__pick = ['open']; act('zero-agnes')`);
  }
  await wait(1500);
  if (ending === 'keep') await check('keep: ended; she told you why; Mara\'s padlock on the manway', `game.state.has('zero.end.keep') && game.state.has('zero.agnes.why') && Z.b.campLock.visible`);
  else await check('open: ended; the handle thrown; the standpipe on the forecourt', `game.state.has('zero.end.open') && game.state.has('zero.agnes.well') && Z.b.standpipe.visible`);
  await ev(`(() => { for (const id of ['cistern', 'stores', 'plans']) { const sp = Z.b.lootSpots.find((l) => l.id === id); game.player.teleport(sp.pos.clone().setY(FY + 0.1)); act(id); } })()`);
  await wait(2600);
  await check('busted: zero.complete', `game.state.has('zero.complete')`);
  // up the ladder, and the debrief
  await ev(`L(0, 1.2); act('zero-up')`);
  await wait(3200);
  await check('up the ladder: on the forecourt, the sky back', `!Z.playerInside && game.player.position.distanceTo(P.surfaceOut) < 2`);
  const debrief = await ev(`(async () => { const m = await import('/src/content/story.ts'); return m.campRadio({ has: (f) => game.state.has(f), archetype: game.state.archetype }); })()`);
  console.log(`      debrief flags: ${JSON.stringify(debrief.flags)}; ${debrief.pages.length} pages`);
  for (const pg of debrief.pages) console.log(`        ${pg.speaker}: ${pg.text}`);
  checks.push(['debrief', debrief.flags.includes('act8.debriefed')]);
  await ev(`game.state.set('act8.debriefed'); game.state.data.days = (game.state.data.days ?? 0) + 1`);
  await wait(300);
  if (ending === 'keep') await check('afterwards: the camp\'s share by the manway', `find('zero-share').visible() && find('zero-keep-down').visible()`);
  else await check('afterwards: the standpipe pours', `find('zero-tap').visible()`);
  const obj = await ev(`(async () => { const m = await import('/src/content/story.ts'); return m.storyObjective({ has: (f) => game.state.has(f), archetype: game.state.archetype }); })()`);
  checks.push(['the story objective is the end', /Every door/.test(obj)]);
  console.log(`${/Every door/.test(obj) ? 'PASS' : 'FAIL'}  [${ending}] objective: ${obj}`);
  console.log(errors.length ? `ERRORS (${errors.length}):\n  ${errors.slice(0, 8).join('\n  ')}` : 'no page errors');
  await b.close();
  return checks.every(([, ok]) => ok) && !errors.length;
}

const endings = which === 'both' ? ['keep', 'open'] : [which];
let ok = true;
for (const e of endings) ok = (await run(e)) && ok;
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
