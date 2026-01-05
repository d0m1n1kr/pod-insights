import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { useSettingsStore } from '../stores/settings';

const backendBase = (): string => {
  // In production we assume a reverse proxy and always use relative URLs.
  if ((import.meta as any)?.env?.PROD) return '';

  // In dev, allow overriding the backend URL (or fall back to local dev server).
  const v = (import.meta as any)?.env?.VITE_RAG_BACKEND_URL;
  const s = typeof v === 'string' ? v.trim() : '';
  return (s || 'http://127.0.0.1:7878').replace(/\/+$/, '');
};

interface TrackRequest {
  path: string;
  route_name?: string;
  podcast?: string;
  episode?: string;
  referrer?: string;
  user_agent?: string;
}

interface TrackEpisodePlayRequest {
  podcast: string;
  episode: string;
  user_agent?: string;
}

let lastTrackedPath: string | null = null;
const trackingEnabled = ref(true);

/**
 * Track a page view
 */
export async function trackPageView(routeName?: string, podcast?: string, episode?: string) {
  if (!trackingEnabled.value) return;

  const route = useRoute();
  const path = route.fullPath;
  
  // Avoid duplicate tracking for the same path
  if (lastTrackedPath === path) return;
  lastTrackedPath = path;

  const settings = useSettingsStore();
  const effectivePodcast = podcast || settings.selectedPodcast || route.query.podcast as string;
  
  // Extract episode number from route if not provided
  let episodeNumber: string | undefined = episode;
  if (!episodeNumber) {
    // Try to extract from query params or path
    const episodeFromQuery = route.query.episode as string | undefined;
    if (episodeFromQuery) {
      episodeNumber = episodeFromQuery;
    } else {
      // Try to extract from path (e.g., /episode-search?episode=123)
      const match = path.match(/[?&]episode=(\d+)/);
      if (match) {
        episodeNumber = match[1];
      }
    }
  }

  const trackData: TrackRequest = {
    path,
    route_name: routeName || (route.name as string | undefined),
    podcast: effectivePodcast,
    episode: episodeNumber,
    referrer: document.referrer || undefined,
    user_agent: navigator.userAgent,
  };

  try {
    const url = backendBase() ? `${backendBase()}/api/analytics/track` : '/api/analytics/track';
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(trackData),
      // Don't wait for response, fire and forget
      keepalive: true,
    });
  } catch (error) {
    // Silently fail - analytics should not break the app
    console.debug('Analytics tracking failed:', error);
  }
}

/**
 * Track an episode play
 */
export async function trackEpisodePlay(podcast: string, episode: string) {
  if (!trackingEnabled.value) return;

  const trackData: TrackEpisodePlayRequest = {
    podcast,
    episode,
    user_agent: navigator.userAgent,
  };

  try {
    const url = backendBase() ? `${backendBase()}/api/analytics/track-episode-play` : '/api/analytics/track-episode-play';
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(trackData),
      // Don't wait for response, fire and forget
      keepalive: true,
    });
  } catch (error) {
    // Silently fail - analytics should not break the app
    console.debug('Episode play tracking failed:', error);
  }
}

/**
 * Composable for analytics tracking
 */
export function useAnalytics() {
  return {
    trackPageView,
    trackEpisodePlay,
    trackingEnabled,
  };
}

