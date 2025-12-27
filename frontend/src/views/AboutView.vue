<script setup lang="ts">
</script>

<template>
  <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
    <div class="p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20">
      <h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Über diese Visualisierung</h2>
      <p class="text-gray-600 dark:text-gray-400">Technologien und Werkzeuge hinter der Freak Show River Visualisierung</p>
    </div>

    <div class="p-8 space-y-8">
      <!-- Project Description -->
      <section>
        <h3 class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">📊 Projekt-Beschreibung</h3>
        <p class="text-gray-700 dark:text-gray-300 leading-relaxed">
          Diese interaktive Visualisierung analysiert und visualisiert die Themen und Sprecher des 
          <strong>Freak Show Podcasts</strong> über die Jahre. Durch KI-gestützte Textanalyse und 
          Clustering-Algorithmen werden Themen gruppiert und deren zeitliche Entwicklung in 
          River-Diagrammen dargestellt.
        </p>
      </section>

      <!-- Frontend Technologies -->
      <section>
        <h3 class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">🎨 Frontend-Technologien</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-lg border border-green-200 dark:border-green-700">
            <h4 class="font-semibold text-green-900 dark:text-green-100 mb-2">Vue.js 3.5</h4>
            <p class="text-sm text-gray-700 dark:text-gray-300">Progressive JavaScript Framework für die reaktive Benutzeroberfläche</p>
          </div>
          
          <div class="p-4 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
            <h4 class="font-semibold text-blue-900 dark:text-blue-100 mb-2">TypeScript 5.9</h4>
            <p class="text-sm text-gray-700 dark:text-gray-300">Typsichere Programmierung für robusteren Code</p>
          </div>
          
          <div class="p-4 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-lg border border-purple-200 dark:border-purple-700">
            <h4 class="font-semibold text-purple-900 dark:text-purple-100 mb-2">D3.js 7.9</h4>
            <p class="text-sm text-gray-700 dark:text-gray-300">Datenvisualisierungs-Bibliothek für die interaktiven River-Diagramme</p>
          </div>
          
          <div class="p-4 bg-gradient-to-r from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20 rounded-lg border border-sky-200 dark:border-sky-700">
            <h4 class="font-semibold text-sky-900 dark:text-sky-100 mb-2">Tailwind CSS 4.1</h4>
            <p class="text-sm text-gray-700 dark:text-gray-300">Utility-First CSS Framework für modernes Design</p>
          </div>
          
          <div class="p-4 bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 rounded-lg border border-amber-200 dark:border-amber-700">
            <h4 class="font-semibold text-amber-900 dark:text-amber-100 mb-2">Pinia 3.0</h4>
            <p class="text-sm text-gray-700 dark:text-gray-300">State Management mit LocalStorage-Persistenz</p>
          </div>
          
          <div class="p-4 bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-900/20 dark:to-violet-900/20 rounded-lg border border-indigo-200 dark:border-indigo-700">
            <h4 class="font-semibold text-indigo-900 dark:text-indigo-100 mb-2">Vue Router 4.6</h4>
            <p class="text-sm text-gray-700 dark:text-gray-300">Single-Page-Application Routing</p>
          </div>
          
          <div class="p-4 bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20 rounded-lg border border-orange-200 dark:border-orange-700">
            <h4 class="font-semibold text-orange-900 dark:text-orange-100 mb-2">Vite 7.2</h4>
            <p class="text-sm text-gray-700 dark:text-gray-300">Schneller Build-Tool und Development-Server</p>
          </div>
        </div>
      </section>

      <!-- Backend Technologies -->
      <section>
        <h3 class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">⚙️ Backend & Datenverarbeitung</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="p-4 bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 rounded-lg border border-orange-200 dark:border-orange-700">
            <h4 class="font-semibold text-orange-900 dark:text-orange-100 mb-2">Rust 2021 Edition</h4>
            <p class="text-sm text-gray-700 dark:text-gray-300">Hochperformante Clustering-Algorithmen für Topic-Analyse</p>
          </div>
          
          <div class="p-4 bg-gradient-to-r from-green-50 to-lime-50 dark:from-green-900/20 dark:to-lime-900/20 rounded-lg border border-green-200 dark:border-green-700">
            <h4 class="font-semibold text-green-900 dark:text-green-100 mb-2">Node.js</h4>
            <p class="text-sm text-gray-700 dark:text-gray-300">Daten-Aggregation und JSON-Generierung</p>
          </div>
          
          <div class="p-4 bg-gradient-to-r from-red-50 to-pink-50 dark:from-red-900/20 dark:to-pink-900/20 rounded-lg border border-red-200 dark:border-red-700">
            <h4 class="font-semibold text-red-900 dark:text-red-100 mb-2">Rayon</h4>
            <p class="text-sm text-gray-700 dark:text-gray-300">Parallele Verarbeitung in Rust für schnelleres Clustering</p>
          </div>
          
          <div class="p-4 bg-gradient-to-r from-cyan-50 to-teal-50 dark:from-cyan-900/20 dark:to-teal-900/20 rounded-lg border border-cyan-200 dark:border-cyan-700">
            <h4 class="font-semibold text-cyan-900 dark:text-cyan-100 mb-2">Serde JSON</h4>
            <p class="text-sm text-gray-700 dark:text-gray-300">Serialisierung und Deserialisierung von Episode-Daten</p>
          </div>
        </div>
      </section>

      <!-- AI & Machine Learning -->
      <section>
        <h3 class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">🤖 KI & Machine Learning</h3>
        <div class="space-y-4">
          <div class="p-5 bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20 rounded-lg border border-violet-200 dark:border-violet-700">
            <h4 class="font-semibold text-violet-900 dark:text-violet-100 mb-2 flex items-center gap-2">
              <span>OpenAI text-embedding-3-small</span>
              <span class="text-xs bg-violet-200 dark:bg-violet-800 text-violet-800 dark:text-violet-200 px-2 py-0.5 rounded-full">Embedding-Modell</span>
            </h4>
            <p class="text-sm text-gray-700 dark:text-gray-300 mb-2">
              Generierung von semantischen Embeddings für alle Podcast-Themen. 
              Ermöglicht bedeutungsbasiertes Clustering statt nur Keyword-Matching.
            </p>
            <ul class="text-xs text-gray-600 dark:text-gray-400 list-disc list-inside space-y-1">
              <li>1536-dimensionale Vektoren</li>
              <li>Semantische Ähnlichkeitsberechnung</li>
              <li>Sprachübergreifendes Verständnis</li>
            </ul>
          </div>
          
          <div class="p-5 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
            <h4 class="font-semibold text-blue-900 dark:text-blue-100 mb-2 flex items-center gap-2">
              <span>Hierarchisches Clustering</span>
              <span class="text-xs bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded-full">Algorithmus</span>
            </h4>
            <p class="text-sm text-gray-700 dark:text-gray-300 mb-2">
              Automatische Gruppierung ähnlicher Themen basierend auf Kosinus-Ähnlichkeit der Embeddings.
            </p>
            <ul class="text-xs text-gray-600 dark:text-gray-400 list-disc list-inside space-y-1">
              <li>Agglomerative Clustering mit Average-Linkage</li>
              <li>Dynamische Schwellwert-Bestimmung</li>
              <li>Automatische Cluster-Benennung</li>
            </ul>
          </div>
        </div>
      </section>

      <!-- Data Processing Pipeline -->
      <section>
        <h3 class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">🔄 Datenverarbeitungs-Pipeline</h3>
        <div class="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
          <ol class="space-y-4">
            <li class="flex gap-4">
              <span class="flex-shrink-0 w-8 h-8 bg-blue-500 dark:bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-sm">1</span>
              <div>
                <h5 class="font-semibold text-gray-900 dark:text-gray-100">Episode-Daten Extraktion</h5>
                <p class="text-sm text-gray-600 dark:text-gray-400">Laden von Episode-Metadaten und Themen aus JSON-Dateien</p>
              </div>
            </li>
            <li class="flex gap-4">
              <span class="flex-shrink-0 w-8 h-8 bg-purple-500 dark:bg-purple-600 text-white rounded-full flex items-center justify-center font-bold text-sm">2</span>
              <div>
                <h5 class="font-semibold text-gray-900 dark:text-gray-100">Embedding-Generierung</h5>
                <p class="text-sm text-gray-600 dark:text-gray-400">OpenAI API erstellt semantische Vektoren für jedes Thema</p>
              </div>
            </li>
            <li class="flex gap-4">
              <span class="flex-shrink-0 w-8 h-8 bg-green-500 dark:bg-green-600 text-white rounded-full flex items-center justify-center font-bold text-sm">3</span>
              <div>
                <h5 class="font-semibold text-gray-900 dark:text-gray-100">Clustering-Analyse</h5>
                <p class="text-sm text-gray-600 dark:text-gray-400">Rust-basiertes hierarchisches Clustering gruppiert ähnliche Themen</p>
              </div>
            </li>
            <li class="flex gap-4">
              <span class="flex-shrink-0 w-8 h-8 bg-orange-500 dark:bg-orange-600 text-white rounded-full flex items-center justify-center font-bold text-sm">4</span>
              <div>
                <h5 class="font-semibold text-gray-900 dark:text-gray-100">Kategorisierung</h5>
                <p class="text-sm text-gray-600 dark:text-gray-400">Übergeordnete Kategorien fassen verwandte Cluster zusammen</p>
              </div>
            </li>
            <li class="flex gap-4">
              <span class="flex-shrink-0 w-8 h-8 bg-cyan-500 dark:bg-cyan-600 text-white rounded-full flex items-center justify-center font-bold text-sm">5</span>
              <div>
                <h5 class="font-semibold text-gray-900 dark:text-gray-100">Zeitreihen-Aggregation</h5>
                <p class="text-sm text-gray-600 dark:text-gray-400">Node.js aggregiert Daten nach Jahren für River-Visualisierung</p>
              </div>
            </li>
            <li class="flex gap-4">
              <span class="flex-shrink-0 w-8 h-8 bg-pink-500 dark:bg-pink-600 text-white rounded-full flex items-center justify-center font-bold text-sm">6</span>
              <div>
                <h5 class="font-semibold text-gray-900 dark:text-gray-100">Interactive Visualisierung</h5>
                <p class="text-sm text-gray-600 dark:text-gray-400">D3.js rendert die Daten als interaktive Stream-Graphen</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <!-- Features -->
      <section>
        <h3 class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">✨ Features</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div class="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <span class="text-2xl">🎯</span>
            <div>
              <h5 class="font-semibold text-gray-900 dark:text-gray-100 text-sm">Interaktive Tooltips</h5>
              <p class="text-xs text-gray-600 dark:text-gray-400">Jahr-spezifische Informationen beim Hovern</p>
            </div>
          </div>
          <div class="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <span class="text-2xl">🔍</span>
            <div>
              <h5 class="font-semibold text-gray-900 dark:text-gray-100 text-sm">Jahr-Filter</h5>
              <p class="text-xs text-gray-600 dark:text-gray-400">Klick-basierte Filterung nach Jahren</p>
            </div>
          </div>
          <div class="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <span class="text-2xl">📊</span>
            <div>
              <h5 class="font-semibold text-gray-900 dark:text-gray-100 text-sm">Normierte Ansicht</h5>
              <p class="text-xs text-gray-600 dark:text-gray-400">Persistente Einstellung für prozentuale Darstellung</p>
            </div>
          </div>
          <div class="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <span class="text-2xl">🔗</span>
            <div>
              <h5 class="font-semibold text-gray-900 dark:text-gray-100 text-sm">Deep-Linking</h5>
              <p class="text-xs text-gray-600 dark:text-gray-400">Direkte URLs für jede Ansicht</p>
            </div>
          </div>
          <div class="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <span class="text-2xl">📱</span>
            <div>
              <h5 class="font-semibold text-gray-900 dark:text-gray-100 text-sm">Responsive Design</h5>
              <p class="text-xs text-gray-600 dark:text-gray-400">Optimiert für Desktop und Tablet</p>
            </div>
          </div>
          <div class="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <span class="text-2xl">💾</span>
            <div>
              <h5 class="font-semibold text-gray-900 dark:text-gray-100 text-sm">LocalStorage</h5>
              <p class="text-xs text-gray-600 dark:text-gray-400">Einstellungen bleiben über Sitzungen erhalten</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Open Source -->
      <section class="border-t border-gray-200 dark:border-gray-700 pt-6">
        <div class="text-center text-gray-600 dark:text-gray-400">
          <p class="text-sm">
            Erstellt mit ❤️ für den <strong>Freak Show Podcast</strong>
          </p>
          <p class="text-xs mt-2 text-gray-500 dark:text-gray-500">
            © 2025 • Alle Daten basieren auf öffentlich verfügbaren Podcast-Informationen
          </p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* Zusätzliche Styles falls nötig */
</style>

