#!/usr/bin/env python3
"""Batch-run course change merging over YAML files in a directory.

Usage:
  python merge_course_changes_dir.py <directory> [--inplace] [--out-dir DIR] [--fix-maxima-pos]

Behavior:
- Without --inplace, writes results to <directory>/merged/<filename> (or --out-dir).
- With --inplace, overwrites each source file atomically.
- Processes non-recursively only files matching *.yml in the specified directory.
"""
from __future__ import annotations

import argparse
import os
import sys
import glob
import tempfile
import shutil
from typing import List

import yaml

try:
    # Reuse the core merging logic from the existing script
    from merge_course_changes import merge_entries, fix_maxima_positions
except Exception as e:  # pragma: no cover - helpful error for CLI usage
    print(f"Error importing merge_course_changes: {e}", file=sys.stderr)
    sys.exit(1)


def process_file(src_path: str, dst_path: str, fix_maxima_pos: bool = False) -> None:
    with open(src_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, list):
        raise ValueError(f"{src_path}: YAML root must be a list of entries")
    if fix_maxima_pos:
        data = fix_maxima_positions(data)
    result = merge_entries(data)
    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
    with open(dst_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(result, f, sort_keys=False)


def process_inplace(src_path: str, fix_maxima_pos: bool = False) -> None:
    dir_name = os.path.dirname(src_path) or "."
    with tempfile.NamedTemporaryFile("w", delete=False, dir=dir_name, encoding="utf-8", suffix=".tmp") as tmp:
        tmp_path = tmp.name
        with open(src_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if not isinstance(data, list):
            raise ValueError(f"{src_path}: YAML root must be a list of entries")
        if fix_maxima_pos:
            data = fix_maxima_positions(data)
        result = merge_entries(data)
        yaml.safe_dump(result, tmp, sort_keys=False)
    # Atomic replace
    os.replace(tmp_path, src_path)


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Merge course changes in all .yml files in a directory")
    parser.add_argument("directory", help="Directory containing .yml files (non-recursive)")
    parser.add_argument("--inplace", action="store_true", help="Overwrite source files atomically")
    parser.add_argument("--out-dir", default=None, help="Output directory (default: <directory>/merged when not --inplace)")
    parser.add_argument(
        "--fix-maxima-pos",
        action="store_true",
        help="Backfill position for max wind/heel/speed entries using last good position",
    )
    args = parser.parse_args(argv)

    base_dir = os.path.abspath(args.directory)
    if not os.path.isdir(base_dir):
        print(f"Not a directory: {base_dir}", file=sys.stderr)
        return 1

    pattern = os.path.join(base_dir, "*.yml")
    files = sorted(glob.glob(pattern))
    if not files:
        print(f"No .yml files found in {base_dir}")
        return 0

    out_dir = None
    if not args.inplace:
        out_dir = os.path.abspath(args.out_dir or os.path.join(base_dir, "merged"))
        os.makedirs(out_dir, exist_ok=True)

    processed = 0
    failed = 0
    for src in files:
        try:
            if args.inplace:
                process_inplace(src, fix_maxima_pos=args.fix_maxima_pos)
            else:
                dst = os.path.join(out_dir, os.path.basename(src))  # type: ignore[arg-type]
                process_file(src, dst, fix_maxima_pos=args.fix_maxima_pos)
            processed += 1
        except Exception as e:
            failed += 1
            print(f"Failed: {src}: {e}", file=sys.stderr)

    print(f"Processed: {processed}; Failed: {failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
