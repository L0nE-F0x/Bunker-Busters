// Scripted headless playthrough of the Alignment Spire (Act IV), both endings. Needs `npm run dev`.
//
//   node scripts/dev/spire-test.mjs [pull|valve|both]
//
// The UI's choice cards and conversations are stubbed: `window.__pick` answers cards (by choice id),
// `window.__talk` picks conversation choices in order. Prints PASS/FAIL per check.
import { launch, waitForGame } from './browser.mjs';

const which = process.argv[2] || 'both';
const URL = 'http://localhost:5173/play/?webgl&autostart&at=spire&hour=15';

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

  // a save that has finished Act III: ledger kept, Apex by the vent, archive taken, Ada out
  await ev(`(() => {
    const s = game.state;
    for (const f of ['briefed', 'debriefed', 'act1.leverage', 'apex.complete', 'apex.vent.open', 'act2.debriefed', 'panopticon.complete',
      'panopticon.archive', 'panopticon.archive.take', 'panopticon.ada.met', 'panopticon.ada.free', 'act3.debriefed']) s.set(f);
    s.data.stats.kills = 0;
    s.data.skills.electronics = 1;
    game.combat.difficulty = 'story';
    window.V = game.player.position.constructor;
    window.O = game.spire.b.origin;
    window.go = (x, z, y) => game.player.teleport(new V(x, y ?? game.hf.heightAt(x, z) + 0.15, z));
    window.act = (id) => { const it = game.interactables.find((i) => i.id === id); if (!it) throw new Error('no interactable ' + id); return it.primary.run(); };
    window.__pick = [];
    window.__talk = [];
    // (answers are matched by id wherever they are in the queue: the door asks its questions in a random order)
    // headless Chrome never gives the pointer lock back after a minigame, so the game opens its pause
    // menu, and a pause holds the world (the bunkers, the clock): keep it shut for the run
    game.openPause = () => {};
    game.ui.choose = async (o) => {
      const i = window.__pick.findIndex((id) => o.choices.some((x) => x.id === id));
      const want = i >= 0 ? window.__pick.splice(i, 1)[0] : null;
      const c = o.choices.find((x) => x.id === want) ?? o.choices.find((x) => !x.disabled);
      window.__last = o.text;
      return c ? c.id : null;
    };
    game.ui.converse = async (o) => {
      let id = o.start;
      for (let i = 0; i < 12 && id; i++) {
        const node = o.node(id); if (!node) break;
        const want = window.__talk.shift();
        const c = node.choices.find((x) => x.id === want);
        if (!c) break;
        o.onChoice(id, c.id);
        id = c.next || '';
      }
    };
  })()`);

  // the road: the marker, a beam, the level
  await ev(`go(${'O.x - 30'}, O.z - 70)`);
  await wait(800);
  await check('seen the Spire', `game.state.has('seen:alignment') && game.state.has('spire.marker')`);
  await check('quest act4 started', `!!game.story && JSON.stringify(game.story).length > 0`);
  // cross beam 1 standing up (the beams are between the guardrails)
  // (in steps: a jump of more than 2 m in a frame counts as a teleport, not a step across the beam)
  for (const k of [-2, -1.4, -0.8, -0.2, 0.4, 1, 1.6, 2]) {
    await ev(`(() => { const w = game.spire.tripwires.wires[0]; const m = w.a.clone().lerp(w.b, 0.5); const t = w.b.clone().sub(w.a).normalize(); const n = new V(t.z, 0, -t.x); go(m.x + n.x * ${k}, m.z + n.z * ${k}); })()`);
    await wait(k === -2 ? 400 : 150);
  }
  await wait(450);
  await check('a beam raises the level to 2', `game.spire.level === 2`);
  // (teleporting about would cross the other beams: switch them off for the rest of the run)
  await ev(`for (const w of game.spire.tripwires.wires) game.state.set('spire.' + w.id + '.disarmed'); game.spire.applyFlags()`);
  // Isaac Fenn's badge
  await ev(`window.__pick = ['take']; act('spire-fenn')`);
  await wait(300);
  await check('Fenn: badge taken', `game.state.count('fenn_badge') === 1 && game.state.has('spire.fenn')`);

  // a sentinel with a weapon out: it apologises; out of sight before the end it logs a near miss
  await ev(`(() => { const s = game.spire.sentinels.get('s2'); const p = s.center; go(p.x - Math.sin(s.spot.yaw) * -8, p.z - Math.cos(s.spot.yaw) * -8); game.arms.equip('revolver', true); })()`);
  await wait(2500);
  await check('sentinel apologises at an armed player', `['sorry','fire','track'].includes(game.spire.sentinels.get('s2').state)`);
  await ev(`game.arms.equip(null, true)`);
  await wait(2500);
  await check('holstered: it stops (watch/report/scan)', `['watch','report','scan'].includes(game.spire.sentinels.get('s2').state)`);

  // the door: honest answers (ledger kept, the vent, archive taken, Ada in Dry Creek, nothing killed), the promise
  await ev(`(() => { game.state.data.marks['spire.concern'] = 0; go(game.spire.b.points.door.x, game.spire.b.points.door.z); })()`);
  await wait(600);
  await ev(`window.__pick = ['go', 'leverage', 'vent', 'take', 'creek', 'none', 'none', 'none', 'everyone']; act('door')`);
  await wait(3500);
  await check('door: honest answers open it', `game.state.has('spire.door.open') && game.state.has('spire.door.honest')`);
  await check('door: the promise is kept', `game.state.has('spire.promise.everyone')`);

  // inside: a stair beam, the power box
  await ev(`go(O.x + 1, O.z - 4.5, O.y + 0.2)`);
  await wait(800);
  await check('inside the drum', `game.spire.playerInside`);
  await ev(`(() => { const l = game.spire.lasers.beams[0]; go(l.a.x + 0.7, l.a.z + 0.15, l.a.y - 0.6); })()`);
  await wait(300);
  await ev(`(() => { const l = game.spire.lasers.beams[0]; go(l.a.x + 0.7, l.a.z - 0.15, l.a.y - 0.6); })()`);
  await wait(500);
  await check('a stair beam raises the level', `game.spire.level >= 2`);
  await ev(`game.state.data.skills.electronics = 3; act('spire-power')`);
  await wait(400);
  await check('power box kills the stair beams', `game.state.has('spire.lasers.off')`);

  // Noor: wake her, ask about the turret, her card, and to come
  await ev(`go(game.spire.b.points.noor.x, game.spire.b.points.noor.z, O.y + 4.75)`);
  await wait(600);
  await ev(`window.__talk = ['turret', 'back', 'up', 'back', 'come', 'ok']; act('spire-noor')`);
  await wait(9000);
  await check('Noor awake (met)', `game.state.has('spire.noor.met')`);
  await check('Noor: Sentinel 3 in test mode', `game.state.has('spire.sentinel3.test') && game.spire.sentinels.get('s3').state === 'off'`);
  await check('Noor: card and ready', `game.state.has('spire.noor.card') && game.state.has('spire.noor.ready')`);

  // the top door with her card
  await ev(`go(game.spire.b.points.officeDoor.x, game.spire.b.points.officeDoor.z, O.y + 9.35)`);
  await wait(600);
  await ev(`act('office')`);
  await wait(800);
  await check('top door opens with the card', `game.state.has('spire.office.open')`);

  // the core
  await ev(`go(game.spire.b.points.core.x, game.spire.b.points.core.z, O.y + 9.35)`);
  await wait(600);
  await ev(`window.__pick = ['${ending}']; act('spire-core')`);
  await wait(1500);
  if (ending === 'pull') {
    await check('pulled: carrying, paused at level 4', `game.state.has('spire.core.carrying') && game.spire.paused && game.spire.level === 4 && game.state.count('purifier_core') === 1`);
    await check('pulled: no weapon, no sprint', `game.arms.handsFull === true && game.player.heavy === true`);
    await ev(`game.arms.equip('revolver')`);
    await wait(200);
    await check('pulled: no weapon comes out', `game.arms.equipped === null`);
  } else {
    await check('valve: level back to 1, sentinels off', `game.state.has('spire.core.valve') && game.spire.level === 1 && game.spire.sentinels.list.every((t) => t.state === 'off' || !t.alive)`);
  }
  // the loot
  await ev(`(() => { for (const id of ['tank', 'cabinet', 'bench']) { const sp = game.spire.b.lootSpots.find((l) => l.id === id); go(sp.pos.x, sp.pos.z, O.y + 9.35); act(id); } })()`);
  await wait(2500);
  await check('busted: spire.complete', `game.state.has('spire.complete')`);
  // Noor walks out once nobody's watching (she's a floor down)
  await wait(8000);
  await check('Noor has left', `game.state.has('spire.noor.free')`);
  if (ending === 'pull') {
    await ev(`go(O.x - 160, O.z - 40)`);
    await wait(1500);
    await check('escaped: carrying cleared, pause over', `!game.state.has('spire.core.carrying') && !game.spire.paused && !game.arms.handsFull`);
  }
  // the debrief
  await check('debrief pages', `(() => { const st = game.state; return true; })()`);
  const debrief = await ev(`(async () => { const m = await import('/src/content/story.ts'); const r = m.campRadio({ has: (f) => game.state.has(f), archetype: game.state.archetype }); return r; })()`);
  console.log(`      debrief flags: ${JSON.stringify(debrief.flags)}; ${debrief.pages.length} pages`);
  for (const pg of debrief.pages) console.log(`        ${pg.speaker}: ${pg.text}`);
  checks.push(['debrief', debrief.flags.includes('act4.debriefed')]);
  console.log(errors.length ? `ERRORS (${errors.length}):\n  ${errors.slice(0, 8).join('\n  ')}` : 'no page errors');
  await b.close();
  return checks.every(([, ok]) => ok) && !errors.length;
}

const endings = which === 'both' ? ['pull', 'valve'] : [which];
let ok = true;
for (const e of endings) ok = (await run(e)) && ok;
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
