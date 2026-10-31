import type * as THREE from 'three/webgpu';
import type { QualityLevel } from './renderer';

/**
 * Automatic quality (browser only). A first visit starts on a preset picked from the GPU the browser
 * renders on, then `RenderScale` holds the frame rate by changing only the render resolution (the
 * canvas buffer and the post targets: no new shader programs, nothing rebuilt), with hysteresis so it
 * can't flap. What a session learned (where the scale settled, whether the preset was too heavy or too
 * light) is kept per GPU for the next start: presets themselves only change at boot, because a preset
 * change mid-run compiles post programs and can't redo the grass.
 *
 * Never active in the desktop app (not benched there yet), with `?q=` (benches), or once the player
 * picks a preset in Settings. `?autoq=1` forces it on (headless tests), `?autoq=0` off.
 */

/** The desktop app (Tauri): nothing here changes it until it's been benched there. */
export const isDesktopApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const QS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
/** `?autoq=1` | `?autoq=0`: force automatic quality on or off (null: settings decide). */
export const AUTOQ_OVERRIDE: boolean | null = QS.has('autoq') ? QS.get('autoq') !== '0' : null;

export type GpuTier = 'software' | 'integrated' | 'discrete' | 'unknown';

/** The GPU's name as the browser reports it ('' if it won't say). */
export function gpuName(renderer: THREE.WebGPURenderer): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const be = (renderer as any).backend;
  try {
    const info = be?.device?.adapterInfo as GPUAdapterInfo | undefined;
    if (info && (info.description || info.vendor || info.architecture)) return `${info.vendor} ${info.architecture} ${info.description}`.trim();
  } catch { /* ignore */ }
  const read = (gl: WebGL2RenderingContext | WebGLRenderingContext | null) => {
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
  };
  if (be?.gl) return read(be.gl);
  // WebGPU without adapter info: ask a throwaway WebGL context on the same kind of GPU
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { powerPreference: 'high-performance' }) ?? c.getContext('webgl');
    const name = read(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

/**
 * Integrated vs discrete from the name. Integrated: Intel (HD/UHD/Iris/Xe, Arc *Graphics* without a
 * model number), AMD APUs ("Radeon Graphics", Vega 3-11, 6x0M-8x0M), Apple (M-series, "Apple GPU"),
 * phone GPUs. Discrete: GeForce/RTX/Quadro, Radeon RX/Pro/R9, Arc A/B-series. Software: SwiftShader,
 * llvmpipe, Microsoft Basic Render.
 */
export function classifyGpu(name: string): GpuTier {
  const n = name.toLowerCase();
  if (!n) return 'unknown';
  if (/swiftshader|llvmpipe|softpipe|lavapipe|basic render|software|microsoft basic/.test(n)) return 'software';
  if (/nvidia|geforce|quadro|rtx|gtx|tesla/.test(n) && !/tegra/.test(n)) return 'discrete';
  if (/radeon\s*(\(tm\)\s*)?(rx|pro|r9|r7|hd [6-8]\d{3}|vii)|vega (56|64)|firepro/.test(n)) return 'discrete';
  if (/arc(\(tm\))?\s*(a|b)\d{3}/.test(n)) return 'discrete';
  if (/intel|iris|uhd|hd graphics|apple|radeon|vega|adreno|mali|powervr|immortalis|xclipse|videocore|qualcomm/.test(n)) return 'integrated';
  return 'unknown';
}

const ORDER: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
const LEARN_KEY = 'bunker-busters.autoq.v1';

interface Learned { gpu: string; preset: QualityLevel; scale: number; next?: QualityLevel }

function readLearned(gpu: string): Learned | null {
  try {
    const v = JSON.parse(localStorage.getItem(LEARN_KEY) ?? 'null') as Learned | null;
    if (!v || v.gpu !== gpu || !ORDER.includes(v.preset)) return null;
    return v;
  } catch {
    return null;
  }
}

/**
 * The preset an automatic start begins on. Discrete GPUs: High (what everyone got before). Integrated,
 * software and phones: Low (an Iris Xe at 1080p runs High at ~12-15 fps, Low at ~30 before the scale
 * comes down). Unknown names (a browser that won't say): Medium. A previous session on the same GPU
 * overrides that guess with what it measured (never above High: Ultra is a choice).
 */
export function startPreset(gpu: string, mobile: boolean): { level: QualityLevel; scale: number; tier: GpuTier } {
  const tier = classifyGpu(gpu);
  let level: QualityLevel = mobile || tier === 'integrated' || tier === 'software' ? 'low' : tier === 'discrete' ? 'high' : 'medium';
  let scale = 1;
  const l = readLearned(gpu);
  if (l) {
    level = l.next ?? l.preset;
    scale = l.next && l.next !== l.preset ? 1 : Math.min(1, Math.max(0.5, l.scale || 1));
  }
  if (ORDER.indexOf(level) > ORDER.indexOf('high')) level = 'high';
  return { level, scale, tier };
}

/** One frame's GPU time on WebGL2 (EXT_disjoint_timer_query_webgl2), read back a few frames late. */
export class GpuTimer {
  private gl: WebGL2RenderingContext | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ext: any = null;
  private pool: WebGLQuery[] = [];
  private pending: WebGLQuery[] = [];
  private current: WebGLQuery | null = null;
  /** The latest measured frame (ms), or -1 while nothing has been read yet / not supported. */
  last = -1;

  constructor(renderer: THREE.WebGPURenderer) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gl = (renderer as any).backend?.gl as WebGL2RenderingContext | undefined;
    if (!gl) return;
    try {
      this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    } catch { /* ignore */ }
    if (this.ext) this.gl = gl;
  }

  get supported() { return !!this.gl; }

  begin() {
    const gl = this.gl;
    if (!gl || this.current) return;
    if (this.pending.length >= 4) { this.poll(); if (this.pending.length >= 4) return; }
    const q = this.pool.pop() ?? gl.createQuery();
    if (!q) return;
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.current = q;
  }

  end() {
    const gl = this.gl;
    if (!gl || !this.current) return;
    gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.current);
    this.current = null;
    this.poll();
  }

  /** Read whatever has landed, oldest first, never waiting on the GPU. */
  private poll() {
    const gl = this.gl!;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      if (!disjoint) this.last = ns / 1e6;
      this.pending.shift();
      this.pool.push(q);
    }
  }
}

/**
 * The render scale (a factor on the preset's pixel ratio) that holds the target frame rate: 60 fps on
 * desktops, 30 on phones. Every 1.5 s it looks at the window just gone (mean frame interval, our own
 * JS time, the GPU's time when the browser can measure it):
 * - down a step when the frames are slow and the GPU is the reason (its time over the budget, or, when
 *   it can't be measured, our JS well under the interval); twice in a row before the first step, so a
 *   one-off hitch can't do it;
 * - up a step when the GPU time says the bigger buffer still fits with room to spare, or (no timer) after
 *   a stretch at the target, as a probe: if that costs the frame rate it steps back and waits twice as
 *   long before trying again (up to 2 minutes), so it can't flap;
 * - nothing for 1 s after a change (the resize) and nothing on frames over 250 ms (a tab switch, a GC,
 *   a compile).
 * Steps never go below half the preset's resolution or under 320 rows.
 */
export class RenderScale {
  static readonly STEPS = [1, 0.87, 0.75, 0.66, 0.58, 0.5];
  private i = 0;
  private readonly budget: number;
  private n = 0;
  private sumIv = 0;
  private sumJs = 0;
  private sumGpu = 0;
  private nGpu = 0;
  private t = 0;
  private settle = 1;
  private slowWindows = 0;
  private goodFor = 0;
  private probeWait = 8;
  private probing: { fromIv: number } | null = null;
  private noHelpAt = -1;
  private noHelpFor = 0;
  private lastDown: { i: number; before: number } | null = null;
  /** Seconds spent at the floor while still slow / at full scale with lots of GPU room (for `learn`). */
  floorSlow = 0;
  roomy = 0;

  constructor(mobile: boolean, start = 1) {
    this.budget = mobile ? 1000 / 30 : 1000 / 60;
    let best = 0;
    RenderScale.STEPS.forEach((s, k) => { if (Math.abs(s - start) < Math.abs(RenderScale.STEPS[best] - start)) best = k; });
    this.i = best;
  }

  get scale() { return RenderScale.STEPS[this.i]; }

  /**
   * Feed one frame. `ivMs` the time since the last frame, `jsMs` our own JS in it, `gpuMs` the GPU's
   * time for a recent frame (-1 unknown), `rows` the buffer height at scale 1. True when the scale changed.
   */
  frame(ivMs: number, jsMs: number, gpuMs: number, rows: number): boolean {
    if (!(ivMs > 0) || ivMs > 250) return false;
    const dt = ivMs / 1000;
    if (this.settle > 0) { this.settle -= dt; return false; }
    this.n++; this.sumIv += ivMs; this.sumJs += jsMs;
    if (gpuMs > 0) { this.sumGpu += gpuMs; this.nGpu++; }
    this.t += dt;
    if (this.t < 1.5) return false;
    const iv = this.sumIv / this.n, js = this.sumJs / this.n, gpu = this.nGpu ? this.sumGpu / this.nGpu : -1;
    const span = this.t;
    this.n = 0; this.sumIv = 0; this.sumJs = 0; this.sumGpu = 0; this.nGpu = 0; this.t = 0;
    return this.decide(iv, js, gpu, rows, span);
  }

  private minIndex(rows: number) {
    let k = RenderScale.STEPS.length - 1;
    while (k > 0 && RenderScale.STEPS[k] * rows < 320) k--;
    return k;
  }

  private decide(iv: number, js: number, gpu: number, rows: number, span: number): boolean {
    const B = this.budget;
    const slow = iv > B * 1.2;
    const floor = this.minIndex(rows);
    // the probe a step up: kept if the frame rate held, undone (and the next one later) if not
    if (this.probing) {
      const failed = slow && iv > this.probing.fromIv * 1.1;
      this.probing = null;
      if (failed) {
        this.probeWait = Math.min(120, this.probeWait * 2);
        return this.set(this.i + 1);
      }
      this.probeWait = 8;
    }
    // a step down that bought nothing (the CPU was the limit after all): undo it and stay there a while
    if (this.lastDown) {
      const { i, before } = this.lastDown;
      this.lastDown = null;
      if (i === this.i && slow && iv > before * 0.93) { this.noHelpAt = this.i - 1; this.noHelpFor = 60; return this.set(this.i - 1); }
    }
    if (this.noHelpFor > 0 && (this.noHelpFor -= span) <= 0) this.noHelpAt = -1;
    // is the GPU what's holding the frame back? (with no timer: our JS is well under the interval)
    const gpuBound = gpu > 0 ? gpu > B * 1.05 : js < iv * 0.6;
    if (slow && gpuBound && this.i < floor && this.i !== this.noHelpAt) {
      this.goodFor = 0;
      if (++this.slowWindows < 2 && this.i === 0) return false;
      this.slowWindows = 0;
      const changed = this.set(this.i + 1);
      if (changed) this.lastDown = { i: this.i, before: iv };
      return changed;
    }
    this.slowWindows = 0;
    // learning for the next start: slow at the floor, or lots of room at full scale
    if (slow && this.i >= floor) this.floorSlow += span; else this.floorSlow = Math.max(0, this.floorSlow - span * 0.5);
    if (this.i === 0 && gpu > 0 && gpu < B * 0.45 && !slow) this.roomy += span; else this.roomy = Math.max(0, this.roomy - span);
    if (this.i === 0) return false;
    // room to grow?
    if (gpu > 0) {
      const next = RenderScale.STEPS[this.i - 1] / RenderScale.STEPS[this.i];
      if (!slow && gpu * next * next < B * 0.72) { this.goodFor += span; if (this.goodFor >= 3) { this.goodFor = 0; return this.set(this.i - 1); } } else this.goodFor = 0;
      return false;
    }
    if (iv <= B * 1.05) {
      this.goodFor += span;
      if (this.goodFor >= this.probeWait) {
        this.goodFor = 0;
        this.probing = { fromIv: iv };
        return this.set(this.i - 1);
      }
    } else this.goodFor = 0;
    return false;
  }

  private set(i: number) {
    const k = Math.max(0, Math.min(RenderScale.STEPS.length - 1, i));
    if (k === this.i) return false;
    this.i = k;
    this.settle = 1;
    this.n = 0; this.sumIv = 0; this.sumJs = 0; this.sumGpu = 0; this.nGpu = 0; this.t = 0;
    return true;
  }
}

/**
 * Keep what this session learned for the next start on this GPU: where the scale settled and, when the
 * preset is clearly wrong for it, the preset to start on instead (a step down after 20 s stuck at the
 * floor and still slow; a step up after a minute at full scale with the GPU under half its budget).
 */
export function learn(gpu: string, preset: QualityLevel, rs: RenderScale) {
  let next: QualityLevel = preset;
  const k = ORDER.indexOf(preset);
  if (rs.floorSlow >= 20 && k > 0) next = ORDER[k - 1];
  else if (rs.roomy >= 60 && k < ORDER.indexOf('high')) next = ORDER[k + 1];
  const v: Learned = { gpu, preset, scale: rs.scale, next: next !== preset ? next : undefined };
  try { localStorage.setItem(LEARN_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}
