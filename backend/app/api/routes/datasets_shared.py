import json
import os
import shutil
import tempfile
from pathlib import Path
from urllib.parse import quote

from fastapi import File, Form, HTTPException, UploadFile

from app.core.data_paths import resolve_under, validate_dataset_id
from app.schemas.datasets import (
    CreateDatasetRequest,
    DatasetAssets,
    DatasetBandConfig,
    DatasetComparePreset,
    DatasetListItem,
    DatasetListResponse,
    DatasetManifest,
    DatasetProcessing,
    DatasetSourceFile,
    DatasetSourceSummary,
    DatasetUploadResponse,
    DatasetVisualization,
)
from app.services.dataset_manifest import (
    build_dataset_manifest,
    build_source_summary,
    extract_hdr_metadata,
    write_dataset_manifest,
)
from app.services.envi_loader import (
    generate_band_previews,
    generate_false_color_preview,
    generate_rgb_preview,
)

BASE_DIR = Path(__file__).resolve().parents[3]
RAW_DATASETS_DIR = BASE_DIR / "data" / "raw"
DERIVED_DATASETS_DIR = BASE_DIR / "data" / "derived"
IIIF_PUBLIC_BASE_URL = os.getenv("IIIF_PUBLIC_BASE_URL", "").rstrip("/")


def iiif_info_url(dataset_id: str) -> str:
    """Return the stable IIIF Image API URL for a dataset's RGB master."""
    identifier = quote(f"{dataset_id}/master/rgb-master.png", safe="")
    return f"{IIIF_PUBLIC_BASE_URL}/iiif/3/{identifier}/info.json"


def build_sample_dataset() -> DatasetManifest:
    return DatasetManifest(
        id="night-watch-study",
        title="Night Watch Study",
        artist="Workshop Collection",
        year="1642",
        collection="Conservation Imaging Demo",
        thumbnail="/collection/night-watch-study/thumbnail.png",
        hero="/collection/night-watch-study/hero.png",
        iiifSources={},
        visualizations=[
            DatasetVisualization(
                id="rgb",
                label="Visible RGB",
                tone="rgb",
                description="Natural colour presentation for visitor-facing viewing.",
                available=True,
                sourceType="image",
                imageUrl="/collection/night-watch-study/hero.png",
            ),
            DatasetVisualization(
                id="infrared",
                label="Infrared",
                tone="infrared",
                description="Infrared-style view placeholder for backend-driven derivatives.",
                available=True,
                sourceType="image",
                imageUrl="/collection/night-watch-study/hero.png",
            ),
            DatasetVisualization(
                id="falseColor",
                label="False Colour",
                tone="false",
                description="Prepared slot for generated false-colour output.",
                available=False,
                sourceType="generated",
            ),
            DatasetVisualization(
                id="uv",
                label="Ultraviolet",
                tone="uv",
                description="Prepared slot for fluorescence visualization output.",
                available=False,
                sourceType="generated",
            ),
            DatasetVisualization(
                id="xray",
                label="X-Ray",
                tone="xray",
                description="Prepared slot for structural imaging output.",
                available=False,
                sourceType="generated",
            ),
        ],
        bands=DatasetBandConfig(
            enabled=True,
            minNm=420,
            maxNm=1000,
            stepNm=10,
            defaultNm=730,
        ),
        comparePresets=[
            DatasetComparePreset(
                id="rgb-infrared",
                label="RGB vs Infrared",
                leftVisualizationId="rgb",
                rightVisualizationId="infrared",
            )
        ],
        assets=DatasetAssets(
            thumbnail="/collection/night-watch-study/thumbnail.png",
            hero="/collection/night-watch-study/hero.png",
            iiifSources={},
            previewImage=None,
        ),
        processing=DatasetProcessing(
            status="ready",
            sourceType="demo-artwork",
        ),
        sourceFiles=[],
        sourceSummary=DatasetSourceSummary(),
        datasetMetadata=None,
    )


def load_all_datasets() -> list[DatasetManifest]:
    items: list[DatasetManifest] = []

    if DERIVED_DATASETS_DIR.exists():
        for manifest_path in sorted(DERIVED_DATASETS_DIR.glob("*/manifest.json")):
            try:
                manifest_data = json.loads(manifest_path.read_text(encoding="utf-8"))
                items.append(DatasetManifest(**manifest_data))
            except Exception as exc:
                print(f"Skipping invalid manifest: {manifest_path} -> {exc}")
                continue

    return items


def build_dataset_list_response() -> DatasetListResponse:
    items = load_all_datasets()

    return DatasetListResponse(
        items=[
            DatasetListItem(
                id=item.id,
                title=item.title,
                artist=item.artist,
                year=item.year,
                collection=item.collection,
                thumbnail=item.thumbnail,
                hero=item.hero,
                processing=item.processing,
                availableVisualizations=[viz.id for viz in item.visualizations if viz.available],
            )
            for item in items
        ],
        message="Dataset manifest route is ready.",
    )


def get_dataset_or_404(dataset_id: str) -> DatasetManifest:
    for item in load_all_datasets():
        if item.id == dataset_id:
            return item

    raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' was not found.")

def regenerate_dataset_outputs_service(dataset_id: str) -> DatasetManifest:
    manifest = get_dataset_or_404(dataset_id)

    if not manifest.sourceSummary or not manifest.sourceSummary.hasValidEnviPair:
        raise HTTPException(
            status_code=400,
            detail=f"Dataset '{dataset_id}' does not have a valid ENVI pair for regeneration.",
        )

    if manifest.datasetMetadata is None:
        manifest.datasetMetadata = extract_hdr_metadata(manifest)

    if manifest.assets is None:
        manifest.assets = DatasetAssets(
            thumbnail=manifest.thumbnail,
            hero=manifest.hero,
            iiifSources={},
            previewImage=manifest.hero,
        )

    if manifest.iiifSources is None:
        manifest.iiifSources = {}

    requested_outputs = (
        manifest.processing.requestedOutputs
        if manifest.processing and manifest.processing.requestedOutputs
        else ["rgb"]
    )

    completed_outputs: list[str] = []
    failed_outputs: list[str] = []

    rgb_preview = None
    rgb_iiif_source = None

    if "rgb" in requested_outputs or "iiif" in requested_outputs:
        try:
            rgb_preview = generate_rgb_preview(manifest)

            manifest.thumbnail = rgb_preview["imageUrl"]
            manifest.hero = rgb_preview["imageUrl"]
            manifest.assets.thumbnail = rgb_preview["imageUrl"]
            manifest.assets.hero = rgb_preview["imageUrl"]
            manifest.assets.previewImage = rgb_preview["imageUrl"]

            completed_outputs.append("rgb")
        except Exception:
            failed_outputs.append("rgb")

    if "iiif" in requested_outputs:
        try:
            if rgb_preview is None:
                rgb_preview = generate_rgb_preview(manifest)
            rgb_iiif_source = iiif_info_url(manifest.id)
            manifest.iiifSources["rgb"] = rgb_iiif_source
            manifest.assets.iiifSources["rgb"] = rgb_iiif_source
            completed_outputs.append("iiif")
        except Exception:
            failed_outputs.append("iiif")

    updated_visualizations: list[DatasetVisualization] = []

    for item in manifest.visualizations:
        if item.id == "rgb":
            item.available = rgb_preview is not None
            item.sourceType = "iiif" if rgb_iiif_source else "image"
            item.tileSource = rgb_iiif_source
            item.imageUrl = rgb_preview["imageUrl"] if rgb_preview else item.imageUrl

        if item.id == "falseColor" and "falseColor" in requested_outputs:
            try:
                false_color_preview = generate_false_color_preview(manifest)
                item.available = True
                item.sourceType = "image"
                item.tileSource = None
                item.imageUrl = false_color_preview["imageUrl"]
                if "falseColor" not in completed_outputs:
                    completed_outputs.append("falseColor")
            except Exception:
                if "falseColor" not in failed_outputs:
                    failed_outputs.append("falseColor")

        updated_visualizations.append(item)

    if "bands" in requested_outputs:
        try:
            band_previews = generate_band_previews(manifest)
            if manifest.bands is not None:
                manifest.bands.enabled = True
                manifest.bands.minNm = band_previews["minNm"]
                manifest.bands.maxNm = band_previews["maxNm"]
                manifest.bands.defaultNm = band_previews["defaultNm"]
                manifest.bands.previewImages = [
                    item["imageUrl"] for item in band_previews["items"] if item.get("imageUrl")
                ]
                manifest.bands.items = band_previews["items"]
            completed_outputs.append("bands")
        except Exception:
            if manifest.bands is not None:
                manifest.bands.enabled = False
                manifest.bands.previewImages = []
                manifest.bands.items = []
            failed_outputs.append("bands")

    manifest.visualizations = updated_visualizations

    if manifest.processing is not None:
        manifest.processing.status = "ready"
        manifest.processing.completedOutputs = completed_outputs
        manifest.processing.failedOutputs = failed_outputs
        manifest.processing.sourceType = "hyperspectral-cube"

    write_dataset_manifest(manifest)
    return manifest


def delete_dataset_service(dataset_id: str) -> None:
    if dataset_id == "night-watch-study":
        raise HTTPException(
            status_code=400,
            detail="The demo dataset cannot be deleted.",
        )

    manifest = get_dataset_or_404(dataset_id)

    try:
        raw_dir = resolve_under(RAW_DATASETS_DIR, validate_dataset_id(manifest.id))
        derived_dir = resolve_under(DERIVED_DATASETS_DIR, validate_dataset_id(manifest.id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid dataset ID in manifest.") from exc

    if raw_dir.exists():
        shutil.rmtree(raw_dir)

    if derived_dir.exists():
        shutil.rmtree(derived_dir)


async def upload_dataset_files_service(
    id: str = Form(...),
    title: str = Form(...),
    artist: str = Form(...),
    year: str = Form(...),
    collection: str = Form(...),
    requested_outputs: str = Form("rgb"),
    hdr_file: UploadFile = File(..., description="Upload the .hdr file."),
    img_file: UploadFile = File(..., description="Upload the matching .img file."),
) -> DatasetUploadResponse:
    id = id.strip()
    title = title.strip()
    artist = artist.strip()
    year = year.strip()
    collection = collection.strip()

    try:
        id = validate_dataset_id(id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not title:
        raise HTTPException(status_code=400, detail="Dataset title is required.")
    if not artist:
        raise HTTPException(status_code=400, detail="Dataset artist is required.")
    if not year:
        raise HTTPException(status_code=400, detail="Dataset year is required.")
    if not collection:
        raise HTTPException(status_code=400, detail="Dataset collection is required.")

    manifest_path = resolve_under(DERIVED_DATASETS_DIR, id, "manifest.json")
    raw_dataset_dir = resolve_under(RAW_DATASETS_DIR, id)
    if manifest_path.exists() or raw_dataset_dir.exists():
        raise HTTPException(status_code=409, detail=f"Dataset '{id}' already exists.")

    requested_outputs_list = [
        item.strip() for item in requested_outputs.split(",") if item.strip()
    ]

    if "all" in requested_outputs_list:
        requested_outputs_list = ["rgb", "infrared", "falseColor", "uv", "xray", "bands", "iiif"]

    payload = CreateDatasetRequest(
        id=id,
        title=title,
        artist=artist,
        year=year,
        collection=collection,
        requestedOutputs=requested_outputs_list or ["rgb"],
    )
    manifest = build_dataset_manifest(payload)

    if manifest.processing is not None:
        manifest.processing.requestedOutputs = payload.requestedOutputs
        manifest.processing.completedOutputs = []
        manifest.processing.failedOutputs = []

    uploads = [(hdr_file, ".hdr"), (img_file, ".img")]
    upload_names: list[str] = []
    for upload, expected_suffix in uploads:
        filename = (upload.filename or "").replace("\\", "/")
        if not filename or filename != Path(filename).name or filename in {".", ".."}:
            raise HTTPException(status_code=400, detail="Uploaded filenames must be plain filenames without folders.")
        if Path(filename).suffix.lower() != expected_suffix:
            raise HTTPException(status_code=400, detail=f"The selected file must have a {expected_suffix} extension.")
        upload_names.append(filename)
    if upload_names[0].casefold() == upload_names[1].casefold():
        raise HTTPException(status_code=400, detail="HDR and IMG filenames must be different.")

    try:
        max_upload_bytes = int(os.getenv("TOUCHVIZ_MAX_UPLOAD_BYTES", str(8 * 1024**3)))
    except ValueError as exc:
        raise HTTPException(status_code=500, detail="Upload size limit is misconfigured.") from exc
    if max_upload_bytes <= 0:
        raise HTTPException(status_code=500, detail="Upload size limit is misconfigured.")

    RAW_DATASETS_DIR.mkdir(parents=True, exist_ok=True)
    staging_dir = Path(tempfile.mkdtemp(prefix=".upload-", dir=RAW_DATASETS_DIR))
    saved_files: list[DatasetSourceFile] = []
    total_bytes = 0
    try:
        for (upload, _), filename in zip(uploads, upload_names, strict=True):
            destination = resolve_under(staging_dir, filename)
            size = 0
            with destination.open("wb") as output:
                while chunk := await upload.read(1024 * 1024):
                    total_bytes += len(chunk)
                    size += len(chunk)
                    if total_bytes > max_upload_bytes:
                        raise HTTPException(
                            status_code=413,
                            detail=f"The combined upload exceeds the {max_upload_bytes}-byte limit.",
                        )
                    output.write(chunk)
            saved_files.append(
                DatasetSourceFile(
                    name=filename,
                    relativePath=str(Path(id) / filename),
                    size=size,
                )
            )
        staging_dir.rename(raw_dataset_dir)
    except Exception:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise
    finally:
        await hdr_file.close()
        await img_file.close()

    manifest.sourceFiles = sorted(saved_files, key=lambda item: item.relativePath)
    manifest.sourceSummary = build_source_summary(manifest)
    write_dataset_manifest(manifest)

    auto_processed = False

    if manifest.sourceSummary and manifest.sourceSummary.hasValidEnviPair:
        generated_outputs: list[str] = []
        failed_outputs: list[str] = []

        try:
            if manifest.datasetMetadata is None:
                manifest.datasetMetadata = extract_hdr_metadata(manifest)

            if manifest.assets is None:
                manifest.assets = DatasetAssets(
                    thumbnail=manifest.thumbnail,
                    hero=manifest.hero,
                    iiifSources={},
                    previewImage=manifest.hero,
                )

            if manifest.iiifSources is None:
                manifest.iiifSources = {}

            rgb_preview = None
            rgb_iiif_source = None

            if "rgb" in payload.requestedOutputs or "iiif" in payload.requestedOutputs:
                rgb_preview = generate_rgb_preview(manifest)

                manifest.thumbnail = rgb_preview["imageUrl"]
                manifest.hero = rgb_preview["imageUrl"]
                manifest.assets.thumbnail = rgb_preview["imageUrl"]
                manifest.assets.hero = rgb_preview["imageUrl"]
                manifest.assets.previewImage = rgb_preview["imageUrl"]

                generated_outputs.append("rgb")

            if "iiif" in payload.requestedOutputs:
                if rgb_preview is None:
                    rgb_preview = generate_rgb_preview(manifest)
                rgb_iiif_source = iiif_info_url(manifest.id)
                manifest.iiifSources["rgb"] = rgb_iiif_source
                manifest.assets.iiifSources["rgb"] = rgb_iiif_source
                generated_outputs.append("iiif")

            updated_visualizations: list[DatasetVisualization] = []

            for item in manifest.visualizations:
                if item.id == "rgb":
                    item.available = rgb_preview is not None
                    item.sourceType = "iiif" if rgb_iiif_source else "image"
                    item.tileSource = rgb_iiif_source
                    item.imageUrl = rgb_preview["imageUrl"] if rgb_preview else item.imageUrl
                updated_visualizations.append(item)

            if not any(item.id == "rgb" for item in updated_visualizations) and rgb_preview is not None:
                updated_visualizations.insert(
                    0,
                    DatasetVisualization(
                        id="rgb",
                        label="Visible RGB",
                        tone="rgb",
                        description="Primary visible-light preview generated from uploaded ENVI data.",
                        available=True,
                        sourceType="iiif" if rgb_iiif_source else "image",
                        tileSource=rgb_iiif_source,
                        imageUrl=rgb_preview["imageUrl"],
                    ),
                )

            if "falseColor" in payload.requestedOutputs:
                try:
                    false_color_preview = generate_false_color_preview(manifest)

                    found_false_color = False
                    for item in updated_visualizations:
                        if item.id == "falseColor":
                            item.available = True
                            item.sourceType = "image"
                            item.tileSource = None
                            item.imageUrl = false_color_preview["imageUrl"]
                            found_false_color = True

                    if not found_false_color:
                        updated_visualizations.append(
                            DatasetVisualization(
                                id="falseColor",
                                label="False Colour",
                                tone="false",
                                description="False-colour preview generated from uploaded ENVI data.",
                                available=True,
                                sourceType="image",
                                tileSource=None,
                                imageUrl=false_color_preview["imageUrl"],
                            )
                        )

                    generated_outputs.append("falseColor")
                except Exception:
                    failed_outputs.append("falseColor")

            if "bands" in payload.requestedOutputs:
                try:
                    band_previews = generate_band_previews(manifest)
                    if manifest.bands is not None:
                        manifest.bands.enabled = True
                        manifest.bands.minNm = band_previews["minNm"]
                        manifest.bands.maxNm = band_previews["maxNm"]
                        manifest.bands.defaultNm = band_previews["defaultNm"]
                        manifest.bands.previewImages = [
                            item["imageUrl"] for item in band_previews["items"] if item.get("imageUrl")
                        ]
                        manifest.bands.items = band_previews["items"]
                    generated_outputs.append("bands")
                except Exception:
                    if manifest.bands is not None:
                        manifest.bands.enabled = False
                        manifest.bands.previewImages = []
                        manifest.bands.items = []
                    failed_outputs.append("bands")

            manifest.visualizations = updated_visualizations

            if manifest.processing is not None:
                manifest.processing.status = "ready"
                manifest.processing.completedOutputs = generated_outputs
                manifest.processing.failedOutputs = failed_outputs
                manifest.processing.sourceType = "uploaded-envi"

            write_dataset_manifest(manifest)
            auto_processed = True

        except Exception:
            if manifest.processing is not None:
                manifest.processing.status = "ready"
                manifest.processing.sourceType = "uploaded-envi"
            write_dataset_manifest(manifest)

    return DatasetUploadResponse(
        message="Dataset uploaded and processed successfully." if auto_processed else "Dataset files saved.",
        datasetId=manifest.id,
        uploadSaved=True,
        hasValidEnviPair=bool(manifest.sourceSummary and manifest.sourceSummary.hasValidEnviPair),
        sourceSummary=manifest.sourceSummary or DatasetSourceSummary(),
        sourceFiles=manifest.sourceFiles or [],
        nextAction="ready" if auto_processed else "process",
        requestedOutputs=payload.requestedOutputs,
        completedOutputs=manifest.processing.completedOutputs if manifest.processing else [],
    )
