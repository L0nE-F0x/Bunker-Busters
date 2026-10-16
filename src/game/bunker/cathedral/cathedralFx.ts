import * as THREE from 'three/webgpu';
import { Fn, vec4, float, uniform, texture, uv, smoothstep, time, sin, positionWorld, mix, normalWorld, cameraPosition, normalize, dot, abs, pow } from 'three/tsl';
import { roseTexture } from './cathedralAtlas';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/** How lit the Cathedral is from inside (0 dark … 1): the rose window and the clerestory. */
export const uCathGlow = uniform(0);
/** The floor's state colour on the clerestory: 0 normal amber … 1 alarm red. */
export const uCathAlarm = uniform(0);

/**
 * The rose window: the clock in coloured glass. By day it's glass seen from outside (the colours,
 * darkened, a little sky sheen); by night the hall's light comes through it (`uCathGlow`).
 */
export function roseMaterial() {
  const tex = roseTexture();
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.25, metalness: 0.1 });
  const t: N = texture(tex);
  m.colorNode = t.rgb.mul(0.55);
  m.emissiveNode = t.rgb.mul(t.rgb).mul(uCathGlow.mul(2.6).add(0.15));
  return m;
}

/**
 * The clerestory and aisle windows: frosted panes, warm by night, pulsing red under an alarm. They're
 * opaque (the hall is a sealed interior), so they read as lit glass from both sides.
 */
export function paneMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ color: '#8f8a80', roughness: 0.35, metalness: 0.05 });
  const warm = vec4(1.0, 0.62, 0.28, 1).xyz;
  const red = vec4(1.0, 0.16, 0.08, 1).xyz;
  const pulse = sin(time.mul(5)).mul(0.5).add(0.5);
  // a soft vertical gradient (brighter low, where the floor lights are) and the alarm's pulse
  const grad = smoothstep(0.0, 1.0, uv().y).mul(-0.35).add(1);
  m.emissiveNode = (mix(warm, red, uCathAlarm.mul(pulse)) as N).mul(uCathGlow.mul(1.6).add(0.02)).mul(grad);
  return m;
}

/**
 * A downward searchlight for each drone (instanced): an open cone, additive, fading toward the ground
 * and at its edge. `level` (instance attribute via the matrix scale) is the runtime's.
 */
export function beamMaterial() {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, forceSinglePass: true });
  m.colorNode = Fn(() => {
    const along = uv().y; // 1 at the lamp, 0 at the ground
    // thick through the middle of the beam, nothing at its silhouette (the light is a volume, not a shell)
    const facing = abs(dot(normalWorld, normalize(cameraPosition.sub(positionWorld))));
    const a = smoothstep(0.0, 0.9, along).mul(0.045).add(0.006).mul(smoothstep(0.0, 0.1, along)).mul(pow(facing, 2.0));
    const flick = float(0.92).add(sin(time.mul(13).add(positionWorld.x)).mul(0.04));
    return vec4(vec4(1.0, 0.86, 0.62, 1).xyz.mul(a).mul(flick), 1);
  })();
  return m;
}
