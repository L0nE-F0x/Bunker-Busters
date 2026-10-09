import './worldmap.css';
import type { MapData, MapMarker } from './Minimap';
import type { NavFrame } from '@/engine/gamepad';
import { dirOf } from '@/engine/bindings';

/**
 * The full-screen world map: a survey sheet drawn once from the heightfield (mapChart.ts), the fog
 * of war as an "unsurveyed" veil, discovered places, the tracked objective with a bearing line, and
 * fast travel between the safe places you've found. Pan and zoom with the mouse (drag, wheel),
 * the keys (move keys pan, Q/E or -/= zoom, C centres), a pad (sticks; LB/RB step between places)
 * and touch (drag, pinch). The canvas only redraws when something changed.
 */

export interface TravelOption {
  id: string;
  name: string;
  x: number;
  z: number;
  /** "1.2 km · 1 h 10 min", or "" when you're standing in it. */
  detail: string;
  /** Why this one is off (not found yet, you're already there, unsafe), or null. */
  blocked: string | null;
  here: boolean;
}

export interface WorldMapOpts {
  px: number;
  pz: number;
  /** Camera heading (yaw, radians): the arrow and the view cone point along it. */
  heading: number;
  markers: MapMarker[];
  intel: { title: string; body: string }[];
  travel: TravelOption[];
  /** Why fast travel is off right now (hunted, alarm...), or null. */
  travelBlocked: string | null;
  /** Header sub-line ("Survey sheet · Day 3 · 19:40"). */
  sub: string;
  device: 'kbm' | 'pad' | 'touch';
  /** Footer hint HTML for the device in use. */
  hint: string;
  onTravel: (id: string) => void;
  sound: (name: 'ui' | 'uiHover' | 'deny') => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Map marker role for drawing (the marker kinds are shared with the minimap, so ids tell the rest). */
type Role = 'travel' | 'landmark' | 'bunker' | 'outpost' | 'intel' | 'cache' | 'quest' | 'pack' | 'drone';
function roleOf(m: MapMarker, travel: Set<string>): Role {
  if (m.id === 'quest') return 'quest';
  if (m.id === 'pack') return 'pack';
  if (m.id === 'drone') return 'drone';
  if (travel.has(m.id)) return 'travel';
  if (m.id.startsWith('op:')) return 'outpost';
  if (m.id.startsWith('cache.')) return 'cache';
  if (m.kind === 'bunker') return 'bunker';
  if (m.kind === 'intel') return 'intel';
  return 'landmark';
}
const PRIO: Record<Role, number> = { quest: 0, travel: 1, bunker: 2, pack: 3, landmark: 4, outpost: 5, intel: 6, cache: 7, drone: 8 };
const TAG: Record<Role, string> = {
  quest: 'Objective', travel: 'Safe place · fast travel', bunker: 'Bunker', pack: 'Your pack', landmark: 'Landmark',
  outpost: 'Kade outpost', intel: 'Intel', cache: 'Cache', drone: 'Drone',
};

type Entry = { m: MapMarker; role: Role };

const GRID = 8;
const COLS = 'ABCDEFGH';
const FONT = '"Chakra Petch", sans-serif';
const DISPLAY = '"Big Shoulders Stencil Display", Impact, sans-serif';
const MONO = '"JetBrains Mono", monospace';

/** Compass word for a bearing from (dx, dz) (north = -z). */
function bearing(dx: number, dz: number) {
  const a = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((a + 360) % 360) / 45) % 8];
}
export function distText(m: number) {
  return m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

let veilCache: { v: number; c: HTMLCanvasElement } | null = null;
/** The fog of war as a hatched, near-opaque veil with soft edges (rebuilt only when the fog changed). */
function veil(data: MapData) {
  if (veilCache?.v === data.version) return veilCache.c;
  const F = Math.round(Math.sqrt(data.fog.length));
  const mask = document.createElement('canvas');
  mask.width = mask.height = F;
  const mc = mask.getContext('2d')!;
  const img = mc.createImageData(F, F);
  for (let k = 0; k < data.fog.length; k++) {
    img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = 255;
    img.data[k * 4 + 3] = 255 - data.fog[k];
  }
  mc.putImageData(img, 0, 0);
  const R = 768;
  const c = veilCache?.c ?? document.createElement('canvas');
  c.width = c.height = R;
  const ctx = c.getContext('2d')!;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(14, 10, 8, 0.84)';
  ctx.fillRect(0, 0, R, R);
  // "unsurveyed": a faint diagonal hatch
  ctx.strokeStyle = 'rgba(255, 179, 71, 0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = -R; i < R; i += 7) { ctx.moveTo(i, 0); ctx.lineTo(i + R, R); }
  ctx.stroke();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mask, 0, 0, R, R);
  ctx.globalCompositeOperation = 'source-over';
  veilCache = { v: data.version, c };
  return c;
}

class MapView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  cx: number;
  cz: number;
  zoom = 1;
  private fit = 1;
  private dirty = true;
  private raf = 0;
  private alive = true;
  private travelIds: Set<string>;
  private markers: Entry[] = [];
  selected: MapMarker | null = null;
  private hover: MapMarker | null = null;
  private held = new Set<'up' | 'down' | 'left' | 'right' | 'in' | 'out'>();
  private lastT = 0;
  private pad = { x: 0, y: 0, z: 0 };
  onSelect: (m: MapMarker | null) => void = () => {};

  constructor(private data: MapData, private o: WorldMapOpts) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'wmap-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    this.travelIds = new Set(o.travel.map((t) => t.id));
    this.cx = o.px;
    this.cz = o.pz;
    for (const m of o.markers) this.markers.push({ m, role: roleOf(m, this.travelIds) });
    this.markers.sort((a, b) => PRIO[a.role] - PRIO[b.role]);
    this.bindPointer();
  }

  get size() { return this.data.size; }

  /** Fit the canvas to its box (CSS px × device pixels, capped at 2). */
  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    const fit = Math.min(this.w, this.h) / this.size;
    const first = this.fit === 1 && this.zoom === 1;
    this.fit = fit;
    // open at a useful scale: about 420 m across, centred on you
    if (first) this.zoom = Math.max(fit, Math.min(fit * 6, Math.min(this.w, this.h) / 420));
    this.clamp();
    this.redraw();
  }

  private clamp() {
    this.zoom = Math.max(this.fit * 0.95, Math.min(this.fit * 7, this.zoom));
    // the view's centre stays on the sheet; a sheet smaller than the view sits in the middle
    const h = this.size / 2;
    const ex = Math.max(0, h - this.w / 2 / this.zoom), ez = Math.max(0, h - this.h / 2 / this.zoom);
    this.cx = Math.max(-ex, Math.min(ex, this.cx));
    this.cz = Math.max(-ez, Math.min(ez, this.cz));
  }

  redraw() {
    this.dirty = true;
    if (!this.raf && this.alive) this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  /** Zoom by `f` keeping the world point under (sx, sy) where it is. */
  zoomAt(f: number, sx = this.w / 2, sy = this.h / 2) {
    const wx = this.cx + (sx - this.w / 2) / this.zoom, wz = this.cz + (sy - this.h / 2) / this.zoom;
    this.zoom *= f;
    this.clamp();
    this.cx = wx - (sx - this.w / 2) / this.zoom;
    this.cz = wz - (sy - this.h / 2) / this.zoom;
    this.clamp();
    this.redraw();
  }

  pan(dx: number, dy: number) {
    this.cx -= dx / this.zoom;
    this.cz -= dy / this.zoom;
    this.clamp();
    this.redraw();
  }

  centre(x: number, z: number) {
    this.cx = x;
    this.cz = z;
    this.clamp();
    this.redraw();
  }

  select(m: MapMarker | null, centre = false) {
    this.selected = m;
    if (m && centre) this.centre(m.x, m.z);
    this.onSelect(m);
    this.redraw();
  }

  /** Step through the places on the sheet, nearest-first from you (LB/RB, Tab). */
  cycle(d: number) {
    const list = this.markers.filter((k) => k.role !== 'drone' && k.m.known !== false)
      .sort((a, b) => Math.hypot(a.m.x - this.o.px, a.m.z - this.o.pz) - Math.hypot(b.m.x - this.o.px, b.m.z - this.o.pz));
    if (!list.length) return;
    const i = list.findIndex((k) => k.m === this.selected);
    const next = list[(i + d + list.length) % list.length].m;
    this.select(next, true);
    this.o.sound('uiHover');
  }

  key(code: string, down: boolean) {
    const dir = dirOf(code);
    const z = code === 'KeyE' || code === 'Equal' || code === 'NumpadAdd' ? 'in' : code === 'KeyQ' || code === 'Minus' || code === 'NumpadSubtract' ? 'out' : null;
    const k = dir ?? z;
    if (k) {
      if (down) this.held.add(k); else this.held.delete(k);
      this.redraw();
      return true;
    }
    if (!down) return false;
    if (code === 'KeyC' || code === 'Space' || code === 'Home') { this.centre(this.o.px, this.o.pz); return true; }
    if (code === 'BracketRight' || code === 'PageDown') { this.cycle(1); return true; }
    if (code === 'BracketLeft' || code === 'PageUp') { this.cycle(-1); return true; }
    return false;
  }

  /** The sticks and bumpers (the d-pad, A and B stay with the menu: the travel buttons). */
  padFrame(f: NavFrame): NavFrame {
    this.pad.x = f.lx;
    this.pad.y = f.ly;
    this.pad.z = -f.ry;
    if (f.lx || f.ly || f.ry) this.redraw();
    if (f.lb) this.cycle(-1);
    if (f.rb) this.cycle(1);
    if (f.y) this.centre(this.o.px, this.o.pz);
    // the left stick also reads as menu directions past half-tilt: while it pans, the buttons stay put
    const stick = Math.abs(f.lx) > 0.3 || Math.abs(f.ly) > 0.3;
    const dirs = stick ? { up: false, down: false, left: false, right: false } : {};
    return { ...f, ...dirs, lx: 0, ly: 0, rx: 0, ry: 0, lb: false, rb: false, y: false };
  }

  stop() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
  }

  private tick(t: number) {
    this.raf = 0;
    if (!this.alive) return;
    const dt = this.lastT ? Math.min(0.05, (t - this.lastT) / 1000) : 1 / 60;
    let moving = false;
    if (this.held.size || this.pad.x || this.pad.y || this.pad.z) {
      const v = 520 * dt;
      const dx = (this.held.has('left') ? 1 : 0) - (this.held.has('right') ? 1 : 0) - this.pad.x;
      const dy = (this.held.has('up') ? 1 : 0) - (this.held.has('down') ? 1 : 0) - this.pad.y;
      if (dx || dy) this.pan(dx * v, dy * v);
      const dz = (this.held.has('in') ? 1 : 0) - (this.held.has('out') ? 1 : 0) + this.pad.z;
      if (dz) this.zoomAt(Math.exp(dz * 1.8 * dt));
      moving = true;
    }
    if (this.dirty) { this.dirty = false; this.draw(); }
    this.lastT = moving ? t : 0;
    if (moving) this.raf = requestAnimationFrame((tt) => this.tick(tt));
  }

  // ---------------------------------------------------------------- input
  private bindPointer() {
    const c = this.canvas;
    const pts = new Map<number, { x: number; y: number }>();
    let moved = 0, pinch = 0, downAt = { x: 0, y: 0 };
    const local = (e: PointerEvent | WheelEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture?.(e.pointerId);
      const p = local(e);
      pts.set(e.pointerId, p);
      if (pts.size === 1) { moved = 0; downAt = p; }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); moved = 99; }
      e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => {
      const p = local(e);
      const prev = pts.get(e.pointerId);
      if (!prev) {
        // hover (mouse): which marker is under the cursor
        const m = this.pick(p.x, p.y);
        if (m !== this.hover) { this.hover = m; c.style.cursor = m ? 'pointer' : 'grab'; this.redraw(); }
        return;
      }
      if (pts.size >= 2) {
        const [a0, b0] = [...pts.values()];
        const mid0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
        pts.set(e.pointerId, p);
        const [a, b] = [...pts.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pinch > 0 && dist > 0) this.zoomAt(dist / pinch, mid.x, mid.y);
        pinch = dist;
        this.pan(mid.x - mid0.x, mid.y - mid0.y);
        return;
      }
      pts.set(e.pointerId, p);
      moved = Math.max(moved, Math.hypot(p.x - downAt.x, p.y - downAt.y));
      if (moved > 4) { c.style.cursor = 'grabbing'; this.pan(p.x - prev.x, p.y - prev.y); }
    });
    const up = (e: PointerEvent) => {
      const p = local(e);
      const was = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      if (!was || pts.size) return;
      c.style.cursor = this.hover ? 'pointer' : 'grab';
      if (moved <= 6 && e.type === 'pointerup') {
        const m = this.pick(p.x, p.y, e.pointerType === 'touch' ? 30 : 20);
        if (m !== this.selected) this.o.sound('ui');
        this.select(m);
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { if (this.hover) { this.hover = null; this.redraw(); } });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      this.zoomAt(Math.exp(-Math.max(-300, Math.min(300, dy)) * 0.0018), p.x, p.y);
    }, { passive: false });
    c.addEventListener('dblclick', (e) => { const p = local(e as unknown as PointerEvent); this.zoomAt(1.8, p.x, p.y); });
  }

  /** The marker nearest (sx, sy) within `r` CSS px. */
  private pick(sx: number, sy: number, r = 18): MapMarker | null {
    let best: MapMarker | null = null, bd = r;
    for (const k of this.markers) {
      const d = Math.hypot(this.sx(k.m.x) - sx, this.sy(k.m.z) - sy);
      if (d < bd) { bd = d; best = k.m; }
    }
    return best;
  }

  private sx(x: number) { return (x - this.cx) * this.zoom + this.w / 2; }
  private sy(z: number) { return (z - this.cz) * this.zoom + this.h / 2; }

  // ---------------------------------------------------------------- drawing
  private draw() {
    const { ctx, data } = this;
    const W = this.w, H = this.h, S = this.size;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0b0806';
    ctx.fillRect(0, 0, W, H);
    const x0 = this.sx(-S / 2), y0 = this.sy(-S / 2), span = S * this.zoom;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // only the visible part of each sheet (a CPU canvas, as in WebKitGTK, pays for what it samples)
    this.blit(data.chart, x0, y0, span);
    this.blit(veil(data), x0, y0, span);
    // the sheet's edge
    ctx.strokeStyle = 'rgba(255, 179, 71, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 0.5, y0 - 0.5, span + 1, span + 1);
    this.gridLabels(x0, y0, span);
    this.route();
    this.drawMarkers();
    this.drawPlayer();
    this.scaleBar();
    this.northArrow();
  }

  /** Draw the part of a square image covering the sheet (x0, y0, span) that lands inside the view. */
  private blit(img: HTMLCanvasElement, x0: number, y0: number, span: number) {
    const k = img.width / span;
    const sx0 = Math.max(0, -x0 * k), sy0 = Math.max(0, -y0 * k);
    const sx1 = Math.min(img.width, (this.w - x0) * k), sy1 = Math.min(img.height, (this.h - y0) * k);
    if (sx1 <= sx0 || sy1 <= sy0) return;
    this.ctx.drawImage(img, sx0, sy0, sx1 - sx0, sy1 - sy0, x0 + sx0 / k, y0 + sy0 / k, (sx1 - sx0) / k, (sy1 - sy0) / k);
  }

  private gridLabels(x0: number, y0: number, span: number) {
    const { ctx } = this;
    const cell = span / GRID;
    ctx.font = `600 11px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // letters along the top, numbers down the left, pinned to the view edge when the sheet's edge is off screen
    const ty = Math.max(12, Math.min(this.h - 12, y0 + 12));
    const lx = Math.max(12, Math.min(this.w - 12, x0 + 12));
    for (let i = 0; i < GRID; i++) {
      const cx = x0 + (i + 0.5) * cell, cy = y0 + (i + 0.5) * cell;
      ctx.fillStyle = 'rgba(255, 196, 120, 0.55)';
      if (cx > 24 && cx < this.w - 24) ctx.fillText(COLS[i], cx, ty);
      if (cy > 24 && cy < this.h - 24) ctx.fillText(String(i + 1), lx, cy);
    }
  }

  /** A dashed bearing line from you to the tracked objective, with the distance at its far end. */
  private route() {
    const q = this.markers.find((k) => k.role === 'quest')?.m;
    if (!q) return;
    const { ctx } = this;
    const ax = this.sx(this.o.px), ay = this.sy(this.o.pz), bx = this.sx(q.x), by = this.sy(q.z);
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 30) return;
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    ctx.save();
    ctx.setLineDash([7, 6]);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(10, 7, 5, 0.75)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(ax + ux * 16, ay + uy * 16); ctx.lineTo(bx - ux * 14, by - uy * 14); ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 210, 122, 0.9)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  private drawMarkers() {
    const { ctx } = this;
    const placed: number[][] = [];
    const deep = this.zoom > this.fit * 2.2;
    // player box is taken first so labels keep off the arrow
    placed.push([this.sx(this.o.px) - 12, this.sy(this.o.pz) - 12, this.sx(this.o.px) + 12, this.sy(this.o.pz) + 12]);
    const shown: { k: Entry; x: number; y: number }[] = [];
    for (const k of this.markers) {
      const x = this.sx(k.m.x), y = this.sy(k.m.z);
      if (x < -40 || y < -40 || x > this.w + 40 || y > this.h + 40) continue;
      shown.push({ k, x, y });
      placed.push([x - 9, y - 9, x + 9, y + 9]);
    }
    // icons back to front (least important first), labels front to back so the important ones win
    for (let i = shown.length - 1; i >= 0; i--) {
      const { k, x, y } = shown[i];
      icon(ctx, k.role, k.m, x, y, k.m === this.selected || k.m === this.hover);
    }
    for (const { k, x, y } of shown) {
      const sel = k.m === this.selected || k.m === this.hover;
      const small = k.role === 'intel' || k.role === 'cache' || k.role === 'drone' || k.role === 'outpost';
      if (small && !deep && !sel) continue;
      this.label(k.role, k.m, x, y, placed, sel);
    }
  }

  private label(role: Role, m: MapMarker, x: number, y: number, placed: number[][], sel: boolean) {
    const { ctx } = this;
    const big = role === 'travel' || role === 'bunker';
    const text = big ? m.label.toUpperCase() : m.label;
    ctx.font = big ? `800 ${role === 'travel' ? 17 : 15}px ${DISPLAY}` : `600 ${role === 'quest' ? 13 : 12}px ${FONT}`;
    const w = ctx.measureText(text).width, hgt = big ? 16 : 13;
    const off = role === 'travel' ? 15 : 12;
    // right, left, above, below
    const spots: [number, number, CanvasTextAlign][] = [
      [x + off, y, 'left'], [x - off, y, 'right'], [x, y - off - hgt / 2, 'center'], [x, y + off + hgt / 2, 'center'],
    ];
    for (const [lx, ly, align] of spots) {
      const bx0 = align === 'left' ? lx : align === 'right' ? lx - w : lx - w / 2;
      const r = [bx0 - 3, ly - hgt / 2 - 2, bx0 + w + 3, ly + hgt / 2 + 2];
      const hit = placed.some((p) => !(p[0] === x - 9 && p[1] === y - 9) && r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1]);
      if (hit && !sel) continue;
      placed.push(r);
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(10, 7, 5, 0.9)';
      ctx.strokeText(text, lx, ly + 0.5);
      ctx.fillStyle = m.known === false ? 'rgba(200, 186, 160, 0.7)'
        : role === 'quest' ? '#ffd27a' : role === 'travel' ? '#ffe2b8' : role === 'bunker' || role === 'outpost' ? m.color : '#f3e9d8';
      ctx.fillText(text, lx, ly + 0.5);
      return;
    }
  }

  private drawPlayer() {
    const { ctx } = this;
    const x = this.sx(this.o.px), y = this.sy(this.o.pz);
    const a = -this.o.heading; // screen rotation for the look direction (north up)
    ctx.save();
    ctx.translate(x, y);
    // glow + view cone
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 26);
    g.addColorStop(0, 'rgba(63, 242, 224, 0.35)');
    g.addColorStop(1, 'rgba(63, 242, 224, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(a);
    const cone = ctx.createRadialGradient(0, 0, 4, 0, 0, 70);
    cone.addColorStop(0, 'rgba(63, 242, 224, 0.28)');
    cone.addColorStop(1, 'rgba(63, 242, 224, 0)');
    ctx.fillStyle = cone;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 70, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(8.5, 9); ctx.lineTo(0, 4.5); ctx.lineTo(-8.5, 9); ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#06110f';
    ctx.stroke();
    ctx.fillStyle = '#3ff2e0';
    ctx.fill();
    ctx.restore();
  }

  private scaleBar() {
    const { ctx } = this;
    const nice = [25, 50, 100, 200, 250, 500];
    let L = nice[nice.length - 1];
    for (const n of nice) if (n * this.zoom >= 70) { L = n; break; }
    const px = L * this.zoom, x = 18, y = this.h - 22;
    ctx.save();
    ctx.fillStyle = 'rgba(10, 7, 5, 0.75)';
    ctx.fillRect(x - 8, y - 22, px + 64, 34);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#1a120c' : '#e9d9bc';
      ctx.fillRect(x + (i * px) / 4, y - 3, px / 4, 6);
    }
    ctx.strokeStyle = '#e9d9bc';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 0.5, y - 3.5, px + 1, 7);
    ctx.font = `600 10px ${MONO}`;
    ctx.fillStyle = '#e9d9bc';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText('0', x - 2, y - 6);
    ctx.textAlign = 'center';
    ctx.fillText(`${L} m`, x + px, y - 6);
    ctx.restore();
  }

  private northArrow() {
    const { ctx } = this;
    const x = this.w - 28, y = 34;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(10, 7, 5, 0.7)';
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255, 179, 71, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(5, 4); ctx.lineTo(0, 1); ctx.lineTo(-5, 4); ctx.closePath();
    ctx.fillStyle = '#ffb347';
    ctx.fill();
    ctx.font = `700 9px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f3e9d8';
    ctx.fillText('N', 0, 11);
    ctx.restore();
  }
}

/** One marker's icon, centred on (x, y). Vector shapes with a dark outline; no canvas shadows (CPU blur in WebKitGTK). */
function icon(ctx: CanvasRenderingContext2D, role: Role, m: MapMarker, x: number, y: number, sel: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round';
  const ink = '#0c0806';
  const unknown = m.known === false;
  if (sel) {
    ctx.strokeStyle = 'rgba(255, 238, 200, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(0, 0, role === 'travel' ? 17 : 14, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  switch (role) {
    case 'travel': {
      // a round badge with a campfire: the places you can rest and travel between
      ctx.fillStyle = unknown ? 'rgba(20, 14, 10, 0.8)' : '#1c120b';
      ctx.strokeStyle = unknown ? 'rgba(255, 138, 42, 0.55)' : '#ff8a2a';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 10.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = unknown ? 'rgba(255, 179, 71, 0.5)' : '#ffb347';
      ctx.beginPath();
      ctx.moveTo(0, -6.5); ctx.quadraticCurveTo(5, -1, 3.6, 3); ctx.quadraticCurveTo(2.5, 5.2, 0, 5.2);
      ctx.quadraticCurveTo(-2.5, 5.2, -3.6, 3); ctx.quadraticCurveTo(-4.2, 0, -1.2, -2.2); ctx.quadraticCurveTo(-0.6, -4.5, 0, -6.5);
      ctx.fill();
      ctx.strokeStyle = unknown ? 'rgba(255, 179, 71, 0.5)' : '#ffb347';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-5, 6.5); ctx.lineTo(5, 6.5); ctx.stroke();
      break;
    }
    case 'quest': {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#ffd27a';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd27a';
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(0, -15);
        ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 2; ctx.stroke();
      }
      break;
    }
    case 'bunker': {
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(9, 6.5); ctx.lineTo(-9, 6.5); ctx.closePath();
      ctx.fillStyle = m.color; ctx.strokeStyle = ink; ctx.lineWidth = 2.2;
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = ink;
      ctx.fillRect(-1, -3, 2, 5);
      break;
    }
    case 'outpost': {
      ctx.fillStyle = '#1a0c0a'; ctx.strokeStyle = m.color; ctx.lineWidth = 2;
      ctx.fillRect(-6.5, -6.5, 13, 13); ctx.strokeRect(-6.5, -6.5, 13, 13);
      ctx.beginPath(); ctx.moveTo(-3.5, -3.5); ctx.lineTo(3.5, 3.5); ctx.moveTo(3.5, -3.5); ctx.lineTo(-3.5, 3.5);
      ctx.lineWidth = 1.8; ctx.stroke();
      break;
    }
    case 'pack': {
      ctx.fillStyle = '#ff8a2a'; ctx.strokeStyle = ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect?.(-6, -5, 12, 12, 3) ?? ctx.rect(-6, -5, 12, 12); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -5, 3.2, Math.PI, 0); ctx.stroke();
      break;
    }
    case 'cache': case 'drone': {
      ctx.fillStyle = m.color; ctx.strokeStyle = ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, role === 'drone' ? 4.5 : 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
    default: {
      // landmark / intel: a diamond (hollow while you haven't been there)
      const r = role === 'intel' ? 5 : 6.5;
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath();
      ctx.lineWidth = 2.4; ctx.strokeStyle = ink; ctx.stroke();
      if (unknown) {
        ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(243, 233, 216, 0.75)'; ctx.stroke();
      } else {
        ctx.fillStyle = m.color; ctx.fill();
      }
    }
  }
  ctx.restore();
}

const LEGEND: [Role, string][] = [
  ['travel', 'Safe place · fast travel'], ['landmark', 'Landmark'], ['bunker', 'Bunker'], ['outpost', 'Kade outpost'],
  ['quest', 'Tracked objective'], ['intel', 'Intel'], ['cache', 'Cache'], ['pack', 'Your pack'],
];
function legendIcon(role: Role) {
  const c = document.createElement('canvas');
  c.width = c.height = 52;
  const ctx = c.getContext('2d')!;
  ctx.scale(2, 2);
  const color = role === 'bunker' ? '#ff3a6e' : role === 'outpost' ? '#ff4a3a' : role === 'intel' ? '#c896ff' : role === 'cache' ? '#7ec8d4' : '#f3e9d8';
  icon(ctx, role, { id: '', x: 0, z: 0, label: '', color, kind: 'landmark' }, 13, 13, false);
  return c;
}

/** Builds the map panel. Returns the panel and a teardown (call on close). */
export function buildWorldMap(data: MapData, o: WorldMapOpts, close: () => void): { el: HTMLElement; stop: () => void } {
  const m = document.createElement('div');
  m.className = 'panel modal wmap interactive';
  m.innerHTML = `<div class="scan"></div>
    <header><h3>WASTELAND</h3><div class="label">${esc(o.sub)}</div></header>
    <div class="body wmap-body">
      <div class="wmap-stage"></div>
      <aside class="wmap-side">
        <div class="wmap-card"></div>
        <div class="label">Fast travel</div>
        ${o.travelBlocked ? `<div class="wmap-warn">${esc(o.travelBlocked)}</div>` : ''}
        <div class="wmap-travel">${o.travel.map((t) => `<button class="btn wmap-go" data-id="${esc(t.id)}" ${t.blocked || o.travelBlocked ? 'disabled' : ''}>
          <b>${esc(t.name)}</b><small>${esc(t.blocked ?? t.detail)}</small></button>`).join('')}</div>
        <div class="label wmap-legend-label">Legend</div>
        <div class="wmap-legend"></div>
        <div class="label">Intel gathered</div>
        <div class="intel-list">${o.intel.length ? o.intel.map((i) => `<div class="intel-item"><b>${esc(i.title)}</b><span>${esc(i.body)}</span></div>`).join('') : '<div class="intel-item"><span>Nothing yet. Rumour has it the old gas station has a note pinned up.</span></div>'}</div>
      </aside>
    </div>
    <footer><span class="kb">${o.hint}</span></footer>`;
  const view = new MapView(data, o);
  m.querySelector('.wmap-stage')!.appendChild(view.canvas);
  const legend = m.querySelector('.wmap-legend')!;
  for (const [role, text] of LEGEND) {
    const it = document.createElement('div');
    it.className = 'it';
    it.appendChild(legendIcon(role));
    it.appendChild(document.createTextNode(text));
    legend.appendChild(it);
  }
  const travelOf = (id: string) => o.travel.find((t) => t.id === id);
  const go = (id: string) => {
    const t = travelOf(id);
    if (!t || t.blocked || o.travelBlocked) { o.sound('deny'); return; }
    o.sound('ui');
    close();
    o.onTravel(id);
  };
  m.querySelectorAll<HTMLElement>('.wmap-go').forEach((b) => {
    b.onclick = () => go(b.dataset.id!);
    b.onmouseenter = () => {
      const mk = o.markers.find((k) => k.id === b.dataset.id);
      if (mk && mk !== view.selected) view.select(mk, true);
    };
  });
  const card = m.querySelector('.wmap-card') as HTMLElement;
  view.onSelect = (sel) => {
    if (!sel) {
      card.innerHTML = `<div class="wmap-tag">Survey sheet</div><p class="wmap-hintline">${o.device === 'touch' ? 'Tap a place to read it. Drag to pan, pinch to zoom.' : o.device === 'pad' ? 'Step between places with the bumpers.' : 'Click a place to read it.'}</p>`;
      return;
    }
    const role = roleOf(sel, new Set(o.travel.map((t) => t.id)));
    const d = Math.hypot(sel.x - o.px, sel.z - o.pz);
    const t = travelOf(sel.id);
    card.innerHTML = `<div class="wmap-tag ${role}">${TAG[role]}${sel.known === false ? ' · unvisited' : ''}</div>
      <h4>${esc(sel.label)}</h4>
      ${sel.note ? `<p>${esc(sel.note)}</p>` : ''}
      <div class="wmap-dist">${d < 25 ? 'You are here.' : `${distText(d)} ${bearing(sel.x - o.px, sel.z - o.pz)} of you`}</div>
      ${t ? `<button class="btn primary wmap-go-sel pad-default" ${t.blocked || o.travelBlocked ? 'disabled' : ''}>${t.blocked || o.travelBlocked ? esc(t.blocked ?? o.travelBlocked!) : `Travel · ${esc(t.detail)}`}</button>` : ''}`;
    const b = card.querySelector('.wmap-go-sel') as HTMLElement | null;
    if (b) b.onclick = () => go(sel.id);
  };
  // open on the tracked objective's card if there is one
  const q = o.markers.find((k) => k.id === 'quest');
  view.selected = q ?? null;
  view.onSelect(view.selected);

  const onKey = (e: KeyboardEvent) => {
    if (!m.isConnected) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
    if (e.type === 'keydown' && e.code === 'Enter' && view.selected && travelOf(view.selected.id)) { go(view.selected.id); return; }
    if (view.key(e.code, e.type === 'keydown')) e.preventDefault();
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  const onResize = () => view.resize();
  window.addEventListener('resize', onResize);
  // the pad: PadNav hands the frame here first (sticks pan/zoom, bumpers step, Y centres)
  (m as HTMLElement & { padMap?: (f: NavFrame) => NavFrame }).padMap = (f) => {
    if (f.x && view.selected && travelOf(view.selected.id)) { go(view.selected.id); return { ...f, x: false }; }
    return view.padFrame(f);
  };
  requestAnimationFrame(() => view.resize());
  return {
    el: m,
    stop: () => {
      view.stop();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('resize', onResize);
    },
  };
}

// ------------------------------------------------------------------ travel card
/**
 * The card shown while you walk: where from, where to, how long it took, what it cost. It sits
 * over the black fader; the returned function fades it out.
 */
export function travelCard(c: { from: string; to: string; walked: string; arrive: string; cost: string; blurb: string }) {
  const el = document.createElement('div');
  el.className = 'travel-card';
  el.innerHTML = `<div class="tc-route"><span>${esc(c.from)}</span><i></i><span>${esc(c.to)}</span></div>
    <div class="tc-name">${esc(c.to.toUpperCase())}</div>
    <div class="tc-blurb">${esc(c.blurb)}</div>
    <div class="tc-stats"><span><small>On foot</small>${esc(c.walked)}</span><span><small>Arrive</small>${esc(c.arrive)}</span><span><small>Cost</small>${esc(c.cost)}</span></div>`;
  // on the body, next to the fader: inside #ui (its own stacking context) it would sit under the black
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  return () => {
    el.classList.remove('on');
    setTimeout(() => el.remove(), 700);
  };
}
