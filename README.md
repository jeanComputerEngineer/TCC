# Root Phenotyping Studio

An interactive application inspired by Teruo Matos' computational workflow for quantifying maize root length and diameter. The solution couples a modern Angular interface with a FastAPI processing engine so that agronomic researchers can evaluate root systems entirely on local hardware.

## Features

- Guided UX that follows the original pipeline: image acquisition, DPI configuration, grayscale conversion, segmentation, skeletonization, morphometric analysis, and validation reporting.
- Local-only processing delivered by a FastAPI microservice using Pillow, NumPy, SciPy, and scikit-image for reproducible measurements.
- Instant visualization of grayscale, binary, and skeleton outputs with one-click downloads for documentation.
- Quantitative metrics including skeleton length, branch points, mean diameter, and total area computed in physical units using embedded or user-provided DPI metadata.
- Dark and light modes to support varied laboratory environments.

## Prerequisites

- Docker Engine 24+
- Docker Compose Plugin 2+

## Quick start

```bash
git clone <repository>
cd TCC
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080) in a browser. The Angular frontend will forward `/api` requests to the FastAPI backend running on port 8000 inside the same Docker network.

## Usage workflow

1. Digitize the root sample using a flatbed scanner. Prefer high DPI (≥600) and include a calibration ruler when metadata is unavailable.
2. Drag the image into the interface or click **Select image** to browse. Provide a manual DPI if the file lacks metadata.
3. Optionally fine-tune the segmentation threshold (0–255). Leaving the field empty enables Otsu automatic thresholding.
4. Press **Process image**. The backend performs grayscale conversion, threshold segmentation, skeletonization, branch detection, and distance-transform-based diameter estimation.
5. Inspect quantitative metrics and download the grayscale, segmented, and skeleton layers for reporting or validation.

## Running tests

Angular unit tests can be executed locally with:

```bash
cd Frontend
npm install
npm test
```

## Project structure

- `Frontend/`: Angular 19 single-page application with UX tuned for phenotyping tasks.
- `backend/`: FastAPI service implementing the Teruo Matos-inspired image analysis pipeline.
- `docker-compose.yml`: Multi-container orchestration for the frontend and backend.

## Scientific grounding

The implementation reproduces the major computational stages described by Teruo Matos for maize root analysis: DPI normalization, grayscale conversion, histogram-driven thresholding, morphological skeletonization, branching analysis, length accumulation with Euclidean weights, and diameter estimation through distance transforms. Validation guidance mirrors the original nylon wire calibration strategy before applying the workflow to real root images.
