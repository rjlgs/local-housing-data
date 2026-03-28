#!/usr/bin/env python3
"""
Single entry point for the Greensboro housing data pipeline.

Runs all ingestion scripts in order, then combines the results.

Usage:
    python3 scripts/run_pipeline.py              # run all steps
    python3 scripts/run_pipeline.py --skip-county # skip the slow county pull
    python3 scripts/run_pipeline.py --sold-days 30 # override sold-homes window
"""

import argparse
import os
import subprocess
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

STEPS = [
    {
        "name": "County Parcels",
        "script": "ingest_county_parcels.py",
        "description": "Guilford County property characteristics (~222K parcels via ArcGIS)",
        "skippable": "county",
    },
    {
        "name": "Redfin Market Data",
        "script": "ingest_redfin_market.py",
        "description": "City + zip-level market trends for Greensboro metro (Redfin S3)",
    },
    {
        "name": "Redfin Sold Homes",
        "script": "ingest_redfin_sold.py",
        "description": "Individual sold-home transactions across 29 metro cities (Redfin CSV)",
        "extra_args_key": "sold_days",
    },
    {
        "name": "Combine Data",
        "script": "combine_data.py",
        "description": "Join county parcels with Redfin sold homes on address",
    },
]


def run_step(step, args):
    """Run a single pipeline step. Returns True on success."""
    name = step["name"]
    script = os.path.join(SCRIPT_DIR, step["script"])

    # Check skip flags
    skip_key = step.get("skippable")
    if skip_key and getattr(args, f"skip_{skip_key}", False):
        print(f"  SKIPPED (--skip-{skip_key})\n")
        return True

    cmd = [sys.executable, script]

    # Pass extra args if applicable
    extra_key = step.get("extra_args_key")
    if extra_key:
        val = getattr(args, extra_key, None)
        if val is not None:
            cmd.append(str(val))

    start = time.time()
    result = subprocess.run(cmd, cwd=os.path.dirname(SCRIPT_DIR))
    elapsed = time.time() - start

    if result.returncode != 0:
        print(f"  FAILED (exit code {result.returncode}, {elapsed:.0f}s)\n")
        return False

    print(f"  Completed in {elapsed:.0f}s\n")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Run the Greensboro housing data pipeline."
    )
    parser.add_argument(
        "--skip-county", action="store_true",
        help="Skip the county parcels pull (slow, ~10 min)"
    )
    parser.add_argument(
        "--sold-days", type=int, default=None,
        help="Override sold-within-days for Redfin sold homes (default: 90)"
    )
    args = parser.parse_args()

    print("=" * 60)
    print("  Greensboro Housing Data Pipeline")
    print("=" * 60)
    print()

    total_start = time.time()
    failures = []

    for i, step in enumerate(STEPS, 1):
        print(f"[{i}/{len(STEPS)}] {step['name']}")
        print(f"     {step['description']}")
        if not run_step(step, args):
            failures.append(step["name"])

    total_elapsed = time.time() - total_start
    print("=" * 60)

    if failures:
        print(f"  Pipeline finished with errors ({total_elapsed:.0f}s)")
        print(f"  Failed steps: {', '.join(failures)}")
        sys.exit(1)
    else:
        print(f"  Pipeline complete ({total_elapsed:.0f}s)")
        print(f"  Output in: data/")
        sys.exit(0)


if __name__ == "__main__":
    main()
