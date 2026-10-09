import type { Heightfield } from '@/game/world/Heightfield';
import { HIGHWAY, SIDE_ROADS, CAVE_TRAIL } from '@/content/world';
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
