// Mixamo FBX → GLB (raw, for build-glb.mjs), converted in headless Chrome by debug/fbx2glb.ts. Needs
// `npm run dev`; the FBX files must sit under the project (Assets/ is fine: it isn't deployed).
//   node scripts/models/fbx-to-glb.mjs out.glb Assets/mixamo/mara/skin.fbx 1.68 [clip.fbx=role …]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../dev/browser.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ORIGIN = process.env.DEV_ORIGIN || `http://localhost:${process.env.BB_PORT || 5173}`;
const [dst, skin, height, ...rest] = process.argv.slice(2);
if (!dst || !skin || !height) { console.log('usage: fbx-to-glb.mjs <out.glb> <skin.fbx> <height m> [clip.fbx=role …]'); process.exit(1); }
const url = (f) => '/' + path.relative(ROOT, path.resolve(f)).split(path.sep).map(encodeURIComponent).join('/');
const clips = rest.map((a) => { const i = a.lastIndexOf('='); return [url(a.slice(0, i)), a.slice(i + 1)]; });
const b = await launch();
try {
  const p = await b.newPage();
  p.on('pageerror', (e) => console.error('page error:', e.message));
  await p.goto(`${ORIGIN}/debug/fbx2glb.html`, { waitUntil: 'load' });
  await p.waitForFunction(() => document.title === 'ready', { timeout: 60000 });
  const r = await p.evaluate(({ s, c, h }) => window.convert(s, c, h), { s: url(skin), c: clips, h: Number(height) });
  fs.writeFileSync(dst, Buffer.from(r.b64, 'base64'));
  console.log(`${dst}: ${(fs.statSync(dst).size / 1e6).toFixed(2)} MB, ${r.bones.length} bones, scale ×${r.scale.toFixed(4)} (measured ${r.measured.toFixed(2)})`);
  for (const c of r.clips) console.log('  ' + c);
} finally {
  await b.close();
}
