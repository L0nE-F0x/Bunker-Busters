// Dev-only "hand lab": renders the first-person hands in a neutral studio for quick iteration.
//   ?pose=idle&look=engineer&torch          a named pose (POSES in Hands.ts)
//   &frame={"sprint":true,"speed":6}         HandsFrame overrides (movement state)
//   &t=0.4                                   seconds to simulate before the shot (default 2)
//   &view=side|palm|top&hand=r|l             inspect one hand from an orbit camera (anatomy check)
//   &w=1280&h=540                            viewport (wide aspect = more horizontal FOV)
import * as THREE from 'three/webgpu';
import { Hands, HAND_LOOKS, type HandsFrame } from '@/game/player/Hands';
import { updateRim } from '@/game/world/materials';

const qs = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: true });
await renderer.init();
const W = Number(qs.get('w') ?? 640), H = Number(qs.get('h') ?? 400);
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(qs.get('bg') || '#6d7378');
const cam = new THREE.PerspectiveCamera(64, W / H, 0.05, 100);
scene.add(cam);
scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x5a4636, 1.4));
const sun = new THREE.DirectionalLight(0xffe0b8, 3.5);
sun.position.set(2, 3, 1);
scene.add(sun);
updateRim(new THREE.Color(1, 0.7, 0.4), 0.4);
const hands = new Hands(HAND_LOOKS[qs.get('look') || 'infiltrator']);
hands.attach(cam);
hands.setBase(qs.get('pose') || 'idle');
if (qs.has('torch')) hands.flashlightOn = true;
const frame: HandsFrame = { speed: 0, grounded: true, crouch: qs.get('pose') === 'crouch', sprint: false, bobPhase: 0, lookDX: 0, lookDY: 0, ...JSON.parse(qs.get('frame') ?? '{}') };
const steps = Math.round(Number(qs.get('t') ?? 2) * 60);
for (let i = 0; i < steps; i++) {
  if (frame.speed) frame.bobPhase += (frame.speed / (frame.sprint ? 2.25 : 1.45)) * Math.PI / 60;
  hands.update(1 / 60, frame);
}
let view: THREE.Camera = cam;
const v = qs.get('view');
if (v) {
  // orbit camera around one wrist, in the camera's frame
  const rig = qs.get('hand') === 'l' ? hands.left : hands.right;
  scene.updateMatrixWorld(true);
  const c = new THREE.Vector3();
  rig.root.getWorldPosition(c);
  c.add(new THREE.Vector3(0, 0, -0.03).applyQuaternion(rig.root.getWorldQuaternion(new THREE.Quaternion())));
  const oc = new THREE.PerspectiveCamera(35, W / H, 0.005, 10);
  const off = v === 'side' ? new THREE.Vector3(0.22, 0.02, 0) : v === 'palm' ? new THREE.Vector3(0, -0.2, -0.05) : new THREE.Vector3(0, 0.22, 0.02);
  oc.position.copy(c).add(off);
  oc.up.set(0, v === 'top' || v === 'palm' ? 0 : 1, v === 'top' || v === 'palm' ? -1 : 0);
  oc.lookAt(c);
  view = oc;
}
renderer.render(scene, view);
(window as any).__done = true;
