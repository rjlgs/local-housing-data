#!/usr/bin/env python3
"""
Combine county parcel data with Redfin sold homes data.

Joins on normalized address to produce a unified dataset with both
property characteristics (from county) and actual sale prices (from Redfin).
"""

import csv
import os
import re
import sys

# Common address abbreviation normalization
ABBREVS = {
    "STREET": "ST", "DRIVE": "DR", "AVENUE": "AVE", "ROAD": "RD",
    "BOULEVARD": "BLVD", "LANE": "LN", "COURT": "CT", "CIRCLE": "CIR",
    "PLACE": "PL", "TERRACE": "TER", "TRAIL": "TRL", "WAY": "WAY",
    "PARKWAY": "PKWY", "HIGHWAY": "HWY", "NORTH": "N", "SOUTH": "S",
    "EAST": "E", "WEST": "W", "NORTHEAST": "NE", "NORTHWEST": "NW",
    "SOUTHEAST": "SE", "SOUTHWEST": "SW",
}


def normalize_address(addr):
    """Normalize an address string for fuzzy matching."""
    if not addr:
        return ""
    addr = addr.upper().strip()
    # Remove unit/apt/suite suffixes
    addr = re.sub(r'\s+(APT|UNIT|STE|SUITE|#)\s*\S*$', '', addr)
    # Remove punctuation
    addr = re.sub(r'[.,#]', '', addr)
    # Normalize whitespace
    addr = re.sub(r'\s+', ' ', addr)
    # Expand/standardize abbreviations
    parts = addr.split()
    normalized = []
    for part in parts:
        normalized.append(ABBREVS.get(part, part))
    return " ".join(normalized)


def load_csv(path):
    """Load a CSV file and return list of dicts."""
    if not os.path.exists(path):
        print(f"  File not found: {path}")
        return []
    with open(path, "r", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def build_county_index(county_rows):
    """Build an address-indexed lookup from county parcel data."""
    county_by_addr = {}
    for row in county_rows:
        norm = normalize_address(row.get("address", ""))
        if norm:
            existing = county_by_addr.get(norm)
            if existing is None:
                county_by_addr[norm] = row
            else:
                try:
                    new_val = float(row.get("total_assessed") or 0)
                    old_val = float(existing.get("total_assessed") or 0)
                    if new_val > old_val:
                        county_by_addr[norm] = row
                except ValueError:
                    pass
    return county_by_addr


def join_with_county(redfin_rows, county_by_addr, redfin_fields, label="records"):
    """Join Redfin rows with county data. Returns (combined_rows, matched, unmatched)."""
    combined = []
    matched = 0
    unmatched = 0

    for redfin_row in redfin_rows:
        norm = normalize_address(redfin_row.get("address", ""))
        county = county_by_addr.get(norm, {})

        row = {}
        for field_map in redfin_fields:
            for out_key, in_key in field_map.items():
                row[out_key] = redfin_row.get(in_key, "")

        # County fields
        row["county_matched"] = "Y" if county else "N"
        row["reid"] = county.get("reid", "")
        row["property_type_county"] = county.get("property_type", "")
        row["total_assessed"] = county.get("total_assessed", "")
        row["building_value"] = county.get("building_value", "")
        row["land_value"] = county.get("land_value", "")
        row["structure_sqft_county"] = county.get("structure_sqft", "")
        row["lot_acres_county"] = county.get("lot_acres", "")
        row["bedrooms_county"] = county.get("bedrooms", "")
        row["bathrooms_county"] = county.get("bathrooms", "")
        row["year_built_county"] = county.get("year_built", "")
        row["grade"] = county.get("grade", "")
        row["neighborhood_county"] = county.get("neighborhood", "")
        row["deed_date"] = county.get("deed_date", "")

        combined.append(row)
        if county:
            matched += 1
        else:
            unmatched += 1

    if combined:
        rate = matched / len(combined) * 100
        print(f"  {label}: Matched {matched:,} | Unmatched {unmatched:,} ({rate:.1f}% match rate)")

    return combined


def write_combined(rows, output_path, label="records"):
    """Write combined rows to CSV."""
    if rows:
        fieldnames = list(rows[0].keys())
        with open(output_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        print(f"  Saved {len(rows):,} {label} to {output_path}")
    else:
        print(f"  No {label} to write.")


# Field mappings for Redfin sold homes
SOLD_FIELDS = [
    {
        "address": "address", "city": "city", "zip_code": "zip_code",
        "sale_price": "sale_price", "sold_date": "sold_date",
        "property_type_redfin": "property_type",
        "beds_redfin": "beds", "baths_redfin": "baths",
        "sqft_redfin": "sqft", "lot_size_sqft_redfin": "lot_size_sqft",
        "year_built_redfin": "year_built", "days_on_market": "days_on_market",
        "price_per_sqft": "price_per_sqft", "hoa_monthly": "hoa_monthly",
        "neighborhood_redfin": "neighborhood", "mls_number": "mls_number",
        "latitude": "latitude", "longitude": "longitude",
        "redfin_url": "redfin_url",
    },
]

# Field mappings for Redfin active listings
ACTIVE_FIELDS = [
    {
        "address": "address", "city": "city", "zip_code": "zip_code",
        "list_price": "list_price",
        "property_type_redfin": "property_type",
        "beds_redfin": "beds", "baths_redfin": "baths",
        "sqft_redfin": "sqft", "lot_size_sqft_redfin": "lot_size_sqft",
        "year_built_redfin": "year_built", "days_on_market": "days_on_market",
        "price_per_sqft": "price_per_sqft", "hoa_monthly": "hoa_monthly",
        "neighborhood_redfin": "neighborhood", "mls_number": "mls_number",
        "latitude": "latitude", "longitude": "longitude",
        "redfin_url": "redfin_url",
        "first_seen": "first_seen", "days_tracked": "days_tracked",
        "original_price": "original_price", "price_change": "price_change",
        "price_drop_count": "price_drop_count",
    },
]


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(os.path.dirname(script_dir), "data")

    county_path = os.path.join(data_dir, "county_parcels.csv")
    sold_path = os.path.join(data_dir, "redfin_sold.csv")
    active_path = os.path.join(data_dir, "redfin_active.csv")
    sold_output = os.path.join(data_dir, "combined_properties.csv")
    active_output = os.path.join(data_dir, "combined_active.csv")

    print("Loading county parcel data...")
    county_rows = load_csv(county_path)
    print(f"  {len(county_rows):,} parcels loaded")

    if not county_rows:
        print("Warning: No county data. Combined files will lack assessed values.")

    # Build address index
    print("Building address index...")
    county_by_addr = build_county_index(county_rows)
    print(f"  {len(county_by_addr):,} unique addresses indexed")

    # Join sold homes
    print("\nJoining sold homes...")
    sold_rows = load_csv(sold_path)
    print(f"  {len(sold_rows):,} sold records loaded")
    if sold_rows:
        combined_sold = join_with_county(sold_rows, county_by_addr, SOLD_FIELDS, "sold homes")
        write_combined(combined_sold, sold_output, "sold records")

    # Join active listings
    print("\nJoining active listings...")
    active_rows = load_csv(active_path)
    if active_rows:
        print(f"  {len(active_rows):,} active records loaded")
        combined_active = join_with_county(active_rows, county_by_addr, ACTIVE_FIELDS, "active listings")
        write_combined(combined_active, active_output, "active records")
    else:
        print("  No active listings file found (run ingest_redfin_active.py first)")

    print("\nDone.")


if __name__ == "__main__":
    main()
