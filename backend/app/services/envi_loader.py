from pathlib import Path

import numpy as np
import spectral
from PIL import Image

from app.core.data_paths import resolve_under, validate_dataset_id
from app.schemas.datasets import DatasetManifest


BASE_DIR = Path(__file__).resolve().parents[2]
RAW_DATASETS_DIR = BASE_DIR / "data" / "raw"
DERIVED_DATASETS_DIR = BASE_DIR / "data" / "derived"


def get_first_valid_envi_pair(manifest: DatasetManifest) -> tuple[Path, Path | None, str]:
    if not manifest.sourceSummary or not manifest.sourceSummary.detectedPairs:
        raise ValueError("No detected source pairs are available.")

    pair = next((item for item in manifest.sourceSummary.detectedPairs if item.valid and item.hdr), None)
    if not pair or not pair.hdr:
        raise ValueError("No valid ENVI .hdr/.img pair was found.")

    try:
        hdr_path = resolve_under(RAW_DATASETS_DIR, pair.hdr)
        img_path = resolve_under(RAW_DATASETS_DIR, pair.img) if pair.img else None
    except ValueError as exc:
        raise ValueError("Dataset source path is outside the raw data directory.") from exc

    if not hdr_path.exists():
        raise ValueError(f"HDR file does not exist at {hdr_path}")
    if img_path and not img_path.exists():
        raise ValueError(f"IMG file does not exist at {img_path}")

    return hdr_path, img_path, pair.stem


def open_envi_dataset(manifest: DatasetManifest):
    hdr_path, img_path, stem = get_first_valid_envi_pair(manifest)

    image = spectral.io.envi.open(str(hdr_path), str(img_path) if img_path else None)

    metadata = image.metadata or {}
    shape = image.shape if hasattr(image, "shape") else None

    return {
        "stem": stem,
        "hdrPath": str(hdr_path),
        "imgPath": str(img_path) if img_path else None,
        "shape": list(shape) if shape else None,
        "metadata": metadata,
        "interleave": metadata.get("interleave"),
        "bands": shape[2] if shape and len(shape) >= 3 else None,
        "lines": shape[0] if shape and len(shape) >= 1 else None,
        "samples": shape[1] if shape and len(shape) >= 2 else None,
    }


def _load_cube_and_wavelengths(manifest: DatasetManifest):
    hdr_path, img_path, stem = get_first_valid_envi_pair(manifest)
    image = spectral.io.envi.open(str(hdr_path), str(img_path) if img_path else None)

    cube = image.load()
    cube_array = np.asarray(cube, dtype=np.float32)

    if cube_array.ndim != 3:
        raise ValueError(f"Expected a 3D hyperspectral cube, got shape {cube_array.shape}")

    wavelengths = []
    if manifest.datasetMetadata and manifest.datasetMetadata.wavelengths:
        wavelengths = manifest.datasetMetadata.wavelengths
    else:
        raw_wavelengths = image.metadata.get("wavelength", [])
        try:
            wavelengths = [float(value) for value in raw_wavelengths]
        except Exception:
            wavelengths = []

    return cube_array, wavelengths, stem


def _pick_nearest_band_index(wavelengths: list[float], target: float, fallback: int) -> int:
    if wavelengths:
        return min(range(len(wavelengths)), key=lambda i: abs(wavelengths[i] - target))
    return fallback


def _pick_rgb_band_indices(wavelengths: list[float], band_count: int) -> tuple[int, int, int]:
    if band_count < 3:
        raise ValueError("Dataset does not contain enough bands to generate an RGB preview.")

    return (
        _pick_nearest_band_index(wavelengths, 650.0, min(band_count - 1, int(band_count * 0.75))),
        _pick_nearest_band_index(wavelengths, 550.0, min(band_count - 1, int(band_count * 0.5))),
        _pick_nearest_band_index(wavelengths, 450.0, max(0, int(band_count * 0.25))),
    )


def _pick_false_color_band_indices(wavelengths: list[float], band_count: int) -> tuple[int, int, int]:
    if band_count < 3:
        raise ValueError("Dataset does not contain enough bands to generate a false-color preview.")

    return (
        _pick_nearest_band_index(wavelengths, 800.0, min(band_count - 1, int(band_count * 0.9))),
        _pick_nearest_band_index(wavelengths, 650.0, min(band_count - 1, int(band_count * 0.7))),
        _pick_nearest_band_index(wavelengths, 550.0, min(band_count - 1, int(band_count * 0.5))),
    )


def _normalize_channel(channel: np.ndarray, percentile_low: float = 1.0, percentile_high: float = 99.0) -> np.ndarray:
    finite = channel[np.isfinite(channel)]
    if finite.size == 0:
        return np.zeros_like(channel, dtype=np.uint8)

    lo = np.percentile(finite, percentile_low)
    hi = np.percentile(finite, percentile_high)

    if hi <= lo:
        return np.zeros_like(channel, dtype=np.uint8)

    normalized = np.clip((channel - lo) / (hi - lo), 0, 1)
    gamma_corrected = np.power(normalized, 0.85)
    return (gamma_corrected * 255).astype(np.uint8)


def _compose_preview(cube_array: np.ndarray, indices: tuple[int, int, int]) -> np.ndarray:
    return np.stack(
        [
            _normalize_channel(cube_array[:, :, indices[0]]),
            _normalize_channel(cube_array[:, :, indices[1]]),
            _normalize_channel(cube_array[:, :, indices[2]]),
        ],
        axis=-1,
    )


def generate_rgb_preview(manifest: DatasetManifest) -> dict:
    cube_array, wavelengths, stem = _load_cube_and_wavelengths(manifest)

    red_idx, green_idx, blue_idx = _pick_rgb_band_indices(wavelengths, cube_array.shape[2])
    rgb = _compose_preview(cube_array, (red_idx, green_idx, blue_idx))

    dataset_dir = resolve_under(DERIVED_DATASETS_DIR, validate_dataset_id(manifest.id))
    output_dir = dataset_dir / "preview"
    output_dir.mkdir(parents=True, exist_ok=True)

    output_path = output_dir / "rgb-preview.png"
    Image.fromarray(rgb, mode="RGB").save(output_path)

    master_dir = dataset_dir / "master"
    master_dir.mkdir(parents=True, exist_ok=True)
    master_path = master_dir / "rgb-master.png"
    Image.fromarray(rgb, mode="RGB").save(master_path)

    relative_url = f"/derived/{manifest.id}/preview/rgb-preview.png"
    master_relative_url = f"/derived/{manifest.id}/master/rgb-master.png"

    return {
        "stem": stem,
        "outputPath": str(output_path),
        "imageUrl": relative_url,
        "masterPath": str(master_path),
        "masterImageUrl": master_relative_url,
        "shape": list(cube_array.shape),
        "rgbBandIndices": {
            "red": red_idx,
            "green": green_idx,
            "blue": blue_idx,
        },
        "wavelengthsUsed": {
            "red": wavelengths[red_idx] if red_idx < len(wavelengths) else None,
            "green": wavelengths[green_idx] if green_idx < len(wavelengths) else None,
            "blue": wavelengths[blue_idx] if blue_idx < len(wavelengths) else None,
        },
    }



def generate_false_color_preview(manifest: DatasetManifest) -> dict:
    cube_array, wavelengths, stem = _load_cube_and_wavelengths(manifest)

    red_idx, green_idx, blue_idx = _pick_false_color_band_indices(wavelengths, cube_array.shape[2])
    false_color = _compose_preview(cube_array, (red_idx, green_idx, blue_idx))

    dataset_dir = resolve_under(DERIVED_DATASETS_DIR, validate_dataset_id(manifest.id))
    output_dir = dataset_dir / "preview"
    output_dir.mkdir(parents=True, exist_ok=True)

    output_path = output_dir / "false-color-preview.png"
    Image.fromarray(false_color, mode="RGB").save(output_path)

    relative_url = f"/derived/{manifest.id}/preview/false-color-preview.png"

    return {
        "stem": stem,
        "outputPath": str(output_path),
        "imageUrl": relative_url,
        "shape": list(cube_array.shape),
        "falseColorBandIndices": {
            "red": red_idx,
            "green": green_idx,
            "blue": blue_idx,
        },
        "wavelengthsUsed": {
            "red": wavelengths[red_idx] if red_idx < len(wavelengths) else None,
            "green": wavelengths[green_idx] if green_idx < len(wavelengths) else None,
            "blue": wavelengths[blue_idx] if blue_idx < len(wavelengths) else None,
        },
    }


def generate_band_previews(manifest: DatasetManifest) -> dict:
    cube_array, wavelengths, stem = _load_cube_and_wavelengths(manifest)

    band_count = cube_array.shape[2]
    if band_count < 1:
        raise ValueError("Dataset does not contain any bands.")

    dataset_dir = resolve_under(DERIVED_DATASETS_DIR, validate_dataset_id(manifest.id))
    output_dir = dataset_dir / "bands"
    output_dir.mkdir(parents=True, exist_ok=True)

    band_indices = range(band_count)

    items = []

    for band_index in band_indices:
        channel = _normalize_channel(cube_array[:, :, band_index])
        output_path = output_dir / f"band-{band_index:03d}.png"
        Image.fromarray(channel, mode="L").save(output_path)

        image_url = f"/derived/{manifest.id}/bands/band-{band_index:03d}.png"
        wavelength = wavelengths[band_index] if band_index < len(wavelengths) else None

        items.append(
            {
                "bandIndex": int(band_index),
                "wavelength": wavelength,
                "imageUrl": image_url,
            }
        )

    min_nm = int(min(wavelengths)) if wavelengths else 0
    max_nm = int(max(wavelengths)) if wavelengths else band_count - 1
    midpoint_index = band_count // 2
    default_nm = int(wavelengths[midpoint_index]) if wavelengths else int(midpoint_index)

    return {
        "stem": stem,
        "items": items,
        "bandCount": band_count,
        "minNm": min_nm,
        "maxNm": max_nm,
        "defaultNm": default_nm,
    }
