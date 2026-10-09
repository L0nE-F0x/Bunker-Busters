import * as THREE from 'three/webgpu';
import { float, texture } from 'three/tsl';
import { canvasTexture, grime, norm } from '../world/kit';
import { F_DISPLAY, F_MONO, F_UI, uSiteNight, uSiteFlicker } from './jetKit';

/**
 * Printed art for the 2026-10-10 sites (the booster crash, Waitlist City). The jet's atlas and the
 * world print atlas are both spoken for, so these sites share a third: one canvas, one lit
 * alpha-tested material (letters on a tank, a sign on a post) and one additive material for the
 * things that glow (the NOW SERVING board). Both are in the scene from boot, so the warm-up
 * compiles them. Register with `artPaint` at module load; entries are shelf-packed by height.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;
type Draw = (c: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void;
interface Region { u0: number; u1: number; v0: number; v1: number }

const W = 2048, H = 1536, PAD = 4;
const DRAW: Record<string, [number, number, Draw]> = {};

export function artPaint(name: string, w: number, h: number, draw: Draw) {
  DRAW[name] = [w, h, draw];
}

function rng(seed: number) {
  let s = (seed * 2654435761) % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

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
      if (y + h > H) throw new Error('places atlas full at ' + name);
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
  _atlas = { tex, regions };
  return _atlas;
}

/** Map a geometry's 0..1 uvs onto region `name` (optionally a sub-rectangle of it, in 0..1). */
export function artMap(name: string, g: THREE.BufferGeometry, sub?: [number, number, number, number]) {
  const r = atlas().regions[name];
  if (!r) throw new Error('no places-art entry ' + name);
  let { u0, u1, v0, v1 } = r;
  if (sub) {
    const du = u1 - u0, dv = v1 - v0;
    [u0, u1, v0, v1] = [u0 + sub[0] * du, u0 + (sub[0] + sub[2]) * du, v0 + sub[1] * dv, v0 + (sub[1] + sub[3]) * dv];
  }
  const a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, u0 + a.getX(i) * (u1 - u0), v0 + a.getY(i) * (v1 - v0));
  return g;
}

/** A w×h quad showing `name`, built facing +z, then placed by `m`. */
export function artQuad(name: string, w: number, h: number, m: THREE.Matrix4, sub?: [number, number, number, number]) {
  return norm(artMap(name, new THREE.PlaneGeometry(w, h), sub).applyMatrix4(m));
}

/** Merge non-indexed position/normal/uv geometries (any count) into one. */
export function merged(parts: THREE.BufferGeometry[]) {
  const list = parts.map((p) => norm(p));
  const n = list.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    uvs.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.computeBoundingSphere();
  return g;
}

/** Quads that share one material (the places atlas, lit or glowing): one mesh, one draw. */
export class Bucket {
  private parts: THREE.BufferGeometry[] = [];
  constructor(private mat: () => THREE.Material) {}
  add(g: THREE.BufferGeometry) { this.parts.push(g); }
  build(name: string, receive: boolean) {
    const g = new THREE.Group();
    g.name = name;
    if (!this.parts.length) return g;
    const m = new THREE.Mesh(merged(this.parts), this.mat());
    m.name = name;
    m.castShadow = false;
    m.receiveShadow = receive;
    g.add(m);
    return g;
  }
}

let _lit: THREE.MeshStandardNodeMaterial | null = null;
/** Lit, double-sided, alpha-tested (painted letters keep the surface under them). */
export function artMaterial() {
  return (_lit ??= new THREE.MeshStandardNodeMaterial({
    map: atlas().tex, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide, alphaTest: 0.45,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }));
}

let _glow: THREE.MeshBasicNodeMaterial | null = null;
/** Additive: LED boards and lit screens, dim by day and bright at night (the shared site uniforms). */
export function artGlow() {
  if (_glow) return _glow;
  const m = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  });
  const t: N = texture(atlas().tex);
  m.colorNode = t.rgb.mul(t.a).mul(float(0.35).add(uSiteNight.mul(1.4)).mul(uSiteFlicker));
  m.opacityNode = float(1);
  _glow = m;
  return m;
}

// ================================================================ shared painting helpers
function stencil(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, col: string, align: CanvasTextAlign = 'center', weight = 900, font = F_DISPLAY) {
  c.fillStyle = col;
  c.font = `${weight} ${size}px ${font}`;
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  c.fillText(text, x, y);
}

/** Knock holes in painted letters (sand-blasted paint) by erasing specks. */
function blast(c: CanvasRenderingContext2D, w: number, h: number, r: () => number, n: number, size = 3) {
  c.save();
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < n; i++) {
    c.globalAlpha = 0.3 + r() * 0.7;
    const s = size * (0.3 + r());
    c.fillRect(r() * w, r() * h, s, s * (0.5 + r()));
  }
  c.restore();
}

function cardboard(c: CanvasRenderingContext2D, w: number, h: number, r: () => number) {
  c.fillStyle = '#b48a58';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(80,55,30,0.3)';
  c.lineWidth = 2;
  for (let y = 6; y < h; y += 18) { c.beginPath(); c.moveTo(0, y + r() * 2); c.lineTo(w, y + r() * 2); c.stroke(); }
}

function scrawl(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, rot: number, col = '#1b1a1d') {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.fillStyle = col;
  c.font = `700 ${size}px ${F_UI}`;
  c.textAlign = 'center';
  c.fillText(text, 0, 0);
  c.restore();
}

// ================================================================ the booster (booster.ts)
const ASC_BLUE = '#2e3136';

artPaint('ascWord', 1024, 256, (c, w, h, r) => {
  // Kade's name down the tank, and the orange band under it
  stencil(c, 'KADE', w / 2, 200, 250, '#2e3136');
  c.fillStyle = '#d8641e';
  c.fillRect(40, 222, w - 80, 26);
  blast(c, w, h, r, 2200, 4);
});
artPaint('ascTail', 768, 256, (c, w, h, r) => {
  // the vehicle name, the flight tally, the plan
  stencil(c, 'LONGSHOT B7', 330, 190, 116, ASC_BLUE);
  stencil(c, 'FLIGHT-PROVEN', 330, 62, 44, ASC_BLUE, 'center', 700, F_UI);
  c.strokeStyle = ASC_BLUE;
  c.lineWidth = 10;
  c.beginPath(); c.moveTo(690, 110); c.lineTo(690, 200); c.stroke(); // one tally mark
  c.font = `600 20px ${F_MONO}`;
  c.fillStyle = ASC_BLUE;
  c.textAlign = 'center';
  c.fillText('REUSE TARGET: 100', 690, 236);
  blast(c, w, h, r, 1200, 3);
});
artPaint('ascPod', 768, 192, (c, w, h, r) => {
  c.fillStyle = '#e6e2d8';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#d8641e';
  c.fillRect(0, 0, w, 40);
  stencil(c, 'PRIORITY RESUPPLY', 24, 108, 64, '#1b1a1d', 'left', 800, F_UI);
  c.font = `600 26px ${F_MONO}`;
  c.fillStyle = '#1b1a1d';
  c.textAlign = 'left';
  c.fillText('KADE LONGSHOT · DELIVER TO: APEX VAULT, PAD B', 24, 146);
  c.fillText('PERISHABLE · THIS WAY UP · DO NOT DRINK', 24, 178);
  c.fillStyle = '#1b1a1d';
  c.beginPath(); c.moveTo(w - 70, 30 + 10); c.lineTo(w - 40, 90); c.lineTo(w - 100, 90); c.closePath(); c.fill();
  grime(c, w, h, 1.1, 21);
  blast(c, w, h, r, 500, 3);
});
artPaint('ascClaim', 384, 256, (c, w, h, r) => {
  c.fillStyle = '#3a3d42';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#d8641e';
  c.fillRect(0, 0, w, 54);
  stencil(c, 'KADE HOLDINGS', w / 2, 40, 36, '#1b1a1d', 'center', 800, F_UI);
  stencil(c, 'CLAIMED', w / 2, 128, 84, '#f1ece0');
  c.font = `600 19px ${F_MONO}`;
  c.fillStyle = '#d8d2c4';
  c.textAlign = 'center';
  c.fillText('SALVAGE RIGHTS RESERVED', w / 2, 168);
  c.fillText('RECOVERY TEAM ETA: PENDING', w / 2, 196);
  c.fillText('TRESPASSERS WILL BE INVOICED', w / 2, 224);
  grime(c, w, h, 1.3, 7);
  blast(c, w, h, r, 300, 3);
});
artPaint('ascHaz', 256, 256, (c, w, h) => {
  c.save();
  c.translate(w / 2, h / 2);
  c.rotate(Math.PI / 4);
  c.fillStyle = '#f1ece0';
  c.fillRect(-84, -84, 168, 168);
  c.fillStyle = '#c42a1a';
  c.fillRect(-76, -76, 152, 152);
  c.restore();
  stencil(c, 'HYPERGOLIC', w / 2, 120, 30, '#f1ece0', 'center', 800, F_UI);
  stencil(c, 'DO NOT', w / 2, 158, 30, '#f1ece0', 'center', 800, F_UI);
  stencil(c, 'LICK', w / 2, 192, 30, '#f1ece0', 'center', 800, F_UI);
  grime(c, w, h, 1, 4);
});
artPaint('ascScreen', 256, 160, (c, w, h) => {
  c.fillStyle = '#04130c';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#4dff8a';
  c.font = `700 22px ${F_MONO}`;
  c.textAlign = 'left';
  c.fillText('FDR · LONGSHOT B7', 14, 32);
  c.fillText('LAST: LANDING BURN', 14, 66);
  c.fillText('PAD: NOT FOUND', 14, 98);
  c.fillStyle = '#ffcf5a';
  c.fillText('> PLAY LOG_', 14, 136);
});

// ================================================================ Waitlist City (waitlist.ts)
const EVER = '#e9e3d4';
artPaint('wlName', 1024, 256, (c, w, h, r) => {
  // relief letters on the headwall: the brand, and the promise under it
  stencil(c, 'EVERAFTER', w / 2, 168, 176, EVER, 'center', 900);
  c.font = `500 40px ${F_UI}`;
  c.fillStyle = EVER;
  c.textAlign = 'center';
  c.fillText('CONTINUITY RESIDENCES  ·  BY APPOINTMENT', w / 2, 230);
  blast(c, w, h, r, 900, 4);
});
artPaint('wlServe', 512, 160, (c, w, h) => {
  // the LED board over the door
  c.fillStyle = '#000';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#ff9a2a';
  c.font = `700 30px ${F_MONO}`;
  c.textAlign = 'center';
  c.fillText('NOW SERVING', w / 2, 44);
  c.fillStyle = '#ff3b1c';
  c.font = `900 92px ${F_DISPLAY}`;
  c.fillText('0001', w / 2, 140);
  // the LED grid
  c.fillStyle = 'rgba(0,0,0,0.5)';
  for (let x = 0; x < w; x += 4) c.fillRect(x, 0, 1, h);
  for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 1);
});
artPaint('wlStart', 448, 256, (c, w, h, r) => {
  c.fillStyle = '#1f2a2c';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#c9a65a';
  c.fillRect(0, 0, w, 10);
  c.fillRect(0, h - 10, w, 10);
  stencil(c, 'EVERAFTER', w / 2, 52, 40, EVER, 'center', 900);
  stencil(c, 'QUEUE STARTS HERE', w / 2, 120, 46, EVER, 'center', 800, F_UI);
  c.font = `500 24px ${F_UI}`;
  c.fillStyle = '#c9a65a';
  c.textAlign = 'center';
  c.fillText('Please take a number.', w / 2, 168);
  c.fillText('Your appointment is our priority.', w / 2, 200);
  c.font = `500 18px ${F_MONO}`;
  c.fillStyle = 'rgba(233,227,212,0.6)';
  c.fillText('EST. WAIT FROM THIS POINT: 4–6 WEEKS', w / 2, 236);
  grime(c, w, h, 1.2, 12);
  blast(c, w, h, r, 260, 3);
});
artPaint('wlDay', 384, 288, (c, w, h, r) => {
  cardboard(c, w, h, r);
  scrawl(c, 'DAY 1,284', w / 2, 70, 58, -0.03);
  scrawl(c, 'IN LINE', w / 2, 120, 40, 0.02);
  scrawl(c, 'NO CUTTING', w / 2, 180, 44, -0.02, '#8e1b12');
  scrawl(c, 'NO SAVING SPOTS', w / 2, 222, 30, 0.03);
  scrawl(c, 'LINE MONITOR: #0003', w / 2, 266, 24, -0.01);
  grime(c, w, h, 1.2, 9);
});
artPaint('wlPriority', 448, 128, (c, w, h, r) => {
  c.fillStyle = '#2a1830';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#c9a65a';
  c.lineWidth = 4;
  c.strokeRect(8, 8, w - 16, h - 16);
  stencil(c, 'PRIORITY ACCESS', w / 2, 62, 40, '#e8cf8a', 'center', 800, F_UI);
  c.font = `500 22px ${F_UI}`;
  c.fillStyle = '#e8cf8a';
  c.textAlign = 'center';
  c.fillText('PLATINUM MEMBERS · SERVICE ENTRANCE', w / 2, 98);
  grime(c, w, h, 0.9, 3);
  blast(c, w, h, r, 120, 3);
});
artPaint('wlPoster', 288, 432, (c, w, h, r) => {
  // the welcome poster by the kiosk: the date everyone in line knows by heart
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#f2d7a8');
  g.addColorStop(1, '#d9876a');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(255,248,230,0.85)';
  c.beginPath(); c.arc(w / 2, 150, 70, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#3a2a2a';
  c.fillRect(0, 190, w, 70);
  stencil(c, 'EVERAFTER', w / 2, 58, 52, '#3a2a2a', 'center', 900);
  c.font = `500 20px ${F_UI}`;
  c.fillStyle = '#3a2a2a';
  c.textAlign = 'center';
  c.fillText('the rest of your life, catered', w / 2, 88);
  stencil(c, 'GRAND OPENING', w / 2, 300, 34, '#3a2a2a', 'center', 800, F_UI);
  stencil(c, '04 · 01', w / 2, 360, 64, '#8e1b12', 'center', 900);
  c.font = `500 16px ${F_MONO}`;
  c.fillStyle = '#3a2a2a';
  c.fillText('ALL MEMBERS SEATED BY APPOINTMENT', w / 2, 400);
  grime(c, w, h, 1.4, 17);
  blast(c, w, h, r, 400, 3);
});
// eight chair tags, one entry: numbers people left on their spot
const TAGS: [string, string][] = [
  ['#3,977', 'BACK IN 5'], ['#2,201', 'SAVING FOR MOM'], ['#0412', 'DO NOT TOUCH'], ['#1,880', 'ON A WALK'],
  ['#3,104', 'GONE TO CREEK'], ['#0957', 'STILL HERE'], ['#2,666', 'BRB'], ['#4,010', 'MOVED UP!'],
];
artPaint('wlTags', 1024, 160, (c, w, h, r) => {
  const tw = w / TAGS.length;
  TAGS.forEach(([n, line], i) => {
    c.save();
    c.translate(i * tw, 0);
    c.fillStyle = i % 3 === 0 ? '#e9e3d4' : i % 3 === 1 ? '#b48a58' : '#d9c37a';
    c.fillRect(2, 2, tw - 4, h - 4);
    scrawl(c, n, tw / 2, 70, 34, (r() - 0.5) * 0.12);
    scrawl(c, line, tw / 2, 118, 17, (r() - 0.5) * 0.1, '#5a1b12');
    grime(c, tw, h, 1.1, i + 3);
    c.restore();
  });
});
export const TAG_COUNT = TAGS.length;
artPaint('wlOverhead', 640, 128, (c, w, h, r) => {
  // the banner strung across the last switchback
  c.fillStyle = '#e9e3d4';
  c.fillRect(0, 0, w, h);
  stencil(c, 'THANK YOU FOR YOUR PATIENCE', w / 2, 82, 50, '#3a2a2a', 'center', 800, F_UI);
  grime(c, w, h, 1.5, 31);
  blast(c, w, h, r, 500, 4);
});
