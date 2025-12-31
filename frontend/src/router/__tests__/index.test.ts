import { describe, it, expect } from 'vitest';
import { createRouter, createMemoryHistory } from 'vue-router';
import router from '../index';

const routes = router.options.routes;

// Create a test router instance
function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes
  });
}

describe('Router Configuration', () => {
  it('should have all expected routes', () => {
    expect(routes).toBeDefined();
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);
  });

  it('should have root redirect to clusters', () => {
    const rootRoute = routes.find(r => r.path === '/');
    expect(rootRoute).toBeDefined();
    expect(rootRoute?.redirect).toBe('/clusters');
  });

  it('should have clusters route', () => {
    const clustersRoute = routes.find(r => r.path === '/clusters');
    expect(clustersRoute).toBeDefined();
    expect(clustersRoute?.name).toBe('clusters');
  });

  it('should have speakers route', () => {
    const speakersRoute = routes.find(r => r.path === '/speakers');
    expect(speakersRoute).toBeDefined();
    expect(speakersRoute?.name).toBe('speakers');
  });

  it('should have search route', () => {
    const searchRoute = routes.find(r => r.path === '/search');
    expect(searchRoute).toBeDefined();
    expect(searchRoute?.name).toBe('search');
  });

  it('should have heatmap routes', () => {
    const clusterHeatmap = routes.find(r => r.path === '/cluster-heatmap');
    const clusterClusterHeatmap = routes.find(r => r.path === '/cluster-cluster-heatmap');
    const speakerSpeakerHeatmap = routes.find(r => r.path === '/speaker-speaker-heatmap');
    const durationHeatmap = routes.find(r => r.path === '/duration-heatmap');
    
    expect(clusterHeatmap).toBeDefined();
    expect(clusterClusterHeatmap).toBeDefined();
    expect(speakerSpeakerHeatmap).toBeDefined();
    expect(durationHeatmap).toBeDefined();
  });

  it('should have about route', () => {
    const aboutRoute = routes.find(r => r.path === '/about');
    expect(aboutRoute).toBeDefined();
    expect(aboutRoute?.name).toBe('about');
  });

  it('should have unique route names', () => {
    const names = routes
      .map(r => r.name)
      .filter(name => name !== undefined);
    
    const uniqueNames = new Set(names);
    expect(names.length).toBe(uniqueNames.size);
  });

  it('should have unique route paths', () => {
    const paths = routes
      .map(r => r.path)
      .filter(path => path !== '/'); // Exclude redirect
    
    const uniquePaths = new Set(paths);
    expect(paths.length).toBe(uniquePaths.size);
  });

  describe('Route Navigation', () => {
    it('should navigate to clusters', async () => {
      const router = createTestRouter();
      await router.push('/clusters');
      
      expect(router.currentRoute.value.path).toBe('/clusters');
      expect(router.currentRoute.value.name).toBe('clusters');
    });

    it('should navigate to speakers', async () => {
      const router = createTestRouter();
      await router.push('/speakers');
      
      expect(router.currentRoute.value.path).toBe('/speakers');
      expect(router.currentRoute.value.name).toBe('speakers');
    });

    it('should redirect from root to clusters', async () => {
      const router = createTestRouter();
      await router.push('/');
      
      expect(router.currentRoute.value.path).toBe('/clusters');
    });

    it('should handle search with query parameters', async () => {
      const router = createTestRouter();
      await router.push({ path: '/search', query: { q: 'test query' } });
      
      expect(router.currentRoute.value.path).toBe('/search');
      expect(router.currentRoute.value.query.q).toBe('test query');
    });
  });

  describe('Route Components', () => {
    it('should have components defined', () => {
      const clustersRoute = routes.find(r => r.path === '/clusters');
      expect(clustersRoute?.component).toBeDefined();
      // Components are imported directly, not lazy-loaded
      expect(typeof clustersRoute?.component).toBe('object');
    });

    it('should load all route components', () => {
      routes.forEach(route => {
        if (route.path !== '/') { // Skip redirect
          expect(route.component).toBeDefined();
        }
      });
    });
  });

  describe('Route Meta', () => {
    it('should have consistent meta structure', () => {
      routes.forEach(route => {
        if (route.meta) {
          expect(typeof route.meta).toBe('object');
        }
      });
    });
  });
});

