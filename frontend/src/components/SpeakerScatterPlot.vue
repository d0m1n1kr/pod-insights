<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted } from 'vue';
import * as d3 from 'd3';
import { getPodcastFileUrl, withBase } from '@/composables/usePodcast';
import { useSpeakerMeta } from '@/composables/useSpeakerMeta';

type SpeakerStats = {
  v: number;
  episode: number;
  episodeDurationSec: number;
  speakers: string[];
  speakerStats: Record<string, {
    overall: {
      totalSpeakingTimeSec: number;
      speakingShare: number;
    };
    temporal: Array<{
      intervalStartSec: number;
      intervalEndSec: number;
      totalSpeakingTimeSec: number;
      speakingShare: number;
      boxplot: {
        min: number;
        q1: number;
        median: number;
        q3: number;
        max: number;
      };
    }>;
  }>;
};

type EpisodeTopics = {
  episodeNumber: number;
  topics: Array<{
    topic: string;
    positionSec?: number;
    durationSec?: number;
  }>;
};

type TranscriptData = {
  speakers: string[];
  t: number[]; // timestamps in seconds
  s: number[]; // speaker indices
};

type SpeechSegment = {
  speaker: string;
  startTime: number; // in seconds
  duration: number; // in seconds
  endTime: number; // in seconds
};

const props = defineProps<{
  data: SpeakerStats;
  episodeTopics?: EpisodeTopics | null;
  episodeNumber?: number;
}>();

const emit = defineEmits<{
  'play-at-time': [timeSec: number];
}>();

const chartRef = ref<HTMLDivElement>();
const tooltipRef = ref<HTMLDivElement>();
const transcriptData = ref<TranscriptData | null>(null);
const transcriptLoading = ref(false);
const isDarkMode = ref(false);

// Use speaker meta composable (uses index-meta.json to reduce 404 requests)
const { loadSpeakers, getSpeakerImage } = useSpeakerMeta();

const colors = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // orange
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
];

// Load transcript data
const loadTranscript = async () => {
  if (!props.episodeNumber || transcriptData.value || transcriptLoading.value) return;

  transcriptLoading.value = true;
  try {
    const transcriptUrl = withBase(getPodcastFileUrl(`episodes/${props.episodeNumber}-ts-live.json`));
    const response = await fetch(transcriptUrl, { cache: 'force-cache' });
    if (response.ok) {
      transcriptData.value = await response.json();
    }
  } catch (e) {
    console.error('Failed to load transcript:', e);
  } finally {
    transcriptLoading.value = false;
  }
};

// Get topics for a time interval
const getTopicsForInterval = (startSec: number, endSec: number): string[] => {
  if (!props.episodeTopics?.topics) return [];

  const matchingTopics = props.episodeTopics.topics
    .filter(topic => {
      const topicStart = topic.positionSec;
      if (topicStart === undefined || topicStart === null) return false;

      // Calculate topic end time (start + duration)
      const topicDuration = topic.durationSec || 0;
      const topicEnd = topicStart + topicDuration;

      // Topic overlaps interval if: topic starts before interval ends AND topic ends after interval starts
      const overlaps = topicStart < endSec && topicEnd > startSec;

      return overlaps;
    })
    .map(topic => topic.topic)
    .filter(topic => topic && topic.trim().length > 0)
    .slice(0, 5); // Limit to 5 topics

  return matchingTopics;
};

// Extract speech segments from transcript data
const extractSpeechSegments = (): SpeechSegment[] => {
  if (!transcriptData.value) return [];

  const segments: SpeechSegment[] = [];
  const { t: timestamps, s: speakerIndices, speakers } = transcriptData.value;

  // Each timestamp represents a speech segment with duration to next timestamp
  for (let i = 0; i < timestamps.length - 1; i++) {
    const currentTime = timestamps[i];
    const nextTime = timestamps[i + 1];
    const speakerIndex = speakerIndices[i];

    // Ensure we have valid data
    if (currentTime === undefined || nextTime === undefined ||
        speakerIndex === undefined || speakerIndex >= speakers.length) {
      continue;
    }

    const duration = nextTime - currentTime;
    const speaker = speakers[speakerIndex];

    // Only include segments with measurable duration (>0.1s to filter noise)
    // and ensure speaker is valid
    if (duration > 0.1 && speaker) {
      segments.push({
        speaker: speaker,
        startTime: currentTime,
        duration: duration,
        endTime: nextTime
      });
    }
  }

  return segments;
};

const drawChart = () => {
  if (!chartRef.value || !props.data || !tooltipRef.value) return;

  // Clear previous chart
  d3.select(chartRef.value).selectAll('*').remove();

  // Detect dark mode
  isDarkMode.value = document.documentElement.classList.contains('dark');

  // Get speech segments
  const segments = extractSpeechSegments();

  if (segments.length === 0) {
    d3.select(chartRef.value)
      .append('div')
      .attr('class', 'text-center text-gray-500 dark:text-gray-400 p-8')
      .text('No speech segments found');
    return;
  }

  // Set up dimensions
  const container = chartRef.value;
  const width = container.clientWidth || Math.max(600, container.getBoundingClientRect().width);
  const height = Math.max(400, Math.min(800, width * 0.65)); // Better aspect ratio for wide plots

  // Responsive margin: no extra space for legend (using HTML legend instead)
  const margin = {
    top: 60,
    right: 20, // Reduced since we use HTML legend
    bottom: 60,
    left: 80
  };

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const svg = d3
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height);

  const g = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Color scale for speakers - use our custom colors
  const colorScale = d3.scaleOrdinal(colors);

  // Scales
  const xScale = d3
    .scaleLinear()
    .domain([0, props.data.episodeDurationSec])
    .range([0, innerWidth]);

  const yScale = d3
    .scaleLinear()
    .domain([0, d3.max(segments, d => d.duration) || 10])
    .range([innerHeight, 0])
    .nice();

  // Draw scatter plot points
  g.selectAll('circle')
    .data(segments)
    .enter()
    .append('circle')
    .attr('cx', d => xScale(d.startTime))
    .attr('cy', d => yScale(d.duration))
    .attr('r', 4)
    .attr('fill', d => colorScale(d.speaker))
    .attr('fill-opacity', 0.7)
    .attr('stroke', d => colorScale(d.speaker))
    .attr('stroke-width', 1.5)
    .style('cursor', 'pointer')
    .on('mouseover', function(event, d) {
      if (!tooltipRef.value) return;

      // Highlight this point
      d3.select(this)
        .attr('r', 6)
        .attr('fill-opacity', 1);

      const speakerImage = getSpeakerImage(d.speaker);
      const topics = getTopicsForInterval(d.startTime, d.endTime);

      const imageHtml = speakerImage
        ? `<img src="${speakerImage}" alt="${d.speaker}" style="width: 32px; height: 32px; border-radius: 50%; border: 2px solid white; display: inline-block; margin-right: 8px;" />`
        : '';

      const borderColor = isDarkMode.value ? '#374151' : '#e5e7eb';
      const labelColor = isDarkMode.value ? '#9ca3af' : '#4b5563';
      const topicBgColor = isDarkMode.value ? 'rgba(30, 58, 138, 0.3)' : '#dbeafe';
      const topicTextColor = isDarkMode.value ? '#93c5fd' : '#1e40af';

      const topicsHtml = topics.length > 0
        ? `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid ${borderColor};">
             <div style="font-size: 11px; font-weight: 600; color: ${labelColor}; margin-bottom: 4px;">Topics:</div>
             <div style="display: flex; flex-wrap: wrap; gap: 4px;">
               ${topics.map(topic => `<span style="padding: 2px 8px; font-size: 11px; background-color: ${topicBgColor}; color: ${topicTextColor}; border-radius: 4px;">${topic}</span>`).join('')}
             </div>
           </div>`
        : '';

      tooltipRef.value.style.display = 'block';
      tooltipRef.value.style.position = 'fixed';
      tooltipRef.value.style.left = `${event.clientX + 15}px`;
      tooltipRef.value.style.top = `${event.clientY - 10}px`;
      tooltipRef.value.style.zIndex = '1000';
      tooltipRef.value.style.backgroundColor = isDarkMode.value ? '#1f2937' : 'white';
      tooltipRef.value.style.color = isDarkMode.value ? '#f3f4f6' : '#111827';
      tooltipRef.value.style.borderColor = isDarkMode.value ? '#374151' : '#e5e7eb';

      tooltipRef.value.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          ${imageHtml}
          <div style="font-weight: 600; font-size: 14px; color: ${isDarkMode.value ? '#f3f4f6' : '#111827'};">${d.speaker}</div>
        </div>
        <div style="font-size: 12px; color: ${isDarkMode.value ? '#9ca3af' : '#4b5563'};">
          <div><strong>Time:</strong> ${formatTime(d.startTime)} - ${formatTime(d.endTime)}</div>
          <div><strong>Duration:</strong> ${d.duration.toFixed(1)}s</div>
        </div>
        ${topicsHtml}
        ${props.episodeNumber ? `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid ${borderColor};">
          <div style="font-size: 11px; color: ${labelColor}; font-style: italic;">Click to play</div>
        </div>` : ''}
      `;
    })
    .on('mouseout', function() {
      // Reset point size
      d3.select(this)
        .attr('r', 4)
        .attr('fill-opacity', 0.7);

      if (tooltipRef.value) {
        tooltipRef.value.style.display = 'none';
      }
    })
    .on('click', function(_event, d) {
      // Play from the start of this segment
      emit('play-at-time', d.startTime);
    });

  // X axis
  const xAxis = d3.axisBottom(xScale).tickFormat((d) => {
    const sec = Number(d);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}`;
    return `${m}`;
  });

  const labelColor = isDarkMode.value ? '#d1d5db' : '#4b5563';

  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(xAxis)
    .selectAll('text')
    .style('fill', labelColor)
    .style('font-size', '14px');

  g.append('text')
    .attr('x', innerWidth / 2)
    .attr('y', innerHeight + 45)
    .attr('text-anchor', 'middle')
    .style('fill', labelColor)
    .style('font-size', '16px')
    .style('font-weight', '500')
    .text('Time');

  // Y axis
  const yAxis = d3.axisLeft(yScale).tickFormat(d => `${d}s`);

  g.append('g')
    .call(yAxis)
    .selectAll('text')
    .style('fill', labelColor)
    .style('font-size', '14px');

  g.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('y', -45)
    .attr('x', -innerHeight / 2)
    .attr('text-anchor', 'middle')
    .style('fill', labelColor)
    .style('font-size', '16px')
    .style('font-weight', '500')
    .text('Speech Duration');

  // Legend (hidden, use HTML legend instead)
  const legendOffset = width > 1200 ? 20 : width > 800 ? 25 : 30; // +30% adjusted for much wider legend space
  const legend = g
    .append('g')
    .attr('transform', `translate(${innerWidth + legendOffset}, 20)`)
    .style('display', 'none'); // Hide SVG legend, use HTML legend instead

  const uniqueSpeakers = Array.from(new Set(segments.map(d => d.speaker)));

  uniqueSpeakers.forEach((speaker, i) => {
    const legendRow = legend
      .append('g')
      .attr('transform', `translate(0, ${i * 25})`);

    legendRow
      .append('circle')
      .attr('cx', 6)
      .attr('cy', 6)
      .attr('r', 5)
      .attr('fill', colorScale(speaker))
      .attr('fill-opacity', 0.7)
      .attr('stroke', colorScale(speaker))
      .attr('stroke-width', 1.5);

    const legendTextColor = isDarkMode.value ? '#e5e7eb' : '#374151';

    legendRow
    .append('text')
    .attr('x', 45)
    .attr('y', 10)
    .style('fill', legendTextColor)
    .style('font-size', '14px')
    .text(speaker.length > 32 ? speaker.substring(0, 29) + '...' : speaker);
  });

};

const formatTime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
};

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  // Load transcript data if episode number is available
  if (props.episodeNumber) {
    loadTranscript();
  }

  // Load speaker metadata
  if (props.data?.speakers) {
    loadSpeakers(props.data.speakers).then(() => {
      setTimeout(() => {
        drawChart();
      }, 0);
    });
  } else {
    setTimeout(() => {
      drawChart();
    }, 0);
  }

  // Watch for data changes
  watch(() => props.data, () => {
    if (tooltipRef.value) {
  if (props.data?.speakers) {
    loadSpeakers(props.data.speakers).then(() => {
      drawChart();
    });
  } else {
    drawChart();
  }
    }
  }, { deep: true });

  // Watch for episode number changes to load transcript
  watch(() => props.episodeNumber, () => {
    if (props.episodeNumber) {
      loadTranscript();
    }
  }, { immediate: true });

  // Watch for episode topics changes
  watch(() => props.episodeTopics, () => {
    if (tooltipRef.value) {
      drawChart();
    }
  }, { deep: true });

  // Watch for theme changes (dark mode toggle)
  if (window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = () => {
      drawChart();
    };
    mediaQuery.addEventListener('change', handleThemeChange);

    // Also watch for class changes on html element
    const observer = new MutationObserver(() => {
      drawChart();
    });
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class']
      });
    }
  }

  // Watch for resize
  if (chartRef.value && 'ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(() => {
      drawChart();
    });
    resizeObserver.observe(chartRef.value);
  }
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (chartRef.value) {
    d3.select(chartRef.value).selectAll('*').remove();
  }
});
</script>

<template>
  <div class="relative w-full">
    <div class="flex flex-col lg:flex-row gap-4">
      <!-- Chart -->
      <div ref="chartRef" class="flex-1 w-full overflow-x-auto"></div>
      
      <!-- HTML Legend (Desktop only) -->
      <div class="hidden lg:block w-64 flex-shrink-0">
        <div class="sticky top-4 max-h-[600px] overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-4 mt-7">
          <h3 class="text-sm font-semibold mb-3 text-gray-900 dark:text-white">Sprecher</h3>
          <div class="space-y-2">
            <div 
              v-for="speaker in props.data.speakers" 
              :key="speaker"
              class="flex items-center gap-2 p-2 rounded transition-all"
            >
              <!-- Speaker Image -->
              <img
                v-if="getSpeakerImage(speaker)"
                :src="getSpeakerImage(speaker)"
                :alt="speaker"
                @error="($event.target as HTMLImageElement).style.display = 'none'"
                class="w-8 h-8 rounded-full flex-shrink-0 border border-gray-300 dark:border-gray-600 object-cover"
              />
              <div class="flex-1 min-w-0 flex items-center gap-2">
                <div 
                  class="text-xs leading-tight text-gray-900 dark:text-white"
                >
                  {{ speaker }}
                </div>
                <!-- Color marker -->
                <div 
                  class="w-4 h-4 rounded-full flex-shrink-0" 
                  :style="{ 
                    backgroundColor: colors[props.data.speakers.indexOf(speaker) % colors.length],
                    opacity: 0.7
                  }"
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <div
      ref="tooltipRef"
      style="display: none; position: fixed; z-index: 1000; background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); padding: 0.75rem; max-width: 20rem; pointer-events: none;"
      class="dark:bg-gray-800 dark:border-gray-700"
    ></div>
  </div>
</template>
