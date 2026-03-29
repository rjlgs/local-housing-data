#!/usr/bin/env python3
"""
Ingest Guilford County parcel data from ArcGIS REST API.

Pulls all parcels from the PublishingParcelsSpatialView feature service,
paginates through results (2000 per request), and saves to CSV.
"""

import csv
import json
import os
import sys
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone

BASE_URL = (
    "https://gcgis.guilfordcountync.gov/arcgis/rest/services/Tax/"
    "PublishingParcelsSpatialView_FeatureToPointWGS84/FeatureServer/0/query"
)

# Fields to pull from the API
OUT_FIELDS = [
    "REID", "PIN", "LOCATION_ADDR", "Owner", "Property_Type",
    "Total_Assessed", "Total_Building_Value", "Total_Land_Value",
    "Total_Out_Building_Value", "TOTAL_DEFERRED_VALUE",
    "Structure_Size", "Lot_Size", "YEAR_BUILT", "BEDROOMS", "Bathrooms",
    "GRADE", "Neighborhood", "DEED_DATE", "BLDG_CARD",
    "CentroidXCoordinate", "CentroidYCoordinat",
]

# Friendlier column names for the CSV output
CSV_COLUMNS = [
    "reid", "pin", "address", "owner", "property_type",
    "total_assessed", "building_value", "land_value",
    "outbuilding_value", "deferred_value",
    "structure_sqft", "lot_acres", "year_built", "bedrooms", "bathrooms",
    "grade", "neighborhood", "deed_date", "building_card_url",
    "longitude", "latitude",
]

PAGE_SIZE = 2000


def get_total_count():
    """Get total number of records in the feature service."""
    params = urllib.parse.urlencode({
        "where": "1=1",
        "returnCountOnly": "true",
        "f": "json",
    })
    url = f"{BASE_URL}?{params}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        data = json.loads(resp.read())
    return data.get("count", 0)


def fetch_page(offset):
    """Fetch a page of results starting at the given offset."""
    params = urllib.parse.urlencode({
        "where": "1=1",
        "outFields": ",".join(OUT_FIELDS),
        "resultOffset": offset,
        "resultRecordCount": PAGE_SIZE,
        "orderByFields": "OBJECTID ASC",
        "f": "json",
    })
    url = f"{BASE_URL}?{params}"
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


def transform_record(attrs):
    """Transform raw API attributes into a flat dict for CSV output."""
    return {
        "reid": attrs.get("REID"),
        "pin": attrs.get("PIN"),
        "address": attrs.get("LOCATION_ADDR"),
        "owner": attrs.get("Owner"),
        "property_type": attrs.get("Property_Type"),
        "total_assessed": attrs.get("Total_Assessed"),
        "building_value": attrs.get("Total_Building_Value"),
        "land_value": attrs.get("Total_Land_Value"),
        "outbuilding_value": attrs.get("Total_Out_Building_Value"),
        "deferred_value": attrs.get("TOTAL_DEFERRED_VALUE"),
        "structure_sqft": attrs.get("Structure_Size"),
        "lot_acres": attrs.get("Lot_Size"),
        "year_built": int(attrs["YEAR_BUILT"]) if attrs.get("YEAR_BUILT") else None,
        "bedrooms": int(attrs["BEDROOMS"]) if attrs.get("BEDROOMS") else None,
        "bathrooms": attrs.get("Bathrooms"),
        "grade": attrs.get("GRADE"),
        "neighborhood": attrs.get("Neighborhood"),
        "deed_date": convert_epoch_to_date(attrs.get("DEED_DATE")),
        "building_card_url": attrs.get("BLDG_CARD"),
        "longitude": attrs.get("CentroidXCoordinate"),
        "latitude": attrs.get("CentroidYCoordinat"),
    }


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(os.path.dirname(script_dir), "data")
    os.makedirs(data_dir, exist_ok=True)
    output_path = os.path.join(data_dir, "county_parcels.csv")

    print("Fetching total record count...")
    total = get_total_count()
    print(f"Total parcels: {total:,}")

    records = []
    offset = 0
    while offset < total:
        print(f"  Fetching records {offset:,}–{min(offset + PAGE_SIZE, total):,} of {total:,}...")
        try:
            features = fetch_page(offset)
        except Exception as e:
            print(f"  Error at offset {offset}: {e}. Retrying in 5s...")
            time.sleep(5)
            try:
                features = fetch_page(offset)
            except Exception as e2:
                print(f"  Retry failed: {e2}. Skipping batch.")
                offset += PAGE_SIZE
                continue

        if not features:
            break

        for feat in features:
            records.append(transform_record(feat.get("attributes", {})))

        offset += PAGE_SIZE
        # Be polite to the server
        time.sleep(0.5)

    print(f"\nWriting {len(records):,} records to {output_path}...")
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(records)

    print("Done.")


if __name__ == "__main__":
    main()
