from __future__ import annotations

import csv
import math
import re
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
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


TEST_ROOT = Path(__file__).resolve().parent
SYNTHETIC_DIR = TEST_ROOT / "Sintéticas"
SCANNER_DIR = TEST_ROOT / "Medidas de Scanner"
JEAN_DIR = SCANNER_DIR / "Imagens Jean"
TERUO_DIR = SCANNER_DIR / "Imagens Teruo"
OUTPUT_DIR = TEST_ROOT / "Resultados Artigo Final"
FIGURE_DIR = OUTPUT_DIR / "figuras_processamento"
RESULTS_CSV = OUTPUT_DIR / "resultados_final.csv"
STATS_CSV = OUTPUT_DIR / "estatisticas_final.csv"
SUMMARY_MD = OUTPUT_DIR / "resumo_resultados_final.md"
DEFAULT_DPI = 300.0


@dataclass(frozen=True)
class ReferenceImage:
    path: Path
    group: str
    subgroup: str
    expected_length_mm: float
    dpi: float
    reference_source: str


def parse_expected_from_filename(path: Path, base_dir: Path) -> ReferenceImage | None:
    relative = path.relative_to(base_dir)
    stem = path.stem

    if base_dir == SYNTHETIC_DIR:
        match = re.search(r"_(\d+(?:[,.]\d+)?)mm$", stem, flags=re.IGNORECASE)
        if not match:
            return None
        return ReferenceImage(
            path=path,
            group="Sintéticas",
            subgroup="Sintéticas",
            expected_length_mm=float(match.group(1).replace(",", ".")),
            dpi=DEFAULT_DPI,
            reference_source="nome do arquivo em mm",
        )

    if base_dir == JEAN_DIR:
        match = re.search(r"(\d+(?:[,.]\d+)?)\s*Metro$", stem, flags=re.IGNORECASE)
        if not match:
            return None
        subgroup = "Jean continuo" if any("Continuo" in part for part in relative.parts) else "Jean picotado"
        return ReferenceImage(
            path=path,
            group="Imagens Jean",
            subgroup=subgroup,
            expected_length_mm=float(match.group(1).replace(",", ".")) * 1000.0,
            dpi=DEFAULT_DPI,
            reference_source="nome do arquivo em metros",
        )

    if base_dir == TERUO_DIR:
        if "-" in stem:
            match = re.search(r"-\s*(\d+(?:[,.]\d+)?)$", stem)
        else:
            match = re.search(r"(\d+(?:[,.]\d+)?)", stem)
        if not match:
            return None
        return ReferenceImage(
            path=path,
            group="Imagens Teruo",
            subgroup="Imagens Teruo",
            expected_length_mm=float(match.group(1).replace(",", ".")),
            dpi=DEFAULT_DPI,
            reference_source="nome do arquivo em mm",
        )

    return None


def iter_images(directory: Path) -> Iterable[Path]:
    image_extensions = {".bmp", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}
    for path in sorted(directory.rglob("*")):
        if path.suffix.lower() in image_extensions:
            yield path


def load_references() -> list[ReferenceImage]:
    references: list[ReferenceImage] = []
    for directory in (SYNTHETIC_DIR, JEAN_DIR, TERUO_DIR):
        for image_path in iter_images(directory):
            reference = parse_expected_from_filename(image_path, directory)
            if reference is not None:
                references.append(reference)
    return references


def analyze_file(path: Path, dpi: float) -> tuple[dict[str, object], dict[str, np.ndarray]]:
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
        skeleton = prune_skeleton(skeleton, pixel_size_mm, min_spur_length_mm=0.25, max_iterations=6)

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

    metrics = {
        "threshold": threshold,
        "preprocessing_mode": preprocessing_mode or "",
        "correction_mode": correction_mode or "",
        "raw_length_mm": raw_length,
        "measured_length_mm": measured_length,
        "branch_points": branch_points,
        "foreground_percent": float(np.mean(filtered) * 100.0),
        "average_diameter_mm": compute_diameter(filtered, skeleton, branch_mask, pixel_size_mm),
        "area_mm2": float(np.sum(filtered) * pixel_size_mm * pixel_size_mm),
        "pixel_size_mm": pixel_size_mm,
    }
    arrays = {
        "cinza": gray,
        "segmentada": filtered * 255,
        "esqueleto": skeleton * 255,
    }
    return metrics, arrays


def percentile(sorted_values: list[float], p: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    pos = (len(sorted_values) - 1) * p
    lower = math.floor(pos)
    upper = math.ceil(pos)
    if lower == upper:
        return sorted_values[lower]
    weight = pos - lower
    return sorted_values[lower] * (1.0 - weight) + sorted_values[upper] * weight


def summarize(rows: Iterable[dict[str, object]]) -> dict[str, object]:
    items = list(rows)
    errors = [float(row["error_percent"]) for row in items]
    abs_errors = [abs(error) for error in errors]
    measured = [float(row["measured_length_mm"]) for row in items]
    expected = [float(row["expected_length_mm"]) for row in items]
    sorted_abs = sorted(abs_errors)

    return {
        "n": len(items),
        "expected_total_mm": sum(expected),
        "measured_total_mm": sum(measured),
        "mean_error_percent": statistics.fmean(errors) if errors else 0.0,
        "mean_abs_error_percent": statistics.fmean(abs_errors) if abs_errors else 0.0,
        "median_abs_error_percent": statistics.median(abs_errors) if abs_errors else 0.0,
        "sd_abs_error_percent": statistics.stdev(abs_errors) if len(abs_errors) > 1 else 0.0,
        "rmse_percent": math.sqrt(statistics.fmean([error * error for error in errors])) if errors else 0.0,
        "min_error_percent": min(errors) if errors else 0.0,
        "max_error_percent": max(errors) if errors else 0.0,
        "p95_abs_error_percent": percentile(sorted_abs, 0.95),
        "within_3_percent": sum(1 for error in abs_errors if error <= 3.0),
        "within_5_percent": sum(1 for error in abs_errors if error <= 5.0),
        "within_10_percent": sum(1 for error in abs_errors if error <= 10.0),
    }


def save_processing_figures(rows: list[dict[str, object]], arrays_by_file: dict[str, dict[str, np.ndarray]]) -> None:
    FIGURE_DIR.mkdir(parents=True, exist_ok=True)
    preferred = [
        ("Sintéticas", "sintetica_020_clara_parecida_scanner_1063mm.png", "sintetica_020"),
        ("Imagens Jean", "1Metro.bmp", "jean_1metro"),
        ("Imagens Teruo", "7487.bmp", "teruo_7487"),
    ]
    used_keys: set[str] = set()
    for group, filename, prefix in preferred:
        candidates = [row for row in rows if row["group"] == group and row["filename"] == filename]
        if not candidates:
            candidates = [row for row in rows if row["group"] == group]
        if not candidates:
            continue
        row = candidates[0]
        key = str(row["relative_path"])
        used_keys.add(key)
        for kind, array in arrays_by_file[key].items():
            Image.fromarray(array.astype(np.uint8)).save(FIGURE_DIR / f"{prefix}_{kind}.png")


def format_number(value: object, decimals: int = 2) -> str:
    return f"{float(value):.{decimals}f}".replace(".", ",")


def write_summary(stats_rows: list[dict[str, object]], rows: list[dict[str, object]]) -> None:
    ordered_groups = ["Sintéticas", "Imagens Jean", "Imagens Teruo", "Total"]
    stats_by_group = {str(row["group"]): row for row in stats_rows}
    worst = sorted(rows, key=lambda row: abs(float(row["error_percent"])), reverse=True)[:5]

    lines = [
        "# Resumo dos resultados finais",
        "",
        "Referências extraídas exclusivamente dos nomes dos arquivos.",
        "Todos os testes foram executados com DPI manual de 300 e limiar automático do software.",
        "",
        "## Estatísticas por grupo",
        "",
        "| Grupo | n | MAE (%) | RMSE (%) | Mediana abs. (%) | P95 abs. (%) | Dentro de 5% | Dentro de 10% |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for group in ordered_groups:
        stats = stats_by_group[group]
        lines.append(
            f"| {group} | {stats['n']} | {format_number(stats['mean_abs_error_percent'])} | "
            f"{format_number(stats['rmse_percent'])} | {format_number(stats['median_abs_error_percent'])} | "
            f"{format_number(stats['p95_abs_error_percent'])} | {stats['within_5_percent']}/{stats['n']} | "
            f"{stats['within_10_percent']}/{stats['n']} |"
        )

    lines.extend([
        "",
        "## Maiores desvios absolutos",
        "",
        "| Grupo | Arquivo | Esperado (mm) | Medido (mm) | Erro (%) | Limiar | Correção |",
        "|---|---|---:|---:|---:|---:|---|",
    ])
    for row in worst:
        lines.append(
            f"| {row['group']} | {row['filename']} | {format_number(row['expected_length_mm'])} | "
            f"{format_number(row['measured_length_mm'])} | {format_number(row['error_percent'])} | "
            f"{format_number(row['threshold'])} | {row['correction_mode'] or '-'} |"
        )
    SUMMARY_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    references = load_references()
    if not references:
        raise SystemExit("Nenhuma imagem de teste encontrada.")

    rows: list[dict[str, object]] = []
    arrays_by_file: dict[str, dict[str, np.ndarray]] = {}
    for ref in references:
        metrics, arrays = analyze_file(ref.path, ref.dpi)
        measured = float(metrics["measured_length_mm"])
        error_mm = measured - ref.expected_length_mm
        error_percent = (error_mm / ref.expected_length_mm) * 100.0 if ref.expected_length_mm else 0.0
        relative_path = str(ref.path.relative_to(TEST_ROOT))
        rows.append({
            "group": ref.group,
            "subgroup": ref.subgroup,
            "relative_path": relative_path,
            "filename": ref.path.name,
            "expected_length_mm": f"{ref.expected_length_mm:.6f}",
            "measured_length_mm": f"{measured:.6f}",
            "error_mm": f"{error_mm:.6f}",
            "error_percent": f"{error_percent:.3f}",
            "abs_error_percent": f"{abs(error_percent):.3f}",
            "dpi": f"{ref.dpi:.3f}",
            "pixel_size_mm": f"{float(metrics['pixel_size_mm']):.9f}",
            "reference_source": ref.reference_source,
            "raw_length_mm": f"{float(metrics['raw_length_mm']):.6f}",
            "threshold": f"{float(metrics['threshold']):.3f}",
            "foreground_percent": f"{float(metrics['foreground_percent']):.3f}",
            "average_diameter_mm": f"{float(metrics['average_diameter_mm']):.6f}",
            "area_mm2": f"{float(metrics['area_mm2']):.6f}",
            "branch_points": str(metrics["branch_points"]),
            "preprocessing_mode": str(metrics["preprocessing_mode"]),
            "correction_mode": str(metrics["correction_mode"]),
        })
        arrays_by_file[relative_path] = arrays

    with RESULTS_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    stats_rows: list[dict[str, object]] = []
    for group_name in ["Sintéticas", "Imagens Jean", "Imagens Teruo", "Total"]:
        group_rows = rows if group_name == "Total" else [row for row in rows if row["group"] == group_name]
        stats = summarize(group_rows)
        stats_rows.append({
            "group": group_name,
            **{key: f"{value:.6f}" if isinstance(value, float) else value for key, value in stats.items()},
        })

    with STATS_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(stats_rows[0].keys()))
        writer.writeheader()
        writer.writerows(stats_rows)

    save_processing_figures(rows, arrays_by_file)
    write_summary(stats_rows, rows)

    print(f"Resultados gravados em {RESULTS_CSV}")
    print(f"Estatisticas gravadas em {STATS_CSV}")
    print(f"Resumo gravado em {SUMMARY_MD}")
    for stats in stats_rows:
        print(
            f"{stats['group']}: n={stats['n']}, "
            f"MAE={float(stats['mean_abs_error_percent']):.2f}%, "
            f"RMSE={float(stats['rmse_percent']):.2f}%, "
            f"dentro5={stats['within_5_percent']}/{stats['n']}"
        )


if __name__ == "__main__":
    main()
