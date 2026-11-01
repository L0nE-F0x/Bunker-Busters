// A rigged GLB's mesh, posed at bind, as OBJ + MTL + its colour map in one zip: what Mixamo's auto-rigger
// takes (it doesn't read GLB). The skinning is applied (Σ w · joint world · inverse bind), so the result is
// the A-pose the model was rigged in, in metres, +Y up, facing +Z.
//   node scripts/models/glb-to-obj.mjs Assets/Meshy_AI_Camp_Mara_Rigged.glb out/mara.zip
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readGlb, accessorNumbers } from './rig.mjs';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) { console.log('usage: glb-to-obj.mjs <in.glb> <out.zip>'); process.exit(1); }
const g = readGlb(src), J = g.json;

const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const trs = (n) => {
  if (n.matrix) return n.matrix.slice();
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
};
const parent = new Map();
J.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
const world = (i) => (parent.has(i) ? mul(world(parent.get(i)), trs(J.nodes[i])) : trs(J.nodes[i]));
const xf = (m, v, w = 1) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * w);

const lines = ['mtllib model.mtl'], tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'obj-'));
let base = 1, texFile = null;
J.nodes.forEach((node, ni) => {
  if (node.mesh == null) return;
  const skin = node.skin != null ? J.skins[node.skin] : null;
  const jm = skin ? (() => { const ibm = accessorNumbers(g, skin.inverseBindMatrices); return skin.joints.map((j, k) => mul(world(j), ibm.slice(k * 16, k * 16 + 16))); })() : null;
  const nodeM = world(ni);
  for (const p of J.meshes[node.mesh].primitives) {
    const P = accessorNumbers(g, p.attributes.POSITION), N = accessorNumbers(g, p.attributes.NORMAL), UV = accessorNumbers(g, p.attributes.TEXCOORD_0);
    const JI = skin ? accessorNumbers(g, p.attributes.JOINTS_0) : null, W = skin ? accessorNumbers(g, p.attributes.WEIGHTS_0) : null;
    const n = P.length / 3;
    for (let v = 0; v < n; v++) {
      const pos = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], nor = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
      let op = [0, 0, 0], on = [0, 0, 0];
      if (skin) {
        for (let k = 0; k < 4; k++) {
          const w = W[v * 4 + k]; if (!w) continue;
          const m = jm[JI[v * 4 + k]], a = xf(m, pos), b = xf(m, nor, 0);
          for (let c = 0; c < 3; c++) { op[c] += a[c] * w; on[c] += b[c] * w; }
        }
      } else { op = xf(nodeM, pos); on = xf(nodeM, nor, 0); }
      const l = Math.hypot(...on) || 1;
      lines.push(`v ${op.map((x) => x.toFixed(5)).join(' ')}`, `vn ${on.map((x) => (x / l).toFixed(4)).join(' ')}`, `vt ${UV[v * 2].toFixed(5)} ${(1 - UV[v * 2 + 1]).toFixed(5)}`);
    }
    const I = accessorNumbers(g, p.indices);
    lines.push('usemtl skin');
    for (let t = 0; t < I.length; t += 3) lines.push(`f ${[0, 1, 2].map((k) => { const i = I[t + k] + base; return `${i}/${i}/${i}`; }).join(' ')}`);
    base += n;
    const tex = J.materials?.[p.material]?.pbrMetallicRoughness?.baseColorTexture;
    if (tex && !texFile) {
      const im = J.images[J.textures[tex.index].source], bv = J.bufferViews[im.bufferView];
      texFile = 'texture' + (im.mimeType === 'image/png' ? '.png' : '.jpg');
      fs.writeFileSync(path.join(tmp, texFile), g.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
    }
  }
});
fs.writeFileSync(path.join(tmp, 'model.obj'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(tmp, 'model.mtl'), `newmtl skin\nKd 1 1 1\n${texFile ? `map_Kd ${texFile}\n` : ''}`);
const out = path.resolve(dst);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
execFileSync('zip', ['-q', '-j', out, ...fs.readdirSync(tmp).map((f) => path.join(tmp, f))]);
fs.rmSync(tmp, { recursive: true, force: true });
const ys = lines.filter((l) => l.startsWith('v ')).map((l) => +l.split(' ')[2]);
console.log(`${out}: ${base - 1} vertices, height ${(Math.max(...ys) - Math.min(...ys)).toFixed(2)} m, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
