#!/usr/bin/env python3
"""
Build dashboard data from raw CSV files.

This script reads:
- redfin_sold.csv: Individual sold homes
- redfin_market_city.csv (optional): City-level market trends
- redfin_market_zip.csv (optional): Zip-level market trends
- combined_properties.csv (optional): Joined dataset with county data

And produces: dashboard_data.json for the dashboard to consume.
"""

import json
import csv
import os
from datetime import datetime
from statistics import median
from pathlib import Path

# Configuration
PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
SCRIPT_DIR = PROJECT_ROOT / "scripts"

INPUT_FILES = {
    "config": PROJECT_ROOT / "config.json",
    "sold": DATA_DIR / "redfin_sold.csv",
    "market_city": DATA_DIR / "redfin_market_city.csv",
    "market_zip": DATA_DIR / "redfin_market_zip.csv",
    "combined": DATA_DIR / "combined_properties.csv",
}

OUTPUT_FILE = DATA_DIR / "dashboard_data.json"


def load_json(path):
    """Load JSON file."""
    if not path.exists():
        print(f"Warning: {path} not found")
        return None
    with open(path) as f:
        return json.load(f)


def safe_numeric(value):
    """Convert value to numeric, handling NA and empty strings."""
    if value is None or value == "" or value == "NA":
        return None
    try:
        if isinstance(value, (int, float)):
            return value
        # Try int first, then float
        if "." in str(value):
            return float(value)
        return int(value)
    except (ValueError, TypeError):
        return None


def parse_market_csv(path):
    """Parse market trend CSV file."""
    if not path.exists():
        print(f"Info: {path} not found, skipping")
        return {}

    print(f"Reading {path.name}...")
    records_read = 0
    market_data = {}

    try:
        with open(path, encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                records_read += 1

                # Skip if not "All Residential"
                if row.get("PROPERTY_TYPE", "").strip() != "All Residential":
                    continue

                # Extract region name
                region = row.get("REGION", "").strip()
                if not region:
                    continue

                # Clean up region name: remove quotes and state suffix
                region = region.strip('"')
                if region.startswith("Zip Code:"):
                    # Keep as-is for zip codes
                    area_key = region
                else:
                    # Remove state suffix (e.g., "Greensboro, NC" -> "Greensboro")
                    area_key = region.rsplit(",", 1)[0].strip()

                # Parse period begin as date
                period_begin = row.get("PERIOD_BEGIN", "").strip()
                if not period_begin:
                    continue

                # Create record with numeric fields
                record = {
                    "date": period_begin,
                    "median_sale_price": safe_numeric(row.get("MEDIAN_SALE_PRICE")),
                    "median_list_price": safe_numeric(row.get("MEDIAN_LIST_PRICE")),
                    "median_ppsf": safe_numeric(row.get("MEDIAN_PPSF")),
                    "homes_sold": safe_numeric(row.get("HOMES_SOLD")),
                    "inventory": safe_numeric(row.get("INVENTORY")),
                    "months_of_supply": safe_numeric(row.get("MONTHS_OF_SUPPLY")),
                    "median_dom": safe_numeric(row.get("MEDIAN_DOM")),
                    "avg_sale_to_list": safe_numeric(row.get("AVG_SALE_TO_LIST")),
                    "sold_above_list": safe_numeric(row.get("SOLD_ABOVE_LIST")),
                    "price_drops": safe_numeric(row.get("PRICE_DROPS")),
                }

                if area_key not in market_data:
                    market_data[area_key] = []
                market_data[area_key].append(record)

        print(f"  Processed {records_read} records from {path.name}")
    except Exception as e:
        print(f"  Error reading {path.name}: {e}")

    # Sort by date
    for area in market_data:
        market_data[area].sort(key=lambda x: x["date"])

    return market_data


def parse_sold_csv(path):
    """Parse sold homes CSV file."""
    if not path.exists():
        print(f"Error: {path} not found")
        return []

    print(f"Reading {path.name}...")
    homes = []

    try:
        with open(path, encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Parse date
                sold_date = row.get("sold_date", "").strip() or None

                home = {
                    "address": row.get("address", "").strip() or None,
                    "city": row.get("city", "").strip() or None,
                    "zip_code": row.get("zip_code", "").strip() or None,
                    "sale_price": safe_numeric(row.get("sale_price")),
                    "sold_date": sold_date,
                    "beds": safe_numeric(row.get("beds")),
                    "baths": safe_numeric(row.get("baths")),
                    "sqft": safe_numeric(row.get("sqft")),
                    "lot_size_sqft": safe_numeric(row.get("lot_size_sqft")),
                    "year_built": safe_numeric(row.get("year_built")),
                    "days_on_market": safe_numeric(row.get("days_on_market")),
                    "price_per_sqft": safe_numeric(row.get("price_per_sqft")),
                    "hoa_monthly": safe_numeric(row.get("hoa_monthly")),
                    "neighborhood": row.get("neighborhood", "").strip() or None,
                    "property_type": row.get("property_type", "").strip() or None,
                    "latitude": safe_numeric(row.get("latitude")),
                    "longitude": safe_numeric(row.get("longitude")),
                    # County data placeholders
                    "total_assessed": None,
                    "building_value": None,
                    "land_value": None,
                    "grade": None,
                }

                homes.append(home)

        print(f"  Processed {len(homes)} sold homes")
    except Exception as e:
        print(f"  Error reading {path.name}: {e}")

    return homes


def parse_combined_csv(path):
    """Parse combined properties CSV to enrich sold homes with county data."""
    if not path.exists():
        print(f"Info: {path} not found, county data will not be enriched")
        return {}

    print(f"Reading {path.name}...")
    county_data = {}

    try:
        with open(path, encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Use address as key for matching
                address = row.get("address", "").strip()
                if not address:
                    continue

                county_data[address] = {
                    "total_assessed": safe_numeric(row.get("total_assessed")),
                    "building_value": safe_numeric(row.get("building_value")),
                    "land_value": safe_numeric(row.get("land_value")),
                    "grade": row.get("grade", "").strip() or None,
                }

        print(f"  Processed {len(county_data)} county records")
    except Exception as e:
        print(f"  Error reading {path.name}: {e}")

    return county_data


def enrich_sold_homes(homes, county_data):
    """Enrich sold homes with county data."""
    enriched_count = 0
    for home in homes:
        address = home["address"]
        if address in county_data:
            home.update(county_data[address])
            enriched_count += 1

    print(f"  Enriched {enriched_count} homes with county data")
    return homes


def point_in_polygon(lat, lng, polygon):
    """Ray-casting point-in-polygon test."""
    inside = False
    n = len(polygon)
    j = n - 1
    for i in range(n):
        yi, xi = polygon[i]
        yj, xj = polygon[j]
        if ((yi > lat) != (yj > lat)) and (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def compute_area_summary(config, homes):
    """Compute summary statistics for each focus area."""
    summary = {}

    for area_config in config.get("focus_areas", []):
        area_name = area_config["name"]
        area_type = area_config.get("type", "city")

        # Filter homes for this area
        filtered_homes = []

        polygon = area_config.get("polygon")
        if polygon and len(polygon) >= 3:
            # Spatial filtering via polygon
            filtered_homes = [
                h for h in homes
                if h.get("latitude") is not None and h.get("longitude") is not None
                and point_in_polygon(h["latitude"], h["longitude"], polygon)
            ]
        elif area_type == "city":
            # Match by city name
            city_name = area_name
            filtered_homes = [
                h for h in homes
                if h.get("city") and h["city"].lower() == city_name.lower()
            ]
        elif area_type == "neighborhood":
            # Match by neighborhood (case-insensitive substring match)
            neighborhoods = area_config.get("neighborhoods", [])
            filtered_homes = [
                h for h in homes
                if h.get("neighborhood") and any(
                    nb.lower() in h["neighborhood"].lower()
                    for nb in neighborhoods
                )
            ]

        if not filtered_homes:
            continue

        # Extract numeric fields for median calculation
        prices = [h["sale_price"] for h in filtered_homes if h["sale_price"] is not None]
        ppsf = [h["price_per_sqft"] for h in filtered_homes if h["price_per_sqft"] is not None]
        sqfts = [h["sqft"] for h in filtered_homes if h["sqft"] is not None]
        lot_sqfts = [h["lot_size_sqft"] for h in filtered_homes if h["lot_size_sqft"] is not None]
        beds = [h["beds"] for h in filtered_homes if h["beds"] is not None]
        doms = [h["days_on_market"] for h in filtered_homes if h["days_on_market"] is not None]
        years = [h["year_built"] for h in filtered_homes if h["year_built"] is not None]

        summary[area_name] = {
            "count": len(filtered_homes),
            "median_price": median(prices) if prices else None,
            "median_ppsf": median(ppsf) if ppsf else None,
            "median_sqft": median(sqfts) if sqfts else None,
            "median_lot_sqft": median(lot_sqfts) if lot_sqfts else None,
            "median_beds": median(beds) if beds else None,
            "median_dom": median(doms) if doms else None,
            "median_year_built": median(years) if years else None,
            "price_range": [min(prices), max(prices)] if prices else None,
        }

    return summary


def build_market_trends(config, market_data):
    """Build market_trends object from parsed data."""
    trends = {}

    # Add focus area cities and neighborhoods
    for area_config in config.get("focus_areas", []):
        area_name = area_config["name"]
        if area_config.get("type") == "city":
            # For city-type areas, add them if they exist in market data
            # They might be in market_data with state suffix
            for key in market_data:
                if key.startswith("Zip Code:"):
                    continue
                # Check if this matches the area
                if key.lower().startswith(area_name.lower()):
                    trends[area_name] = market_data[key]
                    break

    # Add zip codes from focus areas
    for area_config in config.get("focus_areas", []):
        area_name = area_config["name"]
        zip_codes = area_config.get("zip_codes", [])

        # For city-type with single zip, just add the raw zip entry
        if area_config.get("type") == "city" and len(zip_codes) <= 1:
            for zip_code in zip_codes:
                zip_key = f"Zip Code: {zip_code}"
                if zip_key in market_data:
                    trends[zip_key] = market_data[zip_key]
            continue

        # For multi-zip areas (or neighborhood type), merge zip series into
        # one entry keyed by area name, averaging values per date
        zip_series = []
        for zip_code in zip_codes:
            zip_key = f"Zip Code: {zip_code}"
            if zip_key in market_data:
                zip_series.append(market_data[zip_key])

        if not zip_series:
            continue

        if len(zip_series) == 1:
            # Only one zip has data, use it directly
            trends[area_name] = zip_series[0]
        else:
            # Merge: group records by date, average numeric fields
            by_date = {}
            numeric_fields = [
                "median_sale_price", "median_list_price", "median_ppsf",
                "homes_sold", "inventory", "months_of_supply", "median_dom",
                "avg_sale_to_list", "sold_above_list", "price_drops",
            ]
            for series in zip_series:
                for rec in series:
                    d = rec["date"]
                    if d not in by_date:
                        by_date[d] = {f: [] for f in numeric_fields}
                    for f in numeric_fields:
                        if rec.get(f) is not None:
                            by_date[d][f].append(rec[f])

            merged = []
            for d in sorted(by_date):
                rec = {"date": d}
                for f in numeric_fields:
                    vals = by_date[d][f]
                    rec[f] = sum(vals) / len(vals) if vals else None
                merged.append(rec)
            trends[area_name] = merged

        # Also keep individual zip entries for city-type multi-zip areas
        if area_config.get("type") == "city":
            for zip_code in zip_codes:
                zip_key = f"Zip Code: {zip_code}"
                if zip_key in market_data:
                    trends[zip_key] = market_data[zip_key]

    # Always include baseline "Greensboro"
    for key in market_data:
        if key.lower() == "greensboro":
            trends["Greensboro"] = market_data[key]
            break

    return trends


def main():
    """Main execution."""
    print("=" * 60)
    print("Building dashboard data...")
    print("=" * 60)

    # Load config
    print("\nLoading configuration...")
    config = load_json(INPUT_FILES["config"])
    if not config:
        print("Error: config.json not found or invalid")
        return
    print(f"  Loaded config with {len(config.get('focus_areas', []))} focus areas")

    # Parse sold homes (required)
    print("\nParsing sold homes...")
    homes = parse_sold_csv(INPUT_FILES["sold"])
    if not homes:
        print("Warning: No sold homes found")

    # Parse market data (optional)
    print("\nParsing market trends...")
    market_city = parse_market_csv(INPUT_FILES["market_city"])
    market_zip = parse_market_csv(INPUT_FILES["market_zip"])
    market_data = {**market_city, **market_zip}
    print(f"  Total market areas: {len(market_data)}")

    # Parse and enrich with county data (optional)
    print("\nParsing county data...")
    county_data = parse_combined_csv(INPUT_FILES["combined"])
    homes = enrich_sold_homes(homes, county_data)

    # Read sold window metadata written by ingest_redfin_sold.py
    sold_meta_path = DATA_DIR / "redfin_sold_meta.json"
    if sold_meta_path.exists():
        with open(sold_meta_path) as f:
            sold_meta = json.load(f)
        sold_window_days = sold_meta.get("sold_within_days")
    else:
        sold_window_days = None

    # Compute area summaries
    print("\nComputing area summaries...")
    area_summary = compute_area_summary(config, homes)
    print(f"  Computed summaries for {len(area_summary)} areas")

    # Build market trends
    print("\nBuilding market trends...")
    market_trends = build_market_trends(config, market_data)
    print(f"  Included {len(market_trends)} market areas")

    # Assemble output
    print("\nAssembling output...")
    output = {
        "generated_at": datetime.now().isoformat(),
        "config": config,
        "sold_window_days": sold_window_days,
        "market_trends": market_trends,
        "sold_homes": homes,
        "area_summary": area_summary,
    }

    # Write output
    print(f"\nWriting {OUTPUT_FILE}...")
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding='utf-8') as f:
        json.dump(output, f, indent=2)

    # Summary stats
    print("\n" + "=" * 60)
    print("Build complete!")
    print("=" * 60)
    print(f"Output file: {OUTPUT_FILE}")
    print(f"Generated at: {output['generated_at']}")
    print(f"Sold homes: {len(homes)}")
    print(f"Market areas: {len(market_trends)}")
    print(f"Focus areas with summaries: {len(area_summary)}")
    print("=" * 60)


if __name__ == "__main__":
    main()
