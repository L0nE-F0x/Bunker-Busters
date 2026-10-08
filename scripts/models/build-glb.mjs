// Build one compact, game-ready GLB from Meshy exports: a rigged (or static) base file, optionally
// with the animation clips of one or more companion files merged in by bone NAME.
//
//   node scripts/models/build-glb.mjs public/models/x.glb Assets/X_Rigged.glb \
//        [--clips Assets/X_Animations.glb[:Idle,Talk_with_Hands_Open]] [--clips Assets/X_Walking_Basic.glb:walking_man=Walk]
//        [--size 1024] [--q 4] [--maps base|all]
//
// What it does (no dependencies; ffmpeg for the textures):
//   - drops the base's own clips (Meshy rigs carry an empty `clip0`), then merges the named clips
//     (all, or a comma list; `src=dst` renames). Channels bind by node name, never index order.
//   - drops every `.scale` channel and every translation channel except the Hips' (Meshy bakes
//     constant ones on all 24 joints) — about half the animation payload.
//   - `--maps base` (default) keeps only the colour map; `all` keeps normal + metal/rough too.
//   - strips emissive and material extensions (Meshy wires the colour map into emission on some
//     exports), re-encodes images to JPEG at `--size`², and repacks only what's still referenced.
//   - finally slim-glb.mjs: no tangents, quantized weights/UVs/normals/rotations (--no-slim skips it)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { slimGlb } from './slim-glb.mjs';

const args = process.argv.slice(2);
const [dst, baseFile] = args;
if (!dst || !baseFile) { console.log('usage: build-glb.mjs <out.glb> <base.glb> [--clips f[:a,b=c]]… [--size N] [--q 2..8] [--maps base|all]'); process.exit(1); }
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const size = Number(opt('--size', 2048)), q = Number(opt('--q', 4)), maps = opt('--maps', 'base');
const clipSpecs = args.flatMap((a, i) => (a === '--clips' ? [args[i + 1]] : []));

function readGlb(f) {
  const b = fs.readFileSync(f);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString());
  const binStart = 20 + jsonLen + 8;
  const bin = b.subarray(binStart, binStart + b.readUInt32LE(20 + jsonLen));
  return { json, bin };
}
const COMP = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
/** Tightly packed bytes of an accessor (handles strided views). */
function accessorBytes(g, ai) {
  const a = g.json.accessors[ai];
  const v = g.json.bufferViews[a.bufferView];
  const el = COMP[a.componentType] * NUM[a.type];
  const stride = v.byteStride || el;
  const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  if (stride === el) return Buffer.from(g.bin.subarray(start, start + el * a.count));
  const out = Buffer.alloc(el * a.count);
  for (let i = 0; i < a.count; i++) g.bin.copy(out, i * el, start + i * stride, start + i * stride + el);
  return out;
}

const base = readGlb(baseFile);
const J = base.json;

// ---- the output: new accessors/views/images built up as we go
const out = { accessors: [], bufferViews: [], images: [], chunks: [], off: 0 };
function addView(data, target) {
  const pad = (4 - (out.off % 4)) % 4;
  if (pad) { out.chunks.push(Buffer.alloc(pad)); out.off += pad; }
  const view = { buffer: 0, byteOffset: out.off, byteLength: data.length };
  if (target) view.target = target;
  out.chunks.push(data);
  out.off += data.length;
  out.bufferViews.push(view);
  return out.bufferViews.length - 1;
}
const accMap = new Map(); // `${file}:${index}` → new accessor index
function copyAccessor(g, ai, tag, target) {
  const key = `${tag}:${ai}`;
  if (accMap.has(key)) return accMap.get(key);
  const a = { ...g.json.accessors[ai] };
  delete a.byteOffset;
  delete a.sparse;
  a.bufferView = addView(accessorBytes(g, ai), target);
  out.accessors.push(a);
  accMap.set(key, out.accessors.length - 1);
  return out.accessors.length - 1;
}

// meshes + skins of the base
for (const m of J.meshes ?? []) for (const p of m.primitives) {
  for (const k of Object.keys(p.attributes)) p.attributes[k] = copyAccessor(base, p.attributes[k], 'b', 34962);
  if (p.indices !== undefined) p.indices = copyAccessor(base, p.indices, 'b', 34963);
  delete p.targets;
}
for (const s of J.skins ?? []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = copyAccessor(base, s.inverseBindMatrices, 'b');

// materials: colour map only (default), no emission, no extensions
for (const m of J.materials ?? []) {
  delete m.emissiveTexture; delete m.emissiveFactor; delete m.extensions;
  if (maps === 'base') { delete m.normalTexture; delete m.occlusionTexture; if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.metallicRoughnessTexture; }
  m.pbrMetallicRoughness = { ...m.pbrMetallicRoughness, metallicFactor: 0, roughnessFactor: 0.9 };
}
delete J.extensionsUsed; delete J.extensionsRequired;
// textures/images still referenced, re-encoded
const usedTex = new Set();
for (const m of J.materials ?? []) {
  const pb = m.pbrMetallicRoughness ?? {};
  for (const t of [pb.baseColorTexture, pb.metallicRoughnessTexture, m.normalTexture, m.occlusionTexture]) if (t) usedTex.add(t.index);
}
const texMap = new Map(), imgMap = new Map(), newTex = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glb-'));
for (const ti of [...usedTex].sort((a, b) => a - b)) {
  const t = J.textures[ti];
  if (!imgMap.has(t.source)) {
    const im = J.images[t.source];
    const v = J.bufferViews[im.bufferView];
    const raw = base.bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    const inF = path.join(tmp, `i${t.source}`), outF = path.join(tmp, `o${t.source}.jpg`);
    fs.writeFileSync(inF, raw);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', inF, '-vf', `scale=${size}:${size}:flags=lanczos`, '-q:v', String(q), outF]);
    out.images.push({ mimeType: 'image/jpeg', bufferView: addView(fs.readFileSync(outF)) });
    imgMap.set(t.source, out.images.length - 1);
  }
  newTex.push({ ...t, source: imgMap.get(t.source) });
  texMap.set(ti, newTex.length - 1);
}
fs.rmSync(tmp, { recursive: true, force: true });
for (const m of J.materials ?? []) {
  const pb = m.pbrMetallicRoughness ?? {};
  for (const t of [pb.baseColorTexture, pb.metallicRoughnessTexture, m.normalTexture, m.occlusionTexture]) if (t) t.index = texMap.get(t.index);
}
J.textures = newTex;
J.images = out.images;
if (!newTex.length) { delete J.textures; delete J.images; delete J.samplers; }


// ---- retargeting a clip between two Meshy rigs. Each rig is auto-rigged separately, so the same bone
// can rest at a very different local rotation (Mara's Head is 133° from Sol's); copying local
// rotations then bends necks and twists arms. Instead: play the clip on its own skeleton, take each
// bone's world-space change from its rest pose, apply that change to the target's rest pose, and
// convert back to local rotations.
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (a) => [-a[0], -a[1], -a[2], a[3]];
function qslerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = d < 0 ? (d = -d, b.map((v) => -v)) : b;
  if (d > 0.9995) { const r = a.map((v, i) => v + (bb[i] - v) * t); const l = Math.hypot(...r); return r.map((v) => v / l); }
  const th = Math.acos(d), s = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / s, kb = Math.sin(t * th) / s;
  return a.map((v, i) => v * ka + bb[i] * kb);
}
function rigInfo(json) {
  const parent = new Map();
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
  const restLocal = json.nodes.map((n) => n.rotation ?? [0, 0, 0, 1]);
  const order = [];
  const seen = new Set();
  const visit = (i) => { if (seen.has(i)) return; const p = parent.get(i); if (p !== undefined) visit(p); seen.add(i); order.push(i); };
  json.nodes.forEach((_, i) => visit(i));
  const restWorld = [];
  for (const i of order) { const p = parent.get(i); restWorld[i] = p === undefined ? restLocal[i] : qmul(restWorld[p], restLocal[i]); }
  const byName = new Map(json.nodes.map((n, i) => [n.name, i]));
  return { parent, restLocal, restWorld, order, byName };
}
function restDiffers(a, b) {
  for (const [name, i] of a.byName) {
    const j = b.byName.get(name);
    if (j === undefined || !name) continue;
    const x = a.restLocal[i], y = b.restLocal[j];
    if (Math.abs(x[0] * y[0] + x[1] * y[1] + x[2] * y[2] + x[3] * y[3]) < 0.9998) return true;
  }
  return false;
}
function floats(g, ai) { const b = accessorBytes(g, ai); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); }
function sampler(times, vals, interp) {
  return (t) => {
    let i = 0;
    while (i < times.length - 1 && times[i + 1] <= t) i++;
    const q = (k) => [vals[k * 4], vals[k * 4 + 1], vals[k * 4 + 2], vals[k * 4 + 3]];
    if (interp === 'STEP' || i >= times.length - 1 || t <= times[0]) return q(t <= times[0] ? 0 : i);
    return qslerp(q(i), q(i + 1), (t - times[i]) / (times[i + 1] - times[i]));
  };
}
/** Rotation channels of animation `a` (in file `g`, rig `src`) retargeted onto the base rig `dst`. */
function retargetRotations(g, a, src, dst, file) {
  const rot = new Map(); // source node index → sampler fn
  let grid = null;
  for (const c of a.channels) {
    if (c.target.path !== 'rotation') continue;
    const s = a.samplers[c.sampler];
    const times = floats(g, s.input);
    rot.set(c.target.node, sampler(times, floats(g, s.output), s.interpolation));
    if (s.interpolation !== 'STEP' && (!grid || times.length > grid.length)) grid = times;
  }
  if (!grid) return { samplers: [], channels: [] };
  const bones = [...rot.keys()].map((si) => ({ si, ti: dst.byName.get(g.json.nodes[si].name) })).filter((b) => b.ti !== undefined);
  const outVals = new Map(bones.map((b) => [b.ti, new Float32Array(grid.length * 4)]));
  grid.forEach((t, k) => {
    // source world rotations at t (FK through every ancestor, animated or at rest)
    const sw = [];
    for (const i of src.order) {
      const local = rot.has(i) ? rot.get(i)(t) : src.restLocal[i];
      const p = src.parent.get(i);
      sw[i] = p === undefined ? local : qmul(sw[p], local);
    }
    // target world = (source world change since rest) · target rest world; then back to local
    const tw = [];
    for (const i of dst.order) {
      const name = dst_name(i);
      const si = src.byName.get(name);
      const p = dst.parent.get(i);
      if (si !== undefined && rot.has(si)) tw[i] = qmul(qmul(sw[si], qinv(src.restWorld[si])), dst.restWorld[i]);
      else tw[i] = p === undefined ? dst.restLocal[i] : qmul(tw[p], dst.restLocal[i]);
      const o = outVals.get(i);
      if (o) { const local = p === undefined ? tw[i] : qmul(qinv(tw[p]), tw[i]); o.set(local, k * 4); }
    }
  });
  function dst_name(i) { return J.nodes[i].name; }
  const timeAcc = (() => {
    const bytes = Buffer.from(grid.buffer.slice(0));
    out.accessors.push({ componentType: 5126, count: grid.length, type: 'SCALAR', min: [grid[0]], max: [grid[grid.length - 1]], bufferView: addView(bytes) });
    return out.accessors.length - 1;
  })();
  const samplers = [], channels = [];
  for (const [ti, vals] of outVals) {
    out.accessors.push({ componentType: 5126, count: grid.length, type: 'VEC4', bufferView: addView(Buffer.from(vals.buffer)) });
    samplers.push({ input: timeAcc, output: out.accessors.length - 1, interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: ti, path: 'rotation' } });
  }
  return { samplers, channels };
}

// animations: merged from the clip files by node name
const nodeByName = new Map(J.nodes.map((n, i) => [n.name, i]));
J.animations = [];
for (const spec of clipSpecs) {
  const [file, list] = spec.split(':');
  const g = readGlb(file);
  const hipsY = (j) => Math.abs(j.nodes.find((n) => n.name === 'Hips')?.translation?.[1] ?? 1);
  const hipRatio = hipsY(J) / hipsY(g.json);
  if (Math.abs(hipRatio - 1) > 0.01) console.log(`  ${path.basename(file)}: hips ×${hipRatio.toFixed(3)}`);
  const dstRig = rigInfo(J), srcRig = rigInfo(g.json);
  const retarget = restDiffers(srcRig, dstRig);
  if (retarget) console.log(`  ${path.basename(file)}: retargeted (rest poses differ)`);
  const want = list ? new Map(list.split(',').map((s) => { const [a, b] = s.split('='); return [a, b ?? a]; })) : null;
  for (const a of g.json.animations ?? []) {
    const short = a.name.includes('|') ? a.name.split('|')[1] : a.name;
    const key = want ? [...want.keys()].find((k) => k === a.name || k === short) : short;
    if (!key || (want && !want.has(key)) || /clip0/.test(a.name)) continue;
    const name = want ? want.get(key) : short;
    const samplers = [], channels = [];
    if (retarget) {
      const r = retargetRotations(g, a, srcRig, dstRig, file);
      samplers.push(...r.samplers);
      channels.push(...r.channels);
    }
    for (const c of a.channels) {
      if (retarget && c.target.path === 'rotation') continue;
      const nodeName = g.json.nodes[c.target.node].name;
      const ni = nodeByName.get(nodeName);
      if (ni === undefined) continue;
      if (c.target.path === 'scale') continue;
      if (c.target.path === 'translation' && nodeName !== 'Hips') continue;
      const s = a.samplers[c.sampler];
      let output = copyAccessor(g, s.output, file);
      // a clip borrowed from another character: its hip motion scaled to this body's hip height
      if (c.target.path === 'translation' && Math.abs(hipRatio - 1) > 0.01) {
        const acc = out.accessors[output] = { ...out.accessors[output] };
        const bytes = Buffer.from(accessorBytes(g, s.output));
        const f = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
        for (let i = 0; i < f.length; i++) f[i] *= hipRatio;
        acc.bufferView = addView(bytes);
        if (acc.min) acc.min = acc.min.map((v) => v * hipRatio);
        if (acc.max) acc.max = acc.max.map((v) => v * hipRatio);
      }
      samplers.push({ input: copyAccessor(g, s.input, file), output, interpolation: s.interpolation });
      channels.push({ sampler: samplers.length - 1, target: { node: ni, path: c.target.path } });
    }
    J.animations.push({ name, samplers, channels });
  }
}
if (!J.animations.length) delete J.animations;

J.accessors = out.accessors;
J.bufferViews = out.bufferViews;
const body = Buffer.concat(out.chunks);
J.buffers = [{ byteLength: body.length }];
let js = Buffer.from(JSON.stringify(J));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const bodyPad = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + bodyPad.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(bodyPad.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, args.includes('--no-slim') ? Buffer.concat([header, jh, js, bh, bodyPad]) : slimGlb(Buffer.concat([header, jh, js, bh, bodyPad])));
console.log(`${dst}: ${(fs.statSync(dst).size / 1e6).toFixed(2)} MB, ${J.animations?.length ?? 0} clips${J.animations ? ' (' + J.animations.map((x) => x.name).join(', ') + ')' : ''}`);
