// Screenshot the running dev server (npm run dev) headlessly, optionally scripting the game first.
//
//   node scripts/dev/shot.mjs "http://localhost:5173/play/?webgl&autostart" out.png \
//     --wait 3000 --eval "game.atmo.hour = 22" --wait 2000 --shot night.png --fps
//
// Steps run in order: --wait <ms> | --eval "<js>" | --key <KeyCode>[:holdMs] | --shot <file> | --fps
// The final screenshot goes to the 2nd positional argument. Console errors are printed.
// Useful game handles: window.game (Game), game.player, game.cam (snap(yaw,pitch)), game.hands,
// game.garage (b.origin, outsidePoint, drone), game.atmo.hour, game.state (flags/items), game.ui.
import { launch, waitForGame, measureFps } from './browser.mjs';

const [url, out = 'shot.png', ...rest] = process.argv.slice(2);
if (!url) { console.log('usage: node scripts/dev/shot.mjs <url> <out.png> [--wait ms] [--eval js] [--key Code[:ms]] [--shot f] [--fps] [--size WxH]'); process.exit(1); }
let size = [1280, 720];
const si = rest.indexOf('--size');
if (si >= 0) { size = rest[si + 1].split('x').map(Number); rest.splice(si, 2); }

const b = await launch();
const p = await b.newPage({ viewport: { width: size[0], height: size[1] } });
p.on('console', (m) => { if (m.type() === 'error' && !/GL Driver/.test(m.text())) console.log('[console.error]', m.text().slice(0, 300)); });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(url);
if (url.includes('/play')) console.log('mode:', await waitForGame(p));
for (let i = 0; i < rest.length; i++) {
  const [flag, val] = [rest[i], rest[i + 1]];
  if (flag === '--wait') { await p.waitForTimeout(+val); i++; }
  else if (flag === '--eval') { await p.evaluate(val); i++; }
  else if (flag === '--key') { const [code, ms] = val.split(':'); await p.keyboard.down(code); await p.waitForTimeout(+ms || 100); await p.keyboard.up(code); i++; }
  else if (flag === '--shot') { await p.screenshot({ path: val }); console.log('saved', val); i++; }
  else if (flag === '--fps') console.log('fps:', await measureFps(p));
}
await p.screenshot({ path: out });
console.log('saved', out);
await b.close();
