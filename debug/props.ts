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
import { HumanCrowd, type HumanLook, type HitZone } from '@/game/combat/Humans';
import { HumanSkins } from '@/game/combat/humanSkin';
import { WolfSkins } from '@/game/world/wolfSkin';
import { NpcModels } from '@/game/world/npcSkin';

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
// the Meshy contractor bodies, for what=human&meshy
const humanSkins = qs.get('what') === 'human' && qs.has('meshy') ? await HumanSkins.load(4, [3]) : null;
// the Meshy wolf: what=wolf&leap=0.5 | &low=1 | &roll=0.3&look=0.8 | &amp=0.85&phase=1 | &dead=1.2
const wolfSkins = qs.get('what') === 'wolf' ? await WolfSkins.load(3) : null;
// the Meshy townsfolk: what=npc&id=inez&clip=idle&t=3 | &ids=ren,pip (side by side, &gap=1.1)
//   &seat=0.44 sits them on a block that high | &look=0.5&nod=0.2 head turn
const npcIds = qs.get('what') === 'npc' ? (qs.get('ids') ?? qs.get('id') ?? 'inez').split(',') : [];
const npcModels = npcIds.length ? await NpcModels.load(npcIds) : null;
const BUILDERS: Record<string, () => THREE.Object3D> = {
  wolf: () => {
    const s = wolfSkins!;
    for (let i = 0; i < 3; i++) {
      s.pose(i, {
        pos: new THREE.Vector3((i - 1) * 1.6, 0, 0), yaw: num('wyaw', Math.PI / 2), pitch: num('wpitch', 0), roll: num('roll', 0), bob: 0,
        phase: num('phase', 0) + i * 1.2, amp: num('amp', 0), low: num('low', 0), look: num('look', 0), nod: num('nod', 0), tail: num('tail', 0),
        deadT: num('dead', -1), side: 1, leap: num('leap', 0),
      });
    }
    return s.group;
  },
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
  human: () => {
    const hf = { size: 840, heightAt: () => 0, normalAt: () => ({ x: 0, y: 1, z: 0 }) } as unknown as Heightfield;
    const base: HumanLook = { vest: '#e3b524', uniform: '#3c4450', pants: '#4a4a40', helmet: '#e8e6df', boots: '#2a1f18', gloves: '#2b2b2b', skin: '#8a6450', build: 1, height: 1, weapon: 'rifle' };
    const looks: HumanLook[] = [
      { ...base },
      { ...base, vest: '#e66a1e', weapon: 'shotgun', build: 1.15, pack: true },
      { ...base, weapon: 'revolver', build: 0.93, height: 0.96 },
      { ...base, helmet: '#e05a1a', leader: true, uniform: '#2c3038' },
    ];
    const c = new HumanCrowd(looks, humanSkins);
    c.lineup(new THREE.Vector3(0, 0, 0), hf);
    const pose = qs.get('pose');
    if (pose) c.people.forEach((p) => { p.pose = pose as never; for (let k = 0; k < 30; k++) p.update(1 / 30, hf); });
    if (qs.has('walk')) c.people.forEach((p) => { p.vel.set(0, 0, -Number(qs.get('walk'))); for (let k = 0; k < 17; k++) p.update(1 / 30, hf); });
    // &hit=body|head|arm|leg&at=0.1&side=1: a round from the front (toward −Z... they face −Z), `at` s ago
    // &cower=1: under fire. &dying=0.4: s into dying on its feet (&hit sets the wound)
    const hit = qs.get('hit') as HitZone | null;
    if (hit || qs.has('dying') || qs.has('cower')) c.people.forEach((p) => {
      if (hit) p.hit(hit, new THREE.Vector3(0, 0, 1), 1, num('side', 1));
      if (qs.has('dying')) { p.dyingT = 0; p.dyingDur = num('dur', 0.6); }
      p.cower = num('cower', 0);
      const t = qs.has('dying') ? num('dying', 0.5) : num('at', 0.1);
      for (let k = 0, n = Math.round(t * 60); k < n; k++) p.update(1 / 60, hf);
    });
    c.people.forEach((p) => humanSkins?.pose(p.slot, p, true));
    if (humanSkins) { const g = new THREE.Group(); g.add(c.mesh, humanSkins.group); return g; }
    return c.mesh;
  },
  npc: () => {
    const g = new THREE.Group();
    const seat = qs.has('seat') ? num('seat', 0.44) : null;
    npcIds.forEach((id, i) => {
      const a = npcModels?.make(id, seat !== null, (seat ?? 0) + 0.1);
      if (!a) return console.warn('[lab] no model for', id);
      a.root.position.x = (i - (npcIds.length - 1) / 2) * num('gap', 1.1);
      const clip = qs.get('clip') ?? 'idle';
      if (!a.pin(clip, num('t', 0))) console.warn(`[lab] ${id} has no ${clip}: ${a.roles().join(', ')}`);
      g.add(a.root);
      g.updateMatrixWorld(true);
      a.update(0, false, num('look', 0), num('nod', 0));
      if (seat !== null) {
        const block = new THREE.Mesh(new THREE.BoxGeometry(0.45, seat, 0.4), new THREE.MeshStandardNodeMaterial({ color: '#6b5a48', roughness: 1 }));
        block.position.set(a.root.position.x, seat / 2, 0);
        block.castShadow = block.receiveShadow = true;
        g.add(block);
      }
    });
    return g;
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
