import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
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

export default defineConfig({
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
