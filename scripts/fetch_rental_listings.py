#!/usr/bin/env python3
"""
Ingest rental listings from multiple providers (Redfin, Zillow, RentCast).

This is the rental-tier entry point for ``run_pipeline.py``.  It:

  1. Reads ``config.json`` to determine which providers are enabled.
  2. Calls ``rental_providers.fetch_all()`` which invokes each enabled
     provider and concatenates their results.
  3. Dedupes rows across providers using a normalized address + zip + beds
     key, preserving the full ``sources`` list for disambiguation.
  4. Maintains a sidecar tracker (``data/rental_listings_tracker.json``)
     that records when each listing was first seen, similar to the active
     listings tracker.
  5. Writes ``data/rental_listings.csv`` with the canonical schema.

Providers that fail or are disabled are skipped silently — one broken
source will never sink the tier.
"""

import csv
import json
import os
import sys
from datetime import date

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from rental_providers import base, fetch_all  # noqa: E402


def load_tracker(tracker_path):
    if os.path.exists(tracker_path):
        with open(tracker_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_tracker(tracker, tracker_path):
    with open(tracker_path, "w", encoding="utf-8") as f:
        json.dump(tracker, f, indent=2)


def update_tracker(tracker, rows, today_str):
    """Update the rental tracker — same first_seen/rent_history pattern as
    the active listings tracker, keyed by dedupe key."""
    new_count = 0
    rent_change_count = 0

    current_keys = set()
    for row in rows:
        key = base.dedupe_key(row)
        if not key.strip("|"):
            continue
        current_keys.add(key)

        try:
            rent = int(float(row.get("rent_monthly") or 0))
        except (TypeError, ValueError):
            rent = 0

        if key not in tracker:
            tracker[key] = {
                "first_seen": today_str,
                "last_seen":  today_str,
                "address":    row.get("address", ""),
                "rent_history": [{"date": today_str, "rent": rent}],
                "removed":    None,
            }
            new_count += 1
        else:
            entry = tracker[key]
            entry["last_seen"] = today_str
            entry["removed"] = None
            last_rent = entry["rent_history"][-1]["rent"] if entry["rent_history"] else None
            if rent and last_rent and rent != last_rent:
                entry["rent_history"].append({"date": today_str, "rent": rent})
                rent_change_count += 1

    return new_count, rent_change_count


def enrich_from_tracker(rows, tracker, today_str):
    """Copy first_seen + days_tracked + rent_change into each row."""
    for row in rows:
        key = base.dedupe_key(row)
        entry = tracker.get(key, {})

        row["first_seen"] = entry.get("first_seen", today_str)
        first = entry.get("first_seen", today_str)
        try:
            delta = (date.fromisoformat(today_str) - date.fromisoformat(first)).days
        except (ValueError, TypeError):
            delta = 0
        row["days_tracked"] = str(delta)

        history = entry.get("rent_history", [])
        if len(history) >= 2:
            original = history[0]["rent"]
            current  = history[-1]["rent"]
            row["rent_change"] = str(current - original)
        else:
            row["rent_change"] = "0"


def main():
    project_root = os.path.dirname(SCRIPT_DIR)
    data_dir = os.path.join(project_root, "data")
    os.makedirs(data_dir, exist_ok=True)
    output_path  = os.path.join(data_dir, "rental_listings.csv")
    tracker_path = os.path.join(data_dir, "rental_listings_tracker.json")

    with open(os.path.join(project_root, "config.json")) as f:
        config = json.load(f)

    cities = config.get("cities", [])
    today_str = date.today().isoformat()

    print(f"Fetching rental listings from enabled providers for "
          f"{len(cities)} metro cities...\n")

    raw_rows = fetch_all(cities, config)
    print(f"\nTotal raw rows across providers: {len(raw_rows):,}")

    if not raw_rows:
        print("No rental data collected from any provider. Writing empty CSV.")
        with open(output_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(
                f, fieldnames=base.CANONICAL_FIELDS + ["first_seen", "days_tracked", "rent_change"]
            )
            writer.writeheader()
        return

    # Dedupe across providers.
    deduped, merged = base.dedupe_rows(raw_rows)
    print(f"Dedupe: merged {merged} duplicates → {len(deduped)} unique rentals")

    # Update the tracker sidecar.
    print("\nUpdating rental listings tracker...")
    tracker = load_tracker(tracker_path)
    new_count, rent_changes = update_tracker(tracker, deduped, today_str)
    print(f"  New: {new_count} | Rent changes: {rent_changes}")

    enrich_from_tracker(deduped, tracker, today_str)
    save_tracker(tracker, tracker_path)

    # Write CSV.
    fieldnames = base.CANONICAL_FIELDS + ["first_seen", "days_tracked", "rent_change"]
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in deduped:
            canonical = base.canonicalize(row)
            canonical["first_seen"]   = row.get("first_seen", today_str)
            canonical["days_tracked"] = row.get("days_tracked", "0")
            canonical["rent_change"]  = row.get("rent_change", "0")
            writer.writerow(canonical)

    print(f"\nSaved to {output_path}")
    print("Done.")


if __name__ == "__main__":
    main()
