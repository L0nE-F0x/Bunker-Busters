// Page-side minigame players for the trailer (injected by the promo scripts; runs in the game page):
// catch each minigame instance as it opens, then play it on the virtual clock from a `pre` hook.
// `body.capmg` shows the minigame overlays and nothing else of the HUD (the game runs with ?skip=ui).
(async () => {
  const lp = await import('/src/ui/Lockpick.ts');
  const r1 = lp.LockpickGame.prototype.run;
  lp.LockpickGame.prototype.run = function () { window.__lp = this; return r1.call(this); };
  const hk = await import('/src/ui/Hack.ts');
  const r2 = hk.HackGame.prototype.run;
  hk.HackGame.prototype.run = function () { window.__hk = this; return r2.call(this); };
  const kp = await import('/src/ui/Circuit.ts');
  const r3 = kp.KeypadGame.prototype.run;
  kp.KeypadGame.prototype.run = function () { window.__kp = this; return r3.call(this); };
  window.DAEMONS = (await import('/src/content/hacks.ts')).DAEMONS;
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
  /** Keypad: read the code it wants and type it, a digit every `every` seconds after `delay`. */
  type(t, dt, { delay = 0.7, every = 0.36 } = {}) {
    const k = window.__kp; if (!k) return;
    const s = S.ks || (S.ks = { i: 0, next: delay });
    const code = k.opts.code;
    if (s.i >= code.length || t < s.next) return;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: `Digit${code[s.i]}` }));
    s.i++; s.next = t + every;
  },
  /** Forget the last minigame (a fresh take). */
  reset() { window.__lp = window.__hk = window.__kp = null; S.ls = S.hs = S.ks = null; },
};
