#!/usr/bin/env node

/**
 * Generate speaker index.json files and download/cache speaker images
 * 
 * This script:
 * 1. Reads all speaker meta files in frontend/public/podcasts/<podcast-id>/speakers/
 * 2. Downloads images from external URLs and saves them locally
 * 3. Updates meta.json files to reference local images
 * 4. Generates index.json listing all available speakers
 * 
 * Usage:
 *   node scripts/generate-speaker-index.js --podcast <podcast-id>
 *   node scripts/generate-speaker-index.js --all
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

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
  console.error('Usage: node scripts/generate-speaker-index.js --podcast <podcast-id> | --all');
  process.exit(1);
}

/**
 * Download a file from URL and save to local path
 */
function downloadFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;
    
    const file = fs.createWriteStream(filePath);
    
    protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(filePath);
        return downloadFile(response.headers.location, filePath).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(filePath);
        reject(new Error(`HTTP ${response.statusCode}: ${url}`));
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      reject(err);
    });
  });
}

/**
 * Get file extension from URL or content-type
 */
function getImageExtension(url, contentType) {
  // Try to get extension from URL
  const urlMatch = url.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i);
  if (urlMatch) {
    return urlMatch[1].toLowerCase();
  }
  
  // Try to get from content-type
  if (contentType) {
    if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
    if (contentType.includes('png')) return 'png';
    if (contentType.includes('gif')) return 'gif';
    if (contentType.includes('webp')) return 'webp';
    if (contentType.includes('svg')) return 'svg';
  }
  
  // Default to jpg
  return 'jpg';
}

/**
 * Process a single podcast
 */
async function processPodcast(podcastId) {
  const speakersDir = path.join(PROJECT_ROOT, 'frontend', 'public', 'podcasts', podcastId, 'speakers');
  
  if (!fs.existsSync(speakersDir)) {
    console.log(`⚠️  Speakers directory not found: ${speakersDir}`);
    return;
  }
  
  console.log(`\n📁 Processing podcast: ${podcastId}`);
  console.log(`   Directory: ${speakersDir}`);
  
  // Read all meta files
  const files = await fsPromises.readdir(speakersDir);
  const metaFiles = files.filter(f => f.endsWith('-meta.json'));
  
  if (metaFiles.length === 0) {
    console.log(`   No speaker meta files found`);
    return;
  }
  
  console.log(`   Found ${metaFiles.length} speaker meta file(s)`);
  
  const speakers = [];
  const downloadPromises = [];
  
  for (const metaFile of metaFiles) {
    const metaPath = path.join(speakersDir, metaFile);
    const metaData = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    
    const slug = metaData.slug || metaFile.replace('-meta.json', '');
    const imageUrl = metaData.image;
    
    if (!imageUrl) {
      console.log(`   ⚠️  ${slug}: No image URL found`);
      speakers.push({
        slug,
        name: metaData.name || slug,
        hasImage: false,
        hasMeta: true
      });
      continue;
    }
    
    // Check if image is already a local filename (not a URL)
    const isLocalFile = !imageUrl.startsWith('http://') && !imageUrl.startsWith('https://');
    
    if (isLocalFile) {
      // Image is already local, check if file exists
      const imagePath = path.join(speakersDir, imageUrl);
      if (fs.existsSync(imagePath)) {
        console.log(`   ✓ ${slug}: Image already local (${imageUrl})`);
        speakers.push({
          slug,
          name: metaData.name || slug,
          hasImage: true,
          imageFile: imageUrl,
          hasMeta: true
        });
      } else {
        console.log(`   ⚠️  ${slug}: Local image file not found (${imageUrl})`);
        speakers.push({
          slug,
          name: metaData.name || slug,
          hasImage: false,
          hasMeta: true
        });
      }
      continue;
    }
    
    // Image is a URL, download it
    // Determine local image path
    const imageExt = getImageExtension(imageUrl, null);
    const imageFileName = `${slug}.${imageExt}`;
    const imagePath = path.join(speakersDir, imageFileName);
    
    // Check if image already exists
    const imageExists = fs.existsSync(imagePath);
    
    if (imageExists) {
      console.log(`   ✓ ${slug}: Image already cached (${imageFileName})`);
      // Update meta.json to use local image
      metaData.image = imageFileName;
      await fsPromises.writeFile(metaPath, JSON.stringify(metaData, null, 2) + '\n', 'utf-8');
      
      speakers.push({
        slug,
        name: metaData.name || slug,
        hasImage: true,
        imageFile: imageFileName,
        hasMeta: true
      });
    } else {
      // Download image
      console.log(`   ⬇️  ${slug}: Downloading image from ${imageUrl}`);
      
      const downloadPromise = downloadFile(imageUrl, imagePath)
        .then(() => {
          console.log(`   ✓ ${slug}: Image downloaded (${imageFileName})`);
          // Update meta.json to use local image
          metaData.image = imageFileName;
          return fsPromises.writeFile(metaPath, JSON.stringify(metaData, null, 2) + '\n', 'utf-8')
            .then(() => {
              speakers.push({
                slug,
                name: metaData.name || slug,
                hasImage: true,
                imageFile: imageFileName,
                hasMeta: true
              });
            });
        })
        .catch((err) => {
          console.error(`   ✗ ${slug}: Failed to download image: ${err.message}`);
          speakers.push({
            slug,
            name: metaData.name || slug,
            hasImage: false,
            hasMeta: true,
            error: err.message
          });
        });
      
      downloadPromises.push(downloadPromise);
    }
  }
  
  // Wait for all downloads to complete
  if (downloadPromises.length > 0) {
    console.log(`   Waiting for ${downloadPromises.length} image download(s)...`);
    await Promise.all(downloadPromises);
  }
  
  // Generate index-meta.json (separate from index.json which contains speaker statistics)
  const indexData = {
    generatedAt: new Date().toISOString(),
    podcastId,
    count: speakers.length,
    speakers: speakers.sort((a, b) => a.name.localeCompare(b.name))
  };
  
  const indexPath = path.join(speakersDir, 'index-meta.json');
  await fsPromises.writeFile(
    indexPath,
    JSON.stringify(indexData, null, 2) + '\n',
    'utf-8'
  );
  
  console.log(`   ✓ Generated index-meta.json with ${speakers.length} speaker(s)`);
  console.log(`   ✓ ${speakers.filter(s => s.hasImage).length} speaker(s) have images`);
}

// Process all podcasts
(async () => {
  console.log('🎨 Speaker Index Generator\n');
  console.log(`Processing ${podcastIds.length} podcast(s)...`);
  
  for (const podcastId of podcastIds) {
    try {
      await processPodcast(podcastId);
    } catch (error) {
      console.error(`\n✗ Error processing ${podcastId}:`, error.message);
    }
  }
  
  console.log('\n✅ Done!');
})();

