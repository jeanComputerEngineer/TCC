from base64 import b64encode
from io import BytesIO
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps
from scipy.ndimage import distance_transform_edt
from skimage import morphology
from skimage.filters import threshold_otsu
from skimage.morphology import remove_small_objects

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
    binary = gray_array < selected_threshold
    if binary.mean() > 0.5:
        binary = ~binary
    binary = remove_small_objects(binary, min_size=30)
    return binary.astype(np.uint8), float(selected_threshold)


def skeletonize_image(binary_array: np.ndarray) -> np.ndarray:
    skeleton = morphology.skeletonize(binary_array > 0)
    return skeleton.astype(np.uint8)


def compute_length(skeleton: np.ndarray, pixel_size_mm: float) -> float:
    offsets = [
        (0, 1, 1.0),
        (1, 0, 1.0),
        (1, 1, np.sqrt(2)),
        (1, -1, np.sqrt(2)),
    ]
    total = 0.0
    rows, cols = skeleton.shape
    for r in range(rows):
        for c in range(cols):
            if skeleton[r, c] == 0:
                continue
            for dr, dc, weight in offsets:
                nr = r + dr
                nc = c + dc
                if 0 <= nr < rows and 0 <= nc < cols and skeleton[nr, nc] == 1:
                    total += weight
    return total * pixel_size_mm


def compute_branch_points(skeleton: np.ndarray) -> int:
    kernel = np.array(
        [
            [1, 1, 1],
            [1, 0, 1],
            [1, 1, 1],
        ]
    )
    padded = np.pad(skeleton, 1, mode="constant")
    count = 0
    for r in range(1, padded.shape[0] - 1):
        for c in range(1, padded.shape[1] - 1):
            if padded[r, c] == 0:
                continue
            neighbors = np.sum(kernel * padded[r - 1 : r + 2, c - 1 : c + 2])
            if neighbors >= 3:
                count += 1
    return count


def compute_diameter(binary: np.ndarray, skeleton: np.ndarray, pixel_size_mm: float) -> float:
    distance_map = distance_transform_edt(binary == 1)
    skeleton_distances = distance_map[skeleton == 1]
    if skeleton_distances.size == 0:
        return 0.0
    diameters = skeleton_distances * 2.0 * pixel_size_mm
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
    skeleton_array = skeletonize_image(binary_array)
    pixel_size_mm = 25.4 / dpi
    length_mm = compute_length(skeleton_array, pixel_size_mm)
    branch_points = compute_branch_points(skeleton_array)
    average_diameter_mm = compute_diameter(binary_array, skeleton_array, pixel_size_mm)
    area_mm2 = float(np.sum(binary_array) * pixel_size_mm * pixel_size_mm)
    grayscale_base64 = array_to_base64(gray_array)
    segmented_base64 = array_to_base64(binary_array * 255)
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
