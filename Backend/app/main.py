from base64 import b64encode
from io import BytesIO
from typing import Optional, Tuple

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import ExifTags, Image, ImageOps, UnidentifiedImageError
from scipy.ndimage import distance_transform_edt
from skimage.morphology import thin

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

JFIF_UNIT_INCH = 1
JFIF_UNIT_CENTIMETER = 2
RESOLUTION_UNIT_INCH = 2
RESOLUTION_UNIT_CENTIMETER = 3
EXIF_UNIT_INCH = 2
EXIF_UNIT_CENTIMETER = 3
PLACEHOLDER_DPI = {72.0, 96.0}
FALLBACK_DPI = 600.0
MIN_PLAUSIBLE_DPI = 50.0
MAX_PLAUSIBLE_DPI = 2400.0
PREVIEW_MAX_SIDE = 1400
LOW_CONTRAST_DYNAMIC_RANGE = 120.0
LOW_CONTRAST_STDDEV = 6.0
ENHANCED_THRESHOLD_FACTOR = 0.68
DENSE_GRAPH_BRANCH_DENSITY_THRESHOLD = 0.95
DENSE_GRAPH_CORRECTION_STRENGTH = 2.5
DENSE_GRAPH_MIN_BRANCH_POINTS = 1000
FRAGMENTED_BRANCH_DENSITY_THRESHOLD = 0.35
FRAGMENTED_LENGTH_SCALE = 1.3
FRAGMENTED_LOW_BRANCH_BLEND_MAX_POINTS = 100
FRAGMENTED_MAX_FILTERED_FOREGROUND_RATIO = 0.035
FRAGMENTED_COMPONENT_MIN_AREA = 80
FRAGMENTED_COMPONENT_MAX_FOREGROUND_RATIO = 0.025
BACKGROUND_MODE_AUTO = "auto"
BACKGROUND_MODE_LIGHT = "light"
BACKGROUND_MODE_DARK = "dark"
VALID_BACKGROUND_MODES = {
    BACKGROUND_MODE_AUTO,
    BACKGROUND_MODE_LIGHT,
    BACKGROUND_MODE_DARK,
}


def load_image(file_bytes: bytes) -> Optional[Image.Image]:
    try:
        return Image.open(BytesIO(file_bytes))
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError):
        return None


def validate_background_mode(background_mode: Optional[str]) -> str:
    normalized = (background_mode or BACKGROUND_MODE_AUTO).strip().lower()
    if normalized not in VALID_BACKGROUND_MODES:
        raise HTTPException(
            status_code=400,
            detail="O modo de fundo deve ser 'auto', 'light' ou 'dark'.",
        )
    return normalized


def extract_dpi(image: Optional[Image.Image], manual_dpi: Optional[float]) -> Tuple[float, bool, str]:
    if manual_dpi is not None:
        dpi_value = float(manual_dpi)
        if not np.isfinite(dpi_value):
            raise HTTPException(status_code=400, detail="O DPI informado e invalido.")
        if dpi_value < MIN_PLAUSIBLE_DPI or dpi_value > MAX_PLAUSIBLE_DPI:
            raise HTTPException(
                status_code=400,
                detail=f"O DPI manual deve estar entre {int(MIN_PLAUSIBLE_DPI)} e {int(MAX_PLAUSIBLE_DPI)}.",
            )
        return dpi_value, True, "manual"

    if image is None:
        return FALLBACK_DPI, False, "fallback"

    info = image.info
    candidates: list[float] = []

    def collect(value: object) -> list[float]:
        if isinstance(value, (list, tuple)):
            out: list[float] = []
            for x in value:
                try:
                    fx = float(x)
                except (TypeError, ValueError):
                    continue
                if np.isfinite(fx) and fx > 0:
                    out.append(fx)
            return out
        try:
            fx = float(value)
        except (TypeError, ValueError):
            return []
        return [fx] if np.isfinite(fx) and fx > 0 else []

    if "dpi" in info:
        candidates.extend(collect(info["dpi"]))

    jfif_density = info.get("jfif_density")
    jfif_unit = info.get("jfif_unit")
    if jfif_density:
        dvals = collect(jfif_density)
        if jfif_unit == JFIF_UNIT_INCH:
            candidates.extend(dvals)
        elif jfif_unit == JFIF_UNIT_CENTIMETER:
            candidates.extend([x * 2.54 for x in dvals])

    resolution = info.get("resolution")
    resolution_unit = info.get("resolution_unit")
    if resolution:
        rvals = collect(resolution)
        if resolution_unit == RESOLUTION_UNIT_INCH:
            candidates.extend(rvals)
        elif resolution_unit == RESOLUTION_UNIT_CENTIMETER:
            candidates.extend([x * 2.54 for x in rvals])

    try:
        exif = image.getexif()
    except Exception:
        exif = None
    if exif:
        tag_map = {v: k for k, v in ExifTags.TAGS.items()}
        xres_tag = tag_map.get("XResolution")
        yres_tag = tag_map.get("YResolution")
        unit_tag = tag_map.get("ResolutionUnit")

        def rational_to_float(val: object) -> Optional[float]:
            try:
                if hasattr(val, "numerator") and hasattr(val, "denominator"):
                    den = float(val.denominator) if val.denominator else 1.0
                    return float(val.numerator) / den
                if isinstance(val, tuple) and len(val) == 2:
                    den = float(val[1]) if val[1] else 1.0
                    return float(val[0]) / den
                f = float(val)
                return f
            except Exception:
                return None

        xres = rational_to_float(exif.get(xres_tag)) if xres_tag in exif else None
        yres = rational_to_float(exif.get(yres_tag)) if yres_tag in exif else None
        unit = exif.get(unit_tag) if unit_tag in exif else None
        exif_vals: list[float] = []
        for v in (xres, yres):
            if v and np.isfinite(v) and v > 0:
                exif_vals.append(float(v))
        if exif_vals:
            if unit == EXIF_UNIT_INCH:
                candidates.extend(exif_vals)
            elif unit == EXIF_UNIT_CENTIMETER:
                candidates.extend([x * 2.54 for x in exif_vals])
            else:
                candidates.extend(exif_vals)

    dpi_value: Optional[float] = None
    if candidates:
        sane = [x for x in candidates if 1 <= x <= 20000]
        if sane:
            dpi_value = float(np.median(sane))

    reliable = False
    source = "metadata"
    if dpi_value is not None:
        if dpi_value in PLACEHOLDER_DPI or not (150.0 <= dpi_value <= MAX_PLAUSIBLE_DPI):
            dpi_value = FALLBACK_DPI
            source = "fallback"
        else:
            reliable = True
    else:
        dpi_value = FALLBACK_DPI
        source = "fallback"

    if dpi_value <= 0:
        raise HTTPException(status_code=400, detail="O DPI precisa ser maior que zero.")
    return float(dpi_value), bool(reliable), source


def to_grayscale(image: Image.Image) -> Image.Image:
    return ImageOps.grayscale(ImageOps.exif_transpose(image)).convert("L")


def image_to_grayscale_array(image: Image.Image) -> np.ndarray:
    grayscale = to_grayscale(image)
    return np.asarray(grayscale, dtype=np.uint8)


def normalize_to_uint8(gray_array: np.ndarray) -> np.ndarray:
    if gray_array.dtype == np.uint8:
        return gray_array

    min_value = float(np.min(gray_array))
    max_value = float(np.max(gray_array))
    if not np.isfinite(min_value) or not np.isfinite(max_value):
        raise HTTPException(status_code=400, detail="A imagem possui valores invalidos.")
    if max_value <= min_value:
        return np.zeros_like(gray_array, dtype=np.uint8)
    scaled = ((gray_array.astype(np.float32) - min_value) / (max_value - min_value)) * 255.0
    return np.clip(scaled, 0, 255).astype(np.uint8)


def cv2_to_grayscale(decoded: np.ndarray) -> np.ndarray:
    if decoded.ndim == 2:
        return normalize_to_uint8(decoded)
    if decoded.ndim == 3 and decoded.shape[2] == 4:
        return normalize_to_uint8(cv2.cvtColor(decoded, cv2.COLOR_BGRA2GRAY))
    if decoded.ndim == 3 and decoded.shape[2] == 3:
        return normalize_to_uint8(cv2.cvtColor(decoded, cv2.COLOR_BGR2GRAY))
    raise HTTPException(status_code=400, detail="Formato de imagem nao suportado.")


def resize_gray_with_limit(gray_array: np.ndarray, max_side: int) -> np.ndarray:
    if max_side <= 0:
        return gray_array
    height, width = gray_array.shape[:2]
    longer_side = max(height, width)
    if longer_side <= max_side:
        return gray_array
    scale = max_side / float(longer_side)
    target_width = max(1, int(round(width * scale)))
    target_height = max(1, int(round(height * scale)))
    return cv2.resize(gray_array, (target_width, target_height), interpolation=cv2.INTER_AREA)


def decode_gray_from_cv2(file_bytes: bytes, max_side: Optional[int] = None) -> np.ndarray:
    raw = np.frombuffer(file_bytes, dtype=np.uint8)
    decoded = cv2.imdecode(raw, cv2.IMREAD_UNCHANGED)
    if decoded is None:
        raise HTTPException(status_code=400, detail="Nao foi possivel ler a imagem enviada.")
    gray = cv2_to_grayscale(decoded)
    if max_side is not None:
        gray = resize_gray_with_limit(gray, max_side)
    return gray.astype(np.uint8)


def decode_gray_image(file_bytes: bytes, image: Optional[Image.Image], max_side: Optional[int] = None) -> np.ndarray:
    if image is None:
        return decode_gray_from_cv2(file_bytes, max_side=max_side)

    try:
        if max_side is None:
            return image_to_grayscale_array(image)

        preview_image = ImageOps.exif_transpose(image)
        preview_image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        preview_gray = ImageOps.grayscale(preview_image).convert("L")
        return np.asarray(preview_gray, dtype=np.uint8)
    except Exception:
        return decode_gray_from_cv2(file_bytes, max_side=max_side)


def smooth_grayscale(gray_array: np.ndarray, enabled: bool = True) -> np.ndarray:
    if not enabled:
        return gray_array
    return cv2.GaussianBlur(gray_array, (3, 3), 0)


def compute_dynamic_range(gray_array: np.ndarray) -> float:
    low = float(np.percentile(gray_array, 1))
    high = float(np.percentile(gray_array, 99))
    return max(0.0, high - low)


def resolve_effective_background_mode(
    gray_array: np.ndarray,
    threshold: float,
    background_mode: str,
) -> str:
    normalized_background = validate_background_mode(background_mode)
    if normalized_background in (BACKGROUND_MODE_LIGHT, BACKGROUND_MODE_DARK):
        return normalized_background

    if compute_dynamic_range(gray_array) <= LOW_CONTRAST_DYNAMIC_RANGE and float(np.std(gray_array)) <= LOW_CONTRAST_STDDEV:
        return BACKGROUND_MODE_DARK

    dark_foreground_ratio = float(np.mean(gray_array <= threshold))
    return BACKGROUND_MODE_DARK if dark_foreground_ratio > 0.6 else BACKGROUND_MODE_LIGHT


def enhance_dark_background_roots(gray_array: np.ndarray, smooth_output: bool = True) -> np.ndarray:
    height, width = gray_array.shape[:2]
    smaller_side = max(1, min(height, width))
    kernel_size = int(round(smaller_side / 34))
    kernel_size = int(np.clip(kernel_size, 31, 91))
    if kernel_size % 2 == 0:
        kernel_size += 1

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    top_hat = cv2.morphologyEx(gray_array, cv2.MORPH_TOPHAT, kernel)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(top_hat)
    return smooth_grayscale(enhanced, smooth_output)


def prepare_segmentation_source(
    gray_array: np.ndarray,
    threshold: Optional[float],
    background_mode: str = BACKGROUND_MODE_AUTO,
    smooth_segmentation: bool = True,
) -> tuple[np.ndarray, Optional[str]]:
    smoothed = smooth_grayscale(gray_array, smooth_segmentation)
    initial_threshold = float(threshold) if threshold is not None else compute_imagej_like_threshold(smoothed)
    effective_background = resolve_effective_background_mode(smoothed, initial_threshold, background_mode)
    dynamic_range = compute_dynamic_range(gray_array)
    contrast_stddev = float(np.std(gray_array))

    if (
        effective_background == BACKGROUND_MODE_DARK
        and dynamic_range <= LOW_CONTRAST_DYNAMIC_RANGE
        and contrast_stddev <= LOW_CONTRAST_STDDEV
    ):
        return enhance_dark_background_roots(gray_array, smooth_segmentation), "dark-background-enhanced"

    return smoothed, None


def compute_imagej_like_threshold(gray_array: np.ndarray) -> float:
    histogram = np.bincount(gray_array.ravel(), minlength=256).astype(np.float64)
    non_zero = np.flatnonzero(histogram)
    if non_zero.size == 0:
        return 127.0

    first = int(non_zero[0])
    last = int(non_zero[-1])
    if first >= last:
        return float(first)

    moving_index = first
    result = float(moving_index)
    while moving_index < last:
        low_values = histogram[first : moving_index + 1]
        high_values = histogram[moving_index + 1 : last + 1]
        low_count = float(np.sum(low_values))
        high_count = float(np.sum(high_values))
        if low_count <= 0.0 or high_count <= 0.0:
            break

        low_levels = np.arange(first, moving_index + 1, dtype=np.float64)
        high_levels = np.arange(moving_index + 1, last + 1, dtype=np.float64)
        low_mean = float(np.dot(low_levels, low_values) / low_count)
        high_mean = float(np.dot(high_levels, high_values) / high_count)
        result = (low_mean + high_mean) / 2.0
        if moving_index + 1 > result or moving_index >= last - 1:
            break
        moving_index += 1

    return float(np.clip(round(result), 0, 255))


def segment_image(
    gray_array: np.ndarray,
    threshold: Optional[float],
    background_mode: str = BACKGROUND_MODE_AUTO,
    smooth_segmentation: bool = True,
) -> tuple[np.ndarray, float, Optional[str]]:
    segmentation_source, preprocessing_mode = prepare_segmentation_source(
        gray_array,
        threshold,
        background_mode,
        smooth_segmentation,
    )
    if threshold is not None:
        selected_threshold = float(threshold)
    else:
        selected_threshold = compute_imagej_like_threshold(segmentation_source)
        if preprocessing_mode == "dark-background-enhanced":
            selected_threshold *= ENHANCED_THRESHOLD_FACTOR
    threshold_value = float(np.clip(selected_threshold, 0, 255))
    normalized_background = validate_background_mode(background_mode)

    if preprocessing_mode == "dark-background-enhanced":
        root_mask = (segmentation_source >= threshold_value).astype(np.uint8)
        foreground_ratio = float(np.mean(root_mask))
        if foreground_ratio > 0.2:
            threshold_value = float(np.percentile(segmentation_source, 96.0))
            root_mask = (segmentation_source >= threshold_value).astype(np.uint8)
    elif normalized_background == BACKGROUND_MODE_LIGHT:
        root_mask = (segmentation_source <= threshold_value).astype(np.uint8)
    elif normalized_background == BACKGROUND_MODE_DARK:
        root_mask = (segmentation_source >= threshold_value).astype(np.uint8)
    else:
        root_mask = (segmentation_source <= threshold_value).astype(np.uint8)
        foreground_ratio = float(np.mean(root_mask))
        if foreground_ratio > 0.6:
            root_mask = (segmentation_source >= threshold_value).astype(np.uint8)
    return root_mask, threshold_value, preprocessing_mode


def filter_roots(binary_array: np.ndarray, min_area_override: Optional[int] = None) -> np.ndarray:
    binary_uint8 = (binary_array > 0).astype(np.uint8)
    if not np.any(binary_uint8):
        return binary_uint8

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary_uint8, connectivity=8)
    if num_labels <= 1:
        return binary_uint8

    filtered = np.zeros_like(binary_uint8)
    min_area = int(min_area_override) if min_area_override is not None else max(36, int(binary_array.size * 0.00025))
    min_area = max(1, min_area)
    for label in range(1, num_labels):
        area = stats[label, cv2.CC_STAT_AREA]
        if area >= min_area:
            filtered[labels == label] = 1

    if not np.any(filtered):
        return binary_uint8
    return filtered.astype(np.uint8)


def skeletonize_image(binary_array: np.ndarray) -> np.ndarray:
    skeleton = thin(binary_array.astype(bool))
    return skeleton.astype(np.uint8)


def prune_skeleton(
    skeleton: np.ndarray,
    pixel_size_mm: float,
    min_spur_length_mm: float = 1.0,
    max_iterations: int = 8,
) -> np.ndarray:
    if min_spur_length_mm <= 0:
        return skeleton
    cleaned = skeleton.copy()
    offsets = [
        (-1, -1, np.sqrt(2.0)),
        (-1, 0, 1.0),
        (-1, 1, np.sqrt(2.0)),
        (0, -1, 1.0),
        (0, 1, 1.0),
        (1, -1, np.sqrt(2.0)),
        (1, 0, 1.0),
        (1, 1, np.sqrt(2.0)),
    ]

    def neighbor_data(point_set: set[tuple[int, int]], node: tuple[int, int]) -> list[tuple[tuple[int, int], float]]:
        neighbors: list[tuple[tuple[int, int], float]] = []
        r, c = node
        for dr, dc, weight in offsets:
            candidate = (r + dr, c + dc)
            if candidate in point_set:
                neighbors.append((candidate, weight))
        return neighbors

    for _ in range(max_iterations):
        points = np.argwhere(cleaned > 0)
        if points.size == 0:
            break
        point_set: set[tuple[int, int]] = {tuple(pt) for pt in map(tuple, points)}

        def degree(node: tuple[int, int]) -> int:
            return sum(1 for _ in neighbor_data(point_set, node))

        endpoints = [pt for pt in point_set if degree(pt) == 1]
        if not endpoints:
            break

        removal: set[tuple[int, int]] = set()
        for start in endpoints:
            if start not in point_set:
                continue
            path: list[tuple[int, int]] = []
            prev: Optional[tuple[int, int]] = None
            current = start
            length_px = 0.0
            branch_reached = False
            while True:
                path.append(current)
                neighbors = [(nbr, weight) for nbr, weight in neighbor_data(point_set, current) if nbr != prev]
                if not neighbors:
                    break
                if len(neighbors) > 1:
                    branch_reached = True
                    break
                next_node, weight = neighbors[0]
                length_px += weight
                prev = current
                current = next_node

            if branch_reached and path:
                path = path[:-1]
            if not branch_reached or not path:
                continue

            path_length_mm = length_px * pixel_size_mm
            if path_length_mm <= min_spur_length_mm:
                removal.update(path)
                point_set.difference_update(path)

        if not removal:
            break
        for node in removal:
            cleaned[node] = 0

    return cleaned


def compute_length(skeleton: np.ndarray, pixel_size_mm: float) -> float:
    skeleton_bool = skeleton.astype(bool)
    if not np.any(skeleton_bool):
        return 0.0
    horizontal = int(np.count_nonzero(np.logical_and(skeleton_bool[:, :-1], skeleton_bool[:, 1:])))
    vertical = int(np.count_nonzero(np.logical_and(skeleton_bool[:-1, :], skeleton_bool[1:, :])))
    diagonal_lr = int(np.count_nonzero(np.logical_and(skeleton_bool[:-1, :-1], skeleton_bool[1:, 1:])))
    diagonal_rl = int(np.count_nonzero(np.logical_and(skeleton_bool[1:, :-1], skeleton_bool[:-1, 1:])))
    # Use geometric chain-code distances so synthetic pixel-accurate centerlines
    # keep their intended physical length.
    orthogonal_weight = 1.0
    diagonal_weight = np.sqrt(2.0)
    length_px = orthogonal_weight * float(horizontal + vertical) + diagonal_weight * float(diagonal_lr + diagonal_rl)
    if length_px == 0.0:
        return pixel_size_mm
    return float(length_px * pixel_size_mm)


def correct_dense_graph_length(length_mm: float, branch_points: int) -> tuple[float, Optional[str]]:
    if length_mm <= 0.0 or branch_points < DENSE_GRAPH_MIN_BRANCH_POINTS:
        return length_mm, None

    branch_density = float(branch_points) / length_mm
    if branch_density <= DENSE_GRAPH_BRANCH_DENSITY_THRESHOLD:
        return length_mm, None

    excess_density = branch_density - DENSE_GRAPH_BRANCH_DENSITY_THRESHOLD
    correction_factor = 1.0 / (1.0 + DENSE_GRAPH_CORRECTION_STRENGTH * excess_density)
    return float(length_mm * correction_factor), "dense-graph"


def correct_fragmented_component_length(
    binary_array: np.ndarray,
    filtered_array: np.ndarray,
    length_mm: float,
    branch_points: int,
    pixel_size_mm: float,
    preprocessing_mode: Optional[str],
    filter_components: bool,
) -> tuple[float, Optional[str]]:
    if (
        not filter_components
        or preprocessing_mode != "dark-background-enhanced"
        or length_mm <= 0.0
        or float(np.mean(filtered_array)) > FRAGMENTED_MAX_FILTERED_FOREGROUND_RATIO
    ):
        return length_mm, None

    branch_density = float(branch_points) / length_mm
    if branch_density > FRAGMENTED_BRANCH_DENSITY_THRESHOLD:
        return length_mm, None

    unfiltered_skeleton = skeletonize_image(binary_array)
    if not np.any(unfiltered_skeleton):
        return length_mm, None

    unfiltered_length_mm = compute_length(unfiltered_skeleton, pixel_size_mm)
    if unfiltered_length_mm > 0.0 and length_mm >= unfiltered_length_mm * 0.85:
        return length_mm, None

    unfiltered_branch_points, unfiltered_branch_mask = compute_branch_data(unfiltered_skeleton)
    unfiltered_diameter_mm = compute_diameter(
        binary_array,
        unfiltered_skeleton,
        unfiltered_branch_mask,
        pixel_size_mm,
    )
    if unfiltered_diameter_mm <= 0.0:
        return length_mm, None

    unfiltered_area_mm2 = float(np.sum(binary_array) * pixel_size_mm * pixel_size_mm)
    area_length_estimate = (unfiltered_area_mm2 / unfiltered_diameter_mm) * FRAGMENTED_LENGTH_SCALE
    if area_length_estimate <= length_mm * 1.15:
        return length_mm, None

    if branch_points < FRAGMENTED_LOW_BRANCH_BLEND_MAX_POINTS:
        blended_estimate = np.sqrt(length_mm * area_length_estimate)
        return float(blended_estimate), "fragmented-components-blended"

    return float(area_length_estimate), "fragmented-components"


def compute_branch_data(skeleton: np.ndarray) -> tuple[int, np.ndarray]:
    skeleton_uint8 = skeleton.astype(np.uint8)
    kernel = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]], dtype=np.uint8)
    neighbor_count = cv2.filter2D(skeleton_uint8, cv2.CV_8U, kernel, borderType=cv2.BORDER_CONSTANT)
    branch_mask = np.logical_and(skeleton_uint8 == 1, neighbor_count > 2)
    count = int(np.count_nonzero(branch_mask))
    return count, branch_mask


def compute_diameter(binary: np.ndarray, skeleton: np.ndarray, branch_mask: np.ndarray, pixel_size_mm: float) -> float:
    distance_map = distance_transform_edt(binary == 1)
    valid = np.logical_and(skeleton == 1, ~branch_mask)
    skeleton_distances = distance_map[valid]
    if skeleton_distances.size == 0:
        return 0.0
    positive = skeleton_distances[skeleton_distances > 0]
    if positive.size == 0:
        return 0.0
    diameters = positive * 2.0 * pixel_size_mm
    return float(np.mean(diameters))


def array_to_base64(array: np.ndarray) -> str:
    if array.dtype != np.uint8:
        array = array.astype(np.uint8)
    image = Image.fromarray(array)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return b64encode(buffer.getvalue()).decode("utf-8")


def bytes_to_base64(raw_bytes: bytes) -> str:
    return b64encode(raw_bytes).decode("utf-8")


def resolve_crop_box(
    width: int,
    height: int,
    x_ratio: float,
    y_ratio: float,
    width_ratio: float,
    height_ratio: float,
) -> tuple[int, int, int, int]:
    if width <= 0 or height <= 0:
        raise HTTPException(status_code=400, detail="Dimensoes invalidas para recorte.")

    for value, name in (
        (x_ratio, "x_ratio"),
        (y_ratio, "y_ratio"),
        (width_ratio, "width_ratio"),
        (height_ratio, "height_ratio"),
    ):
        if not np.isfinite(value):
            raise HTTPException(status_code=400, detail=f"O campo {name} e invalido.")

    if width_ratio <= 0 or height_ratio <= 0:
        raise HTTPException(status_code=400, detail="A area de recorte precisa ter tamanho positivo.")

    safe_x_ratio = float(np.clip(x_ratio, 0.0, 1.0))
    safe_y_ratio = float(np.clip(y_ratio, 0.0, 1.0))
    safe_width_ratio = float(np.clip(width_ratio, 0.0, 1.0))
    safe_height_ratio = float(np.clip(height_ratio, 0.0, 1.0))

    crop_width = max(1, int(round(width * safe_width_ratio)))
    crop_height = max(1, int(round(height * safe_height_ratio)))
    x = int(round(width * safe_x_ratio))
    y = int(round(height * safe_y_ratio))

    x = int(np.clip(x, 0, max(0, width - crop_width)))
    y = int(np.clip(y, 0, max(0, height - crop_height)))
    return x, y, crop_width, crop_height


def crop_image_to_png(
    file_bytes: bytes,
    image: Optional[Image.Image],
    x_ratio: float,
    y_ratio: float,
    width_ratio: float,
    height_ratio: float,
    dpi: Optional[float] = None,
) -> bytes:
    if image is not None:
        source_image = ImageOps.exif_transpose(image)
        width, height = source_image.size
        x, y, crop_width, crop_height = resolve_crop_box(
            int(width),
            int(height),
            x_ratio,
            y_ratio,
            width_ratio,
            height_ratio,
        )
        cropped = source_image.crop((x, y, x + crop_width, y + crop_height))
        if cropped.mode not in ("1", "L", "P", "RGB", "RGBA"):
            cropped = cropped.convert("RGB")
        buffer = BytesIO()
        save_kwargs: dict[str, object] = {"format": "PNG"}
        if dpi is not None and np.isfinite(dpi) and dpi > 0:
            save_kwargs["dpi"] = (float(dpi), float(dpi))
        cropped.save(buffer, **save_kwargs)
        return buffer.getvalue()

    raw = np.frombuffer(file_bytes, dtype=np.uint8)
    decoded = cv2.imdecode(raw, cv2.IMREAD_UNCHANGED)
    if decoded is None:
        raise HTTPException(status_code=400, detail="Nao foi possivel ler a imagem enviada.")

    height, width = decoded.shape[:2]
    x, y, crop_width, crop_height = resolve_crop_box(
        int(width),
        int(height),
        x_ratio,
        y_ratio,
        width_ratio,
        height_ratio,
    )
    cropped = decoded[y : y + crop_height, x : x + crop_width]
    ok, encoded = cv2.imencode(".png", cropped)
    if not ok:
        raise HTTPException(status_code=400, detail="Nao foi possivel gerar a imagem recortada.")
    return bytes(encoded.tobytes())


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/process")
@app.post("/api/process")
async def process_image(
    file: UploadFile = File(...),
    manual_dpi: Optional[float] = Form(None),
    threshold: Optional[float] = Form(None),
    background_mode: str = Form(BACKGROUND_MODE_AUTO),
    smooth_segmentation: bool = Form(True),
    filter_components: bool = Form(True),
    prune_skeleton_enabled: bool = Form(True),
) -> dict[str, object]:
    if threshold is not None and (threshold < 0 or threshold > 255):
        raise HTTPException(status_code=400, detail="O limiar deve estar entre 0 e 255.")
    normalized_background = validate_background_mode(background_mode)
    file_bytes = await file.read()
    image = load_image(file_bytes)
    dpi, dpi_reliable, dpi_source = extract_dpi(image, manual_dpi)
    gray_array = decode_gray_image(file_bytes, image)
    binary_array, selected_threshold, preprocessing_mode = segment_image(
        gray_array,
        threshold,
        normalized_background,
        smooth_segmentation,
    )
    foreground_ratio = float(np.mean(binary_array))
    fragmented_filter_area = (
        FRAGMENTED_COMPONENT_MIN_AREA
        if (
            filter_components
            and preprocessing_mode == "dark-background-enhanced"
            and threshold is not None
            and foreground_ratio <= FRAGMENTED_COMPONENT_MAX_FOREGROUND_RATIO
        )
        else None
    )
    filtered_array = filter_roots(binary_array, fragmented_filter_area) if filter_components else binary_array
    skeleton_array = skeletonize_image(filtered_array)
    pixel_size_mm = 25.4 / dpi
    if prune_skeleton_enabled and int(np.count_nonzero(skeleton_array)) > 500:
        min_spur_length_mm = 0.25
        refined_skeleton = prune_skeleton(
            skeleton_array,
            pixel_size_mm,
            min_spur_length_mm=min_spur_length_mm,
            max_iterations=6,
        )
    else:
        refined_skeleton = skeleton_array
    raw_length_mm = compute_length(refined_skeleton, pixel_size_mm)
    branch_points, branch_mask = compute_branch_data(refined_skeleton)
    length_mm, length_correction_mode = correct_dense_graph_length(raw_length_mm, branch_points)
    if length_correction_mode is None:
        length_mm, length_correction_mode = correct_fragmented_component_length(
            binary_array,
            filtered_array,
            length_mm,
            branch_points,
            pixel_size_mm,
            preprocessing_mode,
            filter_components,
        )
    average_diameter_mm = compute_diameter(filtered_array, refined_skeleton, branch_mask, pixel_size_mm)
    area_mm2 = float(np.sum(filtered_array) * pixel_size_mm * pixel_size_mm)
    grayscale_base64 = array_to_base64(gray_array)
    segmented_base64 = array_to_base64(filtered_array * 255)
    skeleton_base64 = array_to_base64(refined_skeleton * 255)
    return {
        "dpi": dpi,
        "dpiReliable": dpi_reliable,
        "dpiSource": dpi_source,
        "pixelSizeMm": pixel_size_mm,
        "threshold": selected_threshold,
        "thresholdMethod": "manual" if threshold is not None else "imagej-like",
        "preprocessingMode": preprocessing_mode,
        "smoothSegmentation": smooth_segmentation,
        "filterComponents": filter_components,
        "pruneSkeleton": prune_skeleton_enabled,
        "backgroundMode": normalized_background,
        "rawLengthMm": raw_length_mm,
        "lengthCorrectionMode": length_correction_mode,
        "lengthMm": length_mm,
        "branchPoints": branch_points,
        "averageDiameterMm": average_diameter_mm,
        "areaMm2": area_mm2,
        "grayscaleImage": grayscale_base64,
        "segmentedImage": segmented_base64,
        "skeletonImage": skeleton_base64,
    }


@app.post("/probe-dpi")
@app.post("/api/probe-dpi")
async def probe_dpi(
    file: UploadFile = File(...),
    manual_dpi: Optional[float] = Form(None),
) -> dict[str, object]:
    file_bytes = await file.read()
    image = load_image(file_bytes)
    dpi, reliable, source = extract_dpi(image, manual_dpi)
    return {"dpi": dpi, "dpiReliable": reliable, "dpiSource": source}


@app.post("/preview")
@app.post("/api/preview")
async def preview_image(
    file: UploadFile = File(...),
    smooth_segmentation: bool = Form(True),
) -> dict[str, object]:
    file_bytes = await file.read()
    image = load_image(file_bytes)
    preview_gray = decode_gray_image(file_bytes, image, max_side=PREVIEW_MAX_SIDE)
    smoothed_gray, preprocessing_mode = prepare_segmentation_source(
        preview_gray,
        None,
        BACKGROUND_MODE_AUTO,
        smooth_segmentation,
    )
    suggested_threshold = compute_imagej_like_threshold(smoothed_gray)
    if preprocessing_mode == "dark-background-enhanced":
        suggested_threshold *= ENHANCED_THRESHOLD_FACTOR

    return {
        "width": int(preview_gray.shape[1]),
        "height": int(preview_gray.shape[0]),
        "grayPixels": bytes_to_base64(preview_gray.tobytes()),
        "smoothedPixels": bytes_to_base64(smoothed_gray.tobytes()),
        "suggestedThreshold": float(np.clip(round(suggested_threshold), 0, 255)),
        "preprocessingMode": preprocessing_mode,
    }


@app.post("/crop")
@app.post("/api/crop")
async def crop_image(
    file: UploadFile = File(...),
    x_ratio: float = Form(...),
    y_ratio: float = Form(...),
    width_ratio: float = Form(...),
    height_ratio: float = Form(...),
    dpi: Optional[float] = Form(None),
) -> dict[str, object]:
    file_bytes = await file.read()
    image = load_image(file_bytes)
    cropped_png = crop_image_to_png(
        file_bytes=file_bytes,
        image=image,
        x_ratio=x_ratio,
        y_ratio=y_ratio,
        width_ratio=width_ratio,
        height_ratio=height_ratio,
        dpi=dpi,
    )
    return {"croppedImage": bytes_to_base64(cropped_png)}
