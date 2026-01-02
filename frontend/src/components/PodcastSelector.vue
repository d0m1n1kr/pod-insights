<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { useI18n } from 'vue-i18n';

const settings = useSettingsStore();
const { t } = useI18n();

interface Podcast {
  id: string;
  name: string;
}

const podcasts = ref<Podcast[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const response = await fetch('/podcasts.json');
    if (response.ok) {
      const data = await response.json();
      podcasts.value = data.podcasts || [];
      // Set default podcast if not set
      if (!settings.selectedPodcast && podcasts.value.length > 0) {
        const firstPodcast = podcasts.value[0];
        if (firstPodcast) {
          settings.setSelectedPodcast(firstPodcast.id);
        }
      }
    }
  } catch (error) {
    console.error('Failed to load podcasts:', error);
    // Fallback to default
    podcasts.value = [{ id: 'freakshow', name: 'Freak Show' }];
    if (!settings.selectedPodcast) {
      settings.setSelectedPodcast('freakshow');
    }
  } finally {
    loading.value = false;
  }
});

const handleChange = (event: Event) => {
  const target = event.target as HTMLSelectElement;
  settings.setSelectedPodcast(target.value);
};
</script>

<template>
  <select
    v-if="!loading && podcasts.length > 1"
    :value="settings.selectedPodcast"
    @change="handleChange"
    class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
    :title="t('podcast.select')"
  >
    <option v-for="podcast in podcasts" :key="podcast.id" :value="podcast.id">
      {{ podcast.name }}
    </option>
  </select>
</template>

