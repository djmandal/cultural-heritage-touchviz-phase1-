import re
from pathlib import Path


DATASET_ID_PATTERN = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9])?\Z")


def validate_dataset_id(dataset_id: str) -> str:
    if not DATASET_ID_PATTERN.fullmatch(dataset_id):
        raise ValueError("Dataset ID must be 1–64 letters, numbers, underscores, or hyphens and start/end with a letter or number.")
    return dataset_id


def resolve_under(root: Path, *parts: str) -> Path:
    root_path = root.resolve()
    resolved_path = root_path.joinpath(*parts).resolve()
    try:
        resolved_path.relative_to(root_path)
    except ValueError as exc:
        raise ValueError("Requested file path is outside the data directory.") from exc
    return resolved_path
