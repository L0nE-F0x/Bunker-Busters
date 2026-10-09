// Trailer footage, session C: the heist side. The lockpick and SPLICE minigames played by a
// solver (their UI on, the HUD off), the Garage's laser hall, a night approach by torchlight.
//   node scripts/promo/shots-heist.mjs <outdir> [names...]
import { openRig } from './rig.mjs';

const OUT = process.argv[2];
const only = new Set(process.argv.slice(3));
const want = (n) => !only.size || only.has(n);

// page side: catch the minigame instances, and solvers that play them on the virtual clock
const SOLVERS = `
  (async () => {
    const lp = await import('/src/ui/Lockpick.ts');
    const r1 = lp.LockpickGame.prototype.run;
    lp.LockpickGame.prototype.run = function () { window.__lp = this; return r1.call(this); };
    const hk = await import('/src/ui/Hack.ts');
    const r2 = hk.HackGame.prototype.run;
    hk.HackGame.prototype.run = function () { window.__hk = this; return r2.call(this); };
    // only the minigame shows: the rest of the HUD stays hidden
    const st = document.createElement('style');
    st.textContent = 'body.capmg #ui > :not(.overlay) { visibility: hidden !important; } body.capmg #ui { display: block !important; }';
    document.head.appendChild(st);
  })();
  window.S = {
    /** Lockpick: walk to the binding pin, lift to its height, release. */
    lock(t, dt) {
      const g = window.__lp; if (!g || g.done) return;
      const s = S.ls || (S.ls = { wait: 0.5 });
      s.wait -= dt; if (s.wait > 0) return;
      const b = g.bindingIndex; if (b < 0) return;
      if (g.sel !== b && !g.lifting) { g.select(g.sel + Math.sign(b - g.sel)); s.wait = 0.16; return; }
      const p = g.pins[b];
      if (!g.lifting) { g.lifting = true; return; }
      if (p.lift >= p.target - g.window * 0.15) { g.release(); s.wait = 0.32; }
    },
    /** SPLICE: find a pick order that uploads every daemon, then walk the cursor and splice. */
    plan(h) {
      const n = h.n, seqs = h.daemons.map((d) => d.seq), cap = Math.min(h.bufCap, 7);
      const at = (r, c) => h.cells[r * n + c];
      const has = (buf, q) => { for (let i = 0; i + q.length <= buf.length; i++) { let ok = true; for (let j = 0; j < q.length; j++) if (buf[i + j] !== q[j]) { ok = false; break; } if (ok) return true; } return false; };
      let best = null;
      const rec = (axis, line, path, used) => {
        const buf = path.map((c) => c.code), sc = seqs.filter((q) => has(buf, q)).length;
        if (!best || sc > best.sc || (sc === best.sc && path.length < best.path.length)) best = { sc, path: [...path] };
        if (sc === seqs.length || path.length >= cap) return sc === seqs.length;
        for (let j = 0; j < n; j++) {
          const cell = axis === 'row' ? at(line, j) : at(j, line);
          if (used.has(cell)) continue;
          used.add(cell); path.push(cell);
          const done = rec(axis === 'row' ? 'col' : 'row', axis === 'row' ? cell.c : cell.r, path, used);
          path.pop(); used.delete(cell);
          if (done) return true;
        }
        return false;
      };
      rec('row', 0, [], new Set());
      return best.path;
    },
    hack(t, dt) {
      const h = window.__hk; if (!h || h.done) return;
      const s = S.hs || (S.hs = { plan: S.plan(h), k: 0, wait: 1.1 });
      s.wait -= dt; if (s.wait > 0 || s.k >= s.plan.length) return;
      const cell = s.plan[s.k];
      const j = h.axis === 'row' ? cell.c : cell.r;
      if (h.cur !== j) { h.hover(h.axis === 'row' ? h.cells[h.line * h.n + (h.cur + Math.sign(j - h.cur))] : h.cells[(h.cur + Math.sign(j - h.cur)) * h.n + h.line]); h.audio.play('click'); s.wait = 0.11; return; }
      h.pick(cell); s.k++; s.wait = 0.42;
    },
  };
`;

const takes = [];
const take = (name, dur, setup, pre, opts = {}) => takes.push({ name, dur, setup, pre, ...opts });
const garageAt = (dx, dz, yaw, pitch, hour, extra = '') => `() => {
  document.body.classList.remove('capmg'); D.releaseAll(); D.g.weather.storm(0, true);
  const o = D.g.garage.b.origin; D.place(o.x + ${dx}, o.z + ${dz}, ${yaw}, ${pitch});
  D.g.atmo.hour = ${hour}; D.g.atmo.paused = true; D.g.envTimer = 0; D.expo = 1.3; D.tame(); ${extra} }`;

// by torchlight to the fence, SeedBot's lamp sweeping the yard beyond
take('approach', 7, garageAt(6, 34, 0.15, 0.02, 22.4, `D.arm('revolver'); D.g.arms.equip(null, true); D.g.hands.flashlightOn = true; D.g.player.flashlight = true;`),
  `(t, dt) => { D.hold('forward', true); D.hold('crouch', t > 3.5); }`, { settle: 1.0 });
// the gate padlock: five pins, by torchlight
take('lockpick', 8.5, garageAt(4, 25, 0.12, -0.1, 22.3, `D.arm('revolver'); D.g.arms.equip(null, true); D.g.hands.flashlightOn = true; D.g.player.flashlight = true;
  D.g.state.addItem('lockpick', 5, true, true); window.__lp = null; S.ls = null;
  document.body.classList.add('capmg'); D.g.input.exitLock?.(); void D.g.ui.lockpick({ pins: 5, title: 'GATE PADLOCK', onBreak: () => true });`),
  `(t, dt) => S.lock(t, dt)`, { settle: 0.3 });
// SPLICE on Tanner's vault keypad
take('splice', 8, garageAt(5, -2.2, 1.35, -0.12, 21.0, `D.arm('revolver'); D.g.arms.equip(null, true); window.__hk = null; S.hs = null;
  document.body.classList.add('capmg'); void D.g.ui.hack({ title: 'RUNWAY ROOM VAULT', host: 'BUNKRLY HOME · T. PIVOTSON', difficulty: 2, skill: 3,
    daemons: [{ id: 'vault', name: 'RUNWAY ROOM · RELEASE', blurb: 'The vault door unlatches. Tanner gets a push notification.' },
      { id: 'seedbot', name: 'SEEDBOT · DOCK', blurb: 'SeedBot docks for a 40-second "firmware review".' },
      { id: 'lasers', name: 'LASER GRID · OFF', blurb: 'The tripwire lasers in the hall drop out.' }] });`),
  `(t, dt) => S.hack(t, dt)`, { settle: 0.3 });
// the laser hall, crouched, the vault door ahead
take('lasers', 7, garageAt(5, -2.2, 1.35, -0.1, 21.0, `D.arm('revolver'); D.g.arms.equip(null, true); D.hold('crouch', true); D.g.hands.flashlightOn = true; D.g.player.flashlight = true;`),
  `(t, dt) => { D.hold('crouch', true); D.hold('forward', t > 0.8 && t < 5.5); D.g.cam.yaw += Math.sin(t * 0.7) * 0.0006; }`, { settle: 1.0 });

const list = takes.filter((t) => want(t.name));
const rig = await openRig({ url: '/play/?webgl&q=ultra&skip=ui&autostart', audio: list.reduce((a, t) => a + t.dur + (t.settle ?? 1.5) + 0.5, 10) });
await rig.begin({ music: 0, sfx: 0.9 });
await rig.eval(SOLVERS);
await rig.wait(500);
for (const t of list) {
  await rig.eval(`(${t.setup})(); D.g.state.data.health = 100;`);
  await rig.run(t.settle ?? 1.5, { pre: t.pre });
  await rig.record(`${OUT}/${t.name}.mp4`, t.dur, { pre: t.pre });
  console.log('   state', JSON.stringify(await rig.eval(() => ({ lp: window.__lp ? { done: window.__lp.done, set: window.__lp.pins.filter((p) => p.set).length } : null, hk: window.__hk ? { done: window.__hk.done, d: window.__hk.daemons.map((d) => d.state) } : null }))));
  await rig.eval(() => { try { window.__lp?.finish?.('abort'); } catch {} try { window.__hk?.finish?.({ done: [], traced: false, aborted: true }); } catch {} D.releaseAll(); });
}
await rig.close();
