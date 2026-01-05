<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SpeakerRiver from '../components/SpeakerRiver.vue';
import EpisodeTable from '../components/EpisodeTable.vue';
import type { SpeakerRiverData } from '../types';
import { loadPodcastData, getEpisodeImageUrl } from '@/composables/usePodcast';
import { useSettingsStore } from '@/stores/settings';

const route = useRoute();
const router = useRouter();
const settings = useSettingsStore();
const speakerData = ref<SpeakerRiverData | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const speakerRiverRef = ref<InstanceType<typeof SpeakerRiver> | null>(null);
const episodeTableRef = ref<InstanceType<typeof EpisodeTable> | null>(null);

// Local state for controls (synced with URL and store)
const normalizedView = ref<boolean>(settings.normalizedView);
const speakerFilter = ref<number>(settings.speakerFilter);

// Helper functions for EpisodeTable
const formatDuration = (duration: [number, number, number]): string => {
  const [h, m, s] = duration;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const formatHmsFromSeconds = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const getTopicOccurrences = (episode: any): Array<{ positionSec: number; durationSec: number | null; topic: string | null }> => {
  // Speaker river doesn't have topic occurrences, return empty array
  return [];
};

const formatOccurrenceLabel = (occ: { positionSec: number; durationSec: number | null; topic?: string | null }) => {
  const formatMinutes = (sec: number | null) => {
    if (!Number.isFinite(sec as number) || (sec as number) <= 0) return null;
    const m = Math.max(1, Math.round((sec as number) / 60));
    return `${m}m`;
  };
  const m = formatMinutes(occ.durationSec);
  return m ? `${formatHmsFromSeconds(occ.positionSec)} (${m})` : formatHmsFromSeconds(occ.positionSec);
};

const playEpisodeAt = async (episodeNumber: number, seconds: number, label: string) => {
  if (speakerRiverRef.value) {
    await speakerRiverRef.value.playEpisodeAt(episodeNumber, seconds, label);
  }
};

// URL state management
const updateUrl = () => {
  const query: Record<string, string | undefined> = {};
  
  if (normalizedView.value) {
    query.normalized = '1';
  }
  
  if (speakerFilter.value !== 30) {
    query.speakers = speakerFilter.value.toString();
  }
  
  if (speakerRiverRef.value?.selectedSpeaker) {
    query.speaker = speakerRiverRef.value.selectedSpeaker;
  }
  
  if (speakerRiverRef.value?.selectedYear) {
    query.year = speakerRiverRef.value.selectedYear.toString();
  }
  
  // Remove undefined values
  const mergedQuery: Record<string, string> = {};
  Object.keys(query).forEach(key => {
    if (query[key] !== undefined) {
      mergedQuery[key] = query[key]!;
    }
  });
  
  // Compare with current route query to avoid unnecessary updates
  const currentQuery = { ...route.query };
  const hasChanges = Object.keys(mergedQuery).some(key => mergedQuery[key] !== currentQuery[key]) ||
    Object.keys(currentQuery).some(key => mergedQuery[key] === undefined && currentQuery[key] !== undefined);
  
  if (hasChanges) {
    router.replace({ query: mergedQuery });
  }
};

const readFromUrl = async () => {
  const query = route.query;
  
  // Read normalized view
  if (query.normalized === '1') {
    normalizedView.value = true;
  } else if (query.normalized === undefined) {
    // Fall back to store value if not in URL
    normalizedView.value = settings.normalizedView;
  } else {
    normalizedView.value = false;
  }
  
  // Read speaker filter
  if (query.speakers) {
    const speakersValue = parseInt(query.speakers as string, 10);
    if (!isNaN(speakersValue) && speakersValue >= 5 && speakersValue <= 30) {
      speakerFilter.value = speakersValue;
    }
  } else {
    // Fall back to store value if not in URL
    speakerFilter.value = settings.speakerFilter;
  }
  
  // Read selected speaker and year (need to wait for component to be mounted)
  await nextTick();
  if (speakerRiverRef.value) {
    if (query.speaker) {
      speakerRiverRef.value.setSelectedSpeaker(query.speaker as string);
    }
    if (query.year) {
      const yearValue = parseInt(query.year as string, 10);
      if (!isNaN(yearValue)) {
        speakerRiverRef.value.setSelectedYear(yearValue);
      }
    }
  }
};

async function loadData() {
  loading.value = true;
  error.value = null;
  
  try {
    speakerData.value = await loadPodcastData<SpeakerRiverData>('speaker-river-data.json');
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Unbekannter Fehler';
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await loadData();
  await readFromUrl();
});

// Reload data when podcast changes
watch(() => settings.selectedPodcast, () => {
  loadData();
});

// Watch for URL changes
watch(() => route.query, () => {
  readFromUrl();
}, { deep: true });

// Watch for state changes to update URL and store
watch(normalizedView, (newValue) => {
  // Update store when value changes
  settings.setNormalizedView(newValue);
  updateUrl();
});

watch(speakerFilter, (newValue) => {
  // Update store when value changes
  settings.speakerFilter = newValue;
  updateUrl();
});

watch(() => speakerRiverRef.value?.selectedSpeaker, () => {
  updateUrl();
});

watch(() => speakerRiverRef.value?.selectedYear, () => {
  updateUrl();
});

// Watch for speaker selection changes to scroll to table
watch(() => speakerRiverRef.value?.selectedSpeakerInfo, (newValue) => {
  if (newValue && speakerRiverRef.value?.showEpisodeList) {
    // Scroll to table when a speaker is selected
    nextTick(() => {
      setTimeout(() => {
        if (episodeTableRef.value?.$el) {
          episodeTableRef.value.$el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    });
  }
});

// Computed properties for EpisodeTable
const episodes = computed(() => {
  if (!speakerRiverRef.value?.selectedSpeakerInfo) return [];
  return speakerRiverRef.value.selectedSpeakerInfo.episodeNumbers.map(num => {
    const detail = speakerRiverRef.value?.episodeDetails.get(num);
    return {
      number: num,
      date: detail?.date || '',
      title: detail?.title || `Episode ${num}`,
    };
  });
});

const maxSpeakers = computed(() => {
  return speakerData.value?.statistics.totalSpeakers || 30;
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

  <div v-else-if="speakerData" class="space-y-6">
    <!-- Main Panel: Statistics, Controls, and Chart -->
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <!-- Header with Statistics -->
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
        
        <!-- Controls -->
        <div class="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4 flex-wrap">
          <label class="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 flex flex-col sm:flex-row sm:items-center gap-2">
            <span class="whitespace-nowrap">Anzahl Speaker:</span>
            <div class="flex items-center gap-2">
              <input
                v-model.number="speakerFilter"
                type="range"
                min="5"
                :max="maxSpeakers"
                step="1"
                class="flex-1 sm:w-32 md:w-48"
              />
              <span class="font-semibold min-w-[2rem] text-right text-green-600 dark:text-green-400">{{ speakerFilter }}</span>
            </div>
          </label>
          
          <label class="flex items-center gap-2 text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              v-model="normalizedView"
              type="checkbox"
              class="w-4 h-4 text-green-600 rounded focus:ring-green-500 dark:focus:ring-green-400"
            />
            <span>Normierte Ansicht (100%/Jahr)</span>
          </label>
        </div>
      </div>
      
      <!-- Chart Body -->
      <div class="p-3 sm:p-4 md:p-6">
        <SpeakerRiver
          ref="speakerRiverRef"
          :data="speakerData"
          :normalized-view="normalizedView"
          :speaker-filter="speakerFilter"
          @update:normalized-view="normalizedView = $event"
          @update:speaker-filter="speakerFilter = $event"
        />
      </div>
    </div>
    
    <!-- Episode Table Panel -->
    <EpisodeTable
      ref="episodeTableRef"
      v-if="speakerRiverRef?.selectedSpeakerInfo && speakerRiverRef?.showEpisodeList"
      :episodes="episodes"
      :episode-details="speakerRiverRef.episodeDetails"
      :loading-episodes="speakerRiverRef.loadingEpisodes"
      :get-topic-occurrences="getTopicOccurrences"
      :play-episode-at="playEpisodeAt"
      :format-occurrence-label="formatOccurrenceLabel"
      :format-duration="formatDuration"
      :format-hms-from-seconds="formatHmsFromSeconds"
      :get-episode-image-url="getEpisodeImageUrl"
      theme-color="green"
      :show-play-button="true"
    >
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <h3 class="font-semibold text-lg text-green-900 dark:text-green-100">
              {{ speakerRiverRef.selectedSpeakerInfo.name }}
            </h3>
            <p class="text-sm text-green-700 dark:text-green-300 mt-1">
              {{ speakerRiverRef.selectedSpeakerInfo.totalAppearances }} Episoden
              <span v-if="speakerRiverRef.selectedSpeakerInfo.firstAppearance">
                ({{ speakerRiverRef.selectedSpeakerInfo.firstAppearance }} - {{ speakerRiverRef.selectedSpeakerInfo.lastAppearance }})
              </span>
            </p>
            
            <!-- Year Filter Badge -->
            <div v-if="speakerRiverRef.selectedYear" class="mt-2 inline-flex items-center gap-2 bg-green-600 text-white px-3 py-1 rounded-full text-sm font-semibold">
              <span>📅 Jahr: {{ speakerRiverRef.selectedYear }}</span>
              <button 
                @click="speakerRiverRef.setSelectedYear(null)"
                class="hover:bg-green-700 rounded-full w-5 h-5 flex items-center justify-center transition-colors"
                title="Jahr-Filter entfernen"
              >
                ✕
              </button>
            </div>
          </div>
          <button
            @click="speakerRiverRef.setSelectedSpeaker(null); speakerRiverRef.setShowEpisodeList(false);"
            class="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300 font-semibold ml-4"
          >
            ✕
          </button>
        </div>
      </template>
    </EpisodeTable>
    
    <!-- Footer -->
    <footer class="text-center text-gray-500 dark:text-gray-400 text-xs sm:text-sm">
      <p>Generiert am: {{ new Date(speakerData.generatedAt).toLocaleString('de-DE') }}</p>
    </footer>
  </div>
</template>
