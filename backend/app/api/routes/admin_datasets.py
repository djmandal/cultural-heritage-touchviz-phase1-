from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.core.admin_auth import require_admin_session

from app.api.routes.datasets_shared import (
    build_dataset_list_response,
    delete_dataset_service,
    get_dataset_or_404,
    regenerate_dataset_outputs_service,
    upload_dataset_files_service,
)
from app.schemas.datasets import (
    DatasetActionResponse,
    DatasetListResponse,
    DatasetUploadResponse,
)

router = APIRouter(
    prefix="/admin/datasets",
    tags=["admin-datasets"],
    dependencies=[Depends(require_admin_session)],
)


@router.get("", response_model=DatasetListResponse)
def list_admin_datasets():
    return build_dataset_list_response()


@router.get("/{dataset_id}", response_model=dict)
def get_admin_dataset(dataset_id: str):
    return {"item": get_dataset_or_404(dataset_id)}


@router.post("/upload", response_model=DatasetUploadResponse)
async def upload_admin_dataset(
    id: str = Form(...),
    title: str = Form(...),
    artist: str = Form(...),
    year: str = Form(...),
    collection: str = Form(...),
    requested_outputs: str = Form("rgb"),
    hdr_file: UploadFile = File(..., description="Upload the .hdr file."),
    img_file: UploadFile = File(..., description="Upload the matching .img file."),
):
    return await upload_dataset_files_service(
        id=id,
        title=title,
        artist=artist,
        year=year,
        collection=collection,
        requested_outputs=requested_outputs,
        hdr_file=hdr_file,
        img_file=img_file,
    )


@router.post("/{dataset_id}/regenerate", response_model=DatasetActionResponse)
def regenerate_admin_dataset(dataset_id: str):
    manifest = regenerate_dataset_outputs_service(dataset_id)

    return DatasetActionResponse(
        message="Dataset outputs regenerated successfully.",
        datasetId=manifest.id,
        status=manifest.processing.status if manifest.processing else "ready",
    )


@router.delete("/{dataset_id}", response_model=DatasetActionResponse)
def delete_admin_dataset(dataset_id: str):
    delete_dataset_service(dataset_id)

    return DatasetActionResponse(
        message="Dataset deleted successfully.",
        datasetId=dataset_id,
        status="deleted",
    )
