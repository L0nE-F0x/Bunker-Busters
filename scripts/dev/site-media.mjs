// The website's derived images, rebuilt from public/media and the CSS logo:
//   public/media/800/<name>.jpg, public/media/1280/<name>.jpg   smaller copies for <img srcset> (the
//       landing page and the press kit lazy-load these; the originals stay for "full size" links)
//   public/press/*.png   the logo as transparent PNGs for the press kit (rendered from debug/og.html)
//
//   node scripts/dev/site-media.mjs            both (the logos need `npm run dev`; BB_PORT for a worktree)
//   node scripts/dev/site-media.mjs sizes      only the resized copies (ImageMagick `magick`, no server)
//   node scripts/dev/site-media.mjs logos      only the logos
//
// Run it after marketing-shots.mjs replaces a picture, and commit what it writes.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const media = path.join(root, 'public/media');
const what = process.argv[2] ?? 'all';

// width → JPEG quality (the 1280 copies go to 2–3× screens, where artefacts hide better)
const SIZES = { 800: 80, 1280: 75 };
// not on the pages: the hero poster is already small, shot-* are the web manifest's screenshots
const SKIP = /^(hero-loop|shot-\d+)\.jpg$/;

if (what === 'all' || what === 'sizes') {
  let n = 0;
  for (const f of fs.readdirSync(media).filter((f) => f.endsWith('.jpg') && !SKIP.test(f)).sort()) {
    const src = path.join(media, f);
    const width = Number(execFileSync('magick', ['identify', '-format', '%w', src]).toString());
    for (const [w, q] of Object.entries(SIZES)) {
      const dir = path.join(media, w);
      fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, f);
      if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) continue;
      const resize = width > Number(w) ? ['-resize', `${w}x`] : [];
      execFileSync('magick', [src, ...resize, '-strip', '-interlace', 'JPEG', '-sampling-factor', '4:2:0', '-quality', String(q), out]);
      n++;
    }
  }
  console.log(`[sizes] ${n} written`);
}

if (what === 'all' || what === 'logos') {
  const { launch } = await import('./browser.mjs');
  const ORIGIN = process.env.DEV_ORIGIN || `http://localhost:${process.env.BB_PORT || 5173}`;
  const out = path.join(root, 'public/press');
  fs.mkdirSync(out, { recursive: true });
  const b = await launch('soft');
  try {
    // ?logo=stacked|line: just the logo on a transparent page, at 2× for crisp edges
    for (const [kind, file] of [['stacked', 'bunker-busters-logo.png'], ['line', 'bunker-busters-wordmark.png']]) {
      const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
      await p.goto(`${ORIGIN}/debug/og.html?logo=${kind}`, { waitUntil: 'networkidle' });
      await p.waitForFunction(() => window.__ready === true);
      await p.waitForTimeout(300);
      await p.locator('.logo').screenshot({ path: path.join(out, file), omitBackground: true });
      await p.close();
      console.log('[logos]', file);
    }
  } finally {
    await b.close();
  }
}
