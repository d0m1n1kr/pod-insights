import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import './style.css'
import App from './App.vue'
import router from './router'
import { useSettingsStore } from './stores/settings'

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

const app = createApp(App)
app.use(pinia)
app.use(router)

// Initialize theme after pinia is ready
const settingsStore = useSettingsStore()
settingsStore.applyTheme()

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (settingsStore.themeMode === 'auto') {
    settingsStore.applyTheme()
  }
})

app.mount('#app')
