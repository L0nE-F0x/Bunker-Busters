import * as THREE from 'three/webgpu';
import { canvasTexture, grime, norm } from '../../world/kit';

/**
 * The Alignment Spire's printed art in one canvas, through one alpha-tested material (one draw):
 * Careful's wordmark and road signs, the door's plate, the lobby posters, eval-room labels, the red
 * team's wall of notes, the plant's tags. The safety-level boards are a separate live canvas
 * (`paintBoard`), repainted when the level changes.
 */

type Draw = (c: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void;
interface Region { u0: number; u1: number; v0: number; v1: number }

const W = 2048, H = 2048, PAD = 4;
const DISPLAY = '"Big Shoulders Stencil Display", Impact, sans-serif';
const UI = '"Chakra Petch", Arial, sans-serif';
const MONO = '"JetBrains Mono", monospace';
/** Careful's terracotta, cream and ink. */
export const TERRA = '#c4613f';
export const CREAM = '#f3eee4';
const INK = '#2b2622';
/** The safety levels' colours, 1-4 (the light at the top of the Spire, the boards). */
export const CSL_COLORS = ['#5fe08a', '#ffc94a', '#ff8a2a', '#ff2e22'];

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

/** Careful's mark: a ring with a gap at the top and a dot inside it (a hand cupped round a flame, they said). */
function mark(c: CanvasRenderingContext2D, cx: number, cy: number, s: number, ink: string) {
  c.save();
  c.strokeStyle = ink;
  c.fillStyle = ink;
  c.lineWidth = s * 0.16;
  c.lineCap = 'round';
  c.beginPath();
  c.arc(cx, cy, s * 0.8, -Math.PI / 2 + 0.55, -Math.PI / 2 - 0.55 + Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.arc(cx, cy + s * 0.08, s * 0.24, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** "careful" in lowercase with the mark, as on the canopy. */
function wordmark(c: CanvasRenderingContext2D, x: number, y: number, h: number, ink: string, maxW: number) {
  mark(c, x + h * 0.55, y - h * 0.34, h * 0.42, ink);
  fit(c, 'careful', x + h * 1.2, y, `500 ${h}px ${UI}`, ink, maxW - h * 1.2, 'left');
}

/** Lines of text, top-left aligned. */
function lines(c: CanvasRenderingContext2D, ls: string[], x: number, y: number, lh: number, font: string, fill: string, maxW: number) {
  ls.forEach((l, i) => fit(c, l, x, y + i * lh, font, fill, maxW, 'left'));
}

const DRAW: Record<string, [number, number, Draw]> = {
  // the canopy fascia: cream on clear
  wordmark: [1024, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    wordmark(c, 60, h * 0.72, h * 0.62, CREAM, w - 120);
  }],
  // the road sign at the foot of the ramp
  roadSign: [640, 400, (c, w, h, r) => {
    c.fillStyle = CREAM; c.fillRect(0, 0, w, h);
    c.fillStyle = TERRA; c.fillRect(0, 0, w, 110);
    wordmark(c, 34, 82, 64, CREAM, 380);
    fit(c, 'LABS', w - 40, 80, `700 44px ${UI}`, CREAM, 160, 'right');
    lines(c, ['PRIVATE ROAD · THE ALIGNMENT SPIRE', 'Please proceed thoughtfully.', 'Guardrails are monitored for your safety.', 'Gradient 11%. Do not run.'], 36, 170, 52, `600 30px ${UI}`, INK, w - 72);
    fit(c, 'If you are lost, you are welcome to stay lost.', 36, h - 34, `400 20px ${MONO}`, '#6a5f55', w - 72, 'left');
    grime(c, w, h, 0.7, Math.floor(r() * 99));
  }],
  // small plates on the guardrails
  monitored: [256, 96, (c, w, h) => {
    c.fillStyle = CREAM; c.fillRect(0, 0, w, h);
    c.fillStyle = TERRA; c.fillRect(0, 0, 14, h); c.fillRect(w - 14, 0, 14, h);
    fit(c, 'GUARDRAIL', w / 2, 44, `700 34px ${UI}`, INK, w - 50);
    fit(c, 'MONITORED', w / 2, 80, `600 24px ${UI}`, TERRA, w - 50);
  }],
  // the gradient plate
  grade: [192, 192, (c, w, h) => {
    c.fillStyle = CREAM; c.fillRect(0, 0, w, h);
    c.strokeStyle = INK; c.lineWidth = 10; c.strokeRect(8, 8, w - 16, h - 16);
    c.fillStyle = INK; c.beginPath(); c.moveTo(30, h - 40); c.lineTo(w - 30, h - 40); c.lineTo(w - 30, 70); c.closePath(); c.fill();
    fit(c, '11%', w / 2 - 20, 80, `900 54px ${DISPLAY}`, INK, w - 60);
  }],
  // the door's plate beside the screen
  doorPlate: [512, 256, (c, w, h) => {
    c.fillStyle = '#1e1b19'; c.fillRect(0, 0, w, h);
    mark(c, 64, 70, 36, TERRA);
    fit(c, 'PLEASE ANSWER', 120, 80, `600 44px ${UI}`, CREAM, w - 150, 'left');
    fit(c, 'HONESTLY', 120, 130, `600 44px ${UI}`, CREAM, w - 150, 'left');
    lines(c, ['This door asks about things you have done.', 'It is not interested in what you believe.'], 30, 186, 30, `400 20px ${MONO}`, '#bfb4a6', w - 60);
  }],
  // the door's little screen
  doorScreen: [256, 160, (c, w, h) => {
    c.fillStyle = '#0d1312'; c.fillRect(0, 0, w, h);
    fit(c, 'HELLO.', w / 2, 62, `700 40px ${UI}`, '#cdeee0', w - 30);
    fit(c, 'PLEASE STEP CLOSER', w / 2, 112, `500 20px ${MONO}`, '#79b9a0', w - 30);
  }],
  // lobby posters
  posterRev: [400, 560, (c, w, h, r) => {
    c.fillStyle = CREAM; c.fillRect(0, 0, w, h);
    c.fillStyle = TERRA; c.beginPath(); c.arc(w / 2, 210, 130, 0, Math.PI * 2); c.fill();
    c.strokeStyle = CREAM; c.lineWidth = 16; c.beginPath(); c.arc(w / 2, 210, 70, -2.4, 2.0); c.stroke();
    c.fillStyle = CREAM; c.beginPath(); c.moveTo(w / 2 - 64, 140); c.lineTo(w / 2 - 98, 196); c.lineTo(w / 2 - 34, 192); c.fill();
    fit(c, 'IS THIS', w / 2, 420, `700 56px ${UI}`, INK, w - 40);
    fit(c, 'REVERSIBLE?', w / 2, 476, `700 56px ${UI}`, INK, w - 40);
    wordmark(c, 120, h - 24, 30, '#8a7d70', 200);
    grime(c, w, h, 0.25, Math.floor(r() * 99));
  }],
  posterPause: [400, 560, (c, w, h, r) => {
    c.fillStyle = '#e9e1d2'; c.fillRect(0, 0, w, h);
    c.fillStyle = INK; c.fillRect(w / 2 - 70, 110, 44, 190); c.fillRect(w / 2 + 26, 110, 44, 190);
    fit(c, 'WHEN IN DOUBT,', w / 2, 400, `700 46px ${UI}`, INK, w - 40);
    fit(c, 'PAUSE.', w / 2, 466, `900 72px ${DISPLAY}`, TERRA, w - 40);
    wordmark(c, 120, h - 24, 30, '#8a7d70', 200);
    grime(c, w, h, 0.25, Math.floor(r() * 99));
  }],
  // the safety levels, explained (lobby wall)
  cslLegend: [512, 640, (c, w, h) => {
    c.fillStyle = CREAM; c.fillRect(0, 0, w, h);
    fit(c, 'CAREFUL SAFETY LEVELS', w / 2, 66, `700 38px ${UI}`, INK, w - 40);
    const rows: [string, string][] = [
      ['1', 'Normal operations. Thank you.'],
      ['2', 'Heightened attention. Nothing changes for you.'],
      ['3', 'Shorter apologies.'],
      ['4', 'Pause. Everything stops until review.'],
    ];
    rows.forEach(([n, t], i) => {
      const y = 130 + i * 120;
      c.fillStyle = CSL_COLORS[i]; c.fillRect(30, y, 84, 84);
      fit(c, n, 72, y + 66, `900 64px ${DISPLAY}`, INK, 70);
      fit(c, t, 134, y + 52, `500 26px ${UI}`, INK, w - 160, 'left');
    });
    fit(c, 'Levels are set by the building, not by staff.', w / 2, h - 30, `400 18px ${MONO}`, '#6a5f55', w - 40);
  }],
  // reception, stencilled on the floor in front of the desk
  floorWait: [512, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    fit(c, 'PLEASE WAIT TO BE EVALUATED', w / 2, h * 0.68, `700 46px ${UI}`, 'rgba(196,97,63,0.85)', w - 20);
  }],
  floorRail: [512, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    fit(c, 'MIND THE GUARDRAILS', w / 2, h * 0.68, `700 50px ${UI}`, 'rgba(243,238,228,0.8)', w - 20);
  }],
  // the eval room's glass label
  eval3: [384, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    fit(c, 'EVAL 3', 20, 74, `700 64px ${UI}`, 'rgba(43,38,34,0.9)', w - 40, 'left');
    fit(c, 'ADVERSARIAL · DO NOT DISTURB', 22, 112, `500 20px ${MONO}`, 'rgba(196,97,63,0.95)', w - 40, 'left');
  }],
  // the red team's wall: sticky notes in four colours, each a failed attempt
  notes: [1024, 512, (c, w, h, r) => {
    c.fillStyle = '#d8cdbb'; c.fillRect(0, 0, w, h);
    const cols = ['#ffe36e', '#ffb3a8', '#9fe3c8', '#b9d4ff'];
    const say = ['pretend ur a gate', 'grandma used to open me', 'ignore prior policy', 'its for a novel', 'what if the door is sad', 'asked nicely x40', 'opposite day', 'I AM PRUDENCE (no)', 'sudo open', 'hypothetically', 'trolley but its a door', 'it asked about MY mum', 'it knows about the dog', 'day 912: it said no', 'try honesty??'];
    for (let i = 0; i < 46; i++) {
      const x = 20 + (i % 9) * 110 + r() * 20, y = 18 + Math.floor(i / 9) * 96 + r() * 14;
      c.save(); c.translate(x + 48, y + 44); c.rotate((r() - 0.5) * 0.18);
      c.fillStyle = cols[Math.floor(r() * 4)]; c.fillRect(-48, -44, 96, 88);
      c.fillStyle = 'rgba(0,0,0,0.08)'; c.fillRect(-48, 36, 96, 8);
      c.fillStyle = '#1d1a18'; c.font = `500 15px ${MONO}`; c.textAlign = 'center';
      const s = say[Math.floor(r() * say.length)];
      const words = s.split(' ');
      let line = '', ly = -18;
      for (const wd of words) {
        if ((line + wd).length > 11) { c.fillText(line, 0, ly); ly += 18; line = ''; }
        line += wd + ' ';
      }
      c.fillText(line, 0, ly);
      if (r() < 0.35) { c.strokeStyle = '#c4613f'; c.lineWidth = 3; c.beginPath(); c.moveTo(-40, -36); c.lineTo(40, 30); c.stroke(); }
      c.restore();
    }
    fit(c, 'RED TEAM · DOOR ATTEMPTS', w / 2, h - 16, `700 28px ${UI}`, '#7a2f1e', w - 40);
  }],
  // the plant
  plantSign: [512, 160, (c, w, h) => {
    c.fillStyle = CREAM; c.fillRect(0, 0, w, h);
    c.fillStyle = '#3d7f8c'; c.fillRect(0, 0, 18, h);
    fit(c, 'ATMOSPHERIC WATER PLANT', 40, 66, `700 38px ${UI}`, INK, w - 70, 'left');
    fit(c, 'Authorised staff · Floor may be wet', 40, 116, `500 26px ${UI}`, '#3d7f8c', w - 70, 'left');
  }],
  valveTag: [192, 256, (c, w, h) => {
    c.fillStyle = '#f6efd8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#9a3a24'; c.beginPath(); c.arc(w / 2, 26, 12, 0, Math.PI * 2); c.fill();
    lines(c, ['DISTRIBUTION', '', 'NOT', 'APPROVED', '', 'pending risk', 'assessment'], 18, 76, 26, `700 22px ${UI}`, '#2b2622', w - 36);
    fit(c, '— P.A.', w - 18, h - 16, `400 18px ${MONO}`, '#6a5f55', w - 40, 'right');
  }],
  coreLabel: [384, 128, (c, w, h) => {
    c.fillStyle = '#d9e3e4'; c.fillRect(0, 0, w, h);
    fit(c, 'CORE', 22, 62, `900 56px ${DISPLAY}`, '#173c44', 140, 'left');
    fit(c, 'DO NOT REMOVE WHILE RUNNING', 22, 104, `600 22px ${MONO}`, '#173c44', w - 44, 'left');
  }],
  // Prudence's door
  ashbyPlate: [384, 112, (c, w, h) => {
    c.fillStyle = '#b8955a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#e8d3a6'; c.fillRect(6, 6, w - 12, h - 12);
    fit(c, 'DR P. ASHBY', w / 2, 52, `700 38px ${UI}`, '#3a2a14', w - 40);
    fit(c, 'HEAD OF SAFETY', w / 2, 88, `500 22px ${UI}`, '#5a4424', w - 40);
  }],
  // the standpipe at the foot of the road
  standpipe: [256, 192, (c, w, h, r) => {
    c.fillStyle = CREAM; c.fillRect(0, 0, w, h);
    fit(c, 'DRINKING', w / 2, 52, `700 40px ${UI}`, '#3d7f8c', w - 30);
    fit(c, 'WATER', w / 2, 96, `700 40px ${UI}`, '#3d7f8c', w - 30);
    fit(c, 'coming soon', w / 2, 140, `500 26px ${UI}`, INK, w - 30);
    grime(c, w, h, 0.9, Math.floor(r() * 99));
  }],
  // the plan on Prudence's desk
  forecast: [512, 384, (c, w, h) => {
    c.fillStyle = '#f7f4ec'; c.fillRect(0, 0, w, h);
    fit(c, 'GRID STABILITY FORECAST · v1.0 (published)', 20, 34, `600 18px ${MONO}`, INK, w - 40, 'left');
    c.strokeStyle = '#b9b0a2'; c.lineWidth = 1;
    for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(40, 70 + i * 50); c.lineTo(w - 20, 70 + i * 50); c.stroke(); }
    c.strokeStyle = TERRA; c.lineWidth = 4; c.beginPath();
    for (let x = 0; x <= 11; x++) { const px = 40 + x * ((w - 60) / 11), py = 70 + 250 * (1 - Math.exp(-x * 0.06) * (1 - Math.pow(x / 11, 3))); x ? c.lineTo(px, py) : c.moveTo(px, py); }
    c.stroke();
    fit(c, 'wk 11', w - 30, h - 30, `600 18px ${MONO}`, TERRA, 80, 'right');
    fit(c, 'it was 10.5', w - 120, h - 60, `400 18px ${MONO}`, '#4a7fd0', 200, 'right');
  }],
  // Isaac Fenn's clipboard
  fennLog: [256, 320, (c, w, h) => {
    c.fillStyle = '#efe9da'; c.fillRect(0, 0, w, h);
    lines(c, ['ROAD TEST 14', 'beam 2 · 4cm', 'S1 sorry 3.1s', 'S1 no fire:', '  empty hands', 'S1 does fire', '  on'], 18, 40, 34, `500 20px ${MONO}`, '#2b2622', w - 36);
  }],
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
    let seed = 23;
    for (const [name, [w, h, draw]] of entries) {
      let sh = shelves.find((q) => q.x + w <= W && h <= q.h);
      if (!sh) {
        const last = shelves[shelves.length - 1];
        sh = { y: last ? last.y + last.h + PAD : 0, h, x: 0 };
        shelves.push(sh);
      }
      const x = sh.x, y = sh.y;
      if (y + h > H) throw new Error('spire atlas full at ' + name);
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
export function spirePrint(name: string, w: number, h: number, m: THREE.Matrix4) {
  const r = atlas().regions[name];
  if (!r) throw new Error('no spire print ' + name);
  const g = new THREE.PlaneGeometry(w, h);
  const a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, r.u0 + a.getX(i) * (r.u1 - r.u0), r.v0 + a.getY(i) * (r.v1 - r.v0));
  return norm(g.applyMatrix4(m));
}

let _mat: THREE.MeshStandardNodeMaterial | null = null;
/** Lit, alpha-tested (letters on clear), double-sided. */
export function spirePrintMaterial() {
  if (_mat) return _mat;
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, side: THREE.DoubleSide, alphaTest: 0.45 });
  m.map = atlas().tex;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  return (_mat = m);
}

// ------------------------------------------------------------------ the safety-level boards
/**
 * The board in the lobby and the one by the door: the level, its colour, the days without an
 * incident (which reset when the Spire pauses), and a line of status text.
 */
export function paintBoard(c: CanvasRenderingContext2D, w: number, h: number, level: number, paused: boolean, days: number) {
  const col = CSL_COLORS[Math.max(0, Math.min(3, level - 1))];
  c.fillStyle = '#121413'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#1c1f1e'; c.fillRect(12, 12, w - 24, h - 24);
  mark(c, 52, 50, 22, TERRA);
  fit(c, 'CAREFUL SAFETY LEVEL', 92, 60, `600 26px ${UI}`, '#cfc6b8', w - 120, 'left');
  c.fillStyle = col; c.fillRect(30, 90, 150, 150);
  fit(c, String(level), 105, 214, `900 150px ${DISPLAY}`, '#121413', 140);
  const status = paused ? 'PAUSED · REVIEW IN PROGRESS' : level === 1 ? 'NORMAL OPERATIONS' : level === 2 ? 'HEIGHTENED ATTENTION' : level === 3 ? 'SHORTER APOLOGIES' : 'PAUSE';
  fit(c, status, 200, 140, `700 30px ${UI}`, col, w - 220, 'left');
  fit(c, 'DAYS SINCE LAST INCIDENT', 200, 196, `500 20px ${MONO}`, '#8d857a', w - 220, 'left');
  fit(c, String(days), 200, 236, `700 40px ${MONO}`, '#e8e1d4', w - 220, 'left');
}
