<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import * as d3 from 'd3';
import type { HeatmapData } from '../types';
import { useSettingsStore } from '../stores/settings';

const settingsStore = useSettingsStore();

const heatmapData = ref<HeatmapData | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);

const selectedSpeaker = ref<string | null>(null);
const selectedCategory = ref<string | null>(null);
const showEpisodeList = ref(false);
const showTopicList = ref(false);
const episodeDetails = ref<Map<number, any>>(new Map());
const loadingEpisodes = ref(false);

onMounted(async () => {
  try {
    const response = await fetch('/speaker-category-heatmap.json');
    
    if (!response.ok) {
      throw new Error('Fehler beim Laden der Heatmap-Daten');
    }
    
    heatmapData.value = await response.json();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Unbekannter Fehler';
  } finally {
    loading.value = false;
  }
});

// Watch for data changes to draw heatmap
watch(() => heatmapData.value, (newData) => {
  if (newData) {
    // Use nextTick to ensure DOM is ready
    setTimeout(() => {
      drawHeatmap();
      
      // Add resize observer
      if (containerRef.value) {
        const resizeObserver = new ResizeObserver(() => {
          drawHeatmap();
        });
        resizeObserver.observe(containerRef.value);
      }
    }, 100);
  }
});

const filteredData = computed(() => {
  if (!heatmapData.value) return null;
  
  const topSpeakers = heatmapData.value.speakers.slice(0, settingsStore.topNSpeakersHeatmap);
  const topCategories = (heatmapData.value.categories || [])
    .sort((a, b) => b.totalEpisodes - a.totalEpisodes)
    .slice(0, settingsStore.topNCategoriesHeatmap);
  
  return {
    speakers: topSpeakers,
    categories: topCategories
  };
});

const selectedCellData = computed(() => {
  if (!selectedSpeaker.value || !selectedCategory.value || !heatmapData.value) return null;
  
  const speaker = heatmapData.value.speakers.find(s => s.id === selectedSpeaker.value);
  if (!speaker) return null;
  
  const category = (speaker.categories || []).find(c => c.categoryId === selectedCategory.value);
  const categoryInfo = (heatmapData.value.categories || []).find(c => c.id === selectedCategory.value);
  
  return {
    speakerId: speaker.id,
    speakerName: speaker.name,
    categoryId: selectedCategory.value,
    categoryName: categoryInfo?.name || '',
    categoryDescription: categoryInfo?.description || '',
    count: category?.count || 0,
    episodes: category?.episodes || []
  };
});

const drawHeatmap = () => {
  if (!svgRef.value || !containerRef.value || !filteredData.value) return;
  
  const container = containerRef.value;
  const width = container.clientWidth;
  const { speakers, categories } = filteredData.value;
  
  // Responsive margins and cell size
  const isMobile = width < 640;
  const isTablet = width >= 640 && width < 1024;
  
  const margin = isMobile 
    ? { top: 80, right: 10, bottom: 30, left: 60 }
    : isTablet
    ? { top: 120, right: 20, bottom: 40, left: 100 }
    : { top: 200, right: 40, bottom: 60, left: 200 };
  
  const cellSize = isMobile ? 25 : isTablet ? 32 : 40;
  const innerHeight = speakers.length * cellSize;
  const height = innerHeight + margin.top + margin.bottom;
  
  d3.select(svgRef.value).selectAll('*').remove();
  
  const svg = d3.select(svgRef.value)
    .attr('width', width)
    .attr('height', height);
  
  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);
  
  // Prepare data
  const maxValue = d3.max(speakers, s => 
    d3.max((s.categories || []).filter(c => 
      categories.some(cat => cat.id === c.categoryId)
    ), c => c.count)
  ) || 1;
  
  // Color scale
  const colorScale = d3.scaleSequential(d3.interpolateBlues)
    .domain([0, maxValue]);
  
  // Draw cells
  speakers.forEach((speaker, i) => {
    categories.forEach((category, j) => {
      const categoryData = (speaker.categories || []).find(c => c.categoryId === category.id);
      const value = categoryData?.count || 0;
      
      // Get empty cell color based on dark mode
      const isDark = document.documentElement.classList.contains('dark');
      const emptyCellColor = isDark ? '#1f2937' : '#f0f0f0'; // dark:bg-gray-800 or light gray
      
      g.append('rect')
        .attr('x', j * cellSize)
        .attr('y', i * cellSize)
        .attr('width', cellSize)
        .attr('height', cellSize)
        .attr('fill', value > 0 ? colorScale(value) : emptyCellColor)
        .attr('stroke', () => {
          if (selectedSpeaker.value === speaker.id && selectedCategory.value === category.id) {
            return '#000';
          }
          return 'none';
        })
        .attr('stroke-width', () => {
          if (selectedSpeaker.value === speaker.id && selectedCategory.value === category.id) {
            return 2;
          }
          return 0;
        })
        .attr('stroke-width', () => {
          if (selectedSpeaker.value === speaker.id && selectedCategory.value === category.id) {
            return 3;
          }
          return 1;
        })
        .style('cursor', value > 0 ? 'pointer' : 'default')
        .on('click', function() {
          if (value > 0) {
            if (selectedSpeaker.value === speaker.id && selectedCategory.value === category.id) {
              selectedSpeaker.value = null;
              selectedCategory.value = null;
            } else {
              selectedSpeaker.value = speaker.id;
              selectedCategory.value = category.id;
            }
            drawHeatmap();
          }
        })
        .on('mouseover', function(event) {
          if (value > 0) {
            d3.select(this)
              .attr('stroke', '#333')
              .attr('stroke-width', 2);
            
            // Tooltip
            d3.select('body').append('div')
              .attr('class', 'heatmap-tooltip')
              .style('position', 'absolute')
              .style('background', 'rgba(0,0,0,0.9)')
              .style('color', 'white')
              .style('padding', '8px 12px')
              .style('border-radius', '6px')
              .style('font-size', '13px')
              .style('pointer-events', 'none')
              .style('z-index', '1000')
              .html(`
                <div class="font-semibold">${speaker.name}</div>
                <div class="text-xs">${category.name}</div>
                <div class="text-xs mt-1"><strong>${value}</strong> Episoden</div>
              `)
              .style('left', `${event.pageX + 15}px`)
              .style('top', `${event.pageY - 10}px`);
          }
        })
        .on('mouseout', function() {
          if (!(selectedSpeaker.value === speaker.id && selectedCategory.value === category.id)) {
            d3.select(this)
              .attr('stroke', 'white')
              .attr('stroke-width', 1);
          }
          d3.selectAll('.heatmap-tooltip').remove();
        });
      
      // Add text for non-zero values
      if (value > 0) {
        // Calculate luminance of the cell color to determine text color
        const color = d3.rgb(colorScale(value));
        const luminance = (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255;
        
        // Use dark text for light cells, white text for dark cells
        const textColor = luminance > 0.5 ? '#1f2937' : 'white';
        
        // Responsive font size for cell text
        const cellFontSize = isMobile ? '8px' : isTablet ? '9px' : '11px';
        
        g.append('text')
          .attr('x', j * cellSize + cellSize / 2)
          .attr('y', i * cellSize + cellSize / 2)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('fill', textColor)
          .attr('font-size', cellFontSize)
          .attr('font-weight', '600')
          .attr('pointer-events', 'none')
          .text(value);
      }
    });
  });
  
  // Y-axis labels (speakers)
  const labelFontSize = isMobile ? '9px' : isTablet ? '10px' : '12px';
  
  speakers.forEach((speaker, i) => {
    // Truncate long names on mobile
    let displayName = speaker.name;
    if (isMobile && displayName.length > 10) {
      displayName = displayName.substring(0, 9) + '…';
    } else if (isTablet && displayName.length > 15) {
      displayName = displayName.substring(0, 14) + '…';
    }
    
    const label = g.append('text')
      .attr('x', -5)
      .attr('y', i * cellSize + cellSize / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('fill', selectedSpeaker.value === speaker.id ? '#2563eb' : '#333')
      .attr('font-size', labelFontSize)
      .attr('font-weight', selectedSpeaker.value === speaker.id ? '700' : '400')
      .style('cursor', 'pointer')
      .text(displayName)
      .on('click', () => {
        selectedSpeaker.value = selectedSpeaker.value === speaker.id ? null : speaker.id;
        selectedCategory.value = null;
        drawHeatmap();
      });
    
    // Add tooltip with full name
    if (displayName !== speaker.name) {
      label.append('title').text(speaker.name);
    }
  });
  
  // X-axis labels (categories)
  categories.forEach((category, j) => {
    // Truncate long names on mobile
    let displayName = category.name;
    if (isMobile && displayName.length > 8) {
      displayName = displayName.substring(0, 7) + '…';
    } else if (isTablet && displayName.length > 12) {
      displayName = displayName.substring(0, 11) + '…';
    }
    
    const label = g.append('text')
      .attr('x', j * cellSize + cellSize / 2)
      .attr('y', -5)
      .attr('text-anchor', 'start')
      .attr('dominant-baseline', 'middle')
      .attr('fill', selectedCategory.value === category.id ? '#2563eb' : '#333')
      .attr('font-size', labelFontSize)
      .attr('font-weight', selectedCategory.value === category.id ? '700' : '400')
      .attr('transform', `rotate(-45, ${j * cellSize + cellSize / 2}, -5)`)
      .style('cursor', 'pointer')
      .text(displayName)
      .on('click', () => {
        selectedCategory.value = selectedCategory.value === category.id ? null : category.id;
        selectedSpeaker.value = null;
        drawHeatmap();
      });
    
    // Add tooltip with full name
    if (displayName !== category.name) {
      label.append('title').text(category.name);
    }
  });
  
  // Legend
  const legendWidth = 200;
  const legendHeight = 15;
  const legend = svg.append('g')
    .attr('transform', `translate(${margin.left}, ${height - 40})`);
  
  const legendScale = d3.scaleLinear()
    .domain([0, maxValue])
    .range([0, legendWidth]);
  
  const legendAxis = d3.axisBottom(legendScale)
    .ticks(5)
    .tickFormat(d => d3.format('.0f')(d as number));
  
  // Gradient
  const defs = svg.append('defs');
  const gradient = defs.append('linearGradient')
    .attr('id', 'legend-gradient');
  
  for (let i = 0; i <= 100; i += 10) {
    gradient.append('stop')
      .attr('offset', `${i}%`)
      .attr('stop-color', colorScale(maxValue * i / 100));
  }
  
  legend.append('rect')
    .attr('width', legendWidth)
    .attr('height', legendHeight)
    .style('fill', 'url(#legend-gradient)');
  
  legend.append('g')
    .attr('transform', `translate(0, ${legendHeight})`)
    .call(legendAxis)
    .selectAll('text')
    .attr('font-size', '11px');
  
  legend.append('text')
    .attr('x', legendWidth + 10)
    .attr('y', legendHeight / 2)
    .attr('dominant-baseline', 'middle')
    .attr('font-size', '12px')
    .text('Episoden');
};

watch([() => settingsStore.topNSpeakersHeatmap, () => settingsStore.topNCategoriesHeatmap, () => settingsStore.isDarkMode], () => {
  selectedSpeaker.value = null;
  selectedCategory.value = null;
  drawHeatmap();
});

watch([selectedSpeaker, selectedCategory], () => {
  drawHeatmap();
});

// Load episode details
const loadEpisodeDetails = async () => {
  if (!selectedCellData.value || loadingEpisodes.value) return;
  
  loadingEpisodes.value = true;
  const newDetails = new Map<number, any>();
  
  const toLoad = selectedCellData.value.episodes.filter(num => !episodeDetails.value.has(num));
  
  for (const episodeNum of toLoad) {
    try {
      const response = await fetch(`/episodes/${episodeNum}.json`);
      if (response.ok) {
        const data = await response.json();
        newDetails.set(episodeNum, data);
      } else {
        newDetails.set(episodeNum, null);
      }
    } catch (e) {
      console.error(`Failed to load episode ${episodeNum}:`, e);
      newDetails.set(episodeNum, null);
    }
  }
  
  episodeDetails.value = new Map([...episodeDetails.value, ...newDetails]);
  loadingEpisodes.value = false;
};

watch(showEpisodeList, (newValue) => {
  if (newValue && selectedCellData.value) {
    loadEpisodeDetails();
  }
});

const formatDuration = (duration: [number, number, number]) => {
  const [hours, minutes, seconds] = duration;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};
</script>

<template>
  <div v-if="loading" class="flex items-center justify-center py-20">
    <div class="text-center">
      <div class="inline-block animate-spin rounded-full h-12 w-12 border-4 border-pink-500 border-t-transparent"></div>
      <p class="mt-4 text-gray-600">Lade Heatmap-Daten...</p>
    </div>
  </div>

  <div v-else-if="error" class="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
    <p class="text-red-800 font-semibold">{{ error }}</p>
  </div>

  <div v-else-if="heatmapData" class="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
    <div class="p-3 sm:p-4 md:p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-pink-50 to-pink-100 dark:from-pink-900/20 dark:to-pink-900/30">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div class="text-center">
          <div class="text-2xl sm:text-3xl font-bold text-pink-600">{{ heatmapData.statistics.totalSpeakers }}</div>
          <div class="text-xs sm:text-sm text-gray-600 mt-1">Sprecher gesamt</div>
        </div>
        <div class="text-center">
          <div class="text-2xl sm:text-3xl font-bold text-pink-600">{{ heatmapData.statistics.totalCategories }}</div>
          <div class="text-xs sm:text-sm text-gray-600 mt-1">Kategorien gesamt</div>
        </div>
        <div class="text-center">
          <div class="text-2xl sm:text-3xl font-bold text-pink-600">{{ heatmapData.statistics.totalCombinations }}</div>
          <div class="text-xs sm:text-sm text-gray-600 mt-1">Kombinationen</div>
        </div>
      </div>
    </div>

    <div class="p-3 sm:p-4 md:p-6">
      <!-- Controls -->
      <div class="mb-4 sm:mb-6 flex flex-col sm:flex-row gap-3 sm:gap-6 items-stretch sm:items-center">
        <label class="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 flex flex-col sm:flex-row sm:items-center gap-2">
          <span class="whitespace-nowrap">Anzahl Sprecher:</span>
          <div class="flex items-center gap-2">
            <input
              v-model.number="settingsStore.topNSpeakersHeatmap"
              type="range"
              min="5"
              max="30"
              step="1"
              class="flex-1 sm:w-32 md:w-48 slider-pink"
            />
            <span class="text-pink-600 dark:text-pink-400 font-semibold min-w-[2rem] text-right">{{ settingsStore.topNSpeakersHeatmap }}</span>
          </div>
        </label>
        
        <label class="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 flex flex-col sm:flex-row sm:items-center gap-2">
          <span class="whitespace-nowrap">Anzahl Kategorien:</span>
          <div class="flex items-center gap-2">
            <input
              v-model.number="settingsStore.topNCategoriesHeatmap"
              type="range"
              min="5"
              max="12"
              step="1"
              class="flex-1 sm:w-32 md:w-48 slider-pink"
            />
            <span class="text-pink-600 dark:text-pink-400 font-semibold min-w-[2rem] text-right">{{ settingsStore.topNCategoriesHeatmap }}</span>
          </div>
        </label>
      </div>

      <!-- Selected Cell Details -->
      <div v-if="selectedCellData && selectedCellData.count > 0" class="mb-6 p-4 bg-pink-50 dark:bg-pink-900/20 border border-pink-200 dark:border-pink-700 rounded-lg">
        <div class="relative">
          <button
            @click="selectedSpeaker = null; selectedCategory = null; showEpisodeList = false;"
            class="absolute top-2 right-2 text-pink-600 hover:text-pink-800 dark:text-pink-400 dark:hover:text-pink-300 font-semibold p-1"
            aria-label="Schließen"
          >
            ✕
          </button>

          <div class="min-w-0">
            <div class="pr-10">
              <h3 class="font-semibold text-lg text-pink-900 dark:text-pink-100">
                {{ selectedCellData.speakerName }} → {{ selectedCellData.categoryName }}
              </h3>
              <p class="text-sm text-pink-700 dark:text-pink-300 mt-1">{{ selectedCellData.categoryDescription }}</p>
              <p class="text-sm text-pink-600 dark:text-pink-400 mt-2">
                <strong>{{ selectedCellData.count }}</strong> Episoden in dieser Kombination
              </p>
              
              <div class="mt-3 flex gap-4">
                <button
                  @click="showEpisodeList = !showEpisodeList; if (showEpisodeList) showTopicList = false;"
                  class="text-sm text-pink-600 hover:text-pink-800 dark:text-pink-400 dark:hover:text-pink-300 font-semibold underline"
                >
                  {{ showEpisodeList ? 'Episoden ausblenden' : `${selectedCellData.episodes.length} Episoden anzeigen` }}
                </button>
              </div>
            </div>

            <!-- Episode List -->
            <div v-if="showEpisodeList" class="mt-4 bg-white dark:bg-gray-900 rounded-lg border border-pink-300 dark:border-pink-700">
              <div v-if="loadingEpisodes" class="p-4 text-center text-gray-600 dark:text-gray-400">
                Lade Episoden-Details...
              </div>
              <div v-else class="max-h-96 overflow-auto">
                <table class="min-w-full w-max text-sm table-auto">
                  <thead class="bg-pink-100 dark:bg-pink-900 sticky top-0">
                    <tr>
                      <th class="px-3 py-2 text-left text-xs font-semibold text-pink-900 dark:text-pink-100 whitespace-nowrap">#</th>
                      <th class="px-3 py-2 text-left text-xs font-semibold text-pink-900 dark:text-pink-100 whitespace-nowrap">Datum</th>
                      <th class="px-3 py-2 text-left text-xs font-semibold text-pink-900 dark:text-pink-100">Titel</th>
                      <th class="px-3 py-2 text-left text-xs font-semibold text-pink-900 dark:text-pink-100 whitespace-nowrap">Dauer</th>
                      <th class="px-3 py-2 text-left text-xs font-semibold text-pink-900 dark:text-pink-100 whitespace-nowrap">Sprecher</th>
                      <th class="px-3 py-2 text-left text-xs font-semibold text-pink-900 dark:text-pink-100 whitespace-nowrap">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr 
                      v-for="episodeNum in selectedCellData.episodes" 
                      :key="episodeNum"
                      class="border-t border-pink-100 dark:border-pink-800 hover:bg-pink-50 dark:hover:bg-pink-900/20"
                    >
                      <template v-if="episodeDetails.has(episodeNum) && episodeDetails.get(episodeNum)">
                        <td class="px-3 py-2 text-pink-700 dark:text-pink-300 font-mono text-xs whitespace-nowrap">{{ episodeNum }}</td>
                        <td class="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap text-xs">
                          {{ new Date(episodeDetails.get(episodeNum).date).toLocaleDateString('de-DE') }}
                        </td>
                        <td class="px-3 py-2 text-gray-900 dark:text-gray-100 text-xs">{{ episodeDetails.get(episodeNum).title }}</td>
                        <td class="px-3 py-2 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">
                          {{ formatDuration(episodeDetails.get(episodeNum).duration) }}
                        </td>
                        <td class="px-3 py-2 text-xs whitespace-nowrap">
                          <template v-for="(speaker, idx) in episodeDetails.get(episodeNum).speakers" :key="`${episodeNum}-${idx}`">
                            <span
                              :class="[
                                'inline-block',
                                speaker === selectedCellData?.speakerName 
                                  ? 'font-semibold text-pink-700 dark:text-pink-300 bg-pink-100 dark:bg-pink-900/30 px-1 rounded' 
                                  : 'text-gray-600 dark:text-gray-400'
                              ]"
                            >{{ speaker }}</span><span v-if="(idx as number) < (episodeDetails.get(episodeNum).speakers.length - 1)" class="text-gray-600 dark:text-gray-400">, </span>
                          </template>
                        </td>
                        <td class="px-3 py-2">
                          <a 
                            :href="episodeDetails.get(episodeNum).url"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="text-pink-600 hover:text-pink-800 dark:text-pink-400 dark:hover:text-pink-300 underline text-xs"
                          >
                            🔗
                          </a>
                        </td>
                      </template>
                      <template v-else-if="episodeDetails.has(episodeNum) && episodeDetails.get(episodeNum) === null">
                        <td colspan="6" class="px-3 py-2 text-gray-400 dark:text-gray-500 text-xs">Episode {{ episodeNum }} - Daten nicht verfügbar</td>
                      </template>
                      <template v-else>
                        <td colspan="6" class="px-3 py-2 text-gray-400 dark:text-gray-500 text-xs">Lädt...</td>
                      </template>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Heatmap -->
      <div ref="containerRef" class="overflow-x-auto">
        <svg ref="svgRef"></svg>
      </div>

      <div class="mt-6 text-sm text-gray-600">
        <p>
          <strong>Interaktion:</strong> Klicke auf eine Zelle, um Details zu Sprecher und Kategorie anzuzeigen.
          Die Zahlen zeigen die Anzahl der Episoden für jede Kombination.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
input[type="range"] {
  accent-color: #6366f1;
}
</style>

