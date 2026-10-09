// Build one compact, game-ready GLB from Meshy exports: a rigged (or static) base file, optionally
// with the animation clips of one or more companion files merged in by bone NAME.
//
//   node scripts/models/build-glb.mjs public/models/x.glb Assets/X_Rigged.glb \
//        [--clips Assets/X_Animations.glb[:Idle,Talk_with_Hands_Open]] [--clips Assets/X_Walking_Basic.glb:walking_man=Walk]
//        [--mirror Assets/Y_Animations.glb:Chair_Sit_Idle_M=idle_m] [--size 1024] [--q 4] [--maps base|all]
//
// What it does (no dependencies; ffmpeg for the textures):
//   - drops the base's own clips (Meshy rigs carry an empty `clip0`), then merges the named clips
//     (all, or a comma list; `src=dst` renames). Channels bind by node name, never index order.
//     Each clip records the library motion it came from in its extras (`src`), so a game can tell
//     mirrored and borrowed copies of one motion apart from different motions.
//   - a clip from another character's file is retargeted (their rest poses differ); `--mirror` adds
//     a left-right mirror image of a clip (from any file, this character's own included). See
//     `retargetRotations` below.
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
import { readGlb, accessorBytes, qmul, qinv, qslerp, rigInfo, mittFrame, mittQuat, qFromUnitVectors, vsub, vnorm } from './rig.mjs';

const args = process.argv.slice(2);
const [dst, baseFile] = args;
if (!dst || !baseFile) { console.log('usage: build-glb.mjs <out.glb> <base.glb> [--clips f[:a,b=c]]… [--mirror f:a=b]… [--size N] [--q 2..8] [--maps base|all]'); process.exit(1); }
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const size = Number(opt('--size', 2048)), q = Number(opt('--q', 4)), maps = opt('--maps', 'base');
const clipSpecs = args.flatMap((a, i) => (a === '--clips' || a === '--mirror' ? [{ spec: args[i + 1], mirror: a === '--mirror' }] : []));

const base = readGlb(baseFile);
const J = base.json;
// (the base as read, for measuring its mitts: the build rewrites J's accessors as it goes)
const base0 = readGlb(baseFile);

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
//
// The rest poses themselves differ too: arms rest 8–35° apart between rigs and mitts up to ~60°,
// so the same change applied to two rests lands the limbs that far apart (Pip's drinking hand missed
// her face). So the target's rest is first turned onto the source's: limbs by the shortest arc from
// the target's bone direction (joint → child joint) to the source's, hands by their mitt frames (a
// mitt's shape: rig.mjs mittFrame), spine, neck and head as they are. Target world at t:
//   (source world(t) · source rest⁻¹) · align · target rest
//
// Mirroring (`--mirror`) is the same machinery: each bone follows its opposite (Left↔Right), and the
// change and the source's rest directions are reflected across the body's midplane (x → −x; a
// rotation (x, y, z, w) becomes (x, −y, −z, w)). World changes are mirrored, not local tracks: Meshy
// bone frames aren't mirror-symmetric.
const CHILD = { Shoulder: 'Arm', Arm: 'ForeArm', ForeArm: 'Hand', UpLeg: 'Leg', Leg: 'Foot', Foot: 'ToeBase' };
const swapSide = (n) => (n.startsWith('Left') ? 'Right' + n.slice(4) : n.startsWith('Right') ? 'Left' + n.slice(5) : n);
const mirrorQ = (q) => [q[0], -q[1], -q[2], q[3]];
const mirrorV = (v) => [-v[0], v[1], v[2]];
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
function restDiffers(a, b) {
  for (const [name, i] of a.byName) {
    const j = b.byName.get(name);
    if (j === undefined || !name) continue;
    const x = a.restLocal[i], y = b.restLocal[j];
    if (Math.abs(x[0] * y[0] + x[1] * y[1] + x[2] * y[2] + x[3] * y[3]) < 0.9998) return true;
  }
  return false;
}
const deg = (q) => (2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180) / Math.PI;
/**
 * World rotations (per target node) that turn the target's rest onto the source's (mirrored if
 * `mirror`): limbs by direction, hands by mitt frame, the rest as they are.
 */
function restAlign(g, src, dst, mirror) {
  const S = new Map();
  const log = [];
  for (const [name, ti] of dst.byName) {
    const sname = mirror ? swapSide(name) : name;
    const si = src.byName.get(sname);
    if (si === undefined) continue;
    const part = name.replace(/^(Left|Right)/, '');
    if (part === 'Hand') {
      const ms = mittFrame(g, src, sname);
      const s = mirror ? { long: mirrorV(ms.long), palm: mirrorV(ms.palm) } : ms;
      s.side = [s.long[1] * s.palm[2] - s.long[2] * s.palm[1], s.long[2] * s.palm[0] - s.long[0] * s.palm[2], s.long[0] * s.palm[1] - s.long[1] * s.palm[0]];
      const mt = mittFrame(base0, rigInfo(base0.json), name, s.palm);
      const q = qmul(mittQuat(s), qinv(mittQuat(mt)));
      S.set(ti, q);
      log.push(`${name} ${deg(q).toFixed(0)}°`);
    } else if (CHILD[part]) {
      const side = name.slice(0, name.length - part.length);
      const tc = dst.byName.get(side + CHILD[part]), sc = src.byName.get(sname.slice(0, sname.length - part.length) + CHILD[part]);
      if (tc === undefined || sc === undefined) continue;
      const dt = vnorm(vsub(dst.restPos[tc], dst.restPos[ti]));
      let ds = vnorm(vsub(src.restPos[sc], src.restPos[si]));
      if (mirror) ds = mirrorV(ds);
      const q = qFromUnitVectors(dt, ds);
      S.set(ti, q);
      if (part !== 'Foot') log.push(`${name} ${deg(q).toFixed(0)}°`);
    }
  }
  return { S, log };
}
/** Rotation channels of animation `a` (in file `g`, rig `src`) retargeted (or mirrored) onto the base rig `dst`. */
function retargetRotations(g, a, src, dst, align, mirror) {
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
  const srcOf = (ti) => src.byName.get(mirror ? swapSide(J.nodes[ti].name) : J.nodes[ti].name);
  const bones = [...dst.byName.values()].filter((ti) => { const si = srcOf(ti); return si !== undefined && rot.has(si); });
  const outVals = new Map(bones.map((ti) => [ti, new Float32Array(grid.length * 4)]));
  grid.forEach((t, k) => {
    // source world rotations at t (FK through every ancestor, animated or at rest)
    const sw = [];
    for (const i of src.order) {
      const local = rot.has(i) ? rot.get(i)(t) : src.restLocal[i];
      const p = src.parent.get(i);
      sw[i] = p === undefined ? local : qmul(sw[p], local);
    }
    // target world = (source world change since rest) · rest alignment · target rest world; then back to local
    const tw = [];
    for (const i of dst.order) {
      const si = srcOf(i);
      const p = dst.parent.get(i);
      if (si !== undefined && rot.has(si)) {
        let d = qmul(sw[si], qinv(src.restWorld[si]));
        if (mirror) d = mirrorQ(d);
        const S = align.get(i);
        tw[i] = qmul(S ? qmul(d, S) : d, dst.restWorld[i]);
      } else tw[i] = p === undefined ? dst.restLocal[i] : qmul(tw[p], dst.restLocal[i]);
      const o = outVals.get(i);
      if (o) { const local = p === undefined ? tw[i] : qmul(qinv(tw[p]), tw[i]); o.set(local, k * 4); }
    }
  });
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
const dstRig = rigInfo(J);
for (const { spec, mirror } of clipSpecs) {
  const [file, list] = spec.split(':');
  const g = readGlb(file);
  const hipsY = (j) => Math.abs(j.nodes.find((n) => n.name === 'Hips')?.translation?.[1] ?? 1);
  const hipRatio = hipsY(J) / hipsY(g.json);
  if (Math.abs(hipRatio - 1) > 0.01) console.log(`  ${path.basename(file)}: hips ×${hipRatio.toFixed(3)}`);
  const srcRig = rigInfo(g.json);
  const retarget = mirror || restDiffers(srcRig, dstRig);
  let align = new Map();
  if (retarget) {
    const r = restAlign(g, srcRig, dstRig, mirror);
    align = r.S;
    console.log(`  ${path.basename(file)}: ${mirror ? 'mirrored' : 'retargeted (rest poses differ)'}; rest aligned: ${r.log.join(', ')}`);
  }
  const want = list ? new Map(list.split(',').map((s) => { const [a, b] = s.split('='); return [a, b ?? a]; })) : null;
  for (const a of g.json.animations ?? []) {
    const short = a.name.includes('|') ? a.name.split('|')[1] : a.name;
    const key = want ? [...want.keys()].find((k) => k === a.name || k === short) : short;
    if (!key || (want && !want.has(key)) || /clip0/.test(a.name)) continue;
    const name = want ? want.get(key) : short;
    const samplers = [], channels = [];
    if (retarget) {
      const r = retargetRotations(g, a, srcRig, dstRig, align, mirror);
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
      // a clip borrowed from another character: its hip motion scaled to this body's hip height;
      // mirrored: across the midplane (the Armature has no rotation: x is the body's left)
      const scale = c.target.path === 'translation' && Math.abs(hipRatio - 1) > 0.01;
      const flip = c.target.path === 'translation' && mirror;
      if (scale || flip) {
        const acc = out.accessors[output] = { ...out.accessors[output] };
        const bytes = Buffer.from(accessorBytes(g, s.output));
        const f = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
        const k = scale ? hipRatio : 1;
        for (let i = 0; i < f.length; i++) f[i] *= k * (flip && i % 3 === 0 ? -1 : 1);
        acc.bufferView = addView(bytes);
        const lo = acc.min?.map((v) => v * k), hi = acc.max?.map((v) => v * k);
        if (lo && hi) {
          if (flip) [lo[0], hi[0]] = [-hi[0], -lo[0]];
          acc.min = lo;
          acc.max = hi;
        }
      }
      samplers.push({ input: copyAccessor(g, s.input, file), output, interpolation: s.interpolation });
      channels.push({ sampler: samplers.length - 1, target: { node: ni, path: c.target.path } });
    }
    J.animations.push({ name, samplers, channels, extras: { src: short } });
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
