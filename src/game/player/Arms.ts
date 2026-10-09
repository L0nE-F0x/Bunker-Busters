import * as THREE from 'three/webgpu';
import { Fn, vec4, float, uv, length, atan, cos, pow, smoothstep, uniform, vec3 } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { hardMat, steelMat, bakeParts, type HandPose, type HandRig } from './Hands';
import type { WeaponId } from '@/content/weapons';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * First-person weapons: procedural models with working parts (the revolver's cylinder turns and its
 * hammer cocks, the shotgun's pump racks, the rifle's lever cycles), and the viewmodel animation that
 * places them. The weapon is posed first (hip, aimed, sprinting, reloading, swinging, recoil and sway
 * on springs) and the hands are then solved onto it: the right hand's grip anchor onto the weapon's
 * grip, the left hand onto its forend, so hands and gun can never drift apart.
 *
 * Model space: metres, origin at the right hand's grip point, barrel along −Z, +Y up. Each model's
 * moving parts are bones of one skinned mesh per material kind (Hands' bakeParts), so a gun is 2–3
 * draws however detailed it is.
 */

type F6 = [number, number, number, number, number, number];

export interface ArmsModel {
  root: THREE.Group;
  /** Sight line height above the bore axis origin (model units): ADS centres this on the view. */
  sightY: number;
  /** Where the muzzle is (model space). */
  muzzle: THREE.Vector3;
  /** Moving parts (bones after baking). */
  parts: Record<string, THREE.Object3D>;
  flash: THREE.Mesh | null;
}

const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const E = (x: number, y: number, z: number) => new THREE.Euler(x, y, z, 'YXZ');

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = false;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
const box = (w: number, h: number, d: number, r = 0.002, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
/** Cylinder along Z (centred). */
const cylZ = (r0: number, r1: number, len: number, seg = 16) => new THREE.CylinderGeometry(r1, r0, len, seg).rotateX(-Math.PI / 2);

// ------------------------------------------------------------------ muzzle flash
let _flashMat: THREE.MeshBasicNodeMaterial | null = null;
const flashIntensity = uniform(0);
const flashSeed = uniform(0);
/** One additive star material for every gun's muzzle flash (crossed quads, procedural spikes). */
function flashMaterial() {
  if (_flashMat) return _flashMat;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, forceSinglePass: true });
  m.colorNode = Fn(() => {
    const p = uv().sub(0.5).mul(2);
    const r = length(p);
    const a = atan(p.y, p.x).add(flashSeed);
    const spikes = pow(cos(a.mul(3)).abs(), 8).mul(smoothstep(1.0, 0.0, r));
    const core = smoothstep(0.55, 0.0, r);
    const shape = core.add(spikes.mul(0.8));
    const col = vec3(1.0, 0.72, 0.36).mul(shape).add(vec3(1.0, 0.95, 0.8).mul(pow(core, 3)));
    return vec4(col.mul(flashIntensity), float(1));
  })();
  _flashMat = m;
  return m;
}

function buildFlash(muzzle: THREE.Vector3, size: number) {
  const g: THREE.BufferGeometry[] = [];
  // a disc facing forward plus two crossed fins along the bore
  const disc = new THREE.PlaneGeometry(size, size);
  g.push(disc);
  for (const r of [0, Math.PI / 2]) {
    const fin = new THREE.PlaneGeometry(size * 0.55, size * 1.6).rotateX(Math.PI / 2).rotateZ(r).translate(0, 0, -size * 0.6);
    g.push(fin);
  }
  const geo = mergeAll(g);
  const m = new THREE.Mesh(geo, flashMaterial());
  m.position.copy(muzzle);
  m.renderOrder = 6;
  m.frustumCulled = false;
  m.visible = false;
  return m;
}

function mergeAll(gs: THREE.BufferGeometry[]) {
  const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
  let base = 0;
  for (const g of gs) {
    const p = g.attributes.position, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); uvs.push(u.getX(i), u.getY(i)); }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setIndex(idx);
  return out;
}

// ------------------------------------------------------------------ models

function revolver(): ArmsModel {
  const root = new THREE.Group();
  const blued = steelMat('#41454b', 0.3);
  const bright = steelMat('#8d9198', 0.28);
  const wood = hardMat('#5b3420', 0.55, 0);
  const woodDark = hardMat('#3b2114', 0.6, 0);
  // grip: a bird's-head walnut grip on a steel backstrap, raked back and curling at the butt
  const grip = new THREE.Group();
  grip.position.set(0, 0.012, 0.014);
  grip.rotation.x = -0.38;
  root.add(grip);
  add(grip, box(0.03, 0.078, 0.042, 0.013, 3), wood, 0, -0.024, 0);
  add(grip, box(0.029, 0.03, 0.038, 0.012, 3), wood, 0, -0.06, 0.008, -0.45, 0, 0);
  add(grip, box(0.011, 0.085, 0.008, 0.003), blued, 0, -0.026, 0.023);
  add(grip, box(0.031, 0.01, 0.03, 0.004), woodDark, 0, -0.077, 0.016, -0.6, 0, 0);
  add(grip, new THREE.CylinderGeometry(0.004, 0.004, 0.032, 10).rotateZ(Math.PI / 2), bright, 0, -0.02, 0.0); // grip screw
  // frame
  add(root, box(0.026, 0.042, 0.1, 0.004), blued, 0, 0.052, -0.022);
  add(root, box(0.02, 0.012, 0.05, 0.003), blued, 0, 0.079, -0.005); // top strap
  // trigger guard + trigger
  const guard = new THREE.TorusGeometry(0.017, 0.0026, 6, 16, Math.PI * 1.1);
  add(root, guard, blued, 0, 0.026, -0.03, 0, Math.PI / 2, -Math.PI * 0.05);
  add(root, box(0.004, 0.02, 0.006, 0.0015), bright, 0, 0.022, -0.034, 0.3, 0, 0);
  // cylinder (bone): six chambers with flutes, rotates about the bore axis
  const cylPivot = new THREE.Group();
  cylPivot.position.set(0, 0.058, -0.036);
  root.add(cylPivot);
  const cyl = new THREE.Group();
  cylPivot.add(cyl);
  add(cyl, cylZ(0.0205, 0.0205, 0.04, 18), blued);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    add(cyl, box(0.006, 0.004, 0.03, 0.0015), steelMat('#1c1d20', 0.5), Math.cos(a) * 0.0205, Math.sin(a) * 0.0205, 0, 0, 0, a + Math.PI / 2);
    // case heads at the rear
    add(cyl, cylZ(0.0058, 0.0058, 0.003, 10), steelMat('#b8975a', 0.3), Math.cos(a + Math.PI / 6) * 0.0128, Math.sin(a + Math.PI / 6) * 0.0128, 0.0205);
  }
  add(cyl, cylZ(0.004, 0.004, 0.046, 8), bright); // centre pin
  // barrel + under-lug + ejector rod
  add(root, cylZ(0.0088, 0.0082, 0.11, 16), blued, 0, 0.064, -0.11);
  add(root, box(0.012, 0.012, 0.09, 0.003), blued, 0, 0.051, -0.105);
  add(root, cylZ(0.0024, 0.0024, 0.085, 8), bright, 0, 0.043, -0.1);
  add(root, cylZ(0.0035, 0.0035, 0.012, 8), bright, 0, 0.043, -0.146);
  // sights: front blade and the rear groove in the top strap (sight line y = 0.08)
  add(root, box(0.0035, 0.011, 0.012, 0.001), blued, 0, 0.0745, -0.158);
  add(root, box(0.007, 0.003, 0.01, 0.0008), steelMat('#121314', 0.6), 0, 0.0862, -0.002);
  // hammer (bone): cocks back about its pivot
  const hammer = new THREE.Group();
  hammer.position.set(0, 0.06, 0.03);
  root.add(hammer);
  add(hammer, box(0.008, 0.026, 0.01, 0.002), blued, 0, 0.014, 0.004, -0.4, 0, 0);
  add(hammer, box(0.01, 0.006, 0.014, 0.002), steelMat('#5a5e64', 0.5), 0, 0.027, 0.011, -0.2, 0, 0);
  // engraving-ish accents: a bright line along the frame
  add(root, box(0.0262, 0.0015, 0.07, 0.0005), bright, 0, 0.066, -0.02);
  const muzzle = V3(0, 0.064, -0.17);
  const flash = buildFlash(muzzle, 0.12);
  bakeParts(root, true);
  root.add(flash);
  return { root, sightY: 0.08, muzzle, parts: { cylinder: cyl, cylPivot, hammer }, flash };
}

function shotgun(): ArmsModel {
  const root = new THREE.Group();
  const blued = steelMat('#3a3d42', 0.36);
  const bright = steelMat('#7c8086', 0.3);
  const wood = hardMat('#6a3f22', 0.6, 0);
  const rubber = hardMat('#171717', 0.9, 0);
  // stock: wrist + comb + butt (wood), the wrist is the right-hand grip
  const stock = new THREE.Group();
  root.add(stock);
  add(stock, box(0.032, 0.045, 0.1, 0.012, 3), wood, 0, -0.005, 0.02, -0.3, 0, 0);
  add(stock, box(0.036, 0.06, 0.2, 0.014, 3), wood, 0, 0.012, 0.15, -0.12, 0, 0);
  add(stock, box(0.04, 0.12, 0.09, 0.014, 3), wood, 0, -0.012, 0.25, -0.12, 0, 0);
  add(stock, box(0.042, 0.125, 0.016, 0.004), rubber, 0, -0.02, 0.298, -0.12, 0, 0);
  // receiver
  add(root, box(0.038, 0.056, 0.2, 0.006, 3), blued, 0, 0.047, -0.115);
  add(root, box(0.039, 0.012, 0.07, 0.003), steelMat('#141516', 0.6), 0.0005, 0.05, -0.11); // ejection port
  add(root, box(0.026, 0.006, 0.04, 0.002), steelMat('#141516', 0.6), 0, 0.016, -0.095); // loading port
  // trigger guard + trigger
  add(root, new THREE.TorusGeometry(0.02, 0.0032, 6, 18, Math.PI * 1.15), blued, 0, 0.022, -0.035, 0, Math.PI / 2, -Math.PI * 0.08);
  add(root, box(0.005, 0.024, 0.007, 0.0015), bright, 0, 0.016, -0.04, 0.25, 0, 0);
  // barrel + magazine tube
  add(root, cylZ(0.0115, 0.0108, 0.46, 18), blued, 0, 0.068, -0.44);
  add(root, cylZ(0.0118, 0.0118, 0.02, 18), bright, 0, 0.068, -0.665);
  add(root, cylZ(0.0098, 0.0098, 0.38, 14), blued, 0, 0.042, -0.41);
  add(root, cylZ(0.0104, 0.0104, 0.02, 14), bright, 0, 0.042, -0.6);
  add(root, box(0.008, 0.012, 0.03, 0.002), blued, 0, 0.055, -0.6); // barrel band
  // ghost-ring rear on the receiver, a post up front (sight line y = 0.1)
  add(root, box(0.012, 0.022, 0.012, 0.002), blued, 0, 0.086, -0.04);
  add(root, new THREE.TorusGeometry(0.008, 0.0022, 6, 14), blued, 0, 0.1, -0.04);
  add(root, box(0.006, 0.026, 0.016, 0.001), blued, 0, 0.085, -0.655);
  add(root, new THREE.SphereGeometry(0.0034, 10, 8), steelMat('#e8e0c8', 0.25), 0, 0.099, -0.656);
  add(root, box(0.008, 0.003, 0.18, 0.001), steelMat('#151617', 0.6), 0, 0.0765, -0.12);
  // pump (bone): slides back along the tube
  const pump = new THREE.Group();
  pump.position.set(0, 0.042, -0.36);
  root.add(pump);
  add(pump, box(0.046, 0.044, 0.17, 0.016, 3), wood, 0, -0.003, 0);
  for (let i = 0; i < 7; i++) add(pump, box(0.047, 0.003, 0.004, 0.001), hardMat('#3b2214', 0.7, 0), 0, -0.003 + 0.014, -0.06 + i * 0.02);
  add(pump, box(0.006, 0.006, 0.12, 0.002), blued, 0.016, 0.018, 0.12); // action bar
  const muzzle = V3(0, 0.068, -0.68);
  const flash = buildFlash(muzzle, 0.2);
  bakeParts(root, true);
  root.add(flash);
  return { root, sightY: 0.1, muzzle, parts: { pump }, flash };
}

function rifle(): ArmsModel {
  const root = new THREE.Group();
  const blued = steelMat('#393c40', 0.34);
  const case_ = steelMat('#7a6a55', 0.3); // case-hardened receiver
  const bright = steelMat('#8c9096', 0.3);
  const wood = hardMat('#7a4a28', 0.55, 0);
  const plate = steelMat('#3d3f43', 0.45);
  // straight-grip stock
  const stock = new THREE.Group();
  root.add(stock);
  add(stock, box(0.03, 0.038, 0.12, 0.012, 3), wood, 0, 0.008, 0.035, -0.18, 0, 0);
  add(stock, box(0.034, 0.055, 0.2, 0.012, 3), wood, 0, 0.004, 0.17, -0.1, 0, 0);
  add(stock, box(0.038, 0.11, 0.08, 0.012, 3), wood, 0, -0.02, 0.27, -0.1, 0, 0);
  add(stock, box(0.04, 0.115, 0.01, 0.003), plate, 0, -0.026, 0.312, -0.1, 0, 0);
  // receiver
  add(root, box(0.03, 0.062, 0.15, 0.006, 3), case_, 0, 0.042, -0.09);
  add(root, box(0.031, 0.01, 0.09, 0.002), steelMat('#121314', 0.6), 0, 0.066, -0.1); // top opening
  // loading gate on the right side
  add(root, box(0.002, 0.016, 0.03, 0.0008), bright, 0.0156, 0.03, -0.12);
  // octagonal barrel + magazine tube + forend
  add(root, cylZ(0.0105, 0.0098, 0.5, 8), blued, 0, 0.06, -0.415);
  add(root, cylZ(0.0082, 0.0082, 0.44, 12), blued, 0, 0.038, -0.385);
  add(root, box(0.012, 0.02, 0.02, 0.003), blued, 0, 0.047, -0.62); // barrel band
  add(root, box(0.036, 0.04, 0.2, 0.013, 3), wood, 0, 0.042, -0.29);
  add(root, box(0.037, 0.008, 0.012, 0.002), blued, 0, 0.042, -0.392); // forend cap
  // sights: a tall buckhorn on the barrel and a blade on a ramp at the muzzle (sight line y = 0.098)
  add(root, box(0.006, 0.026, 0.006, 0.001), blued, 0, 0.078, -0.25);
  add(root, box(0.022, 0.012, 0.004, 0.001), blued, 0, 0.094, -0.25);
  add(root, box(0.004, 0.009, 0.0045, 0.0008), steelMat('#121314', 0.6), 0, 0.0975, -0.249);
  add(root, box(0.006, 0.022, 0.02, 0.001), blued, 0, 0.074, -0.652);
  add(root, box(0.0028, 0.012, 0.008, 0.001), steelMat('#d8cfb0', 0.3), 0, 0.093, -0.655);
  // hammer (bone)
  const hammer = new THREE.Group();
  hammer.position.set(0, 0.056, -0.012);
  root.add(hammer);
  add(hammer, box(0.007, 0.03, 0.01, 0.002), case_, 0, 0.012, 0.006, -0.5, 0, 0);
  // lever (bone): pivots at the front of the receiver's belly, the loop wraps the grip
  const lever = new THREE.Group();
  lever.position.set(0, 0.014, -0.07);
  root.add(lever);
  add(lever, box(0.008, 0.008, 0.07, 0.002), case_, 0, -0.002, 0.035);
  const loop = new THREE.TorusGeometry(0.022, 0.0035, 6, 18, Math.PI * 1.4);
  add(lever, loop, case_, 0, -0.025, 0.07, 0, Math.PI / 2, Math.PI * 0.35);
  add(lever, box(0.004, 0.022, 0.006, 0.0015), bright, 0, -0.012, 0.045, 0.35, 0, 0); // trigger
  const muzzle = V3(0, 0.06, -0.67);
  const flash = buildFlash(muzzle, 0.15);
  bakeParts(root, true);
  root.add(flash);
  return { root, sightY: 0.099, muzzle, parts: { lever, hammer }, flash };
}

function crowbar(): ArmsModel {
  const root = new THREE.Group();
  const paint = hardMat('#a4271c', 0.55, 0.35);
  const worn = steelMat('#6f7378', 0.42);
  const tape = hardMat('#151515', 0.85, 0);
  // hex bar from behind the fist forward; the hook end leads
  const bar = new THREE.CylinderGeometry(0.0095, 0.0095, 0.5, 6).rotateX(-Math.PI / 2);
  add(root, bar, paint, 0, 0, -0.15);
  add(root, new THREE.CylinderGeometry(0.0098, 0.0098, 0.04, 6).rotateX(-Math.PI / 2), worn, 0, 0, -0.38); // scraped band
  add(root, cylZ(0.0118, 0.0118, 0.12, 8), tape, 0, 0, 0.01); // grip tape
  // goose-neck hook: a bent tube, then the split claw
  const curve = new THREE.CatmullRomCurve3([V3(0, 0, -0.4), V3(0, 0.02, -0.45), V3(0, 0.07, -0.47), V3(0, 0.11, -0.45), V3(0, 0.12, -0.41)]);
  add(root, new THREE.TubeGeometry(curve, 16, 0.0095, 6), paint);
  add(root, box(0.022, 0.006, 0.035, 0.002), worn, 0, 0.122, -0.395, 0.25, 0, 0);
  // pry end: flattened, angled
  add(root, box(0.02, 0.006, 0.05, 0.002), worn, 0, -0.006, 0.09, 0.18, 0, 0);
  bakeParts(root, false);
  return { root, sightY: 0, muzzle: V3(0, 0.1, -0.46), parts: {}, flash: null };
}

/**
 * The Hush .22: a slab-sided target pistol (fixed barrel, a slide riding on top) wearing a fat
 * suppressor, with tall sights that clear the can. The magazine is a bone so it drops out of the grip
 * and comes back up in the left hand; the slide is a bone so it slaps back on every shot.
 */
function pistol22(): ArmsModel {
  const root = new THREE.Group();
  const black = steelMat('#34373b', 0.4);
  const parkerized = steelMat('#4b4f55', 0.46);
  const bright = steelMat('#8a8e94', 0.3);
  const can = hardMat('#2b2d30', 0.55, 0.6);
  const panel = hardMat('#4a3a2c', 0.7, 0);
  const rubber = hardMat('#141414', 0.88, 0);
  // grip: raked frame with checkered wood panels, a flared heel at the butt
  const grip = new THREE.Group();
  grip.position.set(0, 0.012, 0.012);
  grip.rotation.x = -0.3;
  root.add(grip);
  add(grip, box(0.026, 0.086, 0.04, 0.008, 3), black, 0, -0.03, 0);
  add(grip, box(0.029, 0.066, 0.032, 0.008, 3), panel, 0, -0.03, 0.002);
  for (let i = 0; i < 5; i++) add(grip, box(0.0292, 0.0014, 0.028, 0.0005), hardMat('#33281f', 0.8, 0), 0, -0.052 + i * 0.011, 0.002);
  add(grip, box(0.024, 0.006, 0.042, 0.002), black, 0, 0.012, 0.003); // tang
  add(grip, box(0.03, 0.01, 0.046, 0.003), rubber, 0, -0.077, 0.004); // heel
  // frame: dust cover over the trigger, the barrel's lower lug
  add(root, box(0.024, 0.026, 0.11, 0.004), black, 0, 0.046, -0.038);
  // trigger guard (squared front, as on target guns) + a smooth target trigger
  add(root, new THREE.TorusGeometry(0.016, 0.0026, 6, 16, Math.PI * 1.15), black, 0, 0.026, -0.028, 0, Math.PI / 2, -Math.PI * 0.08);
  add(root, box(0.004, 0.004, 0.022, 0.0012), black, 0, 0.011, -0.045);
  add(root, box(0.005, 0.02, 0.006, 0.0018), bright, 0, 0.024, -0.03, 0.25, 0, 0);
  // slide (bone): cycles back on each shot, locks back on empty
  const slide = new THREE.Group();
  slide.position.set(0, 0.066, -0.046);
  root.add(slide);
  add(slide, box(0.023, 0.024, 0.128, 0.004, 3), parkerized);
  add(slide, box(0.0236, 0.006, 0.04, 0.001), steelMat('#121314', 0.6), 0, 0.004, -0.02); // ejection port
  for (let i = 0; i < 6; i++) add(slide, box(0.0238, 0.016, 0.0016, 0.0004), black, 0, -0.002, 0.044 + i * 0.0036); // serrations
  // rear sight (tall, suppressor height) with a square notch; front blade with a white dot
  add(slide, box(0.02, 0.012, 0.007, 0.0015), black, 0, 0.018, 0.058);
  add(slide, box(0.006, 0.006, 0.0075, 0.0006), steelMat('#0d0e0f', 0.7), 0, 0.022, 0.058);
  add(slide, box(0.0036, 0.016, 0.007, 0.001), black, 0, 0.019, -0.06);
  add(slide, new THREE.SphereGeometry(0.0014, 8, 6), hardMat('#e8e3d4', 0.4, 0), 0, 0.025, -0.0638);
  // barrel: a short stub out of the slide, then the threaded can
  add(root, cylZ(0.0062, 0.0062, 0.026, 12), bright, 0, 0.066, -0.118);
  add(root, cylZ(0.0168, 0.0168, 0.165, 22), can, 0, 0.066, -0.212);
  add(root, cylZ(0.0172, 0.0172, 0.008, 22), black, 0, 0.066, -0.132); // rear cap
  add(root, cylZ(0.0172, 0.0172, 0.008, 22), black, 0, 0.066, -0.29); // front cap
  for (let i = 0; i < 3; i++) add(root, cylZ(0.0171, 0.0171, 0.0018, 22), steelMat('#4b4e53', 0.45), 0, 0.066, -0.17 - i * 0.045);
  add(root, cylZ(0.0045, 0.0045, 0.002, 10), steelMat('#050505', 0.9), 0, 0.066, -0.2945); // bore
  // a strip of white tape round the can, hand-labelled (a contractor's idea of a serial number)
  add(root, cylZ(0.01705, 0.01705, 0.012, 22), hardMat('#cfc6b0', 0.8, 0), 0, 0.066, -0.245);
  // magazine (bone): body hidden in the grip, base plate showing; drops out on a reload
  const mag = new THREE.Group();
  mag.position.set(0, 0.012, 0.012);
  root.add(mag);
  const magBody = new THREE.Group();
  magBody.rotation.x = -0.3;
  mag.add(magBody);
  add(magBody, box(0.016, 0.084, 0.028, 0.002), steelMat('#55595f', 0.4), 0, -0.036, 0.002);
  add(magBody, box(0.022, 0.007, 0.036, 0.002), black, 0, -0.082, 0.004);
  add(magBody, box(0.004, 0.006, 0.006, 0.001), steelMat('#b8975a', 0.3), 0, 0.006, -0.008); // top round
  // magazine release button behind the guard
  add(root, box(0.028, 0.006, 0.006, 0.002), bright, 0, 0.034, -0.008);
  const muzzle = V3(0, 0.066, -0.296);
  const flash = buildFlash(muzzle, 0.045);
  bakeParts(root, true);
  root.add(flash);
  return { root, sightY: 0.094, muzzle, parts: { slide, mag }, flash };
}

// ------------------------------------------------------------------ per-weapon handling

interface Handling {
  /** First-person scale of the model (hands are 1.3; long guns read better a little smaller). */
  scale: number;
  /** Weapon frame relative to the right hand's grip anchor (pos, euler YXZ). */
  attach: F6;
  /** Weapon frames in hand space (pre-VIEW_SCALE metres): hip, sprinting, lowered (draw/holster). */
  hip: F6;
  run: F6;
  low: F6;
  /** Distance of the weapon origin in front of the eye when aimed. */
  adsZ: number;
  /** Left wrist frame relative to the weapon (model space), or null: the left hand stays free. */
  left: F6 | null;
  /** Two-handed pistol grip: the left hand is the right hand mirrored across the gun, then moved by
   *  [x, y, z] (model space) and turned `yaw` about the gun's up axis, so the support palm presses
   *  against the gripping fingers (thumbs forward). Overrides `left`. */
  mirror?: [number, number, number, number];
  /** Finger curls: right [i, m, r, p, thumb, oppose], left likewise. */
  rCurl: [number, number, number, number, number, number];
  lCurl: [number, number, number, number, number, number];
  /** Reload: the weapon's frame while loading, the point (model space) the left hand loads at, and
   *  the left wrist's orientation (hand space euler) while it carries a round. */
  reload: F6;
  loadAt: [number, number, number];
  loadRot: [number, number, number];
}

const HANDLING: Record<WeaponId, Handling> = {
  revolver: {
    scale: 1.45,
    attach: [0, -0.004, 0.006, 0.05, 0, Math.PI / 2],
    hip: [0.13, -0.17, -0.42, 0.04, 0.09, 0.02],
    run: [0.16, -0.3, -0.34, -0.55, 0.5, 0.25],
    low: [0.16, -0.62, -0.3, -1.1, 0.3, 0],
    adsZ: -0.46,
    // two-handed: the left hand wraps the right, thumbs forward along the frame
    left: null,
    mirror: [-0.026, -0.02, -0.026, 0.55],
    rCurl: [0.62, 0.9, 0.95, 1, 0.55, 0.7],
    lCurl: [0.62, 0.7, 0.78, 0.86, 0.2, 0.4],
    // muzzle up, cylinder swung out to the left facing you
    reload: [0.05, -0.22, -0.46, 0.85, 0.35, -0.55],
    loadAt: [-0.026, 0.046, -0.012],
    loadRot: [0.9, 0.35, -2.2],
  },
  shotgun: {
    scale: 1.15,
    attach: [0, -0.004, 0.008, 0.1, 0, Math.PI / 2],
    hip: [0.15, -0.21, -0.24, -0.03, 0.1, 0.05],
    run: [0.12, -0.26, -0.2, -0.4, 0.75, 0.6],
    low: [0.14, -0.6, -0.16, -1.0, 0.4, 0.2],
    adsZ: -0.24,
    left: [-0.03, -0.036, -0.3, 0.2, -1.0, -Math.PI + 0.62],
    rCurl: [0.55, 0.92, 0.97, 1, 0.6, 0.7],
    lCurl: [0.5, 0.58, 0.64, 0.7, 0.4, 0.45],
    // rolled onto its right side: the loading port faces you
    reload: [0.08, -0.25, -0.26, 0.3, 0.3, 1.0],
    loadAt: [0, 0.014, -0.1],
    loadRot: [0.2, 0.5, -2.6],
  },
  rifle: {
    scale: 1.15,
    attach: [0, -0.002, 0.01, 0.2, 0, Math.PI / 2],
    hip: [0.15, -0.2, -0.24, -0.03, 0.1, 0.04],
    run: [0.12, -0.26, -0.2, -0.4, 0.75, 0.6],
    low: [0.14, -0.6, -0.16, -1.0, 0.4, 0.2],
    adsZ: -0.22,
    left: [-0.03, -0.034, -0.25, 0.2, -1.0, -Math.PI + 0.62],
    rCurl: [0.5, 0.92, 0.97, 1, 0.6, 0.7],
    lCurl: [0.5, 0.58, 0.64, 0.7, 0.4, 0.45],
    // rolled onto its left side: the gate on the right faces up and in
    reload: [0.07, -0.22, -0.27, 0.28, 0.35, -0.95],
    loadAt: [0.017, 0.03, -0.12],
    loadRot: [0.4, 0.2, -2.3],
  },
  pistol22: {
    scale: 1.45,
    attach: [0, -0.004, 0.006, 0.05, 0, Math.PI / 2],
    hip: [0.13, -0.17, -0.42, 0.04, 0.09, 0.02],
    run: [0.16, -0.3, -0.34, -0.55, 0.5, 0.25],
    low: [0.16, -0.62, -0.3, -1.1, 0.3, 0],
    adsZ: -0.44,
    left: null,
    mirror: [-0.026, -0.02, -0.026, 0.55],
    rCurl: [0.62, 0.9, 0.95, 1, 0.55, 0.7],
    lCurl: [0.62, 0.7, 0.78, 0.86, 0.2, 0.4],
    // canted right and tipped up, the mag well toward the left hand
    reload: [0.04, -0.2, -0.42, 0.35, 0.2, -0.5],
    loadAt: [0, -0.07, 0.03],
    loadRot: [0.5, 0.6, -2.9],
  },
  crowbar: {
    scale: 1.3,
    attach: [0, 0, 0.0, 0, 0, Math.PI / 2],
    hip: [0.22, -0.24, -0.34, 0.55, 0.5, 0.45],
    run: [0.22, -0.32, -0.3, 0.2, 0.6, 0.7],
    low: [0.2, -0.62, -0.3, -0.4, 0.2, 0.2],
    adsZ: -0.4,
    left: null,
    rCurl: [0.95, 1, 1, 1, 0.75, 0.8],
    lCurl: [0.35, 0.35, 0.4, 0.45, 0.35, 0.25],
    reload: [0.22, -0.24, -0.34, 0.55, 0.5, 0.45],
    loadAt: [0, 0, 0],
    loadRot: [0, 0, 0],
  },
};

/** Crowbar swing keys (weapon frames, hand space): wind-up, strike end. Mirrored for the backhand. */
const SWING: { wind: F6; end: F6 }[] = [
  { wind: [0.33, 0.03, -0.3, 1.25, -0.45, 0.9], end: [-0.24, -0.3, -0.42, -0.25, 1.05, -0.35] },
  { wind: [-0.27, 0.02, -0.32, 1.15, 0.5, -0.85], end: [0.3, -0.3, -0.4, -0.25, -0.95, 0.4] },
];
/** Gun-butt bash: the weapon punched forward and canted. */
const BASH: F6 = [0.02, -0.12, -0.5, -0.25, -0.35, 0.55];

// ------------------------------------------------------------------ the view

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _inv = new THREE.Matrix4();
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _one = new THREE.Vector3(1, 1, 1);
/** Mirror across x (conjugating a frame by it gives its left-right mirror image). */
const _mx = new THREE.Matrix4().makeScale(-1, 1, 1);
/** The right hand's grip anchor in its wrist frame (HandRig: grip at (s·0.004, −0.03, −0.062), s = −1). */
const RIGHT_GRIP = new THREE.Vector3(-0.004, -0.03, -0.062);

function frameMatrix(f: F6, out: THREE.Matrix4, scale = 1) {
  _e.set(f[3], f[4], f[5], 'YXZ');
  return out.compose(_p.set(f[0], f[1], f[2]), _q.setFromEuler(_e), _s.set(scale, scale, scale));
}

/** A 6-channel critically-damped (or bouncy) spring, for weapon offsets. */
class Spring6 {
  x = new Float32Array(6);
  v = new Float32Array(6);
  constructor(public w: number, public zeta = 1) {}
  step(target: ArrayLike<number>, dt: number) {
    const w = this.w, z = this.zeta;
    for (let i = 0; i < 6; i++) {
      const a = w * w * (target[i] - this.x[i]) - 2 * z * w * this.v[i];
      this.v[i] += a * dt;
      this.x[i] += this.v[i] * dt;
    }
  }
  set(f: ArrayLike<number>) { for (let i = 0; i < 6; i++) { this.x[i] = f[i]; this.v[i] = 0; } }
}

export type ArmsState = 'none' | 'draw' | 'ready' | 'holster';

export interface ArmsFrame {
  dt: number;
  ads: boolean;
  sprint: boolean;
  speed: number;
  grounded: boolean;
  crouch: boolean;
  bobPhase: number;
  lookDX: number;
  lookDY: number;
  /** Marksman / breath held: no sway while aimed. */
  steady: boolean;
}

/**
 * The weapon in your hands. Game logic (ammo, timing, hits) lives in PlayerArms; this only shows it.
 * Call `update` each frame from Hands, which then reads `rightRoot` / `leftRoot` to place the hands.
 */
export class Arms {
  readonly root = new THREE.Group();
  readonly models: Record<WeaponId, ArmsModel>;
  current: WeaponId | null = null;
  state: ArmsState = 'none';
  /** 0..1 how aimed (eased): Combat reads it for spread, FOV and the HUD. */
  ads = 0;
  /** The hands should follow the weapon this frame. */
  holding = false;
  /** The left hand is on the weapon this frame (else Hands poses it as usual). */
  leftOn = false;
  /** Wrist frames for the hands (Hands.root space), valid when `holding`. */
  readonly rightRoot = new THREE.Matrix4();
  readonly leftRoot = new THREE.Matrix4();
  rCurl: number[] = [0, 0, 0, 0, 0, 0];
  lCurl: number[] = [0, 0, 0, 0, 0, 0];
  /** Muzzle position in world space, refreshed each update (tracers start here). */
  readonly muzzleWorld = new THREE.Vector3();
  /** Where a weapon-mounted torch sits and points (Hands.root space), when a long gun is up. */
  readonly torchPos = new THREE.Vector3();
  readonly torchDir = new THREE.Vector3(0, 0, -1);

  private pose = new Spring6(13, 1);
  private recoil = new Spring6(34, 0.42);
  private sway = new THREE.Vector2();
  private swayV = new THREE.Vector2();
  private t = 0;
  private stateT = 0;
  private drawTime = 0.4;
  private next: WeaponId | null = null;
  private flashT = 0;
  private cylAngle = 0;
  private cylTarget = 0;
  private hammerT = 0;
  private pumpT = -1;
  private leverT = -1;
  private slideT = -1;
  private slideLocked = false;
  private reload: { phase: 'open' | 'load' | 'close'; t: number; dur: number } | null = null;
  private loadCycle = -1;
  private swing: { t: number; dur: number; k: number; hitAt: number; onHit?: () => void; hit: boolean; bash: boolean } | null = null;
  private swingSide = 1;
  private lowered = 0;
  private triggerT = 0;
  private breath = 0;

  constructor() {
    this.models = { revolver: revolver(), shotgun: shotgun(), rifle: rifle(), crowbar: crowbar(), pistol22: pistol22() };
    for (const m of Object.values(this.models)) {
      m.root.visible = false;
      this.root.add(m.root);
    }
  }

  /** Every model shown (shader warm-up). Returns the undo. */
  stage() {
    const shown: THREE.Object3D[] = [];
    for (const m of Object.values(this.models)) {
      if (!m.root.visible) { m.root.visible = true; shown.push(m.root); }
      if (m.flash && !m.flash.visible) { m.flash.visible = true; shown.push(m.flash); }
    }
    flashIntensity.value = 0.001;
    return () => { for (const o of shown) o.visible = false; };
  }

  get busy() {
    return this.state === 'draw' || this.state === 'holster' || !!this.reload || !!this.swing;
  }
  get reloading() {
    return !!this.reload;
  }
  get swinging() {
    return !!this.swing;
  }

  /** Bring `id` up (puts the current one away first). Null holsters. */
  equip(id: WeaponId | null, drawTime = 0.4) {
    this.drawTime = drawTime;
    if (id === this.current && (this.state === 'ready' || this.state === 'draw')) return;
    if (this.current && this.state !== 'none') {
      this.next = id;
      this.state = 'holster';
      this.stateT = 0;
      this.reload = null;
      this.swing = null;
      return;
    }
    this.next = null;
    this.show(id);
  }

  private show(id: WeaponId | null) {
    for (const [k, m] of Object.entries(this.models)) m.root.visible = k === id;
    this.current = id;
    this.reload = null;
    this.swing = null;
    if (!id) { this.state = 'none'; this.holding = false; return; }
    this.state = 'draw';
    this.stateT = 0;
    const h = HANDLING[id];
    this.pose.set(h.low);
    this.recoil.set([0, 0, 0, 0, 0, 0]);
  }

  /** Recoil + flash + the action's motion. `k` scales the kick (Firearms ranks, aiming). */
  fire(k = 1) {
    const id = this.current;
    if (!id) return;
    const m = this.models[id];
    const big = id === 'shotgun' ? 1.6 : id === 'rifle' ? 1.25 : id === 'pistol22' ? 0.42 : 1;
    // back, up and a random twist; aimed shots kick less sideways
    this.recoil.v[2] += 1.6 * big * k;
    this.recoil.v[3] += (5.5 + Math.random() * 2) * big * k;
    this.recoil.v[4] += (Math.random() - 0.5) * 2.2 * big * k;
    this.recoil.v[5] += (Math.random() - 0.5) * 3 * big * k;
    this.recoil.v[1] += 0.35 * big * k;
    if (m.flash) {
      this.flashT = 0.045;
      m.flash.rotation.z = Math.random() * Math.PI;
      flashSeed.value = Math.random() * 6.28;
    }
    this.triggerT = 0.12;
    if (id === 'revolver') { this.cylTarget += Math.PI / 3; this.hammerT = 0.0; }
    if (id === 'shotgun') this.pumpT = 0;
    if (id === 'rifle') this.leverT = 0;
    if (id === 'pistol22') this.slideT = 0;
  }

  /** The pistol's slide stays back on an empty magazine (until the reload's slide release). */
  slideLock(on: boolean) {
    this.slideLocked = on;
  }

  /** Pull the trigger on nothing. */
  dryFire() {
    this.triggerT = 0.12;
    this.recoil.v[3] += 0.4;
  }

  /** Reload choreography: open (once), then `load()` per round, then `close()`. */
  reloadOpen(dur: number) { this.reload = { phase: 'open', t: 0, dur }; this.loadCycle = -1; }
  reloadLoad(dur: number) { this.reload = { phase: 'load', t: 0, dur }; this.loadCycle = 0; }
  reloadClose(dur: number) { this.reload = { phase: 'close', t: 0, dur }; }
  reloadCancel() { this.reload = null; }

  /** Crowbar swing (alternating forehand/backhand) or, with a gun up, a butt-stroke. */
  melee(dur: number, hitAt: number, onHit: () => void) {
    const bash = this.current !== 'crowbar';
    this.swing = { t: 0, dur, k: 0, hitAt, onHit, hit: false, bash };
    if (!bash) this.swingSide ^= 1;
    this.reload = null;
  }

  /** Hands are busy elsewhere (interacting, eating, a throw): drop the weapon out of view for a moment. */
  lower(on: boolean) {
    this.lowered = on ? 1 : 0;
  }

  update(f: ArmsFrame, hands: THREE.Object3D) {
    const dt = f.dt;
    this.t += dt;
    this.stateT += dt;
    const id = this.current;
    this.holding = false;
    this.leftOn = false;
    if (!id) return;
    const h = HANDLING[id];
    const m = this.models[id];

    // --- state machine: draw ↔ ready ↔ holster
    if (this.state === 'draw' && this.stateT >= this.drawTime) this.state = 'ready';
    if (this.state === 'holster' && this.stateT >= this.drawTime * 0.8) {
      const nx = this.next;
      this.next = null;
      this.show(nx);
      if (!nx) return;
    }

    // --- target frame
    const target: number[] = [...h.hip];
    const adsWanted = f.ads && this.state === 'ready' && !this.reload && !this.swing && !f.sprint && id !== 'crowbar' && this.lowered < 0.5;
    this.ads += ((adsWanted ? 1 : 0) - this.ads) * (1 - Math.exp(-(adsWanted ? 13 : 10) * dt));
    const adsFrame: F6 = [0, -m.sightY * h.scale, h.adsZ, 0, 0, 0];
    for (let i = 0; i < 6; i++) target[i] += (adsFrame[i] - target[i]) * this.ads;
    const runK = f.sprint && f.grounded && !this.swing && !this.reload ? 1 : 0;
    if (runK) for (let i = 0; i < 6; i++) target[i] = h.run[i];
    if (this.state === 'draw' && this.stateT < 0.02) this.pose.set(h.low);
    if (this.state === 'holster' || this.lowered > 0.5) for (let i = 0; i < 6; i++) target[i] = h.low[i];
    if (this.reload) {
      const r = this.reload;
      r.t += dt;
      const into = r.phase === 'open' ? Math.min(1, r.t / r.dur) : r.phase === 'close' ? 1 - Math.min(1, r.t / r.dur) : 1;
      const k = into * into * (3 - 2 * into);
      for (let i = 0; i < 6; i++) target[i] = h.hip[i] + (h.reload[i] - h.hip[i]) * k;
      if (r.phase === 'load') this.loadCycle = Math.min(1, r.t / r.dur);
      if (r.t >= r.dur && r.phase !== 'load') { if (r.phase === 'close') this.reload = null; }
    }
    let swingFrame: F6 | null = null;
    if (this.swing) {
      const s = this.swing;
      s.t += dt;
      const u = s.t / s.dur;
      if (s.bash) {
        const k = u < 0.35 ? Math.sin((u / 0.35) * Math.PI / 2) : Math.max(0, 1 - (u - 0.35) / 0.65);
        swingFrame = [...h.hip] as F6;
        for (let i = 0; i < 3; i++) swingFrame[i] = h.hip[i] + (BASH[i] - h.hip[i]) * k;
        for (let i = 3; i < 6; i++) swingFrame[i] = h.hip[i] + BASH[i] * k;
      } else {
        const key = SWING[this.swingSide];
        // wind-up (ease out), strike (fast, ease in), follow-through, recover
        const wEnd = 0.32, sEnd = 0.52;
        const out: number[] = [];
        for (let i = 0; i < 6; i++) {
          let v: number;
          if (u < wEnd) { const k = Math.sin((u / wEnd) * Math.PI / 2); v = h.hip[i] + (key.wind[i] - h.hip[i]) * k; }
          else if (u < sEnd) { const k = Math.pow((u - wEnd) / (sEnd - wEnd), 1.6); v = key.wind[i] + (key.end[i] - key.wind[i]) * k; }
          else { const k = (u - sEnd) / (1 - sEnd); const e = k * k * (3 - 2 * k); v = key.end[i] + (h.hip[i] - key.end[i]) * e; }
          out.push(v);
        }
        swingFrame = out as F6;
      }
      if (!s.hit && s.t >= s.hitAt) { s.hit = true; s.onHit?.(); }
      if (s.t >= s.dur) this.swing = null;
    }

    // --- springs: pose follows the target; the swing drives the frame directly (it is the animation)
    this.pose.w = this.swing ? 30 : runK ? 9 : this.ads > 0.5 ? 18 : 13;
    this.pose.step(swingFrame ?? target, dt);
    this.recoil.step([0, 0, 0, 0, 0, 0], dt);

    // --- sway (lags the mouse), gait bob, breathing; all damped while aimed
    const adsK = 1 - this.ads * (f.steady ? 0.97 : 0.82);
    const tgt = _v2.set(-f.lookDX * 0.0003, f.lookDY * 0.0003).clampLength(0, 0.06);
    this.swayV.addScaledVector(tgt.sub(this.sway), 110 * dt);
    this.swayV.multiplyScalar(Math.exp(-13 * dt));
    this.sway.addScaledVector(this.swayV, dt);
    const move = Math.min(1, f.speed / 3.4) * (f.grounded ? 1 : 0);
    const bobX = Math.sin(f.bobPhase) * 0.01 * move;
    const bobY = (Math.abs(Math.cos(f.bobPhase)) - 0.5) * 0.014 * move;
    this.breath += dt;
    const br = Math.sin(this.breath * 1.4) * 0.003 + Math.sin(this.breath * 0.43) * 0.0015;
    // aimed: a slow figure-eight of the muzzle, unless steady
    const aimSway = this.ads * (f.steady ? 0.08 : 1);
    const ax = Math.sin(this.t * 0.9) * 0.0035 * aimSway, ay = Math.sin(this.t * 1.7) * 0.0022 * aimSway;

    const P = this.pose.x, R = this.recoil.x;
    const frame: F6 = [
      P[0] + (bobX + this.sway.x) * adsK + R[0],
      P[1] + (bobY + br + this.sway.y) * adsK + R[1] * 0.02,
      P[2] + R[2] * 0.03,
      P[3] + (this.sway.y * 2) * adsK + R[3] * 0.022 + ay,
      P[4] + (this.sway.x * 1.6) * adsK + R[4] * 0.015 + ax,
      P[5] + this.sway.x * 2.5 * adsK + R[5] * 0.02,
    ];
    frameMatrix(frame, m.root.matrix, h.scale);
    m.root.matrixAutoUpdate = false;
    m.root.matrixWorldNeedsUpdate = true;

    // --- moving parts
    this.cylAngle += (this.cylTarget - this.cylAngle) * (1 - Math.exp(-28 * dt));
    if (m.parts.cylinder) m.parts.cylinder.rotation.z = this.cylAngle;
    if (m.parts.cylPivot) {
      // swing the cylinder out to the left on its crane while reloading
      const out = this.reload ? (this.reload.phase === 'open' ? Math.min(1, this.reload.t / (this.reload.dur * 0.7)) : this.reload.phase === 'close' ? Math.max(0, 1 - this.reload.t / (this.reload.dur * 0.6)) : 1) : 0;
      m.parts.cylPivot.position.set(-0.026 * out, 0.058 - 0.012 * out, -0.036);
      m.parts.cylPivot.rotation.z = -out * 0.25;
    }
    this.hammerT += dt;
    if (m.parts.hammer) {
      // revolver: double action, the hammer rises with the trigger and falls on the shot
      const cock = id === 'revolver' ? Math.max(0, 1 - this.hammerT * 9) : this.leverT >= 0 && this.leverT < 0.5 ? Math.sin(this.leverT * 2 * Math.PI) : 0;
      m.parts.hammer.rotation.x = cock * 0.6;
    }
    if (this.pumpT >= 0) {
      this.pumpT += dt;
      const u = Math.min(1, (this.pumpT - 0.18) / 0.4);
      const k = u <= 0 ? 0 : Math.sin(u * Math.PI);
      if (m.parts.pump) m.parts.pump.position.z = -0.36 + 0.085 * k;
      if (this.pumpT > 0.6) this.pumpT = -1;
    }
    if (this.leverT >= 0) {
      this.leverT += dt;
      const u = Math.min(1, (this.leverT - 0.15) / 0.45);
      const k = u <= 0 ? 0 : Math.sin(u * Math.PI);
      if (m.parts.lever) m.parts.lever.rotation.x = k * 0.85;
      if (this.leverT > 0.62) this.leverT = -1;
    }
    if (m.parts.slide) {
      // a blowback slide: snaps back and returns in ~60 ms; locked back while empty until the release
      let back = 0;
      if (this.slideT >= 0) {
        this.slideT += dt;
        const u = this.slideT / 0.07;
        back = u < 0.35 ? u / 0.35 : Math.max(0, 1 - (u - 0.35) / 0.65);
        if (this.slideT > 0.07) this.slideT = -1;
      }
      const rel = this.reload?.phase === 'close' ? Math.min(1, this.reload.t / (this.reload.dur * 0.35)) : 0;
      if (this.slideLocked && (!this.reload || this.reload.phase !== 'close')) back = Math.max(back, 0.82);
      else if (this.reload?.phase === 'close' && this.slideLocked) back = 0.82 * (1 - rel);
      if (this.reload?.phase === 'close' && rel >= 1) this.slideLocked = false;
      m.parts.slide.position.z = -0.046 + 0.026 * back;
    }
    if (m.parts.mag) {
      // out with a flick and gone below the frame; the fresh one rides up in the left hand
      const r = this.reload;
      const seat = _magSeat.set(0, 0.012, 0.012);
      if (r && r.phase === 'open') {
        const u = Math.min(1, r.t / r.dur);
        m.parts.mag.position.set(0, seat.y - 0.5 * u * u - 0.02 * u, seat.z + 0.03 * u);
      } else if (r && r.phase === 'load') {
        const c = this.loadCycle;
        if (c < 0.45) m.parts.mag.position.set(0, -0.6, 0);
        else {
          // from the pocket to the well, following the hand (same curve as the left hand below)
          const k = Math.sin(((c - 0.45) / 0.55) * Math.PI / 2);
          _inv.copy(m.root.matrix).invert();
          const from = _p.set(-0.06, -0.42, -0.26).applyMatrix4(_inv);
          m.parts.mag.position.set(from.x + (seat.x - from.x) * k, from.y + (seat.y - from.y) * k, from.z + (seat.z - from.z) * k);
        }
      } else m.parts.mag.position.copy(seat);
    }
    // muzzle flash: a frame or two, then gone
    if (m.flash) {
      this.flashT -= dt;
      m.flash.visible = this.flashT > 0;
      flashIntensity.value = this.flashT > 0 ? 6.5 : 0;
    }

    // --- hands
    this.holding = true;
    // right wrist = weapon · attach⁻¹ · grip⁻¹ (grip offset added by Hands, which knows the rig). The
    // hand is always 1.3: the attach carries the ratio when the model is drawn at another scale.
    frameMatrix(h.attach, _m2, h.scale / 1.3);
    _inv.copy(_m2).invert();
    this.rightRoot.multiplyMatrices(m.root.matrix, _inv);
    // left hand: on the forend, or shuttling rounds while reloading
    if (h.left || h.mirror) {
      if (h.mirror) {
        // the right wrist in gun space, mirrored across the gun's x and shifted beside it
        _m2.copy(_inv).multiply(_m.makeTranslation(-RIGHT_GRIP.x, -RIGHT_GRIP.y, -RIGHT_GRIP.z));
        _m2.premultiply(_mx).multiply(_mx);
        _m2.premultiply(_m.makeRotationY(h.mirror[3]));
        _m2.premultiply(_m.makeTranslation(h.mirror[0], h.mirror[1], h.mirror[2]));
      } else frameMatrix(h.left!, _m2, 1.3 / h.scale);
      this.leftRoot.multiplyMatrices(m.root.matrix, _m2);
      this.leftOn = !this.swing || this.swing.bash;
      if (this.reload) {
        // between the pocket and the loading point; the hand detaches while the gun is tilted
        const fetch = new THREE.Vector3(-0.06, -0.42, -0.26);
        const load = _p.set(h.loadAt[0], h.loadAt[1], h.loadAt[2]).applyMatrix4(m.root.matrix);
        let k: number;
        if (this.reload.phase === 'load') { const c = this.loadCycle; k = c < 0.45 ? 1 - Math.sin((c / 0.45) * Math.PI / 2) : Math.sin(((c - 0.45) / 0.55) * Math.PI / 2); }
        else k = this.reload.phase === 'open' ? Math.min(1, this.reload.t / this.reload.dur) : Math.max(0, 1 - this.reload.t / this.reload.dur) * 0.9;
        const pos = fetch.lerp(load, k);
        // fingers pinching a round, wrist turned toward the gun
        _e.set(h.loadRot[0], h.loadRot[1], h.loadRot[2], 'YXZ');
        this.leftRoot.compose(pos, _q.setFromEuler(_e), _s.set(1.3, 1.3, 1.3));
        this.lCurl = [0.55, 0.85, 0.95, 1, 0.55, 0.85];
      } else this.lCurl = [...h.lCurl];
      if (!this.leftOn) this.lCurl = [...h.lCurl];
    }
    this.rCurl = [...h.rCurl];
    // trigger finger squeezes on a shot
    this.triggerT = Math.max(0, this.triggerT - dt);
    if (id !== 'crowbar') this.rCurl[0] = h.rCurl[0] + (this.triggerT > 0 ? 0.18 : 0);
    // pump hand rides the pump
    if (id === 'shotgun' && this.pumpT >= 0 && !this.reload) {
      const u = Math.min(1, Math.max(0, (this.pumpT - 0.18) / 0.4));
      this.leftRoot.multiply(_m.makeTranslation(0, 0, 0.085 * Math.sin(u * Math.PI)));
    }

    // muzzle + torch positions
    hands.updateWorldMatrix(true, false);
    _p.copy(m.muzzle).applyMatrix4(m.root.matrix);
    this.muzzleWorld.copy(_p).applyMatrix4(hands.matrixWorld);
    // a torch taped under the barrel, a hand's width behind the muzzle
    this.torchPos.set(m.muzzle.x, m.muzzle.y - 0.03, m.muzzle.z + 0.12).applyMatrix4(m.root.matrix);
    this.torchDir.set(0, 0, -1).transformDirection(m.root.matrix);
    void _one;
  }
}

const _v2 = new THREE.Vector2();
const _magSeat = new THREE.Vector3();

/**
 * Turn a wrist frame (Hands.root space, scale 1.3) for `rig` into its HandPose channels: the grip
 * anchor offset is removed (for the right hand: the weapon was placed relative to the anchor), and
 * the left hand's mirroring is undone.
 */
export function poseFromRoot(rig: HandRig, side: 1 | -1, m: THREE.Matrix4, gripRelative: boolean, out: HandPose) {
  _m.copy(m);
  if (gripRelative) _m.multiply(_m2.makeTranslation(-rig.grip.position.x, -rig.grip.position.y, -rig.grip.position.z));
  _m.decompose(_p, _q, _s);
  _e.setFromQuaternion(_q, 'YXZ');
  out.pos.set(_p.x * side, _p.y, _p.z);
  out.rot.set(_e.x, _e.y * side, _e.z * side, 'YXZ');
}

export { E as eulerYXZ };
