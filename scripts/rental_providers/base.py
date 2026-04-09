"""
Shared helpers + canonical schema for rental providers.

Every provider must return dicts that use the field names in ``CANONICAL_FIELDS``.
Providers don't need to populate every field — missing fields become empty strings
in the CSV and ``None`` once parsed by ``build_dashboard_data.py``.
"""

import re

# Canonical field order for the rental CSV. Keep this in sync with
# ``parse_rental_csv`` in build_dashboard_data.py.
CANONICAL_FIELDS = [
    "source",             # primary provider name (one of: redfin, zillow, rentcast)
    "sources",            # ;-joined list of provider names that surfaced this listing
    "listing_id",         # provider-specific identifier
    "address",
    "city",
    "state",
    "zip_code",
    "rent_monthly",
    "deposit",
    "beds",
    "baths",
    "sqft",
    "year_built",
    "pets_allowed",       # "yes", "no", "cats", "dogs", "cats_dogs", or ""
    "furnished",          # "yes", "no", or ""
    "lease_term_months",
    "available_date",
    "property_type",
    "latitude",
    "longitude",
    "listing_url",
    "photo_url",          # first photo URL, if any
]


_ADDRESS_NORMALIZE_RE = re.compile(r"[^a-z0-9]+")


def normalize_address(addr):
    """Lowercase, strip punctuation, collapse whitespace. Used as a dedupe key."""
    if not addr:
        return ""
    return _ADDRESS_NORMALIZE_RE.sub(" ", addr.lower()).strip()


def dedupe_key(row):
    """Build a dedupe key across providers: normalized_address|zip|beds.

    Two listings with the same address + zip + bedroom count are assumed to
    be the same unit even if the providers format the address differently.
    """
    addr = normalize_address(row.get("address") or "")
    zip_code = (row.get("zip_code") or "").strip()
    beds = row.get("beds") or ""
    return f"{addr}|{zip_code}|{beds}"


def _field_score(row):
    """Count non-empty canonical fields — used to break dedupe ties."""
    return sum(1 for f in CANONICAL_FIELDS if row.get(f) not in (None, "", []))


def dedupe_rows(rows):
    """Collapse duplicate rows across providers.

    When two rows share a dedupe key, keep the one with the most fields
    populated and merge their ``source`` values into a semicolon-joined
    ``sources`` field.  Returns ``(deduped_rows, merged_count)``.
    """
    by_key = {}
    for row in rows:
        key = dedupe_key(row)
        if not key.strip("|"):
            # Fall back to listing_url if we don't have a usable dedupe key
            key = row.get("listing_url") or row.get("listing_id") or id(row)

        existing = by_key.get(key)
        if existing is None:
            row["sources"] = row.get("source", "")
            by_key[key] = row
            continue

        # Merge: keep the richer record, accumulate provider names.
        richer = row if _field_score(row) > _field_score(existing) else existing
        poorer = existing if richer is row else row
        sources = set((existing.get("sources") or existing.get("source", "")).split(";"))
        sources.update((row.get("sources") or row.get("source", "")).split(";"))
        sources.discard("")
        richer["sources"] = ";".join(sorted(sources))
        # Prefer the richer record's source as primary, but keep the merged sources list.
        by_key[key] = richer

    deduped = list(by_key.values())
    merged = len(rows) - len(deduped)
    return deduped, merged


def canonicalize(row):
    """Return a dict with only the canonical fields, filling missing ones with ''."""
    return {f: row.get(f, "") if row.get(f) is not None else "" for f in CANONICAL_FIELDS}
