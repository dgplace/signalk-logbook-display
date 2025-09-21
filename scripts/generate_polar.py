#!/usr/bin/env python3
"""Generate sailing polar diagrams grouped by true wind speed bins."""
from __future__ import annotations

import argparse
import json
import math
from bisect import bisect_left
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


@dataclass(frozen=True)
class Sample:
    """Minimal sailing sample used for plotting."""
    theta: float  # absolute true wind angle in radians
    stw: float     # speed through water in knots


WIND_BINS: List[Tuple[str, float, Optional[float]]] = [
    ("2.5-7.5 kn", 2.5, 7.5),
    ("7.5-12.5 kn", 7.5, 12.5),
    ("12.5-17.5 kn", 12.5, 17.5),
    (">17.5 kn", 17.5, None),
]

WIND_BIN_TWS: Dict[str, float] = {
    "2.5-7.5 kn": 5.0,
    "7.5-12.5 kn": 10.0,
    "12.5-17.5 kn": 15.0,
    ">17.5 kn": 20.0,
}

TWA_BAND_CENTERS: List[int] = list(range(35, 181, 10))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Parse voyages.json and generate polar curves per true wind speed band."
        )
    )
    parser.add_argument(
        "--voyages-file",
        default=Path("public/voyages.json"),
        type=Path,
        help="Path to the voyages.json file exported from the logbook",
    )
    parser.add_argument(
        "--output",
        default=Path("polar_diagram.png"),
        type=Path,
        help="Output image path for the polar diagram",
    )
    parser.add_argument(
        "--text-output",
        default=Path("polar.txt"),
        type=Path,
        help="Output path for the tab-separated polar table",
    )
    parser.add_argument(
        "--bin-size",
        default=10,
        type=int,
        help="Angle bin size in degrees for the aggregated polar curve",
    )
    parser.add_argument(
        "--percentile",
        default=80,
        type=float,
        help="Percentile of speed samples to plot for each aggregated curve (0-100)",
    )
    parser.add_argument(
        "--min-samples",
        default=3,
        type=int,
        help="Minimum samples per angle bin required to include it in the aggregated curve",
    )
    return parser.parse_args()


def parse_iso8601(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


def percentile(values: Iterable[float], pct: float) -> float:
    ordered = sorted(values)
    if not ordered:
        raise ValueError("Cannot compute percentile of empty dataset")
    if len(ordered) == 1:
        return ordered[0]
    clamped_pct = max(0.0, min(100.0, pct))
    rank = (len(ordered) - 1) * (clamped_pct / 100.0)
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return ordered[lower]
    lower_value = ordered[lower]
    upper_value = ordered[upper]
    fraction = rank - lower
    return lower_value + (upper_value - lower_value) * fraction


def true_wind_angle(course: float, wind_dir: float) -> float:
    """Return the absolute true wind angle (0-180) with 0 meaning head to wind."""
    angle = (wind_dir - course) % 360.0
    if angle > 180.0:
        angle = 360.0 - angle
    return angle


def load_voyages(path: Path) -> Dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def categorize_wind_speed(speed: float) -> Optional[str]:
    for label, lower, upper in WIND_BINS:
        if upper is None:
            if speed >= lower:
                return label
        else:
            if lower <= speed < upper:
                return label
    return None


def collect_sailing_samples(voyages: Dict) -> Dict[str, List[Sample]]:
    samples_by_band: Dict[str, List[Sample]] = {label: [] for label, *_ in WIND_BINS}
    voyages_list = voyages.get("voyages", [])
    for voyage in voyages_list:
        start_str = voyage.get("startTime")
        end_str = voyage.get("endTime")
        if not start_str or not end_str:
            continue
        try:
            start_time = parse_iso8601(start_str)
            end_time = parse_iso8601(end_str)
        except ValueError:
            continue
        exclusion_seconds = 3600  # 1 hour
        points = voyage.get("points", [])
        for point in points:
            entry = point.get("entry", {})
            dt_str = entry.get("datetime")
            if not dt_str:
                continue
            try:
                entry_time = parse_iso8601(dt_str)
            except ValueError:
                continue
            if (entry_time - start_time).total_seconds() < exclusion_seconds:
                continue
            if (end_time - entry_time).total_seconds() < exclusion_seconds:
                continue
            speed_data = entry.get("speed", {})
            wind_data = entry.get("wind", {})
            stw = speed_data.get("stw")
            sog = speed_data.get("sog")
            wind_speed = wind_data.get("speed")
            wind_dir = wind_data.get("direction")
            course = entry.get("course")
            if stw is None or sog is None or wind_speed is None or wind_dir is None or course is None:
                continue
            if wind_speed <= 0:
                continue
            if sog > 0.8 * wind_speed:
                continue
            band_label = categorize_wind_speed(float(wind_speed))
            if not band_label:
                continue
            angle_deg = true_wind_angle(float(course), float(wind_dir))
            if angle_deg < 30.0:
                continue
            theta_primary = math.radians(angle_deg)
            stw_value = float(stw)
            samples_by_band[band_label].append(Sample(theta_primary, stw_value))
            if 0.0 < angle_deg < 180.0:
                mirrored_angle = (360.0 - angle_deg) % 360.0
                if mirrored_angle <= 330.0:
                    mirrored_theta = math.radians(mirrored_angle)
                    samples_by_band[band_label].append(Sample(mirrored_theta, stw_value))
    return samples_by_band


def bucket_by_angle(samples: Iterable[Sample], bin_size: int) -> Dict[int, List[float]]:
    buckets: Dict[int, List[float]] = defaultdict(list)
    for sample in samples:
        angle_deg = math.degrees(sample.theta)
        bucket_center = int(((angle_deg + (bin_size / 2.0)) % 360) // bin_size * bin_size)
        buckets[bucket_center].append(sample.stw)
    return buckets




def remove_outliers(values: Iterable[float]) -> List[float]:
    data = list(values)
    if len(data) < 4:
        return data
    q1 = percentile(data, 25)
    q3 = percentile(data, 75)
    iqr = q3 - q1
    if iqr <= 0:
        return [v for v in data if q1 <= v <= q3]
    lower = q1 - 1.5 * iqr
    upper = q3 + 1.5 * iqr
    return [v for v in data if lower <= v <= upper]



def smooth_curve(points: List[Tuple[float, float]], window: int = 2) -> List[Tuple[float, float]]:
    if len(points) <= 3 or window <= 0:
        return points
    smoothed: List[Tuple[float, float]] = []
    n = len(points)
    for idx, (angle, speed) in enumerate(points):
        if idx == 0 or idx == n - 1:
            smoothed.append((angle, speed))
            continue
        start = max(0, idx - window)
        end = min(n, idx + window + 1)
        window_speeds = [pts[1] for pts in points[start:end]]
        smoothed.append((angle, sum(window_speeds) / len(window_speeds)))
    return smoothed

def aggregated_curve(samples: List[Sample], bin_size: int, pct: float, min_samples: int) -> Tuple[List[float], List[float]]:
    bins = bucket_by_angle(samples, bin_size)
    curve_points: List[Tuple[float, float]] = []
    for angle_deg in sorted(bins.keys()):
        filtered = remove_outliers(bins[angle_deg])
        if len(filtered) < min_samples:
            continue
        curve_points.append((float(angle_deg), percentile(filtered, pct)))
    if not curve_points:
        curve_points = [(0.0, 0.0), (360.0, 0.0)]
    else:
        curve_points.sort(key=lambda item: item[0])
        if curve_points[0][0] > 0.0:
            curve_points.insert(0, (0.0, 0.0))
        else:
            curve_points[0] = (0.0, 0.0)
        if curve_points[-1][0] < 360.0:
            curve_points.append((360.0, 0.0))
        else:
            curve_points[-1] = (360.0, 0.0)
    smoothed_points = smooth_curve(curve_points)
    angles = [math.radians(angle) for angle, _ in smoothed_points]
    speeds = [speed for _, speed in smoothed_points]
    return angles, speeds

def interpolate_speed(points: List[Tuple[float, float]], target: float) -> Optional[float]:
    if not points:
        return None
    angles = [angle for angle, _ in points]
    idx = bisect_left(angles, target)
    if idx < len(points) and math.isclose(angles[idx], target, abs_tol=1e-6):
        return points[idx][1]
    if idx == 0:
        first_angle, first_speed = points[0]
        if first_angle >= target and first_angle - target <= 10.0:
            return first_speed
        return None
    if idx == len(points):
        last_angle, last_speed = points[-1]
        if target >= last_angle and target - last_angle <= 10.0:
            return last_speed
        return None
    left_angle, left_speed = points[idx - 1]
    right_angle, right_speed = points[idx]
    if math.isclose(right_angle, left_angle, abs_tol=1e-6):
        return left_speed
    proportion = (target - left_angle) / (right_angle - left_angle)
    return left_speed + proportion * (right_speed - left_speed)


def write_polar_table(curves: Dict[str, Tuple[List[float], List[float]]], output_path: Path) -> None:
    if not curves:
        output_path.write_text("TWS\n")
        return
    filtered: Dict[str, List[Tuple[float, float]]] = {}
    for label, (angles, speeds) in curves.items():
        filtered_points = [
            (math.degrees(angle), speed)
            for angle, speed in zip(angles, speeds)
            if 30.0 <= math.degrees(angle) <= 330.0
        ]
        filtered[label] = sorted(filtered_points, key=lambda item: item[0])
    header: List[str] = ["TWS"]
    for center in TWA_BAND_CENTERS:
        header.extend([f"TWA{center}", f"STW{center}"])
    lines = ["	".join(header)]
    for label in curves.keys():
        points = filtered.get(label, [])
        tws = WIND_BIN_TWS.get(label)
        if tws is None:
            lower_upper = next(((lower, upper) for lbl, lower, upper in WIND_BINS if lbl == label), None)
            if lower_upper is not None:
                lower, upper = lower_upper
                if upper is None:
                    tws = lower + 2.5
                else:
                    tws = (lower + upper) / 2.0
            else:
                tws = 0.0
        row: List[str] = [f"{tws:.1f}"]
        for center in TWA_BAND_CENTERS:
            row.append(f"{center}")
            stw_value = interpolate_speed(points, center)
            row.append("" if stw_value is None else f"{stw_value:.2f}")
        lines.append("	".join(row))
    output_path.write_text("\n".join(lines) + "\n")

def make_plot(samples_by_band: Dict[str, List[Sample]], args: argparse.Namespace) -> None:
    total_samples = sum(len(samples) for samples in samples_by_band.values())
    if total_samples == 0:
        raise SystemExit("No sailing samples found with the provided filters.")
    fig = plt.figure(figsize=(9, 9))
    ax = fig.add_subplot(111, projection="polar")
    ax.set_theta_zero_location("N")
    ax.set_theta_direction(-1)

    color_cycle = plt.rcParams["axes.prop_cycle"].by_key().get("color", [])
    if len(color_cycle) < len(WIND_BINS):
        color_cycle.extend([
            "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b",
        ])
    band_curves: Dict[str, Tuple[List[float], List[float]]] = {}
    for idx, (label, *_bounds) in enumerate(WIND_BINS):
        samples = samples_by_band[label]
        if not samples:
            band_curves[label] = ([], [])
            continue
        color = color_cycle[idx % len(color_cycle)]
        thetas, speeds = zip(*((s.theta, s.stw) for s in samples))
        ax.scatter(thetas, speeds, s=10, alpha=0.15, color=color)
        angles, aggregated_speeds = aggregated_curve(samples, args.bin_size, args.percentile, args.min_samples)
        band_curves[label] = (angles, aggregated_speeds)
        if angles and aggregated_speeds and any(speed > 0 for speed in aggregated_speeds):
            ax.plot(angles, aggregated_speeds, linewidth=2, color=color, label=f"{label} ({int(args.percentile)}th %ile)")

    write_polar_table(band_curves, args.text_output)
    ax.set_title("Sailing Polar Diagram by True Wind Speed")
    ax.set_rlabel_position(90)
    ax.grid(True)
    ax.legend(loc="upper right", bbox_to_anchor=(1.3, 1.2))
    plt.tight_layout()
    plt.savefig(args.output, dpi=150)
    plt.close(fig)


def main() -> None:
    args = parse_args()
    voyages_data = load_voyages(args.voyages_file)
    samples_by_band = collect_sailing_samples(voyages_data)
    make_plot(samples_by_band, args)
    print(f"Polar diagram saved to {args.output}")
    print(f"Polar table saved to {args.text_output}")


if __name__ == "__main__":
    main()
