// Composable for lazy loading and caching episode details
import { ref, type Ref } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { getEpisodeUrl } from './usePodcast';

export type EpisodeDetail = {
  title: string;
  date?: string;
  duration?: number | number[]; // Can be total seconds or [hours, minutes, seconds]
  speakers?: string[];
  description?: string;
  url?: string;
  number?: number;
  [key: string]: any; // Allow additional fields
};

// Global cache for episode details (shared across all components)
const episodeCache = new Map<string, EpisodeDetail | null>();
const loadingPromises = new Map<string, Promise<EpisodeDetail | null>>();

/**
 * Get cache key for episode (includes podcast ID to avoid conflicts)
 */
function getCacheKey(episodeNumber: number, podcastId: string): string {
  return `${podcastId}:${episodeNumber}`;
}

/**
 * Load episode details with caching
 */
export async function loadEpisodeDetail(
  episodeNumber: number,
  podcastId?: string
): Promise<EpisodeDetail | null> {
  const settings = useSettingsStore();
  const pid = podcastId || settings.selectedPodcast || 'freakshow';
  const cacheKey = getCacheKey(episodeNumber, pid);

  // Return cached value if available
  if (episodeCache.has(cacheKey)) {
    return episodeCache.get(cacheKey) ?? null;
  }

  // Return existing promise if already loading
  if (loadingPromises.has(cacheKey)) {
    return loadingPromises.get(cacheKey)!;
  }

  // Start loading
  const promise = (async () => {
    try {
      const response = await fetch(getEpisodeUrl(episodeNumber, pid), {
        cache: 'force-cache', // Use browser cache when available
      });

      if (!response.ok) {
        episodeCache.set(cacheKey, null);
        return null;
      }

      const data = await response.json();
      
      // Normalize duration to total seconds if it's an array
      let durationInSeconds: number | undefined;
      if (Array.isArray(data.duration) && data.duration.length === 3) {
        const [h, m, s] = data.duration;
        durationInSeconds = h * 3600 + m * 60 + s;
      } else if (typeof data.duration === 'number') {
        durationInSeconds = data.duration;
      }

      const episodeDetail: EpisodeDetail = {
        title: data.title || '',
        date: data.date,
        duration: durationInSeconds ?? data.duration,
        speakers: data.speakers || [],
        description: data.description,
        url: data.url,
        number: data.number ?? episodeNumber,
        ...data, // Include any additional fields
      };

      episodeCache.set(cacheKey, episodeDetail);
      return episodeDetail;
    } catch (error) {
      console.error(`Failed to load episode ${episodeNumber}:`, error);
      episodeCache.set(cacheKey, null);
      return null;
    } finally {
      loadingPromises.delete(cacheKey);
    }
  })();

  loadingPromises.set(cacheKey, promise);
  return promise;
}

/**
 * Preload multiple episode details (useful for visible episodes)
 */
export async function preloadEpisodeDetails(
  episodeNumbers: number[],
  podcastId?: string
): Promise<void> {
  const settings = useSettingsStore();
  const pid = podcastId || settings.selectedPodcast || 'freakshow';
  
  // Filter out already cached episodes
  const toLoad = episodeNumbers.filter(num => {
    const cacheKey = getCacheKey(num, pid);
    return !episodeCache.has(cacheKey) && !loadingPromises.has(cacheKey);
  });

  // Load in parallel (but limit concurrency)
  const batchSize = 10;
  for (let i = 0; i < toLoad.length; i += batchSize) {
    const batch = toLoad.slice(i, i + batchSize);
    await Promise.all(batch.map(num => loadEpisodeDetail(num, pid)));
  }
}

/**
 * Clear cache (useful when switching podcasts)
 */
export function clearEpisodeCache(podcastId?: string): void {
  if (podcastId) {
    // Clear only entries for this podcast
    const keysToDelete: string[] = [];
    for (const key of episodeCache.keys()) {
      if (key.startsWith(`${podcastId}:`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => episodeCache.delete(key));
  } else {
    // Clear all
    episodeCache.clear();
  }
  loadingPromises.clear();
}

/**
 * Get cached episode detail (synchronous, returns undefined if not cached)
 */
export function getCachedEpisodeDetail(
  episodeNumber: number,
  podcastId?: string
): EpisodeDetail | null | undefined {
  const settings = useSettingsStore();
  const pid = podcastId || settings.selectedPodcast || 'freakshow';
  const cacheKey = getCacheKey(episodeNumber, pid);
  return episodeCache.get(cacheKey);
}

/**
 * Composable for lazy loading episode details with Intersection Observer
 */
export function useLazyEpisodeDetails() {
  const settings = useSettingsStore();
  const loadedEpisodes = ref<Set<number>>(new Set());
  const loadingEpisodes = ref<Set<number>>(new Set());

  /**
   * Setup Intersection Observer for lazy loading
   */
  function setupLazyLoad(
    elementRef: Ref<HTMLElement | undefined> | HTMLElement | null,
    episodeNumber: number,
    onLoad?: (detail: EpisodeDetail | null) => void
  ): () => void {
    const element = elementRef instanceof HTMLElement 
      ? elementRef 
      : (elementRef as Ref<HTMLElement | undefined>)?.value;

    if (!element) {
      // Element not available yet, try to load immediately
      if (!loadedEpisodes.value.has(episodeNumber) && !loadingEpisodes.value.has(episodeNumber)) {
        loadingEpisodes.value.add(episodeNumber);
        loadEpisodeDetail(episodeNumber)
          .then(detail => {
            loadedEpisodes.value.add(episodeNumber);
            loadingEpisodes.value.delete(episodeNumber);
            onLoad?.(detail);
          })
          .catch(() => {
            loadingEpisodes.value.delete(episodeNumber);
          });
      }
      return () => {}; // No cleanup needed
    }

    // Check if already loaded
    const pid = settings.selectedPodcast || 'freakshow';
    const cacheKey = getCacheKey(episodeNumber, pid);
    if (episodeCache.has(cacheKey)) {
      loadedEpisodes.value.add(episodeNumber);
      onLoad?.(episodeCache.get(cacheKey) ?? null);
      return () => {}; // No cleanup needed
    }

    // Setup Intersection Observer
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Element is visible, load episode details
            if (!loadedEpisodes.value.has(episodeNumber) && !loadingEpisodes.value.has(episodeNumber)) {
              loadingEpisodes.value.add(episodeNumber);
              loadEpisodeDetail(episodeNumber)
                .then((detail) => {
                  loadedEpisodes.value.add(episodeNumber);
                  loadingEpisodes.value.delete(episodeNumber);
                  onLoad?.(detail);
                })
                .catch(() => {
                  loadingEpisodes.value.delete(episodeNumber);
                });
            }
            // Stop observing once loaded
            observer.unobserve(entry.target);
          }
        });
      },
      {
        rootMargin: '100px', // Start loading 100px before element becomes visible
      }
    );

    observer.observe(element);

    // Return cleanup function
    return () => {
      observer.disconnect();
    };
  }

  /**
   * Preload visible episodes (for initial render)
   */
  async function preloadVisible(episodeNumbers: number[]): Promise<void> {
    await preloadEpisodeDetails(episodeNumbers);
    episodeNumbers.forEach(num => loadedEpisodes.value.add(num));
  }

  return {
    loadedEpisodes,
    loadingEpisodes,
    setupLazyLoad,
    preloadVisible,
    loadEpisodeDetail,
    getCachedEpisodeDetail,
  };
}

// Note: Cache clearing on podcast change should be handled by components
// to avoid issues with composable initialization order

