<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-violet-50 to-violet-100 dark:from-violet-900/20 dark:to-violet-900/30">
      <div v-if="heatmapData" class="grid grid-cols-3 gap-4">
        <div class="text-center">
          <div class="text-3xl font-bold text-violet-600 dark:text-violet-400">{{ heatmapData.statistics.totalEpisodes }}</div>
          <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">Episoden insgesamt</p>
        </div>
        <div class="text-center">
          <div class="text-3xl font-bold text-violet-600 dark:text-violet-400">{{ heatmapData.statistics.mostCommonDay }}</div>
          <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">Häufigster Wochentag</p>
        </div>
        <div class="text-center">
          <div class="text-3xl font-bold text-violet-600 dark:text-violet-400">{{ heatmapData.statistics.mostCommonDurationLabel }}</div>
          <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">Häufigste Dauer</p>
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
          <!-- Selected Cell Details -->
          <div v-if="selectedCell" class="mb-6 p-4 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 rounded-lg">
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <h3 class="font-semibold text-lg text-violet-900 dark:text-violet-100">
                  {{ selectedCell.day }} – {{ selectedCell.durationLabel }}
                </h3>
                <p class="text-sm text-violet-600 dark:text-violet-400 mt-2">
                  <strong>{{ selectedCell.episodes.length }}</strong> Episoden
                </p>
                
                <div class="mt-3">
                  <button
                    @click="showEpisodeList = !showEpisodeList"
                    class="text-sm text-violet-600 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-300 font-semibold underline"
                  >
                    {{ showEpisodeList ? 'Episoden ausblenden' : `${selectedCell.episodes.length} Episoden anzeigen` }}
                  </button>
                </div>

                <!-- Episode List -->
                <div v-if="showEpisodeList" class="mt-4 bg-white dark:bg-gray-900 rounded-lg border border-violet-300 dark:border-violet-700 overflow-hidden">
                  <div v-if="loadingEpisodes" class="p-4 text-center text-gray-600 dark:text-gray-400">
                    Lade Episoden-Details...
                  </div>
                  <div v-else class="max-h-96 overflow-y-auto">
                    <table class="w-full text-sm">
                      <thead class="bg-violet-100 dark:bg-violet-900 sticky top-0">
                        <tr>
                          <th class="px-3 py-2 text-left text-xs font-semibold text-violet-900 dark:text-violet-100">#</th>
                          <th class="px-3 py-2 text-left text-xs font-semibold text-violet-900 dark:text-violet-100">Datum</th>
                          <th class="px-3 py-2 text-left text-xs font-semibold text-violet-900 dark:text-violet-100">Titel</th>
                          <th class="px-3 py-2 text-left text-xs font-semibold text-violet-900 dark:text-violet-100">Dauer</th>
                          <th class="px-3 py-2 text-left text-xs font-semibold text-violet-900 dark:text-violet-100">Sprecher</th>
                          <th class="px-3 py-2 text-left text-xs font-semibold text-violet-900 dark:text-violet-100">Link</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr 
                          v-for="episodeNum in selectedCell.episodes" 
                          :key="episodeNum"
                          class="border-t border-violet-100 dark:border-violet-800 hover:bg-violet-50 dark:hover:bg-violet-900/20"
                        >
                          <template v-if="episodeDetails.has(episodeNum) && episodeDetails.get(episodeNum) !== null">
                            <td class="px-3 py-2 text-violet-700 dark:text-violet-300 font-mono text-xs">{{ episodeNum }}</td>
                            <td class="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap text-xs">
                              {{ formatDate(episodeDetails.get(episodeNum)?.date) }}
                            </td>
                            <td class="px-3 py-2 text-gray-900 dark:text-gray-100 text-xs">
                              {{ episodeDetails.get(episodeNum)?.title }}
                            </td>
                            <td class="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap text-xs">
                              {{ formatDuration(episodeDetails.get(episodeNum)?.duration) }}
                            </td>
                            <td class="px-3 py-2 text-gray-600 dark:text-gray-400 text-xs">
                              <span v-for="(speaker, idx) in episodeDetails.get(episodeNum)?.speakers" :key="speaker">
                                <span class="inline-block text-gray-600 dark:text-gray-400">{{ speaker }}</span><span v-if="idx < ((episodeDetails.get(episodeNum)?.speakers?.length || 0) - 1)" class="text-gray-600 dark:text-gray-400">, </span>
                              </span>
                            </td>
                            <td class="px-3 py-2 text-xs">
                              <a 
                                v-if="episodeDetails.get(episodeNum)?.url" 
                                :href="episodeDetails.get(episodeNum)?.url" 
                                target="_blank"
                                class="text-violet-600 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-300 underline"
                              >
                                →
                              </a>
                            </td>
                          </template>
                          <template v-else-if="episodeDetails.get(episodeNum) === null">
                            <td class="px-3 py-2 text-violet-700 dark:text-violet-300 font-mono text-xs">{{ episodeNum }}</td>
                            <td colspan="5" class="px-3 py-2 text-gray-400 dark:text-gray-500 text-xs italic">
                              Details nicht verfügbar
                            </td>
                          </template>
                          <template v-else>
                            <td class="px-3 py-2 text-violet-700 dark:text-violet-300 font-mono text-xs">{{ episodeNum }}</td>
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
              
              <button
                @click="clearSelection"
                class="ml-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fill-rule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clip-rule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>

          <!-- SVG Container -->
          <svg ref="svgElement" class="w-full"></svg>
          
          <!-- Interaction Instructions -->
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-4 text-center">
            Klicke auf eine Zelle, um Episoden an diesem Wochentag mit dieser Dauer zu sehen
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import * as d3 from 'd3';
import { useSettingsStore } from '../stores/settings';

const settingsStore = useSettingsStore();

interface EpisodeDetail {
  title: string;
  date: string;
  duration?: string | number;
  speakers?: string[];
  url?: string;
}

interface DayOfWeekDurationData {
  generatedAt: string;
  description: string;
  statistics: {
    totalEpisodes: number;
    totalDays: number;
    totalDurationBuckets: number;
    totalCombinations: number;
    mostCommonDay: string;
    mostCommonDayCount: number;
    mostCommonDuration: number;
    mostCommonDurationLabel: string;
    mostCommonDurationCount: number;
  };
  days: Array<{
    name: string;
    totalEpisodes: number;
  }>;
  durations: Array<{
    minutes: number;
    label: string;
    totalEpisodes: number;
  }>;
  matrix: Array<{
    day: string;
    values: Array<{
      duration: number;
      durationLabel: string;
      count: number;
      episodes: number[];
    }>;
  }>;
}

const heatmapData = ref<DayOfWeekDurationData | null>(null);
const svgElement = ref<SVGSVGElement | null>(null);
const heatmapContainer = ref<HTMLDivElement | null>(null);

const selectedCell = ref<{
  day: string;
  durationLabel: string;
  count: number;
  episodes: number[];
} | null>(null);

const showEpisodeList = ref(false);
const loadingEpisodes = ref(false);

const episodeDetails = ref<Map<number, EpisodeDetail | null>>(new Map());

function clearSelection() {
  selectedCell.value = null;
  showEpisodeList.value = false;
}

function formatDate(dateStr?: string) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('de-DE');
}

function formatDuration(duration?: string | number): string {
  if (!duration) return '';
  
  // If it's already a string, return it
  if (typeof duration === 'string') return duration;
  
  // If it's a number (seconds), convert to "Xh Ym" format
  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

async function loadEpisodeDetails() {
  if (!selectedCell.value) return;
  
  loadingEpisodes.value = true;
  
  for (const episodeNum of selectedCell.value.episodes) {
    if (!episodeDetails.value.has(episodeNum)) {
      try {
        const response = await fetch(`/episodes/${episodeNum}.json`);
        if (response.ok) {
          const data = await response.json();
          
          // Convert duration from [h, m, s] to total seconds
          let durationInSeconds: number | undefined;
          if (Array.isArray(data.duration) && data.duration.length === 3) {
            const [h, m, s] = data.duration;
            durationInSeconds = h * 3600 + m * 60 + s;
          }
          
          // Create a clean EpisodeDetail object
          const episodeDetail: EpisodeDetail = {
            title: data.title || '',
            date: data.date || '',
            duration: durationInSeconds,
            speakers: data.speakers || [],
            url: data.url || ''
          };
          
          episodeDetails.value.set(episodeNum, episodeDetail);
        } else {
          episodeDetails.value.set(episodeNum, null);
        }
      } catch (error) {
        console.error(`Failed to load episode ${episodeNum}:`, error);
        episodeDetails.value.set(episodeNum, null);
      }
    }
  }
  
  loadingEpisodes.value = false;
}

// Helper function to determine text color based on background luminance
function getTextColor(color: string): string {
  let r: number, g: number, b: number;
  
  // Handle both hex (#rrggbb) and rgb(r, g, b) formats
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
  return luminance > 0.35 ? '#1f2937' : 'white'; // Dark text for light cells, white for dark cells
}

function drawHeatmap() {
  if (!svgElement.value || !heatmapData.value || !heatmapContainer.value) return;

  // Remove all existing tooltips first
  d3.selectAll('.heatmap-tooltip').remove();

  const svg = d3.select(svgElement.value);
  svg.selectAll('*').remove();

  const matrix = heatmapData.value.matrix;
  const durations = heatmapData.value.durations;

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
  const cellSize = Math.min(80, Math.max(40, containerWidth / (durations.length + 3)));
  const margin = { top: 100, right: 20, bottom: 20, left: 150 };
  const width = durations.length * cellSize;
  const height = matrix.length * cellSize;

  svg.attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom);

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Color scale
  const maxCount = d3.max(matrix.flatMap(row => row.values.map(v => v.count))) || 0;
  const colorScale = d3.scaleSequential(d3.interpolatePurples)
    .domain([0, maxCount]);

  // X axis (durations)
  const xScale = d3.scaleBand()
    .domain(durations.map(d => d.minutes.toString()))
    .range([0, width])
    .padding(0.05);

  // Y axis (days)
  const yScale = d3.scaleBand()
    .domain(matrix.map(row => row.day))
    .range([0, height])
    .padding(0.05);

  // Draw cells
  matrix.forEach((row) => {
    row.values.forEach((value) => {
      const x = xScale(value.duration.toString());
      const y = yScale(row.day);
      
      if (x === undefined || y === undefined) return;

      // Get empty cell color based on dark mode
      const isDark = document.documentElement.classList.contains('dark');
      const emptyCellColor = isDark ? '#1f2937' : '#f0f0f0';

      const cellGroup = g.append('g')
        .attr('class', 'cell-group')
        .style('cursor', value.count > 0 ? 'pointer' : 'default');

      cellGroup.append('rect')
        .attr('x', x)
        .attr('y', y)
        .attr('width', xScale.bandwidth())
        .attr('height', yScale.bandwidth())
        .attr('fill', value.count > 0 ? colorScale(value.count) : emptyCellColor)
        .attr('stroke', 'none')
        .attr('stroke-width', 0)
        .on('mouseover', function(event) {
          if (value.count === 0) return;
          
          d3.select(this)
            .attr('stroke', '#000')
            .attr('stroke-width', 2);
          
          d3.selectAll('.heatmap-tooltip').remove();
          
          d3.select('body').append('div')
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
              <strong>${row.day}</strong><br/>
              ${value.durationLabel}<br/>
              ${value.count} Episoden
            `)
            .style('left', (event.pageX + 10) + 'px')
            .style('top', (event.pageY - 28) + 'px');
        })
        .on('mouseout', function() {
          d3.select(this)
            .attr('stroke', 'none')
            .attr('stroke-width', 0);
          
          d3.selectAll('.heatmap-tooltip').remove();
        })
        .on('click', function() {
          if (value.count === 0) return;
          
          d3.selectAll('.heatmap-tooltip').remove();
          
          selectedCell.value = {
            day: row.day,
            durationLabel: value.durationLabel,
            count: value.count,
            episodes: value.episodes
          };
          
          showEpisodeList.value = true;
          loadEpisodeDetails();
        });

      // Add text if cell has data
      if (value.count > 0 && cellSize > 30) {
        const cellColor = colorScale(value.count);
        const textColor = getTextColor(cellColor);
        
        cellGroup.append('text')
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
  g.append('g')
    .selectAll('text')
    .data(durations)
    .enter()
    .append('text')
    .attr('x', d => (xScale(d.minutes.toString()) || 0) + xScale.bandwidth() / 2)
    .attr('y', -15)
    .attr('text-anchor', 'middle')
    .attr('font-size', '12px')
    .attr('class', 'fill-gray-700 dark:fill-gray-300')
    .text(d => d.label);

  // Y axis labels (days)
  g.append('g')
    .selectAll('text')
    .data(matrix)
    .enter()
    .append('text')
    .attr('x', -10)
    .attr('y', d => (yScale(d.day) || 0) + yScale.bandwidth() / 2)
    .attr('text-anchor', 'end')
    .attr('dominant-baseline', 'middle')
    .attr('font-size', '12px')
    .attr('class', 'fill-gray-700 dark:fill-gray-300')
    .text(d => d.day);

  // Legend
  const legendWidth = 200;
  const legendHeight = 10;
  const legend = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top + height + 40})`);

  const legendScale = d3.scaleLinear()
    .domain([0, maxCount])
    .range([0, legendWidth]);

  const legendAxis = d3.axisBottom(legendScale)
    .ticks(5)
    .tickFormat(d => d.toString());

  // Create gradient
  const gradient = svg.append('defs')
    .append('linearGradient')
    .attr('id', 'legend-gradient-dayofweek')
    .attr('x1', '0%')
    .attr('x2', '100%');

  for (let i = 0; i <= 100; i += 10) {
    gradient.append('stop')
      .attr('offset', `${i}%`)
      .attr('stop-color', colorScale(maxCount * i / 100));
  }

  legend.append('rect')
    .attr('width', legendWidth)
    .attr('height', legendHeight)
    .style('fill', 'url(#legend-gradient-dayofweek)');

  legend.append('g')
    .attr('transform', `translate(0,${legendHeight})`)
    .call(legendAxis)
    .attr('class', 'fill-gray-700 dark:fill-gray-300')
    .selectAll('text')
    .attr('class', 'fill-gray-700 dark:fill-gray-300');

  legend.append('text')
    .attr('x', legendWidth / 2)
    .attr('y', -5)
    .attr('text-anchor', 'middle')
    .attr('font-size', '12px')
    .attr('class', 'fill-gray-700 dark:fill-gray-300')
    .text('Anzahl Episoden');
}

// Load data on mount
onMounted(async () => {
  try {
    const response = await fetch('/dayofweek-duration-heatmap.json');
    heatmapData.value = await response.json();
  } catch (error) {
    console.error('Failed to load heatmap data:', error);
  }
});

// Watch for data changes and redraw
watch([heatmapData, () => settingsStore.isDarkMode], () => {
  if (heatmapData.value) {
    drawHeatmap();
  }
});

// Watch for selected cell changes
watch(selectedCell, () => {
  if (selectedCell.value) {
    loadEpisodeDetails();
  }
});

// Watch for window resize
let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
  if (heatmapContainer.value) {
    resizeObserver = new ResizeObserver(() => {
      if (heatmapData.value) {
        drawHeatmap();
      }
    });
    resizeObserver.observe(heatmapContainer.value);
  }
});
</script>

