<script setup lang="ts">
import { ref, onMounted } from 'vue';
import SpeakerRiver from '../components/SpeakerRiver.vue';
import type { SpeakerRiverData } from '../types';

const speakerData = ref<SpeakerRiverData | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const response = await fetch('/speaker-river-data.json');
    
    if (!response.ok) {
      throw new Error('Fehler beim Laden der Speaker-Daten');
    }
    
    speakerData.value = await response.json();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Unbekannter Fehler';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-if="loading" class="flex items-center justify-center py-20">
    <div class="text-center">
      <div class="inline-block animate-spin rounded-full h-12 w-12 border-4 border-green-500 border-t-transparent"></div>
      <p class="mt-4 text-gray-600 dark:text-gray-400">Lade Sprecher-Daten...</p>
    </div>
  </div>

  <div v-else-if="error" class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center">
    <p class="text-red-800 dark:text-red-200 font-semibold">{{ error }}</p>
  </div>

  <div v-else-if="speakerData" class="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div class="p-3 sm:p-4 md:p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20">
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
          <div class="text-center">
            <div class="text-2xl sm:text-3xl font-bold text-green-600 dark:text-green-400">{{ speakerData.statistics.totalSpeakers }}</div>
            <div class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">Sprecher insgesamt</div>
          </div>
        <div class="text-center">
          <div class="text-2xl sm:text-3xl font-bold text-green-600 dark:text-green-400">
            {{ speakerData.statistics.totalAppearances }}
          </div>
          <div class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">Gesamt-Auftritte</div>
        </div>
        <div class="text-center">
          <div class="text-2xl sm:text-3xl font-bold text-green-600 dark:text-green-400">
            {{ speakerData.statistics.yearRange.start }} - {{ speakerData.statistics.yearRange.end }}
          </div>
          <div class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">Zeitspanne</div>
        </div>
      </div>
    </div>

    <SpeakerRiver :data="speakerData" />
    
    <footer class="p-3 sm:p-4 text-center text-gray-500 dark:text-gray-400 text-xs sm:text-sm border-t border-gray-200 dark:border-gray-700">
      <p>Generiert am: {{ new Date(speakerData.generatedAt).toLocaleString('de-DE') }}</p>
    </footer>
  </div>
</template>

