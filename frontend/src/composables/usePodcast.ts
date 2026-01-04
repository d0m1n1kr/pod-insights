// Composable for podcast-specific paths and data
import { computed } from 'vue';
import { useSettingsStore, type Podcast } from '@/stores/settings';

// Re-export Podcast type for convenience
export type { Podcast };

/**
 * Get the CDN base URL from environment variable
 * If VITE_CDN_BASE_URL is set, use it; otherwise use local paths
 */
function getCdnBaseUrl(): string | null {
  const cdnBase = (import.meta.env.VITE_CDN_BASE_URL as string | undefined);
  if (cdnBase && cdnBase.trim()) {
    // Ensure it doesn't end with a slash (we'll add it when constructing paths)
    return cdnBase.trim().replace(/\/+$/, '');
  }
  return null;
}

/**
 * Get the base path for a podcast's data files
 */
export function usePodcastPath() {
  const settings = useSettingsStore();
  const cdnBase = getCdnBaseUrl();
  
  const podcastPath = computed(() => {
    const podcastId = settings.selectedPodcast || 'freakshow';
    if (cdnBase) {
      return `${cdnBase}/podcasts/${podcastId}`;
    }
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
 * Supports configurable CDN via VITE_CDN_BASE_URL environment variable
 * 
 * Examples:
 * - Local: /podcasts/freakshow/episodes.json
 * - GitHub CDN: https://raw.githubusercontent.com/user/repo/branch/frontend/public/podcasts/freakshow/episodes.json
 */
export function getPodcastFileUrl(filename: string, podcastId?: string): string {
  const settings = useSettingsStore();
  const pid = podcastId || settings.selectedPodcast || 'freakshow';
  const cdnBase = getCdnBaseUrl();
  
  if (cdnBase) {
    return `${cdnBase}/podcasts/${pid}/${filename}`;
  }
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
 * Supports configurable CDN via VITE_CDN_BASE_URL environment variable
 */
export function getSpeakersBaseUrl(podcastId?: string): string {
  const settings = useSettingsStore();
  const pid = podcastId || settings.selectedPodcast || 'freakshow';
  const cdnBase = getCdnBaseUrl();
  
  if (cdnBase) {
    return `${cdnBase}/podcasts/${pid}/speakers`;
  }
  return `/podcasts/${pid}/speakers`;
}

/**
 * Get URL for episode image file
 * Returns URL for jpg format (most common). 
 * Note: Images are saved with various extensions (jpg, png, jpeg, webp) by scrape-images.js.
 * Components should handle missing images gracefully with @error handlers.
 * 
 * To get episode images, run: node scripts/scrape-images.js --podcast <podcastId>
 */
export function getEpisodeImageUrl(episodeNumber: number, podcastId?: string): string {
  const settings = useSettingsStore();
  const pid = podcastId || settings.selectedPodcast || 'freakshow';
  const cdnBase = getCdnBaseUrl();
  
  if (cdnBase) {
    return `${cdnBase}/podcasts/${pid}/episodes/${episodeNumber}.jpg`;
  }
  // Try jpg first (most common format)
  // If the image doesn't exist or has a different extension, the @error handler will hide it
  return `/podcasts/${pid}/episodes/${episodeNumber}.jpg`;
}

/**
 * Get URL for podcasts.json file
 * Supports configurable CDN via VITE_CDN_BASE_URL environment variable
 */
export function getPodcastsJsonUrl(): string {
  const cdnBase = getCdnBaseUrl();
  if (cdnBase) {
    return `${cdnBase}/podcasts.json`;
  }
  return '/podcasts.json';
}

/**
 * Get URL for version.json file
 * Supports configurable CDN via VITE_CDN_BASE_URL environment variable
 */
export function getVersionJsonUrl(): string {
  const cdnBase = getCdnBaseUrl();
  if (cdnBase) {
    return `${cdnBase}/version.json`;
  }
  return '/version.json';
}

/**
 * Get URL for logo.svg file
 * Supports configurable CDN via VITE_CDN_BASE_URL environment variable
 */
export function getLogoUrl(): string {
  const cdnBase = getCdnBaseUrl();
  if (cdnBase) {
    return `${cdnBase}/logo.svg`;
  }
  return '/logo.svg';
}

/**
 * Get URL for dominik-profile.png file
 * Supports configurable CDN via VITE_CDN_BASE_URL environment variable
 */
export function getDominikProfileUrl(): string {
  const cdnBase = getCdnBaseUrl();
  if (cdnBase) {
    return `${cdnBase}/dominik-profile.png`;
  }
  return '/dominik-profile.png';
}

