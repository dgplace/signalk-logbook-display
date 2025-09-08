#!/usr/bin/env python3
"""Merge successive course change log entries with the same starting direction.

Usage:

  python merge_course_changes.py input.yml output.yml [--fix-maxima-pos]

The script reads a YAML file containing a list of log entries. Successive
entries that describe course changes with the same starting course are merged
into a single entry. Course changes are identified from the ``text`` field in
the form ``"Course change: X° → Y°"``. The resulting entry uses the last
``to`` value and position, the maximum of ``maxSpeed`` and ``maxWind`` values,
and averages the wind speed and direction.

Additionally, after merging, any "Course change" entries with a speed over ground
("sog") less than 0.6 knots are removed from the output.

Optionally, with ``--fix-maxima-pos``, entries indicating maximums (e.g.,
"max wind", "max heel", or "max speed") that have a missing or invalid
position will have their position backfilled with the last known good position
from earlier entries.
"""
import sys
import argparse
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

def get_sog(entry: Dict[str, Any]) -> Optional[float]:
    """Return sog (knots) from entry if available and numeric, else None."""
    spd = entry.get("speed")
    if isinstance(spd, dict):
        sog = spd.get("sog")
        if isinstance(sog, (int, float)):
            return float(sog)
    return None

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
            if "speed" in group[-1]:
                combined["speed"] = group[-1]["speed"]
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
    # After merging, drop course change entries with sog < 0.6 kt
    filtered: List[Dict[str, Any]] = []
    for e in merged:
        is_course_change = parse_course_change(e) is not None if isinstance(e, dict) else False
        sog = get_sog(e) if isinstance(e, dict) else None
        if is_course_change and sog is not None and sog < 0.6:
            continue  # skip low-speed course change entries
        filtered.append(e)
    return filtered


def _is_good_position_value(pos: Any) -> bool:
    if not isinstance(pos, dict):
        return False
    lon = pos.get("longitude")
    lat = pos.get("latitude")
    if not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)):
        return False
    # Basic bounds check and filter out (0,0) which is commonly invalid for logs
    if not (-180.0 <= float(lon) <= 180.0 and -90.0 <= float(lat) <= 90.0):
        return False
    if float(lon) == 0.0 and float(lat) == 0.0:
        return False
    return True


def _is_maxima_entry(entry: Dict[str, Any]) -> bool:
    # Check explicit fields first
    maxima_fields = ("maxWind", "maxHeel", "maxSpeed")
    if any(k in entry and entry.get(k) is not None for k in maxima_fields):
        return True
    # Fallback to text matching if present
    text = entry.get("text")
    if isinstance(text, str):
        return re.search(r"\bmax(?:imum)?\s+(wind|heel|speed)\b", text, re.IGNORECASE) is not None
    return False


def fix_maxima_positions(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Backfill positions for maxima entries using last known good position.

    - A "good" position is within valid lat/lon bounds and not (0,0).
    - Maxima entries are those with maxWind/maxHeel/maxSpeed fields or text matching
      "max wind/heel/speed" (case-insensitive).
    """
    last_good_pos: Optional[Dict[str, Any]] = None
    for e in entries:
        pos = e.get("position") if isinstance(e, dict) else None
        is_max = _is_maxima_entry(e) if isinstance(e, dict) else False
        # Update last_good_pos only from non-maxima entries with a valid position
        if not is_max and _is_good_position_value(pos):
            # Keep a copy to avoid accidental later mutation
            last_good_pos = {
                "longitude": float(pos["longitude"]),  # type: ignore[index]
                "latitude": float(pos["latitude"])    # type: ignore[index]
            }
            continue
        # For maxima entries, backfill if position is missing/invalid and we have a prior good one
        if is_max and last_good_pos is not None and not _is_good_position_value(pos):
            e["position"] = last_good_pos.copy()
    return entries


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge course change log entries and optional maxima position fixes")
    parser.add_argument("input", help="Input YAML file with log entries")
    parser.add_argument("output", help="Output YAML file for merged/fixed entries")
    parser.add_argument(
        "--fix-maxima-pos",
        action="store_true",
        help="Backfill position for max wind/heel/speed entries using last good position",
    )
    args = parser.parse_args()

    in_path = args.input
    out_path = args.output
    with open(in_path, "r", encoding="utf-8") as f:

        data = yaml.safe_load(f)
    if not isinstance(data, list):
        print("Log must contain a list of entries", file=sys.stderr)
        sys.exit(1)
    if args.fix_maxima_pos:
        data = fix_maxima_positions(data)
    result = merge_entries(data)
    with open(out_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(result, f, sort_keys=False)


if __name__ == "__main__":
    main()
