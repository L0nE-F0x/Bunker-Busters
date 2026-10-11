import * as THREE from 'three/webgpu';

/**
 * Feet on the ground for the Meshy rigs (wolves, coyotes, contractors). A clip is authored on a
 * flat floor; the game's ground isn't flat, and gaits re-timed or re-scaled from a clip don't land
 * where the clip's did. So after a pose is sampled, each foot's sole (two points measured on the
 * mesh at bind: heel and toe) is put at the ground height under it plus the clip's own lift (a swing
 * stays a swing). The body drops or rises to the foot that needs it most, and each leg's two upper
 * bones fold or open (two-bone IK, in the plane they already bend in) to put the rest where they go.
 * The foot itself keeps the orientation the clip gave it.
 *
 * Everything works on world matrices and rotates bones about world axes at their joints, so the
 * rigs' bone axes never matter (like `turn()` in wolfSkin / npcSkin).
 */

export interface Leg {
  /** Hip/shoulder joint, knee/elbow, ankle/wrist. */
  upper: THREE.Bone;
  lower: THREE.Bone;
  end: THREE.Bone;
  /** Sole points (heel, toe) in `end`'s local space (or in `soleOn[i]`'s, a toe bone). */
  sole: THREE.Vector3[];
  soleOn?: (THREE.Bone | undefined)[];
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3();
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _p = new THREE.Vector3();
const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _endQ = new THREE.Quaternion(), _m = new THREE.Matrix4();

/**
 * Sole points of a foot, from the mesh at bind: of the vertices weighted mostly to `end` (or any of
 * `alsoBones`), the lowest band's rearmost and foremost (along `fwd`, model space), as `end`-local
 * points. The model's matrices must be current and at bind.
 */
export function measureSole(mesh: THREE.SkinnedMesh, end: THREE.Bone, fwd: THREE.Vector3, alsoBones: THREE.Bone[] = []) {
  const bones = mesh.skeleton.bones;
  const want = new Set([end, ...alsoBones].map((b) => bones.indexOf(b)).filter((i) => i >= 0));
  const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
  mesh.skeleton.update();
  const pts: THREE.Vector3[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < si.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (want.has(si.getComponent(i, k))) w += sw.getComponent(i, k);
    if (w < 0.5) continue;
    mesh.getVertexPosition(i, v);
    pts.push(v.clone().applyMatrix4(mesh.matrixWorld));
  }
  if (!pts.length) return [end.getWorldPosition(new THREE.Vector3())].map((p) => end.worldToLocal(p));
  const low = Math.min(...pts.map((p) => p.y));
  const band = pts.filter((p) => p.y < low + 0.015);
  let heel = band[0], toe = band[0];
  for (const p of band) {
    if (p.dot(fwd) < heel.dot(fwd)) heel = p;
    if (p.dot(fwd) > toe.dot(fwd)) toe = p;
  }
  // a little in from the extremes (the outermost vertices are the rounded edge, not the tread)
  const mid = heel.clone().add(toe).multiplyScalar(0.5);
  return [heel.clone().lerp(mid, 0.25), toe.clone().lerp(mid, 0.25)].map((p) => end.worldToLocal(p.setY(low)));
}

/** The lowest sole point of `leg` in world space, now (`end`'s matrixWorld must be current). */
export function soleWorld(leg: Leg, out: THREE.Vector3) {
  let best = Infinity;
  for (let i = 0; i < leg.sole.length; i++) {
    _p.copy(leg.sole[i]).applyMatrix4((leg.soleOn?.[i] ?? leg.end).matrixWorld);
    if (_p.y < best) { best = _p.y; out.copy(_p); }
  }
  return out;
}

/**
 * How far (m) `leg`'s ankle would fall short of reaching a spot (`dx`, `dy`, `dz`) from where it is,
 * with the leg opened to `straight` of its full length (0: it can reach).
 */
export function shortfall(leg: Leg, dy: number, dx = 0, dz = 0, straight = 0.97) {
  const A = _a.setFromMatrixPosition(leg.upper.matrixWorld);
  const B = _b.setFromMatrixPosition(leg.lower.matrixWorld);
  const C = _c.setFromMatrixPosition(leg.end.matrixWorld);
  const reach = (A.distanceTo(B) + B.distanceTo(C)) * straight;
  _t.copy(C);
  _t.x += dx; _t.y += dy; _t.z += dz;
  return Math.max(0, A.distanceTo(_t) - reach);
}

/** Rotate `bone` by `angle` about world `axis` at its joint, and refresh its subtree. */
function turn(bone: THREE.Bone, axis: THREE.Vector3, angle: number) {
  if (Math.abs(angle) < 1e-6) return;
  _pq.setFromRotationMatrix(_m.extractRotation(bone.parent!.matrixWorld));
  _q.setFromAxisAngle(axis, angle).multiply(_pq);
  bone.quaternion.premultiply(_pq.invert().multiply(_q));
  bone.updateMatrixWorld(true);
}

/**
 * Move `leg`'s foot by (`dx`, `dy`, `dz`) (world metres) by folding or opening its two upper bones,
 * keeping the foot's world orientation. `hinge` is the fallback bend axis if the leg is dead
 * straight. Returns how far short it fell (0 when it got there).
 */
export function reachBy(leg: Leg, dy: number, hinge: THREE.Vector3, dx = 0, dz = 0) {
  if (Math.abs(dy) + Math.abs(dx) + Math.abs(dz) < 1e-4) return 0;
  const { upper, lower, end } = leg;
  end.getWorldQuaternion(_endQ);
  const A = _a.setFromMatrixPosition(upper.matrixWorld);
  const B = _b.setFromMatrixPosition(lower.matrixWorld);
  const C = _c.setFromMatrixPosition(end.matrixWorld);
  const T = _t.copy(C);
  T.x += dx; T.y += dy; T.z += dz;
  const la = A.distanceTo(B), lb = B.distanceTo(C);
  const dWant = A.distanceTo(T);
  const d = THREE.MathUtils.clamp(dWant, Math.abs(la - lb) + 1e-3, (la + lb) * 0.995);
  // 1) the knee: set the angle at B for the distance d
  _u.subVectors(A, B); _v.subVectors(C, B);
  const n = _n.crossVectors(_u, _v);
  if (n.lengthSq() < 1e-10) n.copy(hinge);
  n.normalize();
  const cur = _u.angleTo(_v);
  const want = Math.acos(THREE.MathUtils.clamp((la * la + lb * lb - d * d) / (2 * la * lb), -1, 1));
  turn(lower, n, want - cur);
  // 2) the hip: swing the whole leg so the ankle lands on the target's line
  C.setFromMatrixPosition(end.matrixWorld);
  _u.subVectors(C, A).normalize();
  _v.subVectors(T, A).normalize();
  const ang = _u.angleTo(_v);
  if (ang > 1e-5) {
    n.crossVectors(_u, _v);
    if (n.lengthSq() > 1e-12) turn(upper, n.normalize(), ang);
  }
  // 3) the foot keeps the orientation it had
  _pq.setFromRotationMatrix(_m.extractRotation(end.parent!.matrixWorld)).invert();
  end.quaternion.copy(_pq.multiply(_endQ));
  end.updateMatrixWorld(true);
  return dWant - d;
}
