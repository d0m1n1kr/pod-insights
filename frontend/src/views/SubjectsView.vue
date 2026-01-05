<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import SubjectRiver from '../components/SubjectRiver.vue';
import type { SubjectRiverData } from '../types';
import { getPodcastFileUrl } from '@/composables/usePodcast';
import { useSettingsStore } from '@/stores/settings';

const settings = useSettingsStore();
const subjectData = ref<SubjectRiverData | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

async function loadData() {
  loading.value = true;
  error.value = null;
  
  try {
    const url = getPodcastFileUrl('subject-river-data.json');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load subject river data: ${response.status}`);
    }
    subjectData.value = await response.json();
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : 'Unbekannter Fehler';
    error.value = errorMessage;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadData();
});

// Watch for podcast changes and reload data
watch(() => settings.selectedPodcast, () => {
  loadData();
});
</script>

<template>
  <div v-if="loading" class="flex items-center justify-center py-20">
    <div class="text-center">
      <div class="inline-block animate-spin rounded-full h-12 w-12 border-4 border-purple-500 border-t-transparent"></div>
      <p class="mt-4 text-gray-600 dark:text-gray-400">Lade {{ $t('nav.subjects') }}-Daten...</p>
    </div>
  </div>

  <div v-else-if="error" class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center">
    <p class="text-red-800 dark:text-red-200 font-semibold">{{ error }}</p>
  </div>

  <div v-else-if="subjectData">
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
    <div class="p-3 sm:p-4 md:p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div class="text-center">
          <div class="text-2xl sm:text-3xl font-bold text-purple-600 dark:text-purple-400">{{ subjectData.statistics.totalSubjects || 0 }}</div>
          <div class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">{{ $t('nav.subjects') }} insgesamt</div>
        </div>
        <div class="text-center">
          <div class="text-2xl sm:text-3xl font-bold text-purple-600 dark:text-purple-400">
            {{ subjectData.statistics.yearRange.start }} - {{ subjectData.statistics.yearRange.end }}
          </div>
          <div class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">Zeitspanne</div>
        </div>
      </div>
    </div>

    <SubjectRiver :data="subjectData" color="purple" />
    
    <footer class="p-3 sm:p-4 text-center text-gray-500 dark:text-gray-400 text-xs sm:text-sm border-t border-gray-200 dark:border-gray-700">
      <p>Generiert am: {{ new Date(subjectData.generatedAt).toLocaleString('de-DE') }}</p>
    </footer>
    </div>
  </div>
</template>

