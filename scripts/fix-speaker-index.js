#!/usr/bin/env node

/**
 * Fix speaker index.json files by removing absolute profilePath fields
 * 
 * The backend doesn't use profilePath - it constructs paths itself.
 * This script removes the absolute paths to make files portable.
 * 
 * Usage:
 *   node scripts/fix-speaker-index.js --podcast <podcast-id>
 *   node scripts/fix-speaker-index.js --all
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

// Parse command line arguments
const args = process.argv.slice(2);
const podcastIndex = args.indexOf('--podcast');
const allIndex = args.indexOf('--all');

// Get podcast IDs to process
let podcastIds = [];
if (allIndex !== -1) {
  // Load from podcasts.json or settings.json
  try {
    const podcastsPath = path.join(PROJECT_ROOT, 'frontend', 'public', 'podcasts.json');
    const podcastsData = JSON.parse(fs.readFileSync(podcastsPath, 'utf-8'));
    podcastIds = podcastsData.podcasts.map(p => p.id);
  } catch (e) {
    console.error('Error loading podcasts.json:', e.message);
    process.exit(1);
  }
} else if (podcastIndex !== -1 && args[podcastIndex + 1]) {
  podcastIds = [args[podcastIndex + 1]];
} else {
  console.error('Usage: node scripts/fix-speaker-index.js --podcast <podcast-id> | --all');
  process.exit(1);
}

/**
 * Fix index.json for a single podcast
 */
async function fixPodcastIndex(podcastId) {
  // Check both locations: podcasts/ and frontend/public/podcasts/
  const locations = [
    path.join(PROJECT_ROOT, 'podcasts', podcastId, 'speakers', 'index.json'),
    path.join(PROJECT_ROOT, 'frontend', 'public', 'podcasts', podcastId, 'speakers', 'index.json')
  ];
  
  for (const indexPath of locations) {
    if (!fs.existsSync(indexPath)) {
      continue; // Skip if doesn't exist
    }
    
    console.log(`\n📁 Processing: ${indexPath}`);
    
    try {
      const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      let modified = false;
      
      if (Array.isArray(data)) {
        // Process array format
        const cleaned = data.map(speaker => {
          if ('profilePath' in speaker) {
            modified = true;
            const { profilePath, ...rest } = speaker;
            return rest;
          }
          return speaker;
        });
        
        if (modified) {
          await fsPromises.writeFile(
            indexPath,
            JSON.stringify(cleaned, null, 2) + '\n',
            'utf-8'
          );
          console.log(`   ✓ Removed profilePath from ${cleaned.length} speaker(s)`);
        } else {
          console.log(`   ✓ No profilePath fields found (already clean)`);
        }
      } else if (data.speakers && Array.isArray(data.speakers)) {
        // Process object format with speakers array
        const cleanedSpeakers = data.speakers.map(speaker => {
          if ('profilePath' in speaker) {
            modified = true;
            const { profilePath, ...rest } = speaker;
            return rest;
          }
          return speaker;
        });
        
        if (modified) {
          const cleaned = { ...data, speakers: cleanedSpeakers };
          await fsPromises.writeFile(
            indexPath,
            JSON.stringify(cleaned, null, 2) + '\n',
            'utf-8'
          );
          console.log(`   ✓ Removed profilePath from ${cleanedSpeakers.length} speaker(s)`);
        } else {
          console.log(`   ✓ No profilePath fields found (already clean)`);
        }
      } else {
        console.log(`   ⚠️  Unknown format, skipping`);
      }
    } catch (error) {
      console.error(`   ✗ Error processing ${indexPath}:`, error.message);
    }
  }
}

// Process all podcasts
(async () => {
  console.log('🔧 Speaker Index Fixer\n');
  console.log(`Processing ${podcastIds.length} podcast(s)...`);
  
  for (const podcastId of podcastIds) {
    try {
      await fixPodcastIndex(podcastId);
    } catch (error) {
      console.error(`\n✗ Error processing ${podcastId}:`, error.message);
    }
  }
  
  console.log('\n✅ Done!');
})();

