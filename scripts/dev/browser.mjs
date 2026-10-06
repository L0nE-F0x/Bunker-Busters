// Shared headless-Chrome launcher for the dev harness (screenshots, benchmarks, marketing art).
//
// GPU modes (Linux hybrid laptop; all headless, nothing appears on screen):
//   nvidia  — WebGL on the NVIDIA dGPU via ANGLE/EGL (fast; default)
//   intel   — WebGL on the integrated GPU
//   soft    — SwiftShader software rendering (slow; works anywhere)
// Pass ?webgl in game URLs: headless WebGPU on this machine fails the same way desktop Chrome does.
//
// NEVER launch a *headed* Chrome with its GPU process forced onto NVIDIA (render-node override +
// PRIME env) on a live Hyprland session — it froze the desktop once. Headless is safe.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pw = path.join(os.homedir(), '.cache/ms-playwright');
  if (fs.existsSync(pw)) {
    const dirs = fs.readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      const sub = fs.readdirSync(path.join(pw, d)).find((s) => s.startsWith('chrome-linux'));
      if (sub) return path.join(pw, d, sub, 'chrome');
    }
  }
  for (const p of ['/opt/google/chrome/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome-stable']) if (fs.existsSync(p)) return p;
  throw new Error('No Chrome/Chromium found — set CHROME_PATH');
}

export async function launch(mode = process.env.GPU_MODE || 'nvidia', extraArgs = []) {
  const env = { ...process.env };
  let args;
  if (mode === 'soft') args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  else {
    args = ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'];
    if (mode === 'nvidia') env.__EGL_VENDOR_LIBRARY_FILENAMES = '/usr/share/glvnd/egl_vendor.d/10_nvidia.json';
  }
  return chromium.launch({ executablePath: findChrome(), headless: true, env, args: ['--headless=new', ...args, ...extraArgs] });
}

/** Wait until the game has finished loading (window.game.mode leaves 'loading'). */
export async function waitForGame(page, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const m = await page.evaluate(() => window.game?.mode).catch(() => null);
    if (m && m !== 'loading') return m;
    await page.waitForTimeout(400);
  }
  throw new Error('game did not finish loading');
}

/** Frames per second over `ms`, using the game's own frame counter. */
export async function measureFps(page, ms = 3000) {
  return page.evaluate(async (ms) => {
    const g = window.game; const a = g.frames; const t = performance.now();
    await new Promise((r) => setTimeout(r, ms));
    return +((g.frames - a) / ((performance.now() - t) / 1000)).toFixed(1);
  }, ms);
}
