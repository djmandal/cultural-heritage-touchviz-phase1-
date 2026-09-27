from math import ceil, log2
from pathlib import Path

from PIL import Image


TILE_SIZE = 256
OVERLAP = 1
FORMAT = "jpg"


def _ensure_rgb(image: Image.Image) -> Image.Image:
    if image.mode != "RGB":
        return image.convert("RGB")
    return image


def _level_dimensions(width: int, height: int, level: int) -> tuple[int, int]:
    scale = 2 ** level
    return max(1, ceil(width / scale)), max(1, ceil(height / scale))


def _max_level(width: int, height: int) -> int:
    return int(ceil(log2(max(width, height))))


def generate_dzi_tiles(image_path: str | Path, output_dir: str | Path, dzi_name: str) -> dict:
    image_path = Path(image_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    image = Image.open(image_path)
    image = _ensure_rgb(image)

    width, height = image.size
    max_level = _max_level(width, height)

    tiles_root = output_dir / f"{dzi_name}_files"
    tiles_root.mkdir(parents=True, exist_ok=True)

    for level in range(max_level + 1):
        level_width, level_height = _level_dimensions(width, height, max_level - level)
        level_image = image.resize((level_width, level_height), Image.Resampling.LANCZOS)

        cols = ceil(level_width / TILE_SIZE)
        rows = ceil(level_height / TILE_SIZE)

        level_dir = tiles_root / str(level)
        level_dir.mkdir(parents=True, exist_ok=True)

        for col in range(cols):
            for row in range(rows):
                left = max(0, col * TILE_SIZE - (OVERLAP if col > 0 else 0))
                upper = max(0, row * TILE_SIZE - (OVERLAP if row > 0 else 0))
                right = min(level_width, (col + 1) * TILE_SIZE + (OVERLAP if col < cols - 1 else 0))
                lower = min(level_height, (row + 1) * TILE_SIZE + (OVERLAP if row < rows - 1 else 0))

                tile = level_image.crop((left, upper, right, lower))
                tile_path = level_dir / f"{col}_{row}.{FORMAT}"
                tile.save(tile_path, quality=90)

    dzi_path = output_dir / f"{dzi_name}.dzi"
    dzi_xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<Image TileSize="{TILE_SIZE}" Overlap="{OVERLAP}" Format="{FORMAT}" xmlns="http://schemas.microsoft.com/deepzoom/2008">
    <Size Width="{width}" Height="{height}"/>
</Image>
'''
    dzi_path.write_text(dzi_xml, encoding="utf-8")

    return {
        "dziPath": str(dzi_path),
        "tilesDir": str(tiles_root),
        "width": width,
        "height": height,
    }
