<template>
  <div class="space-y-6">
    <!-- Main Panel: Statistics, Controls, and Chart -->
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <!-- Header -->
      <div class="p-3 sm:p-4 md:p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-900/30">
        <div v-if="heatmapData" class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div class="text-center">
            <div class="text-2xl sm:text-3xl font-bold text-orange-600 dark:text-orange-400">{{ heatmapData.statistics.totalSpeakers }}</div>
            <p class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">Sprecher insgesamt</p>
          </div>
          <div class="text-center">
            <div class="text-2xl sm:text-3xl font-bold text-orange-600 dark:text-orange-400">{{ heatmapData.statistics.totalClusters }}</div>
            <p class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">Cluster insgesamt</p>
          </div>
        </div>
        
        <!-- Controls -->
        <div v-if="heatmapData" class="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4 flex-wrap">
          <label class="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 flex flex-col sm:flex-row sm:items-center gap-2">
            <span class="whitespace-nowrap">Anzahl Sprecher:</span>
            <div class="flex items-center gap-2">
              <input
                v-model.number="topNSpeakersClusterHeatmap"
                type="range"
                min="5"
                :max="heatmapData.statistics.totalSpeakers"
                step="1"
                class="flex-1 sm:w-32 md:w-48 slider-orange"
              />
              <span class="text-orange-600 dark:text-orange-400 font-semibold min-w-[2rem] text-right">{{ topNSpeakersClusterHeatmap }}</span>
            </div>
          </label>
          
          <label class="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 flex flex-col sm:flex-row sm:items-center gap-2">
            <span class="whitespace-nowrap">Anzahl Cluster:</span>
            <div class="flex items-center gap-2">
              <input
                v-model.number="topNClustersHeatmap"
                type="range"
                min="10"
                :max="heatmapData.statistics.totalClusters"
                step="1"
                class="flex-1 sm:w-32 md:w-48 slider-orange"
              />
              <span class="text-orange-600 dark:text-orange-400 font-semibold min-w-[2rem] text-right">{{ topNClustersHeatmap }}</span>
            </div>
          </label>
        </div>
      </div>
      
      <!-- Chart Body -->
      <div class="flex-1 overflow-auto p-6" ref="heatmapContainer">
        <div v-if="!heatmapData" class="flex items-center justify-center h-full">
          <p class="text-gray-500 dark:text-gray-400">Lade Daten...</p>
        </div>
        <div v-else>
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
    
    <!-- Episode Table Panel -->
    <EpisodeTable
      ref="episodeTableRef"
      v-if="selectedCell && showEpisodeList"
      :episodes="selectedCell.episodes.map(num => {
        const detail = episodeDetails.get(num);
        return {
          number: num,
          date: detail?.date || '',
          title: detail?.title || `Episode ${num}`,
        };
      })"
      :episode-details="episodeDetails"
      :loading-episodes="loadingEpisodes"
      :get-topic-occurrences="getTopicOccurrences"
      :play-episode-at="playEpisodeAt"
      :format-occurrence-label="formatOccurrenceLabel"
      :format-duration="(dur) => formatDuration(dur)"
      :format-hms-from-seconds="formatHmsFromSeconds"
      :get-episode-image-url="getEpisodeImageUrl"
      theme-color="orange"
      :show-play-button="true"
    >
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <h3 class="font-semibold text-lg text-orange-900 dark:text-orange-100">
              {{ selectedCell.speakerName }} → {{ selectedCell.clusterName }}
            </h3>
            <p class="text-sm text-orange-600 dark:text-orange-400 mt-2">
              <strong>{{ selectedCell.episodes.length }}</strong> Episoden in dieser Kombination
            </p>
          </div>
          <button
            @click="clearSelection"
            class="text-orange-600 hover:text-orange-800 dark:text-orange-400 dark:hover:text-orange-300 font-semibold ml-4"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>
      </template>
    </EpisodeTable>
    
    <!-- Footer -->
    <footer v-if="heatmapData" class="text-center text-gray-500 dark:text-gray-400 text-xs sm:text-sm">
      <p>Generiert am: {{ new Date(heatmapData.generatedAt).toLocaleString('de-DE') }}</p>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch, reactive, nextTick, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
  interpolateOranges
} from '@/utils/d3-imports';
import type { HeatmapData } from '../types';
import { useSettingsStore } from '../stores/settings';
import { loadVariantData } from '@/composables/useVariants';
import { useInlineEpisodePlayer } from '@/composables/useInlineEpisodePlayer';
import { useAudioPlayerStore } from '@/stores/audioPlayer';
import { getPodcastFileUrl, getSpeakersBaseUrl, getEpisodeImageUrl, withBase } from '@/composables/usePodcast';
import { useLazyEpisodeDetails, type EpisodeDetail as EpisodeDetailType, loadEpisodeDetail, getCachedEpisodeDetail } from '@/composables/useEpisodeDetails';
import { useSpeakerMeta } from '@/composables/useSpeakerMeta';
import EpisodeTable from '../components/EpisodeTable.vue';

const route = useRoute();
const router = useRouter();
const settingsStore = useSettingsStore();
const audioPlayerStore = useAudioPlayerStore();
const inlinePlayer = reactive(useInlineEpisodePlayer());

// Local state for controls (synced with URL and store)
const topNSpeakersClusterHeatmap = ref<number>(settingsStore.topNSpeakersClusterHeatmap);
const topNClustersHeatmap = ref<number>(settingsStore.topNClustersHeatmap);

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
const episodeTableRef = ref<InstanceType<typeof EpisodeTable> | null>(null);

type HeatmapFocus = { type: 'row'; id: string } | { type: 'col'; id: string } | null;
const activeHeatmapFocus = ref<HeatmapFocus>(null);

const selectedCell = ref<{
  speakerId: string;
  speakerName: string;
  clusterId: string;
  clusterName: string;
  count: number;
  episodes: number[];
} | null>(null);

const showEpisodeList = ref(true);

async function loadData() {
  try {
    heatmapData.value = await loadVariantData('speaker-cluster-heatmap.json');
    // Load speaker metadata for images
    if (heatmapData.value) {
      const speakerNames = heatmapData.value.speakers.map(s => s.name);
      await loadSpeakers(speakerNames);
    }
  } catch (error) {
    console.error('Failed to load heatmap data:', error);
  }
}
const loadingEpisodes = ref(false);
let episodeDetailsRequestId = 0;

// Use lazy loading composable
const { preloadVisible } = useLazyEpisodeDetails();

// Local map to track which episodes are loaded (synced with global cache)
const episodeDetails = ref<Map<number, EpisodeDetailType | null>>(new Map());
const observerCleanups = ref<Map<number, () => void>>(new Map());

// Filtered data based on slider values
const filteredData = computed(() => {
  if (!heatmapData.value) return { speakers: [], clusters: [] };
  
  // Get top N speakers (already sorted by episodes in the data)
  const speakers = heatmapData.value.speakers.slice(0, topNSpeakersClusterHeatmap.value);
  
  // Get top N clusters (already sorted by episodes in the data)
  const clusters = (heatmapData.value.clusters || []).slice(0, topNClustersHeatmap.value);
  
  return { speakers, clusters };
});

const filteredMatrix = computed(() => {
  if (!heatmapData.value) return [];
  
  const { speakers, clusters } = filteredData.value;
  const speakerIds = new Set(speakers.map(s => s.id));
  const clusterIds = new Set(clusters.map(c => c.id));
  
  // Filter matrix by selected speakers
  let matrix = heatmapData.value.matrix.filter(row => row.speakerId && speakerIds.has(row.speakerId));
  
  // Filter values by selected clusters
  matrix = matrix.map(row => ({
    ...row,
    values: row.values.filter(val => val.clusterId && clusterIds.has(val.clusterId))
  }));
  
  return matrix;
});

const filteredClusters = computed(() => {
  return filteredData.value.clusters;
});

function clearSelection() {
  selectedCell.value = null;
  showEpisodeList.value = false;
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
    
    // If episode already exists, ALWAYS update speakers from episodes.json
    if (existingDetail) {
      const meta = inlinePlayer.episodeMetaByEpisode.get(episodeNum) || null;
      
      // ALWAYS update speakers from episodes.json if available
      if (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0) {
        episodeDetails.value.set(episodeNum, {
          ...existingDetail,
          speakers: meta.speakers,
        });
        // Continue to ensure episodes.json data is set even if we have full details
      }
      
      // If we have full details (no fallback), skip priming (but speakers were already updated above)
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
        (typeof meta.durationSec === 'number' && Number.isFinite(meta.durationSec)) ||
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
          // Merge cached data with episodes.json - ALWAYS prefer episodes.json for speakers
          const meta = inlinePlayer.episodeMetaByEpisode.get(num);
          const merged = {
            ...cached,
            // ALWAYS prefer speakers from episodes.json if available
            speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
              ? meta.speakers
              : (Array.isArray(cached.speakers) && cached.speakers.length > 0 ? cached.speakers : []),
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

  const toLoad = episodeNumbers.filter(episodeNum => {
    const cached = getCachedEpisodeDetail(episodeNum);
    if (cached !== undefined) return false;
    const cur: any = episodeDetails.value.get(episodeNum);
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
        const detail = await loadEpisodeDetail(episodeNum);
        if (isStale()) return;
        if (detail) {
          // Merge with episodes.json data - ALWAYS prefer episodes.json for speakers
          const meta = inlinePlayer.episodeMetaByEpisode.get(episodeNum);
          const merged = {
            ...detail,
            // ALWAYS prefer speakers from episodes.json if available
            speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
              ? meta.speakers
              : (Array.isArray(detail.speakers) && detail.speakers.length > 0 ? detail.speakers : []),
          };
          episodeDetails.value.set(episodeNum, merged);
        }
      }));
    }
  }
}

// Legacy function for compatibility (now uses lazy loading)
async function loadEpisodeDetails(episodeNumbers: number[]) {
  const requestId = ++episodeDetailsRequestId;
  loadingEpisodes.value = true;
  try {
    await setupLazyLoadingForEpisodes(episodeNumbers, requestId);
  } finally {
    if (requestId === episodeDetailsRequestId) loadingEpisodes.value = false;
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

function formatDuration(duration?: string | number | number[]): string {
  if (!duration) return 'N/A';
  
  // If it's already a string (formatted), return it
  if (typeof duration === 'string') return duration;
  
  // If it's an array [hours, minutes, seconds], convert to seconds first
  let seconds: number;
  if (Array.isArray(duration)) {
    const [h = 0, m = 0, s = 0] = duration;
    seconds = h * 3600 + m * 60 + s;
  } else {
    seconds = duration;
  }
  
  // If it's a number (seconds), format it
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

const formatHmsFromSeconds = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const getTopicOccurrences = (episode: any): Array<{ positionSec: number; durationSec: number | null; topic: string | null }> => {
  // Cluster heatmap doesn't have topic occurrences, return empty array
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
  const clusters = filteredClusters.value;

  if (matrix.length === 0 || clusters.length === 0) {
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
  
  const cellSize = Math.min(30, Math.max(10, containerWidth / (clusters.length + 10)));
  const margin = isMobile
    ? { top: 80, right: 10, bottom: 20, left: 60 }
    : isTablet
    ? { top: 120, right: 15, bottom: 20, left: 100 }
    : { top: 180, right: 20, bottom: 20, left: 200 };
  const width = clusters.length * cellSize;
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
  let colorScale = scaleSequential(interpolateOranges).domain(currentDomain);

  function getEmptyCellColor() {
    const isDark = document.documentElement.classList.contains('dark');
    return isDark ? '#1f2937' : '#f0f0f0'; // dark:bg-gray-800 or light gray
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
      .filter(v => (v.clusterId || '') === colId)
      .map(v => v.count)
      .filter(c => c > 0);
    if (counts.length === 0) return globalDomain;
    return normalizeDomain(min(counts) ?? 0, max(counts) ?? 0);
  }

  // X axis (clusters)
  const xScale = scaleBand()
    .domain(clusters.map(c => c.id))
    .range([0, width])
    .padding(0.05);

  // Y axis (speakers)
  const yScale = scaleBand()
    .domain(matrix.map(row => row.speakerId || '').filter(id => id))
    .range([0, height])
    .padding(0.05);

  // Draw cells
  matrix.forEach((row) => {
    if (!row.speakerId) return;
    row.values.forEach((value) => {
      if (!value.clusterId) return;
      
      const x = xScale(value.clusterId);
      const y = yScale(row.speakerId || '');
      
      if (x === undefined || y === undefined) return;

      const cellGroup = g.append('g')
        .attr('class', 'cell-group')
        .style('cursor', value.count > 0 ? 'pointer' : 'default');

      const rowId = row.speakerId || '';
      const colId = value.clusterId || '';

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

          // Get speaker image
          const speakerImage = getSpeakerImage(row.speakerName || '');
          const speakerImageHtml = speakerImage
            ? `<img src="${speakerImage}" alt="${row.speakerName}" class="w-8 h-8 rounded-full border-2 border-white inline-block mr-2" />`
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
              <div>${speakerImageHtml}<strong>${row.speakerName}</strong></div>
              <div class="mt-1">${value.clusterName}</div>
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
            speakerId: row.speakerId || '',
            speakerName: row.speakerName || '',
            clusterId: value.clusterId || '',
            clusterName: value.clusterName || '',
            count: value.count,
            episodes: value.episodes
          };
          
          // Scroll to table after a short delay to allow DOM update
          nextTick(() => {
            setTimeout(() => {
              if (episodeTableRef.value?.$el) {
                episodeTableRef.value.$el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }, 100);
          });
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

  // X axis labels (clusters)
  const clusterLabelFontSize = isMobile ? '8px' : isTablet ? '9px' : '11px';
  
  const xLabels = g.append('g')
    .selectAll('text')
    .data(clusters)
    .enter()
    .append('text')
    .attr('x', d => (xScale(d.id) || 0) + xScale.bandwidth() / 2)
    .attr('y', -10)
    .attr('text-anchor', 'start')
    .attr('transform', d => {
      const x = (xScale(d.id) || 0) + xScale.bandwidth() / 2;
      return `rotate(-65 ${x} -10)`;
    })
    .attr('font-size', clusterLabelFontSize)
    .attr('class', 'fill-gray-700 dark:fill-gray-300')
    .style('cursor', 'pointer')
    .text(d => {
      const name = d.name;
      // Truncate long cluster names on mobile
      if (isMobile && name.length > 12) {
        return name.substring(0, 11) + '…';
      } else if (isTablet && name.length > 18) {
        return name.substring(0, 17) + '…';
      }
      return name;
    });

  xLabels.append('title').text(d => d.name); // Full name in tooltip

  // Y axis labels (speakers)
  const labelFontSize = isMobile ? '8px' : isTablet ? '9px' : '10px';
  
  const yLabels = g.append('g')
    .selectAll('text')
    .data(matrix)
    .enter()
    .append('text')
    .attr('x', -5)
    .attr('y', d => (yScale(d.speakerId || '') || 0) + yScale.bandwidth() / 2)
    .attr('text-anchor', 'end')
    .attr('dominant-baseline', 'middle')
    .attr('font-size', labelFontSize)
    .attr('class', 'fill-gray-700 dark:fill-gray-300')
    .style('cursor', 'pointer')
    .text(d => {
      const name = d.speakerName || '';
      // Truncate long names on mobile
      if (isMobile && name.length > 10) {
        return name.substring(0, 9) + '…';
      } else if (isTablet && name.length > 15) {
        return name.substring(0, 14) + '…';
      }
      return name;
    });

  yLabels.append('title').text(d => d.speakerName || ''); // Full name in tooltip

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
  const gradient = defs.append('linearGradient')
    .attr('id', 'legend-gradient');

  gradient.selectAll('stop')
    .data(range(0, 1.01, 0.1))
    .enter()
    .append('stop')
    .attr('offset', d => `${d * 100}%`)
    .attr('stop-color', d => colorScale(currentDomain[0] + d * (currentDomain[1] - currentDomain[0])));

  legend.append('rect')
    .attr('width', legendWidth)
    .attr('height', legendHeight)
    .style('fill', 'url(#legend-gradient)');

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
    return isDark ? '#374151' : '#e5e7eb'; // gray-700 / gray-200
  }

  function applyDomain(domain: [number, number], focus: HeatmapFocus = null) {
    currentDomain = normalizeDomain(domain[0], domain[1]);
    colorScale = scaleSequential(interpolateOranges).domain(currentDomain);

    // Update cells
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

    // Update text colors (based on updated background)
    g.selectAll<SVGTextElement, unknown>('text.heatmap-cell-text')
      .attr('fill', function() {
        const el = this as SVGTextElement;
        const count = Number(el.getAttribute('data-count') || '0');
        if (count <= 0) return getTextColorForCount(0);
        if (!focus) return getTextColorForCount(count);
        const rowId = el.getAttribute('data-row-id') || '';
        const colId = el.getAttribute('data-col-id') || '';
        const isFocused = focus.type === 'row' ? rowId === focus.id : colId === focus.id;
        return isFocused ? getTextColorForCount(count) : '#6b7280'; // gray-500
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

    // Dim + highlight axis labels
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

    // Update legend
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
  await loadData();
  await nextTick();
  readFromUrl();
});

// Watch for variant changes and reload data
watch(() => settingsStore.clusteringVariant, () => {
  loadData();
});

// Watch for podcast changes and reload data
watch(() => settingsStore.selectedPodcast, () => {
  loadData();
});

// URL state management
const updateUrl = () => {
  const query: Record<string, string | undefined> = {};
  
  if (topNSpeakersClusterHeatmap.value !== 15) {
    query.speakers = topNSpeakersClusterHeatmap.value.toString();
  } else {
    query.speakers = undefined;
  }
  
  if (topNClustersHeatmap.value !== 20) {
    query.clusters = topNClustersHeatmap.value.toString();
  } else {
    query.clusters = undefined;
  }
  
  if (selectedCell.value) {
    query.speaker = selectedCell.value.speakerId;
    query.cluster = selectedCell.value.clusterId;
  } else {
    query.speaker = undefined;
    query.cluster = undefined;
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

const readFromUrl = () => {
  const query = route.query;
  
  // Read speaker filter
  if (query.speakers) {
    const speakersValue = parseInt(query.speakers as string, 10);
    if (!isNaN(speakersValue) && speakersValue >= 5 && heatmapData.value) {
      topNSpeakersClusterHeatmap.value = Math.min(speakersValue, heatmapData.value.statistics.totalSpeakers);
    }
  } else if (heatmapData.value) {
    // Fall back to store value if not in URL, but validate against max
    const storeValue = settingsStore.topNSpeakersClusterHeatmap;
    topNSpeakersClusterHeatmap.value = Math.min(storeValue, heatmapData.value.statistics.totalSpeakers);
  } else {
    // Use store value if data not loaded yet
    topNSpeakersClusterHeatmap.value = settingsStore.topNSpeakersClusterHeatmap;
  }
  
  // Read cluster filter
  if (query.clusters) {
    const clustersValue = parseInt(query.clusters as string, 10);
    if (!isNaN(clustersValue) && clustersValue >= 10 && heatmapData.value) {
      topNClustersHeatmap.value = Math.min(clustersValue, heatmapData.value.statistics.totalClusters || 20);
    }
  } else if (heatmapData.value) {
    // Fall back to store value if not in URL, but validate against max
    const storeValue = settingsStore.topNClustersHeatmap;
    topNClustersHeatmap.value = Math.min(storeValue, heatmapData.value.statistics.totalClusters || 20);
  } else {
    // Use store value if data not loaded yet
    topNClustersHeatmap.value = settingsStore.topNClustersHeatmap;
  }
  
  // Read selected cell
  if (query.speaker && query.cluster && heatmapData.value) {
    const speakerId = query.speaker as string;
    const clusterId = query.cluster as string;
    
    // Find the cell in the matrix
    const row = heatmapData.value.matrix.find(r => r.speakerId === speakerId);
    if (row) {
      const value = row.values.find(v => v.clusterId === clusterId);
      if (value && value.count > 0) {
        const speaker = heatmapData.value.speakers.find(s => s.id === speakerId);
        const cluster = heatmapData.value.clusters?.find(c => c.id === clusterId);
        if (speaker && cluster) {
          selectedCell.value = {
            speakerId: speaker.id,
            speakerName: speaker.name,
            clusterId: cluster.id,
            clusterName: cluster.name,
            count: value.count,
            episodes: value.episodes
          };
          showEpisodeList.value = true;
        }
      }
    }
  }
};

// Watch for data changes and redraw
watch([heatmapData, filteredMatrix, filteredClusters, () => settingsStore.isDarkMode], () => {
  if (heatmapData.value) {
    drawHeatmap();
  }
});

// Clear selection when slider values change
watch([topNSpeakersClusterHeatmap, topNClustersHeatmap], ([speakersValue, clustersValue]) => {
  // Update store when values change
  settingsStore.topNSpeakersClusterHeatmap = speakersValue;
  settingsStore.topNClustersHeatmap = clustersValue;
  selectedCell.value = null;
  showEpisodeList.value = false;
  updateUrl();
});

// Watch for URL changes (only if data is loaded)
watch(() => route.query, () => {
  if (heatmapData.value) {
    readFromUrl();
  }
}, { deep: true });

// Watch for selection changes to update URL
watch(selectedCell, (newCell) => {
  updateUrl();
  // Load episode details when cell is selected
  if (newCell && newCell.episodes.length > 0 && showEpisodeList.value) {
    loadEpisodeDetails(newCell.episodes);
  }
});

// Load episode details when episode list is shown
watch(showEpisodeList, (show) => {
  if (show && selectedCell.value) {
    loadEpisodeDetails(selectedCell.value.episodes);
  }
}, { immediate: true });

// Redraw on container resize
watch(heatmapContainer, (container) => {
  if (!container) return;
  
  const resizeObserver = new ResizeObserver(() => {
    drawHeatmap();
  });
  
  resizeObserver.observe(container);
});
</script>

