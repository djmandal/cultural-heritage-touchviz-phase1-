import json
import re
from datetime import datetime, UTC
from pathlib import Path

from app.schemas.datasets import (
    CreateDatasetRequest,
    DatasetAssets,
    DatasetBandConfig,
    DatasetComparePreset,
    DatasetDetectedPair,
    DatasetManifest,
    DatasetMetadata,
    DatasetProcessing,
    DatasetSourceSummary,
    DatasetVisualization,
)
from app.core.data_paths import resolve_under, validate_dataset_id


BASE_DIR = Path(__file__).resolve().parents[2]
RAW_DATASETS_DIR = BASE_DIR / "data" / "raw"
DERIVED_DATASETS_DIR = BASE_DIR / "data" / "derived"


def build_dataset_manifest(payload: CreateDatasetRequest) -> DatasetManifest:
    preview_base = f"/derived/{payload.id}/preview"
    preview_image = f"{preview_base}/rgb-preview.png"

    return DatasetManifest(
        id=payload.id,
        title=payload.title,
        artist=payload.artist,
        year=payload.year,
        collection=payload.collection,
        thumbnail=preview_image,
        hero=preview_image,
        iiifSources={},
        visualizations=[
            DatasetVisualization(
                id="rgb",
                label="Visible RGB",
                tone="rgb",
                description="Primary visible-light view generated from the dataset pipeline.",
                available=False,
                sourceType="image",
                imageUrl=preview_image,
            ),
            DatasetVisualization(
                id="infrared",
                label="Infrared",
                tone="infrared",
                description="Prepared slot for infrared or infrared-style output.",
                available=False,
                sourceType="generated",
            ),
            DatasetVisualization(
                id="falseColor",
                label="False Colour",
                tone="false",
                description="Prepared slot for false-colour composite output.",
                available=False,
                sourceType="generated",
            ),
            DatasetVisualization(
                id="uv",
                label="Ultraviolet",
                tone="uv",
                description="Prepared slot for fluorescence or UV-derived output.",
                available=False,
                sourceType="generated",
            ),
            DatasetVisualization(
                id="xray",
                label="X-Ray",
                tone="xray",
                description="Prepared slot for structural or cross-modality imaging output.",
                available=False,
                sourceType="generated",
            ),
        ],
        bands=DatasetBandConfig(
            enabled=False,
            minNm=420,
            maxNm=1000,
            stepNm=10,
            defaultNm=730,
        ),
        comparePresets=[],
        assets=DatasetAssets(
            thumbnail=preview_image,
            hero=preview_image,
            iiifSources={},
            previewImage=preview_image,
        ),
        processing=DatasetProcessing(
            status="processing",
            sourceType=payload.sourceType,
            uploadedAt=datetime.now(UTC).isoformat(),
        ),
        sourceFiles=[],
        sourceSummary=DatasetSourceSummary(),
        datasetMetadata=None,
    )


def write_dataset_manifest(manifest: DatasetManifest) -> Path:
    validate_dataset_id(manifest.id)
    dataset_dir = resolve_under(DERIVED_DATASETS_DIR, manifest.id)
    dataset_dir.mkdir(parents=True, exist_ok=True)

    manifest_path = dataset_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest.model_dump(mode="json"), indent=2),
        encoding="utf-8",
    )
    return manifest_path


def read_dataset_manifest(dataset_id: str) -> DatasetManifest:
    validate_dataset_id(dataset_id)
    manifest_path = resolve_under(DERIVED_DATASETS_DIR, dataset_id, "manifest.json")
    manifest_data = json.loads(manifest_path.read_text(encoding="utf-8"))
    return DatasetManifest(**manifest_data)


def build_source_summary(manifest: DatasetManifest) -> DatasetSourceSummary:
    extensions = sorted(
        {
            Path(item.name).suffix.lower()
            for item in manifest.sourceFiles
            if Path(item.name).suffix
        }
    )

    pair_map: dict[str, dict[str, str | None]] = {}

    for item in manifest.sourceFiles:
        path = Path(item.name)
        suffix = path.suffix.lower()
        stem = path.stem

        if suffix not in {".hdr", ".img"}:
            continue

        if stem not in pair_map:
            pair_map[stem] = {"hdr": None, "img": None}

        if suffix == ".hdr":
            pair_map[stem]["hdr"] = item.relativePath
        elif suffix == ".img":
            pair_map[stem]["img"] = item.relativePath

    detected_pairs = [
        DatasetDetectedPair(
            stem=stem,
            hdr=pair_info["hdr"],
            img=pair_info["img"],
            valid=bool(pair_info["hdr"] and pair_info["img"]),
        )
        for stem, pair_info in sorted(pair_map.items())
    ]

    return DatasetSourceSummary(
        totalFiles=len(manifest.sourceFiles),
        extensions=extensions,
        detectedPairs=detected_pairs,
        hasValidEnviPair=any(pair.valid for pair in detected_pairs),
    )


def _extract_scalar_value(text: str, field_name: str) -> str | None:
    pattern = rf"{re.escape(field_name)}\s*=\s*(.+)"
    match = re.search(pattern, text, flags=re.IGNORECASE)
    if not match:
        return None

    value = match.group(1).strip()
    if value.startswith("{"):
        collected = [value]
        remaining = text[match.end():]

        while not collected[-1].strip().endswith("}") and remaining:
            next_line, _, remaining = remaining.partition("\n")
            collected.append(next_line.strip())

        value = " ".join(collected)

    return value.strip().strip("{}").strip()


def _extract_int_value(text: str, field_name: str) -> int | None:
    value = _extract_scalar_value(text, field_name)
    if value is None:
        return None

    try:
        return int(value)
    except ValueError:
        return None


def _extract_float_list(text: str, field_name: str) -> list[float]:
    pattern = rf"{re.escape(field_name)}\s*=\s*\{{(.*?)\}}"
    match = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return []

    raw_values = match.group(1).replace("\n", " ")
    result: list[float] = []

    for part in raw_values.split(","):
        candidate = part.strip()
        if not candidate:
            continue
        try:
            result.append(float(candidate))
        except ValueError:
            continue

    return result


def extract_hdr_metadata(manifest: DatasetManifest) -> DatasetMetadata:
    if not manifest.sourceSummary or not manifest.sourceSummary.detectedPairs:
        raise ValueError("No detected source pairs are available.")

    pair = next((item for item in manifest.sourceSummary.detectedPairs if item.valid and item.hdr), None)
    if not pair or not pair.hdr:
        raise ValueError("No valid ENVI .hdr/.img pair was found.")

    try:
        hdr_path = resolve_under(RAW_DATASETS_DIR, pair.hdr)
    except ValueError as exc:
        raise ValueError("Dataset source path is outside the raw data directory.") from exc
    if not hdr_path.exists():
        raise ValueError(f"HDR file does not exist at {hdr_path}")

    hdr_text = hdr_path.read_text(encoding="utf-8", errors="ignore")

    return DatasetMetadata(
        stem=pair.stem,
        hdrPath=pair.hdr,
        imgPath=pair.img,
        samples=_extract_int_value(hdr_text, "samples"),
        lines=_extract_int_value(hdr_text, "lines"),
        bands=_extract_int_value(hdr_text, "bands"),
        headerOffset=_extract_int_value(hdr_text, "header offset"),
        fileType=_extract_scalar_value(hdr_text, "file type"),
        dataType=_extract_int_value(hdr_text, "data type"),
        interleave=_extract_scalar_value(hdr_text, "interleave"),
        byteOrder=_extract_int_value(hdr_text, "byte order"),
        wavelengths=_extract_float_list(hdr_text, "wavelength"),
        wavelengthUnits=_extract_scalar_value(hdr_text, "wavelength units"),
        description=_extract_scalar_value(hdr_text, "description"),
    )
