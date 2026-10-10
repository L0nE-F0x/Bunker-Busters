import * as THREE from 'three/webgpu';
import { canvasTexture, grime, norm } from '../../world/kit';

/**
 * The Panopticon's printed art in one canvas, sampled through one alpha-tested material (one draw):
 * Glimpse's eye and wordmark, the pole signs, the keeper's plaque, desk plates, the camera boxes'
 * tags, the staff notice, floor stencils. The monitors are a separate live canvas (`FeedWall`).
 */

type Draw = (c: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void;
interface Region { u0: number; u1: number; v0: number; v1: number }

const W = 2048, H = 1024, PAD = 4;
const DISPLAY = '"Big Shoulders Stencil Display", Impact, sans-serif';
const UI = '"Chakra Petch", Arial, sans-serif';
const MONO = '"JetBrains Mono", monospace';
/** Glimpse blue (Ezra's accent in the journal). */
export const GLIMPSE_BLUE = '#6f9cff';

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

/** The Glimpse eye: an almond outline round a ring and a pupil. */
function eye(c: CanvasRenderingContext2D, cx: number, cy: number, s: number, ink: string) {
  c.save();
  c.translate(cx, cy);
  c.strokeStyle = ink;
  c.fillStyle = ink;
  c.lineWidth = s * 0.09;
  c.beginPath();
  c.moveTo(-s, 0);
  c.quadraticCurveTo(0, -s * 0.95, s, 0);
  c.quadraticCurveTo(0, s * 0.95, -s, 0);
  c.closePath();
  c.stroke();
  c.beginPath(); c.arc(0, 0, s * 0.36, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.arc(0, 0, s * 0.15, 0, Math.PI * 2); c.fill();
  c.restore();
}

const plate = (n: string, name: string): Draw => (c, w, h) => {
  c.fillStyle = '#e8ecf0'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#20242c'; c.fillRect(0, 0, 64, h);
  eye(c, 32, h / 2, 22, '#e8ecf0');
  fit(c, n, 70, 48, `900 44px ${DISPLAY}`, '#20242c', 120, 'left');
  fit(c, name, 70, 84, `600 18px ${MONO}`, '#4a5262', w - 80, 'left');
};

const DRAW: Record<string, [number, number, Draw]> = {
  // the wordmark over the gate: the eye and GLIMPSE, white on clear (alpha-tested)
  wordmark: [1024, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    eye(c, 130, h / 2, 100, '#f4f6fa');
    fit(c, 'GLIMPSE', 600, h * 0.74, `900 ${h * 0.82}px ${DISPLAY}`, '#f4f6fa', w - 280);
  }],
  // the big eye on the tower, blue on clear
  bigEye: [512, 320, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    eye(c, w / 2, h / 2, w * 0.44, GLIMPSE_BLUE);
  }],
  // the pole signs: a white enamel plate, an eye, the line every Glimpse pole had
  pole: [320, 200, (c, w, h, r) => {
    c.fillStyle = '#f2f4f6'; c.fillRect(0, 0, w, h);
    c.fillStyle = GLIMPSE_BLUE; c.fillRect(0, 0, w, 56);
    eye(c, 42, 28, 24, '#ffffff');
    fit(c, 'GLIMPSE', 76, 42, `900 36px ${DISPLAY}`, '#ffffff', 200, 'left');
    fit(c, 'THIS AREA IS', w / 2, 96, `700 28px ${UI}`, '#20242c', w - 30);
    fit(c, 'NEIGHBOURHOOD WATCHED', w / 2, 130, `700 28px ${UI}`, '#20242c', w - 30);
    fit(c, 'Seen something? So have we.', w / 2, 174, `500 20px ${UI}`, '#4a5262', w - 30);
    grime(c, w, h, 0.9, Math.floor(r() * 90));
  }],
  // the keeper's plaque by the tower door (cast bronze gone green)
  keeper: [384, 240, (c, w, h, r) => {
    c.fillStyle = '#4b5a46'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#7f927a'; c.lineWidth = 8; c.strokeRect(10, 10, w - 20, h - 20);
    fit(c, 'POINT ARGUS LIGHT', w / 2, 76, `900 44px ${DISPLAY}`, '#c9d6c0', w - 50);
    fit(c, 'FIRST LIT 1911', w / 2, 120, `700 26px ${UI}`, '#c9d6c0', w - 50);
    fit(c, 'DECOMMISSIONED 1987', w / 2, 154, `600 22px ${UI}`, '#aab8a2', w - 50);
    fit(c, 'THE SEA WAS HERE', w / 2, 200, `600 20px ${MONO}`, '#aab8a2', w - 50);
    grime(c, w, h, 1.4, Math.floor(r() * 90));
  }],
  // the staff notice in the entrance passage
  notice: [320, 420, (c, w, h, r) => {
    c.fillStyle = '#f6f6f2'; c.fillRect(0, 0, w, h);
    c.fillStyle = GLIMPSE_BLUE; c.fillRect(0, 0, w, 70);
    eye(c, 44, 35, 26, '#ffffff');
    fit(c, 'REVIEWERS', 82, 50, `900 40px ${DISPLAY}`, '#ffffff', 220, 'left');
    const lines = [
      'Log what you see,', 'not what you think.', '',
      'Water given: litres.', 'Water taken: litres.', 'Names if known.', '',
      'Do not look away from', 'your feed during a', 'hand-over.', '',
      'Desk lights out at 23:00.', 'The tower is not staff.',
    ];
    lines.forEach((t, i) => fit(c, t, 24, 112 + i * 23, `500 19px ${UI}`, '#20242c', w - 48, 'left'));
    grime(c, w, h, 0.5, Math.floor(r() * 90));
  }],
  // desk plates by each cell's glass (seven is Ada's)
  ...Object.fromEntries(['01', '02', '03', '04', '05', '06', '08', '09', '10', '11'].map((n) => [`desk${n}`, [256, 100, plate(n, n === '04' ? 'K. BOATENG' : n === '10' ? 'J. ISHIDA' : 'VACANT')] as [number, number, Draw]])),
  desk07: [256, 100, plate('07', 'A. IVERS · 2212')],
  // the junction boxes' tags
  ...Object.fromEntries([1, 2, 3, 4].map((n) => [`cam${n}`, [128, 64, (c: CanvasRenderingContext2D, w: number, h: number) => {
    c.fillStyle = '#f2c230'; c.fillRect(0, 0, w, h);
    fit(c, `CAM ${n}`, w / 2, 44, `900 38px ${DISPLAY}`, '#1a1a1a', w - 12);
  }] as [number, number, Draw]])),
  // a hazard stripe and the floor ring's tick marks
  stripes: [256, 32, (c, w, h) => {
    c.fillStyle = '#f2c230'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1a1a1a';
    for (let x = -h; x < w; x += 2 * h) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + h, 0); c.lineTo(x + 2 * h, 0); c.lineTo(x + h, h); c.fill(); }
  }],
  // stencilled on the floor in front of the tower door
  floorWord: [512, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    fit(c, 'TOWER · NOT STAFF', w / 2, h * 0.72, `900 76px ${DISPLAY}`, 'rgba(240,244,250,0.85)', w - 20);
  }],
  // spray paint on the drum, from before the gate was finished
  tag: [512, 160, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.save(); c.translate(20, 26); c.rotate(-0.05);
    fit(c, 'WHO WATCHES', 0, 60, `900 58px ${DISPLAY}`, 'rgba(210,60,40,0.92)', w - 40, 'left');
    fit(c, 'THE LIGHTHOUSE', 30, 118, `900 58px ${DISPLAY}`, 'rgba(210,60,40,0.92)', w - 70, 'left');
    c.restore();
  }],
};

let _atlas: { tex: THREE.CanvasTexture; regions: Record<string, Region> } | null = null;
function atlas() {
  if (_atlas) return _atlas;
  const regions: Record<string, Region> = {};
  const entries = Object.entries(DRAW).sort((a, b) => b[1][1] - a[1][1] || b[1][0] - a[1][0]);
  const tex = canvasTexture(W, H, (ctx) => {
    ctx.clearRect(0, 0, W, H);
    let x = 0, y = 0, rowH = 0, seed = 11;
    for (const [name, [w, h, draw]] of entries) {
      if (x + w + PAD > W) { x = 0; y += rowH + PAD; rowH = 0; }
      if (y + h > H) throw new Error('panopticon atlas full at ' + name);
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      draw(ctx, w, h, rng(seed++));
      ctx.restore();
      regions[name] = { u0: (x + 1) / W, u1: (x + w - 1) / W, v0: 1 - (y + h - 1) / H, v1: 1 - (y + 1) / H };
      x += w + PAD;
      rowH = Math.max(rowH, h);
    }
  });
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  _atlas = { tex, regions };
  return _atlas;
}

/** A w×h quad showing `name`, built facing +z, then placed by `m`. */
export function panPrint(name: string, w: number, h: number, m: THREE.Matrix4) {
  const r = atlas().regions[name];
  if (!r) throw new Error('no panopticon print ' + name);
  const g = new THREE.PlaneGeometry(w, h);
  const a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, r.u0 + a.getX(i) * (r.u1 - r.u0), r.v0 + a.getY(i) * (r.v1 - r.v0));
  return norm(g.applyMatrix4(m));
}

let _mat: THREE.MeshStandardNodeMaterial | null = null;
/** Lit, alpha-tested (letters on clear), double-sided. */
export function panPrintMaterial() {
  if (_mat) return _mat;
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, side: THREE.DoubleSide, alphaTest: 0.45 });
  m.map = atlas().tex;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  return (_mat = m);
}

// ------------------------------------------------------------------ the feeds
/** Camps and places on Ezra's feeds: a label and the kind of picture. */
const FEEDS: [string, 'fire' | 'road' | 'pumps' | 'town' | 'queue' | 'salt' | 'empty'][] = [
  ['LAST CHANCE · FORECOURT', 'pumps'], ['LAST CHANCE · FIRE', 'fire'], ['DRY CREEK · DINER', 'town'], ['DRY CREEK · CLINIC', 'town'],
  ['HWY 9 · MILE 41', 'road'], ['WAITLIST · GATE', 'queue'], ['THE SALT · EAST', 'salt'], ['APEX · APRON', 'salt'],
  ['CAMP 6 · RIDGE', 'fire'], ['CAMP 11 · WASH', 'fire'], ['THE CUT · MOUTH', 'empty'], ['HWY 9 · MILE 52', 'road'],
  ['STARLITE · LOT', 'empty'], ['DRY CREEK · STORE', 'town'], ['CAMP 14 · SPRING', 'fire'], ['UNIT 0414', 'pumps'],
];

/** One canvas of 4×4 camp feeds that every monitor in the building samples a tile of (one draw). */
export const FEED_GRID = 4;
export function feedTiles() { return FEEDS.length; }

/** Paint the feeds: little night-vision scenes in Glimpse's grey-blue, a label, a clock. `t` animates them. */
export function paintFeeds(c: CanvasRenderingContext2D, w: number, h: number, t: number, hour: number) {
  const tw = w / FEED_GRID, th = h / FEED_GRID;
  const r = rng(Math.floor(t / 7) + 3);
  const hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60);
  const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  FEEDS.forEach(([label, kind], i) => {
    const x = (i % FEED_GRID) * tw, y = Math.floor(i / FEED_GRID) * th;
    c.save();
    c.translate(x, y);
    c.beginPath(); c.rect(0, 0, tw, th); c.clip();
    const g = c.createLinearGradient(0, 0, 0, th);
    g.addColorStop(0, '#20283a'); g.addColorStop(1, '#0c1018');
    c.fillStyle = g; c.fillRect(0, 0, tw, th);
    // ground, a horizon
    c.fillStyle = '#1a2130'; c.fillRect(0, th * 0.62, tw, th * 0.38);
    const ink = '#8fa6c8';
    c.fillStyle = ink;
    if (kind === 'fire') {
      const fl = 0.7 + r() * 0.3;
      const fg = c.createRadialGradient(tw / 2, th * 0.66, 2, tw / 2, th * 0.66, th * 0.4);
      fg.addColorStop(0, `rgba(255,200,120,${0.9 * fl})`); fg.addColorStop(1, 'rgba(255,140,60,0)');
      c.fillStyle = fg; c.fillRect(0, 0, tw, th);
      c.fillStyle = '#0a0d14';
      for (let k = 0; k < 3; k++) c.fillRect(tw * (0.25 + k * 0.22) + r() * 4, th * 0.5, tw * 0.06, th * 0.16);
    } else if (kind === 'pumps') {
      c.fillRect(tw * 0.2, th * 0.3, tw * 0.6, th * 0.05);
      for (const px of [0.3, 0.5, 0.7]) c.fillRect(tw * px - 6, th * 0.4, 12, th * 0.22);
      if (r() > 0.5) { c.fillStyle = '#0a0d14'; c.fillRect(tw * (0.1 + r() * 0.7), th * 0.5, tw * 0.05, th * 0.13); }
    } else if (kind === 'town') {
      c.fillRect(tw * 0.15, th * 0.36, tw * 0.5, th * 0.26);
      c.fillStyle = 'rgba(255,220,150,0.8)';
      c.fillRect(tw * 0.22, th * 0.44, tw * 0.1, th * 0.08); c.fillRect(tw * 0.42, th * 0.44, tw * 0.1, th * 0.08);
    } else if (kind === 'road') {
      c.fillStyle = '#2a3346';
      c.beginPath(); c.moveTo(tw * 0.45, th * 0.62); c.lineTo(tw * 0.55, th * 0.62); c.lineTo(tw * 0.9, th); c.lineTo(tw * 0.1, th); c.fill();
    } else if (kind === 'queue') {
      for (let k = 0; k < 9; k++) { c.fillStyle = k % 3 ? '#5c6e8c' : ink; c.fillRect(tw * 0.08 + k * tw * 0.1, th * 0.56 - (k % 2) * 3, tw * 0.05, th * 0.08); }
    } else if (kind === 'salt') {
      c.fillStyle = '#3a4560'; c.fillRect(0, th * 0.62, tw, th * 0.12);
    }
    // scanlines, a label, a REC dot, a clock
    c.fillStyle = 'rgba(0,0,0,0.18)';
    for (let yy = 0; yy < th; yy += 3) c.fillRect(0, yy, tw, 1);
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, th - 22, tw, 22);
    c.font = `600 13px ${MONO}`; c.textAlign = 'left'; c.fillStyle = '#dfe8f6';
    c.fillText(label, 6, th - 7, tw - 60);
    c.textAlign = 'right'; c.fillText(clock, tw - 6, th - 7);
    if (Math.floor(t * 1.2 + i) % 2) { c.fillStyle = '#ff3a3a'; c.beginPath(); c.arc(tw - 12, 12, 4, 0, Math.PI * 2); c.fill(); }
    c.strokeStyle = '#05070a'; c.lineWidth = 2; c.strokeRect(1, 1, tw - 2, th - 2);
    c.restore();
  });
}

/** A w×h screen showing feed tile `i` (of the FEED_GRID² canvas), facing +z, placed by `m`. */
export function feedQuad(i: number, w: number, h: number, m: THREE.Matrix4) {
  const n = FEED_GRID, col = i % n, row = Math.floor(i / n) % n;
  const g = new THREE.PlaneGeometry(w, h);
  const a = g.attributes.uv as THREE.BufferAttribute;
  const u0 = col / n, v1 = 1 - row / n;
  for (let k = 0; k < a.count; k++) a.setXY(k, u0 + a.getX(k) / n, v1 - (1 - a.getY(k)) / n);
  return norm(g.applyMatrix4(m));
}
