import * as THREE from 'three/webgpu';

/**
 * Wrists and hands for the Meshy rigs (townsfolk and contractors). The rigs have no forearm twist
 * bone and no finger bones, so:
 * - a clip's (or a solver's) whole forearm roll lands on the Hand joint, and the skin between the
 *   forearm and the mitt wrings like a candy wrapper. `WristTwist` moves part of the hand's roll
 *   about the forearm into the forearm itself (the hand ends where it was going to be) and clamps
 *   what's left;
 * - only the mesh says which way a palm faces (each auto-rig rests its Hand joint at its own roll,
 *   up to ~60° apart). `mittFrame` measures a hand's shape at bind.
 */

const _d = new THREE.Quaternion(), _t = new THREE.Quaternion(), _s = new THREE.Quaternion(), _r = new THREE.Quaternion();
const _id = new THREE.Quaternion();
const DEG = Math.PI / 180;

export class WristTwist {
  private bind: THREE.Quaternion;
  private bindInv: THREE.Quaternion;
  /** The forearm's own axis (elbow → wrist) in forearm space, and the same axis in the hand's bind frame. */
  private axisF: THREE.Vector3;
  private axisH: THREE.Vector3;
  /** Roll (radians) the last `apply` found on the hand, before it was spread (tests). */
  lastTwist = 0;

  /** `handBind`: the hand's rotation relative to its forearm at bind; `handPos`: its offset there. */
  constructor(handBind: THREE.Quaternion, handPos: THREE.Vector3) {
    this.bind = handBind.clone();
    this.bindInv = handBind.clone().invert();
    this.axisF = handPos.clone().normalize();
    this.axisH = this.axisF.clone().applyQuaternion(this.bindInv);
  }

  /**
   * Rewrites `fore` (the forearm's rotation, in whatever frame it's held: local or world) and `hand`
   * (the hand's rotation relative to the forearm) so `k` of the hand's roll about the forearm goes
   * into the forearm. What the hand keeps is clamped to `maxTwist` of roll and `maxSwing` of bend
   * (degrees). With nothing to clamp, the hand's final orientation doesn't change.
   */
  apply(fore: THREE.Quaternion, hand: THREE.Quaternion, k = 0.5, maxTwist = 50, maxSwing = 70) {
    // the hand's change since bind, in its bind frame: twist (about the forearm) · swing (a bend)
    const dev = _d.copy(this.bindInv).multiply(hand);
    if (dev.w < 0) dev.set(-dev.x, -dev.y, -dev.z, -dev.w);
    const a = this.axisH;
    const theta = 2 * Math.atan2(dev.x * a.x + dev.y * a.y + dev.z * a.z, dev.w);
    this.lastTwist = theta;
    const swing = _s.copy(_t.setFromAxisAngle(a, theta).invert()).multiply(dev);
    if (swing.w < 0) swing.set(-swing.x, -swing.y, -swing.z, -swing.w);
    const bend = 2 * Math.acos(Math.min(1, swing.w));
    if (bend > maxSwing * DEG) swing.copy(_r.slerpQuaternions(_id, swing, (maxSwing * DEG) / bend));
    const keep = THREE.MathUtils.clamp(theta * (1 - k), -maxTwist * DEG, maxTwist * DEG);
    fore.multiply(_r.setFromAxisAngle(this.axisF, theta * k));
    hand.copy(this.bind).multiply(_t.setFromAxisAngle(a, keep)).multiply(swing);
  }
}

/** A mitt's frame in its Hand bone's space (the bone's units: cm on a Meshy rig). */
export interface Mitt {
  /** Centroid of the mitt. */
  c: THREE.Vector3;
  /** Wrist → fingertips. */
  long: THREE.Vector3;
  /** Out of the palm. */
  palm: THREE.Vector3;
  /** long × palm. */
  side: THREE.Vector3;
}

const _p = new THREE.Vector3(), _inv = new THREE.Matrix4();

/**
 * The shape of `hand`'s mitt at bind (the mesh must be in its bind pose, matrices current), as
 * scripts/models/rig.mjs measures it: the vertices weighted > 0.9 to it within 25 cm of the wrist
 * (sleeves skinned to the hand stay out). Long axis: wrist → their centroid (it continues the
 * forearm; the most-spread axis doesn't, a spread hand being nearly as wide as long). Palm: their
 * thinnest axis, on the side of `palmHint` (model space): a mitt's shape doesn't say which face it is.
 */
export function mittFrame(mesh: THREE.SkinnedMesh, hand: THREE.Bone, palmHint: THREE.Vector3): Mitt | null {
  const bi = mesh.skeleton.bones.indexOf(hand);
  if (bi < 0) return null;
  const g = mesh.geometry;
  const pos = g.attributes.position as THREE.BufferAttribute, si = g.attributes.skinIndex as THREE.BufferAttribute, sw = g.attributes.skinWeight as THREE.BufferAttribute;
  const wrist = hand.getWorldPosition(new THREE.Vector3());
  _inv.copy(hand.matrixWorld).invert();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bi) w += sw.getComponent(i, k);
    if (w <= 0.9) continue;
    _p.fromBufferAttribute(pos, i);
    mesh.applyBoneTransform(i, _p);
    _p.applyMatrix4(mesh.matrixWorld);
    if (_p.distanceTo(wrist) < 0.25) pts.push(_p.clone().applyMatrix4(_inv));
  }
  if (pts.length < 20) return null;
  const c = new THREE.Vector3();
  for (const p of pts) c.addScaledVector(p, 1 / pts.length);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z];
    for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) C[r][s] += (d[r] * d[s]) / pts.length;
  }
  const long = c.clone().normalize(); // the bone's origin is the wrist
  const palm = new THREE.Vector3(...eig3(C)[2]);
  palm.addScaledVector(long, -palm.dot(long)).normalize();
  if (palm.dot(palmHint.clone().transformDirection(_inv)) < 0) palm.negate();
  return { c, long, palm, side: new THREE.Vector3().crossVectors(long, palm).normalize() };
}

/** Eigenvectors of a symmetric 3×3 (Jacobi), largest eigenvalue first. */
function eig3(A: number[][]): [number, number, number][] {
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
      const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = cs * x - sn * y; a[k][q] = sn * x + cs * y; }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = cs * x - sn * y; a[q][k] = sn * x + cs * y; }
      for (let k = 0; k < 3; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = cs * x - sn * y; V[k][q] = sn * x + cs * y; }
    }
  }
  return [0, 1, 2].map((i) => ({ val: a[i][i], vec: [V[0][i], V[1][i], V[2][i]] as [number, number, number] }))
    .sort((x, y) => y.val - x.val).map((e) => e.vec);
}
