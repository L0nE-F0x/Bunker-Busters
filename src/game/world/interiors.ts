import * as THREE from 'three/webgpu';

/**
 * Interior mode. A sealed interior (the Garage house, The Cut's chamber, the Tube's west tube, the
 * data centre's server hall) can't see out except through a few openings, so while the camera is in
 * one and none of its openings is in the view frustum, the game skips the whole exterior for that
 * frame, the sun's shadow pass included.
 *
 * Each interior is a local frame, an "inside" test in that frame, its openings as local boxes
 * (portals: if any part is in view the exterior is drawn, so nothing can pop), and the objects that
 * belong to it and must stay drawn (`keep`). Portal boxes should be generous.
 */
export class Interior {
  private inv: THREE.Matrix4;
  private worldPortals: THREE.Box3[];
  private static _f = new THREE.Frustum();
  private static _m = new THREE.Matrix4();
  private static _p = new THREE.Vector3();

  constructor(
    readonly name: string,
    /** local → world */
    m: THREE.Matrix4,
    private inside: (local: THREE.Vector3) => boolean,
    portals: { box: THREE.Box3; open?: () => boolean }[],
    readonly keep: THREE.Object3D[],
  ) {
    this.inv = m.clone().invert();
    // world AABBs of the (possibly rotated) local boxes: conservative, which is what a portal wants
    this.worldPortals = portals.map((p) => p.box.clone().applyMatrix4(m));
    this.open = portals.map((p) => p.open ?? (() => true));
  }
  private open: (() => boolean)[];

  /** True when `cam` is inside and no open portal is in view. */
  hides(cam: THREE.PerspectiveCamera) {
    if (!this.inside(Interior._p.copy(cam.position).applyMatrix4(this.inv))) return false;
    cam.updateMatrixWorld();
    Interior._f.setFromProjectionMatrix(Interior._m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    for (let i = 0; i < this.worldPortals.length; i++) {
      if (this.open[i]() && Interior._f.intersectsBox(this.worldPortals[i])) return false;
    }
    return true;
  }
}

const hasLight = new WeakMap<THREE.Object3D, boolean>();
/** Whether `o` holds a light (cached). Hiding one would change the light set and recompile every lit shader. */
function holdsLight(o: THREE.Object3D) {
  let v = hasLight.get(o);
  if (v === undefined) {
    v = false;
    o.traverse((c) => { if ((c as THREE.Light).isLight) v = true; });
    hasLight.set(o, v);
  }
  return v;
}

/**
 * Hide every root except `keep` and their ancestors' other branches: walks down the path to each kept
 * object hiding its siblings. Objects holding lights are never hidden. Returns what it hid (restore by
 * setting those visible again).
 */
export function hideExcept(roots: THREE.Object3D[], keep: THREE.Object3D[], out: THREE.Object3D[] = []) {
  const path = new Set<THREE.Object3D>();
  for (const k of keep) for (let a = k.parent; a; a = a.parent) path.add(a);
  const visit = (o: THREE.Object3D) => {
    if (!o.visible || keep.includes(o)) return;
    if (path.has(o)) { for (const c of o.children) visit(c); return; }
    if (holdsLight(o)) return;
    o.visible = false;
    out.push(o);
  };
  for (const r of roots) visit(r);
  return out;
}
