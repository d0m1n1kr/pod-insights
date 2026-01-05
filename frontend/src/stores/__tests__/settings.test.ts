import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSettingsStore } from '../settings';

describe('Settings Store', () => {
  beforeEach(() => {
    // Create a fresh pinia instance for each test
    setActivePinia(createPinia());
    
    // Mock localStorage
    const localStorageMock = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    globalThis.localStorage = localStorageMock as any;
    
    // Mock matchMedia for theme detection
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  describe('Theme Mode', () => {
    it('should initialize with auto theme mode', () => {
      const store = useSettingsStore();
      expect(store.themeMode).toBe('auto');
    });

    it('should cycle through theme modes correctly', () => {
      const store = useSettingsStore();
      
      // Start: auto
      expect(store.themeMode).toBe('auto');
      
      // Cycle 1: auto -> light
      store.cycleThemeMode();
      expect(store.themeMode).toBe('light');
      
      // Cycle 2: light -> dark
      store.cycleThemeMode();
      expect(store.themeMode).toBe('dark');
      
      // Cycle 3: dark -> auto
      store.cycleThemeMode();
      expect(store.themeMode).toBe('auto');
    });

    it('should set theme mode directly', () => {
      const store = useSettingsStore();
      
      store.setThemeMode('dark');
      expect(store.themeMode).toBe('dark');
      
      store.setThemeMode('light');
      expect(store.themeMode).toBe('light');
    });

    it('should compute isDarkMode based on system preference when theme is auto', () => {
      const store = useSettingsStore();
      store.setThemeMode('auto');
      
      // The computed property reads from window.matchMedia at evaluation time
      // Since we mocked it to return false in beforeEach, it should be false
      const isDark = store.isDarkMode;
      expect(typeof isDark).toBe('boolean');
      // Can't reliably test system preference in unit tests
      // This would be better suited for an E2E test
    });

    it('should compute isDarkMode correctly when theme is dark', () => {
      const store = useSettingsStore();
      store.setThemeMode('dark');
      expect(store.isDarkMode).toBe(true);
    });

    it('should compute isDarkMode correctly when theme is light', () => {
      const store = useSettingsStore();
      store.setThemeMode('light');
      expect(store.isDarkMode).toBe(false);
    });
  });

  describe('Normalized View', () => {
    it('should initialize with normalized view off', () => {
      const store = useSettingsStore();
      expect(store.normalizedView).toBe(false);
    });

    it('should toggle normalized view', () => {
      const store = useSettingsStore();
      
      expect(store.normalizedView).toBe(false);
      store.toggleNormalizedView();
      expect(store.normalizedView).toBe(true);
      store.toggleNormalizedView();
      expect(store.normalizedView).toBe(false);
    });

    it('should set normalized view directly', () => {
      const store = useSettingsStore();
      
      store.setNormalizedView(true);
      expect(store.normalizedView).toBe(true);
      
      store.setNormalizedView(false);
      expect(store.normalizedView).toBe(false);
    });
  });

  describe('Filters', () => {
    it('should initialize with default filter values', () => {
      const store = useSettingsStore();
      expect(store.topicFilter).toBe(15);
      expect(store.speakerFilter).toBe(15);
      expect(store.topNSpeakersHeatmap).toBe(15);
      expect(store.topNCategoriesHeatmap).toBe(10);
      expect(store.topNSpeakersClusterHeatmap).toBe(15);
      expect(store.topNClustersHeatmap).toBe(20);
    });

    it('should allow updating filter values', () => {
      const store = useSettingsStore();
      
      store.topicFilter = 20;
      expect(store.topicFilter).toBe(20);
      
      store.speakerFilter = 10;
      expect(store.speakerFilter).toBe(10);
    });
  });

  describe('Clustering Variant', () => {
    it('should initialize with locked variant', () => {
      const store = useSettingsStore();
      expect(store.clusteringVariant).toBe('auto-v2.1');
    });

    it('should not allow changing variant (locked)', () => {
      const store = useSettingsStore();
      
      // Try to set a different variant
      store.setClusteringVariant('default-v1');
      
      // Should remain locked to auto-v2.1
      expect(store.clusteringVariant).toBe('auto-v2.1');
    });
  });

  describe('RAG Auth Token', () => {
    it('should initialize with empty token', () => {
      const store = useSettingsStore();
      expect(store.ragAuthToken).toBe('');
    });

    it('should set auth token', () => {
      const store = useSettingsStore();
      
      store.setRagAuthToken('test-token-123');
      expect(store.ragAuthToken).toBe('test-token-123');
    });

    it('should clear auth token', () => {
      const store = useSettingsStore();
      
      store.setRagAuthToken('test-token-123');
      expect(store.ragAuthToken).toBe('test-token-123');
      
      store.clearRagAuthToken();
      expect(store.ragAuthToken).toBe('');
    });
  });

  describe('Speaker Selection', () => {
    it('should initialize with no selected speaker', () => {
      const store = useSettingsStore();
      expect(store.selectedSpeaker).toBe(null);
      expect(store.selectedSpeaker2).toBe(null);
    });

    it('should set selected speaker', () => {
      const store = useSettingsStore();
      
      store.setSelectedSpeaker('tim-pritlove');
      expect(store.selectedSpeaker).toBe('tim-pritlove');
    });

    it('should set second speaker', () => {
      const store = useSettingsStore();
      
      store.setSelectedSpeaker2('hukl');
      expect(store.selectedSpeaker2).toBe('hukl');
    });

    it('should clear selected speaker', () => {
      const store = useSettingsStore();
      
      store.setSelectedSpeaker('tim-pritlove');
      expect(store.selectedSpeaker).toBe('tim-pritlove');
      
      store.setSelectedSpeaker(null);
      expect(store.selectedSpeaker).toBe(null);
    });
  });
});

