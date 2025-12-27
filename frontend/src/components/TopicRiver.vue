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
  
  const colorScale = d3.scaleOrdinal(d3.schemeCategory10)
    .domain(topTopics.map((_, i) => i.toString()));
  
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
      color: colorScale(index.toString())
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
  
  const margin = { top: 20, right: 200, bottom: 60, left: 60 };
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
    .offset(d3.stackOffsetWiggle)
    .order(d3.stackOrderInsideOut);
  
  const series = stack(stackData);
  
  // Scales
  const xScale = d3.scaleLinear()
    .domain([years[0], years[years.length - 1]])
    .range([0, innerWidth]);
  
  const yExtent = d3.extent(series.flat(2)) as [number, number];
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
    .on('mouseover', function(event: any, d: any) {
      hoveredTopic.value = d.key;
    })
    .on('mouseout', function() {
      hoveredTopic.value = null;
    })
    .on('click', function(event: any, d: any) {
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
      .attr('transform', `translate(0, ${i * 24})`)
      .style('cursor', 'pointer')
      .on('mouseover', function() {
        hoveredTopic.value = topic.id;
      })
      .on('mouseout', function() {
        hoveredTopic.value = null;
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
    
    legendRow.append('text')
      .attr('x', 22)
      .attr('y', 12)
      .attr('fill', '#333')
      .style('font-size', '11px')
      .style('font-weight', () => {
        if (hoveredTopic.value === topic.id || selectedTopic.value === topic.id) return '600';
        return '400';
      })
      .text(`${topic.name} (${Math.round(topic.totalDuration)} Episoden)`);
  });
};

// Watch für Änderungen
watch(topicFilter, () => {
  console.log('topicFilter changed to:', topicFilter.value);
  drawRiver();
});

watch([hoveredTopic, selectedTopic], () => {
  drawRiver();
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
  return {
    ...topic,
    description: fullTopic.description
  };
});
</script>

<template>
  <div class="topic-river-container">
    <div class="controls mb-6">
      <div class="flex items-center gap-4">
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
      </div>
      
      <div v-if="selectedTopicInfo" class="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div class="flex items-start justify-between">
          <div>
            <h3 class="font-semibold text-lg text-blue-900">{{ selectedTopicInfo.name }}</h3>
            <p class="text-sm text-blue-700 mt-1">{{ selectedTopicInfo.description }}</p>
          </div>
          <button
            @click="selectedTopic = null"
            class="text-blue-600 hover:text-blue-800 font-semibold"
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

