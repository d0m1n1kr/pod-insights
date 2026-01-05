<template>
  <div class="space-y-6">
    <!-- Main Panel: Statistics, Tab Switch, and Chart -->
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <!-- Header -->
      <div class="p-3 sm:p-4 md:p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-violet-50 to-violet-100 dark:from-violet-900/20 dark:to-violet-900/30">
        <h2 class="text-xl sm:text-2xl font-bold text-violet-900 dark:text-violet-100 mb-4">Duration Heatmaps</h2>
        
        <!-- Statistics for active tab -->
        <div v-if="currentData" class="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4">
          <div class="text-center">
            <div class="text-2xl sm:text-3xl font-bold text-violet-600 dark:text-violet-400">{{ currentData.statistics.totalEpisodes }}</div>
            <p class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">Episoden insgesamt</p>
          </div>
          <div class="text-center">
            <div class="text-2xl sm:text-3xl font-bold text-violet-600 dark:text-violet-400">{{ currentData.statistics[mostCommonLabel] }}</div>
            <p class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">{{ mostCommonDesc }}</p>
          </div>
          <div class="text-center">
            <div class="text-2xl sm:text-3xl font-bold text-violet-600 dark:text-violet-400">{{ currentData.statistics.mostCommonDurationLabel }}</div>
            <p class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">Häufigste Dauer</p>
          </div>
        </div>
        
        <!-- Tab Switch -->
        <div class="flex justify-center">
          <div class="flex gap-1 sm:gap-2 bg-white dark:bg-gray-800 rounded-lg p-1 shadow-md overflow-x-auto">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              @click="activeTab = tab.id"
              :class="[
                'px-3 sm:px-4 py-2 rounded-md transition-colors text-xs sm:text-sm font-medium whitespace-nowrap flex-shrink-0',
                activeTab === tab.id
                  ? 'bg-violet-500 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              ]"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>
      </div>
      
      <!-- Chart Body -->
      <div class="flex-1 overflow-auto p-6" ref="heatmapContainer">
        <div v-if="loading" class="flex items-center justify-center h-full">
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
      theme-color="violet"
      :show-play-button="true"
    >
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <h3 class="font-semibold text-lg text-violet-900 dark:text-violet-100">
              {{ selectedCell.label }} – {{ selectedCell.durationLabel }}
            </h3>
            <p class="text-sm text-violet-600 dark:text-violet-400 mt-2">
              <strong>{{ selectedCell.episodes.length }}</strong> Episoden
            </p>
          </div>
          <button
            @click="clearSelection"
            class="text-violet-600 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-300 font-semibold ml-4"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>
      </template>
    </EpisodeTable>
    
    <!-- Footer -->
    <footer v-if="currentData" class="text-center text-gray-500 dark:text-gray-400 text-xs sm:text-sm">
      <p>Generiert am: {{ new Date(currentData.generatedAt).toLocaleString('de-DE') }}</p>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed, reactive, nextTick } from 'vue';
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
  interpolatePurples
} from '@/utils/d3-imports';
import { useSettingsStore } from '../stores/settings';
import { useAudioPlayerStore } from '@/stores/audioPlayer';
import { getPodcastFileUrl, getSpeakersBaseUrl, getEpisodeImageUrl, withBase } from '@/composables/usePodcast';
import { useInlineEpisodePlayer } from '@/composables/useInlineEpisodePlayer';
import { useEpisodeTable } from '@/composables/useEpisodeTable';
import EpisodeTable from '../components/EpisodeTable.vue';

const route = useRoute();
const router = useRouter();
const settingsStore = useSettingsStore();
const audioPlayerStore = useAudioPlayerStore();
const inlinePlayer = reactive(useInlineEpisodePlayer());

// Use unified episode table composable
const { episodeDetails, loadingEpisodes, setupEpisodeTable } = useEpisodeTable();

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

interface HeatmapData {
  generatedAt: string;
  description: string;
  statistics: {
    totalEpisodes: number;
    [key: string]: any;
  };
  matrix: Array<{
    [key: string]: any;
    values: Array<{
      duration: number;
      durationLabel: string;
      count: number;
      episodes: number[];
    }>;
  }>;
  durations: Array<{
    minutes: number;
    label: string;
    totalEpisodes: number;
  }>;
}

const tabs = [
  { id: 'dayofweek', label: 'Wochentag', file: 'dayofweek-duration-heatmap.json' },
  { id: 'year', label: 'Jahr', file: 'year-duration-heatmap.json' },
  { id: 'speaker', label: 'Sprecher', file: 'speaker-duration-heatmap.json' }
];

const activeTab = ref('dayofweek');
const heatmapDataCache = ref<Record<string, HeatmapData>>({});
const loading = ref(false);
const svgElement = ref<SVGSVGElement | null>(null);
const heatmapContainer = ref<HTMLDivElement | null>(null);
const episodeTableRef = ref<InstanceType<typeof EpisodeTable> | null>(null);

type HeatmapFocus = { type: 'row'; id: string } | { type: 'col'; id: string } | null;
const activeHeatmapFocusByTab = ref<Record<string, HeatmapFocus>>({});

const selectedCell = ref<{
  label: string;
  durationLabel: string;
  count: number;
  episodes: number[];
} | null>(null);

const showEpisodeList = ref(true);

const currentData = computed(() => {
  return heatmapDataCache.value[activeTab.value] || null;
});

const mostCommonLabel = computed(() => {
  switch (activeTab.value) {
    case 'dayofweek': return 'mostCommonDay';
    case 'year': return 'mostCommonYear';
    case 'speaker': return 'mostCommonSpeaker';
    default: return 'mostCommonDay';
  }
});

const mostCommonDesc = computed(() => {
  switch (activeTab.value) {
    case 'dayofweek': return 'Häufigster Wochentag';
    case 'year': return 'Häufigstes Jahr';
    case 'speaker': return 'Häufigster Sprecher';
    default: return 'Häufigster Wert';
  }
});

function clearSelection() {
  if (isReadingFromUrl) return;
  
  selectedCell.value = null;
  showEpisodeList.value = false;
  updateUrl();
}


function formatDuration(duration?: string | number | number[]): string {
  if (!duration) return '';
  
  if (typeof duration === 'string') return duration;
  
  // If it's an array [hours, minutes, seconds], convert to seconds first
  let seconds: number;
  if (Array.isArray(duration)) {
    const [h = 0, m = 0, s = 0] = duration;
    seconds = h * 3600 + m * 60 + s;
  } else {
    seconds = duration;
  }
  
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

const getTopicOccurrences = (_episode: any): Array<{ positionSec: number; durationSec: number | null; topic: string | null }> => {
  // Duration heatmap doesn't have topic occurrences, return empty array
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

// Load episode details using unified composable
async function loadEpisodeDetails() {
  if (!selectedCell.value) return;
  await setupEpisodeTable(selectedCell.value.episodes);
}

function getTextColor(color: string): string {
  let r: number, g: number, b: number;
  
  if (color.startsWith('#')) {
    r = parseInt(color.slice(1, 3), 16);
    g = parseInt(color.slice(3, 5), 16);
    b = parseInt(color.slice(5, 7), 16);
  } else if (color.startsWith('rgb')) {
    const matches = color.match(/\d+/g);
    if (matches && matches.length >= 3) {
      r = parseInt(matches[0] || '0');
      g = parseInt(matches[1] || '0');
      b = parseInt(matches[2] || '0');
    } else {
      return 'white';
    }
  } else {
    return 'white';
  }
  
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.35 ? '#1f2937' : 'white';
}

function getRowLabel(row: any): string {
  if (activeTab.value === 'dayofweek') return row.day;
  if (activeTab.value === 'year') return row.year;
  if (activeTab.value === 'speaker') return row.speaker;
  return '';
}

function drawHeatmap() {
  if (!svgElement.value || !currentData.value || !heatmapContainer.value) return;

  selectAll('.heatmap-tooltip').remove();

  const svg = select(svgElement.value);
  svg.selectAll('*').remove();

  const matrix = currentData.value.matrix;
  const durations = currentData.value.durations;

  if (matrix.length === 0 || durations.length === 0) {
    svg.append('text')
      .attr('x', 200)
      .attr('y', 100)
      .attr('text-anchor', 'middle')
      .attr('class', 'text-gray-500 dark:text-gray-400')
      .text('Keine Daten verfügbar');
    return;
  }

  // Dimensions
  const containerWidth = heatmapContainer.value.clientWidth - 48;
  
  // Responsive margins based on viewport
  const isMobile = containerWidth < 640;
  const isTablet = containerWidth >= 640 && containerWidth < 1024;
  
  const cellSize = Math.min(80, Math.max(40, containerWidth / (durations.length + 3)));
  const labelWidth = isMobile 
    ? 60
    : isTablet 
    ? (activeTab.value === 'speaker' ? 100 : 80) 
    : (activeTab.value === 'speaker' ? 180 : 150);
  
  const margin = isMobile
    ? { top: 60, right: 10, bottom: 40, left: labelWidth }
    : isTablet
    ? { top: 80, right: 15, bottom: 50, left: labelWidth }
    : { top: 100, right: 20, bottom: 60, left: labelWidth };
  const width = durations.length * cellSize;
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
  let colorScale = scaleSequential(interpolatePurples).domain(currentDomain);

  function getEmptyCellColor() {
    const isDark = document.documentElement.classList.contains('dark');
    return isDark ? '#1f2937' : '#f0f0f0';
  }

  function getRowDomain(rowLabel: string): [number, number] {
    const row = matrix.find(r => getRowLabel(r) === rowLabel);
    if (!row) return globalDomain;
    const counts = row.values.map(v => v.count).filter(c => c > 0);
    if (counts.length === 0) return globalDomain;
    return normalizeDomain(min(counts) ?? 0, max(counts) ?? 0);
  }

  function getColDomain(colId: string): [number, number] {
    const counts = matrix
      .flatMap(r => r.values)
      .filter(v => v.duration.toString() === colId)
      .map(v => v.count)
      .filter(c => c > 0);
    if (counts.length === 0) return globalDomain;
    return normalizeDomain(min(counts) ?? 0, max(counts) ?? 0);
  }

  // X axis (durations)
  const xScale = scaleBand()
    .domain(durations.map(d => d.minutes.toString()))
    .range([0, width])
    .padding(0.05);

  // Y axis (rows)
  const yScale = scaleBand()
    .domain(matrix.map(row => getRowLabel(row)))
    .range([0, height])
    .padding(0.05);

  // Draw cells
  matrix.forEach((row) => {
    const rowLabel = getRowLabel(row);
    
    row.values.forEach((value) => {
      const x = xScale(value.duration.toString());
      const y = yScale(rowLabel);
      
      if (x === undefined || y === undefined) return;
      const rowId = rowLabel;
      const colId = value.duration.toString();

      const cellGroup = g.append('g')
        .attr('class', 'cell-group')
        .style('cursor', value.count > 0 ? 'pointer' : 'default');

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
          
          selectAll('.heatmap-tooltip').remove();
          
          select('body').append('div')
            .attr('class', 'heatmap-tooltip')
            .style('position', 'absolute')
            .style('background', 'rgba(0, 0, 0, 0.8)')
            .style('color', '#fff')
            .style('padding', '8px 12px')
            .style('border-radius', '4px')
            .style('pointer-events', 'none')
            .style('font-size', '12px')
            .style('z-index', '1000')
            .html(`
              <strong>${rowLabel}</strong><br/>
              ${value.durationLabel}<br/>
              ${value.count} Episoden
            `)
            .style('left', (event.pageX + 10) + 'px')
            .style('top', (event.pageY - 28) + 'px');
        })
        .on('mouseout', function() {
          select(this)
            .attr('stroke', 'none')
            .attr('stroke-width', 0);
          
          selectAll('.heatmap-tooltip').remove();
        })
        .on('click', function() {
          if (value.count === 0) return;
          
          selectAll('.heatmap-tooltip').remove();
          
          selectedCell.value = {
            label: rowLabel,
            durationLabel: value.durationLabel,
            count: value.count,
            episodes: value.episodes
          };
          
          showEpisodeList.value = true;
          loadEpisodeDetails();
          updateUrl();
          
          // Scroll to table after a short delay to allow DOM update
          nextTick(() => {
            setTimeout(() => {
              if (episodeTableRef.value?.$el) {
                episodeTableRef.value.$el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }, 100);
          });
        });

      if (value.count > 0 && cellSize > 30) {
        const cellColor = colorScale(value.count);
        const textColor = getTextColor(cellColor);
        
        cellGroup.append('text')
          .attr('class', 'heatmap-cell-text')
          .attr('data-row-id', rowId)
          .attr('data-col-id', colId)
          .attr('data-count', String(value.count))
          .attr('x', x + xScale.bandwidth() / 2)
          .attr('y', y + yScale.bandwidth() / 2)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', Math.min(14, cellSize * 0.3))
          .attr('fill', textColor)
          .attr('pointer-events', 'none')
          .text(value.count);
      }
    });
  });

  // X axis labels (durations)
  const xLabels = g.append('g')
    .selectAll('text')
    .data(durations)
    .enter()
    .append('text')
    .attr('x', d => (xScale(d.minutes.toString()) || 0) + xScale.bandwidth() / 2)
    .attr('y', -15)
    .attr('text-anchor', 'middle')
    .attr('font-size', '12px')
    .attr('class', 'fill-gray-700 dark:fill-gray-300')
    .style('cursor', 'pointer')
    .text(d => d.label);

  // Y axis labels
  const labelFontSize = isMobile ? '8px' : isTablet ? '9px' : '11px';
  
  const yLabels = g.append('g')
    .selectAll('text')
    .data(matrix)
    .enter()
    .append('text')
    .attr('x', -5)
    .attr('y', d => (yScale(getRowLabel(d)) || 0) + yScale.bandwidth() / 2)
    .attr('text-anchor', 'end')
    .attr('dominant-baseline', 'middle')
    .attr('font-size', labelFontSize)
    .attr('class', 'fill-gray-700 dark:fill-gray-300')
    .style('cursor', 'pointer')
    .text(d => {
      const label = getRowLabel(d);
      // Truncate long labels on mobile
      if (isMobile && label.length > 10) {
        return label.substring(0, 9) + '…';
      } else if (isTablet && label.length > 15) {
        return label.substring(0, 14) + '…';
      }
      return label;
    });

  yLabels.append('title').text(d => getRowLabel(d));

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

  const gradientId = `legend-gradient-${activeTab.value}`;
  const gradient = svg.append('defs')
    .append('linearGradient')
    .attr('id', gradientId)
    .attr('x1', '0%')
    .attr('x2', '100%');

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
    .attr('class', 'fill-gray-700 dark:fill-gray-300');

  legendAxisG.call(legendAxis as any);
  legendAxisG.selectAll('text').attr('class', 'fill-gray-700 dark:fill-gray-300');

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
    colorScale = scaleSequential(interpolatePurples).domain(currentDomain);

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
        if (count <= 0) return getTextColor(colorScale(0));
        if (!focus) return getTextColor(colorScale(count));
        const rowId = el.getAttribute('data-row-id') || '';
        const colId = el.getAttribute('data-col-id') || '';
        const isFocused = focus.type === 'row' ? rowId === focus.id : colId === focus.id;
        return isFocused ? getTextColor(colorScale(count)) : '#6b7280';
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
      yLabels.attr('opacity', d => (getRowLabel(d) === focus.id ? 1 : 0.25));
      xLabels.attr('opacity', 1);
    } else if (focus?.type === 'col') {
      xLabels.attr('opacity', d => (d.minutes.toString() === focus.id ? 1 : 0.25));
      yLabels.attr('opacity', 1);
    } else {
      xLabels.attr('opacity', 1);
      yLabels.attr('opacity', 1);
    }

    xLabels
      .style('font-weight', d => (focus?.type === 'col' && d.minutes.toString() === focus.id ? '700' : '400'))
      .style('text-decoration', d => (focus?.type === 'col' && d.minutes.toString() === focus.id ? 'underline' : null));
    yLabels
      .style('font-weight', d => (focus?.type === 'row' && getRowLabel(d) === focus.id ? '700' : '400'))
      .style('text-decoration', d => (focus?.type === 'row' && getRowLabel(d) === focus.id ? 'underline' : null));

    legendScale.domain(currentDomain);
    legendAxisG.call(legendAxis as any);
    gradient.selectAll('stop')
      .attr('stop-color', d => colorScale(currentDomain[0] + (d as number) * (currentDomain[1] - currentDomain[0])));
  }

  // Click labels to select/deselect focus; focus persists per-tab across redraws
  xLabels.on('click', (_event, d) => {
    const colId = d.minutes.toString();
    const current = activeHeatmapFocusByTab.value[activeTab.value] || null;
    const next: HeatmapFocus = current?.type === 'col' && current.id === colId ? null : { type: 'col', id: colId };
    if (next) activeHeatmapFocusByTab.value[activeTab.value] = next;
    else delete activeHeatmapFocusByTab.value[activeTab.value];
    applyDomain(next ? getColDomain(next.id) : globalDomain, next);
  });

  yLabels.on('click', (_event, d) => {
    const rowId = getRowLabel(d);
    const current = activeHeatmapFocusByTab.value[activeTab.value] || null;
    const next: HeatmapFocus = current?.type === 'row' && current.id === rowId ? null : { type: 'row', id: rowId };
    if (next) activeHeatmapFocusByTab.value[activeTab.value] = next;
    else delete activeHeatmapFocusByTab.value[activeTab.value];
    applyDomain(next ? getRowDomain(next.id) : globalDomain, next);
  });

  // Re-apply persisted focus for this tab (if any)
  const persisted = activeHeatmapFocusByTab.value[activeTab.value] || null;
  if (persisted?.type === 'col') applyDomain(getColDomain(persisted.id), persisted);
  else if (persisted?.type === 'row') applyDomain(getRowDomain(persisted.id), persisted);
}

async function loadData(tabId: string) {
  if (heatmapDataCache.value[tabId]) {
    return;
  }
  
  loading.value = true;
  try {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    
    const response = await fetch(getPodcastFileUrl(tab.file));
    heatmapDataCache.value[tabId] = await response.json();
  } catch (error) {
    console.error(`Failed to load ${tabId} data:`, error);
  } finally {
    loading.value = false;
  }
}

// URL state management
let isReadingFromUrl = false;

const updateUrl = () => {
  if (isReadingFromUrl) return;
  
  const query: Record<string, string | undefined> = {};
  
  if (activeTab.value !== 'dayofweek') {
    query.tab = activeTab.value;
  } else {
    query.tab = undefined;
  }
  
  if (selectedCell.value) {
    query.label = encodeURIComponent(selectedCell.value.label);
    query.duration = encodeURIComponent(selectedCell.value.durationLabel);
  } else {
    query.label = undefined;
    query.duration = undefined;
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

const readFromUrl = (skipTabChange = false) => {
  isReadingFromUrl = true;
  
  try {
    const query = route.query;
    
    // Read active tab (only if not skipping and data is already loaded)
    if (!skipTabChange) {
      if (query.tab && typeof query.tab === 'string') {
        const tabId = query.tab as string;
        if (tabs.some(t => t.id === tabId) && activeTab.value !== tabId) {
          // Only change tab if data is already loaded to avoid triggering loadData
          if (heatmapDataCache.value[tabId]) {
            activeTab.value = tabId;
          }
        }
      } else if (!query.tab && activeTab.value !== 'dayofweek') {
        if (heatmapDataCache.value['dayofweek']) {
          activeTab.value = 'dayofweek';
        }
      }
    }
    
    // Read selected cell (only if data is loaded)
    if (query.label && query.duration && currentData.value) {
      const label = decodeURIComponent(query.label as string);
      const durationLabel = decodeURIComponent(query.duration as string);
      
      // Only update if different from current selection
      const needsUpdate = !selectedCell.value || 
        selectedCell.value.label !== label || 
        selectedCell.value.durationLabel !== durationLabel;
      
      if (needsUpdate) {
        // Find the cell in the matrix
        const matrix = currentData.value.matrix;
        let found = false;
        for (const row of matrix) {
          const rowLabel = getRowLabel(row);
          if (rowLabel === label) {
            const value = row.values.find(v => v.durationLabel === durationLabel);
            if (value && value.count > 0) {
              selectedCell.value = {
                label: rowLabel,
                durationLabel: value.durationLabel,
                count: value.count,
                episodes: value.episodes
              };
              showEpisodeList.value = true;
              loadEpisodeDetails();
              found = true;
              break;
            }
          }
        }
        if (!found) {
          selectedCell.value = null;
          showEpisodeList.value = false;
        }
      }
    } else if (!query.label || !query.duration) {
      if (selectedCell.value !== null) {
        selectedCell.value = null;
        showEpisodeList.value = false;
      }
    }
  } finally {
    isReadingFromUrl = false;
  }
};

// Load data on mount
let resizeObserver: ResizeObserver | null = null;
onMounted(async () => {
  // Read tab from URL first
  const query = route.query;
  if (query.tab && typeof query.tab === 'string') {
    const tabId = query.tab as string;
    if (tabs.some(t => t.id === tabId)) {
      activeTab.value = tabId;
    }
  }
  
  await loadData(activeTab.value);
  await nextTick();
  readFromUrl(true); // Skip tab change since we already set it
  
  // Watch for window resize
  if (heatmapContainer.value) {
    resizeObserver = new ResizeObserver(() => {
      if (currentData.value) {
        drawHeatmap();
      }
    });
    resizeObserver.observe(heatmapContainer.value);
  }
});

// Watch for tab changes
watch(activeTab, async (newTab) => {
  if (isReadingFromUrl) return;
  
  clearSelection();
  await loadData(newTab);
  await nextTick();
  readFromUrl(true); // Skip tab change since we're already changing it
  drawHeatmap();
  updateUrl();
});

// Watch for URL changes (only if data is loaded)
watch(() => route.query, () => {
  if (currentData.value && !isReadingFromUrl) {
    readFromUrl(true); // Skip tab change to avoid loops
  }
}, { deep: true });

// Watch for podcast changes and reload data
watch(() => settingsStore.selectedPodcast, async () => {
  clearSelection();
  // Clear cache to force reload
  heatmapDataCache.value = {};
  await loadData(activeTab.value);
  await nextTick();
  readFromUrl(true); // Skip tab change
  drawHeatmap();
});

// Watch for data changes and redraw
watch([currentData, () => settingsStore.isDarkMode], () => {
  if (currentData.value) {
    drawHeatmap();
    // Try to restore selection from URL when data loads (skip tab change)
    nextTick(() => {
      readFromUrl(true);
    });
  }
});

// Watch for selected cell changes - reload episodes when filter changes
watch(selectedCell, async (newCell) => {
  if (isReadingFromUrl) {
    if (newCell && newCell.episodes.length > 0) {
      await loadEpisodeDetails();
    }
    return;
  }
  
  updateUrl();
  if (newCell && newCell.episodes.length > 0) {
    await loadEpisodeDetails();
  }
});

// Watch for showEpisodeList - reload when list is opened
watch(showEpisodeList, async (newValue) => {
  if (newValue && selectedCell.value && selectedCell.value.episodes.length > 0) {
    await loadEpisodeDetails();
  }
});
</script>

