import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, uniform, instanceIndex, hash, time, cameraPosition, fract, uv, length, smoothstep, mix, max,
  pow, dot, normalize, sin, positionLocal, positionWorld, texture, color, clamp,
  normalWorld, abs, viewportLinearDepth, linearDepth, cameraNear, cameraFar,
} from 'three/tsl';
import type { Atmosphere } from './Atmosphere';
import type { Heightfield } from './Heightfield';
import { noise } from '@/engine/noiseTex';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/** Half-float height texture so GPU effects can hug the terrain. */
export function heightTexture(hf: Heightfield) {
  const S = 256;
  const data = new Uint16Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const wx = ((x + 0.5) / S - 0.5) * hf.size;
      const wz = ((y + 0.5) / S - 0.5) * hf.size;
      data[y * S + x] = THREE.DataUtils.toHalfFloat(hf.heightAt(wx, wz));
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Sun-lit floating dust motes. Positions are generated entirely on the GPU from instanceIndex and
 * wrap around the camera, so there is zero CPU cost per particle.
 */
export class DustMotes {
  sprite: THREE.Sprite;
  readonly uWindOffset = uniform(new THREE.Vector3());
  private offset = new THREE.Vector3();

  constructor(private atmo: Atmosphere, count: number, boxSize = 36) {
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const B = float(boxSize);
    const seed = vec3(hash(instanceIndex), hash(instanceIndex.add(7919)), hash(instanceIndex.add(15485)));
    const wobble = vec3(
      sin(time.mul(0.7).add(seed.y.mul(30))).mul(0.6),
      sin(time.mul(0.5).add(seed.z.mul(30))).mul(0.4),
      sin(time.mul(0.6).add(seed.x.mul(30))).mul(0.6),
    );
    const local = fract(seed.add(this.uWindOffset.div(B)).add(wobble.div(B))).sub(0.5).mul(B);
    const pos = cameraPosition.add(local);
    mat.positionNode = pos;
    const size = hash(instanceIndex.add(3)).mul(0.035).add(0.012);
    mat.scaleNode = vec2(size, size);

    const sunDir = atmo.uSunDir;
    mat.colorNode = Fn(() => {
      const d = length(uv().sub(0.5)).mul(2);
      const soft = smoothstep(1, 0.0, d);
      const view = normalize(pos.sub(cameraPosition));
      const mu = max(dot(view, sunDir), 0);
      const phase = pow(mu, 8).mul(6).add(0.25);
      const fade = smoothstep(B.mul(0.5), B.mul(0.2), length(local)).mul(smoothstep(0.3, 1.5, length(local)));
      const night = float(1).sub(atmo.uNight.mul(0.8));
      const c = atmo.uSunColor.mul(phase).add(atmo.uHaze.mul(0.4)).mul(night);
      return vec4(c.mul(soft).mul(fade).mul(0.35), 1);
    })();
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = count;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 10;
  }

  update(dt: number) {
    const w = this.atmo.wind;
    this.offset.x += w.x * dt * 2.2;
    this.offset.z += w.y * dt * 2.2;
    this.offset.y += Math.sin(performance.now() * 0.0002) * dt * 0.2;
    (this.uWindOffset.value as THREE.Vector3).copy(this.offset);
  }
}

/** Big soft sand clouds that drift low over the ground with the wind. Soft-particle depth fade. */
export class GroundHaze {
  sprite: THREE.Sprite;
  readonly uOffset = uniform(new THREE.Vector2());
  private offset = new THREE.Vector2();

  constructor(private atmo: Atmosphere, hf: Heightfield, heightTex: THREE.Texture, count = 160) {
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    const R = float(150);
    const seed = vec3(hash(instanceIndex.add(11)), hash(instanceIndex.add(101)), hash(instanceIndex.add(1009)));
    const lxz = fract(seed.xy.add(this.uOffset.div(R.mul(2)))).sub(0.5).mul(R.mul(2));
    const wxz = cameraPosition.xz.add(lxz);
    const hUv = wxz.div(hf.size).add(0.5);
    const ground = texture(heightTex, hUv).r;
    const size = seed.z.mul(10).add(6);
    const pos = vec3(wxz.x, ground.add(size.mul(0.28)), wxz.y);
    mat.positionNode = pos;
    mat.scaleNode = vec2(size.mul(1.6), size.mul(0.7));
    mat.rotationNode = seed.x.mul(6.28);

    mat.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(2);
      const n = noise(p.mul(0.35).add(seed.xy.mul(10)).add(time.mul(0.01))).r.sub(0.5).mul(1.6);
      const shape = smoothstep(1.0, 0.2, length(p).add(n.mul(0.5)));
      const dist = length(lxz);
      const fade = smoothstep(R, R.mul(0.6), dist).mul(smoothstep(4, 18, dist));
      // soft particles
      const sceneDepth = viewportLinearDepth;
      const fragDepth = linearDepth();
      const soft = clamp(sceneDepth.sub(fragDepth).mul(cameraFar.sub(cameraNear)).div(3), 0, 1);
      const view = normalize(pos.sub(cameraPosition));
      const mu = max(dot(view, atmo.uSunDir), 0);
      const lit = atmo.uHaze.mul(0.9).add(atmo.uSunColor.mul(pow(mu, 4).mul(0.6)));
      const a = shape.mul(fade).mul(soft).mul(atmo.uDust.mul(0.22).add(0.04));
      return vec4(lit, a);
    })();
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = count;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 11;
  }

  update(dt: number) {
    const w = this.atmo.wind;
    this.offset.x += w.x * dt * 5;
    this.offset.y += w.y * dt * 5;
    (this.uOffset.value as THREE.Vector2).copy(this.offset);
  }
}

/** Crossed-billboard fire with scrolling noise, embers and a flickering point light. */
export class Fire {
  group = new THREE.Group();
  light: THREE.PointLight;
  private t = Math.random() * 10;

  constructor(scale = 1, lightIntensity = 30) {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    mat.colorNode = Fn(() => {
      const p = uv();
      const n = noise(vec2(p.x.mul(0.6), p.y.mul(0.45).sub(time.mul(0.5)))).r.sub(0.5).mul(1.8);
      const shapeX = abs(p.x.sub(0.5)).mul(2);
      const flame = smoothstep(0.0, 0.7, float(1).sub(shapeX.mul(float(1.3).add(p.y.mul(1.5)))).sub(p.y.mul(0.8)).add(n.mul(0.6)));
      const core = pow(flame, 3);
      const col = mix(vec3(1.0, 0.25, 0.03), vec3(1.0, 0.75, 0.3), core).mul(flame.mul(9));
      return vec4(col, flame);
    })();
    const geo = new THREE.PlaneGeometry(1.1 * scale, 1.6 * scale);
    geo.translate(0, 0.8 * scale, 0);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.y = (i / 3) * Math.PI;
      this.group.add(m);
    }
    // embers
    const em = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const life = fract(time.mul(0.35).add(hash(instanceIndex)));
    const ex = sin(time.mul(1.3).add(hash(instanceIndex.add(5)).mul(20))).mul(0.4).mul(life);
    const ez = sin(time.mul(1.1).add(hash(instanceIndex.add(9)).mul(20))).mul(0.4).mul(life);
    em.positionNode = vec3(ex.add(hash(instanceIndex.add(1)).sub(0.5).mul(0.6)), life.mul(4 * scale), ez);
    em.scaleNode = vec2(0.04 * scale, 0.04 * scale);
    em.colorNode = vec4(vec3(1.0, 0.45, 0.1).mul(float(8).mul(float(1).sub(life))), smoothstep(1, 0.6, life));
    const embers = new THREE.Sprite(em);
    embers.count = 60;
    this.group.add(embers);

    // stone ring
    const stone = new THREE.MeshStandardNodeMaterial({ color: '#4a4440', roughness: 0.9, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 * scale, 0), stone);
      s.position.set(Math.cos(a) * 0.65 * scale, 0.08, Math.sin(a) * 0.65 * scale);
      s.rotation.set(a, a * 2, 0);
      s.castShadow = true;
      this.group.add(s);
    }
    const logMat = new THREE.MeshStandardNodeMaterial({ color: '#1a120c', roughness: 1 });
    logMat.emissiveNode = color('#ff4a10').mul(noise(positionWorld.xz.mul(0.8).add(time.mul(0.1))).r.sub(0.5).mul(2).mul(0.5).add(0.5).mul(1.5));
    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * scale, 0.08 * scale, 0.9 * scale, 6), logMat);
      log.rotation.set(Math.PI / 2 - 0.3, (i / 4) * Math.PI * 2, 0);
      log.position.y = 0.15;
      this.group.add(log);
    }

    this.light = new THREE.PointLight(0xff8a3a, lightIntensity, 22, 1.6);
    this.light.position.y = 1.2 * scale;
    this.group.add(this.light);
    this.baseIntensity = lightIntensity;
  }

  private baseIntensity: number;

  update(dt: number) {
    this.t += dt;
    const f = 0.75 + Math.sin(this.t * 13) * 0.08 + Math.sin(this.t * 7.3) * 0.1 + Math.sin(this.t * 23.1) * 0.06;
    this.light.intensity = this.baseIntensity * f;
    this.light.position.x = Math.sin(this.t * 5) * 0.05;
  }
}

/** Additive cone of light for spotlights (drone, floodlights) with drifting dust inside. */
export function lightCone(length: number, radius: number, c: THREE.ColorRepresentation, intensity = 0.6) {
  const geo = new THREE.ConeGeometry(radius, length, 32, 1, true);
  geo.translate(0, -length / 2, 0);
  const uIntensity = uniform(intensity);
  const uColor = uniform(new THREE.Color(c));
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  mat.colorNode = Fn(() => {
    const along = positionLocal.y.negate().div(length); // 0 at tip, 1 at base
    const v = normalize(cameraPosition.sub(positionWorld));
    const facing = abs(dot(normalWorld, v));
    const n = noise(positionWorld.xz.add(positionWorld.y).mul(0.12).add(time.mul(0.02))).r.sub(0.5).mul(2);
    const a = pow(facing, 2.0).mul(smoothstep(1.0, 0.05, along)).mul(smoothstep(0.0, 0.08, along)).mul(n.mul(0.35).add(0.75));
    return vec4((uColor as N).mul(a).mul(uIntensity), 1);
  })();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 20;
  return { mesh, intensity: uIntensity, color: uColor };
}

/** Expanding EMP shockwave sphere. */
export class Shockwave {
  mesh: THREE.Mesh;
  private t = 0;
  private uT = uniform(0);
  done = false;

  constructor(pos: THREE.Vector3, private radius = 8) {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const t = this.uT;
    mat.colorNode = Fn(() => {
      const v = normalize(cameraPosition.sub(positionWorld));
      const rimF = pow(float(1).sub(abs(dot(normalWorld, v))), 2.5);
      const n = noise(positionWorld.xz.add(positionWorld.y).mul(0.3).add(time.mul(0.6))).r.sub(0.5).mul(2);
      const a = rimF.mul(float(1).sub(t)).mul(n.mul(0.5).add(0.8));
      return vec4(vec3(0.35, 0.8, 1.0).mul(a).mul(6), 1);
    })();
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    this.mesh.position.copy(pos);
    this.mesh.scale.setScalar(0.1);
  }

  update(dt: number) {
    this.t += dt / 0.7;
    this.uT.value = Math.min(this.t, 1);
    const e = 1 - Math.pow(1 - Math.min(this.t, 1), 3);
    this.mesh.scale.setScalar(0.1 + e * this.radius);
    if (this.t >= 1) this.done = true;
  }
}

