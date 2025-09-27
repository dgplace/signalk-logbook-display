#!/usr/bin/env python3
"""Plot the sailing polar diagram from public/Polar.json."""

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import matplotlib.pyplot as plt
import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Plot a polar diagram using Polar.json data.")
    parser.add_argument(
        "--polar-file",
        default=Path("public/Polar.json"),
        type=Path,
        help="Path to the Polar.json file (default: public/Polar.json)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional path to save the plot instead of showing it interactively",
    )
    return parser.parse_args()


def is_finite(value) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)


def load_points(path: Path) -> List[Dict[str, float]]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(f"Polar file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Polar file is not valid JSON: {path}") from exc

    points = raw.get("points", [])
    filtered = []
    for point in points:
        twa = point.get("twa")
        stw = point.get("stw")
        tws = point.get("tws")
        if not (is_finite(twa) and is_finite(stw) and is_finite(tws)):
            continue
        filtered.append({"twa": float(twa), "stw": float(stw), "tws": float(tws)})
    return filtered


def group_points(points: Iterable[Dict[str, float]]) -> Dict[float, List[Tuple[float, float]]]:
    grouped: Dict[float, List[Tuple[float, float]]] = defaultdict(list)
    for point in points:
        angle_rad = math.radians(point["twa"])
        grouped[point["tws"]].append((angle_rad, point["stw"]))
    return grouped


def percentile(values: List[float], pct: float) -> float:
    if not values:
        raise ValueError("Cannot compute percentile of empty data")
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    pct_clamped = max(0.0, min(100.0, pct))
    rank = (len(ordered) - 1) * (pct_clamped / 100.0)
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return ordered[lower]
    fraction = rank - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction


def percentile_curve(samples: Iterable[Tuple[float, float]], *, bin_size: int = 5, pct: float = 75, min_samples: int = 3) -> List[Tuple[float, float]]:
    bins: Dict[int, List[float]] = defaultdict(list)
    for angle_rad, stw in samples:
        angle_deg = math.degrees(angle_rad)
        if angle_deg < 0:
            angle_deg += 360
        bucket_center = int(math.floor((angle_deg + bin_size / 2) / bin_size) * bin_size) % 360
        bins[bucket_center].append(stw)

    curve: List[Tuple[float, float]] = []
    for bucket in sorted(bins.keys()):
        values = bins[bucket]
        if len(values) < min_samples:
            continue
        try:
            p_val = percentile(values, pct)
        except ValueError:
            continue
        bucket_adj = bucket
        if bucket_adj > 180:
            bucket_adj = 360 - bucket_adj
        curve.append((bucket_adj, p_val))
    return curve


def make_open_uniform_knots(n_control: int, degree: int) -> np.ndarray:
    knots = np.zeros(n_control + degree + 1, dtype=float)
    knots[degree:n_control + 1] = np.linspace(0.0, 1.0, n_control - degree + 1)
    knots[n_control + 1:] = 1.0
    return knots


def bspline_basis(i: int, degree: int, t: float, knots: np.ndarray) -> float:
    if degree == 0:
        left = knots[i]
        right = knots[i + 1]
        if left <= t < right or (t == knots[-1] and left <= t <= right):
            return 1.0
        return 0.0
    denom_left = knots[i + degree] - knots[i]
    denom_right = knots[i + degree + 1] - knots[i + 1]
    term_left = 0.0
    term_right = 0.0
    if denom_left > 0:
        term_left = (t - knots[i]) / denom_left * bspline_basis(i, degree - 1, t, knots)
    if denom_right > 0:
        term_right = (knots[i + degree + 1] - t) / denom_right * bspline_basis(i + 1, degree - 1, t, knots)
    return term_left + term_right


def fit_bspline_curve(curve: List[Tuple[float, float]], control_count: int = 5, degree: int = 3) -> List[Tuple[float, float]]:
    if len(curve) < control_count:
        return []

    angles_deg = np.array([point[0] for point in curve], dtype=float)
    radii = np.array([point[1] for point in curve], dtype=float)

    valid = np.isfinite(angles_deg) & np.isfinite(radii)
    if valid.sum() < control_count:
        return []
    angles_deg = angles_deg[valid]
    radii = radii[valid]

    order = np.argsort(angles_deg)
    angles_deg = angles_deg[order]
    radii = radii[order]

    unique_angles, inverse = np.unique(angles_deg, return_inverse=True)
    if unique_angles.size < control_count:
        return []
    aggregated_radii = np.zeros_like(unique_angles, dtype=float)
    counts = np.zeros_like(unique_angles, dtype=int)
    for idx, group in enumerate(inverse):
        aggregated_radii[group] += radii[idx]
        counts[group] += 1
    radii = aggregated_radii / np.maximum(counts, 1)
    angles_deg = unique_angles

    min_angle = angles_deg[0]
    max_angle = angles_deg[-1]
    if max_angle - min_angle < 1e-6:
        return []

    t_values = (angles_deg - min_angle) / (max_angle - min_angle)
    t_values = np.clip(t_values, 0.0, 1.0)

    degree = min(degree, control_count - 1)
    knots = make_open_uniform_knots(control_count, degree)

    basis_matrix = np.array([
        [bspline_basis(j, degree, t, knots) for j in range(control_count)]
        for t in t_values
    ], dtype=float)

    try:
        control_radii, *_ = np.linalg.lstsq(basis_matrix, radii, rcond=None)
    except np.linalg.LinAlgError:
        return []

    ts = np.linspace(0.0, 1.0, 200)
    spline_angles_deg = min_angle + ts * (max_angle - min_angle)
    spline_radii = np.array([
        sum(control_radii[j] * bspline_basis(j, degree, t, knots) for j in range(control_count))
        for t in ts
    ])
    spline_radii = np.clip(spline_radii, 0.0, None)
    spline_angles_rad = np.radians(spline_angles_deg)
    return list(zip(spline_angles_rad, spline_radii))


def plot_polar(grouped: Dict[float, List[Tuple[float, float]]], output: Optional[Path]) -> None:
    if not grouped:
        raise SystemExit("No valid polar points to plot.")

    tws_values = sorted(grouped.keys())
    cmap = plt.get_cmap("viridis", max(len(tws_values), 3))

    fig, ax = plt.subplots(figsize=(8, 8), subplot_kw={"projection": "polar"})

    for idx, tws in enumerate(tws_values):
        samples = grouped[tws]
        if not samples:
            continue
        angles, radii = zip(*samples)
        color = cmap(idx)
        ax.scatter(angles, radii, s=18, color=color, alpha=0.35, edgecolors="none")

        curve_points = percentile_curve(samples, bin_size=5, pct=75, min_samples=3)
        if curve_points:
            smooth_curve = fit_bspline_curve(curve_points, control_count=5, degree=3)
            if smooth_curve:
                curve_angles, curve_radii = zip(*smooth_curve)
                ax.plot(curve_angles, curve_radii, color=color, linewidth=2.2, label=f"{tws:g} kn (75th pct spline)")
            else:
                # fallback: plot unsmoothed percentile markers
                curve_angles = [math.radians(pt[0]) for pt in curve_points]
                curve_radii = [pt[1] for pt in curve_points]
                ax.plot(curve_angles, curve_radii, color=color, linewidth=1.5, linestyle='--', label=f"{tws:g} kn (75th pct)")

    ax.set_theta_zero_location("N")
    ax.set_theta_direction(-1)
    ax.set_title("Polar Diagram (STW vs TWA)", pad=20)
    ax.set_rlabel_position(225)
    ax.grid(True, linestyle="--", alpha=0.4)
    ax.legend(title="True Wind Speed", loc="upper right", bbox_to_anchor=(1.2, 1.1))

    fig.tight_layout()

    if output:
        fig.savefig(output, dpi=150, bbox_inches="tight")
    else:
        plt.show()


def main() -> None:
    args = parse_args()
    points = load_points(args.polar_file)
    grouped = group_points(points)
    plot_polar(grouped, args.output)


if __name__ == "__main__":
    main()
