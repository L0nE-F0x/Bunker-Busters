import * as THREE from 'three/webgpu';
import {
  uniform, vec3, vec4, float, Fn, positionLocal, positionWorld, cameraPosition, normalize, dot, max, pow, mix,
  smoothstep, exp, abs, select, length, time, mx_cell_noise_float, clamp, fog, vec2, atan, renderGroup,
} from 'three/tsl';
import { clamp as clampN, lerp, smoothstep as smoothN } from '@/engine/noise';
import { noise } from '@/engine/noiseTex';
import { coneMurk } from './effects';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

interface SkyKey {
  e: number; // sun elevation (dir.y)
  zenith: string;
  horizon: string;
  haze: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  fog: number;
  env: number;
  /** Camera exposure (a slow "eye adaptation": brighter nights, tamer noon). */
  exp: number;
}

// Keyed on sun elevation, not clock time, so dawn and dusk share a palette.
const KEYS: SkyKey[] = [
  { e: -0.45, zenith: '#03060f', horizon: '#0a1428', haze: '#0b1220', sun: '#5d7fc4', sunI: 0.75, hemiSky: '#2a4472', hemiGround: '#0c0a0a', hemiI: 0.42, fog: 0.0030, env: 0.22, exp: 1.55 },
  { e: -0.12, zenith: '#071228', horizon: '#1d2440', haze: '#1c1e32', sun: '#6a84c0', sunI: 0.55, hemiSky: '#2c4270', hemiGround: '#100b0a', hemiI: 0.4, fog: 0.0032, env: 0.22, exp: 1.45 },
  { e: -0.03, zenith: '#132a50', horizon: '#c0502a', haze: '#6a3a3c', sun: '#ff4d1a', sunI: 0.6, hemiSky: '#3a4a70', hemiGround: '#2a1610', hemiI: 0.45, fog: 0.0034, env: 0.3, exp: 1.2 },
  { e: 0.04, zenith: '#1a4c70', horizon: '#ff7a2e', haze: '#d07040', sun: '#ff6a1e', sunI: 3.2, hemiSky: '#5a8ca0', hemiGround: '#5a3420', hemiI: 0.6, fog: 0.0030, env: 0.55, exp: 1.0 },
  { e: 0.16, zenith: '#22648e', horizon: '#f2a464', haze: '#d89a6a', sun: '#ffa45c', sunI: 4.2, hemiSky: '#7aaab8', hemiGround: '#6a4428', hemiI: 0.7, fog: 0.0024, env: 0.7, exp: 0.92 },
  { e: 0.42, zenith: '#2a72a8', horizon: '#d8c2a2', haze: '#c4a884', sun: '#ffe2bc', sunI: 5.0, hemiSky: '#86b4cc', hemiGround: '#6a4a30', hemiI: 0.62, fog: 0.0015, env: 0.72, exp: 0.82 },
  { e: 1.0, zenith: '#2266a8', horizon: '#ccc0aa', haze: '#b8aa94', sun: '#fff2dc', sunI: 5.4, hemiSky: '#8cbad4', hemiGround: '#6e5236', hemiI: 0.62, fog: 0.0012, env: 0.72, exp: 0.78 },
];

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

function lerpColor(a: string, b: string, t: number, out: THREE.Color) {
  tmpA.set(a);
  tmpB.set(b);
  return out.copy(tmpA).lerp(tmpB, t);
}

/**
 * Owns time of day, the sun/moon light, hemisphere fill, the procedural sky dome and the scene fog.
 * Sky and fog share one `haze(rd)` function so distant terrain melts seamlessly into the horizon.
 */
export class Atmosphere {
  hour = 17.1; // golden hour
  dayLengthMinutes = 26; // real minutes per in-game day
  paused = false;

  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh;

  readonly uSunDir = uniform(new THREE.Vector3(0.5, 0.2, -0.5).normalize());
  readonly uMoonDir = uniform(new THREE.Vector3(-0.3, 0.8, 0.4).normalize());
  readonly uZenith = uniform(new THREE.Color());
  readonly uHorizon = uniform(new THREE.Color());
  readonly uHaze = uniform(new THREE.Color());
  readonly uSunColor = uniform(new THREE.Color());
  readonly uFogDensity = uniform(0.004);
  readonly uFogFalloff = uniform(0.018);
  readonly uFogBase = uniform(0);
  readonly uNight = uniform(0);
  readonly uDust = uniform(0.2);
  readonly uWind = uniform(new THREE.Vector2(1, 0.3));
  /** Dust storm strength 0..1 and the approaching wall on the upwind horizon 0..1 (set by Weather). */
  readonly uStorm = uniform(0);
  /** Cirrus drift integrated on the CPU (wind × time would jump whenever the wind changes). */
  readonly uCloudDrift = uniform(new THREE.Vector2());
  /** Ground sand-flow offset integrated from the wind (terrain storm ribbons). */
  readonly uSandFlow = uniform(new THREE.Vector2());
  readonly uFront = uniform(0);
  readonly uUpwind = uniform(new THREE.Vector2(-1, 0));
  /** Storm dust colour, lit by the current daylight (CPU-side so sky, fog and particles agree). */
  readonly uStormColor = uniform(new THREE.Color('#8a5a32'));

  /** Sun elevation; >0 day. */
  sunElevation = 0;
  sunColor = new THREE.Color();
  envIntensity = 0.6;
  /** Suggested camera exposure for the post stack. */
  exposure = 1;
  windDir = new THREE.Vector2(0.9, 0.35).normalize();
  windStrength = 0.6;
  dustiness = 0.2;
  storm = 0;
  stormFront = 0;
  private dustTimer = 0;

  private readonly setDir = new THREE.Vector3(0.68, 0, -0.73).normalize();
  private readonly perp = new THREE.Vector3(0.73, 0, 0.68).normalize();

  constructor(private scene: THREE.Scene) {
    // Shared render-group uniforms: three skips per-object uniform refreshes for plain (non-node)
    // materials whose object and lights didn't change, so object-group fog uniforms went stale on
    // e.g. the far city whenever the sun stood still (paused clock, storm fronts in screenshots).
    for (const u of [this.uSunDir, this.uMoonDir, this.uZenith, this.uHorizon, this.uHaze, this.uSunColor, this.uFogDensity,
      this.uFogFalloff, this.uFogBase, this.uNight, this.uDust, this.uWind, this.uStorm, this.uCloudDrift, this.uFront,
      this.uUpwind, this.uStormColor, this.uSandFlow] as N[]) u.setGroup(renderGroup);
    this.sun = new THREE.DirectionalLight(0xffffff, 4);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(4096, 4096);
    s.camera.near = 1;
    s.camera.far = 700;
    const ext = 70;
    s.camera.left = -ext;
    s.camera.right = ext;
    s.camera.top = ext;
    s.camera.bottom = -ext;
    s.bias = -0.0004;
    s.normalBias = 0.04;
    s.radius = 3;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x88aabb, 0x553322, 0.6);
    scene.add(this.hemi);

    this.sky = this.buildSky();
    scene.add(this.sky);

    scene.fogNode = this.buildFog();
    this.update(0, new THREE.Vector3());
  }

  setShadowMapSize(size: number) {
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    (this.sun.shadow as any).map = null;
  }

  /**
   * The dust wall of an approaching storm: a ragged brown band rising on the upwind horizon.
   * Returns 0..1 coverage along `rd`. Azimuth noise wraps seamlessly (integer atlas repeats).
   */
  private wall = Fn(([rd]: [N]) => {
    const flat = vec2(rd.x, rd.z).add(vec2(1e-4, 0)).normalize();
    const facing = smoothstep(-0.3, 0.8, dot(flat, this.uUpwind));
    const az = atan(rd.z, rd.x).div(Math.PI * 2);
    // cauliflower skyline: broad swells + tighter billows, slowly boiling
    const n1 = noise(vec2(az.mul(5), time.mul(0.002))).r;
    const n2 = noise(vec2(az.mul(11), time.mul(0.005).add(0.5))).g;
    const top = this.uFront.mul(facing).mul(n1.mul(0.36).add(n2.mul(0.1)).add(0.08)).sub(0.015);
    return smoothstep(top, top.sub(0.05), rd.y).mul(facing).mul(this.uFront);
  });

  /** Shading inside the dust wall: dark at the base, sun-caught billows near the top. */
  private wallShade = Fn(([rd, w]: [N, N]) => {
    const az = atan(rd.z, rd.x).div(Math.PI * 2);
    const h = clamp(rd.y, 0, 1);
    const puffs = noise(vec2(az.mul(31), h.mul(9).sub(time.mul(0.012)))).r;
    const lift = smoothstep(0.0, 0.4, h).mul(0.6).add(puffs.mul(puffs).mul(0.7));
    const mu = max(dot(rd, this.uSunDir), 0);
    const sunVis = smoothstep(-0.1, 0.05, this.uSunDir.y);
    const base = (this.uStormColor as N).mul(float(0.3).add(lift.mul(0.8)));
    const rim = this.uSunColor.mul(pow(mu, 3).mul(0.25).add(0.04).mul(sunVis).mul(lift));
    return base.add(rim).mul(w.mul(0).add(1));
  });

  /** Haze colour seen along a view ray (no sun disk). Shared by sky + fog. */
  private haze = Fn(([rd]: [N]) => {
    const mu = max(dot(rd, this.uSunDir), 0);
    const h = clamp(rd.y, -1, 1);
    const base = mix(this.uHaze, this.uHorizon, smoothstep(-0.05, 0.12, h).mul(0.6));
    const forward = pow(mu, 5).mul(0.9).add(pow(mu, 24).mul(1.2));
    const sunVis = smoothstep(-0.12, 0.05, this.uSunDir.y);
    const dustTint = vec3(0.72, 0.5, 0.32);
    const c = base.add(this.uSunColor.mul(forward).mul(sunVis).mul(0.55));
    const calm = mix(c, dustTint.mul(length(this.uHaze as N).mul(0.7).add(0.15)), this.uDust.mul(0.3)).toVar();
    // twilight: afterglow hugging the horizon under the set sun, and the pink anti-twilight arch
    const sy = this.uSunDir.y;
    const twi = smoothstep(-0.24, -0.05, sy).mul(smoothstep(0.16, -0.01, sy));
    const flatRd = vec2(rd.x, rd.z).add(vec2(1e-4, 0)).normalize();
    const flatSun = vec2(this.uSunDir.x, this.uSunDir.z).add(vec2(1e-4, 0)).normalize();
    const az = dot(flatRd, flatSun);
    const hp = max(h, 0);
    // clamp: pow() of a negative is NaN, and NaN * 0 still blacks out the whole frame through bloom
    const afterglow = pow(clamp(az.mul(0.5).add(0.5), 0, 1), 5).mul(exp(hp.mul(-9)));
    const glowCol = mix(vec3(1.0, 0.32, 0.08), vec3(1.0, 0.62, 0.3), smoothstep(0.0, 0.12, hp));
    calm.addAssign(glowCol.mul(afterglow).mul(twi).mul(0.55));
    const belt = pow(max(az.negate(), 0), 2).mul(smoothstep(0.0, 0.08, hp)).mul(smoothstep(0.32, 0.1, hp));
    calm.addAssign(vec3(0.42, 0.2, 0.3).mul(belt).mul(twi).mul(0.35));
    // storm: airborne sand swallows everything into one warm brown, glowing toward the sun
    const stormCol = (this.uStormColor as N).add(this.uSunColor.mul(pow(mu, 4).mul(sunVis).mul(0.35)));
    const w = this.wall(rd);
    return mix(mix(calm, stormCol, this.uStorm.mul(0.94)), this.wallShade(rd, w), w.mul(0.97));
  });

  private buildSky() {
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
    const sky = Fn(() => {
      const rd = normalize(positionLocal).toVar();
      const h = rd.y;
      const mu = dot(rd, this.uSunDir);
      const hz = this.haze(rd);
      // gradient: haze at horizon → zenith
      const t = pow(clamp(h, 0, 1), 0.42);
      const col = mix(hz, this.uZenith, t).toVar();
      // below horizon: darker ground haze
      col.assign(mix(col, hz.mul(0.7), smoothstep(0.0, -0.25, h)));
      // storm: one brown dome, a little darker overhead
      const storm = this.uStorm;
      col.assign(mix(col, hz.mul(mix(float(1), float(0.6), clamp(h, 0, 1))), storm.mul(0.96)));

      // sun disk + corona
      const sunVis = smoothstep(-0.08, 0.02, this.uSunDir.y);
      const disk = smoothstep(0.99955, 0.99975, mu);
      const clear = float(1).sub(storm);
      // through a storm the sun is a pale, soft disc you can look at
      const paleSun = mix(this.uSunColor, vec3(1.0, 0.86, 0.62), storm);
      col.addAssign(paleSun.mul(disk).mul(mix(float(28), float(1.4), storm)).mul(sunVis));
      col.addAssign(this.uSunColor.mul(pow(max(mu, 0), mix(float(380), float(60), storm))).mul(mix(float(2.5), float(0.5), storm)).mul(sunVis));

      // cirrus streaks projected onto a high plane
      const cuv = rd.xz.div(max(h, 0.04).add(0.12)).toVar();
      const drift = this.uCloudDrift;
      const streak = vec2(cuv.x.mul(0.9).add(drift.x), cuv.y.mul(2.6).add(drift.y));
      const n1 = noise(streak.mul(0.12)).r.sub(0.5);
      const n2 = noise(cuv.mul(0.45).add(drift.mul(1.7))).g.sub(0.5);
      const cloud = smoothstep(0.02, 0.3, n1.add(n2.mul(0.45))).mul(smoothstep(0.0, 0.18, h)).toVar();
      const lit = pow(max(mu, 0), 3);
      const cloudCol = mix(
        mix(this.uZenith.mul(0.6), this.uHorizon, 0.55).mul(float(1).sub(this.uNight.mul(0.7))),
        this.uSunColor.mul(1.6),
        lit.mul(sunVis).add(sunVis.mul(0.18)),
      );
      col.assign(mix(col, cloudCol, cloud.mul(0.75).mul(clear)));

      // night sky: milky way, two star layers, a cratered moon with a soft halo
      const dark = pow(this.uNight, 2.5).mul(pow(clear, 4)).mul(float(1).sub(cloud)).mul(smoothstep(0.0, 0.25, h)).toVar();
      const mwN = vec3(0.32, 0.55, 0.77).normalize();
      const mwT = vec3(0.86, -0.5, 0).normalize();
      const mwB = mwN.cross(mwT);
      const md = dot(rd, mwN);
      const mwU = atan(dot(rd, mwB), dot(rd, mwT)).div(Math.PI * 2);
      const band = exp(md.mul(md).mul(-22));
      const mwCloud = noise(vec2(mwU.mul(9), md.mul(3.1))).r;
      const mwLanes = smoothstep(0.42, 0.62, noise(vec2(mwU.mul(17), md.mul(5.3)).add(0.37)).g);
      const milky = band.mul(mwCloud.mul(1.3).add(0.2)).mul(float(1).sub(mwLanes.mul(band).mul(0.55)));
      col.addAssign(vec3(0.52, 0.58, 0.78).mul(milky).mul(0.11).mul(dark));
      const s1 = mx_cell_noise_float(rd.mul(520));
      const faint = smoothstep(float(0.992).sub(band.mul(0.012)), 1.0, s1).mul(s1.mul(97.3).fract().mul(0.7).add(0.3));
      const s2 = mx_cell_noise_float(rd.mul(210).add(13.7));
      const twinkle = time.mul(2.3).add(s2.mul(60)).sin().mul(0.3).add(0.7);
      const bright = smoothstep(0.9988, 1.0, s2).mul(twinkle);
      const tint = mix(vec3(1.0, 0.82, 0.66), vec3(0.72, 0.84, 1.0), s2.mul(53.1).fract());
      col.addAssign(tint.mul(faint.mul(0.9).add(bright.mul(2.2))).mul(dark));
      const mmu = dot(rd, this.uMoonDir);
      const moonDisk = smoothstep(0.99935, 0.99955, mmu);
      // crater/maria pattern in the disk's own tangent frame
      const mT = this.uMoonDir.cross(vec3(0, 1, 0.001)).normalize();
      const mB = this.uMoonDir.cross(mT);
      const mUv = vec2(dot(rd, mT), dot(rd, mB)).mul(28);
      const maria = smoothstep(0.35, 0.65, noise(mUv.add(0.21)).r).mul(-0.45).add(noise(mUv.mul(2.7)).b.mul(0.2)).add(0.95);
      const moonGlow = pow(max(mmu, 0), 2500).mul(0.18).add(pow(max(mmu, 0), 80).mul(0.05));
      col.addAssign(vec3(0.82, 0.87, 1.0).mul(moonDisk.mul(maria).mul(0.75).add(moonGlow)).mul(this.uNight).mul(pow(clear, 3)));

      // faint dust band glow near horizon
      col.addAssign(hz.mul(smoothstep(0.08, 0.0, abs(h)).mul(0.08)));
      // approaching storm wall: billowing brown band on the upwind horizon (sky part; fog does the ground)
      const w = this.wall(rd);
      col.assign(mix(col, this.wallShade(rd, w), w.mul(0.98)));
      return vec4(col, 1);
    });
    mat.colorNode = sky();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), mat);
    mesh.renderOrder = -1000;
    mesh.frustumCulled = false;
    mesh.name = 'sky';
    return mesh;
  }

  /** iq-style analytic height fog coloured by haze(rd). */
  private buildFog() {
    const factor = Fn(() => {
      const delta = positionWorld.sub(cameraPosition);
      const dist = length(delta);
      const rd = delta.div(dist);
      const b = this.uFogFalloff;
      const tt = dist.mul(rd.y).mul(b);
      const ratio = select(abs(tt).lessThan(1e-4), float(1), float(1).sub(exp(tt.negate())).div(tt));
      // storm: visibility drops to ~60 m (density ×28 at full strength)
      const density = this.uFogDensity.mul(float(1).add(this.uDust.mul(1.1))).mul(float(1).add(this.uStorm.mul(this.uStorm).mul(27)));
      const amount = density.mul(exp(cameraPosition.y.sub(this.uFogBase).mul(b).negate())).mul(dist).mul(ratio).toVar();
      // terrain behind the approaching dust wall disappears into it
      amount.addAssign(this.wall(vec3(rd.x, 0.0, rd.z)).mul(smoothstep(120, 650, dist)).mul(5));
      return clamp(float(1).sub(exp(amount.negate())), 0, 1);
    });
    const color = Fn(() => {
      const rd = normalize(positionWorld.sub(cameraPosition));
      return this.haze(vec3(rd.x, max(rd.y, 0.0).mul(0.3), rd.z).normalize());
    });
    return fog(color(), factor());
  }

  /** XZ wind direction scaled by strength (for dust, grass, cloth). */
  get wind() {
    return new THREE.Vector2(this.windDir.x * this.windStrength, this.windDir.y * this.windStrength);
  }

  update(dt: number, focus: THREE.Vector3) {
    if (!this.paused) this.hour = (this.hour + (dt * 24) / (this.dayLengthMinutes * 60)) % 24;

    // slow weather drift: occasional dust haze
    this.dustTimer += dt;
    const target = 0.15 + 0.35 * Math.max(0, Math.sin(this.dustTimer * 0.011) * Math.sin(this.dustTimer * 0.027 + 2));
    this.dustiness = lerp(this.dustiness, Math.max(target, this.storm * 0.9), Math.min(1, dt * 0.2));
    const st = this.storm;
    // storms howl: much stronger wind with hard, irregular gusts
    const gusts = Math.sin(this.dustTimer * 0.9) * 0.6 + Math.sin(this.dustTimer * 2.3 + 1) * 0.35;
    this.windStrength = 0.45 + this.dustiness * 1.2 + 0.15 * Math.sin(this.dustTimer * 0.3) + st * (2.4 + gusts * 0.6);
    const wa = 0.4 + Math.sin(this.dustTimer * 0.004) * 0.5;
    this.windDir.set(Math.cos(wa), Math.sin(wa));
    (this.uUpwind.value as THREE.Vector2).set(-this.windDir.x, -this.windDir.y);

    // sun path
    const th = ((this.hour - 6) / 12) * Math.PI;
    const sunDir = this.uSunDir.value as THREE.Vector3;
    sunDir
      .copy(this.setDir)
      .multiplyScalar(-Math.cos(th))
      .addScaledVector(this.perp, 0.32 * Math.sin(th))
      .setY(Math.sin(th) * 0.92)
      .normalize();
    this.sunElevation = sunDir.y;
    const moonDir = this.uMoonDir.value as THREE.Vector3;
    moonDir.set(-sunDir.x * 0.6 + 0.2, Math.max(0.35, -sunDir.y), -sunDir.z * 0.6 + 0.3).normalize();

    // palette
    const e = clampN(sunDir.y, KEYS[0].e, KEYS[KEYS.length - 1].e);
    let i = 0;
    while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = smoothN(a.e, b.e, e);
    lerpColor(a.zenith, b.zenith, t, this.uZenith.value as THREE.Color);
    lerpColor(a.horizon, b.horizon, t, this.uHorizon.value as THREE.Color);
    lerpColor(a.haze, b.haze, t, this.uHaze.value as THREE.Color);
    lerpColor(a.sun, b.sun, t, this.sunColor);
    (this.uSunColor.value as THREE.Color).copy(this.sunColor);
    this.uFogDensity.value = lerp(a.fog, b.fog, t);
    this.envIntensity = lerp(a.env, b.env, t);
    this.exposure = lerp(a.exp, b.exp, t);
    this.uNight.value = smoothN(0.02, -0.2, sunDir.y);
    this.uDust.value = this.dustiness;
    this.uStorm.value = st;
    coneMurk.value = st;
    this.uFront.value = this.stormFront;
    this.uFogFalloff.value = lerp(0.018, 0.007, st);
    // storm dust colour follows the daylight: ochre by day, rust at dusk, deep umber at night
    const daylight = smoothN(-0.2, 0.25, sunDir.y);
    const sc = this.uStormColor.value as THREE.Color;
    sc.set('#a8642c').multiplyScalar(0.75 * daylight).lerp(tmpA.copy(this.sunColor).multiplyScalar(0.3 * daylight), 0.2);
    sc.add(tmpA.set('#2a2622').multiplyScalar(1 - daylight)); // night: dim grey-brown murk, still readable
    (this.uWind.value as THREE.Vector2).set(this.windDir.x * this.windStrength, this.windDir.y * this.windStrength);
    const sf = this.uSandFlow.value as THREE.Vector2;
    // wraps every 14*256 m: a whole number of atlas tiles along the stretched axis
    sf.set((sf.x + this.windDir.x * this.windStrength * dt * 4) % 3584, (sf.y + this.windDir.y * this.windStrength * dt * 4) % 3584);
    const cd = this.uCloudDrift.value as THREE.Vector2;
    const cw = Math.min(this.windStrength, 1.5) * dt * 0.004;
    cd.set((cd.x + this.windDir.x * cw) % 200, (cd.y + this.windDir.y * cw) % 200); // 200: whole atlas tiles for every tap

    // lights: sun by day, moon by night (one shadow-casting directional)
    const isDay = sunDir.y > -0.06;
    const lightDir = isDay ? sunDir : moonDir;
    this.sun.color.copy(this.sunColor);
    const horizonFade = isDay ? smoothN(-0.06, 0.04, sunDir.y) : smoothN(-0.06, -0.16, sunDir.y);
    this.sun.intensity = lerp(a.sunI, b.sunI, t) * Math.max(0.05, horizonFade) * (1 - this.dustiness * 0.35) * (1 - st * 0.93);
    if (!isDay) this.sun.color.set('#6f8cd0');
    this.sun.position.copy(focus).addScaledVector(lightDir, 300);
    this.sun.target.position.copy(focus);
    // texel-snap shadow camera to avoid shimmering
    this.sun.target.updateMatrixWorld();

    lerpColor(a.hemiSky, b.hemiSky, t, this.hemi.color);
    lerpColor(a.hemiGround, b.hemiGround, t, this.hemi.groundColor);
    this.hemi.intensity = lerp(a.hemiI, b.hemiI, t);
    if (st > 0) {
      // the sky light becomes the dust itself: flat, brown, directionless
      this.hemi.color.lerp(tmpB.copy(sc).multiplyScalar(1.6), st * 0.7);
      this.hemi.groundColor.lerp(tmpB.copy(sc).multiplyScalar(0.7), st * 0.5);
      this.hemi.intensity *= 1 + st * 0.6;
      this.envIntensity *= 1 - st * 0.55;
    }
    this.scene.environmentIntensity = this.envIntensity;
  }

  /** Keep sky dome centred on the camera. */
  follow(camera: THREE.Camera) {
    this.sky.position.copy(camera.position);
  }

  /** CSS colours for UI theming (e.g. map tint). */
  get hazeCss() {
    return '#' + (this.uHaze.value as THREE.Color).getHexString();
  }

  /** Utility for consumers wanting the current sky colour along a direction (CPU approx). */
  horizonColor(out = new THREE.Color()) {
    return out.copy(this.uHorizon.value as THREE.Color);
  }

  /** 0..1 how far one can see through the air (1 = clear). Used by stealth. */
  get visibility() {
    return 1 - this.storm * 0.65;
  }

  get isNight() {
    return (this.uNight.value as number) > 0.5;
  }

}
