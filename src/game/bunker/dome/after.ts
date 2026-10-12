import * as THREE from 'three/webgpu';
import type { GameContext, Interactable } from '../../context';
import type { Landmarks } from '../../world/Landmarks';
import type { NpcModels, NpcActor } from '../../world/npcSkin';
import { MeshBatch, shadowProxy, box, cyl, beam, place, viewCull } from '../../world/kit';
import { plainStandard, rustyMetal, wood } from '../../world/materials';
import { LANDMARKS } from '@/content/world';
import { DELIVERY, GIL_CREEK } from '@/content/bunkers/dome';
import { ITEMS } from '@/content/items';

/**
 * What the Dome's ending leaves behind (Act V):
 * - the plug pulled: the Dome's wells stop, and a day later Dry Creek's old well gives water again.
 *   Sol dug the hand pump out of the sand at the end of the street. Two water a day.
 * - the new job: an Ascend Helper stands by the camp's pumps every morning with the delivery (two
 *   water and a battery), after the debrief.
 * - Gil, if he walked out: on a crate in Dry Creek's street, by the pump or where it would be.
 * Built at boot (hidden), shown by the flags.
 */
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export class DomeAfter {
  readonly group = new THREE.Group();
  readonly interactables: Interactable[] = [];
  private pump: THREE.Object3D;
  private crate: THREE.Object3D;
  private helper: NpcActor | null = null;
  private helperAt = new THREE.Vector3();
  private gil: NpcActor | null = null;
  private gilAt = new THREE.Vector3();

  constructor(private ctx: GameContext, landmarks: Landmarks, models: NpcModels | null, place2: (x: number, z: number) => [number, number]) {
    this.group.name = 'dome-after';
    landmarks.group.add(this.group);
    const hf = ctx.hf;
    const iron = rustyMetal({ base: '#5d5a55', rust: 0.7, metalness: 0.6 });
    const crateW = wood('#8a6a44');
    const stone = plainStandard('#8f877a', 0.9, 0);

    // ---------------------------------------------------------------- Dry Creek: the old well's hand pump
    const lm = LANDMARKS.find((l) => l.id === 'creek')!;
    const town = ctx.scene.getObjectByName('dry-creek');
    if (town) town.updateWorldMatrix(true, false);
    const local = (x: number, z: number) => (town ? town.localToWorld(V(x, 0, z)) : V(lm.position[0] + x, 0, lm.position[2] + z));
    const yaw = town ? town.rotation.y : lm.rotation;
    {
      const at = local(-5.5, 1.2);
      const y = hf.heightAt(at.x, at.z);
      const mb = new MeshBatch();
      // a ring of stones round the old well head, a slab over it, the pump and its long handle
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        mb.add(stone, box(0.32, 0.36, 0.22, Math.sin(a) * 0.62, 0.18, Math.cos(a) * 0.62, a));
      }
      mb.add(stone, cyl(0.62, 0.62, 0.08, 0, 0.38, 0, 14));
      mb.add(iron, cyl(0.07, 0.09, 1.0, 0, 0.88, 0, 10), box(0.16, 0.18, 0.16, 0, 1.42, 0), beam(V(0, 1.2, 0), V(0.32, 1.12, 0), 0.03, 6));
      mb.add(iron, beam(V(0, 1.5, 0), V(-0.75, 1.75, 0), 0.025, 5));
      mb.add(plainStandard('#7d8287', 0.4, 0.7), cyl(0.17, 0.14, 0.3, 0.35, 0.57, 0, 12));
      mb.add(plainStandard('#3e3226', 0.25, 0), place(new THREE.CircleGeometry(0.9, 18), 0.6, 0.012, 0.1, -Math.PI / 2, 0, 0, 1.2, 1, 0.8));
      const near = mb.build('dome-well');
      near.position.set(at.x, y, at.z);
      near.rotation.y = yaw;
      shadowProxy(near);
      near.visible = false;
      this.pump = near;
      this.group.add(near);
      this.interactables.push(this.daily('dome-well', V(at.x, y + 1.0, at.z), 'Work the pump', 'tap.well', () => this.wellOn(),
        [{ id: 'water', qty: 2 }], 'Cold water, from forty metres down. It took a hundred strokes to come up the first time.'));
      // Gil's crate, a few steps away, facing the pump
      const c = local(-3.6, 2.4);
      const cy = hf.heightAt(c.x, c.z);
      const cb = new MeshBatch();
      cb.add(crateW, box(0.6, 0.45, 0.5, 0, 0.225, 0));
      const crate = cb.build('dome-gil-crate');
      crate.position.set(c.x, cy, c.z);
      crate.rotation.y = yaw;
      crate.visible = false;
      this.crate = crate;
      this.group.add(crate);
      this.gil = models?.make('gil', true, 0.45) ?? null;
      if (this.gil) {
        this.gil.root.position.set(c.x, cy + this.gil.root.position.y, c.z);
        this.gil.root.rotation.y = yaw - Math.PI / 2;
        this.gil.root.visible = false;
        this.group.add(this.gil.root);
      }
      this.gilAt.set(c.x, cy + 1.0, c.z);
      this.interactables.push({
        id: 'dome-gil-creek', pos: this.gilAt, radius: 2.0,
        visible: () => !!this.ctx.state?.has('dome.gil.free'),
        primary: {
          label: 'Talk to Gil',
          available: () => true,
          run: () => {
            const s = this.ctx.state;
            if (s.set('creek.talk.gil')) s.addXP(20, 'Gil, off call');
            const n = s.data.marks['gil.line'] ?? 0;
            s.data.marks['gil.line'] = n + 1;
            const line = GIL_CREEK[n % GIL_CREEK.length];
            this.ctx.ui.subtitle(line.speaker, line.text, { pos: this.gilAt });
          },
        },
      });
    }

    // ---------------------------------------------------------------- the camp: a Helper with the delivery
    {
      const c = landmarks.campPosition;
      const [x, z] = place2(c.x - 4.2, c.z - 3.4);
      const y = hf.heightAt(x, z);
      this.helperAt.set(x, y + 1.2, z);
      this.helper = models?.make('helper', false, 0) ?? null;
      const root = this.helper?.root ?? new THREE.Group();
      root.position.set(x, y, z);
      root.rotation.y = Math.atan2(c.x - x, c.z - z);
      root.visible = false;
      this.group.add(root);
      // its two jugs and a battery on a crate beside it
      const mb = new MeshBatch();
      mb.add(crateW, box(0.6, 0.4, 0.45, 0.7, 0.2, 0.2));
      mb.add(plainStandard('#d9d4c4', 0.4, 0.05), cyl(0.12, 0.12, 0.38, 0.55, 0.59, 0.2, 10), cyl(0.12, 0.12, 0.38, 0.85, 0.59, 0.2, 10));
      mb.add(plainStandard('#2b2d31', 0.5, 0.3), box(0.16, 0.1, 0.1, 0.7, 0.45, 0.0));
      const kit = mb.build('dome-delivery');
      kit.visible = false;
      root.add(kit);
      this.interactables.push(this.daily('dome-delivery', this.helperAt, 'Take today\'s delivery', 'tap.helper', () => this.deliveryOn(),
        [{ id: 'water', qty: 2 }, { id: 'battery', qty: 1 }], '', DELIVERY));
    }
  }

  private wellOn() {
    const s = this.ctx.state as GameContext['state'] | null;
    return !!s && s.has('dome.end.plug') && (s.data.days ?? 0) > (s.data.marks['dome.endDay'] ?? 1e9);
  }

  private deliveryOn() {
    const s = this.ctx.state as GameContext['state'] | null;
    return !!s && s.has('dome.end.job') && s.has('act5.debriefed');
  }

  /** Something you can take once a day while `on()` says so. */
  private daily(id: string, pos: THREE.Vector3, label: string, mark: string, on: () => boolean, items: { id: string; qty: number }[], first: string, say?: typeof DELIVERY): Interactable {
    return {
      id, pos, radius: 1.9,
      visible: on,
      primary: {
        label,
        available: () => {
          const s = this.ctx.state;
          return (s.data.marks[mark] ?? -1) === (s.data.days ?? 0) ? 'Already taken today' : true;
        },
        run: () => {
          const s = this.ctx.state;
          s.data.marks[mark] = s.data.days ?? 0;
          const got = items.map((it) => `+${s.addItem(it.id, it.qty, false, true)} ${ITEMS[it.id].name.toLowerCase()}`);
          this.ctx.audio.play('pickup');
          const firstTime = s.set(`${mark}.first`);
          if (say) this.ctx.ui.subtitle(say.hello.speaker, say.hello.text, { pos });
          else s.events.emit('toast', { text: firstTime ? `${first} ${got.join(', ')}.` : `${got.join(', ')}. More tomorrow.`, kind: 'good' });
        },
      },
    };
  }

  update(dt: number) {
    const s = this.ctx.state as GameContext['state'] | null;
    this.pump.visible = this.wellOn();
    const gilOut = !!s && s.has('dome.gil.free');
    this.crate.visible = gilOut;
    if (this.gil) {
      this.gil.root.visible = gilOut;
      if (gilOut && viewCull.sees(this.gilAt, 1.2)) this.gil.update(dt, this.ctx.player.position.distanceTo(this.gilAt) < 3.5, 0, 0);
    }
    const helperOn = this.deliveryOn();
    const root = this.helper?.root;
    if (root) {
      root.visible = helperOn;
      root.children.forEach((c) => { if (c.name === 'dome-delivery') c.visible = helperOn; });
      if (helperOn && viewCull.sees(this.helperAt, 1.2)) this.helper!.update(dt, false, 0, 0);
    }
  }
}
