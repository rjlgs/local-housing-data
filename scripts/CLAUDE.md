# Data Sources & Pipeline

## Geographic Scope

All scripts target the **Greensboro-High Point, NC MSA** (Redfin metro code 24660):
- **Redfin Market:** All cities/zips in metro 24660 (Greensboro, High Point, Summerfield, Burlington, etc.)
- **Redfin Sold:** 29 cities in metro 24660 (Greensboro, High Point, Summerfield, Jamestown, Stokesdale, Oak Ridge, Archdale, Burlington, Asheboro, Reidsville, etc.)
- **Redfin Active:** Same 29 cities as sold, but currently active for-sale listings

## Entry Point

```
python3 scripts/run_pipeline.py                 # run all tiers
python3 scripts/run_pipeline.py --tier active    # just active listings
python3 scripts/run_pipeline.py --tier sold      # just sold homes
python3 scripts/run_pipeline.py --tier trends    # just market trends
python3 scripts/run_pipeline.py --tier rentals   # just rental listings
python3 scripts/run_pipeline.py --if-stale       # only run tiers that are due
python3 scripts/run_pipeline.py --sold-days 30   # override sold-homes window
```

## Tiered Update Cadences

Data sources refresh at different rates, tracked in `data/pipeline_state.json`:

| Tier | Cadence | Script |
|------|---------|--------|
| `market_trends` | ~2 weeks (336h) | `fetch_market_trends.py` |
| `sold_homes` | Daily (24h) | `fetch_sold_listings.py` |
| `active_listings` | Twice daily (12h) | `fetch_active_listings.py` |
| `rental_listings` | Twice daily (12h) | `fetch_rental_listings.py` |

`start.sh` runs `--if-stale` before serving the dashboard, so data refreshes automatically when you open the dashboard and data is due.

## Sources

### 1. Redfin Market Data (Market Trends)
- **Source:** S3 bulk TSV downloads
  - City: `redfin_market_tracker/city_market_tracker.tsv000.gz`
  - Zip: `redfin_market_tracker/zip_code_market_tracker.tsv000.gz`
- **Update cadence:** Weekly (city/county), monthly (zip)
- **Key fields:** median_sale_price, median_list_price, median_ppsf, homes_sold, pending_sales, new_listings, inventory, months_of_supply, median_dom, avg_sale_to_list, price_drops
- **Greensboro coverage:** City-level + 12 zip codes (27401-27455)
- **Access:** Public S3, no key required.
- **Script:** `fetch_market_trends.py`

### 2. Redfin Sold Homes (Transaction Prices)
- **Endpoint:** `https://www.redfin.com/stingray/api/gis-csv` with query params
- **Update cadence:** As sales close
- **Geographic scope:** 29 cities in metro 24660 (iterated by region_id)
- **Key fields:** sale_price, sold_date, address, beds, baths, sqft, lot_size, year_built, price_per_sqft, days_on_market, hoa, property_type, mls_number, lat/lng
- **Limit:** 350 rows/request — splits by city + property type to stay under cap
- **Access:** Public, no key required.
- **Script:** `fetch_sold_listings.py`

### 3. Redfin Active Listings (For-Sale Homes)
- **Endpoint:** Same `gis-csv` endpoint as sold, with `status=1` (active)
- **Update cadence:** Twice daily + on-demand
- **Geographic scope:** Same 29 cities
- **Key fields:** list_price, address, beds, baths, sqft, lot_size, year_built, price_per_sqft, days_on_market, hoa, property_type, mls_number, lat/lng
- **Limit:** 350 rows/request — splits by city + property type + price band
- **Price tracking:** `data/active_listings_tracker.json` records first_seen, price history, and delisting per MLS#
- **Access:** Public, no key required.
- **Script:** `fetch_active_listings.py`

### 4. Rental Listings (Multi-Provider)
Unlike the other tiers, rental data is stitched together from **three** providers via a plugin system under `scripts/rental_providers/`.  Each provider is enabled/disabled via `config.json → rental_sources.<name>.enabled`.  Providers return canonical rental records (see `rental_providers/base.py`), which the orchestrator dedupes by normalized-address + zip + beds.  Every row carries `source` (winning provider) and `sources` (all providers that surfaced the listing) for UI disambiguation.

- **Orchestrator:** `fetch_rental_listings.py` → writes `data/rental_listings.csv` + `data/rental_listings_tracker.json`
- **Update cadence:** Twice daily (12h), matches active listings
- **Providers never raise** — one broken source logs and returns `[]` so the tier still ships what the other providers returned.

#### 4a. Redfin Rentals
- **Endpoint:** `https://www.redfin.com/stingray/api/gis?status=9` (undocumented, scraped)
- **Access:** Public, no key required (same User-Agent spoof as sold/active scripts).
- **Geographic scope:** Same 29 cities as sold/active (iterated by `region_id`)
- **Reliability:** High — shares infrastructure with existing sold/active pipeline.
- **Module:** `rental_providers/redfin.py`

#### 4b. Zillow Rentals (EXPERIMENTAL)
- **Endpoint:** `https://www.zillow.com/async-create-search-page-state/` with a rental-filtered `searchQueryState`
- **Access:** Public, no key required, but Zillow aggressively rate-limits and captcha-walls scrapers.
- **Geographic scope:** Bounding box around `metro.map_center` (~35 mi square). Cannot iterate per city because Zillow region IDs don't line up with Redfin's.
- **Reliability:** LOW — expect to see empty results during captcha events. The provider swallows HTTP errors and JSON parse failures, so the pipeline keeps running.
- **Maintenance:** If Zillow changes the response shape, inspect a rental search in DevTools and update `zillow.py` accordingly.
- **Disable via:** `config.json → rental_sources.zillow.enabled = false`
- **Module:** `rental_providers/zillow.py`

#### 4c. RentCast API
- **Endpoint:** `https://api.rentcast.io/v1/listings/rental/long-term`
- **Access:** Requires API key.  Free tier = 50 requests/month.
- **Key configuration:** `config.json → rental_sources.rentcast.api_key` **or** `RENTCAST_API_KEY` env var.
- **Reliability:** High (official API), but bounded by the free-tier quota.
- **Unique value:** Returns clean `depositAmount`, `furnished`, `petsAllowed`, `leaseLength`, `availableDate` fields that Redfin/Zillow don't expose reliably.
- **Default:** **disabled** (`enabled: false`) — user must opt in by supplying a key.
- **Module:** `rental_providers/rentcast.py`

#### Dedupe logic
When the same unit appears in multiple providers, rows are merged via `rental_providers/base.dedupe_rows()`:
- **Key:** `normalize_address(address) | zip_code | beds`
- **Tie-breaker:** keep the row with the most populated canonical fields (richer data wins).
- **Output:** `source` = winning provider, `sources` = `;`-joined list of all contributing providers (surfaced as a tooltip in the dashboard).

## How They Combine

```
Redfin Sold (sale prices + DOM)
       |
       | CONTEXT from
       |
Redfin Market (zip/city trends)
       |
       | Sold comps used for
       |
Redfin Active (current asking prices)
```

- **Redfin Market:** Provides macro context per zip/city.
- **Sold <-> Active (in dashboard):** Sold comps inform whether an active listing's asking price is reasonable.

## Output

All data lands in `data/` as CSV:
- `data/redfin_market_city.csv`
- `data/redfin_market_zip.csv`
- `data/redfin_sold.csv`
- `data/redfin_active.csv`
- `data/rental_listings.csv` (multi-provider rental feed)
- `data/active_listings_tracker.json` (price history sidecar — for-sale)
- `data/rental_listings_tracker.json` (price history sidecar — rentals)
- `data/pipeline_state.json` (tier freshness tracker)
- `data/dashboard_data.json` (assembled for dashboard consumption)
