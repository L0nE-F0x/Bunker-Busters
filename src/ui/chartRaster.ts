/**
 * The world map sheet's pixels: hypsometric tint, hillshade from the north-west, contour lines
 * (5 m, every fifth one heavier). Pure (no DOM, no imports) so it runs in a worker (chartWorker.ts)
 * while the game boots, or on the main thread as a fallback. mapChart.ts adds the roads, the wash
 * and the grid on top.
 */

export interface ChartInput { heights: Float32Array; res: number; step: number; size: number; N: number }

// elevation stops (metres → warm survey-sheet tints, dark enough for the markers to pop)
const STOPS: [number, number, number, number][] = [
  [-9, 34, 36, 34],
  [-3, 50, 42, 33],
  [4, 64, 49, 35],
  [14, 78, 59, 40],
  [26, 93, 70, 46],
  [40, 104, 82, 58],
  [70, 98, 88, 78],
  [130, 128, 120, 110],
];

function tint(h: number, out: number[]) {
  if (h <= STOPS[0][0]) { out[0] = STOPS[0][1]; out[1] = STOPS[0][2]; out[2] = STOPS[0][3]; return; }
  for (let i = 1; i < STOPS.length; i++) {
    const b = STOPS[i];
    if (h <= b[0]) {
      const a = STOPS[i - 1];
      const t = (h - a[0]) / (b[0] - a[0]);
      out[0] = a[1] + (b[1] - a[1]) * t; out[1] = a[2] + (b[2] - a[2]) * t; out[2] = a[3] + (b[3] - a[3]) * t;
      return;
    }
  }
  const l = STOPS[STOPS.length - 1];
  out[0] = l[1]; out[1] = l[2]; out[2] = l[3];
}

/** Heightfield.heightAt on the raw grid (same bilinear triangle split). */
function gridHeight(c: ChartInput, x: number, z: number) {
  const { res, step, size, heights } = c;
  const fx = Math.min(res - 1.001, Math.max(0, (x + size / 2) / step));
  const fz = Math.min(res - 1.001, Math.max(0, (z + size / 2) / step));
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const i = iz * res + ix;
  const h00 = heights[i], h10 = heights[i + 1], h01 = heights[i + res], h11 = heights[i + res + 1];
  if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
  return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
}

export function rasterChart(c: ChartInput): Uint8ClampedArray {
  const { N, size } = c;
  const m = size / N; // metres per pixel
  const H = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const wz = ((y + 0.5) / N - 0.5) * size;
    for (let x = 0; x < N; x++) H[y * N + x] = gridHeight(c, ((x + 0.5) / N - 0.5) * size, wz);
  }
  const d = new Uint8ClampedArray(N * N * 4);
  // light from the north-west, a little vertical exaggeration so the dunes read
  const lx = -0.55, ly = 0.62, lz = -0.55, ex = 1.6;
  const col = [0, 0, 0];
  for (let y = 0; y < N; y++) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(N - 1, y + 1);
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const x0 = Math.max(0, x - 1), x1 = Math.min(N - 1, x + 1);
      const h = H[i];
      const gx = (H[y * N + x1] - H[y * N + x0]) / ((x1 - x0) * m);
      const gz = (H[y1 * N + x] - H[y0 * N + x]) / ((y1 - y0) * m);
      const nx = -gx * ex, nz = -gz * ex, inv = 1 / Math.hypot(nx, 1, nz);
      const shade = Math.max(0, (nx * lx + ly + nz * lz) * inv);
      tint(h, col);
      // flat ground sits near its tint; slopes swing both ways
      let k = 0.48 + shade * 1.0;
      // paper grain
      const g = ((x * 73856093) ^ (y * 19349663)) & 1023;
      k *= 0.975 + (g / 1023) * 0.05;
      let r = col[0] * k, gg = col[1] * k, b = col[2] * k;
      // contours: a pixel whose 5 m band differs from its right or lower neighbour sits on a line
      const band = Math.floor(h / 5);
      const br = x < N - 1 ? Math.floor(H[i + 1] / 5) : band;
      const bd = y < N - 1 ? Math.floor(H[i + N] / 5) : band;
      if (band !== br || band !== bd) {
        const top = Math.max(band, br, bd);
        const steep = Math.hypot(gx, gz);
        if (top % 5 === 0) {
          // index contour: a warm ink line
          r = r * 0.45 + 205 * 0.55; gg = gg * 0.45 + 140 * 0.55; b = b * 0.45 + 72 * 0.55;
        } else if (steep < 1.4) {
          // minor contour, dropped on cliffs where they'd merge into mush
          const a = 0.32 * (1 - steep / 1.4);
          r = r * (1 - a) + 196 * a; gg = gg * (1 - a) + 146 * a; b = b * (1 - a) + 90 * a;
        }
      }
      d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
    }
  }
  return d;
}
