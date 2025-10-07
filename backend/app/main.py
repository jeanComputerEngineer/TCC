from base64 import b64encode
from io import BytesIO
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps
from scipy.ndimage import distance_transform_edt
from skimage.filters import threshold_otsu
from skimage.morphology import thin

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def load_image(file_bytes: bytes) -> Image.Image:
    image = Image.open(BytesIO(file_bytes))
    return image


def extract_dpi(image: Image.Image, manual_dpi: Optional[float]) -> float:
    info = image.info
    dpi_value = None
    if "dpi" in info:
        dpi_data = info["dpi"]
        if isinstance(dpi_data, tuple):
            dpi_value = dpi_data[0]
        else:
            dpi_value = float(dpi_data)
    if dpi_value is None:
        if manual_dpi is None:
            raise HTTPException(status_code=400, detail="Não foi possível determinar o DPI. Informe um valor manual.")
        dpi_value = manual_dpi
    if dpi_value <= 0:
        raise HTTPException(status_code=400, detail="O DPI precisa ser maior que zero.")
    return float(dpi_value)


def to_grayscale(image: Image.Image) -> Image.Image:
    return ImageOps.grayscale(image)


def segment_image(gray_array: np.ndarray, threshold: Optional[float]) -> tuple[np.ndarray, float]:
    selected_threshold = threshold
    if selected_threshold is None:
        selected_threshold = float(threshold_otsu(gray_array))
    threshold_value = float(selected_threshold)
    _, binary = cv2.threshold(gray_array, threshold_value, 255, cv2.THRESH_BINARY)
    black_pixels = int(np.sum(binary == 0))
    white_pixels = int(np.sum(binary == 255))
    if black_pixels > white_pixels:
        binary = cv2.bitwise_not(binary)
    root_mask = (binary == 0).astype(np.uint8)
    return root_mask, float(selected_threshold)


def filter_roots(binary_array: np.ndarray) -> np.ndarray:
    binary_uint8 = (binary_array > 0).astype(np.uint8) * 255
    contours, _ = cv2.findContours(binary_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    filtered = np.zeros_like(binary_uint8)
    min_area = max(50, int(binary_array.size * 0.0005))
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area:
            continue
        perimeter = cv2.arcLength(contour, True)
        if perimeter == 0:
            continue
        circularity = 4.0 * np.pi * area / (perimeter * perimeter)
        if circularity >= 0.85:
            continue
        cv2.drawContours(filtered, [contour], -1, 255, thickness=-1)
    if not np.any(filtered):
        filtered = binary_uint8
    return (filtered > 0).astype(np.uint8)


def skeletonize_image(binary_array: np.ndarray) -> np.ndarray:
    skeleton = thin(binary_array.astype(bool))
    return skeleton.astype(np.uint8)


def compute_length(skeleton: np.ndarray, pixel_size_mm: float) -> float:
    skeleton_bool = skeleton.astype(bool)
    if not np.any(skeleton_bool):
        return 0.0

    def count_connections(dr: int, dc: int) -> int:
        shifted = np.zeros_like(skeleton_bool)
        if dr >= 0:
            row_src = slice(0, skeleton_bool.shape[0] - dr)
            row_dst = slice(dr, skeleton_bool.shape[0])
        else:
            row_src = slice(-dr, skeleton_bool.shape[0])
            row_dst = slice(0, skeleton_bool.shape[0] + dr)
        if dc >= 0:
            col_src = slice(0, skeleton_bool.shape[1] - dc)
            col_dst = slice(dc, skeleton_bool.shape[1])
        else:
            col_src = slice(-dc, skeleton_bool.shape[1])
            col_dst = slice(0, skeleton_bool.shape[1] + dc)
        shifted[row_dst, col_dst] = skeleton_bool[row_src, col_src]
        return int(np.sum(np.logical_and(skeleton_bool, shifted)))

    connections = (
        count_connections(0, 1) * 1.0
        + count_connections(1, 0) * 1.0
        + count_connections(1, 1) * np.sqrt(2)
        + count_connections(1, -1) * np.sqrt(2)
    )
    if connections == 0:
        return pixel_size_mm
    return connections * pixel_size_mm


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


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/process")
async def process_image(
    file: UploadFile = File(...),
    manual_dpi: Optional[float] = Form(None),
    threshold: Optional[float] = Form(None),
) -> dict[str, object]:
    if threshold is not None and (threshold < 0 or threshold > 255):
        raise HTTPException(status_code=400, detail="O limiar deve estar entre 0 e 255.")
    file_bytes = await file.read()
    image = load_image(file_bytes)
    dpi = extract_dpi(image, manual_dpi)
    grayscale_image = to_grayscale(image)
    gray_array = np.array(grayscale_image)
    binary_array, selected_threshold = segment_image(gray_array, threshold)
    filtered_array = filter_roots(binary_array)
    skeleton_array = skeletonize_image(filtered_array)
    pixel_size_mm = 25.4 / dpi
    length_mm = compute_length(skeleton_array, pixel_size_mm)
    branch_points, branch_mask = compute_branch_data(skeleton_array)
    average_diameter_mm = compute_diameter(filtered_array, skeleton_array, branch_mask, pixel_size_mm)
    area_mm2 = float(np.sum(filtered_array) * pixel_size_mm * pixel_size_mm)
    grayscale_base64 = array_to_base64(gray_array)
    segmented_base64 = array_to_base64(filtered_array * 255)
    skeleton_base64 = array_to_base64(skeleton_array * 255)
    return {
        "dpi": dpi,
        "pixelSizeMm": pixel_size_mm,
        "threshold": selected_threshold,
        "lengthMm": length_mm,
        "branchPoints": branch_points,
        "averageDiameterMm": average_diameter_mm,
        "areaMm2": area_mm2,
        "grayscaleImage": grayscale_base64,
        "segmentedImage": segmented_base64,
        "skeletonImage": skeleton_base64,
    }
