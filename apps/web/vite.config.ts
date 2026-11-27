import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [
    react(),
    tailwind(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      manifest: {
        name: 'Munim · Kirana Counter',
        short_name: 'Munim',
        description: 'Voice-first sales, stock and Khata',
        theme_color: '#123d32',
        background_color: '#f6f4ed',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/health\//],
        runtimeCaching: [],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://127.0.0.1:3000', '/health': 'http://127.0.0.1:3000' } },
  build: { sourcemap: true },
});
