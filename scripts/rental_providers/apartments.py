"""
Apartments.com rentals provider.

Scrapes city search pages on Apartments.com to collect rental listings.
Apartments.com is the largest rental listing platform in the US (owned by
CoStar Group).

This provider fetches the server-rendered search results for each configured
city and extracts listing data from the HTML.  Apartments.com uses Cloudflare
and Akamai WAF, so this provider may be blocked from some environments
(e.g. cloud IPs).  Like all providers, it fails gracefully — blocks are
logged and an empty list is returned so the pipeline keeps running.

No API key is required.
"""

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)

_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
    "Sec-CH-UA": '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="8"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
}


# ---------------------------------------------------------------------------
# HTML parsing helpers (stdlib only — no BeautifulSoup dependency)
# ---------------------------------------------------------------------------

class _ListingCardParser(HTMLParser):
    """Extract listing data from Apartments.com search result HTML.

    Apartments.com embeds listing cards as ``<article>`` elements (or
    ``<li>`` with class ``mortar-wrapper``) containing nested elements
    with well-known CSS classes:

      - ``property-title``  — apartment complex name
      - ``property-address`` — street address
      - ``price-range``     — rent (e.g. "$1,200 - $1,500")
      - ``bed-range``       — beds (e.g. "1-3 Beds")
      - ``property-link``   — <a> with href to detail page
      - ``rentInfoDetail``  — may contain sqft

    We accumulate text within these elements to build listing records.
    """

    def __init__(self):
        super().__init__()
        self.listings = []
        self._current = None
        self._capture = None  # which field we're capturing text for
        self._depth = 0

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        classes = (attrs_dict.get("class") or "").split()

        # Detect listing card boundaries
        if tag == "article" or (tag == "li" and "mortar-wrapper" in classes):
            self._current = {}
            return

        if self._current is None:
            return

        # Property link — extract href
        if "property-link" in classes and tag == "a":
            href = attrs_dict.get("href", "")
            if href and "apartments.com" in href:
                self._current["listing_url"] = href
            elif href and href.startswith("/"):
                self._current["listing_url"] = f"https://www.apartments.com{href}"

        # Image — extract src
        if tag == "img" and not self._current.get("photo_url"):
            src = attrs_dict.get("data-src") or attrs_dict.get("src") or ""
            if src and not src.endswith(".svg") and ("cdn" in src or "image" in src or "photo" in src):
                self._current["photo_url"] = src

        # Start capturing text for specific fields
        if "property-title" in classes or "js-placardTitle" in classes:
            self._capture = "name"
            self._current.setdefault("name", "")
        elif "property-address" in classes:
            self._capture = "address"
            self._current.setdefault("address", "")
        elif "price-range" in classes:
            self._capture = "rent_monthly"
            self._current.setdefault("rent_monthly", "")
        elif "bed-range" in classes:
            self._capture = "beds"
            self._current.setdefault("beds", "")
        elif "rentInfoDetail" in classes:
            self._capture = "sqft"
            self._current.setdefault("sqft", "")

    def handle_endtag(self, tag):
        if tag in ("article",) or (tag == "li" and self._current is not None):
            if self._current and self._current.get("address"):
                self.listings.append(self._current)
            self._current = None
            self._capture = None
        # Stop capturing on any closing tag for the captured element
        if self._capture and tag in ("span", "div", "p", "a", "h3", "h4"):
            self._capture = None

    def handle_data(self, data):
        if self._capture and self._current is not None:
            self._current[self._capture] = (
                self._current.get(self._capture, "") + data.strip()
            )


def _extract_json_ld(html):
    """Extract listing data from JSON-LD script tags if present.

    Apartments.com sometimes embeds structured data as
    ``<script type="application/ld+json">`` containing an array of
    ApartmentComplex or RentAction schema objects.
    """
    results = []
    for m in re.finditer(
        r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        re.DOTALL | re.IGNORECASE,
    ):
        try:
            data = json.loads(m.group(1))
        except (json.JSONDecodeError, ValueError):
            continue

        items = data if isinstance(data, list) else [data]
        for item in items:
            if not isinstance(item, dict):
                continue
            # Look for ApartmentComplex or similar schema types
            schema_type = item.get("@type", "")
            if schema_type in ("ApartmentComplex", "Apartment", "Residence", "Place"):
                addr = item.get("address") or {}
                geo = item.get("geo") or {}
                results.append({
                    "name": item.get("name", ""),
                    "address": addr.get("streetAddress", ""),
                    "city": addr.get("addressLocality", ""),
                    "state": addr.get("addressRegion", ""),
                    "zip_code": addr.get("postalCode", ""),
                    "latitude": geo.get("latitude"),
                    "longitude": geo.get("longitude"),
                    "listing_url": item.get("url", ""),
                    "photo_url": item.get("image", ""),
                })
    return results


def _parse_rent(raw):
    """Parse a rent string like '$1,200 - $1,500' into the lower bound int."""
    if not raw:
        return ""
    # Take the first dollar amount found
    m = re.search(r"\$[\d,]+", str(raw))
    if not m:
        return ""
    try:
        return int(m.group(0).replace("$", "").replace(",", ""))
    except (ValueError, TypeError):
        return ""


def _parse_beds(raw):
    """Parse a beds string like '1-3 Beds' into the lower bound int."""
    if not raw:
        return ""
    m = re.search(r"(\d+)", str(raw))
    if m:
        return int(m.group(1))
    if "studio" in str(raw).lower():
        return 0
    return ""


def _parse_sqft(raw):
    """Parse a sqft string like '750-1,200 Sq Ft' into the lower bound int."""
    if not raw:
        return ""
    m = re.search(r"([\d,]+)\s*sq", str(raw), re.IGNORECASE)
    if m:
        try:
            return int(m.group(1).replace(",", ""))
        except (ValueError, TypeError):
            pass
    return ""


def _parse_address(raw):
    """Split 'Street, City, State Zip' into components."""
    if not raw:
        return "", "", "", ""
    parts = [p.strip() for p in raw.split(",")]
    street = parts[0] if parts else raw
    city = parts[1] if len(parts) > 1 else ""
    state_zip = parts[2] if len(parts) > 2 else ""
    state = ""
    zip_code = ""
    if state_zip:
        sz = state_zip.split()
        state = sz[0] if sz else ""
        zip_code = sz[-1] if len(sz) > 1 else ""
    return street, city, state, zip_code


def _to_canonical(raw_listing, default_city="", default_state="NC"):
    """Convert a raw parsed listing dict to the canonical rental schema."""
    # Address may be full or just street
    address = raw_listing.get("address", "")
    city = raw_listing.get("city", "")
    state = raw_listing.get("state", "")
    zip_code = raw_listing.get("zip_code", "")

    if address and not city:
        street, city, state, zip_code = _parse_address(address)
        address = street

    return {
        "source": "apartments",
        "listing_id": "",
        "address": address,
        "city": city or default_city,
        "state": state or default_state,
        "zip_code": zip_code,
        "rent_monthly": _parse_rent(raw_listing.get("rent_monthly")),
        "deposit": "",
        "beds": _parse_beds(raw_listing.get("beds")),
        "baths": "",
        "sqft": _parse_sqft(raw_listing.get("sqft")),
        "year_built": "",
        "pets_allowed": "",
        "furnished": "",
        "lease_term_months": "",
        "available_date": "",
        "property_type": "",
        "latitude": raw_listing.get("latitude"),
        "longitude": raw_listing.get("longitude"),
        "listing_url": raw_listing.get("listing_url", ""),
        "photo_url": raw_listing.get("photo_url", ""),
    }


def _fetch_city(city_name, state_code):
    """Fetch the Apartments.com search page for a single city.

    Returns a list of raw listing dicts, or ``[]`` on any failure.
    """
    slug = city_name.lower().replace(" ", "-")
    state_slug = state_code.lower()
    url = f"https://www.apartments.com/{slug}-{state_slug}/"

    req = urllib.request.Request(url, headers=_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as exc:
        print(f"    [apartments] {city_name}: HTTP {exc.code}")
        return []
    except Exception as exc:
        print(f"    [apartments] {city_name}: {exc}")
        return []

    # First try JSON-LD (cleanest structured data)
    results = _extract_json_ld(html)
    if results:
        return results

    # Fall back to HTML parsing
    parser = _ListingCardParser()
    try:
        parser.feed(html)
    except Exception:
        pass
    return parser.listings


def fetch(cities, config):
    """Fetch rental listings from Apartments.com for each configured city.

    Args:
        cities: list of ``{region_id, name}`` dicts from config.json
        config: full config dict; we read ``metro.state_code``

    Returns a list of canonical rental records, or ``[]`` on any failure.
    """
    metro = (config or {}).get("metro", {}) or {}
    state_code = metro.get("state_code", "NC")

    results = []
    for city in cities or []:
        name = city.get("name", "")
        if not name:
            continue
        print(f"    [apartments] {name}...", flush=True)
        raw_listings = _fetch_city(name, state_code)
        for raw in raw_listings:
            row = _to_canonical(raw, default_city=name, default_state=state_code)
            if row.get("address"):
                results.append(row)
        time.sleep(1)  # polite throttle
    return results
