// Rig math shared by the model scripts (no dependencies): GLB reading, quaternions as [x, y, z, w]
// arrays, a rig's rest pose in model space, and the mitt frame of a Meshy hand (its shape: Meshy rigs
// have no finger bones, and each auto-rig rests its Hand joint at a different roll, so the mesh is
// the only thing that says which way a palm faces).
import fs from 'node:fs';

export function readGlb(f) {
  const b = fs.readFileSync(f);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString());
  const binStart = 20 + jsonLen + 8;
  const bin = b.subarray(binStart, binStart + b.readUInt32LE(20 + jsonLen));
  return { json, bin };
}
export const COMP = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
export const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
/** Tightly packed bytes of an accessor (handles strided views). */
export function accessorBytes(g, ai) {
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
/** An accessor as plain numbers (normalized integers mapped to 0..1 / −1..1). */
export function accessorNumbers(g, ai) {
  const a = g.json.accessors[ai];
  const b = accessorBytes(g, ai);
  const T = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
  const raw = new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  if (!a.normalized || a.componentType === 5126) return Float32Array.from(raw);
  const div = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType];
  return Float32Array.from(raw, (x) => Math.max(x / div, -1));
}

// ---- quaternions and vectors
export const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qinv = (a) => [-a[0], -a[1], -a[2], a[3]];
export function qslerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = d < 0 ? (d = -d, b.map((v) => -v)) : b;
  if (d > 0.9995) { const r = a.map((v, i) => v + (bb[i] - v) * t); const l = Math.hypot(...r); return r.map((v) => v / l); }
  const th = Math.acos(d), s = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / s, kb = Math.sin(t * th) / s;
  return a.map((v, i) => v * ka + bb[i] * kb);
}
/** v rotated by q. */
export function qrot(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
export const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vnorm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
/** The shortest rotation taking unit vector a onto unit vector b. */
export function qFromUnitVectors(a, b) {
  const r = vdot(a, b) + 1;
  let q;
  if (r < 1e-6) q = Math.abs(a[0]) > Math.abs(a[2]) ? [-a[1], a[0], 0, 0] : [0, -a[2], a[1], 0];
  else { const c = vcross(a, b); q = [c[0], c[1], c[2], r]; }
  const l = Math.hypot(...q);
  return q.map((x) => x / l);
}
/** Rotation whose columns are the orthonormal axes x, y, z. */
export function qFromBasis(x, y, z) {
  const [m11, m21, m31] = x, [m12, m22, m32] = y, [m13, m23, m33] = z;
  const tr = m11 + m22 + m33;
  let q;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); q = [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s]; }
  else if (m11 > m22 && m11 > m33) { const s = 2 * Math.sqrt(1 + m11 - m22 - m33); q = [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s]; }
  else if (m22 > m33) { const s = 2 * Math.sqrt(1 + m22 - m11 - m33); q = [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s]; }
  else { const s = 2 * Math.sqrt(1 + m33 - m11 - m22); q = [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s]; }
  return vnorm4(q);
}
const vnorm4 = (q) => { const l = Math.hypot(...q) || 1; return q.map((x) => x / l); };
/** Rotation angle of q (radians, 0..π). */
export const qangle = (q) => 2 * Math.acos(Math.min(1, Math.abs(q[3])));

// ---- the rest pose in model space (positions in metres: the Armature's 0.01 scale is applied)
export function rigInfo(json) {
  const parent = new Map();
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
  const restLocal = json.nodes.map((n) => n.rotation ?? [0, 0, 0, 1]);
  const restT = json.nodes.map((n) => n.translation ?? [0, 0, 0]);
  const restS = json.nodes.map((n) => (n.scale ? n.scale[0] : 1));
  const order = [];
  const seen = new Set();
  const visit = (i) => { if (seen.has(i)) return; const p = parent.get(i); if (p !== undefined) visit(p); seen.add(i); order.push(i); };
  json.nodes.forEach((_, i) => visit(i));
  const restWorld = [], restPos = [], restScale = [];
  for (const i of order) {
    const p = parent.get(i);
    if (p === undefined) { restWorld[i] = restLocal[i]; restPos[i] = restT[i]; restScale[i] = restS[i]; continue; }
    restWorld[i] = qmul(restWorld[p], restLocal[i]);
    const t = qrot(restWorld[p], restT[i].map((x) => x * restScale[p]));
    restPos[i] = [restPos[p][0] + t[0], restPos[p][1] + t[1], restPos[p][2] + t[2]];
    restScale[i] = restScale[p] * restS[i];
  }
  const byName = new Map(json.nodes.map((n, i) => [n.name, i]));
  return { parent, restLocal, restT, restWorld, restPos, order, byName };
}

/** Eigenvectors of a symmetric 3×3 (Jacobi), sorted by eigenvalue, largest first. */
function eig3(A) {
  const a = A.map((r) => r.slice());
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-20) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  return [0, 1, 2].map((i) => ({ val: a[i][i], vec: [V[0][i], V[1][i], V[2][i]] })).sort((x, y) => y.val - x.val);
}

/**
 * The mitt of `handName` at rest, in model space: `long` (wrist → the mitt's centroid: it continues
 * the forearm within ~30° on every rig, where the most-spread axis doesn't, since spread fingers and
 * a thumb make a mitt nearly as wide as long), `palm` (its thinnest axis, square to `long`, on the
 * side of `palmHint`: a mitt's shape doesn't say which face is the palm), `side` = long × palm.
 * Points: vertices weighted > 0.9 to the hand within 25 cm of the wrist (skips sleeves skinned to it).
 */
export function mittFrame(g, rig, handName, palmHint = [0, -1, 0]) {
  const node = rig.byName.get(handName);
  const jn = g.json.skins[0].joints.indexOf(node);
  const prim = g.json.meshes[0].primitives[0];
  const P = accessorNumbers(g, prim.attributes.POSITION);
  const J = accessorNumbers(g, prim.attributes.JOINTS_0);
  const W = accessorNumbers(g, prim.attributes.WEIGHTS_0);
  const wrist = rig.restPos[node];
  const pts = [];
  for (let i = 0; i < P.length / 3; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (J[i * 4 + k] === jn) w += W[i * 4 + k];
    const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    if (w > 0.9 && Math.hypot(...vsub(p, wrist)) < 0.25) pts.push(p);
  }
  const c = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / pts.length;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) { const d = vsub(p, c); for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) C[r][s] += d[r] * d[s] / pts.length; }
  const long = vnorm(vsub(c, wrist));
  let palm = eig3(C)[2].vec;
  palm = vnorm(vsub(palm, long.map((x) => x * vdot(palm, long))));
  if (vdot(palm, palmHint) < 0) palm = palm.map((x) => -x);
  return { c, long, palm, side: vcross(long, palm), n: pts.length };
}

/** The rotation of a frame with columns (long, palm, side). */
export const mittQuat = (m) => qFromBasis(m.long, m.palm, m.side);
