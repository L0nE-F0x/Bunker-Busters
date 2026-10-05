import './fonts';
import { createRenderer } from '@/engine/renderer';
import { Game } from '@/game/Game';

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const { renderer, isWebGPU, backendLabel } = await createRenderer(canvas);
  console.info(`[BunkerBusters] renderer backend: ${backendLabel}`);
  const game = new Game(renderer, isWebGPU, canvas);
  game.backendLabel = backendLabel;
  (window as unknown as { game: Game }).game = game;
  await game.build();
}

boot().catch((err) => {
  console.error(err);
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;inset:20px;color:#ffb347;font:14px monospace;white-space:pre-wrap;z-index:99';
  el.textContent = `Bunker Busters failed to start:\n\n${err?.stack ?? err}`;
  document.body.appendChild(el);
});
