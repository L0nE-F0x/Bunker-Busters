import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec3, float, positionWorld, normalWorld, texture, smoothstep, mix, abs, pow, sin,
  uniform, normalView, positionView, faceDirection, step, fwidth, clamp,
} from 'three/tsl';
import { noise, fbm2, noiseAt } from '@/engine/noiseTex';
import type { Heightfield } from './Heightfield';
import type { Atmosphere } from './Atmosphere';
import type { Physics } from '@/engine/physics';
import { SALT_FLAT } from '@/content/world';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/** Mikkelsen surface-gradient bump from an arbitrary scalar height node. */
export const bumpFromHeight = Fn(([height, strength]: [N, N]) => {
  const dHdx = height.dFdx().mul(strength);
  const dHdy = height.dFdy().mul(strength);
  const sx = positionView.dFdx();
  const sy = positionView.dFdy();
  const n = normalView;
  const r1 = sy.cross(n);
  const r2 = n.cross(sx);
  const det = sx.dot(r1).mul(faceDirection);
  const grad = det.sign().mul(dHdx.mul(r1).add(dHdy.mul(r2)));
  return det.abs().mul(n).sub(grad).normalize();
});

/** World metres per repeat of the ground-cover patch field (pavement / silt). */
const PATCH_SCALE = 260;
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * CPU twin of the terrain's ground-cover field: `pave` 0..1 = desert pavement (packed stones, little
 * grows), `silt` 0..1 = pale crusted hollow ground. Slope/road/cavity masks are left to the caller.
 */
export function groundPatchAt(x: number, z: number) {
  const u = x / PATCH_SCALE + 0.61, v = z / PATCH_SCALE + 0.17;
  const n = noiseAt(u, v, 1) + (noiseAt(u, v, 0) - 0.5) * 0.35;
  return { pave: ss(0.55, 0.63, n), silt: ss(0.32, 0.26, n) };
}

export class Terrain {
  mesh: THREE.Mesh;
  far: THREE.Mesh;
  dataTexture: THREE.DataTexture;
  /** Shading only: landscape cavity (R: height minus its ~10 m blur, G: minus its ~30 m blur). */
  cavityTexture: THREE.DataTexture;
  readonly uPlayer = uniform(new THREE.Vector3());

  constructor(private hf: Heightfield, private atmo?: Atmosphere) {
    this.dataTexture = this.buildDataTexture();
    this.cavityTexture = buildCavityTexture(hf);
    const material = this.buildMaterial();
    this.mesh = new THREE.Mesh(this.buildGeometry(), material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.name = 'terrain';
    this.far = this.buildFar(material);
  }

  private buildGeometry() {
    const { res, step, size, heights } = this.hf;
    const half = size / 2;
    // main grid + a 1-ring skirt that drops 12m to hide seams with the far mesh
    const vCount = res * res + res * 4;
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const n = { x: 0, y: 1, z: 0 };
    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const i = iz * res + ix;
        const x = -half + ix * step, z = -half + iz * step;
        pos[i * 3] = x;
        pos[i * 3 + 1] = heights[i];
        pos[i * 3 + 2] = z;
        this.hf.normalAt(x, z, n);
        nor[i * 3] = n.x; nor[i * 3 + 1] = n.y; nor[i * 3 + 2] = n.z;
      }
    }
    const idx: number[] = [];
    for (let iz = 0; iz < res - 1; iz++) {
      for (let ix = 0; ix < res - 1; ix++) {
        const a = iz * res + ix, b = (iz + 1) * res + ix, c = b + 1, d = a + 1;
        idx.push(a, b, d, b, c, d);
      }
    }
    // skirts
    let v = res * res;
    const edges: number[][] = [
      Array.from({ length: res }, (_, i) => i), // north row
      Array.from({ length: res }, (_, i) => (res - 1) * res + (res - 1 - i)), // south row (reversed)
      Array.from({ length: res }, (_, i) => (res - 1 - i) * res), // west col (reversed)
      Array.from({ length: res }, (_, i) => i * res + res - 1), // east col
    ];
    for (const edge of edges) {
      const start = v;
      for (const src of edge) {
        pos[v * 3] = pos[src * 3];
        pos[v * 3 + 1] = pos[src * 3 + 1] - 12;
        pos[v * 3 + 2] = pos[src * 3 + 2];
        nor[v * 3 + 1] = 1;
        v++;
      }
      for (let k = 0; k < res - 1; k++) {
        const a = edge[k], b = edge[k + 1], c = start + k + 1, d = start + k;
        idx.push(a, d, b, b, d, c, a, b, d, b, c, d); // double-sided strip
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  }

  private buildFar(material: THREE.Material) {
    // polar ring from the playable edge out to the horizon
    const rings = 40, segs = 160;
    const inner = this.hf.size * 0.47, outer = 3600;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const rad = inner + (outer - inner) * Math.pow(t, 1.8);
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        // square-ish inner boundary so it tucks under the main grid
        const sq = 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
        const rr = r === 0 ? rad * sq : rad * lerpN(sq, 1, t);
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        let h = this.hf.farHeight(x, z);
        if (r === 0) h -= 6;
        // far ridgelines get taller so the horizon has silhouettes
        h += Math.pow(t, 0.7) * 40;
        pos.push(x, h, z);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segs; s++) {
        const a = r * (segs + 1) + s, b = a + segs + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material);
    m.receiveShadow = false;
    m.name = 'farTerrain';
    return m;
  }

  /** RGBA half-float: R=highway dist, G=track dist, B=sin(dash phase), A=cos(dash phase). */
  private buildDataTexture() {
    const S = 512;
    const data = new Float32Array(S * S * 4);
    const { size } = this.hf;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const wx = ((x + 0.5) / S - 0.5) * size;
        const wz = ((y + 0.5) / S - 0.5) * size;
        const i = (y * S + x) * 4;
        const rd = this.hf.sampleGrid(this.hf.roadDist, wx, wz);
        const arc = this.hf.sampleGrid(this.hf.roadArc, wx, wz);
        data[i] = Math.min(rd, 60);
        data[i + 1] = Math.min(this.hf.sampleGrid(this.hf.trackDist, wx, wz), 60);
        data[i + 2] = Math.sin((arc / 9) * Math.PI * 2);
        data[i + 3] = Math.cos((arc / 9) * Math.PI * 2);
      }
    }
    const half = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
    const tex = new THREE.DataTexture(half, S, S, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  private buildMaterial() {
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
    const size = this.hf.size;
    const wp = positionWorld;
    const xz = wp.xz;
    const slope = float(1).sub(normalWorld.y);
    const d = texture(this.dataTexture, xz.div(size).add(0.5));
    const roadD = d.r, trackD = d.g;
    const inside = step(abs(xz.x), size * 0.5).mul(step(abs(xz.y), size * 0.5));

    // all noise comes from the baked atlas (cheap texture taps instead of per-pixel Perlin/Worley)
    const big = fbm2(xz.div(700));
    const midTap = noise(xz.div(48));
    const mid = midTap.r.sub(0.5);
    const fine = noise(xz.div(5)).g.sub(0.5);
    const grain = noise(xz.div(1.3)).a.sub(0.5);

    // landscape-scale cavity: hollows hold shade (ambient occlusion) and old moisture, ridges are
    // sun-bleached. Baked once from the heightfield, so the ground reads as relief, not a sheet.
    const cav = texture(this.cavityTexture, xz.div(size).add(0.5));
    const hollow = smoothstep(0.2, -2.2, cav.r).mul(inside);
    const basin = smoothstep(-0.5, -7.0, cav.g).mul(inside);
    const ridge = smoothstep(0.4, 2.8, cav.r).mul(inside);

    // sand with wind ripples; the ripples fade before they shrink to a pixel (they banded into
    // moire stripes across the mid-ground)
    const warp = fbm2(xz.div(36)).mul(7);
    const rPhase = xz.x.mul(0.9).add(xz.y.mul(0.4)).mul(5.5);
    const rippleAA = smoothstep(1.1, 0.3, fwidth(rPhase));
    const ripple = sin(rPhase.add(warp)).mul(0.5).add(0.5).sub(0.5).mul(rippleAA).add(0.5);
    // a broader ripple field (~4-6 m crests) that survives into the mid-ground and catches low sun
    const mPhase = xz.x.mul(0.62).add(xz.y.mul(0.78)).mul(1.15).add(midTap.g.sub(0.5).mul(9));
    const macro = sin(mPhase).mul(0.5).add(0.5).sub(0.5).mul(smoothstep(1.2, 0.3, fwidth(mPhase))).add(0.5);
    const rippleH = pow(ripple, 2.0).mul(0.6).add(fine.mul(0.3)).add(grain.mul(0.15)).add(pow(macro, 1.6).mul(2.4));
    // long wind streaks: lighter sand blown into tails, darker coarse lag between them
    const wdir = vec2(0.93, 0.36);
    const wAlong = xz.dot(wdir), wAcross = xz.dot(vec2(-0.36, 0.93));
    const streak = noise(vec2(wAlong.div(60), wAcross.div(3.2)).add(0.21)).r.sub(0.5);
    const sandBase = mix(
      mix(vec3(0.66, 0.41, 0.22), vec3(0.52, 0.30, 0.16), smoothstep(-0.25, 0.25, big)),
      vec3(0.76, 0.55, 0.33),
      smoothstep(0.0, 0.3, mid).mul(0.5),
    );
    const sand = sandBase.mul(float(0.9).add(ripple.mul(0.1)).add(grain.mul(0.06)).add(streak.mul(0.16)));

    // cracked salt / mud flats in low ground
    const lowMask = smoothstep(-6.5, -9.0, wp.y.add(mid.mul(6))).mul(smoothstep(0.25, 0.05, slope));
    const crackTap = noise(xz.div(7));
    const crk = smoothstep(0.16, 0.03, crackTap.b);
    const mud = mix(mix(vec3(0.68, 0.58, 0.46), vec3(0.54, 0.45, 0.35), crackTap.r), vec3(0.24, 0.18, 0.14), crk.mul(0.85));

    // rock / mesa faces: an irregular stack of sediment layers (1D noise up the face, drifting slowly
    // sideways) instead of evenly spaced sine stripes, with desert varnish streaking down the cliffs
    const rockMask = smoothstep(0.22, 0.42, slope.add(mid.mul(0.15)));
    const strataN = fbm2(xz.div(90)).mul(5);
    const along = xz.x.add(xz.y);
    const layer = noise(vec2(wp.y.div(11).add(strataN.mul(0.12)), along.div(520))).r;
    const layerFine = noise(vec2(wp.y.div(2.6).add(strataN.mul(0.3)), along.div(240)).add(0.37)).g;
    const bands = smoothstep(0.3, 0.7, layer);
    const pale = smoothstep(0.6, 0.78, layerFine).mul(smoothstep(1.2, 0.35, fwidth(wp.y.div(2.6)).mul(6)));
    const rockTap = noise(vec2(along.mul(0.6), wp.y).div(4));
    const varnish = smoothstep(0.5, 0.78, noise(vec2(along.mul(0.22), wp.y.mul(0.018)).add(0.53)).r)
      .mul(smoothstep(0.35, 0.6, slope));
    const rock = mix(mix(vec3(0.27, 0.13, 0.08), vec3(0.55, 0.30, 0.16), bands), vec3(0.70, 0.52, 0.36), pale.mul(0.55))
      .mul(float(0.78).add(rockTap.r.mul(0.4)))
      .mul(float(1).sub(varnish.mul(0.5)));
    const ledge = smoothstep(0.42, 0.5, layer).mul(smoothstep(0.58, 0.5, layer));
    const rockH = layerFine.mul(0.5).add(rockTap.r.mul(0.9)).add(rockTap.b.mul(0.4)).add(ledge.mul(0.8));

    // scrub patches
    const scrubTap = noise(xz.div(80).add(0.3));
    const scrubMask = smoothstep(0.05, 0.25, scrubTap.r.sub(0.5)).mul(float(1).sub(rockMask)).mul(0.5);

    // highway: old, sun-greyed asphalt. Alligator cracking only in patches (a crack network
    // everywhere read as paving tiles), darker tar repairs, crumbling edges, faded paint, drifting sand
    const t9 = noise(xz.div(9));
    const edgeNoise = t9.r.sub(0.5).mul(2.4);
    const asphaltMask = smoothstep(4.6, 3.8, roadD.add(edgeNoise)).mul(inside);
    // (taps shared between masks where the scale allows: every fetch costs the whole ground)
    const driftTap = noise(xz.div(22).add(0.5));
    const sandDrift = smoothstep(0.45, 0.7, driftTap.g);
    const crackZone = smoothstep(0.52, 0.72, driftTap.r).add(smoothstep(3.0, 4.2, roadD).mul(0.6));
    const roadCracks = smoothstep(0.07, 0.015, noise(xz.div(5).add(0.25)).b).mul(clamp(crackZone, 0, 1));
    const tarPatch = smoothstep(0.68, 0.7, crackTap.g);
    const dash = smoothstep(0.1, 0.25, d.b).mul(smoothstep(0.22, 0.12, roadD));
    const sideLine = smoothstep(0.18, 0.06, abs(roadD.sub(3.3)));
    const t3 = noise(xz.div(3));
    const paintWear = smoothstep(0.35, 0.6, t3.r);
    const aggregate = grain.add(0.5).mul(0.35).add(fine.add(0.5).mul(0.65));
    // sun-bleached blotches, darker wheel paths either side of each lane centre, oil drips between them
    const bleach = scrubTap.g.sub(0.5);
    const wheel = smoothstep(0.55, 0.0, abs(abs(roadD.sub(1.65)).sub(0.55))).mul(0.5);
    const oil = smoothstep(0.62, 0.8, t3.g).mul(smoothstep(0.35, 0.0, abs(roadD.sub(1.65))));
    const asphaltBase = mix(vec3(0.095, 0.092, 0.088), vec3(0.19, 0.18, 0.17), aggregate)
      .mul(float(1).add(bleach.mul(0.5)).sub(wheel.mul(0.3)).sub(oil.mul(0.45)))
      .mul(float(1).sub(tarPatch.mul(0.25)));
    const asphalt = mix(
      mix(
        mix(asphaltBase, vec3(0.03), roadCracks.mul(0.9)),
        vec3(0.75, 0.55, 0.12), dash.mul(paintWear).mul(0.85),
      ),
      vec3(0.62, 0.6, 0.56), sideLine.mul(paintWear).mul(0.6),
    );
    const roadFinal = asphaltMask.mul(float(1).sub(sandDrift.mul(0.75)));

    // dirt tracks with tyre ruts
    const trackMask = smoothstep(3.6, 2.2, trackD.add(edgeNoise.mul(0.5))).mul(inside);
    const tyre = smoothstep(0.4, 0.0, abs(trackD.sub(0.95))).mul(0.25);
    const dirt = vec3(0.52, 0.38, 0.26).mul(float(1).sub(tyre)).mul(float(0.9).add(grain.mul(0.2)));

    // pebbles and grit scattered over sand and dirt (cell blobs, thinned by a second tap; they fade
    // out before they shrink below a pixel so the far ground doesn't sparkle)
    const pebTap = noise(xz.div(2.8).add(0.13));
    const pebMask = smoothstep(0.62, 0.8, t9.g.add(mid.mul(0.6)));
    const pebNear = smoothstep(0.5, 0.15, fwidth(xz.x.div(2.8)).mul(12));
    // (grit in irregular drifts: the old cell-shaped blobs of dots read as animal tracks)
    const pebble = smoothstep(0.5, 0.75, pebTap.r).mul(step(0.86, pebTap.a)).mul(pebMask).mul(pebNear)
      .mul(float(1).sub(rockMask)).mul(float(1).sub(roadFinal)).mul(float(1).sub(lowMask));
    const pebCol = mix(vec3(0.34, 0.24, 0.17), vec3(0.62, 0.52, 0.42), pebTap.r);

    // ground cover patches (same field as `groundPatchAt`, so scatter agrees): wind-stripped desert
    // pavement on the flats (a packed mosaic of dark varnished stones, sand only in the gaps) and
    // pale crusted silt in shallow hollows. Both fade to their average tone before a stone is a pixel.
    const patchTap = noise(xz.div(PATCH_SCALE).add(vec2(0.61, 0.17)));
    const patchN = patchTap.g.add(patchTap.r.sub(0.5).mul(0.35)).add(ridge.mul(0.05));
    const flatK = smoothstep(0.16, 0.07, slope);
    const offRoad = float(1).sub(roadFinal).mul(float(1).sub(trackMask)).mul(float(1).sub(lowMask)).mul(inside);
    const pave = smoothstep(0.55, 0.63, patchN.add(edgeNoise.mul(0.012))).mul(flatK).mul(offRoad);
    const silt = smoothstep(0.32, 0.26, patchN).mul(smoothstep(0.0, -1.4, cav.r)).mul(flatK).mul(offRoad);
    const gravTap = noise(xz.div(1.6).add(0.41));
    const gNear = smoothstep(0.42, 0.2, fwidth(xz.x.div(1.6)).mul(12));
    const stoneIn = smoothstep(0.06, 0.24, gravTap.b);
    const stoneCol = mix(vec3(0.15, 0.09, 0.06), vec3(0.4, 0.28, 0.19), smoothstep(0.3, 0.7, gravTap.r)).mul(float(0.8).add(grain.mul(0.4)));
    const paveNear = mix(sand.mul(0.8), stoneCol, stoneIn.mul(0.92));
    const paveFar = mix(sand.mul(0.8), vec3(0.25, 0.165, 0.11), 0.62);
    const paveCol = mix(paveFar, paveNear, gNear);
    const siltCol = mix(vec3(0.80, 0.71, 0.59), vec3(0.70, 0.61, 0.50), crackTap.r).mul(float(1).sub(crk.mul(0.28)));

    let col: N = mix(sand, vec3(0.42, 0.34, 0.22), scrubMask.mul(float(1).sub(pave)));
    col = mix(col, siltCol, silt.mul(0.8));
    col = mix(col, paveCol, pave.mul(0.9));
    col = mix(col, pebCol, pebble);
    col = mix(col, mud, lowMask);
    col = mix(col, dirt, trackMask);
    col = mix(col, rock, rockMask);
    col = mix(col, asphalt, roadFinal);

    // cavity: damp, darker, slightly richer hollows; bleached ridges
    col = col.mul(float(1).sub(hollow.mul(0.22)).sub(basin.mul(0.1)).add(ridge.mul(0.07)));
    col = mix(col, col.mul(vec3(0.92, 0.86, 0.84)), hollow.mul(float(1).sub(roadFinal)).mul(0.6));

    // the salt (SALT_FLAT): a bright crust of polygon plates with raised white rims, wind-dusted at
    // the shore, tyre tracks still dark across it. The rims fade before they'd shimmer into moire.
    const uSalt = uniform(new THREE.Vector3(SALT_FLAT.x, SALT_FLAT.z, SALT_FLAT.r));
    const saltEdge = xz.sub(uSalt.xy).length().add(mid.mul(16)).add(fine.mul(3));
    const saltK = smoothstep(uSalt.z.add(5), uSalt.z.sub(7), saltEdge).mul(float(1).sub(rockMask)).mul(float(1).sub(roadFinal)).mul(float(1).sub(trackMask.mul(0.7))).mul(inside);
    const plate = noise(xz.div(2.4).add(vec2(0.31, 0.77)));
    const rimAA = smoothstep(0.5, 0.12, fwidth(xz.x.div(2.4)).mul(10));
    const rim = smoothstep(0.1, 0.02, plate.b).mul(rimAA);
    const shoreDust = smoothstep(uSalt.z.sub(14), uSalt.z.add(2), saltEdge);
    const saltCol = mix(vec3(0.86, 0.85, 0.82), vec3(0.95, 0.94, 0.91), plate.r.mul(0.6).add(rim.mul(0.5)))
      .mul(float(0.94).add(grain.mul(0.08)))
      .mul(mix(vec3(1), vec3(0.93, 0.86, 0.76), shoreDust.mul(0.7).add(smoothstep(0.62, 0.8, midTap.g).mul(0.25))));
    col = mix(col, saltCol, saltK);

    // pavement lies flat (wind took the ripples), its stones stand proud; silt crusts crack
    let h: N = mix(rippleH.mul(0.5).add(pebble.mul(0.5)), stoneIn.mul(gNear).mul(0.35).add(grain.mul(0.05)), pave);
    h = mix(h, crk.mul(-0.35).add(fine.mul(0.1)), silt.mul(0.8));
    h = mix(h, rockH, rockMask);
    h = mix(h, crk.mul(-0.6).add(fine.mul(0.15)), lowMask);
    h = mix(h, roadCracks.mul(-0.4).add(grain.mul(0.08)), roadFinal);
    h = mix(h, tyre.mul(-0.5).add(grain.mul(0.1)), trackMask);
    h = mix(h, rim.mul(0.55).add(plate.r.mul(0.12)).add(grain.mul(0.04)), saltK);

    if (this.atmo) {
      // storm: sand streams across the ground in long wind-aligned ribbons
      const a = this.atmo;
      const dir = a.uUpwind.negate().normalize();
      const q = xz.sub(a.uSandFlow);
      const along = q.dot(dir), across = q.dot(vec2(dir.y.negate(), dir.x));
      const ribbons = noise(vec2(along.div(14), across.div(1.6))).r;
      const flow = smoothstep(0.45, 0.75, ribbons).mul(float(1).sub(rockMask.mul(0.7)));
      const amount = a.uStorm.mul(0.55).add(a.uDust.mul(0.08));
      col = mix(col, (a.uStormColor as N).mul(2.2).add(vec3(0.05, 0.03, 0.01)), flow.mul(amount));
      h = h.add(flow.mul(amount).mul(0.4));
    }

    mat.colorNode = col;
    mat.normalNode = bumpFromHeight(h, float(0.06));
    // fine sand gets a soft grazing sheen toward a low sun; rock and old asphalt stay matte-ish
    // (pavement stays matte: the grazing sand sheen washed its dark stones out to the sand's tone)
    mat.roughnessNode = mix(mix(mix(float(0.8).add(grain.mul(0.1)), float(0.97), pave), float(0.86), rockMask), mix(float(0.78), float(0.55), oil), roadFinal);
    // the sky can't reach into the folds: occlusion on the ambient/IBL only, so sunlit hollows stay lit
    mat.aoNode = float(1).sub(hollow.mul(0.5)).sub(basin.mul(0.2));
    // the salt glares: a smoother crust catches a low sun across the whole flat
    mat.roughnessNode = mix(mat.roughnessNode as N, float(0.58).add(rim.mul(0.2)), saltK);
    return mat;
  }

  addToPhysics(physics: Physics) {
    const { res, size, heights } = this.hf;
    const n = res - 1;
    // Rapier: heights[row + col*(nrows+1)] where row ↔ z, col ↔ x
    const hData = new Float32Array(res * res);
    for (let ix = 0; ix < res; ix++) {
      for (let iz = 0; iz < res; iz++) hData[iz + ix * res] = heights[iz * res + ix];
    }
    const R = physics.R;
    physics.world.createCollider(R.ColliderDesc.heightfield(n, n, hData, { x: size, y: 1, z: size }));
    // invisible boundary walls
    const h = size / 2 - 8;
    physics.addBox({ x: 0, y: 50, z: -h }, { x: h, y: 200, z: 1 });
    physics.addBox({ x: 0, y: 50, z: h }, { x: h, y: 200, z: 1 });
    physics.addBox({ x: -h, y: 50, z: 0 }, { x: 1, y: 200, z: h });
    physics.addBox({ x: h, y: 50, z: 0 }, { x: 1, y: 200, z: h });
  }
}

function lerpN(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/**
 * Landscape cavity for shading: height minus a blurred copy of itself at two radii (two box passes
 * each, ≈ Gaussian). Negative = hollow, positive = ridge. RG half-float on the heightfield grid.
 */
function buildCavityTexture(hf: Heightfield) {
  const { res, heights } = hf;
  const blur = (src: Float32Array, r: number) => {
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    const pass = (a: Float32Array, b: Float32Array, horizontal: boolean) => {
      for (let j = 0; j < res; j++) {
        let acc = 0, n = 0;
        const at = (i: number) => (horizontal ? j * res + i : i * res + j);
        for (let i = -r; i <= r; i++) { if (i >= 0 && i < res) { acc += a[at(i)]; n++; } }
        for (let i = 0; i < res; i++) {
          b[at(i)] = acc / n;
          const lo = i - r, hi = i + r + 1;
          if (lo >= 0) { acc -= a[at(lo)]; n--; }
          if (hi < res) { acc += a[at(hi)]; n++; }
        }
      }
    };
    pass(src, tmp, true); pass(tmp, out, false);
    pass(out, tmp, true); pass(tmp, out, false);
    return out;
  };
  const a = blur(heights, 3), b = blur(heights, 9);
  const data = new Uint16Array(res * res * 2);
  for (let i = 0; i < res * res; i++) {
    data[i * 2] = THREE.DataUtils.toHalfFloat(heights[i] - a[i]);
    data[i * 2 + 1] = THREE.DataUtils.toHalfFloat(heights[i] - b[i]);
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RGFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
