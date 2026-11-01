// Shrink a game-ready GLB's geometry and animation data without touching how it looks (no deps):
//   - drops TANGENT (no material in the game uses a normal map)
//   - WEIGHTS_0 → normalized uint8 (each vertex still sums to exactly 1)
//   - TEXCOORD_n → normalized uint16 when every value is inside [0, 1]
//   - NORMAL → normalized int8, 4-byte stride (KHR_mesh_quantization, which three's GLTFLoader reads)
//   - rotation keyframes → normalized int16
// Positions, indices, inverse bind matrices, keyframe times and textures pass through untouched.
// It's idempotent: only float accessors are converted (and normals, when --smooth asks: built files too).
// prep-glb.mjs and build-glb.mjs call it last.
//
//   node scripts/models/slim-glb.mjs public/models/*.glb          (in place)
//   node scripts/models/slim-glb.mjs in.glb --out out.glb [--normals 8|16|float] [--smooth 60]
// --smooth N: smooth normals across the mesh's splits, creases sharper than N° kept (smoothNormals)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const COMP = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;
// SLIM_SKIP=weights,uv,rot leaves those as floats (for A/B checks)
const SKIP = new Set((process.env.SLIM_SKIP ?? '').split(','));

export function readGlb(b) {
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString());
  const binStart = 20 + jsonLen + 8;
  const bin = b.subarray(binStart, binStart + b.readUInt32LE(20 + jsonLen));
  return { json, bin };
}

export function writeGlb(json, body) {
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const bodyPad = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + bodyPad.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bodyPad.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, js, bh, bodyPad]);
}

/** Float values of a float accessor, tightly packed. */
function floats(json, bin, a) {
  const v = json.bufferViews[a.bufferView];
  const n = NUM[a.type], stride = v.byteStride || n * 4;
  const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Float32Array(a.count * n);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = bin.readFloatLE(start + i * stride + c * 4);
  return out;
}

/** Values of any accessor as floats (normalized integers scaled back to −1..1 / 0..1), tightly packed. */
function numbers(json, bin, a) {
  if (a.componentType === 5126) return floats(json, bin, a);
  const v = json.bufferViews[a.bufferView], n = NUM[a.type], sz = COMP[a.componentType];
  const stride = v.byteStride || n * sz, start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const read = { 5120: 'readInt8', 5121: 'readUInt8', 5122: 'readInt16LE', 5123: 'readUInt16LE', 5125: 'readUInt32LE' }[a.componentType];
  const max = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 1;
  const out = new Float32Array(a.count * n);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = Math.max(-1, bin[read](start + i * stride + c * sz) / max);
  return out;
}

/** Raw bytes of any accessor, tightly packed. */
function rawBytes(json, bin, a) {
  const v = json.bufferViews[a.bufferView];
  const el = COMP[a.componentType] * NUM[a.type];
  const stride = v.byteStride || el;
  const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  if (stride === el) return Buffer.from(bin.subarray(start, start + el * a.count));
  const out = Buffer.alloc(el * a.count);
  for (let i = 0; i < a.count; i++) bin.copy(out, i * el, start + i * stride, start + i * stride + el);
  return out;
}

function maxIndex(u32) {
  let m = 0;
  for (let i = 0; i < u32.length; i += 4) m = Math.max(m, u32.readUInt32LE(i));
  return m;
}

/**
 * Smooth normals across the mesh's splits. Meshy's exports split nearly every vertex (a UV seam or a
 * hard edge at ~98% of positions, each side with its own normal), so a 12k-triangle body shades as
 * facets, like a cut gem. Every vertex at one position takes the area-weighted mean of the faces round
 * that position that lie within `deg` of its own normal; creases sharper than that stay sharp.
 */
function smoothNormals(json, bin, prim, deg) {
  const P = floats(json, bin, json.accessors[prim.attributes.POSITION]);
  const N = numbers(json, bin, json.accessors[prim.attributes.NORMAL]);
  const ia = json.accessors[prim.indices];
  const I = ia.componentType === 5126 ? null : (() => {
    const raw = rawBytes(json, bin, ia), sz = COMP[ia.componentType], out = new Uint32Array(ia.count);
    for (let k = 0; k < ia.count; k++) out[k] = sz === 4 ? raw.readUInt32LE(k * 4) : sz === 2 ? raw.readUInt16LE(k * 2) : raw[k];
    return out;
  })();
  if (!I) return null;
  const nv = P.length / 3, nf = I.length / 3;
  const F = new Float32Array(nf * 3);
  for (let t = 0; t < nf; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    F[t * 3] = uy * vz - uz * vy; F[t * 3 + 1] = uz * vx - ux * vz; F[t * 3 + 2] = ux * vy - uy * vx; // length = 2 × area
  }
  const key = (v) => `${Math.round(P[v * 3] * 1e5)},${Math.round(P[v * 3 + 1] * 1e5)},${Math.round(P[v * 3 + 2] * 1e5)}`;
  const group = new Map(), gOf = new Int32Array(nv);
  for (let v = 0; v < nv; v++) { const k = key(v); let g = group.get(k); if (g === undefined) { g = group.size; group.set(k, g); } gOf[v] = g; }
  const faces = Array.from({ length: group.size }, () => []);
  for (let t = 0; t < nf; t++) for (let k = 0; k < 3; k++) { const g = gOf[I[t * 3 + k]], f = faces[g]; if (f[f.length - 1] !== t) f.push(t); }
  const cos = Math.cos((deg * Math.PI) / 180), out = new Float32Array(N.length);
  for (let v = 0; v < nv; v++) {
    const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2], nl = Math.hypot(nx, ny, nz) || 1;
    let sx = 0, sy = 0, sz = 0;
    for (const t of faces[gOf[v]]) {
      const fx = F[t * 3], fy = F[t * 3 + 1], fz = F[t * 3 + 2], fl = Math.hypot(fx, fy, fz);
      if (!fl || (fx * nx + fy * ny + fz * nz) / (fl * nl) < cos) continue;
      sx += fx; sy += fy; sz += fz;
    }
    const l = Math.hypot(sx, sy, sz);
    if (l) { out[v * 3] = sx / l; out[v * 3 + 1] = sy / l; out[v * 3 + 2] = sz / l; } else { out[v * 3] = nx / nl; out[v * 3 + 1] = ny / nl; out[v * 3 + 2] = nz / nl; }
  }
  return out;
}

export function slimGlb(input, { normals = 8, weightBits = 16, smooth = 0 } = {}) {
  const { json, bin } = readGlb(input);
  if ((json.accessors ?? []).some((a) => a.sparse)) throw new Error('sparse accessors are not supported');
  // smoothed normals by accessor (the tangents no longer match them: three derives its own)
  const smoothed = new Map();
  if (smooth) for (const m of json.meshes ?? []) for (const p of m.primitives) {
    const ai = p.attributes.NORMAL;
    if (ai == null || p.indices == null || smoothed.has(ai)) continue;
    const n = smoothNormals(json, bin, p, smooth);
    if (n) { smoothed.set(ai, n); delete p.attributes.TANGENT; }
  }
  const normalMapped = new Set((json.materials ?? []).map((m, i) => (m.normalTexture ? i : -1)).filter((i) => i >= 0));
  // what each accessor is for
  const role = new Map();
  for (const m of json.meshes ?? []) for (const p of m.primitives) {
    if (p.attributes.TANGENT != null && !normalMapped.has(p.material)) delete p.attributes.TANGENT;
    for (const [k, ai] of Object.entries(p.attributes)) role.set(ai, k);
    if (p.indices != null) role.set(p.indices, 'INDICES');
    for (const t of p.targets ?? []) for (const ai of Object.values(t)) role.set(ai, 'TARGET');
  }
  for (const an of json.animations ?? []) for (const ch of an.channels) {
    const s = an.samplers[ch.sampler];
    role.set(s.input, 'TIME');
    if (ch.target.path === 'rotation') role.set(s.output, 'ROTATION');
    else if (!role.has(s.output)) role.set(s.output, 'ANIM');
  }

  // re-encode each accessor still in use into its own view; images keep theirs
  const used = new Set();
  const walk = (x) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) {
      if (k === 'attributes' || k === 'targets') { for (const t of [v].flat()) for (const ai of Object.values(t)) used.add(ai); }
      else if (['indices', 'inverseBindMatrices', 'input', 'output'].includes(k) && typeof v === 'number') used.add(v);
      else walk(v);
    }
  };
  walk(json.meshes); walk(json.skins); walk(json.animations);

  const chunks = [];
  let off = 0;
  const views = [];
  const addView = (data, extra = {}) => {
    const pad = (4 - (off % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; }
    views.push({ buffer: 0, byteOffset: off, byteLength: data.length, ...extra });
    chunks.push(data);
    off += data.length;
    return views.length - 1;
  };
  let quantNormals = false;
  const accessors = [];
  const remap = new Map();
  (json.accessors ?? []).forEach((a, ai) => {
    if (!used.has(ai)) return;
    const r = role.get(ai);
    const isFloat = a.componentType === 5126;
    const na = { ...a };
    delete na.byteOffset;
    let data, extra = {};
    if (isFloat && !SKIP.has('weights') && r === 'WEIGHTS_0' && a.type === 'VEC4') {
      const f = floats(json, bin, a);
      const W16 = weightBits === 16, M = W16 ? 65535 : 255;
      data = Buffer.alloc(a.count * (W16 ? 8 : 4));
      for (let i = 0; i < a.count; i++) {
        const w = [0, 1, 2, 3].map((c) => Math.max(0, f[i * 4 + c]));
        const s = w[0] + w[1] + w[2] + w[3] || 1;
        const q = w.map((x) => Math.round((x / s) * M));
        // the rounding error goes to the biggest weight, so the four still sum to exactly 1
        const big = q.indexOf(Math.max(...q));
        q[big] += M - (q[0] + q[1] + q[2] + q[3]);
        for (let c = 0; c < 4; c++) if (W16) data.writeUInt16LE(q[c], (i * 4 + c) * 2); else data[i * 4 + c] = q[c];
      }
      Object.assign(na, { componentType: W16 ? 5123 : 5121, normalized: true });
      delete na.min; delete na.max;
      extra.target = ARRAY_BUFFER;
    } else if (isFloat && !SKIP.has('uv') && /^TEXCOORD_/.test(r ?? '') && floats(json, bin, a).every((x) => x >= 0 && x <= 1)) {
      const f = floats(json, bin, a);
      data = Buffer.alloc(f.length * 2);
      for (let i = 0; i < f.length; i++) data.writeUInt16LE(Math.round(f[i] * 65535), i * 2);
      Object.assign(na, { componentType: 5123, normalized: true });
      delete na.min; delete na.max;
      extra.target = ARRAY_BUFFER;
    } else if (isFloat && r === 'NORMAL' && normals === 'float' && smoothed.has(ai)) {
      data = Buffer.from(smoothed.get(ai).buffer);
      extra.target = ARRAY_BUFFER;
    } else if ((isFloat || smoothed.has(ai)) && r === 'NORMAL' && normals !== 'float') {
      const f = smoothed.get(ai) ?? floats(json, bin, a);
      const bits = Number(normals), bytes = bits / 8, stride = bits === 8 ? 4 : 8, max = bits === 8 ? 127 : 32767;
      data = Buffer.alloc(a.count * stride);
      for (let i = 0; i < a.count; i++) {
        const x = f[i * 3], y = f[i * 3 + 1], z = f[i * 3 + 2];
        const l = Math.hypot(x, y, z) || 1;
        [x, y, z].forEach((c, k) => {
          const v = Math.round((c / l) * max);
          if (bytes === 1) data.writeInt8(v, i * stride + k); else data.writeInt16LE(v, i * stride + k * 2);
        });
      }
      Object.assign(na, { componentType: bits === 8 ? 5120 : 5122, normalized: true });
      delete na.min; delete na.max;
      extra = { target: ARRAY_BUFFER, byteStride: stride };
      quantNormals = true;
    } else if (isFloat && !SKIP.has('rot') && r === 'ROTATION' && a.type === 'VEC4') {
      const f = floats(json, bin, a);
      data = Buffer.alloc(f.length * 2);
      for (let i = 0; i < f.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, f[i])) * 32767), i * 2);
      Object.assign(na, { componentType: 5122, normalized: true });
      delete na.min; delete na.max;
    } else if (r === 'INDICES' && a.componentType === 5125 && maxIndex(rawBytes(json, bin, a)) < 65535) {
      const src = rawBytes(json, bin, a);
      data = Buffer.alloc(a.count * 2);
      for (let i = 0; i < a.count; i++) data.writeUInt16LE(src.readUInt32LE(i * 4), i * 2);
      na.componentType = 5123;
      extra.target = ELEMENT_ARRAY_BUFFER;
    } else {
      data = rawBytes(json, bin, a);
      const el = COMP[a.componentType] * NUM[a.type];
      if (r === 'INDICES') extra.target = ELEMENT_ARRAY_BUFFER;
      else if (r && r !== 'TIME' && r !== 'ANIM' && r !== 'ROTATION' && r !== 'TARGET') {
        extra.target = ARRAY_BUFFER;
        if (el % 4) extra.byteStride = Math.ceil(el / 4) * 4; // vertex elements stay 4-byte aligned
      }
      if (extra.byteStride) {
        const padded = Buffer.alloc(a.count * extra.byteStride);
        for (let i = 0; i < a.count; i++) data.copy(padded, i * extra.byteStride, i * el, i * el + el);
        data = padded;
      }
    }
    na.bufferView = addView(data, extra);
    remap.set(ai, accessors.length);
    accessors.push(na);
  });
  // images (and anything else that points at a view directly)
  for (const im of json.images ?? []) {
    if (im.bufferView == null) continue;
    const v = json.bufferViews[im.bufferView];
    im.bufferView = addView(Buffer.from(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)));
  }
  const re = (ai) => remap.get(ai);
  for (const m of json.meshes ?? []) for (const p of m.primitives) {
    for (const k of Object.keys(p.attributes)) p.attributes[k] = re(p.attributes[k]);
    if (p.indices != null) p.indices = re(p.indices);
    for (const t of p.targets ?? []) for (const k of Object.keys(t)) t[k] = re(t[k]);
  }
  for (const s of json.skins ?? []) if (s.inverseBindMatrices != null) s.inverseBindMatrices = re(s.inverseBindMatrices);
  for (const an of json.animations ?? []) for (const s of an.samplers) { s.input = re(s.input); s.output = re(s.output); }
  json.accessors = accessors;
  json.bufferViews = views;
  json.buffers = [{ byteLength: off }];
  if (quantNormals) {
    for (const k of ['extensionsUsed', 'extensionsRequired']) {
      json[k] = [...new Set([...(json[k] ?? []), 'KHR_mesh_quantization'])];
    }
  }
  return writeGlb(json, Buffer.concat(chunks));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const out = opt('--out');
  const normals = opt('--normals') ?? 8;
  const smooth = Number(opt('--smooth') ?? 0);
  const weightBits = Number(opt('--weights') ?? 16);
  if (!args.length) { console.log('usage: slim-glb.mjs <in.glb>… [--out out.glb] [--normals 8|16|float]'); process.exit(1); }
  for (const f of args) {
    const src = fs.readFileSync(f);
    const dst = slimGlb(src, { normals: normals === 'float' ? 'float' : Number(normals), weightBits, smooth });
    fs.writeFileSync(out ?? f, dst);
    console.log(`${out ?? f}: ${(src.length / 1024).toFixed(0)} KB → ${(dst.length / 1024).toFixed(0)} KB`);
  }
}
