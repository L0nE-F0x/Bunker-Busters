// Close-up screenshots of world props (cars, trees, grass, rocks, poles) for detail passes.
//
//   node scripts/dev/closeups.mjs out-dir [car tree grass rock pole wide]   (dev server must be running)
//
// Each shot teleports the player next to the nearest prop of that kind to spawn and looks at it.
import { launch, waitForGame } from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const [dir = 'closeups', ...want] = process.argv.slice(2);
const kinds = want.length ? want : ['car', 'tree', 'grass', 'rock', 'pole', 'wide'];
fs.mkdirSync(dir, { recursive: true });
const b = await launch();
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/GL Driver/.test(m.text())) console.log('[console.error]', m.text().slice(0, 300)); });
await p.goto(`${process.env.DEV_ORIGIN || 'http://localhost:5173'}/play/?webgl&autostart&q=${process.env.Q || 'high'}`);
await waitForGame(p);
await p.waitForTimeout(2500);

for (const kind of kinds) {
  const ok = await p.evaluate((kind) => {
    const g = window.game, V = g.player.position.constructor;
    g.atmo.hour = 9.5;
    // target point + camera offset
    const find = (name) => {
      let hit = null;
      g.props.group.traverse((o) => { if (o.name === name || o.name?.startsWith(name)) hit = hit ?? o; });
      return hit;
    };
    let tgt, back = 4.5, h = 0;
    if (kind === 'car' || kind === 'tree' || kind === 'pole') {
      const o = find({ car: 'cars', tree: 'trees', pole: 'poles' }[kind]);
      if (!o) return false;
      const meshes = [];
      o.traverse((c) => c.isMesh && meshes.push(c));
      const pos = meshes[0].geometry.attributes.position;
      // pick a vertex cluster near spawn-ish: the first vertex far from origin
      const s = g.spawnPoint ?? new V(-138, 0, 118);
      let best = null, bd = 1e18;
      for (let i = 0; i < pos.count; i += 37) {
        const x = pos.getX(i), z = pos.getZ(i);
        const d = (x - s.x) ** 2 + (z - s.z) ** 2;
        if (d < bd) { bd = d; best = [x, pos.getY(i), z]; }
      }
      tgt = new V(...best);
      back = { car: 5.5, tree: 6, pole: 7 }[kind];
      h = { car: 0.4, tree: 1.6, pole: 3 }[kind];
    } else if (kind === 'rock') {
      const r = g.props.rocks[2].all.find((r) => { const s = r.m.elements[5]; return s > 0.8 && s < 2; });
      tgt = new V(r.x, 0, r.z); back = 4; h = 0.3;
    } else if (kind === 'grass') {
      const m = g.scrub.mesh, e = new Float32Array(16);
      m.instanceMatrix.array.slice(0, 16).forEach((v, i) => (e[i] = v));
      tgt = new V(e[12], e[13], e[14]); back = 1.8; h = 0.2;
    } else if (kind === 'wide') {
      tgt = new V(-138, 0, 118); back = 0.01; h = 0;
    }
    tgt.y = g.hf.heightAt(tgt.x, tgt.z);
    const yaw = 0.7;
    const at = new V(tgt.x + Math.sin(yaw) * back, 0, tgt.z + Math.cos(yaw) * back);
    at.y = g.hf.heightAt(at.x, at.z);
    g.player.teleport(at);
    const eye = at.y + 1.55;
    g.cam.snap(yaw, kind === 'wide' ? 0.02 : Math.atan2(tgt.y + h - eye, back));
    return true;
  }, kind);
  if (!ok) { console.log('no', kind); continue; }
  await p.waitForTimeout(1800);
  const f = path.join(dir, `${kind}.png`);
  await p.screenshot({ path: f });
  console.log('saved', f);
}
await b.close();
