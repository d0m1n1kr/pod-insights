<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import * as d3 from 'd3';
import type { TopicRiverData, ProcessedTopicData } from '../types';

const props = defineProps<{
  data: TopicRiverData;
}>();

const svgRef = ref<SVGSVGElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);
const selectedTopic = ref<string | null>(null);
const hoveredTopic = ref<string | null>(null);
const topicFilter = ref<number>(15);
const normalizedView = ref<boolean>(false);
const dimensions = ref({ width: 1200, height: 600 });

// Prozessiere die Daten
const processedData = computed(() => {
  const topics: ProcessedTopicData[] = [];
  const years = props.data.statistics.years;
  
  console.log('Processing data with topicFilter:', topicFilter.value);
  
  // Erstelle ein Array aller Topics mit ihrer Episode-Anzahl
  const allTopics = Object.values(props.data.topics).map(topic => ({
    id: topic.id,
    name: topic.name,
    episodeCount: topic.totalEpisodes,
    data: topic
  }));
  
  // Sortiere nach Episode-Anzahl und nimm die Top-N
  const topTopics = allTopics
    .sort((a, b) => b.episodeCount - a.episodeCount)
    .slice(0, topicFilter.value);
  
  console.log('Top topics count:', topTopics.length);
  
  // Erweiterte Farbpalette für mehr Topics
  const generateColors = (count: number): string[] => {
    if (count <= 10) {
      return d3.schemeCategory10.slice(0, count);
    }
    
    // Kombiniere mehrere D3 Farbschemata für bessere Unterscheidbarkeit
    const colors = [
      ...d3.schemeCategory10,
      ...d3.schemePaired,
      ...d3.schemeSet3
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
    
    // Setze die tatsächlichen Werte (Anzahl Episoden)
    topic.yearData.forEach(yd => {
      yearValues.set(yd.year, yd.count);
    });
    
    topics.push({
      id: topic.id,
      name: topic.name,
      yearValues,
      totalDuration: topic.totalEpisodes,
      color: colors[index] || '#888'
    });
  });
  
  return { topics, years };
});

// Erstelle das Stream Graph (Topic River)
const drawRiver = () => {
  if (!svgRef.value || !containerRef.value) return;
  
  const container = containerRef.value;
  const width = container.clientWidth;
  const height = dimensions.value.height;
  dimensions.value.width = width;
  
  const margin = { top: 20, right: 280, bottom: 60, left: 60 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  
  // Lösche vorherigen Inhalt
  d3.select(svgRef.value).selectAll('*').remove();
  
  const svg = d3.select(svgRef.value)
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
  const stack = d3.stack()
    .keys(keys)
    // In normierter Ansicht: stackOffsetExpand sorgt für gleich hohe Jahre (0-1)
    // In normaler Ansicht: stackOffsetWiggle für schöne Stream-Optik
    .offset(normalizedView.value ? d3.stackOffsetExpand : d3.stackOffsetWiggle)
    .order(d3.stackOrderInsideOut);
  
  const series = stack(stackData);
  
  // Scales
  const xScale = d3.scaleLinear()
    .domain([years[0] || 0, years[years.length - 1] || 0])
    .range([0, innerWidth]);
  
  const flatValues = series.flat(2).filter((d): d is number => d !== undefined);
  const yExtent = d3.extent(flatValues) as [number, number];
  const yScale = d3.scaleLinear()
    .domain(yExtent)
    .range([innerHeight, 0]);
  
  // Area generator
  const area = d3.area<any>()
    .x((d: any) => xScale(d.data.year))
    .y0((d: any) => yScale(d[0]))
    .y1((d: any) => yScale(d[1]))
    .curve(d3.curveBasis);
  
  // Zeichne die Streams
  const streams = g.selectAll('.stream')
    .data(series)
    .join('path')
    .attr('class', 'stream')
    .attr('d', area)
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
    .on('mouseout', function(_event: any, d: any) {
      // Only clear if we're leaving the current hovered item
      if (hoveredTopic.value === d.key) {
        hoveredTopic.value = null;
      }
    })
    .on('click', function(_event: any, d: any) {
      selectedTopic.value = selectedTopic.value === d.key ? null : d.key;
    });
  
  // X-Achse
  const xAxis = d3.axisBottom(xScale)
    .tickFormat(d3.format('d'))
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
  
  // Legende
  const legend = g.append('g')
    .attr('class', 'legend')
    .attr('transform', `translate(${innerWidth + 20}, 0)`);
  
  topics.forEach((topic, i) => {
    const legendRow = legend.append('g')
      .attr('class', 'legend-item')
      .attr('data-topic-id', topic.id)
      .attr('transform', `translate(0, ${i * 24})`)
      .style('cursor', 'pointer')
      .on('mouseover', function() {
        hoveredTopic.value = topic.id;
      })
      .on('mouseout', function() {
        // Only clear if we're leaving the current hovered item
        if (hoveredTopic.value === topic.id) {
          hoveredTopic.value = null;
        }
      })
      .on('click', function() {
        selectedTopic.value = selectedTopic.value === topic.id ? null : topic.id;
      });
    
    legendRow.append('rect')
      .attr('width', 16)
      .attr('height', 16)
      .attr('fill', topic.color)
      .attr('opacity', () => {
        if (!hoveredTopic.value && !selectedTopic.value) return 0.8;
        if (hoveredTopic.value === topic.id || selectedTopic.value === topic.id) return 1;
        return 0.2;
      });
    
    const text = legendRow.append('text')
      .attr('x', 22)
      .attr('y', 12)
      .attr('fill', '#333')
      .style('font-size', '11px')
      .style('font-weight', () => {
        if (hoveredTopic.value === topic.id || selectedTopic.value === topic.id) return '600';
        return '400';
      })
      .text(`${topic.name} (${Math.round(topic.totalDuration)} Episoden)`);
    
    // Tooltip für lange Namen
    text.append('title').text(`${topic.name} (${Math.round(topic.totalDuration)} Episoden)`);
  });
  
  return streams; // Return streams for updating
};

// Function to update opacity without full redraw
const updateOpacity = () => {
  if (!svgRef.value) return;
  
  const svg = d3.select(svgRef.value);
  
  // Update stream opacity
  svg.selectAll('.stream')
    .attr('opacity', function(d: any) {
      if (!hoveredTopic.value && !selectedTopic.value) return 0.8;
      if (hoveredTopic.value && d.key === hoveredTopic.value) return 1;
      if (selectedTopic.value && d.key === selectedTopic.value) return 1;
      return 0.2;
    });
  
  // Update legend opacity and font weight
  svg.selectAll('.legend-item').each(function() {
    const item = d3.select(this);
    const topicId = item.attr('data-topic-id');
    
    item.select('rect')
      .attr('opacity', () => {
        if (!hoveredTopic.value && !selectedTopic.value) return 0.8;
        if (hoveredTopic.value === topicId || selectedTopic.value === topicId) return 1;
        return 0.2;
      });
    
    item.select('text')
      .style('font-weight', () => {
        if (hoveredTopic.value === topicId || selectedTopic.value === topicId) return '600';
        return '400';
      });
  });
};

// Watch für Änderungen
watch(topicFilter, () => {
  console.log('topicFilter changed to:', topicFilter.value);
  hoveredTopic.value = null; // Clear hover on filter change
  drawRiver();
});

watch(normalizedView, () => {
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
  }> = [];
  
  fullTopic.yearData.forEach(yd => {
    allEpisodes.push(...yd.episodes);
  });
  
  // Sortiere nach Episode-Nummer (neueste zuerst)
  allEpisodes.sort((a, b) => b.number - a.number);
  
  return {
    ...topic,
    description: fullTopic.description,
    episodes: allEpisodes
  };
});

const showEpisodeList = ref(false);
const showTopicList = ref(false);
const episodeDetails = ref<Map<number, any>>(new Map());
const episodeTopics = ref<Map<number, any>>(new Map());
const taxonomyData = ref<any>(null);
const loadingEpisodes = ref(false);
const loadingTopics = ref(false);

// Lade Episode-Details für Topics (für Speaker-Informationen)
const loadEpisodeDetails = async () => {
  if (!selectedTopicInfo.value || loadingEpisodes.value) return;
  
  loadingEpisodes.value = true;
  const newDetails = new Map<number, any>();
  
  // Lade nur Episoden, die noch nicht geladen sind
  const toLoad = selectedTopicInfo.value.episodes
    .map(ep => ep.number)
    .filter(num => !episodeDetails.value.has(num));
  
  for (const episodeNum of toLoad) {
    try {
      const response = await fetch(`/episodes/${episodeNum}.json`);
      if (response.ok) {
        const data = await response.json();
        newDetails.set(episodeNum, data);
      }
    } catch (e) {
      console.error(`Failed to load episode ${episodeNum}:`, e);
    }
  }
  
  // Merge mit existierenden Details
  episodeDetails.value = new Map([...episodeDetails.value, ...newDetails]);
  loadingEpisodes.value = false;
};

// Lade alle einzelnen Topics aus den Episode-Topics
const loadAllTopics = async () => {
  if (!selectedTopicInfo.value || loadingTopics.value) return;
  
  loadingTopics.value = true;
  
  // Versuche zuerst die detailed mapping zu laden
  if (!taxonomyData.value) {
    try {
      const response = await fetch('/topic-taxonomy-detailed.json');
      if (response.ok) {
        taxonomyData.value = await response.json();
        loadingTopics.value = false;
        return; // Wir haben die Daten, kein Laden von Episode-Topics nötig
      }
    } catch (e) {
      console.log('Detailed taxonomy not found, falling back to episode topics');
    }
  }
  
  // Fallback: Lade Episode-Topics wie bisher
  const newTopics = new Map<number, any>();
  const toLoad = selectedTopicInfo.value.episodes
    .map(ep => ep.number)
    .filter(num => !episodeTopics.value.has(num));
  
  for (const episodeNum of toLoad) {
    try {
      const response = await fetch(`/episodes/${episodeNum}-topics.json`);
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

// Watch für showTopicList
watch(showTopicList, (newValue) => {
  if (newValue && selectedTopicInfo.value) {
    loadAllTopics();
  }
});

// Helper function to format duration
const formatDuration = (duration: [number, number, number]) => {
  const [hours, minutes, seconds] = duration;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};
</script>

<template>
  <div class="topic-river-container">
    <div class="controls mb-6">
      <div class="flex items-center gap-4 flex-wrap">
        <label class="text-sm font-medium text-gray-700">
          Anzahl Topics:
          <input
            v-model.number="topicFilter"
            type="range"
            min="5"
            max="30"
            step="1"
            class="ml-2 w-48"
            @input="(e) => { topicFilter = Number((e.target as HTMLInputElement).value); }"
          />
          <span class="ml-2 text-blue-600 font-semibold">{{ topicFilter }}</span>
        </label>
        
        <label class="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
          <input
            v-model="normalizedView"
            type="checkbox"
            class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
          />
          <span>Normierte Ansicht (100%/Jahr)</span>
        </label>
      </div>
      
      <div v-if="selectedTopicInfo" class="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div class="flex items-start justify-between">
          <div class="flex-1">
            <h3 class="font-semibold text-lg text-blue-900">{{ selectedTopicInfo.name }}</h3>
            <p class="text-sm text-blue-700 mt-1">{{ selectedTopicInfo.description }}</p>
            <div class="mt-2 flex gap-4">
              <button
                @click="showEpisodeList = !showEpisodeList"
                class="text-sm text-blue-600 hover:text-blue-800 font-semibold underline"
              >
                {{ showEpisodeList ? 'Episoden ausblenden' : `${selectedTopicInfo.episodes.length} Episoden anzeigen` }}
              </button>
              <button
                @click="showTopicList = !showTopicList"
                class="text-sm text-blue-600 hover:text-blue-800 font-semibold underline"
              >
                {{ showTopicList ? 'Einzelne Topics ausblenden' : 'Alle einzelnen Topics anzeigen' }}
              </button>
            </div>
            
            <!-- Episode List -->
            <div v-if="showEpisodeList" class="mt-4 bg-white rounded-lg border border-blue-300 overflow-hidden">
              <div v-if="loadingEpisodes" class="p-4 text-center text-gray-600">
                Lade Episoden-Details...
              </div>
              <div v-else class="max-h-96 overflow-y-auto">
                <table class="w-full text-sm">
                  <thead class="bg-blue-100 sticky top-0">
                    <tr>
                      <th class="px-3 py-2 text-left text-xs font-semibold text-blue-900">#</th>
                      <th class="px-3 py-2 text-left text-xs font-semibold text-blue-900">Datum</th>
                      <th class="px-3 py-2 text-left text-xs font-semibold text-blue-900">Titel</th>
                      <th class="px-3 py-2 text-left text-xs font-semibold text-blue-900">Dauer</th>
                      <th class="px-3 py-2 text-left text-xs font-semibold text-blue-900">Speaker</th>
                      <th class="px-3 py-2 text-left text-xs font-semibold text-blue-900">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr 
                      v-for="episode in selectedTopicInfo.episodes" 
                      :key="episode.number"
                      class="border-t border-blue-100 hover:bg-blue-50"
                    >
                      <template v-if="episodeDetails.has(episode.number)">
                        <td class="px-3 py-2 text-blue-700 font-mono text-xs">{{ episode.number }}</td>
                        <td class="px-3 py-2 text-gray-600 whitespace-nowrap">
                          {{ new Date(episode.date).toLocaleDateString('de-DE') }}
                        </td>
                        <td class="px-3 py-2 text-gray-900">{{ episode.title }}</td>
                        <td class="px-3 py-2 text-gray-600 text-xs whitespace-nowrap">
                          {{ formatDuration(episodeDetails.get(episode.number).duration) }}
                        </td>
                        <td class="px-3 py-2 text-gray-600 text-xs">
                          {{ episodeDetails.get(episode.number).speakers.join(', ') }}
                        </td>
                        <td class="px-3 py-2">
                          <a 
                            :href="episodeDetails.get(episode.number).url"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="text-blue-600 hover:text-blue-800 underline text-xs"
                          >
                            🔗
                          </a>
                        </td>
                      </template>
                      <template v-else>
                        <td class="px-3 py-2 text-blue-700 font-mono text-xs">{{ episode.number }}</td>
                        <td class="px-3 py-2 text-gray-600 whitespace-nowrap">
                          {{ new Date(episode.date).toLocaleDateString('de-DE') }}
                        </td>
                        <td class="px-3 py-2 text-gray-900">{{ episode.title }}</td>
                        <td colspan="3" class="px-3 py-2 text-gray-400 text-xs">Lädt...</td>
                      </template>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            
            <!-- Individual Topics List -->
            <div v-if="showTopicList" class="mt-4 bg-white rounded-lg border border-blue-300 overflow-hidden">
              <div v-if="loadingTopics" class="p-4 text-center text-gray-600">
                Lade alle Topics...
              </div>
              <div v-else class="max-h-96 overflow-y-auto">
                <div class="p-3 bg-blue-100 sticky top-0">
                  <p class="text-sm font-semibold text-blue-900">
                    {{ allIndividualTopics.length }} einzelne Topics gefunden
                  </p>
                </div>
                <div class="divide-y divide-blue-100">
                  <div 
                    v-for="(topicItem, index) in allIndividualTopics" 
                    :key="`${topicItem.episodeNumber}-${index}`"
                    class="p-3 hover:bg-blue-50"
                  >
                    <div class="flex items-start justify-between gap-2">
                      <div class="flex-1">
                        <p class="text-sm font-medium text-gray-900">{{ topicItem.topic }}</p>
                        <div class="mt-1 flex flex-wrap gap-1 items-center">
                          <span 
                            v-if="topicItem.clusterName"
                            class="inline-block px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded font-medium"
                          >
                            📁 {{ topicItem.clusterName }}
                          </span>
                          <span 
                            v-for="keyword in topicItem.keywords" 
                            :key="keyword"
                            class="inline-block px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded"
                          >
                            {{ keyword }}
                          </span>
                        </div>
                      </div>
                      <div class="text-right whitespace-nowrap">
                        <a 
                          :href="episodeDetails.get(topicItem.episodeNumber)?.url || `https://freakshow.fm/${topicItem.episodeTitle.toLowerCase().split(' ')[0]}`"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-xs text-blue-600 hover:text-blue-800"
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
          <button
            @click="selectedTopic = null; showEpisodeList = false; showTopicList = false;"
            class="text-blue-600 hover:text-blue-800 font-semibold ml-4"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
    
    <div ref="containerRef" class="w-full overflow-x-auto">
      <svg ref="svgRef" class="topic-river-svg"></svg>
    </div>
    
    <div class="mt-6 text-sm text-gray-600">
      <p>
        <strong>Interaktion:</strong> Bewege die Maus über einen Stream oder die Legende, um das Topic hervorzuheben. 
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

