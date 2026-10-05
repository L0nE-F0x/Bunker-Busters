import * as THREE from 'three/webgpu';

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

export function makeQuality(level: QualityLevel): QualitySettings {
  const p = QUALITY_PRESETS[level];
  return { level, ...p, pixelRatio: Math.min(window.devicePixelRatio || 1, p.pixelRatio * Math.max(1, window.devicePixelRatio || 1)) };
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
  const vw = window.innerWidth, vh = window.innerHeight;
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
    forceWebGL: choice === 'webgl',
    powerPreference: choice === 'webgpu-low' ? 'low-power' : 'high-performance',
  });
  await renderer.init();
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
