"""Import many reports from a CSV file through the running API.

Usage (backend must be running, run from the backend folder):
    python scripts/import_reports.py reports.csv --dry-run     check only
    python scripts/import_reports.py reports.csv               import for real

CSV columns, first row must be exactly:
    name,latitude,longitude,type,description,source

type must be one of:
    missing_ramp, blocked_path, stairs, broken_sidewalk,
    inaccessible_crossing, other

Every imported report starts as "pending", like a report made on the website.
Review them afterwards as admin. A row is skipped when an active report of the
same type already exists within 50 m, so running the script twice is safe.
Uses only the Python standard library.
"""

import argparse
import csv
import json
import sys
import urllib.error
import urllib.request
from math import asin, cos, radians, sin, sqrt

TYPES = {
    "missing_ramp", "blocked_path", "stairs",
    "broken_sidewalk", "inaccessible_crossing", "other",
}
COLUMNS = ["name", "latitude", "longitude", "type", "description", "source"]
DUPLICATE_RADIUS_M = 50
# Rough box around Lucknow. Catches swapped or mistyped coordinates.
LAT_RANGE = (26.6, 27.1)
LON_RANGE = (80.7, 81.2)


def distance_m(lat1, lon1, lat2, lon2):
    p1, p2 = radians(lat1), radians(lat2)
    a = sin((p2 - p1) / 2) ** 2 + cos(p1) * cos(p2) * sin(radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371000 * asin(sqrt(a))


def call(api, path, body=None):
    request = urllib.request.Request(
        api + path,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers={"Content-Type": "application/json"},
        method="POST" if body is not None else "GET",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def check_row(row, allow_outside=False):
    """Return (clean_report, problem). Mirrors the rules the API enforces."""
    try:
        report = {
            "name": (row.get("name") or "").strip(),
            "latitude": float(row.get("latitude")),
            "longitude": float(row.get("longitude")),
            "type": (row.get("type") or "").strip(),
            "description": (row.get("description") or "").strip(),
            "source": (row.get("source") or "").strip() or "Community report",
        }
    except (TypeError, ValueError):
        return None, "latitude and longitude must be numbers"

    if not 3 <= len(report["name"]) <= 160:
        return None, "name must be 3 to 160 characters"
    if report["type"] not in TYPES:
        return None, f"type '{report['type']}' is not one of: {', '.join(sorted(TYPES))}"
    if not 10 <= len(report["description"]) <= 3000:
        return None, "description must be 10 to 3000 characters"
    if not -90 <= report["latitude"] <= 90 or not -180 <= report["longitude"] <= 180:
        return None, "latitude or longitude is out of range (did you swap them?)"
    if not 2 <= len(report["source"]) <= 80:
        return None, "source must be 2 to 80 characters"
    if not allow_outside and not (
        LAT_RANGE[0] <= report["latitude"] <= LAT_RANGE[1]
        and LON_RANGE[0] <= report["longitude"] <= LON_RANGE[1]
    ):
        return None, (
            "location is outside the Lucknow area. Latitude should be about 26.8 "
            "and longitude about 80.9 (swapped?). Use --allow-outside to import anyway"
        )
    return report, None


def main():
    parser = argparse.ArgumentParser(description="Import reports from a CSV file.")
    parser.add_argument("csv_file")
    parser.add_argument("--api", default="http://127.0.0.1:8000", help="backend address")
    parser.add_argument("--dry-run", action="store_true", help="check the file, send nothing")
    parser.add_argument("--allow-outside", action="store_true", help="allow places outside Lucknow")
    args = parser.parse_args()

    with open(args.csv_file, newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None or [c.strip() for c in reader.fieldnames] != COLUMNS:
            sys.exit("The first row must be exactly: " + ",".join(COLUMNS))
        rows = list(reader)

    if not rows:
        sys.exit("The file has no reports.")

    try:
        existing = call(args.api, "/api/reports")
    except (urllib.error.URLError, OSError) as error:
        sys.exit(f"Cannot reach the backend at {args.api}. Is it running? ({error})")

    active = [r for r in existing if r["status"] in ("pending", "verified")]
    added = skipped = bad = 0

    for number, row in enumerate(rows, start=2):  # row 1 is the header
        report, problem = check_row(row, args.allow_outside)
        if problem:
            bad += 1
            print(f"row {number}: NOT IMPORTED, {problem}")
            continue

        twin = next(
            (r for r in active
             if r["type"] == report["type"]
             and distance_m(r["latitude"], r["longitude"], report["latitude"], report["longitude"]) <= DUPLICATE_RADIUS_M),
            None,
        )
        if twin:
            skipped += 1
            print(f"row {number}: skipped, similar report already exists ('{twin['name']}')")
            continue

        if args.dry_run:
            active.append(report)  # later rows in the file are checked against it too
            added += 1
            print(f"row {number}: ok, would import '{report['name']}'")
            continue

        try:
            created = call(args.api, "/api/reports", report)
        except urllib.error.HTTPError as error:
            bad += 1
            print(f"row {number}: NOT IMPORTED, server said {error.code}: {error.read().decode('utf-8')[:200]}")
            continue

        active.append(created)  # so later rows in this file are checked against it too
        added += 1
        print(f"row {number}: imported '{report['name']}'")

    verb = "would import" if args.dry_run else "imported"
    print(f"\nDone. {verb} {added}, skipped {skipped}, with problems {bad}.")


if __name__ == "__main__":
    main()
