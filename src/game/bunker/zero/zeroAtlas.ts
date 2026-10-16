import * as THREE from 'three/webgpu';
import { canvasTexture, grime, norm } from '../../world/kit';

/**
 * Bunker Zero's printed art in one canvas, through one alpha-tested material (one draw): Deepwell's
 * mark and plates, the showroom's bay headers and placards, the 1961 door's plate, the manway's lid,
 * the board's labels, the well's plate, the bunks' numbers, Agnes's drawings on the wall. The clock
 * over the gate is a live canvas (`paintClock`).
 */

type Draw = (c: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void;
interface Region { u0: number; u1: number; v0: number; v1: number }

const W = 2048, H = 2048, PAD = 4;
const DISPLAY = '"Big Shoulders Stencil Display", Impact, sans-serif';
const UI = '"Chakra Petch", Arial, sans-serif';
const MONO = '"JetBrains Mono", monospace';
/** Deepwell's enamel green, brass, cream, and civil-defence yellow. */
export const ENAMEL = '#2e4a3c';
export const BRASS = '#c9a24a';
const CREAM = '#efe6cf';
const INK = '#16140f';
const YELLOW = '#e8b81c';
const BLUE = '#1f4f86';

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

/** Deepwell's mark: a ring with a bore dropping through it and three strata across. */
export function wellMark(c: CanvasRenderingContext2D, cx: number, cy: number, s: number, ink: string) {
  c.save();
  c.strokeStyle = ink;
  c.fillStyle = ink;
  c.lineWidth = s * 0.14;
  c.beginPath(); c.arc(cx, cy, s, 0, Math.PI * 2); c.stroke();
  c.fillRect(cx - s * 0.08, cy - s * 1.25, s * 0.16, s * 2.5);
  for (let i = 0; i < 3; i++) c.fillRect(cx - s * 0.6 + i * s * 0.1, cy - s * 0.25 + i * s * 0.32, s * 1.2 - i * s * 0.2, s * 0.08);
  c.restore();
}

function wordmark(c: CanvasRenderingContext2D, x: number, y: number, h: number, ink: string, maxW: number) {
  wellMark(c, x + h * 0.45, y - h * 0.36, h * 0.38, ink);
  fit(c, 'DEEPWELL', x + h * 1.05, y, `800 ${h}px ${DISPLAY}`, ink, maxW - h * 1.05, 'left');
}

function lines(c: CanvasRenderingContext2D, ls: string[], x: number, y: number, lh: number, font: string, fill: string, maxW: number) {
  ls.forEach((l, i) => fit(c, l, x, y + i * lh, font, fill, maxW, 'left'));
}

/** A brass maker's plate: the name stamped large, the job number small. */
function plate(name: string, job: string): [number, number, Draw] {
  return [256, 96, (c, w, h, r) => {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#d9b864'); g.addColorStop(0.5, '#b28a3a'); g.addColorStop(1, '#cfae5c');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#6e5420'; c.lineWidth = 4; c.strokeRect(5, 5, w - 10, h - 10);
    for (const [x, y] of [[14, 14], [w - 14, 14], [14, h - 14], [w - 14, h - 14]]) { c.fillStyle = '#6e5420'; c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill(); }
    fit(c, name, w / 2, 54, `800 42px ${DISPLAY}`, '#3a2c10', w - 40);
    fit(c, `DEEPWELL · ${job}`, w / 2, 82, `600 16px ${MONO}`, '#4a3a18', w - 40);
    grime(c, w, h, 0.6, Math.floor(r() * 99));
  }];
}

/** A bay's header board over its display. */
function bay(n: number, name: string, what: string): [number, number, Draw, number] {
  return [768, 192, (c, w, h, r) => {
    c.fillStyle = ENAMEL; c.fillRect(0, 0, w, h);
    c.fillStyle = BRASS; c.fillRect(0, h - 14, w, 14);
    fit(c, String(n), 70, 140, `800 120px ${DISPLAY}`, BRASS, 110);
    fit(c, name, 150, 92, `800 70px ${DISPLAY}`, CREAM, w - 180, 'left');
    fit(c, what, 152, 146, `500 30px ${UI}`, '#b9c7bd', w - 180, 'left');
    grime(c, w, h, 0.5, Math.floor(r() * 99));
  }, 0.75];
}

const DRAW: Record<string, [number, number, Draw, number?]> = {
  showroom: [1024, 256, (c, w, h, r) => {
    c.fillStyle = ENAMEL; c.fillRect(0, 0, w, h);
    c.strokeStyle = BRASS; c.lineWidth = 6; c.strokeRect(14, 14, w - 28, h - 28);
    wordmark(c, 50, 130, 96, CREAM, 520);
    fit(c, 'SHELTER SYSTEMS · SHOWROOM', w - 50, 116, `700 40px ${UI}`, BRASS, 430, 'right');
    fit(c, 'EST. 1961 · WELLS · SHELTERS · DOORS', w / 2, 210, `500 30px ${UI}`, '#b9c7bd', w - 100);
    grime(c, w, h, 0.4, Math.floor(r() * 99));
  }, 0.75],
  fallout: [384, 384, (c, w, h, r) => {
    c.fillStyle = YELLOW; c.fillRect(0, 0, w, h);
    c.fillStyle = INK; c.fillRect(0, 0, w, 120);
    fit(c, 'FALLOUT', w / 2, 92, `800 92px ${DISPLAY}`, YELLOW, w - 30);
    // the trefoil
    const cx = w / 2, cy = 230, R = 80;
    c.fillStyle = INK;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
      c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, a - Math.PI / 6, a + Math.PI / 6); c.closePath(); c.fill();
    }
    c.fillStyle = YELLOW; c.beginPath(); c.arc(cx, cy, 22, 0, Math.PI * 2); c.fill();
    c.fillStyle = INK; c.beginPath(); c.arc(cx, cy, 15, 0, Math.PI * 2); c.fill();
    fit(c, 'SHELTER', w / 2, 360, `800 52px ${DISPLAY}`, INK, w - 30);
    grime(c, w, h, 1.0, Math.floor(r() * 99));
  }],
  door61: [512, 192, (c, w, h, r) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#cfae5c'); g.addColorStop(1, '#a8823a');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#5c461a'; c.lineWidth = 5; c.strokeRect(8, 8, w - 16, h - 16);
    fit(c, 'DEEPWELL DRILLING & SHELTER', w / 2, 58, `800 40px ${DISPLAY}`, '#3a2c10', w - 40);
    fit(c, 'MODEL 1 · BLAST & FALLOUT · 1961', w / 2, 108, `700 30px ${UI}`, '#3a2c10', w - 40);
    fit(c, 'W. PRICE, PROP. · OPENS FROM EITHER SIDE', w / 2, 152, `500 22px ${MONO}`, '#4a3a18', w - 40);
    grime(c, w, h, 0.9, Math.floor(r() * 99));
  }],
  manway: [384, 384, (c, w, h, r) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(232,184,28,0.92)';
    c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2); c.fill();
    c.fillStyle = INK;
    c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 34, 0, Math.PI * 2); c.fill();
    fit(c, 'DIESEL', w / 2, 170, `800 78px ${DISPLAY}`, YELLOW, w - 110);
    fit(c, '20,000 L', w / 2, 232, `700 44px ${MONO}`, YELLOW, w - 110);
    fit(c, 'NO NAKED FLAMES', w / 2, 284, `600 26px ${UI}`, YELLOW, w - 120);
    grime(c, w, h, 1.4, Math.floor(r() * 99));
  }],
  clockPlacard: [512, 192, (c, w, h, r) => {
    c.fillStyle = CREAM; c.fillRect(0, 0, w, h);
    c.fillStyle = '#c23a2a'; c.fillRect(0, 0, w, 44);
    fit(c, 'KADE HOLDINGS · AIRLOCK, PROTOTYPE 3', w / 2, 32, `700 26px ${UI}`, CREAM, w - 30);
    lines(c, ['"CODE ROTATES WITH LAUNCH CLOCK"', 'One code, read off the clock over the door.', 'DEEPWELL ADVISED AGAINST (see C.O. 12)'], 20, 90, 36, `500 24px ${MONO}`, INK, w - 40);
    grime(c, w, h, 0.6, Math.floor(r() * 99));
  }],
  boardLabels: [512, 512, (c, w, h, r) => {
    c.fillStyle = '#31382f'; c.fillRect(0, 0, w, h);
    c.fillStyle = BRASS; c.fillRect(0, 0, w, 56);
    fit(c, 'ZERO · GENERATOR 2 · 4 UNITS', w / 2, 40, `800 36px ${DISPLAY}`, INK, w - 20);
    const rows = ['CAMERAS · 1', 'GRID · 1', 'DOORMEN · 1', 'LIGHTS · 1', 'MODEL ZERO · 2'];
    rows.forEach((t, i) => fit(c, t, 30, 128 + i * 70, `700 36px ${MONO}`, CREAM, w - 60, 'left'));
    fit(c, 'Prototype of the Lattice board, S/N 7', w / 2, h - 24, `500 24px ${UI}`, '#d9c99a', w - 30);
    grime(c, w, h, 0.5, Math.floor(r() * 99));
  }],
  wellPlate: [512, 256, (c, w, h, r) => {
    c.fillStyle = ENAMEL; c.fillRect(0, 0, w, h);
    c.strokeStyle = BRASS; c.lineWidth = 5; c.strokeRect(10, 10, w - 20, h - 20);
    wellMark(c, 70, 74, 34, BRASS);
    fit(c, 'WELL No. 0', 130, 92, `800 64px ${DISPLAY}`, CREAM, w - 150, 'left');
    lines(c, ['BORE 2,100 FT · 8" CASING', 'COUNTY WATER PERMIT 0001 (TEST BORE)', 'APPROVED: M. VOSS, ENGINEER'], 30, 158, 32, `600 22px ${MONO}`, '#d9c99a', w - 60);
    grime(c, w, h, 0.5, Math.floor(r() * 99));
  }],
  cistern: [384, 128, (c, w, h, r) => {
    c.fillStyle = ENAMEL; c.fillRect(0, 0, w, h);
    fit(c, 'CISTERN · 180,000 L', w / 2, 62, `800 46px ${DISPLAY}`, CREAM, w - 30);
    fit(c, 'POTABLE · DRAW FROM THE BOTTOM TAP', w / 2, 104, `600 20px ${MONO}`, BRASS, w - 30);
    grime(c, w, h, 0.6, Math.floor(r() * 99));
  }],
  stores: [512, 128, (c, w, h, r) => {
    c.fillStyle = ENAMEL; c.fillRect(0, 0, w, h);
    fit(c, 'STORES · 200 PERSONS · 10 YEARS', w / 2, 60, `800 46px ${DISPLAY}`, CREAM, w - 30);
    fit(c, 'FIRST IN, FIRST OUT. COUNT IT ON THE 1ST.', w / 2, 104, `600 22px ${MONO}`, BRASS, w - 30);
    grime(c, w, h, 0.6, Math.floor(r() * 99));
  }],
  dorm: [512, 128, (c, w, h, r) => {
    c.fillStyle = ENAMEL; c.fillRect(0, 0, w, h);
    fit(c, 'DORMITORY · BUNKS 1 – 200', w / 2, 62, `800 50px ${DISPLAY}`, CREAM, w - 30);
    fit(c, 'LIGHTS OUT 22:00 · NO COOKING ON BUNKS', w / 2, 104, `600 22px ${MONO}`, BRASS, w - 30);
    grime(c, w, h, 0.6, Math.floor(r() * 99));
  }],
  ladder: [256, 128, (c, w, h, r) => {
    c.fillStyle = ENAMEL; c.fillRect(0, 0, w, h);
    fit(c, '↑ SURFACE', w / 2, 58, `800 46px ${DISPLAY}`, CREAM, w - 20);
    fit(c, '60 RUNGS', w / 2, 100, `600 26px ${MONO}`, BRASS, w - 20);
    grime(c, w, h, 0.7, Math.floor(r() * 99));
  }],
  office: [384, 96, (c, w, h, r) => {
    c.fillStyle = CREAM; c.fillRect(0, 0, w, h);
    fit(c, 'A. PRICE · ESTIMATING', w / 2, 60, `700 34px ${UI}`, INK, w - 20);
    grime(c, w, h, 0.4, Math.floor(r() * 99));
  }],
  surfaceLine: [384, 128, (c, w, h, r) => {
    c.fillStyle = '#b8321e'; c.fillRect(0, 0, w, h);
    fit(c, 'SURFACE LINE', w / 2, 58, `800 50px ${DISPLAY}`, CREAM, w - 20);
    fit(c, 'RED HANDLE · DOWN = FORECOURT', w / 2, 100, `600 20px ${MONO}`, CREAM, w - 20);
    grime(c, w, h, 0.6, Math.floor(r() * 99));
  }],
  stripes: [512, 64, (c, w, h) => {
    c.fillStyle = YELLOW; c.fillRect(0, 0, w, h);
    c.fillStyle = INK;
    for (let x = -h; x < w + h; x += 64) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + 32, h); c.lineTo(x + 32 + h, 0); c.lineTo(x + h, 0); c.closePath(); c.fill(); }
  }],
  placard: [384, 512, (c, w, h, r) => {
    c.fillStyle = CREAM; c.fillRect(0, 0, w, h);
    c.fillStyle = ENAMEL; c.fillRect(0, 0, w, 70);
    wellMark(c, 40, 36, 20, BRASS);
    fit(c, 'CHANGE ORDERS', 74, 50, `700 34px ${UI}`, CREAM, w - 90, 'left');
    c.fillStyle = 'rgba(30,30,30,0.55)';
    for (let i = 0; i < 13; i++) {
      const y = 104 + i * 28;
      c.fillRect(24, y, (w - 48) * (0.55 + r() * 0.45), 6);
      if (i % 4 === 3) c.fillRect(24, y + 10, 0, 0);
    }
    c.strokeStyle = '#b8261b'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(24, 230); c.lineTo(w - 40, 226); c.stroke();
    fit(c, 'signed: ________   A.P.', 24, h - 30, `500 24px ${MONO}`, '#333', w - 48, 'left');
    grime(c, w, h, 0.6, Math.floor(r() * 99));
  }, 0.75],
  blueprintA: [512, 384, (c, w, h, r) => {
    c.fillStyle = BLUE; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(230,240,255,0.85)'; c.lineWidth = 2;
    c.strokeRect(20, 20, w - 40, h - 40);
    // a round door in elevation, eight cylinders round its rim
    c.beginPath(); c.arc(w / 2, h / 2 - 10, 120, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(w / 2, h / 2 - 10, 96, 0, Math.PI * 2); c.stroke();
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; c.beginPath(); c.arc(w / 2 + Math.cos(a) * 108, h / 2 - 10 + Math.sin(a) * 108, 9, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.arc(w / 2, h / 2 - 10, 14, 0, Math.PI * 2); c.stroke();
    fit(c, 'MODEL ZERO · ELEVATION · SHEET 1 OF 9', w / 2, h - 34, `600 20px ${MONO}`, 'rgba(230,240,255,0.9)', w - 60);
    grime(c, w, h, 0.5, Math.floor(r() * 99));
  }, 0.75],
  blueprintB: [512, 384, (c, w, h, r) => {
    c.fillStyle = BLUE; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(230,240,255,0.85)'; c.lineWidth = 2;
    c.strokeRect(20, 20, w - 40, h - 40);
    // a section: the forecourt, the shaft, the showroom, the well going down off the sheet
    c.beginPath(); c.moveTo(30, 80); c.lineTo(w - 30, 80); c.stroke();
    c.strokeRect(70, 80, 18, 150);
    c.strokeRect(70, 230, 300, 50);
    c.strokeRect(370, 210, 90, 70);
    c.beginPath(); c.moveTo(415, 280); c.lineTo(415, h - 40); c.stroke();
    fit(c, 'LAST CHANCE', 120, 66, `600 18px ${MONO}`, 'rgba(230,240,255,0.9)', 200, 'left');
    fit(c, '2,100 FT ↓', 425, h - 50, `600 18px ${MONO}`, 'rgba(230,240,255,0.9)', 80, 'left');
    fit(c, 'ZERO · SECTION A–A · SHEET 2 OF 9', w / 2, h - 30, `600 18px ${MONO}`, 'rgba(230,240,255,0.9)', w - 60);
    grime(c, w, h, 0.5, Math.floor(r() * 99));
  }, 0.75],
  bunk: [128, 64, (c, w, h) => {
    c.fillStyle = CREAM; c.fillRect(0, 0, w, h);
    fit(c, 'BUNK', w / 2, 40, `700 30px ${MONO}`, INK, w - 10);
  }],
  // the bay headers down the showroom
  bay1: bay(1, 'PIVOTSON', 'Project Garage · fence, drone, a vault you can guess'),
  bay2: bay(2, 'KADE', 'Apex Vault · the airlock that reads the clock'),
  bay3: bay(3, 'SEYMOUR', 'The Panopticon · one man, every camera'),
  bay4: bay(4, 'ASHBY', 'The Alignment Spire · a grid, and a door that asks'),
  bay5: bay(5, 'VALE', 'The Singularity Dome · the gate that knew his voice'),
  bay6: bay(6, 'SAYLE', 'The Cloud Cathedral · every door opens for a customer'),
  bay7: bay(7, 'SZABO', 'The Chip Fortress · the board, and the cold'),
  // the plates on Model Zero, and the master board's switches
  pPIVOTSON: plate('PIVOTSON', 'JOB 0412'),
  pKADE: plate('KADE', 'JOB 0430'),
  pSEYMOUR: plate('SEYMOUR', 'JOB 0447'),
  pASHBY: plate('ASHBY', 'JOB 0455'),
  pVALE: plate('VALE', 'JOB 0461'),
  pSAYLE: plate('SAYLE', 'JOB 0470'),
  pSZABO: plate('SZABO', 'JOB 0478'),
  pZERO: plate('ZERO', 'JOB 0000'),
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
      if (top + h > H) throw new Error('zero atlas full at ' + name);
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
export function zeroPrint(name: string, w: number, h: number, m: THREE.Matrix4) {
  const r = atlas().regions[name];
  if (!r) throw new Error('no zero print ' + name);
  const g = new THREE.PlaneGeometry(w, h);
  const a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, r.u0 + a.getX(i) * (r.u1 - r.u0), r.v0 + a.getY(i) * (r.v1 - r.v0));
  return norm(g.applyMatrix4(m));
}

let _mat: THREE.MeshStandardNodeMaterial | null = null;
/** Lit, alpha-tested (letters on clear), double-sided. */
export function zeroPrintMaterial() {
  if (_mat) return _mat;
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, side: THREE.DoubleSide, alphaTest: 0.45 });
  m.map = atlas().tex;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  return (_mat = m);
}

/** The flip clock over the gate: the time, 24-hour, as the keypad wants it. */
export function paintClock(c: CanvasRenderingContext2D, w: number, h: number, hhmm: string) {
  c.fillStyle = '#0b0b0a'; c.fillRect(0, 0, w, h);
  const cell = (w - 60) / 4;
  for (let i = 0; i < 4; i++) {
    const x = 20 + i * cell + (i >= 2 ? 20 : 0);
    c.fillStyle = '#1c1c1a'; c.fillRect(x, 16, cell - 10, h - 32);
    c.fillStyle = '#000'; c.fillRect(x, h / 2 - 2, cell - 10, 4);
    fit(c, hhmm[i] ?? '0', x + (cell - 10) / 2, h - 34, `700 ${Math.round(h * 0.72)}px ${MONO}`, '#f2e6c8', cell - 16);
  }
  c.fillStyle = '#f2e6c8';
  const cx = 20 + 2 * cell + 5;
  c.beginPath(); c.arc(cx, h * 0.38, 7, 0, Math.PI * 2); c.arc(cx, h * 0.62, 7, 0, Math.PI * 2); c.fill();
}
