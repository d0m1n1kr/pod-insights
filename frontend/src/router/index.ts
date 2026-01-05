import { createRouter, createWebHistory } from 'vue-router';
import { useSettingsStore } from '../stores/settings';

// Lazy load views for code splitting
const TopicsView = () => import('../views/TopicsView.vue');
const SubjectsView = () => import('../views/SubjectsView.vue');
const SpeakersView = () => import('../views/SpeakersView.vue');
const ClusterHeatmapView = () => import('../views/ClusterHeatmapView.vue');
const SpeakerSpeakerHeatmapView = () => import('../views/SpeakerSpeakerHeatmapView.vue');
const ClusterClusterHeatmapView = () => import('../views/ClusterClusterHeatmapView.vue');
const DurationHeatmapView = () => import('../views/DurationHeatmapView.vue');
const UmapView = () => import('../views/UmapView.vue');
const AboutView = () => import('../views/AboutView.vue');
const SearchView = () => import('../views/SearchView.vue');
const EpisodeView = () => import('../views/EpisodeView.vue');

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/episode-search'
    },
    {
      path: '/clusters-river',
      name: 'clusters-river',
      component: TopicsView
    },
    {
      path: '/subjects-river',
      name: 'subjects-river',
      component: SubjectsView
    },
    {
      path: '/episode-search',
      name: 'episodeSearch',
      component: EpisodeView
    },
    {
      path: '/speakers-river',
      name: 'speakers-river',
      component: SpeakersView
    },
    {
      path: '/cluster-heatmap',
      name: 'cluster-heatmap',
      component: ClusterHeatmapView
    },
    {
      path: '/speaker-speaker-heatmap',
      name: 'speaker-speaker-heatmap',
      component: SpeakerSpeakerHeatmapView
    },
    {
      path: '/cluster-cluster-heatmap',
      name: 'cluster-cluster-heatmap',
      component: ClusterClusterHeatmapView
    },
    {
      path: '/duration-heatmap',
      name: 'duration-heatmap',
      component: DurationHeatmapView
    },
    {
      path: '/search',
      name: 'search',
      component: SearchView
    },
    {
      path: '/umap',
      name: 'umap',
      component: UmapView
    },
    {
      path: '/about',
      name: 'about',
      component: AboutView
    }
  ]
});

// Router guard to ensure podcast parameter is always in URL
router.beforeEach((to, _from, next) => {
  const settingsStore = useSettingsStore();
  const currentPodcast = to.query.podcast as string | undefined;
  
  // If podcast is in URL, update store
  if (currentPodcast) {
    if (settingsStore.selectedPodcast !== currentPodcast) {
      settingsStore.setSelectedPodcast(currentPodcast);
    }
  } else {
    // If no podcast in URL, add it from store (or default)
    const podcastId = settingsStore.selectedPodcast || 'freakshow';
    next({
      ...to,
      query: {
        ...to.query,
        podcast: podcastId,
      },
    });
    return;
  }
  
  // Get podcast config for the current podcast (use currentPodcast from URL, not store)
  const effectivePodcastId = currentPodcast || settingsStore.selectedPodcast || 'freakshow';
  const podcast = settingsStore.availablePodcasts.find(p => p.id === effectivePodcastId);
  
  // Check if search is disabled for current podcast
  if (to.name === 'search' && podcast?.disableSearch) {
    // Redirect to episodes tab if search is disabled
    next({
      name: 'episodeSearch',
      query: to.query,
      replace: true, // Replace history entry so back button doesn't go to search
    });
    return;
  }
  
  // Check if speaker routes are disabled for current podcast
  const speakerRoutes = ['speakers-river', 'cluster-heatmap', 'cluster-cluster-heatmap', 'speaker-speaker-heatmap'];
  if (to.name && typeof to.name === 'string' && speakerRoutes.includes(to.name) && podcast?.disableSpeakers) {
    // Redirect to episode search if speaker tabs are disabled
    next({
      name: 'episodeSearch',
      query: to.query,
      replace: true,
    });
    return;
  }
  
  next();
});

export default router;

