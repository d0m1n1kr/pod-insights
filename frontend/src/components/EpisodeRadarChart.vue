<script setup lang="ts">
import { ref, onMounted, watch, nextTick, computed } from 'vue';
import {
  select,
  scaleLinear,
} from '@/utils/d3-imports';

type EpisodeSubjectsData = {
  episodeNumber: number;
  title: string | null;
  generatedAt: string;
  dataSource: string;
  radarChart: {
    values: Record<string, number>;
    durations: Record<string, number>;
    topicCounts: Record<string, number>;
    totalDurationSec: number;
    totalTopics: number;
  };
  timeline: Array<{
    subject: string;
    startSec: number | null;
    endSec: number | null;
    durationSec: number | null;
    topic: string;
    fineSubject: string | null;
    topicIndex: number;
    untimed?: boolean;
  }>;
};

const props = defineProps<{
  data: EpisodeSubjectsData | null;
  size?: number; // Size in pixels (default: 120)
}>();

const svgRef = ref<SVGSVGElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);

const drawRadar = () => {
  if (!svgRef.value || !containerRef.value || !props.data) return;
  
  // Use actual container size for responsive sizing
  const containerSize = containerRef.value.clientWidth || containerRef.value.clientHeight || (props.size || 120);
  const chartSize = containerSize;
  const margin = 20;
  const radius = (chartSize - margin * 2) / 2;
  const centerX = chartSize / 2;
  const centerY = chartSize / 2;
  
  select(svgRef.value).selectAll('*').remove();
  
  const svg = select(svgRef.value)
    .attr('width', chartSize)
    .attr('height', chartSize);
  
  const g = svg.append('g')
    .attr('transform', `translate(${centerX},${centerY})`);
  
  const values = props.data.radarChart.values;
  const subjects = Object.keys(values).filter(subject => (values[subject] ?? 0) > 0);
  
  if (subjects.length === 0) {
    // No data - show empty state
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', '10px')
      .attr('fill', '#9ca3af')
      .text('No data');
    return;
  }
  
  // Find maximum value to scale to 100%
  const maxValue = Math.max(...subjects.map(subject => values[subject] || 0));
  
  // If maxValue is 0, skip drawing
  if (maxValue === 0) {
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', '10px')
      .attr('fill', '#9ca3af')
      .text('No data');
    return;
  }
  
  const numAxes = subjects.length;
  const angleSlice = (Math.PI * 2) / numAxes;
  
  // Scale for values (0 to maxValue, mapped to 0 to radius)
  // This ensures the dominant topic reaches 100% (full radius)
  const rScale = scaleLinear()
    .domain([0, maxValue])
    .range([0, radius]);
  
  // Position labels at 75% of radius (inside the chart)
  const labelRadius = radius * 0.75;
  
  // Draw grid circles (simplified - just outer circle)
  g.append('circle')
    .attr('r', radius)
    .attr('fill', 'none')
    .attr('stroke', '#e5e7eb')
    .attr('stroke-width', 1)
    .attr('opacity', 0.3);
  
  // Draw axes with labels
  subjects.forEach((subject, i) => {
    const angle = (i * angleSlice) - (Math.PI / 2);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    
    // Axis line - made more visible
    g.append('line')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', x)
      .attr('y2', y)
      .attr('stroke', '#9ca3af')
      .attr('stroke-width', 1)
      .attr('opacity', 0.7);
    
    // Subject label - positioned along the axis line, inside the chart
    const labelX = Math.cos(angle) * labelRadius;
    const labelY = Math.sin(angle) * labelRadius;
    
    // Truncate long labels for small charts
    const maxLabelLength = chartSize < 100 ? 8 : 12;
    const labelText = subject.length > maxLabelLength
      ? subject.substring(0, maxLabelLength) + '...'
      : subject;
    
    // Convert angle to degrees for rotation
    const angleDeg = (angle * 180) / Math.PI;
    
    // For labels on the left side (negative x), rotate 180 degrees to keep text readable
    const rotationAngle = labelX < 0 ? angleDeg + 180 : angleDeg;
    
    g.append('text')
      .attr('x', labelX)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('transform', `rotate(${rotationAngle}, ${labelX}, ${labelY})`)
      .attr('font-size', chartSize < 100 ? '8px' : '10px')
      .attr('fill', '#374151')
      .attr('class', 'dark:fill-gray-300')
      .text(labelText)
      .append('title')
      .text(subject);
  });
  
  // Draw area
  const points: Array<[number, number]> = [];
  
  subjects.forEach((subject, i) => {
    const angle = (i * angleSlice) - (Math.PI / 2);
    const value = values[subject] || 0;
    // rScale maps 0 to maxValue -> 0 to radius, so maxValue will reach full radius (100%)
    const r = rScale(value);
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    points.push([x, y]);
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
  g.append('path')
    .attr('d', pathString)
    .attr('fill', '#3b82f6')
    .attr('fill-opacity', 0.3)
    .attr('stroke', '#3b82f6')
    .attr('stroke-width', 1.5);
};

const containerStyle = computed(() => {
  // If size is provided, use it; otherwise let CSS classes handle it
  if (props.size) {
    return { width: `${props.size}px`, height: `${props.size}px` };
  }
  return {};
});

watch(() => props.data, () => {
  nextTick(() => {
    drawRadar();
  });
}, { deep: true });

watch(() => props.size, () => {
  nextTick(() => {
    drawRadar();
  });
});

onMounted(() => {
  nextTick(() => {
    drawRadar();
  });
});
</script>

<template>
  <div ref="containerRef" class="episode-radar-chart" :style="containerStyle">
    <svg ref="svgRef" class="w-full h-full"></svg>
  </div>
</template>

<style scoped>
.episode-radar-chart {
  flex-shrink: 0;
}
</style>

