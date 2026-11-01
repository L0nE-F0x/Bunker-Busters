// Rebinding end to end, settings migration, keyboard/mouse and touch regressions (headless).
//   node scripts/dev/controls-test.mjs [all|kb|settings|touch]   (BB_URL=http://localhost:5173, OUT=/tmp for screenshots)
// settings: the 2026-10-31 options (migration, tabs, keyboard menus, the notice, credits, report a bug,
// hold/toggle keys, subtitle size, brightness, voice level).
import { launch, waitForGame } from './browser.mjs';
const ORIGIN = process.env.DEV_ORIGIN || `http://localhost:${process.env.BB_PORT || 5173}`; // another dev server (a worktree): BB_PORT=5181

const BASE = `${process.env.BB_URL || ORIGIN}/play/?webgl`;
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

if (only === 'all' || only === 'settings') {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const wait = (ms) => p.waitForTimeout(ms);
  const ev = (js) => p.evaluate(js);
  const boot = async (q = '') => { await p.goto(BASE + q); await waitForGame(p, 400000); await wait(1200); };
  const KEY = 'bunker-busters.settings.v1';
  await boot();
  // ---- migration: a v1.0.3 file (no new fields): voices keep their old level (they rode Effects)
  await ev(`localStorage.setItem('${KEY}', JSON.stringify({ quality: 'medium', master: 0.5, music: 0.4, sfx: 0.4, sensitivity: 1.3, voice: true, voiceOn052: true, fov: 70, bob: 0.5 }))`);
  await boot('&notice');
  let s = await ev(`game.settings`);
  check('old settings: new fields get defaults', s.brightness === 1 && s.subSize === 'medium' && s.subBg === 'light' && s.shake === 1 && s.reduceFlash === false && s.toggleCrouch === false && s.toggleAim === false && s.flashNotice === false,
    JSON.stringify({ b: s.brightness, sz: s.subSize, bg: s.subBg, sh: s.shake, rf: s.reduceFlash, tc: s.toggleCrouch }));
  check('old settings: voice volume starts at the old Effects level', s.voiceVol === 0.4 && (await ev(`game.audio.volume.voice`)) === 0.4, String(s.voiceVol));
  check('old settings: old fields kept', s.quality === 'medium' && s.fov === 70 && s.bob === 0.5 && s.sensitivity === 1.3);
  // ---- the photosensitivity notice (forced with ?notice: automation skips it), once
  check('notice shows on first launch', await ev(`!!document.querySelector('.notice-card')`));
  await p.screenshot({ path: `${OUT}/settings-notice.png` });
  await ev(`(() => { const s = document.querySelector('.notice-card [data-k="reduceFlash"]'); s.value = '1'; s.dispatchEvent(new Event('input')); })()`);
  await p.keyboard.press('Enter'); // the keyboard reaches Continue (its focus starts there)
  await wait(400);
  s = await ev(`JSON.parse(localStorage.getItem('${KEY}'))`);
  check('notice: Reduce flashing set from it, and it is not shown again', s.reduceFlash === true && s.flashNotice === true && !(await ev(`!!document.querySelector('.notice-card')`)), JSON.stringify({ rf: s.reduceFlash, fn: s.flashNotice }));
  // ---- corrupt values clamp or fall back
  await ev(`localStorage.setItem('${KEY}', JSON.stringify({ brightness: 99, subSize: 'huge', subBg: 5, shake: 'x', reduceFlash: 'yes', toggleCrouch: 1, toggleSprint: null, voiceVol: -3, flashNotice: true }))`);
  await boot('&notice');
  s = await ev(`game.settings`);
  check('corrupt new fields sanitised', s.brightness === 1.4 && s.subSize === 'medium' && s.subBg === 'light' && s.shake === 1 && s.reduceFlash === false && s.toggleCrouch === false && s.toggleSprint === false && s.voiceVol === 0,
    JSON.stringify({ b: s.brightness, sz: s.subSize, bg: s.subBg, sh: s.shake, rf: s.reduceFlash, tc: s.toggleCrouch, vv: s.voiceVol }));
  check('notice stays away once seen', !(await ev(`!!document.querySelector('.notice-card')`)));
  await ev(`localStorage.removeItem('${KEY}')`);
  await boot();

  // ---- keyboard only: the title menu
  await p.keyboard.press('ArrowDown');
  await wait(150);
  const f0 = await ev(`document.querySelector('#title .pad-focus')?.textContent`);
  check('keyboard: arrows show a focus ring on the title', !!f0 && (await ev(`document.documentElement.classList.contains('keynav')`)), f0);
  for (let i = 0; i < 6 && !/settings/i.test(await ev(`document.querySelector('.pad-focus')?.textContent || ''`)); i++) { await p.keyboard.press('ArrowDown'); await wait(120); }
  await p.keyboard.press('Enter');
  await wait(500);
  check('keyboard: Enter opens Settings', await ev(`!!document.querySelector('.st-panel')`));
  check('settings: five tabs', (await ev(`[...document.querySelectorAll('.st-tabs .tab')].map(t => t.textContent).join('|')`)) === 'Gameplay|Video|Audio|Controls|Accessibility');
  // arrows walk the fields; left/right change one (the FOV slider on Gameplay)
  await p.keyboard.press('ArrowDown'); await wait(120);
  for (let i = 0; i < 6 && !(await ev(`!!document.querySelector('.st-panel .pad-focus[data-k="fov"]')`)); i++) { await p.keyboard.press('ArrowDown'); await wait(120); }
  const fov0 = await ev(`game.settings.fov`);
  await p.keyboard.press('ArrowRight'); await wait(120);
  await p.keyboard.press('ArrowRight'); await wait(120);
  check('keyboard: right arrow raises the focused slider', (await ev(`game.settings.fov`)) === fov0 + 2, `${fov0} -> ${await ev(`game.settings.fov`)}`);
  await p.keyboard.press('ArrowLeft'); await wait(120);
  await p.keyboard.press('ArrowLeft'); await wait(120);
  // Accessibility page: subtitle size reaches the CSS, Reset puts the page back
  await p.click('.st-tabs .tab[data-tab="access"]');
  await wait(200);
  await p.selectOption('.st-panel [data-k="subSize"]', 'xl');
  await p.selectOption('.st-panel [data-k="subBg"]', 'solid');
  await wait(150);
  const css = await ev(`({ k: getComputedStyle(document.documentElement).getPropertyValue('--sub-k').trim(), fs: getComputedStyle(document.querySelector('.st-sample .subtitle')).fontSize })`);
  check('subtitle size: XL scales the subtitle text', css.k === '1.55' && parseFloat(css.fs) > 28, JSON.stringify(css));
  await p.screenshot({ path: `${OUT}/settings-access.png` });
  await p.click('.st-panel .st-reset');
  await wait(150);
  s = await ev(`game.settings`);
  check('Reset puts this page back', s.subSize === 'medium' && s.subBg === 'light' && s.fov === fov0, JSON.stringify({ sz: s.subSize, bg: s.subBg, fov: s.fov }));
  // Video page: brightness reaches the post uniform; Audio page: voice volume reaches the bus, and greys out with voices off
  await p.click('.st-tabs .tab[data-tab="video"]');
  await ev(`(() => { const r = document.querySelector('.st-panel [data-k="brightness"]'); r.value = '1.25'; r.dispatchEvent(new Event('input')); })()`);
  check('brightness: saved and applied', (await ev(`game.settings.brightness`)) === 1.25 && Math.abs((await ev(`game.post.displayGamma.value`)) - 0.8) < 1e-6);
  await p.click('.st-tabs .tab[data-tab="audio"]');
  await ev(`(() => { const r = document.querySelector('.st-panel [data-k="voiceVol"]'); r.value = '0.35'; r.dispatchEvent(new Event('input')); })()`);
  await p.selectOption('.st-panel [data-k="voice"]', '0');
  check('voice volume: own level; disabled with voices off', (await ev(`game.audio.volume.voice`)) === 0.35 && (await ev(`game.audio.volume.sfx`)) === 0.9 && (await ev(`document.querySelector('.st-panel [data-k="voiceVol"]').disabled`)));
  await p.selectOption('.st-panel [data-k="voice"]', '1');
  await p.keyboard.press('Escape');
  await wait(300);
  check('Escape closes Settings, title stays', await ev(`!document.querySelector('.st-panel') && !!document.querySelector('#title')`));

  // ---- Credits and Report a bug
  await p.click('#title .menu-minor button:has-text("Credits")');
  await wait(400);
  const cr = await ev(`document.querySelector('.cr')?.textContent || ''`);
  check('Credits: the developer and the licences', /A game by L0nE-F0x/i.test(cr) && /three\.js/.test(cr) && /Rapier/.test(cr) && /Apache-2\.0/.test(cr) && /OFL-1\.1/.test(cr) && /Kokoro/.test(cr), cr.replace(/\s+/g, ' ').slice(0, 80));
  await p.screenshot({ path: `${OUT}/settings-credits.png` });
  await ev(`window.__opened = []; window.open = (u) => { window.__opened.push(u); return {}; }`);
  await p.click('.cr button[data-go="licences"]');
  await p.keyboard.press('Escape');
  await wait(300);
  check('Credits: Licences opens licenses.txt; Escape closes', (await ev(`window.__opened[0] || ''`)).endsWith('/licenses.txt') && !(await ev(`!!document.querySelector('.cr')`)), await ev(`window.__opened[0]`));
  await p.click('#title .menu-minor button:has-text("Report a bug")');
  await wait(200);
  const url = await ev(`window.__opened[1] || ''`);
  const q = new URL(url).searchParams;
  check('Report a bug: the issue form, filled in', url.startsWith('https://github.com/L0nE-F0x/Bunker-Busters/issues/new?template=bug_report.yml&') && /^\d+\.\d+\.\d+$/.test(q.get('version') || '') && q.get('platform') === 'Browser on a computer' && /Linux, Chrome \d+, 1280×720/.test(q.get('system') || '') && /^WebGL2, \w+ preset$/.test(q.get('gpu') || '') && url.length < 1000,
    `${url.length} chars: ${q.get('platform')} | ${q.get('system')} | ${q.get('gpu')}`);
  // a blocked pop-up: the link in a box with a Copy button
  await ev(`window.open = () => null`);
  await p.click('#title .menu-minor button:has-text("Report a bug")');
  await wait(300);
  check('blocked pop-up: the link box shows the URL', (await ev(`document.querySelector('.linkbox textarea')?.value || ''`)).startsWith('https://github.com/L0nE-F0x/'));
  await p.keyboard.press('Escape');
  await wait(200);
  check('Escape closes the link box', !(await ev(`!!document.querySelector('.linkbox')`)));

  // ---- hold or toggle: crouch on C, aim on the right mouse button
  await ev(`Object.assign(game.settings, { toggleCrouch: true, toggleAim: true }); game.applySettings(game.settings)`);
  await p.goto(BASE + '&autostart');
  await waitForGame(p, 400000);
  await wait(5000);
  await p.mouse.click(640, 360); // take the mouse (headless pointer lock)
  await wait(500);
  const tap = async (k) => { await p.keyboard.down(k); await wait(80); await p.keyboard.up(k); await wait(400); };
  await tap('KeyC');
  const c1 = await ev(`game.player.crouching`);
  await tap('KeyC');
  const c2 = await ev(`game.player.crouching`);
  check('toggle crouch: a tap crouches, the next stands', c1 === true && c2 === false, `${c1} ${c2}`);
  const lk = await ev(`({ locked: game.input.locked, soft: game.input.soft })`);
  if (lk.locked && !lk.soft) {
    await ev(`game.state.addItem('revolver', 1); game.state.addItem('ammo38', 12); game.arms.equip('revolver', true)`);
    await wait(900);
    await p.mouse.down({ button: 'right' }); await wait(60); await p.mouse.up({ button: 'right' }); await wait(700);
    const a1 = await ev(`game.hands.arms.ads`);
    await p.mouse.down({ button: 'right' }); await wait(60); await p.mouse.up({ button: 'right' }); await wait(700);
    const a2 = await ev(`game.hands.arms.ads`);
    check('toggle aim: a click aims, the next lowers', a1 > 0.5 && a2 < 0.5, `${a1.toFixed(2)} ${a2.toFixed(2)}`);
  } else console.log('SKIP  toggle aim: pointer lock unavailable headless', JSON.stringify(lk));
  await ev(`Object.assign(game.settings, { toggleCrouch: false, toggleAim: false }); game.applySettings(game.settings)`);
  await p.keyboard.down('KeyC'); await wait(400);
  const h1 = await ev(`game.player.crouching`);
  await p.keyboard.up('KeyC'); await wait(400);
  check('hold crouch again once switched back', h1 === true && (await ev(`game.player.crouching`)) === false);
  await ev(`localStorage.removeItem('${KEY}')`);
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
