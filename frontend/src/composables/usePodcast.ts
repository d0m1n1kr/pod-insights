// Composable for podcast-specific paths and data
import { computed } from 'vue';
import { useSettingsStore, type Podcast } from '@/stores/settings';

// Re-export Podcast type for convenience
export type { Podcast };

/**
 * Get the base path for a podcast's data files
 */
export function usePodcastPath() {
  const settings = useSettingsStore();
  
  const podcastPath = computed(() => {
    const podcastId = settings.selectedPodcast || 'freakshow';
    return `/podcasts/${podcastId}`;
  });
  
  const podcastId = computed(() => settings.selectedPodcast || 'freakshow');
  
  return {
    podcastPath,
    podcastId
  };
}

/**
 * Load podcast-specific data file
 */
export async function loadPodcastData<T>(filename: string): Promise<T> {
  const { podcastPath } = usePodcastPath();
  const url = `${podcastPath.value}/${filename}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error loading podcast data from ${url}:`, error);
    throw error;
  }
}

/**
 * Get URL for a podcast-specific file
 */
export function getPodcastFileUrl(filename: string, podcastId?: string): string {
  const settings = useSettingsStore();
  const pid = podcastId || settings.selectedPodcast || 'freakshow';
  return `/podcasts/${pid}/${filename}`;
}

/**
 * Get URL for episode JSON file
 */
export function getEpisodeUrl(episodeNumber: number, podcastId?: string): string {
  return getPodcastFileUrl(`episodes/${episodeNumber}.json`, podcastId);
}

/**
 * Get URL for speaker meta JSON file
 */
export function getSpeakerMetaUrl(slug: string, podcastId?: string): string {
  return getPodcastFileUrl(`speakers/${slug}-meta.json`, podcastId);
}

/**
 * Get base URL for speakers directory
 */
export function getSpeakersBaseUrl(podcastId?: string): string {
  const settings = useSettingsStore();
  const pid = podcastId || settings.selectedPodcast || 'freakshow';
  return `/podcasts/${pid}/speakers`;
}

