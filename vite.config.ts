import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/gymrecord/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'GYMRECORD 訓練紀錄',
        short_name: 'GYMRECORD',
        description: '本機儲存的重量訓練紀錄',
        lang: 'zh-TW',
        id: '/gymrecord/',
        start_url: '/gymrecord/',
        scope: '/gymrecord/',
        display: 'standalone',
        background_color: '#0b1010',
        theme_color: '#0b1010',
        icons: [
          { src: '/gymrecord/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/gymrecord/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: '/gymrecord/index.html'
      }
    })
  ]
})
