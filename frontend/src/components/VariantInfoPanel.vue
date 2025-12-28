<template>
  <div v-if="variantInfo" class="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-900 border border-blue-200 dark:border-blue-900 rounded-lg p-4 mb-6">
    <div class="flex items-start justify-between gap-4">
      <div class="flex-1">
        <div class="flex items-center gap-3 mb-3">
          <div class="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900">
            <svg class="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <h3 class="text-lg font-bold text-gray-900 dark:text-white">
              {{ variantInfo.name }}
            </h3>
            <p class="text-sm text-gray-600 dark:text-gray-400">
              {{ variantInfo.description }}
            </p>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div class="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <div class="text-xs text-gray-500 dark:text-gray-400 mb-1">{{ $t('variantInfo.version') }}</div>
            <div class="text-lg font-bold text-blue-600 dark:text-blue-400">
              {{ variantInfo.version.toUpperCase() }}
            </div>
          </div>

          <div v-if="taxonomyData" class="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <div class="text-xs text-gray-500 dark:text-gray-400 mb-1">{{ $t('variantInfo.clusters') }}</div>
            <div class="text-lg font-bold text-green-600 dark:text-green-400">
              {{ taxonomyData.clusters.length }}
            </div>
          </div>

          <div v-if="taxonomyData" class="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <div class="text-xs text-gray-500 dark:text-gray-400 mb-1">{{ $t('variantInfo.topics') }}</div>
            <div class="text-lg font-bold text-purple-600 dark:text-purple-400">
              {{ taxonomyData.uniqueTopics }}
            </div>
          </div>

          <div v-if="taxonomyData" class="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <div class="text-xs text-gray-500 dark:text-gray-400 mb-1">{{ $t('variantInfo.outliers') }}</div>
            <div class="text-lg font-bold text-orange-600 dark:text-orange-400">
              {{ taxonomyData.statistics.outlierPercentage }}
            </div>
          </div>
        </div>
      </div>

      <button
        @click="toggleDetails"
        class="flex-shrink-0 p-2 hover:bg-white dark:hover:bg-gray-800 rounded-lg transition-colors"
        :title="showDetails ? $t('variantInfo.hideDetails') : $t('variantInfo.showDetails')"
      >
        <svg 
          class="w-5 h-5 text-gray-600 dark:text-gray-400 transition-transform"
          :class="{ 'rotate-180': showDetails }"
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>

    <!-- Expanded Details -->
    <div v-if="showDetails" class="mt-4 pt-4 border-t border-blue-200 dark:border-blue-900">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Algorithm Settings from variants.json -->
        <div>
          <h4 class="text-sm font-semibold text-gray-900 dark:text-white mb-2">
            {{ $t('variantInfo.algorithm') }}
          </h4>
          <div class="text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 rounded p-3 border border-gray-200 dark:border-gray-700">
            <!-- V1 Settings -->
            <template v-if="variantInfo.version === 'v1'">
              <div class="flex justify-between mb-1">
                <span class="text-gray-600 dark:text-gray-400">{{ $t('variantInfo.method') }}:</span>
                <span class="font-mono">HAC</span>
              </div>
              <div v-if="variantInfo.settings?.clusters" class="flex justify-between mb-1">
                <span class="text-gray-600 dark:text-gray-400">{{ $t('variantInfo.targetClusters') }}:</span>
                <span class="font-mono">{{ variantInfo.settings.clusters }}</span>
              </div>
              <div v-if="variantInfo.settings?.linkageMethod" class="flex justify-between mb-1">
                <span class="text-gray-600 dark:text-gray-400">{{ $t('variantInfo.linkage') }}:</span>
                <span class="font-mono text-xs">{{ variantInfo.settings.linkageMethod }}</span>
              </div>
            </template>
            
            <!-- V2 Settings -->
            <template v-else-if="variantInfo.version === 'v2'">
              <div class="flex justify-between mb-1">
                <span class="text-gray-600 dark:text-gray-400">{{ $t('variantInfo.method') }}:</span>
                <span class="font-mono">HDBSCAN</span>
              </div>
              <div v-if="variantInfo.settings?.minClusterSize" class="flex justify-between mb-1">
                <span class="text-gray-600 dark:text-gray-400">{{ $t('variantInfo.minClusterSize') }}:</span>
                <span class="font-mono">{{ variantInfo.settings.minClusterSize }}</span>
              </div>
              <div v-if="variantInfo.settings?.minSamples" class="flex justify-between mb-1">
                <span class="text-gray-600 dark:text-gray-400">{{ $t('variantInfo.minSamples') }}:</span>
                <span class="font-mono">{{ variantInfo.settings.minSamples }}</span>
              </div>
              <div v-if="variantInfo.settings?.reducedDimensions" class="flex justify-between mb-1">
                <span class="text-gray-600 dark:text-gray-400">{{ $t('variantInfo.reducedDims') }}:</span>
                <span class="font-mono">{{ variantInfo.settings.reducedDimensions }}</span>
              </div>
            </template>
            
            <!-- Common Settings -->
            <div v-if="variantInfo.settings?.outlierThreshold" class="flex justify-between mb-1">
              <span class="text-gray-600 dark:text-gray-400">{{ $t('variantInfo.outlierThreshold') }}:</span>
              <span class="font-mono">{{ variantInfo.settings.outlierThreshold }}</span>
            </div>
            <div v-if="variantInfo.settings?.useRelevanceWeighting !== undefined" class="flex justify-between mb-1">
              <span class="text-gray-600 dark:text-gray-400">{{ $t('variantInfo.weighting') }}:</span>
              <span>{{ variantInfo.settings.useRelevanceWeighting ? '✓' : '✗' }}</span>
            </div>
            <div v-if="variantInfo.settings?.useLLMNaming !== undefined" class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-400">{{ $t('variantInfo.llmNaming') }}:</span>
              <span>{{ variantInfo.settings.useLLMNaming ? '✓' : '✗' }}</span>
            </div>
          </div>
        </div>

        <div>
          <h4 class="text-sm font-semibold text-gray-900 dark:text-white mb-2">
            {{ $t('variantInfo.metadata') }}
          </h4>
          <div class="text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 rounded p-3 border border-gray-200 dark:border-gray-700">
            <div v-if="taxonomyData?.createdAt" class="flex justify-between mb-1">
              <span class="text-gray-600 dark:text-gray-400">{{ $t('variantInfo.created') }}:</span>
              <span class="text-xs">{{ formatDate(taxonomyData.createdAt) }}</span>
            </div>
            <div v-if="taxonomyData?.embeddingModel" class="flex justify-between mb-1">
              <span class="text-gray-600 dark:text-gray-400">{{ $t('variantInfo.embeddingModel') }}:</span>
              <span class="text-xs font-mono">{{ taxonomyData.embeddingModel }}</span>
            </div>
            <div v-if="variantInfo.lastBuilt" class="flex justify-between mb-1">
              <span class="text-gray-600 dark:text-gray-400">{{ $t('variantInfo.lastBuilt') }}:</span>
              <span class="text-xs">{{ formatDate(variantInfo.lastBuilt) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600 dark:text-gray-400">{{ $t('variantInfo.variantId') }}:</span>
              <span class="text-xs font-mono">{{ variantInfo.variantId }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Top Clusters Preview -->
      <div v-if="taxonomyData.clusters" class="mt-4">
        <h4 class="text-sm font-semibold text-gray-900 dark:text-white mb-2">
          {{ $t('variantInfo.topClusters') }} (Top 5)
        </h4>
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
          <div 
            v-for="cluster in taxonomyData.clusters.slice(0, 5)" 
            :key="cluster.id"
            class="bg-white dark:bg-gray-800 rounded p-2 border border-gray-200 dark:border-gray-700 text-xs"
          >
            <div class="font-semibold text-gray-900 dark:text-white truncate" :title="cluster.name">
              {{ cluster.name }}
            </div>
            <div class="text-gray-600 dark:text-gray-400">
              {{ cluster.episodeCount }} {{ $t('variantInfo.episodes') }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { loadVariantsManifest, loadVariantData, type VariantInfo, type VariantSettings } from '@/composables/useVariants';

const settings = useSettingsStore();
const showDetails = ref(false);

interface TaxonomyData {
  createdAt: string;
  method: string;
  embeddingModel: string;
  uniqueTopics: number;
  settings: {
    linkageMethod?: string;
    useRelevanceWeighting?: boolean;
    clusters?: number;
    outlierThreshold?: number;
  };
  statistics: {
    outlierPercentage: string;
    clusterCount?: number;
  };
  clusters: Array<{
    id: string;
    name: string;
    episodeCount: number;
  }>;
}

interface ExtendedVariantInfo extends VariantInfo {
  variantId: string;
  settings?: VariantSettings;
}

const variantInfo = ref<ExtendedVariantInfo | null>(null);
const taxonomyData = ref<TaxonomyData | null>(null);

const toggleDetails = () => {
  showDetails.value = !showDetails.value;
};

const formatDate = (dateString: string) => {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateString;
  }
};

const loadVariantInfo = async () => {
  try {
    const manifest = await loadVariantsManifest();
    const currentVariant = settings.clusteringVariant || manifest.defaultVariant;
    
    if (manifest.variants[currentVariant]) {
      const manifestVariant = manifest.variants[currentVariant];
      variantInfo.value = {
        ...manifestVariant,
        variantId: currentVariant,
        // Use description from manifest if available, otherwise generate one
        description: manifestVariant.description || getDefaultDescription(currentVariant, manifestVariant)
      };
    }

    // Load taxonomy data
    taxonomyData.value = await loadVariantData<TaxonomyData>('topic-taxonomy.json');
  } catch (error) {
    console.error('Failed to load variant info:', error);
    variantInfo.value = null;
    taxonomyData.value = null;
  }
};

const getDefaultDescription = (variantId: string, variant: VariantInfo): string => {
  // Generate description from settings if not provided
  if (variant.settings) {
    if (variant.version === 'v1') {
      return `Hierarchical clustering with ${variant.settings.clusters || 256} clusters`;
    } else {
      return `HDBSCAN with min cluster size ${variant.settings.minClusterSize || 5}`;
    }
  }
  return 'Custom clustering configuration';
};

onMounted(loadVariantInfo);

// Reload when variant changes
watch(() => settings.clusteringVariant, loadVariantInfo);
</script>

<style scoped>
.rotate-180 {
  transform: rotate(180deg);
}
</style>

