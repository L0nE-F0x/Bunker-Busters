// The whole story in one run: a fresh game from the title (New Game, the character card, the briefing)
// through all eight bunkers to the end card, carrying the real state the whole way. Needs `npm run dev`.
//
//   node scripts/dev/campaign-test.mjs            (about 25-40 minutes headless; one browser)
//
// Unlike the per-bunker tests (each starts at ?at=<bunker> with the earlier acts' flags set by hand),
// every flag here comes from play: doors opened, cards and conversations answered (stubbed UI, as in
// the other tests), loot taken, and each act's debrief heard on the real camp radio (the camp panel's
// Radio, Mara's pages, the Act I choice card). Before each bunker's first door is through, and again
// after every debrief, the game is saved and reloaded with ?continue, and everything earlier is
// checked again: doors, loot, NPCs gone or moved, the owners' PAs quiet at a busted bunker, the
// after-effects, the quest log, the corner objective, the journal and the map's next marker.
//
// Endings (alternating where a bunker has two): Act I leverage (keep the ledger), the Panopticon's
// archive broadcast, the Spire valve (the Dry Creek standpipe), the Dome plug (the Dry Creek well),
// the Cathedral hand (the transfer to Lo: the Dropt parcel), the Fortress shut (the seep at the Cut),
// Bunker Zero open (the forecourt standpipe). The other endings are covered by the per-bunker tests.
//
// Harness conveniences (not story state), printed at the end: skill ranks a bunker's route needs are
// bought with the run's own skill points and topped up only if the run hasn't earned enough yet;
// thirst/hunger/health are kept up with the pack's own water, rations and medkits (topped up only if
// the pack runs dry); SeedBot is sent to its dock for the Garage (as Tanner's intercom recall does);
// the Panopticon's reviewers keep their eyes on their screens while the chain is cut (as there).
import { launch, waitForGame } from './browser.mjs';
const ORIGIN = process.env.DEV_ORIGIN || `http://localhost:${process.env.BB_PORT || 5173}`; // another dev server (a worktree): BB_PORT=5181

const b = await launch();
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/GL Driver|GPU stall|Failed to load resource/.test(t)) errors.push(t.slice(0, 240)); });
const ev = (js) => p.evaluate(js);
const wait = (ms) => p.waitForTimeout(ms);
const T0 = Date.now();
const checks = [];
let act = 'title';
const check = async (name, js) => {
  const ok = await ev(js).catch((e) => `error: ${e.message}`);
  checks.push([`${act}: ${name}`, ok === true]);
  console.log(`${ok === true ? 'PASS' : 'FAIL'}  [${act}] ${name}${ok === true ? '' : `  (${JSON.stringify(ok)})`}`);
  return ok === true;
};
const until = async (js, ms) => { for (let t = 0; t < ms; t += 250) { if (await ev(js).catch(() => false)) return true; await wait(250); } return false; };
const log = (...a) => console.log(`    [${((Date.now() - T0) / 60000).toFixed(1)} min]`, ...a);

// ------------------------------------------------------------------ the page's stubs and helpers
const STUBS = `(async () => {
  window.V = game.player.position.constructor;
  window.go = (x, z, y) => game.player.teleport(new V(x, y ?? game.hf.heightAt(x, z) + 0.15, z));
  window.bind = (id) => { window.B = game[id]; window.O = B.b.origin; window.P = B.b.points; };
  window.L = (x, z, y = 0.1) => game.player.teleport(new V(O.x + x, O.y + y, O.z + z));
  window.find = (id) => (window.B?.interactables ?? []).find((i) => i.id === id) ?? game.interactables.find((i) => i.id === id);
  window.act = (id) => { const it = find(id); if (!it) throw new Error('no interactable ' + id); return it.primary.run(); };
  window.act2 = (id) => { const it = find(id); if (!it) throw new Error('no interactable ' + id); return it.secondary.run(); };
  window.vis = (id) => { const it = find(id); return !!it && (it.visible ? it.visible() : true); };
  window.__pick ??= []; window.__talk ??= []; window.__camp ??= []; window.__topups ??= []; window.__keptUp ??= [];
  window.__subs = []; window.__banners ??= []; window.__pages ??= []; window.__intel ??= [];
  // headless never gives the pointer lock back after a minigame: the pause menu would hold the world
  game.openPause = () => {};
  // the Spire's ethics door: answer from the record (the real one this run made), like an honest player
  const spire = await import('/src/content/bunkers/spire.ts');
  const record = () => ({ has: (f) => game.state.has(f), kills: game.state.data.stats.kills ?? 0 });
  game.ui.choose = async (o) => {
    const i = window.__pick.findIndex((id) => o.choices.some((x) => x.id === id && !x.disabled));
    let c = i >= 0 ? o.choices.find((x) => x.id === window.__pick.splice(i, 1)[0]) : null;
    if (!c) {
      const q = spire.DOOR_QUESTIONS.find((d) => o.text?.includes(d.q.text));
      if (q) { const a = q.answers.find((x) => x.true(record())); c = a ? o.choices.find((x) => x.id === a.id) : null; window.__doorQs = (window.__doorQs ?? 0) + 1; }
    }
    c ??= o.choices.find((x) => !x.disabled);
    window.__last = o.text;
    return c ? c.id : null;
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
  game.ui.keypad = async (o) => { window.__code = o.code; return 'ok'; };
  game.ui.lockpick = async (o) => { window.__pins = o.pins; return 'success'; };
  game.ui.circuit = async () => true;
  game.ui.hack = async (o) => ({ aborted: false, traced: false, done: o.daemons.map((d) => d.id) });
  game.ui.pages = async (pages) => { for (const pg of pages) window.__pages.push(pg.speaker + ': ' + pg.text); };
  game.ui.endCard = async (o) => { window.__endCard = o; };
  game.ui.showIntel = (title, body, reveal, onClose) => { window.__intel.push(title); onClose?.(); };
  game.ui.camp = async () => window.__camp.shift() ?? 'closed';
  const sub = game.ui.subtitle.bind(game.ui);
  game.ui.subtitle = (sp, tx, v) => { window.__subs.push(sp + ': ' + tx); return sub(sp, tx, v); };
  if (!game.ui.__banHook) { game.ui.__banHook = true; const ban = game.ui.banner.bind(game.ui); game.ui.banner = (a, b2, k) => { window.__banners.push(a + ' | ' + b2); return ban(a, b2, k); }; }
  // a route's skill: the run's own points first
  window.need = (id, rank) => {
    const s = game.state;
    while (s.skill(id) < rank && s.data.skillPoints > 0) s.spendPoint(id);
    if (s.skill(id) < rank) { window.__topups.push(id + ' ' + s.skill(id) + '→' + rank + ' (level ' + s.data.level + ')'); s.data.skills[id] = rank; }
  };
  // water, food, health from the pack (topped up only if it's empty)
  window.keepUp = () => {
    const s = game.state, d = s.data;
    if (d.thirst < 55) { if (s.count('water')) game.useItem('water'); else { d.thirst = 80; window.__keptUp.push('thirst'); } }
    else if (d.hunger < 45) { if (s.count('ration')) game.useItem('ration'); else { d.hunger = 80; window.__keptUp.push('hunger'); } }
    else if (d.health < 55) { if (s.count('medkit')) game.useItem('medkit'); else { d.health = 80; window.__keptUp.push('health'); } }
    if (d.health < 25) { d.health = 60; window.__keptUp.push('health (low)'); }
  };
  // the pause menu that may have opened before these stubs went in
  if (document.querySelector('.panel.pause')) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
})()`;
const stubs = () => ev(STUBS);
const keepUp = async () => { await ev(`keepUp()`); await wait(400); };

/** Save, reload into the saved run with ?continue, put the stubs back. */
async function reload(why) {
  await ev(`game.save(true)`);
  await wait(300);
  const saved = await ev(`(() => { const s = JSON.parse(localStorage.getItem('bunker-busters.save.v1')); return { flags: s.flags.length, pos: s.position.map((v) => +v.toFixed(1)), kb: Math.round(localStorage.getItem('bunker-busters.save.v1').length / 1024) }; })()`);
  log(`reload (${why}): ${saved.flags} flags, ${saved.kb} KB, at ${saved.pos.join(', ')}`);
  await p.goto(`${ORIGIN}/play/?webgl&continue`);
  await waitForGame(p, 240000);
  await until(`game.mode === 'playing' && !!game.player`, 30000);
  await wait(3000);
  await stubs();
  await check(`after the reload (${why}): back where it was saved`, `(() => { const q = game.player.position; return Math.hypot(q.x - ${saved.pos[0]}, q.z - ${saved.pos[2]}) < 2 && Math.abs(q.y - ${saved.pos[1]}) < 1.5; })()`);
}

/** Back to the fire, raise Mara on the camp's radio (the real panel's Radio button). */
async function radio(expectFlag) {
  await ev(`(() => { const c = game.landmarks.campPosition; go(c.x + 2, c.z + 2); })()`);
  await wait(600);
  const before = await ev(`__pages.length`);
  await ev(`window.__camp = ['radio']; act('camp')`);
  const ok = await until(`game.state.has('${expectFlag}')`, 15000);
  await wait(1200);
  const pages = await ev(`__pages.slice(${before})`);
  log(`radio: ${pages.length} pages; first: ${pages[0]?.slice(0, 90)}`);
  await check(`the camp radio plays the debrief (${expectFlag})`, `${ok}`);
  return pages;
}

/** Wait at the fire (the camp's "until night/day") until the calendar turns: the afterwards arrive overnight. */
async function nextDay() {
  const d0 = await ev(`game.state.data.days ?? 0`);
  for (let i = 0; i < 3 && (await ev(`game.state.data.days ?? 0`)) === d0; i++) {
    await ev(`(() => { const c = game.landmarks.campPosition; go(c.x + 2, c.z + 2); act2('camp'); })()`);
    await wait(2800);
  }
  await check('a night at the fire: the next day', `(game.state.data.days ?? 0) > ${d0}`);
}

/** The corner objective, the journal's newest entry, the map's next marker. */
async function questState(nextAct, near) {
  const q = await ev(`(async () => {
    const story = await import('/src/content/story.ts');
    const v = { has: (f) => game.state.has(f), archetype: game.state.archetype };
    const j = story.journalEntries(v);
    const tgt = game.story.target();
    return { objective: game.story.objective('', '').text, journal: j.length, top: j[0]?.title, target: tgt, pending: story.pendingDebrief(v)?.flag ?? null };
  })()`);
  log(`objective: "${q.objective}" · journal ${q.journal} entries (newest: ${q.top}) · marker ${q.target ? `${q.target.label} at ${Math.round(q.target.x)}, ${Math.round(q.target.z)}` : 'none'}`);
  if (nextAct) await check(`${nextAct} started (quest log)`, `game.state.has('q:${nextAct}') && !game.state.has('q:${nextAct}:done')`);
  if (near) await check(`the map's next marker points at ${near.name}`, `(() => { const t = game.story.target(); return !!t && Math.hypot(t.x - ${near.x}, t.z - ${near.z}) < ${near.r ?? 60}; })()`);
  await check('no debrief left waiting', `${q.pending === null}`);
  return q;
}

// what has to stay true for the rest of the run, act by act (checked again after every reload)
const KEEP = [];
const keep = (name, js) => KEEP.push([name, js]);
async function earlier() { for (const [name, js] of KEEP) await check(`still: ${name}`, js); }
const doorsOpen = (bunker, ids) => `${JSON.stringify(ids)}.every((d) => game.${bunker}.b.doors[d] && game.${bunker}.b.doors[d].open > 0.95 && !game.${bunker}.b.doors[d].collider)`;

/** Walk up to a busted bunker again: no greeting, no taunts from its owner. */
async function revisit(bunker, owner) {
  await ev(`(() => { bind('${bunker}'); window.__subs = []; const pt = B.b.points[B.sec.voice.point] ?? O; const a = Math.atan2(game.player.position.x - pt.x, game.player.position.z - pt.z); go(pt.x + Math.sin(a) * 20, pt.z + Math.cos(a) * 20); })()`);
  await wait(2500);
  await check(`back at the busted ${bunker}: ${owner} doesn't greet you again`, `!__subs.some((s) => s.startsWith(${JSON.stringify(owner)}))`);
}

const BUNKER_AT = await (async () => {
  await p.goto(`${ORIGIN}/play/?webgl`);
  await waitForGame(p, 240000);
  await wait(2500);
  return ev(`(() => Object.fromEntries(game.bunkers.map((b) => [b.def.id, { x: b.b.origin.x, z: b.b.origin.z }])))()`);
})();

// ------------------------------------------------------------------ a new game, the way a player starts one
act = 'start';
await check('a fresh profile: the title has no Continue', `![...document.querySelectorAll('#title button')].some((x) => /Continue/.test(x.textContent))`);
await ev(`[...document.querySelectorAll('#title button')].find((x) => x.textContent.trim() === 'New Game').click()`);
await until(`game.mode === 'charselect'`, 10000);
await wait(1000);
await ev(`document.querySelector('#charselect .go').click()`);
await until(`game.mode === 'playing' && !!game.player`, 20000);
for (let i = 0; i < 12 && (await ev(`!!document.querySelector('.panel.brief .next')`)); i++) { await ev(`document.querySelector('.panel.brief .next').click()`); await wait(300); }
await wait(1500);
await stubs();
await check('the briefing is done: briefed, Act I started, the Infiltrator', `game.state.has('briefed') && game.state.has('q:act1') && game.state.archetype.id === 'infiltrator'`);
await questState(null, { name: 'the pump island', ...{ x: -150, z: 134 }, r: 30 });

// ------------------------------------------------------------------ Act I: the Garage
act = 'I';
await ev(`act('intel.gas.note')`);
await wait(500);
await check('read the note on the pumps', `game.state.has('intel:intel.gas.note')`);
await ev(`bind('garage'); L(0, 30)`);
await wait(1800);
await check('Tanner greets you at the fence', `__subs.some((s) => /PRIVATE apocalypse/.test(s)) && game.state.has('seen:garage')`);
await ev(`B.drone.recall(600); L(0, 21.5); act('gate')`);
await wait(2000);
await check('the gate picked open', `game.state.has('garage.gate.open') && !B.b.doors.gateL.collider`);
await ev(`L(9.4, -3); act('side')`);
await wait(1800);
await check('the side door picked open', `game.state.has('garage.side.open') && !B.b.doors.side.collider`);
await reload('Act I, mid-heist');
await ev(`bind('garage'); B.drone.recall(600)`);
await check('mid-heist: gate and side door still open, the vault shut', `${doorsOpen('garage', ['gateL', 'gateR', 'side'])} && !!game.garage.b.doors.vault.collider`);
await ev(`L(-6.5, -0.9); act('fuse')`);
await wait(600);
await check('the fuse box: lasers off', `game.state.has('garage.lasers.off')`);
await ev(`L(0, -5); act('vault')`);
await wait(1800);
await check('the vault picked open', `game.state.has('garage.vault.open')`);
for (const id of ['crate_a', 'crate_b', 'safe']) { await ev(`(() => { const sp = B.b.lootSpots.find((l) => l.id === '${id}'); game.player.teleport(sp.pos.clone().setY(O.y + 0.1)); act('${id}'); })()`); await wait(400); }
await wait(2500);
await check('busted: the water, the Seed Manifest, the banner', `game.state.has('garage.complete') && game.state.count('seed_manifest') === 1 && __banners.some((x) => /BUNKER BUSTED/.test(x))`);
await keepUp();
await ev(`window.__pick = ['leverage']`);
await radio('debriefed');
await check('Act I ended on the ledger kept (leverage), Act I closed', `game.state.has('act1.leverage') && game.state.has('q:act1:done')`);
keep('the Garage: busted, gate/side/vault open', `game.state.has('garage.complete') && ${doorsOpen('garage', ['gateL', 'gateR', 'side', 'vault'])}`);
keep('the Garage: its loot taken (interactables gone)', `['crate_a', 'crate_b', 'safe'].every((id) => !game.garage.interactables.find((i) => i.id === id).visible())`);
await reload('after the Act I debrief');
await earlier();
await questState('act2', { name: 'Dry Creek', x: -262, z: -48, r: 80 });

// ------------------------------------------------------------------ Act II: Apex Vault
act = 'II';
await ev(`bind('apex'); L(-10, 40)`);
await wait(1800);
await check('Vesper greets you; seen:apex', `__subs.some((s) => /Welcome to Apex/.test(s)) && game.state.has('seen:apex')`);
await ev(`L(-10, 16.4); act('hangar')`);
await wait(2500);
await check('the hangar picked open', `game.state.has('apex.hangar.open')`);
await reload('Act II, mid-heist');
await ev(`bind('apex')`);
await check('mid-heist: the hangar still open', `${doorsOpen('apex', ['hangarL', 'hangarR'])}`);
await ev(`need('electronics', 3); L(-10, -3.8); act2('airlock')`);
await wait(2500);
await check('SPLICE: the airlock, cameras and lasers', `game.state.has('apex.airlock.open') && game.state.has('apex.lasers.off')`);
await ev(`L(-10, -15)`); await wait(300); await ev(`L(-10, -21); act('vault')`);
await wait(2500);
await check('the Cistern Room picked open', `game.state.has('apex.vault.open')`);
for (const id of ['tank_a', 'tank_b', 'cistern']) { await ev(`(() => { const sp = B.b.lootSpots.find((l) => l.id === '${id}'); game.player.teleport(sp.pos.clone().setY(O.y + 0.1)); act('${id}'); })()`); await wait(400); }
await wait(2500);
await check('busted', `game.state.has('apex.complete')`);
await ev(`L(-3, 24)`);
await until(`game.state.has('apex.ambush')`, 9000);
await keepUp();
await radio('act2.debriefed');
keep('Apex: busted, hangar/airlock/vault open', `game.state.has('apex.complete') && ${doorsOpen('apex', ['hangarL', 'hangarR', 'airlockOut', 'airlockIn', 'vault'])}`);
await reload('after the Act II debrief');
await earlier();
await questState('act3', { name: 'the Panopticon', ...BUNKER_AT.panopticon });

// ------------------------------------------------------------------ Act III: the Panopticon
act = 'III';
await ev(`bind('panopticon'); L(0, 40)`);
await wait(1500);
await ev(`need('electronics', 4); L(0, 20.4); window.__pick = ['splice']; act2('gate')`);
await wait(2500);
await check('SPLICE: enrolled, the gate open, the poles dark', `game.state.has('panopticon.gate.open') && game.state.has('panopticon.enrolled')`);
await reload('Act III, mid-heist');
await ev(`bind('panopticon')`);
await check('mid-heist: the gate still open, the poles still dark', `!game.panopticon.b.doors.gateL.collider && ['pole1', 'pole2', 'pole3'].every((x) => game.state.has('panopticon.cam.' + x + '.off'))`);
await ev(`L(-4.2, -7.3); window.__talk = ['cams', 'back', 'door', 'back', 'come', 'ok']; act('pan-ada')`);
await wait(400);
await check('Ada: met, the chain, the code, ready to go', `['panopticon.ada.met', 'panopticon.chain', 'panopticon.code', 'panopticon.ada.ready'].every((f) => game.state.has(f))`);
await ev(`B.people.forEach((pr) => { if (pr.id !== 'ada') { pr.nextGlance = 99; pr.glance = 0; pr.seen = 0; } })`);
for (const c of ['cam1', 'cam2', 'cam3', 'cam4']) { await ev(`(() => { const q = P['box_${c}']; game.player.teleport(new V(q.x, O.y + 0.1, q.z)); act('pan-box-${c}'); })()`); await wait(500); }
await check('the chain cut in order: all four dark, no alarm', `['cam1', 'cam2', 'cam3', 'cam4'].every((c) => game.state.has('panopticon.cam.' + c + '.off')) && B.alarm <= 0`);
await ev(`L(-7, 0); act('tower')`);
await wait(2000);
await check('the tower keypad with Ada\'s code', `game.state.has('panopticon.tower.open')`);
await ev(`L(1.2, 0.4); window.__talk = ['ada', 'back', 'archive', 'decide']; window.__pick = ['broadcast']; act('pan-ezra')`);
await wait(900);
await check('the archive: broadcast', `game.state.has('panopticon.archive.broadcast')`);
await until(`game.state.has('panopticon.ada.free')`, 12000);
for (const id of ['cistern', 'locker', 'shelf']) { await ev(`(() => { const sp = B.b.lootSpots.find((l) => l.id === '${id}'); game.player.teleport(sp.pos.clone().setY(O.y + 0.1)); act('${id}'); })()`); await wait(400); }
await wait(2500);
await check('busted; the lamp out; Ada walked out', `game.state.has('panopticon.complete') && !B.b.lampBeam.mesh.visible && game.state.has('panopticon.ada.free')`);
await keepUp();
await radio('act3.debriefed');
keep('the Panopticon: busted, the lamp out, the tower open', `game.state.has('panopticon.complete') && !game.panopticon.b.lampBeam.mesh.visible && ${doorsOpen('panopticon', ['gateL', 'towerDoor'])}`);
await reload('after the Act III debrief');
await earlier();
await questState('act4', { name: 'the Spire', ...BUNKER_AT.spire });

// ------------------------------------------------------------------ Act IV: the Alignment Spire (valve)
act = 'IV';
await ev(`bind('spire'); go(O.x - 30, O.z - 70)`);
await wait(1200);
await check('seen the Spire', `game.state.has('seen:alignment')`);
await ev(`window.__pick = ['take']; act('spire-fenn')`);
await wait(400);
await check('Fenn\'s badge taken', `game.state.count('fenn_badge') === 1`);
await ev(`go(P.door.x, P.door.z)`);
await wait(600);
await ev(`window.__doorQs = 0; window.__pick = ['go', 'everyone']; act('door')`);
await wait(3800);
await check('the ethics door: answered from this run\'s record, it opens', `game.state.has('spire.door.open') && game.state.has('spire.door.honest') && window.__doorQs >= 2`);
await reload('Act IV, mid-heist');
await ev(`bind('spire')`);
await check('mid-heist: the door still open', `game.state.has('spire.door.open') && !game.spire.b.doors.door?.collider`);
await ev(`go(O.x + 1, O.z - 4.5, O.y + 0.2)`);
await wait(800);
await ev(`need('electronics', 3); act('spire-power')`);
await wait(500);
await ev(`go(P.noor.x, P.noor.z, O.y + 4.75)`);
await wait(600);
await ev(`window.__talk = ['turret', 'back', 'up', 'back', 'come', 'ok']; act('spire-noor')`);
await wait(9000);
await check('Noor: awake, her card, ready', `game.state.has('spire.noor.met') && game.state.has('spire.noor.card') && game.state.has('spire.noor.ready')`);
await ev(`go(P.officeDoor.x, P.officeDoor.z, O.y + 9.35)`); await wait(600);
await ev(`act('office')`); await wait(900);
await ev(`go(P.core.x, P.core.z, O.y + 9.35)`); await wait(600);
await ev(`window.__pick = ['valve']; act('spire-core')`);
await wait(1500);
await check('the valve: the water goes down Benny\'s pipe', `game.state.has('spire.core.valve')`);
await ev(`(() => { for (const id of ['tank', 'cabinet', 'bench']) { const sp = B.b.lootSpots.find((l) => l.id === id); go(sp.pos.x, sp.pos.z, O.y + 9.35); act(id); } })()`);
await wait(2600);
await check('busted', `game.state.has('spire.complete')`);
await until(`game.state.has('spire.noor.free')`, 12000);
await ev(`go(O.x - 160, O.z - 40)`); await wait(800);
await keepUp();
await radio('act4.debriefed');
keep('the Spire: busted, the door and office open', `game.state.has('spire.complete') && game.state.has('spire.office.open')`);
keep('the Spire\'s valve: the standpipe at Dry Creek', `game.interactables.find((i) => i.id === 'spire-tap-creek').visible()`);
await reload('after the Act IV debrief');
await earlier();
await questState('act5', { name: 'the Dome', ...BUNKER_AT.dome });
await revisit('garage', 'Tanner');
await revisit('apex', 'Vesper');

// ------------------------------------------------------------------ Act V: the Singularity Dome (plug)
act = 'V';
await ev(`bind('dome'); go(O.x + 2, O.z - 60)`);
await wait(1500);
await check('seen the Dome; the profile read', `game.state.has('seen:dome') && game.state.has('dome.profile')`);
log('Dome patches before arrival:', await ev(`['pick','splice','circuit','charge','keypad','emp','shoot','sneak'].filter((id) => game.state.has('dome.patch.' + id)).join(', ') || 'none'`), '· picks so far', await ev(`game.state.data.stats.picks`));
await ev(`go(P.hut.x, P.hut.z)`); await wait(400);
await ev(`window.__pick = ['take', 'ok']; act('dome-hunter')`); await wait(600);
await check('Hunter\'s lanyard', `game.state.has('dome.hunter') && game.state.count('vale_badge') === 1`);
await ev(`need('electronics', 3); go(P.gate.x, P.gate.z)`); await wait(400);
await ev(`window.__pick = ['splice']; act2('gate')`);
await wait(3200);
await check('the gate spliced open', `game.state.has('dome.gate.open')`);
await reload('Act V, mid-heist');
await ev(`bind('dome')`);
await check('mid-heist: the gate still open', `game.state.has('dome.gate.open')`);
await ev(`go(P.door.x, P.door.z)`); await wait(500);
await ev(`act('door')`); await wait(800);
await check('the airlock by code', `game.state.has('dome.door.open')`);
await ev(`go(P.gil.x, P.gil.z, O.y + 0.2)`); await wait(600);
await ev(`window.__talk = ['freeze', 'ok', 'come', 'ok']; act('dome-gil')`); await wait(700);
await ev(`window.__talk = ['rollback', 'badge', 'ok']; act('dome-gil')`); await wait(1200);
await check('Gil: met, freeze, rollback, ready', `game.state.has('dome.gil.met') && game.state.has('dome.gil.ready') && game.state.has('dome.gil.rollback')`);
await ev(`go(P.farmDoor.x, P.farmDoor.z, O.y + 0.2)`); await wait(400);
await ev(`act('farm')`); await wait(700);
await ev(`go(P.plug.x, P.plug.z, O.y + 0.2); act('dome-plug')`); await wait(600);
await check('the build farm unplugged', `game.state.has('dome.pipeline.off')`);
await ev(`go(P.podDoor.x, P.podDoor.z, O.y + 12.2)`); await wait(800);
await ev(`act('pod')`); await wait(1000);
await ev(`go(P.cluster.x, P.cluster.z, O.y + 12.2)`); await wait(600);
await ev(`window.__talk = ['decide']; window.__pick = ['plug']; act('dome-cluster')`); await wait(1500);
await check('plug: the twin off, the Helpers down', `game.state.has('dome.end.plug') && game.dome.helpers.list.every((h) => h.state === 'off')`);
await ev(`(() => { for (const id of ['tap', 'locker', 'cage']) { const sp = B.b.lootSpots.find((l) => l.id === id); go(sp.pos.x, sp.pos.z, O.y + 12.2); act(id); } })()`);
await wait(2600);
await check('busted', `game.state.has('dome.complete')`);
await until(`game.state.has('dome.gil.free')`, 12000);
await keepUp();
await radio('act5.debriefed');
await nextDay(); // (the afterwards arrive overnight)
await wait(500);
keep('the Dome: busted, the twin unplugged', `game.state.has('dome.complete') && game.state.has('dome.end.plug')`);
keep('the Dome\'s plug: the Dry Creek well runs', `game.interactables.find((i) => i.id === 'dome-well').visible()`);
keep('Gil in Dry Creek', `game.interactables.find((i) => i.id === 'dome-gil-creek').visible()`);
await reload('after the Act V debrief');
await earlier();
await questState('act6', { name: 'the Cathedral', ...BUNKER_AT.cathedral });

// ------------------------------------------------------------------ Act VI: the Cloud Cathedral (hand)
act = 'VI';
await ev(`bind('cathedral'); go(P.road.x, P.road.z)`); await wait(1500);
await check('seen the Cathedral', `game.state.has('seen:cathedral')`);
await ev(`go(P.dock.x, P.dock.z)`); await wait(400);
await ev(`act('dock')`); await wait(900);
await until(`!game.player.frozen`, 8000);
if (!(await ev(`game.state.has('cathedral.dock.open')`))) { await ev(`go(P.dock.x, P.dock.z)`); await wait(400); await ev(`act('dock')`); await wait(900); }
await check('the dock wicket picked', `game.state.has('cathedral.dock.open')`);
await reload('Act VI, mid-heist');
await ev(`bind('cathedral')`);
await check('mid-heist: the dock still open', `game.state.has('cathedral.dock.open')`);
await ev(`go(P.dockIn.x, P.dockIn.z, O.y + 0.2)`); await wait(600);
await ev(`go(P.lo.x, P.lo.z, O.y + 0.1)`); await wait(400);
await ev(`window.__talk = ['drives', 'ok', 'office', 'ok', 'after', 'yes', 'bye']; act('cath-lo')`); await wait(900);
await check('Lo: met, Mateo\'s badge, the code, she\'ll run it', `game.state.has('cathedral.lo.met') && game.state.count('mateo_badge') === 1 && game.state.has('cathedral.lo.code') && game.state.has('cathedral.lo.ready')`);
await ev(`go(P.officeDoor.x, P.officeDoor.z, O.y + 5.6)`); await wait(500);
await ev(`act('office')`); await wait(700);
await check('the Day 1 office by code', `game.state.has('cathedral.office.open')`);
await ev(`go(P.orrin.x, P.orrin.z, O.y + 5.6)`); await wait(500);
await ev(`window.__talk = ['decide']; window.__pick = ['hand']; act('cath-orrin')`); await wait(1500);
await check('hand: the Cathedral transferred to Lo', `game.state.has('cathedral.end.hand')`);
await ev(`(() => { for (const id of ['pallet', 'desk', 'shelf']) { const sp = B.b.lootSpots.find((l) => l.id === id); go(sp.pos.x, sp.pos.z, O.y + 5.6); act(id); } })()`);
await wait(2600);
await check('busted', `game.state.has('cathedral.complete')`);
await keepUp();
await radio('act6.debriefed');
await nextDay(); // (the afterwards arrive overnight)
await wait(500);
keep('the Cathedral: busted, handed to Lo', `game.state.has('cathedral.complete') && game.state.has('cathedral.end.hand')`);
keep('the Cathedral\'s hand: the Dropt parcel at the camp', `game.interactables.find((i) => i.id === 'cath-drop').visible()`);
await reload('after the Act VI debrief');
await earlier();
await questState('act7', { name: 'the Fortress', ...BUNKER_AT.fortress });

// ------------------------------------------------------------------ Act VII: the Chip Fortress (shut)
act = 'VII';
await ev(`bind('fortress'); go(P.road.x, P.road.z)`); await wait(1500);
await check('seen the Fortress', `game.state.has('seen:fortress')`);
await ev(`go(P.queue.x, P.queue.z); window.__pick = ['ok']; act('fort-queue')`); await wait(500);
await ev(`go(P.gatehouse.x, P.gatehouse.z); act('bridge')`); await wait(3800);
await check('the drawbridge down, the gate open', `game.state.has('fortress.bridge.open')`);
await reload('Act VII, mid-heist');
await ev(`bind('fortress')`);
await check('mid-heist: the bridge still down (the deck walkable)', `game.state.has('fortress.bridge.open') && !!game.fortress.deck`);
await ev(`go(P.keepDoor.x, P.keepDoor.z, O.y + 0.1); act('keep')`); await wait(900);
if (!(await ev(`game.state.has('fortress.keep.open')`))) { await until(`!game.player.frozen`, 8000); await ev(`go(P.keepDoor.x, P.keepDoor.z, O.y + 0.1); act('keep')`); await wait(900); }
await check('the keep picked', `game.state.has('fortress.keep.open')`);
await ev(`L(-4.3, -1.0); window.__pick = ['chillers', 'lights', 'vault', 'no']; act('fort-board')`); await wait(1300);
await ev(`go(P.vaultDoor.x, P.vaultDoor.z, O.y + 0.1); act('vault')`); await wait(1000);
await check('the vault powered and open', `game.state.has('fortress.vault.open')`);
await ev(`go(P.kit.x, P.kit.z, O.y + 0.1); window.__talk = ['decide']; window.__pick = ['shut']; act('fort-kit')`); await wait(1500);
await check('shut: the master key turned', `game.state.has('fortress.end.shut')`);
await ev(`(() => { for (const id of ['tank', 'dispenser', 'kitdesk']) { const sp = B.b.lootSpots.find((l) => l.id === id); go(sp.pos.x, sp.pos.z, O.y + 0.1); act(id); } })()`);
await wait(2600);
await check('busted', `game.state.has('fortress.complete')`);
await keepUp();
await radio('act7.debriefed');
// Act VIII: Mara's next call (Dez placed the carrier) starts it
await radio('zero.known');
await nextDay(); // (the afterwards arrive overnight)
await wait(500);
keep('the Fortress: busted, shut down', `game.state.has('fortress.complete') && game.state.has('fortress.end.shut')`);
keep('the Fortress\'s shutdown: the seep at the Cut runs', `game.interactables.find((i) => i.id === 'fort-seep').visible()`);
await reload('after the Act VII debrief and Mara\'s call');
await earlier();
await questState('act8', { name: 'Last Chance (the manway)', ...BUNKER_AT.zero, r: 40 });

// ------------------------------------------------------------------ Act VIII: Bunker Zero (open)
act = 'VIII';
await ev(`bind('zero'); window.FY = O.y - 26; window.LZ = (x, z) => game.player.teleport(new V(O.x + x, FY + 0.1, O.z + z))`);
await ev(`go(P.hatch.x, P.hatch.z + 0.3)`); await wait(400);
await ev(`window.__pick = ['lockpick']; find('hatch').secondary.run()`); await wait(1800);
await check('the manway picked open', `game.state.has('zero.hatch.open')`);
await ev(`act('zero-down')`); await wait(3400);
await check('down the ladder: inside, Agnes heard', `game.zero.playerInside && game.state.has('zero.down')`);
await reload('Act VIII, mid-heist (underground)');
await ev(`bind('zero'); window.FY = O.y - 26; window.LZ = (x, z) => game.player.teleport(new V(O.x + x, FY + 0.1, O.z + z))`);
await check('mid-heist: still down the well (inside, the sky dimmed)', `game.zero.playerInside && game.zero.underground`);
await ev(`act('door61')`); await wait(1500);
await ev(`need('electronics', 4); LZ(-5.1, -26.5); act('gridbox')`); await wait(600);
await ev(`LZ(1.9, -23.6); window.__pick = ['splice']; find('clock').secondary.run()`); await wait(1000);
await check('the grid down, the clock gate spliced', `game.state.has('zero.lasers.off') && game.state.has('zero.clock.open')`);
await ev(`LZ(9.3, -41.5); window.__pick = ['doormen', 'lights', 'vault', 'no']; act('zero-board')`); await wait(1500);
await ev(`LZ(0, -43.6); act('zero')`); await wait(2600);
await check('Model Zero powered and open', `game.state.has('zero.zero.open')`);
await ev(`LZ(4.7, -61.7)`); await wait(600);
await ev(`window.__talk = ['well', 'ok', 'decide']; window.__pick = ['open']; act('zero-agnes')`); await wait(1600);
await check('open: the key broken, the well sent up', `game.state.has('zero.end.open')`);
await ev(`(() => { for (const id of ['cistern', 'stores', 'plans']) { const sp = B.b.lootSpots.find((l) => l.id === id); game.player.teleport(sp.pos.clone().setY(FY + 0.1)); act(id); } })()`);
await wait(2600);
await check('busted', `game.state.has('zero.complete')`);
await ev(`LZ(0, 1.2); act('zero-up')`); await wait(3400);
await check('up the ladder', `!game.zero.playerInside`);
await keepUp();
await radio('act8.debriefed');
await check('the end card, then BUNKER MASTER', `!!window.__endCard && window.__endCard.doors.length === 8 && __banners.some((x) => /BUNKER MASTER/.test(x))`);
await nextDay(); // (the afterwards arrive overnight)
await wait(500);
keep('Bunker Zero: busted, opened to the camp', `game.state.has('zero.complete') && game.state.has('zero.end.open')`);
keep('Zero\'s well: the standpipe on the forecourt', `game.interactables.find((i) => i.id === 'zero-tap').visible()`);
await reload('the end of the story');
act = 'end';
await earlier();
await check('every act done in the quest log', `['act1', 'act2', 'act3', 'act4', 'act5', 'act6', 'act7', 'act8'].every((a) => game.state.has('q:' + a + ':done'))`);
await check('the story objective is the end', `(async () => { const m = await import('/src/content/story.ts'); return /Every door/.test(m.storyObjective({ has: (f) => game.state.has(f), archetype: game.state.archetype })); })()`);
await check('the radio after the end: Mara\'s idle line, no debrief', `(async () => { const m = await import('/src/content/story.ts'); const r = m.campRadio({ has: (f) => game.state.has(f), archetype: game.state.archetype }); return !r.flags.length && /standpipe|list/.test(r.pages[0].text); })()`);
for (const [bk, owner] of [['garage', 'Tanner'], ['apex', 'Vesper'], ['panopticon', 'Ezra'], ['spire', 'Prudence'], ['dome', 'HUNTER'], ['cathedral', 'Orrin'], ['fortress', 'Kit']]) await revisit(bk, owner);
const stats = await ev(`(() => { const d = game.state.data; return { level: d.level, kills: d.stats.kills, picks: d.stats.picks, caught: d.stats.caught, days: d.days, flags: d.flags.length, saveKB: Math.round(localStorage.getItem('bunker-busters.save.v1').length / 1024), topups: window.__topups, keptUp: window.__keptUp }; })()`);
console.log('    run:', JSON.stringify(stats));
const errs = [...new Set(errors)];
console.log(errs.length ? `ERRORS (${errs.length}):\n  ${errs.slice(0, 12).join('\n  ')}` : 'no page errors');
await b.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(`${checks.length - failed.length}/${checks.length} checks passed in ${((Date.now() - T0) / 60000).toFixed(1)} min`);
const ok = !failed.length && !errs.length;
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
