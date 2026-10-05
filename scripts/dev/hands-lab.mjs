// Contact sheet of first-person hand poses (needs the dev server). Iterate on Hands.ts with this.
//   node scripts/dev/hands-lab.mjs sheet.png "pose=idle" "pose=lockpick&look=engineer" "pose=idle&torch"
// Poses: see POSES in src/game/player/Hands.ts (plus "flat" = neutral rig check).
import { launch } from './browser.mjs';

const [out = 'hands.png', ...poses] = process.argv.slice(2);
if (!poses.length) poses.push('pose=idle', 'pose=lockpick', 'pose=empHold', 'pose=idle&torch');
const b = await launch();
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
const shots = [];
for (const q of poses) {
  await p.goto('http://localhost:5173/debug/hands.html?' + q);
  await p.waitForFunction(() => window.__done, null, { timeout: 30000 });
  await p.waitForTimeout(200);
  shots.push(await p.screenshot());
}
const sheet = await b.newPage({ viewport: { width: 1280, height: 400 * Math.ceil(shots.length / 2) } });
await sheet.setContent('<body style="margin:0;display:grid;grid-template-columns:640px 640px">' + shots.map((s, i) => `<div style="position:relative"><img src="data:image/png;base64,${s.toString('base64')}"><span style="position:absolute;left:8px;top:6px;color:#fff;font:14px monospace;background:#0008;padding:2px 6px">${poses[i]}</span></div>`).join('') + '</body>');
await sheet.screenshot({ path: out, fullPage: true });
console.log('saved', out);
await b.close();
