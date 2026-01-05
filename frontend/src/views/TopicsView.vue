<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import TopicRiver from '../components/TopicRiver.vue';
import EpisodeTable from '../components/EpisodeTable.vue';
import NoVariantsMessage from '../components/NoVariantsMessage.vue';
// import VariantInfoPanel from '../components/VariantInfoPanel.vue';
import type { TopicRiverData } from '../types';
import { loadVariantData } from '@/composables/useVariants';
import { useSettingsStore } from '@/stores/settings';

const route = useRoute();
const router = useRouter();
const settings = useSettingsStore();
const topicData = ref<TopicRiverData | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const noVariants = ref(false);
const topicRiverRef = ref<InstanceType<typeof TopicRiver> | null>(null);
const episodeTableRef = ref<InstanceType<typeof EpisodeTable> | null>(null);

// Local state for controls (synced with URL and store)
const normalizedView = ref(settings.normalizedView);
const topicFilter = ref(settings.topicFilter);

async function loadData() {
  loading.value = true;
  error.value = null;
  noVariants.value = false;
  
  try {
    topicData.value = await loadVariantData<TopicRiverData>('topic-river-data.json');
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : 'Unbekannter Fehler';
    // Check if error is due to missing variants
    if (errorMessage.includes('Failed to load') || errorMessage.includes('404')) {
      noVariants.value = true;
    } else {
      error.value = errorMessage;
    }
  } finally {
    loading.value = false;
  }
}

// Update URL when selections change
const updateUrl = () => {
  const query: Record<string, string | undefined> = {};
  
  if (normalizedView.value) {
    query.normalized = '1';
  } else {
    query.normalized = undefined;
  }
  query.topics = topicFilter.value.toString();
  
  if (topicRiverRef.value?.selectedTopic) {
    query.topic = topicRiverRef.value.selectedTopic;
    if (topicRiverRef.value.selectedYear) {
      query.year = topicRiverRef.value.selectedYear.toString();
    }
  }
  
  // Build final query object, removing undefined values and merging with current query
  const currentQuery = route.query;
  const mergedQuery: Record<string, string> = {};
  
  // Copy current query values (only strings)
  Object.keys(currentQuery).forEach(key => {
    const value = currentQuery[key];
    if (typeof value === 'string') {
      mergedQuery[key] = value;
    }
  });
  
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined) {
      mergedQuery[key] = value;
    } else {
      delete mergedQuery[key];
    }
  });
  
  // Only update URL if query params actually changed
  const hasChanges = 
    mergedQuery.normalized !== currentQuery.normalized ||
    mergedQuery.topics !== currentQuery.topics ||
    mergedQuery.topic !== currentQuery.topic ||
    mergedQuery.year !== currentQuery.year;
  
  if (hasChanges) {
    router.replace({ query: mergedQuery });
  }
};

// Read initial values from URL
const readFromUrl = () => {
  const query = route.query;
  
  if (query.normalized === '1') {
    normalizedView.value = true;
  } else if (query.normalized === undefined) {
    // Fall back to store value if not in URL
    normalizedView.value = settings.normalizedView;
  } else {
    normalizedView.value = false;
  }
  
  if (query.topics && typeof query.topics === 'string') {
    const filterValue = parseInt(query.topics, 10);
    if (Number.isFinite(filterValue) && filterValue >= 5) {
      const maxTopics = topicData.value?.statistics.totalTopics || 15;
      topicFilter.value = Math.min(filterValue, Math.max(5, maxTopics));
    }
  } else if (topicData.value) {
    // Fall back to store value if not in URL, but validate against max
    const maxTopics = topicData.value.statistics.totalTopics || 15;
    const storeValue = settings.topicFilter;
    topicFilter.value = Math.min(Math.max(5, storeValue), Math.max(5, maxTopics));
  } else {
    // Use store value if data not loaded yet
    topicFilter.value = settings.topicFilter;
  }
  
  // Topic and year - will be set after component is mounted
  if (query.topic && typeof query.topic === 'string') {
    nextTick(() => {
      if (topicRiverRef.value && topicData.value && topicData.value.topics[query.topic as string]) {
        topicRiverRef.value.setSelectedTopic(query.topic as string);
        
        if (query.year && typeof query.year === 'string') {
          const year = parseInt(query.year, 10);
          if (Number.isFinite(year)) {
            topicRiverRef.value.setSelectedYear(year);
          }
        }
      }
    });
  }
};

onMounted(async () => {
  await loadData();
  await nextTick();
  await nextTick();
  readFromUrl();
});

// Watch for variant changes and reload data
watch(() => settings.clusteringVariant, () => {
  loadData();
});

// Watch for podcast changes and reload data
watch(() => settings.selectedPodcast, () => {
  loadData();
});

// Watch for changes and update URL
watch(normalizedView, (newValue) => {
  // Update store when value changes
  settings.setNormalizedView(newValue);
  updateUrl();
});

watch(topicFilter, (newValue) => {
  // Update store when value changes
  settings.topicFilter = newValue;
  updateUrl();
});

// Watch for topic selection changes to scroll to table
watch(() => topicRiverRef.value?.selectedTopicInfo, (newValue) => {
  if (newValue && topicRiverRef.value?.showEpisodeList) {
    // Scroll to table when a topic is selected
    nextTick(() => {
      setTimeout(() => {
        if (episodeTableRef.value?.$el) {
          episodeTableRef.value.$el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    });
  }
});

watch(() => topicRiverRef.value?.selectedTopic, () => {
  updateUrl();
});

watch(() => topicRiverRef.value?.selectedYear, () => {
  updateUrl();
});
</script>

<template>
  <div v-if="loading" class="flex items-center justify-center py-20">
    <div class="text-center">
      <div class="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
      <p class="mt-4 text-gray-600 dark:text-gray-400">Lade Themen-Daten...</p>
    </div>
  </div>

  <NoVariantsMessage v-else-if="noVariants" />

  <div v-else-if="error" class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center">
    <p class="text-red-800 dark:text-red-200 font-semibold">{{ error }}</p>
  </div>

  <div v-else-if="topicData">
    <!-- Temporarily hidden
    <VariantInfoPanel class="mb-6" />
    -->
    
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
    <div class="p-3 sm:p-4 md:p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-4">
        <div class="text-center">
          <div class="text-2xl sm:text-3xl font-bold text-blue-600 dark:text-blue-400">{{ topicData.statistics.totalTopics || 0 }}</div>
          <div class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">Themen insgesamt</div>
        </div>
        <div class="text-center">
          <div class="text-2xl sm:text-3xl font-bold text-blue-600 dark:text-blue-400">
            {{ topicData.statistics.yearRange.start }} - {{ topicData.statistics.yearRange.end }}
          </div>
          <div class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">Zeitspanne</div>
        </div>
      </div>
      
      <!-- Controls -->
      <div class="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
        <label class="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 flex flex-col sm:flex-row sm:items-center gap-2">
          <span class="whitespace-nowrap">Anzahl Themen:</span>
          <div class="flex items-center gap-2">
            <input
              v-model.number="topicFilter"
              type="range"
              min="5"
              :max="Math.max(5, topicData.statistics.totalTopics || 15)"
              step="1"
              class="flex-1 sm:w-32 md:w-48 slider-blue"
            />
            <span class="font-semibold min-w-[2rem] text-right text-blue-600 dark:text-blue-400">{{ topicFilter }}</span>
          </div>
        </label>
        
        <label class="flex items-center gap-2 text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
          <input
            v-model="normalizedView"
            type="checkbox"
            class="w-4 h-4 rounded checkbox-blue"
          />
          <span>Normierte Ansicht (100%/Jahr)</span>
        </label>
      </div>
    </div>

    <TopicRiver 
      ref="topicRiverRef"
      :data="topicData" 
      color="blue"
      v-model:normalized-view="normalizedView"
      v-model:topic-filter="topicFilter"
    />
    </div>
    
    <!-- Toggle Buttons -->
    <template v-if="topicRiverRef">
      <div v-if="topicRiverRef.selectedTopicInfo" class="mt-6 flex justify-center gap-2 mb-4">
        <button
          @click="topicRiverRef.setShowEpisodeList(true); topicRiverRef.setShowTopicList(false);"
          :class="[
            'text-sm font-semibold px-3 py-1 rounded transition-colors',
            topicRiverRef.showEpisodeList 
              ? 'bg-blue-600 text-white'
              : 'text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300'
          ]"
        >
          Episoden
        </button>
        <button
          @click="() => { 
            if (topicRiverRef) {
              topicRiverRef.setShowEpisodeList(false);
              topicRiverRef.setShowTopicList(true);
              if (topicRiverRef.selectedTopicInfo) {
                topicRiverRef.loadAllTopics();
              }
            }
          }"
          :class="[
            'text-sm font-semibold px-3 py-1 rounded transition-colors',
            topicRiverRef.showTopicList 
              ? 'bg-blue-600 text-white'
              : 'text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300'
          ]"
        >
          Topics
        </button>
      </div>
      
      <!-- Episodes Table -->
      <div v-if="topicRiverRef.selectedTopicInfo && topicRiverRef.showEpisodeList" class="mt-6">
        <div v-if="topicRiverRef.loadingEpisodes" class="p-4 text-center text-gray-600 dark:text-gray-400">
          Lade Episoden-Details...
        </div>
        <EpisodeTable
          ref="episodeTableRef"
          v-else
          :episodes="topicRiverRef.selectedTopicInfo.episodes"
          :episode-details="topicRiverRef.episodeDetails"
          :loading-episodes="topicRiverRef.loadingEpisodes"
          :get-topic-occurrences="topicRiverRef.getTopicOccurrences"
          :play-episode-at="topicRiverRef.playEpisodeAt"
          :format-occurrence-label="topicRiverRef.formatOccurrenceLabel"
          :format-hms-from-seconds="topicRiverRef.formatHmsFromSeconds"
          :format-duration="topicRiverRef.formatDuration"
          theme-color="blue"
          :show-play-button="true"
        >
          <template #header>
            <div class="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h2 class="text-lg font-semibold text-blue-900 dark:text-blue-100">
                  Episoden: {{ topicRiverRef.selectedTopicInfo.name }}{{ topicRiverRef.selectedYear ? ` (${topicRiverRef.selectedYear})` : '' }}
                </h2>
                <!-- Year Filter Badge -->
                <div v-if="topicRiverRef.selectedYear" class="mt-2 inline-flex items-center gap-2 text-white px-3 py-1 rounded-full text-sm font-semibold bg-blue-600">
                  <span>📅 Jahr: {{ topicRiverRef.selectedYear }}</span>
                  <button 
                    @click="topicRiverRef.setSelectedYear(null)"
                    class="rounded-full w-5 h-5 flex items-center justify-center transition-colors hover:bg-blue-700"
                    title="Jahr-Filter entfernen"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <button
                @click="topicRiverRef.setSelectedTopic(null); topicRiverRef.setSelectedYear(null); topicRiverRef.setShowEpisodeList(false); topicRiverRef.setShowTopicList(false);"
                class="font-semibold p-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>
          </template>
        </EpisodeTable>
      </div>
      
      <!-- Topics List -->
      <div v-if="topicRiverRef.selectedTopicInfo && topicRiverRef.showTopicList" class="mt-6">
        <div class="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-blue-300 dark:border-blue-700 overflow-hidden">
          <div v-if="topicRiverRef.loadingTopics" class="p-4 text-center text-gray-600 dark:text-gray-400">
            Lade alle Topics...
          </div>
          <div v-else class="max-h-96 overflow-y-auto">
            <div class="p-3 sticky top-0 bg-blue-100 dark:bg-blue-900 border-b border-blue-200 dark:border-blue-700">
              <div class="flex items-center justify-between flex-wrap gap-4">
                <p class="text-sm font-semibold text-blue-900 dark:text-blue-100">
                  {{ topicRiverRef.allIndividualTopics?.length || 0 }} einzelne Topics gefunden
                </p>
                <button
                  @click="topicRiverRef.setSelectedTopic(null); topicRiverRef.setSelectedYear(null); topicRiverRef.setShowEpisodeList(false); topicRiverRef.setShowTopicList(false);"
                  class="font-semibold p-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  aria-label="Schließen"
                >
                  ✕
                </button>
              </div>
            </div>
            <div class="divide-y divide-blue-100 dark:divide-blue-800">
              <div 
                v-for="(topicItem, index) in topicRiverRef.allIndividualTopics" 
                :key="`${topicItem.episodeNumber}-${index}`"
                class="p-3 hover:bg-blue-50 dark:hover:bg-blue-900/20"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ topicItem.topic }}</p>
                    <div class="mt-1 flex flex-wrap gap-1 items-center">
                      <span 
                        v-if="topicItem.clusterName"
                        class="inline-block px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded font-medium"
                      >
                        📁 {{ topicItem.clusterName }}
                      </span>
                      <span 
                        v-for="keyword in topicItem.keywords" 
                        :key="keyword"
                        class="inline-block px-2 py-0.5 text-xs rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                      >
                        {{ keyword }}
                      </span>
                    </div>
                  </div>
                  <div class="text-right whitespace-nowrap">
                    <a 
                      :href="topicRiverRef.episodeDetails.get(topicItem.episodeNumber)?.url || `https://freakshow.fm/${topicItem.episodeTitle.toLowerCase().split(' ')[0]}`"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      {{ topicItem.episodeTitle }}
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
    
    <!-- Footer -->
    <div class="mt-6 text-center text-gray-500 dark:text-gray-400 text-xs sm:text-sm">
      <p>Generiert am: {{ new Date(topicData.generatedAt).toLocaleString('de-DE') }}</p>
    </div>
  </div>
</template>

