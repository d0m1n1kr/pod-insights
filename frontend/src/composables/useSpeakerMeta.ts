// Composable for loading and managing speaker metadata with index support
import { ref, computed } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { getSpeakerMetaUrl, getSpeakerImageUrl, loadSpeakerIndex } from './usePodcast';

export type SpeakerMeta = {
  name: string;
  slug: string;
  image?: string; // Local image filename or external URL
  imageUrl?: string; // Resolved URL (local/CDN or external)
};

// Global cache for speaker metadata (shared across components)
const speakersMetaCache = new Map<string, SpeakerMeta>();

/**
 * Helper to convert speaker name to slug
 */
export function speakerNameToSlug(name: string): string {
  return name.toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Load speaker index if not already loaded
 * Uses cached version from usePodcast.ts (per podcast ID)
 */
async function ensureSpeakerIndex(podcastId?: string): Promise<Map<string, { slug: string; name: string; hasImage: boolean; imageFile?: string }> | null> {
  return await loadSpeakerIndex(podcastId);
}

/**
 * Check if a speaker exists using the index
 */
export async function speakerExists(speakerName: string, podcastId?: string): Promise<boolean> {
  const index = await ensureSpeakerIndex(podcastId);
  
  if (!index) {
    // Index doesn't exist, assume speaker might exist (fallback behavior)
    return true;
  }
  
  const slug = speakerNameToSlug(speakerName);
  return index.has(slug);
}

/**
 * Get speaker image URL, handling both local and external images
 */
function resolveSpeakerImageUrl(image: string | undefined, slug: string, podcastId?: string): string | undefined {
  if (!image) return undefined;
  
  // If it's already a full URL (http/https), return as-is
  if (image.startsWith('http://') || image.startsWith('https://')) {
    return image;
  }
  
  // Otherwise, it's a local filename - use CDN-aware URL
  return getSpeakerImageUrl(slug, image, podcastId);
}

/**
 * Load speaker metadata with index support
 * Uses index-meta.json to avoid 404 requests for non-existent speakers
 */
export async function loadSpeakerMeta(
  speakerName: string,
  podcastId?: string
): Promise<SpeakerMeta | null> {
  const cacheKey = `${podcastId || 'default'}:${speakerName}`;
  
  // Check cache first
  if (speakersMetaCache.has(cacheKey)) {
    return speakersMetaCache.get(cacheKey) || null;
  }
  
  // Load index to check if speaker exists
  const index = await ensureSpeakerIndex(podcastId);
  
  const slug = speakerNameToSlug(speakerName);
  
  // Check index first
  if (index && !index.has(slug)) {
    // Speaker doesn't exist according to index, don't make request
    return null;
  }
  
  try {
    const url = getSpeakerMetaUrl(slug, podcastId);
    const res = await fetch(url, { cache: 'force-cache' });
    
    if (!res.ok) {
      // Speaker doesn't exist
      return null;
    }
    
    const data = await res.json();
    
    if (data && typeof data.name === 'string') {
      const meta: SpeakerMeta = {
        name: data.name,
        slug: data.slug || slug,
        image: data.image || undefined,
        imageUrl: resolveSpeakerImageUrl(data.image, slug, podcastId)
      };
      
      speakersMetaCache.set(cacheKey, meta);
      return meta;
    }
  } catch {
    // Silent fail - speaker might not exist
  }
  
  return null;
}

/**
 * Composable for managing speaker metadata in components
 */
export function useSpeakerMeta() {
  const settings = useSettingsStore();
  const speakersMeta = ref<Map<string, SpeakerMeta>>(new Map());
  
  /**
   * Load metadata for a single speaker
   */
  const loadSpeaker = async (speakerName: string) => {
    if (speakersMeta.value.has(speakerName)) return;
    
    const meta = await loadSpeakerMeta(speakerName, settings.selectedPodcast);
    if (meta) {
      speakersMeta.value.set(speakerName, meta);
    }
  };
  
  /**
   * Load metadata for multiple speakers
   */
  const loadSpeakers = async (speakerNames: string[]) => {
    const uniqueNames = Array.from(new Set(speakerNames));
    await Promise.all(uniqueNames.map(name => loadSpeaker(name)));
  };
  
  /**
   * Get speaker image URL
   */
  const getSpeakerImage = (speakerName: string): string | undefined => {
    return speakersMeta.value.get(speakerName)?.imageUrl;
  };
  
  /**
   * Get speaker metadata
   */
  const getSpeakerMeta = (speakerName: string): SpeakerMeta | undefined => {
    return speakersMeta.value.get(speakerName);
  };
  
  return {
    speakersMeta: computed(() => speakersMeta.value),
    loadSpeaker,
    loadSpeakers,
    getSpeakerImage,
    getSpeakerMeta
  };
}

