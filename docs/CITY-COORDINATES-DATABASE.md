# City Coordinates Database Sources

This document lists free and open sources for city coordinate databases that can be used to improve the accuracy of the analytics map.

## Recommended Free Sources

### 1. GeoNames (Recommended)
**URL:** https://www.geonames.org/

- **Free tier:** Up to 1,000 requests/day
- **Data format:** CSV, JSON, XML
- **Coverage:** Worldwide, very comprehensive
- **License:** Creative Commons Attribution 4.0 License

**How to use:**
1. Sign up for a free account at https://www.geonames.org/login
2. Download city data: https://download.geonames.org/export/dump/
3. Use `cities15000.zip` (cities with population > 15000) or `cities5000.zip` (cities with population > 5000)
4. Data includes: name, country code, latitude, longitude, population

**Example download:**
```bash
wget https://download.geonames.org/export/dump/cities15000.zip
unzip cities15000.zip
# Format: geonameid, name, asciiname, alternatenames, latitude, longitude, ...
```

### 2. SimpleMaps World Cities Database
**URL:** https://simplemaps.com/data/world-cities

- **Free tier:** Basic database (free)
- **Data format:** CSV, JSON
- **Coverage:** ~43,000 cities worldwide
- **License:** Free for non-commercial use

**Download:**
- Basic version: https://simplemaps.com/data/world-cities
- Includes: city, city_ascii, lat, lng, country, iso2, iso3, admin_name, capital, population

### 3. OpenStreetMap (via Overpass API or Nominatim)
**URL:** https://www.openstreetmap.org/

- **Free:** Yes, completely free
- **Data format:** JSON (via API), XML (via Overpass)
- **Coverage:** Worldwide, community-maintained
- **License:** ODbL (Open Database License)

**Using Nominatim API:**
```bash
# Search for a city
curl "https://nominatim.openstreetmap.org/search?q=Heidelberg,Germany&format=json&limit=1"
```

**Using Overpass API:**
```xml
[out:json];
(
  node["place"="city"]["name"="Heidelberg"];
  node["place"="town"]["name"="Heidelberg"];
);
out;
```

### 4. MaxMind GeoLite2 (Already Used)
**URL:** https://www.maxmind.com/en/geolite2/signup

- **Free:** Yes (requires signup)
- **Data format:** MMDB (binary), CSV
- **Coverage:** Worldwide
- **License:** Creative Commons Attribution-ShareAlike 4.0

**Note:** You're already using this for IP-to-location lookups. The CSV version includes city coordinates.

### 5. Natural Earth Cities
**URL:** https://www.naturalearthdata.com/downloads/

- **Free:** Yes
- **Data format:** Shapefile, GeoJSON
- **Coverage:** Populated places worldwide
- **License:** Public Domain

**Download:**
- https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/

## Quick Implementation Guide

### Option 1: Use GeoNames CSV (Recommended)

1. **Download the data:**
   ```bash
   wget https://download.geonames.org/export/dump/cities15000.zip
   unzip cities15000.zip cities15000.txt
   ```

2. **Convert to JSON format for frontend:**
   ```javascript
   // Example Node.js script to convert GeoNames CSV to JSON
   const fs = require('fs');
   const readline = require('readline');
   
   const cities = {};
   const fileStream = fs.createReadStream('cities15000.txt');
   const rl = readline.createInterface({
     input: fileStream,
     crlfDelay: Infinity
   });
   
   rl.on('line', (line) => {
     const fields = line.split('\t');
     // GeoNames format: geonameid, name, asciiname, alternatenames, latitude, longitude, ...
     const countryCode = fields[8]; // ISO country code
     const cityName = fields[1]; // Name
     const lat = parseFloat(fields[4]);
     const lon = parseFloat(fields[5]);
     
     if (['DE', 'CH', 'AT'].includes(countryCode)) {
       const key = `${countryCode}-${cityName}`;
       cities[key] = [lon, lat];
     }
   });
   
   rl.on('close', () => {
     fs.writeFileSync('city-coordinates.json', JSON.stringify(cities, null, 2));
   });
   ```

3. **Load in frontend:**
   ```typescript
   // In StatsView.vue
   import cityCoordinates from '@/data/city-coordinates.json';
   
   // Then use:
   const coords = cityCoordinates[cityKey] || cityOffsets[cityKey];
   ```

### Option 2: Use SimpleMaps JSON (Easier)

1. **Download:**
   ```bash
   wget https://simplemaps.com/static/data/world-cities/basic/simplemaps_worldcities_basicv1.75.zip
   unzip simplemaps_worldcities_basicv1.75.zip
   ```

2. **Convert to your format:**
   ```javascript
   // Convert SimpleMaps CSV/JSON to your format
   const data = require('./worldcities.csv'); // or use csv-parser
   const cities = {};
   
   data.forEach(city => {
     if (['DE', 'CH', 'AT'].includes(city.iso2)) {
       const key = `${city.iso2}-${city.city}`;
       cities[key] = [parseFloat(city.lng), parseFloat(city.lat)];
     }
   });
   
   fs.writeFileSync('city-coordinates.json', JSON.stringify(cities, null, 2));
   ```

### Option 3: Use OpenStreetMap Nominatim API (Dynamic)

For a smaller dataset or on-demand lookups:

```typescript
// In StatsView.vue - cache city coordinates
const cityCoordinateCache = new Map<string, [number, number]>();

async function getCityCoordinates(country: string, city: string): Promise<[number, number] | null> {
  const key = `${country}-${city}`;
  
  // Check cache first
  if (cityCoordinateCache.has(key)) {
    return cityCoordinateCache.get(key)!;
  }
  
  // Check hardcoded offsets
  if (cityOffsets[key]) {
    return cityOffsets[key];
  }
  
  try {
    // Lookup via Nominatim API
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)},${encodeURIComponent(country)}&format=json&limit=1`,
      {
        headers: {
          'User-Agent': 'YourApp/1.0' // Required by Nominatim
        }
      }
    );
    
    const data = await response.json();
    if (data.length > 0) {
      const coords: [number, number] = [parseFloat(data[0].lon), parseFloat(data[0].lat)];
      cityCoordinateCache.set(key, coords);
      return coords;
    }
  } catch (e) {
    console.error('Failed to lookup city coordinates:', e);
  }
  
  return null;
}
```

## Recommended Approach

For your use case (Germany, Switzerland, Austria), I recommend:

1. **Short term:** Add Heidelberg and other common cities to the `cityOffsets` map manually
2. **Medium term:** Download GeoNames or SimpleMaps data and create a JSON file with all cities in DE/CH/AT
3. **Long term:** Consider using a geocoding API for on-demand lookups with caching

## Adding Cities Manually (Quick Fix)

For now, you can add Heidelberg and other cities directly:

```typescript
const cityOffsets: Record<string, [number, number]> = {
  // ... existing cities ...
  'DE-Heidelberg': [8.6947, 49.3988],
  'DE-Karlsruhe': [8.4037, 49.0069],
  'DE-Mannheim': [8.4660, 49.4875],
  'DE-Freiburg': [7.8494, 47.9990],
  // Add more as needed...
};
```

## Data Format Reference

The coordinates should be in `[longitude, latitude]` format (as used by GeoJSON and D3):
- Longitude: -180 to 180 (East is positive)
- Latitude: -90 to 90 (North is positive)

Example: Heidelberg = `[8.6947, 49.3988]` (8.69°E, 49.40°N)

