#!/usr/bin/env python3
"""
Ingest county parcel data from ArcGIS REST API.

Pulls all parcels from the configured ArcGIS feature service,
paginates through results, and saves to CSV.

The county_parcels section in config.json controls which endpoint to use,
which fields to pull, and how to map them. If county_parcels.enabled is
false (or absent), the script exits successfully with no output.
"""

import csv
import json
import os
import sys
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone


def get_total_count(base_url):
    """Get total number of records in the feature service."""
    params = urllib.parse.urlencode({
        "where": "1=1",
        "returnCountOnly": "true",
        "f": "json",
    })
    url = f"{base_url}?{params}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        data = json.loads(resp.read())
    return data.get("count", 0)


def fetch_page(base_url, out_fields, page_size, offset):
    """Fetch a page of results starting at the given offset."""
    params = urllib.parse.urlencode({
        "where": "1=1",
        "outFields": ",".join(out_fields),
        "resultOffset": offset,
        "resultRecordCount": page_size,
        "orderByFields": "OBJECTID ASC",
        "f": "json",
    })
    url = f"{base_url}?{params}"
    with urllib.request.urlopen(url, timeout=60) as resp:
        data = json.loads(resp.read())
    return data.get("features", [])


def convert_epoch_to_date(epoch_ms):
    """Convert millisecond epoch timestamp to YYYY-MM-DD string."""
    if epoch_ms is None:
        return None
    try:
        return datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    except (ValueError, OSError):
        return None


def transform_record(attrs, field_map):
    """Transform raw API attributes into a flat dict for CSV output using field_map."""
    record = {}
    for api_field, csv_col in field_map.items():
        value = attrs.get(api_field)
        # Special handling for known types
        if csv_col == "year_built":
            value = int(value) if value else None
        elif csv_col == "bedrooms":
            value = int(value) if value else None
        elif csv_col == "deed_date":
            value = convert_epoch_to_date(value)
        record[csv_col] = value
    return record


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    data_dir = os.path.join(project_root, "data")
    os.makedirs(data_dir, exist_ok=True)
    output_path = os.path.join(data_dir, "county_parcels.csv")

    with open(os.path.join(project_root, "config.json")) as f:
        config = json.load(f)

    county_config = config.get("county_parcels", {})
    if not county_config.get("enabled", False):
        print("County parcels disabled in config.json. Skipping.")
        sys.exit(0)

    base_url = county_config["base_url"]
    out_fields = county_config["out_fields"]
    field_map = county_config["field_map"]
    page_size = county_config.get("page_size", 2000)
    source_name = county_config.get("source_name", "County")
    csv_columns = list(field_map.values())

    print(f"Fetching {source_name} parcel data...")
    print("Fetching total record count...")
    total = get_total_count(base_url)
    print(f"Total parcels: {total:,}")

    records = []
    offset = 0
    while offset < total:
        print(f"  Fetching records {offset:,}–{min(offset + page_size, total):,} of {total:,}...")
        try:
            features = fetch_page(base_url, out_fields, page_size, offset)
        except Exception as e:
            print(f"  Error at offset {offset}: {e}. Retrying in 5s...")
            time.sleep(5)
            try:
                features = fetch_page(base_url, out_fields, page_size, offset)
            except Exception as e2:
                print(f"  Retry failed: {e2}. Skipping batch.")
                offset += page_size
                continue

        if not features:
            break

        for feat in features:
            records.append(transform_record(feat.get("attributes", {}), field_map))

        offset += page_size
        # Be polite to the server
        time.sleep(0.5)

    print(f"\nWriting {len(records):,} records to {output_path}...")
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=csv_columns)
        writer.writeheader()
        writer.writerows(records)

    print("Done.")


if __name__ == "__main__":
    main()
