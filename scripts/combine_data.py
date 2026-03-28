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


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(os.path.dirname(script_dir), "data")

    county_path = os.path.join(data_dir, "county_parcels.csv")
    sold_path = os.path.join(data_dir, "redfin_sold.csv")
    output_path = os.path.join(data_dir, "combined_properties.csv")

    print("Loading county parcel data...")
    county_rows = load_csv(county_path)
    print(f"  {len(county_rows):,} parcels loaded")

    print("Loading Redfin sold homes data...")
    sold_rows = load_csv(sold_path)
    print(f"  {len(sold_rows):,} sold records loaded")

    if not county_rows or not sold_rows:
        print("Missing input data. Run ingestion scripts first.")
        sys.exit(1)

    # Index county data by normalized address
    print("Building address index...")
    county_by_addr = {}
    for row in county_rows:
        norm = normalize_address(row.get("address", ""))
        if norm:
            # If multiple parcels share an address, keep the one with the
            # highest assessed value (likely the primary dwelling)
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

    print(f"  {len(county_by_addr):,} unique addresses indexed")

    # Join sold homes with county data
    print("Joining datasets...")
    combined = []
    matched = 0
    unmatched = 0

    for sold in sold_rows:
        norm = normalize_address(sold.get("address", ""))
        county = county_by_addr.get(norm, {})

        row = {
            # From Redfin sold
            "address": sold.get("address", ""),
            "city": sold.get("city", ""),
            "zip_code": sold.get("zip_code", ""),
            "sale_price": sold.get("sale_price", ""),
            "sold_date": sold.get("sold_date", ""),
            "property_type_redfin": sold.get("property_type", ""),
            "beds_redfin": sold.get("beds", ""),
            "baths_redfin": sold.get("baths", ""),
            "sqft_redfin": sold.get("sqft", ""),
            "lot_size_sqft_redfin": sold.get("lot_size_sqft", ""),
            "year_built_redfin": sold.get("year_built", ""),
            "days_on_market": sold.get("days_on_market", ""),
            "price_per_sqft": sold.get("price_per_sqft", ""),
            "hoa_monthly": sold.get("hoa_monthly", ""),
            "neighborhood_redfin": sold.get("neighborhood", ""),
            "mls_number": sold.get("mls_number", ""),
            "latitude": sold.get("latitude", ""),
            "longitude": sold.get("longitude", ""),
            "redfin_url": sold.get("redfin_url", ""),

            # From county
            "county_matched": "Y" if county else "N",
            "reid": county.get("reid", ""),
            "property_type_county": county.get("property_type", ""),
            "total_assessed": county.get("total_assessed", ""),
            "building_value": county.get("building_value", ""),
            "land_value": county.get("land_value", ""),
            "structure_sqft_county": county.get("structure_sqft", ""),
            "lot_acres_county": county.get("lot_acres", ""),
            "bedrooms_county": county.get("bedrooms", ""),
            "bathrooms_county": county.get("bathrooms", ""),
            "year_built_county": county.get("year_built", ""),
            "grade": county.get("grade", ""),
            "neighborhood_county": county.get("neighborhood", ""),
            "deed_date": county.get("deed_date", ""),
        }
        combined.append(row)

        if county:
            matched += 1
        else:
            unmatched += 1

    print(f"  Matched: {matched:,} | Unmatched: {unmatched:,} "
          f"({matched / len(combined) * 100:.1f}% match rate)")

    # Write combined output
    if combined:
        fieldnames = list(combined[0].keys())
        with open(output_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(combined)
        print(f"\nSaved {len(combined):,} records to {output_path}")
    else:
        print("No records to write.")

    print("Done.")


if __name__ == "__main__":
    main()
