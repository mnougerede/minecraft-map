import csv, json, sys

# Usage: python csv_to_json.py input.csv output.json
in_path = sys.argv[1]
out_path = sys.argv[2]

points = []
with open(in_path, newline="", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    for row in reader:
        name = (row.get("name") or "").strip()
        if not name:
            continue

        def to_int(v):
            v = (v or "").strip()
            return int(float(v)) if v else None  # handles "12", "12.0"

        points.append({
            "name": name,
            "x": to_int(row.get("x")),
            "y": to_int(row.get("y")),
            "z": to_int(row.get("z")),
            "type": (row.get("type") or "").strip() or None,
            "notes": (row.get("notes") or "").strip() or None
        })

data = {"points": points}

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"Wrote {len(points)} points to {out_path}")
