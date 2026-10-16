import * as THREE from 'three/webgpu';
import { canvasTexture, grime, norm } from '../../world/kit';

/**
 * The Chip Fortress's printed art in one canvas, through one alpha-tested material (one draw):
 * Lattice's hexagon, the gatehouse and the queue, warning plates on the moat, the board's labels, the
 * lockers, the vault's glass and its racks' box labels, Kit's desk plate. The allocation board in the
 * vault is a live canvas (`paintBoard`).
 */

type Draw = (c: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void;
interface Region { u0: number; u1: number; v0: number; v1: number }

const W = 2048, H = 2048, PAD = 4;
const DISPLAY = '"Big Shoulders Stencil Display", Impact, sans-serif';
const UI = '"Chakra Petch", Arial, sans-serif';
const MONO = '"JetBrains Mono", monospace';
/** Lattice's ice blue, its graphite, frost white, warning amber. */
export const ICE = '#7fd6ff';
const INK = '#121417';
const FROST = '#eef4f6';
const AMBER = '#f2b030';

function rng(seed: number) {
  let s = (seed * 2654435761) % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function fit(c: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, fill: string, maxW: number, align: CanvasTextAlign = 'center') {
  c.font = font;
  c.fillStyle = fill;
  c.textAlign = align;
  const m = c.measureText(text).width;
  c.save();
  c.translate(x, y);
  if (m > maxW) c.scale(maxW / m, 1);
  c.fillText(text, 0, 0);
  c.restore();
}

/** Lattice's mark: a flat hexagon with a smaller one inside, pins on two sides (a chip). */
export function hexMark(c: CanvasRenderingContext2D, cx: number, cy: number, s: number, ink: string) {
  c.save();
  c.strokeStyle = ink;
  c.fillStyle = ink;
  c.lineWidth = s * 0.12;
  const hex = (r: number) => {
    c.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; c[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    c.closePath();
  };
  hex(s);
  c.stroke();
  hex(s * 0.45);
  c.fill();
  for (let i = -1; i <= 1; i++) { c.fillRect(cx - s * 1.3, cy + i * s * 0.3 - s * 0.05, s * 0.3, s * 0.1); c.fillRect(cx + s, cy + i * s * 0.3 - s * 0.05, s * 0.3, s * 0.1); }
  c.restore();
}

function wordmark(c: CanvasRenderingContext2D, x: number, y: number, h: number, ink: string, maxW: number) {
  hexMark(c, x + h * 0.5, y - h * 0.34, h * 0.36, ink);
  fit(c, 'LATTICE', x + h * 1.15, y, `600 ${h}px ${UI}`, ink, maxW - h * 1.15, 'left');
}

function lines(c: CanvasRenderingContext2D, ls: string[], x: number, y: number, lh: number, font: string, fill: string, maxW: number) {
  ls.forEach((l, i) => fit(c, l, x, y + i * lh, font, fill, maxW, 'left'));
}

const DRAW: Record<string, [number, number, Draw, number?]> = {
  gatehouse: [1024, 384, (c, w, h, r) => {
    c.fillStyle = INK; c.fillRect(0, 0, w, h);
    wordmark(c, 50, 120, 90, ICE, 460);
    fit(c, 'ALLOCATION GATE', 50, 240, `800 110px ${DISPLAY}`, FROST, w - 100, 'left');
    fit(c, 'CUSTOMERS WILL BE NOTIFIED · TAKE A NUMBER · DO NOT APPROACH THE MOAT', 50, 320, `500 28px ${UI}`, '#9aa6ae', w - 100, 'left');
    grime(c, w, h, 0.5, Math.floor(r() * 99));
  }, 0.75],
  roadSign: [640, 400, (c, w, h, r) => {
    c.fillStyle = FROST; c.fillRect(0, 0, w, h);
    c.fillStyle = INK; c.fillRect(0, 0, w, 120);
    wordmark(c, 34, 88, 70, ICE, 420);
    fit(c, 'THE FORTRESS', 34, 200, `800 64px ${DISPLAY}`, INK, w - 68, 'left');
    fit(c, 'ALLOCATION QUEUE: 400 m', 34, 262, `600 38px ${UI}`, INK, w - 68, 'left');
    fit(c, 'Have your number ready', 34, 330, `400 26px ${UI}`, '#5c5850', w - 68, 'left');
    grime(c, w, h, 0.9, Math.floor(r() * 99));
  }, 0.8],
  ticket: [256, 384, (c, w, h, r) => {
    c.fillStyle = '#d63a2a'; c.fillRect(0, 0, w, h);
    fit(c, 'TAKE A', w / 2, 70, `800 54px ${DISPLAY}`, FROST, w - 20);
    fit(c, 'NUMBER', w / 2, 128, `800 54px ${DISPLAY}`, FROST, w - 20);
    c.fillStyle = INK; c.fillRect(30, 170, w - 60, 90);
    fit(c, '0419', w / 2, 238, `700 64px ${MONO}`, AMBER, w - 80);
    fit(c, 'NOW SERVING: —', w / 2, 320, `600 28px ${MONO}`, FROST, w - 30);
    grime(c, w, h, 0.9, Math.floor(r() * 99));
  }],
  moatWarn: [512, 256, (c, w, h, r) => {
    c.fillStyle = AMBER; c.fillRect(0, 0, w, h);
    c.fillStyle = INK; c.fillRect(0, 0, w, 20); c.fillRect(0, h - 20, w, 20);
    fit(c, 'COOLANT · −40 °C', w / 2, 112, `800 74px ${DISPLAY}`, INK, w - 40);
    fit(c, 'Contact causes injury. Do not enter the moat.', w / 2, 180, `600 28px ${UI}`, INK, w - 40);
    grime(c, w, h, 0.8, Math.floor(r() * 99));
  }],
  pumpSign: [512, 160, (c, w, h, r) => {
    c.fillStyle = INK; c.fillRect(0, 0, w, h);
    hexMark(c, 60, 80, 34, ICE);
    fit(c, 'PUMP HOUSE · MOAT', 120, 96, `700 50px ${UI}`, FROST, w - 140, 'left');
    grime(c, w, h, 0.7, Math.floor(r() * 99));
  }],
  frostDoor: [256, 128, (c, w, h, r) => {
    c.fillStyle = '#2a2f33'; c.fillRect(0, 0, w, h);
    fit(c, 'FROST DOOR', w / 2, 56, `700 40px ${DISPLAY}`, FROST, w - 20);
    fit(c, 'technicians only', w / 2, 100, `400 24px ${UI}`, '#a6b2ba', w - 20);
    grime(c, w, h, 0.9, Math.floor(r() * 99));
  }],
  keepSign: [768, 192, (c, w, h, r) => {
    c.fillStyle = INK; c.fillRect(0, 0, w, h);
    wordmark(c, 40, 120, 80, ICE, 380);
    fit(c, 'ALLOCATION IN PROGRESS', w - 30, 120, `700 46px ${DISPLAY}`, AMBER, 360, 'right');
    grime(c, w, h, 0.4, Math.floor(r() * 99));
  }],
  boardLabels: [512, 512, (c, w, h, r) => {
    c.fillStyle = '#2b3036'; c.fillRect(0, 0, w, h);
    c.fillStyle = AMBER; c.fillRect(0, 0, w, 56);
    fit(c, 'FORTRESS POWER · 3 UNITS', w / 2, 40, `800 36px ${DISPLAY}`, INK, w - 20);
    const rows = ['CHILLERS · 1', 'HALL GRID · 1', 'LIGHTS · 1', 'VAULT DOOR · 2'];
    rows.forEach((t, i) => fit(c, t, 30, 140 + i * 96, `700 40px ${MONO}`, FROST, w - 60, 'left'));
    fit(c, 'Do not switch off the chillers. — K.', w / 2, h - 24, `500 26px ${UI}`, '#ffb0a0', w - 30);
    grime(c, w, h, 0.5, Math.floor(r() * 99));
  }],
  lockers: [512, 384, (c, w, h, r) => {
    c.fillStyle = '#56606a'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(8 + i * 126, 8, 118, h - 16);
      c.fillStyle = '#c9d2d8'; c.fillRect(24 + i * 126, 40, 80, 26);
      fit(c, ['MAREK', 'IDA', 'TOMAS', '—'][i], 64 + i * 126, 60, `700 20px ${UI}`, INK, 76);
      c.fillStyle = 'rgba(0,0,0,0.4)';
      for (let k = 0; k < 6; k++) c.fillRect(40 + i * 126, 110 + k * 12, 50, 4);
    }
    grime(c, w, h, 0.8, Math.floor(r() * 99));
  }],
  heatLog: [384, 512, (c, w, h, r) => {
    c.fillStyle = '#eceae4'; c.fillRect(0, 0, w, h);
    fit(c, 'HEAT LOG', 24, 50, `700 40px ${UI}`, '#1b3f8a', w - 48, 'left');
    lines(c, ['1 unit / person / day', 'Day 1,281: 5 units', 'Day 1,282: 5 units', 'Day 1,283: 5 units', 'Day 1,284: 5 units', '', 'Ida\'s fingers: Doc?', 'Ask K. for a 6th unit'], 24, 110, 44, `400 28px ${UI}`, '#22242a', w - 48);
    c.strokeStyle = '#b8261b'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(20, 450); c.lineTo(w - 30, 445); c.stroke();
    grime(c, w, h, 0.5, Math.floor(r() * 99));
  }],
  boxLabel: [256, 128, (c, w, h) => {
    c.fillStyle = '#16191c'; c.fillRect(0, 0, w, h);
    hexMark(c, 40, 64, 22, ICE);
    fit(c, 'LATTICE H900', 76, 54, `700 26px ${UI}`, FROST, w - 90, 'left');
    fit(c, 'MSRP $1,599', 76, 92, `500 22px ${MONO}`, AMBER, w - 90, 'left');
  }],
  vaultGlass: [512, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    fit(c, 'ALLOCATION FLOOR · AUTHORISED ALLOCATIONS ONLY', w / 2, 76, `600 30px ${UI}`, 'rgba(238,244,246,0.85)', w - 20);
  }],
  deskPlate: [256, 96, (c, w, h) => {
    c.fillStyle = '#c0c8cc'; c.fillRect(0, 0, w, h);
    fit(c, 'K. SZABO', w / 2, 62, `700 40px ${UI}`, INK, w - 20);
  }],
  queueBanner: [768, 192, (c, w, h, r) => {
    c.fillStyle = FROST; c.fillRect(0, 0, w, h);
    fit(c, 'ALLOCATION QUEUE', w / 2, 92, `800 84px ${DISPLAY}`, INK, w - 40);
    fit(c, 'Your patience is part of the product', w / 2, 152, `500 32px ${UI}`, '#5c5850', w - 40);
    grime(c, w, h, 1.0, Math.floor(r() * 99));
  }, 0.75],
  coolerPlate: [256, 64, (c, w, h) => {
    c.fillStyle = INK; c.fillRect(0, 0, w, h);
    fit(c, 'DRY COOLER · 400 kW', w / 2, 42, `600 26px ${MONO}`, ICE, w - 16);
  }],
};

let _atlas: { tex: THREE.CanvasTexture; regions: Record<string, Region> } | null = null;

function atlas() {
  if (_atlas) return _atlas;
  const items = Object.entries(DRAW).map(([name, [w0, h0, draw, k = 1]]) => [name, [Math.round(w0 * k), Math.round(h0 * k), draw, k, w0, h0]] as const).sort((a, b) => b[1][1] - a[1][1]);
  const regions: Record<string, Region> = {};
  const placed: { name: string; x: number; y: number; w: number; h: number; draw: Draw; k: number; w0: number; h0: number }[] = [];
  const rows: { y: number; h: number; x: number }[] = [];
  let top = 0;
  for (const [name, [w, h, draw, k, w0, h0]] of items) {
    let row = rows.find((r) => r.h >= h && r.x + w <= W);
    if (!row) {
      if (top + h > H) throw new Error('fortress atlas full at ' + name);
      row = { y: top, h, x: 0 };
      rows.push(row);
      top += h + PAD;
    }
    const x = row.x, y = row.y;
    placed.push({ name, x, y, w, h, draw, k, w0, h0 });
    regions[name] = { u0: (x + 1) / W, u1: (x + w - 1) / W, v0: 1 - (y + h - 1) / H, v1: 1 - (y + 1) / H };
    row.x += w + PAD;
  }
  const tex = canvasTexture(W, H, (c) => {
    c.clearRect(0, 0, W, H);
    for (const p of placed) {
      c.save();
      c.translate(p.x, p.y);
      c.beginPath(); c.rect(0, 0, p.w, p.h); c.clip();
      c.scale(p.k, p.k);
      p.draw(c, p.w0, p.h0, rng(p.name.length * 31 + p.w0));
      c.restore();
    }
  });
  tex.anisotropy = 4;
  _atlas = { tex, regions };
  return _atlas;
}

/** A w×h quad showing `name`, built facing +z, then placed by `m`. */
export function fortPrint(name: string, w: number, h: number, m: THREE.Matrix4) {
  const r = atlas().regions[name];
  if (!r) throw new Error('no fortress print ' + name);
  const g = new THREE.PlaneGeometry(w, h);
  const a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, r.u0 + a.getX(i) * (r.u1 - r.u0), r.v0 + a.getY(i) * (r.v1 - r.v0));
  return norm(g.applyMatrix4(m));
}

let _mat: THREE.MeshStandardNodeMaterial | null = null;
/** Lit, alpha-tested (letters on clear), double-sided. */
export function fortPrintMaterial() {
  if (_mat) return _mat;
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, side: THREE.DoubleSide, alphaTest: 0.45 });
  m.map = atlas().tex;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  return (_mat = m);
}

// ------------------------------------------------------------------ the allocation board in the vault
export interface BoardView {
  window: number;
  /** Rows: name and units. */
  rows: { name: string; units: number }[];
  power: { chillers: boolean; grid: boolean; lights: boolean; vault: boolean };
  status: 'live' | 'thermal' | 'shut' | 'realloc';
  price: string;
}

export function paintBoard(c: CanvasRenderingContext2D, w: number, h: number, v: BoardView) {
  c.fillStyle = '#06080a'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#0f1418'; c.fillRect(10, 10, w - 20, h - 20);
  hexMark(c, 56, 60, 26, ICE);
  fit(c, `LATTICE · ALLOCATION WINDOW ${String(v.window).padStart(4, '0')}`, 100, 72, `600 32px ${UI}`, '#d8e4ea', 620, 'left');
  fit(c, `H900 SPOT: ${v.price}`, w - 30, 72, `700 30px ${MONO}`, v.price.startsWith('—') ? '#7d8a96' : AMBER, 300, 'right');
  c.fillStyle = '#26303b'; c.fillRect(30, 96, w - 60, 3);
  v.rows.slice(0, 6).forEach((r, i) => {
    const y = 150 + i * 46;
    fit(c, r.name, 40, y, `600 30px ${UI}`, '#e9eef2', 520, 'left');
    fit(c, `${r.units} unit${r.units === 1 ? '' : 's'}`, w - 40, y, `700 30px ${MONO}`, r.units > 0 ? '#5fe08a' : '#7d8a96', 300, 'right');
  });
  const y0 = h - 70;
  c.fillStyle = '#26303b'; c.fillRect(30, y0 - 30, w - 60, 3);
  const msg = v.status === 'shut' ? ['CHILLERS: MASTER OFF · STOCK TEMPERATURE RISING', '#ff5a4a']
    : v.status === 'thermal' ? ['THERMAL EVENT · CHILLERS OFFLINE', '#ffb347']
      : v.status === 'realloc' ? ['TURBINE ON THE CAMP LINE · WINDOW OPEN', '#5fe08a']
        : ['ALL STOCK AT −4 °C · WINDOW CLOSED', ICE];
  fit(c, msg[0], 40, y0 + 18, `700 32px ${MONO}`, msg[1], w - 80, 'left');
}
