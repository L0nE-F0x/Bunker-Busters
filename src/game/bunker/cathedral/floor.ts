import * as THREE from 'three/webgpu';
import type { Physics } from '@/engine/physics';
import { box, cyl } from '../../world/kit';
import { CT } from './CathedralBuilder';

type Collider = ReturnType<Physics['addBox']>;

/** What the floor asks of the Cathedral. */
export interface FloorHost {
  /** Drives route round the player (Lo's badge; the floor belongs to the associates). */
  badge(): boolean;
  /** 'moving', 'stop' (E-stop: everything freezes), 'off' (the site shut down: nothing moves). */
  mode(): 'moving' | 'stop' | 'off';
  /** A drive stopped for the player at `p` (world). */
  onObstruction(p: THREE.Vector3): void;
}

const MOVE = 2.0, MAX_MOVING = 7, POD = 1.5, _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

interface Pod {
  i: number; j: number;
  /** Moving: from (fi, fj) to (i, j), t 0..1. */
  fi: number; fj: number; t: number;
  moving: boolean;
  /** Stopped for the player (the lidar). */
  held: boolean;
  col: Collider;
  /** This pod's turn (a quarter, now and then, as they settle). */
  yaw: number;
}

/**
 * The floor: shelf pods on drive units over the nave's grid (10 × 12 cells of 2.4 m). A few move at a
 * time, one cell at a time, into empty neighbours. A drive that would run into the player stops (its
 * lidar) and reports an obstruction; with a badge, the drives never pick a cell near you. Everything
 * freezes on an E-stop. Two instanced draws (the pods, the drives' lights); one static collider per pod,
 * moved with it.
 */
export class Floor {
  readonly group = new THREE.Group();
  private pods: Pod[] = [];
  private grid: Int16Array;
  private mesh: THREE.InstancedMesh;
  private lights: THREE.InstancedMesh;
  private timer = 0;
  private dirty = true;
  private rand: () => number;

  constructor(physics: Physics, private origin: THREE.Vector3, private host: FloorHost, density = 0.56) {
    const { COLS, ROWS } = CT;
    this.grid = new Int16Array(COLS * ROWS).fill(-1);
    let s = 911;
    this.rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    // fill the grid, leaving the station cells on the west edge and a ragged lane or two clear
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      if (this.rand() > density) continue;
      const k = this.pods.length;
      const p = this.cellPos(i, j);
      const col = physics.addBox(_v.set(p.x, origin.y + 1.2, p.z), { x: POD / 2, y: 1.2, z: POD / 2 });
      this.pods.push({ i, j, fi: i, fj: j, t: 1, moving: false, held: false, col, yaw: Math.floor(this.rand() * 4) * (Math.PI / 2) });
      this.grid[j * COLS + i] = k;
    }
    const n = this.pods.length;
    this.mesh = new THREE.InstancedMesh(podGeometry(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.15 }), n);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.lights = new THREE.InstancedMesh(lightGeometry(), new THREE.MeshBasicNodeMaterial({ color: '#4ad2ff' }), n);
    this.lights.castShadow = false;
    for (const m of [this.mesh, this.lights]) {
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.group.name = 'cathFloor';
    this.write();
  }

  /** World position of a cell's centre (y: the floor). */
  cellPos(i: number, j: number, out = new THREE.Vector3()) {
    return out.set(this.origin.x + CT.GX0 + i * CT.CELL, this.origin.y, this.origin.z + CT.GZ0 + j * CT.CELL);
  }

  /** A pod's current world centre. */
  private podPos(p: Pod, out: THREE.Vector3) {
    const k = p.moving ? ease(p.t) : 1;
    out.set(
      this.origin.x + CT.GX0 + (p.fi + (p.i - p.fi) * k) * CT.CELL,
      this.origin.y,
      this.origin.z + CT.GZ0 + (p.fj + (p.j - p.fj) * k) * CT.CELL,
    );
    return out;
  }

  /** How many pods are on the grid, and how many are moving (tests). */
  census() {
    return { pods: this.pods.length, moving: this.pods.filter((p) => p.moving).length, held: this.pods.filter((p) => p.held).length };
  }

  update(dt: number, feet: THREE.Vector3, active: boolean) {
    const mode = this.host.mode();
    if (active && mode === 'moving') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 0.3 + this.rand() * 0.4;
        if (this.pods.filter((p) => p.moving).length < MAX_MOVING) this.startMove(feet);
      }
      const badge = this.host.badge();
      for (const p of this.pods) {
        if (!p.moving) continue;
        // the lidar: would the next step put the pod into the player? then hold (and report it once)
        const nt = Math.min(1, p.t + dt / MOVE);
        const k = ease(nt);
        const x = this.origin.x + CT.GX0 + (p.fi + (p.i - p.fi) * k) * CT.CELL;
        const z = this.origin.z + CT.GZ0 + (p.fj + (p.j - p.fj) * k) * CT.CELL;
        const block = Math.abs(feet.x - x) < POD / 2 + 0.45 && Math.abs(feet.z - z) < POD / 2 + 0.45 && Math.abs(feet.y - this.origin.y) < 2;
        if (block) {
          if (!p.held) {
            p.held = true;
            if (!badge) this.host.onObstruction(_v.set(x, this.origin.y, z).clone());
          }
          continue;
        }
        p.held = false;
        p.t = nt;
        if (p.t >= 1) { p.moving = false; this.grid[p.fj * CT.COLS + p.fi] = this.grid[p.fj * CT.COLS + p.fi] === this.pods.indexOf(p) ? -1 : this.grid[p.fj * CT.COLS + p.fi]; }
        this.podPos(p, _v);
        p.col.setTranslation({ x: _v.x, y: this.origin.y + 1.2, z: _v.z });
        this.dirty = true;
      }
    }
    if (this.dirty && active) this.write();
    this.group.visible = active;
  }

  /** Pick a pod and an empty neighbour (not near the player if badged; never the player's own cell). */
  private startMove(feet: THREE.Vector3) {
    const { COLS, ROWS } = CT;
    const badge = this.host.badge();
    for (let tries = 0; tries < 12; tries++) {
      const k = Math.floor(this.rand() * this.pods.length);
      const p = this.pods[k];
      if (p.moving) continue;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const [di, dj] = dirs[Math.floor(this.rand() * 4)];
      const ni = p.i + di, nj = p.j + dj;
      if (ni < 0 || nj < 0 || ni >= COLS || nj >= ROWS) continue;
      if (this.grid[nj * COLS + ni] !== -1) continue;
      const c = this.cellPos(ni, nj, _v);
      if (badge && Math.hypot(feet.x - c.x, feet.z - c.z) < CT.CELL * 1.4) continue;
      // claim both cells while it moves (the one it leaves frees when it arrives)
      this.grid[nj * COLS + ni] = k;
      p.fi = p.i; p.fj = p.j;
      p.i = ni; p.j = nj;
      p.t = 0;
      p.moving = true;
      p.held = false;
      return;
    }
  }

  private write() {
    this.pods.forEach((p, k) => {
      this.podPos(p, _v);
      _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw);
      this.mesh.setMatrixAt(k, _m.compose(_v, _q, _s));
      // the drive's light: blue when moving, amber when held
      this.lights.setMatrixAt(k, _m.compose(_v, _q, _s.set(p.moving ? 1 : 0.0001, 1, 1)));
      _s.set(1, 1, 1);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.lights.instanceMatrix.needsUpdate = true;
    this.dirty = false;
  }

  /** Is world (x, z) in a cell no pod occupies or is heading for? (tests) */
  freeAt(x: number, z: number) {
    const i = Math.round((x - this.origin.x - CT.GX0) / CT.CELL), j = Math.round((z - this.origin.z - CT.GZ0) / CT.CELL);
    if (i < 0 || j < 0 || i >= CT.COLS || j >= CT.ROWS) return true;
    return this.grid[j * CT.COLS + i] === -1;
  }
}

function ease(t: number) {
  return t * t * (3 - 2 * t);
}

function tint(g: THREE.BufferGeometry, c: string) {
  const col = new THREE.Color(c), n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]) {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nor.set(p.attributes.normal.array as Float32Array, o * 3);
    col.set(p.attributes.color.array as Float32Array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/** A shelf pod on its drive: an orange drive unit, a blue steel frame, four shelves of bins and cartons. */
function podGeometry() {
  const P: THREE.BufferGeometry[] = [];
  const h = POD / 2;
  P.push(tint(box(1.1, 0.28, 1.1, 0, 0.14, 0), '#e8661e'));
  P.push(tint(box(1.12, 0.04, 1.12, 0, 0.29, 0), '#2a2c30'));
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) P.push(tint(box(0.06, 2.1, 0.06, x * (h - 0.03), 1.4, z * (h - 0.03)), '#2f5d8a'));
  const bins = ['#2b6fb0', '#b08a5a', '#d9d4c4', '#e8661e', '#b08a5a', '#3c7f4a', '#b08a5a'];
  let r = 7;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 4; k++) {
    const y = 0.4 + k * 0.56;
    P.push(tint(box(POD, 0.04, POD, 0, y, 0), '#3a4048'));
    // bins along each face (the pod is four-sided: pickers work it from any side)
    for (let s = 0; s < 4; s++) {
      for (let q = 0; q < 3; q++) {
        const bh = 0.22 + rnd() * 0.22, off = -0.48 + q * 0.48;
        const g = box(0.42, bh, 0.34, off, y + 0.02 + bh / 2, h - 0.2);
        g.rotateY(s * Math.PI / 2);
        P.push(tint(g, bins[Math.floor(rnd() * bins.length)]));
      }
    }
  }
  P.push(tint(box(POD, 0.05, POD, 0, 2.47, 0), '#2f5d8a'));
  // fabric skirts on two faces (they flap on real pods)
  P.push(tint(box(POD - 0.1, 0.4, 0.02, 0, 2.25, h - 0.02), '#22262b'), tint(box(POD - 0.1, 0.4, 0.02, 0, 2.25, -h + 0.02), '#22262b'));
  return merge(P);
}

/** The drive's status light (front and back), scaled to nothing while it's parked. */
function lightGeometry() {
  return merge([tint(box(0.5, 0.03, 0.02, 0, 0.2, 0.56), '#4ad2ff'), tint(box(0.5, 0.03, 0.02, 0, 0.2, -0.56), '#4ad2ff'), tint(cyl(0.05, 0.05, 0.02, 0, 0.31, 0, 8), '#4ad2ff')]);
}
