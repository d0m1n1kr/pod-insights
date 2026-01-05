<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick, onUnmounted } from 'vue';
import {
  select,
  scaleLinear,
  axisBottom,
  format,
  extent,
  area,
  curveCatmullRom,
  stack,
  stackOffsetExpand,
  stackOffsetWiggle,
  stackOrderInsideOut,
  pointer,
  schemeCategory10,
  schemePaired,
  schemeSet3,
  easeSinInOut
} from '@/utils/d3-imports';
import type { TopicRiverData, ProcessedTopicData } from '../types';
import { useSettingsStore } from '../stores/settings';
import { useAudioPlayerStore } from '../stores/audioPlayer';
import { getPodcastFileUrl, getSpeakersBaseUrl, withBase } from '@/composables/usePodcast';
import { useLazyEpisodeDetails, loadEpisodeDetail, getCachedEpisodeDetail } from '@/composables/useEpisodeDetails';

const props = defineProps<{
  data: TopicRiverData;
  color?: 'blue' | 'purple';
  normalizedView?: boolean;
  topicFilter?: number;
}>();

const emit = defineEmits<{
  (e: 'update:normalizedView', value: boolean): void;
  (e: 'update:topicFilter', value: number): void;
}>();

const themeColor = props.color || 'blue';

const settingsStore = useSettingsStore();
const audioPlayerStore = useAudioPlayerStore();

// Use props if provided, otherwise fall back to store
const normalizedView = computed(() => props.normalizedView !== undefined ? props.normalizedView : settingsStore.normalizedView);
const topicFilterValue = computed(() => props.topicFilter !== undefined ? props.topicFilter : settingsStore.topicFilter);

const svgRef = ref<SVGSVGElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);
const selectedTopic = ref<string | null>(null);
const hoveredTopic = ref<string | null>(null);
const dimensions = ref({ width: 1200, height: 600 });
const tooltipRef = ref<HTMLDivElement | null>(null);
const selectedYear = ref<number | null>(null);
const hoveredYear = ref<number | null>(null);

// Total count of available topics (before filtering)

// Slider max must be >= min (min is 5)

// Default slider value to "max" (but don't override persisted user choice)
// Note: This is now handled by the parent component via props

// Legend search (desktop)
const legendSearchQuery = ref('');
const filteredLegendTopics = computed(() => {
  const q = legendSearchQuery.value.trim().toLowerCase();
  const items = processedData.value.topics;
  if (!q) return items;
  return items.filter((t) => t.name.toLowerCase().includes(q));
});

// Prozessiere die Daten
const processedData = computed(() => {
  const topics: ProcessedTopicData[] = [];
  const years = props.data.statistics.years;
  
  console.log('Processing data with topicFilter:', topicFilterValue.value);
  
  const hasRelevanceData = Object.values(props.data.topics).some(t =>
    Number.isFinite((t as any).totalRelevanceSec) ||
    (Array.isArray((t as any).yearData) && (t as any).yearData.some((yd: any) => Number.isFinite(yd?.totalRelevanceSec)))
  );

  const computeTopicTotalRelevanceSec = (topic: any): number => {
    if (Number.isFinite(topic?.totalRelevanceSec)) return topic.totalRelevanceSec;
    if (!Array.isArray(topic?.yearData)) return 0;
    return topic.yearData.reduce((sum: number, yd: any) => sum + (Number.isFinite(yd?.totalRelevanceSec) ? yd.totalRelevanceSec : 0), 0);
  };

  // Erstelle ein Array aller Topics mit ihrer Episode-Anzahl / Relevanz (Sekunden)
  const allTopics = Object.values(props.data.topics).map(topic => ({
    id: topic.id,
    name: topic.name,
    episodeCount: topic.totalEpisodes,
    relevanceSec: computeTopicTotalRelevanceSec(topic as any),
    data: topic
  }));
  
  // Sortiere nach Relevanz (oder Episode-Anzahl als Fallback) und nimm die Top-N
  const topTopics = allTopics
    .sort((a, b) => {
      const av = hasRelevanceData ? a.relevanceSec : a.episodeCount;
      const bv = hasRelevanceData ? b.relevanceSec : b.episodeCount;
      return bv - av;
    })
    .slice(0, topicFilterValue.value);
  
  console.log('Top topics count:', topTopics.length);
  
  // Erweiterte Farbpalette für mehr Topics
  const generateColors = (count: number): string[] => {
    if (count <= 10) {
      return schemeCategory10.slice(0, count);
    }
    
    // Kombiniere mehrere D3 Farbschemata für bessere Unterscheidbarkeit
    const colors = [
      ...schemeCategory10,
      ...schemePaired,
      ...schemeSet3
    ];
    
    // Falls immer noch nicht genug, generiere zusätzliche Farben mit HSL
    if (count > colors.length) {
      for (let i = colors.length; i < count; i++) {
        const hue = (i * 137.5) % 360; // Goldener Winkel für gute Verteilung
        const saturation = 60 + (i % 3) * 15;
        const lightness = 45 + (i % 4) * 10;
        colors.push(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
      }
    }
    
    return colors.slice(0, count);
  };
  
  const colors = generateColors(topTopics.length);
  
  topTopics.forEach((topicMeta, index) => {
    const topic = topicMeta.data;
    if (!topic) return;
    
    const yearValues = new Map<number, number>();
    
    // Initialisiere alle Jahre mit 0
    years.forEach(year => yearValues.set(year, 0));
    
    // Setze die tatsächlichen Werte (Relevanz in Sekunden; Fallback: Anzahl Episoden)
    topic.yearData.forEach(yd => {
      const v = hasRelevanceData
        ? (Number.isFinite((yd as any)?.totalRelevanceSec) ? (yd as any).totalRelevanceSec : 0)
        : yd.count;
      yearValues.set(yd.year, v);
    });
    
    topics.push({
      id: topic.id,
      name: topic.name,
      yearValues,
      totalDuration: hasRelevanceData ? computeTopicTotalRelevanceSec(topic as any) : topic.totalEpisodes,
      color: colors[index] || '#888'
    });
  });
  
  return { topics, years };
});

const formatTimespanSec = (sec: unknown) => {
  const s0 = Number.isFinite(sec as number) ? Math.max(0, Math.round(sec as number)) : 0;
  const days = Math.floor(s0 / 86400);
  const hours = Math.floor((s0 % 86400) / 3600);
  const minutes = Math.floor((s0 % 3600) / 60);
  const seconds = s0 % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

let pulsingTopicKey: string | null = null;
const stopPulse = () => {
  pulsingTopicKey = null;
  if (!svgRef.value) return;
  // Stop any in-flight pulse transitions and remove the pulse stroke.
  select(svgRef.value)
    .selectAll<SVGPathElement, any>('.stream')
    .interrupt()
    .attr('stroke', 'none');
};

const pulseOnce = (key: string) => {
  if (!svgRef.value) return;
  if (pulsingTopicKey !== key) return;
  if (hoveredTopic.value !== key) return;

  const stroke = settingsStore.isDarkMode ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.45)';
  const sel = select(svgRef.value)
    .selectAll<SVGPathElement, any>('.stream')
    .filter((d: any) => d?.key === key);

  // Continuous pulse (loop) while legend hover stays active.
  sel.interrupt();
  sel.attr('stroke', stroke)
    .attr('stroke-linejoin', 'round')
    .attr('stroke-linecap', 'round')
    .attr('stroke-width', 0)
    .attr('stroke-opacity', 0)
    .transition()
    .duration(650)
    .ease(easeSinInOut)
    .attr('stroke-width', 2.5)
    .attr('stroke-opacity', 0.9)
    .transition()
    .delay(120)
    .duration(850)
    .ease(easeSinInOut)
    .attr('stroke-width', 0)
    .attr('stroke-opacity', 0)
    .on('end', () => {
      if (pulsingTopicKey === key && hoveredTopic.value === key) pulseOnce(key);
      else {
        // Ensure cleanup if hover ended mid-loop.
        select(svgRef.value as any).selectAll('.stream').attr('stroke', 'none');
      }
    });
};

const startPulse = (key: string) => {
  pulsingTopicKey = key;
  pulseOnce(key);
};

// Erstelle das Stream Graph (Topic River)
const drawRiver = () => {
  if (!svgRef.value || !containerRef.value) return;
  
  const container = containerRef.value;
  const width = container.clientWidth;
  const height = dimensions.value.height;
  dimensions.value.width = width;
  
  // Responsive margins (reduced right margin since legend is now separate)
  const isMobile = width < 640;
  const isTablet = width >= 640 && width < 1024;
  
  const margin = isMobile
    ? { top: 20, right: 10, bottom: 60, left: 40 }
    : isTablet
    ? { top: 20, right: 20, bottom: 60, left: 50 }
    : { top: 20, right: 20, bottom: 60, left: 60 };
  
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  
  // Lösche vorherigen Inhalt
  stopPulse();
  select(svgRef.value).selectAll('*').remove();
  
  // No need to extend SVG width for legend anymore
  const svg = select(svgRef.value)
    .attr('width', width)
    .attr('height', height);
  
  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);
  
  const { topics, years } = processedData.value;
  
  console.log('Drawing river with', topics.length, 'topics');
  
  // Erstelle Stack-Daten
  const stackData: any[] = years.map(year => {
    const obj: any = { year };
    topics.forEach(topic => {
      obj[topic.id] = topic.yearValues.get(year) || 0;
    });
    return obj;
  });
  
  const keys = topics.map(t => t.id);
  const stackFn = stack()
    .keys(keys)
    // In normierter Ansicht: stackOffsetExpand sorgt für gleich hohe Jahre (0-1)
    // In normaler Ansicht: stackOffsetWiggle für schöne Stream-Optik
    .offset(normalizedView.value ? stackOffsetExpand : stackOffsetWiggle)
    .order(stackOrderInsideOut);
  
  const series = stackFn(stackData);
  
  // Scales
  const xScale = scaleLinear()
    .domain([years[0] || 0, years[years.length - 1] || 0])
    .range([0, innerWidth]);
  
  const flatValues = series.flat(2).filter((d): d is number => d !== undefined);
  const yExtent = extent(flatValues) as [number, number];
  // In normierter Ansicht: Domain immer auf [0, 1] begrenzen, da stackOffsetExpand normalisiert
  // Die Kurveninterpolation kann temporär Werte > 1.0 erzeugen, daher clampen wir die Domain
  const yDomain = normalizedView.value 
    ? [0, 1] as [number, number]
    : yExtent;
  const yScale = scaleLinear()
    .domain(yDomain)
    .range([innerHeight, 0]);
  
  // Area generator
  const areaFn = area<any>()
    .x((d: any) => xScale(d.data.year))
    .y0((d: any) => {
      // In normierter Ansicht: Werte auf [0, 1] clampen, da Kurveninterpolation Werte außerhalb erzeugen kann
      const val = normalizedView.value ? Math.max(0, Math.min(1, d[0])) : d[0];
      return yScale(val);
    })
    .y1((d: any) => {
      // In normierter Ansicht: Werte auf [0, 1] clampen, da Kurveninterpolation Werte außerhalb erzeugen kann
      const val = normalizedView.value ? Math.max(0, Math.min(1, d[1])) : d[1];
      return yScale(val);
    })
    // Important: curveBasis is an approximating spline and can visually distort values at exact years.
    // Use an interpolating curve so the thickness at each year matches the underlying data much better.
    .curve(curveCatmullRom.alpha(0.5));

  // Hover highlight band for the nearest year (behind the streams)
  const year0 = Number.isFinite(years?.[0] as number) ? (years[0] as number) : 0;
  const year1 =
    years.length >= 2 && Number.isFinite(years?.[1] as number) ? (years[1] as number) : year0 + 1;
  const yearStep = Math.max(1, xScale(year1) - xScale(year0));
  const isDark = settingsStore.isDarkMode;
  const borderColor =
    themeColor === 'purple'
      ? (isDark ? '#c4b5fd' : '#6d28d9') // violet-300 / violet-700
      : (isDark ? '#93c5fd' : '#1d4ed8'); // blue-300 / blue-700
  const yearHighlight = g.append('rect')
    .attr('class', 'year-highlight')
    .attr('y', 0)
    .attr('height', innerHeight)
    .attr('fill', themeColor === 'purple' ? '#7c3aed' : '#2563eb')
    .attr('opacity', 0.08)
    .style('pointer-events', 'none')
    .style('display', 'none');
  const yearHighlightLeft = g.append('rect')
    .attr('class', 'year-highlight-border-left')
    .attr('y', 0)
    .attr('height', innerHeight)
    .attr('width', 1)
    .attr('fill', borderColor)
    .attr('opacity', isDark ? 0.35 : 0.45)
    .style('pointer-events', 'none')
    .style('display', 'none');
  const yearHighlightRight = g.append('rect')
    .attr('class', 'year-highlight-border-right')
    .attr('y', 0)
    .attr('height', innerHeight)
    .attr('width', 1)
    .attr('fill', borderColor)
    .attr('opacity', isDark ? 0.35 : 0.45)
    .style('pointer-events', 'none')
    .style('display', 'none');

  const nearestYear = (targetYear: number): number => {
    if (!Array.isArray(years) || years.length === 0) return targetYear;
    let best: number = Number.isFinite(years?.[0] as number) ? (years[0] as number) : targetYear;
    let bestDist = Math.abs(best - targetYear);
    for (const yy of years as Array<number | undefined>) {
      if (!Number.isFinite(yy as number)) continue;
      const y = yy as number;
      const d = Math.abs(y - targetYear);
      if (d < bestDist) {
        best = y;
        bestDist = d;
      }
    }
    return best;
  };
  
  // Zeichne die Streams
  const streams = g.selectAll('.stream')
    .data(series)
    .join('path')
    .attr('class', 'stream')
    .attr('d', areaFn)
    .attr('fill', (d: any) => {
      const topic = topics.find(t => t.id === d.key);
      return topic?.color || '#ccc';
    })
    .attr('opacity', (d: any) => {
      if (!hoveredTopic.value && !selectedTopic.value) return 0.8;
      if (hoveredTopic.value && d.key === hoveredTopic.value) return 1;
      if (selectedTopic.value && d.key === selectedTopic.value) return 1;
      return 0.2;
    })
    .style('cursor', 'pointer')
    .on('mouseover', function(_event: any, d: any) {
      hoveredTopic.value = d.key;
    })
    .on('mousemove', function(event: any, d: any) {
      if (!tooltipRef.value) return;
      
      // Finde das nächste Jahr zum Mauszeiger
      const [mx] = pointer(event);
      const yearRaw = Math.round(xScale.invert(mx));
      const year = nearestYear(yearRaw);
      hoveredYear.value = year;

      // Show year band highlight (even if there's no data for this topic/year)
      const x0 = Math.max(0, Math.min(innerWidth - yearStep, xScale(year) - yearStep / 2));
      yearHighlight
        .attr('x', x0)
        .attr('width', yearStep)
        .style('display', null);
      yearHighlightLeft
        .attr('x', x0)
        .style('display', null);
      yearHighlightRight
        .attr('x', x0 + Math.max(0, yearStep - 1))
        .style('display', null);
      const topic = topics.find(t => t.id === d.key);
      
      if (topic) {
        const topicData = props.data.topics[topic.id];
        const yearData = topicData?.yearData.find(yd => yd.year === year);
        
        const relevanceSec = topic.yearValues.get(year) || 0;
        const episodeCount = yearData?.count ?? 0;
        const hasYearData = (episodeCount > 0) || (relevanceSec > 0);

        if (hasYearData && yearData) {
          tooltipRef.value.style.display = 'block';
          tooltipRef.value.style.left = `${event.pageX + 15}px`;
          tooltipRef.value.style.top = `${event.pageY - 10}px`;
          
          tooltipRef.value.innerHTML = `
            <div class="font-semibold text-sm mb-1">${topic.name}</div>
            <div class="text-xs"><strong>Jahr:</strong> ${year}</div>
            <div class="text-xs"><strong>Episoden:</strong> ${episodeCount}</div>
            <div class="text-xs"><strong>Dauer:</strong> ${formatTimespanSec(relevanceSec)}</div>
          `;
          
          // Highlight the year on X-axis
          if (svgRef.value) {
            select(svgRef.value)
              .selectAll('.x-axis text')
              .attr('fill', (tickYear: any) => tickYear === year ? '#2563eb' : '#666')
              .attr('font-weight', (tickYear: any) => tickYear === year ? '700' : '400')
              .style('font-size', (tickYear: any) => tickYear === year ? '14px' : '12px');
          }
        } else {
          tooltipRef.value.style.display = 'none';
          // Reset X-axis highlighting
          if (svgRef.value) {
            select(svgRef.value)
              .selectAll('.x-axis text')
              .attr('fill', '#666')
              .attr('font-weight', '400')
              .style('font-size', '12px');
          }
        }
      }
    })
    .on('mouseout', function(_event: any, d: any) {
      // Only clear if we're leaving the current hovered item
      if (hoveredTopic.value === d.key) {
        hoveredTopic.value = null;
      }
      hoveredYear.value = null;
      yearHighlight.style('display', 'none');
      yearHighlightLeft.style('display', 'none');
      yearHighlightRight.style('display', 'none');
      if (tooltipRef.value) {
        tooltipRef.value.style.display = 'none';
      }
      // Reset X-axis highlighting (unless a year is selected)
      if (svgRef.value && !selectedYear.value) {
        select(svgRef.value)
          .selectAll('.x-axis text')
          .attr('fill', '#666')
          .attr('font-weight', '400')
          .style('font-size', '12px');
      }
    })
    .on('click', function(_event: any, d: any) {
      const isSameTopic = selectedTopic.value === d.key;
      
      if (isSameTopic) {
        // Same topic clicked
        if (hoveredYear.value !== null && hoveredYear.value !== selectedYear.value) {
          // Different year: keep topic selected, update year
          selectedYear.value = hoveredYear.value;
        } else {
          // Same year or no hovered year: deselect topic
          selectedTopic.value = null;
          selectedYear.value = null;
        }
      } else {
        // Different topic clicked: select topic and year
        selectedTopic.value = d.key;
        if (hoveredYear.value !== null) {
          selectedYear.value = hoveredYear.value;
        } else {
          selectedYear.value = null;
        }
      }
    });
  
  // X-Achse
  const xAxis = axisBottom(xScale)
    .tickFormat(format('d'))
    .ticks(years.length);
  
  const xAxisGroup = g.append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(xAxis);
  
  xAxisGroup.selectAll('text')
    .attr('fill', '#666')
    .style('font-size', '12px')
    .attr('data-year', (d: any) => d)
    .style('transition', 'all 0.2s ease');
  
  g.append('text')
    .attr('x', innerWidth / 2)
    .attr('y', innerHeight + 45)
    .attr('fill', '#333')
    .attr('text-anchor', 'middle')
    .style('font-size', isMobile ? '12px' : '14px')
    .style('font-weight', '600')
    .text('Jahr');
  
  // D3 Legend removed - now using HTML legend
  
  return streams; // Return streams for updating
};

// Function to update opacity without full redraw
const updateOpacity = () => {
  if (!svgRef.value) return;
  
  const svg = select(svgRef.value);
  
  // Update stream opacity
  svg.selectAll('.stream')
    .attr('opacity', function(d: any) {
      if (!hoveredTopic.value && !selectedTopic.value) return 0.8;
      if (hoveredTopic.value && d.key === hoveredTopic.value) return 1;
      if (selectedTopic.value && d.key === selectedTopic.value) return 1;
      return 0.2;
    });
};

// Watch für Änderungen
watch(() => topicFilterValue.value, () => {
  console.log('topicFilter changed to:', topicFilterValue.value);
  hoveredTopic.value = null; // Clear hover on filter change
  drawRiver();
});

watch(() => normalizedView.value, () => {
  console.log('normalizedView changed to:', normalizedView.value);
  hoveredTopic.value = null; // Clear hover on view change
  drawRiver();
});

// For hover/selection, just update opacity without redrawing
watch([hoveredTopic, selectedTopic], () => {
  updateOpacity();
});

// Initial draw und resize listener
onMounted(() => {
  drawRiver();
  
  const resizeObserver = new ResizeObserver(() => {
    drawRiver();
  });
  
  if (containerRef.value) {
    resizeObserver.observe(containerRef.value);
  }
});

// Berechnete Infos für ausgewähltes Topic
const selectedTopicInfo = computed(() => {
  if (!selectedTopic.value) return null;
  const topic = processedData.value.topics.find(t => t.id === selectedTopic.value);
  if (!topic) return null;
  
  const fullTopic = props.data.topics[topic.id];
  if (!fullTopic) return null;
  
  // Sammle alle Episoden aus allen Jahren
  const allEpisodes: Array<{
    number: number;
    date: string;
    title: string;
    year: number;
  }> = [];
  
  fullTopic.yearData.forEach(yd => {
    yd.episodes.forEach(ep => {
      allEpisodes.push({
        ...ep,
        year: yd.year
      });
    });
  });
  
  // Sortiere nach Episode-Nummer (neueste zuerst)
  allEpisodes.sort((a, b) => b.number - a.number);
  
  // Filtere nach ausgewähltem Jahr, falls vorhanden
  const filteredEpisodes = selectedYear.value 
    ? allEpisodes.filter(ep => ep.year === selectedYear.value)
    : allEpisodes;
  
  return {
    ...topic,
    description: fullTopic.description,
    episodes: filteredEpisodes,
    totalEpisodes: allEpisodes.length,
    filteredCount: filteredEpisodes.length
  };
});

const showEpisodeList = ref(true);
const showTopicList = ref(false);
const episodeDetails = ref<Map<number, any>>(new Map());
const episodeTopics = ref<Map<number, any>>(new Map());
const taxonomyData = ref<any>(null);
const loadingEpisodes = ref(false);
const loadingTopics = ref(false);

// Use lazy loading composable
const { setupLazyLoad } = useLazyEpisodeDetails();
const observerCleanups = ref<Map<number, () => void>>(new Map());

// MP3 playback (uses /episodes.json generated from MP3 RSS feed)
const mp3IndexLoaded = ref(false);
const mp3IndexError = ref<string | null>(null);
const mp3UrlByEpisode = ref<Map<number, string>>(new Map());
const mp3MetaByEpisode = ref<
  Map<
    number,
    { url: string | null; durationSec: number | null; title?: string; date?: string; speakers?: string[] }
  >
>(new Map());

// When switching podcasts, clear the cached MP3 index so we don't reuse URLs
// from a previously selected podcast (e.g. LNP playing Freakshow).
watch(
  () => settingsStore.selectedPodcast,
  () => {
    mp3IndexLoaded.value = false;
    mp3IndexError.value = null;
    mp3UrlByEpisode.value = new Map();
    mp3MetaByEpisode.value = new Map();
  }
);

// Note: withBase is now imported from usePodcast and handles absolute URLs correctly

const parseHmsToSeconds = (hms: unknown): number | null => {
  const s = typeof hms === 'string' ? hms.trim() : '';
  if (!s) return null;
  const parts = s.split(':').map(p => p.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map(p => parseInt(p, 10));
  if (nums.some(n => !Number.isFinite(n))) return null;
  if (nums.length === 2) {
    const [m, sec] = nums;
    return (m ?? 0) * 60 + (sec ?? 0);
  }
  const [h, m, sec] = nums;
  return (h ?? 0) * 3600 + (m ?? 0) * 60 + (sec ?? 0);
};

const secondsToHmsTuple = (sec: unknown): [number, number, number] => {
  const s0 = Number.isFinite(sec as number) ? Math.max(0, Math.floor(sec as number)) : 0;
  const h = Math.floor(s0 / 3600);
  const m = Math.floor((s0 % 3600) / 60);
  const s = s0 % 60;
  return [h, m, s];
};

// Setup lazy loading for episode rows with fallback to MP3 metadata
async function setupLazyLoadingForEpisodes(episodeNumbers: number[]) {
  // Clean up existing observers
  observerCleanups.value.forEach(cleanup => cleanup());
  observerCleanups.value.clear();

  // Ensure MP3 index is available for fallback
  await ensureMp3Index();

  // Prime ALL rows immediately with episodes.json metadata so table cells don't stay blank
  for (const episodeNum of episodeNumbers) {
    const existing = episodeDetails.value.get(episodeNum);
    const meta = mp3MetaByEpisode.value.get(episodeNum) || null;
    const episodeInfo = selectedTopicInfo.value?.episodes?.find((e: any) => e?.number === episodeNum);
    
    // If episode already exists, ALWAYS update speakers from episodes.json
    if (existing) {
      // ALWAYS update speakers from episodes.json if available
      if (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0) {
        episodeDetails.value.set(episodeNum, {
          ...existing,
          speakers: meta.speakers,
        });
        // Continue to ensure episodes.json data is set even if we have full details
      }
      
      // If we have full details (no fallback), skip priming (but speakers were already updated above)
      if (!(existing as any)?._fallback) {
        continue;
      }
    }
    
    // Prime with episodes.json metadata
    if (meta?.url || Number.isFinite(meta?.durationSec as number) || (Array.isArray(meta?.speakers) && meta.speakers.length > 0)) {
      episodeDetails.value.set(episodeNum, {
        title: episodeInfo?.title || meta?.title || `Episode ${episodeNum}`,
        date: episodeInfo?.date || meta?.date || '',
        url: meta?.url || null,
        duration: secondsToHmsTuple(meta?.durationSec),
        speakers: meta?.speakers || [],
        chapters: [],
        _fallback: 'episodes.json',
      });
    } else {
      episodeDetails.value.set(episodeNum, {
        title: episodeInfo?.title || meta?.title || `Episode ${episodeNum}`,
        date: episodeInfo?.date || meta?.date || '',
        url: null,
        duration: [0, 0, 0],
        speakers: meta?.speakers || [],
        chapters: [],
        _fallback: 'minimal',
      });
    }
  }

  // Preload first few visible episodes immediately
  // Always use episodes.json as primary source, only load individual files for additional details (chapters)
  const visibleCount = Math.min(5, episodeNumbers.length);
  if (visibleCount > 0) {
    const visibleEpisodes = episodeNumbers.slice(0, visibleCount);
    await Promise.all(visibleEpisodes.map(async (episodeNum) => {
      const currentDetail = episodeDetails.value.get(episodeNum);
      const meta = mp3MetaByEpisode.value.get(episodeNum) || null;
      const episodeInfo = selectedTopicInfo.value?.episodes?.find((e: any) => e?.number === episodeNum);
      
      // Always ensure we have episodes.json data first
      if (!currentDetail || (currentDetail as any)?._fallback) {
        if (meta && (meta.url || Number.isFinite(meta.durationSec as number) || Array.isArray(meta.speakers))) {
          episodeDetails.value.set(episodeNum, {
            title: episodeInfo?.title || meta.title || `Episode ${episodeNum}`,
            date: episodeInfo?.date || meta.date || '',
            url: meta.url || null,
            duration: secondsToHmsTuple(meta.durationSec),
            speakers: Array.isArray(meta.speakers) ? meta.speakers : [],
            chapters: [],
            _fallback: 'episodes.json',
          });
        }
      }
      
      // Try to load individual episode file for additional details (chapters, etc.)
      // But merge with episodes.json data (keep speakers from episodes.json if episode file doesn't have them)
      try {
        const cached = getCachedEpisodeDetail(episodeNum);
        if (cached !== undefined && cached !== null) {
          // ALWAYS merge cached data with episodes.json data - prefer episodes.json for speakers
          const merged = {
            ...cached,
            // ALWAYS prefer speakers from episodes.json if available
            speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
              ? meta.speakers
              : (Array.isArray(cached.speakers) && cached.speakers.length > 0 ? cached.speakers : []),
            // Keep title/date from episodes.json if they're better
            title: cached.title || (episodeInfo?.title || meta?.title || `Episode ${episodeNum}`),
            date: cached.date || (episodeInfo?.date || meta?.date || ''),
          };
          episodeDetails.value.set(episodeNum, merged);
          return;
        }
        
        const detail = await loadEpisodeDetail(episodeNum);
        if (detail) {
          // Merge with episodes.json data - ALWAYS prefer episodes.json for speakers
          const merged = {
            ...detail,
            // ALWAYS prefer speakers from episodes.json if available
            speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
              ? meta.speakers
              : (Array.isArray(detail.speakers) && detail.speakers.length > 0 ? detail.speakers : []),
            // Keep title/date from episodes.json if they're better
            title: detail.title || (episodeInfo?.title || meta?.title || `Episode ${episodeNum}`),
            date: detail.date || (episodeInfo?.date || meta?.date || ''),
          };
          episodeDetails.value.set(episodeNum, merged);
        } else {
          // If loading failed, ensure we have episodes.json data
          if (!currentDetail || (currentDetail as any)?._fallback) {
            if (meta && (meta.url || Number.isFinite(meta.durationSec as number) || Array.isArray(meta.speakers))) {
              episodeDetails.value.set(episodeNum, {
                title: episodeInfo?.title || meta.title || `Episode ${episodeNum}`,
                date: episodeInfo?.date || meta.date || '',
                url: meta.url || null,
                duration: secondsToHmsTuple(meta.durationSec),
                speakers: Array.isArray(meta.speakers) ? meta.speakers : [],
                chapters: [],
                _fallback: 'episodes.json',
              });
            }
          }
        }
      } catch (e) {
        console.error(`Failed to load episode ${episodeNum}:`, e);
        // Keep episodes.json data on errors
      }
    }));
  }

  // Setup lazy loading for remaining episodes
  await nextTick();
  episodeNumbers.forEach(episodeNum => {
    // Skip if we already have full details or a hard "missing" marker.
    const existing = episodeDetails.value.get(episodeNum);
    if (existing === null) return;
    if (existing && typeof existing === 'object' && !existing._fallback) return;

    // Find the row element and setup observer
    const rowElement = document.querySelector(`[data-episode-row="${episodeNum}"]`) as HTMLElement;
    if (rowElement) {
      const cleanup = setupLazyLoad(
        rowElement,
        episodeNum,
        async (detail) => {
          const meta = mp3MetaByEpisode.value.get(episodeNum) || null;
          const episodeInfo = selectedTopicInfo.value?.episodes?.find((e: any) => e?.number === episodeNum);
          
          if (detail) {
            // Merge with episodes.json data - ALWAYS prefer episodes.json for speakers
            const merged = {
              ...detail,
              // ALWAYS prefer speakers from episodes.json if available
              speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
                ? meta.speakers
                : (Array.isArray(detail.speakers) && detail.speakers.length > 0 ? detail.speakers : []),
              // Keep title/date from episodes.json if they're better
              title: detail.title || (episodeInfo?.title || meta?.title || `Episode ${episodeNum}`),
              date: detail.date || (episodeInfo?.date || meta?.date || ''),
            };
            episodeDetails.value.set(episodeNum, merged);
          } else {
            // Always use episodes.json data as fallback
            if (meta && (meta.url || Number.isFinite(meta.durationSec as number) || Array.isArray(meta.speakers))) {
              episodeDetails.value.set(episodeNum, {
                title: episodeInfo?.title || meta.title || `Episode ${episodeNum}`,
                date: episodeInfo?.date || meta.date || '',
                url: meta.url || null,
                duration: secondsToHmsTuple(meta.durationSec),
                speakers: Array.isArray(meta.speakers) ? meta.speakers : [],
                chapters: [],
                _fallback: 'episodes.json',
              });
            } else {
              // Keep fallback/minimal data if we have it; otherwise mark missing
              const cur = episodeDetails.value.get(episodeNum);
              if (!cur || cur === null) episodeDetails.value.set(episodeNum, null);
            }
          }
        }
      );
      observerCleanups.value.set(episodeNum, cleanup);
    } else {
      // Element not found, load immediately
      loadEpisodeDetail(episodeNum).then(detail => {
        const meta = mp3MetaByEpisode.value.get(episodeNum) || null;
        const episodeInfo = selectedTopicInfo.value?.episodes?.find((e: any) => e?.number === episodeNum);
        
        if (detail) {
          // Merge with episodes.json data - ALWAYS prefer episodes.json for speakers
          const merged = {
            ...detail,
            // ALWAYS prefer speakers from episodes.json if available
            speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
              ? meta.speakers
              : (Array.isArray(detail.speakers) && detail.speakers.length > 0 ? detail.speakers : []),
            // Keep title/date from episodes.json if they're better
            title: detail.title || (episodeInfo?.title || meta?.title || `Episode ${episodeNum}`),
            date: detail.date || (episodeInfo?.date || meta?.date || ''),
          };
          episodeDetails.value.set(episodeNum, merged);
        } else {
          // Always use episodes.json data as fallback
          if (meta && (meta.url || Number.isFinite(meta.durationSec as number) || Array.isArray(meta.speakers))) {
            episodeDetails.value.set(episodeNum, {
              title: episodeInfo?.title || meta.title || `Episode ${episodeNum}`,
              date: episodeInfo?.date || meta.date || '',
              url: meta.url || null,
              duration: secondsToHmsTuple(meta.durationSec),
              speakers: Array.isArray(meta.speakers) ? meta.speakers : [],
              chapters: [],
              _fallback: 'episodes.json',
            });
          } else {
            const cur = episodeDetails.value.get(episodeNum);
            if (!cur || cur === null) episodeDetails.value.set(episodeNum, null);
          }
        }
      });
    }
  });

  // SpeakerRiver-style: batch-load ALL remaining episodes in the background (no scrolling required)
  await nextTick();
  await nextTick();
  await new Promise(resolve => requestAnimationFrame(resolve));
  const toLoad = episodeNumbers.filter(episodeNum => {
    const cached = getCachedEpisodeDetail(episodeNum);
    if (cached !== undefined) return false;
    const cur: any = episodeDetails.value.get(episodeNum);
    return !cur || cur === null || Boolean(cur._fallback);
  });

  if (toLoad.length > 0) {
    const batchSize = 10;
    for (let i = 0; i < toLoad.length; i += batchSize) {
      const batch = toLoad.slice(i, i + batchSize);
      await Promise.all(batch.map(async (episodeNum) => {
        const cached = getCachedEpisodeDetail(episodeNum);
        if (cached !== undefined) {
          // ALWAYS merge cached data with episodes.json - prefer episodes.json for speakers
          const meta = mp3MetaByEpisode.value.get(episodeNum) || null;
          const episodeInfo = selectedTopicInfo.value?.episodes?.find((e: any) => e?.number === episodeNum);
          if (cached !== null) {
            const merged = {
              ...cached,
              // ALWAYS prefer speakers from episodes.json if available
              speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
                ? meta.speakers
                : (Array.isArray(cached.speakers) && cached.speakers.length > 0 ? cached.speakers : []),
              // Keep title/date from episodes.json if they're better
              title: cached.title || (episodeInfo?.title || meta?.title || `Episode ${episodeNum}`),
              date: cached.date || (episodeInfo?.date || meta?.date || ''),
            };
            episodeDetails.value.set(episodeNum, merged);
          } else {
            episodeDetails.value.set(episodeNum, cached);
          }
          return;
        }
        const detail = await loadEpisodeDetail(episodeNum);
        if (detail) {
          // ALWAYS merge detail with episodes.json - prefer episodes.json for speakers
          const meta = mp3MetaByEpisode.value.get(episodeNum) || null;
          const episodeInfo = selectedTopicInfo.value?.episodes?.find((e: any) => e?.number === episodeNum);
          const merged = {
            ...detail,
            // ALWAYS prefer speakers from episodes.json if available
            speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
              ? meta.speakers
              : (Array.isArray(detail.speakers) && detail.speakers.length > 0 ? detail.speakers : []),
            // Keep title/date from episodes.json if they're better
            title: detail.title || (episodeInfo?.title || meta?.title || `Episode ${episodeNum}`),
            date: detail.date || (episodeInfo?.date || meta?.date || ''),
          };
          episodeDetails.value.set(episodeNum, merged);
        }
      }));
    }
  }
  
  loadingEpisodes.value = false;
}

// Lade Episode-Details für Topics (für Speaker-Informationen) mit lazy loading
const loadEpisodeDetails = async () => {
  if (!selectedTopicInfo.value || loadingEpisodes.value) return;
  
  loadingEpisodes.value = true;
  const episodeNumbers = selectedTopicInfo.value.episodes.map(ep => ep.number);
  await setupLazyLoadingForEpisodes(episodeNumbers);
};

// Lade alle einzelnen Topics aus den Episode-Topics
const loadAllTopics = async () => {
  if (!selectedTopicInfo.value || loadingTopics.value) return;
  
  loadingTopics.value = true;
  
  // Versuche zuerst die detailed mapping zu laden
  if (!taxonomyData.value) {
    try {
      const url = getPodcastFileUrl('topic-taxonomy-detailed.json');
      const response = await fetch(url);
      if (response.ok) {
        taxonomyData.value = await response.json();
        if (taxonomyData.value.clusters) {
          const matchingCluster = taxonomyData.value.clusters.find((c: any) => c.id === selectedTopicInfo.value?.id);
          
          // If cluster found in taxonomy with topics, we can return early
          // Otherwise, fall through to load episode topics
          if (matchingCluster && matchingCluster.topics && matchingCluster.topics.length > 0) {
            loadingTopics.value = false;
            return;
          }
        }
      }
    } catch (e) {
      // Fall through to load episode topics
    }
  } else {
    // Taxonomy already loaded, check if cluster exists
    if (taxonomyData.value.clusters) {
      const matchingCluster = taxonomyData.value.clusters.find((c: any) => c.id === selectedTopicInfo.value?.id);
      if (matchingCluster && matchingCluster.topics && matchingCluster.topics.length > 0) {
        loadingTopics.value = false;
        return;
      }
    }
  }
  
  // Fallback: Lade Episode-Topics wie bisher
  const newTopics = new Map<number, any>();
  const toLoad = selectedTopicInfo.value.episodes
    .map(ep => ep.number)
    .filter(num => !episodeTopics.value.has(num));
  
  for (const episodeNum of toLoad) {
    try {
      const response = await fetch(getPodcastFileUrl(`episodes/${episodeNum}-topics.json`));
      if (response.ok) {
        const data = await response.json();
        newTopics.set(episodeNum, data);
      }
    } catch (e) {
      console.error(`Failed to load topics for episode ${episodeNum}:`, e);
    }
  }
  
  episodeTopics.value = new Map([...episodeTopics.value, ...newTopics]);
  loadingTopics.value = false;
};

// Sammle alle individuellen Topics für das ausgewählte Cluster
const allIndividualTopics = computed(() => {
  if (!selectedTopicInfo.value) return [];
  
  // Wenn wir detailed taxonomy haben, verwende diese
  if (taxonomyData.value && taxonomyData.value.clusters) {
    const cluster = taxonomyData.value.clusters.find((c: any) => c.id === selectedTopicInfo.value?.id);
    if (cluster && cluster.topics) {
      return cluster.topics.map((t: any) => ({
        topic: t.topic,
        keywords: t.keywords || [],
        episodeNumber: 0, // Not episode-specific in detailed view
        episodeTitle: '',
        clusterName: cluster.name,
        clusterId: cluster.id
      }));
    }
  }
  
  // Fallback: Zeige alle Topics aus den Episoden (alte Methode)
  const topics: Array<{
    topic: string;
    keywords: string[];
    episodeNumber: number;
    episodeTitle: string;
    clusterName?: string;
    clusterId?: string;
  }> = [];
  
  const currentCluster = props.data.topics[selectedTopicInfo.value.id];
  if (!currentCluster) return [];
  
  selectedTopicInfo.value.episodes.forEach(episode => {
    const episodeTopicData = episodeTopics.value.get(episode.number);
    if (episodeTopicData && episodeTopicData.topics) {
      episodeTopicData.topics.forEach((t: any) => {
        topics.push({
          topic: t.topic,
          keywords: t.keywords || [],
          episodeNumber: episode.number,
          episodeTitle: episode.title,
          clusterName: currentCluster.name,
          clusterId: currentCluster.id
        });
      });
    }
  });
  
  return topics;
});

// Watch für showEpisodeList
watch(showEpisodeList, (newValue) => {
  if (newValue && selectedTopicInfo.value) {
    loadEpisodeDetails();
  }
});

// Cleanup observers on unmount
onUnmounted(() => {
  observerCleanups.value.forEach(cleanup => cleanup());
  observerCleanups.value.clear();
});

// When switching podcasts, clear observers
watch(
  () => settingsStore.selectedPodcast,
  () => {
    observerCleanups.value.forEach(cleanup => cleanup());
    observerCleanups.value.clear();
    episodeDetails.value = new Map();
  }
);

// Watch für selectedYear - lade zusätzliche Episoden wenn Filter entfernt wird
watch(selectedYear, () => {
  if (showEpisodeList.value && selectedTopicInfo.value) {
    loadEpisodeDetails();
  }
});

// Watch für showTopicList
watch(showTopicList, (newValue) => {
  if (newValue && selectedTopicInfo.value) {
    loadAllTopics();
  }
});

// Helper function to format duration
const formatDuration = (duration: string | [number, number, number] | undefined): string => {
  if (!duration) return 'N/A';
  if (typeof duration === 'string') return duration;
  if (!Array.isArray(duration) || duration.length !== 3) return 'N/A';
  const [hours, minutes, seconds] = duration;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const fullTopicById = (id: string) => {
  return props.data.topics[id];
};

const formatHmsFromSeconds = (sec: unknown) => {
  const s0 = Number.isFinite(sec as number) ? Math.max(0, Math.floor(sec as number)) : null;
  if (s0 === null) return '—';
  const hours = Math.floor(s0 / 3600);
  const minutes = Math.floor((s0 % 3600) / 60);
  const seconds = s0 % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const getTopicOccurrences = (episode: any): Array<{ positionSec: number; durationSec: number | null }> => {
  const occ = Array.isArray(episode?.occurrences) ? episode.occurrences : [];
  const items: Array<{ positionSec: number; durationSec: number | null }> = occ
    .map((o: any) => ({
      positionSec: Number.isFinite(o?.positionSec) ? o.positionSec : null,
      durationSec: Number.isFinite(o?.durationSec) ? o.durationSec : null,
    }))
    .filter((x: any): x is { positionSec: number; durationSec: number | null } => Number.isFinite(x?.positionSec));

  if (items.length === 0) return [];

  // sort + de-dupe
  items.sort((a, b) => a.positionSec - b.positionSec);
  const unique: Array<{ positionSec: number; durationSec: number | null }> = [];
  for (const it of items) {
    const last = unique[unique.length - 1];
    if (!last || last.positionSec !== it.positionSec || last.durationSec !== it.durationSec) unique.push(it);
  }
  return unique;
};

const formatOccurrenceLabel = (occ: { positionSec: number; durationSec: number | null }) => {
  const formatMinutes = (sec: number | null) => {
    if (!Number.isFinite(sec as number) || (sec as number) <= 0) return null;
    const m = Math.max(1, Math.round((sec as number) / 60));
    return `${m}m`;
  };
  const m = formatMinutes(occ.durationSec);
  return m ? `${formatHmsFromSeconds(occ.positionSec)} (${m})` : formatHmsFromSeconds(occ.positionSec);
};

const buildEpisodeDeepLink = (episodeUrl: string, seconds: number) => {
  try {
    const u = new URL(episodeUrl);
    // best-effort: some players support `?t=SECONDS` or `#t=SECONDS`; autoplay can be blocked by browser policies.
    u.searchParams.set('t', String(Math.max(0, Math.floor(seconds))));
    u.searchParams.set('autoplay', '1');
    u.hash = `t=${Math.max(0, Math.floor(seconds))}`;
    return u.toString();
  } catch {
    return episodeUrl;
  }
};

const openEpisodeAt = (episodeNumber: number, seconds: number) => {
  const details = episodeDetails.value.get(episodeNumber);
  const url = typeof details?.url === 'string' ? details.url : null;
  if (!url) return;
  const link = buildEpisodeDeepLink(url, seconds);
  window.open(link, '_blank', 'noopener,noreferrer');
};

const ensureMp3Index = async () => {
  if (mp3IndexLoaded.value || mp3IndexError.value) return;
  try {
    // In dev mode, always reload to get latest data; in production, use cache
    const res = await fetch(getPodcastFileUrl('episodes.json'), { 
      cache: import.meta.env.DEV ? 'no-cache' : 'force-cache' 
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const map = new Map<number, string>();
    const metaMap = new Map<number, { url: string | null; durationSec: number | null; title?: string; date?: string; speakers?: string[] }>();
    if (data?.byNumber && typeof data.byNumber === 'object') {
      for (const [k, v] of Object.entries<any>(data.byNumber)) {
        const n = parseInt(k, 10);
        const url = typeof v?.mp3Url === 'string' ? v.mp3Url : null;
        if (Number.isFinite(n) && url) map.set(n, url);
        if (Number.isFinite(n)) {
          const pageUrl = typeof v?.pageUrl === 'string' ? v.pageUrl : null;
          const durSec = Number.isFinite(v?.durationSec) ? v.durationSec : parseHmsToSeconds(v?.duration);
          const title = typeof v?.title === 'string' ? v.title : undefined;
          const date = typeof v?.date === 'string' ? v.date : (typeof v?.pubDate === 'string' ? v.pubDate : undefined);
          const speakers = Array.isArray(v?.speakers) ? v.speakers.filter((s: any) => typeof s === 'string') : undefined;
          metaMap.set(n, {
            url: pageUrl,
            durationSec: Number.isFinite(durSec as number) ? (durSec as number) : null,
            title,
            date,
            speakers,
          });
        }
      }
    } else if (Array.isArray(data?.episodes)) {
      for (const ep of data.episodes) {
        const n = Number.isFinite(ep?.number) ? ep.number : null;
        const url = typeof ep?.mp3Url === 'string' ? ep.mp3Url : null;
        if (Number.isFinite(n) && url) map.set(n, url);
        if (Number.isFinite(n)) {
          const pageUrl = typeof ep?.pageUrl === 'string' ? ep.pageUrl : null;
          const durSec = Number.isFinite(ep?.durationSec) ? ep.durationSec : parseHmsToSeconds(ep?.duration);
          const title = typeof ep?.title === 'string' ? ep.title : undefined;
          const date = typeof ep?.date === 'string' ? ep.date : (typeof ep?.pubDate === 'string' ? ep.pubDate : undefined);
          const speakers = Array.isArray(ep?.speakers) ? ep.speakers.filter((s: any) => typeof s === 'string') : undefined;
          metaMap.set(n as number, {
            url: pageUrl,
            durationSec: Number.isFinite(durSec as number) ? (durSec as number) : null,
            title,
            date,
            speakers,
          });
        }
      }
    }

    mp3UrlByEpisode.value = map;
    mp3MetaByEpisode.value = metaMap;
    mp3IndexLoaded.value = true;
  } catch (e) {
    mp3IndexError.value = e instanceof Error ? e.message : String(e);
  }
};

const playEpisodeAt = async (episodeNumber: number, seconds: number, label: string) => {
  await ensureMp3Index();

  const mp3 = mp3UrlByEpisode.value.get(episodeNumber) || null;
  if (!mp3) {
    const errorMsg = mp3IndexError.value
      ? `MP3 Index nicht verfügbar (${mp3IndexError.value})`
      : 'Keine MP3-URL für diese Episode gefunden (episodes.json)';
    audioPlayerStore.setError(errorMsg);
    // Fallback: open episode page (if we have it)
    openEpisodeAt(episodeNumber, seconds);
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

// Expose methods and state for parent component
defineExpose({
  selectedTopic,
  selectedYear,
  setSelectedTopic: (topic: string | null) => {
    selectedTopic.value = topic;
  },
  setSelectedYear: (year: number | null) => {
    selectedYear.value = year;
  },
  selectedTopicInfo,
  showEpisodeList,
  showTopicList,
  setShowEpisodeList: (value: boolean) => {
    showEpisodeList.value = value;
  },
  setShowTopicList: (value: boolean) => {
    showTopicList.value = value;
  },
  episodeDetails,
  loadingEpisodes,
  loadingTopics,
  allIndividualTopics,
  episodeTopics,
  getTopicOccurrences,
  formatOccurrenceLabel,
  formatHmsFromSeconds,
  formatDuration,
  playEpisodeAt,
  loadAllTopics
});
</script>

<template>
  <div class="topic-river-container">
    <!-- Tooltip -->
    <div 
      ref="tooltipRef" 
      class="tooltip"
      style="display: none; position: absolute; background: rgba(0, 0, 0, 0.9); color: white; padding: 8px 12px; border-radius: 6px; pointer-events: none; z-index: 1000; font-size: 13px; box-shadow: 0 4px 6px rgba(0,0,0,0.3);"
    ></div>
    
    <div class="flex flex-col lg:flex-row gap-4">
      <!-- River Chart -->
      <div ref="containerRef" class="flex-1 w-full overflow-x-auto -mx-2 sm:mx-0">
        <svg ref="svgRef" class="topic-river-svg"></svg>
      </div>
      
      <!-- HTML Legend (Desktop only) -->
      <div class="hidden lg:block w-64 flex-shrink-0">
        <div class="sticky top-4 max-h-[600px] overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-4">
          <h3 class="text-sm font-semibold mb-3 text-gray-900 dark:text-white">Themen</h3>
          <input
            v-model="legendSearchQuery"
            type="text"
            placeholder="Suche…"
            class="w-full mb-3 px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100"
          />
          <div class="space-y-2">
            <div 
              v-for="topic in filteredLegendTopics" 
              :key="topic.id"
              @mouseenter="hoveredTopic = topic.id; startPulse(topic.id)"
              @mouseleave="hoveredTopic = null; stopPulse()"
              @click="selectedTopic = selectedTopic === topic.id ? null : topic.id"
              class="flex items-start gap-2 p-2 rounded cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700"
              :class="{
                'bg-gray-100 dark:bg-gray-700': hoveredTopic === topic.id || selectedTopic === topic.id,
                'opacity-40': (hoveredTopic || selectedTopic) && hoveredTopic !== topic.id && selectedTopic !== topic.id
              }"
            >
              <div 
                class="w-4 h-4 rounded flex-shrink-0 mt-0.5" 
                :style="{ backgroundColor: topic.color }"
              ></div>
              <div class="flex-1 min-w-0">
                <div 
                  class="text-xs leading-tight text-gray-900 dark:text-white"
                  :class="{
                    'font-semibold': hoveredTopic === topic.id || selectedTopic === topic.id
                  }"
                  :title="`${topic.name} (${fullTopicById(topic.id)?.totalEpisodes ?? 0} Ep., ${formatTimespanSec(fullTopicById(topic.id)?.totalRelevanceSec ?? 0)})`"
                >
                  {{ topic.name }}
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  {{ fullTopicById(topic.id)?.totalEpisodes ?? 0 }} Ep. • {{ formatTimespanSec(fullTopicById(topic.id)?.totalRelevanceSec ?? 0) }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-4 sm:mt-6 text-xs sm:text-sm text-gray-600 dark:text-gray-400">
      <p>
        <strong>Interaktion:</strong> Bewege die Maus über einen Stream oder ein Thema in der Legende, um es hervorzuheben. 
        Klicke, um Details anzuzeigen.
      </p>
    </div>
  </div>
</template>

<style scoped>
.topic-river-container {
  padding: 1rem;
}

.topic-river-svg {
  display: block;
  font-family: system-ui, -apple-system, sans-serif;
}

input[type="range"] {
  accent-color: #3b82f6;
}
</style>

