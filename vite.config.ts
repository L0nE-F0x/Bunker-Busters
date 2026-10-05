import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

// package.json is the single source of truth for the version shown in the game and on the site
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
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
