import * as THREE from 'three/webgpu';
import type { GameContext, Interactable } from '../context';
import { Landmarks } from '../world/Landmarks';
import type { GameState } from '../State';
import { MeshBatch, DistanceLod, shadowProxy, Frame } from '../world/kit';
import { glow, plainStandard, rustyMetal, wood, concrete, desertRock, fabric } from '../world/materials';
import { LANDMARKS } from '@/content/world';
import { rockGeometry } from '../world/Props';
import { loreMaterial, loreQuad } from '../world/loreAtlas';
import { STORY_SPOTS } from '@/content/quests';
import { rumourTonight } from '@/content/camp';
import type { SpotHandle } from '@/engine/ambient';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const T = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  g.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), V(1, 1, 1)));
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6) {
  const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b), seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1)));
}
/** A thing built in its own frame (origin on the ground, yaw), placed in the world. */
function placed(g: THREE.Object3D, x: number, y: number, z: number, yaw: number) {
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  g.updateMatrix();
  return g;
}

/**
 * The props the founders' favours need (content/quests.ts: Class of Tomorrow, Seen), and the camp
 * choices those favours and Read Receipts add:
 * - the old Kade Kids Academy, west of Dry Creek: a bent rocket sign, the plaque, the time capsule
 * - Glimpse's camera on a pole by the road at Last Chance (blue light; cut, looped or watching)
 * - Glimpse's relay mast on the rise south-east of camp, where you decide what the watcher sees
 * - Pip's chalk pool on the forecourt, once she has her letter
 * Everything is in the scene from boot (hidden parts too) for the shader warm-up; each piece hides
 * past ~170 m. Printed faces share the lore atlas (world/loreAtlas.ts).
 */
export class Stories {
  readonly group = new THREE.Group();
  readonly interactables: Interactable[] = [];
  /** Feet positions for the harness. */
  readonly spots: Record<string, THREE.Vector3> = {};
  private lods: DistanceLod[] = [];
  private t = 0;
  private synced: GameState | null = null;
  private capsuleShut: THREE.Object3D;
  private capsuleOpen: THREE.Object3D;
  private camLed: { value: number };
  private relayLed: { value: number };
  private lunchbox: THREE.Object3D;
  private cutCable: THREE.Object3D;
  private pool: THREE.Object3D;
  private capsuleAt: THREE.Vector3;

  constructor(private ctx: GameContext, landmarks: Landmarks, place: (x: number, z: number) => [number, number]) {
    this.group.name = 'stories';
    landmarks.group.add(this.group);
    const hf = ctx.hf;
    const steel = rustyMetal({ base: '#6a6d70', rust: 0.45, metalness: 0.7 });
    const dark = plainStandard('#232527', 0.55, 0.2);
    const paper = loreMaterial();
    const white = plainStandard('#e8ebee', 0.35, 0.1);

    // ---------------------------------------------------------------- Kade Kids Academy: the sign and the capsule
    {
      const [x, z] = place(...STORY_SPOTS.capsule);
      const y = hf.heightAt(x, z);
      const yaw = 0.9;
      const mb = new MeshBatch();
      const post = rustyMetal({ base: '#2f9be8', rust: 0.55, metalness: 0.6 });
      // two posts, one bent: the sign hangs off it at an angle, still smiling
      mb.add(post, T(new THREE.CylinderGeometry(0.07, 0.08, 3.2, 10), -1.7, 1.6, 0));
      mb.add(post, rod(V(1.7, 0, 0), V(1.75, 1.7, 0.05), 0.075, 10), rod(V(1.75, 1.7, 0.05), V(1.2, 2.6, 0.5), 0.07, 10));
      const signM = new THREE.Matrix4().compose(V(0.1, 2.35, 0.2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, 0.08, -0.22)), V(1, 1, 1));
      mb.add(paper, loreQuad('kadeKids', 3.4, 1.7).applyMatrix4(signM));
      mb.add(post, new THREE.BoxGeometry(3.5, 1.8, 0.05).translate(0, 0, -0.03).applyMatrix4(signM));
      // the plaque on a little concrete plinth, and the mound it marks
      const plinth = concrete('#a39a8c');
      mb.add(plinth, T(new THREE.BoxGeometry(0.7, 0.5, 0.35), 0.3, 0.2, 2.4, 0, 0.2, 0));
      mb.add(paper, T(loreQuad('plaque', 0.6, 0.3), 0.3, 0.42, 2.4 + 0.178, -0.35, 0.2, 0));
      // broken concrete where the school was, and a toppled rocket cut-out
      const rock = desertRock();
      for (const [sx, sz, s] of [[-3, -1.5, 0.6], [-4.2, 0.8, 0.45], [3.6, -2.2, 0.7], [4.8, 1.4, 0.4], [-2.4, 3.6, 0.5]] as const) {
        mb.add(plinth, T(new THREE.BoxGeometry(s * 1.6, s * 0.4, s * 1.1), sx, s * 0.12, sz, 0.1, sx * 0.7, 0.08));
      }
      mb.add(rock, T(rockGeometry(71, 1).scale(0.5, 0.25, 0.4), -1.2, 0.05, 2.9));
      mb.add(white, T(new THREE.CylinderGeometry(0.22, 0.22, 2.2, 12), -3.4, 0.22, 2.6, 0, 0.4, Math.PI / 2 - 0.08));
      mb.add(plainStandard('#d23a2a', 0.45), T(new THREE.ConeGeometry(0.22, 0.6, 12), -3.4 + Math.cos(0.4) * 1.4, 0.22, 2.6 - Math.sin(0.4) * 1.4, 0, 0.4, -Math.PI / 2 - 0.08));
      const near = mb.build('kadekids');
      shadowProxy(near);
      const site = placed(new THREE.Group(), x, y, z, yaw);
      site.add(near);
      // the capsule: a mound with the cap showing, then a hole with the tube lying open beside it
      const shut = new MeshBatch();
      shut.add(rock, T(rockGeometry(73, 1).scale(0.75, 0.22, 0.6), 0.3, 0.0, 3.25));
      shut.add(steel, T(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 14), 0.25, 0.14, 3.2, 0.25, 0, 0.1));
      this.capsuleShut = shut.build('capsule-shut');
      const open = new MeshBatch();
      open.add(plainStandard('#3a2a1c', 0.95), T(new THREE.CylinderGeometry(0.42, 0.3, 0.05, 16), 0.3, 0.005, 3.25));
      open.add(rock, T(rockGeometry(74, 1).scale(0.5, 0.18, 0.35), 1.0, 0.0, 3.4));
      open.add(steel, T(new THREE.CylinderGeometry(0.16, 0.16, 0.7, 14, 1, true), 0.95, 0.17, 2.85, 0, 1.2, Math.PI / 2));
      open.add(steel, T(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 14), 1.4, 0.16, 2.6, 0.3, 1.2, Math.PI / 2 - 0.4));
      open.add(paper, T(loreQuad('letter', 0.14, 0.18), 0.6, 0.012, 3.0, -Math.PI / 2, 0.5, 0));
      open.add(paper, T(loreQuad('letter', 0.14, 0.18), 0.48, 0.013, 2.85, -Math.PI / 2, -0.3, 0));
      this.capsuleOpen = open.build('capsule-open');
      this.capsuleOpen.visible = false;
      site.add(this.capsuleShut, this.capsuleOpen);
      this.group.add(site);
      const c = new THREE.Vector3(x, y, z);
      this.capsuleAt = c;
      this.lods.push(new DistanceLod(c, 6, site, null, 170));
      ctx.physics.addBox(V(0.3, 0.2, 2.4).applyMatrix4(site.matrix), { x: 0.35, y: 0.25, z: 0.18 }, yaw + 0.2);
      ctx.physics.addCylinder(V(-1.7, 1.6, 0).applyMatrix4(site.matrix), 1.6, 0.09);
      this.spots.capsule = V(0.3, 0, 4.6).applyMatrix4(site.matrix).setY(hf.heightAt(x, z));
      this.interactables.push({
        id: 'story.capsule', pos: V(0.3, 0.3, 3.25).applyMatrix4(site.matrix), radius: 2.0,
        visible: () => !this.s?.has('q.capsule.dug'),
        primary: { label: 'Dig up the time capsule', available: () => true, run: () => this.digCapsule() },
      });
    }

    // ---------------------------------------------------------------- Glimpse's camera on a pole by the road
    {
      const [x, z] = place(...STORY_SPOTS.glimpsecam);
      const y = hf.heightAt(x, z);
      const yaw = 2.6; // the lens looks at the forecourt
      const mb = new MeshBatch();
      mb.add(wood('#5d4630'), T(new THREE.CylinderGeometry(0.09, 0.11, 3.6, 9), 0, 1.8, 0));
      mb.add(steel, T(new THREE.BoxGeometry(0.06, 0.06, 0.4), 0, 3.25, 0.2)); // the arm
      mb.add(white, T(new THREE.BoxGeometry(0.16, 0.14, 0.3), 0, 3.2, 0.45, 0.25, 0, 0)); // the camera
      mb.add(dark, T(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12), 0, 3.16, 0.61, Math.PI / 2 + 0.25, 0, 0)); // lens
      mb.add(paper, T(loreQuad('sticker', 0.1, 0.1), 0.081, 3.21, 0.43, 0.25, Math.PI / 2, 0));
      // a small solar panel above, and the uplink antenna aimed south-east at the relay
      mb.add(dark, T(new THREE.BoxGeometry(0.45, 0.02, 0.32), 0, 3.62, 0, -0.5, 0, 0));
      mb.add(plainStandard('#1c2b4a', 0.2, 0.6), T(new THREE.BoxGeometry(0.42, 0.005, 0.29), 0, 3.635, -0.005, -0.5, 0, 0));
      mb.add(steel, rod(V(0, 3.0, -0.1), V(0.2, 3.5, -0.45), 0.01, 4));
      const led = glow('#3fa8ff', 6);
      this.camLed = led.intensity as unknown as { value: number };
      mb.add(led.material, T(new THREE.SphereGeometry(0.014, 8, 6), 0.05, 3.29, 0.6));
      const near = mb.build('glimpse-cam');
      shadowProxy(near);
      // Dez's loop: a red lunchbox strapped to the pole, a cable up to the camera
      const lb = new MeshBatch();
      lb.add(plainStandard('#c23b2a', 0.5), T(new THREE.BoxGeometry(0.3, 0.18, 0.18), 0, 1.5, 0.17));
      lb.add(dark, T(new THREE.BoxGeometry(0.32, 0.025, 0.24), 0, 1.5, 0.12), new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0.1, 1.6, 0.18), V(0.14, 2.3, 0.12), V(0.06, 3.1, 0.2), V(0, 3.18, 0.32)]), 10, 0.01, 4));
      this.lunchbox = lb.build('glimpse-loop');
      this.lunchbox.visible = false;
      // cut: the uplink cable hangs loose off the camera
      const cut = new MeshBatch();
      cut.add(dark, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 3.12, 0.4), V(0.05, 2.7, 0.5), V(0.02, 2.2, 0.42), V(0.1, 1.9, 0.5)]), 10, 0.012, 4));
      this.cutCable = cut.build('glimpse-cut');
      this.cutCable.visible = false;
      const g = placed(new THREE.Group(), x, y, z, yaw);
      g.add(near, this.lunchbox, this.cutCable);
      this.group.add(g);
      this.lods.push(new DistanceLod(V(x, y, z), 1, g, null, 170));
      ctx.physics.addCylinder(V(x, y + 1.8, z), 1.8, 0.11);
      this.spots.glimpsecam = V(0, 0, 2.2).applyMatrix4(g.matrix).setY(y);
      this.interactables.push({
        id: 'story.glimpsecam', pos: V(x, y + 1.5, z), radius: 2.6,
        visible: () => !!this.s && !this.s.has('q.cam.seen'),
        primary: { label: 'Look at the camera', available: () => true, run: () => this.lookCamera() },
      });
    }

    // ---------------------------------------------------------------- Glimpse's relay mast on the rise
    {
      const [x, z] = place(...STORY_SPOTS.glimpserelay);
      const y = hf.heightAt(x, z);
      const yaw = -0.7;
      const mb = new MeshBatch();
      // a galvanised mast in a concrete pad, guyed three ways, a cabinet at its foot
      mb.add(concrete('#a39a8c'), T(new THREE.BoxGeometry(1.4, 0.25, 1.4), 0, 0.05, 0));
      mb.add(steel, T(new THREE.CylinderGeometry(0.06, 0.08, 5.2, 8), 0, 2.7, 0));
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.3;
        mb.add(dark, rod(V(0, 4.6, 0), V(Math.cos(a) * 3.2, 0.05, Math.sin(a) * 3.2), 0.008, 3));
        mb.add(steel, T(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), Math.cos(a) * 3.2, 0.1, Math.sin(a) * 3.2));
      }
      mb.add(white, T(new THREE.BoxGeometry(0.6, 0.85, 0.38), 0.55, 0.62, 0.3, 0, 0.3, 0)); // the cabinet
      mb.add(paper, T(loreQuad('sticker', 0.24, 0.24), 0.55 + Math.sin(0.3) * 0.192, 0.75, 0.3 + Math.cos(0.3) * 0.192, 0, 0.3, 0));
      mb.add(dark, T(new THREE.BoxGeometry(0.16, 0.1, 0.02), 0.55 + Math.sin(0.3) * 0.2, 0.42, 0.3 + Math.cos(0.3) * 0.2, 0, 0.3, 0)); // speaker grille
      // two dishes: one back at the camp, one north, at nothing you can see
      mb.add(white, T(new THREE.SphereGeometry(0.4, 14, 6, 0, Math.PI * 2, 0, 0.9), 0, 4.3, 0.2, Math.PI / 2 - 0.1, 2.9, 0));
      mb.add(white, T(new THREE.SphereGeometry(0.32, 14, 6, 0, Math.PI * 2, 0, 0.9), 0.1, 3.6, -0.15, Math.PI / 2 - 0.05, 0.5, 0));
      mb.add(dark, T(new THREE.BoxGeometry(1.1, 0.03, 0.7), 0, 5.0, 0, -0.55, 0.4, 0));
      mb.add(plainStandard('#1c2b4a', 0.2, 0.6), T(new THREE.BoxGeometry(1.05, 0.01, 0.66), 0, 5.02, 0.0, -0.55, 0.4, 0));
      const led = glow('#3fa8ff', 6);
      this.relayLed = led.intensity as unknown as { value: number };
      mb.add(led.material, T(new THREE.SphereGeometry(0.02, 8, 6), 0.55 + Math.sin(0.3) * 0.2, 0.98, 0.3 + Math.cos(0.3) * 0.2));
      const near = mb.build('glimpse-relay');
      shadowProxy(near);
      const g = placed(new THREE.Group(), x, y, z, yaw);
      g.add(near);
      this.group.add(g);
      this.lods.push(new DistanceLod(V(x, y, z), 3, g, null, 170));
      ctx.physics.addCylinder(V(x, y + 2.7, z), 2.6, 0.1);
      ctx.physics.addBox(V(0.55, 0.62, 0.3).applyMatrix4(g.matrix), { x: 0.3, y: 0.42, z: 0.19 }, yaw + 0.3);
      this.spots.glimpserelay = V(0.9, 0, 1.6).applyMatrix4(g.matrix).setY(y);
      this.interactables.push({
        id: 'story.relay', pos: V(0.55, 0.9, 0.3).applyMatrix4(g.matrix), radius: 2.2,
        visible: () => !!this.s && !this.s.has('q.cam.cut') && !this.s.has('q.cam.loop') && !this.s.has('q.cam.hello'),
        primary: { label: 'Open the relay cabinet', available: () => true, run: () => this.atRelay() },
      });
    }

    // ---------------------------------------------------------------- Pip's pool, in chalk on the forecourt
    {
      // on the forecourt slab (its top is 0.2 m over the gas station's frame, like the fire), between
      // the logs and the pumps, square to the station
      const o = landmarks.campPoint(0, 0, 0);
      const ax = landmarks.campPoint(1, 0, 0).sub(o).normalize();
      const p = landmarks.campPoint(-3.6, 0, 7.6);
      const yaw = Math.atan2(ax.x, ax.z) + Math.PI / 2; // the lettering faces the logs
      const mb = new MeshBatch();
      mb.add(paper, T(loreQuad('chalkPool', 2.4, 1.2), 0, 0, 0, -Math.PI / 2, 0, 0));
      this.pool = mb.build('pip-pool', false, true);
      placed(this.pool, p.x, landmarks.campPosition.y + 0.008, p.z, yaw);
      this.pool.visible = false;
      this.group.add(this.pool);
      this.spots.pool = landmarks.campPoint(-3.6, 0, 4.6);

      // the routine seats (content/routines.ts, Landmarks.CAMP_SEATS): Hollis's watch crate and Ren's
      // lookout crate at the road edge of the slab, Pip's crate by her pool; a jerrycan by the watch,
      // a mug on the lookout's crate lid. Their tops are 0.62 over the frame, like the logs.
      const fy = Math.atan2(ax.x, ax.z) - Math.PI / 2; // camp space's yaw in the world
      const cb = new MeshBatch();
      const slats = wood('#8a6a44');
      for (const [key, [cx, cz, yaw]] of Object.entries(Landmarks.CAMP_SEATS)) {
        const w = landmarks.campPoint(cx, 0, cz);
        // the seat point is where the hips sit: the crate sits under it, a little behind
        const back = 0.08;
        const px = w.x - Math.sin(fy + yaw) * back, pz = w.z - Math.cos(fy + yaw) * back;
        const top = landmarks.campPosition.y;
        cb.add(slats, T(new THREE.BoxGeometry(0.5, 0.42, 0.44), px, top + 0.21, pz, 0, fy + yaw, 0));
        cb.add(dark, T(new THREE.BoxGeometry(0.52, 0.03, 0.46), px, top + 0.15, pz, 0, fy + yaw, 0));
        ctx.physics.addBox(V(px, top + 0.21, pz), { x: 0.25, y: 0.21, z: 0.22 }, fy + yaw);
        if (key === 'watch') {
          const j = V(px + Math.cos(fy + yaw) * 0.6, top, pz - Math.sin(fy + yaw) * 0.6);
          cb.add(plainStandard('#8a2a1e', 0.55, 0.3), T(new THREE.BoxGeometry(0.17, 0.34, 0.28), j.x, j.y + 0.17, j.z, 0, fy + yaw + 0.4, 0));
        }
      }
      const crates = cb.build('camp-routine-crates');
      shadowProxy(crates);
      this.group.add(crates);
      this.lods.push(new DistanceLod(landmarks.campPosition.clone(), 20, crates, null, 170));
    }
    this.keeps = this.keepsakes();
    this.endingProps(landmarks);
  }

  /**
   * Keepsakes at Dry Creek's street fire (the creek site's frame; town/creek.ts fireCircle): after
   * Still Here, a transistor radio on a crate by Sol's log; after Rider 9's delivery, the plate Nia
   * sets out for him every night on an upturned bucket by Ren's crate, under a cloth.
   */
  private keepsakes() {
    const lm = LANDMARKS.find((l) => l.id === 'creek')!;
    const hf = this.ctx.hf;
    const f = new Frame(lm.position[0], hf.heightAt(lm.position[0], lm.position[2]), lm.position[2], lm.rotation);
    const at = (x: number, z: number) => { const p = f.p(x, 0, z); p.y = hf.heightAt(p.x, p.z); return p; };
    const make = (name: string, x: number, z: number, yaw: number, build: (mb: MeshBatch) => void) => {
      const mb = new MeshBatch();
      build(mb);
      const g = mb.build(name);
      const p = at(x, z);
      placed(g, p.x, p.y, p.z, f.yaw + yaw);
      g.visible = false;
      const wrap = new THREE.Group();
      wrap.add(g);
      this.group.add(wrap);
      this.lods.push(new DistanceLod(p, 1, wrap, null, 140));
      return g;
    };
    const radio = make('rosa-radio', -2.95, 1.75, 0.6, (mb) => {
      mb.add(wood('#7a5a36'), T(new THREE.BoxGeometry(0.42, 0.34, 0.34), 0, 0.17, 0));
      mb.add(plainStandard('#3d6b8a', 0.5, 0.2), T(new THREE.BoxGeometry(0.26, 0.15, 0.08), 0, 0.42, 0));
      mb.add(rustyMetal({ base: '#6a6d70', rust: 0.45, metalness: 0.7 }), T(new THREE.BoxGeometry(0.15, 0.09, 0.006), -0.04, 0.42, 0.042));
      mb.add(plainStandard('#d8c9a0', 0.6), T(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 10), 0.08, 0.44, 0.042, Math.PI / 2, 0, 0)); // the dial
      mb.add(rustyMetal({ base: '#6a6d70', rust: 0.45, metalness: 0.7 }), rod(V(0.1, 0.5, -0.02), V(0.32, 0.92, -0.1), 0.004, 4));
      // the words Dez wrote, on the back of a Kade lanyard card, propped against it
      mb.add(plainStandard('#efe9da', 0.8), T(new THREE.BoxGeometry(0.09, 0.12, 0.004), -0.14, 0.4, 0.06, -0.25, 0.2, 0));
    });
    const plate = make('nine-plate', 2.35, 4.0, -0.4, (mb) => {
      mb.add(rustyMetal({ base: '#8a8f92', rust: 0.35, metalness: 0.6 }), T(new THREE.CylinderGeometry(0.15, 0.13, 0.36, 12), 0, 0.18, 0));
      mb.add(plainStandard('#e8e2d2', 0.4), T(new THREE.CylinderGeometry(0.13, 0.1, 0.02, 16), 0, 0.37, 0));
      mb.add(fabric('#b8402e', 0.9), T(new THREE.SphereGeometry(0.11, 12, 6, 0, Math.PI * 2, 0, 1.2).scale(1, 0.55, 1), 0, 0.375, 0));
      mb.add(plainStandard('#c9a24a', 0.5, 0.4), T(new THREE.BoxGeometry(0.012, 0.004, 0.13), 0.12, 0.382, 0.03, 0, 0.5, 0)); // a fork
    });
    return { radio, plate };
  }
  /**
   * Last Chance after the debrief, one thing per ending: read the names, and a bedsheet under the
   * canopy says so; take the deal, and Vesper's jugs stand by the pumps (nineteen; Ren counted);
   * keep the leverage, and her free-trial crate sits on the forecourt with its parachute.
   */
  private endingProps(landmarks: Landmarks) {
    const top = landmarks.campPosition.y; // the forecourt slab
    const o = landmarks.campPoint(0, 0, 0);
    const ax = landmarks.campPoint(1, 0, 0).sub(o).normalize();
    const fy = Math.atan2(ax.x, ax.z) - Math.PI / 2;
    const paper = loreMaterial();
    const make = (name: string, flag: string, x: number, z: number, yaw: number, build: (mb: MeshBatch) => void) => {
      const mb = new MeshBatch();
      build(mb);
      const g = mb.build(name);
      const w = landmarks.campPoint(x, 0, z);
      placed(g, w.x, top, w.z, fy + yaw);
      g.visible = false;
      const wrap = new THREE.Group();
      wrap.add(g);
      this.group.add(wrap);
      this.lods.push(new DistanceLod(new THREE.Vector3(w.x, top, w.z), 2, wrap, null, 170));
      this.flagged.push({ obj: g, flag });
    };
    // the banner: hung from the canopy's north fascia (z 6.1, its bottom edge 4.95 up), facing the logs
    make('names-banner', 'act1.broadcast', -1.2, 6.32, 0, (mb) => {
      mb.add(paper, T(loreQuad('namesBanner', 4.2, 1.3), 0, 4.2, 0, 0.04, 0, 0));
      const rope = plainStandard('#c9b48c', 0.9);
      for (const sx of [-2.05, 2.05]) mb.add(rope, rod(V(sx, 4.86, 0.0), V(sx * 1.02, 4.97, -0.12), 0.012, 4));
    });
    // nineteen jugs in a pyramid by the east pumps: ten, six, three
    make('kade-jugs', 'act1.deal', 4.7, 1.6, 0.2, (mb) => {
      const blue = plainStandard('#3f7fc0', 0.25, 0.05);
      const cap = plainStandard('#1d2733', 0.5);
      const rows: [number, number, number][] = [[5, 2, 0], [3, 2, 1], [3, 1, 2]];
      for (const [nx, nz, k] of rows) for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const x = (i - (nx - 1) / 2) * 0.3, z = (j - (nz - 1) / 2) * 0.3, y = 0.24 + k * 0.48;
        mb.add(blue, T(new THREE.CylinderGeometry(0.14, 0.14, 0.44, 10), x, y, z));
        mb.add(cap, T(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 8), x, y + 0.24, z));
        if (j === nz - 1) mb.add(paper, T(loreQuad('jugLabel', 0.18, 0.09), x, y, z + 0.141));
      }
    });
    // the free-trial drop: a white Kade crate, a slumped orange parachute, the cord across the slab
    make('free-trial', 'act1.leverage', 5.2, -3.2, -0.5, (mb) => {
      mb.add(plainStandard('#ecebe6', 0.5), T(new THREE.BoxGeometry(0.9, 0.62, 0.62), 0, 0.31, 0));
      mb.add(plainStandard('#c8302a', 0.5), T(new THREE.BoxGeometry(0.92, 0.08, 0.64), 0, 0.5, 0));
      mb.add(paper, T(loreQuad('freeTrial', 0.6, 0.3), 0, 0.28, 0.312));
      const chute = fabric('#e8742a', 0.9);
      mb.add(chute, T(rockGeometry(83, 2).scale(0.95, 0.16, 0.75), -1.35, 0.06, -0.5, 0, 0.4, 0.05), T(rockGeometry(84, 1).scale(0.45, 0.2, 0.4), -0.75, 0.1, -0.15, 0, 1.1, 0));
      mb.add(plainStandard('#c9b48c', 0.9), rod(V(-0.45, 0.6, 0), V(-1.0, 0.05, -0.3), 0.008, 4), rod(V(-0.45, 0.6, 0.1), V(-1.2, 0.04, 0.1), 0.008, 4));
    });
  }
  private flagged: { obj: THREE.Object3D; flag: string }[] = [];
  private radioLoop: SpotHandle | null = null;
  private keeps: { radio: THREE.Object3D; plate: THREE.Object3D } | null = null;
  private keepT = 0;

  private get s() { return this.ctx.state; }

  private toast(text: string, kind: 'info' | 'good' | 'bad' = 'info') {
    this.s.events.emit('toast', { text, kind });
  }

  // ------------------------------------------------------------------ Class of Tomorrow
  private async digCapsule() {
    const s = this.s;
    if (s.has('q.capsule.dug')) return;
    this.ctx.audio.play('thud', { pos: this.ctx.player.position, intensity: 0.3 });
    await this.ctx.ui.choose({
      speaker: 'Time capsule',
      text:
        'It isn\'t deep. Kade buried it to be found. A steel tube with a rocket decal, sealed with a Kade Holdings sticker. Inside: twenty-two envelopes in children\'s handwriting, a Kade Kids lanyard, ' +
        'and a letter on Kade letterhead. "To the children of 2046: by the time you read this, Dry Creek\'s aquifer will be fully monetised, and so, in a sense, will you. Congratulations on your Kade citizenship. Please recycle this capsule." ' +
        'One envelope says TO PIP OKAFOR, AGE 23. DO NOT OPEN UNTIL 2046.',
      choices: [{ id: 'ok', label: 'Take Pip\'s envelope. Leave the rest for 2046.' }],
    });
    if (!s.set('q.capsule.dug')) return;
    s.set('pip.capsule');
    s.addItem('pip_letter', 1, false, true);
    s.addXP(35, 'The time capsule');
    this.ctx.audio.play('pickup');
    this.capsuleShut.visible = false;
    this.capsuleOpen.visible = true;
    const peek = await this.ctx.ui.choose({
      speaker: 'Pip\'s envelope',
      text: 'The flap is only tucked in. Eleven-year-olds don\'t lick envelopes. It would be easy.',
      choices: [
        { id: 'read', label: 'Read it.' },
        { id: 'seal', label: 'Leave it sealed. It\'s hers.' },
      ],
    });
    if (peek === 'read' && s.set('q.capsule.read')) {
      await this.ctx.ui.choose({
        speaker: 'Pip\'s letter',
        text: '"Dear future me. I hope you have a pool. I hope Mara is still on the radio. I hope the creek comes back, because the man from Kade said it would come back better. If it didn\'t, I\'m sorry I believed him. I was eleven. Love, Pip. P.S. Count everything."',
        choices: [{ id: 'ok', label: 'Fold it back the way it was. It won\'t be.' }],
      });
    }
  }

  // ------------------------------------------------------------------ Seen
  private async lookCamera() {
    const s = this.s;
    await this.ctx.ui.choose({
      speaker: 'Camera on the pole',
      text:
        'GLIMPSE NEIGHBOURHOOD WATCH · UNIT 0414. A white box with a blue light, a solar panel the size of a tray, and a sticker: SMILE, YOU\'RE ALREADY TAGGED. ' +
        'The lens is on the forecourt: the pumps, the fire, the logs where everyone sits. Status light: UPLOADING. A little antenna points south-east, at a mast on the rise.',
      choices: [{ id: 'ok', label: 'Follow the antenna.' }],
    });
    if (!s.set('q.cam.seen')) return;
    s.set('hollis.camera');
    s.addXP(15, 'Glimpse unit 0414');
  }

  private async atRelay() {
    const s = this.s;
    if (s.has('q.cam.cut') || s.has('q.cam.loop') || s.has('q.cam.hello')) return;
    const elec = s.skill('electronics');
    const loopWhy = elec >= 2 ? undefined : s.count('battery') ? undefined : 'Requires Electronics 2, or a lithium cell to run Dez\'s trick off.';
    const pick = await this.ctx.ui.choose({
      speaker: 'Glimpse relay',
      text:
        'A white cabinet at the foot of the mast, unlocked, because who would come out here. Inside: a router with forty-one feeds on it. One is labelled LAST CHANCE (FORECOURT). ' +
        'The others are camps you\'ve heard on the radio. Viewers on the forecourt feed, right now: 1. There\'s a speaker grille, and a button marked TALK.',
      choices: [
        { id: 'cut', label: 'Pull the forecourt feed. Pull it hard.' },
        { id: 'loop', label: 'Loop ten minutes of an empty forecourt, forever.', disabled: loopWhy },
        { id: 'hello', label: 'Press TALK.' },
        { id: 'later', label: 'Not yet.' },
      ],
    });
    if (pick === 'cut' && s.set('q.cam.cut')) {
      this.ctx.audio.play('thud', { pos: this.ctx.player.position, intensity: 0.4 });
      s.addXP(30, 'Unplugged');
      this.toast('The forecourt feed goes black on the router. Back at camp, a blue light stops blinking.', 'good');
      this.applyCam();
    } else if (pick === 'loop' && !loopWhy && s.set('q.cam.loop')) {
      if (elec < 2) s.removeItem('battery', 1);
      this.ctx.audio.play('unlock', { pos: this.ctx.player.position });
      s.addXP(40, 'Looped');
      this.toast('Ten minutes of an empty forecourt at dusk, on repeat. Whoever watches is watching a picture now.', 'good');
      setTimeout(() => this.ctx.ui.subtitle('Dez Marlow · radio', 'Is that a loop? Did you loop them? I\'m coming up there with a lunchbox. That pole deserves a lunchbox.'), 1600);
      this.applyCam();
    } else if (pick === 'hello' && s.set('q.cam.hello')) {
      s.addXP(40, 'Said hello');
      this.ctx.audio.play('click', { pos: this.ctx.player.position });
      const EZRA: Record<string, { speaker: string; text: string; choices: { id: string; label: string; next?: string }[] }> = {
        e1: {
          speaker: 'Ezra Seymour · relay',
          text: 'Oh! Hi. Wow. Nobody ever talks to the relays. Hi! You\'re the one from the gas station. You drink one point four bottles a day and you favour your left foot. That\'s not creepy. That\'s care.',
          choices: [{ id: 'who', label: 'Who is this?', next: 'e2' }],
        },
        e2: {
          speaker: 'Ezra Seymour · relay',
          text: 'I\'m Ezra. Glimpse? The neighbourhood app? I\'m north of the salt now, in a place I call the Panopticon. Eleven hundred cameras. Every one of them is pointed at somebody I care about. Which is everybody. Which is the point.',
          choices: [{ id: 'stop', label: 'Stop watching the camp.', next: 'e3' }],
        },
        e3: {
          speaker: 'Ezra Seymour · relay',
          text: 'Don\'t come looking for me. I mean, you can. I\'ll know when you\'re close. I always know. Say hi to Hollis. He waves at the camera every morning. He thinks it\'s a sign. It kind of is.',
          choices: [{ id: 'bye', label: 'Let go of the button.' }],
        },
      };
      await this.ctx.ui.converse({ start: 'e1', node: (id) => EZRA[id] ?? null, onChoice: () => {} });
      this.applyCam();
    }
  }

  private applyCam() {
    const s = this.s;
    this.cutCable.visible = s.has('q.cam.cut');
    this.lunchbox.visible = s.has('q.cam.loop');
  }

  // ------------------------------------------------------------------ camp choices (Game.campTalk)
  /** Effects of the camp lines these favours add (content/camp.ts). */
  campChoice(choice: string) {
    const s = this.s;
    if (!s) return;
    if (choice === 'lifeboat.ask') s.set('dez.lifeboat');
    if ((choice === 'chat.air' || choice === 'chat.mara' || choice === 'chat.pip') && !s.has('q.chat.air') && !s.has('q.chat.mara') && !s.has('q.chat.pip')) {
      s.set(`q.${choice}`);
    }
    if (choice === 'school') s.set('pip.capsule');
    if ((choice === 'letter.sealed' || choice === 'letter.peeked' || choice === 'letter.mara') && s.has('q.capsule.dug')
      && !s.has('q.capsule.sealed') && !s.has('q.capsule.peeked') && !s.has('q.capsule.mara')) {
      if (choice === 'letter.sealed' && s.has('q.capsule.read')) return;
      s.removeItem('pip_letter', 1);
      s.set(`q.capsule.${choice.slice(7)}`);
      this.pool.visible = true;
    }
    if (choice === 'rumour') {
      // Dez's pick of the night: the pickup it points at goes on the map
      const r = rumourTonight({ has: (f) => s.has(f), count: (i) => s.count(i), rep: (p) => s.rep(p), name: s.archetype.name, rests: s.data.rests });
      const key = r?.intel ?? r?.op;
      if (key && s.set(`rumour.${key}`)) setTimeout(() => this.toast('Marked on your map: what the band was talking about.', 'info'), 400);
    }
    if (choice === 'song.hollis' && s.has('q.song.asked')) s.set('q.song.hollis');
    if (choice === 'song.dez' && s.has('q.song.hollis')) s.set('q.song.dez');
    if (choice === 'blink') s.set('hollis.camera');
    if (choice === 'cam.told' && (s.has('q.cam.cut') || s.has('q.cam.loop') || s.has('q.cam.hello'))) s.set('q.cam.told');
  }

  update(dt: number, cam: THREE.Vector3) {
    for (const l of this.lods) l.update(cam);
    const s = this.s;
    if (s && this.synced !== s) {
      // a new or loaded run: put the world back the way it was left
      this.synced = s;
      const dug = s.has('q.capsule.dug');
      this.capsuleShut.visible = !dug;
      this.capsuleOpen.visible = dug;
      this.pool.visible = s.favours().pipPool;
      this.applyCam();
    }
    if (s && !s.has('seen:capsule') && Math.hypot(cam.x - this.capsuleAt.x, cam.z - this.capsuleAt.z) < 22) s.set('seen:capsule');
    // keepsakes and the pool follow the flags (they change in conversation, mid-run)
    if (s && this.keeps && (this.keepT -= dt) <= 0) {
      this.keepT = 0.5;
      const radio = s.has('q.song.band') || s.has('q.song.quiet');
      if (this.keeps.radio.userData.on !== radio) { this.keeps.radio.userData.on = radio; this.keeps.radio.visible = radio; }
      // and you can hear it: the radio murmurs by Sol's log (a positional loop, built only when you're near)
      if (radio && !this.radioLoop) {
        this.radioLoop = this.ctx.audio.loop('radio', this.keeps.radio.position.clone().setY(this.keeps.radio.position.y + 0.45));
        this.radioLoop?.setGain(0.55);
      } else if (!radio && this.radioLoop) { this.radioLoop.stop(); this.radioLoop = null; }
      const plate = s.has('q.rider.delivered');
      if (this.keeps.plate.userData.on !== plate) { this.keeps.plate.userData.on = plate; this.keeps.plate.visible = plate; }
      if (s.favours().pipPool && !this.pool.visible) this.pool.visible = true;
      for (const f of this.flagged) { const on = s.has(f.flag); if (f.obj.visible !== on) f.obj.visible = on; }
    }
    this.t += dt;
    // the camera blinks blue while it uploads (dark once cut); the relay's light follows its feed
    const ph = this.t % 2.2;
    const watching = !s?.has('q.cam.cut');
    this.camLed.value = watching ? (ph < 0.12 ? 9 : 0.5) : 0;
    this.relayLed.value = watching ? ((this.t + 0.7) % 1.1 < 0.1 ? 9 : 0.8) : (this.t % 3 < 0.1 ? 4 : 0.1);
  }
}
