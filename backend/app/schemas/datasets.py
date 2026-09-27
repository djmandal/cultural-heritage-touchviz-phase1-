from typing import Literal

from pydantic import BaseModel


VisualizationId = Literal["rgb", "infrared", "uv", "falseColor", "xray"]
ProcessingStatus = Literal["ready", "processing", "error"]
SourceType = Literal["demo-artwork", "hyperspectral-cube", "multispectral", "rgb-only", "uploaded-envi"]
VisualizationSourceType = Literal["iiif", "dzi", "image", "generated", "band"]
GenerationOptionId = Literal["rgb", "infrared", "falseColor", "uv", "xray", "bands", "iiif"]


class DatasetVisualization(BaseModel):
    id: VisualizationId
    label: str
    tone: str
    description: str
    available: bool = True
    sourceType: VisualizationSourceType = "image"
    tileSource: str | None = None
    imageUrl: str | None = None


class DatasetBandImage(BaseModel):
    bandIndex: int
    wavelength: float | None = None
    imageUrl: str


class DatasetBandConfig(BaseModel):
    enabled: bool
    minNm: int
    maxNm: int
    stepNm: int
    defaultNm: int
    previewImages: list[str] = []
    items: list[DatasetBandImage] = []


class DatasetComparePreset(BaseModel):
    id: str
    label: str
    leftVisualizationId: VisualizationId
    rightVisualizationId: VisualizationId


class DatasetAssets(BaseModel):
    thumbnail: str
    hero: str
    iiifSources: dict[VisualizationId, str] = {}
    previewImage: str | None = None


class DatasetProcessing(BaseModel):
    status: ProcessingStatus = "ready"
    sourceType: SourceType = "demo-artwork"
    uploadedAt: str | None = None
    requestedOutputs: list[GenerationOptionId] = []
    completedOutputs: list[GenerationOptionId] = []
    failedOutputs: list[GenerationOptionId] = []


class DatasetSourceFile(BaseModel):
    name: str
    relativePath: str
    size: int


class DatasetDetectedPair(BaseModel):
    stem: str
    hdr: str | None = None
    img: str | None = None
    valid: bool = False


class DatasetSourceSummary(BaseModel):
    totalFiles: int = 0
    extensions: list[str] = []
    detectedPairs: list[DatasetDetectedPair] = []
    hasValidEnviPair: bool = False


class DatasetMetadata(BaseModel):
    stem: str
    hdrPath: str
    imgPath: str | None = None
    samples: int | None = None
    lines: int | None = None
    bands: int | None = None
    headerOffset: int | None = None
    fileType: str | None = None
    dataType: int | None = None
    interleave: str | None = None
    byteOrder: int | None = None
    wavelengths: list[float] = []
    wavelengthUnits: str | None = None
    description: str | None = None


class DatasetManifest(BaseModel):
    id: str
    title: str
    artist: str
    year: str
    collection: str
    thumbnail: str
    hero: str
    iiifSources: dict[VisualizationId, str] = {}
    visualizations: list[DatasetVisualization] = []
    bands: DatasetBandConfig | None = None
    comparePresets: list[DatasetComparePreset] = []
    assets: DatasetAssets | None = None
    processing: DatasetProcessing | None = None
    sourceFiles: list[DatasetSourceFile] = []
    sourceSummary: DatasetSourceSummary | None = None
    datasetMetadata: DatasetMetadata | None = None


class CreateDatasetRequest(BaseModel):
    id: str
    title: str
    artist: str
    year: str
    collection: str
    sourceType: SourceType = "hyperspectral-cube"
    thumbnail: str = "/collection/night-watch-study/thumbnail.png"
    hero: str = "/collection/night-watch-study/hero.png"
    requestedOutputs: list[GenerationOptionId] = ["rgb"]


class DatasetListItem(BaseModel):
    id: str
    title: str
    artist: str
    year: str
    collection: str
    thumbnail: str
    hero: str
    processing: DatasetProcessing | None = None
    availableVisualizations: list[VisualizationId] = []


class DatasetListResponse(BaseModel):
    items: list[DatasetListItem]
    message: str


class DatasetUploadResponse(BaseModel):
    message: str
    datasetId: str
    uploadSaved: bool
    hasValidEnviPair: bool
    sourceSummary: DatasetSourceSummary
    sourceFiles: list[DatasetSourceFile]
    nextAction: str
    requestedOutputs: list[GenerationOptionId] = []
    completedOutputs: list[GenerationOptionId] = []


class DatasetProcessRgbResponse(BaseModel):
    message: str
    datasetId: str
    status: ProcessingStatus
    manifestPath: str
    previewImage: str | None = None

class DatasetActionResponse(BaseModel):
    message: str
    datasetId: str
    status: ProcessingStatus | str
