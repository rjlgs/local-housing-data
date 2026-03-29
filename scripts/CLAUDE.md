# Data Sources & Pipeline

## Geographic Scope

All scripts target the **Greensboro-High Point, NC MSA** (Redfin metro code 24660):
- **County Parcels:** All of Guilford County (~222K parcels)
- **Redfin Market:** All cities/zips in metro 24660 (Greensboro, High Point, Summerfield, Burlington, etc.)
- **Redfin Sold:** 29 cities in metro 24660 (Greensboro, High Point, Summerfield, Jamestown, Stokesdale, Oak Ridge, Archdale, Burlington, Asheboro, Reidsville, etc.)
- **Redfin Active:** Same 29 cities as sold, but currently active for-sale listings

## Entry Point

```
python3 scripts/run_pipeline.py                # run all tiers
python3 scripts/run_pipeline.py --tier active   # just active listings
python3 scripts/run_pipeline.py --tier sold     # just sold homes
python3 scripts/run_pipeline.py --tier trends   # just market trends
python3 scripts/run_pipeline.py --tier county   # just county parcels
python3 scripts/run_pipeline.py --if-stale      # only run tiers that are due
python3 scripts/run_pipeline.py --skip-county   # all except county (legacy)
python3 scripts/run_pipeline.py --sold-days 30  # override sold-homes window
```

## Tiered Update Cadences

Data sources refresh at different rates, tracked in `data/pipeline_state.json`:

| Tier | Cadence | Script |
|------|---------|--------|
| `county_parcels` | ~2 weeks (336h) | `ingest_county_parcels.py` |
| `market_trends` | ~2 weeks (336h) | `ingest_redfin_market.py` |
| `sold_homes` | Daily (24h) | `ingest_redfin_sold.py` |
| `active_listings` | Twice daily (12h) | `ingest_redfin_active.py` |

`start.sh` runs `--if-stale` before serving the dashboard, so data refreshes automatically when you open the dashboard and data is due.

## Sources

### 1. Guilford County ArcGIS (Property Characteristics)
- **Endpoint:** `https://gcgis.guilfordcountync.gov/arcgis/rest/services/Tax/PublishingParcelsSpatialView_FeatureToPointWGS84/FeatureServer/0`
- **Records:** ~222K parcels (~176K with bedroom data)
- **Geographic scope:** All of Guilford County
- **Update cadence:** Continuous (as assessments change)
- **Key fields:** address, bedrooms, bathrooms, structure_size (sqft), lot_size (acres), year_built, total_assessed_value, building_value, land_value, grade, condition, property_type, deed_date, lat/lng
- **Access:** Public REST API, no key required. Paginate at 2000 records/request.
- **Script:** `ingest_county_parcels.py`

### 2. Redfin Market Data (Market Trends)
- **Source:** S3 bulk TSV downloads
  - City: `redfin_market_tracker/city_market_tracker.tsv000.gz`
  - Zip: `redfin_market_tracker/zip_code_market_tracker.tsv000.gz`
- **Update cadence:** Weekly (city/county), monthly (zip)
- **Key fields:** median_sale_price, median_list_price, median_ppsf, homes_sold, pending_sales, new_listings, inventory, months_of_supply, median_dom, avg_sale_to_list, price_drops
- **Greensboro coverage:** City-level + 12 zip codes (27401-27455)
- **Access:** Public S3, no key required.
- **Script:** `ingest_redfin_market.py`

### 3. Redfin Sold Homes (Transaction Prices)
- **Endpoint:** `https://www.redfin.com/stingray/api/gis-csv` with query params
- **Update cadence:** As sales close
- **Geographic scope:** 29 cities in metro 24660 (iterated by region_id)
- **Key fields:** sale_price, sold_date, address, beds, baths, sqft, lot_size, year_built, price_per_sqft, days_on_market, hoa, property_type, mls_number, lat/lng
- **Limit:** 350 rows/request — splits by city + property type to stay under cap
- **Access:** Public, no key required.
- **Script:** `ingest_redfin_sold.py`

### 4. Redfin Active Listings (For-Sale Homes)
- **Endpoint:** Same `gis-csv` endpoint as sold, with `status=1` (active)
- **Update cadence:** Twice daily + on-demand
- **Geographic scope:** Same 29 cities
- **Key fields:** list_price, address, beds, baths, sqft, lot_size, year_built, price_per_sqft, days_on_market, hoa, property_type, mls_number, lat/lng
- **Limit:** 350 rows/request — splits by city + property type + price band
- **Price tracking:** `data/active_listings_tracker.json` records first_seen, price history, and delisting per MLS#
- **Access:** Public, no key required.
- **Script:** `ingest_redfin_active.py`

## How They Combine

```
County Parcels (characteristics + assessed value)
       |
       | JOIN on normalized address
       |
Redfin Sold (actual sale prices + DOM)
       |                                    Redfin Active (current asking prices)
       | CONTEXT from                              |
       |                                    JOIN on normalized address
Redfin Market (zip/city trends)                    |
                                            County Parcels (assessed value)
```

- **County <-> Redfin Sold:** Join on normalized address to pair property details with actual transaction prices.
- **County <-> Redfin Active:** Same join for active listings, giving assessed value vs asking price.
- **Redfin Market:** Provides macro context per zip/city.
- **Sold <-> Active (in dashboard):** Sold comps inform whether an active listing's asking price is reasonable.

## Output

All data lands in `data/` as CSV:
- `data/county_parcels.csv`
- `data/redfin_market_city.csv`
- `data/redfin_market_zip.csv`
- `data/redfin_sold.csv`
- `data/redfin_active.csv`
- `data/combined_properties.csv` (sold joined with county)
- `data/combined_active.csv` (active joined with county)
- `data/active_listings_tracker.json` (price history sidecar)
- `data/pipeline_state.json` (tier freshness tracker)
- `data/dashboard_data.json` (assembled for dashboard consumption)
