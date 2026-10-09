/// <reference lib="webworker" />
// Rasterises the world map sheet off the main thread while the game boots (see MapData.startChart).
import { rasterChart, type ChartInput } from './chartRaster';

self.onmessage = (e: MessageEvent<ChartInput>) => {
  const t0 = performance.now();
  const px = rasterChart(e.data);
  (self as unknown as Worker).postMessage({ px, ms: performance.now() - t0 }, [px.buffer]);
};
