from fastapi import APIRouter

from app.schemas.datasets import DatasetListResponse, DatasetManifest
from app.api.routes.datasets_shared import build_dataset_list_response, get_dataset_or_404

router = APIRouter(prefix="/public/datasets", tags=["public-datasets"])


@router.get("", response_model=DatasetListResponse)
def list_public_datasets():
    return build_dataset_list_response()


@router.get("/{dataset_id}", response_model=DatasetManifest)
def get_public_dataset(dataset_id: str):
    return get_dataset_or_404(dataset_id)
