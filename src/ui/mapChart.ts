import type { Heightfield } from '@/game/world/Heightfield';
import { HIGHWAY, SIDE_ROADS, CAVE_TRAIL, SALT_FLAT } from '@/content/world';
import { rasterChart, type ChartInput } from './chartRaster';

/**
 * The world map's base sheet, drawn once from the heightfield: hypsometric tint, hillshade from the
 * north-west, contour lines (5 m, every fifth one heavier), the dry wash as an intermittent stream,
 * the highway, the dirt tracks and the trail up to The Cut. Labels, fog and markers are drawn live
 * on top by the map view, so they stay crisp at any zoom.
 */

export const CHART_N = 1536;

export function chartInput(hf: Heightfield, N = CHART_N): ChartInput {
  return { heights: hf.heights.slice(), res: hf.res, step: hf.step, size: hf.size, N };
}

/** Synchronous fallback: raster on this thread, then finish. */
export function renderChart(hf: Heightfield, N = CHART_N): HTMLCanvasElement {
  const t0 = performance.now();
  const c = finishChart(rasterChart(chartInput(hf, N)), N, hf);
  console.log(`[map] chart ${N}² on the main thread in ${(performance.now() - t0).toFixed(0)} ms`);
  return c;
}

/** The raster from chartRaster plus the vector layer: the wash, the tracks, the trail, the highway, the grid. */
export function finishChart(px: Uint8ClampedArray, N: number, hf: Heightfield): HTMLCanvasElement {
  const size = hf.size;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, N, N), 0, 0);

  const P = (wx: number, wz: number): [number, number] => [(wx / size + 0.5) * N, (wz / size + 0.5) * N];
  const k = N / 1024; // line widths are authored for a 1024 sheet
  const path = (pts: [number, number][]) => {
    ctx.beginPath();
    pts.forEach(([x, z], j) => { const [px, py] = P(x, z); if (j) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // the dry wash: a stippled bed with a dashed blue line down the middle (an intermittent stream)
  const wash: [number, number][] = [];
  for (let z = -size / 2; z <= size / 2; z += 4) wash.push([hf.washX(z), z]);
  path(wash);
  ctx.strokeStyle = 'rgba(40, 52, 58, 0.35)';
  ctx.lineWidth = 9 * k;
  ctx.stroke();
  ctx.setLineDash([9 * k, 5 * k]);
  ctx.strokeStyle = 'rgba(120, 178, 196, 0.75)';
  ctx.lineWidth = 1.6 * k;
  ctx.stroke();
  ctx.setLineDash([]);

  // the salt: a pale crust with a soft shore, and its name in the lettering maps give water
  {
    const [sx, sy] = P(SALT_FLAT.x, SALT_FLAT.z);
    const r0 = (SALT_FLAT.r / size) * N, r1 = ((SALT_FLAT.r + SALT_FLAT.falloff * 0.5) / size) * N;
    const g = ctx.createRadialGradient(sx, sy, r0 * 0.2, sx, sy, r1);
    g.addColorStop(0, 'rgba(214, 206, 186, 0.5)');
    g.addColorStop(r0 / r1, 'rgba(200, 192, 172, 0.4)');
    g.addColorStop(1, 'rgba(200, 192, 172, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(sx, sy, r1, 0, Math.PI * 2); ctx.fill();
    // polygon cracks in the crust
    ctx.strokeStyle = 'rgba(120, 110, 92, 0.35)';
    ctx.lineWidth = 0.8 * (N / 1024);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 26; n++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r0 * 0.9;
      let x = sx + Math.cos(a) * d, y = sy + Math.sin(a) * d;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 3; k++) { x += (rnd() - 0.5) * r0 * 0.35; y += (rnd() - 0.5) * r0 * 0.35; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.font = `italic 700 ${Math.round(13 * (N / 1024))}px "Chakra Petch", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(58, 80, 92, 0.95)';
    ctx.fillText('T H E   S A L T', sx, sy);
  }

  // dirt tracks: a cream dash on a dark casing
  for (const tr of SIDE_ROADS) {
    path(tr);
    ctx.strokeStyle = 'rgba(16, 11, 8, 0.6)';
    ctx.lineWidth = 4.2 * k;
    ctx.stroke();
    ctx.setLineDash([6 * k, 4 * k]);
    ctx.strokeStyle = 'rgba(226, 204, 166, 0.85)';
    ctx.lineWidth = 1.8 * k;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // the trail up the ridge to The Cut: dotted
  path(CAVE_TRAIL);
  ctx.setLineDash([1 * k, 4.5 * k]);
  ctx.strokeStyle = 'rgba(232, 214, 176, 0.9)';
  ctx.lineWidth = 2.4 * k;
  ctx.stroke();
  ctx.setLineDash([]);
  // the highway: casing, cream fill, and the faded centre dashes
  path(HIGHWAY);
  ctx.strokeStyle = 'rgba(14, 10, 7, 0.85)';
  ctx.lineWidth = 7.5 * k;
  ctx.stroke();
  ctx.strokeStyle = '#d8c39b';
  ctx.lineWidth = 4.4 * k;
  ctx.stroke();
  ctx.setLineDash([5 * k, 6 * k]);
  ctx.strokeStyle = 'rgba(200, 120, 40, 0.9)';
  ctx.lineWidth = 1 * k;
  ctx.stroke();
  ctx.setLineDash([]);

  // the survey grid (8 × 8, 105 m squares)
  ctx.strokeStyle = 'rgba(255, 200, 140, 0.09)';
  ctx.lineWidth = 1 * k;
  for (let i = 1; i < 8; i++) {
    const v = (i / 8) * N;
    ctx.beginPath(); ctx.moveTo(v, 0); ctx.lineTo(v, N); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, v); ctx.lineTo(N, v); ctx.stroke();
  }
  return c;
}
