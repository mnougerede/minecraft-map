#!/usr/bin/env python3
import csv
import json
import sys
from pathlib import Path

"""
Usage:
  python tools/csv_to_json.py input.csv public/data.json

Expected CSV columns (case-insensitive):
  name, x, y, z, type, notes

Only name, x, z are required.
"""

def norm(s):
    return (s or "").strip().lower()

def to_int(value):
    if value is None:
        return None
    value = value.strip()
    if value == "":
        return None
    # Excel sometimes exports 12.0
    return int(float(value))

def main():
    if len(sys.argv) != 3:
        print("Usage: python tools/csv_to_json.py input.csv output.json")
        sys.exit(1)

    in_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2])

    if not in_path.exists():
        print(f"Input file not found: {in_path}")
        sys.exit(1)

    with in_path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        headers = {norm(h): h for h in reader.fieldnames or []}

        required = ["name", "x", "z"]
        missing = [h for h in required if h not in headers]
        if missing:
            print(f"Missing required columns: {missing}")
            sys.exit(1)

        points = []
        skipped = 0

        for row in reader:
            name = row[headers["name"]].strip()
            if not name:
                skipped += 1
                continue

            try:
                x = to_int(row[headers["x"]])
                z = to_int(row[headers["z"]])
            except ValueError:
                skipped += 1
                continue

            if x is None or z is None:
                skipped += 1
                continue

            point = {
                "name": name,
                "x": x,
                "z": z,
            }

            if "y" in headers:
                try:
                    point["y"] = to_int(row[headers["y"]])
                except ValueError:
                    pass

            if "type" in headers:
                t = row[headers["type"]].strip()
                if t:
                    point["type"] = t

            if "notes" in headers:
                n = row[headers["notes"]].strip()
                if n:
                    point["notes"] = n

            points.append(point)

    data = {
        "points": points,
        "meta": {
            "source": in_path.name,
            "count": len(points),
            "skipped": skipped,
        },
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(points)} points to {out_path}")
    if skipped:
        print(f"Skipped {skipped} rows (missing/invalid data)")

if __name__ == "__main__":
    main()
