import * as THREE from 'three/webgpu';
import { int, textureSize } from 'three/tsl';
import { isMobile } from './device';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  level: QualityLevel;
  pixelRatio: number;
  shadowMapSize: number;
  ao: boolean;
  godrays: boolean;
  bloom: boolean;
  smaa: boolean;
  dustCount: number;
  grassDensity: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, Omit<QualitySettings, 'level'>> = {
  low: { pixelRatio: 0.75, shadowMapSize: 1024, ao: false, godrays: false, bloom: true, smaa: false, dustCount: 1200, grassDensity: 0.35 },
  medium: { pixelRatio: 1, shadowMapSize: 2048, ao: false, godrays: true, bloom: true, smaa: true, dustCount: 2500, grassDensity: 0.6 },
  high: { pixelRatio: 1, shadowMapSize: 4096, ao: true, godrays: true, bloom: true, smaa: true, dustCount: 4000, grassDensity: 1 },
  ultra: { pixelRatio: 1.5, shadowMapSize: 4096, ao: true, godrays: true, bloom: true, smaa: true, dustCount: 6000, grassDensity: 1.3 },
};

const RES = (() => { const m = /^(\d+)x(\d+)$/.exec(new URLSearchParams(location.search).get('res') ?? ''); return m ? [+m[1], +m[2]] : null; })();
/** Debug: ?pr=1.25 caps the device pixel ratio the canvas renders at. */
const PR_CAP = Number(new URLSearchParams(location.search).get('pr')) || Infinity;

/**
 * Phones have 2.5–3.5× screens and a fraction of a desktop GPU's fill rate, so render well under
 * native resolution there; the post stack (SMAA, grain) hides the upscale.
 */
const MOBILE_PR: Record<QualityLevel, number> = { low: 1.25, medium: 1.5, high: 2, ultra: 2.5 };

export function makeQuality(level: QualityLevel): QualitySettings {
  const p = QUALITY_PRESETS[level];
  const dpr = Math.min(window.devicePixelRatio || 1, PR_CAP);
  if (isMobile) {
    const mobile = { ...p, smaa: true, shadowMapSize: Math.min(p.shadowMapSize, 2048), dustCount: Math.round(p.dustCount * 0.6), grassDensity: p.grassDensity * 0.7 };
    return { level, ...mobile, pixelRatio: Math.min(dpr, MOBILE_PR[level]) };
  }
  return { level, ...p, pixelRatio: Math.min(dpr, p.pixelRatio * Math.max(1, dpr)) };
}

// Remembered backend choice for this browser. v3 invalidates choices made by older builds.
const BACKEND_KEY = 'bunker-busters.backend.v3';
type BackendChoice = 'webgpu-high' | 'webgpu-low' | 'webgl';
const CHAIN: BackendChoice[] = ['webgpu-high', 'webgpu-low', 'webgl'];

function storedChoice(): BackendChoice {
  try {
    const v = localStorage.getItem(BACKEND_KEY) as BackendChoice | null;
    return v && CHAIN.includes(v) ? v : 'webgpu-high';
  } catch {
    return 'webgpu-high';
  }
}

/** Move one step down the chain and reload (called when the current backend proves broken). */
function demote(from: BackendChoice, reason: string) {
  const next = CHAIN[Math.min(CHAIN.length - 1, CHAIN.indexOf(from) + 1)];
  console.warn(`[BunkerBusters] ${from} failed (${reason}) — switching to ${next}.`);
  try { localStorage.setItem(BACKEND_KEY, next); } catch { /* ignore */ }
  location.reload();
}

/**
 * Sizes the drawing buffer in device pixels. On WebGPU the buffer is rounded UP to 64 px wide /
 * 128 rows high and the overflow is cropped off-screen (centred). Reason: on hybrid-GPU Linux the
 * NVIDIA-rendered swapchain image is imported by the Intel-side compositor, which requires
 * 128-row-aligned allocations; unaligned sizes (1280×720, 1920×1080…) fail with
 * "Requested allocation size … is smaller than the image requires". Aligned sizes work everywhere.
 */
export function fitCanvas(renderer: THREE.WebGPURenderer, canvas: HTMLCanvasElement, pixelRatio: number, align: boolean) {
  // debug: ?res=1890x1138 renders that buffer whatever the window (GPU load of a big window in a
  // small one: separates the GPU's share of a frame from the webview's compositing)
  const vw = RES ? RES[0] : window.innerWidth, vh = RES ? RES[1] : window.innerHeight;
  let w = Math.max(64, Math.round(vw * pixelRatio));
  let h = Math.max(64, Math.round(vh * pixelRatio));
  if (align) {
    w = Math.ceil(w / 64) * 64;
    h = Math.ceil(h / 128) * 128;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  // CSS size so that one buffer pixel maps to 1/pixelRatio CSS px; overflow is split evenly and hidden
  const cssW = w / pixelRatio, cssH = h / pixelRatio;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.style.left = `${(vw - cssW) / 2}px`;
  canvas.style.top = `${(vh - cssH) / 2}px`;
  return { width: w, height: h, aspect: w / h };
}

/**
 * Three's shadow pass draws every caster with one shared override material and copies each caster's
 * `alphaTest` onto it. Material's alphaTest setter bumps `version` whenever the value crosses 0, and a
 * version change makes every later shadow render object re-derive its material cache key (a walk of
 * the whole node graph, ~9 KB of garbage each). One alpha-tested caster in the sun's box (a site's
 * cut-out atlas) meant two bumps a frame: every caster, every frame (0.44 ms + 440 KB/frame in
 * Chrome inside the Garage). Each caster has its own shadow render object whose cache key already
 * includes its alpha test, so on that material the bump only costs. This removes it there, nowhere else.
 */
function quietShadowAlphaTest(renderer: THREE.WebGPURenderer) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = renderer as any;
  if (typeof r.renderObject !== 'function') return;
  const patched = new WeakSet<object>();
  const renderObject = r.renderObject;
  r.renderObject = function (object: THREE.Object3D, scene: THREE.Scene, ...rest: unknown[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = scene.overrideMaterial as any;
    if (m && m.isShadowPassMaterial && !patched.has(m)) {
      patched.add(m);
      let a = m.alphaTest;
      Object.defineProperty(m, 'alphaTest', { get: () => a, set: (v: number) => { a = v; }, configurable: true });
    }
    return renderObject.call(this, object, scene, ...rest);
  };
}

/**
 * WebGL2: one bufferSubData per uniform-block update, not one per changed uniform. Three writes each
 * changed uniform's slot as its own range (merging only neighbours), and every program's "render"
 * block (camera, sun, fog, time: ~80 uniforms, ~30 of them changing each render) is refreshed for
 * the shadow pass and again for the scene pass: ~1,350 tiny GL calls a frame in a firefight. In
 * WebKitGTK every GL call is a validated round trip, so the count is what costs, not the bytes.
 * Uploading the span from the first changed slot to the last is the same data (the CPU copy holds
 * every current value) in one call: ~1.5 KB instead of 30 calls of 16-64 bytes.
 */
function coalesceUniformUploads(renderer: THREE.WebGPURenderer) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const be = (renderer as any).backend;
  if (!be?.isWebGLBackend || typeof be.updateBinding !== 'function') return;
  const updateBinding = be.updateBinding;
  const span = { start: 0, count: 0 };
  be.updateBinding = function (binding: { updateRanges?: { start: number; count: number }[] }) {
    const r = binding.updateRanges;
    if (r && r.length > 1) {
      let lo = Infinity, hi = 0;
      for (const x of r) { if (x.start < lo) lo = x.start; if (x.start + x.count > hi) hi = x.start + x.count; }
      span.start = lo;
      span.count = hi - lo;
      // (the ranges are three's pooled per-uniform objects: swap the list, don't touch them;
      // Bindings clears the list right after this call)
      r.length = 0;
      r.push(span);
    }
    return updateBinding.call(this, binding);
  };
}

/**
 * WebGL2: no per-draw flip-Y uniform where the answer is settled. On WebGL three gives every
 * texture sample a `flipY` uniform (true for render targets, depth textures and flipped
 * ImageBitmaps) and a per-object update that refreshes it, and the texture's UV matrix, on every
 * draw: ~2,700 calls and as many uniform compares a frame at Dry Creek (the shadow map's PCF taps
 * and the PMREM's in every lit material, mostly), plus a select in the shader. A render target or
 * depth texture is always flipped and a plain image, canvas or data array never is, which is known
 * when the material is built (models and canvases load before the warm-up): those samples are built
 * with the flip baked in, the node never updates and its object uniforms shrink. Anything else
 * (flipped ImageBitmaps, a plain texture without an image yet) keeps three's path.
 * Also: a node that doesn't use the UV matrix no longer recomputes it (sin/cos) on every draw.
 */
function settleTextureFlips() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const TN = (THREE as any).TextureNode?.prototype;
  if (!TN || typeof TN.setupUV !== 'function' || typeof TN.update !== 'function') return;
  const setupUV = TN.setupUV;
  const hasBitmap = typeof ImageBitmap !== 'undefined';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TN.setupUV = function (builder: any, uvNode: any) {
    if (this._flipYUniform !== null || !builder.isFlipY?.()) return setupUV.call(this, builder, uvNode);
    const t = this.value as (THREE.Texture & { isRenderTargetTexture?: boolean; isFramebufferTexture?: boolean; isDepthTexture?: boolean }) | null;
    if (!t || !t.isTexture || (t as unknown as THREE.CubeTexture).isCubeTexture) return setupUV.call(this, builder, uvNode);
    const img = t.image as unknown;
    // render targets and depth (the post stack, the shadow map, the PMREM): always flipped. Their
    // nodes only ever swap one target for another (PMREM's placeholder is marked a target too).
    if (t.isRenderTargetTexture || t.isFramebufferTexture || t.isDepthTexture) {
      const v = uvNode.toVar();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return this.sampler ? v.flipY() : v.setY(int((textureSize(this, this.levelNode) as any).y).sub(v.y).sub(1));
    }
    // plain images, canvases and data: never flipped (an unflipped ImageBitmap included)
    if (img != null && !(hasBitmap && img instanceof ImageBitmap && t.flipY === true)) return uvNode;
    return setupUV.call(this, builder, uvNode);
  };
  // the UV matrix only changes with offset/repeat/rotation/center, and almost none ever move: skip
  // the sin/cos rebuild while they're unchanged
  const TX = THREE.Texture.prototype as THREE.Texture & { updateMatrix(): void };
  const updateMatrix = TX.updateMatrix;
  TX.updateMatrix = function (this: THREE.Texture & { _uvKey?: Float64Array }) {
    const o = this.offset, r = this.repeat, c = this.center;
    let k = this._uvKey;
    if (k && k[0] === o.x && k[1] === o.y && k[2] === r.x && k[3] === r.y && k[4] === this.rotation && k[5] === c.x && k[6] === c.y) return;
    k ??= this._uvKey = new Float64Array(7);
    k[0] = o.x; k[1] = o.y; k[2] = r.x; k[3] = r.y; k[4] = this.rotation; k[5] = c.x; k[6] = c.y;
    updateMatrix.call(this);
  };
  TN.update = function () {
    const texture = this.value;
    const matrixUniform = this._matrixUniform;
    if (matrixUniform !== null) {
      matrixUniform.value = texture.matrix;
      if (texture.matrixAutoUpdate === true) texture.updateMatrix();
    }
    const flipYUniform = this._flipYUniform;
    if (flipYUniform !== null) {
      flipYUniform.value = ((hasBitmap && texture.image instanceof ImageBitmap && texture.flipY === true) || texture.isRenderTargetTexture === true || texture.isFramebufferTexture === true || texture.isDepthTexture === true);
    }
  };
}

/**
 * The scene's environment cache key (lights, shadows, environment map, fog) once per frame, not
 * once per render call. Every render object checks it each pass to see whether its program is still
 * valid, and three recomputes it on every render call by walking the whole lights and fog node
 * graphs (~40 KB of garbage a frame here). The light set and the fog graph never change within a
 * frame (VirtualLight's pool is fixed), and a change between frames is still seen the next frame.
 */
function frameCacheKeys(renderer: THREE.WebGPURenderer) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodes = (renderer as any)._nodes;
  if (!nodes || typeof nodes.getCacheKey !== 'function' || !nodes.nodeFrame) return;
  const own = nodes.getCacheKey;
  const memo = new WeakMap<object, WeakMap<object, { f: number; k: number }>>();
  nodes.getCacheKey = function (scene: object, lightsNode: object) {
    const f = this.nodeFrame.frameId as number;
    let m = memo.get(scene);
    if (!m) { m = new WeakMap(); memo.set(scene, m); }
    const e = m.get(lightsNode);
    if (e && e.f === f) return e.k;
    const k = own.call(this, scene, lightsNode) as number;
    if (e) { e.f = f; e.k = k; } else m.set(lightsNode, { f, k });
    return k;
  };
}

/**
 * Runs `fn` (a warm-up render) with every new WebGL program linking in the background
 * (KHR_parallel_shader_compile) instead of three's synchronous path, where the link status query
 * right after each link stalls the page until the driver is done (~3 s of the boot headless, most of
 * a cold-cache boot in the desktop app). The render builds every node graph and starts every link,
 * and objects whose program isn't linked yet just aren't drawn that frame; the promise settles when
 * all of them are ready. Without the extension (or on WebGPU) `fn` runs as usual and it resolves at once.
 */
export function compileInParallel(renderer: THREE.WebGPURenderer, fn: () => void): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const be = (renderer as any).backend;
  if (!be?.isWebGLBackend || !be.parallel || typeof be.createRenderPipeline !== 'function') { fn(); return Promise.resolve(); }
  const own = be.createRenderPipeline;
  const linking: Promise<void>[] = [];
  be.createRenderPipeline = function (renderObject: unknown, promises: Promise<void>[] | null) {
    return own.call(this, renderObject, promises ?? linking);
  };
  try { fn(); } finally { be.createRenderPipeline = own; }
  return Promise.all(linking).then(() => undefined);
}

/** True when WebGL programs can link in the background (see compileInParallel). */
export function canCompileInParallel(renderer: THREE.WebGPURenderer) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const be = (renderer as any).backend;
  return !!(be?.isWebGLBackend && be.parallel);
}

/**
 * WebGPU first, WebGL2 fallback. Some driver stacks (e.g. Chrome + Vulkan on hybrid-GPU Linux)
 * expose WebGPU but fail at the canvas swapchain; if the device reports errors right after start
 * we remember that and reload on the WebGL2 backend.
 */
/**
 * Backend chain: WebGPU on the discrete GPU → WebGPU on the integrated GPU → WebGL2.
 * Some driver stacks (hybrid-GPU Linux: Chrome composites on Intel while Dawn picks the NVIDIA
 * Vulkan device) hand out a WebGPU device that is lost on first present. We detect early device
 * loss / repeated errors, remember the result per browser and reload one step down the chain.
 * URL overrides: ?gpu=high | ?gpu=low | ?webgl  (and ?gpu=reset to forget the stored choice).
 */
export async function createRenderer(canvas: HTMLCanvasElement) {
  const qs = new URLSearchParams(location.search);
  if (qs.get('gpu') === 'reset') { try { localStorage.removeItem(BACKEND_KEY); } catch { /* ignore */ } }
  let choice: BackendChoice = qs.has('webgl') ? 'webgl' : qs.get('gpu') === 'high' ? 'webgpu-high' : qs.get('gpu') === 'low' ? 'webgpu-low' : storedChoice();
  if (choice !== 'webgl' && !('gpu' in navigator)) choice = 'webgl';
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    // opaque canvas: the desktop webview (WebKitGTK) passes canvas alpha through to the window, so any
    // pixel the post stack leaves with alpha < 1 showed the desktop wallpaper through the game
    alpha: false,
    forceWebGL: choice === 'webgl',
    powerPreference: choice === 'webgpu-low' ? 'low-power' : 'high-performance',
  });
  await renderer.init();
  quietShadowAlphaTest(renderer);
  coalesceUniformUploads(renderer);
  if (!qs.has('noflipfix')) settleTextureFlips(); // (?noflipfix: A/B)
  if (!qs.has('nokeymemo')) frameCacheKeys(renderer); // (?nokeymemo: A/B)
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean; device?: GPUDevice };
  const isWebGPU = !!backend.isWebGPUBackend;
  if (!isWebGPU && choice !== 'webgl') choice = 'webgl'; // three fell back on its own
  fitCanvas(renderer, canvas, Math.min(window.devicePixelRatio || 1, 2), isWebGPU);
  if (isWebGPU && backend.device) {
    const started = performance.now();
    const early = () => performance.now() - started < 90000;
    backend.device.lost.then((info) => {
      if (info.reason !== 'destroyed' && early()) demote(choice, info.message.split('\n')[0]);
    });
    let errors = 0;
    backend.device.addEventListener('uncapturederror', (e) => {
      if (early() && ++errors >= 3) demote(choice, (e as GPUUncapturedErrorEvent).error.message.split('\n')[0]);
    });
  }
  return { renderer, isWebGPU, backendLabel: choice === 'webgpu-high' ? 'WebGPU' : choice === 'webgpu-low' ? 'WebGPU (integrated GPU)' : 'WebGL2' };
}
