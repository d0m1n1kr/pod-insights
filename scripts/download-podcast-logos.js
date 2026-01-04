#!/usr/bin/env node

/**
 * Download podcast logos from podcasts.json to frontend/public/podcasts/<podcast-id>/logo.*
 * 
 * Usage:
 *   node scripts/download-podcast-logos.js
 *   node scripts/download-podcast-logos.js --podcast <podcast-id>
 *   node scripts/download-podcast-logos.js --all
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

// Parse command line arguments
const args = process.argv.slice(2);
const podcastIndex = args.indexOf('--podcast');
const allIndex = args.indexOf('--all');

// Load podcasts.json
const podcastsPath = path.join(PROJECT_ROOT, 'frontend', 'public', 'podcasts.json');
let podcasts;
try {
  podcasts = JSON.parse(fs.readFileSync(podcastsPath, 'utf-8'));
} catch (error) {
  console.error('Error loading podcasts.json:', error.message);
  process.exit(1);
}

// Get podcast IDs to process
let podcastIds = [];
if (allIndex !== -1) {
  podcastIds = podcasts.podcasts.map(p => p.id);
} else if (podcastIndex !== -1 && args[podcastIndex + 1]) {
  podcastIds = [args[podcastIndex + 1]];
} else {
  // Default: process all
  podcastIds = podcasts.podcasts.map(p => p.id);
}

/**
 * Download a file from URL
 */
function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        return downloadFile(response.headers.location, outputPath)
          .then(resolve)
          .catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      const fileStream = fs.createWriteStream(outputPath);
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
      
      fileStream.on('error', (err) => {
        fs.unlink(outputPath, () => {}); // Delete file on error
        reject(err);
      });
    }).on('error', reject);
  });
}

/**
 * Get image extension from URL or Content-Type (for temporary download)
 */
function getImageExtension(url, contentType) {
  // Try to get extension from URL
  const urlMatch = url.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i);
  if (urlMatch) {
    const ext = urlMatch[1].toLowerCase();
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  
  // Try to get from Content-Type
  if (contentType) {
    const typeMatch = contentType.match(/image\/(jpeg|jpg|png|gif|webp|svg\+xml)/i);
    if (typeMatch) {
      const ext = typeMatch[1].toLowerCase();
      return ext === 'jpeg' || ext === 'jpg' ? 'jpg' : ext === 'svg+xml' ? 'svg' : ext;
    }
  }
  
  // Default to jpg
  return 'jpg';
}

/**
 * Download logo for a single podcast and convert to JPG
 */
async function downloadPodcastLogo(podcast) {
  if (!podcast.logoUrl) {
    console.log(`   ⚠️  ${podcast.id}: No logoUrl found`);
    return;
  }
  
  const podcastDir = path.join(PROJECT_ROOT, 'frontend', 'public', 'podcasts', podcast.id);
  const logoPath = path.join(podcastDir, 'logo.jpg');
  
  // Ensure directory exists
  await fsPromises.mkdir(podcastDir, { recursive: true });
  
  // Try to determine extension from URL for temporary download
  const tempExt = getImageExtension(podcast.logoUrl, null);
  const tempPath = `${logoPath}.tmp.${tempExt}`;
  
  try {
    console.log(`   ⬇️  ${podcast.id}: Downloading from ${podcast.logoUrl}`);
    
    // Download to temp file first
    await downloadFile(podcast.logoUrl, tempPath);
    
    // Check if file was downloaded successfully
    const stats = await fsPromises.stat(tempPath);
    if (stats.size === 0) {
      throw new Error('Downloaded file is empty');
    }
    
    console.log(`   🔄 ${podcast.id}: Converting to JPG...`);
    
    // Convert to JPG using sharp
    // Handle SVG files specially (they need to be rasterized)
    const isSvg = tempExt === 'svg' || tempExt === 'svg+xml';
    
    if (isSvg) {
      // For SVG, rasterize and convert to JPG (with size limit)
      await sharp(tempPath)
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toFile(logoPath);
    } else {
      // For other formats (PNG, GIF, WebP, etc.), convert directly to JPG
      // sharp will handle transparency by converting to white background for JPG
      await sharp(tempPath)
        .jpeg({ quality: 90 })
        .toFile(logoPath);
    }
    
    // Check if conversion was successful
    const jpgStats = await fsPromises.stat(logoPath);
    if (jpgStats.size === 0) {
      throw new Error('Converted JPG file is empty');
    }
    
    console.log(`   ✓ ${podcast.id}: Logo converted to JPG (${jpgStats.size} bytes)`);
    
    // Clean up temp file
    try {
      await fsPromises.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
  } catch (error) {
    console.error(`   ✗ ${podcast.id}: Failed to download/convert logo: ${error.message}`);
    // Clean up temp file if it exists
    try {
      await fsPromises.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    // Clean up JPG file if it exists but is invalid
    try {
      await fsPromises.unlink(logoPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// Process all podcasts
(async () => {
  console.log('🎨 Podcast Logo Downloader\n');
  console.log(`Processing ${podcastIds.length} podcast(s)...\n`);
  
  for (const podcastId of podcastIds) {
    const podcast = podcasts.podcasts.find(p => p.id === podcastId);
    if (!podcast) {
      console.error(`\n✗ Podcast '${podcastId}' not found in podcasts.json`);
      continue;
    }
    
    try {
      await downloadPodcastLogo(podcast);
    } catch (error) {
      console.error(`\n✗ Error processing ${podcastId}:`, error.message);
    }
  }
  
  console.log('\n✅ Done!');
})();

