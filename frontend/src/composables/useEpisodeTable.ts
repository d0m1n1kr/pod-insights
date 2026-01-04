// Unified composable for episode table loading
// Handles priming, batch loading, filter changes, and cleanup consistently across all components
import { ref, nextTick, watch, onUnmounted, type Ref } from 'vue';
import { useInlineEpisodePlayer } from './useInlineEpisodePlayer';
import { loadEpisodeDetail, getCachedEpisodeDetail, type EpisodeDetail } from './useEpisodeDetails';
import { getEpisodeUrl, withBase } from './usePodcast';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const secondsToHmsTuple = (sec: unknown): [number, number, number] => {
  const s0 = Number.isFinite(sec as number) ? Math.max(0, Math.floor(sec as number)) : 0;
  const h = Math.floor(s0 / 3600);
  const m = Math.floor((s0 % 3600) / 60);
  const s = s0 % 60;
  return [h, m, s];
};

/**
 * Unified episode table loader that works consistently across all components
 * 
 * Features:
 * - Primes all rows immediately with episodes.json metadata
 * - Batch-loads full details in background (no scrolling required)
 * - Handles filter changes gracefully (preserves fallback data)
 * - Prevents race conditions with request tokens
 * - Never overwrites fallback data with null
 */
export function useEpisodeTable() {
  const inlinePlayer = useInlineEpisodePlayer();
  
  // Local episode details map (component-specific)
  const episodeDetails = ref<Map<number, EpisodeDetail | null>>(new Map());
  const loadingEpisodes = ref(false);
  const observerCleanups = ref<Map<number, () => void>>(new Map());
  
  // Request token to prevent stale updates when filters change rapidly
  let requestId = 0;
  
  /**
   * Load episode detail with retry (for transient failures)
   */
  const loadEpisodeDetailWithRetry = async (
    episodeNum: number,
    attempts: number,
    isStale: () => boolean
  ): Promise<EpisodeDetail | null> => {
    for (let i = 0; i < attempts; i++) {
      if (isStale()) return null;
      const detail = await loadEpisodeDetail(episodeNum);
      if (isStale()) return null;
      if (detail) return detail;
      if (i < attempts - 1) await sleep(150 * (i + 1));
    }
    return null;
  };

  /**
   * Load episode detail with no-store cache (bypass stale cache)
   */
  const loadEpisodeDetailNoStore = async (
    episodeNum: number,
    isStale: () => boolean
  ): Promise<EpisodeDetail | null> => {
    if (isStale()) return null;
    try {
      const res = await fetch(withBase(getEpisodeUrl(episodeNum)), { cache: 'no-store' });
      if (!res.ok) return null;
      
      // Check content-type to avoid parsing HTML as JSON
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return null;
      }
      
      const data = await res.json();
      if (!data || typeof data !== 'object') return null;
      
      const speakers = Array.isArray(data.speakers) ? data.speakers : [];
      return {
        ...data,
        number: data.number ?? episodeNum,
        title: data.title || '',
        date: data.date,
        duration: data.duration,
        speakers,
        url: data.url,
      } as EpisodeDetail;
    } catch {
      return null;
    }
  };

  /**
   * Setup episode table loading for a list of episode numbers
   * This is the main entry point - call this whenever the episode list changes
   */
  const setupEpisodeTable = async (episodeNumbers: number[]) => {
    // Increment request token to invalidate any in-flight requests
    const currentRequestId = ++requestId;
    const isStale = () => currentRequestId !== requestId;
    
    // Normalize and dedupe episode numbers
    const normalized = Array.from(new Set(episodeNumbers.map(n => Number(n)).filter(n => Number.isFinite(n))));
    
    if (normalized.length === 0) {
      loadingEpisodes.value = false;
      return;
    }

    loadingEpisodes.value = true;

    try {
      // Clean up observers for episodes that are no longer in the list
      const currentEpisodeSet = new Set(normalized);
      observerCleanups.value.forEach((cleanup, episodeNum) => {
        if (!currentEpisodeSet.has(episodeNum)) {
          cleanup();
          observerCleanups.value.delete(episodeNum);
        }
      });

      // Ensure MP3 index is loaded (for episodes.json metadata)
      await inlinePlayer.ensureMp3Index();
      if (isStale()) return;

      // STEP 1: Prime ALL rows immediately with episodes.json metadata
      // This ensures the table is fully populated right away, even if full details aren't loaded yet
      for (const episodeNum of normalized) {
        if (isStale()) return;
        
        const existing = episodeDetails.value.get(episodeNum);
        
        // If we already have full details (no _fallback), keep them
        if (existing && !(existing as any)?._fallback) {
          continue;
        }
        
        // If we have null (cached "not found"), always try to upgrade to fallback
        // This ensures that when filters change, episodes that were previously marked as "not found"
        // get another chance to show fallback data from episodes.json
        if (existing === null) {
          const meta = inlinePlayer.episodeMetaByEpisode.value.get(episodeNum);
          if (meta && (meta.title || meta.date || Number.isFinite(meta.durationSec as number) || meta.pageUrl || (Array.isArray(meta.speakers) && meta.speakers.length > 0))) {
            episodeDetails.value.set(episodeNum, {
              title: meta.title || `Episode ${episodeNum}`,
              date: meta.date,
              duration: typeof meta.durationSec === 'number' && Number.isFinite(meta.durationSec) ? meta.durationSec : undefined,
              speakers: Array.isArray(meta.speakers) ? meta.speakers : [],
              url: meta.pageUrl || undefined,
              number: episodeNum,
              _fallback: 'episodes.json',
            } as any);
          } else {
            // Even if no metadata, set minimal entry so we can show episode number
            // This prevents "Details nicht verfügbar" from showing when filter changes
            episodeDetails.value.set(episodeNum, {
              title: `Episode ${episodeNum}`,
              date: '',
              speakers: [],
              number: episodeNum,
              _fallback: 'minimal',
            } as any);
          }
          continue;
        }
        
        // If we don't have data yet OR if we have null (cached "not found"), prime with episodes.json metadata
        // This ensures that when filters change and new episodes are added, we always try to show fallback data
        if (!existing || existing === null) {
          const meta = inlinePlayer.episodeMetaByEpisode.value.get(episodeNum);
          if (meta && (meta.title || meta.date || Number.isFinite(meta.durationSec as number) || meta.pageUrl || (Array.isArray(meta.speakers) && meta.speakers.length > 0))) {
            episodeDetails.value.set(episodeNum, {
              title: meta.title || `Episode ${episodeNum}`,
              date: meta.date,
              duration: typeof meta.durationSec === 'number' && Number.isFinite(meta.durationSec) ? meta.durationSec : undefined,
              speakers: Array.isArray(meta.speakers) ? meta.speakers : [],
              url: meta.pageUrl || undefined,
              number: episodeNum,
              _fallback: 'episodes.json',
            } as any);
          } else {
            // Even if no metadata, set minimal entry so we can show episode number
            episodeDetails.value.set(episodeNum, {
              title: `Episode ${episodeNum}`,
              date: '',
              speakers: [],
              number: episodeNum,
              _fallback: 'minimal',
            } as any);
          }
        } else if ((existing as any)?._fallback === 'minimal') {
          // If we only have minimal data, try to upgrade to episodes.json metadata
          const meta = inlinePlayer.episodeMetaByEpisode.value.get(episodeNum);
          if (meta && (meta.title || meta.date || Number.isFinite(meta.durationSec as number) || meta.pageUrl || (Array.isArray(meta.speakers) && meta.speakers.length > 0))) {
            episodeDetails.value.set(episodeNum, {
              title: meta.title || `Episode ${episodeNum}`,
              date: meta.date,
              duration: typeof meta.durationSec === 'number' && Number.isFinite(meta.durationSec) ? meta.durationSec : undefined,
              speakers: Array.isArray(meta.speakers) ? meta.speakers : [],
              url: meta.pageUrl || undefined,
              number: episodeNum,
              _fallback: 'episodes.json',
            } as any);
          }
        } else if ((existing as any)?._fallback === 'episodes.json') {
          // If we have episodes.json fallback, update it with any missing data
          const meta = inlinePlayer.episodeMetaByEpisode.value.get(episodeNum);
          if (meta) {
            const updated: any = { ...existing };
            let needsUpdate = false;
            
            // Update date if missing
            if (!updated.date && meta.date) {
              updated.date = meta.date;
              needsUpdate = true;
            }
            
            // Update speakers if missing or empty
            if ((!Array.isArray(updated.speakers) || updated.speakers.length === 0) && Array.isArray(meta.speakers) && meta.speakers.length > 0) {
              updated.speakers = meta.speakers;
              needsUpdate = true;
            }
            
            if (needsUpdate) {
              episodeDetails.value.set(episodeNum, updated);
            }
          }
        } else if (!(existing as any)?._fallback) {
          // If we have full details (no fallback), check if speakers are missing and update from episodes.json
          const meta = inlinePlayer.episodeMetaByEpisode.value.get(episodeNum);
          if (meta && (!Array.isArray((existing as any).speakers) || (existing as any).speakers.length === 0) && Array.isArray(meta.speakers) && meta.speakers.length > 0) {
            // Update speakers from episodes.json if they're missing
            episodeDetails.value.set(episodeNum, {
              ...existing,
              speakers: meta.speakers,
            } as any);
          }
        }
      }

      // Wait for DOM to update
      await nextTick();
      await nextTick();
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (isStale()) return;

      // STEP 2: Batch-load full details for ALL episodes in background
      // This ensures all episodes eventually get full details, not just visible ones
      const toLoad = normalized.filter(episodeNum => {
        const cached = getCachedEpisodeDetail(episodeNum);
        if (cached !== undefined) {
          // If cache has real data, merge it with episodes.json data
          if (cached !== null) {
            const meta = inlinePlayer.episodeMetaByEpisode.value.get(episodeNum);
            // Merge cached data with episodes.json - ALWAYS prefer episodes.json for speakers
            const merged = {
              ...cached,
              // ALWAYS prefer speakers from episodes.json if available
              speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
                ? meta.speakers
                : (Array.isArray(cached.speakers) && cached.speakers.length > 0 ? cached.speakers : []),
            };
            episodeDetails.value.set(episodeNum, merged);
          }
          return false;
        }
        
        const current = episodeDetails.value.get(episodeNum);
        // Load if we have fallback/minimal/no entry; skip if already full details
        return !current || current === null || Boolean((current as any)?._fallback);
      });

      if (toLoad.length > 0) {
        const batchSize = 10;
        for (let i = 0; i < toLoad.length; i += batchSize) {
          if (isStale()) return;
          const batch = toLoad.slice(i, i + batchSize);
          await Promise.all(batch.map(async (episodeNum) => {
            if (isStale()) return;
            
            // Double-check cache (might have been loaded by another batch)
            const cached = getCachedEpisodeDetail(episodeNum);
            if (cached !== undefined) {
              // Only overwrite if cached is not null, or if current is null/minimal
              const current = episodeDetails.value.get(episodeNum);
              if (cached !== null || !current || current === null || Boolean((current as any)?._fallback)) {
                if (cached !== null) {
                  // Merge cached data with episodes.json - prefer episodes.json for speakers
                  const meta = inlinePlayer.episodeMetaByEpisode.value.get(episodeNum);
                  const merged = {
                    ...cached,
                    // Keep speakers from episodes.json if cached doesn't have them
                    speakers: (Array.isArray(cached.speakers) && cached.speakers.length > 0)
                      ? cached.speakers
                      : (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0 ? meta.speakers : []),
                  };
                  episodeDetails.value.set(episodeNum, merged);
                } else {
                  episodeDetails.value.set(episodeNum, cached);
                }
              }
              return;
            }

            // Try retry first
            const retried = await loadEpisodeDetailWithRetry(episodeNum, 2, isStale);
            if (isStale()) return;
            if (retried) {
              // Merge with episodes.json data - ALWAYS prefer episodes.json for speakers
              const meta = inlinePlayer.episodeMetaByEpisode.value.get(episodeNum);
              const merged = {
                ...retried,
                // ALWAYS prefer speakers from episodes.json if available
                speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
                  ? meta.speakers
                  : (Array.isArray(retried.speakers) && retried.speakers.length > 0 ? retried.speakers : []),
              };
              episodeDetails.value.set(episodeNum, merged);
              return;
            }

            // Try no-store as last resort
            const direct = await loadEpisodeDetailNoStore(episodeNum, isStale);
            if (isStale()) return;
            if (direct) {
              // Merge with episodes.json data - ALWAYS prefer episodes.json for speakers
              const meta = inlinePlayer.episodeMetaByEpisode.value.get(episodeNum);
              const merged = {
                ...direct,
                // ALWAYS prefer speakers from episodes.json if available
                speakers: (meta && Array.isArray(meta.speakers) && meta.speakers.length > 0)
                  ? meta.speakers
                  : (Array.isArray(direct.speakers) && direct.speakers.length > 0 ? direct.speakers : []),
              };
              episodeDetails.value.set(episodeNum, merged);
              return;
            }

            // If we still have nothing, keep existing fallback/minimal row (don't overwrite with null)
            const current = episodeDetails.value.get(episodeNum);
            if (!current || current === null) {
              // Only set null if we truly have no fallback data
              const meta = inlinePlayer.episodeMetaByEpisode.value.get(episodeNum);
              if (!meta || (!meta.title && !meta.date && !Number.isFinite(meta.durationSec as number) && !meta.pageUrl && (!Array.isArray(meta.speakers) || meta.speakers.length === 0))) {
                episodeDetails.value.set(episodeNum, null);
              }
            }
          }));
        }
      }
    } finally {
      // Only clear loading flag if this is still the latest request
      if (currentRequestId === requestId) {
        loadingEpisodes.value = false;
      }
    }
  };

  /**
   * Cleanup function to call on component unmount
   */
  const cleanup = () => {
    observerCleanups.value.forEach(cleanup => cleanup());
    observerCleanups.value.clear();
  };

  // Auto-cleanup on unmount
  onUnmounted(() => {
    cleanup();
  });

  return {
    episodeDetails,
    loadingEpisodes,
    setupEpisodeTable,
    cleanup,
  };
}

