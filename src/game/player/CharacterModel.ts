import * as THREE from 'three/webgpu';
import { fabric, leather, rustyMetal, glow, plainStandard } from '../world/materials';
import { damp } from '@/engine/noise';

export interface Look {
  coat: string;
  coatAccent: string;
  scarf: string;
  accent: string; // goggles / LEDs
  hood: boolean;
  hardHat: boolean;
  bulkyPack: boolean;
}

export const LOOKS: Record<string, Look> = {
  infiltrator: { coat: '#2d3a3c', coatAccent: '#1b2324', scarf: '#7a2f2a', accent: '#3ff2e0', hood: true, hardHat: false, bulkyPack: false },
  engineer: { coat: '#6a4a2c', coatAccent: '#d9792a', scarf: '#2f4a5a', accent: '#ff9d2e', hood: false, hardHat: true, bulkyPack: true },
};

const cap = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 10);

export interface AnimState {
  speed: number; // horizontal m/s
  grounded: boolean;
  crouch: number; // 0..1
  vy: number;
  turn: number; // yaw rate for leaning
  interact: number; // 0..1 arms-forward pose
  aimPitch: number;
  lookYaw: number; // head yaw relative to body
}

/** Hierarchical primitive-built scavenger with procedural locomotion. */
export class CharacterModel {
  root = new THREE.Group();
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private chest = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private armL = { shoulder: new THREE.Group(), elbow: new THREE.Group() };
  private armR = { shoulder: new THREE.Group(), elbow: new THREE.Group() };
  private legL = { hip: new THREE.Group(), knee: new THREE.Group(), ankle: new THREE.Group() };
  private legR = { hip: new THREE.Group(), knee: new THREE.Group(), ankle: new THREE.Group() };
  private skirtF = new THREE.Group();
  private skirtB = new THREE.Group();
  private scarfTail = new THREE.Group();
  private led: { value: number };
  private phase = 0;
  private t = 0;
  private crouchS = 0;
  private airS = 0;
  private leanS = 0;
  private speedS = 0;
  private interactS = 0;
  onFootstep: ((foot: 0 | 1, intensity: number) => void) | null = null;
  private lastStepSign = 0;

  constructor(look: Look) {
    const coat = fabric(look.coat);
    const coatDark = fabric(look.coatAccent);
    const pants = fabric('#3a342c');
    const boots = leather('#2a1f18');
    const gloves = leather('#3b2c20');
    const skin = leather('#8a6450');
    const metal = rustyMetal({ base: '#6a6a66', rust: 0.4, metalness: 0.8 });
    const scarf = fabric(look.scarf);
    const pack = fabric('#4a4436');
    const strap = leather('#2b2018');
    const accent = glow(look.accent, 6);
    this.led = accent.intensity as unknown as { value: number };

    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    this.root.add(this.hips);
    this.hips.position.y = 0.98;
    // pelvis + belt
    add(this.hips, new THREE.CylinderGeometry(0.17, 0.19, 0.22, 10), pants, 0, -0.02, 0);
    add(this.hips, new THREE.TorusGeometry(0.19, 0.03, 6, 16), strap, 0, 0.07, 0, Math.PI / 2);
    add(this.hips, new THREE.BoxGeometry(0.12, 0.1, 0.06), metal, 0, 0.07, 0.19);
    add(this.hips, new THREE.BoxGeometry(0.1, 0.14, 0.08), pack, 0.2, 0.0, 0.05); // pouch
    if (look.bulkyPack) add(this.hips, new THREE.BoxGeometry(0.08, 0.2, 0.12), metal, -0.21, -0.02, 0.02); // tool holster

    // spine/chest
    this.hips.add(this.spine);
    this.spine.position.y = 0.1;
    this.spine.add(this.chest);
    this.chest.position.y = 0.24;
    const torso = add(this.chest, cap(0.2, 0.28), coat, 0, 0.05, 0);
    torso.scale.set(1.08, 1, 0.78);
    add(this.chest, new THREE.BoxGeometry(0.36, 0.3, 0.05), coatDark, 0, 0.06, 0.15); // chest rig
    add(this.chest, new THREE.BoxGeometry(0.06, 0.48, 0.03), strap, 0.11, 0.06, 0.17, 0, 0, 0.35);
    add(this.chest, new THREE.BoxGeometry(0.06, 0.48, 0.03), strap, -0.11, 0.06, 0.17, 0, 0, -0.35);
    add(this.chest, new THREE.BoxGeometry(0.07, 0.07, 0.04), metal, 0.08, 0.14, 0.19);
    // backpack
    const pw = look.bulkyPack ? 0.42 : 0.34, ph = look.bulkyPack ? 0.5 : 0.4;
    add(this.chest, new THREE.BoxGeometry(pw, ph, 0.2), pack, 0, 0.06, -0.24);
    add(this.chest, new THREE.CylinderGeometry(0.08, 0.08, pw + 0.06, 10), fabric('#6b5a3a'), 0, ph / 2 + 0.1, -0.24, 0, 0, Math.PI / 2); // bedroll
    add(this.chest, new THREE.BoxGeometry(pw * 0.8, 0.14, 0.06), pack, 0, -0.06, -0.36);
    // antenna + LED
    const antH = look.bulkyPack ? 0.75 : 0.45;
    add(this.chest, new THREE.CylinderGeometry(0.006, 0.01, antH, 4), metal, pw / 2 - 0.05, ph / 2 + antH / 2 + 0.05, -0.2);
    add(this.chest, new THREE.SphereGeometry(0.018, 6, 4), accent.material, pw / 2 - 0.05, ph / 2 + antH + 0.06, -0.2);
    add(this.chest, new THREE.BoxGeometry(0.05, 0.03, 0.01), accent.material, -0.1, 0.2, -0.345);
    // shoulder pads
    add(this.chest, new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), coatDark, 0.24, 0.22, 0, 0, 0, -0.5);
    add(this.chest, new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), coatDark, -0.24, 0.22, 0, 0, 0, 0.5);

    // neck + head
    this.chest.add(this.neck);
    this.neck.position.y = 0.33;
    add(this.neck, new THREE.TorusGeometry(0.11, 0.06, 8, 16), scarf, 0, 0.0, 0, Math.PI / 2);
    this.neck.add(this.scarfTail);
    this.scarfTail.position.set(-0.06, -0.02, -0.12);
    add(this.scarfTail, new THREE.BoxGeometry(0.1, 0.38, 0.025), scarf, 0, -0.18, 0);
    this.neck.add(this.head);
    this.head.position.y = 0.13;
    const skull = add(this.head, new THREE.SphereGeometry(0.115, 16, 12), skin, 0, 0.06, 0);
    skull.scale.set(0.95, 1.08, 1);
    // rebreather mask
    add(this.head, new THREE.SphereGeometry(0.085, 12, 8, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.5), plainStandard('#2a2a28', 0.5, 0.3), 0, 0.02, 0.05, -0.2);
    add(this.head, new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10), metal, 0.07, -0.01, 0.1, 0.4, 0, Math.PI / 2 - 0.5);
    add(this.head, new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10), metal, -0.07, -0.01, 0.1, 0.4, 0, -Math.PI / 2 + 0.5);
    // goggles
    add(this.head, new THREE.TorusGeometry(0.115, 0.018, 6, 20), strap, 0, 0.09, 0, Math.PI / 2 - 0.1);
    for (const sx of [-0.045, 0.045]) {
      add(this.head, new THREE.CylinderGeometry(0.035, 0.035, 0.04, 14), metal, sx, 0.09, 0.1, Math.PI / 2);
      add(this.head, new THREE.CircleGeometry(0.028, 14), accent.material, sx, 0.09, 0.121);
    }
    if (look.hood) {
      const hood = add(this.head, new THREE.SphereGeometry(0.16, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), coat, 0, 0.07, -0.025, -0.35);
      hood.scale.set(1, 1.08, 1.12);
      add(this.head, new THREE.ConeGeometry(0.12, 0.2, 10, 1, true), coat, 0, 0.0, -0.12, -2.2);
    }
    if (look.hardHat) {
      add(this.head, new THREE.SphereGeometry(0.135, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), rustyMetal({ base: '#e0a21e', rust: 0.35, metalness: 0.2, roughness: 0.5 }), 0, 0.1, 0);
      add(this.head, new THREE.CylinderGeometry(0.17, 0.17, 0.015, 20), rustyMetal({ base: '#d89a1a', rust: 0.35, metalness: 0.2 }), 0, 0.1, 0.02);
      add(this.head, new THREE.BoxGeometry(0.05, 0.04, 0.04), accent.material, 0, 0.2, 0.1); // headlamp
    }

    // arms
    const mkArm = (arm: typeof this.armL, side: 1 | -1) => {
      this.chest.add(arm.shoulder);
      arm.shoulder.position.set(0.25 * side, 0.2, 0);
      add(arm.shoulder, cap(0.06, 0.2), coat, 0, -0.14, 0);
      arm.shoulder.add(arm.elbow);
      arm.elbow.position.y = -0.3;
      add(arm.elbow, cap(0.05, 0.2), coat, 0, -0.13, 0);
      add(arm.elbow, new THREE.CylinderGeometry(0.058, 0.052, 0.08, 10), coatDark, 0, -0.2, 0); // cuff
      add(arm.elbow, new THREE.BoxGeometry(0.07, 0.1, 0.09), gloves, 0, -0.3, 0.01);
    };
    mkArm(this.armL, 1);
    mkArm(this.armR, -1);
    // wrist gadget on left arm
    add(this.armL.elbow, new THREE.BoxGeometry(0.07, 0.06, 0.06), metal, 0, -0.16, 0.05);
    add(this.armL.elbow, new THREE.PlaneGeometry(0.05, 0.035), accent.material, 0, -0.16, 0.081);

    // legs
    const mkLeg = (leg: typeof this.legL, side: 1 | -1) => {
      this.hips.add(leg.hip);
      leg.hip.position.set(0.1 * side, -0.08, 0);
      add(leg.hip, cap(0.075, 0.3), pants, 0, -0.22, 0);
      add(leg.hip, new THREE.BoxGeometry(0.09, 0.12, 0.08), pack, 0.07 * side, -0.25, 0.02); // thigh pocket
      leg.hip.add(leg.knee);
      leg.knee.position.y = -0.44;
      add(leg.knee, new THREE.SphereGeometry(0.07, 8, 6), coatDark, 0, 0, 0.03);
      add(leg.knee, cap(0.065, 0.28), pants, 0, -0.2, 0);
      leg.knee.add(leg.ankle);
      leg.ankle.position.y = -0.42;
      add(leg.ankle, new THREE.CylinderGeometry(0.075, 0.08, 0.14, 10), boots, 0, 0.02, 0);
      add(leg.ankle, new THREE.BoxGeometry(0.11, 0.08, 0.24), boots, 0, -0.04, 0.05);
    };
    mkLeg(this.legL, 1);
    mkLeg(this.legR, -1);

    // duster coat skirt panels (front/back) swing with legs
    const skirtGeo = new THREE.CylinderGeometry(0.22, 0.3, 0.55, 12, 1, true, -Math.PI / 2, Math.PI);
    skirtGeo.translate(0, -0.28, 0);
    this.hips.add(this.skirtF, this.skirtB);
    this.skirtF.position.y = 0.02;
    this.skirtB.position.y = 0.02;
    add(this.skirtB, skirtGeo, coat, 0, 0, 0, 0, Math.PI, 0);
    const front = skirtGeo.clone();
    front.scale(1, 0.75, 1);
    add(this.skirtF, front, coat, 0, 0, 0);
    for (const m of [...this.skirtF.children, ...this.skirtB.children]) (m as THREE.Mesh).material = fabricDouble(look.coat);
  }

  setAccent(c: string) {
    void c;
  }

  update(dt: number, s: AnimState) {
    this.t += dt;
    const sp = (this.speedS = damp(this.speedS, s.speed, 10, dt));
    this.crouchS = damp(this.crouchS, s.crouch, 10, dt);
    this.airS = damp(this.airS, s.grounded ? 0 : 1, 12, dt);
    this.leanS = damp(this.leanS, THREE.MathUtils.clamp(-s.turn * 0.06 * Math.min(1, sp / 3), -0.25, 0.25), 6, dt);
    this.interactS = damp(this.interactS, s.interact, 8, dt);
    const run = THREE.MathUtils.smoothstep(sp, 3.5, 6);
    const walk = Math.min(1, sp / 1.2);
    const cr = this.crouchS;
    const air = this.airS;

    // gait phase advances with distance travelled
    const stride = THREE.MathUtils.lerp(1.35, 2.3, run) * (1 - cr * 0.3);
    this.phase += (sp / stride) * Math.PI * dt * (s.grounded ? 1 : 0.2);
    const ph = this.phase;
    const sinp = Math.sin(ph);
    const cosp = Math.cos(ph);

    // footsteps on zero crossings
    const sign = Math.sign(sinp);
    if (s.grounded && walk > 0.3 && sign !== this.lastStepSign && sign !== 0) {
      this.onFootstep?.(sign > 0 ? 0 : 1, Math.min(1.2, 0.4 + sp / 6) * (1 - cr * 0.6));
    }
    this.lastStepSign = sign;

    const legAmp = (0.5 + run * 0.35) * walk * (1 - air);
    const kneeAmp = (0.7 + run * 0.7) * walk * (1 - air);
    const breathe = Math.sin(this.t * 1.8) * 0.012 * (1 - walk);

    // hips height: crouch, bob, air tuck
    const bob = Math.abs(cosp) * (0.035 + run * 0.05) * walk;
    this.hips.position.y = 0.98 - cr * 0.36 - bob * (1 - air) + air * 0.05;
    this.hips.rotation.y = sinp * 0.12 * walk;
    this.hips.rotation.z = this.leanS;
    this.spine.rotation.x = 0.06 + run * 0.22 + cr * 0.35 + this.interactS * 0.2;
    this.spine.rotation.y = -sinp * 0.18 * walk;
    this.chest.scale.setScalar(1 + breathe);
    this.chest.rotation.x = breathe * 2;
    // head counter-rotates and follows look direction
    this.neck.rotation.x = -this.spine.rotation.x * 0.7 + THREE.MathUtils.clamp(-s.aimPitch * 0.4, -0.4, 0.5) + this.interactS * 0.3;
    this.neck.rotation.y = THREE.MathUtils.clamp(s.lookYaw, -1.0, 1.0) * 0.8 - this.spine.rotation.y;

    // legs
    const legCycle = (leg: typeof this.legL, p: number) => {
      const sw = Math.sin(p);
      const lift = Math.max(0, Math.cos(p));
      leg.hip.rotation.x = -sw * legAmp - cr * 1.1 - air * 0.6;
      leg.knee.rotation.x = (lift * kneeAmp + 0.08) + cr * 1.9 + air * 1.0;
      leg.ankle.rotation.x = -leg.hip.rotation.x - leg.knee.rotation.x + 0.0 - sw * 0.2 * walk;
    };
    legCycle(this.legL, ph);
    legCycle(this.legR, ph + Math.PI);
    this.legL.hip.rotation.z = 0.04 + cr * 0.15;
    this.legR.hip.rotation.z = -0.04 - cr * 0.15;

    // arms swing opposite to legs; interact pose overrides
    const armAmp = (0.35 + run * 0.6) * walk;
    const armCycle = (arm: typeof this.armL, p: number, side: 1 | -1) => {
      const sw = Math.sin(p);
      const swing = sw * armAmp;
      const reach = this.interactS;
      arm.shoulder.rotation.x = THREE.MathUtils.lerp(swing - run * 0.3 - cr * 0.3, -1.25, reach) + air * -0.8;
      arm.shoulder.rotation.z = THREE.MathUtils.lerp(0.12 * side + air * 0.5 * side, 0.25 * side, reach);
      arm.elbow.rotation.x = THREE.MathUtils.lerp(-0.25 - run * 0.9 - Math.max(0, sw) * 0.3 * walk, -0.6, reach);
      if (reach > 0.01) arm.shoulder.rotation.x += Math.sin(this.t * 9 + side) * 0.03 * reach;
    };
    armCycle(this.armL, ph + Math.PI, 1);
    armCycle(this.armR, ph, -1);

    // coat + scarf secondary motion
    this.skirtF.rotation.x = -Math.max(Math.abs(this.legL.hip.rotation.x), Math.abs(this.legR.hip.rotation.x)) * 0.55 - cr * 0.4;
    this.skirtB.rotation.x = run * 0.45 + air * 0.4 + walk * 0.1 + Math.sin(this.t * 3) * 0.03;
    this.scarfTail.rotation.x = 0.3 + run * 0.9 + Math.sin(this.t * 7 + sinp) * 0.15 * (0.3 + run);
    this.scarfTail.rotation.z = Math.sin(this.t * 4.3) * 0.15;

    // backpack LED heartbeat
    this.led.value = 3 + Math.pow(Math.max(0, Math.sin(this.t * 2.2)), 16) * 10;
  }
}

function fabricDouble(c: string) {
  const m = fabric(c);
  m.side = THREE.DoubleSide;
  return m;
}
