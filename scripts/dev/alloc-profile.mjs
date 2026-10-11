// Where the game allocates per frame (headless, CDP sampling heap profiler): top sites by bytes.
//   node scripts/dev/alloc-profile.mjs [spotJs] [--secs 4] [--top 40]
import { launch, waitForGame } from './browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const spot = args[0] && !args[0].startsWith('--') ? args[0] : `const p = game.player.position.clone(); p.x = -232; p.z = -8; p.y = game.hf.heightAt(p.x, p.z) + 0.2; game.player.teleport(p); game.atmo.hour = 12; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); game.cam.snap(Math.atan2(30, 40), -0.05);`;
const b = await launch();
const p = await b.newPage({ viewport: { width: 480, height: 270 } });
await p.goto('http://localhost:5173/play/?webgl&autostart&q=high');
await waitForGame(p, 180000);
for (let i = 0; i < 100; i++) { if (await p.evaluate(() => window.game?.mode === 'playing' && !!window.game.player)) break; await p.waitForTimeout(300); }
await p.evaluate(`(async () => { const game = window.game; ${spot} })()`);
await p.waitForTimeout(2500);
const cdp = await p.context().newCDPSession(p);
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 1024, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
const f0 = await p.evaluate(() => window.game.frames);
await p.waitForTimeout(+opt('secs', 4) * 1000);
const f1 = await p.evaluate(() => window.game.frames);
const { profile } = await cdp.send('HeapProfiler.stopSampling');
await b.close();
const sites = new Map();
const walk = (n, stack) => {
  const cf = n.callFrame;
  const here = `${cf.functionName || '(anon)'} ${(cf.url.split('/').pop() || '').split('?')[0]}:${cf.lineNumber + 1}`;
  const st = [here, ...stack].slice(0, 3);
  if (n.selfSize) { const k = st.join(' < '); sites.set(k, (sites.get(k) ?? 0) + n.selfSize); }
  for (const c of n.children) walk(c, st);
};
walk(profile.head, []);
const frames = f1 - f0;
const tot = [...sites.values()].reduce((a, b) => a + b, 0);
console.log(`frames ${frames}; ${(tot / frames / 1024).toFixed(0)} KB/frame sampled`);
[...sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, +opt('top', 40)).forEach(([k, v]) => console.log((v / frames / 1024).toFixed(1).padStart(7), 'KB', k));
