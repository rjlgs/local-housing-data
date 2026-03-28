# Data Sources & Pipeline

## Geographic Scope

All scripts target the **Greensboro-High Point, NC MSA** (Redfin metro code 24660):
- **County Parcels:** All of Guilford County (~222K parcels)
- **Redfin Market:** All cities/zips in metro 24660 (Greensboro, High Point, Summerfield, Burlington, etc.)
- **Redfin Sold:** 29 cities in metro 24660 (Greensboro, High Point, Summerfield, Jamestown, Stokesdale, Oak Ridge, Archdale, Burlington, Asheboro, Reidsville, etc.)

## Entry Point

```
python3 scripts/run_pipeline.py              # run full pipeline
python3 scripts/run_pipeline.py --skip-county # skip slow county pull (~10 min)
python3 scripts/run_pipeline.py --sold-days 30 # override sold-homes window
```

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
- **Greensboro coverage:** City-level + 12 zip codes (27401–27455)
- **Access:** Public S3, no key required.
- **Script:** `ingest_redfin_market.py`

### 3. Redfin Sold Homes (Transaction Prices)
- **Endpoint:** `https://www.redfin.com/stingray/api/gis-csv` with query params
- **Update cadence:** As sales close
- **Geographic scope:** 29 cities in metro 24660 (iterated by region_id)
- **Key fields:** sale_price, sold_date, address, beds, baths, sqft, lot_size, year_built, price_per_sqft, days_on_market, hoa, property_type, mls_number, lat/lng
- **Limit:** 350 rows/request — splits by city + property type to stay under cap (see TODO.md)
- **Access:** Public, no key required.
- **Script:** `ingest_redfin_sold.py`

## How They Combine

```
County Parcels (characteristics + assessed value)
       |
       | JOIN on normalized address
       |
Redfin Sold (actual sale prices + DOM)
       |
       | CONTEXT from
       |
Redfin Market (zip/city trends: is it a buyer's or seller's market?)
```

- **County ↔ Redfin Sold:** Join on normalized address to pair property details with actual transaction prices. County gives assessed value + full property specs; Redfin gives market price + days on market.
- **Redfin Market:** Provides macro context per zip/city — median prices, inventory levels, months of supply, sale-to-list ratio. Used to assess market timing (good time to buy?) and price reasonableness.

## Output

All data lands in `data/` as CSV:
- `data/county_parcels.csv`
- `data/redfin_market_city.csv`
- `data/redfin_market_zip.csv`
- `data/redfin_sold.csv`
- `data/combined_properties.csv` (joined dataset)
