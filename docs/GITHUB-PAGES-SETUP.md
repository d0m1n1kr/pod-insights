# GitHub Pages Setup Guide

This guide explains how to use GitHub Pages as a CDN for serving podcast data files.

## Overview

GitHub Pages can serve static files from your repository, making it a good option for hosting your podcast data files. The files in `frontend/public/` will be accessible via GitHub Pages URLs.

## Setup Options

### Option 1: GitHub Pages from `/docs` folder (Recommended)

This is the simplest approach and doesn't require a separate branch.

1. **Create a `docs` folder in your repository root** (if it doesn't exist)
2. **Copy or symlink `frontend/public` to `docs/public`**
3. **Enable GitHub Pages**:
   - Go to your repository on GitHub
   - Settings → Pages
   - Source: Deploy from a branch
   - Branch: `main` (or your default branch)
   - Folder: `/docs`
   - Save

4. **Your files will be available at:**
   ```
   https://d0m1n1kr.github.io/pod-insights/public/podcasts/freakshow/episodes.json
   ```

5. **Set CDN base URL:**
   ```bash
   export VITE_CDN_BASE_URL="https://d0m1n1kr.github.io/pod-insights/public"
   ```

### Option 2: GitHub Pages from `gh-pages` branch

This keeps your main branch clean but requires maintaining a separate branch.

1. **Create and checkout `gh-pages` branch:**
   ```bash
   git checkout --orphan gh-pages
   git rm -rf .
   ```

2. **Copy public folder contents:**
   ```bash
   cp -r frontend/public/* .
   git add .
   git commit -m "Initial GitHub Pages setup"
   git push origin gh-pages
   ```

3. **Enable GitHub Pages**:
   - Settings → Pages
   - Source: Deploy from a branch
   - Branch: `gh-pages`
   - Folder: `/ (root)`
   - Save

4. **Your files will be available at:**
   ```
   https://d0m1n1kr.github.io/pod-insights/podcasts/freakshow/episodes.json
   ```

5. **Set CDN base URL:**
   ```bash
   export VITE_CDN_BASE_URL="https://d0m1n1kr.github.io/pod-insights"
   ```

### Option 3: GitHub Actions Automatic Deployment (Best for CI/CD)

This automatically deploys whenever you push to main.

1. **Create `.github/workflows/deploy-pages.yml`:**
   ```yaml
   name: Deploy to GitHub Pages
   
   on:
     push:
       branches:
         - main
       paths:
         - 'frontend/public/**'
   
   permissions:
     contents: read
     pages: write
     id-token: write
   
   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         
         - name: Setup Pages
           uses: actions/configure-pages@v4
           
         - name: Copy public files
           run: |
             mkdir -p _site
             cp -r frontend/public/* _site/
             
         - name: Upload artifact
           uses: actions/upload-pages-artifact@v3
           with:
             path: '_site'
             
         - name: Deploy to GitHub Pages
           id: deployment
           uses: actions/deploy-pages@v4
   ```

2. **Enable GitHub Pages**:
   - Settings → Pages
   - Source: GitHub Actions
   - Save

3. **Your files will be available at:**
   ```
   https://d0m1n1kr.github.io/pod-insights/podcasts/freakshow/episodes.json
   ```

4. **Set CDN base URL:**
   ```bash
   export VITE_CDN_BASE_URL="https://d0m1n1kr.github.io/pod-insights"
   ```

## Updating Files

### Manual Update (Option 1 or 2)

When you update files in `frontend/public/`, you need to sync them:

**For `/docs` approach:**
```bash
# Create symlink (one-time setup)
ln -s ../frontend/public docs/public

# Or copy files (if symlinks don't work)
cp -r frontend/public/* docs/public/
git add docs/
git commit -m "Update GitHub Pages files"
git push
```

**For `gh-pages` branch:**
```bash
git checkout gh-pages
cp -r frontend/public/* .
git add .
git commit -m "Update GitHub Pages files"
git push origin gh-pages
git checkout main
```

### Automatic Update (Option 3)

Files are automatically deployed when you push changes to `frontend/public/` to the `main` branch.

## Using GitHub Pages CDN in Your Frontend

### Development

Create a `.env` file in `frontend/`:

```bash
# frontend/.env
VITE_CDN_BASE_URL=https://d0m1n1kr.github.io/pod-insights/public
```

Or for Option 2/3 (root deployment):
```bash
# frontend/.env
VITE_CDN_BASE_URL=https://d0m1n1kr.github.io/pod-insights
```

### Production Build

```bash
cd frontend
VITE_CDN_BASE_URL=https://d0m1n1kr.github.io/pod-insights/public npm run build
```

## GitHub Pages Limits

- **Bandwidth**: 100 GB/month (soft limit)
- **Repository size**: 1 GB recommended, 5 GB hard limit
- **Site size**: 1 GB maximum
- **Builds**: 10 builds per hour

## Custom Domain (Optional)

You can use a custom domain with GitHub Pages:

1. Add a `CNAME` file to your Pages root:
   ```
   cdn.yourdomain.com
   ```

2. Configure DNS:
   - Type: `CNAME`
   - Name: `cdn` (or subdomain of choice)
   - Value: `d0m1n1kr.github.io`

3. Update CDN base URL:
   ```bash
   export VITE_CDN_BASE_URL="https://cdn.yourdomain.com/pod-insights/public"
   ```

## Troubleshooting

### Files not updating
- GitHub Pages can take a few minutes to update
- Check Actions tab for deployment status (if using Option 3)
- Clear browser cache

### 404 errors
- Verify the path structure matches your GitHub Pages setup
- Check that files exist in the deployed location
- Ensure GitHub Pages is enabled in repository settings

### CORS issues
- GitHub Pages serves files with proper CORS headers
- If you encounter CORS errors, check that your CDN base URL is correct

## Recommended Approach

For this project, **Option 3 (GitHub Actions)** is recommended because:
- Automatic deployment on file updates
- No manual branch switching
- Keeps main branch clean
- Easy to maintain

