import * as THREE from 'three/webgpu';

/**
 * CPU copies of static vertex data, dropped once the GPU has them. Three keeps every attribute's typed
 * array after the upload (only for re-uploads and context restores), and the world's merged batches
 * are most of the page's memory: ~600 MB of typed arrays against ~120 MB of JS objects. Phones kill a
 * tab long before that.
 *
 * Only geometry marked static (`markStatic`: MeshBatch output, the static merges, the terrain) and only
 * when nothing else draws it (instanced, skinned, morphing, points, lines and sprites keep theirs) is
 * released: its bounds are computed first, then the backend's own upload hands it a zero-length array of
 * the same type (both WebGL2 and WebGPU read only the type and byte length they stored at upload). A
 * write to a released attribute later can't reach the GPU: it's reported once on the console (the tests
 * and the soak watch for it). `?keepgeo` keeps everything (A/B).
 *
 * The cost: a lost GPU context can't be restored in place for these (three can't re-upload them), so
 * recovery from a lost context has to be a reload.
 */
const KEEP = typeof location !== 'undefined' && new URLSearchParams(location.search).has('keepgeo');

const marked = new WeakSet<THREE.BufferGeometry>();
const pending = new WeakSet<object>();
const released = new WeakSet<object>();
let installed = false;
let bytes = 0;
let warned = false;

/** This geometry's vertex data never changes after boot: its CPU copy may go once it's uploaded. */
export function markStatic<G extends THREE.BufferGeometry>(g: G): G {
  marked.add(g);
  return g;
}

type Attr = THREE.BufferAttribute & { array: THREE.TypedArray };

function drop(a: Attr) {
  pending.delete(a);
  if (released.has(a)) return;
  released.add(a);
  bytes += a.array.byteLength;
  const Ctor = a.array.constructor as new (n: number) => THREE.TypedArray;
  a.array = new Ctor(0);
}

/** Hook the backend's uploads (once): a pending attribute is released right after its first upload. */
function install(renderer: THREE.WebGPURenderer) {
  if (installed) return;
  installed = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const be = (renderer as any).backend;
  for (const name of ['createAttribute', 'createIndexAttribute']) {
    const own = be[name];
    if (typeof own !== 'function') continue;
    be[name] = function (attribute: Attr, ...rest: unknown[]) {
      const r = own.call(this, attribute, ...rest);
      if (pending.has(attribute)) drop(attribute);
      return r;
    };
  }
  const update = be.updateAttribute;
  if (typeof update === 'function') {
    be.updateAttribute = function (attribute: Attr, ...rest: unknown[]) {
      if (released.has(attribute)) {
        if (!warned) { warned = true; console.error('[BunkerBusters] a released static geometry was written to (its CPU copy is gone): mark it dynamic', attribute); }
        return undefined;
      }
      return update.call(this, attribute, ...rest);
    };
  }
}

/**
 * Release the CPU copies of every marked geometry under `root` that only plain meshes draw (now if
 * already uploaded, else at its first upload). Returns the bytes released so far.
 */
export function releaseStatic(renderer: THREE.WebGPURenderer, root: THREE.Object3D): number {
  if (KEEP) return 0;
  install(renderer);
  // geometry that anything other than a plain static mesh uses keeps its arrays
  const keep = new Set<THREE.BufferGeometry>();
  const plain: THREE.Mesh[] = [];
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!g) return;
    const m = o as THREE.Mesh;
    const isPlain = m.isMesh && !(m as unknown as THREE.InstancedMesh).isInstancedMesh && !(m as unknown as THREE.SkinnedMesh).isSkinnedMesh && !m.morphTargetInfluences;
    if (isPlain) plain.push(m); else keep.add(g);
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const be = (renderer as any).backend;
  for (const m of plain) {
    const g = m.geometry;
    if (!marked.has(g) || keep.has(g)) continue;
    if (Object.keys(g.morphAttributes).length) continue;
    // bounds before the data goes (frustum culling computes a missing sphere from the positions)
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingBox) g.computeBoundingBox();
    const attrs = [...Object.values(g.attributes), ...(g.index ? [g.index] : [])] as Attr[];
    for (const a of attrs) {
      if ((a as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute || !a.array || !a.array.byteLength) continue;
      if (a.usage !== THREE.StaticDrawUsage || released.has(a)) continue;
      // already on the GPU (WebGL keeps `bufferGPU`, WebGPU `buffer`)? Then now, else at its upload
      const d = be.has?.(a) ? be.get(a) : null;
      if (d && (d.bufferGPU || d.buffer)) drop(a); else pending.add(a);
    }
  }
  return bytes;
}

/** Bytes of vertex data released so far. */
export const releasedBytes = () => bytes;
