from __future__ import annotations

import csv
import sys
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "Backend"))

from app.main import (  # noqa: E402
    FRAGMENTED_COMPONENT_MAX_FOREGROUND_RATIO,
    FRAGMENTED_COMPONENT_MIN_AREA,
    compute_branch_data,
    compute_diameter,
    compute_length,
    correct_dense_graph_length,
    correct_fragmented_component_length,
    decode_gray_image,
    filter_roots,
    load_image,
    prune_skeleton,
    segment_image,
    skeletonize_image,
)


DATA_DIR = Path(__file__).resolve().parent
EXPECTED_CSV = DATA_DIR / "comprimentos_esperados.csv"
RESULTS_CSV = DATA_DIR / "resultados_sinteticas.csv"


def analyze_file(path: Path, dpi: float) -> dict[str, object]:
    file_bytes = path.read_bytes()
    image = load_image(file_bytes)
    gray = decode_gray_image(file_bytes, image)
    binary, threshold, preprocessing_mode = segment_image(gray, None, "auto", True)
    pixel_size_mm = 25.4 / dpi

    foreground_ratio = float(np.mean(binary))
    fragmented_filter_area = (
        FRAGMENTED_COMPONENT_MIN_AREA
        if (
            preprocessing_mode == "dark-background-enhanced"
            and foreground_ratio <= FRAGMENTED_COMPONENT_MAX_FOREGROUND_RATIO
        )
        else None
    )
    filtered = filter_roots(binary, fragmented_filter_area)
    skeleton = skeletonize_image(filtered)
    if int(np.count_nonzero(skeleton)) > 500:
        min_spur_length_mm = 0.25
        skeleton = prune_skeleton(skeleton, pixel_size_mm, min_spur_length_mm=min_spur_length_mm, max_iterations=6)

    raw_length = compute_length(skeleton, pixel_size_mm)
    branch_points, branch_mask = compute_branch_data(skeleton)
    measured_length, correction_mode = correct_dense_graph_length(raw_length, branch_points)
    if correction_mode is None:
        measured_length, correction_mode = correct_fragmented_component_length(
            binary,
            filtered,
            measured_length,
            branch_points,
            pixel_size_mm,
            preprocessing_mode,
            True,
        )

    return {
        "threshold": threshold,
        "preprocessing_mode": preprocessing_mode or "",
        "correction_mode": correction_mode or "",
        "raw_length_mm": raw_length,
        "measured_length_mm": measured_length,
        "branch_points": branch_points,
        "foreground_percent": float(np.mean(filtered) * 100.0),
        "average_diameter_mm": compute_diameter(filtered, skeleton, branch_mask, pixel_size_mm),
    }


def main() -> None:
    rows: list[dict[str, object]] = []
    with EXPECTED_CSV.open(newline="", encoding="utf-8") as f:
        for expected in csv.DictReader(f):
            filename = expected["filename"]
            expected_length = float(expected["expected_length_mm"])
            dpi = float(expected["dpi"])
            metrics = analyze_file(DATA_DIR / filename, dpi)
            measured = float(metrics["measured_length_mm"])
            error_mm = measured - expected_length
            error_percent = (error_mm / expected_length) * 100.0 if expected_length else 0.0
            rows.append({
                "filename": filename,
                "group": expected.get("group", "synthetic"),
                "expected_length_mm": f"{expected_length:.6f}",
                "measured_length_mm": f"{measured:.6f}",
                "error_mm": f"{error_mm:.6f}",
                "error_percent": f"{error_percent:.3f}",
                "raw_length_mm": f"{float(metrics['raw_length_mm']):.6f}",
                "threshold": f"{float(metrics['threshold']):.3f}",
                "foreground_percent": f"{float(metrics['foreground_percent']):.3f}",
                "average_diameter_mm": f"{float(metrics['average_diameter_mm']):.6f}",
                "branch_points": str(metrics["branch_points"]),
                "preprocessing_mode": str(metrics["preprocessing_mode"]),
                "correction_mode": str(metrics["correction_mode"]),
            })

    with RESULTS_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    print(f"Resultados gravados em {RESULTS_CSV}")
    for row in rows:
        print(
            f"{row['filename']}: esperado={row['expected_length_mm']} mm, "
            f"medido={row['measured_length_mm']} mm, erro={row['error_percent']}%"
        )


if __name__ == "__main__":
    main()
