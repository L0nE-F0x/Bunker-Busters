import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * The rattlesnake and the scorpion as Meshy models (static meshes, scripts/models/build-glb.mjs),
 * driven by the procedural creatures in Fauna.ts, which keep their AI and their poses but stop
 * drawing (their Body is a "ghost": it still solves its part matrices).
 *
 *  - Snakes: the model is skinned at load onto the procedural snake's 10 spine segments (+ head):
 *    each vertex weighs on the segment it lies along, blending into its neighbour near the joint, so
 *    it still coils, rattles, rears, strikes, slithers and rolls belly-up. All snakes are one
 *    SkinnedMesh (one draw), bones written directly from the segments' world matrices.
 *  - Scorpions: rigid, riding the procedural body's root (place, yaw, the 1.8× size, the dead roll).
 *    One InstancedMesh, one draw.
 */

const BASE = `${import.meta.env.BASE_URL}models/`;
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0).setPosition(0, -9999, 0);

/** Procedural snake: 10 segments of 0.11 m down −Z from the head (Fauna.ts snakeRig). */
const SEGS = 10, SEG_L = 0.11;
/** Model fit: nose at +0.095 m, the tail tip at about −1.05 m (the procedural length). */
const SNAKE_K = 0.605, SNAKE_Z = -0.48, SNAKE_Y = 0.01;
/** Scorpion fit, in the procedural body's root space (which is scaled 1.8): ~0.36 m long in the world. */
const SCORP_K = 0.36 / (1.8 * 1.9);

async function loadMesh(name: string) {
  const g = await new GLTFLoader().loadAsync(`${BASE}${name}.glb`);
  let mesh: THREE.Mesh | null = null;
  g.scene.updateMatrixWorld(true);
  g.scene.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
  if (!mesh) throw new Error(`${name}: no mesh`);
  const m = mesh as THREE.Mesh;
  const geo = (m.geometry as THREE.BufferGeometry).clone().applyMatrix4(m.matrixWorld);
  const map = (m.material as THREE.MeshStandardMaterial).map ?? null;
  return { geo, map };
}

export class SnakeSkins {
  readonly mesh: THREE.SkinnedMesh;
  private bones: THREE.Bone[] = [];

  static async load(count: number) {
    try {
      const { geo, map } = await loadMesh('rattlesnake');
      return new SnakeSkins(geo, map, count);
    } catch (e) {
      console.warn('[fauna] snake model failed to load; keeping the procedural snake', e);
      return null;
    }
  }

  private constructor(src: THREE.BufferGeometry, map: THREE.Texture | null, count: number) {
    const g0 = src.index ? src.toNonIndexed() : src;
    const P = g0.attributes.position as THREE.BufferAttribute;
    const N = g0.attributes.normal as THREE.BufferAttribute;
    const UV = g0.attributes.uv as THREE.BufferAttribute | undefined;
    const n = P.count;
    const pos = new Float32Array(n * 3 * count), nrm = new Float32Array(n * 3 * count), uv = new Float32Array(n * 2 * count);
    const si = new Uint16Array(n * 4 * count), sw = new Float32Array(n * 4 * count);
    const NB = SEGS + 1; // + the head
    for (let c = 0; c < count; c++) {
      for (let i = 0; i < n; i++) {
        const j = c * n + i;
        const x = P.getX(i) * SNAKE_K, y = P.getY(i) * SNAKE_K + SNAKE_Y, z = P.getZ(i) * SNAKE_K + SNAKE_Z;
        pos.set([x, y, z], j * 3);
        nrm.set([N.getX(i), N.getY(i), N.getZ(i)], j * 3);
        if (UV) uv.set([UV.getX(i), UV.getY(i)], j * 2);
        // which segment it lies along; blend into the one in front over the first half of each
        let a = 0, b = 0, wa = 1, wb = 0;
        if (z > 0.005) a = SEGS; // the head
        else {
          const u = Math.min(SEGS - 0.001, -z / SEG_L);
          const k = Math.floor(u), f = u - k;
          a = k;
          if (f < 0.5 && k > 0) { b = k - 1; wa = 0.5 + f; wb = 0.5 - f; }
        }
        si.set([c * NB + a, c * NB + b, 0, 0], j * 4);
        sw.set([wa, wb, 0, 0], j * 4);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    // bind: segment k's joint at z = −k·L (the head rides segment 0's joint)
    const inv: THREE.Matrix4[] = [];
    for (let c = 0; c < count; c++) for (let k = 0; k < NB; k++) {
      const bone = new THREE.Bone();
      bone.matrixAutoUpdate = false;
      bone.matrixWorldAutoUpdate = false;
      this.bones.push(bone);
      inv.push(new THREE.Matrix4().makeTranslation(0, 0, k === SEGS ? 0 : k * SEG_L));
    }
    this.mesh = new THREE.SkinnedMesh(g, new THREE.MeshStandardNodeMaterial({ map, roughness: 0.75, metalness: 0 }));
    this.mesh.name = 'snakes';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.bindMode = THREE.DetachedBindMode;
    this.mesh.bind(new THREE.Skeleton(this.bones, inv), new THREE.Matrix4());
    for (let c = 0; c < count; c++) this.set(c, null, null);
  }

  /** Snake `i` from its segments' and head's world matrices (null: hidden). */
  set(i: number, segs: THREE.Matrix4[] | null, head: THREE.Matrix4 | null) {
    const NB = SEGS + 1;
    for (let k = 0; k < NB; k++) {
      const m = this.bones[i * NB + k].matrixWorld;
      if (!segs || !head) m.copy(HIDE);
      else m.copy(k === SEGS ? head : segs[k]);
    }
  }
}

export class ScorpionSkins {
  readonly mesh: THREE.InstancedMesh;
  private fit = new THREE.Matrix4();
  private _m = new THREE.Matrix4();

  static async load(count: number) {
    try {
      const { geo, map } = await loadMesh('scorpion');
      return new ScorpionSkins(geo, map, count);
    } catch (e) {
      console.warn('[fauna] scorpion model failed to load; keeping the procedural scorpion', e);
      return null;
    }
  }

  private constructor(geo: THREE.BufferGeometry, map: THREE.Texture | null, count: number) {
    geo.computeBoundingBox();
    const minY = geo.boundingBox!.min.y;
    // feet on the procedural body's ground (its root sits 0.025 above the body's belly line)
    this.fit.makeScale(SCORP_K, SCORP_K, SCORP_K).premultiply(new THREE.Matrix4().makeTranslation(0, -minY * SCORP_K - 0.012, 0));
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardNodeMaterial({ map, roughness: 0.55, metalness: 0.05 }), count);
    this.mesh.name = 'scorpions';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, HIDE);
  }

  /** Scorpion `i` at the procedural body's root matrix (null: hidden). */
  set(i: number, root: THREE.Matrix4 | null) {
    this.mesh.setMatrixAt(i, root ? this._m.multiplyMatrices(root, this.fit) : HIDE);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
