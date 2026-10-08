// Rebinding end to end, settings migration, keyboard/mouse and touch regressions (headless).
//   node scripts/dev/controls-test.mjs [all|kb|touch]   (BB_URL=http://localhost:5173, OUT=/tmp for screenshots)
import { launch, waitForGame } from './browser.mjs';

const BASE = `${process.env.BB_URL || 'http://localhost:5173'}/play/?webgl`;
const OUT = process.env.OUT || '/tmp';
const only = process.argv[2] || 'all';
const b = await launch(process.env.GPU_MODE || 'nvidia');
const check = (name, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);

if (only === 'all' || only === 'kb') {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const wait = (ms) => p.waitForTimeout(ms);
  const ev = (js) => p.evaluate(js);
  await p.goto(BASE);
  // ---- migration: an old settings file (no binds, a v0.5.6 field), then a corrupt binds block
  await ev(`localStorage.setItem('bunker-busters.settings.v1', JSON.stringify({ quality: 'medium', master: 0.5, music: 0.4, sfx: 0.9, sensitivity: 1.3, voice: true, voiceOn052: true, fov: 70 }))`);
  await p.reload();
  await waitForGame(p);
  let s = await ev(`game.settings`);
  check('old settings: binds filled with defaults', JSON.stringify(s.binds.kb.jump) === '["Space"]' && s.binds.pad.jump === 'P0' && s.binds.rumble === true);
  check('old settings: other fields kept', s.quality === 'medium' && s.master === 0.5 && s.fov === 70 && s.sensitivity === 1.3 && s.invertY === false, JSON.stringify({ q: s.quality, m: s.master, fov: s.fov, sens: s.sensitivity, inv: s.invertY, bob: s.bob }));
  await ev(`localStorage.setItem('bunker-busters.settings.v1', JSON.stringify({ quality: 'nonsense', fov: 500, binds: { kb: { jump: ['KeyE', 'Escape', 5], interact: ['KeyE'], bogus: ['KeyZ'] }, pad: { jump: 'P99', crouch: 'P9', reload: 'P3h' }, rumble: false } }))`);
  await p.reload();
  await waitForGame(p);
  s = await ev(`game.settings`);
  check('corrupt binds sanitised', JSON.stringify(s.binds.kb.jump) === '["KeyE"]' && s.binds.kb.interact.length === 0 && !('bogus' in s.binds.kb) && s.binds.pad.jump === 'P0' && s.binds.pad.crouch === 'P1' && s.binds.rumble === false,
    JSON.stringify({ jump: s.binds.kb.jump, interact: s.binds.kb.interact, pj: s.binds.pad.jump, pc: s.binds.pad.crouch, pr: s.binds.pad.reload, holster: s.binds.pad.holster }));
  check('corrupt quality / fov clamped', s.quality !== 'nonsense' && s.fov <= 90, `${s.quality} ${s.fov}`);
  await ev(`localStorage.removeItem('bunker-busters.settings.v1')`);
  await p.reload();
  await waitForGame(p);
  await wait(1200);

  // ---- rebind from the title's Controls screen
  await p.click('#title .menu button:has-text("Controls")');
  await wait(400);
  check('Controls screen opens', await ev(`!!document.querySelector('.cx')`));
  await p.click('.cx-b[data-a="jump"][data-slot="0"]');
  await wait(150);
  check('slot waits for a key', await ev(`!!document.querySelector('.cx-b.wait')`));
  await p.keyboard.press('KeyG');
  await wait(200);
  s = await ev(`JSON.parse(localStorage.getItem('bunker-busters.settings.v1'))`);
  check('jump → G, saved', JSON.stringify(s?.binds?.kb?.jump) === '["KeyG"]', JSON.stringify(s?.binds?.kb?.jump));
  // conflict: Use → F; Other way in gets E (they trade)
  await p.click('.cx-b[data-a="interact"][data-slot="0"]');
  await wait(150);
  await p.keyboard.press('KeyF');
  await wait(200);
  s = await ev(`game.settings.binds.kb`);
  const msg = await ev(`document.querySelector('.cx-msg').textContent`);
  check('conflict trades keys', s.interact[0] === 'KeyF' && s.alt[0] === 'KeyE', `${s.interact} / ${s.alt} — "${msg}"`);
  // a mouse button onto melee's alt slot; then Backspace clears it
  await p.click('.cx-b[data-a="melee"][data-slot="1"]');
  await wait(150);
  await p.mouse.click(640, 300, { button: 'middle' });
  await wait(200);
  check('mouse button binds', (await ev(`game.settings.binds.kb.melee.join()`)) === 'KeyV,Mouse1', await ev(`game.settings.binds.kb.melee.join()`));
  await p.click('.cx-b[data-a="melee"][data-slot="1"]');
  await wait(150);
  await p.keyboard.press('Backspace');
  await wait(200);
  check('Backspace clears a slot', (await ev(`game.settings.binds.kb.melee.join()`)) === 'KeyV');
  // Escape while waiting cancels, Escape again closes (and the title stays)
  await p.click('.cx-b[data-a="torch"][data-slot="0"]');
  await wait(150);
  await p.keyboard.press('Escape');
  await wait(150);
  check('Escape cancels a capture', (await ev(`game.settings.binds.kb.torch.join()`)) === 'KeyL' && (await ev(`!!document.querySelector('.cx')`)));
  await p.screenshot({ path: `${OUT}/controls-kb.png` });
  await p.keyboard.press('Escape');
  await wait(200);
  check('Escape closes Controls', await ev(`!document.querySelector('.cx') && !!document.querySelector('#title')`));

  // ---- play with the new keys (a fresh load reads them back from settings)
  await p.goto(BASE + '&autostart');
  await waitForGame(p);
  await wait(5000);
  check('bindings survive a reload', (await ev(`game.settings.binds.kb.jump.join()`)) === 'KeyG');
  const jumpWith = async (code) => {
    await p.keyboard.down(code);
    let vy = -9;
    for (let i = 0; i < 8; i++) { vy = Math.max(vy, await ev(`game.player.velocity.y`)); await wait(30); }
    await p.keyboard.up(code);
    await wait(1200);
    return vy;
  };
  const vSpace = await jumpWith('Space');
  const vG = await jumpWith('KeyG');
  check('Space no longer jumps', vSpace < 0.5, vSpace.toFixed(2));
  check('G jumps', vG > 0.5, vG.toFixed(2));
  // keyboard movement unchanged
  const p0 = await ev(`game.player.position.clone()`);
  await p.keyboard.down('KeyW'); await wait(1200); await p.keyboard.up('KeyW'); await wait(300);
  const p1 = await ev(`game.player.position.clone()`);
  check('W still walks', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 2, Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2));
  // prompt glyph follows the binding: walk to the camp prompt? Check the hotbar's key labels instead
  check('hotbar shows key labels', (await ev(`[...document.querySelectorAll('.hotbar .slot .k')].map(e => e.textContent).join(' ')`)) === '1 2 3 4');
  // kit on Tab, and Tab / Escape close it
  await p.keyboard.press('Tab');
  await wait(400);
  check('Tab opens the kit', await ev(`game.ui.modalOpen`));
  const foot = await ev(`document.querySelector('.modal footer .kb')?.textContent`);
  check('kit footer shows bound keys', /Tab close/.test(foot), foot);
  await p.keyboard.press('KeyK');
  await wait(300);
  check('K switches to skills', (await ev(`document.querySelector('.tabs .tab.on')?.dataset.tab`)) === 'skills');
  await p.keyboard.press('Escape');
  await wait(400);
  check('Escape closes the kit', !(await ev(`game.ui.modalOpen`)));
  // mouse: a real pointer lock (headless allows it after a click), then LMB fires
  await ev(`game.state.addItem('revolver', 1); game.state.addItem('ammo38', 12); game.arms.equip('revolver', true)`);
  await wait(900);
  await p.mouse.click(640, 360);
  await wait(400);
  const lk = await ev(`({ locked: game.input.locked, soft: game.input.soft })`);
  if (lk.locked && !lk.soft) {
    const m0 = await ev(`game.arms.mag('revolver')`);
    await p.mouse.down(); await wait(60); await p.mouse.up(); await wait(600);
    const m1 = await ev(`game.arms.mag('revolver')`);
    check('LMB fires (pointer locked)', m1 === m0 - 1, `${m0} -> ${m1}`);
    await p.mouse.down({ button: 'right' }); await wait(600);
    check('RMB aims', (await ev(`game.hands.arms.ads`)) > 0.5);
    await p.mouse.up({ button: 'right' });
    const y0 = await ev(`game.cam.yaw`);
    await p.mouse.move(800, 360, { steps: 5 }); await wait(200);
    check('mouse look turns', Math.abs((await ev(`game.cam.yaw`)) - y0) > 0.01);
  } else console.log('SKIP  pointer lock unavailable headless', JSON.stringify(lk));
  // reset to defaults from Controls
  await ev(`game.ui.showControls()`);
  await wait(300);
  await p.screenshot({ path: `${OUT}/controls-ingame.png` });
  await ev(`document.querySelector('.cx .reset').click()`);
  await wait(200);
  check('Reset restores defaults', (await ev(`game.settings.binds.kb.jump.join() + '|' + game.settings.binds.kb.interact.join()`)) === 'Space|KeyE');
  await p.close();
}

if (only === 'all' || only === 'touch') {
  const ctx = await b.newContext({ viewport: { width: 900, height: 420 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const wait = (ms) => p.waitForTimeout(ms);
  const ev = (js) => p.evaluate(js);
  await p.goto(BASE + '&autostart&touch=1');
  await waitForGame(p);
  await wait(5000);
  await ev(`game.input.requestLock()`);
  await wait(500);
  const tapEl = async (sel) => { const r = await ev(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); await p.touchscreen.tap(r.x, r.y); await wait(300); };
  await tapEl('#touch .t-crouch');
  check('touch: crouch button toggles crouch', await ev(`game.player.crouching`));
  await tapEl('#touch .t-crouch');
  check('touch: crouch button toggles back', !(await ev(`game.player.crouching`)));
  await wait(800);
  await tapEl('#touch .t-kit');
  check('touch: kit button opens the kit', await ev(`game.ui.modalOpen`));
  await p.screenshot({ path: `${OUT}/touch-kit.png` });
  await ctx.close();
}
await b.close();
