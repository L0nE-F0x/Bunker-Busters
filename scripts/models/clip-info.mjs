// List a GLB's clips: name, length and how far the Hips travel (root motion), to tell
// in-place loops from ones that walk off. node scripts/models/clip-info.mjs Assets/X.glb [...]
import { readGlb, accessorNumbers } from './rig.mjs';

for (const f of process.argv.slice(2)) {
  const g = readGlb(f);
  console.log('==', f.split('/').pop());
  for (const a of g.json.animations ?? []) {
    let dur = 0, hips = '';
    for (const ch of a.channels) {
      const s = a.samplers[ch.sampler];
      const t = accessorNumbers(g, s.input);
      dur = Math.max(dur, t[t.length - 1]);
      const node = g.json.nodes[ch.target.node];
      if (node?.name === 'Hips' && ch.target.path === 'translation') {
        const o = accessorNumbers(g, s.output), n = o.length / 3, e = (n - 1) * 3;
        hips = `hips Δ (${(o[e] - o[0]).toFixed(2)}, ${(o[e + 1] - o[1]).toFixed(2)}, ${(o[e + 2] - o[2]).toFixed(2)}) from (${o[0].toFixed(2)}, ${o[1].toFixed(2)}, ${o[2].toFixed(2)})`;
      }
    }
    console.log(`  ${a.name}  ${dur.toFixed(2)} s  ${hips}`);
  }
}
