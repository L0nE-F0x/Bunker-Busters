import * as THREE from 'three/webgpu';
import { concrete, corrugated, fabric, leather, plainStandard, rustyMetal, wood } from '@/game/world/materials';
import { norm } from '@/game/world/kit';
import { type Pen, type Site, V, HALO } from './townKit';

type Mat = THREE.Material;

/** The town palette. Every entry is a memoized factory call, so equal ones merge into one draw. */
export const M = {
  stucco: () => concrete('#d6c39f', { stains: 0.7 }),
  stuccoWhite: () => concrete('#dedad0', { stains: 0.5 }),
  motel: () => concrete('#dcc6a8', { stains: 0.6 }),
  found: () => concrete('#8e857a', { stains: 0.8 }),
  slab: () => concrete('#a39a8c', { stains: 0.7 }),
  plaster: () => concrete('#cbb894', { stains: 0.35, scale: 2 }),
  plasterGreen: () => concrete('#93ab9c', { stains: 0.3, scale: 2 }),
  plasterWhite: () => concrete('#d0cec4', { stains: 0.3, scale: 2 }),
  wallpaper: () => concrete('#a8916e', { stains: 0.45, scale: 2 }),
  red: () => rustyMetal({ base: '#b8452c', rust: 0.45, metalness: 0.3, roughness: 0.6 }),
  cream: () => rustyMetal({ base: '#ddd3bd', rust: 0.35, metalness: 0.25, roughness: 0.6 }),
  teal: () => rustyMetal({ base: '#2f7c78', rust: 0.4, metalness: 0.3, roughness: 0.55 }),
  coral: () => rustyMetal({ base: '#c4553a', rust: 0.4, metalness: 0.3, roughness: 0.6 }),
  chrome: () => rustyMetal({ base: '#b8b6ae', rust: 0.12, metalness: 0.9, roughness: 0.28 }),
  brass: () => rustyMetal({ base: '#c4a24a', rust: 0.15, metalness: 1, roughness: 0.3 }),
  bronze: () => rustyMetal({ base: '#7a5a32', rust: 0.3, metalness: 0.85, roughness: 0.42 }),
  steel: () => rustyMetal({ base: '#6d6a66', rust: 0.55 }),
  steelDark: () => rustyMetal({ base: '#3b4044', rust: 0.35, metalness: 0.75, roughness: 0.45 }),
  galv: () => rustyMetal({ base: '#9a9a96', rust: 0.4 }),
  drumBlue: () => rustyMetal({ base: '#2d5275', rust: 0.55, metalness: 0.5, roughness: 0.5 }),
  drumRed: () => rustyMetal({ base: '#a3301f', rust: 0.5, metalness: 0.5, roughness: 0.5 }),
  yellow: () => rustyMetal({ base: '#c79a2a', rust: 0.5 }),
  carBlue: () => rustyMetal({ base: '#4a6a7a', rust: 0.75, metalness: 0.4 }),
  carRed: () => rustyMetal({ base: '#8a3a2a', rust: 0.8, metalness: 0.4 }),
  roofRed: () => corrugated('#8d4a3a', 0.62),
  roofGrey: () => corrugated('#8b8a84', 0.7),
  roofGreen: () => corrugated('#6e7a6e', 0.75),
  roofRust: () => corrugated('#7a4a30', 0.9),
  roofBlue: () => corrugated('#5c6e72', 0.8),
  wood: () => wood('#6b4a2e'),
  woodDark: () => wood('#3d2a1c'),
  woodGrey: () => wood('#857464'),
  woodPale: () => wood('#9a7a52'),
  woodRed: () => wood('#6a2e22'),
  woodFloor: () => wood('#5a3e26'),
  dark: () => plainStandard('#121416', 0.15, 0.45),
  black: () => plainStandard('#151311', 0.6),
  rubber: () => plainStandard('#161412', 0.95),
  cable: () => plainStandard('#1a1a1a', 0.6, 0.6),
  tar: () => plainStandard('#2e2a26', 0.95),
  ceiling: () => plainStandard('#bdb29c', 0.95),
  enamel: () => plainStandard('#e2ded2', 0.35, 0.05),
  paper: () => plainStandard('#e8e2d2', 0.9),
  mattress: () => plainStandard('#cfc6b4', 0.92),
  sand: () => plainStandard('#c9a57a', 1),
  glassDark: () => plainStandard('#1c2628', 0.06, 0.6),
  mirror: () => plainStandard('#9aa6a6', 0.08, 0.95),
  solar: () => plainStandard('#18243a', 0.18, 0.35),
  bottleG: () => plainStandard('#3a5a2a', 0.2, 0.1),
  bottleA: () => plainStandard('#7a4a1a', 0.2, 0.1),
  white: () => plainStandard('#d8d4c8', 0.6),
  vinylRed: () => leather('#8a2420'),
  vinylTeal: () => leather('#2f6a66'),
  leatherBrown: () => leather('#4a3020'),
  cardboard: () => fabric('#9c7a52', 0.95),
  canvas: () => fabric('#8a7a58'),
  burlap: () => fabric('#a08860'),
  blanketRed: () => fabric('#7a3030'),
  blanketBlue: () => fabric('#34505e'),
  blanketOlive: () => fabric('#5a5e3a'),
  sheet: () => fabric('#d6d0c0'),
  curtain: () => fabric('#8a6a4a'),
  curtainGreen: () => fabric('#7f9c90'),
};

let _s = 1234567;
export const rnd = () => ((_s = (_s * 16807) % 2147483647) / 2147483647);
export const reseed = (s: number) => { _s = s; };

/** Wooden crate with edge battens. Origin: floor centre. */
export function crate(P: Pen, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0, mat: Mat = M.woodPale(), col = false) {
  const Q = P.sub(x, y, z, ry);
  Q.box(mat, w, h, d, 0, h / 2, 0);
  const bat = M.wood();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) Q.box(bat, 0.05, h + 0.004, 0.05, sx * (w / 2 - 0.02), h / 2, sz * (d / 2 - 0.02));
  for (const sy of [0.04, h - 0.04]) {
    Q.box(bat, w + 0.006, 0.05, 0.05, 0, sy, d / 2 - 0.02).box(bat, w + 0.006, 0.05, 0.05, 0, sy, -d / 2 + 0.02);
  }
  Q.box(bat, w * 0.9, 0.05, 0.02, 0, h / 2, d / 2 + 0.005, 0, 0, Math.atan2(h - 0.1, w) * 0.9);
  if (col) Q.col(0, h / 2, 0, w / 2, h / 2, d / 2);
}

/** Oil drum with rims; `tip` lays it on its side. */
export function drum(P: Pen, x: number, z: number, mat: Mat, ry = 0, tip = false, y0 = 0, col = false) {
  const r = 0.29, h = 0.88;
  const parts = [
    new THREE.CylinderGeometry(r, r, h, 14),
    new THREE.TorusGeometry(r, 0.016, 4, 14).rotateX(Math.PI / 2).translate(0, h / 2 - 0.01, 0),
    new THREE.TorusGeometry(r, 0.016, 4, 14).rotateX(Math.PI / 2).translate(0, -h / 2 + 0.01, 0),
    new THREE.TorusGeometry(r + 0.004, 0.013, 4, 14).rotateX(Math.PI / 2).translate(0, h * 0.17, 0),
    new THREE.TorusGeometry(r + 0.004, 0.013, 4, 14).rotateX(Math.PI / 2).translate(0, -h * 0.17, 0),
    new THREE.CylinderGeometry(0.035, 0.035, 0.02, 8).translate(r * 0.55, h / 2 + 0.005, 0),
  ];
  for (const g of parts) {
    if (tip) P.put(mat, g, x, y0 + r, z, 0, ry, Math.PI / 2);
    else P.put(mat, g, x, y0 + h / 2, z, 0, ry, 0);
  }
  if (col) tip ? P.col(x, y0 + r, z, h / 2, r, r, ry) : P.col(x, y0 + h / 2, z, r, h / 2, r);
}

export function tire(P: Pen, x: number, y: number, z: number, rx = Math.PI / 2, ry = 0, r = 0.34) {
  P.put(M.rubber(), new THREE.TorusGeometry(r, 0.13, 7, 16), x, y, z, rx, ry);
}

export function jerrycan(P: Pen, x: number, y: number, z: number, ry = 0, mat: Mat = M.drumRed()) {
  const Q = P.sub(x, y, z, ry);
  Q.box(mat, 0.17, 0.42, 0.32, 0, 0.21, 0).box(mat, 0.05, 0.05, 0.16, 0, 0.45, -0.04).cyl(mat, 0.025, 0.025, 0.06, 0, 0.45, 0.12, 6);
}

export function sack(P: Pen, x: number, y: number, z: number, ry = 0, mat: Mat = M.burlap(), s = 1) {
  P.put(mat, new THREE.SphereGeometry(0.26, 9, 7), x, y + 0.18 * s, z, 0.1, ry, 0, 0.95 * s, 0.72 * s, 0.62 * s);
  P.put(mat, new THREE.CylinderGeometry(0.05, 0.09, 0.12, 7), x, y + 0.38 * s, z, 0, ry, 0.2, s);
}

export function sandbags(P: Pen, x: number, z: number, len: number, ry: number, rows = 2) {
  const Q = P.sub(x, 0, z, ry);
  const bag = M.canvas();
  for (let r = 0; r < rows; r++) {
    const n = Math.floor(len / 0.5);
    for (let i = 0; i < n; i++) {
      const g = new THREE.CapsuleGeometry(0.13, 0.3, 3, 8);
      Q.put(bag, g, -len / 2 + 0.25 + i * 0.5 + (r % 2) * 0.25, 0.1 + r * 0.17, 0, 0, (rnd() - 0.5) * 0.15, Math.PI / 2, 1, 0.62, 1);
    }
  }
  Q.col(0, rows * 0.09, 0, len / 2, rows * 0.09, 0.15);
}

export function bucket(P: Pen, x: number, y: number, z: number, mat: Mat = M.galv()) {
  P.cyl(mat, 0.15, 0.12, 0.3, x, y + 0.15, z, 10);
  P.put(mat, new THREE.TorusGeometry(0.13, 0.006, 4, 10, Math.PI), x, y + 0.3, z, 0, 0.4, 0);
}

/** Wooden chair; `y0` floor height. */
export function chair(P: Pen, x: number, z: number, ry: number, y0 = 0, mat: Mat = M.wood(), tilt = 0) {
  const Q = P.sub(x, y0, z, ry);
  Q.box(mat, 0.44, 0.04, 0.42, 0, 0.46, 0, 0, tilt);
  for (const [sx, sz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) Q.box(mat, 0.04, 0.46, 0.04, sx, 0.23, sz);
  for (const sx of [-0.19, 0.19]) Q.box(mat, 0.04, 0.5, 0.04, sx, 0.71, -0.19);
  Q.box(mat, 0.42, 0.12, 0.025, 0, 0.88, -0.19).box(mat, 0.42, 0.06, 0.025, 0, 0.66, -0.19);
}

export function lawnChair(P: Pen, x: number, z: number, ry: number, y0 = 0, web: Mat = M.blanketBlue()) {
  const Q = P.sub(x, y0, z, ry);
  const al = M.chrome();
  for (const sx of [-0.25, 0.25]) {
    Q.beam(al, V(sx, 0, 0.3), V(sx, 0.42, -0.05), 0.012, 5).beam(al, V(sx, 0, -0.25), V(sx, 0.4, 0.22), 0.012, 5);
    Q.beam(al, V(sx, 0.4, 0.22), V(sx, 0.38, -0.2), 0.012, 5).beam(al, V(sx, 0.38, -0.2), V(sx, 0.95, -0.38), 0.012, 5);
    Q.beam(al, V(sx, 0.62, 0.15), V(sx, 0.62, -0.25), 0.012, 5);
  }
  Q.box(web, 0.5, 0.02, 0.42, 0, 0.38, 0.0, 0, 0.05);
  Q.box(web, 0.5, 0.56, 0.02, 0, 0.67, -0.29, 0, -0.33);
}

/** Simple table: top + 4 legs. */
export function table(P: Pen, x: number, z: number, w: number, d: number, h: number, ry = 0, y0 = 0, top: Mat = M.wood(), legs: Mat = M.woodDark(), col = true) {
  const Q = P.sub(x, y0, z, ry);
  Q.box(top, w, 0.045, d, 0, h - 0.022, 0);
  Q.box(legs, w - 0.1, 0.08, 0.025, 0, h - 0.085, d / 2 - 0.06).box(legs, w - 0.1, 0.08, 0.025, 0, h - 0.085, -d / 2 + 0.06);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) Q.box(legs, 0.05, h - 0.045, 0.05, sx * (w / 2 - 0.06), (h - 0.045) / 2, sz * (d / 2 - 0.06));
  if (col) Q.col(0, h / 2, 0, w / 2, h / 2, d / 2);
}

/** Bed with frame, mattress, pillows and a blanket that hangs over one side. */
export function bed(P: Pen, x: number, z: number, ry: number, y0: number, blanket: Mat, o: { w?: number; messy?: boolean; col?: boolean } = {}) {
  const w = o.w ?? 1.4, L = 2.0;
  const Q = P.sub(x, y0, z, ry);
  const frame = M.woodDark();
  // headboard at -z
  Q.box(frame, w + 0.1, 1.05, 0.07, 0, 0.53, -L / 2 - 0.03);
  Q.box(frame, w + 0.16, 0.06, 0.1, 0, 1.07, -L / 2 - 0.03);
  Q.box(frame, w + 0.06, 0.5, 0.06, 0, 0.25, L / 2 + 0.02);
  for (const sx of [-1, 1]) Q.box(frame, 0.06, 0.24, L, sx * (w / 2 + 0.01), 0.27, 0);
  Q.box(M.mattress(), w - 0.02, 0.22, L - 0.04, 0, 0.47, 0, 0, o.messy ? 0.03 : 0, o.messy ? 0.04 : 0);
  for (const sx of [-0.33, 0.33]) Q.put(M.sheet(), new THREE.SphereGeometry(0.3, 10, 6), sx * w / 1.4, 0.62, -L / 2 + 0.22, 0, (rnd() - 0.5) * 0.3, 0, 0.95, 0.22, 0.48);
  // blanket: top sheet + a fold + the drop over the side
  const bz = 0.18;
  Q.box(blanket, w + 0.04, 0.05, L * 0.66, 0, 0.6, bz, o.messy ? 0.06 : 0, o.messy ? 0.12 : 0);
  Q.box(blanket, w + 0.05, 0.07, 0.18, 0, 0.62, bz - L * 0.33 + 0.08);
  Q.box(blanket, 0.04, 0.32, L * 0.62, w / 2 + 0.03, 0.46, bz + 0.02, 0, 0, 0.08);
  Q.box(blanket, 0.04, 0.3, L * 0.62, -w / 2 - 0.03, 0.47, bz + 0.02, 0, 0, -0.08);
  if (o.col !== false) Q.col(0, 0.35, 0, w / 2 + 0.06, 0.35, L / 2 + 0.06);
}

/** Bedside table with a lamp whose shade glows. Returns the shade centre (site space). */
export function nightstand(P: Pen, x: number, z: number, ry: number, y0: number, shade: Mat) {
  const Q = P.sub(x, y0, z, ry);
  Q.box(M.wood(), 0.46, 0.55, 0.4, 0, 0.275, 0).box(M.woodDark(), 0.4, 0.15, 0.01, 0, 0.38, 0.2);
  Q.box(M.brass(), 0.04, 0.02, 0.01, 0, 0.38, 0.21);
  Q.cyl(M.brass(), 0.07, 0.09, 0.04, -0.05, 0.57, 0, 10).cyl(M.brass(), 0.015, 0.015, 0.3, -0.05, 0.74, 0, 6);
  Q.cyl(shade, 0.1, 0.16, 0.2, -0.05, 0.92, 0, 12);
  return Q.p(-0.05, 0.9, 0);
}

export function crt(P: Pen, x: number, y: number, z: number, ry: number, screen: Mat) {
  const Q = P.sub(x, y, z, ry);
  const body = plainStandard('#3a3632', 0.55);
  Q.box(body, 0.56, 0.46, 0.45, 0, 0.23, -0.02).box(body, 0.4, 0.34, 0.2, 0, 0.21, -0.3);
  Q.box(screen, 0.42, 0.33, 0.02, -0.04, 0.25, 0.205);
  Q.box(M.black(), 0.06, 0.2, 0.02, 0.22, 0.25, 0.205);
  Q.beam(M.chrome(), V(-0.05, 0.46, -0.1), V(-0.2, 0.72, -0.12), 0.005, 4).beam(M.chrome(), V(0.05, 0.46, -0.1), V(0.22, 0.7, -0.08), 0.005, 4);
}

export function dresser(P: Pen, x: number, z: number, ry: number, y0: number, w = 1.1) {
  const Q = P.sub(x, y0, z, ry);
  Q.box(M.wood(), w, 0.8, 0.48, 0, 0.4, 0);
  for (let i = 0; i < 3; i++) {
    Q.box(M.woodDark(), w - 0.08, 0.22, 0.01, 0, 0.15 + i * 0.25, 0.245);
    for (const sx of [-w / 4, w / 4]) Q.box(M.brass(), 0.07, 0.02, 0.02, sx, 0.15 + i * 0.25, 0.255);
  }
  Q.col(0, 0.4, 0, w / 2, 0.4, 0.24);
}

/** Wooden shelf unit. Returns shelf heights and a local→site mapper for stocking. */
export function shelves(P: Pen, x: number, z: number, w: number, d: number, h: number, ry: number, y0: number, levels: number, mat: Mat = M.wood(), back = true) {
  const Q = P.sub(x, y0, z, ry);
  for (const sx of [-1, 1]) Q.box(mat, 0.04, h, d, sx * (w / 2 - 0.02), h / 2, 0);
  if (back) Q.box(M.woodDark(), w, h, 0.02, 0, h / 2, -d / 2 + 0.01);
  const ys: number[] = [];
  for (let i = 0; i < levels; i++) {
    const y = 0.08 + (i * (h - 0.16)) / (levels - 1);
    ys.push(y);
    Q.box(mat, w - 0.06, 0.03, d, 0, y, 0);
  }
  Q.box(mat, w, 0.06, d + 0.02, 0, h, 0);
  Q.col(0, h / 2, 0, w / 2, h / 2, d / 2);
  return { Q, ys, w, d };
}

/** Fill shelves with general-store goods: cans, jars, bottles, boxes, folded cloth, rope. */
export function stock(S: { Q: Pen; ys: number[]; w: number; d: number }, density = 1, skipTop = false) {
  const { Q, ys, w, d } = S;
  const cans = [rustyMetal({ base: '#b9b5a8', rust: 0.4, metalness: 0.8, roughness: 0.4 }), M.drumRed(), M.yellow()];
  ys.forEach((y, li) => {
    if (skipTop && li === ys.length - 1) return;
    let lx = -w / 2 + 0.08;
    while (lx < w / 2 - 0.16) {
      const k = Math.floor(rnd() * 7);
      if (rnd() > density) { lx += 0.2; continue; }
      if (k === 0) { // can stack
        const m = cans[Math.floor(rnd() * 3)];
        for (let i = 0; i < 3; i++) Q.cyl(m, 0.04, 0.04, 0.11, lx + 0.05 + i * 0.09, y + 0.07, (rnd() - 0.5) * d * 0.4, 8);
        if (rnd() < 0.5) Q.cyl(m, 0.04, 0.04, 0.11, lx + 0.1, y + 0.18, 0, 8);
        lx += 0.3;
      } else if (k === 1) { // jars
        for (let i = 0; i < 2; i++) { Q.cyl(M.bottleA(), 0.05, 0.05, 0.14, lx + 0.06 + i * 0.11, y + 0.085, 0, 9); Q.cyl(M.galv(), 0.051, 0.051, 0.025, lx + 0.06 + i * 0.11, y + 0.165, 0, 9); }
        lx += 0.24;
      } else if (k === 2) { // bottles
        for (let i = 0; i < 3; i++) { const m = rnd() < 0.5 ? M.bottleG() : M.bottleA(); Q.cyl(m, 0.035, 0.035, 0.2, lx + 0.04 + i * 0.08, y + 0.115, 0, 7); Q.cyl(m, 0.012, 0.02, 0.07, lx + 0.04 + i * 0.08, y + 0.25, 0, 5); }
        lx += 0.26;
      } else if (k === 3) { // carton
        const cw = 0.24 + rnd() * 0.2, ch = 0.16 + rnd() * 0.16;
        Q.box(M.cardboard(), cw, ch, d * 0.8, lx + cw / 2, y + 0.015 + ch / 2, 0, (rnd() - 0.5) * 0.1);
        lx += cw + 0.03;
      } else if (k === 4) { // folded cloth
        const m = [M.blanketRed(), M.blanketBlue(), M.blanketOlive(), M.canvas()][Math.floor(rnd() * 4)];
        for (let i = 0; i < 3; i++) Q.box(m, 0.3, 0.05, d * 0.75, lx + 0.15, y + 0.04 + i * 0.05, 0, (rnd() - 0.5) * 0.1);
        lx += 0.34;
      } else if (k === 5) { // rope coil
        Q.put(M.burlap(), new THREE.TorusGeometry(0.1, 0.03, 6, 12), lx + 0.12, y + 0.045, 0, Math.PI / 2, 0, 0);
        lx += 0.26;
      } else { // tins
        Q.box(M.drumBlue(), 0.16, 0.1, 0.16, lx + 0.09, y + 0.065, 0, rnd() * 0.3);
        lx += 0.2;
      }
    }
  });
}

/** Pot-bellied stove with a stovepipe to `pipeTop`. Returns the firebox centre (pen space). */
export function stove(P: Pen, x: number, z: number, y0: number, pipeTop: number, ember: Mat) {
  const Q = P.sub(x, y0, z);
  const iron = rustyMetal({ base: '#2a2826', rust: 0.35, metalness: 0.7, roughness: 0.6 });
  for (const [sx, sz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) Q.box(iron, 0.05, 0.22, 0.05, sx, 0.11, sz);
  Q.cyl(iron, 0.26, 0.24, 0.12, 0, 0.27, 0, 14);
  Q.put(iron, new THREE.SphereGeometry(0.3, 14, 10), 0, 0.6, 0, 0, 0, 0, 1, 1.15, 1);
  Q.cyl(iron, 0.22, 0.28, 0.12, 0, 0.98, 0, 14).cyl(iron, 0.18, 0.18, 0.06, 0, 1.06, 0, 14);
  Q.box(iron, 0.22, 0.18, 0.04, 0, 0.58, 0.31);
  Q.box(ember, 0.16, 0.06, 0.02, 0, 0.53, 0.325);
  Q.cyl(iron, 0.075, 0.075, pipeTop - y0 - 1.1, 0, 1.1 + (pipeTop - y0 - 1.1) / 2, 0, 10);
  Q.col(0, 0.55, 0, 0.32, 0.55, 0.32);
  return Q.p(0, 0.55, 0.33);
}

/** Lantern hanging from a hook; glass glows. */
export function lantern(P: Pen, x: number, y: number, z: number, glass: Mat) {
  const Q = P.sub(x, y, z);
  const tin = rustyMetal({ base: '#4a4640', rust: 0.5, metalness: 0.6 });
  Q.cyl(tin, 0.07, 0.08, 0.03, 0, -0.2, 0, 10).cyl(glass, 0.055, 0.055, 0.14, 0, -0.11, 0, 10).put(tin, new THREE.ConeGeometry(0.08, 0.07, 10), 0, -0.01, 0);
  for (let i = 0; i < 4; i++) Q.box(tin, 0.008, 0.16, 0.008, Math.cos(i * 1.57) * 0.068, -0.11, Math.sin(i * 1.57) * 0.068);
  Q.put(tin, new THREE.TorusGeometry(0.035, 0.005, 4, 8), 0, 0.05, 0, 0, 0, 0);
}

/** Window AC unit sticking out of a wall facing `ry`. */
export function acUnit(P: Pen, x: number, y: number, z: number, ry: number) {
  const Q = P.sub(x, y, z, ry);
  const g = M.galv();
  Q.box(g, 0.66, 0.42, 0.5, 0, 0, 0.15);
  for (let i = 0; i < 6; i++) Q.box(M.steelDark(), 0.58, 0.015, 0.02, 0, -0.15 + i * 0.06, 0.41);
  Q.box(g, 0.7, 0.04, 0.08, 0, -0.24, 0.38, 0, 0.3);
  Q.beam(M.steelDark(), V(-0.3, -0.21, 0.36), V(-0.3, -0.5, 0.0), 0.012, 4).beam(M.steelDark(), V(0.3, -0.21, 0.36), V(0.3, -0.5, 0.0), 0.012, 4);
}

/** Swamp cooler on a roof. */
export function swampCooler(P: Pen, x: number, y: number, z: number, ry: number) {
  const Q = P.sub(x, y, z, ry);
  const g = M.galv();
  Q.box(g, 1.1, 0.9, 1.1, 0, 0.5, 0).box(g, 1.2, 0.06, 1.2, 0, 0.98, 0).box(M.steelDark(), 1.0, 0.06, 1.0, 0, 0.03, 0);
  for (const s of [-1, 1]) for (let i = 0; i < 7; i++) Q.box(M.steelDark(), 0.9, 0.02, 0.03, 0, 0.2 + i * 0.1, s * 0.56, s * 0.5);
  Q.box(g, 0.5, 0.4, 0.8, 0, 0.25, -0.95).box(g, 0.45, 0.45, 0.45, 0, -0.1, -1.2);
}

export function dish(P: Pen, x: number, y: number, z: number, ry: number, r = 0.45) {
  const Q = P.sub(x, y, z, ry);
  const m = rustyMetal({ base: '#d9d4c8', rust: 0.45, metalness: 0.4 });
  Q.cyl(M.steelDark(), 0.03, 0.03, 0.6, 0, 0.3, 0, 6);
  Q.put(m, new THREE.SphereGeometry(r, 16, 6, 0, Math.PI * 2, 0, 0.6), 0, 0.65, 0.05, -1.1, 0, 0);
  Q.beam(M.steelDark(), V(0, 0.65, 0.1), V(0, 0.85, 0.5), 0.01, 4);
  Q.box(M.steelDark(), 0.06, 0.08, 0.06, 0, 0.87, 0.52);
}

export function solarPanel(P: Pen, x: number, y: number, z: number, ry: number, w = 1.0, l = 1.6, tilt = 0.45) {
  const Q = P.sub(x, y, z, ry);
  Q.box(M.solar(), w, 0.04, l, 0, 0.5, 0, 0, tilt);
  Q.box(M.galv(), w + 0.04, 0.05, 0.04, 0, 0.5 + Math.sin(tilt) * l / 2, Math.cos(tilt) * l / 2 * -1, 0, tilt);
  for (let i = 1; i < 4; i++) Q.box(M.galv(), 0.012, 0.045, l, -w / 2 + (i * w) / 4, 0.505, 0, 0, tilt);
  for (let i = 1; i < 6; i++) { const t = -l / 2 + (i * l) / 6; Q.box(M.galv(), w, 0.045, 0.012, 0, 0.505 - Math.sin(tilt) * t, Math.cos(tilt) * t, 0, tilt); }
  Q.box(M.steelDark(), 0.05, 0.5 + Math.sin(tilt) * l / 2, 0.05, -w / 2, (0.5 + Math.sin(tilt) * l / 2) / 2, -Math.cos(tilt) * l / 2 + 0.05);
  Q.box(M.steelDark(), 0.05, 0.5 + Math.sin(tilt) * l / 2, 0.05, w / 2, (0.5 + Math.sin(tilt) * l / 2) / 2, -Math.cos(tilt) * l / 2 + 0.05);
  Q.box(M.steelDark(), 0.05, 0.5 - Math.sin(tilt) * l / 2 + 0.05, 0.05, -w / 2, 0.25, Math.cos(tilt) * l / 2 - 0.05);
  Q.box(M.steelDark(), 0.05, 0.5 - Math.sin(tilt) * l / 2 + 0.05, 0.05, w / 2, 0.25, Math.cos(tilt) * l / 2 - 0.05);
}

/** Vent stack with a rain cap. */
export function vent(P: Pen, x: number, y: number, z: number, r = 0.08, h = 0.8) {
  P.cyl(M.galv(), r, r, h, x, y + h / 2, z, 8).cyl(M.galv(), r * 1.9, r * 1.9, 0.04, x, y + h + 0.1, z, 8).cyl(M.galv(), 0.01, 0.01, 0.1, x, y + h + 0.05, z, 4);
}

/** Wooden utility pole with a crossarm and insulators. Returns the three wire anchors (site space). */
export function utilityPole(site: Site, x: number, z: number, h = 8.2, ry = 0) {
  const P = site.pen(x, 0, z, ry);
  const timber = wood('#4a3626');
  P.cyl(timber, 0.11, 0.14, h, 0, h / 2, 0, 8);
  P.box(timber, 2.0, 0.12, 0.12, 0, h - 0.5, 0);
  P.beam(M.steelDark(), V(-0.6, h - 0.55, 0), V(0, h - 1.2, 0), 0.02, 4).beam(M.steelDark(), V(0.6, h - 0.55, 0), V(0, h - 1.2, 0), 0.02, 4);
  const ins = plainStandard('#d8d4c4', 0.3);
  const anchors: THREE.Vector3[] = [];
  for (const sx of [-0.85, 0, 0.85]) {
    P.cyl(ins, 0.04, 0.05, 0.14, sx, h - 0.37, 0, 7);
    anchors.push(P.p(sx, h - 0.3, 0));
  }
  // climbing steps
  for (let i = 0; i < 10; i++) P.box(M.steelDark(), 0.22, 0.02, 0.02, (i % 2 ? 1 : -1) * 0.12, 2.0 + i * 0.5, 0, (i % 2) * Math.PI / 2);
  site.col(x, h / 2, z, 0.14, h / 2, 0.14);
  return anchors;
}

/** A 70s sedan shell (side profile extruded), sunk on flat tyres. Long axis along local Z. */
export function sedan(site: Site, x: number, z: number, ry: number, paint: Mat) {
  const P = site.pen(x, 0, z, ry);
  const s = new THREE.Shape();
  const L = 4.6;
  s.moveTo(-L / 2, 0.35); s.lineTo(-L / 2, 0.85); s.lineTo(-L / 2 + 0.15, 0.95); s.lineTo(-1.0, 1.0); s.lineTo(-0.55, 1.42);
  s.lineTo(0.75, 1.42); s.lineTo(1.2, 1.0); s.lineTo(L / 2 - 0.1, 0.92); s.lineTo(L / 2, 0.75); s.lineTo(L / 2, 0.35);
  s.lineTo(1.75, 0.35); s.absarc(1.35, 0.35, 0.42, 0, Math.PI, false); s.lineTo(-0.95, 0.35); s.absarc(-1.35, 0.35, 0.42, 0, Math.PI, false); s.lineTo(-L / 2, 0.35);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.7, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, -0.12, -0.85);
  P.put(paint, g, 0, 0, 0, 0, Math.PI / 2, 0);
  // glass (dark, one window smashed out) and chrome
  P.box(M.glassDark(), 1.62, 0.34, 0.9, 0, 1.12, 0.12, 0, 0, 0);
  P.box(M.glassDark(), 1.5, 0.4, 0.05, 0, 1.1, -0.82, -0.75).box(M.glassDark(), 1.5, 0.38, 0.05, 0, 1.08, 1.07, 0.8);
  P.box(M.chrome(), 1.9, 0.12, 0.1, 0, 0.42, 2.38).box(M.chrome(), 1.9, 0.12, 0.1, 0, 0.42, -2.36);
  for (const sz of [-1.35, 1.35]) for (const sx of [-0.84, 0.84]) {
    P.put(M.rubber(), new THREE.TorusGeometry(0.27, 0.12, 6, 14), sx, 0.24, sz, 0, Math.PI / 2, 0, 1, 0.82, 1);
    P.cyl(M.steelDark(), 0.16, 0.16, 0.2, sx * 1.02, 0.25, sz, 10, 0, 0, Math.PI / 2);
  }
  P.sign('plate', 0.36, 0.18, 0.02, 0, 0.62, -2.42, Math.PI);
  P.col(0, 0.7, 0, 0.92, 0.7, 2.35);
}

/** An old pickup with junk in the bed. Long axis along local Z. */
export function pickup(site: Site, x: number, z: number, ry: number, paint: Mat) {
  const P = site.pen(x, 0, z, ry);
  P.box(paint, 1.86, 0.62, 1.7, 0, 0.82, 1.45).box(paint, 1.82, 0.2, 1.68, 0, 0.6, 1.45);
  P.box(paint, 1.8, 0.7, 1.5, 0, 1.28, 0.25).box(paint, 1.84, 0.1, 1.4, 0, 1.67, 0.25);
  P.box(M.glassDark(), 1.6, 0.48, 0.05, 0, 1.36, 1.0, -0.3).box(M.glassDark(), 0.05, 0.4, 1.0, 0.91, 1.36, 0.25).box(M.glassDark(), 0.05, 0.4, 1.0, -0.91, 1.36, 0.25);
  // bed
  P.box(paint, 1.86, 0.08, 2.2, 0, 0.62, -1.4);
  for (const sx of [-0.9, 0.9]) P.box(paint, 0.06, 0.5, 2.2, sx, 0.9, -1.4);
  P.box(paint, 1.86, 0.5, 0.06, 0, 0.9, -2.48, 0.25);
  P.box(M.chrome(), 1.95, 0.16, 0.12, 0, 0.55, 2.35);
  P.box(M.black(), 1.6, 0.32, 0.03, 0, 0.92, 2.31);
  for (const sz of [-1.6, 1.4]) for (const sx of [-0.85, 0.85]) {
    P.put(M.rubber(), new THREE.TorusGeometry(0.3, 0.13, 6, 14), sx, 0.33, sz, 0, Math.PI / 2, 0);
    P.cyl(M.steelDark(), 0.18, 0.18, 0.22, sx * 1.02, 0.33, sz, 10, 0, 0, Math.PI / 2);
  }
  // junk: tyres, a drum, a crate, a tarp
  tire(P, -0.4, 0.75, -1.9, Math.PI / 2, 0.2, 0.3);
  tire(P, -0.4, 0.98, -1.85, Math.PI / 2, 0.5, 0.3);
  drum(P, 0.45, -0.9, M.drumBlue(), 0.4, false, 0.66);
  crate(P, 0.35, 0.66, -2.0, 0.55, 0.42, 0.45, 0.3);
  P.box(M.canvas(), 0.9, 0.08, 0.8, -0.35, 0.86, -0.85, 0.2, 0.15, 0.1);
  P.col(0, 0.85, 0, 0.95, 0.85, 2.45);
}

/** A soft heap of windblown sand against something, along local X. */
export function drift(P: Pen, x: number, z: number, len: number, ry: number, h = 0.35, depth = 0.8) {
  const g = new THREE.CylinderGeometry(1, 1, len, 10, 1, false, 0, Math.PI);
  g.rotateZ(Math.PI / 2);
  P.put(M.sand(), g, x, 0, z, 0, ry, 0, 1, h, depth);
}

/** Sitting log. */
export function log(P: Pen, x: number, z: number, len: number, ry: number, r = 0.22, col = true) {
  const bark = wood('#4a3424');
  P.cyl(bark, r, r * 1.05, len, x, r, z, 9, 0, ry, Math.PI / 2);
  P.cyl(wood('#9a7a52'), r * 0.92, r * 0.92, 0.02, x + Math.cos(ry) * len / 2, r, z - Math.sin(ry) * len / 2, 9, 0, ry, Math.PI / 2);
  if (col) P.col(x, r, z, len / 2, r, r, ry);
}

/** An acoustic guitar standing on its end, leaned back by `lean` (authored upright, face +z). */
export function guitar(P: Pen, x: number, y: number, z: number, ry: number, lean = 0.25) {
  const body = wood('#8a5a2a');
  const m = new THREE.Matrix4().compose(V(0, 0, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(-lean, 0, 0)), V(1, 1, 1));
  const parts: [Mat, THREE.BufferGeometry][] = [
    [body, new THREE.CylinderGeometry(0.19, 0.19, 0.1, 16).rotateX(Math.PI / 2).translate(0, 0.2, 0)],
    [body, new THREE.CylinderGeometry(0.15, 0.15, 0.1, 16).rotateX(Math.PI / 2).translate(0, 0.44, 0)],
    [M.black(), new THREE.CircleGeometry(0.05, 12).translate(0, 0.34, 0.052)],
    [M.woodDark(), new THREE.BoxGeometry(0.05, 0.5, 0.03).translate(0, 0.82, 0.02)],
    [M.woodDark(), new THREE.BoxGeometry(0.08, 0.16, 0.03).translate(0, 1.14, 0.015)],
    [M.woodDark(), new THREE.BoxGeometry(0.1, 0.025, 0.02).translate(0, 0.12, 0.055)],
  ];
  const Q = P.sub(x, y, z, ry);
  for (const [mat, g] of parts) Q.geo(mat, norm(g.applyMatrix4(m)));
}

/** A wall sconce: plate + shade + glowing bulb, its halo, and a pool of light below. */
export function sconce(site: Site, P: Pen, x: number, y: number, z: number, glowMat: Mat, poolSize = 2.4, floorY = 0.05) {
  P.box(M.brass(), 0.1, 0.16, 0.03, x, y, z + 0.015);
  P.put(glowMat, new THREE.SphereGeometry(0.075, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.62), x, y + 0.02, z + 0.1, Math.PI, 0, 0);
  P.cyl(M.brass(), 0.04, 0.06, 0.05, x, y + 0.05, z + 0.1, 8);
  const c = P.p(x, y - 0.02, z + 0.12);
  site.halo(c.x, c.y, c.z, '#ffc890', 0.6, HALO.NIGHT, 1.4);
  if (poolSize > 0) P.pool('poolWarm', poolSize, poolSize, x, floorY, z + poolSize * 0.3);
}

/** Folded clothes and sheets on a line between a and b (site space). */
export function laundry(site: Site, a: THREE.Vector3, b: THREE.Vector3, sag: number) {
  const P = site.pen();
  P.wire(M.cable(), a, b, sag, 0.006, 16);
  const items: [Mat, number, number][] = [[M.sheet(), 1.1, 1.0], [M.blanketRed(), 0.5, 0.6], [M.blanketBlue(), 0.45, 0.65], [M.canvas(), 0.7, 0.5], [M.sheet(), 0.9, 1.1], [M.curtainGreen(), 0.5, 0.7]];
  const len = a.distanceTo(b);
  const ry = Math.atan2(-(b.z - a.z), b.x - a.x);
  let s = 0.6;
  for (const [m, w, h] of items) {
    if (s + w > len - 0.4) break;
    const t = (s + w / 2) / len;
    const p = a.clone().lerp(b, t);
    p.y -= sag * 4 * t * (1 - t);
    P.box(m, w, h, 0.015, p.x, p.y - h / 2 + 0.02, p.z, ry, 0.05 * (rnd() - 0.5), 0.04 * (rnd() - 0.5));
    for (const e of [-w / 2 + 0.04, w / 2 - 0.04]) P.box(M.woodPale(), 0.02, 0.07, 0.025, p.x + Math.cos(ry) * e, p.y + 0.01, p.z - Math.sin(ry) * e, ry);
    s += w + 0.25;
  }
}

export function payphone(P: Pen, x: number, y: number, z: number, ry: number) {
  const Q = P.sub(x, y, z, ry);
  Q.box(M.steelDark(), 0.42, 0.9, 0.2, 0, 1.45, 0.1).box(M.chrome(), 0.34, 0.5, 0.02, 0, 1.45, 0.21);
  Q.box(M.black(), 0.08, 0.26, 0.1, -0.24, 1.5, 0.18);
  Q.wire(M.cable(), V(-0.24, 1.36, 0.2), V(-0.05, 1.25, 0.22), 0.25, 0.008, 8);
  Q.box(M.steelDark(), 0.6, 0.06, 0.32, 0, 2.0, 0.16);
}

/** A cairn of flat stones. */
export function cairn(P: Pen, x: number, y: number, z: number, h: number, mat: Mat) {
  let yy = y;
  let r = 0.32;
  let i = 0;
  while (yy < y + h) {
    const s = r * (0.9 + rnd() * 0.25);
    const g = new THREE.DodecahedronGeometry(1, 0);
    P.put(mat, g, x + (rnd() - 0.5) * 0.06, yy + s * 0.32, z + (rnd() - 0.5) * 0.06, rnd(), rnd() * 6, rnd(), s, s * 0.4, s * (0.8 + rnd() * 0.3));
    yy += s * 0.55;
    r *= 0.86;
    if (++i > 9) break;
  }
}

export { norm };
