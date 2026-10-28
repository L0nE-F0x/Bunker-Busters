// Shared harness for the early-bunker playthroughs (garage-test, apex-test, panopticon-test, early-break-test).
// Needs `npm run dev`. Screenshots go to $SHOTS (default: the system temp dir).
import os from 'node:os';
import path from 'node:path';
import { launch, waitForGame } from './browser.mjs';

export const OUT = process.env.SHOTS ?? os.tmpdir();

/** Open the game, stub the UI's cards/minigames, return helpers. */
export async function open(url, label) {
  const b = await launch();
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/GL Driver|GPU stall/.test(t)) errors.push(t.slice(0, 240));
    if (/^\[T\]/.test(t)) console.log('   ', t);
  });
  await p.goto(url);
  await waitForGame(p);
  await p.waitForTimeout(2500);
  const checks = [];
  const ev = (js) => p.evaluate(js);
  const wait = (ms) => p.waitForTimeout(ms);
  const check = async (name, js) => {
    const ok = await p.evaluate(js).catch((e) => `error: ${e.message}`);
    checks.push([name, ok === true]);
    console.log(`${ok === true ? 'PASS' : 'FAIL'}  [${label}] ${name}${ok === true ? '' : `  (${JSON.stringify(ok)})`}`);
    return ok === true;
  };
  // a bug the 2026-10-27 debug pass fixed: `js` is true if it's back (then the run fails)
  const bug = async (name, js) => {
    const hit = await p.evaluate(js).catch((e) => `error: ${e.message}`);
    const ok = hit !== true && !(typeof hit === 'string' && hit.startsWith('error:'));
    checks.push([`fixed: ${name}`, ok]);
    console.log(`${ok ? 'PASS' : 'FAIL'}  [${label}] fixed: ${name}${ok ? '' : `  (${JSON.stringify(hit)})`}`);
    return !ok;
  };
  const until = async (js, ms) => {
    for (let t = 0; t < ms; t += 250) { if (await ev(js).catch(() => false)) return true; await wait(250); }
    return false;
  };
  const shot = async (name) => { const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('    shot', f); };
  return { b, p, errors, checks, ev, wait, check, bug, until, shot,
    async done() {
      console.log(errors.length ? `ERRORS (${errors.length}):\n  ${[...new Set(errors)].slice(0, 12).join('\n  ')}` : 'no page errors');
      await b.close();
      return checks.every(([, ok]) => ok) && !errors.length;
    } };
}

/** Stubs + helpers in the page. `B` = the bunker under test. */
export const STUBS = (bunker) => `(() => {
  window.V = game.player.position.constructor;
  window.B = game.${bunker};
  window.O = B.b.origin;
  window.P = B.b.points;
  window.go = (x, z, y) => game.player.teleport(new V(x, y ?? game.hf.heightAt(x, z) + 0.15, z));
  window.L = (x, z, y = 0.1) => game.player.teleport(new V(O.x + x, O.y + y, O.z + z));
  window.find = (id) => B.interactables.find((i) => i.id === id) ?? game.interactables.find((i) => i.id === id);
  window.act = (id) => { const it = find(id); if (!it) throw new Error('no interactable ' + id); return it.primary.run(); };
  window.act2 = (id) => { const it = find(id); if (!it) throw new Error('no interactable ' + id); return it.secondary.run(); };
  window.avail = (id, sec) => { const it = find(id); const a = sec ? it.secondary : it.primary; return a.available(); };
  window.__pick = [];
  window.__talk = [];
  window.__log = [];
  game.openPause = () => {}; // (headless never gets the pointer lock back: the pause menu would hold the world)
  game.ui.choose = async (o) => {
    const i = window.__pick.findIndex((id) => o.choices.some((x) => x.id === id));
    const want = i >= 0 ? window.__pick.splice(i, 1)[0] : null;
    const c = o.choices.find((x) => x.id === want && !x.disabled) ?? (want ? null : o.choices.find((x) => !x.disabled));
    window.__last = o; window.__log.push(['choose', o.text?.slice(0, 60), o.choices.map((c) => c.id + (c.disabled ? '(x)' : ''))]);
    return c ? c.id : 'no';
  };
  game.ui.converse = async (o) => {
    let id = o.start;
    window.__conv = [];
    for (let i = 0; i < 16 && id; i++) {
      const node = o.node(id); if (!node) break;
      window.__conv.push([id, node.choices.map((c) => c.id + (c.disabled ? '(x)' : ''))]);
      const want = window.__talk.shift();
      const c = node.choices.find((x) => x.id === want && !x.disabled);
      if (!c) break;
      o.onChoice(id, c.id);
      id = c.next || '';
    }
  };
  window.__code = null;
  window.__keypad = 'ok';
  game.ui.keypad = async (o) => { window.__code = o.code; window.__hint = o.hint; const r = window.__keypad; return typeof r === 'function' ? r(o) : r; };
  window.__lock = 'success';
  game.ui.lockpick = async (o) => { window.__pins = o.pins; return window.__lock; };
  window.__circ = true;
  game.ui.circuit = async () => window.__circ;
  window.__hack = null;
  game.ui.hack = async (o) => { window.__daemons = o.daemons.map((d) => d.id); return window.__hack ?? { aborted: false, traced: false, done: o.daemons.map((d) => d.id) }; };
  window.__toasts = [];
  game.state.events.on?.('toast', (t) => window.__toasts.push(t.text));
  window.__subs = [];
  const sub = game.ui.subtitle.bind(game.ui);
  game.ui.subtitle = (sp, tx, v) => { window.__subs.push(sp + ': ' + tx); return sub(sp, tx, v); };
  window.__banners = [];
  const ban = game.ui.banner.bind(game.ui);
  game.ui.banner = (a, b2, k) => { window.__banners.push(a + ' | ' + b2); return ban(a, b2, k); };
})()`;
