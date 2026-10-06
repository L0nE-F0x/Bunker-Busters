// Phone emulation for the touch build (npm run dev must be running). Like shot.mjs, plus touch steps.
//
//   node scripts/dev/mobile-shot.mjs "http://localhost:5173/play/?webgl" out.png \
//     --wait 2000 --tap 420,200 --drag 120,300,120,200,800 --shot walk.png
//
// Steps run in order:
//   --wait <ms> | --eval "<js>" | --shot <file> | --fps
//   --tap x,y                      single tap (CSS px)
//   --drag x1,y1,x2,y2[,ms]        one finger: press, move, release
//   --hold x,y,ms                  press and hold in place
//   --twin "x1,y1,x2,y2;x3,y3,x4,y4[;ms]"   two fingers at once (stick + look)
// --size WxH (default 844x390, an iPhone 14 / Pixel-class phone in landscape), --dpr N (default 3),
// --portrait swaps the size. The page gets an Android Chrome user agent, touch and isMobile.
import { launch, waitForGame, measureFps } from './browser.mjs';

const [url, out = 'mobile.png', ...rest] = process.argv.slice(2);
if (!url) { console.log('usage: node scripts/dev/mobile-shot.mjs <url> <out.png> [steps…]'); process.exit(1); }
const take = (flag) => { const i = rest.indexOf(flag); if (i < 0) return null; const v = rest[i + 1]; rest.splice(i, 2); return v; };
let size = (take('--size') ?? '844x390').split('x').map(Number);
const dpr = Number(take('--dpr') ?? 3);
const pi = rest.indexOf('--portrait');
if (pi >= 0) { rest.splice(pi, 1); size = [size[1], size[0]]; }

const b = await launch();
const p = await b.newPage({
  viewport: { width: size[0], height: size[1] }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
});
const cdp = await p.context().newCDPSession(p);
p.on('console', (m) => { if (m.type() === 'error' && !/GL Driver/.test(m.text())) console.log('[console.error]', m.text().slice(0, 300)); });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(url);
if (url.includes('/play')) console.log('mode:', await waitForGame(p));

const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
/** Fingers move from a to b together over `ms`, in ~60 Hz steps. */
async function gesture(paths, ms) {
  await touch('touchStart', paths.map((q) => [q[0], q[1]]));
  const n = Math.max(2, Math.round(ms / 16));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    await touch('touchMove', paths.map((q) => [q[0] + (q[2] - q[0]) * t, q[1] + (q[3] - q[1]) * t]));
    await p.waitForTimeout(16);
  }
  await touch('touchEnd', []);
}

for (let i = 0; i < rest.length; i++) {
  const [flag, val] = [rest[i], rest[i + 1]];
  const nums = () => val.split(',').map(Number);
  if (flag === '--wait') { await p.waitForTimeout(+val); i++; }
  else if (flag === '--eval') { console.log('eval →', await p.evaluate(val)); i++; }
  else if (flag === '--tap') { const [x, y] = nums(); await touch('touchStart', [[x, y]]); await p.waitForTimeout(60); await touch('touchEnd', []); i++; }
  else if (flag === '--drag') { const [x1, y1, x2, y2, ms = 600] = nums(); await gesture([[x1, y1, x2, y2]], ms); i++; }
  else if (flag === '--hold') { const [x, y, ms] = nums(); await touch('touchStart', [[x, y]]); await p.waitForTimeout(ms); await touch('touchEnd', []); i++; }
  else if (flag === '--twin') { const parts = val.split(';'); const ms = parts.length > 2 ? +parts[2] : 800; await gesture(parts.slice(0, 2).map((s) => s.split(',').map(Number)), ms); i++; }
  else if (flag === '--shot') { await p.screenshot({ path: val }); console.log('saved', val); i++; }
  else if (flag === '--fps') console.log('fps:', await measureFps(p));
}
await p.screenshot({ path: out });
console.log('saved', out);
await b.close();
