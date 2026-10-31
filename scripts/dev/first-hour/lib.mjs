// Shared helpers for the first-hour walkthrough (headless, real input where it matters).
// Screenshots and the log go to $OUT (default: <tmp>/bb-first-hour).
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { launch, waitForGame } from '../browser.mjs';
export { waitForGame };
export const EVID = process.env.OUT || path.join(os.tmpdir(), 'bb-first-hour');
export const ORIGIN = process.env.DEV_ORIGIN || `http://localhost:${process.env.BB_PORT || 5173}`;

export async function start(query = '', { width = 1280, height = 720, shots = 'shots', init, touch = false } = {}) {
  const b = await launch(process.env.GPU_MODE || 'nvidia');
  const ctx = await b.newContext({ viewport: { width, height }, ...(touch ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}) });
  const p = await ctx.newPage();
  if (init) await p.addInitScript(init);
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/GL Driver|GPU stall|Failed to load resource/.test(t)) errors.push(t.slice(0, 240)); });
  await p.goto(`${ORIGIN}/play/?webgl${query ? '&' + query : ''}`);
  await waitForGame(p);
  const dir = path.join(EVID, shots);
  fs.mkdirSync(dir, { recursive: true });
  const T0 = Date.now();
  const log = [];
  const say = (s) => { const line = `[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}] ${s}`; log.push(line); console.log(line); };
  const ev = (js, arg) => p.evaluate(js, arg);
  const wait = (ms) => p.waitForTimeout(ms);
  let n = 0;
  const shot = async (name) => { const f = path.join(dir, `${String(++n).padStart(2, '0')}-${name}.png`); await p.screenshot({ path: f }); say(`shot ${f}`); return f; };
  // record everything the game tells the player
  const hook = () => ev(() => {
    if (window.__hooked) return; window.__hooked = true;
    const ui = game.ui; const E = (window.__ev = []); const t0 = performance.now();
    const A = (window.__all = []); // everything, never drained (checks read this; the log drains __ev)
    const rec = (k, s) => { const e = [((performance.now() - t0) / 1000).toFixed(1), k, s]; E.push(e); A.push(e); };
    for (const k of ['toast', 'banner', 'subtitle']) { const f = ui[k].bind(ui); ui[k] = (...a) => { rec(k, a.slice(0, 2).join(' | ')); return f(...a); }; }
    const pg = ui.pages.bind(ui); ui.pages = (ps, d) => { rec('pages', ps.map((x) => `${x.speaker}: ${x.text}`).join(' // ')); return pg(ps, d); };
    const ch = ui.choose.bind(ui); ui.choose = (o) => { rec('choose', `${o.speaker}: ${o.text} [${o.choices.map((c) => c.label + (c.disabled ? ` (x: ${c.disabled})` : '')).join(' | ')}]`); return ch(o); };
    let lastObj = '', lastPr = '';
    setInterval(() => {
      const o = document.querySelector('#hud .objective');
      const obj = o ? `${o.querySelector('.label')?.textContent} :: ${o.querySelector('.text')?.textContent}` : '';
      if (obj !== lastObj) { lastObj = obj; rec('objective', obj); }
      const pr = document.querySelector('#hud .prompt')?.textContent?.trim() ?? '';
      if (pr !== lastPr) { lastPr = pr; if (pr) rec('prompt', pr); }
    }, 250);
  });
  const drain = async () => { const e = await ev(() => (window.__ev ?? []).splice(0)); for (const [t, k, s] of e) say(`  ${k.padEnd(9)} ${s}`); };
  return { b, p, ev, wait, shot, say, log, errors, hook, drain, dir,
    async done(name = 'log') {
      await drain().catch(() => {});
      fs.writeFileSync(path.join(dir, `${name}.txt`), log.join('\n') + (errors.length ? `\nERRORS:\n${errors.join('\n')}` : '\nno page errors') + '\n');
      console.log(errors.length ? `ERRORS (${errors.length}):\n  ${[...new Set(errors)].slice(0, 12).join('\n  ')}` : 'no page errors');
      await b.close();
    } };
}

/** Click the element's centre with the real mouse. */
export async function clickEl(p, sel) {
  const r = await p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }, sel);
  if (!r) throw new Error('no element ' + sel);
  await p.mouse.click(r[0], r[1]);
}

/** Title → New Game → a card → Take the radio → the briefing paged with Enter → playing (nav helpers installed). */
export async function newRun(g, pick = 'infiltrator') {
  const { p, ev, wait } = g;
  await wait(1500);
  await clickEl(p, '#title .menu .btn.primary');
  await wait(3200);
  await clickEl(p, `.cs-card[data-id="${pick}"]`);
  await wait(400);
  await clickEl(p, '#charselect .go');
  for (let i = 0; i < 40 && !(await ev(() => !!document.querySelector('.panel.brief'))); i++) await wait(250);
  await g.hook();
  for (let i = 0; i < 8 && (await ev(() => !!document.querySelector('.panel.brief'))); i++) { await wait(500); await p.keyboard.press('Enter'); }
  await wait(800);
  const { navInit } = await import('./nav.mjs');
  await navInit(p);
}

/** Text of the element (trimmed), or ''. */
export const textOf = (p, sel) => p.evaluate((s) => document.querySelector(s)?.innerText?.trim() ?? '', sel);
