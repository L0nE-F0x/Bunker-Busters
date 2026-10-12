import * as THREE from 'three/webgpu';
import { canvasTexture, grime, norm } from '../../world/kit';

/**
 * The Singularity Dome's printed art in one canvas, through one alpha-tested material (one draw):
 * Ascend's chevron and signs, the gate and the visitor hut, the culture banners over the chairs,
 * the pond warnings, rack labels, Gil's whiteboard, the pod's plate. The release board over the
 * stage is a live canvas (`paintBoard`), repainted when a patch ships or the approval clock ticks.
 */

type Draw = (c: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void;
interface Region { u0: number; u1: number; v0: number; v1: number }

const W = 2048, H = 2048, PAD = 4;
const DISPLAY = '"Big Shoulders Stencil Display", Impact, sans-serif';
const UI = '"Chakra Petch", Arial, sans-serif';
const MONO = '"JetBrains Mono", monospace';
/** Ascend's gold, its near-black, and the warning yellow the facilities team used. */
export const GOLD = '#d8b25a';
const INK = '#141519';
const PAPER = '#f2efe8';
const WARN = '#f2c230';

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

/** Ascend's mark: a chevron pointing up, cut by a thin line under its tip. */
export function chevron(c: CanvasRenderingContext2D, cx: number, cy: number, s: number, ink: string) {
  c.save();
  c.fillStyle = ink;
  c.beginPath();
  c.moveTo(cx - s, cy + s * 0.55);
  c.lineTo(cx, cy - s * 0.6);
  c.lineTo(cx + s, cy + s * 0.55);
  c.lineTo(cx + s * 0.62, cy + s * 0.55);
  c.lineTo(cx, cy - s * 0.12);
  c.lineTo(cx - s * 0.62, cy + s * 0.55);
  c.closePath();
  c.fill();
  c.fillRect(cx - s * 0.18, cy + s * 0.05, s * 0.36, s * 0.07);
  c.restore();
}

function wordmark(c: CanvasRenderingContext2D, x: number, y: number, h: number, ink: string, maxW: number) {
  chevron(c, x + h * 0.5, y - h * 0.36, h * 0.42, ink);
  fit(c, 'ASCEND', x + h * 1.15, y, `600 ${h}px ${UI}`, ink, maxW - h * 1.15, 'left');
}

function lines(c: CanvasRenderingContext2D, ls: string[], x: number, y: number, lh: number, font: string, fill: string, maxW: number) {
  ls.forEach((l, i) => fit(c, l, x, y + i * lh, font, fill, maxW, 'left'));
}

/** A tall culture banner (hung from the dome frame over the chairs). */
function banner(text: string[]): [number, number, Draw] {
  return [256, 768, (c, w, h, r) => {
    c.fillStyle = INK; c.fillRect(0, 0, w, h);
    c.fillStyle = GOLD; c.fillRect(0, 0, w, 10); c.fillRect(0, h - 10, w, 10);
    chevron(c, w / 2, 90, 46, GOLD);
    text.forEach((t, i) => fit(c, t, w / 2, 260 + i * 92, `700 82px ${DISPLAY}`, PAPER, w - 40));
    grime(c, w, h, 0.35, Math.floor(r() * 99));
  }];
}

const DRAW: Record<string, [number, number, Draw]> = {
  // the sign on the gate, and the one at the road's end
  gateSign: [1024, 512, (c, w, h, r) => {
    c.fillStyle = INK; c.fillRect(0, 0, w, h);
    wordmark(c, 60, 150, 110, GOLD, 560);
    fit(c, 'THE DOME', 60, 300, `800 140px ${DISPLAY}`, PAPER, w - 120, 'left');
    c.fillStyle = GOLD; c.fillRect(60, 340, w - 120, 4);
    fit(c, 'VOICE ACCESS ONLY · NO DELIVERIES · NO WAITLIST ENQUIRIES', 60, 400, `500 30px ${UI}`, '#b9b4aa', w - 120, 'left');
    fit(c, 'Visitors: please state your name at the post.', 60, 450, `400 26px ${UI}`, '#8b867d', w - 120, 'left');
    grime(c, w, h, 0.6, Math.floor(r() * 99));
  }],
  roadSign: [640, 400, (c, w, h, r) => {
    c.fillStyle = PAPER; c.fillRect(0, 0, w, h);
    c.fillStyle = INK; c.fillRect(0, 0, w, 120);
    wordmark(c, 34, 88, 70, GOLD, 420);
    fit(c, 'PRIVATE ROAD', 34, 200, `800 64px ${DISPLAY}`, INK, w - 68, 'left');
    fit(c, 'THE DOME · 400 m', 34, 262, `600 38px ${UI}`, INK, w - 68, 'left');
    fit(c, 'Ascend vehicles have right of way', 34, 330, `400 26px ${UI}`, '#5c5850', w - 68, 'left');
    grime(c, w, h, 0.9, Math.floor(r() * 99));
  }],
  hutSign: [512, 160, (c, w, h, r) => {
    c.fillStyle = PAPER; c.fillRect(0, 0, w, h);
    chevron(c, 54, 78, 30, GOLD);
    fit(c, 'VISITOR CENTRE', 100, 80, `700 50px ${UI}`, INK, w - 120, 'left');
    fit(c, 'Please wait to be verified', 100, 124, `400 26px ${UI}`, '#6a655c', w - 120, 'left');
    grime(c, w, h, 1.0, Math.floor(r() * 99));
  }],
  intercom: [256, 128, (c, w, h) => {
    c.fillStyle = '#2a2b2f'; c.fillRect(0, 0, w, h);
    fit(c, 'PRESS TO TALK', w / 2, 52, `600 28px ${UI}`, PAPER, w - 20);
    fit(c, 'voice access · say your name', w / 2, 94, `400 18px ${UI}`, '#9a958c', w - 20);
  }],
  // scratched into the hut's wall by the desk: tally marks
  tally: [256, 256, (c, w, h, r) => {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(40,36,30,0.85)';
    c.lineWidth = 3;
    for (let g = 0; g < 8; g++) {
      const x0 = 18 + (g % 4) * 58, y0 = 24 + Math.floor(g / 4) * 110;
      const n = g < 8 ? 5 : 1;
      for (let i = 0; i < n; i++) {
        c.beginPath();
        if (i < 4) { c.moveTo(x0 + i * 10 + r() * 2, y0); c.lineTo(x0 + i * 10 + r() * 3, y0 + 64); } else { c.moveTo(x0 - 6, y0 + 50); c.lineTo(x0 + 40, y0 + 12); }
        c.stroke();
      }
    }
    c.beginPath(); c.moveTo(30, 250); c.lineTo(30, 190); c.stroke();
    fit(c, '41', 200, 240, `400 30px ${MONO}`, 'rgba(40,36,30,0.85)', 80);
  }],
  airlock: [512, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    fit(c, 'AIRLOCK · KEEP THE DUST OUT', w / 2, 84, `800 64px ${DISPLAY}`, WARN, w - 20);
  }],
  allHands: [1024, 256, (c, w, h, r) => {
    c.fillStyle = INK; c.fillRect(0, 0, w, h);
    chevron(c, 90, 124, 50, GOLD);
    fit(c, 'ALL-HANDS · 09:00 · EVERY DAY', 170, 120, `800 90px ${DISPLAY}`, PAPER, w - 200, 'left');
    fit(c, 'Attendance is a value.', 170, 190, `500 40px ${UI}`, GOLD, w - 200, 'left');
    grime(c, w, h, 0.3, Math.floor(r() * 99));
  }],
  bannerShip: banner(['SHIP', 'EVERY', 'DAY']),
  bannerGrowth: banner(['GROWTH', 'IS THE', 'PRODUCT']),
  bannerDay: banner(['IT\'S', 'STILL', 'DAY ONE']),
  bannerHuman: banner(['A HUMAN', 'IN EVERY', 'LOOP']),
  pondSign: [512, 320, (c, w, h, r) => {
    c.fillStyle = WARN; c.fillRect(0, 0, w, h);
    c.fillStyle = INK; c.fillRect(14, 14, w - 28, h - 28);
    fit(c, 'COOLING WATER', w / 2, 92, `800 70px ${DISPLAY}`, WARN, w - 60);
    fit(c, 'NOT FOR DRINKING', w / 2, 168, `700 48px ${UI}`, PAPER, w - 60);
    fit(c, 'Treated with biocide. Ascend Facilities.', w / 2, 240, `400 26px ${UI}`, '#b9b4aa', w - 60);
    grime(c, w, h, 0.8, Math.floor(r() * 99));
  }],
  farmSign: [512, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    fit(c, 'BUILD FARM · CI/CD', 20, 64, `700 50px ${UI}`, PAPER, w - 40, 'left');
    fit(c, 'Engineers only. Do not unplug anything.', 20, 108, `400 24px ${UI}`, '#c8c2b6', w - 40, 'left');
  }],
  podPlate: [512, 160, (c, w, h) => {
    c.fillStyle = '#2b2416'; c.fillRect(0, 0, w, h);
    c.strokeStyle = GOLD; c.lineWidth = 6; c.strokeRect(10, 10, w - 20, h - 20);
    fit(c, 'H. VALE · FOUNDER', w / 2, 100, `600 54px ${UI}`, GOLD, w - 60);
  }],
  rackLabel: [256, 64, (c, w, h) => {
    c.fillStyle = PAPER; c.fillRect(0, 0, w, h);
    fit(c, 'PROD · DO NOT POWER OFF', w / 2, 42, `700 24px ${MONO}`, INK, w - 12);
  }],
  // Gil's whiteboard at the on-call desk
  gilBoard: [512, 384, (c, w, h, r) => {
    c.fillStyle = '#eceae4'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#9c9a94'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8);
    fit(c, 'ON CALL: G. MENON', 24, 54, `700 34px ${MONO}`, '#1f4fa8', w - 48, 'left');
    fit(c, 'handover: ________', 24, 100, `400 26px ${MONO}`, '#1f4fa8', w - 48, 'left');
    lines(c, ['- approve everything (policy)', '- review window: use ALL of it', '- noodles: aisle 7, row 2', '- do NOT tell it about the hut'], 24, 156, 40, `400 24px ${MONO}`, '#2b2b2b', w - 48);
    c.fillStyle = '#c0392b';
    fit(c, 'day 1,284', w - 24, h - 30, `700 30px ${MONO}`, '#c0392b', 220, 'right');
    grime(c, w, h, 0.25, Math.floor(r() * 99));
  }],
  clusterTag: [256, 192, (c, w, h) => {
    c.fillStyle = '#b8231b'; c.fillRect(0, 0, w, h);
    fit(c, 'MAINS', w / 2, 80, `800 64px ${DISPLAY}`, PAPER, w - 20);
    fit(c, 'CLUSTER · HV-BETA', w / 2, 140, `600 26px ${MONO}`, PAPER, w - 20);
  }],
  towerA: [256, 128, (c, w, h) => { c.clearRect(0, 0, w, h); fit(c, 'CT-1', w / 2, 100, `800 110px ${DISPLAY}`, INK, w - 10); }],
  towerB: [256, 128, (c, w, h) => { c.clearRect(0, 0, w, h); fit(c, 'CT-2', w / 2, 100, `800 110px ${DISPLAY}`, INK, w - 10); }],
  culvertSign: [384, 192, (c, w, h, r) => {
    c.fillStyle = WARN; c.fillRect(0, 0, w, h);
    fit(c, 'OUTFALL 3', w / 2, 80, `800 64px ${DISPLAY}`, INK, w - 30);
    fit(c, 'Confined space. Do not enter.', w / 2, 140, `500 26px ${UI}`, INK, w - 30);
    grime(c, w, h, 1.2, Math.floor(r() * 99));
  }],
  // the framed keynote poster in the pod (the same line the Starlite's screen shows)
  keynote: [384, 512, (c, w, h, r) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1b1f27'); g.addColorStop(1, '#07080b');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    // a man on a stage, from behind the front row: a silhouette in a spot
    c.fillStyle = 'rgba(255,230,180,0.18)';
    c.beginPath(); c.moveTo(w / 2 - 30, 40); c.lineTo(w / 2 + 30, 40); c.lineTo(w / 2 + 120, 330); c.lineTo(w / 2 - 120, 330); c.fill();
    c.fillStyle = '#05060a';
    c.beginPath(); c.arc(w / 2, 170, 26, 0, Math.PI * 2); c.fill();
    c.fillRect(w / 2 - 40, 196, 80, 120);
    c.fillRect(w / 2 - 70, 210, 34, 70); c.fillRect(w / 2 + 36, 200, 34, 50);
    fit(c, 'HE CHANGED', w / 2, 400, `800 52px ${DISPLAY}`, PAPER, w - 40);
    fit(c, 'EVERYTHING. AGAIN.', w / 2, 452, `800 52px ${DISPLAY}`, GOLD, w - 40);
    fit(c, 'ASCEND · LIVE AT THE STARLITE', w / 2, 490, `500 18px ${UI}`, '#9a958c', w - 40);
    grime(c, w, h, 0.2, Math.floor(r() * 99));
  }],
  chevronGold: [256, 256, (c, w, h) => { c.clearRect(0, 0, w, h); chevron(c, w / 2, h / 2 + 10, 100, GOLD); }],
};

let _atlas: { tex: THREE.CanvasTexture; regions: Record<string, Region> } | null = null;
function atlas() {
  if (_atlas) return _atlas;
  const regions: Record<string, Region> = {};
  const entries = Object.entries(DRAW).sort((a, b) => b[1][1] - a[1][1] || b[1][0] - a[1][0]);
  const tex = canvasTexture(W, H, (ctx) => {
    ctx.clearRect(0, 0, W, H);
    // first-fit shelves (tallest first): a later, shorter print fills a gap on an earlier shelf
    const shelves: { y: number; h: number; x: number }[] = [];
    let seed = 41;
    for (const [name, [w, h, draw]] of entries) {
      let sh = shelves.find((q) => q.x + w <= W && h <= q.h);
      if (!sh) {
        const last = shelves[shelves.length - 1];
        sh = { y: last ? last.y + last.h + PAD : 0, h, x: 0 };
        shelves.push(sh);
      }
      const x = sh.x, y = sh.y;
      if (y + h > H) throw new Error('dome atlas full at ' + name);
      sh.x += w + PAD;
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      draw(ctx, w, h, rng(seed++));
      ctx.restore();
      regions[name] = { u0: (x + 1) / W, u1: (x + w - 1) / W, v0: 1 - (y + h - 1) / H, v1: 1 - (y + 1) / H };
    }
  });
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  _atlas = { tex, regions };
  return _atlas;
}

/** A w×h quad showing `name`, built facing +z, then placed by `m`. */
export function domePrint(name: string, w: number, h: number, m: THREE.Matrix4) {
  const r = atlas().regions[name];
  if (!r) throw new Error('no dome print ' + name);
  const g = new THREE.PlaneGeometry(w, h);
  const a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, r.u0 + a.getX(i) * (r.u1 - r.u0), r.v0 + a.getY(i) * (r.v1 - r.v0));
  return norm(g.applyMatrix4(m));
}

let _mat: THREE.MeshStandardNodeMaterial | null = null;
/** Lit, alpha-tested (letters on clear), double-sided. */
export function domePrintMaterial() {
  if (_mat) return _mat;
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, side: THREE.DoubleSide, alphaTest: 0.45 });
  m.map = atlas().tex;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  return (_mat = m);
}

// ------------------------------------------------------------------ the release board over the stage
export interface BoardView {
  version: string;
  /** Shipped this visit, newest first: name + note. */
  shipped: { name: string; note: string }[];
  /** A fix waiting on Gil: its name and seconds left; or why nothing can ship. */
  pending: { name: string; left: number } | null;
  status: 'live' | 'freeze' | 'down' | 'dark' | 'mission';
  day: number;
}

/** The board: release number, the patch notes, the approval clock, and the all-hands count. */
export function paintBoard(c: CanvasRenderingContext2D, w: number, h: number, v: BoardView) {
  c.fillStyle = '#07090c'; c.fillRect(0, 0, w, h);
  if (v.status === 'dark') return;
  c.fillStyle = '#10141a'; c.fillRect(10, 10, w - 20, h - 20);
  chevron(c, 54, 58, 26, GOLD);
  fit(c, 'ASCEND · THE DOME', 96, 68, `600 32px ${UI}`, '#cfd6de', 420, 'left');
  fit(c, `RELEASE v${v.version}`, w - 30, 68, `700 40px ${MONO}`, GOLD, 420, 'right');
  c.fillStyle = '#26303b'; c.fillRect(30, 92, w - 60, 3);
  if (v.status === 'mission') {
    fit(c, 'OBJECTIVE', 40, 160, `600 30px ${MONO}`, '#7fd6ff', w - 80, 'left');
    fit(c, 'KEEP THE VALLEY ALIVE', 40, 240, `800 74px ${DISPLAY}`, '#e9eef2', w - 80, 'left');
    fit(c, 'Deliveries: Last Chance camp, every morning. 2 × water, 1 × battery.', 40, 310, `500 28px ${UI}`, '#9fb0bf', w - 80, 'left');
  } else {
    fit(c, 'PATCH NOTES', 40, 140, `600 26px ${MONO}`, '#7fd6ff', 300, 'left');
    if (!v.shipped.length) fit(c, 'No changes yet this visit.', 40, 186, `400 28px ${UI}`, '#7d8a96', w - 80, 'left');
    v.shipped.slice(0, 4).forEach((p, i) => {
      const y = 186 + i * 62;
      fit(c, `· ${p.name}`, 40, y, `700 30px ${UI}`, '#e9eef2', w - 80, 'left');
      fit(c, p.note, 64, y + 28, `400 22px ${UI}`, '#9fb0bf', w - 104, 'left');
    });
  }
  const y0 = h - 110;
  c.fillStyle = '#26303b'; c.fillRect(30, y0 - 26, w - 60, 3);
  if (v.status === 'freeze') {
    fit(c, 'CODE FREEZE · NOTHING SHIPS · G. MENON', 40, y0 + 20, `700 34px ${MONO}`, '#ffb347', w - 80, 'left');
  } else if (v.status === 'down') {
    fit(c, 'PIPELINE DOWN · BUILD FARM UNREACHABLE', 40, y0 + 20, `700 34px ${MONO}`, '#ff5a4a', w - 80, 'left');
  } else if (v.pending) {
    fit(c, `AWAITING HUMAN APPROVAL · G. MENON · ${Math.ceil(v.pending.left)} s`, 40, y0 + 6, `700 32px ${MONO}`, '#ffd27a', w - 80, 'left');
    fit(c, `fix: ${v.pending.name.toLowerCase()}`, 40, y0 + 46, `400 26px ${MONO}`, '#c9b98f', w - 80, 'left');
  } else if (v.status !== 'mission') {
    fit(c, 'ALL SYSTEMS SHIPPING', 40, y0 + 20, `700 34px ${MONO}`, '#5fe08a', w - 80, 'left');
  }
  fit(c, `ALL-HANDS #${v.day.toLocaleString('en-US')}`, w - 30, h - 34, `500 24px ${MONO}`, '#6f7c88', 360, 'right');
}
