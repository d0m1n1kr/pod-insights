# Nginx Configuration for GeoIP Analytics

This document explains how to configure nginx to ensure GeoIP location tracking works correctly in the analytics system.

## Overview

The backend analytics system extracts the client IP address from HTTP headers and uses MaxMind GeoLite2 database to determine the user's location. For this to work correctly, nginx must pass the real client IP address to the backend.

## Required Nginx Configuration

### Basic Configuration

Add these directives to your nginx server block:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Pass real client IP to backend
    # Option 1: Use X-Real-IP header (recommended for direct nginx -> backend)
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Host $host;

    # Pass User-Agent for fingerprinting
    proxy_set_header User-Agent $http_user_agent;

    location / {
        proxy_pass http://127.0.0.1:7878;  # Your backend address
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

### If Behind a Proxy/CDN (Cloudflare, etc.)

If your nginx is behind a proxy or CDN (like Cloudflare), you need to configure the `real_ip` module to trust the proxy:

```nginx
# At the http level (before server blocks)
http {
    # Trust Cloudflare IPs (if using Cloudflare)
    # Get latest IP ranges from: https://www.cloudflare.com/ips/
    set_real_ip_from 173.245.48.0/20;
    set_real_ip_from 103.21.244.0/22;
    set_real_ip_from 103.22.200.0/22;
    set_real_ip_from 103.31.4.0/22;
    set_real_ip_from 141.101.64.0/18;
    set_real_ip_from 108.162.192.0/18;
    set_real_ip_from 190.93.240.0/20;
    set_real_ip_from 188.114.96.0/20;
    set_real_ip_from 197.234.240.0/22;
    set_real_ip_from 198.41.128.0/17;
    set_real_ip_from 162.158.0.0/15;
    set_real_ip_from 104.16.0.0/13;
    set_real_ip_from 104.24.0.0/14;
    set_real_ip_from 172.64.0.0/13;
    set_real_ip_from 131.0.72.0/22;
    set_real_ip_from 2400:cb00::/32;
    set_real_ip_from 2606:4700::/32;
    set_real_ip_from 2803:f800::/32;
    set_real_ip_from 2405:b500::/32;
    set_real_ip_from 2405:8100::/32;
    set_real_ip_from 2a06:98c0::/29;
    set_real_ip_from 2c0f:f248::/32;
    
    # Use CF-Connecting-IP header from Cloudflare
    real_ip_header CF-Connecting-IP;
    # Or use X-Forwarded-For for other proxies
    # real_ip_header X-Forwarded-For;
    
    # ... rest of your http block
}

server {
    listen 80;
    server_name your-domain.com;

    # Pass the real IP to backend
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    
    # If using Cloudflare, also pass CF-Connecting-IP
    proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
    
    location / {
        proxy_pass http://127.0.0.1:7878;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

### For Other Proxies/Load Balancers

If you're behind a different proxy or load balancer:

```nginx
http {
    # Trust your proxy/load balancer IPs
    set_real_ip_from 10.0.0.0/8;        # Example: internal network
    set_real_ip_from 172.16.0.0/12;     # Example: Docker network
    set_real_ip_from 192.168.0.0/16;    # Example: private network
    
    # Use X-Forwarded-For header
    real_ip_header X-Forwarded-For;
    real_ip_recursive on;  # Process all trusted proxies in chain
}

server {
    # ... server configuration
    
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

## Backend IP Extraction Priority

The backend extracts IP addresses in this order:

1. **X-Forwarded-For** header (takes the first IP if multiple)
2. **X-Real-IP** header
3. Falls back to `"unknown"` if neither is present

## Testing

To verify the configuration works:

1. **Check headers are being passed:**
   ```bash
   curl -H "X-Forwarded-For: 8.8.8.8" http://your-domain.com/api/analytics/track
   ```

2. **Check nginx logs:**
   ```bash
   tail -f /var/log/nginx/access.log
   ```

3. **Check backend logs:**
   Look for GeoIP lookup messages in your backend logs. If GeoIP database is loaded, you should see location data in analytics.

## GeoIP Database Setup

The backend needs the MaxMind GeoLite2-City database:

1. **Download the database:**
   - Sign up at https://www.maxmind.com/en/geolite2/signup
   - Download `GeoLite2-City.mmdb`

2. **Place it in your project root** or set `GEOIP_DB_PATH` environment variable:
   ```bash
   export GEOIP_DB_PATH=/path/to/GeoLite2-City.mmdb
   ```

3. **Or place it in the project root:**
   ```bash
   cp GeoLite2-City.mmdb /path/to/freakshow/
   ```

## Complete Example Configuration

Here's a complete nginx configuration example:

```nginx
http {
    # Basic settings
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    # Logging
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;
    
    # If behind Cloudflare (adjust IP ranges as needed)
    set_real_ip_from 173.245.48.0/20;
    set_real_ip_from 103.21.244.0/22;
    # ... add all Cloudflare IP ranges
    real_ip_header CF-Connecting-IP;
    
    upstream backend {
        server 127.0.0.1:7878;
    }
    
    server {
        listen 80;
        server_name your-domain.com;
        
        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        
        # Pass real client IP to backend
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Host $host;
        proxy_set_header User-Agent $http_user_agent;
        
        # If using Cloudflare
        proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
        
        # Backend proxy
        location / {
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
            proxy_buffering off;
        }
        
        # Static files (if serving frontend through nginx)
        location /static/ {
            alias /path/to/frontend/dist/;
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
}
```

## Troubleshooting

### IP shows as "unknown"

1. Check that nginx is passing headers:
   ```bash
   # Add to nginx config temporarily for debugging
   add_header X-Debug-Real-IP $remote_addr always;
   add_header X-Debug-Forwarded $http_x_forwarded_for always;
   ```

2. Check backend logs for IP extraction:
   Look for the actual IP being received in backend logs.

3. Verify GeoIP database is loaded:
   Check backend startup logs for "GeoIP database loaded successfully"

### Wrong location data

1. Verify the GeoIP database is up to date (download latest version)
2. Check that the IP being passed is the real client IP, not a proxy IP
3. Test with a known IP address to verify GeoIP lookup works

## Notes

- The backend does the GeoIP lookup, not nginx, so you don't need nginx GeoIP module
- Make sure to update the GeoIP database regularly (MaxMind updates it weekly)
- If you're using Docker, ensure the GeoIP database file is mounted/accessible to the container

