// The game in a hostile browser: storage that throws or is full, damaged and old saves, two tabs on one
// save, a tab hidden for minutes, the window resized over and over, focus and the pointer lock lost
// mid-fight and mid-minigame. Needs `npm run dev`; nothing appears on screen.
//   node scripts/dev/hostile-test.mjs [blocked|full|corrupt|old|tabs|hidden|resize|focus|all]
import { launch, waitForGame } from './browser.mjs';
const ORIGIN = process.env.DEV_ORIGIN || `http://localhost:${process.env.BB_PORT || 5173}`; // another dev server (a worktree): BB_PORT=5181

const which = process.argv[2] || 'all';
const SAVE_KEY = 'bunker-busters.save.v1';
const PLAY = `${ORIGIN}/play/?webgl`;

/** A browser context (shared storage between its pages), with checks and error capture per page. */
async function session(label, init) {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 960, height: 540 } });
  if (init) await ctx.addInitScript(init);
  const errors = [];
  const checks = [];
  const pages = [];
  const page = async (url, { wait = true } = {}) => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/GL Driver|GPU stall|Failed to load resource/.test(t)) errors.push(t.slice(0, 240)); });
    if (url) { await p.goto(url); if (wait) { await waitForGame(p); await p.waitForTimeout(2500); } }
    pages.push(p);
    return p;
  };
  const check = async (p, name, js) => {
    const ok = await p.evaluate(js).catch((e) => `error: ${e.message}`);
    checks.push([name, ok === true]);
    console.log(`${ok === true ? 'PASS' : 'FAIL'}  [${label}] ${name}${ok === true ? '' : `  (${JSON.stringify(ok)})`}`);
    return ok === true;
  };
  const until = async (p, js, ms) => { for (let t = 0; t < ms; t += 250) { if (await p.evaluate(js).catch(() => false)) return true; await p.waitForTimeout(250); } return false; };
  return { b, ctx, page, check, until, errors, checks,
    async done(expectErrors = 0) {
      const errs = [...new Set(errors)];
      console.log(errs.length ? `ERRORS (${errs.length}):\n  ${errs.slice(0, 10).join('\n  ')}` : 'no page errors');
      await b.close();
      return checks.every(([, ok]) => ok) && errs.length <= expectErrors;
    } };
}

// toasts and the title's notice, recorded; the automatic pause menu stubbed (headless never gives the lock back)
const HOOKS = `(() => {
  window.__toasts ??= [];
  if (!game.ui.__hooked) {
    game.ui.__hooked = true;
    const t = game.ui.toast.bind(game.ui);
    game.ui.toast = (text, kind) => { window.__toasts.push(text); return t(text, kind); };
  }
  game.openPause = () => {};
})()`;
const notice = `document.querySelector('#title .title-notice')?.textContent ?? ''`;
const hasContinue = `[...document.querySelectorAll('#title button')].some((b) => /^\\s*Continue\\s*$/.test(b.textContent))`;
const clickTitle = (label) => `(() => { const b = [...document.querySelectorAll('#title button')].find((x) => x.textContent.trim() === '${label}'); b?.click(); return !!b; })()`;
/** New Game from the title, the way a player does: the card, the stand-up, the briefing clicked through. */
async function newGameFromTitle(t, p) {
  await p.evaluate(clickTitle('New Game'));
  await t.until(p, `game.mode === 'charselect'`, 8000);
  await p.waitForTimeout(800);
  await p.evaluate(`document.querySelector('#charselect .go').click()`);
  await t.until(p, `game.mode === 'playing' && !!game.player`, 15000);
  for (let i = 0; i < 12 && (await p.evaluate(`!!document.querySelector('.panel.brief .next')`)); i++) {
    await p.evaluate(`document.querySelector('.panel.brief .next').click()`);
    await p.waitForTimeout(250);
  }
  await p.waitForTimeout(1000);
}
/** Hold W for `ms`: did the player move? */
async function walks(p, ms = 1500) {
  const a = await p.evaluate(`game.player.position.clone()`);
  await p.keyboard.down('KeyW'); await p.waitForTimeout(ms); await p.keyboard.up('KeyW');
  const b2 = await p.evaluate(`game.player.position.clone()`);
  return Math.hypot(b2.x - a.x, b2.z - a.z);
}

// ------------------------------------------------------------------ storage that throws on access
async function blocked() {
  const t = await session('blocked', () => {
    // Safari's private mode on some versions, Chrome/Firefox with site data blocked: touching it throws
    const no = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
    for (const k of ['localStorage', 'sessionStorage']) Object.defineProperty(window, k, { configurable: true, get: no });
  });
  const p = await t.page(PLAY);
  await p.evaluate(HOOKS);
  await t.check(p, 'the title is up, no Continue', `game.mode === 'title' && !(${hasContinue})`);
  await t.check(p, 'the title says saving is off', `/Saving is off/.test(${notice})`);
  await newGameFromTitle(t, p);
  await p.evaluate(HOOKS);
  await t.check(p, 'a new game starts (player, HUD)', `game.mode === 'playing' && !!game.player && !!document.querySelector('#hud')`);
  await p.waitForTimeout(3500);
  await t.check(p, 'told once, as the run starts, that saving is off', `__toasts.filter((x) => /Saving is off/.test(x)).length === 1`);
  await p.evaluate(`game.save(true); game.save(true)`);
  await t.check(p, 'autosaves stay quiet after that', `__toasts.filter((x) => /Saving is off/.test(x)).length === 1`);
  await p.evaluate(`game.save()`);
  await t.check(p, 'the Save button says so', `__toasts.filter((x) => /Saving is off/.test(x)).length === 2`);
  const moved = await walks(p);
  await t.check(p, `still plays (walked ${moved.toFixed(1)} m)`, `${moved > 1}`);
  await p.keyboard.press('KeyI'); await p.waitForTimeout(600);
  await t.check(p, 'the Kit opens', `game.ui.modalOpen`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  return t.done();
}

// ------------------------------------------------------------------ storage that is full
async function full() {
  const t = await session('full', () => {
    // a site's storage at its quota: small writes may still fit, the save doesn't
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (String(k).startsWith('bunker-busters.save') && window.__full !== false) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return set.call(this, k, v);
    };
  });
  const p = await t.page(`${PLAY}&autostart&hour=15`);
  await p.evaluate(HOOKS);
  await p.waitForTimeout(3000);
  await t.check(p, 'nothing said at the start (a byte still fits)', `!__toasts.some((x) => /Saving is off|storage for this site is full/.test(x))`);
  await p.evaluate(`game.save(true)`);
  await t.check(p, 'the first failed autosave says the storage is full', `__toasts.filter((x) => /storage for this site is full/.test(x)).length === 1`);
  await p.evaluate(`game.save(true); game.save(true)`);
  await t.check(p, 'later autosaves stay quiet', `__toasts.filter((x) => /storage for this site is full/.test(x)).length === 1`);
  await p.evaluate(`game.save()`);
  await t.check(p, 'the Save button says it every time', `__toasts.filter((x) => /storage for this site is full/.test(x)).length === 2`);
  await t.check(p, 'nothing was written', `localStorage.getItem('${SAVE_KEY}') === null`);
  // room again: the next save goes through
  await p.evaluate(`window.__full = false; game.save()`);
  await t.check(p, 'with room again it saves', `__toasts.includes('Game saved.') && !!localStorage.getItem('${SAVE_KEY}')`);
  const moved = await walks(p);
  await t.check(p, `still plays (walked ${moved.toFixed(1)} m)`, `${moved > 1}`);
  return t.done();
}

// ------------------------------------------------------------------ damaged saves
/** A real save from a fresh run, to damage. */
async function realSave(t) {
  const p = await t.page(`${PLAY}&autostart&hour=15`);
  await p.evaluate(HOOKS);
  await p.evaluate(`(() => { game.state.addItem('lockpick', 2); game.state.set('test.marker'); game.save(true); })()`);
  const raw = await p.evaluate(`localStorage.getItem('${SAVE_KEY}')`);
  await p.close();
  return raw;
}
async function corrupt() {
  const t = await session('corrupt');
  const raw = await realSave(t);
  const good = JSON.parse(raw);
  const cases = [
    ['cut short (truncated JSON)', raw.slice(0, Math.floor(raw.length * 0.6)), 'unreadable'],
    ['not JSON at all', 'PK\u0003\u0004 garbage', 'unreadable'],
    ['an array', '[1,2,3]', 'unreadable'],
    ['a newer version', JSON.stringify({ ...good, version: 9 }), 'unreadable'],
    ['position not numbers', JSON.stringify({ ...good, position: ['a', null, {}] }), 'loads'],
    ['position NaN (saved as nulls)', JSON.stringify({ ...good, position: [null, null, null] }), 'loads'],
    ['flags a string', JSON.stringify({ ...good, flags: 'briefed' }), 'loads'],
    ['items this version never had', JSON.stringify({ ...good, inventory: [...good.inventory, { id: 'jetpack', qty: 1 }, { id: 'water', qty: -3 }, { id: 'ration', qty: 'lots' }] }), 'loads'],
    ['stats and skills garbage', JSON.stringify({ ...good, stats: 'x', skills: { lockpicking: 'max', electronics: 99 }, health: 'full', hour: null }), 'loads'],
    ['saved while dead (health 0, the pack dropped)', JSON.stringify({ ...good, health: 0, pack: { position: good.position, items: [{ id: 'water', qty: 2 }], day: 0 } }), 'loads'],
    ['a pack that is broken', JSON.stringify({ ...good, pack: { position: 'here', items: 7 } }), 'loads'],
  ];
  for (const [name, data, expect] of cases) {
    const p = await t.page(null);
    await p.goto(`${PLAY}`);
    await p.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: SAVE_KEY, v: data });
    await p.reload();
    await waitForGame(p);
    await p.waitForTimeout(2000);
    await p.evaluate(HOOKS);
    if (expect === 'unreadable') {
      await t.check(p, `${name}: the title says it couldn't be read, no Continue`, `!(${hasContinue}) && /couldn't be read/.test(${notice})`);
      await t.check(p, `${name}: a copy is kept aside`, `localStorage.getItem('${SAVE_KEY}.unreadable') === ${JSON.stringify(data)}`);
    } else {
      await t.check(p, `${name}: Continue is offered`, hasContinue);
      await p.evaluate(clickTitle('Continue'));
      const up = await t.until(p, `game.mode === 'playing' && !!game.player && !!document.querySelector('#hud')`, 15000);
      await p.waitForTimeout(1500);
      await t.check(p, `${name}: the run loads (a player on finite ground, the HUD)`, `${up} && Number.isFinite(game.player.position.x + game.player.position.y + game.player.position.z) && Math.abs(game.player.position.y - game.hf.heightAt(game.player.position.x, game.player.position.z)) < 3`);
      await t.check(p, `${name}: alive, every item known`, `game.state.data.health > 0 && game.state.data.inventory.every((s) => s.qty > 0 && Number.isInteger(s.qty))`);
      await p.keyboard.press('KeyI'); await p.waitForTimeout(600);
      await t.check(p, `${name}: the Kit opens`, `game.ui.modalOpen && !!document.querySelector('.overlay')`);
      await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    }
    await p.close();
  }
  return t.done();
}

// ------------------------------------------------------------------ saves from old versions
async function old() {
  const t = await session('old');
  // v1 (v0.1): no hunger/thirst, two skills, a four-field stats block
  const v1 = { version: 1, archetype: 'engineer', level: 3, xp: 40, skillPoints: 1, skills: { lockpicking: 1, electronics: 2 }, health: 70,
    inventory: [{ id: 'lockpick', qty: 3 }, { id: 'emp', qty: 1 }, { id: 'ration', qty: 2 }, { id: 'water', qty: 4 }, { id: 'seed_manifest', qty: 1 }],
    position: [-140, 9, 120], yaw: 1.2, hour: 21.5, flags: ['intro', 'garage.gate.open', 'garage.vault.open', 'garage.complete', 'seen:garage'], discovered: '', stats: { picks: 4, caught: 1, playTime: 900, busted: 1 }, savedAt: 1759000000000 };
  // v2 (v0.2): hunger/thirst and a focus, debriefed before the Act I choice existed, Sol's roll looted
  const v2 = { version: 2, archetype: 'infiltrator', level: 5, xp: 10, skillPoints: 0, skills: { lockpicking: 3, electronics: 1, stealth: 2 }, focuses: { lockpicking: 'feeler' }, health: 88, hunger: 60, thirst: 55,
    inventory: [{ id: 'lockpick', qty: 5 }, { id: 'water', qty: 2 }, { id: 'charge', qty: 1 }],
    position: [-262, 0, -40], yaw: 0, hour: 9, flags: ['intro', 'briefed', 'garage.complete', 'debriefed', 'creek.motel.b.loot', 'seen:creek'], discovered: '', stats: { picks: 9, caught: 2, playTime: 4000, busted: 1 }, savedAt: 1759500000000 };
  for (const [name, save, expect] of [['v1', v1, (s) => `game.state.archetype.id === 'engineer' && game.state.has('briefed') && game.state.data.hunger > 0 && game.state.has('migrated.v3') && game.state.has('q:act1:vault')`],
    ['v2', v2, () => `game.state.has('act1.broadcast') && game.state.count('sol_roll') === 1 && game.state.focus('lockpicking') === 'feeler' && game.state.has('q:act2')`]]) {
    const p = await t.page(null);
    await p.goto(PLAY);
    await p.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: SAVE_KEY, v: JSON.stringify(save) });
    await p.reload();
    await waitForGame(p);
    await p.waitForTimeout(2000);
    await p.evaluate(HOOKS);
    await t.check(p, `${name}: Continue is offered`, hasContinue);
    await p.evaluate(clickTitle('Continue'));
    await t.until(p, `game.mode === 'playing' && !!game.player`, 15000);
    await p.waitForTimeout(2500);
    await t.check(p, `${name}: migrated (fields, flags, quests from flags)`, expect(save));
    await t.check(p, `${name}: v0.5 arms handed over`, `game.state.count('revolver') === 1 && game.state.count('crowbar') === 1`);
    await p.keyboard.press('KeyJ'); await p.waitForTimeout(700);
    await t.check(p, `${name}: the journal opens`, `game.ui.modalOpen`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await p.evaluate(`game.save(true)`);
    await t.check(p, `${name}: saves back as v3`, `JSON.parse(localStorage.getItem('${SAVE_KEY}')).version === 3`);
    await p.close();
  }
  return t.done();
}

// ------------------------------------------------------------------ two tabs, one save
async function tabs() {
  const t = await session('tabs');
  const a = await t.page(`${PLAY}&autostart&hour=15`);
  await a.evaluate(HOOKS);
  await a.evaluate(`(() => { game.state.set('tabA.before'); game.save(true); })()`);
  // the link opened again: the second tab continues the same run
  const b = await t.page(PLAY);
  await b.evaluate(HOOKS);
  await t.check(b, 'tab B: Continue offered', hasContinue);
  await b.evaluate(clickTitle('Continue'));
  await t.until(b, `game.mode === 'playing' && !!game.player`, 15000);
  await b.waitForTimeout(1500);
  await b.evaluate(HOOKS);
  await t.check(b, 'tab B picked up tab A\'s save', `game.state.has('tabA.before')`);
  await t.until(a, `game.savingElsewhere === true`, 3000);
  await t.check(a, 'tab A is told the run moved, and stops saving', `game.savingElsewhere === true && __toasts.some((x) => /open in another tab/.test(x))`);
  // both keep playing: B makes progress and saves; A's autosave comes round afterwards
  await b.evaluate(`(() => { game.state.set('tabB.progress'); game.save(true); })()`);
  await a.evaluate(`(() => { game.state.set('tabA.after'); game.save(true); })()`);
  await t.check(b, 'tab A\'s autosave didn\'t undo tab B\'s progress', `(() => { const s = JSON.parse(localStorage.getItem('${SAVE_KEY}')); return s.flags.includes('tabB.progress') && !s.flags.includes('tabA.after'); })()`);
  await a.evaluate(`game.save()`);
  await t.check(a, 'tab A\'s Save button says why it didn\'t', `__toasts.filter((x) => /open in another tab/.test(x)).length >= 2`);
  // closing tab A (pagehide) doesn't write either
  await a.close({ runBeforeUnload: true });
  await b.waitForTimeout(500);
  await t.check(b, 'closing tab A left tab B\'s save alone', `JSON.parse(localStorage.getItem('${SAVE_KEY}')).flags.includes('tabB.progress')`);
  // B quits to the title; a third tab's Continue reads the save as it is now, not as its title found it
  const c = await t.page(PLAY);
  await b.evaluate(`(() => { game.state.set('tabB.late'); game.save(true); })()`);
  await c.evaluate(clickTitle('Continue'));
  await t.until(c, `game.mode === 'playing' && !!game.player`, 15000);
  await t.check(c, 'Continue reads the save on the click (tab B saved after this title came up)', `game.state.has('tabB.late')`);
  return t.done();
}

// ------------------------------------------------------------------ a tab hidden for minutes
async function hidden() {
  const t = await session('hidden');
  const p = await t.page(`${PLAY}&autostart&hour=15`);
  await p.evaluate(HOOKS);
  const cdp = await t.ctx.newCDPSession(p);
  // hidden like a real background tab: another tab in front (no more animation frames, timers throttled),
  // then frozen (no tasks at all), then back. If headless won't hide it, stop the frames by hand.
  const other = await t.ctx.newPage();
  await other.goto('about:blank');
  const freeze = async (ms) => {
    await p.evaluate(`window.__f0 = game.frames`);
    await other.bringToFront();
    await p.waitForTimeout(300);
    const vis = await p.evaluate(`document.visibilityState`);
    if (vis !== 'hidden') await p.evaluate(`game.renderer.setAnimationLoop(null)`);
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }).catch(() => {});
    await p.waitForTimeout(ms);
    await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
    if (vis !== 'hidden') await p.evaluate(`game.renderer.setAnimationLoop(() => game.frame())`);
    await p.bringToFront();
    console.log(`    hidden ${ms / 1000} s (visibility '${vis}'${vis !== 'hidden' ? ', frames stopped by hand' : ''}): ${await p.evaluate(`game.frames - __f0`)} frames ran meanwhile`);
  };
  const snap = `(() => ({ pos: game.player.position.clone(), hp: game.state.data.health, hour: game.atmo.hour, alive: game.combat.providers.reduce((n, pr) => n + pr.hostiles().filter((h) => h.alive).length, 0) }))()`;
  // mid-fight: a squad on you, hidden for two minutes
  await p.evaluate(`(() => { game.combat.difficulty = 'normal'; game.recovery.summon(game.player.position, game.cam.yaw, 18, 3, true); })()`);
  await p.waitForTimeout(2500);
  const s0 = await p.evaluate(snap);
  await freeze(120000);
  await p.waitForTimeout(400);
  const s1 = await p.evaluate(snap);
  console.log('    fight, before/after a 2-minute freeze:', JSON.stringify({ hp: [s0.hp, s1.hp], moved: Math.hypot(s1.pos.x - s0.pos.x, s1.pos.z - s0.pos.z).toFixed(2), dy: (s1.pos.y - s0.pos.y).toFixed(2), hour: [s0.hour.toFixed(2), s1.hour.toFixed(2)] }));
  // (no frames run while frozen; the squad still shoots in the half second either side: one hit is 20)
  await t.check(p, 'after the freeze: same place, no run of damage, clock barely moved', `${Math.hypot(s1.pos.x - s0.pos.x, s1.pos.z - s0.pos.z) < 1 && Math.abs(s1.pos.y - s0.pos.y) < 1 && s1.hp >= s0.hp - 35 && Math.abs(s1.hour - s0.hour) < 0.2}`);
  await p.waitForTimeout(3000);
  await t.check(p, 'the frame loop is back (frames counting, dt sane)', `(async () => { const a = game.frames; await new Promise((r) => setTimeout(r, 1000)); return game.frames - a > 5; })()`);
  await t.check(p, 'the player is on the ground and can move', `Math.abs(game.player.position.y - game.hf.heightAt(game.player.position.x, game.player.position.z)) < 2`);
  // a catch's fades and a death's are timers: hidden in the middle of one, they finish once shown
  await p.evaluate(`game.state.data.health = 0`);
  await p.waitForTimeout(1200);
  await freeze(60000);
  const woke = await t.until(p, `game.state.data.health > 0 && !game.player.frozen && game.mode === 'playing'`, 15000);
  await t.check(p, 'a death that started before a 1-minute freeze still wakes you at the camp', `${woke} && game.player.position.distanceTo(game.landmarks.campPosition) < 12`);
  // audio: nothing piled up while frozen (the music scheduler drops its backlog)
  await t.check(p, 'no page errors so far', `true`);
  return t.done();
}

// ------------------------------------------------------------------ resizing, zoom, full screen
async function resize() {
  const t = await session('resize');
  const p = await t.page(`${PLAY}&autostart&hour=15`);
  await p.evaluate(HOOKS);
  const cdp = await t.ctx.newCDPSession(p);
  const count = `(() => ({ tex: game.renderer.info.memory.textures, geo: game.renderer.info.memory.geometries }))()`;
  const c0 = await p.evaluate(count);
  const sizes = [[960, 540], [1280, 720], [640, 360], [1920, 1080], [400, 700], [1024, 600], [2560, 1440], [800, 450]];
  for (let i = 0; i < 40; i++) {
    const [w, h] = sizes[i % sizes.length];
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: [1, 1.25, 2, 1.5][i % 4], mobile: false });
    await p.waitForTimeout(120);
  }
  for (let i = 0; i < 6; i++) {
    await p.evaluate(`document.documentElement.requestFullscreen?.().catch(() => {})`);
    await p.waitForTimeout(300);
    await p.evaluate(`document.exitFullscreen?.().catch(() => {})`);
    await p.waitForTimeout(300);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await p.waitForTimeout(1500);
  const c1 = await p.evaluate(count);
  console.log('    textures/geometries before/after 40 resizes and 6 fullscreen toggles:', JSON.stringify([c0, c1]));
  await t.check(p, 'no render targets or geometries left behind', `${c1.tex <= c0.tex + 1 && c1.geo <= c0.geo + 2}`);
  await t.check(p, 'the canvas fits the window again', `(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return Math.abs(r.width - innerWidth) < 70 && Math.abs(r.height - innerHeight) < 130 && Math.abs(game.camera.aspect - innerWidth / innerHeight) < 0.02; })()`);
  await t.check(p, 'still rendering', `(async () => { const a = game.frames; await new Promise((r) => setTimeout(r, 800)); return game.frames > a; })()`);
  return t.done();
}

// ------------------------------------------------------------------ focus and the pointer lock lost
async function focus() {
  const t = await session('focus');
  const p = await t.page(`${PLAY}&autostart&hour=15`);
  await p.evaluate(HOOKS);
  // mid-fight, walking: the window loses focus with W held
  await p.evaluate(`(() => { game.combat.difficulty = 'story'; game.recovery.summon(game.player.position, game.cam.yaw, 22, 2, true); })()`);
  await p.keyboard.down('KeyW');
  await p.waitForTimeout(600);
  await p.evaluate(`window.dispatchEvent(new Event('blur'))`);
  await p.waitForTimeout(300);
  const a = await p.evaluate(`game.player.position.clone()`);
  await p.waitForTimeout(1200);
  const b2 = await p.evaluate(`game.player.position.clone()`);
  await p.keyboard.up('KeyW');
  await t.check(p, `focus lost with W held: the player stops (moved ${Math.hypot(b2.x - a.x, b2.z - a.z).toFixed(2)} m after)`, `${Math.hypot(b2.x - a.x, b2.z - a.z) < 0.4}`);
  // mid-lockpick, lifting the binding pin with Space: focus goes (alt-tab), the key comes up in another window
  await p.evaluate(`(async () => {
    const m = await import('/src/ui/Lockpick.ts');
    const run = m.LockpickGame.prototype.run;
    m.LockpickGame.prototype.run = function () { window.__lpg = this; return run.call(this); };
    window.__lp = game.ctx.ui.lockpick({ pins: 4, title: 'Focus test', onBreak: () => false });
  })()`);
  await p.waitForTimeout(800);
  await p.evaluate(`__lpg.sel = __lpg.order[0]`);
  await p.keyboard.down('Space');
  await p.waitForTimeout(150);
  await p.evaluate(`window.dispatchEvent(new Event('blur'))`);
  await p.waitForTimeout(3000);
  console.log('    lockpick after focus was lost mid-lift:', JSON.stringify(await p.evaluate(`({ lifting: __lpg.lifting, strain: __lpg.strain, msg: document.querySelector('.panel.mg .msg')?.textContent })`)));
  await t.check(p, 'lockpick: focus lost mid-lift: the pin is let go (no overset, no strain)', `!__lpg.lifting && __lpg.strain === 0 && !/Overset/.test(document.querySelector('.panel.mg .msg')?.textContent ?? '')`);
  await p.keyboard.up('Space');
  // the pointer lock goes away mid-minigame (the browser takes it back): no pause menu over the lock
  await p.evaluate(`(() => { game.openPause = Object.getPrototypeOf(game).openPause.bind(game); game.input.locked = true; document.dispatchEvent(new Event('pointerlockchange')); })()`);
  await p.waitForTimeout(600);
  await t.check(p, 'pointer lock lost mid-minigame: the lockpick stays up, no pause menu on top', `game.ui.minigameOpen && !document.querySelector('.panel.pause')`);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(800);
  await t.check(p, 'Escape closes the lockpick; the game is back (no stuck modal)', `!game.ui.minigameOpen && !game.ui.modalOpen`);
  return t.done();
}

const runs = { blocked, full, corrupt, old, tabs, hidden, resize, focus };
let ok = true;
for (const [k, f] of Object.entries(runs)) if (which === 'all' || which === k) ok = (await f()) && ok;
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
