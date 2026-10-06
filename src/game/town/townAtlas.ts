import * as THREE from 'three/webgpu';
import { texture, uniform, float, uv, step } from 'three/tsl';
import { canvasTexture, grime, norm } from '@/game/world/kit';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/**
 * Every painted thing in Dry Creek and the Cut on ONE canvas: signs, menus, posters, maps, grime,
 * floor patterns and light pools. Three materials sample it (opaque signs, alpha decals, additive
 * pools), so a whole town of painted detail costs three draw calls. Regions in the LIT group are
 * packed into the top rows; the sign material lights only those at night.
 */

type Draw = (c: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void;
interface Region { u0: number; v0: number; u1: number; v1: number }

const SIZE = 2048;
const PAD = 4;
const DISPLAY = '"Big Shoulders Stencil Display", Impact, sans-serif';
const UI = '"Chakra Petch", Arial, sans-serif';
const MONO = '"JetBrains Mono", monospace';

function rng(seed: number) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

function text(c: CanvasRenderingContext2D, t: string, x: number, y: number, font: string, fill: string, maxW: number, align: CanvasTextAlign = 'center') {
  c.font = font;
  c.fillStyle = fill;
  c.textAlign = align;
  const m = c.measureText(t).width;
  if (m > maxW) {
    c.save();
    c.translate(x, y);
    c.scale(maxW / m, 1);
    c.fillText(t, 0, 0);
    c.restore();
  } else c.fillText(t, x, y);
}

function blob(c: CanvasRenderingContext2D, w: number, h: number, r: () => number, rgb: string, n: number, alpha: number, spread = 0.32) {
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.pow(r(), 1.6) * spread;
    const x = w / 2 + Math.cos(a) * d * w, y = h / 2 + Math.sin(a) * d * h;
    const rad = (0.05 + r() * 0.16) * w * (1 - d);
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(0.6, `rgba(${rgb},${alpha * 0.6})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(x, y, rad, rad * (0.6 + r() * 0.5), r() * 3, 0, Math.PI * 2);
    c.fill();
  }
}

/** Sun-bleached painted board with nail holes and bleeding rust. */
function board(c: CanvasRenderingContext2D, w: number, h: number, r: () => number, bg: string, edge: string, planks = 0) {
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  if (planks) {
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 3;
    for (let i = 1; i < planks; i++) { const y = (i * h) / planks + (r() - 0.5) * 3; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    for (let i = 0; i < 40; i++) {
      c.strokeStyle = `rgba(40,25,15,${0.08 + r() * 0.1})`;
      c.lineWidth = 1 + r() * 2;
      const y = r() * h;
      c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 8, w * 0.6, y + (r() - 0.5) * 8, w, y + (r() - 0.5) * 6); c.stroke();
    }
  }
  c.strokeStyle = edge;
  c.lineWidth = Math.max(5, w * 0.02);
  c.strokeRect(c.lineWidth, c.lineWidth, w - c.lineWidth * 2, h - c.lineWidth * 2);
  for (const [bx, by] of [[0.04, 0.1], [0.96, 0.1], [0.04, 0.9], [0.96, 0.9]]) {
    const x = bx * w, y = by * h;
    const g = c.createLinearGradient(x, y, x, y + h * 0.3);
    g.addColorStop(0, 'rgba(110,50,20,0.6)');
    g.addColorStop(1, 'rgba(110,50,20,0)');
    c.fillStyle = g;
    c.fillRect(x - 2 - r() * 2, y, 4 + r() * 3, h * 0.3);
    c.fillStyle = '#2a2420';
    c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill();
  }
}

function pool(c: CanvasRenderingContext2D, w: number, h: number, rgb: string) {
  const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(0.3, `rgba(${rgb},0.55)`);
  g.addColorStop(0.7, `rgba(${rgb},0.12)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

/** A soft rectangle of light, for window spill on the ground. */
function spill(c: CanvasRenderingContext2D, w: number, h: number, rgb: string) {
  const img = c.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / (w - 1), v = y / (h - 1);
    const ex = Math.min(1, Math.min(u, 1 - u) * 5), ey = Math.min(1, v * 6) * Math.pow(1 - v, 1.6);
    const a = ex * ex * (3 - 2 * ex) * ey;
    const [R, G, B] = rgb.split(',').map(Number);
    const i = (y * w + x) * 4;
    img.data[i] = R; img.data[i + 1] = G; img.data[i + 2] = B; img.data[i + 3] = Math.round(a * 255);
  }
  c.putImageData(img, 0, 0);
}

const LIT: Record<string, [number, number, Draw]> = {
  eats: [1024, 512, (c, w, h, r) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#3a1610'); g.addColorStop(1, '#1e0c08');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#e8d6b0'; c.lineWidth = 16; c.strokeRect(20, 20, w - 40, h - 40);
    c.strokeStyle = '#b8452c'; c.lineWidth = 6; c.strokeRect(42, 42, w - 84, h - 84);
    // bulb chase along the border
    for (let x = 60; x < w - 50; x += 36) for (const y of [60, h - 60]) { c.fillStyle = r() < 0.15 ? '#5a4a3a' : '#ffe6b0'; c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.fill(); }
    text(c, 'DRY CREEK', w / 2, 230, `900 168px ${DISPLAY}`, '#f2e2bc', w - 140);
    text(c, 'EATS', w / 2, 360, `900 120px ${DISPLAY}`, '#ff9a2e', w - 140);
    text(c, 'THE CREEK IS DRY.  THE COFFEE IS NOT.', w / 2, 425, `600 34px ${UI}`, '#d9c49a', w - 160);
    grime(c, w, h, 0.9, 7);
  }],
  motel: [256, 768, (c, w, h, r) => {
    c.fillStyle = '#e8dcc0'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#123634'; c.fillRect(14, 14, w - 28, h - 28);
    c.strokeStyle = '#2f9c94'; c.lineWidth = 6; c.strokeRect(30, 30, w - 60, h - 60);
    'MOTEL'.split('').forEach((ch, i) => {
      c.font = `900 150px ${DISPLAY}`; c.textAlign = 'center';
      c.lineWidth = 10; c.strokeStyle = '#7a1a14'; c.strokeText(ch, w / 2, 165 + i * 132);
      text(c, ch, w / 2, 165 + i * 132, `900 150px ${DISPLAY}`, '#ffd8a8', w - 60);
    });
    void r;
    grime(c, w, h, 0.8, 12);
  }],
  vacancy: [512, 256, (c, w, h, r) => {
    c.fillStyle = '#0f1614'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#2f7c78'; c.lineWidth = 10; c.strokeRect(8, 8, w - 16, h - 16);
    text(c, 'NO', 92, 112, `700 64px ${UI}`, '#3a4a46', 120);
    text(c, 'VACANCY', w / 2 + 50, 112, `700 76px ${UI}`, '#7ef0dc', w - 170);
    text(c, 'TWO OF THREE. BRING A PICK.', w / 2, 190, `500 32px ${UI}`, '#e8d6b0', w - 50);
    grime(c, w, h, 1.1, 6);
    void r;
  }],
  menu: [512, 384, (c, w, h, r) => {
    c.fillStyle = '#1d211e'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#6b4a2e'; c.lineWidth = 18; c.strokeRect(9, 9, w - 18, h - 18);
    text(c, 'TODAY', w / 2, 70, `700 52px ${UI}`, '#f2ead8', w - 80);
    const rows = [['BEANS', '2 SCRAP'], ['COFFEE, HOT', '1 WATER'], ['COFFEE, WARM', 'ASK'], ['PIE', 'THEORETICAL'], ['WATER', "DON'T"], ['NEWS', 'FREE']];
    rows.forEach(([a, b], i) => {
      const y = 125 + i * 40;
      text(c, a, 44, y, `500 28px ${MONO}`, '#e8e2d0', 220, 'left');
      text(c, b, w - 44, y, `500 28px ${MONO}`, i === 4 ? '#ff8a5a' : '#ffd27a', 200, 'right');
      c.fillStyle = 'rgba(230,226,208,0.35)';
      for (let x = 44 + c.measureText(a).width + 12; x < w - 60 - 150; x += 12) c.fillRect(x, y - 4, 3, 3);
    });
    c.fillStyle = 'rgba(240,240,230,0.08)';
    for (let i = 0; i < 30; i++) c.fillRect(r() * w, r() * h, 40 + r() * 80, 3);
  }],
  open: [256, 112, (c, w, h) => {
    c.fillStyle = '#0c0a0a'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#ff3a6e'; c.lineWidth = 7; c.strokeRect(10, 10, w - 20, h - 20);
    text(c, 'OPEN', w / 2, 80, `700 66px ${UI}`, '#ff5a86', w - 40);
  }],
  clinicLit: [512, 160, (c, w, h, r) => {
    board(c, w, h, r, '#e9e6dc', '#2f6a62');
    c.fillStyle = '#c0281e';
    c.fillRect(46, 40, 26, 80); c.fillRect(19, 67, 80, 26);
    text(c, 'CLINIC', w / 2 + 50, 108, `900 92px ${DISPLAY}`, '#1e3a36', w - 170);
    grime(c, w, h, 0.9, 13);
  }],
};

const FLAT: Record<string, [number, number, Draw]> = {
  till: [1024, 288, (c, w, h, r) => {
    board(c, w, h, r, '#d6c6a0', '#3a2a1a', 4);
    text(c, 'THE TILL', w / 2, 158, `900 150px ${DISPLAY}`, '#5a1e14', w - 120);
    text(c, 'GENERAL GOODS  ·  TRADE  ·  IF IT HAS A PRICE, ASK INEZ', w / 2, 218, `700 34px ${UI}`, '#2a2018', w - 100);
    text(c, 'THE CLOSET IS A CLOSET', w / 2, 260, `600 24px ${UI}`, '#6a4a2e', w - 100);
    grime(c, w, h, 1.2, 5);
  }],
  wash: [512, 256, (c, w, h, r) => {
    board(c, w, h, r, '#2a2018', '#c9b48a', 3);
    text(c, 'THE WASH', w / 2, 95, `700 72px ${UI}`, '#e8d6b0', w - 60);
    text(c, 'POSTS. NORTH OF THE SPIRE.', w / 2, 155, `500 30px ${UI}`, '#ffb347', w - 60);
    text(c, 'THE RIDGE DOES NOT HAVE A ROAD.', w / 2, 205, `500 30px ${UI}`, '#c9b48a', w - 60);
    grime(c, w, h, 1.2, 4);
  }],
  town: [512, 224, (c, w, h, r) => {
    board(c, w, h, r, '#c8b48a', '#3a2a1a', 3);
    text(c, 'DRY CREEK', w / 2, 100, `900 92px ${DISPLAY}`, '#3a2216', w - 60);
    text(c, 'POP. — ASK NIA', w / 2, 168, `700 38px ${UI}`, '#5a3a24', w - 60);
    grime(c, w, h, 1.4, 21);
  }],
  wanted: [256, 352, (c, w, h, r) => {
    c.fillStyle = '#e2d4b2'; c.fillRect(0, 0, w, h);
    text(c, 'WANTED', w / 2, 62, `900 64px ${DISPLAY}`, '#2a1a10', w - 30);
    c.fillStyle = '#4a3a2a'; c.fillRect(48, 82, w - 96, 150);
    c.fillStyle = '#c9b48a'; c.beginPath(); c.arc(w / 2, 145, 40, 0, Math.PI * 2); c.fill();
    c.fillRect(w / 2 - 60, 190, 120, 42);
    text(c, 'T. PRICE, FOUNDER', w / 2, 262, `700 24px ${UI}`, '#2a1a10', w - 30);
    text(c, 'FOR HOARDING WATER', w / 2, 292, `600 20px ${UI}`, '#3a2a1a', w - 30);
    text(c, 'REWARD: A DRINK', w / 2, 330, `900 30px ${DISPLAY}`, '#7a1e14', w - 30);
    grime(c, w, h, 1.3, 31); void r;
  }],
  missing: [256, 352, (c, w, h, r) => {
    c.fillStyle = '#ece6d6'; c.fillRect(0, 0, w, h);
    text(c, 'MISSING', w / 2, 62, `900 60px ${DISPLAY}`, '#1a2a4a', w - 30);
    c.strokeStyle = '#1a2a4a'; c.lineWidth = 6;
    c.beginPath(); c.moveTo(w / 2, 100); c.bezierCurveTo(w / 2 + 50, 160, w / 2 + 40, 210, w / 2, 215); c.bezierCurveTo(w / 2 - 40, 210, w / 2 - 50, 160, w / 2, 100); c.stroke();
    text(c, 'OUR WATER', w / 2, 262, `700 30px ${UI}`, '#1a2a4a', w - 30);
    text(c, 'LAST SEEN HEADED NE', w / 2, 296, `600 20px ${UI}`, '#2a2a2a', w - 30);
    text(c, 'BY DRONE', w / 2, 324, `600 20px ${UI}`, '#2a2a2a', w - 30);
    grime(c, w, h, 1.1, 32); void r;
  }],
  cola: [256, 384, (c, w, h, r) => {
    c.fillStyle = '#b8261c'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#f2e8d2'; c.beginPath(); c.arc(w / 2, 150, 92, 0, Math.PI * 2); c.fill();
    text(c, 'SANDY', w / 2, 140, `900 62px ${DISPLAY}`, '#b8261c', 170);
    text(c, 'COLA', w / 2, 196, `900 54px ${DISPLAY}`, '#b8261c', 170);
    text(c, "IT'S WET.", w / 2, 300, `700 40px ${UI}`, '#f2e8d2', w - 30);
    text(c, 'MOSTLY.', w / 2, 344, `600 26px ${UI}`, '#f2c8a0', w - 30);
    grime(c, w, h, 1.6, 41); void r;
  }],
  eyechart: [192, 256, (c, w, h) => {
    c.fillStyle = '#f2efe6'; c.fillRect(0, 0, w, h);
    const rows = ['E', 'F P', 'T O Z', 'L P E D', 'P E C F D', 'E D F C Z P', 'W A T E R ?'];
    rows.forEach((t, i) => text(c, t, w / 2, 48 + i * 30 - (6 - i) * 2, `700 ${44 - i * 5}px ${UI}`, '#1a1a1a', w - 20));
    grime(c, w, h, 0.6, 51);
  }],
  map1: [384, 288, (c, w, h, r) => {
    c.fillStyle = '#d8cba8'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(90,60,30,0.6)'; c.lineWidth = 2;
    for (let i = 0; i < 9; i++) { c.beginPath(); for (let x = 0; x <= w; x += 16) c.lineTo(x, 60 + i * 24 + Math.sin(x * 0.03 + i) * 14 - (x > 200 ? (x - 200) * 0.3 : 0)); c.stroke(); }
    c.strokeStyle = '#7a1e14'; c.lineWidth = 4; c.setLineDash([10, 8]);
    c.beginPath(); c.moveTo(70, h - 30); c.lineTo(120, 200); c.lineTo(90, 150); c.lineTo(180, 110); c.lineTo(250, 70); c.stroke();
    c.setLineDash([]);
    c.fillStyle = '#7a1e14'; c.beginPath(); c.arc(250, 70, 9, 0, Math.PI * 2); c.fill();
    text(c, 'THE CUT', 300, 62, `700 26px ${UI}`, '#3a1a10', 140);
    text(c, 'POSTS', 70, 190, `600 18px ${UI}`, '#3a2a1a', 100);
    text(c, 'SPIRE ↓', 60, h - 40, `600 18px ${UI}`, '#3a2a1a', 100);
    text(c, 'not his', 290, 100, `italic 600 18px ${UI}`, '#7a1e14', 120);
    grime(c, w, h, 1.0, 61); void r;
  }],
  map2: [384, 288, (c, w, h, r) => {
    c.fillStyle = '#e0d4b4'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#2a2a2a'; c.lineWidth = 7; c.beginPath(); c.moveTo(40, h); c.bezierCurveTo(140, 180, 220, 120, w - 20, 0); c.stroke();
    c.strokeStyle = '#e0d4b4'; c.lineWidth = 2; c.setLineDash([8, 8]); c.stroke(); c.setLineDash([]);
    const dot = (x: number, y: number, t: string, col: string) => { c.fillStyle = col; c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.fill(); text(c, t, x + 10, y - 10, `700 17px ${UI}`, '#2a1a10', 150, 'left'); };
    dot(80, 200, 'DRY CREEK', '#3a2a1a');
    dot(200, 210, 'LAST CHANCE', '#3a2a1a');
    dot(270, 120, 'GARAGE (TANNER)', '#b8261c');
    dot(230, 50, 'SPIRE', '#3a2a1a');
    c.strokeStyle = '#b8261c'; c.lineWidth = 3; c.beginPath(); c.arc(270, 120, 22, 0, Math.PI * 2); c.stroke();
    grime(c, w, h, 1.0, 62); void r;
  }],
  calendar: [160, 208, (c, w, h, r) => {
    c.fillStyle = '#efe8d8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#b8452c'; c.fillRect(0, 0, w, 58);
    text(c, 'OCTOBER', w / 2, 40, `700 28px ${UI}`, '#fff6e0', w - 16);
    c.strokeStyle = '#8a7a6a'; c.lineWidth = 1;
    for (let i = 0; i < 35; i++) {
      const x = 8 + (i % 7) * 20.6, y = 66 + Math.floor(i / 7) * 27;
      c.strokeRect(x, y, 19, 25);
      if (i < 23) { c.strokeStyle = '#7a1e14'; c.lineWidth = 2; c.beginPath(); c.moveTo(x + 3, y + 3); c.lineTo(x + 16, y + 22); c.moveTo(x + 16, y + 3); c.lineTo(x + 3, y + 22); c.stroke(); c.strokeStyle = '#8a7a6a'; c.lineWidth = 1; }
    }
    grime(c, w, h, 0.8, 71); void r;
  }],
  room1: [96, 96, (c, w, h) => plate(c, w, h, '1')],
  room2: [96, 96, (c, w, h) => plate(c, w, h, '2')],
  room3: [96, 96, (c, w, h) => plate(c, w, h, '3')],
  plate: [192, 96, (c, w, h, r) => {
    c.fillStyle = '#e4dcc4'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#2a3a5a'; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, h - 12);
    text(c, 'DRY 4EVR', w / 2, 66, `700 40px ${MONO}`, '#2a3a5a', w - 24);
    grime(c, w, h, 1.8, 81); void r;
  }],
  keepout: [256, 160, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.save(); c.translate(w / 2, h / 2); c.rotate(-0.06);
    text(c, 'KEEP OUT', 0, -8, `900 64px ${DISPLAY}`, 'rgba(235,235,225,0.92)', w - 20);
    text(c, '(ROOM 3)', 0, 46, `700 30px ${UI}`, 'rgba(235,235,225,0.85)', w - 40);
    c.restore();
  }],
  note: [512, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    const paint = 'rgba(220,60,40,0.92)';
    c.save(); c.translate(w / 2, 100); c.rotate(-0.04);
    text(c, 'V. K. LOOKED.', 0, 0, `900 74px ${DISPLAY}`, paint, w - 30);
    c.restore();
    c.save(); c.translate(w / 2, 190); c.rotate(-0.02);
    text(c, "DIDN'T BUY.", 0, 0, `900 74px ${DISPLAY}`, paint, w - 60);
    c.restore();
    c.fillStyle = paint;
    for (let i = 0; i < 14; i++) c.fillRect(60 + Math.random() * 380, 110 + Math.random() * 100, 3, 10 + Math.random() * 40);
  }],
  tag: [512, 192, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.save(); c.translate(w / 2, h / 2 + 20); c.rotate(-0.05);
    c.font = `900 92px ${DISPLAY}`; c.textAlign = 'center';
    c.lineWidth = 9; c.strokeStyle = '#141414'; c.strokeText('WATER IS NEWS', 0, 0);
    c.fillStyle = '#4fb6ff'; c.fillText('WATER IS NEWS', 0, 0);
    c.restore();
  }],
  arrow: [256, 128, (c, w, h, r) => {
    board(c, w, h, r, '#5a4030', '#2a1a10', 2);
    c.fillStyle = '#e8dcc0';
    c.beginPath(); c.moveTo(24, 54); c.lineTo(170, 54); c.lineTo(170, 26); c.lineTo(236, 64); c.lineTo(170, 102); c.lineTo(170, 74); c.lineTo(24, 74); c.fill();
    text(c, 'WASH', 96, 50, `700 26px ${UI}`, '#e8dcc0', 120);
    grime(c, w, h, 1.2, 91);
  }],
  checker: [256, 256, (c, w, h, r) => {
    const n = 8, s = w / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { c.fillStyle = (x + y) % 2 ? '#1e1c1a' : '#d8d0bc'; c.fillRect(x * s, y * s, s, s); }
    c.globalCompositeOperation = 'multiply';
    blob(c, w, h, r, '120,100,70', 10, 0.35, 0.45);
    c.globalCompositeOperation = 'source-over';
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 200; i++) { c.fillStyle = `rgba(0,0,0,${r() * 0.5})`; c.fillRect(r() * w, r() * h, 2 + r() * 6, 2 + r() * 4); }
    c.globalCompositeOperation = 'source-over';
  }],
  lino: [256, 256, (c, w, h, r) => {
    c.fillStyle = '#9aa69a'; c.fillRect(0, 0, w, h);
    const n = 4, s = w / n;
    c.strokeStyle = 'rgba(40,50,45,0.4)'; c.lineWidth = 2;
    for (let i = 1; i < n; i++) { c.beginPath(); c.moveTo(i * s, 0); c.lineTo(i * s, h); c.moveTo(0, i * s); c.lineTo(w, i * s); c.stroke(); }
    for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(${r() < 0.5 ? '60,70,62' : '200,210,200'},${r() * 0.3})`; c.fillRect(r() * w, r() * h, 2, 2); }
    c.globalCompositeOperation = 'multiply'; blob(c, w, h, r, '120,110,90', 8, 0.3, 0.4); c.globalCompositeOperation = 'source-over';
  }],
  rug: [256, 192, (c, w, h, r) => {
    c.fillStyle = '#6a2a22'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#d8b06a'; c.lineWidth = 8; c.strokeRect(14, 14, w - 28, h - 28);
    c.strokeStyle = '#2a3a4a'; c.lineWidth = 5; c.strokeRect(30, 30, w - 60, h - 60);
    c.fillStyle = '#d8b06a';
    for (let i = 0; i < 5; i++) { c.save(); c.translate(w / 2, h / 2); c.rotate(Math.PI / 4); c.fillRect(-14 - i * 9, -14 - i * 9, 28 + i * 18, 4); c.restore(); }
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(0,0,0,${r() * 0.6})`; c.fillRect(r() * w, r() * h, 2 + r() * 5, 2); }
    c.globalCompositeOperation = 'source-over';
  }],
  grimeBand: [256, 128, (c, w, h, r) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(90,66,40,0)'); g.addColorStop(0.55, 'rgba(90,66,40,0.32)'); g.addColorStop(1, 'rgba(80,58,34,0.72)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 600; i++) { c.fillStyle = `rgba(70,50,30,${r() * 0.4})`; c.fillRect(r() * w, h * (0.3 + r() * 0.7), 2, 2 + r() * 3); }
  }],
  streaks: [256, 256, (c, w, h, r) => {
    for (let i = 0; i < 26; i++) {
      const x = r() * w, len = h * (0.3 + r() * 0.7), wd = 3 + r() * 12;
      const g = c.createLinearGradient(0, 0, 0, len);
      const rust = r() < 0.45;
      g.addColorStop(0, rust ? 'rgba(120,56,24,0.5)' : 'rgba(46,38,30,0.42)');
      g.addColorStop(1, 'rgba(46,38,30,0)');
      c.fillStyle = g; c.fillRect(x, 0, wd, len);
    }
  }],
  dirt: [256, 256, (c, w, h, r) => {
    blob(c, w, h, r, '92,70,44', 34, 0.26, 0.42);
    for (let i = 0; i < 700; i++) { c.fillStyle = `rgba(60,44,28,${r() * 0.35})`; const d = Math.pow(r(), 0.7) * w * 0.45, a = r() * 6.28; c.fillRect(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 2, 2); }
  }],
  packed: [256, 256, (c, w, h, r) => {
    // hard-packed street dirt: darker, compacted, with pebbles and a faint crack network
    blob(c, w, h, r, '88,68,46', 70, 0.42, 0.46);
    c.strokeStyle = 'rgba(50,38,26,0.25)'; c.lineWidth = 1.5;
    for (let i = 0; i < 14; i++) { c.beginPath(); let x = r() * w, y = r() * h; c.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 50; y += (r() - 0.5) * 50; c.lineTo(x, y); } c.stroke(); }
    for (let i = 0; i < 500; i++) { c.fillStyle = `rgba(${r() < 0.5 ? '70,56,40' : '170,150,120'},${r() * 0.45})`; const d = Math.pow(r(), 0.6) * w * 0.47, a = r() * 6.28; c.fillRect(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 2 + r() * 2, 2); }
  }],
  cracks: [256, 256, (c, w, h, r) => {
    c.strokeStyle = 'rgba(24,18,12,0.7)'; c.lineCap = 'round';
    const branch = (x: number, y: number, a: number, len: number, lw: number, depth: number) => {
      c.lineWidth = lw; c.beginPath(); c.moveTo(x, y);
      for (let i = 0; i < 6; i++) {
        a += (r() - 0.5) * 0.9; x += Math.cos(a) * len / 6; y += Math.sin(a) * len / 6; c.lineTo(x, y);
        if (depth > 0 && r() < 0.3) { c.stroke(); branch(x, y, a + (r() - 0.5) * 2, len * 0.5, lw * 0.6, depth - 1); c.lineWidth = lw; c.beginPath(); c.moveTo(x, y); }
      }
      c.stroke();
    };
    branch(w * 0.1, h * 0.5, 0, w * 0.85, 3, 2);
    branch(w * 0.5, h * 0.1, 1.5, h * 0.6, 2, 1);
  }],
  soot: [256, 256, (c, w, h, r) => {
    const g = c.createRadialGradient(w / 2, h * 0.75, 0, w / 2, h * 0.6, w * 0.5);
    g.addColorStop(0, 'rgba(14,11,9,0.8)'); g.addColorStop(1, 'rgba(14,11,9,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    blob(c, w, h, r, '14,11,9', 8, 0.16, 0.2);
  }],
  tracks: [512, 128, (c, w, h, r) => {
    for (const y0 of [h * 0.24, h * 0.76]) {
      for (let x = 0; x < w; x += 8) {
        const a = 0.16 + 0.2 * Math.sin(x * 0.013 + y0) * Math.sin(x * 0.004) + r() * 0.08;
        c.fillStyle = `rgba(60,44,28,${Math.max(0, a)})`;
        c.save(); c.translate(x, y0); c.rotate(0.5); c.fillRect(-2, -15, 4, 30); c.restore();
      }
    }
    c.globalCompositeOperation = 'destination-in';
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.15, 'rgba(0,0,0,1)'); g.addColorStop(0.85, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'source-over';
  }],
  path: [256, 256, (c, w, h, r) => {
    // a worn footpath: trodden centre, scuffed edges, boot prints; feathered all round
    const img = c.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = Math.abs(x / (w - 1) - 0.5) * 2, v = Math.abs(y / (h - 1) - 0.5) * 2;
      const edge = Math.max(0, 1 - Math.pow(u, 2.2)) * Math.max(0, 1 - Math.pow(v, 6));
      const i = (y * w + x) * 4;
      img.data[i] = 84; img.data[i + 1] = 64; img.data[i + 2] = 44; img.data[i + 3] = Math.round(edge * (0.5 + r() * 0.16) * 255);
    }
    c.putImageData(img, 0, 0);
    for (let i = 0; i < 26; i++) {
      c.fillStyle = `rgba(60,44,30,${0.15 + r() * 0.2})`;
      c.save(); c.translate(w * (0.35 + r() * 0.3), r() * h); c.rotate((r() - 0.5) * 0.4);
      c.beginPath(); c.ellipse(0, 0, 5, 11, 0, 0, Math.PI * 2); c.fill(); c.restore();
    }
  }],
  oil: [256, 256, (c, w, h, r) => { blob(c, w, h, r, '20,15,10', 24, 0.36); blob(c, w, h, r, '40,30,60', 6, 0.08, 0.15); }],
  stain: [256, 256, (c, w, h, r) => {
    blob(c, w, h, r, '120,92,52', 16, 0.18, 0.36);
    c.strokeStyle = 'rgba(110,80,40,0.35)'; c.lineWidth = 3;
    c.beginPath(); c.ellipse(w / 2, h / 2, w * 0.36, h * 0.3, 0.3, 0, Math.PI * 2); c.stroke();
  }],
  sand: [256, 128, (c, w, h, r) => {
    // windblown sand banked against a wall: dense at the bottom edge, ripples, fading up
    const img = c.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = y / (h - 1), u = x / (w - 1);
      const top = 0.25 + 0.2 * Math.sin(u * 9 + Math.sin(u * 23) * 0.6) + 0.1 * Math.sin(u * 31);
      const a = Math.max(0, Math.min(1, (v - top) * 3.5)) * Math.min(1, Math.min(u, 1 - u) * 6);
      const rip = 0.9 + 0.1 * Math.sin(y * 0.9 + x * 0.05);
      const i = (y * w + x) * 4;
      img.data[i] = 196 * rip; img.data[i + 1] = 160 * rip; img.data[i + 2] = 116 * rip; img.data[i + 3] = Math.round(a * 240);
    }
    c.putImageData(img, 0, 0);
    void r;
  }],
  // additive light
  poolWarm: [128, 128, (c, w, h) => pool(c, w, h, '255,186,112')],
  poolTeal: [128, 128, (c, w, h) => pool(c, w, h, '150,255,230')],
  poolFire: [128, 128, (c, w, h) => pool(c, w, h, '255,120,40')],
  washWarm: [128, 256, (c, w, h) => {
    c.save(); c.scale(1, h / w);
    const g = c.createRadialGradient(w / 2, 0, 0, w / 2, 0, w / 2);
    g.addColorStop(0, 'rgba(255,190,120,1)'); g.addColorStop(0.25, 'rgba(255,190,120,0.6)'); g.addColorStop(0.6, 'rgba(255,190,120,0.18)'); g.addColorStop(1, 'rgba(255,190,120,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, w); c.restore();
  }],
  spillWarm: [128, 128, (c, w, h) => spill(c, w, h, '255,180,100')],
  spillTeal: [128, 128, (c, w, h) => spill(c, w, h, '170,255,235')],
};

function plate(c: CanvasRenderingContext2D, w: number, h: number, n: string) {
  c.fillStyle = '#b08a3a'; c.fillRect(0, 0, w, h);
  c.strokeStyle = '#6a4a1a'; c.lineWidth = 6; c.strokeRect(5, 5, w - 10, h - 10);
  text(c, n, w / 2, 76, `900 72px ${DISPLAY}`, '#2a1a0a', w - 20);
}

export type TownDecal = keyof typeof LIT | keyof typeof FLAT;

/** Storage scale for regions drawn larger than they need to be kept. */
const SCALE: Record<string, number> = {
  eats: 0.75, motel: 0.75, menu: 0.75, vacancy: 0.75, clinicLit: 0.75, till: 0.75, wash: 0.75, town: 0.75,
  wanted: 0.75, missing: 0.75, cola: 0.75, map1: 0.85, map2: 0.85, eyechart: 0.85, note: 0.75, tag: 0.75,
  tracks: 0.75, keepout: 0.75, grimeBand: 0.75,
};

let _atlas: { tex: THREE.CanvasTexture; regions: Record<string, Region>; litV: number } | null = null;

function atlas() {
  if (_atlas) return _atlas;
  const regions: Record<string, Region> = {};
  let litV = 1;
  const tex = canvasTexture(SIZE, SIZE, (ctx) => {
    ctx.clearRect(0, 0, SIZE, SIZE);
    let x = 0, y = 0, rowH = 0, seed = 1;
    // big boards are authored at a comfortable pixel size and stored smaller
    const scratch = document.createElement('canvas');
    const sctx = scratch.getContext('2d')!;
    const pack = (set: Record<string, [number, number, Draw]>) => {
      const items = Object.entries(set).map(([name, [aw, ah, draw]]) => {
        const k = SCALE[name] ?? 1;
        return { name, aw, ah, draw, w: Math.round(aw * k), h: Math.round(ah * k) };
      }).sort((a, b) => b.h - a.h);
      for (const { name, aw, ah, draw, w, h } of items) {
        if (x + w + PAD > SIZE) { x = 0; y += rowH + PAD; rowH = 0; }
        if (y + h > SIZE) throw new Error('town atlas full');
        if (w === aw && h === ah) {
          ctx.save();
          ctx.translate(x, y);
          ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
          draw(ctx, w, h, rng(seed++));
          ctx.restore();
        } else {
          scratch.width = aw; scratch.height = ah;
          sctx.clearRect(0, 0, aw, ah);
          draw(sctx, aw, ah, rng(seed++));
          ctx.drawImage(scratch, x, y, w, h);
        }
        regions[name] = { u0: (x + 1) / SIZE, u1: (x + w - 1) / SIZE, v0: 1 - (y + h - 1) / SIZE, v1: 1 - (y + 1) / SIZE };
        x += w + PAD;
        rowH = Math.max(rowH, h);
      }
    };
    pack(LIT);
    // close the lit rows: everything below this line stays dark at night
    y += rowH + PAD; x = 0; rowH = 0;
    litV = 1 - y / SIZE;
    pack(FLAT);
  });
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  _atlas = { tex, regions, litV };
  return _atlas;
}

/** UV rectangle of a region (for geometry built by hand). */
export function townRegion(name: TownDecal) {
  return atlas().regions[name];
}

function mapUV(g: THREE.BufferGeometry, name: TownDecal) {
  const r = atlas().regions[name];
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
  return g;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
/** A w×h quad of region `name`, built facing +z, then rotated (rx, ry, rz) and moved to (x, y, z). */
export function townQuad(name: TownDecal, w: number, h: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const g = mapUV(new THREE.PlaneGeometry(w, h), name);
  g.applyMatrix4(_m.compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  return norm(g);
}

/** Flat on the ground (rot about the vertical). */
export const townFloor = (name: TownDecal, w: number, h: number, x: number, y: number, z: number, rot = 0) => townQuad(name, w, h, x, y, z, -Math.PI / 2, 0, rot);

/**
 * A painted board: a w×h×d box whose front (+z) face shows `name`; the other faces show a sliver of
 * the same region's edge colour. `ry` turns it to face its wall's outward normal.
 */
export function townBoard(name: TownDecal, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const r = atlas().regions[name];
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry groups: px, nx, py, ny, pz, nz (4 verts each, non-indexed after norm)
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4);
    const u = uv.getX(i), v = uv.getY(i);
    if (face === 4) uv.setXY(i, r.u0 + u * (r.u1 - r.u0), r.v0 + v * (r.v1 - r.v0));
    else uv.setXY(i, r.u0 + 0.01 * (r.u1 - r.u0), r.v0 + 0.5 * (r.v1 - r.v0));
  }
  g.applyMatrix4(_m.compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  return norm(g);
}

/** Night level for lit signs and light pools (Settlement drives it from the sky). */
export const uTownNight = uniform(0);
/** Extra multiplier for the lit signs (flicker). */
export const uTownSign = uniform(1);

let _sign: THREE.MeshStandardNodeMaterial | null = null;
/** Opaque painted boards. Regions in the lit group glow after dark. */
export function townSignMaterial() {
  if (_sign) return _sign;
  const a = atlas();
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.78, metalness: 0.02 });
  const t: N = texture(a.tex);
  m.colorNode = t.rgb;
  const lit: N = step(float(a.litV), uv().y);
  m.emissiveNode = t.rgb.mul(lit).mul(float(0.12).add(uTownNight.mul(1.6)).mul(uTownSign));
  _sign = m;
  return m;
}

let _decal: THREE.MeshStandardNodeMaterial | null = null;
/** Alpha-blended paint and grime laid over walls, floors and rock. */
export function townDecalMaterial() {
  if (_decal) return _decal;
  _decal = new THREE.MeshStandardNodeMaterial({
    map: atlas().tex, transparent: true, depthWrite: false, roughness: 0.88, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  return _decal;
}

let _pool: THREE.MeshBasicNodeMaterial | null = null;
/** Additive light spill (lamp pools, window light on the ground), mostly after dark. */
export function townPoolMaterial() {
  if (_pool) return _pool;
  const m = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  });
  const t: N = texture(atlas().tex);
  m.colorNode = t.rgb.mul(t.a).mul(float(0.06).add(uTownNight.mul(0.94))).mul(0.85);
  _pool = m;
  return m;
}

/** Base colour for the far stand-in of the sign material. */
export const SIGN_FAR = '#5a4a3a';
