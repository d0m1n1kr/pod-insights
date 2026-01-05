<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import {
  select,
  scaleLinear,
  pointer
} from '@/utils/d3-imports';
import type { SubjectRiverData } from '../types';
import { useSettingsStore } from '../stores/settings';
import { useAudioPlayerStore } from '../stores/audioPlayer';
import { withBase } from '@/composables/usePodcast';
import { useLazyEpisodeDetails } from '@/composables/useEpisodeDetails';

const props = defineProps<{
  data: SubjectRiverData;
  color?: 'blue' | 'purple';
}>();

const emit = defineEmits<{
  (e: 'selected-area', area: { year: number; subject: string } | null): void;
}>();


const route = useRoute();
const settingsStore = useSettingsStore();
const audioPlayerStore = useAudioPlayerStore();

const svgRef = ref<SVGSVGElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);
const dimensions = ref({ width: 800, height: 800 });
const selectedYears = ref<Set<number>>(new Set());
const hoveredArea = ref<{ year: number; subject: string; percentage: number } | null>(null);
const selectedArea = ref<{ year: number; subject: string } | null>(null);

// Year search query
const yearSearchQuery = ref('');

// Get current year and pre-select it
const currentYear = new Date().getFullYear();
const availableYears = computed(() => {
  const years = props.data.statistics.years.filter(year => {
    // Check if any subject has data for this year
    return Object.values(props.data.subjects).some(subject => {
      const yearData = subject.yearData.find(yd => yd.year === year);
      return yearData && yearData.count > 0;
    });
  });
  // Sort in descending order (newest first)
  return years.sort((a, b) => b - a);
});

// Filtered years based on search query
const filteredYears = computed(() => {
  const q = yearSearchQuery.value.trim().toLowerCase();
  if (!q) return availableYears.value;
  
  return availableYears.value.filter(year => {
    return year.toString().includes(q);
  });
});

// Flag to track if years have been initialized from external source (e.g., URL)
const yearsInitializedExternally = ref(false);

// Check URL for initial years before auto-initialization
const checkUrlForYears = () => {
  const query = route.query;
  if (query.years && typeof query.years === 'string') {
    const years = query.years.split(',').map(y => parseInt(y.trim(), 10)).filter(y => Number.isFinite(y));
    if (years.length > 0) {
      yearsInitializedExternally.value = true;
      selectedYears.value = new Set(years);
      return true;
    }
  }
  return false;
};

// Try to restore from URL immediately
checkUrlForYears();

// Initialize selected years with current year (first in descending order) only if not restored from URL
watch(availableYears, (years) => {
  if (years.length > 0 && selectedYears.value.size === 0 && !yearsInitializedExternally.value) {
    const yearToSelect = years.includes(currentYear) ? currentYear : years[0]; // years[0] is now the newest
    if (yearToSelect !== undefined) {
      selectedYears.value.add(yearToSelect);
    }
  }
}, { immediate: true });

// Get top subjects (sorted by total episodes, limited by filter)
const allSubjects = computed(() => {
  const maxSubjects = Object.keys(props.data.subjects).length;
  const filterValue = settingsStore.subjectFilter || maxSubjects;
  
  return Object.values(props.data.subjects)
    .sort((a, b) => b.totalEpisodes - a.totalEpisodes)
    .slice(0, filterValue)
    .map(s => s.id);
});

// Generate colors for years
const yearColors = computed(() => {
  const colors = [
    '#3b82f6', // blue
    '#10b981', // green
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // purple
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#84cc16', // lime
    '#f97316', // orange
    '#6366f1', // indigo
  ];
  const yearColorMap = new Map<number, string>();
  availableYears.value.forEach((year, idx) => {
    const color = colors[idx % colors.length];
    if (color) {
      yearColorMap.set(year, color);
    }
  });
  return yearColorMap;
});

// Calculate total episodes per year (unique episode numbers across all subjects)
const totalEpisodesPerYear = computed(() => {
  const yearMap = new Map<number, Set<number>>();
  
  // Collect all unique episode numbers per year from all subjects
  Object.values(props.data.subjects).forEach(subject => {
    subject.yearData.forEach(yearData => {
      if (!yearMap.has(yearData.year)) {
        yearMap.set(yearData.year, new Set<number>());
      }
      const episodeSet = yearMap.get(yearData.year);
      if (episodeSet) {
        yearData.episodes.forEach(ep => {
          episodeSet.add(ep.number);
        });
      }
    });
  });
  
  // Convert Sets to counts
  const result = new Map<number, number>();
  yearMap.forEach((episodeSet, year) => {
    result.set(year, episodeSet.size);
  });
  
  return result;
});

// Prepare data for radar chart (values as percentages of total episodes per year)
const radarData = computed(() => {
  const subjects = allSubjects.value;
  const years = Array.from(selectedYears.value).sort();
  
  return years.map(year => {
    const totalEpisodesInYear = totalEpisodesPerYear.value.get(year) || 1; // Avoid division by zero
    
    const values = subjects.map(subjectId => {
      const subject = props.data.subjects[subjectId];
      const yearData = subject?.yearData.find(yd => yd.year === year);
      const count = yearData?.count || 0;
      // Convert to percentage: (count / totalEpisodesInYear) * 100
      return totalEpisodesInYear > 0 ? (count / totalEpisodesInYear) * 100 : 0;
    });
    
    return {
      year,
      values,
      color: yearColors.value.get(year) || '#888',
      totalEpisodesInYear
    };
  });
});

// Use lazy loading composable
const { setupLazyLoad } = useLazyEpisodeDetails();
const episodeDetails = ref<Map<number, any>>(new Map());
const loadingEpisodes = ref(false);

const loadEpisodeDetails = () => {
  if (!selectedArea.value) return;
  
  const { year, subject } = selectedArea.value;
  const subjectData = props.data.subjects[subject];
  if (!subjectData) return;
  
  const yearData = subjectData.yearData.find(yd => yd.year === year);
  if (!yearData) return;
  
  const episodesToLoad = yearData.episodes
    .map(ep => ep.number)
    .filter(num => !episodeDetails.value.has(num));
  
  if (episodesToLoad.length === 0) return;
  
  loadingEpisodes.value = true;
  
  episodesToLoad.forEach(episodeNumber => {
    setupLazyLoad(null, episodeNumber, (detail: any) => {
      episodeDetails.value.set(episodeNumber, detail);
    });
  });
  
  loadingEpisodes.value = false;
};

watch(selectedArea, () => {
  loadEpisodeDetails();
});

const formatDuration = (duration: string) => {
  if (!duration) return '—';
  const parts = duration.split(':');
  if (parts.length === 3) {
    const [h, m, s] = parts;
    if (h === '00') return `${m}:${s}`;
    return `${h}:${m}:${s}`;
  }
  return duration;
};

const formatHmsFromSeconds = (sec: unknown) => {
  const s0 = Number.isFinite(sec as number) ? Math.max(0, Math.floor(sec as number)) : null;
  if (s0 === null) return '—';
  const hours = Math.floor(s0 / 3600);
  const minutes = Math.floor((s0 % 3600) / 60);
  const seconds = s0 % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const getTopicOccurrences = (episode: any): Array<{ positionSec: number; durationSec: number | null; topic: string | null }> => {
  const occ = Array.isArray(episode?.occurrences) ? episode.occurrences : [];
  const items: Array<{ positionSec: number; durationSec: number | null; topic: string | null }> = occ
    .map((o: any) => ({
      positionSec: Number.isFinite(o?.positionSec) ? o.positionSec : null,
      durationSec: Number.isFinite(o?.durationSec) ? o.durationSec : null,
      topic: o?.topic || null,
    }))
    .filter((x: any): x is { positionSec: number; durationSec: number | null; topic: string | null } => Number.isFinite(x?.positionSec) && x.positionSec >= 0);

  if (items.length === 0) return [];

  items.sort((a, b) => a.positionSec - b.positionSec);
  const unique: Array<{ positionSec: number; durationSec: number | null; topic: string | null }> = [];
  for (const it of items) {
    const last = unique[unique.length - 1];
    if (!last || last.positionSec !== it.positionSec || last.durationSec !== it.durationSec) unique.push(it);
  }
  return unique;
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

const playEpisodeAt = (episodeNumber: number, seconds: number, title: string) => {
  const details = episodeDetails.value.get(episodeNumber);
  if (!details) return;
  
  const mp3Url = details.url || details.mp3Url;
  if (!mp3Url) return;
  
  audioPlayerStore.play({
    src: withBase(mp3Url),
    title: details.title || `Episode ${episodeNumber}`,
    subtitle: title,
    seekToSec: Math.max(0, Math.floor(seconds)),
    autoplay: true,
  });
};

// Max value is always 100% (since we're now using percentages)
const maxValue = computed(() => 100);

// Draw radar chart
const drawRadar = () => {
  if (!svgRef.value || !containerRef.value) return;
  
  const container = containerRef.value;
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight || 600;
  // Keep it square, use full width but limit height
  const width = containerWidth;
  const height = Math.min(containerWidth, containerHeight, 800);
  dimensions.value = { width, height };
  
  const margin = { top: 80, right: 80, bottom: 80, left: 80 };
  const availableSize = Math.min(width - margin.left - margin.right, height - margin.top - margin.bottom);
  const radius = availableSize / 2;
  const centerX = width / 2;
  const centerY = height / 2;
  
  select(svgRef.value).selectAll('*').remove();
  
  const svg = select(svgRef.value)
    .attr('width', width)
    .attr('height', height);
  
  const g = svg.append('g')
    .attr('transform', `translate(${centerX},${centerY})`);
  
  const subjects = allSubjects.value;
  const numAxes = subjects.length;
  const angleSlice = (Math.PI * 2) / numAxes;
  
  // Scale for values
  const rScale = scaleLinear()
    .domain([0, maxValue.value])
    .range([0, radius]);
  
  // Draw grid circles
  const gridLevels = 5;
  for (let i = 0; i <= gridLevels; i++) {
    const level = i / gridLevels;
    g.append('circle')
      .attr('r', radius * level)
      .attr('fill', 'none')
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1)
      .attr('opacity', 0.3);
  }
  
  // Draw axes
  subjects.forEach((subjectId, i) => {
    const angle = (i * angleSlice) - (Math.PI / 2);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    
    // Axis line
    g.append('line')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', x)
      .attr('y2', y)
      .attr('stroke', '#9ca3af')
      .attr('stroke-width', 1)
      .attr('opacity', 0.5);
    
    // Subject label
    const subject = props.data.subjects[subjectId];
    const labelX = Math.cos(angle) * (radius + 50);
    const labelY = Math.sin(angle) * (radius + 50);
    
    // Truncate long labels
    const maxLabelLength = numAxes > 10 ? 15 : 20;
    const labelText = (subject?.name || subjectId).length > maxLabelLength
      ? (subject?.name || subjectId).substring(0, maxLabelLength) + '...'
      : (subject?.name || subjectId);
    
    g.append('text')
      .attr('x', labelX)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', numAxes > 15 ? '10px' : '12px')
      .attr('fill', '#374151')
      .attr('class', 'dark:fill-gray-300')
      .text(labelText)
      .append('title')
      .text(subject?.name || subjectId);
  });
  
  // Draw year areas
  radarData.value.forEach((yearData) => {
    const points: Array<[number, number]> = [];
    
    subjects.forEach((_subjectId, i) => {
      const angle = (i * angleSlice) - (Math.PI / 2);
      const value = yearData.values[i];
      if (value !== undefined) {
        const r = rScale(value);
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        points.push([x, y]);
      }
    });
    
    // Build SVG path string
    let pathString = '';
    points.forEach((point, i) => {
      if (i === 0) {
        pathString += `M ${point[0]} ${point[1]}`;
      } else {
        pathString += ` L ${point[0]} ${point[1]}`;
      }
    });
    pathString += ' Z'; // Close path
    
    // Create area
    const areaPath = g.append('path')
      .attr('d', pathString)
      .attr('fill', yearData.color)
      .attr('fill-opacity', 0.3)
      .attr('stroke', yearData.color)
      .attr('stroke-width', 2)
      .attr('class', 'radar-area')
      .attr('data-year', yearData.year)
      .style('cursor', 'pointer')
      .on('mouseover', function(event: MouseEvent) {
        select(this).attr('fill-opacity', 0.5);
        
        // Calculate which subject is being hovered
        const [mx, my] = pointer(event, svgRef.value);
        const centerX = width / 2;
        const centerY = height / 2;
        const dx = mx - centerX;
        const dy = my - centerY;
        const angle = Math.atan2(dy, dx) + (Math.PI / 2);
        const normalizedAngle = angle < 0 ? angle + (Math.PI * 2) : angle;
        const subjectIdx = Math.round(normalizedAngle / angleSlice) % subjects.length;
        const subjectId = subjects[subjectIdx];
        
        if (subjectId !== undefined) {
          const value = yearData.values[subjectIdx];
          // Value is already a percentage (0-100)
          const percentage = value !== undefined ? value : 0;
          
          hoveredArea.value = {
            year: yearData.year,
            subject: subjectId,
            percentage: percentage
          };
          
          // Show tooltip - use nextTick to ensure DOM is updated
          nextTick(() => {
            if (tooltipRef.value) {
              const mouseX = event.clientX || (event as any).pageX || 0;
              const mouseY = event.clientY || (event as any).pageY || 0;
              tooltipRef.value.style.display = 'block';
              tooltipRef.value.style.position = 'fixed';
              tooltipRef.value.style.left = `${mouseX + 15}px`;
              tooltipRef.value.style.top = `${mouseY - 10}px`;
              tooltipRef.value.style.zIndex = '1000';
            }
          });
        }
      })
      .on('mousemove', function(event: MouseEvent) {
        // Update tooltip position
        if (tooltipRef.value && hoveredArea.value) {
          const mouseX = event.clientX || (event as any).pageX || 0;
          const mouseY = event.clientY || (event as any).pageY || 0;
          tooltipRef.value.style.left = `${mouseX + 15}px`;
          tooltipRef.value.style.top = `${mouseY - 10}px`;
        }
      })
      .on('mouseout', function() {
        if (!selectedArea.value || selectedArea.value.year !== yearData.year) {
          select(this).attr('fill-opacity', 0.3);
        }
        hoveredArea.value = null;
        if (tooltipRef.value) {
          tooltipRef.value.style.display = 'none';
        }
      })
      .on('click', function(event) {
        const [mx, my] = pointer(event, svgRef.value);
        const centerX = width / 2;
        const centerY = height / 2;
        const dx = mx - centerX;
        const dy = my - centerY;
        const angle = Math.atan2(dy, dx) + (Math.PI / 2);
        const normalizedAngle = angle < 0 ? angle + (Math.PI * 2) : angle;
        const subjectIdx = Math.round(normalizedAngle / angleSlice) % subjects.length;
        const subjectId = subjects[subjectIdx];
        
        if (subjectId !== undefined) {
          selectedArea.value = { year: yearData.year, subject: subjectId };
          emit('selected-area', selectedArea.value);
        }
        select(svgRef.value).selectAll('.radar-area').attr('fill-opacity', 0.3);
        select(this).attr('fill-opacity', 0.7);
      });
    
    // Highlight selected area
    if (selectedArea.value && selectedArea.value.year === yearData.year) {
      areaPath.attr('fill-opacity', 0.7);
    }
  });
  
  // Draw grid labels (value labels on axes as percentages)
  for (let i = 1; i <= gridLevels; i++) {
    const level = i / gridLevels;
    const percentage = Math.round(level * 100);
    
    subjects.forEach((_subjectId, j) => {
      const angle = (j * angleSlice) - (Math.PI / 2);
      const x = Math.cos(angle) * (radius * level);
      const y = Math.sin(angle) * (radius * level);
      
      g.append('text')
        .attr('x', x)
        .attr('y', y)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '10px')
        .attr('fill', '#6b7280')
        .attr('class', 'dark:fill-gray-500')
        .text(`${percentage}%`);
    });
  }
};

// Watch for changes and redraw
watch([selectedYears, radarData, selectedArea, allSubjects], () => {
  nextTick(() => {
    drawRadar();
  });
});

watch(() => settingsStore.isDarkMode, () => {
  nextTick(() => {
    drawRadar();
  });
});

watch(() => settingsStore.subjectFilter, () => {
  // Clear selected area when filter changes
  selectedArea.value = null;
  emit('selected-area', null);
  nextTick(() => {
    drawRadar();
  });
});

// Emit selected area changes
watch(selectedArea, (newArea) => {
  emit('selected-area', newArea);
});

onMounted(() => {
  // Check if parent wants to initialize years from URL
  // This will be called by parent after mount
  nextTick(() => {
    drawRadar();
  });
  
  // Handle resize
  if (containerRef.value) {
    const resizeObserver = new ResizeObserver(() => {
      nextTick(() => {
        drawRadar();
      });
    });
    resizeObserver.observe(containerRef.value);
    
    onUnmounted(() => {
      resizeObserver.disconnect();
    });
  }
});

// Get episodes for selected area (exposed for parent)
const selectedEpisodes = computed(() => {
  if (!selectedArea.value) return [];
  
  const { year, subject } = selectedArea.value;
  const subjectData = props.data.subjects[subject];
  if (!subjectData) return [];
  
  const yearData = subjectData.yearData.find(yd => yd.year === year);
  if (!yearData) return [];
  
  return yearData.episodes.sort((a, b) => b.number - a.number);
});

// Method to set years from external source (e.g., URL)
const setSelectedYears = (years: number[]) => {
  yearsInitializedExternally.value = true;
  // Clear existing years first
  selectedYears.value.clear();
  // Add all years from the array
  years.forEach(year => selectedYears.value.add(year));
  // Force reactivity by creating a new Set
  selectedYears.value = new Set(selectedYears.value);
};

// Method to set selected area from external source (e.g., URL)
const setSelectedArea = (area: { year: number; subject: string } | null) => {
  selectedArea.value = area;
  if (area) {
    emit('selected-area', area);
  }
};

// Expose data for parent component
defineExpose({
  selectedArea,
  selectedYears,
  setSelectedYears,
  setSelectedArea,
  selectedEpisodes,
  episodeDetails,
  getTopicOccurrences,
  formatOccurrenceLabel,
  formatHmsFromSeconds,
  formatDuration,
  playEpisodeAt
});

const toggleYear = (year: number) => {
  if (selectedYears.value.has(year)) {
    selectedYears.value.delete(year);
  } else {
    selectedYears.value.add(year);
  }
  // Force reactivity
  selectedYears.value = new Set(selectedYears.value);
};
</script>

<template>
  <div class="flex flex-col">
    <!-- Radar Chart Content (no panel wrapper) -->
    <div class="p-4 lg:p-6">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col lg:flex-row gap-4">
          <!-- Radar Chart -->
          <div ref="containerRef" class="flex-1 w-full flex justify-center items-center min-h-[600px]">
            <svg ref="svgRef" class="radar-chart w-full h-auto"></svg>
          </div>
          
          <!-- Year Selection (Legend style, Desktop only) -->
          <div class="hidden lg:block w-64 flex-shrink-0">
            <div class="sticky top-4 max-h-[600px] overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-4">
              <h3 class="text-sm font-semibold mb-3 text-gray-900 dark:text-white">Jahre</h3>
              <input
                v-model="yearSearchQuery"
                type="text"
                placeholder="Suche…"
                class="w-full mb-3 px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100"
              />
              <div class="space-y-2">
                <div 
                  v-for="year in filteredYears"
                  :key="year"
                  @click="toggleYear(year)"
                  class="flex items-start gap-2 p-2 rounded cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700"
                  :class="{
                    'bg-gray-100 dark:bg-gray-700': selectedYears.has(year)
                  }"
                >
                  <div 
                    class="w-4 h-4 rounded flex-shrink-0 mt-0.5" 
                    :style="{ backgroundColor: yearColors.get(year) || '#888' }"
                  ></div>
                  <div class="flex-1 min-w-0">
                    <div 
                      class="text-xs leading-tight text-gray-900 dark:text-white"
                      :class="{
                        'font-semibold': selectedYears.has(year)
                      }"
                    >
                      {{ year }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Year Selection (Mobile) -->
        <div class="lg:hidden flex flex-col gap-3">
          <div class="flex flex-wrap gap-2 items-center">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Jahre:</span>
            <input
              v-model="yearSearchQuery"
              type="text"
              placeholder="Suche Jahre…"
              class="flex-1 px-3 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100"
            />
          </div>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="year in filteredYears"
              :key="year"
              @click="toggleYear(year)"
              class="flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-all"
              :class="{
                'bg-gray-100 dark:bg-gray-700': selectedYears.has(year),
                'hover:bg-gray-50 dark:hover:bg-gray-700': !selectedYears.has(year)
              }"
            >
              <div 
                class="w-4 h-4 rounded flex-shrink-0" 
                :style="{ backgroundColor: yearColors.get(year) || '#888' }"
              ></div>
              <span 
                class="text-sm text-gray-900 dark:text-white"
                :class="{
                  'font-semibold': selectedYears.has(year)
                }"
              >
                {{ year }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Tooltip -->
    <div
      ref="tooltipRef"
      class="tooltip fixed bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-xs z-50 pointer-events-none"
      style="display: none;"
    >
      <template v-if="hoveredArea">
        <div class="font-semibold text-purple-900 dark:text-purple-100 mb-1">
          {{ hoveredArea.year }}
        </div>
        <div class="text-gray-900 dark:text-gray-100 mb-1">
          {{ props.data.subjects[hoveredArea.subject]?.name }}
        </div>
        <div class="text-gray-600 dark:text-gray-400">
          {{ hoveredArea.percentage.toFixed(1) }}%
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.radar-chart {
  max-width: 100%;
  height: auto;
  display: block;
}
</style>

