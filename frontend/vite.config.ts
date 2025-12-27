import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    fs: {
      // Allow serving files from the episodes directory (symlinked)
      allow: ['..']
    }
  }
})
