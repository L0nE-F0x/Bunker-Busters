import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, uniform, screenUV, vec2, vec3, vec4, float, Fn, renderOutput,
  builtinAOContext, time, length, fract, sin, smoothstep, mix, dot, clamp, max, pow, convertToTexture,
  renderGroup, getViewPosition, normalize, acesFilmicToneMapping, abs,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { bilateralBlur } from 'three/addons/tsl/display/BilateralBlurNode.js';
import type { QualitySettings } from './renderer';
import { noise } from './noiseTex';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

const hash2 = (p: N) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));

/**
 * Time-of-day colour grade. The Atmosphere writes these every frame (warm, saturated golden hours;
 * crisp days; blue, slightly desaturated moonlight with warm practical lights left alone).
 */
export const gradeU = {
  /** multiplier on the darks / on the brights (split tone in scene-linear, before the tonemap) */
  shadow: uniform(new THREE.Color(0.9, 0.98, 1.08)).setGroup(renderGroup),
  high: uniform(new THREE.Color(1.06, 1.0, 0.92)).setGroup(renderGroup),
  /** extra contrast around mid grey (on top of the ACES curve) and display saturation */
  contrast: uniform(1.05).setGroup(renderGroup),
  sat: uniform(1.05).setGroup(renderGroup),
  /** display-space black lift (night: a little blue so the darks never go dead) */
  lift: uniform(new THREE.Color(0.004, 0.006, 0.01)).setGroup(renderGroup),
  /** 0..1 heat shimmer over distant ground near the horizon (hot, clear afternoons) */
  heat: uniform(0).setGroup(renderGroup),
};

/**
 * The "AAA look": HDR scene → ambient-only GTAO → phase-weighted godrays → exposure → bloom →
 * time-of-day split tone → ACES → saturation → SMAA → chromatic aberration, vignette, film grain,
 * and gameplay-driven overlays (damage flash, detection pulse, EMP static).
 */
export class PostFX {
  pipeline: THREE.RenderPipeline;
  // live-tweakable uniforms
  readonly exposure = uniform(1.0);
  readonly vignette = uniform(0.32);
  readonly grain = uniform(0.045);
  readonly aberration = uniform(0.0007);
  readonly damage = uniform(0); // 0..1 red flash
  readonly alert = uniform(0); // 0..1 detection pulse
  readonly emp = uniform(0); // 0..1 EMP static
  readonly fade = uniform(0); // 0..1 fade to black
  readonly menuShade = uniform(0); // 0..1 left-side darkening behind menus
  readonly saturation = uniform(1.0);
  readonly bloomStrength = uniform(0.55);
  readonly godrayColor = uniform(new THREE.Color(1.0, 0.62, 0.35));
  readonly godrayStrength = uniform(0.35);
  /** debug handle: `game.post.gradeU` */
  readonly gradeU = gradeU;
  /** direction toward the shadow-casting light (sun by day, moon by night), refreshed per frame */
  private readonly uLightDir = uniform(new THREE.Vector3(0, 1, 0));

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
    const camW = uniform(camera.matrixWorld), projInv = uniform(camera.projectionMatrixInverse);

    if (quality.godrays) {
      const gr: N = godrays(sceneDepth, camera, this.sun);
      gr.raymarchSteps.value = quality.level === 'ultra' ? 72 : 48;
      gr.density.value = 0.55;
      gr.maxDensity.value = 0.55;
      gr.distanceAttenuation.value = 1.2;
      this.godraysNode = gr;
      const blurred: N = bilateralBlur(gr.getTextureNode()).getTextureNode();
      // additive in-scatter: shafts brighten, occluded air stays clear. Weighted by a forward-scatter
      // phase around the light: the raw march is just "how much lit air", which without a phase
      // laid a flat milky veil over every view (noon included) instead of shafts toward the sun.
      const vdir = normalize(camW.mul(vec4(getViewPosition(screenUV, float(0.5), projInv), 0)).xyz);
      const mu = max(dot(vdir, this.uLightDir), 0);
      const phase = float(0.16).add(pow(mu, 2).mul(0.3)).add(pow(mu, 10).mul(1.6));
      hdr = convertToTexture(hdr.add(vec4(this.godrayColor.mul(blurred.r).mul(this.godrayStrength).mul(phase), 0)));
    } else {
      this.godraysNode = null;
    }

    // exposure first, so the bloom threshold means the same thing at noon and at midnight
    hdr = hdr.mul(this.exposure);
    if (quality.bloom) {
      const b: N = bloom(hdr, 0.55, 0.5, 1.1);
      b.strength = this.bloomStrength;
      b.smoothWidth.value = 0.9;
      this.bloomNode = b;
      hdr = hdr.add(b);
    }

    const graded = this.grade(hdr);
    // the tonemap happens inside grade(); renderOutput only encodes to sRGB
    let ldr: N = renderOutput(graded, THREE.NoToneMapping, THREE.SRGBColorSpace);
    if (quality.smaa) ldr = smaa(ldr);
    this.pipeline.outputNode = this.finish(convertToTexture(ldr), sceneDepth, camW, projInv);
    this.pipeline.needsUpdate = true;
  }

  /**
   * Scene-linear split tone (time-of-day tints from `gradeU`) and a contrast pivot at mid grey, then
   * ACES, display saturation and a black lift. Returns display-linear colour (sRGB encoding follows).
   */
  private grade(hdr: N): N {
    const sat = this.saturation;
    const G = gradeU as Record<keyof typeof gradeU, N>;
    const luma = (v: N) => dot(v, vec3(0.2126, 0.7152, 0.0722));
    return Fn(() => {
      const c = vec3(hdr.rgb).toVar();
      const l = luma(c);
      // 0 in the darks, 0.5 at mid grey, → 1 in the highlights
      const k = l.div(l.add(0.18));
      const tint: N = mix(G.shadow, G.high, k);
      c.assign(c.mul(tint.div(max(luma(tint), 0.05))));
      // contrast around mid grey, hue-preserving (scales the colour by its own luma)
      c.assign(c.mul(pow(max(l, 1e-4).div(0.18), G.contrast.sub(1))));
      const d: N = (acesFilmicToneMapping as N)(c, float(1)).toVar();
      // low light loses colour (night grades desaturate), but lights keep theirs: fire stays orange
      const ld = luma(d);
      const satK = mix(G.sat, max(G.sat, float(1.05)), smoothstep(0.15, 0.6, ld));
      d.assign(max(mix(vec3(ld), d, satK.mul(sat)), 0));
      d.assign(d.add(G.lift.mul(float(1).sub(d))));
      return vec4(d, 1);
    })();
  }

  /** Lens + gameplay overlays in display space (plus the heat shimmer, folded into the CA taps). */
  private finish(ldr: N, depth: N, camW: N, projInv: N): N {
    const { vignette, grain, aberration, damage, alert, emp, fade, menuShade } = this;
    const heat = gradeU.heat as N;
    return Fn(() => {
      // heat shimmer: distant ground (and the horizon line) wobbles over hot sand. Distance and ray
      // elevation come from the scene depth; the wobble is a vertically stretched, rising noise.
      const vp = getViewPosition(screenUV, depth.sample(screenUV).r, projInv);
      const rdY = normalize(camW.mul(vec4(vp, 0)).xyz).y;
      const hz = smoothstep(130, 450, length(vp)).mul(smoothstep(0.09, 0.0, abs(rdY.add(0.01))));
      const w = noise(vec2(screenUV.x.mul(26), screenUV.y.mul(64).sub(time.mul(0.9)))).r.sub(0.5);
      const w2 = noise(vec2(screenUV.x.mul(11).add(0.3), screenUV.y.mul(23).sub(time.mul(0.5)))).g.sub(0.5);
      const shimmer = vec2(w2.mul(0.35), w.add(w2.mul(0.5))).mul(0.0035).mul(hz).mul(heat);
      const uv = screenUV.add(shimmer);
      const centered = uv.sub(0.5);
      const r = length(centered);
      // radial chromatic aberration, pumped by EMP + damage
      const ca = aberration.add(emp.mul(0.006)).add(damage.mul(0.004));
      const dir = centered.mul(r.mul(r)).mul(ca.mul(14));
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

      // vignette: a neutral optical falloff (a warm tint here once turned a silver moon peach)
      const v = smoothstep(0.9, 0.25, r.mul(float(1).add(vignette)));
      col.assign(col.mul(mix(vec3(0.52, 0.5, 0.5), vec3(1), v)));

      // alert pulse: amber edges; damage: red edges
      const edge = smoothstep(0.25, 0.75, r);
      const pulse = float(0.6).add(time.mul(9).sin().mul(0.4));
      col.assign(mix(col, vec3(1.0, 0.45, 0.08), edge.mul(alert).mul(pulse).mul(0.55)));
      col.assign(mix(col, vec3(0.75, 0.02, 0.02), edge.mul(damage).mul(0.8)));

      // film grain (luma-weighted so blacks stay clean-ish)
      const g = hash2(uv.mul(vec2(1280.0, 720.0)).floor().mul(0.731).add(time.fract().mul(431.0))).sub(0.5);
      const lum = dot(col, vec3(0.3, 0.59, 0.11));
      col.addAssign(g.mul(grain).mul(float(0.35).add(pow(max(float(1).sub(lum), 0.0), 2.0))));

      // menu legibility: darken the left of the frame (replaces a full-screen CSS gradient layer)
      const shade = smoothstep(0.65, 0.0, uv.x).mul(0.82).mul(menuShade);
      col.assign(col.mul(float(1).sub(shade)));
      col.assign(col.mul(float(1).sub(fade)));
      return vec4(clamp(col, 0, 1), 1);
    })();
  }

  render() {
    (this.uLightDir.value as THREE.Vector3).subVectors(this.sun.position, this.sun.target.position).normalize();
    this.pipeline.render();
  }

  dispose() {
    this.pipeline.dispose();
  }
}
