# Photo URL & Visual Quality Refresh Guide

When properties on Redfin gain new photos or photo URLs change, you can force a refresh from GitHub Actions or locally.

## From GitHub Actions (Recommended)

1. Go to **Actions** → **Deploy Dashboard** workflow
2. Click **"Run workflow"** dropdown
3. Configure the options:

### Common Scenarios

#### Refresh All Photos & VQ Scores
- **tier**: `all` (or leave empty for `--if-stale`)
- **force_photos**: ✅ (checked)
- **force_visual_quality**: ✅ (checked)

This will:
- Re-fetch all photo URLs from Redfin (ignores cache)
- Re-score all properties with CLIP embeddings
- Update the dashboard with new photos and scores

#### Refresh Only Active Listings
- **tier**: `active`
- **force_photos**: ✅ (checked)
- **force_visual_quality**: ✅ (checked)

Faster option if you only care about currently listed properties.

#### Refresh Photos Only (Keep Existing VQ)
- **tier**: `all` (or specific tier)
- **force_photos**: ✅ (checked)
- **force_visual_quality**: ❌ (unchecked)

Useful when properties have new photos but you don't need to re-score everything.

#### Refresh VQ Only (No Photo Refetch)
- **tier**: `all` (or specific tier)
- **force_photos**: ❌ (unchecked)
- **force_visual_quality**: ✅ (checked)

Useful for testing CLIP model changes or fixing VQ scores without re-downloading photos.

---

## Local Execution

### Full Refresh
```bash
# Re-fetch all photos + re-score all properties
python3 scripts/run_pipeline.py --force-photos --force-visual-quality

# Just active listings
python3 scripts/run_pipeline.py --tier active --force-photos --force-visual-quality
```

### Targeted Cleanup (Faster)

If you know only certain properties are missing photos:

```bash
# 1. Clean the photo cache (removes None/empty entries)
python3 scripts/clean_photo_cache.py

# 2. Refetch missing photos
python3 scripts/build_dashboard_data.py

# 3. Score new photos
python3 scripts/assess_visual_quality.py
```

### Debug Specific Address
```bash
# Remove specific property from cache
python3 scripts/clean_photo_cache.py --address "123 Main St"

# Rebuild dashboard data (will refetch that property)
python3 scripts/build_dashboard_data.py

# Re-score
python3 scripts/assess_visual_quality.py
```

---

## How Photo Caching Works

### Photo URL Cache (`data/photo_urls_cache.json`)
- Maps Redfin URLs → lists of photo URLs
- Persists across pipeline runs to avoid redundant fetches
- `--force-photos` clears and refetches everything
- `clean_photo_cache.py` surgically removes problematic entries

### Visual Quality Cache (`data/visual_quality_cache.json`)
- Maps property address → VQ scores + photo hash
- Automatically invalidates when photo URLs change (via hash)
- `--force-visual-quality` re-scores all properties regardless of cache

### When to Use What

| Symptom | Solution |
|---------|----------|
| Properties show "no photos" but Redfin page has photos | Use `--force-photos` |
| Properties have photos but no VQ badge | Run `assess_visual_quality.py` (VQ likely skipped) |
| VQ scores seem wrong | Use `--force-visual-quality` |
| Cache is corrupted or stale | Use `clean_photo_cache.py` or `--force-photos` |
| Testing CLIP model changes | Use `--force-visual-quality` |

---

## Performance Notes

- **Full photo refresh** (4000+ properties): ~30-45 min (0.5s per property + rate limiting)
- **VQ scoring** (4000+ properties with 5 photos each): ~2-3 hours on CPU, ~30 min on GPU
- **Targeted cleanup**: Only refetches missing entries, typically < 5 min

### Optimizations
- Use `--tier active` if you only care about current listings (~2300 properties vs 4000+)
- `clean_photo_cache.py` is faster than `--force-photos` when only a few properties need updating
- VQ automatically uses GPU if available (checks for CUDA)

---

## Troubleshooting

### Photos Still Missing After Force Refresh
1. Check if the Redfin URL is valid:
   ```bash
   python3 -c "import json; data = json.load(open('data/dashboard_data.json')); \
   props = [h for h in data['active_listings'] if 'missing address' in h.get('address', '')]; \
   print(props[0].get('redfin_url') if props else 'Not found')"
   ```

2. Manually test photo fetch:
   ```bash
   curl -sL "https://www.redfin.com/NC/Greensboro/123-Main-St-27401/home/12345678" | \
   grep -o 'https://ssl.cdn-redfin.com/photo/[^"]*\.jpg' | head -5
   ```

3. Check photo cache for that URL:
   ```bash
   python3 -c "import json; cache = json.load(open('data/photo_urls_cache.json')); \
   print(cache.get('https://www.redfin.com/NC/Greensboro/...'))"
   ```

### VQ Scores Not Updating
1. Verify CLIP dependencies are installed:
   ```bash
   python3 -c "import open_clip, torch; print('CLIP OK')"
   ```

2. Check if VQ was skipped:
   ```bash
   grep "visual_quality" data/dashboard_data.json | head -5
   ```

3. Force re-score a few properties to test:
   ```bash
   python3 scripts/assess_visual_quality.py --force --limit 10
   ```
