import * as THREE from 'three/webgpu';
import { canvasTexture, grime, norm } from '../../world/kit';

/**
 * The Cloud Cathedral's printed art in one canvas, through one alpha-tested material (one draw):
 * Dropt's arrow and signs, the lot and the dock, the returns kiosk, the culture banners in the nave,
 * aisle numbers, Lo's whiteboard, the plaque and the office plate. The rose window is its own canvas
 * (`roseTexture`: a clock in coloured glass, lit from inside at night), and the board over the altar
 * is a live canvas (`paintBoard`), repainted when anything on it changes.
 */

type Draw = (c: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void;
interface Region { u0: number; u1: number; v0: number; v1: number }

const W = 2048, H = 2048, PAD = 4;
const DISPLAY = '"Big Shoulders Stencil Display", Impact, sans-serif';
const UI = '"Chakra Petch", Arial, sans-serif';
const MONO = '"JetBrains Mono", monospace';
/** Dropt's orange, its ink, its paper, and the floor-marking yellow. */
export const ORANGE = '#f26a1b';
const INK = '#16181b';
const PAPER = '#f4f1ea';
const LINE = '#f2c230';

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

/** Dropt's mark: an arrow leaving a box (a rounded square, open on the right). */
export function arrowMark(c: CanvasRenderingContext2D, cx: number, cy: number, s: number, ink: string, bg?: string) {
  c.save();
  if (bg) {
    c.fillStyle = bg;
    c.beginPath();
    c.roundRect(cx - s, cy - s, s * 2, s * 2, s * 0.35);
    c.fill();
  }
  c.strokeStyle = ink;
  c.fillStyle = ink;
  c.lineWidth = s * 0.22;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(cx + s * 0.2, cy - s * 0.55);
  c.lineTo(cx - s * 0.55, cy - s * 0.55);
  c.lineTo(cx - s * 0.55, cy + s * 0.55);
  c.lineTo(cx + s * 0.2, cy + s * 0.55);
  c.stroke();
  c.beginPath();
  c.moveTo(cx - s * 0.15, cy);
  c.lineTo(cx + s * 0.45, cy);
  c.stroke();
  c.beginPath();
  c.moveTo(cx + s * 0.75, cy);
  c.lineTo(cx + s * 0.35, cy - s * 0.32);
  c.lineTo(cx + s * 0.35, cy + s * 0.32);
  c.closePath();
  c.fill();
  c.restore();
}

function wordmark(c: CanvasRenderingContext2D, x: number, y: number, h: number, ink: string, maxW: number, box?: string) {
  arrowMark(c, x + h * 0.45, y - h * 0.34, h * 0.42, ink, box);
  fit(c, 'dropt', x + h * 1.05, y, `700 ${h}px ${UI}`, ink, maxW - h * 1.05, 'left');
}

function lines(c: CanvasRenderingContext2D, ls: string[], x: number, y: number, lh: number, font: string, fill: string, maxW: number) {
  ls.forEach((l, i) => fit(c, l, x, y + i * lh, font, fill, maxW, 'left'));
}

/** A culture banner hung in the nave (orange on ink, tall). */
function banner(text: string[]): [number, number, Draw, number] {
  return [256, 768, (c, w, h, r) => {
    c.fillStyle = INK; c.fillRect(0, 0, w, h);
    c.fillStyle = ORANGE; c.fillRect(0, 0, w, 14); c.fillRect(0, h - 14, w, 14);
    arrowMark(c, w / 2, 100, 44, PAPER, ORANGE);
    text.forEach((t, i) => fit(c, t, w / 2, 270 + i * 96, `700 84px ${DISPLAY}`, PAPER, w - 40));
    grime(c, w, h, 0.4, Math.floor(r() * 99));
  }, 0.75];
}

/** name → [width, height, draw, scale]: drawn at width × height, stored at `scale` of that. */
const DRAW: Record<string, [number, number, Draw, number?]> = {
  // over the front doors, and the doors themselves
  facade: [1024, 256, (c, w, h, r) => {
    c.fillStyle = INK; c.fillRect(0, 0, w, h);
    wordmark(c, 50, 150, 110, PAPER, 330, ORANGE);
    fit(c, 'THE CATHEDRAL', w - 40, 150, `800 104px ${DISPLAY}`, PAPER, 560, 'right');
    fit(c, 'FULFILMENT CENTRE 0001 · EST. YEAR OF THE CUSTOMER', w / 2, 220, `500 26px ${UI}`, '#a9a39a', w - 100);
    grime(c, w, h, 0.5, Math.floor(r() * 99));
  }],
  frontDoor: [512, 512, (c, w, h, r) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(244,241,234,0.92)';
    c.fillRect(40, 120, w - 80, 250);
    fit(c, 'CUSTOMER ENTRANCE', w / 2, 190, `700 48px ${UI}`, INK, w - 110);
    fit(c, 'Opens at shift end', w / 2, 250, `400 34px ${UI}`, '#5c5850', w - 110);
    fit(c, 'Shift end: —', w / 2, 320, `500 30px ${MONO}`, '#a33a12', w - 110);
    grime(c, w, h, 0.4, Math.floor(r() * 99));
  }, 0.75],
  // the lot
  roadSign: [640, 400, (c, w, h, r) => {
    c.fillStyle = PAPER; c.fillRect(0, 0, w, h);
    c.fillStyle = ORANGE; c.fillRect(0, 0, w, 120);
    wordmark(c, 34, 88, 72, PAPER, 420);
    fit(c, 'DELIVERY VEHICLES ONLY', 34, 200, `800 56px ${DISPLAY}`, INK, w - 68, 'left');
    fit(c, 'THE CATHEDRAL · 300 m', 34, 262, `600 38px ${UI}`, INK, w - 68, 'left');
    fit(c, 'Drones have right of way', 34, 330, `400 26px ${UI}`, '#5c5850', w - 68, 'left');
    grime(c, w, h, 0.9, Math.floor(r() * 99));
  }, 0.8],
  lotSign: [512, 256, (c, w, h, r) => {
    c.fillStyle = INK; c.fillRect(0, 0, w, h);
    fit(c, 'RIDER LOT', w / 2, 96, `800 84px ${DISPLAY}`, LINE, w - 40);
    fit(c, 'Wait in your bay. A drone will find you.', w / 2, 160, `400 28px ${UI}`, PAPER, w - 40);
    fit(c, 'BAYS 1–40', w / 2, 214, `600 30px ${MONO}`, '#9a948a', w - 40);
    grime(c, w, h, 0.8, Math.floor(r() * 99));
  }],
  bay: [256, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    fit(c, 'RIDER BAY', w / 2, 52, `700 40px ${DISPLAY}`, 'rgba(242,194,48,0.85)', w - 20);
    fit(c, 'NO PARKING', w / 2, 104, `600 34px ${DISPLAY}`, 'rgba(242,194,48,0.6)', w - 20);
  }],
  lockers: [512, 512, (c, w, h, r) => {
    c.fillStyle = ORANGE; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) c.fillRect(20 + i * 122, 120 + j * 96, 112, 86);
    wordmark(c, 30, 88, 64, PAPER, 300);
    fit(c, 'PICKUP', w - 30, 88, `800 60px ${DISPLAY}`, PAPER, 180, 'right');
    grime(c, w, h, 0.9, Math.floor(r() * 99));
  }, 0.75],
  // the dock and the returns kiosk
  dock: [512, 256, (c, w, h, r) => {
    c.fillStyle = LINE; c.fillRect(0, 0, w, h);
    c.fillStyle = INK; c.fillRect(0, 0, w, 24); c.fillRect(0, h - 24, w, 24);
    fit(c, 'INBOUND DOCK', w / 2, 120, `800 84px ${DISPLAY}`, INK, w - 40);
    fit(c, 'NO PEDESTRIANS PAST THIS POINT', w / 2, 190, `600 30px ${UI}`, INK, w - 40);
    grime(c, w, h, 0.9, Math.floor(r() * 99));
  }],
  returns: [768, 256, (c, w, h, r) => {
    c.fillStyle = ORANGE; c.fillRect(0, 0, w, h);
    arrowMark(c, 110, 128, 70, ORANGE, PAPER);
    fit(c, 'RETURNS', 210, 130, `800 108px ${DISPLAY}`, PAPER, w - 240, 'left');
    fit(c, 'NO QUESTIONS ASKED', 214, 200, `600 40px ${UI}`, INK, w - 240, 'left');
    grime(c, w, h, 0.7, Math.floor(r() * 99));
  }],
  kiosk: [256, 384, (c, w, h, r) => {
    c.fillStyle = '#0d1418'; c.fillRect(0, 0, w, h);
    c.fillStyle = ORANGE; c.fillRect(0, 0, w, 54);
    fit(c, 'START A RETURN', w / 2, 38, `700 26px ${UI}`, PAPER, w - 20);
    lines(c, ['Order no. (last 4)', '_ _ _ _', '', 'Reason:', '· Changed my mind', '· Arrived late', '· Not as described'], 20, 100, 36, `500 22px ${MONO}`, '#bfe8f2', w - 40);
    // the crack
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(w * 0.8, 0); c.lineTo(w * 0.55, h * 0.35); c.lineTo(w * 0.62, h * 0.5); c.lineTo(w * 0.3, h); c.stroke();
    grime(c, w, h, 0.4, Math.floor(r() * 99));
  }],
  totes: [256, 128, (c, w, h) => {
    c.fillStyle = PAPER; c.fillRect(0, 0, w, h);
    fit(c, 'RETURN', 16, 46, `800 40px ${DISPLAY}`, INK, w - 32, 'left');
    c.fillStyle = INK;
    for (let i = 0; i < 40; i++) c.fillRect(16 + i * 5.6, 64, i % 3 === 0 ? 3 : 1.5, 40);
    fit(c, '#88-1047', w - 16, 122, `500 16px ${MONO}`, INK, 120, 'right');
  }],
  // the bell tower: the drone port, and the swarm's control panel at its foot
  dronePort: [512, 160, (c, w, h, r) => {
    c.fillStyle = INK; c.fillRect(0, 0, w, h);
    arrowMark(c, 70, 80, 40, PAPER, ORANGE);
    fit(c, 'DRONE PORT · BELL TOWER', 130, 96, `700 50px ${UI}`, PAPER, w - 150, 'left');
    grime(c, w, h, 0.6, Math.floor(r() * 99));
  }],
  swarmPanel: [256, 256, (c, w, h, r) => {
    c.fillStyle = '#2a2d31'; c.fillRect(0, 0, w, h);
    c.fillStyle = LINE; c.fillRect(0, 0, w, 40);
    fit(c, 'SWARM CONTROL', w / 2, 30, `800 30px ${DISPLAY}`, INK, w - 20);
    lines(c, ['Authorised staff only.', 'Do not ground the swarm', 'during peak.', '', 'Peak: always.'], 18, 84, 32, `400 22px ${UI}`, '#cfc9be', w - 36);
    grime(c, w, h, 0.8, Math.floor(r() * 99));
  }],
  // inside: aisle numbers, culture banners, the stations, Lo's whiteboard
  aisle9: [256, 256, (c, w, h) => {
    c.fillStyle = ORANGE; c.fillRect(0, 0, w, h);
    fit(c, 'AISLE', w / 2, 70, `700 56px ${UI}`, PAPER, w - 20);
    fit(c, '9', w / 2, 220, `800 170px ${DISPLAY}`, PAPER, w - 20);
  }],
  aisle4: [256, 256, (c, w, h) => {
    c.fillStyle = ORANGE; c.fillRect(0, 0, w, h);
    fit(c, 'AISLE', w / 2, 70, `700 56px ${UI}`, PAPER, w - 20);
    fit(c, '4', w / 2, 220, `800 170px ${DISPLAY}`, PAPER, w - 20);
  }],
  bannerObsess: banner(['CUSTOMER', 'OBSESSION']),
  bannerDay: banner(['IT IS', 'ALWAYS', 'DAY 1']),
  bannerRate: banner(['RATE IS', 'RESPECT']),
  bannerMile: banner(['EVERY', 'MILE IS', 'THE LAST']),
  station: [512, 160, (c, w, h, r) => {
    c.fillStyle = INK; c.fillRect(0, 0, w, h);
    fit(c, 'PICK STATION', 30, 70, `700 48px ${UI}`, PAPER, w - 200, 'left');
    fit(c, 'RATE TARGET 100%', 30, 124, `500 30px ${MONO}`, LINE, w - 200, 'left');
    arrowMark(c, w - 80, 80, 44, PAPER, ORANGE);
    grime(c, w, h, 0.5, Math.floor(r() * 99));
  }],
  loBoard: [512, 384, (c, w, h, r) => {
    c.fillStyle = '#eceae4'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#8a8478'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8);
    c.fillStyle = '#1b3f8a';
    fit(c, 'SHIFT 1,407', 24, 56, `600 40px ${UI}`, '#1b3f8a', w - 48, 'left');
    lines(c, ['ON FLOOR: Lo, Bea, Tomas, Teo', 'Water: 4 × 1.5 L (rate met)', 'Aisle 9: toaster again', 'Drive 31 pulls left', 'DON\'T go out the dock'], 24, 112, 46, `400 30px ${UI}`, '#22242a', w - 48);
    c.strokeStyle = '#b8261b'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(20, 336); c.lineTo(w - 30, 330); c.stroke();
    // tally marks in the corner, in groups of five (the ones who left)
    c.strokeStyle = '#22242a'; c.lineWidth = 3;
    for (let g = 0; g < 5; g++) for (let i = 0; i < 5; i++) {
      const x0 = 320 + g * 34 + i * 5, y0 = 26;
      c.beginPath();
      if (i < 4) { c.moveTo(x0, y0); c.lineTo(x0 + r(), y0 + 28); } else { c.moveTo(x0 - 22, y0 + 22); c.lineTo(x0 + 2, y0 + 4); }
      c.stroke();
    }
    grime(c, w, h, 0.5, Math.floor(r() * 99));
  }],
  plaque: [256, 128, (c, w, h, r) => {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#b48a3a'); g.addColorStop(0.5, '#e1c47a'); g.addColorStop(1, '#9a7330');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    fit(c, 'IT IS ALWAYS', w / 2, 52, `700 34px ${UI}`, '#3a2a10', w - 24);
    fit(c, 'DAY 1', w / 2, 100, `800 48px ${DISPLAY}`, '#3a2a10', w - 24);
    grime(c, w, h, 0.3, Math.floor(r() * 99));
  }],
  office: [256, 96, (c, w, h) => {
    c.fillStyle = '#c9a24a'; c.fillRect(0, 0, w, h);
    fit(c, 'O. SAYLE · DAY 1', w / 2, 60, `700 34px ${UI}`, '#2a1e08', w - 20);
  }],
  floorKiosk: [256, 256, (c, w, h, r) => {
    c.fillStyle = '#0d1418'; c.fillRect(0, 0, w, h);
    c.fillStyle = LINE; c.fillRect(0, 0, w, 44);
    fit(c, 'FLOOR CONTROL', w / 2, 32, `800 30px ${DISPLAY}`, INK, w - 20);
    lines(c, ['Drives: 44 / 44', 'Pods: 52', 'Obstructions: 0', '', 'E-STOP: supervisor'], 18, 90, 34, `500 22px ${MONO}`, '#bfe8f2', w - 36);
    grime(c, w, h, 0.4, Math.floor(r() * 99));
  }],
  // a pod's bin labels (one strip, tiled along the shelves)
  bins: [512, 64, (c, w, h, r) => {
    c.fillStyle = '#e8e4da'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      c.fillStyle = INK;
      fit(c, `${String.fromCharCode(65 + Math.floor(r() * 8))}${Math.floor(r() * 90 + 10)}`, 32 + i * 64, 40, `600 26px ${MONO}`, INK, 56);
      c.fillRect(i * 64, 0, 2, h);
    }
  }],
  // the vans' side livery
  van: [1024, 256, (c, w, h, r) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(242,106,27,0.95)';
    c.beginPath(); c.moveTo(0, 150); c.lineTo(w, 110); c.lineTo(w, 180); c.lineTo(0, 220); c.fill();
    wordmark(c, 60, 110, 90, '#262626', 420);
    fit(c, 'Anything. Anywhere. 10 minutes.', 520, 90, `500 38px ${UI}`, '#262626', 460, 'left');
    grime(c, w, h, 1.0, Math.floor(r() * 99));
  }, 0.75],
};

let _atlas: { tex: THREE.CanvasTexture; regions: Record<string, Region> } | null = null;

function atlas() {
  if (_atlas) return _atlas;
  // shelf packing, tallest first; each item goes in the first row with room (height and width) left,
  // so the short prints fill in beside the tall ones
  const items = Object.entries(DRAW).map(([name, [w0, h0, draw, k = 1]]) => [name, [Math.round(w0 * k), Math.round(h0 * k), draw, k, w0, h0]] as const).sort((a, b) => b[1][1] - a[1][1]);
  const regions: Record<string, Region> = {};
  const placed: { name: string; x: number; y: number; w: number; h: number; draw: Draw; k: number; w0: number; h0: number }[] = [];
  const rows: { y: number; h: number; x: number }[] = [];
  let top = 0;
  for (const [name, [w, h, draw, k, w0, h0]] of items) {
    let row = rows.find((r) => r.h >= h && r.x + w <= W);
    if (!row) {
      if (top + h > H) throw new Error('cathedral atlas full at ' + name);
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
export function cathPrint(name: string, w: number, h: number, m: THREE.Matrix4) {
  const r = atlas().regions[name];
  if (!r) throw new Error('no cathedral print ' + name);
  const g = new THREE.PlaneGeometry(w, h);
  const a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, r.u0 + a.getX(i) * (r.u1 - r.u0), r.v0 + a.getY(i) * (r.v1 - r.v0));
  return norm(g.applyMatrix4(m));
}

let _mat: THREE.MeshStandardNodeMaterial | null = null;
/** Lit, alpha-tested (letters on clear), double-sided. */
export function cathPrintMaterial() {
  if (_mat) return _mat;
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, side: THREE.DoubleSide, alphaTest: 0.45 });
  m.map = atlas().tex;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  return (_mat = m);
}

// ------------------------------------------------------------------ the rose window
/**
 * The rose window: a clock in coloured glass. Twenty-four petals of amber, orange and teal in lead
 * tracery round a white face with Dropt's arrow at the centre; the hand is a separate mesh. Drawn
 * once (1024²).
 */
export function roseTexture() {
  const S = 1024;
  return canvasTexture(S, S, (c) => {
    const cx = S / 2, cy = S / 2, R = S / 2 - 6;
    c.fillStyle = '#1a1410'; c.fillRect(0, 0, S, S);
    const glass = ['#f29a2e', '#e8641c', '#3aa6a0', '#f2c45a', '#d9481c', '#2a7f8a'];
    const r = rng(11);
    // outer ring: 24 petals, each split into two panes
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / 24) * Math.PI * 2 - Math.PI / 2;
      for (const [r0, r1] of [[R * 0.62, R * 0.8], [R * 0.8, R * 0.98]]) {
        c.fillStyle = glass[Math.floor(r() * glass.length)];
        c.beginPath();
        c.arc(cx, cy, r1, a0 + 0.01, a1 - 0.01);
        c.arc(cx, cy, r0, a1 - 0.01, a0 + 0.01, true);
        c.closePath();
        c.fill();
        // mottling in the glass
        c.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.12})`;
        c.fill();
      }
    }
    // the hour marks: twelve bright panes on the inner ring
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      c.fillStyle = i === 0 ? '#ffffff' : '#ffe6b0';
      c.beginPath();
      c.arc(cx + Math.cos(a) * R * 0.53, cy + Math.sin(a) * R * 0.53, i === 0 ? 30 : 18, 0, Math.PI * 2);
      c.fill();
    }
    // the face
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, R * 0.45);
    g.addColorStop(0, '#fff8ea'); g.addColorStop(1, '#f2d8a8');
    c.fillStyle = g;
    c.beginPath(); c.arc(cx, cy, R * 0.45, 0, Math.PI * 2); c.fill();
    arrowMark(c, cx, cy, 70, '#f4f1ea', ORANGE);
    // lead tracery over everything
    c.strokeStyle = '#120d0a';
    c.lineWidth = 9;
    for (const rr of [R * 0.45, R * 0.62, R * 0.8, R * 0.98]) { c.beginPath(); c.arc(cx, cy, rr, 0, Math.PI * 2); c.stroke(); }
    c.lineWidth = 7;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * R * 0.45, cy + Math.sin(a) * R * 0.45);
      c.lineTo(cx + Math.cos(a) * R * 0.98, cy + Math.sin(a) * R * 0.98);
      c.stroke();
    }
    c.lineWidth = 4;
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / 24) * Math.PI * 2 - Math.PI / 2;
      // a pointed arch in each outer petal
      const am = (a0 + a1) / 2;
      c.beginPath();
      c.moveTo(cx + Math.cos(a0) * R * 0.82, cy + Math.sin(a0) * R * 0.82);
      c.quadraticCurveTo(cx + Math.cos(am) * R * 0.9, cy + Math.sin(am) * R * 0.9, cx + Math.cos(am) * R * 0.97, cy + Math.sin(am) * R * 0.97);
      c.quadraticCurveTo(cx + Math.cos(am) * R * 0.9, cy + Math.sin(am) * R * 0.9, cx + Math.cos(a1) * R * 0.82, cy + Math.sin(a1) * R * 0.82);
      c.stroke();
    }
    // dust
    grime(c, S, S, 0.35, 5);
  });
}

// ------------------------------------------------------------------ the board over the altar
export interface BoardView {
  orders: number;
  customers: number;
  shift: number;
  floor: 'moving' | 'stop' | 'obstruction' | 'off';
  owner: string;
  status: 'live' | 'closed' | 'open';
}

/** The board: orders, customers, the shift that never ends, the floor. */
export function paintBoard(c: CanvasRenderingContext2D, w: number, h: number, v: BoardView) {
  c.fillStyle = '#07090b'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#121619'; c.fillRect(10, 10, w - 20, h - 20);
  arrowMark(c, 60, 62, 30, PAPER, ORANGE);
  fit(c, 'dropt · FULFILMENT CENTRE 0001', 110, 74, `600 34px ${UI}`, '#d8dde2', 560, 'left');
  fit(c, `OWNER: ${v.owner}`, w - 30, 74, `700 30px ${MONO}`, ORANGE, 380, 'right');
  c.fillStyle = '#2a3036'; c.fillRect(30, 100, w - 60, 3);
  if (v.status === 'closed') {
    fit(c, 'SITE SHUTDOWN', 40, 210, `800 96px ${DISPLAY}`, '#ff5a3a', w - 80, 'left');
    fit(c, 'Deliveries paused indefinitely. We apologise for the inconvenience.', 40, 280, `500 30px ${UI}`, '#9fb0bf', w - 80, 'left');
    fit(c, 'DOORS: OPEN', 40, h - 50, `700 34px ${MONO}`, '#5fe08a', w - 80, 'left');
    return;
  }
  const col = (label: string, val: string, x: number, colr = '#e9eef2') => {
    fit(c, label, x, 160, `600 26px ${MONO}`, '#7fd6ff', 300, 'left');
    fit(c, val, x, 250, `800 92px ${DISPLAY}`, colr, 300, 'left');
  };
  col('ORDERS TODAY', String(v.orders), 40);
  col('CUSTOMERS', String(v.customers), 360, v.customers === 1 ? ORANGE : '#e9eef2');
  col('ON TIME', '100%', 680);
  c.fillStyle = '#2a3036'; c.fillRect(30, 290, w - 60, 3);
  fit(c, `SHIFT ${v.shift.toLocaleString('en-US')}`, 40, 350, `700 40px ${MONO}`, '#e9eef2', 420, 'left');
  fit(c, v.status === 'open' ? 'SHIFT END: WHENEVER YOU LIKE' : 'SHIFT END: —', w - 40, 350, `700 36px ${MONO}`, v.status === 'open' ? '#5fe08a' : '#ffb347', 560, 'right');
  const floor = v.floor === 'stop' ? ['FLOOR: E-STOP', '#ffb347'] : v.floor === 'obstruction' ? ['FLOOR: OBSTRUCTION', '#ff5a3a'] : v.floor === 'off' ? ['FLOOR: IDLE', '#7d8a96'] : ['FLOOR: DRIVES MOVING', '#5fe08a'];
  fit(c, floor[0], 40, h - 50, `700 38px ${MONO}`, floor[1], w - 80, 'left');
}
