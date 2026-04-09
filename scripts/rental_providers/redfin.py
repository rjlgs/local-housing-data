"""
Redfin rentals provider.

Uses Redfin's public ``stingray`` search endpoint for rentals.  The endpoint
returns a JSON blob prefixed with ``{}&&`` (anti-JSONP guard) that we strip
before parsing.  No API key or authentication is required — we spoof a
browser User-Agent the same way ``fetch_active_listings.py`` does.

This provider is the most reliable of the three rental sources because it
shares infrastructure with the existing sold/active pipeline.  If Redfin
changes the response shape, expect to see empty results — check the dev
tools Network tab on www.redfin.com/city/<id>/rentals to find the current
endpoint.
"""

import json
import time
import urllib.parse
import urllib.request

BASE_URL = "https://www.redfin.com/stingray/api/gis"

USER_AGENT = "Mozilla/5.0 (compatible; housing-data-pipeline/1.0)"

# Redfin's rental status flag (observed on rental search URLs).
# If this stops returning rows, inspect a rental search in DevTools and
# update accordingly.
RENTAL_STATUS = "9"
RENTAL_UIPT = "1,2,3,4,5,6,7,8"  # include all residential types


def _fetch_city(region_id):
    """Hit the Redfin gis endpoint for a single city's rentals.

    Returns raw listing dicts from Redfin's response, or ``[]`` on any
    HTTP / parse error.
    """
    params = {
        "al": "1",
        "market": "greensboro",  # overridden by caller via config if needed
        "num_homes": "350",
        "ord": "redfin-recommended-asc",
        "page_number": "1",
        "region_id": region_id,
        "region_type": "6",
        "status": RENTAL_STATUS,
        "uipt": RENTAL_UIPT,
        "v": "8",
        "sf": "1,2,3,5,6,7",
    }
    url = f"{BASE_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8", errors="ignore")
    except Exception as exc:
        print(f"    [redfin] region {region_id}: {exc}")
        return []

    # Redfin wraps JSON with '{}&&' as an anti-JSONP guard
    if text.startswith("{}&&"):
        text = text[4:]
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        print(f"    [redfin] region {region_id}: JSON parse error: {exc}")
        return []

    payload = (data or {}).get("payload") or {}
    homes = payload.get("homes") or []
    return homes


def _home_to_canonical(home):
    """Map a Redfin ``home`` dict into our canonical rental schema."""
    addr_info = home.get("streetLine") or {}
    price_info = home.get("price") or {}
    beds = home.get("beds")
    baths = home.get("baths")
    sqft_info = home.get("sqFt") or {}
    lot_info = home.get("lotSize") or {}
    year = home.get("yearBuilt", {}).get("value") if isinstance(home.get("yearBuilt"), dict) else home.get("yearBuilt")
    lat_lng = home.get("latLong") or {}
    coords = lat_lng.get("value") or {}
    photos = home.get("photos") or {}

    first_photo = None
    if isinstance(photos, dict):
        items = photos.get("items") or []
        if items:
            first_photo = items[0].get("url")

    listing_url = home.get("url")
    if listing_url and not listing_url.startswith("http"):
        listing_url = f"https://www.redfin.com{listing_url}"

    return {
        "source": "redfin",
        "listing_id": str(home.get("propertyId") or home.get("mlsId") or ""),
        "address": addr_info.get("value") if isinstance(addr_info, dict) else str(addr_info or ""),
        "city": home.get("city") or "",
        "state": home.get("state") or "",
        "zip_code": home.get("postalCode", {}).get("value") if isinstance(home.get("postalCode"), dict) else (home.get("postalCode") or ""),
        "rent_monthly": price_info.get("value") if isinstance(price_info, dict) else price_info,
        "deposit": "",   # Redfin's rental JSON doesn't consistently expose this
        "beds": beds,
        "baths": baths,
        "sqft": sqft_info.get("value") if isinstance(sqft_info, dict) else sqft_info,
        "year_built": year,
        "pets_allowed": "",
        "furnished": "",
        "lease_term_months": "",
        "available_date": "",
        "property_type": (home.get("propertyType") or ""),
        "latitude": coords.get("latitude"),
        "longitude": coords.get("longitude"),
        "listing_url": listing_url or "",
        "photo_url": first_photo or "",
    }


def fetch(cities, config):
    """Fetch rentals for every configured city.

    Args:
        cities: list of ``{region_id, name}`` dicts from config.json
        config: full config dict (unused here, accepted for API consistency)

    Returns a list of canonical rental records.
    """
    results = []
    for city in cities or []:
        region_id = city.get("region_id")
        name = city.get("name", "?")
        if not region_id:
            continue
        print(f"    [redfin] {name}...", flush=True)
        homes = _fetch_city(region_id)
        for home in homes:
            row = _home_to_canonical(home)
            if row.get("address"):
                results.append(row)
        time.sleep(0.5)
    return results
