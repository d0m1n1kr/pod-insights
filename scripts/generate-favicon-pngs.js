#!/usr/bin/env node

/**
 * Generate PNG favicons from SVG
 * Run: npm run generate-favicon
 * 
 * Requires: npm install sharp
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Go up one level from scripts/ to project root
const svgPath = path.join(__dirname, '..', 'frontend', 'public', 'favicon.svg');
const outputDir = path.join(__dirname, '..', 'frontend', 'public');

const sizes = [
  { width: 32, height: 32, name: 'favicon-32x32.png' },
  { width: 180, height: 180, name: 'favicon-180x180.png' },
  { width: 192, height: 192, name: 'favicon-192x192.png' }
];

async function generatePNGs() {
  console.log('Reading SVG file...');
  const svgBuffer = fs.readFileSync(svgPath);
  
  for (const size of sizes) {
    const outputPath = path.join(outputDir, size.name);
    console.log(`Generating ${size.name}...`);
    
    await sharp(svgBuffer)
      .resize(size.width, size.height)
      .png()
      .toFile(outputPath);
    
    console.log(`✓ Created ${size.name}`);
  }
  
  console.log('\n✓ All favicon PNG files generated successfully!');
}

generatePNGs().catch(err => {
  console.error('Error generating PNGs:', err);
  process.exit(1);
});

