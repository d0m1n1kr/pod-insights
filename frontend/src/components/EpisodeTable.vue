<template>
  <div :class="[$slots.header ? 'bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden' : '']">
    <div v-if="$slots.header" :class="['p-3 sm:p-4 md:p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r', themeColor === 'blue' ? 'from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20' : 'from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20']">
      <slot name="header" />
    </div>
    <div :class="[$slots.header ? 'overflow-x-auto' : 'overflow-x-auto']">
      <table class="w-full text-sm">
      <thead class="bg-gray-50 dark:bg-gray-900">
        <tr>
          <th v-if="showPlayButton" class="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Play</th>
          <th class="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Bild</th>
          <th class="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Datum</th>
          <th class="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Titel</th>
          <th class="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Positionen</th>
          <th class="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Dauer</th>
          <th class="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Sprecher</th>
          <th class="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Link</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
        <tr 
          v-for="episode in episodes" 
          :key="episode.number"
          :data-episode-row="episode.number"
        >
          <td v-if="showPlayButton" class="px-3 py-2">
            <button
              type="button"
              class="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              @click="playEpisodeAt(episode.number, 0, 'Start')"
              title="Episode von Anfang abspielen"
              aria-label="Episode von Anfang abspielen"
            >
              ▶︎
            </button>
          </td>
          <td class="px-3 py-2">
            <div class="w-12 h-12 rounded overflow-hidden border border-gray-200 dark:border-gray-700 flex-shrink-0">
              <img
                :src="getEpisodeImageUrl(episode.number)"
                :alt="episode.title"
                @error="($event.target as HTMLImageElement).style.display = 'none'"
                class="w-full h-full object-cover"
              />
            </div>
          </td>
          <td class="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap text-xs">
            {{ new Date(episode.date).toLocaleDateString('de-DE') }}
          </td>
          <td class="px-3 py-2 text-gray-900 dark:text-gray-100 text-xs">
            <router-link
              :to="{ name: 'episodeSearch', query: { episode: episode.number.toString(), podcast: selectedPodcast || 'freakshow' } }"
              :class="['truncate hover:underline', themeColor === 'blue' ? 'text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300' : 'text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300']"
            >
              {{ episode.title }}
            </router-link>
          </td>
          <td class="px-3 py-2 text-gray-600 dark:text-gray-400 text-xs font-mono">
            <template v-if="loadingEpisodes">Lädt...</template>
            <template v-else-if="getTopicOccurrences && getTopicOccurrences(episode).length > 0">
              <div class="flex flex-col gap-1">
                <template v-for="(occ, idx) in getTopicOccurrences(episode)" :key="`${episode.number}-${occ.positionSec}-${idx}`">
                  <div class="flex items-center gap-2 flex-nowrap">
                    <button
                      type="button"
                      :class="[
                        'underline hover:no-underline cursor-pointer whitespace-nowrap flex-shrink-0',
                        themeColor === 'blue'
                          ? 'text-blue-700 dark:text-blue-300'
                          : 'text-purple-700 dark:text-purple-300'
                      ]"
                      @click="playEpisodeAt(episode.number, occ.positionSec, formatOccurrenceLabel(occ))"
                      :title="`Episode öffnen bei ${formatHmsFromSeconds(occ.positionSec)}`"
                    >
                      {{ formatOccurrenceLabel(occ) }}
                    </button>
                    <span v-if="occ.topic" class="text-gray-500 dark:text-gray-400 text-[10px] leading-tight truncate flex-shrink min-w-0" :title="occ.topic">
                      {{ occ.topic }}
                    </span>
                  </div>
                </template>
              </div>
            </template>
            <span v-else>—</span>
          </td>
          <td class="px-3 py-2 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">
            <template v-if="loadingEpisodes">Lädt...</template>
            <template v-else-if="episodeDetails && episodeDetails.has(episode.number) && episodeDetails.get(episode.number)">
              <template v-if="episodeDetails.get(episode.number)._fallback !== 'minimal' && episodeDetails.get(episode.number).duration">
                {{ formatDuration(episodeDetails.get(episode.number).duration) }}
              </template>
              <template v-else>—</template>
            </template>
            <template v-else>—</template>
          </td>
          <td class="px-3 py-2 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">
            <template v-if="loadingEpisodes">Lädt...</template>
            <template v-else-if="episodeDetails && episodeDetails.has(episode.number) && episodeDetails.get(episode.number)">
              <template v-if="episodeDetails.get(episode.number).speakers && episodeDetails.get(episode.number).speakers.length > 0">
                {{ episodeDetails.get(episode.number).speakers.join(', ') }}
              </template>
              <template v-else>—</template>
            </template>
            <template v-else>—</template>
          </td>
          <td class="px-3 py-2">
            <template v-if="loadingEpisodes">—</template>
            <template v-else-if="episodeDetails && episodeDetails.has(episode.number) && episodeDetails.get(episode.number) && episodeDetails.get(episode.number).url">
              <a 
                :href="episodeDetails.get(episode.number).url"
                target="_blank"
                rel="noopener noreferrer"
                :class="['underline text-xs', themeColor === 'blue' ? 'text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300' : 'text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300']"
              >
                🔗
              </a>
            </template>
            <template v-else>
              <span class="text-gray-400 dark:text-gray-500 text-xs">—</span>
            </template>
          </td>
        </tr>
      </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingsStore } from '@/stores/settings';
import { getEpisodeImageUrl } from '@/composables/usePodcast';

const settings = useSettingsStore();
const selectedPodcast = settings.selectedPodcast;

interface Props {
  episodes: Array<{
    number: number;
    date: string;
    title: string;
    [key: string]: any;
  }>;
  episodeDetails?: Map<number, any>;
  loadingEpisodes?: boolean;
  getTopicOccurrences?: (episode: any) => Array<{
    positionSec: number;
    durationSec?: number | null;
    topic?: string | null;
  }>;
  playEpisodeAt: (episodeNumber: number, positionSec: number, label: string) => void;
  formatOccurrenceLabel: (occ: any) => string;
  formatHmsFromSeconds: (seconds: number) => string;
  formatDuration: (duration: string | [number, number, number] | undefined) => string;
  themeColor?: 'blue' | 'purple';
  showPlayButton?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  themeColor: 'purple',
  showPlayButton: true,
  loadingEpisodes: false,
});
</script>

