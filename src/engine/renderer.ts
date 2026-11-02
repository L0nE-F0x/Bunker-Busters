import * as THREE from 'three/webgpu';
import { bool, int, textureSize } from 'three/tsl';
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
  // a demote with storage blocked carries its choice in the address instead (see demote)
  const carried = new URLSearchParams(location.search).get('bbgpu') as BackendChoice | null;
  if (carried && CHAIN.includes(carried)) return carried;
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
  let kept = false;
  try { localStorage.setItem(BACKEND_KEY, next); kept = localStorage.getItem(BACKEND_KEY) === next; } catch { /* blocked */ }
  if (kept) { location.reload(); return; }
  // storage blocked (private window, site data off): without this the failing backend came back on
  // every reload, forever
  // (by hand, so the other flags keep their exact spelling: `?webgl`, not `?webgl=`)
  const rest = location.search.slice(1).split('&').filter((kv) => kv && kv.split('=')[0] !== 'bbgpu');
  location.replace(`${location.pathname}?${[...rest, `bbgpu=${next}`].join('&')}${location.hash}`);
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
 * sampled texture a `flipY` uniform (true for render targets, depth textures and flipped
 * ImageBitmaps), refreshed for every object it draws: ~2,700 refreshes a frame at Dry Creek (the
 * shadow map's PCF taps and the environment map in every lit material, mostly), plus a select in the
 * shader. A render target or depth texture is always flipped and a plain image, canvas or data array
 * never is, which is known when the material is built (models and canvases load before the
 * warm-up). For those the texture's base node gets a constant `true`/`false` in place of the
 * uniform: the flip is baked into the UV, and texture gathers (r187 passes them the flag to mirror
 * their offsets and texel order; they read `false` without it, which darkened every shadowed
 * interior) get the same constant. Anything else (flipped ImageBitmaps, a plain texture without an
 * image yet) keeps three's uniform. Also: the UV matrix (offset/repeat/rotation, refreshed per draw
 * for nodes that use it) is only rebuilt when one of those changed.
 */
function settleTextureFlips() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const TN = (THREE as any).TextureNode?.prototype;
  if (!TN || typeof TN.setupUV !== 'function' || typeof TN.getBase !== 'function' || !('_flipYUniform' in new (THREE as any).TextureNode())) return;
  const setupUV = TN.setupUV;
  const hasBitmap = typeof ImageBitmap !== 'undefined';
  const FLIPPED = bool(true), PLAIN = bool(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TN.setupUV = function (builder: any, uvNode: any) {
    if (!builder.isFlipY?.()) return setupUV.call(this, builder, uvNode);
    const base = this.getBase();
    if (base._flipYUniform === null) {
      const t = base.value as (THREE.Texture & { isRenderTargetTexture?: boolean; isFramebufferTexture?: boolean; isDepthTexture?: boolean; isCubeTexture?: boolean }) | null;
      if (t && t.isTexture && !t.isCubeTexture) {
        const img = t.image as unknown;
        // render targets and depth (the post stack, the shadow map): always flipped; their nodes only
        // ever swap one target for another. Plain images, canvases and data: never (an unflipped
        // ImageBitmap included).
        if (t.isRenderTargetTexture || t.isFramebufferTexture || t.isDepthTexture) base._flipYUniform = FLIPPED;
        else if (img != null && !(hasBitmap && img instanceof ImageBitmap && t.flipY === true)) base._flipYUniform = PLAIN;
      }
    }
    if (base._flipYUniform === PLAIN) return uvNode;
    if (base._flipYUniform === FLIPPED) {
      const v = uvNode.toVar();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return this.sampler ? v.flipY() : v.setY(int((textureSize(this, this.levelNode) as any).y).sub(int(v.y)).sub(1));
    }
    return setupUV.call(this, builder, uvNode);
  };
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

/** Neither WebGPU nor WebGL 2 could be started in this browser (ui/bootFail.ts explains). */
export class GraphicsUnavailable extends Error {
  constructor(readonly cause: unknown) {
    super(`no WebGL 2 or WebGPU (${cause instanceof Error ? cause.message : String(cause)})`);
    this.name = 'GraphicsUnavailable';
  }
}

/** Renderer strings of the software rasterisers browsers fall back to without a usable GPU. */
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|lavapipe|software rasterizer|software renderer|basic render driver|microsoft basic|apple software/i;

/**
 * The GPU as the browser names it ('' if it won't say) and whether that's a software renderer
 * (it'll run at a few frames a second). WebGL: the unmasked renderer string where it's offered.
 * WebGPU: the adapter's description, and its fallback flag.
 */
export function gpuInfo(renderer: THREE.WebGPURenderer): { name: string; software: boolean } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const be = (renderer as any).backend;
  try {
    if (be?.isWebGLBackend && be.gl) {
      const gl = be.gl as WebGL2RenderingContext;
      let name = String(gl.getParameter(gl.RENDERER) ?? '');
      // Chrome and Safari mask it ("WebKit WebGL"); the debug extension still tells (Firefox no longer needs it)
      if (!name || /^(webkit webgl|mozilla)$/i.test(name)) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? name);
      }
      return { name, software: SOFTWARE_GPU.test(name) };
    }
    const info = be?.device?.adapterInfo as (GPUAdapterInfo & { isFallbackAdapter?: boolean }) | undefined;
    if (info) {
      const name = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' ').trim();
      return { name: `WebGPU ${name}`.trim(), software: !!info.isFallbackAdapter || SOFTWARE_GPU.test(name) };
    }
  } catch { /* a lost context mid-question: say nothing */ }
  return { name: '', software: false };
}

type LostInfo = { api: string; message: string; reason: string | null };
const lostHandlers: ((info: LostInfo) => void)[] = [];
/** Called when the GPU context is lost for good (WebGL context loss; WebGPU device loss after start-up). */
export function onGraphicsLost(cb: (info: LostInfo) => void) {
  lostHandlers.push(cb);
}

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
  try {
    await renderer.init();
  } catch (err) {
    // three falls back to WebGL 2 by itself when WebGPU fails, so this is both gone (or broken)
    let gl2 = false;
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      gl2 = !!gl;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { /* no */ }
    if (!gl2) throw new GraphicsUnavailable(err);
    throw err;
  }
  quietShadowAlphaTest(renderer);
  if (!qs.has('nocoalesce')) coalesceUniformUploads(renderer); // (?nocoalesce: A/B)
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
  const started = performance.now();
  const early = () => performance.now() - started < 90000;
  // a lost context or device: three logs it and stops drawing; the game says so (WebGPU's early
  // losses are the driver bug below, handled by moving down the chain instead)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = renderer as any;
  const ownLost = r.onDeviceLost?.bind(r);
  r.onDeviceLost = (info: LostInfo) => {
    ownLost?.(info);
    if (isWebGPU && early()) return;
    for (const cb of lostHandlers) cb(info);
  };
  if (isWebGPU && backend.device) {
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
