import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
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
