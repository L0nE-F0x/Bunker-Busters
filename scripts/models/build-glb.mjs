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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

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

// animations: merged from the clip files by node name
const nodeByName = new Map(J.nodes.map((n, i) => [n.name, i]));
J.animations = [];
for (const spec of clipSpecs) {
  const [file, list] = spec.split(':');
  const g = readGlb(file);
  const want = list ? new Map(list.split(',').map((s) => { const [a, b] = s.split('='); return [a, b ?? a]; })) : null;
  for (const a of g.json.animations ?? []) {
    const short = a.name.includes('|') ? a.name.split('|')[1] : a.name;
    const key = want ? [...want.keys()].find((k) => k === a.name || k === short) : short;
    if (!key || (want && !want.has(key)) || /clip0/.test(a.name)) continue;
    const name = want ? want.get(key) : short;
    const samplers = [], channels = [];
    for (const c of a.channels) {
      const nodeName = g.json.nodes[c.target.node].name;
      const ni = nodeByName.get(nodeName);
      if (ni === undefined) continue;
      if (c.target.path === 'scale') continue;
      if (c.target.path === 'translation' && nodeName !== 'Hips') continue;
      const s = a.samplers[c.sampler];
      samplers.push({ input: copyAccessor(g, s.input, file), output: copyAccessor(g, s.output, file), interpolation: s.interpolation });
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
fs.writeFileSync(dst, Buffer.concat([header, jh, js, bh, bodyPad]));
console.log(`${dst}: ${(fs.statSync(dst).size / 1e6).toFixed(2)} MB, ${J.animations?.length ?? 0} clips${J.animations ? ' (' + J.animations.map((x) => x.name).join(', ') + ')' : ''}`);
