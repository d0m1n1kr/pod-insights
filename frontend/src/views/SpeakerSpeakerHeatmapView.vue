<template>
  <div class="flex flex-col h-full bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
    <!-- Header -->
    <div class="p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-teal-50 to-teal-100 dark:from-teal-900/20 dark:to-teal-900/30 rounded-t-xl">
      <div v-if="heatmapData" class="grid grid-cols-2 gap-4">
        <div class="text-center">
          <div class="text-3xl font-bold text-teal-600 dark:text-teal-400">{{ heatmapData.statistics.totalSpeakers }}</div>
          <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">Sprecher insgesamt</p>
        </div>
        <div class="text-center">
          <div class="text-3xl font-bold text-teal-600 dark:text-teal-400">{{ heatmapData.statistics.totalCombinations }}</div>
          <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">Kombinationen</p>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 overflow-hidden">
      <!-- Heatmap -->
      <div class="flex-1 overflow-auto p-6" ref="heatmapContainer">
        <div v-if="!heatmapData" class="flex items-center justify-center h-full">
          <p class="text-gray-500 dark:text-gray-400">Lade Daten...</p>
        </div>
        <div v-else>
          <!-- Controls -->
          <div class="mb-6 flex gap-6 flex-wrap items-center">
            <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
              Sprecher 1:
              <input
                v-model.number="settingsStore.topNSpeakersSpeaker1Heatmap"
                type="range"
                min="5"
                :max="heatmapData.statistics.totalSpeakers"
                step="1"
                class="ml-2 w-48 slider-teal"
              />
              <span class="ml-2 text-teal-600 dark:text-teal-400 font-semibold">{{ settingsStore.topNSpeakersSpeaker1Heatmap }}</span>
            </label>
            
            <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
              Sprecher 2:
              <input
                v-model.number="settingsStore.topNSpeakersSpeaker2Heatmap"
                type="range"
                min="10"
                :max="heatmapData.statistics.totalSpeakers"
                step="1"
                class="ml-2 w-48 slider-teal"
              />
              <span class="ml-2 text-teal-600 dark:text-teal-400 font-semibold">{{ settingsStore.topNSpeakersSpeaker2Heatmap }}</span>
            </label>
          </div>

          <!-- Selected Cell Details -->
          <div v-if="selectedCell" class="mb-6 p-4 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-lg">
            <div class="relative">
              <button
                @click="clearSelection"
                class="absolute top-2 right-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
                aria-label="Schließen"
              >
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fill-rule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clip-rule="evenodd"
                  />
                </svg>
              </button>

              <div class="min-w-0">
                <div class="pr-10">
                  <h3 class="font-semibold text-lg text-teal-900 dark:text-teal-100">
                    {{ selectedCell.speaker1Name }} → {{ selectedCell.speaker2Name }}
                  </h3>
                  <p class="text-sm text-teal-600 dark:text-teal-400 mt-2">
                    <strong>{{ selectedCell.episodes.length }}</strong> Episoden in dieser Kombination
                  </p>
                  
                  <div class="mt-3">
                    <button
                      @click="showEpisodeList = !showEpisodeList"
                      class="text-sm text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300 font-semibold underline"
                    >
                      {{ showEpisodeList ? 'Episoden ausblenden' : `${selectedCell.episodes.length} Episoden anzeigen` }}
                    </button>
                  </div>
                </div>


                <!-- Episode List -->
                <div v-if="showEpisodeList" class="mt-4 bg-white dark:bg-gray-900 rounded-lg border border-teal-300 dark:border-teal-700">
                  <div v-if="loadingEpisodes" class="p-4 text-center text-gray-600 dark:text-gray-400">
                    Lade Episoden-Details...
                  </div>
                  <div v-else class="max-h-96 overflow-auto">
                    <table class="min-w-full w-max text-sm table-auto">
                      <thead class="bg-teal-100 dark:bg-teal-900 sticky top-0">
                        <tr>
                          <th class="px-3 py-2 text-left text-xs font-semibold text-teal-900 dark:text-teal-100 whitespace-nowrap">#</th>
                          <th class="px-3 py-2 text-left text-xs font-semibold text-teal-900 dark:text-teal-100 whitespace-nowrap">Bild</th>
                          <th class="px-3 py-2 text-left text-xs font-semibold text-teal-900 dark:text-teal-100 whitespace-nowrap">Datum</th>
                          <th class="px-3 py-2 text-left text-xs font-semibold text-teal-900 dark:text-teal-100">Titel</th>
                          <th class="px-3 py-2 text-left text-xs font-semibold text-teal-900 dark:text-teal-100 whitespace-nowrap">Play</th>
                          <th class="px-3 py-2 text-left text-xs font-semibold text-teal-900 dark:text-teal-100 whitespace-nowrap">Dauer</th>
                          <th class="px-3 py-2 text-left text-xs font-semibold text-teal-900 dark:text-teal-100 whitespace-nowrap">Sprecher</th>
                          <th class="px-3 py-2 text-left text-xs font-semibold text-teal-900 dark:text-teal-100 whitespace-nowrap">Link</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr 
                          v-for="episodeNum in selectedCell.episodes" 
                          :key="episodeNum"
                          :data-episode-row="episodeNum"
                          class="border-t border-teal-100 dark:border-teal-800 hover:bg-teal-50 dark:hover:bg-teal-900/50"
                        >
                          <template v-if="episodeDetails.has(episodeNum) && episodeDetails.get(episodeNum) !== null">
                            <td class="px-3 py-2 text-teal-700 dark:text-teal-300 text-xs whitespace-nowrap font-mono">
                              {{ episodeNum }}
                            </td>
                            <td class="px-3 py-2">
                              <img
                                :src="getEpisodeImageUrl(episodeNum)"
                                :alt="episodeDetails.get(episodeNum)?.title || `Episode ${episodeNum}`"
                                @error="($event.target as HTMLImageElement).style.display = 'none'"
                                class="w-12 h-12 rounded object-cover border border-gray-200 dark:border-gray-700"
                              />
                            </td>
                            <td class="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap text-xs">
                              {{ formatDate(episodeDetails.get(episodeNum)?.date) }}
                            </td>
                            <td class="px-3 py-2 text-gray-900 dark:text-gray-100 text-xs">
                              <router-link
                                :to="{ name: 'episodeSearch', query: { episode: episodeNum.toString(), podcast: settingsStore.selectedPodcast || 'freakshow' } }"
                                class="truncate text-teal-600 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 hover:underline"
                              >
                                {{ episodeDetails.get(episodeNum)?.title }}
                              </router-link>
                            </td>
                            <td class="px-3 py-2">
                              <button
                                type="button"
                                class="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                                @click="playEpisodeAt(episodeNum, 0, 'Start')"
                                title="Episode von Anfang abspielen"
                                aria-label="Episode von Anfang abspielen"
                              >
                                ▶︎
                              </button>
                            </td>
                            <td class="px-3 py-2 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">
                              <template v-if="episodeDetails.get(episodeNum)?.duration">
                                {{ formatDuration(episodeDetails.get(episodeNum)?.duration) }}
                              </template>
                              <template v-else>—</template>
                            </td>
                            <td class="px-3 py-2 text-xs whitespace-nowrap">
                              <template v-if="(episodeDetails.get(episodeNum)?.speakers?.length || 0) > 0">
                                <template v-for="(speaker, idx) in episodeDetails.get(episodeNum)?.speakers || []" :key="`${episodeNum}-${idx}`">
                                  <span
                                    :class="[
                                      'inline-block',
                                      speaker === selectedCell?.speaker1Name || speaker === selectedCell?.speaker2Name
                                        ? 'font-semibold text-teal-700 dark:text-teal-300 bg-teal-100 dark:bg-teal-900/30 px-1 rounded' 
                                        : 'text-gray-600 dark:text-gray-400'
                                    ]"
                                  >{{ speaker }}</span><span v-if="idx < ((episodeDetails.get(episodeNum)?.speakers?.length || 0) - 1)" class="text-gray-600 dark:text-gray-400">, </span>
                                </template>
                              </template>
                              <template v-else>—</template>
                            </td>
                            <td class="px-3 py-2">
                              <a 
                                v-if="episodeDetails.get(episodeNum)?.url"
                                :href="episodeDetails.get(episodeNum)?.url" 
                                target="_blank"
                                rel="noopener noreferrer"
                                class="text-teal-600 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 text-xs underline"
                              >
                                🔗
                              </a>
                              <span v-else class="text-gray-400 dark:text-gray-500 text-xs">—</span>
                            </td>
                          </template>
                          <template v-else-if="episodeDetails.get(episodeNum) === null">
                            <td class="px-3 py-2 text-teal-700 dark:text-teal-300 text-xs whitespace-nowrap font-mono">
                              {{ episodeNum }}
                            </td>
                            <td class="px-3 py-2">
                              <img
                                :src="getEpisodeImageUrl(episodeNum)"
                                :alt="`Episode ${episodeNum}`"
                                @error="($event.target as HTMLImageElement).style.display = 'none'"
                                class="w-12 h-12 rounded object-cover border border-gray-200 dark:border-gray-700"
                              />
                            </td>
                            <td colspan="5" class="px-3 py-2 text-gray-400 dark:text-gray-500 text-xs italic">
                              Details nicht verfügbar
                            </td>
                          </template>
                          <template v-else>
                            <td class="px-3 py-2 text-teal-700 dark:text-teal-300 text-xs whitespace-nowrap font-mono">
                              {{ episodeNum }}
                            </td>
                            <td class="px-3 py-2">
                              <img
                                :src="getEpisodeImageUrl(episodeNum)"
                                :alt="`Episode ${episodeNum}`"
                                @error="($event.target as HTMLImageElement).style.display = 'none'"
                                class="w-12 h-12 rounded object-cover border border-gray-200 dark:border-gray-700"
                              />
                            </td>
                            <td colspan="5" class="px-3 py-2 text-gray-400 dark:text-gray-500 text-xs">
                              Lade...
                            </td>
                          </template>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- SVG Container -->
          <svg ref="svgElement" class="w-full"></svg>
          
          <!-- Interaction Instructions -->
          <div class="mt-4 sm:mt-6 text-xs sm:text-sm text-gray-600 dark:text-gray-400">
            <p>
              <strong>{{ $t('common.interaction') }}:</strong> 
              {{ $t('heatmap.interaction.hover') }} 
              {{ $t('heatmap.interaction.click') }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch, reactive, nextTick, onUnmounted } from 'vue';
import {
  select,
  selectAll,
  scaleBand,
  scaleLinear,
  scaleSequential,
  axisBottom,
  min,
  max,
  range,
  rgb,
  interpolateBuGn
} from '@/utils/d3-imports';
import type { HeatmapData } from '../types';
import { useSettingsStore } from '../stores/settings';
import { useAudioPlayerStore } from '@/stores/audioPlayer';
import { getPodcastFileUrl, getSpeakersBaseUrl, getEpisodeImageUrl, getEpisodeUrl, withBase } from '@/composables/usePodcast';
import { useInlineEpisodePlayer } from '@/composables/useInlineEpisodePlayer';
import { useLazyEpisodeDetails, type EpisodeDetail as EpisodeDetailType, loadEpisodeDetail, getCachedEpisodeDetail } from '@/composables/useEpisodeDetails';
import { useSpeakerMeta } from '@/composables/useSpeakerMeta';

const settingsStore = useSettingsStore();
const audioPlayerStore = useAudioPlayerStore();
const inlinePlayer = reactive(useInlineEpisodePlayer());


// Helper function to play episode using global store
const playEpisodeAt = async (episodeNumber: number, seconds: number, label: string) => {
  await inlinePlayer.ensureMp3Index();
  const mp3 = inlinePlayer.mp3UrlByEpisode.get(episodeNumber) || null;
  if (!mp3) {
    await inlinePlayer.openEpisodeAt(episodeNumber, seconds);
    return;
  }


  audioPlayerStore.play({
    src: mp3,
    title: `Episode ${episodeNumber}`,
    subtitle: label,
    seekToSec: Math.max(0, Math.floor(seconds)),
    autoplay: true,
    transcriptSrc: withBase(getPodcastFileUrl(`episodes/${episodeNumber}-ts-live.json`)),
    speakersMetaUrl: getSpeakersBaseUrl(),
  });
};

// EpisodeDetail type is imported from useEpisodeDetails composable

// Use speaker meta composable (uses index-meta.json to reduce 404 requests)
const { loadSpeakers, getSpeakerImage } = useSpeakerMeta();

const heatmapData = ref<HeatmapData | null>(null);
const svgElement = ref<SVGSVGElement | null>(null);
const heatmapContainer = ref<HTMLDivElement | null>(null);

type HeatmapFocus = { type: 'row'; id: string } | { type: 'col'; id: string } | null;
const activeHeatmapFocus = ref<HeatmapFocus>(null);

const selectedCell = ref<{
  speaker1Name: string;
  speaker2Name: string;
  count: number;
  episodes: number[];
} | null>(null);

const showEpisodeList = ref(false);
const loadingEpisodes = ref(false);

// Use lazy loading composable
const { setupLazyLoad, preloadVisible } = useLazyEpisodeDetails();

// Local map to track which episodes are loaded (synced with global cache)
const episodeDetails = ref<Map<number, EpisodeDetailType | null>>(new Map());
const observerCleanups = ref<Map<number, () => void>>(new Map());

// Prevent race conditions when quickly switching selected cells / toggling episode list.
let episodeDetailsRequestId = 0;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Filtered data based on slider values
const filteredData = computed(() => {
  if (!heatmapData.value) return { speakers1: [], speakers2: [] };
  
  // Get top N speakers for axis 1 (already sorted by episodes in the data)
  const speakers1 = heatmapData.value.speakers.slice(0, settingsStore.topNSpeakersSpeaker1Heatmap);
  
  // Get top N speakers for axis 2 (already sorted by episodes in the data)
  const speakers2 = heatmapData.value.speakers.slice(0, settingsStore.topNSpeakersSpeaker2Heatmap);
  
  return { speakers1, speakers2 };
});

const filteredMatrix = computed(() => {
  if (!heatmapData.value) return [];
  
  const { speakers1, speakers2 } = filteredData.value;
  const speaker1Ids = new Set(speakers1.map(s => s.id));
  const speaker2Ids = new Set(speakers2.map(s => s.id));
  
  // Filter matrix by selected speakers
  let matrix = heatmapData.value.matrix.filter(row => row.speakerId && speaker1Ids.has(row.speakerId));
  
  // Filter values by selected speakers
  matrix = matrix.map(row => ({
    ...row,
    values: row.values.filter(val => val.speakerId && speaker2Ids.has(val.speakerId))
  }));
  
  return matrix;
});

const filteredSpeakers2 = computed(() => {
  return filteredData.value.speakers2;
});

function clearSelection() {
  selectedCell.value = null;
  showEpisodeList.value = false;
}

async function loadEpisodeDetailWithRetry(episodeNum: number, attempts: number): Promise<EpisodeDetailType | null> {
  for (let i = 0; i < attempts; i++) {
    const detail = await loadEpisodeDetail(episodeNum);
    if (detail) return detail as EpisodeDetailType;
    if (i < attempts - 1) await sleep(150 * (i + 1));
  }
  return null;
}

async function loadEpisodeDetailNoStore(episodeNum: number): Promise<EpisodeDetailType | null> {
  try {
    const res = await fetch(withBase(getEpisodeUrl(episodeNum)), { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;
    const speakers = Array.isArray((data as any).speakers) ? (data as any).speakers : [];
    return {
      ...(data as any),
      number: (data as any).number ?? episodeNum,
      title: (data as any).title || '',
      date: (data as any).date,
      duration: (data as any).duration,
      speakers,
      url: (data as any).url,
    } as EpisodeDetailType;
  } catch {
    return null;
  }
}

// Setup lazy loading for episode rows
async function setupLazyLoadingForEpisodes(episodeNumbers: number[], requestId: number) {
  const isStale = () => requestId !== episodeDetailsRequestId;
  if (isStale()) return;
  // Clean up existing observers
  observerCleanups.value.forEach(cleanup => cleanup());
  observerCleanups.value.clear();

  // Prime ALL rows immediately with episodes.json metadata so table cells don't stay blank
  await inlinePlayer.ensureMp3Index();
  if (isStale()) return;
  for (const episodeNum of episodeNumbers) {
    if (isStale()) return;
    const existingDetail = episodeDetails.value.get(episodeNum);
    
    // If episode already exists, check if we need to update speakers
    if (existingDetail) {
      const meta = inlinePlayer.episodeMetaByEpisode.get(episodeNum) || null;
      
      // Update speakers if missing or empty
      if (meta && (!Array.isArray(existingDetail.speakers) || existingDetail.speakers.length === 0) && Array.isArray(meta.speakers) && meta.speakers.length > 0) {
        episodeDetails.value.set(episodeNum, {
          ...existingDetail,
          speakers: meta.speakers,
        });
        continue;
      }
      
      // If we have full details (no fallback), skip priming
      if (!(existingDetail as any)?._fallback) {
        continue;
      }
    }
    
    // Prime with episodes.json metadata
    const meta = inlinePlayer.episodeMetaByEpisode.get(episodeNum) || null;
    if (
      meta &&
      (meta.title ||
        meta.date ||
        Number.isFinite(meta.durationSec as number) ||
        meta.pageUrl ||
        (Array.isArray(meta.speakers) && meta.speakers.length > 0))
    ) {
      episodeDetails.value.set(episodeNum, {
        title: meta.title || `Episode ${episodeNum}`,
        date: meta.date,
        duration: typeof meta.durationSec === 'number' && Number.isFinite(meta.durationSec) ? meta.durationSec : undefined,
        speakers: Array.isArray(meta.speakers) ? meta.speakers : [],
        url: meta.pageUrl || undefined,
        number: episodeNum,
        _fallback: 'episodes.json',
      });
    } else {
      episodeDetails.value.set(episodeNum, {
        title: `Episode ${episodeNum}`,
        date: '',
        speakers: [],
        number: episodeNum,
        _fallback: 'minimal',
      });
    }
  }

  // Preload first few visible episodes immediately
  const visibleCount = Math.min(5, episodeNumbers.length);
  if (visibleCount > 0) {
    await preloadVisible(episodeNumbers.slice(0, visibleCount));
    if (isStale()) return;
    // Sync with local map
    episodeNumbers.slice(0, visibleCount).forEach(num => {
      const cached = getCachedEpisodeDetail(num);
      if (cached !== undefined) {
        // Don't overwrite fallback row with cached "missing" marker.
        if (cached !== null) {
          // Merge cached data with episodes.json - prefer episodes.json for speakers
          const meta = inlinePlayer.episodeMetaByEpisode.get(num);
          const merged = {
            ...cached,
            // Keep speakers from episodes.json if cached doesn't have them
            speakers: (Array.isArray(cached.speakers) && cached.speakers.length > 0)
              ? cached.speakers
              : (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0 ? meta.speakers : []),
          };
          episodeDetails.value.set(num, merged);
        } else {
          const cur: any = episodeDetails.value.get(num);
          if (!cur || cur === null) episodeDetails.value.set(num, null);
        }
      }
    });
  }

  // SpeakerRiver-style: batch-load ALL remaining episodes in the background (no scrolling required)
  await nextTick();
  await nextTick();
  await new Promise(resolve => requestAnimationFrame(resolve));
  if (isStale()) return;

  const toLoad = episodeNumbers.filter(num => {
    const cached = getCachedEpisodeDetail(num);
    if (cached !== undefined) return false;
    const cur: any = episodeDetails.value.get(num);
    return !cur || cur === null || Boolean(cur._fallback);
  });

  if (toLoad.length > 0) {
    const batchSize = 10;
    for (let i = 0; i < toLoad.length; i += batchSize) {
      if (isStale()) return;
      const batch = toLoad.slice(i, i + batchSize);
      await Promise.all(batch.map(async (episodeNum) => {
        if (isStale()) return;
        const cached = getCachedEpisodeDetail(episodeNum);
        if (cached !== undefined) {
          if (cached !== null) {
          // Merge cached data with episodes.json - ALWAYS prefer episodes.json for speakers
          const meta = inlinePlayer.episodeMetaByEpisode.get(episodeNum);
          const merged = {
            ...cached,
            // ALWAYS prefer speakers from episodes.json if available
            speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
              ? meta.speakers
              : (Array.isArray(cached.speakers) && cached.speakers.length > 0 ? cached.speakers : []),
          };
            episodeDetails.value.set(episodeNum, merged);
          } else {
            const cur: any = episodeDetails.value.get(episodeNum);
            if (!cur || cur === null) episodeDetails.value.set(episodeNum, null);
          }
          return;
        }

        const retried = await loadEpisodeDetailWithRetry(episodeNum, 2);
        if (isStale()) return;
        if (retried) {
          // Merge with episodes.json data - ALWAYS prefer episodes.json for speakers
          const meta = inlinePlayer.episodeMetaByEpisode.get(episodeNum);
          const merged = {
            ...retried,
            // ALWAYS prefer speakers from episodes.json if available
            speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
              ? meta.speakers
              : (Array.isArray(retried.speakers) && retried.speakers.length > 0 ? retried.speakers : []),
          };
          episodeDetails.value.set(episodeNum, merged);
          return;
        }

        const direct = await loadEpisodeDetailNoStore(episodeNum);
        if (isStale()) return;
        if (direct) {
          // Merge with episodes.json data - ALWAYS prefer episodes.json for speakers
          const meta = inlinePlayer.episodeMetaByEpisode.get(episodeNum);
          const merged = {
            ...direct,
            // ALWAYS prefer speakers from episodes.json if available
            speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
              ? meta.speakers
              : (Array.isArray(direct.speakers) && direct.speakers.length > 0 ? direct.speakers : []),
          };
          episodeDetails.value.set(episodeNum, merged);
        }
      }));
    }
  }

  // Setup lazy loading for remaining episodes
  await nextTick();
  if (isStale()) return;
  episodeNumbers.forEach(episodeNum => {
    // Check if already cached
    const cached = getCachedEpisodeDetail(episodeNum);
    if (cached !== undefined) {
      if (cached !== null) {
        episodeDetails.value.set(episodeNum, cached);
      } else {
        const cur: any = episodeDetails.value.get(episodeNum);
        if (!cur || cur === null) episodeDetails.value.set(episodeNum, null);
      }
      return;
    }

    // Find the row element and setup observer
    const rowElement = document.querySelector(`[data-episode-row="${episodeNum}"]`) as HTMLElement;
    if (rowElement) {
      const cleanup = setupLazyLoad(
        rowElement,
        episodeNum,
        async (detail) => {
          if (isStale()) return;
          const meta = inlinePlayer.episodeMetaByEpisode.get(episodeNum);
          
          if (detail) {
            // Merge with episodes.json data - ALWAYS prefer episodes.json for speakers
            const merged = {
              ...detail,
              // ALWAYS prefer speakers from episodes.json if available
              speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
                ? meta.speakers
                : (Array.isArray(detail.speakers) && detail.speakers.length > 0 ? detail.speakers : []),
            };
            episodeDetails.value.set(episodeNum, merged);
            return;
          }
          // If lazy-load returned null, try retry + no-store rescue before marking unavailable.
          const retried = await loadEpisodeDetailWithRetry(episodeNum, 2);
          if (isStale()) return;
          if (retried) {
            // Merge with episodes.json data - ALWAYS prefer episodes.json for speakers
            const merged = {
              ...retried,
              // ALWAYS prefer speakers from episodes.json if available
              speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
                ? meta.speakers
                : (Array.isArray(retried.speakers) && retried.speakers.length > 0 ? retried.speakers : []),
            };
            episodeDetails.value.set(episodeNum, merged);
            return;
          }
          const direct = await loadEpisodeDetailNoStore(episodeNum);
          if (isStale()) return;
          if (direct) {
            // Merge with episodes.json data - ALWAYS prefer episodes.json for speakers
            const merged = {
              ...direct,
              // ALWAYS prefer speakers from episodes.json if available
              speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
                ? meta.speakers
                : (Array.isArray(direct.speakers) && direct.speakers.length > 0 ? direct.speakers : []),
            };
            episodeDetails.value.set(episodeNum, merged);
          }
        }
      );
      observerCleanups.value.set(episodeNum, cleanup);
    } else {
      // Element not found, load immediately
      (async () => {
        const meta = inlinePlayer.episodeMetaByEpisode.get(episodeNum);
        const retried = await loadEpisodeDetailWithRetry(episodeNum, 2);
        if (isStale()) return;
        if (retried) {
          // Merge with episodes.json data - ALWAYS prefer episodes.json for speakers
          const merged = {
            ...retried,
            // ALWAYS prefer speakers from episodes.json if available
            speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
              ? meta.speakers
              : (Array.isArray(retried.speakers) && retried.speakers.length > 0 ? retried.speakers : []),
          };
          episodeDetails.value.set(episodeNum, merged);
          return;
        }
        const direct = await loadEpisodeDetailNoStore(episodeNum);
        if (isStale()) return;
        if (direct) {
          // Merge with episodes.json data - ALWAYS prefer episodes.json for speakers
          const merged = {
            ...direct,
            // ALWAYS prefer speakers from episodes.json if available
            speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
              ? meta.speakers
              : (Array.isArray(direct.speakers) && direct.speakers.length > 0 ? direct.speakers : []),
          };
          episodeDetails.value.set(episodeNum, merged);
        }
      })();
    }
  });
}

// Legacy function for compatibility (now uses lazy loading)
async function loadEpisodeDetails(episodeNumbers: number[]) {
  // Normalize + dedupe (defensive)
  const normalized = Array.from(new Set(episodeNumbers.map(n => Number(n)).filter(n => Number.isFinite(n))));

  const requestId = ++episodeDetailsRequestId;
  loadingEpisodes.value = true;
  try {
    await setupLazyLoadingForEpisodes(normalized, requestId);
  } finally {
    if (requestId === episodeDetailsRequestId) {
      loadingEpisodes.value = false;
    }
  }
}

function formatDate(dateString: string | undefined): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('de-DE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function formatDuration(duration: string | number | number[] | undefined): string {
  if (!duration) return 'N/A';
  
  // If it's already a string (formatted), return it
  if (typeof duration === 'string') return duration;
  
  // If it's an array [hours, minutes, seconds], convert to seconds first
  let durationInSeconds: number;
  if (Array.isArray(duration) && duration.length === 3) {
    const [h, m, s] = duration;
    durationInSeconds = (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0);
  } else if (typeof duration === 'number') {
    durationInSeconds = duration;
  } else {
    return 'N/A';
  }
  
  // Format as seconds
  const hours = Math.floor(durationInSeconds / 3600);
  const minutes = Math.floor((durationInSeconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// Watch for selection changes to load episode details
watch(selectedCell, async (newCell) => {
  if (newCell && newCell.episodes.length > 0) {
    await loadEpisodeDetails(newCell.episodes);
  }
});

// Cleanup observers on unmount
onUnmounted(() => {
  observerCleanups.value.forEach(cleanup => cleanup());
  observerCleanups.value.clear();
});

function drawHeatmap() {
  if (!svgElement.value || !heatmapData.value || !heatmapContainer.value) return;

  // Remove all existing tooltips first
  selectAll('.heatmap-tooltip').remove();

  const svg = select(svgElement.value);
  svg.selectAll('*').remove();

  const matrix = filteredMatrix.value;
  const speakers2 = filteredSpeakers2.value;

  if (matrix.length === 0 || speakers2.length === 0) {
    svg.append('text')
      .attr('x', 200)
      .attr('y', 100)
      .attr('text-anchor', 'middle')
      .attr('class', 'text-gray-500 dark:text-gray-400')
      .text('Keine Daten für die ausgewählten Filter');
    return;
  }

  // Dimensions
  const containerWidth = heatmapContainer.value.clientWidth - 48; // padding
  
  // Responsive margins based on viewport
  const isMobile = containerWidth < 640;
  const isTablet = containerWidth >= 640 && containerWidth < 1024;
  
  const cellSize = Math.min(30, Math.max(10, containerWidth / (speakers2.length + 10)));
  const margin = isMobile
    ? { top: 80, right: 10, bottom: 20, left: 60 }
    : isTablet
    ? { top: 120, right: 15, bottom: 20, left: 100 }
    : { top: 180, right: 20, bottom: 20, left: 200 };
  const width = speakers2.length * cellSize;
  const height = matrix.length * cellSize;

  svg.attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom);

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Color scale + row/col hover normalization (in-place update, no redraw)
  const allCounts = matrix.flatMap(row => row.values.map(v => v.count)).filter(c => c > 0);
  const globalMin = min(allCounts) ?? 0;
  const globalMax = max(allCounts) ?? 0;

  function normalizeDomain(min: number, max: number): [number, number] {
    if (!Number.isFinite(max) || max <= 0) return [0, 1];
    if (!Number.isFinite(min) || min < 0) min = 0;
    if (min === max) min = 0;
    return [min, max];
  }

  const globalDomain = normalizeDomain(globalMin, globalMax);
  let currentDomain: [number, number] = globalDomain;
  let colorScale = scaleSequential(interpolateBuGn).domain(currentDomain);

  function getEmptyCellColor() {
    const isDark = document.documentElement.classList.contains('dark');
    return isDark ? '#1f2937' : '#f0f0f0';
  }

  function getTextColorForCount(count: number): string {
    const color = rgb(colorScale(count));
    const luminance = (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255;
    return luminance > 0.5 ? '#1f2937' : 'white';
  }

  function getRowDomain(rowId: string): [number, number] {
    const row = matrix.find(r => (r.speakerId || '') === rowId);
    if (!row) return globalDomain;
    const counts = row.values.map(v => v.count).filter(c => c > 0);
    if (counts.length === 0) return globalDomain;
    return normalizeDomain(min(counts) ?? 0, max(counts) ?? 0);
  }

  function getColDomain(colId: string): [number, number] {
    const counts = matrix
      .flatMap(r => r.values)
      .filter(v => (v.speakerId || '') === colId)
      .map(v => v.count)
      .filter(c => c > 0);
    if (counts.length === 0) return globalDomain;
    return normalizeDomain(min(counts) ?? 0, max(counts) ?? 0);
  }

  // X axis (speakers on x-axis)
  const xScale = scaleBand()
    .domain(speakers2.map(s => s.id))
    .range([0, width])
    .padding(0.05);

  // Y axis (speakers on y-axis)
  const yScale = scaleBand()
    .domain(matrix.map(row => row.speakerId || '').filter(id => id))
    .range([0, height])
    .padding(0.05);

  // Draw cells
  matrix.forEach((row) => {
    if (!row.speakerId) return;
    row.values.forEach((value) => {
      if (!value.speakerId) return;
      
      const x = xScale(value.speakerId);
      const y = yScale(row.speakerId || '');
      
      if (x === undefined || y === undefined) return;

      const cellGroup = g.append('g')
        .attr('class', 'cell-group')
        .style('cursor', value.count > 0 ? 'pointer' : 'default');

      const rowId = row.speakerId || '';
      const colId = value.speakerId || '';

      cellGroup.append('rect')
        .attr('class', 'heatmap-cell')
        .attr('data-row-id', rowId)
        .attr('data-col-id', colId)
        .attr('data-count', String(value.count))
        .attr('x', x)
        .attr('y', y)
        .attr('width', xScale.bandwidth())
        .attr('height', yScale.bandwidth())
        .attr('fill', value.count > 0 ? colorScale(value.count) : getEmptyCellColor())
        .attr('stroke', 'none')
        .attr('stroke-width', 0)
        .on('mouseover', function(event) {
          if (value.count === 0) return;
          
          select(this)
            .attr('stroke', '#000')
            .attr('stroke-width', 2);

          // Remove any existing tooltips first
          selectAll('.heatmap-tooltip').remove();

          // Get speaker images
          const speaker1Image = getSpeakerImage(row.speaker1Name || row.speakerName || '');
          const speaker2Image = getSpeakerImage(value.speaker2Name || '');
          
          const speaker1ImageHtml = speaker1Image
            ? `<img src="${speaker1Image}" alt="${row.speaker1Name}" class="w-8 h-8 rounded-full border-2 border-white inline-block mr-2" />`
            : '';
          const speaker2ImageHtml = speaker2Image
            ? `<img src="${speaker2Image}" alt="${value.speaker2Name}" class="w-8 h-8 rounded-full border-2 border-white inline-block mr-2" />`
            : '';

          // Create tooltip
          select('body').append('div')
            .attr('class', 'heatmap-tooltip')
            .style('position', 'absolute')
            .style('background', 'rgba(0, 0, 0, 0.8)')
            .style('color', 'white')
            .style('padding', '8px')
            .style('border-radius', '4px')
            .style('pointer-events', 'none')
            .style('font-size', '12px')
            .style('z-index', '1000')
            .html(`
              <div>${speaker1ImageHtml}<strong>${row.speaker1Name}</strong></div>
              <div class="mt-1">${speaker2ImageHtml}${value.speaker2Name}</div>
              <div class="mt-1">${value.count} Episoden</div>
            `)
            .style('left', (event.pageX + 10) + 'px')
            .style('top', (event.pageY - 28) + 'px');
        })
        .on('mouseout', function() {
          select(this)
            .attr('stroke', 'none')
            .attr('stroke-width', 0);

          // Remove tooltip
          selectAll('.heatmap-tooltip').remove();
        })
        .on('click', function() {
          if (value.count === 0) return;
          
          // Remove tooltip on click
          selectAll('.heatmap-tooltip').remove();
          
          selectedCell.value = {
            speaker1Name: row.speaker1Name || row.speakerName || '',
            speaker2Name: value.speaker2Name || '',
            count: value.count,
            episodes: value.episodes
          };
        });

      // Add text for non-zero values
      if (value.count > 0 && cellSize > 15) {
        const textColor = getTextColorForCount(value.count);
        
        cellGroup.append('text')
          .attr('class', 'heatmap-cell-text')
          .attr('data-row-id', rowId)
          .attr('data-col-id', colId)
          .attr('data-count', String(value.count))
          .attr('x', x + xScale.bandwidth() / 2)
          .attr('y', y + yScale.bandwidth() / 2)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', Math.min(10, cellSize * 0.4))
          .attr('fill', textColor)
          .attr('pointer-events', 'none')
          .text(value.count);
      }
    });
  });

  // X axis labels (speakers on x-axis)
  const labelFontSize = isMobile ? '8px' : isTablet ? '9px' : '11px';
  
  const xLabels = g.append('g')
    .selectAll('text')
    .data(speakers2)
    .enter()
    .append('text')
    .attr('x', d => (xScale(d.id) || 0) + xScale.bandwidth() / 2)
    .attr('y', -10)
    .attr('text-anchor', 'start')
    .attr('transform', d => {
      const x = (xScale(d.id) || 0) + xScale.bandwidth() / 2;
      return `rotate(-65 ${x} -10)`;
    })
    .attr('font-size', labelFontSize)
    .attr('class', 'fill-gray-700 dark:fill-gray-300')
    .style('cursor', 'pointer')
    .text(d => {
      const name = d.name;
      if (isMobile && name.length > 10) {
        return name.substring(0, 9) + '…';
      } else if (isTablet && name.length > 15) {
        return name.substring(0, 14) + '…';
      }
      return name;
    });

  xLabels.append('title').text(d => d.name);

  // Y axis labels (speakers on y-axis)
  const yLabelFontSize = isMobile ? '8px' : isTablet ? '9px' : '10px';
  
  const yLabels = g.append('g')
    .selectAll('text')
    .data(matrix)
    .enter()
    .append('text')
    .attr('x', -5)
    .attr('y', d => (yScale(d.speakerId || '') || 0) + yScale.bandwidth() / 2)
    .attr('text-anchor', 'end')
    .attr('dominant-baseline', 'middle')
    .attr('font-size', yLabelFontSize)
    .attr('class', 'fill-gray-700 dark:fill-gray-300')
    .style('cursor', 'pointer')
    .text(d => {
      const name = d.speaker1Name || d.speakerName || '';
      if (isMobile && name.length > 10) {
        return name.substring(0, 9) + '…';
      } else if (isTablet && name.length > 15) {
        return name.substring(0, 14) + '…';
      }
      return name;
    });

  yLabels.append('title').text(d => d.speaker1Name || d.speakerName || '');

  // Legend
  const legendWidth = 200;
  const legendHeight = 10;
  const legend = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top + height + 40})`);

  const legendScale = scaleLinear()
    .domain(currentDomain)
    .range([0, legendWidth]);

  const legendAxis = axisBottom(legendScale)
    .ticks(5)
    .tickFormat(d => d.toString());

  // Create gradient
  const defs = svg.append('defs');
  const gradientId = 'legend-gradient-speaker-speaker';
  const gradient = defs.append('linearGradient')
    .attr('id', gradientId);

  gradient.selectAll('stop')
    .data(range(0, 1.01, 0.1))
    .enter()
    .append('stop')
    .attr('offset', d => `${d * 100}%`)
    .attr('stop-color', d => colorScale(currentDomain[0] + d * (currentDomain[1] - currentDomain[0])));

  legend.append('rect')
    .attr('width', legendWidth)
    .attr('height', legendHeight)
    .style('fill', `url(#${gradientId})`);

  const legendAxisG = legend.append('g')
    .attr('transform', `translate(0,${legendHeight})`)
    .call(legendAxis);

  legend.append('text')
    .attr('x', legendWidth / 2)
    .attr('y', -5)
    .attr('text-anchor', 'middle')
    .attr('font-size', '12px')
    .attr('class', 'fill-gray-700 dark:fill-gray-300')
    .text('Anzahl Episoden');

  function getDimmedCellColor() {
    const isDark = document.documentElement.classList.contains('dark');
    return isDark ? '#374151' : '#e5e7eb';
  }

  function applyDomain(domain: [number, number], focus: HeatmapFocus = null) {
    currentDomain = normalizeDomain(domain[0], domain[1]);
    colorScale = scaleSequential(interpolateBuGn).domain(currentDomain);

    g.selectAll<SVGRectElement, unknown>('rect.heatmap-cell')
      .attr('fill', function() {
        const el = this as SVGRectElement;
        const count = Number(el.getAttribute('data-count') || '0');
        if (count <= 0) return getEmptyCellColor();
        if (!focus) return colorScale(count);
        const rowId = el.getAttribute('data-row-id') || '';
        const colId = el.getAttribute('data-col-id') || '';
        const isFocused = focus.type === 'row' ? rowId === focus.id : colId === focus.id;
        return isFocused ? colorScale(count) : getDimmedCellColor();
      });

    g.selectAll<SVGTextElement, unknown>('text.heatmap-cell-text')
      .attr('fill', function() {
        const el = this as SVGTextElement;
        const count = Number(el.getAttribute('data-count') || '0');
        if (count <= 0) return getTextColorForCount(0);
        if (!focus) return getTextColorForCount(count);
        const rowId = el.getAttribute('data-row-id') || '';
        const colId = el.getAttribute('data-col-id') || '';
        const isFocused = focus.type === 'row' ? rowId === focus.id : colId === focus.id;
        return isFocused ? getTextColorForCount(count) : '#6b7280';
      })
      .attr('opacity', function() {
        const el = this as SVGTextElement;
        const count = Number(el.getAttribute('data-count') || '0');
        if (count <= 0) return 1;
        if (!focus) return 1;
        const rowId = el.getAttribute('data-row-id') || '';
        const colId = el.getAttribute('data-col-id') || '';
        const isFocused = focus.type === 'row' ? rowId === focus.id : colId === focus.id;
        return isFocused ? 1 : 0.2;
      });

    if (focus?.type === 'row') {
      yLabels.attr('opacity', d => ((d.speakerId || '') === focus.id ? 1 : 0.25));
      xLabels.attr('opacity', 1);
    } else if (focus?.type === 'col') {
      xLabels.attr('opacity', d => (d.id === focus.id ? 1 : 0.25));
      yLabels.attr('opacity', 1);
    } else {
      xLabels.attr('opacity', 1);
      yLabels.attr('opacity', 1);
    }

    xLabels
      .style('font-weight', d => (focus?.type === 'col' && d.id === focus.id ? '700' : '400'))
      .style('text-decoration', d => (focus?.type === 'col' && d.id === focus.id ? 'underline' : null));
    yLabels
      .style('font-weight', d => (focus?.type === 'row' && (d.speakerId || '') === focus.id ? '700' : '400'))
      .style('text-decoration', d => (focus?.type === 'row' && (d.speakerId || '') === focus.id ? 'underline' : null));

    legendScale.domain(currentDomain);
    legendAxisG.call(legendAxis);
    gradient.selectAll('stop')
      .attr('stop-color', d => colorScale(currentDomain[0] + (d as number) * (currentDomain[1] - currentDomain[0])));
  }

  // Click labels to select/deselect focus; focus persists across redraws
  xLabels.on('click', (_event, d) => {
    const current = activeHeatmapFocus.value;
    const next: HeatmapFocus = current?.type === 'col' && current.id === d.id ? null : { type: 'col', id: d.id };
    activeHeatmapFocus.value = next;
    applyDomain(next ? getColDomain(next.id) : globalDomain, next);
  });

  yLabels.on('click', (_event, d) => {
    const rowId = d.speakerId || '';
    const current = activeHeatmapFocus.value;
    const next: HeatmapFocus = current?.type === 'row' && current.id === rowId ? null : { type: 'row', id: rowId };
    activeHeatmapFocus.value = next;
    applyDomain(next ? getRowDomain(next.id) : globalDomain, next);
  });

  // Re-apply persisted focus (if any)
  const persisted = activeHeatmapFocus.value;
  if (persisted?.type === 'col') applyDomain(getColDomain(persisted.id), persisted);
  else if (persisted?.type === 'row') applyDomain(getRowDomain(persisted.id), persisted);
}

// Load data on mount
onMounted(async () => {
  try {
    const response = await fetch(getPodcastFileUrl('speaker-speaker-heatmap.json'));
    heatmapData.value = await response.json();
    // Load speaker metadata for images
    if (heatmapData.value) {
      const speakerNames = heatmapData.value.speakers.map(s => s.name);
      await loadSpeakers(speakerNames);
    }
  } catch (error) {
    console.error('Failed to load heatmap data:', error);
  }
});

// Watch for podcast changes and reload data
watch(() => settingsStore.selectedPodcast, async () => {
  try {
    const response = await fetch(getPodcastFileUrl('speaker-speaker-heatmap.json'));
    heatmapData.value = await response.json();
    // Load speaker metadata for images
    if (heatmapData.value) {
      const speakerNames = heatmapData.value.speakers.map(s => s.name);
      await loadSpeakers(speakerNames);
    }
    if (heatmapData.value) {
      drawHeatmap();
    }
  } catch (error) {
    console.error('Failed to load heatmap data:', error);
  }
});

// Watch for data changes and redraw
watch([heatmapData, filteredMatrix, filteredSpeakers2, () => settingsStore.isDarkMode], () => {
  if (heatmapData.value) {
    drawHeatmap();
  }
});

// Clear selection when slider values change
watch([() => settingsStore.topNSpeakers1Heatmap, () => settingsStore.topNSpeakers2Heatmap], () => {
  selectedCell.value = null;
  showEpisodeList.value = false;
});

// Load episode details when episode list is shown
watch(showEpisodeList, (show) => {
  if (show && selectedCell.value) {
    loadEpisodeDetails(selectedCell.value.episodes);
  }
});

// Redraw on container resize
watch(heatmapContainer, (container) => {
  if (!container) return;
  
  const resizeObserver = new ResizeObserver(() => {
    drawHeatmap();
  });
  
  resizeObserver.observe(container);
});
</script>

