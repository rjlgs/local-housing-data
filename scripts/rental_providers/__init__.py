"""
Rental provider plugins — each module exposes a ``fetch(cities, config)``
function that returns a list of canonical rental records (see base.py).

A provider returns an empty list when disabled, when credentials are missing,
or when the upstream source is unreachable.  Providers must never raise —
failures are logged and swallowed so one broken source can't sink the whole
tier.

To add a new provider:
  1. Create ``scripts/rental_providers/my_provider.py`` exposing
     ``fetch(cities, config) -> List[dict]``.
  2. Register it in ``PROVIDERS`` below.
  3. Add a ``rental_sources.my_provider`` block to ``config.json``.
"""

from . import base, redfin, rentcast, zillow

PROVIDERS = {
    "redfin":   redfin,
    "zillow":   zillow,
    "rentcast": rentcast,
}


def fetch_all(cities, config):
    """Run every enabled provider and concatenate their results.

    Returns a list of canonical rental records (see ``base.CANONICAL_FIELDS``),
    each carrying a ``source`` string identifying which provider produced it.
    Providers are skipped silently when ``config.rental_sources.<name>.enabled``
    is false.
    """
    sources_cfg = (config or {}).get("rental_sources", {}) or {}
    combined = []
    summary = {}
    for name, module in PROVIDERS.items():
        source_cfg = sources_cfg.get(name, {}) or {}
        if not source_cfg.get("enabled", False):
            summary[name] = "disabled"
            continue
        try:
            rows = module.fetch(cities, config) or []
        except Exception as exc:
            print(f"  [{name}] provider raised unexpectedly: {exc}")
            summary[name] = f"error ({exc.__class__.__name__})"
            continue
        # Defensive: ensure every row carries the source name.
        for row in rows:
            row.setdefault("source", name)
        combined.extend(rows)
        summary[name] = f"{len(rows)} rows"

    parts = " | ".join(f"{name}: {status}" for name, status in summary.items())
    print(f"  Provider summary: {parts}")
    return combined
