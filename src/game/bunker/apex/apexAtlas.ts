import * as THREE from 'three/webgpu';
import { texture, uniform, vec4 } from 'three/tsl';
import { canvasTexture, grime, norm } from '../../world/kit';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/**
 * Apex Vault's printed art in one canvas (its own: the shared print atlas belongs to the outposts and
 * the Spire): Vesper's meme posters, the wordmark, signs, stripes and floor stencils. Everything
 * painted samples it through ONE alpha-tested material, so all of it merges into a single draw.
 * The two live screens (her feed over the hangar, the launch clock) are separate small canvases.
 */

type Draw = (c: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void;
interface Region { u0: number; u1: number; v0: number; v1: number }

const W = 2048, H = 1024, PAD = 4;
const DISPLAY = '"Big Shoulders Stencil Display", Impact, sans-serif';
const UI = '"Chakra Petch", Arial, sans-serif';
const MONO = '"JetBrains Mono", monospace';

function rng(seed: number) {
  let s = (seed * 2654435761) % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** Text squeezed to fit `maxW`. */
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

/** A paper poster: off-white stock, a printed field, worn edges, tape. */
function poster(bg: string, draw: Draw): Draw {
  return (c, w, h, r) => {
    c.fillStyle = '#e9e4d8';
    c.fillRect(0, 0, w, h);
    c.fillStyle = bg;
    c.fillRect(10, 10, w - 20, h - 20);
    draw(c, w, h, r);
    grime(c, w, h, 0.55, Math.floor(r() * 100));
    // sun-bleach and a torn corner
    c.fillStyle = 'rgba(255,248,230,0.12)';
    c.fillRect(0, 0, w, h * 0.4);
    c.fillStyle = 'rgba(0,0,0,0)';
    c.clearRect(w - 26, h - 30, 30, 34);
    c.fillStyle = 'rgba(220,210,170,0.7)';
    c.fillRect(w / 2 - 22, -2, 44, 16);
  };
}

/** Paint at 256×384 design size into a 224×336 slot (the eight posters share one atlas row). */
function small(d: Draw): Draw {
  return (c, _w, _h, r) => { c.scale(0.875, 0.875); d(c, 256, 384, r); };
}

const DRAW: Record<string, [number, number, Draw]> = {
  // the wordmark: black stencil capitals on clear (alpha-tested), for the hangar arch and the booster
  logo: [1024, 224, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    fit(c, 'APEX', w / 2, h * 0.86, `900 ${h * 1.02}px ${DISPLAY}`, '#101114', w - 20);
  }],
  // posters (256×384 each)
  pMars: [224, 336, small(poster('#b8321e', (c, w, h) => {
    c.fillStyle = '#f4e9d0';
    c.beginPath(); c.arc(w / 2, h * 0.36, 70, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#b8321e';
    for (let i = 0; i < 6; i++) { c.beginPath(); c.arc(w / 2 - 40 + i * 17, h * 0.3 + (i % 3) * 22, 8 + (i % 2) * 5, 0, Math.PI * 2); c.fill(); }
    fit(c, 'OCCUPY MARS', w / 2, h * 0.7, `900 52px ${DISPLAY}`, '#f4e9d0', w - 30);
    fit(c, '(EVENTUALLY)', w / 2, h * 0.8, `600 26px ${UI}`, '#f4e9d0', w - 40);
    fit(c, 'APEX · SEED PROGRAM', w / 2, h * 0.92, `600 16px ${MONO}`, '#f4e9d0', w - 40);
  }))],
  pFree: [224, 336, small(poster('#14161a', (c, w, h) => {
    fit(c, 'THE CAMPS', w / 2, h * 0.3, `900 58px ${DISPLAY}`, '#f2f2ff', w - 30);
    fit(c, 'ARE THE', w / 2, h * 0.46, `900 46px ${DISPLAY}`, '#f2f2ff', w - 30);
    fit(c, 'FREE TIER', w / 2, h * 0.64, `900 64px ${DISPLAY}`, '#ffcf3a', w - 30);
    fit(c, 'upgrade or hydrate elsewhere', w / 2, h * 0.8, `500 18px ${UI}`, '#9aa0aa', w - 30);
  }))],
  pPart: [224, 336, small(poster('#e8e6e0', (c, w, h) => {
    fit(c, 'THE BEST PART', w / 2, h * 0.2, `900 40px ${DISPLAY}`, '#101114', w - 30);
    fit(c, 'IS NO PART.', w / 2, h * 0.32, `900 40px ${DISPLAY}`, '#101114', w - 30);
    c.fillStyle = '#c0281c'; c.fillRect(30, h * 0.4, w - 60, 6);
    fit(c, 'THE BEST CAMP', w / 2, h * 0.56, `900 40px ${DISPLAY}`, '#c0281c', w - 30);
    fit(c, 'IS NO CAMP.', w / 2, h * 0.68, `900 40px ${DISPLAY}`, '#c0281c', w - 30);
    fit(c, '— V.K., first principles', w / 2, h * 0.86, `500 18px ${UI}`, '#3a3c40', w - 40);
  }))],
  pHard: [224, 336, small(poster('#ffd21a', (c, w, h) => {
    fit(c, 'HARDCORE', w / 2, h * 0.26, `900 60px ${DISPLAY}`, '#101114', w - 26);
    fit(c, 'MODE: ON', w / 2, h * 0.42, `900 60px ${DISPLAY}`, '#101114', w - 26);
    c.fillStyle = '#101114'; c.fillRect(24, h * 0.5, w - 48, 3);
    fit(c, 'HYDRATION IS', w / 2, h * 0.64, `700 30px ${UI}`, '#101114', w - 30);
    fit(c, 'A SOFT SKILL', w / 2, h * 0.74, `700 30px ${UI}`, '#101114', w - 30);
  }))],
  pStonks: [224, 336, small(poster('#0b1a2a', (c, w, h) => {
    c.strokeStyle = '#2a4a6a'; c.lineWidth = 1;
    for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(24, 60 + i * 34); c.lineTo(w - 24, 60 + i * 34); c.stroke(); }
    c.lineWidth = 7; c.strokeStyle = '#3cff8a';
    c.beginPath(); c.moveTo(28, 230); c.lineTo(80, 200); c.lineTo(110, 215); c.lineTo(160, 130); c.lineTo(190, 145); c.lineTo(230, 60); c.stroke();
    c.strokeStyle = '#ff3a3a';
    c.beginPath(); c.moveTo(28, 90); c.lineTo(90, 120); c.lineTo(130, 110); c.lineTo(180, 200); c.lineTo(230, 236); c.stroke();
    fit(c, 'WATER ▲', 30, 290, `700 28px ${UI}`, '#3cff8a', w - 40, 'left');
    fit(c, 'CAMPS ▼', 30, 326, `700 28px ${UI}`, '#ff3a3a', w - 40, 'left');
    fit(c, 'number go up', w - 26, 360, `500 16px ${MONO}`, '#9ab', w - 40, 'right');
  }))],
  pPoll: [224, 336, small(poster('#f6f6f8', (c, w, h) => {
    fit(c, '@vesper', 30, 50, `700 22px ${UI}`, '#101114', w - 40, 'left');
    fit(c, 'should the camps', 30, 92, `500 22px ${UI}`, '#101114', w - 50, 'left');
    fit(c, 'get water?', 30, 120, `500 22px ${UI}`, '#101114', w - 50, 'left');
    c.fillStyle = '#d8dce4'; c.fillRect(30, 150, w - 60, 40); c.fillRect(30, 204, w - 60, 40);
    c.fillStyle = '#9fb4ff'; c.fillRect(30, 150, (w - 60) * 0.12, 40);
    c.fillStyle = '#3a6bff'; c.fillRect(30, 204, (w - 60) * 0.88, 40);
    fit(c, 'yes   12%', 40, 178, `600 20px ${UI}`, '#101114', w - 80, 'left');
    fit(c, 'lol   88%', 40, 232, `600 20px ${UI}`, '#f6f6f8', w - 80, 'left');
    fit(c, '41,880,112 votes · final', 30, 280, `500 15px ${MONO}`, '#667', w - 50, 'left');
    fit(c, 'DEMOCRACY HAS SPOKEN', w / 2, 340, `900 30px ${DISPLAY}`, '#c0281c', w - 30);
  }))],
  pLaunch: [224, 336, small(poster('#1c2440', (c, w, h, r) => {
    for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.6})`; c.fillRect(r() * w, r() * h * 0.6, 2, 2); }
    c.fillStyle = '#dfe3ea';
    c.fillRect(w / 2 - 14, 80, 28, 150);
    c.beginPath(); c.moveTo(w / 2 - 14, 80); c.quadraticCurveTo(w / 2, 30, w / 2 + 14, 80); c.fill();
    c.fillStyle = '#ff9a2a';
    c.beginPath(); c.moveTo(w / 2 - 12, 232); c.lineTo(w / 2, 290); c.lineTo(w / 2 + 12, 232); c.fill();
    fit(c, 'T-MINUS', w / 2, 320, `900 44px ${DISPLAY}`, '#ffcf3a', w - 30);
    fit(c, 'ALWAYS', w / 2, 358, `900 34px ${DISPLAY}`, '#f2f2ff', w - 30);
  }))],
  pHR: [224, 336, small(poster('#2a2a2e', (c, w, h) => {
    fit(c, 'THERE IS', w / 2, h * 0.22, `900 54px ${DISPLAY}`, '#f2f2ff', w - 30);
    fit(c, 'NO HR.', w / 2, h * 0.38, `900 70px ${DISPLAY}`, '#ff4a2a', w - 30);
    fit(c, 'THERE IS', w / 2, h * 0.58, `900 54px ${DISPLAY}`, '#f2f2ff', w - 30);
    fit(c, 'ONLY UP.', w / 2, h * 0.76, `900 70px ${DISPLAY}`, '#ffcf3a', w - 30);
  }))],
  // hazard stripes and floor chevrons
  stripes: [256, 64, (c, w, h) => {
    c.fillStyle = '#e8b81a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#121212';
    for (let x = -h; x < w + h; x += 48) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + 24, h); c.lineTo(x + 24 + h, 0); c.lineTo(x + h, 0); c.fill(); }
    grime(c, w, h, 0.8, 3);
  }],
  chevron: [256, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#f0c020';
    for (let i = 0; i < 3; i++) {
      const x = 30 + i * 70;
      c.beginPath(); c.moveTo(x, 10); c.lineTo(x + 36, h / 2); c.lineTo(x, h - 10); c.lineTo(x + 22, h - 10); c.lineTo(x + 58, h / 2); c.lineTo(x + 22, 10); c.fill();
    }
    grime(c, w, h, 0.9, 7);
  }],
  // signs
  board: [768, 128, (c, w, h) => {
    c.fillStyle = '#101114'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#e8b81a'; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, h - 12);
    fit(c, 'DAYS SINCE LAST RAPID UNSCHEDULED DISASSEMBLY', w / 2 - 50, 56, `700 32px ${UI}`, '#f2f2ff', w - 160);
    fit(c, 'we celebrate failure here · it\'s cheaper than testing', w / 2 - 50, 98, `500 20px ${MONO}`, '#8a8f99', w - 160);
    c.fillStyle = '#c0281c'; c.fillRect(w - 110, 18, 92, 92);
    fit(c, '0', w - 64, 98, `900 92px ${DISPLAY}`, '#f2f2ff', 80);
  }],
  corridor: [768, 96, (c, w, h) => {
    c.fillStyle = '#e8e6e0'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#c0281c'; c.fillRect(0, 0, 96, h);
    fit(c, '!', 48, 78, `900 80px ${DISPLAY}`, '#f2f2ff', 60);
    fit(c, 'LAUNCH CORRIDOR', 120, 52, `900 46px ${DISPLAY}`, '#101114', w - 140, 'left');
    fit(c, 'SEED MEMBERS ONLY · LASERS ARE A FEATURE', 120, 84, `600 22px ${UI}`, '#3a3c40', w - 140, 'left');
    grime(c, w, h, 0.4, 11);
  }],
  cistern: [768, 96, (c, w, h) => {
    c.fillStyle = '#0f3a5a'; c.fillRect(0, 0, w, h);
    fit(c, 'CISTERN ROOM', 24, 54, `900 48px ${DISPLAY}`, '#f2f2ff', w - 48, 'left');
    fit(c, 'WATER IS A FEATURE. DO NOT DRINK THE VALUATION.', 24, 84, `600 20px ${UI}`, '#9fd4ff', w - 48, 'left');
  }],
  gate: [768, 160, (c, w, h) => {
    c.fillStyle = '#f2f2f4'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#101114'; c.fillRect(0, h - 30, w, 30);
    fit(c, 'APEX', 30, 96, `900 104px ${DISPLAY}`, '#101114', 300, 'left');
    fit(c, 'PRIVATE LAUNCH SITE', 300, 62, `700 34px ${UI}`, '#101114', w - 330, 'left');
    fit(c, 'TRESPASSERS WILL BE POSTED', 300, 104, `700 30px ${UI}`, '#c0281c', w - 330, 'left');
    fit(c, 'a Kade Holdings company · all water is property', w / 2, h - 9, `500 18px ${MONO}`, '#f2f2f4', w - 40);
    grime(c, w, h, 0.7, 19);
  }],
  tminus: [384, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    fit(c, 'T-3   T-2   T-1', w / 2, h * 0.8, `900 104px ${DISPLAY}`, '#f2f2f0', w - 10);
    grime(c, w, h, 1, 23);
  }],
  plate: [128, 64, (c, w, h) => {
    c.fillStyle = '#f4f4f0'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#101114'; c.lineWidth = 3; c.strokeRect(3, 3, w - 6, h - 6);
    fit(c, '4PEX', w / 2, 46, `900 40px ${DISPLAY}`, '#101114', w - 16);
  }],
  // spray paint: someone in the camps got here first
  tag: [512, 160, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.save(); c.translate(20, 20); c.rotate(-0.06);
    fit(c, 'WATER ISN\'T A FEATURE', 0, 70, `900 64px ${DISPLAY}`, 'rgba(40,150,220,0.92)', w - 40, 'left');
    fit(c, '— the free tier', 120, 120, `700 34px ${UI}`, 'rgba(40,150,220,0.9)', w - 160, 'left');
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
    let x = 0, y = 0, rowH = 0, seed = 3;
    for (const [name, [w, h, draw]] of entries) {
      if (x + w + PAD > W) { x = 0; y += rowH + PAD; rowH = 0; }
      if (y + h > H) throw new Error('apex atlas full at ' + name);
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
export function apexPrint(name: string, w: number, h: number, m: THREE.Matrix4) {
  const r = atlas().regions[name];
  if (!r) throw new Error('no apex print ' + name);
  const g = new THREE.PlaneGeometry(w, h);
  const a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, r.u0 + a.getX(i) * (r.u1 - r.u0), r.v0 + a.getY(i) * (r.v1 - r.v0));
  return norm(g.applyMatrix4(m));
}

let _mat: THREE.MeshStandardNodeMaterial | null = null;
/** Lit, alpha-tested (letters on clear), double-sided. */
export function apexPrintMaterial() {
  if (_mat) return _mat;
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, side: THREE.DoubleSide, alphaTest: 0.45 });
  m.map = atlas().tex;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  return (_mat = m);
}

/**
 * A live screen: a small canvas drawn by `paint`, shown emissive at `glow`. `repaint()` redraws it
 * and uploads once (call it rarely: on a flag change, or once a game minute).
 */
export class LiveScreen {
  readonly material: THREE.MeshBasicNodeMaterial;
  readonly glow = uniform(1.6);
  private tex: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;

  constructor(readonly w: number, readonly h: number, public paint: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
    this.tex = canvasTexture(w, h, (c) => paint(c, w, h));
    this.ctx = (this.tex.image as HTMLCanvasElement).getContext('2d')!;
    this.tex.generateMipmaps = false;
    this.tex.minFilter = THREE.LinearFilter;
    const m = new THREE.MeshBasicNodeMaterial({ fog: true });
    const t: N = texture(this.tex);
    m.colorNode = vec4(t.rgb.mul(this.glow), 1);
    this.material = m;
  }

  repaint() {
    this.paint(this.ctx, this.w, this.h);
    this.tex.needsUpdate = true;
  }
}
