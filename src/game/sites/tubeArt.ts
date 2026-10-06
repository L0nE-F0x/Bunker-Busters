import * as THREE from 'three/webgpu';
import { uniform, uv, step, exp, abs, smoothstep, fract, time, float, vec2, vec3, vec4, Fn, length, pow, clamp, instancedBufferAttribute, varying, viewportLinearDepth, linearDepth, cameraFar, cameraNear } from 'three/tsl';
import { SiteAtlas, blob, fitText, signPlate, weather, poolGrad, washGrad, FONT_DISPLAY, FONT_UI, FONT_MONO, type AtlasDraw } from './datacenterAtlas';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

/** Painted surfaces of The Tube (LOOPR's Station Zero), in one atlas. */

const ORANGE = '#ff6a1f';

function wordmark(c: CanvasRenderingContext2D, x: number, y: number, size: number, fill: string) {
  c.save();
  c.font = `800 ${size}px ${FONT_UI}`;
  c.textAlign = 'left';
  c.fillStyle = fill;
  c.fillText('L', x, y);
  let px = x + c.measureText('L').width + size * 0.04;
  // the two O's are a loop: a ring and a ring, slightly overlapping
  c.lineWidth = size * 0.13;
  c.strokeStyle = ORANGE;
  for (let i = 0; i < 2; i++) {
    c.beginPath();
    c.arc(px + size * 0.32 + i * size * 0.5, y - size * 0.34, size * 0.27, 0, Math.PI * 2);
    c.stroke();
  }
  px += size * 1.18;
  c.fillText('PR', px, y);
  c.restore();
}

export type TubeArt =
  | 'logo' | 'billboard' | 'departures' | 'brochure' | 'brochureOff' | 'trackmap' | 'vacuum' | 'stencil' | 'future' | 'poster'
  | 'tactile' | 'hazard' | 'oil' | 'dirt' | 'soot' | 'cracks' | 'poolWarm' | 'poolCyan' | 'washWarm' | 'panel' | 'kiosk'
  | 'portalSign' | 'grate' | 'banner' | 'seatback' | 'terminus' | 'vwindow';

export const TUBE_ART: Record<TubeArt, [number, number, AtlasDraw]> = {
  logo: [512, 160, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    wordmark(c, 30, 122, 120, '#f4f1ea');
  }],
  billboard: [1024, 512, (c, w, h, r) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1c2a3a');
    g.addColorStop(1, '#0d141c');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    // a pod streaking across a sunset that has seen better days
    const sun = c.createRadialGradient(w * 0.72, h * 0.62, 10, w * 0.72, h * 0.62, 260);
    sun.addColorStop(0, 'rgba(255,170,80,0.95)');
    sun.addColorStop(1, 'rgba(255,90,30,0)');
    c.fillStyle = sun;
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#e9e6de';
    c.beginPath();
    c.ellipse(w * 0.62, h * 0.66, 210, 36, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = ORANGE;
    c.fillRect(w * 0.62 - 180, h * 0.66 - 4, 360, 8);
    for (let i = 0; i < 9; i++) {
      c.fillStyle = `rgba(255,140,60,${0.5 - i * 0.05})`;
      c.fillRect(w * 0.62 - 230 - i * 40, h * 0.66 - 18 + i * 2, 30, 4);
    }
    wordmark(c, 40, 120, 104, '#f4f1ea');
    fitText(c, 'SF ⇄ LA IN 30 MINUTES*', 40, 210, `900 64px ${FONT_DISPLAY}`, '#f4f1ea', 600, 'left');
    fitText(c, '*Test track: 0.3 km. Top speed: inspirational.', 40, 260, `600 26px ${FONT_UI}`, '#ffb37a', 600, 'left');
    fitText(c, 'THE FUTURE IS ALMOST HERE', 40, h - 40, `700 30px ${FONT_MONO}`, 'rgba(244,241,234,0.7)', 700, 'left');
    weather(c, w, h, r, 1.3);
    // a strip has peeled and flaps in the wind
    c.fillStyle = '#c9c2b0';
    c.beginPath(); c.moveTo(w - 160, 0); c.lineTo(w - 60, 0); c.lineTo(w - 120, 200); c.lineTo(w - 190, 170); c.fill();
  }],
  departures: [512, 256, (c, w, h) => {
    c.fillStyle = '#0b0c0e';
    c.fillRect(0, 0, w, h);
    c.font = `700 22px ${FONT_MONO}`;
    c.textAlign = 'left';
    c.fillStyle = '#ffb02e';
    c.fillText('DEPARTURES · STATION ZERO', 16, 32);
    const rows: [string, string, string][] = [['001', 'SAN FRANCISCO', 'DELAYED'], ['002', 'LOS ANGELES', 'CANCELLED'], ['003', 'MARS', 'SERIES C'], ['004', 'ANYWHERE', 'BOARDING ∞']];
    rows.forEach(([n, to, st], i) => {
      const y = 76 + i * 44;
      c.fillStyle = '#ffd27a';
      c.fillText(n, 16, y);
      c.fillText(to, 80, y);
      c.fillStyle = st.startsWith('CANC') ? '#ff5a3a' : '#ffb02e';
      c.fillText(st, 330, y);
    });
  }],
  brochure: [512, 288, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#ff7a2a');
    g.addColorStop(1, '#ffb15a');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    wordmark(c, 24, 70, 56, '#fff');
    fitText(c, 'Welcome aboard POD-01 "MOMENTUM"!', 24, 130, `700 26px ${FONT_UI}`, '#fff', w - 48, 'left');
    fitText(c, 'Please remain seated while we', 24, 172, `500 22px ${FONT_UI}`, '#fff7ec', w - 48, 'left');
    fitText(c, 'disrupt transportation.', 24, 200, `500 22px ${FONT_UI}`, '#fff7ec', w - 48, 'left');
    fitText(c, 'Your journey is carbon neutral* *offsets pending', 24, 254, `500 15px ${FONT_MONO}`, 'rgba(255,255,255,0.8)', w - 48, 'left');
  }],
  brochureOff: [128, 72, (c, w, h) => {
    c.fillStyle = '#070809';
    c.fillRect(0, 0, w, h);
  }],
  trackmap: [512, 192, (c, w, h) => {
    c.fillStyle = '#071014';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#5fdcff';
    c.lineWidth = 6;
    c.beginPath(); c.moveTo(20, 100); c.lineTo(440, 100); c.stroke();
    c.strokeStyle = '#ff5a3a';
    c.setLineDash([10, 8]);
    c.beginPath(); c.moveTo(440, 100); c.lineTo(500, 100); c.stroke();
    c.setLineDash([]);
    c.fillStyle = ORANGE;
    c.fillRect(330, 86, 24, 28);
    c.font = `600 15px ${FONT_MONO}`;
    c.fillStyle = '#9fd8dc';
    c.textAlign = 'left';
    c.fillText('END OF TRACK', 16, 140);
    c.fillText('STATION 0', 300, 140);
    c.fillText('PORTAL', 440, 140);
    c.fillStyle = '#ff5a3a';
    c.fillText('[PRIVATE EXTENSION]', 340, 170);
    c.fillStyle = '#5fdcff';
    c.fillText('VACUUM 0.1 kPa · SEG 7 BREACH', 16, 30);
  }],
  vacuum: [256, 128, (c, w, h, r) => {
    signPlate(c, w, h, r, '#f2c230', '#1b1b1b');
    fitText(c, 'VACUUM', w / 2, 52, `900 40px ${FONT_DISPLAY}`, '#1b1b1b', w - 30);
    fitText(c, 'EQUALIZE BEFORE OPENING', w / 2, 84, `700 16px ${FONT_UI}`, '#1b1b1b', w - 30);
    fitText(c, 'it will try to eat you', w / 2, 108, `500 13px ${FONT_MONO}`, '#5a3a10', w - 30);
  }],
  stencil: [512, 96, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    fitText(c, 'LOOPR · TEST TUBE 01 · DO NOT CLIMB', w / 2, 62, `900 50px ${FONT_DISPLAY}`, 'rgba(30,30,30,0.75)', w - 20);
  }],
  future: [512, 128, (c, w, h, r) => {
    c.fillStyle = '#16191c';
    c.fillRect(0, 0, w, h);
    fitText(c, 'TO THE FUTURE  ⟶', w / 2, 80, `800 52px ${FONT_UI}`, ORANGE, w - 30);
    weather(c, w, h, r, 0.6);
  }],
  poster: [320, 448, (c, w, h, r) => {
    c.fillStyle = '#f2ede2';
    c.fillRect(0, 0, w, h);
    c.fillStyle = ORANGE;
    c.fillRect(0, 0, w, 200);
    c.fillStyle = '#fff';
    c.beginPath();
    c.ellipse(w / 2, 110, 120, 26, -0.15, 0, Math.PI * 2);
    c.fill();
    fitText(c, 'MOVE FAST', w / 2, 270, `900 60px ${FONT_DISPLAY}`, '#1b1b1b', w - 30);
    fitText(c, 'and break the sound barrier', w / 2, 310, `500 22px ${FONT_UI}`, '#333', w - 30);
    fitText(c, '(pending regulatory approval)', w / 2, 340, `500 18px ${FONT_UI}`, '#666', w - 30);
    fitText(c, 'LOOPR', w / 2, 420, `800 34px ${FONT_UI}`, ORANGE, w - 30);
    weather(c, w, h, r, 1.3);
  }],
  tactile: [256, 64, (c, w, h) => {
    c.fillStyle = '#e8b521';
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = 8; x < w; x += 16) for (let y = 8; y < h; y += 16) { c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill(); }
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
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 180; i++) {
      c.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.7})`;
      c.fillRect(r() * w, r() * h, 2 + r() * 10, 2 + r() * 5);
    }
    c.globalCompositeOperation = 'source-over';
  }],
  oil: [256, 256, (c, w, h, r) => { blob(c, w, h, r, '18,14,10', 22, 0.34); }],
  dirt: [256, 256, (c, w, h, r) => {
    blob(c, w, h, r, '96,72,44', 24, 0.22, 0.4);
    for (let i = 0; i < 400; i++) {
      c.fillStyle = `rgba(70,52,32,${r() * 0.35})`;
      const d = Math.pow(r(), 0.7) * w * 0.45, a = r() * 6.28;
      c.fillRect(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 2, 2);
    }
  }],
  soot: [256, 256, (c, w, h, r) => {
    for (let i = 0; i < 36; i++) {
      const x = w * (0.2 + r() * 0.6);
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, `rgba(30,24,18,${0.2 + r() * 0.3})`);
      g.addColorStop(1, 'rgba(30,24,18,0)');
      c.fillStyle = g;
      c.fillRect(x, 0, 2 + r() * 8, h * (0.4 + r() * 0.6));
    }
  }],
  cracks: [256, 256, (c, w, h, r) => {
    c.strokeStyle = 'rgba(20,16,12,0.7)';
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
  poolWarm: [128, 128, (c, w, h) => poolGrad(c, w, h, '255,180,110')],
  poolCyan: [128, 128, (c, w, h) => poolGrad(c, w, h, '110,225,255')],
  washWarm: [128, 256, (c, w, h) => washGrad(c, w, h, '255,180,110')],
  panel: [256, 256, (c, w, h, r) => {
    c.fillStyle = '#2b3034';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) for (let k = 0; k < 6; k++) {
      c.fillStyle = ['#3d4247', '#e8b521', '#3d4247', '#5a6066'][(i + k) % 4];
      c.fillRect(16 + k * 38, 20 + i * 34, 26, 18);
    }
    c.fillStyle = '#c62014';
    c.beginPath(); c.arc(w / 2, 200, 30, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#e8b521';
    c.lineWidth = 6;
    c.beginPath(); c.arc(w / 2, 200, 38, 0, Math.PI * 2); c.stroke();
    fitText(c, 'LAUNCH (DEMO ONLY)', w / 2, 158, `700 15px ${FONT_MONO}`, '#e8e0cc', w - 20);
    weather(c, w, h, r, 0.5);
  }],
  kiosk: [256, 256, (c, w, h) => {
    c.fillStyle = '#0d1116';
    c.fillRect(0, 0, w, h);
    wordmark(c, 30, 70, 44, '#fff');
    fitText(c, 'TAP TO BOARD', w / 2, 140, `800 30px ${FONT_UI}`, ORANGE, w - 30);
    fitText(c, 'fare: equity', w / 2, 180, `500 18px ${FONT_MONO}`, '#9aa', w - 30);
  }],
  portalSign: [256, 128, (c, w, h, r) => {
    signPlate(c, w, h, r, '#1c2127', ORANGE);
    fitText(c, 'SERVICE TUNNEL', w / 2, 52, `800 28px ${FONT_UI}`, ORANGE, w - 30);
    fitText(c, 'AUTHORIZED FOUNDERS ONLY', w / 2, 86, `600 15px ${FONT_MONO}`, '#e8e0cc', w - 30);
    weather(c, w, h, r, 1.2);
  }],
  grate: [128, 128, (c, w, h) => {
    c.fillStyle = '#3a3f42';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#16191b';
    for (let y = 4; y < h; y += 10) for (let x = 4; x < w; x += 10) c.fillRect(x, y, 6, 6);
  }],
  banner: [1024, 192, (c, w, h, r) => {
    c.fillStyle = '#f4f1ea';
    c.fillRect(0, 0, w, h);
    wordmark(c, 30, 140, 120, '#1b1b1b');
    fitText(c, 'STATION ZERO', 640, 90, `900 76px ${FONT_DISPLAY}`, '#1b1b1b', 560);
    fitText(c, 'THE FUTURE IS ALMOST HERE', 640, 150, `600 30px ${FONT_UI}`, ORANGE, 560);
    weather(c, w, h, r, 1.1);
  }],
  seatback: [128, 128, (c, w, h) => {
    c.fillStyle = '#e6e1d6';
    c.fillRect(0, 0, w, h);
    c.fillStyle = ORANGE;
    c.fillRect(0, h * 0.7, w, 6);
  }],
  vwindow: [512, 192, (c, w, h, r) => {
    // the "window": a looping beach, because the real view is the inside of a steel tube
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#4fb4e8');
    sky.addColorStop(0.55, '#bfe8f4');
    sky.addColorStop(0.56, '#2e8fb0');
    sky.addColorStop(0.72, '#58b6c8');
    sky.addColorStop(0.73, '#ecd9a8');
    sky.addColorStop(1, '#dcc48e');
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 4; i++) { c.beginPath(); c.ellipse(60 + i * 120 + r() * 30, 30 + r() * 20, 40, 10, 0, 0, Math.PI * 2); c.fill(); }
    for (const px of [70, 410]) {
      c.strokeStyle = '#5a3e22';
      c.lineWidth = 7;
      c.beginPath(); c.moveTo(px, h); c.quadraticCurveTo(px + 20, h * 0.6, px + 34, h * 0.32); c.stroke();
      c.fillStyle = '#2f6b2a';
      for (let k = 0; k < 6; k++) { c.save(); c.translate(px + 34, h * 0.32); c.rotate((k / 6) * Math.PI * 2); c.beginPath(); c.ellipse(26, 0, 28, 6, 0.3, 0, Math.PI * 2); c.fill(); c.restore(); }
    }
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(w - 150, h - 30, 140, 22);
    fitText(c, 'LIVE VIEW*  *rendered', w - 80, h - 13, `600 13px ${FONT_MONO}`, '#fff', 132);
  }],
  terminus: [256, 96, (c, w, h, r) => {
    signPlate(c, w, h, r, '#7a1a12', '#e8e0cc');
    fitText(c, 'TERMINUS · PRIVATE', w / 2, 44, `800 26px ${FONT_UI}`, '#f4f1ea', w - 30);
    fitText(c, 'deliveries: leave at blast door', w / 2, 74, `500 14px ${FONT_MONO}`, '#e8d0c0', w - 30);
  }],
};

let _atlas: SiteAtlas<TubeArt> | null = null;
export const tubeAtlas = () => (_atlas ??= new SiteAtlas('tube', TUBE_ART));

/**
 * The track's running lights. Every lens carries its distance from the station in uv.x (0..1);
 * `front` sweeps outward when the station powers up, and once it has passed, "rabbit" pulses keep
 * running away down the line. One material for every lens on 300 m of track.
 */
export class ChaseLights {
  readonly front = uniform(0);
  readonly power = uniform(0);
  readonly material: THREE.MeshBasicNodeMaterial;
  private items: { p: THREE.Vector3; s: number; size: number }[] = [];
  sprite!: THREE.Sprite;

  constructor() {
    const m = new THREE.MeshBasicNodeMaterial();
    m.colorNode = vec3(0.42, 0.88, 1.0).mul(this.level(uv().x).mul(4.2).add(0.02));
    this.material = m;
  }

  private level(s: N): N {
    const f: N = this.front;
    const lit = step(s, f);
    const head = exp(abs(s.sub(f)).mul(-90));
    const rabbit = smoothstep(0.8, 1.0, fract(s.mul(11).sub(time.mul(0.75))));
    return lit.mul(float(0.6).add(rabbit.mul(1.6))).add(head.mul(4)).mul(this.power);
  }

  /** Tag a lens geometry with its track parameter. */
  tag(g: THREE.BufferGeometry, s: number) {
    const a = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) a.setXY(i, s, 0.5);
    return g;
  }

  /** Tag a strip running along the track: every vertex gets its own track parameter. */
  strip(g: THREE.BufferGeometry) {
    const a = g.attributes.uv as THREE.BufferAttribute;
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) a.setXY(i, Math.abs(p.getX(i)) / 240, 0.5);
    return g;
  }

  halo(p: THREE.Vector3, s: number, size: number) {
    this.items.push({ p: p.clone(), s, size });
  }

  /** One instanced halo sprite that follows the same chase. */
  buildHalos() {
    const n = Math.max(1, this.items.length);
    const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.items.forEach((it, i) => a.setXYZW(i, it.p.x, it.p.y, it.p.z, it.s));
    const sz = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.items.forEach((it, i) => sz.setX(i, it.size));
    const A: N = instancedBufferAttribute(a, 'vec4');
    const Z: N = instancedBufferAttribute(sz, 'float');
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    mat.positionNode = A.xyz;
    const k: N = this.level(A.w);
    const vk: N = varying(k);
    mat.scaleNode = vec2(Z, Z).mul(k.greaterThan(0.01).select(float(1), float(0)));
    mat.colorNode = Fn(() => {
      const d = length(uv().sub(0.5)).mul(2);
      const core = pow(clamp(float(1).sub(d), 0, 1), 6).mul(2.2);
      const halo = pow(clamp(float(1).sub(d), 0, 1), 2.2).mul(0.5);
      const soft = clamp(viewportLinearDepth.sub(linearDepth()).mul(cameraFar.sub(cameraNear)).div(0.25), 0, 1);
      return vec4(vec3(0.42, 0.88, 1.0).mul(core.add(halo)).mul(vk.min(2.5)).mul(soft), 1);
    })();
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = this.items.length;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 22;
    this.sprite.name = 'tubeChaseHalos';
    return this.sprite;
  }
}
