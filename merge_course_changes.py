#!/usr/bin/env python3
"""Merge successive course change log entries with the same starting direction.

Usage:

  python merge_course_changes.py input.yml output.yml

The script reads a YAML file containing a list of log entries. Successive
entries that describe course changes with the same starting course are merged
into a single entry. Course changes are identified from the ``text`` field in
the form ``"Course change: X° → Y°"``. The resulting entry uses the last
``to`` value and position, the maximum of ``maxSpeed`` and ``maxWind`` values,
and averages the wind speed and direction.
"""
import sys
import math
import re
from typing import List, Dict, Any, Optional, Tuple


import yaml


def circular_mean(angles: List[float]) -> float:
    """Return the circular mean of a list of angles in degrees."""
    if not angles:
        raise ValueError("angles list must not be empty")
    sin_sum = sum(math.sin(math.radians(a)) for a in angles)
    cos_sum = sum(math.cos(math.radians(a)) for a in angles)
    return (math.degrees(math.atan2(sin_sum, cos_sum)) + 360.0) % 360.0



def parse_course_change(entry: Dict[str, Any]) -> Optional[Tuple[float, float]]:
    """Extract (from, to) course values from an entry's text if present."""
    text = entry.get("text")
    if not isinstance(text, str):
        return None
    match = re.search(
        r"Course change:\s*([0-9]+(?:\.[0-9]+)?)\s*[°º]?\s*(?:→|->)\s*([0-9]+(?:\.[0-9]+)?)",
        text,
    )
    if not match:
        return None
    return float(match.group(1)), float(match.group(2))



def merge_entries(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    i = 0
    n = len(entries)
    while i < n:
        entry = entries[i]

        parsed = parse_course_change(entry) if isinstance(entry, dict) else None
        if parsed:
            from_course, _ = parsed
            group = [entry]
            i += 1
            while i < n:
                next_entry = entries[i]
                next_parsed = parse_course_change(next_entry) if isinstance(next_entry, dict) else None
                if next_parsed and next_parsed[0] == from_course:
                    group.append(next_entry)
                    i += 1
                else:
                    break

            if len(group) == 1:
                merged.append(entry)
                continue
            combined = group[0].copy()

            _, final_to = parse_course_change(group[-1])  # type: ignore[arg-type]
            combined["text"] = f"Course change: {from_course:g}° → {final_to:g}°"

            if "position" in group[-1]:
                combined["position"] = group[-1]["position"]
            # Determine maximum speed and wind values
            max_speed = max(
                (e.get("maxSpeed") for e in group if e.get("maxSpeed") is not None),
                default=None,
            )
            if max_speed is not None:
                combined["maxSpeed"] = max_speed
            max_wind = max(
                (e.get("maxWind") for e in group if e.get("maxWind") is not None),
                default=None,
            )
            if max_wind is not None:
                combined["maxWind"] = max_wind
            # Average wind speed and direction
            wind_speeds = [
                e.get("wind", {}).get("speed")
                for e in group
                if e.get("wind", {}).get("speed") is not None
            ]
            wind_dirs = [
                e.get("wind", {}).get("direction")
                for e in group
                if e.get("wind", {}).get("direction") is not None
            ]
            if wind_speeds or wind_dirs:
                combined.setdefault("wind", {})
                if wind_speeds:
                    combined["wind"]["speed"] = sum(wind_speeds) / len(wind_speeds)
                if wind_dirs:
                    combined["wind"]["direction"] = circular_mean(wind_dirs)
            merged.append(combined)
        else:
            merged.append(entry)
            i += 1
    return merged


def main() -> None:

    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input.yml> <output.yml>")
        sys.exit(1)
    in_path, out_path = sys.argv[1:3]
    with open(in_path, "r", encoding="utf-8") as f:

        data = yaml.safe_load(f)
    if not isinstance(data, list):
        print("Log must contain a list of entries", file=sys.stderr)
        sys.exit(1)
    result = merge_entries(data)    with open(out_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(result, f, sort_keys=False)



if __name__ == "__main__":
    main()
