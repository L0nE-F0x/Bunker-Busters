// Long-session soak: one headless run of mixed play for N minutes, sampling memory and object counts
// after every lap. Needs `npm run dev`; nothing appears on screen.
//
//   node scripts/dev/soak-test.mjs [minutes=50] [--out samples.jsonl]
//
// A lap (~3 min): walk a road (real keys), fast travel, a Kade squad and a wolf pack (shot at for
// real), day/night jumps, a storm now and then, the Kit/Skills/Journal, the map, the pause menu, the
// four minigames (opened and abandoned), a death and respawn every 4th lap, Quit to title and Continue
// every 5th. After each lap: heap after GC (CDP), GL programs/textures/buffers alive, three.js
// geometries/textures, scene objects, DOM nodes and listeners, window/document listeners, pending
// timeouts and live intervals, audio nodes alive and sources playing, console errors.
// PASS/FAIL at the end: no page errors; programs/textures/geometries/listeners/intervals flat after
// the second lap; heap within 6% of its post-warm-up median.
import fs from 'node:fs';
import { launch, waitForGame } from './browser.mjs';
const ORIGIN = process.env.DEV_ORIGIN || `http://localhost:${process.env.BB_PORT || 5173}`; // another dev server (a worktree): BB_PORT=5181

const minutes = +(process.argv.find((a) => /^\d+(\.\d+)?$/.test(a)) ?? 50);
const outI = process.argv.indexOf('--out');
const OUT = outI > 0 ? process.argv[outI + 1] : null;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 60000).toFixed(1).padStart(5)} min]`, ...a);

// counters installed before the game's own scripts run
const INSTRUMENT = () => {
  const W = window;
  const T = (W.__soak = { intervals: new Map(), listeners: new Map(), created: {}, freed: {}, playing: 0, gl: { program: 0, texture: 0, buffer: 0, framebuffer: 0, vertexArray: 0 } });
  const st = W.setTimeout, ct = W.clearTimeout, si = W.setInterval, ci = W.clearInterval;
  const pend = new Set();
  W.setTimeout = function (fn, ms, ...a) {
    const id = st.call(W, function () { pend.delete(id); if (typeof fn === 'function') return fn.apply(this, a); }, ms);
    pend.add(id);
    return id;
  };
  W.clearTimeout = function (id) { pend.delete(id); return ct.call(W, id); };
  W.setInterval = function (fn, ms, ...a) {
    const id = si.call(W, fn, ms, ...a);
    T.intervals.set(id, (new Error().stack || '').split('\n').slice(2, 4).map((s) => s.trim()).join(' < '));
    return id;
  };
  W.clearInterval = function (id) { T.intervals.delete(id); return ci.call(W, id); };
  T.pending = () => pend.size;
  // window/document listeners (the long-lived targets: an element's die with it)
  const key = (t, type, o) => `${t === W ? 'window' : 'document'}:${type}${(typeof o === 'boolean' ? o : !!o?.capture) ? ':capture' : ''}`;
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, o) {
    if ((this === W || this === document) && fn && !(o && typeof o === 'object' && o.once)) {
      const k = key(this, type, o);
      let s = T.listeners.get(k);
      if (!s) T.listeners.set(k, (s = new Set()));
      s.add(fn);
    }
    return add.call(this, type, fn, o);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, o) {
    if ((this === W || this === document) && fn) T.listeners.get(key(this, type, o))?.delete(fn);
    return rem.call(this, type, fn, o);
  };
  // audio nodes: created / collected (FinalizationRegistry), sources started and not ended
  const reg = new FinalizationRegistry((k) => { T.freed[k] = (T.freed[k] || 0) + 1; });
  const BAC = W.BaseAudioContext?.prototype;
  if (BAC) {
    for (const k of Object.getOwnPropertyNames(BAC)) {
      const d = Object.getOwnPropertyDescriptor(BAC, k);
      if (!k.startsWith('create') || typeof d?.value !== 'function') continue;
      const f = d.value;
      BAC[k] = function (...a) {
        const n = f.apply(this, a);
        T.created[k] = (T.created[k] || 0) + 1;
        try { reg.register(n, k); } catch { /* not an object */ }
        return n;
      };
    }
  }
  const ASN = W.AudioScheduledSourceNode?.prototype;
  if (ASN) {
    const s0 = ASN.start;
    ASN.start = function (...a) {
      T.playing++;
      add.call(this, 'ended', () => { T.playing--; }, { once: true });
      return s0.apply(this, a);
    };
  }
  // GL objects alive
  const GL = W.WebGL2RenderingContext?.prototype;
  if (GL) {
    for (const k of Object.keys(T.gl)) {
      const K = k[0].toUpperCase() + k.slice(1);
      const c = GL['create' + K], d = GL['delete' + K];
      if (!c || !d) continue;
      GL['create' + K] = function (...a) { const r = c.apply(this, a); if (r) T.gl[k]++; return r; };
      GL['delete' + K] = function (x, ...a) { if (x) T.gl[k]--; return d.call(this, x, ...a); };
    }
  }
};

// (audio starts on a click in a browser; headless has no click, so let the context start by itself)
const b = await launch(undefined, ['--autoplay-policy=no-user-gesture-required']);
const ctx = await b.newContext({ viewport: { width: 960, height: 540 } });
await ctx.addInitScript(INSTRUMENT);
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
const errors = [];
p.on('pageerror', (e) => { errors.push({ t: Date.now() - t0, m: 'pageerror: ' + e.message }); log('PAGEERROR', e.message); });
p.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/GL Driver|GPU stall/.test(t)) { errors.push({ t: Date.now() - t0, m: t.slice(0, 300) }); log('console.error', t.slice(0, 200)); }
});
await p.goto(`${ORIGIN}/play/?webgl&autostart&hour=16`);
await waitForGame(p);
await p.waitForTimeout(4000);
const ev = (js) => p.evaluate(js);
const wait = (ms) => p.waitForTimeout(ms);
const until = async (js, ms) => { for (let t = 0; t < ms; t += 250) { if (await ev(js).catch(() => false)) return true; await wait(250); } return false; };

const SETUP = `(() => {
  window.V = game.player.position.constructor;
  // headless never gives the pointer lock back: the automatic pause menu would hold the world (the
  // pause menu itself is opened on purpose, below)
  window.__realPause ??= game.openPause.bind(game);
  game.openPause = () => {};
  game.combat.difficulty = 'story';
  game.audio.start();
  const s = game.state;
  s.data.skills.electronics = Math.max(1, s.data.skills.electronics);
  if (!s.count('rifle')) s.addItem('rifle', 1, true, true);
  if (s.count('ammo3030') < 60) s.addItem('ammo3030', 60 - s.count('ammo3030'), true, true);
  if (s.count('lockpick') < 3) s.addItem('lockpick', 3, true, true);
})()`;
await ev(SETUP);

const PLACES = ['creek', 'drivein', 'gas', 'courier', 'booster', 'datacenter', 'tube', 'spire', 'waitlist', 'cave', 'solar', 'jet'];
const LM = await ev(`(async () => { const w = await import('/src/content/world.ts'); return Object.fromEntries(w.LANDMARKS.map((l) => [l.id, [l.position[0], l.position[2]]])); })()`);

async function sample(lap) {
  await cdp.send('HeapProfiler.collectGarbage');
  await wait(300);
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  const dom = await cdp.send('Memory.getDOMCounters');
  const s = await ev(`(() => {
    const T = window.__soak, g = game, info = g.renderer.info;
    let objects = 0; g.scene.traverse(() => objects++);
    const listeners = {}; let wl = 0;
    for (const [k, set] of T.listeners) { if (set.size) listeners[k] = set.size; wl += set.size; }
    const audioAlive = {}; let alive = 0;
    for (const k of Object.keys(T.created)) { const n = T.created[k] - (T.freed[k] || 0); audioAlive[k] = n; alive += n; }
    return {
      mode: g.mode, hour: +g.atmo.hour.toFixed(2), day: g.state?.data.days ?? null, health: g.state?.data.health ?? null,
      geometries: info.memory.geometries, textures: info.memory.textures,
      gl: { ...T.gl }, objects, winListeners: wl, listeners,
      pending: T.pending(), intervals: T.intervals.size, intervalSites: [...new Set(T.intervals.values())].slice(0, 6),
      audioAlive: alive, audioByKind: audioAlive, playing: T.playing,
      hostiles: g.combat.providers.reduce((n, pr) => n + pr.hostiles().filter((h) => h.alive).length, 0),
      toasts: document.querySelectorAll('.toasts > *').length, overlays: document.querySelectorAll('#ui > .overlay').length,
      fps: g.frames,
    };
  })()`);
  // usedSize is the JS heap; backingStorageSize is the typed arrays' memory (vertex data, most of it)
  const row = { lap, min: +((Date.now() - t0) / 60000).toFixed(2), heapMB: +(heap.usedSize / 1048576).toFixed(1), backingMB: heap.backingStorageSize ? +(heap.backingStorageSize / 1048576).toFixed(1) : null, domNodes: dom.nodes, jsListeners: dom.jsEventListeners, documents: dom.documents, errors: errors.length, ...s };
  if (OUT) fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
  log(`lap ${lap}: heap ${row.heapMB} MB (+${row.backingMB} MB arrays) · gl prog ${row.gl.program} tex ${row.gl.texture} buf ${row.gl.buffer} · geo ${row.geometries} tex3 ${row.textures} · objects ${row.objects} · dom ${row.domNodes} · listeners js ${row.jsListeners} win ${row.winListeners} · timeouts ${row.pending} intervals ${row.intervals} · audio alive ${row.audioAlive} playing ${row.playing} · ${row.mode} h${row.hour} d${row.day} · errors ${row.errors}`);
  return row;
}

// one lap's steps (each in a try: a failure is logged and counted, the soak goes on)
const issues = [];
async function step(name, fn) {
  try { await fn(); } catch (e) { issues.push(`${name}: ${e.message.split('\n')[0]}`); log('STEP FAILED', name, e.message.split('\n')[0]); }
}
const aimAt = `(() => {
  const pl = game.player.position; let best = null, bd = 1e9;
  for (const pr of game.combat.providers) for (const h of pr.hostiles()) { if (!h.alive) continue; const d = h.center.distanceTo(pl); if (d < bd) { bd = d; best = h; } }
  if (!best) return false;
  const e = game.camera.position, c = best.center;
  game.cam.snap(Math.atan2(-(c.x - e.x), -(c.z - e.z)), Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z)));
  return true;
})()`;
async function fight(seconds) {
  for (let t = 0; t < seconds * 1000; t += 300) {
    const any = await ev(aimAt);
    if (!any) break;
    await ev(`(() => { const a = game.arms; if (!a.equipped) a.equip('rifle', true); if (a.mag?.() === 0) a.reloadNow?.(); a.trigger(); })()`).catch(() => {});
    await ev(`game.state.data.health = Math.max(game.state.data.health, 60)`);
    await wait(300);
  }
}

async function lap(i) {
  const here = (id) => LM[id];
  const dest = PLACES[i % PLACES.length], next = PLACES[(i + 1) % PLACES.length];
  // 1. the road: teleport near a landmark, then walk/sprint toward the next one with real keys
  await step('road', async () => {
    const [x, z] = here(dest);
    await ev(`(() => { const x = ${x} + 35, z = ${z} + 35; game.player.teleport(new V(x, game.hf.heightAt(x, z) + 0.3, z)); })()`);
    await wait(1500);
    const [nx, nz] = here(next);
    await ev(`(() => { const p = game.player.position; game.cam.snap(Math.atan2(-(${nx} - p.x), -(${nz} - p.z)), -0.05); })()`);
    await p.keyboard.down('KeyW');
    await p.keyboard.down('ShiftLeft');
    await wait(14000);
    await p.keyboard.up('ShiftLeft');
    await wait(4000);
    await p.keyboard.up('KeyW');
  });
  // 2. fast travel (via the map's travel host) to the place we just were (it's been seen now)
  await step('fast travel', async () => {
    await ev(`game.openWorldMap()`);
    await wait(1200);
    await p.keyboard.press('Escape');
    await wait(600);
    const why = await ev(`(() => { const t = game.travel; const o = t.options().find((x) => x.id === '${dest}'); return o?.blocked ?? game.travelHost().why() ?? null; })()`);
    if (why) { log(`   travel to ${dest} blocked: ${why}`); return; }
    await ev(`game.travel.go('${dest}')`);
    const done = await until(`!game.travel.busy`, 9000);
    if (!done) throw new Error('fast travel never finished');
  });
  // 3. a Kade squad, shot at for real
  await step('squad', async () => {
    await ev(`game.recovery.summon(game.player.position, game.cam.yaw, 20, ${2 + (i % 3)}, true)`);
    await wait(1500);
    await fight(22);
  });
  // 4. a wolf pack on you
  await step('pack', async () => {
    await ev(`game.fauna.summonPack(game.player.position, 28, true, ${3 + (i % 2)})`);
    await wait(3000);
    await fight(14);
  });
  // 5. the menus: Kit → Skills → Journal → closed; the map; the pause menu
  await step('menus', async () => {
    await ev(`game.arms.equip(null, true)`);
    for (const k of ['KeyI', 'KeyK', 'KeyJ']) { await p.keyboard.press(k); await wait(700); }
    await p.keyboard.press('Escape'); await wait(500);
    if (await ev(`game.ui.modalOpen`)) throw new Error('Kit did not close on Escape');
    await p.keyboard.press('KeyM'); await wait(1200);
    await p.keyboard.press('Escape'); await wait(500);
    if (await ev(`game.ui.modalOpen`)) throw new Error('map did not close on Escape');
    await ev(`window.__realPause()`); await wait(1500);
    if (!(await ev(`game.ui.modalOpen`))) throw new Error('pause did not open');
    await p.keyboard.press('Escape'); await wait(500);
    if (await ev(`game.ui.modalOpen`)) throw new Error('pause did not close on Escape');
  });
  // 6. the four minigames, opened through the game (as an interactable would) and walked away from
  await step('minigames', async () => {
    const opens = [
      `game.ctx.ui.lockpick({ pins: 3, title: 'Soak lock', onBreak: () => false })`,
      `game.ctx.ui.keypad({ title: 'Soak keypad', code: '1234', hint: '' })`,
      `game.ctx.ui.circuit({ title: 'Soak board', difficulty: 1 })`,
      `game.ctx.ui.hack({ title: 'Soak box', host: 'SOAK', difficulty: 1, daemons: [{ id: 'a', name: 'A', blurb: 'a' }, { id: 'b', name: 'B', blurb: 'b' }] })`,
    ];
    for (const o of opens) {
      const hp0 = await ev(`game.state.data.health`);
      await ev(`(() => { window.__mg = ${o}; })()`);
      await wait(1300);
      if (!(await ev(`game.ui.minigameOpen`))) {
        // SPLICE drops you the moment you're hit (by design): a squad still shooting from the fight step
        if ((await ev(`game.state.data.health`)) < hp0) { log(`   ${o.slice(12, 30)} closed: hit while splicing (by design)`); continue; }
        throw new Error('minigame did not open: ' + o.slice(12, 30));
      }
      await p.keyboard.press('Escape');
      await wait(700);
      if (await ev(`game.ui.minigameOpen`)) { await ev(`game.ui.dismissInteraction()`); await wait(300); throw new Error('minigame ignored Escape: ' + o.slice(12, 30)); }
    }
  });
  // 7. the clock and the weather
  await step('weather', async () => {
    await ev(`game.atmo.hour = (game.atmo.hour + 7.3) % 24`);
    if (i % 3 === 1) await ev(`game.weather.rollIn()`);
    if (i % 3 === 2) await ev(`game.weather.auto()`);
    await wait(2000);
  });
  // 8. a death every 4th lap (down in the dust, wake at the camp, the pack left behind)
  if (i % 4 === 3) await step('death', async () => {
    await ev(`game.state.data.health = 0`);
    const woke = await until(`game.state.data.health > 0 && !game.player.frozen`, 12000);
    if (!woke) throw new Error('never woke at the camp');
    await ev(SETUP);
  });
  // 9. Quit to title and Continue every 5th lap
  if (i % 5 === 4) await step('quit+continue', async () => {
    await ev(`(() => { game.save(true); history.replaceState(null, '', '/play/?webgl'); game.toTitle(); })()`);
    await wait(6000);
    const clicked = await ev(`(() => { const b = [...document.querySelectorAll('#title button')].find((x) => /^\\s*Continue\\s*$/.test(x.textContent)); b?.click(); return !!b; })()`);
    if (!clicked) throw new Error('no Continue on the title');
    const back = await until(`game.mode === 'playing' && !!game.player`, 20000);
    if (!back) throw new Error('Continue never started the run');
    await wait(3000);
    await ev(SETUP);
  });
}

const rows = [];
rows.push(await sample(0));
let i = 0;
while (Date.now() - t0 < minutes * 60000) {
  await lap(i);
  i++;
  rows.push(await sample(i));
}
await b.close();

// ------------------------------------------------------------------ verdict
const after = rows.slice(2);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const checks = [];
const flat = (name, f, slack = 0) => {
  if (after.length < 2) return;
  const a = after.map(f), lo = Math.min(...a), hi = Math.max(...a);
  checks.push([`${name} flat after lap 2 (${lo}…${hi})`, hi - lo <= slack]);
};
flat('GL programs', (r) => r.gl.program);
flat('GL textures', (r) => r.gl.texture, 2);
flat('three geometries', (r) => r.geometries, 4);
flat('three textures', (r) => r.textures, 2);
flat('window/document listeners', (r) => r.winListeners, 2);
flat('live intervals', (r) => r.intervals, 1);
if (after.length >= 3) {
  const m = med(after.map((r) => r.heapMB));
  const last = after.slice(-3).map((r) => r.heapMB);
  checks.push([`heap: last three laps within 6% of the median ${m} MB (${last.join(', ')})`, last.every((v) => v < m * 1.06)]);
  const first = after[0], end = after[after.length - 1];
  const hours = (end.min - first.min) / 60;
  log(`heap trend: ${first.heapMB} → ${end.heapMB} MB over ${(hours * 60).toFixed(0)} min (${hours > 0 ? ((end.heapMB - first.heapMB) / hours).toFixed(1) : '?'} MB/h); objects ${first.objects} → ${end.objects}; dom ${first.domNodes} → ${end.domNodes}; audio alive ${first.audioAlive} → ${end.audioAlive}`);
}
if (after.length >= 3) {
  // audio nodes are only counted gone once collected, so this one is loose: a pile-up still shows
  const ma = med(after.map((r) => r.audioAlive)), mp = med(after.map((r) => r.playing));
  const la = after.slice(-3);
  checks.push([`audio nodes alive near the median ${ma} (${la.map((r) => r.audioAlive).join(', ')})`, la.every((r) => r.audioAlive <= ma * 1.25 + 60)]);
  checks.push([`audio sources playing near the median ${mp} (${la.map((r) => r.playing).join(', ')})`, la.every((r) => r.playing <= mp * 1.25 + 30)]);
  const md = med(after.map((r) => r.domNodes));
  checks.push([`DOM nodes near the median ${md} (${la.map((r) => r.domNodes).join(', ')})`, la.every((r) => r.domNodes <= md + 60)]);
}
// engine/release.ts and kit.ts report a write to a released geometry, or a batch rebuilt after its parts went
const rel = errors.filter((e) => /released/.test(e.m));
checks.push([`no writes to released vertex data (${rel.length})`, rel.length === 0]);
checks.push([`no page errors (${errors.length})`, errors.length === 0]);
checks.push([`every step ran (${issues.length} failed)`, issues.length === 0]);
for (const [n, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  [soak] ${n}`);
if (issues.length) console.log('step failures:\n  ' + [...new Set(issues)].slice(0, 20).join('\n  '));
if (errors.length) console.log('errors:\n  ' + [...new Set(errors.map((e) => e.m))].slice(0, 20).join('\n  '));
const ok = checks.every(([, v]) => v);
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
