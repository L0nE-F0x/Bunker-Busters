import * as THREE from 'three/webgpu';
import { MeshBatch } from './kit';
import { desertRock, fabric, plainStandard, rustyMetal, wood } from './materials';
import { rockGeometry } from './Props';
import type { Heightfield } from './Heightfield';
import type { GameState } from '@/game/State';
import type { Interactable } from '@/game/context';
import { ITEMS } from '@/content/items';
import { XP_REWARDS } from '@/content/progression';
import { AMMO_FOR, AMMO_HANDFUL, CACHES, CACHE_LOOT, RESTOCK_S, WRECK_LOOT, type CacheKind, type LootRoll } from '@/content/scavenge';

/**
 * Loot that isn't a quest: survivor stashes under a red rag on a stick, and the highway wrecks.
 * All the stash geometry across the map is one MeshBatch (a few draws); it's static, in the scene
 * from boot, so the shader warm-up covers it. Stashes refill after RESTOCK_S of play; wrecks don't.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: number | THREE.Vector3 = 1) =>
  g.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), typeof s === 'number' ? V(s, s, s) : s));

export interface ScavengeHost {
  hf: Heightfield;
  state: () => GameState | null;
  /** Flat, clear ground near (x, z). */
  place: (x: number, z: number) => [number, number];
  toast: (text: string, kind: 'good' | 'bad' | 'info') => void;
  sound: (name: 'pickup' | 'loot' | 'deny') => void;
}

export class Scavenge {
  readonly group: THREE.Group;
  readonly interactables: Interactable[] = [];

  constructor(private host: ScavengeHost, wrecks: { pos: THREE.Vector3; yaw: number; half: THREE.Vector3; upright: boolean }[]) {
    const mb = new MeshBatch();
    const M = {
      rock: desertRock(),
      stick: wood('#5c452e'),
      rag: fabric('#9e2a1e'),
      can: rustyMetal({ base: '#4a5233', rust: 0.45, metalness: 0.6 }),
      lockerWood: wood('#4f5a3a'),
      steel: rustyMetal({ base: '#6a6d70', rust: 0.5, metalness: 0.7 }),
      pack: fabric('#6a6446'),
      roll: fabric('#7a4a36'),
      kade: plainStandard('#3a3d42', 0.55, 0.05),
      kadeBand: plainStandard('#d8641e', 0.5),
      coolerBody: plainStandard('#d9d4c4', 0.6),
      coolerLid: plainStandard('#a8322a', 0.55),
    };

    for (const def of CACHES) {
      const [x, z] = host.place(def.at[0], def.at[1]);
      const y = host.hf.heightAt(x, z);
      const yaw = ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1) * Math.PI * 2;
      const place = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), V(1, 1, 1));
      this.stash({ add: (mat, g) => mb.add(mat, g.applyMatrix4(place)) }, M, def.kind, Math.abs(Math.floor(x * 31 + z * 17)));
      const key = `scav.${def.id}`;
      this.interactables.push({
        id: key,
        pos: V(x, y + 0.35, z),
        radius: 2.2,
        primary: {
          label: def.label,
          available: () => this.ready(key) ? true : 'Empty. Somebody tops these up; come back later.',
          run: () => this.open(key, CACHE_LOOT[def.kind], true),
        },
      });
    }

    // the wrecks: glovebox, footwell, trunk. Once each.
    wrecks.forEach((w, i) => {
      const key = `scav.wreck.${i}`;
      const reach = Math.max(w.half.x, w.half.z) + 1.4;
      this.interactables.push({
        id: key,
        pos: w.pos.clone().setY(host.hf.heightAt(w.pos.x, w.pos.z) + 0.8),
        radius: reach,
        primary: {
          label: w.upright ? 'Search the wreck' : 'Search the overturned wreck',
          available: () => (this.host.state()?.has(key) ? 'Picked clean.' : true),
          run: () => this.open(key, WRECK_LOOT, false),
        },
      });
    });

    this.group = mb.build('scavenge', true, true);
  }

  /** A stash at the origin, +Z toward the viewer: the cairn and rag stick, and the thing itself. */
  private stash(mb: { add(mat: THREE.Material, g: THREE.BufferGeometry): void }, M: Record<string, THREE.Material>, kind: CacheKind, seed: number) {
    // the sign: four stones and a stick with a strip of red cloth knotted at the top
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + seed;
      const s = 0.13 + (k % 2) * 0.05;
      mb.add(M.rock, at(rockGeometry(seed + k, 1), Math.cos(a) * 0.16 - 0.7, s * 0.6, Math.sin(a) * 0.16 - 0.25, 0, a, 0, s));
    }
    mb.add(M.rock, at(rockGeometry(seed + 9, 1), -0.7, 0.3, -0.25, 0, 0, 0, 0.11));
    mb.add(M.stick, at(new THREE.CylinderGeometry(0.018, 0.024, 1.5, 6), -0.7, 0.75, -0.25, 0, 0, 0.05));
    // the rag hangs and lifts a little, as if the wind just let go of it
    mb.add(M.rag, at(new THREE.BoxGeometry(0.07, 0.44, 0.012), -0.64, 1.3, -0.25, 0, 0.3, 0.42));
    mb.add(M.rag, at(new THREE.BoxGeometry(0.035, 0.24, 0.01), -0.72, 1.36, -0.22, 0, -0.5, -0.25));
    mb.add(M.rag, at(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 6), -0.69, 1.47, -0.25));

    if (kind === 'can') {
      // two .50-cal ammo cans by the cairn: one standing, one tipped on its side
      mb.add(M.can, at(new THREE.BoxGeometry(0.3, 0.19, 0.15), 0, 0.095, 0, 0, 0.3, 0));
      mb.add(M.can, at(new THREE.BoxGeometry(0.31, 0.025, 0.16), 0, 0.2, 0, 0, 0.3, 0));
      mb.add(M.steel, at(new THREE.TorusGeometry(0.045, 0.008, 4, 10, Math.PI), 0, 0.21, 0, 0, 0.3, 0));
      mb.add(M.can, at(new THREE.BoxGeometry(0.3, 0.15, 0.19), 0.12, 0.075, 0.3, 0, -0.5, 0));
      mb.add(M.can, at(new THREE.BoxGeometry(0.31, 0.16, 0.025), 0.12, 0.08, 0.2, 0, -0.5, 0));
      mb.add(M.rock, at(rockGeometry(seed + 21, 1), 0.28, 0.07, -0.16, 0, 0, 0, V(0.2, 0.1, 0.16)));
    } else if (kind === 'locker') {
      // an army footlocker, olive paint gone chalky, steel corners
      const w = 0.82, h = 0.38, d = 0.42;
      mb.add(M.lockerWood, at(new THREE.BoxGeometry(w, h, d), 0, h / 2, 0, 0, 0.12, 0));
      mb.add(M.lockerWood, at(new THREE.BoxGeometry(w + 0.02, 0.06, d + 0.02), 0, h - 0.02, 0, 0, 0.12, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const cx = (sx * w) / 2, cz = (sz * d) / 2;
        const rx = cx * Math.cos(0.12) + cz * Math.sin(0.12), rz = -cx * Math.sin(0.12) + cz * Math.cos(0.12);
        mb.add(M.steel, at(new THREE.BoxGeometry(0.05, h + 0.02, 0.05), rx, h / 2, rz, 0, 0.12, 0));
      }
      mb.add(M.steel, at(new THREE.BoxGeometry(0.08, 0.09, 0.02), 0.02, h - 0.08, d / 2 + 0.01, 0, 0.12, 0)); // hasp
    } else if (kind === 'pack') {
      // someone's pack against the cairn, bedroll strapped on, a hat dropped beside it
      mb.add(M.pack, at(new THREE.BoxGeometry(0.34, 0.48, 0.2), -0.45, 0.25, -0.12, -0.25, 0.4, 0));
      mb.add(M.pack, at(new THREE.BoxGeometry(0.3, 0.16, 0.08), -0.43, 0.2, -0.0, -0.25, 0.4, 0)); // front pocket
      mb.add(M.pack, at(new THREE.BoxGeometry(0.36, 0.08, 0.24), -0.47, 0.5, -0.16, -0.25, 0.4, 0)); // flap
      mb.add(M.roll, at(new THREE.CylinderGeometry(0.08, 0.08, 0.44, 10), -0.48, 0.58, -0.2, 0, 0.4, Math.PI / 2));
      mb.add(M.roll, at(new THREE.CylinderGeometry(0.15, 0.17, 0.08, 12), 0.1, 0.04, 0.18, 0.15, 0, 0.1)); // hat crown
      mb.add(M.roll, at(new THREE.CylinderGeometry(0.26, 0.26, 0.012, 14), 0.1, 0.012, 0.18, 0.15, 0, 0.1)); // brim
    } else if (kind === 'crate') {
      // a Kade field crate that fell off a truck: grey plastic, the orange band
      mb.add(M.kade, at(new THREE.BoxGeometry(0.72, 0.42, 0.48), 0, 0.21, 0, 0, -0.2, 0.04));
      mb.add(M.kadeBand, at(new THREE.BoxGeometry(0.735, 0.07, 0.495), 0, 0.3, 0, 0, -0.2, 0.04));
      mb.add(M.kade, at(new THREE.BoxGeometry(0.76, 0.04, 0.52), 0, 0.43, 0, 0, -0.2, 0.04));
      for (const sx of [-1, 1]) mb.add(M.steel, at(new THREE.BoxGeometry(0.03, 0.06, 0.1), sx * 0.37, 0.36, 0, 0, -0.2, 0.04)); // latches
    } else {
      // a cooler by the road, lid ajar
      mb.add(M.coolerBody, at(new THREE.BoxGeometry(0.6, 0.34, 0.36), 0, 0.17, 0, 0, 0.5, 0));
      mb.add(M.coolerLid, at(new THREE.BoxGeometry(0.62, 0.07, 0.38), 0, 0.37, -0.03, -0.12, 0.5, 0));
      mb.add(M.steel, at(new THREE.BoxGeometry(0.4, 0.02, 0.03), 0, 0.42, 0, 0, 0.5, 0));
    }
  }

  private seenT = 0;
  /** Twice a second: the first time a stash is in plain view, Mara explains the sign. */
  update(dt: number, player: THREE.Vector3) {
    if ((this.seenT -= dt) > 0) return;
    this.seenT = 0.5;
    const s = this.host.state();
    if (!s || s.has('seen:stash')) return;
    for (const it of this.interactables) {
      if (it.id.startsWith('scav.wreck')) continue;
      if (Math.hypot(it.pos.x - player.x, it.pos.z - player.z) < 30) { s.set('seen:stash'); return; }
    }
  }

  private ready(key: string) {
    const s = this.host.state();
    if (!s) return false;
    const last = s.data.marks[key];
    return last === undefined || s.data.stats.playTime - last >= RESTOCK_S;
  }

  private open(key: string, table: LootRoll[], restocks: boolean) {
    const s = this.host.state();
    if (!s) return;
    if (restocks ? !this.ready(key) : !s.set(key)) return;
    const first = restocks && s.data.marks[key] === undefined;
    if (restocks) s.data.marks[key] = s.data.stats.playTime;
    const got: string[] = [];
    let found = 0;
    for (const r of table) {
      // a refilled stash is leaner than the first find
      if (Math.random() > r.p * (first || !restocks ? 1 : 0.7)) continue;
      const id = r.id === 'ammo' ? this.calibre(s) : r.id;
      const [a, b] = r.id === 'ammo' ? AMMO_HANDFUL[id as keyof typeof AMMO_HANDFUL] : r.qty;
      found++;
      const n = s.addItem(id, a + Math.floor(Math.random() * (b - a + 1)));
      if (n) got.push(`${n}× ${ITEMS[id]?.name ?? id}`);
    }
    if (got.length) {
      this.host.sound('loot');
      this.host.toast(got.join(', '), 'good');
      if (first || !restocks) s.addXP(Math.round(XP_REWARDS.cache / 2), restocks ? 'Stash' : 'Scavenged');
    } else {
      this.host.sound('deny');
      this.host.toast(found ? 'Your pack is full. You leave it where it lies.' : 'Nothing worth taking.', 'bad');
      // full pack: the find stays put for when you've made room
      if (found) { if (restocks) delete s.data.marks[key]; else s.data.flags.splice(s.data.flags.indexOf(key), 1); }
    }
  }

  /** A calibre to find: guns you carry are three times as likely. */
  private calibre(s: GameState) {
    const ids = Object.keys(AMMO_HANDFUL) as (keyof typeof AMMO_HANDFUL)[];
    const w = ids.map((id) => (s.count(AMMO_FOR[id]) > 0 ? 3 : 1));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < ids.length; i++) if ((r -= w[i]) < 0) return ids[i];
    return ids[0];
  }
}
