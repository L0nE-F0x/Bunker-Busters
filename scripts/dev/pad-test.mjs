// Controller test (a fake standard gamepad, headless): menus, play, minigames.
//   node scripts/dev/pad-test.mjs [all|menus|play|mini]   (BB_URL=http://localhost:5173, OUT=/tmp for screenshots)
import { launch, waitForGame } from './browser.mjs';

const BASE = `${process.env.BB_URL || 'http://localhost:5173'}/play/?webgl`;
const OUT = process.env.OUT || '/tmp';
const only = process.argv[2] || 'all';
const b = await launch(process.env.GPU_MODE || 'nvidia');
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('requestfailed', (r) => console.log('[reqfail]', r.url()));
p.on('response', (r) => { if (r.status() >= 400) console.log('[http]', r.status(), r.url().slice(0, 120)); });
p.on('console', (m) => { const t = m.text(); if (/Failed to load resource/.test(t)) return; if (m.type() === 'error' && !/GL Driver/.test(t)) console.log('[console.error]', t.slice(0, 300)); if (/^\[pad\]/.test(t)) console.log(t); });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.addInitScript(() => {
  const pad = (window.__pad = { buttons: new Array(17).fill(0), axes: [0, 0, 0, 0], rumbles: [], on: true });
  navigator.getGamepads = () => [pad.on ? {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
    buttons: pad.buttons.map((v) => ({ pressed: v > 0.5, touched: v > 0, value: v })), axes: pad.axes.slice(),
    vibrationActuator: { type: 'dual-rumble', playEffect: (t, o) => { pad.rumbles.push(o); return Promise.resolve('complete'); } },
  } : null, null, null, null];
});
const wait = (ms) => p.waitForTimeout(ms);
const btn = async (i, ms = 90, after = 160) => { await p.evaluate((i) => (window.__pad.buttons[i] = 1), i); await wait(ms); await p.evaluate((i) => (window.__pad.buttons[i] = 0), i); await wait(after); };
const axes = (a) => p.evaluate((a) => (window.__pad.axes = a), a);
const ev = (js) => p.evaluate(js);
const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, LT = 6, RT = 7, BACK = 8, START = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
const focused = () => ev(`(document.querySelector('.pad-focus')?.textContent || '').trim().slice(0, 40)`);
const check = (name, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);

await p.goto(BASE);
console.log('mode:', await waitForGame(p));
await wait(1500);

if (only === 'all' || only === 'menus') {
  // ---- title: first press shows focus, A goes
  await btn(DOWN);
  check('title focus appears', !!(await focused()), await focused());
  check('html.pad set', await ev(`document.documentElement.classList.contains('pad')`));
  await btn(DOWN);
  const f2 = await focused();
  await p.screenshot({ path: `${OUT}/title-focus.png` });
  check('title focus moves', !!f2, f2);
  // walk to New Game and press A
  for (let i = 0; i < 4 && !/new game/i.test(await focused()); i++) await btn(UP);
  check('on New Game', /new game/i.test(await focused()), await focused());
  await btn(A, 90, 2500);
  check('charselect after A', (await ev('game.mode')) === 'charselect');
  const sel0 = await ev(`document.querySelector('.cs-card.sel')?.dataset.id`);
  await btn(DOWN); // first press: focus (the Take the radio button)
  const fcs = await focused();
  await btn(UP); await btn(UP); await btn(RIGHT);
  const sel1 = await ev(`document.querySelector('.cs-card.sel')?.dataset.id`);
  await wait(800);
  await p.screenshot({ path: `${OUT}/charselect-pad.png` });
  check('charselect: focus on a card picks it', sel1 && sel1 !== sel0, `${fcs} | ${sel0} -> ${sel1}`);
  // B goes back to the title, A New Game again
  await btn(B, 90, 1500);
  check('B leaves charselect', (await ev('game.mode')) === 'title');
  await btn(DOWN);
  for (let i = 0; i < 4 && !/new game/i.test(await focused()); i++) await btn(UP);
  await btn(A, 90, 2500);
  // Take the radio: the default focus is the primary button
  await btn(DOWN);
  for (let i = 0; i < 6 && !/take the radio|back/i.test(await focused()); i++) await btn(DOWN);
  if (/back/i.test(await focused())) await btn(RIGHT);
  check('focus reaches Take the radio', /take the radio/i.test(await focused()), await focused());
  await btn(A, 90, 3500);
  check('briefing pages up', await ev(`!!document.querySelector('.brief')`));
  await p.screenshot({ path: `${OUT}/brief-pad.png` });
  // A advances one page, B skips the rest
  const dots0 = await ev(`[...document.querySelectorAll('.brief .dots i')].findIndex(e => e.classList.contains('on'))`);
  await btn(A, 90, 400);
  const dots1 = await ev(`[...document.querySelectorAll('.brief .dots i')].findIndex(e => e.classList.contains('on'))`);
  check('A turns the page', dots1 === dots0 + 1, `${dots0} -> ${dots1}`);
  await btn(B, 90, 1500);
  check('B skips the briefing', await ev(`!document.querySelector('.brief')`));
  const st = await ev(`({ mode: game.mode, locked: game.input.locked, soft: game.input.soft, device: game.input.device })`);
  check('playing with a soft capture', st.mode === 'playing' && st.locked && st.soft, JSON.stringify(st));
}

if (only === 'play') {
  // straight into a run
  await p.goto(BASE + '&autostart');
  await waitForGame(p);
  await wait(4000);
  await btn(A, 60, 200); // pad is now the device
  await ev(`game.input.requestLock()`);
  await wait(300);
}

if (only === 'all' || only === 'play') {
  await wait(800);
  // ---- movement
  const p0 = await ev(`game.player.position.clone()`);
  await axes([0, -1, 0, 0]);
  await wait(1500);
  await axes([0, 0, 0, 0]);
  await wait(300);
  const p1 = await ev(`game.player.position.clone()`);
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  check('left stick walks', moved > 2, `moved ${moved.toFixed(2)} m`);
  // half stick walks slower
  const p2 = await ev(`game.player.position.clone()`);
  await axes([0, -0.5, 0, 0]);
  await wait(1500);
  await axes([0, 0, 0, 0]);
  await wait(300);
  const p3 = await ev(`game.player.position.clone()`);
  const moved2 = Math.hypot(p3.x - p2.x, p3.z - p2.z);
  check('half stick walks slower', moved2 > 0.5 && moved2 < moved, `moved ${moved2.toFixed(2)} m`);
  // sprint: L3 latches
  await axes([0, -1, 0, 0]);
  await wait(300);
  await btn(10, 80, 200);
  const spr = await ev(`game.player.sprinting`);
  await axes([0, 0, 0, 0]);
  await wait(400);
  check('L3 sprints (latched)', spr === true);
  check('sprint latch clears on stop', (await ev(`game.player.sprinting`)) === false);
  // look
  const y0 = await ev(`game.cam.yaw`), pt0 = await ev(`game.cam.pitch`);
  await axes([0, 0, 1, 0]);
  await wait(500);
  await axes([0, 0, 0, -1]);
  await wait(300);
  await axes([0, 0, 0, 0]);
  await wait(200);
  const y1 = await ev(`game.cam.yaw`), pt1 = await ev(`game.cam.pitch`);
  check('right stick turns', y1 < y0 - 0.5, `yaw ${y0.toFixed(2)} -> ${y1.toFixed(2)}`);
  check('right stick up looks up', pt1 > pt0 + 0.2, `pitch ${pt0.toFixed(2)} -> ${pt1.toFixed(2)}`);
  // tiny deflection is dead
  await axes([0.08, 0.08, 0.08, 0.08]);
  const y2 = await ev(`game.cam.yaw`);
  await wait(500);
  const y3 = await ev(`game.cam.yaw`);
  await axes([0, 0, 0, 0]);
  check('deadzone holds still', Math.abs(y3 - y2) < 1e-4);
  await ev(`game.cam.snap(game.cam.yaw, 0)`);
  // crouch toggle
  await btn(B);
  const c1 = await ev(`game.player.crouching`);
  await btn(B);
  const c2 = await ev(`game.player.crouching`);
  check('B toggles crouch', c1 === true && c2 === false);
  // jump
  await wait(1500);
  await p.evaluate((i) => (window.__pad.buttons[i] = 1), A);
  let vy = -9;
  for (let i = 0; i < 10; i++) { vy = Math.max(vy, await ev(`game.player.velocity.y`)); await wait(30); }
  await p.evaluate((i) => (window.__pad.buttons[i] = 0), A);
  await wait(800);
  check('A jumps', vy > 0.5, `vy ${vy.toFixed(2)}`);
  // combat: equip, aim, fire, reload, cycle
  await ev(`game.state.addItem('rifle', 1); game.state.addItem('ammo3030', 30); game.state.addItem('water', 2); game.arms.equip('rifle', true)`);
  await wait(800);
  const eq = await ev(`game.arms.equipped`);
  await p.evaluate((i) => (window.__pad.buttons[i] = 1), LT);
  await wait(700);
  const ads = await ev(`game.arms.ads ?? game.hands.arms.ads`);
  await p.screenshot({ path: `${OUT}/play-ads.png` });
  await p.evaluate((i) => (window.__pad.buttons[i] = 0), LT);
  await wait(400);
  check('LT aims down sights', ads > 0.5, `equipped ${eq} ads ${(+ads).toFixed(2)}`);
  const m1 = await ev(`game.arms.mag(game.arms.equipped)`);
  await btn(Y, 80, 5500);
  const m2 = await ev(`game.arms.mag(game.arms.equipped)`);
  check('Y (tap) reloads', m2 > m1, `mag ${m1} -> ${m2}`);
  await btn(RT, 80, 700);
  const m3 = await ev(`game.arms.mag(game.arms.equipped)`);
  const rum = await ev(`window.__pad.rumbles.length`);
  check('RT fires', m3 === m2 - 1, `mag ${m2} -> ${m3}`);
  check('firing rumbles', rum > 0, `${rum} effects`);
  await btn(Y, 700, 900);
  check('hold Y holsters', (await ev(`game.arms.equipped`)) === null, String(await ev(`game.arms.equipped`)));
  await btn(RB, 80, 900);
  check('RB draws / cycles', (await ev(`game.arms.equipped`)) !== null, String(await ev(`game.arms.equipped`)));
  // torch: hold LB
  const t0 = await ev(`!!game.hands.flashlightOn`);
  await btn(LB, 700, 300);
  check('hold LB toggles the torch', (await ev(`!!game.hands.flashlightOn`)) !== t0);
  // hotbar: d-pad down = water
  const w0 = await ev(`game.state.count('water')`);
  await ev(`game.state.data.thirst = 20`);
  await btn(DOWN, 80, 1800);
  const w1 = await ev(`game.state.count('water')`);
  check('d-pad down drinks water', w1 === w0 - 1 || w0 === 0, `water ${w0} -> ${w1}`);
  // prompt glyphs: put the player at a prompt? check the hotbar glyphs instead
  const hk = await ev(`[...document.querySelectorAll('.hotbar .slot .k')].map(e => e.textContent).join(' ')`);
  check('hotbar shows d-pad glyphs', hk === '↑ → ↓ ←', hk);
  // kit via View, LB/RB flip tabs, B closes
  await btn(BACK, 80, 600);
  check('View opens the kit', await ev(`game.ui.modalOpen`));
  const tab0 = await ev(`document.querySelector('.tabs .tab.on')?.dataset.tab`);
  await btn(RB, 80, 400);
  const tab1 = await ev(`document.querySelector('.tabs .tab.on')?.dataset.tab`);
  check('RB flips kit tabs', tab0 !== tab1, `${tab0} -> ${tab1}`);
  await btn(DOWN, 80, 300);
  await p.screenshot({ path: `${OUT}/kit-pad.png` });
  await btn(B, 80, 600);
  const back = await ev(`({ modal: game.ui.modalOpen, locked: game.input.locked })`);
  check('B closes the kit and play resumes', !back.modal && back.locked, JSON.stringify(back));
  // hold View: map
  await btn(BACK, 700, 600);
  check('hold View opens the map', await ev(`!!document.querySelector('.wmap')`));
  await btn(B, 80, 600);
  // Start: pause, navigate to Settings, change a slider, open Controls
  await btn(START, 80, 600);
  check('Start pauses', await ev(`!!document.querySelector('.pause h3') && document.querySelector('.pause h3').textContent === 'PAUSED'`));
  await btn(DOWN);
  for (let i = 0; i < 6 && !/settings/i.test(await focused()); i++) await btn(DOWN);
  await btn(A, 80, 500);
  check('Settings opens', await ev(`!!document.querySelector('.settings')`));
  // move focus to the first range (master volume) and nudge it
  for (let i = 0; i < 8 && !(await ev(`!!document.querySelector('.pad-focus[type=range]')`)); i++) await btn(DOWN);
  const k = await ev(`document.querySelector('.pad-focus')?.dataset.k`);
  const v0 = await ev(`+document.querySelector('.pad-focus').value`);
  await btn(LEFT); await btn(LEFT);
  const v1 = await ev(`+document.querySelector('.pad-focus').value`);
  check('d-pad left lowers a slider', v1 < v0, `${k} ${v0} -> ${v1} (settings ${await ev(`game.settings['${k}']`)})`);
  await btn(RIGHT); await btn(RIGHT);
  for (let i = 0; i < 14 && !/controls/i.test(await focused()); i++) await btn(DOWN);
  await p.screenshot({ path: `${OUT}/settings-pad.png` });
  await btn(A, 80, 500);
  check('Controls opens from Settings', await ev(`!!document.querySelector('.cx')`));
  await btn(DOWN);
  await btn(DOWN);
  await p.screenshot({ path: `${OUT}/controls-pad.png` });
  // B closes Controls only, then Settings, then Start resumes
  await btn(B, 80, 300);
  check('B closes Controls, Settings stays', await ev(`!document.querySelector('.cx') && !!document.querySelector('.settings')`));
  await btn(B, 80, 300);
  check('B closes Settings, pause stays', await ev(`!document.querySelector('.settings') && game.ui.modalOpen`));
  await btn(START, 80, 600);
  const r = await ev(`({ modal: game.ui.modalOpen, locked: game.input.locked })`);
  check('Start resumes', !r.modal && r.locked, JSON.stringify(r));
}

if (only === 'all' || only === 'mini') {
  if (only === 'mini') { await p.goto(BASE + '&autostart'); await waitForGame(p); await wait(4000); await btn(A, 60, 200); }
  // keypad: A types the focused key, d-pad moves
  await ev(`window.__kp = null; void game.ui.keypad({ title: 'TEST PAD', code: '2580', hint: 'pad test' }).then(r => window.__kp = r)`);
  await wait(400);
  await btn(DOWN); // focus
  const kf = await focused();
  await btn(A);
  await btn(RIGHT); await btn(A);
  const scr = await ev(`document.querySelector('.keypad .screen').textContent`);
  await p.screenshot({ path: `${OUT}/keypad-pad.png` });
  check('keypad: A presses keys', /^\d\d··$/.test(scr), `focus ${kf}, screen ${scr}`);
  await btn(B, 80, 400);
  check('keypad: B leaves', (await ev(`window.__kp`)) === 'abort', String(await ev('window.__kp')));
  // lockpick: left/right choose, A lifts, B backs off
  await ev(`window.__lp = null; void game.ui.lockpick({ pins: 4, title: 'TEST LOCK', onBreak: () => false }).then(r => window.__lp = r)`);
  await wait(500);
  await btn(RIGHT); await btn(RIGHT);
  await p.evaluate(() => (window.__pad.buttons[0] = 1));
  await wait(450);
  await p.screenshot({ path: `${OUT}/lockpick-pad.png` });
  await p.evaluate(() => (window.__pad.buttons[0] = 0));
  await wait(300);
  await btn(B, 80, 400);
  check('lockpick: B backs off', (await ev(`window.__lp`)) === 'abort', String(await ev('window.__lp')));
  // circuit: the stick tunes, B aborts
  await ev(`window.__cc = null; void game.ui.circuit({ title: 'TEST SCOPE', difficulty: 1 }).then(r => window.__cc = r)`);
  await wait(400);
  await axes([1, -1, 0, 0]);
  await wait(900);
  await p.screenshot({ path: `${OUT}/circuit-pad.png` });
  await axes([0, 0, 0, 0]);
  await wait(200);
  await btn(B, 80, 400);
  check('circuit: B aborts', (await ev(`window.__cc`)) === false, String(await ev('window.__cc')));
  // SPLICE: d-pad steps, A splices
  await ev(`window.__hk = null; void game.ui.hack({ title: 'TEST BOX', host: 'PAD TEST', difficulty: 1, daemons: [{ id: 'a', name: 'OPEN', blurb: 'test' }] }).then(r => window.__hk = r)`);
  await wait(600);
  const cur0 = await ev(`document.querySelector('.hk-cell.cur, .hk-grid .cur')?.textContent ?? ''`);
  await btn(RIGHT);
  await btn(RIGHT);
  const buf0 = await ev(`document.querySelectorAll('.hk-buffer .on, .hk-buffer b, .hk-buffer i.full').length`);
  await btn(A, 80, 300);
  const buf1 = await ev(`document.querySelector('.hk-buffer')?.textContent ?? ''`);
  await p.screenshot({ path: `${OUT}/splice-pad.png` });
  check('SPLICE: A splices into the buffer', buf1.trim().length > 0, `cur ${cur0} buf "${buf1.trim().slice(0, 30)}" (${buf0})`);
  await btn(B, 80, 1600);
  check('SPLICE: B jacks out', (await ev(`window.__hk`)) !== null, JSON.stringify(await ev('window.__hk')));
}

await b.close();
