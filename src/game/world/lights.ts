import * as THREE from 'three/webgpu';

/**
 * Point lights as data.
 *
 * Three.js evaluates every light in the scene for every lit fragment, so each real PointLight costs
 * the whole screen, even a bulb in a motel 300 m away. World code creates VirtualLights freely (same
 * fields as a PointLight: position, color, intensity, distance, decay). `lightPool` lends a fixed
 * handful of real PointLights to the ones that matter near the camera and fades between owners.
 * The real light count never changes, so materials never recompile when you walk between places.
 */
export class VirtualLight {
  readonly position = new THREE.Vector3();
  readonly color: THREE.Color;
  /** When set, `position` is local to this object (a fire inside a landmark group). */
  parent: THREE.Object3D | null = null;
  /** Selection bias: an EMP flash outranks a bulb. */
  priority = 1;
  /** World position as of the last pool update. */
  readonly world = new THREE.Vector3();

  constructor(color: THREE.ColorRepresentation, public intensity = 1, public distance = 10, public decay = 2) {
    this.color = new THREE.Color(color);
    lightPool.add(this);
  }

  dispose() {
    lightPool.remove(this);
  }
}

interface Slot {
  light: THREE.PointLight;
  owner: VirtualLight | null;
  fade: number;
}

class LightPool {
  private lights: VirtualLight[] = [];
  private slots: Slot[] = [];
  private wanted = new Set<VirtualLight>();
  private ranked: { v: VirtualLight; s: number }[] = [];

  add(v: VirtualLight) {
    this.lights.push(v);
  }

  remove(v: VirtualLight) {
    const i = this.lights.indexOf(v);
    if (i >= 0) this.lights.splice(i, 1);
    for (const s of this.slots) if (s.owner === v) s.owner = null;
  }

  /**
   * How much point light falls on `p` (fires, floodlights, bulbs, muzzle flashes), with the same
   * falloff three.js uses (inverse square, windowed to `distance`). No occlusion: a wall between you
   * and the fire doesn't count. Positions are as of the last `update`. Used by the stealth model.
   */
  illuminance(p: THREE.Vector3) {
    let e = 0;
    for (const v of this.lights) {
      if (v.intensity <= 1e-3) continue;
      const d2 = v.world.distanceToSquared(p);
      const r2 = v.distance * v.distance;
      if (d2 >= r2) continue;
      const w = 1 - (d2 * d2) / (r2 * r2);
      e += (v.intensity * w * w) / Math.max(d2, 1);
    }
    return e;
  }

  /** Real lights currently lent out (debug/bench). */
  get active() {
    return this.slots.filter((s) => s.owner).length;
  }

  /** Create `n` real lights under `scene`. Call once: changing the count recompiles every material. */
  attach(scene: THREE.Object3D, n: number) {
    for (let i = 0; i < n; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 1, 2);
      light.castShadow = false;
      scene.add(light);
      this.slots.push({ light, owner: null, fade: 0 });
    }
  }

  update(cam: THREE.Vector3, dt: number) {
    const n = this.slots.length;
    if (!n) return;
    // Importance ≈ brightness × how much of the view its lit patch covers. Owners get a margin so two
    // similar lights don't trade a slot back and forth every frame.
    this.ranked.length = 0;
    for (const v of this.lights) {
      if (v.intensity <= 1e-3) continue;
      v.world.copy(v.position);
      if (v.parent) v.world.applyMatrix4(v.parent.matrixWorld);
      const r = Math.max(1, v.distance);
      const d = v.world.distanceTo(cam);
      if (d > r + 260) continue;
      const k = r / Math.max(d, r);
      let s = v.intensity * v.priority * k * k;
      if (this.slots.some((sl) => sl.owner === v && sl.fade > 0.5)) s *= 1.3;
      this.ranked.push({ v, s });
    }
    this.ranked.sort((a, b) => b.s - a.s);
    this.wanted.clear();
    for (let i = 0; i < Math.min(n, this.ranked.length); i++) this.wanted.add(this.ranked[i].v);

    const step = Math.min(1, dt * 5);
    for (const sl of this.slots) {
      if (!sl.owner) continue;
      if (this.wanted.has(sl.owner)) sl.fade = Math.min(1, sl.fade + step);
      else if ((sl.fade -= step) <= 0) { sl.owner = null; sl.fade = 0; }
    }
    for (const v of this.wanted) {
      if (this.slots.some((sl) => sl.owner === v)) continue;
      const free = this.slots.find((sl) => !sl.owner);
      if (!free) break;
      free.owner = v;
      free.fade = 0;
    }
    for (const sl of this.slots) {
      const v = sl.owner;
      const l = sl.light;
      if (!v) { l.intensity = 0; continue; }
      l.position.copy(v.world);
      l.color.copy(v.color);
      l.distance = v.distance;
      l.decay = v.decay;
      // ease so a light arriving at a slot doesn't pop
      l.intensity = v.intensity * sl.fade * sl.fade * (3 - 2 * sl.fade);
    }
  }
}

export const lightPool = new LightPool();
