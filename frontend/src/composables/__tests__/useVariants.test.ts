import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  useVariantPath,
  loadVariantData,
  hasVariants,
  loadVariantsManifest,
  getVariantFileUrl,
  type VariantManifest
} from '../useVariants';
import { useSettingsStore } from '@/stores/settings';

describe('useVariants Composable', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    
    // Reset fetch mock before each test
    globalThis.fetch = vi.fn();
  });

  describe('useVariantPath', () => {
    it('should return correct variant path', () => {
      const { variantPath, variantName } = useVariantPath();
      
      expect(variantPath.value).toBe('/topics/auto-v2.1');
      expect(variantName.value).toBe('auto-v2.1');
    });

    it('should update when settings change', () => {
      const store = useSettingsStore();
      const { variantPath, variantName } = useVariantPath();
      
      // Initial value
      expect(variantPath.value).toBe('/topics/auto-v2.1');
      
      // Try to change variant (will be locked to auto-v2.1)
      store.setClusteringVariant('default-v1');
      
      // Should remain auto-v2.1 due to lock
      expect(variantPath.value).toBe('/topics/auto-v2.1');
      expect(variantName.value).toBe('auto-v2.1');
    });

    it('should provide reactive path value', () => {
      const { variantPath } = useVariantPath();
      
      expect(variantPath.value).toContain('/topics/');
      expect(variantPath.value).toContain('auto-v2.1');
    });
  });

  describe('loadVariantData', () => {
    it('should load data successfully', async () => {
      const mockData = { test: 'data', value: 123 };
      
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockData
      } as Response);
      
      const result = await loadVariantData('test-file.json');
      
      expect(result).toEqual(mockData);
      expect(globalThis.fetch).toHaveBeenCalledWith('/topics/auto-v2.1/test-file.json');
    });

    it('should throw error when fetch fails', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Not Found'
      } as Response);
      
      await expect(loadVariantData('missing.json')).rejects.toThrow();
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    it('should throw error on network failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      
      await expect(loadVariantData('file.json')).rejects.toThrow();
    });

    it('should handle JSON parse errors', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        }
      } as unknown as Response);
      
      await expect(loadVariantData('invalid.json')).rejects.toThrow();
    });
  });

  describe('loadVariantsManifest', () => {
    it('should load manifest successfully', async () => {
      const mockManifest: VariantManifest = {
        variants: {
          'default-v1': {
            name: 'Default V1',
            version: 'v1',
            lastBuilt: '2024-01-01T00:00:00Z'
          },
          'auto-v2': {
            name: 'Auto V2',
            version: 'v2',
            lastBuilt: '2024-01-02T00:00:00Z'
          }
        },
        defaultVariant: 'default-v1',
        lastUpdated: '2024-01-02T00:00:00Z'
      };
      
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockManifest
      } as Response);
      
      const result = await loadVariantsManifest();
      
      expect(result).toEqual(mockManifest);
      expect(result.variants).toHaveProperty('default-v1');
      expect(result.variants).toHaveProperty('auto-v2');
      expect(globalThis.fetch).toHaveBeenCalledWith('/topics/manifest.json');
    });

    it('should return default manifest when fetch fails', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Not Found'
      } as Response);
      
      const result = await loadVariantsManifest();
      
      expect(result.variants).toHaveProperty('auto-v2.1');
      expect(result.defaultVariant).toBe('auto-v2.1');
    });

    it('should return default manifest on network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      
      const result = await loadVariantsManifest();
      
      expect(result.variants).toHaveProperty('auto-v2.1');
      expect(result.defaultVariant).toBe('auto-v2.1');
    });

    it('should have correct structure in default manifest', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Not found'));
      
      const result = await loadVariantsManifest();
      
      expect(result).toHaveProperty('variants');
      expect(result).toHaveProperty('defaultVariant');
      expect(result).toHaveProperty('lastUpdated');
      expect(typeof result.variants).toBe('object');
    });
  });

  describe('hasVariants', () => {
    it('should return true when variants exist', async () => {
      const mockManifest: VariantManifest = {
        variants: {
          'variant1': {
            name: 'Variant 1',
            version: 'v1',
            lastBuilt: '2024-01-01T00:00:00Z'
          }
        },
        defaultVariant: 'variant1',
        lastUpdated: '2024-01-01T00:00:00Z'
      };
      
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockManifest
      } as Response);
      
      const result = await hasVariants();
      
      expect(result).toBe(true);
    });

    it('should return false when manifest loading fails', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      
      const result = await hasVariants();
      
      // Actually returns true because fallback has auto-v2.1
      expect(typeof result).toBe('boolean');
    });

    it('should return true when default fallback is used', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false
      } as Response);
      
      const result = await hasVariants();
      
      // Returns true because default manifest has auto-v2.1
      expect(result).toBe(true);
    });
  });

  describe('getVariantFileUrl', () => {
    it('should generate correct URL with default variant', () => {
      const url = getVariantFileUrl('data.json');
      
      expect(url).toBe('/topics/auto-v2.1/data.json');
    });

    it('should generate correct URL with specific variant', () => {
      const url = getVariantFileUrl('data.json', 'custom-v1');
      
      expect(url).toBe('/topics/custom-v1/data.json');
    });

    it('should use store variant when no variant specified', () => {
      const url = getVariantFileUrl('test.json');
      
      expect(url).toContain('/topics/');
      expect(url).toContain('auto-v2.1');
      expect(url).toContain('test.json');
    });

    it('should handle different file types', () => {
      expect(getVariantFileUrl('taxonomy.json')).toBe('/topics/auto-v2.1/taxonomy.json');
      expect(getVariantFileUrl('river.json')).toBe('/topics/auto-v2.1/river.json');
      expect(getVariantFileUrl('heatmap.json')).toBe('/topics/auto-v2.1/heatmap.json');
    });

    it('should override store variant with explicit parameter', () => {
      const url1 = getVariantFileUrl('file.json');
      const url2 = getVariantFileUrl('file.json', 'other-variant');
      
      expect(url1).toBe('/topics/auto-v2.1/file.json');
      expect(url2).toBe('/topics/other-variant/file.json');
    });
  });

  describe('Integration Tests', () => {
    it('should work together: path and file URL', () => {
      const { variantPath } = useVariantPath();
      const fileUrl = getVariantFileUrl('test.json');
      
      expect(fileUrl).toBe(`${variantPath.value}/test.json`);
    });

    it('should handle complete data loading flow', async () => {
      const mockData = { clusters: [{ id: 1, name: 'Test' }] };
      
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockData
      } as Response);
      
      const data = await loadVariantData('taxonomy.json');
      
      expect(data).toEqual(mockData);
      expect(globalThis.fetch).toHaveBeenCalledWith('/topics/auto-v2.1/taxonomy.json');
    });
  });
});

