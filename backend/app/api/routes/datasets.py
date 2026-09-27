from fastapi import APIRouter

from app.api.routes.datasets_shared import build_dataset_list_response, get_dataset_or_404
from app.schemas.datasets import DatasetListResponse

router = APIRouter(prefix="/datasets", tags=["datasets"])


@router.get("", response_model=DatasetListResponse)
def list_datasets():
    return build_dataset_list_response()


@router.get("/{dataset_id}", response_model=dict)
def get_dataset(dataset_id: str):
    return {"item": get_dataset_or_404(dataset_id)}
