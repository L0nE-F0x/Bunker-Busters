import * as THREE from 'three/webgpu';
import { canvasTexture, norm } from './kit';

/**
 * Printed faces for the lore pickups (intelProps.ts) and the side-quest props (sites/stories.ts):
 * the founders' chat on a screen, Kade's break-room poster, Glimpse's flyer, Careful's notice, an
 * investor update, a station log, a letter, a school sign, a chalk pool. One canvas, shelf-packed,
 * one lit material (alpha-tested, so the chalk can be a decal) and one faintly glowing screen
 * material. Built lazily on first use, which is at boot (Game.build), before the shader warm-up.
 */

type Draw = (c: CanvasRenderingContext2D, w: number, h: number) => void;
interface Region { u0: number; u1: number; v0: number; v1: number }

const W = 1024, H = 1024, PAD = 4;
const UI = '"Chakra Petch", Arial, sans-serif';
const DISPLAY = '"Big Shoulders Stencil Display", Impact, sans-serif';
const MONO = '"JetBrains Mono", monospace';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** Hand-drawn squiggle lines standing in for text too small to read anyway. */
function scribble(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, step: number, color: string, width = 1.6) {
  c.strokeStyle = color; c.lineWidth = width;
  for (let y = y0; y < y1; y += step) {
    c.beginPath();
    let x = x0 + rnd() * 4;
    c.moveTo(x, y);
    const end = x1 - rnd() * (x1 - x0) * 0.35;
    while (x < end) { x += 3 + rnd() * 6; c.lineTo(x, y - 1.5 + rnd() * 3); }
    c.stroke();
  }
}
function textLines(c: CanvasRenderingContext2D, x: number, y: number, w: number, step: number, n: number, color: string) {
  c.fillStyle = color;
  for (let i = 0; i < n; i++) c.fillRect(x, y + i * step, w * (0.55 + rnd() * 0.45), Math.max(2, step * 0.35));
}
function weather(c: CanvasRenderingContext2D, w: number, h: number, k = 1) {
  c.save();
  c.globalCompositeOperation = 'multiply';
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(160,120,70,0.05)');
  g.addColorStop(1, `rgba(140,95,50,${0.35 * k})`);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 40 * k; i++) {
    c.fillStyle = `rgba(110,80,50,${0.05 + rnd() * 0.12})`;
    c.beginPath(); c.arc(rnd() * w, rnd() * h, 1 + rnd() * 6, 0, Math.PI * 2); c.fill();
  }
  c.restore();
}
function bubbleChat(c: CanvasRenderingContext2D, w: number, h: number, wide: boolean) {
  c.fillStyle = '#0d1420'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#18243a'; c.fillRect(0, 0, w, wide ? 30 : 40);
  c.fillStyle = '#cfe0ff'; c.font = `700 ${wide ? 15 : 17}px ${UI}`; c.textBaseline = 'middle';
  c.fillText('LIFEBOAT', 12, wide ? 15 : 20);
  c.fillStyle = '#7f93b5'; c.font = `500 ${wide ? 10 : 11}px ${UI}`;
  c.fillText('7 members · 1 removed', wide ? 100 : 12, wide ? 16 : 34);
  let y = wide ? 40 : 54;
  let side = 0;
  while (y < h - 30) {
    const mine = side++ % 3 === 2;
    const bw = (wide ? w * 0.5 : w * 0.66) * (0.6 + rnd() * 0.4);
    const bh = 18 + Math.floor(rnd() * 2) * 14;
    const x = mine ? w - bw - 10 : 10;
    c.fillStyle = mine ? '#2f6fe0' : '#273349';
    c.beginPath();
    c.roundRect(x, y, bw, bh, 8);
    c.fill();
    scribble(c, x + 8, y + 10, x + bw - 6, y + bh - 4, 13, mine ? 'rgba(235,245,255,0.85)' : 'rgba(200,215,240,0.7)', 1.3);
    y += bh + 8;
  }
  c.fillStyle = '#18243a'; c.fillRect(0, h - 24, w, 24);
  c.fillStyle = '#ff5a4a'; c.font = `600 10px ${UI}`;
  c.fillText('Sync failed · retrying at 03:00', 10, h - 12);
}

const ART: Record<string, [number, number, Draw]> = {
  chat: [192, 336, (c, w, h) => bubbleChat(c, w, h, false)],
  chatWide: [320, 208, (c, w, h) => bubbleChat(c, w, h, true)],
  kadePoster: [256, 352, (c, w, h) => {
    c.fillStyle = '#f1efe8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#c8302a'; c.fillRect(0, 0, w, 64);
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `900 34px ${DISPLAY}`; c.fillText('WELCOME,', w / 2, 24);
    c.font = `700 15px ${UI}`; c.fillText('RECOVERY ASSOCIATE!', w / 2, 50);
    // the smiling lanyard photo
    c.fillStyle = '#e9c9a4'; c.beginPath(); c.arc(w / 2, 120, 34, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#2a2a2a'; c.lineWidth = 3;
    c.beginPath(); c.arc(w / 2, 124, 18, 0.2, Math.PI - 0.2); c.stroke();
    c.fillStyle = '#2a2a2a'; c.fillRect(w / 2 - 14, 108, 6, 6); c.fillRect(w / 2 + 8, 108, 6, 6);
    c.fillStyle = '#1d2733'; c.font = `900 26px ${DISPLAY}`;
    c.fillText('OWNERSHIP.', w / 2, 186); c.fillText('HYDRATION.', w / 2, 214); c.fillText('OWNERSHIP.', w / 2, 242);
    textLines(c, 26, 266, w - 52, 13, 4, 'rgba(40,40,50,0.55)');
    c.fillStyle = '#c8302a'; c.font = `700 14px ${UI}`; c.fillText('KADE HOLDINGS · WATER IS A SERVICE', w / 2, h - 22);
    weather(c, w, h, 1.1);
  }],
  glimpse: [256, 352, (c, w, h) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#2f7cff'; c.fillRect(0, 0, w, 96);
    // the eye logo
    c.strokeStyle = '#fff'; c.lineWidth = 5;
    c.beginPath(); c.ellipse(w / 2, 48, 46, 24, 0, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(w / 2, 48, 13, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#10213f'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `900 30px ${DISPLAY}`; c.fillText('GLIMPSE', w / 2, 122);
    c.font = `700 14px ${UI}`; c.fillText('NEIGHBOURHOOD WATCH', w / 2, 146);
    c.fillStyle = '#2f7cff'; c.font = `900 40px ${DISPLAY}`; c.fillText('SEEN', w / 2, 196); c.fillText('IS SAFE', w / 2, 236);
    textLines(c, 30, 266, w - 60, 12, 4, 'rgba(30,40,70,0.45)');
    c.fillStyle = '#10213f'; c.font = `600 12px ${UI}`; c.fillText('Smile! You\'re already tagged.', w / 2, h - 26);
    // pencil in the margin
    c.save(); c.translate(w - 40, 300); c.rotate(-0.5);
    scribble(c, 0, 0, 60, 14, 8, 'rgba(60,60,70,0.7)', 1.4); c.restore();
    weather(c, w, h, 0.7);
  }],
  careful: [256, 336, (c, w, h) => {
    c.fillStyle = '#f6f4ef'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#d7a64a'; c.fillRect(0, 0, 10, h);
    c.fillStyle = '#3a3226'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.font = `700 22px ${UI}`; c.fillText('CAREFUL', 26, 32);
    c.font = `500 11px ${UI}`; c.fillText('LABS · FIELD TEAM', 26, 52);
    c.strokeStyle = '#3a3226'; c.lineWidth = 1; c.beginPath(); c.moveTo(26, 66); c.lineTo(w - 20, 66); c.stroke();
    c.font = `700 15px ${UI}`; c.fillText('YOU ARE AT THE', 26, 90); c.fillText('WRONG SPIRE.', 26, 110);
    textLines(c, 26, 132, w - 50, 12, 9, 'rgba(50,45,35,0.45)');
    // a little caution triangle with a heart in it
    c.strokeStyle = '#d7a64a'; c.lineWidth = 4; c.beginPath(); c.moveTo(w / 2, 254); c.lineTo(w / 2 - 34, 312); c.lineTo(w / 2 + 34, 312); c.closePath(); c.stroke();
    c.fillStyle = '#c8302a'; c.beginPath(); c.arc(w / 2 - 6, 290, 6, 0, Math.PI * 2); c.arc(w / 2 + 6, 290, 6, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(w / 2 - 12, 292); c.lineTo(w / 2, 304); c.lineTo(w / 2 + 12, 292); c.fill();
    weather(c, w, h, 0.5);
  }],
  update: [192, 240, (c, w, h) => {
    c.fillStyle = '#fbfbf8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ff3a6e'; c.fillRect(14, 14, 20, 20);
    c.fillStyle = '#1a1a1a'; c.font = `700 13px ${UI}`; c.textBaseline = 'middle';
    c.fillText('bunkr.ly', 40, 24);
    c.font = `600 11px ${UI}`; c.fillText('Investor Update #161', 14, 50);
    textLines(c, 14, 64, w - 28, 10, 12, 'rgba(30,30,30,0.4)');
    c.fillStyle = '#ff3a6e'; c.fillRect(14, 196, 60, 6);
    weather(c, w, h, 0.8);
  }],
  kdry: [192, 240, (c, w, h) => {
    c.fillStyle = '#e6dcc2'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(40,60,120,0.3)'; c.lineWidth = 1;
    for (let y = 40; y < h; y += 14) { c.beginPath(); c.moveTo(8, y); c.lineTo(w - 8, y); c.stroke(); }
    c.strokeStyle = 'rgba(180,60,50,0.5)'; c.beginPath(); c.moveTo(42, 0); c.lineTo(42, h); c.stroke();
    c.fillStyle = '#2a2a33'; c.font = `600 13px ${MONO}`; c.textBaseline = 'middle';
    c.fillText('KDRY 1340', 50, 22);
    for (let y = 46; y < h - 10; y += 14) { c.font = `400 9px ${MONO}`; c.fillText(`${14 + Math.floor((y - 46) / 60)}:${String(Math.floor(rnd() * 59)).padStart(2, '0')}`, 6, y); }
    scribble(c, 48, 47, w - 10, h - 8, 14, '#2a2a40', 1.4);
    weather(c, w, h, 1);
  }],
  letter: [192, 240, (c, w, h) => {
    c.fillStyle = '#f2ecdc'; c.fillRect(0, 0, w, h);
    scribble(c, 14, 26, w - 14, h - 40, 15, '#26304a', 1.6);
    c.save(); c.translate(w - 70, h - 20); scribble(c, 0, 0, 50, 6, 6, '#26304a', 2); c.restore();
    weather(c, w, h, 0.9);
  }],
  printout: [192, 240, (c, w, h) => {
    c.fillStyle = '#f4f6f1'; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(120,200,140,0.25)';
    for (let y = 0; y < h; y += 28) c.fillRect(0, y, w, 14);
    c.fillStyle = '#c9c9c9';
    for (let y = 8; y < h; y += 16) { c.beginPath(); c.arc(6, y, 2.5, 0, Math.PI * 2); c.arc(w - 6, y, 2.5, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#1f2a1f'; c.font = `600 10px ${MONO}`; c.textBaseline = 'middle';
    c.fillText('#LIFEBOAT export', 16, 14);
    textLines(c, 16, 26, w - 32, 9, 22, 'rgba(25,35,25,0.55)');
  }],
  brochure: [288, 192, (c, w, h) => {
    const third = w / 3;
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#2f9be8'; c.fillRect(0, 0, third, h);
    c.fillStyle = '#ffd23a'; c.beginPath(); c.arc(third / 2, 60, 28, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `900 22px ${DISPLAY}`; c.fillText('KADE', third / 2, 118); c.fillText('KIDS', third / 2, 140);
    c.font = `600 9px ${UI}`; c.fillText('ACADEMY · DRY CREEK', third / 2, 164);
    c.fillStyle = '#c8302a'; c.fillRect(third + 14, 16, third - 28, 70);
    textLines(c, third + 14, 98, third - 28, 10, 8, 'rgba(30,40,60,0.45)');
    textLines(c, third * 2 + 14, 20, third - 28, 10, 15, 'rgba(30,40,60,0.45)');
    c.strokeStyle = 'rgba(0,0,0,0.12)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(third, 0); c.lineTo(third, h); c.moveTo(third * 2, 0); c.lineTo(third * 2, h); c.stroke();
    weather(c, w, h, 0.6);
  }],
  kadeKids: [384, 192, (c, w, h) => {
    c.fillStyle = '#2f9be8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffffff'; c.fillRect(10, 10, w - 20, h - 20);
    c.fillStyle = '#2f9be8'; c.fillRect(16, 16, w - 32, h - 32);
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `900 50px ${DISPLAY}`; c.fillText('KADE KIDS', w / 2 + 40, 70);
    c.font = `700 22px ${UI}`; c.fillText('ACADEMY', w / 2 + 40, 112);
    c.font = `600 14px ${UI}`; c.fillText('BUILDING TOMORROW, TODAY', w / 2 + 40, 146);
    // the rocket
    c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(64, 30); c.lineTo(84, 70); c.lineTo(84, 140); c.lineTo(44, 140); c.lineTo(44, 70); c.closePath(); c.fill();
    c.fillStyle = '#c8302a'; c.beginPath(); c.moveTo(44, 120); c.lineTo(28, 158); c.lineTo(44, 146); c.fill();
    c.beginPath(); c.moveTo(84, 120); c.lineTo(100, 158); c.lineTo(84, 146); c.fill();
    c.fillStyle = '#ffd23a'; c.beginPath(); c.moveTo(50, 142); c.lineTo(64, 176); c.lineTo(78, 142); c.fill();
    c.fillStyle = '#2f9be8'; c.beginPath(); c.arc(64, 82, 9, 0, Math.PI * 2); c.fill();
    weather(c, w, h, 1.4);
    // bullet holes and a scorch: the school is a crater now
    for (let i = 0; i < 7; i++) { c.fillStyle = '#141210'; c.beginPath(); c.arc(140 + rnd() * 220, 30 + rnd() * 130, 2 + rnd() * 3, 0, Math.PI * 2); c.fill(); }
    const s = c.createRadialGradient(w - 50, h - 30, 4, w - 50, h - 30, 90);
    s.addColorStop(0, 'rgba(20,14,10,0.85)'); s.addColorStop(1, 'rgba(20,14,10,0)');
    c.fillStyle = s; c.fillRect(0, 0, w, h);
  }],
  plaque: [192, 96, (c, w, h) => {
    c.fillStyle = '#8a6a3a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#b8935a'; c.fillRect(5, 5, w - 10, h - 10);
    c.fillStyle = '#3a2a14'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `700 13px ${UI}`; c.fillText('TIME CAPSULE', w / 2, 24);
    c.font = `600 10px ${UI}`; c.fillText('KADE KIDS ACADEMY · CLASS OF TOMORROW', w / 2, 44);
    c.font = `700 16px ${DISPLAY}`; c.fillText('OPEN IN 2046', w / 2, 70);
    weather(c, w, h, 0.8);
  }],
  sticker: [96, 96, (c, w, h) => {
    c.fillStyle = '#2f7cff'; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 4;
    c.beginPath(); c.ellipse(w / 2, h / 2, 30, 16, 0, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(w / 2, h / 2, 9, 0, Math.PI * 2); c.fill();
  }],
  chalkPool: [384, 192, (c, w, h) => {
    // transparent ground, chalk only (the material alpha-tests it into a decal)
    c.clearRect(0, 0, w, h);
    const chalk = (col: string, lw: number) => { c.strokeStyle = col; c.lineWidth = lw; c.lineCap = 'round'; c.lineJoin = 'round'; };
    chalk('rgba(120,200,255,0.95)', 7);
    c.beginPath(); c.roundRect(20, 24, w - 40, h - 60, 26); c.stroke();
    // water lines
    chalk('rgba(160,220,255,0.9)', 4);
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      const y = 52 + i * 22;
      c.moveTo(48, y);
      for (let x = 48; x < w - 48; x += 22) c.quadraticCurveTo(x + 5.5, y - 7, x + 11, y), c.quadraticCurveTo(x + 16.5, y + 7, x + 22, y);
      c.stroke();
    }
    // a ladder, a little sun, and the sign
    chalk('rgba(255,255,255,0.95)', 4);
    c.beginPath(); c.moveTo(w - 66, 24); c.lineTo(w - 66, 70); c.moveTo(w - 52, 24); c.lineTo(w - 52, 70);
    c.moveTo(w - 66, 36); c.lineTo(w - 52, 36); c.moveTo(w - 66, 52); c.lineTo(w - 52, 52); c.stroke();
    chalk('rgba(255,220,90,0.95)', 4);
    c.beginPath(); c.arc(44, 46, 10, 0, Math.PI * 2); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.95)'; c.font = `700 22px ${UI}`; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('PIP\'S POOL · NO WALKING', 24, h - 16);
  }],
};

let _atlas: { tex: THREE.CanvasTexture; regions: Record<string, Region> } | null = null;
function atlas() {
  if (_atlas) return _atlas;
  const regions: Record<string, Region> = {};
  const entries = Object.entries(ART).sort((a, b) => b[1][1] - a[1][1] || b[1][0] - a[1][0]);
  const tex = canvasTexture(W, H, (ctx) => {
    ctx.clearRect(0, 0, W, H);
    let x = 0, y = 0, rowH = 0;
    for (const [name, [w, h, draw]] of entries) {
      if (x + w + PAD > W) { x = 0; y += rowH + PAD; rowH = 0; }
      if (y + h > H) throw new Error('lore atlas full at ' + name);
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      draw(ctx, w, h);
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

/** A w×h quad (facing +z, centred) showing `name`. Place it with a matrix like any geometry. */
export function loreQuad(name: string, w: number, h: number) {
  const r = atlas().regions[name];
  if (!r) throw new Error('no lore art ' + name);
  const g = norm(new THREE.PlaneGeometry(w, h));
  const a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, r.u0 + a.getX(i) * (r.u1 - r.u0), r.v0 + a.getY(i) * (r.v1 - r.v0));
  return g;
}

let _mat: THREE.MeshStandardNodeMaterial | null = null;
let _screen: THREE.MeshStandardNodeMaterial | null = null;
/** Paper, posters and decals: lit, double-sided, alpha-tested. */
export function loreMaterial() {
  return (_mat ??= new THREE.MeshStandardNodeMaterial({ map: atlas().tex, roughness: 0.86, side: THREE.DoubleSide, alphaTest: 0.5 }));
}
/** A screen that still has a little charge: the same art, faintly self-lit. */
export function loreScreen() {
  return (_screen ??= new THREE.MeshStandardNodeMaterial({
    color: '#202020', map: atlas().tex, emissive: '#ffffff', emissiveMap: atlas().tex, emissiveIntensity: 0.7, roughness: 0.22, metalness: 0.1,
  }));
}
