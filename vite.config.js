import { defineConfig } from 'vite';

// Site statique 100 % côté client : `npm run build` → dist/
export default defineConfig({
  build: {
    target: 'esnext',
    outDir: 'dist',
    // Monaco + Vela sont volumineux : on relève simplement le seuil d'avertissement.
    chunkSizeWarningLimit: 6000,
  },
  worker: {
    // Les workers Monaco (?worker) sont émis en modules ES.
    format: 'es',
  },
  esbuild: {
    target: 'esnext',
  },
});
