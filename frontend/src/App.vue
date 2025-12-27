<script setup lang="ts">
import { ref, onMounted } from 'vue';
import TopicRiver from './components/TopicRiver.vue';
import SpeakerRiver from './components/SpeakerRiver.vue';
import type { TopicRiverData, SpeakerRiverData } from './types';

const topicData = ref<TopicRiverData | null>(null);
const speakerData = ref<SpeakerRiverData | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const activeView = ref<'topics' | 'speakers'>('topics');

onMounted(async () => {
  try {
    const [topicResponse, speakerResponse] = await Promise.all([
      fetch('/topic-river-data.json'),
      fetch('/speaker-river-data.json')
    ]);
    
    if (!topicResponse.ok || !speakerResponse.ok) {
      throw new Error('Fehler beim Laden der Daten');
    }
    
    topicData.value = await topicResponse.json();
    speakerData.value = await speakerResponse.json();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Unbekannter Fehler';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
    <header class="bg-white border-b border-gray-200 shadow-sm">
      <div class="container mx-auto px-4 py-6">
        <h1 class="text-4xl font-bold text-gray-900">
          Freak Show River Visualisierung
        </h1>
        <p class="text-gray-600 mt-2">
          Visualisierung der Themen- und Speaker-Entwicklung über die Jahre
        </p>
        
        <!-- Tab Navigation -->
        <div class="mt-6 flex gap-2 border-b border-gray-200">
          <button
            @click="activeView = 'topics'"
            :class="[
              'px-6 py-3 font-semibold border-b-2 transition-colors',
              activeView === 'topics' 
                ? 'border-blue-500 text-blue-600' 
                : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
            ]"
          >
            Topics
          </button>
          <button
            @click="activeView = 'speakers'"
            :class="[
              'px-6 py-3 font-semibold border-b-2 transition-colors',
              activeView === 'speakers' 
                ? 'border-green-500 text-green-600' 
                : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
            ]"
          >
            Speaker
          </button>
        </div>
      </div>
    </header>

    <main class="container mx-auto px-4 py-8">
      <div v-if="loading" class="flex items-center justify-center py-20">
        <div class="text-center">
          <div class="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
          <p class="mt-4 text-gray-600">Lade Daten...</p>
        </div>
      </div>

      <div v-else-if="error" class="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <p class="text-red-800 font-semibold">{{ error }}</p>
      </div>

      <!-- Topics View -->
      <div v-else-if="activeView === 'topics' && topicData" class="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
        <div class="p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="text-center">
              <div class="text-3xl font-bold text-blue-600">{{ topicData.statistics.totalTopics }}</div>
              <div class="text-sm text-gray-600 mt-1">Topics insgesamt</div>
            </div>
            <div class="text-center">
              <div class="text-3xl font-bold text-purple-600">
                {{ topicData.statistics.yearRange.start }} - {{ topicData.statistics.yearRange.end }}
              </div>
              <div class="text-sm text-gray-600 mt-1">Zeitspanne</div>
            </div>
          </div>
        </div>

        <TopicRiver :data="topicData" />
      </div>

      <!-- Speakers View -->
      <div v-else-if="activeView === 'speakers' && speakerData" class="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
        <div class="p-6 border-b border-gray-200 bg-gradient-to-r from-green-50 to-emerald-50">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="text-center">
              <div class="text-3xl font-bold text-green-600">{{ speakerData.statistics.totalSpeakers }}</div>
              <div class="text-sm text-gray-600 mt-1">Speaker insgesamt</div>
            </div>
            <div class="text-center">
              <div class="text-3xl font-bold text-emerald-600">
                {{ speakerData.statistics.totalAppearances }}
              </div>
              <div class="text-sm text-gray-600 mt-1">Gesamt-Auftritte</div>
            </div>
            <div class="text-center">
              <div class="text-3xl font-bold text-teal-600">
                {{ speakerData.statistics.yearRange.start }} - {{ speakerData.statistics.yearRange.end }}
              </div>
              <div class="text-sm text-gray-600 mt-1">Zeitspanne</div>
            </div>
          </div>
        </div>

        <SpeakerRiver :data="speakerData" />
      </div>

      <footer class="mt-12 text-center text-gray-500 text-sm">
        <p v-if="activeView === 'topics' && topicData">
          Generiert am: {{ new Date(topicData.generatedAt).toLocaleString('de-DE') }}
        </p>
        <p v-else-if="activeView === 'speakers' && speakerData">
          Generiert am: {{ new Date(speakerData.generatedAt).toLocaleString('de-DE') }}
        </p>
      </footer>
    </main>
  </div>
</template>

<style>
#app {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
</style>
