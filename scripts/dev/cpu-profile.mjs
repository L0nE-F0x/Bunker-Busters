// CPU profile of the running game at a spot (headless): top functions by self time.
//   node scripts/dev/cpu-profile.mjs [spotJs] [--secs 4] [--top 40] [--size 480x270] [--by file]
// spotJs runs in the page first (game = window.game); default: Dry Creek at noon.
import { launch, waitForGame } from './browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const spot = args[0] && !args[0].startsWith('--') ? args[0] : `const p = game.player.position.clone(); p.x = -232; p.z = -8; p.y = game.hf.heightAt(p.x, p.z) + 0.2; game.player.teleport(p); game.atmo.hour = 12; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); game.cam.snap(Math.atan2(30, 40), -0.05);`;
const [W, H] = opt('size', '480x270').split('x').map(Number);
const b = await launch();
const p = await b.newPage({ viewport: { width: W, height: H } });
await p.goto('http://localhost:5173/play/?webgl&autostart&q=high');
await waitForGame(p, 180000);
for (let i = 0; i < 100; i++) { if (await p.evaluate(() => window.game?.mode === 'playing' && !!window.game.player)) break; await p.waitForTimeout(300); }
await p.evaluate(`(async () => { const game = window.game; ${spot} })()`);
await p.waitForTimeout(2500);
const cdp = await p.context().newCDPSession(p);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
await cdp.send('Profiler.start');
const f0 = await p.evaluate(() => window.game.frames);
await p.waitForTimeout(+opt('secs', 4) * 1000);
const f1 = await p.evaluate(() => window.game.frames);
const { profile } = await cdp.send('Profiler.stop');
await b.close();
const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas;
const hits = new Map();
profile.samples.forEach((id, i) => hits.set(id, (hits.get(id) ?? 0) + (dt[i] ?? 0)));
const total = [...hits.values()].reduce((a, b) => a + b, 0) / 1000;
for (const [id, us] of hits) {
  const n = byId.get(id); const cf = n.callFrame;
  const file = (cf.url.split('/').pop() || '(native)').split('?')[0];
  const key = opt('by') === 'file' ? file : `${cf.functionName || '(anon)'} ${file}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + us / 1000);
}
const frames = f1 - f0;
console.log(`frames ${frames}, sampled ${total.toFixed(0)} ms; per frame ms (self):`);
[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, +opt('top', 40)).forEach(([k, ms]) => console.log((ms / frames).toFixed(3).padStart(7), k));
