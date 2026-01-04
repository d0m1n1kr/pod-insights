import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    fs: {
      // Allow serving files from the episodes directory (symlinked)
      allow: ['..']
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate vendor chunks
          'vue-vendor': ['vue', 'vue-router', 'pinia'],
          'i18n': ['vue-i18n'],
          'd3': ['d3'],
          // Marked is relatively small, can stay in main bundle
        }
      }
    },
    chunkSizeWarningLimit: 1000, // Increase limit since we're splitting chunks
  }
})
