// Pure-Node anatomical hand relaxation / weapon-grip sculpt for Meshy mitt hands (no Blender).
// Meshy exports bake hands completely flat and splayed like paddles. This softly flexes the
// distal fingers at MCP/PIP knuckles toward the palm side (`mittFrame().palm`), gently cascades
// index → pinky, de-splays wide gaps, and opposes the thumb without tearing wrist weights.
// Smooth normals are recomputed afterwards by slimGlb(..., { smooth }).
import { accessorNumbers, rigInfo, mittFrame, vsub, vdot } from './rig.mjs';
import { readGlb as readGlbBuf, writeGlb } from './slim-glb.mjs';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Rotate 2D coordinates `(a, b)` about pivot `(pa, pb)` by `ang` (radians, +a → +b). */
function rot2(a, b, pa, pb, ang) {
  const da = a - pa, db = b - pb, c = Math.cos(ang), s = Math.sin(ang);
  return [pa + da * c - db * s, pb + da * s + db * c];
}

/**
 * Gently curl hands on an uncompressed GLB buffer (`mode`: `'relax'` for NPCs, `'grip'` for Kade).
 * `palmHint` disambiguates the flat mitt's palm normal (`[0, 1, 0.3]` for Meshy A-pose, `[0, -1, 0]` for Helper).
 */
export function sculptHands(glbBuf, mode = 'relax', palmHint = [0, 1, 0.3]) {
  if (mode !== 'relax' && mode !== 'grip') return glbBuf;
  const g = readGlbBuf(glbBuf);
  const { json, bin } = g;
  const rig = rigInfo(json);
  const skin = json.skins?.[0];
  const mesh = json.meshes?.[0];
  if (!skin || !mesh) return glbBuf;

  const prim = mesh.primitives[0];
  const posAcc = json.accessors[prim.attributes.POSITION];
  if (!posAcc || posAcc.componentType !== 5126 || posAcc.type !== 'VEC3') return glbBuf;

  const J = accessorNumbers(g, prim.attributes.JOINTS_0);
  const W = accessorNumbers(g, prim.attributes.WEIGHTS_0);
  const posView = json.bufferViews[posAcc.bufferView];
  const binCopy = Buffer.from(bin);
  const P = new Float32Array(
    binCopy.buffer,
    binCopy.byteOffset + (posView.byteOffset ?? 0) + (posAcc.byteOffset ?? 0),
    posAcc.count * 3,
  );

  const isGrip = mode === 'grip';
  const a1Max = isGrip ? 0.56 : 0.28; // MCP flexion (~16° relax, ~32° grip)
  const a2Max = isGrip ? 0.62 : 0.28; // PIP/DIP flexion (~16° relax, ~35° grip)
  const aThumbMax = isGrip ? 0.56 : 0.28;
  const splayPull = isGrip ? 0.16 : 0.10;

  for (const side of ['Left', 'Right']) {
    const hName = side + 'Hand';
    const node = rig.byName.get(hName);
    if (node === undefined) continue;
    const jn = skin.joints.indexOf(node);
    if (jn < 0) continue;

    // Build orthonormal hand frame using raw vertex data
    let m;
    try { m = mittFrame(g, rig, hName, palmHint); } catch { continue; }
    if (!m.n || m.n < 12) continue;

    const wrist = rig.restPos[node];
    const thumbSign = side === 'Left' ? -1 : 1; // verified Left=-side, Right=+side
    const pts = [];
    for (let i = 0; i < posAcc.count; i++) {
      let wHand = 0;
      for (let k = 0; k < 4; k++) if (J[i * 4 + k] === jn) wHand += W[i * 4 + k];
      if (wHand < 0.72) continue;
      const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
      const d = vsub(p, wrist);
      if (Math.hypot(...d) > 0.24) continue;
      const u = vdot(d, m.long), v = vdot(d, m.palm), s = vdot(d, m.side);
      if (u <= 0.015) continue;
      pts.push({ i, w: smoothstep(0.72, 0.95, wHand), u, v, s });
    }
    if (pts.length < 12) continue;

    const sortedU = pts.map((p) => p.u).sort((a, b) => a - b);
    const uMax = sortedU[Math.min(sortedU.length - 1, Math.floor(sortedU.length * 0.98))] || 0.16;
    const sortedAbsS = pts.map((p) => Math.abs(p.s)).sort((a, b) => a - b);
    const sHalf = sortedAbsS[Math.min(sortedAbsS.length - 1, Math.floor(sortedAbsS.length * 0.92))] || 0.045;
    const mid = pts.filter((p) => p.u > uMax * 0.25 && p.u < uMax * 0.55);
    const vMid = mid.reduce((a, b) => a + b.v, 0) / (mid.length || 1);

    const u1 = uMax * 0.44;
    const u2Start = uMax * 0.68;

    for (const pt of pts) {
      const t = clamp(pt.u / uMax, 0, 1.15);
      // Smooth web blend between thumb and main four fingers
      const thumbS = pt.s * thumbSign;
      const isThumb = smoothstep(sHalf * 0.30, sHalf * 0.56, thumbS) * (1 - smoothstep(0.56, 0.74, t));
      const isFinger = 1 - isThumb;

      let u = pt.u, v = pt.v, s = pt.s;

      if (isFinger > 1e-4 && t > 0.38) {
        // Gentle cascade: pinky curls slightly deeper than index
        const ulnar = clamp(-thumbS / (sHalf || 0.04), -1, 1);
        const cascade = 1 + 0.16 * ulnar;
        // Step 1: MCP knuckle curl
        const a1 = a1Max * cascade * smoothstep(0.38, 0.68, t) * isFinger * pt.w;
        [u, v] = rot2(u, v, u1, vMid, a1);
        // Step 2: PIP/DIP distal curl around where u2 landed after a1
        if (t > 0.60) {
          const [p2u, p2v] = rot2(u2Start, vMid, u1, vMid, a1);
          const a2 = a2Max * cascade * smoothstep(0.60, 0.95, t) * isFinger * pt.w;
          [u, v] = rot2(u, v, p2u, p2v, a2);
        }
        // Subtle inward convergence of splayed gaps toward finger plane centre
        s *= 1 - splayPull * smoothstep(0.42, 0.94, t) * isFinger * pt.w;
      }

      if (isThumb > 1e-4 && t > 0.16) {
        const curT = smoothstep(0.16, 0.58, t) * isThumb * pt.w;
        const sPivot = thumbSign * sHalf * 0.36;
        const [nsAbs, nv] = rot2(thumbS, v, thumbSign * sPivot, vMid, aThumbMax * curT);
        s = nsAbs * thumbSign;
        v = nv;
      }

      const np = [
        wrist[0] + m.long[0] * u + m.palm[0] * v + m.side[0] * s,
        wrist[1] + m.long[1] * u + m.palm[1] * v + m.side[1] * s,
        wrist[2] + m.long[2] * u + m.palm[2] * v + m.side[2] * s,
      ];
      P[pt.i * 3] = np[0];
      P[pt.i * 3 + 1] = np[1];
      P[pt.i * 3 + 2] = np[2];
    }
  }

  // Recompute POSITION bounds
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < posAcc.count; i++) {
    for (let k = 0; k < 3; k++) {
      const x = P[i * 3 + k];
      if (x < lo[k]) lo[k] = x;
      if (x > hi[k]) hi[k] = x;
    }
  }
  posAcc.min = lo;
  posAcc.max = hi;
  // Drop stale TANGENTs if any (slimGlb / three derives clean tangents from smoothed normals)
  if (prim.attributes.TANGENT !== undefined) delete prim.attributes.TANGENT;

  return writeGlb(json, binCopy);
}
