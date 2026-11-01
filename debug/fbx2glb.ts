// Dev-only: Mixamo's FBX → GLB in the browser (three's FBXLoader + GLTFExporter), for
// scripts/models/fbx-to-glb.mjs. Bones are renamed to the Meshy convention the game's townsfolk code
// uses (mixamorigSpine1 → Spine01, Neck → neck …; fingers keep Mixamo's names), the rig is scaled to
// metres, and each clip's tracks follow the rename.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const RENAME: Record<string, string> = { Spine1: 'Spine01', Spine2: 'Spine02', Neck: 'neck', HeadTop_End: 'head_end' };
const rename = (n: string) => { const b = n.replace(/^mixamorig\d*:?/, ''); return RENAME[b] ?? b; };

/** `skin`: the character file (mesh + rig); `clips`: animation-only files (same rig), as [url, role]. `height`: metres. */
async function convert(skin: string, clips: [string, string][], height: number) {
  const loader = new FBXLoader();
  const root = await loader.loadAsync(skin);
  const anims: THREE.AnimationClip[] = [];
  for (const [url, role] of clips) {
    const g = await loader.loadAsync(url);
    const c = g.animations[0];
    if (!c) throw new Error(`no clip in ${url}`);
    c.name = role;
    anims.push(c);
  }
  // names: bones, then the tracks that point at them
  root.traverse((o) => { if ((o as THREE.Bone).isBone) o.name = rename(o.name); });
  for (const c of anims) {
    c.tracks = c.tracks.filter((t) => !t.name.endsWith('.scale'));
    for (const t of c.tracks) { const [n, p] = t.name.split('.'); t.name = `${rename(n)}.${p}`; }
  }
  // metres: measure the mesh at bind and scale the whole root
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) { const m = o as THREE.SkinnedMesh; m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld)); } });
  const k = height / (box.max.y - box.min.y);
  root.scale.multiplyScalar(k);
  // the export keeps only skinned meshes and the rig (no FBX helper nodes' cameras/lights)
  const kept = new THREE.Group();
  kept.add(root);
  const glb = await new GLTFExporter().parseAsync(kept, { binary: true, animations: anims, onlyVisible: false });
  const bones: string[] = [];
  root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o.name); });
  const bytes = new Uint8Array(glb as ArrayBuffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { b64: btoa(s), bones, scale: k, measured: box.max.y - box.min.y, clips: anims.map((c) => `${c.name} ${c.duration.toFixed(2)}s ${c.tracks.length} tracks`) };
}
(window as unknown as { convert: typeof convert }).convert = convert;
document.title = 'ready';
