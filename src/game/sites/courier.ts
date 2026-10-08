import * as THREE from 'three/webgpu';
import type { GameContext } from '../context';
import type { Landmarks } from '../world/Landmarks';
import { MeshBatch, canvasTexture, grime, shadowProxy } from '../world/kit';
import { desertRock, fabric, glow, leather, plainStandard, rustyMetal, wood } from '../world/materials';
import { rockGeometry } from '../world/Props';
import { VirtualLight } from '../world/lights';
import { ITEMS } from '@/content/items';
import { Site } from './Site';

/** Story flags (see Site.ts). The quest is Hollis's "Ten Minutes or Free" (content/quests.ts). */
const F = {
  found: 'site.courier.found',
  done: 'site.courier.done',
  box: 'site.courier.box',
  blanket: 'site.courier.blanket',
  log: 'q.rider.log',
  rated: 'q.rider.rated',
} as const;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
/** Place a part: Euler YXZ, uniform or per-axis scale. */
const T = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: number | THREE.Vector3 = 1) =>
  g.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), typeof s === 'number' ? V(s, s, s) : s));
/** Cylinder between two points. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6) {
  const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b), seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1)));
}

/** One canvas: the Dropt box decal (left), the rider's cardboard sign (middle), the phone screen (right). */
function atlas() {
  return canvasTexture(1024, 512, (c, w, h) => {
    const mint = '#3fc9a9';
    // --- the box decal: 0..384
    c.fillStyle = mint;
    c.fillRect(0, 0, 384, h);
    c.fillStyle = '#16302b';
    c.beginPath();
    c.arc(192, 170, 92, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = mint;
    c.beginPath(); // the pin with a bolt through it
    c.moveTo(192, 236); c.bezierCurveTo(140, 170, 140, 108, 192, 104); c.bezierCurveTo(244, 108, 244, 170, 192, 236);
    c.fill();
    c.fillStyle = '#16302b';
    c.beginPath();
    c.moveTo(200, 118); c.lineTo(174, 168); c.lineTo(194, 168); c.lineTo(184, 208); c.lineTo(212, 152); c.lineTo(192, 152); c.lineTo(204, 118);
    c.fill();
    c.font = '900 108px "Big Shoulders Stencil Display", Impact, sans-serif';
    c.textAlign = 'center';
    c.fillText('DROPT', 192, 360);
    c.font = '700 30px "Chakra Petch", sans-serif';
    c.fillText('10 MIN OR IT\'S FREE', 192, 410);
    c.font = '600 20px "JetBrains Mono", monospace';
    c.fillText('RIDER 9 · ★ 4.9', 192, 462);
    grime(c, 384, h, 0.9, 3);
    // --- the cardboard sign: 384..704
    c.save();
    c.translate(384, 0);
    c.fillStyle = '#b58d5c';
    c.fillRect(0, 0, 320, h);
    c.strokeStyle = 'rgba(80,55,30,0.35)';
    c.lineWidth = 2;
    for (let i = 0; i < 26; i++) { c.beginPath(); c.moveTo(0, i * 20 + 6); c.lineTo(320, i * 20 + 9); c.stroke(); }
    c.fillStyle = '#1b1a1d';
    c.font = '700 54px "Chakra Petch", sans-serif';
    c.textAlign = 'center';
    const line = (t: string, y: number, r: number, size = 54) => {
      c.save(); c.translate(160, y); c.rotate(r); c.font = `700 ${size}px "Chakra Petch", sans-serif`; c.fillText(t, 0, 0); c.restore();
    };
    line('ORDER #1047', 96, -0.04, 46);
    line('RUNNING', 200, 0.03);
    line('LATE', 270, -0.02, 70);
    line('SORRY', 372, 0.05);
    line('— R9', 450, -0.03, 34);
    grime(c, 320, h, 1.2, 5);
    c.restore();
    // --- the phone screen: 704..1024 (portrait)
    c.save();
    c.translate(704, 0);
    c.fillStyle = '#0d1714';
    c.fillRect(0, 0, 320, h);
    c.fillStyle = mint;
    c.fillRect(0, 0, 320, 70);
    c.fillStyle = '#0d1714';
    c.font = '900 44px "Big Shoulders Stencil Display", Impact, sans-serif';
    c.textAlign = 'center';
    c.fillText('DROPT', 160, 52);
    c.fillStyle = '#e8fff8';
    c.font = '700 30px "Chakra Petch", sans-serif';
    c.fillText('You\'re on a roll!', 160, 130);
    c.font = '900 120px "Big Shoulders Stencil Display", Impact, sans-serif';
    c.fillStyle = mint;
    c.fillText('1,281', 160, 260);
    c.font = '600 22px "JetBrains Mono", monospace';
    c.fillStyle = '#9fd8c8';
    c.fillText('DAY STREAK', 160, 296);
    c.fillStyle = '#ff6a4a';
    c.fillRect(30, 340, 260, 64);
    c.fillStyle = '#fff';
    c.font = '700 26px "Chakra Petch", sans-serif';
    c.fillText('ORDER RUNNING LATE', 160, 382);
    c.fillStyle = '#ffd36a';
    c.font = '400 40px sans-serif';
    c.fillText('★★★★★', 160, 466);
    c.restore();
  });
}

/**
 * The Last Mile: where Rider 9, a Dropt courier who never stopped delivering, stopped. A cargo
 * e-bike on its side with a taco'd front wheel, the insulated box set up as a table, a tarp lean-to,
 * a cold fire ring, a whip flag planted so the next rider could find him, and his phone on a
 * folding solar panel, still showing the streak. One MeshBatch (+ the decal and the screen), a flat
 * far stand-in, and two lights at night: the bike's tail light blinking and the screen's glow.
 */
export class CourierSite extends Site {
  private tail: { value: number };
  private screen: VirtualLight;
  private screenMat: THREE.MeshBasicNodeMaterial;
  private t = 0;

  constructor(ctx: GameContext, landmarks: Landmarks) {
    super('courier', ctx, landmarks);
    const root = new THREE.Group();
    root.name = 'courier';
    root.applyMatrix4(this.frame.m);
    this.group.add(root);
    const mb = new MeshBatch();
    const decals = new MeshBatch();
    const tex = atlas();
    const decal = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide });
    this.screenMat = new THREE.MeshBasicNodeMaterial({ map: tex });
    const M = {
      paint: rustyMetal({ base: '#36b89a', rust: 0.35, metalness: 0.35, roughness: 0.5 }),
      dark: rustyMetal({ base: '#2b2e30', rust: 0.2, metalness: 0.5, roughness: 0.55 }),
      steel: rustyMetal({ base: '#a3a39d', rust: 0.25, metalness: 0.8, roughness: 0.4 }),
      rubber: plainStandard('#161514', 0.92),
      boxBody: plainStandard('#3fbea0', 0.7),
      boxBand: plainStandard('#1d3a33', 0.7),
      boxLiner: plainStandard('#c9cfcf', 0.45, 0.6),
      tarp: fabric('#46617a'),
      bedroll: fabric('#5f6440'),
      mylar: plainStandard('#d2b768', 0.34, 0.8),
      boot: leather('#3a2a1e'),
      card: plainStandard('#a67c52', 0.92),
      tape: plainStandard('#cdb57c', 0.55),
      rock: desertRock(),
      stick: wood('#5c452e'),
      char: wood('#221a14'),
      pennant: fabric('#ff6a1a'),
      whip: plainStandard('#e8e2d2', 0.5),
      panel: plainStandard('#18263a', 0.25, 0.35),
      phone: plainStandard('#101113', 0.35, 0.2),
      bottle: plainStandard('#8fb3bd', 0.2),
    };
    const red = glow('#ff2410', 0);
    this.tail = red.intensity as unknown as { value: number };

    // ---------------------------------------------------------------- the bike, on its side
    // built upright (x along the bike, y up, z across), then laid over and placed
    const bike: [THREE.Material, THREE.BufferGeometry][] = [];
    const B = (m: THREE.Material, g: THREE.BufferGeometry) => bike.push([m, g]);
    const R = 0.3, rearX = -0.78, frontX = 0.74;
    const wheel = (x: number, bent: number) => {
      const lean = new THREE.Matrix4().makeRotationY(bent);
      const tyre = new THREE.TorusGeometry(R, 0.036, 8, 28);
      const rim = new THREE.TorusGeometry(R - 0.035, 0.012, 5, 28);
      if (bent) { tyre.scale(1, 0.9, 1); rim.scale(1, 0.9, 1); }
      B(M.rubber, T(tyre.applyMatrix4(lean), x, R, 0));
      B(M.steel, T(rim.applyMatrix4(lean), x, R, 0));
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const p = V(Math.cos(a) * (R - 0.04), Math.sin(a) * (R - 0.04) * (bent ? 0.9 : 1), (i % 2 ? 0.02 : -0.02)).applyMatrix4(lean);
        B(M.steel, rod(V(x, R, 0), V(x + p.x, R + p.y, p.z), 0.003, 3));
      }
      B(M.dark, T(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 10).rotateX(Math.PI / 2), x, R, 0));
    };
    wheel(rearX, 0);
    wheel(frontX, 0.22);
    const head = V(0.5, 0.82, 0), headLo = V(0.56, 0.62, 0), bb = V(-0.06, 0.3, 0), seat = V(-0.24, 0.78, 0);
    B(M.paint, rod(head, headLo, 0.03, 8));
    B(M.paint, rod(headLo, bb, 0.032, 8)); // step-through down tube
    B(M.paint, rod(bb, seat, 0.028, 8));
    B(M.dark, T(new THREE.BoxGeometry(0.36, 0.11, 0.09), 0.25, 0.48, 0, 0, 0, -0.55)); // battery on the down tube
    for (const z of [-0.06, 0.06]) {
      B(M.paint, rod(V(bb.x, bb.y, z * 0.6), V(rearX, R, z), 0.016, 6)); // chainstays
      B(M.paint, rod(V(seat.x + 0.02, seat.y - 0.06, z * 0.4), V(rearX, R, z), 0.015, 6)); // seatstays
      B(M.paint, rod(V(headLo.x, headLo.y, z * 0.7), V(frontX, R, z), 0.017, 6)); // fork
      // the longtail rack over the back wheel
      B(M.steel, rod(V(-0.3, 0.66, z * 2.4), V(-1.2, 0.66, z * 2.4), 0.012, 5));
      B(M.steel, rod(V(-1.18, 0.66, z * 2.4), V(rearX - 0.1, R + 0.05, z), 0.01, 5));
    }
    for (let i = 0; i < 5; i++) B(M.steel, rod(V(-0.35 - i * 0.2, 0.66, -0.15), V(-0.35 - i * 0.2, 0.66, 0.15), 0.009, 4));
    B(M.dark, T(new THREE.BoxGeometry(0.56, 0.05, 0.22), -0.74, 0.69, 0)); // rack deck
    // the up-side pannier (Dropt mint, faded); the other one tore off and is his pillow
    B(M.boxBody, T(new THREE.BoxGeometry(0.42, 0.34, 0.12), -0.82, 0.48, 0.25, 0, 0, 0.05));
    B(M.dark, rod(seat, V(seat.x - 0.04, seat.y + 0.14, 0), 0.016, 6)); // seat post
    B(M.dark, T(new THREE.BoxGeometry(0.26, 0.06, 0.15), seat.x - 0.05, seat.y + 0.17, 0)); // saddle
    B(M.dark, rod(head, V(0.46, 1.0, 0), 0.018, 6)); // stem
    // the bars, turned hard over in the fall
    const bar = (z: number) => V(0.46 - Math.sin(1.1) * z, 1.0, Math.cos(1.1) * z);
    B(M.dark, rod(bar(-0.32), bar(0.32), 0.013, 6));
    for (const s of [-1, 1]) B(M.rubber, rod(bar(s * 0.24), bar(s * 0.33), 0.02, 6)); // grips
    B(M.dark, T(new THREE.CylinderGeometry(0.035, 0.03, 0.07, 10).rotateZ(Math.PI / 2), 0.56, 0.9, 0)); // headlight
    B(M.dark, rod(V(bb.x, bb.y, 0.07), V(bb.x + 0.12, bb.y - 0.12, 0.09), 0.012, 5)); // crank
    B(M.dark, T(new THREE.BoxGeometry(0.1, 0.02, 0.07), bb.x + 0.13, bb.y - 0.13, 0.13)); // pedal
    B(M.steel, T(new THREE.TorusGeometry(0.08, 0.008, 4, 16), bb.x, bb.y, 0.05)); // chainring
    B(M.steel, rod(V(bb.x, bb.y + 0.08, 0.05), V(rearX, R + 0.04, 0.05), 0.005, 3));
    B(M.steel, rod(V(bb.x, bb.y - 0.08, 0.05), V(rearX, R - 0.04, 0.05), 0.005, 3));
    // tail light at the end of the rack
    B(M.dark, T(new THREE.BoxGeometry(0.03, 0.05, 0.08), -1.22, 0.63, 0));
    B(red.material, T(new THREE.BoxGeometry(0.012, 0.035, 0.06), -1.24, 0.63, 0));
    // lay it on its right side, the bars propping it up a little, and put it down
    const lay = new THREE.Matrix4().compose(V(1.4, 0, 1.6), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.1, 0.5, 0.03, 'YXZ')), V(1, 1, 1));
    let low = Infinity;
    for (const [, g] of bike) { g.applyMatrix4(lay); g.computeBoundingBox(); low = Math.min(low, g.boundingBox!.min.y); }
    // whatever touches first (a bar end) sinks a couple of centimetres into the sand
    for (const [m, g] of bike) mb.add(m, g.translate(0, -low - 0.025, 0));
    this.solid(1.35, 0.25, 1.75, 1.05, 0.25, 0.42, 0.5);

    // ---------------------------------------------------------------- the box, set up as a table
    const bx = -0.9, bz = 0.4, by = 0.27, byaw = 0.35;
    mb.add(M.boxBody, T(new THREE.BoxGeometry(0.56, 0.54, 0.52), bx, by, bz, 0, byaw));
    mb.add(M.boxBand, T(new THREE.BoxGeometry(0.575, 0.08, 0.535), bx, 0.07, bz, 0, byaw));
    mb.add(M.boxLiner, T(new THREE.BoxGeometry(0.48, 0.02, 0.44), bx, 0.535, bz, 0, byaw));
    // the lid, hinged back and resting open
    const lid = new THREE.Matrix4().makeRotationY(byaw);
    const hinge = V(0, 0.54, -0.26).applyMatrix4(lid);
    mb.add(M.boxBody, T(new THREE.BoxGeometry(0.56, 0.05, 0.52).translate(0, 0, -0.26), bx + hinge.x, hinge.y, bz + hinge.z, -1.95, byaw));
    for (const [fx, fz, ry] of [[0, 0.262, 0], [0.282, 0, Math.PI / 2], [-0.282, 0, -Math.PI / 2], [0, -0.262, Math.PI]] as [number, number, number][]) {
      const p = V(fx, 0, fz).applyMatrix4(lid);
      decals.add(decal, T(uvRect(new THREE.PlaneGeometry(0.42, 0.42), 0, 0, 384 / 1024, 1), bx + p.x, 0.3, bz + p.z, 0, byaw + ry));
    }
    this.solid(bx, 0.27, bz, 0.3, 0.27, 0.28, byaw);
    // on the box: a dented water bottle, empty
    mb.add(M.bottle, T(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10), bx + 0.12, 0.66, bz - 0.06));
    mb.add(M.boxLiner, T(new THREE.CylinderGeometry(0.018, 0.02, 0.03, 8), bx + 0.12, 0.775, bz - 0.06));

    // ---------------------------------------------------------------- his cardboard sign against the box
    decals.add(decal, T(uvRect(new THREE.PlaneGeometry(0.36, 0.56), 384 / 1024, 0, 320 / 1024, 1), bx + 0.16, 0.27, bz + 0.47, -0.22, byaw - 0.1));
    mb.add(M.card, T(new THREE.BoxGeometry(0.36, 0.56, 0.006), bx + 0.16, 0.27, bz + 0.462, -0.22, byaw - 0.1));

    // ---------------------------------------------------------------- the lean-to and what's under it
    const tx = -2.6, tz = -1.0, tyaw = -0.25;
    const tarp = new THREE.PlaneGeometry(2.3, 2.0, 12, 10);
    {
      const p = tarp.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i);
        const k = (y + 1) / 2; // 0 at the ground edge, 1 at the ridge
        const sag = Math.sin((x / 2.3 + 0.5) * Math.PI) * Math.sin(k * Math.PI) * 0.12;
        p.setXYZ(i, x, 0.04 + k * 1.05 - sag + Math.sin(x * 9 + y * 7) * 0.012, -1.0 + k * 1.75);
      }
      tarp.computeVertexNormals();
    }
    mb.add(M.tarp, T(tarp, tx, 0, tz, 0, tyaw));
    mb.add(M.tarp, flip(tarp)); // the underside, seen from inside the lean-to
    const lp = (x: number, z: number) => V(x, 0, z).applyAxisAngle(V(0, 1, 0), tyaw).add(V(tx, 0, tz));
    for (const s of [-1, 1]) {
      const a = lp(s * 1.12, 0.78), b = lp(s * 1.06, 0.72);
      mb.add(M.stick, rod(V(a.x, 0, a.z), V(b.x, 1.12, b.z), 0.025, 6));
      // guy line to a rock
      const g = lp(s * 1.5, 1.7);
      mb.add(M.stick, rod(V(b.x, 1.08, b.z), V(g.x, 0.05, g.z), 0.004, 3));
      mb.add(M.rock, T(rockGeometry(40 + s, 1), g.x, 0.06, g.z, 0, s, 0, V(0.16, 0.1, 0.14)));
      const e = lp(s * 1.1, -0.98);
      mb.add(M.rock, T(rockGeometry(44 + s, 1), e.x, 0.05, e.z, 0, s * 2, 0, V(0.18, 0.1, 0.15)));
    }
    // the bedroll, and Rider 9 under a silver emergency blanket, boots out
    const bed = lp(-0.1, 0.1);
    mb.add(M.bedroll, T(new THREE.BoxGeometry(0.75, 0.05, 1.9), bed.x, 0.025, bed.z, 0, tyaw + Math.PI / 2 - 0.08));
    const pil = lp(-0.85, 0.1);
    mb.add(M.boxBody, T(new THREE.BoxGeometry(0.42, 0.12, 0.34), pil.x, 0.1, pil.z, 0, tyaw + 0.2)); // the torn-off pannier, for a pillow
    const body = mylar(1.75, 0.95);
    const bodyYaw = tyaw + Math.PI / 2 - 0.08;
    const bc = lp(0.12, 0.12);
    mb.add(M.mylar, T(body, bc.x, 0.05, bc.z, 0, bodyYaw));
    for (const s of [-1, 1]) {
      // boots at the foot end (+x of the blanket): soles out, toes up, falling open a little
      const f = V(0.93, 0, s * 0.12).applyAxisAngle(V(0, 1, 0), bodyYaw).add(bc);
      const a = V(0.8, 0, s * 0.11).applyAxisAngle(V(0, 1, 0), bodyYaw).add(bc);
      mb.add(M.boot, T(new THREE.BoxGeometry(0.11, 0.26, 0.11), f.x, 0.14, f.z, s * 0.3, bodyYaw, -0.15));
      mb.add(M.boot, T(new THREE.BoxGeometry(0.2, 0.11, 0.1), a.x, 0.07, a.z, s * 0.2, bodyYaw));
      mb.add(M.rubber, T(new THREE.BoxGeometry(0.02, 0.27, 0.115), f.x + Math.cos(bodyYaw) * 0.06, 0.14, f.z - Math.sin(bodyYaw) * 0.06, s * 0.3, bodyYaw, -0.15));
    }
    // a splint off a bike pump by the boots, and the helmet set down beside him
    const sp = V(0.8, 0, 0.32).applyAxisAngle(V(0, 1, 0), bodyYaw).add(bc);
    mb.add(M.dark, T(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 8).rotateZ(Math.PI / 2), sp.x, 0.03, sp.z, 0, bodyYaw + 0.2));
    const hm = lp(0.75, 0.95);
    mb.add(M.boxBody, T(new THREE.SphereGeometry(0.15, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hm.x, 0.02, hm.z, 0.25, 0.4, 0.1, V(1, 0.85, 1.25)));
    mb.add(M.dark, T(new THREE.TorusGeometry(0.15, 0.012, 4, 18).rotateX(Math.PI / 2), hm.x, 0.03, hm.z, 0.25, 0.4, 0.1, V(1, 1, 1.25)));

    // ---------------------------------------------------------------- the phone on its solar panel
    const px = 0.25, pz = -0.95, pyaw = 0.6;
    for (const s of [-1, 1]) {
      const c = V(s * 0.19, 0, 0).applyAxisAngle(V(0, 1, 0), pyaw);
      mb.add(M.panel, T(new THREE.BoxGeometry(0.36, 0.012, 0.26), px + c.x, 0.03, pz + c.z, 0.1, pyaw, s * 0.04));
      mb.add(M.steel, T(new THREE.BoxGeometry(0.37, 0.006, 0.27), px + c.x, 0.022, pz + c.z, 0.1, pyaw, s * 0.04));
    }
    mb.add(M.rock, T(rockGeometry(51, 1), px + 0.5, 0.07, pz + 0.12, 0, 0.3, 0, V(0.2, 0.12, 0.18)));
    // the phone leans on that stone, screen up and toward whoever comes
    const ph = V(px + 0.36, 0.12, pz + 0.1);
    mb.add(M.phone, T(new THREE.BoxGeometry(0.08, 0.16, 0.009), ph.x, ph.y, ph.z, -0.75, pyaw + 0.15));
    const screen = T(uvRect(new THREE.PlaneGeometry(0.07, 0.145), 704 / 1024, 0, 320 / 1024, 1), ph.x, ph.y, ph.z, -0.75, pyaw + 0.15);
    screen.translate(...V(0, 0, 0.0052).applyEuler(new THREE.Euler(-0.75, pyaw + 0.15, 0, 'YXZ')).toArray() as [number, number, number]);
    const screenMesh = new THREE.Mesh(screen, this.screenMat);
    screenMesh.name = 'courier-screen';
    mb.add(M.dark, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(px + 0.38, 0.04, pz), V(ph.x - 0.05, 0.03, ph.z + 0.06), V(ph.x - 0.02, 0.06, ph.z + 0.07)]), 8, 0.004, 3));
    this.screen = new VirtualLight('#9ff5dc', 0, 3.6, 2);
    this.screen.position.set(ph.x, ph.y + 0.25, ph.z + 0.15);
    this.screen.parent = root;

    // ---------------------------------------------------------------- parcels nobody will sign for
    const parcel = (x: number, z: number, w: number, h: number, d: number, ry: number, rz = 0) => {
      mb.add(M.card, T(new THREE.BoxGeometry(w, h, d), x, h / 2, z, 0, ry, rz));
      mb.add(M.tape, T(new THREE.BoxGeometry(w + 0.004, 0.012, 0.05), x, h + 0.001, z, 0, ry, rz));
      mb.add(M.tape, T(new THREE.BoxGeometry(0.05, h + 0.004, d + 0.004), x, h / 2, z, 0, ry, rz));
    };
    parcel(-0.25, 0.95, 0.32, 0.2, 0.26, 0.4);
    parcel(-0.1, 1.25, 0.22, 0.14, 0.18, -0.3);
    parcel(-1.55, 0.9, 0.4, 0.26, 0.3, 1.1);
    parcel(0.35, 2.75, 0.26, 0.18, 0.2, 2.2, 0.0); // flung off in the crash
    mb.add(M.card, T(new THREE.CylinderGeometry(0.045, 0.045, 0.62, 10).rotateZ(Math.PI / 2), -1.4, 0.05, 1.35, 0, 0.7)); // a poster tube

    // ---------------------------------------------------------------- the fire ring, long cold
    const fx0 = -0.6, fz0 = -2.4;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      mb.add(M.rock, T(rockGeometry(60 + i, 1), fx0 + Math.cos(a) * 0.42, 0.06, fz0 + Math.sin(a) * 0.42, 0, a, 0, V(0.13, 0.09, 0.11)));
    }
    for (let i = 0; i < 3; i++) mb.add(M.char, T(new THREE.CylinderGeometry(0.035, 0.04, 0.5, 6).rotateZ(Math.PI / 2), fx0, 0.05 + i * 0.03, fz0, 0, i * 1.1 + 0.3, 0.1));

    // ---------------------------------------------------------------- the whip flag, planted to be found
    const wx = 2.6, wz = -1.6;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      mb.add(M.rock, T(rockGeometry(70 + i, 1), wx + Math.cos(a) * 0.2, 0.08, wz + Math.sin(a) * 0.2, 0, a, 0, V(0.15, 0.12, 0.13)));
    }
    mb.add(M.rock, T(rockGeometry(76, 1), wx, 0.2, wz, 0, 0, 0, V(0.13, 0.1, 0.12)));
    const top = V(wx + 0.12, 3.0, wz - 0.05);
    mb.add(M.whip, rod(V(wx, 0, wz), top, 0.008, 5));
    mb.add(M.pennant, pennant(V(wx + 0.105, 2.62, wz - 0.044), top, 0.55));
    this.solid(wx, 0.2, wz, 0.3, 0.2, 0.3, 0);

    // ---------------------------------------------------------------- rocks for the composition
    mb.add(M.rock, T(rockGeometry(81, 2), -3.6, 0.35, 1.6, 0, 0.8, 0, V(0.9, 0.6, 0.75)));
    mb.add(M.rock, T(rockGeometry(82, 2), -4.1, 0.2, 0.6, 0, 2.1, 0, V(0.55, 0.35, 0.5)));
    mb.add(M.rock, T(rockGeometry(83, 2), 3.8, 0.3, 2.9, 0, 1.4, 0, V(0.7, 0.45, 0.6)));
    this.solid(-3.6, 0.35, 1.6, 0.8, 0.35, 0.65, 0.8);
    this.solid(3.8, 0.3, 2.9, 0.6, 0.3, 0.5, 1.4);

    const far = mb.buildFar('courier-far', { minSize: 0.3 });
    const near = mb.build('courier');
    shadowProxy(near);
    const dnear = decals.build('courier-decals', true, true);
    near.add(dnear, screenMesh);
    root.add(near, far);
    this.lod(near, far, 6, 150);

    // the harness: game.sites.find(s => s.id === 'courier').spots
    this.spot('approach', 2.5, 0, 6);
    this.spot('phone', ph.x - 0.2, 0, ph.z + 0.9);
    this.spot('box', bx + 0.2, 0, bz + 1.2);

    const site = this;
    this.interactables.push({
      id: 'courier.phone', pos: this.frame.p(ph.x, 0.5, ph.z), radius: 1.8,
      primary: {
        get label() { return site.s?.has(F.log) ? 'Read the phone again' : 'Read the phone'; },
        available: () => true,
        run: () => this.readPhone(),
      },
    });
    this.interactables.push({
      id: 'courier.box', pos: this.frame.p(bx, 0.6, bz), radius: 1.6,
      visible: () => !this.s?.has(F.box),
      primary: { label: 'Search the cargo box', available: () => true, run: () => this.searchBox() },
    });
    this.interactables.push({
      id: 'courier.blanket', pos: this.frame.p(bc.x, 0.4, bc.z), radius: 1.5,
      visible: () => !this.s?.has(F.blanket),
      primary: { label: 'Straighten the blanket', available: () => true, run: () => this.blanket() },
    });
  }

  private solid(lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, yaw: number) {
    const p = this.frame.p(lx, ly, lz);
    this.ctx.physics.addBox(p, { x: hx, y: hy, z: hz }, this.frame.yaw + yaw);
  }

  private toast(text: string, kind: 'info' | 'good' | 'bad' = 'info') {
    this.s.events.emit('toast', { text, kind });
  }

  private async readPhone() {
    const s = this.s;
    const first = !s.has(F.log);
    const pick = await this.ctx.ui.choose({
      speaker: 'Dropt · Rider 9 · ★ 4.9',
      text:
        'ACTIVE ORDER #88-1047 · 1× stove igniter (universal) → N. Pell, Dry Creek Diner · ETA 10 min · RUNNING LATE. ' +
        'Rider notes, voice to text: "Day 1,276. Front wheel\'s gone. Ankle\'s gone. App says I\'m on a roll. Solar keeps the phone up, so the order stays open, and you don\'t drop an order. ' +
        'Day 1,279. Told Hollis on 19 I\'d be late. He laughed. Good. Day 1,281. If you\'re reading this, you\'re the next rider. Ten minutes or free. Make it free."',
      choices: first
        ? [
          { id: 'take', label: 'Take the last order.' },
          { id: 'rate', label: 'Rate Rider 9 five stars. Then take the order.' },
          { id: 'later', label: 'Not yet.' },
        ]
        : [{ id: 'ok', label: 'Leave the phone on.' }],
    });
    if (!first || (pick !== 'take' && pick !== 'rate')) return;
    if (pick === 'rate') s.set(F.rated);
    s.set(F.found);
    s.set(F.done);
    s.set(F.log);
    s.addItem('igniter', 1, false, true);
    s.addXP(45, 'The last order');
    this.ctx.audio.play('pickup');
    this.toast(pick === 'rate'
      ? `★★★★★ submitted. The app thanks you for your feedback. ${ITEMS.igniter.name} is in your pack.`
      : `${ITEMS.igniter.name}: one stove igniter, for N. Pell, Dry Creek Diner.`, 'good');
  }

  private searchBox() {
    const s = this.s;
    if (!s.set(F.box)) return;
    const got: string[] = [];
    for (const it of [{ id: 'water', qty: 1 }, { id: 'ration', qty: 1 }, { id: 'battery', qty: 1 }]) {
      const n = s.addItem(it.id, it.qty);
      if (n) got.push(`${n}× ${ITEMS[it.id]?.name ?? it.id}`);
    }
    this.ctx.audio.play('pickup');
    this.toast(`The insulated box kept what he didn't get to. And the bike's battery, still half full. ${got.join(', ')}`, 'good');
    s.addXP(20, 'Cargo box');
  }

  private blanket() {
    const s = this.s;
    if (!s.set(F.blanket)) return;
    s.addXP(10, 'Rider 9');
    this.toast('You tuck the blanket back under his boots. A splint made from a bike pump. A five-star sticker on his helmet, peeling.', 'info');
  }

  update(dt: number, cam: THREE.Vector3) {
    super.update(dt, cam);
    this.t += dt;
    const night = THREE.MathUtils.smoothstep((this.ctx.atmo?.uNight?.value as number | undefined) ?? 0, 0.15, 0.5);
    // a flashing tail light: two quick blinks every two seconds, as the app's "be seen" mode
    const ph = this.t % 2;
    const on = ph < 0.08 || (ph > 0.22 && ph < 0.3);
    this.tail.value = on ? 2 + night * 10 : 0;
    this.screen.intensity = night * 0.6 * (0.94 + 0.06 * Math.sin(this.t * 1.3));
  }
}

/** Remap a PlaneGeometry's uvs into one cell of the atlas (u0, v0, width, height in 0..1). */
function uvRect(g: THREE.PlaneGeometry, u0: number, v0: number, w: number, h: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * w, v0 + uv.getY(i) * h);
  return g;
}

/** The same surface facing the other way (reversed winding), for cloth seen from both sides. */
function flip(src: THREE.BufferGeometry) {
  const g = src.index ? src.toNonIndexed() : src.clone();
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x, y, z);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** A crinkled emergency blanket draped over a body lying along +x (head at -x). */
function mylar(L: number, W: number) {
  const g = new THREE.PlaneGeometry(L, W, 28, 14).rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const u = x / L + 0.5; // 0 head .. 1 feet
    // the shape under it: head, shoulders, chest, hips, legs, feet up
    const width = 0.12 + 0.16 * Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.5) - 0.05 * Math.max(0, u - 0.55);
    const height = u < 0.13 ? 0.15 : u < 0.55 ? 0.2 - (u - 0.13) * 0.08 : u < 0.92 ? 0.14 - (u - 0.55) * 0.12 : 0.2;
    const legs = u > 0.55 ? Math.max(0, 1 - ((Math.abs(z) - 0.1) / 0.1) ** 2) : 1;
    const across = Math.max(0, 1 - (z / width) ** 2);
    let h = height * Math.sqrt(across) * (u > 0.55 ? 0.6 + 0.4 * legs : 1);
    // edges fall to the ground
    h = Math.max(h, 0) + 0.008;
    const crinkle = Math.sin(x * 31 + z * 17) * 0.008 + Math.sin(x * 13 - z * 29) * 0.006;
    p.setY(i, h + crinkle);
  }
  g.computeVertexNormals();
  return g;
}

/** A triangular pennant hanging off the whip near its top, a little wind in it. Two-sided. */
function pennant(a: THREE.Vector3, b: THREE.Vector3, len: number) {
  const tip = a.clone().lerp(b, 0.5).add(V(len * 0.9, -0.14, len * 0.35));
  const mid = a.clone().lerp(tip, 0.5).add(V(0, 0.04, -0.05));
  const pts = [a, b, mid, b, tip, mid];
  const pos: number[] = [];
  for (const v of pts) pos.push(v.x, v.y, v.z);
  // back faces
  for (let i = pts.length - 1; i >= 0; i--) pos.push(pts[i].x, pts[i].y, pts[i].z);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
