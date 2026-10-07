// Dev-only "prop lab": one world prop on a patch of sand in daylight, for close-up iteration.
//   ?what=car&kind=sedan&seed=3          what to build (see BUILDERS below) and its options
//   &yaw=0.7&pitch=0.25&dist=7&ty=0.8    orbit camera around the prop (look-at point tx, ty, tz)
//   &hour=9                              sun height (8 = low morning sun, 13 = noon)
//   &w=960&h=600                         viewport
import * as THREE from 'three/webgpu';
import { updateRim } from '@/game/world/materials';
import { MeshBatch } from '@/game/world/kit';
import { mulberry32 } from '@/engine/noise';
import { buildCar, type CarKind } from '@/game/world/vehicles';
import { deadTree, joshuaTree, shrub, SHRUBS, type Shrub, type Lod } from '@/game/world/flora';
import { floraMaterial, desertRock } from '@/game/world/materials';
import { rockGeometry } from '@/game/world/Props';
import { Fauna } from '@/game/world/Fauna';
import type { Heightfield } from '@/game/world/Heightfield';

const qs = new URLSearchParams(location.search);
const num = (k: string, d: number) => Number(qs.get(k) ?? d);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: true });
await renderer.init();
const W = num('w', 960), H = num('h', 600);
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fb4c8');
scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x8a6a4a, 1.3));
const sun = new THREE.DirectionalLight(0xffe6c8, 4);
const hour = num('hour', 9.5), a = ((hour - 6) / 12) * Math.PI;
sun.position.set(Math.cos(a) * 20, Math.sin(a) * 20 + 2, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 60 });
sun.shadow.bias = -0.0005;
scene.add(sun);
updateRim(new THREE.Color(1, 0.7, 0.4), 0.3);
// a sky-and-sand environment so metals have something to reflect (the game uses a sky cube camera)
{
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, vertexColors: true }));
  const pos = sky.geometry.attributes.position, cols: number[] = [];
  const top = new THREE.Color('#5c88b8'), hor = new THREE.Color('#d8dde0'), gnd = new THREE.Color('#9a7550');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    const c = y > 0 ? hor.clone().lerp(top, Math.pow(y, 0.6)) : gnd.clone();
    cols.push(c.r * 1.6, c.g * 1.6, c.b * 1.6);
  }
  sky.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  env.add(sky);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(env).texture;
  scene.environmentIntensity = 0.6;
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: '#b08a5e', roughness: 1 }));
ground.receiveShadow = true;
scene.add(ground);

const seed = num('seed', 1);
const rand = mulberry32(seed);
const BUILDERS: Record<string, () => THREE.Object3D> = {
  car: () => {
    const b = new MeshBatch();
    const kind = (qs.get('kind') || 'sedan') as CarKind;
    const paints = ['#7a8f86', '#a3542f', '#c9b37a', '#3d5a6c', '#8a2f2a', '#d6d0c0', '#4c6b3c'];
    buildCar(b, new THREE.Matrix4(), {
      kind, rand, paint: qs.get('paint') ? '#' + qs.get('paint') : paints[seed % paints.length],
      rust: num('rust', 0.55), burnt: qs.has('burnt'), hood: (qs.get('hood') as 'open') ?? (qs.has('flip') ? 'shut' : undefined),
      broken: num('broken', 0.35), blocks: qs.has('blocks'),
      wheels: qs.get('wheels')?.split(',') as ('ok' | 'flat' | 'gone')[] | undefined,
    });
    return b.build('car');
  },
  tree: () => {
    const lod = (qs.get('lod') || 'hi') as Lod;
    const p = qs.get('kind') === 'joshua' ? joshuaTree(seed, lod) : deadTree(seed, lod);
    const m = new THREE.Mesh(p.geometry(), floraMaterial());
    m.castShadow = m.receiveShadow = true;
    console.log('tris', p.idx.length / 3);
    return m;
  },
  shrub: () => {
    const lod = (qs.get('lod') || 'hi') as Lod;
    const g = new THREE.Group();
    // ?kind=all lays every species out in a row
    const kinds = qs.get('kind') === 'all' || !qs.get('kind') ? SHRUBS : [qs.get('kind') as Shrub];
    kinds.forEach((k, i) => {
      const p = shrub(k, seed + i * 13, lod);
      const m = new THREE.Mesh(p.geometry(), floraMaterial());
      m.position.x = (i - (kinds.length - 1) / 2) * 1.6;
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      console.log(k, 'tris', p.idx.length / 3);
    });
    return g;
  },
  fauna: () => {
    const hf = { size: 840, heightAt: () => 0, normalAt: () => ({ x: 0, y: 1, z: 0 }), zoneDistance: () => 1e9, roadDistanceAt: () => 1e9 } as unknown as Heightfield;
    const f = new Fauna(hf, [], []);
    f.lineup(new THREE.Vector3(0, 0, 0));
    return f.mesh;
  },
  rock: () => {
    const g = new THREE.Group();
    [3, 11, 29, 57].forEach((sd, i) => {
      const m = new THREE.Mesh(rockGeometry(sd, i === 3 ? 2 : 3), desertRock());
      m.position.x = (i - 1.5) * 2.4;
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    });
    return g;
  },
};
const obj = BUILDERS[qs.get('what') || 'car']();
if (qs.has('flip')) { obj.rotation.x = Math.PI; obj.position.y = 1.45; }
scene.add(obj);
const cam = new THREE.PerspectiveCamera(num('fov', 50), W / H, 0.05, 200);
const yaw = num('yaw', 0.7), pitch = num('pitch', 0.22), dist = num('dist', 7.5), ty = num('ty', 0.7);
const tx = num('tx', 0), tz = num('tz', 0);
cam.position.set(tx + Math.sin(yaw) * Math.cos(pitch) * dist, ty + Math.sin(pitch) * dist, tz + Math.cos(yaw) * Math.cos(pitch) * dist);
cam.lookAt(tx, ty, tz);
renderer.render(scene, cam);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__done = true;
