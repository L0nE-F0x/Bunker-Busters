import * as THREE from 'three/webgpu';
import type { GameContext, Interactable } from '../../context';
import type { Landmarks } from '../../world/Landmarks';
import { MeshBatch, shadowProxy, box, cyl, beam, place } from '../../world/kit';
import { plainStandard, rustyMetal } from '../../world/materials';
import { LANDMARKS } from '@/content/world';
import { RACK } from '@/content/bunkers/fortress';
import { ITEMS } from '@/content/items';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * What the Fortress's ending leaves behind (Act VII):
 * - the chillers off for good: the pumps under the range stop, and a day later the seep outside the
 *   Cut runs again: an old pipe in the rock over a stone basin. Two water a day.
 * - the table rewritten: the turbine's power comes to the camp. From the day after the debrief a
 *   battery rack by the fire charges two batteries a day.
 * Built at boot (hidden), shown by the flags.
 */
export class FortressAfter {
  readonly group = new THREE.Group();
  readonly interactables: Interactable[] = [];
  private seep: THREE.Object3D;
  private rack: THREE.Object3D;

  constructor(private ctx: GameContext, landmarks: Landmarks, place2: (x: number, z: number) => [number, number]) {
    this.group.name = 'fortress-after';
    landmarks.group.add(this.group);
    const hf = ctx.hf;
    const iron = rustyMetal({ base: '#5d5a55', rust: 0.7, metalness: 0.6 });
    const stone = plainStandard('#8f877a', 0.9, 0);
    const water = plainStandard('#3d6a72', 0.05, 0.3);
    // ---------------------------------------------------------------- the seep outside the Cut
    {
      const lm = LANDMARKS.find((l) => l.id === 'cave')!;
      const yaw = lm.rotation;
      const lx = 2.8, lz = -8.5;
      const x = lm.position[0] + lx * Math.cos(yaw) + lz * Math.sin(yaw), z = lm.position[2] - lx * Math.sin(yaw) + lz * Math.cos(yaw);
      const y = hf.heightAt(x, z);
      const mb = new MeshBatch();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        mb.add(stone, box(0.3, 0.32, 0.2, Math.sin(a) * 0.55, 0.16, Math.cos(a) * 0.55, a));
      }
      mb.add(water, place(new THREE.CircleGeometry(0.48, 16), 0, 0.26, 0, -Math.PI / 2));
      mb.add(iron, beam(V(0, 1.1, 0.9), V(0, 0.95, 0.35), 0.05, 8), cyl(0.04, 0.04, 0.9, 0, 0.62, 0.92, 6));
      mb.add(water, box(0.03, 0.7, 0.03, 0, 0.6, 0.33));
      const g = mb.build('fort-seep');
      g.position.set(x, y, z);
      g.rotation.y = yaw;
      g.visible = false;
      shadowProxy(g);
      this.seep = g;
      this.group.add(g);
      this.interactables.push(this.daily('fort-seep', V(x, y + 0.9, z), 'Fill up at the seep', 'tap.seep', () => this.seepOn(),
        [{ id: 'water', qty: 2 }], 'Water out of the rock, colder than anything in the valley. The pumps under the range have stopped pulling it away.'));
    }
    // ---------------------------------------------------------------- the battery rack at the camp
    {
      const c = landmarks.campPosition;
      const [x, z] = place2(c.x + 5.6, c.z + 2.0);
      const y = hf.heightAt(x, z);
      const mb = new MeshBatch();
      const frame = plainStandard('#3a3f45', 0.5, 0.5);
      mb.add(frame, box(1.4, 1.2, 0.5, 0, 0.6, 0));
      for (let i = 0; i < 4; i++) mb.add(plainStandard('#2b2d31', 0.5, 0.3), box(0.25, 0.3, 0.35, -0.48 + i * 0.32, 0.95, 0.05));
      mb.add(plainStandard('#5fe08a', 0.4, 0.1, { emissive: '#5fe08a', emissiveIntensity: 1.5 }), box(1.0, 0.04, 0.02, 0, 1.18, 0.26));
      mb.add(iron, beam(V(0.6, 0.2, -0.2), V(3.0, 0.05, -2.0), 0.03, 6));
      const g = mb.build('fort-rack');
      g.position.set(x, y, z);
      g.rotation.y = Math.atan2(c.x - x, c.z - z);
      g.visible = false;
      shadowProxy(g);
      this.rack = g;
      this.group.add(g);
      this.interactables.push(this.daily('fort-rack', V(x, y + 1.0, z), 'Take today\'s charged batteries', 'tap.rack', () => this.rackOn(),
        [{ id: 'battery', qty: 2 }], '', true));
    }
  }

  private seepOn() {
    const s = this.ctx.state as GameContext['state'] | null;
    return !!s && s.has('fortress.end.shut') && (s.data.days ?? 0) > (s.data.marks['fortress.endDay'] ?? 1e9);
  }

  private rackOn() {
    const s = this.ctx.state as GameContext['state'] | null;
    return !!s && s.has('fortress.end.realloc') && s.has('act7.debriefed');
  }

  /** Something you can take once a day while `on()` says so. */
  private daily(id: string, pos: THREE.Vector3, label: string, mark: string, on: () => boolean, items: { id: string; qty: number }[], first: string, rack = false): Interactable {
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
          if (rack && firstTime) this.ctx.ui.subtitle(RACK.hello.speaker, RACK.hello.text, { pos });
          s.events.emit('toast', { text: firstTime && first ? `${first} ${got.join(', ')}.` : `${got.join(', ')}. More tomorrow.`, kind: 'good' });
        },
      },
    };
  }

  update() {
    this.seep.visible = this.seepOn();
    this.rack.visible = this.rackOn();
  }
}
