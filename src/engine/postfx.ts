import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, uniform, screenUV, vec2, vec3, vec4, float, Fn, renderOutput,
  builtinAOContext, time, length, fract, sin, smoothstep, mix, dot, clamp, max, pow, convertToTexture,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { bilateralBlur } from 'three/addons/tsl/display/BilateralBlurNode.js';
import type { QualitySettings } from './renderer';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

const hash2 = (p: N) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));

/**
 * The "AAA look": HDR scene → ambient-only GTAO → raymarched godrays → bloom → split-tone grade →
 * ACES → SMAA → chromatic aberration, vignette, film grain, and gameplay-driven overlays
 * (damage flash, detection pulse, EMP static).
 */
export class PostFX {
  pipeline: THREE.RenderPipeline;
  // live-tweakable uniforms
  readonly exposure = uniform(1.0);
  readonly vignette = uniform(0.32);
  readonly grain = uniform(0.045);
  readonly aberration = uniform(0.0016);
  readonly damage = uniform(0); // 0..1 red flash
  readonly alert = uniform(0); // 0..1 detection pulse
  readonly emp = uniform(0); // 0..1 EMP static
  readonly fade = uniform(0); // 0..1 fade to black
  readonly saturation = uniform(1.08);
  readonly bloomStrength = uniform(0.55);
  readonly godrayColor = uniform(new THREE.Color(1.0, 0.62, 0.35));
  readonly godrayStrength = uniform(0.35);

  bloomNode: N = null;
  godraysNode: N = null;

  constructor(
    renderer: THREE.WebGPURenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private sun: THREE.DirectionalLight,
    private quality: QualitySettings,
  ) {
    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputColorTransform = false;
    this.build();
  }

  setQuality(q: QualitySettings) {
    this.quality = q;
    this.build();
  }

  private build() {
    const { scene, camera, quality } = this;

    const scenePass: N = pass(scene, camera);
    scenePass.setMRT(mrt({ output }));
    const sceneDepth: N = scenePass.getTextureNode('depth');

    if (quality.ao) {
      const prePass: N = pass(scene, camera);
      prePass.setMRT(mrt({ output: normalView }));
      prePass.transparent = false;
      const aoPass: N = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera);
      aoPass.resolutionScale = 0.5;
      aoPass.radius.value = 0.6;
      aoPass.thickness.value = 1.2;
      aoPass.distanceFallOff.value = 0.8;
      scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
    }

    let hdr: N = scenePass.getTextureNode('output');

    if (quality.godrays) {
      const gr: N = godrays(sceneDepth, camera, this.sun);
      gr.raymarchSteps.value = quality.level === 'ultra' ? 72 : 48;
      gr.density.value = 0.55;
      gr.maxDensity.value = 0.55;
      gr.distanceAttenuation.value = 1.2;
      this.godraysNode = gr;
      const blurred: N = bilateralBlur(gr.getTextureNode()).getTextureNode();
      // additive in-scatter: shafts brighten, occluded air stays clear
      hdr = convertToTexture(hdr.add(vec4(this.godrayColor.mul(blurred.r).mul(this.godrayStrength), 0)));
    } else {
      this.godraysNode = null;
    }

    if (quality.bloom) {
      const b: N = bloom(hdr, 0.55, 0.45, 0.82);
      b.strength = this.bloomStrength;
      this.bloomNode = b;
      hdr = hdr.add(b);
    }

    const graded = this.grade(hdr);
    let ldr: N = renderOutput(graded, THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);
    if (quality.smaa) ldr = smaa(ldr);
    this.pipeline.outputNode = this.finish(convertToTexture(ldr));
    this.pipeline.needsUpdate = true;
  }

  /** Split-tone "orange & teal" grade in linear HDR, before tonemapping. */
  private grade(hdr: N): N {
    const exposure = this.exposure;
    const sat = this.saturation;
    return Fn(() => {
      const c = vec3(hdr.rgb).mul(exposure).toVar();
      const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // shadows → teal, highlights → amber
      const shadowTint = vec3(0.86, 1.0, 1.08);
      const highTint = vec3(1.08, 0.99, 0.88);
      const k = smoothstep(0.02, 1.2, l);
      c.assign(c.mul(mix(shadowTint, highTint, k)));
      // saturation around luma
      const l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c.assign(mix(vec3(l2), c, sat));
      // gentle filmic toe lift so blacks never go fully dead
      c.assign(c.add(vec3(0.004, 0.006, 0.008)));
      return vec4(c, 1);
    })();
  }

  /** Lens + gameplay overlays in display space. */
  private finish(ldr: N): N {
    const { vignette, grain, aberration, damage, alert, emp, fade } = this;
    return Fn(() => {
      const uv = screenUV;
      const centered = uv.sub(0.5);
      const r = length(centered);
      // radial chromatic aberration, pumped by EMP + damage
      const ca = aberration.add(emp.mul(0.006)).add(damage.mul(0.004));
      const dir = centered.mul(r).mul(ca.mul(6));
      const col = vec3(
        ldr.sample(uv.sub(dir)).r,
        ldr.sample(uv).g,
        ldr.sample(uv.add(dir)).b,
      ).toVar();

      // EMP static: horizontal tearing + noise bands
      const band = hash2(vec2(uv.y.mul(240).floor(), time.mul(60).floor()));
      const tear = smoothstep(0.92, 1.0, band).mul(emp);
      const torn = ldr.sample(uv.add(vec2(tear.mul(0.04), 0))).rgb;
      col.assign(mix(col, torn, tear));
      const staticNoise = hash2(uv.mul(vec2(1920, 1080)).floor().add(time.mul(97.0).fract().mul(113.0)));
      col.assign(mix(col, vec3(staticNoise).mul(vec3(0.7, 0.95, 1.0)), emp.mul(0.18)));

      // vignette (slightly warm in the corners)
      const v = smoothstep(0.85, 0.2, r.mul(float(1).add(vignette)));
      col.assign(col.mul(mix(vec3(0.55, 0.42, 0.36), vec3(1), v)));

      // alert pulse: amber edges; damage: red edges
      const edge = smoothstep(0.25, 0.75, r);
      const pulse = float(0.6).add(time.mul(9).sin().mul(0.4));
      col.assign(mix(col, vec3(1.0, 0.45, 0.08), edge.mul(alert).mul(pulse).mul(0.55)));
      col.assign(mix(col, vec3(0.75, 0.02, 0.02), edge.mul(damage).mul(0.8)));

      // film grain (luma-weighted so blacks stay clean-ish)
      const g = hash2(uv.mul(vec2(1280.0, 720.0)).floor().mul(0.731).add(time.fract().mul(431.0))).sub(0.5);
      const lum = dot(col, vec3(0.3, 0.59, 0.11));
      col.addAssign(g.mul(grain).mul(float(0.35).add(pow(max(float(1).sub(lum), 0.0), 2.0))));

      col.assign(col.mul(float(1).sub(fade)));
      return vec4(clamp(col, 0, 1), 1);
    })();
  }

  render() {
    this.pipeline.render();
  }

  dispose() {
    this.pipeline.dispose();
  }
}
