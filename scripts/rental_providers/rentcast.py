"""
RentCast rentals provider.

Uses RentCast's ``/v1/listings/rental/long-term`` endpoint, which returns
structured rental data including lease length, deposit, pet policy, and
furnished status — fields that Redfin and Zillow don't expose cleanly.

Requires an API key.  Configure one of:

  1. ``config.rental_sources.rentcast.api_key`` in config.json
  2. ``RENTCAST_API_KEY`` environment variable

If no key is configured, this provider returns ``[]`` silently so the
pipeline still runs with Redfin + Zillow.  RentCast's free tier gives
50 requests/month, so we fetch once per city and cache results via the
pipeline tier cadence (12 hours).
"""

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

ENDPOINT = "https://api.rentcast.io/v1/listings/rental/long-term"
PAGE_SIZE = 50


def _get_api_key(config):
    """Read the API key from config or env var."""
    sources_cfg = (config or {}).get("rental_sources", {}) or {}
    rentcast_cfg = sources_cfg.get("rentcast", {}) or {}
    key = rentcast_cfg.get("api_key") or os.environ.get("RENTCAST_API_KEY", "")
    return key.strip() if key else ""


def _fetch_city(city_name, state_code, api_key):
    """Fetch a page of rentals for a single city."""
    params = {
        "city":   city_name,
        "state":  state_code,
        "status": "Active",
        "limit":  str(PAGE_SIZE),
    }
    url = f"{ENDPOINT}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "X-Api-Key": api_key,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as exc:
        print(f"    [rentcast] {city_name}: HTTP {exc.code}")
        return []
    except Exception as exc:
        print(f"    [rentcast] {city_name}: {exc}")
        return []

    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        print(f"    [rentcast] {city_name}: JSON parse error: {exc}")
        return []

    # RentCast returns a list directly (not wrapped in a payload object)
    return data if isinstance(data, list) else []


def _listing_to_canonical(listing):
    """Map a RentCast listing dict into our canonical schema."""
    # RentCast provides clean, named fields.
    return {
        "source": "rentcast",
        "listing_id": str(listing.get("id") or ""),
        "address": listing.get("formattedAddress") or listing.get("addressLine1") or "",
        "city": listing.get("city") or "",
        "state": listing.get("state") or "",
        "zip_code": listing.get("zipCode") or "",
        "rent_monthly": listing.get("price"),
        "deposit": listing.get("depositAmount") or "",
        "beds": listing.get("bedrooms"),
        "baths": listing.get("bathrooms"),
        "sqft": listing.get("squareFootage"),
        "year_built": listing.get("yearBuilt"),
        "pets_allowed": "yes" if listing.get("petsAllowed") else ("no" if listing.get("petsAllowed") is False else ""),
        "furnished": "yes" if listing.get("furnished") else ("no" if listing.get("furnished") is False else ""),
        "lease_term_months": listing.get("leaseLength") or "",
        "available_date": listing.get("availableDate") or "",
        "property_type": listing.get("propertyType") or "",
        "latitude": listing.get("latitude"),
        "longitude": listing.get("longitude"),
        "listing_url": listing.get("url") or "",
        "photo_url": (listing.get("photos") or [None])[0] if isinstance(listing.get("photos"), list) else "",
    }


def fetch(cities, config):
    """Fetch rentals for every configured city via RentCast.

    Args:
        cities: list of ``{region_id, name}`` dicts from config.json
        config: full config dict; we read ``rental_sources.rentcast.api_key``
                and ``metro.state_code``

    Returns a list of canonical rental records, or ``[]`` when no API key
    is configured.
    """
    api_key = _get_api_key(config)
    if not api_key:
        print("    [rentcast] no api_key configured; skipping "
              "(set rental_sources.rentcast.api_key in config.json or "
              "RENTCAST_API_KEY env var)")
        return []

    state_code = ((config or {}).get("metro", {}) or {}).get("state_code", "")
    if not state_code:
        print("    [rentcast] no metro.state_code configured; skipping")
        return []

    results = []
    for city in cities or []:
        name = city.get("name")
        if not name:
            continue
        print(f"    [rentcast] {name}...", flush=True)
        listings = _fetch_city(name, state_code, api_key)
        for listing in listings:
            row = _listing_to_canonical(listing)
            if row.get("address"):
                results.append(row)
        time.sleep(0.5)
    return results
