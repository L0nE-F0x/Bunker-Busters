// The desktop app's copy of the web build: dist/ minus what only the website uses (the gzipped model
// copies the browser fetches, the site's images and pages, the offline service worker). Tauri bundles
// frontendDist whole, so without this every download carried ~33 MB the app never reads.
// Runs after `npm run build` (tauri.conf.json beforeBuildCommand); dist/ itself is left as built.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const src = path.join(root, 'dist');
const out = path.join(root, 'dist-desktop');
const WEB_ONLY = [/^models\/.*\.glb\.gz$/, /^media\//, /^press\//, /^privacy\//, /^404\.html$/, /^play\/sw\.js$/, /^robots\.txt$/, /^sitemap\.xml$/, /^og\.jpg$/];

if (!fs.existsSync(path.join(src, 'play/index.html'))) throw new Error('dist/ has no play/index.html: run `npm run build` first');
fs.rmSync(out, { recursive: true, force: true });
let kept = 0, skipped = 0, bytes = 0;
fs.cpSync(src, out, {
  recursive: true,
  filter: (from) => {
    const rel = path.relative(src, from).split(path.sep).join('/');
    if (!rel) return true;
    if (WEB_ONLY.some((re) => re.test(rel) || re.test(rel + '/'))) { skipped++; return false; }
    const st = fs.statSync(from);
    if (st.isFile()) { kept++; bytes += st.size; }
    return true;
  },
});
console.log(`[desktop-dist] ${kept} files, ${(bytes / 1e6).toFixed(1)} MB → dist-desktop/ (${skipped} web-only entries left out)`);
