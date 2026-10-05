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
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
  server: { port: 5173, host: true },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
