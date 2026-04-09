"""
Zillow rentals provider (EXPERIMENTAL).

Hits Zillow's ``async-create-search-page-state`` endpoint, which the
website itself uses to populate rental search results.  No API key is
required, but Zillow aggressively rate-limits and captcha-walls scrapers.
This provider is best-effort:

  - On 403 / 429 / captcha responses, log and return an empty list.
  - On JSON parse failures (Zillow occasionally returns HTML), same.
  - The endpoint shape changes periodically — if this stops working,
    inspect a rental search on zillow.com in DevTools and update the
    request payload.

This provider uses the metro's ``map_center`` + a coarse bounding box
rather than iterating per-city, because Zillow's region IDs don't line
up with Redfin's.
"""

import json
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)

ENDPOINT = "https://www.zillow.com/async-create-search-page-state/"


def _build_search_state(map_center):
    """Build a minimal searchQueryState for a rental search centered on the metro.

    The bounds are roughly ±0.5° around the metro center (~35 mi).  Zillow
    will cap us at ~500 results per page regardless.
    """
    if not map_center or len(map_center) != 2:
        return None
    lat, lng = map_center
    return {
        "pagination": {},
        "isMapVisible": True,
        "mapBounds": {
            "west":  lng - 0.5,
            "east":  lng + 0.5,
            "south": lat - 0.3,
            "north": lat + 0.3,
        },
        "filterState": {
            "isForRent":      {"value": True},
            "isForSaleByAgent": {"value": False},
            "isForSaleByOwner": {"value": False},
            "isNewConstruction": {"value": False},
            "isComingSoon": {"value": False},
            "isAuction": {"value": False},
            "isForSaleForeclosure": {"value": False},
        },
        "isListVisible": True,
    }


def _extract_results(payload):
    """Pull the list of rental results out of Zillow's response envelope."""
    if not isinstance(payload, dict):
        return []
    cat = payload.get("cat1") or {}
    search_results = cat.get("searchResults") or {}
    # Zillow puts rental results under listResults (and sometimes mapResults)
    return (search_results.get("listResults") or []) + (search_results.get("mapResults") or [])


def _home_to_canonical(home):
    """Map a Zillow list-result dict into our canonical schema."""
    addr = home.get("address") or ""
    # Zillow addresses often look like "123 Main St, Greensboro, NC 27405"
    parts = [p.strip() for p in addr.split(",")]
    street = parts[0] if parts else addr
    city = parts[1] if len(parts) > 1 else home.get("addressCity", "")
    state_zip = parts[2] if len(parts) > 2 else ""
    state = (state_zip.split() or [""])[0] if state_zip else home.get("addressState", "")
    zip_code = (state_zip.split() or ["", ""])[-1] if state_zip else home.get("addressZipcode", "")

    rent = home.get("unformattedPrice")
    if rent is None:
        # Fall back to parsing the formatted string (e.g. "$1,850/mo")
        price_str = (home.get("price") or "").replace("$", "").replace(",", "").split("/")[0]
        try:
            rent = int(price_str)
        except (ValueError, TypeError):
            rent = ""

    hdp = home.get("hdpData") or {}
    home_info = hdp.get("homeInfo") or {}

    detail_url = home.get("detailUrl") or ""
    if detail_url and detail_url.startswith("/"):
        detail_url = f"https://www.zillow.com{detail_url}"

    return {
        "source": "zillow",
        "listing_id": str(home.get("zpid") or home_info.get("zpid") or ""),
        "address": street,
        "city": city or home_info.get("city", ""),
        "state": state or home_info.get("state", ""),
        "zip_code": zip_code or home_info.get("zipcode", ""),
        "rent_monthly": rent,
        "deposit": "",
        "beds": home.get("beds") or home_info.get("bedrooms"),
        "baths": home.get("baths") or home_info.get("bathrooms"),
        "sqft": home.get("area") or home_info.get("livingArea"),
        "year_built": home_info.get("yearBuilt"),
        "pets_allowed": "",
        "furnished": "",
        "lease_term_months": "",
        "available_date": "",
        "property_type": home_info.get("homeType") or home.get("hdpData", {}).get("homeInfo", {}).get("homeType") or "",
        "latitude": home.get("latLong", {}).get("latitude") or home_info.get("latitude"),
        "longitude": home.get("latLong", {}).get("longitude") or home_info.get("longitude"),
        "listing_url": detail_url,
        "photo_url": (home.get("imgSrc") or ""),
    }


def fetch(cities, config):
    """Fetch Zillow rentals for the metro's bounding box.

    Args:
        cities: ignored (Zillow uses a lat/lng bounding box, not region IDs)
        config: full config dict; we read ``metro.map_center``

    Returns a list of canonical rental records, or ``[]`` on any failure.
    """
    metro = (config or {}).get("metro", {}) or {}
    map_center = metro.get("map_center")
    state = _build_search_state(map_center)
    if not state:
        print("    [zillow] no map_center configured; skipping")
        return []

    params = {
        "searchQueryState": json.dumps(state),
        "wants": json.dumps({"cat1": ["listResults", "mapResults"]}),
        "requestId": 1,
    }
    url = f"{ENDPOINT}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.zillow.com/homes/for_rent/",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as exc:
        print(f"    [zillow] HTTP {exc.code} — Zillow likely rate-limited us; skipping")
        return []
    except Exception as exc:
        print(f"    [zillow] request failed: {exc}")
        return []

    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        print("    [zillow] response wasn't JSON (probably a captcha page); skipping")
        return []

    homes = _extract_results(payload)
    results = []
    for home in homes:
        row = _home_to_canonical(home)
        if row.get("address"):
            results.append(row)
    print(f"    [zillow] got {len(results)} rentals from metro bbox")
    return results
