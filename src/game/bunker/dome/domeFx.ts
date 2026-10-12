import * as THREE from 'three/webgpu';
import { Fn, vec2, vec4, float, uniform, time, fract, uv, smoothstep, abs, dot, normalize, positionWorld, cameraPosition, normalWorld, clamp, viewportLinearDepth, linearDepth, cameraNear, cameraFar, pow } from 'three/tsl';
import { noise } from '@/engine/noiseTex';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/**
 * HUNTER (beta)'s hologram: additive cyan with scanlines climbing the body, a bright rim where the
 * surface turns away, and a flicker the runtime drives (`level`: 0 gone … 1 steady). One material,
 * shared by the skinned mesh (it skins like any node material).
 */
export function hologramMaterial() {
  const level = uniform(1);
  const tint = uniform(new THREE.Color('#5fd8ff'));
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide, fog: false });
  m.colorNode = Fn(() => {
    const p = positionWorld;
    const view = normalize(cameraPosition.sub(p));
    const rim = pow(float(1).sub(abs(dot(normalWorld, view))), 2.2);
    // fine lines climbing slowly, and a brighter band that sweeps up every few seconds
    const lines = smoothstep(0.35, 0.5, abs(fract(p.y.mul(28).sub(time.mul(1.4))).sub(0.5)));
    const sweep = smoothstep(0.08, 0.0, abs(fract(p.y.mul(0.25).sub(time.mul(0.18))).sub(0.5)));
    const grain = noise(vec2(p.x.add(p.z), p.y).mul(3).add(time.mul(vec2(0.0, 0.7)))).r;
    const a = rim.mul(0.9).add(0.12).add(sweep.mul(0.35)).mul(float(0.55).add(lines.mul(0.45))).mul(float(0.75).add(grain.mul(0.5)));
    return vec4((tint as N).mul(a).mul(level).mul(1.6), 1);
  })();
  return { material: m, level, tint };
}

/**
 * The cooling towers' plumes: a few crossed vertical cards rising from each mouth, their alpha from
 * the noise atlas scrolled upward and widening with height. Lit by a tint the runtime sets from the
 * sky (warm by day, blue-grey at night); `strength` 0 stops them (the plug pulled).
 */
export class Steam {
  readonly mesh: THREE.Mesh;
  readonly tint = uniform(new THREE.Color('#e9e4da'));
  readonly strength = uniform(1);

  constructor(mouths: { pos: THREE.Vector3; r: number }[], height = 22) {
    const geos: THREE.BufferGeometry[] = [];
    mouths.forEach((m, k) => {
      for (let i = 0; i < 5; i++) {
        // a card that widens upward (bottom = the mouth's width) and leans downwind as it rises
        const g = new THREE.PlaneGeometry(1, 1, 1, 8);
        const pos = g.attributes.position as THREE.BufferAttribute;
        const turn = (i * Math.PI) / 5 + k * 0.4, c = Math.cos(turn), sn = Math.sin(turn);
        for (let j = 0; j < pos.count; j++) {
          const v = pos.getY(j) + 0.5;
          const w = m.r * 2 * (0.9 + v * 2.2);
          const x = pos.getX(j) * w;
          pos.setXYZ(j, m.pos.x + x * c + Math.pow(v, 1.6) * height * 0.28, m.pos.y + v * height, m.pos.z - x * sn + Math.pow(v, 1.6) * height * 0.08);
        }
        // uv.x keeps the card's own across-coordinate; a per-card offset decorrelates them
        const uvA = g.attributes.uv as THREE.BufferAttribute;
        for (let j = 0; j < uvA.count; j++) uvA.setX(j, uvA.getX(j) + i * 1.7 + k * 3.1);
        geos.push(g);
      }
    });
    const geo = mergeAll(geos);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true, forceSinglePass: true });
    const strength = this.strength, tint = this.tint;
    mat.colorNode = Fn(() => {
      const u = uv();
      const across = fract(u.x).sub(0.5).abs().mul(2);
      const up = u.y;
      const n = noise(vec2(u.x.mul(0.35), up.mul(0.7)).sub(vec2(time.mul(0.01), time.mul(0.05)))).r;
      const n2 = noise(vec2(u.x.mul(0.8).add(0.4), up.mul(1.5)).sub(vec2(0, time.mul(0.09)))).g;
      // ragged edges and billows: the card's straight sides never show
      const body = smoothstep(1.0, 0.15, across.add(n.sub(0.5).mul(1.1)).add(n2.sub(0.5).mul(0.5)));
      const billow = smoothstep(0.15, 0.95, n.mul(0.65).add(n2.mul(0.55)));
      const fade = smoothstep(0.0, 0.08, up).mul(smoothstep(1.0, 0.3, up.add(n2.mul(0.3))));
      const soft = clamp(viewportLinearDepth.sub(linearDepth()).mul(cameraFar.sub(cameraNear)).div(2.0), 0, 1);
      const a = body.mul(fade).mul(billow).mul(0.5).mul(strength).mul(soft);
      // a little brighter where it's thin and high (the sun through it)
      const lit = (tint as N).mul(float(0.85).add(up.mul(0.2)));
      return vec4(lit, a.clamp(0, 0.75));
    })();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 18;
    this.mesh.castShadow = false;
    this.mesh.name = 'domeSteam';
  }
}

function mergeAll(gs: THREE.BufferGeometry[]) {
  let n = 0, idx = 0;
  for (const g of gs) { n += g.attributes.position.count; idx += g.index!.count; }
  const pos = new Float32Array(n * 3), uvs = new Float32Array(n * 2), ind = new Uint32Array(idx);
  let vo = 0, io = 0;
  for (const g of gs) {
    pos.set(g.attributes.position.array as Float32Array, vo * 3);
    uvs.set(g.attributes.uv.array as Float32Array, vo * 2);
    const gi = g.index!.array;
    for (let i = 0; i < gi.length; i++) ind[io + i] = gi[i] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setIndex(new THREE.BufferAttribute(ind, 1));
  out.computeBoundingSphere();
  return out;
}


/** The dome's night glow on its panes (0 off … 1): the runtime sets it from the hour and the power. */
export const uDomeGlow = uniform(0);
/** The dome's floor height (world y), for the panes' glow gradient. */
export const uDomeFloor = uniform(0);

/**
 * The dome's panes: glass (or, `dusty`, panes caked over solid) that pick up the racks' blue light
 * from inside at night, brightest low down where the racks are, fading toward the apex. Both share
 * one program (the opacity is a uniform).
 */
export function domePaneMaterial(dusty: boolean) {
  const m = new THREE.MeshStandardNodeMaterial({
    color: dusty ? '#d8d1c1' : '#d4ddd9', roughness: dusty ? 0.85 : 0.08, metalness: dusty ? 0 : 0.2,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
  });
  const op = uniform(dusty ? 0.9 : 0.16);
  m.opacityNode = op;
  const h = positionWorld.y.sub(uDomeFloor);
  const low = smoothstep(23, 0.5, h);
  const blue = vec4(0.22, 0.55, 1.0, 1).xyz;
  // (clear glass passes most light through: its glow is pushed up so it still reads at 16% opacity)
  m.emissiveNode = blue.mul(low.mul(0.85).add(0.15)).mul(uDomeGlow).mul(dusty ? 0.55 : 2.4);
  return m;
}
