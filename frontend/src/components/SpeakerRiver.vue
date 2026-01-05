<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick, onUnmounted } from 'vue';
import {
  select,
  scaleLinear,
  axisBottom,
  format,
  extent,
  area,
  curveBasis,
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
import type { SpeakerRiverData, ProcessedSpeakerData } from '../types';
import { useSettingsStore } from '../stores/settings';
import { useAudioPlayerStore } from '../stores/audioPlayer';
import { getPodcastFileUrl, getEpisodeUrl, getSpeakersBaseUrl, withBase } from '@/composables/usePodcast';
import { loadEpisodeDetail, getCachedEpisodeDetail } from '@/composables/useEpisodeDetails';
import { useSpeakerMeta } from '@/composables/useSpeakerMeta';

const props = defineProps<{
  data: SpeakerRiverData;
  normalizedView?: boolean;
  speakerFilter?: number;
}>();

const emit = defineEmits<{
  (e: 'update:normalizedView', value: boolean): void;
  (e: 'update:speakerFilter', value: number): void;
}>();

const svgRef = ref<SVGSVGElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);
const selectedSpeaker = ref<string | null>(null);
const hoveredSpeaker = ref<string | null>(null);
const legendSearchQuery = ref('');

// Use props if provided, otherwise fall back to defaults/localStorage
const getNormalizedViewPreference = (): boolean => {
  try {
    const saved = localStorage.getItem('speakerRiver.normalizedView');
    return saved === 'true';
  } catch {
    return false;
  }
};
const normalizedView = computed({
  get: () => props.normalizedView !== undefined ? props.normalizedView : getNormalizedViewPreference(),
  set: (value: boolean) => {
    if (props.normalizedView !== undefined) {
      emit('update:normalizedView', value);
    } else {
      try {
        localStorage.setItem('speakerRiver.normalizedView', String(value));
      } catch {}
    }
  }
});
const speakerFilter = computed({
  get: () => props.speakerFilter !== undefined ? props.speakerFilter : 30,
  set: (value: number) => {
    if (props.speakerFilter !== undefined) {
      emit('update:speakerFilter', value);
    }
  }
});
const dimensions = ref({ width: 1200, height: 600 });
const selectedYear = ref<number | null>(null);
const tooltipData = ref<{ speakerName: string; speakerImage?: string; year: number; x: number; y: number } | null>(null);
// @ts-expect-error - tooltipRef is used in template but TypeScript doesn't recognize template refs
const tooltipRef = ref<HTMLDivElement | null>(null);

// Audio player setup
const settings = useSettingsStore();
const audioPlayerStore = useAudioPlayerStore();

// Use speaker meta composable (uses index-meta.json to reduce 404 requests)
const { loadSpeakers, getSpeakerImage } = useSpeakerMeta();

// MP3 index loading
const mp3IndexLoaded = ref(false);
const mp3IndexError = ref<string | null>(null);
const mp3UrlByEpisode = ref<Map<number, string>>(new Map());
const mp3MetaByEpisode = ref<Map<number, { url: string | null; durationSec: number | null; title?: string; date?: string; speakers?: string[] }>>(new Map());

// Helper function to convert seconds to [hours, minutes, seconds] tuple
const secondsToHmsTuple = (sec: unknown): [number, number, number] => {
  const s = typeof sec === 'number' && Number.isFinite(sec) ? Math.floor(sec) : 0;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return [hours, minutes, seconds];
};

// Prozessiere die Daten
const processedData = computed(() => {
  const speakers: ProcessedSpeakerData[] = [];
  const years = props.data.statistics.years;
  
  console.log('Processing speaker data with speakerFilter:', speakerFilter.value);
  
  // Erstelle ein Array aller Speaker mit ihrer Episode-Anzahl
  const allSpeakers = props.data.speakers.map(speaker => ({
    id: speaker.id,
    name: speaker.name,
    episodeCount: speaker.totalEpisodes,
    data: speaker
  }));
  
  // Sortiere nach Episode-Anzahl und nimm die Top-N
  const topSpeakers = allSpeakers
    .sort((a, b) => b.episodeCount - a.episodeCount)
    .slice(0, speakerFilter.value);
  
  console.log('Top speakers count:', topSpeakers.length);
  
  // Erweiterte Farbpalette für mehr Speaker
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
  
  const colors = generateColors(topSpeakers.length);
  
  topSpeakers.forEach((speakerMeta, index) => {
    const speaker = speakerMeta.data;
    if (!speaker) return;
    
    const yearValues = new Map<number, number>();
    
    // Initialisiere alle Jahre mit 0
    years.forEach(year => yearValues.set(year, 0));
    
    // Setze die tatsächlichen Werte (Anzahl Episoden)
    if (speaker.timeline && Array.isArray(speaker.timeline)) {
      speaker.timeline.forEach(timelineEntry => {
        yearValues.set(timelineEntry.year, timelineEntry.episodeCount);
      });
    }
    
    speakers.push({
      id: speaker.id,
      name: speaker.name,
      yearValues,
      totalAppearances: speaker.totalEpisodes,
      color: colors[index] || '#888'
    });
  });
  
  return { speakers, years };
});

// Erstelle das Stream Graph (Speaker River)
const drawRiver = () => {
  if (!svgRef.value || !containerRef.value) return;
  
  const container = containerRef.value;
  const width = container.clientWidth;
  const height = dimensions.value.height;
  dimensions.value.width = width;
  
  const margin = { top: 20, right: 20, bottom: 60, left: 60 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  
  // Lösche vorherigen Inhalt
  stopPulse();
  select(svgRef.value).selectAll('*').remove();
  
  const svg = select(svgRef.value)
    .attr('width', width)
    .attr('height', height);
  
  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);
  
  const { speakers, years } = processedData.value;
  
  console.log('Drawing speaker river with', speakers.length, 'speakers');
  
  // Erstelle Stack-Daten
  const stackData: any[] = years.map(year => {
    const obj: any = { year };
    speakers.forEach(speaker => {
      obj[speaker.id] = speaker.yearValues.get(year) || 0;
    });
    return obj;
  });
  
  const keys = speakers.map(s => s.id);
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
    .curve(curveBasis);
  
  // Zeichne die Streams
  const streams = g.selectAll('.stream')
    .data(series)
    .join('path')
    .attr('class', 'stream')
    .attr('d', areaFn)
    .attr('fill', (d: any) => {
      const speaker = speakers.find(s => s.id === d.key);
      return speaker?.color || '#ccc';
    })
    .attr('opacity', (d: any) => {
      if (!hoveredSpeaker.value && !selectedSpeaker.value) return 0.8;
      if (hoveredSpeaker.value && d.key === hoveredSpeaker.value) return 1;
      if (selectedSpeaker.value && d.key === selectedSpeaker.value) return 1;
      return 0.2;
    })
    .style('cursor', 'pointer')
    .on('mouseover', function(event: any, d: any) {
      hoveredSpeaker.value = d.key;
      
      // Get year from mouse position
      const [mouseX] = pointer(event, g.node() as any);
      const year = Math.round(xScale.invert(mouseX));
      
      // Find speaker name
      const speaker = speakers.find(s => s.id === d.key);
      if (speaker) {
        const speakerImage = getSpeakerImage(speaker.name);
        tooltipData.value = {
          speakerName: speaker.name,
          speakerImage: speakerImage,
          year: year,
          x: event.clientX,
          y: event.clientY
        };
      }
    })
    .on('mousemove', function(event: any, _d: any) {
      // Update tooltip position
      if (tooltipData.value) {
        const [mouseX] = pointer(event, g.node() as any);
        const year = Math.round(xScale.invert(mouseX));
        tooltipData.value = {
          ...tooltipData.value,
          year: year,
          x: event.clientX,
          y: event.clientY
        };
      }
    })
    .on('mouseout', function(_event: any, d: any) {
      // Only clear if we're leaving the current hovered item
      if (hoveredSpeaker.value === d.key) {
        hoveredSpeaker.value = null;
        tooltipData.value = null;
      }
    })
    .on('click', function(event: any, d: any) {
      // Get year from click position
      const [mouseX] = pointer(event, g.node() as any);
      const year = Math.round(xScale.invert(mouseX));
      
      // Set selected speaker and year
      selectedSpeaker.value = selectedSpeaker.value === d.key ? null : d.key;
      if (selectedSpeaker.value) {
        selectedYear.value = year;
        showEpisodeList.value = true;
      } else {
        selectedYear.value = null;
        showEpisodeList.value = false;
      }
    });
  
  // X-Achse
  const xAxis = axisBottom(xScale)
    .tickFormat(format('d'))
    .ticks(years.length);
  
  g.append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(xAxis)
    .selectAll('text')
    .attr('fill', '#666')
    .style('font-size', '12px');
  
  g.append('text')
    .attr('x', innerWidth / 2)
    .attr('y', innerHeight + 45)
    .attr('fill', '#333')
    .attr('text-anchor', 'middle')
    .style('font-size', '14px')
    .style('font-weight', '600')
    .text('Jahr');
  
  return streams; // Return streams for updating
};

// Function to update opacity without full redraw
const updateOpacity = () => {
  if (!svgRef.value) return;
  
  const svg = select(svgRef.value);
  
  // Update stream opacity
  svg.selectAll('.stream')
    .attr('opacity', function(d: any) {
      if (!hoveredSpeaker.value && !selectedSpeaker.value) return 0.8;
      if (hoveredSpeaker.value && d.key === hoveredSpeaker.value) return 1;
      if (selectedSpeaker.value && d.key === selectedSpeaker.value) return 1;
      return 0.2;
    });
};

// Filtered legend speakers based on search query
const filteredLegendSpeakers = computed(() => {
  const query = legendSearchQuery.value.trim().toLowerCase();
  if (!query) return processedData.value.speakers;
  
  return processedData.value.speakers.filter(speaker => 
    speaker.name.toLowerCase().includes(query)
  );
});

// Pulse animation helpers (for consistency with TopicRiver)
let pulsingSpeakerKey: string | null = null;

const pulseOnce = (key: string) => {
  if (!svgRef.value || hoveredSpeaker.value !== key) return;

  const stroke = settings.isDarkMode ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.45)';
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
      if (pulsingSpeakerKey === key && hoveredSpeaker.value === key) pulseOnce(key);
      else {
        // Ensure cleanup if hover ended mid-loop.
        select(svgRef.value as any).selectAll('.stream').attr('stroke', 'none');
      }
    });
};

const startPulse = (key: string) => {
  pulsingSpeakerKey = key;
  pulseOnce(key);
};

const stopPulse = () => {
  pulsingSpeakerKey = null;
  if (!svgRef.value) return;
  // Stop any in-flight pulse transitions and remove the pulse stroke.
  select(svgRef.value)
    .selectAll<SVGPathElement, any>('.stream')
    .interrupt()
    .attr('stroke', 'none');
};

// Watch für Änderungen
watch(speakerFilter, () => {
  console.log('speakerFilter changed to:', speakerFilter.value);
  hoveredSpeaker.value = null; // Clear hover on filter change
  drawRiver();
});

watch(normalizedView, (newValue) => {
  console.log('normalizedView changed to:', newValue);
  // Persist normalized view preference to localStorage
  try {
    localStorage.setItem('speakerRiver.normalizedView', String(newValue));
  } catch (e) {
    console.warn('Failed to save normalizedView preference:', e);
  }
  hoveredSpeaker.value = null; // Clear hover on view change
  drawRiver();
});

// For hover/selection, just update opacity without redrawing
watch([hoveredSpeaker, selectedSpeaker], () => {
  updateOpacity();
});

// Helper function to format duration
const formatDuration = (duration: [number, number, number]) => {
  const [hours, minutes, seconds] = duration;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

// Initial draw und resize listener
onMounted(async () => {
  // Load speaker metadata first (uses index-meta.json to avoid 404s)
  if (props.data?.speakers) {
    const speakerNames = props.data.speakers.map(s => s.name);
    await loadSpeakers(speakerNames);
  }
  drawRiver();
  
  const resizeObserver = new ResizeObserver(() => {
    drawRiver();
  });
  
  if (containerRef.value) {
    resizeObserver.observe(containerRef.value);
  }
});

// Berechnete Infos für ausgewählten Speaker
const selectedSpeakerInfo = computed(() => {
  if (!selectedSpeaker.value) return null;
  const speaker = processedData.value.speakers.find(s => s.id === selectedSpeaker.value);
  if (!speaker) return null;
  
  const fullSpeaker = props.data.speakers.find(s => s.id === speaker.id);
  if (!fullSpeaker) {
    return {
      ...speaker,
      firstAppearance: null,
      lastAppearance: null,
      episodeNumbers: [],
      episodesByYear: [],
      totalEpisodes: 0,
      filteredCount: 0
    };
  }
  
  // Sammle alle Episoden mit Jahr-Informationen
  const episodesByYear: Array<{ number: number; year: number }> = [];
  fullSpeaker.timeline.forEach(tl => {
    tl.episodes.forEach(epNum => {
      episodesByYear.push({ number: epNum, year: tl.year });
    });
  });
  
  // Sortiere nach Nummer (neueste zuerst)
  episodesByYear.sort((a, b) => b.number - a.number);
  
  // Filtere nach ausgewähltem Jahr, falls vorhanden
  const filteredEpisodes = selectedYear.value 
    ? episodesByYear.filter(ep => ep.year === selectedYear.value)
    : episodesByYear;

  // Normalize + dedupe (defensive: avoids key mismatches in Maps/Sets)
  const episodeNumbers = Array.from(
    new Set(
      filteredEpisodes
        .map(ep => Number(ep.number))
        .filter(n => Number.isFinite(n))
    )
  ).sort((a, b) => b - a);
  
  return {
    ...speaker,
    firstAppearance: fullSpeaker.firstAppearance,
    lastAppearance: fullSpeaker.lastAppearance,
    episodeNumbers,
    episodesByYear,
    totalEpisodes: episodesByYear.length,
    filteredCount: filteredEpisodes.length
  };
});

const showEpisodeList = ref(true);
const episodeDetails = ref<Map<number, any>>(new Map());
const loadingEpisodes = ref(false);

// Observer cleanups for lazy loading (kept for cleanup purposes)
const observerCleanups = ref<Map<number, () => void>>(new Map());

// Prevent race conditions when switching speaker/year quickly.
// Each call to load the episode table increments this id; stale runs must not mutate state.
let episodeDetailsRequestId = 0;


// MP3 index loading function
const ensureMp3Index = async () => {
  if (mp3IndexLoaded.value || mp3IndexError.value) return;
  try {
    // In dev mode, always reload to get latest data; in production, use cache
    const res = await fetch(getPodcastFileUrl('episodes.json'), { 
      cache: import.meta.env.DEV ? 'no-cache' : 'force-cache' 
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const urlMap = new Map<number, string>();
    const metaMap = new Map<number, { url: string | null; durationSec: number | null; title?: string; date?: string; speakers?: string[] }>();
    
    if (data?.byNumber && typeof data.byNumber === 'object') {
      for (const [k, v] of Object.entries<any>(data.byNumber)) {
        const n = parseInt(k, 10);
        // Use mp3Url for playback, but keep pageUrl for table link
        const mp3Url = typeof v?.mp3Url === 'string' ? v.mp3Url : null;
        const url = typeof v?.pageUrl === 'string' ? v.pageUrl : null;
        const durationSec = typeof v?.durationSec === 'number' && Number.isFinite(v.durationSec) ? v.durationSec : null;
        const title = typeof v?.title === 'string' ? v.title : undefined;
        // Try 'date' first, then 'pubDate' as fallback
        const date = typeof v?.date === 'string' ? v.date : (typeof v?.pubDate === 'string' ? v.pubDate : undefined);
        const speakers = Array.isArray(v?.speakers) ? v.speakers.filter((s: any) => typeof s === 'string') : undefined;
        
        if (Number.isFinite(n)) {
          if (mp3Url) urlMap.set(n, mp3Url);
          metaMap.set(n, { url, durationSec, title, date, speakers });
        }
      }
    } else if (Array.isArray(data?.episodes)) {
      for (const ep of data.episodes) {
        const n = Number.isFinite(ep?.number) ? ep.number : null;
        // Use mp3Url for playback, but keep pageUrl for table link
        const mp3Url = typeof ep?.mp3Url === 'string' ? ep.mp3Url : null;
        const url = typeof ep?.pageUrl === 'string' ? ep.pageUrl : null;
        const durationSec = typeof ep?.durationSec === 'number' && Number.isFinite(ep.durationSec) ? ep.durationSec : null;
        const title = typeof ep?.title === 'string' ? ep.title : undefined;
        // Try 'date' first, then 'pubDate' as fallback
        const date = typeof ep?.date === 'string' ? ep.date : (typeof ep?.pubDate === 'string' ? ep.pubDate : undefined);
        const speakers = Array.isArray(ep?.speakers) ? ep.speakers.filter((s: any) => typeof s === 'string') : undefined;
        
        if (Number.isFinite(n)) {
          if (mp3Url) urlMap.set(n, mp3Url);
          metaMap.set(n, { url, durationSec, title, date, speakers });
        }
      }
    }

    mp3UrlByEpisode.value = urlMap;
    mp3MetaByEpisode.value = metaMap;
    mp3IndexLoaded.value = true;
  } catch (e) {
    mp3IndexError.value = e instanceof Error ? e.message : String(e);
  }
};

// Fallback function to open episode externally
const openEpisodeAt = async (episodeNumber: number, seconds: number) => {
  try {
    // In dev mode, always reload to get latest data; in production, use cache
    const res = await fetch(withBase(getEpisodeUrl(episodeNumber)), { 
      cache: import.meta.env.DEV ? 'no-cache' : 'force-cache' 
    });
    if (!res.ok) return;
    const details = await res.json();
    const url = typeof details?.url === 'string' ? details.url : null;
    if (!url) return;
    const u = new URL(url);
    u.searchParams.set('t', String(Math.max(0, Math.floor(seconds))));
    u.searchParams.set('autoplay', '1');
    u.hash = `t=${Math.max(0, Math.floor(seconds))}`;
    window.open(u.toString(), '_blank', 'noopener,noreferrer');
  } catch {
    // ignore
  }
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Setup loading for episode rows
async function setupLazyLoadingForEpisodes(episodeNumbers: number[], requestId: number) {
  const isStale = () => requestId !== episodeDetailsRequestId;
  if (isStale()) return;

  const loadEpisodeDetailWithRetry = async (episodeNum: number, attempts: number): Promise<any | null> => {
    for (let i = 0; i < attempts; i++) {
      if (isStale()) return null;
      const detail = await loadEpisodeDetail(episodeNum);
      if (isStale()) return null;
      if (detail) return detail;
      // small backoff for transient failures
      if (i < attempts - 1) await sleep(150 * (i + 1));
    }
    return null;
  };

  const loadEpisodeDetailNoStore = async (episodeNum: number): Promise<any | null> => {
    try {
      const res = await fetch(withBase(getEpisodeUrl(episodeNum)), { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data !== 'object') return null;
      return {
        ...data,
        title: data.title || '',
        date: data.date,
        duration: Array.isArray(data.duration) ? data.duration : data.duration,
        speakers: Array.isArray(data.speakers) ? data.speakers : [],
        url: data.url,
        number: data.number ?? episodeNum,
      };
    } catch {
      return null;
    }
  };

  // Clean up existing observers for episodes that are no longer in the list
  const currentEpisodeSet = new Set(episodeNumbers);
  observerCleanups.value.forEach((cleanup, episodeNum) => {
    if (!currentEpisodeSet.has(episodeNum)) {
      cleanup();
      observerCleanups.value.delete(episodeNum);
    }
  });

  // Ensure MP3 index is available FIRST before cleaning up
  // This ensures we have metadata available when initializing episodes
  await ensureMp3Index();
  if (isStale()) return;

  // Remove episode details that are no longer in the list
  // BUT keep fallback data (episodes.json or minimal) so we don't lose MP3 metadata
  episodeDetails.value.forEach((detail, episodeNum) => {
    if (!currentEpisodeSet.has(episodeNum)) {
      // Only delete if it's full details, keep fallback data
      if (detail && !detail._fallback) {
        episodeDetails.value.delete(episodeNum);
      }
      // If it's fallback data, keep it - it might be needed again
    }
  });
  if (isStale()) return;

  // STEP 1: Set initial data for ALL episodes immediately
  // This prevents them from showing "Lädt..." indefinitely
  // IMPORTANT: Always restore MP3 metadata if available, even if episode was deleted when switching speakers/years
  // Use for...of loop to ensure synchronous execution
  for (const episodeNum of episodeNumbers) {
    const existingDetail = episodeDetails.value.get(episodeNum);
    const meta = mp3MetaByEpisode.value.get(episodeNum);
    
    // ALWAYS ensure we have episodes.json data (speakers, title, date) - this is the primary source
    if (!existingDetail || existingDetail === null) {
      // No data at all - set from episodes.json
      if (meta && (meta.url || Number.isFinite(meta.durationSec as number) || meta.title || meta.date || (Array.isArray(meta.speakers) && meta.speakers.length > 0))) {
        episodeDetails.value.set(episodeNum, {
          title: meta.title || '',
          date: meta.date || '',
          url: meta.url || null,
          duration: secondsToHmsTuple(meta.durationSec),
          speakers: Array.isArray(meta.speakers) ? meta.speakers : [],
          chapters: [],
          _fallback: 'episodes.json',
        });
      } else {
        // Even if no metadata, set a minimal entry so we can show the episode number
        episodeDetails.value.set(episodeNum, {
          title: `Episode ${episodeNum}`,
          date: '',
          url: null,
          duration: [0, 0, 0],
          speakers: [],
          chapters: [],
          _fallback: 'minimal',
        });
      }
    } else if (existingDetail._fallback === 'minimal') {
      // Upgrade minimal to episodes.json if available
      if (meta && (meta.url || Number.isFinite(meta.durationSec as number) || meta.title || meta.date || (Array.isArray(meta.speakers) && meta.speakers.length > 0))) {
        episodeDetails.value.set(episodeNum, {
          title: meta.title || '',
          date: meta.date || '',
          url: meta.url || null,
          duration: secondsToHmsTuple(meta.durationSec),
          speakers: Array.isArray(meta.speakers) ? meta.speakers : [],
          chapters: [],
          _fallback: 'episodes.json',
        });
      }
    } else if (existingDetail._fallback === 'episodes.json') {
      // Update episodes.json fallback with any missing data (especially speakers)
      if (meta) {
        const updated: any = { ...existingDetail };
        let needsUpdate = false;
        
        // Update date if missing
        if (!updated.date && meta.date) {
          updated.date = meta.date;
          needsUpdate = true;
        }
        
        // ALWAYS update speakers from episodes.json if available
        if (Array.isArray(meta.speakers) && meta.speakers.length > 0) {
          // Always use speakers from episodes.json, even if we already have some
          updated.speakers = meta.speakers;
          needsUpdate = true;
        }
        
        if (needsUpdate) {
          episodeDetails.value.set(episodeNum, updated);
        }
      }
    } else if (!existingDetail._fallback) {
      // If we have full details (no fallback), ALWAYS ensure speakers from episodes.json
      if (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0) {
        // ALWAYS update speakers from episodes.json, even if we already have some
        episodeDetails.value.set(episodeNum, {
          ...existingDetail,
          speakers: meta.speakers,
        });
      }
    }
  }

  // STEP 2: Load full details for ALL episodes in batches
  // Wait for DOM to update first
  await nextTick();
  await nextTick();
  await new Promise(resolve => requestAnimationFrame(resolve));
  if (isStale()) return;
  
  // Get all episodes that need to be loaded (all episodes with fallback/minimal data)
  // IMPORTANT: Include ALL episodes that have any data, not just those with fallback
  // This ensures we try to load full details for all episodes
  const allEpisodesToLoad = episodeNumbers.filter(episodeNum => {
    const detail = episodeDetails.value.get(episodeNum);
    // Load if we have fallback/minimal data (we want to replace it with full details)
    // Also include episodes that might not have been set yet (shouldn't happen, but safety check)
    if (!detail) {
      // This shouldn't happen after STEP 1, but if it does, set minimal data now
      const meta = mp3MetaByEpisode.value.get(episodeNum);
      if (meta && (meta.url || Number.isFinite(meta.durationSec as number) || meta.title || meta.date)) {
        episodeDetails.value.set(episodeNum, {
          title: meta.title || '',
          date: meta.date || '',
          url: meta.url || null,
          duration: secondsToHmsTuple(meta.durationSec),
          speakers: meta.speakers || [],
          chapters: [],
          _fallback: 'episodes.json',
        });
        return true; // Include in loading list
      } else {
        episodeDetails.value.set(episodeNum, {
          title: `Episode ${episodeNum}`,
          date: '',
          url: null,
          duration: [0, 0, 0],
          speakers: [],
          chapters: [],
          _fallback: 'minimal',
        });
        return true; // Include in loading list
      }
    }
    return detail && (detail._fallback === 'episodes.json' || detail._fallback === 'minimal');
  });
  
  if (allEpisodesToLoad.length > 0) {
    // Load all episodes in batches
    const batchSize = 10;
    for (let i = 0; i < allEpisodesToLoad.length; i += batchSize) {
      if (isStale()) return;
      const batch = allEpisodesToLoad.slice(i, i + batchSize);
      await Promise.all(batch.map(async (episodeNum) => {
        if (isStale()) return;
        const currentDetail = episodeDetails.value.get(episodeNum);
        const hasFallback = currentDetail && (currentDetail._fallback === 'episodes.json' || currentDetail._fallback === 'minimal');
        
        // Check cache first
        const cached = getCachedEpisodeDetail(episodeNum);
        
        // Always merge cached data with episodes.json - ALWAYS prefer episodes.json for speakers
        if (cached && typeof cached === 'object' && cached.title) {
          const meta = mp3MetaByEpisode.value.get(episodeNum);
          // Merge cached data with episodes.json - ALWAYS prefer episodes.json for speakers
          const merged = {
            ...cached,
            // ALWAYS prefer speakers from episodes.json if available
            speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
              ? meta.speakers
              : (Array.isArray(cached.speakers) && cached.speakers.length > 0 ? cached.speakers : []),
          };
          episodeDetails.value.set(episodeNum, merged);
          // Only return if we have complete data (with speakers)
          if (Array.isArray(merged.speakers) && merged.speakers.length > 0) {
            return;
          }
          // Otherwise continue to try loading fresh data
        }
        
        // If cached is null or incomplete, try loading fresh
        // This ensures we always try to get complete data
        try {
          // First try normal load (uses cache)
          let detail = await loadEpisodeDetailWithRetry(episodeNum, 2);
          
          // If that failed or returned incomplete data, try no-store fetch
          if (!detail || !Array.isArray(detail.speakers) || detail.speakers.length === 0) {
            detail = await loadEpisodeDetailNoStore(episodeNum);
          }
          
          if (isStale()) return;
          
          // Always merge detail with episodes.json data - ALWAYS prefer episodes.json for speakers
          if (detail && typeof detail === 'object' && detail.title) {
            const meta = mp3MetaByEpisode.value.get(episodeNum);
            const fallbackSpeakers = (hasFallback && Array.isArray(currentDetail.speakers) && currentDetail.speakers.length > 0) 
              ? currentDetail.speakers 
              : (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0 ? meta.speakers : []);
            
            // Merge detail with episodes.json - ALWAYS prefer episodes.json for speakers
            const merged = {
              ...detail,
              // ALWAYS prefer speakers from episodes.json if available
              speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
                ? meta.speakers
                : (Array.isArray(detail.speakers) && detail.speakers.length > 0 ? detail.speakers : fallbackSpeakers),
            };
            
            episodeDetails.value.set(episodeNum, merged);
            return;
          }
        } catch (e) {
          console.error(`Failed to load episode ${episodeNum}:`, e);
          if (isStale()) return;
        }
        
        // If loading failed, keep fallback data if we have it
        if (hasFallback) {
          return; // Keep fallback data
        }
        
        // Only set to null if we truly have no data
        if (!currentDetail) {
          episodeDetails.value.set(episodeNum, null);
        }
      }));
    }
  }
  if (isStale()) return;
  
  // Final safety check: Ensure ALL episodes have at least some data
  // This prevents any episodes from showing "Lädt..." indefinitely
  // Also update episodes that have fallback data but are missing date
  // IMPORTANT: Also overwrite null values with fallback data when filter changes
  // This MUST run synchronously before setting loadingEpisodes to false
  for (const episodeNum of episodeNumbers) {
    const existingDetail = episodeDetails.value.get(episodeNum);
    if (!existingDetail || existingDetail === null) {
      // This shouldn't happen, but if it does (or if episode was cached as null), set fallback data immediately
      const meta = mp3MetaByEpisode.value.get(episodeNum);
      if (meta && (meta.url || Number.isFinite(meta.durationSec as number) || meta.title || meta.date || (Array.isArray(meta.speakers) && meta.speakers.length > 0))) {
        episodeDetails.value.set(episodeNum, {
          title: meta.title || '',
          date: meta.date || '',
          url: meta.url || null,
          duration: secondsToHmsTuple(meta.durationSec),
          speakers: meta.speakers || [],
          chapters: [],
          _fallback: 'episodes.json',
        });
      } else {
        episodeDetails.value.set(episodeNum, {
          title: `Episode ${episodeNum}`,
          date: '',
          url: null,
          duration: [0, 0, 0],
          speakers: [],
          chapters: [],
          _fallback: 'minimal',
        });
      }
    } else if (existingDetail._fallback === 'episodes.json') {
      // If we have episodes.json fallback, update it with any missing data (date, speakers)
      const meta = mp3MetaByEpisode.value.get(episodeNum);
      if (meta) {
        const updated: any = { ...existingDetail };
        let needsUpdate = false;
        
        // Update date if missing
        if (!updated.date && meta.date) {
          updated.date = meta.date;
          needsUpdate = true;
        }
        
        // ALWAYS update speakers from episodes.json if available
        if (Array.isArray(meta.speakers) && meta.speakers.length > 0) {
          updated.speakers = meta.speakers;
          needsUpdate = true;
        }
        
        if (needsUpdate) {
          episodeDetails.value.set(episodeNum, updated);
        }
      }
    } else if (!existingDetail._fallback) {
      // If we have full details (no fallback), ALWAYS ensure speakers from episodes.json
      const meta = mp3MetaByEpisode.value.get(episodeNum);
      if (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0) {
        // ALWAYS update speakers from episodes.json, even if we already have some
        episodeDetails.value.set(episodeNum, {
          ...existingDetail,
          speakers: meta.speakers,
        });
      }
    }
  }
  
  // Double-check: Ensure ALL episodes in the list have at least minimal data
  // This is a final safety net to prevent any episodes from showing "Lädt..."
  for (const episodeNum of episodeNumbers) {
    if (!episodeDetails.value.has(episodeNum)) {
      // This REALLY shouldn't happen, but if it does, set minimal data immediately
      const meta = mp3MetaByEpisode.value.get(episodeNum);
      if (meta && (meta.url || Number.isFinite(meta.durationSec as number) || meta.title || meta.date)) {
        episodeDetails.value.set(episodeNum, {
          title: meta.title || '',
          date: meta.date || '',
          url: meta.url || null,
          duration: secondsToHmsTuple(meta.durationSec),
          speakers: meta.speakers || [],
          chapters: [],
          _fallback: 'episodes.json',
        });
      } else {
        episodeDetails.value.set(episodeNum, {
          title: `Episode ${episodeNum}`,
          date: '',
          url: null,
          duration: [0, 0, 0],
          speakers: [],
          chapters: [],
          _fallback: 'minimal',
        });
      }
    }
  }
  
  // Force Vue reactivity update before marking as done
  await nextTick();
  if (isStale()) return;
}

// Lade Episode-Details mit lazy loading
const loadEpisodeDetails = async () => {
  if (!selectedSpeakerInfo.value) return;

  const requestId = ++episodeDetailsRequestId;
  loadingEpisodes.value = true;
  try {
    await setupLazyLoadingForEpisodes(selectedSpeakerInfo.value.episodeNumbers, requestId);
  } finally {
    // Only the latest request may clear the loading flag
    if (requestId === episodeDetailsRequestId) {
      loadingEpisodes.value = false;
    }
  }
};

// Watch für showEpisodeList
watch(showEpisodeList, (newValue) => {
  if (newValue && selectedSpeakerInfo.value) {
    loadEpisodeDetails();
  }
});

// Watch für selectedYear - lade zusätzliche Episoden wenn Filter entfernt wird
watch(selectedYear, () => {
  if (showEpisodeList.value && selectedSpeakerInfo.value) {
    loadEpisodeDetails();
  }
});

// Watch for speaker changes while the episode list is open.
// Without this, switching speakers can update the table rows (episodeNumbers)
// without triggering a reload if the year stays the same.
watch(selectedSpeaker, () => {
  if (showEpisodeList.value && selectedSpeakerInfo.value) {
    loadEpisodeDetails();
  }
});

// Cleanup observers on unmount
onUnmounted(() => {
  observerCleanups.value.forEach(cleanup => cleanup());
  observerCleanups.value.clear();
});

// When switching podcasts, clear cached MP3 index and episode details
watch(
  () => settings.selectedPodcast,
  () => {
    mp3IndexLoaded.value = false;
    mp3IndexError.value = null;
    mp3UrlByEpisode.value = new Map();
    episodeDetails.value = new Map();
    showEpisodeList.value = false;
    observerCleanups.value.forEach(cleanup => cleanup());
    observerCleanups.value.clear();
  }
);

// Play episode function
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
  selectedSpeaker,
  selectedYear,
  setSelectedSpeaker: (speaker: string | null) => {
    selectedSpeaker.value = speaker;
  },
  setSelectedYear: (year: number | null) => {
    selectedYear.value = year;
  },
  selectedSpeakerInfo,
  showEpisodeList,
  setShowEpisodeList: (value: boolean) => {
    showEpisodeList.value = value;
  },
  episodeDetails,
  loadingEpisodes,
  playEpisodeAt,
  formatDuration
});
</script>

<template>
  <div class="speaker-river-container">
    <!-- Tooltip -->
    <div 
      ref="tooltipRef" 
      class="tooltip"
      style="display: none; position: absolute; background: rgba(0, 0, 0, 0.9); color: white; padding: 8px 12px; border-radius: 6px; pointer-events: none; z-index: 1000; font-size: 13px; box-shadow: 0 4px 6px rgba(0,0,0,0.3);"
    ></div>
    
    <div class="flex flex-col lg:flex-row gap-4">
      <!-- River Chart -->
      <div ref="containerRef" class="flex-1 w-full overflow-x-auto -mx-2 sm:mx-0">
        <svg ref="svgRef" class="speaker-river-svg"></svg>
      </div>
      
      <!-- HTML Legend (Desktop only) -->
      <div class="hidden lg:block w-64 flex-shrink-0">
        <div class="sticky top-4 max-h-[600px] overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-4">
          <h3 class="text-sm font-semibold mb-3 text-gray-900 dark:text-white">Sprecher</h3>
          <input
            v-model="legendSearchQuery"
            type="text"
            placeholder="Suche…"
            class="w-full mb-3 px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100"
          />
          <div class="space-y-2">
            <div 
              v-for="speaker in filteredLegendSpeakers" 
              :key="speaker.id"
              @mouseenter="hoveredSpeaker = speaker.id; startPulse(speaker.id)"
              @mouseleave="hoveredSpeaker = null; stopPulse()"
              @click="selectedSpeaker = selectedSpeaker === speaker.id ? null : speaker.id"
              class="flex items-start gap-2 p-2 rounded cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700"
              :class="{
                'bg-gray-100 dark:bg-gray-700': hoveredSpeaker === speaker.id || selectedSpeaker === speaker.id,
                'opacity-40': (hoveredSpeaker || selectedSpeaker) && hoveredSpeaker !== speaker.id && selectedSpeaker !== speaker.id
              }"
            >
              <div 
                class="w-4 h-4 rounded flex-shrink-0 mt-0.5" 
                :style="{ backgroundColor: speaker.color }"
              ></div>
              <div class="flex-1 min-w-0">
                <div 
                  class="text-xs leading-tight text-gray-900 dark:text-white"
                  :class="{
                    'font-semibold': hoveredSpeaker === speaker.id || selectedSpeaker === speaker.id
                  }"
                  :title="`${speaker.name} (${speaker.totalAppearances} Episoden)`"
                >
                  {{ speaker.name }}
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  {{ speaker.totalAppearances }} Episoden
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Tooltip -->
    <div
      v-if="tooltipData"
      ref="tooltipRef"
      class="fixed z-50 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg p-3 pointer-events-none"
      :style="{
        left: `${tooltipData.x + 10}px`,
        top: `${tooltipData.y - 10}px`,
        transform: 'translateY(-100%)'
      }"
    >
      <div class="flex items-center gap-3">
        <img
          v-if="tooltipData.speakerImage"
          :src="tooltipData.speakerImage"
          :alt="tooltipData.speakerName"
          class="w-12 h-12 rounded-full border-2 border-green-500 object-cover"
        />
        <div v-else class="w-12 h-12 rounded-full border-2 border-green-500 bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-green-600 dark:text-green-400 font-semibold text-lg">
          {{ tooltipData.speakerName.charAt(0).toUpperCase() }}
        </div>
        <div>
          <div class="font-semibold text-gray-900 dark:text-gray-100">{{ tooltipData.speakerName }}</div>
          <div class="text-sm text-gray-600 dark:text-gray-400">Jahr: {{ tooltipData.year }}</div>
        </div>
      </div>
      <div class="mt-2 text-xs text-gray-500 dark:text-gray-400 italic">Klicken zum Filtern</div>
    </div>
    
    <div class="mt-6 text-sm text-gray-600">
      <p>
        <strong>Interaktion:</strong> Bewege die Maus über einen Stream oder die Legende, um den Speaker hervorzuheben. 
        Klicke, um Details anzuzeigen. Klicke auf einen Stream, um Episoden nach Jahr zu filtern.
      </p>
    </div>
  </div>
</template>

<style scoped>
.speaker-river-container {
  padding: 1rem;
}

.speaker-river-svg {
  display: block;
  font-family: system-ui, -apple-system, sans-serif;
}

input[type="range"] {
  accent-color: #10b981;
}
</style>

