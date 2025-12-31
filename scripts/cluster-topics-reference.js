import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Settings laden
const settings = JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.json'), 'utf-8'));

/**
 * Wartet für eine bestimmte Zeit
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Lade Embeddings-Datenbank
 */
function loadEmbeddingsDatabase() {
  const dbFile = path.join(__dirname, 'db', 'topic-embeddings.json');
  
  if (!fs.existsSync(dbFile)) {
    return null;
  }
  
  return JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
}

/**
 * Berechne Kosinus-Ähnlichkeit zwischen zwei Vektoren
 */
function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Berechne Distanz-Matrix (1 - Kosinus-Ähnlichkeit)
 */
function computeDistanceMatrix(embeddings) {
  const n = embeddings.length;
  const distances = Array(n).fill(null).map(() => Array(n).fill(0));
  
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dist = 1 - cosineSimilarity(embeddings[i], embeddings[j]);
      distances[i][j] = dist;
      distances[j][i] = dist;
    }
  }
  return distances;
}

/**
 * Berechne Cluster-Distanz basierend auf Linkage-Methode
 */
function computeClusterDistance(clusterA, clusterB, distances, weights, linkageMethod) {
  const itemsA = clusterA.items;
  const itemsB = clusterB.items;
  
  switch (linkageMethod) {
    case 'single':
      let minDist = Infinity;
      for (const i of itemsA) {
        for (const j of itemsB) {
          minDist = Math.min(minDist, distances[i][j]);
        }
      }
      return minDist;
    
    case 'complete':
      let maxDist = 0;
      for (const i of itemsA) {
        for (const j of itemsB) {
          maxDist = Math.max(maxDist, distances[i][j]);
        }
      }
      return maxDist;
    
    case 'weighted':
      let weightedSum = 0;
      let totalWeight = 0;
      for (const i of itemsA) {
        for (const j of itemsB) {
          const w = (weights[i] || 1) * (weights[j] || 1);
          weightedSum += distances[i][j] * w;
          totalWeight += w;
        }
      }
      return weightedSum / totalWeight;
    
    case 'ward':
      const nA = clusterA.totalWeight || itemsA.length;
      const nB = clusterB.totalWeight || itemsB.length;
      const centroidDist = 1 - cosineSimilarity(clusterA.embedding, clusterB.embedding);
      return Math.sqrt((2 * nA * nB) / (nA + nB)) * centroidDist;
    
    case 'average':
    default:
      let totalDist = 0;
      let count = 0;
      for (const i of itemsA) {
        for (const j of itemsB) {
          totalDist += distances[i][j];
          count++;
        }
      }
      return totalDist / count;
  }
}

/**
 * Berechne gewichteten Centroid
 */
function computeWeightedCentroid(items, embeddings, weights) {
  const dim = embeddings[0].length;
  const centroid = Array(dim).fill(0);
  let totalWeight = 0;
  
  for (const idx of items) {
    const w = weights[idx] || 1;
    totalWeight += w;
    for (let d = 0; d < dim; d++) {
      centroid[d] += embeddings[idx][d] * w;
    }
  }
  
  for (let d = 0; d < dim; d++) {
    centroid[d] /= totalWeight;
  }
  
  return { centroid, totalWeight };
}

/**
 * Hierarchisches Agglomeratives Clustering mit konfigurierbarer Linkage und Gewichtung
 */
function hierarchicalClustering(items, embeddings, targetClusters, options = {}) {
  const { 
    outlierThreshold = 0.7, 
    linkageMethod = 'weighted',
    useRelevanceWeighting = true
  } = options;
  
  const n = items.length;
  
  // Berechne Gewichte (Episoden-Anzahl) für jedes Topic
  const weights = items.map(item => {
    if (useRelevanceWeighting && item.episodes) {
      return item.episodes.length;
    }
    return 1;
  });
  
  console.log(`   Linkage-Methode: ${linkageMethod}`);
  console.log(`   Relevanz-Gewichtung: ${useRelevanceWeighting ? 'Ja' : 'Nein'}`);
  
  // Initialisiere: Jedes Item ist sein eigener Cluster
  let clusters = items.map((item, i) => ({
    id: i,
    items: [i],
    embedding: embeddings[i],
    totalWeight: weights[i],
    isOutlier: false,
    maxMergeDistance: 0
  }));
  
  // Berechne initiale Distanz-Matrix
  console.log('   Berechne Distanz-Matrix...');
  const distances = computeDistanceMatrix(embeddings);
  
  // Merge Cluster bis wir die gewünschte Anzahl erreichen
  console.log('   Merge Cluster...');
  let lastProgress = 0;
  
  while (clusters.length > targetClusters) {
    let minDist = Infinity;
    let mergeI = 0, mergeJ = 1;
    
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const dist = computeClusterDistance(
          clusters[i], clusters[j], distances, weights, linkageMethod
        );
        
        if (dist < minDist) {
          minDist = dist;
          mergeI = i;
          mergeJ = j;
        }
      }
    }
    
    // Markiere als Outlier wenn die Merge-Distanz zu hoch ist
    if (minDist > outlierThreshold) {
      clusters[mergeI].isOutlier = true;
      clusters[mergeJ].isOutlier = true;
    }
    
    // Merge die zwei nächsten Cluster
    const newItems = [...clusters[mergeI].items, ...clusters[mergeJ].items];
    
    // Berechne gewichteten Centroid
    const { centroid: newEmbedding, totalWeight: newTotalWeight } = 
      useRelevanceWeighting 
        ? computeWeightedCentroid(newItems, embeddings, weights)
        : { 
            centroid: newItems.reduce((acc, idx) => {
              for (let d = 0; d < embeddings[0].length; d++) {
                acc[d] = (acc[d] || 0) + embeddings[idx][d];
              }
              return acc;
            }, []).map(v => v / newItems.length),
            totalWeight: newItems.length
          };
    
    const newCluster = {
      id: clusters[mergeI].id,
      items: newItems,
      embedding: newEmbedding,
      totalWeight: newTotalWeight,
      isOutlier: clusters[mergeI].isOutlier || clusters[mergeJ].isOutlier,
      maxMergeDistance: Math.max(minDist, clusters[mergeI].maxMergeDistance, clusters[mergeJ].maxMergeDistance)
    };
    
    clusters = clusters.filter((_, idx) => idx !== mergeI && idx !== mergeJ);
    clusters.push(newCluster);
    
    const progress = Math.floor((1 - (clusters.length - targetClusters) / (n - targetClusters)) * 100);
    if (progress > lastProgress + 5) {
      process.stdout.write(`   Progress: ${progress}% (${clusters.length} Cluster)\r`);
      lastProgress = progress;
    }
  }
  console.log(`   Progress: 100% (${clusters.length} Cluster)   `);
  
  return clusters;
}

/**
 * Finde repräsentativen Namen für einen Cluster (mit Relevanz-Gewichtung)
 */
function findClusterName(clusterItems, allTopics, useRelevanceWeighting = true) {
  const keywordCounts = {};
  const topicWords = {};
  
  for (const idx of clusterItems) {
    const topic = allTopics[idx];
    const weight = useRelevanceWeighting 
      ? (topic.episodes?.length || topic.count || 1)
      : 1;
    
    for (const kw of topic.keywords || []) {
      const key = kw.toLowerCase();
      keywordCounts[key] = (keywordCounts[key] || 0) + weight;
    }
    
    const genericWords = new Set([
      'und', 'der', 'die', 'das', 'in', 'im', 'von', 'für', 'mit', 'über', 'zur', 'zum',
      'diskussion', 'thema', 'themen', 'aspekte', 'entwicklung', 'entwicklungen',
      'nutzung', 'verwendung', 'einsatz', 'einfluss', 'bedeutung', 'rolle',
      'allgemein', 'allgemeine', 'verschiedene', 'aktuelle', 'neue', 'neuen',
      'technologie', 'technologien', 'technik', 'technisch', 'technische',
      'zukunft', 'zukünftige', 'trends', 'trend'
    ]);
    
    const words = topic.topic.toLowerCase()
      .replace(/[^a-zäöüß\s-]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !genericWords.has(w));
    
    for (const word of words) {
      topicWords[word] = (topicWords[word] || 0) + weight;
    }
  }
  
  const allCounts = { ...topicWords };
  for (const [kw, count] of Object.entries(keywordCounts)) {
    allCounts[kw] = (allCounts[kw] || 0) + count * 2;
  }
  
  const sorted = Object.entries(allCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word);
  
  if (sorted.length === 0) return 'Sonstiges';
  
  const name = sorted[0].charAt(0).toUpperCase() + sorted[0].slice(1);
  
  if (sorted.length === 1 || allCounts[sorted[0]] > allCounts[sorted[1]] * 2) {
    return name;
  }
  
  const second = sorted[1].charAt(0).toUpperCase() + sorted[1].slice(1);
  return `${name} & ${second}`;
}

/**
 * Ruft das LLM auf für Cluster-Benennung
 */
async function callLLMForNaming(topics, retryCount = 0) {
  const { apiKey, baseURL, temperature } = settings.llm;
  const model = settings.topicClustering?.model || settings.llm.model;
  const maxRetries = settings.topicExtraction?.maxRetries || 3;
  const retryDelayMs = settings.topicExtraction?.retryDelayMs || 5000;

  const systemPrompt = `Du bist ein Experte für präzise Kategorisierung. Deine Aufgabe ist es, für eine Gruppe von Podcast-Topics einen kurzen, prägnanten Kategorie-Namen zu finden.

Regeln:
- Der Name sollte 1-3 Wörter lang sein
- Sei spezifisch, nicht generisch (z.B. "iPhone" statt "Mobilgeräte", "Podcasting" statt "Medien")
- Wenn es um ein konkretes Produkt/Thema geht, nenne es beim Namen
- Die Topics sind nach Relevanz sortiert - die ersten sind wichtiger!
- Antworte NUR mit dem Kategorie-Namen, nichts anderes`;

  const userPrompt = `Finde einen kurzen, prägnanten Namen für diese Gruppe von Topics (sortiert nach Relevanz, wichtigste zuerst):

${topics.map(t => `- ${t}`).join('\n')}

Kategorie-Name:`;

  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: temperature || 0.3,
        max_tokens: 50
      })
    });

    if (response.status === 429) {
      if (retryCount < maxRetries) {
        await sleep(retryDelayMs * Math.pow(2, retryCount));
        return callLLMForNaming(topics, retryCount + 1);
      }
    }

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.choices[0].message.content.trim().replace(/["']/g, '');
  } catch {
    return null;
  }
}

/**
 * Hauptfunktion
 */
async function main() {
  console.log('🔬 Topic-Clustering für Freakshow Episoden\n');
  
  const targetClusters = settings.topicClustering?.clusters || 256;
  const outlierThreshold = settings.topicClustering?.outlierThreshold || 0.7;
  const linkageMethod = settings.topicClustering?.linkageMethod || 'weighted';
  const useRelevanceWeighting = settings.topicClustering?.useRelevanceWeighting !== false;
  const useLLMNaming = settings.topicClustering?.useLLMNaming !== false;
  
  const clusteringOptions = { outlierThreshold, linkageMethod, useRelevanceWeighting };
  
  // 1. Lade Embeddings-Datenbank
  console.log('📂 Lade Embeddings-Datenbank...');
  const db = loadEmbeddingsDatabase();
  
  if (!db) {
    console.log('\n❌ Keine Embeddings-Datenbank gefunden!');
    console.log('   Erstelle zuerst die Datenbank mit:');
    console.log('   node scripts/create-embeddings.js\n');
    process.exit(1);
  }
  
  console.log(`   Modell: ${db.embeddingModel}`);
  console.log(`   Topics: ${db.topics.length}`);
  console.log(`   Dimensionen: ${db.embeddingDimensions}`);
  console.log(`   Erstellt: ${db.createdAt}`);
  
  console.log(`\n📊 Clustering-Einstellungen:`);
  console.log(`   Ziel-Cluster:        ${targetClusters}`);
  console.log(`   Outlier-Schwellwert: ${outlierThreshold}`);
  console.log(`   Linkage-Methode:     ${linkageMethod}`);
  console.log(`   Relevanz-Gewichtung: ${useRelevanceWeighting ? 'Ja' : 'Nein'}`);
  console.log(`   LLM-Benennung:       ${useLLMNaming ? 'Ja' : 'Nein'}\n`);

  // 2. Extrahiere Topics und Embeddings
  const uniqueTopics = db.topics.map(t => ({
    topic: t.topic,
    keywords: t.keywords,
    count: t.count,
    episodes: t.episodes
  }));
  
  const embeddings = db.topics.map(t => t.embedding);

  // 3. Hierarchisches Clustering
  console.log('📊 Cluster erstellen...');
  const clusterResult = hierarchicalClustering(uniqueTopics, embeddings, targetClusters, clusteringOptions);
  console.log(`   ✓ ${clusterResult.length} Cluster erstellt\n`);

  // 4. Benenne Cluster
  console.log('🏷️  Cluster benennen...');
  const delayMs = settings.topicExtraction?.requestDelayMs || 1000;
  const namedClusters = [];
  let outlierCount = 0;
  
  for (let i = 0; i < clusterResult.length; i++) {
    const cluster = clusterResult[i];
    const clusterTopics = cluster.items.map(idx => uniqueTopics[idx]);
    
    let name;
    
    if (cluster.isOutlier || cluster.maxMergeDistance > outlierThreshold) {
      name = 'Sonstiges';
      outlierCount++;
      process.stdout.write(`   ${i + 1}/${clusterResult.length}: "${name}" (Outlier)          \r`);
    } else if (useLLMNaming && clusterTopics.length > 1) {
      const sortedTopics = [...clusterTopics]
        .sort((a, b) => (b.episodes?.length || 0) - (a.episodes?.length || 0))
        .slice(0, 10)
        .map(t => t.topic);
      name = await callLLMForNaming(sortedTopics);
      if (name) {
        process.stdout.write(`   ${i + 1}/${clusterResult.length}: "${name}" (LLM)          \r`);
      }
      await sleep(delayMs / 2);
    }
    
    if (!name) {
      name = findClusterName(cluster.items, uniqueTopics, useRelevanceWeighting);
      process.stdout.write(`   ${i + 1}/${clusterResult.length}: "${name}" (Heuristik)          \r`);
    }
    
    const allEpisodes = new Set();
    for (const t of clusterTopics) {
      for (const ep of t.episodes) {
        allEpisodes.add(ep);
      }
    }
    
    namedClusters.push({
      id: name.toLowerCase().replace(/[^a-zäöüß0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),
      name: name,
      isOutlier: cluster.isOutlier || cluster.maxMergeDistance > outlierThreshold,
      topicCount: clusterTopics.length,
      episodeCount: allEpisodes.size,
      topics: clusterTopics.map(t => ({
        topic: t.topic,
        count: t.count,
        keywords: t.keywords.slice(0, 5)
      })),
      episodes: Array.from(allEpisodes).sort((a, b) => a - b)
    });
  }
  console.log(`\n   ℹ️  ${outlierCount} Outlier-Cluster gefunden\n`);

  // 5. Sortiere nach Häufigkeit
  namedClusters.sort((a, b) => b.episodeCount - a.episodeCount);

  // 6. Speichere Ergebnis
  const taxonomyFile = path.join(__dirname, 'topic-taxonomy.json');
  const outliers = namedClusters.filter(c => c.isOutlier);
  
  const result = {
    createdAt: new Date().toISOString(),
    method: 'embedding-clustering',
    embeddingModel: db.embeddingModel,
    embeddingsCreatedAt: db.createdAt,
    totalTopics: db.totalTopicsRaw,
    uniqueTopics: db.topics.length,
    settings: {
      clusters: targetClusters,
      outlierThreshold,
      linkageMethod,
      useRelevanceWeighting
    },
    statistics: {
      clusterCount: namedClusters.length,
      outlierCount: outliers.length,
      outlierPercentage: ((outliers.length / namedClusters.length) * 100).toFixed(1) + '%'
    },
    clusters: namedClusters.map(c => ({
      id: c.id,
      name: c.name,
      description: `${c.topicCount} Topics in ${c.episodeCount} Episoden`,
      isOutlier: c.isOutlier,
      topicCount: c.topicCount,
      episodeCount: c.episodeCount,
      sampleTopics: c.topics.slice(0, 5).map(t => t.topic),
      episodes: c.episodes
    }))
  };

  fs.writeFileSync(taxonomyFile, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`✅ Taxonomie gespeichert: ${taxonomyFile}`);
  
  // Zeige Top-Cluster
  console.log('\n📋 Top 15 Cluster:');
  namedClusters.slice(0, 15).forEach((c, i) => {
    const outlierTag = c.isOutlier ? ' [Outlier]' : '';
    console.log(`   ${i + 1}. ${c.name}${outlierTag} (${c.episodeCount} Episoden, ${c.topicCount} Topics)`);
    console.log(`      Beispiele: ${c.topics.slice(0, 3).map(t => t.topic).join(', ')}`);
  });
  
  console.log('\n✨ Statistik:');
  console.log(`   ${namedClusters.length} Cluster erstellt`);
  console.log(`   ${outliers.length} Outlier (${((outliers.length / namedClusters.length) * 100).toFixed(1)}%)`);
}

// Starte das Skript
main().catch(error => {
  console.error('❌ Kritischer Fehler:', error);
  process.exit(1);
});
