// Scripted headless playthrough of the Singularity Dome (Act V), both endings. Needs `npm run dev`.
//
//   node scripts/dev/dome-test.mjs [plug|job|both]
//
// The UI's cards, conversations and minigames are stubbed: `window.__pick` answers cards (by choice
// id), `window.__talk` picks conversation choices in order, keypads and locks succeed. PASS/FAIL per check.
import { launch, waitForGame } from './browser.mjs';

const which = process.argv[2] || 'both';
const URL = 'http://localhost:5173/play/?webgl&autostart&at=dome&hour=15';

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

  // a save that has finished Act IV, and has picked a lot of locks (so the Dome pre-patches picks)
  await ev(`(() => {
    const s = game.state;
    for (const f of ['briefed', 'debriefed', 'act1.leverage', 'apex.complete', 'apex.vent.open', 'act2.debriefed', 'panopticon.complete',
      'panopticon.archive', 'panopticon.archive.take', 'act3.debriefed', 'spire.complete', 'spire.core', 'spire.core.valve', 'act4.debriefed']) s.set(f);
    s.data.stats.picks = 12;
    s.data.stats.kills = 3;
    s.data.skills.electronics = 1;
    s.addItem('keynote_reel', 1);
    s.addItem('lockpick', 3);
    game.combat.difficulty = 'story';
    window.V = game.player.position.constructor;
    window.O = game.dome.b.origin;
    window.P = game.dome.b.points;
    window.go = (x, z, y) => game.player.teleport(new V(x, y ?? game.hf.heightAt(x, z) + 0.15, z));
    // (the Dome's own first: entry ids like 'gate' and 'door' repeat across bunkers)
    window.find = (id) => game.dome.interactables.find((i) => i.id === id) ?? game.interactables.find((i) => i.id === id);
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
      for (let i = 0; i < 12 && id; i++) {
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
    // (spawning on the drive is already inside its reach: read the record again, now it's set up)
    s.unset('dome.profile');
    for (const id of ['pick', 'splice', 'circuit', 'charge', 'keypad', 'emp', 'shoot', 'sneak']) s.unset('dome.patch.' + id);
    game.dome.applyFlags(true);
  })()`);

  // the drive: seen, the profile, a patch shipped before arrival
  await ev(`go(O.x + 2, O.z - 60)`);
  await wait(1200);
  await check('seen the Dome (marker)', `game.state.has('seen:dome') && game.state.has('dome.marker')`);
  await check('profile read; picks pre-patched', `game.state.has('dome.profile') && game.state.has('dome.patch.pick')`);
  await check('the post screen shows the profile', `(async () => { window.__pick = ['ok']; await act('dome-post'); return /Locks picked: 12/.test(window.__last); })()`);
  await check('the culvert lock is patched', `typeof avail('culvert') === 'string' && avail('culvert').startsWith('Patched')`);

  // Hunter in the visitor hut
  await ev(`go(P.hut.x, P.hut.z)`);
  await wait(400);
  await ev(`window.__pick = ['take', 'ok']; act('dome-hunter')`);
  await wait(600);
  await check('Hunter: lanyard taken, flag set', `game.state.has('dome.hunter') && game.state.count('vale_badge') === 1`);
  await check('airlock hint is his birthday', `game.dome.sec.entries.find((e) => e.id === 'door').primary.hints[0].when.includes('dome.hunter')`);

  // the gate: his own name fails, the keynote reel opens it
  await ev(`go(P.gate.x, P.gate.z)`);
  await wait(400);
  await ev(`window.__pick = ['hunter']; act('gate')`);
  await wait(500);
  await check('voice check: "Hunter Vale." is refused', `!game.state.has('dome.gate.open')`);
  await ev(`window.__pick = ['reel']; act('gate')`);
  await wait(3200);
  await check('voice check: the keynote reel opens the gate', `game.state.has('dome.gate.open') && game.state.has('dome.gate.voice')`);

  // a Helper in the yard catches you: walked out to the gate, gently
  await ev(`(() => { const h = game.dome.helpers.get('h1'); const f = h.facing(); go(h.pos.x + f.x * 3, h.pos.z + f.z * 3); })()`);
  await wait(6500);
  await check('a Helper caught you (walked out)', `game.state.has('dome.caught') && game.player.position.distanceTo(P.outside) < 6`);
  await check('caught: the Dome logged a sneak', `(game.state.data.marks['dome.uses.sneak'] ?? 0) >= 1`);

  // the airlock by code: logs keypad, a fix goes to Gil
  await ev(`go(P.door.x, P.door.z)`);
  await wait(500);
  await ev(`act('door')`);
  await wait(600);
  await check('airlock open by code', `game.state.has('dome.door.open')`);
  await check('a fix is waiting on Gil', `!!game.dome.pending`);
  await ev(`game.dome.pending.left = 0.3`);
  await wait(900);
  await check('it shipped (a second patch, release 5.0.4)', `['keypad', 'sneak'].some((id) => game.state.has('dome.patch.' + id)) && game.dome.version === '5.0.4'`);

  // shoot a Helper down; EMP another
  await ev(`(() => { const h = game.dome.helpers.get('h3'); go(h.pos.x + 6, h.pos.z); h.damage({ amount: 200, dir: new V(1, 0, 0), point: h.center.clone(), zone: 'body', source: 'player' }); })()`);
  await wait(300);
  await check('shot Helper is down', `game.dome.helpers.get('h3').state === 'down' && (game.state.data.marks['dome.uses.shoot'] ?? 0) >= 1`);

  // Gil: freeze, then ask him to come
  await ev(`go(P.gil.x, P.gil.z, O.y + 0.2)`);
  await wait(600);
  await ev(`window.__talk = ['freeze', 'ok', 'come', 'ok']; act('dome-gil')`);
  await wait(600);
  await check('Gil: met, code freeze, ready', `game.state.has('dome.gil.met') && game.state.has('dome.gil.freeze') && game.state.has('dome.gil.ready')`);
  await ev(`game.dome.log('circuit'); game.dome.log('circuit')`);
  await wait(300);
  await check('freeze: nothing queues', `!game.dome.pending`);
  // rollback with Hunter's badge
  await ev(`window.__talk = ['rollback', 'badge', 'ok']; act('dome-gil')`);
  await wait(1200);
  await check('rollback: every patch gone', `!['pick','keypad','sneak','shoot'].some((id) => game.state.has('dome.patch.' + id)) && game.state.has('dome.gil.rollback')`);
  await check('rollback: picks work again', `avail('culvert') === true || game.state.has('dome.culvert.open')`);

  // the build farm by Gil's badge... he didn't give it here; by lockpick (no longer patched), then the plug
  await ev(`go(P.farmDoor.x, P.farmDoor.z, O.y + 0.2)`);
  await wait(400);
  await ev(`act('farm')`);
  await wait(600);
  await check('build farm open', `game.state.has('dome.farm.open')`);
  await ev(`go(P.plug.x, P.plug.z, O.y + 0.2); act('dome-plug')`);
  await wait(500);
  await check('pipeline unplugged', `game.state.has('dome.pipeline.off')`);

  // the hologram: Hunter's memo (the proof)
  if (ending === 'job') {
    await ev(`go(P.stage.x, P.stage.z, O.y + 0.7)`);
    await wait(500);
    await ev(`window.__talk = ['memo', 'play']; act('dome-holo')`);
    await wait(600);
    await check('the twin heard the memo', `game.state.has('dome.proof')`);
  }

  // up to the pod with Hunter's badge
  await ev(`go(P.podDoor.x, P.podDoor.z, O.y + 12.2)`);
  await wait(800);
  await ev(`act('pod')`);
  await wait(900);
  await check('pod open (badge)', `game.state.has('dome.pod.open')`);
  // the Cluster
  await ev(`go(P.cluster.x, P.cluster.z, O.y + 12.2)`);
  await wait(600);
  await ev(`window.__talk = ['decide']; window.__pick = ['${ending}']; act('dome-cluster')`);
  await wait(1500);
  if (ending === 'plug') {
    await check('plug: ended, Helpers off, board dark', `game.state.has('dome.end.plug') && game.dome.helpers.list.every((h) => h.state === 'off')`);
  } else {
    await check('job: ended, Helpers friendly', `game.state.has('dome.end.job') && !game.state.has('dome.end.plug')`);
  }
  // the loot
  await ev(`(() => { for (const id of ['tap', 'locker', 'cage']) { const sp = game.dome.b.lootSpots.find((l) => l.id === id); go(sp.pos.x, sp.pos.z, O.y + 12.2); act(id); } })()`);
  await wait(2600);
  await check('busted: dome.complete', `game.state.has('dome.complete')`);
  await wait(6500);
  await check('Gil has left', `game.state.has('dome.gil.free')`);
  // the debrief
  const debrief = await ev(`(async () => { const m = await import('/src/content/story.ts'); return m.campRadio({ has: (f) => game.state.has(f), archetype: game.state.archetype }); })()`);
  console.log(`      debrief flags: ${JSON.stringify(debrief.flags)}; ${debrief.pages.length} pages`);
  for (const pg of debrief.pages) console.log(`        ${pg.speaker}: ${pg.text}`);
  checks.push(['debrief', debrief.flags.includes('act5.debriefed')]);
  await ev(`game.state.set('act5.debriefed'); game.state.data.days = (game.state.data.days ?? 0) + 1`);
  await wait(300);
  if (ending === 'plug') await check('afterwards: the Dry Creek well runs', `game.interactables.find((i) => i.id === 'dome-well').visible()`);
  else await check('afterwards: the delivery is at the camp', `game.interactables.find((i) => i.id === 'dome-delivery').visible()`);
  await check('Gil in Dry Creek', `game.interactables.find((i) => i.id === 'dome-gil-creek').visible()`);
  console.log(errors.length ? `ERRORS (${errors.length}):\n  ${errors.slice(0, 8).join('\n  ')}` : 'no page errors');
  await b.close();
  return checks.every(([, ok]) => ok) && !errors.length;
}

const endings = which === 'both' ? ['plug', 'job'] : [which];
let ok = true;
for (const e of endings) ok = (await run(e)) && ok;
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
