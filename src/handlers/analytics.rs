use anyhow::{Context, Result};
use axum::{
    extract::{Query, State},
    http::{header, HeaderMap},
    response::IntoResponse,
    Json,
};
use chrono::Utc;
use moka::future::Cache;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

use crate::config::AppState;

#[derive(Debug, Deserialize)]
pub struct TrackRequest {
    pub path: String,
    pub route_name: Option<String>,
    pub podcast: Option<String>,
    pub episode: Option<String>,
    pub referrer: Option<String>,
    pub user_agent: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TrackResponse {
    pub success: bool,
}

#[derive(Debug, Deserialize)]
pub struct TrackEpisodePlayRequest {
    pub podcast: String,
    pub episode: String,
    pub user_agent: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct AnalyticsStats {
    pub unique_users: i64,
    pub total_page_views: i64,
    pub total_episode_plays: i64,
    pub top_pages: Vec<PageStats>,
    pub top_podcasts: Vec<PodcastStats>,
    pub top_played_podcasts: Vec<PodcastStats>,
    pub top_episodes: Vec<EpisodeStats>,
    pub top_played_episodes: Vec<EpisodeStats>,
    pub locations: Vec<LocationStats>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PageStats {
    pub path: String,
    pub route_name: Option<String>,
    pub views: i64,
    pub unique_users: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct PodcastStats {
    pub podcast: String,
    pub views: i64,
    pub unique_users: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct EpisodeStats {
    pub podcast: String,
    pub episode: String,
    pub views: i64,
    pub unique_users: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct LocationStats {
    pub country: Option<String>,
    pub city: Option<String>,
    pub views: i64,
    pub unique_users: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latitude: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub longitude: Option<f64>,
}

pub struct AnalyticsDb {
    conn: Arc<Mutex<Connection>>,
    geoip_db: Option<maxminddb::Reader<Vec<u8>>>,
    stats_cache: Cache<Option<i64>, AnalyticsStats>,
    city_coordinates: Arc<std::collections::HashMap<String, (f64, f64)>>, // Key: "country-city", Value: (lat, lng)
}

impl AnalyticsDb {
    pub fn new(db_path: &PathBuf, geoip_db_path: Option<&PathBuf>) -> Result<Self> {
        // Create database directory if it doesn't exist
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create database directory: {:?}", parent))?;
        }

        let mut conn = Connection::open(db_path)
            .with_context(|| format!("Failed to open database: {:?}", db_path))?;

        // Enable WAL mode for better concurrency (reads don't block writes)
        conn.pragma_update(None, "journal_mode", "WAL")?;
        
        // Set synchronous mode to NORMAL for better write performance
        // (WAL mode makes this safe - data is still durable)
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        
        // Increase cache size for better performance (default is 2MB, set to 64MB)
        conn.pragma_update(None, "cache_size", "-65536")?; // Negative = KB, so -65536 = 64MB
        
        // Set busy timeout to handle concurrent access gracefully
        conn.busy_timeout(std::time::Duration::from_secs(5))?;

        // Create tables
        conn.execute(
            "CREATE TABLE IF NOT EXISTS page_views (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_fingerprint TEXT NOT NULL,
                path TEXT NOT NULL,
                route_name TEXT,
                podcast TEXT,
                episode TEXT,
                country TEXT,
                city TEXT,
                referrer TEXT,
                user_agent TEXT,
                ip_address TEXT,
                created_at TEXT NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_user_fingerprint ON page_views(user_fingerprint)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_path ON page_views(path)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_podcast ON page_views(podcast)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_episode ON page_views(episode)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_created_at ON page_views(created_at)",
            [],
        )?;

        // Composite index for common stats queries (created_at + podcast + episode)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_stats ON page_views(created_at, podcast, episode)",
            [],
        )?;

        // Create episode_plays table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS episode_plays (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_fingerprint TEXT NOT NULL,
                podcast TEXT NOT NULL,
                episode TEXT NOT NULL,
                user_agent TEXT,
                ip_address TEXT,
                created_at TEXT NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_episode_plays_user ON episode_plays(user_fingerprint)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_episode_plays_podcast ON episode_plays(podcast)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_episode_plays_episode ON episode_plays(episode)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_episode_plays_created_at ON episode_plays(created_at)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_episode_plays_stats ON episode_plays(created_at, podcast, episode)",
            [],
        )?;

        // Initialize stats cache (5 minute TTL, 1 minute idle)
        let stats_cache = Cache::builder()
            .max_capacity(10) // Cache up to 10 different time ranges
            .time_to_live(Duration::from_secs(300)) // 5 minutes
            .time_to_idle(Duration::from_secs(60)) // 1 minute
            .build();

        // Load GeoIP database if provided
        let geoip_db = if let Some(geoip_path) = geoip_db_path {
            if geoip_path.exists() {
                let db_bytes = std::fs::read(geoip_path)
                    .with_context(|| format!("Failed to read GeoIP database: {:?}", geoip_path))?;
                Some(
                    maxminddb::Reader::from_source(db_bytes)
                        .with_context(|| "Failed to parse GeoIP database")?,
                )
            } else {
                tracing::warn!("GeoIP database not found at {:?}, location tracking disabled", geoip_path);
                None
            }
        } else {
            None
        };

        // Load city coordinates from worldcities.csv if available
        let city_coordinates = Self::load_city_coordinates().unwrap_or_else(|e| {
            tracing::warn!("Failed to load city coordinates: {}. City coordinates will not be available.", e);
            HashMap::new()
        });

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            geoip_db,
            stats_cache,
            city_coordinates: Arc::new(city_coordinates),
        })
    }

    fn load_city_coordinates() -> Result<HashMap<String, (f64, f64)>> {
        let csv_path = PathBuf::from("worldcities.csv");
        if !csv_path.exists() {
            return Err(anyhow::anyhow!("worldcities.csv not found"));
        }

        let mut coordinates = HashMap::new();
        let content = std::fs::read_to_string(&csv_path)
            .with_context(|| format!("Failed to read worldcities.csv"))?;
        
        let mut lines = content.lines();
        // Skip header
        lines.next();
        
        for line in lines {
            if line.trim().is_empty() {
                continue;
            }
            
            // Parse CSV line (handling quoted fields)
            let fields: Vec<String> = line
                .split(',')
                .map(|s| {
                    s.trim_matches('"').trim().to_string()
                })
                .collect();
            
            if fields.len() < 6 {
                continue;
            }
            
            // Format: city, city_ascii, lat, lng, country, iso2, ...
            let city = fields.get(0).map(|s| s.trim().to_string());
            let lat_str = fields.get(2).and_then(|s| s.parse::<f64>().ok());
            let lng_str = fields.get(3).and_then(|s| s.parse::<f64>().ok());
            let iso2 = fields.get(5).map(|s| s.trim().to_uppercase());
            
            if let (Some(city_name), Some(lat), Some(lng), Some(country_code)) = (city, lat_str, lng_str, iso2) {
                // Create lookup key: "COUNTRY-CITY" (uppercase for consistency)
                let key = format!("{}-{}", country_code, city_name.to_uppercase());
                coordinates.insert(key, (lat, lng));
                
                // Also add city_ascii variant if different
                if let Some(city_ascii) = fields.get(1) {
                    let city_ascii_upper = city_ascii.trim().to_uppercase();
                    if city_ascii_upper != city_name.to_uppercase() {
                        let key_ascii = format!("{}-{}", country_code, city_ascii_upper);
                        coordinates.insert(key_ascii, (lat, lng));
                    }
                }
            }
        }
        
        tracing::info!("Loaded {} city coordinates from worldcities.csv", coordinates.len());
        Ok(coordinates)
    }

    fn get_city_coordinates(&self, country: &Option<String>, city: &Option<String>) -> Option<(f64, f64)> {
        let country_code = country.as_ref()?.to_uppercase();
        let city_name = city.as_ref()?.to_uppercase();
        let key = format!("{}-{}", country_code, city_name);
        self.city_coordinates.get(&key).copied()
    }

    fn get_user_fingerprint(ip: &str, user_agent: &str) -> String {
        let combined = format!("{}:{}", ip, user_agent);
        let mut hasher = Sha256::new();
        hasher.update(combined.as_bytes());
        let hash = hasher.finalize();
        hex::encode(&hash[..16]) // Use first 16 bytes for fingerprint
    }

    fn lookup_location(&self, ip: &str) -> (Option<String>, Option<String>) {
        if let Some(ref reader) = self.geoip_db {
            // Parse IP address
            let ip_addr: std::net::IpAddr = match ip.parse() {
                Ok(addr) => addr,
                Err(_) => return (None, None),
            };

            // Lookup in GeoIP database
            match reader.lookup::<maxminddb::geoip2::City>(ip_addr) {
                Ok(city) => {
                    let country = city
                        .country
                        .and_then(|c| c.iso_code)
                        .map(|s| s.to_string());
                    let city_name = city
                        .city
                        .and_then(|c| c.names)
                        .and_then(|n| n.get("en").map(|s| s.to_string()));
                    (country, city_name)
                }
                Err(_) => (None, None),
            }
        } else {
            (None, None)
        }
    }

    pub async fn track_page_view(
        &self,
        req: TrackRequest,
        ip: String,
        user_agent: String,
    ) -> Result<()> {
        let fingerprint = Self::get_user_fingerprint(&ip, &user_agent);
        let (country, city) = self.lookup_location(&ip);
        let created_at = Utc::now().to_rfc3339();

        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO page_views (user_fingerprint, path, route_name, podcast, episode, country, city, referrer, user_agent, ip_address, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                fingerprint,
                req.path,
                req.route_name,
                req.podcast,
                req.episode,
                country,
                city,
                req.referrer,
                user_agent,
                ip,
                created_at
            ],
        )?;

        // Invalidate stats cache since we added new data
        self.stats_cache.invalidate_all();

        Ok(())
    }

    pub async fn track_episode_play(
        &self,
        req: TrackEpisodePlayRequest,
        ip: String,
        user_agent: String,
    ) -> Result<()> {
        let fingerprint = Self::get_user_fingerprint(&ip, &user_agent);
        let created_at = Utc::now().to_rfc3339();

        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO episode_plays (user_fingerprint, podcast, episode, user_agent, ip_address, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                fingerprint,
                req.podcast,
                req.episode,
                user_agent,
                ip,
                created_at
            ],
        )?;

        // Invalidate stats cache since we added new data
        self.stats_cache.invalidate_all();

        Ok(())
    }

    pub async fn insert_test_data(&self, count: usize) -> Result<()> {
        let conn = self.conn.lock().await;
        
        // German cities with approximate IP ranges (for testing)
        let german_cities = vec![
            ("Berlin", "DE", "178.63.0.0"),
            ("Munich", "DE", "178.64.0.0"),
            ("Hamburg", "DE", "178.65.0.0"),
            ("Cologne", "DE", "178.66.0.0"),
            ("Frankfurt", "DE", "178.67.0.0"),
            ("Stuttgart", "DE", "178.68.0.0"),
            ("Düsseldorf", "DE", "178.69.0.0"),
            ("Dortmund", "DE", "178.70.0.0"),
            ("Essen", "DE", "178.71.0.0"),
            ("Leipzig", "DE", "178.72.0.0"),
        ];

        let routes = vec![
            ("/episode-search", "episodeSearch"),
            ("/search", "search"),
            ("/clusters-river", "clusters-river"),
            ("/subjects-river", "subjects-river"),
            ("/speakers-river", "speakers-river"),
            ("/umap", "umap"),
        ];

        let podcasts = vec!["freakshow", "lnp", "cre", "raumzeit"];
        let user_agents = vec![
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
            "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15",
        ];

        let now = Utc::now();
        
        for i in 0..count {
            // Random city
            let city_idx = i % german_cities.len();
            let (city, country, base_ip) = german_cities[city_idx];
            
            // Generate unique IP by adding offset
            let ip_parts: Vec<&str> = base_ip.split('.').collect();
            let ip = if ip_parts.len() >= 3 {
                format!("{}.{}.{}.{}", ip_parts[0], ip_parts[1], ip_parts[2], (i / german_cities.len()) % 255)
            } else {
                format!("{}.{}", base_ip, (i / german_cities.len()) % 255)
            };
            
            // Random route
            let route_idx = i % routes.len();
            let (path, route_name) = routes[route_idx];
            
            // Random podcast (sometimes null)
            let podcast = if i % 3 == 0 {
                None
            } else {
                Some(podcasts[i % podcasts.len()].to_string())
            };
            
            // Random episode (sometimes null)
            let episode = if podcast.is_some() && i % 2 == 0 {
                Some((100 + (i % 300)).to_string())
            } else {
                None
            };
            
            // Random user agent
            let user_agent = user_agents[i % user_agents.len()];
            
            // Random timestamp within last 30 days
            let days_ago = (i % 30) as i64;
            let hours_ago = (i % 24) as i64;
            let created_at = (now - chrono::Duration::days(days_ago) - chrono::Duration::hours(hours_ago))
                .to_rfc3339();
            
            // Generate fingerprint
            let fingerprint = Self::get_user_fingerprint(&ip, user_agent);
            
            // Use test data directly (don't rely on GeoIP lookup for test IPs)
            let final_country = Some(country.to_string());
            let final_city = Some(city.to_string());
            
            conn.execute(
                "INSERT INTO page_views (user_fingerprint, path, route_name, podcast, episode, country, city, referrer, user_agent, ip_address, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    fingerprint,
                    path,
                    route_name,
                    podcast,
                    episode,
                    final_country,
                    final_city,
                    None::<String>,
                    user_agent,
                    ip,
                    created_at
                ],
            )?;
        }

        // Invalidate stats cache
        self.stats_cache.invalidate_all();

        Ok(())
    }

    pub async fn get_stats(&self, days: Option<i64>) -> Result<AnalyticsStats> {
        // Check cache first
        if let Some(cached_stats) = self.stats_cache.get(&days).await {
            return Ok(cached_stats);
        }

        let conn = self.conn.lock().await;
        let since = if let Some(d) = days {
            let cutoff = Utc::now() - chrono::Duration::days(d);
            Some(cutoff.to_rfc3339())
        } else {
            None
        };

        // Helper function to map PageStats
        fn map_page_stats(row: &rusqlite::Row<'_>) -> rusqlite::Result<PageStats> {
            Ok(PageStats {
                path: row.get(0)?,
                route_name: row.get(1)?,
                views: row.get(2)?,
                unique_users: row.get(3)?,
            })
        }

        // Helper function to map PodcastStats
        fn map_podcast_stats(row: &rusqlite::Row<'_>) -> rusqlite::Result<PodcastStats> {
            Ok(PodcastStats {
                podcast: row.get(0)?,
                views: row.get(1)?,
                unique_users: row.get(2)?,
            })
        }

        // Helper function to map EpisodeStats
        fn map_episode_stats(row: &rusqlite::Row<'_>) -> rusqlite::Result<EpisodeStats> {
            Ok(EpisodeStats {
                podcast: row.get(0)?,
                episode: row.get(1)?,
                views: row.get(2)?,
                unique_users: row.get(3)?,
            })
        }

        // Helper function to map LocationStats (without coordinates - we'll enrich later)
        fn map_location_stats_raw(row: &rusqlite::Row<'_>) -> rusqlite::Result<(Option<String>, Option<String>, i64, i64)> {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
            ))
        }

        // Unique users
        let unique_users: i64 = if let Some(ref since_str) = since {
            conn.query_row(
                "SELECT COUNT(DISTINCT user_fingerprint) FROM page_views WHERE created_at >= ?1",
                params![since_str],
                |row| row.get(0),
            )?
        } else {
            conn.query_row(
                "SELECT COUNT(DISTINCT user_fingerprint) FROM page_views",
                [],
                |row| row.get(0),
            )?
        };

        // Total page views
        let total_page_views: i64 = if let Some(ref since_str) = since {
            conn.query_row(
                "SELECT COUNT(*) FROM page_views WHERE created_at >= ?1",
                params![since_str],
                |row| row.get(0),
            )?
        } else {
            conn.query_row("SELECT COUNT(*) FROM page_views", [], |row| row.get(0))?
        };

        // Total episode plays
        let total_episode_plays: i64 = if let Some(ref since_str) = since {
            conn.query_row(
                "SELECT COUNT(*) FROM episode_plays WHERE created_at >= ?1",
                params![since_str],
                |row| row.get(0),
            )?
        } else {
            conn.query_row("SELECT COUNT(*) FROM episode_plays", [], |row| row.get(0))?
        };

        // Top pages
        let top_pages = if let Some(ref since_str) = since {
            conn.prepare(
                "SELECT path, route_name, COUNT(*) as views, COUNT(DISTINCT user_fingerprint) as unique_users
                 FROM page_views
                 WHERE created_at >= ?1
                 GROUP BY path, route_name
                 ORDER BY views DESC
                 LIMIT 20",
            )?
            .query_map(params![since_str], map_page_stats)?
            .collect::<Result<Vec<_>, _>>()?
        } else {
            conn.prepare(
                "SELECT path, route_name, COUNT(*) as views, COUNT(DISTINCT user_fingerprint) as unique_users
                 FROM page_views
                 GROUP BY path, route_name
                 ORDER BY views DESC
                 LIMIT 20",
            )?
            .query_map([], map_page_stats)?
            .collect::<Result<Vec<_>, _>>()?
        };

        // Top podcasts (from page views)
        let top_podcasts = if let Some(ref since_str) = since {
            conn.prepare(
                "SELECT podcast, COUNT(*) as views, COUNT(DISTINCT user_fingerprint) as unique_users
                 FROM page_views
                 WHERE podcast IS NOT NULL AND created_at >= ?1
                 GROUP BY podcast
                 ORDER BY views DESC
                 LIMIT 20",
            )?
            .query_map(params![since_str], map_podcast_stats)?
            .collect::<Result<Vec<_>, _>>()?
        } else {
            conn.prepare(
                "SELECT podcast, COUNT(*) as views, COUNT(DISTINCT user_fingerprint) as unique_users
                 FROM page_views
                 WHERE podcast IS NOT NULL
                 GROUP BY podcast
                 ORDER BY views DESC
                 LIMIT 20",
            )?
            .query_map([], map_podcast_stats)?
            .collect::<Result<Vec<_>, _>>()?
        };

        // Top played podcasts (from episode_plays table)
        let top_played_podcasts = if let Some(ref since_str) = since {
            conn.prepare(
                "SELECT podcast, COUNT(*) as views, COUNT(DISTINCT user_fingerprint) as unique_users
                 FROM episode_plays
                 WHERE created_at >= ?1
                 GROUP BY podcast
                 ORDER BY views DESC
                 LIMIT 20",
            )?
            .query_map(params![since_str], map_podcast_stats)?
            .collect::<Result<Vec<_>, _>>()?
        } else {
            conn.prepare(
                "SELECT podcast, COUNT(*) as views, COUNT(DISTINCT user_fingerprint) as unique_users
                 FROM episode_plays
                 GROUP BY podcast
                 ORDER BY views DESC
                 LIMIT 20",
            )?
            .query_map([], map_podcast_stats)?
            .collect::<Result<Vec<_>, _>>()?
        };

        // Top episodes
        let top_episodes = if let Some(ref since_str) = since {
            conn.prepare(
                "SELECT podcast, episode, COUNT(*) as views, COUNT(DISTINCT user_fingerprint) as unique_users
                 FROM page_views
                 WHERE podcast IS NOT NULL AND episode IS NOT NULL AND created_at >= ?1
                 GROUP BY podcast, episode
                 ORDER BY views DESC
                 LIMIT 20",
            )?
            .query_map(params![since_str], map_episode_stats)?
            .collect::<Result<Vec<_>, _>>()?
        } else {
            conn.prepare(
                "SELECT podcast, episode, COUNT(*) as views, COUNT(DISTINCT user_fingerprint) as unique_users
                 FROM page_views
                 WHERE podcast IS NOT NULL AND episode IS NOT NULL
                 GROUP BY podcast, episode
                 ORDER BY views DESC
                 LIMIT 20",
            )?
            .query_map([], map_episode_stats)?
            .collect::<Result<Vec<_>, _>>()?
        };

        // Locations (enriched with coordinates)
        let locations_raw = if let Some(ref since_str) = since {
            conn.prepare(
                "SELECT country, city, COUNT(*) as views, COUNT(DISTINCT user_fingerprint) as unique_users
                 FROM page_views
                 WHERE (country IS NOT NULL OR city IS NOT NULL) AND created_at >= ?1
                 GROUP BY country, city
                 ORDER BY views DESC
                 LIMIT 50",
            )?
            .query_map(params![since_str], map_location_stats_raw)?
            .collect::<Result<Vec<_>, _>>()?
        } else {
            conn.prepare(
                "SELECT country, city, COUNT(*) as views, COUNT(DISTINCT user_fingerprint) as unique_users
                 FROM page_views
                 WHERE country IS NOT NULL OR city IS NOT NULL
                 GROUP BY country, city
                 ORDER BY views DESC
                 LIMIT 50",
            )?
            .query_map([], map_location_stats_raw)?
            .collect::<Result<Vec<_>, _>>()?
        };
        
        // Enrich locations with coordinates
        let locations: Vec<LocationStats> = locations_raw
            .into_iter()
            .map(|(country, city, views, unique_users)| {
                let coords = self.get_city_coordinates(&country, &city);
                LocationStats {
                    country,
                    city,
                    views,
                    unique_users,
                    latitude: coords.map(|(lat, _)| lat),
                    longitude: coords.map(|(_, lng)| lng),
                }
            })
            .collect();

        // Top played episodes (from episode_plays table)
        let top_played_episodes = if let Some(ref since_str) = since {
            conn.prepare(
                "SELECT podcast, episode, COUNT(*) as views, COUNT(DISTINCT user_fingerprint) as unique_users
                 FROM episode_plays
                 WHERE created_at >= ?1
                 GROUP BY podcast, episode
                 ORDER BY views DESC
                 LIMIT 20",
            )?
            .query_map(params![since_str], map_episode_stats)?
            .collect::<Result<Vec<_>, _>>()?
        } else {
            conn.prepare(
                "SELECT podcast, episode, COUNT(*) as views, COUNT(DISTINCT user_fingerprint) as unique_users
                 FROM episode_plays
                 GROUP BY podcast, episode
                 ORDER BY views DESC
                 LIMIT 20",
            )?
            .query_map([], map_episode_stats)?
            .collect::<Result<Vec<_>, _>>()?
        };

        let stats = AnalyticsStats {
            unique_users,
            total_page_views,
            total_episode_plays,
            top_pages,
            top_podcasts,
            top_played_podcasts,
            top_episodes,
            top_played_episodes,
            locations,
        };

        // Cache the result
        self.stats_cache.insert(days, stats.clone()).await;

        Ok(stats)
    }
}

fn extract_ip_from_headers(headers: &HeaderMap) -> String {
    // Try X-Forwarded-For first (for proxies/load balancers)
    if let Some(forwarded) = headers.get("x-forwarded-for") {
        if let Ok(forwarded_str) = forwarded.to_str() {
            // Take the first IP in the chain
            if let Some(ip) = forwarded_str.split(',').next() {
                return ip.trim().to_string();
            }
        }
    }

    // Try X-Real-IP
    if let Some(real_ip) = headers.get("x-real-ip") {
        if let Ok(ip_str) = real_ip.to_str() {
            return ip_str.to_string();
        }
    }

    // Fallback to a placeholder (in production, you'd get this from the connection)
    "unknown".to_string()
}

pub async fn track(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<TrackRequest>,
) -> impl IntoResponse {
    let ip = extract_ip_from_headers(&headers);
    let user_agent = req
        .user_agent
        .clone()
        .or_else(|| {
            headers
                .get("user-agent")
                .and_then(|h| h.to_str().ok())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "unknown".to_string());

    // Track the page view (fire and forget - don't block response)
    let analytics_db = state.analytics_db.clone();
    tokio::spawn(async move {
        if let Err(e) = analytics_db.track_page_view(req, ip, user_agent).await {
            tracing::warn!("Failed to track page view: {}", e);
        }
    });

    Json(TrackResponse { success: true })
}

pub async fn track_episode_play(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<TrackEpisodePlayRequest>,
) -> impl IntoResponse {
    let ip = extract_ip_from_headers(&headers);
    let user_agent = req
        .user_agent
        .clone()
        .or_else(|| {
            headers
                .get("user-agent")
                .and_then(|h| h.to_str().ok())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "unknown".to_string());

    // Track the episode play (fire and forget - don't block response)
    let analytics_db = state.analytics_db.clone();
    tokio::spawn(async move {
        if let Err(e) = analytics_db.track_episode_play(req, ip, user_agent).await {
            tracing::warn!("Failed to track episode play: {}", e);
        }
    });

    Json(TrackResponse { success: true })
}

#[derive(Debug, Deserialize)]
pub struct StatsQuery {
    pub days: Option<i64>,
}

fn extract_auth_token(headers: &HeaderMap) -> Option<String> {
    // Prefer explicit x-auth-token, but also accept Authorization: Bearer <token>
    if let Some(v) = headers.get("x-auth-token").and_then(|v| v.to_str().ok()) {
        let t = v.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }

    if let Some(v) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        let s = v.trim();
        if let Some(rest) = s.strip_prefix("Bearer ").or_else(|| s.strip_prefix("bearer ")) {
            let t = rest.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }

    None
}

fn is_stats_auth_ok(cfg: &crate::config::AppConfig, headers: &HeaderMap) -> bool {
    let Some(expected) = cfg.stats_auth_token.as_ref() else {
        // No auth configured => allow.
        return true;
    };
    let Some(got) = extract_auth_token(headers) else {
        return false;
    };
    got == *expected
}

pub async fn stats(
    Query(params): Query<StatsQuery>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if !is_stats_auth_ok(&state.cfg, &headers) {
        return (
            axum::http::StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "permission denied" })),
        )
            .into_response();
    }

    match state.analytics_db.get_stats(params.days).await {
        Ok(stats) => Json(stats).into_response(),
        Err(e) => {
            tracing::error!("Failed to get analytics stats: {}", e);
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to get analytics stats" })),
            )
                .into_response()
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct TestDataQuery {
    pub count: Option<usize>,
}

pub async fn insert_test_data_endpoint(
    Query(params): Query<TestDataQuery>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if !is_stats_auth_ok(&state.cfg, &headers) {
        return (
            axum::http::StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "permission denied" })),
        )
            .into_response();
    }

    let count = params.count.unwrap_or(100);
    
    match state.analytics_db.insert_test_data(count).await {
        Ok(_) => Json(serde_json::json!({ 
            "success": true, 
            "message": format!("Inserted {} test page views", count),
            "count": count
        })).into_response(),
        Err(e) => {
            tracing::error!("Failed to insert test data: {}", e);
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("Failed to insert test data: {}", e) })),
            )
                .into_response()
        }
    }
}

