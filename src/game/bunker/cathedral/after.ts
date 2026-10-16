import * as THREE from 'three/webgpu';
import type { GameContext, Interactable } from '../../context';
import type { Landmarks } from '../../world/Landmarks';
import type { NpcModels, NpcActor } from '../../world/npcSkin';
import { MeshBatch, shadowProxy, box, cyl, viewCull } from '../../world/kit';
import { plainStandard, wood } from '../../world/materials';
import { DROP, LO_CAMP } from '@/content/bunkers/cathedral';
import { ITEMS } from '@/content/items';

/**
 * What the Cathedral's ending leaves at the camp (Act VI):
 * - shut down: the associates walk out. Lo stays at Last Chance (on her feet by the pumps, the way she
 *   stood at her desk); the others went on to Waitlist City.
 * - transferred: the associates run it, and from the day after the debrief a Dropt drone leaves a
 *   parcel on a painted pad by the pumps every morning (two water, one ration).
 * Built at boot (hidden), shown by the flags.
 */
export class CathedralAfter {
  readonly group = new THREE.Group();
  readonly interactables: Interactable[] = [];
  private lo: NpcActor | null = null;
  private loAt = new THREE.Vector3();
  private pad: THREE.Object3D;
  private parcel: THREE.Object3D;
  private padAt = new THREE.Vector3();

  constructor(private ctx: GameContext, landmarks: Landmarks, models: NpcModels | null, place: (x: number, z: number) => [number, number]) {
    this.group.name = 'cathedral-after';
    landmarks.group.add(this.group);
    const hf = ctx.hf;
    const c = landmarks.campPosition;
    // Lo, a few steps from the pumps, facing the fire
    {
      const [x, z] = place(c.x + 3.6, c.z - 4.4);
      const y = hf.heightAt(x, z);
      this.loAt.set(x, y + 1.2, z);
      this.lo = models?.make('assoc', false, 0) ?? null;
      if (this.lo) {
        this.lo.root.position.set(x, y, z);
        this.lo.root.rotation.y = Math.atan2(c.x - x, c.z - z);
        this.lo.root.visible = false;
        this.group.add(this.lo.root);
      }
      this.interactables.push({
        id: 'cath-lo-camp', pos: this.loAt, radius: 2.0,
        visible: () => this.loOn(),
        primary: {
          label: 'Talk to Lo',
          available: () => true,
          run: () => {
            const s = this.ctx.state;
            if (s.set('camp.talk.lo')) s.addXP(20, 'Lo, off shift');
            const n = s.data.marks['lo.line'] ?? 0;
            s.data.marks['lo.line'] = n + 1;
            const line = LO_CAMP[n % LO_CAMP.length];
            this.ctx.ui.subtitle(line.speaker, line.text, { pos: this.loAt });
          },
        },
      });
    }
    // the drop pad: an orange-painted square on the ground, a parcel on it in the mornings
    {
      const [x, z] = place(c.x - 5.2, c.z + 2.8);
      const y = hf.heightAt(x, z);
      this.padAt.set(x, y + 0.6, z);
      const mb = new MeshBatch();
      mb.add(plainStandard('#d9601c', 0.85, 0), box(1.6, 0.02, 1.6, 0, 0.01, 0));
      mb.add(plainStandard('#efe9dc', 0.85, 0), box(1.0, 0.021, 0.12, 0, 0.012, 0), box(0.12, 0.021, 1.0, 0, 0.012, 0));
      mb.add(plainStandard('#7d8287', 0.5, 0.6), cyl(0.04, 0.04, 1.2, 0.85, 0.6, 0.85, 6));
      this.pad = mb.build('cath-droppad');
      this.pad.position.set(x, y, z);
      this.pad.visible = false;
      this.group.add(this.pad);
      const pb = new MeshBatch();
      pb.add(wood('#b08a5a'), box(0.5, 0.36, 0.42, 0.1, 0.2, 0));
      pb.add(plainStandard('#e8661e', 0.6, 0.05), box(0.51, 0.06, 0.43, 0.1, 0.3, 0), box(0.08, 0.37, 0.43, 0.1, 0.2, 0));
      this.parcel = pb.build('cath-parcel');
      this.parcel.position.set(x, y, z);
      this.parcel.visible = false;
      shadowProxy(this.parcel);
      this.group.add(this.parcel);
      this.interactables.push({
        id: 'cath-drop', pos: this.padAt, radius: 1.9,
        visible: () => this.dropOn() && !this.takenToday(),
        primary: {
          label: 'Open today\'s Dropt parcel',
          available: () => true,
          run: () => {
            const s = this.ctx.state;
            s.data.marks['tap.dropt'] = s.data.days ?? 0;
            const got = [{ id: 'water', qty: 2 }, { id: 'ration', qty: 1 }].map((it) => `+${s.addItem(it.id, it.qty, false, true)} ${ITEMS[it.id].name.toLowerCase()}`);
            this.ctx.audio.play('pickup');
            if (s.set('tap.dropt.first')) this.ctx.ui.subtitle(DROP.hello.speaker, DROP.hello.text, { pos: this.padAt });
            s.events.emit('toast', { text: `${got.join(', ')}. The label says ORDERED BY: THE ASSOCIATES.`, kind: 'good' });
          },
        },
      });
    }
  }

  private loOn() {
    const s = this.ctx.state as GameContext['state'] | null;
    return !!s && s.has('cathedral.assoc.gone');
  }

  private dropOn() {
    const s = this.ctx.state as GameContext['state'] | null;
    return !!s && s.has('cathedral.end.hand') && s.has('act6.debriefed');
  }

  private takenToday() {
    const s = this.ctx.state;
    return (s.data.marks['tap.dropt'] ?? -1) === (s.data.days ?? 0);
  }

  update(dt: number) {
    const on = this.loOn();
    if (this.lo) {
      this.lo.root.visible = on;
      if (on && viewCull.sees(this.loAt, 1.2)) this.lo.update(dt, this.ctx.player.position.distanceTo(this.loAt) < 3.5, 0, 0);
    }
    const drop = this.dropOn();
    this.pad.visible = drop;
    this.parcel.visible = drop && !this.takenToday();
  }
}
