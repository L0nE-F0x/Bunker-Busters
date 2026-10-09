import * as THREE from 'three/webgpu';
import type { GameContext } from '../context';
import type { Landmarks } from '../world/Landmarks';
import { norm } from '../world/kit';
import { desertRock, fabric, glow, plainStandard, rustyMetal, wood } from '../world/materials';
import { rockGeometry } from '../world/Props';
import { VirtualLight } from '../world/lights';
import { GlowSprites } from '../world/effects';
import { ITEMS } from '@/content/items';
import { XP_REWARDS } from '@/content/progression';
import { surfaces } from '@/engine/surface';
import { Site } from './Site';
import { SiteKit, atlasMap, decalMat, floorDecal, mat4, rng, uSiteFlicker, uSiteNight, v3, xf } from './jetKit';
import { Bucket, artGlow, artMaterial, artMap, artQuad, merged } from './placesArt';

/** Story flags (see Site.ts). Other quests can hang off `site.booster.done` (the recorder heard). */
const F = {
  found: 'site.booster.found',
  done: 'site.booster.done',
  manifest: 'site.booster.manifest',
  power: 'site.booster.power',
  code: 'site.booster.code',
  pod: 'site.booster.pod',
  cables: 'site.booster.cables',
  copv: 'site.booster.copv',
  recovery: 'site.booster.recovery',
} as const;

const POD_CODE = '2048';
/** Tank radius, the depth it sank, and the bend where it folded. */
const R = 1.85, SINK = 0.32, CY = R - SINK, BEND = 2.5;

/**
 * The Longshot: a Kade first stage, LONGSHOT B7, flight-proven once. It was flying a priority
 * resupply to Apex Vault's pad and missed by most of a valley. It lies on its side in the south
 * basin, folded a little at the middle, with its engine end ploughed into a dune, one landing leg
 * still raised at the sky, another snapped, the interstage torn open where the pod blew clear.
 * Kade staked it and taped it off and never came back.
 *
 * Why go: the pod (a keypad; the code is on the flight recorder, which needs power) holds Vesper
 * Kade's personal water, flown in from a glacier, and the recorder says where Pad B is.
 *
 * Built in booster space (axis +x from the engines forward, +y up before the roll), each section
 * through its own matrix so the fold is real. One SiteKit (static batch + shadow proxy, thin batch,
 * the shared decal atlas for soot and the scorch), the places atlas for the letters, a far stand-in,
 * and at night a recovery strobe on the interstage and the recorder's screen.
 */
export class BoosterSite extends Site {
  private kit: SiteKit;
  private aft: THREE.Matrix4;
  private fore: THREE.Matrix4;
  private strobe: { value: number };
  private strobeCh = 1;
  private strobeLight: VirtualLight;
  private screenLight: VirtualLight;
  private podLed: { value: number };
  private podLedOk: { value: number };
  private farHalo: GlowSprites;
  private near!: THREE.Object3D;
  private t = 0;
  private ventT = 3;
  /** seconds (spent near the site) between the pod opening and Kade's crew arriving */
  private recoveryT = 30;
  private vent = new THREE.Vector3();
  private ventDir = new THREE.Vector3();

  constructor(ctx: GameContext, landmarks: Landmarks) {
    super('booster', ctx, landmarks);
    this.kit = new SiteKit(this.frame, ctx.physics, ctx.hf);
    const root = new THREE.Group();
    root.name = 'booster-root';
    root.applyMatrix4(this.frame.m);
    this.group.add(root);

    // the aft section lies straight; the fore section folds about the bend, yawed and nosed into the sand
    const roll = 0.18;
    this.aft = mat4(0, CY, 0).multiply(new THREE.Matrix4().makeRotationX(roll));
    this.fore = this.aft.clone()
      .multiply(new THREE.Matrix4().makeTranslation(BEND, 0, 0))
      .multiply(new THREE.Matrix4().makeRotationY(0.08))
      .multiply(new THREE.Matrix4().makeRotationZ(-0.03))
      .multiply(new THREE.Matrix4().makeTranslation(-BEND, 0, 0));

    const M = mats();
    const strobe = glow('#e8f2ff', 0);
    this.strobe = strobe.intensity as unknown as { value: number };
    const led = glow('#ff3020', 3);
    this.podLed = led.intensity as unknown as { value: number };
    const ledOk = glow('#40ff80', 0);
    this.podLedOk = ledOk.intensity as unknown as { value: number };

    this.buildTank(M);
    this.buildEngines(M);
    this.buildInterstage(M, strobe.material);
    this.buildLegs(M);
    this.buildGround(M);
    this.buildPod(M, led.material, ledOk.material);
    this.buildDebris(M);
    this.buildPerimeter(M);

    // lights: the strobe on the interstage, the recorder's screen inside
    const sp = this.bpt(this.fore, 19.6, -0.15, R + 0.25);
    this.kit.halos.add(sp.clone().setY(sp.y + 0.1), '#dfeaff', 2.6, this.strobeCh, 3);
    this.strobeLight = new VirtualLight('#dfeaff', 0, 26, 2);
    this.strobeLight.position.copy(sp);
    this.strobeLight.parent = root;
    const scr = this.bpt(this.fore, 16.6, 0.6, R - 0.6);
    this.screenLight = new VirtualLight('#5dff9a', 0, 4.5, 2);
    this.screenLight.position.copy(scr);
    this.screenLight.parent = root;

    const far = new Map<THREE.Material, THREE.ColorRepresentation>();
    const { near, far: farGroup } = this.kit.build(root, ctx.scene, 'booster', far);
    this.near = near;
    const prints = this.prints.build('booster-prints', true);
    prints.traverse((o) => { o.renderOrder = 2; });
    const glows = this.glows.build('booster-glows', false);
    glows.traverse((o) => { o.renderOrder = 3; });
    near.add(prints, glows);
    // the strobe still reads from the road at night
    this.farHalo = new GlowSprites(4);
    this.farHalo.add(sp.clone().setY(sp.y + 0.1), '#dfeaff', 3.2, 1, 3);
    farGroup.add(this.farHalo.build());
    this.lod(near, farGroup, 24, 145);

    this.buildInteractables();
    this.landmarks.audioSpots.push({ kind: 'wind-hollow', pos: this.frame.p(...this.bpt(this.fore, 19.0, 0, 0).toArray() as [number, number, number]) });
  }

  private prints = new Bucket(artMaterial);
  private glows = new Bucket(artGlow);

  /** A point in booster space (x along the axis, angle `a` from up toward +z, radius r) → site-local. */
  private bpt(seg: THREE.Matrix4, x: number, a: number, r: number) {
    return v3(x, Math.cos(a) * r, Math.sin(a) * r).applyMatrix4(seg);
  }

  // ================================================================ the tank
  private buildTank(M: Mats) {
    const k = this.kit;
    const r = rng(77);
    // a dented cylinder between x0 and x1 (booster space, axis +x)
    const tube = (x0: number, x1: number, rad: number, seed: number, dentAt = -1) => {
      const g = new THREE.CylinderGeometry(rad, rad, x1 - x0, 48, Math.ceil((x1 - x0) / 0.8), true);
      g.rotateZ(-Math.PI / 2).translate((x0 + x1) / 2, 0, 0);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const a = Math.atan2(z, y);
        // oil-canning between the stringers, and where it hit (the down side, near dentAt)
        let d = Math.sin(x * 2.1 + seed) * Math.sin(a * 7 + seed) * 0.025;
        if (dentAt >= 0) d -= Math.exp(-((x - dentAt) ** 2) / 6) * Math.max(0, -Math.cos(a - 2.6)) * 0.35;
        const s = (rad + d) / rad;
        p.setXYZ(i, x, y * s, z * s);
      }
      g.computeVertexNormals();
      return g;
    };
    k.b.add(M.skin, xf(tube(-16, BEND - 0.25, R, 1.3, -6), this.aft));
    k.b.add(M.skin, xf(tube(BEND + 0.25, 16, R, 2.7, 9), this.fore));
    // the fold: an accordion of crushed rings between the two sections
    for (let i = 0; i < 4; i++) {
      const x = BEND - 0.25 + i * 0.14;
      const seg = i < 2 ? this.aft : this.fore;
      const rr = R * (i % 2 ? 0.95 : 1.04);
      k.b.add(M.skin, xf(new THREE.CylinderGeometry(rr, i % 2 ? R * 1.04 : R * 0.95, 0.15, 48, 1, true).rotateZ(-Math.PI / 2).translate(x + 0.07, 0, 0), seg));
    }
    // ring frames (the welds show through the paint as raised bands), and the raceway down one side
    for (const x of [-12, -7, -2, 6, 11]) {
      const seg = x < BEND ? this.aft : this.fore;
      k.b.add(M.skinDark, xf(new THREE.TorusGeometry(R + 0.012, 0.03, 4, 48).rotateY(Math.PI / 2).translate(x, 0, 0), seg));
    }
    for (const [x0, x1, seg] of [[-15.6, BEND - 0.4, this.aft], [BEND + 0.4, 15.8, this.fore]] as [number, number, THREE.Matrix4][]) {
      const a = -1.2;
      k.b.add(M.skinDark, xf(new THREE.BoxGeometry(x1 - x0, 0.12, 0.3).translate((x0 + x1) / 2, R + 0.05, 0).applyMatrix4(new THREE.Matrix4().makeRotationX(a)), seg));
    }
    // the fore dome, inside the interstage
    k.b.add(M.skin, xf(new THREE.SphereGeometry(R, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.38, 1).rotateZ(-Math.PI / 2).translate(16, 0, 0), this.fore));

    // letters: KADE down the up-facing flank, the vehicle name and tally aft of it, a placard by the engines
    this.prints.add(wrapQuad('ascWord', -10.5, -0.5, 0.95, 2.15, R + 0.015, this.aft));
    this.prints.add(wrapQuad('ascTail', 4.5, 9.5, 1.05, 1.95, R + 0.015, this.fore));
    this.prints.add(wrapQuad('ascHaz', -14.6, -13.4, 0.55, 1.15, R + 0.02, this.aft));
    // soot from the landing burn up the aft third, and scorch where the tank rubbed the ground
    for (let i = 0; i < 7; i++) {
      const a0 = -0.4 + i * 0.75 + r() * 0.2;
      k.d.add(decalMat(), atlasMap('scorch', wrapPlane(-16.2, -9 - r() * 3, a0, a0 + 0.9, R + 0.02 + i * 0.001, this.aft)));
    }
    k.d.add(decalMat(), atlasMap('streaks', wrapPlane(-9, -2, 1.6, 2.4, R + 0.03, this.aft)));
    k.d.add(decalMat(), atlasMap('scorch', wrapPlane(5, 12, 1.9, 2.8, R + 0.03, this.fore)));
    k.d.add(decalMat(), atlasMap('dirt', wrapPlane(-4, 4, 2.2, 3.2, R + 0.025, this.aft)));

    // colliders: a cylinder per section (Rapier's cylinder is along its local y)
    this.cylCol(this.aft, -16, BEND, R);
    this.cylCol(this.fore, BEND, 16, R);
  }

  private cylCol(seg: THREE.Matrix4, x0: number, x1: number, rad: number) {
    const m = seg.clone().multiply(new THREE.Matrix4().makeTranslation((x0 + x1) / 2, 0, 0)).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2));
    const w = new THREE.Matrix4().multiplyMatrices(this.frame.m, m);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    w.decompose(p, q, s);
    const R_ = this.ctx.physics.R;
    const c = this.ctx.physics.world.createCollider(R_.ColliderDesc.cylinder((x1 - x0) / 2, rad).setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    surfaces.tag(c, 'metal');
  }

  // ================================================================ the engine end
  private buildEngines(M: Mats) {
    const k = this.kit;
    const r = rng(19);
    // the skirt and the octaweb plate the engines hang from
    k.b.add(M.heat, xf(new THREE.CylinderGeometry(R + 0.05, R + 0.05, 2.2, 48, 2, true).rotateZ(-Math.PI / 2).translate(-17.1, 0, 0), this.aft));
    k.b.add(M.heat, xf(new THREE.CylinderGeometry(R - 0.05, R - 0.05, 2.0, 48, 1, true).rotateZ(Math.PI / 2).translate(-17.1, 0, 0), this.aft));
    k.b.add(M.heatDark, xf(new THREE.CylinderGeometry(R, R, 0.12, 48).rotateZ(-Math.PI / 2).translate(-17.6, 0, 0), this.aft));
    // nine engines: one in the middle, eight round it; the down side crushed and pushed in
    const bell = bellGeometry();
    const at: [number, number][] = [[0, 0]];
    for (let i = 0; i < 8; i++) at.push([Math.cos((i / 8) * Math.PI * 2) * 1.22, Math.sin((i / 8) * Math.PI * 2) * 1.22]);
    for (const [yy, zz] of at) {
      const crushed = yy < -0.6 || zz > 1.0;
      const m = new THREE.Matrix4().compose(
        v3(-17.62 + (crushed ? 0.35 : 0), yy, zz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.2, (r() - 0.5) * (crushed ? 0.6 : 0.12), -Math.PI / 2 + (r() - 0.5) * (crushed ? 0.5 : 0.1))),
        v3(1, crushed ? 0.75 : 1, crushed ? 0.82 : 1),
      );
      k.b.add(M.bell, xf(bell[0].clone(), this.aft.clone().multiply(m)));
      k.b.add(M.soot, xf(bell[1].clone(), this.aft.clone().multiply(m)));
      // the turbopump and plumbing behind each bell
      k.b.add(M.pipe, xf(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8).rotateZ(Math.PI / 2).translate(-17.4, yy + 0.18, zz + 0.1), this.aft));
    }
    // insulation blankets hanging out of the skirt
    for (let i = 0; i < 5; i++) {
      const a = 0.4 + i * 1.1;
      const p = this.bpt(this.aft, -18.0, a, R - 0.1);
      k.b.add(M.blanket, xf(new THREE.PlaneGeometry(0.7, 1.1, 1, 3).translate(0, -0.55, 0), mat4(p.x, p.y, p.z, 0.3 + r() * 0.4, Math.PI / 2 + (r() - 0.5), r() - 0.5)));
    }
    // the hypergolic line that still weeps a puff now and then
    this.vent.copy(this.bpt(this.aft, -16.4, 2.3, R + 0.1));
    this.ventDir.set(-0.4, 0.6, 0.6).normalize().applyMatrix4(new THREE.Matrix4().extractRotation(this.frame.m));
    k.b.add(M.pipe, xf(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 8).rotateZ(1.1), mat4(this.vent.x, this.vent.y, this.vent.z, 0.2, 0.4, 0)));
    k.col(-17.3, 1.4, 0, 1.6, 1.4, 1.9, 0);
  }

  // ================================================================ the interstage, torn open
  private buildInterstage(M: Mats, strobeMat: THREE.Material) {
    const k = this.kit;
    const r = rng(5);
    const n = 30, x0 = 16, len = 4.6;
    const w = (2 * Math.PI * (R + 0.02)) / n + 0.02;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      // torn on the side the pod blew out of (around a = 1.3), ragged everywhere
      const tear = Math.max(0, Math.cos(a - 1.3)) ** 2 * 2.6 + r() * 0.5;
      const L = Math.max(0.6, len - tear);
      const m = this.fore.clone()
        .multiply(new THREE.Matrix4().makeRotationX(a))
        .multiply(new THREE.Matrix4().makeTranslation(x0 + L / 2, R + 0.02, 0));
      // the torn edge: a stave splays outward a little where it ripped
      const splay = tear > 1 ? new THREE.Matrix4().makeRotationZ(-0.05 - r() * 0.1) : new THREE.Matrix4();
      const g = new THREE.BoxGeometry(L, 0.06, w);
      k.b.add(M.carbon, xf(g, m.clone().multiply(splay)));
      // a collider for the staves that stand above the sand (two staves per box)
      const c = v3(L / 2, 0, 0).applyMatrix4(m);
      if (i % 2 === 0 && c.y > 0.4) k.ocol(m, L / 2, 0.08, w);
    }
    // the inner ring frame where the stage separates, and the struts behind the dome
    k.b.add(M.heatDark, xf(new THREE.TorusGeometry(R - 0.05, 0.06, 5, 48).rotateY(Math.PI / 2).translate(16.4, 0, 0), this.fore));
    // four grid fins at the top: three still on, one torn off (lies by the nose, buildDebris)
    const fin = gridFin();
    for (const a of [0.78, 2.36, 3.93]) {
      const m = this.fore.clone().multiply(new THREE.Matrix4().makeRotationX(a)).multiply(new THREE.Matrix4().makeTranslation(19.9, R + 0.06, 0));
      const stow = a > 3 ? 0.0 : a > 2 ? 0.9 : 0.35;
      k.b.add(M.fin, xf(fin.clone(), m.clone().multiply(new THREE.Matrix4().makeRotationY(stow))));
      k.b.add(M.heatDark, xf(new THREE.BoxGeometry(0.3, 0.25, 0.3).translate(0, 0.1, 0), m));
    }
    // the recovery strobe on top (it still has battery: Kade parts outlive Kade promises)
    const sp = this.bpt(this.fore, 19.6, -0.15, R + 0.12);
    k.b.add(M.heatDark, xf(new THREE.CylinderGeometry(0.09, 0.11, 0.18, 10), mat4(sp.x, sp.y - 0.02, sp.z)));
    k.b.add(strobeMat, xf(new THREE.SphereGeometry(0.08, 10, 8), mat4(sp.x, sp.y + 0.1, sp.z)));

    // inside: a rack against the dome with the avionics and the flight recorder, facing the open end
    const face = new THREE.Matrix4().extractRotation(this.fore);
    const along = v3(1, 0, 0).applyMatrix4(face).setY(0).normalize();
    const across = v3(along.z, 0, -along.x);
    const yawA = Math.atan2(along.x, along.z);
    const c0 = v3(17.05, 0, 0).applyMatrix4(this.fore);
    const gy = k.ground(c0.x, c0.z);
    const at = (dx: number, dy: number, ds: number) => v3(c0.x + along.x * dx + across.x * ds, gy + dy, c0.z + along.z * dx + across.z * ds);
    const rack = at(0, 0.95, 0);
    k.b.add(M.heatDark, xf(new THREE.BoxGeometry(1.4, 0.05, 0.5), mat4(rack.x, rack.y, rack.z, 0, yawA)));
    for (const ds of [-0.66, 0.66]) for (const dx of [-0.22, 0.22]) {
      const l = at(dx, 0.47, ds);
      k.b.add(M.pipe, xf(new THREE.BoxGeometry(0.04, 0.95, 0.04), mat4(l.x, l.y, l.z, 0, yawA)));
    }
    const box = (ds: number, w_: number, h_: number, d_: number, mat: THREE.Material) => {
      const b_ = at(0, 0.975 + h_ / 2, ds);
      k.b.add(mat, xf(new THREE.BoxGeometry(w_, h_, d_), mat4(b_.x, b_.y, b_.z, 0, yawA)));
    };
    box(-0.45, 0.36, 0.28, 0.32, M.avionics);
    box(-0.05, 0.3, 0.22, 0.3, M.avionics);
    box(0.4, 0.42, 0.3, 0.34, M.recorder); // the flight data recorder, Kade orange
    const scr = at(0.176, 0.975 + 0.15, 0.4);
    this.glows.add(artQuad('ascScreen', 0.26, 0.16, mat4(scr.x, scr.y, scr.z, 0, yawA)));
    const ins = at(1.8, 0, 0);
    this.spot('recorder', ins.x, 0, ins.z);
    this.recorderAt = at(0.3, 1.1, 0.4);
    // a cable loom from the rack up into the dome
    k.b.add(M.cableA, norm(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([at(0, 1.25, -0.3), at(-0.2, 1.8, -0.1), at(-0.45, 2.2, 0.3)]), 8, 0.03, 4)));
    // cable looms spilling out of the tear onto the sand
    for (let i = 0; i < 6; i++) {
      const a0 = 1.0 + r() * 0.6;
      const s = this.bpt(this.fore, 17.2 + r() * 1.2, a0, R - 0.1);
      const e = this.bpt(this.fore, 18.5 + r() * 2.5, a0 + 0.3, R + 1.2 + r());
      e.y = 0.05;
      const mid = s.clone().lerp(e, 0.5).add(v3(0, 0.5, 0));
      k.b.add(i % 2 ? M.cableA : M.cableB, norm(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([s, mid, e]), 10, 0.012 + r() * 0.012, 4)));
    }
  }
  private recorderAt = new THREE.Vector3();

  // ================================================================ landing legs
  private buildLegs(M: Mats) {
    const k = this.kit;
    const leg = (a: number, deploy: number, len: number, strut: boolean) => {
      const hinge = this.bpt(this.aft, -15.6, a, R + 0.12);
      const out = v3(0, Math.cos(a), Math.sin(a)).applyMatrix4(new THREE.Matrix4().extractRotation(this.aft)).normalize();
      const ax = v3(1, 0, 0).applyMatrix4(new THREE.Matrix4().extractRotation(this.aft)).normalize();
      const dir = ax.clone().multiplyScalar(Math.cos(deploy)).addScaledVector(out, Math.sin(deploy)).normalize();
      const tip = hinge.clone().addScaledVector(dir, len);
      const mid = hinge.clone().add(tip).multiplyScalar(0.5);
      // a long tapering carbon blade, its broad face across the tank
      const g = new THREE.BoxGeometry(0.85, len, 0.16);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setX(i, pos.getX(i) * 0.55);
      g.computeVertexNormals();
      const side = new THREE.Vector3().crossVectors(dir, out).normalize();
      const nrm = new THREE.Vector3().crossVectors(side, dir).normalize();
      const basis = new THREE.Matrix4().makeBasis(side, dir, nrm).setPosition(mid);
      k.b.add(M.carbon, xf(g, basis));
      k.b.add(M.skinDark, xf(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 10).rotateZ(Math.PI / 2), new THREE.Matrix4().makeBasis(side, dir, nrm).setPosition(hinge)));
      if (len > 6) {
        // the foot pad
        k.b.add(M.heatDark, xf(new THREE.CylinderGeometry(0.42, 0.48, 0.12, 14), new THREE.Matrix4().makeBasis(side, nrm, dir.clone().negate()).setPosition(tip)));
      }
      if (strut) {
        const base = this.bpt(this.aft, -10.8, a, R + 0.08);
        const on = hinge.clone().addScaledVector(dir, len * 0.55);
        k.b.add(M.pipe, norm(new THREE.CylinderGeometry(0.09, 0.09, base.distanceTo(on), 8).applyMatrix4(alignY(base, on))));
        k.b.add(M.steel, norm(new THREE.CylinderGeometry(0.06, 0.06, base.distanceTo(on) * 0.6, 8).applyMatrix4(alignY(base.clone().lerp(on, 0.2), on))));
      }
      return { hinge, tip, dir };
    };
    // up toward +z: fully deployed, foot in the air (the silhouette from the Garage's ridge)
    const up = leg(0.95, 2.05, 8.6, true);
    // down on the +z side: half out, the foot dug in
    leg(2.25, 0.75, 8.6, true);
    // the top: still stowed against the tank
    leg(-0.62, 0.05, 8.6, false);
    // down on the -z side: snapped; the rest of it lies by the engines (buildDebris)
    leg(-2.2, 1.55, 1.6, false);
    // a collider for the raised leg's lower half (you can walk under the rest)
    const lo = up.hinge.clone().addScaledVector(up.dir, 2);
    this.kit.col(lo.x, Math.max(0.5, lo.y), lo.z, 0.5, Math.max(0.5, lo.y), 0.5, 0);
  }

  // ================================================================ the ground: dune, trench, scorch
  private buildGround(M: Mats) {
    const k = this.kit;
    // the dune the engine end ploughed up, piled against the +z flank so you can climb onto the tank
    k.drift(-12.5, 5.6, 11, 7.5, 0.05, (u, v) => {
      const along = Math.sin(Math.min(1, u * 1.15) * Math.PI) ** 0.7;
      return Math.max(0, along * (1 - v) ** 1.3 * 2.9 - 0.1);
    }, 0.5);
    // sand blown over the engine end: the bells still show
    k.drift(-22, -3.2, 6, 7, 0.4, (u, v) => Math.max(0, Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * 0.9 - 0.1), 0.6);
    // berms along the slide, pushed up on the -z side
    k.drift(2, -4.4, 30, 3.4, 0.03, (u, v) => Math.max(0, Math.sin(u * Math.PI) ** 0.6 * Math.sin(v * Math.PI) * 0.9 - 0.05), 0.7);
    k.drift(19, -2.6, 6, 6, -0.1, (u, v) => Math.max(0, Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * 1.1 - 0.05), 0.6);
    // the crater the landing burn dug before it fell over: a low ring of blown sand round the engine end
    k.drift(-21, 0, 28, 28, 0, (u, v) => {
      const d = Math.hypot(u - 0.5, v - 0.5) * 28;
      return Math.max(0, 0.75 * Math.exp(-(((d - 9.5) / 2.6) ** 2)) * (0.8 + 0.2 * Math.sin(Math.atan2(v - 0.5, u - 0.5) * 5)) - 0.05);
    }, 0.8);
    // the scorch of the landing burn (it lit the desert for a mile), the gouge, oil
    k.d.add(decalMat(), floorDecal('scorch', 30, 26, -19, 0.03, 0, 0.3));
    k.d.add(decalMat(), floorDecal('scorch', 20, 18, -20, 0.032, 0.5, 2.1));
    k.d.add(decalMat(), floorDecal('scorch', 16, 14, -26, 0.035, 5, 1.4));
    k.d.add(decalMat(), floorDecal('gouge', 34, 7, 2, 0.04, -1.2, 0.02));
    k.d.add(decalMat(), floorDecal('oil', 6, 5, -12, 0.045, 3.4, 0.7));
    k.d.add(decalMat(), floorDecal('sandpile', 8, 8, 22, 0.05, 1.5, 0.2));
    // burned scrub ringing the scorch, fused glass glinting in it
    const r = rng(41);
    for (let i = 0; i < 22; i++) {
      const a = r() * Math.PI * 2, d = 9 + r() * 9;
      const x = -19 + Math.cos(a) * d, z = Math.sin(a) * d * 0.85;
      const y = k.ground(x, z);
      for (let j = 0; j < 4; j++) {
        const ta = r() * Math.PI * 2;
        k.b.add(M.char, norm(new THREE.CylinderGeometry(0.008, 0.02, 0.4 + r() * 0.4, 4).translate(0, 0.25, 0).rotateZ(0.5 + r() * 0.5).rotateY(ta).translate(x, y, z)));
      }
    }
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2, d = 4 + r() * 10;
      const x = -19 + Math.cos(a) * d, z = Math.sin(a) * d;
      k.b.add(M.rock, xf(rockGeometry(300 + i, 1), mat4(x, k.ground(x, z) + 0.05, z, 0, r() * 6, 0, 0.3 + r() * 0.5, 0.2 + r() * 0.2, 0.3 + r() * 0.4)));
    }
  }

  // ================================================================ the pod, thrown clear
  private podC = v3(-2, 0, 13.5);
  private podYaw = 0.75;
  private buildPod(M: Mats, ledMat: THREE.Material, okMat: THREE.Material) {
    const k = this.kit;
    const { x, z } = this.podC;
    const y = k.ground(x, z) + 0.82;
    const base = mat4(x, y, z, 0, this.podYaw, 0.06);
    const P = (m: THREE.Matrix4) => base.clone().multiply(m);
    // a fat capsule on its side: the body, the nose cone, the hatch end, Kade's band
    const body = new THREE.CylinderGeometry(0.95, 0.95, 3.0, 36, 4, true).rotateZ(Math.PI / 2);
    dent(body, 0.7, -0.2);
    k.b.add(M.pod, xf(body, P(new THREE.Matrix4())));
    k.b.add(M.pod, xf(new THREE.SphereGeometry(0.95, 36, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).rotateZ(-Math.PI / 2).translate(1.5, 0, 0), P(new THREE.Matrix4())));
    k.b.add(M.band, xf(new THREE.CylinderGeometry(0.965, 0.965, 0.35, 36, 1, true).rotateZ(Math.PI / 2).translate(0.9, 0, 0), P(new THREE.Matrix4())));
    k.b.add(M.heatDark, xf(new THREE.CylinderGeometry(0.97, 0.97, 0.14, 36).rotateZ(Math.PI / 2).translate(-1.5, 0, 0), P(new THREE.Matrix4())));
    // the hatch, and the keypad beside it
    k.b.add(M.podDark, xf(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 24).rotateZ(Math.PI / 2).translate(-1.6, 0.05, 0), P(new THREE.Matrix4())));
    for (const a of [0, 1.57, 3.14, 4.71]) {
      k.b.add(M.steel, xf(new THREE.BoxGeometry(0.06, 0.12, 0.08).translate(-1.62, 0.05 + Math.cos(a) * 0.5, Math.sin(a) * 0.5), P(new THREE.Matrix4())));
    }
    k.b.add(M.podDark, xf(new THREE.BoxGeometry(0.06, 0.26, 0.2).translate(-1.6, 0.5, 0.62), P(new THREE.Matrix4())));
    k.b.add(ledMat, xf(new THREE.SphereGeometry(0.018, 8, 6).translate(-1.64, 0.6, 0.66), P(new THREE.Matrix4())));
    k.b.add(okMat, xf(new THREE.SphereGeometry(0.018, 8, 6).translate(-1.64, 0.6, 0.58), P(new THREE.Matrix4())));
    this.keypadAt = v3(-1.7, 0.5, 0.62).applyMatrix4(base);
    // the label down its side, and the manifest pouch
    this.prints.add(wrapQuad('ascPod', -1.2, 1.0, 0.35, 0.9, 0.97, P(new THREE.Matrix4())));
    k.b.add(M.pouch, xf(new THREE.BoxGeometry(0.03, 0.34, 0.26).translate(-1.0, 0.92, -0.25), P(new THREE.Matrix4().makeRotationX(-0.15))));
    this.manifestAt = v3(-1.0, 0.95, -0.25).applyMatrix4(base);
    // its drogue chute, collapsed and half buried, still tied on
    const chute = new THREE.PlaneGeometry(4.2, 3.2, 14, 10);
    const cp = chute.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cp.count; i++) {
      const u = cp.getX(i), v = cp.getY(i);
      cp.setXYZ(i, u, 0.06 + Math.max(0, Math.sin(u * 2.4 + v * 1.7) * 0.18 + Math.sin(u * 5.1) * 0.06), v);
    }
    chute.computeVertexNormals();
    const cx = x - Math.cos(this.podYaw) * 4.4, cz = z + Math.sin(this.podYaw) * 4.4;
    k.b.add(M.chute, xf(chute, mat4(cx, k.ground(cx, cz), cz, 0, this.podYaw + 0.3)));
    for (let i = 0; i < 4; i++) {
      const e = v3(cx + (i - 1.5) * 0.9, k.ground(cx, cz) + 0.1, cz + 1.4);
      const s = v3(-1.55, -0.2, (i - 1.5) * 0.15).applyMatrix4(base);
      k.b.add(M.cableB, norm(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([s, s.clone().lerp(e, 0.5).setY(0.08), e]), 8, 0.008, 3)));
    }
    k.ocol(base, 1.9, 0.85, 0.85);
    this.spot('pod', x + 2.4, 0, z + 1.2);
  }
  private keypadAt = new THREE.Vector3();
  private manifestAt = new THREE.Vector3();

  // ================================================================ debris
  private buildDebris(M: Mats) {
    const k = this.kit;
    const r = rng(9);
    // the snapped leg, by the engines
    const lg = new THREE.BoxGeometry(7.0, 0.16, 0.85);
    k.b.add(M.carbon, xf(lg, mat4(-14, 0.12, -6.4, 0, 0.5, 0.04)));
    k.b.add(M.heatDark, xf(new THREE.CylinderGeometry(0.42, 0.48, 0.12, 14).rotateZ(1.4), mat4(-17.4, 0.4, -8.2, 0, 0.5)));
    k.col(-14, 0.15, -6.4, 3.5, 0.15, 0.45, 0.5);
    // the grid fin that tore off, half buried by the nose
    k.b.add(M.fin, xf(gridFin(), mat4(23.5, 0.55, 4.2, 0.2, 0.8, 1.15)));
    // skin panels peeled off in the slide
    for (const [px, pz, ry, rz] of [[8, -6.5, 0.4, 1.4], [14, 5.5, 2.2, -1.2], [-6, -7.5, -0.6, 1.6]] as [number, number, number, number][]) {
      const g = new THREE.CylinderGeometry(R, R, 2.2 + r(), 10, 1, true, 0, 0.9);
      k.b.add(M.skin, xf(g, mat4(px, k.ground(px, pz) + 0.25, pz, 0.1, ry, rz)));
      k.b.add(M.skinDark, xf(g.clone().scale(0.985, 1, 0.985), mat4(px, k.ground(px, pz) + 0.25, pz, 0.1, ry, rz)));
    }
    // composite pressure vessels, flung like bowling balls
    for (const [px, pz] of [[-8, 9], [11, -8.5], [26, -3], [3, 17]] as [number, number][]) {
      k.b.add(M.copv, xf(new THREE.SphereGeometry(0.45, 18, 12), mat4(px, k.ground(px, pz) + 0.32, pz, r(), r(), r())));
      k.b.add(M.steel, xf(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 8), mat4(px + 0.42, k.ground(px, pz) + 0.36, pz, 0, 0, 1.4)));
      k.col(px, k.ground(px, pz) + 0.32, pz, 0.4, 0.4, 0.4, 0);
    }
    this.copvAt = this.frame.p(-8, 0.4, 9);
    // shards along the slide: skin, carbon and heat-shield scraps half in the sand
    const shardMats = [M.skin, M.skin, M.carbon, M.heat, M.skinDark];
    for (let i = 0; i < 34; i++) {
      const along = -14 + r() * 42, off = (r() - 0.5) * 16;
      if (Math.abs(off) < R + 0.6 && along > -18 && along < 21) continue; // not inside the tank
      const s = 0.25 + r() * 0.7;
      const g = new THREE.BoxGeometry(s, 0.03 + r() * 0.03, s * (0.4 + r() * 0.8));
      k.b.add(shardMats[i % shardMats.length], xf(g, mat4(along, k.ground(along, off) + 0.02, off, (r() - 0.5) * 0.7, r() * 6, (r() - 0.5) * 0.7)));
    }
    // a cable tray ripped off the raceway, coiled on the sand
    const s = v3(10, 0.05, -4.0), e = v3(15.5, 0.05, -5.6);
    k.b.add(M.cableA, norm(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([s, v3(12, 0.25, -5.2), v3(13.5, 0.1, -4.2), e]), 18, 0.05, 5)));
    k.b.add(M.skinDark, xf(new THREE.BoxGeometry(3.2, 0.1, 0.32), mat4(12.2, 0.08, -5.3, 0, 0.35, 0.05)));
    this.cablesAt = this.frame.p(12.5, 0.4, -5.0);
    // rocks set by the dune and the nose, for the composition
    k.b.add(M.rock, xf(rockGeometry(311, 2), mat4(27, 0.6, 6.5, 0, 0.4, 0, 1.6, 1.0, 1.3)));
    k.b.add(M.rock, xf(rockGeometry(312, 2), mat4(-27, 0.5, -7, 0, 1.4, 0, 1.3, 0.8, 1.1)));
    k.col(27, 0.6, 6.5, 1.4, 0.8, 1.1, 0.4);
    k.col(-27, 0.5, -7, 1.1, 0.6, 0.9, 1.4);
  }
  private copvAt = new THREE.Vector3();
  private cablesAt = new THREE.Vector3();

  // ================================================================ Kade's claim: stakes and tape
  private buildPerimeter(M: Mats) {
    const k = this.kit;
    const r = rng(3);
    const n = 22, A = 33, B = 20;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * A + (r() - 0.5) * 1.5, z = Math.sin(a) * B + 2 + (r() - 0.5) * 1.5;
      const y = k.ground(x, z);
      const lean = (r() - 0.5) * 0.25;
      pts.push(v3(x + lean * 1.0, y + 1.0, z));
      k.b.add(M.stake, xf(new THREE.BoxGeometry(0.05, 1.15, 0.05), mat4(x + lean * 0.5, y + 0.5, z, 0, r() * 3, lean)));
    }
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if (i === 4 || i === 13) {
        // broken: two tails, one on the sand and one flapping
        const t = a.clone().lerp(b, 0.35).setY(k.ground((a.x + b.x) / 2, (a.z + b.z) / 2) + 0.03);
        k.b.add(M.tape, tape(a, t, 0.1));
        continue;
      }
      if (i === 9) continue; // a stake pulled out entirely, tape gone
      k.b.add(M.tape, tape(a, b, 0.18 + r() * 0.12));
    }
    // the claim sign facing the way you walk in (north, the Garage side)
    const sx = 4, sz = 2 + B + 0.8;
    const sy = k.ground(sx, sz);
    for (const dx of [-0.75, 0.75]) k.b.add(M.stake, xf(new THREE.BoxGeometry(0.08, 1.8, 0.08), mat4(sx + dx, sy + 0.9, sz)));
    k.b.add(M.podDark, xf(new THREE.BoxGeometry(1.7, 1.13, 0.04), mat4(sx, sy + 1.32, sz - 0.03)));
    this.prints.add(artQuad('ascClaim', 1.66, 1.1, mat4(sx, sy + 1.32, sz - 0.052, 0, Math.PI)));
    this.prints.add(artQuad('ascClaim', 1.66, 1.1, mat4(sx, sy + 1.32, sz - 0.008)));
    k.col(sx, sy + 1.0, sz, 0.9, 1.0, 0.1, 0);
    this.spot('approach', sx + 2, 0, sz + 8);
  }

  // ================================================================ interactions
  private toast(text: string, kind: 'info' | 'good' | 'bad' = 'info') { this.s.events.emit('toast', { text, kind }); }

  private loot(items: { id: string; qty: number }[]) {
    const got: string[] = [];
    for (const it of items) {
      const n = this.s.addItem(it.id, it.qty);
      if (n) got.push(`${n}× ${ITEMS[it.id]?.name ?? it.id}`);
    }
    return got.join(', ');
  }

  private buildInteractables() {
    const site = this;
    const W = (p: THREE.Vector3) => this.frame.p(p.x, p.y, p.z);
    this.interactables.push({
      id: 'booster.manifest', pos: W(this.manifestAt), radius: 1.8,
      primary: {
        get label() { return site.s?.has(F.manifest) ? 'Read the manifest again' : 'Read the pod\'s manifest'; },
        available: () => true,
        run: () => this.readManifest(),
      },
    });
    this.interactables.push({
      id: 'booster.pod', pos: W(this.keypadAt), radius: 1.6,
      visible: () => !this.s?.has(F.pod),
      primary: { label: 'Enter the pod code', available: () => true, run: () => this.podKeypad() },
      secondary: {
        label: 'Pry the hatch with the crowbar (loud, messy)',
        available: () => (this.s.count('crowbar') > 0 ? true : 'Need a crowbar'),
        run: () => this.pry(),
      },
    });
    this.interactables.push({
      id: 'booster.recorder', pos: W(this.recorderAt), radius: 1.9,
      primary: {
        get label() { return site.s?.has(F.power) ? 'Play the flight recorder' : 'Wake the flight recorder'; },
        available: () => {
          if (this.s.has(F.power)) return true;
          return this.s.skill('electronics') >= 1 ? true : 'Requires Electronics 1, or a Lithium Cell (F)';
        },
        run: () => this.wakeRecorder(false),
      },
      secondary: {
        label: 'Wire in a Lithium Cell',
        available: () => (this.s.has(F.power) ? 'It\'s already awake' : this.s.count('battery') > 0 ? true : 'Need a Lithium Cell'),
        run: () => this.wakeRecorder(true),
      },
    });
    this.interactables.push({
      id: 'booster.cables', pos: this.cablesAt, radius: 2.2,
      visible: () => !this.s?.has(F.cables),
      primary: {
        label: 'Strip the cable tray',
        available: () => true,
        run: () => {
          if (!this.s.set(F.cables)) return;
          const got = this.loot([{ id: 'scrap', qty: 3 }, { id: 'battery', qty: 1 }]);
          this.ctx.audio.play('pickup');
          this.toast(`Aerospace copper, aerospace connectors, and a backup cell nobody inventoried. ${got}`, 'good');
          this.s.addXP(XP_REWARDS.cache, 'Cable tray');
        },
      },
    });
    this.interactables.push({
      id: 'booster.copv', pos: this.copvAt, radius: 1.7,
      visible: () => !this.s?.has(F.copv),
      primary: {
        label: 'Check the pressure sphere',
        available: () => true,
        run: () => {
          if (!this.s.set(F.copv)) return;
          const got = this.loot([{ id: 'scrap', qty: 2 }]);
          this.ctx.audio.play('pickup');
          this.toast(`Carbon wrap over a titanium liner, rated for 6,000 psi and one landing. The valve unscrews. ${got}`, 'good');
          this.s.addXP(10, 'Pressure sphere');
        },
      },
    });
  }

  private async readManifest() {
    const s = this.s;
    if (s.set(F.manifest)) s.addXP(25, 'Longshot manifest');
    await this.ctx.ui.choose({
      speaker: 'Manifest · Kade Longshot B7',
      text:
        'PRIORITY RESUPPLY 3 → APEX VAULT, PAD B. Customer: V. Kade (personal). Contents: 12× glacier water, single-estate, bottled at source (Iceland). ' +
        '40 kg wagyu, dry-aged. 1× replacement sommelier (declined to board). 1× signed first edition of her own book. ' +
        'Special handling, customer\'s note: "No Kade water on board. I know where it\'s been." ' +
        'Pod seal: customer code, transmitted at descent (see recorder).',
      choices: [{ id: 'ok', label: 'Put it back in the pouch' }],
    });
  }

  private async wakeRecorder(cell: boolean) {
    const s = this.s;
    if (!s.has(F.power)) {
      if (cell) {
        if (!s.removeItem('battery', 1)) return;
        this.toast('The cell takes. The recorder clicks, thinks about it, and shows a cursor.', 'good');
      } else if (s.skill('electronics') < 4) {
        const ok = await this.ctx.ui.circuit({ title: 'LONGSHOT B7 · FLIGHT RECORDER', difficulty: s.focus('electronics') === 'hotline' ? 1 : 2 });
        if (!ok) { this.ctx.audio.play('deny'); return; }
      }
      s.set(F.power);
      s.addXP(XP_REWARDS.keypadShorted, 'Flight recorder');
      this.ctx.audio.play('zap', { pos: this.ctx.player.position });
    }
    const first = s.set(F.done);
    if (first) {
      s.set(F.found);
      s.set(F.code);
      s.addXP(60, 'The last eleven minutes');
    }
    await this.ctx.ui.choose({
      speaker: 'Flight recorder · Longshot B7',
      text:
        'T+04:10 Boostback nominal. Target APEX PAD B. T+06:55 Crosswind 41 knots, outside limits. Recommend divert. ' +
        'T+06:58 Customer override, voice: "It\'s a rocket, not a bicycle. Land it at the pad." T+07:30 Entry burn. ' +
        'T+08:02 Pod release requested by customer: "If it lands hard, open the pod and save the water. Code two-zero-four-eight." ' +
        'T+08:41 Landing burn. T+08:44 Pad not found. Ground found. T+08:45 Ground found again. ' +
        'Last fix: Pad B bears two-seven-five, west of the salt. Recording ends.',
      choices: [{ id: 'ok', label: first ? 'Two-zero-four-eight. West of the salt.' : 'Let it loop' }],
    });
  }

  private async podKeypad() {
    const heard = this.s.has(F.code);
    const res = await this.ctx.ui.keypad({
      title: 'PRIORITY RESUPPLY · POD SEAL',
      code: POD_CODE,
      hint: heard ? 'She said it on the recorder: two-zero-four-eight.' : 'Four digits. The customer chose them. The manifest says the recorder knows.',
    });
    if (res === 'ok') this.openPod(false);
    else if (res === 'wrong') { this.ctx.audio.play('deny'); this.toast('KADE: "That is not the code. This attempt has been logged."', 'bad'); }
  }

  private pry() {
    if (this.s.count('crowbar') < 1) return;
    this.ctx.audio.play('thud', { pos: this.ctx.player.position, intensity: 1 });
    this.openPod(true);
  }

  private openPod(pried: boolean) {
    const s = this.s;
    if (!s.set(F.pod)) return;
    this.ctx.audio.play('unlock', { pos: this.ctx.player.position });
    const got = this.loot(pried
      ? [{ id: 'water', qty: 2 }, { id: 'ration', qty: 1 }, { id: 'scrap', qty: 2 }]
      : [{ id: 'water', qty: 4 }, { id: 'ration', qty: 2 }, { id: 'medkit', qty: 1 }]);
    s.addXP(pried ? XP_REWARDS.cache : 45, 'Priority resupply');
    this.toast(pried
      ? `The hatch gives with a sound like money. Half the bottles didn't survive the crowbar. ${got}`
      : `The seal sighs open. Cold inside, still. Glacier water in glass, wagyu in vacuum foil, and a first-aid kit with her monogram. ${got}`, 'good');
  }

  // ================================================================ per frame
  update(dt: number, cam: THREE.Vector3) {
    super.update(dt, cam);
    this.t += dt;
    const night = this.ctx.atmo.uNight.value as number;
    // the recovery strobe: a double flash every 2.4 s
    const ph = this.t % 2.4;
    const flash = ph < 0.06 || (ph > 0.2 && ph < 0.26) ? 1 : 0;
    this.strobe.value = flash * (4 + night * 16);
    this.kit.halos.channels[this.strobeCh] = flash * (0.2 + night * 0.9);
    this.farHalo.channels[1] = flash * night;
    this.strobeLight.intensity = flash * night * 30;
    const s = this.ctx.state;
    const open = !!s?.has(F.pod);
    this.podLed.value = open ? 0 : 1.5 + night * 3 * (Math.sin(this.t * 3) > 0 ? 1 : 0.2);
    this.podLedOk.value = open ? 2 + night * 3 : 0;
    const powered = !!s?.has(F.power);
    this.screenLight.intensity = powered ? 0.4 + night * 0.9 : 0;
    if (this.near.visible) {
      uSiteNight.value = night;
      uSiteFlicker.value = powered ? 0.92 + 0.08 * Math.sin(this.t * 17) : 0.06;
    }
    // the weeping line: a pale puff every few seconds while anyone is close enough to see it
    const pl = this.ctx.player?.position;
    if (pl) {
      const d = Math.hypot(pl.x - this.frame.x, pl.z - this.frame.z);
      if (d < 70 && (this.ventT -= dt) <= 0) {
        this.ventT = 4 + Math.random() * 5;
        const w = this.frame.p(this.vent.x, this.vent.y, this.vent.z);
        this.ctx.puffs?.emit(w, 5, 0.25, 0.5, 0.5, this.ventDir, true);
      }
      // Kade's pod alarm worked after all: a recovery crew comes for the salvage, once, half a minute
      // after the seal breaks (or the next time you're back, if you left before they got here)
      if (s && s.has(F.pod) && !s.has(F.recovery) && this.onAmbush) {
        if (d < 110) this.recoveryT -= dt;
        if (this.recoveryT <= 0) {
          s.set(F.recovery);
          const w = new THREE.Vector3(Math.sin(this.frame.yaw), 0, Math.cos(this.frame.yaw)); // the site's north (local +z), the road side
          const n = this.onAmbush(pl.clone(), Math.atan2(-w.x, -w.z), 38, 3);
          if (n) this.ctx.ui.subtitle('Kade Recovery · radio', 'Seal breach on Longshot B7. That\'s the boss\'s water. Recover the asset, detain the thief.');
        }
      }
      if (s && d < 14 && !s.has(F.found)) {
        s.set(F.found);
        this.toast('Kade\'s name, three metres tall, lying in the sand. The tape says it\'s still theirs.', 'info');
      }
    }
  }
}

// ------------------------------------------------------------------ materials
type Mats = ReturnType<typeof mats>;
function mats() {
  return {
    skin: plainStandard('#dcd9d1', 0.5, 0.2),
    skinDark: rustyMetal({ base: '#8f8c86', rust: 0.25, metalness: 0.5, roughness: 0.5 }),
    heat: plainStandard('#2a2826', 0.8, 0.2),
    heatDark: plainStandard('#1c1b1a', 0.65, 0.35),
    bell: rustyMetal({ base: '#5a5d63', rust: 0.06, metalness: 0.85, roughness: 0.35 }),
    soot: plainStandard('#100e0d', 0.92),
    pipe: rustyMetal({ base: '#7d7a74', rust: 0.3, metalness: 0.8, roughness: 0.4 }),
    steel: rustyMetal({ base: '#a3a39d', rust: 0.25, metalness: 0.8, roughness: 0.4 }),
    carbon: plainStandard('#202124', 0.55, 0.1),
    fin: rustyMetal({ base: '#57544f', rust: 0.2, metalness: 0.85, roughness: 0.42 }),
    blanket: plainStandard('#c9b98a', 0.55, 0.6),
    pod: plainStandard('#e2ded4', 0.55, 0.1),
    podDark: plainStandard('#2e3136', 0.6, 0.2),
    band: plainStandard('#d8641e', 0.55),
    pouch: plainStandard('#3a3d42', 0.8),
    chute: fabric('#d8641e'),
    cableA: plainStandard('#151515', 0.6),
    cableB: plainStandard('#c8c2b4', 0.7),
    avionics: plainStandard('#3c3f44', 0.5, 0.4),
    recorder: plainStandard('#e0601c', 0.5, 0.1),
    copv: plainStandard('#2a2b2d', 0.45, 0.15),
    stake: wood('#8a6a44'),
    tape: plainStandard('#d8641e', 0.6),
    char: plainStandard('#1a1614', 0.95),
    rock: desertRock(),
  };
}

// ------------------------------------------------------------------ helpers
/** A rocket engine bell, thin-walled: [outside, inside] lathes, throat at the top, exit at y = -1.4. */
function bellGeometry(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const n = 12;
  const r = (t: number) => 0.17 + 0.3 * Math.pow(t, 0.75);
  const out: THREE.Vector2[] = [], ins: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) { const t = i / n; out.push(new THREE.Vector2(r(t) + 0.014, -t * 1.4)); }
  for (let i = n; i >= 0; i--) { const t = i / n; ins.push(new THREE.Vector2(r(t), -t * 1.4 + 0.004)); }
  // a lip at the exit so the rim catches light
  out.push(new THREE.Vector2(r(1) + 0.03, -1.4), new THREE.Vector2(r(1), -1.41));
  return [norm(new THREE.LatheGeometry(out, 22)), norm(new THREE.LatheGeometry(ins, 22))];
}

/** A grid fin: frame plus a 45° lattice, about 1.5 m out from the hinge and 1.1 m along. */
function gridFin() {
  const parts: THREE.BufferGeometry[] = [];
  const W = 1.1, H = 1.5, T = 0.12;
  parts.push(new THREE.BoxGeometry(W, 0.06, T).translate(0, 0.03, 0));
  parts.push(new THREE.BoxGeometry(W, 0.06, T).translate(0, H, 0));
  parts.push(new THREE.BoxGeometry(0.06, H, T).translate(-W / 2, H / 2, 0));
  parts.push(new THREE.BoxGeometry(0.06, H, T).translate(W / 2, H / 2, 0));
  // lines y = s·x + c clipped to the frame
  const x0 = -W / 2, x1 = W / 2, y0 = 0, y1 = H;
  for (const sgn of [-1, 1]) {
    for (let c = -2; c <= 2; c += 0.16) {
      const pts: THREE.Vector2[] = [];
      for (const x of [x0, x1]) { const y = sgn * x + c; if (y >= y0 && y <= y1) pts.push(new THREE.Vector2(x, y)); }
      for (const y of [y0, y1]) { const x = (y - c) / sgn; if (x > x0 && x < x1) pts.push(new THREE.Vector2(x, y)); }
      if (pts.length < 2) continue;
      const [p, q] = pts;
      const len = p.distanceTo(q);
      if (len < 0.05) continue;
      parts.push(new THREE.BoxGeometry(0.02, len, T * 0.9).rotateZ(-Math.atan2(q.x - p.x, q.y - p.y)).translate((p.x + q.x) / 2, (p.y + q.y) / 2, 0));
    }
  }
  return merged(parts);
}

/** A plane wrapped onto a cylinder of radius r around the booster axis: x from x0 to x1, angle a0..a1 (from up toward +z). Normals outward. */
function wrapPlane(x0: number, x1: number, a0: number, a1: number, r: number, seg: THREE.Matrix4) {
  const nx = Math.max(1, Math.ceil(Math.abs(x1 - x0) / 2)), na = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 0.12));
  const g = new THREE.PlaneGeometry(1, 1, nx, na);
  const p = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5, v = p.getY(i) + 0.5;
    const x = x0 + (x1 - x0) * u;
    // v = 1 is the higher edge (toward the top of the tank, smaller angle)
    const a = a1 + (a0 - a1) * v;
    p.setXYZ(i, x, Math.cos(a) * r, Math.sin(a) * r);
    nrm.setXYZ(i, 0, Math.cos(a), Math.sin(a));
  }
  g.applyMatrix4(seg);
  return norm(g);
}

/** wrapPlane showing a places-atlas entry. */
function wrapQuad(name: string, x0: number, x1: number, a0: number, a1: number, r: number, seg: THREE.Matrix4) {
  return artMap(name, wrapPlane(x0, x1, a0, a1, r, seg));
}

/** Push a dent into a cylinder lying along x. */
function dent(g: THREE.BufferGeometry, x: number, a: number) {
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ang = Math.atan2(z, y);
    const k = Math.exp(-((px - x) ** 2) * 2) * Math.max(0, Math.cos(ang - a)) ** 3 * 0.16;
    const s = 1 - k;
    p.setXYZ(i, px, y * s, z * s);
  }
  g.computeVertexNormals();
}

/** A matrix that takes a y-axis cylinder of unit-length placement onto the segment a→b. */
function alignY(a: THREE.Vector3, b: THREE.Vector3) {
  const q = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), b.clone().sub(a).normalize());
  return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, v3(1, 1, 1));
}

/** Kade's tape between two stakes, sagging, a thin ribbon. */
function tape(a: THREE.Vector3, b: THREE.Vector3, sag: number) {
  const n = 8;
  const pos: number[] = [];
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(a.clone().lerp(b, t).add(v3(0, -sag * 4 * t * (1 - t), 0)));
  }
  const h = 0.07;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[i + 1];
    const tw = Math.sin(i * 1.7) * 0.02;
    pos.push(p.x, p.y + h / 2, p.z + tw, p.x, p.y - h / 2, p.z - tw, q.x, q.y + h / 2, q.z);
    pos.push(q.x, q.y + h / 2, q.z, p.x, p.y - h / 2, p.z - tw, q.x, q.y - h / 2, q.z);
    // back face
    pos.push(p.x, p.y + h / 2, p.z + tw, q.x, q.y + h / 2, q.z, p.x, p.y - h / 2, p.z - tw);
    pos.push(q.x, q.y + h / 2, q.z, q.x, q.y - h / 2, q.z, p.x, p.y - h / 2, p.z - tw);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return norm(g);
}

