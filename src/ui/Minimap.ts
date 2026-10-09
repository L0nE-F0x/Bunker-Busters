import type { Heightfield } from '@/game/world/Heightfield';
import { LANDMARKS } from '@/content/world';
import { renderChart, finishChart, chartInput, CHART_N } from './mapChart';

export interface MapMarker {
  id: string; x: number; z: number; label: string; color: string; kind: 'camp' | 'landmark' | 'bunker' | 'intel' | 'drone';
  /** false: on the sheet by rumour only (not visited yet). */
  known?: boolean;
  /** A line for the world map's info card. */
  note?: string;
}

/** Off the minimap's range these still sit on its rim; everything else just drops off (less clutter). */
const RIM = (m: MapMarker) => m.id === 'quest' || m.id === 'pack' || m.id === 'garage' || m.kind === 'camp';

const FOG_RES = 128;

/** Terrain map render + fog-of-war shared by the HUD minimap and the full-screen map. */
export class MapData {
  terrain: HTMLCanvasElement;
  fog = new Uint8Array(FOG_RES * FOG_RES);
  /** Bumped whenever the fog of war changes (the minimap skips redraws while nothing moved). */
  version = 0;
  private fogCanvas: HTMLCanvasElement;
  private fogDirty = true;

  constructor(private hf: Heightfield) {
    this.terrain = this.renderTerrain();
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = this.fogCanvas.height = FOG_RES;
  }

  get size() {
    return this.hf.size;
  }

  private _chart: HTMLCanvasElement | null = null;
  private chartPx: Uint8ClampedArray | null = null;
  /** What the minimap draws: the survey sheet once it's ready, the quick boot render until then. */
  get sheet() {
    return this._chart ?? this.terrain;
  }
  private worker: Worker | null = null;

  /**
   * Rasterise the world map's sheet in a worker while the game boots (~0.3 s of work off the main
   * thread). The pixels wait until the map first opens; if the worker can't run, the first open
   * draws the sheet itself.
   */
  startChart() {
    if (this._chart || this.worker || this.chartPx) return;
    try {
      const w = new Worker(new URL('./chartWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ px: Uint8ClampedArray; ms: number }>) => {
        // still booting: finishing the sheet here (~20 ms) lets the minimap use it from the start
        const t0 = performance.now();
        this._chart = finishChart(e.data.px, CHART_N, this.hf);
        this.version++;
        console.log(`[map] chart ${CHART_N}² rasterised in a worker in ${e.data.ms.toFixed(0)} ms, finished in ${(performance.now() - t0).toFixed(0)} ms`);
        w.terminate();
        this.worker = null;
      };
      w.onerror = () => { w.terminate(); this.worker = null; };
      const input = chartInput(this.hf);
      w.postMessage(input, [input.heights.buffer]);
      this.worker = w;
    } catch {
      this.worker = null;
    }
  }

  /** The world map's survey sheet (see mapChart.ts). */
  get chart() {
    if (!this._chart) {
      if (this.chartPx) this._chart = finishChart(this.chartPx, CHART_N, this.hf);
      else { this.worker?.terminate(); this.worker = null; this._chart = renderChart(this.hf); }
      this.chartPx = null;
    }
    return this._chart;
  }

  private renderTerrain() {
    const S = 512;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(S, S);
    const hf = this.hf;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const wx = ((x + 0.5) / S - 0.5) * hf.size;
        const wz = ((y + 0.5) / S - 0.5) * hf.size;
        const h = hf.heightAt(wx, wz);
        const n = hf.normalAt(wx, wz);
        const shade = Math.max(0, n.x * -0.5 + n.y * 0.7 + n.z * -0.5);
        const t = Math.min(1, Math.max(0, (h + 10) / 50));
        let r = 70 + t * 70, g = 52 + t * 45, b = 36 + t * 28;
        r *= 0.55 + shade * 0.6; g *= 0.55 + shade * 0.6; b *= 0.55 + shade * 0.6;
        // contour lines every 4m
        if (Math.abs(((h % 4) + 4) % 4) < 0.25) { r *= 0.8; g *= 0.8; b *= 0.8; }
        const road = hf.roadDistanceAt(wx, wz);
        if (road < 4.5) { r = 150; g = 135; b = 110; }
        if (h < -4.5) { r *= 0.85; g *= 0.9; b *= 0.95; }
        const i = (y * S + x) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // subtle grid
    ctx.strokeStyle = 'rgba(255,200,140,0.06)';
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath(); ctx.moveTo((i / 8) * S, 0); ctx.lineTo((i / 8) * S, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (i / 8) * S); ctx.lineTo(S, (i / 8) * S); ctx.stroke();
    }
    return c;
  }

  reveal(x: number, z: number, radius: number) {
    const cell = this.hf.size / FOG_RES;
    const cx = (x / this.hf.size + 0.5) * FOG_RES, cz = (z / this.hf.size + 0.5) * FOG_RES;
    const r = radius / cell;
    let changed = false;
    for (let j = Math.floor(cz - r); j <= Math.ceil(cz + r); j++) {
      for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
        if (i < 0 || j < 0 || i >= FOG_RES || j >= FOG_RES) continue;
        const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cz) / r;
        if (d > 1) continue;
        const v = Math.round(255 * Math.min(1, (1 - d) * 2.5));
        const k = j * FOG_RES + i;
        if (v > this.fog[k]) { this.fog[k] = v; changed = true; }
      }
    }
    if (changed) { this.fogDirty = true; this.version++; }
  }

  revealedAt(x: number, z: number) {
    const i = Math.floor((x / this.hf.size + 0.5) * FOG_RES), j = Math.floor((z / this.hf.size + 0.5) * FOG_RES);
    return this.fog[j * FOG_RES + i] ?? 0;
  }

  get fogImage() {
    if (this.fogDirty) {
      const ctx = this.fogCanvas.getContext('2d')!;
      const img = ctx.createImageData(FOG_RES, FOG_RES);
      for (let k = 0; k < this.fog.length; k++) {
        img.data[k * 4] = 12; img.data[k * 4 + 1] = 9; img.data[k * 4 + 2] = 7;
        img.data[k * 4 + 3] = 255 - this.fog[k] * 0.92;
      }
      ctx.putImageData(img, 0, 0);
      this.fogDirty = false;
    }
    return this.fogCanvas;
  }

  serialize() {
    // 4-bit quantised, run-length encoded
    const out: number[] = [];
    let prev = -1, run = 0;
    for (let k = 0; k < this.fog.length; k++) {
      const v = this.fog[k] >> 4;
      if (v === prev && run < 255) run++;
      else { if (prev >= 0) out.push(prev, run); prev = v; run = 1; }
    }
    out.push(prev, run);
    return btoa(String.fromCharCode(...out));
  }

  deserialize(s: string) {
    if (!s) return;
    try {
      const bytes = atob(s);
      let k = 0;
      for (let i = 0; i < bytes.length; i += 2) {
        const v = bytes.charCodeAt(i) * 17, run = bytes.charCodeAt(i + 1);
        for (let r = 0; r < run && k < this.fog.length; r++) this.fog[k++] = v;
      }
      this.fogDirty = true;
    } catch {
      /* corrupt save: leave fog */
    }
  }
}

function drawMarker(ctx: CanvasRenderingContext2D, m: MapMarker, x: number, y: number, scale: number, label: boolean, labelDy = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = m.color;
  ctx.shadowBlur = 10 * scale;
  ctx.fillStyle = m.color;
  ctx.strokeStyle = '#0c0806';
  ctx.lineWidth = 2 * scale;
  if (m.kind === 'bunker') {
    ctx.beginPath();
    ctx.moveTo(0, -9 * scale); ctx.lineTo(9 * scale, 6 * scale); ctx.lineTo(-9 * scale, 6 * scale); ctx.closePath();
    ctx.fill(); ctx.stroke();
  } else if (m.kind === 'camp') {
    ctx.beginPath();
    ctx.moveTo(0, -8 * scale); ctx.quadraticCurveTo(7 * scale, 2 * scale, 0, 7 * scale); ctx.quadraticCurveTo(-7 * scale, 2 * scale, 0, -8 * scale);
    ctx.fill(); ctx.stroke();
  } else if (m.kind === 'drone') {
    ctx.beginPath(); ctx.arc(0, 0, 4 * scale, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-5 * scale, -5 * scale, 10 * scale, 10 * scale);
    ctx.strokeRect(-5 * scale, -5 * scale, 10 * scale, 10 * scale);
  }
  ctx.restore();
  if (label) {
    ctx.font = `600 ${12 * scale}px "Chakra Petch", sans-serif`;
    ctx.fillStyle = '#f3e9d8';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    ctx.fillText(m.label, x + 12 * scale, y + 4 * scale + labelDy);
    ctx.shadowBlur = 0;
  }
}

/**
 * A glowing piece of minimap art rendered once. Canvas `shadowBlur` is a CPU blur in WebKitGTK and
 * the minimap used ~15 of them per redraw (markers, arrow, compass letters), so the glows are baked
 * into small sprites and blitted. Shadows ignore the transform, so baking them unrotated is exact.
 */
function sprite(size: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.translate(size / 2, size / 2);
  draw(ctx);
  return c;
}
// sprite sizes ≥ 2 × (shape extent + ~3σ of its glow), centred on the anchor
const SPRITE = 80; // markers (≤ 13 px + blur 14) and compass letters
const ARROW = 112; // player arrow (16 px + blur 16)
const COMPASS_FONT = '700 22px "JetBrains Mono", monospace';

/** Rotating circular minimap. */
export class Minimap {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  range = 150; // metres radius
  private sprites = new Map<string, HTMLCanvasElement>();
  private ring: HTMLCanvasElement | null = null;
  private fontReady = false;
  /** What the canvas currently shows: [px, pz, heading, yaw, fog version], plus the markers. */
  private shown = [NaN, NaN, NaN, NaN, -1];
  private shownMarkers: number[] = [];

  constructor(private data: MapData) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 392;
    this.ctx = this.canvas.getContext('2d')!;
  }

  private cached(key: string, make: () => HTMLCanvasElement) {
    let s = this.sprites.get(key);
    if (!s) this.sprites.set(key, (s = make()));
    return s;
  }

  /** True when the last drawn frame already shows this (every redraw re-uploads + recomposites the canvas). */
  private unchanged(px: number, pz: number, heading: number, playerYaw: number, markers: MapMarker[]) {
    const s = this.shown, m = this.shownMarkers;
    let same = Math.abs(px - s[0]) < 0.05 && Math.abs(pz - s[1]) < 0.05 && Math.abs(heading - s[2]) < 0.002
      && Math.abs(playerYaw - s[3]) < 0.002 && this.data.version === s[4] && m.length === markers.length * 3 && this.fontReady;
    for (let i = 0; same && i < markers.length; i++) {
      const k = markers[i];
      same = m[i * 3] === k.x && m[i * 3 + 1] === k.z && m[i * 3 + 2] === hashStr(k.kind + k.color);
    }
    if (same) return true;
    s[0] = px; s[1] = pz; s[2] = heading; s[3] = playerYaw; s[4] = this.data.version;
    m.length = 0;
    for (const k of markers) m.push(k.x, k.z, hashStr(k.kind + k.color));
    return false;
  }

  draw(px: number, pz: number, heading: number, playerYaw: number, markers: MapMarker[]) {
    if (this.unchanged(px, pz, heading, playerYaw, markers)) return;
    const { ctx, canvas, data } = this;
    const S = canvas.width, R = S / 2;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#0c0806';
    ctx.fillRect(0, 0, S, S);
    const scale = R / this.range; // px per metre
    const mapPx = data.size * scale;
    ctx.translate(R, R);
    ctx.rotate(heading);
    const ox = -(px / data.size + 0.5) * mapPx, oz = -(pz / data.size + 0.5) * mapPx;
    ctx.globalAlpha = 0.95;
    // only the part of the sheet under the dial (a big source scaled whole is slow in a CPU canvas)
    const sheet = data.sheet, k = sheet.width / data.size, half = data.size / 2;
    const sx0 = Math.max(0, (px - this.range * 1.05 + half) * k), sz0 = Math.max(0, (pz - this.range * 1.05 + half) * k);
    const sx1 = Math.min(sheet.width, (px + this.range * 1.05 + half) * k), sz1 = Math.min(sheet.height, (pz + this.range * 1.05 + half) * k);
    if (sx1 > sx0 && sz1 > sz0) ctx.drawImage(sheet, sx0, sz0, sx1 - sx0, sz1 - sz0, ox + (sx0 / k) * scale, oz + (sz0 / k) * scale, ((sx1 - sx0) / k) * scale, ((sz1 - sz0) / k) * scale);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(data.fogImage, ox, oz, mapPx, mapPx);
    ctx.globalAlpha = 1;
    for (const m of markers) {
      const mx = (m.x - px) * scale, mz = (m.z - pz) * scale;
      const d = Math.hypot(mx, mz);
      let x = mx, y = mz;
      if (d > R - 14) {
        if (!RIM(m)) continue;
        x = (mx / d) * (R - 14); y = (mz / d) * (R - 14);
      }
      const spr = this.cached(`m:${m.kind}:${m.color}`, () => sprite(SPRITE, (c) => drawMarker(c, m, 0, 0, 1.4, false)));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-heading);
      ctx.drawImage(spr, -SPRITE / 2, -SPRITE / 2);
      ctx.restore();
    }
    ctx.restore();
    // player arrow (points along body yaw relative to camera heading)
    const arrow = this.cached('arrow', () => sprite(ARROW, (c) => {
      c.fillStyle = '#3ff2e0';
      c.shadowColor = '#3ff2e0';
      c.shadowBlur = 16;
      c.beginPath();
      c.moveTo(0, -16); c.lineTo(11, 12); c.lineTo(0, 6); c.lineTo(-11, 12); c.closePath();
      c.fill();
    }));
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(-(playerYaw) + Math.PI + heading);
    ctx.drawImage(arrow, -ARROW / 2, -ARROW / 2);
    ctx.restore();
    // vignette ring (static: drawn once)
    if (!this.ring) {
      this.ring = document.createElement('canvas');
      this.ring.width = this.ring.height = S;
      const rc = this.ring.getContext('2d')!;
      const g = rc.createRadialGradient(R, R, R * 0.7, R, R, R);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.65)');
      rc.fillStyle = g;
      rc.fillRect(0, 0, S, S);
    }
    ctx.drawImage(this.ring, 0, 0);
    // compass letters just inside the rim (world north = -z)
    // (don't bake a fallback font into the cache: until the webfont is in, re-render each time)
    const fontReady = this.fontReady || (this.fontReady = document.fonts?.check(COMPASS_FONT) ?? true);
    ['N', 'E', 'S', 'W'].forEach((l, i) => {
      const a = heading + (i * Math.PI) / 2 - Math.PI / 2;
      const key = `c:${l}`;
      if (!fontReady) this.sprites.delete(key);
      const spr = this.cached(key, () => sprite(SPRITE, (c) => {
        c.font = COMPASS_FONT;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = l === 'N' ? '#ffb347' : 'rgba(243,233,216,0.75)';
        c.shadowColor = '#000';
        c.shadowBlur = 6;
        c.fillText(l, 0, 0);
      }));
      ctx.drawImage(spr, R + Math.cos(a) * (R - 18) - SPRITE / 2, R + Math.sin(a) * (R - 18) - SPRITE / 2);
    });
  }
}

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export const LANDMARK_MARKERS: MapMarker[] = LANDMARKS.map((l) => ({
  id: l.id, x: l.position[0], z: l.position[2], label: l.name, color: l.camp ? '#ff8a2a' : '#f3e9d8', kind: l.camp ? 'camp' : 'landmark', note: l.blurb,
}));
