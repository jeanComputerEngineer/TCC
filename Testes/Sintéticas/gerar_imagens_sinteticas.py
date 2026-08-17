from __future__ import annotations

import csv
import math
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFilter


DPI = 300
PX_PER_MM = DPI / 25.4
OUT_DIR = Path(__file__).resolve().parent
SEED = 20260509


Point = tuple[float, float]


@dataclass(frozen=True)
class SyntheticCase:
    filename: str
    expected_length_mm: float
    dpi: int
    width_px: int
    height_px: int
    background: str
    root_width_px: int
    group: str
    notes: str


def path_length(points: Iterable[Point]) -> float:
    pts = list(points)
    return sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))


def mm_to_px(mm: float) -> float:
    return mm * PX_PER_MM


def px_to_mm(px: float) -> float:
    return px / PX_PER_MM


def draw_polyline(draw: ImageDraw.ImageDraw, points: list[Point], fill: int, width: int) -> None:
    rounded = [(int(round(x)), int(round(y))) for x, y in points]
    draw.line(rounded, fill=fill, width=width, joint="curve")


def sine_curve(
    start: Point,
    length_px: float,
    angle_rad: float,
    amplitude_px: float,
    cycles: float,
    samples: int = 60,
) -> list[Point]:
    ux = math.cos(angle_rad)
    uy = math.sin(angle_rad)
    vx = -uy
    vy = ux
    pts: list[Point] = []
    for i in range(samples):
        t = i / (samples - 1)
        longitudinal = length_px * t
        lateral = amplitude_px * math.sin(2.0 * math.pi * cycles * t)
        pts.append((
            start[0] + ux * longitudinal + vx * lateral,
            start[1] + uy * longitudinal + vy * lateral,
        ))
    return pts


def arc_curve(
    center: Point,
    radius_px: float,
    start_rad: float,
    sweep_rad: float,
    samples: int = 120,
) -> list[Point]:
    pts: list[Point] = []
    for i in range(samples):
        t = i / (samples - 1)
        angle = start_rad + sweep_rad * t
        pts.append((center[0] + math.cos(angle) * radius_px, center[1] + math.sin(angle) * radius_px))
    return pts


def spiral_curve(
    center: Point,
    start_radius_px: float,
    end_radius_px: float,
    turns: float,
    start_rad: float = 0.0,
    samples: int = 220,
) -> list[Point]:
    pts: list[Point] = []
    for i in range(samples):
        t = i / (samples - 1)
        angle = start_rad + 2.0 * math.pi * turns * t
        radius = start_radius_px + (end_radius_px - start_radius_px) * t
        pts.append((center[0] + math.cos(angle) * radius, center[1] + math.sin(angle) * radius))
    return pts


def scale_path_to_length(points: list[Point], target_length_px: float) -> list[Point]:
    current = path_length(points)
    if current <= 0:
        return points
    scale = target_length_px / current
    x0, y0 = points[0]
    return [(x0 + (x - x0) * scale, y0 + (y - y0) * scale) for x, y in points]


def make_canvas(width: int, height: int, background: str) -> tuple[Image.Image, ImageDraw.ImageDraw, int]:
    bg = 255 if background == "light" else 12
    fg = 18 if background == "light" else 238
    image = Image.new("L", (width, height), bg)
    return image, ImageDraw.Draw(image), fg


def save_image(image: Image.Image, filename: str) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    image.save(OUT_DIR / filename, dpi=(DPI, DPI))


def horizontal_ladder_case() -> SyntheticCase:
    width, height = 1800, 1300
    image, draw, fg = make_canvas(width, height, "light")
    total_px = mm_to_px(1000.0)
    segment_count = 10
    segment_px = total_px / segment_count
    paths: list[list[Point]] = []
    for row in range(segment_count):
        y = 110 + row * 115
        x0 = 130
        pts = [(x0, y), (x0 + segment_px, y)]
        draw_polyline(draw, pts, fg, 7)
        paths.append(pts)
    save_image(image, "sintetica_001_clara_reta_1000mm.png")
    expected = px_to_mm(sum(path_length(p) for p in paths))
    return SyntheticCase(
        "sintetica_001_clara_reta_1000mm.png",
        expected,
        DPI,
        width,
        height,
        "light",
        7,
        "sintetica_reta",
        "10 raizes retas; comprimento conhecido pela centrolinha.",
    )


def continuous_curve_case() -> SyntheticCase:
    width, height = 1900, 1900
    image, draw, fg = make_canvas(width, height, "light")
    target_px = mm_to_px(1500.0)
    pts: list[Point] = []
    x_left = 160.0
    x_right = 1740.0
    y = 170.0
    row_gap = 135.0
    direction = 1.0
    total = 0.0
    current: Point = (x_left, y)
    pts.append(current)
    while total < target_px:
        target_x = x_right if direction > 0 else x_left
        horizontal = abs(target_x - current[0])
        if total + horizontal >= target_px:
            remaining = target_px - total
            pts.append((current[0] + direction * remaining, current[1]))
            break
        pts.append((target_x, current[1]))
        total += horizontal

        next_y = current[1] + row_gap
        vertical = row_gap
        if total + vertical >= target_px:
            remaining = target_px - total
            pts.append((target_x, current[1] + remaining))
            break
        pts.append((target_x, next_y))
        total += vertical
        current = (target_x, next_y)
        direction *= -1.0

    draw_polyline(draw, pts, fg, 9)
    save_image(image, "sintetica_002_clara_curva_continua_1500mm.png")
    return SyntheticCase(
        "sintetica_002_clara_curva_continua_1500mm.png",
        px_to_mm(path_length(pts)),
        DPI,
        width,
        height,
        "light",
        9,
        "sintetica_continua",
        "Raiz unica continua e curva.",
    )


def fragmented_dark_case() -> SyntheticCase:
    rng = random.Random(SEED + 3)
    width, height = 2550, 3509
    image, draw, fg = make_canvas(width, height, "dark")
    target_px = mm_to_px(7000.0)
    paths: list[list[Point]] = []
    total = 0.0
    margin = 180
    attempts = 0
    while total < target_px and attempts < 3000:
        attempts += 1
        remaining = target_px - total
        piece_target = min(remaining, rng.uniform(mm_to_px(35), mm_to_px(95)))
        angle = rng.uniform(-math.pi * 0.95, math.pi * 0.95)
        amplitude = rng.uniform(4, 18)
        cycles = rng.uniform(0.25, 0.85)
        x = rng.uniform(margin, width - margin)
        y = rng.uniform(margin, height - margin)
        base = sine_curve((x, y), piece_target * 0.94, angle, amplitude, cycles, 36)
        pts = scale_path_to_length(base, piece_target)
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        if min(xs) < 60 or max(xs) > width - 60 or min(ys) < 60 or max(ys) > height - 60:
            continue
        draw_polyline(draw, pts, fg, 5)
        paths.append(pts)
        total += path_length(pts)

    save_image(image, "sintetica_003_escura_fragmentada_7000mm.png")
    return SyntheticCase(
        "sintetica_003_escura_fragmentada_7000mm.png",
        px_to_mm(sum(path_length(p) for p in paths)),
        DPI,
        width,
        height,
        "dark",
        5,
        "sintetica_fragmentada",
        "Muitas raizes curtas separadas; testa filtragem de componentes.",
    )


def fragmented_dark_noisy_case() -> SyntheticCase:
    rng = random.Random(SEED + 4)
    width, height = 2550, 3509
    image, draw, fg = make_canvas(width, height, "dark")
    target_px = mm_to_px(3000.0)
    paths: list[list[Point]] = []
    total = 0.0
    while total < target_px:
        piece_target = min(target_px - total, rng.uniform(mm_to_px(25), mm_to_px(75)))
        angle = rng.uniform(-math.pi, math.pi)
        base = sine_curve(
            (rng.uniform(180, width - 180), rng.uniform(180, height - 180)),
            piece_target * 0.95,
            angle,
            rng.uniform(3, 12),
            rng.uniform(0.2, 0.7),
            28,
        )
        pts = scale_path_to_length(base, piece_target)
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        if min(xs) < 60 or max(xs) > width - 60 or min(ys) < 60 or max(ys) > height - 60:
            continue
        draw_polyline(draw, pts, fg, 5)
        paths.append(pts)
        total += path_length(pts)

    for _ in range(1200):
        x = rng.randrange(0, width)
        y = rng.randrange(0, height)
        value = rng.randrange(55, 110)
        image.putpixel((x, y), value)

    image = image.filter(ImageFilter.GaussianBlur(radius=0.35))
    save_image(image, "sintetica_004_escura_fragmentada_ruido_3000mm.png")
    return SyntheticCase(
        "sintetica_004_escura_fragmentada_ruido_3000mm.png",
        px_to_mm(sum(path_length(p) for p in paths)),
        DPI,
        width,
        height,
        "dark",
        5,
        "sintetica_fragmentada_ruido",
        "Raizes separadas com pontos isolados de ruido.",
    )


def dense_network_case() -> SyntheticCase:
    rng = random.Random(SEED + 5)
    width, height = 2100, 2600
    image, draw, fg = make_canvas(width, height, "dark")
    target_px = mm_to_px(6600.0)
    paths: list[list[Point]] = []
    total = 0.0
    centers = [(760, 900), (1320, 960), (960, 1580), (1450, 1750)]
    while total < target_px:
        cx, cy = rng.choice(centers)
        piece_target = min(target_px - total, rng.uniform(mm_to_px(28), mm_to_px(110)))
        angle = rng.uniform(-math.pi, math.pi)
        start = (rng.gauss(cx, 185), rng.gauss(cy, 185))
        base = sine_curve(start, piece_target * 0.92, angle, rng.uniform(8, 28), rng.uniform(0.4, 1.1), 45)
        pts = scale_path_to_length(base, piece_target)
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        if min(xs) < 80 or max(xs) > width - 80 or min(ys) < 80 or max(ys) > height - 80:
            continue
        draw_polyline(draw, pts, fg, rng.choice([4, 5, 6]))
        paths.append(pts)
        total += path_length(pts)

    save_image(image, "sintetica_005_escura_rede_densa_6600mm.png")
    return SyntheticCase(
        "sintetica_005_escura_rede_densa_6600mm.png",
        px_to_mm(sum(path_length(p) for p in paths)),
        DPI,
        width,
        height,
        "dark",
        5,
        "sintetica_densa",
        "Rede densa de raizes visualmente sobrepostas.",
    )


def thick_roots_case() -> SyntheticCase:
    rng = random.Random(SEED + 6)
    width, height = 1900, 2400
    image, draw, fg = make_canvas(width, height, "dark")
    target_px = mm_to_px(2500.0)
    paths: list[list[Point]] = []
    total = 0.0
    while total < target_px:
        piece_target = min(target_px - total, rng.uniform(mm_to_px(80), mm_to_px(180)))
        pts = scale_path_to_length(
            sine_curve(
                (rng.uniform(220, width - 500), rng.uniform(220, height - 220)),
                piece_target * 0.9,
                rng.uniform(-0.9, 0.9),
                rng.uniform(12, 35),
                rng.uniform(0.3, 0.8),
                60,
            ),
            piece_target,
        )
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        if min(xs) < 80 or max(xs) > width - 80 or min(ys) < 80 or max(ys) > height - 80:
            continue
        draw_polyline(draw, pts, fg, 13)
        paths.append(pts)
        total += path_length(pts)

    save_image(image, "sintetica_006_escura_raizes_espessas_2500mm.png")
    return SyntheticCase(
        "sintetica_006_escura_raizes_espessas_2500mm.png",
        px_to_mm(sum(path_length(p) for p in paths)),
        DPI,
        width,
        height,
        "dark",
        13,
        "sintetica_espessa",
        "Raizes espessas; testa se a esqueletizacao segue a centrolinha.",
    )


def oriented_roots_case(
    *,
    filename: str,
    target_mm: float,
    width: int,
    height: int,
    background: str,
    root_width: int,
    piece_range_mm: tuple[float, float],
    angle_range: tuple[float, float],
    amplitude_range: tuple[float, float],
    cycles_range: tuple[float, float],
    seed_offset: int,
    notes: str,
    noise_points: int = 0,
    blur_radius: float = 0.0,
) -> SyntheticCase:
    rng = random.Random(SEED + seed_offset)
    image, draw, fg = make_canvas(width, height, background)
    target_px = mm_to_px(target_mm)
    paths: list[list[Point]] = []
    total = 0.0
    attempts = 0
    while total < target_px and attempts < 5000:
        attempts += 1
        piece_target = min(target_px - total, rng.uniform(mm_to_px(piece_range_mm[0]), mm_to_px(piece_range_mm[1])))
        base = sine_curve(
            (rng.uniform(180, width - 180), rng.uniform(180, height - 180)),
            piece_target * rng.uniform(0.88, 0.97),
            rng.uniform(angle_range[0], angle_range[1]),
            rng.uniform(amplitude_range[0], amplitude_range[1]),
            rng.uniform(cycles_range[0], cycles_range[1]),
            48,
        )
        pts = scale_path_to_length(base, piece_target)
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        if min(xs) < 60 or max(xs) > width - 60 or min(ys) < 60 or max(ys) > height - 60:
            continue
        draw_polyline(draw, pts, fg, root_width)
        paths.append(pts)
        total += path_length(pts)

    for _ in range(noise_points):
        x = rng.randrange(0, width)
        y = rng.randrange(0, height)
        if background == "light":
            value = rng.randrange(0, 90)
        else:
            value = rng.randrange(45, 130)
        image.putpixel((x, y), value)

    if blur_radius > 0:
        image = image.filter(ImageFilter.GaussianBlur(radius=blur_radius))

    save_image(image, filename)
    return SyntheticCase(
        filename,
        px_to_mm(sum(path_length(p) for p in paths)),
        DPI,
        width,
        height,
        background,
        root_width,
        "sintetica_orientada",
        notes,
    )


def vertical_roots_case() -> SyntheticCase:
    return oriented_roots_case(
        filename="sintetica_007_escura_vertical_2200mm.png",
        target_mm=2200.0,
        width=1700,
        height=2600,
        background="dark",
        root_width=5,
        piece_range_mm=(60, 150),
        angle_range=(math.pi * 0.42, math.pi * 0.58),
        amplitude_range=(4, 16),
        cycles_range=(0.15, 0.65),
        seed_offset=7,
        notes="Raizes separadas predominantemente verticais em fundo escuro.",
    )


def diagonal_roots_case() -> SyntheticCase:
    return oriented_roots_case(
        filename="sintetica_008_escura_diagonal_1800mm.png",
        target_mm=1800.0,
        width=1900,
        height=1900,
        background="dark",
        root_width=5,
        piece_range_mm=(55, 130),
        angle_range=(math.pi * 0.18, math.pi * 0.32),
        amplitude_range=(3, 14),
        cycles_range=(0.2, 0.7),
        seed_offset=8,
        notes="Raizes predominantemente diagonais.",
    )


def light_fragmented_case() -> SyntheticCase:
    return oriented_roots_case(
        filename="sintetica_009_clara_fragmentada_4200mm.png",
        target_mm=4200.0,
        width=2400,
        height=3000,
        background="light",
        root_width=6,
        piece_range_mm=(35, 110),
        angle_range=(-math.pi, math.pi),
        amplitude_range=(5, 20),
        cycles_range=(0.25, 0.9),
        seed_offset=9,
        notes="Muitas raizes escuras separadas em fundo claro.",
    )


def low_contrast_dark_case() -> SyntheticCase:
    rng = random.Random(SEED + 10)
    width, height = 2100, 2600
    image = Image.new("L", (width, height), 18)
    draw = ImageDraw.Draw(image)
    target_px = mm_to_px(2000.0)
    paths: list[list[Point]] = []
    total = 0.0
    while total < target_px:
        piece_target = min(target_px - total, rng.uniform(mm_to_px(50), mm_to_px(130)))
        pts = scale_path_to_length(
            sine_curve(
                (rng.uniform(180, width - 180), rng.uniform(180, height - 180)),
                piece_target * 0.94,
                rng.uniform(-math.pi, math.pi),
                rng.uniform(5, 18),
                rng.uniform(0.2, 0.8),
                45,
            ),
            piece_target,
        )
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        if min(xs) < 60 or max(xs) > width - 60 or min(ys) < 60 or max(ys) > height - 60:
            continue
        draw_polyline(draw, pts, 72, 5)
        paths.append(pts)
        total += path_length(pts)

    for _ in range(900):
        x = rng.randrange(0, width)
        y = rng.randrange(0, height)
        image.putpixel((x, y), rng.randrange(20, 38))

    image = image.filter(ImageFilter.GaussianBlur(radius=0.25))
    save_image(image, "sintetica_010_escura_baixo_contraste_2000mm.png")
    return SyntheticCase(
        "sintetica_010_escura_baixo_contraste_2000mm.png",
        px_to_mm(sum(path_length(p) for p in paths)),
        DPI,
        width,
        height,
        "dark",
        5,
        "sintetica_baixo_contraste",
        "Raizes de baixo contraste em fundo escuro com ruido leve.",
    )


def noisy_light_case() -> SyntheticCase:
    return oriented_roots_case(
        filename="sintetica_011_clara_com_ruido_3500mm.png",
        target_mm=3500.0,
        width=2300,
        height=2800,
        background="light",
        root_width=5,
        piece_range_mm=(45, 140),
        angle_range=(-math.pi, math.pi),
        amplitude_range=(4, 18),
        cycles_range=(0.15, 0.75),
        seed_offset=11,
        notes="Fundo claro com raizes e muitos pontos escuros isolados.",
        noise_points=1800,
        blur_radius=0.15,
    )


def crossings_case() -> SyntheticCase:
    rng = random.Random(SEED + 12)
    width, height = 2200, 2400
    image, draw, fg = make_canvas(width, height, "dark")
    target_px = mm_to_px(5200.0)
    paths: list[list[Point]] = []
    total = 0.0
    center = (width / 2.0, height / 2.0)
    while total < target_px:
        piece_target = min(target_px - total, rng.uniform(mm_to_px(80), mm_to_px(170)))
        angle = rng.uniform(-math.pi, math.pi)
        start = (
            center[0] + math.cos(angle + math.pi) * rng.uniform(120, 680),
            center[1] + math.sin(angle + math.pi) * rng.uniform(120, 680),
        )
        pts = scale_path_to_length(
            sine_curve(start, piece_target * 0.92, angle, rng.uniform(4, 22), rng.uniform(0.2, 0.75), 58),
            piece_target,
        )
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        if min(xs) < 80 or max(xs) > width - 80 or min(ys) < 80 or max(ys) > height - 80:
            continue
        draw_polyline(draw, pts, fg, rng.choice([4, 5, 6]))
        paths.append(pts)
        total += path_length(pts)

    save_image(image, "sintetica_012_escura_cruzamentos_5200mm.png")
    return SyntheticCase(
        "sintetica_012_escura_cruzamentos_5200mm.png",
        px_to_mm(sum(path_length(p) for p in paths)),
        DPI,
        width,
        height,
        "dark",
        5,
        "sintetica_cruzamentos",
        "Raizes com cruzamentos concentrados no centro.",
    )


def thin_roots_case() -> SyntheticCase:
    return oriented_roots_case(
        filename="sintetica_013_escura_fina_1200mm.png",
        target_mm=1200.0,
        width=1600,
        height=2000,
        background="dark",
        root_width=3,
        piece_range_mm=(45, 120),
        angle_range=(-math.pi, math.pi),
        amplitude_range=(2, 10),
        cycles_range=(0.15, 0.6),
        seed_offset=13,
        notes="Raizes muito finas.",
    )


def long_arcs_case() -> SyntheticCase:
    return oriented_roots_case(
        filename="sintetica_014_escura_arcos_longos_7000mm.png",
        target_mm=7000.0,
        width=2550,
        height=3509,
        background="dark",
        root_width=5,
        piece_range_mm=(120, 260),
        angle_range=(-math.pi, math.pi),
        amplitude_range=(18, 55),
        cycles_range=(0.25, 0.9),
        seed_offset=14,
        notes="Arcos longos distribuidos em pagina completa.",
    )


def sparse_short_roots_case() -> SyntheticCase:
    return oriented_roots_case(
        filename="sintetica_015_escura_curtas_esparsas_2800mm.png",
        target_mm=2800.0,
        width=2300,
        height=3000,
        background="dark",
        root_width=4,
        piece_range_mm=(18, 55),
        angle_range=(-math.pi, math.pi),
        amplitude_range=(1, 8),
        cycles_range=(0.1, 0.45),
        seed_offset=15,
        notes="Muitos fragmentos curtos e esparsos.",
        noise_points=600,
        blur_radius=0.1,
    )


def circular_continuous_case() -> SyntheticCase:
    width, height = 4700, 4700
    image, draw, fg = make_canvas(width, height, "light")
    sweep = math.radians(322)
    radius = mm_to_px(1000.0) / sweep
    pts = arc_curve((2350, 2350), radius, math.radians(20), sweep, 420)
    draw_polyline(draw, pts, fg, 9)
    save_image(image, "sintetica_016_clara_circular_continua_1000mm.png")
    return SyntheticCase(
        "sintetica_016_clara_circular_continua_1000mm.png",
        px_to_mm(path_length(pts)),
        DPI,
        width,
        height,
        "light",
        9,
        "sintetica_circular_continua",
        "Raiz continua quase circular semelhante a contornos de scanner.",
    )


def nested_loops_case() -> SyntheticCase:
    width, height = 5200, 5200
    image, draw, fg = make_canvas(width, height, "light")
    raw_paths = [
        arc_curve((2500, 2100), 1350, math.radians(205), math.radians(320), 320),
        arc_curve((2550, 3150), 1180, math.radians(-25), math.radians(280), 280),
        arc_curve((3050, 2800), 820, math.radians(95), math.radians(-260), 240),
    ]
    paths: list[list[Point]] = []
    for path in raw_paths:
        draw_polyline(draw, path, fg, 8)
        paths.append(path)
    save_image(image, "sintetica_017_clara_lacos_aninhados_1442mm.png")
    return SyntheticCase(
        "sintetica_017_clara_lacos_aninhados_1442mm.png",
        px_to_mm(sum(path_length(path) for path in paths)),
        DPI,
        width,
        height,
        "light",
        8,
        "sintetica_circular_continua",
        "Multiplas curvas continuas em lacos.",
    )


def spiral_continuous_case() -> SyntheticCase:
    width, height = 2800, 2800
    image, draw, fg = make_canvas(width, height, "light")
    pts = spiral_curve((1400, 1400), 90, 1050, 8.6, start_rad=math.radians(30), samples=680)
    draw_polyline(draw, pts, fg, 8)
    save_image(image, "sintetica_018_clara_espiral_continua_2609mm.png")
    return SyntheticCase(
        "sintetica_018_clara_espiral_continua_2609mm.png",
        px_to_mm(path_length(pts)),
        DPI,
        width,
        height,
        "light",
        8,
        "sintetica_circular_continua",
        "Caminho unico continuo em espiral.",
    )


def dark_circular_fragments_case() -> SyntheticCase:
    rng = random.Random(SEED + 19)
    width, height = 2300, 2300
    image, draw, fg = make_canvas(width, height, "dark")
    target_px = mm_to_px(3600.0)
    paths: list[list[Point]] = []
    total = 0.0
    while total < target_px:
        radius = rng.uniform(260, 850)
        sweep = rng.uniform(math.radians(22), math.radians(70))
        start = rng.uniform(-math.pi, math.pi)
        center = (rng.uniform(850, 1450), rng.uniform(850, 1450))
        pts = arc_curve(center, radius, start, sweep, 70)
        piece_target = min(path_length(pts), target_px - total)
        pts = scale_path_to_length(pts, piece_target)
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        if min(xs) < 80 or max(xs) > width - 80 or min(ys) < 80 or max(ys) > height - 80:
            continue
        draw_polyline(draw, pts, fg, 5)
        paths.append(pts)
        total += path_length(pts)
    save_image(image, "sintetica_019_escura_fragmentos_circulares_3600mm.png")
    return SyntheticCase(
        "sintetica_019_escura_fragmentos_circulares_3600mm.png",
        px_to_mm(sum(path_length(path) for path in paths)),
        DPI,
        width,
        height,
        "dark",
        5,
        "sintetica_circular_fragmentada",
        "Fragmentos curvos separados organizados como arcos circulares.",
    )


def scanner_like_low_contrast_loop_case() -> SyntheticCase:
    rng = random.Random(SEED + 20)
    width, height = 2550, 3509
    image = Image.new("L", (width, height), 246)
    draw = ImageDraw.Draw(image)
    paths = [
        arc_curve((1260, 1350), 620, math.radians(205), math.radians(330), 250),
        arc_curve((1280, 2250), 760, math.radians(-35), math.radians(285), 260),
        arc_curve((1550, 1810), 360, math.radians(90), math.radians(-260), 200),
        arc_curve((960, 1750), 480, math.radians(130), math.radians(240), 180),
        arc_curve((1780, 2300), 390, math.radians(20), math.radians(230), 170),
    ]
    for pts in paths:
        draw_polyline(draw, pts, 42, 7)
    for _ in range(1400):
        x = rng.randrange(0, width)
        y = rng.randrange(0, height)
        image.putpixel((x, y), rng.randrange(228, 255))
    image = image.filter(ImageFilter.GaussianBlur(radius=0.18))
    save_image(image, "sintetica_020_clara_parecida_scanner_1063mm.png")
    return SyntheticCase(
        "sintetica_020_clara_parecida_scanner_1063mm.png",
        px_to_mm(sum(path_length(path) for path in paths)),
        DPI,
        width,
        height,
        "light",
        7,
        "sintetica_parecida_scanner",
        "Padrao de lacos em baixo contraste semelhante a imagem de scanner.",
    )


def write_manifest(cases: list[SyntheticCase]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with (OUT_DIR / "comprimentos_esperados.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "filename",
                "expected_length_mm",
                "dpi",
                "width_px",
                "height_px",
                "background",
                "root_width_px",
                "group",
                "notes",
            ],
        )
        writer.writeheader()
        for case in cases:
            writer.writerow({
                "filename": case.filename,
                "expected_length_mm": f"{case.expected_length_mm:.6f}",
                "dpi": case.dpi,
                "width_px": case.width_px,
                "height_px": case.height_px,
                "background": case.background,
                "root_width_px": case.root_width_px,
                "group": case.group,
                "notes": case.notes,
            })

    (OUT_DIR / "README.txt").write_text(
        "Imagens sinteticas de raizes geradas a partir de centrolinhas conhecidas.\n"
        "Utilize comprimentos_esperados.csv como tabela de referencia.\n"
        "O comprimento esperado e a soma da centrolinha desenhada, nao a area ou o contorno.\n"
        "Todas as imagens foram salvas com metadados de 300 DPI.\n",
        encoding="utf-8",
    )


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cases = [
        horizontal_ladder_case(),
        continuous_curve_case(),
        fragmented_dark_case(),
        fragmented_dark_noisy_case(),
        dense_network_case(),
        thick_roots_case(),
        vertical_roots_case(),
        diagonal_roots_case(),
        light_fragmented_case(),
        low_contrast_dark_case(),
        noisy_light_case(),
        crossings_case(),
        thin_roots_case(),
        long_arcs_case(),
        sparse_short_roots_case(),
        circular_continuous_case(),
        nested_loops_case(),
        spiral_continuous_case(),
        dark_circular_fragments_case(),
        scanner_like_low_contrast_loop_case(),
    ]
    write_manifest(cases)
    print(f"Geradas {len(cases)} imagens em {OUT_DIR}")
    for case in cases:
        print(f"{case.filename}: {case.expected_length_mm:.3f} mm")


if __name__ == "__main__":
    main()
