import * as THREE from 'three/webgpu';
import type { GameContext, Interactable } from '../context';
import type { Landmarks } from '../world/Landmarks';
import type { GameState } from '../State';
import { MeshBatch, DistanceLod, Frame, shadowProxy } from '../world/kit';
import { glow, plainStandard, rustyMetal, wood } from '../world/materials';
import { LANDMARKS } from '@/content/world';
import { OUTPOSTS } from '@/content/recovery';
import { STAKES } from '@/content/quests';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const T = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  g.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), V(1, 1, 1)));
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 5) {
  const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b), seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1)));
}

/** Where the Survey Says stakes go: on the line from the Survey Camp up toward the Cut (nudged to clear ground). */
const STAKE_AT: [number, number][] = [[4, 291], [18, 311], [26, 322]];

/**
 * The small props the road favours need away from their own sites (content/quests.ts):
 * - Badge Access: Dez's relay on the Spire's generator, hidden until you patch it in.
 * - Survey Says: three survey stakes on the slope below the Cut, and the field book on a folding
 *   table at the Kade Survey Camp.
 * Everything is in the scene from boot (hidden parts too), so the shader warm-up covers it; each
 * piece hides past ~160 m. Also handles the camp choices these favours add (Game.campTalk) and
 * Dez's patrol calls once he's on Kade's channel.
 */
export class Errands {
  readonly group = new THREE.Group();
  readonly interactables: Interactable[] = [];
  /** Feet positions for the harness. */
  readonly spots: Record<string, THREE.Vector3> = {};
  private lods: DistanceLod[] = [];
  private relay: THREE.Object3D;
  private led: { value: number };
  private book: THREE.Object3D;
  private stakes: THREE.Object3D[] = [];
  private t = 0;
  private synced: GameState | null = null;

  constructor(private ctx: GameContext, landmarks: Landmarks, place: (x: number, z: number) => [number, number]) {
    this.group.name = 'errands';
    landmarks.group.add(this.group);
    const hf = ctx.hf;
    const steel = rustyMetal({ base: '#6a6d70', rust: 0.45, metalness: 0.7 });
    const dark = plainStandard('#232527', 0.55, 0.2);
    const tape = plainStandard('#ff8a1c', 0.55);
    const lath = wood('#c9b48c');

    // ---------------------------------------------------------------- Dez's relay, on the Spire's generator
    {
      const lm = LANDMARKS.find((l) => l.id === 'spire')!;
      const f = new Frame(lm.position[0], hf.heightAt(lm.position[0], lm.position[2]), lm.position[2], lm.rotation);
      const mb = new MeshBatch();
      const lunch = plainStandard('#c23b2a', 0.5);
      const g = glow('#5dff9a', 0);
      this.led = g.intensity as unknown as { value: number };
      // a red lunchbox strapped to the generator's top, a whip antenna, a cable to the tower leg
      mb.add(lunch, T(new THREE.BoxGeometry(0.34, 0.2, 0.2), -2.65, 1.1, 3.05, 0, 0.3));
      mb.add(steel, T(new THREE.TorusGeometry(0.07, 0.01, 4, 10, Math.PI), -2.65, 1.2, 3.05, 0, 0.3));
      mb.add(dark, T(new THREE.BoxGeometry(0.36, 0.025, 0.05), -2.65, 1.02, 3.05, 0, 0.3)); // the strap
      mb.add(dark, rod(V(-2.55, 1.2, 3.05), V(-2.48, 2.45, 3.0), 0.006, 4));
      mb.add(dark, T(new THREE.SphereGeometry(0.018, 6, 4), -2.48, 2.46, 3.0));
      mb.add(g.material, T(new THREE.SphereGeometry(0.022, 8, 6), -2.74, 1.15, 3.15, 0, 0.3));
      const pts = [V(-2.5, 1.06, 2.98), V(-1.8, 0.2, 2.2), V(-0.8, 0.3, 1.2), V(-0.4, 1.6, 0.9)];
      mb.add(dark, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.012, 4));
      const near = mb.build('dez-relay');
      near.applyMatrix4(f.m);
      shadowProxy(near); // one depth draw (it follows the relay's own visibility)
      this.relay = near;
      near.visible = false;
      const wrap = new THREE.Group();
      wrap.add(near);
      this.group.add(wrap);
      this.lods.push(new DistanceLod(f.p(0, 0, 0), 4, wrap, null, 160));
      const at = f.p(-2.8, 1.0, 3.0);
      this.spots.relay = f.p(-2.8, 0, 4.4);
      this.interactables.push({
        id: 'errand.relay', pos: at, radius: 1.9,
        visible: () => !!this.s && this.s.count('dez_relay') > 0 && !this.s.has('q.dez.relay'),
        primary: { label: 'Patch in Dez\'s relay', available: () => true, run: () => this.patchRelay() },
      });
    }

    // ---------------------------------------------------------------- the field book at the Survey Camp
    {
      const op = OUTPOSTS.find((o) => o.id === 'survey')!;
      const f = new Frame(op.x, hf.heightAt(op.x, op.z), op.z, op.rot);
      const tx = 2.4, tz = 4.6, yaw = 0.35;
      const y = (lx: number, lz: number) => { const p = f.p(lx, 0, lz); return hf.heightAt(p.x, p.z) - f.y; };
      const gy = y(tx, tz);
      const mb = new MeshBatch();
      const top = plainStandard('#8e8a7c', 0.7);
      // a folding camp table: a slatted top on two X-frames
      mb.add(top, T(new THREE.BoxGeometry(0.9, 0.03, 0.6), tx, gy + 0.72, tz, 0, yaw));
      for (const s of [-1, 1]) for (const k of [-1, 1]) {
        const a = V(s * 0.4, 0, k * 0.26).applyAxisAngle(V(0, 1, 0), yaw).add(V(tx, gy, tz));
        const b = V(s * 0.4, 0, -k * 0.26).applyAxisAngle(V(0, 1, 0), yaw).add(V(tx, gy, tz));
        mb.add(steel, rod(V(a.x, a.y, a.z), V(b.x, b.y + 0.71, b.z), 0.012, 4));
      }
      // a thermos and a Kade mug: somebody left in a hurry, or for lunch
      mb.add(rustyMetal({ base: '#2f5f8a', rust: 0.2, metalness: 0.6 }), T(new THREE.CylinderGeometry(0.045, 0.045, 0.28, 10), tx - 0.3, gy + 0.875, tz + 0.05, 0, yaw));
      mb.add(plainStandard('#b02a22', 0.5), T(new THREE.CylinderGeometry(0.04, 0.035, 0.09, 10), tx + 0.28, gy + 0.78, tz - 0.12, 0, yaw));
      const near = mb.build('survey-table');
      near.applyMatrix4(f.m);
      const bk = new MeshBatch();
      // the field book: yellow weatherproof cover, a pencil across it
      bk.add(plainStandard('#e2ab1c', 0.65), T(new THREE.BoxGeometry(0.13, 0.02, 0.19), tx + 0.02, gy + 0.745, tz + 0.02, 0, yaw + 0.25));
      bk.add(plainStandard('#efe9da', 0.8), T(new THREE.BoxGeometry(0.122, 0.014, 0.18), tx + 0.025, gy + 0.745, tz + 0.02, 0, yaw + 0.25));
      bk.add(wood('#c99a3a'), T(new THREE.CylinderGeometry(0.005, 0.005, 0.17, 6).rotateZ(Math.PI / 2), tx + 0.03, gy + 0.76, tz + 0.03, 0, yaw - 0.4));
      this.book = bk.build('survey-book');
      this.book.applyMatrix4(f.m);
      // static sets: one depth draw each (the book's proxy goes when the book does)
      shadowProxy(near);
      shadowProxy(this.book);
      const wrap = new THREE.Group();
      wrap.add(near, this.book);
      this.group.add(wrap);
      this.lods.push(new DistanceLod(f.p(0, 0, 0), op.r, wrap, null, 160));
      const c = f.p(tx, gy + 0.36, tz);
      ctx.physics.addBox(c, { x: 0.45, y: 0.36, z: 0.3 }, f.yaw + yaw);
      this.spots.book = f.p(tx, 0, tz + 1.1).setY(hf.heightAt(c.x, c.z));
      this.interactables.push({
        id: 'errand.book', pos: f.p(tx, gy + 0.8, tz), radius: 1.6,
        visible: () => !this.s?.has('q.wick.book'),
        primary: { label: 'Take the field book', available: () => true, run: () => this.takeBook() },
      });
    }

    // ---------------------------------------------------------------- three survey stakes below the Cut
    STAKE_AT.forEach(([sx, sz], i) => {
      const [x, z] = place(sx, sz);
      const y0 = hf.heightAt(x, z);
      const yaw = i * 1.7 + 0.4;
      const lean = (i - 1) * 0.06;
      const mb = new MeshBatch();
      // a pale lath with a painted top, driven in at a lean, a hub stake beside it
      mb.add(lath, T(new THREE.BoxGeometry(0.05, 1.5, 0.02), 0, 0.68, 0, lean, 0, lean * 0.5));
      mb.add(plainStandard('#e6e1d6', 0.7), T(new THREE.BoxGeometry(0.052, 0.2, 0.022), 0, 1.33, 0, lean, 0, lean * 0.5));
      mb.add(lath, T(new THREE.BoxGeometry(0.05, 0.16, 0.05), 0.16, 0.04, 0.05, 0, 0.3));
      mb.add(tape, T(new THREE.BoxGeometry(0.056, 0.02, 0.056), 0.16, 0.12, 0.05, 0, 0.3));
      // flagging tape knotted under the top, two long tails lifting in the wind
      mb.add(tape, T(new THREE.BoxGeometry(0.058, 0.04, 0.026), 0, 1.2, 0, lean));
      mb.add(tape, T(new THREE.BoxGeometry(0.04, 0.62, 0.004), 0.2, 1.08, 0.02, 0.1, 0.2, 1.05));
      mb.add(tape, T(new THREE.BoxGeometry(0.04, 0.5, 0.004), 0.14, 1.02, -0.03, -0.15, -0.4, 0.75));
      // the tag: "KADE · SEEP ROUTE"
      mb.add(plainStandard('#b02a22', 0.5), T(new THREE.BoxGeometry(0.07, 0.05, 0.003), 0, 1.0, 0.012, lean));
      const stake = mb.build(`survey-stake-${i}`);
      shadowProxy(stake);
      stake.position.set(x, y0 - 0.05, z);
      stake.rotation.y = yaw;
      const wrap = new THREE.Group();
      wrap.add(stake);
      this.group.add(wrap);
      this.stakes.push(stake);
      this.lods.push(new DistanceLod(V(x, y0, z), 1, wrap, null, 160));
      this.spots[`stake${i}`] = V(x + 1.2, y0, z + 0.6);
      const flag = STAKES[i];
      this.interactables.push({
        id: `errand.stake.${i}`, pos: V(x, y0 + 0.7, z), radius: 1.7,
        visible: () => !this.s?.has(flag),
        primary: { label: 'Pull the survey stake', available: () => true, run: () => this.pullStake(i) },
      });
    });
  }

  private get s() { return this.ctx.state; }

  private toast(text: string, kind: 'info' | 'good' | 'bad' = 'info') {
    this.s.events.emit('toast', { text, kind });
  }

  // ------------------------------------------------------------------ the world half
  private patchRelay() {
    const s = this.s;
    if (s.has('q.dez.relay') || !s.removeItem('dez_relay', 1)) return;
    s.set('q.dez.relay');
    this.relay.visible = true;
    this.ctx.audio.play('unlock', { pos: this.ctx.player.position });
    s.addXP(30, 'Dez\'s relay');
    this.toast('Red to red. The lunchbox hums, and a green light starts counting.', 'good');
    setTimeout(() => this.ctx.ui.subtitle('Dez Marlow · radio', 'I\'ve got a carrier. Oh, I\'ve got so many carriers. Come back to the fire. Bring snacks.'), 1800);
  }

  private async takeBook() {
    const s = this.s;
    if (s.has('q.wick.book')) return;
    await this.ctx.ui.choose({
      speaker: 'Kade field book',
      text:
        'KADE HOLDINGS · SURVEY CAMP · RIDGE. Seep below the Cut: 0.4 L/hr, steady. Class: DATA ASSET. ' +
        'Resident: one (1), male, loud. Owns a view. Action: stake the route Friday, fence by Q3, rebrand as Kade Spring. ' +
        'Resident: offer relocation package (tote bag). Margin, in red: "V.K. wants depth readings, not flow. What\'s UNDER the ridge."',
      choices: [{ id: 'ok', label: 'Pocket the book.' }],
    });
    if (!s.set('q.wick.book')) return;
    this.book.visible = false;
    s.addItem('survey_book', 1, false, true);
    s.addXP(30, 'Field book');
    this.ctx.audio.play('pickup');
  }

  private pullStake(i: number) {
    const s = this.s;
    if (!s.set(STAKES[i])) return;
    this.stakes[i].visible = false;
    const left = STAKES.filter((f) => !s.has(f)).length;
    this.ctx.audio.play('pickup');
    s.addXP(10, 'Survey stake');
    this.toast(left ? `Stake pulled, tape and all. ${left} to go.` : 'Last stake. The ridge is unmeasured again.', 'good');
  }

  // ------------------------------------------------------------------ camp choices (Game.campTalk)
  /** Effects of the camp lines these favours add (content/camp.ts). */
  campChoice(choice: string) {
    const s = this.s;
    if (!s) return;
    if (choice === 'rider') s.set('hollis.rider');
    if ((choice === 'rider.truth' || choice === 'rider.west') && s.has('q.rider.log') && !s.has('q.rider.truth') && !s.has('q.rider.west')) {
      s.set(choice === 'rider.truth' ? 'q.rider.truth' : 'q.rider.west');
    }
    if (choice === 'dez.ask') s.set('dez.badges');
    if (choice === 'badges.give' && !s.has('q.dez.badges') && s.count('kade_badge') >= 3) {
      s.removeItem('kade_badge', 3);
      s.set('dez.badges');
      s.set('q.dez.badges');
      s.addItem('dez_relay', 1, false, true);
      s.addXP(20, 'Three lanyards');
      this.ctx.audio.play('uiConfirm');
    }
    if (choice === 'trade' && s.count('kade_badge') >= 3) {
      s.removeItem('kade_badge', 3);
      s.addItem('ration', 1, true);
      this.toast('Dez files three smiling faces in a shoebox and hands you a ration.', 'good');
    }
    if ((choice === 'dez.ears' || choice === 'dez.karaoke') && s.has('q.dez.relay') && !s.has('q.dez.ears') && !s.has('q.dez.karaoke')) {
      s.set(choice === 'dez.ears' ? 'q.dez.ears' : 'q.dez.karaoke');
    }
  }

  /** A Kade road pair just clocked in near you (Recovery.onPatrol). Dez calls it if he's listening. */
  patrol(at: THREE.Vector3, player: THREE.Vector3) {
    const s = this.s;
    if (!s || !s.favours().dezEars) return;
    const d = Math.round(Math.hypot(at.x - player.x, at.z - player.z) / 10) * 10;
    // map north is −z (see world.ts)
    const a = Math.atan2(at.x - player.x, -(at.z - player.z));
    const dir = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
    this.ctx.ui.subtitle('Dez Marlow · radio', Math.random() < 0.5
      ? 'Heads up. A Kade road pair just clocked in near you. They\'re walking your way.'
      : 'Crew channel says a pair is starting a shift on the highway by you. Mood: aligned. Get off the road.');
    setTimeout(() => this.toast(`Kade road patrol · about ${d} m ${dir}`, 'info'), 900);
  }

  update(dt: number, cam: THREE.Vector3) {
    for (const l of this.lods) l.update(cam);
    const s = this.s;
    if (s && this.synced !== s) {
      // a new or loaded run: put the world back the way it was left
      this.synced = s;
      this.relay.visible = s.has('q.dez.relay');
      this.book.visible = !s.has('q.wick.book');
      this.stakes.forEach((st, i) => { st.visible = !s.has(STAKES[i]); });
    }
    this.t += dt;
    // the relay's LED counts carriers: a quick double blink
    const ph = this.t % 1.4;
    this.led.value = this.relay.visible && (ph < 0.08 || (ph > 0.2 && ph < 0.28)) ? 14 : 1.2;
  }
}
