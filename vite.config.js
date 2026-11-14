import { defineConfig } from 'vite';

// Relais de même origine pour les sources sans CORS (Yahoo Finance) ou à CORS incertain (Kraken).
// Valable pour `npm run dev` et `npm run preview` ; en production, Render joue ce rôle avec des règles de
// réécriture (voir le README) :
//   /proxy/yahoo/*  →  https://query1.finance.yahoo.com/*
//   /proxy/kraken/* →  https://api.kraken.com/0/public/*
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const proxy = {
  '/proxy/yahoo': {
    target: 'https://query1.finance.yahoo.com',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/proxy\/yahoo/, ''),
    headers: { 'User-Agent': BROWSER_UA },
  },
  '/proxy/kraken': {
    target: 'https://api.kraken.com',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/proxy\/kraken/, '/0/public'),
  },
};

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
  server: { proxy },
  preview: { proxy },
});
