import * as THREE from 'three/webgpu';
import type { Heightfield } from './Heightfield';
import type { Physics } from '@/engine/physics';
import { mulberry32 } from '@/engine/noise';
import { HIGHWAY, WORLD_SEED } from '@/content/world';
import { box, place, norm, MeshBatch } from './kit';
import { concrete, fabric, rustyMetal, plainStandard, wood } from './materials';
import { HITCH_SIGNS, artMap, artMaterial } from '../sites/placesArt';
import { paint, decal, atlasMap, atlasSolid, decalMat, F_DISPLAY, F_UI, weather } from '../sites/jetKit';

/**
 * Highway furniture: what a road keeps after the traffic stops. Leaning delineator posts with their
 * reflectors, guardrail where the shoulder drops away, the old signs (bullet-holed, a few knocked
 * flat), mile markers, shredded tyres, and black skid marks swerving off toward the wrecks.
 *
 * Every solid goes into the poles' MeshBatch (family materials merge with the poles' wood and
 * insulators: no new draws); printed faces use the shared site atlas (atlasSolid) and the skids the
 * site decal material, so the whole road adds two draws and no new shader programs.
 */

// ------------------------------------------------------------------ atlas art
const holes = (c: CanvasRenderingContext2D, w: number, h: number, r: () => number, n: number) => {
  for (let i = 0; i < n; i++) {
    const x = (0.15 + r() * 0.7) * w, y = (0.15 + r() * 0.7) * h, rad = 2 + r() * 3;
    c.fillStyle = 'rgba(120,70,40,0.55)';
    c.beginPath(); c.arc(x, y, rad * 2.2, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#141210';
    c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill();
  }
};
const plate = (c: CanvasRenderingContext2D, w: number, h: number, bg: string, fg: string, inset = 8) => {
  c.fillStyle = bg; c.fillRect(0, 0, w, h);
  c.strokeStyle = fg; c.lineWidth = 5; c.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
};
paint('rsServices', 384, 192, (c, w, h, r) => {
  plate(c, w, h, '#1f5a3a', '#e8efe6');
  c.font = `700 40px ${F_UI}`; c.fillText('NEXT SERVICES', w / 2, 58);
  c.font = `900 70px ${F_DISPLAY}`; c.fillText('212 MI', w / 2, 128);
  holes(c, w, h, r, 9); weather(c, w, h, 0.9, 41);
});
paint('rsLastChance', 384, 192, (c, w, h, r) => {
  plate(c, w, h, '#1f5a3a', '#e8efe6');
  c.font = `700 36px ${F_UI}`; c.fillText('LAST CHANCE GAS', w / 2, 56);
  c.font = `900 64px ${F_DISPLAY}`; c.fillText('1 MI  →', w / 2, 126);
  holes(c, w, h, r, 4); weather(c, w, h, 0.9, 42);
});
paint('rsSpeed', 160, 200, (c, w, h, r) => {
  plate(c, w, h, '#e6e2d8', '#141414', 7);
  c.font = `700 28px ${F_UI}`; c.fillText('SPEED', w / 2, 40); c.fillText('LIMIT', w / 2, 72);
  c.font = `900 84px ${F_DISPLAY}`; c.fillText('65', w / 2, 140);
  holes(c, w, h, r, 6); weather(c, w, h, 1.1, 43);
});
paint('rsCurve', 160, 160, (c, w, h, r) => {
  c.fillStyle = '#d9a52a'; c.fillRect(0, 0, w, h);
  c.strokeStyle = '#141414'; c.lineWidth = 6; c.strokeRect(9, 9, w - 18, h - 18);
  c.lineWidth = 14; c.lineCap = 'round';
  c.beginPath(); c.moveTo(w * 0.36, h * 0.8); c.bezierCurveTo(w * 0.36, h * 0.45, w * 0.64, h * 0.55, w * 0.64, h * 0.26); c.stroke();
  c.fillStyle = '#141414'; c.beginPath(); c.moveTo(w * 0.64, h * 0.14); c.lineTo(w * 0.76, h * 0.32); c.lineTo(w * 0.52, h * 0.32); c.fill();
  holes(c, w, h, r, 5); weather(c, w, h, 1.0, 44);
});
paint('rsKade', 320, 200, (c, w, h, r) => {
  plate(c, w, h, '#ece6d8', '#9e1f17', 7);
  c.fillStyle = '#9e1f17'; c.fillRect(7, 7, w - 14, 50);
  c.fillStyle = '#ece6d8'; c.font = `900 40px ${F_DISPLAY}`; c.fillText('KADE HOLDINGS', w / 2, 33);
  c.fillStyle = '#1a1a1a'; c.font = `700 26px ${F_UI}`;
  c.fillText('PRIVATE AQUIFER', w / 2, 92); c.fillText('NO TRESPASSING', w / 2, 126);
  c.font = `500 18px ${F_UI}`; c.fillText('VIOLATORS WILL BE RECOVERED', w / 2, 166);
  holes(c, w, h, r, 3); weather(c, w, h, 0.7, 45);
});
for (let i = 0; i < 3; i++) {
  paint('rsMile' + i, 64, 160, (c, w, h, r) => {
    plate(c, w, h, '#1f5a3a', '#e8efe6', 5);
    c.font = `700 18px ${F_UI}`; c.fillText('MILE', w / 2, 34);
    c.font = `900 46px ${F_DISPLAY}`; c.fillText(String(112 + i * 2).slice(0, 2), w / 2, 82); c.fillText(String(112 + i * 2).slice(2), w / 2, 124);
    weather(c, w, h, 1.1, 46 + i); void r;
  });
}
// a skid: two smeared rubber streaks fading in and out along u
paint('rsSkid', 512, 64, (c, w, h, r) => {
  for (let k = 0; k < 7; k++) {
    const y = h * (0.2 + r() * 0.6), a = 0.24 + r() * 0.22;
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(12,10,9,0)');
    g.addColorStop(0.1 + r() * 0.1, `rgba(12,10,9,${a})`);
    g.addColorStop(0.85, `rgba(12,10,9,${a * 0.8})`);
    g.addColorStop(1, 'rgba(12,10,9,0)');
    c.fillStyle = g;
    c.fillRect(0, y - 3 - r() * 4, w, 4 + r() * 8);
  }
});

// ------------------------------------------------------------------ placement
/** Place `g` at (x, y, z), turned `yaw` about the vertical, then pitched/rolled about its own axes. */
function orient(g: THREE.BufferGeometry, x: number, y: number, z: number, yaw: number, pitch = 0, roll = 0) {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), new THREE.Vector3(1, 1, 1)));
  return norm(g);
}

const curve = () => new THREE.CatmullRomCurve3(HIGHWAY.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'catmullrom', 0.1);

export interface Wreck { pos: THREE.Vector3; yaw: number; upright: boolean }

export function buildRoadside(hf: Heightfield, physics: Physics, b: MeshBatch, wrecks: Wreck[]) {
  const rand = mulberry32(WORLD_SEED + 31);
  const decals = new MeshBatch();
  const white = rustyMetal({ base: '#d9d4c6', rust: 0.35, metalness: 0.3, roughness: 0.6 });
  const galv = rustyMetal({ base: '#9c9e9a', rust: 0.45, metalness: 0.75, roughness: 0.45 });
  const post = wood('#5a4632');
  const amber = plainStandard('#c98a1e', 0.25, 0.5);
  const rubber = plainStandard('#141210', 0.9);
  const solid = atlasSolid();
  const c = curve();
  const L = c.getLength();
  const lim = hf.size * 0.43;
  const inside = (p: { x: number; z: number }) => Math.abs(p.x) < lim && Math.abs(p.z) < lim;
  const frame = (s: number) => {
    const t = Math.min(1, Math.max(0, s / L));
    const p = c.getPointAt(t), tan = c.getTangentAt(t);
    const side = new THREE.Vector3(-tan.z, 0, tan.x);
    return { p, tan, side, yaw: Math.atan2(tan.x, tan.z) };
  };
  const at = (s: number, off: number) => {
    const f = frame(s);
    const x = f.p.x + f.side.x * off, z = f.p.z + f.side.z * off;
    return { ...f, x, z, y: hf.heightAt(x, z) };
  };
  const clear = (x: number, z: number) => hf.zoneDistance(x, z) > 3;

  // delineators: a post every 48 m each side, reflector facing the traffic; some lean, some lie flat
  for (let s = 10; s < L; s += 48) {
    for (const sd of [-1, 1]) {
      const q = at(s + sd * 7, sd * 5.9);
      if (!inside(q) || !clear(q.x, q.z) || rand() < 0.22) continue;
      const down = rand() < 0.12;
      const lean = down ? Math.PI / 2 - 0.08 : (rand() - 0.5) * 0.35;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(q.x, q.y - (down ? -0.04 : 0.15), q.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, q.yaw + (rand() - 0.5) * 0.5, (rand() - 0.5) * 0.15, 'YXZ')),
        new THREE.Vector3(1, 1, 1),
      );
      b.add(white, box(0.1, 1.15, 0.06, 0, 0.58, 0).applyMatrix4(m));
      b.add(amber, box(0.075, 0.16, 0.012, 0, 0.98, 0.037 * -sd).applyMatrix4(m), box(0.075, 0.16, 0.012, 0, 0.98, 0.037 * sd).applyMatrix4(m));
    }
  }

  // guardrail where the ground falls away beside the road (the old embankments and cuts' rims)
  for (const sd of [-1, 1]) {
    let run: { x: number; y: number; z: number; yaw: number }[] = [];
    const flush = () => {
      if (run.length >= 4) {
        const broken = rand() < 0.5 ? Math.floor(run.length * (0.3 + rand() * 0.4)) : -1;
        for (let i = 0; i < run.length; i++) {
          const a = run[i];
          b.add(post, box(0.16, 1.0, 0.14, a.x, a.y + 0.3, a.z, a.yaw));
          if (i === 0 || i === broken) continue;
          const p0 = run[i - 1];
          const len = Math.hypot(a.x - p0.x, a.z - p0.z);
          const yaw = Math.atan2(a.x - p0.x, a.z - p0.z), pitch = Math.atan2(a.y - p0.y, len);
          const sag = i === broken + 1 ? 0.35 : 0;
          const mx = (a.x + p0.x) / 2, mz = (a.z + p0.z) / 2, my = (a.y + p0.y) / 2 + 0.62 - sag;
          b.add(galv, orient(new THREE.BoxGeometry(0.05, 0.32, len + 0.08), mx, my, mz, yaw, -pitch, sag * 0.6));
          b.add(galv, orient(new THREE.BoxGeometry(0.09, 0.07, len + 0.08), mx + Math.cos(yaw) * 0.04 * sd, my, mz - Math.sin(yaw) * 0.04 * sd, yaw, -pitch));
          physics.addBox({ x: mx, y: my - 0.1, z: mz }, { x: 0.06, y: 0.45, z: len / 2 }, yaw);
        }
      }
      run = [];
    };
    for (let s = 0; s < L; s += 4) {
      const q = at(s, sd * 5.2);
      const out = at(s, sd * 11);
      const road = hf.heightAt(frame(s).p.x, frame(s).p.z);
      if (inside(q) && clear(q.x, q.z) && road - out.y > 1.6) run.push({ x: q.x, y: q.y, z: q.z, yaw: q.yaw });
      else flush();
    }
    flush();
  }

  // signs: [near world x, z, side, kind]; each goes on the nearest stretch of road, post-mounted,
  // facing its traffic; a couple are knocked down
  const nearest = (x: number, z: number) => {
    let best = 0, bd = 1e18;
    for (let s = 0; s < L; s += 4) { const p = frame(s).p; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
    return best;
  };
  const signs: [number, number, number, string][] = [
    [-310, 62, 1, 'rsServices'], [-232, 92, -1, 'rsSpeed'], [-62, 118, 1, 'rsCurve'], [-24, 106, -1, 'rsLastChance'],
    [150, 10, -1, 'rsCurve'], [122, 34, -1, 'rsKade'], [250, -76, 1, 'rsSpeed'], [312, -112, -1, 'rsServices'],
  ];
  const size: Record<string, [number, number, number]> = {
    rsServices: [2.4, 1.2, 2.2], rsLastChance: [2.4, 1.2, 2.2], rsSpeed: [0.75, 0.95, 2.1], rsCurve: [0.85, 0.85, 2.2], rsKade: [1.6, 1.0, 1.4],
  };
  for (const [sx, sz, sd, name] of signs) {
    const q = at(nearest(sx, sz), sd * 6.6);
    if (!inside(q) || !clear(q.x, q.z)) continue;
    const [w, h, lift] = size[name];
    const down = rand() < 0.18;
    // faces the oncoming lane (traffic drives on the right)
    const face = q.yaw + (sd > 0 ? Math.PI : 0);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(q.x, q.y - 0.1, q.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(down ? -Math.PI / 2 + 0.12 : (rand() - 0.5) * 0.1, face + (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.08, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    const posts = w > 1.5 ? [-w * 0.32, w * 0.32] : [0];
    for (const px of posts) b.add(galv, box(0.08, lift + h * 0.5, 0.08, px, (lift + h * 0.5) / 2, -0.06).applyMatrix4(m));
    if (name === 'rsCurve') {
      const g = atlasMap(name, new THREE.BoxGeometry(w, h, 0.03));
      b.add(solid, place(g, 0, lift + h * 0.4, 0, 0, 0, Math.PI / 4).applyMatrix4(m));
    } else {
      b.add(galv, box(w + 0.04, h + 0.04, 0.025, 0, lift + h / 2, -0.03).applyMatrix4(m));
      b.add(solid, decal(name, w, h, new THREE.Matrix4().makeTranslation(0, lift + h / 2, -0.012)).applyMatrix4(m));
    }
  }

  // mile markers: a little green plate on a stake every ~200 m on the right
  for (let s = 60, i = 0; s < L; s += 205, i++) {
    const q = at(s, 6.2);
    if (!inside(q) || !clear(q.x, q.z) || rand() < 0.3) continue;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(q.x, q.y - 0.1, q.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 0.2, q.yaw + Math.PI, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
    b.add(galv, box(0.05, 1.2, 0.05, 0, 0.6, -0.03).applyMatrix4(m));
    b.add(solid, decal('rsMile' + (i % 3), 0.26, 0.65, new THREE.Matrix4().makeTranslation(0, 0.95, 0)).applyMatrix4(m));
  }

  // shredded truck tyres along the shoulders, a few whole ones
  for (let s = 30; s < L; s += 34 + rand() * 40) {
    const sd = rand() < 0.5 ? -1 : 1;
    const q = at(s, sd * (3 + rand() * 4));
    if (!inside(q) || !clear(q.x, q.z)) continue;
    const yaw = rand() * Math.PI * 2;
    if (rand() < 0.15) {
      b.add(rubber, orient(new THREE.TorusGeometry(0.36, 0.13, 6, 16), q.x, q.y + 0.1, q.z, yaw, Math.PI / 2 + (rand() - 0.5) * 0.2));
      continue;
    }
    // a curled strip of tread: part of a flattened torus, two or three per spot
    for (let k = 0; k < 1 + Math.floor(rand() * 3); k++) {
      const arc = 0.8 + rand() * 1.6, R = 0.4 + rand() * 0.5;
      const g = new THREE.TorusGeometry(R, 0.09, 3, 10, arc);
      g.scale(1, 1, 0.3); // a flat ribbon of tread once laid down
      b.add(rubber, orient(g, q.x + (rand() - 0.5) * 1.5, q.y + 0.02, q.z + (rand() - 0.5) * 1.5, yaw + k * 1.3, Math.PI / 2));
    }
  }

  // skids: the last thing some of these cars did was brake hard and leave the road
  const sk = (x0: number, z0: number, x1: number, z1: number, x2: number, z2: number) => {
    const qc = new THREE.QuadraticBezierCurve(new THREE.Vector2(x0, z0), new THREE.Vector2(x1, z1), new THREE.Vector2(x2, z2));
    const n = Math.max(3, Math.round(qc.getLength() / 3));
    const pts = qc.getSpacedPoints(n);
    for (const off of [-0.8, 0.8]) {
      for (let i = 0; i < n; i++) {
        const a = pts[i], bb = pts[i + 1];
        const dx = bb.x - a.x, dz = bb.y - a.y, len = Math.hypot(dx, dz);
        const nx = -dz / len, nz = dx / len;
        const x = (a.x + bb.x) / 2 + nx * off, z = (a.y + bb.y) / 2 + nz * off;
        const m = new THREE.Matrix4().makeTranslation(x, hf.heightAt(x, z) + 0.03, z)
          .multiply(new THREE.Matrix4().makeRotationY(Math.atan2(dx, dz) - Math.PI / 2))
          .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        decals.add(decalMat(), decal('rsSkid', len + 0.4, 0.3, m));
      }
    }
  };
  let skids = 0;
  for (const w of wrecks) {
    if (skids >= 6) break;
    const near = hf.roadDistanceAt(w.pos.x, w.pos.z);
    if (near > 9 || !w.upright || !inside(w.pos)) continue;
    // run back along the road from the wreck, swerving in
    let best = 0, bd = 1e9;
    for (let s = 0; s < L; s += 6) { const p = frame(s).p; const d = (p.x - w.pos.x) ** 2 + (p.z - w.pos.z) ** 2; if (d < bd) { bd = d; best = s; } }
    const dir = rand() < 0.5 ? -1 : 1;
    const f0 = at(best - dir * 34, (rand() - 0.5) * 3), f1 = at(best - dir * 14, (rand() - 0.5) * 2);
    sk(f0.x, f0.z, f1.x, f1.z, w.pos.x, w.pos.z);
    skids++;
  }
  leftovers(hf, physics, b, { rand, at, nearest, inside, clear });
  return decals.build('skids', false, true);
}

/**
 * What the evacuation left on the road (2026-10-10): two Kade checkpoints (jersey barriers in a
 * chicane, cones, a booth, a boom across one lane, a sign), luggage trails on the shoulders where
 * people gave up carrying things, hitchhikers' cardboard signs, and Kade's survey stakes pricing
 * the road. All family materials into the poles' batch (no new draws); the printed signs use the
 * places atlas (one draw for all of them).
 */
function leftovers(hf: Heightfield, physics: Physics, b: MeshBatch, k: {
  rand: () => number;
  at: (s: number, off: number) => { x: number; y: number; z: number; yaw: number; side: THREE.Vector3; tan: THREE.Vector3 };
  nearest: (x: number, z: number) => number;
  inside: (p: { x: number; z: number }) => boolean;
  clear: (x: number, z: number) => boolean;
}) {
  const { rand, at, nearest, inside, clear } = k;
  const M = {
    barrier: concrete('#aaa397', { scale: 1.4, stains: 0.8 }),
    cone: plainStandard('#e0601c', 0.6),
    coneBand: plainStandard('#e8e4da', 0.5),
    booth: rustyMetal({ base: '#3a3d42', rust: 0.4, metalness: 0.5, roughness: 0.55 }),
    glass: plainStandard('#20282c', 0.15, 0.5),
    boom: plainStandard('#d8641e', 0.5),
    boomW: plainStandard('#e8e4da', 0.5),
    caseA: plainStandard('#2c3a52', 0.55), caseB: plainStandard('#7a2e28', 0.55), caseC: plainStandard('#3c3c3e', 0.5),
    duffel: fabric('#4a5a3a'), cloth: fabric('#b8ae98'), clothB: fabric('#5a3a5a'),
    card: plainStandard('#a67c52', 0.92),
    stake: wood('#8a6a44'),
    flag: plainStandard('#ff6a1a', 0.6),
    steel: rustyMetal({ base: '#9c9e9a', rust: 0.45, metalness: 0.75, roughness: 0.45 }),
  };
  const art = artMaterial();
  const T = (g: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0) =>
    norm(g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), new THREE.Vector3(1, 1, 1))));
  // the jersey barrier profile, extruded along its length (z)
  const jersey = (() => {
    const s = new THREE.Shape();
    s.moveTo(-0.3, 0); s.lineTo(0.3, 0); s.lineTo(0.3, 0.08); s.lineTo(0.1, 0.33); s.lineTo(0.075, 0.81);
    s.lineTo(-0.075, 0.81); s.lineTo(-0.1, 0.33); s.lineTo(-0.3, 0.08); s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 3.0, bevelEnabled: false }).translate(0, 0, -1.5);
  })();
  const cone = (x: number, z: number, down: boolean) => {
    const y = hf.heightAt(x, z), yaw = rand() * 6;
    const pitch = down ? Math.PI / 2 - 0.25 : 0;
    const lift = down ? 0.16 : 0;
    b.add(M.cone, T(new THREE.ConeGeometry(0.16, 0.7, 10, 1, true).translate(0, 0.35, 0), x, y + lift, z, yaw, pitch));
    b.add(M.coneBand, T(new THREE.CylinderGeometry(0.075, 0.1, 0.12, 10, 1, true).translate(0, 0.42, 0), x, y + lift, z, yaw, pitch));
    b.add(M.cone, T(new THREE.BoxGeometry(0.42, 0.04, 0.42).translate(0, 0.02, 0), x, y + (down ? 0.2 : 0), z, yaw, pitch));
  };
  const sign = (name: string, w: number, h: number, x: number, z: number, yaw: number, lift: number, tilt = 0) => {
    const y = hf.heightAt(x, z);
    for (const px of [-w * 0.35, w * 0.35]) b.add(M.steel, T(new THREE.BoxGeometry(0.07, lift + h * 0.5, 0.07).translate(px, (lift + h * 0.5) / 2, -0.05), x, y - 0.1, z, yaw, tilt));
    b.add(M.steel, T(new THREE.BoxGeometry(w + 0.04, h + 0.04, 0.025).translate(0, lift + h / 2, -0.025), x, y - 0.1, z, yaw, tilt));
    b.add(art, norm(artMap(name, new THREE.PlaneGeometry(w, h)).translate(0, lift + h / 2, -0.01).applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.1, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, 0, 'YXZ')), new THREE.Vector3(1, 1, 1)))));
  };

  // ---- checkpoints: a chicane of barriers across both lanes, a booth, a boom, cones, the sign
  for (const [cx, cz] of [[178, -14], [-248, 96]] as [number, number][]) {
    const s0 = nearest(cx, cz);
    const c0 = at(s0, 0);
    if (!inside(c0)) continue;
    // stagger: two barriers from each side, offset along the road, one shoved askew
    const rows: [number, number, number][] = [[-6, -2.6, 0], [-6, -5.6, 0], [6, 2.6, 0], [6, 5.6, 0.25], [0, -8.4, 0.5]];
    for (const [ds, off, skew] of rows) {
      const q = at(s0 + ds, off);
      const yaw = q.yaw + Math.PI / 2 + skew + (rand() - 0.5) * 0.1;
      b.add(M.barrier, T(jersey.clone(), q.x, q.y - 0.02, q.z, yaw));
      physics.addBox({ x: q.x, y: q.y + 0.4, z: q.z }, { x: 0.28, y: 0.42, z: 1.5 }, yaw);
    }
    // the booth on the shoulder: a steel box with a window band, door ajar
    const bq = at(s0 - 2, 9.5);
    if (clear(bq.x, bq.z)) {
      b.add(M.booth, T(new THREE.BoxGeometry(1.8, 2.3, 1.6).translate(0, 1.15, 0), bq.x, bq.y, bq.z, bq.yaw));
      b.add(M.glass, T(new THREE.BoxGeometry(1.84, 0.6, 1.64).translate(0, 1.6, 0), bq.x, bq.y, bq.z, bq.yaw));
      b.add(M.booth, T(new THREE.BoxGeometry(2.1, 0.1, 1.9).translate(0, 2.35, 0), bq.x, bq.y, bq.z, bq.yaw));
      physics.addBox({ x: bq.x, y: bq.y + 1.15, z: bq.z }, { x: 0.9, y: 1.15, z: 0.8 }, bq.yaw);
      // the boom from the booth across the near lane, snapped and hanging
      const bp = at(s0 - 2, 7.6);
      b.add(M.steel, T(new THREE.BoxGeometry(0.3, 1.0, 0.3).translate(0, 0.5, 0), bp.x, bp.y, bp.z, bp.yaw));
      for (let i = 0; i < 5; i++) {
        const mat = i % 2 ? M.boomW : M.boom;
        const q = at(s0 - 2, 7.3 - i * 0.8);
        b.add(mat, T(new THREE.BoxGeometry(0.1, 0.1, 0.8), q.x, bp.y + 1.0 - i * 0.02, q.z, q.yaw + Math.PI / 2, 0, 0));
      }
      const tip = at(s0 - 2, 3.1);
      b.add(M.boom, T(new THREE.BoxGeometry(0.1, 0.1, 1.6), tip.x, tip.y + 0.5, tip.z, tip.yaw + Math.PI / 2, 0.6));
    }
    const sq = at(s0 - 14, 7.2);
    if (clear(sq.x, sq.z)) sign('rsCheck', 2.0, 1.0, sq.x, sq.z, sq.yaw + Math.PI, 1.3, (rand() - 0.5) * 0.08);
    for (let i = 0; i < 7; i++) {
      const q = at(s0 - 10 + i * 3.2, (i % 2 ? -1 : 1) * (1 + rand() * 4));
      cone(q.x, q.z, rand() < 0.45);
    }
  }

  // ---- luggage trails: suitcases, a duffel, clothes, a box of files, on the shoulder near the wrecks
  const trails: [number, number][] = [[-120, 122], [60, 74], [268, -82], [-300, 72]];
  for (const [tx, tz] of trails) {
    const s0 = nearest(tx, tz);
    for (let i = 0; i < 9; i++) {
      const q = at(s0 + i * 2.2 + rand() * 1.5, (rand() < 0.5 ? -1 : 1) * (5 + rand() * 3.5));
      if (!inside(q) || !clear(q.x, q.z)) continue;
      const yaw = rand() * 6, kind = rand();
      if (kind < 0.35) {
        const mat = [M.caseA, M.caseB, M.caseC][Math.floor(rand() * 3)];
        const open = rand() < 0.4;
        b.add(mat, T(new THREE.BoxGeometry(0.7, 0.22, 0.48).translate(0, 0.11, 0), q.x, q.y, q.z, yaw));
        if (open) {
          b.add(mat, T(new THREE.BoxGeometry(0.7, 0.06, 0.48).translate(0, 0.03, 0.24), q.x, q.y + 0.22, q.z, yaw, -2.2));
          b.add(M.cloth, T(new THREE.BoxGeometry(0.6, 0.06, 0.4).translate(0, 0.21, 0), q.x, q.y, q.z, yaw));
        } else {
          b.add(M.steel, T(new THREE.BoxGeometry(0.22, 0.03, 0.03).translate(0, 0.23, 0), q.x, q.y, q.z, yaw));
        }
      } else if (kind < 0.55) {
        b.add(M.duffel, T(new THREE.CapsuleGeometry(0.17, 0.5, 4, 10).rotateZ(Math.PI / 2).translate(0, 0.16, 0), q.x, q.y, q.z, yaw));
      } else if (kind < 0.8) {
        b.add(rand() < 0.5 ? M.cloth : M.clothB, T(new THREE.PlaneGeometry(0.7, 0.5).rotateX(-Math.PI / 2).translate(0, 0.02, 0), q.x, q.y, q.z, yaw, 0, (rand() - 0.5) * 0.1));
      } else {
        b.add(M.card, T(new THREE.BoxGeometry(0.4, 0.3, 0.32).translate(0, 0.15, 0), q.x, q.y, q.z, yaw, 0, 0.1));
      }
    }
  }

  // ---- hitchhikers' signs: a stake, a cardboard sign, a stool, a pack, facing the oncoming lane
  const hitch: [number, number, number][] = [[-75, 119, 1], [96, 48, -1], [300, -100, 1]];
  hitch.forEach(([hx, hz, sd], i) => {
    const q = at(nearest(hx, hz), sd * 7.4);
    if (!inside(q) || !clear(q.x, q.z)) return;
    const face = q.yaw + (sd > 0 ? Math.PI : 0) + (rand() - 0.5) * 0.4;
    b.add(M.stake, T(new THREE.BoxGeometry(0.05, 1.5, 0.05).translate(0, 0.75, -0.04), q.x, q.y - 0.1, q.z, face, (rand() - 0.5) * 0.15));
    b.add(M.card, T(new THREE.BoxGeometry(0.72, 0.5, 0.01).translate(0, 1.2, -0.012), q.x, q.y - 0.1, q.z, face));
    b.add(art, norm(artMap(HITCH_SIGNS[i % HITCH_SIGNS.length], new THREE.PlaneGeometry(0.7, 0.48)).translate(0, 1.2, -0.005).applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(q.x, q.y - 0.1, q.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, face, 0, 'YXZ')), new THREE.Vector3(1, 1, 1)))));
    const p = at(nearest(hx, hz) + 1.2, sd * 8.2);
    b.add(M.duffel, T(new THREE.BoxGeometry(0.34, 0.5, 0.22).translate(0, 0.25, 0), p.x, p.y, p.z, rand() * 6, 0, 0.2));
    b.add(M.steel, T(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 10).translate(0, 0.42, 0), p.x + 0.7, p.y, p.z, 0));
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * Math.PI * 2;
      b.add(M.steel, T(new THREE.CylinderGeometry(0.012, 0.012, 0.44, 4).translate(0, 0.21, 0), p.x + 0.7 + Math.cos(a) * 0.1, p.y, p.z + Math.sin(a) * 0.1, 0, Math.cos(a) * 0.2, Math.sin(a) * 0.2));
    }
  });

  // ---- Kade's survey stakes, pricing the road: a stake with orange flagging every 18 m along a stretch
  for (const [sx, sz, sd] of [[70, 70, 1], [-60, 118, -1]] as [number, number, number][]) {
    const s0 = nearest(sx, sz);
    for (let i = 0; i < 8; i++) {
      const q = at(s0 + i * 18, sd * 9);
      if (!inside(q) || !clear(q.x, q.z)) continue;
      const lean = (rand() - 0.5) * 0.2;
      b.add(M.stake, T(new THREE.BoxGeometry(0.04, 0.9, 0.04).translate(0, 0.45, 0), q.x, q.y - 0.1, q.z, rand() * 6, lean));
      b.add(M.flag, T(new THREE.PlaneGeometry(0.06, 0.32).translate(0.03, 0.7, 0), q.x, q.y - 0.1, q.z, q.yaw + rand(), lean, 0.3));
      b.add(M.flag, T(new THREE.PlaneGeometry(0.06, 0.32).translate(0.03, 0.7, 0).rotateY(Math.PI), q.x, q.y - 0.1, q.z, q.yaw + rand(), lean, 0.3));
    }
  }
}
