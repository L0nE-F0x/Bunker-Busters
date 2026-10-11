import * as THREE from 'three/webgpu';
import type { GameContext, Interactable } from '../../context';
import type { Landmarks } from '../../world/Landmarks';
import { MeshBatch, shadowProxy, box, cyl, beam, place } from '../../world/kit';
import { glow, plainStandard, rustyMetal, wood } from '../../world/materials';
import { LANDMARKS } from '@/content/world';

/**
 * What the Spire's choice leaves behind (Act IV):
 * - the core pulled: after the debrief it sits on a crate by the camp's pumps under a stop sign
 *   Hollis bolted up for shade, ticking, its window lit. Fill a bottle from it: two water a day.
 * - the valve opened: the standpipe at the top of Dry Creek runs, at the end of Benny's pipe. Two
 *   water a day, and a puddle in the dust that never quite dries.
 * Built at boot (hidden), shown by the flags.
 */
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export class SpireTaps {
  readonly group = new THREE.Group();
  readonly interactables: Interactable[] = [];
  private camp: THREE.Object3D;
  private creek: THREE.Object3D;
  private campGlow: { value: number };
  private t = 0;

  constructor(private ctx: GameContext, landmarks: Landmarks, place2: (x: number, z: number) => [number, number]) {
    this.group.name = 'spire-taps';
    landmarks.group.add(this.group);
    const hf = ctx.hf;
    const steel = plainStandard('#bfc4c8', 0.3, 0.85);
    const dark = plainStandard('#2b2826', 0.55, 0.2);
    const crateW = wood('#8a6a44');
    const sign = plainStandard('#b8231a', 0.6, 0.1);
    const post = rustyMetal({ base: '#8f918c', rust: 0.45, metalness: 0.6 });
    const g = glow('#39d8f0', 1.2);
    this.campGlow = g.intensity as unknown as { value: number };

    // ---------------------------------------------------------------- the camp: the core on a crate
    {
      const c = landmarks.campPosition;
      const [x, z] = place2(c.x + 4.5, c.z - 3.0);
      const y = hf.heightAt(x, z);
      const mb = new MeshBatch();
      mb.add(crateW, box(0.9, 0.55, 0.6, 0, 0.275, 0));
      mb.add(steel, box(0.62, 0.42, 0.38, 0, 0.76, 0), box(0.66, 0.05, 0.42, 0, 0.98, 0), box(0.66, 0.05, 0.42, 0, 0.55, 0));
      mb.add(g.material, box(0.4, 0.26, 0.01, 0, 0.77, -0.195));
      // Hollis's shade: a stop sign on a post, bolted at an angle over it
      mb.add(post, cyl(0.035, 0.035, 2.1, 0.55, 1.05, 0.25, 6));
      mb.add(sign, place(new THREE.CylinderGeometry(0.62, 0.62, 0.03, 8), 0.15, 2.0, 0.05, 0.35, Math.PI / 8, 0.25));
      // a hose to a jug, and a tin cup on the crate
      mb.add(dark, beam(V(0.25, 0.6, -0.1), V(0.7, 0.05, -0.5), 0.02, 5));
      mb.add(plainStandard('#d9d4c4', 0.4, 0.05), cyl(0.12, 0.12, 0.42, 0.75, 0.21, -0.55, 10));
      mb.add(steel, cyl(0.045, 0.04, 0.09, -0.32, 0.6, 0.18, 8));
      const near = mb.build('spire-core-camp');
      near.position.set(x, y, z);
      near.rotation.y = Math.atan2(c.x - x, c.z - z);
      shadowProxy(near);
      near.visible = false;
      this.camp = near;
      this.group.add(near);
      this.interactables.push(this.tap('spire-tap-camp', V(x, y + 0.9, z), 'Fill a bottle from the core', 'tap.camp',
        () => !!this.ctx.state?.has('act4.debriefed') && this.ctx.state.has('spire.core.pull'),
        'Cold water out of the night air, through a hose Pip found.'));
    }

    // ---------------------------------------------------------------- Dry Creek: the standpipe runs
    {
      // in the street in front of Nia's diner (Dry Creek's own frame), where she'll see it from the counter
      const lm = LANDMARKS.find((l) => l.id === 'creek')!;
      const town = ctx.scene.getObjectByName('dry-creek');
      if (town) town.updateWorldMatrix(true, false);
      const at = town ? town.localToWorld(V(-11, 0, 0.6)) : V(lm.position[0] - 10, 0, lm.position[2] + 4);
      const x = at.x, z = at.z, y = hf.heightAt(x, z);
      const yaw = town ? town.rotation.y : lm.rotation;
      const mb = new MeshBatch();
      mb.add(steel, cyl(0.07, 0.07, 1.1, 0, 0.55, 0, 10), beam(V(0, 1.0, 0), V(0.28, 1.0, 0), 0.035, 8), cyl(0.035, 0.035, 0.14, 0.3, 0.93, 0, 8));
      mb.add(plainStandard('#b8231a', 0.45, 0.4), place(new THREE.TorusGeometry(0.07, 0.012, 5, 12), 0.0, 1.12, 0, 0, 0, 0));
      // the pipe comes up out of the ground behind it: Benny's line, the last two metres of it
      mb.add(steel, beam(V(0, 0.1, 0), V(1.6, 0.1, -0.4), 0.08, 8), beam(V(1.6, 0.1, -0.4), V(2.1, -0.4, -0.5), 0.08, 8));
      mb.add(post, box(0.08, 0.2, 0.3, 1.0, 0.0, -0.25));
      // a bucket under the tap, and the wet ground round it
      mb.add(plainStandard('#7d8287', 0.4, 0.7), cyl(0.17, 0.14, 0.3, 0.3, 0.15, 0, 12));
      mb.add(plainStandard('#3e3226', 0.25, 0), place(new THREE.CircleGeometry(0.9, 18), 0.25, 0.012, 0.1, -Math.PI / 2, 0, 0, 1.2, 1, 0.8));
      mb.add(plainStandard('#5c88a0', 0.08, 0.2), place(new THREE.CircleGeometry(0.13, 14), 0.3, 0.27, 0, -Math.PI / 2));
      const near = mb.build('spire-standpipe');
      near.position.set(x, y, z);
      near.rotation.y = yaw;
      shadowProxy(near);
      near.visible = false;
      this.creek = near;
      this.group.add(near);
      this.interactables.push(this.tap('spire-tap-creek', V(x + 0.3, y + 1.0, z), 'Fill a bottle at the standpipe', 'tap.creek',
        () => !!this.ctx.state?.has('spire.core.valve'),
        'Water from the Spire, at the end of Benny\'s pipe. It tastes faintly of steel.'));
    }
  }

  /** Two water a day from a tap that `on()` says is running. */
  private tap(id: string, pos: THREE.Vector3, label: string, mark: string, on: () => boolean, first: string): Interactable {
    return {
      id, pos, radius: 1.8,
      visible: on,
      primary: {
        label,
        available: () => {
          const s = this.ctx.state;
          return (s.data.marks[mark] ?? -1) === (s.data.days ?? 0) ? 'Already filled up today' : true;
        },
        run: () => {
          const s = this.ctx.state;
          s.data.marks[mark] = s.data.days ?? 0;
          const n = s.addItem('water', 2, false, true);
          this.ctx.audio.play('pickup');
          const firstTime = s.set(`${mark}.first`);
          s.events.emit('toast', { text: firstTime ? `${first} +${n} water.` : `+${n} water. It'll fill again tomorrow.`, kind: 'good' });
        },
      },
    };
  }

  update(dt: number) {
    const s = this.ctx.state as GameContext['state'] | null;
    this.t += dt;
    this.camp.visible = !!s && s.has('act4.debriefed') && s.has('spire.core.pull');
    this.creek.visible = !!s && s.has('spire.core.valve');
    this.campGlow.value = 1.0 + Math.sin(this.t * 2.2) * 0.2;
  }
}
