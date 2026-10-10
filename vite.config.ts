import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// package.json is the single source of truth for the version shown in the game and on the site
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Content hashes of public/models and public/voice: the game asks for `wolf.glb?v=<hash>`, so the
// site can let browsers keep them for a year (netlify.toml) and a changed file still arrives fresh.
const pub = (dir: string) => fileURLToPath(new URL(`./public/${dir}/`, import.meta.url));
const hash = (b: Buffer | string) => createHash('sha1').update(b).digest('hex').slice(0, 10);
const MODEL_REV: Record<string, { v: string; size: number }> = {};
for (const f of readdirSync(pub('models')).filter((f) => f.endsWith('.glb')).sort()) {
  const b = readFileSync(pub('models') + f);
  MODEL_REV[f.slice(0, -4)] = { v: hash(b), size: b.length };
}
const voice = createHash('sha1');
for (const f of readdirSync(pub('voice')).sort()) voice.update(f).update(readFileSync(pub('voice') + f));
const VOICE_REV = voice.digest('hex').slice(0, 10);

// Offline play (src/engine/offline.ts): after a build, list every file the game page uses with its
// content hash and write the service worker (scripts/offline/sw.js → dist/play/sw.js). The URLs are
// exactly what the game requests (models and voice carry their `?v=`); the cache keys carry each
// file's own hash, so a deploy re-downloads only what changed, even when the voice rev moves.
function offlinePlugin(): Plugin {
  let outDir = '';
  return {
    name: 'bb-offline',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir.startsWith('/') ? c.build.outDir : `${c.root}/${c.build.outDir}`; },
    closeBundle() {
      const files: [string, string, number][] = [];
      const add = (url: string, file: string) => {
        const b = readFileSync(`${outDir}/${file}`);
        files.push([url, `/${file}?h=${hash(b)}`, b.length]);
      };
      // the site's own bundle stays out; browsers that run service workers all take woff2
      for (const f of readdirSync(`${outDir}/assets`).sort()) if (!f.startsWith('site-') && !f.endsWith('.woff')) add(`/assets/${f}`, `assets/${f}`);
      for (const f of readdirSync(`${outDir}/models`).sort()) if (f.endsWith('.glb')) add(`/models/${f}?v=${MODEL_REV[f.slice(0, -4)]?.v}`, `models/${f}`);
      for (const f of readdirSync(`${outDir}/voice`).sort()) add(`/voice/${f}?v=${VOICE_REV}`, `voice/${f}`);
      for (const f of ['play.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'favicon.ico', 'favicon-32.png']) add(`/${f}`, f);
      // the page carries the deploy's id; it registers sw.js?v=<id>, so a new deploy installs on its first online launch
      const page = `${outDir}/play/index.html`;
      const html = readFileSync(page, 'utf8');
      const id = hash(JSON.stringify(files) + html);
      writeFileSync(page, html.replace('</head>', `  <meta name="bb-offline" content="${id}" />\n  </head>`));
      add('/play/', 'play/index.html');
      const sw = readFileSync(fileURLToPath(new URL('./scripts/offline/sw.js', import.meta.url)), 'utf8')
        .replace('/* FILES */ []', JSON.stringify(files))
        .replace("/* INDEX */ ''", JSON.stringify(files[files.length - 1][1]));
      writeFileSync(`${outDir}/play/sw.js`, sw);
      const mb = files.reduce((s, f) => s + f[2], 0) / 1e6;
      console.log(`[offline] play/sw.js (${id}): ${files.length} files, ${mb.toFixed(1)} MB`);
    },
  };
}

export default defineConfig({
  plugins: [offlinePlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __MODEL_REV__: JSON.stringify(MODEL_REV),
    __VOICE_REV__: JSON.stringify(VOICE_REV),
  },
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      // addons import plain 'three'; route it to the WebGPU build so there is only one instance
      { find: /^three$/, replacement: 'three/webgpu' },
    ],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
    rolldownOptions: {
      // site root = marketing page, /play/ = the game (also what the desktop app opens)
      input: {
        site: fileURLToPath(new URL('./index.html', import.meta.url)),
        play: fileURLToPath(new URL('./play/index.html', import.meta.url)),
      },
    },
  },
  server: { port: 5173, host: true },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
