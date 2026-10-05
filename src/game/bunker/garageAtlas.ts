import * as THREE from 'three/webgpu';
import { texture, uniform, vec4, float } from 'three/tsl';
import { canvasTexture, grime, norm } from '../world/kit';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/**
 * One canvas atlas for every painted detail of The Garage (oil stains, tyre tracks, hazard stripes,
 * posters, signs, graffiti tags, light pools). Every decal quad samples it, so all of them merge
 * into two meshes: a lit one (stains, signs, posters) and an additive one (light spill at night).
 */

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void;
interface Region { u0: number; v0: number; u1: number; v1: number }

const SIZE = 2048;
const PAD = 4;

const FONT_DISPLAY = '"Big Shoulders Stencil Display", Impact, sans-serif';
const FONT_UI = '"Chakra Petch", Arial, sans-serif';
const FONT_MONO = '"JetBrains Mono", monospace';

function rng(seed: number) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

/** Irregular soft blob (oil / soot / water): many translucent ellipses around a centre. */
function blob(ctx: CanvasRenderingContext2D, w: number, h: number, r: () => number, rgb: string, n: number, alpha: number, spread = 0.32) {
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.pow(r(), 1.6) * spread;
    const x = w / 2 + Math.cos(a) * d * w, y = h / 2 + Math.sin(a) * d * h;
    const rad = (0.05 + r() * 0.16) * w * (1 - d);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(0.6, `rgba(${rgb},${alpha * 0.6})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, rad, rad * (0.6 + r() * 0.5), r() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function centeredText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, fill: string, maxW: number) {
  ctx.font = font;
  ctx.fillStyle = fill;
  ctx.textAlign = 'center';
  const m = ctx.measureText(text).width;
  if (m > maxW) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(maxW / m, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  } else ctx.fillText(text, x, y);
}

/** Worn painted sign: background, border, rust bleed and grime. */
function signBase(ctx: CanvasRenderingContext2D, w: number, h: number, r: () => number, bg: string, border: string) {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = border;
  ctx.lineWidth = Math.max(6, w * 0.025);
  ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, w - ctx.lineWidth * 2, h - ctx.lineWidth * 2);
  // rust bleeding from the bolt holes
  for (const [bx, by] of [[0.06, 0.08], [0.94, 0.08], [0.06, 0.92], [0.94, 0.92]]) {
    const x = bx * w, y = by * h;
    const g = ctx.createLinearGradient(x, y, x, y + h * 0.35);
    g.addColorStop(0, 'rgba(110,50,20,0.7)');
    g.addColorStop(1, 'rgba(110,50,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 3 - r() * 3, y, 6 + r() * 4, h * 0.35);
    ctx.fillStyle = '#3a3430';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

const DRAW: Record<string, [number, number, Draw]> = {
  // ----------------------------------------------------------------- ground grime (alpha)
  oil1: [256, 256, (c, w, h, r) => {
    blob(c, w, h, r, '18,14,10', 26, 0.38);
    blob(c, w, h, r, '40,30,60', 6, 0.08, 0.15); // faint iridescent sheen
  }],
  oil2: [256, 256, (c, w, h, r) => {
    blob(c, w, h, r, '22,16,10', 18, 0.32, 0.38);
    for (let i = 0; i < 7; i++) { // drips / splashes
      c.fillStyle = `rgba(15,10,6,${0.3 + r() * 0.3})`;
      c.beginPath();
      c.arc(w * (0.15 + r() * 0.7), h * (0.15 + r() * 0.7), 3 + r() * 9, 0, Math.PI * 2);
      c.fill();
    }
  }],
  dirt: [256, 256, (c, w, h, r) => {
    blob(c, w, h, r, '70,52,32', 30, 0.22, 0.4);
    for (let i = 0; i < 600; i++) {
      c.fillStyle = `rgba(50,38,24,${r() * 0.35})`;
      const d = Math.pow(r(), 0.7) * w * 0.45, a = r() * 6.28;
      c.fillRect(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 2, 2);
    }
  }],
  tracks: [512, 128, (c, w, h, r) => {
    for (const y0 of [h * 0.22, h * 0.78]) {
      for (let x = 0; x < w; x += 9) {
        const a = 0.18 + 0.22 * Math.sin(x * 0.013 + y0) * Math.sin(x * 0.004) + r() * 0.08;
        c.fillStyle = `rgba(35,26,16,${Math.max(0, a)})`;
        c.save();
        c.translate(x, y0);
        c.rotate(0.5);
        c.fillRect(-2, -16, 4, 32);
        c.restore();
      }
    }
    // feather the ends
    c.globalCompositeOperation = 'destination-in';
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.15, 'rgba(0,0,0,1)');
    g.addColorStop(0.85, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'source-over';
  }],
  cracks: [256, 256, (c, w, h, r) => {
    c.strokeStyle = 'rgba(20,16,12,0.75)';
    c.lineCap = 'round';
    const branch = (x: number, y: number, a: number, len: number, lw: number, depth: number) => {
      c.lineWidth = lw;
      c.beginPath();
      c.moveTo(x, y);
      for (let i = 0; i < 6; i++) {
        a += (r() - 0.5) * 0.9;
        x += Math.cos(a) * len / 6;
        y += Math.sin(a) * len / 6;
        c.lineTo(x, y);
        if (depth > 0 && r() < 0.3) { c.stroke(); branch(x, y, a + (r() - 0.5) * 2, len * 0.5, lw * 0.6, depth - 1); c.lineWidth = lw; c.beginPath(); c.moveTo(x, y); }
      }
      c.stroke();
    };
    branch(w * 0.1, h * 0.5, 0, w * 0.85, 3, 2);
    branch(w * 0.5, h * 0.1, 1.5, h * 0.6, 2, 1);
  }],
  hazard: [512, 64, (c, w, h, r) => {
    c.fillStyle = '#e8b521';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#16130f';
    for (let x = -h; x < w + h; x += 64) {
      c.beginPath();
      c.moveTo(x, h); c.lineTo(x + 32, h); c.lineTo(x + 32 + h, 0); c.lineTo(x + h, 0);
      c.fill();
    }
    // scuffs: wear to bare concrete
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 260; i++) {
      c.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.7})`;
      c.fillRect(r() * w, r() * h, 2 + r() * 14, 1 + r() * 4);
    }
    c.globalCompositeOperation = 'source-over';
  }],
  stripe: [256, 32, (c, w, h, r) => { // painted floor line
    c.fillStyle = '#d8c25a';
    c.fillRect(0, 6, w, h - 12);
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 120; i++) { c.fillStyle = `rgba(0,0,0,${r()})`; c.fillRect(r() * w, r() * h, 2 + r() * 8, 2 + r() * 3); }
    c.globalCompositeOperation = 'source-over';
  }],
  streaks: [256, 256, (c, w, h, r) => { // water / rust streaks running down a wall
    for (let i = 0; i < 22; i++) {
      const x = r() * w, len = h * (0.3 + r() * 0.7), wd = 3 + r() * 12;
      const g = c.createLinearGradient(0, 0, 0, len);
      const rust = r() < 0.4;
      g.addColorStop(0, rust ? 'rgba(110,52,22,0.45)' : 'rgba(40,34,28,0.4)');
      g.addColorStop(1, 'rgba(40,34,28,0)');
      c.fillStyle = g;
      c.fillRect(x, 0, wd, len);
    }
  }],
  grimeBand: [256, 128, (c, w, h, r) => { // dirt splashed up the base of a wall
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(70,55,38,0)');
    g.addColorStop(0.6, 'rgba(70,55,38,0.35)');
    g.addColorStop(1, 'rgba(60,45,30,0.7)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      c.fillStyle = `rgba(60,45,30,${r() * 0.4})`;
      c.fillRect(r() * w, h * (0.3 + r() * 0.7), 2, 2 + r() * 3);
    }
  }],
  soot: [256, 256, (c, w, h, r) => {
    const g = c.createRadialGradient(w / 2, h * 0.75, 0, w / 2, h * 0.6, w * 0.5);
    g.addColorStop(0, 'rgba(15,12,10,0.75)');
    g.addColorStop(1, 'rgba(15,12,10,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    blob(c, w, h, r, '15,12,10', 8, 0.15, 0.2);
  }],
  drain: [128, 128, (c, w, h) => {
    c.fillStyle = '#26231f';
    c.fillRect(8, 8, w - 16, h - 16);
    c.fillStyle = '#0b0a09';
    for (let i = 0; i < 7; i++) c.fillRect(18 + i * 14, 18, 7, h - 36);
    c.strokeStyle = 'rgba(120,60,25,0.8)';
    c.lineWidth = 4;
    c.strokeRect(8, 8, w - 16, h - 16);
  }],
  // ----------------------------------------------------------------- posters & signs
  posterMove: [320, 448, (c, w, h, r) => {
    c.fillStyle = '#10131a';
    c.fillRect(0, 0, w, h);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,90,40,0.55)');
    g.addColorStop(1, 'rgba(120,40,160,0.25)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    // rocket
    c.fillStyle = '#f2ead8';
    c.beginPath();
    c.moveTo(w / 2, 70); c.quadraticCurveTo(w / 2 + 46, 150, w / 2 + 30, 250); c.lineTo(w / 2 - 30, 250); c.quadraticCurveTo(w / 2 - 46, 150, w / 2, 70);
    c.fill();
    c.fillStyle = '#ff6a1a';
    c.beginPath(); c.moveTo(w / 2 - 22, 252); c.lineTo(w / 2, 300 + r() * 10); c.lineTo(w / 2 + 22, 252); c.fill();
    c.fillStyle = '#1b2235';
    c.beginPath(); c.arc(w / 2, 150, 15, 0, Math.PI * 2); c.fill();
    centeredText(c, 'MOVE FAST', w / 2, 352, `900 60px ${FONT_DISPLAY}`, '#ffffff', w - 30);
    centeredText(c, '& BUNKER THINGS', w / 2, 398, `700 30px ${FONT_UI}`, '#ffb347', w - 30);
    centeredText(c, 'BUNKR.LY  ·  SERIES A', w / 2, 432, `600 16px ${FONT_MONO}`, '#9aa3b5', w - 30);
    grime(c, w, h, 0.6, 21);
  }],
  posterFail: [320, 448, (c, w, h, r) => {
    c.fillStyle = '#e9e2cf';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#1d2a4a';
    c.fillRect(18, 18, w - 36, 250);
    // sunset over a mountain, motivational style
    const g = c.createLinearGradient(0, 18, 0, 268);
    g.addColorStop(0, '#2b3d75');
    g.addColorStop(1, '#f08a4b');
    c.fillStyle = g;
    c.fillRect(18, 18, w - 36, 250);
    c.fillStyle = '#ffd27a';
    c.beginPath(); c.arc(w / 2, 210, 40, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#141824';
    c.beginPath(); c.moveTo(18, 268); c.lineTo(110, 150); c.lineTo(170, 210); c.lineTo(230, 130); c.lineTo(w - 18, 268); c.fill();
    centeredText(c, 'FAIL FORWARD', w / 2, 330, `900 54px ${FONT_DISPLAY}`, '#1a1a1a', w - 40);
    centeredText(c, 'then fail sideways,', w / 2, 372, `700 22px ${FONT_UI}`, '#3a3a3a', w - 40);
    centeredText(c, 'then fail into a bunker.', w / 2, 400, `700 22px ${FONT_UI}`, '#3a3a3a', w - 40);
    void r;
    grime(c, w, h, 0.7, 33);
  }],
  posterSeed: [320, 448, (c, w, h, r) => {
    c.fillStyle = '#0d1f1d';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#3ff2e0';
    c.lineWidth = 3;
    for (let i = 0; i < 12; i++) { c.beginPath(); c.arc(w / 2, 170, 20 + i * 14, 0, Math.PI * 2); c.globalAlpha = 0.5 - i * 0.04; c.stroke(); }
    c.globalAlpha = 1;
    c.fillStyle = '#e8e4da';
    c.beginPath(); c.ellipse(w / 2, 170, 80, 34, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ff6a1a';
    c.fillRect(w / 2 - 80, 166, 160, 6);
    c.fillStyle = '#3ff2e0';
    c.beginPath(); c.arc(w / 2, 186, 12, 0, Math.PI * 2); c.fill();
    centeredText(c, 'SEEDBOT', w / 2, 320, `900 66px ${FONT_DISPLAY}`, '#3ff2e0', w - 30);
    centeredText(c, 'SECURITY AS A SERVICE', w / 2, 356, `700 20px ${FONT_UI}`, '#e8e4da', w - 30);
    centeredText(c, 'battery: 12%  ·  vibes: 100%', w / 2, 400, `600 15px ${FONT_MONO}`, '#7fa39d', w - 30);
    void r;
    grime(c, w, h, 0.5, 44);
  }],
  signNoTresp: [384, 256, (c, w, h, r) => {
    signBase(c, w, h, r, '#efe7d2', '#1a1a1a');
    c.fillStyle = '#b3201a';
    c.fillRect(22, 22, w - 44, 78);
    centeredText(c, 'NO TRESPASSING', w / 2, 82, `900 62px ${FONT_DISPLAY}`, '#ffffff', w - 70);
    centeredText(c, 'VIOLATORS WILL BE', w / 2, 150, `700 30px ${FONT_UI}`, '#1a1a1a', w - 70);
    centeredText(c, 'ONBOARDED', w / 2, 205, `900 54px ${FONT_DISPLAY}`, '#1a1a1a', w - 70);
    grime(c, w, h, 0.9, 5);
  }],
  signDrone: [384, 256, (c, w, h, r) => {
    signBase(c, w, h, r, '#f2c230', '#141414');
    c.fillStyle = '#141414';
    // drone pictogram
    c.beginPath(); c.ellipse(78, 120, 34, 14, 0, 0, Math.PI * 2); c.fill();
    for (const dx of [-42, 42]) { c.fillRect(78 + dx - 20, 96, 40, 5); c.fillRect(78 + dx * 0.6 - 2, 98, 4, 18); }
    c.beginPath(); c.moveTo(70, 132); c.lineTo(40, 200); c.lineTo(116, 200); c.lineTo(86, 132); c.globalAlpha = 0.35; c.fill(); c.globalAlpha = 1;
    centeredText(c, 'WARNING', 250, 80, `900 54px ${FONT_DISPLAY}`, '#141414', 220);
    centeredText(c, 'AUTONOMOUS', 250, 128, `700 30px ${FONT_UI}`, '#141414', 220);
    centeredText(c, 'SECURITY DRONE', 250, 162, `700 30px ${FONT_UI}`, '#141414', 220);
    centeredText(c, '(BETA)', 250, 210, `900 40px ${FONT_DISPLAY}`, '#b3201a', 220);
    grime(c, w, h, 0.9, 6);
  }],
  signVolt: [256, 256, (c, w, h, r) => {
    c.fillStyle = '#f2c230';
    c.beginPath(); c.moveTo(w / 2, 14); c.lineTo(w - 14, h - 24); c.lineTo(14, h - 24); c.closePath(); c.fill();
    c.strokeStyle = '#141414'; c.lineWidth = 12; c.lineJoin = 'round'; c.stroke();
    c.fillStyle = '#141414';
    c.beginPath(); c.moveTo(138, 70); c.lineTo(100, 150); c.lineTo(130, 150); c.lineTo(112, 210); c.lineTo(160, 125); c.lineTo(130, 125); c.lineTo(150, 70); c.fill();
    grime(c, w, h, 0.5, 7);
    void r;
  }],
  signExec: [256, 128, (c, w, h, r) => {
    signBase(c, w, h, r, '#1c2433', '#c9a648');
    centeredText(c, 'EXECUTIVE', w / 2, 60, `700 34px ${FONT_UI}`, '#c9a648', w - 40);
    centeredText(c, 'RESTROOM', w / 2, 102, `700 34px ${FONT_UI}`, '#e8e4da', w - 40);
  }],
  plaque: [512, 128, (c, w, h, r) => {
    c.fillStyle = '#d9c9a3';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#7a6236'; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12);
    centeredText(c, 'BUNKR.LY  WORLD HQ', w / 2, 60, `900 48px ${FONT_DISPLAY}`, '#2a2014', w - 40);
    centeredText(c, '"Uber for Bunkers" · est. the week before the end', w / 2, 100, `700 20px ${FONT_UI}`, '#4a3a24', w - 40);
    grime(c, w, h, 0.9, 8);
  }],
  runway: [512, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    centeredText(c, 'RUNWAY ROOM', w / 2, 92, `900 96px ${FONT_DISPLAY}`, 'rgba(235,230,215,0.85)', w - 20);
  }],
  restricted: [512, 96, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    centeredText(c, 'AUTHORIZED FOUNDERS ONLY', w / 2, 66, `900 58px ${FONT_DISPLAY}`, 'rgba(200,40,30,0.9)', w - 20);
  }],
  pegboard: [512, 256, (c, w, h, r) => {
    c.fillStyle = '#9a7b55';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#4a3a28';
    for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 16) { c.beginPath(); c.arc(x, y, 2.6, 0, Math.PI * 2); c.fill(); }
    // painted tool outlines ("shadow board"), some tools missing
    c.fillStyle = 'rgba(30,30,30,0.85)';
    const outline = (x: number, y: number, s: number, kind: number) => {
      c.save(); c.translate(x, y); c.scale(s, s);
      if (kind === 0) { c.fillRect(-4, -50, 8, 80); c.beginPath(); c.arc(0, -56, 12, 0, Math.PI * 2); c.fill(); } // wrench
      else if (kind === 1) { c.fillRect(-3, -30, 6, 70); c.fillRect(-20, -40, 40, 14); } // hammer
      else if (kind === 2) { c.fillRect(-3, -10, 6, 50); c.fillRect(-8, -50, 16, 42); } // screwdriver
      else { c.beginPath(); c.moveTo(-30, 30); c.lineTo(30, 30); c.lineTo(30, -10); c.lineTo(-30, 20); c.fill(); } // saw
      c.restore();
    };
    for (let i = 0; i < 9; i++) outline(40 + i * 52, 120 + (i % 2) * 20, 0.9 + r() * 0.2, i % 4);
    c.fillStyle = '#c0281e';
    c.font = `700 22px ${FONT_UI}`;
    c.fillText('IF YOU BORROW IT, PUT IT BACK — T.P.', 20, h - 18);
    grime(c, w, h, 0.5, 9);
  }],
  tag1: [512, 192, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.save();
    c.translate(w / 2, h / 2);
    c.rotate(-0.08);
    c.font = `900 110px ${FONT_DISPLAY}`;
    c.textAlign = 'center';
    c.lineWidth = 10; c.strokeStyle = '#111'; c.strokeText('SEEDBOT SUX', 0, 40);
    c.fillStyle = '#3ad16b'; c.fillText('SEEDBOT SUX', 0, 40);
    c.restore();
    c.fillStyle = '#3ad16b';
    for (let i = 0; i < 12; i++) c.fillRect(80 + Math.random() * 350, 120 + Math.random() * 10, 3, 14 + Math.random() * 40);
  }],
  tag2: [384, 192, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = '#f2f0e6'; c.lineWidth = 9; c.lineCap = 'round';
    // smiley with x-eyes
    c.beginPath(); c.arc(90, 96, 64, 0, Math.PI * 2); c.stroke();
    for (const ex of [68, 112]) { c.beginPath(); c.moveTo(ex - 10, 70); c.lineTo(ex + 10, 90); c.moveTo(ex + 10, 70); c.lineTo(ex - 10, 90); c.stroke(); }
    c.beginPath(); c.arc(90, 120, 26, Math.PI * 1.1, Math.PI * 1.9, false); c.stroke();
    c.font = `900 72px ${FONT_DISPLAY}`;
    c.fillStyle = '#ff9a2a';
    c.fillText('HODL', 170, 120);
  }],
  tag3: [384, 160, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.font = `900 84px ${FONT_DISPLAY}`;
    c.fillStyle = '#4fb6ff';
    c.save(); c.translate(20, 110); c.rotate(-0.05); c.fillText('EAT THE', 0, 0); c.restore();
    c.fillStyle = '#ff3a6e';
    c.save(); c.translate(60, 150); c.rotate(-0.05); c.font = `900 56px ${FONT_DISPLAY}`; c.fillText('FOUNDERS', 0, 0); c.restore();
  }],
  arrow: [256, 128, (c, w, h) => { // painted "drone landing" arrow / chevrons
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(230,225,210,0.75)';
    for (let i = 0; i < 3; i++) {
      const x = 30 + i * 70;
      c.beginPath(); c.moveTo(x, 14); c.lineTo(x + 40, h / 2); c.lineTo(x, h - 14); c.lineTo(x + 20, h - 14); c.lineTo(x + 60, h / 2); c.lineTo(x + 20, 14); c.fill();
    }
  }],
  cash: [256, 128, (c, w, h, r) => { // banknote bundle top
    c.fillStyle = '#7f9a6a';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#4c6640'; c.lineWidth = 6; c.strokeRect(10, 10, w - 20, h - 20);
    c.fillStyle = '#c9d6b0';
    c.beginPath(); c.ellipse(w / 2, h / 2, 30, 36, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e8e0c8'; c.fillRect(w / 2 - 14, 0, 28, h); // paper band
    centeredText(c, '$', 50, 80, `900 54px ${FONT_DISPLAY}`, '#3d5434', 60);
    void r;
  }],
  // ----------------------------------------------------------------- additive light pools
  poolWarm: [128, 128, (c, w, h) => pool(c, w, h, '255,190,120')],
  poolPink: [128, 128, (c, w, h) => pool(c, w, h, '255,60,160')],
  poolCyan: [128, 128, (c, w, h) => pool(c, w, h, '60,240,225')],
  poolRed: [128, 128, (c, w, h) => pool(c, w, h, '255,40,30')],
  poolWhite: [128, 128, (c, w, h) => pool(c, w, h, '235,240,255')],
  // vertical wash for light falling down a wall from a lamp above
  washWarm: [128, 256, (c, w, h) => wash(c, w, h, '255,190,120')],
  washCyan: [128, 256, (c, w, h) => wash(c, w, h, '60,240,225')],
  washPink: [128, 256, (c, w, h) => wash(c, w, h, '255,60,160')],
};

/** Half-ellipse of light hanging from the top edge (a lamp or sign washing down a wall). */
function wash(c: CanvasRenderingContext2D, w: number, h: number, rgb: string) {
  c.save();
  c.scale(1, h / w);
  const g = c.createRadialGradient(w / 2, 0, 0, w / 2, 0, w / 2);
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(0.25, `rgba(${rgb},0.6)`);
  g.addColorStop(0.6, `rgba(${rgb},0.18)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, w, w);
  c.restore();
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

export type DecalName = keyof typeof DRAW;

let _atlas: { tex: THREE.CanvasTexture; regions: Record<string, Region> } | null = null;

/** Shelf-pack every entry of DRAW into one canvas. */
function atlas() {
  if (_atlas) return _atlas;
  const regions: Record<string, Region> = {};
  const entries = Object.entries(DRAW).sort((a, b) => b[1][1] - a[1][1]);
  const tex = canvasTexture(SIZE, SIZE, (ctx) => {
    ctx.clearRect(0, 0, SIZE, SIZE);
    let x = 0, y = 0, rowH = 0;
    let seed = 1;
    for (const [name, [w, h, draw]] of entries) {
      if (x + w + PAD > SIZE) { x = 0; y += rowH + PAD; rowH = 0; }
      if (y + h > SIZE) throw new Error('garage atlas full');
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      draw(ctx, w, h, rng(seed++));
      ctx.restore();
      // half-texel inset so mip filtering does not bleed neighbours in
      regions[name] = { u0: (x + 1) / SIZE, u1: (x + w - 1) / SIZE, v0: 1 - (y + h - 1) / SIZE, v1: 1 - (y + 1) / SIZE };
      x += w + PAD;
      rowH = Math.max(rowH, h);
    }
  });
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  _atlas = { tex, regions };
  return _atlas;
}

/**
 * A flat quad of `w`×`h` metres showing atlas region `name`. Built in the XY plane facing +z, then
 * rotated (rx, ry, rz) and moved to (x, y, z). Floor decals: rx = -π/2.
 */
export function decal(name: DecalName, w: number, h: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const r = atlas().regions[name];
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  return norm(g);
}

/** Floor decal (lies flat, `rot` about the vertical). */
export const floorDecal = (name: DecalName, w: number, h: number, x: number, y: number, z: number, rot = 0) => decal(name, w, h, x, y, z, -Math.PI / 2, 0, rot);

/** Map a box's faces onto an atlas region (all six faces get the full region). */
export function atlasBox(name: DecalName, g: THREE.BufferGeometry) {
  const r = atlas().regions[name];
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
  return g;
}

let _lit: THREE.MeshStandardNodeMaterial | null = null;
/** Lit decal material (stains, signs, posters): alpha-blended, no depth write, pulled toward the camera. */
export function decalMaterial() {
  if (_lit) return _lit;
  const m = new THREE.MeshStandardNodeMaterial({
    map: atlas().tex, transparent: true, depthWrite: false, roughness: 0.85, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  _lit = m;
  return m;
}

/** Opaque atlas material for solid painted things (sign plates, pegboard, cash bricks). */
let _solid: THREE.MeshStandardNodeMaterial | null = null;
export function atlasSolidMaterial() {
  if (_solid) return _solid;
  _solid = new THREE.MeshStandardNodeMaterial({ map: atlas().tex, roughness: 0.75, metalness: 0.05, alphaTest: 0.5 });
  return _solid;
}

/** Shared night level for the additive light pools (0 by day … 1 at night). */
export const uPoolNight = uniform(0);
/** Extra flicker / alarm multiplier for the pools. */
export const uPoolBoost = uniform(1);

let _add: THREE.MeshBasicNodeMaterial | null = null;
/** Additive light-spill material: pools of lamp / neon light on floors and walls, brighter at night. */
export function lightPoolMaterial() {
  if (_add) return _add;
  const m = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  });
  const t: N = texture(atlas().tex);
  const k: N = float(0.12).add(uPoolNight.mul(0.88)).mul(uPoolBoost);
  m.colorNode = t.rgb.mul(t.a).mul(k).mul(0.9);
  m.opacityNode = float(1);
  void vec4;
  _add = m;
  return m;
}
