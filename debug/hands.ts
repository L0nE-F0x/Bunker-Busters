// Dev-only "hand lab": renders the first-person hands in a neutral studio for quick iteration.
import * as THREE from 'three/webgpu';
import { Hands, HAND_LOOKS } from '@/game/player/Hands';
import { updateRim } from '@/game/world/materials';

const qs = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: true });
await renderer.init();
const W = 640, H = 400;
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
for (let i = 0; i < 120; i++) hands.update(1 / 60, { speed: 0, grounded: true, crouch: qs.get('pose') === 'crouch', sprint: false, bobPhase: 0, lookDX: 0, lookDY: 0 });
renderer.render(scene, cam);
(window as any).__done = true;
